#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// Versucht, sich mit dem gespeicherten WiFi zu verbinden.
// Gibt true zurück, wenn erfolgreich, sonst false.
bool connect_saved_wifi(void);

// Startet den Access Point "ESP Configuration WIFI"
void start_config_wifi(void);

// Stoppt WiFi (falls nötig)
void stop_config_wifi(void);

#ifdef __cplusplus
}
#endif