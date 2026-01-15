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
            // NEU: Konfigurationselemente initial laden wenn Seite geöffnet wird
            loadMdnsId();
            fetchNetworks();
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

    // --- LEADERBOARD LOGIC (Fullscreen, Filter, Edit) ---
    const leaderboardContainer = document.getElementById('leaderboardContainer');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const filterBtn = document.getElementById('filterBtn');
    
    // State
    let isFullscreen = false;
    let filterOnlyBest = false;
    let filterTowerStanding = false;
    let currentEditEntryIndex = null; // Index in the currently displayed filtered list? Or ID?
    // Using ID is better if we have it. Backend sends entry_id.
    
    // Icons
    const iconMinimize = `<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`; // X Icon
    const iconMaximize = `<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>`;
    const iconEdit = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;

    // --- FULLSCREEN TOGGLE ---
    fullscreenBtn.addEventListener('click', () => {
        isFullscreen = !isFullscreen;
        leaderboardContainer.classList.toggle('fullscreen', isFullscreen);
        fullscreenBtn.innerHTML = isFullscreen ? iconMinimize : iconMaximize;
        
        // Show/Hide Footer
        document.getElementById('leaderboardFooter').classList.toggle('hidden', !isFullscreen);

        // Re-render to show/hide edit icons
        renderLeaderboard(gameState.leaderboard);
    });

    // --- FILTER MODAL ---
    const filterModal = document.getElementById('filterModal');
    const filterBestToggle = document.getElementById('filterBestToggle');
    const filterTowerToggle = document.getElementById('filterTowerToggle');
    const filterCloseBtn = document.getElementById('filterCloseBtn');

    filterBtn.addEventListener('click', () => {
        filterModal.classList.add('active');
    });

    filterCloseBtn.addEventListener('click', () => {
        filterModal.classList.remove('active');
    });

    // Apply Filter Logic
    function getFilteredLeaderboard(entries) {
        if (!entries) return [];
        let filtered = [...entries];

        // Filter 1: Tower Standing (Only keep entries where fell == false)
        if (filterTowerStanding) {
            filtered = filtered.filter(e => !e.fell);
        }

        // Filter 2: Best per Team
        if (filterOnlyBest) {
            const bestMap = new Map();
            filtered.forEach(entry => {
                const team = entry.team || "Unknown";
                // Criteria: Mode specific?
                // Assuming standard logic: More moves is better. If moves equal, less time is better (in countdown: more remaining time? No, backend sends duration).
                // Backend sorted it already. So the first occurrence is the best?
                // Actually backend sort: Moves DESC, Time ASC. So yes, first occurrence is best.
                if (!bestMap.has(team)) {
                    bestMap.set(team, entry);
                }
            });
            filtered = Array.from(bestMap.values());
            // Re-sort because Map iteration order is insertion order, which is correct here as input was sorted.
        }

        return filtered;
    }

    // Toggle Handlers
    filterBestToggle.addEventListener('change', (e) => {
        filterOnlyBest = e.target.checked;
        renderLeaderboard(gameState.leaderboard);
    });

    filterTowerToggle.addEventListener('change', (e) => {
        filterTowerStanding = e.target.checked;
        renderLeaderboard(gameState.leaderboard);
    });

    // --- PASSWORD & EDIT LOGIC ---
    const passwordModal = document.getElementById('passwordModal');
    const passwordInput = document.getElementById('passwordInput');
    const pwConfirmBtn = document.getElementById('pwConfirmBtn');
    const pwCancelBtn = document.getElementById('pwCancelBtn');
    
    let pendingAction = null; // 'edit' or 'deleteAll'
    let pendingEntryId = null;

    function requestPassword(action, entryId = null) {
        pendingAction = action;
        pendingEntryId = entryId;
        passwordInput.value = '';
        passwordModal.classList.add('active');
        passwordInput.focus();
    }

    function closePasswordModal() {
        passwordModal.classList.remove('active');
        pendingAction = null;
        pendingEntryId = null;
    }

    pwCancelBtn.addEventListener('click', closePasswordModal);

    pwConfirmBtn.addEventListener('click', () => {
        if (passwordInput.value === 'Weihnachtsbaum') {
            closePasswordModal();
            if (pendingAction === 'edit') {
                openEditModal(pendingEntryId);
            } else if (pendingAction === 'deleteAll') {
                sendCommand('clear_leaderboard');
            }
        } else {
            alert('Falsches Passwort!');
            passwordInput.value = '';
            passwordInput.focus();
        }
    });
    
    // --- EDIT MODAL ---
    const editEntryModal = document.getElementById('editEntryModal');
    const editTeamName = document.getElementById('editTeamName');
    const editMoves = document.getElementById('editMoves');
    const editTimeSec = document.getElementById('editTimeSec');
    const editTowerFellToggle = document.getElementById('editTowerFellToggle');
    const editSaveBtn = document.getElementById('editSaveBtn');
    const editCancelBtn = document.getElementById('editCancelBtn');
    const deleteEntryBtn = document.getElementById('deleteEntryBtn');
    
    let editingId = null;

    function openEditModal(id) {
        const entry = gameState.leaderboard.find(e => e.id === id || e.entry_id === id); // Handle inconsistent naming if any
        if (!entry) return;

        editingId = id;
        editTeamName.value = entry.team;
        editMoves.value = entry.moves;
        editTimeSec.value = Math.floor(entry.time / 1000); // Display in seconds? Or raw ms? Let's do seconds.
        editTowerFellToggle.checked = entry.fell;
        
        editEntryModal.classList.add('active');
    }

    function closeEditModal() {
        editEntryModal.classList.remove('active');
        editingId = null;
    }

    editCancelBtn.addEventListener('click', closeEditModal);

    editSaveBtn.addEventListener('click', () => {
        if (editingId === null) return;
        
        const payload = {
            cmd: 'update_entry',
            id: editingId,
            team: editTeamName.value,
            moves: parseInt(editMoves.value),
            time: parseInt(editTimeSec.value) * 1000,
            fell: editTowerFellToggle.checked
        };
        socket.send(JSON.stringify(payload));
        closeEditModal();
    });

    deleteEntryBtn.addEventListener('click', () => {
         if (editingId === null) return;
         if(confirm("Diesen Eintrag wirklich löschen?")) {
             const payload = {
                 cmd: 'delete_entry',
                 id: editingId
             };
             socket.send(JSON.stringify(payload));
             closeEditModal();
         }
    });

    // Delete All
    document.getElementById('deleteAllBtn').addEventListener('click', () => {
        requestPassword('deleteAll');
    });

    // --- RENDER LEADERBOARD (UPDATED) ---
    function renderLeaderboard(entries) {
        // Use filtered list
        const filteredEntries = getFilteredLeaderboard(entries);

        leaderboardList.innerHTML = '';
        if (!filteredEntries || filteredEntries.length === 0) {
            leaderboardList.innerHTML = '<div class="leaderboard-item"><div class="leaderboard-info" style="text-align: center; width: 100%;">Keine Einträge (Filter aktiv?)</div></div>';
            return;
        }

        filteredEntries.forEach((entry, index) => {
            const item = document.createElement('div');
            item.className = 'leaderboard-item';
            
            // Icon für Turm Status
            const statusIcon = entry.fell ? iconFallen : iconStanding;
            // Zeit formatieren
            const m = Math.floor(entry.time / 60000).toString().padStart(2, '0');
            const s = Math.floor((entry.time % 60000) / 1000).toString().padStart(2, '0');
            const timeStr = `${m}:${s}`;
            
            // Use entry ID (backend provided)
            const entryId = entry.entry_id || entry.id || index; // Fallback

            let html = `
                <div class="leaderboard-rank">#${index + 1}</div>
                <div class="leaderboard-info">
                    <span class="team-name">${entry.team}</span>
                    <span class="team-stats">${entry.moves} Züge | ${timeStr} | ${statusIcon}</span>
                </div>
            `;
            
            // Add Edit Icon ONLY if Fullscreen
            if (isFullscreen) {
                html += `<button class="edit-icon-btn" data-id="${entryId}" aria-label="Edit">${iconEdit}</button>`;
            }

            item.innerHTML = html;
            leaderboardList.appendChild(item);
        });

        // Add Listeners to new buttons
        if (isFullscreen) {
            document.querySelectorAll('.edit-icon-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    // Prevent bubbling?
                    e.stopPropagation();
                    const id = parseInt(btn.dataset.id);
                    requestPassword('edit', id);
                });
            });
        }
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

                // NEU: Leaderboard Update - Nur rendern wenn Daten sich geändert haben
                if (data.leaderboard) {
                   const newLbString = JSON.stringify(data.leaderboard);
                   // Prüfen ob globaler Speicher existiert
                   if (typeof window.lastLeaderboardJson === 'undefined') window.lastLeaderboardJson = "";
                   
                   if (newLbString !== window.lastLeaderboardJson || isFullscreen !== (window.lastIsFullscreen || false) || 
                       filterOnlyBest !== (window.lastFilterBest || false) || filterTowerStanding !== (window.lastFilterTower || false)) {
                       
                       gameState.leaderboard = data.leaderboard;
                       renderLeaderboard(data.leaderboard);
                       
                       window.lastLeaderboardJson = newLbString;
                       window.lastIsFullscreen = isFullscreen;
                       window.lastFilterBest = filterOnlyBest;
                       window.lastFilterTower = filterTowerStanding;
                   }
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
            case 'clear_leaderboard': payload = { cmd: 'clear_leaderboard' }; break;
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

    // ==========================================
    // CONFIG PAGE LOGIC (Merged from config.js)
    // ==========================================

    // Icons
    const ICON_EDIT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
    const ICON_TRASH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
    const ICON_LOCK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
    const ICON_UNLOCK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>';
    const ICON_CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';

    let savedSSID = "";
    let connectedSSID = "";
    let isConnected = false;
    let mdnsDeviceId = null; 

    window.loadMdnsId = async function() {
        const input = document.getElementById('mdnsIdInput');
        if (!input) return;

        try {
            const resp = await fetch('/mdns');
            if (!resp.ok) return;
            const data = await resp.json();

            if (data && typeof data.id === 'number' && Number.isFinite(data.id)) {
                const v = Math.trunc(data.id);
                mdnsDeviceId = (v >= 1 && v <= 99) ? v : null;
            } else if (data && typeof data.id === 'string') {
                const s = data.id.trim();
                if (/^\d+$/.test(s)) {
                    const v = parseInt(s, 10);
                    mdnsDeviceId = (v >= 1 && v <= 99) ? v : null;
                } else {
                    mdnsDeviceId = null;
                }
            } else {
                mdnsDeviceId = null;
            }

            input.value = (mdnsDeviceId === null) ? '' : String(mdnsDeviceId);
        } catch (e) {
            // ignore
        }
    };

    window.saveMdnsId = async function() {
        const input = document.getElementById('mdnsIdInput');
        const btn = document.getElementById('saveMdnsBtn');
        if (!input) return;

        const raw = (input.value || '').trim();
        if (raw === '') {
            mdnsDeviceId = null;
        } else {
            if (!/^\d+$/.test(raw)) {
                alert('Bitte eine Zahl von 1 bis 99 eingeben (oder leer lassen).');
                return;
            }
            const v = parseInt(raw, 10);
            if (!(v >= 1 && v <= 99)) {
                alert('Bitte eine Zahl von 1 bis 99 eingeben (oder leer lassen).');
                return;
            }
            mdnsDeviceId = v;
        }

        if (btn) {
            btn.disabled = true;
            btn.textContent = '...';
        }

        try {
            const resp = await fetch('/mdns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: mdnsDeviceId })
            });

            if (!resp.ok) {
                const msg = await resp.text();
                alert(msg || 'Fehler beim Speichern');
                return;
            }

            alert('Geräte-ID gespeichert. Wirkt beim nächsten Boot.');
            await loadMdnsId();
        } catch (e) {
            alert('Fehler beim Speichern');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Speichern';
            }
        }
    };

    window.fetchNetworks = async function() {
        const list = document.getElementById('networkList');
        const refreshBtn = document.getElementById('refreshBtn');
        
        if (!list) return;

        list.innerHTML = '<div class="loading">Suche Netzwerke...</div>';
        if(refreshBtn) refreshBtn.disabled = true;

        try {
            try {
                const statusResp = await fetch('/status');
                if (statusResp.ok) {
                    const statusData = await statusResp.json();
                    savedSSID = statusData.saved_ssid || "";
                    connectedSSID = statusData.connected_ssid || "";
                    isConnected = statusData.connected;
                }
            } catch (e) { console.log("Status fetch error", e); }

            const response = await fetch('/scan');
            if (!response.ok) throw new Error("Scan fehlgeschlagen");
            
            const networks = await response.json();
            list.innerHTML = '';

            networks.sort((a, b) => {
                const aIsConn = (a.ssid === connectedSSID && isConnected);
                const bIsConn = (b.ssid === connectedSSID && isConnected);
                if (aIsConn && !bIsConn) return -1;
                if (!aIsConn && bIsConn) return 1;

                const aIsSaved = (a.ssid === savedSSID);
                const bIsSaved = (b.ssid === savedSSID);
                if (aIsSaved && !bIsSaved) return -1;
                if (!aIsSaved && bIsSaved) return 1;
                
                return b.rssi - a.rssi;
            });

            if (networks.length === 0) {
                list.innerHTML = '<div class="loading">Keine Netzwerke gefunden.</div>';
            } else {
                networks.forEach(net => {
                    const isSaved = (net.ssid === savedSSID && savedSSID !== "");
                    const isConn = (net.ssid === connectedSSID && isConnected);
                    
                    const item = document.createElement('div');
                    item.className = 'wifi-item';
                    if (isConn) item.classList.add('connected');
                    
                    const safeSSID = net.ssid.replace(/'/g, "\\'");
                    
                    item.onclick = () => openWifiModal(net.ssid);

                    let statusBadges = '';
                    if (isConn) statusBadges += `<span class="badge badge-success">${ICON_CHECK} Verbunden</span>`;
                    else if (isSaved) statusBadges += `<span class="badge badge-info">Gespeichert</span>`;

                    let html = `
                        <div class="wifi-info">
                            <div class="wifi-header">
                                <span class="wifi-ssid">${net.ssid}</span>
                                ${statusBadges}
                            </div>
                            <div class="wifi-meta">
                                Signal: ${net.rssi} dBm 
                                <span class="wifi-auth">${net.auth > 0 ? ICON_LOCK : ICON_UNLOCK}</span>
                            </div>
                        </div>
                    `;

                    if (isSaved || isConn) {
                        html += `
                        <div class="wifi-actions">
                            <button type="button" class="btn-icon" onclick="event.stopPropagation(); window.openWifiModal('${safeSSID}')" title="Bearbeiten">
                                ${ICON_EDIT}
                            </button>
                            <button type="button" class="btn-icon delete" onclick="event.stopPropagation(); window.forgetNetwork('${safeSSID}')" title="Vergessen">
                                ${ICON_TRASH}
                            </button>
                        </div>`;
                    }
                    item.innerHTML = html;
                    list.appendChild(item);
                });
            }

        } catch (error) {
            console.error('Error:', error);
            list.innerHTML = '<div class="loading" style="color:#ef4444">Fehler beim Laden.</div>';
        } finally {
            if(refreshBtn) refreshBtn.disabled = false;
        }
    };

    window.forgetNetwork = async function(ssid) {
        showConfirm(`Netzwerk "${ssid}" wirklich vergessen?`, async () => {
            try {
                const resp = await fetch('/forget', { method: 'POST' });
                if (resp.ok) {
                    if (savedSSID === ssid) savedSSID = "";
                    fetchNetworks(); 
                } else {
                    alert("Fehler beim Löschen.");
                }
            } catch (e) { 
                console.error(e);
            }
        });
    };

    window.openWifiModal = function(ssid) {
        const modal = document.getElementById('wifiModal');
        const ssidInput = document.getElementById('ssidInput');
        const passInput = document.getElementById('wifiPwInput');
        if(modal && ssidInput) {
            ssidInput.value = ssid;
            passInput.value = '';
            modal.classList.add('active'); 
            setTimeout(() => passInput.focus(), 100);
        }
    };

    window.closeWifiModal = function() {
        const modal = document.getElementById('wifiModal');
        if(modal) modal.classList.remove('active');
    };

    window.showConfirm = function(message, onConfirm) {
        const modal = document.getElementById('confirmConfigModal');
        const msgEl = document.getElementById('confirmMessage');
        const okBtn = document.getElementById('confirmOkBtn');
        const cancelBtn = document.getElementById('confirmCancelBtn');

        if (!modal) {
            if (confirm(message)) onConfirm();
            return;
        }

        msgEl.textContent = message;
        
        const newOk = okBtn.cloneNode(true);
        const newCancel = cancelBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(newOk, okBtn);
        cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

        newOk.addEventListener('click', () => {
            modal.classList.remove('active');
            onConfirm();
        });

        newCancel.addEventListener('click', () => {
            modal.classList.remove('active');
        });

        modal.classList.add('active');
    };

    window.restartESP = function() {
        showConfirm("ESP32 wirklich neustarten?", () => {
            fetch('/restart', { method: 'POST' })
                .then(() => {
                    alert("Neustart wird durchgeführt... Seite wird neu geladen.");
                    setTimeout(() => location.reload(), 5000);
                })
                .catch(() => alert("Fehler beim Neustart"));
        });
    };

    window.saveWifi = function() {
        const ssid = document.getElementById('ssidInput').value;
        const pass = document.getElementById('wifiPwInput').value;
        const btn = document.querySelector('#wifiModal .btn-primary');
        
        const originalText = btn.textContent;
        if(btn) {
            btn.textContent = "Verbinde...";
            btn.disabled = true;
        }
        
        fetch('/save', { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({ssid, password: pass}) 
        })
        .then((response) => {
            if(response.ok) {
                closeWifiModal();
                const list = document.getElementById('networkList');
                if(list) list.innerHTML = '<div class="loading">Verbinde mit ' + ssid + '...</div>';
                setTimeout(fetchNetworks, 4000);
            } else {
                throw new Error("Server Error");
            }
        })
        .catch(() => {
            alert('Fehler beim Speichern');
        })
        .finally(() => {
            if(btn) {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        });
    };

});