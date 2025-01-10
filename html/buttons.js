window.toggleDarkMode = () => {
    // Hole nur den gespeicherten Zustand, ignoriere Systemeinstellung beim Toggle
    let isDarkMode = localStorage.getItem('darkMode');
    
    // Wenn noch kein Zustand gespeichert ist, nimm die Systemeinstellung als Ausgangspunkt
    if (isDarkMode === null) {
        isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } else {
        isDarkMode = isDarkMode === 'true';
    }
    
    // Invertiere den aktuellen Zustand
    isDarkMode = !isDarkMode;


    localStorage.setItem('darkMode', isDarkMode);
};
