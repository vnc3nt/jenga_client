#include "config_wifi.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_http_server.h"
#include "lwip/dns.h"
#include "lwip/sockets.h"
#include "lwip/netdb.h"
#include "cJSON.h"
#include "nvs_flash.h"
#include "nvs.h"
#include <string.h>

static const char *TAG = "CONFIG_WIFI";
static httpd_handle_t config_server = NULL;

// --- EINGEBETTETE DATEIEN (Deklarationen) ---
extern const unsigned char config_html_start[] asm("_binary_config_html_start");
extern const unsigned char config_html_end[] asm("_binary_config_html_end");
extern const unsigned char config_js_start[] asm("_binary_config_js_start");
extern const unsigned char config_js_end[] asm("_binary_config_js_end");
extern const unsigned char style_css_start[] asm("_binary_style_css_start");
extern const unsigned char style_css_end[] asm("_binary_style_css_end");

// --- HANDLER ---

// Scan Handler
static esp_err_t scan_handler(httpd_req_t *req) {
    wifi_scan_config_t scan_config = {
        .ssid = 0,
        .bssid = 0,
        .channel = 0,
        .show_hidden = true
    };

    esp_err_t err = esp_wifi_scan_start(&scan_config, true);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Scan failed: %s", esp_err_to_name(err));
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    uint16_t ap_count = 0;
    esp_wifi_scan_get_ap_num(&ap_count);
    
    wifi_ap_record_t *ap_list = (wifi_ap_record_t *)malloc(ap_count * sizeof(wifi_ap_record_t));
    if (!ap_list) {
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }
    
    ESP_ERROR_CHECK(esp_wifi_scan_get_ap_records(&ap_count, ap_list));

    cJSON *root = cJSON_CreateArray();
    for (int i = 0; i < ap_count; i++) {
        cJSON *item = cJSON_CreateObject();
        cJSON_AddStringToObject(item, "ssid", (char *)ap_list[i].ssid);
        cJSON_AddNumberToObject(item, "rssi", ap_list[i].rssi);
        cJSON_AddNumberToObject(item, "auth", ap_list[i].authmode);
        cJSON_AddItemToArray(root, item);
    }

    char *json_str = cJSON_PrintUnformatted(root);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_send(req, json_str, strlen(json_str));

    free(json_str);
    cJSON_Delete(root);
    free(ap_list);
    return ESP_OK;
}

// Saved Network Handler
static esp_err_t get_saved_handler(httpd_req_t *req) {
    nvs_handle_t my_handle;
    esp_err_t err = nvs_open("storage", NVS_READONLY, &my_handle);
    char ssid[33] = {0};
    if (err == ESP_OK) {
        size_t required_size = sizeof(ssid);
        nvs_get_str(my_handle, "wifi_ssid", ssid, &required_size);
        nvs_close(my_handle);
    }
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "ssid", ssid);
    char *json_response = cJSON_PrintUnformatted(root);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_send(req, json_response, strlen(json_response));
    cJSON_Delete(root);
    free(json_response);
    return ESP_OK;
}

// Forget Network Handler
static esp_err_t forget_handler(httpd_req_t *req) {
    nvs_handle_t my_handle;
    if (nvs_open("storage", NVS_READWRITE, &my_handle) == ESP_OK) {
        nvs_erase_key(my_handle, "wifi_ssid");
        nvs_erase_key(my_handle, "wifi_pass");
        nvs_commit(my_handle);
        nvs_close(my_handle);
        httpd_resp_send(req, "OK", 2);
    } else {
        httpd_resp_send_500(req);
    }
    return ESP_OK;
}

// Save Handler
static esp_err_t save_handler(httpd_req_t *req) {
    char buf[200];
    int ret = httpd_req_recv(req, buf, sizeof(buf) - 1);
    if (ret <= 0) return ESP_FAIL;
    buf[ret] = '\0';

    cJSON *root = cJSON_Parse(buf);
    cJSON *ssid = cJSON_GetObjectItem(root, "ssid");
    cJSON *pass = cJSON_GetObjectItem(root, "password");

    if (ssid && pass) {
        nvs_handle_t my_handle;
        ESP_ERROR_CHECK(nvs_open("storage", NVS_READWRITE, &my_handle));
        ESP_ERROR_CHECK(nvs_set_str(my_handle, "wifi_ssid", ssid->valuestring));
        ESP_ERROR_CHECK(nvs_set_str(my_handle, "wifi_pass", pass->valuestring));
        ESP_ERROR_CHECK(nvs_commit(my_handle));
        nvs_close(my_handle);
        httpd_resp_send(req, "OK", 2);
        
        vTaskDelay(pdMS_TO_TICKS(1000));
        esp_restart();
    }
    cJSON_Delete(root);
    return ESP_OK;
}

// File Handlers
static esp_err_t config_html_handler(httpd_req_t *req) {
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, (const char *)config_html_start, config_html_end - config_html_start);
}
static esp_err_t config_js_handler(httpd_req_t *req) {
    httpd_resp_set_type(req, "text/javascript");
    return httpd_resp_send(req, (const char *)config_js_start, config_js_end - config_js_start);
}
static esp_err_t style_css_handler(httpd_req_t *req) {
    httpd_resp_set_type(req, "text/css");
    return httpd_resp_send(req, (const char *)style_css_start, style_css_end - style_css_start);
}

// Redirect Handler für Captive Portal Checks
static esp_err_t captive_portal_handler(httpd_req_t *req) {
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "/");
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
}

// --- DNS SERVER FÜR CAPTIVE PORTAL ---
static TaskHandle_t dns_task_handle = NULL;

static void dns_server_task(void *pvParameters) {
    uint8_t data[512];
    struct sockaddr_in server_addr;
    struct sockaddr_in client_addr;
    socklen_t client_addr_len = sizeof(client_addr);
    int sock;

    sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock < 0) {
        ESP_LOGE(TAG, "Failed to create DNS socket");
        vTaskDelete(NULL);
    }

    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_addr.s_addr = htonl(INADDR_ANY);
    server_addr.sin_port = htons(53);

    if (bind(sock, (struct sockaddr *)&server_addr, sizeof(server_addr)) < 0) {
        ESP_LOGE(TAG, "Failed to bind DNS socket");
        close(sock);
        vTaskDelete(NULL);
    }

    ESP_LOGI(TAG, "DNS Server started");

    while (1) {
        int len = recvfrom(sock, data, sizeof(data), 0, (struct sockaddr *)&client_addr, &client_addr_len);
        if (len > 0) {
            // DNS Header manipulieren
            data[2] |= 0x80; // QR Bit
            data[3] &= 0xF0; // RCODE
            data[6] = 0x00; data[7] = 0x01; // Answer Count
            data[8] = 0; data[9] = 0;
            data[10] = 0; data[11] = 0;

            int idx = 12;
            while (data[idx] != 0 && idx < len) {
                idx += data[idx] + 1;
            }
            idx++; 
            idx += 4; 

            // Answer
            data[idx++] = 0xC0; data[idx++] = 0x0C;
            data[idx++] = 0x00; data[idx++] = 0x01;
            data[idx++] = 0x00; data[idx++] = 0x01;
            
            uint32_t ttl = htonl(60);
            memcpy(&data[idx], &ttl, 4);
            idx += 4;
            
            data[idx++] = 0x00; data[idx++] = 0x04;
            
            esp_netif_ip_info_t ip_info;
            esp_netif_t* netif = esp_netif_get_handle_from_ifkey("WIFI_AP_DEF");
            esp_netif_get_ip_info(netif, &ip_info);
            
            memcpy(&data[idx], &ip_info.ip.addr, 4);
            idx += 4;

            sendto(sock, data, idx, 0, (struct sockaddr *)&client_addr, client_addr_len);
        }
        vTaskDelay(10 / portTICK_PERIOD_MS);
    }
    close(sock);
    vTaskDelete(NULL);
}

void start_dns_server() {
    xTaskCreate(dns_server_task, "dns_server", 4096, NULL, 5, &dns_task_handle);
}

void stop_dns_server() {
    if (dns_task_handle) {
        vTaskDelete(dns_task_handle);
        dns_task_handle = NULL;
    }
}

// Hilfsfunktion zum Registrieren von URIs ohne Warnungen
static void register_uri(httpd_handle_t server, const char *uri, httpd_method_t method, esp_err_t (*handler)(httpd_req_t *r)) {
    httpd_uri_t u = {}; // Null-Initialisierung
    u.uri = uri;
    u.method = method;
    u.handler = handler;
    u.user_ctx = NULL;
    httpd_register_uri_handler(server, &u);
}

void start_config_server() {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_uri_handlers = 12;

    if (httpd_start(&config_server, &config) == ESP_OK) {
        register_uri(config_server, "/", HTTP_GET, config_html_handler);
        register_uri(config_server, "/config", HTTP_GET, config_html_handler);
        register_uri(config_server, "/config.js", HTTP_GET, config_js_handler);
        register_uri(config_server, "/style.css", HTTP_GET, style_css_handler);
        register_uri(config_server, "/scan", HTTP_GET, scan_handler);
        register_uri(config_server, "/save", HTTP_POST, save_handler);
        register_uri(config_server, "/saved", HTTP_GET, get_saved_handler);
        register_uri(config_server, "/forget", HTTP_POST, forget_handler);

        // Captive Portal Redirects
        register_uri(config_server, "/generate_204", HTTP_GET, captive_portal_handler);
        register_uri(config_server, "/connecttest.txt", HTTP_GET, captive_portal_handler);
        register_uri(config_server, "/hotspot-detect.html", HTTP_GET, captive_portal_handler);
    }
}

void start_config_wifi(void) {
    ESP_LOGI(TAG, "Starting WiFi AP for configuration...");
    
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&cfg);

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));

    wifi_config_t ap_config = {}; 
    
    strlcpy((char*)ap_config.ap.ssid, "ESP32 Jenga Config", sizeof(ap_config.ap.ssid));
    ap_config.ap.ssid_len = strlen("ESP32 Jenga Config");
    ap_config.ap.password[0] = '\0'; 
    ap_config.ap.channel = 1;
    ap_config.ap.authmode = WIFI_AUTH_OPEN;
    ap_config.ap.max_connection = 4;

    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    start_config_server();
    start_dns_server();
}

void stop_config_wifi(void) {
    stop_dns_server();
    if (config_server) {
        httpd_stop(config_server);
        config_server = NULL;
    }
    esp_wifi_stop();
}

bool connect_saved_wifi(void) {
    nvs_handle_t my_handle;
    if (nvs_open("storage", NVS_READONLY, &my_handle) != ESP_OK) return false;
    
    char ssid[33] = {0};
    char pass[65] = {0};
    size_t s_len = sizeof(ssid);
    size_t p_len = sizeof(pass);
    
    if (nvs_get_str(my_handle, "wifi_ssid", ssid, &s_len) != ESP_OK) {
        nvs_close(my_handle);
        return false;
    }
    nvs_get_str(my_handle, "wifi_pass", pass, &p_len);
    nvs_close(my_handle);

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&cfg);
    
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA)); 
    
    wifi_config_t wifi_config = {}; 
    strncpy((char*)wifi_config.sta.ssid, ssid, sizeof(wifi_config.sta.ssid));
    strncpy((char*)wifi_config.sta.password, pass, sizeof(wifi_config.sta.password));
    
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
    
    ESP_LOGI(TAG, "Connecting to %s...", ssid);
    esp_wifi_connect();
    
    int retry = 0;
    while (retry < 20) {
        vTaskDelay(pdMS_TO_TICKS(500));
        wifi_ap_record_t ap_info;
        if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) {
            return true;
        }
        retry++;
    }
    return false;
}