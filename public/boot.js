// Runs synchronously in <head>, before the stylesheet and app bundle load.
// MV3 forbids inline scripts, hence a separate file.
(function () {
  var theme = 'auto';
  try {
    theme = JSON.parse(localStorage.getItem('flexihome:boot') || '{}').theme || 'auto';
  } catch (e) {}
  if (theme === 'auto') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.background = theme === 'dark' ? '#0b0d14' : '#eef1f8';
})();
