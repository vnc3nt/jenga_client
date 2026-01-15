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

    // NEU: Leaderboard Inputs
    const teamNameInput = document.getElementById('teamNameInput');
    const towerFellBtn = document.getElementById('towerFellBtn');
    const towerFellIcon = document.getElementById('towerFellIcon'); 
    let isTowerFell = false;

    // SVGs für Turm Status
    const iconStanding = `<svg width="24" height="24" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M20 85 h60 v-10 h-60 z M20 73 h18 v-10 h-18 z M41 73 h18 v-10 h-18 z M62 73 h18 v-10 h-18 z M20 61 h60 v-10 h-60 z M20 49 h18 v-10 h-18 z M41 49 h18 v-10 h-18 z M62 49 h18 v-10 h-18 z M20 37 h60 v-10 h-60 z M20 25 h18 v-10 h-18 z M41 25 h18 v-10 h-18 z M62 25 h18 v-10 h-18 z"/></svg>`;
    const iconFallen = `<svg width="24" height="24" viewBox="0 0 100 100" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M10 90 h30 v-10 h-30 z M45 90 l15 -30 l9 4 l-15 30 z M75 90 h20 v-10 h-20 z M55 55 l25 8 l-3 9 l-25 -8 z M20 60 l20 -5 l3 9 l-20 5 z"/></svg>`;

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
    // Tower Fell Toggle Logic
    function updateTowerFellUI() {
        if (isTowerFell) {
            towerFellBtn.classList.add('btn-primary');
            towerFellBtn.classList.remove('btn-secondary');
            towerFellBtn.setAttribute('aria-pressed', 'true');
            towerFellIcon.innerHTML = iconFallen;
        } else {
            towerFellBtn.classList.add('btn-secondary');
            towerFellBtn.classList.remove('btn-primary');
            towerFellBtn.setAttribute('aria-pressed', 'false');
            towerFellIcon.innerHTML = iconStanding;
        }
    }

    towerFellBtn.addEventListener('click', () => {
        isTowerFell = !isTowerFell;
        updateTowerFellUI();
    });

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
            
            // NEU: Reset Button Logic (Nur aktiv, wenn Zeit lief oder Züge gemacht wurden)
            if (resetBtn) {
                let hasProgress = false;
                if (gameState.moves > 0) hasProgress = true;
                else {
                    if (gameState.mode === 'countdown') {
                        // Progress means time < maxTime
                        if (gameState.maxTime > 0 && gameState.time < gameState.maxTime) hasProgress = true;
                    } else { // countup
                        if (gameState.time > 0) hasProgress = true;
                    }
                }
                resetBtn.disabled = !hasProgress;
            }

            if (modeToggle) modeToggle.disabled = false;

            // --- NEU: Play Button deaktivieren wenn Zeit abgelaufen ---
            // Wird jetzt von updatePlayButtonState handled
            updatePlayButtonState();
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

    const leaderboardList = document.getElementById('leaderboardList');
    
    // --- RENDER LEADERBOARD ---
    function renderLeaderboard(entries) {
        leaderboardList.innerHTML = '';
        if (!entries || entries.length === 0) {
            leaderboardList.innerHTML = '<div class="leaderboard-item"><div class="leaderboard-info" style="text-align: center; width: 100%;">Noch keine Einträge</div></div>';
            return;
        }

        entries.forEach((entry, index) => {
            const item = document.createElement('div');
            item.className = 'leaderboard-item';
            
            // Icon für Turm Status
            const statusIcon = entry.fell ? iconFallen : iconStanding;
            // Zeit formatieren
            const m = Math.floor(entry.time / 60000).toString().padStart(2, '0');
            const s = Math.floor((entry.time % 60000) / 1000).toString().padStart(2, '0');
            const timeStr = `${m}:${s}`;

            item.innerHTML = `
                <div class="leaderboard-rank">#${index + 1}</div>
                <div class="leaderboard-info">
                    <span class="team-name">${entry.team}</span>
                    <span class="team-stats">${entry.moves} Züge | ${timeStr} | ${statusIcon}</span>
                </div>
            `;
            leaderboardList.appendChild(item);
        });
    }

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
                
                // NEU: Teamname syncen (wenn abweichend)
                if (typeof data.current_team !== 'undefined' && teamNameInput.value !== data.current_team) {
                    // Check if input is focused to avoid disrupting typing
                    if (document.activeElement !== teamNameInput) {
                        teamNameInput.value = data.current_team;
                        updatePlayButtonState();
                    }
                }

                // NEU: Leaderboard Update
                if (data.leaderboard) {
                   renderLeaderboard(data.leaderboard);
                }

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
            case 'save_and_reset': 
                payload = { 
                    cmd: 'save_and_reset', 
                    team: value.team, 
                    fell: value.fell 
                }; 
                break;
            case 'set_team_name':
                payload = { cmd: 'set_team_name', team: value };
                break;
        }
        socket.send(JSON.stringify(payload));
    }

    // --- INPUT VALIDATION ---
    function updatePlayButtonState() {
        // Play Button ist disabled, wenn:
        // 1. TeamName leer ist
        // 2. ODER (Countdown Modus UND Zeit <= 0)
        
        const hasTeamName = teamNameInput.value.trim().length > 0;
        const isCountdownFinished = (gameState.mode === 'countdown' && gameState.time <= 0);
        
        if (!hasTeamName || isCountdownFinished) {
            playPauseBtn.disabled = true;
            // Optional: Visueller Hinweis
            if (!hasTeamName) teamNameInput.style.borderColor = "red";
            else teamNameInput.style.borderColor = "";
        } else {
            playPauseBtn.disabled = false;
            teamNameInput.style.borderColor = "";
        }
    }

    // Event Listener für Team Name
    teamNameInput.addEventListener('input', () => {
        const name = teamNameInput.value.trim();
        updatePlayButtonState();
        // Name an ESP senden (damit Hardware-Button Bescheid weiß)
        sendCommand('set_team_name', name);
    });

    // Initial Prüfung
    updatePlayButtonState();

    // --- EVENT LISTENERS ---

    // 1. Standard Buttons
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (!gameState.isPlaying) {
                // Senden mit Teamname und Status
                const teamName = teamNameInput.value || "Team " + (Math.floor(Math.random() * 1000));
                sendCommand('save_and_reset', { team: teamName, fell: isTowerFell });
                
                // Checkbox zurücksetzen (User Request: "Bei Reset soll die Checkbox ebenfalls zurückgesetzt werden")
                isTowerFell = false;
                updateTowerFellUI();
                
                // Teamname bleibt stehen (User Request: "der Teamname soll aber gespeichert bleiben")
            }
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