// OnlineSiddur — vanilla client JS.
// Handles: theme toggle, lang toggle, text size, headings on/off, nikud on/off
// (template-swap), wake lock (with release event), home prayer-card routing,
// and nusach pick persistence. ~4 KB.

(function () {
  var root = document.documentElement;
  var ls = window.localStorage;
  var SK = {
    theme: 'ssd:theme',
    lang: 'ssd:lang',
    nusach: 'ssd:nusach',
    size: 'ssd:textsize',
    leading: 'ssd:leading',
    headings: 'ssd:headings',
    nikud: 'ssd:nikud',
    awake: 'ssd:awake',
    font: 'ssd:font',
    filter: 'ssd:filter',
    conds: 'ssd:conds',
    night: 'ssd:night',
    location: 'ssd:location',
    pos: 'ssd:pos',
  };
  // Hebrew face roster, injected per page by build/build.mjs::relocate from
  // manifest.mjs::FONT_IDS — the single source of truth, so adding a font
  // needs no edit here. DEFAULT_FONT needs no data-font attribute; it is the
  // :root --serif-he value.
  var FONTS = window.__FONTS__ || [];
  var DEFAULT_FONT = window.__DEFAULT_FONT__;

  // ── Persistence helpers ──
  function set(k, v) { try { ls.setItem(k, v); } catch (_) {} }
  function get(k) { try { return ls.getItem(k); } catch (_) { return null; } }
  function del(k) { try { ls.removeItem(k); } catch (_) {} }

  // ── Force refresh (?fresh) ──
  // Any page + `?fresh` removes this site's service-worker registration
  // and caches, then reloads the clean URL from the network. Saved
  // preferences stay; the computed-conditions cache and the reading
  // position do not. The reload removes the parameter, so no loop is
  // possible. Scoped tightly: github.io serves many projects from one
  // origin, so only `siddur-` caches and this scope's registration go.
  // Offline, the reset is refused — it would delete the cached siddur
  // and leave nothing to reload.
  var freshPending = /[?&]fresh(=|&|$)/.test(location.search);
  if (freshPending && navigator.onLine === false) freshPending = false;
  if (freshPending) {
    (function () {
      var done = function () {
        del(SK.conds);
        del(SK.pos);
        var p = new URLSearchParams(location.search);
        p.delete('fresh');
        var q = p.toString();
        location.replace(location.pathname + (q ? '?' + q : '') + location.hash);
      };
      var jobs = [];
      try {
        if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistration) {
          jobs.push(navigator.serviceWorker.getRegistration(window.__BASE__ || '/').then(function (r) {
            return r && r.unregister();
          }));
        }
        if (window.caches) {
          jobs.push(caches.keys().then(function (ks) {
            return Promise.all(ks.map(function (k) {
              return k.indexOf('siddur-') === 0 ? caches.delete(k) : null;
            }));
          }));
        }
      } catch (_) {}
      Promise.all(jobs).then(done, done);
    })();
  }

  // ── Analytics ──
  // Which chrome controls readers actually reach for. Every call site is a
  // user gesture on a control the reader chose to press, so a dropped event
  // (umami blocked, still loading, or offline) must never surface — hence the
  // guard and the swallow. Only ever called from toggles, never from the
  // init() sync pass, which would report a preference as a fresh click.
  function track(name, data) {
    try { if (window.umami) window.umami.track(name, data); } catch (_) {}
  }

  // ── Theme ──
  function setTheme(t) {
    root.dataset.theme = t;
    set(SK.theme, t);
    document.querySelectorAll('[data-act="theme"]').forEach(function (b) {
      // The Today panel's "Dark mode" row is a switch (checkmark styling
      // keys on aria-checked); the section-bar button is a pressed pill.
      var attr = b.getAttribute('role') === 'switch' ? 'aria-checked' : 'aria-pressed';
      b.setAttribute(attr, t === 'dark' ? 'true' : 'false');
    });
    // Keep the installed window's status bar in step with the page. The theme
    // is resolved from localStorage, NOT from prefers-color-scheme, so a
    // media-gated <meta> cannot express it — an OS-dark reader who has never
    // touched the toggle reads a light page and would get a black status bar.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? meta.dataset.dark : meta.dataset.light);
  }
  function toggleTheme() {
    setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
    track('theme', { mode: root.dataset.theme });
  }

  // ── Language ──
  function setLang(l) {
    root.dataset.lang = l;
    set(SK.lang, l);
    document.querySelectorAll('[data-act="lang"]').forEach(function (b) {
      // Show the OPPOSITE language as the toggle target.
      var labelEn = b.querySelector('[data-toggle-to="he"]');
      var labelHe = b.querySelector('[data-toggle-to="en"]');
      if (labelEn) labelEn.style.display = l === 'en' ? '' : 'none';
      if (labelHe) labelHe.style.display = l === 'he' ? '' : 'none';
    });
    // Sync title attributes on icon-only buttons that carry bilingual labels.
    document.querySelectorAll('[data-tooltip-en][data-tooltip-he]').forEach(function (b) {
      b.title = l === 'he' ? b.dataset.tooltipHe : b.dataset.tooltipEn;
    });
  }
  function toggleLang() {
    setLang(root.dataset.lang === 'he' ? 'en' : 'he');
    track('lang', { lang: root.dataset.lang });
  }

  // ── Text size ──
  function setSize(px) {
    var sz = Math.max(14, Math.min(40, px | 0));
    root.style.setProperty('--size', sz + 'px');
    set(SK.size, String(sz));
    document.querySelectorAll('[data-size-display]').forEach(function (e) {
      e.textContent = String(sz);
    });
  }
  function bumpSize(delta) {
    var current = parseInt(getComputedStyle(root).getPropertyValue('--size'), 10) || window.__DEFAULT_SIZE__;
    setSize(current + delta);
    trackTypeSize();
  }

  // ── Line height ──
  function setLeading(lh) {
    var v = Math.max(1.3, Math.min(2.6, Math.round(lh * 20) / 20));
    root.style.setProperty('--lh', String(v));
    set(SK.leading, String(v));
    document.querySelectorAll('[data-leading-display]').forEach(function (e) {
      e.textContent = v.toFixed(2);
    });
  }
  function bumpLeading(delta) {
    var current = parseFloat(getComputedStyle(root).getPropertyValue('--lh')) || window.__DEFAULT_LH__;
    setLeading(current + delta);
    trackTypeSize();
  }

  // Steppers fire on every tap, but what matters is the value the reader
  // settles on — so report once the run of taps stops. Size and leading
  // travel together: 26px at 1.4 and 26px at 1.9 are different reading
  // experiences, and it is the pair that says whether DEFAULT_SIZE and
  // DEFAULT_LH are right for the people actually using this.
  var typeT;
  function trackTypeSize() {
    clearTimeout(typeT);
    typeT = setTimeout(function () {
      track('text-size', {
        size: parseInt(getComputedStyle(root).getPropertyValue('--size'), 10),
        leading: parseFloat(getComputedStyle(root).getPropertyValue('--lh')),
      });
    }, 1200);
  }

  // ── Hebrew font ──
  // Non-default faces use font-display:swap, so flipping data-font immediately
  // would paint one frame of fallback text before the face arrives. Waiting on
  // document.fonts.load() first makes the switch a single clean repaint. The
  // font is already decided by the time the promise settles, so the await costs
  // nothing on a repeat pick (the face is cached) and is invisible otherwise.
  // Selection state is applied optimistically; only the actual face swap
  // waits for the font. Deferring the checkmark too would leave a tap on a
  // slow connection looking like nothing happened.
  function markFontChecked(id) {
    document.querySelectorAll('[data-act="pick-font"]').forEach(function (b) {
      var on = b.dataset.font === id;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      // Roving tabindex: the radiogroup is one tab stop, arrows move within.
      b.tabIndex = on ? 0 : -1;
    });
  }
  function applyFont(id) {
    if (id === DEFAULT_FONT) root.removeAttribute('data-font');
    else root.dataset.font = id;
    markFontChecked(id);
  }
  // Guards against out-of-order resolution: a slow earlier pick must not
  // overwrite a fast later one. Only the newest request may apply.
  var fontSeq = 0;
  function setFont(id) {
    if (FONTS.indexOf(id) === -1) return;
    set(SK.font, id);
    markFontChecked(id);
    // Resolve the family off the picker row's own preview span, so the family
    // name lives in exactly one place (styles.css) rather than being duplicated
    // here. Falls back to an immediate apply if the row or the API is missing.
    var row = document.querySelector('[data-act="pick-font"][data-font="' + id + '"]');
    var sample = row && row.querySelector('.type-font-sample');
    if (!sample || !document.fonts || !document.fonts.load) { applyFont(id); return; }
    var family = getComputedStyle(sample).fontFamily;
    var px = parseInt(getComputedStyle(root).getPropertyValue('--size'), 10) || window.__DEFAULT_SIZE__;
    // The sample text MUST be passed: load() matches faces by unicode-range
    // against its text argument, which defaults to a single space — and every
    // Hebrew face excludes U+0020, so omitting it matched zero faces and
    // resolved instantly, defeating the whole point of waiting.
    var text = sample.textContent;
    var seq = ++fontSeq;
    Promise.all([
      document.fonts.load('400 ' + px + 'px ' + family, text),
      document.fonts.load('700 ' + px + 'px ' + family, text),
    ]).then(done, done);
    function done() { if (seq === fontSeq) applyFont(id); }
  }

  // ── Headings ──
  function setHeadings(state) {
    root.dataset.headings = state;
    set(SK.headings, state);
    document.querySelectorAll('[data-act="headings"]').forEach(function (b) {
      b.setAttribute('aria-pressed', state === 'on' ? 'true' : 'false');
    });
  }
  function toggleHeadings() {
    setHeadings(root.dataset.headings === 'off' ? 'on' : 'off');
    track('headings', { state: root.dataset.headings });
  }

  // ── Nikud (template-swap) ──
  // Each readable region (.reading-body or .bracha-flow) has a paired
  // <template data-nikud-alt> sibling holding the OPPOSITE-state contents.
  // Toggle = swap the live region's children with the template's clone.
  function toggleRegion(region) {
    var tmpl = region.nextElementSibling;
    if (!tmpl || tmpl.tagName !== 'TEMPLATE' || tmpl.dataset.nikudAlt == null) return;
    var altFrag = tmpl.content.cloneNode(true);
    var stash = document.createElement('template');
    stash.dataset.nikudAlt = '';
    while (region.firstChild) stash.content.appendChild(region.firstChild);
    region.appendChild(altFrag);
    region.parentNode.replaceChild(stash, tmpl);
    region.parentNode.insertBefore(stash, region.nextSibling);
  }
  function setNikud(state) {
    var current = root.dataset.nikud || 'on';
    if (current === state) {
      // Sync UI only.
    } else {
      document.querySelectorAll('.reading-body, .bracha-flow').forEach(toggleRegion);
      root.dataset.nikud = state;
      // Heading sec-N IDs persist into the swapped-in template clone, but
      // they're fresh DOM nodes — re-attach the IntersectionObserver.
      attachSectionObserver();
    }
    set(SK.nikud, state);
    document.querySelectorAll('[data-act="nikud"]').forEach(function (b) {
      b.setAttribute('aria-pressed', state === 'on' ? 'true' : 'false');
    });
  }
  function toggleNikud() {
    setNikud(root.dataset.nikud === 'off' ? 'on' : 'off');
    track('nikud', { state: root.dataset.nikud });
  }

  // ── Wake lock ──
  var wakeSentinel = null;
  function setAwakeUI(on) {
    document.querySelectorAll('[data-act="awake"]').forEach(function (b) {
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function acquireWake() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (sentinel) {
      wakeSentinel = sentinel;
      setAwakeUI(true);
      sentinel.addEventListener('release', function () {
        // OS released the lock (battery/thermal/visibility). Reflect in UI;
        // user-toggle preference is preserved in localStorage.
        wakeSentinel = null;
        if (get(SK.awake) === 'on') setAwakeUI(false); // sentinel gone, but pref still on
      });
    }).catch(function () { /* unsupported / denied — silent */ });
  }
  function releaseWake() {
    if (wakeSentinel) wakeSentinel.release().catch(function () {});
    wakeSentinel = null;
    setAwakeUI(false);
  }
  function setAwake(state) {
    set(SK.awake, state);
    if (state === 'on') acquireWake(); else releaseWake();
    setAwakeUI(state === 'on');
  }
  function toggleAwake() {
    var next = get(SK.awake) === 'on' ? 'off' : 'on';
    setAwake(next);
    track('awake', { state: next });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && get(SK.awake) === 'on' && !wakeSentinel) {
      acquireWake();
    }
  });

  // ── Nusach picker / home routing ──
  // Navigation uses window.__BASE__ (injected per page by build/build.mjs::relocate)
  // so the same JS works at any deploy depth: './', '../', '../../', etc.
  // Always ends in '/'; appended segments must NOT start with '/'.
  var BASE = window.__BASE__ || '/';
  // Bilingual labels for the home-page nusach pill. Must stay in sync with
  // build/lib/manifest.mjs::NUSACHIM (4 ids, fixed by tradition — rare churn).
  var NUSACH_LABELS = {
    ashkenaz: { en: 'Ashkenaz',        he: 'אשכנז' },
    sefard:   { en: 'Sefard',          he: 'ספרד' },
    ari:      { en: 'Ari',             he: 'האר״י' },
    edut:     { en: 'Edut HaMizrach',  he: 'עדות המזרח' },
  };
  function pickNusach(nusachId, fromPrayerId) {
    set(SK.nusach, nusachId);
    // Separates an active choice from arriving at a nusach page with a saved
    // preference or from a search result — the destination pageview alone
    // cannot tell those apart. Safe to fire immediately before navigating:
    // umami sends with fetch keepalive, which outlives the unload.
    track('nusach', { nusach: nusachId });
    var dest = fromPrayerId ? BASE + fromPrayerId + '/' + nusachId + '/' : BASE;
    location.href = dest;
  }
  function openPrayer(prayerId) {
    var n = get(SK.nusach);
    if (n) location.href = BASE + prayerId + '/' + n + '/';
    else location.href = BASE + 'nusach/?from=' + prayerId;
  }
  // Home-page only: reflect the saved nusach in the .nusach-pill so the user
  // sees that their pick was retained. Server renders the pill with
  // data-empty="true" and "choose"/"בחר" labels; this updates it on load.
  function syncHomeNusachPill() {
    var pill = document.querySelector('.nusach-pill');
    if (!pill) return;
    var saved = get(SK.nusach);
    var lab = saved && NUSACH_LABELS[saved];
    if (!lab) return;
    var value = pill.lastElementChild;
    if (!value) return;
    var en = value.querySelector('[data-lang-en]');
    var he = value.querySelector('[data-lang-he]');
    if (en) en.textContent = lab.en;
    if (he) he.textContent = lab.he;
    pill.setAttribute('data-empty', 'false');
  }

  // ── Section-jump bar (reading pages only) ──
  // Open/close the panel, smooth-scroll on chapter click, and run an
  // IntersectionObserver over the sec-N headings to update the bar's
  // "current chapter" label and the active row in the panel.
  var sectionObserver = null;
  // Track which chapter headings are currently above the bar's bottom edge.
  // The most-recent passed (highest blockIndex) is "current".
  var passedSections = new Set();
  function setCurrent(id) {
    // Update only the section-name span inside the bar title — prayer/nusach
    // labels stay constant, only the section name changes as you scroll.
    var nameSpan = document.querySelector('[data-current-section-name]');
    if (!nameSpan) return;
    var item = document.querySelector('.section-panel-item[data-jump="' + id + '"]');
    if (!item) return;
    nameSpan.textContent = item.textContent;
    document.querySelectorAll('.section-panel-item[aria-current="true"]')
      .forEach(function (el) { el.removeAttribute('aria-current'); });
    item.setAttribute('aria-current', 'true');
  }
  function pickCurrentFromPassed() {
    if (passedSections.size === 0) return;
    // Highest sec-N number among passed = most recent above the bar.
    var maxN = -1;
    passedSections.forEach(function (id) {
      var n = parseInt(id.slice(4), 10);
      if (n > maxN) maxN = n;
    });
    if (maxN >= 0) setCurrent('sec-' + maxN);
  }
  function attachSectionObserver() {
    if (sectionObserver) { sectionObserver.disconnect(); sectionObserver = null; }
    if (!('IntersectionObserver' in window)) return;
    var targets = document.querySelectorAll('.reading-body [id^="sec-"]');
    if (!targets.length) return;
    // The scroll-spy "current" line must coincide with where a jumped-to
    // heading parks: its CSS scroll-margin-top (sized to clear site-head +
    // section-bar — 110 desktop / 150 mobile). Using the measured bar
    // bottom instead would put the line a few px ABOVE the parked heading,
    // so a jumped section reads as "not yet passed" and the bar shows the
    // PREVIOUS section. Read the offset off a real sec heading so desktop
    // and mobile stay correct; fall back to the measured bar bottom.
    var bar = document.querySelector('[data-section-bar]');
    var barBottom = bar ? Math.max(56, Math.round(bar.getBoundingClientRect().bottom)) : 96;
    var anchorLine = barBottom;
    var sm = parseInt(getComputedStyle(targets[0]).scrollMarginTop, 10);
    if (sm > 0) anchorLine = sm;
    passedSections = new Set();
    sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var id = entry.target.id;
        // A calendar-filtered section is display:none: its rect is all
        // zeros, which reads as "passed" and would pin the label to the
        // highest-numbered hidden section. Skip hidden targets.
        if (entry.target.offsetParent === null) { passedSections.delete(id); return; }
        var passed = entry.boundingClientRect.top < (entry.rootBounds ? entry.rootBounds.top + 1 : anchorLine + 1);
        if (passed) passedSections.add(id); else passedSections.delete(id);
      });
      pickCurrentFromPassed();
    }, {
      rootMargin: '-' + anchorLine + 'px 0px 0px 0px',
      threshold: [0, 1],
    });
    targets.forEach(function (t) { sectionObserver.observe(t); });
  }

  function isPanelOpen() {
    var panel = document.querySelector('[data-section-panel]');
    return panel && !panel.hasAttribute('hidden');
  }
  function openSections() {
    var panel = document.querySelector('[data-section-panel]');
    if (!panel) return;
    panel.removeAttribute('hidden');
    document.body.classList.add('section-open');
  }
  function closeSections() {
    var panel = document.querySelector('[data-section-panel]');
    if (!panel) return;
    panel.setAttribute('hidden', '');
    document.body.classList.remove('section-open');
  }
  function jumpToSection(id) {
    closeSections();
    var el = document.getElementById(id);
    if (!el) return;
    // closeSections() removes body.section-open (which had applied
    // overflow:hidden) and hides the panel — both mutate layout. A
    // scrollIntoView issued before that reflow settles is computed
    // against the still-locked scroll container and silently no-ops
    // (observed as the dropdown "not scrolling" on long pages). A single
    // rAF only guarantees the callback runs before the next paint, not
    // that the reflow finished; a second nested rAF runs after a full
    // layout+paint cycle, by which point the unlock has settled.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // ── Popovers (download menu, type menu) ──
  // Both are a trigger button plus a [hidden] sibling panel inside a relative
  // wrapper, with identical open / close / dismiss-on-outside-click / Escape
  // behaviour — so they share one implementation keyed by their attributes.
  var POPOVERS = [
    { wrap: '[data-download-toggle]', menu: '[data-download-menu]', act: 'open-download' },
    { wrap: '[data-type-toggle]', menu: '[data-type-menu]', act: 'open-type' },
    { wrap: '[data-today-toggle]', menu: '[data-today-menu]', act: 'open-today' },
  ];
  function closePopover(menu, spec) {
    // Focus must leave before the panel is hidden — otherwise activeElement
    // is left on a display:none node and the next Tab restarts from the top
    // of the document. Only pull it back if it is actually inside the panel,
    // so an outside click doesn't steal focus from wherever the user went.
    var btn = menu.parentNode.querySelector('[data-act="' + spec.act + '"]');
    if (btn && menu.contains(document.activeElement)) btn.focus();
    menu.setAttribute('hidden', '');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
  // The type popover is role="dialog"; announcing a dialog and then leaving
  // focus outside it tells a screen-reader user nothing was opened. Land on
  // the checked font so arrow keys work immediately.
  function focusPopover(menu) {
    var target = menu.querySelector('[aria-checked="true"], button, a');
    if (target) target.focus();
  }
  // Arrow-key navigation within the font radiogroup, which the radio role
  // requires and which a plain tab-stop-per-button list does not provide.
  function moveFontFocus(from, delta) {
    var rows = [].slice.call(document.querySelectorAll('[data-act="pick-font"]'));
    var i = rows.indexOf(from);
    if (i === -1) return;
    var next = rows[(i + delta + rows.length) % rows.length];
    next.focus();
    setFont(next.dataset.font);
  }
  function closeAllPopovers() {
    POPOVERS.forEach(function (p) {
      document.querySelectorAll(p.menu + ':not([hidden])').forEach(function (m) { closePopover(m, p); });
    });
  }

  // ── Today (calendar filter + Hebrew date) ──
  // The engine (dist/calendar.js: vendored hebcal + rules) loads lazily
  // after window load, never on the critical path. Its output is cached in
  // localStorage; pre-paint.js replays the cache before first paint, so a
  // repeat visit filters with no content shift. See static/calendar.js for
  // the day/night/meal page-kind rule.
  var todayResult = null;
  var todayTimer = null;
  var engineWanted = false;
  var enginePending = false;
  var pendingUserAction = false;

  function daykind() { return root.dataset.daykind || ''; }
  function nightFlipActive() { return Number(get(SK.night)) > Date.now(); }

  // QA override: ?date=2026-12-05T20:00 renders the site as-if that local
  // date and time. A bare date gets a midday time — date-only strings
  // parse as UTC midnight, which is the previous evening in the Americas.
  function debugDate() {
    var p = new URLSearchParams(location.search).get('date');
    if (!p) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) p += 'T12:00';
    var d = new Date(p);
    return isNaN(d) ? null : d;
  }

  // Fallback for applyToday before the engine has loaded — same rule as
  // OSCal.setFor and pre-paint.js.
  function pickSet(result) {
    if (window.OSCal) return window.OSCal.setFor(result, daykind(), nightFlipActive());
    var night = daykind() === 'night' || (daykind() === 'meal' && nightFlipActive());
    return night ? result.night : result.day;
  }

  // applyFilter syncs the attribute and UI; setFilter also persists. init
  // uses applyFilter so a never-touched default is not written as a saved
  // preference (same convention as applyFont vs setFont).
  function applyFilter(state) {
    if (daykind()) root.dataset.filter = state;
    document.querySelectorAll('[data-act="filter"]').forEach(function (b) {
      b.setAttribute('aria-checked', state === 'on' ? 'true' : 'false');
    });
  }
  function setFilter(state) {
    applyFilter(state);
    set(SK.filter, state);
  }
  function toggleFilter() {
    setFilter(root.dataset.filter === 'off' ? 'on' : 'off');
    reseedSectionLabel();
    track('filter', { state: root.dataset.filter });
  }

  function setLocationUi(loc) {
    document.querySelectorAll('[data-act="pick-location"]').forEach(function (b) {
      var on = b.dataset.location === loc;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
  }
  function setLocationPref(loc) {
    set(SK.location, loc);
    setLocationUi(loc);
    // Israel/diaspora changes the token sets — recompute and apply now:
    // this is an explicit tap, so it must not defer behind the scroll
    // guard.
    refreshToday(true);
  }

  function toggleNight() {
    if (nightFlipActive()) {
      set(SK.night, '0');
    } else {
      // The flip lasts until midnight. After midnight the civil date has
      // advanced, so the day set already describes the night's Hebrew day.
      var now = new Date();
      var midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
      set(SK.night, String(midnight.getTime()));
    }
    syncNightUi();
    if (todayResult) applyToday(todayResult, true);
    initTehilimCycle();
    track('nightfall', { state: nightFlipActive() ? 'on' : 'off' });
  }
  function syncNightUi() {
    document.querySelectorAll('[data-act="night"]').forEach(function (b) {
      b.setAttribute('aria-checked', nightFlipActive() ? 'true' : 'false');
    });
  }

  // Apply a compute() result: stamp data-conds, fill the date pill, and
  // keep the section-panel label on a visible section. An explicit tap
  // (`userAction`) always applies at once. Anything else applies only
  // near the top of the page — text must never move under someone
  // mid-prayer. A deferred set still reaches the cache, so the next
  // load paints it.
  function applyToday(result, userAction) {
    var pick = pickSet(result);
    var joined = pick.conds.join(' ');
    if (root.dataset.conds !== joined) {
      // The FIRST application always lands — a page that never filters
      // is worse than one early reflow. Only later boundary changes
      // defer while the reader is scrolled into the text.
      if (userAction || root.dataset.conds == null || window.scrollY < 120) {
        root.dataset.conds = joined;
        // Visibility changed under the scroll-spy: rebuild its passed
        // set, or the label can snap back to a now-hidden section.
        attachSectionObserver();
        // A restore that waited for the filter can run now.
        if (posDeferred) { posDeferred = false; restorePos(); }
      }
    }
    reseedSectionLabel();
    syncNightUi();
    updateOmerNote(pick);
    fillDatePill(pick.he, pick.en);
  }

  // The omer page shows tonight's count from midday on (the user's
  // chosen rule). Say which night the count belongs to, so an afternoon
  // reader is not misled.
  function updateOmerNote(pick) {
    var hasOmer = document.querySelector('.reading-body [data-when^="omer-"]');
    if (!hasOmer) return;
    var head = document.querySelector('.reading-head');
    if (!head) return;
    var note = document.querySelector('[data-omer-note]');
    if (!note) {
      note = document.createElement('p');
      note.setAttribute('data-omer-note', '');
      note.className = 'omer-note';
      head.appendChild(note);
    }
    var counted = false;
    for (var i = 0; i < pick.conds.length; i++) {
      if (/^omer-\d+$/.test(pick.conds[i])) counted = true;
    }
    if (!counted || root.dataset.filter === 'off') { note.hidden = true; return; }
    note.hidden = false;
    note.innerHTML = '<span data-lang-en>Counting for: ' + escapeText(pick.en) + ' (after sunset)</span>'
      + '<span data-lang-he lang="he">הספירה עבור ' + escapeText(pick.he) + ' (אחרי השקיעה)</span>';
  }
  function escapeText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Fills the pill, the panel's date row, and the reading-head date line
  // (same data attributes).
  function fillDatePill(he, en) {
    var pill = document.querySelector('[data-act="open-today"]');
    if (!pill) return;
    document.querySelectorAll('[data-date-he]').forEach(function (el) { el.textContent = he; });
    document.querySelectorAll('[data-date-en]').forEach(function (el) { el.textContent = en; });
    document.querySelectorAll('[data-date-wrap]').forEach(function (el) { el.hidden = false; });
    pill.hidden = false;
  }

  // With filtering on, section 0 can be hidden — the server-seeded label
  // would then name a section that is not on the page. Row visibility is
  // read from each row's own <li>: the hide rule targets the li's
  // data-when, and computed display works while the panel itself is
  // closed (offsetParent does not — the closed panel is display:none).
  function rowVisible(row) {
    var li = row.parentNode;
    return !li || getComputedStyle(li).display !== 'none';
  }
  function reseedSectionLabel() {
    var label = document.querySelector('[data-current-section-name]');
    if (!label) return;
    var rows = [].slice.call(document.querySelectorAll('.section-panel-item'));
    var current = null;
    rows.forEach(function (r) { if (r.getAttribute('aria-current') === 'true') current = r; });
    if (current && rowVisible(current)) return;
    for (var i = 0; i < rows.length; i++) {
      if (rowVisible(rows[i])) {
        if (current) current.removeAttribute('aria-current');
        rows[i].setAttribute('aria-current', 'true');
        label.textContent = rows[i].textContent;
        return;
      }
    }
  }

  function refreshToday(userAction) {
    if (!window.OSCal) {
      // Remember an explicit tap made before the engine loaded, so the
      // post-load refresh still bypasses the scroll guard.
      if (userAction === true) pendingUserAction = true;
      return;
    }
    if (pendingUserAction) { userAction = true; pendingUserAction = false; }
    var dbg = debugDate();
    var result = window.OSCal.compute({
      location: get(SK.location) || 'auto',
      now: dbg || undefined,
    });
    todayResult = result;
    // A ?date= QA result must never reach the cache pre-paint replays —
    // it would filter later real visits for the fake date.
    if (!dbg) set(SK.conds, JSON.stringify(result));
    applyToday(result, userAction === true);
    // Recompute at the next midday/midnight boundary, and when the tab
    // comes back after the boundary passed.
    clearTimeout(todayTimer);
    var delay = result.exp - Date.now();
    if (delay > 0 && delay < 24 * 3600 * 1000) todayTimer = setTimeout(refreshToday, delay + 1000);
  }

  // Chrome pages only need the date string — Intl's Hebrew calendar
  // covers that without the 55 KB engine. Prayer pages load the engine.
  function fillPillFromIntl() {
    try {
      var now = debugDate() || new Date();
      var he = new Intl.DateTimeFormat('he-u-ca-hebrew', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
      var en = new Intl.DateTimeFormat('en-u-ca-hebrew', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
      fillDatePill(he, en);
    } catch (_) {}
  }

  // The Today panel's date input starts on today (or the active ?date=
  // override). Picking a day reloads the page with ?date=YYYY-MM-DD so
  // the whole compute path runs for that date; picking today again
  // returns to the clean URL. Local date parts, not toISOString — UTC
  // would shift the date for anyone west of Greenwich in the evening.
  function localYmd(d) {
    var m = String(d.getMonth() + 1), day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }
  function initDateInput() {
    var val = localYmd(debugDate() || new Date());
    document.querySelectorAll('[data-date-input]').forEach(function (inp) {
      inp.value = val;
      inp.addEventListener('change', function () {
        if (!inp.value || inp.value === val) return;
        track('date-pick', { date: inp.value });
        if (inp.value === localYmd(new Date())) {
          location.href = urlWithout('date');
          return;
        }
        var params = new URLSearchParams(location.search);
        params.delete('fresh');
        params.set('date', inp.value);
        location.href = location.pathname + '?' + params.toString();
      });
    });
  }

  // Returns the current URL without one query parameter. `fresh` is
  // always dropped too: a refused offline reset must not ride along
  // into the next navigation and fire later.
  function urlWithout(param) {
    var p = new URLSearchParams(location.search);
    p.delete(param);
    p.delete('fresh');
    var q = p.toString();
    return location.pathname + (q ? '?' + q : '');
  }

  // A fixed strip at the bottom of the viewport whenever ?date= is
  // present (valid or not), so the reader always sees that the page
  // shows another day. Fixed-bottom, because the sticky header stack
  // already owns the top and would cover a strip there on scroll.
  function showDateBanner() {
    if (!/[?&]date(=|&|$)/.test(location.search)) return;
    var href = escapeText(urlWithout('date'));
    var b = document.createElement('div');
    b.className = 'date-banner';
    b.innerHTML = '<span data-lang-en>Showing another day · <a href="' + href + '">Return to today</a></span>'
      + '<span data-lang-he lang="he">מוצג יום אחר · <a href="' + href + '">חזרה להיום</a></span>';
    document.body.appendChild(b);
    // Reserve room so the strip never covers the last lines of the
    // prayer or the footer.
    document.body.classList.add('has-date-banner');
  }

  // Fills the date line from Intl before the engine loads, with the
  // page-kind wall-clock rule, so an early print carries the date. The
  // engine replaces it with the authoritative value after load.
  function fillDateFallback() {
    var pill = document.querySelector('[data-act="open-today"]');
    if (!pill || !pill.hidden) return; // already filled from the cache
    try {
      var d = new Date((debugDate() || new Date()).getTime());
      var kind = daykind();
      if (kind === 'night' && d.getHours() >= 12) d.setDate(d.getDate() + 1);
      if (kind === 'meal' && nightFlipActive()) d.setDate(d.getDate() + 1);
      var he = new Intl.DateTimeFormat('he-u-ca-hebrew', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
      var en = new Intl.DateTimeFormat('en-u-ca-hebrew', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
      fillDatePill(he, en);
    } catch (_) {}
  }

  // Print stays inside the user gesture — an async print() is dropped
  // by browsers that gate the dialog on activation. With the engine
  // loaded but not applied, compute synchronously first; without the
  // engine, print the complete text (a full sheet is safe — it is what
  // a printed siddur shows) while the date line already carries the
  // fallback date.
  function printPage() {
    closeAllPopovers();
    track('print', {});
    if (daykind() && root.dataset.filter !== 'off' && root.dataset.conds == null && window.OSCal) {
      refreshToday(true);
    }
    window.print();
  }

  // ── Reading-position memory ──
  // A reader who returns to the same prayer within two hours lands
  // where they left off. One key, last reading page only; a return to
  // the top clears it. The position is anchored to the nearest section
  // id, so a font swap or a text-size change cannot move the reader to
  // a different prayer; the raw offset is the fallback for pages that
  // have no sections.
  var POS_MIN = 400;
  var POS_TTL = 2 * 3600 * 1000;
  var posRestoreTime = 0;
  var posUserMoved = false;
  // The reader reached deep into the page this session — only then may
  // a return to the top delete the memory (a failed restore must not).
  var posSeenDeep = false;
  // restorePos declined because the filter had not run yet; retry once
  // after the first condition set lands.
  var posDeferred = false;
  function readPos() {
    try { return JSON.parse(get(SK.pos) || 'null'); } catch (_) { return null; }
  }
  function anchorFor(y) {
    var secs = document.querySelectorAll('.reading-body .section[id^="sec-"]');
    var best = null;
    for (var i = 0; i < secs.length; i++) {
      // A calendar-hidden section reports rect.top 0 and would always
      // win the comparison — skip it.
      if (secs[i].offsetParent === null) continue;
      var top = secs[i].getBoundingClientRect().top + window.scrollY;
      if (top <= y + 10) best = { id: secs[i].id, dy: Math.round(y - top) };
      else break;
    }
    return best;
  }
  function savePos() {
    // A restore scrolls the page itself; give the layout two seconds
    // to settle so a clamped restore cannot overwrite the memory.
    if (Date.now() - posRestoreTime < 2000) return;
    var y = window.scrollY;
    var cur = readPos();
    if (y > POS_MIN) {
      posSeenDeep = true;
      // Keep the old timestamp when the position did not really move,
      // so re-opening the page does not renew the two-hour window.
      var t = (cur && cur.p === location.pathname && Math.abs((cur.y || 0) - y) < 150) ? cur.t : Date.now();
      var a = anchorFor(y);
      set(SK.pos, JSON.stringify({
        p: location.pathname, y: Math.round(y),
        sec: a ? a.id : undefined, dy: a ? a.dy : undefined, t: t,
      }));
    } else if (posSeenDeep && cur && cur.p === location.pathname) {
      del(SK.pos);
    }
  }
  function posTarget(cur) {
    if (cur.sec) {
      var el = document.getElementById(cur.sec);
      // A hidden anchor resolves but measures at 0 — fall back to the
      // raw offset instead of restoring to the top of the page.
      if (el && el.offsetParent !== null) {
        return el.getBoundingClientRect().top + window.scrollY + (cur.dy || 0);
      }
    }
    return cur.y;
  }
  function restorePos() {
    if (location.hash) return;
    // A ?date= preview always starts at the top.
    if (debugDate()) return;
    // A page whose filter has not run yet changes height when it does —
    // do not restore into text that is about to move. Pages with no
    // conditional text (no when-rules style) keep a stable height and
    // always restore. applyToday retries once when the first condition
    // set lands.
    if (daykind() && root.dataset.filter !== 'off' && root.dataset.conds == null
        && document.querySelector('style[data-when-rules]')) {
      posDeferred = true;
      return;
    }
    var cur = readPos();
    if (!cur || cur.p !== location.pathname || Date.now() - cur.t > POS_TTL || !(cur.y > POS_MIN)) return;
    posRestoreTime = Date.now();
    window.scrollTo(0, posTarget(cur));
    // The Hebrew face swaps in after first layout and reflows the page.
    // Re-anchor once, unless the reader has scrolled on their own.
    if (cur.sec && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (posUserMoved || Date.now() - posRestoreTime > 4000) return;
        posRestoreTime = Date.now();
        window.scrollTo(0, posTarget(cur));
      });
    }
  }
  function initPosMemory() {
    if (!document.body.classList.contains('page-reading') &&
        !document.body.classList.contains('page-bracha')) return;
    // A ?date= preview neither restores nor writes the memory — its
    // offsets belong to a different rendering of the page.
    if (debugDate()) return;
    restorePos();
    var posT;
    var flush = function () { clearTimeout(posT); savePos(); };
    window.addEventListener('scroll', function () {
      clearTimeout(posT);
      posT = setTimeout(savePos, 400);
    }, { passive: true });
    // The interruption this feature exists for arrives faster than the
    // debounce — write on the way out too.
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
    ['wheel', 'touchstart', 'keydown'].forEach(function (ev) {
      window.addEventListener(ev, function () { posUserMoved = true; }, { passive: true });
    });
  }

  // ── Daily Tehilim cycle ──
  // The traditional 30-day division of the book. The page keeps every
  // psalm visible; a note under the title names today's portion and
  // jumps to it, and a fresh visit opens at the portion. Days 25 and
  // 26 both start at Psalm 119, which the cycle splits between them.
  var TEHILIM_START = [1, 10, 18, 23, 29, 35, 39, 44, 49, 55, 60, 66, 69, 72, 77, 79, 83, 88, 90, 97, 104, 106, 108, 113, 119, 119, 120, 135, 140, 145];
  function initTehilimCycle() {
    if (!/\/tehilim\/$/.test(location.pathname)) return;
    var now = debugDate() || new Date();
    // The traditional cycle advances at nightfall; the panel's
    // After-nightfall switch moves the portion to the next day.
    if (!debugDate() && nightFlipActive()) now = new Date(now.getTime() + 24 * 3600 * 1000);
    var day, nextDay;
    try {
      var fmt = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric' });
      day = Number(fmt.format(now));
      nextDay = Number(fmt.format(new Date(now.getTime() + 24 * 3600 * 1000)));
    } catch (_) { return; }
    if (!(day >= 1 && day <= 30)) return;
    var start = TEHILIM_START[day - 1];
    var end = day < 30 ? TEHILIM_START[day] - 1 : 150;
    if (end < start) end = start;
    // In a 29-day month, day 29 also covers day 30's portion.
    if (day === 29 && nextDay === 1) end = 150;
    var secId = 'sec-' + (start - 1);
    var target = document.getElementById(secId);
    var head = document.querySelector('.reading-head');
    if (!target || !head) return;
    var range = start === end ? String(start) : start + '–' + end;
    // Days 25 and 26 split Psalm 119 between them.
    var rEn = range, rHe = range;
    if (day === 25) { rEn = '119 (first half)'; rHe = '119 (חלק ראשון)'; }
    if (day === 26) { rEn = '119 (second half)'; rHe = '119 (חלק שני)'; }
    var old = document.querySelector('[data-tehilim-note]');
    if (old) old.parentNode.removeChild(old);
    var note = document.createElement('p');
    note.className = 'omer-note';
    note.setAttribute('data-tehilim-note', '');
    note.innerHTML = '<button type="button" class="tehilim-jump" data-act="jump" data-jump="' + secId + '">'
      + '<span data-lang-en>Daily portion · day ' + day + ': Psalms ' + rEn + '</span>'
      + '<span data-lang-he lang="he">השיעור היומי · יום ' + day + ' לחודש: פרקים ' + rHe + '</span>'
      + '</button>';
    head.appendChild(note);
    // Open at the portion — but never move a reader who arrived at an
    // anchor or was put back at a remembered position. The scroll waits
    // two frames so the note's reflow settles (same reason as
    // jumpToSection), marks itself as a program scroll so savePos does
    // not store it, and re-anchors once after the Hebrew face loads.
    if (location.hash || posRestoreTime !== 0) return;
    var toPortion = function () {
      if (posUserMoved) return;
      posRestoreTime = Date.now();
      target.scrollIntoView();
    };
    requestAnimationFrame(function () { requestAnimationFrame(toPortion); });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (Date.now() - posRestoreTime < 4000) toPortion();
      });
    }
  }

  function loadCalendarEngine() {
    if (!daykind()) { fillPillFromIntl(); return; }
    engineWanted = true;
    if (window.OSCal) { refreshToday(); return; }
    if (enginePending) return; // a request is already in flight
    enginePending = true;
    var sc = document.createElement('script');
    sc.src = (window.__BASE__ || '/') + 'calendar.js';
    sc.onload = function () { enginePending = false; refreshToday(); };
    // A failed fetch retries when the tab next becomes visible.
    sc.onerror = function () { enginePending = false; sc.parentNode.removeChild(sc); };
    document.head.appendChild(sc);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (engineWanted && !window.OSCal) { loadCalendarEngine(); return; }
    if (todayResult && todayResult.exp <= Date.now()) refreshToday();
  });

  // ── Wire up ──
  function init() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]');
      var act = t && t.dataset.act;
      // The download menu's two entries are plain <a download> links with no
      // [data-act], so they are matched here instead of in the action chain.
      var dl = e.target.closest('[data-download-menu] a');
      if (dl) track('download', { format: dl.textContent.trim().toLowerCase() });
      // If this click is a popover trigger, note whether its panel was already
      // open BEFORE the dismiss pass below closes it — that's what makes the
      // trigger toggle rather than always re-open.
      var spec = null;
      POPOVERS.forEach(function (p) { if (act === p.act) spec = p; });
      var wasOpen = false;
      if (spec) {
        var own = t.closest(spec.wrap);
        var ownMenu = own && own.querySelector(spec.menu);
        wasOpen = !!ownMenu && !ownMenu.hasAttribute('hidden');
      }
      // Dismiss any open popover the click landed outside of. Runs for
      // [data-act] clicks too, so hitting another bar control closes an open
      // menu instead of leaving two popovers fighting for the same corner.
      //
      // The test is against the MENU, not its wrapper: the wrapper also holds
      // the trigger button, so testing the wrapper meant a trigger click was
      // never dismissed — and since the re-open branch below skips an
      // already-open menu, the popover became impossible to close from its
      // own button. A link inside a menu navigates away, so it dismisses too.
      POPOVERS.forEach(function (p) {
        document.querySelectorAll(p.menu + ':not([hidden])').forEach(function (m) {
          if (!m.contains(e.target) || e.target.closest('a')) closePopover(m, p);
        });
      });
      if (!t) {
        // Click outside any [data-act] — if the panel is open and the click
        // wasn't inside it, close.
        if (isPanelOpen()) {
          var panel = document.querySelector('[data-section-panel]');
          if (panel && !panel.contains(e.target)) closeSections();
        }
        return;
      }
      if (act === 'theme') { toggleTheme(); }
      else if (act === 'lang') { toggleLang(); }
      else if (act === 'size-up') { bumpSize(2); }
      else if (act === 'size-down') { bumpSize(-2); }
      else if (act === 'leading-up') { bumpLeading(0.05); }
      else if (act === 'leading-down') { bumpLeading(-0.05); }
      else if (act === 'headings') { toggleHeadings(); }
      else if (act === 'nikud') { toggleNikud(); }
      else if (act === 'filter') { toggleFilter(); }
      else if (act === 'night') { toggleNight(); }
      else if (act === 'pick-location') { e.preventDefault(); setLocationPref(t.dataset.location); track('location', { location: t.dataset.location }); }
      else if (act === 'awake') { toggleAwake(); }
      else if (act === 'print') { printPage(); }
      else if (act === 'install') { doInstall(); }
      else if (act === 'open-sections') { e.preventDefault(); if (isPanelOpen()) closeSections(); else openSections(); }
      else if (act === 'close-sections') { e.preventDefault(); closeSections(); }
      // The section NAME, not its sec-N id: the id means nothing in a report,
      // and the name aggregates across prayers — where readers enter a long
      // service is the question worth answering.
      else if (act === 'jump') {
        e.preventDefault();
        jumpToSection(t.dataset.jump);
        // Bilingual buttons hold two spans; report one language only.
        var enSpan = t.querySelector('[data-lang-en]');
        track('section-jump', { section: (enSpan ? enSpan.textContent : t.textContent).trim() });
      }
      // Popover triggers (download, type). The dismiss pass above already
      // closed every open panel, so this only has to re-open when the click
      // was on a CLOSED trigger.
      else if (spec) {
        e.preventDefault();
        if (!wasOpen) {
          var wrap = t.closest(spec.wrap);
          var menu = wrap && wrap.querySelector(spec.menu);
          if (menu) {
            // The section panel is a third overlay that predates POPOVERS and
            // is anchored differently (fixed, bottom-sheet on mobile). It must
            // not coexist with a popover: .section-bar is a z-index:9 stacking
            // context, so a popover inside it can never paint above the
            // panel's z-index:20 no matter what z-index the popover claims —
            // the panel would swallow clicks meant for the font rows.
            closeSections();
            menu.removeAttribute('hidden');
            t.setAttribute('aria-expanded', 'true');
            focusPopover(menu);
          }
        }
      }
      // Font pick deliberately leaves the menu open so the reader can compare
      // faces against the live prayer text behind it.
      // Tracked here rather than inside setFont, which moveFontFocus also
      // calls: arrowing down the list would otherwise report every face the
      // reader merely passed over as a deliberate pick.
      else if (act === 'pick-font') { e.preventDefault(); setFont(t.dataset.font); track('font', { font: t.dataset.font }); }
      else if (act === 'open-prayer') { e.preventDefault(); openPrayer(t.dataset.prayer); }
      else if (act === 'pick-nusach') {
        e.preventDefault();
        pickNusach(t.dataset.nusach, new URLSearchParams(location.search).get('from'));
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (isPanelOpen()) closeSections();
        closeAllPopovers();
        return;
      }
      var row = e.target.closest && e.target.closest('[data-act="pick-font"], [data-act="pick-location"]');
      if (!row) return;
      var delta = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1
        : (e.key === 'ArrowUp' || e.key === 'ArrowLeft') ? -1 : 0;
      if (!delta) return;
      e.preventDefault();
      if (row.dataset.act === 'pick-font') { moveFontFocus(row, delta); return; }
      // Location radiogroup: same roving pattern as the font rows.
      var locs = [].slice.call(document.querySelectorAll('[data-act="pick-location"]'));
      var li = locs.indexOf(row);
      if (li === -1) return;
      var next = locs[(li + delta + locs.length) % locs.length];
      next.focus();
      setLocationPref(next.dataset.location);
    });

    // Initialize button states from current root attributes / storage.
    setTheme(root.dataset.theme || 'light');
    setLang(root.dataset.lang || 'en');
    setHeadings(root.dataset.headings || 'on');
    setNikud(root.dataset.nikud || 'on');
    var sz = parseInt(getComputedStyle(root).getPropertyValue('--size'), 10) || window.__DEFAULT_SIZE__;
    setSize(sz);
    var lh = parseFloat(getComputedStyle(root).getPropertyValue('--lh')) || window.__DEFAULT_LH__;
    setLeading(lh);
    // pre-paint.js already set data-font (and preloaded the face) before first
    // paint; this only syncs the picker's checked row. applyFont, not setFont —
    // there is nothing to wait for and no preference to re-write.
    applyFont(root.dataset.font || DEFAULT_FONT);
    // The Awake button is in the header on every page, so the saved
    // preference is restored everywhere too.
    var awakePref = get(SK.awake);
    if (awakePref === 'on') acquireWake();
    setAwakeUI(awakePref === 'on');
    applyFilter(get(SK.filter) === 'off' ? 'off' : 'on');
    setLocationUi(get(SK.location) || 'auto');
    syncNightUi();
    initDateInput();
    showDateBanner();
    // Instant date pill on repeat visits: fill from the cache pre-paint
    // already validated; the engine refreshes it after load. Never on a
    // ?date= override — the cache describes the live date, not the
    // override (pre-paint skips it for the same reason).
    try {
      var cached = JSON.parse(get(SK.conds) || 'null');
      if (cached && cached.v === 1 && cached.exp > Date.now() && daykind() && !debugDate()) {
        todayResult = cached;
        applyToday(cached, false);
      }
    } catch (_) {}
    fillDateFallback();
    // The two lines above can un-hide the reading-head date line and
    // change the page height — restore the position only after that.
    initPosMemory();
    initTehilimCycle();
    syncHomeNusachPill();
    syncInstallUi();
    attachSectionObserver();
    // Bar height changes when the viewport crosses the mobile/desktop
    // breakpoint (1-row vs 2-row layout). Re-attach the observer with a
    // freshly-measured rootMargin so scroll-spy stays accurate.
    var resizeT;
    window.addEventListener('resize', function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(attachSectionObserver, 200);
    });
  }
  // ── Install to home screen (/install/) ──
  // beforeinstallprompt fires once, early, and only in Chromium. It is
  // captured HERE at module scope rather than inside init() because it can
  // fire before DOMContentLoaded, and an unhandled event is gone for good —
  // there is no way to ask for it again.
  var deferredPrompt = null;
  // Set once the install actually succeeds. isStandalone() cannot stand in for
  // it: the tab that ran the prompt is still an ordinary browser tab, so right
  // after a successful install it reports false and the UI would fall back to
  // telling the reader how to install the thing they just installed.
  var justInstalled = false;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || navigator.standalone === true;
  }

  function syncInstallUi() {
    var page = document.querySelector('.install-page');
    if (!page) return;
    var btn = page.querySelector('[data-act="install"]');
    var done = page.querySelector('.install-done');
    var installed = isStandalone() || justInstalled;
    if (done) done.hidden = !installed;
    // Chromium-only: everyone else follows the written walkthroughs below,
    // which are server-rendered and always on screen.
    if (btn) btn.hidden = installed || !deferredPrompt;
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    // Only from /install/. This fires on EVERY page load for an eligible
    // reader, so tracking it site-wide would just re-count Chromium
    // pageviews. On the install page it is the number that matters: how many
    // readers get the one-tap button instead of the written walkthrough.
    if (document.querySelector('.install-page')) track('install', { step: 'offered' });
    syncInstallUi();
  });
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    justInstalled = true;
    // Site-wide, and NOT redundant with the accepted step below: a reader can
    // install from Chrome's own address-bar icon, never touching our button.
    track('install', { step: 'installed' });
    syncInstallUi();
    precacheWholeSiddur();
  });

  function doInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function (choice) {
      // The prompt is single-use whatever the reader chose.
      deferredPrompt = null;
      var accepted = choice && choice.outcome === 'accepted';
      track('install', { step: accepted ? 'accepted' : 'dismissed' });
      if (accepted) justInstalled = true;
      syncInstallUi();
    });
  }

  // Ask the worker to cache the whole siddur (~1 MB). Only for readers who
  // installed — a first-time visitor reading one prayer over metered cellular
  // should not silently pay for 64 pages they never asked for. The worker's
  // fill uses cache:'reload' (a real network fetch per page), so at most one
  // refresh per day: an installed reader must not re-download the siddur on
  // every launch.
  function precacheWholeSiddur() {
    if (!('serviceWorker' in navigator)) return;
    var last = Number(get('ssd:precached')) || 0;
    if (Date.now() - last < 24 * 3600 * 1000) return;
    navigator.serviceWorker.ready.then(function (reg) {
      if (reg.active) {
        reg.active.postMessage({ type: 'precache-all' });
        set('ssd:precached', String(Date.now()));
      }
    }).catch(function () {});
  }

  // The worker reports how many of the 64 pages failed to land. Nothing else
  // surfaces that number — a reader whose precache half-failed finds out in a
  // tunnel, which is the one place this all has to work. Registered at module
  // scope so the reply is never missed.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (!e.data || e.data.type !== 'precache-done') return;
      track('precache', { failed: e.data.failed });
    });
  }

  // A ?fresh page is about to replace itself — do not boot the app,
  // take a wake lock, or fetch the calendar engine on it.
  if (!freshPending) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else { init(); }

    // Calendar engine: after load, off the critical path. Every page shows
    // the Hebrew date; prayer pages also apply the condition tokens.
    if (document.readyState === 'complete') { loadCalendarEngine(); }
    else { window.addEventListener('load', loadCalendarEngine); }
  }

  // Offline support. Registered after load so it never competes with the
  // first paint. __BASE__ (injected by build.mjs::relocate) keeps this working
  // at any deploy depth — sw.js lives at the deploy root and its scope is that
  // root, so a page nested at /shacharit/ashkenaz/ is still covered.
  // Failure is silent and non-fatal: no worker just means no offline.
  if ('serviceWorker' in navigator && !freshPending) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register((window.__BASE__ || '/') + 'sw.js').then(function () {
        // Running installed: make sure the whole siddur is on disk. Cheap to
        // repeat — cache.add is a no-op once an entry is present and fresh.
        if (isStandalone()) precacheWholeSiddur();
      }).catch(function () {});
    });
  }
})();
