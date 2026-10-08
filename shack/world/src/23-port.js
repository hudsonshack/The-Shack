/* The Shack v2 — SPINDRIFT HARBOR (island 'port'): Cap'n Twirl, hustle-engine.
 *
 * A sleepy sky harbour on a sandy floating island. A spring in the north-east
 * feeds a little river that runs across the island and pours off its WEST edge
 * as a long waterfall into space. Wooden piers jut out from the east side over
 * the void, where cargo sky-ships (chubby wooden hulls under striped gas
 * balloons, with a stern propeller) tie up. Fidgetly is in maintenance mode, so
 * the whole place is calm: slow spinner sign, lazy birds, a gentle crane.
 *
 * Owns:
 *   static 8    ground: bazaar floor with rugs, cargo yard, the river bed and
 *               banks (water base colours), the spring pool
 *   static 23   bazaar stalls (striped awnings, colourful fidgets), the
 *               warehouse (+ annex at growth >= 2), the sky beacon, crate
 *               stacks (red tags for low stock), barrels, sacks, spring rocks,
 *               reeds, notice board, bunting (growth 3)
 *   dyn 100     river glints, spring bubbles, the west waterfall: lip foam,
 *               falling sheet, spray, fading streams far below      {island}
 *   dyn 200     the three piers over the void, the spinner sign       {island}
 *   entities    cargo sky-ships (island 'port'), the cargo crane
 *   dyn 400     sky-birds, signal flag (status), rotor/propeller wind {island}
 *   dyn 700     windows, lanterns, beacon lamp and beam at night      {island}
 *
 * Data (never invented):
 *   ships     = metrics('hustle-engine').shopify.orders_7d: one crate on deck per
 *               order (5 per ship, up to 3 ships). With no orders (or no data) a
 *               single idle ship stays moored: balloon sagging and patched,
 *               lines slack, hold open and empty, propeller still, a bird
 *               dozing on top of the envelope.
 *   red tags  = shopify.low_stock (one tagged, nearly empty crate per item, max 5)
 *   crane     = unloads only while there are orders; parked otherwise
 *   growth    = more stalls, warehouse annex, more crate stacks, bunting
 *   flag      = S.status.port.level (calm pennant / storm flags)
 *
 * The commuter sky-ship that carries Cap'n Twirl to Clockspire belongs to the
 * villagers module; it can berth at S.port.dock (the main pier head).
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S || !S.islands || !S.islands.port) return;

  const ID = 'port';
  const ISL = { island: ID };
  const T = S.TILE, P = S.PAL, CO = S.color;
  const AGENT = 'hustle-engine';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ST = (S.status && S.status.port) || {};
  const GROWTH = clamp(ST.growth | 0, 0, 3);
  const LEVEL = ST.level || 'idle';
  const RM = !!S.reducedMotion;

  /* ------------------------------------------------------------------ data */
  const MET = S.metrics(AGENT) || {};
  const SHOP = MET.shopify || {};
  const KNOWN = typeof SHOP.orders_7d === 'number' && isFinite(SHOP.orders_7d);
  const ORDERS = KNOWN && SHOP.orders_7d > 0 ? Math.floor(SHOP.orders_7d) : 0;
  const LOW = Array.isArray(SHOP.low_stock) ? SHOP.low_stock.filter(Boolean).map(String) : [];

  /* --------------------------------------------------------------- helpers */
  const sh = CO.shade, mix = CO.mix;
  const hash = S.hash;
  const smooth = (t) => t * t * (3 - 2 * t);
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bay = (x, y) => (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
  function vnoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = smooth(x - xi), v = smooth(y - yi);
    const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const fbm = (x, y, s) => vnoise(x, y, s) * 0.6 + vnoise(x * 2.13, y * 2.13, s + 7) * 0.28 + vnoise(x * 4.7, y * 4.7, s + 13) * 0.12;
  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    return [c, g];
  }
  const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const D = (g, x, y, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), 1, 1); };
  function ellipse(g, cx, cy, rx, ry, c) {
    g.fillStyle = c;
    for (let y = -ry; y <= ry; y++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.3))));
      g.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
    }
  }
  function spr(g, rows, x, y, pal) {
    for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) {
      const c = pal[rows[j][i]]; if (c) D(g, x + i, y + j, c);
    }
  }
  /** 1 px outline around every opaque pixel of a canvas (in place). */
  function outline(c, col) {
    const g = c.getContext('2d', { willReadFrequently: true });
    const w = c.width, h = c.height, im = g.getImageData(0, 0, w, h), d = im.data;
    const A = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) A[i] = d[i * 4 + 3] > 80 ? 1 : 0;
    const [r, gg, b] = CO.hexToRgb(col);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (A[i]) continue;
      if ((x > 0 && A[i - 1]) || (x < w - 1 && A[i + 1]) || (y > 0 && A[i - w]) || (y < h - 1 && A[i + w])) {
        d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
    return c;
  }
  /** Winter: a 1–2 px cap of snow on every upward-facing edge. */
  function snowCap(c, deep) {
    const g = c.getContext('2d', { willReadFrequently: true });
    const w = c.width, h = c.height, im = g.getImageData(0, 0, w, h), d = im.data;
    const A = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) A[i] = d[i * 4 + 3] > 80 ? 1 : 0;
    const sn = CO.hexToRgb(P.snow), sd = CO.hexToRgb('#c9d6e0');
    const put = (i, col) => { d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255; };
    for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!A[i] || A[i - w]) continue;
      const j = i + w;
      if (y + 1 < h && A[j]) { put(j, sn); if (deep && y + 2 < h && A[j + w] && hash(x, y, 77) < 0.6) put(j + w, hash(x, y, 78) < 0.5 ? sd : sn); }
    }
    g.putImageData(im, 0, 0);
    return c;
  }
  /** Soft contact shadow (ellipse) on the ground. */
  function groundShadow(g, x, y, w, h) {
    g.fillStyle = P.shadow;
    for (let j = 0; j < h; j++) {
      const t = (j + 0.5) / h * 2 - 1, ww = Math.round(w * Math.sqrt(1 - t * t));
      g.fillRect(Math.round(x + (w - ww) / 2), y + j, ww, 1);
    }
  }
  const season = () => (S.time && S.time.season) || 'autumn';
  const night = () => { const l = S.time && S.time.light != null ? S.time.light : 1; return clamp((0.62 - l) / 0.35, 0, 1); };

  /* ======================================================== ISLAND SHAPE
   * The islands module draws Spindrift Harbor's organic top but does not
   * export its mask, so this mirrors the same deterministic recipe (same seed,
   * same noise) to keep the ground art, river and props on solid ground and to
   * find the west lip where the river pours off.
   */
  const GEO = (function () {
    const r = S.islands[ID], box = S.islandBox(ID), s = 41;
    const bw = box.w, bh = box.h, ox = box.x, oy = box.y, N = bw * bh;
    const X0 = r.x * T - ox, Y0 = r.y * T - oy, X1 = (r.x + r.w) * T - ox, Y1 = (r.y + r.h) * T - oy;
    const top = new Uint8Array(N);
    const RD = 18, rdist = new Uint8Array(N).fill(RD);
    for (let ty = r.y; ty < r.y + r.h; ty++) for (let tx = r.x; tx < r.x + r.w; tx++) {
      if (!S.onRoad(tx, ty)) continue;
      if (tx > r.x + 1 && tx < r.x + r.w - 2 && ty > r.y + 1 && ty < r.y + r.h - 2) continue;
      const x0 = tx * T - ox, y0 = ty * T - oy;
      for (let y = Math.max(0, y0 - RD); y < Math.min(bh, y0 + T + RD); y++) for (let x = Math.max(0, x0 - RD); x < Math.min(bw, x0 + T + RD); x++) {
        const dd = Math.max(x < x0 ? x0 - x : x >= x0 + T ? x - x0 - T + 1 : 0, y < y0 ? y0 - y : y >= y0 + T ? y - y0 - T + 1 : 0);
        const i = y * bw + x; if (dd < rdist[i]) rdist[i] = dd;
      }
    }
    const cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2, inset = 14, rad = 92;
    const hx = (X1 - X0) / 2 - inset, hy = (Y1 - Y0) / 2 - inset;
    for (let y = Y0 + 1; y < Y1 - 1; y++) for (let x = X0 + 1; x < X1 - 1; x++) {
      const gx = x + ox, gy = y + oy;
      const qx = Math.abs(x + 0.5 - cx) - (hx - rad), qy = Math.abs(y + 0.5 - cy) - (hy - rad);
      const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
      const ang = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
      const lobe = Math.sin(ang * 3 + s) * 6 + Math.sin(ang * 5 + s * 1.7) * 4;
      const n = lobe + (fbm(gx / 40, gy / 40, s) - 0.5) * 40 + (vnoise(gx / 9, gy / 9, s + 5) - 0.5) * 9 + (hash(gx >> 1, gy >> 1, s + 9) - 0.5) * 2.4;
      const bonus = Math.max(0, RD - rdist[y * bw + x]) * 0.9;
      if (sd + n - bonus < 0) top[y * bw + x] = 1;
    }
    const fillTile = (tx, ty) => {
      for (let y = ty * T - oy; y < (ty + 1) * T - oy; y++) for (let x = tx * T - ox; x < (tx + 1) * T - ox; x++)
        if (x >= 0 && y >= 0 && x < bw && y < bh) top[y * bw + x] = 1;
    };
    for (let ty = r.y; ty < r.y + r.h; ty++) for (let tx = r.x; tx < r.x + r.w; tx++) if (S.onRoad(tx, ty)) fillTile(tx, ty);
    for (const k in S.landmarks) { const Lm = S.landmarks[k]; if (Lm.island === ID) fillTile(Lm.x, Lm.y); }
    for (const k in S.nav.nodes) if (S.nav.island[k] === ID) fillTile(S.nav.nodes[k][0], S.nav.nodes[k][1]);
    for (let pass = 0; pass < 3; pass++) for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
      const i = y * bw + x, n = top[i - 1] + top[i + 1] + top[i - bw] + top[i + bw];
      if (top[i] && n < 2) top[i] = 0; else if (!top[i] && n >= 3) top[i] = 1;
    }
    const din = new Uint8Array(N);
    for (let i = 0; i < N; i++) din[i] = top[i] ? 80 : 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = y * bw + x; if (!din[i]) continue;
      din[i] = Math.min(din[i], x > 0 ? din[i - 1] + 1 : 1, y > 0 ? din[i - bw] + 1 : 1);
    }
    for (let y = bh - 1; y >= 0; y--) for (let x = bw - 1; x >= 0; x--) {
      const i = y * bw + x; if (!din[i]) continue;
      din[i] = Math.min(din[i], x < bw - 1 ? din[i + 1] + 1 : 1, y < bh - 1 ? din[i + bw] + 1 : 1);
    }
    return {
      ox, oy, bw, bh,
      din: (gx, gy) => { const x = gx - ox, y = gy - oy; return x < 0 || y < 0 || x >= bw || y >= bh ? 0 : din[y * bw + x]; },
      on: (gx, gy) => { const x = gx - ox, y = gy - oy; return x >= 0 && y >= 0 && x < bw && y < bh && top[y * bw + x] === 1; },
      left(gy) { const y = gy - oy; if (y < 0 || y >= bh) return -1; for (let x = 0; x < bw; x++) if (top[y * bw + x]) return x + ox; return -1; },
      right(gy) { const y = gy - oy; if (y < 0 || y >= bh) return -1; for (let x = bw - 1; x >= 0; x--) if (top[y * bw + x]) return x + ox; return -1; },
      bot(gx) { const x = gx - ox; if (x < 0 || x >= bw) return -1; for (let y = bh - 1; y >= 0; y--) if (top[y * bw + x]) return y + oy; return -1; },
    };
  })();

  /* ---------------------------------------------------------------- palette */
  const OUT = P.outline;
  const WOOD = { deep: '#3e2a18', dark: '#5e4026', base: P.plank, mid: '#8a5d34', light: '#b88452', hi: '#d4a46c' };
  const PIERW = { deep: '#33241a', dark: '#5a4232', base: '#8b6a4c', light: '#a7865f', hi: '#c4a57a', seam: '#4a3626' };
  const STONE = { deep: '#3f3d44', dark: '#5e5b63', base: '#7f7b82', light: '#a29ea3', hi: '#c6c2c2', moss: '#6f7d48' };
  const ROPE = { base: '#c9b07a', dark: '#937a4c' };
  const BRICK = { deep: '#4e2219', dark: '#7a3526', base: '#a24a33', light: '#c0644a', mortar: '#c9b7a0' };
  const SLATE = { deep: '#1f2638', dark: '#2f3a52', base: '#43506e', light: '#5f6f92', hi: '#8395b8' };
  const CANVAS = { base: '#efe6cf', mid: '#d9cdb0', dark: '#b3a684', hi: '#fffaf0' };
  const IRON = { deep: '#1f2329', dark: '#343a43', base: '#4f5762', light: '#76808c', hi: '#a9b2bd' };
  const RED = { deep: '#6a1c1f', dark: '#9c2a2c', base: '#d0403b', light: '#ea6a55', hi: '#ff9d7a' };
  const TEAL = { deep: '#163f43', dark: '#215e60', base: '#2f8c88', light: '#4fb5a8', hi: '#8fe0cf' };
  const COPPER = { dark: '#8a4320', base: '#b8642e', light: '#de8a4a' };
  const BRASS = { dark: '#8a6420', base: '#c4952b', light: '#f2c94c', hi: '#fff0a8' };
  const LAMP = { glass: '#ffd77a', hot: '#fff3c4', warm: '#ffb84d' };
  const WATER = { deep: '#2a5f8c', base: '#3f7fb0', mid: '#5598c4', light: '#7cc0e0', hi: '#bfe6f4', foam: '#e8f6fb', shade: '#244f78' };
  const FIDGET = ['#e8403d', '#f28a2e', '#f4cf3a', '#56b947', '#3d8fe0', '#8a5ad8', '#ff6fb0', '#3fd3d0'];
  const AWNINGS = [
    ['#cf3b36', '#f4ebd8'], // pop-its (red / cream)
    ['#2a958f', '#f4ebd8'], // spinners: Twirl's flagship (teal / cream)
    ['#e6a12b', '#fff3d6'], // cubes (marigold / cream)
    ['#7c50bd', '#f4ebd8'], // rings & sticks (violet / cream)
    ['#e0683a', '#fff3d6'], // keychains (orange / cream)
  ];

  /* ------------------------------------------------------------- layout (px) */
  // The river: a spring in the north-east, west across the north of the island,
  // over the west lip. Polyline of [x, y, half-width].
  const RIVER = [[318, 497, 3.5], [300, 501, 4.2], [270, 505, 4.8], [236, 503, 5.2], [200, 507, 5.6], [164, 513, 5.8], [128, 518, 6], [96, 521, 6.2], [72, 522, 6.4], [56, 522, 6.6]];
  const SPRING = { x: 324, y: 494 };
  const MOUTH_Y = 522;
  const LIP_X = (function () { // the lip: the island's left edge at the river's mouth
    let x = 999;
    for (let y = MOUTH_Y - 5; y <= MOUTH_Y + 5; y++) { const l = GEO.left(y); if (l > 0) x = Math.min(x, l); }
    return x < 999 ? x : S.islands[ID].x * T + 6;
  })();

  const STALL_W = 36, STALL_H = 44;
  const STALLS = (function () {
    const all = [
      { kind: 'spinner', aw: 1, flagship: true, side: 'w' },
      { kind: 'popit', aw: 0, side: 'w' },
      { kind: 'cube', aw: 2, side: 'e' },
      { kind: 'rings', aw: 3, side: 'w' },
      { kind: 'keys', aw: 4, side: 'e' },
    ].slice(0, 3 + Math.min(2, GROWTH));
    const west = all.filter((st) => st.side === 'w'), east = all.filter((st) => st.side === 'e');
    const WX = { 1: [150], 2: [116, 156], 3: [132, 172, 92] }[west.length] || [];
    const EX = { 1: [272], 2: [266, 306] }[east.length] || [];
    west.forEach((st, i) => { st.x = WX[i]; st.base = 590; });
    east.forEach((st, i) => { st.x = EX[i]; st.base = 604; });
    return all;
  })();
  const PLAZA_W = { x0: Math.max(84, Math.min(...STALLS.filter((st) => st.side === 'w').map((st) => st.x)) - 18), x1: 222, y0: 538, y1: 608 }; // bazaar floor west of the plank road
  const PLAZA_E = { x0: 256, x1: 352, y0: 560, y1: 616 };  // and east of it, south of the dock road
  const YARD = { x0: 190, x1: 392, y0: 612, y1: 672 };     // cargo yard
  const WH = { x0: 98, x1: 190, roof: 608, eave: 630, base: 664, doorX: 131, doorW: 24 };
  const BEACON = { x: 378, base: 527 };                    // the sky beacon (little lighthouse) on the NE point
  const CRANE = { x: 364, base: 646, top: 558, tipX: 474, backX: 344 };

  // Piers over the void (east side): deck y range and x span; root overlaps the island.
  const PIER_MAIN = { x0: 394, x1: 446, y0: 530, y1: 557 }; // skyDock: continues the plank road
  const PIER_A = { x0: 390, x1: 454, y0: 594, y1: 606 };
  const PIER_B = { x0: 374, x1: 448, y0: 652, y1: 664 };

  // Ships. Local origin: bow tip x, near deck edge y. Filled in order.
  const BERTHS = [
    { x: 458, y: 604, L: 58, hull: '#2f6e8c', accent: '#f2c94c', sail: TEAL.base, pier: PIER_A },
    { x: 452, y: 664, L: 54, hull: '#7a3440', accent: '#f4ebd8', sail: '#e0683a', pier: PIER_B },
    { x: 476, y: 730, L: 52, hull: '#3d6a46', accent: '#ff9fc8', sail: '#7c50bd', pier: null },
  ];
  const SHIPS = [];
  if (!ORDERS) SHIPS.push(Object.assign({}, BERTHS[0], { cargo: 0, empty: true, idx: 0 }));
  else {
    let left = ORDERS;
    for (let i = 0; i < BERTHS.length && left > 0; i++) {
      const n = Math.min(5, left); left -= n;
      SHIPS.push(Object.assign({}, BERTHS[i], { cargo: n, empty: false, idx: i }));
    }
  }

  // Crate yard stacks (x, base y, layout): more with growth. Low-stock items get tagged crates by the door.
  const STACKS = [
    { x: 288, y: 640, k: 'pyr' }, { x: 214, y: 630, k: 'two' }, { x: 320, y: 662, k: 'row' },
    { x: 252, y: 660, k: 'pyr' }, { x: 334, y: 634, k: 'two' }, { x: 270, y: 626, k: 'row' },
  ].slice(0, 3 + GROWTH);
  const TAG0 = GROWTH >= 2 ? 212 : 196;
  const TAGGED = LOW.slice(0, 5).map((name, i) => ({ name, x: TAG0 + (i % 3) * 13, y: 652 + (i >= 3 ? 10 : 0) - (i % 3 === 1 ? 2 : 0) }));

  /* Reserve the tiles we build on (island decor keeps off them). */
  (function reserveAll() {
    const res = (x0, y0, x1, y1) => {
      for (let ty = Math.floor(y0 / T); ty <= Math.floor((y1 - 1) / T); ty++)
        for (let tx = Math.floor(x0 / T); tx <= Math.floor((x1 - 1) / T); tx++) if (!S.onRoad(tx, ty)) S.reserve(tx, ty);
    };
    for (let i = 0; i + 1 < RIVER.length; i++) { // tiles the river and its banks touch
      const [ax, ay, aw] = RIVER[i], [bx, by] = RIVER[i + 1];
      for (let k = 0; k <= 8; k++) { const x = ax + (bx - ax) * k / 8, y = ay + (by - ay) * k / 8; res(x - 1, y - aw - 3, x + 1, y + aw + 4); }
    }
    res(SPRING.x - 22, SPRING.y - 16, SPRING.x + 20, SPRING.y + 12);
    res(PLAZA_W.x0, PLAZA_W.y0, PLAZA_W.x1, PLAZA_W.y1);
    res(PLAZA_E.x0, PLAZA_E.y0, PLAZA_E.x1, PLAZA_E.y1);
    res(YARD.x0, YARD.y0, YARD.x1, YARD.y1);
    res(WH.x0 - 6, WH.roof - 8, WH.x1 + 16, WH.base + 4);
    res(BEACON.x - 14, BEACON.base - 40, BEACON.x + 16, BEACON.base + 1);
    res(CRANE.backX - 6, CRANE.base - 40, CRANE.x + 26, CRANE.base + 2);
    res(PIER_A.x0 - 8, PIER_A.y0 - 4, PIER_A.x0 + 16, PIER_A.y1 + 4);
    res(PIER_B.x0 - 8, PIER_B.y0 - 4, PIER_B.x0 + 20, PIER_B.y1 + 4);
  })();

  /* ====================================================================
   * Fidgets (tiny, drawn into stall sprites)
   * ================================================================== */
  function spinner(g, x, y, col) {
    D(g, x + 1, y, sh(col, 0.3)); D(g, x, y + 2, sh(col, -0.3)); D(g, x + 2, y + 2, col); D(g, x + 1, y + 1, P.gold);
  }
  function spinnerIcon(g, x, y, col) {
    spr(g, ['.lal.', '..a..', '.agd.', 'ad.da', 'd...d'], x, y, { a: col, l: sh(col, 0.35), d: sh(col, -0.3), g: P.gold });
  }
  function cube(g, x, y, a, b) {
    R(g, x, y, 4, 4, sh(a, -0.35));
    R(g, x, y, 2, 2, sh(a, 0.25)); R(g, x + 2, y, 2, 2, sh(b, 0.25));
    R(g, x, y + 2, 2, 2, b); R(g, x + 2, y + 2, 2, 2, a);
    D(g, x, y, sh(a, 0.5));
  }
  function popit(g, x, y, w, h) {
    for (let j = 0; j < h; j++) {
      const c = FIDGET[((j * 6) / h) | 0];
      for (let i = 0; i < w; i++) D(g, x + i, y + j, (i + j) & 1 ? sh(c, -0.18) : sh(c, 0.18));
    }
  }

  /* ====================================================================
   * Bazaar stall sprite (36 x 44), local origin: left = 0, base = 43
   * ================================================================== */
  function buildStall(st, sea) {
    const W = STALL_W, H = STALL_H;
    const [c, g] = mk(W + 4, H + 4);
    g.translate(2, 2);
    const [A, B] = AWNINGS[st.aw];
    const ctop = 29;
    for (let y = 10; y < ctop; y++) R(g, 2, y, W - 4, 1, mix('#2a1c16', '#5a3c27', (y - 10) / (ctop - 10)));
    for (let x = 5; x < W - 4; x += 6) R(g, x, 13, 1, ctop - 13, '#3a281c');
    R(g, 3, 20, W - 6, 2, WOOD.mid); R(g, 3, 20, W - 6, 1, WOOD.light); R(g, 3, 22, W - 6, 1, '#24180f');
    for (const px of [0, W - 2]) { R(g, px, 8, 2, H - 8, WOOD.base); R(g, px, 8, 1, H - 8, WOOD.light); R(g, px + 1, 8, 1, H - 8, WOOD.dark); }
    if (st.kind === 'popit') {
      for (let i = 0; i < 4; i++) { R(g, 7 + i * 7, 11, 1, 2, '#c9b07a'); popit(g, 5 + i * 7, 13, 5, 6); }
      for (let i = 0; i < 6; i++) { const cc = FIDGET[i]; R(g, 5 + i * 4, 18, 3, 2, cc); D(g, 5 + i * 4, 18, sh(cc, 0.4)); }
    } else if (st.kind === 'spinner') {
      for (let i = 0; i < 5; i++) { R(g, 6 + i * 6, 11, 1, 3, '#c9b07a'); spinnerIcon(g, 4 + i * 6, 13, FIDGET[(i * 2) % 8]); }
      for (let i = 0; i < 7; i++) spinner(g, 4 + i * 4, 17, FIDGET[(i + 3) % 8]);
    } else if (st.kind === 'cube') {
      for (let i = 0; i < 5; i++) cube(g, 5 + i * 5, 12, FIDGET[(i + 5) % 8], FIDGET[(i + 1) % 8]);
      for (let i = 0; i < 6; i++) cube(g, 4 + i * 5, 16, FIDGET[i % 8], FIDGET[(i + 3) % 8]);
    } else if (st.kind === 'rings') {
      for (let i = 0; i < 9; i++) R(g, 4 + i * 3, 12 + (i & 1), 1, 6, FIDGET[(i * 3) % 8]);
      for (let i = 0; i < 6; i++) { const cc = FIDGET[(i + 2) % 8]; R(g, 4 + i * 5, 16, 4, 4, sh(cc, -0.3)); R(g, 5 + i * 5, 17, 2, 2, '#2a1c16'); D(g, 4 + i * 5, 16, sh(cc, 0.4)); R(g, 5 + i * 5, 16, 2, 1, cc); }
    } else {
      for (let i = 0; i < 6; i++) { const cc = FIDGET[(i * 3 + 1) % 8]; R(g, 5 + i * 5, 11, 1, 3, '#c9b07a'); R(g, 4 + i * 5, 14, 3, 3, cc); D(g, 4 + i * 5, 14, sh(cc, 0.45)); }
      for (let i = 0; i < 6; i++) popit(g, 4 + i * 5, 17, 3, 3);
    }
    // counter
    R(g, 0, ctop, W, 3, WOOD.light); R(g, 0, ctop, W, 1, WOOD.hi); R(g, 0, ctop + 3, W, 1, WOOD.dark);
    // front drape in the awning colours, scalloped hem
    for (let y = ctop + 4; y < H; y++) for (let x = 1; x < W - 1; x++) {
      const k = (x - 1) % 5, stripe = ((x - 1) / 5 | 0) & 1;
      if (y === H - 1 && (k === 0 || k === 4)) continue;
      let col = stripe ? B : A;
      if (y === ctop + 4) col = sh(col, -0.4);
      else if (x < 3) col = sh(col, 0.12);
      else if (x > W - 4) col = sh(col, -0.2);
      else if (y === H - 1) col = sh(col, -0.25);
      D(g, x, y, col);
    }
    // a little chalk slate on the drape (pictograms only: a coin)
    R(g, W - 12, ctop + 6, 9, 6, '#3a2a1e'); R(g, W - 11, ctop + 7, 7, 4, '#2c3a34');
    R(g, W - 10, ctop + 8, 4, 1, '#d8e0d0'); D(g, W - 6, ctop + 9, P.gold); D(g, W - 10, ctop + 9, '#9fb0a0');
    // goods on the counter
    if (st.kind === 'popit') { popit(g, 4, ctop - 4, 7, 4); popit(g, 13, ctop - 3, 5, 3); popit(g, 20, ctop - 4, 6, 4); spinner(g, 28, ctop - 3, FIDGET[4]); }
    else if (st.kind === 'spinner') {
      for (let i = 0; i < 4; i++) spinner(g, 3 + i * 4, ctop - 3, FIDGET[(i * 3) % 8]);
      R(g, 20, ctop - 5, 10, 5, WOOD.mid); R(g, 20, ctop - 5, 10, 1, WOOD.light); R(g, 20, ctop - 1, 10, 1, WOOD.dark);
      for (let i = 0; i < 5; i++) D(g, 21 + i * 2, ctop - 6, FIDGET[i]);
    } else if (st.kind === 'cube') { cube(g, 4, ctop - 4, FIDGET[0], FIDGET[4]); cube(g, 9, ctop - 4, FIDGET[2], FIDGET[5]); cube(g, 6, ctop - 8, FIDGET[3], FIDGET[6]); cube(g, 22, ctop - 4, FIDGET[1], FIDGET[7]); }
    else if (st.kind === 'rings') { for (let i = 0; i < 5; i++) { R(g, 5 + i * 5, ctop - 3, 3, 3, FIDGET[(i * 2 + 1) % 8]); D(g, 6 + i * 5, ctop - 2, '#2a1d14'); } }
    else { for (let i = 0; i < 4; i++) { R(g, 4 + i * 7, ctop - 4, 5, 4, FIDGET[(i + 4) % 8]); R(g, 4 + i * 7, ctop - 4, 5, 1, sh(FIDGET[(i + 4) % 8], 0.4)); } }
    // awning: sloped top (0..7) and scalloped valance (8..11)
    for (let y = 0; y < 8; y++) {
      const inset = Math.round((7 - y) * 0.4);
      for (let x = -1 + inset; x <= W - inset; x++) {
        const stripe = (((x + 1) / 5) | 0) & 1;
        let col = stripe ? B : A;
        col = y < 2 ? sh(col, -0.12) : y > 5 ? sh(col, 0.12) : col;
        if (x < inset + 1) col = sh(col, 0.1);
        if (x > W - inset - 2) col = sh(col, -0.18);
        D(g, x, y, col);
      }
    }
    R(g, -1, 7, W + 2, 1, sh(B, 0.05));
    for (let x = -1; x <= W; x++) {
      const k = (x + 1) % 5, stripe = (((x + 1) / 5) | 0) & 1;
      const col = sh(stripe ? B : A, -0.1);
      const depth = k === 0 || k === 4 ? 2 : 4;
      R(g, x, 8, 1, depth, col);
      D(g, x, 8 + depth - 1, sh(col, -0.28));
    }
    // lantern hanging from the front-left corner of the awning
    R(g, 3, 11, 1, 2, '#2a1d14'); R(g, 2, 12, 3, 1, '#5a3a1a'); R(g, 2, 13, 3, 4, LAMP.warm); D(g, 2, 13, LAMP.hot); R(g, 2, 17, 3, 1, '#5a3a1a');
    if (st.flagship) R(g, 17, -1, 2, 2, WOOD.dark);
    g.setTransform(1, 0, 0, 1, 0, 0);
    outline(c, OUT);
    if (sea === 'winter') snowCap(c, true);
    return c;
  }

  /* ====================================================================
   * Crates, barrels, sacks
   * ================================================================== */
  const crateCache = {};
  function crate(w, h, v, open, sea) {
    const key = [w, h, v, open || '', sea].join(',');
    if (crateCache[key]) return crateCache[key];
    const [c, g] = mk(w + 2, h + 2);
    g.translate(1, 1);
    const tones = [
      { b: '#b07e48', l: '#cd9c62', d: '#7f5630', t: '#d8ad75' },
      { b: '#a4743f', l: '#c18e55', d: '#734c29', t: '#d2a46b' },
      { b: '#9a7a52', l: '#b9976a', d: '#6a5236', t: '#c9ab80' },
    ][v % 3];
    const top = Math.max(2, Math.round(h * 0.28));
    R(g, 0, top, w, h - top, tones.b);
    for (let y = top + 2; y < h; y += 3) R(g, 1, y, w - 2, 1, tones.d);
    R(g, 0, top, w, 1, tones.l); R(g, 0, top, 1, h - top, tones.l);
    R(g, w - 1, top, 1, h - top, tones.d); R(g, 0, h - 1, w, 1, tones.d);
    if (w >= 8) { for (let i = 1; i < w - 1; i++) { const y = top + 1 + Math.round((i - 1) * (h - top - 3) / (w - 3)); D(g, i, y, tones.d); } }
    if (open) {
      R(g, 0, 0, w, top, tones.t); R(g, 1, 1, w - 2, top - 1, '#3a2716');
      if (open === 'full') for (let i = 1; i < w - 1; i++) D(g, i, 1 + ((i * 7) % Math.max(1, top - 1)), FIDGET[(i + v) % 8]);
      if (open === 'low') D(g, 2, top - 1, FIDGET[(v + 2) % 8]);
    } else {
      R(g, 0, 0, w, top, tones.t);
      for (let x = 2; x < w; x += 3) R(g, x, 0, 1, top, tones.l);
      R(g, 0, 0, w, 1, sh(tones.t, 0.25));
    }
    if (w >= 10 && !open) { D(g, (w >> 1), top + 2, '#5a3a1a'); D(g, (w >> 1) - 1, top + 4, '#5a3a1a'); D(g, (w >> 1) + 1, top + 4, '#5a3a1a'); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    outline(c, '#2a1c12');
    if (sea === 'winter') snowCap(c, false);
    return (crateCache[key] = c);
  }
  function barrel(g, x, base, v) {
    const y = base - 11;
    const b = v ? '#8a5a32' : '#7a4f2c';
    R(g, x, y + 1, 8, 10, OUT); R(g, x + 1, y, 6, 12, OUT);
    R(g, x + 1, y + 1, 6, 10, b); R(g, x + 1, y + 1, 2, 10, sh(b, 0.18)); R(g, x + 6, y + 1, 1, 10, sh(b, -0.25));
    R(g, x + 1, y + 3, 6, 1, IRON.dark); R(g, x + 1, y + 8, 6, 1, IRON.dark);
    R(g, x + 1, y + 1, 6, 2, sh(b, 0.3)); R(g, x + 2, y + 1, 4, 1, sh(b, -0.3));
  }
  function sack(g, x, base) {
    R(g, x + 1, base - 7, 6, 7, '#5e4a30'); R(g, x, base - 6, 8, 5, '#5e4a30');
    R(g, x + 1, base - 6, 6, 5, '#c2a978'); R(g, x + 2, base - 7, 4, 1, '#c2a978');
    R(g, x + 1, base - 6, 2, 3, '#d8c294'); D(g, x + 3, base - 8, '#8a744c');
  }
  function ropeCoil(g, x, y) {
    ellipse(g, x, y, 4, 2, ROPE.dark); ellipse(g, x, y - 1, 4, 2, ROPE.base);
    ellipse(g, x, y - 1, 2, 1, ROPE.dark); D(g, x, y - 1, '#5e4a30'); D(g, x - 3, y - 2, '#e2cf9e');
  }

  /* ====================================================================
   * Warehouse (brick, slate roof, cross gable with hoist)
   * ================================================================== */
  function buildWarehouse(sea) {
    const x0 = WH.x0 - 5, y0 = WH.roof - 14;
    const W = WH.x1 - WH.x0 + 10, H = WH.base - y0 + 2;
    const [c, g] = mk(W + 2, H + 2);
    const L = (x, y) => [x - x0 + 1, y - y0 + 1];
    const rect = (x, y, w, h, col) => { const [a, b] = L(x, y); R(g, a, b, w, h, col); };
    const dot = (x, y, col) => { const [a, b] = L(x, y); D(g, a, b, col); };
    const winter = sea === 'winter';
    for (let y = WH.eave; y < WH.base; y++) for (let x = WH.x0; x < WH.x1; x++) {
      const row = (y - WH.eave) / 4 | 0, off = row & 1 ? 4 : 0;
      const mortarH = (y - WH.eave) % 4 === 3, mortarV = (x - WH.x0 + off) % 8 === 7;
      let col = BRICK.base;
      const n = hash((x - WH.x0 + off) >> 3, row, 9);
      if (n < 0.2) col = BRICK.dark; else if (n > 0.85) col = BRICK.light;
      if (mortarH || mortarV) col = BRICK.mortar;
      if (y < WH.eave + 4) col = mix(col, '#2a1610', 0.45);
      if (x < WH.x0 + 2 && !mortarH && !mortarV) col = sh(col, 0.08);
      if (x > WH.x1 - 3 && !mortarH && !mortarV) col = sh(col, -0.15);
      dot(x, y, col);
    }
    rect(WH.x0, WH.base - 4, WH.x1 - WH.x0, 4, STONE.base);
    rect(WH.x0, WH.base - 4, WH.x1 - WH.x0, 1, STONE.light);
    for (let x = WH.x0; x < WH.x1; x += 7) rect(x, WH.base - 4, 1, 4, STONE.dark);
    for (const px of [WH.x0, WH.x1 - 3]) { rect(px, WH.eave, 3, WH.base - WH.eave - 4, BRICK.dark); rect(px, WH.eave, 1, WH.base - WH.eave - 4, BRICK.light); }
    // big double doors, slid open: crates inside in the gloom
    const dx = WH.doorX, dw = WH.doorW, dt = WH.base - 22;
    for (let y = dt; y < WH.base; y++) rect(dx, y, dw, 1, mix('#120d0b', '#3a2a1e', (y - dt) / 22));
    const inside = [[dx + 2, WH.base - 10, 7, 10], [dx + 3, WH.base - 16, 6, 6], [dx + dw - 9, WH.base - 11, 7, 11], [dx + dw - 8, WH.base - 17, 5, 6]];
    for (const [ix, iy, iw, ih] of inside) { rect(ix, iy, iw, ih, '#4a3420'); rect(ix, iy, iw, 1, '#6a4c30'); rect(ix, iy, 1, ih, '#5a4028'); }
    rect(dx + 10, WH.base - 2, 4, 2, '#5a4430');
    for (const lx of [dx - 11, dx + dw]) {
      rect(lx, dt, 11, 22, WOOD.mid);
      for (let i = 0; i < 11; i += 3) rect(lx + i, dt, 1, 22, WOOD.dark);
      rect(lx, dt, 11, 1, WOOD.light); rect(lx, dt + 10, 11, 1, WOOD.dark); rect(lx, dt, 1, 22, WOOD.light);
      for (let i = 0; i < 10; i++) { dot(lx + i, dt + 1 + i, WOOD.light); dot(lx + i, dt + 20 - i, WOOD.light); }
    }
    rect(dx - 13, dt - 2, dw + 26, 2, IRON.dark); rect(dx - 13, dt - 2, dw + 26, 1, IRON.light);
    // windows with stone sills
    const wins = [[WH.x0 + 5, WH.eave + 8], [WH.x1 - 17, WH.eave + 8]];
    for (const [wx, wy] of wins) {
      rect(wx - 1, wy - 1, 14, 12, STONE.light);
      rect(wx, wy, 12, 10, '#2a3448');
      rect(wx + 1, wy + 1, 10, 8, '#3d5878'); rect(wx + 1, wy + 1, 4, 3, '#6d8fb3'); dot(wx + 1, wy + 1, '#a9c6e0');
      rect(wx + 5, wy, 1, 10, '#2a3448'); rect(wx, wy + 4, 12, 1, '#2a3448');
      rect(wx - 1, wy + 10, 14, 2, STONE.base); rect(wx - 1, wy + 10, 14, 1, STONE.hi);
    }
    // sign board over the door: a crate and a spinner (pictograms)
    const sx = dx + dw / 2 - 9, sy = dt - 11;
    rect(sx, sy, 18, 9, '#3a2416'); rect(sx + 1, sy + 1, 16, 7, '#e8d7b0'); rect(sx + 1, sy + 1, 16, 1, '#fff2d0');
    rect(sx + 3, sy + 3, 5, 4, '#b07e48'); rect(sx + 3, sy + 3, 5, 1, '#d8ad75');
    dot(sx + 12, sy + 3, TEAL.base); dot(sx + 11, sy + 5, TEAL.base); dot(sx + 13, sy + 5, TEAL.base); dot(sx + 12, sy + 4, P.gold);
    // wall lamp beside the door
    rect(dx + dw + 13, dt + 1, 1, 3, IRON.dark); rect(dx + dw + 12, dt + 3, 3, 4, LAMP.glass); dot(dx + dw + 12, dt + 3, LAMP.hot); rect(dx + dw + 12, dt + 2, 3, 1, IRON.dark);
    for (const px of [WH.x0 + 1, WH.x1 - 2]) { rect(px, WH.eave, 1, WH.base - WH.eave - 2, IRON.base); rect(px - 1, WH.base - 3, 3, 1, IRON.dark); }
    // slate roof (ridge east-west), front slope
    const rY0 = WH.roof, rY1 = WH.eave;
    for (let y = rY0; y < rY1; y++) {
      const t = (y - rY0) / (rY1 - rY0);
      const ox = Math.round(2 + t * 2);
      for (let x = WH.x0 - ox; x < WH.x1 + ox; x++) {
        const row = (y - rY0) / 3 | 0, off = row & 1 ? 2 : 0;
        const k = (x + off) % 5, ky = (y - rY0) % 3;
        let col = SLATE.base;
        const n = hash((x + off) / 5 | 0, row, 21);
        if (n < 0.18) col = SLATE.dark; else if (n > 0.86) col = SLATE.light;
        if (ky === 2) col = SLATE.deep; else if (k === 4) col = SLATE.dark; else if (ky === 0 && k < 2) col = sh(col, 0.15);
        if (t < 0.12) col = mix(col, SLATE.hi, 0.35);
        if (x < WH.x0 - ox + 2) col = sh(col, 0.1);
        dot(x, y, col);
      }
    }
    rect(WH.x0 - 3, rY0 - 2, WH.x1 - WH.x0 + 6, 2, SLATE.hi); rect(WH.x0 - 3, rY0 - 2, WH.x1 - WH.x0 + 6, 1, '#a9b8d4');
    rect(WH.x0 - 4, rY1 - 1, WH.x1 - WH.x0 + 8, 2, SLATE.deep);
    rect(WH.x0 - 4, rY1, WH.x1 - WH.x0 + 8, 1, '#141824');
    // chimney with a brass cap on the west end
    const chx = WH.x0 + 10;
    rect(chx, rY0 - 9, 6, 11, BRICK.dark); rect(chx + 1, rY0 - 9, 4, 11, BRICK.base); rect(chx + 1, rY0 - 9, 1, 11, BRICK.light);
    rect(chx - 1, rY0 - 10, 8, 2, STONE.light); rect(chx + 1, rY0 - 5, 4, 1, BRICK.mortar);
    // roof vent on the east end
    const vx = WH.x1 - 18;
    rect(vx, rY0 + 2, 6, 6, IRON.base); rect(vx, rY0 + 2, 6, 1, IRON.hi); rect(vx - 1, rY0 + 1, 8, 2, IRON.dark); rect(vx + 5, rY0 + 3, 1, 5, IRON.dark);
    // cross gable over the door with the loft door, hoist beam and a hanging crate
    const gx = dx + dw / 2, gTop = rY0 - 6, gBase = rY1 + 1, half = 16;
    for (let y = gTop; y < gBase; y++) {
      const hw = Math.min(half, Math.round((y - gTop) * 1.15) + 1);
      for (let x = gx - hw; x < gx + hw; x++) {
        const edge = x <= gx - hw + 2 || x >= gx + hw - 3;
        let col;
        if (edge) col = x < gx ? SLATE.light : SLATE.dark;
        else {
          col = (x - gx + 40) % 4 === 0 ? '#6a4a30' : '#8b6440';
          if ((y - gTop) % 4 === 0) col = '#5a3e28';
          if (x < gx - hw + 5) col = sh(col, 0.1);
        }
        dot(x, y, col);
      }
    }
    for (let y = gTop; y < gBase; y++) { const hw = Math.min(half, Math.round((y - gTop) * 1.15) + 1); dot(gx - hw - 1, y, SLATE.hi); dot(gx + hw, y, SLATE.deep); }
    rect(gx - 4, gTop + 11, 8, 12, '#2a1c14'); rect(gx - 4, gTop + 11, 8, 1, '#5a3e28'); rect(gx - 5, gTop + 23, 10, 2, WOOD.light);
    rect(gx - 3, gTop + 16, 6, 7, '#4a3420'); rect(gx - 3, gTop + 16, 6, 1, '#6a4c30');
    rect(gx - 1, gTop + 3, 3, 2, WOOD.dark); rect(gx - 1, gTop + 1, 3, 2, WOOD.base);
    rect(gx, gTop + 5, 1, 6, ROPE.dark);
    rect(gx - 2, gTop + 6, 4, 3, '#2a3448'); dot(gx - 1, gTop + 7, '#6d8fb3');
    outline(c, OUT);
    if (winter) {
      snowCap(c, true);
      for (let y = rY0; y < rY0 + 6; y++) for (let x = WH.x0 - 3; x < WH.x1 + 3; x++) {
        if (y > rY0 + 3 && hash(x, y, 31) < 0.5) continue;
        if (x > gx - half - 1 && x < gx + half && y > gTop) continue;
        const [a, b] = L(x, y); D(g, a, b, (y - rY0) > 2 && bay(x, y) < 0.3 ? '#c9d6e0' : P.snow);
      }
    }
    return { c, ox: x0 - 1, oy: y0 - 1 };
  }

  /* Warehouse annex (growth >= 2): a lean-to shed on the east side, open front with crates. */
  function buildAnnex(sea) {
    const W = 15, H = 28;
    const [c, g] = mk(W + 2, H + 2);
    g.translate(1, 1);
    for (let y = 0; y < 8; y++) R(g, 0, y, W, 1, y < 2 ? SLATE.light : y === 7 ? SLATE.deep : (y & 1 ? SLATE.dark : SLATE.base));
    R(g, 0, 8, W, H - 8, '#2a1c14');
    R(g, 0, 8, 2, H - 8, WOOD.base); R(g, W - 2, 8, 2, H - 8, WOOD.dark);
    for (let i = 0; i < 2; i++) { R(g, 3 + i * 5, H - 7, 5, 7, '#9a6c3e'); R(g, 3 + i * 5, H - 7, 5, 1, '#c9975c'); }
    R(g, 5, H - 12, 5, 5, '#a4743f'); R(g, 5, H - 12, 5, 1, '#d2a46b');
    g.setTransform(1, 0, 0, 1, 0, 0);
    outline(c, OUT);
    if (sea === 'winter') snowCap(c, true);
    return c;
  }

  /* ====================================================================
   * Sky beacon: a little white-and-teal lighthouse on the north-east point
   * ================================================================== */
  function buildBeacon(sea) {
    const W = 30, H = 62;
    const [c, g] = mk(W + 2, H + 2);
    g.translate(1, 1);
    const cx = 15, base = H - 1;
    // rocky plinth
    const rocks = [[8, base - 2, 6, 3], [22, base - 2, 6, 3], [15, base, 9, 3], [4, base, 4, 2], [26, base, 4, 2]];
    for (const [x, y, rx, ry] of rocks) {
      ellipse(g, x, y - 1, rx, ry, STONE.dark); ellipse(g, x - 1, y - 2, rx - 1, ry - 1, STONE.base);
      ellipse(g, x - 2, y - 3, Math.max(1, rx - 3), Math.max(1, ry - 2), STONE.light);
      D(g, x + 1, y - ry, STONE.moss);
    }
    const top = 20, bot = base - 4;
    for (let y = top; y <= bot; y++) {
      const t = (y - top) / (bot - top), hw = Math.round(4 + t * 3);
      const band = ((y - top) / 8 | 0) % 2 === 1;
      for (let x = cx - hw; x < cx + hw; x++) {
        const u = (x - (cx - hw)) / (2 * hw);
        const b0 = band ? TEAL.base : '#f2eee4';
        let col = u < 0.25 ? sh(b0, 0.14) : u > 0.72 ? sh(b0, -0.18) : b0;
        if (u > 0.86) col = sh(b0, -0.32);
        D(g, x, y, col);
      }
    }
    R(g, cx - 2, bot - 6, 4, 7, '#2a2230'); R(g, cx - 2, bot - 7, 4, 1, '#5a4a5a'); D(g, cx + 1, bot - 3, P.gold);
    R(g, cx - 1, top + 10, 2, 3, '#2a3448'); D(g, cx - 1, top + 10, '#6d8fb3');
    R(g, cx - 8, top - 3, 16, 3, IRON.dark); R(g, cx - 8, top - 3, 16, 1, IRON.light);
    for (let x = cx - 8; x < cx + 8; x += 2) D(g, x, top - 5, IRON.base);
    R(g, cx - 8, top - 6, 16, 1, IRON.base);
    R(g, cx - 4, top - 13, 8, 8, IRON.deep);
    R(g, cx - 3, top - 12, 6, 7, LAMP.glass); R(g, cx - 3, top - 12, 2, 7, LAMP.hot);
    R(g, cx, top - 12, 1, 7, IRON.dark);
    for (let y = 0; y < 5; y++) R(g, cx - 5 + y, top - 18 + y, 10 - 2 * y, 1, TEAL.dark);
    for (let y = 0; y < 4; y++) R(g, cx - 4 + y, top - 17 + (3 - y), 8 - 2 * y, 1, y === 3 ? TEAL.hi : TEAL.light);
    R(g, cx - 5, top - 14, 10, 1, TEAL.deep);
    R(g, cx, top - 20, 1, 3, IRON.base); D(g, cx, top - 21, P.gold);
    g.setTransform(1, 0, 0, 1, 0, 0);
    outline(c, OUT);
    if (sea === 'winter') snowCap(c, true);
    return { c, ox: BEACON.x - cx - 2, oy: BEACON.base - base - 2, lamp: { x: BEACON.x, y: BEACON.base - base + top - 9 } };
  }

  /* ====================================================================
   * Sky-ships (entities). Local origin: bow tip x = 0, near deck edge y = 0.
   * A chubby 3/4 wooden hull (deck band, painted strakes, portholes, a
   * copper-sheathed belly and keel fin) hanging under a striped gas balloon
   * that sits over the stern half, so the crane can reach the cargo at the
   * bow. A foremast with a pennant, a stern propeller (drawn per frame).
   * Idle ships: the balloon sags half-deflated and patched, lines go slack,
   * the hold stands open and empty.
   * ================================================================== */
  const SOX = 12, SOY = 46; // sprite canvas offset of the local origin
  function buildShip(s, sea) {
    const L = s.L, W = L + 26, H = SOY + 24;
    const [c, g] = mk(W, H);
    const X = (x) => x + SOX, Y = (y) => y + SOY;
    const rect = (x, y, w, h, col) => R(g, X(x), Y(y), w, h, col);
    const dot = (x, y, col) => D(g, X(x), Y(y), col);
    const hull = s.hull, hullD = sh(hull, -0.3), hullL = sh(hull, 0.2), trim = '#ece3cc', trimD = '#bfb398';
    const deckY0 = -10, deckY1 = 0;
    const midY = (deckY0 + deckY1) / 2, half = (deckY1 - deckY0) / 2 + 0.5;
    const deckRow = (y) => {
      const t = Math.abs(y - midY) / half;
      return [Math.round(10 * Math.pow(t, 1.6)), L - 1 - Math.round(4 * t * t)];
    };
    const mid = Math.round(midY);
    // --- balloon geometry (drawn last, but the ropes go first)
    const bx = Math.round(L * 0.63), rx = Math.round(L * 0.34);
    const ry = s.empty ? 7 : 10, by = s.empty ? -21 : -27;
    const bBot = (u) => by + ry * Math.sqrt(Math.max(0, 1 - u * u)) + (s.empty ? Math.round(Math.sin(u * 11) * 1.2 + 1) : 0);
    // rigging lines from the balloon's belly to the rails
    const lines = [[-0.72, -12], [-0.3, -5], [0.3, 5], [0.72, 12]];
    for (const [u, dx] of lines) {
      const x0 = bx + u * rx, y0 = bBot(u) - 1, x1 = bx + dx, y1 = deckY0 + 2;
      const n = Math.max(2, Math.round(Math.abs(y1 - y0)));
      for (let i = 0; i <= n; i++) {
        const k = i / n, sag = s.empty ? Math.sin(k * Math.PI) * 2 : 0;
        dot(Math.round(x0 + (x1 - x0) * k + sag), Math.round(y0 + (y1 - y0) * k), i % 2 ? '#8a7a5c' : '#c9b991');
      }
    }
    // --- hull side: from the deck edge down into a rounded belly
    const SIDE = 13;
    const rowL = (k) => Math.round(3 + k * 0.8 + (k > 7 ? (k - 7) * (k - 7) * 0.5 : 0));
    const rowR = (k) => L - 2 - Math.round(k * 0.35 + (k > 8 ? (k - 8) * (k - 8) * 0.75 : 0));
    for (let k = 0; k <= SIDE; k++) {
      const y = k + 1, l = rowL(k), r = rowR(k);
      for (let x = l; x <= r; x++) {
        let col;
        if (k === 0) col = trim;
        else if (k === 1) col = hullL;
        else if (k === 4 || k === 5) col = k === 4 ? s.accent : sh(s.accent, -0.22);
        else if (k >= SIDE - 3) { // copper sheathing on the belly, riveted
          col = (x + k * 2) % 5 === 0 ? COPPER.dark : k === SIDE - 3 ? COPPER.light : COPPER.base;
          if (k === SIDE) col = COPPER.dark;
        } else col = k % 3 === 0 ? hullD : hull;
        const u = (x - l) / Math.max(1, r - l);
        if (k > 0 && k < SIDE - 3) { if (u < 0.1) col = sh(col, 0.14); else if (u > 0.9) col = sh(col, -0.2); }
        if (k > 1 && k < SIDE - 3 && k !== 4 && k !== 5 && hash(x >> 2, k, 87) < 0.18) col = sh(col, -0.07); // plank grain
        dot(x, y, col);
      }
    }
    // keel fin, rudder and a little tail fin
    const kx0 = Math.round(L * 0.3), kx1 = Math.round(L * 0.6);
    for (let x = kx0; x <= kx1; x++) { const u = (x - kx0) / (kx1 - kx0); const d = Math.round(4 * Math.sin(u * Math.PI)); if (d > 0) rect(x, SIDE + 2, 1, d, u < 0.5 ? WOOD.mid : WOOD.dark); }
    rect(L - 5, 4, 3, SIDE - 1, WOOD.dark); rect(L - 5, 4, 1, SIDE - 1, WOOD.light);
    // portholes with brass rims
    for (let x = 11; x < L - 10; x += 8) { rect(x, 7, 3, 3, BRASS.base); dot(x, 7, BRASS.hi); dot(x + 1, 8, s.empty ? '#16202c' : '#2f4a66'); }
    // --- deck: planks fore and aft, bulwark rim in the trim colour
    for (let y = deckY0; y <= deckY1; y++) {
      const [l, r] = deckRow(y);
      for (let x = l; x <= r; x++) {
        let col = (y - deckY0) % 2 ? '#c99a66' : '#bb8b56';
        if ((x + (y - deckY0) * 7) % 13 === 0) col = '#a07043';
        const [pl, pr] = deckRow(y - 1), [nl, nr] = deckRow(y + 1);
        const rim = x === l || x === r || y === deckY0 || y === deckY1 || x < pl || x > pr || x < nl || x > nr;
        if (rim) col = y > midY ? trim : trimD;
        else if (y === deckY0 + 1 || x === l + 1) col = '#8a6238';
        dot(x, y, col);
      }
    }
    // bowsprit with a brass star figurehead
    for (let i = 1; i < 9; i++) dot(-i + 1, mid - 1 - (i >> 1), i >= 7 ? WOOD.light : WOOD.dark);
    spr(g, ['.s.', 'sss', '.s.'], X(-10), Y(mid - 7), { s: BRASS.light });
    dot(-9, mid - 6, BRASS.hi);
    // cargo hatch at the bow (one crate per order)
    const hx0 = 7, hx1 = 22;
    rect(hx0, mid - 3, hx1 - hx0, 6, '#5a3e24'); rect(hx0, mid - 3, hx1 - hx0, 1, '#7d5a36');
    rect(hx0 + 1, mid - 2, hx1 - hx0 - 2, 4, s.cargo ? '#3a2716' : '#24180f');
    if (s.empty) { // hold open and bare, hatch boards stacked aside
      rect(hx0 + 1, mid - 2, hx1 - hx0 - 2, 1, '#120c08'); rect(hx0 + 1, mid + 1, hx1 - hx0 - 2, 1, '#4a3420');
      for (let x = hx0 + 3; x < hx1 - 1; x += 4) dot(x, mid, '#3a2716');
      rect(hx1 + 1, mid - 2, 4, 3, '#8b6440'); rect(hx1 + 1, mid - 2, 4, 1, '#b38a5a');
    }
    const slots = [[0, 0], [7, 0], [3, -6], [10, -6], [6, -12]];
    for (let i = 0; i < s.cargo; i++) {
      const [sx, sy] = slots[i];
      const cx0 = hx0 + sx, cy = mid + 2 + sy;
      const tone = ['#b07e48', '#c99a5a', '#9a8a5a'][i % 3];
      rect(cx0, cy - 7, 8, 8, '#2a1c12');
      rect(cx0 + 1, cy - 6, 6, 2, sh(tone, 0.28)); rect(cx0 + 1, cy - 4, 6, 4, tone);
      rect(cx0 + 1, cy - 4, 1, 4, sh(tone, 0.12)); rect(cx0 + 6, cy - 4, 1, 4, sh(tone, -0.25));
      dot(cx0 + 3, cy - 2, FIDGET[(i * 3 + s.idx) % 8]); dot(cx0 + 4, cy - 2, FIDGET[(i * 3 + s.idx) % 8]);
    }
    // foremast with a pennant
    const fx = 4;
    rect(fx - 1, mid - 22, 3, 22, OUT); rect(fx, mid - 21, 1, 21, '#b07a48');
    D(g, X(fx), Y(mid - 23), BRASS.light);
    if (s.empty) { for (let i = 0; i < 5; i++) dot(fx + 1, mid - 21 + i, i < 2 ? s.sail : sh(s.sail, -0.2)); }
    else for (let i = 0; i < 8; i++) rect(fx + 1 + i, mid - 21 + (i >> 2), 1, Math.max(1, 4 - (i >> 1)), i < 2 ? sh(s.sail, 0.2) : s.sail);
    // aft cabin under the balloon, a round window and a lantern
    const cx0 = L - 17, cx1 = L - 6;
    rect(cx0 - 1, mid - 9, cx1 - cx0 + 2, 13, OUT);
    rect(cx0, mid - 4, cx1 - cx0, 7, '#ece6d6'); rect(cx0, mid - 4, 2, 7, '#fffaf0'); rect(cx1 - 2, mid - 4, 2, 7, '#c9c1ad');
    rect(cx0 + 4, mid - 2, 3, 3, BRASS.base); dot(cx0 + 5, mid - 1, '#3d5878'); dot(cx0 + 4, mid - 2, BRASS.hi);
    rect(cx0 - 1, mid - 9, cx1 - cx0 + 2, 5, hullD); rect(cx0 - 1, mid - 9, cx1 - cx0 + 2, 1, hullL); rect(cx0 - 1, mid - 5, cx1 - cx0 + 2, 1, sh(hull, -0.5));
    rect(L - 3, mid - 3, 2, 2, LAMP.glass);
    // propeller shaft
    rect(L - 2, 7, 4, 2, IRON.dark); rect(L + 1, 6, 2, 4, BRASS.base);
    // --- the balloon: gores in the ship colour and cream, lit from the top-left
    const A = s.empty ? mix(s.sail, '#8a8a90', 0.3) : s.sail, B = s.empty ? '#d8d0bc' : CANVAS.base;
    const tone3 = (col) => [sh(col, 0.28), col, sh(col, -0.22), sh(col, -0.42)];
    const TA = tone3(A), TB = tone3(B);
    for (let y = by - ry - 1; y <= by + ry + 3; y++) for (let x = bx - rx - 1; x <= bx + rx + 1; x++) {
      const u = (x + 0.5 - bx) / rx;
      if (Math.abs(u) > 1) continue;
      // idle: the envelope sags in the middle between two soft humps
      const sag = s.empty ? 1 - 0.32 * Math.exp(-(u / 0.28) * (u / 0.28)) + Math.sin(u * 9) * 0.04 : 1;
      const topY = by - ry * Math.sqrt(Math.max(0, 1 - u * u)) * sag;
      if (y < topY || y > bBot(u)) continue;
      const v = (y + 0.5 - by) / ry;
      const gore = Math.floor((Math.asin(clamp(u, -1, 1)) / (Math.PI / 2) + 1) * 4);
      const T3 = gore % 2 ? TB : TA;
      const lit = -(u * 0.55 + v * 0.85);
      let k = lit > 0.55 ? 0 : lit > -0.15 ? 1 : lit > -0.6 ? 2 : 3;
      if (lit > 0.35 && lit <= 0.55 && bay(x, y) < 0.5) k = 0;
      if (lit > -0.6 && lit <= -0.4 && bay(x, y) < 0.5) k = 3;
      let col = T3[k];
      // a seam between gores
      const gu = (Math.asin(clamp(u, -1, 1)) / (Math.PI / 2) + 1) * 4;
      if (gu - Math.floor(gu) < 0.08 && Math.abs(u) < 0.95) col = sh(col, -0.12);
      if (u * u + v * v < 0.05 && !s.empty) col = sh(col, 0.05);
      dot(x, y, col);
    }
    if (s.empty) for (const cu of [-0.55, -0.12, 0.38, 0.7]) { // slack creases
      const x = Math.round(bx + cu * rx);
      for (let y = Math.round(by - ry * 0.5); y < Math.round(bBot(cu)) - 1; y++) if (hash(x, y, 541) < 0.75) dot(x + ((y & 2) ? 1 : 0), y, sh(A, -0.32));
    }
    // a belly band with little rope loops
    for (let x = bx - rx + 3; x <= bx + rx - 3; x++) { const u = (x + 0.5 - bx) / rx; const y = Math.round(bBot(u)) - 2; if ((x - bx) % 4 === 0) dot(x, y, '#8a7a5c'); }
    // highlight glint on the shoulder
    if (!s.empty) { rect(bx - Math.round(rx * 0.5), by - ry + 2, 4, 1, '#fffaf0'); dot(bx - Math.round(rx * 0.55), by - ry + 3, '#fffaf0'); }
    else { // a cloth patch on the sagging envelope
      rect(bx + 4, by - 2, 5, 4, '#c9a86a'); dot(bx + 4, by - 2, '#e2c88a'); dot(bx + 8, by + 1, '#8a6a3a');
      for (let i = 0; i < 5; i += 2) dot(bx + 4 + i, by + 2, '#5a4430');
    }
    // brass nose cap and tail fins
    rect(bx - rx - 2, by - 1, 3, 3, BRASS.base); dot(bx - rx - 2, by - 1, BRASS.hi);
    const tx0 = bx + rx - 3;
    for (let i = 0; i < 6; i++) { rect(tx0 + i, by - ry + 2 - i, 1, 2 + i, s.empty ? sh(A, -0.2) : A); }
    for (let i = 0; i < 5; i++) rect(tx0 + 2 + i, by - 1, 1, 3, i === 4 ? sh(A, -0.3) : sh(A, -0.1));
    outline(c, OUT);
    if (sea === 'winter') snowCap(c, false);
    const pu = -0.5, perch = { x: Math.round(bx + pu * rx) - 2, y: Math.round(by - ry * Math.sqrt(1 - pu * pu) * (s.empty ? 1 - 0.32 * Math.exp(-(pu / 0.28) * (pu / 0.28)) + Math.sin(pu * 9) * 0.04 : 1)) - 3 };
    return { c, mid, top: by - ry, bx, by, ry, perch, lamp: { x: L - 2, y: mid - 2 }, prop: { x: L + 2, y: 8 }, hatch: [hx0, hx1], fore: { x: fx, y: mid - 23 } };
  }
  /* Propeller (3 frames), pre-rendered. */
  const PROP = [];
  (function buildSpinners() {
    for (let f = 0; f < 3; f++) {
      const [c, g] = mk(7, 13);
      const blade = (y0, h) => { R(g, 1, y0, 4, h, '#e8dcc0'); R(g, 1, y0, 1, h, '#fffaf0'); R(g, 4, y0, 1, h, '#a89a7c'); };
      if (f === 0) { blade(0, 5); blade(8, 5); }
      else if (f === 1) { blade(2, 3); blade(8, 2); }
      else { blade(3, 3); blade(7, 3); }
      R(g, 2, 5, 3, 3, BRASS.base); D(g, 2, 5, BRASS.hi);
      outline(c, OUT); PROP.push(c);
    }
  })();

  /* ====================================================================
   * Cargo crane: lattice tower on the island, jib reaching over berth A.
   * ================================================================== */
  function buildCrane(sea) {
    const x0 = CRANE.backX - 6, y0 = CRANE.top - 12, W = CRANE.tipX - x0 + 6, H = CRANE.base - y0 + 2;
    const [c, g] = mk(W, H);
    const rect = (x, y, w, h, col) => R(g, x - x0, y - y0, w, h, col);
    const dot = (x, y, col) => D(g, x - x0, y - y0, col);
    const col = { b: '#c9862e', l: '#f0b04a', d: '#8a5418', hi: '#ffd890' }; // honey-yellow ironwork
    const tx = CRANE.x, top = CRANE.top, base = CRANE.base;
    // stone footing and splayed legs
    rect(tx - 7, base - 5, 22, 5, STONE.dark); rect(tx - 6, base - 5, 20, 4, STONE.base); rect(tx - 6, base - 5, 20, 1, STONE.hi);
    for (let y = base - 20; y < base - 5; y++) {
      const k = (y - (base - 20)) / 15, spread = Math.round(k * 5);
      rect(tx - spread, y, 2, 1, col.l); rect(tx + 7 + spread, y, 2, 1, col.d);
    }
    rect(tx - 1, base - 21, 11, 2, col.d); rect(tx - 1, base - 21, 11, 1, col.l);
    for (let i = 0; i < 9; i++) { dot(tx + 1 + i, base - 19 + Math.round(i * 1.5), col.b); dot(tx + 8 - i, base - 19 + Math.round(i * 1.5), col.b); }
    // lattice tower (9 wide)
    for (let y = top + 8; y < base - 21; y++) {
      rect(tx, y, 2, 1, col.l); rect(tx + 7, y, 2, 1, col.d);
      const k = (y - top) % 10;
      dot(tx + 2 + Math.round(k * 0.5), y, col.b);
      dot(tx + 6 - Math.round(k * 0.5), y, col.b);
      if (k === 0) rect(tx + 2, y, 5, 1, col.b);
    }
    // operator cab under the jib, east of the tower (looks out over the berth)
    const cy = top + 4;
    rect(tx + 9, cy, 13, 12, OUT);
    rect(tx + 10, cy + 1, 11, 10, '#dfe6ea'); rect(tx + 10, cy + 1, 11, 2, '#ffffff'); rect(tx + 20, cy + 1, 1, 10, '#a6b0b8');
    rect(tx + 12, cy + 4, 7, 4, '#2f4a66'); rect(tx + 12, cy + 4, 3, 2, '#8fb8d8'); rect(tx + 16, cy + 4, 1, 4, '#dfe6ea');
    rect(tx + 10, cy + 10, 11, 1, '#7a848c');
    // slewing ring
    rect(tx - 2, top + 3, 13, 3, col.d); rect(tx - 2, top + 3, 13, 1, col.hi);
    // jib: truss reaching east over the berth
    for (let x = tx + 9; x <= CRANE.tipX; x++) {
      dot(x, top - 1, col.hi); dot(x, top, col.l); dot(x, top + 3, col.d);
      const k = (x - tx) % 6;
      dot(x, top + 1 + (k < 3 ? 0 : 1), col.b);
      if (k === 0) rect(x, top, 1, 3, col.b);
    }
    rect(CRANE.tipX - 1, top - 2, 4, 7, OUT); rect(CRANE.tipX, top - 1, 2, 5, col.l); dot(CRANE.tipX, top + 1, IRON.dark);
    // counter-jib with the counterweight (west of the tower)
    rect(CRANE.backX, top - 1, tx - CRANE.backX, 3, col.d); rect(CRANE.backX, top - 1, tx - CRANE.backX, 1, col.l);
    rect(CRANE.backX - 1, top + 1, 9, 8, OUT); rect(CRANE.backX, top + 2, 7, 6, STONE.dark); rect(CRANE.backX, top + 2, 7, 1, STONE.light); rect(CRANE.backX, top + 2, 1, 6, STONE.base);
    // A-frame peak and tie rods
    rect(tx + 3, top - 9, 3, 9, OUT); rect(tx + 4, top - 8, 1, 8, col.l);
    for (let i = 0; i <= CRANE.tipX - tx - 4; i++) dot(tx + 4 + i, top - 8 + Math.round(i * 7 / (CRANE.tipX - tx - 4)), '#2a2630');
    for (let i = 0; i <= tx + 4 - CRANE.backX - 3; i++) dot(tx + 4 - i, top - 8 + Math.round(i * 8 / (tx + 4 - CRANE.backX - 3)), '#2a2630');
    for (let i = 0; i < 9; i += 2) rect(tx + i, base - 21, 1, 2, '#2a2630');
    outline(c, OUT);
    if (sea === 'winter') snowCap(c, false);
    return { c, ox: x0, oy: y0 };
  }

  /* ====================================================================
   * Piers over the void (cached; drawn at dyn 200 with the island's bob)
   * Deck boards run north-south; under the deck, timber braces angle back
   * to the island's cliff so it reads as built out over space.
   * ================================================================== */
  function buildPier(p, opts, sea) {
    const pad = 8, x0 = p.x0 - pad, y0 = p.y0 - 18, W = p.x1 - p.x0 + pad * 2, H = p.y1 - p.y0 + 52;
    const [c, g] = mk(W, H);
    const rect = (x, y, w, h, col) => R(g, x - x0, y - y0, w, h, col);
    const dot = (x, y, col) => D(g, x - x0, y - y0, col);
    const winter = sea === 'winter';
    const edgeX = (y) => { const r = GEO.right(y); return r > 0 ? r : p.x0; };
    // braces and piles under the deck (out over space only)
    const legs = [];
    for (let x = p.x1 - 4; x > edgeX(p.y1) + 4; x -= 14) legs.push(x);
    for (const lx of legs) {
      const len = 14 + ((lx * 7) % 5);
      rect(lx, p.y1 + 2, 3, len, PIERW.deep); rect(lx + 1, p.y1 + 2, 1, len - 1, PIERW.dark);
      dot(lx + 1, p.y1 + 2 + len, PIERW.deep);
      // diagonal brace back toward the island
      const bx1 = Math.max(edgeX(p.y1) + 1, lx - 13);
      for (let i = 0; i <= lx - bx1; i++) { dot(lx - i, p.y1 + 3 + Math.round(i * 0.9), PIERW.dark); dot(lx - i, p.y1 + 4 + Math.round(i * 0.9), PIERW.deep); }
    }
    // deck shadow onto the void (very faint) is skipped: nothing to fall on.
    // deck
    for (let x = p.x0; x < p.x1; x++) {
      const b = ((x - p.x0) / 4) | 0, k = (x - p.x0) % 4;
      const tone = hash(b, opts.seed, 61);
      const base0 = tone < 0.3 ? PIERW.dark : tone > 0.8 ? PIERW.light : PIERW.base;
      const joint = p.y0 + 3 + ((hash(b, opts.seed + 1, 61) * (p.y1 - p.y0 - 6)) | 0);
      for (let y = p.y0; y < p.y1; y++) {
        let col = base0;
        if (k === 3) col = PIERW.seam;
        else if (k === 0) col = sh(base0, 0.1);
        if (y === joint && k !== 3) col = PIERW.seam;
        if ((y === p.y0 + 1 || y === p.y1 - 2) && k === 1) col = '#2a1d14';
        if (k !== 3 && hash(x, y, 62 + opts.seed) < 0.04) col = sh(base0, -0.15);
        if (winter && k !== 3) {
          const n = vnoise(x / 7, y / 5, 64) + (hash(x, y, 63) - 0.5) * 0.12;
          if (n > 0.38) col = n > 0.5 ? P.snow : '#dfe7ee';
        }
        dot(x, y, col);
      }
    }
    // stringers: lit north cap, dark south fascia, and an end beam
    rect(p.x0, p.y0 - 2, p.x1 - p.x0, 2, PIERW.light); rect(p.x0, p.y0 - 2, p.x1 - p.x0, 1, PIERW.hi);
    rect(p.x0, p.y1, p.x1 - p.x0, 3, PIERW.deep); rect(p.x0, p.y1, p.x1 - p.x0, 1, PIERW.dark);
    rect(p.x1, p.y0 - 2, 2, p.y1 - p.y0 + 5, PIERW.deep); rect(p.x1 + 2, p.y0 - 2, 1, p.y1 - p.y0 + 5, OUT);
    // rope railing on posts along the north edge (and south on the main pier)
    const rails = opts.rails || ['n'];
    for (const side of rails) {
      const py = side === 'n' ? p.y0 - 2 : p.y1 - 1;
      const posts = [];
      for (let x = edgeX(py) + 6; x < p.x1 - 2; x += 12) posts.push(x);
      posts.push(p.x1 - 2);
      for (let i = 0; i < posts.length; i++) {
        const x = posts[i];
        rect(x - 1, py - 8, 3, 9, OUT); rect(x, py - 7, 1, 8, PIERW.light); dot(x, py - 7, PIERW.hi);
        if (i + 1 < posts.length) {
          const x2 = posts[i + 1];
          for (let xx = x + 1; xx < x2; xx++) { const u = (xx - x) / (x2 - x); dot(xx, py - 6 + Math.round(Math.sin(u * Math.PI) * 2), ROPE.dark); }
        }
      }
    }
    // bollards
    for (const [bx, by] of opts.bollards || []) {
      rect(bx, by, 4, 3, OUT); rect(bx + 1, by - 1, 2, 1, OUT);
      rect(bx + 1, by, 2, 2, IRON.base); dot(bx + 1, by, IRON.hi);
    }
    // lantern post at the pier head
    if (opts.lantern) {
      const lx = p.x1 - 3, ly = p.y1 - 1;
      rect(lx - 1, ly - 20, 3, 21, OUT); rect(lx, ly - 19, 1, 20, IRON.base);
      rect(lx - 3, ly - 22, 7, 2, OUT); rect(lx - 2, ly - 20, 5, 6, OUT); rect(lx - 1, ly - 19, 3, 4, LAMP.glass); dot(lx - 1, ly - 19, LAMP.hot);
    }
    if (opts.coil) ropeCoil(g, opts.coil[0] - x0, opts.coil[1] - y0);
    if (opts.ring) { // life ring on the end beam
      const [lx, ly] = opts.ring;
      rect(lx - 1, ly - 1, 7, 7, OUT); rect(lx, ly, 5, 5, '#f4ebd8'); rect(lx + 1, ly + 1, 3, 3, PIERW.base);
      dot(lx, ly, RED.base); dot(lx + 4, ly + 4, RED.base); dot(lx + 4, ly, RED.base); dot(lx, ly + 4, RED.base);
    }
    if (opts.crate) { const cc = crate(8, 8, 1, null, sea); g.drawImage(cc, opts.crate[0] - x0 - 1, opts.crate[1] - y0 - 9); }
    if (winter) snowCap(c, false);
    return { c, ox: x0, oy: y0 };
  }

  /* ====================================================================
   * Static 8: ground — bazaar floor, cargo yard, river and spring pool
   * ================================================================== */
  function groundPatch(ctx, x0, y0, x1, y1, pal, seed, fray) {
    const w = x1 - x0, h = y1 - y0;
    const [pc, pg] = mk(w, h);
    const img = pg.createImageData(w, h), d = img.data;
    const cols = pal.map((c) => CO.hexToRgb(c));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const wx = x0 + x, wy = y0 + y;
      if (GEO.din(wx, wy) < 4) continue;
      if (S.onRoad((wx / T) | 0, (wy / T) | 0)) continue;
      const ex = Math.min(x, w - 1 - x), ey = Math.min(y, h - 1 - y), e = Math.min(ex, ey, GEO.din(wx, wy) - 4);
      if (fray && e < 9 && vnoise(wx / 6, wy / 6, seed) * 9 > e + bay(wx, wy) * 2.5) continue;
      const n = vnoise(wx / 9, wy / 9, seed + 1) * 0.65 + vnoise(wx / 3, wy / 3, seed + 2) * 0.35;
      let k = n < 0.35 ? 0 : n < 0.62 ? 1 : 2;
      if (n > 0.5 && n < 0.56 && bay(wx, wy) < 0.5) k = 2;
      if (n < 0.42 && n > 0.35 && bay(wx, wy) < 0.5) k = 0;
      if (hash(wx, wy, seed + 3) < 0.03) k = 3;
      const c = cols[k], i = (y * w + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    pg.putImageData(img, 0, 0);
    ctx.drawImage(pc, x0, y0);
  }

  /* River geometry: distance to the polyline and the local half-width. */
  function riverAt(x, y) {
    let best = 1e9, hw = 4, along = 0, acc = 0, side = 0;
    for (let i = 0; i + 1 < RIVER.length; i++) {
      const [ax, ay, aw] = RIVER[i], [bx, by, bw2] = RIVER[i + 1];
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy, len = Math.sqrt(L2);
      let u = ((x - ax) * vx + (y - ay) * vy) / L2; u = clamp(u, 0, 1);
      const px = ax + vx * u, py = ay + vy * u, d = Math.hypot(x - px, y - py);
      if (d < best) { best = d; hw = aw + (bw2 - aw) * u; along = acc + len * u; side = (y - py) >= 0 ? 1 : -1; }
      acc += len;
    }
    // gentle wobble of the banks
    hw += (vnoise(x / 11, y / 11, 501) - 0.5) * 2.2;
    return { d: best, hw, along, side };
  }
  const RIVER_LEN = (function () { let a = 0; for (let i = 0; i + 1 < RIVER.length; i++) a += Math.hypot(RIVER[i + 1][0] - RIVER[i][0], RIVER[i + 1][1] - RIVER[i][1]); return a; })();
  const RB = { x0: 40, y0: 478, x1: 346, y1: 540 }; // river bounding box (px)

  function drawRiver(ctx, sea) {
    const winter = sea === 'winter';
    const w = RB.x1 - RB.x0, h = RB.y1 - RB.y0;
    const [pc, pg] = mk(w, h);
    const img = pg.createImageData(w, h), d = img.data;
    const put = (x, y, hex) => { const c = CO.hexToRgb(hex), i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
    const sandBank = winter ? ['#e6edf2', '#cfd9e2', '#b7c4d0'] : ['#d8c08a', '#c2a46e', '#9c8058'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const wx = RB.x0 + x, wy = RB.y0 + y;
      const on = GEO.on(wx, wy);
      // the mouth cuts through the rim: allow a few px past the lip
      if (!on && !(wx >= LIP_X - 3 && wx < LIP_X + 2 && Math.abs(wy - MOUTH_Y) <= 7)) continue;
      const r = riverAt(wx, wy);
      // the spring pool: a rounded basin around the source
      const pd = Math.hypot((wx - SPRING.x) / 1.35, wy - SPRING.y);
      const inPool = pd < 9 + (vnoise(wx / 5, wy / 5, 503) - 0.5) * 2;
      const dd = inPool ? Math.min(r.d - r.hw, pd - 9) : r.d - r.hw;
      if (dd >= 4) continue;
      if (dd >= 0) { // banks: wet sand and pebbles, darker toward the water
        let col = dd < 1.2 ? sandBank[2] : dd < 2.5 ? sandBank[1] : sandBank[0];
        if (hash(wx, wy, 505) < 0.12) col = winter ? '#ffffff' : (hash(wx, wy, 506) < 0.5 ? STONE.light : STONE.base);
        if (dd > 3 && bay(wx, wy) < 0.5) continue; // dithered outer fringe
        put(x, y, col);
        continue;
      }
      const depth = clamp(-dd / Math.max(2, r.hw), 0, 1);
      let col = depth > 0.65 ? WATER.deep : depth > 0.3 ? WATER.base : WATER.mid;
      // north bank shades the water just below it (light from the top-left)
      if (!inPool && r.side < 0 && -dd < 2) col = WATER.shade;
      if (!inPool && r.side > 0 && -dd < 1.2) col = WATER.light; // lit south edge
      // flow streaks
      const st = vnoise(r.along / 9, r.d * 0.6, 507);
      if (st > 0.72 && depth > 0.2) col = WATER.light;
      else if (st > 0.66 && depth > 0.2 && bay(wx, wy) < 0.5) col = WATER.mid;
      if (inPool && pd < 3) col = WATER.mid;
      if (winter) {
        // ice creeps in from both banks; the middle still runs
        if (depth < 0.42) col = bay(wx, wy) < 0.3 ? '#d6e8f2' : '#eaf4fa';
        else if (depth < 0.5) col = '#a8d0e6';
      }
      put(x, y, col);
    }
    pg.putImageData(img, 0, 0);
    ctx.drawImage(pc, RB.x0, RB.y0);
  }

  function drawPlaza(ctx, sea) {
    const sand = sea === 'winter' ? ['#cfd6dc', '#e2e8ec', '#f1f4f6', '#b9c2ca'] : ['#b89a6a', '#c9ad7c', '#dac193', '#9c8058'];
    groundPatch(ctx, PLAZA_W.x0, PLAZA_W.y0, PLAZA_W.x1, PLAZA_W.y1, sand, 81, true);
    groundPatch(ctx, PLAZA_E.x0, PLAZA_E.y0, PLAZA_E.x1, PLAZA_E.y1, sand, 82, true);
    if (sea === 'winter') return;
    // woven rugs in front of the stalls
    for (const st of STALLS) {
      const a = AWNINGS[st.aw][0], b = st.aw === 2 ? '#7c50bd' : '#e6a12b';
      const rx = st.x + 7, ry = st.base + 5, rw = 22;
      R(ctx, rx, ry - 4, rw, 4, a);
      for (let x = rx; x < rx + rw; x += 2) D(ctx, x, ry - 3, b);
      R(ctx, rx, ry - 4, rw, 1, sh(a, 0.2));
      for (let x = rx; x < rx + rw; x += 2) D(ctx, x, ry, sh(b, -0.2));
    }
  }
  function drawYard(ctx, sea) {
    const dirt = sea === 'winter' ? ['#c3ccd4', '#dbe2e8', '#eef2f5', '#a9b3bc'] : [P.dirtDark, P.dirt, P.dirtLight, '#6e4e30'];
    groundPatch(ctx, YARD.x0, YARD.y0, YARD.x1, YARD.y1, dirt, 91, true);
    // cart ruts from the warehouse door east to the crane
    const ruts = sea === 'winter' ? '#a9b3bc' : '#7a5734';
    for (let x = WH.x1 + 6; x < CRANE.x - 4; x++) {
      const y = 644 + Math.round(Math.sin(x * 0.05) * 1.2);
      if (hash(x, 3, 92) < 0.85 && GEO.din(x, y + 7) > 5) { D(ctx, x, y, ruts); D(ctx, x, y + 7, ruts); }
    }
  }

  /* ====================================================================
   * Static 23: buildings and props
   * ================================================================== */
  function drawStacks(ctx, sea) {
    const items = [];
    for (const st of STACKS) {
      const v = (st.x * 13 + st.y) % 3;
      if (st.k === 'pyr') items.push([st.x, st.y, 12, 11, v, null], [st.x + 13, st.y, 12, 11, v + 1, null], [st.x + 6, st.y - 11, 12, 11, v + 2, null]);
      else if (st.k === 'two') items.push([st.x, st.y, 10, 10, v, null], [st.x, st.y - 10, 10, 10, v + 1, 'full'], [st.x + 11, st.y, 8, 8, v + 2, null]);
      else items.push([st.x, st.y, 10, 9, v, null], [st.x + 11, st.y, 10, 9, v + 1, 'full'], [st.x + 22, st.y + 2, 8, 7, v, null]);
    }
    for (const t of TAGGED) items.push([t.x, t.y, 11, 10, 0, 'low', t]);
    items.sort((a, b) => a[1] - b[1]);
    for (const [x, y, w] of items) groundShadow(ctx, x + 3, y - 1, w + 2, 4);
    for (const [x, y, w, h, v, open, tag] of items) {
      const c = crate(w, h, v, open, sea);
      ctx.drawImage(c, x - 1, y - h - 1);
      if (tag) { // low stock: a red tag on a string
        R(ctx, x + w - 2, y - h - 1, 1, 3, '#2a1c12');
        R(ctx, x + w - 3, y - h + 2, 4, 5, '#5a1014');
        R(ctx, x + w - 2, y - h + 3, 2, 3, '#e43b44'); D(ctx, x + w - 2, y - h + 3, '#ff8a8a');
      }
    }
  }

  function drawSpringRocks(ctx, sea) {
    const winter = sea === 'winter';
    const rocks = [[SPRING.x - 13, SPRING.y - 4, 5, 4], [SPRING.x - 4, SPRING.y - 9, 7, 5], [SPRING.x + 8, SPRING.y - 6, 6, 4], [SPRING.x + 14, SPRING.y + 1, 4, 3], [SPRING.x - 15, SPRING.y + 4, 3, 2], [SPRING.x + 11, SPRING.y + 7, 3, 2]];
    for (const [x, y, rx, ry] of rocks) {
      groundShadow(ctx, x - rx + 2, y + ry - 1, rx * 2 + 2, 3);
      ellipse(ctx, x, y, rx + 1, ry + 1, OUT);
      ellipse(ctx, x, y, rx, ry, STONE.dark); ellipse(ctx, x - 1, y - 1, rx - 1, ry - 1, STONE.base);
      ellipse(ctx, x - 2, y - 2, Math.max(1, rx - 3), Math.max(1, ry - 2), STONE.light);
      D(ctx, x - 2, y - ry, winter ? P.snow : STONE.moss); D(ctx, x - 1, y - ry, winter ? P.snow : STONE.moss); D(ctx, x, y - ry + 1, winter ? '#dfe7ee' : '#8a9a58');
      if (winter) R(ctx, x - rx + 2, y - ry, rx * 2 - 3, 1, P.snow);
    }
    // a little source spout: water bubbling out from under the big rock
    R(ctx, SPRING.x - 3, SPRING.y - 4, 4, 2, WATER.light); D(ctx, SPRING.x - 2, SPRING.y - 4, WATER.hi);
  }

  function drawReeds(ctx, sea) {
    if (sea === 'winter') return;
    const rnd = S.rng(911);
    for (let i = 0; i < 46; i++) {
      const seg = 1 + ((rnd() * (RIVER.length - 3)) | 0), u = rnd();
      const [ax, ay, aw] = RIVER[seg], [bx, by] = RIVER[seg + 1];
      const side = rnd() < 0.5 ? -1 : 1;
      const x = Math.round(ax + (bx - ax) * u), y = Math.round(ay + (by - ay) * u + side * (aw + 2 + rnd() * 2));
      if (GEO.din(x, y) < 6) continue;
      const h = 3 + ((rnd() * 4) | 0), col = sea === 'autumn' ? (rnd() < 0.5 ? '#9a8a40' : '#b39a4c') : (rnd() < 0.5 ? '#4f8f33' : '#6fae4a');
      R(ctx, x, y - h, 1, h, col); D(ctx, x, y - h, sh(col, 0.3));
      if (rnd() < 0.35) { R(ctx, x, y - h - 2, 1, 2, '#6a4026'); D(ctx, x, y - h - 2, '#8a5a36'); } // a cattail
      if (rnd() < 0.5) D(ctx, x + 1, y - h + 1, sh(col, -0.2));
    }
    // a few lily pads in the slower stretches
    for (const [x, y] of [[150, 515], [112, 521], [252, 506]]) {
      R(ctx, x, y, 3, 2, '#4f8f33'); D(ctx, x, y, '#7cc35a'); D(ctx, x + 2, y + 1, '#3a6a28');
    }
  }

  function drawProps(ctx, sea) {
    // barrels and sacks by the warehouse and the stalls
    const barrels = [[WH.x1 + 2, 660, 0], [WH.x1 + 10, 662, 1], [86, 592, 0], [212, 594, 1], [342, 616, 0]];
    for (const [x, b, v] of barrels) { if (GEO.din(x + 4, b) < 4) continue; groundShadow(ctx, x + 2, b - 1, 10, 3); barrel(ctx, x, b, v); }
    sack(ctx, WH.x0 + 2, 670); sack(ctx, 226, 668);
    // a pallet and a hand truck in the yard
    const plx = 300, ply = 616;
    groundShadow(ctx, plx + 2, ply, 18, 3);
    R(ctx, plx - 1, ply - 5, 18, 6, '#2a1c12');
    for (let i = 0; i < 4; i++) { R(ctx, plx + i * 4, ply - 4, 3, 2, '#c9a878'); D(ctx, plx + i * 4, ply - 4, '#e2cb9e'); }
    R(ctx, plx, ply - 2, 16, 2, '#8a6a44'); R(ctx, plx + 1, ply - 2, 2, 2, '#4a3420'); R(ctx, plx + 7, ply - 2, 2, 2, '#4a3420'); R(ctx, plx + 13, ply - 2, 2, 2, '#4a3420');
    const htx = 236, hty = 636;
    groundShadow(ctx, htx, hty, 12, 3);
    R(ctx, htx + 1, hty - 16, 1, 15, IRON.dark); R(ctx, htx + 7, hty - 16, 1, 15, IRON.dark); R(ctx, htx + 1, hty - 16, 7, 1, IRON.light);
    R(ctx, htx, hty - 2, 10, 1, IRON.dark);
    R(ctx, htx + 2, hty - 11, 6, 9, '#2a1c12'); R(ctx, htx + 3, hty - 10, 4, 2, '#d8ad75'); R(ctx, htx + 3, hty - 8, 4, 5, '#b07e48');
    for (const wx of [htx, htx + 7]) { R(ctx, wx, hty - 3, 3, 3, OUT); D(ctx, wx + 1, hty - 2, IRON.light); }
    if (sea === 'autumn') for (let i = 0; i < 60; i++) {
      const lx = YARD.x0 + 6 + Math.floor(hash(i, 1, 401) * (YARD.x1 - YARD.x0 - 12));
      const ly = YARD.y0 + 4 + Math.floor(hash(i, 2, 401) * (YARD.y1 - YARD.y0 - 8));
      if (GEO.din(lx, ly) < 6) continue;
      const lc = [P.leaf.autumn, P.leafAlt.autumn, '#b5562a'][i % 3];
      D(ctx, lx, ly, lc); D(ctx, lx + 1, ly, sh(lc, -0.2));
    }
    ropeCoil(ctx, 382, 624);
    ropeCoil(ctx, 352, 664);
    // harbour notice board by the dock road (pictograms only)
    const bx = 262, bb = 524;
    R(ctx, bx, bb - 14, 2, 14, WOOD.dark); R(ctx, bx + 12, bb - 14, 2, 14, WOOD.dark);
    R(ctx, bx - 1, bb - 16, 16, 10, OUT); R(ctx, bx, bb - 15, 14, 8, WOOD.mid); R(ctx, bx, bb - 15, 14, 1, WOOD.light);
    R(ctx, bx + 1, bb - 13, 5, 5, '#efe6cf'); R(ctx, bx + 7, bb - 13, 5, 4, '#cfe0ea'); D(ctx, bx + 3, bb - 11, RED.base); D(ctx, bx + 9, bb - 11, TEAL.base);
    if (sea === 'winter') { R(ctx, bx - 1, bb - 17, 16, 1, P.snow); }
    // a bench on the north bank and a fishing pole stuck in the sand
    const bnx = 190, bny = 491;
    if (GEO.din(bnx, bny) > 5) {
      groundShadow(ctx, bnx + 1, bny, 16, 3);
      R(ctx, bnx, bny - 6, 15, 3, OUT); R(ctx, bnx + 1, bny - 5, 13, 1, WOOD.light); R(ctx, bnx + 1, bny - 4, 13, 1, WOOD.dark);
      R(ctx, bnx, bny - 10, 15, 3, OUT); R(ctx, bnx + 1, bny - 9, 13, 1, WOOD.base);
      for (const lx of [bnx + 1, bnx + 12]) { R(ctx, lx, bny - 3, 2, 3, OUT); D(ctx, lx, bny - 3, WOOD.dark); }
      if (sea === 'winter') R(ctx, bnx + 1, bny - 6, 13, 1, P.snow);
    }
    const fpx = 230, fpy = 498;
    if (GEO.din(fpx, fpy) > 5) {
      for (let i = 0; i < 12; i++) D(ctx, fpx + Math.round(i * 0.5), fpy - i, i < 3 ? WOOD.dark : '#c9a46a');
      for (let i = 0; i < 9; i++) D(ctx, fpx + 6 + Math.round(i * 0.25), fpy - 11 + Math.round(i * 1.45), '#e8e4d8'); // the line into the river
      D(ctx, fpx + 8, fpy + 2, RED.base); D(ctx, fpx + 8, fpy + 1, '#ffffff'); // bobber
    }
    // a two-wheeled hand cart by the crane
    const ctx0 = 336, cty = 670;
    if (GEO.din(ctx0 + 8, cty) > 4) {
      groundShadow(ctx, ctx0 + 2, cty - 1, 20, 3);
      R(ctx, ctx0 - 1, cty - 11, 18, 8, OUT); R(ctx, ctx0, cty - 10, 16, 6, WOOD.base); R(ctx, ctx0, cty - 10, 16, 1, WOOD.light);
      for (let x = ctx0 + 3; x < ctx0 + 16; x += 4) R(ctx, x, cty - 9, 1, 5, WOOD.dark);
      R(ctx, ctx0 + 2, cty - 13, 5, 3, '#c2a978'); R(ctx, ctx0 + 8, cty - 14, 6, 4, '#b07e48'); R(ctx, ctx0 + 8, cty - 14, 6, 1, '#d8ad75');
      for (let i = 0; i < 7; i++) D(ctx, ctx0 + 16 + i, cty - 8 - (i >> 1), WOOD.dark); // handles
      R(ctx, ctx0 + 4, cty - 5, 6, 6, OUT); R(ctx, ctx0 + 5, cty - 4, 4, 4, WOOD.mid); D(ctx, ctx0 + 6, cty - 3, WOOD.dark); D(ctx, ctx0 + 5, cty - 4, WOOD.hi);
      if (sea === 'winter') R(ctx, ctx0, cty - 11, 16, 1, P.snow);
    }
  }

  const cache = {};
  function getCache(sea) {
    if (cache[sea]) return cache[sea];
    const out = {
      stalls: STALLS.map((s) => buildStall(s, sea)),
      wh: buildWarehouse(sea),
      annex: GROWTH >= 2 ? buildAnnex(sea) : null,
      beacon: buildBeacon(sea),
      ships: SHIPS.map((s) => buildShip(s, sea)),
      crane: buildCrane(sea),
      piers: [
        buildPier(PIER_MAIN, { seed: 1, rails: ['n', 's'], lantern: true, bollards: [[PIER_MAIN.x1 - 10, PIER_MAIN.y0 + 2], [PIER_MAIN.x1 - 10, PIER_MAIN.y1 - 4]], ring: [PIER_MAIN.x1 - 22, PIER_MAIN.y1 - 9], coil: [PIER_MAIN.x0 + 26, PIER_MAIN.y0 + 8] }, sea),
        buildPier(PIER_A, { seed: 2, lantern: true, bollards: [[PIER_A.x1 - 8, PIER_A.y0 + 3]], coil: [PIER_A.x0 + 30, PIER_A.y0 + 7] }, sea),
        buildPier(PIER_B, { seed: 3, lantern: GROWTH >= 1, bollards: [[PIER_B.x1 - 8, PIER_B.y0 + 3]], coil: [PIER_B.x0 + 34, PIER_B.y0 + 7] }, sea),
      ],
    };
    return (cache[sea] = out);
  }
  let curSeason = season();

  S.registerStatic(8, (ctx) => {
    curSeason = season();
    drawPlaza(ctx, curSeason);
    drawYard(ctx, curSeason);
    drawRiver(ctx, curSeason);
  });

  S.registerStatic(23, (ctx) => {
    const K = getCache(curSeason);
    drawReeds(ctx, curSeason);
    drawSpringRocks(ctx, curSeason);
    // sky beacon
    groundShadow(ctx, BEACON.x - 10, BEACON.base - 3, 26, 5);
    ctx.drawImage(K.beacon.c, K.beacon.ox, K.beacon.oy);
    drawProps(ctx, curSeason);
    // stalls (back row first)
    STALLS.slice().sort((a, b) => a.base - b.base).forEach((st) => {
      const i = STALLS.indexOf(st);
      groundShadow(ctx, st.x + 4, st.base - 2, 38, 5);
      ctx.drawImage(K.stalls[i], st.x - 2, st.base - STALL_H - 2);
    });
    if (GROWTH >= 3) { // bunting across the bazaar
      const wx = STALLS.filter((st) => st.side === 'w').map((st) => st.x), ex = STALLS.filter((st) => st.side === 'e').map((st) => st.x);
      const runs = [[Math.min(...wx), Math.max(...wx) + STALL_W, 539], [Math.min(...ex), Math.max(...ex) + STALL_W, 553]];
      for (const [a, b, y0] of runs) for (let x = a; x < b; x++) {
        const sag = Math.round(Math.sin(((x - a) / (b - a)) * Math.PI) * 5);
        D(ctx, x, y0 + sag, '#5d3f22');
        if ((x - a) % 7 === 3) { const fc = FIDGET[((x - a) / 7 | 0) % 8]; R(ctx, x - 1, y0 + 1 + sag, 3, 2, fc); D(ctx, x, y0 + 3 + sag, fc); }
      }
    }
    // warehouse
    ctx.fillStyle = P.shadow;
    ctx.fillRect(WH.x1 + 1, WH.eave + 2, 4, WH.base - WH.eave - 2);
    ctx.fillRect(WH.x0 + 4, WH.base, WH.x1 - WH.x0, 2);
    ctx.drawImage(K.wh.c, K.wh.ox, K.wh.oy);
    if (K.annex) { ctx.fillStyle = P.shadow; ctx.fillRect(WH.x1 + 2, WH.base, 15, 2); ctx.drawImage(K.annex, WH.x1 - 1, WH.base - 29); }
    drawStacks(ctx, curSeason);
  });

  /* ====================================================================
   * Entities: sky-ships and the crane
   * ================================================================== */
  function ropeLine(ctx, x0, y0, x1, y1, sag) {
    const steps = Math.max(2, Math.ceil(Math.abs(x1 - x0) + Math.abs(y1 - y0)));
    ctx.fillStyle = ROPE.dark;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps, x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u + (sag || 3) * 4 * u * (1 - u);
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  }
  const shipEnts = SHIPS.map((s, i) => S.addEntity({
    x: s.x + s.L / 2, y: s.y + 18, island: ID, ship: s, idx: i, bob: 0, isShip: true,
    update(dt, t) {
      if (RM) { this.bob = 0; return; }
      const sp = s.empty ? 0.7 : 1.1;
      this.bob = Math.round(Math.sin(t * sp + i * 1.9) * 1.2);
    },
    draw(ctx, t) {
      const K = getCache(curSeason).ships[i];
      const y = s.y + this.bob;
      ctx.drawImage(K.c, s.x - SOX, y - SOY);
      // propeller at the stern (still when idle)
      const pf = s.empty || RM ? 0 : Math.floor(t * 14) % 3;
      ctx.drawImage(PROP[pf], s.x + K.prop.x - 1, y + K.prop.y - 6);
      // mooring line from the bow to the pier head (or an anchor line into the void)
      if (s.pier) ropeLine(ctx, s.x - 6, y + K.mid - 5, s.pier.x1 - 2, s.pier.y0 + 6 - (s.y - s.pier.y1 > 8 ? 0 : 0), 3);
      else { // anchored: a rope down to a little drifting anchor-stone
        const ax = s.x - 14, ay = y + 30;
        ropeLine(ctx, s.x + 2, y + 6, ax + 2, ay, 2);
        R(ctx, ax - 1, ay, 6, 5, OUT); R(ctx, ax, ay + 1, 4, 3, STONE.base); D(ctx, ax, ay + 1, STONE.light);
      }
    },
  }));

  // Crane: unloads berth A while there are orders; parked otherwise.
  const CYCLE = 18;
  const craneEnt = S.addEntity({
    x: CRANE.x, y: CRANE.base, island: ID,
    draw(ctx, t) {
      const K = getCache(curSeason).crane;
      ctx.drawImage(K.c, K.ox, K.oy);
      const ship = SHIPS[0], se = shipEnts[0];
      const deck = ship.y + (se ? se.bob : 0) - 6;
      const overShip = ship.x + 12, overPier = PIER_A.x0 + 22, pierY = PIER_A.y1 - 2;
      let tx = CRANE.tipX - 10, hookY = CRANE.top + 18, load = false;
      if (ORDERS > 0) {
        const p = ((t / (RM ? CYCLE * 2 : CYCLE)) % 1);
        const seg = (a, b) => clamp((p - a) / (b - a), 0, 1);
        const ease = (u) => u * u * (3 - 2 * u);
        const low = deck - 2, high = CRANE.top + 12, pierLow = pierY - 1;
        if (p < 0.15) { tx = overShip; hookY = high + (low - high) * ease(seg(0, 0.15)); }
        else if (p < 0.2) { tx = overShip; hookY = low; load = p > 0.17; }
        else if (p < 0.35) { tx = overShip; hookY = low + (high - low) * ease(seg(0.2, 0.35)); load = true; }
        else if (p < 0.55) { tx = overShip + (overPier - overShip) * ease(seg(0.35, 0.55)); hookY = high; load = true; }
        else if (p < 0.68) { tx = overPier; hookY = high + (pierLow - high) * ease(seg(0.55, 0.68)); load = true; }
        else if (p < 0.73) { tx = overPier; hookY = pierLow; load = p < 0.7; }
        else if (p < 0.85) { tx = overPier; hookY = pierLow + (high - pierLow) * ease(seg(0.73, 0.85)); }
        else { tx = overPier + (overShip - overPier) * ease(seg(0.85, 1)); hookY = high; }
        if (p >= 0.7 || p < 0.1) drawCrateSmall(ctx, overPier - 3, pierY);
      } else {
        hookY = CRANE.top + 16 + (RM ? 0 : Math.round(Math.sin(t * 0.6)));
      }
      tx = Math.round(tx); hookY = Math.round(hookY);
      R(ctx, tx - 2, CRANE.top + 3, 5, 3, OUT); R(ctx, tx - 1, CRANE.top + 4, 3, 1, IRON.light);
      R(ctx, tx, CRANE.top + 6, 1, hookY - CRANE.top - 6, '#2a2630');
      R(ctx, tx - 1, hookY, 3, 2, IRON.dark); D(ctx, tx + 1, hookY + 2, IRON.dark); D(ctx, tx, hookY + 3, IRON.dark);
      if (load) drawCrateSmall(ctx, tx - 3, hookY + 11);
    },
  });
  function drawCrateSmall(ctx, x, base) {
    R(ctx, x - 1, base - 8, 9, 9, '#2a1c12');
    R(ctx, x, base - 7, 7, 2, '#d8ad75'); R(ctx, x, base - 5, 7, 5, '#b07e48'); R(ctx, x, base - 5, 7, 1, '#cd9c62');
    D(ctx, x + 3, base - 3, '#7f5630'); R(ctx, x, base - 1, 7, 1, '#7f5630');
  }
  void craneEnt;

  /* ====================================================================
   * Dynamic 100: river glints, spring bubbles and the west waterfall
   * ================================================================== */
  const GLINTS = [];
  for (let k = 0; k < 22; k++) GLINTS.push({ ph: hash(k, 1, 520), off: (hash(k, 2, 520) - 0.5) * 1.4, sp: 0.6 + hash(k, 3, 520) * 0.5 });
  function riverPoint(a) { // point at arc length a along the river
    for (let i = 0; i + 1 < RIVER.length; i++) {
      const [ax, ay, aw] = RIVER[i], [bx, by, bw2] = RIVER[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (a <= len || i + 2 === RIVER.length) { const u = clamp(a / len, 0, 1); return [ax + (bx - ax) * u, ay + (by - ay) * u, aw + (bw2 - aw) * u, (bx - ax) / len, (by - ay) / len]; }
      a -= len;
    }
    return [RIVER[0][0], RIVER[0][1], 3, -1, 0];
  }
  const FALL_TOP = MOUTH_Y - 6, FALL_BOT = S.H; // the stream falls to the bottom of the world
  const FALL_DROPS = [];
  for (let k = 0; k < 34; k++) FALL_DROPS.push({ ph: hash(k, 4, 530), dx: (hash(k, 5, 530) - 0.5), big: hash(k, 6, 530) < 0.25 });
  const MIST = [];
  for (let k = 0; k < 18; k++) MIST.push({ ph: hash(k, 7, 531), dx: hash(k, 8, 531), r: 2 + ((hash(k, 9, 531) * 4) | 0) });
  /** Stream centre x and half width at a given y below the lip. */
  function fallShape(y) {
    const s = y - FALL_TOP;
    const xc = LIP_X - 6 - 10 * (1 - Math.exp(-s / 18));
    const hw = s < 16 ? 7 : Math.max(4.6, 7 - (s - 16) * 0.02);
    return [xc, hw];
  }
  // The falling water is rendered per frame into a small ImageData (cheap typed
  // writes) and blitted once, so it bobs with the island like everything else.
  const FX0 = LIP_X - 34, FW = 44, FH = FALL_BOT - FALL_TOP;
  const [fallC, fallG] = mk(FW, FH);
  const fallImg = fallG.createImageData(FW, FH);
  const RGB = {};
  const rgbOf = (h) => RGB[h] || (RGB[h] = CO.hexToRgb(h));
  const SPLIT = 128; // below this the curtain frays into three streams
  function renderFall(flow, winter) {
    const d = fallImg.data;
    d.fill(0);
    const put = (x, y, hex, a) => {
      const lx = x - FX0; if (lx < 0 || lx >= FW) return;
      const c = rgbOf(hex), i = (y * FW + lx) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a;
    };
    const runs = [];
    for (let y = 0; y < FH; y++) {
      const s = y, [xc, hw] = fallShape(y + FALL_TOP);
      const fade = s < 160 ? 1 : Math.max(0, 1 - (s - 160) / (FH - 160));
      if (fade <= 0) break;
      runs.length = 0;
      if (s < SPLIT) runs.push([xc - hw, xc + hw, 0]);
      else {
        const k = (s - SPLIT) / (FH - SPLIT), spread = 2 + k * 9, w = Math.max(0.9, 2.4 - k * 1.6);
        runs.push([xc - spread - w - 1.5, xc - spread + w - 1.5, 1], [xc - w, xc + w, 2], [xc + spread * 0.8 - w + 1, xc + spread * 0.8 + w + 1, 3]);
      }
      for (const [ra, rb, id] of runs) {
        if (id && hash(id, Math.floor((y - flow) / 7), 533) < ((s - SPLIT) / (FH - SPLIT)) * 0.75) continue; // gaps fall with the water
        const x0 = Math.round(ra), x1 = Math.round(rb);
        for (let x = x0; x <= x1; x++) {
          const col = x - x0;
          const streak = (((y - flow + col * 5 + id * 3) % 12) + 12) % 12;
          let c;
          if (winter) c = streak < 2 ? '#ffffff' : col === 0 ? '#e6f2fa' : x === x1 ? '#8fb6d4' : streak < 6 ? '#d4e8f4' : '#bcd8ec';
          else if (s < 5) c = col === 0 || s < 2 ? WATER.foam : WATER.hi; // the glassy curl over the lip
          else c = streak < 2 ? WATER.foam : col === 0 ? WATER.hi : x === x1 ? WATER.deep : streak < 5 ? WATER.light : streak < 9 ? WATER.mid : WATER.base;
          const edge = x === x0 || x === x1;
          put(x, y, c, Math.round(255 * fade * (edge ? 0.72 : 0.95)));
        }
      }
    }
    fallG.putImageData(fallImg, 0, 0);
  }

  S.registerDynamic(100, (ctx, t) => {
    const winter = curSeason === 'winter';
    const tt = RM ? t * 0.25 : t;
    // river glints drifting downstream
    for (const g of GLINTS) {
      const u = (g.ph + tt * 0.025 * g.sp) % 1;
      const [x, y, hw, dx, dy] = riverPoint(u * RIVER_LEN);
      const ox = -dy * g.off * hw, oy = dx * g.off * hw;
      const a = Math.sin(u * Math.PI);
      if (winter && Math.abs(g.off) > 0.3) continue;
      ctx.globalAlpha = 0.85 * a;
      R(ctx, x + ox - 1, y + oy, 2, 1, WATER.hi);
    }
    ctx.globalAlpha = 1;
    // spring bubbles
    if (!winter) for (let k = 0; k < 3; k++) {
      const ph = (tt * 0.9 + k / 3) % 1;
      const bx = SPRING.x - 2 + Math.round(Math.sin(k * 2.3 + Math.floor(tt * 0.9 + k / 3)) * 3), by = SPRING.y + 1 - Math.round(ph * 2);
      ctx.globalAlpha = 1 - ph;
      D(ctx, bx, by, WATER.foam);
      if (ph > 0.6) { D(ctx, bx - 1, by, WATER.hi); D(ctx, bx + 1, by, WATER.hi); }
    }
    ctx.globalAlpha = 1;
    // ---- the waterfall
    const flow = tt * 46;
    // lip: the river tips over the edge with a bright curl of foam
    for (let y = MOUTH_Y - 6; y <= MOUTH_Y + 6; y++) {
      const e = Math.abs(y - MOUTH_Y) / 6.5;
      const x = LIP_X - 1 - Math.round((1 - e * e) * 2);
      D(ctx, x, y, winter ? '#eaf4fa' : WATER.foam); D(ctx, x + 1, y, WATER.hi);
    }
    // the falling curtain (fraying into three streams far below)
    renderFall(Math.floor(flow), winter);
    ctx.drawImage(fallC, FX0, FALL_TOP);
    ctx.globalAlpha = 1;
    // spray and mist where it tips over
    for (const m of MIST) {
      const ph = (tt * 0.35 + m.ph) % 1;
      const x = Math.round(LIP_X - 6 - m.dx * 22 - ph * 8), y = Math.round(MOUTH_Y - 4 + ph * 34 + Math.sin(ph * 6 + m.dx * 9) * 2);
      ctx.globalAlpha = 0.3 * (1 - ph);
      ctx.fillStyle = '#e8f6fb';
      ctx.fillRect(x - (m.r >> 1), y - (m.r >> 1), m.r, m.r);
    }
    // droplets peeling off the sheet as it falls
    for (const dr of FALL_DROPS) {
      const ph = (tt * 0.22 + dr.ph) % 1;
      const y = FALL_TOP + 14 + ph * (FALL_BOT - FALL_TOP - 20);
      const [xc, hw] = fallShape(y);
      const x = xc + dr.dx * (hw * 2 + 4 + ph * 16);
      ctx.globalAlpha = (1 - ph) * 0.85;
      D(ctx, x, y, winter ? '#ffffff' : WATER.hi);
      if (dr.big) D(ctx, x, y - 1, WATER.light);
    }
    ctx.globalAlpha = 1;
    if (winter) { // icicles hanging off the lip either side of the flow
      for (const [dy, l] of [[-8, 4], [-9, 2], [8, 3], [9, 5], [10, 2]]) R(ctx, LIP_X - 1, MOUTH_Y + dy, 1, l, '#e8f4ff');
    }
  }, ISL);

  /* ====================================================================
   * Dynamic 200: piers over the void and the spinner sign
   * ================================================================== */
  const SPIN_FRAMES = [];
  function buildSpinFrames() {
    const N = 6, body = TEAL.base, bodyL = TEAL.hi, bodyD = TEAL.dark;
    for (let f = 0; f < N; f++) {
      const [c, g] = mk(17, 17);
      const a0 = f * (Math.PI * 2 / 3) / N;
      const lobes = [0, 1, 2].map((k) => { const a = a0 + k * Math.PI * 2 / 3 - Math.PI / 2; return [8 + Math.cos(a) * 4.6, 8 + Math.sin(a) * 4.6]; });
      for (let y = 0; y < 17; y++) for (let x = 0; x < 17; x++) {
        const dc = Math.hypot(x - 8, y - 8);
        let dl = 99, li = 0;
        lobes.forEach(([lx, ly], k) => { const d = Math.hypot(x - lx, y - ly); if (d < dl) { dl = d; li = k; } });
        if (dl > 3.3 && dc > 3.4) continue;
        let col = body;
        const lx = x - 8, ly = y - 8;
        if (lx + ly < -6 || (dl < 3.3 && x - lobes[li][0] + y - lobes[li][1] < -2.2)) col = bodyL;
        else if (lx + ly > 6 || (dl < 3.3 && x - lobes[li][0] + y - lobes[li][1] > 2.4)) col = bodyD;
        if (dl < 1.6) col = ['#e8403d', P.gold, '#8a5ad8'][li];
        if (dl < 0.8) col = '#2a2630';
        if (dc < 1.8) col = '#c4952b';
        if (dc < 0.8) col = '#fff3c4';
        D(g, x, y, col);
      }
      outline(c, OUT);
      SPIN_FRAMES.push(c);
    }
  }
  const flag = STALLS.find((s) => s.flagship);
  S.registerDynamic(200, (ctx, t) => {
    const K = getCache(curSeason);
    for (const pc of K.piers) ctx.drawImage(pc.c, pc.ox, pc.oy);
    if (!flag) return;
    if (!SPIN_FRAMES.length) buildSpinFrames();
    const x = flag.x + 17, y = flag.base - STALL_H;
    R(ctx, x - 1, y - 9, 4, 10, OUT); R(ctx, x, y - 8, 2, 9, WOOD.base); R(ctx, x, y - 8, 1, 9, WOOD.light);
    const speed = RM ? 0.6 : (ORDERS ? 5 : 1.6); // maintenance mode: a lazy turn
    const f = Math.floor(t * speed) % SPIN_FRAMES.length;
    ctx.drawImage(SPIN_FRAMES[f], x - 7, y - 24);
  }, ISL);

  /* ====================================================================
   * Dynamic 400: sky-birds, signal flag, chimney smoke
   * ================================================================== */
  const BIRD = [
    ['w.....w', '.w...w.', '..wbw..', '.......'],
    ['.......', '.......', 'wwwbwww', '.......'],
    ['.......', '..wbw..', '.w...w.', 'w.....w'],
  ];
  const BIRDS = [
    { cx: 300, cy: 452, rx: 70, ry: 16, sp: 0.22, ph: 0, col: '#f4f4f0', tip: '#5aa0d8' },
    { cx: 200, cy: 470, rx: 90, ry: 20, sp: -0.17, ph: 2.1, col: '#f4f4f0', tip: '#e8806a' },
    { cx: 470, cy: 560, rx: 40, ry: 12, sp: 0.3, ph: 4.0, col: '#eef4f8', tip: '#5aa0d8' },
    { cx: 70, cy: 600, rx: 30, ry: 40, sp: 0.2, ph: 1.0, col: '#f4f4f0', tip: '#7cc0e0' },
  ];
  const SIGNAL = { x: PIER_MAIN.x1 - 4, y: PIER_MAIN.y0 - 2 };
  S.registerDynamic(400, (ctx, t) => {
    const n = RM ? 1 : BIRDS.length;
    for (let i = 0; i < n; i++) {
      const b = BIRDS[i];
      const a = t * b.sp + b.ph;
      const x = Math.round(b.cx + Math.cos(a) * b.rx), y = Math.round(b.cy + Math.sin(a) * b.ry + Math.sin(a * 3) * 3);
      const f = RM ? 1 : (Math.floor(t * 5 + i) % 4);
      const fr = BIRD[f === 3 ? 1 : f];
      const flip = Math.sin(a) * b.sp > 0;
      for (let j = 0; j < 4; j++) for (let k = 0; k < 7; k++) {
        const ch = fr[j][k]; if (ch === '.') continue;
        const kk = flip ? 6 - k : k;
        D(ctx, x + kk, y + j, ch === 'b' ? b.tip : (k === 0 || k === 6) ? sh(b.tip, -0.1) : b.col);
        if (ch === 'w' && fr[j + 1] === undefined) continue;
        if (ch !== 'b') D(ctx, x + kk, y + j + 1, '#8c96a0');
      }
      D(ctx, x + (flip ? 2 : 4), y + 2, '#f2a03a'); // beak
    }
    // a little bird asleep on the idle ship's yard
    const idle = SHIPS[0] && SHIPS[0].empty ? SHIPS[0] : null;
    if (idle) {
      const K = getCache(curSeason).ships[0], e = shipEnts[0];
      const bx = idle.x + K.perch.x, by = idle.y + e.bob + K.perch.y;
      const blink = !RM && Math.floor(t * 0.7) % 6 === 0;
      spr(ctx, ['.ww..', 'wwwwo', '.bb..'], bx, by, { w: '#f6f6f2', o: '#f2a03a', b: '#5aa0d8' });
      D(ctx, bx + 3, by, blink ? '#f6f6f2' : '#1d1a24');
      R(ctx, bx, by - 1, 1, 1, OUT);
    }
    // signal mast at the main pier head: calm pennant / storm flags by status
    const px = SIGNAL.x, py = SIGNAL.y;
    R(ctx, px - 1, py - 31, 3, 32, OUT); R(ctx, px, py - 30, 1, 31, '#d8d0c0');
    R(ctx, px - 1, py - 32, 3, 2, P.gold);
    const wave = RM ? 0 : Math.floor(t * 3) % 3;
    const flagCols = LEVEL === 'critical' ? [RED.base, RED.base] : LEVEL === 'warn' ? [RED.base, P.gold] : LEVEL === 'idle' ? [TEAL.dark] : [TEAL.base];
    flagCols.forEach((col, k) => {
      const fy = py - 29 + k * 7;
      const len = LEVEL === 'idle' ? 5 : 9;
      for (let i = 0; i < len; i++) {
        const dy = LEVEL === 'idle' ? i : Math.round(Math.sin((i + wave * 2) * 0.8) * 0.8);
        const hgt = LEVEL === 'critical' ? 5 : Math.max(1, 5 - (i >> 1));
        R(ctx, px + 1 + i, fy + dy, 1, hgt, i === 0 ? sh(col, 0.2) : col);
        D(ctx, px + 1 + i, fy + dy + hgt, sh(col, -0.4));
      }
      if (LEVEL === 'ok' || LEVEL === 'idle') D(ctx, px + 3, fy + 1, P.gold);
    });
    // warehouse chimney: a thin curl of smoke
    const cn = RM ? 2 : 4, chx = WH.x0 + 13, chy = WH.roof - 11;
    for (let k = 0; k < cn; k++) {
      const age = ((t * 0.18) + k / cn) % 1;
      const x = Math.round(chx + age * 8 + Math.sin(age * 4 + k) * 1.5), y = Math.round(chy - age * 22);
      const sz = 2 + Math.round(age * 2);
      ctx.fillStyle = `rgba(214,214,222,${(0.45 * (1 - age)).toFixed(2)})`;
      ctx.fillRect(x - (sz >> 1), y, sz, sz - 1);
    }
  }, ISL);

  /* ====================================================================
   * Lights and night glow (700)
   * ================================================================== */
  const light = (o) => S.addLight(Object.assign({ island: ID }, o));
  const K0 = { lampY: BEACON.base - 49 };
  light({ x: BEACON.x, y: K0.lampY, r: 64, color: '#ffd27a', intensity: 1, flicker: false });
  STALLS.forEach((st) => light({ x: st.x + 3, y: st.base - 29, r: 24, color: P.lantern, intensity: 0.8, flicker: true }));
  light({ x: WH.doorX + WH.doorW + 13, y: WH.base - 17, r: 28, color: P.lantern, intensity: 0.85, flicker: true });
  light({ x: WH.doorX + WH.doorW / 2, y: WH.base - 8, r: 20, color: '#ffb86a', intensity: 0.55 });
  light({ x: PIER_MAIN.x1 - 3, y: PIER_MAIN.y1 - 18, r: 30, color: P.lantern, intensity: 0.85, flicker: true });
  light({ x: PIER_A.x1 - 3, y: PIER_A.y1 - 18, r: 26, color: P.lantern, intensity: 0.8, flicker: true });
  if (GROWTH >= 1) light({ x: PIER_B.x1 - 3, y: PIER_B.y1 - 18, r: 24, color: P.lantern, intensity: 0.75, flicker: true });
  SHIPS.forEach((s) => light({ x: s.x + s.L - 2, y: s.y - 7, r: 16, color: P.lantern, intensity: 0.7, flicker: true }));
  light({ x: LIP_X - 8, y: MOUTH_Y + 20, r: 26, color: '#9fdcff', intensity: 0.35 }); // the falls catch a little starlight

  const winGlow = [
    [WH.x0 + 6, WH.eave + 9, 4, 3], [WH.x0 + 12, WH.eave + 9, 4, 3], [WH.x0 + 6, WH.eave + 13, 4, 4], [WH.x0 + 12, WH.eave + 13, 4, 4],
    [WH.x1 - 16, WH.eave + 9, 4, 3], [WH.x1 - 10, WH.eave + 9, 4, 3], [WH.x1 - 16, WH.eave + 13, 4, 4], [WH.x1 - 10, WH.eave + 13, 4, 4],
  ];
  S.registerDynamic(700, (ctx, t) => {
    const a = night();
    if (a < 0.02) return;
    ctx.globalAlpha = a;
    for (const [x, y, w, h] of winGlow) { R(ctx, x, y, w, h, '#ffcf6e'); R(ctx, x, y, w, 1, '#ffe7a8'); }
    for (let k = 0; k < 18; k++) {
      ctx.fillStyle = `rgba(255,190,100,${(0.08 + k * 0.014).toFixed(3)})`;
      ctx.fillRect(WH.doorX + 2, WH.base - 18 + k, WH.doorW - 4, 1);
    }
    // crane cab windows and the blinking warning light on its peak
    R(ctx, CRANE.x + 12, CRANE.top + 8, 3, 2, '#ffcf6e'); R(ctx, CRANE.x + 16, CRANE.top + 8, 2, 2, '#ffcf6e');
    if (RM || Math.floor(t * 1.2) % 2 === 0) { D(ctx, CRANE.x + 4, CRANE.top - 10, '#ff5a4a'); ctx.fillStyle = 'rgba(255,90,74,0.35)'; ctx.fillRect(CRANE.x + 3, CRANE.top - 11, 3, 3); }
    // stall lanterns
    for (const st of STALLS) {
      const fl = RM ? 0 : (Math.sin(t * 7 + st.x) > 0.6 ? 1 : 0);
      R(ctx, st.x + 2, st.base - 31, 3, 4, '#ffe7a8'); D(ctx, st.x + 3, st.base - 30 + fl, '#ffffff');
    }
    // pier lanterns
    for (const p of GROWTH >= 1 ? [PIER_MAIN, PIER_A, PIER_B] : [PIER_MAIN, PIER_A]) R(ctx, p.x1 - 4, p.y1 - 20, 3, 4, '#ffe7a8');
    // ship lanterns and cabin portholes
    shipEnts.forEach((e, i) => {
      const s = SHIPS[i], K = getCache(curSeason).ships[i];
      R(ctx, s.x + K.lamp.x - 1, s.y + e.bob + K.lamp.y - 1, 2, 2, '#ffe7a8');
      R(ctx, s.x + s.L - 11, s.y + e.bob + K.mid - 3, 3, 3, '#ffcf6e');
      for (let x = 12; x < s.L - 12; x += 9) D(ctx, s.x + x + 1, s.y + e.bob + 7, '#ffcf6e');
    });
    // sky beacon: bright lamp and a beam sweeping out over the void
    const lx = BEACON.x, ly = K0.lampY;
    R(ctx, lx - 3, ly - 3, 7, 6, '#fff3c4');
    const ang = (t * (RM ? 0.15 : 0.5)) % (Math.PI * 2);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    if (dx > -0.2) {
      const fade = clamp((dx + 0.2) / 0.5, 0, 1);
      const len = Math.round(40 + 50 * Math.abs(dx));
      for (let k = 5; k < len; k++) {
        const bx = Math.round(lx + dx * k), by = Math.round(ly + dy * k * 0.45);
        const spread = 1 + (k / 10 | 0);
        ctx.fillStyle = `rgba(255,236,170,${(0.3 * fade * (1 - k / len)).toFixed(3)})`;
        ctx.fillRect(bx, by - spread, 1, spread * 2 + 1);
      }
    }
    ctx.globalAlpha = 1;
  }, ISL);

  /* ====================================================================
   * Hotspots and the berth for the commuter sky-ship (villagers module)
   * ================================================================== */
  const lm = (key, x, y, w, h, label) => S.addHotspot({
    id: 'landmark:' + key, kind: 'landmark', landmark: key, biome: ID, island: ID, agent: AGENT,
    label: label || (S.landmarks[key] && S.landmarks[key].label) || key, x, y, w, h, priority: 1,
  });
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  lm('bazaar', PLAZA_W.x0, 540, PLAZA_E.x1 - PLAZA_W.x0, 66, 'Bazaar');
  const dockLabel = 'Sky-ship dock · ' + (KNOWN ? `${plural(ORDERS, 'order')} in 7 days` : 'no order data yet');
  lm('skyDock', PIER_MAIN.x0 - 12, 524, 524 - (PIER_MAIN.x0 - 12), 222, dockLabel);
  const whLabel = 'Warehouse' + (LOW.length ? ` · ${plural(LOW.length, 'low-stock item')}` : '');
  lm('warehouse', WH.x0 - 4, WH.roof - 12, WH.x1 - WH.x0 + (GROWTH >= 2 ? 24 : 8), WH.base - WH.roof + 14, whLabel);

  S.port = {
    dock: { x: PIER_MAIN.x1 + 2, y: Math.round((PIER_MAIN.y0 + PIER_MAIN.y1) / 2), island: ID },
    waterfall: { x: LIP_X, y: MOUTH_Y, island: ID },
  };
})();
