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
  const word = t => Object.assign(document.createElement('span'), { className: 'w', textContent: t });

  function renderSentence(L) {
    const s = $('sentence');
    s.innerHTML = '';
    const two = cur.view === 'ab';
    const A = ds.views[0].name, B = ds.views[1].name;
    const viewItems = [
      { key: 'a', label: A, hint: `${ds.views[0].dims}-D, one cloud` },
      { key: 'b', label: B, hint: `${ds.views[1].dims}-D, one cloud` },
      { key: 'ab', label: `${A} vs ${B}`, hint: 'two clouds, side by side' },
    ];
    s.append(
      word(two ? 'compare' : 'look at'),
      pick(ds.title, index.map(d => ({ key: d.id, label: d.title })), cur.id, id => select(id, cur.metric, cur.lens, cur.view), 'ds'),
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
    if (window.katex) katex.render(src, el, { displayMode: true, throwOnError: false });
    else el.textContent = src;
  }

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
    $('metric-note').innerHTML = METRICS[cur.metric].note + (cur.metric === 'euclidean' ? '' :
      ` <span class="agree">Rank agreement with Euclidean: ${which.map(i =>
        `${mode === 'two' ? ds.views[i].name + ' ' : ''}<b>${vs[i].toFixed(2)}</b>`).join(', ')}${
        Math.min(...which.map(i => vs[i])) > 0.97 ? ' (here it barely matters)' : ''}.</span>`);
    $('readout').innerHTML = L.readout(ds, mode, v);
    renderRefs(L);

    scene.focus = v;
    scene.oneCloud = mode === 'one';
    $('tip').hidden = true;
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
      const stack = scene.stackedWith(i, h.view).filter(j => j !== i);
      if (stack.length && cur.lens !== 'neighbors') {
        const names = stack.slice(0, 8).map(j => ds.labels[j]).join(', ') + (stack.length > 8 ? ` and ${stack.length - 8} more` : '');
        extra = (extra ? extra + '<br>' : '') + `same spot: ${names}`;
      }
      tip.querySelector('b').textContent = h.view === 1 && ds.labelsB ? ds.labelsB[i] : ds.labels[i];
      tip.querySelector('span').innerHTML = extra;
      const img = tip.querySelector('img');
      if (ds.thumbs && !ds.glyphs) {
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

  // ---------- boot ----------

  function readHash() {
    const [id, metric, lens, view] = location.hash.slice(1).split('/');
    return {
      id: index.some(d => d.id === id) ? id : index[0].id,
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
      if (e.key === 'Escape') return closePop();
      if (e.target.tagName === 'INPUT') return;
      if (!ds) return;
      if (popFor && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const opts = [...$('pop').querySelectorAll(':scope > button')], k = opts.indexOf(document.activeElement);
        if (!opts.length) return;
        opts[(k + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length].focus();
        e.preventDefault();
        return;
      }
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
