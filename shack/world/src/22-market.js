/* The Shack — Neon Night Market (Lumi, social-ops).
 *
 * Owns region "market" (tiles x 40..63, y 0..15, the north-east corner).
 * Static: night-plum pavement with baked neon reflections, puddles and a
 * painted mural (order 7); billboard, broadcast tower on its equipment hut,
 * Angie's cafe stall, the fidget store promo stall with Lumi's filming rig,
 * a neon pole sign, lamp posts, planters, a vending machine and firework
 * mortars; more stalls, a TV wall and a ferris wheel at higher growth
 * (order 22). Dynamic: the spinning display fidget and the ferris wheel
 * (200), cafe and noodle steam and the string-light wires (400), and over
 * the dark (700) the lit neon tubes, the billboard screen, string bulbs,
 * lanterns, the tower beacon with its radio rings, and the fireworks.
 *
 * Data (social-ops metrics only, nothing invented):
 *   billboard     cycles through real metrics: scheduled_posts_7d (one tile
 *                 per queued post, coloured by client), store_ads videos
 *                 planned / posted, link clicks. Test-card "standby" when empty.
 *   fireworks     launch rate from scheduled_posts_7d (none when 0), plus a
 *                 burst during the cycle ceremony's council beat.
 *   Angie's stall polaroids pinned on the counter = Angie's posts_next_7d.
 *   fidget stall  film frames on the counter = videos planned (posted ones lit).
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S) return;

  const T = S.TILE, P = S.PAL, C = S.color;
  const AGENT = 'social-ops';
  const GROWTH = ((S.status && S.status.market) || {}).growth | 0;
  const rm = S.reducedMotion;
  const OUT = P.outline;

  /* ------------------------------------------------------------- palette */
  const PLUM = { grout: '#2a1f3f', deep: '#33264a', dark: '#3a2b53', base: '#43335e', light: '#4c3b69', hi: '#5a4876' };
  const LANE = { grout: '#2e2346', dark: '#4a3a68', base: '#554476', light: '#625184', hi: '#76669a' };
  const CURB = { line: '#160e21', dark: '#463a60', base: '#685a84', light: '#8b7ea8', hi: '#b0a6c9' };
  const STEEL = { deep: '#1b1929', dark: '#2e2b43', base: '#484563', light: '#6b688b', hi: '#9c99ba' };
  const CONC = { deep: '#3d3750', dark: '#5a536c', base: '#7b7490', light: '#9d97b0', hi: '#c2bdd1' };
  const WOOD = { deep: '#3a2214', dark: '#5a3720', base: '#7e5030', light: '#a26c40', hi: '#c99a62' };
  const TEAL = { deep: '#14332f', dark: '#1e514a', base: '#2c7366', light: '#479783', hi: '#80c4a8' };
  const CREAM = { dark: '#c9b28a', base: '#eddcb8', light: '#fbf2da' };
  const NEON = { pink: P.neonPink, cyan: P.neonCyan, violet: P.neonViolet, amber: '#ffb347', yellow: '#ffe45c', lime: '#a6ff5c', red: '#ff4a4a' };
  const SHADOW_INK = '#120b1c';
  const RAINBOW = ['#ff4f6e', '#ff9a3c', '#ffd84a', '#5fd36a', '#3ec8f0', '#9b6bff'];

  /* ------------------------------------------------------- tiny helpers */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sh = (c, a) => C.shade(c, a);
  const mix = (a, b, t) => C.mix(a, b, t);
  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w); c.height = Math.max(1, h);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    return [c, g];
  }
  const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const D = (g, x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  const L = (g, x0, y0, x1, y1, c) => S.px.line(g, x0, y0, x1, y1, c);
  function vnoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const sm = (q) => q * q * (3 - 2 * q);
    const a = S.hash(xi, yi, seed), b = S.hash(xi + 1, yi, seed), c = S.hash(xi, yi + 1, seed), d = S.hash(xi + 1, yi + 1, seed);
    const u = sm(xf), v = sm(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
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
  /** Draw a built sprite so its local (0,0) lands on world (x,y); sh = [dx, dy, alpha] drop shadow. */
  function place(ctx, spr, x, y, shd) {
    if (shd) {
      ctx.globalAlpha = shd[2] || 0.26;
      ctx.drawImage(spr.sil || (spr.sil = silhouette(spr)), Math.round(x - 1 + shd[0]), Math.round(y - 1 + shd[1]));
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(spr, Math.round(x - 1), Math.round(y - 1));
  }
  /** Soft dithered contact shadow (an ellipse) on the ground. */
  function groundShadow(ctx, cx, cy, rx, ry, a) {
    ctx.fillStyle = C.rgba(SHADOW_INK, a == null ? 0.25 : a);
    for (let y = -ry; y <= ry; y++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.5))));
      ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
    }
  }
  /** Parse a mask given as rows of '#' / '.' into a point list. */
  function mask(rows) {
    const pts = [];
    rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] !== '.' && row[x] !== ' ') pts.push([x, y, row[x]]); });
    return { w: rows[0].length, h: rows.length, pts };
  }
  const season = () => (S.time && S.time.season) || 'autumn';

  /* ---------------------------------------------------------- data feed */
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const CLIENT_COL = (name, i) => (/angie/i.test(name || '') ? '#ffb347' : /fidget/i.test(name || '') ? P.neonCyan : ['#ff6fb5', '#a6ff5c', '#c79bff'][i % 3]);
  function readFeed() {
    const m = S.metrics(AGENT) || {};
    const ads = m.store_ads || {};
    const clients = (Array.isArray(m.clients) ? m.clients : []).filter((c) => c && typeof c === 'object');
    const angie = clients.find((c) => /angie/i.test(c.name || ''));
    const list = clients.map((c, i) => ({ name: String(c.name || ''), n: Math.max(0, Math.round(num(c.posts_next_7d))), col: CLIENT_COL(c.name, i) }));
    return {
      posts: Math.max(0, Math.round(num(m.scheduled_posts_7d))),
      planned: Math.max(0, Math.round(num(ads.videos_planned))),
      posted: Math.max(0, Math.round(num(ads.videos_posted_7d))),
      clicks: Math.max(0, Math.round(num(ads.link_clicks_7d))),
      clients: list,
      angiePosts: angie ? Math.max(0, Math.round(num(angie.posts_next_7d))) : 0,
    };
  }
  let F = readFeed(), feedAt = 0;
  const feed = (t) => { if (t - feedAt > 5 || t < feedAt) { F = readFeed(); feedAt = t; updateLabels(); } return F; };

  /* ============================================================ GEOMETRY
   * Native px. The pavement fills the region from x 662 east and y 246 north.
   */
  const PAVE = { x0: 662, y1: 246, r: 14 };
  const BB = { x: 778, y: 2, w: 96, h: 57 };                 // billboard sprite origin
  const SCR = { x: BB.x + 4, y: BB.y + 3, w: 88, h: 27 };   // its screen
  const HUT = { x: 922, y: 58, w: 44, h: 28 };
  const TWR = { cx: 944, base: 62, top: 8 };                // lattice tower on the hut roof
  const BEACON = { x: TWR.cx, y: 2 };
  const ANG = { x: 702, y: 86, w: 84, h: 64 };               // Angie's cafe stall
  const TABLE = { x: 682, y: 130 };
  const AFRAME = { x: 772, y: 150 };
  const FID = { x: 856, y: 152, w: 80, h: 56 };              // fidget store promo stall
  const TRIPOD = { x: 874, y: 214 };
  const RING = { x: 904, y: 212 };
  const POLE = { x: 797, y: 160 };                           // neon pole sign (box top-left)
  const VEND = { x: 970, y: 62 };
  const NOOD = { x: 958, y: 96, w: 60, h: 52 };              // growth >= 1
  const TVW = { x: 676, y: 28, w: 44, h: 52 };               // growth >= 2
  const STK = { x: 668, y: 170, w: 52, h: 46 };              // growth >= 2
  const WHEEL = { cx: 990, cy: 192, r: 24, base: 240 };      // growth >= 3
  const MORTARS = [[1000, 88], [952, 240], [672, 150]];
  const SELFIE = { x: 884, y: 104, w: 40, h: 30 };          // the selfie wall: Lumi's photo spot
  const LANE_R = { x0: 798, x1: 866, y0: 60, y1: 160 };
  const MURAL = { x: 822, y: 112 };

  // Lamp posts that carry the string lights: [x feet, y feet, height]. Two rows line the lane.
  const LAMPS = [[796, 88, 28], [868, 88, 28], [796, 118, 28], [868, 118, 28], [794, 148, 28], [870, 146, 28], [688, 92, 24], [704, 244, 22], [940, 246, 22]];
  const top = (i) => [LAMPS[i][0], LAMPS[i][1] - LAMPS[i][2]];
  const ANCHOR = {
    L1: top(0), R1: top(1), L2: top(2), R2: top(3), L3: top(4), R3: top(5), A: top(6), D: top(7), E: top(8),
    C: [POLE.x + 7, POLE.y - 1], BL: [BB.x + 2, BB.y + 35], BR: [BB.x + 94, BB.y + 35], H: [HUT.x + 2, HUT.y + 1],
    AW: [ANG.x + 4, ANG.y + 28], AE: [ANG.x + 80, ANG.y + 28], FW: [FID.x + 4, FID.y + 12], FE: [FID.x + 76, FID.y + 12],
  };
  // across the lane (the canopy), along it, and out to the stalls
  const STRINGS = [['L1', 'R1', 7], ['L2', 'R2', 7], ['L3', 'R3', 7],
    ['BL', 'L1', 4], ['BR', 'R1', 4], ['R1', 'H', 6], ['A', 'AW', 5], ['AE', 'L2', 4], ['R3', 'FE', 6], ['D', 'C', 9], ['C', 'FW', 5], ['FE', 'E', 10]];

  // Planters with little trees: [x feet, y feet, seed]
  const PLANTERS = [[750, 78, 1], [936, 146, 2], [774, 214, 3]];
  if (GROWTH < 3) PLANTERS.push([1006, 236, 4]);
  const BENCHES = [[752, 192]];
  if (GROWTH < 3) BENCHES.push([986, 214]);
  // Closed carts under tarps stand where stalls will open as the market grows.
  const TARPS = [];
  if (GROWTH < 1) TARPS.push([NOOD.x + 4, NOOD.y + 18, 52, 1]);
  if (GROWTH < 2) TARPS.push([STK.x + 2, STK.y + 14, 46, 2], [TVW.x + 2, TVW.y + 22, 38, 3]);

  /* ----------------------------------------------------- reserve tiles */
  S.reserve(41, 0, 23, 16);   // the whole plaza: scattered meadow decor stays out

  /* ============================================================ GROUND (7) */
  const POOLS = [
    [826, 70, 58, '#7fd8ff', 0.36], [744, 162, 40, '#ffb050', 0.42], [896, 216, 42, P.neonPink, 0.36],
    [944, 96, 26, P.neonCyan, 0.32], [904, 142, 24, P.neonPink, 0.3], [806, 214, 26, P.neonPink, 0.36], [976, 96, 16, P.neonCyan, 0.36],
    [832, 120, 96, P.neonViolet, 0.18], [700, 110, 34, P.neonViolet, 0.16],
  ];
  if (GROWTH >= 1) POOLS.push([988, 154, 32, '#ff7040', 0.30]);
  if (GROWTH >= 2) POOLS.push([698, 86, 30, P.neonCyan, 0.26], [694, 222, 26, P.neonViolet, 0.28]);
  if (GROWTH >= 3) POOLS.push([990, 236, 34, P.neonViolet, 0.26]);
  const PUDDLES = [[780, 196, 12, 3], [968, 196, 8, 2], [712, 162, 7, 2]];

  const inLane = (x, y) => x >= LANE_R.x0 && x < LANE_R.x1 && y >= LANE_R.y0 && y < LANE_R.y1;
  function paveDist(x, y) {
    const dx = x - PAVE.x0, dy = PAVE.y1 - 1 - y, r = PAVE.r;
    if (dx < 0 || dy < 0) return -1;
    if (dx < r && dy < r) { const cx = r - dx, cy = r - dy; return r - Math.sqrt(cx * cx + cy * cy); }
    return Math.min(dx, dy);
  }

  const groundCache = {};
  function buildGround(sea) {
    const X0 = 640, W = 384, H = 256;
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
      const wx = X0 + x, wy = y;
      const dd = paveDist(wx, wy);
      if (dd < 0) continue;
      const i = (y * W + x) * 4;
      let c;
      if (dd < 1) c = cb.line;
      else if (dd < 3.2) {
        const leftEdge = (wx - PAVE.x0) < (PAVE.y1 - 1 - wy);
        const along = leftEdge ? wy : wx;
        if (along % 11 === 0) c = cb.dark;
        else if (leftEdge) c = dd < 2 ? cb.light : cb.base;
        else c = dd < 2 ? cb.dark : cb.light;
        if (S.hash(wx, wy, 701) < 0.08) c = cb.hi;
      } else if (dd < 4.2) c = pal.grout;
      else if (inLane(wx, wy)) {
        // the lane: glazed square tiles with LED strips along both edges
        const ex = Math.min(wx - LANE_R.x0, LANE_R.x1 - 1 - wx);
        if (ex === 0) c = ln.grout;
        else if (ex === 1) c = ((wy >> 2) & 3) === 3 ? ln.grout : rgb((wx < 832) === ((wy >> 4) % 2 === 0) ? P.neonPink : P.neonCyan);
        else if (ex === 2) c = ln.grout;
        else {
          const lx = (wx - LANE_R.x0 - 3) % 10, ly = (wy - LANE_R.y0) % 10;
          const ph = S.hash(Math.floor((wx - LANE_R.x0 - 3) / 10), Math.floor((wy - LANE_R.y0) / 10), 710);
          const tone = ph < 0.25 ? ln.dark : ph < 0.85 ? ln.base : ln.light;
          if (lx === 0 || ly === 0) c = ln.grout;
          else if (lx === 1 || ly === 1) c = ln.hi;
          else if (lx === 9 || ly === 9) c = ln.dark;
          else c = S.hash(wx, wy, 711) < 0.06 ? ln.light : tone;
          if (lx === 5 && ly === 5 && ph > 0.9) c = ln.hi;
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
      // puddles: darker, glossy, with streaky reflections
      if (dd >= 5) for (const [px, py, rx, ry] of PUDDLES) {
        const e = ((wx - px) / rx) ** 2 + ((wy - py) / ry) ** 2 + (vnoise(wx * 0.35, wy * 0.5, 704) - 0.5) * 0.6;
        if (e < 1) {
          c = lerp(rgb('#2a2045'), c, 0.45);
          if (Math.abs(wx - px + 2) < 1.5 && ((wy + wx) & 1)) c = lerp(c, rgb(px < 820 ? P.neonPink : P.neonCyan), 0.35);
          if (e > 0.62 && wy <= py) c = lerp(c, rgb('#8c7cb8'), 0.4);
        }
      }
      // painted mural in the middle of the plaza: a faded "play" badge
      {
        const mx = wx - MURAL.x, my = (wy - MURAL.y) * 1.25, mr = Math.sqrt(mx * mx + my * my);
        const worn = S.hash(wx, wy, 705) < 0.22;
        if (!worn && dd >= 5) {
          if (mr > 14.2 && mr < 17.2) c = lerp(c, paint.ring, 0.42);
          else if (mx > -5 && mx < 8 && Math.abs(my) < (8 - mx) * 0.75 && mx > -5) c = lerp(c, paint.tri, 0.42);
          else if (mr > 19.5 && mr < 20.5 && (Math.round(Math.atan2(my, mx) * 6) & 1)) c = lerp(c, paint.dot, 0.35);
        }
      }
      // confetti from past launches
      if (dd >= 5 && S.hash(wx, wy, 706) < 0.0018) c = lerp(c, confetti[(S.hash(wx, wy, 707) * 6) | 0], 0.75);
      if (winter && dd >= 1) {
        // drifts along the curb and in soft patches; snow packed into the grout; the lane is swept
        const n = vnoise(wx * 0.045, wy * 0.06, 709) + (vnoise(wx * 0.2, wy * 0.2, 712) - 0.5) * 0.25;
        const edge = dd < 9 ? (9 - dd) / 9 : 0;
        const lane = inLane(wx, wy);
        const v = n + edge * 0.6 - (lane ? 0.35 : 0);
        const isGrout = c === pal.grout || c === pal.deep;
        if (v > 0.68) c = v > 0.74 || bayer(wx, wy) < (v - 0.68) / 0.06 ? (v > 0.9 ? snow : lerp(snow, snowD, 0.4)) : c;
        else if (isGrout && v > 0.4) c = snowD;
        else if (S.hash(wx, wy, 708) < 0.012) c = snow;
      }
      set(i, c);
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  /* ========================================================= NEON SIGNS */
  const ICONS = {
    heart: mask([
      '.##...##.',
      '#..#.#..#',
      '#...#...#',
      '#.......#',
      '.#.....#.',
      '..#...#..',
      '...#.#...',
      '....#....']),
    star: mask([
      '....#....',
      '...#.#...',
      '...#.#...',
      '###...###',
      '.#.....#.',
      '..#...#..',
      '..#.#.#..',
      '.#.#.#.#.',
      '.##...##.']),
    note: mask([
      '..######',
      '..#....#',
      '..######',
      '..#....#',
      '..#....#',
      '###..###',
      '###..###']),
    cup: mask([
      '..#..#...',
      '...#..#..',
      '..#..#...',
      '.........',
      '#######..',
      '#.....###',
      '#.....#.#',
      '#.....###',
      '.#...#...',
      '..###....']),
    spinner: mask([
      '....###....',
      '...#...#...',
      '...#...#...',
      '....#.#....',
      '.##..#..##.',
      '#..#...#..#',
      '#...###...#',
      '.###...###.']),
    play: mask([
      '.#########.',
      '#...#.....#',
      '#...##....#',
      '#...#.#...#',
      '#...##....#',
      '#...#.....#',
      '.#########.']),
    waves: mask([
      '.#.......#.',
      '#..#...#..#',
      '#.#..#..#.#',
      '#..#...#..#',
      '.#.......#.']),
    bowl: mask([
      '.....#..#',
      '....#..#.',
      '#########',
      '#.......#',
      '.#.....#.',
      '..#####..']),
    camera: mask([
      '..###....',
      '#######.#',
      '#.....###',
      '#..#..#.#',
      '#.....###',
      '#######.#']),
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
  /** Draw a dark backing board with the unlit glass tubes (static). */
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
  const SIGNS = [];   // {icon, col, x, y} world position of the icon's top-left
  function sign(icon, col, bx, by, opts) { SIGNS.push({ icon, col, x: bx + 3, y: by + 3, ph: SIGNS.length * 1.7, opts: opts || {} }); return [bx, by]; }

  // Sign placements (board top-left in world px).
  const SIGN_ANG = sign('cup', NEON.amber, ANG.x + 37, ANG.y - 2);
  const SIGN_FID1 = sign('spinner', NEON.cyan, FID.x + 20, FID.y - 2);
  const SIGN_FID2 = sign('play', NEON.pink, FID.x + 40, FID.y - 1);
  const SIGN_HUT = sign('waves', NEON.cyan, HUT.x + 14, HUT.y + 4);
  const SIGN_POLE = [sign('heart', NEON.pink, POLE.x - 1, POLE.y, { board: false }), sign('star', NEON.yellow, POLE.x - 1, POLE.y + 11, { board: false }), sign('note', NEON.cyan, POLE.x, POLE.y + 23, { board: false })];
  sign('heart', NEON.pink, SELFIE.x + 12, SELFIE.y + 3, { board: false, glassOnWall: true });
  if (GROWTH >= 1) sign('bowl', NEON.amber, NOOD.x + 22, NOOD.y - 2);
  if (GROWTH >= 2) sign('star', NEON.yellow, STK.x + 19, STK.y - 4);
  if (GROWTH >= 2) sign('camera', NEON.violet, TVW.x + 15, TVW.y - 12);

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
  function popit(g, x, y, cols, rows) {
    for (let j = 0; j < rows; j++) {
      const c = RAINBOW[j % 6];
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
    }, OUT));
  }

  /* ---- equipment hut with the broadcast tower on its roof ---- */
  function hutSprite() {
    return cached('hut', () => build(HUT.w, HUT.h, (g) => {
      const w = HUT.w;
      // roof (top face) with parapet
      R(g, 0, 0, w, 8, CONC.light);
      for (let j = 1; j < 7; j++) for (let i = 1; i < w - 1; i++) if (S.hash(i, j, 714) < 0.12) D(g, i, j, CONC.base);
      R(g, 0, 0, w, 1, CONC.hi); R(g, 0, 7, w, 1, CONC.base);
      R(g, 0, 0, 1, 8, CONC.hi); R(g, w - 1, 0, 1, 8, CONC.base);
      // tower foot pads
      R(g, 9, 3, 4, 3, CONC.dark); R(g, 31, 3, 4, 3, CONC.dark);
      // rooftop AC unit
      R(g, 34, 0, 9, 6, '#b8b4c6'); R(g, 34, 0, 9, 1, '#e2def0'); R(g, 34, 5, 9, 1, '#7f7a92');
      R(g, 36, 1, 5, 4, '#5a5570'); D(g, 38, 3, '#2a2638'); D(g, 37, 2, '#8a85a0'); D(g, 39, 2, '#8a85a0');
      // cable tray from tower to the wall
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
      // a microwave dish seen from the side, facing west
      const rows = ['...####....', '..#oooo#...', '.#ooooo#...', '#ooooooo#..', '#oooooooo#.', '#ooooooo#..', '#ooooooo#..', '.#oooooo#..', '..#oooo#...', '...####....'];
      rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] !== '.') D(g, i, j + 1, r[i] === '#' ? '#8f8aa6' : (i + j < 7 ? '#ffffff' : i > 5 ? '#b9b4cc' : '#e4e0ee')); });
      R(g, 6, 4, 1, 4, '#9a95ad');
      L(g, 3, 5, 0, 5, '#4a4764'); D(g, 0, 5, '#2a2638');
      R(g, 8, 5, 3, 2, STEEL.base);
    }, OUT));
  }
  function drawTower(ctx) {
    const { cx, base, top } = TWR;
    const hw = (y) => 2 + (y - top) / (base - top) * 11;
    const red = (y) => Math.floor((y - top) / 8) % 2 === 0;
    // ground shadow of the tower falling bottom-right of the hut
    ctx.fillStyle = C.rgba(SHADOW_INK, 0.2);
    for (let k = 0; k < 30; k++) ctx.fillRect(HUT.x + HUT.w + 1 + k, HUT.y + 22 + Math.round(k * 0.5), k > 22 ? 2 : 4, 1);
    // guy wires
    ctx.globalAlpha = 0.8;
    L(ctx, cx - 6, 28, 902, 80, '#2a2340'); L(ctx, cx + 6, 28, 990, 82, '#2a2340');
    ctx.globalAlpha = 1;
    for (const [ax, ay] of [[902, 80], [990, 82]]) { R(ctx, ax - 3, ay - 1, 6, 4, OUT); R(ctx, ax - 2, ay, 4, 2, CONC.light); R(ctx, ax - 2, ay, 4, 1, CONC.hi); }
    // X bracing in each section, light steel so it reads against the plum
    for (let y = top + 2; y < base; y += 7) {
      const y2 = Math.min(base, y + 7);
      const a = Math.round(cx - hw(y)) + 2, b = Math.round(cx + hw(y)) - 2, a2 = Math.round(cx - hw(y2)) + 2, b2 = Math.round(cx + hw(y2)) - 2;
      L(ctx, a, y, b2, y2, '#8d89a8'); L(ctx, b, y, a2, y2, '#6b688b');
      R(ctx, a2, y2, b2 - a2 + 1, 1, '#a9a5c2');
    }
    // legs: 2 px, banded red / white, outlined
    for (let y = top; y <= base; y++) {
      const xl = Math.round(cx - hw(y)), xr = Math.round(cx + hw(y)), r = red(y);
      D(ctx, xl - 1, y, OUT); D(ctx, xl, y, r ? '#e8564a' : '#f4f0fa'); D(ctx, xl + 1, y, r ? '#a8302a' : '#b8b2ca'); D(ctx, xl + 2, y, OUT);
      D(ctx, xr - 2, y, OUT); D(ctx, xr - 1, y, r ? '#c8403a' : '#d8d2e6'); D(ctx, xr, y, r ? '#8e241f' : '#9a94ae'); D(ctx, xr + 1, y, OUT);
    }
    // platforms with railings
    for (const py of [24, 44]) {
      const w2 = Math.round(hw(py)) + 4;
      R(ctx, cx - w2 - 1, py - 1, w2 * 2 + 3, 4, OUT);
      R(ctx, cx - w2, py, w2 * 2 + 1, 2, STEEL.light); R(ctx, cx - w2, py, w2 * 2 + 1, 1, STEEL.hi);
      R(ctx, cx - w2, py - 4, w2 * 2 + 1, 1, '#8d89a8');
      for (let x = cx - w2; x <= cx + w2; x += 4) R(ctx, x, py - 4, 1, 4, '#8d89a8');
    }
    // panel antennas on the top platform, a dish on the lower one
    for (const ox of [-8, 6]) { R(ctx, cx + ox - 1, 12, 4, 11, OUT); R(ctx, cx + ox, 13, 2, 9, '#d8d4e4'); R(ctx, cx + ox, 13, 1, 9, '#ffffff'); D(ctx, cx + ox + 1, 21, '#9a95ad'); }
    place(ctx, dishSprite(), cx - hw(36) - 11, 30);
    // mast + beacon housing
    R(ctx, cx - 1, 1, 3, top + 1, OUT); R(ctx, cx, 2, 1, top, '#c8c4dc');
    R(ctx, cx - 2, 0, 5, 3, OUT); R(ctx, cx - 1, 1, 3, 1, '#7a1d1a');
  }

  /* ---- Angie's cafe stall ---- */
  function angieSprite() {
    return cached('ang', () => build(ANG.w, ANG.h, (g) => {
      const w = ANG.w;
      // posts for the sign board
      R(g, 39, 10, 2, 5, WOOD.dark); R(g, 52, 10, 2, 5, WOOD.dark);
      // cabin roof: teal shingles
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
      // striped awning: cream and teal
      awning(g, 0, RT + RH - 1, w, 9, [{ base: CREAM.base, light: CREAM.light, dark: CREAM.dark }, { base: TEAL.base, light: TEAL.light, dark: TEAL.dark }], 6, 2);
      if (winterNow()) snowCap(g, 0, RT + RH - 1, w, 2);
      const WY = RT + RH + 10; // under the awning
      // back wall in warm shade
      R(g, 5, WY, w - 10, 12, '#4a2e22');
      for (let i = 5; i < w - 5; i += 6) R(g, i, WY, 1, 12, '#3a2219');
      R(g, 5, WY, w - 10, 2, '#2c1914');
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
      // counter top
      const CT = WY + 12;
      R(g, 2, CT, w - 4, 3, '#c99060'); R(g, 2, CT, w - 4, 1, '#ecc08a'); R(g, 2, CT + 2, w - 4, 1, '#8a5a34');
      // espresso machine
      R(g, 8, CT - 9, 12, 9, '#b9b6c8'); R(g, 8, CT - 9, 12, 1, '#f1eff8'); R(g, 8, CT - 9, 1, 9, '#e0def0'); R(g, 19, CT - 9, 1, 9, '#7d7990');
      R(g, 10, CT - 7, 3, 2, '#2a2638'); R(g, 15, CT - 7, 3, 2, '#2a2638'); D(g, 11, CT - 4, '#2a2638'); D(g, 16, CT - 4, '#2a2638');
      R(g, 10, CT - 2, 3, 2, '#f4ede0'); R(g, 15, CT - 2, 3, 2, '#f4ede0'); D(g, 18, CT - 8, '#ff5a4a');
      R(g, 9, CT - 11, 10, 2, '#e8e2f0'); R(g, 10, CT - 12, 2, 1, '#f4ede0'); R(g, 13, CT - 12, 2, 1, '#f4ede0'); R(g, 16, CT - 12, 2, 1, '#f4ede0');
      // pastry case
      const px0 = 24, pw = 22;
      R(g, px0, CT - 9, pw, 9, WOOD.dark); R(g, px0 + 1, CT - 8, pw - 2, 7, '#c8e4e6'); R(g, px0 + 1, CT - 8, pw - 2, 1, '#f2fbfb');
      R(g, px0 + 1, CT - 4, pw - 2, 1, '#9ec2c6');
      for (let i = 0; i < 5; i++) { // croissants on the top shelf
        const x = px0 + 2 + i * 4; R(g, x, CT - 6, 3, 2, '#d99a42'); D(g, x + 1, CT - 6, '#f6c46a'); D(g, x + 2, CT - 5, '#a8682a');
      }
      for (let i = 0; i < 5; i++) { // cupcakes / macarons below
        const x = px0 + 2 + i * 4, c = ['#ff9ac0', '#a8e0b8', '#ffd27a', '#c9a8ff', '#ff9ac0'][i];
        R(g, x, CT - 3, 3, 1, c); R(g, x, CT - 2, 3, 1, '#8a5a34'); D(g, x + 1, CT - 4, '#fff6ea');
      }
      D(g, px0 + 2, CT - 8, '#ffffff'); D(g, px0 + 3, CT - 8, '#ffffff');
      // register, cups, tip jar, flowers
      R(g, 50, CT - 6, 8, 6, '#3c3a4a'); R(g, 50, CT - 6, 8, 1, '#6a6880'); R(g, 51, CT - 8, 6, 2, '#2a2836'); R(g, 52, CT - 8, 4, 1, '#7ff0c0');
      for (let k = 0; k < 4; k++) R(g, 61, CT - 2 - k * 2, 3, 2, k % 2 ? '#f4ede0' : '#e2d6c4');
      R(g, 66, CT - 5, 4, 5, '#cfe8ec'); R(g, 66, CT - 5, 4, 1, '#ffffff'); D(g, 67, CT - 2, P.gold); D(g, 68, CT - 1, P.goldDark); D(g, 67, CT - 1, '#7cb04a');
      R(g, 73, CT - 4, 3, 4, '#5a7ab8'); D(g, 72, CT - 6, '#ff7a3a'); D(g, 74, CT - 7, '#ffb347'); D(g, 76, CT - 6, '#e0402a'); D(g, 74, CT - 5, '#3c7a2e');
      // counter front: walnut planks
      planks(g, 3, CT + 3, w - 6, 13, { deep: '#3a2214', dark: '#5e3a22', base: '#7a4c2c', light: '#94603a', hi: '#b07a4a' }, 6);
      // cork board for pinned posts (polaroids are drawn from data in drawAngiePins)
      R(g, 29, CT + 5, 26, 9, '#3a2214'); R(g, 30, CT + 6, 24, 7, '#c08a52');
      for (let j = 0; j < 7; j++) for (let i = 0; i < 24; i++) if (S.hash(i, j, 719) < 0.25) D(g, 30 + i, CT + 6 + j, '#a87240');
      // awning support posts
      R(g, 1, WY - 1, 2, CT + 16 - WY, WOOD.light); R(g, w - 3, WY - 1, 2, CT + 16 - WY, WOOD.base);
      // potted mums at the right corner
      const pot = { autumn: ['#e8742a', '#b8322a', '#ffb347'], winter: ['#2e6a3a', '#c8202a', '#f4f8fb'], spring: ['#ff8ab8', '#ffd84a', '#ffffff'], summer: ['#e8402a', '#ffd84a', '#ff8ab8'] }[season()] || ['#e8742a', '#b8322a', '#ffb347'];
      R(g, 74, CT + 10, 7, 6, '#a0522d'); R(g, 74, CT + 10, 7, 1, '#c87a4a'); R(g, 80, CT + 10, 1, 6, '#6e3418');
      for (let k = 0; k < 9; k++) D(g, 74 + ((S.hash(k, 3, 720) * 7) | 0), CT + 6 + ((S.hash(k, 4, 720) * 4) | 0), pot[k % 3]);
      R(g, 75, CT + 9, 5, 1, '#3c7a2e');
    }, OUT));
  }
  function tableSprite() {
    return cached('tbl', () => build(20, 18, (g) => {
      // two wire chairs
      for (const cx of [1, 15]) { R(g, cx, 5, 4, 1, '#2f2c44'); R(g, cx, 1, 1, 5, '#2f2c44'); R(g, cx + 3, 6, 1, 6, '#2f2c44'); R(g, cx, 6, 1, 6, '#2f2c44'); R(g, cx, 5, 4, 1, '#6b688b'); }
      // round table top + stem
      R(g, 8, 8, 1, 9, '#3a3650'); R(g, 6, 16, 5, 1, '#3a3650');
      R(g, 4, 5, 12, 4, '#e9e4f0'); R(g, 5, 4, 10, 1, '#ffffff'); R(g, 4, 8, 12, 1, '#a9a3bb');
      // coffee cup + a croissant on a plate
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

  /* ---- fidget store promo stall ---- */
  function fidgetSprite() {
    return cached('fid', () => build(FID.w, FID.h, (g) => {
      const w = FID.w;
      // rainbow awning
      awning(g, 0, 11, w, 11, stripes(RAINBOW), 5, 2);
      if (winterNow()) snowCap(g, 0, 11, w, 3);
      const WY = 24;
      // pegboard back wall
      R(g, 4, WY, w - 8, 14, '#cfa874');
      for (let j = WY + 1; j < WY + 14; j += 3) for (let i = 5; i < w - 4; i += 3) D(g, i, j, '#9a7448');
      R(g, 4, WY, w - 8, 2, '#7a5634');
      // hanging fidgets
      popit(g, 7, WY + 3, 3, 4);
      popit(g, 60, WY + 3, 3, 4);
      tinySpinner(g, 17, WY + 4, '#ff4f6e'); tinySpinner(g, 22, WY + 7, '#3ec8f0'); tinySpinner(g, 17, WY + 9, '#ffd84a');
      tinySpinner(g, 52, WY + 4, '#5fd36a'); tinySpinner(g, 54, WY + 9, '#9b6bff');
      // fidget rings
      for (const [x, y, c] of [[27, WY + 4, '#ffd84a'], [31, WY + 4, '#ff9a3c'], [27, WY + 8, '#3ec8f0']]) { R(g, x, y, 3, 3, c); D(g, x + 1, y + 1, '#cfa874'); D(g, x, y, sh(c, 0.4)); }
      // infinity cubes
      for (const [x, y] of [[44, WY + 4], [44, WY + 9]]) { R(g, x, y, 5, 4, '#3a3650'); R(g, x, y, 2, 2, '#ff4f6e'); R(g, x + 3, y, 2, 2, '#ffd84a'); R(g, x, y + 2, 2, 2, '#3ec8f0'); R(g, x + 3, y + 2, 2, 2, '#5fd36a'); }
      // squishy balls on a shelf
      R(g, 34, WY + 11, 14, 1, WOOD.light);
      for (let i = 0; i < 4; i++) { const c = ['#ff9ac0', '#a6ff5c', '#9ff0ff', '#ffe45c'][i]; R(g, 35 + i * 3, WY + 9, 2, 2, c); D(g, 35 + i * 3, WY + 9, '#ffffff'); }
      // counter top (white laminate) with stock boxes
      const CT = WY + 14;
      R(g, 2, CT, w - 4, 3, '#ece8f4'); R(g, 2, CT, w - 4, 1, '#ffffff'); R(g, 2, CT + 2, w - 4, 1, '#a9a3bb');
      for (const [x, c] of [[6, '#ff4f6e'], [12, '#3ec8f0'], [56, '#ffd84a'], [62, '#9b6bff'], [68, '#5fd36a']]) {
        R(g, x, CT - 5, 5, 5, c); R(g, x, CT - 5, 5, 1, sh(c, 0.35)); R(g, x + 4, CT - 4, 1, 4, sh(c, -0.3)); D(g, x + 2, CT - 3, '#ffffff');
      }
      // display stand for the big spinning fidget (the spinner itself is dynamic)
      R(g, 37, CT - 3, 7, 3, '#2f2c44'); R(g, 37, CT - 3, 7, 1, '#6b688b'); R(g, 40, CT - 7, 1, 4, '#9c99ba');
      // a phone on a mini tripod for quick takes
      R(g, 24, CT - 8, 4, 7, '#1d1a24'); R(g, 25, CT - 7, 2, 5, '#3ef0ff'); D(g, 25, CT - 7, '#ff4fa3'); L(g, 25, CT - 1, 23, CT, '#4a4764'); L(g, 26, CT - 1, 28, CT, '#4a4764');
      // counter front: violet with a pop-it stripe
      R(g, 3, CT + 3, w - 6, 13, '#4a2a7a'); R(g, 3, CT + 3, w - 6, 1, '#6a48a0'); R(g, 3, CT + 15, w - 6, 1, '#2a1650');
      for (let j = 0; j < 12; j++) for (let i = 0; i < w - 6; i++) if (S.hash(i, j, 721) < 0.05) D(g, 3 + i, CT + 3 + j, '#5a3a8e');
      for (let i = 0; i < 6; i++) { R(g, 6 + i * 3, CT + 6, 2, 8, RAINBOW[i]); D(g, 6 + i * 3, CT + 6, sh(RAINBOW[i], 0.4)); }
      for (let i = 0; i < 6; i++) { R(g, w - 23 + i * 3, CT + 6, 2, 8, RAINBOW[5 - i]); D(g, w - 23 + i * 3, CT + 6, sh(RAINBOW[5 - i], 0.4)); }
      // the film-frame rail (frames are drawn from data in drawFidgetFrames)
      R(g, 26, CT + 5, 28, 1, '#2a1650'); R(g, 26, CT + 13, 28, 1, '#2a1650');
      // support posts
      R(g, 1, WY - 1, 2, CT + 16 - WY, '#e9e4f0'); R(g, w - 3, WY - 1, 2, CT + 16 - WY, '#a9a3bb');
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
      // camera body + lens + hot-shoe mic
      R(g, 1, 2, 11, 7, '#24212f'); R(g, 1, 2, 11, 1, '#4a4764'); R(g, 4, 0, 4, 2, '#24212f');
      S.px.circle(g, 6, 5, 2, '#0e0c16'); D(g, 5, 4, '#5a6aa8'); D(g, 7, 6, '#2a3a6a'); R(g, 9, 0, 3, 2, '#3a3650');
      D(g, 2, 3, '#7a7896');
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
      // noren curtain strips
      R(g, 4, WY, w - 8, 10, '#26324e');
      for (let i = 4; i < w - 4; i += 7) R(g, i, WY, 1, 10, '#141c30');
      for (let i = 6; i < w - 6; i += 7) D(g, i + 2, WY + 4, '#f4ede0');
      // counter top + steaming pot + bowls
      const CT = WY + 10;
      R(g, 2, CT, w - 4, 3, WOOD.light); R(g, 2, CT, w - 4, 1, WOOD.hi); R(g, 2, CT + 2, w - 4, 1, WOOD.dark);
      R(g, 8, CT - 8, 14, 8, '#a9a5b8'); R(g, 8, CT - 8, 14, 1, '#e6e2f0'); R(g, 9, CT - 9, 12, 1, '#5a5670'); R(g, 21, CT - 7, 1, 7, '#6d6984');
      R(g, 10, CT - 9, 10, 1, '#f0d890');
      for (let k = 0; k < 4; k++) { const x = 30 + k * 6; R(g, x, CT - 3, 5, 3, '#f4ede0'); R(g, x, CT - 3, 5, 1, '#c84a3a'); D(g, x + 2, CT - 1, '#c84a3a'); }
      R(g, 50, CT - 7, 2, 7, '#3a5a2a'); R(g, 53, CT - 6, 2, 6, '#8a2a1a'); D(g, 50, CT - 8, '#c8c4d4'); D(g, 53, CT - 7, '#c8c4d4');
      // cart body with a wheel
      planks(g, 3, CT + 3, w - 6, 12, { deep: '#3a1a14', dark: '#5a2a1e', base: '#7a3a26', light: '#94503a', hi: '#b06a4a' }, 7);
      S.px.circle(g, 8, CT + 12, 4, '#2a1a14'); S.px.circle(g, 8, CT + 12, 3, WOOD.light); S.px.circle(g, 8, CT + 12, 1, WOOD.deep);
      L(g, 5, CT + 12, 11, CT + 12, WOOD.dark); L(g, 8, CT + 9, 8, CT + 15, WOOD.dark);
      // stools
      for (const sx of [24, 36, 48]) { R(g, sx, CT + 13, 6, 2, '#d8443a'); R(g, sx, CT + 13, 6, 1, '#ff7a6a'); R(g, sx + 1, CT + 15, 1, 3, '#2f2c44'); R(g, sx + 4, CT + 15, 1, 3, '#2f2c44'); }
    }, OUT));
  }

  /* ---- TV wall (growth >= 2) ---- */
  const TV_SLOTS = [[2, 25, 13, 11], [15, 25, 13, 11], [28, 25, 13, 11], [8, 13, 13, 11], [21, 13, 13, 11], [14, 1, 14, 11]];
  const TV_BODY = ['#d8cdb4', '#7a7690', '#2e7a6e', '#c8483e', '#e8e0cc', '#4a4764'];
  function tvSprite() {
    return cached('tvw', () => build(TVW.w, TVW.h, (g) => {
      for (const [x, cw] of [[0, 22], [22, 22]]) {
        R(g, x, 37, cw, 15, WOOD.base); R(g, x, 37, cw, 1, WOOD.hi); R(g, x, 51, cw, 1, WOOD.deep);
        R(g, x, 37, 1, 15, WOOD.light); R(g, x + cw - 1, 37, 1, 15, WOOD.dark); L(g, x + 1, 38, x + cw - 2, 50, WOOD.dark); L(g, x + 1, 50, x + cw - 2, 38, WOOD.dark);
      }
      TV_SLOTS.forEach(([x, y, w, h], i) => {
        const b = TV_BODY[i];
        R(g, x, y, w, h, b); R(g, x, y, w, 1, sh(b, 0.35)); R(g, x, y, 1, h, sh(b, 0.2)); R(g, x + w - 1, y, 1, h, sh(b, -0.3)); R(g, x, y + h - 1, w, 1, sh(b, -0.35));
        R(g, x + 2, y + 2, w - 6, h - 4, '#0a0d1c');
        D(g, x + w - 3, y + 3, '#2a2638'); D(g, x + w - 3, y + 6, '#2a2638');
      });
      // rabbit-ear antenna
      L(g, 21, 1, 17, -4 + 4, '#3a3650'); L(g, 22, 1, 26, 0, '#3a3650');
      // cables down to the crates
      R(g, 41, 30, 1, 8, '#1d1a24'); R(g, 42, 37, 2, 1, '#1d1a24');
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
      for (let k = 0; k < 7; k++) { // posters
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
      // two legs + the panel
      R(g, 4, h - 6, 2, 6, STEEL.dark); R(g, w - 6, h - 6, 2, 6, STEEL.dark);
      R(g, 0, 0, w, h - 5, '#f2e8f6'); R(g, 0, 0, w, 1, '#ffffff'); R(g, 0, 0, 1, h - 5, '#ffffff'); R(g, w - 1, 0, 1, h - 5, '#b8a8c8'); R(g, 0, h - 6, w, 1, '#a898b8');
      // pastel gradient wash
      for (let y = 2; y < h - 7; y++) R(g, 2, y, w - 4, 1, mix('#ffd6ec', '#d4e6ff', y / (h - 9)));
      // painted angel wings (left + mirrored right)
      const wing = ['....######', '..#########', '.##########', '###########', '.#########.', '..#######..', '...#####...', '....###....'];
      wing.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) if (row[i] === '#') {
          const c = (i + j) % 3 === 0 ? '#ff9ac8' : j < 3 ? '#ffffff' : '#ffc2e0';
          D(g, 3 + i, 6 + j, c); D(g, w - 4 - i, 6 + j, c);
        }
      });
      for (let j = 0; j < 4; j++) { D(g, 5 + j * 2, 9 + j, '#e07ab0'); D(g, w - 6 - j * 2, 9 + j, '#e07ab0'); }
      // little feather strokes
      for (let k = 0; k < 6; k++) { D(g, 4 + k * 2, 15, '#ffb0d8'); D(g, w - 5 - k * 2, 15, '#ffb0d8'); }
      // floor sticker: a standing spot
      R(g, 15, h - 8, 10, 1, '#ff6fb5');
    }, OUT));
  }

  /* ---- props ---- */
  function vendSprite() {
    return cached('vnd', () => build(13, 26, (g) => {
      R(g, 0, 0, 13, 26, '#e8e6f0'); R(g, 0, 0, 13, 1, '#ffffff'); R(g, 12, 0, 1, 26, '#a9a6b8'); R(g, 0, 25, 13, 1, '#8a879a');
      R(g, 0, 0, 13, 3, '#d8443a'); R(g, 0, 0, 13, 1, '#ff7a6a');
      R(g, 1, 4, 11, 12, '#1a2238');
      for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) { const c = ['#ff4f6e', '#3ec8f0', '#ffd84a', '#5fd36a', '#ff9a3c', '#9b6bff'][(r * 4 + k) % 6]; R(g, 2 + k * 3 - (k > 1 ? 0 : 0), 5 + r * 4, 2, 3, c); D(g, 2 + k * 3, 5 + r * 4, '#ffffff'); }
      R(g, 1, 4, 11, 1, '#9ff6ff');
      R(g, 9, 17, 2, 3, '#4a4764'); D(g, 9, 18, '#ffe45c');
      R(g, 2, 21, 7, 3, '#2a2638'); R(g, 2, 21, 7, 1, '#5a5670');
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
      R(g, 0, 3, 18, 3, WOOD.light); R(g, 0, 3, 18, 1, WOOD.hi); R(g, 0, 5, 18, 1, WOOD.dark);
      R(g, 1, 2, 1, 1, '#2f2c44'); R(g, 16, 2, 1, 1, '#2f2c44');
      R(g, 1, 6, 2, 3, '#2f2c44'); R(g, 15, 6, 2, 3, '#2f2c44'); D(g, 1, 6, '#6b688b'); D(g, 15, 6, '#6b688b');
    }, OUT));
  }
  function planterSprite(seed) {
    return cached('plt' + seed, () => {
      const s = season();
      const fol = s === 'autumn' ? { dark: '#9a3f1e', base: P.leaf.autumn, light: '#eda048', hi: '#f8cf70' }
        : s === 'spring' ? { dark: '#4e8a34', base: P.leaf.spring, light: '#a6dc7a', hi: P.leafAlt.spring }
          : s === 'summer' ? { dark: '#2f5e22', base: P.leaf.summer, light: '#6aa848', hi: '#98cf68' } : null;
      return build(18, 26, (g) => {
        // planter box with a neon trim strip
        R(g, 1, 17, 16, 9, '#3a3054'); R(g, 1, 17, 16, 1, '#6a5c8a'); R(g, 1, 17, 1, 9, '#55487a'); R(g, 16, 17, 1, 9, '#251d3a');
        R(g, 1, 21, 16, 1, seed % 2 ? '#c64a8a' : '#2fb8c8');
        R(g, 2, 17, 14, 2, '#3a2a1e');
        R(g, 8, 11, 2, 7, WOOD.dark); D(g, 8, 14, WOOD.light);
        if (fol) {
          // a round canopy shaded from the top-left, with a leafy noise edge
          for (let y = 0; y < 15; y++) for (let x = 0; x < 18; x++) {
            const dx = (x - 9) / 8, dy = (y - 7) / 7, e = dx * dx + dy * dy + (S.hash(x, y, 725 + seed) - 0.5) * 0.35;
            if (e > 1) continue;
            const lit = -(dx + dy) * 0.7 + (S.hash(x >> 1, y >> 1, 726 + seed) - 0.5) * 0.6;
            D(g, x, y, e > 0.82 ? fol.dark : lit > 0.45 ? fol.hi : lit > 0 ? fol.light : lit > -0.55 ? fol.base : fol.dark);
          }
          for (let k = 0; k < 5; k++) D(g, 4 + ((S.hash(k, seed, 727) * 10) | 0), 3 + ((S.hash(k, seed, 728) * 8) | 0), s === 'autumn' ? P.leafAlt.autumn : fol.hi);
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
        // cart wheels peeking out
        for (const wx of [5, w - 9]) { S.px.circle(g, wx + 2, h - 4, 3, '#2a1a14'); S.px.circle(g, wx + 2, h - 4, 2, WOOD.light); D(g, wx + 2, h - 4, WOOD.deep); }
        // the draped canvas: rounded top, folds, a hem
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
        // ropes tied over the top
        for (const rx of [Math.round(w * 0.28), Math.round(w * 0.72)]) for (let y = 1; y < h - 6; y++) D(g, rx + (y > 12 ? 1 : 0), y, y % 3 ? '#d8c08a' : '#a88a54');
        L(g, 2, 9, w - 3, 10, '#c8b07a');
        // an unlit paper lantern hanging from the front
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
    groundShadow(ctx, x + 9, y + 47, 5, 2, 0.28);
    R(ctx, x + 5, y + 32, 4, 16, OUT); R(ctx, x + 6, y + 32, 1, 15, STEEL.light); R(ctx, x + 7, y + 32, 1, 15, STEEL.base);
    R(ctx, x + 3, y + 46, 8, 2, OUT); R(ctx, x + 4, y + 46, 6, 1, CONC.light);
    // tall dark backing box
    R(ctx, x - 1, y - 1, 16, 34, OUT);
    R(ctx, x, y, 14, 32, '#1f1832'); R(ctx, x, y, 14, 1, '#40365c'); R(ctx, x, y, 1, 32, '#33294d'); R(ctx, x, y + 31, 14, 1, '#140f22');
    for (const yy of [y + 10, y + 21]) R(ctx, x + 2, yy, 10, 1, '#2a2240');
    // glass tubes (unlit)
    for (const s of SIGNS) if (s.opts.board === false && !s.opts.glassOnWall) {
      const m = ICONS[s.icon], glass = mix(s.col, '#2a2238', 0.5);
      for (const [px, py] of m.pts) D(ctx, s.x + px, s.y + py, glass);
    }
  }

  /* ============================================================ DATA BITS (static) */
  function drawAngiePins(ctx) {
    const n = Math.min(6, F.angiePosts);
    const CT = ANG.y + 13 + 14 + 10 + 12;  // matches angieSprite's counter top
    const bx = ANG.x + 30, by = CT + 6;
    for (let k = 0; k < n; k++) {
      const x = bx + 1 + k * 4, y = by + (k % 2);
      R(ctx, x, y, 3, 4, '#fbf6ea'); R(ctx, x, y + 1, 3, 2, ['#ffb347', '#ff9ac0', '#7fc4b0'][k % 3]); D(ctx, x + 1, y, '#e0402a');
    }
    if (!n) { D(ctx, bx + 5, by + 2, '#e0402a'); D(ctx, bx + 14, by + 3, '#3ec8f0'); } // just the pins
  }
  function drawFidgetFrames(ctx) {
    const CT = FID.y + 24 + 14;
    const n = Math.min(4, F.planned), x0 = FID.x + 27, y0 = CT + 6;
    for (let k = 0; k < 4; k++) {
      const x = x0 + k * 7;
      if (k < n) {
        const done = k < F.posted;
        R(ctx, x, y0, 6, 7, done ? '#fbf6ea' : '#2a1650');
        R(ctx, x + 1, y0 + 1, 4, 4, done ? '#3a2a6a' : '#1a0e36');
        D(ctx, x + 2, y0 + 2, done ? '#ff6fb5' : '#7a5aa8'); D(ctx, x + 2, y0 + 3, done ? '#ff6fb5' : '#7a5aa8'); D(ctx, x + 3, y0 + 2, done ? '#ffb0d8' : '#6a4a98');
        if (done) D(ctx, x + 4, y0 + 5, '#ff4fa3');
      } else {
        D(ctx, x + 2, y0 - 1, '#c8c4dc'); // an empty clip on the rail
      }
    }
  }

  /* ============================================================ STATIC (22) */
  function drawBuildings(ctx) {
    const items = [];
    const add = (y, fn) => items.push([y, fn]);
    add(BB.y + BB.h, () => {
      groundShadow(ctx, BB.x + 50, BB.y + 56, 46, 3, 0.2);
      place(ctx, billboardSprite(), BB.x, BB.y, [3, 2, 0.24]);
      // dim neon trim around the frame (lit at 700)
      ctx.globalAlpha = 0.55;
      R(ctx, BB.x + 1, BB.y + 1, BB.w - 2, 1, '#8a3a6a'); R(ctx, BB.x + 1, BB.y + 31, BB.w - 2, 1, '#8a3a6a');
      R(ctx, BB.x + 1, BB.y + 1, 1, 31, '#8a3a6a'); R(ctx, BB.x + BB.w - 2, BB.y + 1, 1, 31, '#8a3a6a');
      ctx.globalAlpha = 1;
    });
    // cable from the hut to the billboard
    add(70, () => {
      ctx.fillStyle = '#16101f';
      for (let x = BB.x + 82; x < HUT.x; x++) ctx.fillRect(x, 58 + Math.round(Math.sin(x * 0.2) * 0.6) + (x > 900 ? 1 : 0), 1, 1);
      ctx.fillStyle = '#4a3a62';
      for (let x = BB.x + 82; x < HUT.x; x += 3) ctx.fillRect(x, 57 + Math.round(Math.sin(x * 0.2) * 0.6) + (x > 900 ? 1 : 0), 1, 1);
    });
    add(HUT.y + HUT.h, () => {
      drawTower(ctx);
      place(ctx, hutSprite(), HUT.x, HUT.y, [3, 2, 0.26]);
      neonBoard(ctx, ...SIGN_HUT, 'waves', NEON.cyan);
    });
    add(VEND.y + 26, () => { place(ctx, vendSprite(), VEND.x, VEND.y, [3, 2, 0.26]); });
    for (const [mx, my] of MORTARS) add(my, () => place(ctx, mortarSprite(), mx - 6, my - 10, [2, 1, 0.25]));
    for (const [x, y, h] of LAMPS) add(y, () => lampPost(ctx, x, y, h));
    for (const [x, y, s] of PLANTERS) add(y, () => place(ctx, planterSprite(s), x - 9, y - 26, [3, 2, 0.24]));
    for (const [x, y] of BENCHES) add(y, () => place(ctx, benchSprite(), x - 9, y - 9, [2, 2, 0.24]));
    add(ANG.y + ANG.h, () => {
      place(ctx, angieSprite(), ANG.x, ANG.y, [3, 2, 0.26]);
      neonBoard(ctx, ...SIGN_ANG, 'cup', NEON.amber);
      drawAngiePins(ctx);
    });
    add(TABLE.y + 18, () => place(ctx, tableSprite(), TABLE.x, TABLE.y, [2, 1, 0.22]));
    add(AFRAME.y + 15, () => place(ctx, aframeSprite(), AFRAME.x, AFRAME.y, [2, 1, 0.24]));
    add(POLE.y + 48, () => poleSign(ctx));
    add(FID.y + FID.h, () => {
      place(ctx, fidgetSprite(), FID.x, FID.y, [3, 2, 0.26]);
      neonBoard(ctx, ...SIGN_FID1, 'spinner', NEON.cyan);
      neonBoard(ctx, ...SIGN_FID2, 'play', NEON.pink);
      drawFidgetFrames(ctx);
    });
    add(FID.y + 56, () => place(ctx, crateSprite(), FID.x + FID.w + 2, FID.y + 40, [2, 2, 0.24]));
    add(TRIPOD.y + 8, () => { groundShadow(ctx, TRIPOD.x + 7, TRIPOD.y + 8, 6, 1, 0.22); place(ctx, tripodSprite(), TRIPOD.x, TRIPOD.y - 13); });
    add(RING.y + 10, () => { groundShadow(ctx, RING.x + 7, RING.y + 10, 5, 1, 0.22); place(ctx, ringLightSprite(), RING.x, RING.y - 13); });
    if (GROWTH >= 1) add(NOOD.y + NOOD.h, () => { place(ctx, noodleSprite(), NOOD.x, NOOD.y, [3, 2, 0.26]); neonBoard(ctx, NOOD.x + 22, NOOD.y - 2, 'bowl', NEON.amber); });
    if (GROWTH >= 2) {
      add(TVW.y + TVW.h, () => { place(ctx, tvSprite(), TVW.x, TVW.y, [3, 2, 0.26]); neonBoard(ctx, TVW.x + 15, TVW.y - 12, 'camera', NEON.violet); });
      add(STK.y + STK.h, () => { place(ctx, stickerSprite(), STK.x, STK.y, [3, 2, 0.26]); neonBoard(ctx, STK.x + 19, STK.y - 4, 'star', NEON.yellow); });
    }
    add(SELFIE.y + SELFIE.h, () => { place(ctx, selfieSprite(), SELFIE.x, SELFIE.y, [3, 2, 0.26]); });
    if (GROWTH >= 3) add(WHEEL.base, () => drawWheelFrame(ctx));
    for (const [x, y, w, seed] of TARPS) add(y + 26, () => place(ctx, tarpSprite(w, seed), x, y, [3, 2, 0.26]));
    if (GROWTH < 2) add(TVW.y + 20, () => { place(ctx, crateSprite(), TVW.x + 4, TVW.y + 4, [2, 2, 0.24]); place(ctx, crateSprite(), TVW.x + 22, TVW.y + 8, [2, 2, 0.24]); });
    items.sort((a, b) => a[0] - b[0]);
    for (const [, fn] of items) fn();
  }

  /* ---- ferris wheel (growth >= 3): frame static, wheel dynamic ---- */
  function drawWheelFrame(ctx) {
    const { cx, cy, r, base } = WHEEL;
    groundShadow(ctx, cx + 6, base, r + 4, 3, 0.24);
    // A-frame legs (back pair darker)
    L(ctx, cx - 1, cy, cx - 18, base - 1, STEEL.dark); L(ctx, cx + 1, cy, cx + 18, base - 1, STEEL.dark);
    for (const [x0, x1, c] of [[cx, cx - 15, STEEL.light], [cx, cx + 15, STEEL.base]]) { L(ctx, x0, cy, x1, base, OUT); L(ctx, x0 + (x1 < x0 ? 1 : -1), cy, x1 + (x1 < x0 ? 1 : -1), base, c); }
    R(ctx, cx - 22, base - 2, 44, 4, OUT); R(ctx, cx - 21, base - 1, 42, 2, WOOD.light); R(ctx, cx - 21, base - 1, 42, 1, WOOD.hi);
    // ticket booth
    R(ctx, cx - 30, base - 13, 10, 13, OUT); R(ctx, cx - 29, base - 12, 8, 11, '#d8443a'); R(ctx, cx - 29, base - 12, 8, 2, '#ffe45c'); R(ctx, cx - 28, base - 8, 6, 3, '#ffd27a');
  }
  function drawWheel(ctx, t) {
    const { cx, cy, r } = WHEEL;
    const a0 = rm ? 0 : t * 0.18;
    // spokes, then an outlined double rim (lit from the top-left)
    for (let k = 0; k < 8; k++) {
      const a = a0 + k / 8 * Math.PI * 2;
      L(ctx, cx, cy, cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), '#a9a5c2');
    }
    for (let k = 0; k < 160; k++) {
      const a = k / 160 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const lit = -(ca + sa) > 0.4;
      D(ctx, Math.round(cx + ca * (r + 1)), Math.round(cy + sa * (r + 1)), OUT);
      D(ctx, Math.round(cx + ca * r), Math.round(cy + sa * r), lit ? '#ffffff' : '#d8d4e6');
      D(ctx, Math.round(cx + ca * (r - 1)), Math.round(cy + sa * (r - 1)), lit ? '#c8c4dc' : '#8d89a8');
      if (k % 4 === 0) D(ctx, Math.round(cx + ca * (r - 4)), Math.round(cy + sa * (r - 4)), '#8d89a8');
    }
    R(ctx, cx - 2, cy - 2, 5, 5, OUT); R(ctx, cx - 1, cy - 1, 3, 3, P.gold);
    for (let k = 0; k < 8; k++) {
      const a = a0 + k / 8 * Math.PI * 2, x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      const c = RAINBOW[k % 6];
      R(ctx, x - 3, y, 7, 6, OUT); R(ctx, x - 2, y + 1, 5, 4, c); R(ctx, x - 2, y + 1, 5, 1, sh(c, 0.4)); R(ctx, x - 1, y + 2, 3, 1, '#2a2440');
      D(ctx, x, y - 1, OUT);
    }
  }

  /* ============================================================ LIGHTS */
  const neonLight = (x, y, color, r = 28, i = 0.75) => S.addLight({ x, y, r, color, intensity: i, nightOnly: false, flicker: false });
  for (const s of SIGNS) neonLight(s.x + (ICONS[s.icon].w >> 1), s.y + (ICONS[s.icon].h >> 1), s.col, 26, 0.7);
  neonLight(SCR.x + SCR.w / 2, SCR.y + SCR.h, '#8fd8ff', 64, 0.85);
  let beaconLit = false;
  S.addLight({ x: BEACON.x, y: BEACON.y + 1, r: 14, color: '#ff4a3a', intensity: 0.9, nightOnly: false, on: () => beaconLit });
  S.addLight({ x: ANG.x + 42, y: ANG.y + 44, r: 46, color: P.lantern, intensity: 0.85, flicker: true });
  S.addLight({ x: FID.x + 40, y: FID.y + 34, r: 40, color: '#ff8ad0', intensity: 0.7 });
  S.addLight({ x: RING.x + 6, y: RING.y - 8, r: 22, color: '#e8f4ff', intensity: 0.6, nightOnly: false });
  S.addLight({ x: VEND.x + 6, y: VEND.y + 12, r: 18, color: '#bff4ff', intensity: 0.7, nightOnly: false });
  S.addLight({ x: HUT.x + 8, y: HUT.y + 17, r: 14, color: P.neonCyan, intensity: 0.5 });
  for (const [x, y, h] of LAMPS) S.addLight({ x, y: y - h, r: 20, color: '#e0d4ff', intensity: 0.55 });
  if (GROWTH >= 1) S.addLight({ x: NOOD.x + 30, y: NOOD.y + 26, r: 40, color: '#ff7a3a', intensity: 0.8, flicker: true });
  if (GROWTH >= 2) { S.addLight({ x: TVW.x + 22, y: TVW.y + 22, r: 34, color: P.neonCyan, intensity: 0.6, nightOnly: false }); S.addLight({ x: STK.x + 26, y: STK.y + 26, r: 32, color: P.neonViolet, intensity: 0.6 }); }
  if (GROWTH >= 3) S.addLight({ x: WHEEL.cx, y: WHEEL.cy, r: 44, color: P.neonViolet, intensity: 0.7, nightOnly: false });

  /* ============================================================ HOTSPOTS */
  // S.addHotspot stores a copy, so keep a handle on the stored object to update its label.
  const hot = (key, label, x, y, w, h) => {
    const id = 'landmark:' + key;
    S.addHotspot({ id, kind: 'landmark', landmark: key, biome: 'market', agent: AGENT, label, x, y, w, h, priority: 1 });
    return S.hotspots.find((q) => q.id === id) || {};
  };
  const hTower = hot('broadcastTower', 'Broadcast Tower', HUT.x - 4, 0, HUT.w + 8, HUT.y + HUT.h + 2);
  const hAng = hot('angiesStall', "Angie's stall", ANG.x - 20, ANG.y - 4, ANG.w + 34, ANG.h + 8);
  const hFid = hot('fidgetStall', 'Fidget store promo stall', FID.x - 2, FID.y - 4, FID.w + 18, FID.h + 30);
  const hBB = hot('billboard', 'Billboard', BB.x, BB.y, BB.w, BB.h);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  function updateLabels() {
    hBB.label = F.posts ? `Billboard · ${plural(F.posts, 'post')} queued this week` : F.planned ? `Billboard · ${plural(F.planned, 'video')} planned` : 'Billboard · standby, nothing queued yet';
    hTower.label = F.posts ? `Broadcast Tower · ${plural(F.posts, 'post')} going out in 7 days` : 'Broadcast Tower · quiet, no posts scheduled';
    hAng.label = F.angiePosts ? `Angie's stall · ${plural(F.angiePosts, 'post')} in the next 7 days` : "Angie's stall · no posts queued yet";
    hFid.label = F.planned || F.posted ? `Fidget store promo stall · ${plural(F.planned, 'video')} planned, ${F.posted} posted` : 'Fidget store promo stall · no videos planned yet';
  }
  updateLabels();

  /* ============================================================ BILLBOARD SCREEN */
  const DIG = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001010010', '111101111101111', '111101111001111'];
  function drawNum(g, n, x, y, s, col, shadow) {
    const str = String(Math.min(99, Math.max(0, n | 0)));
    for (let k = 0; k < str.length; k++) {
      const bits = DIG[+str[k]], ox = x + k * (3 * s + s);
      for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (bits[j * 3 + i] === '1') {
        if (shadow) R(g, ox + i * s + 1, y + j * s + 1, s, s, shadow);
        R(g, ox + i * s, y + j * s, s, s, col);
      }
    }
    return str.length * 4 * s - s;
  }
  const [scr, sg] = mk(SCR.w, SCR.h);
  let scrStamp = -1;
  function modes() {
    const list = [];
    if (F.posts) list.push('posts');
    if (F.planned || F.posted) list.push('videos');
    if (F.clicks) list.push('clicks');
    return list.length ? list : ['idle'];
  }
  function gradient(g, top, bot) {
    for (let y = 0; y < SCR.h; y++) R(g, 0, y, SCR.w, 1, mix(top, bot, y / (SCR.h - 1)));
  }
  function renderScreen(t) {
    const list = modes(), DUR = 7;
    const idx = Math.floor(t / DUR) % list.length, mode = list[idx], mt = t % DUR;
    const g = sg, W = SCR.w, H = SCR.h;
    if (mode === 'idle') {
      // SMPTE-style test card: honest "no signal yet"
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
      // calendar icon + big count
      R(g, 4, 3, 11, 9, '#f4f1fb'); R(g, 4, 3, 11, 3, '#ff4f6e'); D(g, 6, 2, '#c8c4dc'); D(g, 12, 2, '#c8c4dc');
      for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) D(g, 5 + i * 3, 7 + j * 3, (i + j * 4) < 7 ? '#5a4a9a' : '#c8c4dc');
      drawNum(g, F.posts, 4, 14, 2, '#ffffff', '#3a2a8a');
      R(g, 22, 3, 1, 21, '#4a3aa0');
      // one tile per queued post, coloured by client, popping in
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
      // share of the week per client
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
      drawNum(g, F.planned, 4, 14, 2, '#ffffff', '#6a1a5a');
      R(g, 22, 3, 1, 21, '#8a2a7a');
      // film strip: one frame per planned video, posted ones lit
      R(g, 25, 3, 60, 19, '#120e18');
      const off = rm ? 0 : Math.floor(t * 6) % 4;
      for (let x = 25 - off; x < 85; x += 4) { if (x >= 25) { R(g, x + 1, 4, 2, 2, '#4a4458'); R(g, x + 1, 19, 2, 2, '#4a4458'); } }
      const n = Math.min(6, F.planned);
      for (let k = 0; k < n; k++) {
        const x = 27 + k * 10, done = k < F.posted;
        R(g, x, 7, 8, 11, done ? '#3a2a8a' : '#1e1830');
        if (done) { R(g, x, 7, 8, 4, '#5a6ae8'); R(g, x, 13, 8, 5, '#2a1a5a'); D(g, x + 6, 8, '#ffe45c'); }
        R(g, x + 3, 10, 1, 4, done ? '#ffffff' : '#6a5a8a'); R(g, x + 4, 11, 1, 2, done ? '#ffffff' : '#6a5a8a');
        if (!done) { for (let i = 0; i < 8; i += 2) { D(g, x + i, 7, '#6a5a8a'); D(g, x + i + 1, 17, '#6a5a8a'); } }
        else { R(g, x + 5, 15, 3, 3, '#ff4fa3'); D(g, x + 6, 16, '#ffffff'); }
      }
      // posted / planned progress
      R(g, 25, 23, 60, 2, '#2a1030');
      if (F.planned) R(g, 25, 23, Math.round(60 * Math.min(1, F.posted / F.planned)), 2, '#ff4fa3');
    } else {
      gradient(g, '#0f4a4a', '#071a20');
      // pointer + ripples, then the click count
      const ph = rm ? 0.5 : (mt * 0.9) % 1;
      g.globalAlpha = 1 - ph;
      const rr = Math.round(2 + ph * 7);
      R(g, 9 - rr, 9, 1, 1, '#9ff6ff'); R(g, 9 + rr, 9, 1, 1, '#9ff6ff'); R(g, 9, 9 - rr, 1, 1, '#9ff6ff'); R(g, 9, 9 + rr, 1, 1, '#9ff6ff');
      g.globalAlpha = 1;
      const cur = ['1.....', '11....', '1#1...', '1##1..', '1###1.', '1####1', '1##111', '11.1..', '...1..'];
      cur.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') D(g, 8 + i, 7 + j, row[i] === '1' ? '#0a1a20' : '#ffffff'); });
      const w = drawNum(g, F.clicks, 24, 8, 3, '#ffffff', '#0a3a3a');
      R(g, 24, 8 + 16, w, 1, '#3ef0ff');
    }
    // transition static between modes, then scanlines + critical warning
    if (!rm && list.length > 1 && mt < 0.25) for (let k = 0; k < 140; k++) D(g, (S.hash(k, Math.floor(t * 30), 732) * W) | 0, (S.hash(k, Math.floor(t * 30), 733) * H) | 0, k & 1 ? '#ffffff' : '#5a5a7a');
    g.globalAlpha = 0.16; for (let y = 1; y < H; y += 2) R(g, 0, y, W, 1, '#000000'); g.globalAlpha = 1;
    if ((S.status.market || {}).level === 'critical' && (rm || Math.floor(t * 2) % 2 === 0)) {
      R(g, W - 10, 2, 8, 7, '#1a0a0a'); L(g, W - 6, 2, W - 9, 8, '#ff4a3a'); L(g, W - 6, 2, W - 3, 8, '#ff4a3a'); R(g, W - 9, 8, 7, 1, '#ff4a3a'); D(g, W - 6, 5, '#ffe45c'); D(g, W - 6, 7, '#ffe45c');
    }
  }

  /* ============================================================ FIREWORKS */
  const fw = { rockets: [], sparks: [], next: 4, burst: 0, burstNext: 0, burstDone: false, lastT: -1 };
  const arcs = [];
  const FW_COLS = [[P.neonPink, '#ffd0e8'], [P.neonCyan, '#d8fcff'], ['#ffe45c', '#fff6c0'], ['#a6ff5c', '#e8ffd0'], [P.neonViolet, '#e0d0ff'], ['#ff7a3a', '#ffe0b8']];
  function launch(big) {
    const [ox, oy] = MORTARS[(Math.random() * MORTARS.length) | 0];
    const tx = clamp(ox + (Math.random() - 0.5) * 120, 700, 1000);
    const ty = clamp(oy - 70 - Math.random() * 90, 34, 140);
    fw.rockets.push({ x: ox, y: oy - 8, sx: ox, sy: oy - 8, tx, ty, t: 0, dur: 0.9 + Math.random() * 0.5, big: !!big, kind: (Math.random() * 4) | 0, col: FW_COLS[(Math.random() * FW_COLS.length) | 0] });
    arcs.push({ born: S.t || 0 });
  }
  function explode(r) {
    const n = rm ? 14 : r.big ? 44 : 32, sp = (r.big ? 62 : 48) * (rm ? 0.7 : 1);
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2 + Math.random() * 0.2, v = sp * (r.kind === 1 ? 1 : 0.6 + Math.random() * 0.5);
      fw.sparks.push({ x: r.tx, y: r.ty, px: r.tx, py: r.ty, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.85, age: 0, life: (r.kind === 2 ? 2.0 : 1.2) + Math.random() * 0.5, col: r.kind === 2 ? ['#ffd27a', '#fff2c0'] : (k % 5 === 0 ? r.col : r.col), willow: r.kind === 2, crackle: r.kind === 3 });
    }
    fw.flash = { x: r.tx, y: r.ty, age: 0 };
    try { S.audio.sfx('firework'); } catch (e) { /* audio is optional */ }
  }
  function stepFireworks(t, dt) {
    const f = F;
    // steady launches: one per ~30 s / posts, never when nothing is queued
    if (f.posts > 0) {
      const iv = Math.max(2.6, 30 / f.posts) * (rm ? 2.5 : 1);
      if (t >= fw.next) { launch(false); fw.next = t + iv * (0.7 + Math.random() * 0.6); }
    } else fw.next = t + 3;
    // ceremony burst during the council beat (reports handed over: posts go out)
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
      const drag = Math.pow(p.willow ? 0.25 : 0.12, dt);
      p.px = p.x; p.py = p.y;
      p.vx *= drag; p.vy = p.vy * drag + (p.willow ? 26 : 16) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    if (fw.flash) { fw.flash.age += dt; if (fw.flash.age > 0.15) fw.flash = null; }
    for (let i = arcs.length - 1; i >= 0; i--) if (t - arcs[i].born > 1.8 || t < arcs[i].born) arcs.splice(i, 1);
  }
  function drawFireworks(ctx, night) {
    if (night) ctx.globalCompositeOperation = 'lighter';
    for (const r of fw.rockets) {
      const n = 6;
      for (let k = 0; k < n; k++) {
        const u = k / n, x = r.x + (r.sx - r.x) * u * 0.25, y = r.y + (r.sy - r.y) * u * 0.25;
        ctx.globalAlpha = 1 - u; D(ctx, Math.round(x), Math.round(y), k === 0 ? '#ffffff' : '#ffc070');
      }
    }
    ctx.globalAlpha = 1;
    if (fw.flash && !rm) { const { x, y } = fw.flash; ctx.globalAlpha = 0.6 * (1 - fw.flash.age / 0.15); R(ctx, Math.round(x) - 2, Math.round(y) - 2, 5, 5, '#ffffff'); R(ctx, Math.round(x) - 4, Math.round(y), 9, 1, '#fff6d8'); R(ctx, Math.round(x), Math.round(y) - 4, 1, 9, '#fff6d8'); ctx.globalAlpha = 1; }
    for (const p of fw.sparks) {
      const k = p.age / p.life, big = k < 0.35 && !rm;
      if (p.crackle && k > 0.7 && !rm && S.hash(Math.round(p.x), Math.round(p.y), Math.floor(p.age * 20)) < 0.3) { D(ctx, Math.round(p.x), Math.round(p.y), '#ffffff'); continue; }
      const c = k < 0.3 ? p.col[1] : p.col[0];
      ctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      if (big) R(ctx, Math.round(p.x), Math.round(p.y), 2, 2, c); else D(ctx, Math.round(p.x), Math.round(p.y), c);
      ctx.globalAlpha *= 0.45;
      D(ctx, Math.round(p.px), Math.round(p.py), p.col[0]);
      if (night && k < 0.5) { ctx.globalAlpha = 0.18; R(ctx, Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3, p.col[0]); }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ============================================================ STRING LIGHTS */
  const BULBS = [];
  const BULB_COLS = [P.neonPink, '#ffd27a', P.neonCyan, '#a6ff5c', P.neonViolet];
  const [wires, wg] = mk(384, 256);   // wire layer for the region, drawn at 400
  (function buildStrings() {
    let bi = 0;
    for (const [a, b, sag] of STRINGS) {
      const [ax, ay] = ANCHOR[a], [bx, by] = ANCHOR[b];
      const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1));
      let prev = null;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps, x = Math.round(ax + (bx - ax) * u), y = Math.round(ay + (by - ay) * u + sag * 4 * u * (1 - u));
        wg.fillStyle = '#1b1426';
        if (prev !== null && Math.abs(prev - y) > 1) wg.fillRect(x - 640, Math.min(prev, y), 1, Math.abs(prev - y));
        wg.fillRect(x - 640, y, 1, 1);
        prev = y;
        if (i % 5 === 2 && i > 1 && i < steps - 1) { BULBS.push({ x, y: y + 1, c: BULB_COLS[bi % BULB_COLS.length], k: bi }); bi++; }
      }
    }
    for (const b of BULBS) { wg.fillStyle = mix(b.c, '#2a2238', 0.55); wg.fillRect(b.x - 640, b.y, 1, 2); }
  })();
  // a few string-light glows for the dark
  for (const [a, b, sag] of STRINGS) {
    const [ax, ay] = ANCHOR[a], [bx, by] = ANCHOR[b];
    S.addLight({ x: (ax + bx) / 2, y: (ay + by) / 2 + sag, r: 26, color: '#ffc8f0', intensity: 0.45 });
  }

  /* ============================================================ DYNAMIC */
  // 200: the big display spinner on the fidget counter, and the ferris wheel.
  const SPIN = { x: FID.x + 1 + 40, y: FID.y + 1 + 24 + 14 - 9 };
  S.registerDynamic(200, (ctx, t) => {
    const a = rm ? t * 1.2 : t * 9;
    const lobes = ['#ff4f6e', '#3ec8f0', '#ffd84a'];
    for (let k = 0; k < 3; k++) {
      const aa = a + k * Math.PI * 2 / 3, x = Math.round(SPIN.x + Math.cos(aa) * 3), y = Math.round(SPIN.y + Math.sin(aa) * 3);
      R(ctx, x - 1, y - 1, 3, 3, OUT); R(ctx, x - 1, y - 1, 2, 2, lobes[k]); D(ctx, x - 1, y - 1, sh(lobes[k], 0.5));
    }
    R(ctx, SPIN.x - 1, SPIN.y - 1, 3, 3, OUT); D(ctx, SPIN.x, SPIN.y, '#e8e4f0');
    if (GROWTH >= 3) drawWheel(ctx, t);
  });

  // 400: steam from the espresso machine, the cafe table and the noodle pot; string-light wires.
  const STEAM = [[ANG.x + 1 + 14, ANG.y + 1 + 37 - 12], [TABLE.x + 8, TABLE.y + 4]];
  if (GROWTH >= 1) STEAM.push([NOOD.x + 1 + 15, NOOD.y + 1 + 32 - 10]);
  S.registerDynamic(400, (ctx, t) => {
    const n = rm ? 3 : 7;
    for (let s = 0; s < STEAM.length; s++) {
      const [sx, sy] = STEAM[s];
      const big = s === 2;
      for (let k = 0; k < n; k++) {
        const ph = (t * (rm ? 0.12 : 0.45) + k / n + s * 0.37) % 1;
        const y = sy - ph * (big ? 20 : 12), x = sx + Math.sin(ph * 6 + t * 1.3 + s) * ph * 2.5;
        ctx.globalAlpha = 0.7 * (1 - ph) * Math.min(1, ph * 6);
        ctx.fillStyle = ph < 0.4 ? '#f6f2fa' : '#d8d2e4';
        const sz = big && ph > 0.4 ? 2 : 1;
        ctx.fillRect(Math.round(x), Math.round(y), sz, sz);
      }
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(wires, 640, 0);
  });

  // 700: lit neon, the billboard screen, TV wall, bulbs, lanterns, beacon + rings, fireworks.
  const EDISON = []; for (let k = 0; k < 8; k++) EDISON.push([ANG.x + 6 + k * 10, ANG.y + 1 + 13 + 14 + 10 + 1]);
  const LANTERNS = GROWTH >= 1 ? [[NOOD.x + 10, NOOD.y + 23], [NOOD.x + 30, NOOD.y + 24], [NOOD.x + 50, NOOD.y + 23]] : [];
  const TV_SCREENS = GROWTH >= 2 ? TV_SLOTS.map(([x, y, w, h]) => [TVW.x + 1 + x + 2, TVW.y + 1 + y + 2, w - 6, h - 4]) : [];
  let flick = { idx: -1, until: 0, next: 6 };
  S.registerDynamic(700, (ctx, t, dt) => {
    const f = feed(t);
    const light = S.time && S.time.light != null ? S.time.light : 1;
    const dark = 1 - light, night = dark > 0.45;
    if (t !== fw.lastT) { stepFireworks(t, fw.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - fw.lastT))); fw.lastT = t; }

    // neon flicker: now and then one tube stutters (never with reduced motion)
    if (!rm && t > flick.next) { flick = { idx: (Math.random() * SIGNS.length) | 0, until: t + 0.45, next: t + 7 + Math.random() * 9 }; }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < SIGNS.length; i++) {
      const s = SIGNS[i], sp = neonSprites(s.icon, s.col);
      let on = 1;
      if (i === flick.idx && t < flick.until) on = S.hash(i, Math.floor(t * 24), 740) < 0.5 ? 0.15 : 1;
      ctx.globalAlpha = (0.28 + 0.62 * dark) * on;
      ctx.drawImage(sp.halo, s.x - sp.pad, s.y - sp.pad);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < SIGNS.length; i++) {
      const s = SIGNS[i], sp = neonSprites(s.icon, s.col);
      const off = i === flick.idx && t < flick.until && S.hash(i, Math.floor(t * 24), 740) < 0.5;
      ctx.globalAlpha = off ? 0.2 : 1;
      ctx.drawImage(sp.lit, s.x - sp.pad, s.y - sp.pad);
    }
    ctx.globalAlpha = 1;

    // billboard neon trim (red when the biome is critical)
    const crit = (S.status.market || {}).level === 'critical';
    const trim = crit ? '#ff4a3a' : P.neonPink;
    ctx.globalAlpha = 0.9;
    R(ctx, BB.x + 1, BB.y + 1, BB.w - 2, 1, trim); R(ctx, BB.x + 1, BB.y + 31, BB.w - 2, 1, trim);
    R(ctx, BB.x + 1, BB.y + 1, 1, 31, trim); R(ctx, BB.x + BB.w - 2, BB.y + 1, 1, 31, trim);
    // chasing bright dots along the trim
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
      ctx.globalAlpha = 0.18 * dark;
      ctx.drawImage(scr, SCR.x, SCR.y);
      ctx.globalAlpha = 0.12 * dark; R(ctx, SCR.x - 2, SCR.y - 2, SCR.w + 4, SCR.h + 4, '#7fb8ff');
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }

    // TV wall loops
    for (let i = 0; i < TV_SCREENS.length; i++) drawTV(ctx, i, TV_SCREENS[i], t);

    // string bulbs
    const tw = Math.floor(t * 3);
    for (const b of BULBS) {
      const dim = !rm && S.hash(b.k, tw, 741) < 0.07;
      ctx.globalAlpha = dim ? 0.35 : 1;
      R(ctx, b.x, b.y, 1, 2, b.c); D(ctx, b.x, b.y, mix(b.c, '#ffffff', 0.6));
      if (dark > 0.2 && !dim) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.28 * dark; R(ctx, b.x - 1, b.y - 1, 3, 4, b.c); ctx.globalCompositeOperation = 'source-over'; }
    }
    ctx.globalAlpha = 1;
    // Edison bulbs under Angie's awning and the noodle cart's paper lanterns
    for (const [x, y] of EDISON) {
      D(ctx, x, y, '#5a3a20'); R(ctx, x, y + 1, 1, 2, '#ffd27a'); D(ctx, x, y + 2, '#fff2c0');
      if (dark > 0.2) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 * dark; R(ctx, x - 1, y, 3, 4, '#ffb84d'); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
    }
    for (let i = 0; i < LANTERNS.length; i++) {
      const [x, y] = LANTERNS[i], sw = rm ? 0 : Math.round(Math.sin(t * 1.6 + i) * 0.6);
      R(ctx, x + sw, y - 2, 1, 2, '#2a1a14');
      R(ctx, x - 2 + sw, y, 5, 6, OUT); R(ctx, x - 1 + sw, y, 3, 6, '#e8402a'); R(ctx, x - 2 + sw, y + 1, 5, 4, '#e8402a');
      R(ctx, x - 1 + sw, y + 1, 1, 4, dark > 0.3 ? '#ffd27a' : '#ff7a5a'); R(ctx, x - 1 + sw, y, 3, 1, P.gold); R(ctx, x - 1 + sw, y + 5, 3, 1, P.gold);
      if (dark > 0.2) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.3 * dark; R(ctx, x - 3 + sw, y - 1, 7, 8, '#ff7a3a'); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
    }
    // vending machine + hut window + ring light glow at night
    if (dark > 0.2) {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.45 * dark;
      R(ctx, VEND.x + 1, VEND.y + 4, 11, 12, '#7fdfff');
      R(ctx, HUT.x + 3, HUT.y + 13, 10, 7, '#3ef0ff');
      ctx.globalAlpha = 0.5 * dark; S.px.circle(ctx, RING.x + 6, RING.y - 8, 4, '#ffffff');
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    // Lumi's camera: red REC dot while videos are planned
    if (f.planned > 0) {
      const on = rm ? true : Math.floor(t * 1.5) % 2 === 0;
      if (on) { D(ctx, TRIPOD.x + 10, TRIPOD.y - 10, '#ff3a3a'); if (dark > 0.2) { ctx.globalAlpha = 0.35; R(ctx, TRIPOD.x + 9, TRIPOD.y - 11, 3, 3, '#ff3a3a'); ctx.globalAlpha = 1; } }
    }
    // ferris wheel bulbs
    if (GROWTH >= 3) {
      const a0 = rm ? 0 : t * 0.18;
      for (let k = 0; k < 16; k++) {
        const a = a0 + (k + 0.5) / 16 * Math.PI * 2;
        const on = rm || ((k + Math.floor(t * 4)) % 3 !== 0);
        D(ctx, Math.round(WHEEL.cx + Math.cos(a) * WHEEL.r), Math.round(WHEEL.cy + Math.sin(a) * WHEEL.r), on ? BULB_COLS[k % 5] : '#3a3050');
      }
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
      ctx.globalAlpha = b * (0.25 + 0.45 * dark);
      R(ctx, BEACON.x - 2, BEACON.y - 1, 5, 4, '#ff4a3a');
      ctx.globalAlpha = b * (0.1 + 0.25 * dark);
      R(ctx, BEACON.x - 4, BEACON.y, 9, 2, '#ff4a3a'); R(ctx, BEACON.x - 1, BEACON.y - 3, 3, 8, '#ff4a3a');
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
      for (let k = 0; k <= nn; k++) {
        const ang = Math.PI * (1.12 + 0.76 * k / nn);
        if (k % 2) continue;
        D(ctx, Math.round(BEACON.x + Math.cos(ang) * rr), Math.round(BEACON.y + 6 + Math.sin(ang) * rr * 0.7), P.neonCyan);
      }
    }
    ctx.globalAlpha = 1;

    drawFireworks(ctx, night);
  });

  function drawTV(ctx, i, [x, y, w, h], t) {
    const k = i % 6;
    if (k === 0) { // heart pulse
      R(ctx, x, y, w, h, '#2a0a24');
      const s = rm ? 0 : (Math.floor(t * 2) % 2);
      const hx = x + (w >> 1) - 2, hy = y + 1;
      R(ctx, hx, hy + 1, 5, 2, '#ff4fa3'); D(ctx, hx + 1, hy, '#ff4fa3'); D(ctx, hx + 3, hy, '#ff4fa3'); R(ctx, hx + 1, hy + 3, 3, 1, '#ff4fa3'); D(ctx, hx + 2, hy + 4, '#ff4fa3');
      if (s) D(ctx, hx + 1, hy + 1, '#ffffff');
    } else if (k === 1) { // waveform
      R(ctx, x, y, w, h, '#06222a');
      for (let i2 = 0; i2 < w; i2++) D(ctx, x + i2, y + Math.round(h / 2 - 0.5 + Math.sin(i2 * 1.1 + (rm ? 0 : t * 6)) * (h / 2 - 1)), P.neonCyan);
    } else if (k === 2) { // play
      R(ctx, x, y, w, h, '#1a1440');
      R(ctx, x + 2, y + 1, 1, 5, '#ffffff'); R(ctx, x + 3, y + 2, 1, 3, '#ffffff'); D(ctx, x + 4, y + 3, '#ffffff');
    } else if (k === 3) { // colour cycle
      R(ctx, x, y, w, h, RAINBOW[Math.floor((rm ? 0 : t * 1.5)) % 6]); R(ctx, x, y, w, 1, '#ffffff');
    } else if (k === 4) { // static
      R(ctx, x, y, w, h, '#3a3a4a');
      for (let q = 0; q < 10; q++) D(ctx, x + ((S.hash(q, Math.floor(t * 10), 742) * w) | 0), y + ((S.hash(q, Math.floor(t * 10), 743) * h) | 0), '#e8e8f0');
    } else { // star twinkle
      R(ctx, x, y, w, h, '#120a2a');
      const s = rm ? 1 : 1 + (Math.floor(t * 3) % 2);
      R(ctx, x + (w >> 1) - s + 1, y + (h >> 1), s * 2 - 1, 1, '#ffe45c'); R(ctx, x + (w >> 1), y + (h >> 1) - s + 1, 1, s * 2 - 1, '#ffe45c');
    }
  }

  /* ============================================================ REGISTER */
  S.registerStatic(7, (ctx) => {
    const key = season();
    if (!groundCache[key]) groundCache[key] = buildGround(key);
    ctx.drawImage(groundCache[key], 640, 0);
  });
  S.registerStatic(22, (ctx) => { F = readFeed(); drawBuildings(ctx); });
})();
