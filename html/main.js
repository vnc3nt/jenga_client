document.addEventListener('DOMContentLoaded', () => {
    
    // --- STATE ---
    let gameState = {
        time: 60,
        maxTime: 60,
        mode: 'countdown', // 'countdown' oder 'countup'
        isPlaying: false,
        moves: 0,
        leaderboard: []
    };

    let isDark = false;

    // --- DOM ELEMENTS ---
    // Pages
    const mainPage = document.getElementById('mainPage');
    const configPage = document.getElementById('configPage');
    
    // Navigation
    const settingsBtn = document.getElementById('settingsBtn');
    const backBtn = document.getElementById('backBtn');
    
    // Theme
    const themeToggle = document.getElementById('themeToggle');
    const themeToggleConfig = document.getElementById('themeToggleConfig');
    
    // Game Controls
    const modeToggle = document.getElementById('modeToggle'); 
    const timeDisplay = document.getElementById('timeDisplay');
    
    // NEU: Reset Button
    const resetBtn = document.getElementById('resetBtn');

    const playPauseBtn = document.getElementById('playPauseBtn');
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    const playPauseText = document.getElementById('playPauseText');
    const progressFill = document.getElementById('progressFill');
    
    // Counter
    const counterValue = document.getElementById('counterValue');
    const incrementBtn = document.getElementById('incrementBtn');
    const decrementBtn = document.getElementById('decrementBtn');

    // Modal
    const timeModal = document.getElementById('timeModal');
    const modalTimeInput = document.getElementById('modalTimeInput');
    const modalSaveBtn = document.getElementById('modalSaveBtn');
    const modalCancelBtn = document.getElementById('modalCancelBtn');

    // --- NAVIGATION & THEME ---

    function switchPage(page) {
        if (page === 'config') {
            mainPage.classList.add('hidden');
            configPage.classList.remove('hidden');
        } else {
            configPage.classList.add('hidden');
            mainPage.classList.remove('hidden');
        }
    }

    function toggleTheme() {
        isDark = !isDark;
        document.body.classList.toggle('dark', isDark);
    }

    settingsBtn.addEventListener('click', () => switchPage('config'));
    backBtn.addEventListener('click', () => switchPage('main'));
    themeToggle.addEventListener('click', toggleTheme);
    themeToggleConfig.addEventListener('click', toggleTheme);

    // --- GAME LOGIC ---

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    function updateUI() {
        // Time
        timeDisplay.textContent = formatTime(gameState.time);
        
        // Progress Bar (Nur bei Countdown sinnvoll)
        if (gameState.mode === 'countdown' && gameState.maxTime > 0) {
            const percentage = (gameState.time / gameState.maxTime) * 100;
            progressFill.style.width = `${percentage}%`;
        } else {
            progressFill.style.width = '100%';
        }

        // Play/Pause Button Text/Icon Update
        if (gameState.isPlaying) {
            playIcon.classList.add('hidden');
            pauseIcon.classList.remove('hidden');
            playPauseText.textContent = 'Pause';
            
            // NEU: Reset Button deaktivieren wenn Spiel läuft
            if (resetBtn) resetBtn.disabled = true;
        } else {
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
            playPauseText.textContent = 'Play';
            
            // NEU: Reset Button aktivieren wenn pausiert
            if (resetBtn) resetBtn.disabled = false;
        }

        // Counter
        counterValue.textContent = gameState.moves;
        decrementBtn.disabled = gameState.moves <= 0;

        // Mode Toggle (Checkbox Status synchronisieren)
        // Checked = Count Up, Unchecked = Countdown
        if (modeToggle) {
            // Verhindern, dass das Event erneut gefeuert wird, wenn wir es programmgesteuert setzen
            // Wir prüfen, ob der Status tatsächlich anders ist
            const shouldBeChecked = (gameState.mode === 'countup');
            if (modeToggle.checked !== shouldBeChecked) {
                modeToggle.checked = shouldBeChecked;
            }
        }
    }

    // --- API / WEBSOCKET ---
    
    let socket;

    function initWebSocket() {
        // WebSocket Verbindung zum ESP32 aufbauen
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = protocol + '//' + window.location.hostname + '/ws';
        
        console.log("Connecting to WebSocket at:", wsUrl);
        socket = new WebSocket(wsUrl);
        
        socket.onopen = function() {
            console.log('WebSocket connected');
        };

        socket.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                console.log("Received WS Data:", data); // Debugging: Zeigt an, was wirklich ankommt

                // --- STATE SYNC FROM C++ ---
                
                // 1. Game Mode (0 = Countdown, 1 = Countup)
                if (typeof data.mode !== 'undefined') {
                    gameState.mode = (data.mode === 1) ? 'countup' : 'countdown';
                }
                
                // 2. Time (Defensive Programmierung gegen NaN)
                let timeMs = 0;
                let receivedTime = null;

                if (gameState.mode === 'countdown') {
                    receivedTime = data.time_countdown;
                } else {
                    receivedTime = data.time_countup;
                }

                // Nur aktualisieren, wenn ein gültiger Wert gesendet wurde
                if (typeof receivedTime === 'number' && !isNaN(receivedTime)) {
                    gameState.time = Math.floor(receivedTime / 1000);
                }
                
                // 3. Paused Status
                if (typeof data.is_paused !== 'undefined') {
                    gameState.isPlaying = !data.is_paused;
                }
                
                // 4. Moves / Piece Counter
                if (typeof data.piece_counter !== 'undefined') {
                    gameState.moves = data.piece_counter;
                }
                
                // 5. Max Time (für Progress Bar)
                if (typeof data.countdown_start !== 'undefined') {
                    gameState.maxTime = Math.floor(data.countdown_start / 1000);
                }

                updateUI();
            } catch (e) {
                console.error('Error parsing WS message', e);
            }
        };

        socket.onclose = function() {
            console.log('WebSocket disconnected, retrying...');
            setTimeout(initWebSocket, 2000);
        };
        
        socket.onerror = function(err) {
            console.error('WebSocket Error:', err);
        };
    }

    async function sendCommand(command, value = null) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            console.warn("WebSocket not connected");
            return;
        }
        
        let payload = {};
        
        // Mapping JS Commands -> C++ API Logic
        switch (command) {
            case 'toggle_pause':
                // C++: api_set_paused(...)
                // Wir senden einfach den Toggle-Befehl, Backend entscheidet
                payload = { cmd: 'toggle_pause' }; 
                break;
                
            case 'set_mode':
                // C++: api_set_game_mode(int mode)
                // value: 'countdown' -> 0, 'countup' -> 1
                payload = { cmd: 'set_mode', val: (value === 'countup' ? 1 : 0) };
                break;
                
            case 'adjust_moves':
                // C++: api_increment_piece_counter() / api_decrement_piece_counter()
                // Da C++ atomare Operationen (++) nutzt, ist es sicher, inkrement/dekrement zu senden
                // statt absoluter Werte, um Race Conditions mit dem Roboter-Signal zu minimieren.
                payload = { cmd: (value > 0 ? 'inc_moves' : 'dec_moves') };
                break;
                
            case 'set_time':
                // C++: api_set_countdown_manual(uint32_t new_time_ms)
                // value ist in Sekunden -> Umrechnung in ms
                payload = { cmd: 'set_time', val: value * 1000 };
                break;

            // NEU: Reset Command
            case 'reset_time':
                payload = { cmd: 'reset_time' };
                break;
        }
        
        console.log('Sending WS:', payload);
        socket.send(JSON.stringify(payload));
    }

    // --- EVENT LISTENERS ---

    // NEU: Reset Button Listener
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            // Nur senden, wenn nicht gespielt wird (doppelte Sicherheit)
            if (!gameState.isPlaying) {
                sendCommand('reset_time');
            }
        });
    }

    // Mode Switch
    modeToggle.addEventListener('change', (e) => {
        // UI Optimistisch updaten, aber auf Server warten für Bestätigung
        const newMode = e.target.checked ? 'countup' : 'countdown';
        // gameState.mode = newMode; // Warten auf Server-Update via WS
        sendCommand('set_mode', newMode);
    });

    // Play/Pause
    playPauseBtn.addEventListener('click', () => {
        // gameState.isPlaying = !gameState.isPlaying; // Warten auf Server-Update via WS
        sendCommand('toggle_pause');
    });

    // Counter
    incrementBtn.addEventListener('click', () => {
        // gameState.moves++; // Warten auf Server-Update via WS
        sendCommand('adjust_moves', 1);
    });

    decrementBtn.addEventListener('click', () => {
        if (gameState.moves > 0) {
            // gameState.moves--; // Warten auf Server-Update via WS
            sendCommand('adjust_moves', -1);
        }
    });

    // Time Edit Modal
    timeDisplay.addEventListener('click', () => {
        // Nur bearbeiten erlauben, wenn pausiert (optional, aber sicherer)
        if (!gameState.isPlaying) {
            modalTimeInput.value = gameState.maxTime;
            timeModal.classList.add('active');
            modalTimeInput.focus();
        }
    });

    modalCancelBtn.addEventListener('click', () => {
        timeModal.classList.remove('active');
    });

    modalSaveBtn.addEventListener('click', () => {
        const newTime = parseInt(modalTimeInput.value);
        if (newTime > 0) {
            // Wir senden den Befehl an den ESP32. 
            // Der ESP32 aktualisiert dann seinen State und schickt via WS die neuen Daten zurück.
            sendCommand('set_time', newTime);
            timeModal.classList.remove('active');
        }
    });

    // Schließen des Modals bei Klick auf Hintergrund
    timeModal.addEventListener('click', (e) => {
        if (e.target === timeModal) {
            timeModal.classList.remove('active');
        }
    });

    // --- INITIALIZATION ---
    
    // 1. UI einmal initial updaten, damit "60:00" statt leer oder Fehler zu sehen ist
    updateUI();

    // 2. WebSocket starten
    initWebSocket();
});