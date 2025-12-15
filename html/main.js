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
    const modeToggle = document.getElementById('modeToggle'); // Checkbox
    const timeDisplay = document.getElementById('timeDisplay');
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
        
        // Die alten Icon-Umschalter entfernen, da wir jetzt ein statisches Icon haben
        // document.getElementById('sunIcon').classList.toggle('hidden', isDark);
        // document.getElementById('moonIcon').classList.toggle('hidden', !isDark);
        // document.getElementById('sunIconConfig').classList.toggle('hidden', isDark);
        // document.getElementById('moonIconConfig').classList.toggle('hidden', !isDark);
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

        // Play/Pause Button
        if (gameState.isPlaying) {
            playIcon.classList.add('hidden');
            pauseIcon.classList.remove('hidden');
            playPauseText.textContent = 'Pause';
        } else {
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
            playPauseText.textContent = 'Play';
        }

        // Counter
        counterValue.textContent = gameState.moves;
        decrementBtn.disabled = gameState.moves <= 0;

        // Mode Toggle (Checkbox Status synchronisieren)
        // Checked = Count Up, Unchecked = Countdown
        if (modeToggle) {
            modeToggle.checked = (gameState.mode === 'countup');
        }
    }

    // --- API MOCK / COMMUNICATION ---
    
    async function sendCommand(command, value = null) {
        console.log(`Sending command: ${command}, value: ${value}`);
        
        // Hier Fetch zum ESP32 einfügen:
        /*
        try {
            await fetch('/api/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command, value })
            });
            fetchState(); // State neu laden
        } catch (e) {
            console.error("API Error", e);
        }
        */
    }

    // --- EVENT LISTENERS ---

    // Mode Switch
    modeToggle.addEventListener('change', (e) => {
        const newMode = e.target.checked ? 'countup' : 'countdown';
        gameState.mode = newMode;
        sendCommand('set_mode', newMode);
        updateUI();
    });

    // Play/Pause
    playPauseBtn.addEventListener('click', () => {
        gameState.isPlaying = !gameState.isPlaying;
        sendCommand('toggle_pause');
        updateUI();
    });

    // Counter
    incrementBtn.addEventListener('click', () => {
        gameState.moves++;
        sendCommand('adjust_moves', 1);
        updateUI();
    });

    decrementBtn.addEventListener('click', () => {
        if (gameState.moves > 0) {
            gameState.moves--;
            sendCommand('adjust_moves', -1);
            updateUI();
        }
    });

    // Time Edit Modal
    timeDisplay.addEventListener('click', () => {
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
            gameState.maxTime = newTime;
            gameState.time = newTime; // Reset current time to max
            sendCommand('set_time', newTime);
            updateUI();
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
    
    // Mock Loop für Timer (nur zur Demo, später macht das der ESP32 State)
    setInterval(() => {
        if (gameState.isPlaying) {
            if (gameState.mode === 'countdown') {
                if (gameState.time > 0) gameState.time--;
                else gameState.isPlaying = false;
            } else {
                gameState.time++;
            }
            updateUI();
        }
    }, 1000);
});