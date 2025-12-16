document.addEventListener('DOMContentLoaded', () => {
    
    // --- STATE ---
    let gameState = {
        time: 0,
        maxTime: 0,
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
    const resetBtn = document.getElementById('resetBtn'); 
    const playPauseBtn = document.getElementById('playPauseBtn');
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    const playPauseText = document.getElementById('playPauseText');
    const progressFill = document.getElementById('progressFill');
    
    const counterValue = document.getElementById('counterValue');
    const incrementBtn = document.getElementById('incrementBtn');
    const decrementBtn = document.getElementById('decrementBtn');

    const timeModal = document.getElementById('timeModal');
    const inputMin = document.getElementById('inputMin');
    const inputSec = document.getElementById('inputSec');
    const modalSaveBtn = document.getElementById('modalSaveBtn');
    const modalCancelBtn = document.getElementById('modalCancelBtn');

    // --- THEME INIT ---
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
        timeDisplay.textContent = formatTime(gameState.time);
        
        // Blinken
        if (gameState.mode === 'countdown' && gameState.time <= 10 && gameState.time > 0 && gameState.isPlaying) {
            timeDisplay.classList.add('blink-red');
        } else {
            timeDisplay.classList.remove('blink-red');
        }

        // Editierbarkeit anzeigen
        if (gameState.mode === 'countdown' && !gameState.isPlaying) {
            timeDisplay.classList.add('editable');
            timeDisplay.title = "Klicken zum Bearbeiten der Startzeit";
        } else {
            timeDisplay.classList.remove('editable');
            timeDisplay.title = "";
        }

        // Progress Bar
        if (gameState.mode === 'countdown' && gameState.maxTime > 0) {
            const percentage = (gameState.time / gameState.maxTime) * 100;
            progressFill.style.width = `${percentage}%`;
        } else {
            progressFill.style.width = '100%';
        }

        // Buttons Status
        if (gameState.isPlaying) {
            playIcon.classList.add('hidden');
            pauseIcon.classList.remove('hidden');
            playPauseText.textContent = 'Pause';
            if (resetBtn) resetBtn.disabled = true;
            if (modeToggle) modeToggle.disabled = true;
            
            // Play/Pause Button ist aktiv (klickbar)
            playPauseBtn.disabled = false; 
            
        } else {
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
            playPauseText.textContent = 'Play';
            if (resetBtn) resetBtn.disabled = false;
            if (modeToggle) modeToggle.disabled = false;

            // --- NEU: Play Button deaktivieren wenn Zeit abgelaufen ---
            if (gameState.mode === 'countdown' && gameState.time <= 0) {
                playPauseBtn.disabled = true;
            } else {
                playPauseBtn.disabled = false;
            }
        }

        counterValue.textContent = gameState.moves;
        decrementBtn.disabled = gameState.moves <= 0;

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
        
        socket = new WebSocket(wsUrl);
        
        socket.onopen = function() { console.log('WebSocket connected'); };

        socket.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                if (typeof data.mode !== 'undefined') gameState.mode = (data.mode === 1) ? 'countup' : 'countdown';
                
                let receivedTime = (gameState.mode === 'countdown') ? data.time_countdown : data.time_countup;
                if (typeof receivedTime === 'number' && !isNaN(receivedTime)) gameState.time = Math.floor(receivedTime / 1000);
                
                if (typeof data.is_paused !== 'undefined') gameState.isPlaying = !data.is_paused;
                if (typeof data.piece_counter !== 'undefined') gameState.moves = data.piece_counter;
                if (typeof data.countdown_start !== 'undefined') gameState.maxTime = Math.floor(data.countdown_start / 1000);

                updateUI();
            } catch (e) { console.error('Error parsing WS message', e); }
        };

        socket.onclose = function() { setTimeout(initWebSocket, 2000); };
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

    // 1. Standard Buttons (Waren verloren gegangen)
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (!gameState.isPlaying) sendCommand('reset_time');
        });
    }

    modeToggle.addEventListener('change', (e) => {
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

    // 2. Time Edit Modal Logic
    timeDisplay.addEventListener('click', () => {
        if (!gameState.isPlaying && gameState.mode === 'countdown') {
            const m = Math.floor(gameState.maxTime / 60);
            const s = gameState.maxTime % 60;
            inputMin.value = m.toString().padStart(2, '0');
            inputSec.value = s.toString().padStart(2, '0');
            timeModal.classList.add('active');
            setTimeout(() => { inputMin.focus(); inputMin.select(); }, 50);
        }
    });

    inputMin.addEventListener('input', () => {
        if (inputMin.value.length >= 2) { inputSec.focus(); inputSec.select(); }
    });

    function handleEnter(e) { if (e.key === 'Enter') saveTime(); }
    inputMin.addEventListener('keydown', handleEnter);
    inputSec.addEventListener('keydown', handleEnter);

    modalCancelBtn.addEventListener('click', () => timeModal.classList.remove('active'));
    modalSaveBtn.addEventListener('click', saveTime);

    function saveTime() {
        let m = parseInt(inputMin.value) || 0;
        let s = parseInt(inputSec.value) || 0;
        if (s > 59) s = 59;
        if (m < 0) m = 0; if (s < 0) s = 0;
        const totalSeconds = (m * 60) + s;
        if (totalSeconds > 0) {
            sendCommand('set_time', totalSeconds);
            timeModal.classList.remove('active');
        }
    }

    timeModal.addEventListener('click', (e) => {
        if (e.target === timeModal) timeModal.classList.remove('active');
    });

    // --- INITIALIZATION ---
    updateUI();
    initWebSocket();
});