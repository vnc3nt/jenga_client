#include "webserver.h"
#include <esp_event.h>
#include "driver/gpio.h"
#include <esp_log.h>
#include <esp_system.h>
#include <nvs_flash.h>
#include <sys/param.h>
#include "esp_netif.h"
#include "esp_eth.h"
#include "esp_wifi.h"
#include "protocol_examples_common.h"
#include "lwip/sockets.h"
#include <esp_http_server.h>
#include "keep_alive.h"
#include "sdkconfig.h"
#include "mdns.h"
#include "global_vars.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "cJSON.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

static const char *TAG = "wss_server";

static bool mdns_hostname_in_use(const char *hostname, uint32_t timeout_ms)
{
    esp_ip4_addr_t addr4 = {};
    esp_ip6_addr_t addr6 = {};

    // Falls im Netz bereits ein Host mit diesem Namen existiert, beantwortet er die mDNS A/AAAA Query.
    if (mdns_query_a(hostname, timeout_ms, &addr4) == ESP_OK) {
        return true;
    }
    if (mdns_query_aaaa(hostname, timeout_ms, &addr6) == ESP_OK) {
        return true;
    }
    return false;
}

static void mdns_select_hostname(char *out_hostname, size_t out_len)
{
    // Vorgabe: jenga1.local, jenga2.local, ...
    // Wir speichern ohne ".local" (mdns_hostname_set hängt .local implizit an).
    static constexpr uint32_t kProbeTimeoutMs = 250;
    static constexpr int kMaxIndex = 99;

    for (int i = 1; i <= kMaxIndex; ++i) {
        char candidate[32];
        snprintf(candidate, sizeof(candidate), "jenga%d", i);
        if (!mdns_hostname_in_use(candidate, kProbeTimeoutMs)) {
            strlcpy(out_hostname, candidate, out_len);
            return;
        }
    }

    // Sehr unwahrscheinlich – aber falls 1..99 belegt sind.
    strlcpy(out_hostname, "jenga99", out_len);
}

// --- mDNS Implementierung ---
void initialise_mdns(void)
{
    ESP_LOGI(TAG, "Initialisiere mDNS...");
    esp_err_t err = mdns_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "MDNS Init fehlgeschlagen: %d", err);
        return;
    }

    char hostname[32];
    mdns_select_hostname(hostname, sizeof(hostname));

    err = mdns_hostname_set(hostname);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "mDNS Hostname setzen fehlgeschlagen: %d", err);
        return;
    }

    mdns_instance_name_set("Jenga ESP32 Webserver");

    // Service bekanntgeben (optional, hilft aber Discovery-Tools)
    mdns_service_add(NULL, "_http", "_tcp", 80, NULL, 0);

    ESP_LOGI(TAG, "mDNS gestartet. Erreichbar unter: http://%s.local", hostname);
}
// ---------------------------

// --- EXTERNE API FUNKTIONEN (aus main.cpp) ---
// Damit wir von hier aus die Spiellogik steuern können
extern void api_set_paused(bool paused);
extern void api_set_countdown_manual(uint32_t new_time_ms);
extern void api_increment_piece_counter();
extern void api_decrement_piece_counter();
extern void api_set_game_mode(int mode);
extern bool api_get_is_paused(); 
// NEU:
extern void api_reset_time();

// --- WEBSERVER & WEBSOCKET ---
static httpd_handle_t server = NULL;

#if !CONFIG_HTTPD_WS_SUPPORT
#error This example cannot be used unless HTTPD_WS_SUPPORT is enabled in esp-http-server component configuration
#endif

struct async_resp_arg {
    httpd_handle_t hd;
    int fd;
};

static const size_t max_clients = 4;

// --- BROADCAST FUNKTION (Wird von main.cpp aufgerufen) ---
void ws_broadcast(const char* str) {
    if (server == NULL) return;
    
    size_t clients = max_clients;
    int client_fds[max_clients];
    
    // Liste aller verbundenen Clients abrufen
    if (httpd_get_client_list(server, &clients, client_fds) == ESP_OK) {
        for (size_t i = 0; i < clients; ++i) {
            int sock = client_fds[i];
            
            // Prüfen, ob es ein WebSocket Client ist
            if (httpd_ws_get_fd_info(server, sock) == HTTPD_WS_CLIENT_WEBSOCKET) {
                httpd_ws_frame_t ws_pkt;
                memset(&ws_pkt, 0, sizeof(httpd_ws_frame_t));
                ws_pkt.final = true;
                ws_pkt.fragmented = false;
                ws_pkt.type = HTTPD_WS_TYPE_TEXT;
                ws_pkt.payload = (uint8_t*)str;
                ws_pkt.len = strlen(str);
                
                // Asynchron senden, um den Main-Loop nicht zu blockieren
                httpd_ws_send_frame_async(server, sock, &ws_pkt);
            }
        }
    }
}

// --- WEBSOCKET HANDLER (Empfängt Daten von JS) ---
static esp_err_t ws_handler(httpd_req_t *req)
{
    if (req->method == HTTP_GET) {
        ESP_LOGI(TAG, "Handshake done, new connection opened");
        return ESP_OK;
    }
    
    httpd_ws_frame_t ws_pkt;
    uint8_t *buf = NULL;
    memset(&ws_pkt, 0, sizeof(httpd_ws_frame_t));

    // 1. Länge abrufen
    esp_err_t ret = httpd_ws_recv_frame(req, &ws_pkt, 0);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "httpd_ws_recv_frame failed to get frame len with %d", ret);
        return ret;
    }
    
    // 2. Speicher reservieren und Daten lesen
    if (ws_pkt.len) {
        buf = (uint8_t*)calloc(1, ws_pkt.len + 1);
        if (buf == NULL) {
            ESP_LOGE(TAG, "Failed to calloc memory for buf");
            return ESP_ERR_NO_MEM;
        }
        ws_pkt.payload = buf;
        ret = httpd_ws_recv_frame(req, &ws_pkt, ws_pkt.len);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG, "httpd_ws_recv_frame failed with %d", ret);
            free(buf);
            return ret;
        }
    }

    // 3. Daten verarbeiten
    if (ws_pkt.type == HTTPD_WS_TYPE_TEXT) {
        ESP_LOGI(TAG, "Received packet: %s", ws_pkt.payload);
        
        // JSON Parsen
        cJSON *root = cJSON_Parse((char*)ws_pkt.payload);
        if (root != NULL) {
            cJSON *cmd = cJSON_GetObjectItem(root, "cmd");
            
            if (cJSON_IsString(cmd)) {
                // --- BEFEHLSVERARBEITUNG ---
                
                if (strcmp(cmd->valuestring, "toggle_pause") == 0) {
                    bool current = api_get_is_paused();
                    api_set_paused(!current);
                }
                else if (strcmp(cmd->valuestring, "set_mode") == 0) {
                    cJSON *val = cJSON_GetObjectItem(root, "val");
                    if (cJSON_IsNumber(val)) {
                        api_set_game_mode(val->valueint);
                    }
                }
                else if (strcmp(cmd->valuestring, "inc_moves") == 0) {
                    api_increment_piece_counter();
                }
                else if (strcmp(cmd->valuestring, "dec_moves") == 0) {
                    api_decrement_piece_counter();
                }
                else if (strcmp(cmd->valuestring, "set_time") == 0) {
                    cJSON *val = cJSON_GetObjectItem(root, "val");
                    if (cJSON_IsNumber(val)) {
                        api_set_countdown_manual((uint32_t)val->valueint);
                    }
                }
                // NEU: Reset Command
                else if (strcmp(cmd->valuestring, "reset_time") == 0) {
                    api_reset_time();
                }
            }
            cJSON_Delete(root);
        } else {
            ESP_LOGW(TAG, "Invalid JSON received");
        }
    } 
    else if (ws_pkt.type == HTTPD_WS_TYPE_PING) {
        // Ping -> Pong
        ws_pkt.type = HTTPD_WS_TYPE_PONG;
        httpd_ws_send_frame(req, &ws_pkt);
    }

    free(buf);
    return ESP_OK;
}

esp_err_t wss_open_fd(httpd_handle_t hd, int sockfd)
{
    ESP_LOGI(TAG, "New client connected %d", sockfd);
    wss_keep_alive_t h = (wss_keep_alive_t)httpd_get_global_user_ctx(hd);
    return wss_keep_alive_add_client(h, sockfd);
}

void wss_close_fd(httpd_handle_t hd, int sockfd)
{
    ESP_LOGI(TAG, "Client disconnected %d", sockfd);
    wss_keep_alive_t h = (wss_keep_alive_t)httpd_get_global_user_ctx(hd);
    wss_keep_alive_remove_client(h, sockfd);
}

static const httpd_uri_t ws = {
        .uri        = "/ws",
        .method     = HTTP_GET,
        .handler    = ws_handler,
        .user_ctx   = NULL,
        .is_websocket = true,
        .handle_ws_control_frames = true,
        .supported_subprotocol = NULL
};

// --- ENTFERNT: send_hello (wurde nicht genutzt und verursachte Warnung) ---

static void send_ping(void *arg)
{
    struct async_resp_arg *resp_arg = (struct async_resp_arg *)arg;
    httpd_handle_t hd = resp_arg->hd;
    int fd = resp_arg->fd;
    httpd_ws_frame_t ws_pkt;
    memset(&ws_pkt, 0, sizeof(httpd_ws_frame_t));
    ws_pkt.payload = NULL;
    ws_pkt.len = 0;
    ws_pkt.type = HTTPD_WS_TYPE_PING;

    httpd_ws_send_frame_async(hd, fd, &ws_pkt);
    free(resp_arg);
}

bool client_not_alive_cb(wss_keep_alive_t h, int fd)
{
    ESP_LOGE(TAG, "Client not alive, closing fd %d", fd);
    httpd_sess_trigger_close(wss_keep_alive_get_user_ctx(h), fd);
    return true;
}

bool check_client_alive_cb(wss_keep_alive_t h, int fd)
{
    struct async_resp_arg *resp_arg = (struct async_resp_arg *)malloc(sizeof(struct async_resp_arg));
    assert(resp_arg != NULL);
    resp_arg->hd = wss_keep_alive_get_user_ctx(h);
    resp_arg->fd = fd;

    if (httpd_queue_work(resp_arg->hd, send_ping, resp_arg) == ESP_OK) {
        return true;
    }
    return false;
}

// --- FILE HANDLERS ---
static esp_err_t index_handler(httpd_req_t *req) {
    httpd_resp_set_type(req, "text/html");
    extern const unsigned char main_html_start[] asm("_binary_main_html_start");
    extern const unsigned char main_html_end[] asm("_binary_main_html_end");
    const size_t main_html_size = (main_html_end - main_html_start);
    return httpd_resp_send(req, (const char *)main_html_start, main_html_size);
}

static esp_err_t style_handler(httpd_req_t *req) {
    ESP_LOGI(TAG, "Serving style.css"); // <--- DIESE ZEILE HINZUFÜGEN
    httpd_resp_set_type(req, "text/css");
    extern const unsigned char style_css_start[] asm("_binary_style_css_start");
    extern const unsigned char style_css_end[] asm("_binary_style_css_end");
    const size_t style_css_size = (style_css_end - style_css_start);
    return httpd_resp_send(req, (const char *)style_css_start, style_css_size);
}

static esp_err_t main_js_handler(httpd_req_t *req) {
    httpd_resp_set_type(req, "text/javascript");
    extern const unsigned char main_js_start[] asm("_binary_main_js_start");
    extern const unsigned char main_js_end[] asm("_binary_main_js_end");
    const size_t main_js_size = (main_js_end - main_js_start);
    return httpd_resp_send(req, (const char *)main_js_start, main_js_size);
}

static esp_err_t sun_moon_handler(httpd_req_t *req) {
    httpd_resp_set_type(req, "image/png");
    extern const unsigned char img_sun_moon_png_start[] asm("_binary_sun_moon_png_start");
    extern const unsigned char img_sun_moon_png_end[] asm("_binary_sun_moon_png_end");
    const size_t img_sun_moon_png_size = (img_sun_moon_png_end - img_sun_moon_png_start);
    return httpd_resp_send(req, (const char *)img_sun_moon_png_start, img_sun_moon_png_size);
}

// --- API HANDLERS (HIERHIN VERSCHOBEN) ---
static esp_err_t api_state_get_handler(httpd_req_t *req) {
    cJSON *root = cJSON_CreateObject();
    
    // Platzhalter-Werte (bitte später mit echten globalen Variablen ersetzen)
    cJSON_AddStringToObject(root, "mode", "A");
    cJSON_AddNumberToObject(root, "time", 60);
    cJSON_AddNumberToObject(root, "moves", 0);
    cJSON_AddBoolToObject(root, "running", false);

    const char *json_response = cJSON_PrintUnformatted(root);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_send(req, json_response, strlen(json_response));
    
    free((void*)json_response);
    cJSON_Delete(root);
    return ESP_OK;
}

// Favicon Handler (um 404 Fehler im Log zu vermeiden)
static esp_err_t favicon_handler(httpd_req_t *req) {
    httpd_resp_set_status(req, "204 No Content");
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
}


// --- SERVER START ---
static httpd_handle_t start_wss_echo_server(void)
{
    wss_keep_alive_config_t keep_alive_config = KEEP_ALIVE_CONFIG_DEFAULT();
    keep_alive_config.max_clients = max_clients;
    keep_alive_config.client_not_alive_cb = client_not_alive_cb;
    keep_alive_config.check_client_alive_cb = check_client_alive_cb;
    wss_keep_alive_t keep_alive = wss_keep_alive_start(&keep_alive_config);

    httpd_handle_t server = NULL;
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = 80;
    config.max_open_sockets = max_clients;
    
    config.global_user_ctx = keep_alive;
    config.open_fn = wss_open_fd;
    config.close_fn = wss_close_fd;
    
    config.max_uri_handlers = 12;

    if (httpd_start(&server, &config) != ESP_OK) {
        ESP_LOGI(TAG, "Error starting server!");
        return NULL;
    }

    wss_keep_alive_set_user_ctx(keep_alive, server);

    // URIs registrieren
    httpd_register_uri_handler(server, &ws);

    httpd_uri_t index_uri = { .uri = "/", .method = HTTP_GET, .handler = index_handler, .user_ctx = NULL };
    httpd_register_uri_handler(server, &index_uri);

    httpd_uri_t style_uri = { .uri = "/style.css", .method = HTTP_GET, .handler = style_handler, .user_ctx = NULL };
    httpd_register_uri_handler(server, &style_uri);

    httpd_uri_t script_uri = { .uri = "/main.js", .method = HTTP_GET, .handler = main_js_handler, .user_ctx = NULL };
    httpd_register_uri_handler(server, &script_uri);

    httpd_uri_t sun_moon_uri = { .uri = "/img/sun-moon.png", .method = HTTP_GET, .handler = sun_moon_handler, .user_ctx = NULL };
    httpd_register_uri_handler(server, &sun_moon_uri);

    // --- NEU: API & Favicon registrieren ---
    httpd_uri_t api_state_uri = { .uri = "/api/state", .method = HTTP_GET, .handler = api_state_get_handler, .user_ctx = NULL };
    httpd_register_uri_handler(server, &api_state_uri);

    httpd_uri_t favicon_uri = { .uri = "/favicon.ico", .method = HTTP_GET, .handler = favicon_handler, .user_ctx = NULL };
    httpd_register_uri_handler(server, &favicon_uri);
    // ---------------------------------------

    ESP_LOGI(TAG, "WebSocket server started successfully");
    return server;
}

// --- INIT ---
void init_webserver(void) {
    ESP_LOGI(TAG, "Webserver Init...");
    
    // WIEDER AKTIVIEREN: mDNS starten
    initialise_mdns(); 
    
    server = start_wss_echo_server();
    
    if (server == NULL) {
        ESP_LOGE(TAG, "Fehler beim Starten des Servers!");
        return;
    }
}

void send_json_to_clients(httpd_handle_t server, const char *json_str) {
    if (server == NULL) return;
    size_t clients = max_clients;
    int client_fds[max_clients];
    if (httpd_get_client_list(server, &clients, client_fds) == ESP_OK) {
        for (size_t i = 0; i < clients; ++i) {
            int sock = client_fds[i];
            if (httpd_ws_get_fd_info(server, sock) == HTTPD_WS_CLIENT_WEBSOCKET) {
                httpd_ws_frame_t ws_pkt = {
                    .final = true, .fragmented = false, .type = HTTPD_WS_TYPE_TEXT,
                    .payload = (uint8_t *)json_str, .len = strlen(json_str)
                };
                httpd_ws_send_frame_async(server, sock, &ws_pkt);
            }
        }
    }
}

httpd_handle_t get_webserver_handle(void) {
    return server;
}