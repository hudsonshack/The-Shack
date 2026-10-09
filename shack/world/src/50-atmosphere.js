/* The Shack v2: atmosphere. Island lighting, night darkness with light holes,
 * per-island weather, season particles and cloud wisps drifting through space.
 *
 * Owns (see WORLD_SPEC.md):
 *   dyn 500 (no island)   cloud wisps drifting through the space between the
 *                         islands; they slip behind every island silhouette
 *   dyn 500 {island}      per-island weather under the darkness, confined to
 *                         that island's silhouette with soft dithered edges:
 *                           idle      light drifting mist
 *                           warn      cool overcast shade (the rain cloud itself
 *                                     is drawn at 600, see below)
 *                           critical  darker scrolling storm overcast
 *                         plus season particles over the island tops (autumn
 *                         leaves, winter snow, spring petals) that settle on the
 *                         ground or tumble off the edge into space
 *   dyn 600 (no island)   a faint cool night tint over everything, so vehicles
 *                         and spray out in space dim a little with the islands
 *   dyn 600 {island}      DARKNESS driven by S.time.light, built from the
 *                         island's own silhouette (S.islandLayers alpha): deep
 *                         blue at night, warm dusk, pink dawn, a pale moonlit
 *                         rim on the top-left edges, dithered light holes for
 *                         every S.lights entry. Then, over the dark: the hovering
 *                         rain cloud (warn) or storm cloud (critical) with rain
 *                         that keeps falling past the edge into space, lightning
 *                         flashes on that island only, summer-night fireflies.
 *                         Clouds hang off every villager work spot and thin to
 *                         see-through while anyone walks under one.
 *
 * Space keeps its own day and night (the space module). Nothing here darkens
 * space except the faint night tint.
 *
 * Cost: per island, the darkness is two cached box-sized canvases (multiply
 * tint and blue veil) rebuilt only when the sky level, a light's flicker step,
 * a light's on() state or a cross-island bob offset changes. Mist and overcast
 * are cached per island and repainted only when their drift moves a whole pixel.
 * Cloud sprites are built once and re-tinted only when the sky changes.
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S || !S.islands) return;

  const W = S.W, H = S.H, TILE = S.TILE;
  const CO = S.color;
  const RM = !!S.reducedMotion;
  const DBG = S.debug || {};
  const PART = RM ? 0.35 : 1;         // particle count multiplier
  const SPD = RM ? 0.5 : 1;           // particle / drift speed multiplier

  /* ------------------------------------------------------------ helpers */
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (e0, e1, v) => { const x = clamp01((v - e0) / (e1 - e0)); return x * x * (3 - 2 * x); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
  const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bayer = (x, y) => (B4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
  /** Ordered-dither quantise v (0..1) to `levels` steps at pixel x,y. */
  const dq = (v, levels, x, y) => { const s = v * levels; let b = Math.floor(s); if (s - b > bayer(x, y)) b++; return (b > levels ? levels : b) / levels; };
  /** Like dq, but solid bands with only a narrow dithered seam between them (16-bit shading). */
  const band = (v, levels, x, y) => { const s = clamp01(v) * levels; let b = Math.floor(s); const f = s - b; const g = f < 0.38 ? 0 : f > 0.62 ? 1 : (f - 0.38) / 0.24; if (g > bayer(x, y)) b++; return (b > levels ? levels : b) / levels; };
  const RGBC = {};
  const rgb = (h) => RGBC[h] || (RGBC[h] = CO.hexToRgb(h));
  const rgba = (h, a) => { const c = rgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')'; };

  /** Value noise; optional periods make it tile (for scrolling textures). */
  function vnoise(x, y, seed, px, py) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const wx = (a) => (px ? ((a % px) + px) % px : a), wy = (a) => (py ? ((a % py) + py) % py : a);
    const x0 = wx(xi), x1 = wx(xi + 1), y0 = wy(yi), y1 = wy(yi + 1);
    const a = S.hash(x0, y0, seed), b = S.hash(x1, y0, seed), c = S.hash(x0, y1, seed), d = S.hash(x1, y1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /* Optional profiling: SHACK_DEBUG.atmoProfile = true collects ms per layer. */
  const prof = DBG.atmoProfile ? (DBG.atmoStats = { w500: 0, w600: 0, frames: 0, rebuilds: 0 }) : null;

  /* ================================================================ SKY
   * Keyframes by S.time.light (1 = day, 0 = night): [light, multiply tint,
   * veil colour, veil alpha]. The multiply darkens and tints; the veil lays a
   * thin deep-blue film over it so night reads blue, not black. Islands sit on
   * dark space, so night stays a little lighter than v1 to keep them readable.
   */
  const NIGHT = [0, '#6a76b8', '#101848', 0.22];
  const SKY = {
    dusk: [[1, '#ffffff', '#ff9a4a', 0], [0.8, '#ffe8c8', '#ff9a4a', 0.03], [0.55, '#f6bc9c', '#ff6a4a', 0.06],
           [0.32, '#b4949e', '#6a3a7a', 0.11], [0.12, '#6e79b0', '#1c2058', 0.19], NIGHT],
    dawn: [[1, '#ffffff', '#ffb2a8', 0], [0.8, '#ffece4', '#ffa8b0', 0.04], [0.55, '#f6c0ca', '#ff86b4', 0.07],
           [0.32, '#b49ed0', '#6a4aa8', 0.12], [0.12, '#6e79b0', '#1c2058', 0.19], NIGHT],
  };
  function skyNow() {
    const T = S.time;
    const L = clamp01(T.light == null ? 1 : T.light), h = T.hours == null ? 12 : T.hours;
    const dawn = h < 12;
    let mul, lift, la;
    if (L >= 1) {
      // Golden afternoon before dusk, soft peach morning after dawn.
      const g = dawn ? 1 - smooth(T.sunrise + 0.75, T.sunrise + 1.75, h) : smooth(T.sunset - 2.25, T.sunset - 0.75, h);
      mul = g > 0.01 ? CO.mix('#ffffff', dawn ? '#ffeede' : '#ffe6c0', g * 0.8) : '#ffffff';
      lift = '#000000'; la = 0;
    } else {
      const K = dawn ? SKY.dawn : SKY.dusk;
      let i = 0;
      while (i < K.length - 2 && L < K[i + 1][0]) i++;
      const a = K[i], b = K[i + 1];
      const f = clamp01((a[0] - L) / (a[0] - b[0]));
      mul = CO.mix(a[1], b[1], f); lift = CO.mix(a[2], b[2], f); la = lerp(a[3], b[3], f);
    }
    const n = 1 - L;
    // nightOnly lamps come on through dusk and are full by deep twilight.
    const lampK = smooth(0.15, 0.85, n);
    // Moonlit rim on the top-left edges, strongest in full night.
    const rimK = smooth(0.35, 1, n);
    return { L, n, mul, lift, la, lampK, rimK, key: mul + lift + la.toFixed(3) + rimK.toFixed(2) };
  }

  /* ========================================================= GEOMETRY
   * Built from S.islandLayers every time the static art is (re)drawn:
   *   solid   Uint8Array of the island silhouette (box-local)
   *   maskC   white silhouette (darkness and flash are cut to it)
   *   rimC    1-2 px band just inside the top-left-facing edge (moonlight)
   *   mistC0  dithered soft mask for weather on the top (soft inner edge,
   *           thinning out over the underside)
   *   topY1   native y of the top's south edge (underside starts below)
   */
  const G = {};
  let geomVersion = 0;
  function buildGeometry() {
    geomVersion++;
    const layers = S.islandLayers || [];
    for (const id of S.ISLANDS) {
      const L = layers.find((l) => l.id === id);
      const box = L ? { x: L.x, y: L.y, w: L.w, h: L.h } : S.islandBox(id);
      const r = S.islands[id];
      const top = { x0: r.x * TILE, y0: r.y * TILE, x1: (r.x + r.w) * TILE, y1: (r.y + r.h) * TILE };
      const bw = box.w, bh = box.h, n = bw * bh;
      let solid = new Uint8Array(n);
      const art = solid;   // what is really drawn there: darkness and the rim follow only this
      let count = 0;
      if (L) {
        const rc = mk(bw, bh), rx = rc.getContext('2d', { willReadFrequently: true });
        rx.drawImage(L.canvas, 0, 0);
        const d = rx.getImageData(0, 0, bw, bh).data;
        for (let k = 0; k < n; k++) if (d[k * 4 + 3] > 96) { solid[k] = 1; count++; }
      }
      if (count < 400) {
        // No island art loaded (an isolated preview): weather still needs a shape, so use a
        // plain rounded top plus a tapering underside. Darkness keeps following `art` (empty).
        solid = new Uint8Array(n);
        count = 0;
        const cx = (top.x0 + top.x1) / 2 - box.x, cy = (top.y0 + top.y1) / 2 - box.y;
        const rxh = (top.x1 - top.x0) / 2 - 8, ryh = (top.y1 - top.y0) / 2 - 6, under = r.depth * TILE;
        for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
          const dx = (i - cx) / rxh, dy = (j - cy) / ryh;
          let inside = dx * dx * 0.6 + dy * dy * 0.6 < 1 && Math.abs(dx) < 1 && Math.abs(dy) < 1;
          const uy = j + box.y - top.y1;
          if (!inside && uy >= -8 && uy < under) inside = Math.abs(dx) < 1 - uy / under;
          if (inside) { solid[j * bw + i] = 1; count++; }
        }
      }
      const at = (i, j) => (i < 0 || j < 0 || i >= bw || j >= bh ? 0 : solid[j * bw + i]);
      const atA = (i, j) => (i < 0 || j < 0 || i >= bw || j >= bh ? 0 : art[j * bw + i]);

      // Silhouette mask and the moonlit rim (from the real art only).
      const maskC = mk(bw, bh), mxc = maskC.getContext('2d'), mImg = mxc.createImageData(bw, bh), md = mImg.data;
      const rimC = mk(bw, bh), rxc = rimC.getContext('2d'), rImg = rxc.createImageData(bw, bh), rd = rImg.data;
      for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
        const k = j * bw + i;
        if (!art[k]) continue;
        md[k * 4] = md[k * 4 + 1] = md[k * 4 + 2] = md[k * 4 + 3] = 255;
        const edge1 = !atA(i - 1, j) || !atA(i, j - 1);         // the outline pixel itself
        if (edge1) continue;
        const ring2 = !atA(i - 2, j) || !atA(i, j - 2) || !atA(i - 1, j - 1) || !atA(i - 2, j - 1) || !atA(i - 1, j - 2);
        const ring3 = !ring2 && (!atA(i - 3, j) || !atA(i, j - 3) || !atA(i - 2, j - 2));
        const a = ring2 ? 255 : ring3 && ((i + j) & 1) ? 150 : 0;
        if (!a) continue;
        rd[k * 4] = rd[k * 4 + 1] = rd[k * 4 + 2] = 255; rd[k * 4 + 3] = a;
      }
      mxc.putImageData(mImg, 0, 0);
      rxc.putImageData(rImg, 0, 0);

      // Soft inner mask: blurred silhouette (separable box blur), faded over the underside.
      const R = 9, tmp = new Float32Array(n), soft = new Float32Array(n);
      for (let j = 0; j < bh; j++) {
        let s = 0;
        for (let i = -R; i <= R; i++) s += at(i, j);
        for (let i = 0; i < bw; i++) { tmp[j * bw + i] = s; s += at(i + R + 1, j) - at(i - R, j); }
      }
      const norm = 1 / ((2 * R + 1) * (2 * R + 1));
      const tv = (i, j) => (j < 0 || j >= bh ? 0 : tmp[j * bw + i]);
      for (let i = 0; i < bw; i++) {
        let s = 0;
        for (let j = -R; j <= R; j++) s += tv(i, j);
        for (let j = 0; j < bh; j++) { soft[j * bw + i] = s * norm; s += tv(i, j + R + 1) - tv(i, j - R); }
      }
      const topLocal = top.y1 - box.y;
      const mistC0 = mk(bw, bh), mc = mistC0.getContext('2d'), wImg = mc.createImageData(bw, bh), wd = wImg.data;
      const flashC = mk(bw, bh), fc = flashC.getContext('2d'), fImg = fc.createImageData(bw, bh), fd = fImg.data;
      const fl = rgb('#a9bcf0');
      for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
        const k = j * bw + i;
        if (!solid[k]) continue;
        const e = smooth(0.42, 0.95, soft[k]);
        const vf = 1 - 0.75 * smooth(topLocal - 6, topLocal + 40, j);   // thinner over the underside
        const m = e * vf;
        if (m > bayer(i + box.x, j + box.y)) wd[k * 4 + 3] = 255;
        const f = 0.35 + 0.65 * e;
        if (f > bayer(i + box.x, j + box.y)) { fd[k * 4] = fl[0]; fd[k * 4 + 1] = fl[1]; fd[k * 4 + 2] = fl[2]; fd[k * 4 + 3] = 255; }
      }
      mc.putImageData(wImg, 0, 0);
      fc.putImageData(fImg, 0, 0);

      const prev = G[id];
      G[id] = {
        id, box, top, topY1: top.y1, solid, soft, maskC, rimC, mistC0, flashC, noArt: solid !== art,
        // darkness caches
        mulC: (prev && prev.mulC && prev.mulC.width === bw && prev.mulC.height === bh) ? prev.mulC : mk(bw, bh),
        liftC: (prev && prev.liftC && prev.liftC.width === bw && prev.liftC.height === bh) ? prev.liftC : mk(bw, bh),
        darkSig: '', lightsHere: [], hasVeil: false,
      };
    }
  }
  S.on('static:ready', buildGeometry);
  const geo = (id) => { if (!G[id]) buildGeometry(); return G[id]; };

  /** True if world px (x, y) is on the walkable top (or a roof) of island g. */
  function onTop(g, x, y) {
    if (y > g.topY1 - 3) return false;
    const i = (x - g.box.x) | 0, j = (y - g.box.y) | 0;
    if (i < 0 || j < 0 || i >= g.box.w || j >= g.box.h) return false;
    return g.solid[j * g.box.w + i] === 1 && g.soft[j * g.box.w + i] > 0.55;
  }
  /** True if world px (x, y) is anywhere on island g's silhouette. */
  function onIsland(g, x, y) {
    const i = (x - g.box.x) | 0, j = (y - g.box.y) | 0;
    return i >= 0 && j >= 0 && i < g.box.w && j < g.box.h && g.solid[j * g.box.w + i] === 1;
  }

  /* ============================================================ LIGHTS
   * Stamps are dithered radial alpha masks. The dither is world-aligned (the
   * Bayer phase follows the stamp's top-left), so overlapping lights share one
   * pattern instead of fighting.
   */
  const stampCache = new Map();
  function stampMask(kind, r, ox, oy) {
    const key = kind + r + '|' + (ox & 3) + (oy & 3);
    let c = stampCache.get(key);
    if (c) return c;
    const s = 2 * r + 1;
    c = mk(s, s);
    const x = c.getContext('2d'), img = x.createImageData(s, s), d = img.data;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const dd = Math.hypot(i - r, j - r) / (r + 0.5);
      if (dd >= 1) continue;
      let f;
      if (kind === 'g') { f = 1 - dd; f = f * f * f; }          // bloom: tight bright core
      else { f = 1 - dd * dd; f *= f; }                         // light pool: soft wide falloff
      const q = dq(f, 6, i + ox, j + oy);
      if (q <= 0) continue;
      const k = (j * s + i) * 4;
      d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = Math.round(q * 255);
    }
    x.putImageData(img, 0, 0);
    stampCache.set(key, c);
    return c;
  }
  function stampColor(kind, r, ox, oy, color) {
    const key = kind + r + '|' + (ox & 3) + (oy & 3) + color;
    let c = stampCache.get(key);
    if (c) return c;
    const m = stampMask(kind, r, ox, oy);
    c = mk(m.width, m.height);
    const x = c.getContext('2d');
    x.drawImage(m, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    stampCache.set(key, c);
    return c;
  }
  const tintCache = {};
  const poolTint = (c) => tintCache[c] || (tintCache[c] = CO.mix(c, '#ffffff', 0.12));

  function lightLevel(l, sky, t) {
    if (typeof l.on === 'function') { let on = false; try { on = !!l.on(); } catch (e) { on = false; } if (!on) return 0; }
    let a = l.intensity == null ? 1 : +l.intensity || 0;
    if (l.nightOnly !== false) a *= sky.lampK;
    if (a < 0.02) return 0;
    const fl = l.flicker === true ? 0.16 : +l.flicker || 0;
    if (fl > 0 && !RM) {
      const q = Math.floor(t * 5) / 5, s = (l.x * 0.37 + l.y * 0.71) % 6.283;
      const w = 0.55 * Math.sin(q * 6.1 + s) + 0.3 * Math.sin(q * 13.3 + s * 2.1) + 0.15 * Math.sin(q * 23.9 + s * 3.7);
      a *= 1 - fl * (0.5 + 0.5 * w);
    }
    return a > 1 ? 1 : a;
  }

  /** Every live light this frame, in screen-world px (its island's bob applied). */
  const active = [];
  function collectLights(sky, t) {
    active.length = 0;
    for (const l of S.lights) {
      if (!l || !isFinite(l.x) || !isFinite(l.y)) continue;
      const a = lightLevel(l, sky, t);
      if (a <= 0) continue;
      const qa = Math.round(a * 40);
      if (!qa) continue;
      const r = Math.max(3, Math.min(160, Math.round(+l.r || 24)));
      active.push({ x: Math.round(l.x), y: Math.round(l.y) + S.bob(l.island), r, a: qa / 40, color: l.color || '#ffd27a' });
    }
  }

  /** Rebuild one island's darkness if its sky level or lights changed. */
  function darkFor(g, sky) {
    const bob = S.bob(g.id), bx = g.box.x, by = g.box.y + bob, bw = g.box.w, bh = g.box.h;
    const here = g.lightsHere; here.length = 0;
    let sig = sky.key;
    for (const L of active) {
      if (L.x + L.r < bx || L.x - L.r > bx + bw || L.y + L.r < by || L.y - L.r > by + bh) continue;
      const lx = L.x - bx, ly = L.y - by;
      here.push({ x: lx, y: ly, r: L.r, a: L.a, color: L.color });
      sig += '|' + lx + ',' + ly + ',' + L.r + ',' + Math.round(L.a * 40);
    }
    if (sig === g.darkSig) return;
    g.darkSig = sig;
    if (prof) prof.rebuilds++;
    const mx = g.mulC.getContext('2d'), lx = g.liftC.getContext('2d');
    mx.globalCompositeOperation = 'source-over'; mx.globalAlpha = 1;
    mx.clearRect(0, 0, bw, bh);
    mx.fillStyle = sky.mul; mx.fillRect(0, 0, bw, bh);
    lx.globalCompositeOperation = 'source-over'; lx.globalAlpha = 1;
    lx.clearRect(0, 0, bw, bh);
    const veil = sky.la > 0.002;
    if (veil) { lx.fillStyle = rgba(sky.lift, sky.la); lx.fillRect(0, 0, bw, bh); }
    // Moonlight: the top-left-facing rim keeps a pale cool edge against space.
    if (sky.rimK > 0.01) {
      mx.globalAlpha = 0.4 * sky.rimK; mx.drawImage(rimColored(g, '#dfe4ff'), 0, 0);
      if (veil) { lx.globalCompositeOperation = 'destination-out'; lx.globalAlpha = 0.6 * sky.rimK; lx.drawImage(g.rimC, 0, 0); }
      lx.globalCompositeOperation = 'source-over'; lx.globalAlpha = 0.42 * sky.rimK; lx.drawImage(rimColored(g, '#9fb2ff'), 0, 0);
    }
    // Pools replace the sky tint with the lamp's own warm colour (no blow-out where pools overlap).
    lx.globalCompositeOperation = 'destination-out';
    for (const L of here) {
      const ox = L.x - L.r, oy = L.y - L.r;
      mx.globalAlpha = L.a;
      mx.drawImage(stampColor('p', L.r, ox + bx, oy + g.box.y, poolTint(L.color)), ox, oy);
      if (veil) { lx.globalAlpha = L.a; lx.drawImage(stampMask('p', L.r, ox + bx, oy + g.box.y), ox, oy); }
    }
    lx.globalCompositeOperation = 'source-over';
    const bloomK = 0.1 + 0.28 * sky.n;
    for (const L of here) {
      const gr = Math.max(3, Math.round(L.r * 0.45)), gx = L.x - gr, gy = L.y - gr;
      lx.globalAlpha = L.a * bloomK;
      lx.drawImage(stampColor('g', gr, gx + bx, gy + g.box.y, L.color), gx, gy);
    }
    // Cut both to the island silhouette: space keeps its own sky.
    mx.globalAlpha = 1; lx.globalAlpha = 1;
    mx.globalCompositeOperation = 'destination-in'; mx.drawImage(g.maskC, 0, 0);
    lx.globalCompositeOperation = 'destination-in'; lx.drawImage(g.maskC, 0, 0);
    mx.globalCompositeOperation = 'source-over'; lx.globalCompositeOperation = 'source-over';
    g.hasVeil = veil || here.length > 0 || sky.rimK > 0.01;
  }
  function rimColored(g, color) {
    const cache = g.rimCol || (g.rimCol = {});
    if (cache[color]) return cache[color];
    const c = mk(g.box.w, g.box.h), x = c.getContext('2d');
    x.drawImage(g.rimC, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    return (cache[color] = c);
  }

  /* ========================================================= TEXTURES */
  const TEX = {};
  /** Tileable overcast texture, drawn with 'multiply': cool grey with darker billows. */
  function cloudTexture(kind) {
    if (TEX[kind]) return TEX[kind];
    const s = 256, c = mk(s, s), x = c.getContext('2d'), img = x.createImageData(s, s), d = img.data;
    const storm = kind === 'storm';
    const tones = (storm ? ['#b4b9cf', '#a5abc5', '#969dbb'] : ['#e4e7ef', '#d9dde8', '#ced3e1']).map(rgb);
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const n = vnoise(i / 32, j / 32, storm ? 31 : 21, 8, 8) * 0.62 + vnoise(i / 16, j / 16, storm ? 32 : 22, 16, 16) * 0.28 + vnoise(i / 8, j / 8, 23, 32, 32) * 0.1;
      const q = dq(smooth(0.3, 0.8, n), 2, i, j);
      const col = tones[Math.round(q * 2)];
      const k = (j * s + i) * 4;
      d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return (TEX[kind] = c);
  }
  /** Tileable mist: long horizontal wisps. */
  function mistTexture() {
    if (TEX.mist) return TEX.mist;
    const w = 256, h = 128, c = mk(w, h), x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data;
    const col = rgb('#eef3f8');
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const n = vnoise(i / 64, j / 10, 41, 4, 13) * 0.65 + vnoise(i / 21.333, j / 6.4, 42, 12, 20) * 0.35;
      const v = smooth(0.42, 0.8, n);
      const a = dq(v, 4, i, j);
      if (!a) continue;
      const k = (j * w + i) * 4;
      d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = Math.round(a * 255);
    }
    x.putImageData(img, 0, 0);
    return (TEX.mist = c);
  }

  /** Redraw a scrolling texture into an island-box canvas, masked by `mask`. */
  function paintMasked(g, canvas, tex, offX, offY, mask) {
    const x = canvas.getContext('2d');
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, g.box.w, g.box.h);
    const tw = tex.width, th = tex.height;
    // World-anchored so the texture does not jump between repaints.
    const sx = (((g.box.x + offX) % tw) + tw) % tw, sy = (((g.box.y + offY) % th) + th) % th;
    for (let y = -sy; y < g.box.h; y += th) for (let xx = -sx; xx < g.box.w; xx += tw) x.drawImage(tex, xx, y);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(mask, 0, 0);
    x.globalCompositeOperation = 'source-over';
  }

  /* ======================================================== CLOUD SPRITES
   * Hand-shaded pixel cumulus: a row of front puffs along a flat base with
   * bigger puffs behind them, each lit from the top-left in four dithered
   * tones, a crisp darker seam where a front puff overlaps the one behind,
   * a darker flat underside and a 1 px outline.
   */
  const CLOUD_PAL = {
    rain:  { out: '#32374f', tones: ['#69718e', '#878fa9', '#a8afc5', '#d2d7e5'], base: '#555c78', seam: '#79819d' },
    storm: { out: '#131425', tones: ['#2c2f48', '#464b70', '#656b96', '#959bc4'], base: '#20223a', seam: '#3a3e62' },
  };
  function cloudSprite(seed, w, h, kind) {
    const r = S.rng(seed);
    const pal = CLOUD_PAL[kind];
    const base = h - 3;
    const puffs = [];   // [cx, cy, radius], back row first
    // Back row: big puffs, the tallest a little left of centre.
    const nb = Math.max(2, Math.round(w / 30));
    for (let i = 0; i < nb; i++) {
      const u = nb === 1 ? 0.5 : i / (nb - 1);
      const hump = 1 - Math.pow((u - 0.42) * 1.6, 2);
      const rad = Math.max(5, h * (0.3 + 0.16 * hump) + (r() - 0.5) * 3);
      const cx = lerp(w * 0.26, w * 0.72, u) + (r() - 0.5) * 6;
      puffs.push([cx, Math.max(rad + 1, base - h * 0.42 - rad * 0.35 * hump), rad]);
    }
    // Front row: smaller puffs sitting on the base.
    const nf = Math.max(2, Math.round(w / 17));
    for (let i = 0; i < nf; i++) {
      const u = i / (nf - 1);
      const rad = Math.max(4, h * (0.24 + r() * 0.08) * (1 - Math.abs(u - 0.5) * 0.35));
      const cx = lerp(rad + 1.5, w - rad - 1.5, u) + (r() - 0.5) * 3;
      puffs.push([cx, base - rad * 0.62, rad]);
    }
    const owner = new Int16Array(w * h).fill(-1), lit = new Float32Array(w * h), rimd = new Float32Array(w * h);
    for (let j = 0; j <= base; j++) for (let i = 0; i < w; i++) {
      let o = -1;
      for (let k = 0; k < puffs.length; k++) {
        const [cx, cy, rad] = puffs[k];
        if (Math.hypot(i + 0.5 - cx, (j + 0.5 - cy) * 1.06) <= rad) o = k;
      }
      if (o < 0) continue;
      const [cx, cy, rad] = puffs[o];
      const dx = (i + 0.5 - cx) / rad, dy = (j + 0.5 - cy) / rad;
      let L = -(dx * 0.55 + dy * 0.83);                       // light from the top-left
      L -= 0.55 * smooth(base - h * 0.4, base, j);           // shadowed towards the flat base
      L += (vnoise(i / 4, j / 4, seed) - 0.5) * 0.1;         // a little texture
      const k = j * w + i;
      owner[k] = o; lit[k] = clamp01((L + 0.62) / 1.5); rimd[k] = rad - Math.hypot(i + 0.5 - cx, (j + 0.5 - cy) * 1.06);
    }
    const OW = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? -1 : owner[j * w + i]);
    const c = mk(w, h), x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i, o = owner[k];
      let col = null;
      if (o >= 0) {
        const below = OW(i, j + 1);
        if (j >= base - 1 || (below < 0 && j >= base - 3)) col = rgb(pal.base);
        else if (j === base - 2 && ((i + j) & 1)) col = rgb(pal.tones[0]);
        else {
          const up = OW(i, j - 1), lf = OW(i - 1, j);
          const seam = rimd[k] < 1.3 && ((up >= 0 && up < o) || (lf >= 0 && lf < o));
          if (seam) col = rgb(pal.seam);
          else {
            const tq = band(lit[k], 3, i, j);
            col = rgb(pal.tones[Math.round(tq * 3)]);
            // Sunlit lip on each puff's outer top-left edge.
            if ((up < 0 || lf < 0) && lit[k] > 0.4) col = rgb(pal.tones[Math.min(3, Math.round(band(lit[k], 3, i, j) * 3) + 1)]);
          }
        }
      } else if (pal.out && (OW(i - 1, j) >= 0 || OW(i + 1, j) >= 0 || OW(i, j - 1) >= 0 || OW(i, j + 1) >= 0)) {
        col = rgb(pal.out);
      }
      if (!col) continue;
      d[k * 4] = col[0]; d[k * 4 + 1] = col[1]; d[k * 4 + 2] = col[2]; d[k * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    // Opaque span per column (first and last drawn row, -1 if empty), so "is someone
    // under this cloud?" tests the real puffy outline, not the sprite's bounding box.
    const top = new Int16Array(w).fill(-1), bot = new Int16Array(w).fill(-1);
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (d[(j * w + i) * 4 + 3]) { if (top[i] < 0) top[i] = j; bot[i] = j; }
    return { c, w, h, base, top, bot };
  }
  /** A long thin wisp of cloud for open space: streaky, lit on top, dithered alpha. */
  function wispSprite(seed, w, h) {
    const c = mk(w, h), x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data;
    const top = rgb('#fbfaff'), mid = rgb('#dedbf6'), low = rgb('#bdb9e3');
    const lump = (i) => 0.75 + 0.5 * vnoise(i / 22, 0.5, seed + 9);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = (i + 0.5) / w, cy = h * (0.55 - 0.12 * Math.sin(u * Math.PI));
      const thick = h * 0.5 * Math.sin(Math.min(1, u * 1.15) * Math.PI) * lump(i);
      if (thick <= 0.5) continue;
      const e = 1 - Math.abs(j + 0.5 - cy) / thick;
      const n = vnoise(i / 16, j / 4, seed) * 0.6 + vnoise(i / 6, j / 2.5, seed + 1) * 0.4;
      const dens = e * 1.3 + (n - 0.5) * 0.8 - 0.15;
      if (dens <= 0) continue;
      const a = band(smooth(0, 0.9, dens), 3, i, j);
      if (!a) continue;
      const above = (cy - (j + 0.5)) / thick;   // +1 top edge .. -1 bottom edge
      const col = above > 0.25 ? top : above > -0.35 ? mid : low;
      const k = (j * w + i) * 4;
      d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = Math.round(a * 255);
    }
    x.putImageData(img, 0, 0);
    return { c, w, h, base: h };
  }
  /** Soft dithered ground shadow for a hovering cloud. */
  const SHADOWS = {};
  function cloudShadow(w, h) {
    const key = w + 'x' + h;
    if (SHADOWS[key]) return { c: SHADOWS[key], scratch: mk(w, h), key: '' };
    const c = mk(w, h), x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data;
    const col = rgb('#6e7598');
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const dd = Math.hypot((i + 0.5 - w / 2) / (w / 2), (j + 0.5 - h / 2) / (h / 2));
      if (dd >= 1) continue;
      const q = dq(smooth(1, 0.45, dd), 3, i, j);
      if (!q) continue;
      const k = (j * w + i) * 4;
      d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = Math.round(q * 255);
    }
    x.putImageData(img, 0, 0);
    SHADOWS[key] = c;
    return { c, scratch: mk(w, h), key: '' };
  }
  /** A sprite tinted to the current sky (multiply + veil), cached by sky key. */
  function tinted(spr, sky, extraDark) {
    const key = sky.key + (extraDark || 0);
    if (spr.tkey === key) return spr.tc;
    if (!spr.tc) spr.tc = mk(spr.w, spr.h);
    const x = spr.tc.getContext('2d');
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    x.clearRect(0, 0, spr.w, spr.h);
    x.drawImage(spr.c, 0, 0);
    // Clouds catch a little more light than the ground: lighten the tint a touch.
    const mul = CO.mix(sky.mul, '#ffffff', 0.15);
    if (mul !== '#ffffff') { x.globalCompositeOperation = 'multiply'; x.fillStyle = mul; x.fillRect(0, 0, spr.w, spr.h); }
    if (sky.la > 0.002) { x.globalCompositeOperation = 'source-over'; x.fillStyle = rgba(sky.lift, sky.la); x.fillRect(0, 0, spr.w, spr.h); }
    x.globalCompositeOperation = 'destination-in'; x.drawImage(spr.c, 0, 0);
    x.globalCompositeOperation = 'source-over';
    spr.tkey = key;
    return spr.tc;
  }
  /** White silhouette of a sprite for lightning flashes. */
  function flashSprite(spr) {
    if (spr.fc) return spr.fc;
    const c = mk(spr.w, spr.h), x = c.getContext('2d');
    x.drawImage(spr.c, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = '#e6ecff'; x.fillRect(0, 0, spr.w, spr.h);
    return (spr.fc = c);
  }

  /* ========================================================= WEATHER
   * One record per island. Levels come from S.status (biome islands only; the
   * hub has no status and stays clear).
   */
  const WX = {};
  if (DBG.atmoProfile) DBG.atmoWX = WX;
  const levelOf = (id) => { const st = S.status && S.status[id]; return (st && st.level) || 'ok'; };
  /** The clearest spot over an island's top for a cloud `fw`×`fh` tiles big:
   * few buildings, roofs (rows just below) or landmarks under it, clear of the
   * HUD band at the top of the screen, with island ground below for the rain. */
  function cloudSpot(id, fw, fh) {
    const r = S.islands[id];
    const lms = Object.keys(S.landmarks).map((k) => S.landmarks[k]).filter((l) => l.island === id);
    let best = null;
    const hw = fw >> 1, hh = fh >> 1;
    for (let ty = Math.max(r.y + hh, 5); ty <= r.y + r.h - 5; ty++) for (let tx = r.x + hw + 1; tx <= r.x + r.w - hw - 1; tx++) {
      let cost = 0;
      for (let y = ty - hh; y <= ty + hh + 3; y++) for (let x = tx - hw; x <= tx + hw; x++) {
        const roof = y > ty + hh;   // a building just below pokes its roof up into the cloud
        if (!S.islandAt(x, y)) cost += roof ? 0.4 : 2.5;
        else if (S.isReserved(x, y)) cost += roof ? 1.6 : 3;
        else if (S.onRoad(x, y)) cost += 0.25;
      }
      for (const L of lms) if (Math.abs(L.x - tx) <= hw + 1 && L.y - ty >= -hh - 1 && L.y - ty <= hh + 4) cost += 10;
      for (let y = ty + hh + 1; y <= ty + hh + 5; y++) if (!S.islandAt(tx, y)) cost += 1.5;
      cost += 0.3 * Math.abs(ty - (r.y + r.h * 0.4)) + 0.05 * Math.abs(tx - (r.x + r.w / 2));
      if (!best || cost < best.cost) best = { tx, ty, cost };
    }
    return best ? { tx: best.tx + 0.5, ty: best.ty + 0.5 } : { tx: r.x + r.w / 2, ty: r.y + r.h / 3 };
  }
  /* Hand-picked clear sky over each biome island (tile coords of the cloud's
   * centre): open grass, plaza or river, away from the name-defining landmark
   * and from every place a villager stops to work (40-villagers' PL spots, the
   * kid's kite meadow), so the rain cloud (warn) and the bigger storm cloud
   * (critical) both keep at least ~12 px clear of them through their drift.
   *   Lantern Peak      the south lawn below the bell pavilion and scroll board
   *   Neon Hollow       the south strip below the blimp walkway
   *   Spindrift Harbor  rain: over the river between the kid's kite and the
   *                     lighthouse; storm (too wide for that gap): the cargo
   *                     yard by the crane, south of Twirl's yellow stall
   *   Copperhold        the open yard between the cottage and the crystals
   * Anyone who still walks under a cloud is revealed by seeThrough(). */
  const SPOTS = { monastery: [11, 15.75], market: [61.3, 16.1], port: [19.875, 30.625], mine: [65, 35.4] };
  /** Storm-only spots where the big storm cloud needs more room (glides there with w.storm). */
  const SPOTS_STORM = { port: [23.25, 40.125] };
  /** Where a storm's smaller second cloud sits relative to the main one (px), kept off buildings and work spots. */
  const SIDE = { monastery: [-60, -6], market: [-56, -2], port: [-56, 12] };
  function wxFor(id) {
    if (WX[id]) return WX[id];
    const seed = 7 + S.ISLANDS.indexOf(id) * 31;
    const crit = levelOf(id) === 'critical';
    const main = { spr: cloudSprite(seed + 1, 84, 40, 'rain'), sprS: cloudSprite(seed + 2, 128, 56, 'storm'), ph: (seed % 10) / 10 * 6.28, dx: 0, dy: 0, see: 0 };
    const so = SIDE[id] || [50, -16];
    const side = { spr: null, sprS: cloudSprite(seed + 3, 76, 36, 'storm'), ph: main.ph + 1.7, dx: so[0], dy: so[1], see: 0 };
    const spot = SPOTS[id] ? { tx: SPOTS[id][0], ty: SPOTS[id][1] } : cloudSpot(id, crit ? 9 : 6, crit ? 4 : 3);
    const spotS = SPOTS_STORM[id] ? { tx: SPOTS_STORM[id][0], ty: SPOTS_STORM[id][1] } : spot;
    return (WX[id] = {
      id, seed, level: 'ok', spot, spotS,
      shade: 0, mist: 0, rain: 0, storm: 0,
      shadeC: null, shadeKey: '', mistC: null, mistKey: '',
      clouds: [side, main],   // drawn back to front
      drops: [], splashes: [], acc: 0,
      nextBolt: 0, flashT: -1, bolt: null,
    });
  }

  /** Where each of an island's clouds hangs this frame (world px, before bob). */
  function placeClouds(w, t) {
    const stormy = w.storm > 0.5;
    const u = clamp01(w.storm);
    const cx0 = Math.round(lerp(w.spot.tx, w.spotS.tx, u) * TILE), cy0 = Math.round(lerp(w.spot.ty, w.spotS.ty, u) * TILE);
    for (const c of w.clouds) {
      const spr = stormy ? c.sprS : c.spr;
      c.cur = spr;
      if (!spr) { c.k = 0; continue; }
      c.k = c.dx ? w.storm : Math.max(w.rain, w.shade);
      const drift = RM ? 0 : Math.round(Math.sin(t * 0.07 * SPD + c.ph) * 10);
      const bobY = RM ? 0 : Math.round(Math.sin(t * 0.6 + c.ph) * 1.2);
      c.x = Math.round(cx0 + c.dx + drift - spr.w / 2); c.y = Math.round(cy0 + c.dy + bobY - spr.h / 2);
      c.w = spr.w; c.h = spr.h; c.base = c.y + spr.base;
    }
  }

  /* A hovering cloud must never hide a villager. While someone on this island
   * stands or walks under one (sprite box: feet ±12 px, up to the top of the
   * head), or the kid's kite flies into it, the cloud thins to see-through and
   * firms up again once they have moved on. Tested against the cloud's real
   * per-column outline; a handful of entities, so it costs next to nothing. */
  const SEE_DIM = 0.6;    // how much of the cloud's opacity goes while someone is under it
  function coversBox(c, x0, x1, y0, y1) {
    const spr = c.cur, i0 = Math.max(0, Math.floor(x0 - c.x)), i1 = Math.min(spr.w - 1, Math.ceil(x1 - c.x));
    if (i0 > i1 || y1 < c.y || y0 > c.y + spr.h) return false;
    for (let i = i0; i <= i1; i++) {
      const tp = spr.top[i];
      if (tp >= 0 && c.y + tp <= y1 && c.y + spr.bot[i] >= y0) return true;
    }
    return false;
  }
  function figureUnder(w, c) {
    for (const e of S.entities) {
      if (!e || e.hidden || e.riding || e.island !== w.id || typeof e.h !== 'number' || !isFinite(e.x) || !isFinite(e.y)) continue;
      if (coversBox(c, e.x - 12, e.x + 12, e.y - e.h - 4, e.y)) return true;
      const k = e.kite;   // the kid's kite (drawn 13×17 at its anchor, tail below)
      if (k && isFinite(k.x) && isFinite(k.y) && coversBox(c, k.x - 7, k.x + 6, k.y - 1, k.y + 22)) return true;
    }
    return false;
  }
  function seeThrough(w, dt) {
    for (const c of w.clouds) {
      if (!c.cur || c.k < 0.02) { c.see = 0; continue; }
      const tgt = figureUnder(w, c) ? 1 : 0;
      // Settle at once on the first frames so a screenshot is honest; then ease (~0.25 s).
      c.see = w.seen ? c.see + (tgt - c.see) * Math.min(1, dt * 8) : tgt;
    }
    w.seen = true;
  }

  function spawnDrop(w, storm) {
    const g = geo(w.id);
    const cands = w.clouds.filter((c) => c.k > 0.3 && c.cur);
    if (!cands.length) return;
    const c = cands[(Math.random() * cands.length) | 0];
    const x0 = c.x + c.w * rnd(0.14, 0.86), y0 = c.base + rnd(-3, 2);
    const slant = storm ? 0.32 : 0.16;
    // Rain lands on the ground below the cloud; the "ground" is somewhere in the shower column.
    const maxReach = Math.max(44, Math.min(storm ? 130 : 100, g.topY1 - c.base));
    const reach = Math.random() < 0.12 ? rnd(maxReach, maxReach + 30) : rnd(22, maxReach);
    const gx = x0 + reach * slant, gy = y0 + reach;
    const lands = onTop(g, gx, gy);
    const fall = lands ? reach : reach + rnd(50, 110);   // past the edge: keep falling into space
    w.drops.push({ x0, y0, fall, slant, len: storm ? 10 : 7, life: 0, dur: fall / ((storm ? 300 : 230) * (RM ? 0.6 : 1)), heavy: storm && Math.random() < 0.35, lands, reach });
  }

  function makeBolt(w) {
    const g = geo(w.id);
    const c = w.clouds[1];
    if (!c.cur) return null;
    let x = c.x + c.w * rnd(0.3, 0.7), y = c.base - 2;
    let gx = x, gy = y + 60;
    for (let k = 0; k < 10; k++) {
      gx = x + rnd(-14, 14); gy = c.base + rnd(40, 110);
      if (onTop(g, gx, gy)) break;
    }
    const pts = [[x | 0, y | 0]];
    const steps = Math.max(3, Math.round((gy - y) / 8));
    for (let s = 1; s <= steps; s++) {
      const u = s / steps;
      const px = lerp(x, gx, u) + (s < steps ? rnd(-5, 5) : 0);
      pts.push([px | 0, lerp(y, gy, u) | 0]);
    }
    const branch = [];
    if (pts.length > 4) {
      let [bx, by] = pts[1 + ((Math.random() * (pts.length - 3)) | 0)];
      const dir = Math.random() < 0.5 ? -1 : 1;
      branch.push([bx, by]);
      for (let k = 0; k < 3; k++) { bx += dir * rnd(3, 8); by += rnd(4, 8); branch.push([bx | 0, by | 0]); }
    }
    return { pts, branch, gx: gx | 0, gy: gy | 0 };
  }
  /** Flash envelope: a double strike that decays. */
  const flashAlpha = (ft) => (ft < 0 ? 0 : ft < 0.07 ? 1 : ft < 0.14 ? 0.25 : ft < 0.24 ? 0.85 : Math.max(0, 0.85 * (1 - (ft - 0.24) / 0.5)));

  function updateWeather(w, dt, t) {
    const level = levelOf(w.id);
    const tgt = {
      shade: level === 'critical' ? 1 : level === 'warn' ? 1 : 0,
      mist: level === 'idle' ? 1 : level === 'warn' ? 0.15 : 0,
      rain: level === 'critical' ? 1 : level === 'warn' ? 0.6 : 0,
      storm: level === 'critical' ? 1 : 0,
    };
    // Settle instantly on the first frame so a screenshot shows the real weather.
    const k = w.level === 'ok' && !w.started ? 1 : Math.min(1, dt * 0.8);
    w.started = true;
    for (const p in tgt) w[p] += (tgt[p] - w[p]) * k;
    w.level = level;
    placeClouds(w, t);
    seeThrough(w, dt);
    // Rain.
    const rate = (w.storm > 0.5 ? 260 : 160) * w.rain * PART;
    w.acc += rate * dt;
    let n = 0;
    while (w.acc >= 1 && n++ < 30) { w.acc -= 1; spawnDrop(w, w.storm > 0.5); }
    if (w.acc > 4) w.acc = 0;
    for (let i = w.drops.length - 1; i >= 0; i--) {
      const d = w.drops[i];
      d.life += dt;
      if (d.life >= d.dur) {
        if (d.lands) w.splashes.push({ x: Math.round(d.x0 + d.reach * d.slant), y: Math.round(d.y0 + d.reach), age: 0, big: d.heavy });
        w.drops[i] = w.drops[w.drops.length - 1]; w.drops.pop();
      }
    }
    for (let i = w.splashes.length - 1; i >= 0; i--) {
      const s = w.splashes[i];
      s.age += dt;
      if (s.age > 0.22) { w.splashes[i] = w.splashes[w.splashes.length - 1]; w.splashes.pop(); }
    }
    // Lightning (never with reduced motion).
    if (!RM && level === 'critical' && w.storm > 0.8) {
      if (!w.nextBolt) w.nextBolt = t + rnd(1.2, 3.5);
      if (t >= w.nextBolt) { w.flashT = 0; w.bolt = makeBolt(w); w.nextBolt = t + rnd(5, 12); }
    }
    if (w.flashT >= 0) { w.flashT += dt; if (w.flashT > 0.8) { w.flashT = -1; w.bolt = null; } }
  }

  /** Under the darkness (500): overcast shade and mist, masked to the island. */
  function drawWeatherUnder(ctx, w, t, sky) {
    const g = geo(w.id), bx = g.box.x, by = g.box.y;
    if (g.noArt) return;   // nothing drawn there to shade
    if (w.shade > 0.01) {
      const kind = w.storm > 0.5 ? 'storm' : 'cloud';
      const ox = Math.floor(t * (kind === 'storm' ? 7 : 4) * SPD), oy = Math.floor(t * 1.2 * SPD);
      const key = kind + ox + ',' + oy + ':' + geomVersion;
      if (!w.shadeC || w.shadeC.width !== g.box.w || w.shadeC.height !== g.box.h) { w.shadeC = mk(g.box.w, g.box.h); w.shadeKey = ''; }
      if (key !== w.shadeKey) { paintMasked(g, w.shadeC, cloudTexture(kind), -ox, -oy, g.mistC0); w.shadeKey = key; }
      // Overcast: wash out colour first, then darken with the cool cloud tone.
      const strong = kind === 'storm';
      ctx.globalCompositeOperation = 'saturation';
      ctx.globalAlpha = Math.min(1, w.shade) * (strong ? 0.42 : 0.22);
      ctx.drawImage(w.shadeC, bx, by);
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = Math.min(1, w.shade) * (1 - 0.3 * sky.n);   // the night already darkens
      ctx.drawImage(w.shadeC, bx, by);
      ctx.globalCompositeOperation = 'source-over';
      // Each cloud's own soft shadow on the ground below it, down-right (sun top-left).
      for (const c of w.clouds) {
        if (!c.cur || c.k < 0.02) continue;
        const sh = c.shadow || (c.shadow = cloudShadow((c.w * 0.9) | 0, (c.h * 0.62) | 0));
        const sx = c.x + ((c.w * 0.05) | 0) + 10, sy = c.base + 34;
        const skey = sx + ',' + sy + ':' + geomVersion;
        if (sh.key !== skey) {
          sh.key = skey;
          const x = sh.scratch.getContext('2d');
          x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, sh.c.width, sh.c.height);
          x.drawImage(sh.c, 0, 0);
          x.globalCompositeOperation = 'destination-in';
          x.drawImage(g.maskC, bx - sx, by - sy);
          x.globalCompositeOperation = 'source-over';
        }
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = c.k * (strong ? 0.5 : 0.38) * (1 - 0.5 * sky.n);
        ctx.drawImage(sh.scratch, sx, sy);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    if (w.mist > 0.01) {
      const ox = Math.floor(t * 3 * SPD), oy = RM ? 0 : Math.round(Math.sin(t * 0.25) * 2);
      const key = ox + ',' + oy + ':' + geomVersion;
      if (!w.mistC || w.mistC.width !== g.box.w || w.mistC.height !== g.box.h) { w.mistC = mk(g.box.w, g.box.h); w.mistKey = ''; }
      if (key !== w.mistKey) { paintMasked(g, w.mistC, mistTexture(), -ox, oy, g.mistC0); w.mistKey = key; }
      ctx.globalAlpha = w.mist * 0.52;
      ctx.drawImage(w.mistC, bx, by);
    }
    ctx.globalAlpha = 1;
  }

  /** Over the darkness (600): clouds, rain, lightning. Colours cool and dim at night. */
  function drawWeatherOver(ctx, w, sky) {
    if (w.rain < 0.02 && w.shade < 0.02 && w.flashT < 0) return;
    const nk = 1 - 0.3 * sky.n;
    const cStreak = 'rgba(' + (206 - 60 * sky.n | 0) + ',' + (222 - 44 * sky.n | 0) + ',246,' + (0.85 * nk).toFixed(3) + ')';
    const cHead = 'rgba(' + (240 - 50 * sky.n | 0) + ',' + (247 - 36 * sky.n | 0) + ',255,' + (0.95 * nk).toFixed(3) + ')';
    const cSplash = 'rgba(' + (214 - 60 * sky.n | 0) + ',' + (230 - 40 * sky.n | 0) + ',246,' + (0.75 * nk).toFixed(3) + ')';
    // Splashes on the ground.
    if (w.splashes.length) {
      ctx.fillStyle = cSplash;
      for (const s of w.splashes) {
        const x = s.x, y = s.y;
        const f = s.age < 0.07 ? 0 : s.age < 0.14 ? 1 : 2;
        if (f === 0) ctx.fillRect(x - 1, y, 3, 1);
        else if (f === 1) { ctx.fillRect(x - 2, y - 1, 1, 1); ctx.fillRect(x + 2, y - 1, 1, 1); ctx.fillRect(x, y - 2, 1, 1); if (s.big) { ctx.fillRect(x - 1, y - 3, 1, 1); ctx.fillRect(x + 1, y - 3, 1, 1); } }
        else { ctx.fillRect(x - 3, y, 1, 1); ctx.fillRect(x + 3, y, 1, 1); }
      }
    }
    // Rain streaks: a slanted 1px streak with a brighter head; past-the-edge drops fade out.
    if (w.drops.length) {
      for (const d of w.drops) {
        const dist = d.fall * (d.life / d.dur);
        const hx = Math.round(d.x0 + dist * d.slant), hy = Math.round(d.y0 + dist);
        const L = Math.min(d.len, Math.round(dist)), half = L >> 1;
        if (L < 2) continue;
        let a = 1;
        if (!d.lands && dist > d.reach) a = 1 - (dist - d.reach) / (d.fall - d.reach);
        ctx.globalAlpha = a;
        ctx.fillStyle = cStreak;
        ctx.fillRect(hx - Math.round(L * d.slant), hy - L, 1, half);
        ctx.fillRect(hx - Math.round(half * d.slant), hy - L + half, 1, L - half - 1);
        ctx.fillStyle = cHead;
        ctx.fillRect(hx, hy - 1, 1, d.heavy ? 2 : 1);
      }
      ctx.globalAlpha = 1;
    }
    // Lightning flash on this island only ('screen' brightens instead of fogging).
    const fa = flashAlpha(w.flashT);
    if (fa > 0.01 && !geo(w.id).noArt) {
      const g = geo(w.id);
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = fa * (0.24 + 0.2 * sky.n);
      ctx.drawImage(g.flashC, g.box.x, g.box.y);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    const b = w.bolt;
    if (b && w.flashT < 0.3 && !(w.flashT > 0.07 && w.flashT < 0.14)) {
      const seg = (pts, glow, core) => {
        for (let i = 0; i + 1 < pts.length; i++) {
          const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
          S.px.line(ctx, x0 - 1, y0, x1 - 1, y1, glow); S.px.line(ctx, x0 + 1, y0, x1 + 1, y1, glow);
        }
        for (let i = 0; i + 1 < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; S.px.line(ctx, x0, y0, x1, y1, core); }
      };
      seg(b.branch, 'rgba(150,180,255,0.5)', '#dfe8ff');
      seg(b.pts, 'rgba(170,196,255,0.75)', '#fffbe8');
      ctx.fillStyle = '#fffbe8';
      ctx.fillRect(b.gx - 2, b.gy, 5, 1); ctx.fillRect(b.gx - 1, b.gy - 1, 3, 1); ctx.fillRect(b.gx, b.gy + 1, 1, 1);
    }
    // The clouds themselves, over their rain.
    for (const c of w.clouds) {
      if (!c.cur || c.k < 0.02) continue;
      const op = 1 - SEE_DIM * (c.see || 0);   // see-through while a villager is under it
      ctx.globalAlpha = Math.min(1, c.k * 1.15) * op;
      ctx.drawImage(tinted(c.cur, sky), c.x, c.y);
      if (fa > 0.01 && c === w.clouds[1]) { ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = fa * 0.55 * op; ctx.drawImage(flashSprite(c.cur), c.x, c.y); ctx.globalCompositeOperation = 'source-over'; }
    }
    ctx.globalAlpha = 1;
  }

  /* ===================================================== CLOUD WISPS
   * A few soft pixel wisps drift east through space, slipping behind the
   * islands (each island's silhouette is cut out of them at its bob).
   */
  const WISPS = [];
  const LANES = [[22, 30], [26, 31], [8, 14], [38, 46], [0, 4]];   // tile rows where open space runs
  function newWisp(i, initial) {
    const r = S.rng(900 + i * 37 + ((Math.random() * 1000) | 0));
    const w = 120 + ((r() * 110) | 0), h = 14 + ((r() * 10) | 0);
    const spr = wispSprite(500 + i * 13 + ((r() * 50) | 0), w, h);
    const lane = LANES[(Math.random() * LANES.length) | 0];
    const ty = rnd(lane[0], lane[1]) * TILE;
    return { spr, x: initial ? rnd(-w, W) : -w - rnd(20, 400), y: ty, vx: rnd(4, 7) * SPD, a: rnd(0.4, 0.62), scratch: mk(w, h) };
  }
  function drawWisps(ctx, dt, sky) {
    if (!WISPS.length) { const n = RM ? 2 : 4; for (let i = 0; i < n; i++) WISPS.push(newWisp(i, true)); }
    // By day soft lavender-white; at night they fade to faint blue ghosts.
    const vis = lerp(0.85, 0.35, sky.n);
    for (let i = 0; i < WISPS.length; i++) {
      let p = WISPS[i];
      p.x += p.vx * dt;
      if (p.x > W + 10) { p = WISPS[i] = newWisp(i, false); }
      const x0 = Math.round(p.x), y0 = Math.round(p.y);
      if (x0 + p.spr.w < 0 || x0 > W) continue;
      // Re-cut only when the wisp, an island under it, or the sky moved on.
      let key = x0 + ',' + y0 + sky.key + geomVersion;
      for (const id of S.ISLANDS) key += S.bob(id);
      if (key !== p.key) {
        p.key = key;
        const sx = p.scratch.getContext('2d');
        sx.globalCompositeOperation = 'source-over'; sx.globalAlpha = 1;
        sx.clearRect(0, 0, p.spr.w, p.spr.h);
        sx.drawImage(tinted(p.spr, sky), 0, 0);
        sx.globalCompositeOperation = 'destination-out';
        for (const id of S.ISLANDS) {
          const g = G[id];
          if (!g) continue;
          const gx = g.box.x - x0, gy = g.box.y + S.bob(id) - y0;
          if (gx > p.spr.w || gy > p.spr.h || gx + g.box.w < 0 || gy + g.box.h < 0) continue;
          sx.drawImage(g.maskC, gx, gy);
        }
        sx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = p.a * vis;
      ctx.drawImage(p.scratch, x0, y0);
    }
    ctx.globalAlpha = 1;
  }

  /* =================================================== SEASON PARTICLES */
  // [main, dark, light] per leaf/petal colour.
  const LEAF = {
    autumn: [['#d4782f', '#8e4519', '#f2a256'], ['#e0a93a', '#9c6a1a', '#f6d06a'], ['#c4502a', '#7a2a16', '#e8784a'], ['#b98a3c', '#6e4c1c', '#dcb062']],
    spring: [['#f6b6cc', '#d27c9c', '#ffe4ee'], ['#ffd2e2', '#e09ab6', '#ffffff'], ['#fff0f5', '#e2aec2', '#ffffff']],
  };
  // Frames as [dx, dy, tone] (0 main, 1 dark, 2 light): tilted, edge-on, tilted back, lying flat.
  const LEAF_F = [
    [[1, 0, 0], [2, 0, 2], [0, 1, 0], [1, 1, 0], [2, 1, 1]],
    [[0, 0, 0], [1, 0, 2], [2, 0, 0], [3, 0, 1]],
    [[0, 0, 2], [1, 0, 0], [0, 1, 1], [1, 1, 0], [2, 1, 0]],
    [[1, 0, 2], [0, 1, 0], [1, 1, 0], [2, 1, 1], [3, 1, 1]],
  ];
  const PETAL_F = [[[0, 0, 2], [1, 0, 0], [1, 1, 1]], [[0, 0, 2], [1, 1, 0]], [[0, 0, 0], [0, 1, 1]], [[0, 0, 2], [1, 0, 0], [2, 0, 1]]];
  // How leafy each island is (Neon Hollow and Copperhold have few trees).
  const LEAFY = { square: 0.9, monastery: 1.25, market: 0.4, port: 0.85, mine: 0.5 };

  const PS = {};   // per island: {season, leaves, flakes, flies}
  const psFor = (id) => PS[id] || (PS[id] = { season: '', leaves: [], flakes: [], flies: [] });

  function spawnLeaf(g, p, season, initial) {
    const cols = LEAF[season];
    const t = g.top;
    p.gx = rnd(t.x0 + 6, t.x1 - 6);
    p.gy = rnd(t.y0 + 4, t.y1 - 6);
    const h = rnd(36, 120);
    p.vy = (season === 'spring' ? rnd(8, 13) : rnd(11, 20)) * SPD;
    p.wind = (season === 'spring' ? 7 : 5) * SPD;
    // Start up-wind so the leaf drifts onto its landing spot.
    p.x = p.gx - (h / p.vy) * p.wind;
    p.y = p.gy - h;
    if (initial) { const u = Math.random(); p.x = lerp(p.x, p.gx, u); p.y = lerp(p.y, p.gy, u); }
    p.ph = rnd(0, 6.28); p.sw = rnd(1.2, 2.4); p.amp = season === 'spring' ? rnd(6, 13) : rnd(4, 9);
    p.col = cols[(Math.random() * cols.length) | 0];
    p.age = initial ? rnd(0.5, 1) : 0; p.rest = -1; p.restDur = rnd(1.5, 4); p.off = false; p.offT = 0;
    return p;
  }
  function updateLeaves(g, ps, dt, t, season) {
    for (const p of ps.leaves) {
      p.age += dt;
      if (p.rest >= 0) { p.rest += dt; if (p.rest > p.restDur) spawnLeaf(g, p, season, false); continue; }
      p.y += p.vy * dt;
      p.x += (p.wind + Math.cos(t * p.sw + p.ph) * p.amp) * dt;
      if (p.off) { p.offT += dt; if (p.offT > 2.2) spawnLeaf(g, p, season, false); continue; }
      if (p.y >= p.gy) {
        if (onTop(g, p.x + 1, p.y + 1)) { p.y = p.gy; p.rest = 0; }
        else { p.off = true; p.offT = 0; p.vy *= 1.5; }   // over the edge: tumble down into space
      }
    }
  }
  function drawLeaves(ctx, ps, t, season, sky) {
    const frames = season === 'spring' ? PETAL_F : LEAF_F;
    for (const p of ps.leaves) {
      let a = Math.min(1, p.age / 0.5);
      let f;
      if (p.rest >= 0) { f = 3; a *= 1 - smooth(p.restDur - 0.8, p.restDur, p.rest); }
      else { const s = Math.sin(t * p.sw * 2.2 + p.ph); f = s > 0.45 ? 0 : s < -0.45 ? 2 : 1; }
      if (p.off) a *= (1 - p.offT / 2.2) * (1 - 0.5 * sky.n);   // out in space the darkness can't dim it
      if (a <= 0.02) continue;
      ctx.globalAlpha = a;
      const x = Math.round(p.x), y = Math.round(p.y);
      // A soft 1px shadow beneath falling leaves sells the height.
      if (p.rest < 0 && !p.off && season === 'autumn') { ctx.fillStyle = 'rgba(20,16,30,0.2)'; const hh = Math.min(6, (p.gy - p.y) * 0.08) | 0; ctx.fillRect(x + 1 + hh, y + 3 + hh, 2, 1); }
      for (const [dx, dy, tone] of frames[f]) { ctx.fillStyle = p.col[tone]; ctx.fillRect(x + dx, y + dy, 1, 1); }
    }
    ctx.globalAlpha = 1;
  }

  function spawnFlake(g, f, initial) {
    const t = g.top;
    f.z = Math.random();
    f.x = rnd(t.x0 - 10, t.x1 + 4);
    f.gy = rnd(t.y0 - 6, t.y1 + 10);
    f.y = initial ? rnd(t.y0 - 50, f.gy) : t.y0 - rnd(30, 60);
    f.vy = (9 + f.z * 15) * SPD;
    f.ph = rnd(0, 6.28); f.sw = rnd(0.6, 1.6); f.amp = rnd(3, 8);
    f.sz = f.z > 0.8 ? 3 : f.z > 0.4 ? 2 : 1;
    f.rest = -1; f.off = false; f.offT = 0; f.age = initial ? 1 : 0;
    return f;
  }
  function updateSnow(g, ps, dt, t) {
    for (const f of ps.flakes) {
      f.age += dt;
      if (f.rest >= 0) { f.rest += dt; if (f.rest > 1.2) spawnFlake(g, f, false); continue; }
      f.y += f.vy * dt;
      f.x += (5 * SPD * (0.5 + f.z) + Math.sin(t * f.sw + f.ph) * f.amp) * dt;
      if (f.off) { f.offT += dt; if (f.offT > 3) spawnFlake(g, f, false); continue; }
      if (f.y >= f.gy) {
        if (onTop(g, f.x, f.y)) { f.rest = 0; f.y = f.gy; }
        else { f.off = true; f.offT = 0; }
      }
    }
  }
  /* Drawn over the darkness so flakes stay readable; they take half the sky tint. */
  const snowCols = {};
  function snowColors(sky) {
    if (snowCols.key === sky.key) return snowCols;
    const m = CO.mix('#ffffff', sky.mul, 0.5);
    const mulc = (c) => { const a = rgb(c), b = rgb(m); return CO.rgbToHex(a[0] * b[0] / 255, a[1] * b[1] / 255, a[2] * b[2] / 255); };
    snowCols.key = sky.key; snowCols.hi = mulc('#ffffff'); snowCols.main = mulc('#eef4fa'); snowCols.sh = mulc('#94a6c8');
    return snowCols;
  }
  function drawSnow(ctx, ps, sky) {
    const C = snowColors(sky);
    const night = 1 - 0.3 * sky.n;
    for (const f of ps.flakes) {
      let a = Math.min(1, f.age / 0.6);
      if (f.rest >= 0) a *= 1 - f.rest / 1.2;
      if (f.off) a *= (1 - f.offT / 3) * night;
      if (a <= 0.03) continue;
      const x = Math.round(f.x), y = Math.round(f.y);
      ctx.globalAlpha = a;
      if (f.sz === 1 || f.rest >= 0) { ctx.fillStyle = C.main; ctx.fillRect(x, y, 1, 1); }
      else if (f.sz === 2) { ctx.fillStyle = C.main; ctx.fillRect(x, y, 2, 2); ctx.fillStyle = C.sh; ctx.fillRect(x + 1, y + 1, 1, 1); ctx.fillStyle = C.hi; ctx.fillRect(x, y, 1, 1); }
      else { ctx.fillStyle = C.sh; ctx.fillRect(x - 1, y + 1, 3, 1); ctx.fillStyle = C.main; ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); ctx.fillStyle = C.hi; ctx.fillRect(x, y, 1, 1); }
    }
    ctx.globalAlpha = 1;
  }

  /* Summer-night fireflies hover over open ground, never paths or buildings. */
  function initFlies(g, ps) {
    ps.flies = [];
    const r = S.islands[g.id];
    const n = Math.round((g.id === 'market' ? 4 : g.id === 'mine' ? 6 : 12) * PART);
    let guard = 0;
    while (ps.flies.length < n && guard++ < 600) {
      const tx = r.x + ((Math.random() * r.w) | 0), ty = r.y + ((Math.random() * r.h) | 0);
      if (!S.isFree(tx, ty)) continue;
      const ax = tx * TILE + rnd(0, 16), ay = ty * TILE + rnd(0, 16);
      if (!onTop(g, ax, ay)) continue;
      ps.flies.push({ ax, ay, ph: rnd(0, 6.28), sp: rnd(0.7, 1.4), rx: rnd(6, 14), ry: rnd(4, 8) });
    }
  }
  function drawFlies(ctx, ps, t, k) {
    const tt = t * SPD;
    for (const f of ps.flies) {
      const b0 = Math.sin(tt * 1.3 * f.sp + f.ph);
      const b = b0 > 0 ? b0 * b0 : 0;
      const x = Math.round(f.ax + Math.sin(tt * 0.45 * f.sp + f.ph) * f.rx + Math.sin(tt * 1.1 + f.ph * 2) * 2);
      const y = Math.round(f.ay + Math.sin(tt * 0.7 * f.sp + f.ph * 1.7) * f.ry);
      const a = (0.25 + 0.75 * b) * k;
      if (a < 0.03) continue;
      ctx.globalAlpha = a * 0.3;
      ctx.fillStyle = '#c8f25a';
      ctx.fillRect(x - 2, y, 1, 1); ctx.fillRect(x + 2, y, 1, 1); ctx.fillRect(x, y - 2, 1, 1); ctx.fillRect(x, y + 2, 1, 1);
      ctx.globalAlpha = a * 0.65;
      ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fbffd0';
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  function updateSeason(g, ps, dt, t, season) {
    if (season !== ps.season) {
      ps.season = season;
      ps.leaves = []; ps.flakes = []; ps.flies = [];
      const area = ((g.top.x1 - g.top.x0) * (g.top.y1 - g.top.y0)) / 10000;   // ~9 for a biome island
      if (season === 'autumn' || season === 'spring') {
        const n = Math.round(area * 2.2 * (LEAFY[g.id] || 1) * PART);
        for (let i = 0; i < n; i++) ps.leaves.push(spawnLeaf(g, {}, season, true));
      } else if (season === 'winter') {
        const n = Math.round(area * 8 * PART);
        for (let i = 0; i < n; i++) ps.flakes.push(spawnFlake(g, {}, true));
      }
    }
    if (ps.leaves.length) updateLeaves(g, ps, dt, t, season);
    if (ps.flakes.length) updateSnow(g, ps, dt, t);
  }

  /* ============================================================ LAYERS */
  /** Visible world rect (native px, clamped), so full-screen composites skip off-camera pixels. */
  function viewRect() {
    const c = S.canvas;
    if (!c || !S.screenToWorld) return { x: 0, y: 0, w: W, h: H };
    const a = S.screenToWorld(0, 0), b = S.screenToWorld(c.clientWidth || W, c.clientHeight || H);
    const x0 = Math.max(0, Math.floor(a.x) - 2), y0 = Math.max(0, Math.floor(a.y) - 2);
    const x1 = Math.min(W, Math.ceil(b.x) + 2), y1 = Math.min(H, Math.ceil(b.y) + 2);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: W, h: H };
  }
  const boxVisible = (g, v) => g.box.x < v.x + v.w && g.box.x + g.box.w > v.x && g.box.y - 4 < v.y + v.h && g.box.y + g.box.h + 4 > v.y;

  // Per-frame shared state, computed by whichever of our layers runs first.
  let sky = skyNow(), frameAt = -1, view = { x: 0, y: 0, w: W, h: H }, dim = false;
  function frame(t) {
    if (S.frame === frameAt) return;
    frameAt = S.frame;
    sky = skyNow();
    view = viewRect();
    dim = sky.mul !== '#ffffff' || sky.la > 0.002;
    if (dim) collectLights(sky, t);
  }
  /** Public, read-only-ish hooks: the current sky (multiply tint, veil, night
   * amount) for modules that want to dim their own art out in space, the
   * weather records, and strike(id) for an on-demand lightning bolt on a stormy
   * island (ignored with reduced motion or clear weather). */
  S.atmo = {
    sky: () => sky,
    weather: WX,
    strike(id) {
      const w = WX[id];
      if (RM || !w || w.storm < 0.5) return false;
      w.flashT = 0; w.bolt = makeBolt(w);
      return true;
    },
  };

  // 500: cloud wisps out in space (not island-bound; they slip behind the islands).
  S.registerDynamic(500, (ctx, t, dt) => {
    frame(t);
    const t0 = prof ? performance.now() : 0;
    drawWisps(ctx, dt || 0, sky);
    if (prof) prof.w500 += performance.now() - t0;
  });

  // 600: a faint cool night tint over everything (space included, kept subtle).
  S.registerDynamic(600, (ctx, t) => {
    frame(t);
    const k = smooth(0.25, 1, sky.n);
    if (k < 0.01) return;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = CO.mix('#ffffff', '#d3d6f0', k);
    ctx.fillRect(view.x, view.y, view.w, view.h);
    ctx.globalCompositeOperation = 'source-over';
  });

  for (const id of S.ISLANDS) {
    // 500 {island}: weather under the dark + season particles.
    S.registerDynamic(500, (ctx, t, dt) => {
      frame(t);
      const t0 = prof ? performance.now() : 0;
      dt = dt || 0;
      const g = geo(id);
      const lv = levelOf(id);
      if (lv !== 'ok' || WX[id]) { const w = wxFor(id); updateWeather(w, dt, t); if (boxVisible(g, view)) drawWeatherUnder(ctx, w, t, sky); }
      const season = S.time.season || 'autumn';
      const ps = psFor(id);
      updateSeason(g, ps, dt, t, season);
      if (boxVisible(g, view)) {
        if (ps.leaves.length) drawLeaves(ctx, ps, t, season, sky);
      }
      if (prof) prof.w500 += performance.now() - t0;
    }, { island: id });

    // 600 {island}: darkness with light holes, then weather and fireflies over the dark.
    S.registerDynamic(600, (ctx, t) => {
      frame(t);
      const t0 = prof ? performance.now() : 0;
      const g = geo(id);
      if (!boxVisible(g, view)) return;
      if (dim) {
        const r0 = prof ? performance.now() : 0;
        darkFor(g, sky);
        if (prof) prof.darkMs = (prof.darkMs || 0) + performance.now() - r0;
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(g.mulC, g.box.x, g.box.y);
        ctx.globalCompositeOperation = 'source-over';
        if (g.hasVeil) ctx.drawImage(g.liftC, g.box.x, g.box.y);
      }
      if (WX[id]) drawWeatherOver(ctx, WX[id], sky);
      const ps = PS[id];
      if (ps && ps.flakes.length) drawSnow(ctx, ps, sky);
      if (S.time.season === 'summer' && sky.n > 0.35) {
        const ps = psFor(id);
        if (!ps.flies.length) initFlies(g, ps);
        drawFlies(ctx, ps, t, smooth(0.35, 0.8, sky.n));
      }
      if (prof) { prof.w600 += performance.now() - t0; if (id === 'square') prof.frames++; }
    }, { island: id });
  }
})();
