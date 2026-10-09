/* The Shack v2: the five floating island bases, their paths and scattered decor.
 *
 * Owns (see WORLD_SPEC.md):
 *   static 0    island bases: an organic walkable top inside each island rect
 *               (themed, seasonal turf with a grassy lip and a cliff rim lit from
 *               the top-left) and a rocky underside that tapers to jagged points,
 *               with strata, hanging roots and embedded glowing crystals
 *   static 10   paths along every walk edge in S.nav.edges, styled per island,
 *               plus the cobbled Clockspire plaza
 *   static 50   scattered decor on S.isFree tiles (trees, bushes, rocks, flowers,
 *               leaves and each island's own flora)
 *   dyn 400     crystal sparkles and swaying roots (one layer per island)
 *   dyn 700     crystal / neon / glow-shroom glow once it gets dark (per island)
 *
 * Nothing here is landmark-specific: buildings, docks and waterfalls belong to
 * the island content modules. Everything static stays inside S.islandBox(id).
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S || !S.islands) return;

  const T = S.TILE, W = S.W, H = S.H, COLS = S.COLS, ROWS = S.ROWS;
  const P = S.PAL, CO = S.color, sh = CO.shade, mix = CO.mix, hash = S.hash;
  const RGBC = {};
  const rgb = (h) => RGBC[h] || (RGBC[h] = CO.hexToRgb(h));
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
  const R = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const D = (c, x, y, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), 1, 1); };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const OUT = '#120d1c'; // silhouette outline against space

  /* ------------------------------------------------------------ noise */
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bay = (x, y) => (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
  const smooth = (t) => t * t * (3 - 2 * t);
  function vnoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = smooth(x - xi), v = smooth(y - yi);
    const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const fbm = (x, y, s) => vnoise(x, y, s) * 0.6 + vnoise(x * 2.13, y * 2.13, s + 7) * 0.28 + vnoise(x * 4.7, y * 4.7, s + 13) * 0.12;
  /** Smooth noise sampled from a quarter-res grid over the whole world (cheap per pixel). */
  function noiseField(scale, seed) {
    const gw = (W >> 2) + 2, gh = (H >> 2) + 2, g = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) g[j * gw + i] = fbm((i * 4) / scale, (j * 4) / scale, seed);
    return (x, y) => {
      const fx = clamp(x, 0, W) / 4, fy = clamp(y, 0, H) / 4, i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * gw + i;
      const a = g[k], b = g[k + 1], c = g[k + gw], d = g[k + gw + 1];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }
  let NF = null;
  const fields = () => NF || (NF = { n1: noiseField(58, 11), n2: noiseField(17, 23), n3: noiseField(34, 37), n4: noiseField(12, 43) });

  let season = S.time.season || 'autumn';
  const isWinter = () => season === 'winter';

  /* ======================================================================
   * Geometry (season independent, computed at load so lights can register)
   * ==================================================================== */
  const SEED = { square: 3, monastery: 17, market: 29, port: 41, mine: 53 };
  const CLIFF = 6; // soil band under the grass lip, px
  const GEO = {};

  function buildGeo(id) {
    const r = S.islands[id], box = S.islandBox(id), s = SEED[id];
    const bw = box.w, bh = box.h, ox = box.x, oy = box.y, N = bw * bh;
    const X0 = r.x * T - ox, Y0 = r.y * T - oy, X1 = (r.x + r.w) * T - ox, Y1 = (r.y + r.h) * T - oy;
    const top = new Uint8Array(N);
    // Distance (px, Chebyshev, capped) to the nearest path tile of this island.
    const RD = 18, rdist = new Uint8Array(N).fill(RD);
    for (let ty = r.y; ty < r.y + r.h; ty++) for (let tx = r.x; tx < r.x + r.w; tx++) {
      if (!S.onRoad(tx, ty)) continue;
      // only path ends that reach the rim (docks) grow a little peninsula
      if (tx > r.x + 1 && tx < r.x + r.w - 2 && ty > r.y + 1 && ty < r.y + r.h - 2) continue;
      const x0 = tx * T - ox, y0 = ty * T - oy;
      for (let y = Math.max(0, y0 - RD); y < Math.min(bh, y0 + T + RD); y++) for (let x = Math.max(0, x0 - RD); x < Math.min(bw, x0 + T + RD); x++) {
        const dd = Math.max(x < x0 ? x0 - x : x >= x0 + T ? x - x0 - T + 1 : 0, y < y0 ? y0 - y : y >= y0 + T ? y - y0 - T + 1 : 0);
        const i = y * bw + x; if (dd < rdist[i]) rdist[i] = dd;
      }
    }
    // Organic top: a rounded rectangle inset from the rect, pushed around by noise.
    const cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2, inset = 14, rad = 92;
    const hx = (X1 - X0) / 2 - inset, hy = (Y1 - Y0) / 2 - inset;
    for (let y = Y0 + 1; y < Y1 - 1; y++) for (let x = X0 + 1; x < X1 - 1; x++) {
      const gx = x + ox, gy = y + oy;
      const qx = Math.abs(x + 0.5 - cx) - (hx - rad), qy = Math.abs(y + 0.5 - cy) - (hy - rad);
      const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
      // big lobes and bays, then mid wobble, then a ragged pixel fringe
      const ang = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
      const lobe = Math.sin(ang * 3 + s) * 6 + Math.sin(ang * 5 + s * 1.7) * 4;
      const n = lobe + (fbm(gx / 40, gy / 40, s) - 0.5) * 40 + (vnoise(gx / 9, gy / 9, s + 5) - 0.5) * 9 + (hash(gx >> 1, gy >> 1, s + 9) - 0.5) * 2.4;
      const bonus = Math.max(0, RD - rdist[y * bw + x]) * 0.9;
      if (sd + n - bonus < 0) top[y * bw + x] = 1;
    }
    // Paths, landmarks and nav nodes always stand on solid ground.
    const fillTile = (tx, ty) => {
      for (let y = ty * T - oy; y < (ty + 1) * T - oy; y++) for (let x = tx * T - ox; x < (tx + 1) * T - ox; x++)
        if (x >= 0 && y >= 0 && x < bw && y < bh) top[y * bw + x] = 1;
    };
    for (let ty = r.y; ty < r.y + r.h; ty++) for (let tx = r.x; tx < r.x + r.w; tx++) if (S.onRoad(tx, ty)) fillTile(tx, ty);
    for (const k in S.landmarks) { const L = S.landmarks[k]; if (L.island === id) fillTile(L.x, L.y); }
    for (const k in S.nav.nodes) if (S.nav.island[k] === id) fillTile(S.nav.nodes[k][0], S.nav.nodes[k][1]);
    // Tidy the edge: no 1-px spurs or pinholes.
    for (let pass = 0; pass < 3; pass++) for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
      const i = y * bw + x, n = top[i - 1] + top[i + 1] + top[i - bw] + top[i + bw];
      if (top[i] && n < 2) top[i] = 0; else if (!top[i] && n >= 3) top[i] = 1;
    }
    // Keep only the main landmass: flood-fill (4-connected) from this island's nav
    // nodes and landmarks and drop every top pixel the fill never reaches, so the
    // noisy mask can't leave crumbs of rim and cliff floating off the edge in space.
    {
      const seen = new Uint8Array(N), stack = [];
      const seed = (tx, ty) => {
        const x = tx * T - ox + (T >> 1), y = ty * T - oy + (T >> 1), i = y * bw + x;
        if (x >= 0 && y >= 0 && x < bw && y < bh && top[i] && !seen[i]) { seen[i] = 1; stack.push(i); }
      };
      for (const k in S.nav.nodes) if (S.nav.island[k] === id) seed(S.nav.nodes[k][0], S.nav.nodes[k][1]);
      for (const k in S.landmarks) { const L = S.landmarks[k]; if (L.island === id) seed(L.x, L.y); }
      if (stack.length) {
        while (stack.length) {
          const i = stack.pop(), x = i % bw;
          if (x > 0 && top[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
          if (x < bw - 1 && top[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
          if (i >= bw && top[i - bw] && !seen[i - bw]) { seen[i - bw] = 1; stack.push(i - bw); }
          if (i + bw < N && top[i + bw] && !seen[i + bw]) { seen[i + bw] = 1; stack.push(i + bw); }
        }
        for (let i = 0; i < N; i++) if (top[i] && !seen[i]) top[i] = 0;
      }
    }
    // Manhattan distance from the edge, inside the top (capped).
    const din = new Uint8Array(N);
    for (let i = 0; i < N; i++) din[i] = top[i] ? 60 : 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = y * bw + x; if (!din[i]) continue;
      din[i] = Math.min(din[i], x > 0 ? din[i - 1] + 1 : 1, y > 0 ? din[i - bw] + 1 : 1);
    }
    for (let y = bh - 1; y >= 0; y--) for (let x = bw - 1; x >= 0; x--) {
      const i = y * bw + x; if (!din[i]) continue;
      din[i] = Math.min(din[i], x < bw - 1 ? din[i + 1] + 1 : 1, y < bh - 1 ? din[i + bw] + 1 : 1);
    }
    // Columns.
    const botY = new Int16Array(bw).fill(-1), topY = new Int16Array(bw).fill(-1);
    let xa = bw, xb = -1, sumB = 0, nB = 0;
    for (let x = 0; x < bw; x++) for (let y = 0; y < bh; y++) if (top[y * bw + x]) { if (topY[x] < 0) topY[x] = y; botY[x] = y; }
    for (let x = 0; x < bw; x++) if (botY[x] >= 0) { xa = Math.min(xa, x); xb = Math.max(xb, x); sumB += botY[x]; nB++; }
    const meanBot = sumB / Math.max(1, nB);
    // Underside: a bowl plus a main spike and a few smaller ones, jagged.
    const rnd = S.rng(s * 977 + 13);
    const half = (xb - xa) / 2, xc = xa + half + (rnd() - 0.5) * half * 0.3;
    const Dp = r.depth * T;
    const spikes = [{ c: xc + (rnd() - 0.5) * half * 0.12, w: half * 0.32, h: Dp * 0.3 }];
    const nsec = 2 + ((rnd() * 2) | 0);
    for (let i = 0; i < nsec; i++) {
      const side = i % 2 ? 1 : -1;
      spikes.push({ c: xc + side * half * (0.3 + rnd() * 0.42), w: half * (0.09 + rnd() * 0.09), h: Dp * (0.16 + rnd() * 0.24) });
    }
    const U = new Int16Array(bw).fill(-1), maxU = bh - 14;
    for (let x = xa; x <= xb; x++) {
      if (botY[x] < 0) continue;
      const t = Math.min(1, Math.abs(x + 0.5 - xc) / (half * 1.03));
      const bowl = Dp * (0.56 * Math.pow(1 - t, 1.5) + 0.2 * (1 - t * t));
      let sp = 0;
      for (const k of spikes) { const tt = 1 - Math.abs(x + 0.5 - k.c) / k.w; if (tt > 0) sp = Math.max(sp, k.h * Math.pow(tt, 1.3)); }
      const cell = Math.floor((x + s) / 5), pos = ((x + s) % 5) / 4, amp = 1 + hash(cell, 0, s) * 4;
      const jag = (1 - Math.abs(2 * pos - 1)) * amp * Math.min(1, (bowl + sp) / 12) + (hash(x, 1, s) < 0.25 ? 1 : 0);
      U[x] = Math.min(maxU, Math.round(botY[x] + CLIFF + bowl + sp + jag));
    }
    const under = new Uint8Array(N);
    for (let x = xa; x <= xb; x++) for (let y = botY[x] + 1; y <= U[x]; y++) { const i = y * bw + x; if (!top[i]) under[i] = 1; }
    // Rim: 2 px of cliff on the west/east sides, 1 px along the north edge.
    const rim = new Uint8Array(N);
    for (let y = 1; y < bh - 1; y++) for (let x = 2; x < bw - 2; x++) {
      const i = y * bw + x; if (!top[i] || din[i] > 3) continue;
      for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 0; dy++) {
        const j = (y + dy) * bw + x + dx;
        if (top[j] || under[j] || rim[j]) continue;
        rim[j] = dy < 0 && dx === 0 ? 3 : dx < 0 ? 1 : dx > 0 ? 2 : 3;
      }
    }
    const solid = (i) => top[i] || under[i] || rim[i];
    const out = new Uint8Array(N);
    for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
      const i = y * bw + x; if (solid(i)) continue;
      if (solid(i - 1) || solid(i + 1) || solid(i - bw) || solid(i + bw)) out[i] = 1;
    }
    const g = { id, r, s, bw, bh, ox, oy, X0, Y0, X1, Y1, top, din, under, rim, out, botY, topY, U, xa, xb, xc, half, meanBot, Dp, rnd };
    g.roots = makeRoots(g);
    g.crystals = makeCrystals(g);
    return g;
  }

  function makeRoots(g) {
    const { xa, xb, xc, half, botY, U, bh, rnd } = g;
    const roots = [];
    const nCliff = Math.round((xb - xa) / 8);
    for (let i = 0; i < nCliff; i++) {
      const x = Math.round(xa + 5 + rnd() * (xb - xa - 10));
      if (botY[x] < 0) continue;
      const y0 = botY[x] + 2 + ((rnd() * 3) | 0);
      let len = 4 + ((rnd() * 11) | 0);
      len = Math.min(len, U[x] - 2 - y0);
      if (len >= 3) roots.push({ x, y0, len, ph: rnd() * 6.28, kind: 'cliff' });
    }
    const nDang = Math.round((xb - xa) / 11);
    for (let i = 0; i < nDang; i++) {
      const side = i % 2 ? 1 : -1;
      const x = Math.round(xc + side * half * (0.3 + rnd() * 0.62));
      if (x < xa + 2 || x > xb - 2 || U[x] < 0) continue;
      const y0 = U[x] - 1 - ((rnd() * 3) | 0);
      const len = Math.min(5 + ((rnd() * 15) | 0), bh - 3 - y0);
      if (len >= 4) roots.push({ x, y0, len, ph: rnd() * 6.28, kind: 'dangle', dyn: false });
    }
    // The longest few sway (drawn every frame instead of into the static layer).
    roots.filter((q) => q.kind === 'dangle' && q.len >= 10).sort((a, b) => b.len - a.len).slice(0, 3).forEach((q) => { q.dyn = true; });
    return roots;
  }

  /* Crystal colours: outline, dark face, base, light face, glint, glow. */
  const CRY = {
    cyan:   { o: '#0b2a3c', d: '#1b7495', b: '#3ec8e8', l: '#a8f4ff', w: '#ffffff', glow: '#5fe6ff' },
    violet: { o: '#1d1040', d: '#5531a3', b: '#9b6bff', l: '#d6c4ff', w: '#ffffff', glow: '#b48cff' },
    gold:   { o: '#3a2408', d: '#a8741e', b: '#f2c94c', l: '#fff0a8', w: '#ffffff', glow: '#ffd76a' },
    pink:   { o: '#3a0c28', d: '#a82a6c', b: '#ff4fa3', l: '#ffbadc', w: '#ffffff', glow: '#ff7fc0' },
    teal:   { o: '#0a2e2c', d: '#1a8476', b: '#3fe0c0', l: '#b4fff0', w: '#ffffff', glow: '#5ff0d0' },
    amber:  { o: '#3a1a08', d: '#a8521e', b: '#f08a3a', l: '#ffd2a2', w: '#ffffff', glow: '#ffa860' },
  };
  const HUES = { square: ['gold', 'cyan', 'gold', 'cyan'], monastery: ['cyan', 'teal', 'cyan'], market: ['violet', 'pink', 'violet'], port: ['teal', 'cyan', 'teal'], mine: ['gold', 'amber', 'gold'] };

  function makeCrystals(g) {
    const { bw, xa, xb, xc, half, botY, U, under, rnd, id } = g;
    const hues = HUES[id], list = [];
    const want = 6 + ((rnd() * 2) | 0);
    for (let tries = 0; list.length < want && tries < 400; tries++) {
      const x = Math.round(xc + (rnd() * 2 - 1) * half * 0.78);
      if (x < xa + 6 || x > xb - 6 || U[x] < 0) continue;
      const y0 = botY[x] + CLIFF + 5, y1 = U[x] - 18;
      if (y1 <= y0) continue;
      const y = Math.round(y0 + rnd() * (y1 - y0));
      let ok = true;
      for (let dy = -2; dy <= 16 && ok; dy += 2) for (let dx = -5; dx <= 5 && ok; dx++) if (!under[(y + dy) * bw + x + dx]) ok = false;
      if (!ok || list.some((c) => Math.abs(c.x - x) < 16 && Math.abs(c.y - y) < 16)) continue;
      list.push({ x, y, hue: hues[list.length % hues.length], n: 2 + ((rnd() * 2) | 0), size: 8 + ((rnd() * 6) | 0), seed: rnd() * 10, tip: false });
    }
    // A big crystal hanging off the lowest point of the underside.
    let xt = xa;
    for (let x = xa; x <= xb; x++) if (U[x] > U[xt]) xt = x;
    list.push({ x: xt, y: U[xt] - 5, hue: hues[0], n: 3, size: 13, seed: rnd() * 10, tip: true });
    return list;
  }

  for (const id of S.ISLANDS) GEO[id] = buildGeo(id);

  // A few crystals per island light up the dark.
  for (const id of S.ISLANDS) {
    const g = GEO[id];
    const lit = g.crystals.filter((c) => c.tip).concat(g.crystals.filter((c) => !c.tip).sort((a, b) => b.size - a.size).slice(0, 2));
    for (const c of lit) S.addLight({ x: g.ox + c.x, y: g.oy + c.y + (c.tip ? 6 : 4), r: c.tip ? 26 : 18, color: CRY[c.hue].glow, intensity: c.tip ? 0.7 : 0.5, flicker: 0.04, island: id });
  }

  /* ======================================================================
   * Palettes
   * ==================================================================== */
  const TURF = {
    square:    { spring: ['#72b04c', '#56903a'], summer: ['#5fa041', '#47802f'], autumn: ['#8f9a45', '#6f7a35'] },
    monastery: { spring: ['#5f9f66', '#457f52'], summer: ['#4f8f5e', '#386f48'], autumn: ['#7b8a52', '#5c6c40'] },
    market:    { spring: ['#644a7e', '#4a3462'], summer: ['#5a4274', '#432f5a'], autumn: ['#64456c', '#4a3052'] },
    port:      { spring: ['#8cba5c', '#6c9844'], summer: ['#87a853', '#698a40'], autumn: ['#a4a556', '#838640'] },
    mine:      { spring: ['#b2a254', '#8f803f'], summer: ['#c09b4f', '#9a783b'], autumn: ['#bb8c49', '#956b37'] },
  };
  const SNOWTINT = { square: null, monastery: '#cfe0f2', market: '#d2c2f2', port: null, mine: '#f0dcc2' };

  function groundPal(id, sea) {
    const C = rgb, p = {};
    if (sea === 'winter') {
      const tint = SNOWTINT[id];
      const tn = (c, a) => (tint ? mix(c, tint, a) : c);
      const base = tn('#e3ebf1', 0.3), dark = tn('#c6d3dc', 0.35), light = tn('#f4f8fb', 0.15);
      Object.assign(p, { base: C(base), dark: C(dark), mid: C(mix(base, dark, 0.5)), light: C(light), deep: C(tn('#a9bccb', 0.35)), spark: C('#ffffff') });
      const turf = TURF[id].autumn;
      p.poke = C(mix(turf[1], dark, 0.5)); p.pokeL = C(mix(turf[0], dark, 0.65));
      p.lipL = C('#ffffff'); p.lipD = C(tn('#9fb3c4', 0.35));
      p.tuftD = C(tn('#a7b8c6', 0.3)); p.tuftL = C('#f7fbfd');
    } else {
      const [base, dark] = TURF[id][sea] || TURF[id].autumn;
      Object.assign(p, { base: C(base), dark: C(dark), mid: C(mix(base, dark, 0.5)), light: C(sh(base, 0.14)), deep: C(sh(dark, -0.18)), spark: C(sh(base, 0.26)) });
      p.lipL = C(sh(base, 0.3)); p.lipD = C(sh(dark, -0.28));
      p.tuftD = p.deep; p.tuftL = C(sh(base, 0.22));
    }
    if (id === 'square') p.stripe = sea === 'winter' ? C('#edf3f7') : C(mix(TURF.square[sea] ? TURF.square[sea][0] : '#8f9a45', '#ffffff', 0.09));
    if (id === 'monastery') {
      const heat = sea === 'autumn' ? ['#a8643a', '#c98a4a', '#7a4a2c'] : sea === 'spring' ? ['#9a7ab8', '#c4a8dc', '#6f5590'] : ['#8c5f94', '#b07fb6', '#63436c'];
      p.heath = heat.map(C); p.rock = ['#9a9ca6', '#c3c5cc', '#6c6e7a', '#4f515c'].map(C);
    }
    if (id === 'market') { p.cy = C('#3ef0ff'); p.pk = C('#ff6ac0'); p.moss = C(sea === 'winter' ? '#b6a8d6' : mix(TURF.market[sea] ? TURF.market[sea][1] : '#4a3052', '#1a1028', 0.35)); }
    if (id === 'port') {
      const sand = sea === 'winter' ? ['#e8e2d2', '#cfc4a8', '#f6f2e8', '#b3a682'] : ['#dcc890', '#bba46c', '#ece0b0', '#a08a58'];
      p.sand = sand.map(C);
    }
    if (id === 'mine') {
      p.rock = ['#9a8a76', '#b9a993', '#76685a', '#5a4e44'].map(C); p.crack = C('#6a4a2c');
      p.dry = C(sea === 'winter' ? '#c9b48a' : '#d8bf6c');
    }
    return p;
  }

  const ROCK = {
    square:    { rock: ['#bba78c', '#9f8c73', '#83735f', '#685b4b', '#4e4439', '#37302a'], soil: ['#8a6440', '#6e4c30', '#4f3622'], vein: '#e2d4b8' },
    monastery: { rock: ['#a7adbd', '#8a90a4', '#6f758b', '#575c74', '#41455d', '#2d3045'], soil: ['#6e5a44', '#56442f', '#3d3022'], vein: '#d8dde8' },
    market:    { rock: ['#8e6ea2', '#735787', '#5c426f', '#463257', '#332442', '#22172f'], soil: ['#5a4258', '#433044', '#2e2030'], vein: '#ff6ac0' },
    port:      { rock: ['#e3c792', '#ccab78', '#b08f61', '#92734c', '#73593a', '#56432c'], soil: ['#9a7a4e', '#7b5f3c', '#5c462c'], vein: '#f8eedc' },
    mine:      { rock: ['#cf8f5e', '#b17449', '#935c39', '#75482d', '#593622', '#3e2618'], soil: ['#8a5a34', '#6b4428', '#4c301c'], vein: '#ffd27a' },
  };
  const ROOTC = { l: '#b48c5c', b: '#8a6440', d: '#5a3d26', k: '#3e2a1a' };

  /* ======================================================================
   * static 0: island bases
   * ==================================================================== */
  function groundPx(id, p, x, y, F) {
    const winter = season === 'winter';
    const b = bay(x, y);
    const n = F.n1(x, y) * 0.7 + F.n2(x, y) * 0.3;
    const v = n + (b - 0.5) * 0.14;
    let c = v > 0.71 ? p.dark : v > 0.6 ? p.mid : v < 0.29 ? p.light : p.base;
    if (v > 0.78 && b < 0.3) c = p.deep;
    const hs = hash(x, y, 21);
    if (hs < 0.03) c = p.dark; else if (hs < 0.042) c = p.spark;
    const n3 = F.n3(x, y), n4 = F.n4(x, y);
    if (winter) {
      // Theme peeks through thin snow.
      if (n3 > 0.76 && b < (n3 - 0.76) * 3.5 && hash(x, y, 5) < 0.7) c = hash(x, y, 6) < 0.4 ? p.pokeL : p.poke;
      if (id === 'market' && hash(x, y, 33) < 0.0035) c = hash(x, y, 34) < 0.5 ? p.cy : p.pk;
      return c;
    }
    if (id === 'square') {
      // Neatly mown diagonal stripes.
      const st = Math.floor((x - y * 0.5 + 4000) / 12) & 1;
      if (st && (c === p.base || c === p.light)) c = p.stripe;
      if (hash(x >> 1, y >> 1, 77) < 0.006) c = rgb('#f4f1e6'); // daisies
    } else if (id === 'monastery') {
      if (n3 > 0.66 && b < (n3 - 0.66) * 6) { const k = hash(x, y, 6); c = k < 0.45 ? p.heath[0] : k < 0.7 ? p.heath[1] : p.heath[2]; }
      if (n4 > 0.78) { // rock showing through the turf, lit top-left
        const e = F.n4(x - 2, y - 2) < 0.78, e2 = F.n4(x + 2, y + 2) < 0.78;
        c = e ? p.rock[1] : e2 ? p.rock[3] : hash(x, y, 8) < 0.15 ? p.rock[2] : p.rock[0];
      }
    } else if (id === 'market') {
      if (n3 > 0.62 && b < (n3 - 0.62) * 3.2) c = p.moss;
      const hk = hash(x, y, 33);
      if (hk < 0.005) c = hash(x, y, 34) < 0.5 ? p.cy : p.pk;
    } else if (id === 'port') {
      if (n3 > 0.6) {
        const e = n3 < 0.64;
        c = e ? (b < 0.5 ? p.sand[0] : c) : hash(x, y, 9) < 0.1 ? p.sand[1] : b < 0.08 ? p.sand[2] : p.sand[0];
        if (!e && hash(x, y, 10) < 0.0025) c = rgb(hash(x, y, 11) < 0.5 ? '#fff4ec' : '#f2a7b8'); // shells
      }
    } else if (id === 'mine') {
      const sl = (u, w) => F.n4(u * 0.5 + 300, w * 0.5 + 40);
      if (sl(x, y) > 0.74 && n3 > 0.4) { // flat slabs of bedrock
        const e = sl(x - 2, y - 2) < 0.74, e2 = sl(x + 2, y + 2) < 0.74;
        c = e ? p.rock[1] : e2 ? p.rock[3] : hash(x, y, 12) < 0.14 ? p.rock[2] : p.rock[0];
      } else if (n3 > 0.62 && b < (n3 - 0.62) * 5) c = p.dark;
      else if (hash(x, y, 14) < 0.025) c = p.dry;
      if (n3 < 0.4) { // sun-baked earth, cracked into plates
        const ccx = Math.floor(x / 11), ccy = Math.floor(y / 9);
        let b1 = 1e9, b2 = 1e9;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
          const qx = ccx + i, qy = ccy + j, dx = x - (qx * 11 + hash(qx, qy, 71) * 11), dy = (y - (qy * 9 + hash(qx, qy, 72) * 9)) * 1.2, q = dx * dx + dy * dy;
          if (q < b1) { b2 = b1; b1 = q; } else if (q < b2) b2 = q;
        }
        const gap = Math.sqrt(b2) - Math.sqrt(b1);
        if (gap < 0.9 && n3 < 0.37) c = p.crack; else if (gap < 1.9) c = p.light;
      }
    }
    return c;
  }

  const baseCache = {};
  function buildBase(id, sea) {
    const g = GEO[id], { bw, bh, ox, oy, top, din, under, rim, out, botY, U, xa, xb, xc, half, meanBot, Dp, s } = g;
    const F = fields();
    const cv = mk(bw, bh), c = cv.getContext('2d');
    const img = c.createImageData(bw, bh), d = img.data;
    const set = (i, col) => { const k = i * 4; d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255; };
    const p = groundPal(id, sea), winter = sea === 'winter';
    const RK = ROCK[id], rock = RK.rock.map(rgb), soil = RK.soil.map(rgb), vein = rgb(RK.vein), out1 = rgb(OUT);
    const snow = rgb(P.snow), snowD = rgb('#b9cad8');
    const moss = winter ? null : rgb(id === 'market' ? '#3a2a4c' : TURF[id][sea] ? TURF[id][sea][1] : TURF[id].autumn[1]);

    // Walkable top.
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      if (!top[i]) continue;
      const gx = x + ox, gy = y + oy;
      let col = groundPx(id, p, gx, gy, F);
      const dd = din[i];
      if (dd <= 3) {
        const dn = y + dd < bh && !top[i + dd * bw], up = y - dd >= 0 && !top[i - dd * bw];
        const lf = x - dd >= 0 && !top[i - dd], rt = x + dd < bw && !top[i + dd];
        if (dn || (rt && !up && !lf)) col = dd === 1 ? p.lipD : dd === 2 ? p.deep : (bay(gx, gy) < 0.5 ? p.dark : col);
        else if (up || lf) col = dd === 1 ? p.lipL : dd === 2 ? (bay(gx, gy) < 0.6 ? p.light : p.lipL) : (bay(gx, gy) < 0.35 ? p.light : col);
        if (id === 'port' && !winter && dd <= 3 && (dn || up || lf || rt) && hash(gx, gy, 3) < 0.6) col = dd === 1 ? p.sand[2] : p.sand[0];
      }
      set(i, col);
    }
    // Grass tufts (little three-blade clumps), lit from the top-left.
    for (let cy = 2; cy < bh - 4; cy += 6) for (let cx = 2; cx < bw - 6; cx += 7) {
      const h = hash(cx + ox, cy + oy, 31);
      if (h > (winter ? 0.14 : 0.36)) continue;
      const x = cx + (((h * 997) | 0) % 5), y = cy + (((h * 7919) | 0) % 4);
      if (din[y * bw + x] < 6 || din[(y + 3) * bw + x + 4] < 6) continue;
      const big = h < 0.18;
      const pts = big ? [[2, 0, 1], [0, 1, 0], [2, 1, 0], [4, 1, 0], [1, 2, 0], [2, 2, 0], [3, 2, 0]] : [[1, 0, 1], [0, 1, 0], [1, 1, 0], [2, 1, 0]];
      let dk = p.tuftD, lt = p.tuftL;
      if (id === 'mine' && !winter) { dk = rgb('#8a6a34'); lt = p.dry; }
      if (id === 'market' && !winter) { dk = rgb('#2a1c3a'); lt = rgb('#7a5a96'); }
      for (const [px, py, l] of pts) set((y + py) * bw + x + px, l ? lt : dk);
    }

    // Rocky underside.
    const bandOf = new Int16Array(400), posOf = new Int16Array(400), hOf = new Int16Array(400);
    for (let k = 0, b = 0; k < 400; b++) {
      const bh_ = 4 + ((hash(b, 2, s) * 5) | 0);
      for (let j = 0; j < bh_ && k < 400; j++, k++) { bandOf[k] = b; posOf[k] = j; hOf[k] = bh_; }
    }
    const solidU = (i) => top[i] || under[i];
    const FW = 13, FH = 8;
    for (let x = xa; x <= xb; x++) {
      const bot = botY[x], u = U[x];
      if (bot < 0) continue;
      const gx = x + ox, lx = (x - xc) / half;
      const drip = hash(gx, 7, s) < 0.55 ? 1 + ((hash(gx, 8, s) * 3) | 0) : 0;
      const wob = (vnoise(x / 16, 0.5, s + 31) - 0.5) * 6;
      for (let y = bot + 1; y <= u; y++) {
        const i = y * bw + x;
        if (top[i]) continue;
        const gy = y + oy, k = y - bot, bb = bay(gx, gy);
        if (k <= drip) { set(i, winter ? (k === drip ? snowD : snow) : (k === drip ? p.deep : p.dark)); continue; }
        if (k <= CLIFF) {
          let tf = (k <= 2 ? 0.1 : k === CLIFF ? 2.1 : 0.8) + lx * 0.9 + (bb - 0.5) * 0.9;
          if (hash(gx, gy, s + 4) < 0.1) tf += 0.8;
          if (!solidU(i - 1)) tf -= 1; if (!solidU(i + 1)) tf += 1;
          set(i, soil[clamp(Math.floor(tf + 0.5), 0, 2)]);
          continue;
        }
        const sk = clamp(Math.round(y - (0.7 * bot + 0.3 * meanBot) - CLIFF + wob), 0, 399);
        const band = bandOf[sk], pos = posOf[sk], bH = hOf[sk];
        const df = clamp((y - meanBot - CLIFF) / (Dp * 0.95), 0, 1);
        let tf = 0.25 + df * 3.4 + lx * 1.0 + (band % 3 === 1 ? 0.45 : 0);
        if (pos === 0 && hash(gx >> 3, band, s + 2) < 0.7) tf -= 0.7; else if (pos === bH - 1 && hash(gx >> 2, band, s + 3) < 0.5) tf += 0.8;
        // chunky rock facets (stretched Voronoi), lit from the top-left
        const fcx = Math.floor(gx / FW), fcy = Math.floor(gy / FH);
        let b1 = 1e9, b2 = 1e9, fsx = 0, fsy = 0, fk = 0;
        for (let jj = -1; jj <= 1; jj++) for (let ii = -1; ii <= 1; ii++) {
          const qx = fcx + ii, qy = fcy + jj, px_ = qx * FW + hash(qx, qy, s + 40) * FW, py_ = qy * FH + hash(qx, qy, s + 41) * FH;
          const ddx = gx - px_, ddy = (gy - py_) * 1.5, q = ddx * ddx + ddy * ddy;
          if (q < b1) { b2 = b1; b1 = q; fsx = px_; fsy = py_; fk = hash(qx, qy, s + 42); } else if (q < b2) b2 = q;
        }
        const gap = Math.sqrt(b2) - Math.sqrt(b1);
        tf += (fk - 0.5) * 1.4;
        if (gap < 1.1) tf += 1.9;
        else if (gap < 2.4) tf += (gx - fsx) + (gy - fsy) * 1.3 < 0 ? -0.9 : 0.7;
        const lo = !solidU(i - 1), ro = !solidU(i + 1), dno = !solidU(i + bw);
        if (lo) tf -= 1.3; if (ro || dno) tf += 1.3;
        const hs = hash(gx, gy, s + 6);
        if (hs < 0.04) tf += 1; else if (hs > 0.97) tf -= 1;
        let col = rock[clamp(Math.floor(tf + (bb - 0.5) * 0.9 + 0.5), 0, 5)];
        if (gap > 2.4 && hash(gx, gy, s + 8) < (id === 'mine' ? 0.012 : 0.004)) col = vein; // ore glints / fossils
        if (moss && k < CLIFF + 5 && hash(gx, gy, s + 9) < 0.35 * (1 - (k - CLIFF) / 5) && id !== 'mine') col = moss;
        set(i, col);
      }
    }
    // Cliff rim and outline.
    for (let i = 0; i < bw * bh; i++) {
      const rv = rim[i];
      if (rv) {
        const x = i % bw, y = (i / bw) | 0, b = bay(x + ox, y + oy);
        let col = rv === 1 ? (b < 0.7 ? soil[0] : soil[1]) : rv === 2 ? (b < 0.7 ? soil[2] : soil[1]) : soil[2];
        if (winter && rv !== 2 && b < 0.5) col = snowD;
        set(i, col);
      } else if (out[i]) set(i, out1);
    }
    c.putImageData(img, 0, 0);

    // Roots (the swaying ones are drawn by the dynamic layer).
    for (const q of g.roots) if (!q.dyn) drawRoot(c, q.x, q.y0, q.len, q.ph, 0, q.kind === 'cliff', sea);
    // Icicles under the shelf in winter.
    if (winter) for (let x = xa + 3; x <= xb - 3; x += 3) {
      if (hash(x + ox, 5, s) > 0.4) continue;
      const len = 2 + ((hash(x + ox, 6, s) * 6) | 0), y = U[x] + 1;
      for (let k = 0; k < len && y + k < bh - 1; k++) { D(c, x, y + k, k < len - 1 ? '#e8f6ff' : '#a8d0e8'); if (k < len - 2) D(c, x + 1, y + k, '#a8d0e8'); }
    }
    // Embedded crystals.
    for (const cr of g.crystals) drawCrystal(c, cr, false);
    return cv;
  }

  /** A hanging root: thick at the top, wiggling, lit on its left. sway shifts the tip (px). */
  function drawRoot(c, x, y0, len, ph, sway, cliff, sea) {
    const winter = sea === 'winter';
    for (let k = 0; k < len; k++) {
      const f = k / len;
      const wig = Math.round(Math.sin(k * 0.42 + ph) * 1.1 + sway * Math.pow(f, 1.6));
      const xx = x + wig, yy = y0 + k;
      if (cliff) {
        D(c, xx, yy, k % 4 === 0 ? ROOTC.b : ROOTC.k);
        if (f < 0.4) D(c, xx + 1, yy, ROOTC.d);
      } else {
        D(c, xx, yy, f < 0.85 ? ROOTC.b : ROOTC.d);
        if (f < 0.35) { D(c, xx - 1, yy, ROOTC.l); D(c, xx + 1, yy, ROOTC.d); } else if (f < 0.7) D(c, xx + 1, yy, ROOTC.k);
      }
      if (k === len - 1) {
        if (winter) D(c, xx, yy + 1, '#dff0ff');
        else if (!cliff && (ph * 10 | 0) % 3 === 0) { D(c, xx - 1, yy, sea === 'autumn' ? '#c9862f' : '#6faf4a'); D(c, xx + 1, yy - 1, sea === 'autumn' ? '#e0a93a' : '#8fcf5a'); }
      }
    }
  }

  /** One crystal shard pointing down from (x, y). glow=true draws only its luminous pixels. */
  function shard(c, x, y, len, wide, slope, pal, glow) {
    const hw = wide ? 2 : 1;
    for (let k = 0; k < len; k++) {
      const sx = Math.round(x + slope * k);
      const taper = len - k <= hw ? hw - (len - k) + 1 : 0;
      const l = sx - hw + taper, r = sx + hw - taper;
      for (let xx = l; xx <= r; xx++) {
        let col = xx < sx ? pal.l : xx === sx ? pal.b : pal.d;
        if (xx === l && k >= 1 && k <= 2) col = pal.w;
        if (k === len - 1) col = pal.l;
        if (glow) { if (col === pal.d) col = pal.b; D(c, xx, y + k, col); continue; }
        D(c, xx, y + k, col);
      }
      if (!glow) { D(c, l - 1, y + k, pal.o); D(c, r + 1, y + k, pal.o); }
    }
    if (!glow) D(c, Math.round(x + slope * len), y + len, pal.o);
  }
  function drawCrystal(c, cr, glow) {
    const pal = CRY[cr.hue];
    const offs = cr.tip ? [[-3, -0.28, 0.55], [0, 0, 1], [3, 0.24, 0.66]] : [[-2, -0.3, 0.6], [0, 0.04, 1], [2, 0.32, 0.5]];
    const n = cr.tip ? 3 : cr.n;
    const order = n === 2 ? [0, 1] : [0, 2, 1];
    for (const j of order) {
      const [dx, sl, f] = offs[j];
      const len = Math.max(3, Math.round(cr.size * f));
      shard(c, cr.x + dx, cr.y + (j === 1 ? 0 : 1), len, cr.tip && j === 1, sl, pal, glow);
    }
    if (!glow) { R(c, cr.x - 3, cr.y - 1, 7, 1, pal.o); D(c, cr.x - 4, cr.y, pal.o); D(c, cr.x + 4, cr.y, pal.o); }
  }

  S.registerStatic(0, (ctx) => {
    season = S.time.season || 'autumn';
    for (const id of S.ISLANDS) {
      const key = id + '_' + season;
      if (!baseCache[key]) baseCache[key] = buildBase(id, season);
      const g = GEO[id];
      ctx.drawImage(baseCache[key], g.ox, g.oy);
    }
  });

  /* ======================================================================
   * static 10: paths + the Clockspire plaza
   * ==================================================================== */
  const ORI = new Uint8Array(COLS * ROWS); // 1 = horizontal segment, 2 = vertical
  for (const [, , pts, mode] of S.nav.edges) {
    if (mode && mode !== 'walk') continue;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const o = y0 === y1 ? 1 : 2;
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1) + 1; y++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1) + 1; x++)
          if (x < COLS && y < ROWS) ORI[y * COLS + x] |= o;
    }
  }
  const SQN = S.nav.nodes.SQ || [39, 23];
  const HUBX = (SQN[0] + 1) * T, HUBY = (SQN[1] + 1) * T; // centre of the 2x2 crossing
  const PLAZA = { x0: HUBX - 58, y0: HUBY - 30, x1: HUBX + 58, y1: HUBY + 70, r: 20 };
  function inPlaza(x, y) {
    if (x < PLAZA.x0 || x >= PLAZA.x1 || y < PLAZA.y0 || y >= PLAZA.y1) return false;
    const r = PLAZA.r;
    const cx = x < PLAZA.x0 + r ? PLAZA.x0 + r : x >= PLAZA.x1 - r ? PLAZA.x1 - r - 1 : x;
    const cy = y < PLAZA.y0 + r ? PLAZA.y0 + r : y >= PLAZA.y1 - r ? PLAZA.y1 - r - 1 : y;
    return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
  }
  const STYLE_OF = { square: 'cobble', monastery: 'steps', port: 'plank', market: 'neon', mine: 'gravel' };
  const roadCache = {};
  let neonPts = null; // [x, y, colour] of Neon Hollow's path trim, for the night glow

  function buildRoads(sea) {
    const winter = sea === 'winter';
    const cv = mk(W, H), g = cv.getContext('2d');
    const img = g.createImageData(W, H), d = img.data;
    const M = new Uint8Array(W * H);
    const road = (tx, ty) => S.onRoad(tx, ty) && !!S.islandAt(tx, ty);
    for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
      if (!road(tx, ty)) continue;
      const L = road(tx - 1, ty), Rt = road(tx + 1, ty), Up = road(tx, ty - 1), Dn = road(tx, ty + 1);
      for (let ly = 0; ly < T; ly++) for (let lx = 0; lx < T; lx++) {
        const rr = 4;
        let cut = false;
        if (!L && !Up && lx < rr && ly < rr) cut = (rr - lx) ** 2 + (rr - ly) ** 2 > rr * rr + 1;
        if (!Rt && !Up && lx > 15 - rr && ly < rr) cut = (lx - 15 + rr) ** 2 + (rr - ly) ** 2 > rr * rr + 1;
        if (!L && !Dn && lx < rr && ly > 15 - rr) cut = (rr - lx) ** 2 + (ly - 15 + rr) ** 2 > rr * rr + 1;
        if (!Rt && !Dn && lx > 15 - rr && ly > 15 - rr) cut = (lx - 15 + rr) ** 2 + (ly - 15 + rr) ** 2 > rr * rr + 1;
        if (!cut) M[(ty * T + ly) * W + tx * T + lx] = 1;
      }
    }
    // Plaza, kept on Clockspire's top.
    const gq = GEO.square;
    for (let y = PLAZA.y0; y < PLAZA.y1; y++) for (let x = PLAZA.x0; x < PLAZA.x1; x++) {
      if (!inPlaza(x, y)) continue;
      const lx = x - gq.ox, ly = y - gq.oy;
      if (lx >= 0 && ly >= 0 && lx < gq.bw && ly < gq.bh && gq.din[ly * gq.bw + lx] > 6) M[y * W + x] = 1;
    }
    // Manhattan distance to the edge (capped).
    const DT = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) DT[i] = M[i] ? 30 : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!DT[i]) continue;
      DT[i] = Math.min(DT[i], x > 0 ? DT[i - 1] + 1 : 1, y > 0 ? DT[i - W] + 1 : 1);
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; if (!DT[i]) continue;
      DT[i] = Math.min(DT[i], x < W - 1 ? DT[i + 1] + 1 : 1, y < H - 1 ? DT[i + W] + 1 : 1);
    }
    const F = fields(), nR = F.n4, nM = F.n2;
    const C = rgb;
    const cob = { d: C(P.cobbleDark), b: C(P.cobble), l: C(P.cobbleLight), o: C(mix(P.cobbleDark, P.outline, 0.45)), m: C(sh(P.cobbleDark, -0.12)), w: C(sh(P.cobbleLight, 0.25)), v: C(mix(P.cobble, '#a99a84', 0.6)), u: C(mix(P.cobble, '#8d96a0', 0.5)) };
    const brass = { b: C(P.gold), d: C(P.goldDark), o: C('#7a5a22'), l: C('#fbe7a1') };
    const stp = { b: C('#959a8e'), l: C('#bcc0b2'), d: C('#6f736a'), o: C('#4b4e48'), m: C('#6f8d4a'), ml: C('#8aa95c') };
    const pl = { b: C(P.plank), d: C(P.plankDark), l: C(sh(P.plank, 0.18)), g: C('#4f3520'), o: C('#3e2a18'), n: C('#2b2018') };
    const ne = { b: C('#3b2a4d'), g: C('#271b36'), l: C('#4f3b66'), alt: C('#45325a'), o: C('#160f22'), cy: C(P.neonCyan), pk: C(P.neonPink), cyd: C(mix('#3b2a4d', P.neonCyan, 0.35)), pkd: C(mix('#3b2a4d', P.neonPink, 0.35)) };
    const gr = { b: C('#8c7c69'), l: C('#ab9c8b'), d: C('#665848'), s: C('#c2b6a5'), o: C('#4f4436'), r: C('#b0784a') };
    const snow = C(P.snow), snowD = C('#c9d6e0');
    const set = (i, c) => { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
    const CW = 8, CH = 7;
    const seed = (cx, cy) => [cx * CW + 1 + hash(cx, cy, 3) * (CW - 2), cy * CH + 1 + hash(cx, cy, 4) * (CH - 2)];
    function cobble(x, y, dd, tl, edgeH, plaza) {
      if (dd <= 1) return cob.o;
      if (dd <= 4) {
        const along = edgeH ? x : y;
        if (along % 9 === 0) return cob.m;
        if (dd === 2) return tl ? cob.d : cob.l;
        return dd === 3 ? (tl ? cob.b : cob.l) : cob.b;
      }
      if (plaza) { // a ring of pale flagstones just inside the plaza curb
        if (dd <= 9) { const k = Math.floor((edgeH ? x : y) / 10); if (dd === 5 || (edgeH ? x : y) % 10 === 0) return cob.m; return (dd === 6 && !tl) || hash(k, dd > 7 ? 1 : 0, 9) < 0.2 ? cob.v : dd === 6 ? cob.w : cob.l; }
      }
      const ccx = Math.floor(x / CW), ccy = Math.floor(y / CH);
      let b1 = 1e9, b2 = 1e9, bx = 0, by = 0, bk = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const [sx, sy] = seed(ccx + i, ccy + j);
        const dx = x - sx, dy = (y - sy) * 1.15, q = dx * dx + dy * dy;
        if (q < b1) { b2 = b1; b1 = q; bx = sx; by = sy; bk = hash(ccx + i, ccy + j, 5); } else if (q < b2) b2 = q;
      }
      const gap = Math.sqrt(b2) - Math.sqrt(b1);
      if (gap < 1.3) return cob.m;
      const lx = x - bx, ly = y - by, lit = -(lx + ly);
      const base = bk < 0.12 ? cob.v : bk < 0.22 ? cob.u : cob.b;
      if (gap < 2.3 && lx + ly > 0) return cob.d;
      if (gap < 2.3 && lit > 0) return bk < 0.22 ? cob.l : cob.w;
      if (lit > 2.5 && bay(x, y) < 0.5) return cob.l;
      return base;
    }
    function compass(x, y) {
      const dx = x - HUBX, dy = y - HUBY, r = Math.sqrt(dx * dx + dy * dy);
      if (r > 15.5) return null;
      if (r > 13.5) return brass.o;
      if (r > 12) return brass.d;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      const onN = ax <= Math.max(0, 2 - ay / 5) && ay <= 11, onE = ay <= Math.max(0, 2 - ax / 5) && ax <= 11;
      if (onN || onE) return (dx < 0 || dy < 0) && !(dx > 0 && dy > 0) ? brass.l : brass.b;
      if (Math.abs(ax - ay) <= 0.8 && r < 7) return brass.d;
      if (r < 2) return brass.b;
      return (x + y) % 2 ? cob.l : cob.w;
    }
    function steps(x, y, dd, o) {
      if (dd <= 1) return stp.o;
      const n = nM(x, y), mossy = n > 0.58 && bay(x, y) < (n - 0.58) * 4;
      if (o === 2) { // climbing: stone steps with a lit nose and a shadowed riser
        const row = Math.floor(y / 6), ly = y % 6;
        if (ly === 5) return stp.o;
        if (ly === 4) return stp.d;
        if ((x + row * 5) % 11 === 0) return stp.d;
        if (mossy) return ly === 0 ? stp.ml : stp.m;
        if (dd === 2) return stp.m;
        if (ly === 0) return stp.l;
        return hash(x, y, 8) < 0.08 ? stp.d : stp.b;
      }
      // level ground: mossy flagstones in a running bond
      const row = Math.floor(y / 7), ly = y % 7, lx = (x + row * 5) % 11;
      if (ly === 6 || lx === 10) return n > 0.5 && hash(x, y, 62) < 0.6 ? stp.m : stp.o;
      if (mossy) return stp.m;
      if (ly === 0 || lx === 0) return stp.l;
      if (ly === 5 || lx === 9) return stp.d;
      const k = hash(Math.floor((x + row * 5) / 11), row, 63);
      return hash(x, y, 8) < 0.07 ? stp.d : k < 0.25 ? stp.l : stp.b;
    }
    function plank(x, y, dd, tl, o) {
      if (dd <= 1) return pl.o;
      const across = o === 1 ? y : x, along = o === 1 ? x : y;
      const board = Math.floor(across / 4), w = across % 4;
      if (w === 3) return pl.g;
      if (dd === 2 && !tl) return pl.d;
      const bh = hash(board, 1, 12);
      if (((along + board * 5) % 16 === 2 || (along + board * 5) % 16 === 13) && w === 1) return pl.n;
      if ((along + board * 7) % 23 === 0) return pl.g;
      if (w === 0) return pl.l;
      return bh < 0.3 ? pl.d : bh > 0.8 ? pl.l : pl.b;
    }
    function neon(x, y, dd) {
      if (dd <= 1) return ne.o;
      const k = (x + y) % 14, seg = Math.floor((x + y) / 14) % 2;
      if (dd === 2) return k < 10 ? (seg ? ne.cy : ne.pk) : ne.o;
      if (dd === 3) return k < 10 ? (seg ? ne.cyd : ne.pkd) : ne.g;
      if (x % 8 === 7 || y % 8 === 7) return ne.g;
      if (x % 8 === 0 || y % 8 === 0) return ne.l;
      return hash(x >> 3, y >> 3, 14) < 0.25 ? ne.alt : ne.b;
    }
    function gravel(x, y, dd, tl) {
      if (dd <= 1) return gr.o;
      if (dd === 2) return tl ? gr.d : gr.l;
      const h = hash(x, y, 15), n = nR(x, y);
      if (h < 0.14) return gr.d;
      if (h < 0.24) return gr.l;
      if (h < 0.28) return gr.s;
      if (h < 0.29) return gr.r;
      return n > 0.6 ? gr.d : n < 0.35 ? gr.l : gr.b;
    }
    const collectNeon = !neonPts;
    if (collectNeon) neonPts = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x, dd = DT[k];
      if (!dd) continue;
      const tx = (x / T) | 0, ty = (y / T) | 0;
      const isl = S.islandAt(tx, ty);
      const style = STYLE_OF[isl] || 'gravel';
      const up = y - dd >= 0 && !M[(y - dd) * W + x], left = x - dd >= 0 && !M[k - dd];
      const tl = up || left;
      const edgeH = up || (y + dd < H && !M[(y + dd) * W + x]);
      const o = (ORI[ty * COLS + tx] & 2) && !(ORI[ty * COLS + tx] & 1) ? 2 : 1;
      let c;
      if (style === 'cobble') { const pz = inPlaza(x, y); c = compass(x, y) || cobble(x, y, dd, tl, edgeH, pz && !S.onRoad(tx, ty)); }
      else if (style === 'steps') c = steps(x, y, dd, o);
      else if (style === 'plank') c = plank(x, y, dd, tl, o);
      else if (style === 'neon') { c = neon(x, y, dd); if (collectNeon && dd === 2 && (c === ne.cy || c === ne.pk)) neonPts.push([x, y, c === ne.cy ? P.neonCyan : P.neonPink]); }
      else c = gravel(x, y, dd, tl);
      if (winter && style !== 'neon') {
        const n = nM(x, y), hv = hash(x >> 1, y >> 1, 91) * 0.65 + hash(x, y, 92) * 0.35;
        if (style === 'cobble') {
          if (c === cob.m || c === cob.o) c = hv < 0.7 ? snow : snowD;
          else if (dd <= 3 + n * 4 && hv < 0.75) c = snow;
        } else {
          const cover = dd <= 2 ? 0.95 : dd <= 4 ? 0.7 : n > 0.55 ? 0.35 + (n - 0.55) * 2 : 0.12;
          if (hv < cover) c = hv < cover * 0.25 ? snowD : snow;
        }
      }
      set(k * 4, c);
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  S.registerStatic(10, (ctx) => {
    if (!roadCache[season]) roadCache[season] = buildRoads(season);
    ctx.drawImage(roadCache[season], 0, 0);
  });

  /* ======================================================================
   * static 50: scattered decor
   * ==================================================================== */
  function ell(c, cx, cy, rx, ry, col) {
    c.fillStyle = col;
    for (let dy = -ry; dy <= ry; dy++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((ry + 0.35) * (ry + 0.35)))));
      c.fillRect(Math.round(cx - w), Math.round(cy + dy), w * 2 + 1, 1);
    }
  }
  const shadow = (c, cx, cy, rx, ry) => ell(c, cx, cy, rx, ry, P.shadow);
  const spriteCache = {};

  function leafSet(kind) {
    const sea = season;
    if (kind === 5) { // Neon Hollow glow-leaf: keeps its leaves all year
      const base = sea === 'autumn' ? '#9a3f8e' : sea === 'spring' ? '#7050b8' : sea === 'winter' ? '#6a4a8a' : '#7a3fa0';
      return { base, hi: sh(base, 0.3), mid: sh(base, -0.16), dark: sh(base, -0.36), out: sh(base, -0.66) };
    }
    if (sea === 'winter') return null;
    let base = P.leaf[sea], alt = P.leafAlt[sea];
    if (kind === 1 && sea === 'autumn') { base = '#c4492f'; alt = '#e0763a'; }
    if (kind === 2 && sea === 'autumn') { base = '#d9a032'; alt = '#f0cf5a'; }
    if (kind === 3 && sea === 'autumn') { base = '#8f9a45'; alt = '#b3b24f'; }
    if (kind === 4 && sea === 'autumn') { base = '#6f8f3a'; alt = '#9cb44f'; }
    if (sea === 'summer') alt = sh(base, 0.25);
    if (sea === 'spring' && kind !== 4) alt = sh(base, 0.22);
    return { base, hi: alt, mid: sh(base, -0.14), dark: sh(base, -0.32), out: sh(base, -0.62) };
  }
  /** Deciduous tree: kind 0..3 colour family, 4 = fruit tree, 5 = Neon Hollow glow tree. */
  function treeSprite(kind, v) {
    const key = 't' + kind + '_' + v + '_' + season;
    if (spriteCache[key]) return spriteCache[key];
    const w = 40, h = 46, cv = mk(w, h), c = cv.getContext('2d');
    const rnd = S.rng(1000 + kind * 37 + v * 101);
    const cx = 20, cy = 17, big = kind !== 4;
    const neonT = kind === 5;
    const trunk = neonT ? '#4a3550' : '#6b4a2f', trunkL = neonT ? '#6a5070' : '#8d6440', trunkD = neonT ? '#2c1e33' : '#4a321f';
    R(c, cx - 3, 26, 6, 16, P.outline);
    R(c, cx - 2, 26, 4, 15, trunk); R(c, cx - 2, 26, 1, 15, trunkL); R(c, cx + 1, 26, 1, 15, trunkD);
    R(c, cx - 5, 40, 10, 2, P.outline); R(c, cx - 4, 40, 3, 1, trunk); R(c, cx + 1, 40, 3, 1, trunkD);
    D(c, cx - 1, 33, trunkD); D(c, cx, 36, trunkL);
    const L = leafSet(kind);
    cv._ox = cx; cv._base = 41; cv._glints = [];
    if (!L) {
      const br = (x, y, a, len, depth) => {
        for (let i = 0; i < len; i++) {
          const xx = Math.round(x + Math.cos(a) * i), yy = Math.round(y + Math.sin(a) * i);
          D(c, xx, yy, depth > 1 ? trunk : trunkD); if (depth > 1) D(c, xx + 1, yy, trunkD);
          if (i % 2 === 0) D(c, xx, yy - 1, P.snow);
        }
        if (depth > 0) {
          const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
          br(ex, ey, a - 0.5 - rnd() * 0.3, len * 0.65, depth - 1);
          br(ex, ey, a + 0.45 + rnd() * 0.3, len * 0.6, depth - 1);
        }
      };
      br(cx, 28, -Math.PI / 2, 9, 3);
      return (spriteCache[key] = cv);
    }
    const sc = big ? 1.18 : 1;
    const blobs = [[cx, cy, 10.5 * sc]];
    const nb = 5 + ((rnd() * 3) | 0);
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * Math.PI * 2 + rnd() * 0.6;
      blobs.push([cx + Math.cos(a) * (6.5 + rnd() * 2) * sc, cy + Math.sin(a) * (5 + rnd() * 2) * sc - 1, (5.5 + rnd() * 2) * sc]);
    }
    const inside = (x, y) => {
      let best = -1e9, bi = -1;
      for (let i = 0; i < blobs.length; i++) {
        const [bx, by, br] = blobs[i];
        const q = br - Math.hypot(x - bx, (y - by) * 1.08);
        if (q > best) { best = q; bi = i; }
      }
      return best >= 0 ? bi : -1;
    };
    const M = new Int8Array(w * h).fill(-1);
    for (let y = 0; y < 34; y++) for (let x = 0; x < w; x++) M[y * w + x] = inside(x + 0.5, y + 0.5);
    for (let y = 0; y < 34; y++) for (let x = 0; x < w; x++) {
      const bi = M[y * w + x];
      if (bi < 0) continue;
      const edge = x === 0 || x === w - 1 || y === 0 || M[y * w + x - 1] < 0 || M[y * w + x + 1] < 0 || M[(y - 1) * w + x] < 0 || M[(y + 1) * w + x] < 0;
      if (edge) { D(c, x, y, L.out); continue; }
      const [bx, by, br] = blobs[bi];
      const lit = (-(x - bx) - (y - by) * 1.2) / br * 0.75 + (-(x - cx) - (y - cy)) / 22 * 0.55 + (bay(x, y) - 0.5) * 0.35;
      let col = lit > 0.55 ? L.hi : lit > 0.0 ? L.base : lit > -0.45 ? L.mid : L.dark;
      const hv = hash(x, y, kind * 7 + v);
      if (hv < 0.07 && lit > -0.2) col = L.hi; else if (hv > 0.93) col = L.dark;
      if (bi !== 0 && M[(y + 1) * w + x] === 0 && lit < 0.2) col = L.dark;
      if (neonT && season === 'winter' && M[(y - 2) * w + x] < 0 && lit > -0.3) col = P.snow;
      D(c, x, y, col);
    }
    if (kind === 4) {
      for (let i = 0; i < 9; i++) {
        const x = Math.round(cx - 9 + rnd() * 18), y = Math.round(cy - 7 + rnd() * 13);
        if (M[y * w + x] < 0 || M[(y + 1) * w + x + 1] < 0) continue;
        if (season === 'spring') { D(c, x, y, '#f7c6d9'); D(c, x + 1, y, '#ffffff'); }
        else { D(c, x, y, '#d43b2f'); D(c, x + 1, y, '#a0281f'); D(c, x, y - 1, '#ff8a6a'); }
      }
    }
    if (neonT) { // glowing seed pods
      for (let i = 0; i < 8; i++) {
        const x = Math.round(cx - 10 + rnd() * 20), y = Math.round(cy - 6 + rnd() * 14);
        if (M[y * w + x] < 0 || M[(y + 1) * w + x] < 0 || M[y * w + x + 1] < 0) continue;
        const col = i % 3 === 0 ? P.neonPink : P.neonCyan;
        D(c, x, y, col); D(c, x, y + 1, sh(col, -0.4));
        cv._glints.push([x - cx, y - 41, col]);
      }
    }
    return (spriteCache[key] = cv);
  }
  const PINE = {
    green: { b: '#356b45', l: '#4f8a55', d: '#24503a', o: '#122a1f' },
    highland: { b: '#2f6158', l: '#4a8272', d: '#1f4542', o: '#0e2422' },
    juniper: { b: '#5f6f3a', l: '#80904a', d: '#44522a', o: '#1f2612' },
  };
  function pineSprite(v, pal) {
    const key = 'p' + v + pal + '_' + season;
    if (spriteCache[key]) return spriteCache[key];
    const w = 24, h = 40, cv = mk(w, h), c = cv.getContext('2d');
    const cx = 12, tiers = pal === 'juniper' ? 3 : 4, tall = v === 2;
    const G = PINE[pal];
    R(c, cx - 2, 31, 4, 7, P.outline); R(c, cx - 1, 31, 2, 6, '#6b4a2f'); D(c, cx - 1, 31, '#8d6440');
    const top0 = pal === 'juniper' ? 10 : tall ? 0 : 4;
    for (let t = tiers - 1; t >= 0; t--) {
      const top = top0 + t * (tall ? 7 : 6), hh = 11, hw = 4 + t * 2.4 + (tall ? 0 : 0.5);
      for (let y = top; y < top + hh; y++) {
        const f = (y - top) / hh, half = Math.round(hw * f + 1);
        const jag = (y === top + hh - 1) ? 1 : 0;
        for (let x = cx - half; x <= cx + half - 1; x++) {
          if (jag && (x + t) % 3 === 0) continue;
          const edge = x === cx - half || x === cx + half - 1 || y === top + hh - 1 || y === top;
          let col = edge ? G.o : x < cx - 1 ? (f < 0.5 || bay(x, y) < 0.5 ? G.l : G.b) : x > cx + 1 ? G.d : G.b;
          if (!edge && y >= top + hh - 3) col = (x < cx ? G.b : G.d);
          if (!edge && hash(x, y, v + 3) < 0.08) col = G.l;
          if (season === 'winter' && !edge && (y - top) < 3 + (x < cx ? 1 : 0) && bay(x, y) < 0.8) col = P.snow;
          D(c, x, y, col);
        }
      }
    }
    if (pal === 'juniper' && season !== 'winter') for (let i = 0; i < 5; i++) { const x = 7 + ((hash(i, v, 4) * 10) | 0), y = 16 + ((hash(i, v, 5) * 14) | 0); D(c, x, y, '#7a8ac8'); }
    D(c, cx - 1, top0, G.o);
    cv._ox = cx; cv._base = 37;
    return (spriteCache[key] = cv);
  }
  function palmSprite(v) {
    const key = 'palm' + v + '_' + season;
    if (spriteCache[key]) return spriteCache[key];
    const w = 44, h = 50, cv = mk(w, h), c = cv.getContext('2d');
    const bx = 20, by = 47, lean = v === 1 ? -5 : 5;
    const pts = [];
    for (let i = 0; i <= 32; i++) { const f = i / 32; pts.push([Math.round(bx + lean * f * f), by - i]); }
    for (const [x, y] of pts) { R(c, x - 2, y, 5, 1, P.outline); }
    pts.forEach(([x, y], i) => {
      const ring = i % 4 === 0;
      D(c, x - 1, y, ring ? '#8a6a44' : '#c8a070'); D(c, x, y, ring ? '#6e5234' : '#a8804e'); D(c, x + 1, y, ring ? '#4e3a24' : '#7e5e3a');
    });
    const [tx, ty] = pts[32];
    const winter = season === 'winter';
    const fr = winter ? { b: '#5a7a5a', l: '#7a9a72', d: '#3a5440', o: '#1c2a20' } : season === 'autumn' ? { b: '#7a9a3a', l: '#a4bf52', d: '#56702a', o: '#24300f' } : { b: '#3f9a3e', l: '#6cc455', d: '#2a6a2c', o: '#123214' };
    const angles = [-2.9, -2.35, -1.75, -1.2, -0.55, 0.0, 2.6];
    for (const a of angles) {
      const len = 13 + ((hash(v, a * 10, 7) * 5) | 0);
      for (let s = 2; s <= len; s++) {
        const x = Math.round(tx + Math.cos(a) * s), y = Math.round(ty - 1 + Math.sin(a) * s * 0.75 + 0.028 * s * s * 2.2);
        D(c, x, y - 1, fr.o); D(c, x, y + 2, fr.o);
        D(c, x, y, fr.l); D(c, x, y + 1, fr.b);
        if (s % 2 === 0 && s < len - 1) { D(c, x, y + 3, fr.d); D(c, x + (Math.cos(a) > 0 ? 1 : -1), y + 3, fr.o); }
        if (winter && s % 2 === 1) D(c, x, y - 1, P.snow);
      }
    }
    ell(c, tx, ty - 1, 3, 2, fr.o); ell(c, tx, ty - 1, 2, 1, fr.b); D(c, tx - 1, ty - 2, fr.l);
    if (season !== 'winter') for (const [dx, dy] of [[-2, 2], [1, 2], [-1, 3]]) { D(c, tx + dx, ty + dy, '#6e4a2a'); D(c, tx + dx, ty + dy - 1, '#a87a48'); }
    cv._ox = bx; cv._base = by;
    return (spriteCache[key] = cv);
  }
  function deadTreeSprite(v) {
    const key = 'dead' + v + '_' + season;
    if (spriteCache[key]) return spriteCache[key];
    const w = 34, h = 40, cv = mk(w, h), c = cv.getContext('2d'), cx = 17;
    const rnd = S.rng(500 + v * 13);
    const bark = '#8a7562', barkL = '#ad9984', barkD = '#5a4a3c';
    R(c, cx - 2, 22, 5, 16, P.outline); R(c, cx - 1, 22, 3, 15, bark); R(c, cx - 1, 22, 1, 15, barkL); R(c, cx + 1, 22, 1, 15, barkD);
    R(c, cx - 4, 36, 9, 2, P.outline); R(c, cx - 3, 36, 3, 1, bark);
    const br = (x, y, a, len, depth) => {
      for (let i = 0; i < len; i++) {
        const xx = Math.round(x + Math.cos(a) * i), yy = Math.round(y + Math.sin(a) * i);
        D(c, xx, yy, depth > 1 ? bark : barkD); if (depth > 1) D(c, xx + 1, yy, barkD);
        if (depth > 1 && i % 3 === 0) D(c, xx - 1, yy, barkL);
        if (season === 'winter' && i % 2 === 0) D(c, xx, yy - 1, P.snow);
      }
      if (depth > 0) {
        const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
        br(ex, ey, a - 0.55 - rnd() * 0.35, len * 0.62, depth - 1);
        if (rnd() < 0.8) br(ex, ey, a + 0.5 + rnd() * 0.35, len * 0.58, depth - 1);
      }
    };
    br(cx, 24, -Math.PI / 2 + (v - 1) * 0.15, 9, 3);
    cv._ox = cx; cv._base = 37;
    return (spriteCache[key] = cv);
  }
  /** Flat-topped dryland tree for Copperhold. */
  function acaciaSprite(v) {
    const key = 'ac' + v + '_' + season;
    if (spriteCache[key]) return spriteCache[key];
    const w = 46, h = 40, cv = mk(w, h), c = cv.getContext('2d'), cx = 23, base = 37;
    const bark = '#7a5a3a', barkL = '#9a7650', barkD = '#4e3622';
    const limb = (x0, y0, x1, y1, thick) => {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let i = 0; i <= n; i++) {
        const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n);
        R(c, x - 1, y, thick + 2, 1, P.outline);
      }
      for (let i = 0; i <= n; i++) {
        const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n);
        D(c, x, y, barkL); if (thick > 1) D(c, x + 1, y, barkD);
      }
    };
    const fl = v ? -1 : 1;
    limb(cx, base, cx + fl, 24, 2);
    limb(cx + fl, 25, cx - 9 * fl, 13, 1);
    limb(cx + fl, 24, cx + 8 * fl, 11, 1);
    limb(cx + fl, 28, cx + 13 * fl, 19, 1);
    R(c, cx - 3, base, 8, 1, P.outline); D(c, cx - 2, base - 1, bark);
    const winter = season === 'winter';
    const L = winter ? { base: '#6a6e52', hi: '#868a66', dark: '#4e523c', out: '#22241a' }
      : season === 'autumn' ? { base: '#9a8a3a', hi: '#bfae52', dark: '#6e622a', out: '#2c2610' }
      : season === 'spring' ? { base: '#6a9a3a', hi: '#8cbf52', dark: '#4a6e2a', out: '#1c2a10' }
      : { base: '#6a8a34', hi: '#8aaa48', dark: '#4a6426', out: '#1c2610' };
    const pads = [[cx - 9 * fl, 11, 9], [cx + 8 * fl, 9, 10], [cx + 13 * fl, 17, 6], [cx, 10, 8]];
    const M = new Int8Array(w * h).fill(-1);
    for (let y = 0; y < 26; y++) for (let x = 0; x < w; x++) {
      let best = -1e9, bi = -1;
      pads.forEach(([px, py, pr], i) => { const q = pr - Math.hypot(x + 0.5 - px, (y + 0.5 - py) * 2.1); if (q > best) { best = q; bi = i; } });
      if (best >= 0) M[y * w + x] = bi;
    }
    for (let y = 0; y < 26; y++) for (let x = 0; x < w; x++) {
      const bi = M[y * w + x]; if (bi < 0) continue;
      const edge = x === 0 || x === w - 1 || M[y * w + x - 1] < 0 || M[y * w + x + 1] < 0 || M[(y - 1) * w + x] < 0 || M[(y + 1) * w + x] < 0;
      const [px, py] = pads[bi];
      const lit = -(y - py) * 0.5 - (x - px) * 0.06 + (bay(x, y) - 0.5) * 0.6;
      let col = edge ? L.out : lit > 0.6 ? L.hi : lit > -0.6 ? L.base : L.dark;
      if (winter && !edge && M[(y - 2) * w + x] < 0) col = P.snow;
      if (!edge && hash(x, y, v + 61) < 0.06) col = L.dark;
      D(c, x, y, col);
    }
    cv._ox = cx; cv._base = base;
    return (spriteCache[key] = cv);
  }
  const BUSH = {
    hedge: { base: '#3f7a3a', hi: '#5f9a4a', mid: '#356b33', dark: '#2a5528', out: '#14281a' },
    scrub: { base: '#8a8a44', hi: '#a8a85a', mid: '#727236', dark: '#58582a', out: '#262612' },
    heather: { base: '#8c5f94', hi: '#b07fb6', mid: '#77507e', dark: '#5a3c60', out: '#26182a' },
    glow: { base: '#4e3a74', hi: '#7a62a8', mid: '#3f2e60', dark: '#2c204a', out: '#140c22' },
    beach: { base: '#6f9a4a', hi: '#94bf62', mid: '#5c823c', dark: '#45662e', out: '#1c2a14' },
  };
  function bushSprite(v, palName) {
    const key = 'b' + v + palName + '_' + season;
    if (spriteCache[key]) return spriteCache[key];
    const cv = mk(18, 14), c = cv.getContext('2d');
    let L = BUSH[palName];
    if (palName === 'leafy') L = leafSet(v === 1 ? 1 : 3) || { base: '#5d7266', hi: '#7e8f86', mid: '#4f6358', dark: '#3e5046', out: '#1f2c26' };
    if (palName === 'hedge' && season === 'autumn') L = { base: '#5a7a34', hi: '#7a9a44', mid: '#4a6a2c', dark: '#3a5424', out: '#1a2610' };
    if (palName === 'heather' && season === 'autumn') L = { base: '#9a5a3a', hi: '#c07a4a', mid: '#80482e', dark: '#5e3420', out: '#2a160c' };
    if (season === 'winter' && palName !== 'glow') L = { base: '#5d7266', hi: '#7e8f86', mid: '#4f6358', dark: '#3e5046', out: '#1f2c26' };
    const blobs = [[9, 8, 5.5], [5, 9, 4], [13, 9, 4]];
    for (let y = 0; y < 14; y++) for (let x = 0; x < 18; x++) {
      let best = -9, bi = 0;
      blobs.forEach(([bx, by, br], i) => { const q = br - Math.hypot(x - bx, y - by); if (q > best) { best = q; bi = i; } });
      if (best < 0) continue;
      const [bx, by, br] = blobs[bi];
      const lit = (-(x - bx) - (y - by)) / br + (bay(x, y) - 0.5) * 0.5;
      D(c, x, y, best < 1 ? L.out : lit > 0.6 ? L.hi : lit > -0.2 ? L.base : L.dark);
    }
    cv._glints = [];
    if (season === 'winter') { R(c, 5, 3, 7, 2, P.snow); R(c, 2, 5, 3, 1, P.snow); R(c, 12, 5, 3, 1, P.snow); }
    else if (palName === 'leafy' && v === 2 && season !== 'autumn') for (const [x, y] of [[6, 6], [11, 5], [9, 9]]) { D(c, x, y, '#ffffff'); D(c, x + 1, y, '#f2a7c3'); }
    else if (palName === 'leafy' && v === 2) for (const [x, y] of [[6, 6], [11, 5], [9, 9], [4, 9]]) D(c, x, y, '#b8322a');
    else if (palName === 'heather') for (const [x, y] of [[6, 5], [10, 4], [12, 8], [5, 9], [8, 8]]) D(c, x, y, season === 'autumn' ? '#e0a050' : '#e2b4ea');
    else if (palName === 'scrub') for (const [x, y] of [[6, 6], [12, 7]]) D(c, x, y, '#e8d27a');
    if (palName === 'glow') for (const [x, y] of [[6, 5], [11, 6], [8, 9], [13, 9]]) { const col = (x + y) % 2 ? P.neonCyan : '#ff8ad0'; D(c, x, y, col); cv._glints.push([x - 9, y - 13, col]); }
    cv._ox = 9; cv._base = 13;
    return (spriteCache[key] = cv);
  }
  const ROCKPAL = {
    grey: ['#3a3640', '#c2bdb4', '#9a958c', '#77726a', '#6f8a4a'],
    slate: ['#262a38', '#b4bccb', '#8a92a6', '#646c82', '#5f8a5a'],
    plum: ['#170f22', '#8a729e', '#5f4a74', '#433356', '#3ef0ff'],
    sand: ['#4a3a26', '#eadbb4', '#cdb88a', '#a8916a', '#d8c8a0'],
    ochre: ['#3a2a1c', '#d4ae7c', '#b08a5a', '#8a6a44', '#d28a4a'],
  };
  function rockSprite(v, pal, big) {
    const key = 'r' + v + pal + (big ? 'B' : '') + '_' + season;
    if (spriteCache[key]) return spriteCache[key];
    const Cs = ROCKPAL[pal];
    const cw = big ? 22 : 14, chh = big ? 16 : 10, cv = mk(cw, chh), c = cv.getContext('2d');
    const rx = big ? 9 : v === 0 ? 5 : v === 1 ? 4 : 6, ry = big ? 6 : v === 2 ? 4 : 3;
    const ox = cw >> 1, oy = big ? 8 : 5;
    cv._glints = [];
    for (let y = -ry - 1; y <= ry + 1; y++) for (let x = -rx - 1; x <= rx + 1; x++) {
      const q = (x * x) / (rx * rx) + (y * y) / (ry * ry) + hash(x, y, v + (big ? 9 : 0)) * 0.25;
      if (q > 1.25) continue;
      const edge = q > 0.95;
      const lit = -(x / rx) - (y / ry);
      let col = edge ? Cs[0] : lit > 0.7 ? Cs[1] : lit > -0.3 ? Cs[2] : Cs[3];
      if (big && !edge && Math.abs(x - 1 + y * 0.6) < 0.5 && y > -ry + 2) col = Cs[0]; // a crack
      if (!edge && y > 0 && hash(x, y, v + 5) < 0.18) {
        col = Cs[4];
        if (pal === 'plum') cv._glints.push([x + ox - (cw >> 1), y + oy - (chh - 1), col]);
      }
      if (season === 'winter' && !edge && y < -ry / 3) col = P.snow;
      D(c, ox + x, oy + y, col);
    }
    cv._ox = cw >> 1; cv._base = chh - 1;
    return (spriteCache[key] = cv);
  }
  function drawSprite(c, cv, x, base, glow) {
    const X = Math.round(x - cv._ox), Y = Math.round(base - cv._base);
    c.drawImage(cv, X, Y);
    if (glow && cv._glints) for (const [gx, gy, col] of cv._glints) glow.push([Math.round(x) + gx, Math.round(base) + gy, col]);
  }

  /* small decor drawn straight into the static layer */
  function flowerCols() {
    return {
      spring: ['#f2a7c3', '#ffd34d', '#ffffff', '#c58cf0'],
      summer: ['#ff6b6b', '#ffd34d', '#ff9fd0', '#7aa7ff'],
      autumn: ['#e8722f', '#f2c94c', '#b8432f', '#c86ad0'],
      winter: ['#7e8f86', '#5f726a', '#b8432f', '#7e8f86'],
    }[season];
  }
  function flowersAt(c, x, y, seed) {
    if (season === 'winter') { if (hash(seed, 1, 2) < 0.3) { D(c, x, y, '#b8432f'); D(c, x + 1, y + 1, '#4f6a55'); } return; }
    const cols = flowerCols();
    const col = cols[(hash(seed, 2, 3) * 4) | 0];
    for (let i = 0; i < 4; i++) {
      const fx = x + ((hash(seed, i, 4) * 6) | 0), fy = y + ((hash(seed, i, 5) * 4) | 0);
      D(c, fx, fy + 1, '#3f6a2a');
      D(c, fx, fy, col); if (i % 2) D(c, fx + 1, fy, sh(col, -0.25));
    }
  }
  function mushroomAt(c, x, y) {
    D(c, x, y + 1, '#efe6d2'); R(c, x - 1, y - 1, 3, 2, P.outline); R(c, x - 1, y - 1, 3, 1, '#c8372d'); D(c, x, y - 1, '#ffffff');
  }
  function leavesAt(c, x, y, seed) {
    const cols = ['#d4782f', '#e0a93a', '#b8432f', '#c9862f'];
    for (let i = 0; i < 5; i++) D(c, x + ((hash(seed, i, 8) * 12) | 0), y + ((hash(seed, i, 9) * 8) | 0), cols[(hash(seed, i, 10) * 4) | 0]);
  }
  /** Neon Hollow glow mushrooms (caps glow at night). */
  function shroomsAt(c, x, y, seed, glow) {
    const n = 1 + ((hash(seed, 1, 3) * 3) | 0);
    for (let i = 0; i < n; i++) {
      const sx = x + i * 5 - ((hash(seed, i, 4) * 2) | 0), hgt = 4 + ((hash(seed, i, 5) * 6) | 0), base = y + ((hash(seed, i, 6) * 3) | 0);
      const pink = hash(seed, i, 7) < 0.35;
      const cap = pink ? ['#ff6ac0', '#ffc0e4', '#b02a72', '#3a0c28'] : ['#3ee8f8', '#b8fbff', '#1a8aa8', '#0a2e3c'];
      const cw = hgt > 7 ? 3 : 2;
      shadow(c, sx + 1, base, cw + 1, 1);
      R(c, sx - 1, base - hgt, 3, hgt, '#2a1e36'); R(c, sx, base - hgt, 1, hgt, '#e4d8f0'); D(c, sx + 1, base - hgt + 1, '#a898c0');
      R(c, sx - cw - 1, base - hgt - 3, cw * 2 + 3, 4, cap[3]);
      R(c, sx - cw, base - hgt - 3, cw * 2 + 1, 2, cap[0]);
      R(c, sx - cw, base - hgt - 1, cw * 2 + 1, 1, cap[2]);
      D(c, sx - cw + 1, base - hgt - 3, cap[1]);
      R(c, sx - cw + 1, base - hgt - 4, cw * 2 - 1, 1, cap[3]);
      if (season === 'winter') R(c, sx - cw + 1, base - hgt - 4, cw * 2 - 1, 1, P.snow);
      if (glow) for (let k = -cw; k <= cw; k++) { glow.push([sx + k, base - hgt - 3, cap[0]]); glow.push([sx + k, base - hgt - 2, cap[k < 0 ? 1 : 0]]); }
    }
  }
  function fernAt(c, x, y, seed) {
    const winter = season === 'winter';
    const g = winter ? ['#5f726a', '#7e8f86'] : season === 'autumn' ? ['#a8682f', '#c98a3a'] : ['#3f7a3a', '#6aa84a'];
    for (const [a, len] of [[-2.5, 6], [-1.9, 7], [-1.25, 7], [-0.6, 6]]) {
      for (let s = 1; s <= len; s++) {
        const px = Math.round(x + Math.cos(a) * s), py = Math.round(y + Math.sin(a) * s * 0.8 + s * s * 0.07);
        D(c, px, py, s < 3 ? g[0] : g[1]);
        if (s % 2 === 0) D(c, px, py + 1, g[0]);
      }
    }
    if (winter) D(c, x - 1, y - 5, P.snow);
  }
  function duneGrassAt(c, x, y, seed) {
    const n = 4 + ((hash(seed, 1, 1) * 3) | 0);
    const st = season === 'winter' ? '#b8ac88' : season === 'autumn' ? '#c8b46a' : '#a8b862';
    const dk = sh(st, -0.3);
    for (let i = 0; i < n; i++) {
      const rx = x + i * 2 + ((hash(seed, i, 2) * 2) | 0), hgt = 4 + ((hash(seed, i, 3) * 5) | 0), lean = hash(seed, i, 4) < 0.5 ? -1 : 1;
      for (let k = 0; k < hgt; k++) D(c, rx + (k > hgt * 0.6 ? lean : 0), y - k, k < 2 ? dk : st);
    }
  }
  function driftwoodAt(c, x, y) {
    R(c, x - 1, y - 4, 15, 5, P.outline);
    R(c, x, y - 3, 13, 3, '#a8968a'); R(c, x, y - 3, 13, 1, '#cbbcae'); R(c, x, y - 1, 13, 1, '#7a6a60');
    D(c, x + 4, y - 2, '#7a6a60'); D(c, x + 9, y - 2, '#7a6a60'); R(c, x + 13, y - 6, 2, 3, '#8a7a6e'); D(c, x + 13, y - 7, P.outline);
    if (season === 'winter') R(c, x + 1, y - 4, 11, 1, P.snow);
  }
  function flowerBedAt(c, x, y) {
    shadow(c, x + 9, y + 1, 10, 2);
    R(c, x - 1, y - 9, 20, 10, P.outline);
    R(c, x, y - 8, 18, 8, '#a39d93'); R(c, x, y - 8, 18, 1, '#c9c3b8'); R(c, x, y - 1, 18, 1, '#77726f');
    R(c, x + 1, y - 7, 16, 5, '#5a4030');
    const cols = flowerCols(), leaf = season === 'winter' ? '#4f6a55' : '#3f7a2a';
    for (let xx = x + 2; xx < x + 16; xx += 3) {
      const hv = hash(xx, y, 6);
      R(c, xx, y - 5, 2, 2, leaf);
      if (season === 'winter') { D(c, xx, y - 6, P.snow); D(c, xx + 1, y - 6, P.snow); continue; }
      const col = cols[(hv * 4) | 0];
      D(c, xx, y - 6, col); D(c, xx + 1, y - 6, sh(col, -0.2)); D(c, xx, y - 7, sh(col, 0.3));
    }
    if (season === 'winter') R(c, x, y - 9, 18, 1, P.snow);
  }
  function heatherAt(c, x, y, seed) {
    const cols = season === 'winter' ? ['#7a6a80', '#f4f8fb'] : season === 'autumn' ? ['#a8643a', '#d0904a'] : ['#8c5f94', '#c48fcb'];
    for (let i = 0; i < 6; i++) {
      const fx = x + ((hash(seed, i, 4) * 8) | 0), fy = y + ((hash(seed, i, 5) * 4) | 0);
      D(c, fx, fy + 1, season === 'winter' ? '#5f726a' : '#4f6a3a'); D(c, fx, fy, cols[i % 2]);
    }
  }
  function pebblesAt(c, x, y, seed) {
    for (let i = 0; i < 3; i++) {
      const fx = x + ((hash(seed, i, 4) * 10) | 0), fy = y + ((hash(seed, i, 5) * 6) | 0);
      D(c, fx, fy, '#c4b8a4'); D(c, fx + 1, fy, '#8a7a66'); D(c, fx, fy + 1, '#6a5a48');
    }
  }
  /** A knuckle of raw copper ore poking out of the dry ground. */
  function oreAt(c, x, y, seed) {
    shadow(c, x + 2, y, 7, 2);
    ell(c, x, y - 4, 6, 4, '#2e1e14');
    ell(c, x, y - 4, 5, 3, '#8a6a4a');
    ell(c, x - 1, y - 5, 3, 2, '#a88a68');
    for (let i = 0; i < 5; i++) {
      const fx = x - 4 + ((hash(seed, i, 2) * 8) | 0), fy = y - 7 + ((hash(seed, i, 3) * 5) | 0);
      D(c, fx, fy, '#e8873a'); D(c, fx + 1, fy, '#a8521e'); if (i < 2) D(c, fx, fy - 1, '#ffc890');
    }
    if (season === 'winter') R(c, x - 3, y - 8, 6, 1, P.snow);
  }
  function crackAt(c, x, y, seed) {
    let px = x, py = y;
    for (let i = 0; i < 9; i++) { D(c, px, py, '#7a5a34'); px += hash(seed, i, 2) < 0.6 ? 1 : 0; py += hash(seed, i, 3) < 0.5 ? 1 : -1; }
  }

  /* Decor placement, per island, computed once at the first static draw
   * (after every module has reserved its tiles). */
  const DECOR = {
    square:    { tree: 0.05, grove: 0.5 },
    monastery: { tree: 0.2, grove: 1.1 },
    market:    { tree: 0.14, grove: 0.9 },
    port:      { tree: 0.1, grove: 0.8 },
    mine:      { tree: 0.1, grove: 0.8 },
  };
  function keepOutMap(id) {
    const m = new Uint8Array(COLS * ROWS).fill(9);
    const pts = [];
    for (const k in S.landmarks) if (S.landmarks[k].island === id) pts.push([S.landmarks[k].x, S.landmarks[k].y]);
    for (const k in S.nav.nodes) if (S.nav.island[k] === id) pts.push(S.nav.nodes[k]);
    for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
      let best = 9;
      for (const [x, y] of pts) best = Math.min(best, Math.max(Math.abs(tx - x), Math.abs(ty - y)));
      m[ty * COLS + tx] = best;
    }
    return m;
  }
  function placeDecor(id) {
    const g = GEO[id], cfg = DECOR[id], s = g.s;
    const keep = keepOutMap(id);
    const items = [], ground = [];
    const used = new Uint8Array(COLS * ROWS);
    const mark = (tx, ty) => { if (tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS) used[ty * COLS + tx] = 1; };
    const isUsed = (tx, ty) => tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS || used[ty * COLS + tx] === 1;
    const solidAt = (px, py, m) => { const x = px - g.ox, y = py - g.oy; return x >= 0 && y >= 0 && x < g.bw && y < g.bh && g.din[y * g.bw + x] >= m; };
    const solidTile = (tx, ty, m) => solidAt(tx * T + 2, ty * T + 2, m) && solidAt(tx * T + 13, ty * T + 2, m) && solidAt(tx * T + 2, ty * T + 13, m) && solidAt(tx * T + 13, ty * T + 13, m);
    const ok = (tx, ty, m) => S.isFree(tx, ty) && solidTile(tx, ty, m);
    const clear = (tx, ty) => !S.isReserved(tx, ty) || !S.islandAt(tx, ty);
    const r = g.r;
    // pass 1: trees, clustered into groves
    for (let ty = r.y; ty < r.y + r.h; ty++) for (let tx = r.x; tx < r.x + r.w; tx++) {
      if (isUsed(tx, ty) || !ok(tx, ty, 5) || keep[ty * COLS + tx] <= 2) continue;
      const grove = vnoise(tx / 4.2, ty / 4.2, s + 9);
      const dens = cfg.tree + Math.max(0, grove - 0.45) * cfg.grove;
      if (hash(tx, ty, 101 + s) >= dens) continue;
      const canopyClear = clear(tx - 1, ty) && clear(tx + 1, ty) && clear(tx, ty - 1) && clear(tx - 1, ty - 1) && clear(tx + 1, ty - 1) &&
        clear(tx, ty - 2) && clear(tx, ty + 1) && !S.onRoad(tx, ty - 1) && !S.onRoad(tx, ty - 2) && !S.onRoad(tx, ty + 1) &&
        !isUsed(tx, ty - 1) && !isUsed(tx - 1, ty) && !isUsed(tx + 1, ty);
      if (!canopyClear) continue;
      const jx = ((hash(tx, ty, 102) * 7) | 0) - 3, jy = (hash(tx, ty, 103) * 4) | 0;
      const k = hash(tx, ty, 104 + s), v = ((k * 90) | 0) % 3;
      const x = tx * T + 8 + jx, base = ty * T + 13 + jy;
      let it;
      if (id === 'square') it = k < 0.15 ? { type: 'pine', v, pal: 'green' } : { type: 'tree', kind: [0, 2, 3, 4][((k * 40) | 0) % 4], v };
      else if (id === 'monastery') it = k < 0.58 ? { type: 'pine', v, pal: k < 0.3 ? 'highland' : 'green' } : { type: 'tree', kind: k < 0.82 ? 1 : 3, v };
      else if (id === 'market') it = { type: 'tree', kind: 5, v };
      else if (id === 'port') it = k < 0.72 ? { type: 'palm', v: ((k * 50) | 0) % 2 } : { type: 'tree', kind: 3, v };
      else it = k < 0.2 ? { type: 'dead', v } : k < 0.65 ? { type: 'acacia', v: ((k * 70) | 0) % 2 } : { type: 'pine', v: 0, pal: 'juniper' };
      it.x = x; it.base = base; items.push(it);
      mark(tx, ty); mark(tx, ty - 1); mark(tx - 1, ty); mark(tx + 1, ty); mark(tx - 1, ty - 1); mark(tx + 1, ty - 1);
    }
    // pass 2: bushes, rocks and island flora in the gaps
    for (let ty = r.y; ty < r.y + r.h; ty++) for (let tx = r.x; tx < r.x + r.w; tx++) {
      if (isUsed(tx, ty) || !ok(tx, ty, 4) || keep[ty * COLS + tx] <= 1) continue;
      const h = hash(tx, ty, 105 + s);
      const jx = ((hash(tx, ty, 106) * 7) | 0) - 3, jy = (hash(tx, ty, 107) * 4) | 0;
      const x = tx * T + 8 + jx, base = ty * T + 12 + jy, v = ((h * 300) | 0) % 3;
      let it = null;
      if (id === 'square') {
        if (h < 0.06 && clear(tx, ty + 1)) it = { type: 'bush', v, pal: 'hedge' };
        else if (h < 0.09) it = { type: 'bed' };
        else if (h < 0.1) it = { type: 'rock', v, pal: 'grey' };
      } else if (id === 'monastery') {
        if (h < 0.05) it = { type: 'bush', v, pal: 'heather' };
        else if (h < 0.09) it = { type: 'rock', v, pal: 'slate', big: h < 0.065 };
        else if (h < 0.13) it = { type: 'fern' };
        else if (h < 0.15) it = { type: 'bush', v, pal: 'leafy' };
      } else if (id === 'market') {
        if (h < 0.08) it = { type: 'shroom' };
        else if (h < 0.11) it = { type: 'bush', v, pal: 'glow' };
        else if (h < 0.13) it = { type: 'rock', v, pal: 'plum' };
      } else if (id === 'port') {
        if (h < 0.07) it = { type: 'dune' };
        else if (h < 0.09) it = { type: 'rock', v, pal: 'sand' };
        else if (h < 0.105) it = { type: 'drift' };
        else if (h < 0.12) it = { type: 'bush', v, pal: 'beach' };
      } else {
        if (h < 0.07) it = { type: 'bush', v, pal: 'scrub' };
        else if (h < 0.13) it = { type: 'rock', v, pal: 'ochre', big: h < 0.095 };
        else if (h < 0.15) it = { type: 'ore' };
      }
      if (it) { it.x = x; it.base = base; it.seed = tx * 131 + ty; items.push(it); mark(tx, ty); }
    }
    items.sort((a, b) => a.base - b.base);
    // ground details on free tiles
    for (let ty = r.y; ty < r.y + r.h; ty++) for (let tx = r.x; tx < r.x + r.w; tx++) {
      if (!ok(tx, ty, 3)) continue;
      const h = hash(tx, ty, 111 + s);
      ground.push({ tx, ty, h, under: isUsed(tx, ty) });
    }
    return { items, ground };
  }

  function drawGroundDetail(c, id, gd) {
    const { tx, ty, h } = gd, x = tx * T, y = ty * T, seed = tx * 131 + ty;
    const ax = x + 3 + (((h * 50) | 0) % 6), ay = y + 4 + (((h * 300) | 0) % 6);
    const autumn = season === 'autumn';
    if (id === 'square') {
      if (h < 0.1) flowersAt(c, ax, ay, seed);
      else if (autumn && h < 0.2) leavesAt(c, x + 2, y + 4, seed);
    } else if (id === 'monastery') {
      if (h < 0.1) heatherAt(c, ax, ay, seed);
      else if (h < 0.15) flowersAt(c, ax, ay, seed);
      else if (autumn && h < 0.27) leavesAt(c, x + 2, y + 4, seed);
      else if (h < 0.3 && season !== 'winter') mushroomAt(c, x + 6, y + 9);
    } else if (id === 'market') {
      if (h < 0.08 && season !== 'winter') { // tiny glowing sprouts
        for (let i = 0; i < 3; i++) { const fx = ax + i * 3, fy = ay + ((hash(seed, i, 5) * 3) | 0); D(c, fx, fy + 1, '#2a1c3a'); D(c, fx, fy, i % 2 ? '#ff8ad0' : '#7af6ff'); }
      } else if (autumn && h < 0.16) { for (let i = 0; i < 4; i++) D(c, x + ((hash(seed, i, 8) * 12) | 0), y + ((hash(seed, i, 9) * 8) | 0), i % 2 ? '#c05a9a' : '#8a3a7a'); }
    } else if (id === 'port') {
      if (h < 0.08) flowersAt(c, ax, ay, seed);
      else if (h < 0.16) duneGrassAt(c, ax, ay + 4, seed);
    } else {
      if (h < 0.05) pebblesAt(c, x + 2, y + 4, seed);
      else if (h < 0.1 && season !== 'winter') crackAt(c, x + 2, y + 5, seed);
      else if (h < 0.2 && season !== 'winter') { D(c, ax, ay, '#d8bf6c'); D(c, ax + 1, ay - 1, '#e8d27a'); D(c, ax + 2, ay, '#b89a4a'); }
    }
  }
  function drawItem(c, it, glow) {
    if (it.type === 'tree' || it.type === 'pine' || it.type === 'palm' || it.type === 'dead' || it.type === 'acacia') {
      const wide = it.type === 'pine' ? 9 : it.type === 'palm' ? 8 : it.type === 'dead' ? 7 : it.type === 'acacia' ? 15 : it.kind === 4 ? 11 : 13;
      shadow(c, it.x + 4, it.base, wide, 3);
    }
    if (it.type === 'tree') {
      drawSprite(c, treeSprite(it.kind, it.v), it.x, it.base, glow);
      if (season === 'autumn' && it.kind !== 5) leavesAt(c, it.x - 8, it.base - 2, it.x * 7 + it.base);
    } else if (it.type === 'pine') drawSprite(c, pineSprite(it.v, it.pal), it.x, it.base);
    else if (it.type === 'palm') drawSprite(c, palmSprite(it.v), it.x, it.base);
    else if (it.type === 'dead') drawSprite(c, deadTreeSprite(it.v), it.x, it.base);
    else if (it.type === 'acacia') drawSprite(c, acaciaSprite(it.v), it.x, it.base);
    else if (it.type === 'bush') { shadow(c, it.x + 3, it.base, 8, 2); drawSprite(c, bushSprite(it.v, it.pal), it.x, it.base, glow); }
    else if (it.type === 'rock') { shadow(c, it.x + 2, it.base, it.big ? 10 : 6, 2); drawSprite(c, rockSprite(it.v, it.pal, it.big), it.x, it.base, glow); }
    else if (it.type === 'shroom') shroomsAt(c, it.x - 4, it.base, it.seed, glow);
    else if (it.type === 'fern') fernAt(c, it.x, it.base, it.seed);
    else if (it.type === 'dune') duneGrassAt(c, it.x - 5, it.base, it.seed);
    else if (it.type === 'drift') { shadow(c, it.x + 6, it.base + 1, 8, 1); driftwoodAt(c, it.x - 6, it.base); }
    else if (it.type === 'bed') flowerBedAt(c, it.x - 9, it.base);
    else if (it.type === 'ore') oreAt(c, it.x, it.base, it.seed);
  }

  S.registerStatic(50, (ctx) => {
    for (const id of S.ISLANDS) {
      const g = GEO[id];
      if (!g.decor) g.decor = placeDecor(id);
      g.glowDecor = [];
      g.glowCv = null;
      ctx.save();
      ctx.beginPath(); ctx.rect(g.ox, g.oy, g.bw, g.bh); ctx.clip();
      for (const gd of g.decor.ground) drawGroundDetail(ctx, id, gd);
      for (const it of g.decor.items) drawItem(ctx, it, g.glowDecor);
      ctx.restore();
    }
  });

  /* ======================================================================
   * dyn 400: crystal sparkles + swaying roots      dyn 700: night glow
   * ==================================================================== */
  function buildGlow(id) {
    const g = GEO[id], cv = mk(g.bw, g.bh), c = cv.getContext('2d');
    // Dithered halo first, then the luminous pixels on top.
    for (const cr of g.crystals) {
      const col = CRY[cr.hue].glow, rr = cr.tip ? 8 : 6, cx = cr.x, cy = cr.y + (cr.tip ? 6 : 4);
      c.fillStyle = CO.rgba(col, 0.32);
      for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) if (x * x + y * y <= rr * rr && ((x + y) & 1) === 0) c.fillRect(cx + x, cy + y, 1, 1);
      drawCrystal(c, cr, true);
    }
    const put = (x, y, col, halo) => {
      const lx = x - g.ox, ly = y - g.oy;
      if (lx < 0 || ly < 0 || lx >= g.bw || ly >= g.bh) return;
      if (halo) { c.fillStyle = CO.rgba(col, 0.28); c.fillRect(lx - 1, ly, 1, 1); c.fillRect(lx + 1, ly, 1, 1); c.fillRect(lx, ly - 1, 1, 1); c.fillRect(lx, ly + 1, 1, 1); }
      c.fillStyle = col; c.fillRect(lx, ly, 1, 1);
    };
    if (id === 'market' && neonPts) for (const [x, y, col] of neonPts) if (S.islandAt((x / T) | 0, (y / T) | 0) === 'market') put(x, y, col, false);
    for (const [x, y, col] of g.glowDecor || []) put(x, y, col, true);
    if (id === 'market' && season !== 'winter') { // the bioluminescent specks in the turf
      for (let y = 0; y < g.bh; y++) for (let x = 0; x < g.bw; x++) {
        const i = y * g.bw + x;
        if (!g.top[i]) continue;
        const gx = x + g.ox, gy = y + g.oy;
        if (hash(gx, gy, 33) < 0.005 && !S.onRoad((gx / T) | 0, (gy / T) | 0)) { c.fillStyle = hash(gx, gy, 34) < 0.5 ? '#3ef0ff' : '#ff6ac0'; c.fillRect(x, y, 1, 1); }
      }
    }
    return cv;
  }
  const nightGlow = () => clamp((0.72 - (S.time.light == null ? 1 : S.time.light)) / 0.5, 0, 1);

  for (const id of S.ISLANDS) {
    const g = GEO[id];
    S.registerDynamic(400, (ctx, t) => {
      const ox = g.ox, oy = g.oy, still = S.reducedMotion;
      for (const q of g.roots) if (q.dyn) drawRoot(ctx, ox + q.x, oy + q.y0, q.len, q.ph, still ? 0 : Math.sin(t * 0.9 + q.ph) * 2.2, false, season);
      if (still) return;
      const glowA = 0.55 + nightGlow() * 0.45;
      for (const cr of g.crystals) {
        const ph = (t * 0.22 + cr.seed) % 1;
        if (ph > 0.14) continue;
        const k = ph / 0.14, arm = k < 0.5 ? (k < 0.25 ? 1 : 2) : (k < 0.75 ? 2 : 1);
        const x = ox + cr.x - 2 + ((cr.seed * 7) | 0) % 4, y = oy + cr.y + 2 + ((cr.seed * 3) | 0) % 3;
        const pal = CRY[cr.hue];
        ctx.globalAlpha = glowA;
        ctx.fillStyle = pal.l;
        ctx.fillRect(x - arm, y, arm * 2 + 1, 1); ctx.fillRect(x, y - arm, 1, arm * 2 + 1);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, 1, 1);
        ctx.globalAlpha = 1;
      }
    }, { island: id });
    S.registerDynamic(700, (ctx) => {
      const a = nightGlow();
      if (a <= 0.02) return;
      if (!g.glowCv) g.glowCv = buildGlow(id);
      ctx.globalAlpha = a * 0.92;
      ctx.drawImage(g.glowCv, g.ox, g.oy);
      ctx.globalAlpha = 1;
    }, { island: id });
  }

})();
