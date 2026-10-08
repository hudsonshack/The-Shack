/* The Shack — River Port Bazaar (Cap'n Twirl, hustle-engine).
 *
 * Owns region "port" (tiles x 6..24, y 26..39) where it meets the harbour bay
 * of the Hudson (water = S.isWater).
 *
 * Static 8   bazaar plaza floor, cargo yard, stone quay, the main pier (planks
 *            over the water) with pilings and its shadow on the water.
 * Static 23  bazaar stalls with striped awnings selling fidgets (spinners,
 *            cubes, pop-its), the warehouse, the harbour light, crate stacks
 *            (red tag on low-stock items), barrels, net rack, bollards.
 * Entities   moored cargo ships (y-sorted, bobbing), the dock crane (y-sorted,
 *            unloading while there are orders), an ambient sailboat tacking on
 *            the river.
 * Dyn 100    ripples around pilings and hulls.
 * Dyn 200    the spinning fidget-spinner sign over Twirl's stall.
 * Dyn 400    gulls, the harbour signal flag (status cue), steamer smoke.
 * Dyn 700    warm windows, lanterns and the harbour light at night.
 *
 * Data (never invented):
 *   ships        = metrics('hustle-engine').shopify.orders_7d: one crate on deck
 *                  per order (5 per ship); with no orders a single empty steamer
 *                  rides high with an open hold and a gull on its mast.
 *   red tags     = shopify.low_stock (one tagged, nearly empty crate per item).
 *   crane        = unloads only while there are orders; parked otherwise.
 *   growth 0..3  = more stalls, warehouse annex, bunting, more ship berths.
 *
 * The delivery boat and the porter belong to the villagers module.
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S) return;

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
  const ORDERS = typeof SHOP.orders_7d === 'number' && SHOP.orders_7d > 0 ? Math.floor(SHOP.orders_7d) : 0;
  const LOW = Array.isArray(SHOP.low_stock) ? SHOP.low_stock.filter(Boolean) : [];

  /* --------------------------------------------------------------- helpers */
  const sh = CO.shade, mix = CO.mix, rgba = CO.rgba;
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
  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    return [c, g];
  }
  const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const D = (g, x, y, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), 1, 1); };
  const dith = (g, x, y, w, h, c, ph) => { g.fillStyle = c; for (let j = 0; j < h; j++) for (let i = (j + (ph || 0)) & 1; i < w; i += 2) g.fillRect(x + i, y + j, 1, 1); };
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
      // skip the outline pixel itself; snow sits just inside it
      const j = i + w;
      if (y + 1 < h && A[j]) { put(j, sn); if (deep && y + 2 < h && A[j + w] && hash(x, y, 77) < 0.6) put(j + w, hash(x, y, 78) < 0.5 ? sd : sn); }
    }
    g.putImageData(im, 0, 0);
    return c;
  }
  /** Soft drop shadow toward the bottom-right (ellipse, dithered rim). */
  function groundShadow(g, x, y, w, h) {
    g.fillStyle = P.shadow;
    for (let j = 0; j < h; j++) {
      const t = (j + 0.5) / h * 2 - 1, ww = Math.round(w * Math.sqrt(1 - t * t));
      g.fillRect(Math.round(x + (w - ww) / 2), y + j, ww, 1);
    }
  }

  /* Shoreline, matching the terrain module's edge (x where water ends, per pixel row). */
  const edgeX = new Float32Array(S.H);
  (function () {
    const c = [];
    for (let ty = -1; ty <= S.ROWS; ty++) c.push(S.riverEdge(clamp(ty, 0, S.ROWS - 1)) * T);
    for (let y = 0; y < S.H; y++) {
      const t = (y - 8) / T, t0 = Math.floor(t), f = t - t0;
      const a = c[t0 + 1], b = c[t0 + 2];
      edgeX[y] = a + (b - a) * smooth(f) + (vnoise(y / 7, 3.3, 5) - 0.5) * 3;
    }
  })();
  const shore = (y) => edgeX[clamp(Math.round(y), 0, S.H - 1)];

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
  const LAMP = { glass: '#ffd77a', hot: '#fff3c4', warm: '#ffb84d' };
  const FIDGET = ['#e8403d', '#f28a2e', '#f4cf3a', '#56b947', '#3d8fe0', '#8a5ad8', '#ff6fb0', '#3fd3d0'];
  const AWNINGS = [
    ['#cf3b36', '#f4ebd8'], // pop-its (red / cream)
    ['#2a958f', '#f4ebd8'], // spinners: Twirl's flagship (teal / cream)
    ['#e6a12b', '#fff3d6'], // cubes (marigold / cream)
    ['#7c50bd', '#f4ebd8'], // rings & sticks (violet / cream)
    ['#e0683a', '#fff3d6'], // keychains (orange / cream)
  ];

  /* ------------------------------------------------------------- layout (px) */
  const PIER = { x0: 84, x1: 150, y0: 530, y1: 558 };       // main pier (the dock), continues the plank road
  const QUAY = { x0: 134, x1: 172, y0: 560, y1: 640 };      // stone quay along the shore under the crane
  const PLAZA = { x0: 158, x1: 394, y0: 462, y1: 527 };     // bazaar floor (west and east of the plank road)
  const YARD = { x0: 170, x1: 396, y0: 561, y1: 640 };      // cargo yard in front of the warehouse
  const WH = { x0: 286, x1: 388, roof: 520, eave: 542, base: 576, doorX: 322, doorW: 28 }; // warehouse
  const LH = { x: 106, base: 460 };
  const COT = { x: 134, base: 466, w: 46 };                  // Cap'n Twirl's cottage                          // harbour light (centre x, ground y)
  const CRANE = { x: 144, base: 608, top: 514, tipX: 100, backX: 161 };
  const ROAD_X0 = 240, ROAD_X1 = 272;                        // the vertical plank road through the bazaar

  // Stalls: base (counter bottom) and left x. Facing south.
  const STALLS = [
    { x: 166, base: 524, kind: 'popit', aw: 0 },
    { x: 203, base: 524, kind: 'spinner', aw: 1, flagship: true },
    { x: 280, base: 506, kind: 'cube', aw: 2 },
    { x: 317, base: 506, kind: 'rings', aw: 3 },
    { x: 354, base: 506, kind: 'keys', aw: 4 },
  ].filter((s, i) => i < 3 + GROWTH);

  // Ship berths (bow tip x, waterline y). Filled in this order.
  const BERTHS = [
    { x: 80, wl: 592, L: 58, kind: 'steam', hull: '#2c5560', accent: TEAL.light, moor: 'south' },
    { x: 44, wl: 529, L: 48, kind: 'sail', hull: '#33406b', accent: '#e6a12b', moor: 'north' },
    { x: 84, wl: 636, L: 52, kind: 'sail', hull: '#6a2f37', accent: '#f4ebd8', moor: 'quay' },
    { x: 14, wl: 618, L: 46, kind: 'steam', hull: '#3d5a3a', accent: '#ff6fb0', moor: 'anchor' },
  ];
  const maxShips = Math.min(BERTHS.length, 2 + GROWTH);
  const SHIPS = [];
  if (!ORDERS) SHIPS.push(Object.assign({}, BERTHS[0], { cargo: 0, empty: true }));
  else {
    let left = ORDERS;
    for (let i = 0; i < maxShips && left > 0; i++) {
      const n = Math.min(5, left); left -= n;
      SHIPS.push(Object.assign({}, BERTHS[i], { cargo: n, empty: false }));
    }
  }

  // Crate yard: stacks (x, base y, layout) — more with growth. Low-stock items get tagged crates near the door.
  const STACKS = [
    { x: 184, y: 590, k: 'pyr' }, { x: 214, y: 606, k: 'two' }, { x: 186, y: 628, k: 'row' },
    { x: 292, y: 600, k: 'pyr' }, { x: 362, y: 598, k: 'two' },
    { x: 226, y: 634, k: 'pyr' }, { x: 300, y: 630, k: 'row' }, { x: 368, y: 628, k: 'pyr' },
  ].slice(0, 5 + GROWTH);
  const TAGGED = LOW.slice(0, 5).map((name, i) => ({ name, x: 252 + (i % 3) * 13 + (i >= 3 ? 6 : 0), y: 592 + (i >= 3 ? 14 : 0) }));

  /* Reserve the tiles we build on (terrain decor keeps off them). */
  (function reserveAll() {
    const res = (x0, y0, x1, y1) => {
      for (let ty = Math.floor(y0 / T); ty <= Math.floor((y1 - 1) / T); ty++)
        for (let tx = Math.floor(x0 / T); tx <= Math.floor((x1 - 1) / T); tx++) if (!S.onRoad(tx, ty)) S.reserve(tx, ty);
    };
    res(PIER.x0, PIER.y0, PIER.x1, PIER.y1 + 8);
    res(QUAY.x0, QUAY.y0, QUAY.x1, QUAY.y1);
    res(PLAZA.x0, PLAZA.y0 - 16, PLAZA.x1, PLAZA.y1);
    res(YARD.x0, YARD.y0, YARD.x1, YARD.y1);
    res(WH.x0 - 16, WH.roof - 4, WH.x1 + 4, WH.base + 4);
    res(LH.x - 18, LH.base - 64, LH.x + 30, LH.base + 4);
    res(COT.x, COT.base - 46, COT.x + COT.w, COT.base + 2); // Twirl's cottage
    res(184, 440, 212, 476);                               // net rack and barrels
    res(112, 468, 132, 488);                               // notice board
  })();

  /* ====================================================================
   * Fidgets (tiny, drawn into stall sprites)
   * ================================================================== */
  /** 3x3 spinner for counters and shelves. */
  function spinner(g, x, y, col) {
    D(g, x + 1, y, sh(col, 0.3)); D(g, x, y + 2, sh(col, -0.3)); D(g, x + 2, y + 2, col); D(g, x + 1, y + 1, P.gold);
  }
  /** 5x5 tri-lobe spinner seen from above: three coloured lobes around a gold bearing. */
  function spinnerIcon(g, x, y, col) {
    spr(g, ['.lal.', '..a..', '.agd.', 'ad.da', 'd...d'], x, y, { a: col, l: sh(col, 0.35), d: sh(col, -0.3), g: P.gold });
  }
  function cube(g, x, y, a, b) { // 4x4 infinity / puzzle cube
    R(g, x, y, 4, 4, sh(a, -0.35));
    R(g, x, y, 2, 2, sh(a, 0.25)); R(g, x + 2, y, 2, 2, sh(b, 0.25));
    R(g, x, y + 2, 2, 2, b); R(g, x + 2, y + 2, 2, 2, a);
    D(g, x, y, sh(a, 0.5));
  }
  function popit(g, x, y, w, h) { // rainbow bubble grid
    for (let j = 0; j < h; j++) {
      const c = FIDGET[((j * 6) / h) | 0];
      for (let i = 0; i < w; i++) D(g, x + i, y + j, (i + j) & 1 ? sh(c, -0.18) : sh(c, 0.18));
    }
  }

  /* ====================================================================
   * Bazaar stall sprite (36 x 44), local origin: left = 0, base = 43
   * ================================================================== */
  const STALL_W = 36, STALL_H = 44;
  function buildStall(st, season) {
    const W = STALL_W, H = STALL_H;
    const [c, g] = mk(W + 2, H + 2);
    g.translate(1, 1);
    const [A, B] = AWNINGS[st.aw];
    const POST = WOOD;
    const ctop = 29; // counter top row
    // back wall (inside the stall, deep shade under the awning)
    for (let y = 10; y < ctop; y++) R(g, 2, y, W - 4, 1, mix('#2a1c16', '#5a3c27', (y - 10) / (ctop - 10)));
    for (let x = 5; x < W - 4; x += 6) R(g, x, 13, 1, ctop - 13, '#3a281c');
    // shelf
    R(g, 3, 20, W - 6, 2, WOOD.mid); R(g, 3, 20, W - 6, 1, WOOD.light); R(g, 3, 22, W - 6, 1, '#24180f');
    // posts
    for (const px of [0, W - 2]) { R(g, px, 8, 2, H - 8, POST.base); R(g, px, 8, 1, H - 8, POST.light); R(g, px + 1, 8, 1, H - 8, POST.dark); }
    // goods: hanging row (y 12..18) and shelf row (y 16..20)
    if (st.kind === 'popit') {
      for (let i = 0; i < 4; i++) { R(g, 7 + i * 7, 11, 1, 2, '#c9b07a'); popit(g, 5 + i * 7, 13, 5, 6); }
      for (let i = 0; i < 6; i++) { const cc = FIDGET[i]; R(g, 5 + i * 4, 18, 3, 2, cc); D(g, 5 + i * 4, 18, sh(cc, 0.4)); }
    } else if (st.kind === 'spinner') {
      for (let i = 0; i < 5; i++) { R(g, 6 + i * 6, 11, 1, 3, '#c9b07a'); spinnerIcon(g, 4 + i * 6, 13, FIDGET[(i * 2) % 8]); }
      for (let i = 0; i < 7; i++) spinner(g, 4 + i * 4, 17, FIDGET[(i + 3) % 8], true);
    } else if (st.kind === 'cube') {
      for (let i = 0; i < 5; i++) cube(g, 5 + i * 5, 12, FIDGET[(i + 5) % 8], FIDGET[(i + 1) % 8]);
      for (let i = 0; i < 6; i++) cube(g, 4 + i * 5, 16, FIDGET[i % 8], FIDGET[(i + 3) % 8]);
    } else if (st.kind === 'rings') {
      for (let i = 0; i < 9; i++) R(g, 4 + i * 3, 12 + (i & 1), 1, 6, FIDGET[(i * 3) % 8]); // fidget sticks
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
    // a little chalk slate hung on the drape (a price line and a coin)
    R(g, W - 12, ctop + 6, 9, 6, '#3a2a1e'); R(g, W - 11, ctop + 7, 7, 4, '#2c3a34');
    R(g, W - 10, ctop + 8, 4, 1, '#d8e0d0'); D(g, W - 6, ctop + 9, P.gold); D(g, W - 10, ctop + 9, '#9fb0a0');
    // goods on the counter
    if (st.kind === 'popit') { popit(g, 4, ctop - 4, 7, 4); popit(g, 13, ctop - 3, 5, 3); popit(g, 20, ctop - 4, 6, 4); spinner(g, 28, ctop - 3, FIDGET[4], true); }
    else if (st.kind === 'spinner') {
      for (let i = 0; i < 4; i++) spinner(g, 3 + i * 4, ctop - 3, FIDGET[(i * 3) % 8], true);
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
    if (season === 'winter') snowCap(c, true);
    return c;
  }

  /* ====================================================================
   * Crates, barrels, sacks
   * ================================================================== */
  const crateCache = {};
  function crate(w, h, v, open, season) {
    const key = [w, h, v, open || '', season].join(',');
    if (crateCache[key]) return crateCache[key];
    const [c, g] = mk(w + 2, h + 2);
    g.translate(1, 1);
    const tones = [
      { b: '#b07e48', l: '#cd9c62', d: '#7f5630', t: '#d8ad75' },
      { b: '#a4743f', l: '#c18e55', d: '#734c29', t: '#d2a46b' },
      { b: '#9a7a52', l: '#b9976a', d: '#6a5236', t: '#c9ab80' },
    ][v % 3];
    const top = Math.max(2, Math.round(h * 0.28));
    // front face
    R(g, 0, top, w, h - top, tones.b);
    for (let y = top + 2; y < h; y += 3) R(g, 1, y, w - 2, 1, tones.d);
    R(g, 0, top, w, 1, tones.l); R(g, 0, top, 1, h - top, tones.l);
    R(g, w - 1, top, 1, h - top, tones.d); R(g, 0, h - 1, w, 1, tones.d);
    // frame + brace
    if (w >= 8) { for (let i = 1; i < w - 1; i++) { const y = top + 1 + Math.round((i - 1) * (h - top - 3) / (w - 3)); D(g, i, y, tones.d); } }
    // top face
    if (open) {
      R(g, 0, 0, w, top, tones.t); R(g, 1, 1, w - 2, top - 1, '#3a2716');
      if (open === 'full') for (let i = 1; i < w - 1; i++) D(g, i, 1 + ((i * 7) % Math.max(1, top - 1)), FIDGET[(i + v) % 8]);
      if (open === 'low') D(g, 2, top - 1, FIDGET[(v + 2) % 8]);
    } else {
      R(g, 0, 0, w, top, tones.t);
      for (let x = 2; x < w; x += 3) R(g, x, 0, 1, top, tones.l);
      R(g, 0, 0, w, 1, sh(tones.t, 0.25));
    }
    // stencil mark: a tiny spinner on bigger crates
    if (w >= 10 && !open) { D(g, (w >> 1), top + 2, '#5a3a1a'); D(g, (w >> 1) - 1, top + 4, '#5a3a1a'); D(g, (w >> 1) + 1, top + 4, '#5a3a1a'); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    outline(c, '#2a1c12');
    if (season === 'winter') snowCap(c, false);
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
  function buildWarehouse(season) {
    const x0 = WH.x0 - 4, y0 = WH.roof - 14;
    const W = WH.x1 - WH.x0 + 8, H = WH.base - y0 + 2;
    const [c, g] = mk(W + 2, H + 2);
    const L = (x, y) => [x - x0 + 1, y - y0 + 1];
    const rect = (x, y, w, h, col) => { const [a, b] = L(x, y); R(g, a, b, w, h, col); };
    const dot = (x, y, col) => { const [a, b] = L(x, y); D(g, a, b, col); };
    const winter = season === 'winter';
    // brick front wall
    for (let y = WH.eave; y < WH.base; y++) for (let x = WH.x0; x < WH.x1; x++) {
      const row = (y - WH.eave) / 4 | 0, off = row & 1 ? 4 : 0;
      const mortarH = (y - WH.eave) % 4 === 3, mortarV = (x - WH.x0 + off) % 8 === 7;
      let col = BRICK.base;
      const n = hash((x - WH.x0 + off) >> 3, row, 9);
      if (n < 0.2) col = BRICK.dark; else if (n > 0.85) col = BRICK.light;
      if (mortarH || mortarV) col = BRICK.mortar;
      if (y < WH.eave + 4) col = mix(col, '#2a1610', 0.45); // shade under the eaves
      if (x < WH.x0 + 2 && !mortarH && !mortarV) col = sh(col, 0.08);
      if (x > WH.x1 - 3 && !mortarH && !mortarV) col = sh(col, -0.15);
      dot(x, y, col);
    }
    // stone foundation
    rect(WH.x0, WH.base - 4, WH.x1 - WH.x0, 4, STONE.base);
    rect(WH.x0, WH.base - 4, WH.x1 - WH.x0, 1, STONE.light);
    for (let x = WH.x0; x < WH.x1; x += 7) rect(x, WH.base - 4, 1, 4, STONE.dark);
    // corner pilasters
    for (const px of [WH.x0, WH.x1 - 3]) { rect(px, WH.eave, 3, WH.base - WH.eave - 4, BRICK.dark); rect(px, WH.eave, 1, WH.base - WH.eave - 4, BRICK.light); }
    // big double doors, slid open: crates inside in the gloom
    const dx = WH.doorX, dw = WH.doorW, dt = WH.base - 24;
    rect(dx, dt, dw, 24, '#1a1310');
    for (let y = dt; y < WH.base; y++) rect(dx, y, dw, 1, mix('#120d0b', '#3a2a1e', (y - dt) / 24));
    // silhouettes of stacked crates and a lamp-lit aisle inside
    const inside = [[dx + 2, WH.base - 10, 8, 10], [dx + 4, WH.base - 17, 6, 7], [dx + dw - 10, WH.base - 12, 8, 12], [dx + dw - 9, WH.base - 18, 6, 6]];
    for (const [ix, iy, iw, ih] of inside) { rect(ix, iy, iw, ih, '#4a3420'); rect(ix, iy, iw, 1, '#6a4c30'); rect(ix, iy, 1, ih, '#5a4028'); }
    rect(dx + 12, WH.base - 2, 4, 2, '#5a4430');
    // sliding door leaves pushed to the sides (planked, with an X brace)
    for (const lx of [dx - 12, dx + dw]) {
      rect(lx, dt, 12, 24, WOOD.mid);
      for (let i = 0; i < 12; i += 3) rect(lx + i, dt, 1, 24, WOOD.dark);
      rect(lx, dt, 12, 1, WOOD.light); rect(lx, dt + 11, 12, 1, WOOD.dark); rect(lx, dt, 1, 24, WOOD.light);
      for (let i = 0; i < 11; i++) { dot(lx + i, dt + 1 + i, WOOD.light); dot(lx + i, dt + 22 - i, WOOD.light); }
    }
    rect(dx - 14, dt - 2, dw + 28, 2, IRON.dark); rect(dx - 14, dt - 2, dw + 28, 1, IRON.light); // door rail
    // windows with shutters
    const wins = [[WH.x0 + 6, WH.eave + 10], [WH.x1 - 18, WH.eave + 10]];
    for (const [wx, wy] of wins) {
      rect(wx - 1, wy - 1, 14, 12, STONE.light);
      rect(wx, wy, 12, 10, '#2a3448');
      rect(wx + 1, wy + 1, 10, 8, '#3d5878'); rect(wx + 1, wy + 1, 4, 3, '#6d8fb3'); dot(wx + 1, wy + 1, '#a9c6e0');
      rect(wx + 5, wy, 1, 10, '#2a3448'); rect(wx, wy + 4, 12, 1, '#2a3448');
      rect(wx - 1, wy + 10, 14, 2, STONE.base); rect(wx - 1, wy + 10, 14, 1, STONE.hi);
    }
    // sign board over the door: a crate with a spinner
    const sx = dx + dw / 2 - 9, sy = dt - 10;
    rect(sx, sy, 18, 9, '#3a2416'); rect(sx + 1, sy + 1, 16, 7, '#e8d7b0'); rect(sx + 1, sy + 1, 16, 1, '#fff2d0');
    rect(sx + 4, sy + 3, 5, 4, '#b07e48'); rect(sx + 4, sy + 3, 5, 1, '#d8ad75');
    dot(sx + 12, sy + 3, TEAL.base); dot(sx + 11, sy + 5, TEAL.base); dot(sx + 13, sy + 5, TEAL.base); dot(sx + 12, sy + 4, P.gold);
    // wall lamp beside the door
    rect(dx + dw + 14, dt + 2, 1, 3, IRON.dark); rect(dx + dw + 13, dt + 4, 3, 4, LAMP.glass); dot(dx + dw + 13, dt + 4, LAMP.hot); rect(dx + dw + 13, dt + 3, 3, 1, IRON.dark);
    // downspouts
    for (const px of [WH.x0 + 1, WH.x1 - 2]) { rect(px, WH.eave, 1, WH.base - WH.eave - 2, IRON.base); rect(px - 1, WH.base - 3, 3, 1, IRON.dark); }
    // ---- slate roof (ridge east-west), seen as its front slope
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
    rect(WH.x0 - 3, rY0 - 2, WH.x1 - WH.x0 + 6, 2, SLATE.hi); rect(WH.x0 - 3, rY0 - 2, WH.x1 - WH.x0 + 6, 1, '#a9b8d4'); // ridge cap
    rect(WH.x0 - 4, rY1 - 1, WH.x1 - WH.x0 + 8, 2, SLATE.deep); // eave line
    rect(WH.x0 - 4, rY1, WH.x1 - WH.x0 + 8, 1, '#141824');
    // roof vents
    for (const vx of [WH.x0 + 12, WH.x1 - 18]) {
      rect(vx, rY0 + 2, 6, 6, IRON.base); rect(vx, rY0 + 2, 6, 1, IRON.hi); rect(vx - 1, rY0 + 1, 8, 2, IRON.dark); rect(vx + 5, rY0 + 3, 1, 5, IRON.dark);
    }
    // cross gable (centred over the door) with the loft door and a hoist beam
    const gx = dx + dw / 2, gTop = rY0 - 6, gBase = rY1 + 1, half = 18;
    for (let y = gTop; y < gBase; y++) {
      const hw = Math.min(half, Math.round((y - gTop) * 1.15) + 1);
      for (let x = gx - hw; x < gx + hw; x++) {
        const edge = x <= gx - hw + 2 || x >= gx + hw - 3;
        let col;
        if (edge) col = x < gx ? SLATE.light : SLATE.dark; // the gable's own roof edges
        else {
          col = (x - gx + 40) % 4 === 0 ? '#6a4a30' : '#8b6440'; // weatherboarding
          if ((y - gTop) % 4 === 0) col = '#5a3e28';
          if (x < gx - hw + 5) col = sh(col, 0.1);
        }
        dot(x, y, col);
      }
    }
    for (let y = gTop; y < gBase; y++) { const hw = Math.min(half, Math.round((y - gTop) * 1.15) + 1); dot(gx - hw - 1, y, SLATE.hi); dot(gx + hw, y, SLATE.deep); }
    // loft door (open) and hoist beam with a pulley, rope and a hanging crate
    rect(gx - 5, gTop + 12, 10, 14, '#2a1c14'); rect(gx - 5, gTop + 12, 10, 1, '#5a3e28'); rect(gx - 6, gTop + 26, 12, 2, WOOD.light);
    rect(gx - 3, gTop + 18, 6, 8, '#4a3420'); rect(gx - 3, gTop + 18, 6, 1, '#6a4c30');
    rect(gx - 1, gTop + 4, 3, 2, WOOD.dark); rect(gx - 1, gTop + 2, 3, 2, WOOD.base);
    rect(gx, gTop + 6, 1, 7, ROPE.dark);
    g.translate(0, 0);
    // window rose on the gable
    rect(gx - 2, gTop + 6, 4, 4, '#2a3448'); dot(gx - 1, gTop + 7, '#6d8fb3');
    outline(c, OUT);
    if (winter) {
      snowCap(c, true);
      // thick snow on the roof slope
      for (let y = rY0; y < rY0 + 6; y++) for (let x = WH.x0 - 3; x < WH.x1 + 3; x++) {
        if (y > rY0 + 3 && hash(x, y, 31) < 0.5) continue;
        if (x > gx - half - 1 && x < gx + half && y > gTop) continue;
        const [a, b] = L(x, y); D(g, a, b, (y - rY0) > 2 && bay(x, y) < 0.3 ? '#c9d6e0' : P.snow);
      }
    }
    return { c, ox: x0 - 1, oy: y0 - 1 };
  }

  /* Warehouse annex (growth >= 2): a lean-to shed on the west side, open front with crates. */
  function buildAnnex(season) {
    const W = 14, H = 30;
    const [c, g] = mk(W + 2, H + 2);
    g.translate(1, 1);
    for (let y = 0; y < 8; y++) R(g, 0, y, W, 1, y < 2 ? SLATE.light : y === 7 ? SLATE.deep : (y & 1 ? SLATE.dark : SLATE.base));
    R(g, 0, 8, W, H - 8, '#2a1c14');
    R(g, 0, 8, 2, H - 8, WOOD.base); R(g, W - 2, 8, 2, H - 8, WOOD.dark);
    for (let i = 0; i < 2; i++) { R(g, 3 + i * 5, H - 7, 5, 7, '#9a6c3e'); R(g, 3 + i * 5, H - 7, 5, 1, '#c9975c'); }
    R(g, 5, H - 12, 5, 5, '#a4743f'); R(g, 5, H - 12, 5, 1, '#d2a46b');
    g.setTransform(1, 0, 0, 1, 0, 0);
    outline(c, OUT);
    if (season === 'winter') snowCap(c, true);
    return c;
  }

  /* ====================================================================
   * Cap'n Twirl's cottage (his home by the bazaar)
   * ================================================================== */
  function buildCottage(season) {
    const W = COT.w, H = 46;
    const [c, g] = mk(W + 2, H + 2);
    g.translate(1, 1);
    const SID = { d: '#55728a', b: '#6f8ea6', l: '#8eaabf', hi: '#b4cad8' }, TRIM = '#efe8d6';
    const ROOF = { d: '#6a2a22', b: '#8f3c2c', l: '#b5553c', hi: '#d27a58' };
    const wallTop = 20, base = H - 1;
    // chimney (behind the roof)
    R(g, W - 13, 2, 6, 12, '#5a2a20'); R(g, W - 12, 2, 4, 12, BRICK.base); R(g, W - 12, 2, 1, 12, BRICK.light);
    R(g, W - 13, 1, 6, 2, STONE.light); R(g, W - 12, 6, 4, 1, BRICK.mortar);
    // clapboard walls
    for (let y = wallTop; y <= base; y++) for (let x = 1; x < W - 1; x++) {
      let col = (y - wallTop) % 3 === 2 ? SID.d : SID.b;
      if ((y - wallTop) % 3 === 0) col = SID.l;
      if (x < 4) col = sh(col, 0.08);
      if (x > W - 5) col = sh(col, -0.15);
      if (y < wallTop + 3) col = mix(col, '#1e2a36', 0.4); // eave shadow
      D(g, x, y, col);
    }
    R(g, 1, wallTop, 2, base - wallTop + 1, TRIM); R(g, W - 3, wallTop, 2, base - wallTop + 1, '#c9c1ad'); // corner boards
    R(g, 1, base - 2, W - 2, 3, STONE.base); R(g, 1, base - 2, W - 2, 1, STONE.light); // sill stones
    // door (teal) with a porthole light and a ship's wheel above
    const dx = 12;
    R(g, dx - 1, wallTop + 8, 10, base - wallTop - 8, TRIM);
    R(g, dx, wallTop + 9, 8, base - wallTop - 11, TEAL.dark); R(g, dx + 1, wallTop + 10, 6, base - wallTop - 13, TEAL.base);
    R(g, dx + 1, wallTop + 10, 1, base - wallTop - 13, TEAL.light);
    R(g, dx + 3, wallTop + 11, 2, 2, '#9cc0dc'); D(g, dx + 6, wallTop + 17, P.gold);
    // ship's wheel sign
    const wx = dx + 4, wy = wallTop + 4;
    for (let a = 0; a < 8; a++) { const ang = a * Math.PI / 4; D(g, Math.round(wx + Math.cos(ang) * 3), Math.round(wy + Math.sin(ang) * 3), WOOD.dark); }
    for (const [ox, oy] of [[0, -2], [0, 2], [-2, 0], [2, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]]) D(g, wx + ox, wy + oy, WOOD.light);
    D(g, wx, wy, P.gold);
    // porthole window (brass rim) and a square window with a flower box
    const px = 29, py = wallTop + 9;
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
      const d = x * x + y * y;
      if (d <= 10) D(g, px + x, py + y, d >= 6 ? (x + y < 0 ? '#f2d27a' : P.goldDark) : (x + y < -1 ? '#9cc0dc' : '#3d5878'));
    }
    D(g, px - 1, py - 1, '#d8ecf8');
    R(g, 36, wallTop + 6, 6, 6, TRIM); R(g, 37, wallTop + 7, 4, 4, '#3d5878'); D(g, 37, wallTop + 7, '#9cc0dc'); R(g, 39, wallTop + 7, 1, 4, TRIM);
    R(g, 35, wallTop + 12, 8, 2, WOOD.mid); D(g, 36, wallTop + 11, '#e8403d'); D(g, 38, wallTop + 11, P.gold); D(g, 40, wallTop + 11, '#ff6fb0'); D(g, 37, wallTop + 11, '#56b947'); D(g, 41, wallTop + 11, '#56b947');
    // tiled roof (ridge east-west), front slope
    for (let y = 4; y < wallTop + 1; y++) {
      const ov = Math.round((y - 4) * 0.25);
      for (let x = -1 - ov + 2; x < W + ov - 1; x++) {
        const row = (y - 4) / 3 | 0, off = row & 1 ? 2 : 0;
        const ky = (y - 4) % 3, kx = (x + off + 40) % 4;
        let col = ROOF.b;
        if (ky === 2) col = ROOF.d; else if (kx === 3) col = ROOF.d; else if (ky === 0 && kx === 0) col = ROOF.l;
        if (hash((x + off) >> 2, row, 33) < 0.15 && ky !== 2) col = ROOF.l;
        if (y < 6) col = mix(col, ROOF.hi, 0.4);
        if (x < 3 - ov) col = sh(col, 0.1);
        D(g, x, y, col);
      }
    }
    R(g, 0, 3, W, 2, ROOF.hi); R(g, 0, 3, W, 1, '#e8a080'); // ridge
    R(g, -1, wallTop, W + 2, 1, ROOF.d);
    // weathervane: a little fish on the ridge
    R(g, 8, -3, 1, 6, IRON.dark); spr(g, ['.kk.k', 'kkkkk', '.kk.k'], 6, -6, { k: IRON.base });
    // anchor leaning on the wall, pot plant by the door
    spr(g, ['.i.', 'iii', '.i.', '.i.', '.i.', 'i.i', '.i.'], W - 9, base - 9, { i: IRON.base });
    R(g, 4, base - 5, 5, 4, '#a8563a'); R(g, 4, base - 5, 5, 1, '#c87452'); R(g, 5, base - 8, 3, 3, '#4f8f33'); D(g, 6, base - 9, '#e8403d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    outline(c, OUT);
    if (season === 'winter') {
      snowCap(c, true);
      const g2 = c.getContext('2d');
      for (let y = 5; y < 10; y++) for (let x = 1; x < W + 1; x++) if (!(y > 7 && hash(x, y, 34) < 0.5)) D(g2, x + 1, y + 1, (y > 7 && bay(x, y) < 0.3) ? '#c9d6e0' : P.snow);
    }
    return c;
  }

  /* ====================================================================
   * Harbour light (small lighthouse on a rocky point)
   * ================================================================== */
  function buildLighthouse(season) {
    const W = 40, H = 66;
    const [c, g] = mk(W + 2, H + 2);
    g.translate(1, 1);
    const cx = 20, base = H - 1;
    // rocks
    const rocks = [[6, base - 3, 7, 4], [27, base - 2, 7, 4], [12, base - 1, 6, 3], [22, base, 8, 3], [3, base, 6, 3], [31, base + 1, 5, 2]];
    for (const [x, y, rx, ry] of rocks) {
      ellipse(g, x, y - 1, rx, ry, STONE.dark); ellipse(g, x - 1, y - 2, rx - 1, ry - 1, STONE.base);
      ellipse(g, x - 2, y - 3, Math.max(1, rx - 4), Math.max(1, ry - 2), STONE.light);
      D(g, x + 1, y - ry, STONE.moss); D(g, x + 2, y - ry, STONE.moss);
    }
    // tower: tapered, white with red bands
    const top = 18, bot = base - 4;
    for (let y = top; y <= bot; y++) {
      const t = (y - top) / (bot - top), hw = Math.round(5 + t * 3);
      const band = ((y - top) / 9 | 0) % 2 === 1;
      for (let x = cx - hw; x < cx + hw; x++) {
        const u = (x - (cx - hw)) / (2 * hw);
        const base = band ? RED.base : '#f2eee4';
        let col = u < 0.25 ? sh(base, 0.12) : u > 0.72 ? sh(base, -0.18) : base;
        if (u > 0.86) col = sh(base, -0.32);
        D(g, x, y, col);
      }
    }
    // door and window
    R(g, cx - 2, bot - 6, 4, 7, '#2a2230'); R(g, cx - 2, bot - 7, 4, 1, '#5a4a5a'); D(g, cx + 1, bot - 3, P.gold);
    R(g, cx - 1, top + 12, 2, 3, '#2a3448'); D(g, cx - 1, top + 12, '#6d8fb3');
    // gallery
    R(g, cx - 9, top - 3, 18, 3, IRON.dark); R(g, cx - 9, top - 3, 18, 1, IRON.light);
    for (let x = cx - 9; x < cx + 9; x += 2) D(g, x, top - 5, IRON.base);
    R(g, cx - 9, top - 6, 18, 1, IRON.base);
    // lantern room
    R(g, cx - 5, top - 13, 10, 8, IRON.deep);
    R(g, cx - 4, top - 12, 8, 7, LAMP.glass); R(g, cx - 4, top - 12, 3, 7, LAMP.hot);
    R(g, cx - 1, top - 12, 1, 7, IRON.dark); R(g, cx + 2, top - 12, 1, 7, IRON.dark);
    // cap
    for (let y = 0; y < 5; y++) R(g, cx - 6 + y, top - 18 + y, 12 - 2 * y, 1, '#2a2230');
    R(g, cx - 6, top - 14, 12, 1, RED.dark);
    for (let y = 0; y < 4; y++) R(g, cx - 5 + y, top - 17 + (3 - y), 10 - 2 * y, 1, y === 3 ? RED.light : RED.base);
    R(g, cx, top - 20, 1, 3, IRON.base); D(g, cx, top - 21, P.gold);
    g.setTransform(1, 0, 0, 1, 0, 0);
    outline(c, OUT);
    if (season === 'winter') snowCap(c, true);
    return { c, ox: LH.x - cx - 1, oy: LH.base - base - 1, lamp: { x: LH.x, y: LH.base - base + top - 9 } };
  }

  /* ====================================================================
   * Ships (entities). Local origin: bow tip x, waterline y.
   * ================================================================== */
  const SHIP_OX = 8, SHIP_OY = 54;
  function buildShip(s, season) {
    const L = s.L, W = L + 16, H = SHIP_OY + 7;
    const [c, g] = mk(W, H);
    const X = (x) => x + SHIP_OX, Y = (y) => y + SHIP_OY;
    const rect = (x, y, w, h, col) => R(g, X(x), Y(y), w, h, col);
    const dot = (x, y, col) => D(g, X(x), Y(y), col);
    const ride = s.empty ? 2 : 0; // an empty ship rides high: the red bottom shows
    const hull = s.hull, hullD = sh(hull, -0.3), hullL = sh(hull, 0.2), trim = '#ece3cc', trimD = '#bfb398';
    const sideH = 7;
    const deckY1 = -sideH - ride, deckY0 = deckY1 - 12;
    const midY = (deckY0 + deckY1) / 2, half = (deckY1 - deckY0) / 2 + 0.5;
    const deckRow = (y) => {
      const t = Math.abs(y - midY) / half;
      return [Math.round(11 * Math.pow(t, 1.6)), L - 1 - Math.round(3.5 * t * t)];
    };
    // reflection on the water (dark, offset to the right)
    g.fillStyle = 'rgba(14,28,50,0.30)';
    for (let y = 1; y <= 4; y++) g.fillRect(X(9 + y), Y(y), L - 13 - y * 2, 1);
    // hull side, from the deck edge down to the waterline
    const top = deckY1 + 1;
    for (let y = top; y <= 0; y++) {
      const k = y - top;
      const l = Math.round(4 + k * 0.9), r = L - 2 - Math.round(k * 0.45);
      for (let x = l; x <= r; x++) {
        let col;
        if (k === 0) col = trim;
        else if (y > -ride) col = (x + y) & 1 ? '#a8392c' : '#b8452f';      // antifouling, showing because she's empty
        else if (y === -ride) col = s.empty ? '#ece3cc' : sh(hull, -0.42); // boot stripe or water contact
        else if (k === 1) col = hullL;
        else col = k % 3 === 0 ? hullD : hull;
        const u = (x - l) / Math.max(1, r - l);
        if (k > 0 && y <= -ride - 1) { if (u < 0.12) col = sh(col, 0.12); else if (u > 0.9) col = sh(col, -0.18); }
        dot(x, y, col);
      }
      dot(l - 1, y, OUT); // crisp stem line
    }
    // a white sheer stripe and portholes
    for (let x = 6; x < L - 4; x++) dot(x, top + 2, s.kind === 'steam' ? sh(trim, -0.05) : s.accent);
    if (s.kind === 'steam') for (let x = L - 24; x < L - 5; x += 5) { dot(x, top + 4, '#16202c'); dot(x + 1, top + 4, '#8fb0c8'); }
    // deck: planks running fore and aft, bulwark rim in the trim colour
    for (let y = deckY0; y <= deckY1; y++) {
      const [l, r] = deckRow(y);
      for (let x = l; x <= r; x++) {
        let col = (y - deckY0) % 2 ? '#c99a66' : '#bb8b56';
        if ((x + (y - deckY0) * 7) % 13 === 0) col = '#a07043';
        const [pl, pr] = deckRow(y - 1), [nl, nr] = deckRow(y + 1);
        const rim = x === l || x === r || y === deckY0 || y === deckY1 || x < pl || x > pr || x < nl || x > nr;
        if (rim) col = y > midY ? trim : trimD;
        else if (y === deckY0 + 1 || x === l + 1) col = '#8a6238'; // shadow inside the far bulwark
        dot(x, y, col);
      }
    }
    // bowsprit
    for (let i = 1; i < 7; i++) dot(-i + 1, Math.round(midY) - 1 - (i >> 1), i === 6 ? WOOD.light : WOOD.dark);
    const mid = Math.round(midY);
    // cargo hatch and cargo (one crate per order)
    const hx0 = s.kind === 'steam' ? 13 : 9, hx1 = s.kind === 'steam' ? L - 26 : Math.round(L * 0.48) - 2;
    rect(hx0, mid - 3, hx1 - hx0, 7, '#5a3e24'); rect(hx0, mid - 3, hx1 - hx0, 1, '#7d5a36');
    rect(hx0 + 1, mid - 2, hx1 - hx0 - 2, 5, s.cargo ? '#3a2716' : '#140d09');
    if (s.empty) { // hold open and bare, hatch boards stacked aside
      rect(hx0 + 1, mid + 2, hx1 - hx0 - 2, 1, '#2a1c12');
      rect(hx1 + 1, mid - 2, 5, 4, '#8b6440'); rect(hx1 + 1, mid - 2, 5, 1, '#b38a5a'); rect(hx1 + 1, mid, 5, 1, '#6a4a30');
    }
    const slots = [[0, 0], [7, 0], [14, 0], [3, -5], [10, -5]];
    for (let i = 0; i < s.cargo; i++) {
      const [sx, sy] = slots[i];
      const cx0 = hx0 + 1 + sx, cy = mid + 3 + sy;
      if (cx0 + 7 > hx1 + 6) continue;
      const tone = ['#b07e48', '#c99a5a', '#9a8a5a'][i % 3];
      rect(cx0, cy - 7, 8, 8, '#2a1c12');
      rect(cx0 + 1, cy - 6, 6, 2, sh(tone, 0.28)); rect(cx0 + 1, cy - 4, 6, 4, tone);
      rect(cx0 + 1, cy - 4, 1, 4, sh(tone, 0.12)); rect(cx0 + 6, cy - 4, 1, 4, sh(tone, -0.25));
      dot(cx0 + 3, cy - 2, sh(tone, -0.4)); dot(cx0 + 4, cy - 2, sh(tone, -0.4));
    }
    let smoke = null;
    const mastCol = '#7a5230', mastL = '#b07a48';
    if (s.kind === 'steam') {
      // wheelhouse at the stern: front wall, windows, red roof
      const cx0 = L - 22, cx1 = L - 6;
      rect(cx0 - 1, mid - 11, cx1 - cx0 + 2, 15, OUT);
      rect(cx0, mid - 5, cx1 - cx0, 8, '#ece6d6'); rect(cx0, mid - 5, 2, 8, '#fffaf0'); rect(cx1 - 2, mid - 5, 2, 8, '#c9c1ad');
      rect(cx0, mid + 2, cx1 - cx0, 1, '#a9a18d');
      for (let x = cx0 + 3; x < cx1 - 2; x += 4) { rect(x, mid - 3, 2, 2, '#3d5878'); dot(x, mid - 3, '#9cc0dc'); }
      rect(cx0 + 1, mid - 1, 2, 3, '#7a4a2a'); // door
      rect(cx0 - 1, mid - 11, cx1 - cx0 + 2, 6, '#a8402e'); rect(cx0 - 1, mid - 11, cx1 - cx0 + 2, 2, '#cf5a43'); rect(cx0 - 1, mid - 6, cx1 - cx0 + 2, 1, '#6a2a20');
      rect(cx0 + 1, mid - 10, 3, 1, '#e8806a');
      // funnel: buff with a black top and a ship-colour band
      const fx = cx0 + 8;
      rect(fx - 1, mid - 24, 8, 14, OUT);
      rect(fx, mid - 23, 6, 13, '#d98a2b'); rect(fx, mid - 23, 2, 13, '#f0aa4a'); rect(fx + 5, mid - 23, 1, 13, '#a8661e');
      rect(fx, mid - 23, 6, 3, '#24202a'); rect(fx, mid - 23, 2, 3, '#3a3640');
      rect(fx, mid - 17, 6, 2, s.accent); rect(fx, mid - 17, 2, 2, sh(s.accent, 0.3));
      smoke = { x: fx + 3, y: mid - 25 };
      // foremast with a cargo boom swung over the hatch
      const mx = 9;
      rect(mx - 1, mid - 31, 4, 30, OUT); rect(mx, mid - 30, 2, 29, mastCol); rect(mx, mid - 30, 1, 29, mastL);
      rect(mx - 2, mid - 24, 6, 1, OUT); rect(mx - 1, mid - 24, 4, 1, mastCol);
      for (let i = 0; i < 13; i++) dot(mx + 2 + i, mid - 22 + Math.round(i * 0.95), '#4a3220');
      for (let i = 0; i < 16; i++) dot(mx + 2 + i, mid - 29 + Math.round(i * 0.42), '#d2c6a6'); // stay to the funnel
      if (!s.empty) for (let i = 0; i < 7; i++) rect(mx + 2 + i, mid - 31 + (i >> 2), 1, Math.max(1, 3 - (i >> 1)), s.accent);
      rect(L - 3, mid - 3, 2, 2, LAMP.glass);
      if (s.empty) spr(g, ['.ww..', 'wwwwk', '.gg..'], X(mx - 1), Y(mid - 34), { w: '#f6f6f2', k: '#e8a33a', g: '#8c96a0' });
    } else {
      const mx = Math.round(L * 0.5);
      // aft deckhouse
      rect(L - 15, mid - 6, 11, 9, OUT); rect(L - 14, mid - 3, 9, 5, '#8b6440'); rect(L - 14, mid - 5, 9, 2, '#6a4a30'); rect(L - 14, mid - 5, 9, 1, '#a87c50');
      rect(L - 12, mid - 2, 2, 3, '#2a1c14'); rect(L - 8, mid - 2, 2, 2, '#3d5878');
      // mast, boom, gaff
      rect(mx - 1, mid - 43, 4, 44, OUT); rect(mx, mid - 42, 2, 43, mastCol); rect(mx, mid - 42, 1, 43, mastL);
      rect(mx + 2, mid - 5, L - mx - 7, 2, OUT); rect(mx + 2, mid - 5, L - mx - 7, 1, mastL);
      if (s.empty) {
        // sails furled: a lumpy roll of canvas along the boom, jib stowed on the stay
        for (let x = mx + 2; x < L - 6; x++) {
          const hgt = 2 + ((x * 7) % 3 === 0 ? 1 : 0);
          rect(x, mid - 6 - hgt, 1, hgt, x % 5 === 0 ? ROPE.dark : CANVAS.mid); dot(x, mid - 6 - hgt, CANVAS.hi);
        }
        for (let i = 0; i < 20; i++) dot(mx - 1 - Math.round(i * (mx - 3) / 20), mid - 40 + i * 2, '#c9bd9c');
      } else {
        // gaff mainsail with the store's spinner emblem
        for (let y = mid - 38; y < mid - 6; y++) {
          const k = y - (mid - 38), w = Math.min(L - mx - 8, Math.round(10 + k * 0.45));
          for (let x = mx + 2; x < mx + 2 + w; x++) {
            const u = (x - mx - 2) / w;
            let col = u < 0.18 ? CANVAS.hi : u > 0.8 ? CANVAS.dark : CANVAS.base;
            if (u > 0.55 && u <= 0.8 && bay(x, y) < 0.5) col = CANVAS.mid;
            if ((x - mx) % 6 === 0 && u > 0.15) col = sh(col, -0.06);
            if (k === 0 || x === mx + 1 + w) col = CANVAS.dark;
            dot(x, y, col);
          }
          dot(mx + 2 + w, y, OUT);
        }
        for (let i = 0; i < 11; i++) dot(mx + 2 + i, mid - 39, OUT);
        const ex = mx + 10, ey = mid - 22;
        spr(g, ['..a..', '..a..', '..g..', '.a.a.', 'a...a'], X(ex - 2), Y(ey - 2), { a: s.accent === '#f4ebd8' ? RED.base : s.accent, g: P.goldDark });
        // jib
        for (let y = mid - 37; y < mid - 7; y++) {
          const k = (y - (mid - 37)) / 30, l = Math.round(mx - 2 - k * (mx - 4));
          for (let x = l; x < mx - 1; x++) dot(x, y, x === l ? CANVAS.dark : (x > mx - 4 ? CANVAS.mid : CANVAS.base));
          dot(l - 1, y, OUT);
        }
      }
      for (let i = 0; i < 6; i++) rect(mx + 2 + i, mid - 43 + (i >> 2), 1, Math.max(1, 3 - (i >> 1)), s.accent);
      rect(L - 3, mid - 3, 2, 2, LAMP.glass);
    }
    outline(c, OUT);
    if (season === 'winter') snowCap(c, false);
    return { c, mid, deckY0, top, smoke, lamp: { x: L - 2, y: mid - 2 }, hatch: [hx0, hx1] };
  }

  /* ====================================================================
   * Crane (entity). Iron lattice tower on the quay, jib over the berth.
   * ================================================================== */
  function buildCrane(season) {
    const x0 = CRANE.tipX - 4, y0 = CRANE.top - 10, W = CRANE.backX - x0 + 6, H = CRANE.base - y0 + 2;
    const [c, g] = mk(W, H);
    const rect = (x, y, w, h, col) => R(g, x - x0, y - y0, w, h, col);
    const dot = (x, y, col) => D(g, x - x0, y - y0, col);
    const col = { b: '#3f7a72', l: '#64a596', d: '#28504c', hi: '#9ad4c2' };
    const tx = CRANE.x, top = CRANE.top, base = CRANE.base;
    // splayed portal legs on a stone footing
    rect(tx - 7, base - 5, 22, 5, STONE.dark); rect(tx - 6, base - 5, 20, 4, STONE.base); rect(tx - 6, base - 5, 20, 1, STONE.hi);
    for (let y = base - 22; y < base - 5; y++) {
      const k = (y - (base - 22)) / 17, spread = Math.round(k * 5);
      rect(tx - spread, y, 2, 1, col.l); rect(tx + 7 + spread, y, 2, 1, col.d);
    }
    rect(tx - 1, base - 23, 11, 2, col.d); rect(tx - 1, base - 23, 11, 1, col.l);
    for (let i = 0; i < 10; i++) { dot(tx + 1 + i, base - 21 + Math.round(i * 1.6), col.b); dot(tx + 8 - i, base - 21 + Math.round(i * 1.6), col.b); }
    // lattice tower (9 wide)
    for (let y = top + 8; y < base - 23; y++) {
      rect(tx, y, 2, 1, col.l); rect(tx + 7, y, 2, 1, col.d);
      const k = (y - top) % 10;
      dot(tx + 2 + Math.round(k * 0.5), y, col.b);
      dot(tx + 6 - Math.round(k * 0.5), y, col.b);
      if (k === 0) { rect(tx + 2, y, 5, 1, col.b); }
    }
    // operator cab hanging under the jib, west of the tower (looks out over the berth)
    const cy = top + 4;
    rect(tx - 12, cy, 13, 12, OUT);
    rect(tx - 11, cy + 1, 11, 10, '#e2b84a'); rect(tx - 11, cy + 1, 11, 2, '#f6d77a'); rect(tx - 1, cy + 1, 1, 10, '#a8862a');
    rect(tx - 10, cy + 4, 7, 4, '#2f4a66'); rect(tx - 10, cy + 4, 3, 2, '#8fb8d8'); rect(tx - 6, cy + 4, 1, 4, '#e2b84a');
    rect(tx - 11, cy + 10, 11, 1, '#8a6a20');
    // slewing ring
    rect(tx - 2, top + 3, 13, 3, col.d); rect(tx - 2, top + 3, 13, 1, col.hi);
    // jib: a 4 px truss reaching out over the berth
    for (let x = CRANE.tipX; x < tx + 10; x++) {
      dot(x, top - 1, col.hi); dot(x, top, col.l); dot(x, top + 3, col.d);
      const k = (x - CRANE.tipX) % 6;
      dot(x, top + 1 + (k < 3 ? 0 : 1), col.b);
      if (k === 0) rect(x, top, 1, 3, col.b);
    }
    rect(CRANE.tipX - 2, top - 2, 4, 7, OUT); rect(CRANE.tipX - 1, top - 1, 2, 5, col.l); dot(CRANE.tipX - 1, top + 1, IRON.dark); // tip sheave
    // counter-jib with the counterweight (short, east of the tower)
    rect(tx + 9, top - 1, CRANE.backX - tx - 9, 3, col.d); rect(tx + 9, top - 1, CRANE.backX - tx - 9, 1, col.l);
    rect(CRANE.backX - 8, top + 1, 9, 8, OUT); rect(CRANE.backX - 7, top + 2, 7, 6, STONE.dark); rect(CRANE.backX - 7, top + 2, 7, 1, STONE.light); rect(CRANE.backX - 7, top + 2, 1, 6, STONE.base);
    // A-frame peak and tie rods to the tip and the counterweight
    rect(tx + 3, top - 9, 3, 9, OUT); rect(tx + 4, top - 8, 1, 8, col.l);
    for (let i = 0; i <= tx + 4 - CRANE.tipX; i++) dot(tx + 4 - i, top - 8 + Math.round(i * 7 / (tx + 4 - CRANE.tipX)), '#2a2630');
    for (let i = 0; i <= CRANE.backX - 4 - tx - 4; i++) dot(tx + 4 + i, top - 8 + Math.round(i * 8 / (CRANE.backX - tx - 8)), '#2a2630');
    D(g, tx + 4 - x0, top - 10 - y0, '#e8403d'); // aircraft-warning light
    // hazard stripes on the leg brace
    for (let i = 0; i < 9; i += 2) { rect(tx + i, base - 23, 1, 2, '#f2c94c'); }
    outline(c, OUT);
    if (season === 'winter') snowCap(c, false);
    return { c, ox: x0, oy: y0 };
  }

  /* ====================================================================
   * Sailboat (ambient, tacking on the river) and gulls
   * ================================================================== */
  function buildSailboat(flip) {
    const [c, g] = mk(22, 24);
    const rows = [
      '..........s...........',
      '.........ss...........',
      '.........sss..........',
      '........sssss.........',
      '........ssssss........',
      '.......sssssss........',
      '.......sssssssc.......',
      '......sssssssscc......',
      '......sssssssscc......',
      '.....ssssssssscc......',
      '.....sssssssss|c......',
      '....ssssssssss|.......',
      '....sssssssss.|.......',
      '..............|.......',
      '..ttttttttttttttttt...',
      '..hhhhhhhhhhhhhhhh....',
      '...hhhhhhhhhhhhhh.....',
      '....rrrrrrrrrrrr......',
    ];
    spr(g, rows, 0, 2, { s: CANVAS.base, c: RED.base, '|': WOOD.dark, t: '#e8dfc8', h: '#c94f3c', r: '#7a2c24' });
    // sail shading
    for (let y = 2; y < 15; y++) for (let x = 0; x < 22; x++) {
      const d = g.getImageData(x, y, 1, 1).data;
      if (d[0] === 239 && d[1] === 230 && x > 10 && bay(x, y) < 0.5) D(g, x, y, CANVAS.mid);
    }
    D(g, 9, 2, '#fffaf0'); D(g, 8, 6, '#fffaf0'); D(g, 7, 8, '#fffaf0');
    outline(c, OUT);
    if (!flip) return c;
    const [f, fg] = mk(22, 24);
    fg.translate(22, 0); fg.scale(-1, 1); fg.drawImage(c, 0, 0);
    return f;
  }
  const GULL = [
    ['w...w', '.w.w.', '..w..'],      // wings up
    ['.....', 'ww.ww', '..w..'],      // wings level
    ['.....', '.....', 'ww.ww'],      // wings down (tips)
  ];

  /* ====================================================================
   * Static 8: ground — bazaar floor, cargo yard, quay, pier
   * ================================================================== */
  function groundPatch(ctx, x0, y0, x1, y1, pal, seed, frayed) {
    const w = x1 - x0, h = y1 - y0;
    const [pc, pg] = mk(w, h);
    const img = pg.createImageData(w, h), d = img.data;
    const cols = pal.map((c) => CO.hexToRgb(c));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const wx = x0 + x, wy = y0 + y;
      const tx = (wx / T) | 0, ty = (wy / T) | 0;
      if (S.onRoad(tx, ty) || wx < shore(wy) + 2) continue;
      // frayed edges
      const ex = Math.min(x, w - 1 - x), ey = Math.min(y, h - 1 - y), e = Math.min(ex, ey);
      if (frayed && e < 10 && vnoise(wx / 6, wy / 6, seed) * 10 > e + bay(wx, wy) * 2.5) continue;
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

  function drawPier(ctx, season) {
    const { x0, x1, y0, y1 } = PIER;
    // shadow of the pier on the water (bottom-right)
    ctx.fillStyle = 'rgba(14,30,52,0.30)';
    ctx.fillRect(x0 + 2, y1 + 3, x1 - x0 - 2, 6);
    ctx.fillRect(x0 + 4, y1 + 9, x1 - x0 - 6, 2);
    // pilings under the south edge (into the water)
    for (let x = x0 + 2; x < x1 - 4; x += 12) {
      R(ctx, x, y1, 4, 9, PIERW.deep); R(ctx, x + 1, y1, 2, 8, PIERW.dark); R(ctx, x + 1, y1, 1, 8, PIERW.base);
      R(ctx, x, y1 + 6, 4, 1, '#2a4a3a'); // weed line
      D(ctx, x + 1, y1 + 7, '#3d6a4a');
    }
    // deck: boards run north-south (across the walkway)
    for (let x = x0; x < x1; x++) {
      const b = ((x - x0) / 4) | 0, k = (x - x0) % 4;
      const tone = hash(b, 1, 61);
      const base = tone < 0.3 ? PIERW.dark : tone > 0.8 ? PIERW.light : PIERW.base;
      const joint = y0 + 4 + ((hash(b, 2, 61) * (y1 - y0 - 8)) | 0);
      for (let y = y0; y < y1; y++) {
        let col = base;
        if (k === 3) col = PIERW.seam;
        else if (k === 0) col = sh(base, 0.1);
        if (y === joint && k !== 3) col = PIERW.seam;
        if ((y === y0 + 2 || y === y1 - 3) && k === 1) col = '#2a1d14'; // nails
        if (k !== 3 && hash(x, y, 62) < 0.04) col = sh(base, -0.15);
        if (season === 'winter' && k !== 3) {
          const n = vnoise(x / 7, y / 5, 64) + (hash(x, y, 63) - 0.5) * 0.12;
          if (n > 0.38) col = n > 0.5 ? P.snow : '#dfe7ee';
        }
        D(ctx, x, y, col);
      }
    }
    // edge stringers (north cap lit, south fascia dark)
    R(ctx, x0, y0 - 2, x1 - x0, 2, PIERW.light); R(ctx, x0, y0 - 2, x1 - x0, 1, PIERW.hi);
    R(ctx, x0, y1, x1 - x0, 3, PIERW.deep); R(ctx, x0, y1, x1 - x0, 1, PIERW.dark);
    R(ctx, x0 - 1, y0 - 2, 1, y1 - y0 + 5, OUT);
    R(ctx, x0 - 2, y0, 2, y1 - y0 + 3, PIERW.deep);
    // end posts (tall pilings poking through at the pier head)
    for (const [px, py] of [[x0 - 2, y0 - 4], [x0 - 2, y1 - 3], [x0 + 26, y0 - 4], [x0 + 26, y1 - 3]]) {
      R(ctx, px, py, 4, 6, OUT); R(ctx, px + 1, py + 1, 2, 5, PIERW.light); D(ctx, px + 1, py + 1, PIERW.hi); R(ctx, px + 2, py + 2, 1, 4, PIERW.dark);
    }
    // iron bollards along both edges
    for (const bx of [x0 + 12, x0 + 42]) for (const by of [y0 + 1, y1 - 3]) {
      R(ctx, bx, by, 4, 3, OUT); R(ctx, bx + 1, by - 1, 2, 1, OUT);
      R(ctx, bx + 1, by, 2, 2, IRON.base); D(ctx, bx + 1, by, IRON.hi);
    }
    // life ring on the end post
    const lx = x0 + 50, ly = y0 + 9;
    R(ctx, lx - 1, ly - 1, 7, 7, OUT);
    R(ctx, lx, ly, 5, 5, '#f4ebd8'); R(ctx, lx + 1, ly + 1, 3, 3, PIERW.base);
    D(ctx, lx, ly, RED.base); D(ctx, lx + 4, ly + 4, RED.base); D(ctx, lx + 4, ly, RED.base); D(ctx, lx, ly + 4, RED.base);
    ropeCoil(ctx, x0 + 34, y0 + 8);
  }

  function drawQuay(ctx, season) {
    const { x0, x1, y0, y1 } = QUAY;
    const winter = season === 'winter';
    for (let y = y0; y < y1; y++) {
      const sx = Math.max(x0, Math.round(shore(y)) - 8);
      for (let x = sx; x < x1; x++) {
        const d = x - sx;
        let col;
        if (d < 5) { // granite capstones along the water edge: long blocks
          const blk = ((y - y0 + (d > 2 ? 0 : 7)) / 15) | 0, ky = (y - y0 + (d > 2 ? 0 : 7)) % 15;
          col = d === 0 ? OUT : d === 1 ? STONE.hi : d < 4 ? STONE.light : STONE.dark;
          if (ky === 14 && d > 0) col = STONE.deep;
          if (hash(blk, d, 74) < 0.15 && d > 1 && d < 4) col = STONE.base;
        } else { // flagstone paving: large irregular slabs, lit from the top-left
          const row = ((y - y0) / 9) | 0, off = (hash(row, 0, 75) * 9) | 0;
          const bx = ((x - sx - 5 + off) / 12) | 0, kx = (x - sx - 5 + off) % 12, ky = (y - y0) % 9;
          const n = hash(bx, row, 71);
          col = n < 0.25 ? '#8f8a86' : n > 0.75 ? '#b2ada6' : '#a09b95';
          if (ky === 8 || kx === 11) col = '#6e6a68';
          else if (ky === 0 || kx === 0) col = sh(col, 0.12);
          if (hash(x, y, 76) < 0.05) col = sh(col, -0.1);
          if (x >= x1 - 2) col = x === x1 - 1 ? '#6e6a68' : '#8f8a86'; // kerb to the yard
        }
        if (winter && d > 1) {
          const n = vnoise(x / 8, y / 6, 65) + (hash(x, y, 66) - 0.5) * 0.1;
          if (n > 0.3) col = n > 0.45 ? P.snow : '#dfe7ee';
          else if (n > 0.26) col = '#c9d6e0';
        }
        D(ctx, x, y, col);
      }
    }
    // timber fenders and iron mooring rings on the water face
    for (let y = y0 + 4; y < y1; y += 16) {
      const sx = Math.max(x0, Math.round(shore(y)) - 8);
      R(ctx, sx - 3, y, 3, 7, OUT); R(ctx, sx - 2, y + 1, 1, 5, PIERW.light); R(ctx, sx - 2, y + 6, 1, 1, '#2a4a3a');
      R(ctx, sx + 6, y + 8, 3, 2, IRON.dark); D(ctx, sx + 7, y + 8, IRON.light);
    }
  }

  function drawPlaza(ctx, season) {
    const sand = season === 'winter' ? ['#cfd6dc', '#e2e8ec', '#f1f4f6', '#b9c2ca'] : ['#b89a6a', '#c9ad7c', '#dac193', '#9c8058'];
    groundPatch(ctx, PLAZA.x0, PLAZA.y0, ROAD_X0, PLAZA.y1, sand, 81, true);
    const east = STALLS.filter((st) => st.x > ROAD_X1);
    const ex1 = east.length ? east[east.length - 1].x + STALL_W + 10 : ROAD_X1 + 40;
    groundPatch(ctx, ROAD_X1, PLAZA.y0 + 4, ex1, WH.roof + 4, sand, 82, true);
    // woven rugs in front of the stalls
    const rugs = [[166, 526, 22, '#a8402e', '#e6a12b'], [206, 526, 22, '#2f6e8c', '#f4ebd8'], [288, 510, 20, '#6a3f8a', '#e6a12b']];
    for (const [rx, ry, rw, a, b] of rugs) {
      if (season === 'winter') continue;
      R(ctx, rx, ry - 4, rw, 4, a);
      for (let x = rx; x < rx + rw; x += 2) D(ctx, x, ry - 3, b);
      R(ctx, rx, ry - 4, rw, 1, sh(a, 0.2));
      for (let x = rx; x < rx + rw; x += 2) D(ctx, x, ry, sh(b, -0.2));
    }
  }
  function drawYard(ctx, season) {
    const dirt = season === 'winter' ? ['#c3ccd4', '#dbe2e8', '#eef2f5', '#a9b3bc'] : [P.dirtDark, P.dirt, P.dirtLight, '#6e4e30'];
    groundPatch(ctx, YARD.x0, YARD.y0, YARD.x1, YARD.y1, dirt, 91, true);
    // cart ruts from the warehouse door toward the road
    const ruts = season === 'winter' ? '#a9b3bc' : '#7a5734';
    for (let x = ROAD_X0 + 8; x < WH.doorX + 20; x++) {
      const y = 584 + Math.round(Math.sin(x * 0.05) * 1.2);
      if (hash(x, 3, 92) < 0.85) { D(ctx, x, y, ruts); D(ctx, x, y + 7, ruts); }
    }
  }

  /* ====================================================================
   * Static 23: buildings and props
   * ================================================================== */
  function drawStacks(ctx, season) {
    const items = [];
    for (const st of STACKS) {
      const v = (st.x * 13 + st.y) % 3;
      if (st.k === 'pyr') {
        items.push([st.x, st.y, 12, 11, v, null], [st.x + 13, st.y, 12, 11, v + 1, null], [st.x + 6, st.y - 11, 12, 11, v + 2, null]);
      } else if (st.k === 'two') {
        items.push([st.x, st.y, 10, 10, v, null], [st.x, st.y - 10, 10, 10, v + 1, 'full'], [st.x + 11, st.y, 8, 8, v + 2, null]);
      } else {
        items.push([st.x, st.y, 10, 9, v, null], [st.x + 11, st.y, 10, 9, v + 1, 'full'], [st.x + 22, st.y + 2, 8, 7, v, null]);
      }
    }
    for (const t of TAGGED) items.push([t.x, t.y, 11, 10, 0, 'low', t]);
    items.sort((a, b) => a[1] - b[1]);
    for (const [x, y, w, h] of items) groundShadow(ctx, x + 3, y - 1, w + 2, 4);
    for (const [x, y, w, h, v, open, tag] of items) {
      const c = crate(w, h, v, open, season);
      ctx.drawImage(c, x - 1, y - h - 1);
      if (tag) { // low stock: a red tag on a string
        R(ctx, x + w - 2, y - h - 1, 1, 3, '#2a1c12');
        R(ctx, x + w - 3, y - h + 2, 4, 5, '#5a1014');
        R(ctx, x + w - 2, y - h + 3, 2, 3, '#e43b44'); D(ctx, x + w - 2, y - h + 3, '#ff8a8a');
      }
    }
  }

  function drawProps(ctx, season) {
    // barrels and sacks by the stalls and the warehouse
    const barrels = [[184, 470, 0], [192, 474, 1], [WH.x1 - 2, 590, 0], [WH.x0 - 10, 584, 1], [236, 520, 0]];
    for (const [x, b, v] of barrels) { groundShadow(ctx, x + 2, b - 1, 10, 3); barrel(ctx, x, b, v); }
    sack(ctx, WH.x0 - 2, 590); sack(ctx, WH.x0 + 4, 592);
    // a pallet and a hand truck in the yard
    const plx = 246, ply = 622;
    groundShadow(ctx, plx + 2, ply, 18, 3);
    R(ctx, plx - 1, ply - 5, 18, 6, '#2a1c12');
    for (let i = 0; i < 4; i++) { R(ctx, plx + i * 4, ply - 4, 3, 2, '#c9a878'); D(ctx, plx + i * 4, ply - 4, '#e2cb9e'); }
    R(ctx, plx, ply - 2, 16, 2, '#8a6a44'); R(ctx, plx + 1, ply - 2, 2, 2, '#4a3420'); R(ctx, plx + 7, ply - 2, 2, 2, '#4a3420'); R(ctx, plx + 13, ply - 2, 2, 2, '#4a3420');
    const htx = 276, hty = 606;
    groundShadow(ctx, htx, hty, 12, 3);
    R(ctx, htx + 1, hty - 16, 1, 15, IRON.dark); R(ctx, htx + 7, hty - 16, 1, 15, IRON.dark); R(ctx, htx + 1, hty - 16, 7, 1, IRON.light);
    R(ctx, htx, hty - 2, 10, 1, IRON.dark);
    R(ctx, htx + 2, hty - 11, 6, 9, '#2a1c12'); R(ctx, htx + 3, hty - 10, 4, 2, '#d8ad75'); R(ctx, htx + 3, hty - 8, 4, 5, '#b07e48');
    for (const wx of [htx, htx + 7]) { R(ctx, wx, hty - 3, 3, 3, OUT); D(ctx, wx + 1, hty - 2, IRON.light); }
    // fallen leaves blown into the yard and onto the plaza (autumn)
    if (season === 'autumn') for (let i = 0; i < 70; i++) {
      const lx = YARD.x0 + 6 + Math.floor(hash(i, 1, 401) * (YARD.x1 - YARD.x0 - 12));
      const ly = YARD.y0 + 6 + Math.floor(hash(i, 2, 401) * (YARD.y1 - YARD.y0 - 8));
      const lc = [P.leaf.autumn, P.leafAlt.autumn, '#b5562a'][i % 3];
      D(ctx, lx, ly, lc); D(ctx, lx + 1, ly, sh(lc, -0.2));
    }
    ropeCoil(ctx, 162, 616);
    // fishing-net rack by the harbour light
    const nx = 188, nb = 462;
    for (const px of [nx, nx + 22]) { R(ctx, px, nb - 16, 2, 16, WOOD.dark); R(ctx, px, nb - 16, 1, 16, WOOD.light); }
    R(ctx, nx - 1, nb - 16, 26, 2, WOOD.base); R(ctx, nx - 1, nb - 16, 26, 1, WOOD.light);
    for (let y = nb - 14; y < nb - 3; y++) for (let x = nx + 2; x < nx + 22; x++) {
      const sag = Math.round(Math.sin(((x - nx) / 22) * Math.PI) * 2);
      if (y > nb - 4 + sag - 3) continue;
      if ((x + y) % 3 === 0 || (x - y + 30) % 3 === 0) D(ctx, x, y, (x + y) % 6 === 0 ? '#3a4a3a' : '#5a6a52');
    }
    for (let x = nx + 4; x < nx + 22; x += 5) { D(ctx, x, nb - 6, '#f28a2e'); D(ctx, x + 1, nb - 6, '#f28a2e'); }
    // harbour notice board by the plank road (store hours: pictograms only)
    const bx = 116, bb = 486;
    R(ctx, bx, bb - 14, 2, 14, WOOD.dark); R(ctx, bx + 12, bb - 14, 2, 14, WOOD.dark);
    R(ctx, bx - 1, bb - 16, 16, 10, OUT); R(ctx, bx, bb - 15, 14, 8, WOOD.mid); R(ctx, bx, bb - 15, 14, 1, WOOD.light);
    R(ctx, bx + 1, bb - 13, 5, 5, '#efe6cf'); R(ctx, bx + 7, bb - 13, 5, 4, '#cfe0ea'); D(ctx, bx + 3, bb - 11, RED.base); D(ctx, bx + 9, bb - 11, TEAL.base);
  }

  const cache = {};
  function getCache(season) {
    if (cache[season]) return cache[season];
    const out = {
      stalls: STALLS.map((s) => buildStall(s, season)),
      wh: buildWarehouse(season),
      annex: GROWTH >= 2 ? buildAnnex(season) : null,
      lh: buildLighthouse(season),
      cot: buildCottage(season),
      ships: SHIPS.map((s) => buildShip(s, season)),
      crane: buildCrane(season),
    };
    return (cache[season] = out);
  }
  let curSeason = (S.time && S.time.season) || 'autumn';

  S.registerStatic(8, (ctx) => {
    curSeason = (S.time && S.time.season) || curSeason;
    drawPlaza(ctx, curSeason);
    drawYard(ctx, curSeason);
    drawQuay(ctx, curSeason);
    drawPier(ctx, curSeason);
  });

  S.registerStatic(23, (ctx) => {
    const K = getCache(curSeason);
    // harbour light
    groundShadow(ctx, LH.x - 12, LH.base - 4, 34, 7);
    ctx.drawImage(K.lh.c, K.lh.ox, K.lh.oy);
    groundShadow(ctx, COT.x + 6, COT.base - 3, COT.w + 2, 6);
    ctx.drawImage(K.cot, COT.x - 1, COT.base - 47);
    drawProps(ctx, curSeason);
    // warehouse
    ctx.fillStyle = P.shadow;
    ctx.fillRect(WH.x1 + 1, WH.eave + 2, 5, WH.base - WH.eave);
    ctx.fillRect(WH.x0 + 4, WH.base, WH.x1 - WH.x0 + 2, 3);
    ctx.drawImage(K.wh.c, K.wh.ox, K.wh.oy);
    if (K.annex) { ctx.fillStyle = P.shadow; ctx.fillRect(WH.x0 - 16, WH.base, 16, 2); ctx.drawImage(K.annex, WH.x0 - 16, WH.base - 31); }
    // stalls
    STALLS.forEach((st, i) => {
      groundShadow(ctx, st.x + 4, st.base - 2, 38, 5);
      ctx.drawImage(K.stalls[i], st.x - 1, st.base - STALL_H - 1);
    });
    // bunting across the bazaar (growth 3)
    if (GROWTH >= 3) {
      for (let x = 280; x < 392; x++) {
        const sag = Math.round(Math.sin(((x - 280) / 112) * Math.PI) * 6);
        D(ctx, x, 452 + sag, '#5d3f22');
        if ((x - 280) % 7 === 3) { R(ctx, x - 1, 453 + sag, 3, 2, FIDGET[((x - 280) / 7 | 0) % 8]); D(ctx, x, 455 + sag, FIDGET[((x - 280) / 7 | 0) % 8]); }
      }
    }
    drawStacks(ctx, curSeason);
  });

  /* ====================================================================
   * Entities: ships, crane, sailboat
   * ================================================================== */
  const shipEnts = SHIPS.map((s, i) => S.addEntity({
    x: s.x + s.L / 2, y: s.wl, ship: s, idx: i, bob: 0,
    update(dt, t) { this.bob = RM ? 0 : Math.round((Math.sin(t * 1.25 + i * 1.7) + 1) / 2 + 0.15); },
    draw(ctx, t) {
      const K = getCache(curSeason).ships[i];
      const y = s.wl + this.bob;
      ctx.drawImage(K.c, s.x - SHIP_OX, y - SHIP_OY);
      // mooring lines
      if (s.moor === 'south') {
        ropeLine(ctx, s.x + 6, y + K.deckY0 + 1, s.x + 4, PIER.y1 + 1);
        ropeLine(ctx, s.x + s.L - 6, y + K.deckY0 + 1, s.x + s.L - 2, PIER.y1 + 1);
      } else if (s.moor === 'north') {
        ropeLine(ctx, s.x + 10, y - 9, PIER.x0 + 12, PIER.y0 + 2);
        ropeLine(ctx, s.x + s.L - 4, y - 9, PIER.x0 + 42, PIER.y0 + 2);
      } else if (s.moor === 'quay') {
        ropeLine(ctx, s.x + s.L - 4, y + K.deckY0 + 3, Math.round(shore(y - 8)) - 8, y - 14);
      } else {
        // anchor chain into the water off the bow
        for (let k = 0; k < 6; k++) D(ctx, s.x - 2 - (k >> 1), y - 10 + k * 2, IRON.dark);
      }
    },
  }));
  function ropeLine(ctx, x0, y0, x1, y1) {
    const mx = (x0 + x1) / 2, my = Math.max(y0, y1) + 2;
    S.px.line(ctx, x0, y0, mx, my, ROPE.dark);
    S.px.line(ctx, mx, my, x1, y1, ROPE.dark);
  }

  // Crane: unloads the first ship while there are orders.
  const CYCLE = 16;
  const craneEnt = S.addEntity({
    x: CRANE.x, y: CRANE.base,
    draw(ctx, t) {
      const K = getCache(curSeason).crane;
      ctx.drawImage(K.c, K.ox, K.oy);
      // trolley position, rope length, load
      const ship = SHIPS[0];
      const deck = ship.wl + (shipEnts[0] ? shipEnts[0].bob : 0) - 14;
      const pierY = PIER.y0 + 14;
      const overShip = CRANE.tipX + 6, overPier = 128;
      let tx = overShip + 6, hookY = CRANE.top + 16, load = false;
      if (ORDERS > 0) {
        const p = ((t / (RM ? CYCLE * 2 : CYCLE)) % 1);
        const seg = (a, b) => clamp((p - a) / (b - a), 0, 1);
        const ease = (u) => u * u * (3 - 2 * u);
        // 0-.15 lower to ship, .15-.2 grab, .2-.35 raise, .35-.55 travel to pier, .55-.68 lower, .68-.73 release, .73-.85 raise, .85-1 travel back
        const low = deck - 6, high = CRANE.top + 12, pierLow = pierY - 8;
        if (p < 0.15) { tx = overShip; hookY = high + (low - high) * ease(seg(0, 0.15)); }
        else if (p < 0.2) { tx = overShip; hookY = low; load = p > 0.17; }
        else if (p < 0.35) { tx = overShip; hookY = low + (high - low) * ease(seg(0.2, 0.35)); load = true; }
        else if (p < 0.55) { tx = overShip + (overPier - overShip) * ease(seg(0.35, 0.55)); hookY = high; load = true; }
        else if (p < 0.68) { tx = overPier; hookY = high + (pierLow - high) * ease(seg(0.55, 0.68)); load = true; }
        else if (p < 0.73) { tx = overPier; hookY = pierLow; load = p < 0.7; }
        else if (p < 0.85) { tx = overPier; hookY = pierLow + (high - pierLow) * ease(seg(0.73, 0.85)); }
        else { tx = overPier + (overShip - overPier) * ease(seg(0.85, 1)); hookY = high; }
        // the set-down crate waits on the pier until the porter's next pass
        if (p >= 0.7 || p < 0.1) drawCrateSmall(ctx, overPier - 3, pierY);
      } else {
        hookY = CRANE.top + 14 + (RM ? 0 : Math.round(Math.sin(t * 0.8)));
      }
      tx = Math.round(tx); hookY = Math.round(hookY);
      // trolley
      R(ctx, tx - 2, CRANE.top + 3, 5, 3, OUT); R(ctx, tx - 1, CRANE.top + 4, 3, 1, IRON.light);
      // cable + hook
      R(ctx, tx, CRANE.top + 6, 1, hookY - CRANE.top - 6, '#2a2630');
      R(ctx, tx - 1, hookY, 3, 2, IRON.dark); D(ctx, tx + 1, hookY + 2, IRON.dark); D(ctx, tx, hookY + 3, IRON.dark);
      if (load) drawCrateSmall(ctx, tx - 3, hookY + 10);
    },
  });
  function drawCrateSmall(ctx, x, base) {
    R(ctx, x - 1, base - 8, 9, 9, '#2a1c12');
    R(ctx, x, base - 7, 7, 2, '#d8ad75'); R(ctx, x, base - 5, 7, 5, '#b07e48'); R(ctx, x, base - 5, 7, 1, '#cd9c62');
    D(ctx, x + 3, base - 3, '#7f5630'); R(ctx, x, base - 1, 7, 1, '#7f5630');
  }

  // Sailboat tacking up and down the river channel.
  const boatSprites = { r: null, l: null };
  const sail = S.addEntity({
    x: 20, y: 200, vx: 1, dir: 1, ph: 0,
    update(dt, t) {
      const sp = RM ? 0.35 : 1;
      const period = 220; // seconds for a full trip north and back
      const u = ((t * sp) / period) % 1;
      const along = u < 0.5 ? u * 2 : 2 - u * 2; // 0..1..0
      const yTop = 40, yBot = 430;
      const y = yTop + (yBot - yTop) * along;
      // zig-zag tacks across the channel
      const lane = Math.min(shore(y), 74) - 30;
      const tack = Math.sin(y / 34);
      const x = 6 + (lane - 6) * (tack * 0.5 + 0.5);
      this.vx = x - this.x;
      if (Math.abs(this.vx) > 0.01) this.dir = this.vx > 0 ? 1 : -1;
      this.x = x; this.y = y;
    },
    draw(ctx, t) {
      if (!boatSprites.r) { boatSprites.r = buildSailboat(false); boatSprites.l = buildSailboat(true); }
      const bob = RM ? 0 : (Math.sin(t * 2.1) > 0.3 ? 1 : 0);
      const x = Math.round(this.x), y = Math.round(this.y) + bob;
      ctx.fillStyle = 'rgba(16,30,52,0.25)'; ctx.fillRect(x - 7, y + 1, 16, 2);
      ctx.drawImage(this.dir > 0 ? boatSprites.r : boatSprites.l, x - 11, y - 21);
      // wake
      if (!RM) { const wk = Math.floor(t * 4) % 3; R(ctx, x - this.dir * (10 + wk * 2), y, 2, 1, P.foam); }
    },
  });
  void sail; void craneEnt;

  /* ====================================================================
   * Dynamic 100: ripples around pilings and hulls
   * ================================================================== */
  const RIPPLES = [];
  for (let x = PIER.x0 + 2; x < PIER.x1 - 4; x += 12) RIPPLES.push([x + 2, PIER.y1 + 9, 2]);
    for (const s of SHIPS) { RIPPLES.push([s.x + 10, s.wl + 1, 5]); RIPPLES.push([s.x + s.L - 6, s.wl + 1, 4]); }
  for (let y = QUAY.y0 + 6; y < QUAY.y1; y += 14) RIPPLES.push([Math.round(shore(y)) - 13, y + 4, 2]);
  RIPPLES.push([LH.x - 16, LH.base + 1, 3]);
  // a fish jumping now and then somewhere in the harbour
  function fishJump(ctx, t) {
    const P_ = 6.5, k = Math.floor(t / P_), u = (t / P_) - k;
    if (u > 0.22) return;
    let fx = 0, fy = 0;
    for (let tries = 0; tries < 6; tries++) {
      fy = 470 + Math.floor(hash(k, tries, 301) * 160);
      fx = 8 + Math.floor(hash(k, tries, 302) * Math.max(4, shore(fy) - 24));
      const clear = SHIPS.every((s) => fx < s.x - 6 || fx > s.x + s.L + 6 || fy < s.wl - 24 || fy > s.wl + 6) && (fy < PIER.y0 - 4 || fy > PIER.y1 + 12 || fx < PIER.x0 - 6);
      if (clear) break;
      if (tries === 5) return;
    }
    const v = u / 0.22;
    if (v < 0.55) { // the arc: a little silver fish
      const a = v / 0.55, h = Math.round(Math.sin(a * Math.PI) * 6), x = fx + Math.round(a * 6);
      R(ctx, x - 1, fy - h - 1, 3, 1, '#c8d6dc'); D(ctx, x - 2, fy - h - 2 + (a > 0.5 ? 2 : 0), '#8aa0aa'); D(ctx, x + 1, fy - h - 1, '#2a3440');
      if (a < 0.2) R(ctx, fx - 1, fy, 3, 1, P.foam);
    } else { // the splash rings
      const a = (v - 0.55) / 0.45, r = 1 + Math.round(a * 4), x = fx + 6;
      ctx.fillStyle = `rgba(216,238,245,${(0.9 * (1 - a)).toFixed(2)})`;
      ctx.fillRect(x - r, fy, 1, 1); ctx.fillRect(x + r, fy, 1, 1); ctx.fillRect(x - r + 1, fy + 1, r * 2 - 1, 1); ctx.fillRect(x - r + 1, fy - 1, r * 2 - 1, 1);
      if (a < 0.3) R(ctx, x, fy - 2, 1, 2, P.foam);
    }
  }
  S.registerDynamic(100, (ctx, t) => {
    const sp = RM ? 0.4 : 1;
    if (!RM) fishJump(ctx, t);
    for (let i = 0; i < RIPPLES.length; i++) {
      const [x, y, w] = RIPPLES[i];
      const p = ((t * 0.5 * sp + i * 0.37) % 1);
      const r = Math.round(w + p * 4);
      ctx.fillStyle = `rgba(216,238,245,${(0.75 * (1 - p)).toFixed(2)})`;
      ctx.fillRect(x - r, y + Math.round(p * 2), 2, 1);
      ctx.fillRect(x + r - 1, y + Math.round(p * 2), 2, 1);
      ctx.fillRect(x - r + 2, y + 1 + Math.round(p * 2), r * 2 - 4 > 0 ? 1 : 0, 1);
    }
  });

  /* ====================================================================
   * Dynamic 200: the big spinner sign over Twirl's stall
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
    if (!flag) return;
    if (!SPIN_FRAMES.length) buildSpinFrames();
    const x = flag.x + 17, y = flag.base - STALL_H;
    R(ctx, x - 1, y - 9, 4, 10, OUT); R(ctx, x, y - 8, 2, 9, WOOD.base); R(ctx, x, y - 8, 1, 9, WOOD.light);
    const speed = RM ? 1.5 : (ORDERS ? 9 : 4);
    const f = Math.floor(t * speed) % SPIN_FRAMES.length;
    ctx.drawImage(SPIN_FRAMES[f], x - 7, y - 24);
  });

  /* ====================================================================
   * Dynamic 400: gulls, signal flag (status cue), steamer smoke
   * ================================================================== */
  const GULLS = [
    { cx: 70, cy: 470, rx: 40, ry: 14, sp: 0.35, ph: 0 },
    { cx: 110, cy: 500, rx: 54, ry: 18, sp: -0.28, ph: 2.1 },
    { cx: 40, cy: 560, rx: 30, ry: 12, sp: 0.42, ph: 4.0 },
  ];
  const gullPal = { w: '#f4f4f0' };
  const FLAGPOLE = { x: LH.x + 13, y: LH.base - 6 };
  S.registerDynamic(400, (ctx, t) => {
    const n = RM ? 1 : GULLS.length;
    for (let i = 0; i < n; i++) {
      const g = GULLS[i];
      const a = t * g.sp + g.ph;
      const x = Math.round(g.cx + Math.cos(a) * g.rx), y = Math.round(g.cy + Math.sin(a) * g.ry - 30);
      const f = RM ? 1 : (Math.floor(t * 5 + i) % 4);
      const fr = GULL[f === 3 ? 1 : f];
      ctx.fillStyle = 'rgba(16,30,52,0.18)'; ctx.fillRect(x + 6, y + 34, 4, 1);
      for (let j = 0; j < 3; j++) for (let k = 0; k < 5; k++) if (fr[j][k] === 'w') {
        D(ctx, x + k, y + j, gullPal.w);
        D(ctx, x + k, y + j + 1, '#8c96a0');
      }
      D(ctx, x + 2, y + 2, '#f4f4f0');
    }
    // signal mast at the pier head: store pennant when calm, storm flags on warn / critical
    const px = FLAGPOLE.x, py = FLAGPOLE.y;
    R(ctx, px - 1, py - 31, 4, 32, OUT); R(ctx, px, py - 30, 2, 31, '#d8d0c0'); R(ctx, px + 1, py - 30, 1, 31, '#a8a090');
    R(ctx, px - 1, py - 32, 3, 2, P.gold);
    R(ctx, px - 2, py, 6, 2, OUT);
    const wave = RM ? 0 : Math.floor(t * 4) % 3;
    const flagCols = LEVEL === 'critical' ? [RED.base, RED.base] : LEVEL === 'warn' ? [RED.base, P.gold] : LEVEL === 'idle' ? [TEAL.dark] : [TEAL.base];
    flagCols.forEach((col, k) => {
      const fy = py - 29 + k * 7;
      const len = LEVEL === 'idle' ? 5 : 9;
      for (let i = 0; i < len; i++) {
        const dy = LEVEL === 'idle' ? i : Math.round(Math.sin((i + wave * 2) * 0.8) * 0.8);
        const hgt = LEVEL === 'critical' ? 5 : Math.max(1, 5 - (i >> 1));
        R(ctx, px + 2 + i, fy + dy, 1, hgt, i === 0 ? sh(col, 0.2) : col);
        D(ctx, px + 2 + i, fy + dy + hgt, sh(col, -0.4));
      }
      if (LEVEL === 'ok' || LEVEL === 'idle') { D(ctx, px + 4, fy + 1, P.gold); }
    });
    // cottage chimney
    const cn = RM ? 2 : 4;
    for (let k = 0; k < cn; k++) {
      const age = ((t * 0.2) + k / cn) % 1;
      const x = Math.round(COT.x + COT.w - 10 + age * 8 + Math.sin(age * 4 + k) * 1.5), y = Math.round(COT.base - 46 - age * 22);
      const sz = 2 + Math.round(age * 2);
      ctx.fillStyle = `rgba(214,214,222,${(0.5 * (1 - age)).toFixed(2)})`;
      ctx.fillRect(x - (sz >> 1), y, sz, sz - 1);
    }
    // steamer smoke (only for ships that carry orders)
    const puffs = RM ? 2 : 5;
    shipEnts.forEach((e, i) => {
      const s = SHIPS[i], K = getCache(curSeason).ships[i];
      if (!K.smoke || s.empty) return;
      const sx = s.x + K.smoke.x, sy = s.wl + e.bob + K.smoke.y;
      for (let k = 0; k < puffs; k++) {
        const age = ((t * 0.22) + k / puffs + i * 0.3) % 1;
        const x = Math.round(sx + age * 12 + Math.sin(age * 5 + k) * 1.5), y = Math.round(sy - age * 26);
        const sz = 2 + Math.round(age * 3);
        ctx.fillStyle = `rgba(200,200,210,${(0.6 * (1 - age)).toFixed(2)})`;
        ctx.fillRect(x - (sz >> 1), y, sz, sz - 1); ctx.fillRect(x - (sz >> 1) + 1, y - 1, Math.max(1, sz - 2), 1);
      }
    });
  });

  /* ====================================================================
   * Lights and night glow (700)
   * ================================================================== */
  const lhLamp = { x: LH.x, y: LH.base - 49 };
  S.addLight({ x: lhLamp.x, y: lhLamp.y, r: 70, color: '#ffd27a', intensity: 1, flicker: false });
  STALLS.forEach((st) => S.addLight({ x: st.x + 3, y: st.base - 29, r: 26, color: P.lantern, intensity: 0.85, flicker: true }));
  S.addLight({ x: WH.doorX + WH.doorW + 14, y: WH.base - 20, r: 30, color: P.lantern, intensity: 0.9, flicker: true });
  S.addLight({ x: WH.doorX + WH.doorW / 2, y: WH.base - 8, r: 22, color: '#ffb86a', intensity: 0.6 });
  SHIPS.forEach((s) => S.addLight({ x: s.x + s.L - 2, y: s.wl - 16, r: 16, color: P.lantern, intensity: 0.7, flicker: true }));
  S.addLight({ x: COT.x + 30, y: COT.base - 16, r: 22, color: '#ffcf6e', intensity: 0.75 });

  const winGlow = [
    [WH.x0 + 7, WH.eave + 11, 4, 3], [WH.x0 + 13, WH.eave + 11, 4, 3], [WH.x0 + 7, WH.eave + 15, 4, 4], [WH.x0 + 13, WH.eave + 15, 4, 4],
    [WH.x1 - 17, WH.eave + 11, 4, 3], [WH.x1 - 11, WH.eave + 11, 4, 3], [WH.x1 - 17, WH.eave + 15, 4, 4], [WH.x1 - 11, WH.eave + 15, 4, 4],
  ];
  S.registerDynamic(700, (ctx, t) => {
    const light = S.time.light == null ? 1 : S.time.light;
    const a = clamp((0.62 - light) / 0.35, 0, 1);
    if (a < 0.02) return;
    ctx.globalAlpha = a;
    for (const [x, y, w, h] of winGlow) { R(ctx, x, y, w, h, '#ffcf6e'); R(ctx, x, y, w, 1, '#ffe7a8'); }
    // Twirl's porthole and window
    R(ctx, COT.x + 28, COT.base - 18, 3, 4, '#ffcf6e'); R(ctx, COT.x + 27, COT.base - 17, 5, 2, '#ffcf6e'); D(ctx, COT.x + 28, COT.base - 18, '#ffe7a8');
    R(ctx, COT.x + 38, COT.base - 18, 2, 4, '#ffcf6e'); R(ctx, COT.x + 41, COT.base - 18, 1, 4, '#ffcf6e');
    // warehouse doorway: a warm lamp-lit aisle, brighter toward the floor
    for (let k = 0; k < 20; k++) {
      ctx.fillStyle = `rgba(255,190,100,${(0.08 + k * 0.014).toFixed(3)})`;
      ctx.fillRect(WH.doorX + 2, WH.base - 20 + k, WH.doorW - 4, 1);
    }
    // crane cab window and the blinking warning light on its peak
    R(ctx, CRANE.x - 10, CRANE.top + 8, 3, 2, '#ffcf6e'); R(ctx, CRANE.x - 6, CRANE.top + 8, 3, 2, '#ffcf6e');
    if (RM || Math.floor(t * 1.2) % 2 === 0) { D(ctx, CRANE.x + 4, CRANE.top - 10, '#ff5a4a'); ctx.fillStyle = 'rgba(255,90,74,0.35)'; ctx.fillRect(CRANE.x + 3, CRANE.top - 11, 3, 3); }
    // stall lanterns
    for (const st of STALLS) {
      const fl = RM ? 0 : (Math.sin(t * 7 + st.x) > 0.6 ? 1 : 0);
      R(ctx, st.x + 2, st.base - 31, 3, 4, '#ffe7a8'); D(ctx, st.x + 3, st.base - 30 + fl, '#ffffff');
    }
    // ship lanterns and wheelhouse windows
    shipEnts.forEach((e, i) => {
      const s = SHIPS[i], K = getCache(curSeason).ships[i];
      R(ctx, s.x + K.lamp.x - 1, s.wl + e.bob + K.lamp.y - 1, 2, 2, '#ffe7a8');
      if (s.kind === 'steam') for (let x = s.L - 19; x < s.L - 8; x += 4) R(ctx, s.x + x, s.wl + e.bob + K.mid - 3, 2, 2, '#ffcf6e');
    });
    // harbour light: bright lamp and a beam sweeping across the river (seaward half only)
    R(ctx, lhLamp.x - 3, lhLamp.y - 3, 7, 6, '#fff3c4');
    const ang = (t * (RM ? 0.15 : 0.55)) % (Math.PI * 2);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    if (dy < 0.2) {
      const fade = clamp((0.2 - dy) / 0.5, 0, 1);
      const len = Math.round(36 + 50 * Math.abs(dx));
      for (let k = 5; k < len; k++) {
        const bx = Math.round(lhLamp.x + dx * k), by = Math.round(lhLamp.y + dy * k * 0.4);
        const spread = 1 + (k / 9 | 0);
        ctx.fillStyle = `rgba(255,236,170,${(0.34 * fade * (1 - k / len)).toFixed(3)})`;
        ctx.fillRect(bx, by - spread, 1, spread * 2 + 1);
      }
    }
    ctx.globalAlpha = 1;
  });

  /* ====================================================================
   * Hotspots
   * ================================================================== */
  const lm = (key, x, y, w, h, label) => S.addHotspot({
    id: 'landmark:' + key, kind: 'landmark', landmark: key, biome: 'port', agent: AGENT,
    label: label || (S.landmarks[key] && S.landmarks[key].label) || key, x, y, w, h, priority: 1,
  });
  lm('bazaar', PLAZA.x0, PLAZA.y0 - 30, PLAZA.x1 - PLAZA.x0, PLAZA.y1 - PLAZA.y0 + 30);
  const known = typeof SHOP.orders_7d === 'number';
  const dockLabel = 'Dock' + (known ? ` · ${ORDERS} order${ORDERS === 1 ? '' : 's'} in 7 days` : '');
  const whLabel = 'Warehouse' + (LOW.length ? ` · ${LOW.length} low-stock item${LOW.length === 1 ? '' : 's'}` : '');
  lm('dock', 0, PIER.y0 - 34, CRANE.backX + 2, S.H - (PIER.y0 - 34), dockLabel);
  lm('warehouse', WH.x0 - 4, WH.roof - 12, WH.x1 - WH.x0 + 8, WH.base - WH.roof + 28, whLabel);
})();
