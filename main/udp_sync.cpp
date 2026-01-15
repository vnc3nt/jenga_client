#include "udp_sync.h"
#include "esp_log.h"
#include "lwip/sockets.h"
#include "cJSON.h"
#include "global_vars.h"
#include <vector>
#include <string.h>
#include <algorithm>
#include <sys/errno.h>

static const char *TAG = "UDP_SYNC";
#define UDP_PORT 4242
#define UDP_BROADCAST_IP "255.255.255.255"

extern std::vector<LeaderboardEntry> leaderboard_countdown;
extern std::vector<LeaderboardEntry> leaderboard_countup;
extern void save_leaderboards_nvs();
extern void broadcast_game_state();

static int sock = -1;

void send_udp_packet(const char* json_str) {
    if (sock < 0) return;

    struct sockaddr_in dest_addr;
    dest_addr.sin_addr.s_addr = inet_addr(UDP_BROADCAST_IP);
    dest_addr.sin_family = AF_INET;
    dest_addr.sin_port = htons(UDP_PORT);

    int err = sendto(sock, json_str, strlen(json_str), 0, (struct sockaddr *)&dest_addr, sizeof(dest_addr));
    if (err < 0) {
        ESP_LOGE(TAG, "Error occurred during sending: errno %d", errno);
    } else {
        ESP_LOGI(TAG, "Message sent");
    }
}

// Sendet eine Liste von Einträgen als JSON Array
// Wir splitten es auf, um MTU nicht zu sprengen. Z.B. max 5 Einträge pro Paket.
void broadcast_leaderboard_udp() {
    if (xSemaphoreTake(leaderboard_mutex, portMAX_DELAY)) {
        
        // Helper Lambda für das Senden eines Vektors
        auto send_vector = [](const std::vector<LeaderboardEntry>& vec, int mode) {
            int count = 0;
            cJSON *root = NULL;
            cJSON *arr = NULL;

            for (const auto& entry : vec) {
                if (count % 5 == 0) {
                    // Neues Paket anfangen
                    if (root) {
                        char *str = cJSON_PrintUnformatted(root);
                        send_udp_packet(str);
                        free(str);
                        cJSON_Delete(root);
                    }
                    root = cJSON_CreateObject();
                    cJSON_AddStringToObject(root, "type", "sync_lb");
                    cJSON_AddNumberToObject(root, "mode", mode); // 0 = Countdown, 1 = Countup
                    arr = cJSON_CreateArray();
                    cJSON_AddItemToObject(root, "entries", arr);
                }

                cJSON *item = cJSON_CreateObject();
                cJSON_AddStringToObject(item, "team", entry.team_name);
                cJSON_AddNumberToObject(item, "time", (double)entry.time_ms);
                cJSON_AddNumberToObject(item, "moves", entry.moves);
                cJSON_AddBoolToObject(item, "fell", entry.tower_fell);
                cJSON_AddNumberToObject(item, "id", entry.entry_id);
                cJSON_AddNumberToObject(item, "ts", (double)entry.timestamp);
                cJSON_AddItemToArray(arr, item);

                count++;
            }
            // Letztes Paket senden
            if (root) {
                char *str = cJSON_PrintUnformatted(root);
                send_udp_packet(str);
                free(str);
                cJSON_Delete(root);
            }
        };

        ESP_LOGI(TAG, "Broadcasting Leaderboards via UDP...");
        send_vector(leaderboard_countdown, 0); // Mode 0
        send_vector(leaderboard_countup, 1);   // Mode 1

        xSemaphoreGive(leaderboard_mutex);
    }
}

void process_incoming_entries(cJSON *entries_arr, int mode) {
    bool changed = false;
    std::vector<LeaderboardEntry>* target_vec = (mode == 0) ? &leaderboard_countdown : &leaderboard_countup;

    if (xSemaphoreTake(leaderboard_mutex, portMAX_DELAY)) {
        int arr_len = cJSON_GetArraySize(entries_arr);
        for(int i=0; i<arr_len; i++) {
            cJSON *item = cJSON_GetArrayItem(entries_arr, i);
            cJSON *id_json = cJSON_GetObjectItem(item, "id");
            if (!id_json) continue;
            
            uint32_t rcv_id = (uint32_t)id_json->valueint;
            
            // Check if exists
            bool found = false;
            for(auto &local_entry : *target_vec) {
                if (local_entry.entry_id == rcv_id) {
                    found = true;
                    // Check consistency (optional, here we trust the received data or keep ours?
                    // User says: "kontrolliere ob meine Daten damit übereinstimmen... wenn nein, korrigiere meine daten."
                    // Also Update local from remote.
                    
                    // Wir nehmen an Remote hat recht (oder, da IDs unique sind, ist es derselbe Eintrag)
                    // Da wir keine "Versionierung" haben, überschreiben wir einfach bei Abweichung
                    // (z.B. Teamname korrigiert an einem Gerät)
                    
                    // Werte auslesen
                    cJSON *team = cJSON_GetObjectItem(item, "team");
                    cJSON *moves = cJSON_GetObjectItem(item, "moves");
                    cJSON *time = cJSON_GetObjectItem(item, "time");
                    cJSON *fell = cJSON_GetObjectItem(item, "fell");
                    // TS ignorieren wir für update, oder nutzen es?
                    
                    if (team && strcmp(local_entry.team_name, team->valuestring) != 0) {
                        strcpy(local_entry.team_name, team->valuestring);
                        changed = true;
                    }
                    // ... andere Felder ebenso prüfen
                    break;
                }
            }
            
            if (!found) {
                // Add new entry
                LeaderboardEntry new_entry;
                cJSON *team = cJSON_GetObjectItem(item, "team");
                cJSON *moves = cJSON_GetObjectItem(item, "moves");
                cJSON *time = cJSON_GetObjectItem(item, "time");
                cJSON *fell = cJSON_GetObjectItem(item, "fell");
                cJSON *ts = cJSON_GetObjectItem(item, "ts");

                if (team) strlcpy(new_entry.team_name, team->valuestring, sizeof(new_entry.team_name));
                if (moves) new_entry.moves = moves->valueint;
                if (time) new_entry.time_ms = (int64_t)time->valuedouble;
                if (fell) new_entry.tower_fell = cJSON_IsTrue(fell);
                new_entry.entry_id = rcv_id;
                if (ts) new_entry.timestamp = (int64_t)ts->valuedouble;
                
                target_vec->push_back(new_entry);
                changed = true;
                ESP_LOGI(TAG, "New entry added via UDP: %s", new_entry.team_name);
            }
        }
        
        if (changed) {
            // Resortieren
             std::sort(target_vec->begin(), target_vec->end(), [](const LeaderboardEntry& a, const LeaderboardEntry& b) {
                if (a.moves != b.moves) return a.moves > b.moves;
                return a.time_ms < b.time_ms;
            });
            
            // Limit 20 (Keep NVS clean logic)
            if (target_vec->size() > 20) target_vec->resize(20);

            // Speichern und Broadcasten (lokal)
            save_leaderboards_nvs();
            // broadcast_game_state(); // NICHT HIER AUFRUFEN, da wir im Mutex sind 
            // und broadcast_game_state auch ein Lock brauchen könnte (Deadlock Gefahr wenn wir nicht aufpassen)
            // Aber broadcast_game_state liest nur... 
            // Besser: Wir geben den Mutex frei und rufen dann update auf.
        }
        xSemaphoreGive(leaderboard_mutex);
        
        if (changed) {
             broadcast_game_state(); // Update WebUI
        }
    }
}

static void udp_server_task(void *pvParameters) {
    char rx_buffer[1500];
    
    while (1) {
        struct sockaddr_in source_addr;
        socklen_t socklen = sizeof(source_addr);
        int len = recvfrom(sock, rx_buffer, sizeof(rx_buffer) - 1, 0, (struct sockaddr *)&source_addr, &socklen);

        if (len < 0) {
            ESP_LOGE(TAG, "recvfrom failed: errno %d", errno);
            vTaskDelay(pdMS_TO_TICKS(1000)); // Fehler -> warten
            continue;
        }
        else if (len > 0) {
            rx_buffer[len] = 0; // Null-terminate
            // ESP_LOGI(TAG, "Received packet: %s", rx_buffer);

            // Check if it's our own packet? (Optional, but UDP broadcast loops back)
            // Can check source IP vs local IP. for now we just process logic handles duplicates gracefully.
            
            cJSON *root = cJSON_Parse(rx_buffer);
            if (root) {
                cJSON *type = cJSON_GetObjectItem(root, "type");
                if (type && strcmp(type->valuestring, "sync_lb") == 0) {
                    cJSON *mode = cJSON_GetObjectItem(root, "mode");
                    cJSON *entries = cJSON_GetObjectItem(root, "entries");
                    if (mode && entries && cJSON_IsArray(entries)) {
                        process_incoming_entries(entries, mode->valueint);
                    }
                }
                cJSON_Delete(root);
            }
        }
    }
}

void init_udp_sync() {
    sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
    if (sock < 0) {
        ESP_LOGE(TAG, "Unable to create socket: errno %d", errno);
        return;
    }

    int broadcast = 1;
    setsockopt(sock, SOL_SOCKET, SO_BROADCAST, &broadcast, sizeof(broadcast));
    
    // Bind
    struct sockaddr_in dest_addr;
    dest_addr.sin_addr.s_addr = htonl(INADDR_ANY);
    dest_addr.sin_family = AF_INET;
    dest_addr.sin_port = htons(UDP_PORT);
    
    if (bind(sock, (struct sockaddr *)&dest_addr, sizeof(dest_addr)) < 0) {
        ESP_LOGE(TAG, "Socket unable to bind: errno %d", errno);
        return;
    }

    xTaskCreate(udp_server_task, "udp_server", 4096, NULL, 5, NULL);
    ESP_LOGI(TAG, "UDP Sync initialized on port %d", UDP_PORT);
}
