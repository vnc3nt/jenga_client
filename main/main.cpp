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
const gpio_num_t ROBOT_PIN = GPIO_NUM_14;
//const gpio_num_t POWER_LED_PIN = GPIO_NUM_21; in global_vars.h

#define LONG_PRESS_TIME 3000 // 3 Sekunden
bool still_startup_holding = true;
bool is_in_config_mode = false;

// --- NEUE SPIEL VARIABLEN ---
enum GameMode { MODE_A_COUNTDOWN, MODE_B_COUNTUP };
GameMode current_game_mode = MODE_A_COUNTDOWN;

volatile int piece_counter = 0;
volatile int64_t time_countdown = 0; // in Millisekunden (int64 für einfache Berechnung)
volatile int64_t time_countup = 0;   // in Millisekunden
volatile bool is_paused = true;      // Startet pausiert
uint32_t countdown_start_value = 5 * 60 * 1000; // Standard 5 Minuten

// Hilfsvariablen für Flankenerkennung
bool last_robot_pin_state = false;


httpd_handle_t server_handle = NULL;

void initialize_gpios() {
    //GPIOs
    gpio_reset_pin(PAUSE_LED_PIN);
    gpio_reset_pin(CONNECTION_LED_PIN);
    gpio_reset_pin(POWER_LED_PIN);
    gpio_reset_pin(PAUSE_PIN);
    gpio_reset_pin(ROBOT_PIN);

    // Als Output setzen
    gpio_set_direction(PAUSE_LED_PIN, GPIO_MODE_OUTPUT);
    gpio_set_direction(POWER_LED_PIN, GPIO_MODE_OUTPUT);
    gpio_set_direction(CONNECTION_LED_PIN, GPIO_MODE_OUTPUT);
    
    // Als Input setzen (mit Pullup, da wir auf LOW prüfen)
    gpio_set_direction(PAUSE_PIN, GPIO_MODE_INPUT);
    gpio_set_pull_mode(PAUSE_PIN, GPIO_PULLUP_ONLY);

    // Robot Pin als Input (High-Aktiv -> Pulldown, um Floating zu vermeiden)
    gpio_set_direction(ROBOT_PIN, GPIO_MODE_INPUT);
    gpio_set_pull_mode(ROBOT_PIN, GPIO_PULLDOWN_ONLY);

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

// --- NVS FUNKTIONEN (Angepasst) ---

// Zum Speichern der Countdown-Startzeit
void save_countdown_start(uint32_t time_ms) {
    ESP_LOGI(TAG, "Speichere Countdown Startzeit: %lu ms", time_ms);
    nvs_handle_t my_handle;
    esp_err_t err = nvs_open("storage", NVS_READWRITE, &my_handle);
    if (err != ESP_OK) return;
    
    err = nvs_set_u32(my_handle, "cd_start", time_ms);
    err = nvs_commit(my_handle);
    nvs_close(my_handle);
}

// Zum Laden der Countdown-Startzeit
uint32_t load_countdown_start(uint32_t default_value) {
    nvs_handle_t my_handle;
    esp_err_t err = nvs_open("storage", NVS_READONLY, &my_handle);
    if (err != ESP_OK) return default_value;
    
    uint32_t val;
    err = nvs_get_u32(my_handle, "cd_start", &val);
    if (err != ESP_OK) val = default_value;
    
    nvs_close(my_handle);
    ESP_LOGI(TAG, "Lade Countdown Startzeit: %lu ms", val);
    return val;
}

// --- API FÜR WEBSERVER (Vorbereitung) ---

void api_set_paused(bool paused) {
    if (is_paused != paused) {
        is_paused = paused;
        ESP_LOGI(TAG, "API: Pause Status geändert auf: %s", is_paused ? "PAUSIERT" : "LAUFEND");
    }
}

void api_set_countdown_manual(uint32_t new_time_ms) {
    // Überschreibt Dauerspeicher und aktuelle Zeit
    save_countdown_start(new_time_ms);
    countdown_start_value = new_time_ms;
    time_countdown = new_time_ms;
    ESP_LOGI(TAG, "API: Countdown manuell gesetzt auf: %lu ms", new_time_ms);
}

void api_increment_piece_counter() {
    piece_counter++;
    ESP_LOGI(TAG, "API: Stückzähler inkrementiert auf: %d", piece_counter);
}

void api_decrement_piece_counter() {
    // HIER: Sicherheitsabfrage hinzufügen
    if (piece_counter > 0) {
        piece_counter--;
        ESP_LOGI(TAG, "API: Stückzähler dekrementiert auf: %d", piece_counter);
    } else {
        ESP_LOGW(TAG, "API: Dekrementierung ignoriert, Counter ist bereits 0");
    }
}

// API um den Spielmodus zu setzen
void api_set_game_mode(int mode) {
    if (mode == 0) {
        current_game_mode = MODE_A_COUNTDOWN;
        ESP_LOGI(TAG, "API: Modus auf COUNTDOWN (A) gesetzt");
    } else {
        current_game_mode = MODE_B_COUNTUP;
        ESP_LOGI(TAG, "API: Modus auf COUNTUP (B) gesetzt");
    }
}

// NEU: API um Zeit zurückzusetzen
void api_reset_time() {
    // 1. Züge immer zurücksetzen
    piece_counter = 0;
    ESP_LOGI(TAG, "API: Züge auf 0 zurückgesetzt");

    // 2. Zeit je nach Modus zurücksetzen
    if (current_game_mode == MODE_A_COUNTDOWN) {
        time_countdown = countdown_start_value;
        ESP_LOGI(TAG, "API: Zeit Reset (Countdown) auf %lu ms", countdown_start_value);
    } else {
        time_countup = 0;
        ESP_LOGI(TAG, "API: Zeit Reset (Countup) auf 0 ms");
    }
}

// Getter Funktionen (können vom Webserver genutzt werden)
int api_get_piece_counter() { return piece_counter; }
int64_t api_get_time_countdown() { return time_countdown; }
int64_t api_get_time_countup() { return time_countup; }
bool api_get_is_paused() { return is_paused; }
int api_get_game_mode() { return (int)current_game_mode; }


// --- LOGIK FUNKTIONEN ---

void toggle_pause() {
    is_paused = !is_paused;
    ESP_LOGI(TAG, "Spielstatus geändert: %s", is_paused ? "PAUSIERT" : "LAUFEND");
    
    // LED Logik sofort aktualisieren
    if (is_paused) {
        gpio_set_level(PAUSE_LED_PIN, 1); // An wenn pausiert
    } else {
        gpio_set_level(PAUSE_LED_PIN, 0); // Aus wenn läuft
    }
}

// Erweiterte Button Logik (Kurz = Pause, Lang = Shutdown)
void handle_button_logic() {
    if (still_startup_holding) return;
    
    static uint64_t press_start = 0;
    static bool last_state = 1; // Pullup -> 1 ist losgelassen
    bool current_state = gpio_get_level(PAUSE_PIN);

    // Flankenerkennung: Drücken (1 -> 0)
    if (last_state == 1 && current_state == 0) {
        press_start = esp_timer_get_time() / 1000; // ms
    }
    // Halten (0 -> 0)
    else if (last_state == 0 && current_state == 0) {
        if ((esp_timer_get_time() / 1000) - press_start > LONG_PRESS_TIME) {
            ESP_LOGI(TAG, "Long press detected -> Shutdown");
            shutdown_esp();
        }
    }
    // Loslassen (0 -> 1)
    else if (last_state == 0 && current_state == 1) {
        uint64_t press_duration = (esp_timer_get_time() / 1000) - press_start;
        if (press_duration < LONG_PRESS_TIME && press_duration > 50) { // >50ms debounce
            toggle_pause();
        }
        press_start = 0;
    }
    last_state = current_state;
}

// --- NEUE FUNKTION: Status senden ---
void broadcast_game_state() {
    cJSON *root = cJSON_CreateObject();
    
    // 1. Modus
    cJSON_AddNumberToObject(root, "mode", (int)current_game_mode);
    
    // 2. Zeiten
    cJSON_AddNumberToObject(root, "time_countdown", (double)time_countdown);
    cJSON_AddNumberToObject(root, "time_countup", (double)time_countup);
    cJSON_AddNumberToObject(root, "countdown_start", (double)countdown_start_value);
    
    // 3. Status
    cJSON_AddBoolToObject(root, "is_paused", is_paused);
    
    // 4. Counter
    cJSON_AddNumberToObject(root, "piece_counter", piece_counter);

    // JSON String erstellen
    char *json_str = cJSON_PrintUnformatted(root);
    
    // Senden (Funktion muss in webserver.cpp implementiert sein!)
    if (json_str != NULL) {
        ws_broadcast(json_str);
        free(json_str); // WICHTIG: Speicher freigeben
    }
    
    cJSON_Delete(root);
}

// --- MAIN ---

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

extern "C" void app_main(void) {
    // Optional: Warten auf Serial Monitor
    // vTaskDelay(pdMS_TO_TICKS(2000)); 

    ESP_LOGI(TAG, "--- START ESP ---");

    // initialisation
    init_nvs();
    
    // Lade gespeicherte Zeit
    countdown_start_value = load_countdown_start(5 * 60 * 1000); // Default 5 min
    time_countdown = countdown_start_value;
    time_countup = 0;
    
    // 2. WICHTIG: Netzwerk-Stack NUR HIER EINMAL initialisieren
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    // Interfaces erstellen wir hier, damit sie global verfügbar sind
    esp_netif_create_default_wifi_sta();
    esp_netif_create_default_wifi_ap();

    // 3. GPIOs
    gpio_install_isr_service(0);
    initialize_gpios();
    
    // Initialer LED Status (Pausiert -> LED AN)
    gpio_set_level(PAUSE_LED_PIN, 1);

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
    int64_t last_loop_time = esp_timer_get_time();
    int pulse_counter = 0;
    
    // Timer für WebSocket Broadcast (z.B. alle 200ms)
    int64_t ws_timer = 0; 

    ESP_LOGI(TAG, "Starte Game Loop. Modus A (Countdown). Zeit: %lld ms", time_countdown);

    while(1) {
        if (is_in_config_mode) {
            // Im Konfigurationsmodus: Schnelles Blinken
            led_state = !led_state;
            gpio_set_level(CONNECTION_LED_PIN, led_state);
            vTaskDelay(pdMS_TO_TICKS(100));
        }
        else {
            // Im Spielmodus
            
            // 1. Zeitberechnung (Delta Time)
            int64_t current_time = esp_timer_get_time();
            int64_t delta_us = current_time - last_loop_time;
            last_loop_time = current_time;
            int64_t delta_ms = delta_us / 1000;

            // --- HINZUFÜGEN: WebSocket Broadcast Timer ---
            ws_timer += delta_ms;
            if (ws_timer >= 250) { // Alle 250ms Update an Webseite senden
                broadcast_game_state();
                ws_timer = 0;
            }
            // ---------------------------------------------

            // 2. Button Logik (Pause / Shutdown)
            handle_button_logic();
            
            // 3. Spiel Logik (nur wenn nicht pausiert)
            if (!is_paused) {
                
                // --- MODUS A: COUNTDOWN ---
                if (current_game_mode == MODE_A_COUNTDOWN) {
                    // Zeit Update
                    if (time_countdown > 0) {
                        time_countdown -= delta_ms;
                        if (time_countdown < 0) time_countdown = 0;
                    }

                    // LED Status: Wenn Countdown abgelaufen -> Pulsieren
                    if (time_countdown <= 0) {
                        pulse_counter += delta_ms;
                        if (pulse_counter > 200) { // Schnelles Blinken (Pulsieren)
                            led_state = !led_state;
                            gpio_set_level(PAUSE_LED_PIN, led_state);
                            pulse_counter = 0;
                        }
                    } else {
                        gpio_set_level(PAUSE_LED_PIN, 0); // LED Aus (Spiel läuft)
                    }
                }
                // --- MODUS B: COUNTUP ---
                else if (current_game_mode == MODE_B_COUNTUP) {
                    // Zeit Update
                    time_countup += delta_ms;
                    
                    // LED Status: Einfach aus, da Spiel läuft
                    gpio_set_level(PAUSE_LED_PIN, 0);
                }

                // Roboter Signal Erkennung (Rising Edge) - Modus unabhängig
                bool robot_signal = gpio_get_level(ROBOT_PIN);
                if (robot_signal && !last_robot_pin_state) {
                    piece_counter++;
                    ESP_LOGI(TAG, "ROBOT SIGNAL! Piece Counter: %d", piece_counter);
                }
                last_robot_pin_state = robot_signal;

            } else {
                // Wenn Pausiert -> LED AN (Dauerhaft)
                gpio_set_level(PAUSE_LED_PIN, 1);
            }

            // Debug Ausgabe (optional, z.B. alle 5 Sekunden um Log nicht zu fluten)
            static int64_t log_timer = 0;
            log_timer += delta_ms;
            if (log_timer > 5000) {
                ESP_LOGI(TAG, "Status: %s | Mode: %s | CD: %lld ms | CU: %lld ms | Pieces: %d", 
                         is_paused ? "PAUSE" : "RUN", 
                         (current_game_mode == MODE_A_COUNTDOWN) ? "A (Down)" : "B (Up)",
                         time_countdown, time_countup, piece_counter);
                log_timer = 0;
            }

            // WICHTIG: Kurze Pause, damit der Watchdog nicht zuschlägt und andere Tasks laufen können
            vTaskDelay(pdMS_TO_TICKS(10));
        }   
    }
}

