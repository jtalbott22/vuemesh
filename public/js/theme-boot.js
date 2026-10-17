// Runs before paint so the page never flashes the wrong theme.
try { const t = localStorage.getItem('vm_theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
