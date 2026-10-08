/* The Shack — Copperpot Mine (Grit Copperpot, ledger-fi) and Savings Row.
 *
 * Owns region "mine" (tiles x 40..63, y 25..39) and region "savings"
 * (tiles x 25..39, y 27..39).
 *
 * Static: canyon floor and layered ochre/rust cliffs (order 6), minecart rails
 * along S.nav.rails with a turntable in the mine yard, a spur into the mine
 * mouth and a buffer stop by the square (order 12), mine entrance, Grit's
 * cliff cottage, the vault, props and growth structures (order 21), Savings
 * Row: apartment under construction, garage with the shield, investment tree
 * (order 30). Dynamic: ore sparkles, lantern flames, coin and fruit glints,
 * crane hook (200), chimney smoke (400).
 *
 * Data (never invented):
 *   vault coins  = metrics('ledger-fi').month_income (empty vault at 0)
 *   apartment    = floors built ∝ Apartment fund current/target (foundation only without a target)
 *   garage       = shield fill ∝ Car insurance current/target (empty shield without a target)
 *   invest tree  = size, leaves and gold fruit ∝ Invest current/target (a sapling without a target)
 *   growth 0..3  = S.status.mine.growth (more shafts, headframe, smelter, parked carts)
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S) return;

  const T = S.TILE, P = S.PAL, C = S.color;
  const AGENT = 'ledger-fi';
  const ST = (S.status && S.status.mine) || {};
  const GROWTH = Math.max(0, Math.min(3, ST.growth | 0));
  const LEVEL = ST.level || 'idle';
  const RM = !!S.reducedMotion;

  /* ------------------------------------------------------------- palette */
  const OUT = P.outline;
  const STRATA = {
    cream: ['#b48a58', '#d4ae78', '#ebcf9c'],
    ochre: ['#9c6029', '#c07d38', '#dc9e55'],
    sand:  ['#a87440', '#c99556', '#e2b574'],
    rust:  ['#76361d', '#a04e28', '#c06a3c'],
    deep:  ['#55241a', '#743220', '#924a2c'],
  };
  const FLOOR = ['#7e4e2c', '#9c6a3c', '#b6824b', '#c9975c', '#dcb276'];
  const TIMBER = { deep: '#3a2110', dark: '#5a3618', base: '#7d4f26', light: '#a06a36', hi: '#c48d50' };
  const IRON = { deep: '#24222a', dark: '#3c3a44', base: '#5d5b66', light: '#8c8a96', hi: '#c4c4cc' };
  const GRANITE = { deep: '#3a3640', dark: '#58535e', base: '#7a7480', light: '#9d97a0', hi: '#c2bcc0' };
  const COPPER = { deep: '#5a2a14', dark: '#8a4320', base: '#b8642e', light: '#de8a4a', hi: '#f6b77a' };
  const GOLD = { deep: '#7a5414', dark: P.goldDark, base: P.gold, light: '#f8e08a', hi: '#fff6cf' };
  const BRICK = { deep: '#5a2a20', dark: '#82402e', base: '#a9573c', light: '#c87452', hi: '#e09a74' };
  const CONC = { deep: '#5e5b58', dark: '#7d7a76', base: '#a3a09a', light: '#c4c1ba', hi: '#dedad2' };
  const STEEL = { dark: '#4c535c', base: '#7d868f', light: '#b4bcc3' };
  const CRANE = { deep: '#6a4508', dark: '#b07d0f', base: '#e2a820', light: '#f6d050' };
  const SHIELD = { deep: '#163a6a', dark: '#1f4f8f', base: '#3a78c8', light: '#6aa6e6', hi: '#b8dcff' };
  const SIDING = { dark: '#b9ab90', base: '#e2d6bd', light: '#f4ecda' };
  const SLATE = { deep: '#262a3c', dark: '#353c56', base: '#4a5474', light: '#66729a', hi: '#8c98bc' };
  const BURLAP = { dark: '#7d6040', base: '#a8865a', light: '#c9a878' };
  const DOOR_GREEN = { dark: '#244a2c', base: '#356b3e', light: '#4f9156' };
  const SHADOW_INK = '#140f1e';

  /* ------------------------------------------------------- tiny helpers */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (t) => t * t * (3 - 2 * t);
  const rgb = (h) => C.hexToRgb(h);
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bayer = (x, y) => (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
  function vnoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = S.hash(xi, yi, seed), b = S.hash(xi + 1, yi, seed), c = S.hash(xi, yi + 1, seed), d = S.hash(xi + 1, yi + 1, seed);
    const u = smooth(xf), v = smooth(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w); c.height = Math.max(1, h);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    return [c, g];
  }
  const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const D = (g, x, y, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), 1, 1); };
  function disc(g, cx, cy, r, c) {
    g.fillStyle = c;
    for (let y = -r; y <= r; y++) {
      const w = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)) + 0.35);
      g.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
    }
  }
  function ellipse(g, cx, cy, rx, ry, c) {
    g.fillStyle = c;
    for (let y = -ry; y <= ry; y++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.25))));
      g.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
    }
  }
  /** Keep only the pixels inside per-row spans [x, w] (rowFn(y) -> [x, w] | null). */
  function clipRows(g, rowFn, h) {
    g.save();
    g.globalCompositeOperation = 'destination-in';
    g.beginPath();
    for (let y = -1; y < h; y++) { const r = rowFn(y); if (r && r[1] > 0) g.rect(r[0], y, r[1], 1); }
    g.fillStyle = '#000'; g.fill();
    g.restore();
  }
  function dith(g, x, y, w, h, c, ph) { g.fillStyle = c; for (let j = 0; j < h; j++) for (let i = (j + (ph || 0)) & 1; i < w; i += 2) g.fillRect(x + i, y + j, 1, 1); }

  /** Build a sprite with a 1 px margin and an automatic outer outline. Local (0,0) = content origin. */
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
    const [r, gg, b] = rgb(col);
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
  /** Draw a built sprite with local (0,0) at world (x,y); sh = [dx, dy, alpha] drop shadow to the bottom-right. */
  function place(ctx, spr, x, y, sh) {
    if (sh) {
      ctx.globalAlpha = sh[2] || 0.26;
      ctx.drawImage(spr.sil || (spr.sil = silhouette(spr)), Math.round(x - 1 + sh[0]), Math.round(y - 1 + sh[1]));
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(spr, Math.round(x - 1), Math.round(y - 1));
  }
  function groundShadow(ctx, cx, cy, rx, ry, a) {
    ctx.fillStyle = C.rgba(SHADOW_INK, a == null ? 0.22 : a);
    for (let y = -ry; y <= ry; y++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.5))));
      ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
    }
  }

  const season = () => (S.time && S.time.season) || 'autumn';
  function foliage(s) {
    if (s === 'autumn') return { dark: '#8e3d1c', base: P.leaf.autumn, light: '#ec9a42', hi: '#f7c766', alt: P.leafAlt.autumn };
    if (s === 'spring') return { dark: '#4e8a34', base: P.leaf.spring, light: '#9ad672', hi: '#c6ec9c', alt: P.leafAlt.spring };
    if (s === 'summer') return { dark: '#2b5520', base: P.leaf.summer, light: '#69a845', hi: '#98cf68', alt: P.leafAlt.summer };
    return { dark: '#3e4f47', base: P.leaf.winter, light: '#9aaba2', hi: '#c9d6cf', alt: P.leafAlt.winter };
  }

  /* ---------------------------------------------------------- data feeds */
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : 0);
  const MET = S.metrics(AGENT) || {};
  const INCOME = Math.max(0, num(MET.month_income));
  function goal(key) {
    const list = Array.isArray(MET.savings) ? MET.savings : [];
    const g = list.find((s) => s && typeof s.name === 'string' && s.name.toLowerCase().indexOf(key) >= 0);
    if (!g) return { pct: null, current: 0, target: null };
    const target = num(g.target), cur = Math.max(0, num(g.current));
    return { pct: target > 0 ? clamp(cur / target, 0, 1) : null, current: cur, target: target > 0 ? target : null, name: g.name };
  }
  const APT = goal('apartment'), CAR = goal('car'), INV = goal('invest');
  const fmtPct = (g) => (g.pct == null ? 'no target yet' : Math.round(g.pct * 100) + '% saved');

  /* ============================================================ GEOMETRY (native px) */
  const MX0 = 640, MY0 = 400, MX1 = 1024, MY1 = 640;
  const CUT0 = 708, CUT1 = 770;                 // the cutting where the road and rails come down
  const EX = 912;                               // mine mouth centre (road MINEDOOR is tiles 56-57)
  const ADIT = { x: 792, base: 462 };           // second shaft (growth >= 1)
  const COT = { x: 960, y: 410 };               // Grit's cottage sprite origin
  const VAULT = { x: 728, y: 530, w: 92, h: 50 };
  const VDOOR = { cx: 764, cy: 556, r: 14 };    // world coords of the doorway centre
  const TURN = { x: 840, y: 520 };
  const HEAD = { x: 864, base: 604 };           // headframe (growth >= 2)
  const SMELT = { x: 934, base: 606 };          // smelter (growth >= 3)
  // Savings Row
  const APTB = { x: 410, w: 64, slab: 600, fl: 13, floors: 4 };   // building x, slab top y, floor height
  const MAST = { x: 462, top: 520 };
  const GAR = { x: 494, y: 578, w: 72, h: 54 };
  const TREE = { x: 606, base: 600 };

  const RAILS = (S.nav && Array.isArray(S.nav.rails) ? S.nav.rails : []).filter((p) => Array.isArray(p) && p.length === 2);

  /* --------------------------------------------------- cliff profile */
  const NCOL = MX1 - MX0;
  const CTOP = new Int16Array(NCOL), CBOT = new Int16Array(NCOL);
  for (let i = 0; i < NCOL; i++) {
    const x = MX0 + i;
    let k, base;
    if (x < CUT0) { k = smooth(clamp((x - MX0 - 2) / 9, 0, 1)) * smooth(clamp((CUT0 - x) / 13, 0, 1)); base = 450; }
    else if (x < CUT1) { k = 0; base = 448; }
    else { k = smooth(clamp((x - CUT1) / 13, 0, 1)); base = 461; }
    const top = 400 + Math.round(vnoise(x * 0.07, 0.5, 21) * 3);
    const bot = base + Math.round((vnoise(x * 0.06, 1.5, 22) - 0.5) * 6);
    CTOP[i] = top; CBOT[i] = top + Math.round(k * (bot - top));
  }
  // Around the mouth and the cottage the cliff foot is level.
  for (let i = 0; i < NCOL; i++) { const x = MX0 + i; if ((x >= 884 && x <= 942) || (x >= 958 && x <= 1016)) CBOT[i] = 463; }
  const cliffH = (x) => { const i = x - MX0; return i >= 0 && i < NCOL ? CBOT[i] - CTOP[i] : 0; };

  // Strata bands (relative px from y=400), thickness varies.
  const BANDS = [];
  (function () {
    const seq = ['cream', 'ochre', 'rust', 'sand', 'ochre', 'deep', 'rust', 'ochre', 'cream', 'rust', 'deep', 'ochre', 'rust', 'deep'];
    const rnd = S.rng(4411);
    let y = -6;
    for (const n of seq) { const th = 4 + Math.floor(rnd() * 5); BANDS.push({ y0: y, y1: y + th, ramp: STRATA[n] }); y += th; }
  })();
  function bandAt(yr) { for (let i = 0; i < BANDS.length; i++) if (yr < BANDS[i].y1) return i; return BANDS.length - 1; }

  /* --------------------------------------------------- ore veins (fixed at load, used by static + sparkle) */
  const VEINS = [], SPARKS = [];
  (function () {
    const rnd = S.rng(7781 + GROWTH);
    const count = 6 + GROWTH * 3;
    const blocked = (x) => (x >= 880 && x <= 946) || (x >= 954 && x <= 1020) || (x >= ADIT.x - 14 && x <= ADIT.x + 14) || (x >= CUT0 - 16 && x <= CUT1 + 18);
    let tries = 0;
    while (VEINS.length < count && tries++ < 400) {
      const x = MX0 + 8 + Math.floor(rnd() * (NCOL - 16));
      if (blocked(x) || blocked(x + 10) || cliffH(x) < 30) continue;
      const i = x - MX0;
      const y = CTOP[i] + 9 + Math.floor(rnd() * (CBOT[i] - CTOP[i] - 20));
      if (VEINS.some((v) => Math.abs(v.x - x) < 16 && Math.abs(v.y - y) < 12)) continue;
      const gold = rnd() < 0.55;
      const len = 6 + Math.floor(rnd() * 7), dir = rnd() < 0.5 ? 1 : -1, slope = 0.3 + rnd() * 0.5;
      const pts = [];
      for (let k = 0; k < len; k++) pts.push([x + k, Math.round(y + dir * k * slope + Math.sin(k * 0.9) * 0.8)]);
      VEINS.push({ pts, gold });
      for (let k = 1; k < len; k += 3 + Math.floor(rnd() * 2)) SPARKS.push({ x: pts[k][0], y: pts[k][1] - 1, ph: rnd() * 6.28, sp: 0.6 + rnd() * 1.2, gold });
    }
  })();

  /* ----------------------------------------------------- reserve tiles */
  (function reserveAll() {
    const rpx = (x, y, w, h) => {
      const tx0 = Math.floor(x / T), ty0 = Math.floor(y / T), tx1 = Math.floor((x + w - 1) / T), ty1 = Math.floor((y + h - 1) / T);
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (!S.onRoad(tx, ty)) S.reserve(tx, ty);
    };
    S.reserve(40, 25, 24, 4);                      // cliff band (roads stay roads)
    S.reserve(54, 23, 6, 2);                       // rocky crest above the mine mouth
    rpx(MX0, 464, 70, 176);                        // west canyon floor
    rpx(VAULT.x - 8, VAULT.y, VAULT.w + 24, 70);   // vault, lectern and coins
    rpx(EX - 40, 464, 88, 32);                     // yard by the mouth
    rpx(840, 530, 184, 110);                       // east yard (growth sites)
    rpx(960, 464, 64, 66);                         // bench, timber stack by the cottage
    // rails off-road (by the square)
    const r = RAILS;
    for (let i = 0; i + 1 < r.length; i++) {
      const [x0, y0] = r[i], [x1, y1] = r[i + 1];
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) S.reserve(x, y);
    }
    // Savings Row
    rpx(400, 528, 96, 112);                        // apartment site and crane
    rpx(GAR.x - 4, GAR.y, GAR.w + 8, 62);          // garage
    rpx(TREE.x - 30, TREE.base - 66, 60, 76);      // investment tree
    rpx(498, 492, 12, 24); rpx(560, 492, 12, 24);  // lamp posts
    rpx(548, 436, 18, 26);                         // signpost
  })();

  /* ============================================================ GROUND + CLIFFS (6) */
  function drawGround(ctx) {
    const s = season(), winter = s === 'winter';
    const X0 = 626, Y0 = 396, w = MX1 - X0, h = MY1 - Y0;
    const [c, g] = mk(w, h);
    const im = g.createImageData(w, h), d = im.data;
    const fl = FLOOR.map(rgb);
    const snow = rgb(P.snow), snowS = rgb('#c9d6e2');
    const lipHi = rgb('#f2dcac'), fis = rgb('#3a1a12'), aoC = rgb('#4a2a1a');
    const fisCol = new Uint8Array(w);
    for (let x = 0; x < w; x++) fisCol[x] = S.hash(X0 + x, 0, 31) > 0.93 ? 1 : 0;
    const set = (i, col) => { d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; };
    const rampCache = BANDS.map((b) => b.ramp.map(rgb));
    for (let y = 0; y < h; y++) {
      const wy = Y0 + y;
      const bx = 640 + Math.round((vnoise(wy * 0.045, 3.3, 11) - 0.5) * 16 + (vnoise(wy * 0.2, 1.1, 13) - 0.5) * 6);
      for (let x = 0; x < w; x++) {
        const wx = X0 + x, i = (y * w + x) * 4;
        if (wx < bx - 1) continue;
        if (wx < bx + 1 && ((wx + wy) & 1)) continue;
        const ci = wx - MX0, hasCliff = ci >= 0 && ci < NCOL && CBOT[ci] - CTOP[ci] >= 3;
        if (hasCliff) { if (wy < CTOP[ci]) continue; }
        else {
          const by = 401 + Math.round((vnoise(wx * 0.11, 7.7, 12) - 0.5) * 8);
          if (wy < by - 1) continue;
          if (wy < by + 1 && ((wx + wy) & 1)) continue;
        }
        if (hasCliff && wy < CBOT[ci]) {
          // ---- cliff face: layered strata, lit from the top-left
          const top = CTOP[ci], bot = CBOT[ci], dd = wy - top, hh = bot - top;
          const wave = Math.round(2.5 * Math.sin(wx * 0.043) + 2 * vnoise(wx * 0.09, 0.3, 7));
          const yr = wy - 400 + wave;
          const b = bandAt(yr), ramp = rampCache[b];
          let tv = 1.3 - 1.05 * (dd / hh) + (vnoise(wx * 0.18, wy * 0.12, 8) - 0.5) * 0.9 + (bayer(wx, wy) - 0.5) * 0.75;
          let col = ramp[clamp(Math.round(tv), 0, 2)];
          if (bandAt(yr - 1) !== b) col = ramp[2];                 // lit ledge on top of each layer
          else if (bandAt(yr + 1) !== b) col = ramp[0];            // overhang shade under it
          const fOn = vnoise(wx * 0.5, wy * 0.16, 32) > 0.6;
          if (fisCol[x] && fOn && dd > 2) col = fis;
          else if (x > 0 && fisCol[x - 1] && fOn && dd > 2) col = ramp[2];
          if (dd === 0) col = lipHi; else if (dd === 1) col = ramp[2]; else if (dd === 2 && S.hash(wx, wy, 33) > 0.5) col = ramp[0];
          if (dd >= hh - 2) col = mixA(col, aoC, 0.5);
          if (winter && (dd <= 1 || (bandAt(yr - 1) !== b && S.hash(wx, wy, 34) > 0.35))) col = dd <= 0 ? snow : snowS;
          set(i, col);
          continue;
        }
        // ---- canyon floor
        let v = 0.55 * vnoise(wx * 0.045, wy * 0.045, 1) + 0.3 * vnoise(wx * 0.14, wy * 0.14, 2) + 0.15 * S.hash(wx, wy, 3);
        if (ci >= 0 && ci < NCOL && CBOT[ci] - CTOP[ci] > 4) { const dist = wy - CBOT[ci]; if (dist >= 0 && dist < 9) v -= ((9 - dist) / 9) * 0.3; }
        if (wx < 652) v -= (652 - wx) / 12 * 0.2;
        const q = v * 3.2 + (bayer(wx, wy) - 0.5) * 0.8 + 0.45;
        let col = fl[clamp(Math.floor(q), 0, 4)];
        if (winter) {
          let sn = vnoise(wx * 0.08, wy * 0.08, 91) * 0.75 + vnoise(wx * 0.3, wy * 0.3, 92) * 0.25 + (bayer(wx, wy) - 0.5) * 0.18;
          if (ci >= 0 && ci < NCOL && CBOT[ci] - CTOP[ci] > 4 && wy - CBOT[ci] < 6) sn -= 0.25;
          if (sn > 0.2) col = sn > 0.27 ? snow : snowS;
        }
        set(i, col);
      }
    }
    g.putImageData(im, 0, 0);
    ctx.drawImage(c, X0, Y0);
    drawCliffDetail(ctx, s);
    drawFloorDetail(ctx, s);
  }
  const mixA = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  function drawCliffDetail(ctx, s) {
    const winter = s === 'winter';
    const gA = winter ? P.snow : P.grass[s], gB = winter ? '#c9d6e2' : P.grassDark[s];
    const gD = winter ? '#9fb2c2' : C.shade(P.grassDark[s], -0.3);
    for (let x = MX0; x < MX1; x++) {
      const i = x - MX0, top = CTOP[i], hh = CBOT[i] - top;
      if (hh < 3) continue;
      // grass (or snow) lip hanging over the edge
      D(ctx, x, top - 1, gA);
      D(ctx, x, top, S.hash(x, 1, 60) > 0.5 ? gA : gB);
      const L = S.hash(x, 2, 60) > 0.55 ? 1 + Math.floor(S.hash(x, 3, 60) * 3) : 0;
      for (let k = 1; k <= L; k++) D(ctx, x, top + k, k === L ? gD : gB);
      // hanging roots
      if (!winter && hh > 24 && S.hash(x, 4, 60) > 0.985) {
        const len = 3 + Math.floor(S.hash(x, 5, 60) * 4);
        for (let k = 0; k < len; k++) D(ctx, x + (k > len / 2 && S.hash(x, 6, 60) > 0.5 ? 1 : 0), top + 2 + k, k < 2 ? gD : '#5a3a22');
      }
    }
    // small pockmark caves and ledge tufts
    const rnd = S.rng(5150);
    for (let k = 0; k < 26; k++) {
      const x = MX0 + 6 + Math.floor(rnd() * (NCOL - 12)), i = x - MX0, hh = CBOT[i] - CTOP[i];
      if (hh < 26 || (x >= 878 && x <= 1020) || Math.abs(x - ADIT.x) < 16) continue;
      const y = CTOP[i] + 8 + Math.floor(rnd() * (hh - 16));
      if (k % 3 === 0) {
        R(ctx, x, y, 3, 2, '#2a120c'); D(ctx, x, y - 1, STRATA.cream[2]); D(ctx, x + 1, y - 1, STRATA.cream[2]); D(ctx, x + 3, y + 1, STRATA.rust[0]);
      } else if (!winter) {
        D(ctx, x, y, gB); D(ctx, x + 1, y - 1, gA); D(ctx, x + 2, y, gB);
      } else { R(ctx, x, y, 3, 1, P.snow); }
    }
    // ore veins
    for (const v of VEINS) {
      const ramp = v.gold ? GOLD : COPPER;
      for (let k = 0; k < v.pts.length; k++) { const [x, y] = v.pts[k]; if (k % 3 !== 1) { D(ctx, x, y, '#efe0c2'); D(ctx, x, y + 1, 'rgba(60,24,14,0.45)'); } }
      for (let k = 1; k < v.pts.length; k += 3) {
        const [x, y] = v.pts[k];
        R(ctx, x - 1, y - 1, 4, 3, '#2a120c');
        R(ctx, x - 1, y - 1, 3, 2, ramp.base); D(ctx, x - 1, y - 1, ramp.hi); D(ctx, x, y - 1, ramp.light); D(ctx, x + 1, y, ramp.dark);
      }
    }
    // rubble at the cliff ends by the cutting and the west rim
    for (const [x, w] of [[646, 7], [CUT0 - 6, 8], [CUT1 + 6, 8]]) talusCone(ctx, x, CBOT[clamp(x - MX0, 0, NCOL - 1)] + 3, w, winter);
    // talus at the cliff foot
    for (let x = MX0 + 4; x < MX1 - 2; x += 3) {
      const i = x - MX0, hh = CBOT[i] - CTOP[i];
      if (hh < 8 || (x >= 884 && x <= 944) || (x >= 958 && x <= 1016) || S.hash(x, 7, 61) < 0.5) continue;
      const y = CBOT[i] + Math.floor(S.hash(x, 8, 61) * 3) - 1, r = 1 + Math.floor(S.hash(x, 9, 61) * 2.4);
      rock(ctx, x, y, r, S.hash(x, 10, 61) > 0.6 ? STRATA.rust : STRATA.sand, winter);
    }
  }
  function talusCone(ctx, x, y, w, winter) {
    // rubble spilling from a cliff end: a low mound of mixed stones
    for (let k = 0; k < w * 3; k++) {
      const dx = Math.round((S.hash(k, x, 62) - 0.5) * w), dy = Math.round(S.hash(k, y, 63) * 4 * (1 - Math.abs(dx) / w));
      rock(ctx, x + dx, y - dy, 1 + (S.hash(k, 3, 64) > 0.7 ? 1 : 0), S.hash(k, 4, 64) > 0.5 ? STRATA.sand : STRATA.rust, winter);
    }
  }
  function rock(ctx, x, y, r, ramp, winter) {
    D(ctx, x + r, y + 1, C.rgba(SHADOW_INK, 0.35));
    R(ctx, x - r, y - r + 1, r * 2, r, ramp[0]);
    R(ctx, x - r, y - r, r * 2 - 1, r, ramp[1]);
    D(ctx, x - r, y - r, ramp[2]);
    if (r > 1) R(ctx, x - r, y - r, r, 1, ramp[2]);
    if (winter) R(ctx, x - r, y - r, r * 2 - 1, 1, P.snow);
  }

  function drawFloorDetail(ctx, s) {
    const winter = s === 'winter';
    const ok = (x, y) => {
      const tx = Math.floor(x / T), ty = Math.floor(y / T);
      if (S.onRoad(tx, ty)) return false;
      const i = x - MX0; if (i >= 0 && i < NCOL && y < CBOT[i] + 2) return false;
      if (x >= VAULT.x - 6 && x < VAULT.x + VAULT.w + 30 && y >= VAULT.y - 4 && y < VAULT.y + VAULT.h + 26) return false;
      return x > 646;
    };
    // pebbles
    for (let k = 0; k < 260; k++) {
      const x = MX0 + 4 + Math.floor(S.hash(k, 1, 70) * (NCOL - 8)), y = 410 + Math.floor(S.hash(k, 2, 70) * 226);
      if (!ok(x, y)) continue;
      const big = S.hash(k, 3, 70) > 0.8;
      D(ctx, x + 1, y + 1, C.rgba(SHADOW_INK, 0.3));
      D(ctx, x, y, big ? FLOOR[4] : FLOOR[3]);
      if (big) { D(ctx, x + 1, y, FLOOR[2]); D(ctx, x, y + 1, FLOOR[1]); D(ctx, x + 1, y + 1, FLOOR[0]); }
    }
    // dry cracks
    for (let k = 0; k < 18; k++) {
      let x = MX0 + 10 + Math.floor(S.hash(k, 4, 71) * (NCOL - 20)), y = 476 + Math.floor(S.hash(k, 5, 71) * 156);
      if (!ok(x, y)) continue;
      const len = 4 + Math.floor(S.hash(k, 6, 71) * 6);
      for (let j = 0; j < len; j++) {
        D(ctx, x, y, FLOOR[0]); D(ctx, x, y + 1, FLOOR[3]);
        x += 1; if (S.hash(k, j, 72) > 0.6) y += S.hash(k, j, 73) > 0.5 ? 1 : -1;
      }
    }
    // tufts of dry grass (seasonal)
    const tuft = winter ? null : s === 'autumn' ? ['#a08640', '#c9ac58'] : s === 'spring' ? [P.grassDark.spring, P.grass.spring] : [P.grassDark.summer, P.grass.summer];
    if (tuft) for (let k = 0; k < 70; k++) {
      const x = MX0 + 6 + Math.floor(S.hash(k, 7, 74) * (NCOL - 12)), y = 470 + Math.floor(S.hash(k, 8, 74) * 166);
      if (!ok(x, y)) continue;
      D(ctx, x, y, tuft[0]); D(ctx, x + 2, y, tuft[0]); D(ctx, x + 1, y - 1, tuft[1]); D(ctx, x, y - 2, tuft[1]); D(ctx, x + 2, y - 1, tuft[1]);
    }
    // dry scrub bushes
    const scrub = winter ? ['#6a7068', '#8a928a', '#f4f8fb'] : s === 'autumn' ? ['#6a5a2a', '#9a8434', '#c4a848'] : s === 'spring' ? ['#3e6a2a', '#5e8e3a', '#8ab85a'] : ['#3a5a26', '#527a32', '#76a046'];
    for (const [x, y] of [[668, 470], [856, 560], [940, 626], [1012, 470], [700, 590], [800, 632], [976, 560], [748, 600]]) {
      if (!ok(x, y)) continue;
      groundShadow(ctx, x + 2, y + 1, 4, 1, 0.25);
      R(ctx, x - 3, y - 2, 7, 3, scrub[0]); R(ctx, x - 2, y - 4, 5, 3, scrub[1]); D(ctx, x - 2, y - 4, scrub[2]); D(ctx, x, y - 5, scrub[2]); D(ctx, x + 2, y - 3, scrub[0]);
      D(ctx, x - 4, y - 1, scrub[0]); D(ctx, x + 4, y - 1, scrub[0]); D(ctx, x - 1, y - 3, scrub[2]);
    }
    // boulders, some gold-flecked
    const boulders = [[662, 486, 6, 0], [690, 560, 5, 1], [654, 622, 7, 0], [702, 612, 4, 1], [958, 524, 5, 1], [826, 470, 4, 0], [770, 618, 5, 0], [992, 630, 5, 0], [668, 520, 3, 0]];
    for (const [x, y, r, au] of boulders) boulder(ctx, x, y, r, au, winter);
    // quartz crystal clusters
    crystals(ctx, 676, 596); crystals(ctx, 1012, 624);
  }
  function boulder(ctx, x, y, r, au, winter) {
    // faceted sandstone rock: lit top facet, front face, shaded right flank, a crack
    groundShadow(ctx, x + 2, y + 1, r + 2, Math.max(1, r >> 1), 0.28);
    const w = r * 2 + 2, h = Math.round(r * 1.6) + 2;
    const spr = build(w, h, (g) => {
      const topH = Math.max(2, Math.round(h * 0.38));
      for (let yy = 0; yy < h; yy++) {
        const inset = yy < topH ? Math.max(0, Math.round((topH - yy) * 1.2) - 1) : yy > h - 2 ? 1 : 0;
        const skew = Math.round((S.hash(x, yy, 67) - 0.5) * 1.2);
        const x0 = inset + (yy < topH ? skew : 0), x1 = w - inset - (yy < 2 ? 1 : 0);
        for (let xx = x0; xx < x1; xx++) {
          let c;
          if (yy < topH) c = xx < w * 0.6 ? STRATA.cream[2] : STRATA.cream[1];
          else if (xx > w * 0.68) c = STRATA.rust[0];
          else c = (yy === topH) ? STRATA.ochre[2] : STRATA.ochre[1];
          if (yy >= topH && xx <= w * 0.68 && ((xx + yy) & 1) && yy > h * 0.7) c = STRATA.ochre[0];
          D(g, xx, yy, c);
        }
      }
      // crack across the front
      const cx0 = Math.round(w * 0.3);
      for (let k = 0; k < Math.round(h * 0.5); k++) D(g, cx0 + (k >> 1), Math.round(h * 0.45) + k, STRATA.deep[0]);
      if (au) { D(g, Math.round(w * 0.45), Math.round(h * 0.55), GOLD.base); D(g, Math.round(w * 0.45) - 1, Math.round(h * 0.55) - 1, GOLD.hi); D(g, Math.round(w * 0.2), Math.round(h * 0.75), GOLD.base); }
      if (winter) R(g, 1, 0, w - 3, Math.max(1, Math.round(h * 0.3)), P.snow);
    }, '#3a1a12');
    place(ctx, spr, x - r - 1, y - h + 1);
  }
  function crystals(ctx, x, y) {
    groundShadow(ctx, x + 2, y + 1, 6, 2, 0.25);
    const spr = build(12, 12, (g) => {
      const shard = (sx, h, w) => { R(g, sx, 12 - h, w, h, '#9fc4d8'); R(g, sx, 12 - h, 1, h, '#e6f6ff'); R(g, sx + w - 1, 12 - h + 1, 1, h - 1, '#6c94b4'); D(g, sx + (w >> 1), 11 - h, '#ffffff'); };
      shard(1, 6, 3); shard(4, 10, 3); shard(7, 7, 3); shard(9, 4, 2);
    }, '#2c3c56');
    place(ctx, spr, x - 6, y - 12);
  }

  /* ============================================================ RAILS (12) */
  const RAIL = { tieL: '#946238', tieB: '#74482a', tieD: '#4e301a', bal: ['#5e5048', '#7a6a5c', '#948474'], hi: '#d2d4dc', body: '#6a6974', sh: 'rgba(20,16,30,0.35)', spike: '#2e2c34' };
  const RAD = 10;
  function railGeometry(pts) {
    // pts: px centre points. Returns straight segments (trimmed) and arcs.
    const segs = [], arcs = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      let [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
      if (i > 0) { x0 += dx * RAD; y0 += dy * RAD; }
      if (i + 2 < pts.length) { x1 -= dx * RAD; y1 -= dy * RAD; }
      segs.push({ x0, y0, x1, y1, h: dy === 0 });
    }
    for (let i = 1; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [cx, cy] = pts[i], [bx, by] = pts[i + 1];
      const d1 = [Math.sign(cx - ax), Math.sign(cy - ay)], d2 = [Math.sign(bx - cx), Math.sign(by - cy)];
      arcs.push({ cx, cy, d1, d2, ox: cx - RAD * d1[0] + RAD * d2[0], oy: cy - RAD * d1[1] + RAD * d2[1] });
    }
    return { segs, arcs };
  }
  const arcPoint = (a, th, off) => {
    const ux = -a.d2[0] * Math.cos(th) + a.d1[0] * Math.sin(th), uy = -a.d2[1] * Math.cos(th) + a.d1[1] * Math.sin(th);
    return [a.ox + (RAD + off) * ux, a.oy + (RAD + off) * uy, ux, uy];
  };
  function drawRails(ctx, pts, s) {
    const winter = s === 'winter';
    const { segs, arcs } = railGeometry(pts);
    const bal = (x, y) => { const hsh = S.hash(x, y, 80); D(ctx, x, y, hsh > 0.7 ? RAIL.bal[2] : hsh > 0.3 ? RAIL.bal[1] : RAIL.bal[0]); };
    // ballast bed
    for (const sg of segs) {
      if (sg.h) { const a = Math.min(sg.x0, sg.x1), b = Math.max(sg.x0, sg.x1); for (let x = a - 1; x <= b + 1; x++) for (let o = -7; o <= 7; o++) if (Math.abs(o) < 7 || S.hash(x, o, 81) > 0.5) bal(x, sg.y0 + o); }
      else { const a = Math.min(sg.y0, sg.y1), b = Math.max(sg.y0, sg.y1); for (let y = a - 1; y <= b + 1; y++) for (let o = -7; o <= 7; o++) if (Math.abs(o) < 7 || S.hash(o, y, 81) > 0.5) bal(sg.x0 + o, y); }
    }
    for (const a of arcs) for (let th = 0; th <= Math.PI / 2 + 0.01; th += 0.03) for (let o = -7; o <= 7; o++) { const [x, y] = arcPoint(a, th, o); bal(Math.round(x), Math.round(y)); }
    // ties
    const tieH = (x, cy) => { R(ctx, x, cy - 6, 2, 13, RAIL.tieB); R(ctx, x, cy - 6, 1, 13, RAIL.tieL); D(ctx, x + 1, cy + 6, RAIL.tieD); D(ctx, x + 2, cy - 5, RAIL.sh); R(ctx, x + 2, cy - 5, 1, 12, RAIL.sh); if (winter) R(ctx, x, cy - 6, 1, 3, P.snow); };
    const tieV = (cx, y) => { R(ctx, cx - 6, y, 13, 2, RAIL.tieB); R(ctx, cx - 6, y, 13, 1, RAIL.tieL); D(ctx, cx + 6, y + 1, RAIL.tieD); R(ctx, cx - 5, y + 2, 12, 1, RAIL.sh); if (winter) R(ctx, cx - 6, y, 3, 1, P.snow); };
    for (const sg of segs) {
      if (sg.h) { const a = Math.min(sg.x0, sg.x1), b = Math.max(sg.x0, sg.x1); for (let x = a + 1; x < b - 1; x += 5) tieH(x, sg.y0); }
      else { const a = Math.min(sg.y0, sg.y1), b = Math.max(sg.y0, sg.y1); for (let y = a + 1; y < b - 1; y += 5) tieV(sg.x0, y); }
    }
    for (const a of arcs) for (const th of [0.2, 0.55, 0.9, 1.25]) {
      for (let o = -6; o <= 6; o += 0.5) { const [x, y] = arcPoint(a, th, o); D(ctx, x, y, o < -5 ? RAIL.tieL : RAIL.tieB); }
      for (let o = -6; o <= 6; o += 0.5) { const [x, y] = arcPoint(a, th + 0.09, o); D(ctx, x, y, RAIL.tieD); }
    }
    // rails
    for (const sg of segs) {
      if (sg.h) {
        const a = Math.min(sg.x0, sg.x1), b = Math.max(sg.x0, sg.x1), y = sg.y0;
        for (const o of [-5, 4]) { R(ctx, a, y + o, b - a + 1, 1, RAIL.hi); R(ctx, a, y + o + 1, b - a + 1, 1, RAIL.body); R(ctx, a, y + o + 2, b - a + 1, 1, RAIL.sh); }
        for (let x = a + 1; x < b - 1; x += 10) { D(ctx, x, y - 3, RAIL.spike); D(ctx, x, y + 6, RAIL.spike); }
      } else {
        const a = Math.min(sg.y0, sg.y1), b = Math.max(sg.y0, sg.y1), x = sg.x0;
        for (const o of [-5, 4]) { R(ctx, x + o, a, 1, b - a + 1, RAIL.hi); R(ctx, x + o + 1, a, 1, b - a + 1, RAIL.body); R(ctx, x + o + 2, a, 1, b - a + 1, RAIL.sh); }
        for (let y = a + 1; y < b - 1; y += 10) { D(ctx, x - 3, y, RAIL.spike); D(ctx, x + 6, y, RAIL.spike); }
      }
    }
    for (const a of arcs) for (let th = 0; th <= Math.PI / 2 + 0.001; th += 0.02) {
      for (const [o1, o2] of [[-5, -4], [4, 5]]) {
        const p1 = arcPoint(a, th, o1), p2 = arcPoint(a, th, o2);
        const x1 = Math.round(p1[0]), y1 = Math.round(p1[1]), x2 = Math.round(p2[0]), y2 = Math.round(p2[1]);
        const lightFirst = x1 + y1 <= x2 + y2;
        D(ctx, x1, y1, lightFirst ? RAIL.hi : RAIL.body); D(ctx, x2, y2, lightFirst ? RAIL.body : RAIL.hi);
      }
    }
  }
  function drawTurntable(ctx, x, y) {
    groundShadow(ctx, x + 2, y + 2, 12, 5, 0.25);
    const spr = build(25, 17, (g) => {
      ellipse(g, 12, 9, 12, 7, IRON.deep);
      ellipse(g, 12, 8, 12, 7, IRON.dark);
      ellipse(g, 12, 8, 10, 6, TIMBER.base);
      for (let k = -9; k <= 9; k += 3) R(g, 12 + k, 3, 1, 11, TIMBER.dark);
      ellipse(g, 11, 7, 6, 3, TIMBER.light);
      for (let k = -9; k <= 9; k += 3) R(g, 12 + k, 4, 1, 4, TIMBER.base);
      // rails across the deck
      R(g, 1, 3, 23, 1, RAIL.hi); R(g, 1, 4, 23, 1, RAIL.body);
      R(g, 1, 12, 23, 1, RAIL.hi); R(g, 1, 13, 23, 1, RAIL.body);
      disc(g, 12, 8, 2, IRON.base); D(g, 11, 7, IRON.hi);
      // rim rivets
      for (const [rx, ry] of [[2, 8], [22, 8], [6, 2], [18, 2], [6, 14], [18, 14]]) D(g, rx, ry, IRON.light);
    }, OUT);
    place(ctx, spr, x - 12, y - 9);
    // throw lever
    const lv = build(5, 10, (g) => { R(g, 1, 4, 3, 6, IRON.dark); R(g, 2, 0, 1, 6, IRON.light); R(g, 1, 0, 3, 2, '#c8402e'); D(g, 1, 0, '#f07050'); }, OUT);
    place(ctx, lv, x + 14, y - 14, [2, 1, 0.25]);
  }
  function drawBuffer(ctx, x, y) {
    // a buffer stop at the west end of the line, facing west
    groundShadow(ctx, x + 3, y + 3, 6, 6, 0.25);
    const spr = build(10, 22, (g) => {
      R(g, 2, 2, 6, 18, TIMBER.dark); R(g, 2, 2, 2, 18, TIMBER.light); R(g, 4, 2, 3, 18, TIMBER.base);
      for (let k = 0; k < 18; k += 4) R(g, 0, 3 + k, 3, 2, k % 8 === 0 ? '#d8402e' : '#f2ece0');
      R(g, 0, 0, 10, 3, IRON.base); R(g, 0, 0, 10, 1, IRON.light);
      R(g, 0, 19, 10, 3, IRON.base);
      disc(g, 1, 5, 1, IRON.light); disc(g, 1, 16, 1, IRON.light);
    }, OUT);
    place(ctx, spr, x - 4, y - 11);
  }

  /* ============================================================ MINE BUILDINGS (21) */
  function timberV(g, x, y, w, h) {
    R(g, x, y, w, h, TIMBER.base);
    R(g, x, y, 1, h, TIMBER.light);
    R(g, x + w - 1, y, 1, h, TIMBER.dark);
    for (let j = 1; j < h; j++) if (S.hash(x, y + j, 41) > 0.72) D(g, x + 1 + (j % Math.max(1, w - 2)), y + j, TIMBER.dark);
    for (let j = 3; j < h - 2; j += 11) { D(g, x + (w >> 1), y + j, TIMBER.deep); D(g, x + (w >> 1) - 1, y + j - 1, TIMBER.hi); }
  }
  function timberH(g, x, y, w, h) {
    R(g, x, y, w, h, TIMBER.base);
    R(g, x, y, w, 1, TIMBER.hi);
    R(g, x, y + 1, w, 1, TIMBER.light);
    R(g, x, y + h - 1, w, 1, TIMBER.dark);
    for (let i = 1; i < w; i++) if (S.hash(x + i, y, 42) > 0.75) D(g, x + i, y + 2 + (i % Math.max(1, h - 3)), TIMBER.dark);
    // end grain
    R(g, x, y, 2, h, TIMBER.light); D(g, x, y + (h >> 1), TIMBER.dark);
    R(g, x + w - 2, y, 2, h, TIMBER.light); D(g, x + w - 1, y + (h >> 1), TIMBER.dark);
  }

  /** A rocky crest rising above the cliff behind the mouth, so the mine reads from afar. */
  const CREST = { x0: 868, x1: 956, peak: 22 };
  const crestTop = (x) => {
    const u = (x - CREST.x0) / (CREST.x1 - CREST.x0);
    if (u <= 0 || u >= 1) return 402;
    const hill = Math.pow(Math.sin(u * Math.PI), 0.8) * CREST.peak + (vnoise(x * 0.18, 2.2, 23) - 0.5) * 5 + (u > 0.3 && u < 0.45 ? 3 : 0);
    return Math.round(402 - hill);
  };
  function crest(ctx, s) {
    const winter = s === 'winter';
    const gA = winter ? P.snow : P.grass[s], gB = winter ? '#c9d6e2' : P.grassDark[s];
    for (let x = CREST.x0; x < CREST.x1; x++) {
      const top = crestTop(x);
      if (top >= 401) continue;
      const slope = crestTop(x + 1) - crestTop(x - 1);       // >0 = falling to the right
      for (let y = top; y <= 403; y++) {
        const dd = y - top;
        const yr = y - 400 + 30 + Math.round(2 * Math.sin(x * 0.07));
        const b = bandAt(clamp(yr, 0, 80)), ramp = BANDS[b].ramp;
        const facet = Math.floor((x - CREST.x0) / 9 + vnoise(y * 0.15, x * 0.02, 27) * 1.5);
        const fShade = (facet & 1) ? -0.45 : 0.15;
        let tv = 1.15 - dd * 0.025 - slope * 0.35 + fShade + (vnoise(x * 0.2, y * 0.2, 24) - 0.5) * 0.6 + (bayer(x, y) - 0.5) * 0.6;
        let c = ramp[clamp(Math.round(tv), 0, 2)];
        if (dd === 0) c = winter ? P.snow : '#f2dcac';
        else if (dd === 1 && slope <= 0) c = ramp[2];
        if (S.hash(x, 1, 25) > 0.92 && dd > 3 && vnoise(x * 0.5, y * 0.2, 26) > 0.55) c = '#3a1a12';
        D(ctx, x, y, c);
      }
      D(ctx, x, top - 1, '#3a1a12');
      // grass tufts / snow cap on the crest
      if (S.hash(x, 2, 25) > 0.6) { D(ctx, x, top - 1, gA); if (S.hash(x, 3, 25) > 0.6) { D(ctx, x, top - 2, gB); D(ctx, x, top - 3, '#2a3a1a'); } }
      if (winter) D(ctx, x, top + 1, '#e3ecf2');
    }
    // a couple of gold specks on the crest
    for (const [x, y] of [[884, 396], [930, 392], [941, 397]]) { D(ctx, x, y, GOLD.base); D(ctx, x - 1, y - 1, GOLD.hi); D(ctx, x + 1, y, '#2a120c'); }
    // shadow line where it meets the cliff top
    for (let x = CREST.x0 + 4; x < CREST.x1 - 4; x++) if (crestTop(x) < 399) D(ctx, x, 404, 'rgba(40,16,10,0.35)');
  }

  function mineEntrance(ctx, s) {
    const winter = s === 'winter';
    const W0 = 64, H0 = 56, ox = EX - 32, oy = 410;
    const spr = build(W0, H0, (g) => {
      // tunnel mouth (local x 20..44, y 22..54)
      const mx0 = 19, mx1 = 45, my0 = 22, my1 = 54;
      for (let y = my0; y < my1; y++) {
        const t = (y - my0) / (my1 - my0);
        R(g, mx0, y, mx1 - mx0, 1, t < 0.2 ? '#140c0a' : '#1c120d');
      }
      // receding timber sets inside the tunnel
      const sets = [[3, '#3a2414', '#2a1a10'], [7, '#2a1a10', '#1e140c'], [10, '#1e140c', '#160e0a']];
      for (const [k, cA, cB] of sets) {
        R(g, mx0 + k, my0 + k - 1, mx1 - mx0 - 2 * k, 2, cA);
        R(g, mx0 + k, my0 + k + 1, 2, my1 - my0 - k - 1, cA);
        R(g, mx1 - k - 2, my0 + k + 1, 2, my1 - my0 - k - 1, cB);
      }
      R(g, mx0 + 12, my0 + 12, mx1 - mx0 - 24, my1 - my0 - 13, '#07040a');
      // a lamp far inside
      D(g, mx0 + 15, my0 + 15, '#ffcf6a'); D(g, mx0 + 15, my0 + 16, '#c87a2a'); dith(g, mx0 + 13, my0 + 14, 5, 4, 'rgba(255,190,90,0.35)');
      // rails running in and fading
      for (let y = my1 - 1; y > my0 + 12; y--) {
        const t = (my1 - y) / (my1 - my0 - 12), half = Math.round(5 - t * 2.5);
        const c1 = t < 0.4 ? RAIL.hi : t < 0.75 ? '#7b7a84' : '#3a3842';
        D(g, 32 - half - 1, y, c1); D(g, 32 + half, y, c1);
        if ((my1 - y) % 4 === 0) R(g, 32 - half - 2, y, half * 2 + 4, 1, t < 0.5 ? TIMBER.dark : '#2a1a10');
      }
      // footing stones
      for (const sx of [10, 46]) {
        R(g, sx, 48, 9, 7, GRANITE.dark); R(g, sx, 48, 8, 1, GRANITE.light); R(g, sx, 49, 1, 5, GRANITE.base); D(g, sx + 4, 51, GRANITE.deep);
      }
      // posts
      timberV(g, 13, 20, 6, 31);
      timberV(g, 45, 20, 6, 31);
      // braces
      for (let k = 0; k < 5; k++) { R(g, 19 + k, 26 - k, 2, 2, k === 0 ? TIMBER.dark : TIMBER.base); D(g, 19 + k, 26 - k, TIMBER.light); R(g, 43 - k, 26 - k, 2, 2, TIMBER.base); D(g, 44 - k, 27 - k, TIMBER.dark); }
      // lintel
      timberH(g, 8, 14, 48, 7);
      R(g, 8, 21, 48, 1, 'rgba(20,10,8,0.5)');
      // iron straps with rivets
      for (const sx of [14, 46]) { R(g, sx, 14, 4, 7, IRON.dark); R(g, sx, 14, 4, 1, IRON.light); D(g, sx + 1, 16, IRON.hi); D(g, sx + 1, 19, IRON.hi); }
      // sign board: crossed pickaxes and a coin
      R(g, 22, 3, 20, 10, TIMBER.dark); R(g, 22, 3, 20, 9, TIMBER.light); R(g, 23, 4, 18, 7, TIMBER.base);
      R(g, 22, 6, 20, 1, TIMBER.dark);
      for (let k = 0; k < 8; k++) { D(g, 26 + k, 4 + k * 0.85, TIMBER.deep); D(g, 37 - k, 4 + k * 0.85, TIMBER.deep); }
      R(g, 24, 4, 5, 2, IRON.light); D(g, 24, 6, IRON.base); R(g, 35, 4, 5, 2, IRON.light); D(g, 39, 6, IRON.base);
      disc(g, 32, 8, 2, GOLD.base); D(g, 31, 7, GOLD.hi); D(g, 33, 9, GOLD.dark);
      D(g, 23, 3, IRON.hi); D(g, 40, 3, IRON.hi);
      // lantern bracket and lantern (right post)
      R(g, 51, 23, 6, 1, IRON.dark); R(g, 56, 23, 1, 3, IRON.dark);
      R(g, 54, 26, 5, 1, IRON.dark); R(g, 54, 27, 5, 6, '#ffcf6a'); R(g, 54, 27, 1, 6, IRON.dark); R(g, 58, 27, 1, 6, IRON.dark);
      R(g, 55, 28, 2, 3, '#fff1b8'); R(g, 54, 33, 5, 1, IRON.dark); D(g, 56, 25, IRON.light);
      // pickaxe leaning on the left post
      for (let k = 0; k < 16; k++) D(g, 6 + (k >> 2), 36 + k, k < 14 ? TIMBER.light : TIMBER.dark);
      R(g, 3, 35, 8, 2, IRON.base); R(g, 3, 35, 8, 1, IRON.hi); D(g, 2, 36, IRON.dark); D(g, 11, 36, IRON.dark);
      // bucket
      R(g, 53, 47, 7, 7, IRON.base); R(g, 53, 47, 7, 1, IRON.hi); R(g, 54, 48, 5, 2, '#3a3036'); R(g, 59, 48, 1, 6, IRON.dark);
      D(g, 55, 48, COPPER.light); D(g, 56, 49, GOLD.base);
      for (let k = 0; k < 5; k++) D(g, 53 + k + 1, 45 - (k === 0 || k === 4 ? 0 : 1), IRON.dark);
      // rubble
      for (const [rx, ry, rr] of [[2, 52, 2], [8, 54, 1], [58, 53, 1], [61, 51, 2]]) { R(g, rx - rr, ry - rr, rr * 2 + 1, rr + 1, STRATA.sand[0]); R(g, rx - rr, ry - rr, rr * 2, 1, STRATA.cream[2]); }
      if (winter) { R(g, 8, 13, 48, 1, P.snow); R(g, 22, 2, 20, 1, P.snow); R(g, 12, 47, 7, 1, P.snow); R(g, 46, 47, 7, 1, P.snow); }
      // red warning pennant when the ledger is in trouble
      if (LEVEL === 'critical') { R(g, 9, 2, 1, 12, IRON.dark); R(g, 10, 2, 6, 2, '#d8402e'); R(g, 10, 4, 4, 1, '#d8402e'); R(g, 10, 5, 2, 1, '#a82a1e'); }
    }, '#21140e');
    place(ctx, spr, ox, oy, [2, 1, 0.22]);
  }

  function cottage(ctx, s) {
    const winter = s === 'winter';
    const f = foliage(s);
    const spr = build(58, 54, (g) => {
      // stone front built into the cliff (arched top)
      for (let y = 8; y < 52; y++) {
        const t = (y - 8) / 12, half = y < 20 ? Math.round(24 * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)))) : 24;
        R(g, 28 - half, y, half * 2, 1, GRANITE.base);
      }
      // stones
      const rnd = S.rng(919);
      for (let y = 10; y < 52; y += 5) for (let x = 4 + ((y / 5) & 1) * 3; x < 52; x += 6 + Math.floor(rnd() * 3)) {
        const w = 5 + Math.floor(rnd() * 2);
        R(g, x, y, w, 4, rnd() > 0.5 ? GRANITE.light : GRANITE.base);
        R(g, x, y + 3, w, 1, GRANITE.dark); R(g, x + w - 1, y, 1, 4, GRANITE.dark); D(g, x, y, GRANITE.hi);
      }
      // trim the stones back to the arch
      clipRows(g, (y) => { if (y < 8 || y >= 52) return null; const t = (y - 8) / 12, half = y < 20 ? Math.round(24 * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)))) : 24; return [28 - half, half * 2]; }, 56);
      // copper arch band
      for (let y = 8; y < 21; y++) { const t = (y - 8) / 12, half = Math.round(24 * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)))); D(g, 28 - half, y, COPPER.light); D(g, 27 + half, y, COPPER.dark); }
      R(g, 14, 8, 28, 1, COPPER.light);
      // round door
      const dcx = 30, dby = 51;
      for (let y = 0; y < 20; y++) { const half = y < 8 ? Math.round(8 * Math.sqrt(1 - Math.pow((8 - y) / 8, 2))) : 8; R(g, dcx - half - 1, dby - 20 + y, half * 2 + 2, 1, TIMBER.dark); }
      for (let y = 1; y < 20; y++) { const half = y < 8 ? Math.round(7 * Math.sqrt(Math.max(0, 1 - Math.pow((8 - y) / 8, 2)))) : 7; R(g, dcx - half, dby - 20 + y, half * 2, 1, DOOR_GREEN.base); D(g, dcx - half, dby - 20 + y, DOOR_GREEN.light); D(g, dcx + half - 1, dby - 20 + y, DOOR_GREEN.dark); }
      for (let x = dcx - 5; x < dcx + 5; x += 3) R(g, x, dby - 17, 1, 17, DOOR_GREEN.dark);
      disc(g, dcx, dby - 10, 1, GOLD.base); D(g, dcx - 1, dby - 11, GOLD.hi);
      // round window
      disc(g, 12, 30, 5, TIMBER.dark); disc(g, 12, 30, 4, '#ffcf6a'); R(g, 8, 30, 9, 1, TIMBER.dark); R(g, 12, 26, 1, 9, TIMBER.dark); D(g, 10, 28, '#fff1b8'); D(g, 14, 32, '#d08a3a');
      // awning over the door
      for (let k = 0; k < 4; k++) R(g, dcx - 12 + k, 26 + k, 24 - 2 * k, 1, k === 0 ? COPPER.hi : k === 3 ? COPPER.dark : COPPER.base);
      for (let x = dcx - 11; x < dcx + 12; x += 3) D(g, x, 27, COPPER.dark);
      if (winter) R(g, dcx - 12, 25, 24, 1, P.snow);
      // lantern by the door
      R(g, 44, 30, 4, 1, IRON.dark); R(g, 44, 31, 4, 5, '#ffcf6a'); R(g, 44, 31, 1, 5, IRON.dark); R(g, 47, 31, 1, 5, IRON.dark); R(g, 44, 36, 4, 1, IRON.dark); D(g, 45, 32, '#fff1b8');
      // doorstep, mat
      R(g, dcx - 9, 51, 18, 2, GRANITE.light); R(g, dcx - 9, 52, 18, 1, GRANITE.dark);
      R(g, dcx - 5, 51, 10, 1, '#a8402e');
      // flower pot / snowy pot
      R(g, 4, 46, 6, 5, COPPER.base); R(g, 4, 46, 6, 1, COPPER.light); R(g, 9, 47, 1, 4, COPPER.dark);
      if (!winter) { D(g, 5, 44, f.base); D(g, 7, 43, f.light); D(g, 8, 45, f.alt); D(g, 6, 45, f.dark); } else R(g, 4, 45, 6, 1, P.snow);
      // mailbox post on the right
      R(g, 51, 38, 2, 14, TIMBER.base); R(g, 51, 38, 1, 14, TIMBER.light);
      R(g, 48, 33, 8, 6, '#3f6aa0'); R(g, 48, 33, 8, 1, '#7aa2d0'); R(g, 55, 34, 1, 5, '#2a4870'); R(g, 49, 35, 3, 1, '#2a4870'); R(g, 56, 31, 1, 4, '#d8402e');
      // chimney pipe poking out of the cliff top
      R(g, 40, 0, 5, 8, IRON.base); R(g, 40, 0, 1, 8, IRON.light); R(g, 44, 0, 1, 8, IRON.dark); R(g, 39, 0, 7, 2, IRON.dark); R(g, 39, 0, 7, 1, IRON.light);
    }, '#241a1e');
    place(ctx, spr, COT.x, COT.y, [2, 1, 0.22]);
  }

  function adit(ctx, s) {
    const winter = s === 'winter';
    const open = GROWTH >= 1;
    const spr = build(26, 24, (g) => {
      R(g, 6, 6, 14, 18, '#140c0a'); R(g, 9, 9, 8, 15, '#07040a');
      if (open) { D(g, 12, 13, '#ffcf6a'); dith(g, 11, 12, 3, 3, 'rgba(255,190,90,0.3)'); }
      timberV(g, 3, 4, 4, 20); timberV(g, 19, 4, 4, 20);
      timberH(g, 1, 1, 24, 5);
      if (!open) {
        // boarded up: two planks in an X and a "future shaft" stake
        for (let k = 0; k < 14; k++) { R(g, 7 + k, 8 + k, 2, 2, TIMBER.light); D(g, 7 + k, 9 + k, TIMBER.dark); R(g, 19 - k, 8 + k, 2, 2, TIMBER.base); }
        R(g, 6, 14, 14, 3, TIMBER.light); R(g, 6, 16, 14, 1, TIMBER.dark); D(g, 8, 15, IRON.dark); D(g, 17, 15, IRON.dark);
      }
      if (winter) R(g, 1, 0, 24, 1, P.snow);
    }, '#21140e');
    place(ctx, spr, ADIT.x - 13, ADIT.base - 24, [2, 1, 0.2]);
    if (open) {
      oreHeap(ctx, ADIT.x + 22, ADIT.base + 12, 8, winter);
      wheelbarrow(ctx, ADIT.x - 22, ADIT.base + 10);
    } else {
      // survey stakes with a ribbon
      for (const sx of [ADIT.x - 18, ADIT.x + 16]) {
        const st = build(3, 9, (g) => { R(g, 1, 0, 1, 9, TIMBER.light); R(g, 0, 1, 3, 2, '#e8603a'); }, OUT);
        place(ctx, st, sx, ADIT.base + 3, [1, 1, 0.25]);
      }
    }
  }
  function oreHeap(ctx, cx, by, r, winter) {
    groundShadow(ctx, cx + 2, by, r + 2, 3, 0.25);
    const spr = build(r * 2 + 2, r + 2, (g) => {
      for (let y = 0; y <= r; y++) { const w = Math.round(r * Math.sqrt(1 - Math.pow((r - y) / (r + 0.5), 2)) + 0.5); R(g, r + 1 - w, y + 1, w * 2, 1, y < r * 0.4 ? '#7a6a62' : '#5e5048'); }
      const rnd = S.rng(cx * 7 + by);
      for (let k = 0; k < r * 3; k++) {
        const x = 1 + Math.floor(rnd() * r * 2), y = 2 + Math.floor(rnd() * r);
        const pick = rnd();
        D(g, x, y, pick > 0.8 ? GOLD.base : pick > 0.6 ? COPPER.light : pick > 0.3 ? '#958680' : '#463c38');
      }
      D(g, r - 1, 2, GOLD.hi);
      if (winter) R(g, r - 2, 1, 5, 1, P.snow);
    }, '#2a2228');
    place(ctx, spr, cx - r - 1, by - r - 2);
  }
  function wheelbarrow(ctx, cx, by) {
    groundShadow(ctx, cx + 2, by, 7, 2, 0.25);
    const spr = build(16, 9, (g) => {
      R(g, 0, 4, 6, 1, TIMBER.light); D(g, 0, 5, TIMBER.dark);
      R(g, 4, 1, 9, 5, IRON.base); R(g, 4, 1, 9, 1, IRON.hi); R(g, 5, 2, 7, 1, '#5e5048'); D(g, 7, 1, COPPER.light); D(g, 10, 1, '#958680');
      R(g, 5, 6, 1, 3, IRON.dark); disc(g, 13, 6, 2, IRON.dark); D(g, 13, 6, IRON.light);
    }, OUT);
    place(ctx, spr, cx - 8, by - 9);
  }
  function barrel(ctx, x, by, winter) {
    groundShadow(ctx, x + 5, by, 5, 2, 0.25);
    const spr = build(8, 10, (g) => {
      R(g, 0, 1, 8, 8, TIMBER.base); R(g, 1, 0, 6, 10, TIMBER.base);
      R(g, 1, 0, 2, 10, TIMBER.light); R(g, 6, 1, 1, 8, TIMBER.dark);
      R(g, 0, 2, 8, 1, IRON.dark); R(g, 0, 7, 8, 1, IRON.dark);
      R(g, 1, 0, 6, 1, winter ? P.snow : TIMBER.hi);
    }, OUT);
    place(ctx, spr, x, by - 10);
  }
  function crate(ctx, x, by, w, h, winter) {
    const spr = build(w, h, (g) => {
      R(g, 0, 0, w, h, TIMBER.base); R(g, 0, 0, w, 2, TIMBER.hi); R(g, 0, 2, w, 1, TIMBER.dark);
      R(g, 0, 0, 1, h, TIMBER.light); R(g, w - 1, 0, 1, h, TIMBER.dark);
      for (let k = 0; k < Math.min(w, h - 3); k++) D(g, 1 + Math.round(k * (w - 2) / (h - 3)), 3 + k, TIMBER.dark);
      R(g, 0, h - 1, w, 1, TIMBER.deep);
      if (winter) R(g, 0, 0, w, 1, P.snow);
    }, OUT);
    place(ctx, spr, x, by - h, [2, 1, 0.25]);
  }
  function lampPost(ctx, x, by, winter) {
    groundShadow(ctx, x + 2, by, 3, 1, 0.3);
    const spr = build(7, 22, (g) => {
      R(g, 3, 6, 1, 15, IRON.dark); D(g, 3, 6, IRON.light);
      R(g, 2, 20, 3, 2, IRON.dark);
      R(g, 1, 1, 5, 1, IRON.dark); R(g, 0, 0, 7, 1, IRON.base);
      R(g, 1, 2, 5, 4, '#ffcf6a'); R(g, 2, 3, 2, 2, '#fff1b8'); R(g, 1, 2, 1, 4, IRON.dark); R(g, 5, 2, 1, 4, IRON.dark); R(g, 1, 6, 5, 1, IRON.dark);
      if (winter) R(g, 0, 0, 7, 1, P.snow);
    }, OUT);
    place(ctx, spr, x - 3, by - 22, [2, 1, 0.22]);
  }
  function toolRack(ctx, x, by) {
    const spr = build(14, 18, (g) => {
      R(g, 0, 4, 1, 14, TIMBER.dark); R(g, 13, 4, 1, 14, TIMBER.dark); R(g, 0, 4, 14, 2, TIMBER.light); R(g, 0, 5, 14, 1, TIMBER.dark);
      // shovel
      R(g, 3, 0, 1, 12, TIMBER.light); R(g, 2, 12, 3, 4, IRON.base); D(g, 2, 12, IRON.hi);
      // pickaxe
      R(g, 8, 2, 1, 14, TIMBER.light); R(g, 5, 1, 7, 2, IRON.base); R(g, 5, 1, 7, 1, IRON.hi);
      // lamp-helmet on a peg
      R(g, 10, 7, 4, 3, '#d8a020'); R(g, 10, 7, 4, 1, '#f6d050'); D(g, 13, 8, '#fff1b8');
    }, OUT);
    place(ctx, spr, x, by - 18, [2, 1, 0.22]);
  }

  /* ----- vault ----- */
  const coinF = clamp(Math.sqrt(INCOME / 3000), 0, 1);   // 0 = empty, 1 = overflowing
  function coinMound(g, cx, by, hw, h) {
    if (hw < 1 || h < 1) return;
    const inside = (x, y) => { if (y < 0 || y >= h) return false; const w = hw * Math.sqrt(1 - y / h); return Math.abs(x) <= w; };
    for (let y = 0; y < h; y++) {
      const w = Math.round(hw * Math.sqrt(1 - y / h));
      for (let x = -w; x <= w; x++) {
        const px = cx + x, py = by - y;
        let c;
        if (!inside(x, y + 1)) c = GOLD.light;
        else {
          const lv = (-x / hw) * 0.45 + (y / h) * 0.55 + (S.hash(px, py, 51) - 0.5) * 0.5;
          c = lv > 0.5 ? GOLD.light : lv > -0.05 ? GOLD.base : GOLD.dark;
        }
        D(g, px, py, c);
      }
      if (w >= 0) { D(g, cx - w - 1, by - y, GOLD.deep); D(g, cx + w + 1, by - y, GOLD.deep); }
    }
    for (let y = 1; y < h; y += 2) for (let x = -hw; x <= hw; x += 3) {
      const xx = x + ((y >> 1) & 1 ? 1 : 0);
      if (inside(xx, y) && inside(xx, y + 1)) { D(g, cx + xx, by - y + 1, GOLD.dark); if (S.hash(cx + xx, y, 52) > 0.55) D(g, cx + xx - 1, by - y, GOLD.hi); }
    }
    R(g, cx - hw - 1, by + 1, hw * 2 + 3, 1, GOLD.deep);
  }
  function coinTower(g, x, by, n) {
    for (let k = 0; k < n; k++) {
      const y = by - k * 2;
      R(g, x, y - 1, 5, 1, GOLD.base); D(g, x, y - 1, GOLD.light); D(g, x + 4, y - 1, GOLD.dark);
      R(g, x, y, 5, 1, GOLD.dark); D(g, x + 4, y, GOLD.deep);
    }
    const ty = by - n * 2;
    R(g, x, ty, 5, 1, GOLD.light); D(g, x + 1, ty, GOLD.hi);
    R(g, x - 1, ty, 1, n * 2 + 1, GOLD.deep); R(g, x + 5, ty, 1, n * 2 + 1, GOLD.deep); R(g, x, ty - 1, 5, 1, GOLD.deep);
  }
  function sack(g, x, by, coins) { // burlap money sack, 9x10
    ellipse(g, x + 4, by - 3, 4, 3, BURLAP.base);
    R(g, x + 1, by - 6, 7, 4, BURLAP.base);
    R(g, x + 2, by - 9, 5, 3, BURLAP.base);
    R(g, x + 2, by - 7, 5, 1, BURLAP.dark);
    D(g, x + 1, by - 5, BURLAP.light); D(g, x + 1, by - 4, BURLAP.light); D(g, x + 2, by - 9, BURLAP.light);
    R(g, x + 6, by - 5, 2, 4, BURLAP.dark);
    if (coins) { D(g, x + 3, by - 10, GOLD.base); D(g, x + 4, by - 10, GOLD.light); D(g, x + 5, by - 10, GOLD.dark); }
    disc(g, x + 4, by - 3, 1, GOLD.dark); D(g, x + 4, by - 3, GOLD.light);

  }

  function vault(ctx, s) {
    const winter = s === 'winter';
    const { x: VX, y: VY, w: VW, h: VH } = VAULT;
    const dcx = VDOOR.cx - VX, dcy = VDOOR.cy - VY, r = VDOOR.r;
    const spr = build(VW, VH, (g) => {
      // cap slab (top surface + front edge)
      R(g, 0, 0, VW, 6, GRANITE.light); R(g, 0, 0, VW, 1, GRANITE.hi);
      dith(g, 1, 1, VW - 2, 4, GRANITE.base, 0);
      R(g, 0, 6, VW, 3, COPPER.base); R(g, 0, 6, VW, 1, COPPER.hi); R(g, 0, 8, VW, 1, COPPER.dark);
      for (let x = 3; x < VW; x += 8) D(g, x, 7, COPPER.deep);
      // wall: ashlar blocks
      R(g, 0, 9, VW, VH - 15, GRANITE.base);
      for (let row = 0; row < 4; row++) {
        const y = 9 + row * 9, off = (row & 1) * 7;
        for (let x = -off; x < VW; x += 14) {
          const bx = Math.max(0, x), bw = Math.min(VW, x + 14) - bx;
          if (bw <= 0) continue;
          const tone = S.hash(row, x, 53);
          R(g, bx, y, bw, 9, tone > 0.66 ? GRANITE.light : tone > 0.25 ? GRANITE.base : C.mix(GRANITE.base, GRANITE.dark, 0.4));
          R(g, bx, y, bw, 1, GRANITE.hi); R(g, bx, y, 1, 9, GRANITE.light);
          R(g, bx, y + 8, bw, 1, GRANITE.deep); R(g, bx + bw - 1, y, 1, 9, GRANITE.dark);
          if (S.hash(row, x, 54) > 0.6) D(g, bx + 4, y + 4, GRANITE.dark);
        }
      }
      // plinth
      R(g, 0, VH - 6, VW, 6, GRANITE.dark); R(g, 0, VH - 6, VW, 1, GRANITE.light); R(g, 0, VH - 1, VW, 1, GRANITE.deep);
      // copper pilasters with rivets at both ends
      for (const px of [0, VW - 6]) {
        R(g, px, 9, 6, VH - 15, COPPER.base); R(g, px, 9, 1, VH - 15, COPPER.hi); R(g, px + 5, 9, 1, VH - 15, COPPER.dark);
        for (let y = 12; y < VH - 7; y += 6) { D(g, px + 2, y, COPPER.hi); D(g, px + 3, y + 1, COPPER.deep); }
      }
      // doorway: brass ring, dark interior
      disc(g, dcx, dcy, r + 3, GOLD.deep);
      disc(g, dcx, dcy, r + 2, GOLD.dark);
      disc(g, dcx - 1, dcy - 1, r + 1, GOLD.base);
      disc(g, dcx, dcy, r, '#2a1c12');
      disc(g, dcx, dcy + 1, r - 1, '#1a110c');
      // interior floor
      for (let y = dcy + 4; y <= dcy + r; y++) { const w = Math.floor(Math.sqrt(Math.max(0, r * r - (y - dcy) * (y - dcy)))); R(g, dcx - w, y, w * 2 + 1, 1, y === dcy + 4 ? '#4a3524' : '#3a2a1c'); }
      // back shelves
      R(g, dcx - 9, dcy - 5, 18, 1, TIMBER.dark); R(g, dcx - 9, dcy - 6, 18, 1, TIMBER.base);
      // ring rivets
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; D(g, Math.round(dcx + Math.cos(a) * (r + 2)), Math.round(dcy + Math.sin(a) * (r + 2)), k < 6 ? GOLD.dark : GOLD.hi); }
      // contents
      if (INCOME <= 0) {
        // empty: a slumped empty sack, a cobweb and a mouse
        R(g, dcx + 2, dcy + 9, 7, 3, BURLAP.dark); R(g, dcx + 3, dcy + 8, 5, 1, BURLAP.base); D(g, dcx + 3, dcy + 9, BURLAP.light);
        for (let k = 0; k < 5; k++) { D(g, dcx - 9 + k, dcy - 9 + k, '#8a8478'); D(g, dcx - 9, dcy - 9 + k, '#6a665e'); D(g, dcx - 9 + k, dcy - 9, '#6a665e'); }
        D(g, dcx - 7, dcy - 5, '#8a8478'); D(g, dcx - 5, dcy - 7, '#8a8478');
        R(g, dcx - 6, dcy + 10, 3, 2, '#8c8890'); D(g, dcx - 7, dcy + 10, '#b4b0b8'); D(g, dcx - 3, dcy + 11, '#6a666e'); D(g, dcx - 7, dcy + 9, '#e0a0a8');
      } else {
        const hw = Math.round(3 + 8 * coinF), hh = Math.round(2 + 7 * coinF);
        coinMound(g, dcx - 1, dcy + 11, Math.min(hw, 11), Math.min(hh, 9));
        const towers = Math.floor(coinF * 5);
        for (let k = 0; k < towers; k++) coinTower(g, dcx - 10 + k * 5, dcy - 6, 1 + ((k * 7) % 3));
        if (coinF > 0.45) { coinTower(g, dcx + 6, dcy + 10, 3 + Math.round(coinF * 3)); }
      }
      // open door, swung to the right (edge-on disc)
      const ddx = dcx + r + 7;
      ellipse(g, ddx + 1, dcy, 5, r + 1, IRON.deep);
      ellipse(g, ddx, dcy, 5, r + 1, IRON.base);
      ellipse(g, ddx + 1, dcy, 3, r - 1, IRON.light);
      ellipse(g, ddx + 1, dcy, 2, r - 4, IRON.base);
      R(g, ddx - 5, dcy - r + 2, 1, r * 2 - 4, IRON.dark);
      for (let k = -r + 3; k < r - 2; k += 4) { D(g, ddx - 3, dcy + k, IRON.hi); D(g, ddx + 4, dcy + k, IRON.dark); }
      // wheel handle
      R(g, ddx, dcy - 4, 1, 9, GOLD.base); R(g, ddx - 1, dcy, 4, 1, GOLD.base); D(g, ddx + 1, dcy, GOLD.hi);
      D(g, ddx, dcy - 4, GOLD.hi); D(g, ddx, dcy + 4, GOLD.dark);
      // hinges
      R(g, dcx + r + 1, dcy - 8, 3, 3, IRON.dark); R(g, dcx + r + 1, dcy + 5, 3, 3, IRON.dark);
      // combination dial plate
      disc(g, 76, 22, 5, IRON.dark); disc(g, 76, 22, 4, IRON.light); disc(g, 76, 22, 2, IRON.base);
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; D(g, Math.round(76 + Math.cos(a) * 4), Math.round(22 + Math.sin(a) * 4), IRON.deep); }
      D(g, 76, 19, '#d8402e'); D(g, 75, 21, IRON.hi);
      // keystone with a coin emblem above the doorway
      R(g, dcx - 3, 9, 7, 6, GRANITE.light); R(g, dcx - 3, 9, 7, 1, GRANITE.hi); R(g, dcx + 3, 9, 1, 6, GRANITE.dark);
      disc(g, dcx, 12, 1, GOLD.base); D(g, dcx - 1, 11, GOLD.hi);
      // wall lantern on the left
      R(g, 9, 18, 5, 1, IRON.dark); R(g, 10, 19, 4, 1, IRON.dark); R(g, 10, 20, 4, 6, '#ffcf6a'); R(g, 10, 20, 1, 6, IRON.dark); R(g, 13, 20, 1, 6, IRON.dark); R(g, 10, 26, 4, 1, IRON.dark); D(g, 11, 21, '#fff1b8');
      if (winter) { R(g, 0, 0, VW, 2, P.snow); dith(g, 0, 2, VW, 2, P.snow, 1); }
      if (LEVEL === 'critical') { R(g, 84, -10, 1, 11, IRON.dark); R(g, 85, -10, 5, 2, '#d8402e'); R(g, 85, -8, 3, 1, '#d8402e'); }
    }, '#1f1a22');
    place(ctx, spr, VX, VY, [3, 1, 0.25]);

    // spill outside: piles, sacks and loose coins (scaled by this month's income)
    if (INCOME > 0) {
      const outside = build(56, 22, (g) => {
        if (coinF > 0.3) { const hw = Math.round(5 + 12 * (coinF - 0.3)), hh = Math.round(3 + 8 * (coinF - 0.3)); coinMound(g, 14, 19, hw, hh); }
        const sacks = Math.min(4, Math.floor(coinF * 4.4));
        for (let k = 0; k < sacks; k++) sack(g, 26 + k * 8, 20 - (k & 1), true);
        if (coinF > 0.8) {
          for (let k = 0; k < 3; k++) { R(g, 2 + k * 6, 14 - (k === 1 ? 3 : 0), 6, 3, GOLD.base); R(g, 2 + k * 6, 14 - (k === 1 ? 3 : 0), 6, 1, GOLD.hi); R(g, 2 + k * 6, 16 - (k === 1 ? 3 : 0), 6, 1, GOLD.dark); }
        }
        const loose = Math.round(coinF * 12);
        for (let k = 0; k < loose; k++) { const x = 2 + Math.floor(S.hash(k, 1, 55) * 50), y = 17 + Math.floor(S.hash(k, 2, 55) * 4); R(g, x, y, 2, 1, GOLD.base); D(g, x, y, GOLD.hi); D(g, x + 1, y + 1, GOLD.deep); }
      }, '#4a2c08');
      ctx.globalAlpha = 0.22; ctx.drawImage(outside.sil || (outside.sil = silhouette(outside)), VX + 6, VY + VH - 9); ctx.globalAlpha = 1;
      ctx.drawImage(outside, VX + 4, VY + VH - 11);
    }
    // Grit's ledger on a lectern to the right of the vault
    const lect = build(14, 21, (g) => {
      R(g, 6, 8, 3, 12, TIMBER.base); R(g, 6, 8, 1, 12, TIMBER.light); R(g, 8, 8, 1, 12, TIMBER.dark);
      R(g, 3, 19, 9, 2, TIMBER.dark); R(g, 3, 19, 9, 1, TIMBER.light);
      // slanted desk with an open book
      R(g, 0, 4, 14, 5, TIMBER.dark); R(g, 1, 3, 12, 1, TIMBER.light);
      R(g, 1, 1, 6, 4, '#f2ead4'); R(g, 7, 1, 6, 4, '#e6dcc0'); R(g, 6, 1, 1, 4, '#a89c80');
      for (let k = 0; k < 3; k++) { R(g, 2, 2 + k, 4, 1, k === 1 ? '#7a7060' : '#b0a68e'); R(g, 8, 2 + k, 4, 1, k === 2 ? '#3a8a4a' : '#9a907a'); }
      R(g, 9, 5, 1, 3, '#c8402e');
      // quill
      D(g, 13, 0, '#f4f0e8'); D(g, 12, 1, '#f4f0e8'); D(g, 11, 2, '#4a4048');
    }, OUT);
    place(ctx, lect, VX + VW + 4, VY + VH - 21, [2, 1, 0.25]);
  }

  /* ----- growth structures ----- */
  function headframe(ctx, s) {
    const winter = s === 'winter';
    const spr = build(40, 62, (g) => {
      // shaft collar (stone ring with a dark hole)
      ellipse(g, 20, 56, 13, 4, GRANITE.dark); ellipse(g, 20, 55, 12, 3, GRANITE.light); ellipse(g, 20, 55, 9, 2, '#0a0608');
      // A-frame legs
      for (let k = 0; k < 50; k++) {
        const y = 54 - k, xl = Math.round(6 + k * 0.24), xr = Math.round(34 - k * 0.24);
        R(g, xl, y, 3, 1, TIMBER.base); D(g, xl, y, TIMBER.light); D(g, xl + 2, y, TIMBER.dark);
        R(g, xr - 2, y, 3, 1, TIMBER.base); D(g, xr - 2, y, TIMBER.light); D(g, xr, y, TIMBER.dark);
      }
      // cross beams
      for (const y of [44, 30, 16]) { const k = 54 - y; timberH(g, Math.round(6 + k * 0.24), y, Math.round(28 - k * 0.48) + 3, 3); }
      // X braces
      for (let k = 0; k < 13; k++) { D(g, 10 + k, 31 + k, TIMBER.dark); D(g, 30 - k, 31 + k, TIMBER.dark); }
      // sheave wheel
      disc(g, 20, 6, 6, IRON.dark); disc(g, 20, 6, 5, IRON.base); disc(g, 20, 6, 3, IRON.deep); disc(g, 20, 6, 1, IRON.light);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; D(g, Math.round(20 + Math.cos(a) * 3), Math.round(6 + Math.sin(a) * 3), IRON.light); }
      D(g, 16, 2, IRON.hi); D(g, 17, 1, IRON.hi);
      // cable down the shaft
      R(g, 25, 6, 1, 48, '#2a2830');
      // little bucket at the collar
      R(g, 23, 48, 5, 5, COPPER.base); R(g, 23, 48, 5, 1, COPPER.hi); R(g, 27, 49, 1, 4, COPPER.dark); D(g, 24, 48, GOLD.base);
      if (winter) { R(g, 7, 43, 27, 1, P.snow); R(g, 11, 29, 19, 1, P.snow); R(g, 15, 0, 10, 1, P.snow); }
    }, '#21140e');
    place(ctx, spr, HEAD.x - 20, HEAD.base - 60, [4, 1, 0.2]);
    // winch house
    const wh = build(18, 16, (g) => {
      R(g, 0, 5, 18, 11, TIMBER.base);
      for (let x = 0; x < 18; x += 3) { R(g, x, 5, 1, 11, TIMBER.dark); D(g, x + 1, 5, TIMBER.light); }
      for (let k = 0; k < 5; k++) R(g, -1 + k, k, 20 - 2 * k, 1, k === 0 ? COPPER.dark : COPPER.base);
      R(g, 0, 0, 18, 1, s === 'winter' ? P.snow : COPPER.hi); R(g, 0, 1, 18, 4, COPPER.base); R(g, 0, 4, 18, 1, COPPER.dark);
      R(g, 6, 9, 5, 7, '#2a1a10'); R(g, 13, 8, 3, 3, '#ffcf6a'); D(g, 13, 8, '#fff1b8');
    }, '#21140e');
    place(ctx, wh, HEAD.x + 20, HEAD.base - 18, [3, 1, 0.22]);
    oreHeap(ctx, HEAD.x - 26, HEAD.base - 2, 7, winter);
  }

  function smelter(ctx, s) {
    const winter = s === 'winter';
    const spr = build(48, 54, (g) => {
      // chimney
      R(g, 30, 0, 9, 30, BRICK.base); R(g, 30, 0, 2, 30, BRICK.light); R(g, 37, 0, 2, 30, BRICK.dark);
      for (let y = 2; y < 30; y += 4) { R(g, 30, y, 9, 1, BRICK.deep); D(g, 33 + ((y >> 2) & 1) * 2, y + 1, BRICK.deep); }
      R(g, 29, 0, 11, 2, IRON.dark); R(g, 29, 0, 11, 1, IRON.light);
      // furnace body (domed stone)
      for (let y = 22; y < 54; y++) { const t = (y - 22) / 10, half = y < 32 ? Math.round(20 * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)))) : 20; R(g, 22 - half, y, half * 2, 1, GRANITE.base); }
      const rnd = S.rng(31337);
      for (let y = 24; y < 52; y += 5) for (let x = 2 + ((y / 5) & 1) * 3; x < 42; x += 6 + Math.floor(rnd() * 2)) { R(g, x, y, 5, 4, rnd() > 0.5 ? GRANITE.light : GRANITE.base); R(g, x, y + 3, 5, 1, GRANITE.dark); D(g, x, y, GRANITE.hi); }
      clipRows(g, (y) => { if (y < 22) return [30, 9]; const t = (y - 22) / 10, half = y < 32 ? Math.round(20 * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)))) : 20; const a = 22 - half, b = Math.max(22 + half, y < 30 ? 39 : 0); return [a, b - a]; }, 54);
      // glowing furnace mouth
      R(g, 14, 38, 16, 14, '#2a120c'); R(g, 15, 40, 14, 12, '#d8501e'); R(g, 17, 43, 10, 9, '#f8a030'); R(g, 19, 46, 6, 6, '#ffe08a');
      R(g, 13, 37, 18, 2, IRON.dark); R(g, 13, 37, 18, 1, IRON.light);
      // ingots cooling on the step
      for (let k = 0; k < 3; k++) { R(g, 2 + k * 4, 49 - k % 2, 4, 2, GOLD.base); D(g, 2 + k * 4, 49 - k % 2, GOLD.hi); }
      if (winter) { R(g, 6, 22, 30, 1, P.snow); }
    }, '#21140e');
    place(ctx, spr, SMELT.x, SMELT.base - 54, [4, 1, 0.22]);
  }

  function parkedSpur(ctx, s) {
    // short siding on the west canyon floor with two parked ore carts (they never move)
    const y = 618;
    drawRails(ctx, [[672, y], [730, y]], s);
    drawBuffer(ctx, 670, y);
    for (const cx of [694, 716]) {
      groundShadow(ctx, cx + 2, y + 6, 9, 2, 0.28);
      const spr = build(18, 14, (g) => {
        R(g, 1, 2, 16, 9, IRON.base); R(g, 1, 2, 16, 1, IRON.hi); R(g, 0, 2, 1, 9, IRON.dark); R(g, 17, 2, 1, 9, IRON.dark);
        R(g, 2, 3, 14, 1, IRON.light); R(g, 1, 6, 16, 1, IRON.dark); for (const rx of [3, 8, 14]) D(g, rx, 4, IRON.hi);
        R(g, 2, 0, 14, 3, '#5e5048'); D(g, 4, 0, GOLD.base); D(g, 9, 1, COPPER.light); D(g, 12, 0, GOLD.hi); D(g, 6, 1, '#958680');
        disc(g, 4, 11, 2, IRON.deep); disc(g, 14, 11, 2, IRON.deep); D(g, 4, 11, IRON.light); D(g, 14, 11, IRON.light);
        if (s === 'winter') R(g, 2, 0, 14, 1, P.snow);
      }, OUT);
      place(ctx, spr, cx - 9, y - 9);
    }
  }

  function timberStack(ctx, x, by, winter) {
    groundShadow(ctx, x + 12, by, 13, 3, 0.25);
    const spr = build(24, 12, (g) => {
      for (let row = 0; row < 3; row++) for (let k = 0; k < 3 - row; k++) {
        const cx = 4 + k * 8 + row * 4, cy = 8 - row * 4;
        R(g, cx - 4, cy - 3, 8, 7, TIMBER.base); R(g, cx - 4, cy - 3, 8, 1, TIMBER.hi); R(g, cx - 4, cy + 3, 8, 1, TIMBER.dark);
        disc(g, cx - 4, cy, 3, TIMBER.light); D(g, cx - 4, cy, TIMBER.dark); D(g, cx - 5, cy - 1, TIMBER.hi);
      }
      if (winter) { R(g, 6, 0, 10, 1, P.snow); R(g, 0, 4, 6, 1, P.snow); }
    }, '#21140e');
    place(ctx, spr, x, by - 12);
  }
  function sluice(ctx, x, by, winter) {
    // a gold sluice box on trestles, riffles full of gravel, and a panning dish leaning on it
    groundShadow(ctx, x + 14, by, 15, 3, 0.25);
    const spr = build(30, 16, (g) => {
      for (const lx of [4, 24]) { R(g, lx, 8 - (lx >> 3), 2, 8 + (lx >> 3), TIMBER.dark); D(g, lx, 8 - (lx >> 3), TIMBER.light); }
      for (let i = 0; i < 28; i++) {
        const y = 3 + Math.round(i * 0.18);
        R(g, i, y, 1, 5, TIMBER.base); D(g, i, y, TIMBER.hi); D(g, i, y + 4, TIMBER.deep);
        D(g, i, y + 1, (i % 5 === 0) ? TIMBER.dark : '#6e625a'); D(g, i, y + 2, (i % 5 === 0) ? TIMBER.dark : (S.hash(i, 1, 66) > 0.75 ? GOLD.base : '#8a7c72'));
        D(g, i, y + 3, TIMBER.light);
      }
      // gold pan
      ellipse(g, 24, 12, 5, 3, IRON.dark); ellipse(g, 24, 12, 4, 2, IRON.light); ellipse(g, 24, 12, 2, 1, IRON.base); D(g, 24, 12, GOLD.base); D(g, 25, 13, GOLD.hi); D(g, 22, 11, IRON.hi);
      if (winter) R(g, 0, 2, 22, 1, P.snow);
    }, OUT);
    place(ctx, spr, x, by - 16);
  }
  function bench(ctx, x, by, winter) {
    groundShadow(ctx, x + 8, by, 9, 2, 0.25);
    const spr = build(18, 9, (g) => {
      R(g, 0, 2, 18, 3, TIMBER.light); R(g, 0, 2, 18, 1, TIMBER.hi); R(g, 0, 4, 18, 1, TIMBER.dark);
      R(g, 2, 5, 2, 4, TIMBER.dark); R(g, 14, 5, 2, 4, TIMBER.dark);
      // a mug and a small sack of ore samples
      R(g, 3, 0, 3, 2, '#e8e0d0'); D(g, 6, 1, '#e8e0d0'); D(g, 4, 0, '#f6f0e4');
      R(g, 11, 0, 4, 2, BURLAP.base); D(g, 12, 0, GOLD.base);
      if (winter) R(g, 7, 2, 4, 1, P.snow);
    }, OUT);
    place(ctx, spr, x, by - 9);
  }

  function drawMine(ctx) {
    const s = season(), winter = s === 'winter';
    crest(ctx, s);
    adit(ctx, s);
    mineEntrance(ctx, s);
    cottage(ctx, s);
    // yard props around the mouth
    toolRack(ctx, 942, 472);
    barrel(ctx, 874, 474, winter); barrel(ctx, 864, 478, winter);
    crate(ctx, 860, 492, 10, 9, winter);
    lampPost(ctx, 884, 494, winter); lampPost(ctx, 940, 494, winter);
    // vault, crates beside it
    vault(ctx, s);
    crate(ctx, VAULT.x - 12, VAULT.y + VAULT.h - 2, 10, 10, winter);
    crate(ctx, VAULT.x - 10, VAULT.y + VAULT.h - 12, 8, 8, winter);
    lampPost(ctx, 716, 494, winter);
    if (GROWTH >= 2) headframe(ctx, s);
    else oreHeap(ctx, 880, 590, GROWTH >= 1 ? 8 : 5, winter);
    if (GROWTH >= 3) { smelter(ctx, s); parkedSpur(ctx, s); }
    else { barrel(ctx, 960, 600, winter); crate(ctx, 974, 604, 11, 10, winter); }
    if (GROWTH >= 1) oreHeap(ctx, 690, 530, 6, winter);
    timberStack(ctx, 984, 534, winter);
    sluice(ctx, 986, 580, winter);
    bench(ctx, 992, 482, winter);
  }

  /* ============================================================ SAVINGS ROW (30) */
  function sitePatch(ctx, x0, y0, x1, y1, seed) {
    const s = season();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const ex = Math.min(x - x0, x1 - 1 - x, y - y0, y1 - 1 - y);
      if (ex < 4 && S.hash(x, y, seed) * 4 > ex + 0.5) continue;
      if (S.onRoad(Math.floor(x / T), Math.floor(y / T))) continue;
      const v = vnoise(x * 0.12, y * 0.12, seed) + (bayer(x, y) - 0.5) * 0.4;
      let c = v > 0.62 ? P.dirtLight : v > 0.3 ? P.dirt : P.dirtDark;
      if (s === 'winter' && vnoise(x * 0.08, y * 0.08, seed + 1) > 0.45) c = v > 0.5 ? P.snow : '#c9d6e2';
      D(ctx, x, y, c);
    }
  }

  function apartment(ctx, s) {
    const winter = s === 'winter';
    const pct = APT.pct;
    const full = pct == null ? 0 : Math.floor(pct * APTB.floors + 1e-9);
    const part = pct == null ? 0 : pct * APTB.floors - full;
    const done = pct != null && pct >= 1;
    const { x: BX, w: BW, slab: SLAB, fl: FH, floors: NF } = APTB;
    sitePatch(ctx, 400, 556, 496, 630, 301);
    // tyre tracks
    for (let y = 600; y < 628; y += 2) { D(ctx, 484 + ((y >> 2) & 1), y, P.dirtDark); D(ctx, 490 + ((y >> 2) & 1), y, P.dirtDark); }
    const topY = SLAB - full * FH - (part > 0 ? Math.round(part * FH) : 0);

    // crane mast behind the building (drawn first so the floors hide it as they rise)
    if (!done) {
      const mast = build(8, SLAB - MAST.top + 2, (g) => {
        const h = SLAB - MAST.top + 2;
        R(g, 0, 0, 1, h, CRANE.dark); R(g, 7, 0, 1, h, CRANE.deep); R(g, 1, 0, 1, h, CRANE.light); R(g, 6, 0, 1, h, CRANE.base);
        for (let y = 0; y < h; y += 6) { for (let k = 0; k < 6; k++) { D(g, 1 + k, y + k, CRANE.base); D(g, 6 - k, y + k, CRANE.dark); } R(g, 0, y, 8, 1, CRANE.base); }
      }, '#3a2a10');
      place(ctx, mast, MAST.x, MAST.top);
    }

    // foundation slab
    const slab = build(BW + 12, 14, (g) => {
      R(g, 0, 0, BW + 12, 8, CONC.light); R(g, 0, 0, BW + 12, 1, CONC.hi);
      dith(g, 1, 1, BW + 10, 7, CONC.base, 0);
      for (let k = 0; k < 9; k++) D(g, 3 + Math.floor(S.hash(k, 1, 302) * (BW + 6)), 2 + Math.floor(S.hash(k, 2, 302) * 5), CONC.dark);
      R(g, 0, 8, BW + 12, 6, CONC.dark); R(g, 0, 8, BW + 12, 1, CONC.base); R(g, 0, 13, BW + 12, 1, CONC.deep);
      if (winter) { R(g, 0, 0, BW + 12, 2, P.snow); dith(g, 0, 2, BW + 12, 3, P.snow, 1); }
    }, '#3a3836');
    place(ctx, slab, BX - 6, SLAB, [3, 1, 0.25]);

    // ghost of the finished building (blueprint dotted outline)
    if (!done) {
      const gTop = SLAB - NF * FH - 5;
      ctx.fillStyle = 'rgba(190,232,255,0.55)';
      for (let x = BX; x < BX + BW; x += 2) { ctx.fillRect(x, gTop, 1, 1); }
      for (let y = gTop; y < topY; y += 2) { ctx.fillRect(BX, y, 1, 1); ctx.fillRect(BX + BW - 1, y, 1, 1); }
      ctx.fillStyle = 'rgba(190,232,255,0.3)';
      for (let f = full + 1; f < NF; f++) { const y = SLAB - f * FH - FH; if (y < topY - 1) for (let x = BX + 2; x < BX + BW - 2; x += 3) ctx.fillRect(x, y, 1, 1); }
    }

    // built floors
    if (full > 0 || part > 0) {
      const h = SLAB - topY + 6;
      const bld = build(BW, h, (g) => {
        for (let f = 0; f < full; f++) {
          const y0 = h - (f + 1) * FH;
          R(g, 0, y0, BW, FH, BRICK.base);
          for (let yy = y0 + 3; yy < y0 + FH; yy += 3) { R(g, 0, yy, BW, 1, BRICK.dark); for (let x = ((yy / 3) & 1) * 3; x < BW; x += 6) D(g, x, yy + 1, BRICK.dark); }
          for (let yy = y0 + 2; yy < y0 + FH; yy += 3) for (let x = 0; x < BW; x += 7) if (S.hash(x, yy, 303) > 0.7) R(g, x + 1, yy, 3, 1, BRICK.light);
          R(g, 0, y0, 1, FH, BRICK.light); R(g, BW - 1, y0, 1, FH, BRICK.deep);
          // concrete floor band
          R(g, 0, y0, BW, 2, CONC.light); R(g, 0, y0, BW, 1, CONC.hi); R(g, 0, y0 + 2, BW, 1, BRICK.deep);
          // windows (door on the ground floor)
          for (const wx of [6, 27, 48]) {
            if (f === 0 && wx === 27) {
              R(g, 26, y0 + 3, 12, FH - 3, '#eae4d6'); R(g, 27, y0 + 4, 10, FH - 4, '#3a5a7a'); R(g, 32, y0 + 4, 1, FH - 4, '#eae4d6'); D(g, 28, y0 + 5, '#8ab8dc'); D(g, 29, y0 + 6, '#8ab8dc'); D(g, 31, y0 + 8, '#d8a020');
              continue;
            }
            R(g, wx - 1, y0 + 3, 12, 8, '#eae4d6'); R(g, wx, y0 + 4, 10, 6, '#3d6488');
            R(g, wx + 5, y0 + 4, 1, 6, '#eae4d6'); D(g, wx + 1, y0 + 5, '#9ccbe8'); D(g, wx + 2, y0 + 4, '#9ccbe8'); D(g, wx + 7, y0 + 5, '#9ccbe8');
            R(g, wx - 1, y0 + 10, 12, 1, CONC.dark);
          }
        }
        if (part > 0) {
          // columns and formwork rising for the next floor
          const ph = Math.max(2, Math.round(part * FH)), y1 = h - full * FH;
          for (const cx of [0, 21, 42, BW - 4]) {
            R(g, cx, y1 - ph, 4, ph, CONC.base); R(g, cx, y1 - ph, 1, ph, CONC.hi); R(g, cx + 3, y1 - ph, 1, ph, CONC.dark);
            D(g, cx + 1, y1 - ph - 2, '#7a3a20'); D(g, cx + 1, y1 - ph - 1, '#7a3a20'); D(g, cx + 2, y1 - ph - 3, '#7a3a20'); D(g, cx + 2, y1 - ph - 2, '#7a3a20');
          }
          // a couple of brick courses between the columns
          const courses = Math.max(0, Math.floor(ph / 3) - 1);
          for (let c2 = 0; c2 < courses; c2++) { const yy = y1 - 3 - c2 * 3; R(g, 4, yy, 17, 3, BRICK.base); R(g, 4, yy + 2, 17, 1, BRICK.dark); R(g, 25, yy, 17, 3, BRICK.base); R(g, 25, yy + 2, 17, 1, BRICK.dark); }
          // formwork planks
          R(g, 0, y1 - ph - 1, BW, 1, TIMBER.light);
        }
        if (done) {
          // finished: parapet, water tank, a flag
          R(g, -1, 0, BW + 2, 4, CONC.light); R(g, -1, 0, BW + 2, 1, CONC.hi); R(g, -1, 3, BW + 2, 1, CONC.dark);
        }
      }, '#2a1612');
      place(ctx, bld, BX, SLAB - h + 6 + 0, [4, 1, 0.22]);
      if (done) {
        const tank = build(12, 14, (g) => {
          R(g, 1, 9, 1, 5, TIMBER.dark); R(g, 10, 9, 1, 5, TIMBER.dark);
          R(g, 0, 2, 12, 8, TIMBER.base); R(g, 0, 2, 2, 8, TIMBER.light); R(g, 10, 2, 2, 8, TIMBER.dark); R(g, 0, 4, 12, 1, IRON.dark); R(g, 0, 7, 12, 1, IRON.dark);
          for (let k = 0; k < 3; k++) R(g, 2 + k, 2 - k, 8 - 2 * k, 1, COPPER.base);
        }, OUT);
        place(ctx, tank, BX + 8, topY - 14, [2, 1, 0.22]);
        const flag = build(10, 14, (g) => { R(g, 0, 0, 1, 14, IRON.dark); R(g, 1, 1, 8, 5, '#2f8a5a'); R(g, 1, 1, 8, 1, '#5cbf86'); D(g, 4, 3, GOLD.base); }, OUT);
        place(ctx, flag, BX + BW - 12, topY - 14);
      }
    } else {
      // foundation only: rebar stubs, a stack of blueprints on a sawhorse
      for (let k = 0; k < 6; k++) { const x = BX + 4 + k * 11; R(ctx, x, SLAB - 4, 1, 5, '#7a3a20'); D(ctx, x, SLAB - 5, '#a85a30'); }
    }
    if (!done && full + part > 0) {
      for (let k = 0; k < 7; k++) { const x = BX + 4 + k * 9; if (topY < SLAB - 2) { R(ctx, x, topY - 3, 1, 3, '#7a3a20'); } }
    }

    // scaffolding up both sides to one floor above the work
    if (!done) {
      const scafTop = Math.max(SLAB - NF * FH, topY - FH);
      for (const sx of [BX - 7, BX + BW + 2]) {
        R(ctx, sx, scafTop, 1, SLAB - scafTop + 8, STEEL.light); R(ctx, sx + 4, scafTop, 1, SLAB - scafTop + 8, STEEL.base);
        R(ctx, sx + 1, scafTop, 1, SLAB - scafTop + 8, STEEL.dark); R(ctx, sx + 5, scafTop, 1, SLAB - scafTop + 8, STEEL.dark);
        for (let y = SLAB; y >= scafTop; y -= FH) {
          R(ctx, sx - 1, y, 7, 2, TIMBER.light); R(ctx, sx - 1, y + 1, 7, 1, TIMBER.dark);
          for (let k = 0; k < Math.min(FH - 2, 10); k++) D(ctx, sx + 1 + Math.floor(k * 3 / 10), y - 1 - k, STEEL.dark);
        }
      }
      // crane jib, counter-jib, cab
      const jib = build(92, 14, (g) => {
        // jib (lattice) from x 0 to 70, counter-jib to 92
        R(g, 0, 4, 84, 1, CRANE.light); R(g, 0, 7, 84, 1, CRANE.dark);
        for (let x = 0; x < 84; x += 4) { D(g, x, 5, CRANE.base); D(g, x + 1, 6, CRANE.base); D(g, x + 2, 5, CRANE.dark); }
        R(g, 0, 4, 1, 4, CRANE.dark);
        // tower top and cab
        R(g, 52, 0, 8, 4, CRANE.base); R(g, 52, 0, 8, 1, CRANE.light); R(g, 55, -0, 2, 4, CRANE.dark);
        R(g, 49, 8, 9, 6, CRANE.base); R(g, 49, 8, 9, 1, CRANE.light); R(g, 50, 9, 5, 3, '#9ccbe8'); D(g, 50, 9, '#e6f6ff'); R(g, 57, 9, 1, 5, CRANE.deep);
        // counterweight
        R(g, 80, 6, 12, 7, CONC.base); R(g, 80, 6, 12, 1, CONC.hi); R(g, 80, 12, 12, 1, CONC.dark); R(g, 80, 6, 1, 7, CONC.light);
        // trolley
        R(g, 14, 7, 6, 3, IRON.dark); D(g, 15, 8, IRON.light);
        // tie lines
        for (let k = 0; k < 18; k++) { D(g, 54 - k * 3, Math.round(1 + k * 0.18), '#5a4a30'); }
        if (winter) R(g, 0, 3, 84, 1, P.snow);
      }, '#3a2a10');
      place(ctx, jib, MAST.x - 52, MAST.top - 10, [3, 1, 0.18]);
    }

    // site props: bricks on a pallet, cement bags, lumber, a cone, hard hat
    const props = build(26, 12, (g) => {
      R(g, 0, 9, 12, 3, TIMBER.base); R(g, 0, 9, 12, 1, TIMBER.light); R(g, 2, 11, 2, 1, TIMBER.deep); R(g, 8, 11, 2, 1, TIMBER.deep);
      for (let r2 = 0; r2 < 3; r2++) for (let c2 = 0; c2 < 3; c2++) { R(g, 1 + c2 * 4 - (r2 & 1), 6 - r2 * 2, 4, 2, BRICK.base); D(g, 1 + c2 * 4 - (r2 & 1), 6 - r2 * 2, BRICK.light); D(g, 4 + c2 * 4 - (r2 & 1), 7 - r2 * 2, BRICK.deep); }
      for (let k = 0; k < 2; k++) { R(g, 15 + k * 5, 7 - k * 0, 5, 5, '#d8ccb0'); R(g, 15 + k * 5, 7, 5, 1, '#f2eadc'); R(g, 19 + k * 5, 8, 1, 4, '#a89c80'); D(g, 17 + k * 5, 9, '#5a7ab0'); }
      R(g, 17, 3, 5, 4, '#d8ccb0'); R(g, 17, 3, 5, 1, '#f2eadc'); D(g, 19, 5, '#5a7ab0');
    }, OUT);
    place(ctx, props, 401, 616, [2, 1, 0.25]);
    const lumber = build(18, 7, (g) => {
      for (let k = 0; k < 3; k++) { R(g, k, 4 - k * 2, 18 - k * 2, 2, TIMBER.light); R(g, k, 5 - k * 2, 18 - k * 2, 1, TIMBER.dark); D(g, k, 4 - k * 2, TIMBER.hi); }
      R(g, 4, 0, 1, 7, '#3a3036');
    }, OUT);
    place(ctx, lumber, 452, 620, [2, 1, 0.25]);
    const cone = build(5, 7, (g) => { R(g, 2, 0, 1, 2, '#f07a30'); R(g, 1, 2, 3, 1, '#f2eadc'); R(g, 1, 3, 3, 2, '#f07a30'); R(g, 0, 5, 5, 2, '#c85a20'); D(g, 1, 3, '#f8a060'); }, OUT);
    place(ctx, cone, 482, 612, [1, 1, 0.25]);
    place(ctx, cone, 432, 622, [1, 1, 0.25]);
    const hat = build(6, 3, (g) => { R(g, 1, 0, 4, 2, '#f2c020'); D(g, 1, 0, '#fbe68a'); R(g, 0, 2, 6, 1, '#c89a10'); }, OUT);
    place(ctx, hat, 438, 617);
  }

  function shieldShape(ly, H) {
    // half-width of the shield at row ly (0..H-1)
    if (ly < 1) return 6;
    if (ly < H * 0.55) return 8;
    const t = (ly - H * 0.55) / (H * 0.45);
    return Math.max(0, Math.round(8 * (1 - Math.pow(t, 1.35))));
  }
  function garage(ctx, s) {
    const winter = s === 'winter';
    const pct = CAR.pct == null ? 0 : CAR.pct;
    const full = CAR.pct != null && CAR.pct >= 1;
    const { x: GX, y: GY, w: GW, h: GH } = GAR;
    // concrete apron
    R(ctx, GX + 12, GY + GH, GW - 22, 5, CONC.base); R(ctx, GX + 12, GY + GH, GW - 22, 1, CONC.light);
    const spr = build(GW, GH, (g) => {
      // roof plane (side-gabled, seen from the front-top)
      for (let y = 0; y < 20; y++) {
        const inset = Math.max(0, 3 - y);
        R(g, inset, y, GW - inset * 2, 1, y < 2 ? SLATE.light : SLATE.base);
      }
      for (let y = 3; y < 20; y += 4) {
        R(g, 0, y, GW, 1, SLATE.dark);
        for (let x = ((y >> 2) & 1) * 4; x < GW; x += 8) { R(g, x, y - 3, 1, 3, SLATE.dark); D(g, x + 1, y - 3, SLATE.hi); }
      }
      R(g, 0, 0, GW, 1, SLATE.hi); R(g, 3, 0, GW - 6, 1, SLATE.hi);
      dith(g, GW - 20, 2, 20, 17, SLATE.dark, 1);
      R(g, -1, 19, GW + 2, 2, SLATE.deep);
      if (winter) { R(g, 0, 0, GW, 4, P.snow); dith(g, 0, 4, GW, 6, P.snow, 0); R(g, -1, 19, GW + 2, 1, P.snow); }
      // walls: clapboard
      R(g, 0, 21, GW, GH - 21, SIDING.base);
      for (let y = 23; y < GH; y += 3) R(g, 0, y, GW, 1, SIDING.dark);
      for (let y = 22; y < GH; y += 3) R(g, 0, y, GW, 1, SIDING.light);
      R(g, 0, 21, 2, GH - 21, '#ffffff'); R(g, GW - 2, 21, 2, GH - 21, SIDING.dark);
      dith(g, GW - 14, 21, 12, GH - 21, SIDING.dark, 0);
      // roll-up door
      const dx = 16, dw = GW - 32, dy = 34;
      R(g, dx - 2, dy - 2, dw + 4, GH - dy + 2, '#f4f0e6');
      R(g, dx, dy, dw, GH - dy, '#8e9aa6');
      for (let y = dy + 1; y < GH; y += 3) { R(g, dx, y, dw, 1, '#a8b4c0'); R(g, dx, y + 1, dw, 1, '#6c7884'); }
      R(g, dx, GH - 2, dw, 2, '#4c5864');
      R(g, dx + (dw >> 1) - 3, GH - 6, 6, 1, IRON.dark);
      // window on the left, oil can and tyre stack on the right
      R(g, 4, 30, 9, 9, '#f4f0e6'); R(g, 5, 31, 7, 7, '#3d6488'); R(g, 8, 31, 1, 7, '#f4f0e6'); R(g, 5, 34, 7, 1, '#f4f0e6'); D(g, 6, 32, '#9ccbe8');
      R(g, 4, 39, 9, 1, SIDING.dark);
      // wall lamps
      for (const lx of [dx - 6, dx + dw + 3]) { R(g, lx, 27, 3, 4, '#ffcf6a'); R(g, lx, 26, 3, 1, IRON.dark); D(g, lx, 27, '#fff1b8'); R(g, lx + 1, 31, 1, 1, IRON.dark); }
    }, '#26222c');
    place(ctx, spr, GX, GY, [4, 1, 0.24]);
    // tyre stack and gas can (separate so they cast their own shadows)
    const tyres = build(10, 12, (g) => {
      for (let k = 0; k < 3; k++) { const y = 9 - k * 4; ellipse(g, 5, y, 5, 2, '#26242a'); ellipse(g, 5, y - 1, 4, 1, '#3a3840'); D(g, 3, y - 2, '#6a6870'); }
      ellipse(g, 5, 0, 2, 1, '#121014');
    }, OUT);
    place(ctx, tyres, GX + GW + 1, GY + GH - 12, [2, 1, 0.25]);
    const can = build(6, 7, (g) => { R(g, 0, 1, 6, 6, '#c8402e'); R(g, 0, 1, 1, 6, '#e8604a'); R(g, 3, 0, 2, 1, IRON.dark); R(g, 1, 3, 3, 2, '#e8c04a'); }, OUT);
    place(ctx, can, GX - 7, GY + GH - 7, [1, 1, 0.25]);

    // the shield emblem, mounted on the eave above the door
    const SW = 18, SH = 21;
    const fillRows = Math.round(pct * (SH - 4));
    const shield = build(SW, SH, (g) => {
      const cx = SW / 2;
      for (let y = 0; y < SH; y++) { const hw = shieldShape(y, SH); if (hw <= 0) continue; R(g, Math.round(cx - hw), y, hw * 2, 1, full ? GOLD.base : STEEL.light); }
      // inner field
      for (let y = 2; y < SH - 2; y++) {
        const hw = shieldShape(y, SH) - 2; if (hw <= 0) continue;
        const fromBottom = SH - 3 - y;
        const filled = fromBottom < fillRows;
        for (let x = Math.round(cx - hw); x < Math.round(cx + hw); x++) {
          let c;
          if (filled) {
            c = x < cx - hw + 2 ? SHIELD.light : x > cx + hw - 3 ? SHIELD.dark : SHIELD.base;
            if (fromBottom === fillRows - 1) c = SHIELD.hi;
          } else c = ((x + y) & 1) ? '#232b3d' : '#2b3449';
          D(g, x, y, c);
        }
      }
      // rim shading
      for (let y = 0; y < SH; y++) { const hw = shieldShape(y, SH); if (hw <= 0) continue; D(g, Math.round(cx - hw), y, full ? GOLD.hi : '#e6eef4'); D(g, Math.round(cx + hw) - 1, y, full ? GOLD.dark : STEEL.dark); }
      R(g, 3, 0, SW - 6, 1, full ? GOLD.hi : '#ffffff');
      // tiny car glyph
      const lit = fillRows > 9, carC = lit ? '#f4f8fb' : '#9aa6b8', winC = lit ? SHIELD.dark : '#3a4458';
      R(g, 6, 7, 5, 2, carC); R(g, 4, 9, 10, 2, carC); D(g, 13, 9, '#ffe08a');
      D(g, 7, 8, winC); D(g, 9, 8, winC); R(g, 4, 11, 10, 1, lit ? '#c8d4e4' : '#6a7688');
      R(g, 5, 11, 2, 2, '#141a26'); R(g, 11, 11, 2, 2, '#141a26');
      if (full) { D(g, cx - 1, 4, '#ffffff'); D(g, cx, 5, '#ffffff'); }
    }, '#141a26');
    place(ctx, shield, GX + (GW >> 1) - (SW >> 1), GY + 10, [2, 1, 0.3]);
  }

  function treeSprite(s) {
    const pct = INV.pct;
    const f = foliage(s), winter = s === 'winter';
    if (pct == null || pct <= 0) {
      // sapling, tied to a stake, with a watering can
      return { spr: build(22, 26, (g) => {
        R(g, 13, 2, 2, 22, TIMBER.light); R(g, 14, 2, 1, 22, TIMBER.dark); D(g, 13, 2, TIMBER.hi);
        for (let y = 9; y < 24; y++) D(g, 9 + (y < 15 ? 1 : 0), y, y < 16 ? '#6a8a3a' : TIMBER.dark);
        R(g, 10, 13, 4, 1, '#e8dcb0');
        const lc = winter ? '#7e8f86' : f.base, ld = winter ? '#5f726a' : f.dark;
        R(g, 6, 8, 4, 2, lc); D(g, 6, 9, ld); R(g, 11, 6, 3, 2, lc); D(g, 13, 7, ld); R(g, 8, 4, 3, 3, lc); D(g, 8, 4, f.hi); D(g, 10, 6, ld);
        if (winter) { D(g, 8, 4, P.snow); D(g, 9, 4, P.snow); }
        // watering can
        R(g, 0, 19, 6, 5, '#6a8ab0'); R(g, 0, 19, 6, 1, '#9cbad8'); R(g, 5, 20, 1, 4, '#46607e'); R(g, 6, 18, 2, 1, '#6a8ab0'); D(g, 8, 17, '#6a8ab0');
        R(g, 1, 17, 3, 1, '#46607e');
      }, '#1e2a1a'), ox: 11, oy: 24 };
    }
    const sc = 0.35 + 0.65 * pct;
    const W0 = 76, H0 = 76, cx = 38, by = 72;
    const trunkH = Math.round(8 + 18 * sc), trunkW = Math.max(2, Math.round(2 + 4 * sc));
    const Rc = Math.round(7 + 18 * sc);
    const ccy = by - trunkH - Math.round(Rc * 0.45);
    const fruitN = Math.max(1, Math.round(pct * 14));
    const rnd = S.rng(2027);
    const spr = build(W0, H0, (g) => {
      // trunk and roots
      for (let y = 0; y < trunkH + 4; y++) {
        const w = trunkW + (y < 3 ? 3 - y : 0);
        const x0 = cx - (w >> 1);
        R(g, x0, by - y, w, 1, TIMBER.base); D(g, x0, by - y, TIMBER.light); D(g, x0 + w - 1, by - y, TIMBER.deep);
        if (S.hash(y, 1, 401) > 0.7) D(g, x0 + 1, by - y, TIMBER.dark);
      }
      R(g, cx - trunkW - 2, by, trunkW * 2 + 4, 1, TIMBER.dark);
      // branches
      const bTop = by - trunkH;
      for (let k = 0; k < Math.round(Rc * 0.55); k++) { D(g, cx - 1 - k, bTop - k * 0.8, TIMBER.base); D(g, cx + 1 + k, bTop - k * 0.7, TIMBER.dark); }
      // canopy: a cluster of lobes, each shaded as a little sphere lit from the top-left
      const lobes = [];
      const nb = 4 + Math.round(4 * sc);
      for (let k = 0; k < nb; k++) {
        const a = (k / nb) * Math.PI * 2 + 0.5 + rnd() * 0.4, rr = Rc * (0.42 + rnd() * 0.14);
        lobes.push([cx + Math.cos(a) * Rc * 0.52, ccy + Math.sin(a) * Rc * 0.36, rr]);
      }
      lobes.push([cx - Rc * 0.1, ccy - Rc * 0.28, Rc * 0.55], [cx + Rc * 0.12, ccy + Rc * 0.05, Rc * 0.58]);
      const tones = [f.dark, f.base, f.light, f.hi];
      const x0 = Math.floor(cx - Rc * 1.3), x1 = Math.ceil(cx + Rc * 1.3), y0 = Math.floor(ccy - Rc * 1.1), y1 = Math.ceil(ccy + Rc * 1.0);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        let best = -9;
        const edge = (S.hash(x, y, 404) - 0.5) * 1.6;
        for (const [lx, ly, r] of lobes) {
          const dx = x - lx, dy = y - ly, rr = r + edge;
          if (dx * dx + dy * dy > rr * rr) continue;
          const nx = dx / r, ny = dy / r;
          const l = -(nx * 0.55 + ny * 0.8) + (ccy - ly) / Rc * 0.6 - (nx * nx + ny * ny) * 0.35;
          if (l > best) best = l;
        }
        if (best === -9) continue;
        const q = best * 1.5 + 1.35 + (bayer(x, y) - 0.5) * 0.7 + (S.hash(x, y, 405) - 0.5) * 0.5;
        D(g, x, y, tones[clamp(Math.floor(q), 0, 3)]);
      }
      // leaf flecks and the alternate leaf colour
      for (let k = 0; k < Rc * 3; k++) {
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * Rc * 0.85;
        const x = Math.round(cx + Math.cos(a) * rr), y = Math.round(ccy + Math.sin(a) * rr * 0.75);
        const top = (x - cx) + (y - ccy) < -Rc * 0.2;
        D(g, x, y, top ? f.hi : f.alt); if (!top) D(g, x + 1, y + 1, f.dark);
      }
      // a branch fork showing through the lower canopy
      for (let k = 0; k < Rc * 0.5; k++) { D(g, cx - 1 - Math.round(k * 0.8), by - trunkH - k, TIMBER.dark); D(g, cx + 1 + Math.round(k * 0.6), by - trunkH - k, TIMBER.deep); }
      if (winter) for (const [x, y, r] of lobes) { const w = Math.round(r * 0.75); R(g, Math.round(x - w), Math.round(y - r + 1), w * 2, 1, P.snow); R(g, Math.round(x - w + 2), Math.round(y - r), Math.max(1, w * 2 - 4), 1, P.snow); }
      // golden fruit (coins) hanging in the lower half of the canopy
      const spots = [];
      let tries = 0;
      while (spots.length < fruitN && tries++ < 400) {
        const a = rnd() * Math.PI * 2, rr = (0.3 + rnd() * 0.6) * Rc;
        const x = Math.round(cx + Math.cos(a) * rr), y = Math.round(ccy + Math.abs(Math.sin(a)) * rr * 0.65 - Rc * 0.15);
        if (spots.some(([sx, sy]) => Math.abs(sx - x) < 5 && Math.abs(sy - y) < 5)) continue;
        spots.push([x, y]);
      }
      for (const [x, y] of spots) {
        D(g, x, y - 2, TIMBER.dark);
        R(g, x - 2, y - 1, 5, 3, '#4a2c08'); R(g, x - 1, y - 2, 3, 5, '#4a2c08');
        R(g, x - 1, y - 1, 3, 3, GOLD.base); D(g, x - 1, y - 1, '#ffffff'); D(g, x, y - 1, GOLD.light); D(g, x + 1, y + 1, GOLD.dark); D(g, x, y + 1, GOLD.dark); D(g, x + 1, y, GOLD.dark);
      }
      tree._fruit = spots.map(([x, y]) => [x - cx, y - by]);
      if (pct >= 1) for (let k = 0; k < 5; k++) { const x = cx - 14 + k * 7, y = by + 1; R(g, x, y - 1, 2, 1, GOLD.base); D(g, x, y - 1, GOLD.hi); }
    }, '#24160e');
    return { spr, ox: cx, oy: by };
  }
  const tree = { _fruit: [] };

  function investTree(ctx, s) {
    const winter = s === 'winter';
    // planter ring of stones with soil
    const ring = build(36, 12, (g) => {
      ellipse(g, 18, 6, 17, 5, GRANITE.dark);
      ellipse(g, 18, 5, 17, 5, GRANITE.light);
      ellipse(g, 18, 5, 14, 3, winter ? P.snow : '#4a3020');
      if (!winter) dith(g, 6, 3, 24, 4, '#5e3c26', 0);
      for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; const x = Math.round(18 + Math.cos(a) * 16), y = Math.round(5 + Math.sin(a) * 4.6); D(g, x, y, GRANITE.dark); D(g, x - 1, y - 1, GRANITE.hi); }
    }, '#2a2630');
    place(ctx, ring, TREE.x - 18, TREE.base - 6, [2, 1, 0.22]);
    const { spr, ox, oy } = treeSprite(s);
    place(ctx, spr, TREE.x - ox, TREE.base - oy - 1, [3, 1, 0.2]);
    // little brass plaque on a stake
    const plaque = build(8, 10, (g) => { R(g, 3, 4, 1, 6, TIMBER.dark); R(g, 0, 0, 8, 5, GOLD.dark); R(g, 0, 0, 8, 1, GOLD.light); R(g, 1, 1, 6, 3, GOLD.base); R(g, 2, 2, 4, 1, GOLD.deep); }, OUT);
    place(ctx, plaque, TREE.x + 20, TREE.base - 2, [1, 1, 0.25]);
  }

  function signpost(ctx, s) {
    // "Savings Row" sign with three painted icons: house, shield, tree
    const spr = build(18, 24, (g) => {
      R(g, 2, 10, 2, 14, TIMBER.base); R(g, 2, 10, 1, 14, TIMBER.light); R(g, 14, 10, 2, 14, TIMBER.base); R(g, 15, 10, 1, 14, TIMBER.dark);
      R(g, 0, 0, 18, 12, TIMBER.dark); R(g, 0, 0, 18, 11, TIMBER.light); R(g, 1, 1, 16, 9, '#efe2c2');
      // house
      R(g, 2, 5, 4, 4, '#a9573c'); D(g, 3, 4, '#a9573c'); D(g, 4, 4, '#a9573c'); D(g, 3, 3, '#82402e'); D(g, 4, 3, '#82402e'); D(g, 3, 7, '#3d6488');
      // shield
      R(g, 7, 3, 4, 4, SHIELD.base); R(g, 8, 7, 2, 1, SHIELD.base); D(g, 7, 3, SHIELD.light); D(g, 10, 6, SHIELD.dark);
      // tree
      R(g, 12, 3, 4, 3, '#4f8f33'); D(g, 12, 3, '#69a845'); R(g, 13, 6, 2, 2, TIMBER.base); D(g, 14, 4, GOLD.base);
      if (s === 'winter') R(g, 0, 0, 18, 1, P.snow);
    }, OUT);
    place(ctx, spr, 548, 436, [2, 1, 0.25]);
  }

  function drawSavings(ctx) {
    const s = season(), winter = s === 'winter';
    apartment(ctx, s);
    garage(ctx, s);
    investTree(ctx, s);
    signpost(ctx, s);
    lampPost(ctx, 504, 514, winter);
    lampPost(ctx, 566, 514, winter);
  }

  /* ============================================================ register statics */
  S.registerStatic(6, (ctx) => drawGround(ctx));
  S.registerStatic(12, (ctx) => {
    const s = season();
    const pts = RAILS.map(([x, y]) => [x * T + 8, y * T + 8]);
    if (pts.length > 1) drawRails(ctx, pts, s);
    // spur from the turntable into the mine mouth
    drawRails(ctx, [[TURN.x, TURN.y], [EX, TURN.y], [EX, 462]], s);
    drawTurntable(ctx, TURN.x, TURN.y);
    const w = pts[pts.length - 1];
    if (w) drawBuffer(ctx, w[0] - 2, w[1]);
  });
  S.registerStatic(21, (ctx) => drawMine(ctx));
  S.registerStatic(30, (ctx) => drawSavings(ctx));

  /* ============================================================ lights */
  S.addLight({ x: EX + 24, y: 440, r: 34, color: P.lantern, intensity: 0.9, flicker: true });
  S.addLight({ x: EX, y: 446, r: 18, color: '#ff9a40', intensity: 0.45, flicker: true });
  S.addLight({ x: COT.x + 46, y: COT.y + 34, r: 24, color: P.lanternGlow, intensity: 0.75, flicker: true });
  S.addLight({ x: COT.x + 13, y: COT.y + 31, r: 18, color: P.lanternGlow, intensity: 0.6 });
  S.addLight({ x: VAULT.x + 13, y: VAULT.y + 23, r: 26, color: P.lantern, intensity: 0.8, flicker: true });
  if (INCOME > 0) S.addLight({ x: VDOOR.cx, y: VDOOR.cy + 6, r: 12 + Math.round(coinF * 14), color: P.gold, intensity: 0.35 + coinF * 0.35 });
  for (const [x, y] of [[884, 494], [940, 494], [716, 494], [504, 514], [566, 514]]) S.addLight({ x, y: y - 18, r: 28, color: P.lanternGlow, intensity: 0.8, flicker: true });
  S.addLight({ x: GAR.x + 13, y: GAR.y + 29, r: 18, color: P.lanternGlow, intensity: 0.6 });
  S.addLight({ x: GAR.x + GAR.w - 12, y: GAR.y + 29, r: 18, color: P.lanternGlow, intensity: 0.6 });
  if (INV.pct > 0) S.addLight({ x: TREE.x, y: TREE.base - 26, r: 14 + Math.round(INV.pct * 18), color: P.gold, intensity: 0.2 + INV.pct * 0.35 });
  if (APT.pct != null && APT.pct >= 1) S.addLight({ x: APTB.x + APTB.w / 2, y: APTB.slab - 20, r: 40, color: P.lanternGlow, intensity: 0.6 });
  if (GROWTH >= 2) S.addLight({ x: HEAD.x + 34, y: HEAD.base - 9, r: 16, color: P.lanternGlow, intensity: 0.6 });
  if (GROWTH >= 3) S.addLight({ x: SMELT.x + 22, y: SMELT.base - 8, r: 34, color: '#ff8a3a', intensity: 0.9, flicker: true, nightOnly: false });

  /* ============================================================ hotspots */
  const LM = S.landmarks;
  const lab = (k, extra) => ((LM[k] && LM[k].label) || k) + (extra ? ' · ' + extra : '');
  S.addHotspot({ id: 'landmark:mineEntrance', kind: 'landmark', landmark: 'mineEntrance', biome: 'mine', agent: AGENT, label: lab('mineEntrance'), x: EX - 26, y: 418, w: 58, h: 50, priority: 1 });
  S.addHotspot({ id: 'landmark:vault', kind: 'landmark', landmark: 'vault', biome: 'mine', agent: AGENT, label: lab('vault', INCOME > 0 ? '$' + Math.round(INCOME) + ' in this month' : 'empty this month'), x: VAULT.x - 2, y: VAULT.y - 2, w: VAULT.w + 24, h: VAULT.h + 16, priority: 1 });
  S.addHotspot({ id: 'landmark:apartment', kind: 'landmark', landmark: 'apartment', biome: 'savings', agent: AGENT, label: lab('apartment', fmtPct(APT)), x: 400, y: 510, w: 96, h: 120, priority: 1 });
  S.addHotspot({ id: 'landmark:garage', kind: 'landmark', landmark: 'garage', biome: 'savings', agent: AGENT, label: lab('garage', fmtPct(CAR)), x: GAR.x - 8, y: GAR.y - 2, w: GAR.w + 20, h: GAR.h + 8, priority: 1 });
  S.addHotspot({ id: 'landmark:investTree', kind: 'landmark', landmark: 'investTree', biome: 'savings', agent: AGENT, label: lab('investTree', fmtPct(INV)), x: TREE.x - 30, y: TREE.base - 70, w: 60, h: 80, priority: 1 });

  /* ============================================================ dynamic */
  // Glints on vault coins (positions in world px).
  const COIN_GLINTS = [];
  if (INCOME > 0) {
    COIN_GLINTS.push([VDOOR.cx - 3, VDOOR.cy + 6], [VDOOR.cx + 2, VDOOR.cy + 8]);
    if (coinF > 0.3) COIN_GLINTS.push([VAULT.x + 16, VAULT.y + VAULT.h + 3]);
    if (coinF > 0.45) COIN_GLINTS.push([VDOOR.cx + 8, VDOOR.cy + 1]);
  }
  const sparkle = (ctx, x, y, k, gold) => {
    // k 0..1: 1 = brightest. 4-point star.
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, 1, 1);
    if (k > 0.45) { ctx.fillStyle = gold ? GOLD.light : '#ffd8b0'; ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1); ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x, y + 1, 1, 1); }
    if (k > 0.8) { ctx.fillStyle = 'rgba(255,246,207,0.7)'; ctx.fillRect(x - 2, y, 1, 1); ctx.fillRect(x + 2, y, 1, 1); ctx.fillRect(x, y - 2, 1, 1); ctx.fillRect(x, y + 2, 1, 1); }
  };
  const SPEED = RM ? 0.35 : 1;
  const sparks = RM ? SPARKS.filter((_, i) => i % 3 === 0) : SPARKS;
  S.registerDynamic(200, (ctx, t) => {
    const tt = t * SPEED;
    // ore vein sparkles
    for (const sp of sparks) {
      const v = Math.sin(tt * sp.sp + sp.ph);
      if (v > 0.9) sparkle(ctx, sp.x, sp.y, (v - 0.9) / 0.1, sp.gold);
    }
    // coin glints in and outside the vault
    for (let i = 0; i < COIN_GLINTS.length; i++) {
      const v = Math.sin(tt * 1.3 + i * 2.1);
      if (v > 0.93) sparkle(ctx, COIN_GLINTS[i][0], COIN_GLINTS[i][1], (v - 0.93) / 0.07, true);
    }
    // gold fruit glints
    const fr = tree._fruit;
    if (fr && fr.length && INV.pct > 0) {
      const i = Math.floor(tt * 0.7) % fr.length, ph = (tt * 0.7) % 1;
      if (ph < 0.35) sparkle(ctx, TREE.x + fr[i][0] - 1, TREE.base - 1 + fr[i][1] - 1, 1 - ph / 0.35, true);
    }
    // lantern flames
    const fl = RM ? 0 : (Math.sin(t * 9.1) + Math.sin(t * 13.7)) * 0.5;
    ctx.fillStyle = fl > 0.3 ? '#fff6cf' : '#ffe08a';
    ctx.fillRect(EX + 24, 438 + (fl > 0.6 ? 0 : 1), 1, 1);
    ctx.fillRect(VAULT.x + 12, VAULT.y + 21 + (fl < -0.5 ? 1 : 0), 1, 1);
    ctx.fillRect(COT.x + 46, COT.y + 32 + (fl > 0.2 ? 0 : 1), 1, 1);
    // crane hook and its load, swaying gently
    if (APT.pct == null || APT.pct < 1) {
      const trolleyX = MAST.x - 52 + 17, jibY = MAST.top - 10 + 9;
      const topY = APTB.slab - (APT.pct == null ? 0 : Math.round(APT.pct * APTB.floors * APTB.fl));
      const hookY = Math.max(jibY + 10, Math.min(topY - 22, APTB.slab - 30));
      const sway = RM ? 0 : Math.round(Math.sin(t * 0.9) * 1.2);
      ctx.fillStyle = '#2a2830';
      for (let y = jibY; y < hookY; y++) ctx.fillRect(trolleyX + Math.round(sway * (y - jibY) / Math.max(1, hookY - jibY)), y, 1, 1);
      const hx = trolleyX + sway;
      ctx.fillStyle = IRON.dark; ctx.fillRect(hx - 1, hookY, 3, 2); ctx.fillStyle = IRON.light; ctx.fillRect(hx, hookY + 2, 1, 2);
      // a pallet of bricks on slings
      ctx.fillStyle = '#5a4a30'; ctx.fillRect(hx - 4, hookY + 3, 1, 3); ctx.fillRect(hx + 4, hookY + 3, 1, 3);
      ctx.fillStyle = BRICK.base; ctx.fillRect(hx - 5, hookY + 6, 11, 4);
      ctx.fillStyle = BRICK.light; ctx.fillRect(hx - 5, hookY + 6, 11, 1);
      ctx.fillStyle = BRICK.deep; ctx.fillRect(hx - 5, hookY + 8, 11, 1); ctx.fillRect(hx, hookY + 6, 1, 4);
      ctx.fillStyle = TIMBER.base; ctx.fillRect(hx - 6, hookY + 10, 13, 2);
      ctx.fillStyle = OUT; ctx.fillRect(hx - 6, hookY + 12, 13, 1);
    }
  });

  // chimney smoke (cottage always; smelter at growth 3)
  const SMOKES = [{ x: COT.x + 42, y: COT.y - 1, n: RM ? 2 : 5, sp: 0.18 }];
  if (GROWTH >= 3) SMOKES.push({ x: SMELT.x + 34, y: SMELT.base - 55, n: RM ? 3 : 8, sp: 0.26 });
  S.registerDynamic(400, (ctx, t) => {
    const tt = t * SPEED;
    for (const sm of SMOKES) {
      for (let k = 0; k < sm.n; k++) {
        const ph = (tt * sm.sp + k / sm.n) % 1;
        const y = sm.y - ph * 30, x = sm.x + Math.sin(ph * 5 + k) * 2 + ph * 7;
        const r = 1 + Math.round(ph * 3), a = 0.5 * (1 - ph);
        ctx.fillStyle = `rgba(214,206,200,${a.toFixed(3)})`;
        ctx.fillRect(Math.round(x - r), Math.round(y - r + 1), r * 2 + 1, r * 2 - 1);
        ctx.fillRect(Math.round(x - r + 1), Math.round(y - r), r * 2 - 1, r * 2 + 1);
        ctx.fillStyle = `rgba(255,255,255,${(a * 0.6).toFixed(3)})`;
        ctx.fillRect(Math.round(x - r + 1), Math.round(y - r + 1), Math.max(1, r), 1);
      }
    }
  });
})();
