// Applies the saved theme before the first paint (see Preferences in the app), so a light
// theme never flashes dark. A separate file rather than an inline script, for a strict CSP.
(function () {
  var theme = 'system';
  try {
    var saved = JSON.parse(localStorage.getItem('42chess.preferences') || '{}');
    if (saved && (saved.theme === 'light' || saved.theme === 'dark')) theme = saved.theme;
  } catch (error) {
    // No storage: follow the device.
  }
  if (theme === 'system')
    theme =
      window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
})();
