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
      if (document.fonts) document.fonts.ready.then(() => this.resize());
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        this.readColors();
        this.matImgs = null;
        this.tipURLs = [];
        this.dirty = true;
        this.loadSprites();
      });
      this.last = performance.now();
      requestAnimationFrame(t => this.frame(t));
    }

    // ---------- setup ----------

    readColors() {
      const s = getComputedStyle(document.documentElement);
      this.paper = s.getPropertyValue('--paper').trim();
      this.ink = s.getPropertyValue('--ink').trim();
    }

    // Resolution: full device sharpness when still. While things move, if frames
    // get slow (Retina screens paint 4× the pixels), drop to a lower resolution,
    // remember what worked, and snap back to full sharpness when motion stops.
    setRenderScale(dpr) {
      if (dpr === this.renderDpr) return;
      this.renderDpr = dpr;
      this.resize();
    }

    resize() {
      this.maxDpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!this.renderDpr || this.renderDpr > this.maxDpr) this.renderDpr = this.maxDpr;
      const dpr = this.renderDpr;
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
      const hb = top ? top.getBoundingClientRect().bottom : 70;
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
        const m = P3.length, nn = new Float64Array(m).fill(Infinity);
        for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
          const d = Math.hypot(P3[i][0] - P3[j][0], P3[i][1] - P3[j][1], P3[i][2] - P3[j][2]);
          if (d > 1e-9) { if (d < nn[i]) nn[i] = d; if (d < nn[j]) nn[j] = d; }
        }
        const f = Array.from(nn).filter(isFinite).sort((a, b) => a - b);
        return f.length ? f[f.length >> 1] : 1;
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
      this.barOrder = ds.views.map(v => ({
        h0: v.bars.filter(b => b[0] === 0).sort((p, q) => (q[2] ?? 9) - (p[2] ?? 9)),
        h1: v.bars.filter(b => b[0] === 1).sort((p, q) => p[1] - q[1]),
        h2: v.bars.filter(b => b[0] === 2).sort((p, q) => p[1] - q[1]),
      }));
      this.rank = new Int32Array(n);
      ds.order.forEach((item, r) => (this.rank[item] = r));
      // scatter sample for RSA
      const step = Math.max(1, Math.floor(m / 3500));
      this.pairs = [];
      for (let k = 0; k < m; k += step) this.pairs.push([ds.views[0].dist[k] / 1000, ds.views[1].dist[k] / 1000]);
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
        if (this.drag && !this.drag.pan && this.drag.vel) this.spinSpeed = Math.max(-3, Math.min(3, this.drag.vel));
        this.drag = null;
      };
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
      c.addEventListener('pointerleave', () => { this.hover = -1; this.dirty = true; this.onHover && this.onHover(null); });
      c.addEventListener('dblclick', () => this.resetView());

      // wheel and trackpad pinch (which arrives as ctrl+wheel) zoom the cloud only
      c.addEventListener('wheel', e => {
        e.preventDefault();
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

    // zoom by factor f, keeping the cloud point under (px, py) where it is
    zoomAt(f, px, py) {
      const L = this.layout();
      const v = Math.abs(px - L.cx0[0]) <= Math.abs(px - L.cx0[1]) ? 0 : 1;
      const cx = L.cx0[v], cy = L.cy0;
      const z = Math.max(0.5, Math.min(14, this.zoom * f)), k = z / this.zoom;
      this.pan.x = px - cx - k * (px - cx - this.pan.x);
      this.pan.y = py - cy - k * (py - cy - this.pan.y);
      this.zoom = z;
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
      const r = (side ? this.figRatio.side : this.figRatio.below) * P.fig;
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
        clip: side
          ? { x: cloud.x - 30, y: y - 6, w: cloud.w + 26, h: h + 6 }
          : { x: x - 30, y: y - 6, w: w + 60, h: cloud.h + 6 },
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
        this.pan.x += (g.x - this.pan.x) * k;
        this.pan.y += (g.y - this.pan.y) * k;
        if (Math.abs(this.zoom - 1) < 1e-3 && Math.hypot(this.pan.x, this.pan.y) < 0.5) {
          this.zoom = 1; this.pan = { x: 0, y: 0 }; this.viewGoal = null;
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
      this.adaptResolution(moving, dt, now);
      if (moving || this.dirty) this.draw();
      this.dirty = false;
      requestAnimationFrame(t => this.frame(t));
    }

    invalidate() { this.dirty = true; }

    adaptResolution(moving, dt, now) {
      const full = this.maxDpr;
      if (moving) {
        this.stillSince = 0;
        // motion resumed: start at the resolution that kept up last time
        if (this.renderDpr === full && this.motionDpr && this.motionDpr < full) this.setRenderScale(this.motionDpr);
        this.frameEma = this.frameEma ? 0.85 * this.frameEma + 0.15 * dt * 1000 : dt * 1000;
        this.slowFrames = this.frameEma > 24 ? (this.slowFrames || 0) + 1 : 0;
        if (this.slowFrames > 12 && this.renderDpr > 1) {
          this.setRenderScale(Math.max(1, Math.round((this.renderDpr - 0.5) * 2) / 2));
          this.motionDpr = this.renderDpr;
          this.slowFrames = 0;
          this.frameEma = 0;
        }
      } else if (this.renderDpr < full) {
        // settled for a moment: one crisp redraw at full resolution
        if (!this.stillSince) this.stillSince = now;
        else if (now - this.stillSince > 180) { this.setRenderScale(full); this.dirty = true; }
      }
    }

    draw() {
      const ctx = this.ctx, P = this.P;
      ctx.fillStyle = this.paper;
      ctx.fillRect(0, 0, this.W, this.H);
      if (!this.ds) return;
      ctx.strokeStyle = this.ink;
      ctx.fillStyle = this.ink;
      const L = this.layout();
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
      const labelA = P.labels * (1 - clamp01(P.mat * 2));
      if (labelA > 0.01) for (let v = 0; v < 2; v++) if (vis[v] > 0.01) this.drawLabels(v, labelA * vis[v]);
      ctx.restore();
      if (P.split > 0.5 && P.mat < 0.5) this.drawViewNames(L, (P.split - 0.5) * 2);

      this.curR0 = L.R0;
      if (P.fig > 0.5) this.drawDivider(L.divider, (P.fig - 0.5) * 2);
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
      const D = this.layout().divider;
      if (!D) return false;
      return D.w ? Math.abs(py - D.y) < 8 && px >= D.x && px <= D.x + D.w
                 : Math.abs(px - D.x) < 8 && py >= D.y && py <= D.y + D.h;
    }

    depthAlpha(v, i) {
      return 0.8 + 0.2 * clamp01((this.sz[v][i] + 1) / 2);
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
      // far points first, so near thumbnails sit on top
      let order = null;
      if (pics > 0) {
        if (!this.orderBuf || this.orderBuf.length !== n) this.orderBuf = new Uint16Array(n);
        order = this.orderBuf;
        for (let i = 0; i < n; i++) order[i] = i;
        const z = this.sz[v];
        order.sort((p, q) => z[p] - z[q] || p - q);   // ties broken by index: no swapping
      }
      for (let k = 0; k < n; k++) {
        const i = order ? order[k] : k;
        let al = this.depthAlpha(v, i);
        if (P.knn > 0) al = lerp(al, 0.25 + 0.75 * ov[i], P.knn);
        if (twin && i !== this.hover && P.knn > 0.5) al *= 0.6;
        if (pics < 1) {
          ctx.globalAlpha = a * al * (1 - pics);
          this.glyph(this.sx[v][i], this.sy[v][i], r, g ? GLYPHS[g[i] % GLYPHS.length] : 'dot');
        }
        if (pics > 0) {
          const im = this.tinted[i], asp = im.height / im.width;
          const w = asp > 1 ? ps / asp : ps, h = asp > 1 ? ps : ps * asp;
          ctx.globalAlpha = a * pics * (0.55 + 0.45 * al);
          ctx.drawImage(im, this.sx[v][i] - w / 2, this.sy[v][i] - h / 2, w, h);
        }
      }
      if (this.hover >= 0) {
        const i = this.hover, x = this.sx[v][i], y = this.sy[v][i];
        ctx.globalAlpha = a;
        if (pics > 0) {
          // the hovered item, big enough to actually see
          const im = this.tinted[i], asp = im.height / im.width, Z = ps * 2.6;
          const w = asp > 1 ? Z / asp : Z, h = asp > 1 ? Z : Z * asp;
          ctx.fillStyle = this.paper;
          ctx.fillRect(x - w / 2 - 6, y - h / 2 - 6, w + 12, h + 12);
          ctx.fillStyle = this.ink;
          ctx.lineWidth = 1.2;
          ctx.strokeRect(x - w / 2 - 6, y - h / 2 - 6, w + 12, h + 12);
          ctx.drawImage(im, x - w / 2, y - h / 2, w, h);
        } else {
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, r + 7, 0, Math.PI * 2);
          ctx.stroke();
        }
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
      for (let i = 0; i < this.n; i++) {
        const key = Math.round(this.sx[v][i] / 3) + ',' + Math.round(this.sy[v][i] / 3);
        if (!spots.has(key)) spots.set(key, []);
        spots.get(key).push(i);
      }
      // biggest piles first; a label that would overlap one already placed waits
      // until zooming makes room
      const placed = [];
      const was = this.shownLabels && this.shownLabels[v] || new Set();
      const groups = [...spots.values()].sort((p, q) =>
        (was.has(q[0]) - was.has(p[0])) || (q.length - p.length) || (p[0] - q[0]));
      const now = new Set();
      const C = this.lastClip;
      for (const items of groups) {
        const i = items[0];
        if (C && (this.sx[v][i] < C.x || this.sx[v][i] > C.x + C.w || this.sy[v][i] < C.y || this.sy[v][i] > C.y + C.h)) continue;
        const text = items.slice(0, 2).map(j => L[j]).join(', ') + (items.length > 2 ? ` +${items.length - 2}` : '');
        const x = this.sx[v][i] + 10, y = this.sy[v][i] - 10, w = ctx.measureText(text).width;
        const box = [x - 2, y - 9, x + w + 2, y + 9];
        if (placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        placed.push(box);
        now.add(i);
        ctx.globalAlpha = a * this.depthAlpha(v, i);
        ctx.fillText(text, x, y);
      }
      (this.shownLabels = this.shownLabels || [])[v] = now;
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
        const full = `${v ? 'B' : 'A'}  ·  ${V.name.toUpperCase()}  ·  ${V.dims}-D`;
        ctx.fillText(ctx.measureText(full).width < L.R0 * 2.2 ? full : V.name.toUpperCase(), L.cx0[v], L.cy0 - L.R0 - 26);
      }
      ctx.textAlign = 'left';
    }

    drawLinks(a, resid) {
      const ctx = this.ctx, n = this.n;
      ctx.lineWidth = resid ? 1.3 : 0.8;
      ctx.globalAlpha = a * (resid ? 0.75 : (n > 150 ? 0.14 : 0.32));
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

    drawKnn(v, a) {
      const ctx = this.ctx, nb = this.ds.views[v].nbrs, n = this.n;
      ctx.lineWidth = 0.9;
      ctx.globalAlpha = a * (n > 150 ? 0.26 : 0.45);
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
      ctx.lineWidth = 1.1;
      const base = this.hover < 0 ? (n > 150 ? 0.4 : 0.65) : 0.2;
      pass(base, 0, [], -1);          // first neighbour: solid
      pass(base, 1, [2, 3], -1);      // second neighbour: dashed
      if (this.hover >= 0) {           // the hovered point, at full strength
        pass(1, 0, [], this.hover);
        pass(1, 1, [2, 3], this.hover);
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
      const dense = this.n > 150;
      const thin = Math.max(0.05, Math.min(0.38, (3.5 * this.n) / S.count));
      // a sample stands in for the rest, but only partly: past a point, more lines must not read as more ink
      ctx.lineWidth = 0.8;
      ctx.globalAlpha = a * Math.min(dense ? 0.18 : 0.38, thin / Math.sqrt(S.keep));
      ctx.beginPath();
      for (const k of S.old) { ctx.moveTo(sx[E.i[k]], sy[E.i[k]]); ctx.lineTo(sx[E.j[k]], sy[E.j[k]]); }
      ctx.stroke();
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = a * (dense ? 0.35 : 0.95);
      ctx.beginPath();
      for (const k of S.fresh) { ctx.moveTo(sx[E.i[k]], sy[E.i[k]]); ctx.lineTo(sx[E.j[k]], sy[E.j[k]]); }
      ctx.stroke();
    }

    getMatImgs() {
      if (this.matImgs) return this.matImgs;
      const n = this.n, ord = this.ds.order;
      const ink = this.inkRGB();
      this.matImgs = this.ds.views.map(V => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = n;
        const g = cv.getContext('2d'), im = g.createImageData(n, n);
        const cond = (i, j) => {
          if (i === j) return 0;
          if (i > j) [i, j] = [j, i];
          return V.dist[n * i - (i * (i + 1)) / 2 + (j - i - 1)] / 1000;
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
      ctx.imageSmoothingEnabled = this.n > 200;
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
      }
    }

    axes(F, xl, yl, a) {
      const ctx = this.ctx;
      ctx.globalAlpha = a * 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(F.x, F.y);
      ctx.lineTo(F.x, F.y + F.h);
      ctx.lineTo(F.x + F.w, F.y + F.h);
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
      this.axes(B, `distance in ${this.ds.views[0].name}`, `distance in ${this.ds.views[1].name}`, a);
      ctx.globalAlpha = a * (this.pairs.length > 1500 ? 0.35 : 0.7);
      for (const [x, y] of this.pairs) ctx.fillRect(B.x + x * B.w - 1.5, B.y + (1 - y) * B.h - 1.5, 3, 3);
    }

    drawBarcodes(F, a) {
      const P = this.P;
      const two = P.split > 0.5 && P.showB > 0.5;
      const views = two ? [0, 1] : [this.focus];
      const L = this.layout();
      views.forEach(v => {
        const w = two ? Math.min(F.w / 2 - 30, L.R0 * 2.1) : Math.min(F.w * 0.8, 640);
        const cx = two ? L.cx0[v] : F.x + F.w / 2;
        this.drawBarcode(v, { x: cx - w / 2, y: F.y + 10, w, h: F.h - 30 }, a);
      });
    }

    drawBarcode(v, B, a) {
      const ctx = this.ctx, eps = this.P.eps;
      const { h0, h1, h2 } = this.barOrder[v];
      const X = t => B.x + Math.min(t, 1) * B.w;
      const gap = 12;
      // H₀ gets half the height; loops and (if computed) voids share the rest
      const parts = h2.length ? [0.5, 0.3, 0.2] : h1.length ? [0.55, 0.45, 0] : [1, 0, 0];
      const avail = B.h - gap * (parts.filter(x => x > 0).length - 1);
      const h0H = avail * parts[0], h1H = avail * parts[1], h2H = avail * parts[2];
      const rows = (list, y0, H, label) => {
        const step = H / Math.max(list.length, 1), lw = Math.max(0.5, Math.min(2.4, step * 0.6));
        ctx.lineWidth = lw;
        list.forEach((b, k) => {
          const y = y0 + (k + 0.5) * step, d = b[2] === null ? 1.02 : b[2];
          const alive = b[1] <= eps && d > eps, born = b[1] <= eps;
          ctx.globalAlpha = a * (alive ? 1 : born ? 0.45 : 0.22);
          ctx.beginPath();
          ctx.moveTo(X(b[1]), y);
          ctx.lineTo(X(born ? Math.min(d, Math.max(eps, b[1])) : d), y);
          ctx.stroke();
          if (born && d > eps) {
            ctx.globalAlpha = a * 0.12;
            ctx.beginPath(); ctx.moveTo(X(eps), y); ctx.lineTo(X(d), y); ctx.stroke();
          }
        });
        ctx.globalAlpha = a * 0.7;
        ctx.font = '500 15px "IBM Plex Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillText(label, B.x - 10, y0 + 13);
        ctx.textAlign = 'left';
      };
      rows(h0, B.y, h0H, 'H₀');
      if (h1.length) rows(h1, B.y + h0H + gap, h1H, 'H₁');
      if (h2.length) rows(h2, B.y + h0H + gap + h1H + gap, h2H, 'H₂');
      // the ε line
      ctx.globalAlpha = a * 0.8;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(X(eps), B.y - 4);
      ctx.lineTo(X(eps), B.y + B.h + 2);
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
        for (let k = 0; k < N; k++) {
          const x = Math.log(mu[k]), y = -Math.log(1 - (k + 1) / (N + 1));
          ctx.globalAlpha = a * 0.6;
          const px = B.x + (x / xmax) * B.w, py = B.y + B.h - (y / ymax) * B.h;
          if (px > B.x + B.w || py < B.y) continue;
          this.glyph(px, py, 3.2, v === 0 ? 'dot' : 'ring');
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
