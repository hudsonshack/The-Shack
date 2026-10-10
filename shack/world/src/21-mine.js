/* The Shack v2 — COPPERHOLD (island 'mine'): Grit Copperpot, ledger-fi (money).
 *
 * Copperhold is a canyon-rock island: an ochre mesa with layered strata along
 * its north rim, the mine dug into it, Grit's stone cottage built into the
 * cliff, the vault on the south rim, three savings crystals growing out of the
 * ground, a rail station on the west rim and the sky-rail bridge across space
 * to Clockspire.
 *
 * Owns:
 *   static 6    ground overlay: the strata ridge (mesa) along the north rim with
 *               ore veins, bedrock slabs, the gravel mine yard, the stream bed
 *   static 21   mine entrance (timber frame, lamp), second adit (growth >= 1),
 *               Grit's cottage, rail station (house, signal, buffer, abutment,
 *               rails), spring outcrop, the three savings crystals with their
 *               progress rings, the vault, yard props, growth structures
 *   dyn 100     stream ripples and the waterfall off the south rim   {island:'mine'}
 *   dyn 200     ore / coin / crystal sparkles, lantern flames           {island:'mine'}
 *   dyn 200     the sky-rail bridge (no island: each column follows S.bobBetween;
 *               the span over space is tinted with S.atmo.sky() at dusk and night)
 *   dyn 400     chimney smoke                                           {island:'mine'}
 *   dyn 700     crystal glow, mine-mouth glow                           {island:'mine'}
 *   dyn 700     bridge lantern glow at night (no island)
 *
 * Data (never invented):
 *   vault coins   = metrics('ledger-fi').month_income (an empty vault at 0)
 *   crystals      = metrics('ledger-fi').savings[...] current / target per goal:
 *                   Invest (gold), Car insurance (blue), Apartment fund (violet).
 *                   No target -> a small seed crystal with a dim glow and a ring of
 *                   plain stones; otherwise height, facets and glow grow with the
 *                   percentage and that many of the 12 ring stones light up.
 *   growth 0..3   = S.status.mine.growth (second adit, headframe, smelter, carts)
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S || !S.islands || !S.islands.mine) return;

  const ISL = 'mine';
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
  const TIMBER = { deep: '#3a2110', dark: '#5a3618', base: '#7d4f26', light: '#a06a36', hi: '#c48d50' };
  const IRON = { deep: '#24222a', dark: '#3c3a44', base: '#5d5b66', light: '#8c8a96', hi: '#c4c4cc' };
  const GRANITE = { deep: '#3a3640', dark: '#58535e', base: '#7a7480', light: '#9d97a0', hi: '#c2bcc0' };
  const COPPER = { deep: '#5a2a14', dark: '#8a4320', base: '#b8642e', light: '#de8a4a', hi: '#f6b77a' };
  const VERDI = { dark: '#3f7f6c', base: '#5fae96', light: '#8fd4bc' };
  const GOLD = { deep: '#7a5414', dark: P.goldDark, base: P.gold, light: '#f8e08a', hi: '#fff6cf' };
  const BRICK = { deep: '#5a2a20', dark: '#82402e', base: '#a9573c', light: '#c87452', hi: '#e09a74' };
  const PLASTER = { dark: '#c4b08c', base: '#e6d6b4', light: '#f6ecd6' };
  const BURLAP = { dark: '#7d6040', base: '#a8865a', light: '#c9a878' };
  const DOOR_GREEN = { dark: '#244a2c', base: '#356b3e', light: '#4f9156' };
  const LAMP = { glass: '#ffcf6a', hot: '#fff1b8', warm: '#c87a2a' };
  const WATER = { deep: '#2c6a8e', base: '#3f8fb8', light: '#7cc6e4', hi: '#c8eef8', foam: '#eef9fc' };
  const SHADOW_INK = '#140f1e';
  /** The three savings gems: deep, dark, base, light, hi, glow, outline. */
  const GEMS = {
    gold:   { deep: '#7a4a0c', dark: '#b9800f', base: '#f2b92a', light: '#ffd95e', hi: '#fff5c4', glow: '#ffd36a', out: '#3a2406' },
    blue:   { deep: '#123a78', dark: '#1d5cb0', base: '#3a8cea', light: '#7cc0ff', hi: '#dcf2ff', glow: '#7cc4ff', out: '#0a1a3a' },
    violet: { deep: '#3e1670', dark: '#6328a8', base: '#9452e0', light: '#c294ff', hi: '#f0e2ff', glow: '#c08cff', out: '#1e0a36' },
  };

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
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
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
  function goal(keys) {
    const list = Array.isArray(MET.savings) ? MET.savings : [];
    const g = list.find((s) => s && typeof s.name === 'string' && keys.some((k) => s.name.toLowerCase().indexOf(k) >= 0));
    if (!g) return { pct: null, current: 0, target: null, name: null };
    const target = num(g.target), cur = Math.max(0, num(g.current));
    return { pct: target > 0 ? clamp(cur / target, 0, 1) : null, current: cur, target: target > 0 ? target : null, name: g.name };
  }
  const money = (v) => '$' + Math.round(v).toLocaleString('en-US');
  function goalText(gl) {
    if (!gl.name) return 'no savings goal yet';
    if (gl.target == null) return gl.current > 0 ? money(gl.current) + ' saved, no target yet' : 'no target yet';
    return money(gl.current) + ' of ' + money(gl.target) + ' (' + Math.round(gl.pct * 100) + '%)';
  }

  /* ============================================================ GEOMETRY (native px) */
  const LM = S.landmarks;
  const RIDGE = { x0: 974, x1: 1188, foot: 512 };
  const MOUTH = { x: 1152, ox: 1120, oy: 458 };           // mine entrance sprite origin (64 x 56)
  const COT = { x: 994, y: 460 };                           // Grit's cottage sprite origin (58 x 54)
  const ADIT = { x: 1092, base: 512 };                      // second adit (growth >= 1)
  const TRACK = { y: 536, x0: 876, buf: 936 };              // rails on the island (rail centre line)
  const STN = { x: 916, w: 50, base: 527 };                 // station house
  const SIGNAL = { x: 906, base: 527 };
  const SPRING = { x: 904, y: 600 };                        // spring outcrop (water mouth)
  const STREAM = [[904, 603], [907, 611], [906, 620], [901, 629], [899, 638], [901, 647], [905, 656], [907, 666], [906, 677]];
  const LIP = { x: 906, y: 677 };                           // where the stream pours off the south rim
  const CRYS = [
    { key: 'invest', lm: 'crystalInvest', x: 947, base: 641, gem: GEMS.gold, goal: goal(['invest']) },
    { key: 'car', lm: 'crystalCar', x: 994, base: 641, gem: GEMS.blue, goal: goal(['car']) },
    { key: 'home', lm: 'crystalHome', x: 1041, base: 641, gem: GEMS.violet, goal: goal(['apartment', 'home', 'house']) },
  ];
  const VAULT = { x: 1066, y: 616, w: 84, h: 50 };
  const VDOOR = { cx: VAULT.x + 32, cy: VAULT.y + 26, r: 14 };
  const HEAD = { x: 1194, base: 604 };                      // headframe (growth >= 2)
  const SMELT = { x: 1170, base: 670 };                     // smelter (growth >= 3)

  const RAILS = (S.nav && Array.isArray(S.nav.rails) ? S.nav.rails : []).filter((p) => Array.isArray(p) && p.length === 2);

  /* --------------------------------------------------- ridge profile */
  const NCOL = RIDGE.x1 - RIDGE.x0;
  const RTOP = new Int16Array(NCOL), RCAP = new Int16Array(NCOL);
  const gauss = (x, c, w) => Math.exp(-((x - c) * (x - c)) / (2 * w * w));
  for (let i = 0; i < NCOL; i++) {
    const x = RIDGE.x0 + i;
    const k = smooth(clamp((x - RIDGE.x0) / 26, 0, 1)) * smooth(clamp((RIDGE.x1 - x) / 20, 0, 1));
    const raw = 452 - gauss(x, 1150, 26) * 24 - gauss(x, 1026, 22) * 10 - gauss(x, 1094, 10) * 6 - (vnoise(x * 0.08, 0.5, 21) - 0.5) * 6 - (vnoise(x * 0.3, 1.5, 22) - 0.5) * 2;
    RTOP[i] = Math.round(RIDGE.foot - k * (RIDGE.foot - raw));
    RCAP[i] = Math.round(3 + 3 * vnoise(x * 0.11, 3.1, 23));
  }
  const ridgeTop = (x) => { const i = Math.round(x) - RIDGE.x0; return i >= 0 && i < NCOL ? RTOP[i] : RIDGE.foot; };
  const ridgeH = (x) => RIDGE.foot - ridgeTop(x);

  // Strata bands relative to the ridge foot (going up), varying thickness.
  const BANDS = [];
  (function () {
    const seq = ['rust', 'deep', 'ochre', 'sand', 'rust', 'cream', 'ochre', 'deep', 'sand', 'rust', 'ochre', 'cream', 'rust', 'sand', 'ochre'];
    const rnd = S.rng(4411);
    let y = -6;
    for (const n of seq) { const th = 4 + Math.floor(rnd() * 5); BANDS.push({ y0: y, y1: y + th, ramp: STRATA[n] }); y += th; }
  })();
  function bandAt(yr) { for (let i = 0; i < BANDS.length; i++) if (yr < BANDS[i].y1) return i; return BANDS.length - 1; }

  /** Where structures cover the ridge face: [x0, x1, topY] (veins and pockmarks keep clear). */
  const FACE_BLOCK = [[COT.x - 2, COT.x + 60, 466], [ADIT.x - 15, ADIT.x + 15, 486], [MOUTH.ox + 6, MOUTH.ox + 60, 458]];
  const faceFree = (x, y) => !FACE_BLOCK.some(([a, b, ty]) => x >= a && x <= b && y >= ty - 3);

  /* --------------------------------------------------- ore veins on the ridge face */
  const VEINS = [], SPARKS = [];
  (function () {
    const rnd = S.rng(7781 + GROWTH);
    const count = 7 + GROWTH * 3;
    let tries = 0;
    while (VEINS.length < count && tries++ < 600) {
      const x = RIDGE.x0 + 14 + Math.floor(rnd() * (NCOL - 28));
      if (ridgeH(x) < 24) continue;
      const top = ridgeTop(x);
      const y = top + 8 + Math.floor(rnd() * (RIDGE.foot - top - 14));
      const len = 6 + Math.floor(rnd() * 7), dir = rnd() < 0.5 ? 1 : -1, slope = 0.3 + rnd() * 0.5;
      const pts = [];
      let ok = true;
      for (let k = 0; k < len; k++) {
        const px = x + k, py = Math.round(y + dir * k * slope + Math.sin(k * 0.9) * 0.8);
        if (!faceFree(px, py) || py < ridgeTop(px) + 6 || py > RIDGE.foot - 4) { ok = false; break; }
        pts.push([px, py]);
      }
      if (!ok || VEINS.some((v) => Math.abs(v.pts[0][0] - x) < 16 && Math.abs(v.pts[0][1] - y) < 10)) continue;
      const gold = rnd() < 0.55;
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
    rpx(RIDGE.x0, 448, NCOL, RIDGE.foot - 448 + 14);          // the ridge, cottage, adit, mouth and yard
    rpx(STN.x - 14, 480, STN.w + 20, 48);                      // station house and signal
    rpx(SPRING.x - 14, SPRING.y - 14, 28, LIP.y - SPRING.y + 18); // spring and stream
    rpx(CRYS[0].x - 22, 578, CRYS[2].x - CRYS[0].x + 44, 104); // crystal row
    rpx(VAULT.x - 4, VAULT.y - 4, VAULT.w + 24, 70);           // vault, lectern, coin spill
    rpx(1088, 562, 48, 14);                                    // yard pocket between the paths
    rpx(1170, 532, 46, 146);                                   // east strip (growth sites)
  })();

  /* ============================================================ GROUND OVERLAY (6) */
  function drawRidge(ctx, s) {
    const winter = s === 'winter';
    const X0 = RIDGE.x0, Y0 = 410, w = NCOL, h = RIDGE.foot + 2 - Y0;
    const [c, g] = mk(w, h);
    const im = g.createImageData(w, h), d = im.data;
    const rampCache = BANDS.map((b) => b.ramp.map(rgb));
    const lipHi = rgb('#f2dcac'), fis = rgb('#3a1a12'), aoC = rgb('#4a2a1a'), edge = rgb('#2a140c');
    const snow = rgb(P.snow), snowS = rgb('#c9d6e2');
    const capG = winter ? [rgb('#e3ebf1'), rgb('#f4f8fb'), rgb('#c6d3dc')] : [rgb('#c9a75a'), rgb('#e0c274'), rgb('#9a7a3c')];
    const fisCol = new Uint8Array(w);
    for (let x = 0; x < w; x++) fisCol[x] = S.hash(X0 + x, 0, 31) > 0.94 ? 1 : 0;
    const set = (i, col) => { d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; };
    const mixA = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    for (let x = 0; x < w; x++) {
      const wx = X0 + x, top = RTOP[x], hh = RIDGE.foot - top;
      if (hh < 2) continue;
      const cap = Math.min(RCAP[x], Math.max(1, hh >> 2));
      const slope = ridgeTop(wx + 2) - ridgeTop(wx - 2);      // >0: falling to the right (lit side faces left)
      for (let wy = top - 1; wy <= RIDGE.foot; wy++) {
        const y = wy - Y0, i = (y * w + x) * 4;
        if (y < 0) continue;
        const dd = wy - top;
        if (dd < 0) { set(i, edge); continue; }                       // silhouette outline against space
        if (dd < cap) {                                                // mesa top: dry grass / snow cap
          const q = (S.hash(wx, wy, 40) + (dd === 0 ? 0.5 : 0) - (slope > 0 ? 0.25 : 0));
          set(i, dd === 0 ? capG[1] : q > 0.6 ? capG[1] : q > 0.25 ? capG[0] : capG[2]);
          continue;
        }
        const fd = dd - cap, fh = Math.max(1, hh - cap);
        const wave = Math.round(2.5 * Math.sin(wx * 0.043) + 2 * vnoise(wx * 0.09, 0.3, 7));
        const yr = RIDGE.foot - wy + wave;
        const b = bandAt(yr), ramp = rampCache[b];
        const facet = Math.floor((wx + vnoise(wy * 0.12, wx * 0.02, 27) * 9) / 13);
        const fShade = (facet & 1) ? -0.3 : 0.12;
        let tv = 1.35 - 1.0 * (fd / fh) + fShade - slope * 0.12 + (vnoise(wx * 0.18, wy * 0.12, 8) - 0.5) * 0.9 + (bayer(wx, wy) - 0.5) * 0.75;
        let col = ramp[clamp(Math.round(tv), 0, 2)];
        if (bandAt(yr + 1) !== b) col = ramp[2];                 // lit ledge on top of each layer
        else if (bandAt(yr - 1) !== b) col = ramp[0];            // shade under the ledge
        const fOn = vnoise(wx * 0.5, wy * 0.16, 32) > 0.58;
        if (fisCol[x] && fOn && fd > 2) col = fis;
        else if (x > 0 && fisCol[x - 1] && fOn && fd > 2) col = ramp[2];
        if (fd === 0) col = lipHi; else if (fd === 1) col = ramp[2];
        if (wy >= RIDGE.foot - 2) col = mixA(col, aoC, 0.55);
        if (winter && (fd === 0 || (bandAt(yr + 1) !== b && S.hash(wx, wy, 34) > 0.35))) col = fd === 0 ? snow : snowS;
        set(i, col);
      }
    }
    g.putImageData(im, 0, 0);
    ctx.drawImage(c, X0, Y0);
    ridgeDetail(ctx, s);
  }

  function ridgeDetail(ctx, s) {
    const winter = s === 'winter';
    const gA = winter ? P.snow : '#d8bf6c', gB = winter ? '#c9d6e2' : '#a8903c', gD = winter ? '#9fb2c2' : '#6e5a26';
    for (let x = RIDGE.x0 + 2; x < RIDGE.x1 - 2; x++) {
      const top = ridgeTop(x), hh = RIDGE.foot - top;
      if (hh < 8) continue;
      // tufts of dry grass on the mesa top, some overhanging the edge
      if (!winter && S.hash(x, 2, 60) > 0.72) { D(ctx, x, top - 1, gA); if (S.hash(x, 3, 60) > 0.6) D(ctx, x, top - 2, gB); }
      const cap = RCAP[x - RIDGE.x0];
      const L = S.hash(x, 4, 60) > 0.7 ? 1 + Math.floor(S.hash(x, 5, 60) * 3) : 0;
      for (let k = 0; k < L; k++) D(ctx, x, top + cap + k, k === L - 1 ? gD : gB);
      if (winter && S.hash(x, 6, 60) > 0.8) D(ctx, x, top + cap + 1, '#e3ecf2');
    }
    // pockmark caves, ledge tufts
    const rnd = S.rng(5150);
    for (let k = 0; k < 30; k++) {
      const x = RIDGE.x0 + 10 + Math.floor(rnd() * (NCOL - 20)), hh = ridgeH(x);
      if (hh < 26) continue;
      const y = ridgeTop(x) + 9 + Math.floor(rnd() * (hh - 16));
      if (!faceFree(x, y) || !faceFree(x + 3, y)) continue;
      if (k % 3 === 0) { R(ctx, x, y, 3, 2, '#2a120c'); D(ctx, x, y - 1, STRATA.cream[2]); D(ctx, x + 1, y - 1, STRATA.cream[2]); D(ctx, x + 3, y + 1, STRATA.rust[0]); }
      else if (!winter) { D(ctx, x, y, '#8a7a34'); D(ctx, x + 1, y - 1, '#b8a04a'); D(ctx, x + 2, y, '#8a7a34'); }
      else R(ctx, x, y, 3, 1, P.snow);
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
    // talus along the foot
    for (let x = RIDGE.x0 + 4; x < RIDGE.x1 - 2; x += 3) {
      if (ridgeH(x) < 8 || !faceFree(x, RIDGE.foot) || S.hash(x, 7, 61) < 0.45) continue;
      const y = RIDGE.foot + Math.floor(S.hash(x, 8, 61) * 3) - 1, r = 1 + Math.floor(S.hash(x, 9, 61) * 2.4);
      rock(ctx, x, y, r, S.hash(x, 10, 61) > 0.6 ? STRATA.rust : STRATA.sand, winter);
    }
    for (const [x, wdt] of [[RIDGE.x0 + 16, 8], [RIDGE.x1 - 14, 7]]) talusCone(ctx, x, RIDGE.foot + 2, wdt, winter);
  }
  function talusCone(ctx, x, y, w, winter) {
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

  /** A low shelf of exposed sandstone bedrock: lit top plate plus a 2-3 px strata face on its south side. */
  function slab(ctx, cx, cy, rx, ry, seed, winter) {
    const inside = new Set(), pts = [];
    for (let y = -ry - 1; y <= ry + 1; y++) for (let x = -rx - 2; x <= rx + 2; x++) {
      const a = Math.atan2(y / ry, x / rx), rr = 1 + (vnoise(Math.cos(a) * 1.6 + 5, Math.sin(a) * 1.6 + 5, seed) - 0.5) * 0.55;
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= rr * rr) { pts.push([x, y]); inside.add(x + ',' + y); }
    }
    const has = (x, y) => inside.has(x + ',' + y);
    const offRoad = (x, y) => !S.onRoad(Math.floor(x / T), Math.floor(y / T));
    const FH = 3;
    // shadow, then the face, then the top plate
    for (const [x, y] of pts) if (!has(x, y + 1) && offRoad(cx + x, cy + y + FH + 1)) { D(ctx, cx + x + 1, cy + y + FH + 1, C.rgba(SHADOW_INK, 0.28)); D(ctx, cx + x + 2, cy + y + FH, C.rgba(SHADOW_INK, 0.2)); }
    for (const [x, y] of pts) {
      if (has(x, y + 1)) continue;
      for (let k = 1; k <= FH; k++) {
        if (!offRoad(cx + x, cy + y + k)) continue;
        const band = k === 1 ? STRATA.rust[1] : k === 2 ? STRATA.ochre[0] : STRATA.deep[1];
        D(ctx, cx + x, cy + y + k, x > rx * 0.55 ? STRATA.deep[0] : band);
      }
      if (offRoad(cx + x, cy + y + FH + 1)) D(ctx, cx + x, cy + y + FH + 1, '#3a1a12');
    }
    for (const [x, y] of pts) {
      const wx = cx + x, wy = cy + y;
      if (!offRoad(wx, wy)) continue;
      let c;
      if (!has(x, y - 1) || !has(x - 1, y)) c = winter ? '#f4f8fb' : STRATA.cream[2];
      else if (!has(x + 1, y)) c = STRATA.sand[0];
      else {
        const v = vnoise(wx * 0.3, wy * 0.3, seed + 1) + (bayer(wx, wy) - 0.5) * 0.5;
        c = v > 0.62 ? STRATA.cream[1] : v > 0.3 ? STRATA.sand[1] : STRATA.sand[0];
        if (winter && v > 0.4) c = '#e3ebf1';
      }
      D(ctx, wx, wy, c);
      if (!has(x, y - 1) && offRoad(wx, wy - 1)) D(ctx, wx, wy - 1, '#3a1a12');
    }
    for (const [x, y] of pts) if (!has(x - 1, y) && offRoad(cx + x - 1, cy + y)) for (let k = 0; k <= (has(x, y + 1) ? 0 : FH); k++) D(ctx, cx + x - 1, cy + y + k, '#3a1a12');
    // a crack and a fleck of copper
    let x = -Math.round(rx * 0.5), y = 0;
    for (let k = 0; k < rx; k++) { if (has(x, y) && has(x, y + 1) && has(x, y - 1)) D(ctx, cx + x, cy + y, STRATA.rust[0]); x++; if (S.hash(k, seed, 77) > 0.6) y += S.hash(k, seed, 78) > 0.5 ? 1 : -1; }
    if (!winter) { D(ctx, cx + 2, cy - 1, COPPER.light); D(ctx, cx + 3, cy - 1, COPPER.dark); }
  }

  /** Packed gravel yard in front of the mine mouth, with cart ruts. */
  function mineYard(ctx, winter) {
    const x0 = 1096, x1 = 1190, y0 = RIDGE.foot - 2, y1 = 534;
    const cols = winter ? ['#d6dde4', '#eef3f7', '#b8c4cf', '#9aa8b4'] : ['#8e7a62', '#ae977c', '#72604e', '#56483a'];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const ex = Math.min(x - x0, x1 - 1 - x, (y1 - 1 - y) * 2);
      if (ex < 6 && S.hash(x, y, 90) * 6 > ex + 0.4) continue;
      const v = vnoise(x * 0.2, y * 0.2, 91) + (S.hash(x, y, 92) - 0.5) * 0.6;
      D(ctx, x, y, v > 0.75 ? cols[1] : v > 0.35 ? cols[0] : v > 0.1 ? cols[2] : cols[3]);
    }
    // ruts leading into the mouth
    for (let y = y0 + 2; y < y1 - 2; y++) for (const rx of [MOUTH.x - 6, MOUTH.x + 5]) { D(ctx, rx, y, cols[3]); if (y & 1) D(ctx, rx + 1, y, cols[1]); }
  }

  /** Stream centre x at row y (linear between STREAM points). */
  function streamX(y) {
    let i = 0; while (i + 2 < STREAM.length && STREAM[i + 1][1] < y) i++;
    const [ax, ay] = STREAM[i], [bx, by] = STREAM[i + 1];
    return ax + (bx - ax) * clamp((y - ay) / Math.max(1, by - ay), 0, 1);
  }
  function streamBed(ctx, winter) {
    // a little rocky channel from the spring to the south rim, wet soil along the banks
    const wet = winter ? ['#b8c4cf', '#d6dde4'] : ['#4a3020', '#6a4a30'];
    const y0 = STREAM[0][1], y1 = LIP.y;
    for (let y = y0; y <= y1; y++) {
      const cx = Math.round(streamX(y));
      const hw = 2 + (y > y1 - 14 ? 1 : 0) + (S.hash(cx, y >> 2, 99) > 0.7 ? 1 : 0);
      const bl = 1 + (S.hash(y, 1, 100) > 0.5 ? 1 : 0), br = 1 + (S.hash(y, 2, 100) > 0.6 ? 1 : 0);
      R(ctx, cx - hw - bl, y, bl, 1, wet[1]); R(ctx, cx + hw + 1, y, br, 1, wet[0]);
      R(ctx, cx - hw, y, hw * 2 + 1, 1, WATER.base);
      D(ctx, cx - hw, y, WATER.light); D(ctx, cx + hw, y, WATER.deep);
      if (S.hash(cx, y, 93) > 0.72) D(ctx, cx - 1 + ((y >> 1) & 1), y, WATER.light);
      if (S.hash(cx, y, 94) > 0.9) D(ctx, cx, y, WATER.hi);
      if (winter && S.hash(cx, y, 95) > 0.55) { D(ctx, cx - hw, y, '#e8f4fa'); }
    }
    // pebbles and a few reeds along the banks (irregular)
    for (let y = y0 + 2; y < y1 - 2; y += 1) {
      for (const side of [-1, 1]) {
        if (S.hash(y, side + 3, 96) < 0.91) continue;
        const cx = Math.round(streamX(y)), px0 = cx + side * (5 + Math.floor(S.hash(y, side, 97) * 2));
        R(ctx, px0 - 1, y - 1, 3, 2, GRANITE.base); D(ctx, px0 - 1, y - 1, GRANITE.hi); D(ctx, px0 + 1, y, GRANITE.dark);
        D(ctx, px0, y + 1, C.rgba(SHADOW_INK, 0.3));
        if (winter) D(ctx, px0, y - 1, P.snow);
      }
      if (!winter && S.hash(y, 7, 98) > 0.93) {
        const cx = Math.round(streamX(y)), rx = cx + (S.hash(y, 8, 98) > 0.5 ? 5 : -5);
        D(ctx, rx, y - 2, '#7cb850'); D(ctx, rx, y - 1, '#4f8a3a'); D(ctx, rx + 1, y - 3, '#9ad672'); D(ctx, rx + 1, y - 1, '#4f8a3a');
      }
    }
  }

  function drawGround(ctx) {
    const s = season(), winter = s === 'winter';
    // bedrock slabs scattered over the canyon floor (where no buildings stand)
    for (const [x, y, rx, ry, sd] of [[882, 570, 8, 4, 1], [965, 664, 10, 4, 4], [1018, 572, 9, 4, 2], [1200, 628, 7, 3, 3], [930, 566, 6, 3, 6]]) slab(ctx, x, y, rx, ry, 300 + sd, winter);
    mineYard(ctx, winter);
    streamBed(ctx, winter);
    drawRidge(ctx, s);
  }

  /* ============================================================ BUILDINGS (21) */
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
    R(g, x, y, 2, h, TIMBER.light); D(g, x, y + (h >> 1), TIMBER.dark);
    R(g, x + w - 2, y, 2, h, TIMBER.light); D(g, x + w - 1, y + (h >> 1), TIMBER.dark);
  }

  function mineEntrance(ctx, s) {
    const winter = s === 'winter';
    const spr = build(64, 56, (g) => {
      const mx0 = 19, mx1 = 45, my0 = 22, my1 = 54;
      // dark rock surround so the mouth reads from far away
      for (let y = my0 - 4; y < my1; y++) { const t = clamp((y - (my0 - 4)) / 6, 0, 1); const hw = Math.round(17 * Math.sqrt(t)); R(g, 32 - hw, y, hw * 2, 1, '#3a1c10'); }
      for (let y = my0; y < my1; y++) R(g, mx0, y, mx1 - mx0, 1, (y - my0) < 6 ? '#140c0a' : '#1c120d');
      const sets = [[3, '#3a2414', '#2a1a10'], [7, '#2a1a10', '#1e140c'], [10, '#1e140c', '#160e0a']];
      for (const [k, cA, cB] of sets) {
        R(g, mx0 + k, my0 + k - 1, mx1 - mx0 - 2 * k, 2, cA);
        R(g, mx0 + k, my0 + k + 1, 2, my1 - my0 - k - 1, cA);
        R(g, mx1 - k - 2, my0 + k + 1, 2, my1 - my0 - k - 1, cB);
      }
      R(g, mx0 + 12, my0 + 12, mx1 - mx0 - 24, my1 - my0 - 13, '#07040a');
      D(g, mx0 + 15, my0 + 15, '#ffcf6a'); D(g, mx0 + 15, my0 + 16, '#c87a2a'); dith(g, mx0 + 13, my0 + 14, 5, 4, 'rgba(255,190,90,0.35)');
      // rails running in and fading into the dark
      for (let y = my1 - 1; y > my0 + 12; y--) {
        const t = (my1 - y) / (my1 - my0 - 12), half = Math.round(5 - t * 2.5);
        const c1 = t < 0.4 ? '#c8cdd8' : t < 0.75 ? '#7b7a84' : '#3a3842';
        D(g, 32 - half - 1, y, c1); D(g, 32 + half, y, c1);
        if ((my1 - y) % 4 === 0) R(g, 32 - half - 2, y, half * 2 + 4, 1, t < 0.5 ? TIMBER.dark : '#2a1a10');
      }
      for (const sx of [10, 46]) { R(g, sx, 48, 9, 7, GRANITE.dark); R(g, sx, 48, 8, 1, GRANITE.light); R(g, sx, 49, 1, 5, GRANITE.base); D(g, sx + 4, 51, GRANITE.deep); }
      timberV(g, 13, 20, 6, 31);
      timberV(g, 45, 20, 6, 31);
      for (let k = 0; k < 5; k++) { R(g, 19 + k, 26 - k, 2, 2, k === 0 ? TIMBER.dark : TIMBER.base); D(g, 19 + k, 26 - k, TIMBER.light); R(g, 43 - k, 26 - k, 2, 2, TIMBER.base); D(g, 44 - k, 27 - k, TIMBER.dark); }
      timberH(g, 8, 14, 48, 7);
      R(g, 8, 21, 48, 1, 'rgba(20,10,8,0.5)');
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
      R(g, 54, 26, 5, 1, IRON.dark); R(g, 54, 27, 5, 6, LAMP.glass); R(g, 54, 27, 1, 6, IRON.dark); R(g, 58, 27, 1, 6, IRON.dark);
      R(g, 55, 28, 2, 3, LAMP.hot); R(g, 54, 33, 5, 1, IRON.dark); D(g, 56, 25, IRON.light);
      // pickaxe leaning on the left post
      for (let k = 0; k < 16; k++) D(g, 6 + (k >> 2), 36 + k, k < 14 ? TIMBER.light : TIMBER.dark);
      R(g, 3, 35, 8, 2, IRON.base); R(g, 3, 35, 8, 1, IRON.hi); D(g, 2, 36, IRON.dark); D(g, 11, 36, IRON.dark);
      // ore bucket
      R(g, 53, 47, 7, 7, IRON.base); R(g, 53, 47, 7, 1, IRON.hi); R(g, 54, 48, 5, 2, '#3a3036'); R(g, 59, 48, 1, 6, IRON.dark);
      D(g, 55, 48, COPPER.light); D(g, 56, 49, GOLD.base);
      for (let k = 0; k < 5; k++) D(g, 53 + k + 1, 45 - (k === 0 || k === 4 ? 0 : 1), IRON.dark);
      for (const [rx, ry, rr] of [[2, 52, 2], [8, 54, 1], [58, 53, 1], [61, 51, 2]]) { R(g, rx - rr, ry - rr, rr * 2 + 1, rr + 1, STRATA.sand[0]); R(g, rx - rr, ry - rr, rr * 2, 1, STRATA.cream[2]); }
      if (winter) { R(g, 8, 13, 48, 1, P.snow); R(g, 22, 2, 20, 1, P.snow); R(g, 12, 47, 7, 1, P.snow); R(g, 46, 47, 7, 1, P.snow); }
      if (LEVEL === 'critical') { R(g, 9, 2, 1, 12, IRON.dark); R(g, 10, 2, 6, 2, '#d8402e'); R(g, 10, 4, 4, 1, '#d8402e'); R(g, 10, 5, 2, 1, '#a82a1e'); }
    }, '#21140e');
    place(ctx, spr, MOUTH.ox, MOUTH.oy, [2, 1, 0.22]);
  }

  function cottage(ctx, s) {
    const winter = s === 'winter';
    const f = foliage(s);
    const archHalf = (y) => { const t = (y - 8) / 12; return y < 20 ? Math.round(24 * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)))) : 24; };
    const spr = build(58, 54, (g) => {
      for (let y = 8; y < 52; y++) { const half = archHalf(y); R(g, 28 - half, y, half * 2, 1, GRANITE.base); }
      const rnd = S.rng(919);
      for (let y = 10; y < 52; y += 5) for (let x = 4 + ((y / 5) & 1) * 3; x < 52; x += 6 + Math.floor(rnd() * 3)) {
        const w = 5 + Math.floor(rnd() * 2);
        R(g, x, y, w, 4, rnd() > 0.5 ? GRANITE.light : GRANITE.base);
        R(g, x, y + 3, w, 1, GRANITE.dark); R(g, x + w - 1, y, 1, 4, GRANITE.dark); D(g, x, y, GRANITE.hi);
      }
      dith(g, 40, 10, 16, 42, C.rgba(GRANITE.deep, 0.35), 0);
      clipRows(g, (y) => { if (y < 8 || y >= 52) return null; const half = archHalf(y); return [28 - half, half * 2]; }, 56);
      for (let y = 8; y < 21; y++) { const half = archHalf(y); D(g, 28 - half, y, COPPER.light); D(g, 27 + half, y, COPPER.dark); }
      R(g, 14, 8, 28, 1, COPPER.light);
      // round door
      const dcx = 30, dby = 51;
      for (let y = 0; y < 20; y++) { const half = y < 8 ? Math.round(8 * Math.sqrt(1 - Math.pow((8 - y) / 8, 2))) : 8; R(g, dcx - half - 1, dby - 20 + y, half * 2 + 2, 1, TIMBER.dark); }
      for (let y = 1; y < 20; y++) { const half = y < 8 ? Math.round(7 * Math.sqrt(Math.max(0, 1 - Math.pow((8 - y) / 8, 2)))) : 7; R(g, dcx - half, dby - 20 + y, half * 2, 1, DOOR_GREEN.base); D(g, dcx - half, dby - 20 + y, DOOR_GREEN.light); D(g, dcx + half - 1, dby - 20 + y, DOOR_GREEN.dark); }
      for (let x = dcx - 5; x < dcx + 5; x += 3) R(g, x, dby - 17, 1, 17, DOOR_GREEN.dark);
      disc(g, dcx, dby - 10, 1, GOLD.base); D(g, dcx - 1, dby - 11, GOLD.hi);
      // round window, warm inside
      disc(g, 12, 30, 5, TIMBER.dark); disc(g, 12, 30, 4, LAMP.glass); R(g, 8, 30, 9, 1, TIMBER.dark); R(g, 12, 26, 1, 9, TIMBER.dark); D(g, 10, 28, LAMP.hot); D(g, 14, 32, '#d08a3a');
      R(g, 7, 35, 11, 2, COPPER.base); R(g, 7, 35, 11, 1, COPPER.light);
      if (!winter) { D(g, 8, 34, f.base); D(g, 10, 33, f.light); D(g, 12, 34, f.alt); D(g, 14, 33, f.base); D(g, 16, 34, f.light); } else R(g, 7, 34, 11, 1, P.snow);
      // awning over the door
      for (let k = 0; k < 4; k++) R(g, dcx - 12 + k, 26 + k, 24 - 2 * k, 1, k === 0 ? COPPER.hi : k === 3 ? COPPER.dark : COPPER.base);
      for (let x = dcx - 11; x < dcx + 12; x += 3) D(g, x, 27, COPPER.dark);
      if (winter) R(g, dcx - 12, 25, 24, 1, P.snow);
      // lantern by the door
      R(g, 44, 30, 4, 1, IRON.dark); R(g, 44, 31, 4, 5, LAMP.glass); R(g, 44, 31, 1, 5, IRON.dark); R(g, 47, 31, 1, 5, IRON.dark); R(g, 44, 36, 4, 1, IRON.dark); D(g, 45, 32, LAMP.hot);
      // doorstep, mat
      R(g, dcx - 9, 51, 18, 2, GRANITE.light); R(g, dcx - 9, 52, 18, 1, GRANITE.dark);
      R(g, dcx - 5, 51, 10, 1, '#a8402e');
      // flower pot
      R(g, 4, 46, 6, 5, COPPER.base); R(g, 4, 46, 6, 1, COPPER.light); R(g, 9, 47, 1, 4, COPPER.dark);
      if (!winter) { D(g, 5, 44, f.base); D(g, 7, 43, f.light); D(g, 8, 45, f.alt); D(g, 6, 45, f.dark); } else R(g, 4, 45, 6, 1, P.snow);
      // mailbox on a post
      R(g, 51, 38, 2, 14, TIMBER.base); R(g, 51, 38, 1, 14, TIMBER.light);
      R(g, 48, 33, 8, 6, '#3f6aa0'); R(g, 48, 33, 8, 1, '#7aa2d0'); R(g, 55, 34, 1, 5, '#2a4870'); R(g, 49, 35, 3, 1, '#2a4870'); R(g, 56, 31, 1, 4, '#d8402e');
      // chimney pipe poking out of the mesa
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
        for (let k = 0; k < 14; k++) { R(g, 7 + k, 8 + k, 2, 2, TIMBER.light); D(g, 7 + k, 9 + k, TIMBER.dark); R(g, 19 - k, 8 + k, 2, 2, TIMBER.base); }
        R(g, 6, 14, 14, 3, TIMBER.light); R(g, 6, 16, 14, 1, TIMBER.dark); D(g, 8, 15, IRON.dark); D(g, 17, 15, IRON.dark);
      }
      if (winter) R(g, 1, 0, 24, 1, P.snow);
    }, '#21140e');
    place(ctx, spr, ADIT.x - 13, ADIT.base - 24, [2, 1, 0.2]);
    if (open) oreHeap(ctx, ADIT.x + 4, ADIT.base + 14, 6, winter);
    else for (const sx of [ADIT.x - 16, ADIT.x + 14]) {
      const st = build(3, 9, (g) => { R(g, 1, 0, 1, 9, TIMBER.light); R(g, 0, 1, 3, 2, '#e8603a'); }, OUT);
      place(ctx, st, sx, ADIT.base + 1, [1, 1, 0.25]);
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
      R(g, 1, 2, 5, 4, LAMP.glass); R(g, 2, 3, 2, 2, LAMP.hot); R(g, 1, 2, 1, 4, IRON.dark); R(g, 5, 2, 1, 4, IRON.dark); R(g, 1, 6, 5, 1, IRON.dark);
      if (winter) R(g, 0, 0, 7, 1, P.snow);
    }, OUT);
    place(ctx, spr, x - 3, by - 22, [2, 1, 0.22]);
  }
  function toolRack(ctx, x, by) {
    const spr = build(14, 18, (g) => {
      R(g, 0, 4, 1, 14, TIMBER.dark); R(g, 13, 4, 1, 14, TIMBER.dark); R(g, 0, 4, 14, 2, TIMBER.light); R(g, 0, 5, 14, 1, TIMBER.dark);
      R(g, 3, 0, 1, 12, TIMBER.light); R(g, 2, 12, 3, 4, IRON.base); D(g, 2, 12, IRON.hi);
      R(g, 8, 2, 1, 14, TIMBER.light); R(g, 5, 1, 7, 2, IRON.base); R(g, 5, 1, 7, 1, IRON.hi);
      R(g, 10, 7, 4, 3, '#d8a020'); R(g, 10, 7, 4, 1, '#f6d050'); D(g, 13, 8, LAMP.hot);
    }, OUT);
    place(ctx, spr, x, by - 18, [2, 1, 0.22]);
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
    groundShadow(ctx, x + 14, by, 15, 3, 0.25);
    const spr = build(30, 16, (g) => {
      for (const lx of [4, 24]) { R(g, lx, 8 - (lx >> 3), 2, 8 + (lx >> 3), TIMBER.dark); D(g, lx, 8 - (lx >> 3), TIMBER.light); }
      for (let i = 0; i < 28; i++) {
        const y = 3 + Math.round(i * 0.18);
        R(g, i, y, 1, 5, TIMBER.base); D(g, i, y, TIMBER.hi); D(g, i, y + 4, TIMBER.deep);
        D(g, i, y + 1, (i % 5 === 0) ? TIMBER.dark : '#6e625a'); D(g, i, y + 2, (i % 5 === 0) ? TIMBER.dark : (S.hash(i, 1, 66) > 0.75 ? GOLD.base : '#8a7c72'));
        D(g, i, y + 3, TIMBER.light);
      }
      ellipse(g, 24, 12, 5, 3, IRON.dark); ellipse(g, 24, 12, 4, 2, IRON.light); ellipse(g, 24, 12, 2, 1, IRON.base); D(g, 24, 12, GOLD.base); D(g, 25, 13, GOLD.hi); D(g, 22, 11, IRON.hi);
      if (winter) R(g, 0, 2, 22, 1, P.snow);
    }, OUT);
    place(ctx, spr, x, by - 16);
  }

  /* ----- rail station ----- */
  function drawTrack(ctx, x0, x1, y, winter) {
    for (let x = x0; x <= x1; x++) for (let o = -7; o <= 7; o++) {
      if (Math.abs(o) === 7 && S.hash(x, o, 81) < 0.5) continue;
      const hv = S.hash(x, y + o, 80);
      D(ctx, x, y + o, hv > 0.7 ? '#8c8478' : hv > 0.3 ? '#6e675e' : '#57514a');
    }
    for (let x = x0 + 2; x < x1 - 1; x += 5) {
      R(ctx, x, y - 6, 2, 13, '#6b4a2e'); R(ctx, x, y - 6, 1, 13, '#8d6640'); D(ctx, x + 1, y + 6, '#4a321f');
      R(ctx, x + 2, y - 5, 1, 12, 'rgba(20,16,30,0.3)');
      if (winter) R(ctx, x, y - 6, 1, 3, P.snow);
    }
    for (const o of [-5, 4]) { R(ctx, x0, y + o, x1 - x0 + 1, 1, '#c8cdd8'); R(ctx, x0, y + o + 1, x1 - x0 + 1, 1, '#7d869a'); R(ctx, x0, y + o + 2, x1 - x0 + 1, 1, '#4a5064'); }
    for (let x = x0 + 1; x < x1 - 1; x += 10) { D(ctx, x, y - 3, '#3a3440'); D(ctx, x, y + 6, '#3a3440'); }
  }
  function abutment(ctx, winter) {
    // stone abutment at the west rim where the sky-rail lands
    const x0 = TRACK.x0 - 2, x1 = TRACK.x0 + 20, y = TRACK.y;
    const spr = build(x1 - x0, 26, (g) => {
      R(g, 0, 0, x1 - x0, 26, GRANITE.base);
      for (let row = 0; row < 4; row++) {
        const yy = 4 + row * 5, off = (row & 1) * 4;
        for (let x = -off; x < x1 - x0; x += 8) {
          const bx = Math.max(0, x), bw = Math.min(x1 - x0, x + 8) - bx; if (bw <= 0) continue;
          R(g, bx, yy, bw, 5, S.hash(row, x, 85) > 0.5 ? GRANITE.light : GRANITE.base);
          R(g, bx, yy, bw, 1, GRANITE.hi); R(g, bx, yy + 4, bw, 1, GRANITE.dark); R(g, bx + bw - 1, yy, 1, 5, GRANITE.dark);
        }
      }
      R(g, 0, 0, x1 - x0, 4, GRANITE.light); R(g, 0, 0, x1 - x0, 1, GRANITE.hi);
      R(g, 0, 22, x1 - x0, 4, GRANITE.deep);
      if (winter) R(g, 0, 0, x1 - x0, 2, P.snow);
    }, '#1f1a22');
    place(ctx, spr, x0, y - 8);
  }
  function stationHouse(ctx, s) {
    const winter = s === 'winter';
    const W0 = STN.w, H0 = 46;
    const spr = build(W0, H0, (g) => {
      // walls: stone plinth, timber frame, plaster
      const wy0 = 22;
      R(g, 1, wy0, W0 - 2, H0 - wy0, PLASTER.base);
      dith(g, W0 - 14, wy0, 13, H0 - wy0 - 6, PLASTER.dark, 0);
      R(g, 1, wy0, 2, H0 - wy0, TIMBER.base); R(g, 1, wy0, 1, H0 - wy0, TIMBER.light);
      R(g, W0 - 3, wy0, 2, H0 - wy0, TIMBER.dark);
      R(g, 1, wy0 + 1, W0 - 2, 2, TIMBER.base); R(g, 1, wy0 + 1, W0 - 2, 1, TIMBER.light);
      for (const bx of [15, 34]) { R(g, bx, wy0, 2, H0 - wy0 - 6, TIMBER.base); D(g, bx, wy0 + 3, TIMBER.light); R(g, bx + 1, wy0, 1, H0 - wy0 - 6, TIMBER.dark); }
      // plinth
      R(g, 1, H0 - 6, W0 - 2, 6, GRANITE.base);
      for (let x = 1; x < W0 - 2; x += 6) { R(g, x, H0 - 6, 5, 1, GRANITE.hi); R(g, x + 5, H0 - 6, 1, 6, GRANITE.dark); }
      R(g, 1, H0 - 3, W0 - 2, 1, GRANITE.dark); R(g, 1, H0 - 1, W0 - 2, 1, GRANITE.deep);
      // door (arched, green) in the middle bay
      const dx = 20, dw = 10;
      R(g, dx - 1, wy0 + 6, dw + 2, H0 - wy0 - 6, TIMBER.dark);
      R(g, dx, wy0 + 8, dw, H0 - wy0 - 8, DOOR_GREEN.base); R(g, dx + 1, wy0 + 7, dw - 2, 1, DOOR_GREEN.base);
      R(g, dx, wy0 + 8, 1, H0 - wy0 - 8, DOOR_GREEN.light); R(g, dx + dw - 1, wy0 + 8, 1, H0 - wy0 - 8, DOOR_GREEN.dark);
      R(g, dx + (dw >> 1), wy0 + 8, 1, H0 - wy0 - 8, DOOR_GREEN.dark);
      R(g, dx + 2, wy0 + 10, 2, 3, '#ffcf6a'); R(g, dx + 6, wy0 + 10, 2, 3, '#ffcf6a');
      D(g, dx + 3, wy0 + 15, GOLD.base); D(g, dx + 6, wy0 + 15, GOLD.base);
      // window (left) and ticket window (right) with a small awning
      const win = (x, y) => {
        R(g, x - 1, y - 1, 10, 9, TIMBER.dark); R(g, x, y, 8, 7, LAMP.glass); R(g, x + 4, y, 1, 7, TIMBER.dark); R(g, x, y + 3, 8, 1, TIMBER.dark);
        D(g, x + 1, y + 1, LAMP.hot); D(g, x + 2, y + 1, LAMP.hot); D(g, x + 6, y + 5, LAMP.warm);
        R(g, x - 1, y + 8, 10, 1, GRANITE.light);
      };
      win(5, wy0 + 6); win(38, wy0 + 6);
      for (let k = 0; k < 3; k++) R(g, 36 + k, wy0 + 3 + k, 14 - 2 * k, 1, k === 0 ? '#e8e0d0' : k === 1 ? '#c8402e' : '#a02a20');
      for (let x = 37; x < 49; x += 4) R(g, x, wy0 + 3, 2, 2, '#c8402e');
      // roof: side-gabled copper with standing seams, verdigris streaks, lit from the top-left
      for (let y = 0; y < wy0; y++) {
        const inset = Math.max(0, 3 - y);
        for (let x = inset - 1; x < W0 - inset + 1; x++) {
          const k = (x + 1) % 5, row = y;
          let col = k === 4 ? COPPER.dark : k === 0 ? COPPER.light : COPPER.base;
          if (row < 2) col = k === 4 ? COPPER.base : COPPER.hi;
          if (row > wy0 - 3) col = COPPER.deep;
          if (k !== 4 && row > 3 && S.hash(x, y >> 2, 83) < 0.1) col = VERDI.base;
          if (x > W0 - 12 && k !== 4 && ((x + y) & 1) && row > 1 && row < wy0 - 2) col = C.mix(col, COPPER.deep, 0.35);
          D(g, x, y, col);
        }
      }
      if (winter) { R(g, 2, 0, W0 - 4, 3, P.snow); dith(g, 1, 3, W0 - 2, 4, P.snow, 0); }
      // central dormer gable with a coin-and-pick emblem
      const gx = W0 >> 1;
      for (let y = 0; y < 12; y++) { const hw = Math.min(9, 1 + y); R(g, gx - hw, y - 6, hw * 2, 1, y < 2 ? COPPER.hi : COPPER.base); D(g, gx - hw, y - 6, COPPER.hi); D(g, gx + hw - 1, y - 6, COPPER.deep); }
      R(g, gx - 7, 3, 14, 3, PLASTER.base); R(g, gx - 7, 5, 14, 1, PLASTER.dark);
      disc(g, gx, 0, 4, GOLD.deep); disc(g, gx, 0, 3, GOLD.base); D(g, gx - 1, -1, GOLD.hi); D(g, gx - 2, 0, GOLD.light);
      R(g, gx - 1, -1, 3, 1, TIMBER.deep); R(g, gx, -2, 1, 4, TIMBER.deep);
      if (winter) R(g, gx - 2, -6, 4, 1, P.snow);
      // hanging lamp by the door
      R(g, 31, wy0 + 4, 3, 1, IRON.dark); R(g, 33, wy0 + 4, 1, 2, IRON.dark); R(g, 32, wy0 + 6, 3, 4, LAMP.glass); D(g, 33, wy0 + 7, LAMP.hot); R(g, 32, wy0 + 10, 3, 1, IRON.dark);
    }, '#21140e');
    place(ctx, spr, STN.x, STN.base - H0, [3, 1, 0.22]);
    // platform kerb along the track with a painted safety line
    R(ctx, STN.x - 2, STN.base, STN.w + 4, 2, GRANITE.light); R(ctx, STN.x - 2, STN.base + 1, STN.w + 4, 1, GRANITE.dark);
    for (let x = STN.x; x < STN.x + STN.w; x += 4) R(ctx, x, STN.base, 2, 1, '#f2c94c');
  }
  function signalPost(ctx, winter) {
    const spr = build(9, 26, (g) => {
      R(g, 4, 6, 2, 20, IRON.dark); D(g, 4, 6, IRON.light); R(g, 4, 7, 1, 18, IRON.base);
      R(g, 2, 24, 6, 2, GRANITE.dark);
      R(g, 1, 0, 7, 9, OUT); R(g, 2, 1, 5, 7, IRON.dark);
      disc(g, 4, 2, 1, '#d8402e'); D(g, 4, 2, '#ff8a70');
      disc(g, 4, 6, 1, '#2f9a5a'); D(g, 4, 6, '#8cf0b0');
      // semaphore arm
      R(g, 6, 10, 3, 2, '#d8402e'); D(g, 8, 10, '#f2ece0');
      if (winter) R(g, 1, 0, 7, 1, P.snow);
    }, OUT);
    place(ctx, spr, SIGNAL.x - 4, SIGNAL.base - 26, [2, 1, 0.22]);
  }
  function bufferStop(ctx, x, y) {
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
  function drawStation(ctx, s) {
    const winter = s === 'winter';
    abutment(ctx, winter);
    drawTrack(ctx, TRACK.x0, TRACK.buf + 2, TRACK.y, winter);
    stationHouse(ctx, s);
    signalPost(ctx, winter);
    bufferStop(ctx, TRACK.buf, TRACK.y);
  }

  /* ----- spring ----- */
  function springOutcrop(ctx, winter) {
    groundShadow(ctx, SPRING.x + 3, SPRING.y + 2, 14, 3, 0.26);
    const spr = build(30, 20, (g) => {
      // a heap of sandstone boulders with a dark cleft the water runs out of
      const blob = (cx, cy, rx, ry, ramp) => {
        for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
          if ((x * x) / (rx * rx) + (y * y) / (ry * ry) > 1.05) continue;
          const l = -(x / rx) * 0.5 - (y / ry) * 0.7 + (S.hash(cx + x, cy + y, 95) - 0.5) * 0.5;
          D(g, cx + x, cy + y, l > 0.45 ? ramp[2] : l > -0.25 ? ramp[1] : ramp[0]);
        }
      };
      blob(8, 12, 8, 6, STRATA.sand); blob(22, 13, 7, 5, STRATA.ochre); blob(15, 7, 7, 6, STRATA.cream); blob(25, 7, 4, 3, STRATA.rust);
      // strata lines
      for (let x = 2; x < 28; x++) if (S.hash(x, 1, 96) > 0.4) D(g, x, 10 + ((x >> 3) & 1), STRATA.rust[0]);
      // the cleft
      R(g, 12, 12, 6, 7, '#1a0e0a'); R(g, 13, 11, 4, 1, '#1a0e0a'); R(g, 13, 14, 4, 5, '#0c0608');
      R(g, 13, 17, 4, 3, WATER.base); D(g, 14, 17, WATER.hi); D(g, 15, 18, WATER.light);
      // moss / ferns by the water
      const m = winter ? [P.snow, '#c9d6e2'] : ['#4f8a3a', '#7cb850'];
      D(g, 11, 17, m[0]); D(g, 10, 16, m[1]); D(g, 19, 17, m[0]); D(g, 20, 16, m[1]); D(g, 18, 15, m[1]);
      if (winter) { R(g, 9, 1, 12, 1, P.snow); R(g, 2, 6, 8, 1, P.snow); R(g, 18, 8, 9, 1, P.snow); }
      // a few copper flecks
      D(g, 6, 13, COPPER.light); D(g, 23, 12, GOLD.base); D(g, 16, 5, COPPER.light);
    }, '#2a140c');
    place(ctx, spr, SPRING.x - 15, SPRING.y - 18);
  }

  /* ----- savings crystals ----- */
  const RING_N = 12;
  function gemPalette(gem, pct) {
    // dim and greyer while the goal is small; full colour as it fills
    const k = pct == null ? 0.45 : 0.2 * (1 - pct);
    const grey = '#5a5468';
    const m = (c) => C.mix(c, grey, k);
    return { deep: m(gem.deep), dark: m(gem.dark), base: m(gem.base), light: m(gem.light), hi: m(gem.hi), out: gem.out };
  }
  /** One crystal prism: base centre (cx, by), width w (odd), height h, tip lean in px. */
  function shard(g, cx, by, w, h, lean, pal) {
    const hw = w >> 1, tipH = Math.max(2, Math.round(w * 0.8));
    for (let j = 0; j < h; j++) {
      const y = by - j, t = j / Math.max(1, h - 1);
      const xo = Math.round(lean * t);
      const fromTop = h - 1 - j;
      const half = fromTop < tipH ? Math.round(hw * (fromTop + 0.5) / tipH) : hw;
      for (let i = -half; i <= half; i++) {
        const x = cx + xo + i;
        let c;
        if (fromTop < tipH) c = i < 0 ? (i === -half ? pal.light : pal.hi) : i === 0 ? pal.light : pal.base;   // tip facets
        else if (i < -hw / 3) c = pal.light;
        else if (i > hw / 3) c = pal.dark;
        else c = pal.base;
        if (fromTop >= tipH && i === -half + 1 && fromTop < tipH + Math.max(3, h * 0.6)) c = pal.hi;           // highlight streak
        if (fromTop >= tipH && i === half) c = pal.deep;
        if (j < 2) c = pal.deep;
        if (fromTop >= tipH && c === pal.base && ((x + y) & 1) && t < 0.35) c = pal.dark;                       // dither the shaded foot
        D(g, x, y, c);
      }
      if (fromTop === tipH && half > 1) for (let i = -half + 1; i < half; i++) D(g, cx + xo + i, y, i < 0 ? pal.hi : pal.light); // facet edge
    }
  }
  /** Build the crystal formation sprite. Returns {spr, ox, oy, tip:[x,y], glints:[[x,y]...]} (local coords relative to base centre). */
  function crystalSprite(cr, s) {
    const pct = cr.goal.pct, pal = gemPalette(cr.gem, pct), winter = s === 'winter';
    const W0 = 54, H0 = 82, cx = 27, by = 76;
    const out = { glints: [] };
    const spr = build(W0, H0, (g) => {
      // geode foot: a rough rock mound the gems grow out of
      const rx = pct == null ? 7 : Math.round(9 + 6 * pct);
      for (let y = -3; y <= 2; y++) for (let x = -rx; x <= rx; x++) {
        if ((x * x) / (rx * rx) + (y * y) / 9 > 1) continue;
        const l = -(x / rx) * 0.6 - (y / 3) * 0.5 + (S.hash(x, y, 97) - 0.5) * 0.6;
        D(g, cx + x, by + y - 1, l > 0.45 ? GRANITE.light : l > -0.3 ? GRANITE.base : GRANITE.dark);
      }
      if (pct == null) {
        // a seed crystal: small and dim, waiting for a target
        shard(g, cx - 4, by - 1, 3, 6, -1, pal);
        shard(g, cx + 5, by - 1, 3, 7, 1, pal);
        shard(g, cx, by, 5, 12, 0, pal);
        out.tip = [0, -12]; out.glints.push([-1, -7]);
      } else {
        const p = pct, mainH = Math.round(18 + 52 * p), mainW = 9 + 2 * Math.round(2 * p);
        const n = 2 + Math.round(p * 4);
        const SEC = [[-8, -3, 0.62, 7], [8, 3, 0.54, 7], [-14, -5, 0.4, 5], [14, 5, 0.44, 5], [-5, -2, 0.78, 5], [5, 2, 0.7, 5]];
        // back shards
        for (let k = 0; k < n; k++) {
          const [dx, ln, hr, w] = SEC[k];
          if (k >= 4) continue;
          shard(g, cx + dx, by - 1, w, Math.max(5, Math.round(mainH * hr)), ln, pal);
          out.glints.push([dx + Math.round(ln * 0.6) - 1, -Math.round(mainH * hr * 0.55)]);
        }
        shard(g, cx, by, mainW, mainH, 0, pal);
        out.tip = [0, -mainH];
        out.glints.push([-(mainW >> 1) + 1, -Math.round(mainH * 0.5)], [-(mainW >> 1) + 1, -Math.round(mainH * 0.8)]);
        // front shards (lower, overlapping the main)
        for (let k = 4; k < n; k++) {
          const [dx, ln, hr, w] = SEC[k];
          shard(g, cx + dx, by + 1, w, Math.max(5, Math.round(mainH * hr * 0.55)), ln, pal);
        }
        // tiny chips at the foot
        for (let k = 0; k < 2 + Math.round(p * 4); k++) {
          const dx = Math.round((S.hash(k, cr.x, 98) - 0.5) * rx * 2.2);
          shard(g, cx + dx, by + 1, 3, 3 + (k & 1), dx > 0 ? 1 : -1, pal);
        }
      }
      if (winter) { R(g, cx - 3, by - 3, 7, 1, P.snow); D(g, cx - 5, by - 2, P.snow); }
    }, pal.out);
    out.spr = spr; out.ox = cx; out.oy = by;
    return out;
  }
  const RING = (cx, cy) => {
    const pts = [];
    for (let k = 0; k < RING_N; k++) {
      // progress runs from the left stone along the visible front arc to the right, then round the back
      const a = Math.PI - ((k + 0.5) / RING_N) * Math.PI * 2;
      pts.push([Math.round(cx + Math.cos(a) * 19), Math.round(cy + Math.sin(a) * 8), Math.sin(a) < -0.05]);
    }
    return pts;
  };
  function ringStone(ctx, x, y, lit, gem, winter) {
    // a squat standing stone; lit ones carry a cut gem of the crystal's colour
    R(ctx, x - 1, y + 2, 5, 1, C.rgba(SHADOW_INK, 0.3));
    R(ctx, x - 2, y - 2, 5, 4, '#2a2630'); R(ctx, x - 1, y - 3, 3, 6, '#2a2630');
    R(ctx, x - 1, y - 2, 3, 4, GRANITE.base);
    D(ctx, x - 1, y - 2, GRANITE.hi); D(ctx, x, y - 2, GRANITE.light); R(ctx, x + 1, y - 1, 1, 3, GRANITE.dark); D(ctx, x - 1, y + 1, GRANITE.dark);
    if (lit) { R(ctx, x - 1, y - 1, 2, 2, gem.light); D(ctx, x - 1, y - 1, gem.hi); D(ctx, x + 1, y, gem.dark); D(ctx, x, y, gem.base); }
    else { D(ctx, x, y - 1, GRANITE.dark); D(ctx, x - 1, y, GRANITE.light); }
    if (winter) R(ctx, x - 1, y - 3, 3, 1, P.snow);
  }
  const CRYSTAL_INFO = [];
  function drawCrystal(ctx, cr, s) {
    const winter = s === 'winter';
    const pct = cr.goal.pct;
    const lit = pct == null ? 0 : Math.round(pct * RING_N);
    const ring = RING(cr.x, cr.base);
    // a soft dirt bed inside the ring
    groundShadow(ctx, cr.x + 1, cr.base + 1, 17, 6, 0.16);
    ring.forEach(([x, y, back], k) => { if (back) ringStone(ctx, x, y, k < lit, cr.gem, winter); });
    const info = crystalSprite(cr, s);
    place(ctx, info.spr, cr.x - info.ox, cr.base - info.oy, [3, 1, 0.18]);
    ring.forEach(([x, y, back], k) => { if (!back) ringStone(ctx, x, y, k < lit, cr.gem, winter); });
    CRYSTAL_INFO.push({ cr, spr: info.spr, sx: cr.x - info.ox, sy: cr.base - info.oy, tip: [cr.x + info.tip[0], cr.base + info.tip[1]], glints: info.glints.map(([x, y]) => [cr.x + x, cr.base + y]), ring: ring.map(([x, y], k) => [x, y, k < lit]) });
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
  function sack(g, x, by, coins) {
    ellipse(g, x + 4, by - 3, 4, 3, BURLAP.base);
    R(g, x + 1, by - 6, 7, 4, BURLAP.base);
    R(g, x + 2, by - 9, 5, 3, BURLAP.base);
    R(g, x + 2, by - 7, 5, 1, BURLAP.dark);
    D(g, x + 1, by - 5, BURLAP.light); D(g, x + 1, by - 4, BURLAP.light); D(g, x + 2, by - 9, BURLAP.light);
    R(g, x + 6, by - 5, 2, 4, BURLAP.dark);
    if (coins) { D(g, x + 3, by - 10, GOLD.base); D(g, x + 4, by - 10, GOLD.light); D(g, x + 5, by - 10, GOLD.dark); }
    disc(g, x + 4, by - 3, 1, GOLD.dark); D(g, x + 4, by - 3, GOLD.light);
  }
  const COIN_GLINTS = [];
  function vault(ctx, s) {
    const winter = s === 'winter';
    const { x: VX, y: VY, w: VW, h: VH } = VAULT;
    const dcx = VDOOR.cx - VX, dcy = VDOOR.cy - VY, r = VDOOR.r;
    const spr = build(VW, VH, (g) => {
      R(g, 0, 0, VW, 6, GRANITE.light); R(g, 0, 0, VW, 1, GRANITE.hi);
      dith(g, 1, 1, VW - 2, 4, GRANITE.base, 0);
      R(g, 0, 6, VW, 3, COPPER.base); R(g, 0, 6, VW, 1, COPPER.hi); R(g, 0, 8, VW, 1, COPPER.dark);
      for (let x = 3; x < VW; x += 8) D(g, x, 7, COPPER.deep);
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
      dith(g, VW - 16, 9, 10, VH - 15, C.rgba(GRANITE.deep, 0.4), 1);
      R(g, 0, VH - 6, VW, 6, GRANITE.dark); R(g, 0, VH - 6, VW, 1, GRANITE.light); R(g, 0, VH - 1, VW, 1, GRANITE.deep);
      for (const px0 of [0, VW - 6]) {
        R(g, px0, 9, 6, VH - 15, COPPER.base); R(g, px0, 9, 1, VH - 15, COPPER.hi); R(g, px0 + 5, 9, 1, VH - 15, COPPER.dark);
        for (let y = 12; y < VH - 7; y += 6) { D(g, px0 + 2, y, COPPER.hi); D(g, px0 + 3, y + 1, COPPER.deep); }
      }
      disc(g, dcx, dcy, r + 3, GOLD.deep);
      disc(g, dcx, dcy, r + 2, GOLD.dark);
      disc(g, dcx - 1, dcy - 1, r + 1, GOLD.base);
      disc(g, dcx, dcy, r, '#2a1c12');
      disc(g, dcx, dcy + 1, r - 1, '#1a110c');
      for (let y = dcy + 4; y <= dcy + r; y++) { const w = Math.floor(Math.sqrt(Math.max(0, r * r - (y - dcy) * (y - dcy)))); R(g, dcx - w, y, w * 2 + 1, 1, y === dcy + 4 ? '#4a3524' : '#3a2a1c'); }
      R(g, dcx - 9, dcy - 5, 18, 1, TIMBER.dark); R(g, dcx - 9, dcy - 6, 18, 1, TIMBER.base);
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; D(g, Math.round(dcx + Math.cos(a) * (r + 2)), Math.round(dcy + Math.sin(a) * (r + 2)), k < 6 ? GOLD.dark : GOLD.hi); }
      if (INCOME <= 0) {
        // honest empty: a slumped empty sack, a cobweb and a mouse
        R(g, dcx + 2, dcy + 9, 7, 3, BURLAP.dark); R(g, dcx + 3, dcy + 8, 5, 1, BURLAP.base); D(g, dcx + 3, dcy + 9, BURLAP.light);
        for (let k = 0; k < 5; k++) { D(g, dcx - 9 + k, dcy - 9 + k, '#8a8478'); D(g, dcx - 9, dcy - 9 + k, '#6a665e'); D(g, dcx - 9 + k, dcy - 9, '#6a665e'); }
        D(g, dcx - 7, dcy - 5, '#8a8478'); D(g, dcx - 5, dcy - 7, '#8a8478');
        R(g, dcx - 6, dcy + 10, 3, 2, '#8c8890'); D(g, dcx - 7, dcy + 10, '#b4b0b8'); D(g, dcx - 3, dcy + 11, '#6a666e'); D(g, dcx - 7, dcy + 9, '#e0a0a8');
      } else {
        const hw = Math.round(3 + 8 * coinF), hh = Math.round(2 + 7 * coinF);
        coinMound(g, dcx - 1, dcy + 11, Math.min(hw, 11), Math.min(hh, 9));
        const towers = Math.floor(coinF * 5);
        for (let k = 0; k < towers; k++) coinTower(g, dcx - 10 + k * 5, dcy - 6, 1 + ((k * 7) % 3));
        if (coinF > 0.45) coinTower(g, dcx + 6, dcy + 10, 3 + Math.round(coinF * 3));
      }
      // the open door, swung to the right (edge-on disc)
      const ddx = dcx + r + 7;
      ellipse(g, ddx + 1, dcy, 5, r + 1, IRON.deep);
      ellipse(g, ddx, dcy, 5, r + 1, IRON.base);
      ellipse(g, ddx + 1, dcy, 3, r - 1, IRON.light);
      ellipse(g, ddx + 1, dcy, 2, r - 4, IRON.base);
      R(g, ddx - 5, dcy - r + 2, 1, r * 2 - 4, IRON.dark);
      for (let k = -r + 3; k < r - 2; k += 4) { D(g, ddx - 3, dcy + k, IRON.hi); D(g, ddx + 4, dcy + k, IRON.dark); }
      R(g, ddx, dcy - 4, 1, 9, GOLD.base); R(g, ddx - 1, dcy, 4, 1, GOLD.base); D(g, ddx + 1, dcy, GOLD.hi);
      D(g, ddx, dcy - 4, GOLD.hi); D(g, ddx, dcy + 4, GOLD.dark);
      R(g, dcx + r + 1, dcy - 8, 3, 3, IRON.dark); R(g, dcx + r + 1, dcy + 5, 3, 3, IRON.dark);
      // combination dial plate
      const dlx = VW - 14;
      disc(g, dlx, 22, 5, IRON.dark); disc(g, dlx, 22, 4, IRON.light); disc(g, dlx, 22, 2, IRON.base);
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; D(g, Math.round(dlx + Math.cos(a) * 4), Math.round(22 + Math.sin(a) * 4), IRON.deep); }
      D(g, dlx, 19, '#d8402e'); D(g, dlx - 1, 21, IRON.hi);
      // keystone with a coin emblem
      R(g, dcx - 3, 9, 7, 6, GRANITE.light); R(g, dcx - 3, 9, 7, 1, GRANITE.hi); R(g, dcx + 3, 9, 1, 6, GRANITE.dark);
      disc(g, dcx, 12, 1, GOLD.base); D(g, dcx - 1, 11, GOLD.hi);
      // wall lantern on the left
      R(g, 9, 18, 5, 1, IRON.dark); R(g, 10, 19, 4, 1, IRON.dark); R(g, 10, 20, 4, 6, LAMP.glass); R(g, 10, 20, 1, 6, IRON.dark); R(g, 13, 20, 1, 6, IRON.dark); R(g, 10, 26, 4, 1, IRON.dark); D(g, 11, 21, LAMP.hot);
      if (winter) { R(g, 0, 0, VW, 2, P.snow); dith(g, 0, 2, VW, 2, P.snow, 1); }
      if (LEVEL === 'critical') { R(g, VW - 6, -10, 1, 11, IRON.dark); R(g, VW - 5, -10, 5, 2, '#d8402e'); R(g, VW - 5, -8, 3, 1, '#d8402e'); }
    }, '#1f1a22');
    place(ctx, spr, VX, VY, [3, 1, 0.25]);
    if (INCOME > 0) {
      COIN_GLINTS.push([VDOOR.cx - 3, VDOOR.cy + 6], [VDOOR.cx + 2, VDOOR.cy + 8]);
      if (coinF > 0.45) COIN_GLINTS.push([VDOOR.cx + 8, VDOOR.cy + 1]);
      // spill on the step in front: sacks and loose coins (scaled by this month's income)
      const outside = build(48, 16, (g) => {
        const sacks = Math.min(4, Math.floor(coinF * 4.4));
        for (let k = 0; k < sacks; k++) sack(g, 22 + k * 7, 14 - (k & 1), true);
        if (coinF > 0.3) { const hw = Math.round(4 + 10 * (coinF - 0.3)), hh = Math.round(2 + 6 * (coinF - 0.3)); coinMound(g, 10, 13, hw, hh); }
        const loose = Math.round(coinF * 12);
        for (let k = 0; k < loose; k++) { const x = 2 + Math.floor(S.hash(k, 1, 55) * 44), y = 12 + Math.floor(S.hash(k, 2, 55) * 3); R(g, x, y, 2, 1, GOLD.base); D(g, x, y, GOLD.hi); D(g, x + 1, y + 1, GOLD.deep); }
      }, '#4a2c08');
      ctx.globalAlpha = 0.22; ctx.drawImage(outside.sil || (outside.sil = silhouette(outside)), VX + 6, VY + VH - 7); ctx.globalAlpha = 1;
      ctx.drawImage(outside, VX + 4, VY + VH - 9);
      if (coinF > 0.3) COIN_GLINTS.push([VX + 14, VY + VH + 1]);
    }
    // Grit's ledger on a lectern to the right of the vault
    const lect = build(14, 21, (g) => {
      R(g, 6, 8, 3, 12, TIMBER.base); R(g, 6, 8, 1, 12, TIMBER.light); R(g, 8, 8, 1, 12, TIMBER.dark);
      R(g, 3, 19, 9, 2, TIMBER.dark); R(g, 3, 19, 9, 1, TIMBER.light);
      R(g, 0, 4, 14, 5, TIMBER.dark); R(g, 1, 3, 12, 1, TIMBER.light);
      R(g, 1, 1, 6, 4, '#f2ead4'); R(g, 7, 1, 6, 4, '#e6dcc0'); R(g, 6, 1, 1, 4, '#a89c80');
      for (let k = 0; k < 3; k++) { R(g, 2, 2 + k, 4, 1, k === 1 ? '#7a7060' : '#b0a68e'); R(g, 8, 2 + k, 4, 1, k === 2 ? '#3a8a4a' : '#9a907a'); }
      R(g, 9, 5, 1, 3, '#c8402e');
      D(g, 13, 0, '#f4f0e8'); D(g, 12, 1, '#f4f0e8'); D(g, 11, 2, '#4a4048');
      if (winter) R(g, 1, 1, 12, 1, P.snow);
    }, OUT);
    place(ctx, lect, VX + VW + 3, VY + VH - 21, [2, 1, 0.25]);
  }

  /* ----- growth structures ----- */
  function headframe(ctx, s) {
    const winter = s === 'winter';
    const spr = build(40, 62, (g) => {
      ellipse(g, 20, 56, 13, 4, GRANITE.dark); ellipse(g, 20, 55, 12, 3, GRANITE.light); ellipse(g, 20, 55, 9, 2, '#0a0608');
      for (let k = 0; k < 50; k++) {
        const y = 54 - k, xl = Math.round(6 + k * 0.24), xr = Math.round(34 - k * 0.24);
        R(g, xl, y, 3, 1, TIMBER.base); D(g, xl, y, TIMBER.light); D(g, xl + 2, y, TIMBER.dark);
        R(g, xr - 2, y, 3, 1, TIMBER.base); D(g, xr - 2, y, TIMBER.light); D(g, xr, y, TIMBER.dark);
      }
      for (const y of [44, 30, 16]) { const k = 54 - y; timberH(g, Math.round(6 + k * 0.24), y, Math.round(28 - k * 0.48) + 3, 3); }
      for (let k = 0; k < 13; k++) { D(g, 10 + k, 31 + k, TIMBER.dark); D(g, 30 - k, 31 + k, TIMBER.dark); }
      disc(g, 20, 6, 6, IRON.dark); disc(g, 20, 6, 5, IRON.base); disc(g, 20, 6, 3, IRON.deep); disc(g, 20, 6, 1, IRON.light);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; D(g, Math.round(20 + Math.cos(a) * 3), Math.round(6 + Math.sin(a) * 3), IRON.light); }
      D(g, 16, 2, IRON.hi); D(g, 17, 1, IRON.hi);
      R(g, 25, 6, 1, 48, '#2a2830');
      R(g, 23, 48, 5, 5, COPPER.base); R(g, 23, 48, 5, 1, COPPER.hi); R(g, 27, 49, 1, 4, COPPER.dark); D(g, 24, 48, GOLD.base);
      if (winter) { R(g, 7, 43, 27, 1, P.snow); R(g, 11, 29, 19, 1, P.snow); R(g, 15, 0, 10, 1, P.snow); }
    }, '#21140e');
    place(ctx, spr, HEAD.x - 20, HEAD.base - 60, [4, 1, 0.2]);
  }
  function smelter(ctx, s) {
    const winter = s === 'winter';
    const spr = build(40, 50, (g) => {
      R(g, 26, 0, 8, 28, BRICK.base); R(g, 26, 0, 2, 28, BRICK.light); R(g, 32, 0, 2, 28, BRICK.dark);
      for (let y = 2; y < 28; y += 4) { R(g, 26, y, 8, 1, BRICK.deep); D(g, 29 + ((y >> 2) & 1) * 2, y + 1, BRICK.deep); }
      R(g, 25, 0, 10, 2, IRON.dark); R(g, 25, 0, 10, 1, IRON.light);
      const half = (y) => { const t = (y - 20) / 9; return y < 29 ? Math.round(17 * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)))) : 17; };
      for (let y = 20; y < 50; y++) R(g, 19 - half(y), y, half(y) * 2, 1, GRANITE.base);
      const rnd = S.rng(31337);
      for (let y = 22; y < 48; y += 5) for (let x = 2 + ((y / 5) & 1) * 3; x < 36; x += 6 + Math.floor(rnd() * 2)) { R(g, x, y, 5, 4, rnd() > 0.5 ? GRANITE.light : GRANITE.base); R(g, x, y + 3, 5, 1, GRANITE.dark); D(g, x, y, GRANITE.hi); }
      clipRows(g, (y) => { if (y < 20) return [26, 8]; const a = 19 - half(y), b = Math.max(19 + half(y), y < 28 ? 34 : 0); return [a, b - a]; }, 50);
      R(g, 11, 35, 14, 13, '#2a120c'); R(g, 12, 37, 12, 11, '#d8501e'); R(g, 14, 40, 8, 8, '#f8a030'); R(g, 16, 43, 4, 5, '#ffe08a');
      R(g, 10, 34, 16, 2, IRON.dark); R(g, 10, 34, 16, 1, IRON.light);
      for (let k = 0; k < 3; k++) { R(g, 26 + k * 4, 46 - (k % 2), 4, 2, GOLD.base); D(g, 26 + k * 4, 46 - (k % 2), GOLD.hi); }
      if (winter) R(g, 4, 20, 28, 1, P.snow);
    }, '#21140e');
    place(ctx, spr, SMELT.x, SMELT.base - 50, [4, 1, 0.22]);
  }
  function parkedCarts(ctx, s) {
    // a short siding with a parked ore cart in the yard pocket (it never moves)
    const y = 570;
    drawTrack(ctx, 1092, 1132, y, s === 'winter');
    groundShadow(ctx, 1112 + 2, y + 6, 9, 2, 0.28);
    const spr = build(18, 14, (g) => {
      R(g, 1, 2, 16, 9, IRON.base); R(g, 1, 2, 16, 1, IRON.hi); R(g, 0, 2, 1, 9, IRON.dark); R(g, 17, 2, 1, 9, IRON.dark);
      R(g, 2, 3, 14, 1, IRON.light); R(g, 1, 6, 16, 1, IRON.dark); for (const rx of [3, 8, 14]) D(g, rx, 4, IRON.hi);
      R(g, 2, 0, 14, 3, '#5e5048'); D(g, 4, 0, GOLD.base); D(g, 9, 1, COPPER.light); D(g, 12, 0, GOLD.hi); D(g, 6, 1, '#958680');
      disc(g, 4, 11, 2, IRON.deep); disc(g, 14, 11, 2, IRON.deep); D(g, 4, 11, IRON.light); D(g, 14, 11, IRON.light);
      if (s === 'winter') R(g, 2, 0, 14, 1, P.snow);
    }, OUT);
    place(ctx, spr, 1112 - 9, y - 9);
  }

  function drawBuildings(ctx) {
    const s = season(), winter = s === 'winter';
    CRYSTAL_INFO.length = 0; COIN_GLINTS.length = 0;
    // along the ridge (back row first)
    cottage(ctx, s);
    adit(ctx, s);
    mineEntrance(ctx, s);
    // station on the west rim
    drawStation(ctx, s);
    lampPost(ctx, 978, 528, winter);
    // mine yard
    toolRack(ctx, 1176, 528);
    if (GROWTH >= 1) wheelbarrow(ctx, 1114, 530);
    barrel(ctx, 1100, 532, winter);
    lampPost(ctx, 1130, 530, winter);
    // yard pocket between the paths
    if (GROWTH >= 3) parkedCarts(ctx, s);
    else { crate(ctx, 1094, 574, 10, 9, winter); barrel(ctx, 1108, 574, winter); oreHeap(ctx, 1126, 574, GROWTH >= 1 ? 6 : 4, winter); }
    // east strip
    if (GROWTH >= 2) headframe(ctx, s);
    else { oreHeap(ctx, 1194, 586, GROWTH >= 1 ? 7 : 5, winter); timberStack(ctx, 1180, 606, winter); }
    // spring and the crystal row
    springOutcrop(ctx, winter);
    lampPost(ctx, 924, 618, winter);
    for (const cr of CRYS) drawCrystal(ctx, cr, s);
    // vault and the south-east corner
    vault(ctx, s);
    if (GROWTH >= 3) smelter(ctx, s);
    else { sluice(ctx, 1176, 650, winter); barrel(ctx, 1200, 666, winter); }
  }

  /* ============================================================ register statics */
  S.registerStatic(6, (ctx) => drawGround(ctx));
  S.registerStatic(21, (ctx) => drawBuildings(ctx));

  /* ============================================================ lights (all bob with the island) */
  const L = (o) => S.addLight(Object.assign({ island: ISL }, o));
  L({ x: MOUTH.ox + 56, y: MOUTH.oy + 30, r: 34, color: P.lantern, intensity: 0.9, flicker: true });
  L({ x: MOUTH.x, y: MOUTH.oy + 40, r: 18, color: '#ff9a40', intensity: 0.45, flicker: true });
  L({ x: COT.x + 46, y: COT.y + 34, r: 24, color: P.lanternGlow, intensity: 0.75, flicker: true });
  L({ x: COT.x + 12, y: COT.y + 30, r: 18, color: P.lanternGlow, intensity: 0.6 });
  L({ x: VAULT.x + 12, y: VAULT.y + 23, r: 26, color: P.lantern, intensity: 0.8, flicker: true });
  if (INCOME > 0) L({ x: VDOOR.cx, y: VDOOR.cy + 6, r: 12 + Math.round(coinF * 14), color: P.gold, intensity: 0.35 + coinF * 0.35 });
  L({ x: STN.x + 33, y: STN.base - 15, r: 22, color: P.lanternGlow, intensity: 0.7, flicker: true });
  L({ x: STN.x + 9, y: STN.base - 14, r: 16, color: P.lanternGlow, intensity: 0.5 });
  L({ x: SIGNAL.x, y: SIGNAL.base - 24, r: 10, color: '#ff5a40', intensity: 0.5, nightOnly: false });
  for (const [x, y] of [[978, 528], [1130, 530], [924, 618]]) L({ x, y: y - 18, r: 28, color: P.lanternGlow, intensity: 0.8, flicker: true });
  for (const cr of CRYS) {
    const p = cr.goal.pct;
    L({ x: cr.x, y: cr.base - (p == null ? 6 : 10 + Math.round(p * 24)), r: p == null ? 10 : 16 + Math.round(p * 28), color: cr.gem.glow, intensity: p == null ? 0.2 : 0.35 + p * 0.55 });
  }
  if (GROWTH >= 3) L({ x: SMELT.x + 18, y: SMELT.base - 8, r: 32, color: '#ff8a3a', intensity: 0.9, flicker: true, nightOnly: false });

  /* ============================================================ hotspots */
  const lab = (k, extra) => ((LM[k] && LM[k].label) || k) + (extra ? ' · ' + extra : '');
  const hs = (key, label, x, y, w, h) => S.addHotspot({ id: 'landmark:' + key, kind: 'landmark', landmark: key, biome: ISL, island: ISL, agent: AGENT, label, x, y, w, h, priority: 1 });
  hs('mineEntrance', lab('mineEntrance'), MOUTH.ox + 6, MOUTH.oy, 54, 58);
  const FEED_ON = MET.bank_feed !== 'not connected' && (MET.month != null || INCOME > 0);
  hs('vault', lab('vault', INCOME > 0 ? money(INCOME) + ' in this month' : FEED_ON ? 'empty this month' : 'bank not connected yet'), VAULT.x - 2, VAULT.y - 4, VAULT.w + 20, VAULT.h + 14);
  for (const cr of CRYS) {
    const p = cr.goal.pct, top = p == null ? 18 : 26 + Math.round(p * 52);
    hs(cr.lm, lab(cr.lm, goalText(cr.goal)), cr.x - 23, cr.base - top, 46, top + 12);
  }
  hs('railStation', lab('railStation'), STN.x - 14, STN.base - 52, STN.w + 18, 60);

  /* ============================================================ dynamic: island-bound */
  const SPEED = RM ? 0.35 : 1;
  const sparkle = (ctx, x, y, k, col) => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, 1, 1);
    if (k > 0.45) { ctx.fillStyle = col; ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1); ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x, y + 1, 1, 1); }
    if (k > 0.8) { ctx.fillStyle = 'rgba(255,246,207,0.7)'; ctx.fillRect(x - 2, y, 1, 1); ctx.fillRect(x + 2, y, 1, 1); ctx.fillRect(x, y - 2, 1, 1); ctx.fillRect(x, y + 2, 1, 1); }
  };
  const sparks = RM ? SPARKS.filter((_, i) => i % 3 === 0) : SPARKS;

  // 100: stream ripples and the waterfall off the south rim
  const FALL = { w: 12, h: 104, frames: 8 };
  let fallFrames = null;
  function buildFall() {
    const frames = [];
    for (let f = 0; f < FALL.frames; f++) {
      const [c, g] = mk(FALL.w, FALL.h);
      for (let y = 0; y < FALL.h; y++) {
        const t = y / FALL.h;
        const half = 2.5 + t * 2.5 + (y < 3 ? 0.5 : 0);
        const cx = FALL.w / 2;
        // pixel fade: drop pixels by an ordered-dither threshold as the water falls into space
        const keep = 1 - smooth(clamp((t - 0.35) / 0.6, 0, 1));
        for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) {
          if (bayer(x, y + f * 3) > keep) continue;
          const streak = S.hash(x, Math.floor((y - f * (FALL.h / FALL.frames) * 0.5) / 5), 120);
          let col = x <= cx - half + 1 ? WATER.light : x >= cx + half - 1 ? WATER.deep : streak > 0.7 ? WATER.hi : streak > 0.35 ? WATER.light : WATER.base;
          if (y < 3) col = WATER.foam;
          D(g, x, y, col);
        }
        // spray droplets beside the column
        if (y > 8 && S.hash(f, y, 121) > 0.9 && keep > 0.15) D(g, S.hash(f, y, 122) > 0.5 ? Math.floor(cx - half - 1) : Math.ceil(cx + half), y, WATER.hi);
      }
      frames.push(c);
    }
    return frames;
  }
  S.registerDynamic(100, (ctx, t) => {
    const tt = t * SPEED;
    // ripples running down the stream
    for (let k = 0; k < 6; k++) {
      const u = ((tt * 0.35 + k / 6) % 1);
      const fy = STREAM[0][1] + u * (LIP.y - STREAM[0][1]);
      let i = 0; while (i + 2 < STREAM.length && STREAM[i + 1][1] < fy) i++;
      const [ax, ay] = STREAM[i], [bx, by] = STREAM[i + 1];
      const x = Math.round(ax + (bx - ax) * clamp((fy - ay) / Math.max(1, by - ay), 0, 1)) + ((k & 1) ? 0 : -1);
      ctx.fillStyle = WATER.hi; ctx.fillRect(x, Math.round(fy), 2, 1);
      ctx.fillStyle = WATER.light; ctx.fillRect(x - 1, Math.round(fy) + 1, 1, 1);
    }
    // the waterfall
    if (!fallFrames) fallFrames = buildFall();
    const f = Math.floor(tt * 10) % FALL.frames;
    ctx.drawImage(fallFrames[f], LIP.x - FALL.w / 2, LIP.y - 2);
    // splash at the rim
    const sp = Math.floor(tt * 6) % 3;
    ctx.fillStyle = WATER.foam; ctx.fillRect(LIP.x - 4 + sp, LIP.y - 3, 1, 1); ctx.fillRect(LIP.x + 3 - sp, LIP.y - 2, 1, 1);
  }, { island: ISL });

  // 200: sparkles and lantern flames
  S.registerDynamic(200, (ctx, t) => {
    const tt = t * SPEED;
    for (const sp of sparks) {
      const v = Math.sin(tt * sp.sp + sp.ph);
      if (v > 0.9) sparkle(ctx, sp.x, sp.y, (v - 0.9) / 0.1, sp.gold ? GOLD.light : '#ffd8b0');
    }
    for (let i = 0; i < COIN_GLINTS.length; i++) {
      const v = Math.sin(tt * 1.3 + i * 2.1);
      if (v > 0.93) sparkle(ctx, COIN_GLINTS[i][0], COIN_GLINTS[i][1], (v - 0.93) / 0.07, GOLD.light);
    }
    // crystal glints: a star at the tip and light sliding over the facets
    for (let i = 0; i < CRYSTAL_INFO.length; i++) {
      const ci = CRYSTAL_INFO[i], p = ci.cr.goal.pct, col = ci.cr.gem.light;
      const v = Math.sin(tt * (0.9 + i * 0.17) + i * 2.3);
      if (v > (p == null ? 0.97 : 0.86)) sparkle(ctx, ci.tip[0], ci.tip[1] + 1, (v - 0.86) / 0.14, col);
      if (ci.glints.length) {
        const g = ci.glints[Math.floor(tt * 0.8 + i) % ci.glints.length], ph = (tt * 0.8 + i) % 1;
        if (ph < 0.3 && p != null) sparkle(ctx, g[0], g[1], 1 - ph / 0.3, col);
      }
    }
    // lantern flames
    const fl = RM ? 0 : (Math.sin(t * 9.1) + Math.sin(t * 13.7)) * 0.5;
    ctx.fillStyle = fl > 0.3 ? '#fff6cf' : '#ffe08a';
    ctx.fillRect(MOUTH.ox + 56, MOUTH.oy + 29 + (fl > 0.6 ? 0 : 1), 1, 1);
    ctx.fillRect(VAULT.x + 12, VAULT.y + 21 + (fl < -0.5 ? 1 : 0), 1, 1);
    ctx.fillRect(COT.x + 46, COT.y + 32 + (fl > 0.2 ? 0 : 1), 1, 1);
    ctx.fillRect(STN.x + 34, STN.base - 16 + (fl > 0 ? 0 : 1), 1, 1);
    // the signal lamp blinks red while nobody rides, green every few seconds (a cart is due)
    const green = Math.floor(tt / 4) % 3 === 0;
    ctx.fillStyle = green ? '#8cf0b0' : '#ff8a70';
    ctx.fillRect(SIGNAL.x, SIGNAL.base - (green ? 21 : 25), 1, 1);
  }, { island: ISL });

  // 400: chimney smoke (cottage always; smelter at growth 3)
  const SMOKES = [{ x: COT.x + 42, y: COT.y - 1, n: RM ? 2 : 5, sp: 0.18 }];
  if (GROWTH >= 3) SMOKES.push({ x: SMELT.x + 30, y: SMELT.base - 51, n: RM ? 3 : 8, sp: 0.26 });
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
  }, { island: ISL });

  // 700: crystal glow (always a little, stronger at night) and the warm mine mouth
  const glowCache = {};
  function glowSprite(color, r) {
    const key = color + r;
    if (glowCache[key]) return glowCache[key];
    const [c, g] = mk(r * 2 + 1, r * 2 + 1);
    const [cr, cg, cb] = rgb(color);
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + (y * y) * 1.4) / r;
      if (d > 1) continue;
      const a = Math.pow(1 - d, 1.6);
      // banded, dithered falloff for a pixel-art glow
      const q = Math.floor(a * 5) / 5 + (bayer(x + r, y + r) - 0.5) * 0.12;
      if (q <= 0.02) continue;
      g.fillStyle = `rgba(${cr},${cg},${cb},${clamp(q, 0, 1).toFixed(3)})`;
      g.fillRect(x + r, y + r, 1, 1);
    }
    return (glowCache[key] = c);
  }
  S.registerDynamic(700, (ctx, t) => {
    const night = 1 - clamp(S.time.light == null ? 1 : S.time.light, 0, 1);
    const tt = t * SPEED;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < CRYSTAL_INFO.length; i++) {
      const ci = CRYSTAL_INFO[i], p = ci.cr.goal.pct;
      const r = p == null ? 9 : 14 + Math.round(p * 22);
      const pulse = RM ? 1 : 0.85 + 0.15 * Math.sin(tt * 1.4 + i * 1.9);
      const a = (p == null ? 0.1 + 0.18 * night : (0.18 + 0.45 * p) * (0.5 + 0.9 * night)) * pulse;
      const cy = Math.round((ci.tip[1] + ci.cr.base) / 2);
      // after dark the gems shine through the night: redraw them over the darkness, brighter as the goal fills
      if (night > 0.05) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = clamp(night * (p == null ? 0.45 : 0.6 + 0.4 * p), 0, 1);
        ctx.drawImage(ci.spr, ci.sx - 1, ci.sy - 1);
        ctx.globalCompositeOperation = 'lighter';
      }
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.drawImage(glowSprite(ci.cr.gem.glow, r), ci.cr.x - r, cy - r);
      // lit ring stones glow at night
      if (night > 0.2) {
        ctx.globalAlpha = clamp(0.9 * night, 0, 1);
        ctx.fillStyle = ci.cr.gem.light;
        for (const [x, y, lit] of ci.ring) if (lit) { ctx.fillRect(x - 1, y - 1, 2, 2); }
        ctx.globalAlpha = clamp(0.35 * night, 0, 1);
        ctx.fillStyle = ci.cr.gem.glow;
        for (const [x, y, lit] of ci.ring) if (lit) { ctx.fillRect(x - 2, y - 2, 4, 4); }
      }
    }
    if (night > 0.2) {
      const spr = glowSprite('#ff9a40', 12);
      ctx.globalAlpha = 0.35 * night * (RM ? 1 : 0.9 + 0.1 * Math.sin(t * 7.3));
      ctx.drawImage(spr, MOUTH.x - 12, MOUTH.oy + 34 - 12);
    }
    ctx.restore();
  }, { island: ISL });

  /* ============================================================ the sky-rail bridge (dyn 200, no island) */
  // Rail centre polyline from Clockspire's abutment end to the Copperhold rim (native px).
  const BR = (function () {
    const pts = RAILS.map(([x, y]) => [x * T + 8, y * T + 8]);
    if (pts.length < 2) return null;
    // the line runs station -> Clockspire; keep it, but trim the square end at its abutment and the mine end at our rim
    const a = pts[0], z = pts[pts.length - 1];
    a[0] = TRACK.x0 + 6;
    z[0] = Math.max(z[0], 809);
    return { pts: pts.reverse(), sx: 809, mx: TRACK.x0 + 6 };   // now runs Clockspire (west) -> mine (east)
  })();
  const BRAD = 12;
  function buildBridge(s) {
    const winter = s === 'winter';
    const pts = BR.pts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    x0 -= 10; x1 += 4; y0 -= 22; y1 += 50;
    const [c, g] = mk(x1 - x0, y1 - y0);
    g.translate(-x0, -y0);
    // Build the centre path with rounded corners as dense samples [x, y, dirx, diry].
    const samp = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      let [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const dx = Math.sign(bx - ax), dy = Math.sign(by - ay);
      if (i > 0) { ax += dx * BRAD; ay += dy * BRAD; }
      if (i + 2 < pts.length) { bx -= dx * BRAD; by -= dy * BRAD; }
      const len = Math.abs(bx - ax) + Math.abs(by - ay);
      for (let k = 0; k <= len; k++) samp.push([ax + dx * k, ay + dy * k, dx, dy]);
      if (i + 2 < pts.length) {
        const [cx, cy] = pts[i + 1], [nx, ny] = pts[i + 2];
        const ex = Math.sign(nx - cx), ey = Math.sign(ny - cy);
        const ox = cx - dx * BRAD + ex * BRAD, oy = cy - dy * BRAD + ey * BRAD;   // arc centre
        for (let th = 0; th <= Math.PI / 2; th += 1 / (BRAD * 2)) {
          const ux = -ex * Math.cos(th) + dx * Math.sin(th), uy = -ey * Math.cos(th) + dy * Math.sin(th);
          samp.push([ox + BRAD * ux, oy + BRAD * uy, dx * Math.cos(th) + ex * Math.sin(th), dy * Math.cos(th) + ey * Math.sin(th)]);
        }
      }
    }
    const horiz = (d) => Math.abs(d[2]) > Math.abs(d[3]);
    // 1) truss girder hanging under the east-west spans (front faces are visible)
    for (const sm of samp) {
      if (!horiz(sm)) continue;
      const x = Math.round(sm[0]), y = Math.round(sm[1]);
      const top = y + 7, bot = y + 17;
      R(g, x, top, 1, 2, COPPER.base); D(g, x, top, COPPER.hi);
      R(g, x, bot - 2, 1, 2, COPPER.dark); D(g, x, bot - 1, COPPER.deep);
      const ph = ((x % 12) + 12) % 12;
      const dy = ph < 6 ? ph : 12 - ph;                     // Warren truss zig-zag
      R(g, x, top + 2 + Math.round(dy * 1.0), 1, 2, IRON.base);
      D(g, x, top + 2 + Math.round(dy * 1.0), IRON.light);
      if (ph === 0) R(g, x, top + 2, 1, bot - top - 4, IRON.dark);
      if (ph === 0 || ph === 6) { D(g, x, top + 1, COPPER.deep); D(g, x, bot - 2, GOLD.dark); }
      D(g, x, bot, OUT);
      if (winter && S.hash(x, 1, 130) > 0.3) D(g, x, top, P.snow);
    }
    // 2) deck: two dark stringers, then ties with gaps that show space underneath
    for (const sm of samp) {
      const [x, y, dx, dy] = sm, nx = -dy, ny = dx;
      for (const o of [-4, 3]) { D(g, x + nx * o, y + ny * o, IRON.deep); D(g, x + nx * (o + 1), y + ny * (o + 1), IRON.dark); }
    }
    let acc = 0;
    for (let i = 0; i < samp.length; i++) {
      const [x, y, dx, dy] = samp[i], nx = -dy, ny = dx;
      acc++;
      if (acc % 5 !== 0) continue;
      for (let o = -7; o <= 7; o++) {
        const px0 = x + nx * o, py0 = y + ny * o;
        D(g, px0, py0, o === -7 ? '#4a321f' : o < -4 ? '#8d6640' : '#6b4a2e');
        D(g, px0 + dx, py0 + dy, o === 7 ? '#3a2614' : '#5a3d24');
        if (winter && o < 0) D(g, px0, py0, P.snow);
      }
    }
    // 3) rails
    for (const sm of samp) {
      const [x, y, dx, dy] = sm, nx = -dy, ny = dx;
      for (const o of [-5, 4]) {
        D(g, x + nx * o, y + ny * o, '#c8cdd8');
        D(g, x + nx * (o + 1), y + ny * (o + 1), '#7d869a');
      }
    }
    // 4) a floating pier rock that carries the elbow nearest the mine
    const el = pts.length >= 3 ? pts[pts.length - 2] : null;
    const lamps = [];
    let gem = null;
    if (el) {
      const [ex, ey] = el, rx0 = ex - 1, ry0 = ey + 24;
      R(g, ex - 4, ey + 6, 8, ry0 - ey - 4, GRANITE.base); R(g, ex - 4, ey + 6, 2, ry0 - ey - 4, GRANITE.light); R(g, ex + 2, ey + 6, 2, ry0 - ey - 4, GRANITE.dark);
      for (let y = ey + 9; y < ry0; y += 4) R(g, ex - 4, y, 8, 1, GRANITE.dark);
      // the rock: lit top, strata, tapering to a point, with a gold crystal
      for (let j = 0; j < 16; j++) {
        const hw = Math.round(10 * (1 - Math.pow(j / 16, 1.3)) + (j < 2 ? -2 + j : 0));
        for (let i = -hw; i <= hw; i++) {
          const x = rx0 + i, y = ry0 + j;
          let col = j < 2 ? '#e2b574' : ((j >> 2) & 1) ? '#a04e28' : '#c07d38';
          if (i > hw - 2) col = '#55241a'; else if (i < -hw + 2 && j > 1) col = '#dc9e55';
          if (j > 2 && S.hash(x, y, 131) > 0.85) col = '#743220';
          if (winter && j < 2) col = P.snow;
          D(g, x, y, col);
        }
        D(g, rx0 - hw - 1, ry0 + j, OUT); D(g, rx0 + hw + 1, ry0 + j, OUT);
      }
      R(g, rx0 - 8, ry0 - 1, 17, 1, OUT);
      R(g, rx0 + 3, ry0 + 5, 2, 4, GOLD.base); D(g, rx0 + 3, ry0 + 5, GOLD.hi); D(g, rx0 + 4, ry0 + 8, GOLD.dark);
      gem = [rx0 + 3, ry0 + 5];
      for (const [hx, len] of [[rx0 - 5, 6], [rx0 + 1, 9], [rx0 + 6, 4]]) for (let k = 0; k < len; k++) D(g, hx + (k > len / 2 ? 1 : 0), ry0 + 12 + k - (hx > rx0 ? 4 : 0), k < len - 1 ? '#5a3a22' : '#3e2a1a');
    }
    // 5) lamp posts on the deck edge, midway along each span but the first
    for (let i = 1; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      if (ay === by) lamps.push([Math.round((ax + bx) / 2), ay - 7]);       // east-west span: north edge
      else lamps.push([ax - 7, Math.round((ay + by) / 2) + 3]);             // north-south span: west edge
    }
    for (const [lx, ly] of lamps) {
      R(g, lx, ly - 12, 1, 12, IRON.dark); D(g, lx, ly - 12, IRON.light);
      R(g, lx - 2, ly - 17, 5, 1, IRON.dark); R(g, lx - 2, ly - 16, 5, 4, OUT); R(g, lx - 1, ly - 16, 3, 3, LAMP.glass); D(g, lx - 1, ly - 16, LAMP.hot);
      R(g, lx - 2, ly - 12, 5, 1, IRON.dark);
      if (winter) R(g, lx - 2, ly - 18, 5, 1, P.snow);
    }
    return {
      canvas: c, x0, y0, w: x1 - x0, h: y1 - y0,
      lamps: lamps.map(([lx, ly]) => [lx, ly - 14]),
      glass: lamps.map(([lx, ly]) => [lx - 1 - x0, ly - 16 - y0]),   // canvas-local lamp glass (3x3)
      gem,                                                            // pier-rock crystal (2x4), world px
    };
  }
  let bridge = null, bridgeSeason = null;
  const uAt = (x) => clamp((BR.mx - x) / (BR.mx - BR.sx), 0, 1);
  const nightAmt = () => 1 - clamp(S.time.light == null ? 1 : S.time.light, 0, 1);

  /* Night tint for the span out in space. The atmosphere darkens each island through a mask
   * cut to its static art (alpha > 96 in S.islandLayers), so the bridge pixels that rest on
   * Clockspire or Copperhold are already darkened there, and everything over open space would
   * stay day-bright. Tint a copy of the bridge with the same sky (multiply, then the veil)
   * everywhere except over island art: no seam at the abutments and nothing darkened twice.
   * Rebuilt only when the sky key, the season (bridge canvas) or the static art changes. */
  const tint = { bridge: null, layers: null, isle: null, c: null, g: null, key: '' };
  function islandPart(b) {
    if (tint.isle && tint.bridge === b && tint.layers === S.islandLayers) return tint.isle;
    const mask = new Uint8Array(b.w * b.h);
    for (const L of S.islandLayers || []) {
      const ix0 = Math.max(b.x0, L.x), iy0 = Math.max(b.y0, L.y);
      const iw = Math.min(b.x0 + b.w, L.x + L.w) - ix0, ih = Math.min(b.y0 + b.h, L.y + L.h) - iy0;
      if (iw <= 0 || ih <= 0) continue;
      const [rc, rg] = mk(iw, ih);
      rg.drawImage(L.canvas, ix0 - L.x, iy0 - L.y, iw, ih, 0, 0, iw, ih);
      const d = rg.getImageData(0, 0, iw, ih).data;
      for (let j = 0; j < ih; j++) for (let i = 0; i < iw; i++) {
        if (d[(j * iw + i) * 4 + 3] > 96) mask[(iy0 - b.y0 + j) * b.w + (ix0 - b.x0 + i)] = 1;
      }
      rc.width = rc.height = 1;
    }
    // the bridge's own pixels where island art lies underneath
    const [ic, ig] = mk(b.w, b.h);
    const img = ig.createImageData(b.w, b.h), md = img.data;
    for (let k = 0; k < mask.length; k++) if (mask[k]) md[k * 4 + 3] = 255;
    ig.putImageData(img, 0, 0);
    ig.globalCompositeOperation = 'source-in';
    ig.drawImage(b.canvas, 0, 0);
    ig.globalCompositeOperation = 'source-over';
    tint.isle = ic; tint.layers = S.islandLayers;
    return ic;
  }
  function bridgeArt(b) {
    const sk = S.atmo && typeof S.atmo.sky === 'function' ? S.atmo.sky() : null;
    if (!sk || (sk.mul === '#ffffff' && !(sk.la > 0.002))) return b.canvas;
    const lit = nightAmt() >= 0.25;                       // same switch as the lamp glow at 700
    const key = sk.key + (lit ? '|lit' : '');
    if (tint.c && tint.key === key && tint.bridge === b && tint.layers === S.islandLayers) return tint.c;
    if (tint.bridge !== b) tint.isle = null;
    const isle = islandPart(b);
    tint.bridge = b;
    if (!tint.c || tint.c.width !== b.w || tint.c.height !== b.h) [tint.c, tint.g] = mk(b.w, b.h);
    const g = tint.g;
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'copy'; g.drawImage(b.canvas, 0, 0);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = sk.mul; g.fillRect(0, 0, b.w, b.h);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(b.canvas, 0, 0);
    if (sk.la > 0.002) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = C.rgba(sk.lift, Math.min(0.85, sk.la).toFixed(3)); g.fillRect(0, 0, b.w, b.h); }
    // over island art: the untinted bridge (the island darkness at 600 covers it)
    g.globalCompositeOperation = 'destination-out'; g.drawImage(isle, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.drawImage(isle, 0, 0);
    if (lit) {
      // lamp glass and the pier-rock crystal give off light, so they keep their own colours
      for (const [gx, gy] of b.glass) { R(g, gx, gy, 3, 3, LAMP.glass); D(g, gx, gy, LAMP.hot); }
      if (b.gem) { const gx = b.gem[0] - b.x0, gy = b.gem[1] - b.y0; R(g, gx, gy, 2, 4, GOLD.base); D(g, gx, gy, GOLD.hi); D(g, gx + 1, gy + 3, GOLD.dark); }
    }
    tint.key = key;
    return tint.c;
  }
  if (BR) S.registerDynamic(200, (ctx) => {
    const s = season();
    if (!bridge || bridgeSeason !== s) { bridge = buildBridge(s); bridgeSeason = s; }
    const b = bridge, art = bridgeArt(b);
    // each 1-px column follows the bob interpolated between the two islands, so the bridge stays attached to both
    for (let i = 0; i < b.w; i++) {
      const x = b.x0 + i;
      const off = S.bobBetween(ISL, 'square', uAt(x));
      ctx.drawImage(art, i, 0, 1, b.h, x, b.y0 + off, 1, b.h);
    }
  });
  if (BR) S.registerDynamic(700, (ctx, t) => {
    const night = nightAmt();
    if (!bridge || night < 0.25) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const spr = glowSprite(P.lanternGlow, 10);
    for (const [lx, ly] of bridge.lamps) {
      ctx.globalAlpha = 0.55 * night * (RM ? 1 : 0.9 + 0.1 * Math.sin(t * 8 + lx));
      ctx.drawImage(spr, lx - 10, ly - 10 + S.bobBetween(ISL, 'square', uAt(lx)));
    }
    if (bridge.gem) {
      const [gx, gy] = bridge.gem, gs = glowSprite(GEMS.gold.glow, 6);
      ctx.globalAlpha = 0.4 * night;
      ctx.drawImage(gs, gx + 1 - 6, gy + 2 - 6 + S.bobBetween(ISL, 'square', uAt(gx)));
    }
    ctx.restore();
  });
})();
