/* main.js — wiring: the sentence bar, the figure caption, hover tip, sources.
 * URL hash is  #<dataset>/<metric>/<lens>/<view>, e.g. #turntable/euclidean/ph/ab
 * (view: a or b = one cloud of that representation, ab = both, contrasted).
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const scene = new Scene($('stage'));
  window.wtph = { scene };   // for poking at it from the console
  const baseCache = new Map(), geoCache = new Map();
  let index = [], ds = null, token = 0;
  const cur = { id: null, metric: null, lens: 'shape', view: 'a', labels: null };
  const modeOf = view => (view === 'ab' ? 'two' : 'one');

  // cached fetches; a failure is forgotten so the next click can try again
  function cached(cache, key, url, limit) {
    if (!cache.has(key)) {
      cache.set(key, fetch(url)
        .then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); })
        .catch(e => { cache.delete(key); throw e; }));
      while (cache.size > limit) cache.delete(cache.keys().next().value);
    } else {
      const v = cache.get(key);   // recently used: move to the back of the line
      cache.delete(key);
      cache.set(key, v);
    }
    return cache.get(key);
  }
  const getBase = id => cached(baseCache, id, `data/${id}.json`, 8);
  const getGeo = (id, m) => cached(geoCache, id + '/' + m, `data/${id}/${m}.json`, 12);

  // base (labels, thumbs, CKA…) + geometry for one distance = what the scene draws
  function merge(base, geo) {
    return Object.assign({}, base, geo, {
      views: base.views.map((v, i) => Object.assign({}, v, geo.views[i])),
    });
  }

  // ---------- selection ----------

  async function select(id, metric, lens, view) {
    const my = ++token;   // a newer click wins over a slower fetch
    let base;
    try { base = await getBase(id); } catch (e) { console.warn(e); return; }
    if (my !== token) return;
    if (!base.metrics.some(m => m.key === metric)) metric = base.defaultMetric;
    if (!LENSES.some(l => l.key === lens)) {
      const alias = Object.prototype.hasOwnProperty.call(LENS_ALIAS, lens) ? LENS_ALIAS[lens] : null;
      lens = LENSES.some(l => l.key === alias) ? alias : 'shape';
    }
    view = ['a', 'b', 'ab'].includes(view) ? view : 'a';
    // an analysis that needs two clouds brings the second one along
    if (!LENSES.find(l => l.key === lens).modes.includes(modeOf(view))) view = 'ab';
    let geo = null;
    if (id !== cur.id || metric !== cur.metric) {
      try { geo = await getGeo(id, metric); } catch (e) { console.warn(e); return; }
    }
    if (my !== token) return;
    if (geo) {
      const sameDataset = id === cur.id;
      ds = merge(base, geo);
      scene.setData(ds, { keepView: sameDataset });
      scene.P.showA = 0;
      scene.P.showB = 0;
      if (!sameDataset) cur.labels = null;
      Object.assign(cur, { id, metric });
    }
    Object.assign(cur, { lens, view });
    render();
    history.replaceState(null, '', `#${id}/${metric}/${lens}/${view}`);
  }

  // ---------- popover lists for the sentence ----------

  let popFor = null;
  function openPop(btn, items, active, onPick) {
    const pop = $('pop');
    if (popFor === btn) return closePop();
    pop.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', it.key === active);
      b.innerHTML = `<span>${it.label}</span>${it.hint ? `<small>${it.hint}</small>` : ''}`;
      b.onclick = () => { closePop(); onPick(it.key); };
      pop.appendChild(b);
    }
    pop.hidden = false;
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
    placePop(pop, r);
    popFor = btn;
    btn.setAttribute('aria-expanded', 'true');
    (pop.querySelector('[aria-selected="true"]') || pop.firstChild).focus();
  }
  // below the trigger if it fits, else above; never taller than the room there is
  function placePop(pop, r) {
    const below = innerHeight - r.bottom - 14, above = r.top - 14;
    const down = below >= Math.min(pop.scrollHeight, 320) || below >= above;
    pop.style.maxHeight = Math.max(120, down ? below : above) + 'px';
    pop.style.top = (down ? r.bottom + 6 : Math.max(8, r.top - 6 - Math.min(pop.scrollHeight, above))) + 'px';
  }

  function closePop() {
    $('pop').hidden = true;
    $('pop').classList.remove('wide');
    if (popFor) popFor.setAttribute('aria-expanded', 'false');
    popFor = null;
  }
  addEventListener('resize', () => closePop());
  addEventListener('pointerdown', e => {
    if (popFor && !$('pop').contains(e.target) && e.target !== popFor) closePop();
  });

  function pick(label, items, active, onPick, cls) {
    const b = document.createElement('button');
    b.className = 'pick' + (cls ? ' ' + cls : '');
    b.setAttribute('aria-haspopup', 'listbox');
    b.setAttribute('aria-expanded', 'false');
    b.innerHTML = `${label}<span class="caret" aria-hidden="true">▾</span>`;
    b.onclick = () => openPop(b, items, active, onPick);
    return b;
  }
  function datasetPick() {
    const b = pick(shortName(cur.id), [], cur.id, null, 'ds');
    b.title = ds.title;
    b.onclick = () => openDatasets(b);
    const arrow = (d, label) => {
      const a = document.createElement('button');
      a.className = 'step';
      a.textContent = d < 0 ? '‹' : '›';
      a.setAttribute('aria-label', label);
      a.title = `${label}  (${d < 0 ? '[' : ']'})`;
      a.onclick = () => stepDataset(d);
      a.onpointerenter = () => { const o = order(); prefetch(o[(o.indexOf(cur.id) + d + o.length) % o.length]); };
      return a;
    };
    const span = document.createElement('span');
    span.className = 'dsbox';
    const slot = document.createElement('span');   // fixed width; the name keeps its own underline
    slot.className = 'slot';
    slot.appendChild(b);
    span.append(arrow(-1, 'previous dataset'), slot, arrow(1, 'next dataset'));
    return span;
  }

  // The dataset name sits in a slot as wide as the widest name, so the arrows
  // and the rest of the sentence stay put while stepping through datasets.
  const slotCache = new Map();
  function slotWidth(b) {
    const font = getComputedStyle(b).font;
    if (!slotCache.has(font)) {
      const probe = b.cloneNode(true);
      Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', left: '-9999px' });
      b.parentNode.appendChild(probe);
      let w = 0;
      for (const d of index) {
        probe.firstChild.textContent = shortName(d.id);
        w = Math.max(w, probe.getBoundingClientRect().width);
      }
      probe.remove();
      slotCache.set(font, Math.ceil(w));
    }
    return slotCache.get(font);
  }
  if (document.fonts) document.fonts.ready.then(() => { slotCache.clear(); if (ds) renderSentence(LENSES.find(l => l.key === cur.lens)); });
  const word = t => Object.assign(document.createElement('span'), { className: 'w', textContent: t });

  function renderSentence(L) {
    const s = $('sentence');
    s.innerHTML = '';
    const two = cur.view === 'ab';
    const A = ds.views[0].name, B = ds.views[1].name;
    const viewItems = [
      { key: 'a', label: A, hint: `${dimText(ds.views[0])}, one cloud` },
      { key: 'b', label: B, hint: `${dimText(ds.views[1])}, one cloud` },
      { key: 'ab', label: `${A} vs ${B}`, hint: 'two clouds, side by side' },
    ];
    s.append(
      word(two ? 'compare' : 'look at'),
      datasetPick(),
      about(),
      word('as'),
      pick(viewItems.find(x => x.key === cur.view).label, viewItems, cur.view, v => {
        const ok = v === 'ab' || L.modes.includes('one');
        select(cur.id, cur.metric, ok ? cur.lens : 'shape', v);
      }),
      word('under'),
      pick(METRICS[cur.metric].label, ds.metrics.map(m => ({ key: m.key, label: METRICS[m.key].label })), cur.metric,
        m => select(cur.id, m, cur.lens, cur.view)),
      word('distance, through'),
      pick(L.label, LENSES.map(l => ({ key: l.key, label: l.label, hint: l.modes.includes('one') ? '' : 'two clouds' })), cur.lens,
        k => select(cur.id, cur.metric, k, cur.view)),
    );
    const slot = s.querySelector('.dsbox .slot');
    // wide screens only: on a phone the sentence wraps anyway, and the gap would cost a line
    slot.style.minWidth = innerWidth > 760 ? slotWidth(slot.firstChild) + 'px' : '';
  }

  // The dataset list, by what kind of thing it is. Anything not listed here
  // (a dataset added later) lands in "more".
  const SHELVES = [
    ['language', ['clock', 'layers', 'numbers', 'emoji', 'clocks', 'grambank']],
    ['minds & brains', ['colors', 'states', 'peterson', 'cortex']],
    ['pictures', ['mnist', 'doodles', 'turntable', 'pokemon', 'bobross', 'songbirds']],
    ['the world', ['stars', 'cities', 'elements', 'eggs', 'fungi', 'cellcycle', 'candy']],
  ];
  const entry = id => index.find(d => d.id === id) || { id, title: id };
  const shortName = id => entry(id).short || entry(id).title;
  // every dataset in shelf order (anything unshelved at the end): what ‹ › and [ ] step through
  function order() {
    const placed = SHELVES.flatMap(s => s[1]).filter(id => index.some(d => d.id === id));
    return placed.concat(index.map(d => d.id).filter(id => !placed.includes(id)));
  }
  function stepDataset(d) {
    const o = order(), k = o.indexOf(cur.id);
    const id = o[(k + d + o.length) % o.length];
    prefetch(o[(k + 2 * d + 2 * o.length) % o.length]);   // and the one after that, ahead of time
    select(id, cur.metric, cur.lens, cur.view);
  }

  function prefetch(id) {
    getBase(id).then(b => getGeo(id, b.defaultMetric)).catch(() => {});
  }

  function openDatasets(btn) {
    const pop = $('pop');
    if (popFor === btn) return closePop();
    const placed = new Set(SHELVES.flatMap(s => s[1]));
    const shelves = SHELVES.map(([name, ids]) => [name, ids.filter(id => index.some(d => d.id === id))])
      .concat([['new', index.filter(d => !placed.has(d.id)).map(d => d.id)]])
      .filter(s => s[1].length);
    const hint = id => (entry(id).views || []).join(' vs ');
    pop.innerHTML = `<input class="find" type="search" placeholder="find a dataset" aria-label="find a dataset">
      <div class="shelves">${shelves.map(([name, ids]) => `<section><h3>${name}</h3>${ids.map(id =>
        `<button role="option" data-id="${id}" aria-selected="${id === cur.id}" title="${entry(id).title.replace(/"/g, '&quot;')}">` +
        `<span>${shortName(id)}</span><small>${hint(id)}</small></button>`).join('')}</section>`).join('')}</div>`;
    pop.classList.add('wide');
    const find = pop.querySelector('.find');
    find.oninput = () => {
      const q = find.value.trim().toLowerCase();
      for (const b of pop.querySelectorAll('button[data-id]')) b.hidden = q && !(b.textContent + ' ' + b.title + ' ' + b.dataset.id).toLowerCase().includes(q);
      for (const sec of pop.querySelectorAll('section')) sec.hidden = ![...sec.querySelectorAll('button')].some(b => !b.hidden);
    };
    find.onkeydown = e => {
      if (e.key === 'Enter') { const b = [...pop.querySelectorAll('button[data-id]')].find(x => !x.hidden); if (b) b.click(); }
      if (e.key === 'ArrowDown') { const b = [...pop.querySelectorAll('button[data-id]')].find(x => !x.hidden); if (b) { b.focus(); e.preventDefault(); } }
    };
    for (const b of pop.querySelectorAll('button[data-id]')) {
      // start fetching on intent, so the click usually finds the data already here
      b.onpointerenter = b.onfocus = () => prefetch(b.dataset.id);
      b.onclick = () => { closePop(); select(b.dataset.id, cur.metric, cur.lens, cur.view); };
    }
    pop.hidden = false;
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left + r.width / 2 - pop.offsetWidth / 2, innerWidth - pop.offsetWidth - 8)) + 'px';
    placePop(pop, r);
    popFor = btn;
    btn.setAttribute('aria-expanded', 'true');
    if (matchMedia('(pointer: fine)').matches) find.focus();
    else (pop.querySelector('[aria-selected="true"]') || find).scrollIntoView({ block: 'nearest' });
  }

  // ⓘ: the dataset's official name, the creators' own words, and the citations
  function about() {
    const b = document.createElement('button');
    b.className = 'info';
    b.setAttribute('aria-label', 'about this dataset');
    b.textContent = 'ⓘ';
    b.onclick = () => {
      const pop = $('pop');
      if (popFor === b) return closePop();
      const srcs = (ds.about || []).map(s => `<div class="src"><b>${s.name}</b><q>${s.quote}</q>
        <a href="${s.url}" target="_blank" rel="noopener">${s.label}</a></div>`).join('');
      pop.innerHTML = `<div class="about">${srcs || `<p>${ds.blurb}</p>`}
        ${ds.here ? `<p class="here">${ds.here}</p>` : ''}${refList('cite as', ds.cite || [])}</div>`;
      pop.hidden = false;
      const r = b.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(r.left - 40, innerWidth - pop.offsetWidth - 8)) + 'px';
      placePop(pop, r);
      popFor = b;
    };
    return b;
  }

  function renderTools() {
    const t = $('tools');
    t.innerHTML = '';
    const pictures = !!(ds.thumbs || ds.glyphs);
    const toggle = (label, on, fn) => {
      const b = document.createElement('button');
      b.className = 'tool';
      b.setAttribute('aria-pressed', on);
      b.textContent = label;
      b.onclick = fn;
      t.appendChild(b);
    };
    if (!pictures) toggle('labels', cur.labels, () => {
      cur.labels = !cur.labels;
      renderTools();
      scene.set({ labels: cur.labels ? 1 : 0 }, 400);   // the ε sweep and spin carry on
    });
  }

  function tex(el, src) {
    el.dataset.tex = src;
    if (window.katex) katex.render(src, el, { displayMode: true, throwOnError: false });
    else el.textContent = '';   // typeset when KaTeX arrives (it loads async)
  }
  addEventListener('katex', () => {
    for (const el of document.querySelectorAll('[data-tex]')) tex(el, el.dataset.tex);
    scene.resize();
  });

  function render() {
    const L = LENSES.find(l => l.key === cur.lens);
    const mode = modeOf(cur.view), v = cur.view === 'b' ? 1 : 0;
    const pictures = !!(ds.thumbs || ds.glyphs);
    if (cur.labels === null) cur.labels = !pictures && ds.n <= 100;

    renderSentence(L);
    renderTools();

    // the caption
    $('cap-title').textContent = `${L.label}, ${METRICS[cur.metric].label} distance, ` +
      (mode === 'two' ? `A = ${ds.views[0].name}, B = ${ds.views[1].name}` : ds.views[v].name);
    tex($('lens-eq'), L.tex);
    tex($('metric-eq'), METRICS[cur.metric].tex);
    $('lens-legend').innerHTML = L.legend;
    const vs = ds.vsEuclid || [1, 1];
    const which = mode === 'two' ? [0, 1] : [v];
    $('metric-note').innerHTML = METRICS[cur.metric].note + (ds.metricNote ? ` ${ds.metricNote}` : '') +
      (cur.metric === 'euclidean' || cur.metric === 'given' ? '' :
      ` <span class="agree">Rank agreement with Euclidean: ${which.map(i =>
        `${mode === 'two' ? ds.views[i].name + ' ' : ''}<b>${vs[i].toFixed(2)}</b>`).join(', ')}${
        Math.min(...which.map(i => vs[i])) > 0.97 ? ' (here it barely matters)' : ''}.</span>`);
    $('readout').innerHTML = L.readout(ds, mode, v);
    for (const b of $('readout').querySelectorAll('[data-bar]')) {
      const [bv, bk] = b.dataset.bar.split(':').map(Number);
      b.onclick = () => { if (!scene.sel || scene.sel.v !== bv || scene.sel.k !== bk) scene.selectBar(bv, bk); else scene.selectBar(null); };
    }
    renderRefs(L);

    scene.focus = v;
    scene.oneCloud = mode === 'one';
    $('tip').hidden = true;
    scene.clearFeature();
    $('feat').hidden = cur.lens !== 'ph';
    scene.reset();
    scene.set(Object.assign({ pics: pictures ? 1 : 0 }, L.scene(ds, mode, v), { labels: cur.labels ? 1 : 0 }));
    buildControls(L.controls || []);
    if (L.enter) L.enter(scene, ds);
    requestAnimationFrame(() => scene.resize());   // the caption may have changed height
  }

  // ---------- controls ----------

  function buildControls(list) {
    const box = $('lens-controls');
    box.innerHTML = '';
    scene.onEps = null;
    if (list.includes('eps')) {
      const row = document.createElement('div');
      row.className = 'ctl';
      row.title = 'ε is a fraction of the widest distance in each cloud';
      row.innerHTML = `<label for="eps">ε</label><input id="eps" type="range" min="0" max="1" step="0.001"><span class="val"></span><button class="tool">replay</button>`;
      const input = row.querySelector('input'), out = row.querySelector('.val');
      input.max = '1';   // all the way; the replay sweep stops earlier, where the shape is
      const sync = x => { input.value = x; out.textContent = x.toFixed(2); };
      sync(scene.P.eps);
      input.oninput = () => { scene.setEps(+input.value); sync(+input.value); };
      scene.onEps = sync;
      row.querySelector('button').onclick = () => { scene.setEps(0); scene.set({ eps: scene.epsMax }, 9000, 'linear'); };
      box.appendChild(row);
    }
  }

  // ---------- sources ----------

  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  function refList(head, keys) {
    const items = [...new Set(keys)].map(k => REFS[k] || (ds && ds.refs && ds.refs[k])).filter(Boolean);
    if (!items.length) return '';
    return `<h3>${head}</h3><ol>${items.map(r =>
      `<li><a href="${r.url}" target="_blank" rel="noopener">${esc(r.text)}</a></li>`).join('')}</ol>`;
  }

  function renderRefs(L) {
    const extra = [];
    for (const [k, keys] of Object.entries(ds.reading || {})) {
      if ((LENS_ALIAS[k] || k) === L.key) extra.push(...keys);
    }
    // Llama's licence asks for this notice wherever its outputs are used
    const llama = (ds.cite || []).includes('llama3') ? '<p class="credit">Built with Llama (Llama 3.2 Community License).</p>' : '';
    $('refs').innerHTML = refList(L.label, (L.reading || []).concat(extra)) + refList('data', ds.cite || []) + llama;
  }

  // ---------- caption collapse ----------

  function toggleCaption(force) {
    const hide = force !== undefined ? force : !document.body.classList.contains('cap-hidden');
    document.body.classList.toggle('cap-hidden', hide);
    $('cap-toggle').textContent = hide ? 'show caption' : 'hide';
    $('cap-toggle').setAttribute('aria-expanded', !hide);
    scene.resize();
    try { localStorage.setItem('wtph-cap-hidden', hide ? '1' : ''); } catch (e) { /* private mode */ }
  }
  $('cap-toggle').onclick = () => toggleCaption();
  if ('ResizeObserver' in window) new ResizeObserver(() => scene.resize()).observe($('caption'));

  // ---------- hover tip ----------

  scene.onHover = h => {
    const tip = $('tip');
    if (!h) { tip.hidden = true; return; }
    const i = h.i;
    if (!h.move) {
      let extra = ds.subs ? ds.subs[i] : '';
      if (cur.lens === 'neighbors') {
        const nb = w => ds.views[w].nbrs[i].map(j => ds.labels[j]).join(', ');
        extra = `${ds.views[0].name}: ${nb(0)}<br>${ds.views[1].name}: ${nb(1)}`;
      }
      if (cur.lens === 'procrustes') {
        // what the rotation couldn't explain for this item, against everyone's median
        const res = k => { const a = ds.procrustes.a[k], b = ds.procrustes.b[k]; return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
        if (!ds._resMed) { const all = ds.labels.map((_, k) => res(k)).sort((p, q) => p - q); ds._resMed = all[all.length >> 1]; }
        const r = res(i);
        extra = (extra ? extra + '<br>' : '') + `left over after the fit: ${r.toFixed(2)} (median ${ds._resMed.toFixed(2)})`;
      }
      const stack = scene.stackedWith(i, h.view).filter(j => j !== i);
      if (stack.length && cur.lens !== 'neighbors') {
        const names = stack.slice(0, 8).map(j => ds.labels[j]).join(', ') + (stack.length > 8 ? ` and ${stack.length - 8} more` : '');
        extra = (extra ? extra + '<br>' : '') + `same spot: ${names}`;
      }
      tip.querySelector('b').textContent = h.view === 1 && ds.labelsB ? ds.labelsB[i] : ds.labels[i];
      tip.querySelector('span').innerHTML = extra;
      const img = tip.querySelector('img');
      if (scene.showsThumbs()) {
        const im = img || tip.insertBefore(document.createElement('img'), tip.firstChild);
        im.src = scene.thumbURL(i);
      } else if (img) img.remove();
    }
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = h.x + 16, y = h.y + 14;
    if (x + r.width > innerWidth - 8) x = h.x - r.width - 16;
    if (y + r.height > innerHeight - 8) y = h.y - r.height - 14;
    x = Math.max(8, Math.min(x, innerWidth - r.width - 8));
    y = Math.max(8, Math.min(y, innerHeight - r.height - 8));
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  };

  // ---------- persistence features: tips and the caption line ----------

  const DIMNAME = ['piece', 'loop', 'void'];
  const names = (pts, max) => {
    const L = ds.labels, list = pts.slice(0, max).map(i => L[i]).join(', ');
    return list + (pts.length > max ? ` and ${pts.length - max} more` : '');
  };
  const life = f => f.death === null ? `born ε ${f.birth.toFixed(2)}, never dies` :
    `born ε ${f.birth.toFixed(2)}, dies ε ${f.death.toFixed(2)}, lasts ${(f.death - f.birth).toFixed(2)}`;
  function describe(f, long) {
    const H = `H<sub>${f.dim}</sub>`;
    if (!f.gen) {
      return f.death === null
        ? `${H} the last piece standing: everything, once it has all joined up.`
        : `${H} ${DIMNAME[f.dim]} · ${life(f)}. ${f.located
          ? 'Too short-lived to pin to particular points.'
          : 'Where it lives hasn’t been worked out for this dataset yet.'}`;
    }
    const max = long ? 14 : 6;
    if (f.dim === 0) return `${H} a piece of ${f.pts.length}: ${names(f.pts, max)} · ${life(f)}; the dashed edge joins it to the rest.`;
    if (f.dim === 1) return `${H} a loop through ${f.pts.length}: ${names(f.pts, max)} · ${life(f)}; the dashed chord fills it in.`;
    return `${H} a void · ${life(f)}. Solid: the edge that closes its shell (${names(f.edge, 2)}); dashed: the chord across the hollow that fills it (${names(f.chord, 2)}).`;
  }
  const FEAT_HINT = 'Point at a bar to see its feature in the cloud; click to keep it.';
  scene.onFeature = f => {
    $('feat').innerHTML = f ? describe(f, true) + ' <button class="clear" aria-label="let go">×</button>' : FEAT_HINT;
    const x = $('feat').querySelector('.clear');
    if (x) x.onclick = () => scene.selectBar(null);
  };
  function placeTip(tip, x0, y0) {
    const r = tip.getBoundingClientRect();
    let x = x0 + 16, y = y0 + 14;
    if (x + r.width > innerWidth - 8) x = x0 - r.width - 16;
    if (y + r.height > innerHeight - 8) y = y0 - r.height - 14;
    tip.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    tip.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  }
  scene.onTip = t => {
    const tip = $('tip');
    if (!t) { tip.hidden = true; return; }
    const img = tip.querySelector('img');
    if (img) img.remove();
    if (t.bar) {
      const f = t.bar;
      tip.querySelector('b').innerHTML = `H<sub>${f.dim}</sub> ${DIMNAME[f.dim]}`;
      tip.querySelector('span').innerHTML = describe(f, false).replace(/^H<sub>\d<\/sub> /, '') +
        (f.gen ? `<br><i>${scene.sel === f ? 'click to let go' : 'click to keep it'}</i>` : '');
    } else if (t.cell) {
      const c = t.cell, L = ds.labels, pc = p => `${Math.round(p * 100)}%`;
      tip.querySelector('b').textContent = `${L[c.i]} · ${L[c.j]}`;
      tip.querySelector('span').innerHTML = ds.views.map((V, k) =>
        `${V.name}: farther apart than ${pc(c.pct[k])} of pairs`).join('<br>');
    }
    tip.hidden = false;
    placeTip(tip, t.x, t.y);
  };

  // ---------- boot ----------

  function readHash() {
    const [id, metric, lens, view] = location.hash.slice(1).split('/');
    return {
      // no link (or a stale one): somewhere new each time the page opens
      id: index.some(d => d.id === id) ? id : index[Math.floor(Math.random() * index.length)].id,
      metric: metric || null,
      lens: lens || 'shape',
      view: view || 'a',
    };
  }

  function step(d) {
    const k = LENSES.findIndex(l => l.key === cur.lens);
    select(cur.id, cur.metric, LENSES[(k + d + LENSES.length) % LENSES.length].key, cur.view);
  }

  async function boot() {
    let startHidden = false;
    try { startHidden = localStorage.getItem('wtph-cap-hidden') === '1'; } catch (e) { /* private mode */ }
    if (startHidden) toggleCaption(true);
    index = await fetch('data/index.json').then(r => r.json());
    addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (popFor) return closePop(); if (scene.sel) return scene.selectBar(null); return; }
      if (e.target.tagName === 'INPUT' && !(popFor && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) return;
      if (!ds) return;
      if (popFor && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const opts = [...$('pop').querySelectorAll(':scope > button, button[data-id]:not([hidden])')], k = opts.indexOf(document.activeElement);
        if (!opts.length) return;
        opts[(k + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length].focus();
        e.preventDefault();
        return;
      }
      if (e.key === '[') { e.preventDefault(); stepDataset(-1); }
      if (e.key === ']') { e.preventDefault(); stepDataset(1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      if (e.key === '+' || e.key === '=') scene.zoomBy(1.25);
      if (e.key === '-') scene.zoomBy(0.8);
      if (e.key === '0') scene.resetView();
      if (e.key === 'h') toggleCaption();
    });
    addEventListener('hashchange', () => {
      const h = readHash();
      if (h.id !== cur.id || h.metric !== cur.metric || h.lens !== cur.lens || h.view !== cur.view) select(h.id, h.metric, h.lens, h.view);
      else token++;   // back to what's on screen: cancel whatever was still loading
    });
    const h = readHash();
    await select(h.id, h.metric, h.lens, h.view);
  }


  boot();
})();
