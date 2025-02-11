// Anzeige der Zeiten und Steuerung des Timers

let maxTime = 0; // Maximale Zeit in Millisekunden
let player1Time = 0; // Zeit von Spieler 1 in Millisekunden
let player2Time = 0; // Zeit von Spieler 2 in Millisekunden
let currentPlayer = null; // Aktueller Spieler (1 oder 2)
let timerInterval = null; // Interval-ID für das Herunterzählen
let is_paused = false; // Spiel pausiert oder nicht
let barPlayer1 = null;
let barPlayer2 = null;

// WebSocket-Verbindung
const socket = new WebSocket(`ws://${window.location.hostname}/ws`);


async function styleCurrentPlayer(player) {
    barPlayer1 = document.getElementById('barPlayer1');
    barPlayer2 = document.getElementById('barPlayer2');
    if (player === 1) {
        barPlayer1.style.filter = 'grayscale(0)';
        barPlayer2.style.filter = 'grayscale(0.5)';
    } else if (player === 2) {
        barPlayer2.style.filter = 'grayscale(0)';
        barPlayer1.style.filter = 'grayscale(0.5)';
    }
}

async function timeOut(winner) {
    console.log('TimeOut!');
    document.getElementById('timeOutMessage').style.display = `block`;
    document.getElementById('timeOutBackground').style.display = `block`;
    document.getElementById('timeOutWinner').innerHTML = `Spieler `+ winner + ` hat ge&shy;wonnen<wbr>!`;
    if(winner === "2") {
        document.getElementById('timeOutWinner').style.color = "red";
    }
    else {
        document.getElementById('timeOutWinner').style.color = "blue";
    }
    document.getElementById('timeOutWinner').style.display = `block`;
}


// Initialisiere die Zeiten von /time
async function initializeTime() {
    const response = await fetch('/time');
    const data = await response.json();
    
    maxTime = data.max_time;
    player1Time = data.time_player_1;
    player2Time = data.time_player_2;
    is_paused = data.is_paused === true || data.is_paused === "true"; // Unterstützt sowohl Boolean als auch String

    if(!currentPlayer) {
        currentPlayer = data.its_player1s_turn;
        styleCurrentPlayer(currentPlayer);
        console.log(currentPlayer);
    }

    if (barPlayer1 === null || barPlayer2 === null) {
        barPlayer1 = document.getElementById('barPlayer1');
        barPlayer2 = document.getElementById('barPlayer2');
    }

    // Zeige die initialen Zeiten an
    updateDisplay();


    if (!is_paused) {
        startTimer(currentPlayer);
    }


    //TimeIsUp
    if (player1Time <= 0.5) {
        player1Time = 0;
        timeOut("2");        
    }
    else if (player2Time <= 0.5) {
        player2Time = 0;
        timeOut("1");        
    }
}

// Aktualisiere die Anzeige auf der Website
function updateDisplay() {
    document.getElementById('time_player_1').innerText = `${(player1Time / 1000).toFixed(1)}s`;
    document.getElementById('time_player_2').innerText = `${(player2Time / 1000).toFixed(1)}s`;

    document.getElementById('usedTime1').innerText = `     ${((player1Time - maxTime) / -1000).toFixed(1)}s`;
    document.getElementById('usedTime2').innerText = `     ${((player2Time - maxTime)/ -1000).toFixed(1)}s`;
    
    // Verhindere Division durch 0
    const barHeightPlayer1 = maxTime > 0 ? (player1Time / maxTime * 100) : 0;
    const barHeightPlayer2 = maxTime > 0 ? (player2Time / maxTime * 100) : 0;

    // Setze die Höhe der Balken
    barPlayer1.style.height = `${barHeightPlayer1}%`;
    barPlayer2.style.height = `${barHeightPlayer2}%`;
}

// Starte das Herunterzählen für den aktuellen Spieler
function startTimer(player) {
    stopTimer(); // Beende vorherigen Timer, falls aktiv

    currentPlayer = player;
    timerInterval = setInterval(() => {
        if (currentPlayer === 1) {
            player1Time -= 100; // Reduziere um 100ms
            if (player1Time <= 0.5) {
                player1Time = 0;
                timeOut("2");
                stopTimer(); // Stoppe den Timer, wenn die Zeit abgelaufen ist
                
            }
        } else if (currentPlayer === 2) {
            player2Time -= 100; // Reduziere um 100ms
            if (player2Time <= 0.5) {
                player2Time = 0;
                timeOut("1");
                stopTimer(); // Stoppe den Timer, wenn die Zeit abgelaufen ist
            }
        }
        updateDisplay(); // Aktualisiere die Anzeige
    }, 100); // Alle 100ms aktualisieren
}

// Stoppe das Herunterzählen
function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// WebSocket-Nachricht empfangen
socket.onmessage = function (event) {
    let data;
    try {
        data = JSON.parse(event.data); // Versuche die Nachricht zu parsen
    } catch (error) {
        console.error("Ungültige Nachricht empfangen:", event.data);
        return; // Beende die Verarbeitung für diese Nachricht
    }

    if (data.action === 'start_time') {
        console.log(`Spieler ${data.current_player} ist dran!`);
        initializeTime();
        styleCurrentPlayer(data.current_player);
        startTimer(data.current_player); // Starte den Timer für den aktuellen Spieler
        
    } else if (data.action === 'pause_time') {
        console.log('Spiel pausiert!');
        stopTimer(); // Stoppe das Herunterzählen
        styleCurrentPlayer(data.current_player);

        // Setze die Zeiten auf die vom ESP32 gesendeten Werte
        initializeTime();

    } else if (data.action === 'init_time') {
        console.log('Zeiten werden initialisiert!');

        // Setze die Zeiten auf die vom ESP32 gesendeten Werte
        maxTime = data.max_time;
        player1Time = maxTime;
        player2Time = maxTime;

        styleCurrentPlayer(data.current_player);

        // Aktualisiere die Anzeige
        updateDisplay();
    }

    else if (data.action === 'turn_time') {
        console.log('Zugzeiten empfangen:', data);
        
        // Array-Verarbeitung für Spieler 1
        if (data.player1_times && data.player1_times.length > 0) {
            const reversedP1 = [...data.player1_times].reverse(); // Kopie erstellen und umdrehen
            const avg1 = calculateAverage(data.player1_times);
            
            document.getElementById('averageTime1').innerText = 
                `  ${(avg1/ 1000).toFixed(1)} s`;

            document.getElementById('counts1').innerText = 
            `  ${data.player1_times.length}`;
            
            document.getElementById('timeList1').innerText = 
                reversedP1.map(t => `${(t/1000).toFixed(1)} s`).join('\n');
        }
    
        // Array-Verarbeitung für Spieler 2
        if (data.player2_times && data.player2_times.length > 0) {
            const reversedP2 = [...data.player2_times].reverse(); // Kopie erstellen und umdrehen
            const avg2 = calculateAverage(data.player2_times);
            
            document.getElementById('averageTime2').innerText = 
                `  ${(avg2/ 1000).toFixed(1)} s`;

            document.getElementById('counts2').innerText = 
                `  ${data.player2_times.length}`;
                
            document.getElementById('timeList2').innerText = 
                reversedP2.map(t => `${(t/1000).toFixed(1)} s`).join('\n');
        }
    }
    

    
    else if (data.message) {
        console.log("Nachricht vom Server:", data.message);
    }
};

// Hilfsfunktion für Durchschnittsberechnung
function calculateAverage(timesArray) {
    if (!timesArray || timesArray.length === 0) return 0;
    const sum = timesArray.reduce((a, b) => a + b, 0);
    return Math.round(sum / timesArray.length);
}



// show ip adresse

document.addEventListener('DOMContentLoaded', () => {
    // Setze den Eintrag auf den aktuellen Hostnamen
    document.getElementById("espIp").innerText = window.location.hostname;
});



// DARK MODE

document.addEventListener('DOMContentLoaded', () => {
    let stored = localStorage.getItem('theme'); // 'dark', 'light' oder null
    if (stored) {
        document.documentElement.setAttribute('data-theme', stored);
    }
});
  
window.toggleDarkMode = () => {
    const htmlEl = document.documentElement;
    const current = htmlEl.getAttribute('data-theme'); // 'dark' oder 'light' (evtl. null)

    let newMode;
    if (!current) {
        // Kein data-theme => Wir haben gerade System-Mode, also gucken wir, ob laut System dark ist
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        newMode = systemDark ? 'light' : 'dark'; // Wir kippen um
    } else {
        // 'dark' -> wird zu 'light'; 'light' -> wird zu 'dark'
        newMode = (current === 'dark') ? 'light' : 'dark';
    }

    htmlEl.setAttribute('data-theme', newMode);
    localStorage.setItem('theme', newMode);
};
  
