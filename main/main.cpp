#include "webserver.h"
#include "config_wifi.h"
#include <stdio.h>
#include <inttypes.h>
#include "sdkconfig.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_random.h"
#include <esp_log.h>
#include <cJSON.h>
#include <esp_sleep.h>
#include "esp_netif.h"
#include "esp_event.h"
#include "esp_wifi.h"

#include "global_vars.h"
#include "nvs_flash.h"
#include "nvs.h"

static const char *TAG = "MAIN"; // Tag für Logs

// Pin Definitionen
const gpio_num_t PAUSE_PIN = GPIO_NUM_42;
const gpio_num_t CONNECTION_LED_PIN = GPIO_NUM_2;
const gpio_num_t PAUSE_LED_PIN = GPIO_NUM_3;
//const gpio_num_t POWER_LED_PIN = GPIO_NUM_21; in global_vars.h

#define LONG_PRESS_TIME 3000 // 3 Sekunden
bool still_startup_holding = true;
bool is_in_config_mode = false;

// Globale Variable für den Pause-Status
static volatile uint8_t pause_event = 0;  // 0 = kein Event, 1 = Resume, 2 = Pause

httpd_handle_t server_handle = NULL;

void initialize_gpios() {
    //GPIOs
    gpio_reset_pin(PAUSE_LED_PIN);
    gpio_reset_pin(CONNECTION_LED_PIN);
    gpio_reset_pin(POWER_LED_PIN);
    gpio_reset_pin(PAUSE_PIN);
    // Als Output setzen
    gpio_set_direction(PAUSE_LED_PIN, GPIO_MODE_OUTPUT);
    gpio_set_direction(POWER_LED_PIN, GPIO_MODE_OUTPUT);
    gpio_set_direction(CONNECTION_LED_PIN, GPIO_MODE_OUTPUT);
    // Als Input setzen (mit Pullup, da wir auf LOW prüfen)
    gpio_set_direction(PAUSE_PIN, GPIO_MODE_INPUT);
    gpio_set_pull_mode(PAUSE_PIN, GPIO_PULLUP_ONLY);

    gpio_set_level(POWER_LED_PIN, 1); // Power-LED an
}

void start_config_mode() {
    is_in_config_mode = true;
    ESP_LOGI(TAG, "Konfigurationsmodus aktiviert!");
    start_config_wifi();
}

void stop_config_mode() {
    is_in_config_mode = false;
    ESP_LOGI(TAG, "Konfigurationsmodus deaktiviert!");
    stop_config_wifi();
}

void shutdown_esp() {
  ESP_LOGW(TAG, "Shutdown eingeleitet...");
  if (server_handle != NULL) {
    httpd_stop(server_handle);
  }
  
  // Konfigurieren Sie den Aufwach-Mechanismus
  esp_sleep_enable_ext0_wakeup(PAUSE_PIN, 0); // Aufwachen bei LOW-Signal
  
  gpio_set_level(POWER_LED_PIN, 0); // Power-LED aus

  while (gpio_get_level(PAUSE_PIN) == 0)
    {
        vTaskDelay(pdMS_TO_TICKS(10));
    }

  // Gehen Sie in den Deep-Sleep-Modus
  esp_deep_sleep_start();
}

void check_long_press() {
    if (still_startup_holding) return;
    static uint64_t press_start = 0;
    if (gpio_get_level(PAUSE_PIN) == 0) { 
        if (press_start == 0) {
            press_start = esp_timer_get_time() / 1000;
        } else if ((esp_timer_get_time() / 1000) - press_start > LONG_PRESS_TIME) {
            ESP_LOGI(TAG, "Long press detected -> Shutdown");
            shutdown_esp();
        }
    } else {
        press_start = 0;
    }
}






// Initialisierung des NVS-Speichers
esp_err_t init_nvs() {
    ESP_LOGI(TAG, "Initialisiere NVS...");
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
    return ret;
}

// Zum Speichern von Daten
void save_max_time(uint32_t max_time) {
    printf("save_max_time\n");
    nvs_handle_t my_handle;
    esp_err_t err = nvs_open("storage", NVS_READWRITE, &my_handle);
    if (err != ESP_OK) {
        // Fehlerbehandlung
        printf("Fehler bei save_max_time nvs_open\n");
        return;
    }
    err = nvs_set_u32(my_handle, "max_time", max_time);
    if (err != ESP_OK) {
        // Fehlerbehandlung
        printf("Fehler bei save_max_time nvs_set_u32\n");
    }
    err = nvs_commit(my_handle);
    if (err != ESP_OK) {
        // Fehlerbehandlung
        printf("Fehler bei save_max_time nvs_commit\n");
    }
    nvs_close(my_handle);
}

// Zum Lesen von Daten
uint32_t load_max_time(uint32_t default_value) {
    printf("load_max_time\n");
    nvs_handle_t my_handle;
    esp_err_t err = nvs_open("storage", NVS_READONLY, &my_handle);
    if (err != ESP_OK) {
        printf("Fehler bei load_max_time nvs_open\n");
        return default_value;
    }
    uint32_t max_time;
    err = nvs_get_u32(my_handle, "max_time", &max_time);
    if (err != ESP_OK) {
        printf("Fehler bei load_max_time nvs_get_u32\n");
        max_time = default_value;
    }
    nvs_close(my_handle);
    return max_time;
}



extern "C" void app_main(void) {
    // Optional: Warten auf Serial Monitor
    // vTaskDelay(pdMS_TO_TICKS(2000)); 

    ESP_LOGI(TAG, "--- START ESP ---");

    // initialisation
    init_nvs();
    
    // 2. WICHTIG: Netzwerk-Stack NUR HIER EINMAL initialisieren
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    // Interfaces erstellen wir hier, damit sie global verfügbar sind
    esp_netif_create_default_wifi_sta();
    esp_netif_create_default_wifi_ap();

    // 3. GPIOs
    gpio_install_isr_service(0);
    initialize_gpios();
    
    // 1. STARTUP LOGIK: Prüfen ob Knopf gehalten wird
    if (gpio_get_level(PAUSE_PIN) == 0) {
        ESP_LOGI(TAG, "Knopf gedrückt. Prüfe auf 3s Halten...");
        int hold_counter = 0;
        while (gpio_get_level(PAUSE_PIN) == 0 && hold_counter < 3000) {
            vTaskDelay(pdMS_TO_TICKS(10));
            hold_counter += 10;
        }

        if (hold_counter >= 3000) {
            ESP_LOGI(TAG, "Knopf > 3s gehalten -> Config Modus.");
            start_config_mode();
            while(gpio_get_level(PAUSE_PIN) == 0) vTaskDelay(pdMS_TO_TICKS(10));
        } else {
            ESP_LOGI(TAG, "Knopf losgelassen. Normaler Start.");
        }
    }
    still_startup_holding = false;

    // 5. VERBINDUNGSAUFBAU
    if (!is_in_config_mode) {
        ESP_LOGI(TAG, "Versuche Verbindung mit gespeichertem WiFi...");
        if (connect_saved_wifi()) {
            ESP_LOGI(TAG, "Erfolgreich verbunden! Starte Webserver...");
            init_webserver(); // Webserver starten!
        } else {
            ESP_LOGW(TAG, "Verbindung fehlgeschlagen. Starte Config Modus.");
            start_config_mode();
        }
    }

    // 6. MAIN LOOP
    bool led_state = false;
    while(1) {
        if (is_in_config_mode) {
            // Im Konfigurationsmodus: Schnelles Blinken
            led_state = !led_state;
            gpio_set_level(CONNECTION_LED_PIN, led_state);
            vTaskDelay(pdMS_TO_TICKS(100));
        }
        else {
            // Im Spielmodus
            check_long_press(); // Prüft auf Shutdown
            vTaskDelay(pdMS_TO_TICKS(50));
        }   
    }
}

