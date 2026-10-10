/* The Shack — Highland Monastery (Abbot Quill, academic-core).
 *
 * Owns region "monastery" (tiles x 6..25, y 0..14) and the Hudson Highlands
 * cliffs along the north edge. Static: highland turf, courtyard and cliffs
 * (order 5); temple, library wing, pagoda, bell pavilion, scroll board,
 * lanterns, study garden and trees (order 20). Dynamic: waterfall (100), bell,
 * scrolls and lantern flames (200), incense smoke, prayer flags, mist and the
 * critical pennant (400), scroll and flame glow (700).
 *
 * Data: glowing scrolls on the board = upcoming deadlines from
 * metrics('academic-core').deadlines (empty board when there are none). The
 * study desk shows today's study blocks (open book, lit candle) and Quizlet
 * prep sets (flash-card stack). Nothing is invented.
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S) return;

  const T = S.TILE, P = S.PAL, C = S.color;
  const AGENT = 'academic-core';
  const REG = S.regions.monastery;
  const RX0 = REG.x * T, RY0 = REG.y * T, RX1 = (REG.x + REG.w) * T, RY1 = (REG.y + REG.h) * T;
  const GROWTH = ((S.status && S.status.monastery) || {}).growth | 0;

  /* ------------------------------------------------------------- palette */
  const OUT = P.outline;
  const JADE = { deep: '#123a35', dark: '#1d5e51', base: '#2b836c', light: '#46a789', hi: '#86d3b4' };
  const VERM = { deep: '#5e1a14', dark: '#8e2a1e', base: '#c63f2b', light: '#e6684a', hi: '#f59a72' };
  const WOOD = { deep: '#38200f', dark: '#563219', base: '#7a4a2a', light: '#9d6a3e', hi: '#bf8c58' };
  const PLAS = { dark: '#c4b28c', base: '#e8dcc0', light: '#f6eedb' };
  const GRAN = { deep: '#3a3545', dark: '#534d5d', base: '#6f6876', light: '#8f8791', hi: '#b6aaad' };
  const STONE = { deep: '#3e4250', dark: '#5a5f6d', base: '#7c818d', light: '#a0a4ad', hi: '#c6c8cc' };
  const BRONZE = { deep: '#3b2a17', dark: '#6b4a24', base: '#9a6d34', light: '#c99a50', hi: '#f0cf84', patina: '#5aa58a' };
  const SAND = { dark: '#bfae86', base: '#ddd0ad', light: '#efe6cc' };
  const PAPER = '#f5ecd2', INK = '#3a2f2a';
  const FLAG = ['#3a6fd4', '#f1eee4', '#d6402f', '#3c9a5a', '#f0c23e'];
  const FLAG_DARK = FLAG.map((c) => S.color.shade(c, -0.25));
  const SHADOW_INK = '#140f1e';

  /* ------------------------------------------------------- tiny helpers */
  const rgb = (h) => C.hexToRgb(h);
  const mixA = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pad2 = (n) => String(n).padStart(2, '0');
  function vnoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const sm = (t) => t * t * (3 - 2 * t);
    const a = S.hash(xi, yi, seed), b = S.hash(xi + 1, yi, seed), c = S.hash(xi, yi + 1, seed), d = S.hash(xi + 1, yi + 1, seed);
    const u = sm(xf), v = sm(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w); c.height = Math.max(1, h);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    return [c, g];
  }
  const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const D = (g, x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };

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
  /** Draw a built sprite so that its local (0,0) lands on world (x,y); sh = [dx, dy, alpha] drop shadow. */
  function place(ctx, spr, x, y, sh) {
    if (sh) {
      ctx.globalAlpha = sh[2] || 0.26;
      ctx.drawImage(spr.sil || (spr.sil = silhouette(spr)), Math.round(x - 1 + sh[0]), Math.round(y - 1 + sh[1]));
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(spr, Math.round(x - 1), Math.round(y - 1));
  }
  /** Soft dithered contact shadow (an ellipse) on the ground. */
  function groundShadow(ctx, cx, cy, rx, ry, a) {
    ctx.fillStyle = C.rgba(SHADOW_INK, a == null ? 0.22 : a);
    for (let y = -ry; y <= ry; y++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.5))));
      ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
    }
  }

  /* ------------------------------------------------------------ seasons */
  const season = () => (S.time && S.time.season) || 'autumn';
  function foliagePal(kind, s) {
    if (s === 'autumn') {
      if (kind === 0) return { dark: '#7c2620', base: '#b9392a', light: '#de5a31', hi: '#f39a4a', ol: '#3a1311' };
      if (kind === 1) return { dark: '#984a22', base: P.leaf.autumn, light: '#ec9a42', hi: '#f7c766', ol: '#45210f' };
      return { dark: '#9a6a26', base: P.leafAlt.autumn, light: '#f1c75e', hi: '#fbe39a', ol: '#47300f' };
    }
    if (s === 'spring') {
      if (kind === 1) return { dark: '#4e8a34', base: P.leaf.spring, light: '#9ad672', hi: '#c6ec9c', ol: '#24401a' };
      return { dark: '#b8678a', base: P.leafAlt.spring, light: '#f8c9da', hi: '#fff1f6', ol: '#5a2a3c' };
    }
    if (s === 'summer') return { dark: '#2b5520', base: P.leaf.summer, light: '#69a845', hi: '#98cf68', ol: '#15301a' };
    return null; // winter: bare
  }
  const PINE = { dark: '#1d3729', base: '#2c553b', light: '#467a4c', hi: '#6d9b63', ol: '#10201a' };

  /* ---------------------------------------------------------- data feeds */
  const nyToday = () => { const p = S.time && S.time.ny ? S.time.ny : S.nyParts(S.now()); return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`; };
  const metrics = () => S.metrics(AGENT) || {};
  function upcomingDeadlines() {
    const list = Array.isArray(metrics().deadlines) ? metrics().deadlines : [];
    const today = nyToday();
    return list
      .filter((d) => d && (!d.due || String(d.due).slice(0, 10) >= today))
      .sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')));
  }
  function daysUntil(due) {
    if (!due) return 99;
    const a = Date.parse(String(due).slice(0, 10) + 'T12:00:00Z'), b = Date.parse(nyToday() + 'T12:00:00Z');
    return isFinite(a) && isFinite(b) ? Math.round((a - b) / 864e5) : 99;
  }
  function studyToday() {
    const list = Array.isArray(metrics().study_blocks) ? metrics().study_blocks : [];
    const today = nyToday();
    return list.filter((b) => b && String(b.start || '').slice(0, 10) === today).length;
  }
  const prepSets = () => (Array.isArray(metrics().prep_sets) ? metrics().prep_sets.length : 0);

  /* ============================================================ GEOMETRY
   * All in native px. Footprints are reserved at load below.
   */
  const TEMPLE = { x: 172, y: 30, w: 168, h: 112 };      // sprite origin, cx = 256
  const TCX = TEMPLE.x + 84;
  const LIBRARY = { x: 334, y: 54, w: 74, h: 72 };
  const PAGODA = { x: 118, y: 30, w: 46, h: 108 };
  const PAVILION = { x: 110, y: 142, w: 50, h: 54 };
  const BELL = { x: PAVILION.x + 25, y: PAVILION.y + 19 };   // pivot (top of bell)
  const BOARD = { x: 182, y: 144, w: 38, h: 36 };
  const GARDEN = { x: 288, y: 146, w: 112, h: 58 };
  const CENSER = { x: TCX, y: TEMPLE.y + 84 };            // feet on the terrace
  const FALL = { x0: 99, x1: 105 };                        // waterfall columns

  // Stone lanterns (feet positions). More with growth.
  const LANTERNS = [[230, 150], [282, 150]];
  if (GROWTH >= 1) LANTERNS.push([230, 196], [282, 196]);
  if (GROWTH >= 3) LANTERNS.push([172, 198], [360, 222]);

  // Trees: [x feet, y feet, kind ('maple'|'pine'), size, seed]
  const TREES = [
    [104, 212, 'maple', 20, 11], [146, 232, 'maple', 22, 12], [186, 222, 'pine', 14, 13], [214, 236, 'maple', 18, 14],
    [122, 120, 'pine', 14, 15], [404, 140, 'pine', 13, 16], [384, 232, 'maple', 20, 17], [100, 136, 'maple', 16, 18],
  ];
  if (GROWTH < 3) TREES.push([140, 96, 'maple', 22, 19], [160, 128, 'maple', 16, 20]);
  if (GROWTH < 1) TREES.push([370, 104, 'maple', 20, 21], [352, 128, 'pine', 12, 22]);

  /* ----------------------------------------------------- reserve tiles */
  (function reserveAll() {
    const rpx = (x, y, w, h) => {
      const tx0 = Math.floor(x / T), ty0 = Math.floor(y / T), tx1 = Math.floor((x + w - 1) / T), ty1 = Math.floor((y + h - 1) / T);
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (!S.onRoad(tx, ty)) S.reserve(tx, ty);
    };
    S.reserve(5, 0, 21, 3);               // cliff band above the monastery
    S.reserve(26, 0, 10, 2);              // the ridge tapering east behind School Hill
    S.reserve(5, 3, 3, 2);                // waterfall pool
    rpx(TEMPLE.x + 6, TEMPLE.y, 156, 112);
    rpx(PAVILION.x, PAVILION.y, PAVILION.w, PAVILION.h);
    rpx(BOARD.x, BOARD.y, BOARD.w, BOARD.h);
    rpx(GARDEN.x, GARDEN.y, GARDEN.w, GARDEN.h);
    rpx(176, 136, 112, 66);               // courtyard paving
    if (GROWTH >= 2) rpx(LIBRARY.x, LIBRARY.y, LIBRARY.w, LIBRARY.h);
    if (GROWTH >= 3) rpx(PAGODA.x, PAGODA.y, PAGODA.w, PAGODA.h);
    for (const [x, y] of LANTERNS) rpx(x - 5, y - 20, 10, 20);
    for (const [x, y] of TREES) rpx(x - 4, y - 8, 8, 8);
    rpx(364, 206, 16, 18);                // dovecote
  })();

  /* ============================================================ GROUND (5)
   * Highland turf, courtyard paving and a gravel path, drawn per pixel.
   */
  function drawGround(ctx) {
    const s = season();
    const w = RX1 - RX0, h = RY1 - RY0;
    const [c, g] = mk(w, h);
    const im = g.createImageData(w, h), d = im.data;
    const gA = rgb(P.grassDark[s]), gB = rgb(P.grass[s]);
    const cool = rgb(s === 'winter' ? '#c9d6e2' : '#5f7259');
    const dry = rgb(s === 'winter' ? '#ffffff' : s === 'autumn' ? '#b2a457' : '#88b85a');
    const pave = (x, y) => x >= 176 && x < 290 && y >= 136 && y < 204;
    // Courtyard pavers: rows 7 px tall, stones 8..13 px wide with a per-row offset.
    const rowsB = [];
    for (let r = 0; r < 10; r++) {
      const b = []; let x = 170 + Math.floor(S.hash(r, 3, 41) * 9);
      while (x < 300) { b.push(x); x += 8 + Math.floor(S.hash(x, r, 42) * 6); }
      b.push(x); rowsB.push(b);
    }
    const stoneTones = [rgb(STONE.dark), rgb(STONE.base), rgb(STONE.light), rgb(STONE.hi)];
    const mortar = rgb('#4b4a52'), moss = rgb(s === 'winter' ? '#e9eef2' : P.grassDark[s]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const wx = x + RX0, wy = y + RY0, i = (y * w + x) * 4;
      // Soft dithered edge on the west, east and south borders.
      const edge = Math.min(wx - RX0, RX1 - 1 - wx, RY1 - 1 - wy);
      if (edge < 10 && S.hash(wx, wy, 7) * 10 > edge) continue;
      let col;
      const n = vnoise(wx / 18, wy / 18, 3) * 0.65 + vnoise(wx / 6, wy / 6, 4) * 0.35;
      col = mixA(gA, gB, clamp(n * 1.25 - 0.1, 0, 1));
      col = mixA(col, cool, 0.18);
      const hh = S.hash(wx, wy, 5);
      if (hh > 0.955) col = mixA(col, dry, 0.7);
      else if (hh < 0.04) col = mixA(col, [30, 30, 40], 0.25);
      // Tufts: a light blade with a darker root below.
      if (S.hash(wx >> 1, wy, 6) > 0.985) col = mixA(col, dry, 0.5);
      if (pave(wx, wy)) {
        const r = Math.floor((wy - 136) / 7), ly = (wy - 136) % 7, b = rowsB[r];
        let k = 0; while (k + 1 < b.length && b[k + 1] <= wx) k++;
        const stoneId = r * 40 + k;
        const ragged = (wx < 182 || wx > 282 || wy > 196) && S.hash(stoneId, 9, 43) < 0.55;
        if (!ragged) {
          if (ly === 6 || wx === b[k]) col = S.hash(wx, wy, 44) > 0.8 ? moss : mortar;
          else {
            const tone = Math.floor(S.hash(stoneId, 1, 45) * 2.2);   // 0..2
            let t = tone + (ly === 0 || wx === b[k] + 1 ? 1 : 0) - (ly === 5 ? 1 : 0);
            col = stoneTones[clamp(t, 0, 3)];
            if (S.hash(wx, wy, 46) > 0.93) col = mixA(col, [40, 38, 50], 0.25);
            if (s === 'winter' && S.hash(stoneId, 2, 47) > 0.45 && ly < 4) col = rgb(P.snow);
          }
        }
      }
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    ctx.drawImage(c, RX0, RY0);
    // Stepping stones from the courtyard to the bell pavilion.
    for (const [x, y] of [[164, 174], [171, 170], [178, 175]]) {
      groundShadow(ctx, x + 1, y + 1, 3, 1, 0.25);
      R(ctx, x - 3, y - 1, 6, 3, STONE.base); R(ctx, x - 3, y - 1, 6, 1, STONE.hi); R(ctx, x - 2, y + 2, 4, 1, STONE.dark);
      if (s === 'winter') R(ctx, x - 2, y - 1, 3, 1, P.snow);
    }
    // Fallen leaves (autumn) / petals (spring) scattered on the turf.
    if (s === 'autumn' || s === 'spring') {
      const cols = s === 'autumn' ? ['#b9392a', P.leaf.autumn, P.leafAlt.autumn, '#de5a31'] : [P.leafAlt.spring, '#f8c9da'];
      for (let k = 0; k < 140; k++) {
        const x = RX0 + 6 + Math.floor(S.hash(k, 1, 50) * (REG.w * T - 12)), y = 60 + Math.floor(S.hash(k, 2, 50) * 176);
        if (S.onRoad(Math.floor(x / T), Math.floor(y / T))) continue;
        D(ctx, x, y, cols[k % cols.length]);
        if (k % 3 === 0) D(ctx, x + 1, y, cols[(k + 1) % cols.length]);
      }
    }
  }

  /* ============================================================ CLIFFS (5)
   * Hudson Highlands granite along the north edge: forested plateau, a
   * faceted cliff face with ledges, a waterfall spilling to the river by
   * Storm King, and the ridge tapering away east behind School Hill.
   */
  const CLIFF_X1 = 600;
  function cliffBase(x) {
    let b = 46 + 5 * Math.sin(x * 0.029 + 0.6) + 3 * Math.sin(x * 0.071 + 2.1) + 1.5 * Math.sin(x * 0.17);
    b += 12 * Math.exp(-Math.pow((x - 100) / 30, 2));                    // Storm King spur by the river
    const k = x <= 410 ? 1 : Math.max(0, 1 - (x - 410) / (CLIFF_X1 - 410));
    return 4 + (b - 4) * Math.pow(k, 0.55);
  }
  function cliffTop(x) {
    const k = x <= 410 ? 1 : Math.max(0, 1 - (x - 410) / (CLIFF_X1 - 410));
    let fh = (20 + 5 * Math.sin(x * 0.047 + 0.3) + 3 * Math.sin(x * 0.13 + 1)) * (0.45 + 0.55 * k);
    fh += 34 * Math.exp(-Math.pow((x - 142) / 24, 2));   // Storm King's bare granite shoulder
    fh += 26 * Math.exp(-Math.pow((x - 398) / 20, 2));   // Breakneck Ridge buttress
    return cliffBase(x) - fh;
  }
  let FACETS = null;
  function facets() {
    if (FACETS) return FACETS;
    const rnd = S.rng(9071), out = [];
    let x = 70;
    while (x < CLIFF_X1 + 10) {
      const w = 4 + Math.floor(rnd() * 9);
      out.push({ x0: x, w, jag: Math.floor(rnd() * 5), so: Math.floor(rnd() * 7), tone: rnd() < 0.2 ? -1 : rnd() > 0.85 ? 1 : 0 });
      x += w;
    }
    return (FACETS = out);
  }
  function facetAt(x) { const F = facets(); for (let i = F.length - 1; i >= 0; i--) if (F[i].x0 <= x) return F[i]; return F[0]; }
  function faceBottom(x) {
    const f = facetAt(x), u = (x - f.x0 + 0.5) / f.w;
    return Math.round(cliffBase(x) + f.jag * Math.max(0, 1 - Math.abs(u - 0.35) / 0.65));
  }

  function drawCliffs(ctx) {
    const s = season(), winter = s === 'winter';
    const X0 = 64, X1 = CLIFF_X1 + 8, H = 84;
    const [c, g] = mk(X1 - X0, H);
    const im = g.createImageData(X1 - X0, H), d = im.data;
    const tones = [GRAN.deep, GRAN.dark, GRAN.base, GRAN.light, GRAN.hi].map(rgb);
    const turfA = rgb(winter ? '#c7d4de' : C.mix(P.grassDark[s], '#33452f', 0.45));
    const turfB = rgb(winter ? P.snow : C.mix(P.grass[s], '#4d5f3a', 0.35));
    const mossC = rgb(winter ? P.snow : C.mix(P.grassDark[s], '#4d6a34', 0.4));
    const leafC = rgb(s === 'autumn' ? '#c8502c' : s === 'spring' ? P.leafAlt.spring : P.grassDark[s]);
    const olC = rgb('#2a2433'), snowC = rgb(P.snow), snowS = rgb('#c9d7e4');
    const waterA = rgb(winter ? '#d4e8f3' : P.waterLight), waterB = rgb(winter ? '#ffffff' : P.foam), waterD = rgb(winter ? '#9fc6dd' : P.water);
    const put = (x, y, col, a = 255) => { const i = (y * (X1 - X0) + (x - X0)) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = a; };
    for (let x = X0; x < X1; x++) {
      const top = Math.round(cliffTop(x)), bot = faceBottom(x), base = cliffBase(x);
      if (base < 5) continue;
      const f = facetAt(x), lx = x - f.x0;
      const inFall = x >= FALL.x0 && x < FALL.x1;
      for (let y = 0; y < Math.min(H, bot + 5); y++) {
        if (S.isWater(Math.floor(x / T), Math.floor(y / T))) continue;
        if (y < top) {
          // Plateau: dark highland turf / snow, with a grass fringe at the lip.
          let col = mixA(turfA, turfB, vnoise(x / 7, y / 7, 21));
          const hh = S.hash(x, y, 22);
          if (hh > 0.93) col = mixA(col, [255, 255, 255], winter ? 0 : 0.18);
          else if (hh < 0.07) col = mixA(col, [20, 20, 30], 0.25);
          if (inFall || (x >= FALL.x0 + 1 && x < FALL.x1 - 1 && y > top - 14)) col = (y + x) % 3 ? waterA : waterD;
          put(x, y, col);
        } else if (y <= bot) {
          if (inFall) { // the waterfall itself (animated on top at layer 100)
            const k = (x - FALL.x0 + y * 3) % 5;
            put(x, y, k === 0 ? waterB : k < 3 ? waterA : waterD); continue;
          }
          const v = (y - top) / Math.max(1, bot - top);
          let t = 2 + f.tone;
          if (lx < 2) t += 1;
          else if (lx >= f.w - 2) t -= 1;
          if (v > 0.72) t -= 1;
          const sl = (y - top + f.so) % 7;
          let col;
          if (y === bot) col = olC;
          else if (y === top) col = winter ? snowC : tones[4];
          else if (y === top + 1 && S.hash(x, 1, 23) > 0.45) col = winter ? snowS : mossC;   // grass overhang
          else if (lx === 0 && S.hash(x, y >> 2, 24) > 0.25) col = tones[0];                // crack between facets
          else {
            if (sl === 0 && v < 0.9) t += 1; else if (sl === 1 && v < 0.9) t -= 1;
            col = tones[clamp(t, 0, 4)];
            const hh = S.hash(x, y, 25);
            if (sl === 0 && v < 0.85 && hh > (winter ? 0.25 : 0.62)) col = winter ? snowC : (hh > 0.9 ? leafC : mossC);
            else if (hh > 0.95) col = tones[clamp(t + 1, 0, 4)];
            else if (hh < 0.05) col = tones[clamp(t - 1, 0, 4)];
            if (y === top + 2 && v < 0.5) col = mixA(col, tones[4], 0.35);
          }
          put(x, y, col);
        } else {
          // Cast shadow at the cliff foot (dithered), and scree pebbles.
          const k = y - bot;
          if (k <= 3 && ((x + y) & 1 || k === 1)) put(x, y, [20, 15, 30], [0, 120, 80, 45][k]);
        }
      }
    }
    g.putImageData(im, 0, 0);
    ctx.drawImage(c, X0, 0);

    // Scree boulders along the cliff foot.
    const rnd = S.rng(4401);
    for (let k = 0; k < 26; k++) {
      const x = 110 + Math.floor(rnd() * 400), y = faceBottom(x) + 2 + Math.floor(rnd() * 4);
      if (x >= FALL.x0 - 8 && x < FALL.x1 + 14) continue;
      const r = rnd() < 0.3 ? 2 : 1;
      if (cliffBase(x) < 10) continue;
      boulder(ctx, x, y, r + 1, winter);
    }

    // Waterfall pool and the stream to the Hudson.
    drawPool(ctx, winter);

    // Forest along the plateau: a back row and a lip row, pines and maples.
    const trees = [];
    const tr = S.rng(5150);
    for (let x = 78; x < CLIFF_X1 - 30; x += 7 + Math.floor(tr() * 7)) {
      const top = cliffTop(x);
      if (top < 9 || (x > FALL.x0 - 6 && x < FALL.x1 + 4)) continue;
      const pine = tr() < 0.5;
      trees.push({ x, y: Math.round(top - 9 - tr() * 5), pine, size: pine ? 11 + Math.floor(tr() * 3) : 14 + Math.floor(tr() * 4), seed: 600 + x });
      if (tr() < 0.75) trees.push({ x: x + 3, y: Math.round(top + 1), pine: tr() < 0.45, size: 11 + Math.floor(tr() * 4), seed: 900 + x });
    }
    // A summit crag above the monastery (Breakneck), behind the trees.
    crag(ctx, 214, 2, 34, 22, winter);
    crag(ctx, 470, 0, 26, 12, winter);
    trees.sort((a, b) => a.y - b.y);
    for (const t of trees) {
      const spr = t.pine ? pineSprite(t.seed, t.size, s) : mapleSprite(t.seed, t.size, s);
      place(ctx, spr, t.x - Math.floor(spr.width / 2) + 1, t.y - spr.height + 2, [2, 1, 0.22]);
    }
  }

  function boulder(ctx, x, y, r, winter) {
    px(ctx, x + 1, y + 1, r, 'rgba(20,15,30,0.3)');
    px(ctx, x, y, r, GRAN.dark);
    px(ctx, x - 1 + (r > 1 ? 0 : 1), y - 1 + (r > 1 ? 0 : 1), Math.max(1, r - 1), winter ? P.snow : GRAN.light);
    D(ctx, x - r + 1, y - r + 1, winter ? '#ffffff' : GRAN.hi);
  }
  function px(ctx, cx, cy, r, c) { S.px.circle(ctx, cx, cy, r, c); }

  function crag(ctx, x0, y0, w, h, winter) {
    // A rocky summit: lit west face, shaded east face, strata and a snow cap.
    const spr = build(w, h, (g) => {
      const cx = w * 0.45;
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const top = Math.round(dx < 0 ? (-dx / cx) * h * 0.9 : (dx / (w - cx)) * h * 0.75) + (S.hash(x, 0, 31) > 0.7 ? 1 : 0);
        for (let y = Math.max(0, top); y < h; y++) {
          let col = dx < 0 ? GRAN.light : GRAN.dark;
          if (Math.abs(dx) < 1.2) col = GRAN.hi;
          if ((y + (x >> 2)) % 6 === 0) col = dx < 0 ? GRAN.base : GRAN.deep;
          if (S.hash(x, y, 32) > 0.92) col = GRAN.base;
          if ((winter && y < top + 3 + (h - top) * 0.25) || (!winter && y < 3 && y <= top + 1)) col = winter ? (dx < 0 ? P.snow : '#c9d7e4') : col;
          if (y > h - 3) col = GRAN.deep;
          D(g, x, y, col);
        }
      }
    }, '#2a2433');
    place(ctx, spr, x0, y0, [3, 1, 0.2]);
  }

  function drawPool(ctx, winter) {
    const cx = 101, cy = Math.round(cliffBase(101)) + 8;
    // Stream from the pool west to the river.
    for (let x = 72; x < cx; x++) {
      const yy = cy + Math.round(Math.sin(x * 0.4) * 0.8);
      for (let k = -2; k <= 2; k++) {
        if (S.isWater(Math.floor(x / T), Math.floor((yy + k) / T))) continue;
        D(ctx, x, yy + k, Math.abs(k) === 2 ? GRAN.dark : k === -1 ? P.waterLight : (winter ? '#cfe3ee' : P.water));
      }
    }
    // Rocky rim then water.
    for (let y = -7; y <= 7; y++) for (let x = -13; x <= 13; x++) {
      const e = (x * x) / 169 + (y * y) / 49;
      if (e > 1) continue;
      let col;
      if (e > 0.62) col = S.hash(x, y, 33) > 0.5 ? GRAN.base : GRAN.dark;
      else col = winter ? (S.hash(x, y, 34) > 0.5 ? '#d8e8f1' : '#bcd4e2') : y < -2 ? P.waterDeep : P.water;
      if (e > 0.62 && y < -2 && x < 0) col = GRAN.light;
      D(ctx, cx + x, cy + y, col);
    }
    for (let x = -12; x <= 12; x++) if (S.hash(x, 5, 35) > 0.4) D(ctx, cx + x, cy + 7 - (Math.abs(x) > 8 ? 1 : 0), '#2a2433');
  }

  /* ============================================================ SPRITES */

  const spriteCache = {};
  function cached(key, fn) { return spriteCache[key] || (spriteCache[key] = fn()); }

  function mapleSprite(seed, size, s) {
    return cached(`maple:${seed}:${size}:${s}`, () => {
      const rnd = S.rng(seed);
      const pal = foliagePal(Math.floor(rnd() * 3), s);
      const w = size, ch = Math.round(size * 0.82), H = ch + 6;
      const ol = pal ? pal.ol : '#2e2018';
      return build(w, H, (g) => {
        const tx = Math.floor(w / 2) - 1;
        // Trunk with a lit left side and root flare.
        R(g, tx, ch - 6, 3, H - ch + 6, WOOD.base); R(g, tx + 2, ch - 6, 1, H - ch + 6, WOOD.dark); R(g, tx, ch - 6, 1, H - ch + 6, WOOD.light);
        R(g, tx - 1, H - 1, 5, 1, WOOD.dark);
        if (!pal) {
          // Winter: bare branches with snow.
          const br = [[tx + 1, ch - 6, tx - 5, 3], [tx + 1, ch - 4, tx + 7, 2], [tx + 1, ch - 8, tx + 2, 0], [tx - 2, ch - 9, tx - 6, ch - 13], [tx + 4, ch - 7, tx + 8, ch - 11]];
          for (const [a, b, c2, d2] of br) { S.px.line(g, a, b, c2, d2, WOOD.dark); S.px.line(g, a, b - 1, c2, d2 - 1, P.snow); }
          return;
        }
        const clumps = [];
        const n = 6 + Math.floor(size / 5);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + rnd();
          const rr = (size / 2 - 4) * (0.35 + rnd() * 0.6);
          clumps.push({ x: w / 2 + Math.cos(a) * rr, y: ch * 0.48 + Math.sin(a) * rr * 0.8, r: 3 + rnd() * (size / 9) });
        }
        clumps.push({ x: w / 2, y: ch * 0.42, r: size / 4 });
        clumps.sort((a, b) => a.y - b.y);
        S.px.circle(g, w / 2, ch * 0.5, Math.floor(size / 2 - 2.5), pal.dark);
        for (const k of clumps) {
          S.px.circle(g, k.x + 1, k.y + 1, Math.round(k.r), pal.dark);
          S.px.circle(g, k.x, k.y, Math.round(k.r), pal.base);
          S.px.circle(g, k.x - 1, k.y - 1, Math.max(1, Math.round(k.r - 1.6)), pal.light);
          D(g, Math.round(k.x - k.r * 0.5), Math.round(k.y - k.r * 0.6), pal.hi);
        }
        // Leaf texture: dark speckle on the lower right, bright flecks on the upper left.
        const im = g.getImageData(1, 1, w, ch).data;
        for (let y = 0; y < ch; y++) for (let x = 0; x < w; x++) {
          const hh = S.hash(x + seed, y, 61);
          if (hh > 0.86 && x + y > w * 0.9 && im[(y * w + x) * 4 + 3]) D(g, x, y, pal.dark);
          else if (hh < 0.05 && x + y < w * 0.8 && im[(y * w + x) * 4 + 3]) D(g, x, y, pal.light);
        }
      }, ol);
    });
  }

  function pineSprite(seed, size, s) {
    return cached(`pine:${seed}:${size}:${s}`, () => {
      const w = size, H = Math.round(size * 1.6);
      const winter = s === 'winter';
      return build(w, H, (g) => {
        const cx = Math.floor(w / 2);
        R(g, cx - 1, H - 4, 2, 4, WOOD.dark); D(g, cx - 1, H - 4, WOOD.base);
        const tiers = 4;
        for (let k = 0; k < tiers; k++) {
          const y0 = Math.round(k * (H - 5) / (tiers + 0.6)), th = Math.round((H - 4) / tiers) + 2;
          const maxW = Math.round((w / 2) * (0.45 + 0.55 * (k + 1) / tiers));
          for (let j = 0; j < th; j++) {
            const hw = Math.max(0, Math.round(maxW * (j + 1) / th) - (S.hash(k, j, seed) > 0.6 ? 1 : 0));
            for (let x = -hw; x <= hw; x++) {
              let col = x < -hw / 3 ? PINE.light : x > hw / 3 ? PINE.dark : PINE.base;
              if (j === th - 1) col = PINE.dark;
              if (x < 0 && S.hash(x + seed, j + k * 9, 62) > 0.82) col = PINE.hi;
              if (winter && (j < 2 || (x < 0 && j < th - 2 && S.hash(x, j + k * 7, seed) > 0.7))) col = x < 1 ? P.snow : '#c9d7e4';
              D(g, cx + x, y0 + j, col);
            }
          }
        }
      }, PINE.ol);
    });
  }

  /** Curved Asian roof (front slope + hips), upturned eave tips, glazed tile ribs. */
  function drawRoof(g, cx, y0, h, rh, eh, o) {
    o = o || {};
    const J = o.pal || JADE, lift = o.lift == null ? 4 : o.lift, snow = season() === 'winter';
    const icx = Math.floor(cx);
    for (let x = Math.floor(cx - eh); x < Math.ceil(cx + eh); x++) {
      const d = Math.abs(x + 0.5 - cx);
      let top = d <= rh ? y0 : y0 + Math.round((h - 1) * Math.sqrt((d - rh) / (eh - rh)));
      const curl = d > eh - 9 ? Math.round(lift * Math.pow((d - (eh - 9)) / 9, 2)) : 0;
      const bot = y0 + h - 1 - curl;
      top = Math.min(top, bot - 2);
      const hip = d > rh, left = x + 0.5 < cx;
      const sdepth = snow ? Math.round((h - 3) * (hip ? 0.45 : 0.4)) + (S.hash(x, y0, 71) > 0.5 ? 1 : 0) - (S.hash(x >> 1, y0, 72) > 0.8 ? 2 : 0) : 0;
      for (let y = top; y <= bot; y++) {
        const fb = bot - y, rib = (((x - icx) % 3) + 3) % 3;
        let col;
        if (fb === 0) col = J.deep;
        else if (fb === 1) col = rib === 0 ? J.light : J.dark;
        else if (fb === 2) col = J.deep;
        else if (!hip && y === y0) col = J.hi;
        else if (!hip && y === y0 + 1) col = J.deep;
        else if (y === top) col = left ? J.hi : J.light;
        else {
          const sh = hip ? (left ? 1 : -1) : 0;
          const tones = [J.deep, J.dark, J.base, J.light, J.hi];
          let t = 2 + sh + (rib === 0 ? 1 : rib === 2 ? -1 : 0);
          if (y - top < 3) t += 1;
          if (fb < 5) t -= 1;
          col = tones[clamp(t, 0, 4)];
        }
        if (snow && y < top + sdepth && fb > 2) col = y === top + sdepth - 1 ? '#b9c9d8' : (left || !hip) && rib !== 2 ? P.snow : '#dbe5ee';
        D(g, x, y, col);
      }
      if (d > eh - 1.5) D(g, x, top - 1, P.gold);   // gold tip on each upturned eave
    }
  }

  function goldCurl(g, x, y, dir) {
    // A small curled ridge ornament (dragon tail), dir -1 = left end.
    const pts = [[0, 0], [0, -1], [dir * -1, -2], [dir * -1, -3], [0, -4], [dir, -4], [dir, -3]];
    for (const [a, b] of pts) D(g, x + a, y + b, P.gold);
    D(g, x + dir * -1, y - 2, P.goldDark); D(g, x, y, P.goldDark);
  }

  function lattice(g, x, y, w, h) {
    R(g, x, y, w, h, WOOD.dark);
    R(g, x + 1, y + 1, w - 2, h - 2, '#f1e3bd');
    for (let yy = y + 1; yy < y + h - 1; yy++) for (let xx = x + 1; xx < x + w - 1; xx++)
      if ((xx - x) % 3 === 0 || (yy - y) % 3 === 0) D(g, xx, yy, WOOD.light);
    R(g, x + 1, y + 1, w - 2, 1, '#fff6dc');
  }

  function pillar(g, x, y, h) {
    R(g, x, y, 5, h, VERM.base); R(g, x, y, 1, h, VERM.light); R(g, x + 1, y, 1, h, VERM.hi);
    R(g, x + 3, y, 1, h, VERM.dark); R(g, x + 4, y, 1, h, VERM.deep);
    R(g, x - 1, y + h - 2, 7, 2, STONE.light); R(g, x - 1, y + h - 1, 7, 1, STONE.dark);   // stone base
  }

  function templeSprite() {
    return cached('temple:' + season(), () => build(TEMPLE.w, TEMPLE.h, (g) => {
      const cx = 84;
      // Plinth: terrace and a block-laid front face.
      R(g, 10, 76, 148, 10, STONE.light);
      for (let x = 10; x < 158; x++) for (let y = 76; y < 86; y++) {
        if ((x - 10) % 12 === 0 || (y - 76) % 5 === 4) D(g, x, y, STONE.base);
        else if (S.hash(x, y, 81) > 0.9) D(g, x, y, STONE.hi);
      }
      R(g, 10, 76, 148, 1, STONE.hi);
      R(g, 10, 86, 148, 14, STONE.base);
      for (let y = 86; y < 100; y++) for (let x = 10; x < 158; x++) {
        const row = Math.floor((y - 86) / 5), off = row % 2 ? 7 : 0;
        if ((y - 86) % 5 === 4) D(g, x, y, STONE.deep);
        else if ((x - 10 + off) % 14 === 0) D(g, x, y, STONE.dark);
        else if ((y - 86) % 5 === 0) D(g, x, y, STONE.light);
        else if (S.hash(x, y, 82) > 0.93) D(g, x, y, STONE.dark);
        else if (S.hash(x, y, 83) > 0.97 && season() !== 'winter') D(g, x, y, P.grassDark[season()]);
      }
      R(g, 10, 86, 148, 1, STONE.dark);
      // Front stairs (protrude past the plinth face).
      for (let k = 0; k < 6; k++) {
        const y = 84 + k * 4, inset = 0;
        R(g, 70 - inset, y, 28, 2, STONE.hi); R(g, 70, y + 2, 28, 2, STONE.dark);
        D(g, 70, y, STONE.light); D(g, 97, y + 2, STONE.deep);
      }
      R(g, 66, 84, 4, 24, STONE.base); R(g, 98, 84, 4, 24, STONE.dark); R(g, 66, 84, 4, 1, STONE.hi); R(g, 98, 84, 4, 1, STONE.light);
      R(g, 66, 84, 1, 24, STONE.light);
      // Walls: vermilion pillars, lattice panels, the open doors.
      R(g, 24, 52, 120, 26, WOOD.dark);
      const pillarsAt = [-60, -38, -16, 12, 34, 56].map((o) => cx + o - 1);
      for (let k = 0; k + 1 < pillarsAt.length; k++) {
        const a = pillarsAt[k] + 5, b = pillarsAt[k + 1];
        if (k === 2) continue; // the door bay
        lattice(g, a + 1, 56, b - a - 2, 14);
        R(g, a, 70, b - a, 8, WOOD.base); R(g, a, 70, b - a, 1, WOOD.light); R(g, a + 2, 72, b - a - 4, 4, WOOD.dark);
        R(g, a + 3, 73, b - a - 6, 2, WOOD.base);
      }
      // Door bay: open doors, warm interior with a hanging scroll and candles.
      const d0 = pillarsAt[2] + 5, d1 = pillarsAt[3];
      R(g, d0, 56, d1 - d0, 22, '#2a160d');
      for (let y = 60; y < 78; y++) for (let x = d0 + 3; x < d1 - 3; x++) {
        const k = Math.abs(x - cx) / 10 + Math.abs(y - 70) / 10;
        if (k < 0.9) D(g, x, y, k < 0.45 ? '#9a5a26' : '#6a3a1a');
      }
      R(g, cx - 3, 59, 6, 9, PAPER); R(g, cx - 3, 59, 6, 1, WOOD.dark); R(g, cx - 3, 67, 6, 1, WOOD.dark);
      for (let k = 0; k < 3; k++) R(g, cx - 1 + (k % 2), 61 + k * 2, 2, 1, INK);
      R(g, cx - 6, 72, 12, 2, WOOD.light); R(g, cx - 6, 74, 12, 4, WOOD.dark);       // altar
      D(g, cx - 4, 70, P.lanternGlow); D(g, cx - 4, 71, '#fff3c0'); D(g, cx + 3, 70, P.lanternGlow); D(g, cx + 3, 71, '#fff3c0');
      R(g, cx - 1, 70, 2, 2, P.gold);
      // Door leaves folded open against the jambs, red lacquer with gold studs.
      for (const [x, dir] of [[d0, 1], [d1 - 3, -1]]) {
        R(g, x, 56, 3, 22, VERM.dark); R(g, x + (dir > 0 ? 0 : 2), 56, 1, 22, VERM.base);
        for (let y = 59; y < 76; y += 4) D(g, x + 1, y, P.gold);
      }
      for (const x of pillarsAt) pillar(g, x, 54, 24);
      // Eave shadow on the wall.
      g.fillStyle = 'rgba(20,12,24,0.45)'; g.fillRect(22, 52, 124, 5);
      g.fillStyle = 'rgba(20,12,24,0.25)'; g.fillRect(22, 57, 124, 2);
      // Name plaque under the eave (gold border, gold glyph marks).
      R(g, cx - 9, 50, 18, 7, '#1d2a3a'); R(g, cx - 9, 50, 18, 1, P.gold); R(g, cx - 9, 56, 18, 1, P.goldDark);
      D(g, cx - 9, 51, P.gold); D(g, cx + 8, 51, P.goldDark);
      for (let k = 0; k < 4; k++) { R(g, cx - 6 + k * 4, 52, 2, 1, P.gold); D(g, cx - 5 + k * 4, 54, P.gold); D(g, cx - 6 + k * 4, 53, P.goldDark); }
      // Upper storey: bracket band (dougong) between the two roofs.
      R(g, cx - 34, 16, 68, 16, VERM.dark);
      for (let x = cx - 34; x < cx + 34; x++) {
        const k = (x - cx + 34) % 6;
        D(g, x, 17, k < 3 ? '#2f8a76' : VERM.base); D(g, x, 18, k === 0 || k === 5 ? P.gold : VERM.base);
        D(g, x, 21, k < 2 ? WOOD.light : WOOD.dark); D(g, x, 22, k < 2 ? WOOD.base : WOOD.deep);
      }
      for (let k = 0; k < 6; k++) lattice(g, cx - 30 + k * 10, 24, 8, 7);
      // Roofs: lower (wide, double-eaved hall), then upper.
      drawRoof(g, cx, 28, 28, 46, 80, { lift: 5 });
      drawRoof(g, cx, 2, 21, 22, 46, { lift: 4 });
      // Ridge ornaments and the central jewel finial.
      goldCurl(g, cx - 23, 3, -1); goldCurl(g, cx + 22, 3, 1);
      goldCurl(g, cx - 47, 29, -1); goldCurl(g, cx + 46, 29, 1);
      R(g, cx - 1, -2, 2, 4, P.gold); D(g, cx - 1, -2, '#fff1b8'); R(g, cx - 2, 1, 4, 1, P.goldDark);
      // Red paper lanterns hanging from the lower eave corners.
      for (const lx of [cx - 52, cx + 51]) {
        D(g, lx, 54, OUT); D(g, lx, 55, OUT);
        R(g, lx - 2, 56, 5, 1, P.goldDark);
        R(g, lx - 3, 57, 7, 5, '#d23a2a'); R(g, lx - 2, 57, 2, 5, '#f0664a'); R(g, lx + 2, 57, 1, 5, '#8e2216');
        R(g, lx - 2, 62, 5, 1, P.goldDark); D(g, lx, 63, '#f0c23e'); D(g, lx, 64, '#d6402f');
      }
    }, OUT));
  }

  function librarySprite() {
    return cached('library:' + season(), () => build(LIBRARY.w, LIBRARY.h, (g) => {
      const cx = 37;
      // Stone base and the covered walkway joining the temple.
      R(g, 4, 60, 66, 9, STONE.base); R(g, 4, 60, 66, 1, STONE.hi); R(g, 4, 68, 66, 1, STONE.deep);
      for (let x = 4; x < 70; x += 8) R(g, x, 61, 1, 7, STONE.dark);
      // Walls: plaster with dark timber frame.
      R(g, 8, 26, 58, 34, PLAS.base);
      R(g, 8, 26, 58, 2, PLAS.dark);
      for (let y = 28; y < 60; y++) for (let x = 8; x < 66; x++) if (S.hash(x, y, 91) > 0.94) D(g, x, y, PLAS.dark);
      R(g, 8, 26, 2, 34, WOOD.dark); R(g, 64, 26, 2, 34, WOOD.dark); R(g, 8, 50, 58, 2, WOOD.dark); R(g, 8, 26, 1, 34, WOOD.base);
      // Moon window with bookshelves inside.
      const wy = 38, r = 10;
      for (let y = -r - 1; y <= r + 1; y++) for (let x = -r - 1; x <= r + 1; x++) {
        const dd = Math.sqrt(x * x + y * y);
        if (dd <= r - 1) {
          const row = Math.floor((y + r) / 5), ly = (y + r) % 5;
          let col = ly === 4 ? WOOD.dark : ['#7b2d2d', '#2f5e8a', '#c4952b', '#3c7a4e', '#6a4a8a', '#a8452e'][Math.floor(S.hash(x >> 1, row, 92) * 6)];
          if (ly === 0) col = C.shade(col, 0.25);
          if ((x & 1) === 1 && ly !== 4) col = C.shade(col, -0.18);
          D(g, cx + x, wy + y, col);
        } else if (dd <= r + 1.2) D(g, cx + x, wy + y, dd <= r ? WOOD.light : WOOD.dark);
      }
      // Side door with a paper lattice, and a hanging wooden sign.
      lattice(g, 54, 36, 8, 14); lattice(g, 12, 36, 8, 14);
      R(g, cx - 6, 52, 12, 6, WOOD.base); R(g, cx - 6, 52, 12, 1, WOOD.light);
      for (let k = 0; k < 3; k++) R(g, cx - 4 + k * 3, 54, 2, 2, PAPER);
      g.fillStyle = 'rgba(20,12,24,0.4)'; g.fillRect(8, 26, 58, 4);
      drawRoof(g, cx, 2, 26, 16, 37, { lift: 4 });
      goldCurl(g, cx - 17, 3, -1); goldCurl(g, cx + 16, 3, 1);
    }, OUT));
  }

  function pagodaSprite() {
    return cached('pagoda:' + season(), () => build(PAGODA.w, PAGODA.h, (g) => {
      const cx = 23;
      R(g, 4, 96, 38, 10, STONE.base); R(g, 4, 96, 38, 1, STONE.hi); R(g, 4, 105, 38, 1, STONE.deep);
      for (let x = 6; x < 42; x += 7) R(g, x, 98, 1, 7, STONE.dark);
      const tiers = [[74, 96, 13, 60, 22, 9, 23], [50, 66, 10, 40, 18, 7, 19], [30, 44, 8, 22, 14, 5, 15]];
      for (const [wy0, wy1, hw, ry, rh, rr, re] of tiers) {
        R(g, cx - hw, wy0, hw * 2, wy1 - wy0, VERM.base);
        R(g, cx - hw, wy0, 2, wy1 - wy0, VERM.light); R(g, cx + hw - 2, wy0, 2, wy1 - wy0, VERM.dark);
        R(g, cx - 3, wy0 + 5, 6, Math.min(8, wy1 - wy0 - 7), '#3a1d10');
        R(g, cx - 2, wy0 + 6, 4, Math.min(6, wy1 - wy0 - 9), '#f1c472');
        D(g, cx - 1, wy0 + 6, '#fff0b8');
        g.fillStyle = 'rgba(20,12,24,0.4)'; g.fillRect(cx - hw, wy0, hw * 2, 3);
        drawRoof(g, cx, ry, rh, rr, re, { lift: 3 });
      }
      // Spire: nine gold rings on a bronze mast.
      R(g, cx - 1, 2, 2, 20, BRONZE.dark);
      for (let k = 0; k < 6; k++) { R(g, cx - 3 + (k > 3 ? 1 : 0), 6 + k * 3, 6 - (k > 3 ? 2 : 0), 1, P.gold); D(g, cx + 2 - (k > 3 ? 1 : 0), 6 + k * 3, P.goldDark); }
      R(g, cx - 1, 0, 2, 2, '#fff1b8');
    }, OUT));
  }

  function pavilionSprite() {
    return cached('pavilion:' + season(), () => build(PAVILION.w, PAVILION.h, (g) => {
      const cx = 25;
      R(g, 2, 44, 46, 9, STONE.base); R(g, 2, 44, 46, 2, STONE.light); R(g, 2, 44, 46, 1, STONE.hi); R(g, 2, 52, 46, 1, STONE.deep);
      for (let x = 5; x < 48; x += 9) R(g, x, 47, 1, 5, STONE.dark);
      // Back posts (darker), front posts.
      R(g, 12, 16, 3, 29, VERM.dark); R(g, 35, 16, 3, 29, VERM.deep);
      R(g, 13, 22, 24, 1, WOOD.dark);
      pillar(g, 5, 14, 32); pillar(g, 40, 14, 32);
      // Beam and the wooden striker log on ropes.
      R(g, 4, 16, 42, 3, WOOD.base); R(g, 4, 16, 42, 1, WOOD.light); R(g, 4, 18, 42, 1, WOOD.deep);
      R(g, 33, 19, 1, 9, '#d8c79a'); R(g, 43, 19, 1, 9, '#d8c79a');
      R(g, 31, 28, 14, 4, WOOD.base); R(g, 31, 28, 14, 1, WOOD.hi); R(g, 31, 31, 14, 1, WOOD.dark);
      R(g, 31, 28, 1, 4, WOOD.light); D(g, 44, 29, '#e8d2a0'); D(g, 44, 30, WOOD.light);
      drawRoof(g, cx, 0, 16, 8, 25, { lift: 3 });
      goldCurl(g, cx - 9, 1, -1); goldCurl(g, cx + 8, 1, 1);
    }, OUT));
  }

  function bellSprite() {
    return cached('bell', () => build(12, 15, (g) => {
      const rows = [
        '....XX....',
        '...XXXX...',
        '..XHHBBX..',
        '..XHBBBX..',
        '..XHBGBX..',
        '..XHBBBX..',
        '.XLLLLLLX.',
        '.XHBBBBDX.',
        '.XHBOOBDX.',
        '.XHBOOBDX.',
        '.XHBBGBDX.',
        'XLLLLLLLLX',
        'XDDDDDDDDX',
      ];
      S.px.sprite(g, rows, 1, 1, { X: BRONZE.dark, H: BRONZE.hi, B: BRONZE.base, D: BRONZE.dark, L: BRONZE.light, G: BRONZE.patina, O: BRONZE.light });
    }, BRONZE.deep));
  }

  function boardSprite() {
    return cached('board:' + season(), () => build(BOARD.w, BOARD.h, (g) => {
      // Posts.
      R(g, 1, 5, 3, 31, WOOD.base); R(g, 1, 5, 1, 31, WOOD.light); R(g, 3, 5, 1, 31, WOOD.deep);
      R(g, 34, 5, 3, 31, WOOD.base); R(g, 34, 5, 1, 31, WOOD.light); R(g, 36, 5, 1, 31, WOOD.deep);
      // Panel: horizontal planks with grain, framed.
      R(g, 4, 8, 30, 23, WOOD.dark);
      for (let y = 9; y < 30; y++) for (let x = 5; x < 33; x++) {
        let col = (y - 9) % 7 === 6 ? WOOD.deep : S.hash(x >> 2, y, 101) > 0.55 ? '#8a5732' : '#7e4f2d';
        if ((y - 9) % 7 === 0) col = WOOD.light;
        D(g, x, y, col);
      }
      // Six pegs (two rows of three).
      for (const [x, y] of BOARD_SLOTS) { R(g, x - 1, y - 1, 2, 2, WOOD.hi); D(g, x, y, WOOD.deep); }
      // Ledge with brush and ink stone.
      R(g, 3, 31, 32, 3, WOOD.base); R(g, 3, 31, 32, 1, WOOD.hi); R(g, 3, 33, 32, 1, WOOD.deep);
      R(g, 7, 29, 7, 2, '#26232b'); D(g, 8, 29, '#4a4652'); R(g, 10, 30, 2, 1, '#0d0c10');
      R(g, 18, 30, 9, 1, '#c9a46a'); D(g, 27, 30, '#2a2228'); D(g, 28, 30, '#2a2228');
      // Little jade roof cap.
      drawRoof(g, 19, 0, 8, 12, 20, { lift: 2 });
    }, OUT));
  }
  // Peg positions inside the board sprite (local px); scrolls hang from these.
  const BOARD_SLOTS = [[11, 11], [19, 11], [27, 11], [11, 20], [19, 20], [27, 20]];

  function scrollSprite(ribbon) {
    return cached('scroll:' + ribbon, () => build(6, 9, (g) => {
      R(g, 0, 0, 6, 1, WOOD.dark); D(g, 0, 0, WOOD.light);
      R(g, 0, 1, 6, 7, PAPER); R(g, 5, 1, 1, 7, '#d9c9a0'); R(g, 0, 1, 1, 7, '#fffaea');
      for (let k = 0; k < 3; k++) R(g, 1 + (k % 2), 2 + k * 2, 3, 1, k === 0 ? ribbon : INK);
      R(g, 0, 8, 6, 1, WOOD.dark); D(g, 5, 8, WOOD.deep);
    }, OUT));
  }

  function lanternSprite() {
    return cached('lantern:' + season(), () => build(10, 21, (g) => {
      const winter = season() === 'winter';
      R(g, 0, 17, 10, 4, STONE.base); R(g, 0, 17, 10, 1, STONE.hi); R(g, 7, 18, 3, 3, STONE.dark);
      R(g, 3, 11, 4, 6, STONE.base); R(g, 3, 11, 1, 6, STONE.light); R(g, 6, 11, 1, 6, STONE.dark);
      R(g, 1, 10, 8, 2, STONE.light); R(g, 1, 11, 8, 1, STONE.dark);
      R(g, 1, 5, 8, 5, STONE.base); R(g, 1, 5, 1, 5, STONE.light); R(g, 8, 5, 1, 5, STONE.dark);
      R(g, 3, 6, 4, 3, '#4a2410'); // window (the flame is dynamic)
      for (let x = -1; x <= 10; x++) { const y = 4 - (x < 1 || x > 8 ? 1 : 0); D(g, x, y, STONE.dark); }
      R(g, 0, 2, 10, 2, STONE.light); R(g, 2, 1, 6, 1, STONE.hi); R(g, 4, 0, 2, 1, STONE.light);
      if (winter) { R(g, 1, 1, 8, 1, P.snow); R(g, 0, 2, 6, 1, P.snow); }
      else { D(g, 2, 2, P.grassDark[season()]); D(g, 7, 3, P.grassDark[season()]); D(g, 1, 19, P.grassDark[season()]); }
    }, OUT));
  }

  function censerSprite() {
    return cached('censer', () => build(16, 13, (g) => {
      R(g, 2, 10, 2, 3, BRONZE.dark); R(g, 12, 10, 2, 3, BRONZE.deep); R(g, 7, 10, 2, 2, BRONZE.dark);
      R(g, 1, 5, 14, 6, BRONZE.base); R(g, 1, 5, 3, 6, BRONZE.light); R(g, 12, 5, 3, 6, BRONZE.dark);
      R(g, 2, 6, 1, 3, BRONZE.hi); D(g, 8, 8, BRONZE.patina); D(g, 5, 9, BRONZE.patina); D(g, 10, 7, BRONZE.patina);
      R(g, 0, 4, 16, 2, BRONZE.light); R(g, 0, 4, 16, 1, BRONZE.hi);
      R(g, 2, 3, 12, 1, '#5a4a3c');
      // Incense sticks with glowing tips.
      for (const [x, h] of [[6, 4], [8, 5], [10, 3]]) { R(g, x, 3 - h, 1, h, '#a0522d'); D(g, x, 2 - h, '#ff6a3a'); }
    }, BRONZE.deep));
  }

  function rockSprite(seed, w, h) {
    return cached(`rock:${seed}:${w}:${h}:${season()}`, () => build(w, h, (g) => {
      const winter = season() === 'winter';
      const cx = w / 2, cy = h * 0.6;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const nx = (x + 0.5 - cx) / (w / 2), ny = (y + 0.5 - cy) / (h * 0.62);
        const e = nx * nx + ny * ny * (ny < 0 ? 0.9 : 1.6) + (S.hash(x, y, seed) - 0.5) * 0.18;
        if (e > 1) continue;
        const lit = -nx * 0.7 - ny * 0.9;
        let col = lit > 0.55 ? STONE.hi : lit > 0.1 ? STONE.light : lit > -0.45 ? STONE.base : STONE.dark;
        if (y > h - 3) col = STONE.deep;
        if (ny < -0.35 && S.hash(x, y, seed + 1) > 0.45) col = winter ? P.snow : (S.hash(x, y, seed + 2) > 0.5 ? P.grassDark[season()] : '#5f8a3e');
        if (S.hash(x, y, seed + 3) > 0.93) col = STONE.deep;
        D(g, x, y, col);
      }
    }, OUT));
  }

  function bonsaiSprite() {
    return cached('bonsai:' + season(), () => build(16, 15, (g) => {
      const s = season();
      // Glazed blue pot.
      R(g, 2, 11, 12, 3, '#2f5f8f'); R(g, 2, 11, 12, 1, '#5f93c4'); R(g, 3, 14, 10, 1, '#1d3a5a'); R(g, 3, 11, 2, 3, '#4a7db0');
      // Twisted trunk.
      S.px.line(g, 7, 11, 6, 8, WOOD.dark); S.px.line(g, 6, 8, 9, 5, WOOD.dark); S.px.line(g, 7, 10, 7, 8, WOOD.light);
      S.px.line(g, 8, 6, 12, 5, WOOD.dark);
      const pal = s === 'winter' ? null : s === 'autumn' ? foliagePal(0, s) : PINE;
      const pads = [[4, 5, 3], [10, 3, 3], [13, 5, 2]];
      for (const [x, y, r] of pads) {
        if (!pal) { R(g, x - r, y, r * 2, 1, P.snow); continue; }
        R(g, x - r, y - 1, r * 2 + 1, 2, pal.base); R(g, x - r + 1, y - 2, r * 2 - 1, 1, pal.light); R(g, x - r, y + 1, r * 2 + 1, 1, pal.dark);
        D(g, x - r + 1, y - 2, pal.hi);
      }
    }, OUT));
  }

  /* ============================================================ GARDEN */

  const GROCKS = [[318, 170, 14, 10, 1], [360, 182, 11, 8, 2], [370, 186, 6, 4, 3], [384, 162, 8, 6, 4]];
  function drawGarden(ctx) {
    const s = season(), winter = s === 'winter';
    const { x: gx, y: gy, w: gw, h: gh } = GARDEN;
    // Bamboo fence along the back, stone curb around the sand.
    groundShadow(ctx, gx + gw / 2 + 2, gy + gh / 2 + 2, gw / 2, gh / 2 - 2, 0.12);
    const sx0 = gx + 3, sy0 = gy + 6, sw = gw - 6, sh = gh - 10;
    R(ctx, sx0 - 2, sy0 - 2, sw + 4, sh + 4, STONE.dark);
    for (let x = sx0 - 2; x < sx0 + sw + 2; x += 5) { R(ctx, x, sy0 - 2, 4, 2, STONE.light); R(ctx, x, sy0 + sh, 4, 2, STONE.base); D(ctx, x, sy0 - 2, STONE.hi); }
    for (let y = sy0; y < sy0 + sh; y += 5) { R(ctx, sx0 - 2, y, 2, 4, STONE.light); R(ctx, sx0 + sw, y, 2, 4, STONE.base); }
    R(ctx, sx0 - 3, sy0 + sh + 2, sw + 6, 1, OUT);
    // Raked sand: parallel furrows, concentric ripples around the rocks.
    const sand = [rgb(SAND.dark), rgb(SAND.base), rgb(SAND.light)];
    const snowy = [rgb('#c6d4e0'), rgb('#e4ecf2'), rgb(P.snow)];
    const pal = winter ? snowy : sand;
    const [c, g] = mk(sw, sh);
    const im = g.createImageData(sw, sh), d = im.data;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const wx = sx0 + x, wy = sy0 + y;
      let best = 1e9;
      for (const [rx, ry, rw, rh] of GROCKS) {
        const dx = (wx - rx) / (rw / 2 + 0.5), dy = (wy - (ry - rh * 0.35)) / (rh / 2 + 0.5);
        best = Math.min(best, Math.sqrt(dx * dx + dy * dy * 1.6) * (rw / 2));
      }
      let k;
      if (best < (GROCKS.length && 16)) k = Math.floor(best) % 3;
      else k = y % 3;
      const col = pal[k === 0 ? 0 : k === 1 ? 2 : 1];
      const i = (y * sw + x) * 4;
      const j = S.hash(wx, wy, 111) > 0.96 ? 12 : 0;
      d[i] = col[0] - j; d[i + 1] = col[1] - j; d[i + 2] = col[2] - j; d[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    ctx.drawImage(c, sx0, sy0);
    // Fallen maple leaves on the sand (autumn).
    if (s === 'autumn') for (let k = 0; k < 14; k++) D(ctx, sx0 + 60 + Math.floor(S.hash(k, 3, 112) * 46), sy0 + Math.floor(S.hash(k, 4, 112) * 20), k % 2 ? '#c8402b' : P.leaf.autumn);
    // Bamboo fence at the back.
    for (let x = gx; x < gx + gw; x += 3) {
      const h = 8 + (S.hash(x, 1, 113) > 0.6 ? 1 : 0);
      R(ctx, x, gy - h + 4, 2, h, '#9fb05a'); D(ctx, x, gy - h + 4, '#d6e08a'); R(ctx, x + 1, gy - h + 5, 1, h - 1, '#6f7f34');
      D(ctx, x, gy - 1, '#6f7f34');
    }
    R(ctx, gx, gy - 2, gw, 1, '#5a4024'); R(ctx, gx, gy + 1, gw, 1, '#5a4024');
    // Stepping stones in from the road.
    for (const [x, y] of [[274, 184], [280, 178], [287, 183]]) {
      groundShadow(ctx, x + 1, y + 1, 3, 1, 0.25);
      R(ctx, x - 3, y - 1, 6, 3, STONE.base); R(ctx, x - 3, y - 1, 6, 1, STONE.hi); R(ctx, x - 2, y + 2, 4, 1, STONE.dark);
    }
    // Rocks with moss.
    for (const [rx, ry, rw, rh, seed] of GROCKS) {
      const spr = rockSprite(1200 + seed, rw, rh);
      place(ctx, spr, rx - rw / 2, ry - rh, [2, 1, 0.3]);
    }
    // Bonsai on a little stone stand (north-east corner).
    R(ctx, 386, 186, 10, 3, STONE.light); R(ctx, 386, 189, 10, 2, STONE.dark); R(ctx, 388, 191, 6, 4, STONE.base);
    place(ctx, bonsaiSprite(), 383, 172, [2, 1, 0.25]);
    // The study desk: open book + candle when study blocks are scheduled today,
    // closed books otherwise; a flash-card stack per Quizlet prep set.
    drawDesk(ctx, 296, 186);
    // A stone lantern inside the garden and bamboo along the east edge.
    for (let k = 0; k < 6; k++) {
      const x = gx + gw - 2 + (k % 3), h = 22 + Math.floor(S.hash(k, 5, 114) * 10), y = gy + 34;
      R(ctx, x, y - h, 1, h, k % 2 ? '#6f8a3a' : '#9ab55a');
      for (let j = y - h; j < y; j += 5) D(ctx, x, j, '#4e6224');
      if (!winter) { D(ctx, x - 1, y - h + 2, '#7fae4a'); D(ctx, x + 1, y - h + 4, '#5f8a34'); D(ctx, x - 2, y - h + 3, '#7fae4a'); }
    }
  }

  function drawDesk(ctx, x, y) {
    const today = studyToday(), sets = prepSets();
    // Cushion.
    R(ctx, x + 3, y + 9, 8, 3, '#2f6f8a'); R(ctx, x + 3, y + 9, 8, 1, '#5aa0bd'); R(ctx, x + 3, y + 12, 8, 1, '#1d4a5c');
    groundShadow(ctx, x + 9, y + 8, 9, 2, 0.25);
    // Low desk.
    R(ctx, x, y, 18, 3, WOOD.base); R(ctx, x, y, 18, 1, WOOD.hi); R(ctx, x, y + 3, 18, 1, WOOD.deep);
    R(ctx, x + 1, y + 4, 2, 3, WOOD.dark); R(ctx, x + 15, y + 4, 2, 3, WOOD.dark);
    if (today > 0) {
      // Open book with text lines, brush, lit candle.
      R(ctx, x + 2, y - 2, 9, 3, PAPER); D(ctx, x + 6, y - 2, '#c9b78c'); D(ctx, x + 6, y - 1, '#c9b78c');
      R(ctx, x + 3, y - 1, 2, 1, INK); R(ctx, x + 8, y - 1, 2, 1, INK);
      R(ctx, x + 2, y + 1, 9, 1, '#8e2a1e');
      R(ctx, x + 14, y - 3, 2, 3, '#f5ecd2'); D(ctx, x + 14, y - 4, '#ffcf5a'); D(ctx, x + 14, y - 5, '#fff3c0');
    } else {
      // Closed books, neatly stacked.
      R(ctx, x + 2, y - 2, 8, 2, '#2f5e8a'); R(ctx, x + 3, y - 4, 7, 2, '#8e2a1e'); R(ctx, x + 2, y - 2, 8, 1, '#5d8bb8');
      D(ctx, x + 9, y - 4, PAPER); D(ctx, x + 9, y - 1, PAPER);
      R(ctx, x + 14, y - 2, 2, 2, '#f5ecd2'); D(ctx, x + 14, y - 3, '#3a2f2a');
    }
    for (let k = 0; k < Math.min(5, sets); k++) { R(ctx, x + 11, y - 1 - k, 3, 1, k % 2 ? '#fffaf0' : '#e8f0ff'); D(ctx, x + 13, y - 1 - k, '#b0b8c8'); }
  }

  function drawDovecote(ctx, x, y) {
    // Carrier-bird roost: a little dovecote on a post (birds from the School land here).
    groundShadow(ctx, x + 6, y, 6, 2, 0.25);
    const spr = cached('dovecote:' + season(), () => build(16, 26, (g) => {
      R(g, 7, 13, 2, 13, WOOD.base); R(g, 7, 13, 1, 13, WOOD.light); R(g, 5, 24, 6, 2, WOOD.dark);
      R(g, 2, 7, 12, 8, PLAS.base); R(g, 2, 7, 2, 8, PLAS.light); R(g, 12, 7, 2, 8, PLAS.dark);
      R(g, 4, 9, 3, 4, '#2a1a12'); R(g, 9, 9, 3, 4, '#2a1a12'); D(g, 4, 9, '#4a3020'); D(g, 9, 9, '#4a3020');
      R(g, 1, 14, 14, 2, WOOD.base); R(g, 1, 14, 14, 1, WOOD.hi);
      for (let k = 0; k < 5; k++) R(g, 0 + k, 6 - k, 16 - k * 2, 1, k === 0 ? JADE.deep : k < 3 ? JADE.base : JADE.light);
      D(g, 0, 5, P.gold); D(g, 15, 5, P.gold);
      if (season() === 'winter') R(g, 3, 1, 10, 2, P.snow);
      // A resting carrier dove on the perch.
      R(g, 11, 12, 3, 2, '#f4f1ea'); D(g, 14, 12, '#f4f1ea'); D(g, 13, 11, '#f4f1ea'); D(g, 14, 11, '#3a2f2a'); D(g, 15, 12, P.gold); D(g, 11, 13, '#c9c3cf');
    }, OUT));
    place(ctx, spr, x, y - 26, [2, 1, 0.22]);
  }

  function drawFlagPoles(ctx) {
    for (const p of POLES) {
      if (p.g > GROWTH) continue;
      groundShadow(ctx, p.x + 2, p.y, 3, 1, 0.25);
      R(ctx, p.x, p.y - p.h, 2, p.h, WOOD.base); R(ctx, p.x, p.y - p.h, 1, p.h, WOOD.hi); D(ctx, p.x, p.y - p.h - 1, P.gold);
    }
  }
  const POLES = [{ x: 168, y: 140, h: 34, g: 9 }, { x: 397, y: 145, h: 26, g: 2 }, { x: 289, y: 145, h: 26, g: 2 }];

  /* ======================================================== STATIC (20) */
  function drawBuildings(ctx) {
    const s = season();
    const items = [];
    if (GROWTH >= 3) items.push({ y: PAGODA.y + PAGODA.h, f: () => place(ctx, pagodaSprite(), PAGODA.x, PAGODA.y, [5, 3, 0.26]) });
    items.push({ y: TEMPLE.y + 100, f: () => place(ctx, templeSprite(), TEMPLE.x, TEMPLE.y, [6, 3, 0.28]) });
    if (GROWTH >= 2) items.push({ y: LIBRARY.y + LIBRARY.h - 1, f: () => place(ctx, librarySprite(), LIBRARY.x, LIBRARY.y, [5, 3, 0.26]) });
    items.push({ y: TEMPLE.y + 101, f: () => place(ctx, censerSprite(), CENSER.x - 8, CENSER.y - 12, [2, 1, 0.3]) });
    items.push({ y: PAVILION.y + PAVILION.h, f: () => place(ctx, pavilionSprite(), PAVILION.x, PAVILION.y, [4, 2, 0.26]) });
    items.push({ y: BOARD.y + BOARD.h, f: () => place(ctx, boardSprite(), BOARD.x, BOARD.y, [3, 1, 0.28]) });
    items.push({ y: GARDEN.y, f: () => drawGarden(ctx) });
    items.push({ y: 222, f: () => drawDovecote(ctx, 368, 222) });
    items.push({ y: 141, f: () => drawFlagPoles(ctx) });
    for (const [x, y] of LANTERNS) items.push({ y, f: () => { groundShadow(ctx, x + 2, y, 5, 1, 0.25); place(ctx, lanternSprite(), x - 5, y - 21, [2, 1, 0.22]); } });
    for (const [x, y, kind, size, seed] of TREES) {
      items.push({ y, f: () => {
        const spr = kind === 'pine' ? pineSprite(seed, size, s) : mapleSprite(seed, size, s);
        groundShadow(ctx, x + 2, y - 1, Math.round(spr.width * 0.36), 2, 0.22);
        place(ctx, spr, x - Math.floor(spr.width / 2) + 1, y - spr.height + 2, [3, 1, 0.18]);
      } });
    }
    // Moss-covered boulders and a memorial stele near the cliff foot.
    items.push({ y: 116, f: () => place(ctx, rockSprite(1301, 12, 8), 106, 108, [2, 1, 0.3]) });
    items.push({ y: 204, f: () => place(ctx, rockSprite(1302, 9, 6), 232, 198, [2, 1, 0.3]) });
    if (GROWTH < 3) items.push({ y: 112, f: () => stele(ctx, 152, 112) });
    if (GROWTH === 1) items.push({ y: 120, f: () => footings(ctx) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.f();
  }

  function footings(ctx) {
    // Growth 1: the library wing is staked out: stone footings and a timber stack.
    for (let k = 0; k < 5; k++) for (const yy of [92, 120]) {
      const x = 344 + k * 13;
      R(ctx, x, yy, 6, 4, STONE.base); R(ctx, x, yy, 6, 1, STONE.hi); R(ctx, x, yy + 3, 6, 1, STONE.deep);
    }
    S.px.line(ctx, 346, 96, 398, 96, '#d8c79a'); S.px.line(ctx, 346, 96, 346, 120, '#d8c79a'); S.px.line(ctx, 398, 96, 398, 120, '#d8c79a');
    groundShadow(ctx, 372, 112, 12, 2, 0.25);
    for (let k = 0; k < 3; k++) { R(ctx, 360 + k, 104 + k * 3, 24 - k * 2, 3, WOOD.base); R(ctx, 360 + k, 104 + k * 3, 24 - k * 2, 1, WOOD.hi); D(ctx, 360 + k, 105 + k * 3, WOOD.deep); }
  }

  function stele(ctx, x, y) {
    groundShadow(ctx, x + 3, y, 7, 2, 0.25);
    R(ctx, x - 5, y - 3, 12, 3, STONE.base); R(ctx, x - 5, y - 3, 12, 1, STONE.hi);
    R(ctx, x - 3, y - 18, 8, 15, STONE.base); R(ctx, x - 3, y - 18, 2, 15, STONE.light); R(ctx, x + 4, y - 18, 1, 15, STONE.dark);
    R(ctx, x - 2, y - 19, 6, 1, STONE.light);
    for (let k = 0; k < 4; k++) R(ctx, x, y - 15 + k * 3, 2, 1, STONE.deep);
    R(ctx, x - 4, y - 19, 10, 1, OUT); R(ctx, x - 4, y - 18, 1, 15, OUT); R(ctx, x + 5, y - 18, 1, 15, OUT);
    if (season() === 'winter') R(ctx, x - 3, y - 20, 8, 1, P.snow);
  }

  /* ======================================================= LIGHTS (once) */
  for (const [x, y] of LANTERNS) S.addLight({ x, y: y - 14, r: 30, color: P.lanternGlow, intensity: 0.85, flicker: true });
  S.addLight({ x: TCX, y: TEMPLE.y + 68, r: 46, color: P.lantern, intensity: 0.8, flicker: true });             // open temple doors
  S.addLight({ x: TCX - 40, y: TEMPLE.y + 64, r: 30, color: P.lanternGlow, intensity: 0.45 });
  S.addLight({ x: TCX + 40, y: TEMPLE.y + 64, r: 30, color: P.lanternGlow, intensity: 0.45 });
  S.addLight({ x: TCX - 52, y: TEMPLE.y + 60, r: 18, color: '#ff7a50', intensity: 0.7, flicker: true });        // red eave lanterns
  S.addLight({ x: TCX + 51, y: TEMPLE.y + 60, r: 18, color: '#ff7a50', intensity: 0.7, flicker: true });
  S.addLight({ x: CENSER.x, y: CENSER.y - 12, r: 12, color: '#ff9a50', intensity: 0.6, flicker: true });
  S.addLight({ x: BOARD.x + 19, y: BOARD.y + 18, r: 26, color: '#ffe9a8', intensity: 0.65, on: () => scrollCount() > 0 });
  if (studyToday() > 0) S.addLight({ x: 310, y: 182, r: 14, color: P.lanternGlow, intensity: 0.7, flicker: true });
  if (GROWTH >= 2) S.addLight({ x: LIBRARY.x + 37, y: LIBRARY.y + 38, r: 30, color: P.lanternGlow, intensity: 0.6 });
  if (GROWTH >= 3) for (const yy of [84, 60, 40]) S.addLight({ x: PAGODA.x + 23, y: PAGODA.y + yy, r: 18, color: P.lanternGlow, intensity: 0.55 });

  /* ======================================================== HOTSPOTS */
  const templeHot = S.addHotspot({
    id: 'landmark:temple', kind: 'landmark', landmark: 'temple', biome: 'monastery', agent: AGENT,
    label: 'Monastery Temple', x: TEMPLE.x + 6, y: TEMPLE.y, w: 156, h: 108, priority: 1,
  });
  const gardenHot = S.addHotspot({
    id: 'landmark:studyGarden', kind: 'landmark', landmark: 'studyGarden', biome: 'monastery', agent: AGENT,
    label: 'Study Garden', x: GARDEN.x - 16, y: GARDEN.y - 8, w: GARDEN.w + 16, h: GARDEN.h + 12, priority: 1,
  });

  /* ======================================================= DYNAMIC */
  let scrollCache = { at: -1e9, list: [] };
  function scrollList(t) {
    const now = t == null ? scrollCache.at : t;
    if (now - scrollCache.at > 5 || now < scrollCache.at) {
      scrollCache = { at: now, list: upcomingDeadlines() };
      const n = scrollCache.list.length;
      templeHot.label = n ? `Monastery Temple · ${n} upcoming deadline${n === 1 ? '' : 's'}` : 'Monastery Temple · scroll board empty';
      const st = studyToday();
      gardenHot.label = st ? `Study Garden · ${st} study block${st === 1 ? '' : 's'} today` : 'Study Garden';
    }
    return scrollCache.list;
  }
  const scrollCount = () => scrollList().length;

  const rm = S.reducedMotion;

  // 100: waterfall streaks and pool foam.
  S.registerDynamic(100, (ctx, t) => {
    const winter = season() === 'winter';
    const speed = winter ? 4 : rm ? 14 : 46;
    for (let x = FALL.x0; x < FALL.x1; x++) {
      const top = Math.round(cliffTop(x)), bot = faceBottom(x);
      const off = Math.floor(t * speed + S.hash(x, 0, 120) * 20);
      for (let y = top; y < bot; y++) {
        const k = (y - off + 1000) % 9;
        if (k === 0) D(ctx, x, y, winter ? '#ffffff' : P.foam);
        else if (k === 1 && (x & 1)) D(ctx, x, y, P.waterLight);
      }
    }
    const cy = Math.round(cliffBase(101)) + 8;
    const fr = Math.floor(t * (rm ? 3 : 8));
    for (let k = 0; k < 7; k++) {
      const fx = 96 + Math.floor(S.hash(k, fr, 121) * 11), fy = cy - 5 + Math.floor(S.hash(k, fr, 122) * 4);
      D(ctx, fx, fy, P.foam);
    }
    // Ripple ring expanding in the pool.
    const ph = (t * 0.7) % 1, rr = Math.round(3 + ph * 7);
    ctx.globalAlpha = 0.6 * (1 - ph);
    D(ctx, 101 - rr, cy, P.waterLight); D(ctx, 101 + rr, cy, P.waterLight); D(ctx, 101, cy + Math.round(rr * 0.5), P.waterLight);
    ctx.globalAlpha = 1;
  });

  // 200: the bronze bell (swings while the cycle bell rings), scrolls, lantern flames.
  S.registerDynamic(200, (ctx, t) => {
    const cer = S.cycle && S.cycle.ceremony;
    let sw = 0;
    if (cer && cer.progress < S.CEREMONY_BEATS.bell[1]) sw = Math.round(Math.sin(t * (rm ? 3 : 7)) * (rm ? 1 : 2));
    const bell = bellSprite();
    R(ctx, BELL.x, BELL.y - 3, 1, 3, '#2a2228');
    ctx.drawImage(bell, BELL.x - 6 + sw, BELL.y - 1);
    // Scrolls on the board, ribbon colour by urgency.
    const list = scrollList(t);
    const n = Math.min(BOARD_SLOTS.length, list.length);
    for (let k = 0; k < n; k++) {
      const days = daysUntil(list[k].due);
      const ribbon = days <= 1 ? '#d6402f' : days <= 3 ? '#e9a23b' : '#2b836c';
      const [sx, sy] = BOARD_SLOTS[k];
      const sway = rm ? 0 : Math.round(Math.sin(t * 1.3 + k * 1.7) * 0.6);
      ctx.drawImage(scrollSprite(ribbon), BOARD.x + sx - 3 - 1 + sway * 0, BOARD.y + sy - 1 + 1);
      if (sway) D(ctx, BOARD.x + sx - 3 + (sway > 0 ? 6 : -1), BOARD.y + sy + 8, ribbon);
    }
    if (list.length > BOARD_SLOTS.length) {
      // Extra scrolls rolled up in a basket at the foot of the board.
      const bx = BOARD.x + 26, by = BOARD.y + 37, extra = Math.min(5, list.length - BOARD_SLOTS.length);
      for (let k = 0; k < extra; k++) { R(ctx, bx + k * 2, by - 6 - (k % 2), 2, 5, PAPER); D(ctx, bx + k * 2, by - 6 - (k % 2), '#d6402f'); }
      R(ctx, bx - 1, by - 3, 12, 4, '#a07a3a'); R(ctx, bx - 1, by - 3, 12, 1, '#c9a45a'); R(ctx, bx - 1, by + 1, 12, 1, WOOD.deep);
    }
    // Lantern flames (and the censer embers).
    for (let i = 0; i < LANTERNS.length; i++) {
      const [x, y] = LANTERNS[i];
      const f = rm ? 0 : S.hash(i, Math.floor(t * 9), 130);
      R(ctx, x - 1, y - 14, 2, 2, f > 0.5 ? '#ffd27a' : '#ffb84d');
      D(ctx, x - 1 + (f > 0.75 ? 1 : 0), y - 15, '#fff3c0');
      if (f < 0.3) D(ctx, x, y - 13, '#ff8a3a');
    }
  });

  // 400: incense smoke, prayer flags, mist on the cliffs, critical pennant.
  const FLAGLINES = [
    { a: [TCX + 47, TEMPLE.y + 21], b: [366, 30], sag: 9, g: 0 },
    { a: [PAVILION.x + 25, PAVILION.y + 1], b: [TCX - 79, TEMPLE.y + 52], sag: 7, g: 1 },
    { a: [TCX - 46, TEMPLE.y + 21], b: [178, 34], sag: 4, g: 2 },
    { a: [POLES[2].x + 1, POLES[2].y - POLES[2].h], b: [POLES[1].x + 1, POLES[1].y - POLES[1].h], sag: 5, g: 2 },
    { a: [PAGODA.x + 24, PAGODA.y + 24], b: [TCX - 46, TEMPLE.y + 22], sag: 10, g: 3 },
].filter((l) => l.g <= GROWTH);

  // Paper-window rects in world px (temple lattice bays, library moon window, pagoda windows).
  const WINDOWS = [];
  {
    const pillarsAt = [-60, -38, -16, 12, 34, 56].map((o) => 84 + o - 1);
    for (let k = 0; k + 1 < pillarsAt.length; k++) {
      if (k === 2) continue;
      const a = pillarsAt[k] + 5, b = pillarsAt[k + 1];
      WINDOWS.push([TEMPLE.x + a + 2, TEMPLE.y + 57, b - a - 4, 12]);
    }
    for (let k = 0; k < 6; k++) WINDOWS.push([TEMPLE.x + 84 - 30 + k * 10 + 1, TEMPLE.y + 25, 6, 5]);
    if (GROWTH >= 2) WINDOWS.push([LIBRARY.x + 30, LIBRARY.y + 31, 14, 14], [LIBRARY.x + 13, LIBRARY.y + 37, 6, 12], [LIBRARY.x + 55, LIBRARY.y + 37, 6, 12]);
    if (GROWTH >= 3) for (const yy of [80, 56, 36]) WINDOWS.push([PAGODA.x + 21, PAGODA.y + yy, 4, 5]);
  }

  let mistSpr = null;
  function mistSprite() {
    if (mistSpr) return mistSpr;
    const [c, g] = mk(56, 9);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 56; x++) {
      const nx = (x - 28) / 28, ny = (y - 4.5) / 4.5, e = nx * nx + ny * ny;
      if (e > 1) continue;
      const a = (1 - e);
      if (S.hash(x, y, 140) < a * 0.9 && ((x + y) & 1 || a > 0.6)) { g.fillStyle = '#e9eef5'; g.fillRect(x, y, 1, 1); }
    }
    return (mistSpr = c);
  }

  S.registerDynamic(400, (ctx, t) => {
    // Incense smoke: three thin wisps curling up from the censer.
    const n = rm ? 8 : 24;
    for (let k = 0; k < n; k++) {
      const stick = k % 3;
      const ph = ((t * (rm ? 0.08 : 0.22) + k / n) % 1);
      const sx = CENSER.x - 2 + stick * 2, sy = CENSER.y - 17 + (stick === 1 ? -1 : 0);
      const y = sy - ph * 42;
      const x = sx + Math.sin(ph * 7 + t * 0.9 + stick) * ph * 5 + ph * 4;
      const a = 0.8 * (1 - ph) * Math.min(1, ph * 8);
      const sz = ph > 0.55 ? 3 : ph > 0.25 ? 2 : 1;
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = '#6a6478';
      ctx.fillRect(Math.round(x) + 1, Math.round(y) + 1, sz, sz);
      ctx.globalAlpha = a;
      ctx.fillStyle = ph < 0.3 ? '#f4f1f6' : '#dedae6';
      ctx.fillRect(Math.round(x), Math.round(y), sz, sz);
    }
    ctx.globalAlpha = 1;
    // Prayer flags: a sagging string with five-colour flags fluttering.
    for (let li = 0; li < FLAGLINES.length; li++) {
      const L = FLAGLINES[li];
      const [ax, ay] = L.a, [bx, by] = L.b;
      const len = Math.max(Math.hypot(bx - ax, by - ay), 1);
      const sag = L.sag + (rm ? 0 : Math.sin(t * 0.9 + li) * 0.8);
      const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1));
      ctx.fillStyle = '#4a3a30';
      let prev = null;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps, x = Math.round(ax + (bx - ax) * u), y = Math.round(ay + (by - ay) * u + sag * 4 * u * (1 - u));
        if (prev && Math.abs(prev - y) > 1) ctx.fillRect(x, Math.min(prev, y), 1, Math.abs(prev - y));
        ctx.fillRect(x, y, 1, 1); prev = y;
      }
      const nf = Math.max(2, Math.floor(len / 6));
      for (let f = 1; f < nf; f++) {
        const u = f / nf, x = Math.round(ax + (bx - ax) * u), y = Math.round(ay + (by - ay) * u + sag * 4 * u * (1 - u));
        const col = FLAG[(f + li) % FLAG.length];
        const flut = rm ? 0 : Math.sin(t * 5.5 + f * 1.3 + li * 2);
        ctx.fillStyle = col;
        ctx.fillRect(x - 1, y + 1, 3, 3);
        ctx.fillRect(x - 1 + (flut > 0.3 ? 1 : 0), y + 4, 2, 1);
        ctx.fillStyle = FLAG_DARK[(f + li) % FLAG.length];
        ctx.fillRect(x + 1, y + 1, 1, 3);
        if (flut > 0.6) ctx.fillRect(x + 2, y + 2, 1, 1);
      }
    }
    // Mist drifting along the cliff foot.
    const m = mistSprite();
    const drift = rm ? 0.6 : 2.2;
    for (let k = 0; k < 4; k++) {
      const span = 520, x = 70 + ((k * 137 + t * drift * (k % 2 ? 1 : 0.7)) % span);
      const y = Math.round(cliffBase(x + 28)) - 10 + (k % 2) * 4;
      ctx.globalAlpha = 0.16 + 0.08 * Math.sin(t * 0.3 + k);
      ctx.drawImage(m, Math.round(x), y);
    }
    ctx.globalAlpha = 1;
    // A red pennant on the temple finial when Abbot Quill's status is critical.
    if ((S.status.monastery || {}).level === 'critical') {
      const x = TCX, y = TEMPLE.y - 16;
      R(ctx, x - 1, y, 1, 16, OUT); R(ctx, x, y, 1, 16, WOOD.light); D(ctx, x, y - 1, P.gold);
      const f = rm ? 0 : Math.round(Math.sin(t * 6) * 1.2);
      R(ctx, x + 1, y + 1, 7, 2, '#e0322a'); R(ctx, x + 1, y + 3, 5 + f, 2, '#c42620'); R(ctx, x + 1, y + 5, 3, 1, '#9a1c16');
      D(ctx, x + 8 + f, y + 2, '#e0322a'); D(ctx, x + 2, y + 1, '#ff6a5a');
    }
  });

  // 700: soft glow over the darkness for glowing scrolls and lantern flames.
  S.registerDynamic(700, (ctx, t) => {
    const dark = 1 - ((S.time && S.time.light) == null ? 1 : S.time.light);
    const list = scrollList(t);
    const n = Math.min(BOARD_SLOTS.length, list.length);
    const pulse = rm ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.6);
    if (n) {
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < n; k++) {
        const [sx, sy] = BOARD_SLOTS[k];
        const x = BOARD.x + sx - 3, y = BOARD.y + sy;
        ctx.fillStyle = `rgba(255,214,130,${(0.1 + 0.12 * pulse + 0.25 * dark).toFixed(3)})`;
        ctx.fillRect(x - 1, y, 8, 10);
        ctx.fillStyle = `rgba(255,236,170,${(0.12 + 0.3 * dark).toFixed(3)})`;
        ctx.fillRect(x, y + 1, 6, 7);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    if (dark > 0.2) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,190,90,${(0.35 * dark).toFixed(3)})`;
      for (const [x, y] of LANTERNS) ctx.fillRect(x - 2, y - 15, 4, 4);
      // Warm paper windows of the temple (and library / pagoda when built).
      ctx.fillStyle = `rgba(255,186,96,${(0.22 * dark).toFixed(3)})`;
      for (const [x, y, w, h] of WINDOWS) ctx.fillRect(x, y, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
  });

  /* ======================================================= REGISTER */
  S.registerStatic(5, (ctx) => { drawGround(ctx); drawCliffs(ctx); });
  S.registerStatic(20, (ctx) => drawBuildings(ctx));
})();
