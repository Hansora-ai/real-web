// Runs before first paint (loaded without defer) so a saved light choice never flashes dark. Default is dark.
(function () {
  var theme;
  try { theme = localStorage.getItem('hansora_automation_theme'); } catch (_) {}
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
})();
