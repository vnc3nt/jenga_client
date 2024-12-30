idf_component_register(
    SRCS "main.c" "webserver.c" "keep_alive.c"
    INCLUDE_DIRS "."
    PRIV_REQUIRES esp_https_server nvs_flash esp_timer esp_netif esp_eth esp_wifi mdns
    REQUIRES driver json
    EMBED_FILES "../html/index.html"
               "../html/style.css"
               "../html/script.js"
    EMBED_TXTFILES "certs/servercert.pem"
                    "certs/prvtkey.pem"
                    
)

