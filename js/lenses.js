/* lenses.js — the analyses, and the distances they run on.
 *
 * A lens is a scene target, an equation (TeX), a one-line legend and a readout.
 * Single lenses look at one representation; compare lenses put both side by
 * side, measured with the same distance.
 */
(function () {
  'use strict';

  const f2 = x => x.toFixed(2);

  function longestLoop(view) {
    let best = null;
    for (const b of view.bars) if (b[0] === 1 && (!best || b[2] - b[1] > best[2] - best[1])) best = b;
    return best;
  }

  const agreement = x =>
    x >= 0.8 ? 'very similar' : x >= 0.55 ? 'clearly related' : x >= 0.3 ? 'loosely related' : x >= 0.1 ? 'barely related' : 'unrelated';

  const stat = (label, value, tag) =>
    `<div class="stat"><span class="k">${label}</span><span class="v">${value}</span>${tag ? `<span class="t">${tag}</span>` : ''}</div>`;

  // one view on its own: show only that view
  const solo = v => (v === 0 ? { showA: 1, showB: 0 } : { showA: 0, showB: 1 });
  const both = { split: 1, showA: 1, showB: 1 };
  // where the lens shows one cloud or two
  const frame = (mode, v) => (mode === 'two' ? Object.assign({}, both) : solo(v));
  // "66-D", or what a view is when it has no coordinates of its own
  const dimText = x => (x.dims ? `${x.dims}-D` : 'a distance matrix');
  window.dimText = dimText;
  const perView = (ds, fn) => ds.views.map((x, i) => stat(x.name, fn(x, i))).join('');

  const METRICS = {
    euclidean: {
      label: 'Euclidean',
      tex: String.raw`d(x,y) = \sqrt{\textstyle\sum_k (x_k-y_k)^2}`,
      note: 'Straight-line distance.',
    },
    cosine: {
      label: 'cosine',
      tex: String.raw`d(x,y) = 1 - \frac{x \cdot y}{\lVert x \rVert \, \lVert y \rVert}`,
      note: 'Only direction counts. If all vectors have the same length, it ranks pairs exactly like Euclidean.',
    },
    cityblock: {
      label: 'Manhattan',
      tex: String.raw`d(x,y) = \textstyle\sum_k \lvert x_k - y_k \rvert`,
      note: 'Adds up per-feature differences, so a few large ones dominate less than in Euclidean.',
    },
    chebyshev: {
      label: 'Chebyshev',
      tex: String.raw`d(x,y) = \max_k \, \lvert x_k - y_k \rvert`,
      note: 'Only the single largest per-feature difference counts.',
    },
    correlation: {
      label: 'correlation',
      tex: String.raw`d(x,y) = 1 - \frac{(x-\bar x)\cdot(y-\bar y)}{\lVert x-\bar x \rVert \, \lVert y-\bar y \rVert}`,
      note: 'Cosine after centring each vector, so an item’s overall level is ignored.',
    },
    standardized: {
      label: 'standardized',
      tex: String.raw`d(x,y) = \sqrt{\textstyle\sum_k (x_k-y_k)^2 / s_k^2}`,
      note: 's<sub>k</sub>: the spread of feature k. Every feature counts equally, however large its natural scale.',
    },
    geodesic: {
      label: 'geodesic',
      tex: String.raw`d_G(x,y) = \min_{x = p_0, \ldots, p_m = y} \; \textstyle\sum_t \lVert p_t - p_{t+1} \rVert`,
      note: 'Shortest path that steps between near neighbors (a 10-NN graph, plus the shortest bridge between any separate islands): an ant on the surface, not a crow.',
    },
    given: {
      label: 'their own',
      tex: String.raw`d(i,j) = D_{ij} \;\; \text{as measured}`,
      note: 'At least one view arrived as a distance matrix (judged or measured), so it can’t be re-measured: each view keeps the distance it came with.',
    },
    jaccard: {
      label: 'Jaccard',
      tex: String.raw`d(x,y) = 1 - \frac{|\,x \wedge y\,|}{|\,x \vee y\,|}`,
      note: 'For yes/no features: one minus shared presences over all presences.',
    },
  };

  const LENSES = [
    {
      key: 'shape',
      label: 'shape',
      tex: String.raw`-\tfrac12\, J D^{\circ 2} J = V \Lambda V^{\top}, \qquad Y = V_{3}\, \Lambda_{3}^{1/2}`,
      legend: 'A classical-MDS shadow of the real distances D: the three directions that carry the most spread.',
      modes: ['one', 'two'],
      scene: (ds, mode, v) => Object.assign(frame(mode, v), mode === 'two' ? { links: 1 } : {}),
      readout: (ds, mode, v) => {
        const kept = x => `${Math.round((x.mdsKept || 0) * 100)}%`;
        return mode === 'two'
          ? ds.views.map(x => stat(x.name, kept(x), `of the spread, in 3-D (from ${dimText(x)})`)).join('')
          : stat('3-D keeps', kept(ds.views[v]), `of the spread (from ${dimText(ds.views[v])})`);
      },
      reading: ['mds'],
    },
    {
      key: 'ph',
      label: 'persistent homology',
      tex: String.raw`\mathrm{VR}_{\varepsilon} = \{\, \sigma \subseteq X : d(x_i, x_j) \le \varepsilon \;\; \forall\, i,j \in \sigma \,\}`,
      legend: 'As ε grows, track H<sub>0</sub> (pieces), H<sub>1</sub> (loops) and, for sphere-like data, H<sub>2</sub> (voids) of VR<sub>ε</sub>. Each bar is one feature’s [birth, death).',
      controls: ['eps'],
      modes: ['one', 'two'],
      scene: (ds, mode, v) => Object.assign(frame(mode, v), { ph: 1, fig: 1, bars: 1 }),
      enter: scene => { scene.setEps(0); scene.set({ eps: scene.epsMax }, 9000, 'linear'); },
      readout: (ds, mode, v) => {
        const one = x => {
          const b = longestLoop(x);
          return b ? `${f2(b[2] - b[1])}` : '—';
        };
        const voids = x => {
          const b = x.bars.filter(y => y[0] === 2).reduce((m, y) => (!m || y[2] - y[1] > m[2] - m[1] ? y : m), null);
          return b ? f2(b[2] - b[1]) : '—';
        };
        if (mode === 'two') return ds.views.map(x => stat(`${x.name}`, one(x), ds.h2 ? `longest loop · void ${voids(x)}` : 'longest loop')).join('');
        const b = longestLoop(ds.views[v]);
        const loops = ds.views[v].bars.filter(x => x[0] === 1 && x[2] - x[1] > 0.05).length;
        return stat('longest loop', one(ds.views[v]), b ? `born ε ${f2(b[1])}, dies ε ${f2(b[2])}` : 'no loops')
          + stat('loops > 0.05', loops)
          + (ds.h2 ? stat('longest void', voids(ds.views[v]), 'H₂: a hollow inside, like a sphere’s') : '');
      },
      reading: ['ph_edelsbrunner', 'ph_ghrist', 'ph_carlsson', 'ripser'],
    },
    {
      key: 'id',
      label: 'intrinsic dimension',
      tex: String.raw`\mu_i = \frac{r_2(i)}{r_1(i)}, \qquad \hat d = \frac{N}{\sum_i \log \mu_i}`,
      legend: 'r<sub>1</sub>, r<sub>2</sub>: distance to the first (solid) and second (dashed) neighbor. The line’s slope is the maximum-likelihood d̂; identical points are counted once.',
      modes: ['one', 'two'],
      scene: (ds, mode, v) => Object.assign(frame(mode, v), { nn2: 1, fig: 1, idplot: 1 }),
      readout: (ds, mode, v) => {
        const one = (x, label) => x.twoNN === null
          ? stat(label, '—', 'too many ties to say')
          : stat(label, x.twoNN.toFixed(1), `from ${x.twoNNkept} of ${ds.n} points`);
        return mode === 'two' ? ds.views.map(x => one(x, x.name)).join('') : one(ds.views[v], 'd̂');
      },
      reading: ['twonn', 'id_dnn'],
    },
    {
      key: 'neighbors',
      label: 'neighbor overlap',
      modes: ['two'],
      tex: String.raw`\mathrm{overlap}_i = \frac{\lvert N_k^{A}(i) \cap N_k^{B}(i) \rvert}{k}, \qquad k = 5`,
      legend: 'N<sub>k</sub>(i): the k nearest items to i in each representation. Solid marks kept their neighbors. Ties are broken arbitrarily.',
      scene: () => ({ split: 1, showB: 1, knn: 1 }),
      readout: ds => {
        const ov = ds.knn.overlap, mean = ov.reduce((s, x) => s + x, 0) / ov.length;
        return stat('mean overlap', f2(mean), `${f2(mean * ds.knn.k)} of ${ds.knn.k} kept`);
      },
      reading: ['mutual_knn'],
    },
    {
      key: 'procrustes',
      label: 'Procrustes',
      modes: ['two'],
      tex: String.raw`\min_{R^{\top}R = I,\; s > 0} \; \lVert A - s\,B R \rVert_F^2, \qquad R = U V^{\top},\;\; B^{\top}\!A = U \Sigma V^{\top}`,
      legend: 'B is rotated, reflected and scaled onto A, never bent; the hairlines are what is left over. The number is measured in a few MDS dimensions, not just this 3-D picture.',
      scene: () => ({ showB: 1, proc: 1, resid: 1 }),
      readout: ds => stat('disparity', f2(ds.procrustes.disparity), `0 = identical · chance ≈ ${f2(ds.procrustes.chance)}`),
      reading: ['procrustes', 'procrustes_words'],
    },
    {
      key: 'rsa',
      label: 'RSA',
      modes: ['two'],
      tex: String.raw`\rho = \operatorname{Spearman}\!\big( [D^{A}_{ij}]_{i<j},\; [D^{B}_{ij}]_{i<j} \big)`,
      legend: 'Top: each representation’s distance matrix as percentiles, same item order, stronger ink = closer. Below: a sample of item pairs by distance rank, one dot each.',
      // the matrices are the picture here: items become plain dots on the diagonal
      scene: () => ({ split: 1, showB: 1, mat: 1, fig: 1, scatter: 1, pics: 0 }),
      readout: ds => stat('ρ', f2(ds.rsa), agreement(ds.rsa)),
      reading: ['rsa'],
    },
    {
      key: 'cka',
      label: 'CKA',
      modes: ['two'],
      tex: String.raw`\mathrm{CKA}(X,Y) = \frac{\lVert Y^{\top} X \rVert_F^2}{\lVert X^{\top} X \rVert_F \; \lVert Y^{\top} Y \rVert_F}`,
      legend: 'X, Y: the centered raw features, compared with plain dot products whatever distance is picked. Rotating either one changes nothing (watch B spin).',
      scene: ds => ({ split: 1, showB: 1, spinB: 1, links: 0.6, fig: ds.layers ? 1 : 0, heat: ds.layers ? 1 : 0 }),
      // B spins about one full turn (speed decays with half-life 1.6 s) and stops
      enter: scene => { scene.spin = 0; scene.spinBSpeed = (2 * Math.PI * Math.LN2) / 1.6; },
      readout: ds => {
        const c = ds.ckaChance || 0, above = (ds.cka - c) / (1 - c);
        return stat('CKA', f2(ds.cka), `chance ≈ ${f2(c)}, so ${agreement(above)}`);
      },
      reading: ['cka'],
    },
  ];

  // dataset files still use the old step names for their reading lists
  const ALIAS = { neighbours: 'neighbors', cloud: 'shape', twins: 'shape', views: 'shape', rips: 'ph', barcodes: 'ph', dimension: 'id' };

  window.METRICS = METRICS;
  window.LENSES = LENSES;
  window.LENS_ALIAS = ALIAS;
})();
