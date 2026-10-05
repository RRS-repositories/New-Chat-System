// Runs before the app loads, so the page is never drawn in the wrong colours first.
// A separate file because the site's security policy does not allow scripts written into the page.
// The key and the valid values match web/src/utils/theme.ts.
(function () {
  var mode = 'light';
  var accent = 'violet';
  try {
    var saved = JSON.parse(localStorage.getItem('chatTheme') || '{}') || {};
    if (saved.mode === 'dark') mode = 'dark';
    if (['violet', 'ocean', 'sunset', 'emerald', 'magenta'].indexOf(saved.accent) !== -1) accent = saved.accent;
  } catch (e) {
    /* keep the defaults */
  }
  document.body.setAttribute('data-mode', mode);
  document.body.setAttribute('data-accent', accent);
})();
