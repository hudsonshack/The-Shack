/* The Shack v2: CLOCKSPIRE, the hub island (id 'square'), home of Mayor Tock.
 *
 * Owns (see WORLD_SPEC.md):
 *   static 15   the clock tower, fountain + overflow channel, quest board, mail
 *               post, the Chronicle lectern, benches, planters, and the four
 *               docks: kite landing pad (NW), blimp mooring mast (NE), sky-ship
 *               pier (SW) and the sky-rail station end with its buffers (SE)
 *   dyn 100     fountain overflow running down its channel and off the south
 *               edge as a little waterfall into space          {island: square}
 *   dyn 200     fountain jets + splashes; the top of the spire (it rises above
 *               the island's static box)                      {island: square}
 *   dyn 400     the bell swinging during the ceremony's bell beat, the wind
 *               sock and the mast pennant                     {island: square}
 *   dyn 700     clock face with real New York time, lamp glass, lit slits,
 *               the Chronicle's glowing pages, dock beacons   {island: square}
 *   dyn 800     bobbing quest marker while "you" tasks are open {island: square}
 *   entities    lamp posts (y-sorted so people pass in front of and behind them)
 *
 * Real data only: notes = open tasks with autonomy 'human' (bare pins when
 * none), mail flag/letters = recent commits, ribbons = recap entries, coins in
 * the fountain = goals. Empty data shows honest empty props.
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S || !S.islands || !S.islands.square) return;

  const ID = 'square';
  const T = S.TILE, P = S.PAL, CO = S.color, sh = CO.shade, mix = CO.mix, hash = S.hash;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
  const R = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const D = (c, x, y, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), 1, 1); };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const OUT = P.outline;
  const season = () => S.time.season || 'autumn';
  const isWinter = () => season() === 'winter';

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

  /* ======================================================================
   * Island edge (mirrors the islands module's organic top for Clockspire so
   * the docks and the waterfall meet the real lip). Global native px.
   * ==================================================================== */
  const EDGE = (function () {
    const r = S.islands[ID], s = 3, box = S.islandBox(ID);
    const ox = box.x, oy = box.y, bw = box.w, bh = box.h;
    const X0 = r.x * T - ox, Y0 = r.y * T - oy, X1 = (r.x + r.w) * T - ox, Y1 = (r.y + r.h) * T - oy;
    const top = new Uint8Array(bw * bh);
    const cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2, inset = 9, rad = 54;
    const hx = (X1 - X0) / 2 - inset, hy = (Y1 - Y0) / 2 - inset;
    for (let y = Y0 + 1; y < Y1 - 1; y++) for (let x = X0 + 1; x < X1 - 1; x++) {
      const gx = x + ox, gy = y + oy;
      const qx = Math.abs(x + 0.5 - cx) - (hx - rad), qy = Math.abs(y + 0.5 - cy) - (hy - rad);
      const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
      const n = (fbm(gx / 50, gy / 50, s) - 0.5) * 30 + (vnoise(gx / 10, gy / 10, s + 5) - 0.5) * 7 + (hash(gx >> 1, gy >> 1, s + 9) - 0.5) * 2.2;
      if (sd + n < 0) top[y * bw + x] = 1;
    }
    const fillTile = (tx, ty) => {
      for (let y = ty * T - oy; y < (ty + 1) * T - oy; y++) for (let x = tx * T - ox; x < (tx + 1) * T - ox; x++)
        if (x >= 0 && y >= 0 && x < bw && y < bh) top[y * bw + x] = 1;
    };
    for (let ty = r.y; ty < r.y + r.h; ty++) for (let tx = r.x; tx < r.x + r.w; tx++) if (S.onRoad(tx, ty)) fillTile(tx, ty);
    for (const k in S.landmarks) { const L = S.landmarks[k]; if (L.island === ID) fillTile(L.x, L.y); }
    for (const k in S.nav.nodes) if (S.nav.island[k] === ID) fillTile(S.nav.nodes[k][0], S.nav.nodes[k][1]);
    for (let pass = 0; pass < 3; pass++) for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
      const i = y * bw + x, n = top[i - 1] + top[i + 1] + top[i - bw] + top[i + bw];
      if (top[i] && n < 2) top[i] = 0; else if (!top[i] && n >= 3) top[i] = 1;
    }
    return {
      bot(gx) { const x = gx - ox; if (x < 0 || x >= bw) return -1; for (let y = bh - 1; y >= 0; y--) if (top[y * bw + x]) return y + oy; return -1; },
      left(gy) { const y = gy - oy; if (y < 0 || y >= bh) return -1; for (let x = 0; x < bw; x++) if (top[y * bw + x]) return x + ox; return -1; },
      right(gy) { const y = gy - oy; if (y < 0 || y >= bh) return -1; for (let x = bw - 1; x >= 0; x--) if (top[y * bw + x]) return x + ox; return -1; },
      on(gx, gy) { const x = gx - ox, y = gy - oy; return x >= 0 && y >= 0 && x < bw && y < bh && top[y * bw + x] === 1; },
    };
  })();
  const BOX = S.islandBox(ID);

  /* ======================================================================
   * Layout (native px). Paths: tower x624-655 y304-399, crossing y368-399,
   * chronicle x688-719 y368-463, dock spurs on rows 17-18 and 29-30.
   * ==================================================================== */
  const CX = 640;                                        // the island's north-south axis
  // The tower is drawn with the v1 numbers shifted by (LX, LY).
  const LX = 112, LY = 48;
  const TWR = { x: 594, y: 132, w: 86, h: 176 };        // cached tower canvas (new coords)
  const TOWER = { x0: 608, x1: 672, base: 304 };
  const SPIRE_CUT = BOX.y;                               // rows above this are drawn dynamically
  const BELL = { x: 640, y: 207 };
  const FACE = { x: 640, y: 244, r: 11 };
  const FOUNTAIN = { x: 640, y: 428 };
  const FT = { rx: 24, ry: 11, wall: 6, wrx: 20, wry: 8 };
  const BOARD = { x: 561, y: 326, w: 42, base: 366 };
  const MAIL = { x: 694, base: 364 };
  const LECT = { x: 704, base: 476 };
  const PAD = { x: 508, y: 288, rx: 21, ry: 12 };
  const MAST = { x: 792, base: 292, top: 228 };
  const PIER = { x0: 452, x1: 526, y0: 467, y1: 492 };
  const STN = { y: 472, end: 770, x1: 808 };            // rail centre line, buffer, abutment end
  const CH = { x: 640, y0: FOUNTAIN.y + FT.ry + FT.wall - 1 };
  CH.lip = Math.max(CH.y0 + 8, EDGE.bot(CH.x) > 0 ? EDGE.bot(CH.x) : 505);
  const LAMPS = [[612, 352], [668, 352], [590, 468], [674, 468]];
  const BENCHES = [[582, 420], [674, 420]];
  /** Festoon of little bulbs strung between the two lamps at the tower path. */
  const FESTOON = (function () {
    const [ax, ay] = LAMPS[0], [bx] = LAMPS[1], y0 = ay - 33, pts = [];
    for (let x = ax + 2; x <= bx; x++) pts.push([x, y0 + Math.round(Math.sin(((x - ax - 2) / (bx - ax - 2)) * Math.PI) * 7)]);
    return { pts, bulbs: pts.filter((p, i) => i % 5 === 3) };
  })();
  const BULB = ['#ffcf6e', '#ff8a6a', '#8fe0c0', '#ffe7a8'];
  const PLANTERS = [[590, 290, 15, 12], [675, 290, 15, 12]];

  /* ------------------------------------------------------------ reserve (at load) */
  S.reserve(37, 14, 6, 5);   // clock tower + flanking planters
  S.reserve(38, 25, 4, 3);   // fountain
  S.reserve(39, 28, 3, 4);   // overflow channel to the south lip
  S.reserve(35, 20, 3, 3);   // quest board
  S.reserve(42, 21, 2, 2);   // mail post
  S.reserve(43, 28, 2, 2);   // chronicle lectern
  S.reserve(30, 16, 3, 3);   // kite landing pad + wind sock
  S.reserve(48, 16, 2, 3);   // blimp mast
  S.reserve(28, 28, 5, 3);   // sky-ship pier
  S.reserve(47, 26, 4, 5);   // rail station
  for (const [x, y] of BENCHES) S.reserve((x / T) | 0, (y / T) | 0, 2, 1);
  for (const [x, y] of LAMPS) S.reserve((x / T) | 0, ((y - 4) / T) | 0, 1, 1);

  /* ------------------------------------------------------------ data helpers */
  const arr = (v) => (Array.isArray(v) ? v : []);
  const openHumanTasks = () => arr(S.data.tasks).filter((t) => t && t.autonomy === 'human' && t.phase !== 'done');
  function recentCommits(days) {
    const now = S.now().getTime();
    return arr(S.data.commits).filter((c) => { const t = Date.parse(c && c.at); return isFinite(t) && now - t < days * 864e5 && now - t > -864e5; });
  }
  function recapRibbons() {
    const r = S.data.recaps || {};
    return [['daily', '#e8b75a'], ['weekly', '#3fb8a6'], ['monthly', '#c8463a']].flatMap(([k, col]) => arr(r[k]).map(() => col));
  }
  const goalCount = () => arr(S.data.goals).length;
  const AGENT_COL = { hub: '#e8b75a', 'academic-core': '#86d0b0', 'ledger-fi': '#f2c94c', 'social-ops': '#ff5fb0', 'hustle-engine': '#63b4e6' };

  /* ------------------------------------------------------------ hotspots + lights */
  const HOT = [
    ['clockTower', 'hub', 602, 134, 76, 172],
    ['fountain', 'hub', 612, 398, 56, 56],
    ['questBoard', 'hub', 556, 310, 52, 58],
    ['mailPost', 'hub', 682, 334, 30, 32],
    ['chronicle', 'hub', 688, 436, 34, 48],
    ['dockNW', 'academic-core', 482, 252, 52, 52],
    ['dockNE', 'social-ops', 774, 214, 34, 82],
    ['dockSW', 'hustle-engine', 448, 438, 82, 62],
    ['dockSE', 'ledger-fi', 760, 426, 54, 62],
  ];
  for (const [key, agent, x, y, w, h] of HOT) {
    const lm = S.landmarks[key] || {};
    S.addHotspot({ id: 'landmark:' + key, kind: 'landmark', landmark: key, biome: ID, island: ID, agent, label: lm.label || key, x, y, w, h, priority: 1 });
  }
  for (const [x, y] of LAMPS) S.addLight({ x: x + 1, y: y - 29, r: 32, color: P.lanternGlow, intensity: 0.85, flicker: 0.08, island: ID });
  S.addLight({ x: FACE.x, y: FACE.y, r: 26, color: '#ffe6a8', intensity: 0.75, island: ID });
  S.addLight({ x: LECT.x, y: LECT.base - 26, r: 30, color: '#ffc870', intensity: 0.8, flicker: 0.06, island: ID });
  S.addLight({ x: PIER.x0 + 6, y: PIER.y0 - 24, r: 26, color: P.lantern, intensity: 0.8, flicker: 0.1, island: ID });
  S.addLight({ x: 786, y: 450, r: 24, color: P.lanternGlow, intensity: 0.75, flicker: 0.06, island: ID });
  S.addLight({ x: MAST.x, y: MAST.top - 6, r: 14, color: '#ff5a4a', intensity: 0.7, island: ID });
  S.addLight({ x: PAD.x, y: PAD.y, r: 24, color: '#9ff0cf', intensity: 0.45, island: ID });
  S.addLight({ x: 618, y: 286, r: 12, color: P.lantern, intensity: 0.6, island: ID });
  S.addLight({ x: 662, y: 286, r: 12, color: P.lantern, intensity: 0.6, island: ID });

  /** Panes that glow at night (drawn at 700): [x, y, w, h]. */
  const GLOW = [];

  /* ======================================================================
   * Drawing primitives
   * ==================================================================== */
  function ell(c, cx, cy, rx, ry, col) {
    c.fillStyle = col;
    for (let dy = -ry; dy <= ry; dy++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((ry + 0.35) * (ry + 0.35)))));
      c.fillRect(Math.round(cx - w), Math.round(cy + dy), w * 2 + 1, 1);
    }
  }
  const shadow = (c, cx, cy, rx, ry) => ell(c, cx, cy, rx, ry, P.shadow);
  function box(c, x, y, w, h, base, opt = {}) {
    R(c, x, y, w, h, opt.outline || OUT);
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
  function shingles(c, x, y, w, h, base, seed = 0) {
    const lt = sh(base, 0.16), dk = sh(base, -0.22), ln = sh(base, -0.4);
    R(c, x, y, w, h, base);
    for (let row = 0, yy = y; yy < y + h; row++, yy += 4) {
      const off = row % 2 ? 3 : 0;
      for (let xx = x - off; xx < x + w; xx += 6) {
        const bx = Math.max(x, xx), bw = Math.min(xx + 6, x + w) - bx;
        if (bw <= 0) continue;
        const hv = hash(xx, yy, seed + 3);
        R(c, bx, yy, bw, Math.min(4, y + h - yy), hv < 0.25 ? dk : hv > 0.82 ? lt : base);
        if (xx >= x) R(c, xx, yy, 1, Math.min(3, y + h - yy), ln);
        R(c, bx, Math.min(yy + 3, y + h - 1), bw, 1, ln);
        if (bw > 2) D(c, bx + 1, yy, lt);
      }
    }
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
  /** Wooden planks seen from above, boards running north-south. */
  const WOOD = { hi: '#d9a86a', l: '#c08a52', b: '#9b6b3d', d: '#74502c', deep: '#4f3520', seam: '#3e2a18' };
  const IRON = { hi: '#a9b2c4', l: '#7d869a', b: '#59607a', d: '#3c4155', deep: '#262a38' };
  const STONE = { hi: '#ece4d4', l: '#d3cbbb', b: '#b4ab9a', d: '#8d8576', deep: '#625b50' };

  /* ======================================================================
   * Clock tower (v1 art, moved; the arch is now Mayor Tock's front door)
   * ==================================================================== */
  const SAND_ST = { b: '#cdb48c', l: '#e4d1aa', d: '#a48a64', m: '#7d6648', o: '#3d2f22' };
  const BRICK = '#a4533e';
  let towerCv = null, towerKey = null;
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
  /* clock face: cached disc, hands drawn per frame */
  const faceCache = {};
  function faceCv(night) {
    const k = night ? 'n' : 'd';
    if (faceCache[k]) return faceCache[k];
    const r = FACE.r, s = r * 2 + 5, c = mk(s, s).getContext('2d');
    const m = r + 2;
    ell(c, m, m, r + 2, r + 2, OUT);
    ell(c, m, m, r + 1, r + 1, P.goldDark);
    ell(c, m - 0.5, m - 0.5, r + 1, r + 1, P.gold);
    ell(c, m, m, r, r, P.goldDark);
    const fc = night ? '#fff1c4' : '#f4ead2';
    ell(c, m, m, r - 1, r - 1, fc);
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
  function drawTowerInto(c, winter) {
    c.save();
    c.translate(LX - TWR.x, LY - TWR.y); // from here on: v1 coordinates
    const x0 = 496, x1 = 560, VCX = 528;
    // base block
    stoneBlocks(c, x0, 220, x1 - x0, 36, 2);
    R(c, x0 - 1, 251, x1 - x0 + 2, 5, SAND_ST.d); R(c, x0 - 1, 251, x1 - x0 + 2, 1, SAND_ST.b); R(c, x0 - 1, 255, x1 - x0 + 2, 1, SAND_ST.m);
    R(c, x0 - 1, 220, 1, 36, SAND_ST.o); R(c, x1, 220, 1, 36, SAND_ST.o);
    for (let y = 220; y < 256; y++) for (let x = x1 - 5; x < x1; x++) if (bay(x, y) < (x - x1 + 6) / 7) D(c, x, y, SAND_ST.d);
    // arch voussoirs + door opening
    const A = { cx: VCX, hw: 12, spring: 240, top: 228 };
    for (let y = A.top - 4; y < 256; y++) {
      const dy = A.spring - y;
      const ro = dy > 0 ? Math.sqrt(Math.max(0, (A.hw + 4) ** 2 - dy * dy)) : A.hw + 4;
      const ri = dy > 0 ? Math.sqrt(Math.max(0, A.hw ** 2 - dy * dy)) : A.hw;
      if (ro <= 0) continue;
      const xa = Math.round(A.cx - ro), xb = Math.round(A.cx + ro);
      const xi0 = Math.round(A.cx - ri), xi1 = Math.round(A.cx + ri);
      if (y < A.spring + 2) for (let x = xa; x < xb; x++) {
        if (x >= xi0 && x < xi1 && ri > 0) continue;
        const ang = Math.atan2(A.spring - y, x - A.cx + 0.5);
        D(c, x, y, Math.floor(ang / (Math.PI / 9)) % 2 ? SAND_ST.l : SAND_ST.b);
      }
      if (ri > 0 && y < 254) {
        D(c, xi0 - 1, y, SAND_ST.o); D(c, xi1, y, SAND_ST.o);
        // the door: vertical oak boards, lit from the top-left
        for (let x = xi0; x < xi1; x++) {
          const k = (x - xi0) % 4, mid = x === A.cx || x === A.cx - 1;
          let col = k === 3 ? '#3e2716' : k === 0 ? '#8a5c34' : '#6e4628';
          if (mid) col = x === A.cx - 1 ? '#2e1d10' : '#8a5c34';
          if (y < A.top + 3 + Math.abs(x - A.cx) / 3) col = '#2e1d10'; // shade under the arch
          D(c, x, y, col);
        }
      }
    }
    // iron straps, studs and ring pulls
    for (const sy of [242, 249]) { R(c, A.cx - A.hw, sy, A.hw * 2, 1, '#2b2633'); for (let x = A.cx - A.hw + 2; x < A.cx + A.hw; x += 4) D(c, x, sy, '#7d869a'); }
    for (const rx of [A.cx - 4, A.cx + 3]) { D(c, rx, 245, P.goldDark); D(c, rx, 246, P.gold); D(c, rx - 1, 247, P.goldDark); D(c, rx + 1, 247, P.goldDark); }
    // threshold step
    R(c, A.cx - A.hw - 3, 253, A.hw * 2 + 6, 3, SAND_ST.o); R(c, A.cx - A.hw - 2, 253, A.hw * 2 + 4, 1, SAND_ST.l); R(c, A.cx - A.hw - 2, 254, A.hw * 2 + 4, 1, SAND_ST.b);
    // keystone
    box(c, A.cx - 3, A.top - 6, 7, 8, SAND_ST.l, { outline: SAND_ST.o });
    // arrow slits either side of the door (lit at night)
    for (const sx of [x0 + 6, x1 - 8]) {
      R(c, sx - 1, 231, 4, 11, SAND_ST.o); R(c, sx, 232, 2, 9, '#2a2130'); D(c, sx, 232, '#3b3042');
    }
    // ledge 1
    R(c, x0 - 3, 216, x1 - x0 + 6, 4, SAND_ST.o); R(c, x0 - 2, 216, x1 - x0 + 4, 1, SAND_ST.l); R(c, x0 - 2, 217, x1 - x0 + 4, 1, SAND_ST.b); R(c, x0 - 2, 218, x1 - x0 + 4, 1, SAND_ST.d);
    // brick shaft
    const sx0 = 502, sx1 = 554;
    R(c, sx0 - 1, 176, sx1 - sx0 + 2, 40, OUT);
    bricks(c, sx0, 176, sx1 - sx0, 40, BRICK, 4);
    for (let y = 176; y < 216; y++) for (let x = sx1 - 6; x < sx1; x++) if (bay(x, y) < (x - sx1 + 7) / 8) D(c, x, y, sh(BRICK, -0.3));
    for (let i = 0, y = 176; y < 216; i++, y += 5) {
      const wq = i % 2 ? 4 : 7;
      box(c, sx0, y, wq, 5, SAND_ST.b, { outline: SAND_ST.m });
      box(c, sx1 - wq, y, wq, 5, SAND_ST.d, { outline: SAND_ST.m, light: SAND_ST.b, dark: SAND_ST.m });
    }
    // clock surround plate
    const fx = FACE.x - LX, fy = FACE.y - LY;
    box(c, fx - 15, fy - 15, 31, 31, SAND_ST.b, { outline: SAND_ST.o });
    for (const [ox, oy] of [[-13, -13], [11, -13], [-13, 11], [11, 11]]) { R(c, fx + ox, fy + oy, 3, 3, P.goldDark); D(c, fx + ox, fy + oy, P.gold); }
    c.drawImage(faceCv(false), fx - FACE.r - 2, fy - FACE.r - 2);
    // ledge 2
    R(c, sx0 - 4, 172, sx1 - sx0 + 8, 4, SAND_ST.o); R(c, sx0 - 3, 172, sx1 - sx0 + 6, 1, SAND_ST.l); R(c, sx0 - 3, 173, sx1 - sx0 + 6, 1, SAND_ST.b); R(c, sx0 - 3, 174, sx1 - sx0 + 6, 1, SAND_ST.d);
    // belfry
    const bx0 = 504, bx1 = 552;
    stoneBlocks(c, bx0, 150, bx1 - bx0, 22, 9);
    R(c, bx0, 150, 1, 22, SAND_ST.o); R(c, bx1 - 1, 150, 1, 22, SAND_ST.o);
    for (let y = 154; y < 168; y++) {
      const dy = 160 - y, r = dy > 0 ? Math.sqrt(Math.max(0, 144 - dy * dy * 2.2)) : 12;
      if (r > 0) { R(c, Math.round(VCX - r) - 1, y, Math.round(r * 2) + 2, 1, SAND_ST.o); R(c, Math.round(VCX - r), y, Math.round(r * 2), 1, y < 158 ? '#1c1622' : '#2a2130'); }
    }
    R(c, VCX - 12, 156, 24, 1, '#5a4030');
    R(c, bx0 + 2, 166, bx1 - bx0 - 4, 6, SAND_ST.o);
    R(c, bx0 + 2, 166, bx1 - bx0 - 4, 1, SAND_ST.l);
    for (let x = bx0 + 4; x < bx1 - 4; x += 3) R(c, x, 167, 2, 4, SAND_ST.b);
    // the spire: a tall slate needle (Clockspire's namesake)
    const peak = 98, eave = 150;
    for (let y = peak; y <= eave; y++) {
      const f = (y - peak) / (eave - peak);
      const hw = Math.round(1 + Math.pow(f, 1.25) * 29);
      R(c, VCX - hw - 1, y, hw * 2 + 2, 1, OUT);
      for (let x = VCX - hw; x < VCX + hw; x++) {
        const row = Math.floor((y - peak) / 4), ly = (y - peak) % 4;
        const scl = (x + (row % 2) * 3) % 6;
        let col = x < VCX ? '#5c6a85' : '#46526a';
        if (ly === 3 || scl === 0) col = x < VCX ? '#46526a' : '#363f54';
        else if (ly === 0 && x < VCX) col = '#74829e';
        if (x < VCX && x < VCX - hw + 2) col = '#8593ad';     // lit left rim
        if ((x === VCX || x === VCX - 1) && (y < 126 || y > 137)) col = '#7f6a3d'; // brass ridge
        D(c, x, y, col);
      }
    }
    // dormer lucarne with a tiny clock-gold window, halfway up
    const ly0 = 128;
    R(c, VCX - 5, ly0, 10, 9, OUT); R(c, VCX - 4, ly0 + 1, 8, 8, '#5c6a85'); R(c, VCX - 4, ly0 + 1, 8, 1, '#8593ad');
    R(c, VCX - 3, ly0 + 3, 6, 5, '#2a2130'); R(c, VCX - 2, ly0 + 4, 4, 3, '#3b3042');
    for (let i = 0; i < 4; i++) { D(c, VCX - 5 + i, ly0 - 1 - i, OUT); D(c, VCX + 4 - i, ly0 - 1 - i, OUT); }
    R(c, VCX - 32, eave, 64, 2, OUT); R(c, VCX - 31, eave, 62, 1, '#363f54');
    for (let x = VCX - 30; x < VCX + 30; x += 6) { D(c, x, eave + 1, P.goldDark); }
    if (winter) {
      for (let y = peak + 4; y < eave; y++) {
        const f = (y - peak) / (eave - peak), hw = Math.round(1 + Math.pow(f, 1.25) * 29);
        for (let x = VCX - hw; x < VCX - hw + Math.max(2, hw * 0.5); x++) if (bay(x, y) < 0.75 - (y - peak) / 70) D(c, x, y, P.snow);
      }
      snowCap(c, x0 - 2, 214, x1 - x0 + 4, 2, 5);
      snowCap(c, sx0 - 3, 170, sx1 - sx0 + 6, 2, 6);
      snowCap(c, VCX - 4, ly0 - 1, 8, 1, 8);
    }
    // finial + weather vane
    const fy0 = peak - 13;
    R(c, VCX - 1, fy0, 2, 13, OUT); D(c, VCX - 1, fy0 + 1, P.gold);
    R(c, VCX - 2, fy0 + 7, 4, 4, OUT); R(c, VCX - 1, fy0 + 8, 2, 2, P.gold); D(c, VCX - 1, fy0 + 8, '#fff2b8');
    R(c, VCX - 7, fy0 + 2, 14, 1, OUT); R(c, VCX - 6, fy0 + 2, 12, 1, P.goldDark);
    R(c, VCX + 5, fy0 + 1, 2, 3, P.goldDark); R(c, VCX - 8, fy0, 2, 5, P.goldDark); D(c, VCX - 8, fy0, P.gold);
    D(c, VCX - 1, fy0 - 1, P.gold);
    c.restore();
  }
  function ensureTower() {
    const key = isWinter() ? 'w' : 's';
    if (towerCv && towerKey === key) return;
    towerKey = key;
    towerCv = mk(TWR.w, TWR.h);
    drawTowerInto(towerCv.getContext('2d'), isWinter());
  }
  function bellAt(c, x, y, swing) {
    const s = swing | 0;
    R(c, x - 1, y - 3, 2, 3, '#5a4030');
    const rows = [[3, 0], [4, 1], [4, 2], [5, 3], [5, 4], [5, 5], [6, 6], [7, 7]];
    for (const [hw, dy] of rows) R(c, Math.round(x - hw + s * (dy / 7)) - 1, y + dy, hw * 2 + 2, 1, OUT);
    for (const [hw, dy] of rows) {
      const xx = Math.round(x - hw + s * (dy / 7)), yy = y + dy;
      R(c, xx, yy, hw * 2, 1, P.gold);
      R(c, xx, yy, 2, 1, '#fff0b0');
      R(c, xx + hw * 2 - 3, yy, 3, 1, P.goldDark);
    }
    R(c, Math.round(x - 1 + s * 1.3), y + 8, 2, 2, OUT);
  }

  /* ======================================================================
   * Fountain + overflow channel
   * ==================================================================== */
  function inBasinWater(x, y) {
    const dx = (x - FOUNTAIN.x) / (FT.wrx + 0.4), dy = (y - FOUNTAIN.y) / (FT.wry + 0.4);
    return dx * dx + dy * dy <= 1;
  }
  function drawFountain(c, winter) {
    const { x, y } = FOUNTAIN;
    shadow(c, x + 4, y + FT.wall + 3, FT.rx + 2, FT.ry + 1);
    for (let k = FT.wall; k >= 0; k--) ell(c, x, y + k, FT.rx + 1, FT.ry + 1, OUT);
    for (let k = FT.wall - 1; k >= 1; k--) ell(c, x, y + k, FT.rx, FT.ry, k > 3 ? '#8a847c' : '#a39d93');
    for (let xx = x - FT.rx; xx <= x + FT.rx; xx++) {
      const dx = (xx - x) / FT.rx, yb = Math.round(y + FT.ry * Math.sqrt(Math.max(0, 1 - dx * dx)));
      if ((xx - x + 40) % 7 === 0) R(c, xx, yb + 1, 1, FT.wall - 1, '#6f6a64');
      if (xx > x + 6) for (let k = 1; k < FT.wall; k++) if (bay(xx, yb + k) < (xx - x - 6) / 22) D(c, xx, yb + k, '#6f6a64');
      D(c, xx, yb + 1, '#c9c3b8');
    }
    // the overflow spout on the front of the basin (a little lion-less stone lip)
    const sy = y + FT.ry;
    R(c, x - 3, sy - 1, 7, 4, OUT); R(c, x - 2, sy - 1, 5, 2, '#d3cdc1'); R(c, x - 2, sy + 1, 5, 1, '#8a847c');
    // rim top
    ell(c, x, y, FT.rx, FT.ry, '#b9b2a6');
    ell(c, x - 1, y - 1, FT.rx - 1, FT.ry - 1, '#d3cdc1');
    ell(c, x, y, FT.rx - 2, FT.ry - 2, '#a39d93');
    ell(c, x, y, FT.wrx + 1, FT.wry + 1, '#6d685f');
    if (winter) {
      ell(c, x, y, FT.wrx, FT.wry, '#d6e9f2');
      ell(c, x - 3, y - 2, FT.wrx - 6, FT.wry - 3, '#eef6fa');
      for (let i = 0; i < 7; i++) D(c, x - 12 + i * 4, y + ((i * 3) % 5) - 2, '#a9c7d6');
    } else {
      ell(c, x, y, FT.wrx, FT.wry, P.water);
      ell(c, x + 1, y + 1, FT.wrx - 2, FT.wry - 2, P.waterDeep);
      for (let xx = x - FT.wrx + 2; xx < x + FT.wrx - 2; xx++) D(c, xx, y - FT.wry + 1 + ((Math.abs(xx - x) > 14) ? 1 : 0), P.waterDeep);
    }
    // wishing coins: one per goal (honest: none when there are no goals)
    const n = Math.min(12, goalCount());
    for (let i = 0; i < n; i++) {
      const a = hash(i, 5, 31) * Math.PI * 2, rr = 5 + hash(i, 6, 31) * 12;
      const cx = Math.round(x + Math.cos(a) * rr), cy = Math.round(y + 1 + Math.sin(a) * rr * 0.4);
      if (!inBasinWater(cx, cy) || !inBasinWater(cx + 1, cy) || Math.abs(cx - x) < 5) continue;
      D(c, cx, cy, winter ? '#c9a84a' : P.gold); D(c, cx + 1, cy, P.goldDark);
    }
    // pedestal
    R(c, x - 4, y - 16, 9, 20, OUT);
    R(c, x - 3, y - 15, 7, 19, '#a39d93');
    R(c, x - 3, y - 15, 2, 19, '#c9c3b8');
    R(c, x + 2, y - 15, 2, 19, '#7d776f');
    R(c, x - 5, y + 1, 11, 3, OUT); R(c, x - 4, y + 1, 9, 2, '#b9b2a6');
    // upper bowl
    const by = y - 16;
    for (let k = 3; k >= 0; k--) ell(c, x, by + k, 9, 3, OUT);
    for (let k = 2; k >= 1; k--) ell(c, x, by + k, 8, 2, '#8a847c');
    ell(c, x, by, 8, 2, '#d3cdc1');
    ell(c, x, by, 6, 1, winter ? '#e6f2f8' : P.waterLight);
    R(c, x - 1, by - 5, 3, 5, OUT); R(c, x, by - 6, 1, 6, '#c9c3b8');
    // a tiny brass clock-gear finial (it is Clockspire, after all)
    R(c, x - 2, by - 9, 5, 4, OUT); R(c, x - 1, by - 8, 3, 2, P.gold); D(c, x - 1, by - 8, '#fff0b0'); D(c, x, by - 10, OUT);
    if (winter) {
      for (const ox of [-7, -4, 3, 6]) R(c, x + ox, by + 4, 1, 2 + (ox & 1) * 2, '#e6f2f8');
      snowCap(c, x - 8, by - 2, 17, 1, 9);
      for (let xx = x - FT.rx + 3; xx < x + FT.rx - 3; xx += 1) if (hash(xx, 1, 4) < 0.7) D(c, xx, y - FT.ry + (Math.abs(xx - x) > 17 ? 2 : 0), P.snow);
    }
  }
  /** Stone-lined runnel from the spout to the south lip. */
  function drawChannel(c, winter) {
    const x = CH.x, y0 = CH.y0 + 2, y1 = CH.lip + 1;
    R(c, x - 5, y0, 11, y1 - y0, OUT);
    for (let y = y0; y < y1; y++) {
      const blk = Math.floor((y - y0) / 5), ky = (y - y0) % 5;
      // curbs: lit left, shaded right, block joints
      const jl = ky === 4, jr = (y - y0 + 2) % 5 === 4;
      D(c, x - 4, y, jl ? STONE.d : STONE.hi); D(c, x - 3, y, jl ? STONE.d : STONE.l);
      D(c, x + 3, y, jr ? STONE.deep : STONE.b); D(c, x + 4, y, jr ? STONE.deep : STONE.d);
      if (hash(blk, 2, 51) < 0.3 && !jl) D(c, x - 3, y, STONE.b);
      // water bed
      for (let xx = x - 2; xx <= x + 2; xx++) {
        let col = xx === x + 2 ? P.waterDeep : xx === x - 2 ? '#2a5478' : P.water;
        if (winter) { // frozen: blue ice with a lit left edge and frosty cracks
          col = xx === x - 2 ? '#e6f2f8' : xx === x + 2 ? '#8fb6cc' : '#b4d4e4';
          if (hash(xx, y, 53) < 0.12) col = '#ffffff'; else if ((y + xx * 3) % 11 === 0) col = '#9cc0d4';
        }
        D(c, xx, y, col);
      }
    }
    // a small iron grate where the runnel leaves the plaza
    const gy = 472;
    if (gy > y0 && gy < y1 - 3) { R(c, x - 3, gy, 7, 3, OUT); for (let xx = x - 2; xx <= x + 2; xx += 2) D(c, xx, gy + 1, IRON.l); }
    // the lip: a worn spillway stone
    R(c, x - 5, y1 - 2, 11, 3, OUT); R(c, x - 4, y1 - 2, 9, 1, STONE.hi); R(c, x - 2, y1 - 1, 5, 1, winter ? '#dfeef5' : P.waterLight);
    if (winter) { // frozen spill: icicles hanging off the lip
      for (let i = -3; i <= 3; i++) {
        const len = 3 + ((hash(i, 7, 52) * 10) | 0) + (Math.abs(i) < 2 ? 8 : 0);
        R(c, x + i, y1 + 1, 1, len, i < 0 ? '#d6eaf4' : i === 0 ? '#b4d4e4' : '#8fb6cc');
        R(c, x + i, y1 + 1, 1, Math.min(3, len), '#eef6fa');
        D(c, x + i, y1 + len, '#ffffff');
      }
    }
  }
  let fountainFrames = null;
  function buildFountainFrames() {
    const N = 8, ox = FOUNTAIN.x - 28, oy = FOUNTAIN.y - 32, w = 56, h = 46, frames = [];
    const by = FOUNTAIN.y - 16, fx = FOUNTAIN.x;
    for (let f = 0; f < N; f++) {
      const cv = mk(w, h), c = cv.getContext('2d');
      c.translate(-ox, -oy);
      const ph = f / N;
      const jh = 6 + ((f % 2) ? 1 : 0);
      R(c, fx, by - 10 - jh, 1, jh, P.foam);
      D(c, fx - 1, by - 10 - jh + 1, P.waterLight); D(c, fx + 1, by - 10 - jh + 2, P.waterLight);
      D(c, fx + ((f % 3) - 1), by - 11 - jh, '#ffffff');
      for (const side of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
          const tt = (ph + k / 4) % 1;
          const sx = fx + side * (8 + tt * 7), sy = by + 1 + tt * tt * 14;
          D(c, Math.round(sx), Math.round(sy), tt < 0.5 ? P.foam : P.waterLight);
          if (k % 2 === 0) D(c, Math.round(sx - side), Math.round(sy) - 1, P.waterLight);
        }
        const lx = fx + side * 15, ly = FOUNTAIN.y + 1, rr = 1 + (f % 4);
        for (let a = 0; a < 12; a++) {
          const xx = Math.round(lx + Math.cos(a / 12 * Math.PI * 2) * rr), yy = Math.round(ly + Math.sin(a / 12 * Math.PI * 2) * rr * 0.5);
          if (inBasinWater(xx, yy) && (a + f) % 3) D(c, xx, yy, f % 4 < 2 ? P.foam : P.waterLight);
        }
      }
      for (let k = 0; k < 3; k++) { const tt = (ph + k / 3) % 1; D(c, fx + ((k % 2) ? 1 : -1), Math.round(by + 3 + tt * 9), P.foam); }
      for (let i = 0; i < 7; i++) {
        const gx = Math.round(fx - 17 + hash(i, f, 71) * 34), gy = Math.round(FOUNTAIN.y - 6 + hash(i, f, 72) * 12);
        if (inBasinWater(gx, gy) && inBasinWater(gx + 1, gy)) { D(c, gx, gy, P.waterLight); if (i % 2) D(c, gx + 1, gy, P.foam); }
      }
      frames.push(cv);
    }
    fountainFrames = { frames, ox, oy };
  }
  /* Overflow: water running down the runnel, over the lip and down the rock,
   * then breaking into droplets that fade into space (dithered, no AA). */
  const FALL = { len: 128, w: 20 };
  let fallFrames = null;
  function buildFallFrames() {
    const N = 8, x0 = CH.x - (FALL.w >> 1), y0 = CH.y0 + 2, y1 = CH.lip + 1, yEnd = y1 + FALL.len;
    const frames = [], wl = P.waterLight, fm = P.foam, wa = P.water, wd = P.waterDeep;
    for (let f = 0; f < N; f++) {
      const cv = mk(FALL.w, yEnd - y0 + 4), c = cv.getContext('2d');
      const put = (x, y, col) => D(c, x - x0, y - y0, col);
      // runnel streaks moving downhill
      for (let y = y0; y < y1; y++) for (let xx = CH.x - 1; xx <= CH.x + 1; xx++) {
        const k = (y - f * 2 + xx * 5 + 400) % 9;
        if (k === 0) put(xx, y, fm); else if (k === 1 || k === 5) put(xx, y, wl);
      }
      // the fall: a ribbon widening as it drops, streaks sliding down
      for (let y = y1; y < yEnd; y++) {
        const t = (y - y1) / FALL.len;
        const half = 2.2 + t * 2.6 + Math.sin(y * 0.27 + f * 0.8) * 0.35;
        const cx = CH.x + 0.5;
        for (let xx = Math.floor(cx - half - 1); xx <= Math.ceil(cx + half + 1); xx++) {
          const e = Math.abs(xx + 0.5 - cx) / half;
          if (e > 1) continue;
          // dissolve: solid near the lip, a dithered fade into space lower down
          const fade = Math.max(0, (t - 0.42) / 0.55) + e * e * 0.25 * t;
          if (bay(xx, y + f * 2) < fade) continue;
          const sk = (y - f * 5 + Math.floor(hash(xx, 3, 61) * 23) + 800) % 13;
          let col = sk < 2 ? fm : sk < 5 ? wl : wa;
          if (e > 0.72 && xx > cx) col = sk < 2 ? wl : wd;          // shaded right edge
          if (e > 0.72 && xx < cx) col = sk < 7 ? wl : fm;          // lit left edge
          if (t < 0.05) col = (xx + y) % 2 ? fm : wl;               // white water at the lip
          put(xx, y, col);
        }
      }
      // mist puffs where the ribbon dissolves
      for (let i = 0; i < 6; i++) {
        const tt = (f / N + i / 6) % 1, mx = Math.round(CH.x + (hash(i, 4, 67) - 0.5) * 10), my = Math.round(y1 + FALL.len * (0.62 + tt * 0.3));
        if (bay(mx, my) < 0.7 - tt * 0.6) { put(mx, my, fm); put(mx + 1, my, wl); }
      }
      // spray where it goes over the lip
      for (let i = 0; i < 5; i++) {
        const a = hash(i, f, 63), sx = CH.x - 4 + Math.round(a * 9), sy = y1 + 1 + Math.round(hash(i, f, 64) * 4);
        put(sx, sy, fm);
      }
      // droplets breaking off into space
      for (let i = 0; i < 9; i++) {
        const tt = (f / N + i / 9) % 1, dx = (hash(i, 2, 65) - 0.5) * 12;
        const y = Math.round(y1 + FALL.len * (0.55 + tt * 0.5)), x = Math.round(CH.x + dx * (0.4 + tt));
        if (y < yEnd + 2 && hash(i, f, 66) < 1.05 - tt) put(x, y, tt < 0.5 ? wl : wa);
      }
      frames.push(cv);
    }
    fallFrames = { frames, x: x0, y: y0 };
  }

  /* ======================================================================
   * Square furniture
   * ==================================================================== */
  let lampCv = null, lampKey = null;
  function drawLampAt(c, x, base) {
    R(c, x - 2, base - 3, 6, 3, OUT); R(c, x - 1, base - 3, 4, 2, '#4a4458');
    R(c, x - 1, base - 22, 4, 20, OUT); R(c, x, base - 22, 2, 20, '#3c3648'); R(c, x, base - 22, 1, 20, '#5d566c');
    R(c, x - 2, base - 22, 6, 1, OUT);
    R(c, x - 3, base - 31, 8, 9, OUT);
    R(c, x - 2, base - 30, 6, 7, '#3c3648');
    R(c, x - 1, base - 29, 4, 5, '#f3dfa6'); D(c, x - 1, base - 29, '#fff7d8');
    R(c, x - 4, base - 33, 10, 2, OUT); R(c, x - 3, base - 33, 8, 1, '#5d566c');
    R(c, x, base - 35, 2, 2, OUT); D(c, x, base - 35, P.gold);
    if (isWinter()) R(c, x - 3, base - 34, 8, 1, P.snow);
  }
  function lampSprite() {
    const key = season();
    if (lampCv && lampKey === key) return lampCv;
    lampKey = key; lampCv = mk(12, 38);
    const c = lampCv.getContext('2d');
    c.translate(5, 37);
    drawLampAt(c, 0, 0);
    return lampCv;
  }
  for (const [x, y] of LAMPS) {
    S.addEntity({ x: x + 1, y, island: ID, kind: 'prop', draw(ctx) { ctx.drawImage(lampSprite(), x - 5, y - 37); } });
  }
  function drawBench(c, x, y) {
    shadow(c, x + 9, y + 9, 9, 2);
    R(c, x, y, 16, 3, OUT); R(c, x + 1, y + 1, 14, 1, '#b07d4a');
    R(c, x, y + 3, 16, 2, OUT); R(c, x + 1, y + 3, 14, 1, '#9b6b3d');
    R(c, x - 1, y + 5, 18, 3, OUT); R(c, x, y + 5, 16, 1, '#c89060'); R(c, x, y + 6, 16, 1, '#8d5f35');
    for (const lx of [x + 1, x + 13]) { R(c, lx, y, 2, 10, OUT); D(c, lx, y + 1, '#5d566c'); R(c, lx, y + 8, 2, 2, '#3c3648'); }
    if (isWinter()) R(c, x, y + 5, 16, 1, P.snow);
  }
  function flowerCols() {
    return {
      spring: ['#f2a7c3', '#ffd34d', '#ffffff', '#c58cf0'],
      summer: ['#ff6b6b', '#ffd34d', '#ff9fd0', '#7aa7ff'],
      autumn: ['#e8722f', '#f2c94c', '#b8432f', '#c86ad0'],
      winter: ['#7e8f86', '#5f726a', '#b8432f', '#7e8f86'],
    }[season()] || ['#e8722f', '#f2c94c', '#b8432f', '#c86ad0'];
  }
  function drawPlanter(c, x, y, w, h) {
    const sea = season();
    shadow(c, x + w / 2 + 3, y + h + 1, w / 2 + 1, 2);
    box(c, x, y, w, h, '#a39d93', { light: '#c9c3b8', dark: '#77726f' });
    R(c, x + 2, y + 2, w - 4, h - 5, '#5a4030');
    for (let yy = y + 2; yy < y + h - 3; yy++) for (let xx = x + 2; xx < x + w - 2; xx++) if (hash(xx, yy, 2) < 0.2) D(c, xx, yy, '#6e4f3a');
    const cols = flowerCols(), leaf = sea === 'winter' ? '#4f6a55' : '#3f7a2a';
    for (let yy = y + 1; yy < y + h - 4; yy += 3) for (let xx = x + 2; xx < x + w - 2; xx += 3) {
      const hv = hash(xx, yy, 6);
      R(c, xx, yy + 1, 2, 2, leaf);
      if (sea === 'winter') { D(c, xx, yy, P.snow); if (hv < 0.25) D(c, xx + 1, yy + 1, '#b8432f'); continue; }
      const col = cols[(hv * 4) | 0];
      D(c, xx, yy, col); D(c, xx + 1, yy, sh(col, -0.2)); D(c, xx, yy - 1, sh(col, 0.3));
    }
    R(c, x + 1, y + h - 3, w - 2, 1, '#8a847c');
    if (sea === 'winter') R(c, x + 1, y, w - 2, 1, P.snow);
  }

  /* ---------------------------------------------------------- quest board */
  function drawQuestBoard(c) {
    const { x, y, w, base } = BOARD, winter = isWinter();
    shadow(c, x + w / 2 + 4, base, w / 2 + 2, 3);
    for (const px0 of [x + 3, x + w - 7]) { R(c, px0, y + 4, 4, base - y - 4, OUT); R(c, px0 + 1, y + 4, 2, base - y - 5, '#8d5f35'); D(c, px0 + 1, y + 4, '#b07d4a'); R(c, px0 + 1, base - 3, 2, 2, '#5d3f22'); }
    const by = y + 7, bh = 24;
    R(c, x, by, w, bh, OUT);
    R(c, x + 1, by + 1, w - 2, bh - 2, '#7a5230');
    R(c, x + 1, by + 1, w - 2, 1, '#a8774a');
    R(c, x + 3, by + 3, w - 6, bh - 6, '#b98a55');
    for (let yy = by + 3; yy < by + bh - 3; yy++) for (let xx = x + 3; xx < x + w - 3; xx++) {
      const hv = hash(xx, yy, 33);
      if (hv < 0.16) D(c, xx, yy, '#a77845'); else if (hv > 0.94) D(c, xx, yy, '#cfa06b');
    }
    R(c, x + 3, by + 3, w - 6, 1, '#94673a');
    R(c, x + w - 4, by + 3, 1, bh - 6, '#94673a');
    // roof
    R(c, x - 3, y, w + 6, 7, OUT);
    shingles(c, x - 2, y + 1, w + 4, 5, '#8a4a34', 7);
    R(c, x - 2, y + 1, w + 4, 1, '#b26a4c');
    if (winter) snowCap(c, x - 2, y, w + 4, 2, 11);
    // header plaque: a gold "!" so the board reads at a glance
    R(c, x + (w >> 1) - 3, by - 2, 7, 5, OUT); R(c, x + (w >> 1) - 2, by - 1, 5, 3, P.gold); D(c, x + (w >> 1), by - 1, OUT); D(c, x + (w >> 1), by + 1, OUT);
    // one pinned note per open "you" task
    const tasks = openHumanTasks();
    const slots = [];
    for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) slots.push([x + 5 + col * 8 + (row ? 2 : 0), by + 5 + row * 9]);
    const n = Math.min(tasks.length, 8);
    for (let i = 0; i < n; i++) {
      const t = tasks[i], [nx, ny] = slots[i];
      const tilt = hash(i, 3, 44) < 0.5 ? 0 : 1;
      const paper = t.priority === 1 ? '#fbf1d6' : t.priority === 2 ? '#f3e7c8' : '#e9dcbc';
      R(c, nx + 1, ny + 1, 7, 8, 'rgba(40,24,10,0.35)');
      R(c, nx, ny + tilt, 7, 8 - tilt, paper);
      R(c, nx, ny + 7, 7, 1, sh(paper, -0.15));
      D(c, nx + 6, ny + tilt, sh(paper, -0.1));
      for (let l = 0; l < 3; l++) R(c, nx + 1, ny + 2 + l * 2 + tilt, (l === 2 ? 3 : 5) - ((i + l) % 2), 1, '#8a7a62');
      if (t.priority === 1) { R(c, nx + 4, ny + 5, 2, 2, '#c0392b'); D(c, nx + 4, ny + 5, '#e86a5a'); }
      const pc = AGENT_COL[t.agent] || P.gold;
      D(c, nx + 3, ny - 1 + tilt, OUT); D(c, nx + 3, ny + tilt, pc); D(c, nx + 2, ny + tilt, sh(pc, -0.3));
    }
    if (tasks.length > 8) {
      const [nx, ny] = slots[7];
      R(c, nx + 2, ny - 1, 7, 8, '#e9dcbc'); R(c, nx + 1, ny, 7, 8, '#f3e7c8'); D(c, nx + 4, ny + 3, '#8a7a62');
    }
    if (n === 0) { // honest empty board: just a few bare pins
      for (const [px0, py0] of [[x + 9, by + 7], [x + 20, by + 13], [x + 31, by + 8], [x + 14, by + 16]]) { D(c, px0, py0, OUT); D(c, px0, py0 + 1, '#b8b2a8'); D(c, px0 + 1, py0 + 1, 'rgba(40,24,10,0.35)'); }
    }
  }

  /* ---------------------------------------------------------- mail post */
  function drawMailPost(c) {
    const x = MAIL.x, base = MAIL.base;
    shadow(c, x + 9, base, 8, 2);
    R(c, x + 5, base - 16, 4, 16, OUT); R(c, x + 6, base - 16, 2, 15, '#8d5f35'); D(c, x + 6, base - 16, '#b07d4a');
    R(c, x + 3, base - 2, 8, 2, OUT);
    const my = base - 26, mw = 14, mh = 10;
    R(c, x, my + 1, mw, mh, OUT); R(c, x + 1, my, mw - 2, 1, OUT);
    R(c, x + 1, my + 2, mw - 2, mh - 2, '#3d6497');
    R(c, x + 2, my + 1, mw - 4, 1, '#5a82b5');
    R(c, x + 1, my + 2, mw - 2, 1, '#6d94c4');
    R(c, x + 1, my + mh - 1, mw - 2, 1, '#284468');
    R(c, x + mw - 3, my + 2, 1, mh - 3, '#284468'); D(c, x + mw - 2, my + 5, P.gold);
    // a gold post-horn on the side
    D(c, x + 4, my + 5, P.gold); D(c, x + 5, my + 4, P.gold); D(c, x + 6, my + 5, P.goldDark); D(c, x + 5, my + 6, P.goldDark);
    if (isWinter()) R(c, x + 1, my - 1, mw - 2, 2, P.snow);
    const recent = recentCommits(3).length, week = recentCommits(7).length;
    // letters peeking out = commits this week (max 3)
    for (let i = 0; i < Math.min(3, week); i++) { R(c, x + mw - 1, my + 3 + i * 2, 4, 2, OUT); R(c, x + mw - 1, my + 3 + i * 2, 3, 1, '#fbf4e4'); }
    // flag up when something was committed in the last 3 days
    if (recent > 0) { R(c, x - 2, my - 5, 2, 10, OUT); R(c, x - 6, my - 5, 5, 5, OUT); R(c, x - 5, my - 4, 4, 3, '#d64545'); D(c, x - 5, my - 4, '#f07070'); }
    else { R(c, x - 7, my + 4, 8, 2, OUT); R(c, x - 7, my + 4, 5, 1, '#a83a3a'); }
  }

  /* ---------------------------------------------------------- the Chronicle */
  function drawLectern(c) {
    const x = LECT.x, base = LECT.base, winter = isWinter();
    shadow(c, x + 4, base, 11, 3);
    // foot: a carved cross-base
    R(c, x - 9, base - 4, 18, 4, OUT); R(c, x - 8, base - 4, 16, 1, WOOD.l); R(c, x - 8, base - 3, 16, 2, WOOD.b); R(c, x - 8, base - 2, 16, 1, WOOD.d);
    // column with a twisted carving
    R(c, x - 3, base - 20, 7, 17, OUT);
    for (let y = base - 19; y < base - 4; y++) {
      const k = (y + 40) % 4;
      D(c, x - 2, y, k < 2 ? WOOD.l : WOOD.b); D(c, x - 1, y, k === 1 ? WOOD.hi : WOOD.b); D(c, x, y, WOOD.b); D(c, x + 1, y, k > 1 ? WOOD.d : WOOD.b); D(c, x + 2, y, WOOD.deep);
    }
    // slanted desk (front face shows)
    const dy = base - 30;
    R(c, x - 14, dy, 29, 11, OUT);
    R(c, x - 13, dy + 1, 27, 6, WOOD.b);
    R(c, x - 13, dy + 1, 27, 1, WOOD.l);
    R(c, x - 13, dy + 7, 27, 3, WOOD.d); R(c, x - 13, dy + 9, 27, 1, WOOD.deep);
    D(c, x - 12, dy + 8, P.gold); D(c, x + 12, dy + 8, P.gold);
    // the open book
    const bx = x - 12, byy = dy - 6;
    R(c, bx - 1, byy, 26, 10, OUT);
    R(c, bx, byy + 8, 24, 2, '#7a2e2a');                        // red cover peeking under the pages
    for (const [px0, flip] of [[bx, 0], [bx + 13, 1]]) {
      for (let i = 0; i < 11; i++) {
        const curve = flip ? (i > 7 ? 1 : 0) : (i < 3 ? 1 : 0);
        R(c, px0 + i, byy + curve, 1, 8 - curve, '#f6ecd2');
        D(c, px0 + i, byy + 7, '#d9c9a2');
      }
      R(c, flip ? px0 + 9 : px0, byy + 1, 2, 7, flip ? '#e2d3ad' : '#fff8e6');
    }
    R(c, bx + 11, byy, 2, 9, '#b8a57e'); D(c, bx + 11, byy, OUT); D(c, bx + 12, byy + 8, '#8a7a5a');
    const ribbons = recapRibbons();
    if (ribbons.length) { // written pages
      for (let l = 0; l < 3; l++) {
        R(c, bx + 2, byy + 2 + l * 2, 7 - (l === 2 ? 3 : 0), 1, '#9a8a6a');
        R(c, bx + 15, byy + 2 + l * 2, 7 - (l === 1 ? 2 : 0), 1, '#9a8a6a');
      }
      D(c, bx + 2, byy + 2, '#c8463a'); // illuminated capital
    }
    // ribbon bookmarks, one per recap entry (daily gold, weekly teal, monthly red)
    const n = Math.min(ribbons.length, 10);
    for (let i = 0; i < n; i++) {
      const rx = bx + 3 + Math.round(i * (18 / Math.max(1, n - 1 || 1))) + (n === 1 ? 7 : 0);
      const len = 7 + ((hash(i, 9, 81) * 5) | 0);
      R(c, rx, byy + 8, 1, len, ribbons[i]);
      D(c, rx, byy + 8 + len, sh(ribbons[i], -0.3));
      D(c, rx + 1, byy + 9, sh(ribbons[i], -0.35));
    }
    if (winter) { R(c, x - 13, dy, 27, 1, P.snow); R(c, x - 8, base - 4, 16, 1, P.snow); }
  }

  /* ---------------------------------------------------------- dockNW: kite landing pad */
  function drawKitePad(c) {
    const { x, y, rx, ry } = PAD, winter = isWinter();
    // a stone corbel under the overhang
    for (let k = 0; k < 9; k++) R(c, x - rx + 4 + k, y + ry + 2, 1, 9 - k, k < 3 ? STONE.d : STONE.deep);
    S.px.line(c, x - rx + 3, y + ry + 2, x - rx + 3, y + ry + 11, OUT); S.px.line(c, x - rx + 3, y + ry + 11, x - rx + 13, y + ry + 2, OUT);
    shadow(c, x + 4, y + 7, rx + 2, ry + 1);
    // thickness (front face): dressed stone blocks
    for (let k = 5; k >= 1; k--) ell(c, x, y + k, rx + 1, ry + 1, OUT);
    for (let k = 4; k >= 1; k--) ell(c, x, y + k, rx, ry, k > 2 ? STONE.deep : STONE.d);
    for (let xx = -rx + 2; xx < rx; xx += 6) { const yb = Math.round(ry * Math.sqrt(Math.max(0, 1 - (xx * xx) / (rx * rx)))); R(c, x + xx, y + yb + 1, 1, 3, OUT); }
    ell(c, x, y, rx + 1, ry + 1, OUT);
    // deck: pale flagstones in rings, lit from the top-left
    for (let yy = -ry; yy <= ry; yy++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (yy * yy) / ((ry + 0.35) * (ry + 0.35)))));
      for (let xx = -w; xx <= w; xx++) {
        const q = Math.sqrt((xx * xx) / (rx * rx) + (yy * yy) / (ry * ry)), ang = Math.atan2(yy * rx / ry, xx);
        let col = q > 0.86 ? STONE.b : STONE.l;
        if (q > 0.86 && Math.floor((ang + 7) * 4) % 3 === 0 && Math.abs(q - 0.93) < 0.06) col = STONE.d;
        if (Math.abs(q - 0.86) < 0.05) col = STONE.d;
        if (q < 0.84 && hash(x + xx, y + yy, 92) < 0.08) col = STONE.b;
        if (xx + yy * 1.6 < -rx * 0.8 && q > 0.7 && col !== STONE.d) col = STONE.hi;
        if (winter && vnoise((x + xx) / 6, (y + yy) / 4, 93) > 0.45) col = vnoise((x + xx) / 3, (y + yy) / 3, 94) > 0.5 ? P.snow : '#dfe7ee';
        D(c, x + xx, y + yy, col);
      }
    }
    // painted landing ring (dashed) + kite glyph in Lantern Peak's colour
    const kc = AGENT_COL['academic-core'];
    for (let a = 0; a < 64; a++) {
      if (a % 4 === 3) continue;
      const th = (a / 64) * Math.PI * 2;
      D(c, x + Math.round(Math.cos(th) * (rx - 6)), y + Math.round(Math.sin(th) * (ry - 4)), kc);
    }
    const g = ['....o....', '...oLo...', '..oLsko..', '.oLkskko.', 'osssssss o'.replace(' ', ''), '.okkskdo.', '..okSdo..', '...odo...', '....o....'];
    S.px.sprite(c, g, x - 4, y - 5, { o: OUT, k: kc, L: sh(kc, 0.35), d: sh(kc, -0.25), s: '#f4efe2', S: '#f4efe2' });
    D(c, x, y + 4, sh(kc, -0.4)); D(c, x + 1, y + 5, '#c8463a'); D(c, x, y + 6, sh(kc, -0.4)); D(c, x - 1, y + 7, '#e8b75a');
    // rim light posts (glow at night)
    for (const [lx, ly] of [[x - rx + 1, y], [x + rx - 1, y], [x - 9, y - ry + 1], [x + 9, y - ry + 1], [x - 9, y + ry - 1], [x + 9, y + ry - 1]]) {
      R(c, lx - 1, ly - 2, 3, 3, OUT); D(c, lx, ly - 1, '#cfeee0');
    }
    // wind sock pole (the sock itself flutters in the dynamic layer)
    const px0 = x - rx + 3, py0 = y - 3;
    R(c, px0 - 1, py0 - 26, 3, 27, OUT); R(c, px0, py0 - 25, 1, 25, '#d8d4cc'); D(c, px0, py0 - 26, P.gold);
    R(c, px0 - 2, py0 - 1, 5, 2, OUT);
  }
  const SOCK = { x: PAD.x - PAD.rx + 4, y: PAD.y - 28 };

  /* ---------------------------------------------------------- dockNE: blimp mooring mast */
  function drawMast(c) {
    const x = MAST.x, base = MAST.base, top = MAST.top, winter = isWinter();
    shadow(c, x + 5, base + 1, 10, 3);
    // stone footing
    box(c, x - 9, base - 7, 19, 8, STONE.b, { light: STONE.hi, dark: STONE.d });
    R(c, x - 8, base - 2, 17, 1, STONE.deep);
    // lattice legs (dark iron with a lit left face)
    const legL = (y) => Math.round(x - 6 + (base - 7 - y) / (base - 7 - top) * 3.5);
    const legR = (y) => Math.round(x + 6 - (base - 7 - y) / (base - 7 - top) * 3.5);
    for (let y = top + 6; y < base - 6; y++) {
      D(c, legL(y) - 1, y, OUT); D(c, legL(y), y, IRON.hi); D(c, legL(y) + 1, y, IRON.l);
      D(c, legR(y) - 1, y, IRON.b); D(c, legR(y), y, IRON.d); D(c, legR(y) + 1, y, OUT);
    }
    // cross bracing
    for (let y = top + 10; y < base - 12; y += 9) {
      S.px.line(c, legL(y) + 1, y, legR(y + 9) - 1, y + 9, IRON.b);
      S.px.line(c, legR(y) - 1, y, legL(y + 9) + 1, y + 9, IRON.d);
      R(c, legL(y), y, legR(y) - legL(y) + 1, 1, IRON.l);
    }
    // ladder rungs up the middle
    for (let y = top + 22; y < base - 8; y += 3) D(c, x, y, '#c9a24a');
    // the service platform with its rail
    const py = top + 18;
    R(c, x - 9, py, 19, 3, OUT); R(c, x - 8, py, 17, 1, IRON.hi); R(c, x - 8, py + 1, 17, 1, IRON.b);
    R(c, x - 9, py - 5, 1, 5, OUT); R(c, x + 9, py - 5, 1, 5, OUT); R(c, x - 9, py - 5, 19, 1, OUT);
    for (let xx = x - 7; xx < x + 9; xx += 3) D(c, xx, py - 3, IRON.l);
    // mooring head: a brass cone on a swivel, pointing toward Neon Hollow (NE)
    R(c, x - 4, top + 2, 9, 6, OUT); R(c, x - 3, top + 3, 7, 4, P.goldDark); R(c, x - 3, top + 3, 7, 1, P.gold); D(c, x - 3, top + 3, '#fff0b0');
    const cone = ['oooo....', 'okggoo..', 'okgggwoo', 'okggggdo', 'okgggddo', 'okgddoo.', 'oooo....'];
    S.px.sprite(c, cone, x + 3, top + 1, { o: OUT, k: P.goldDark, g: P.gold, w: '#fff0b0', d: '#a8741e' });
    D(c, x + 11, top + 4, '#3c3648'); D(c, x + 12, top + 4, OUT); // mooring eye
    // neon trim bands (Lumi's colours) that glow at night
    R(c, x - 5, top + 9, 11, 1, P.neonPink); R(c, x - 5, base - 14, 11, 1, P.neonCyan);
    // beacon housing on top
    R(c, x - 2, top - 3, 5, 5, OUT); R(c, x - 1, top - 2, 3, 3, '#7a2a24'); D(c, x - 1, top - 2, '#c8463a');
    if (winter) { R(c, x - 8, py - 1, 17, 1, P.snow); R(c, x - 8, base - 8, 17, 1, P.snow); R(c, x - 3, top + 2, 7, 1, P.snow); }
  }

  /* ---------------------------------------------------------- dockSW: sky-ship pier */
  function drawPier(c) {
    const { x0, x1, y0, y1 } = PIER, winter = isWinter();
    const edge = Math.max(x0 + 8, (EDGE.left(y1) > 0 ? EDGE.left(y1) : 492) - 2);
    // struts and hanging pilings under the deck, out over space
    for (const px0 of [x0 + 4, x0 + 18, x0 + 32]) {
      if (px0 > edge - 4) continue;
      const len = 10 + ((px0 - x0) >> 2);
      R(c, px0, y1 + 2, 4, len, OUT); R(c, px0 + 1, y1 + 2, 2, len - 1, WOOD.d); D(c, px0 + 1, y1 + 2, WOOD.b);
      R(c, px0 + 1, y1 + len - 2, 2, 1, IRON.b);
      S.px.line(c, px0 + 3, y1 + len - 3, Math.min(edge, px0 + 3 + len), y1 + 1, OUT);
      S.px.line(c, px0 + 3, y1 + len - 4, Math.min(edge, px0 + 3 + len), y1, WOOD.deep);
    }
    // a lantern on a rope dangling under the far end
    R(c, x0 + 1, y1 + 3, 1, 8, '#6e5a3e'); R(c, x0, y1 + 11, 3, 4, OUT); D(c, x0 + 1, y1 + 12, '#ffcf6e');
    GLOW.push([x0 + 1, y1 + 12, 1, 2]);
    // deck: boards run north-south (across the walkway)
    c.fillStyle = 'rgba(20,16,30,0.28)'; c.fillRect(x0 + 3, y1 + 3, x1 - x0 - 4, 3);
    for (let x = x0; x < x1; x++) {
      const b = ((x - x0) / 4) | 0, k = (x - x0) % 4;
      const tone = hash(b, 1, 61);
      const base = tone < 0.3 ? WOOD.d : tone > 0.8 ? WOOD.l : WOOD.b;
      const joint = y0 + 4 + ((hash(b, 2, 61) * (y1 - y0 - 8)) | 0);
      for (let y = y0; y < y1; y++) {
        let col = base;
        if (k === 3) col = WOOD.seam;
        else if (k === 0) col = sh(base, 0.1);
        if (y === joint && k !== 3) col = WOOD.seam;
        if ((y === y0 + 2 || y === y1 - 3) && k === 1) col = '#2a1d14';
        if (k !== 3 && hash(x, y, 62) < 0.04) col = sh(base, -0.15);
        if (winter && k !== 3) { const nn = vnoise(x / 7, y / 5, 64) + (hash(x, y, 63) - 0.5) * 0.12; if (nn > 0.38) col = nn > 0.5 ? P.snow : '#dfe7ee'; }
        D(c, x, y, col);
      }
    }
    // stringers: north cap lit, south fascia dark, west end outline
    R(c, x0, y0 - 2, x1 - x0, 2, WOOD.l); R(c, x0, y0 - 2, x1 - x0, 1, WOOD.hi); R(c, x0, y0 - 3, x1 - x0, 1, OUT);
    R(c, x0, y1, x1 - x0, 3, WOOD.deep); R(c, x0, y1, x1 - x0, 1, WOOD.d); R(c, x0, y1 + 3, x1 - x0, 1, OUT);
    R(c, x0 - 1, y0 - 3, 1, y1 - y0 + 7, OUT);
    // mooring posts at the pier head
    for (const [px0, py0] of [[x0 - 1, y0 - 6], [x0 - 1, y1 - 4], [x0 + 24, y0 - 6], [x0 + 24, y1 - 4]]) {
      R(c, px0, py0, 5, 8, OUT); R(c, px0 + 1, py0 + 1, 3, 7, WOOD.l); D(c, px0 + 1, py0 + 1, WOOD.hi); R(c, px0 + 3, py0 + 2, 1, 6, WOOD.d);
      R(c, px0 + 1, py0 + 3, 3, 1, '#c9b48a');
      if (winter) R(c, px0 + 1, py0, 3, 1, P.snow);
    }
    // rope railing along the north edge, sagging between the posts
    for (let x = x0 + 4; x < x0 + 24; x++) { const sag = Math.round(Math.sin(((x - x0 - 4) / 20) * Math.PI) * 2); D(c, x, y0 - 4 + sag, '#c9b48a'); }
    // iron bollards + a coil of rope
    for (const bx of [x0 + 36, x0 + 54]) for (const by of [y0 + 1, y1 - 4]) {
      R(c, bx, by, 4, 3, OUT); R(c, bx + 1, by - 1, 2, 1, OUT);
      R(c, bx + 1, by, 2, 2, IRON.b); D(c, bx + 1, by, IRON.hi);
    }
    const rx = x0 + 44, ry = y0 + 12;
    ell(c, rx, ry, 4, 2, OUT); ell(c, rx, ry, 3, 1, '#c9b48a'); D(c, rx, ry, '#8a7650'); D(c, rx - 2, ry, '#e2d0a4');
    // the lantern post at the head
    const lx = x0 + 4, lb = y0 + 2;
    R(c, lx - 1, lb - 28, 4, 28, OUT); R(c, lx, lb - 27, 2, 27, WOOD.d); R(c, lx, lb - 27, 1, 27, WOOD.b);
    R(c, lx, lb - 28, 6, 2, OUT); R(c, lx + 4, lb - 26, 1, 2, OUT);
    R(c, lx + 2, lb - 24, 6, 8, OUT); R(c, lx + 3, lb - 23, 4, 6, '#3c3648'); R(c, lx + 4, lb - 22, 2, 4, '#f3dfa6');
    GLOW.push([lx + 4, lb - 22, 2, 4]);
    // a little sign with Spindrift Harbor's sail
    const sx = x1 - 14, sy = y0 - 14;
    R(c, sx + 4, sy + 8, 2, 7, OUT); R(c, sx, sy, 11, 9, OUT); R(c, sx + 1, sy + 1, 9, 7, '#e9dcbc');
    const sc = AGENT_COL['hustle-engine'];
    R(c, sx + 5, sy + 2, 1, 5, '#6e5a3e'); D(c, sx + 4, sy + 3, sc); R(c, sx + 3, sy + 4, 2, 1, sc); R(c, sx + 2, sy + 5, 3, 1, sc); R(c, sx + 2, sy + 6, 7, 1, '#8a6440');
  }

  /* ---------------------------------------------------------- dockSE: rail station end */
  function drawStation(c) {
    const y = STN.y, xe = STN.end, x1 = STN.x1, winter = isWinter();
    // stone abutment at the island lip where the sky-rail lands
    const ab = Math.max(xe + 18, (EDGE.right(y) > 0 ? EDGE.right(y) : 792) - 4);
    box(c, ab, y - 10, x1 - ab + 2, 18, STONE.b, { light: STONE.hi, dark: STONE.d });
    R(c, ab + 1, y + 6, x1 - ab, 2, STONE.deep);
    for (let yy = y - 8; yy < y + 6; yy += 5) R(c, ab + 1, yy, x1 - ab, 1, STONE.d);
    // ballast bed
    for (let x = xe - 4; x <= x1; x++) for (let o = -7; o <= 7; o++) {
      if (Math.abs(o) === 7 && hash(x, o, 81) < 0.5) continue;
      const hv = hash(x, y + o, 80);
      D(c, x, y + o, hv > 0.7 ? '#8c8478' : hv > 0.3 ? '#6e675e' : '#57514a');
    }
    // ties
    for (let x = xe - 2; x < x1 - 1; x += 5) {
      R(c, x, y - 6, 2, 13, '#6b4a2e'); R(c, x, y - 6, 1, 13, '#8d6640'); D(c, x + 1, y + 6, '#4a321f');
      R(c, x + 2, y - 5, 1, 12, 'rgba(20,16,30,0.3)');
      if (winter) R(c, x, y - 6, 1, 3, P.snow);
    }
    // rails
    for (const o of [-5, 4]) { R(c, xe, y + o, x1 - xe + 1, 1, '#c8cdd8'); R(c, xe, y + o + 1, x1 - xe + 1, 1, '#7d869a'); R(c, xe, y + o + 2, x1 - xe + 1, 1, '#4a5064'); }
    for (let x = xe + 1; x < x1 - 1; x += 10) { D(c, x, y - 3, '#3a3440'); D(c, x, y + 6, '#3a3440'); }
    // buffer stop facing east (where the minecart halts)
    shadow(c, xe + 1, y + 8, 6, 2);
    R(c, xe - 4, y - 12, 7, 22, OUT);
    R(c, xe - 3, y - 11, 5, 20, '#6b4a2e'); R(c, xe - 3, y - 11, 2, 20, '#8d6640');
    for (let k = 0; k < 18; k += 4) R(c, xe + 1, y - 10 + k, 3, 2, k % 8 === 0 ? '#d8402e' : '#f2ece0');
    R(c, xe + 1, y - 10, 1, 18, OUT); R(c, xe + 4, y - 10, 1, 18, OUT);
    for (const by of [y - 6, y + 3]) { R(c, xe + 4, by - 1, 4, 4, OUT); R(c, xe + 5, by, 2, 2, IRON.l); D(c, xe + 5, by, IRON.hi); }
    R(c, xe - 4, y - 13, 9, 2, OUT); R(c, xe - 3, y - 13, 7, 1, IRON.l);
    D(c, xe - 1, y - 16, OUT); R(c, xe - 2, y - 15, 3, 2, '#d8402e'); // red stop lamp
    GLOW.push([xe - 2, y - 15, 3, 2]);
    // platform shelter north of the track: posts, bench and a copper roof
    const sx0 = 766, sx1 = 804, ry = 428;
    for (const px0 of [sx0 + 3, sx1 - 6]) { R(c, px0, ry + 12, 4, y - 8 - ry - 12, OUT); R(c, px0 + 1, ry + 12, 2, y - 9 - ry - 12, '#4a5064'); D(c, px0 + 1, ry + 12, '#7d869a'); }
    // platform kerb with a painted safety line along the track
    R(c, sx0 + 2, y - 10, sx1 - sx0 - 4, 2, OUT); R(c, sx0 + 2, y - 10, sx1 - sx0 - 4, 1, STONE.hi);
    for (let x = sx0 + 2; x < sx1 - 2; x += 4) R(c, x, y - 9, 2, 1, '#f2c94c');
    // a crate of outbound ledgers waiting for the cart
    box(c, sx0 + 22, y - 19, 9, 8, '#9b6b3d', { light: '#c08a52', dark: '#74502c' }); R(c, sx0 + 23, y - 16, 7, 1, '#74502c');
    // roof: copper with verdigris streaks, lit from the top-left
    R(c, sx0 - 1, ry - 1, sx1 - sx0 + 2, 14, OUT);
    for (let yy = ry; yy < ry + 12; yy++) for (let xx = sx0; xx < sx1; xx++) {
      const k = (xx - sx0) % 5, row = yy - ry;
      let col = k === 4 ? '#6e3f22' : k === 0 ? '#d08a52' : '#b06a3a';
      if (row < 2) col = k === 4 ? '#8a5030' : '#e2a06a';
      if (row > 9) col = '#5a3420';
      if (k !== 4 && hash(xx, yy >> 2, 83) < 0.08) col = '#5fae96';
      D(c, xx, yy, col);
    }
    R(c, sx0, ry + 11, sx1 - sx0, 1, '#3e2414');
    if (winter) snowCap(c, sx0, ry - 1, sx1 - sx0, 3, 21);
    // hanging sign with Copperhold's minecart, and a lantern
    const gx = sx0 + 12, gy = ry + 13;
    R(c, gx + 2, gy, 1, 2, OUT); R(c, gx + 9, gy, 1, 2, OUT);
    R(c, gx, gy + 2, 12, 8, OUT); R(c, gx + 1, gy + 3, 10, 6, '#3c3648');
    const mc = AGENT_COL['ledger-fi'];
    R(c, gx + 3, gy + 4, 6, 3, mc); R(c, gx + 3, gy + 4, 6, 1, '#fff0a8'); D(c, gx + 4, gy + 7, '#c8cdd8'); D(c, gx + 7, gy + 7, '#c8cdd8');
    const lx = sx1 - 12;
    R(c, lx + 1, ry + 12, 1, 4, OUT); R(c, lx - 1, ry + 16, 5, 6, OUT); R(c, lx, ry + 17, 3, 4, '#f3dfa6');
    GLOW.push([lx, ry + 17, 3, 4]);
  }

  /* ======================================================================
   * static 15
   * ==================================================================== */
  S.registerStatic(15, (ctx) => {
    GLOW.length = 0;
    for (const [x, y] of LAMPS) GLOW.push([x - 1, y - 29, 4, 5]);
    // tower: arrow slits beside the door and the lucarne window in the spire
    GLOW.push([TOWER.x0 + 6, 281, 2, 7], [TOWER.x1 - 8, 281, 2, 7], [CX - 2, 180, 4, 3]);
    const winter = isWinter();
    ensureTower();
    // tower shadow (falls to the bottom-right) then the tower
    for (let y = 200; y < TOWER.base; y++) R(ctx, TOWER.x1, y, Math.min(10, ((y - 200) / 10) | 0), 1, P.shadow);
    R(ctx, TOWER.x0 + 4, TOWER.base, TOWER.x1 - TOWER.x0 + 4, 3, P.shadow);
    ctx.drawImage(towerCv, TWR.x, TWR.y);
    bellAt(ctx, BELL.x, BELL.y, 0);
    for (const [x, y, w, h] of PLANTERS) drawPlanter(ctx, x, y, w, h);
    drawChannel(ctx, winter);
    drawFountain(ctx, winter);
    drawQuestBoard(ctx);
    drawMailPost(ctx);
    drawLectern(ctx);
    for (const [x, y] of BENCHES) drawBench(ctx, x, y);
    for (const [x, y] of LAMPS) shadow(ctx, x + 3, y, 4, 1);
    drawKitePad(ctx);
    drawMast(ctx);
    drawPier(ctx);
    drawStation(ctx);
  });

  /* ======================================================================
   * dynamic 100: overflow down the runnel and off the edge into space
   * ==================================================================== */
  S.registerDynamic(100, (ctx, t) => {
    if (isWinter()) return;
    if (!fallFrames) buildFallFrames();
    const f = Math.floor(t * (S.reducedMotion ? 2 : 10)) % fallFrames.frames.length;
    ctx.drawImage(fallFrames.frames[f], fallFrames.x, fallFrames.y);
  }, { island: ID });

  /* ======================================================================
   * dynamic 200: fountain jets; the spire tip above the static box
   * ==================================================================== */
  S.registerDynamic(200, (ctx, t) => {
    if (towerCv && SPIRE_CUT > TWR.y) {
      const h = SPIRE_CUT - TWR.y;
      ctx.drawImage(towerCv, 0, 0, TWR.w, h, TWR.x, TWR.y, TWR.w, h);
    }
    if (isWinter()) return;
    if (!fountainFrames) buildFountainFrames();
    const f = Math.floor(t * (S.reducedMotion ? 3 : 10)) % fountainFrames.frames.length;
    ctx.drawImage(fountainFrames.frames[f], fountainFrames.ox, fountainFrames.oy);
  }, { island: ID });

  /* ======================================================================
   * dynamic 400: bell (swings during the bell beat), wind sock, mast pennant
   * ==================================================================== */
  S.registerDynamic(400, (ctx, t) => {
    const cer = S.cycle && S.cycle.ceremony;
    if (cer && cer.progress < S.CEREMONY_BEATS.bell[1] + 0.02) {
      const swing = Math.round(Math.sin(t * (S.reducedMotion ? 3 : 9)) * 3);
      R(ctx, BELL.x - 9, BELL.y - 2, 18, 11, '#2a2130'); R(ctx, BELL.x - 12, BELL.y - 3, 24, 1, '#5a4030');
      bellAt(ctx, BELL.x, BELL.y, swing);
      if (!S.reducedMotion && Math.sin(t * 9) > 0.85) { // ring lines
        for (const s of [-1, 1]) { D(ctx, BELL.x + s * 14, BELL.y + 2, '#fff0b0'); D(ctx, BELL.x + s * 15, BELL.y + 4, '#fff0b0'); D(ctx, BELL.x + s * 14, BELL.y + 6, '#fff0b0'); }
      }
    }
    // festoon over the tower path
    for (const [x, y] of FESTOON.pts) D(ctx, x, y, '#3a3440');
    FESTOON.bulbs.forEach(([x, y], i) => { D(ctx, x, y + 1, OUT); D(ctx, x, y + 2, sh(BULB[i % 4], -0.25)); });
    // wind sock: striped cone streaming east, flapping
    const sp = S.reducedMotion ? 0 : t * 6;
    for (let i = 0; i < 11; i++) {
      const hh = Math.max(1, Math.round(4 - i * 0.3));
      const wy = Math.round(Math.sin(sp - i * 0.7) * (i / 10) * 1.6 + i * 0.25);
      const x = SOCK.x + 1 + i, y = SOCK.y + wy;
      R(ctx, x, y - 1, 1, hh + 2, OUT);
      R(ctx, x, y, 1, hh, Math.floor(i / 3) % 2 ? '#f4efe2' : '#e8722f');
      D(ctx, x, y, Math.floor(i / 3) % 2 ? '#ffffff' : '#f2a060');
    }
    R(ctx, SOCK.x, SOCK.y - 1, 2, 6, OUT); D(ctx, SOCK.x + 1, SOCK.y, P.gold);
    // pink pennant on the mooring mast
    const mx = MAST.x + 1, my = MAST.top - 10;
    R(ctx, mx - 1, my - 1, 1, 8, OUT);
    for (let i = 0; i < 8; i++) {
      const hh = Math.max(1, 4 - (i >> 1));
      const wy = Math.round(Math.sin(sp * 1.2 - i * 0.8) * (i / 7) * 1.4);
      R(ctx, mx + i, my + wy, 1, hh, i < 2 ? '#ff8ad0' : P.neonPink);
      D(ctx, mx + i, my + wy + hh, OUT);
    }
  }, { island: ID });

  /* ======================================================================
   * dynamic 700: clock face (real New York time) + night glows
   * ==================================================================== */
  S.registerDynamic(700, (ctx, t) => {
    const light = S.time.light == null ? 1 : S.time.light;
    const a = clamp((0.62 - light) / 0.35, 0, 1);
    if (a > 0.02) {
      ctx.globalAlpha = a;
      for (const [x, y, w, h] of GLOW) {
        R(ctx, x, y, w, h, '#ffcf6e');
        if (w > 2 && h > 2) { R(ctx, x, y, w, 1, '#ffe7a8'); R(ctx, x, y + h - 1, w, 1, '#f0a84a'); }
      }
      FESTOON.bulbs.forEach(([x, y], i) => {
        const on = S.reducedMotion || (Math.floor(t * 1.5) + i) % 7 !== 0;
        D(ctx, x, y + 2, on ? BULB[i % 4] : sh(BULB[i % 4], -0.25)); if (on) D(ctx, x, y + 3, sh(BULB[i % 4], -0.1));
      });
      // the Chronicle's pages glow warm, with a few rising motes
      const bx = LECT.x - 12, by = LECT.base - 36;
      ctx.globalAlpha = a * 0.55; R(ctx, bx, by + 1, 24, 7, '#ffe7a8');
      ctx.globalAlpha = a;
      if (!S.reducedMotion) for (let i = 0; i < 3; i++) {
        const tt = (t * 0.35 + i / 3) % 1;
        D(ctx, bx + 6 + i * 6 + Math.round(Math.sin(t * 2 + i) * 1.5), by - 2 - Math.round(tt * 12), tt < 0.6 ? '#ffe7a8' : '#ffcf6e');
      }
      // kite pad rim lights chase around; the mast beacon blinks red
      const step = Math.floor(t * (S.reducedMotion ? 0.5 : 4)) % 6;
      const pads = [[PAD.x - PAD.rx + 1, PAD.y], [PAD.x - 9, PAD.y - PAD.ry + 1], [PAD.x + 9, PAD.y - PAD.ry + 1], [PAD.x + PAD.rx - 1, PAD.y], [PAD.x + 9, PAD.y + PAD.ry - 1], [PAD.x - 9, PAD.y + PAD.ry - 1]];
      pads.forEach(([lx, ly], i) => { D(ctx, lx, ly - 1, i === step ? '#ffffff' : '#7af0c0'); });
      if (S.reducedMotion || Math.floor(t * 1.2) % 2 === 0) { R(ctx, MAST.x - 1, MAST.top - 2, 3, 3, '#ff5a4a'); D(ctx, MAST.x - 1, MAST.top - 2, '#ffd0c8'); }
      R(ctx, MAST.x - 5, MAST.top + 9, 11, 1, P.neonPink); R(ctx, MAST.x - 5, MAST.base - 14, 11, 1, P.neonCyan);
      ctx.globalAlpha = 1;
    }
    // clock face: day face cross-fading to the backlit night face
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
  }, { island: ID });

  /* ======================================================================
   * dynamic 800: quest marker while "you" tasks are open
   * ==================================================================== */
  const questCount = openHumanTasks().length;
  S.registerDynamic(800, (ctx, t) => {
    if (!questCount) return;
    const bob = S.reducedMotion ? 0 : Math.round(Math.sin(t * 3) * 1.5);
    const x = BOARD.x + (BOARD.w >> 1) - 3, y = BOARD.y - 16 + bob;
    R(ctx, x, y, 7, 10, OUT);
    R(ctx, x + 1, y + 1, 5, 8, P.gold);
    R(ctx, x + 1, y + 1, 5, 1, '#fff2b8'); R(ctx, x + 1, y + 8, 5, 1, P.goldDark);
    R(ctx, x + 3, y + 2, 1, 4, OUT); R(ctx, x + 3, y + 7, 1, 1, OUT);
    D(ctx, x + 3, y + 11 + (bob > 0 ? 1 : 0), 'rgba(20,16,30,0.35)');
  }, { island: ID });
})();
