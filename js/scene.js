/* scene.js — the one canvas.
 *
 * Every visual property is a number in `P` that tweens toward a target. A step
 * says "split=1, knn=1" and the scene glides there; nothing is drawn by the
 * steps themselves. Geometry all comes precomputed from data/*.json.
 */
(function () {
  'use strict';

  const easeInOut = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const linear = t => t;
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const lerp = (a, b, t) => a + (b - a) * t;

  // every tweenable knob, and its resting value
  const DEFAULTS = {
    showA: 1,      // opacity of cloud A
    showB: 0,      // opacity of cloud B
    split: 0,      // 0 = one cloud centered, 1 = A left / B right
    links: 0,      // hairlines joining each item to its twin in the other view
    knn: 0,        // k-nearest-neighbor edges, and fill by overlap
    proc: 0,       // 0 = each view in its own frame, 1 = Procrustes-aligned
    resid: 0,      // Procrustes residual lines
    spinB: 0,      // extra rotation of B only (CKA doesn't care)
    mat: 0,        // 0 = cloud, 1 = points sit on the diagonal of their distance matrix
    scatter: 0,    // RSA scatter of pairwise distances
    eps: 0,        // Rips scale
    ph: 0,         // opacity of ε-edges
    bars: 0,       // barcode panel
    nn2: 0,        // TwoNN: lines to 1st and 2nd neighbor
    idplot: 0,     // TwoNN plot
    heat: 0,       // layer × layer CKA heatmap
    fig: 0,        // 0 = clouds use the whole stage, 1 = bottom band reserved for a figure
    labels: 0,     // always-on labels (small datasets only)
    sideT: 0,      // 0 = figure under the clouds, 1 = beside them (glides between)
    pics: 0,       // draw each item as its own (ink-tinted) thumbnail
  };

  const GLYPHS = ['dot', 'ring', 'square', 'cross', 'tri', 'diamond', 'plus'];
  // thumbnails that are pixel art: scaled by nearest neighbour, never smoothed
  const PIXEL_ART = new Set(['pokemon']);
  // thumbnails that are only a soft glow (star colours): nothing to see when enlarged
  const GLOW = new Set(['stars']);

  class Scene {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.P = Object.assign({}, DEFAULTS);
      this.tw = {};
      this.yaw = 0.6;
      this.pitch = -0.32;
      this.spin = 0;          // accumulated extra yaw for B
      this.autoRotate = true;
      this.spinSpeed = 0.12;  // rad/s of idle rotation; decays to zero
      this.spinBSpeed = 0;     // extra rotation of B (the CKA demo)
      this.zoom = 1;          // cloud-only zoom and pan; the panel and figures never move
      this.pan = { x: 0, y: 0 };
      this.viewGoal = null;
      this.focus = 0;         // which representation single-view figures describe
      this.ripsCap = 2500;    // most ε-edges drawn per cloud per frame
      this.figRatio = { side: 0.42, below: 0.44 };   // share of the stage the figure gets
      this.hover = -1;        // hovered item index
      this.hoverView = 0;
      this.drag = null;
      this.onEps = null;
      this.onHover = null;
      this.readColors();
      this.resize();
      this.bindPointer();
      window.addEventListener('resize', () => this.resize());
      // labels are cached as bitmaps: redo them once the real font has arrived
      if (document.fonts) document.fonts.ready.then(() => { this.labelCache = null; this.textW = null; this.resize(); });
      this.last = performance.now();
      requestAnimationFrame(t => this.frame(t));
    }

    // ---------- setup ----------

    readColors() {
      const s = getComputedStyle(document.documentElement);
      this.paper = s.getPropertyValue('--paper').trim();
      this.ink = s.getPropertyValue('--ink').trim();
    }

    resize() {
      // always full sharpness (up to 2×): drawing is cheap enough not to trade it away
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (this.W !== innerWidth || this.H !== innerHeight || this.dpr !== dpr) {
        this.W = innerWidth;
        this.H = innerHeight;
        this.dpr = dpr;
        this.c.width = this.W * dpr;
        this.c.height = this.H * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      // the stage is whatever the sentence bar and the caption leave free
      const top = document.querySelector('.top'), cap = document.querySelector('.caption');
      let hb = top ? top.getBoundingClientRect().bottom : 70;
      if (top && innerWidth > 760) {
        // on wide screens the stage starts below a one-line header, whatever the sentence
        // does: a long one wrapping to a second line must not shrink or shift the cloud
        const ts = getComputedStyle(top), ss = getComputedStyle(top.querySelector('.sentence'));
        hb = top.getBoundingClientRect().top + parseFloat(ts.paddingTop) + parseFloat(ss.lineHeight) + parseFloat(ts.paddingBottom);
      }
      const cb = cap ? cap.getBoundingClientRect().top : this.H;
      const narrow = this.W <= 760;
      const side = narrow ? 12 : 36;
      this.stage = { x: side, y: hb + 34, w: this.W - 2 * side, h: Math.max(40, cb - hb - 56) };
      this.dirty = true;
    }

    // a gentle turn to show it's 3-D, then rest
    kick(speed) { this.spinSpeed = speed === undefined ? 0.35 : speed; }

    setData(ds, opts) {
      const t0 = performance.now();
      // a flat cloud (z ≡ 0) is a picture: face-on and still. Anything else gets a gentle turn.
      const flat = ds.views.some(v => v.xyz.every(p => Math.abs(p[2]) < 1e-6));
      if (flat && !(opts && opts.keepView)) { this.yaw = 0; this.pitch = 0; }
      this.kick(flat ? 0 : undefined);
      if (!(opts && opts.keepView)) { this.zoom = 1; this.pan = { x: 0, y: 0 }; this.viewGoal = null; }
      this.ds = ds;
      this.textW = null;
      this.labelFade = null;
      const n = ds.n;
      this.n = n;
      // Fit the bulk of each cloud to the frame, then pull outliers in softly, so
      // one odd point (fastText's "may", the verb) can't shrink everyone else to a dot.
      const bulk = pts => {
        const r = pts.map(p => Math.hypot(p[0], p[1], p[2])).sort((a, b) => a - b);
        return r[Math.floor(r.length * 0.85)] || 1;
      };
      const fit = (pts, s) => pts.map(p => {
        const r = Math.hypot(p[0], p[1], p[2]) / s;
        const k = r > 1 ? (1 + 0.3 * Math.tanh((r - 1) / 0.3)) / r : 1;
        return p.map(v => (v / s) * k);
      });
      this.xyz = ds.views.map(v => fit(v.xyz, bulk(v.xyz)));
      this.nnMed = this.xyz.map(P3 => {
        // squared distances in flat arrays: this runs on every dataset switch
        const m = P3.length, nn = new Float64Array(m).fill(Infinity);
        const X = new Float64Array(m), Y = new Float64Array(m), Z = new Float64Array(m);
        for (let i = 0; i < m; i++) { X[i] = P3[i][0]; Y[i] = P3[i][1]; Z[i] = P3[i][2]; }
        for (let i = 0; i < m; i++) {
          const xi = X[i], yi = Y[i], zi = Z[i];
          let best = nn[i];
          for (let j = i + 1; j < m; j++) {
            const dx = xi - X[j], dy = yi - Y[j], dz = zi - Z[j], d = dx * dx + dy * dy + dz * dz;
            if (d > 1e-18) { if (d < best) best = d; if (d < nn[j]) nn[j] = d; }
          }
          nn[i] = best;
        }
        const f = Array.from(nn).filter(isFinite).sort((a, b) => a - b);
        return f.length ? Math.sqrt(f[f.length >> 1]) : 1;
      });
      // procrustes: both drawn at A's scale with no outlier squash, so residuals are honest
      const sA = bulk(ds.procrustes.a);
      const lin = pts => pts.map(p => p.map(v => v / sA));
      this.pxyz = [lin(ds.procrustes.a), lin(ds.procrustes.b)];

      // edge lists for the Rips picture, sorted by distance. Distances are integers
      // in ‰, so a counting sort does it in O(m). Each edge also gets a fixed random
      // rank: when there are too many edges to draw, the same ones are always the
      // ones kept, so nothing shimmers as ε moves.
      const m = n * (n - 1) / 2;
      const rng = (seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296))(7);
      this.edges = ds.views.map(v => {
        const cnt = new Uint32Array(1002);
        for (let k = 0; k < m; k++) cnt[v.dist[k] + 1]++;
        for (let t = 1; t < 1002; t++) cnt[t] += cnt[t - 1];
        const I = new Uint16Array(m), J = new Uint16Array(m), D = new Float32Array(m), R = new Float32Array(m);
        let k = 0;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++, k++) {
          const q = cnt[v.dist[k]]++;
          I[q] = i; J[q] = j; D[q] = v.dist[k] / 1000;
        }
        for (let q = 0; q < m; q++) R[q] = rng();
        return { i: I, j: J, d: D, r: R };
      });
      // barcodes, in drawing order, once
      // (indices into view.bars, so a row can find its generator in view.gens);
      // longest first, so the features that matter sit on top and stay clickable
      const life = b => (b[2] === null ? 9 : b[2]) - b[1];
      this.barOrder = ds.views.map(v => {
        const ks = dim => v.bars.map((b, k) => k).filter(k => v.bars[k][0] === dim)
          .sort((p, q) => life(v.bars[q]) - life(v.bars[p]) || v.bars[p][1] - v.bars[q][1]);
        return { h0: ks(0), h1: ks(1), h2: ks(2) };
      });
      this.barScroll = {};
      this.barHits = [];
      this.barSections = [];
      this.sel = null;
      this.barHover = null;
      this.featCache = new Map();
      this.cellHover = null;
      this.rank = new Int32Array(n);
      ds.order.forEach((item, r) => (this.rank[item] = r));
      // each pair's distance as a percentile of its view (ties share their mean rank):
      // RSA is Spearman, so the matrices and scatter show what it sees, as
      // Kriegeskorte et al. show RDMs. Raw ‰ can crowd into a corner otherwise.
      this.pct = ds.views.map(v => {
        const cnt = new Uint32Array(1001), below = new Float64Array(1001), P = new Float32Array(m);
        for (let k = 0; k < m; k++) cnt[v.dist[k]]++;
        for (let t = 1; t <= 1000; t++) below[t] = below[t - 1] + cnt[t - 1];
        for (let k = 0; k < m; k++) P[k] = m > 1 ? (below[v.dist[k]] + (cnt[v.dist[k]] - 1) / 2) / (m - 1) : 0;
        return P;
      });
      // scatter sample for RSA
      const step = Math.max(1, Math.floor(m / 3500));
      this.pairs = [];
      for (let k = 0; k < m; k += step) this.pairs.push([this.pct[0][k], this.pct[1][k]]);
      // how far the ε sweep should go: past the last loop, and past most merges,
      // but not all the way to "everything touches everything"
      let top = 0;
      for (const v of ds.views) {
        const h0 = v.bars.filter(b => b[0] === 0 && b[2] !== null).map(b => b[2]).sort((a, b) => a - b);
        top = Math.max(top, h0[Math.floor(h0.length * 0.95)] || 0);
        for (const b of v.bars) if (b[0] >= 1 && b[2] !== null) top = Math.max(top, b[2]);
      }
      // …and never past the 90th percentile of pair distances, where the picture is a solid haze
      const p90 = Math.max(...this.edges.map(E => E.d[Math.floor(E.d.length * 0.9)] || 1));
      this.epsMax = Math.min(1, top * 1.1 + 0.02, p90);
      this.sx = [new Float32Array(n), new Float32Array(n)];
      this.sy = [new Float32Array(n), new Float32Array(n)];
      this.sz = [new Float32Array(n), new Float32Array(n)];
      this.matImgs = null;
      this.hover = -1;
      // same dataset, new distance: the pictures haven't changed, keep them
      const sameSprites = opts && opts.keepView && this.spriteFor === ds.id && this.tinted;
      if (!sameSprites) {
        this.tinted = null;
        this.scaled = null;
        this.tipURLs = [];
        this.spriteFor = ds.id;
        this.loadSprites();
      }
      this.ripsSel = [];
      if (this.onHover) this.onHover(null);   // no tooltip about a point that just moved away
      this.lastSetDataMs = performance.now() - t0;
      this.dirty = true;
    }

    loadSprites() {
      const ds = this.ds;
      if (!ds) return;
      this.spriteToken = (this.spriteToken || 0) + 1;
      if (ds.glyphs) return this.glyphSprites();
      if (!ds.thumbs) return;
      // colour thumbnails (paintings) are drawn as they are; grayscale ones become ink
      if (ds.thumbsColor) this.origSprites();
      else this.tintThumbs();
    }

    // the images as they really are
    origSprites() {
      const ds = this.ds, out = new Array(ds.n), token = this.spriteToken;
      let left = ds.n;
      ds.thumbs.forEach((src, i) => {
        const im = new Image();
        im.onload = () => {
          const cv = document.createElement('canvas');
          cv.width = im.width; cv.height = im.height;
          cv.getContext('2d').drawImage(im, 0, 0);
          out[i] = cv;
          if (--left === 0 && this.spriteToken === token) { this.tinted = out; this.dirty = true; }
        };
        im.src = src;
      });
    }

    // emoji stay in their own colors: an indigo emoji silhouette is just a blob
    glyphSprites() {
      this.tinted = this.ds.labels.map(t => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 64;
        const g = cv.getContext('2d');
        g.font = '52px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(t, 32, 36);
        return cv;
      });
      this.dirty = true;
    }

    // thumbnails arrive as grayscale "how much ink" PNGs; repaint them in the ink color
    tintThumbs() {
      const ds = this.ds, ink = this.inkRGB(), out = new Array(ds.n), token = this.spriteToken;
      let left = ds.n;
      this.tipURLs = [];
      ds.thumbs.forEach((src, i) => {
        const im = new Image();
        im.onload = () => {
          const cv = document.createElement('canvas');
          cv.width = im.width; cv.height = im.height;
          const g = cv.getContext('2d');
          g.drawImage(im, 0, 0);
          const px = g.getImageData(0, 0, cv.width, cv.height), d = px.data;
          for (let k = 0; k < d.length; k += 4) {
            d[k + 3] = 255 * Math.min(1, Math.pow(Math.max(0, (d[k] - 18) / 237), 0.8) * 1.1);
            d[k] = ink[0]; d[k + 1] = ink[1]; d[k + 2] = ink[2];
          }
          g.putImageData(px, 0, 0);
          out[i] = cv;
          if (--left === 0 && this.spriteToken === token) { this.tinted = out; this.dirty = true; }
        };
        im.src = src;
      });
    }

    showsThumbs() { return !!this.ds.thumbs && !this.ds.glyphs && !GLOW.has(this.ds.id); }

    thumbURL(i) {
      if (this.ds.thumbsColor) return this.ds.thumbs[i];
      if (!this.tinted) return this.ds.thumbs ? this.ds.thumbs[i] : '';
      return this.tipURLs[i] || (this.tipURLs[i] = this.tinted[i].toDataURL());
    }

    // ---------- tweening ----------

    set(target, ms, easing) {
      const now = performance.now();
      for (const k in target) {
        if (!(k in this.P)) continue;
        this.tw[k] = { a: this.P[k], b: target[k], t0: now, d: ms === undefined ? 1100 : ms, e: easing === 'linear' ? linear : easeInOut };
      }
    }

    reset(ms) {
      this.set(Object.assign({}, DEFAULTS), ms);
    }

    setEps(v) {
      delete this.tw.eps;
      this.P.eps = v;
      this.dirty = true;
    }

    // ---------- pointer ----------

    bindPointer() {
      const c = this.c, pts = new Map();
      c.addEventListener('pointerdown', e => {
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        c.setPointerCapture(e.pointerId);
        this.down = { x: e.clientX, y: e.clientY };
        const bar = e.pointerType === 'mouse' ? this.barHover : this.pickBar(e.clientX, e.clientY);
        if (bar) { this.drag = { bar }; return; }
        this.viewGoal = null;
        this.spinSpeed = 0;
        if (this.nearDivider(e.clientX, e.clientY)) {
          this.drag = { divider: true };
          return;
        }
        this.drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch, t: performance.now(), lastX: e.clientX,
          pan: e.shiftKey || e.button === 1, px: this.pan.x, py: this.pan.y };
      });
      c.addEventListener('pointermove', e => {
        if (pts.has(e.pointerId) && pts.size === 2) {
          // two fingers: pinch to zoom, move together to pan
          const [p, q] = [...pts.values()];
          const d0 = Math.hypot(p.x - q.x, p.y - q.y), m0 = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
          pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const [p2, q2] = [...pts.values()];
          const d1 = Math.hypot(p2.x - q2.x, p2.y - q2.y), m1 = { x: (p2.x + q2.x) / 2, y: (p2.y + q2.y) / 2 };
          this.pan.x += m1.x - m0.x;
          this.pan.y += m1.y - m0.y;
          if (d0 > 0) this.zoomAt(d1 / d0, m1.x, m1.y);
          this.drag = null;
          return;
        }
        if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.drag && this.drag.bar) return;
        if (!this.drag && this.hoverBars(e.clientX, e.clientY)) return;
        if (this.drag && this.drag.divider) {
          const { x, y, w, h } = this.stage;
          if (this.figSide) this.figRatio.side = Math.max(0.22, Math.min(0.7, (x + w - e.clientX) / w));
          else this.figRatio.below = Math.max(0.2, Math.min(0.72, (y + h - e.clientY) / h));
          return;
        }
        const hot = !this.drag && this.nearDivider(e.clientX, e.clientY);
        if (hot !== !!this.dividerHot) {
          this.dividerHot = hot;
          c.style.cursor = hot ? (this.figSide ? 'ew-resize' : 'ns-resize') : '';
        }
        if (this.drag) {
          const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
          if (this.drag.pan) {
            this.pan.x = this.drag.px + dx;
            this.pan.y = this.drag.py + dy;
          } else {
            this.yaw = this.drag.yaw + dx * 0.008;
            // remember how fast the hand was moving, for a little coast after release
            const now = performance.now(), dtm = Math.max(1, now - this.drag.t);
            this.drag.vel = ((e.clientX - this.drag.lastX) * 0.008) / (dtm / 1000);
            this.drag.t = now;
            this.drag.lastX = e.clientX;
            this.pitch = Math.max(-1.4, Math.min(1.4, this.drag.pitch + dy * 0.008));
          }
        }
        this.pickAt(e.clientX, e.clientY);
        this.dirty = true;
      });
      const up = e => {
        pts.delete(e.pointerId);
        this.dirty = true;
        if (pts.size === 1) {        // a pinch ended: the remaining finger takes over the turning
          const [q] = pts.values();
          this.drag = { x: q.x, y: q.y, yaw: this.yaw, pitch: this.pitch, t: performance.now(), lastX: q.x, pan: false };
          return;
        }
        const still = this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 6;
        if (this.drag && this.drag.bar) {
          if (still) this.selectBar(this.drag.bar.v, this.drag.bar.k);
          this.drag = null;
          return;
        }
        // a plain click on the cloud, away from any item, lets go of a pinned feature
        if (still && this.sel && this.hover < 0 && !(this.drag && this.drag.divider)) this.selectBar(null);
        if (this.drag && !this.drag.pan && this.drag.vel && !still) this.spinSpeed = Math.max(-3, Math.min(3, this.drag.vel));
        this.drag = null;
      };
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
      c.addEventListener('pointerleave', () => {
        this.hover = -1; this.dirty = true; this.onHover && this.onHover(null);
        if (this.barHover || this.cellHover) { this.barHover = this.cellHover = null; this.onTip && this.onTip(null); }
      });
      c.addEventListener('dblclick', () => this.resetView());

      // wheel and trackpad pinch (which arrives as ctrl+wheel) zoom the cloud only
      c.addEventListener('wheel', e => {
        e.preventDefault();
        // over a barcode that has more rows than room: scroll it
        const S = !e.ctrlKey && this.sectionAt(e.clientX, e.clientY);
        if (S && S.maxScroll > 0) {
          const unit = e.deltaMode === 1 ? 33 : 1;
          this.barScroll[S.key] = Math.max(0, Math.min(S.maxScroll, (this.barScroll[S.key] || 0) + (e.deltaY * unit) / S.step / 2));
          this.dirty = true;
          this.hoverBars(e.clientX, e.clientY);
          return;
        }
        const unit = e.deltaMode === 1 ? 33 : 1;
        this.zoomAt(Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
      }, { passive: false });
      // …and a pinch anywhere else must not zoom the page (panel, header)
      addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
      // Safari's own pinch gestures
      let g0 = 1;
      document.addEventListener('gesturestart', e => { e.preventDefault(); g0 = 1; });
      document.addEventListener('gesturechange', e => {
        e.preventDefault();
        if (e.target === c) this.zoomAt(e.scale / g0, e.clientX, e.clientY);
        g0 = e.scale;
      });
      document.addEventListener('gestureend', e => e.preventDefault());
    }

    // Pointer over the barcode or a distance matrix: tips and previews instead of
    // turning the cloud. True when the pointer is over one of those.
    hoverBars(x, y) {
      const h = this.P.bars > 0.5 ? this.pickBar(x, y) : null;
      const same = h && this.barHover && h.v === this.barHover.v && h.k === this.barHover.k;
      if (h) {
        if (!same) this.barHover = { v: h.v, k: h.k, f: this.feature(h.v, h.k) };
        if (this.hover !== -1) { this.hover = -1; this.onHover && this.onHover(null); }
        this.c.style.cursor = 'pointer';
        this.onTip && this.onTip({ x, y, bar: this.barHover.f });
        this.dirty = true;
        return true;
      }
      if (this.barHover) {
        this.barHover = null;
        this.c.style.cursor = '';
        this.onTip && this.onTip(null);
        this.dirty = true;
      }
      if (this.P.mat > 0.6) {
        const cell = this.cellAt(x, y);
        if (cell) {
          if (!this.cellHover || cell.r !== this.cellHover.r || cell.c !== this.cellHover.c) { this.cellHover = cell; this.dirty = true; }
          this.onTip && this.onTip({ x, y, cell });
          if (this.hover !== -1) { this.hover = -1; this.onHover && this.onHover(null); }
          return true;
        }
        if (this.cellHover) { this.cellHover = null; this.onTip && this.onTip(null); this.dirty = true; }
      }
      return this.sectionAt(x, y) !== null && this.P.bars > 0.5;
    }

    // which pair of items a point on a distance matrix stands for
    cellAt(x, y) {
      const L = this.L || this.layout(), n = this.n, ord = this.ds.order;
      for (let v = 0; v < 2; v++) {
        if ((v === 0 ? this.P.showA : this.P.showB) < 0.5) continue;
        const M = this.matRect(L, v);
        if (x < M.x || y < M.y || x >= M.x + M.s || y >= M.y + M.s) continue;
        const r = Math.floor(((y - M.y) / M.s) * n), c = Math.floor(((x - M.x) / M.s) * n);
        const i = ord[r], j = ord[c];
        if (i === j) return null;
        const k = (a, b) => (a > b ? k(b, a) : n * a - (a * (a + 1)) / 2 + (b - a - 1));
        return { v, r, c, i, j, pct: [this.pct[0][k(i, j)], this.pct[1][k(i, j)]] };
      }
      return null;
    }

    // zoom by factor f, keeping the cloud point under (px, py) where it is
    zoomAt(f, px, py) {
      const L = this.layout();
      const v = Math.abs(px - L.cx0[0]) <= Math.abs(px - L.cx0[1]) ? 0 : 1;
      const cx = L.cx0[v], cy = L.cy0;
      const z = Math.max(0.5, Math.min(14, this.zoom * f)), k = z / this.zoom;
      this.pan.x = px - cx - k * (px - cx - this.pan.x);
      this.pan.y = py - cy - k * (py - cy - this.pan.y);
      this.zoom = z;
      this.zoomedAt = performance.now();
      this.viewGoal = null;
      this.dirty = true;
    }

    zoomBy(f) {
      const L = this.layout();
      this.zoomAt(f, (L.cx0[0] + L.cx0[1]) / 2, L.cy0);
    }

    resetView() {
      this.viewGoal = { zoom: 1, x: 0, y: 0 };
    }

    pickAt(x, y) {
      if (!this.ds) return;
      const pr = this.pickR || 15;
      let best = -1, bestView = 0, bd = pr * pr;
      const C = this.lastClip;   // points clipped out of the cloud area can't be picked
      if (C && (x < C.x || x > C.x + C.w || y < C.y || y > C.y + C.h)) {
        if (this.hover !== -1) { this.hover = -1; this.onHover && this.onHover(null); }
        return;
      }
      for (let v = 0; v < 2; v++) {
        if ((v === 0 ? this.P.showA : this.P.showB) < 0.4) continue;
        for (let i = 0; i < this.n; i++) {
          const dx = this.sx[v][i] - x, dy = this.sy[v][i] - y, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = i; bestView = v; }
        }
      }
      if (best !== this.hover || bestView !== this.hoverView) {
        this.hover = best;
        this.hoverView = bestView;
        this.onHover && this.onHover(best < 0 ? null : { i: best, view: bestView, x, y });
      } else if (best >= 0 && this.onHover) {
        this.onHover({ i: best, view: bestView, x, y, move: true });
      }
    }

    // ---------- geometry ----------

    // One cloud on a wide screen: the figure (barcode, plot…) gets a column on the
    // right. Two clouds: figures go underneath. Either way a draggable divider
    // sets how much room each side gets.
    layout() {
      const t = this.P.sideT;
      if (t <= 0) return this.layoutFor(false);
      if (t >= 1) return this.layoutFor(true);
      // mid-glide: blend every number of the two arrangements
      const A = this.layoutFor(false), B = this.layoutFor(true);
      const mix = (p, q) => typeof p === 'number' ? lerp(p, q, t)
        : Array.isArray(p) ? p.map((x, i) => mix(x, q[i]))
        : p && typeof p === 'object' ? Object.fromEntries(Object.keys(p).map(k => [k, mix(p[k], q[k])]))
        : (t < 0.5 ? p : q);
      return mix(A, B);
    }

    layoutFor(side) {
      const { x, y, w, h } = this.stage, P = this.P;
      const s = P.split;
      this.figSide = this.P.sideT >= 0.5;
      // a phone's stage is short: the figure underneath takes a smaller share
      const below = this.W <= 760 ? Math.min(this.figRatio.below, 0.36) : this.figRatio.below;
      const r = (side ? this.figRatio.side : below) * P.fig;
      let cloud, fig, divider;
      if (side) {
        const fw = w * r;
        cloud = { x, y, w: w - fw, h };
        fig = { x: x + w - fw + 24, y: y + 10, w: Math.max(0, fw - 24), h: Math.max(0, h - 10) };
        divider = { x: x + w - fw, y, w: 0, h };
      } else {
        const fh = h * r;
        cloud = { x, y, w, h: h - fh };
        fig = { x, y: y + h - fh + 10, w, h: Math.max(0, fh - 10) };
        divider = { x, y: y + h - fh, w, h: 0 };
      }
      const half = Math.min(cloud.w / 4, 380);   // on wide screens, don't drift to the edges
      // leave room for the titles above two clouds; the display fit can reach ~1.2 R
      const titles = s > 0.5 ? 30 : 0;
      const R0 = Math.max(10, Math.min((cloud.w / 2) * (1 - s * 0.5) * 0.9, (cloud.h / 2 - titles) / 1.2));
      const cx0 = [cloud.x + cloud.w / 2 - s * half, cloud.x + cloud.w / 2 + s * half], cy0 = cloud.y + cloud.h / 2 + titles / 2;
      return {
        cx0, cy0, R0,
        cx: cx0.map(c => c + this.pan.x),
        cy: cy0 + this.pan.y,
        R: R0 * this.zoom,
        // the cloud is only kept off the figure; at the screen's edges it runs on under
        // the header's fade and behind the caption, rather than being cut off in mid-air
        clip: P.fig < 0.02 ? { x: 0, y: 0, w: this.W, h: this.H }
          : side ? { x: 0, y: 0, w: cloud.x + cloud.w - 2, h: this.H }
          : { x: 0, y: 0, w: this.W, h: cloud.y + cloud.h - 2 },
        fig, divider,
      };
    }

    project(L) {
      const P = this.P, n = this.n;
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      for (let v = 0; v < 2; v++) {
        const yaw = this.yaw + (v === 1 ? this.spin * P.spinB : 0);
        const cy_ = Math.cos(yaw), sy_ = Math.sin(yaw);
        const raw = this.xyz[v], pr = this.pxyz[v];
        // matrix mode: points walk to the diagonal of their own matrix
        const M = this.matRect(L, v);
        for (let i = 0; i < n; i++) {
          const a = raw[i], b = pr[i];
          const X = lerp(a[0], b[0], P.proc), Y = lerp(a[1], b[1], P.proc), Z = lerp(a[2], b[2], P.proc);
          const x1 = X * cy_ + Z * sy_, z1 = -X * sy_ + Z * cy_;
          const y2 = Y * cp - z1 * sp, z2 = Y * sp + z1 * cp;
          let px = L.cx[v] + x1 * L.R, py = L.cy - y2 * L.R;
          if (P.mat > 0) {
            const t = clamp01(P.mat * 1.6);
            const r = (this.rank[i] + 0.5) / n;
            px = lerp(px, M.x + r * M.s, t);
            py = lerp(py, M.y + r * M.s, t);
          }
          this.sx[v][i] = px;
          this.sy[v][i] = py;
          this.sz[v][i] = z2;
        }
      }
    }

    matRect(L, v) {
      const s = Math.min(L.R0 * 1.7, this.stage.w / 2 - 40);
      return { x: L.cx0[v] - s / 2, y: L.cy0 - s / 2, s };
    }

    // ---------- persistence features ----------
    //
    // view.gens (prep/generators.py) holds, per bar, the edges that create and
    // destroy it. From those the scene rebuilds the feature itself:
    //   H0  the piece that the death edge merges into an older one
    //   H1  a loop: the birth edge plus the shortest path between its ends using
    //       only edges that were already there (so it exists at birth, by construction)
    //   H2  the edge that closes the shell, and the chord across the hollow that fills it

    cond(v, i, j) {
      if (i > j) [i, j] = [j, i];
      return this.ds.views[v].dist[this.n * i - (i * (i + 1)) / 2 + (j - i - 1)];
    }

    // edges shorter than q‰ (the sorted list makes that a prefix)
    prefixBelow(v, q) {
      const E = this.edges[v];
      let lo = 0, hi = E.d.length;
      const x = (q - 0.5) / 1000;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (E.d[mid] < x) lo = mid + 1; else hi = mid; }
      return lo;
    }

    feature(v, k) {
      const key = v + ':' + k;
      if (this.featCache.has(key)) return this.featCache.get(key);
      const V = this.ds.views[v], bar = V.bars[k], gen = V.gens ? V.gens[k] : null, n = this.n;
      const f = { v, k, dim: bar[0], birth: bar[1], death: bar[2], gen, located: !!V.gens, mask: null, pts: [], loop: null, chord: null, edge: null };
      if (gen) {
        const E = this.edges[v];
        if (f.dim === 0) {
          // union–find over every edge shorter than the merging one
          const [u, w] = gen, K = this.prefixBelow(v, this.cond(v, u, w));
          const up = new Int32Array(n).map((_, i) => i);
          const find = x => { while (up[x] !== x) x = up[x] = up[up[x]]; return x; };
          for (let e = 0; e < K; e++) { const a = find(E.i[e]), b = find(E.j[e]); if (a !== b) up[a] = b; }
          const ru = find(u), rw = find(w), A = [], B = [];
          for (let i = 0; i < n; i++) { const r = find(i); if (r === ru) A.push(i); else if (r === rw) B.push(i); }
          f.pts = A.length <= B.length ? A : B;   // the younger piece: the smaller one
          f.edge = [u, w];
        } else {
          const [bu, bv, du, dv] = gen;
          f.edge = [bu, bv];
          f.chord = [du, dv];
          if (f.dim === 1) f.loop = this.shortestPath(v, bu, bv, this.cond(v, bu, bv));
          f.pts = f.loop ? f.loop.slice() : [bu, bv, du, dv];
          if (f.dim === 2) f.pts = [...new Set([bu, bv, du, dv])];
        }
        f.mask = new Uint8Array(n);
        for (const i of f.pts) f.mask[i] = 1;
        if (f.edge) { f.mask[f.edge[0]] = 1; f.mask[f.edge[1]] = 1; }
      }
      this.featCache.set(key, f);
      return f;
    }

    // Dijkstra on a dense matrix (n ≤ a few hundred), over edges shorter than q‰
    shortestPath(v, s, t, q) {
      const n = this.n, E = this.edges[v];
      let K = this.prefixBelow(v, q);
      const run = (K, skipDirect) => {
        const W = new Float32Array(n * n).fill(Infinity);
        for (let e = 0; e < K; e++) {
          const i = E.i[e], j = E.j[e];
          if (skipDirect && ((i === s && j === t) || (i === t && j === s))) continue;
          W[i * n + j] = W[j * n + i] = E.d[e];
        }
        const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
        dist[s] = 0;
        for (;;) {
          let u = -1, best = Infinity;
          for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
          if (u < 0 || u === t) break;
          done[u] = 1;
          const row = u * n;
          for (let i = 0; i < n; i++) {
            const w = W[row + i];
            if (w !== Infinity && best + w < dist[i]) { dist[i] = best + w; prev[i] = u; }
          }
        }
        if (dist[t] === Infinity) return null;
        const path = [];
        for (let x = t; x >= 0; x = prev[x]) path.push(x);
        return path.reverse();
      };
      // ties at the birth length (distances are stored in ‰): allow those too
      return run(K, false) || run(this.prefixBelow(v, q + 1), true);
    }

    // what to draw: the bar under the pointer previews, a clicked one stays
    activeFeature(v) {
      const f = this.barHover && this.barHover.f.gen ? this.barHover.f : this.sel;
      return f && f.v === v && this.P.bars > 0.5 ? f : null;
    }

    selectBar(v, k) {
      if (v === null || v === undefined) {
        this.sel = null;
      } else {
        const f = this.feature(v, k);
        this.sel = this.sel && this.sel.v === v && this.sel.k === k ? null : f;
        // move ε into the feature's lifetime, so the complex shows it alive
        if (this.sel && f.death !== null) this.set({ eps: (f.birth + f.death) / 2 }, 650);
        if (this.sel) this.frameFeature(f);
      }
      this.dirty = true;
      if (this.onFeature) this.onFeature(this.sel);
    }

    // glide the view so a small feature fills a good part of the cloud's room
    frameFeature(f) {
      const L = this.L || this.layout(), v = f.v;
      const pts = f.pts.concat(f.edge || [], f.chord || []);
      // a void is pinned by a few points around a hollow: framing them would hide the hollow
      if (f.dim === 2 || pts.length < 3 || !L.R) return;
      this.spinSpeed = 0;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const i of pts) {
        const X = (this.sx[v][i] - L.cx[v]) / L.R, Y = (this.sy[v][i] - L.cy) / L.R;   // in units of R
        x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
      }
      const span = Math.max(x1 - x0, y1 - y0, 0.05);
      const z = Math.max(1, Math.min(5, 1.1 / span));
      if (z < 1.3 && this.zoom < 1.3) return;   // already big enough: leave the view alone
      const cxN = (x0 + x1) / 2, cyN = (y0 + y1) / 2;
      // in a split view, center on that cloud's own middle
      this.viewGoal = { zoom: z, x: -cxN * L.R0 * z, y: -cyN * L.R0 * z };
    }

    clearFeature() {
      this.sel = null;
      this.barHover = null;
      if (this.onFeature) this.onFeature(null);
    }

    pickBar(x, y) {
      for (const h of this.barHits) {
        if (x >= h.x0 && x <= h.x1 && y >= h.y - h.h / 2 && y < h.y + h.h / 2) return h;
      }
      return null;
    }

    sectionAt(x, y) {
      return this.barSections.find(S => x >= S.x && x <= S.x + S.w && y >= S.y && y <= S.y + S.h) || null;
    }

    drawFeature(v, a) {
      const f = this.activeFeature(v);
      if (!f || !f.gen) return;
      const ctx = this.ctx, sx = this.sx[v], sy = this.sy[v];
      const pinned = this.sel === f;
      ctx.globalAlpha = a;
      ctx.strokeStyle = this.ink;
      // the feature's points: rings
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (const i of f.pts) { ctx.moveTo(sx[i] + 7, sy[i]); ctx.arc(sx[i], sy[i], 7, 0, Math.PI * 2); }
      ctx.stroke();
      if (f.loop && f.loop.length > 1) {
        // the loop, closed by its birth edge
        ctx.lineWidth = pinned ? 2.6 : 2.2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        f.loop.forEach((i, t) => (t ? ctx.lineTo(sx[i], sy[i]) : ctx.moveTo(sx[i], sy[i])));
        ctx.closePath();
        ctx.stroke();
      } else if (f.edge && f.dim !== 0) {
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(sx[f.edge[0]], sy[f.edge[0]]);
        ctx.lineTo(sx[f.edge[1]], sy[f.edge[1]]);
        ctx.stroke();
      }
      if (f.chord) {
        // the edge whose arrival fills it in
        ctx.globalAlpha = a * 0.75;
        ctx.lineWidth = 1.3;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(sx[f.chord[0]], sy[f.chord[0]]);
        ctx.lineTo(sx[f.chord[1]], sy[f.chord[1]]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (f.dim === 0 && f.edge) {
        // H0: the bridge, dashed: it arrives at the bar's death
        ctx.globalAlpha = a * 0.85;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(sx[f.edge[0]], sy[f.edge[0]]);
        ctx.lineTo(sx[f.edge[1]], sy[f.edge[1]]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ---------- drawing ----------

    frame(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      for (const k in this.tw) {
        const t = this.tw[k], u = clamp01((now - t.t0) / t.d);
        this.P[k] = t.a + (t.b - t.a) * t.e(u);
        if (k === 'eps' && this.onEps) this.onEps(this.P.eps);
        this.dirty = true;                         // includes the final, resting value
        if (u >= 1) delete this.tw[k];
      }
      if (this.viewGoal) {
        const g = this.viewGoal, k = Math.min(1, dt * 7);
        this.zoom += (g.zoom - this.zoom) * k;
        this.zoomedAt = performance.now();
        this.pan.x += (g.x - this.pan.x) * k;
        this.pan.y += (g.y - this.pan.y) * k;
        if (Math.abs(this.zoom - g.zoom) < 1e-3 && Math.hypot(this.pan.x - g.x, this.pan.y - g.y) < 0.5) {
          this.zoom = g.zoom; this.pan = { x: g.x, y: g.y }; this.viewGoal = null;
        }
        this.dirty = true;
      }
      // the figure's place (beside one cloud, under two) glides, never jumps
      const sideTarget = this.oneCloud && this.stage.w > 900 ? 1 : 0;
      if (this.P.sideT !== sideTarget) {
        const d = sideTarget - this.P.sideT;
        this.P.sideT = Math.abs(d) < 0.004 ? sideTarget : this.P.sideT + d * Math.min(1, dt * 6);
        this.dirty = true;
      }
      // idle rotation glides to a stop (half-life ~2.5 s)
      if (this.autoRotate && !this.drag && this.hover < 0) this.yaw += dt * this.spinSpeed;
      if (!this.drag) this.spinSpeed *= Math.pow(0.5, dt / 2.5);
      this.spin += dt * this.spinBSpeed;
      this.spinBSpeed *= Math.pow(0.5, dt / 1.6);
      if (Math.abs(this.spinSpeed) < 0.01) this.spinSpeed = 0;      // stop, rather than creep forever
      if (Math.abs(this.spinBSpeed) < 0.01) this.spinBSpeed = 0;
      // nothing moving and nothing changed: skip the frame (saves the battery)
      const moving = Object.keys(this.tw).length || this.spinSpeed || this.spinBSpeed || this.viewGoal || this.drag;
      this.moving = !!moving;
      this.dt = dt;
      if (this.wasMoving && !moving) this.dirty = true;   // one last frame, snapped crisp
      this.wasMoving = !!moving;
      // cleared before drawing, so a draw can ask for another frame (fades, settling sprites)
      const dirty = this.dirty;
      this.dirty = false;
      if (moving || dirty) this.draw();
      requestAnimationFrame(t => this.frame(t));
    }

    invalidate() { this.dirty = true; }

    draw() {
      const ctx = this.ctx, P = this.P;
      ctx.fillStyle = this.paper;
      ctx.fillRect(0, 0, this.W, this.H);
      if (!this.ds) return;
      ctx.strokeStyle = this.ink;
      ctx.fillStyle = this.ink;
      const L = this.layout();
      this.L = L;
      this.project(L);
      const vis = [P.showA, P.showB];

      if (P.mat > 0.3) this.drawMatrices(L, clamp01((P.mat - 0.3) / 0.7));
      this.lastClip = L.clip;
      ctx.save();
      ctx.beginPath();
      ctx.rect(L.clip.x, L.clip.y, L.clip.w, L.clip.h);
      ctx.clip();
      if (P.links > 0) this.drawLinks(P.links * Math.min(vis[0], vis[1]));
      if (P.resid > 0) this.drawLinks(P.resid * Math.min(vis[0], vis[1]), true);
      for (let v = 0; v < 2; v++) {
        if (vis[v] <= 0.01) continue;
        if (P.ph > 0) this.drawRips(v, P.ph * vis[v]);
        if (P.knn > 0) this.drawKnn(v, P.knn * vis[v]);
        if (P.nn2 > 0) this.drawTwoNN(v, P.nn2 * vis[v]);
      }
      for (let v = 0; v < 2; v++) if (vis[v] > 0.01) this.drawPoints(v, vis[v]);
      for (let v = 0; v < 2; v++) if (vis[v] > 0.01 && P.bars > 0.5) this.drawFeature(v, vis[v] * (P.bars - 0.5) * 2);
      const labelA = P.labels * (1 - clamp01(P.mat * 2));
      if (labelA > 0.01) for (let v = 0; v < 2; v++) if (vis[v] > 0.01) this.drawLabels(v, labelA * vis[v]);
      ctx.restore();
      if (P.split > 0.5 && P.mat < 0.5) this.drawViewNames(L, (P.split - 0.5) * 2);

      this.curR0 = L.R0;
      if (P.fig > 0.5) this.drawDivider(L.divider, (P.fig - 0.5) * 2);
      this.barHits = [];
      this.barSections = [];
      if (P.fig > 0.02 && L.fig.h > 70 && L.fig.w > 90) {
        const F = L.fig;
        if (P.bars > 0) this.drawBarcodes(F, P.bars);
        if (P.scatter > 0) this.drawScatter(F, P.scatter);
        if (P.idplot > 0) this.drawIdPlot(F, P.idplot);
        if (P.heat > 0) this.drawHeat(F, P.heat);
      }
      ctx.globalAlpha = 1;
    }

    drawDivider(D, a) {
      const ctx = this.ctx;
      ctx.globalAlpha = a * (this.dividerHot ? 0.6 : 0.16);
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (D.w) { ctx.moveTo(D.x, D.y); ctx.lineTo(D.x + D.w, D.y); }
      else { ctx.moveTo(D.x, D.y); ctx.lineTo(D.x, D.y + D.h); }
      ctx.stroke();
      // a small grip in the middle says "you can drag me"
      ctx.globalAlpha = a * (this.dividerHot ? 0.9 : 0.45);
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (D.w) { const m = D.x + D.w / 2; ctx.moveTo(m - 14, D.y - 3); ctx.lineTo(m + 14, D.y - 3); ctx.moveTo(m - 14, D.y + 3); ctx.lineTo(m + 14, D.y + 3); }
      else { const m = D.y + D.h / 2; ctx.moveTo(D.x - 3, m - 14); ctx.lineTo(D.x - 3, m + 14); ctx.moveTo(D.x + 3, m - 14); ctx.lineTo(D.x + 3, m + 14); }
      ctx.stroke();
    }

    nearDivider(px, py) {
      if (this.P.fig < 0.5) return false;
      const D = (this.L || this.layout()).divider;
      if (!D) return false;
      return D.w ? Math.abs(py - D.y) < 8 && px >= D.x && px <= D.x + D.w
                 : Math.abs(px - D.x) < 8 && py >= D.y && py <= D.y + D.h;
    }

    depthAlpha(v, i) {
      return 0.8 + 0.2 * clamp01((this.sz[v][i] + 1) / 2);
    }

    // Sprites pre-scaled to the size they are drawn at, in device pixels: every
    // frame is then a 1:1 copy (crisp, and cheap), and resampling happens once,
    // with good filtering, only when the size changes (zoom, resize).
    spritesAt(ps, exact) {
      const dpr = this.dpr, want = Math.max(8, Math.min(360, ps * dpr));
      const S = exact ? Math.round(want) : Math.round(Math.pow(2, Math.round(Math.log2(want) * 6) / 6));
      // a few sizes at once: two clouds can want different ones
      if (!this.scaled || this.scaled.src !== this.tinted) this.scaled = { src: this.tinted, sizes: new Map() };
      const hit = this.scaled.sizes.get(S);
      if (hit) return hit;
      if (this.scaled.sizes.size >= 6) this.scaled.sizes.delete(this.scaled.sizes.keys().next().value);
      const pixel = PIXEL_ART.has(this.ds.id);
      const out = this.tinted.map(im => {
        const asp = im.height / im.width;
        const w = Math.max(1, Math.round(asp > 1 ? S / asp : S)), h = Math.max(1, Math.round(asp > 1 ? S : S * asp));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const g = cv.getContext('2d');
        // pixel art scales by nearest neighbour; photos and drawings get smoothed
        g.imageSmoothingEnabled = !(pixel && w >= im.width);
        g.imageSmoothingQuality = 'high';
        g.drawImage(im, 0, 0, w, h);
        return cv;
      });
      const entry = { S, imgs: out };
      this.scaled.sizes.set(S, entry);
      return entry;
    }

    drawPoints(v, a) {
      const ctx = this.ctx, P = this.P, n = this.n, g = this.ds.groups;
      const ov = this.ds.knn.overlap;
      const r = (n > 250 ? 4.2 : n > 100 ? 5 : 6.5) * Math.min(1.8, Math.sqrt(Math.max(1, this.zoom))) * (1 - 0.7 * clamp01(P.mat));
      const twin = this.hover >= 0;
      const pics = this.tinted ? P.pics : 0;
      const grow = Math.min(2.2, Math.sqrt(Math.max(1, this.zoom)));
      // a picture about 2.6× the typical gap to its nearest neighbour, within sensible bounds
      const base = (n > 300 ? 32 : n > 200 ? 34 : n > 100 ? 38 : n > 60 ? 34 : 44) * (this.ds.glyphs ? 0.85 : 1);
      const spacing = (this.nnMed ? this.nnMed[v] : 1) * (this.curR0 || 200);
      const floor = Math.max(7, Math.min(16, (this.curR0 || 200) * 0.09));   // small clouds (phones) get small pictures
      const ps = Math.max(floor, Math.min(base, spacing * 2.6)) * grow;
      this.pickR = Math.max(15, ps * 0.45);
      const F = this.activeFeature(v), mask = F && F.mask;
      const sx = this.sx[v], sy = this.sy[v];
      // per-point opacity, then drawn in a few batches of equal opacity: one path
      // per (glyph, opacity) instead of one per point
      if (!this.alphaBuf || this.alphaBuf.length !== n) this.alphaBuf = new Float32Array(n);
      const al = this.alphaBuf;
      for (let i = 0; i < n; i++) {
        let x = this.depthAlpha(v, i);
        if (P.knn > 0) x = lerp(x, 0.25 + 0.75 * ov[i], P.knn);
        if (twin && i !== this.hover && P.knn > 0.5) x *= 0.6;
        if (mask && !mask[i]) x *= 0.3;
        al[i] = x;
      }
      if (pics < 1) {
        const LV = 24, buckets = new Map();   // fine steps: no visible blink as a point turns through depth
        for (let i = 0; i < n; i++) {
          const kind = g ? GLYPHS[g[i] % GLYPHS.length] : 'dot';
          const key = kind + Math.round(al[i] * LV);
          let b = buckets.get(key);
          if (!b) buckets.set(key, (b = { kind, q: Math.round(al[i] * LV) / LV, list: [] }));
          b.list.push(i);
        }
        ctx.lineWidth = 1.4;
        for (const b of buckets.values()) {
          ctx.globalAlpha = a * b.q * (1 - pics);
          ctx.beginPath();
          for (const i of b.list) this.glyphPath(sx[i], sy[i], r, b.kind);
          if (b.kind === 'dot' || b.kind === 'diamond') ctx.fill(); else ctx.stroke();
        }
      }
      if (pics > 0) {
        // far points first, so near thumbnails sit on top
        if (!this.orderBuf || this.orderBuf.length !== n) this.orderBuf = new Uint16Array(n);
        const order = this.orderBuf;
        for (let i = 0; i < n; i++) order[i] = i;
        const z = this.sz[v];
        order.sort((p, q) => z[p] - z[q] || p - q);   // ties broken by index: no swapping
        // while zooming, the nearest cached size, scaled smoothly to the exact one; once the
        // zoom settles, sprites at exactly this size, drawn 1:1 on whole device pixels
        const settled = performance.now() - (this.zoomedAt || 0) > 250;
        const SP = this.spritesAt(ps, settled), dpr = this.dpr, snap = !this.moving;
        const scale = settled ? 1 : (ps * dpr) / SP.S;   // settled: the sprite is already the right size
        for (let k = 0; k < n; k++) {
          const i = order[k], im = SP.imgs[i];
          const w = (im.width * scale) / dpr, h = (im.height * scale) / dpr;
          ctx.globalAlpha = a * pics * (0.55 + 0.45 * al[i]) * (mask && !mask[i] ? 0.45 : 1);
          let x = sx[i] - w / 2, y = sy[i] - h / 2;
          if (snap) { x = Math.round(x * dpr) / dpr; y = Math.round(y * dpr) / dpr; }
          ctx.drawImage(im, x, y, w, h);
        }
        if (!settled) this.dirty = true;   // come back to draw the settled, exact size
      }
      if (this.hover >= 0) {   // in both clouds: the item and its twin
        const i = this.hover, x = sx[i], y = sy[i];
        ctx.globalAlpha = a;
        if (pics > 0 && !GLOW.has(this.ds.id)) {
          // the hovered item, big enough to actually see
          const im = this.tinted[i], asp = im.height / im.width, Z = ps * 2.6;
          const w = asp > 1 ? Z / asp : Z, h = asp > 1 ? Z : Z * asp;
          ctx.fillStyle = this.paper;
          ctx.fillRect(x - w / 2 - 6, y - h / 2 - 6, w + 12, h + 12);
          ctx.fillStyle = this.ink;
          ctx.lineWidth = 1.2;
          ctx.strokeRect(x - w / 2 - 6, y - h / 2 - 6, w + 12, h + 12);
          ctx.imageSmoothingEnabled = !PIXEL_ART.has(this.ds.id);
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(im, x - w / 2, y - h / 2, w, h);
          ctx.imageSmoothingEnabled = true;
        } else {
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, r + 7, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // adds one glyph to the current path; the caller fills (dot, diamond) or strokes
    glyphPath(x, y, r, kind) {
      const ctx = this.ctx;
      switch (kind) {
        case 'ring': ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); return;
        case 'square': ctx.rect(x - r * .85, y - r * .85, r * 1.7, r * 1.7); return;
        case 'cross': ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); return;
        case 'plus': ctx.moveTo(x - r * 1.2, y); ctx.lineTo(x + r * 1.2, y); ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x, y + r * 1.2); return;
        case 'tri': ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r, y + r * .7); ctx.lineTo(x - r, y + r * .7); ctx.closePath(); return;
        case 'diamond': ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r, y); ctx.closePath(); return;
        default: ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    }

    glyph(x, y, r, kind) {
      const ctx = this.ctx;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      switch (kind) {
        case 'ring': ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); return;
        case 'square': ctx.rect(x - r * .85, y - r * .85, r * 1.7, r * 1.7); ctx.stroke(); return;
        case 'cross': ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); return;
        case 'plus': ctx.moveTo(x - r * 1.2, y); ctx.lineTo(x + r * 1.2, y); ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x, y + r * 1.2); ctx.stroke(); return;
        case 'tri': ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r, y + r * .7); ctx.lineTo(x - r, y + r * .7); ctx.closePath(); ctx.stroke(); return;
        case 'diamond': ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); return;
        default: ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }

    drawLabels(v, a) {
      const ctx = this.ctx;
      ctx.font = '400 15px "IBM Plex Mono", monospace';
      ctx.textBaseline = 'middle';
      const L = v === 1 && this.ds.labelsB ? this.ds.labelsB : this.ds.labels;
      // items that land on the same spot (identical candies…) share one label
      const spots = new Map();
      const W = this.textW || (this.textW = new Map());
      const width = t => { let w = W.get(t); if (w === undefined) W.set(t, (w = ctx.measureText(t).width)); return w; };
      for (let i = 0; i < this.n; i++) {
        const key = Math.round(this.sx[v][i] / 3) * 65536 + Math.round(this.sy[v][i] / 3);
        if (!spots.has(key)) spots.set(key, []);
        spots.get(key).push(i);
      }
      // biggest piles first; a label that would overlap one already placed waits
      // until zooming makes room
      const placed = [];
      const was = this.shownLabels && this.shownLabels[v] || new Set();
      const groups = [...spots.values()].sort((p, q) =>
        (was.has(q[0]) - was.has(p[0])) || (q.length - p.length) || (p[0] - q[0]));
      const now = new Map();   // item -> its label text, for every label placed this frame
      const C = this.lastClip;
      for (const items of groups) {
        const i = items[0];
        if (C && (this.sx[v][i] < C.x || this.sx[v][i] > C.x + C.w || this.sy[v][i] < C.y || this.sy[v][i] > C.y + C.h)) continue;
        const text = items.slice(0, 2).map(j => L[j]).join(', ') + (items.length > 2 ? ` +${items.length - 2}` : '');
        const x = this.sx[v][i] + 10, y = this.sy[v][i] - 10, w = width(text);
        const box = [x - 2, y - 9, x + w + 2, y + 9];
        if (placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        placed.push(box);
        now.set(i, text);
      }
      // Labels fade in and out (~0.1 s) instead of popping as the cloud turns and
      // they bump into each other; one that lost its place finishes fading where it is.
      const fades = (this.labelFade = this.labelFade || [])[v] || (this.labelFade[v] = new Map());
      const k = Math.min(1, (this.dt || 0.016) * 12);
      for (const [i, text] of now) if (!fades.has(i)) fades.set(i, { a: 0, text });
      const dpr = this.dpr, snap = !this.moving;
      for (const [i, f] of fades) {
        const on = now.has(i);
        if (on) f.text = now.get(i);
        f.a += ((on ? 1 : 0) - f.a) * k;
        if (!on && f.a < 0.03) { fades.delete(i); continue; }
        if (Math.abs((on ? 1 : 0) - f.a) > 0.01) this.dirty = true;   // still fading: keep drawing
        ctx.globalAlpha = a * f.a * this.depthAlpha(v, i);
        const sp = this.labelSprite(f.text);
        let x = this.sx[v][i] + 8, y = this.sy[v][i] - 21;
        if (snap) { x = Math.round(x * dpr) / dpr; y = Math.round(y * dpr) / dpr; }
        ctx.drawImage(sp, x, y, sp.width / dpr, sp.height / dpr);
      }
      (this.shownLabels = this.shownLabels || [])[v] = new Set(now.keys());
    }

    // a label rendered once at device resolution; drawing a bitmap is far cheaper than text
    labelSprite(text) {
      const key = this.dpr + '|' + text;
      const C = this.labelCache || (this.labelCache = new Map());
      let cv = C.get(key);
      if (cv) return cv;
      if (C.size > 3000) C.clear();
      const ctx = this.ctx, dpr = this.dpr, w = Math.ceil(ctx.measureText(text).width) + 4;
      cv = document.createElement('canvas');
      cv.width = Math.ceil(w * dpr); cv.height = Math.ceil(22 * dpr);
      const g = cv.getContext('2d');
      g.scale(dpr, dpr);
      g.font = ctx.font;
      g.fillStyle = this.ink;
      g.textBaseline = 'middle';
      g.fillText(text, 2, 11);
      C.set(key, cv);
      return cv;
    }

    // every item drawn at (about) the same place as item i in view v
    stackedWith(i, v) {
      const out = [];
      for (let j = 0; j < this.n; j++) {
        if (Math.abs(this.sx[v][j] - this.sx[v][i]) < 1.5 && Math.abs(this.sy[v][j] - this.sy[v][i]) < 1.5) out.push(j);
      }
      return out;
    }

    drawViewNames(L, a) {
      const ctx = this.ctx;
      ctx.globalAlpha = a * 0.9;
      ctx.font = '400 14px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      for (let v = 0; v < 2; v++) {
        const V = this.ds.views[v];
        const full = `${v ? 'B' : 'A'}  ·  ${V.name.toUpperCase()}  ·  ${V.dims ? V.dims + '-D' : 'RDM'}`;
        ctx.fillText(ctx.measureText(full).width < L.R0 * 2.2 ? full : V.name.toUpperCase(), L.cx0[v], L.cy0 - L.R0 - 26);
      }
      ctx.textAlign = 'left';
    }

    drawLinks(a, resid) {
      const ctx = this.ctx, n = this.n;
      // bulk lines are one device pixel wide: crisp, and far cheaper to rasterize
      ctx.lineWidth = resid ? 1.3 : this.hair();
      ctx.globalAlpha = a * (resid ? 0.75 : (n > 150 ? 0.2 : 0.45));
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        ctx.moveTo(this.sx[0][i], this.sy[0][i]);
        ctx.lineTo(this.sx[1][i], this.sy[1][i]);
      }
      ctx.stroke();
      if (this.hover >= 0 && !resid) {
        const i = this.hover;
        ctx.globalAlpha = a;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.sx[0][i], this.sy[0][i]);
        ctx.lineTo(this.sx[1][i], this.sy[1][i]);
        ctx.stroke();
      }
    }

    // one device pixel: the cheapest, sharpest line a canvas draws
    hair() { return 1 / this.dpr; }

    drawKnn(v, a) {
      const ctx = this.ctx, nb = this.ds.views[v].nbrs, n = this.n;
      ctx.lineWidth = this.hair();
      ctx.globalAlpha = a * (n > 150 ? 0.38 : 0.62);
      ctx.beginPath();
      for (let i = 0; i < n; i++) for (const j of nb[i]) {
        ctx.moveTo(this.sx[v][i], this.sy[v][i]);
        ctx.lineTo(this.sx[v][j], this.sy[v][j]);
      }
      ctx.stroke();
      if (this.hover >= 0) {
        const i = this.hover, other = new Set(this.ds.views[1 - v].nbrs[i]);
        ctx.globalAlpha = a;
        for (const j of nb[i]) {
          // shared neighbors solid, private ones dashed
          ctx.setLineDash(other.has(j) ? [] : [3, 3]);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(this.sx[v][i], this.sy[v][i]);
          ctx.lineTo(this.sx[v][j], this.sy[v][j]);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    drawTwoNN(v, a) {
      const ctx = this.ctx, nb = this.ds.views[v].nbrs, n = this.n, sx = this.sx[v], sy = this.sy[v];
      const pass = (base, k, dash, only) => {
        ctx.globalAlpha = a * base;
        ctx.setLineDash(dash);
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          if (only >= 0 && i !== only) continue;
          ctx.moveTo(sx[i], sy[i]);
          ctx.lineTo(sx[nb[i][k]], sy[nb[i][k]]);
        }
        ctx.stroke();
      };
      ctx.lineWidth = this.hair();
      const base = this.hover < 0 ? (n > 150 ? 0.55 : 0.8) : 0.25;
      pass(base, 0, [], -1);          // first neighbour: solid
      pass(base, 1, [2, 3], -1);      // second neighbour: dashed
      if (this.hover >= 0) {           // the hovered point, at full strength
        ctx.lineWidth = 1.4;
        pass(1, 0, [], this.hover);
        pass(1, 1, [3, 3], this.hover);
      }
      ctx.setLineDash([]);
    }

    // first index whose distance is > x (E.d is sorted)
    upper(E, x) {
      let lo = 0, hi = E.d.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (E.d[mid] <= x) lo = mid + 1; else hi = mid; }
      return lo;
    }

    // which edges to draw for this ε: the (≤ ripsCap) lowest-rank ones, split into
    // "old" and "just born". Cached, so turning the cloud doesn't rescan 100k edges.
    ripsSelection(v, eps) {
      const c = (this.ripsSel = this.ripsSel || [])[v];
      if (c && c.eps === eps && c.E === this.edges[v]) return c;
      const E = this.edges[v], fresh = 0.035;
      const count = this.upper(E, eps), old = this.upper(E, eps - fresh);
      const keep = count ? Math.min(1, this.ripsCap / count) : 1;
      const o = [], f = [];
      for (let k = 0; k < count; k++) if (E.r[k] < keep) (k < old ? o : f).push(k);
      return (this.ripsSel[v] = { eps, E, count, keep, old: Int32Array.from(o), fresh: Int32Array.from(f) });
    }

    drawRips(v, a) {
      const ctx = this.ctx, E = this.edges[v];
      const sx = this.sx[v], sy = this.sy[v];
      const S = this.ripsSelection(v, this.P.eps);
      if (!S.count) return;
      if (this.activeFeature(v)) a *= 0.3;   // the feature on top reads first
      const dense = this.n > 150;
      const thin = Math.max(0.05, Math.min(0.38, (3.5 * this.n) / S.count));
      // a sample stands in for the rest, but only partly: past a point, more lines must not read as more ink
      ctx.lineWidth = this.hair();
      ctx.globalAlpha = a * Math.min(dense ? 0.26 : 0.55, 1.4 * thin / Math.sqrt(S.keep));
      ctx.beginPath();
      for (const k of S.old) { ctx.moveTo(sx[E.i[k]], sy[E.i[k]]); ctx.lineTo(sx[E.j[k]], sy[E.j[k]]); }
      ctx.stroke();
      // just-born edges stand out by weight while they are few, by ink when they are many
      const many = S.fresh.length > 250;
      ctx.lineWidth = many ? this.hair() : 1.4;
      ctx.globalAlpha = a * (many ? 0.75 : dense ? 0.35 : 0.95);
      ctx.beginPath();
      for (const k of S.fresh) { ctx.moveTo(sx[E.i[k]], sy[E.i[k]]); ctx.lineTo(sx[E.j[k]], sy[E.j[k]]); }
      ctx.stroke();
    }

    getMatImgs() {
      if (this.matImgs) return this.matImgs;
      const n = this.n, ord = this.ds.order;
      const ink = this.inkRGB();
      this.matImgs = this.ds.views.map((V, v) => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = n;
        const g = cv.getContext('2d'), im = g.createImageData(n, n);
        const cond = (i, j) => {
          if (i === j) return 0;
          if (i > j) [i, j] = [j, i];
          return this.pct[v][n * i - (i * (i + 1)) / 2 + (j - i - 1)];
        };
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
          const d = cond(ord[r], ord[c]), o = (r * n + c) * 4;
          im.data[o] = ink[0]; im.data[o + 1] = ink[1]; im.data[o + 2] = ink[2];
          im.data[o + 3] = Math.round(255 * Math.pow(1 - d, 2.2));
        }
        g.putImageData(im, 0, 0);
        return cv;
      });
      return this.matImgs;
    }

    inkRGB() {
      const probe = document.createElement('canvas').getContext('2d');
      probe.fillStyle = this.ink;
      probe.fillRect(0, 0, 1, 1);
      return probe.getImageData(0, 0, 1, 1).data;
    }

    drawMatrices(L, a) {
      const ctx = this.ctx, imgs = this.getMatImgs();
      // one cell per item pair: hard-edged when enlarged, smoothed only when squeezed
      ctx.imageSmoothingEnabled = this.n > this.matRect(L, 0).s * this.dpr;
      for (let v = 0; v < 2; v++) {
        if ((v === 0 ? this.P.showA : this.P.showB) < 0.05) continue;
        const M = this.matRect(L, v);
        ctx.globalAlpha = a;
        ctx.drawImage(imgs[v], M.x, M.y, M.s, M.s);
        ctx.globalAlpha = a * 0.4;
        ctx.lineWidth = 1;
        ctx.strokeRect(M.x - 0.5, M.y - 0.5, M.s + 1, M.s + 1);
        ctx.globalAlpha = a * 0.7;
        ctx.font = '400 14px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        const name = `${v ? 'B' : 'A'} · ${this.ds.views[v].name.toUpperCase()}`, full = `${name} · distance matrix`;
        ctx.fillText(ctx.measureText(full).width < M.s * 1.1 ? full : name, M.x + M.s / 2, M.y - 16);
        ctx.textAlign = 'left';
        if (this.cellHover) {
          // the same pair in both matrices (same order), and its row and column
          const { r, c } = this.cellHover, u = M.s / this.n, cs = Math.max(u, 5);
          ctx.globalAlpha = a * 0.25;
          ctx.fillRect(M.x, M.y + (r + 0.5) * u - 0.5, M.s, 1);
          ctx.fillRect(M.x + (c + 0.5) * u - 0.5, M.y, 1, M.s);
          ctx.globalAlpha = a;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(M.x + (c + 0.5) * u - cs / 2, M.y + (r + 0.5) * u - cs / 2, cs, cs);
        }
      }
    }

    axes(F, xl, yl, a) {
      const ctx = this.ctx;
      ctx.globalAlpha = a * 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const ax = Math.round(F.x) + 0.5, ay = Math.round(F.y + F.h) + 0.5;
      ctx.moveTo(ax, F.y);
      ctx.lineTo(ax, ay);
      ctx.lineTo(F.x + F.w, ay);
      ctx.stroke();
      ctx.globalAlpha = a * 0.9;
      ctx.font = '400 13.5px "IBM Plex Mono", monospace';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'right';
      ctx.fillText(xl, F.x + F.w, F.y + F.h + 8);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(yl, F.x + 4, F.y - 2);
      ctx.textBaseline = 'alphabetic';
    }

    // centered square-ish sub-box of the figure band
    figBox(F, aspect) {
      const h = Math.max(0, F.h - 34), w = Math.max(0, Math.min(F.w * 0.9, h * aspect));
      return { x: F.x + (F.w - w) / 2, y: F.y + 12, w, h };
    }

    drawScatter(F, a) {
      const B = this.figBox(F, 1.6), ctx = this.ctx;
      this.axes(B, `distance rank in ${this.ds.views[0].name}`, `distance rank in ${this.ds.views[1].name}`, a);
      ctx.globalAlpha = a * (this.pairs.length > 1500 ? 0.35 : 0.7);
      ctx.beginPath();
      for (const [x, y] of this.pairs) ctx.rect(B.x + x * B.w - 1.25, B.y + (1 - y) * B.h - 1.25, 2.5, 2.5);
      ctx.fill();
      if (this.cellHover) {
        // the hovered pair in the scatter
        const [x, y] = this.cellHover.pct;
        ctx.globalAlpha = a;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(B.x + x * B.w, B.y + (1 - y) * B.h, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    drawBarcodes(F, a) {
      const P = this.P;
      const two = P.split > 0.5 && P.showB > 0.5;
      const views = two ? [0, 1] : [this.focus];
      const L = this.L || this.layout();
      views.forEach(v => {
        const w = two ? Math.min(F.w / 2 - 30, L.R0 * 2.1) : Math.min(F.w * 0.8, 640);
        const cx = two ? L.cx0[v] : F.x + F.w / 2;
        this.drawBarcode(v, { x: cx - w / 2, y: F.y + 10, w, h: F.h - 30 }, a);
      });
    }

    drawBarcode(v, B, a) {
      const ctx = this.ctx, eps = this.P.eps, bars = this.ds.views[v].bars;
      const { h0, h1, h2 } = this.barOrder[v];
      const X = t => B.x + Math.min(t, 1) * B.w;
      const gap = 14;
      // H₀ gets half the height; loops and (if computed) voids share the rest
      const parts = h2.length ? [0.5, 0.3, 0.2] : h1.length ? [0.55, 0.45, 0] : [1, 0, 0];
      const avail = B.h - gap * (parts.filter(x => x > 0).length - 1);
      const act = this.activeFeature(v), hov = this.barHover && this.barHover.v === v ? this.barHover.k : -1;
      const selK = this.sel && this.sel.v === v ? this.sel.k : -1;
      const MIN = 4;   // thinnest row that can still be pointed at; more rows scroll
      const rows = (list, dim, y0, H, label) => {
        if (H <= 4) return;
        const step = Math.max(MIN, H / Math.max(list.length, 1));
        const fit = Math.max(1, Math.floor(H / step + 1e-6));
        const maxScroll = Math.max(0, list.length - fit);
        const key = v + ':' + dim;
        const top = Math.round(Math.max(0, Math.min(maxScroll, this.barScroll[key] || 0)));
        this.barScroll[key] = Math.max(0, Math.min(maxScroll, this.barScroll[key] || 0));
        const lw = Math.max(1, Math.min(3, step * 0.6));
        ctx.save();
        ctx.beginPath();
        ctx.rect(B.x - 2, y0 - 1, B.w + 4, H + 2);
        ctx.clip();
        for (let r = 0; r < fit && top + r < list.length; r++) {
          const k = list[top + r], b = bars[k];
          const y = Math.round(y0 + (r + 0.5) * step) + (lw % 2 ? 0.5 : 0), d = b[2] === null ? 1.02 : b[2];
          const alive = b[1] <= eps && d > eps, born = b[1] <= eps;
          const lit = k === hov || k === selK;
          ctx.lineWidth = lit ? Math.max(lw + 1.5, 3) : lw;
          ctx.globalAlpha = a * (lit ? 1 : (act ? 0.5 : 1) * (alive ? 1 : born ? 0.45 : 0.22));
          ctx.beginPath();
          ctx.moveTo(X(b[1]), y);
          ctx.lineTo(X(born ? Math.min(d, Math.max(eps, b[1])) : d), y);
          ctx.stroke();
          if (born && d > eps) {
            ctx.globalAlpha = a * (lit ? 0.4 : 0.12);
            ctx.beginPath(); ctx.moveTo(X(eps), y); ctx.lineTo(X(d), y); ctx.stroke();
          }
          if (lit) {
            // the whole lifetime, end to end, with its ends ticked
            ctx.globalAlpha = a;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(X(b[1]), y - 5); ctx.lineTo(X(b[1]), y + 5);
            if (b[2] !== null) { ctx.moveTo(X(d), y - 5); ctx.lineTo(X(d), y + 5); }
            ctx.stroke();
          }
          this.barHits.push({ v, k, x0: B.x - 34, x1: B.x + B.w + 6, y, h: step });
        }
        ctx.restore();
        ctx.globalAlpha = a * 0.7;
        ctx.font = '500 15px "IBM Plex Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillText(label, B.x - 10, y0 + 13);
        ctx.font = '400 11.5px "IBM Plex Mono", monospace';
        ctx.globalAlpha = a * 0.5;
        ctx.fillText(String(list.length), B.x - 10, y0 + 29);
        ctx.textAlign = 'left';
        if (maxScroll > 0) {
          // a thin scrollbar: where this window sits among all the bars
          const tx = B.x + B.w + 8, th = Math.max(14, H * fit / list.length), ty = y0 + (H - th) * (top / maxScroll);
          ctx.globalAlpha = a * 0.15;
          ctx.fillRect(tx, y0, 2, H);
          ctx.globalAlpha = a * 0.6;
          ctx.fillRect(tx - 0.5, ty, 3, th);
        }
        this.barSections.push({ v, dim, key, x: B.x - 40, y: y0, w: B.w + 56, h: H, step, maxScroll });
      };
      rows(h0, 0, B.y, avail * parts[0], 'H₀');
      if (h1.length) rows(h1, 1, B.y + avail * parts[0] + gap, avail * parts[1], 'H₁');
      if (h2.length) rows(h2, 2, B.y + avail * (parts[0] + parts[1]) + 2 * gap, avail * parts[2], 'H₂');
      // the ε line
      ctx.globalAlpha = a * 0.8;
      ctx.lineWidth = 1;
      const ex = Math.round(X(eps)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(ex, B.y - 4);
      ctx.lineTo(ex, B.y + B.h + 2);
      ctx.stroke();
      ctx.globalAlpha = a * 0.9;
      ctx.font = '400 13.5px "IBM Plex Mono", monospace';
      const et = `ε ${eps.toFixed(2)}`;
      ctx.fillText(et, Math.min(X(eps) + 5, B.x + B.w - ctx.measureText(et).width), B.y + B.h + 18);
    }

    drawIdPlot(F, a) {
      const ctx = this.ctx, B = this.figBox(F, 1.7);
      const series = this.P.showA > 0.5 && this.P.showB > 0.5 ? [0, 1] : [this.focus];
      let xmax = 0.1;
      for (const v of series) for (const m of this.ds.views[v].mu) xmax = Math.max(xmax, Math.log(m));
      xmax = Math.min(xmax, 2.5);
      const ymax = 5;
      this.axes(B, 'log(2nd ÷ 1st neighbor distance)', 'how rare that ratio is', a);
      for (const v of series) {
        const mu = this.ds.views[v].mu, N = mu.length, d = this.ds.views[v].twoNN;
        ctx.globalAlpha = a * 0.6;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let k = 0; k < N; k++) {
          const x = Math.log(mu[k]), y = -Math.log(1 - (k + 1) / (N + 1));
          const px = B.x + (x / xmax) * B.w, py = B.y + B.h - (y / ymax) * B.h;
          if (px > B.x + B.w || py < B.y) continue;
          this.glyphPath(px, py, 3.2, v === 0 ? 'dot' : 'ring');
        }
        if (v === 0) ctx.fill(); else ctx.stroke();
        // the hovered item's own ratio r2/r1, found among the sorted ones
        if (this.hover >= 0) {
          const i = this.hover, nb = this.ds.views[v].nbrs[i];
          const r1 = this.cond(v, i, nb[0]), r2 = this.cond(v, i, nb[1]);
          if (r1 > 0) {
            const m = r2 / r1;
            let lo = 0, hi = N - 1;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (mu[mid] < m) lo = mid + 1; else hi = mid; }
            if (lo > 0 && Math.abs(mu[lo - 1] - m) < Math.abs(mu[lo] - m)) lo--;
            const px = B.x + (Math.min(Math.log(mu[lo]), xmax) / xmax) * B.w;
            const py = B.y + B.h - (Math.min(-Math.log(1 - (lo + 1) / (N + 1)), ymax) / ymax) * B.h;
            ctx.globalAlpha = a;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(px, py, 7, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        if (d === null || d === undefined) continue;   // too many identical points to say
        // the line through the origin with the maximum-likelihood slope
        const xe = Math.min(xmax, ymax / d);
        ctx.globalAlpha = a * 0.8;
        ctx.lineWidth = 1;
        ctx.setLineDash(v === 0 ? [] : [4, 3]);
        ctx.beginPath();
        ctx.moveTo(B.x, B.y + B.h);
        ctx.lineTo(B.x + (xe / xmax) * B.w, B.y + B.h - ((d * xe) / ymax) * B.h);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '400 14px "IBM Plex Mono", monospace';
        // label at the end of the line, kept inside the plot
        const label = `${this.ds.views[v].name} ≈ ${d.toFixed(1)}-D`;
        const lx = B.x + (xe / xmax) * B.w, ly = B.y + B.h - ((d * xe) / ymax) * B.h + (v ? 16 : 0);
        const fits = lx + 6 + ctx.measureText(label).width < this.W - 12;
        ctx.textAlign = fits ? 'left' : 'right';
        ctx.fillText(label, fits ? lx + 6 : lx - 6, fits ? ly : ly + 14);
        ctx.textAlign = 'left';
      }
    }

    drawHeat(F, a) {
      const lay = this.ds.layers;
      if (!lay) return;
      const ctx = this.ctx, m = lay.names.length;
      const s = Math.min(F.h - 30, F.w * 0.5), x0 = F.x + (F.w - s) / 2, y0 = F.y + 8, c = s / m;
      let lo = 1;
      for (const row of lay.cka) for (const v of row) lo = Math.min(lo, v);
      for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
        ctx.globalAlpha = a * (0.04 + 0.96 * Math.pow((lay.cka[i][j] - lo) / (1 - lo + 1e-9), 1.6));
        ctx.fillRect(x0 + j * c, y0 + i * c, c + 0.3, c + 0.3);
      }
      ctx.globalAlpha = a * 0.9;
      ctx.font = '400 13.5px "IBM Plex Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${lay.names[0]}`, x0 - 8, y0 + c + 4);
      ctx.fillText(`${lay.names[m - 1]}`, x0 - 8, y0 + s);
      ctx.textAlign = 'left';
      ctx.fillText(`layer × layer CKA · faintest ${lo.toFixed(2)}, strongest 1`, x0, y0 + s + 20);
    }
  }

  window.Scene = Scene;
})();
