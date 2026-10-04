// Runs synchronously in <head>, before the stylesheet and app bundle load.
// MV3 forbids inline scripts, hence a separate file.
(function () {
  // Page colour per style and theme, and styles that are always dark (mirrors lib/styles.ts).
  var DARK_ONLY = { aurora: '#070618', constellation: '#040814' };
  var PAGE = { dotfield: { light: '#f5f2ec', dark: '#15130f' } };
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
  document.documentElement.style.background =
    DARK_ONLY[style] || (PAGE[style] && PAGE[style][theme]) || (theme === 'dark' ? '#0b0d14' : '#eef1f8');
})();
