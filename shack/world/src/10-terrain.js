/* The Shack: terrain, river, roads, Town Square, Hudson House Inn, School.
 *
 * Owns (see WORLD_SPEC.md):
 *   static 0   base ground by season + the Hudson River (west edge, harbour bay)
 *   static 10  roads along every S.nav.edges polyline (styled per region) + plaza paving
 *   static 40  Town Square furniture, clock tower, fountain, quest board, mail post,
 *              Hudson House Inn, the School
 *   static 50  scattered trees / rocks / flowers / fences, East Meadow + Riverside decor
 *   static 95  reads back which river pixels are still open water (after every
 *              module has drawn its piers and ships) so the shimmer never paints over them
 *   dyn 100    river shimmer + shoreline foam      dyn 200  fountain water, payday bunting
 *   dyn 400    clock tower (people walk under its arch), bell, school flag, chimney smoke
 *   dyn 700    clock face (real New York time), lit windows and lamp glass at night
 *   dyn 800    quest marker over the board while "you" tasks are open
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S) return;

  const TILE = S.TILE, W = S.W, H = S.H, COLS = S.COLS, ROWS = S.ROWS;
  const P = S.PAL, CO = S.color;
  const sh = CO.shade, mix = CO.mix;
  const RGBC = {};
  const rgb = (h) => RGBC[h] || (RGBC[h] = CO.hexToRgb(h));
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const R = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x | 0, y | 0, w | 0, h | 0); };
  const D = (c, x, y, col) => { c.fillStyle = col; c.fillRect(x | 0, y | 0, 1, 1); };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const hash = S.hash;

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
  /** Smooth noise sampled from a quarter-res grid (cheap per pixel). */
  function noiseField(scale, seed) {
    const gw = (W >> 2) + 2, gh = (H >> 2) + 2, g = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) g[j * gw + i] = fbm((i * 4) / scale, (j * 4) / scale, seed);
    return (x, y) => {
      const fx = x / 4, fy = y / 4, i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * gw + i;
      const a = g[k], b = g[k + 1], c = g[k + gw], d = g[k + gw + 1];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }

  /* ------------------------------------------------------------ layout (tiles / px) */
  const CX = 528;                       // centre line of the north-south square road (px)
  const TOWER = { x0: 496, x1: 560, base: 256, top: 112 };
  const ARCH = { cx: 528, hw: 14, spring: 238, top: 224 };
  const BELL = { x: 528, y: 159 };
  const FACE = { x: 528, y: 196, r: 11 };
  const FOUNTAIN = { x: 568, y: 373 };
  const BOARD = { x: 434, y: 268, w: 44, base: 304 };
  const MAIL = { x: 578, base: 304 };
  const INN = { x0: 112, x1: 240, base: 320, roofTop: 226 };
  const SCHOOL = { x0: 416, x1: 512, base: 112 };
  const FLAG = { x: 442, base: 126, top: 66 };
  const FIELD = { x0: 568, y0: 24, x1: 632, y1: 150 };
  const POND = { x: 676, y: 292, rx: 22, ry: 11 };
  const LAMPS = [[502, 318], [554, 318], [618, 366], [427, 366], [618, 318], [327, 316], [264, 316]];
  const BENCHES = [[449, 372], [469, 384], [600, 284], [410, 228], [592, 228]];
  const PLANTERS = [[430, 386, 34, 14], [596, 398, 26, 12]];

  // Reserve every tile our buildings and solid props occupy (at load, per the contract).
  S.reserve(30, 7, 6, 9);    // clock tower (x30-35, y7-15) incl. its flanking planters
  S.reserve(27, 16, 3, 3);   // quest board
  S.reserve(36, 17, 1, 2);   // mail post
  S.reserve(34, 22, 3, 3);   // fountain
  S.reserve(6, 13, 9, 7);    // Hudson House Inn + sign
  S.reserve(4, 22, 7, 4);    // inn patio, jetty
  S.reserve(25, 1, 8, 7);    // school + flag + bike rack
  S.reserve(35, 1, 5, 9);    // school field
  S.reserve(26, 22, 4, 4);   // planter + benches (square SW)
  S.reserve(37, 24, 2, 2);   // planter (square SE)
  S.reserve(25, 13, 3, 3);   // square NW garden
  S.reserve(36, 13, 3, 3);   // square NE garden
  for (const [x, y] of LAMPS) S.reserve((x / TILE) | 0, ((y - 4) / TILE) | 0, 1, 1);
  S.reserve(40, 16, 5, 3);   // pond
  S.reserve(48, 19, 8, 5);   // pumpkin field

  /* ------------------------------------------------------------ data helpers */
  const openHumanTasks = () => (S.data.tasks || []).filter((t) => t && t.autonomy === 'human' && t.phase !== 'done');
  function recentCommits(days) {
    const now = S.now().getTime();
    return (S.data.commits || []).filter((c) => { const t = Date.parse(c.at); return isFinite(t) && now - t < days * 864e5 && now - t > -864e5; });
  }
  const AGENT_COL = { hub: '#e8b75a', 'academic-core': '#86d0b0', 'ledger-fi': '#f2c94c', 'social-ops': '#ff5fb0', 'hustle-engine': '#63b4e6' };

  /* ------------------------------------------------------------ hotspots + lights */
  const HOT = [
    ['clockTower', 'square', 'hub', 494, 112, 70, 146],
    ['fountain', 'square', 'hub', 542, 348, 52, 52],
    ['questBoard', 'square', 'hub', 430, 262, 52, 44],
    ['mailPost', 'square', 'hub', 574, 276, 20, 30],
    ['inn', 'riverside', 'ledger-fi', 96, 214, 148, 108],
    ['school', 'north', 'academic-core', 412, 30, 104, 84],
  ];
  for (const [key, biome, agent, x, y, w, h] of HOT) {
    const lm = S.landmarks[key] || {};
    S.addHotspot({ id: 'landmark:' + key, kind: 'landmark', landmark: key, biome, agent, label: lm.label || key, x, y, w, h, priority: 1 });
  }
  for (const [x, y] of LAMPS) S.addLight({ x: x + 1, y: y - 26, r: 30, color: P.lanternGlow, intensity: 0.85, flicker: 0.08 });
  S.addLight({ x: FACE.x, y: FACE.y, r: 22, color: '#ffe6a8', intensity: 0.7 });
  S.addLight({ x: 150, y: 300, r: 40, color: P.lantern, intensity: 0.85, flicker: 0.05 });
  S.addLight({ x: 205, y: 300, r: 40, color: P.lantern, intensity: 0.85, flicker: 0.05 });
  S.addLight({ x: 176, y: 282, r: 34, color: P.lanternGlow, intensity: 0.6 });
  S.addLight({ x: 104, y: 300, r: 18, color: P.lantern, intensity: 0.7, flicker: 0.1 });
  S.addLight({ x: 480, y: 96, r: 26, color: P.lantern, intensity: 0.6 });

  /** Window panes that glow at night (drawn at 700): [x, y, w, h]. Filled while drawing. */
  const GLOW = [];

  /* ------------------------------------------------------------ river geometry */
  const edgeX = new Float32Array(H);
  (function () {
    const c = [];
    for (let ty = -1; ty <= ROWS; ty++) c.push(S.riverEdge(clamp(ty, 0, ROWS - 1)) * TILE);
    for (let y = 0; y < H; y++) {
      const t = (y - 8) / TILE, t0 = Math.floor(t), f = t - t0;
      const a = c[t0 + 1], b = c[t0 + 2];
      edgeX[y] = a + (b - a) * smooth(f) + (vnoise(y / 7, 3.3, 5) - 0.5) * 3;
    }
  })();
  let WB = 0; for (let y = 0; y < H; y++) WB = Math.max(WB, Math.ceil(edgeX[y]) + 6);

  const SAND = '#d8c391', SAND_D = '#b59c68', SAND_W = '#8d7a56', SAND_L = '#e9d9ab';
  const WSTREAK = sh(P.waterDeep, -0.08);
  const WATER_COLS = [P.waterDeep, P.water, P.waterLight, P.foam, WSTREAK];
  const WATER_SET = new Set(WATER_COLS.map((h) => { const c = rgb(h); return (c[0] << 16) | (c[1] << 8) | c[2]; }));

  /* ------------------------------------------------------------ season */
  let season = S.time.season || 'autumn';
  const isWinter = () => season === 'winter';

  /* ======================================================================
   * static 0: base ground + river
   * ==================================================================== */
  const groundCache = {};
  function buildGround(sea) {
    const cv = mk(W, H), g = cv.getContext('2d');
    const img = g.createImageData(W, H), d = img.data;
    const winter = sea === 'winter';
    const gBase = rgb(P.grass[sea]), gDark = rgb(P.grassDark[sea]);
    const gDeep = rgb(sh(P.grassDark[sea], winter ? -0.08 : -0.16)), gLight = rgb(winter ? P.snow : sh(P.grass[sea], 0.13));
    const gMid = rgb(mix(P.grass[sea], P.grassDark[sea], 0.5));
    const sand = rgb(winter ? mix(SAND, P.snow, 0.55) : SAND), sandD = rgb(winter ? mix(SAND_D, P.snow, 0.4) : SAND_D);
    const sandW = rgb(winter ? mix(SAND_W, '#c3d1da', 0.3) : SAND_W), sandL = rgb(winter ? P.snow : SAND_L);
    const wDeep = rgb(P.waterDeep), wMid = rgb(P.water), wLight = rgb(P.waterLight), wFoam = rgb(P.foam), wStreak = rgb(WSTREAK);
    const ice = rgb('#d4e7f0'), iceD = rgb('#a9c7d6'), iceL = rgb('#f2f8fb');
    const sparkle = rgb('#ffffff');
    const n1 = noiseField(58, 11), n2 = noiseField(17, 23);
    const set = (i, c) => { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
    for (let y = 0; y < H; y++) {
      const e = edgeX[y];
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, b = bay(x, y);
        let c;
        if (x < e) {
          const dd = e - x;
          if (winter && dd < 5 + n2(x, y) * 7) c = dd < 1.5 ? iceD : (b < 0.12 ? iceL : hash(x >> 2, y, 77) < 0.08 ? iceD : ice);
          else if (dd < 1.4) c = b < 0.8 ? wFoam : wLight;
          else if (dd < 3.2) c = b < 0.55 ? wLight : wMid;
          else if (dd < 9) c = b < (9 - dd) / 6 * 0.45 ? wLight : wMid;
          else {
            const deep = (x < 22 + n1(x, y) * 26) ? 1 : 0;
            const edge = 22 + n1(x, y) * 26 - x;
            c = deep ? (edge < 5 && b < 0.5 ? wMid : wDeep) : wMid;
            const sx = ((x + (y * 7) % 5) / 4) | 0;
            const hs = hash(sx, y, 9);
            if (hs < 0.022) c = wLight; else if (hs < 0.05) c = deep ? wStreak : wDeep;
          }
        } else {
          const ds = x - e;
          const wob = n2(x, y) * 3;
          if (ds < 1.3) c = sandW;
          else if (ds < 3.5 + wob) c = hash(x, y, 5) < 0.12 ? sandD : (b < 0.1 ? sandL : sand);
          else if (ds < 5 + wob) c = b < 0.5 ? sand : gBase;
          else {
            const n = n1(x, y) * 0.7 + n2(x, y) * 0.3;
            const v = n + (b - 0.5) * 0.14;
            c = v > 0.71 ? gDark : v > 0.6 ? gMid : v < 0.29 ? gLight : gBase;
            if (v > 0.78 && b < 0.3) c = gDeep;
            const hs = hash(x, y, 21);
            if (hs < 0.03) c = gDark; else if (hs < 0.042) c = winter ? sparkle : gLight;
          }
        }
        set(i, c);
      }
    }
    // Grass tufts (little three-blade clumps), lit from the top-left.
    const tuftD = winter ? rgb('#a7b8c6') : gDeep, tuftL = winter ? rgb('#eef4f8') : gLight;
    for (let cy = 2; cy < H - 4; cy += 6) for (let cx = 2; cx < W - 6; cx += 7) {
      const h = hash(cx, cy, 31);
      if (h > (winter ? 0.16 : 0.4)) continue;
      const x = cx + ((h * 997) | 0) % 5, y = cy + ((h * 7919) | 0) % 4;
      if (x - edgeX[y] < 9) continue;
      const big = h < 0.2;
      const pts = big ? [[2, 0, 1], [0, 1, 0], [2, 1, 0], [4, 1, 0], [1, 2, 0], [2, 2, 0], [3, 2, 0]] : [[1, 0, 1], [0, 1, 0], [1, 1, 0], [2, 1, 0]];
      for (const [px, py, l] of pts) set(((y + py) * W + x + px) * 4, l ? tuftL : tuftD);
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  S.registerStatic(0, (ctx) => {
    if (!groundCache[season]) groundCache[season] = buildGround(season);
    ctx.drawImage(groundCache[season], 0, 0);
  });

  /* ======================================================================
   * static 10: roads + plaza
   * ==================================================================== */
  const ORI = new Uint8Array(COLS * ROWS); // 1 = horizontal segment, 2 = vertical
  for (const [, , pts] of S.nav.edges) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const o = y0 === y1 ? 1 : 2;
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1) + 1; y++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1) + 1; x++)
          if (x < COLS && y < ROWS) ORI[y * COLS + x] |= o;
    }
  }
  const PLAZA = { x0: 416, y0: 258, x1: 624, y1: 416, r: 16 };
  function inPlaza(x, y) {
    if (x < PLAZA.x0 || x >= PLAZA.x1 || y < PLAZA.y0 || y >= PLAZA.y1) return false;
    const r = PLAZA.r;
    const cx = x < PLAZA.x0 + r ? PLAZA.x0 + r : x >= PLAZA.x1 - r ? PLAZA.x1 - r - 1 : x;
    const cy = y < PLAZA.y0 + r ? PLAZA.y0 + r : y >= PLAZA.y1 - r ? PLAZA.y1 - r - 1 : y;
    return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
  }
  const STYLE_OF = { square: 'cobble', monastery: 'steps', port: 'plank', market: 'neon', mine: 'gravel' };
  const roadCache = {};

  function buildRoads(sea) {
    const winter = sea === 'winter';
    const cv = mk(W, H), g = cv.getContext('2d');
    const img = g.createImageData(W, H), d = img.data;
    const M = new Uint8Array(W * H);
    const road = (tx, ty) => S.onRoad(tx, ty);
    // pixel mask: road tiles with rounded outer corners, plus the plaza
    for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
      if (!road(tx, ty)) continue;
      const L = road(tx - 1, ty), Rt = road(tx + 1, ty), U = road(tx, ty - 1), Dn = road(tx, ty + 1);
      for (let ly = 0; ly < TILE; ly++) for (let lx = 0; lx < TILE; lx++) {
        const rr = 4;
        let cut = false;
        if (!L && !U && lx < rr && ly < rr) cut = (rr - lx) ** 2 + (rr - ly) ** 2 > rr * rr + 1;
        if (!Rt && !U && lx > 15 - rr && ly < rr) cut = (lx - 15 + rr) ** 2 + (rr - ly) ** 2 > rr * rr + 1;
        if (!L && !Dn && lx < rr && ly > 15 - rr) cut = (rr - lx) ** 2 + (ly - 15 + rr) ** 2 > rr * rr + 1;
        if (!Rt && !Dn && lx > 15 - rr && ly > 15 - rr) cut = (lx - 15 + rr) ** 2 + (ly - 15 + rr) ** 2 > rr * rr + 1;
        if (!cut) M[(ty * TILE + ly) * W + tx * TILE + lx] = 1;
      }
    }
    for (let y = PLAZA.y0; y < PLAZA.y1; y++) for (let x = PLAZA.x0; x < PLAZA.x1; x++) if (inPlaza(x, y)) M[y * W + x] = 1;
    // Manhattan distance to the edge (capped)
    const DT = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) DT[i] = M[i] ? 30 : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!DT[i]) continue;
      let v = DT[i];
      if (x > 0) v = Math.min(v, DT[i - 1] + 1); else v = Math.min(v, 1);
      if (y > 0) v = Math.min(v, DT[i - W] + 1); else v = Math.min(v, 1);
      DT[i] = v;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; if (!DT[i]) continue;
      let v = DT[i];
      if (x < W - 1) v = Math.min(v, DT[i + 1] + 1); else v = Math.min(v, 1);
      if (y < H - 1) v = Math.min(v, DT[i + W] + 1); else v = Math.min(v, 1);
      DT[i] = v;
    }
    const nR = noiseField(9, 51), nM = noiseField(23, 61);
    const C = (h) => rgb(h);
    const dirt = [C(P.dirtDark), C(P.dirt), C(P.dirtLight), C(sh(P.dirtDark, -0.2)), C(sh(P.dirtLight, 0.2))];
    const cob = { d: C(P.cobbleDark), b: C(P.cobble), l: C(P.cobbleLight), o: C(mix(P.cobbleDark, P.outline, 0.45)), m: C(sh(P.cobbleDark, -0.12)), w: C(sh(P.cobbleLight, 0.25)), v: C(mix(P.cobble, '#a99a84', 0.6)), u: C(mix(P.cobble, '#8d96a0', 0.5)) };
    const brass = { b: C(P.gold), d: C(P.goldDark), o: C('#7a5a22'), l: C('#fbe7a1') };
    const stp = { b: C('#959a8e'), l: C('#bcc0b2'), d: C('#6f736a'), o: C('#4b4e48'), m: C('#6f8d4a'), ml: C('#8aa95c') };
    const pl = { b: C(P.plank), d: C(P.plankDark), l: C(sh(P.plank, 0.18)), g: C('#4f3520'), o: C('#3e2a18'), n: C('#2b2018') };
    const ne = { b: C('#3b2a4d'), g: C('#271b36'), l: C('#4f3b66'), alt: C('#45325a'), o: C('#160f22'), cy: C(P.neonCyan), pk: C(P.neonPink), cyd: C(mix('#3b2a4d', P.neonCyan, 0.35)), pkd: C(mix('#3b2a4d', P.neonPink, 0.35)) };
    const gr = { b: C('#8c7c69'), l: C('#ab9c8b'), d: C('#665848'), s: C('#c2b6a5'), o: C('#4f4436') };
    const snow = C(P.snow), snowD = C('#c9d6e0');
    const grassE = C(P.grassDark[sea]), grassB = C(P.grass[sea]);
    const set = (i, c) => { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
    // Voronoi cobbles
    const CW = 8, CH = 7;
    const seed = (cx, cy) => [cx * CW + 1 + hash(cx, cy, 3) * (CW - 2), cy * CH + 1 + hash(cx, cy, 4) * (CH - 2)];
    function cobble(x, y, dd, tl, edgeH) {
      if (dd <= 1) return cob.o;
      if (dd <= 4) { // curb stones
        const along = edgeH ? x : y;
        if (along % 9 === 0) return cob.m;
        if (dd === 2) return tl ? cob.d : cob.l;
        return dd === 3 ? (tl ? cob.b : cob.l) : cob.b;
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
    function compass(x, y) { // brass compass-rose inlay at the crossing (the hub)
      const dx = x - CX, dy = y - 336, r = Math.sqrt(dx * dx + dy * dy);
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
    function steps(x, y, dd) {
      if (dd <= 1) return stp.o;
      const row = Math.floor(y / 6), ly = y % 6;
      if (ly === 5) return stp.o;
      if (ly === 4) return stp.d;
      if ((x + row * 5) % 11 === 0) return stp.d;
      const n = nM(x, y);
      if (n > 0.62 && bay(x, y) < (n - 0.62) * 4) return ly === 0 ? stp.ml : stp.m;
      if (ly === 0) return stp.l;
      return hash(x, y, 8) < 0.08 ? stp.d : stp.b;
    }
    function plank(x, y, dd, tl, o) {
      if (dd <= 1) return pl.o;
      const across = o === 1 ? x : y, along = o === 1 ? y : x;
      const board = Math.floor(across / 4), w = across % 4;
      if (w === 3) return pl.g;
      if (dd === 2 && !tl) return pl.d;
      const bh = hash(board, 1, 12);
      if (((along + board * 5) % 16 === 2 || (along + board * 5) % 16 === 13) && w === 1) return pl.n;
      if ((along + board * 7) % 13 === 0 && w === 1) return pl.d;
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
      return n > 0.6 ? gr.d : n < 0.35 ? gr.l : gr.b;
    }
    function dirtPx(x, y, dd, tl) {
      if (dd === 1 && hash(x, y, 7) < 0.45) return null;               // ragged edge
      if (dd <= 2 && hash(x, y, 17) < 0.12) return hash(x, y, 18) < 0.5 ? grassE : grassB; // grass creeping in
      if (dd === 1) return tl ? dirt[3] : dirt[0];
      if (dd === 2) return tl ? dirt[0] : (bay(x, y) < 0.5 ? dirt[2] : dirt[1]);
      // pebbles
      const pcx = Math.floor(x / 6), pcy = Math.floor(y / 5), ph = hash(pcx, pcy, 41);
      if (ph < 0.2) {
        const px0 = pcx * 6 + 1 + ((ph * 50) | 0) % 3, py0 = pcy * 5 + 1;
        if (x === px0 && y === py0) return dirt[4];
        if ((x === px0 + 1 && y === py0) || (x === px0 && y === py0 + 1)) return dirt[2];
        if (x === px0 + 1 && y === py0 + 1) return dirt[3];
      }
      const v = nR(x, y) + (bay(x, y) - 0.5) * 0.3;
      return v > 0.66 ? dirt[0] : v < 0.33 ? dirt[2] : dirt[1];
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x, dd = DT[k];
      if (!dd) continue;
      const tx = (x / TILE) | 0, ty = (y / TILE) | 0;
      const biome = S.biomeAt(tx, ty);
      let style = STYLE_OF[biome] || 'dirt';
      if (style === 'cobble' && (x < PLAZA.x0 || x >= PLAZA.x1 || y >= PLAZA.y1)) style = 'dirt';
      const up = y - dd >= 0 && !M[(y - dd) * W + x], left = x - dd >= 0 && !M[k - dd];
      const tl = up || left;
      const edgeH = up || (y + dd < H && !M[(y + dd) * W + x]);
      let c;
      if (style === 'cobble') c = compass(x, y) || cobble(x, y, dd, tl, edgeH);
      else if (style === 'steps') c = steps(x, y, dd);
      else if (style === 'plank') c = plank(x, y, dd, tl, (ORI[ty * COLS + tx] & 2) ? 2 : 1);
      else if (style === 'neon') c = neon(x, y, dd);
      else if (style === 'gravel') c = gravel(x, y, dd, tl);
      else c = dirtPx(x, y, dd, tl);
      if (!c) continue;
      if (winter && style !== 'neon') {
        const n = nM(x, y), b = bay(x, y);
        const cover = style === 'cobble' ? (dd <= 5 ? 0.55 : n > 0.68 ? 0.4 : 0) : (dd <= 3 ? 0.8 : n > 0.5 ? (n - 0.5) * 3 : 0.1);
        if (b < cover) c = b < cover * 0.35 ? snowD : snow;
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
   * Drawing primitives for buildings and props
   * ==================================================================== */
  function ell(c, cx, cy, rx, ry, col) {
    c.fillStyle = col;
    for (let dy = -ry; dy <= ry; dy++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((ry + 0.35) * (ry + 0.35)))));
      c.fillRect(Math.round(cx - w), Math.round(cy + dy), w * 2 + 1, 1);
    }
  }
  const shadow = (c, cx, cy, rx, ry) => ell(c, cx, cy, rx, ry, P.shadow);
  /** Outlined box with 3-tone bevel (light top/left, dark bottom/right). */
  function box(c, x, y, w, h, base, opt = {}) {
    const o = opt.outline || P.outline;
    R(c, x, y, w, h, o);
    R(c, x + 1, y + 1, w - 2, h - 2, base);
    R(c, x + 1, y + 1, w - 2, 1, opt.light || sh(base, 0.22));
    R(c, x + 1, y + 1, 1, h - 2, opt.light || sh(base, 0.22));
    R(c, x + 1, y + h - 2, w - 2, 1, opt.dark || sh(base, -0.25));
    R(c, x + w - 2, y + 1, 1, h - 2, opt.dark || sh(base, -0.25));
  }
  function bricks(c, x, y, w, h, base, seed = 0) {
    const mortar = sh(base, -0.35), lt = sh(base, 0.14), dk = sh(base, -0.12);
    R(c, x, y, w, h, mortar);
    for (let row = 0, yy = y; yy < y + h; row++, yy += 4) {
      const off = row % 2 ? 4 : 0;
      for (let xx = x - off; xx < x + w; xx += 8) {
        const bx = Math.max(x, xx), bw = Math.min(xx + 7, x + w) - bx, bh = Math.min(3, y + h - yy);
        if (bw <= 0 || bh <= 0) continue;
        const hv = hash(xx, yy, seed);
        R(c, bx, yy, bw, bh, hv < 0.2 ? dk : hv > 0.85 ? lt : base);
        R(c, bx, yy, bw, 1, hv > 0.85 ? sh(lt, 0.1) : lt);
      }
    }
  }
  function siding(c, x, y, w, h, base) {
    const lt = sh(base, 0.12), dk = sh(base, -0.18), ln = sh(base, -0.3);
    for (let yy = y; yy < y + h; yy++) {
      const k = (yy - y) % 4;
      R(c, x, yy, w, 1, k === 0 ? lt : k === 3 ? ln : k === 2 ? dk : base);
    }
    for (let yy = y; yy < y + h; yy++) if (bay(x, yy) < 0.5) D(c, x + w - 1, yy, ln);
  }
  function shingles(c, x, y, w, h, base, seed = 0) {
    const lt = sh(base, 0.16), dk = sh(base, -0.22), ln = sh(base, -0.4);
    R(c, x, y, w, h, base);
    for (let row = 0, yy = y; yy < y + h; row++, yy += 4) {
      const off = row % 2 ? 3 : 0;
      for (let xx = x - off; xx < x + w; xx += 6) {
        const bx = Math.max(x, xx), bw = Math.min(xx + 6, x + w) - bx;
        if (bw <= 0) continue;
        const hv = hash(xx, yy, seed + 3);
        const col = hv < 0.25 ? dk : hv > 0.82 ? lt : base;
        R(c, bx, yy, bw, Math.min(4, y + h - yy), col);
        if (xx >= x) R(c, xx, yy, 1, Math.min(3, y + h - yy), ln);
        R(c, bx, Math.min(yy + 3, y + h - 1), bw, 1, ln);
        if (bw > 2) D(c, bx + 1, yy, lt);
      }
    }
  }
  /** A window with frame, glass reflection, muntins and sill. glow=true registers a night pane. */
  function windowPx(c, x, y, w, h, o = {}) {
    const trim = o.trim || '#f1ece0', glass = o.glass || '#35506b';
    R(c, x - 1, y - 1, w + 2, h + 2, P.outline);
    R(c, x, y, w, h, trim);
    R(c, x + 1, y + 1, w - 2, h - 2, glass);
    R(c, x + 1, y + 1, w - 2, 1, sh(glass, -0.3));
    // diagonal reflection
    for (let i = 0; i < Math.min(w, h) - 3; i++) if (i % 3 !== 2) D(c, x + 2 + i, y + h - 3 - i, sh(glass, 0.45));
    if (o.muntin !== false) { R(c, x + (w >> 1), y + 1, 1, h - 2, trim); if (h > 7) R(c, x + 1, y + (h >> 1), w - 2, 1, trim); }
    R(c, x - 1, y + h, w + 2, 1, sh(trim, -0.15));
    R(c, x - 1, y + h + 1, w + 2, 1, P.shadow);
    if (o.shutter) {
      for (const sx of [x - 4, x + w + 1]) {
        R(c, sx, y - 1, 3, h + 2, P.outline);
        R(c, sx + 1, y, 1, h, o.shutter);
        for (let yy = y; yy < y + h; yy += 2) D(c, sx + 1, yy, sh(o.shutter, 0.2));
      }
    }
    if (o.glow !== false) GLOW.push([x + 1, y + 1, w - 2, h - 2]);
  }
  function snowCap(c, x, y, w, depth, seed = 0) {
    for (let xx = x; xx < x + w; xx++) {
      const dd = depth + Math.round((vnoise(xx / 5, seed, 41) - 0.5) * 3);
      R(c, xx, y, 1, Math.max(1, dd), P.snow);
      D(c, xx, y + Math.max(1, dd), '#c3d1da');
      if (hash(xx, seed, 3) < 0.08) R(c, xx, y + dd + 1, 1, 2, '#e6f1f7');
    }
    R(c, x, y, w, 1, '#ffffff');
  }

  /* ======================================================================
   * Clock tower (cached: also redrawn at 400 so villagers pass under the arch)
   * ==================================================================== */
  const TWR = { ox: 486, oy: 108, w: 84, h: 152 };
  const SAND_ST = { b: '#cdb48c', l: '#e4d1aa', d: '#a48a64', m: '#7d6648', o: '#3d2f22' };
  const BRICK = '#a4533e';
  let towerCv = null, towerOver = null, towerSeason = null;
  function stoneBlocks(c, x, y, w, h, seed) {
    R(c, x, y, w, h, SAND_ST.m);
    for (let row = 0, yy = y; yy < y + h; row++, yy += 6) {
      let xx = x - (row % 2 ? 6 : 0);
      while (xx < x + w) {
        const bw = 10 + ((hash(xx, yy, seed) * 5) | 0);
        const bx = Math.max(x, xx), ex = Math.min(xx + bw - 1, x + w), hh = Math.min(5, y + h - yy);
        if (ex - bx > 0 && hh > 0) {
          const hv = hash(xx, yy, seed + 1);
          R(c, bx, yy, ex - bx, hh, hv < 0.25 ? sh(SAND_ST.b, -0.06) : SAND_ST.b);
          R(c, bx, yy, ex - bx, 1, SAND_ST.l);
          R(c, bx, yy, 1, hh, SAND_ST.l);
          R(c, bx, yy + hh - 1, ex - bx, 1, SAND_ST.d);
          if (hv > 0.7) D(c, bx + 3, yy + 2, SAND_ST.d);
        }
        xx += bw;
      }
    }
  }
  function drawTowerInto(c, winter) {
    c.save();
    c.translate(-TWR.ox, -TWR.oy);
    const x0 = TOWER.x0, x1 = TOWER.x1;
    // base block with the arch
    stoneBlocks(c, x0, 220, x1 - x0, 36, 2);
    R(c, x0 - 1, 251, x1 - x0 + 2, 5, SAND_ST.d); R(c, x0 - 1, 251, x1 - x0 + 2, 1, SAND_ST.b); R(c, x0 - 1, 255, x1 - x0 + 2, 1, SAND_ST.m);
    // shade right side of base
    for (let y = 220; y < 256; y++) for (let x = x1 - 5; x < x1; x++) if (bay(x, y) < (x - x1 + 6) / 7) D(c, x, y, SAND_ST.d);
    // arch voussoirs + opening
    const A = ARCH;
    for (let y = A.top - 4; y < 256; y++) {
      const dy = A.spring - y;
      const ro = dy > 0 ? Math.sqrt(Math.max(0, (A.hw + 4) ** 2 - dy * dy)) : A.hw + 4;
      const ri = dy > 0 ? Math.sqrt(Math.max(0, A.hw ** 2 - dy * dy)) : A.hw;
      if (ro <= 0) continue;
      const xa = Math.round(A.cx - ro), xb = Math.round(A.cx + ro);
      const xi0 = Math.round(A.cx - ri), xi1 = Math.round(A.cx + ri);
      if (y < A.spring + 2) {
        for (let x = xa; x < xb; x++) {
          if (x >= xi0 && x < xi1 && ri > 0) continue;
          const ang = Math.atan2(A.spring - y, x - A.cx + 0.5);
          const seg = Math.floor(ang / (Math.PI / 9));
          D(c, x, y, seg % 2 ? SAND_ST.l : SAND_ST.b);
        }
      }
      if (ri > 0) {
        R(c, xi0 - 1, y, 1, 1, SAND_ST.o); R(c, xi1, y, 1, 1, SAND_ST.o);
        R(c, xi0, y, xi1 - xi0, 1, '#241c2a');
      }
    }
    // keystone
    box(c, A.cx - 3, A.top - 6, 7, 8, SAND_ST.l, { outline: SAND_ST.o });
    // tunnel: light at the far end + floor
    for (let y = A.top + 6; y < 256; y++) {
      const dy = A.spring + 6 - y;
      const r = dy > 0 ? Math.sqrt(Math.max(0, 64 - dy * dy)) : 8;
      if (r > 0) R(c, Math.round(A.cx - r), y, Math.round(r * 2), 1, y > 246 ? '#6b6170' : '#4a4152');
    }
    R(c, A.cx - A.hw, 252, A.hw * 2, 4, '#3a3140');
    for (let x = A.cx - A.hw; x < A.cx + A.hw; x += 3) D(c, x, 253, '#4b4252');
    // ledge 1
    R(c, x0 - 3, 216, x1 - x0 + 6, 4, SAND_ST.o); R(c, x0 - 2, 216, x1 - x0 + 4, 1, SAND_ST.l); R(c, x0 - 2, 217, x1 - x0 + 4, 1, SAND_ST.b); R(c, x0 - 2, 218, x1 - x0 + 4, 1, SAND_ST.d);
    // brick shaft
    const sx0 = 502, sx1 = 554;
    R(c, sx0 - 1, 176, sx1 - sx0 + 2, 40, P.outline);
    bricks(c, sx0, 176, sx1 - sx0, 40, BRICK, 4);
    for (let y = 176; y < 216; y++) for (let x = sx1 - 6; x < sx1; x++) if (bay(x, y) < (x - sx1 + 7) / 8) D(c, x, y, sh(BRICK, -0.3));
    // quoins
    for (let i = 0, y = 176; y < 216; i++, y += 5) {
      const wq = i % 2 ? 4 : 7;
      box(c, sx0, y, wq, 5, SAND_ST.b, { outline: SAND_ST.m });
      box(c, sx1 - wq, y, wq, 5, SAND_ST.d, { outline: SAND_ST.m, light: SAND_ST.b, dark: SAND_ST.m });
    }
    // clock surround plate
    box(c, FACE.x - 15, FACE.y - 15, 31, 31, SAND_ST.b, { outline: SAND_ST.o });
    for (const [ox, oy] of [[-13, -13], [11, -13], [-13, 11], [11, 11]]) { R(c, FACE.x + ox, FACE.y + oy, 3, 3, P.goldDark); D(c, FACE.x + ox, FACE.y + oy, P.gold); }
    // static face (dynamic layer redraws hands)
    c.drawImage(faceCv(false), FACE.x - FACE.r - 2, FACE.y - FACE.r - 2);
    // ledge 2
    R(c, sx0 - 4, 172, sx1 - sx0 + 8, 4, SAND_ST.o); R(c, sx0 - 3, 172, sx1 - sx0 + 6, 1, SAND_ST.l); R(c, sx0 - 3, 173, sx1 - sx0 + 6, 1, SAND_ST.b); R(c, sx0 - 3, 174, sx1 - sx0 + 6, 1, SAND_ST.d);
    // belfry
    const bx0 = 504, bx1 = 552;
    stoneBlocks(c, bx0, 150, bx1 - bx0, 22, 9);
    R(c, bx0, 150, 1, 22, SAND_ST.o); R(c, bx1 - 1, 150, 1, 22, SAND_ST.o);
    for (let y = 154; y < 168; y++) {
      const dy = 160 - y, r = dy > 0 ? Math.sqrt(Math.max(0, 144 - dy * dy * 2.2)) : 12;
      if (r > 0) { R(c, Math.round(CX - r) - 1, y, Math.round(r * 2) + 2, 1, SAND_ST.o); R(c, Math.round(CX - r), y, Math.round(r * 2), 1, y < 158 ? '#1c1622' : '#2a2130'); }
    }
    R(c, CX - 12, 156, 24, 1, '#5a4030');   // bell beam
    // balustrade
    R(c, bx0 + 2, 166, bx1 - bx0 - 4, 6, SAND_ST.o);
    R(c, bx0 + 2, 166, bx1 - bx0 - 4, 1, SAND_ST.l);
    for (let x = bx0 + 4; x < bx1 - 4; x += 3) R(c, x, 167, 2, 4, SAND_ST.b);
    // roof (pyramid)
    const peak = 124, eave = 150;
    for (let y = peak; y <= eave; y++) {
      const hw = Math.round(1 + (y - peak) / (eave - peak) * 29);
      R(c, CX - hw - 1, y, hw * 2 + 2, 1, P.outline);
      for (let x = CX - hw; x < CX + hw; x++) {
        const row = Math.floor((y - peak) / 4), ly = (y - peak) % 4;
        const sc = (x + (row % 2) * 3) % 6;
        let col = x < CX ? '#5c6a85' : '#46526a';
        if (ly === 3 || sc === 0) col = x < CX ? '#46526a' : '#363f54';
        else if (ly === 0 && x < CX) col = '#74829e';
        if (x === CX || x === CX - 1) col = '#7f6a3d';
        D(c, x, y, col);
      }
    }
    R(c, CX - 32, eave, 64, 2, P.outline); R(c, CX - 31, eave, 62, 1, '#363f54');
    if (winter) {
      for (let y = peak + 2; y < eave; y++) {
        const hw = Math.round(1 + (y - peak) / (eave - peak) * 29);
        for (let x = CX - hw; x < CX - hw + Math.max(2, hw * 0.55); x++) if (bay(x, y) < 0.75 - (y - peak) / 40) D(c, x, y, P.snow);
      }
      snowCap(c, x0 - 2, 214, x1 - x0 + 4, 2, 5);
      snowCap(c, sx0 - 3, 170, sx1 - sx0 + 6, 2, 6);
    }
    // finial + weather vane
    R(c, CX - 1, 113, 2, 11, P.outline); D(c, CX - 1, 114, P.gold);
    R(c, CX - 2, 120, 4, 4, P.outline); R(c, CX - 1, 121, 2, 2, P.gold); D(c, CX - 1, 121, '#fff2b8');
    R(c, CX - 7, 115, 14, 1, P.outline); R(c, CX - 6, 115, 12, 1, P.goldDark);
    R(c, CX + 5, 114, 2, 3, P.goldDark); R(c, CX - 8, 113, 2, 5, P.goldDark); D(c, CX - 8, 113, P.gold);
    c.restore();
  }
  function bellAt(c, x, y, swing) {
    const s = swing | 0;
    R(c, x - 1, y - 3, 2, 3, '#5a4030');
    const rows = [[3, 0], [4, 1], [4, 2], [5, 3], [5, 4], [5, 5], [6, 6], [7, 7]];
    for (const [hw, dy] of rows) {
      const xx = x - hw + s * (dy / 7), yy = y + dy;
      R(c, Math.round(xx) - 1, yy, hw * 2 + 2, 1, P.outline);
    }
    for (const [hw, dy] of rows) {
      const xx = Math.round(x - hw + s * (dy / 7)), yy = y + dy;
      R(c, xx, yy, hw * 2, 1, P.gold);
      R(c, xx, yy, 2, 1, '#fff0b0');
      R(c, xx + hw * 2 - 3, yy, 3, 1, P.goldDark);
    }
    R(c, Math.round(x - 1 + s * 1.3), y + 8, 2, 2, P.outline);
  }
  function ensureTower() {
    if (towerCv && towerSeason === season) return;
    towerSeason = season;
    towerCv = mk(TWR.w, TWR.h);
    drawTowerInto(towerCv.getContext('2d'), isWinter());
    towerOver = mk(TWR.w, TWR.h);
    const o = towerOver.getContext('2d');
    o.drawImage(towerCv, 0, 0);
    o.globalCompositeOperation = 'destination-out';
    o.fillStyle = '#000';
    for (let y = ARCH.top; y < 256; y++) {
      const dy = ARCH.spring - y;
      const ri = dy > 0 ? Math.sqrt(Math.max(0, ARCH.hw ** 2 - dy * dy)) : ARCH.hw;
      if (ri > 0) o.fillRect(Math.round(ARCH.cx - ri) - TWR.ox, y - TWR.oy, Math.round(ri * 2), 1);
    }
  }

  /* clock face: cached disc, hands drawn per frame */
  const faceCache = {};
  function faceCv(night) {
    const k = night ? 'n' : 'd';
    if (faceCache[k]) return faceCache[k];
    const r = FACE.r, s = r * 2 + 5, c = mk(s, s).getContext('2d');
    const m = r + 2;
    ell(c, m, m, r + 2, r + 2, P.outline);
    ell(c, m, m, r + 1, r + 1, P.goldDark);
    ell(c, m - 0.5, m - 0.5, r + 1, r + 1, P.gold);
    ell(c, m, m, r, r, P.goldDark);
    const fc = night ? '#fff1c4' : '#f4ead2';
    ell(c, m, m, r - 1, r - 1, fc);
    // inner shading bottom-right
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const q = x * x + y * y;
      if (q < (r - 1) * (r - 1) && q > (r - 3) * (r - 3) && x + y > 2) D(c, m + x, m + y, night ? '#f2dc9e' : '#ddd0b0');
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, rr = r - 2.5;
      const x = Math.round(m + Math.sin(a) * rr), y = Math.round(m - Math.cos(a) * rr);
      D(c, x, y, i % 3 === 0 ? '#2b2633' : '#8a7a62');
      if (i % 3 === 0) D(c, Math.round(m + Math.sin(a) * (rr - 1)), Math.round(m - Math.cos(a) * (rr - 1)), '#2b2633');
    }
    faceCache[k] = c.canvas;
    return c.canvas;
  }

  /* ======================================================================
   * Fountain
   * ==================================================================== */
  const FT = { rx: 22, ry: 10, wall: 6, wrx: 18, wry: 7 };
  function inBasinWater(x, y) {
    const dx = (x - FOUNTAIN.x) / (FT.wrx + 0.4), dy = (y - FOUNTAIN.y) / (FT.wry + 0.4);
    return dx * dx + dy * dy <= 1;
  }
  function drawFountain(c, winter) {
    const { x, y } = FOUNTAIN;
    shadow(c, x + 4, y + FT.wall + 3, FT.rx + 2, FT.ry + 1);
    // basin wall (front face)
    for (let k = FT.wall; k >= 0; k--) ell(c, x, y + k, FT.rx + 1, FT.ry + 1, P.outline);
    for (let k = FT.wall - 1; k >= 1; k--) ell(c, x, y + k, FT.rx, FT.ry, k > 3 ? '#8a847c' : '#a39d93');
    // wall joints + shading
    for (let xx = x - FT.rx; xx <= x + FT.rx; xx++) {
      const dx = (xx - x) / FT.rx, yb = Math.round(y + FT.ry * Math.sqrt(Math.max(0, 1 - dx * dx)));
      if ((xx - x + 40) % 7 === 0) R(c, xx, yb + 1, 1, FT.wall - 1, '#6f6a64');
      if (xx > x + 6) for (let k = 1; k < FT.wall; k++) if (bay(xx, yb + k) < (xx - x - 6) / 22) D(c, xx, yb + k, '#6f6a64');
      D(c, xx, yb + 1, '#c9c3b8');
    }
    // rim top
    ell(c, x, y, FT.rx, FT.ry, '#b9b2a6');
    ell(c, x - 1, y - 1, FT.rx - 1, FT.ry - 1, '#d3cdc1');
    ell(c, x, y, FT.rx - 2, FT.ry - 2, '#a39d93');
    // water
    ell(c, x, y, FT.wrx + 1, FT.wry + 1, '#6d685f');
    if (winter) {
      ell(c, x, y, FT.wrx, FT.wry, '#d6e9f2');
      ell(c, x - 3, y - 2, FT.wrx - 6, FT.wry - 3, '#eef6fa');
      for (let i = 0; i < 6; i++) D(c, x - 10 + i * 4, y + ((i * 3) % 5) - 2, '#a9c7d6');
    } else {
      ell(c, x, y, FT.wrx, FT.wry, P.water);
      ell(c, x + 1, y + 1, FT.wrx - 2, FT.wry - 2, P.waterDeep);
      for (let xx = x - FT.wrx + 2; xx < x + FT.wrx - 2; xx++) D(c, xx, y - FT.wry + 1 + ((Math.abs(xx - x) > 12) ? 1 : 0), P.waterDeep);
      // wishing coins
      for (const [ox, oy] of [[-9, 2], [6, 3], [11, -1], [-4, 4], [2, -3]]) { D(c, x + ox, y + oy, P.gold); D(c, x + ox + 1, y + oy, P.goldDark); }
    }
    // pedestal
    R(c, x - 4, y - 16, 9, 20, P.outline);
    R(c, x - 3, y - 15, 7, 19, '#a39d93');
    R(c, x - 3, y - 15, 2, 19, '#c9c3b8');
    R(c, x + 2, y - 15, 2, 19, '#7d776f');
    R(c, x - 5, y + 1, 11, 3, P.outline); R(c, x - 4, y + 1, 9, 2, '#b9b2a6');
    // upper bowl
    const by = y - 16;
    for (let k = 3; k >= 0; k--) ell(c, x, by + k, 9, 3, P.outline);
    for (let k = 2; k >= 1; k--) ell(c, x, by + k, 8, 2, '#8a847c');
    ell(c, x, by, 8, 2, '#d3cdc1');
    ell(c, x, by, 6, 1, winter ? '#e6f2f8' : P.waterLight);
    R(c, x - 1, by - 5, 3, 5, P.outline); R(c, x, by - 6, 1, 6, '#c9c3b8');
    if (winter) {
      for (const ox of [-7, -4, 3, 6]) R(c, x + ox, by + 4, 1, 2 + (ox & 1) * 2, '#e6f2f8');
      snowCap(c, x - 8, by - 2, 17, 1, 9);
      for (let xx = x - FT.rx + 3; xx < x + FT.rx - 3; xx += 1) if (hash(xx, 1, 4) < 0.7) D(c, xx, y - FT.ry + (Math.abs(xx - x) > 15 ? 2 : 0), P.snow);
    }
  }
  let fountainFrames = null;
  function buildFountainFrames() {
    const N = 8, ox = FOUNTAIN.x - 26, oy = FOUNTAIN.y - 30, w = 52, h = 44, frames = [];
    const by = FOUNTAIN.y - 16;
    for (let f = 0; f < N; f++) {
      const cv = mk(w, h), c = cv.getContext('2d');
      c.translate(-ox, -oy);
      const ph = f / N;
      // jet
      const jh = 6 + ((f % 2) ? 1 : 0);
      R(c, FOUNTAIN.x, by - 6 - jh, 1, jh, P.foam);
      D(c, FOUNTAIN.x - 1, by - 6 - jh + 1, P.waterLight); D(c, FOUNTAIN.x + 1, by - 6 - jh + 2, P.waterLight);
      D(c, FOUNTAIN.x + ((f % 3) - 1), by - 7 - jh, '#ffffff');
      // streams from the bowl to the basin
      for (const side of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
          const tt = (ph + k / 4) % 1;
          const sx = FOUNTAIN.x + side * (8 + tt * 6), sy = by + 1 + tt * tt * 14;
          D(c, Math.round(sx), Math.round(sy), tt < 0.5 ? P.foam : P.waterLight);
          if (k % 2 === 0) D(c, Math.round(sx - side), Math.round(sy) - 1, P.waterLight);
        }
        // splash ring where the stream lands
        const lx = FOUNTAIN.x + side * 14, ly = FOUNTAIN.y + 1, rr = 1 + ((f % 4));
        for (let a = 0; a < 12; a++) {
          const xx = Math.round(lx + Math.cos(a / 12 * Math.PI * 2) * rr), yy = Math.round(ly + Math.sin(a / 12 * Math.PI * 2) * rr * 0.5);
          if (inBasinWater(xx, yy) && (a + f) % 3) D(c, xx, yy, f % 4 < 2 ? P.foam : P.waterLight);
        }
      }
      // front stream
      for (let k = 0; k < 3; k++) {
        const tt = (ph + k / 3) % 1;
        D(c, FOUNTAIN.x + ((k % 2) ? 1 : -1), Math.round(by + 3 + tt * 9), P.foam);
      }
      // surface glints
      for (let i = 0; i < 6; i++) {
        const gx = Math.round(FOUNTAIN.x - 15 + hash(i, f, 71) * 30), gy = Math.round(FOUNTAIN.y - 5 + hash(i, f, 72) * 10);
        if (inBasinWater(gx, gy) && inBasinWater(gx + 1, gy)) { D(c, gx, gy, P.waterLight); if (i % 2) D(c, gx + 1, gy, P.foam); }
      }
      frames.push(cv);
    }
    fountainFrames = { frames, ox, oy };
  }

  /* ======================================================================
   * Square furniture
   * ==================================================================== */
  function drawLamp(c, x, base) {
    shadow(c, x + 3, base, 4, 1);
    R(c, x - 2, base - 3, 6, 3, P.outline); R(c, x - 1, base - 3, 4, 2, '#4a4458');
    R(c, x - 1, base - 22, 4, 20, P.outline); R(c, x, base - 22, 2, 20, '#3c3648'); R(c, x, base - 22, 1, 20, '#5d566c');
    R(c, x - 2, base - 22, 6, 1, P.outline);
    // lantern head
    R(c, x - 3, base - 31, 8, 9, P.outline);
    R(c, x - 2, base - 30, 6, 7, '#3c3648');
    R(c, x - 1, base - 29, 4, 5, '#f3dfa6'); D(c, x - 1, base - 29, '#fff7d8');
    GLOW.push([x - 1, base - 29, 4, 5]);
    R(c, x - 4, base - 33, 10, 2, P.outline); R(c, x - 3, base - 33, 8, 1, '#5d566c');
    R(c, x, base - 35, 2, 2, P.outline); D(c, x, base - 35, P.gold);
    if (isWinter()) R(c, x - 3, base - 34, 8, 1, P.snow);
  }
  function drawBench(c, x, y) {
    shadow(c, x + 9, y + 9, 9, 2);
    R(c, x, y, 16, 3, P.outline); R(c, x + 1, y + 1, 14, 1, '#b07d4a');
    R(c, x, y + 3, 16, 2, P.outline); R(c, x + 1, y + 3, 14, 1, '#9b6b3d');
    R(c, x - 1, y + 5, 18, 3, P.outline); R(c, x, y + 5, 16, 1, '#c89060'); R(c, x, y + 6, 16, 1, '#8d5f35');
    for (const lx of [x + 1, x + 13]) { R(c, lx, y, 2, 10, P.outline); D(c, lx, y + 1, '#5d566c'); R(c, lx, y + 8, 2, 2, '#3c3648'); }
    if (isWinter()) R(c, x, y + 5, 16, 1, P.snow);
  }
  function flowerCols() {
    return {
      spring: ['#f2a7c3', '#ffd34d', '#ffffff', '#c58cf0'],
      summer: ['#ff6b6b', '#ffd34d', '#ff9fd0', '#7aa7ff'],
      autumn: ['#e8722f', '#f2c94c', '#b8432f', '#c86ad0'],
      winter: ['#7e8f86', '#5f726a', '#b8432f', '#7e8f86'],
    }[season];
  }
  function drawPlanter(c, x, y, w, h) {
    shadow(c, x + w / 2 + 3, y + h + 1, w / 2 + 1, 2);
    box(c, x, y, w, h, '#a39d93', { light: '#c9c3b8', dark: '#77726f' });
    R(c, x + 2, y + 2, w - 4, h - 5, '#5a4030');
    for (let yy = y + 2; yy < y + h - 3; yy++) for (let xx = x + 2; xx < x + w - 2; xx++) if (hash(xx, yy, 2) < 0.2) D(c, xx, yy, '#6e4f3a');
    const cols = flowerCols();
    const leaf = season === 'winter' ? '#4f6a55' : '#3f7a2a';
    for (let yy = y + 2; yy < y + h - 4; yy += 3) for (let xx = x + 3; xx < x + w - 3; xx += 3) {
      const hv = hash(xx, yy, 6);
      R(c, xx, yy + 1, 2, 2, leaf);
      if (season === 'winter') { D(c, xx, yy, P.snow); if (hv < 0.25) D(c, xx + 1, yy + 1, '#b8432f'); continue; }
      const col = cols[(hv * 4) | 0];
      D(c, xx, yy, col); D(c, xx + 1, yy, sh(col, -0.2)); D(c, xx, yy - 1, sh(col, 0.3));
    }
    R(c, x + 1, y + h - 3, w - 2, 1, '#8a847c');
    if (isWinter()) R(c, x + 1, y, w - 2, 1, P.snow);
  }
  function drawQuestBoard(c) {
    const { x, y, w, base } = BOARD;
    shadow(c, x + w / 2 + 4, base, w / 2 + 2, 3);
    // posts
    for (const px0 of [x + 3, x + w - 7]) { R(c, px0, y + 4, 4, base - y - 4, P.outline); R(c, px0 + 1, y + 4, 2, base - y - 5, '#8d5f35'); D(c, px0 + 1, y + 4, '#b07d4a'); R(c, px0 + 1, base - 3, 2, 2, '#5d3f22'); }
    // board
    const by = y + 7, bh = 22;
    R(c, x, by, w, bh, P.outline);
    R(c, x + 1, by + 1, w - 2, bh - 2, '#7a5230');
    R(c, x + 1, by + 1, w - 2, 1, '#a8774a');
    R(c, x + 3, by + 3, w - 6, bh - 6, '#b98a55');
    for (let yy = by + 3; yy < by + bh - 3; yy++) for (let xx = x + 3; xx < x + w - 3; xx++) {
      const hv = hash(xx, yy, 33);
      if (hv < 0.16) D(c, xx, yy, '#a77845'); else if (hv > 0.94) D(c, xx, yy, '#cfa06b');
    }
    R(c, x + 3, by + 3, w - 6, 1, '#94673a');
    // roof
    R(c, x - 3, y, w + 6, 7, P.outline);
    shingles(c, x - 2, y + 1, w + 4, 5, '#8a4a34', 7);
    R(c, x - 2, y + 1, w + 4, 1, '#b26a4c');
    if (isWinter()) snowCap(c, x - 2, y, w + 4, 2, 11);
    // notes: one per open "you" task
    const tasks = openHumanTasks();
    const slots = [];
    for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) slots.push([x + 5 + col * 9 + (row ? 2 : 0), by + 4 + row * 8]);
    const n = Math.min(tasks.length, 8);
    for (let i = 0; i < n; i++) {
      const t = tasks[i], [nx, ny] = slots[i];
      const tilt = hash(i, 3, 44) < 0.5 ? 0 : 1;
      const paper = t.priority === 1 ? '#fbf1d6' : t.priority === 2 ? '#f3e7c8' : '#e9dcbc';
      R(c, nx + 1, ny + 1, 7, 7, 'rgba(40,24,10,0.35)');
      R(c, nx, ny + tilt, 7, 7 - tilt, paper);
      R(c, nx, ny + 6, 7, 1, sh(paper, -0.15));
      for (let l = 0; l < 3; l++) R(c, nx + 1, ny + 2 + l * 2 + tilt, (l === 2 ? 3 : 5) - ((i + l) % 2), 1, '#8a7a62');
      if (t.priority === 1) { R(c, nx + 5, ny + 4, 2, 2, '#c0392b'); D(c, nx + 5, ny + 4, '#e86a5a'); }
      const pc = AGENT_COL[t.agent] || P.gold;
      D(c, nx + 3, ny - 1 + tilt, P.outline); D(c, nx + 3, ny + tilt, pc); D(c, nx + 2, ny + tilt, sh(pc, -0.3));
    }
    if (tasks.length > 8) { // overflow stack
      const [nx, ny] = slots[7];
      R(c, nx + 2, ny - 1, 7, 7, '#e9dcbc'); R(c, nx + 1, ny, 7, 7, '#f3e7c8'); D(c, nx + 4, ny + 3, '#8a7a62');
    }
    if (n === 0) { // honest empty board: just a few bare pins
      for (const [px0, py0] of [[x + 9, by + 6], [x + 22, by + 12], [x + 33, by + 7]]) { D(c, px0, py0, P.outline); D(c, px0, py0 + 1, '#b8b2a8'); }
    }
    // little lantern hook on the left post
    R(c, x - 2, by + 2, 2, 1, P.outline);
  }
  function drawMailPost(c) {
    const x = MAIL.x, base = MAIL.base;
    shadow(c, x + 9, base, 7, 2);
    R(c, x + 5, base - 16, 4, 16, P.outline); R(c, x + 6, base - 16, 2, 15, '#8d5f35'); D(c, x + 6, base - 16, '#b07d4a');
    R(c, x + 3, base - 2, 8, 2, P.outline);
    // mailbox (side view, opening to the right)
    const my = base - 26, mw = 14, mh = 10;
    R(c, x, my + 1, mw, mh, P.outline); R(c, x + 1, my, mw - 2, 1, P.outline);
    R(c, x + 1, my + 2, mw - 2, mh - 2, '#3d6497');
    R(c, x + 2, my + 1, mw - 4, 1, '#5a82b5');
    R(c, x + 1, my + 2, mw - 2, 1, '#6d94c4');
    R(c, x + 1, my + mh - 1, mw - 2, 1, '#284468');
    R(c, x + mw - 3, my + 2, 1, mh - 3, '#284468'); D(c, x + mw - 2, my + 5, P.gold);
    if (isWinter()) R(c, x + 1, my - 1, mw - 2, 2, P.snow);
    const recent = recentCommits(3).length, week = recentCommits(7).length;
    // letters peeking out = commits this week (max 3)
    for (let i = 0; i < Math.min(3, week); i++) { R(c, x + mw - 1, my + 3 + i * 2, 3, 2, P.outline); R(c, x + mw - 1, my + 3 + i * 2, 2, 1, '#fbf4e4'); }
    // flag: up when something was committed in the last 3 days
    if (recent > 0) { R(c, x - 2, my - 5, 2, 10, P.outline); R(c, x - 5, my - 5, 4, 4, P.outline); R(c, x - 4, my - 4, 3, 2, '#d64545'); D(c, x - 2, my - 4, '#d64545'); }
    else { R(c, x - 6, my + 4, 7, 2, P.outline); R(c, x - 6, my + 4, 4, 1, '#a83a3a'); }
  }
  function drawTopiary(c, x, base) {
    shadow(c, x + 4, base, 7, 2);
    R(c, x - 1, base - 6, 3, 6, '#5d3f22');
    const leafB = season === 'winter' ? '#4f6a55' : '#3f7a3a', lt = season === 'winter' ? '#6f8a75' : '#5f9a4a', dk = season === 'winter' ? '#33473a' : '#2a5528';
    ell(c, x, base - 12, 7, 7, P.outline);
    ell(c, x, base - 12, 6, 6, dk);
    ell(c, x - 1, base - 13, 5, 5, leafB);
    ell(c, x - 2, base - 15, 2, 2, lt);
    for (let i = 0; i < 10; i++) { const a = hash(i, x, 5) * 6.28, r = hash(i, x, 6) * 5; D(c, x + Math.round(Math.cos(a) * r), base - 12 + Math.round(Math.sin(a) * r), hash(i, x, 7) < 0.5 ? lt : dk); }
    if (season === 'winter') { R(c, x - 4, base - 19, 7, 2, P.snow); R(c, x - 5, base - 17, 3, 1, P.snow); }
    R(c, x - 4, base - 1, 9, 2, P.outline); R(c, x - 3, base - 1, 7, 1, '#a35d3d');
  }

  /* ======================================================================
   * Hudson House Inn
   * ==================================================================== */
  function drawInn(c) {
    const winter = isWinter();
    const x0 = INN.x0, x1 = INN.x1, base = INN.base;
    const wallTop = 270, eave = 268, ridge = 230;
    const wall = '#ece4d0', trim = '#fbf7ec', shut = '#3d5a45', roof = '#5a6378';
    // shadow
    for (let y = ridge + 6; y < base + 4; y++) R(c, x1, y, Math.min(8, (y - ridge) / 6 | 0), 1, P.shadow);
    R(c, x0 + 6, base, x1 - x0 + 2, 4, P.shadow);
    // chimneys
    for (const [cx0, top] of [[x0 + 18, ridge - 12], [x1 - 26, ridge - 10]]) {
      R(c, cx0 - 1, top - 1, 10, ridge - top + 10, P.outline);
      bricks(c, cx0, top, 8, ridge - top + 8, '#9a4a38', cx0);
      R(c, cx0 - 2, top - 2, 12, 3, P.outline); R(c, cx0 - 1, top - 2, 10, 1, '#7d7a80');
      if (winter) R(c, cx0 - 1, top - 3, 10, 1, P.snow);
    }
    // roof (front slope)
    R(c, x0 - 7, ridge - 1, x1 - x0 + 14, eave - ridge + 3, P.outline);
    shingles(c, x0 - 6, ridge + 2, x1 - x0 + 12, eave - ridge - 1, roof, 21);
    for (let y = ridge + 2; y < eave; y++) for (let x = x1 - 4; x < x1 + 6; x++) if (bay(x, y) < 0.45) D(c, x, y, sh(roof, -0.3));
    R(c, x0 - 6, ridge, x1 - x0 + 12, 2, '#3c4253'); R(c, x0 - 6, ridge, x1 - x0 + 12, 1, '#7c869c');
    R(c, x0 - 6, eave, x1 - x0 + 12, 2, P.outline); R(c, x0 - 6, eave, x1 - x0 + 12, 1, trim);
    if (winter) {
      snowCap(c, x0 - 6, ridge, x1 - x0 + 12, 10, 3);
      snowCap(c, x0 - 6, eave - 3, x1 - x0 + 12, 2, 4);
    }
    // dormers
    for (const dx of [x0 + 30, x0 + 80]) {
      const dy = ridge + 12;
      R(c, dx - 1, dy - 1, 20, 20, P.outline);
      R(c, dx, dy + 6, 18, 12, wall);
      R(c, dx, dy + 6, 1, 12, trim);
      for (let k = 0; k < 9; k++) R(c, dx + 9 - k - 1, dy - 1 + k, (k + 1) * 2, 1, k < 1 ? P.outline : roof);
      for (let k = 1; k < 9; k++) { D(c, dx + 9 - k - 1, dy - 1 + k, P.outline); D(c, dx + 8 + k + 1, dy - 1 + k, P.outline); D(c, dx + 9 - k, dy - 1 + k, '#7c869c'); }
      windowPx(c, dx + 5, dy + 8, 8, 8, {});
      if (winter) R(c, dx + 3, dy + 1, 7, 2, P.snow);
    }
    // front wall (two storeys, clapboard)
    R(c, x0 - 1, wallTop - 1, x1 - x0 + 2, base - wallTop + 1, P.outline);
    siding(c, x0, wallTop, x1 - x0, base - wallTop, wall);
    R(c, x0, wallTop, 2, base - wallTop, trim); R(c, x1 - 3, wallTop, 2, base - wallTop, sh(trim, -0.1));
    // upper windows
    for (const wx of [x0 + 10, x0 + 34, x0 + 58, x0 + 82, x0 + 106]) windowPx(c, wx, wallTop + 5, 9, 11, { shutter: shut });
    // porch roof
    const pr = 290;
    R(c, x0 - 4, pr - 1, x1 - x0 + 8, 7, P.outline);
    for (let y = pr; y < pr + 5; y++) R(c, x0 - 3, y, x1 - x0 + 6, 1, y === pr ? '#6f9a7f' : y === pr + 4 ? '#2c4434' : '#4b7058');
    for (let x = x0 - 2; x < x1 + 3; x += 4) R(c, x, pr + 1, 1, 3, '#3c5a46');
    if (winter) snowCap(c, x0 - 3, pr - 1, x1 - x0 + 6, 2, 8);
    // porch interior (slightly shaded wall)
    for (let y = pr + 6; y < base - 3; y++) for (let x = x0 + 1; x < x1 - 1; x++) if (bay(x, y) < 0.18) D(c, x, y, P.shadow);
    // lower windows
    for (const wx of [x0 + 10, x0 + 30, x0 + 84, x0 + 104]) windowPx(c, wx, pr + 9, 11, 12, { shutter: shut });
    // door
    const dx0 = 169;
    R(c, dx0 - 2, pr + 7, 18, base - pr - 7, P.outline);
    R(c, dx0 - 1, pr + 8, 16, base - pr - 9, trim);
    R(c, dx0 + 1, pr + 10, 12, base - pr - 11, '#2f4a3a');
    R(c, dx0 + 1, pr + 10, 1, base - pr - 11, '#46684f');
    R(c, dx0 + 3, pr + 12, 3, 6, '#ffd27a'); R(c, dx0 + 8, pr + 12, 3, 6, '#ffd27a');
    GLOW.push([dx0 + 3, pr + 12, 3, 6], [dx0 + 8, pr + 12, 3, 6]);
    D(c, dx0 + 10, pr + 20, P.gold);
    // wreath on the door (autumn: harvest, winter: evergreen)
    if (season === 'autumn' || winter) { ell(c, dx0 + 7, pr + 9, 3, 2, winter ? '#2f5d3f' : '#c0612f'); D(c, dx0 + 7, pr + 9, winter ? '#b8432f' : '#f2c94c'); }
    // porch posts + rail + floor
    for (const px0 of [x0 + 1, x0 + 24, x0 + 48, x0 + 78, x0 + 102, x1 - 4]) { R(c, px0, pr + 5, 3, base - pr - 5, P.outline); R(c, px0 + 1, pr + 5, 1, base - pr - 6, trim); }
    R(c, x0, base - 9, 54, 1, P.outline); R(c, x0 + 80, base - 9, x1 - x0 - 80, 1, P.outline);
    for (let x = x0 + 2; x < x1 - 2; x += 4) if (x < x0 + 52 || x > x0 + 80) R(c, x, base - 8, 1, 5, '#d9d2c0');
    R(c, x0 - 2, base - 3, x1 - x0 + 4, 3, P.outline); R(c, x0 - 1, base - 3, x1 - x0 + 2, 1, '#b08458'); R(c, x0 - 1, base - 2, x1 - x0 + 2, 1, '#8d6440');
    // steps
    R(c, dx0 - 4, base - 1, 22, 3, P.outline); R(c, dx0 - 3, base - 1, 20, 1, '#c9c3b8'); R(c, dx0 - 3, base, 20, 1, '#a39d93');
    // porch hanging lanterns
    for (const lx of [x0 + 36, x0 + 90]) { R(c, lx, pr + 5, 1, 3, P.outline); R(c, lx - 1, pr + 8, 3, 4, P.outline); D(c, lx, pr + 9, '#ffd27a'); D(c, lx, pr + 10, '#ffb84d'); GLOW.push([lx, pr + 9, 1, 2]); }
    // flower boxes under the lower windows
    const fc = flowerCols();
    for (const wx of [x0 + 10, x0 + 30, x0 + 84, x0 + 104]) {
      R(c, wx - 2, pr + 23, 15, 3, P.outline); R(c, wx - 1, pr + 23, 13, 2, '#8d5f35');
      for (let k = 0; k < 6; k++) D(c, wx - 1 + k * 2 + 1, pr + 22, fc[(k + wx) % 4]);
    }
    // hanging sign on a post, left of the inn
    const sx = 100, sy = 289;
    shadow(c, sx + 3, base, 4, 1);
    R(c, sx - 1, sy - 6, 3, base - sy + 6, P.outline); R(c, sx, sy - 6, 1, base - sy + 5, '#8d5f35');
    R(c, sx - 1, sy - 6, 14, 2, P.outline); R(c, sx, sy - 6, 12, 1, '#8d5f35');
    R(c, sx + 2, sy - 4, 1, 3, P.outline); R(c, sx + 10, sy - 4, 1, 3, P.outline);
    box(c, sx, sy - 1, 14, 11, '#2f4a3a', { light: '#46684f', dark: '#22362a' });
    R(c, sx + 2, sy + 1, 10, 7, '#f1ece0');
    // tiny "HH" monogram + wave: the Hudson House sign
    for (const [lx, ly] of [[3, 2], [3, 3], [3, 4], [4, 3], [5, 2], [5, 3], [5, 4], [7, 2], [7, 3], [7, 4], [8, 3], [9, 2], [9, 3], [9, 4]]) D(c, sx + lx, sy + 1 + ly - 1, '#2f4a3a');
    for (let k = 0; k < 8; k++) D(c, sx + 3 + k, sy + 6 + (k % 2), P.water);
    if (winter) R(c, sx, sy - 2, 14, 1, P.snow);
  }

  /* riverside: patio with umbrellas, jetty, rowboat */
  function drawPatio(c) {
    const fc = ['#c0392b', '#2f6e8f', '#c0392b'];
    for (let i = 0; i < 3; i++) {
      const x = 102 + i * 34, y = 384 + (i % 2) * 8;
      shadow(c, x + 6, y + 6, 10, 3);
      // chairs
      R(c, x - 9, y, 4, 5, P.outline); R(c, x - 8, y, 2, 4, '#b07d4a');
      R(c, x + 7, y, 4, 5, P.outline); R(c, x + 8, y, 2, 4, '#b07d4a');
      // table
      ell(c, x + 1, y, 5, 2, P.outline); ell(c, x + 1, y, 4, 1, '#d9d2c0');
      R(c, x, y + 2, 2, 5, P.outline);
      if (season === 'winter') continue;
      // umbrella
      R(c, x, y - 16, 2, 16, P.outline); D(c, x, y - 12, '#d9d2c0');
      const col = fc[i];
      for (let k = 0; k < 6; k++) {
        const hw = 3 + k * 2;
        R(c, x + 1 - hw - 1, y - 22 + k, hw * 2 + 2, 1, P.outline);
        for (let xx = x + 1 - hw; xx < x + 1 + hw; xx++) D(c, xx, y - 22 + k, (Math.floor((xx - x + 20) / 3) % 2) ? col : '#f4efe4');
      }
      R(c, x - 12, y - 16, 26, 1, P.outline);
      for (let xx = x - 11; xx < x + 13; xx += 3) D(c, xx, y - 15, col);
    }
  }
  function drawJetty(c) {
    const y = 362, x0 = 40, x1 = 92;
    R(c, x0 + 2, y + 9, x1 - x0, 2, 'rgba(20,16,30,0.35)');
    for (const px0 of [x0 + 2, x0 + 18, x0 + 34]) { R(c, px0, y + 6, 3, 8, P.outline); R(c, px0 + 1, y + 6, 1, 7, P.plankDark); D(c, px0 + 1, y + 12, P.foam); }
    R(c, x0, y - 1, x1 - x0, 9, P.outline);
    for (let x = x0 + 1; x < x1 - 1; x++) {
      const b = Math.floor((x - x0) / 4), w = (x - x0) % 4;
      R(c, x, y, 1, 7, w === 3 ? P.plankDark : w === 0 ? sh(P.plank, 0.18) : (hash(b, 2, 3) < 0.3 ? sh(P.plank, -0.08) : P.plank));
    }
    R(c, x0 + 1, y + 6, x1 - x0 - 2, 1, '#4f3520');
    // bollard + rope
    R(c, x0 + 4, y - 4, 4, 6, P.outline); R(c, x0 + 5, y - 4, 2, 5, '#5d566c');
    // rowboat
    const bx = 44, by = 380;
    R(c, bx + 2, by + 8, 22, 2, 'rgba(20,16,30,0.3)');
    R(c, bx, by, 24, 8, P.outline);
    R(c, bx + 2, by + 1, 20, 6, '#2f6e8f'); R(c, bx + 2, by + 1, 20, 1, '#f4efe4');
    R(c, bx + 3, by + 2, 18, 3, '#8d5f35'); R(c, bx + 10, by + 2, 2, 3, '#b07d4a');
    D(c, bx, by, 'rgba(0,0,0,0)');
    R(c, bx - 1, by + 2, 1, 4, P.outline); R(c, bx + 24, by + 2, 1, 4, P.outline);
    R(c, bx + 5, by - 1, 1, 2, '#d9d2c0'); R(c, bx + 6, by - 2, 4, 1, '#d9d2c0');
    if (season === 'winter') R(c, bx + 3, by + 2, 18, 1, P.snow);
  }

  /* ======================================================================
   * School (north, red brick, bell cupola, flag)
   * ==================================================================== */
  function drawSchool(c) {
    const winter = isWinter();
    const x0 = SCHOOL.x0, x1 = SCHOOL.x1, base = SCHOOL.base;
    const wallTop = 80, eave = 78, ridge = 50;
    const roof = '#4f5566', trim = '#f4efe4';
    // shadow
    for (let y = ridge + 4; y < base + 3; y++) R(c, x1, y, Math.min(7, (y - ridge) / 7 | 0), 1, P.shadow);
    R(c, x0 + 6, base, x1 - x0, 3, P.shadow);
    // hipped roof, drawn off-screen so the hip corners can be trimmed
    const rw = x1 - x0 + 10, rh = eave - ridge + 3, rc = mk(rw, rh), r = rc.getContext('2d');
    r.translate(-(x0 - 5), -(ridge - 1));
    R(r, x0 - 5, ridge - 1, rw, rh, P.outline);
    shingles(r, x0 - 4, ridge, x1 - x0 + 8, eave - ridge, roof, 31);
    for (let y = ridge - 1; y < ridge + 14; y++) {
      const inset = 14 - (y - ridge);
      r.clearRect(x0 - 5, y, inset, 1); r.clearRect(x1 + 5 - inset, y, inset, 1);
      D(r, x0 - 5 + inset, y, P.outline); D(r, x1 + 4 - inset, y, P.outline);
      D(r, x0 - 4 + inset, y, '#7a8194');
    }
    for (let y = ridge; y < eave; y++) for (let x = x1 - 2; x < x1 + 5; x++) if (bay(x, y) < 0.4 && x < x1 + 4 - Math.max(0, 14 - (y - ridge))) D(r, x, y, sh(roof, -0.3));
    c.drawImage(rc, x0 - 5, ridge - 1);
    R(c, x0 + 9, ridge - 1, x1 - x0 - 18, 2, '#3a3f4d'); R(c, x0 + 9, ridge - 1, x1 - x0 - 18, 1, '#7a8194');
    R(c, x0 - 4, eave, x1 - x0 + 8, 2, P.outline); R(c, x0 - 4, eave, x1 - x0 + 8, 1, trim);
    if (winter) snowCap(c, x0 + 4, ridge, x1 - x0 - 8, 9, 13);
    // chimney
    R(c, x0 + 13, ridge - 9, 8, 12, P.outline); bricks(c, x0 + 14, ridge - 8, 6, 10, '#8f4636', 3); R(c, x0 + 12, ridge - 10, 10, 2, P.outline);
    // bell cupola on the ridge
    const cx0 = 452;
    R(c, cx0 - 8, ridge - 20, 17, 20, P.outline);
    R(c, cx0 - 7, ridge - 12, 15, 12, trim);
    R(c, cx0 - 5, ridge - 11, 11, 8, '#2a2130');
    bellAt(c, cx0 + 0, ridge - 10, 0);
    R(c, cx0 - 7, ridge - 3, 15, 1, sh(trim, -0.15));
    R(c, cx0 + 6, ridge - 12, 2, 12, sh(trim, -0.15));
    for (let k = 0; k < 9; k++) R(c, cx0 - k, ridge - 21 + k, k * 2 + 1, 1, k === 0 ? P.outline : '#4b7058');
    for (let k = 1; k < 9; k++) { D(c, cx0 - k - 1, ridge - 21 + k, P.outline); D(c, cx0 + k + 1, ridge - 21 + k, P.outline); D(c, cx0 - k, ridge - 21 + k, '#6f9a7f'); }
    R(c, cx0, ridge - 25, 1, 4, P.outline); D(c, cx0, ridge - 26, P.gold);
    if (winter) R(c, cx0 - 4, ridge - 17, 6, 2, P.snow);
    // brick front wall
    R(c, x0 - 1, wallTop - 1, x1 - x0 + 2, base - wallTop + 1, P.outline);
    bricks(c, x0, wallTop, x1 - x0, base - wallTop, '#a24a3a', 17);
    for (let y = wallTop; y < base; y++) for (let x = x1 - 5; x < x1; x++) if (bay(x, y) < (x - x1 + 6) / 7) D(c, x, y, '#6d2f25');
    R(c, x0, wallTop, x1 - x0, 2, trim); R(c, x0, wallTop + 2, x1 - x0, 1, sh(trim, -0.2));
    R(c, x0, base - 4, x1 - x0, 4, '#8a847c'); R(c, x0, base - 4, x1 - x0, 1, '#b9b2a6');
    // tall windows
    for (const wx of [x0 + 6, x0 + 22, x1 - 22]) windowPx(c, wx, wallTop + 7, 9, 18, { trim });
    // entrance bay with pediment
    const ex0 = 466, ex1 = 494;
    R(c, ex0 - 1, wallTop - 10, ex1 - ex0 + 2, base - wallTop + 10, P.outline);
    bricks(c, ex0, wallTop - 9, ex1 - ex0, base - wallTop + 9, '#ad5343', 19);
    for (let k = 0; k < 9; k++) { R(c, ex0 + 14 - k * 1.6 - 1, wallTop - 19 + k, Math.round(k * 3.2) + 2, 1, k === 0 ? P.outline : trim); }
    for (let k = 1; k < 9; k++) { D(c, Math.round(ex0 + 14 - k * 1.6) - 1, wallTop - 19 + k, P.outline); D(c, Math.round(ex0 + 14 + k * 1.6) + 1, wallTop - 19 + k, P.outline); }
    R(c, ex0 - 2, wallTop - 11, ex1 - ex0 + 4, 2, P.outline); R(c, ex0 - 1, wallTop - 11, ex1 - ex0 + 2, 1, trim);
    // round window in pediment
    ell(c, 480, wallTop - 14, 2, 2, P.outline); D(c, 480, wallTop - 14, '#35506b');
    // nameplate (no text: a plaque with a bell icon)
    box(c, 471, wallTop - 6, 18, 6, trim, { outline: P.outline, light: '#ffffff', dark: '#d9d2c0' });
    R(c, 475, wallTop - 4, 10, 1, '#5a5162'); R(c, 477, wallTop - 3, 6, 1, '#8a7a62');
    // columns + double doors
    for (const px0 of [ex0 + 2, ex1 - 5]) { R(c, px0, wallTop + 2, 3, base - wallTop - 4, P.outline); R(c, px0 + 1, wallTop + 2, 1, base - wallTop - 5, trim); }
    R(c, 472, wallTop + 9, 16, base - wallTop - 11, P.outline);
    R(c, 473, wallTop + 10, 14, base - wallTop - 12, '#2f5d8a');
    R(c, 480, wallTop + 10, 1, base - wallTop - 12, P.outline);
    R(c, 474, wallTop + 11, 5, 5, '#86b5d6'); R(c, 481, wallTop + 11, 5, 5, '#86b5d6');
    GLOW.push([474, wallTop + 11, 5, 5], [481, wallTop + 11, 5, 5]);
    D(c, 478, wallTop + 20, P.gold); D(c, 482, wallTop + 20, P.gold);
    R(c, 468, base - 2, 24, 2, P.outline); R(c, 469, base - 2, 22, 1, '#c9c3b8');
    // wall lamp
    R(c, 467, wallTop + 8, 3, 4, P.outline); D(c, 468, wallTop + 9, '#ffd27a'); GLOW.push([468, wallTop + 9, 1, 2]);
    // bushes along the front
    for (const bx of [x0 + 4, x0 + 20, x0 + 36, x1 - 12]) {
      ell(c, bx + 4, base - 2, 5, 3, P.outline); ell(c, bx + 4, base - 2, 4, 2, winter ? '#4f6a55' : '#3f7a3a'); D(c, bx + 2, base - 3, winter ? P.snow : '#5f9a4a'); D(c, bx + 3, base - 4, winter ? P.snow : '#5f9a4a');
    }
    // bike rack with one bike
    const rx = 418, ry = 118;
    for (let k = 0; k < 4; k++) { R(c, rx + k * 4, ry, 1, 5, '#5d566c'); D(c, rx + k * 4, ry, '#8d879a'); }
    R(c, rx, ry + 4, 13, 1, '#3c3648');
    for (const wx of [rx + 1, rx + 9]) { ell(c, wx + 2, ry + 4, 2, 2, P.outline); D(c, wx + 2, ry + 4, '#8d879a'); }
    R(c, rx + 3, ry + 2, 8, 1, '#c0392b'); R(c, rx + 6, ry + 1, 1, 2, '#c0392b'); R(c, rx + 9, ry, 2, 1, P.outline);
  }
  function drawFlagPole(c) {
    const { x, base, top } = FLAG;
    shadow(c, x + 3, base, 4, 1);
    R(c, x - 2, base - 3, 6, 3, P.outline); R(c, x - 1, base - 3, 4, 2, '#a39d93');
    R(c, x, top, 2, base - top, P.outline); R(c, x, top, 1, base - top, '#d9d2c0');
    R(c, x - 1, top - 2, 4, 3, P.outline); D(c, x, top - 1, P.gold);
  }
  const flagFrames = [];
  function buildFlag() {
    for (let f = 0; f < 4; f++) {
      const cv = mk(18, 14), c = cv.getContext('2d');
      for (let i = 0; i < 15; i++) {
        const off = Math.round(Math.sin(i * 0.55 - f * (Math.PI / 2)) * 1.1 * Math.min(1, i / 4));
        for (let j = 0; j < 9; j++) {
          let col = (j % 2 === 0) ? '#c0392b' : '#f4efe4';
          if (i < 7 && j < 5) col = (j + i) % 2 === 0 && j > 0 && j < 4 && i > 0 && i < 6 ? '#ffffff' : '#2c4a8a';
          const shade = Math.sin(i * 0.55 - f * (Math.PI / 2) + 0.8);
          if (shade > 0.6) col = sh(col, -0.15);
          D(c, i + 1, j + 2 + off, col);
        }
        D(c, i + 1, 1 + off, P.outline); D(c, i + 1, 11 + off, P.outline);
      }
      R(c, 0, 1, 1, 11, P.outline);
      flagFrames.push(cv);
    }
  }

  /* School playing field (north-east of the school) */
  function drawField(c) {
    const { x0, y0, x1, y1 } = FIELD;
    const winter = isWinter();
    const g1 = winter ? '#e6eef3' : season === 'autumn' ? '#7f9a43' : '#5f9f45', g2 = winter ? '#d6e2ea' : season === 'autumn' ? '#738d3c' : '#56923e';
    for (let y = y0; y < y1; y++) R(c, x0, y, x1 - x0, 1, Math.floor((y - y0) / 8) % 2 ? g1 : g2);
    const line = winter ? '#b9c9d4' : '#eef2e6';
    R(c, x0 + 3, y0 + 3, x1 - x0 - 6, 1, line); R(c, x0 + 3, y1 - 4, x1 - x0 - 6, 1, line);
    R(c, x0 + 3, y0 + 3, 1, y1 - y0 - 6, line); R(c, x1 - 4, y0 + 3, 1, y1 - y0 - 6, line);
    const my = (y0 + y1) >> 1;
    R(c, x0 + 3, my, x1 - x0 - 6, 1, line);
    for (let a = 0; a < 40; a++) D(c, Math.round((x0 + x1) / 2 + Math.cos(a / 40 * 6.283) * 8), Math.round(my + Math.sin(a / 40 * 6.283) * 6), line);
    for (const gy of [y0 + 3, y1 - 4]) {
      const gx = ((x0 + x1) >> 1) - 9;
      const top = gy - 6;
      R(c, gx, top, 19, 1, P.outline); R(c, gx, top, 1, 7, P.outline); R(c, gx + 18, top, 1, 7, P.outline);
      R(c, gx + 1, top + 1, 17, 1, '#ffffff'); R(c, gx + 1, top + 1, 1, 6, '#ffffff'); R(c, gx + 17, top + 1, 1, 6, '#ffffff');
      for (let xx = gx + 2; xx < gx + 17; xx += 2) for (let yy = top + 2; yy < top + 6; yy += 2) D(c, xx, yy, '#c8ccd2');
    }
    // low white fence around
    for (let x = x0 - 2; x <= x1 + 1; x += 6) { R(c, x, y0 - 4, 2, 5, P.outline); D(c, x, y0 - 4, '#f4efe4'); R(c, x, y1, 2, 5, P.outline); D(c, x, y1, '#f4efe4'); }
    R(c, x0 - 2, y0 - 2, x1 - x0 + 4, 1, '#f4efe4'); R(c, x0 - 2, y1 + 2, x1 - x0 + 4, 1, '#f4efe4');
    // a ball resting near midfield
    R(c, x0 + 20, my + 9, 3, 3, P.outline); D(c, x0 + 21, my + 10, '#ffffff');
  }

  S.registerStatic(40, (ctx) => {
    GLOW.length = 0;
    ensureTower();
    drawField(ctx);
    // tower shadow then the tower
    for (let y = 150; y < 256; y++) R(ctx, TOWER.x1, y, Math.min(9, ((y - 150) / 10) | 0), 1, P.shadow);
    R(ctx, TOWER.x0 + 4, 256, TOWER.x1 - TOWER.x0 + 4, 3, P.shadow);
    ctx.drawImage(towerCv, TWR.ox, TWR.oy);
    bellAt(ctx, BELL.x, BELL.y, 0);
    for (const [x, y, w, h] of PLANTERS) drawPlanter(ctx, x, y, w, h);
    drawTopiary(ctx, 412, 222); drawTopiary(ctx, 436, 236); drawTopiary(ctx, 616, 222); drawTopiary(ctx, 594, 238);
    drawTopiary(ctx, 487, 255); drawTopiary(ctx, 569, 255);
    drawQuestBoard(ctx);
    drawMailPost(ctx);
    drawFountain(ctx, isWinter());
    for (const [x, y] of BENCHES) drawBench(ctx, x, y);
    for (const [x, y] of LAMPS) drawLamp(ctx, x, y);
    drawSchool(ctx);
    drawFlagPole(ctx);
    drawInn(ctx);
    drawPatio(ctx);
    drawJetty(ctx);
  });

  /* ======================================================================
   * static 50: scattered decor + meadow / riverside features
   * ==================================================================== */
  const spriteCache = {};
  function leafSet(kind) {
    const sea = season;
    if (sea === 'winter') return null;
    let base = P.leaf[sea], alt = P.leafAlt[sea];
    if (kind === 1 && sea === 'autumn') { base = '#c4492f'; alt = '#e0763a'; }        // red maple
    if (kind === 2 && sea === 'autumn') { base = '#d9a032'; alt = '#f0cf5a'; }        // gold birch-ish
    if (kind === 3 && sea === 'autumn') { base = '#8f9a45'; alt = '#b3b24f'; }        // still-green oak
    if (kind === 4 && sea === 'autumn') { base = '#6f8f3a'; alt = '#9cb44f'; }        // apple trees, fruit on
    if (sea === 'summer') alt = sh(base, 0.25);
    if (sea === 'spring' && kind !== 4) alt = sh(base, 0.22);
    return { base, hi: alt, mid: sh(base, -0.14), dark: sh(base, -0.32), out: sh(base, -0.62) };
  }
  /** Deciduous tree sprite: kind 0..3 colour family, 4 = apple. */
  function treeSprite(kind, v) {
    const key = 't' + kind + '_' + v + '_' + season;
    if (spriteCache[key]) return spriteCache[key];
    const w = 40, h = 46, cv = mk(w, h), c = cv.getContext('2d');
    const rnd = S.rng(1000 + kind * 37 + v * 101);
    const cx = 20, cy = 17, big = kind !== 4;
    const trunk = '#6b4a2f', trunkL = '#8d6440', trunkD = '#4a321f';
    // trunk + roots
    R(c, cx - 3, 26, 6, 16, P.outline);
    R(c, cx - 2, 26, 4, 15, trunk); R(c, cx - 2, 26, 1, 15, trunkL); R(c, cx + 1, 26, 1, 15, trunkD);
    R(c, cx - 5, 40, 10, 2, P.outline); R(c, cx - 4, 40, 3, 1, trunk); R(c, cx + 1, 40, 3, 1, trunkD);
    D(c, cx - 1, 33, trunkD); D(c, cx, 36, trunkL);
    const L = leafSet(kind);
    if (!L) { // winter: bare branches with snow
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
      cv._ox = cx; cv._base = 41;
      return (spriteCache[key] = cv);
    }
    // canopy blobs
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
      // a darker band where a blob overlaps the one behind it
      if (bi !== 0 && M[(y + 1) * w + x] === 0 && lit < 0.2) col = L.dark;
      D(c, x, y, col);
    }
    if (kind === 4) { // apples / blossoms
      for (let i = 0; i < 9; i++) {
        const x = Math.round(cx - 9 + rnd() * 18), y = Math.round(cy - 7 + rnd() * 13);
        if (M[y * w + x] < 0 || M[(y + 1) * w + x + 1] < 0) continue;
        if (season === 'spring') { D(c, x, y, '#f7c6d9'); D(c, x + 1, y, '#ffffff'); }
        else { D(c, x, y, '#d43b2f'); D(c, x + 1, y, '#a0281f'); D(c, x, y - 1, '#ff8a6a'); }
      }
    }
    // a peek of branch through the canopy bottom
    cv._ox = cx; cv._base = 41;
    return (spriteCache[key] = cv);
  }
  function pineSprite(v) {
    const key = 'p' + v + '_' + season;
    if (spriteCache[key]) return spriteCache[key];
    const w = 24, h = 40, cv = mk(w, h), c = cv.getContext('2d');
    const cx = 12, tiers = 4, tall = v === 2;
    const G = { b: '#356b45', l: '#4f8a55', d: '#24503a', o: '#122a1f' };
    R(c, cx - 2, 31, 4, 7, P.outline); R(c, cx - 1, 31, 2, 6, '#6b4a2f'); D(c, cx - 1, 31, '#8d6440');
    for (let t = tiers - 1; t >= 0; t--) {
      const top = (tall ? 0 : 4) + t * (tall ? 7 : 6), hh = 11, hw = 4 + t * 2.4 + (tall ? 0 : 0.5);
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
    D(c, cx - 1, tall ? 0 : 4, G.o);
    cv._ox = cx; cv._base = 37;
    return (spriteCache[key] = cv);
  }
  function willowSprite() {
    const key = 'w_' + season;
    if (spriteCache[key]) return spriteCache[key];
    const w = 44, h = 48, cv = mk(w, h), c = cv.getContext('2d'), cx = 22;
    const winter = season === 'winter';
    const base = winter ? '#8a8f6a' : season === 'autumn' ? '#b9b04a' : season === 'spring' ? '#9ccf5a' : '#6fa443';
    const hi = sh(base, 0.28), dk = sh(base, -0.3), out = sh(base, -0.62);
    // trunk (leaning a little)
    R(c, cx - 3, 18, 7, 27, P.outline);
    R(c, cx - 2, 18, 5, 26, '#6b5a3f'); R(c, cx - 2, 18, 1, 26, '#8a7655'); R(c, cx + 2, 18, 1, 26, '#4f4230');
    R(c, cx - 6, 43, 13, 2, P.outline); R(c, cx - 5, 43, 4, 1, '#6b5a3f');
    // crown
    const inCrown = (x, y) => ((x - cx) / 15) ** 2 + ((y - 13) / 10) ** 2 <= 1;
    for (let y = 2; y < 24; y++) for (let x = 0; x < w; x++) {
      if (!inCrown(x + 0.5, y + 0.5)) continue;
      const edge = !inCrown(x - 0.5, y + 0.5) || !inCrown(x + 1.5, y + 0.5) || !inCrown(x + 0.5, y - 0.5);
      const lit = (-(x - cx) / 15 - (y - 13) / 10) * 0.8 + (bay(x, y) - 0.5) * 0.4;
      D(c, x, y, edge ? out : lit > 0.45 ? hi : lit > -0.25 ? base : dk);
    }
    // weeping strands
    if (!winter || true) for (let x = cx - 17; x <= cx + 17; x++) {
      const d = Math.abs(x - cx) / 17;
      if (hash(x, 3, 7) < 0.18) continue;
      const y0 = 11 + Math.round(Math.sqrt(Math.max(0, 1 - d * d)) * 7);
      const len = Math.round((winter ? 6 : 13) + (1 - d) * (winter ? 4 : 11) + hash(x, 4, 7) * 6);
      for (let y = y0; y < y0 + len; y++) {
        const k = y - y0;
        let col = (x & 1) ? dk : x < cx ? (k < 6 ? hi : base) : base;
        if (k === len - 1) col = out;
        if ((x & 1) && k > len - 4) continue;
        D(c, x, y, col);
      }
    }
    for (let i = 0; i < 26; i++) { const x = cx - 11 + ((hash(i, 2, 5) * 22) | 0), y = 5 + ((hash(i, 3, 5) * 10) | 0); D(c, x, y, hash(i, 4, 5) < 0.5 ? hi : dk); }
    if (winter) { R(c, cx - 9, 3, 12, 2, P.snow); R(c, cx - 12, 5, 6, 1, P.snow); R(c, cx + 2, 4, 6, 1, P.snow); }
    cv._ox = cx; cv._base = 44;
    return (spriteCache[key] = cv);
  }
  function bushSprite(v) {
    const key = 'b' + v + '_' + season;
    if (spriteCache[key]) return spriteCache[key];
    const cv = mk(18, 14), c = cv.getContext('2d');
    const L = leafSet(v === 1 ? 1 : 3) || { base: '#5d7266', hi: '#7e8f86', mid: '#4f6358', dark: '#3e5046', out: '#1f2c26' };
    const blobs = [[9, 8, 5.5], [5, 9, 4], [13, 9, 4]];
    for (let y = 0; y < 14; y++) for (let x = 0; x < 18; x++) {
      let best = -9, bi = 0;
      blobs.forEach(([bx, by, br], i) => { const q = br - Math.hypot(x - bx, y - by); if (q > best) { best = q; bi = i; } });
      if (best < 0) continue;
      const [bx, by, br] = blobs[bi];
      const lit = (-(x - bx) - (y - by)) / br + (bay(x, y) - 0.5) * 0.5;
      D(c, x, y, best < 1 ? L.out : lit > 0.6 ? L.hi : lit > -0.2 ? L.base : L.dark);
    }
    if (season === 'winter') { R(c, 5, 3, 7, 2, P.snow); R(c, 2, 5, 3, 1, P.snow); R(c, 12, 5, 3, 1, P.snow); }
    else if (v === 2 && season !== 'autumn') for (const [x, y] of [[6, 6], [11, 5], [9, 9]]) { D(c, x, y, '#ffffff'); D(c, x + 1, y, '#f2a7c3'); }
    else if (v === 2) for (const [x, y] of [[6, 6], [11, 5], [9, 9], [4, 9]]) D(c, x, y, '#b8322a');
    cv._ox = 9; cv._base = 13;
    return (spriteCache[key] = cv);
  }
  function rockSprite(v) {
    const key = 'r' + v + '_' + season;
    if (spriteCache[key]) return spriteCache[key];
    const cv = mk(14, 10), c = cv.getContext('2d');
    const rx = v === 0 ? 5 : v === 1 ? 4 : 6, ry = v === 2 ? 4 : 3;
    for (let y = -ry - 1; y <= ry + 1; y++) for (let x = -rx - 1; x <= rx + 1; x++) {
      const q = (x * x) / (rx * rx) + (y * y) / (ry * ry) + hash(x, y, v) * 0.25;
      if (q > 1.25) continue;
      const edge = q > 0.95;
      const lit = -(x / rx) - (y / ry);
      let col = edge ? '#3a3640' : lit > 0.7 ? '#c2bdb4' : lit > -0.3 ? '#9a958c' : '#77726a';
      if (!edge && y > 0 && hash(x, y, v + 5) < 0.18) col = '#6f8a4a'; // moss
      if (season === 'winter' && !edge && y < -ry / 3) col = P.snow;
      D(c, 7 + x, 5 + y, col);
    }
    cv._ox = 7; cv._base = 9;
    return (spriteCache[key] = cv);
  }
  function drawSprite(c, cv, x, base) {
    c.drawImage(cv, Math.round(x - cv._ox), Math.round(base - cv._base));
  }

  /* small decor drawn straight into the static layer */
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
  function reedsAt(c, x, y, seed) {
    const n = 3 + ((hash(seed, 1, 1) * 3) | 0);
    for (let i = 0; i < n; i++) {
      const rx = x + i * 2 + ((hash(seed, i, 2) * 2) | 0), hgt = 5 + ((hash(seed, i, 3) * 5) | 0);
      const stem = season === 'winter' ? '#9a8a6a' : season === 'autumn' ? '#9a8f4a' : '#5f8a3a';
      R(c, rx, y - hgt, 1, hgt, stem);
      if (i % 2 === 0) { R(c, rx, y - hgt - 2, 1, 3, '#6b4a2f'); D(c, rx, y - hgt - 2, '#8d6440'); }
      else D(c, rx + 1, y - hgt + 1, stem);
    }
  }
  function lilyAt(c, x, y) {
    if (season === 'winter') return;
    const g = season === 'autumn' ? '#8f9a45' : '#4f8f33';
    ell(c, x, y, 3, 1, sh(g, -0.35)); ell(c, x, y, 2, 1, g); D(c, x - 1, y, sh(g, 0.25)); D(c, x + 2, y, P.water);
    if (season !== 'autumn' && hash(x, y, 4) < 0.5) { D(c, x, y - 1, '#f7c6d9'); D(c, x + 1, y - 1, '#ffffff'); }
  }
  function fenceH(c, x0, x1, y) {
    for (let x = x0; x <= x1; x += 8) { R(c, x, y - 7, 3, 8, P.outline); R(c, x + 1, y - 7, 1, 7, '#b07d4a'); D(c, x + 1, y - 7, '#d9a974'); }
    for (const yy of [y - 5, y - 2]) { R(c, x0, yy, x1 - x0 + 3, 2, P.outline); R(c, x0, yy, x1 - x0 + 3, 1, '#a8774a'); }
    if (isWinter()) R(c, x0, y - 6, x1 - x0 + 3, 1, P.snow);
  }
  function fenceV(c, x, y0, y1) {
    for (let y = y0; y <= y1; y += 8) { R(c, x, y - 7, 3, 8, P.outline); R(c, x + 1, y - 7, 1, 7, '#b07d4a'); }
    R(c, x + 1, y0 - 6, 1, y1 - y0 + 6, '#8d5f35');
  }
  function stoneWall(c, x0, x1, y) {
    for (let x = x0; x < x1; x += 5) {
      for (const [dy, off] of [[0, 0], [-3, 2]]) {
        const sx = x + off;
        if (sx + 5 > x1) continue;
        const hv = hash(sx, y + dy, 61);
        R(c, sx, y + dy - 3, 6, 4, '#3a3640');
        R(c, sx + 1, y + dy - 3, 4, 3, hv < 0.3 ? '#8a857c' : '#a19b90');
        D(c, sx + 1, y + dy - 3, '#c2bdb4');
        if (hv > 0.75) D(c, sx + 3, y + dy - 1, '#6f8a4a');
        if (isWinter() && dy < 0) R(c, sx + 1, y + dy - 4, 4, 1, P.snow);
      }
    }
  }
  function pumpkinAt(c, x, y, big) {
    const w = big ? 7 : 5, h = big ? 5 : 4;
    R(c, x - 1, y - h, w + 2, h + 1, P.outline);
    R(c, x, y - h + 1, w, h - 1, '#e07a22');
    R(c, x, y - h + 1, 2, h - 2, '#f5a04a');
    for (let k = 2; k < w; k += 2) R(c, x + k, y - h + 1, 1, h - 1, '#b85a17');
    R(c, x + (w >> 1), y - h - 1, 1, 2, '#4f6a2a');
  }
  function haybale(c, x, y) {
    shadow(c, x + 7, y + 1, 7, 2);
    ell(c, x + 5, y - 5, 6, 5, P.outline);
    ell(c, x + 5, y - 5, 5, 4, '#d9b24a');
    ell(c, x + 4, y - 6, 3, 2, '#efd27a');
    for (let r = 1; r < 4; r++) D(c, x + 5 + r, y - 5, '#a8822a');
    R(c, x + 5, y - 10, 8, 1, P.outline); R(c, x + 11, y - 9, 2, 9, P.outline);
    R(c, x + 5, y - 9, 6, 9, '#c9a03a'); R(c, x + 6, y - 8, 4, 1, '#efd27a');
    if (isWinter()) { R(c, x, y - 11, 13, 2, P.snow); }
  }
  function scarecrow(c, x, y) {
    shadow(c, x + 3, y, 5, 1);
    R(c, x, y - 18, 2, 18, '#6b4a2f');
    R(c, x - 6, y - 14, 14, 2, '#6b4a2f');
    R(c, x - 3, y - 15, 8, 8, P.outline); R(c, x - 2, y - 14, 6, 6, '#3f6a9a'); R(c, x - 2, y - 14, 2, 6, '#5a86b5');
    R(c, x - 6, y - 14, 3, 2, '#d9b24a'); R(c, x + 5, y - 14, 3, 2, '#d9b24a');
    R(c, x - 2, y - 21, 6, 6, P.outline); R(c, x - 1, y - 20, 4, 4, '#e9d4a0'); D(c, x, y - 18, P.outline); D(c, x + 2, y - 18, P.outline);
    R(c, x - 4, y - 23, 10, 2, P.outline); R(c, x - 2, y - 25, 6, 3, P.outline); R(c, x - 1, y - 24, 4, 2, '#8a5a2a'); R(c, x - 3, y - 22, 8, 1, '#a8722f');
    if (isWinter()) R(c, x - 3, y - 26, 8, 1, P.snow);
  }
  function cropField(c) {
    // East Meadow field: tilled rows (pumpkins in autumn, sprouts in spring, greens in summer, snow in winter)
    const x0 = 770, y0 = 306, x1 = 890, y1 = 380;
    shadow(c, (x0 + x1) / 2 + 3, y1 + 2, (x1 - x0) / 2, 3);
    R(c, x0, y0, x1 - x0, y1 - y0, '#6e4c30');
    for (let y = y0; y < y1; y++) {
      const k = (y - y0) % 8;
      R(c, x0, y, x1 - x0, 1, k === 0 ? '#8d6440' : k === 1 ? '#7a5636' : k > 5 ? '#55391f' : '#6e4c30');
    }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (hash(x, y, 81) < 0.05) D(c, x, y, '#9a7048');
    for (let row = 0, y = y0 + 6; y < y1; row++, y += 8) {
      for (let x = x0 + 4 + (row % 2) * 6; x < x1 - 6; x += 12) {
        const hv = hash(x, y, 82);
        if (season === 'autumn') {
          R(c, x - 3, y - 1, 9, 1, '#4f6a2a'); D(c, x + 6, y - 2, '#6f8a3a');
          if (hv < 0.65) pumpkinAt(c, x, y, hv < 0.2);
        } else if (season === 'summer') { R(c, x, y - 4, 5, 4, '#2f6a2a'); D(c, x + 1, y - 4, '#5f9f45'); D(c, x + 3, y - 5, '#5f9f45'); }
        else if (season === 'spring') { D(c, x + 1, y - 2, '#7cc35a'); D(c, x + 2, y - 3, '#7cc35a'); D(c, x + 3, y - 2, '#5f9f45'); }
        else R(c, x - 3, y - 3, 9, 2, P.snow);
      }
    }
    if (season === 'winter') for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (bay(x, y) < 0.55) D(c, x, y, (y - y0) % 8 > 5 ? '#c3d1da' : P.snow);
    fenceH(c, x0 - 4, x1, y0 - 2); fenceH(c, x0 - 4, x1, y1 + 4);
    fenceV(c, x0 - 4, y0 + 6, y1); fenceV(c, x1, y0 + 6, y1);
    scarecrow(c, x0 + 60, y0 + 30);
  }
  function pond(c) {
    const { x, y, rx, ry } = POND;
    ell(c, x, y + 1, rx + 2, ry + 2, SAND_D);
    ell(c, x, y, rx + 1, ry + 1, '#5d4a35');
    ell(c, x, y, rx, ry, season === 'winter' ? '#cfe3ec' : P.water);
    if (season !== 'winter') {
      ell(c, x + 2, y + 2, rx - 5, ry - 4, P.waterDeep);
      for (let xx = x - rx + 4; xx < x + rx - 4; xx++) D(c, xx, y - ry + 1, P.waterLight);
      for (const [ox, oy] of [[-10, 2], [8, -3], [3, 5]]) lilyAt(c, x + ox, y + oy);
      for (let i = 0; i < 6; i++) D(c, x - 12 + i * 5, y + ((i * 7) % 5) - 2, P.waterLight);
    } else {
      ell(c, x - 4, y - 2, rx - 8, ry - 5, '#eef6fa');
      for (let i = 0; i < 4; i++) D(c, x - 8 + i * 5, y + (i % 3) - 1, '#a9c7d6');
    }
    reedsAt(c, x - rx - 2, y + 4, 7); reedsAt(c, x + rx - 4, y + ry - 1, 8); reedsAt(c, x + 6, y - ry + 1, 9);
  }

  const railTiles = new Set();
  (function () {
    const r = S.nav.rails || [];
    for (let i = 0; i + 1 < r.length; i++) {
      const [x0, y0] = r[i], [x1, y1] = r[i + 1];
      for (let y = Math.min(y0, y1) - 1; y <= Math.max(y0, y1) + 1; y++) for (let x = Math.min(x0, x1) - 1; x <= Math.max(x0, x1) + 1; x++) railTiles.add(y * COLS + x);
    }
  })();
  const DECOR_ZONES = ['riverside', 'north', 'meadow'];
  /** True if a scattered prop may sit on tile (tx,ty): free, ours, and not on rails. */
  function decorOk(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
    if (!S.isFree(tx, ty) || railTiles.has(ty * COLS + tx)) return false;
    const b = S.biomeAt(tx, ty);
    return DECOR_ZONES.includes(b) && !(b === 'meadow' && (tx < 6 && ty > 25));
  }
  const notBuilding = (tx, ty) => tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS || !S.isReserved(tx, ty);

  function placeDecor() {
    const items = []; // {type, x, base, v}
    const used = new Uint8Array(COLS * ROWS);
    const mark = (tx, ty) => { if (tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS) used[ty * COLS + tx] = 1; };
    // fixed features first: orchard, hay, wall
    const orchard = [[58, 18], [61, 18], [57, 21], [60, 21], [63, 21]];
    for (const [tx, ty] of orchard) if (decorOk(tx, ty)) { items.push({ type: 'tree', kind: 4, v: tx % 3, x: tx * TILE + 8, base: ty * TILE + 14 }); mark(tx, ty); mark(tx, ty - 1); mark(tx - 1, ty); mark(tx + 1, ty); }
    for (const [tx, ty] of [[56, 23], [57, 24]]) if (decorOk(tx, ty)) { items.push({ type: 'hay', x: tx * TILE + 1, base: ty * TILE + 13 }); mark(tx, ty); }
    // riverside willows by the water
    for (const [tx, ty] of [[5, 16], [16, 24]]) if (decorOk(tx, ty) && decorOk(tx, ty - 1)) { items.push({ type: 'willow', x: tx * TILE + 8, base: ty * TILE + 14 }); for (let dx = -1; dx <= 1; dx++) for (let dy = -2; dy <= 0; dy++) mark(tx + dx, ty + dy); }
    // pass 1: trees, clustered into groves by low-frequency noise
    for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
      if (used[ty * COLS + tx] || !decorOk(tx, ty)) continue;
      const zone = S.biomeAt(tx, ty);
      const grove = vnoise(tx / 4.5, ty / 4.5, 9);
      const dens = (zone === 'meadow' ? 0.16 : 0.26) + Math.max(0, grove - 0.4) * 1.3;
      if (hash(tx, ty, 101) >= dens) continue;
      const canTree = decorOk(tx, ty - 1) && !S.onRoad(tx, ty - 2) && notBuilding(tx - 1, ty) && notBuilding(tx + 1, ty) &&
        notBuilding(tx, ty + 1) && notBuilding(tx - 1, ty + 1) && notBuilding(tx + 1, ty + 1) && notBuilding(tx, ty + 2) &&
        !used[(ty - 1) * COLS + tx] && !used[ty * COLS + tx - 1] && !(tx + 1 < COLS && used[ty * COLS + tx + 1]);
      if (!canTree) continue;
      const jx = ((hash(tx, ty, 102) * 7) | 0) - 3, jy = ((hash(tx, ty, 103) * 4) | 0);
      const k = hash(tx, ty, 104);
      const pine = zone === 'north' ? k < 0.5 : zone === 'riverside' ? k < 0.3 : k < 0.18;
      items.push(pine ? { type: 'pine', v: (k * 30 | 0) % 3, x: tx * TILE + 8 + jx, base: ty * TILE + 13 + jy }
        : { type: 'tree', kind: ((k * 40) | 0) % 4, v: (k * 90 | 0) % 3, x: tx * TILE + 8 + jx, base: ty * TILE + 13 + jy });
      mark(tx, ty); mark(tx, ty - 1); mark(tx - 1, ty); mark(tx + 1, ty); mark(tx - 1, ty - 1); mark(tx + 1, ty - 1);
    }
    // pass 2: bushes and rocks in the gaps
    for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
      if (used[ty * COLS + tx] || !decorOk(tx, ty)) continue;
      const h = hash(tx, ty, 105);
      const jx = ((hash(tx, ty, 106) * 7) | 0) - 3, jy = ((hash(tx, ty, 107) * 4) | 0);
      if (h < 0.07 && notBuilding(tx, ty + 1)) { items.push({ type: 'bush', v: ((h * 300) | 0) % 3, x: tx * TILE + 8 + jx, base: ty * TILE + 12 + jy }); mark(tx, ty); }
      else if (h < 0.1) { items.push({ type: 'rock', v: ((h * 500) | 0) % 3, x: tx * TILE + 8 + jx, base: ty * TILE + 10 + jy }); mark(tx, ty); }
    }
    items.sort((a, b) => a.base - b.base);
    return items;
  }
  let decorItems = null;
  S._dbgDecor = () => decorItems;

  S.registerStatic(50, (ctx) => {
    if (!decorItems) decorItems = placeDecor();
    // ground-level details on free tiles: flowers, fallen leaves, mushrooms, reeds
    for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
      const x = tx * TILE, y = ty * TILE;
      // reeds along the west shore (any free land tile touching water, outside the port)
      if (S.isFree(tx, ty) && S.isWater(tx - 1, ty) && ty < 26 && hash(tx, ty, 120) < 0.55 && !S.isReserved(tx, ty)) {
        reedsAt(ctx, Math.round(edgeX[y + 10]) + 2, y + 12, tx * 97 + ty);
        continue;
      }
      if (!decorOk(tx, ty)) continue;
      const h = hash(tx, ty, 111);
      if (h < 0.16) flowersAt(ctx, x + 3 + ((h * 50) | 0) % 6, y + 4 + ((h * 300) | 0) % 6, tx * 131 + ty);
      else if (season === 'autumn' && h < 0.3) leavesAt(ctx, x + 2, y + 4, tx * 7 + ty);
      else if (season === 'autumn' && h < 0.33) mushroomAt(ctx, x + 6, y + 9);
    }
    // lily pads near the riverside shore
    for (let y = 250; y < 420; y += 23) { const x = Math.round(edgeX[y]) - 10 - ((hash(y, 1, 7) * 8) | 0); if (hash(y, 2, 7) < 0.7) lilyAt(ctx, x, y); }
    // East Meadow features
    stoneWall(ctx, 742, 1024, 262);
    stoneWall(ctx, 640, 718, 262);
    pond(ctx);
    cropField(ctx);
    // y-sorted props
    for (const it of decorItems) {
      if (it.type === 'tree' || it.type === 'pine' || it.type === 'willow') {
        const wide = it.type === 'willow' ? 16 : it.type === 'pine' ? 9 : it.kind === 4 ? 11 : 13;
        shadow(ctx, it.x + 4, it.base, wide, 3);
      }
      if (it.type === 'tree') drawSprite(ctx, treeSprite(it.kind, it.v), it.x, it.base);
      else if (it.type === 'pine') drawSprite(ctx, pineSprite(it.v), it.x, it.base);
      else if (it.type === 'willow') drawSprite(ctx, willowSprite(), it.x, it.base);
      else if (it.type === 'bush') { shadow(ctx, it.x + 3, it.base, 8, 2); drawSprite(ctx, bushSprite(it.v), it.x, it.base); }
      else if (it.type === 'rock') { shadow(ctx, it.x + 2, it.base, 6, 2); drawSprite(ctx, rockSprite(it.v), it.x, it.base); }
      else if (it.type === 'hay') haybale(ctx, it.x, it.base);
    }
  });

  /* ======================================================================
   * static 95: which river pixels are still open water (after everyone drew)
   * ==================================================================== */
  let waterMask = null, readbacks = 0, waterFrames = null;
  function fallbackMask() {
    const m = new Uint8Array(WB * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < WB; x++) {
      const tx = (x / TILE) | 0, ty = (y / TILE) | 0;
      if (x < edgeX[y] - 1 && !S.isReserved(tx, ty)) m[y * WB + x] = 1;
    }
    return m;
  }
  S.registerStatic(95, (ctx) => {
    let m = null;
    if (readbacks < 2) {
      try {
        readbacks++;
        const id = ctx.getImageData(0, 0, WB, H).data;
        m = new Uint8Array(WB * H);
        for (let i = 0, k = 0; k < WB * H; k++, i += 4) if (id[i + 3] === 255 && WATER_SET.has((id[i] << 16) | (id[i + 1] << 8) | id[i + 2])) m[k] = 1;
      } catch (e) { m = null; }
    }
    waterMask = m || fallbackMask();
    waterFrames = null; // rebuilt lazily
  });

  /* ======================================================================
   * dynamic 100: river shimmer + shoreline foam
   * ==================================================================== */
  const WF = 12;
  function buildWaterFrames() {
    const m = waterMask;
    const glints = [];
    const rnd = S.rng(4242);
    for (let tries = 0; tries < 9000 && glints.length < 650; tries++) {
      const x = (rnd() * WB) | 0, y = (rnd() * H) | 0;
      if (!m[y * WB + x] || edgeX[y] - x < 4) continue;
      glints.push({ x, y, len: 1 + ((rnd() * 3) | 0), s: (rnd() * WF) | 0, dur: 4 + ((rnd() * 4) | 0), bright: rnd() < 0.35 });
    }
    const fl = rgb(P.foam), wl = rgb(P.waterLight), wh = [255, 255, 255];
    const frames = [];
    for (let f = 0; f < WF; f++) {
      const cv = mk(WB, H), c = cv.getContext('2d');
      const img = c.createImageData(WB, H), d = img.data;
      const put = (x, y, col, a = 255) => {
        if (x < 0 || y < 0 || x >= WB || y >= H || !m[y * WB + x]) return;
        const i = (y * WB + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = a;
      };
      for (const g of glints) {
        const age = (f - g.s + WF) % WF;
        if (age >= g.dur) continue;
        const y = g.y + (age >> 1), mid = age > 0 && age < g.dur - 1;
        for (let k = 0; k < g.len; k++) put(g.x + k, y, mid && g.bright && k === (g.len >> 1) ? wh : mid ? fl : wl, mid ? 255 : 200);
      }
      // breathing foam along the shore
      for (let y = 0; y < H; y++) {
        const amt = 1 + Math.sin(y * 0.21 + (f / WF) * Math.PI * 2) * 1.6 + Math.sin(y * 0.07 - (f / WF) * Math.PI * 4) * 0.6;
        const e = Math.floor(edgeX[y]);
        for (let k = 1; k <= Math.round(amt) + 1; k++) {
          const x = e - 1 - k;
          if (k > 1 && bay(x, y + f) > 0.55) continue;
          put(x, y, k === 1 ? fl : wl, k > 2 ? 170 : 255);
        }
      }
      c.putImageData(img, 0, 0);
      frames.push(cv);
    }
    waterFrames = frames;
  }

  S.registerDynamic(100, (ctx, t) => {
    if (S.time.season && S.time.season !== season) { season = S.time.season; S.invalidateStatic(); return; }
    if (!waterMask) return;
    if (!waterFrames) buildWaterFrames();
    const f = Math.floor(t * (S.reducedMotion ? 2 : 6)) % WF;
    ctx.drawImage(waterFrames[f], 0, 0);
  });

  /* ======================================================================
   * dynamic 200: fountain water, payday bunting on the inn
   * ==================================================================== */
  S.registerDynamic(200, (ctx, t) => {
    if (!isWinter()) {
      if (!fountainFrames) buildFountainFrames();
      const f = Math.floor(t * (S.reducedMotion ? 3 : 10)) % fountainFrames.frames.length;
      ctx.drawImage(fountainFrames.frames[f], fountainFrames.ox, fountainFrames.oy);
    }
    if (S.time.isPayday) { // Friday: gold bunting across the inn porch (pay is direct-deposited every Friday)
      const y0 = 297, x0 = INN.x0 + 2, x1 = INN.x1 - 2;
      for (let x = x0; x < x1; x++) {
        const sag = Math.round(Math.sin(((x - x0) / 26) * Math.PI) * 2);
        D(ctx, x, y0 + Math.abs(sag), '#5d3f22');
        if ((x - x0) % 6 === 2) { R(ctx, x - 1, y0 + Math.abs(sag) + 1, 3, 2, P.gold); D(ctx, x, y0 + Math.abs(sag) + 3, P.goldDark); }
      }
    }
  });

  /* ======================================================================
   * dynamic 400: clock tower (people pass under the arch), bell, flag, smoke
   * ==================================================================== */
  const smokeCol = 'rgba(214,214,222,';
  S.registerDynamic(400, (ctx, t) => {
    if (towerOver) ctx.drawImage(towerOver, TWR.ox, TWR.oy);
    // bell: swings while Mayor Tock rings in a cycle
    let swing = 0;
    const cer = S.cycle && S.cycle.ceremony;
    if (cer && cer.progress < S.CEREMONY_BEATS.bell[1] + 0.02) swing = Math.round(Math.sin(t * (S.reducedMotion ? 3 : 9)) * 3);
    if (swing) { R(ctx, CX - 9, BELL.y - 2, 18, 11, '#2a2130'); R(ctx, CX - 12, 156, 24, 1, '#5a4030'); }
    bellAt(ctx, BELL.x, BELL.y, swing);
    // school flag
    if (!flagFrames.length) buildFlag();
    const ff = Math.floor(t * (S.reducedMotion ? 1.5 : 5)) % flagFrames.length;
    ctx.drawImage(flagFrames[ff], FLAG.x + 2, FLAG.top - 1);
    // chimney smoke (inn)
    const n = S.reducedMotion ? 2 : 5;
    for (const [sx, sy, ph] of [[INN.x0 + 22, 206, 0], [INN.x1 - 22, 208, 0.5]]) {
      for (let i = 0; i < n; i++) {
        const age = ((t * 0.28) + i / n + ph) % 1;
        const x = Math.round(sx + Math.sin(age * 4 + i) * 2 + age * 10), y = Math.round(sy - age * 30);
        const s = 2 + Math.round(age * 3);
        ctx.fillStyle = smokeCol + (0.55 * (1 - age)).toFixed(2) + ')';
        ctx.fillRect(x - (s >> 1), y, s, s - 1); ctx.fillRect(x - (s >> 1) + 1, y - 1, s - 2, 1);
      }
    }
  });

  /* ======================================================================
   * dynamic 700: clock face showing real New York time + night windows
   * ==================================================================== */
  S.registerDynamic(700, (ctx) => {
    const light = S.time.light == null ? 1 : S.time.light;
    // lit windows and lamp glass
    const a = clamp((0.62 - light) / 0.35, 0, 1);
    if (a > 0.02) {
      ctx.globalAlpha = a;
      for (const [x, y, w, h] of GLOW) {
        R(ctx, x, y, w, h, '#ffcf6e');
        if (w > 2 && h > 2) { R(ctx, x, y, w, 1, '#ffe7a8'); R(ctx, x, y + h - 1, w, 1, '#f0a84a'); }
      }
      ctx.globalAlpha = 1;
    }
    // clock face: day face, cross-fading to the backlit night face
    const fx = FACE.x - FACE.r - 2, fy = FACE.y - FACE.r - 2;
    ctx.drawImage(faceCv(false), fx, fy);
    if (a > 0.02) { ctx.globalAlpha = a; ctx.drawImage(faceCv(true), fx, fy); ctx.globalAlpha = 1; }
    const ny = S.time.ny || { hour: 0, minute: 0, second: 0 };
    const hr = ((ny.hour % 12) + ny.minute / 60) / 12 * Math.PI * 2;
    const mn = (ny.minute + ny.second / 60) / 60 * Math.PI * 2;
    const sc = ny.second / 60 * Math.PI * 2;
    S.px.line(ctx, FACE.x, FACE.y, FACE.x + Math.sin(mn) * 8.4, FACE.y - Math.cos(mn) * 8.4, '#2b2633');
    S.px.line(ctx, FACE.x, FACE.y, FACE.x + Math.sin(hr) * 5.2, FACE.y - Math.cos(hr) * 5.2, '#2b2633');
    const rr = FACE.r - 1.2;
    D(ctx, Math.round(FACE.x + Math.sin(sc) * rr), Math.round(FACE.y - Math.cos(sc) * rr), '#c0392b');
    D(ctx, FACE.x, FACE.y, P.goldDark);
  });

  /* ======================================================================
   * dynamic 800: quest marker while "you" tasks are open
   * ==================================================================== */
  const questCount = openHumanTasks().length;
  S.registerDynamic(800, (ctx, t) => {
    if (!questCount) return;
    const bob = S.reducedMotion ? 0 : Math.round(Math.sin(t * 3) * 1.5);
    const x = BOARD.x + (BOARD.w >> 1) - 3, y = BOARD.y - 14 + bob;
    R(ctx, x, y, 7, 10, P.outline);
    R(ctx, x + 1, y + 1, 5, 8, P.gold);
    R(ctx, x + 1, y + 1, 5, 1, '#fff2b8'); R(ctx, x + 1, y + 8, 5, 1, P.goldDark);
    R(ctx, x + 3, y + 2, 1, 4, P.outline); R(ctx, x + 3, y + 7, 1, 1, P.outline);
  });
})();
