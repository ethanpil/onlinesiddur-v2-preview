// Pre-paint bootstrap. Inlined into <head> of every page so the document
// renders with the user's saved theme/size/lang/headings/nikud immediately
// — no FOUC, no theme flash. Validates and clamps every value.
(function () {
  try {
    var s = localStorage, root = document.documentElement;
    var t = s.getItem('ssd:theme');
    if (t === 'light' || t === 'dark') root.dataset.theme = t;
    var szRaw = parseInt(s.getItem('ssd:textsize'), 10);
    if (Number.isFinite(szRaw)) {
      var sz = Math.max(14, Math.min(40, szRaw));
      root.style.setProperty('--size', sz + 'px');
    }
    var lhRaw = parseFloat(s.getItem('ssd:leading'));
    if (Number.isFinite(lhRaw)) {
      var lh = Math.max(1.3, Math.min(2.6, lhRaw));
      root.style.setProperty('--lh', String(lh));
    }
    var h = s.getItem('ssd:headings');
    if (h === 'on' || h === 'off') root.dataset.headings = h;
    var n = s.getItem('ssd:nikud');
    if (n === 'on' || n === 'off') root.dataset.nikud = n;
    var lang = s.getItem('ssd:lang');
    if (lang === 'en' || lang === 'he') root.dataset.lang = lang;
    else if (navigator.language && /^he/i.test(navigator.language)) root.dataset.lang = 'he';
    // Calendar filter. data-filter ships "on"; restore the saved choice.
    // Replay the cached condition tokens BEFORE first paint, so a repeat
    // visit filters with zero content shift. No cache (or an expired one)
    // leaves data-conds unset — the hide rules stay inert and the page
    // paints complete; app.js recomputes after load.
    var dk = root.dataset.daykind;
    // A ?date= QA view must not first-paint with the REAL day's cache.
    if (dk && !/[?&]date=/.test(location.search)) {
      var fl = s.getItem('ssd:filter');
      if (fl === 'on' || fl === 'off') root.dataset.filter = fl;
      // Inner try: a corrupt cache entry must not skip the font preload
      // below.
      try {
        var c = JSON.parse(s.getItem('ssd:conds') || 'null');
        if (c && c.v === 1 && c.exp > Date.now() && c.day && c.night) {
          var night = dk === 'night'
            || (dk === 'meal' && Number(s.getItem('ssd:night')) > Date.now());
          var pick = night ? c.night : c.day;
          var joined = (pick.conds || []).join(' ');
          if (/^[a-z0-9 -]+$/.test(joined)) root.dataset.conds = joined;
        }
      } catch (e2) {}
    }
    // Hebrew face. The roster and default come from manifest.mjs via
    // build.mjs::relocate, so adding a font needs no edit here.
    //
    // This owns the preload for EVERY face, default included — a static
    // <link> in the template could only ever name the default, and would be
    // dead weight (~21 KB at high priority, ahead of the face actually in
    // use) for anyone who picked something else.
    var fonts = window.__FONTS__ || [];
    var def = window.__DEFAULT_FONT__;
    var f = s.getItem('ssd:font');
    if (!f || fonts.indexOf(f) === -1) f = def;
    // The default face is the :root --serif-he value, so it needs no
    // attribute; setting one for it would just add a redundant selector.
    if (f && f !== def) root.dataset.font = f;
    if (f) {
      var link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'font';
      link.type = 'font/woff2';
      link.crossOrigin = 'anonymous';
      link.href = (window.__BASE__ || '/') + 'fonts/he-' + f + '-400.woff2';
      document.head.appendChild(link);
    }
  } catch (e) {}
})();
