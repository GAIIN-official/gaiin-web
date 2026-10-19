/* Mobile header menu: toggles the panel opened by .menu-toggle. No dependencies. */
(function () {
  var btn = document.querySelector('.menu-toggle');
  var panel = btn && document.getElementById(btn.getAttribute('aria-controls'));
  if (!btn || !panel) return;

  function setOpen(open, returnFocus) {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    panel.hidden = !open;
    if (!open && returnFocus) btn.focus();
  }

  btn.addEventListener('click', function () {
    setOpen(btn.getAttribute('aria-expanded') !== 'true');
  });

  panel.addEventListener('click', function (e) {
    if (e.target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.key === 'Esc') && btn.getAttribute('aria-expanded') === 'true') {
      setOpen(false, true);
    }
  });

  document.addEventListener('click', function (e) {
    if (btn.getAttribute('aria-expanded') === 'true' && !panel.contains(e.target) && !btn.contains(e.target)) {
      setOpen(false);
    }
  });

  window.addEventListener('resize', function () {
    if (btn.getAttribute('aria-expanded') === 'true' && getComputedStyle(btn).display === 'none') setOpen(false);
  });
})();
