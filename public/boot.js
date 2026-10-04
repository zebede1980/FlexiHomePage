// Runs synchronously in <head>, before the stylesheet and app bundle load.
// MV3 forbids inline scripts, hence a separate file.
(function () {
  // Styles that are always dark, and their page colour (mirrors lib/styles.ts).
  var DARK_ONLY = { constellation: '#040814' };
  var boot = {};
  try {
    boot = JSON.parse(localStorage.getItem('flexihome:boot') || '{}');
  } catch (e) {}
  var theme = boot.theme || 'auto';
  var style = boot.style || 'classic';
  if (theme === 'auto') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  if (DARK_ONLY[style]) theme = 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.style = style;
  document.documentElement.style.background = DARK_ONLY[style] || (theme === 'dark' ? '#0b0d14' : '#eef1f8');
})();
