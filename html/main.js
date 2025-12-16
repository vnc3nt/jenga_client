document.addEventListener('DOMContentLoaded', () => {
    
    // --- STATE ---
    let gameState = {
        time: 60,
        maxTime: 60,
        mode: 'countdown', 
        isPlaying: false,
        moves: 0,
        leaderboard: []
    };

    let isDark = false;

    // --- DOM ELEMENTS ---
    const mainPage = document.getElementById('mainPage');
    const configPage = document.getElementById('configPage');
    const settingsBtn = document.getElementById('settingsBtn');
    const backBtn = document.getElementById('backBtn');
    const themeToggle = document.getElementById('themeToggle');
    const themeToggleConfig = document.getElementById('themeToggleConfig');
    
    const modeToggle = document.getElementById('modeToggle'); 
    const timeDisplay = document.getElementById('timeDisplay');
    const resetBtn = document.getElementById('resetBtn'); // Reset Button
    const playPauseBtn = document.getElementById('playPauseBtn');
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    const playPauseText = document.getElementById('playPauseText');
    const progressFill = document.getElementById('progressFill');
    
    const counterValue = document.getElementById('counterValue');
    const incrementBtn = document.getElementById('incrementBtn');
    const decrementBtn = document.getElementById('decrementBtn');

    const timeModal = document.getElementById('timeModal');
    const modalTimeInput = document.getElementById('modalTimeInput');
    const modalSaveBtn = document.getElementById('modalSaveBtn');
    const modalCancelBtn = document.getElementById('modalCancelBtn');

    // --- THEME INIT (NEU: Aus LocalStorage laden) ---
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        isDark = true;
        document.body.classList.add('dark');
    }

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
        // NEU: Theme speichern
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
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
        
        // Progress Bar
        if (gameState.mode === 'countdown' && gameState.maxTime > 0) {
            const percentage = (gameState.time / gameState.maxTime) * 100;
            progressFill.style.width = `${percentage}%`;
        } else {
            progressFill.style.width = '100%';
        }

        // Play/Pause Button & Reset Button Logic
        if (gameState.isPlaying) {
            playIcon.classList.add('hidden');
            pauseIcon.classList.remove('hidden');
            playPauseText.textContent = 'Pause';
            
            if (resetBtn) resetBtn.disabled = true;
            
            // NEU: Mode Toggle sperren wenn Spiel läuft
            if (modeToggle) modeToggle.disabled = true;
            
        } else {
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
            playPauseText.textContent = 'Play';
            
            if (resetBtn) resetBtn.disabled = false;

            // NEU: Mode Toggle freigeben wenn pausiert
            if (modeToggle) modeToggle.disabled = false;
        }

        // Counter
        counterValue.textContent = gameState.moves;
        decrementBtn.disabled = gameState.moves <= 0;

        // Mode Toggle Checkbox Status synchronisieren
        if (modeToggle) {
            const shouldBeChecked = (gameState.mode === 'countup');
            if (modeToggle.checked !== shouldBeChecked) {
                modeToggle.checked = shouldBeChecked;
            }
        }
    }

    // --- API / WEBSOCKET ---
    
    let socket;

    function initWebSocket() {
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
                // console.log("Received WS Data:", data); 

                // 1. Game Mode
                if (typeof data.mode !== 'undefined') {
                    gameState.mode = (data.mode === 1) ? 'countup' : 'countdown';
                }
                
                // 2. Time
                let receivedTime = (gameState.mode === 'countdown') ? data.time_countdown : data.time_countup;
                if (typeof receivedTime === 'number' && !isNaN(receivedTime)) {
                    gameState.time = Math.floor(receivedTime / 1000);
                }
                
                // 3. Paused Status
                if (typeof data.is_paused !== 'undefined') {
                    gameState.isPlaying = !data.is_paused;
                }
                
                // 4. Moves
                if (typeof data.piece_counter !== 'undefined') {
                    gameState.moves = data.piece_counter;
                }
                
                // 5. Max Time
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
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        
        let payload = {};
        switch (command) {
            case 'toggle_pause': payload = { cmd: 'toggle_pause' }; break;
            case 'set_mode': payload = { cmd: 'set_mode', val: (value === 'countup' ? 1 : 0) }; break;
            case 'adjust_moves': payload = { cmd: (value > 0 ? 'inc_moves' : 'dec_moves') }; break;
            case 'set_time': payload = { cmd: 'set_time', val: value * 1000 }; break;
            case 'reset_time': payload = { cmd: 'reset_time' }; break;
        }
        socket.send(JSON.stringify(payload));
    }

    // --- EVENT LISTENERS ---

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (!gameState.isPlaying) sendCommand('reset_time');
        });
    }

    modeToggle.addEventListener('change', (e) => {
        // Nur senden, wenn nicht gespielt wird (UI ist zwar disabled, aber sicher ist sicher)
        if (!gameState.isPlaying) {
            const newMode = e.target.checked ? 'countup' : 'countdown';
            sendCommand('set_mode', newMode);
        }
    });

    playPauseBtn.addEventListener('click', () => sendCommand('toggle_pause'));
    incrementBtn.addEventListener('click', () => sendCommand('adjust_moves', 1));
    decrementBtn.addEventListener('click', () => {
        if (gameState.moves > 0) sendCommand('adjust_moves', -1);
    });

    // Time Edit Modal (NEU: Nur im Countdown Modus und wenn pausiert)
    timeDisplay.addEventListener('click', () => {
        if (!gameState.isPlaying && gameState.mode === 'countdown') {
            modalTimeInput.value = gameState.maxTime; // Aktuelle Startzeit vorblenden
            timeModal.classList.add('active');
            modalTimeInput.focus();
        }
    });

    modalCancelBtn.addEventListener('click', () => timeModal.classList.remove('active'));

    modalSaveBtn.addEventListener('click', () => {
        const newTime = parseInt(modalTimeInput.value);
        if (newTime > 0) {
            sendCommand('set_time', newTime);
            timeModal.classList.remove('active');
        }
    });

    timeModal.addEventListener('click', (e) => {
        if (e.target === timeModal) timeModal.classList.remove('active');
    });

    // --- INITIALIZATION ---
    
    // 1. UI einmal initial updaten, damit "60:00" statt leer oder Fehler zu sehen ist
    updateUI();

    // 2. WebSocket starten
    initWebSocket();
});