#ifndef GLOBAL_VARS_H
    #define GLOBAL_VARS_H
    #include "freertos/FreeRTOS.h"
    #include "freertos/semphr.h"
    #include "driver/gpio.h"

    const gpio_num_t POWER_LED_PIN = GPIO_NUM_21;

    extern uint32_t max_time;
    extern bool is_game_paused;
    
    // Globaler Mutex für Leaderboard Zugriff
    extern SemaphoreHandle_t leaderboard_mutex;

    // Leaderboard Entry Struktur (damit sie überall gleich ist)
    #include <stdint.h>
    struct LeaderboardEntry {
        char team_name[32];
        int64_t time_ms;
        int moves;
        bool tower_fell;
        uint32_t entry_id; // Unique ID (Random)
        int64_t timestamp; // Zeitstempel (Uptime in ms bei Erstellung)
    };

#endif