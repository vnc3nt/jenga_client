window.toggleDarkMode = () => {
    let isDarkMode = localStorage.getItem('darkMode') === 'true' || window.matchMedia('(prefers-color-scheme: dark)').matches;

    isDarkMode = !isDarkMode;

    if (isDarkMode) {
        document.documentElement.style.setProperty('--bg-color', 'black');
        document.documentElement.style.setProperty('--text-color', 'white');
    } else {
        document.documentElement.style.setProperty('--bg-color', 'white');
        document.documentElement.style.setProperty('--text-color', 'black');
    }

    localStorage.setItem('darkMode', isDarkMode); // Zustand speichern
};
