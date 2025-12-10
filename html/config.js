// Icons als SVG Strings
const ICON_EDIT = '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

let savedSSID = "";

document.addEventListener('DOMContentLoaded', () => {
    // Theme Logic
    const toggle = document.getElementById('themeToggle');
    const savedTheme = localStorage.getItem('jenga_theme');
    if (savedTheme === 'dark') document.body.classList.add('dark');

    if (toggle) {
        toggle.addEventListener('click', () => { 
            document.body.classList.toggle('dark'); 
            const isDark = document.body.classList.contains('dark');
            localStorage.setItem('jenga_theme', isDark ? 'dark' : 'light');
        });
    }

    fetchNetworks();
});

async function fetchNetworks() {
    const list = document.getElementById('networkList');
    const refreshBtn = document.getElementById('refreshBtn');
    
    if (!list) return;

    list.innerHTML = '<div class="loading">Suche Netzwerke...</div>';
    if(refreshBtn) refreshBtn.style.opacity = "0.5";

    try {
        // 1. Saved Network laden
        try {
            const savedResp = await fetch('/saved');
            if (savedResp.ok) {
                const savedData = await savedResp.json();
                savedSSID = savedData.ssid || "";
            }
        } catch (e) { console.log("Saved fetch error", e); }

        // 2. Scan
        const response = await fetch('/scan');
        if (!response.ok) throw new Error("Scan fehlgeschlagen");
        
        const networks = await response.json();
        list.innerHTML = '';

        // 3. Sortieren
        networks.sort((a, b) => {
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
                const item = document.createElement('div');
                item.className = 'wifi-item';
                
                // SSID sicher für HTML Attribute machen (Escaping von Anführungszeichen)
                const safeSSID = net.ssid.replace(/'/g, "\\'");
                
                // Klick auf das ganze Element öffnet Modal
                item.onclick = () => openModal(net.ssid);

                let html = `
                    <div class="wifi-info">
                        <span class="wifi-ssid">${net.ssid} ${isSaved ? '<span class="saved-badge">Gespeichert</span>' : ''}</span>
                        <div class="wifi-meta">Signal: ${net.rssi} dBm ${net.auth > 0 ? '🔒' : '🔓'}</div>
                    </div>
                `;

                if (isSaved) {
                    html += `
                    <div class="wifi-actions">
                        <button type="button" class="action-btn" onclick="event.stopPropagation(); openModal('${safeSSID}')" title="Passwort ändern">
                            ${ICON_EDIT}
                        </button>
                        <button type="button" class="action-btn delete" onclick="event.stopPropagation(); forgetNetwork('${safeSSID}')" title="Vergessen">
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
        if(refreshBtn) refreshBtn.style.opacity = "1";
    }
}

async function forgetNetwork(ssid) {
    if(!confirm(`Netzwerk "${ssid}" wirklich vergessen?`)) return;
    
    try {
        const resp = await fetch('/forget', { method: 'POST' });
        
        if (resp.ok) {
            alert("Netzwerk wurde gelöscht.");
            savedSSID = ""; // Lokal zurücksetzen
            fetchNetworks(); // Liste neu laden
        } else {
            alert("Fehler: Der ESP32 konnte das Netzwerk nicht löschen.");
        }
    } catch (e) { 
        alert("Verbindungsfehler beim Löschen."); 
        console.error(e);
    }
}

function openModal(ssid) {
    const modal = document.getElementById('wifiModal');
    const ssidInput = document.getElementById('ssidInput');
    const passInput = document.getElementById('passwordInput');
    
    if(modal && ssidInput) {
        ssidInput.value = ssid;
        passInput.value = '';
        modal.classList.add('active'); 
        setTimeout(() => passInput.focus(), 100);
    }
}

function closeModal() {
    const modal = document.getElementById('wifiModal');
    if(modal) modal.classList.remove('active');
}

// Schließen wenn man neben das Modal klickt
window.onclick = function(event) {
    const modal = document.getElementById('wifiModal');
    if (event.target == modal) {
        closeModal();
    }
}

function saveWifi() {
    const ssid = document.getElementById('ssidInput').value;
    const pass = document.getElementById('passwordInput').value;
    const btn = document.querySelector('.btn-primary');
    
    const originalText = btn.textContent;
    btn.textContent = "Speichere...";
    btn.disabled = true;
    
    fetch('/save', { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify({ssid, password: pass}) 
    })
    .then((response) => {
        if(response.ok) {
            alert('Gespeichert! Der ESP32 startet jetzt neu und verbindet sich.'); 
            closeModal(); 
        } else {
            throw new Error("Server Error");
        }
    })
    .catch(() => {
        alert('Fehler beim Speichern');
    })
    .finally(() => {
        btn.textContent = originalText;
        btn.disabled = false;
    });
}