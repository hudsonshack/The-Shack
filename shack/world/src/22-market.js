/* The Shack v2: Neon Hollow (Lumi, social-ops).
 *
 * Owns the island 'market' (top rect tiles 54,2 23x16; native px 864..1232 x 32..288).
 *   static 7    ground overlay: night-plum basketweave pavers that look lit
 *               (dithered neon light pools baked in), a glazed lane from the
 *               billboard down to Lumi's corner, a faded painted mural, puddles,
 *               confetti, winter drifts, and the little neon spring + channel
 *               that feeds the waterfall
 *   static 22   billboard (stands over the north rim, against the stars), the
 *               broadcast tower on its equipment hut, Angie's cafe stall (the
 *               active client: the warmest, busiest stall), the Fidgetly promo
 *               stall (on hold: dimmer, curtain half drawn, a pause placard),
 *               the blimp mooring mast on the west tip, neon pole sign, selfie
 *               wall, vending machine, lamps, planters, benches, firework
 *               mortars; growth: noodle cart (1), sticker stall (2), ferris
 *               wheel (3), with tarped carts standing in until they open
 *   dyn 100     the neon waterfall pouring off the south-east lip into space
 *   dyn 200     the display spinner, the ferris wheel
 *   dyn 400     steam, string-light wires, the mast windsock
 *   dyn 700     lit neon, billboard screen, bulbs, lanterns, tower + mast
 *               beacons, radio rings, fireworks
 * Every dynamic layer passes {island: 'market'}; every light passes island.
 *
 * Data (social-ops metrics only, nothing invented):
 *   billboard     cycles through real metrics: scheduled_posts_7d (one tile per
 *                 queued post, coloured by client), store_ads videos planned /
 *                 posted (one film frame each), link clicks (one dot each).
 *                 No digits in the canvas: the hotspot label carries the
 *                 numbers. A test card "standby" when empty.
 *   fireworks     launch rate from scheduled_posts_7d (none when 0), plus a
 *                 burst of up to 12 during the cycle ceremony's council beat.
 *                 Peony, ring, willow, crackle and heart bursts. Other modules
 *                 may call S.market.firework(big) when a post goes out.
 *   S.market      {dock: {x, y, island}, mast, firework()}: the blimp's mooring
 *                 point (the docking ring) for the villagers module.
 *   Angie's       polaroids pinned on the counter = Angie's posts_next_7d.
 *   Fidgetly      film frames on the counter = videos planned (posted ones lit).
 *                 Shown on hold unless S.data.store.ads.status says it's live.
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S || !S.islands || !S.islands.market) return;

  const T = S.TILE, P = S.PAL, C = S.color;
  const ID = 'market';
  const AGENT = 'social-ops';
  const GROWTH = ((S.status && S.status[ID]) || {}).growth | 0;
  const rm = S.reducedMotion;
  const OUT = P.outline;
  const ISL = { island: ID };

  /* ------------------------------------------------------------- palette */
  const PLUM = { grout: '#2a1f3f', deep: '#33264a', dark: '#3a2b53', base: '#43335e', light: '#4c3b69', hi: '#5a4876' };
  const LANE = { grout: '#2e2346', dark: '#4a3a68', base: '#554476', light: '#625184', hi: '#76669a' };
  const CURB = { line: '#160e21', dark: '#463a60', base: '#685a84', light: '#8b7ea8', hi: '#b0a6c9' };
  const STEEL = { deep: '#1b1929', dark: '#2e2b43', base: '#484563', light: '#6b688b', hi: '#9c99ba' };
  const CONC = { deep: '#3d3750', dark: '#5a536c', base: '#7b7490', light: '#9d97b0', hi: '#c2bdd1' };
  const WOOD = { deep: '#3a2214', dark: '#5a3720', base: '#7e5030', light: '#a26c40', hi: '#c99a62' };
  const TEAL = { deep: '#14332f', dark: '#1e514a', base: '#2c7366', light: '#479783', hi: '#80c4a8' };
  const CREAM = { dark: '#c9b28a', base: '#eddcb8', light: '#fbf2da' };
  const VELVET = { deep: '#2a0f3a', dark: '#46195e', base: '#62287e', light: '#8240a2', hi: '#a866c4' };
  const NEON = { pink: P.neonPink, cyan: P.neonCyan, violet: P.neonViolet, amber: '#ffb347', yellow: '#ffe45c', lime: '#a6ff5c', red: '#ff4a4a' };
  const SHADOW_INK = '#120b1c';
  const RAINBOW = ['#ff4f6e', '#ff9a3c', '#ffd84a', '#5fd36a', '#3ec8f0', '#9b6bff'];
  const FALLC = { deep: '#2a3f9a', dark: '#3a6ad0', base: '#4fb8f0', light: '#9ff0ff', white: '#f2feff', violet: '#9b6bff', pink: '#ff7fc8' };

  /* ------------------------------------------------------- tiny helpers */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sh = (c, a) => C.shade(c, a);
  const mix = (a, b, t) => C.mix(a, b, t);
  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    return [c, g];
  }
  const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const D = (g, x, y, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), 1, 1); };
  const L = (g, x0, y0, x1, y1, c) => S.px.line(g, x0, y0, x1, y1, c);
  const smooth = (q) => q * q * (3 - 2 * q);
  function vnoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), u = smooth(x - xi), v = smooth(y - yi);
    const a = S.hash(xi, yi, seed), b = S.hash(xi + 1, yi, seed), c = S.hash(xi, yi + 1, seed), d = S.hash(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const fbm = (x, y, s) => vnoise(x, y, s) * 0.6 + vnoise(x * 2.13, y * 2.13, s + 7) * 0.28 + vnoise(x * 4.7, y * 4.7, s + 13) * 0.12;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bayer = (x, y) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

  /** Build a sprite with a 1 px margin and an automatic outer outline. */
  function build(w, h, fn, outline) {
    const [c, g] = mk(w + 2, h + 2);
    g.translate(1, 1); fn(g); g.setTransform(1, 0, 0, 1, 0, 0);
    if (outline) addOutline(c, g, outline);
    return c;
  }
  function addOutline(c, g, col) {
    const w = c.width, h = c.height, im = g.getImageData(0, 0, w, h), d = im.data;
    const A = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) A[i] = d[i * 4 + 3] > 60 ? 1 : 0;
    const [r, gg, b] = C.hexToRgb(col);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (A[i]) continue;
      if ((x > 0 && A[i - 1]) || (x < w - 1 && A[i + 1]) || (y > 0 && A[i - w]) || (y < h - 1 && A[i + w])) {
        d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
  }
  function silhouette(c) {
    const [s, g] = mk(c.width, c.height);
    g.drawImage(c, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = SHADOW_INK; g.fillRect(0, 0, c.width, c.height);
    return s;
  }
  /** Draw a built sprite so its local (0,0) lands on world (x,y); shd = [dx, dy, alpha] drop shadow. */
  function place(ctx, spr, x, y, shd) {
    if (shd) {
      ctx.globalAlpha = shd[2] || 0.26;
      ctx.drawImage(spr.sil || (spr.sil = silhouette(spr)), Math.round(x - 1 + shd[0]), Math.round(y - 1 + shd[1]));
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(spr, Math.round(x - 1), Math.round(y - 1));
  }
  /** Soft contact shadow (an ellipse) on the ground. */
  function groundShadow(ctx, cx, cy, rx, ry, a) {
    ctx.fillStyle = C.rgba(SHADOW_INK, a == null ? 0.25 : a);
    for (let y = -ry; y <= ry; y++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.5))));
      ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
    }
  }
  function mask(rows) {
    const pts = [];
    rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] !== '.' && row[x] !== ' ') pts.push([x, y, row[x]]); });
    return { w: rows[0].length, h: rows.length, pts };
  }
  const season = () => (S.time && S.time.season) || 'autumn';
  const darkness = () => 1 - (S.time && S.time.light != null ? S.time.light : 1);

  /* ======================================================== ISLAND SHAPE
   * The islands module draws Neon Hollow's organic top; its mask is not
   * exported, so this mirrors the same deterministic recipe (same seed, same
   * noise and random sequence) to keep the pavement and props on solid
   * ground and to know where the underside ends below the waterfall.
   */
  const GEO = (function () {
    const r = S.islands[ID], box = S.islandBox(ID), s = 29;
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
      const n = lobe + (fbm(gx / 40, gy / 40, s) - 0.5) * 40 + (vnoise(gx / 9, gy / 9, s + 5) - 0.5) * 9 + (S.hash(gx >> 1, gy >> 1, s + 9) - 0.5) * 2.4;
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
    // Manhattan distance from the edge, inside the top (capped).
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
    // The underside profile, same recipe and random sequence as the islands module.
    const CLIFF = 6, botY = new Int16Array(bw).fill(-1);
    let xa = bw, xb = -1;
    for (let x = 0; x < bw; x++) for (let y = 0; y < bh; y++) if (top[y * bw + x]) botY[x] = y;
    for (let x = 0; x < bw; x++) if (botY[x] >= 0) { xa = Math.min(xa, x); xb = Math.max(xb, x); }
    const rnd = S.rng(s * 977 + 13), half = (xb - xa) / 2, xc = xa + half + (rnd() - 0.5) * half * 0.3, Dp = r.depth * T;
    const spikes = [{ c: xc + (rnd() - 0.5) * half * 0.12, w: half * 0.32, h: Dp * 0.3 }];
    const nsec = 2 + ((rnd() * 2) | 0);
    for (let i = 0; i < nsec; i++) { const side = i % 2 ? 1 : -1; spikes.push({ c: xc + side * half * (0.3 + rnd() * 0.42), w: half * (0.09 + rnd() * 0.09), h: Dp * (0.16 + rnd() * 0.24) }); }
    const U = new Int16Array(bw).fill(-1);
    for (let x = xa; x <= xb; x++) {
      if (botY[x] < 0) continue;
      const tq = Math.min(1, Math.abs(x + 0.5 - xc) / (half * 1.03));
      const bowl = Dp * (0.56 * Math.pow(1 - tq, 1.5) + 0.2 * (1 - tq * tq));
      let sp = 0;
      for (const k of spikes) { const tt = 1 - Math.abs(x + 0.5 - k.c) / k.w; if (tt > 0) sp = Math.max(sp, k.h * Math.pow(tt, 1.3)); }
      const cell = Math.floor((x + s) / 5), pos = ((x + s) % 5) / 4, amp = 1 + S.hash(cell, 0, s) * 4;
      const jag = (1 - Math.abs(2 * pos - 1)) * amp * Math.min(1, (bowl + sp) / 12) + (S.hash(x, 1, s) < 0.25 ? 1 : 0);
      U[x] = Math.min(bh - 14, Math.round(botY[x] + CLIFF + bowl + sp + jag));
    }
    return {
      ox, oy, bw, bh,
      under: (gx) => { const x = gx - ox; return x < 0 || x >= bw || U[x] < 0 ? -1 : U[x] + oy; },
      din: (gx, gy) => { const x = gx - ox, y = gy - oy; return x < 0 || y < 0 || x >= bw || y >= bh ? 0 : din[y * bw + x]; },
      on: (gx, gy) => { const x = gx - ox, y = gy - oy; return x >= 0 && y >= 0 && x < bw && y < bh && top[y * bw + x] === 1; },
      bot(gx) { const x = gx - ox; if (x < 0 || x >= bw) return -1; for (let y = bh - 1; y >= 0; y--) if (top[y * bw + x]) return y + oy; return -1; },
      left(gy) { const y = gy - oy; if (y < 0 || y >= bh) return -1; for (let x = 0; x < bw; x++) if (top[y * bw + x]) return x + ox; return -1; },
    };
  })();

  /* ---------------------------------------------------------- data feed */
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const CLIENT_COL = (name, i) => (/angie/i.test(name || '') ? '#ffb347' : /fidget/i.test(name || '') ? P.neonCyan : ['#ff6fb5', '#a6ff5c', '#c79bff'][i % 3]);
  function readFeed() {
    const m = S.metrics(AGENT) || {};
    const ads = m.store_ads || {};
    const clients = (Array.isArray(m.clients) ? m.clients : []).filter((c) => c && typeof c === 'object');
    const angie = clients.find((c) => /angie/i.test(c.name || ''));
    const list = clients.map((c, i) => ({ name: String(c.name || ''), n: Math.max(0, Math.round(num(c.posts_next_7d))), col: CLIENT_COL(c.name, i) }));
    const storeAds = ((S.data && S.data.store) || {}).ads || {};
    return {
      posts: Math.max(0, Math.round(num(m.scheduled_posts_7d))),
      planned: Math.max(0, Math.round(num(ads.videos_planned))),
      posted: Math.max(0, Math.round(num(ads.videos_posted_7d))),
      clicks: Math.max(0, Math.round(num(ads.link_clicks_7d))),
      clients: list,
      angiePosts: angie ? Math.max(0, Math.round(num(angie.posts_next_7d))) : 0,
      // Fidgetly is on hold unless the data explicitly says its ads are running.
      fidgetLive: /^(active|running|live|on)$/i.test(String(storeAds.status || '').trim()),
    };
  }
  let F = readFeed(), feedAt = 0;
  const feed = (t) => { if (t - feedAt > 5 || t < feedAt) { F = readFeed(); feedAt = t; updateLabels(); } return F; };
  const PAUSED = !F.fidgetLive;

  /* ============================================================ GEOMETRY
   * World native px. Sprites are given by their top-left; "feet" = bottom.
   */
  const BB = { x: 1018, y: 54, w: 96, h: 57 };               // billboard, its screen kept clear of the HUD at fit view
  const SCR = { x: BB.x + 4, y: BB.y + 3, w: 88, h: 27 };    // its screen
  const HUT = { x: 1148, y: 98, w: 44, h: 28 };              // equipment hut
  const TWR = { cx: HUT.x + 22, base: HUT.y + 4, top: HUT.y - 56 };   // lattice tower on the hut roof
  const BEACON = { x: TWR.cx, y: TWR.top - 10 };
  const ANG = { x: 932, y: 98, w: 84, h: 64 };               // Angie's cafe stall
  const TABLE = { x: 934, y: 166 };                          // sidewalk table in front of Angie's (clear of the mast, the lamp and the mural)
  const AFRAME = { x: 1006, y: 168 };
  const FID = { x: 1074, y: 178, w: 80, h: 56 };             // Fidgetly promo stall
  const TRIPOD = { x: 1088, y: 250 };
  const RING = { x: 1124, y: 248 };
  const POLE = { x: 1022, y: 154 };                          // neon pole sign (box top-left)
  const VEND = { x: 1128, y: 120 };
  const SELFIE = { x: 1082, y: 128, w: 40, h: 30 };
  const MAST = { x: 903, base: 206, top: 96 };              // blimp mooring mast on the west tip
  const DOCK = { x: MAST.x - 19, y: MAST.top + 6 };          // the docking ring the blimp's nose clips into
  const NOOD = { x: 1150, y: 128, w: 58, h: 52 };            // growth >= 1
  const STK = { x: 912, y: 50, w: 52, h: 46 };               // growth >= 2
  const WHEEL = { cx: 1184, cy: 192, r: 20, base: 230 };     // growth >= 3
  const LANE_R = { x0: 1040, x1: 1072, y0: 106, y1: 162 };    // glazed lane from the billboard to Lumi's corner
  const MURAL = { x: 972, y: 188 };
  const POOL = { x: 1163, y: 252, rx: 8, ry: 4 };            // the neon spring
  const FALL_X0 = 1159, FALL_W = 8, FALL_SHEET = 46;         // the channel / waterfall columns; the sheet hugs the underside (measured at static time; this is the fallback)
  const MORTARS = [[944, 264], [1022, 264], [1136, 170]];
  const FALL_COLS = [FALL_X0, FALL_X0 + FALL_W - 1];

  // Lamp posts that carry the string lights: [x feet, y feet, height].
  const LAMPS = [[1034, 132, 24], [1078, 130, 24], [994, 94, 22], [928, 190, 24], [1004, 252, 22], [1150, 260, 22]];
  const lampTop = (i) => [LAMPS[i][0], LAMPS[i][1] - LAMPS[i][2]];
  const ANCHOR = {
    L1: lampTop(0), R1: lampTop(1), N: lampTop(2), W: lampTop(3), S1: lampTop(4), S2: lampTop(5),
    BL: [BB.x + 16, BB.y + 35], BR: [BB.x + 80, BB.y + 35], H: [HUT.x + 2, HUT.y + 9],
    AW: [ANG.x + 2, ANG.y + 28], AE: [ANG.x + 82, ANG.y + 28], C: [POLE.x + 7, POLE.y - 1],
    FW: [FID.x + 2, FID.y + 12], FE: [FID.x + 78, FID.y + 12], M: [MAST.x + 9, MAST.top + 40],
    SF: [SELFIE.x + 2, SELFIE.y + 2],
  };
  // across the lane, along it, and out to the stalls, the mast and the south strip
  const STRINGS = [['L1', 'R1', 6], ['BL', 'L1', 4], ['BR', 'R1', 4], ['R1', 'SF', 3], ['R1', 'H', 6], ['AE', 'L1', 5], ['N', 'BL', 5], ['N', 'AE', 4],
    ['L1', 'C', 3], ['C', 'FW', 6], ['M', 'W', 5], ['W', 'AW', 6], ['FE', 'S2', 6], ['S1', 'C', 9]];
  if (GROWTH >= 1) STRINGS.push(['H', 'FE', 10]);

  const PLANTERS = [[924, 262, 3]];
  if (GROWTH < 3) PLANTERS.push([1198, 214, 4]);
  const BENCHES = [[984, 262]];
  if (GROWTH < 3) BENCHES.push([1180, 238]);
  // Closed carts under tarps stand where stalls will open as the market grows.
  const TARPS = [];
  if (GROWTH < 1) TARPS.push([NOOD.x + 4, NOOD.y + 22, 50, 1]);
  if (GROWTH < 2) TARPS.push([STK.x + 4, STK.y + 16, 44, 2]);

  /* ----------------------------------------------------- reserve tiles */
  {
    // paved tiles (well inside the rim) and every building footprint
    const r = S.islands[ID];
    for (let ty = r.y; ty < r.y + r.h; ty++) for (let tx = r.x; tx < r.x + r.w; tx++)
      if (GEO.din(tx * T + 8, ty * T + 8) >= 22) S.reserve(tx, ty);
    const rp = (x, y, w, h) => S.reserve(Math.floor(x / T), Math.floor(y / T), Math.ceil((x + w) / T) - Math.floor(x / T), Math.ceil((y + h) / T) - Math.floor(y / T));
    rp(BB.x, BB.y + 30, BB.w, BB.h - 30); rp(HUT.x, HUT.y, HUT.w, HUT.h); rp(ANG.x, ANG.y + 12, ANG.w, ANG.h - 12); rp(FID.x, FID.y + 10, FID.w + 18, FID.h - 10);
    rp(MAST.x - 10, MAST.base - 24, 20, 24); rp(TABLE.x, TABLE.y, 20, 18); rp(TRIPOD.x, TRIPOD.y - 12, 50, 20); rp(POOL.x - 10, POOL.y - 6, 20, 30);
    rp(NOOD.x, NOOD.y + 10, NOOD.w, NOOD.h - 10); rp(STK.x, STK.y + 8, STK.w, STK.h - 8); rp(WHEEL.cx - 24, WHEEL.cy - 22, 48, WHEEL.base - WHEEL.cy + 24);
    for (const [x, y] of LAMPS) rp(x - 2, y - 4, 4, 4);
    // the tall things (decor must never sprout through them) and the small props
    rp(TWR.cx - 16, TWR.top - 12, 32, HUT.y - TWR.top + 12); rp(MAST.x - 12, MAST.top - 8, 24, MAST.base - MAST.top + 8); rp(DOCK.x - 6, DOCK.y - 10, 14, 20);
    rp(BB.x, BB.y, BB.w, 30); rp(VEND.x, VEND.y, 13, 26); rp(SELFIE.x, SELFIE.y, SELFIE.w, SELFIE.h); rp(POLE.x - 1, POLE.y - 1, 16, 50);
    rp(AFRAME.x, AFRAME.y, 10, 15); rp(RING.x, RING.y - 14, 14, 24); rp(FID.x + FID.w, FID.y + 38, 18, 18); rp(ANG.x, ANG.y, ANG.w, 12);
    for (const f of FALL_COLS) rp(f - 2, POOL.y, 4, 24);
    for (const [x, y] of PLANTERS) rp(x - 9, y - 10, 18, 10);
    for (const [x, y] of MORTARS) rp(x - 6, y - 10, 12, 10);
    for (const [x, y] of BENCHES) rp(x - 9, y - 9, 18, 9);
  }

  /* ============================================================ GROUND (7) */
  const POOLS = [
    [1066, 116, 54, '#7fd8ff', 0.36],               // billboard wash
    [980, 174, 52, '#ffb050', 0.5],                 // Angie's: the warmest pool
    [1112, 244, 40, P.neonPink, PAUSED ? 0.16 : 0.34],
    [1168, 132, 22, P.neonCyan, 0.32],              // hut window
    [1134, 152, 18, P.neonCyan, 0.34],              // vending machine
    [1102, 166, 26, P.neonPink, 0.3],               // selfie wall
    [1029, 200, 28, P.neonPink, 0.34],              // pole sign
    [906, 210, 28, P.neonViolet, 0.32],             // the mast
    [1163, 256, 16, '#7fefff', 0.42],               // the spring
    [1000, 150, 110, P.neonViolet, 0.16],
  ];
  if (GROWTH >= 1) POOLS.push([1180, 184, 30, '#ff7040', 0.32]);
  if (GROWTH >= 2) POOLS.push([938, 100, 28, P.neonViolet, 0.3]);
  if (GROWTH >= 3) POOLS.push([1184, 230, 30, P.neonViolet, 0.28]);
  const PUDDLES = [[1000, 228, 10, 3], [1132, 196, 7, 2], [952, 176, 6, 2]];
  const PAVE_IN = 13; // pavement starts this far (px) inside the rim, leaving a ring of glowing turf

  const inLane = (x, y) => x >= LANE_R.x0 && x < LANE_R.x1 && y >= LANE_R.y0 && y < LANE_R.y1;
  /** Distance into the pavement (px, ragged); < 0 is turf. */
  const paveDist = (x, y) => GEO.din(x, y) - PAVE_IN + (vnoise(x / 7, y / 7, 760) - 0.5) * 7;

  const groundCache = {};
  function buildGround(sea) {
    const X0 = GEO.ox, Y0 = GEO.oy, W = GEO.bw, H = GEO.bh;
    const [cv, g] = mk(W, H);
    const img = g.createImageData(W, H), d = img.data;
    const rgb = (h) => C.hexToRgb(h);
    const pal = {}; for (const k in PLUM) pal[k] = rgb(PLUM[k]);
    const ln = {}; for (const k in LANE) ln[k] = rgb(LANE[k]);
    const cb = {}; for (const k in CURB) cb[k] = rgb(CURB[k]);
    const pools = POOLS.map(([x, y, r, c, s]) => [x, y, r, rgb(c), s]);
    const snow = rgb(P.snow), snowD = rgb('#c4cfe0');
    const winter = sea === 'winter';
    const set = (i, c) => { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const paint = { ring: rgb('#58d6e8'), tri: rgb('#ff6fb5'), dot: rgb('#ffe45c') };
    const confetti = RAINBOW.map(rgb);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const wx = X0 + x, wy = Y0 + y;
      if (!GEO.on(wx, wy)) continue;
      const dd = paveDist(wx, wy);
      if (dd < 0) continue;
      const i = (y * W + x) * 4;
      let c;
      if (dd < 1) c = cb.line;
      else if (dd < 3.2) {
        // raised curb: faces turned to the top-left catch the light
        const gx = GEO.din(wx + 1, wy) - GEO.din(wx - 1, wy), gy = GEO.din(wx, wy + 1) - GEO.din(wx, wy - 1);
        const lit = gx + gy > 0;
        const along = Math.abs(gx) > Math.abs(gy) ? wy : wx;
        if (along % 11 === 0) c = cb.dark;
        else c = lit ? (dd < 2 ? cb.light : cb.base) : (dd < 2 ? cb.dark : cb.base);
        if (S.hash(wx, wy, 701) < 0.08) c = cb.hi;
      } else if (dd < 4.2) c = pal.grout;
      else if (inLane(wx, wy)) {
        // the lane: glazed square tiles with LED strips along both edges
        const ex = Math.min(wx - LANE_R.x0, LANE_R.x1 - 1 - wx);
        if (ex === 0) c = ln.grout;
        else if (ex === 1) c = ((wy >> 2) & 3) === 3 ? ln.grout : rgb((wx < 1056) === ((wy >> 4) % 2 === 0) ? P.neonPink : P.neonCyan);
        else if (ex === 2) c = ln.grout;
        else {
          const lx = (wx - LANE_R.x0 - 3) % 9, ly = (wy - LANE_R.y0) % 9;
          const ph = S.hash(Math.floor((wx - LANE_R.x0 - 3) / 9), Math.floor((wy - LANE_R.y0) / 9), 710);
          const tone = ph < 0.25 ? ln.dark : ph < 0.85 ? ln.base : ln.light;
          if (lx === 0 || ly === 0) c = ln.grout;
          else if (lx === 1 || ly === 1) c = ln.hi;
          else if (lx === 8 || ly === 8) c = ln.dark;
          else c = S.hash(wx, wy, 711) < 0.06 ? ln.light : tone;
          if (lx === 4 && ly === 4 && ph > 0.9) c = ln.hi;
        }
      } else {
        // basketweave pavers: 8x8 cells of two bricks, alternating direction
        const cx = wx >> 3, cy = wy >> 3, lx = wx & 7, ly = wy & 7, hor = ((cx + cy) & 1) === 0;
        const half = hor ? (ly >> 2) : (lx >> 2), bx = hor ? lx : lx & 3, by = hor ? ly & 3 : ly;
        const bw = hor ? 8 : 4, bh = hor ? 4 : 8;
        const ph = S.hash(cx * 2 + half, cy, 702);
        const tone = ph < 0.2 ? pal.dark : ph < 0.76 ? pal.base : ph < 0.94 ? pal.light : pal.deep;
        if (bx === 0 || by === 0) c = pal.grout;
        else if (by === 1 || bx === 1) c = ph < 0.2 ? pal.base : ph < 0.76 ? pal.light : pal.hi;
        else if (by === bh - 1 || bx === bw - 1) c = ph < 0.2 ? pal.deep : pal.dark;
        else {
          c = tone;
          const n = S.hash(wx, wy, 703);
          if (n < 0.04) c = pal.light; else if (n > 0.97) c = pal.deep;
          if (ph > 0.994 && bx === 2 && by === 2) c = rgb(cy & 1 ? P.neonCyan : P.neonPink);
        }
      }
      // light pools (neon spilling onto the stone), dithered in steps
      if (dd >= 1) {
        let acc = [c[0], c[1], c[2]];
        for (const [px, py, r, pc, s] of pools) {
          const ddx = wx - px, ddy = (wy - py) * 1.35, q = (ddx * ddx + ddy * ddy) / (r * r);
          if (q >= 1) continue;
          const f = s * (1 - q) * (1 - q);
          const qf = Math.floor(f * 8 + bayer(wx, wy)) / 8;
          if (qf > 0) acc = lerp(acc, pc, qf);
        }
        c = acc;
      }
      // puddles: darker, glossy, with streaky neon reflections
      if (dd >= 5) for (const [px, py, rx, ry] of PUDDLES) {
        const e = ((wx - px) / rx) ** 2 + ((wy - py) / ry) ** 2 + (vnoise(wx * 0.35, wy * 0.5, 704) - 0.5) * 0.6;
        if (e < 1) {
          c = lerp(rgb('#2a2045'), c, 0.45);
          if (Math.abs(wx - px + 2) < 1.5 && ((wy + wx) & 1)) c = lerp(c, rgb(px < 1060 ? P.neonPink : P.neonCyan), 0.35);
          if (e > 0.62 && wy <= py) c = lerp(c, rgb('#8c7cb8'), 0.4);
        }
      }
      // painted mural: a faded "play" badge in front of Angie's
      {
        const mx = wx - MURAL.x, my = (wy - MURAL.y) * 1.3, mr = Math.sqrt(mx * mx + my * my);
        const worn = S.hash(wx, wy, 705) < 0.22;
        if (!worn && dd >= 5) {
          if (mr > 11.2 && mr < 13.8) c = lerp(c, paint.ring, 0.42);
          else if (mx > -4 && mx < 6 && Math.abs(my) < (6 - mx) * 0.75) c = lerp(c, paint.tri, 0.42);
          else if (mr > 15.5 && mr < 16.5 && (Math.round(Math.atan2(my, mx) * 6) & 1)) c = lerp(c, paint.dot, 0.35);
        }
      }
      // confetti from past launches
      if (dd >= 5 && S.hash(wx, wy, 706) < 0.0022) c = lerp(c, confetti[(S.hash(wx, wy, 707) * 6) | 0], 0.75);
      if (winter && dd >= 1) {
        // drifts along the curb and in soft patches; snow packed into the grout; the lane is swept
        const n = vnoise(wx * 0.045, wy * 0.06, 709) + (vnoise(wx * 0.2, wy * 0.2, 712) - 0.5) * 0.25;
        const edge = dd < 9 ? (9 - dd) / 9 : 0;
        const v = n * 0.82 + edge * 0.7 - (inLane(wx, wy) ? 0.35 : 0);
        const isGrout = c === pal.grout || c === pal.deep;
        if (v > 0.68) c = v > 0.74 || bayer(wx, wy) < (v - 0.68) / 0.06 ? (v > 0.9 ? snow : lerp(snow, snowD, 0.4)) : c;
        else if (isGrout && v > 0.4) c = snowD;
        else if (S.hash(wx, wy, 708) < 0.012) c = snow;
      }
      set(i, c);
    }
    g.putImageData(img, 0, 0);
    drawSpring(g, X0, Y0, winter);
    return cv;
  }

  /* The neon spring: a little stone-rimmed pool whose overflow runs down a
   * channel to the south-east lip, where the waterfall takes over (dyn 100). */
  const FALL = [];
  for (let k = 0; k < FALL_W; k++) { const x = FALL_X0 + k; FALL.push({ x, lip: GEO.bot(x) + 1, bot: GEO.bot(x) + 1 + FALL_SHEET }); }
  // the sheet hugs the rock face down to where the underside ends under each column
  for (const f of FALL) { const u = GEO.under(f.x); if (u > f.lip + 6) f.bot = u; }
  function drawSpring(g, X0, Y0, winter) {
    const W_ = winter ? { deep: '#6f8fd8', base: '#a8c8f0', light: '#d8ecff', white: '#ffffff' } : { deep: FALLC.deep, base: FALLC.dark, light: FALLC.base, white: FALLC.light };
    const { x: cx, y: cy, rx, ry } = POOL;
    // channel to the lip
    for (const f of FALL) for (let y = cy; y < f.lip; y++) {
      const k = f.x - FALL_X0;
      const c = k === 0 || k === FALL_W - 1 ? CURB.dark : k === 1 ? W_.light : (y + k) % 5 === 0 ? W_.light : W_.base;
      D(g, f.x - X0, y - Y0, c);
    }
    for (const f of FALL) { D(g, f.x - X0, f.lip - 1 - Y0, W_.white); }
    // stone rim, then water
    for (let y = -ry - 2; y <= ry + 2; y++) for (let x = -rx - 3; x <= rx + 3; x++) {
      const e = (x * x) / ((rx + 2.5) * (rx + 2.5)) + (y * y) / ((ry + 2) * (ry + 2));
      if (e > 1) continue;
      const inner = (x * x) / (rx * rx) + (y * y) / (ry * ry);
      let c;
      if (inner > 1) c = y < 0 || x < -rx + 1 ? CURB.light : CURB.dark;
      else if (inner > 0.7) c = y < 0 ? W_.deep : W_.base;
      else c = (x + y * 2) % 7 === 0 ? W_.white : y < 0 ? W_.base : W_.light;
      if (inner > 1 && S.hash(x, y, 765) < 0.12) c = CURB.hi;
      D(g, cx + x - X0, cy + y - Y0, c);
    }
    D(g, cx - 3 - X0, cy - 1 - Y0, W_.white); D(g, cx - 2 - X0, cy - 1 - Y0, W_.white);
  }

  /* ========================================================= NEON SIGNS */
  const ICONS = {
    heart: mask(['.##...##.', '#..#.#..#', '#...#...#', '#.......#', '.#.....#.', '..#...#..', '...#.#...', '....#....']),
    star: mask(['....#....', '...#.#...', '...#.#...', '###...###', '.#.....#.', '..#...#..', '..#.#.#..', '.#.#.#.#.', '.##...##.']),
    note: mask(['..######', '..#....#', '..######', '..#....#', '..#....#', '###..###', '###..###']),
    cup: mask(['..#..#...', '...#..#..', '..#..#...', '.........', '#######..', '#.....###', '#.....#.#', '#.....###', '.#...#...', '..###....']),
    spinner: mask(['....###....', '...#...#...', '...#...#...', '....#.#....', '.##..#..##.', '#..#...#..#', '#...###...#', '.###...###.']),
    play: mask(['.#########.', '#...#.....#', '#...##....#', '#...#.#...#', '#...##....#', '#...#.....#', '.#########.']),
    pause: mask(['.#######.', '#.......#', '#.##.##.#', '#.##.##.#', '#.##.##.#', '#.......#', '.#######.']),
    waves: mask(['.#.......#.', '#..#...#..#', '#.#..#..#.#', '#..#...#..#', '.#.......#.']),
    bowl: mask(['.....#..#', '....#..#.', '#########', '#.......#', '.#.....#.', '..#####..']),
  };

  /** Neon sign sprites (lit tube + halo) cached per icon+colour. */
  const neonCache = {};
  function neonSprites(icon, col) {
    const key = icon + col;
    if (neonCache[key]) return neonCache[key];
    const m = ICONS[icon], pad = 4, w = m.w + pad * 2, h = m.h + pad * 2;
    const on = new Uint8Array(w * h);
    for (const [x, y] of m.pts) on[(y + pad) * w + x + pad] = 1;
    const dist = new Float32Array(w * h).fill(99);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (on[y * w + x]) { dist[y * w + x] = 0; continue; }
      let best = 99;
      for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
        const xx = x + i, yy = y + j;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || !on[yy * w + xx]) continue;
        best = Math.min(best, Math.sqrt(i * i + j * j));
      }
      dist[y * w + x] = best;
    }
    const [lit, lg] = mk(w, h), [halo, hg] = mk(w, h);
    const core = mix(col, '#ffffff', 0.62);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dd = dist[y * w + x];
      if (dd === 0) D(lg, x, y, core);
      else if (dd <= 1.01) { lg.globalAlpha = 0.9; D(lg, x, y, col); lg.globalAlpha = 1; }
      if (dd > 0 && dd <= 3.2) {
        const a = dd <= 1.5 ? 0.55 : dd <= 2.3 ? 0.3 : ((x + y) & 1 ? 0.16 : 0);
        if (a) { hg.globalAlpha = a; D(hg, x, y, col); }
      }
    }
    hg.globalAlpha = 1;
    return (neonCache[key] = { lit, halo, pad, w: m.w, h: m.h });
  }
  /** Dark backing board with the unlit glass tubes (static). */
  function neonBoard(g, x, y, icon, col, opts = {}) {
    const m = ICONS[icon], bw = m.w + 6, bh = m.h + 6;
    if (opts.board !== false) {
      R(g, x - 1, y - 1, bw + 2, bh + 2, OUT);
      R(g, x, y, bw, bh, '#1f1832');
      R(g, x, y, bw, 1, '#3a3054'); R(g, x, y, 1, bh, '#2f2745');
      R(g, x, y + bh - 1, bw, 1, '#140f22');
      D(g, x + 1, y + 1, '#8a80a8'); D(g, x + bw - 2, y + 1, '#8a80a8'); D(g, x + 1, y + bh - 2, '#5a5078'); D(g, x + bw - 2, y + bh - 2, '#5a5078');
    }
    const glass = mix(col, '#2a2238', 0.5);
    for (const [px, py] of m.pts) D(g, x + 3 + px, y + 3 + py, glass);
  }
  const SIGNS = [];   // {icon, col, x, y (icon top-left), dim, opts}
  function sign(icon, col, bx, by, opts) { SIGNS.push({ icon, col, x: bx + 3, y: by + 3, opts: opts || {}, dim: !!(opts && opts.dim) }); return [bx, by]; }

  const SIGN_ANG = sign('cup', NEON.amber, ANG.x + 37, ANG.y - 2);
  const SIGN_ANG2 = sign('heart', NEON.pink, ANG.x + 6, ANG.y + 2);
  const SIGN_FID1 = sign('spinner', NEON.cyan, FID.x + 18, FID.y - 2, { dim: PAUSED });
  const SIGN_FID2 = sign('play', NEON.pink, FID.x + 44, FID.y - 1, { dim: PAUSED });
  const SIGN_PAUSE = PAUSED ? sign('pause', NEON.amber, FID.x + 33, FID.y + 43, { pause: true }) : null;
  const SIGN_HUT = sign('waves', NEON.cyan, HUT.x + 14, HUT.y + 6);
  sign('heart', NEON.pink, POLE.x - 1, POLE.y, { board: false });
  sign('star', NEON.yellow, POLE.x - 1, POLE.y + 11, { board: false });
  sign('note', NEON.cyan, POLE.x, POLE.y + 23, { board: false });
  sign('heart', NEON.pink, SELFIE.x + 12, SELFIE.y + 3, { board: false, glassOnWall: true });
  if (GROWTH >= 1) sign('bowl', NEON.amber, NOOD.x + 21, NOOD.y - 2);
  if (GROWTH >= 2) sign('star', NEON.yellow, STK.x + 19, STK.y - 4);

  /* ============================================================ SPRITES */
  const spriteCache = {};
  const cached = (key, fn) => spriteCache[key + season()] || (spriteCache[key + season()] = fn());
  const winterNow = () => season() === 'winter';
  function snowCap(g, x, y, w, seed) {
    R(g, x, y, w, 2, P.snow);
    for (let i = 0; i < w; i++) {
      if (S.hash(i, seed, 711) < 0.45) D(g, x + i, y + 2, P.snow);
      if (S.hash(i, seed, 712) < 0.2) D(g, x + i, y + 1, '#d4deea');
    }
  }
  function stripes(defs) { return defs.map((c) => ({ base: c, light: sh(c, 0.18), dark: sh(c, -0.22) })); }
  /** Striped awning seen from above-front, with a scalloped hem. */
  function awning(g, x, y, w, h, st, sw, scal = 2) {
    for (let i = 0; i < w; i++) {
      const k = Math.floor(i / sw) % st.length, s = st[k], li = i % sw;
      for (let j = 0; j < h; j++) {
        let c = j < Math.ceil(h * 0.4) ? s.light : s.base;
        if (j === h - 1 || (li === sw - 1 && j > 0)) c = s.dark;
        if (j === 0) c = sh(s.light, 0.1);
        D(g, x + i, y + j, c);
      }
      const centre = (sw - 1) / 2, e = Math.abs(li - centre) / Math.max(1, centre);
      const ext = e < 0.45 ? scal : e < 0.85 ? scal - 1 : 0;
      for (let j = 0; j < ext; j++) D(g, x + i, y + h + j, j === ext - 1 ? s.dark : s.base);
    }
  }
  function planks(g, x, y, w, h, pal, step = 5) {
    R(g, x, y, w, h, pal.base);
    for (let i = 0; i < w; i++) {
      const k = i % step;
      if (k === 0) R(g, x + i, y, 1, h, pal.dark);
      else if (k === 1) R(g, x + i, y, 1, h, pal.light);
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (S.hash(x + i, y + j, 713) < 0.06) D(g, x + i, y + j, pal.dark);
    R(g, x, y, w, 1, pal.hi); R(g, x, y + h - 1, w, 1, pal.deep);
  }
  function popit(g, x, y, cols, rows, fade) {
    for (let j = 0; j < rows; j++) {
      const c = fade ? mix(RAINBOW[j % 6], '#3a2c50', fade) : RAINBOW[j % 6];
      R(g, x, y + j * 2, cols * 2 + 1, 2, sh(c, -0.25));
      for (let i = 0; i < cols; i++) { D(g, x + 1 + i * 2, y + j * 2, sh(c, 0.35)); D(g, x + 1 + i * 2, y + j * 2 + 1, c); }
    }
  }
  function tinySpinner(g, x, y, c) {
    D(g, x + 1, y, c); D(g, x, y + 2, c); D(g, x + 2, y + 2, c); D(g, x + 1, y + 1, '#e8e4f0');
  }

  /* ---- billboard ---- */
  function billboardSprite() {
    return cached('bb', () => build(BB.w, BB.h, (g) => {
      // legs + bracing
      for (const lx of [14, 78]) {
        R(g, lx, 34, 4, 20, STEEL.base); R(g, lx, 34, 1, 20, STEEL.light); R(g, lx + 3, 34, 1, 20, STEEL.deep);
        for (let yy = 37; yy < 52; yy += 4) D(g, lx + 1, yy, STEEL.hi);
        R(g, lx - 2, 52, 8, 5, CONC.base); R(g, lx - 2, 52, 8, 1, CONC.hi); R(g, lx - 2, 52, 1, 5, CONC.light); R(g, lx - 2, 56, 8, 1, CONC.dark);
      }
      R(g, 18, 44, 60, 2, STEEL.dark); R(g, 18, 44, 60, 1, STEEL.light);
      L(g, 18, 37, 47, 44, STEEL.dark); L(g, 77, 37, 48, 44, STEEL.dark);
      L(g, 18, 36, 47, 43, STEEL.base); L(g, 77, 36, 48, 43, STEEL.base);
      // fly-posters pasted on the legs
      R(g, 14, 40, 4, 6, '#ff9ac8'); R(g, 14, 40, 4, 1, '#ffd0e6'); D(g, 15, 42, '#7a2a50'); D(g, 16, 43, '#7a2a50');
      R(g, 78, 46, 4, 5, '#9ff0ff'); R(g, 78, 46, 4, 1, '#e0fbff'); D(g, 79, 48, '#1f5a66');
      // ladder up the right leg
      for (let yy = 36; yy < 52; yy += 3) R(g, 83, yy, 3, 1, STEEL.light);
      R(g, 83, 35, 1, 18, STEEL.dark); R(g, 86, 35, 1, 18, STEEL.dark);
      // frame
      R(g, 0, 0, 96, 33, STEEL.dark);
      R(g, 0, 0, 96, 1, STEEL.hi); R(g, 0, 1, 96, 1, STEEL.light); R(g, 0, 0, 1, 33, STEEL.light);
      R(g, 95, 0, 1, 33, STEEL.deep); R(g, 0, 32, 96, 1, STEEL.deep);
      for (let xx = 6; xx < 92; xx += 8) { D(g, xx, 1, STEEL.hi); D(g, xx, 31, STEEL.base); }
      R(g, 3, 2, 90, 29, '#120f1d');
      R(g, 4, 3, 88, 27, '#0a0d1c');
      // catwalk
      R(g, 1, 32, 94, 4, STEEL.base);
      for (let xx = 2; xx < 94; xx += 2) D(g, xx, 33, STEEL.dark);
      for (let xx = 3; xx < 94; xx += 2) D(g, xx, 34, STEEL.deep);
      R(g, 1, 35, 94, 1, STEEL.deep);
      R(g, 1, 31, 94, 1, STEEL.hi);
      for (let xx = 1; xx < 96; xx += 9) R(g, xx, 31, 1, 5, STEEL.light);
      // spotlights pointing up at the screen
      for (const lx of [16, 46, 76]) { R(g, lx, 29, 5, 3, STEEL.deep); R(g, lx + 1, 29, 3, 1, '#fff2b8'); D(g, lx + 2, 32, STEEL.light); }
      if (winterNow()) { R(g, 0, -1, 96, 2, P.snow); for (let i = 0; i < 96; i += 3) D(g, i, 1, '#d4deea'); }
    }, OUT));
  }

  /* ---- equipment hut with the broadcast tower on its roof ---- */
  function hutSprite() {
    return cached('hut', () => build(HUT.w, HUT.h, (g) => {
      const w = HUT.w;
      R(g, 0, 0, w, 8, CONC.light);
      for (let j = 1; j < 7; j++) for (let i = 1; i < w - 1; i++) if (S.hash(i, j, 714) < 0.12) D(g, i, j, CONC.base);
      R(g, 0, 0, w, 1, CONC.hi); R(g, 0, 7, w, 1, CONC.base);
      R(g, 0, 0, 1, 8, CONC.hi); R(g, w - 1, 0, 1, 8, CONC.base);
      R(g, 9, 3, 4, 3, CONC.dark); R(g, 31, 3, 4, 3, CONC.dark);
      R(g, 34, 0, 9, 6, '#b8b4c6'); R(g, 34, 0, 9, 1, '#e2def0'); R(g, 34, 5, 9, 1, '#7f7a92');
      R(g, 36, 1, 5, 4, '#5a5570'); D(g, 38, 3, '#2a2638'); D(g, 37, 2, '#8a85a0'); D(g, 39, 2, '#8a85a0');
      R(g, 14, 5, 18, 1, STEEL.dark);
      // front wall
      R(g, 0, 8, w, 20, '#5b5073');
      for (let xx = 0; xx < w; xx += 7) R(g, xx, 8, 1, 20, '#4a4062');
      R(g, 0, 8, w, 1, '#3a3150'); R(g, 0, 9, w, 1, '#776c90'); R(g, 0, 26, w, 2, '#433a5a');
      R(g, 0, 8, 1, 20, '#776c90');
      // window full of monitor glow
      R(g, 3, 13, 10, 7, '#1a2238'); R(g, 4, 14, 3, 2, '#5ff0ff'); R(g, 8, 14, 4, 2, '#ff6fb5'); R(g, 4, 17, 8, 2, '#3a6aa8'); D(g, 5, 17, '#9ff6ff');
      R(g, 3, 12, 10, 1, '#2a2340'); R(g, 3, 20, 10, 1, CONC.hi);
      // door
      R(g, 18, 15, 9, 13, '#3a3550'); R(g, 18, 15, 9, 1, '#6a6488'); R(g, 18, 15, 1, 13, '#57517a');
      D(g, 25, 21, P.gold); R(g, 19, 18, 7, 1, '#2c283e'); R(g, 19, 23, 7, 1, '#2c283e');
      R(g, 17, 27, 11, 1, CONC.hi);
      // vent grille + sticker
      R(g, 31, 13, 9, 6, '#3c3452'); for (let j = 14; j < 19; j += 2) R(g, 32, j, 7, 1, '#7a7096');
      R(g, 33, 21, 4, 3, '#ffe45c'); D(g, 34, 22, '#ff4fa3');
      if (winterNow()) snowCap(g, 0, 0, w, 7);
    }, OUT));
  }
  function dishSprite() {
    return cached('dish', () => build(11, 13, (g) => {
      const rows = ['...####....', '..#oooo#...', '.#ooooo#...', '#ooooooo#..', '#oooooooo#.', '#ooooooo#..', '#ooooooo#..', '.#oooooo#..', '..#oooo#...', '...####....'];
      rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] !== '.') D(g, i, j + 1, r[i] === '#' ? '#8f8aa6' : (i + j < 7 ? '#ffffff' : i > 5 ? '#b9b4cc' : '#e4e0ee')); });
      R(g, 6, 4, 1, 4, '#9a95ad');
      L(g, 3, 5, 0, 5, '#4a4764'); D(g, 0, 5, '#2a2638');
      R(g, 8, 5, 3, 2, STEEL.base);
    }, OUT));
  }
  function drawTower(ctx) {
    const { cx, base, top } = TWR;
    const span = base - top;
    const hw = (y) => Math.round(2 + (y - top) / span * 10);
    const SEC = 8;
    const band = (y) => Math.floor((y - top) / SEC) % 2 === 0;   // aviation paint: red / white sections
    const winter = winterNow();
    // guy wires down to two anchors on the plaza
    const ga = [[HUT.x - 12, HUT.y + 4], [HUT.x + 54, HUT.y + 4]];
    ctx.globalAlpha = 0.75;
    L(ctx, cx - 4, top + 14, ga[0][0], ga[0][1], '#241c36'); L(ctx, cx + 4, top + 14, ga[1][0], ga[1][1], '#241c36');
    L(ctx, cx - 7, top + 34, ga[0][0], ga[0][1], '#241c36'); L(ctx, cx + 7, top + 34, ga[1][0], ga[1][1], '#241c36');
    ctx.globalAlpha = 1;
    for (const [ax, ay] of ga) { R(ctx, ax - 3, ay - 1, 6, 4, OUT); R(ctx, ax - 2, ay, 4, 2, CONC.light); R(ctx, ax - 2, ay, 4, 1, CONC.hi); }
    // the dark gap between the legs (so the bracing reads against the plaza / the stars)
    // cross bracing: one X and one rung per section, lit strut and shaded strut
    for (let y = top + 4; y < base; y += SEC) {
      const y2 = Math.min(base, y + SEC);
      const a = cx - hw(y) + 2, b = cx + hw(y) - 2, a2 = cx - hw(y2) + 2, b2 = cx + hw(y2) - 2;
      if (b - a >= 2) { L(ctx, a, y, b2, y2, '#6b688b'); L(ctx, b, y, a2, y2, '#4a4764'); }
      R(ctx, a2 - 1, y2, b2 - a2 + 3, 1, '#9c99ba');
    }
    // two legs: a 1 px outline outside, a lit face and a shaded face
    for (let y = top; y <= base; y++) {
      const w = hw(y), xl = cx - w, xr = cx + w, red = band(y);
      D(ctx, xl - 1, y, OUT); D(ctx, xl, y, red ? '#f0604e' : '#ffffff'); D(ctx, xl + 1, y, red ? '#b8382e' : '#c8c2d8');
      D(ctx, xr - 1, y, red ? '#a8302a' : '#b0aac4'); D(ctx, xr, y, red ? '#7e201c' : '#8a849e'); D(ctx, xr + 1, y, OUT);
    }
    R(ctx, cx - hw(top) - 1, top - 1, hw(top) * 2 + 3, 1, OUT);
    // platforms with a railing
    for (const py of [top + 16, top + 38]) {
      const w2 = hw(py) + 4;
      R(ctx, cx - w2 - 1, py - 1, w2 * 2 + 3, 4, OUT);
      R(ctx, cx - w2, py, w2 * 2 + 1, 2, STEEL.light); R(ctx, cx - w2, py, w2 * 2 + 1, 1, winter ? P.snow : STEEL.hi); D(ctx, cx + w2, py + 1, STEEL.dark);
      R(ctx, cx - w2, py - 4, w2 * 2 + 1, 1, '#9c99ba');
      for (let x = cx - w2; x <= cx + w2; x += 3) R(ctx, x, py - 3, 1, 3, '#6b688b');
      D(ctx, cx - w2, py - 4, '#c8c4dc');
    }
    // panel antennas on the upper platform
    for (const ox of [-hw(top + 16) - 3, hw(top + 16) + 1]) {
      R(ctx, cx + ox - 1, top + 3, 4, 13, OUT); R(ctx, cx + ox, top + 4, 2, 11, '#e4e0ee'); R(ctx, cx + ox, top + 4, 1, 11, '#ffffff'); D(ctx, cx + ox + 1, top + 14, '#9a95ad');
    }
    // the dish on the lower platform, pointed west toward Clockspire
    place(ctx, dishSprite(), cx - hw(top + 38) - 12, top + 25);
    // top mast + beacon housing
    R(ctx, cx - 1, top - 9, 3, 9, OUT); R(ctx, cx, top - 8, 1, 8, '#d8d4e6');
    R(ctx, cx - 2, top - 11, 5, 3, OUT); R(ctx, cx - 1, top - 10, 3, 1, '#7a1d1a');
    if (winter) { R(ctx, cx - 1, top - 12, 3, 1, P.snow); }
  }

  /* ---- the blimp mooring mast: a tall neon-trimmed lattice with a docking ring ---- */
  const MAST_FOOT = MAST.base - 9, MAST_HEADB = MAST.top + 11;
  const mastHW = (y) => Math.round(3 + (y - MAST_HEADB) / (MAST_FOOT - MAST_HEADB) * 4.5);
  /* The mast's glows (lit at 700), cached once and shaped like what they light, never boxes:
   * the docking ring's neon halo uses the signs' halo recipe traced from the oval the lit tube
   * follows, a dithered oval bloom spreads from it into space after dark, and a violet column
   * follows the lattice's taper with a dithered fringe. */
  const HOOP = { rx: 3, ry: 7 };   // the lit tube's oval, one px inside the ring's rim (rx 4, ry 8)
  ICONS.hoop = (function () {
    const rows = [];
    for (let y = 0; y <= HOOP.ry * 2; y++) rows.push(new Array(HOOP.rx * 2 + 1).fill('.'));
    for (let a = 0; a < 48; a++) { const an = a / 48 * Math.PI * 2; rows[Math.round(Math.sin(an) * HOOP.ry) + HOOP.ry][Math.round(Math.cos(an) * HOOP.rx) + HOOP.rx] = '#'; }
    return mask(rows.map((r) => r.join('')));
  })();
  let dockBloomC = null, mastGlowC = null;
  const MAST_GLOW_HW = 12;
  function dockBloom() {
    if (dockBloomC) return dockBloomC;
    const RX = 9, RY = 13, [c, g] = mk(RX * 2 + 1, RY * 2 + 1);
    for (let y = -RY; y <= RY; y++) for (let x = -RX; x <= RX; x++) {
      const e = Math.sqrt((x * x) / (RX * RX) + (y * y) / (RY * RY));
      // flat in the middle (the halo already lights the tube), dithered toward the rim
      const a = e < 0.72 ? 0.3 : e < 1 && bayer(x + RX, y + RY) < (1 - e) / 0.28 * 0.6 ? 0.18 : 0;
      if (a) { g.globalAlpha = a; D(g, x + RX, y + RY, P.neonPink); }
    }
    g.globalAlpha = 1;
    return (dockBloomC = c);
  }
  function mastGlow() {
    if (mastGlowC) return mastGlowC;
    const h = MAST_FOOT - MAST_HEADB, [c, g] = mk(MAST_GLOW_HW * 2 + 1, h);
    g.fillStyle = P.neonViolet;
    for (let j = 0; j < h; j++) {
      const w = mastHW(MAST_HEADB + j) + 1, end = Math.min(1, (j + 1) / 6, (h - j) / 4);
      for (let i = -w - 2; i <= w + 2; i++) {
        const fringe = Math.abs(i) > w ? (Math.abs(i) - w) / 3 : 0;
        if (bayer(i + MAST_GLOW_HW, j) < end * (1 - fringe)) g.fillRect(i + MAST_GLOW_HW, j, 1, 1);
      }
    }
    return (mastGlowC = c);
  }
  function drawMast(ctx) {
    const { x, base, top } = MAST, winter = winterNow();
    const foot = MAST_FOOT, headB = MAST_HEADB;
    groundShadow(ctx, x + 6, base, 13, 3, 0.26);
    // plum stone footing with a cyan strip
    R(ctx, x - 11, base - 9, 23, 10, OUT);
    R(ctx, x - 10, base - 8, 21, 8, CONC.base); R(ctx, x - 10, base - 8, 21, 1, CONC.hi); R(ctx, x - 10, base - 8, 1, 8, CONC.light); R(ctx, x + 10, base - 8, 1, 8, CONC.dark);
    R(ctx, x - 10, base - 1, 21, 1, CONC.deep);
    R(ctx, x - 9, base - 5, 19, 1, '#2fb8c8'); D(ctx, x - 9, base - 5, '#9ff6ff'); D(ctx, x - 4, base - 5, '#9ff6ff');
    // tapered lattice: two legs (lit west face, shaded east face), X bracing between
    const hw = mastHW;
    for (let y = headB + 2; y < foot; y += 7) {
      const y2 = Math.min(foot, y + 7), a = x - hw(y) + 2, b = x + hw(y) - 2, a2 = x - hw(y2) + 2, b2 = x + hw(y2) - 2;
      if (b - a >= 1) { L(ctx, a, y, b2, y2, '#6b5a94'); L(ctx, b, y, a2, y2, '#3e3260'); }
      R(ctx, a2 - 1, y2, b2 - a2 + 3, 1, '#8d7cb8');
    }
    for (let y = headB; y < foot; y++) {
      const w = hw(y);
      D(ctx, x - w - 1, y, OUT); D(ctx, x - w, y, '#c8b8ec'); D(ctx, x - w + 1, y, '#8a76c0');
      D(ctx, x + w - 1, y, '#5a4888'); D(ctx, x + w, y, '#3a2c62'); D(ctx, x + w + 1, y, OUT);
    }
    // the unlit glass of the neon tube that spirals up the front (lit at 700)
    for (let y = headB + 2; y < foot - 1; y++) D(ctx, x + Math.round(Math.sin(y * 0.35) * (hw(y) - 1)), y, '#5a2a52');
    // ladder rungs up the middle
    for (let y = headB + 20; y < foot - 1; y += 3) D(ctx, x, y, '#c9a24a');
    // service platform with a railing, half way up
    const py = top + 44, pw = hw(py) + 5;
    R(ctx, x - pw - 1, py, pw * 2 + 3, 3, OUT); R(ctx, x - pw, py, pw * 2 + 1, 1, winter ? P.snow : STEEL.hi); R(ctx, x - pw, py + 1, pw * 2 + 1, 1, STEEL.base);
    R(ctx, x - pw - 1, py - 5, 1, 5, OUT); R(ctx, x + pw + 1, py - 5, 1, 5, OUT); R(ctx, x - pw - 1, py - 5, pw * 2 + 3, 1, OUT);
    for (let xx = x - pw + 1; xx < x + pw; xx += 3) D(ctx, xx, py - 3, STEEL.light);
    // the mooring head: a violet drum with a gold band and a nose cup facing west
    R(ctx, x - 6, top + 1, 13, 11, OUT);
    R(ctx, x - 5, top + 2, 11, 9, '#6a4a9a'); R(ctx, x - 5, top + 2, 11, 1, '#b49ae0'); R(ctx, x - 5, top + 3, 1, 8, '#9a7ac8');
    R(ctx, x + 4, top + 3, 1, 8, '#4a3478'); R(ctx, x - 5, top + 10, 11, 1, '#3a2a5a');
    R(ctx, x - 5, top + 6, 11, 2, P.goldDark); R(ctx, x - 5, top + 6, 11, 1, P.gold); D(ctx, x - 4, top + 6, '#fff0b0');
    for (let k = -3; k <= 3; k += 3) D(ctx, x + k, top + 4, '#2a1c44');
    // boom out to the docking ring, west over the rim
    const bx0 = DOCK.x + 4, bx1 = x - 6;
    R(ctx, bx0, DOCK.y - 2, bx1 - bx0 + 1, 4, OUT); R(ctx, bx0, DOCK.y - 1, bx1 - bx0, 1, '#c8b8ec'); R(ctx, bx0, DOCK.y, bx1 - bx0, 1, '#5a4888');
    L(ctx, bx1, top + 10, bx0 + 3, DOCK.y + 1, OUT); L(ctx, bx1, top + 11, bx0 + 3, DOCK.y + 2, '#5a4888');
    // the docking ring: a hoop seen side-on, its neon glass dark until lit at 700
    const rx = 4, ry = 8;
    for (let a = 0; a < 80; a++) {
      const an = a / 80 * Math.PI * 2, c = Math.cos(an), sn = Math.sin(an);
      D(ctx, Math.round(DOCK.x + c * (rx + 1)), Math.round(DOCK.y + sn * (ry + 1)), OUT);
      D(ctx, Math.round(DOCK.x + c * (rx - 1)), Math.round(DOCK.y + sn * (ry - 1)), OUT);
    }
    for (let a = 0; a < 80; a++) {
      const an = a / 80 * Math.PI * 2, c = Math.cos(an), sn = Math.sin(an);
      D(ctx, Math.round(DOCK.x + c * rx), Math.round(DOCK.y + sn * ry), c + sn < -0.3 ? '#e8e0ff' : c + sn > 0.6 ? '#4a3c6a' : '#9a8cc0');
    }
    // beacon housing on top
    R(ctx, x - 2, top - 3, 5, 5, OUT); R(ctx, x - 1, top - 2, 3, 3, '#7a2a24'); D(ctx, x - 1, top - 2, '#c8463a');
    // windsock pole
    R(ctx, x + 4, top - 8, 1, 10, OUT);
    if (winter) { R(ctx, x - 10, base - 9, 21, 1, P.snow); R(ctx, x - 5, top + 1, 11, 1, P.snow); R(ctx, bx0, DOCK.y - 2, bx1 - bx0, 1, P.snow); }
  }

  /* ---- Angie's cafe stall: the active client, warm and busy ---- */
  function angieSprite() {
    return cached('ang', () => build(ANG.w, ANG.h, (g) => {
      const w = ANG.w;
      R(g, 39, 10, 2, 5, WOOD.dark); R(g, 52, 10, 2, 5, WOOD.dark);
      const RT = 13, RH = 14;
      for (let j = 0; j < RH; j++) for (let i = 4; i < w - 4; i++) {
        const row = Math.floor(j / 3), off = (row & 1) * 2, lx = (i + off) % 4, ly = j % 3;
        let c = TEAL.base;
        if (ly === 2 || lx === 0) c = TEAL.dark;
        else if (ly === 0 && lx === 1) c = TEAL.light;
        if (j < 3) c = ly === 2 ? TEAL.base : TEAL.light;
        if (S.hash(i, j, 715) < 0.05) c = TEAL.hi;
        D(g, i, RT + j, c);
      }
      R(g, 4, RT, w - 8, 1, TEAL.hi);
      R(g, 4, RT, 1, RH, TEAL.light); R(g, w - 5, RT, 1, RH, TEAL.deep);
      // chimney pipe (the espresso roaster vents up here)
      R(g, 66, RT - 5, 4, 8, STEEL.light); R(g, 66, RT - 5, 1, 8, STEEL.hi); R(g, 69, RT - 5, 1, 8, STEEL.base); R(g, 65, RT - 6, 6, 2, STEEL.base);
      if (winterNow()) snowCap(g, 4, RT, w - 8, 1);
      awning(g, 0, RT + RH - 1, w, 9, [{ base: CREAM.base, light: CREAM.light, dark: CREAM.dark }, { base: TEAL.base, light: TEAL.light, dark: TEAL.dark }], 6, 2);
      if (winterNow()) snowCap(g, 0, RT + RH - 1, w, 2);
      const WY = RT + RH + 10;
      // back wall in warm lamplight
      R(g, 5, WY, w - 10, 12, '#6a3e26');
      for (let i = 5; i < w - 5; i += 6) R(g, i, WY, 1, 12, '#54301d');
      R(g, 5, WY, w - 10, 2, '#3c2216');
      for (let i = 6; i < w - 6; i++) if ((i + WY) % 3 === 0) D(g, i, WY + 2, '#8a5634');
      // shelves with mugs and jars
      for (const sy of [WY + 4, WY + 8]) {
        R(g, 7, sy + 2, 44, 1, WOOD.light); R(g, 7, sy + 3, 44, 1, WOOD.deep);
        for (let i = 0; i < 9; i++) {
          const x = 9 + i * 5, k = S.hash(i, sy, 716);
          if (k < 0.5) { R(g, x, sy, 3, 2, ['#f4ede0', '#e7f0ec', '#7fc4b0', '#f0c8a8'][(k * 8) | 0]); D(g, x + 3, sy, '#d8d0c4'); }
          else { R(g, x, sy - 1, 3, 3, '#e8a04a'); D(g, x, sy - 1, '#ffd890'); R(g, x, sy - 2, 3, 1, '#6a4a2a'); }
        }
      }
      // chalkboard menu (squiggles, no words)
      const cbx = 56, cby = WY + 1;
      R(g, cbx - 1, cby - 1, 19, 11, WOOD.dark); R(g, cbx, cby, 17, 9, '#22342c');
      for (let r = 0; r < 4; r++) {
        const len = 6 + ((S.hash(r, 1, 717) * 6) | 0);
        for (let i = 0; i < len; i++) if (S.hash(i, r, 718) < 0.8) D(g, cbx + 2 + i, cby + 1 + r * 2, i < 2 ? '#ffd27a' : '#dfe8e2');
        D(g, cbx + 14, cby + 1 + r * 2, '#dfe8e2');
      }
      // hanging plant
      R(g, 74, WY, 1, 2, '#2c1914'); R(g, 72, WY + 2, 5, 3, '#b0643a'); D(g, 71, WY + 3, '#4f8f3a'); D(g, 77, WY + 4, '#4f8f3a'); D(g, 73, WY + 5, '#4f8f3a'); D(g, 75, WY + 6, '#3c7a2e');
      const CT = WY + 12;
      R(g, 2, CT, w - 4, 3, '#c99060'); R(g, 2, CT, w - 4, 1, '#ecc08a'); R(g, 2, CT + 2, w - 4, 1, '#8a5a34');
      // copper espresso machine
      R(g, 8, CT - 10, 12, 10, '#b8643a'); R(g, 8, CT - 10, 12, 1, '#f0b07a'); R(g, 8, CT - 10, 1, 10, '#de8a52'); R(g, 19, CT - 10, 1, 10, '#7a3a1e');
      R(g, 9, CT - 9, 2, 5, '#e8a06a'); R(g, 8, CT - 5, 12, 1, '#d8d4e4'); R(g, 8, CT - 4, 12, 1, '#8a869c');
      D(g, 17, CT - 8, '#fbf6ea'); D(g, 16, CT - 8, '#5a2a14'); D(g, 17, CT - 9, '#5a2a14');
      R(g, 11, CT - 3, 4, 1, '#3a3650'); R(g, 4, CT - 3, 7, 1, '#2a2638'); D(g, 4, CT - 4, '#5a5670');
      R(g, 12, CT - 2, 2, 1, '#2a2638'); R(g, 12, CT - 1, 2, 1, '#f4ede0'); D(g, 16, CT - 1, '#f4ede0');
      R(g, 20, CT - 7, 1, 5, '#c8c4dc'); D(g, 21, CT - 2, '#c8c4dc');
      R(g, 9, CT - 12, 10, 2, '#d8d4e4'); R(g, 9, CT - 12, 10, 1, '#ffffff');
      for (let k = 0; k < 4; k++) R(g, 10 + k * 2, CT - 13, 1, 1, k % 2 ? '#e2d6c4' : '#f8f2e8');
      // pastry case
      const px0 = 24, pw = 22;
      R(g, px0, CT - 9, pw, 9, WOOD.dark); R(g, px0 + 1, CT - 8, pw - 2, 7, '#d8eef0'); R(g, px0 + 1, CT - 8, pw - 2, 1, '#f8ffff');
      R(g, px0 + 1, CT - 4, pw - 2, 1, '#9ec2c6');
      for (let i = 0; i < 5; i++) { const x = px0 + 2 + i * 4; R(g, x, CT - 6, 3, 2, '#d99a42'); D(g, x + 1, CT - 6, '#f6c46a'); D(g, x + 2, CT - 5, '#a8682a'); }
      for (let i = 0; i < 5; i++) {
        const x = px0 + 2 + i * 4, c = ['#ff9ac0', '#a8e0b8', '#ffd27a', '#c9a8ff', '#ff9ac0'][i];
        R(g, x, CT - 3, 3, 1, c); R(g, x, CT - 2, 3, 1, '#8a5a34'); D(g, x + 1, CT - 4, '#fff6ea');
      }
      D(g, px0 + 2, CT - 8, '#ffffff'); D(g, px0 + 3, CT - 8, '#ffffff');
      // register, stacked cups, tip jar, flowers
      R(g, 50, CT - 6, 8, 6, '#3c3a4a'); R(g, 50, CT - 6, 8, 1, '#6a6880'); R(g, 51, CT - 8, 6, 2, '#2a2836'); R(g, 52, CT - 8, 4, 1, '#7ff0c0');
      for (let k = 0; k < 4; k++) R(g, 61, CT - 2 - k * 2, 3, 2, k % 2 ? '#f4ede0' : '#e2d6c4');
      R(g, 66, CT - 5, 4, 5, '#cfe8ec'); R(g, 66, CT - 5, 4, 1, '#ffffff'); D(g, 67, CT - 2, P.gold); D(g, 68, CT - 1, P.goldDark); D(g, 67, CT - 1, '#7cb04a');
      R(g, 73, CT - 4, 3, 4, '#5a7ab8'); D(g, 72, CT - 6, '#ff7a3a'); D(g, 74, CT - 7, '#ffb347'); D(g, 76, CT - 6, '#e0402a'); D(g, 74, CT - 5, '#3c7a2e');
      // two to-go cups waiting on the pickup end
      for (const [x, c] of [[44, '#f4ede0'], [47, '#e2d6c4']]) { R(g, x, CT - 4, 2, 4, c); R(g, x, CT - 4, 2, 1, '#6a3a1e'); D(g, x, CT - 2, '#ffb347'); }
      // counter front: walnut planks
      planks(g, 3, CT + 3, w - 6, 13, { deep: '#3a2214', dark: '#5e3a22', base: '#7a4c2c', light: '#94603a', hi: '#b07a4a' }, 6);
      // cork board for pinned posts (polaroids are drawn from data in drawAngiePins)
      R(g, 29, CT + 5, 26, 9, '#3a2214'); R(g, 30, CT + 6, 24, 7, '#c08a52');
      for (let j = 0; j < 7; j++) for (let i = 0; i < 24; i++) if (S.hash(i, j, 719) < 0.25) D(g, 30 + i, CT + 6 + j, '#a87240');
      R(g, 1, WY - 1, 2, CT + 16 - WY, WOOD.light); R(g, w - 3, WY - 1, 2, CT + 16 - WY, WOOD.base);
      // potted mums at both corners
      const pot = { autumn: ['#e8742a', '#b8322a', '#ffb347'], winter: ['#2e6a3a', '#c8202a', '#f4f8fb'], spring: ['#ff8ab8', '#ffd84a', '#ffffff'], summer: ['#e8402a', '#ffd84a', '#ff8ab8'] }[season()] || ['#e8742a', '#b8322a', '#ffb347'];
      for (const px of [74, 4]) {
        R(g, px, CT + 10, 7, 6, '#a0522d'); R(g, px, CT + 10, 7, 1, '#c87a4a'); R(g, px + 6, CT + 10, 1, 6, '#6e3418');
        for (let k = 0; k < 9; k++) D(g, px + ((S.hash(k, px, 720) * 7) | 0), CT + 6 + ((S.hash(k, px + 1, 720) * 4) | 0), pot[k % 3]);
        R(g, px + 1, CT + 9, 5, 1, '#3c7a2e');
      }
    }, OUT));
  }
  function tableSprite() {
    return cached('tbl', () => build(20, 18, (g) => {
      for (const cx of [1, 15]) { R(g, cx, 5, 4, 1, '#2f2c44'); R(g, cx, 1, 1, 5, '#2f2c44'); R(g, cx + 3, 6, 1, 6, '#2f2c44'); R(g, cx, 6, 1, 6, '#2f2c44'); R(g, cx, 5, 4, 1, '#6b688b'); }
      R(g, 8, 8, 1, 9, '#3a3650'); R(g, 6, 16, 5, 1, '#3a3650');
      R(g, 4, 5, 12, 4, '#e9e4f0'); R(g, 5, 4, 10, 1, '#ffffff'); R(g, 4, 8, 12, 1, '#a9a3bb');
      R(g, 6, 4, 3, 2, '#f8f2e8'); D(g, 9, 4, '#d8d0c4'); D(g, 7, 4, '#6a3a1e');
      R(g, 11, 5, 4, 1, '#ffffff'); R(g, 11, 4, 3, 1, '#d99a42'); D(g, 12, 4, '#f6c46a');
    }, OUT));
  }
  function aframeSprite() {
    return cached('afr', () => build(10, 15, (g) => {
      R(g, 0, 0, 10, 15, WOOD.base); R(g, 0, 0, 10, 1, WOOD.hi); R(g, 0, 0, 1, 15, WOOD.light);
      R(g, 1, 1, 8, 11, '#22342c');
      R(g, 2, 3, 5, 1, '#dfe8e2'); R(g, 2, 5, 6, 1, '#dfe8e2'); R(g, 2, 7, 4, 1, '#ffd27a');
      D(g, 3, 9, '#ff9ac0'); D(g, 5, 9, '#ff9ac0'); R(g, 3, 10, 3, 1, '#ff9ac0'); D(g, 4, 11, '#ff9ac0');
      R(g, 0, 12, 2, 3, WOOD.dark); R(g, 8, 12, 2, 3, WOOD.dark);
    }, OUT));
  }

  /* ---- Fidgetly promo stall: on hold, so a little dimmer with the curtain half drawn ---- */
  function fidgetSprite() {
    return cached('fid' + (PAUSED ? 'p' : ''), () => build(FID.w, FID.h, (g) => {
      const w = FID.w, fade = PAUSED ? 0.28 : 0;
      const fc = (c) => (fade ? mix(c, '#3a2c50', fade) : c);
      awning(g, 0, 11, w, 11, stripes(RAINBOW.map(fc)), 5, 2);
      if (winterNow()) snowCap(g, 0, 11, w, 3);
      const WY = 24;
      R(g, 4, WY, w - 8, 14, fc('#cfa874'));
      for (let j = WY + 1; j < WY + 14; j += 3) for (let i = 5; i < w - 4; i += 3) D(g, i, j, fc('#9a7448'));
      R(g, 4, WY, w - 8, 2, '#7a5634');
      popit(g, 7, WY + 3, 3, 4, fade);
      popit(g, 60, WY + 3, 3, 4, fade);
      tinySpinner(g, 17, WY + 4, fc('#ff4f6e')); tinySpinner(g, 22, WY + 7, fc('#3ec8f0')); tinySpinner(g, 17, WY + 9, fc('#ffd84a'));
      tinySpinner(g, 52, WY + 4, fc('#5fd36a')); tinySpinner(g, 54, WY + 9, fc('#9b6bff'));
      for (const [x, y, c] of [[27, WY + 4, '#ffd84a'], [31, WY + 4, '#ff9a3c'], [27, WY + 8, '#3ec8f0']]) { R(g, x, y, 3, 3, fc(c)); D(g, x + 1, y + 1, fc('#cfa874')); D(g, x, y, sh(fc(c), 0.4)); }
      for (const [x, y] of [[44, WY + 4], [44, WY + 9]]) { R(g, x, y, 5, 4, '#3a3650'); R(g, x, y, 2, 2, fc('#ff4f6e')); R(g, x + 3, y, 2, 2, fc('#ffd84a')); R(g, x, y + 2, 2, 2, fc('#3ec8f0')); R(g, x + 3, y + 2, 2, 2, fc('#5fd36a')); }
      R(g, 34, WY + 11, 14, 1, WOOD.light);
      for (let i = 0; i < 4; i++) { const c = fc(['#ff9ac0', '#a6ff5c', '#9ff0ff', '#ffe45c'][i]); R(g, 35 + i * 3, WY + 9, 2, 2, c); D(g, 35 + i * 3, WY + 9, '#ffffff'); }
      const CT = WY + 14;
      R(g, 2, CT, w - 4, 3, '#ece8f4'); R(g, 2, CT, w - 4, 1, '#ffffff'); R(g, 2, CT + 2, w - 4, 1, '#a9a3bb');
      for (const [x, c] of [[6, '#ff4f6e'], [12, '#3ec8f0'], [56, '#ffd84a'], [62, '#9b6bff'], [68, '#5fd36a']]) {
        const cc = fc(c);
        R(g, x, CT - 5, 5, 5, cc); R(g, x, CT - 5, 5, 1, sh(cc, 0.35)); R(g, x + 4, CT - 4, 1, 4, sh(cc, -0.3)); D(g, x + 2, CT - 3, '#ffffff');
      }
      // display stand for the big spinner (the spinner itself is dynamic)
      R(g, 37, CT - 3, 7, 3, '#2f2c44'); R(g, 37, CT - 3, 7, 1, '#6b688b'); R(g, 40, CT - 7, 1, 4, '#9c99ba');
      // a phone on a mini tripod for quick takes (screen off while paused)
      R(g, 24, CT - 8, 4, 7, '#1d1a24'); R(g, 25, CT - 7, 2, 5, PAUSED ? '#2a2a40' : '#3ef0ff'); D(g, 25, CT - 7, PAUSED ? '#4a4a68' : '#ff4fa3');
      L(g, 25, CT - 1, 23, CT, '#4a4764'); L(g, 26, CT - 1, 28, CT, '#4a4764');
      // counter front: violet with a pop-it stripe
      R(g, 3, CT + 3, w - 6, 13, fc('#4a2a7a')); R(g, 3, CT + 3, w - 6, 1, fc('#6a48a0')); R(g, 3, CT + 15, w - 6, 1, '#2a1650');
      for (let j = 0; j < 12; j++) for (let i = 0; i < w - 6; i++) if (S.hash(i, j, 721) < 0.05) D(g, 3 + i, CT + 3 + j, fc('#5a3a8e'));
      for (let i = 0; i < 6; i++) { const c = fc(RAINBOW[i]); R(g, 6 + i * 3, CT + 6, 2, 8, c); D(g, 6 + i * 3, CT + 6, sh(c, 0.4)); }
      for (let i = 0; i < 6; i++) { const c = fc(RAINBOW[5 - i]); R(g, w - 23 + i * 3, CT + 6, 2, 8, c); D(g, w - 23 + i * 3, CT + 6, sh(c, 0.4)); }
      // the film-frame rail (frames are drawn from data in drawFidgetFrames)
      R(g, 26, CT + 5, 28, 1, '#2a1650'); R(g, 26, CT + 13, 28, 1, '#2a1650');
      R(g, 1, WY - 1, 2, CT + 16 - WY, '#e9e4f0'); R(g, w - 3, WY - 1, 2, CT + 16 - WY, '#a9a3bb');
      if (PAUSED) {
        // velvet curtain on a brass rail, drawn across the left half and tied back with a gold sash
        R(g, 2, WY - 2, w - 4, 1, P.goldDark); R(g, 2, WY - 2, w - 4, 1, P.gold); D(g, 2, WY - 2, '#fff0b0');
        const cw = 38;
        for (let i = 0; i < cw; i++) {
          // the hem gathers toward the tie-back, so the drape narrows near the bottom
          const fold = i % 5, gather = i > cw - 9 ? (i - (cw - 9)) : 0;
          const h = CT + 2 - WY + 1 - Math.max(0, gather - 2);
          for (let j = 0; j < h; j++) {
            let c = fold === 0 ? VELVET.dark : fold === 1 ? VELVET.light : fold === 2 ? VELVET.hi : fold === 3 ? VELVET.base : VELVET.dark;
            if (j < 2) c = VELVET.deep;
            if (gather && j > h - 8 && fold > 1) c = VELVET.base;
            D(g, 3 + i, WY - 1 + j, c);
          }
          if (i % 5 === 2) D(g, 3 + i, WY - 1 + h, VELVET.dark);
        }
        // the tie-back sash
        R(g, cw - 2, CT - 6, 5, 2, P.gold); D(g, cw - 2, CT - 6, '#fff0b0'); D(g, cw + 2, CT - 5, P.goldDark);
        D(g, cw + 1, CT - 4, P.gold); D(g, cw + 2, CT - 3, P.goldDark);
        // gold fringe along the curtain's hem
        for (let i = 0; i < cw - 8; i += 2) D(g, 3 + i, CT + 3, P.gold);
        // two hooks for the pause placard
        D(g, 35, CT + 4, '#c8c4dc'); D(g, 46, CT + 4, '#c8c4dc');
      }
    }, OUT));
  }
  function crateSprite() {
    return cached('crt', () => build(14, 16, (g) => {
      for (const [y, h] of [[0, 7], [7, 9]]) {
        R(g, 0, y, 14, h, WOOD.base); R(g, 0, y, 14, 1, WOOD.hi); R(g, 0, y + h - 1, 14, 1, WOOD.deep);
        R(g, 0, y, 1, h, WOOD.light); R(g, 13, y, 1, h, WOOD.dark); L(g, 1, y + 1, 12, y + h - 2, WOOD.dark);
      }
      for (let i = 0; i < 5; i++) D(g, 2 + i * 2, 0, RAINBOW[i]);
    }, OUT));
  }
  function tripodSprite() {
    return cached('tri', () => build(13, 22, (g) => {
      L(g, 6, 9, 1, 21, '#2f2c44'); L(g, 6, 9, 11, 21, '#2f2c44'); R(g, 6, 9, 1, 12, '#4a4764'); L(g, 7, 10, 12, 21, '#6b688b');
      R(g, 1, 2, 11, 7, '#24212f'); R(g, 1, 2, 11, 1, '#4a4764'); R(g, 1, 2, 1, 7, '#3a3650'); R(g, 3, 0, 5, 2, '#24212f'); D(g, 4, 0, '#4a4764');
      R(g, 2, 3, 8, 5, '#0e0c16');
      for (let i = 0; i < 6; i++) D(g, 3 + i, 4, RAINBOW[i]);
      R(g, 3, 5, 6, 2, '#cfa874'); D(g, 5, 5, '#ff4f6e'); D(g, 7, 6, '#3ec8f0');
      R(g, 9, 0, 3, 2, '#3a3650'); D(g, 11, 0, '#6b688b');
    }, OUT));
  }
  function ringLightSprite() {
    return cached('rng', () => build(13, 24, (g) => {
      R(g, 6, 11, 1, 10, '#3a3650'); L(g, 6, 20, 2, 23, '#3a3650'); L(g, 6, 20, 10, 23, '#3a3650');
      S.px.circle(g, 6, 5, 5, '#e8e4f4'); S.px.circle(g, 6, 5, 3, '#2a2638'); D(g, 3, 1, '#ffffff'); D(g, 2, 2, '#ffffff');
      R(g, 5, 4, 3, 3, '#1d1a24'); R(g, 5, 4, 1, 3, '#3ef0ff');
    }, OUT));
  }

  /* ---- noodle cart (growth >= 1) ---- */
  function noodleSprite() {
    return cached('nood', () => build(NOOD.w, NOOD.h, (g) => {
      const w = NOOD.w;
      const RED = { base: '#c8322e', light: '#e8524a', dark: '#8e1e1e' };
      awning(g, 0, 10, w, 10, [RED, { base: '#a82424', light: '#d24038', dark: '#7a1616' }], 8, 2);
      R(g, 0, 10, w, 1, '#f4ede0');
      if (winterNow()) snowCap(g, 0, 10, w, 4);
      const WY = 22;
      R(g, 4, WY, w - 8, 10, '#26324e');
      for (let i = 4; i < w - 4; i += 7) R(g, i, WY, 1, 10, '#141c30');
      for (let i = 6; i < w - 6; i += 7) D(g, i + 2, WY + 4, '#f4ede0');
      const CT = WY + 10;
      R(g, 2, CT, w - 4, 3, WOOD.light); R(g, 2, CT, w - 4, 1, WOOD.hi); R(g, 2, CT + 2, w - 4, 1, WOOD.dark);
      R(g, 8, CT - 8, 14, 8, '#a9a5b8'); R(g, 8, CT - 8, 14, 1, '#e6e2f0'); R(g, 9, CT - 9, 12, 1, '#5a5670'); R(g, 21, CT - 7, 1, 7, '#6d6984');
      R(g, 10, CT - 9, 10, 1, '#f0d890');
      for (let k = 0; k < 4; k++) { const x = 28 + k * 6; R(g, x, CT - 3, 5, 3, '#f4ede0'); R(g, x, CT - 3, 5, 1, '#c84a3a'); D(g, x + 2, CT - 1, '#c84a3a'); }
      R(g, 50, CT - 7, 2, 7, '#3a5a2a'); D(g, 50, CT - 8, '#c8c4d4');
      planks(g, 3, CT + 3, w - 6, 12, { deep: '#3a1a14', dark: '#5a2a1e', base: '#7a3a26', light: '#94503a', hi: '#b06a4a' }, 7);
      S.px.circle(g, 8, CT + 12, 4, '#2a1a14'); S.px.circle(g, 8, CT + 12, 3, WOOD.light); S.px.circle(g, 8, CT + 12, 1, WOOD.deep);
      L(g, 5, CT + 12, 11, CT + 12, WOOD.dark); L(g, 8, CT + 9, 8, CT + 15, WOOD.dark);
      for (const sx of [22, 34, 46]) { R(g, sx, CT + 13, 6, 2, '#d8443a'); R(g, sx, CT + 13, 6, 1, '#ff7a6a'); R(g, sx + 1, CT + 15, 1, 3, '#2f2c44'); R(g, sx + 4, CT + 15, 1, 3, '#2f2c44'); }
    }, OUT));
  }

  /* ---- sticker + poster stall (growth >= 2) ---- */
  function stickerSprite() {
    return cached('stk', () => build(STK.w, STK.h, (g) => {
      const w = STK.w;
      const V = { base: '#6a3ab8', light: '#8a5ad8', dark: '#4a2488' };
      awning(g, 0, 7, w, 9, [V, V], 6, 2);
      for (let j = 0; j < 9; j += 3) for (let i = (j % 6 ? 3 : 0); i < w; i += 6) D(g, i + 1, 8 + j, '#f4ecff');
      if (winterNow()) snowCap(g, 0, 7, w, 5);
      const WY = 18;
      R(g, 4, WY, w - 8, 12, '#2a2140');
      for (let k = 0; k < 7; k++) {
        const x = 6 + k * 6, c = RAINBOW[k % 6];
        R(g, x, WY + 2 + (k % 2), 5, 7, c); R(g, x, WY + 2 + (k % 2), 5, 1, sh(c, 0.4));
        D(g, x + 2, WY + 4 + (k % 2), '#ffffff'); R(g, x + 1, WY + 6 + (k % 2), 3, 1, sh(c, -0.35));
      }
      const CT = WY + 12;
      R(g, 2, CT, w - 4, 3, '#ece8f4'); R(g, 2, CT, w - 4, 1, '#ffffff'); R(g, 2, CT + 2, w - 4, 1, '#a9a3bb');
      for (let k = 0; k < 6; k++) { R(g, 6 + k * 7, CT - 2, 5, 2, ['#ffe45c', '#ff9ac0', '#9ff0ff'][k % 3]); D(g, 7 + k * 7, CT - 2, '#ffffff'); }
      R(g, 3, CT + 3, w - 6, 12, '#ff6fb5'); R(g, 3, CT + 3, w - 6, 1, '#ff9ac8'); R(g, 3, CT + 14, w - 6, 1, '#b83a7a');
      for (let i = 0; i < 14; i++) D(g, 5 + ((S.hash(i, 1, 722) * (w - 10)) | 0), CT + 5 + ((S.hash(i, 2, 722) * 8) | 0), ['#ffe45c', '#3ef0ff', '#ffffff', '#9b6bff'][i % 4]);
      R(g, 1, WY - 1, 2, CT + 16 - WY, '#e9e4f0'); R(g, w - 3, WY - 1, 2, CT + 16 - WY, '#a9a3bb');
    }, OUT));
  }

  /* ---- selfie wall: painted wings around a neon heart ---- */
  function selfieSprite() {
    return cached('slf', () => build(SELFIE.w, SELFIE.h, (g) => {
      const w = SELFIE.w, h = SELFIE.h;
      R(g, 4, h - 6, 2, 6, STEEL.dark); R(g, w - 6, h - 6, 2, 6, STEEL.dark);
      R(g, 0, 0, w, h - 5, '#f2e8f6'); R(g, 0, 0, w, 1, '#ffffff'); R(g, 0, 0, 1, h - 5, '#ffffff'); R(g, w - 1, 0, 1, h - 5, '#b8a8c8'); R(g, 0, h - 6, w, 1, '#a898b8');
      for (let y = 2; y < h - 7; y++) R(g, 2, y, w - 4, 1, mix('#ffd6ec', '#d4e6ff', y / (h - 9)));
      const wing = ['....######', '..#########', '.##########', '###########', '.#########.', '..#######..', '...#####...', '....###....'];
      wing.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) if (row[i] === '#') {
          const c = (i + j) % 3 === 0 ? '#ff9ac8' : j < 3 ? '#ffffff' : '#ffc2e0';
          D(g, 3 + i, 6 + j, c); D(g, w - 4 - i, 6 + j, c);
        }
      });
      for (let j = 0; j < 4; j++) { D(g, 5 + j * 2, 9 + j, '#e07ab0'); D(g, w - 6 - j * 2, 9 + j, '#e07ab0'); }
      for (let k = 0; k < 6; k++) { D(g, 4 + k * 2, 15, '#ffb0d8'); D(g, w - 5 - k * 2, 15, '#ffb0d8'); }
      R(g, 15, h - 8, 10, 1, '#ff6fb5');
      if (winterNow()) { R(g, 0, -1, w, 2, P.snow); }
    }, OUT));
  }

  /* ---- props ---- */
  function vendSprite() {
    return cached('vnd', () => build(13, 26, (g) => {
      R(g, 0, 0, 13, 26, '#e8e6f0'); R(g, 0, 0, 13, 1, '#ffffff'); R(g, 12, 0, 1, 26, '#a9a6b8'); R(g, 0, 25, 13, 1, '#8a879a');
      R(g, 0, 0, 13, 3, '#d8443a'); R(g, 0, 0, 13, 1, '#ff7a6a');
      R(g, 1, 4, 11, 12, '#1a2238');
      for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) { const c = ['#ff4f6e', '#3ec8f0', '#ffd84a', '#5fd36a', '#ff9a3c', '#9b6bff'][(r * 4 + k) % 6]; R(g, 2 + k * 3, 5 + r * 4, 2, 3, c); D(g, 2 + k * 3, 5 + r * 4, '#ffffff'); }
      R(g, 1, 4, 11, 1, '#9ff6ff');
      R(g, 9, 17, 2, 3, '#4a4764'); D(g, 9, 18, '#ffe45c');
      R(g, 2, 21, 7, 3, '#2a2638'); R(g, 2, 21, 7, 1, '#5a5670');
      if (winterNow()) R(g, 0, -1, 13, 2, P.snow);
    }, OUT));
  }
  function mortarSprite() {
    return cached('mor', () => build(12, 10, (g) => {
      R(g, 0, 4, 12, 6, WOOD.base); R(g, 0, 4, 12, 1, WOOD.hi); R(g, 0, 9, 12, 1, WOOD.deep); R(g, 0, 4, 1, 6, WOOD.light);
      for (let k = 0; k < 3; k++) { const x = 1 + k * 4; R(g, x, 0, 3, 5, '#3a3650'); R(g, x, 0, 3, 1, '#1d1a24'); D(g, x, 1, '#6b688b'); D(g, x + 1, 2, RAINBOW[k * 2]); }
      R(g, 2, 6, 8, 2, '#ffd84a'); D(g, 3, 6, '#d8443a'); D(g, 6, 7, '#d8443a');
    }, OUT));
  }
  function benchSprite() {
    return cached('bnc', () => build(18, 9, (g) => {
      R(g, 0, 0, 18, 2, WOOD.base); R(g, 0, 0, 18, 1, WOOD.hi);
      R(g, 0, 3, 18, 3, WOOD.light); R(g, 0, 3, 18, 1, winterNow() ? P.snow : WOOD.hi); R(g, 0, 5, 18, 1, WOOD.dark);
      R(g, 1, 2, 1, 1, '#2f2c44'); R(g, 16, 2, 1, 1, '#2f2c44');
      R(g, 1, 6, 2, 3, '#2f2c44'); R(g, 15, 6, 2, 3, '#2f2c44'); D(g, 1, 6, '#6b688b'); D(g, 15, 6, '#6b688b');
    }, OUT));
  }
  function planterSprite(seed) {
    return cached('plt' + seed, () => {
      const s = season();
      // Neon Hollow's little trees glow violet-pink like the island's own grove.
      const fol = s === 'winter' ? null : { dark: '#5a2a6a', base: '#a04a9a', light: '#d070c0', hi: '#ffb0e8' };
      return build(18, 26, (g) => {
        R(g, 1, 17, 16, 9, '#3a3054'); R(g, 1, 17, 16, 1, '#6a5c8a'); R(g, 1, 17, 1, 9, '#55487a'); R(g, 16, 17, 1, 9, '#251d3a');
        R(g, 1, 21, 16, 1, seed % 2 ? '#c64a8a' : '#2fb8c8');
        R(g, 2, 17, 14, 2, '#3a2a1e');
        R(g, 8, 11, 2, 7, WOOD.dark); D(g, 8, 14, WOOD.light);
        if (fol) {
          for (let y = 0; y < 15; y++) for (let x = 0; x < 18; x++) {
            const dx = (x - 9) / 8, dy = (y - 7) / 7, e = dx * dx + dy * dy + (S.hash(x, y, 725 + seed) - 0.5) * 0.35;
            if (e > 1) continue;
            const lit = -(dx + dy) * 0.7 + (S.hash(x >> 1, y >> 1, 726 + seed) - 0.5) * 0.6;
            D(g, x, y, e > 0.82 ? fol.dark : lit > 0.45 ? fol.hi : lit > 0 ? fol.light : lit > -0.55 ? fol.base : fol.dark);
          }
          for (let k = 0; k < 5; k++) D(g, 4 + ((S.hash(k, seed, 727) * 10) | 0), 3 + ((S.hash(k, seed, 728) * 8) | 0), k % 2 ? P.neonCyan : '#ffe0f6');
        } else {
          L(g, 9, 9, 4, 2, WOOD.dark); L(g, 9, 9, 14, 3, WOOD.dark); L(g, 9, 6, 9, 0, WOOD.dark);
          R(g, 3, 1, 3, 1, P.snow); R(g, 12, 2, 3, 1, P.snow); D(g, 9, 0, P.snow);
          R(g, 2, 16, 14, 2, P.snow);
        }
      }, OUT);
    });
  }
  /** A closed cart under a tarp: an honest "not open yet" stall. */
  function tarpSprite(w, seed) {
    return cached('tarp' + w + '_' + seed, () => {
      const cl = [['#3d6e8a', '#5a8eaa', '#28506a'], ['#6a4a8a', '#8a68aa', '#4a2e6a'], ['#7a6a3a', '#9a8a54', '#5a4a26']][seed % 3];
      const h = 26;
      return build(w, h, (g) => {
        for (const wx of [5, w - 9]) { S.px.circle(g, wx + 2, h - 4, 3, '#2a1a14'); S.px.circle(g, wx + 2, h - 4, 2, WOOD.light); D(g, wx + 2, h - 4, WOOD.deep); }
        for (let x = 0; x < w; x++) {
          const edge = Math.min(x, w - 1 - x), top = edge < 3 ? 3 - edge : 0;
          const hem = h - 6 + ((x % 7) < 3 ? 1 : 0);
          for (let y = top; y < hem; y++) {
            let c = cl[0];
            if (y < top + 3 + (x % 9 === 4 ? 1 : 0)) c = cl[1];
            if (x % 9 === 0 && y > 5) c = cl[2];
            if (x % 9 === 1 && y > 5) c = cl[1];
            if (y === hem - 1) c = cl[2];
            if (S.hash(x, y, 750 + seed) < 0.05) c = cl[2];
            D(g, x, y, c);
          }
        }
        for (const rx of [Math.round(w * 0.28), Math.round(w * 0.72)]) for (let y = 1; y < h - 6; y++) D(g, rx + (y > 12 ? 1 : 0), y, y % 3 ? '#d8c08a' : '#a88a54');
        L(g, 2, 9, w - 3, 10, '#c8b07a');
        R(g, (w >> 1) - 2, h - 9, 4, 5, '#8a3a2a'); D(g, (w >> 1) - 2, h - 9, '#5a2a1a'); R(g, (w >> 1) - 1, h - 10, 2, 1, '#3a2a1a');
        if (winterNow()) snowCap(g, 2, 0, w - 4, seed);
      }, OUT);
    });
  }
  function lampPost(ctx, x, y, h) {
    groundShadow(ctx, x + 2, y, 3, 1, 0.25);
    R(ctx, x - 1, y - h, 3, h, OUT); R(ctx, x, y - h + 1, 1, h - 1, '#6b688b');
    R(ctx, x - 2, y - 2, 5, 2, OUT); R(ctx, x - 1, y - 2, 3, 1, '#4a4764');
    R(ctx, x - 2, y - h - 2, 5, 3, OUT); R(ctx, x - 1, y - h - 1, 3, 1, '#c8c4dc');
  }
  function poleSign(ctx) {
    const x = POLE.x, y = POLE.y;
    groundShadow(ctx, x + 9, y + 49, 5, 2, 0.28);
    R(ctx, x + 5, y + 32, 4, 17, OUT); R(ctx, x + 6, y + 32, 1, 16, STEEL.light); R(ctx, x + 7, y + 32, 1, 16, STEEL.base);
    R(ctx, x + 3, y + 47, 8, 2, OUT); R(ctx, x + 4, y + 47, 6, 1, CONC.light);
    R(ctx, x - 1, y - 1, 16, 34, OUT);
    R(ctx, x, y, 14, 32, '#1f1832'); R(ctx, x, y, 14, 1, '#40365c'); R(ctx, x, y, 1, 32, '#33294d'); R(ctx, x, y + 31, 14, 1, '#140f22');
    for (const yy of [y + 10, y + 21]) R(ctx, x + 2, yy, 10, 1, '#2a2240');
    for (const s of SIGNS) if (s.opts.board === false && !s.opts.glassOnWall) {
      const m = ICONS[s.icon], glass = mix(s.col, '#2a2238', 0.5);
      for (const [px, py] of m.pts) D(ctx, s.x + px, s.y + py, glass);
    }
    if (winterNow()) R(ctx, x, y - 1, 14, 1, P.snow);
  }

  /* ============================================================ DATA BITS (static) */
  const ANG_CT = ANG.y + 13 + 14 + 10 + 12;  // matches angieSprite's counter top
  function drawAngiePins(ctx) {
    const n = Math.min(6, F.angiePosts);
    const bx = ANG.x + 30, by = ANG_CT + 6;
    for (let k = 0; k < n; k++) {
      const x = bx + 1 + k * 4, y = by + (k % 2);
      R(ctx, x, y, 3, 4, '#fbf6ea'); R(ctx, x, y + 1, 3, 2, ['#ffb347', '#ff9ac0', '#7fc4b0'][k % 3]); D(ctx, x + 1, y, '#e0402a');
    }
    if (!n) { D(ctx, bx + 5, by + 2, '#e0402a'); D(ctx, bx + 14, by + 3, '#3ec8f0'); } // just the pins
  }
  const FID_CT = FID.y + 24 + 14;
  function drawFidgetFrames(ctx) {
    const n = Math.min(4, F.planned), x0 = FID.x + 27, y0 = FID_CT + 6;
    for (let k = 0; k < 4; k++) {
      const x = x0 + k * 7;
      if (k < n) {
        const done = k < F.posted;
        R(ctx, x, y0, 6, 7, done ? '#fbf6ea' : '#2a1650');
        R(ctx, x + 1, y0 + 1, 4, 4, done ? '#3a2a6a' : '#1a0e36');
        D(ctx, x + 2, y0 + 2, done ? '#ff6fb5' : '#7a5aa8'); D(ctx, x + 2, y0 + 3, done ? '#ff6fb5' : '#7a5aa8'); D(ctx, x + 3, y0 + 2, done ? '#ffb0d8' : '#6a4a98');
        if (done) D(ctx, x + 4, y0 + 5, '#ff4fa3');
      } else D(ctx, x + 2, y0 - 1, '#c8c4dc'); // an empty clip on the rail
    }
  }

  /* ============================================================ STATIC (22) */
  function drawBuildings(ctx) {
    const items = [];
    const add = (y, fn) => items.push([y, fn]);
    add(BB.y + BB.h, () => {
      groundShadow(ctx, BB.x + 50, BB.y + 56, 44, 3, 0.2);
      place(ctx, billboardSprite(), BB.x, BB.y, [3, 2, 0.24]);
      ctx.globalAlpha = 0.55;
      R(ctx, BB.x + 1, BB.y + 1, BB.w - 2, 1, '#8a3a6a'); R(ctx, BB.x + 1, BB.y + 31, BB.w - 2, 1, '#8a3a6a');
      R(ctx, BB.x + 1, BB.y + 1, 1, 31, '#8a3a6a'); R(ctx, BB.x + BB.w - 2, BB.y + 1, 1, 31, '#8a3a6a');
      ctx.globalAlpha = 1;
    });
    // power cable from the hut to the billboard
    add(HUT.y + 1, () => {
      const x0 = BB.x + BB.w - 4, y0 = BB.y + 36, x1 = HUT.x + 2, y1 = HUT.y + 12;
      for (let x = x0; x <= x1; x++) {
        const u = (x - x0) / (x1 - x0), y = Math.round(y0 + (y1 - y0) * u + 8 * u * (1 - u));
        D(ctx, x, y, '#16101f'); if (x % 3 === 0) D(ctx, x, y - 1, '#4a3a62');
      }
    });
    add(HUT.y + HUT.h, () => {
      groundShadow(ctx, HUT.x + 26, HUT.y + HUT.h, 24, 3, 0.22);
      drawTower(ctx);
      place(ctx, hutSprite(), HUT.x, HUT.y, [3, 2, 0.26]);
      neonBoard(ctx, ...SIGN_HUT, 'waves', NEON.cyan);
    });
    add(VEND.y + 26, () => place(ctx, vendSprite(), VEND.x, VEND.y, [3, 2, 0.26]));
    for (const [mx, my] of MORTARS) add(my, () => place(ctx, mortarSprite(), mx - 6, my - 10, [2, 1, 0.25]));
    for (const [x, y, h] of LAMPS) add(y, () => lampPost(ctx, x, y, h));
    for (const [x, y, s] of PLANTERS) add(y, () => place(ctx, planterSprite(s), x - 9, y - 26, [3, 2, 0.24]));
    for (const [x, y] of BENCHES) add(y, () => place(ctx, benchSprite(), x - 9, y - 9, [2, 2, 0.24]));
    add(ANG.y + ANG.h, () => {
      place(ctx, angieSprite(), ANG.x, ANG.y, [3, 2, 0.26]);
      neonBoard(ctx, ...SIGN_ANG, 'cup', NEON.amber);
      neonBoard(ctx, ...SIGN_ANG2, 'heart', NEON.pink);
      drawAngiePins(ctx);
    });
    add(TABLE.y + 18, () => place(ctx, tableSprite(), TABLE.x, TABLE.y, [2, 1, 0.22]));
    add(AFRAME.y + 15, () => place(ctx, aframeSprite(), AFRAME.x, AFRAME.y, [2, 1, 0.24]));
    add(POLE.y + 49, () => poleSign(ctx));
    add(FID.y + FID.h, () => {
      place(ctx, fidgetSprite(), FID.x, FID.y, [3, 2, 0.26]);
      neonBoard(ctx, ...SIGN_FID1, 'spinner', NEON.cyan);
      neonBoard(ctx, ...SIGN_FID2, 'play', NEON.pink);
      drawFidgetFrames(ctx);
      if (SIGN_PAUSE) {
        // the placard hangs from two strings in front of the counter
        L(ctx, FID.x + 36, FID_CT + 5, SIGN_PAUSE[0] + 2, SIGN_PAUSE[1], '#c8c4dc');
        L(ctx, FID.x + 47, FID_CT + 5, SIGN_PAUSE[0] + 12, SIGN_PAUSE[1], '#c8c4dc');
        neonBoard(ctx, ...SIGN_PAUSE, 'pause', NEON.amber);
      }
    });
    if (GROWTH < 3) add(FID.y + 56, () => place(ctx, crateSprite(), FID.x + FID.w + 2, FID.y + 40, [2, 2, 0.24]));
    add(TRIPOD.y + 8, () => { groundShadow(ctx, TRIPOD.x + 7, TRIPOD.y + 8, 6, 1, 0.22); place(ctx, tripodSprite(), TRIPOD.x, TRIPOD.y - 13); });
    add(RING.y + 10, () => { groundShadow(ctx, RING.x + 7, RING.y + 10, 5, 1, 0.22); place(ctx, ringLightSprite(), RING.x, RING.y - 13); });
    add(MAST.base, () => drawMast(ctx));
    if (GROWTH >= 1) add(NOOD.y + NOOD.h, () => { place(ctx, noodleSprite(), NOOD.x, NOOD.y, [3, 2, 0.26]); neonBoard(ctx, NOOD.x + 21, NOOD.y - 2, 'bowl', NEON.amber); });
    if (GROWTH >= 2) add(STK.y + STK.h, () => { place(ctx, stickerSprite(), STK.x, STK.y, [3, 2, 0.26]); neonBoard(ctx, STK.x + 19, STK.y - 4, 'star', NEON.yellow); });
    add(SELFIE.y + SELFIE.h, () => place(ctx, selfieSprite(), SELFIE.x, SELFIE.y, [3, 2, 0.26]));
    if (GROWTH >= 3) add(WHEEL.base, () => drawWheelFrame(ctx));
    for (const [x, y, w, seed] of TARPS) add(y + 26, () => place(ctx, tarpSprite(w, seed), x, y, [3, 2, 0.26]));
    items.sort((a, b) => a[0] - b[0]);
    for (const [, fn] of items) fn();
  }

  /* ---- ferris wheel (growth >= 3): frame static, wheel dynamic ---- */
  function drawWheelFrame(ctx) {
    const { cx, cy, r, base } = WHEEL;
    groundShadow(ctx, cx + 6, base, r + 4, 3, 0.24);
    L(ctx, cx - 1, cy, cx - 15, base - 1, STEEL.dark); L(ctx, cx + 1, cy, cx + 15, base - 1, STEEL.dark);
    for (const [x0, x1, c] of [[cx, cx - 13, STEEL.light], [cx, cx + 13, STEEL.base]]) { L(ctx, x0, cy, x1, base, OUT); L(ctx, x0 + (x1 < x0 ? 1 : -1), cy, x1 + (x1 < x0 ? 1 : -1), base, c); }
    R(ctx, cx - 19, base - 2, 38, 4, OUT); R(ctx, cx - 18, base - 1, 36, 2, WOOD.light); R(ctx, cx - 18, base - 1, 36, 1, WOOD.hi);
  }
  const WHEEL_STEPS = 24;
  let wheelRim = null; const wheelSpokes = [];
  function wheelRimSprite() {
    if (wheelRim) return wheelRim;
    const { r } = WHEEL, size = r * 2 + 5, o = r + 2;
    const [c, g] = mk(size, size);
    for (let k = 0; k < 160; k++) { const a = k / 160 * Math.PI * 2; D(g, Math.round(o + Math.cos(a) * (r + 1)), Math.round(o + Math.sin(a) * (r + 1)), OUT); }
    for (let k = 0; k < 160; k++) {
      const a = k / 160 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const lit = -(ca + sa) > 0.4;
      D(g, Math.round(o + ca * r), Math.round(o + sa * r), lit ? '#ffffff' : '#d8d4e6');
      D(g, Math.round(o + ca * (r - 1)), Math.round(o + sa * (r - 1)), lit ? '#c8c4dc' : '#8d89a8');
      if (k % 4 === 0) D(g, Math.round(o + ca * (r - 4)), Math.round(o + sa * (r - 4)), '#8d89a8');
    }
    return (wheelRim = c);
  }
  function wheelSpokeSprite(step) {
    if (wheelSpokes[step]) return wheelSpokes[step];
    const { r } = WHEEL, size = r * 2 + 5, o = r + 2;
    const [c, g] = mk(size, size);
    const a0 = step / WHEEL_STEPS * (Math.PI / 4);
    for (let k = 0; k < 8; k++) { const a = a0 + k / 8 * Math.PI * 2; L(g, o, o, o + Math.cos(a) * (r - 1), o + Math.sin(a) * (r - 1), '#a9a5c2'); }
    return (wheelSpokes[step] = c);
  }
  const wheelAngle = (t) => (rm ? 0 : t * 0.18);
  function drawWheel(ctx, t) {
    const { cx, cy, r } = WHEEL, o = r + 2;
    const a0 = wheelAngle(t);
    const step = Math.floor(((a0 % (Math.PI / 4)) / (Math.PI / 4)) * WHEEL_STEPS) % WHEEL_STEPS;
    const aq = Math.floor(a0 / (Math.PI / 4)) * (Math.PI / 4) + step / WHEEL_STEPS * (Math.PI / 4);
    ctx.drawImage(wheelSpokeSprite(step), cx - o, cy - o);
    ctx.drawImage(wheelRimSprite(), cx - o, cy - o);
    R(ctx, cx - 2, cy - 2, 5, 5, OUT); R(ctx, cx - 1, cy - 1, 3, 3, P.gold);
    for (let k = 0; k < 8; k++) {
      const a = aq + k / 8 * Math.PI * 2, x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      const c = RAINBOW[k % 6];
      R(ctx, x - 3, y, 7, 6, OUT); R(ctx, x - 2, y + 1, 5, 4, c); R(ctx, x - 2, y + 1, 5, 1, sh(c, 0.4)); R(ctx, x - 1, y + 2, 3, 1, '#2a2440');
      D(ctx, x, y - 1, OUT);
    }
  }

  /* ============================================================ LIGHTS */
  const light = (o) => S.addLight(Object.assign({ island: ID }, o));
  const neonLight = (x, y, color, r, i) => light({ x, y, r, color, intensity: i, nightOnly: false, flicker: false });
  for (const s of SIGNS) neonLight(s.x + (ICONS[s.icon].w >> 1), s.y + (ICONS[s.icon].h >> 1), s.col, s.dim ? 16 : 26, s.dim ? 0.35 : 0.7);
  neonLight(SCR.x + SCR.w / 2, SCR.y + SCR.h, '#8fd8ff', 64, 0.85);
  let beaconLit = false, mastBeaconLit = false;
  light({ x: BEACON.x, y: BEACON.y + 1, r: 14, color: '#ff4a3a', intensity: 0.9, nightOnly: false, on: () => beaconLit });
  light({ x: MAST.x, y: MAST.top - 1, r: 12, color: '#ff4a3a', intensity: 0.8, nightOnly: false, on: () => mastBeaconLit });
  light({ x: DOCK.x, y: DOCK.y, r: 20, color: P.neonPink, intensity: 0.75, nightOnly: false });
  light({ x: MAST.x, y: MAST.top + 40, r: 26, color: P.neonViolet, intensity: 0.5 });
  // Angie's: the warmest, brightest stall on the island
  light({ x: ANG.x + 42, y: ANG.y + 46, r: 60, color: P.lantern, intensity: 1, flicker: true });
  light({ x: ANG.x + 42, y: ANG.y + 70, r: 34, color: '#ffd27a', intensity: 0.6 });
  light({ x: TABLE.x + 10, y: TABLE.y + 6, r: 18, color: P.lanternGlow, intensity: 0.5 });
  light({ x: FID.x + 40, y: FID.y + 34, r: PAUSED ? 26 : 40, color: '#ff8ad0', intensity: PAUSED ? 0.32 : 0.7 });
  light({ x: RING.x + 6, y: RING.y - 8, r: 18, color: '#e8f4ff', intensity: PAUSED ? 0.3 : 0.6, nightOnly: false });
  light({ x: VEND.x + 6, y: VEND.y + 12, r: 18, color: '#bff4ff', intensity: 0.7, nightOnly: false });
  light({ x: HUT.x + 8, y: HUT.y + 17, r: 14, color: P.neonCyan, intensity: 0.5 });
  light({ x: POOL.x, y: POOL.y, r: 22, color: '#7fefff', intensity: 0.55, nightOnly: false });
  light({ x: FALL_X0 + 3, y: FALL[0].lip + 30, r: 30, color: '#8fd8ff', intensity: 0.45, nightOnly: false });
  for (const [x, y, h] of LAMPS) light({ x, y: y - h, r: 20, color: '#e0d4ff', intensity: 0.55 });
  if (GROWTH >= 1) light({ x: NOOD.x + 30, y: NOOD.y + 26, r: 40, color: '#ff7a3a', intensity: 0.8, flicker: true });
  if (GROWTH >= 2) light({ x: STK.x + 26, y: STK.y + 26, r: 32, color: P.neonViolet, intensity: 0.6 });
  if (GROWTH >= 3) light({ x: WHEEL.cx, y: WHEEL.cy, r: 40, color: P.neonViolet, intensity: 0.7, nightOnly: false });

  /* ============================================================ HOTSPOTS */
  const hot = (key, label, x, y, w, h) => S.addHotspot({ id: 'landmark:' + key, kind: 'landmark', landmark: key, biome: ID, island: ID, agent: AGENT, label, x, y, w, h, priority: 1 });
  const hTower = hot('broadcastTower', 'Broadcast Tower', HUT.x - 6, TWR.top - 12, HUT.w + 12, HUT.y + HUT.h - TWR.top + 14);
  // Angie's covers the stall, its sidewalk table and the A-frame, and starts east of the mast so the
  // two landmarks never overlap (equal priorities would hand the overlap to whichever registered first).
  const ANG_X0 = Math.max(MAST.x + 12, Math.min(ANG.x, TABLE.x) - 2), ANG_X1 = Math.max(ANG.x + ANG.w, TABLE.x + 20, AFRAME.x + 10) + 2;
  const ANG_Y1 = Math.max(ANG.y + ANG.h, TABLE.y + 18, AFRAME.y + 15) + 3;
  const hAng = hot('angiesStall', "Angie's stall", ANG_X0, ANG.y - 4, ANG_X1 - ANG_X0, ANG_Y1 - (ANG.y - 4));
  const hFid = hot('fidgetStall', 'Fidgetly promo stall', FID.x - 2, FID.y - 4, FID.w + 18, TRIPOD.y + 10 - FID.y + 4);
  const hBB = hot('billboard', 'Billboard', BB.x, BB.y, BB.w, BB.h);
  const hMast = hot('blimpMast', 'Blimp mast', DOCK.x - 6, MAST.top - 6, MAST.x + 12 - DOCK.x + 6, MAST.base - MAST.top + 8);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  function updateLabels() {
    // the screen shows these as tiles, frames and dots (no digits in the canvas), so the label carries every number
    const bb = [];
    if (F.posts) bb.push(`${plural(F.posts, 'post')} queued this week`);
    if (F.planned || F.posted) bb.push(`${plural(F.planned, 'video')} planned`);
    if (F.clicks) bb.push(`${plural(F.clicks, 'link click')} in 7 days`);
    hBB.label = bb.length ? 'Billboard · ' + bb.join(' · ') : 'Billboard · standby, nothing queued yet';
    hTower.label = F.posts ? `Broadcast Tower · ${plural(F.posts, 'post')} going out in 7 days` : 'Broadcast Tower · quiet, no posts scheduled';
    hAng.label = F.angiePosts ? `Angie's stall · ${plural(F.angiePosts, 'post')} in the next 7 days` : "Angie's stall · no posts queued yet";
    const vids = F.planned || F.posted ? ` · ${plural(F.planned, 'video')} planned, ${F.posted} posted` : '';
    hFid.label = (F.fidgetLive ? 'Fidgetly promo stall' : 'Fidgetly promo stall · on hold') + vids;
    hMast.label = 'Blimp mast · Lumi flies to Clockspire from here';
  }
  updateLabels();
  // A docking point the villagers module can moor the neon blimp to.
  S.market = { dock: { x: DOCK.x, y: DOCK.y, island: ID }, mast: { x: MAST.x, top: MAST.top, base: MAST.base } };
  /** Launch a firework from Neon Hollow on demand (e.g. when a post goes out). */
  S.market.firework = (big) => { if (S.t != null) launch(!!big); };

  /* ============================================================ BILLBOARD SCREEN
   * No digits in the canvas (text lives in the DOM): every count is drawn as
   * that many things (post tiles, film frames, click dots) and the hotspot
   * label and panel carry the exact numbers.
   */
  const [scr, sg] = mk(SCR.w, SCR.h);
  let scrStamp = -1;
  function modes() {
    const list = [];
    if (F.posts) list.push('posts');
    if (F.planned || F.posted) list.push('videos');
    if (F.clicks) list.push('clicks');
    return list.length ? list : ['idle'];
  }
  function gradient(g, top, bot) { for (let y = 0; y < SCR.h; y++) R(g, 0, y, SCR.w, 1, mix(top, bot, y / (SCR.h - 1))); }
  function renderScreen(t) {
    const list = modes(), DUR = 7;
    const idx = Math.floor(t / DUR) % list.length, mode = list[idx], mt = t % DUR;
    const g = sg, W = SCR.w, H = SCR.h;
    if (mode === 'idle') {
      // test card: an honest "no signal yet", with a slow scan bar
      const bars = ['#b8b8b8', '#b8b83a', '#3ab8b8', '#3ab83a', '#b83ab8', '#b83a3a', '#3a3ab8'];
      const bw = W / 7;
      for (let k = 0; k < 7; k++) R(g, Math.round(k * bw), 0, Math.ceil(bw), 19, bars[k]);
      for (let k = 0; k < 7; k++) R(g, Math.round(k * bw), 19, Math.ceil(bw), 2, k % 2 ? '#141428' : bars[6 - k]);
      R(g, 0, 21, W, 6, '#101024'); R(g, 6, 21, 14, 6, '#e8e8f0'); R(g, 34, 21, 12, 6, '#2a1a5a');
      const sy = Math.floor((t * 9) % (H + 8)) - 4;
      g.globalAlpha = 0.22; R(g, 0, sy, W, 2, '#ffffff'); g.globalAlpha = 1;
      if (!rm) for (let k = 0; k < 10; k++) D(g, (S.hash(k, Math.floor(t * 12), 730) * W) | 0, (S.hash(k, Math.floor(t * 12), 731) * H) | 0, '#ffffff');
      const pulse = rm ? 0.7 : 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2.4));
      g.globalAlpha = pulse; R(g, W - 6, H - 5, 3, 3, '#ff3a3a'); g.globalAlpha = 1;
    } else if (mode === 'posts') {
      gradient(g, '#241a5e', '#0c0a26');
      for (let y = 2; y < H; y += 4) for (let x = 2 + (y & 4 ? 2 : 0); x < W; x += 4) D(g, x, y, '#2c2468');
      R(g, 4, 3, 11, 9, '#f4f1fb'); R(g, 4, 3, 11, 3, '#ff4f6e'); D(g, 6, 2, '#c8c4dc'); D(g, 12, 2, '#c8c4dc');
      for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) D(g, 5 + i * 3, 7 + j * 3, (i + j * 4) < 7 ? '#5a4a9a' : '#c8c4dc');
      // a stack of queued post cards under the calendar
      R(g, 9, 14, 8, 7, '#1a1440'); R(g, 10, 15, 6, 5, '#7262b8'); R(g, 10, 15, 6, 1, '#9484d4');
      R(g, 7, 16, 8, 7, '#1a1440'); R(g, 8, 17, 6, 5, '#a294e4'); R(g, 8, 17, 6, 1, '#c8bef4');
      R(g, 5, 18, 8, 7, '#1a1440'); R(g, 6, 19, 6, 5, '#f4f1fb');
      R(g, 7, 20, 4, 2, '#ff6fb5'); D(g, 10, 20, '#ffe45c'); R(g, 7, 23, 3, 1, '#c8c4dc');
      R(g, 22, 3, 1, 21, '#4a3aa0');
      const colours = [];
      for (const c of F.clients) for (let k = 0; k < c.n; k++) colours.push(c.col);
      while (colours.length < F.posts) colours.push('#ff6fb5');
      const shown = Math.min(14, F.posts);
      for (let k = 0; k < shown; k++) {
        const appear = rm ? 0 : 0.25 + k * 0.16;
        if (mt < appear) continue;
        const x = 26 + (k % 7) * 8, y = 3 + Math.floor(k / 7) * 8, c = colours[k];
        const fresh = !rm && mt - appear < 0.12;
        R(g, x, y, 7, 7, fresh ? '#ffffff' : sh(c, -0.45));
        R(g, x + 1, y + 1, 5, 5, fresh ? '#ffffff' : c);
        R(g, x + 1, y + 1, 5, 1, sh(c, 0.45));
        if (k === 13 && F.posts > 14) { R(g, x + 3, y + 2, 1, 3, '#1a1440'); R(g, x + 2, y + 3, 3, 1, '#1a1440'); }
        else { D(g, x + 2, y + 2, '#ffffff'); D(g, x + 4, y + 2, '#ffffff'); R(g, x + 2, y + 3, 3, 1, '#ffffff'); D(g, x + 3, y + 4, '#ffffff'); }
      }
      const total = F.clients.reduce((a, c) => a + c.n, 0);
      let bx = 26;
      R(g, 25, 20, 58, 5, '#120e30');
      if (total) for (const c of F.clients) {
        const w = Math.round(c.n / total * 56);
        if (w <= 0) continue;
        R(g, bx, 21, w, 3, c.col); R(g, bx, 21, w, 1, sh(c.col, 0.4)); bx += w;
      } else R(g, 26, 21, 56, 3, '#ff6fb5');
      if (!rm) { const sx = 26 + Math.floor((mt * 22) % 64); g.globalAlpha = 0.5; R(g, sx, 21, 3, 3, '#ffffff'); g.globalAlpha = 1; }
    } else if (mode === 'videos') {
      gradient(g, '#4a1250', '#140820');
      R(g, 4, 3, 11, 9, '#ff4fa3'); R(g, 4, 3, 11, 1, '#ff9ac8'); R(g, 7, 5, 1, 5, '#ffffff'); R(g, 8, 6, 1, 3, '#ffffff'); D(g, 9, 7, '#ffffff'); R(g, 4, 11, 11, 1, '#a02a6a');
      // a clapperboard under the play badge; its stick claps now and then
      const open = !rm && mt % 1.6 < 0.9;
      R(g, 3, 18, 13, 8, '#1a0a1a'); R(g, 4, 19, 11, 6, '#3a2238'); R(g, 4, 19, 11, 1, '#5a3a58');
      R(g, 6, 21, 7, 1, '#8a6a88'); R(g, 6, 23, 5, 1, '#8a6a88');
      for (let i = 0; i < 11; i++) {
        const lift = open ? Math.round(i * 0.3) : 0;
        D(g, 4 + i, 14 - lift, '#1a0a1a');
        for (let j = 0; j < 3; j++) D(g, 4 + i, 15 + j - lift, (i + j) % 4 < 2 ? '#f4f0fa' : '#1a0a1a');
      }
      R(g, 22, 3, 1, 21, '#8a2a7a');
      R(g, 25, 3, 60, 19, '#120e18');
      const off = rm ? 0 : Math.floor(t * 6) % 4;
      for (let x = 25 - off; x < 85; x += 4) if (x >= 25) { R(g, x + 1, 4, 2, 2, '#4a4458'); R(g, x + 1, 19, 2, 2, '#4a4458'); }
      const n = Math.min(6, F.planned);
      for (let k = 0; k < n; k++) {
        const x = 27 + k * 10, done = k < F.posted;
        R(g, x, 7, 8, 11, done ? '#3a2a8a' : '#1e1830');
        if (done) { R(g, x, 7, 8, 4, '#5a6ae8'); R(g, x, 13, 8, 5, '#2a1a5a'); D(g, x + 6, 8, '#ffe45c'); }
        R(g, x + 3, 10, 1, 4, done ? '#ffffff' : '#6a5a8a'); R(g, x + 4, 11, 1, 2, done ? '#ffffff' : '#6a5a8a');
        if (!done) { for (let i = 0; i < 8; i += 2) { D(g, x + i, 7, '#6a5a8a'); D(g, x + i + 1, 17, '#6a5a8a'); } }
        else { R(g, x + 5, 15, 3, 3, '#ff4fa3'); D(g, x + 6, 16, '#ffffff'); }
      }
      R(g, 25, 23, 60, 2, '#2a1030');
      if (F.planned) R(g, 25, 23, Math.round(60 * Math.min(1, F.posted / F.planned)), 2, '#ff4fa3');
    } else {
      gradient(g, '#0f4a4a', '#071a20');
      const ph = rm ? 0.5 : (mt * 0.9) % 1;
      g.globalAlpha = 1 - ph;
      const rr = Math.round(2 + ph * 7);
      R(g, 9 - rr, 9, 1, 1, '#9ff6ff'); R(g, 9 + rr, 9, 1, 1, '#9ff6ff'); R(g, 9, 9 - rr, 1, 1, '#9ff6ff'); R(g, 9, 9 + rr, 1, 1, '#9ff6ff');
      g.globalAlpha = 1;
      const cur = ['1.....', '11....', '1#1...', '1##1..', '1###1.', '1####1', '1##111', '11.1..', '...1..'];
      cur.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') D(g, 8 + i, 7 + j, row[i] === '1' ? '#0a1a20' : '#ffffff'); });
      R(g, 22, 3, 1, 21, '#1a6a6a');
      // one dot per link click in the last 7 days, ticking in like a tally; '+' in the last cell when they overflow
      const CC = 20, cap = CC * 7, n = Math.min(cap, F.clicks), gap = Math.min(0.05, 5 / Math.max(1, n));
      const y0 = 3 + Math.floor((7 - Math.ceil(n / CC)) * 3 / 2);   // the block sits centred beside the cursor
      for (let k = 0; k < n; k++) {
        const appear = rm ? 0 : 0.2 + k * gap;
        if (mt < appear) continue;
        const x = 25 + (k % CC) * 3, y = y0 + Math.floor(k / CC) * 3;
        if (k === cap - 1 && F.clicks > cap) { R(g, x + 1, y, 1, 3, '#ffffff'); R(g, x, y + 1, 3, 1, '#ffffff'); continue; }
        const fresh = !rm && mt - appear < 0.12;
        R(g, x, y, 2, 2, fresh ? '#ffffff' : '#3ef0ff'); D(g, x + 1, y + 1, fresh ? '#ffffff' : '#1fa8b8');
      }
    }
    if (!rm && list.length > 1 && mt < 0.25) for (let k = 0; k < 140; k++) D(g, (S.hash(k, Math.floor(t * 30), 732) * W) | 0, (S.hash(k, Math.floor(t * 30), 733) * H) | 0, k & 1 ? '#ffffff' : '#5a5a7a');
    g.globalAlpha = 0.16; for (let y = 1; y < H; y += 2) R(g, 0, y, W, 1, '#000000'); g.globalAlpha = 1;
    if ((S.status[ID] || {}).level === 'critical' && (rm || Math.floor(t * 2) % 2 === 0)) {
      R(g, W - 10, 2, 8, 7, '#1a0a0a'); L(g, W - 6, 2, W - 9, 8, '#ff4a3a'); L(g, W - 6, 2, W - 3, 8, '#ff4a3a'); R(g, W - 9, 8, 7, 1, '#ff4a3a'); D(g, W - 6, 5, '#ffe45c'); D(g, W - 6, 7, '#ffe45c');
    }
  }

  /* ============================================================ FIREWORKS */
  const fw = { rockets: [], sparks: [], next: 4, burst: 0, burstNext: 0, burstDone: false, lastT: -1, flash: null };
  const arcs = [];
  const FW_COLS = [[P.neonPink, '#ffd0e8'], [P.neonCyan, '#d8fcff'], ['#ffe45c', '#fff6c0'], ['#a6ff5c', '#e8ffd0'], [P.neonViolet, '#e0d0ff'], ['#ff7a3a', '#ffe0b8']];
  function launch(big) {
    const [ox, oy] = MORTARS[(Math.random() * MORTARS.length) | 0];
    const tx = clamp(ox + (Math.random() - 0.5) * 170, 884, 1224);
    const ty = clamp(oy - 170 - Math.random() * 110, 8, 76);
    const kind = Math.random() < 0.18 ? 4 : (Math.random() * 4) | 0;   // 4 = a heart, for the likes
    fw.rockets.push({ x: ox, y: oy - 8, sx: ox, sy: oy - 8, tx, ty, t: 0, dur: 1.0 + Math.random() * 0.5, big: !!big, kind, col: kind === 4 ? [P.neonPink, '#ffd0e8'] : FW_COLS[(Math.random() * FW_COLS.length) | 0] });
    arcs.push({ born: S.t || 0 });
  }
  function explode(r) {
    const n = rm ? 16 : r.big ? 64 : 46, sp = (r.big ? 74 : 56) * (rm ? 0.7 : 1);
    const second = FW_COLS[(FW_COLS.indexOf(r.col) + 2) % FW_COLS.length] || r.col;
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2 + (r.kind === 4 ? 0 : Math.random() * 0.2);
      let vx, vy;
      if (r.kind === 4) {
        // a heart: x = 16 sin^3 a, y = -(13 cos a - 5 cos 2a - 2 cos 3a - cos 4a)
        const hx = 16 * Math.pow(Math.sin(a), 3), hy = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
        vx = hx / 16 * sp * 0.9; vy = hy / 16 * sp * 0.9;
      } else {
        const v = sp * (r.kind === 1 ? 1 : 0.55 + Math.random() * 0.55);
        vx = Math.cos(a) * v; vy = Math.sin(a) * v * 0.88;
      }
      const inner = r.kind === 0 && k % 3 === 0;   // peonies get a second, inner colour
      fw.sparks.push({ x: r.tx, y: r.ty, px: r.tx, py: r.ty, vx: inner ? vx * 0.5 : vx, vy: inner ? vy * 0.5 : vy, age: 0,
        life: (r.kind === 2 ? 2.2 : r.kind === 4 ? 1.6 : 1.25) + Math.random() * 0.5,
        col: r.kind === 2 ? ['#ffc860', '#fff2c0'] : inner ? second : r.col, willow: r.kind === 2, crackle: r.kind === 3, heart: r.kind === 4 });
    }
    fw.flash = { x: r.tx, y: r.ty, age: 0, col: r.col[1] };
    try { S.audio.sfx('firework'); } catch (e) { /* audio is optional */ }
  }
  function stepFireworks(t, dt) {
    const f = F;
    // steady launches: one per ~30 s / posts, never when nothing is queued
    if (f.posts > 0) {
      const iv = Math.max(2.6, 30 / f.posts) * (rm ? 2.5 : 1);
      if (t >= fw.next) { launch(false); fw.next = t + iv * (0.7 + Math.random() * 0.6); }
    } else fw.next = t + 3;
    // ceremony burst during the council beat (reports handed over: the week's posts go out)
    const cer = S.cycle && S.cycle.ceremony;
    if (cer && cer.progress >= S.CEREMONY_BEATS.council[0] && cer.progress < S.CEREMONY_BEATS.council[1]) {
      if (!fw.burstDone) { fw.burstDone = true; fw.burst = Math.min(12, f.posts); fw.burstNext = t; }
    } else if (!cer) fw.burstDone = false;
    if (fw.burst > 0 && t >= fw.burstNext) { launch(true); fw.burst--; fw.burstNext = t + (rm ? 1.4 : 0.32 + Math.random() * 0.25); }
    for (let i = fw.rockets.length - 1; i >= 0; i--) {
      const r = fw.rockets[i];
      r.t += dt / r.dur;
      const e = 1 - Math.pow(1 - Math.min(1, r.t), 2);
      r.x = r.sx + (r.tx - r.sx) * e; r.y = r.sy + (r.ty - r.sy) * e;
      if (r.t >= 1) { explode(r); fw.rockets.splice(i, 1); }
    }
    for (let i = fw.sparks.length - 1; i >= 0; i--) {
      const p = fw.sparks[i];
      p.age += dt;
      if (p.age > p.life) { fw.sparks.splice(i, 1); continue; }
      const drag = Math.pow(p.willow ? 0.25 : p.heart ? 0.2 : 0.12, dt);
      p.px = p.x; p.py = p.y;
      p.vx *= drag; p.vy = p.vy * drag + (p.willow ? 26 : p.heart ? 7 : 16) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    if (fw.flash) { fw.flash.age += dt; if (fw.flash.age > 0.22) fw.flash = null; }
    for (let i = arcs.length - 1; i >= 0; i--) if (t - arcs[i].born > 1.8 || t < arcs[i].born) arcs.splice(i, 1);
  }
  function drawFireworks(ctx, night) {
    ctx.globalCompositeOperation = 'lighter';
    // rockets: a bright head and a sputtering ember trail
    for (const r of fw.rockets) {
      for (let k = 1; k < 9; k++) {
        const u = k / 9, x = r.x + (r.sx - r.x) * u * 0.22 + (rm ? 0 : (S.hash(k, Math.floor(r.t * 40), 742) - 0.5) * 2 * u), y = r.y + (r.sy - r.y) * u * 0.22;
        ctx.globalAlpha = (1 - u) * 0.8; D(ctx, x, y, k < 3 ? '#ffe0a0' : '#ff8a3a');
      }
      ctx.globalAlpha = 0.35; R(ctx, r.x - 1, r.y - 1, 3, 3, '#ffc070');
      ctx.globalAlpha = 1; R(ctx, r.x, r.y, 1, 2, '#ffffff');
    }
    // the burst flash: a white core and a soft coloured bloom
    if (fw.flash && !rm) {
      const { x, y } = fw.flash, k = 1 - fw.flash.age / 0.22;
      ctx.globalAlpha = 0.25 * k; S.px.circle(ctx, x, y, 7, fw.flash.col || '#ffffff');
      ctx.globalAlpha = 0.8 * k; R(ctx, x - 2, y - 2, 5, 5, '#ffffff'); R(ctx, x - 5, y, 11, 1, '#fff6d8'); R(ctx, x, y - 5, 1, 11, '#fff6d8');
    }
    for (const p of fw.sparks) {
      const k = p.age / p.life, head = k < 0.45 && !rm;
      if (p.crackle && k > 0.65 && !rm) {
        // crackle: the burst breaks into white pops
        if (S.hash(Math.round(p.x), Math.round(p.y), Math.floor(p.age * 18)) < 0.35) { ctx.globalAlpha = 1 - k * 0.6; R(ctx, p.x, p.y, 2, 1, '#ffffff'); R(ctx, p.x + 0.5, p.y - 0.5, 1, 2, '#ffffff'); }
        continue;
      }
      const fade = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
      // streak back along the motion (longer for willows)
      const tl = p.willow ? 0.09 : 0.05;
      ctx.globalAlpha = fade * 0.55;
      L(ctx, p.x - p.vx * tl, p.y - p.vy * tl, p.x, p.y, p.col[0]);
      if (p.willow && k > 0.3) { ctx.globalAlpha = fade * 0.4; D(ctx, p.x, p.y + 2, '#ffb347'); }
      // halo, then the head
      if (head) { ctx.globalAlpha = fade * (night ? 0.3 : 0.2); R(ctx, p.x - 1, p.y - 1, 4, 4, p.col[0]); }
      ctx.globalAlpha = fade;
      const c = k < 0.25 ? p.col[1] : p.col[0];
      if (head) R(ctx, p.x, p.y, 2, 2, c); else D(ctx, p.x, p.y, c);
      // a little twinkle as they die
      if (!rm && k > 0.7 && S.hash(Math.round(p.x), Math.round(p.y), Math.floor(p.age * 12)) < 0.15) { ctx.globalAlpha = 0.9; D(ctx, p.x, p.y, '#ffffff'); }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ============================================================ STRING LIGHTS */
  const BULBS = [];
  const BULB_COLS = [P.neonPink, '#ffd27a', P.neonCyan, '#a6ff5c', P.neonViolet];
  const WX0 = GEO.ox, WY0 = GEO.oy;
  const [wires, wg] = mk(GEO.bw, GEO.bh);   // the wire layer, drawn at 400
  (function buildStrings() {
    let bi = 0;
    for (const [a, b, sag] of STRINGS) {
      const [ax, ay] = ANCHOR[a], [bx, by] = ANCHOR[b];
      const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1));
      let prev = null;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps, x = Math.round(ax + (bx - ax) * u), y = Math.round(ay + (by - ay) * u + sag * 4 * u * (1 - u));
        wg.fillStyle = '#1b1426';
        if (prev !== null && Math.abs(prev - y) > 1) wg.fillRect(x - WX0, Math.min(prev, y) - WY0, 1, Math.abs(prev - y));
        wg.fillRect(x - WX0, y - WY0, 1, 1);
        prev = y;
        if (i % 5 === 2 && i > 1 && i < steps - 1) { const c = BULB_COLS[bi % BULB_COLS.length]; BULBS.push({ x, y: y + 1, c, hi: mix(c, '#ffffff', 0.6), k: bi, dim: false }); bi++; }
      }
    }
    for (const b of BULBS) { wg.fillStyle = mix(b.c, '#2a2238', 0.55); wg.fillRect(b.x - WX0, b.y - WY0, 1, 2); }
  })();
  const WBOX = (function () {
    const d = wg.getImageData(0, 0, GEO.bw, GEO.bh).data;
    let x0 = GEO.bw, y0 = GEO.bh, x1 = 0, y1 = 0;
    for (let y = 0; y < GEO.bh; y++) for (let x = 0; x < GEO.bw; x++) if (d[(y * GEO.bw + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 >= x0 ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
  })();
  for (const [a, b, sag] of STRINGS) {
    const [ax, ay] = ANCHOR[a], [bx, by] = ANCHOR[b];
    light({ x: (ax + bx) / 2, y: (ay + by) / 2 + sag, r: 24, color: '#ffc8f0', intensity: 0.42 });
  }
  // Edison bulbs under Angie's awning: a full row, the cosiest light on the island
  const EDISON = []; for (let k = 0; k < 9; k++) EDISON.push([ANG.x + 5 + k * 9 + 1, ANG.y + 1 + 13 + 14 + 10]);
  const LANTERNS = GROWTH >= 1 ? [[NOOD.x + 10, NOOD.y + 23], [NOOD.x + 29, NOOD.y + 24], [NOOD.x + 48, NOOD.y + 23]] : [];

  /* ============================================================ DYNAMIC */
  // 100: the neon waterfall. The water runs over the south-east lip, down the
  // underside's face (lit edge west, shaded edge east), on past the rock into
  // space, where it frays into glowing droplets that fade as they fall.
  const FALL_PER = 9, FALL_FREE = 16, FALL_FRAY = 30;
  const fallTex = {};
  function fallTexture(winter) {
    const key = winter ? 'w' : 's';
    if (fallTex[key]) return fallTex[key];
    const H = 200 + FALL_PER;
    const [c, g] = mk(FALL_W, H);
    for (let y = 0; y < H; y++) for (let i = 0; i < FALL_W; i++) {
      const u = Math.min(1, y / 150);
      const streak = (y + i * 4 + (i & 1) * 3) % FALL_PER;
      let col;
      if (winter) col = streak < 2 ? '#ffffff' : i < 2 ? '#e2f0ff' : i >= FALL_W - 2 ? '#8fb0e0' : '#b8d4f4';
      else {
        const body = i === 0 ? FALLC.light : i === 1 ? FALLC.base : i >= FALL_W - 1 ? FALLC.deep : i >= FALL_W - 2 ? FALLC.dark : (i + y) % 3 ? FALLC.base : FALLC.dark;
        col = streak < 2 ? (i < 3 ? FALLC.white : FALLC.light) : streak === 2 ? FALLC.light : body;
        if (u > 0.3) col = mix(col, streak > 5 ? FALLC.pink : FALLC.violet, (u - 0.3) * 0.65);
      }
      D(g, i, y, col);
    }
    return (fallTex[key] = c);
  }
  const DROPS = [];
  for (let k = 0; k < 30; k++) DROPS.push({ ph: S.hash(k, 1, 770), dx: (S.hash(k, 2, 770) - 0.5) * 2, col: k % 5 === 0 ? FALLC.pink : k % 3 === 0 ? FALLC.violet : FALLC.light });
  const MIST = [];
  for (let k = 0; k < 10; k++) MIST.push({ ph: S.hash(k, 3, 770), dx: (S.hash(k, 4, 770) - 0.5) * (FALL_W + 8), sp: 0.5 + S.hash(k, 5, 770) * 0.6 });
  S.registerDynamic(100, (ctx, t) => {
    const winter = winterNow();
    const tt = rm ? t * 0.2 : t;
    // shimmer on the pool and the channel
    for (let k = 0; k < 4; k++) {
      const ph = (tt * 0.7 + k * 0.25) % 1, cyc = Math.floor(tt * 0.7 + k * 0.25);
      ctx.globalAlpha = 0.8 * (1 - ph);
      D(ctx, POOL.x - 5 + ((S.hash(k, cyc, 771) * 10) | 0), POOL.y - 2 + ((S.hash(k, cyc, 772) * 4) | 0), '#ffffff');
    }
    for (let k = 0; k < 4; k++) {
      const f = FALL[1 + k * 2], y = POOL.y + 4 + ((tt * 16 + k * 5) % Math.max(1, f.lip - POOL.y - 4));
      ctx.globalAlpha = 0.75; D(ctx, f.x, y, FALLC.white);
    }
    ctx.globalAlpha = 1;
    // the sheet: one scrolled 1-px slice of the streak texture per column
    const tex = fallTexture(winter), flow = tt * 40, off = FALL_PER - 1 - (Math.floor(flow) % FALL_PER);
    for (let k = 0; k < FALL_W; k++) {
      const f = FALL[k], len = f.bot - f.lip + FALL_FREE + (k === 0 || k === FALL_W - 1 ? -4 : 0);
      if (len <= 0) continue;
      ctx.globalAlpha = k === 0 || k === FALL_W - 1 ? 0.8 : 1;
      ctx.drawImage(tex, k, off, 1, Math.min(200, len), f.x, f.lip, 1, Math.min(200, len));
    }
    ctx.globalAlpha = 1;
    // a bright, foaming lip where it tips over, and a little mist
    for (const f of FALL) { D(ctx, f.x, f.lip, FALLC.white); D(ctx, f.x, f.lip + 1, winter ? '#e8f4ff' : FALLC.light); }
    if (!rm) for (let k = 0; k < 4; k++) D(ctx, FALL_X0 - 1 + ((S.hash(k, Math.floor(t * 8), 773) * (FALL_W + 2)) | 0), FALL[0].lip + ((S.hash(k, Math.floor(t * 8), 774) * 3) | 0), '#ffffff');
    const bot = Math.min(...FALL.map((f) => f.bot)) + FALL_FREE, cx = FALL_X0 + FALL_W / 2;
    for (const m of MIST) {
      const ph = (tt * 0.25 * m.sp + m.ph) % 1;
      ctx.globalAlpha = 0.35 * (1 - ph) * Math.min(1, ph * 5);
      R(ctx, cx + m.dx * (0.6 + ph * 0.6), FALL[0].lip + 2 - ph * 6, ph > 0.5 ? 2 : 1, ph > 0.5 ? 2 : 1, winter ? '#ffffff' : '#c8f6ff');
    }
    // on into space: the column frays and narrows, dropping pixels as it goes
    for (let y = bot; y < bot + FALL_FRAY; y++) {
      const u = (y - bot) / FALL_FRAY, half = FALL_W / 2 - Math.round(u * 2);
      for (let x = -half; x < half; x++) {
        const streak = ((y - Math.floor(flow) + (x + half) * 4) % FALL_PER + FALL_PER) % FALL_PER;
        if (S.hash(x, y + Math.floor(flow / 3), 775) < u * 0.85) continue;
        ctx.globalAlpha = (1 - u) * 0.85;
        D(ctx, cx + x, y, winter ? (streak < 2 ? '#ffffff' : '#c8dcf8') : streak < 2 ? FALLC.white : mix(FALLC.violet, FALLC.pink, u));
      }
    }
    for (const dr of DROPS) {
      const ph = (tt * 0.32 + dr.ph) % 1, y = bot + 8 + ph * 80, x = cx + dr.dx * (2 + ph * 10);
      ctx.globalAlpha = (1 - ph) * 0.85;
      D(ctx, x, y, winter ? '#e8f4ff' : dr.col);
      if (ph < 0.3) D(ctx, x, y - 1, winter ? '#ffffff' : FALLC.base);
    }
    if (winter) { // icicles along the lip either side of the flow
      ctx.globalAlpha = 1;
      for (const [dx, l] of [[-3, 4], [-2, 2], [FALL_W + 1, 3], [FALL_W + 2, 5]]) { R(ctx, FALL_X0 + dx, FALL[0].lip, 1, l, '#e8f4ff'); D(ctx, FALL_X0 + dx, FALL[0].lip, '#ffffff'); }
    }
    ctx.globalAlpha = 1;
  }, ISL);

  // 200: the big display spinner on the Fidgetly counter (barely turning while on hold), the ferris wheel.
  const SPIN = { x: FID.x + 1 + 40, y: FID.y + 1 + 24 + 14 - 9 };
  S.registerDynamic(200, (ctx, t) => {
    const a = PAUSED ? Math.sin(t * 0.7) * 0.5 : rm ? t * 1.2 : t * 9;
    const lobes = ['#ff4f6e', '#3ec8f0', '#ffd84a'];
    for (let k = 0; k < 3; k++) {
      const aa = a + k * Math.PI * 2 / 3, x = Math.round(SPIN.x + Math.cos(aa) * 3), y = Math.round(SPIN.y + Math.sin(aa) * 3);
      R(ctx, x - 1, y - 1, 3, 3, OUT); R(ctx, x - 1, y - 1, 2, 2, lobes[k]); D(ctx, x - 1, y - 1, sh(lobes[k], 0.5));
    }
    R(ctx, SPIN.x - 1, SPIN.y - 1, 3, 3, OUT); D(ctx, SPIN.x, SPIN.y, '#e8e4f0');
    if (GROWTH >= 3) drawWheel(ctx, t);
  }, ISL);

  // 400: steam from the espresso machine, the cafe table and the noodle pot; wires; the mast windsock.
  const STEAM = [[ANG.x + 1 + 67, ANG.y + 1 + 6], [TABLE.x + 8, TABLE.y + 4], [ANG.x + 14, ANG_CT - 13]];
  if (GROWTH >= 1) STEAM.push([NOOD.x + 1 + 15, NOOD.y + 1 + 32 - 10]);
  S.registerDynamic(400, (ctx, t) => {
    const n = rm ? 3 : 7;
    for (let s = 0; s < STEAM.length; s++) {
      const [sx, sy] = STEAM[s];
      const big = s === 0 || s === 3;
      for (let k = 0; k < n; k++) {
        const ph = (t * (rm ? 0.12 : 0.45) + k / n + s * 0.37) % 1;
        const y = sy - ph * (big ? 20 : 11), x = sx + Math.sin(ph * 6 + t * 1.3 + s) * ph * 2.5;
        ctx.globalAlpha = 0.7 * (1 - ph) * Math.min(1, ph * 6);
        ctx.fillStyle = ph < 0.4 ? '#f6f2fa' : '#d8d2e4';
        const sz = big && ph > 0.4 ? 2 : 1;
        ctx.fillRect(Math.round(x), Math.round(y), sz, sz);
      }
    }
    ctx.globalAlpha = 1;
    if (WBOX) ctx.drawImage(wires, WBOX.x, WBOX.y, WBOX.w, WBOX.h, WX0 + WBOX.x, WY0 + WBOX.y, WBOX.w, WBOX.h);
    // windsock on the mast head, streaming toward Clockspire
    const wx = MAST.x + 4, wy = MAST.top - 2;
    R(ctx, wx, wy - 6, 1, 7, OUT);
    for (let k = 0; k < 9; k++) {
      const wav = rm ? 0 : Math.round(Math.sin(t * 5 - k * 0.8) * (k / 9) * 1.5);
      const c = Math.floor(k / 3) % 2 ? '#f4f0fa' : P.neonPink;
      R(ctx, wx + 1 + k, wy - 6 + wav + (k > 5 ? 1 : 0), 1, k < 4 ? 3 : 2, c);
    }
  }, ISL);

  // 700: lit neon, the billboard screen, bulbs, lanterns, beacons + rings, fireworks.
  let flick = { idx: -1, until: 0, next: 6 };
  S.registerDynamic(700, (ctx, t) => {
    const f = feed(t);
    const dark = darkness(), night = dark > 0.45;
    if (t !== fw.lastT) { stepFireworks(t, fw.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - fw.lastT))); fw.lastT = t; }

    // neon flicker: now and then one tube stutters; the on-hold signs stutter more often
    if (!rm && t > flick.next) {
      const dims = SIGNS.map((s, i) => (s.dim ? i : -1)).filter((i) => i >= 0);
      const pickDim = dims.length && Math.random() < 0.5;
      flick = { idx: pickDim ? dims[(Math.random() * dims.length) | 0] : (Math.random() * SIGNS.length) | 0, until: t + 0.5, next: t + 5 + Math.random() * 7 };
    }
    const pauseBreath = rm ? 0.75 : 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.4));
    const level = (s, i) => {
      let on = 1;
      if (i === flick.idx && t < flick.until) on = S.hash(i, Math.floor(t * 24), 740) < 0.5 ? 0.12 : 1;
      if (s.dim) on *= 0.4;
      if (s.opts.pause) on *= pauseBreath;
      return on;
    };
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < SIGNS.length; i++) {
      const s = SIGNS[i], sp = neonSprites(s.icon, s.col);
      ctx.globalAlpha = (0.28 + 0.62 * dark) * level(s, i);
      ctx.drawImage(sp.halo, s.x - sp.pad, s.y - sp.pad);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < SIGNS.length; i++) {
      const s = SIGNS[i], sp = neonSprites(s.icon, s.col);
      ctx.globalAlpha = Math.max(0.15, level(s, i));
      ctx.drawImage(sp.lit, s.x - sp.pad, s.y - sp.pad);
    }
    ctx.globalAlpha = 1;

    // billboard neon trim (red when the island is critical) with chasing dots
    const crit = (S.status[ID] || {}).level === 'critical';
    const trim = crit ? '#ff4a3a' : P.neonPink;
    ctx.globalAlpha = 0.9;
    R(ctx, BB.x + 1, BB.y + 1, BB.w - 2, 1, trim); R(ctx, BB.x + 1, BB.y + 31, BB.w - 2, 1, trim);
    R(ctx, BB.x + 1, BB.y + 1, 1, 31, trim); R(ctx, BB.x + BB.w - 2, BB.y + 1, 1, 31, trim);
    if (!rm) for (let k = 0; k < 4; k++) {
      const per = 2 * (BB.w - 3) + 2 * 30, p = Math.floor((t * 40 + k * per / 4) % per);
      let x, y;
      if (p < BB.w - 3) { x = BB.x + 1 + p; y = BB.y + 1; } else if (p < BB.w - 3 + 30) { x = BB.x + BB.w - 2; y = BB.y + 1 + p - (BB.w - 3); }
      else if (p < 2 * (BB.w - 3) + 30) { x = BB.x + BB.w - 2 - (p - (BB.w - 3) - 30); y = BB.y + 31; } else { x = BB.x + 1; y = BB.y + 31 - (p - 2 * (BB.w - 3) - 30); }
      ctx.globalAlpha = 1; D(ctx, x, y, '#ffffff');
    }
    ctx.globalAlpha = 1;

    // billboard screen (re-rendered at ~12 fps)
    const stamp = Math.floor(t * 12);
    if (stamp !== scrStamp) { scrStamp = stamp; renderScreen(t); }
    ctx.drawImage(scr, SCR.x, SCR.y);
    if (dark > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.18 * dark; ctx.drawImage(scr, SCR.x, SCR.y);
      ctx.globalAlpha = 0.12 * dark; R(ctx, SCR.x - 2, SCR.y - 2, SCR.w + 4, SCR.h + 4, '#7fb8ff');
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }

    // string bulbs
    const tw = Math.floor(t * 3);
    for (const b of BULBS) {
      b.dim = !rm && S.hash(b.k, tw, 741) < 0.07;
      ctx.globalAlpha = b.dim ? 0.35 : 1;
      R(ctx, b.x, b.y, 1, 2, b.c); D(ctx, b.x, b.y, b.hi);
    }
    if (dark > 0.2) {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.28 * dark;
      for (const b of BULBS) if (!b.dim) R(ctx, b.x - 1, b.y - 1, 3, 4, b.c);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
    // Angie's: Edison bulbs, a warm wash over the counter and the window of the pastry case
    for (let k = 0; k < EDISON.length; k++) {
      const [x, y] = EDISON[k], sw = rm ? 0 : Math.round(Math.sin(t * 1.3 + k) * 0.4);
      D(ctx, x + sw, y, '#5a3a20'); R(ctx, x + sw, y + 1, 1, 2, '#ffd27a'); D(ctx, x + sw, y + 2, '#fff2c0');
    }
    {
      const warm = 0.1 + 0.35 * dark;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = warm * (rm ? 1 : 0.92 + 0.08 * Math.sin(t * 7.3));
      R(ctx, ANG.x + 6, ANG.y + 38, ANG.w - 12, 13, '#7a4a1a');
      ctx.globalAlpha = warm * 0.8; R(ctx, ANG.x + 26, ANG_CT - 8, 20, 7, '#5a4a2a');
      if (dark > 0.2) { ctx.globalAlpha = 0.35 * dark; for (const [x, y] of EDISON) R(ctx, x - 1, y, 3, 4, '#ffb84d'); }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    for (let i = 0; i < LANTERNS.length; i++) {
      const [x, y] = LANTERNS[i], sw = rm ? 0 : Math.round(Math.sin(t * 1.6 + i) * 0.6);
      R(ctx, x + sw, y - 2, 1, 2, '#2a1a14');
      R(ctx, x - 2 + sw, y, 5, 6, OUT); R(ctx, x - 1 + sw, y, 3, 6, '#e8402a'); R(ctx, x - 2 + sw, y + 1, 5, 4, '#e8402a');
      R(ctx, x - 1 + sw, y + 1, 1, 4, dark > 0.3 ? '#ffd27a' : '#ff7a5a'); R(ctx, x - 1 + sw, y, 3, 1, P.gold); R(ctx, x - 1 + sw, y + 5, 3, 1, P.gold);
      if (dark > 0.2) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.3 * dark; R(ctx, x - 3 + sw, y - 1, 7, 8, '#ff7a3a'); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
    }
    // vending machine, hut window, ring light and the spring after dark
    if (dark > 0.2) {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.45 * dark;
      R(ctx, VEND.x + 1, VEND.y + 4, 11, 12, '#7fdfff');
      R(ctx, HUT.x + 3, HUT.y + 13, 10, 7, '#3ef0ff');
      ctx.globalAlpha = (PAUSED ? 0.2 : 0.5) * dark; S.px.circle(ctx, RING.x + 6, RING.y - 8, 4, '#ffffff');
      ctx.globalAlpha = 0.3 * dark; S.px.circle(ctx, POOL.x, POOL.y, 4, '#3a8ab8');
      for (const fl of FALL) R(ctx, fl.x, fl.lip, 1, fl.bot - fl.lip + FALL_FREE, '#1a3a6a');
      ctx.globalAlpha = 0.12 * dark; R(ctx, FALL_X0 - 3, FALL[0].lip, FALL_W + 6, FALL[0].bot - FALL[0].lip + FALL_FREE, '#5a7aff');
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    // Lumi's camera: a red REC dot while videos are planned
    if (f.planned > 0) {
      const on = rm ? true : Math.floor(t * 1.5) % 2 === 0;
      if (on) { D(ctx, TRIPOD.x + 10, TRIPOD.y - 12, '#ff3a3a'); if (dark > 0.2) { ctx.globalAlpha = 0.35; R(ctx, TRIPOD.x + 9, TRIPOD.y - 13, 3, 3, '#ff3a3a'); ctx.globalAlpha = 1; } }
    }
    // ferris wheel bulbs
    if (GROWTH >= 3) {
      const a0 = wheelAngle(t);
      for (let k = 0; k < 16; k++) {
        const a = a0 + (k + 0.5) / 16 * Math.PI * 2;
        const on = rm || ((k + Math.floor(t * 4)) % 3 !== 0);
        D(ctx, WHEEL.cx + Math.cos(a) * WHEEL.r, WHEEL.cy + Math.sin(a) * WHEEL.r, on ? BULB_COLS[k % 5] : '#3a3050');
      }
    }

    // the mast: its neon tube spirals up (a pulse runs to the top), the docking ring glows
    {
      const { x, base, top } = MAST;
      const run = rm ? -1 : (t * 30) % (base - top + 20);
      for (let y = MAST_HEADB + 2; y < MAST_FOOT - 1; y++) {
        const yy = MAST_FOOT - y, near = run >= 0 && Math.abs(yy - run) < 3;
        const back = Math.cos(y * 0.35) < 0;
        ctx.globalAlpha = back ? 0.45 : 1;
        D(ctx, x + Math.round(Math.sin(y * 0.35) * (mastHW(y) - 1)), y, near ? '#ffffff' : (y >> 3) % 2 ? P.neonPink : '#ff8ad0');
      }
      ctx.globalAlpha = 1;
      const ringPulse = rm ? 1 : 0.75 + 0.25 * Math.sin(t * 3);
      // halo first (hugging the oval, like the signs), then a soft dithered bloom after dark
      ctx.globalCompositeOperation = 'lighter';
      const hs = neonSprites('hoop', P.neonPink);
      ctx.globalAlpha = (0.2 + 0.6 * dark) * ringPulse;
      ctx.drawImage(hs.halo, DOCK.x - HOOP.rx - hs.pad, DOCK.y - HOOP.ry - hs.pad);
      if (dark > 0.15) {
        const bl = dockBloom();
        ctx.globalAlpha = 0.4 * dark * ringPulse;
        ctx.drawImage(bl, DOCK.x - (bl.width >> 1), DOCK.y - (bl.height >> 1));
        ctx.globalAlpha = 0.18 * dark; ctx.drawImage(mastGlow(), x - MAST_GLOW_HW, MAST_HEADB);
      }
      ctx.globalCompositeOperation = 'source-over';
      for (let a = 0; a < 48; a++) {
        const an = a / 48 * Math.PI * 2, c = Math.cos(an), s = Math.sin(an);
        ctx.globalAlpha = ringPulse * (c > 0.2 ? 0.55 : 1);
        D(ctx, DOCK.x + c * HOOP.rx, DOCK.y + s * HOOP.ry, a % 6 === 0 ? '#ffffff' : P.neonPink);
      }
      ctx.globalAlpha = 1;
      mastBeaconLit = rm ? true : (t + 0.7) % 2.2 < 0.5;
      ctx.globalAlpha = mastBeaconLit ? 1 : 0.25;
      R(ctx, x - 1, top - 2, 3, 2, '#ff4a3a'); D(ctx, x, top - 2, '#ffd0c8');
      ctx.globalAlpha = 1;
    }

    // tower beacon: blinking aviation light; faster while a ceremony runs
    const cer = S.cycle && S.cycle.ceremony;
    let b;
    if (rm) b = 0.55 + 0.45 * Math.sin(t * 1.3);
    else { const per = cer ? 0.6 : 1.6; b = (t % per) < per * 0.3 ? 1 : 0.12; }
    beaconLit = b > 0.5;
    ctx.globalAlpha = Math.max(0.15, b);
    R(ctx, BEACON.x - 1, BEACON.y, 3, 2, '#ff4a3a'); D(ctx, BEACON.x, BEACON.y, '#ffd0c8');
    if (b > 0.3) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = b * (0.25 + 0.45 * dark); R(ctx, BEACON.x - 2, BEACON.y - 1, 5, 4, '#ff4a3a');
      ctx.globalAlpha = b * (0.1 + 0.25 * dark); R(ctx, BEACON.x - 4, BEACON.y, 9, 2, '#ff4a3a'); R(ctx, BEACON.x - 1, BEACON.y - 3, 3, 8, '#ff4a3a');
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
    // radio rings: one per launch, and steadily while the ceremony transmits
    if (cer && !rm && (arcs.length === 0 || t - arcs[arcs.length - 1].born > 1.1)) arcs.push({ born: t });
    for (const a of arcs) {
      const age = t - a.born, rr = 4 + age * (rm ? 10 : 24);
      if (age < 0) continue;
      ctx.globalAlpha = Math.max(0, 0.8 * (1 - age / 1.8));
      const nn = Math.ceil(rr * 2.2);
      for (let k = 0; k <= nn; k += 2) {
        const ang = Math.PI * (1.12 + 0.76 * k / nn);
        D(ctx, BEACON.x + Math.cos(ang) * rr, BEACON.y + 6 + Math.sin(ang) * rr * 0.7, P.neonCyan);
      }
    }
    ctx.globalAlpha = 1;

    drawFireworks(ctx, night);
  }, ISL);

  /* ============================================================ REGISTER */
  S.registerStatic(7, (ctx) => {
    const key = season();
    if (!groundCache[key]) groundCache[key] = buildGround(key);
    ctx.drawImage(groundCache[key], GEO.ox, GEO.oy);
  });
  S.registerStatic(22, (ctx) => { F = readFeed(); drawBuildings(ctx); });
})();
