/* The Shack v2: Lantern Peak (Abbot Quill, academic-core).
 *
 * Owns the island 'monastery' (top rect tiles 3,2 23x16). Everything here is
 * fictional scenery driven by real data:
 *   static 5    ground overlay: courtyard paving, stepping stones, the spring
 *               pool and the stream that runs south to the island's lip
 *   static 20   the crag (a small terraced granite peak in the north-west with a
 *               cascading waterfall), temple, bell pavilion, scroll board, study
 *               garden, stone lanterns, library (growth 2), summit shrine
 *               (growth 3), the kite launch pad on the east edge, a few trees
 *   dyn 100     water animation: cascade, stream ripples, and the fall that pours
 *               off the south lip, down the underside and fades into space
 *   dyn 200     bronze bell (swings with the cycle bell), scrolls, lantern flames
 *   dyn 400     incense smoke, prayer flags, windsock, spray mist, alert pennant
 *   dyn 700     glowing scrolls, lantern flames and paper windows after dark
 * All dynamic layers pass {island: 'monastery'}; all lights pass island.
 *
 * Data: glowing scrolls on the board = upcoming deadlines from
 * S.metrics('academic-core').deadlines (a tidy empty board when there are
 * none). The study desk shows today's study blocks (open book, lit candle) and
 * Quizlet prep sets (flash-card stack). Nothing is invented.
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S || !S.islands || !S.islands.monastery) return;

  const T = S.TILE, P = S.PAL, C = S.color;
  const ID = 'monastery';
  const AGENT = 'academic-core';
  const GROWTH = ((S.status && S.status[ID]) || {}).growth | 0;
  const rm = S.reducedMotion;

  /* ------------------------------------------------------------- palette */
  const OUT = P.outline;
  const JADE = { deep: '#123a35', dark: '#1d5e51', base: '#2b836c', light: '#46a789', hi: '#86d3b4' };
  const VERM = { deep: '#5e1a14', dark: '#8e2a1e', base: '#c63f2b', light: '#e6684a', hi: '#f59a72' };
  const WOOD = { deep: '#38200f', dark: '#563219', base: '#7a4a2a', light: '#9d6a3e', hi: '#bf8c58' };
  const DECK = { deep: '#4a2e17', dark: '#6b4524', base: '#8e6136', light: '#ad7c48', hi: '#cf9f66' };
  const PLAS = { dark: '#c4b28c', base: '#e8dcc0', light: '#f6eedb' };
  const STONE = { deep: '#3e4250', dark: '#5a5f6d', base: '#7c818d', light: '#a0a4ad', hi: '#c6c8cc' };
  const BRONZE = { deep: '#3b2a17', dark: '#6b4a24', base: '#9a6d34', light: '#c99a50', hi: '#f0cf84', patina: '#5aa58a' };
  const SAND = { dark: '#bfae86', base: '#ddd0ad', light: '#efe6cc' };
  // Crag granite (matches the island underside), lightest first.
  const ROCK = ['#c9cdd9', '#a7adbd', '#8a90a4', '#6f758b', '#575c74', '#41455d', '#2d3045'];
  const WATER = { deep: '#2f6290', base: '#3f7fb0', light: '#6fb2d6', foam: '#d8eef5', white: '#ffffff' };
  const ICE = { deep: '#8fb6cf', base: '#b5d3e6', light: '#d4e8f3', foam: '#eef7fc', white: '#ffffff' };
  const PAPER = '#f5ecd2', INK = '#3a2f2a';
  const FLAG = ['#3a6fd4', '#f1eee4', '#d6402f', '#3c9a5a', '#f0c23e'];
  const FLAG_DARK = FLAG.map((c) => C.shade(c, -0.25));
  const KITE_COL = [['#d6402f', '#f07a5a', '#8e2216'], ['#2b836c', '#5fc2a0', '#174a3e'], ['#f0c23e', '#ffe08a', '#a8761e'], ['#3a6fd4', '#7aa6ff', '#1f3f8a']];
  const SHADOW_INK = '#140f1e';

  /* ------------------------------------------------------- tiny helpers */
  const rgb = (h) => C.hexToRgb(h);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pad2 = (n) => String(n).padStart(2, '0');
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bay = (x, y) => (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
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
  /** Soft contact shadow (an ellipse) on the ground. */
  function groundShadow(ctx, cx, cy, rx, ry, a) {
    ctx.fillStyle = C.rgba(SHADOW_INK, a == null ? 0.22 : a);
    for (let y = -ry; y <= ry; y++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.5))));
      ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
    }
  }

  /* ------------------------------------------------------------ seasons */
  const season = () => (S.time && S.time.season) || 'autumn';
  const isWinter = () => season() === 'winter';
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
  // Island turf tones (match the islands module's Lantern Peak turf) for blending.
  const TURF = { spring: ['#5f9f66', '#457f52'], summer: ['#4f8f5e', '#386f48'], autumn: ['#7b8a52', '#5c6c40'], winter: ['#e3ebf1', '#c6d3dc'] };

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
   * Native px. The island top spans roughly x 54..410, y 33..268.
   * The vertical path runs x 208..240 from y 160, the east path y 208..240.
   */
  const TEMPLE = { x: 140, y: 50, w: 168, h: 112 };   // sprite origin; stairs foot at y 158
  const TCX = TEMPLE.x + 84;                          // 224, centred on the path
  const LIBRARY = { x: 313, y: 70, w: 62, h: 70 };
  const PAVILION = { x: 118, y: 152, w: 50, h: 54 };
  const BELL = { x: PAVILION.x + 25, y: PAVILION.y + 19 };
  const BOARD = { x: 168, y: 166, w: 38, h: 36 };
  const GARDEN = { x: 254, y: 158, w: 104, h: 48 };
  const DESK = { x: 296, y: 188 };
  const CENSER = { x: TCX, y: TEMPLE.y + 84 };
  const PAD = { x: 372, y: 166, w: 58, h: 96 };        // kite launch pad sprite box
  const DECK0 = { x: PAD.x + 4, y: PAD.y + 40, w: 52, h: 32 }; // deck top face (world px)
  const SOCK = { x: PAD.x + 52, y: PAD.y + 6 };       // windsock ring (top of the pole)
  const POOL = { x: 106, y: 127, rx: 13, ry: 6 };

  // Stone lanterns (feet positions). More with growth.
  const LANTERNS = [[201, 161], [248, 161]];
  if (GROWTH >= 1) LANTERNS.push([200, 240], [254, 256]);
  if (GROWTH >= 3) LANTERNS.push([122, 146], [372, 256]);

  // Signature trees: [x feet, y feet, kind, size, seed]. The islands module scatters the rest.
  const TREES = [
    [140, 238, 'maple', 22, 31], [76, 146, 'maple', 18, 32], [172, 256, 'pine', 12, 33],
    [302, 62, 'pine', 13, 37], [318, 56, 'maple', 18, 38], [168, 66, 'pine', 11, 39],
    [394, 116, 'maple', 18, 40], [384, 156, 'pine', 12, 41], [70, 178, 'pine', 12, 42], [74, 214, 'maple', 16, 43],
    [190, 264, 'maple', 16, 44], [232, 262, 'pine', 11, 45], [322, 262, 'maple', 18, 46], [346, 256, 'pine', 12, 47],
  ];
  if (GROWTH < 1) TREES.push([334, 126, 'maple', 20, 34], [362, 136, 'pine', 12, 35]);
  else if (GROWTH < 2) TREES.push([370, 140, 'pine', 11, 36]);

  /* ============================================================ THE CRAG
   * A small terraced granite peak, rendered from a heightfield seen in 3/4:
   * for each column the ground is walked from south (near) to north (far);
   * every point that rises above what is already drawn paints its top pixel
   * and the cliff face below it. Light comes from the top-left.
   */
  const CR = { x0: 66, x1: 172, y0: 52, y1: 130 };      // ground bbox
  const PEAKS = [
    { x: 105, y: 96, h: 80, rx: 31, ry: 26, cap: 66 },
    { x: 87, y: 104, h: 44, rx: 13, ry: 12 },
    { x: 140, y: 104, h: 36, rx: 22, ry: 15 },
  ];
  // West rim of the island top (from the islands module's shape), so the crag stays on solid ground.
  const WEST = [[56, 92], [64, 91], [72, 86], [80, 83], [88, 80], [96, 75], [104, 70], [112, 69], [120, 72], [128, 71], [136, 69]];
  const westEdge = (gy) => { for (let i = WEST.length - 1; i >= 0; i--) if (gy >= WEST[i][0]) return WEST[i][1]; return 95; };
  const STEP = 8;                                        // ledge height
  const chanX = (gy) => 111 - (gy - 100) * 0.12;         // the waterfall gully
  const SRC_GY = 100;                                    // the spring's ground row
  const CW = CR.x1 - CR.x0, CGH = CR.y1 - CR.y0 + 1;
  const HQ = new Float32Array(CW * CGH);                 // terraced heights
  const HS = new Float32Array(CW * CGH);                 // smooth heights (for shading)
  (function heights() {
    for (let gy = CR.y0; gy <= CR.y1; gy++) for (let x = CR.x0; x < CR.x1; x++) {
      let h = 0;
      for (const p of PEAKS) {
        const dx = (x - p.x) / p.rx, dy = (gy - p.y) / p.ry;
        let d = Math.sqrt(dx * dx + dy * dy);
        d *= 1 + (vnoise(x / 9, gy / 9, 301) - 0.5) * 0.6 + (vnoise(x / 3.5, gy / 3.5, 302) - 0.5) * 0.14;
        if (d < 1) h = Math.max(h, Math.min(p.cap || 1e9, p.h * Math.pow(1 - d, 1.05)));
      }
      h *= clamp((x - westEdge(gy) - 6) / 7, 0, 1);
      const dc = Math.abs(x + 0.5 - chanX(gy));
      if (gy >= SRC_GY - 3 && dc < 5) h -= (5 - dc) * 0.9;   // carve the gully
      h = Math.max(0, h);
      const i = (gy - CR.y0) * CW + (x - CR.x0);
      HS[i] = h;
      HQ[i] = h < 1.2 ? 0 : Math.floor(h / STEP) * STEP + (h % STEP) * 0.12 + 1;
    }
  })();
  const hq = (x, gy) => (x < CR.x0 || x >= CR.x1 || gy < CR.y0 || gy > CR.y1 ? 0 : HQ[(gy - CR.y0) * CW + (x - CR.x0)]);
  const hs = (x, gy) => (x < CR.x0 || x >= CR.x1 || gy < CR.y0 || gy > CR.y1 ? 0 : HS[(gy - CR.y0) * CW + (x - CR.x0)]);
  const inGully = (x, gy) => gy >= SRC_GY && Math.abs(x + 0.5 - chanX(gy)) <= 2.6 && hq(x, gy) > 0 && hq(x, gy) < 44;

  /* Screen-space raster of the crag (season independent geometry):
   * kind 1 = sloped top, 2 = ledge top, 3 = cliff face, 4 = water top, 5 = falling water. */
  const CRH = CR.y1 + 2;
  const CK = new Uint8Array(CW * CRH), CGY = new Int16Array(CW * CRH), CDEP = new Uint8Array(CW * CRH);
  const CTOP = new Int16Array(CW).fill(9999);          // screen top of the crag per column
  const CTOPS = [];                                     // visible ledge tops (for pines, shrine)
  const CFALL = [];                                     // falling-water pixels [x, y]
  const CWAT = [];                                      // every water pixel of the cascade [x, y]
  (function raster() {
    for (let x = CR.x0; x < CR.x1; x++) {
      let ymin = 1e9;
      for (let gy = CR.y1; gy >= CR.y0; gy--) {
        const h = hq(x, gy);
        if (h <= 0) continue;
        const sy = Math.round(gy - h);
        if (sy >= ymin) continue;
        const bottom = Math.min(ymin - 1, gy);
        const span = bottom - sy + 1;
        const water = inGully(x, gy);
        const lx = x - CR.x0;
        for (let y = Math.max(0, sy); y <= bottom; y++) {
          const k = y - sy, i = y * CW + lx;
          let kind;
          if (span <= 2) kind = water ? 4 : 1;
          else kind = k === 0 ? (water ? 4 : 2) : water ? 5 : 3;
          CK[i] = kind; CGY[i] = gy; CDEP[i] = Math.min(255, k);
          if (kind === 5) CFALL.push([x, y]);
          if (kind >= 4) CWAT.push([x, y]);
        }
        if (span > 2 && !water) CTOPS.push({ x, sy, gy, h });
        ymin = sy;
      }
      if (ymin < 1e9) CTOP[x - CR.x0] = ymin;
    }
  })();
  const cragTopAt = (x) => (x >= CR.x0 && x < CR.x1 ? CTOP[x - CR.x0] : 9999);

  // The spring: where the gully meets the face, a dark cleft the water spills from.
  const SPRING = (function () {
    let best = null;
    for (const [x, y] of CWAT) if (!best || y < best.y || (y === best.y && Math.abs(x - 111) < Math.abs(best.x - 111))) best = { x, y };
    return best || { x: 111, y: 60 };
  })();

  // The summit, where the peak's namesake lantern stands.
  const SUMMIT = (function () {
    let bx = PEAKS[0].x, by = 9999;
    for (let x = CR.x0 + 20; x < CR.x1 - 30; x++) if (cragTopAt(x) < by) { by = cragTopAt(x); bx = x; }
    return { x: bx, y: by };
  })();
  // Seat the pool where the cascade lands.
  (function seatPool() {
    let fy = -1, fx = 0, n = 0;
    for (const [, y] of CWAT) if (y > fy) fy = y;
    for (const [x, y] of CWAT) if (y >= fy - 1) { fx += x; n++; }
    if (n) { POOL.x = Math.round(fx / n); POOL.y = fy + POOL.ry - 2; }
  })();

  /* ============================================================ THE STREAM
   * From the pool at the crag's foot, south to the lip, where it pours off.
   */
  const STREAM = [[POOL.x - 1, POOL.y + POOL.ry - 1], [100, 142], [96, 156], [98, 172], [105, 186], [104, 201], [98, 215], [99, 230], [105, 244], [108, 256], [108, 262]];
  const EXIT_X = 108;                                   // where it leaves the island
  const SPIX = [];                                      // [x, y, s, d] water pixels
  const SBANK = [];                                     // [x, y, side] bank pixels
  (function streamPixels() {
    const seg = [];
    let acc = 0;
    for (let i = 0; i + 1 < STREAM.length; i++) {
      const [ax, ay] = STREAM[i], [bx, by] = STREAM[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      seg.push({ ax, ay, bx, by, len, s0: acc }); acc += len;
    }
    for (let y = 128; y <= 262; y++) for (let x = 84; x <= 124; x++) {
      let best = 1e9, bs = 0, side = 0;
      for (const q of seg) {
        const vx = q.bx - q.ax, vy = q.by - q.ay;
        const u = clamp(((x + 0.5 - q.ax) * vx + (y + 0.5 - q.ay) * vy) / (q.len * q.len), 0, 1);
        const px_ = q.ax + vx * u, py_ = q.ay + vy * u;
        const d = Math.hypot(x + 0.5 - px_, y + 0.5 - py_);
        if (d < best) { best = d; bs = q.s0 + u * q.len; side = (x + 0.5 - px_) * vy - (y + 0.5 - py_) * vx; }
      }
      const hw = 2.1 + Math.min(1, bs / 90) * 1.1 + (vnoise(bs / 9, 0, 311) - 0.5) * 0.8;
      if (best <= hw) SPIX.push([x, y, bs, best / hw]);
      else if (best <= hw + 1.3) SBANK.push([x, y, side < 0 ? -1 : 1]);
    }
  })();

  // Columns of the fall off the lip; lip and underside depth are measured from
  // the islands module's art at the first static draw (fallbacks if absent).
  const FALL = [];
  for (let x = EXIT_X - 3; x <= EXIT_X + 3; x++) FALL.push({ x, lip: 266, bot: 324 });

  /* ----------------------------------------------------- reserve tiles */
  (function reserveAll() {
    const rpx = (x, y, w, h) => {
      const tx0 = Math.floor(x / T), ty0 = Math.floor(y / T), tx1 = Math.floor((x + w - 1) / T), ty1 = Math.floor((y + h - 1) / T);
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (!S.onRoad(tx, ty)) S.reserve(tx, ty);
    };
    rpx(CR.x0, 8, CW, CR.y1 - 8);                    // the crag and everything it hides
    rpx(POOL.x - POOL.rx - 2, POOL.y - POOL.ry - 2, POOL.rx * 2 + 4, POOL.ry * 2 + 4);
    const seen = new Set();
    for (const [x, y] of SPIX.concat(SBANK)) {
      const k = Math.floor(x / T) + ',' + Math.floor(y / T);
      if (!seen.has(k)) { seen.add(k); S.reserve(Math.floor(x / T), Math.floor(y / T)); }
    }
    rpx(TEMPLE.x + 6, TEMPLE.y, 156, 108);
    rpx(PAVILION.x, PAVILION.y, PAVILION.w, PAVILION.h);
    rpx(BOARD.x, BOARD.y, BOARD.w, BOARD.h);
    rpx(GARDEN.x, GARDEN.y - 6, GARDEN.w, GARDEN.h + 6);
    rpx(160, 150, 96, 58);                               // courtyard paving
    if (GROWTH >= 1) rpx(LIBRARY.x, LIBRARY.y + 8, LIBRARY.w, LIBRARY.h - 8);
    rpx(PAD.x, PAD.y + 10, PAD.w, 74);
    for (const [x, y] of LANTERNS) rpx(x - 5, y - 20, 10, 20);
    for (const [x, y] of TREES) rpx(x - 4, y - 8, 8, 8);
  })();

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
        R(g, tx, ch - 6, 3, H - ch + 6, WOOD.base); R(g, tx + 2, ch - 6, 1, H - ch + 6, WOOD.dark); R(g, tx, ch - 6, 1, H - ch + 6, WOOD.light);
        R(g, tx - 1, H - 1, 5, 1, WOOD.dark);
        if (!pal) {
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

  /** Curved roof (front slope + hips), upturned eave tips, glazed tile ribs. */
  function drawRoof(g, cx, y0, h, rh, eh, o) {
    o = o || {};
    const J = o.pal || JADE, lift = o.lift == null ? 4 : o.lift, snow = isWinter();
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
      if (d > eh - 1.5) D(g, x, top - 1, P.gold);
    }
  }

  function goldCurl(g, x, y, dir) {
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
    R(g, x - 1, y + h - 2, 7, 2, STONE.light); R(g, x - 1, y + h - 1, 7, 1, STONE.dark);
  }

  function templeSprite() {
    return cached('temple:' + season(), () => build(TEMPLE.w, TEMPLE.h, (g) => {
      const cx = 84, s = season();
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
        else if (S.hash(x, y, 83) > 0.97 && s !== 'winter') D(g, x, y, P.grassDark[s]);
      }
      R(g, 10, 86, 148, 1, STONE.dark);
      if (s === 'winter') { for (let x = 10; x < 158; x++) if (S.hash(x, 0, 84) > 0.25) D(g, x, 76, P.snow); }
      // Front stairs.
      for (let k = 0; k < 6; k++) {
        const y = 84 + k * 4;
        R(g, 70, y, 28, 2, STONE.hi); R(g, 70, y + 2, 28, 2, STONE.dark);
        D(g, 70, y, STONE.light); D(g, 97, y + 2, STONE.deep);
        if (s === 'winter') R(g, 72, y, 22, 1, P.snow);
      }
      R(g, 66, 84, 4, 24, STONE.base); R(g, 98, 84, 4, 24, STONE.dark); R(g, 66, 84, 4, 1, STONE.hi); R(g, 98, 84, 4, 1, STONE.light);
      R(g, 66, 84, 1, 24, STONE.light);
      // Walls: vermilion pillars, lattice panels, the open doors.
      R(g, 24, 52, 120, 26, WOOD.dark);
      const pillarsAt = [-60, -38, -16, 12, 34, 56].map((o) => cx + o - 1);
      for (let k = 0; k + 1 < pillarsAt.length; k++) {
        const a = pillarsAt[k] + 5, b = pillarsAt[k + 1];
        if (k === 2) continue;
        lattice(g, a + 1, 56, b - a - 2, 14);
        R(g, a, 70, b - a, 8, WOOD.base); R(g, a, 70, b - a, 1, WOOD.light); R(g, a + 2, 72, b - a - 4, 4, WOOD.dark);
        R(g, a + 3, 73, b - a - 6, 2, WOOD.base);
      }
      const d0 = pillarsAt[2] + 5, d1 = pillarsAt[3];
      R(g, d0, 56, d1 - d0, 22, '#2a160d');
      for (let y = 60; y < 78; y++) for (let x = d0 + 3; x < d1 - 3; x++) {
        const k = Math.abs(x - cx) / 10 + Math.abs(y - 70) / 10;
        if (k < 0.9) D(g, x, y, k < 0.45 ? '#9a5a26' : '#6a3a1a');
      }
      R(g, cx - 3, 59, 6, 9, PAPER); R(g, cx - 3, 59, 6, 1, WOOD.dark); R(g, cx - 3, 67, 6, 1, WOOD.dark);
      for (let k = 0; k < 3; k++) R(g, cx - 1 + (k % 2), 61 + k * 2, 2, 1, INK);
      R(g, cx - 6, 72, 12, 2, WOOD.light); R(g, cx - 6, 74, 12, 4, WOOD.dark);
      D(g, cx - 4, 70, P.lanternGlow); D(g, cx - 4, 71, '#fff3c0'); D(g, cx + 3, 70, P.lanternGlow); D(g, cx + 3, 71, '#fff3c0');
      R(g, cx - 1, 70, 2, 2, P.gold);
      for (const [x, dir] of [[d0, 1], [d1 - 3, -1]]) {
        R(g, x, 56, 3, 22, VERM.dark); R(g, x + (dir > 0 ? 0 : 2), 56, 1, 22, VERM.base);
        for (let y = 59; y < 76; y += 4) D(g, x + 1, y, P.gold);
      }
      for (const x of pillarsAt) pillar(g, x, 54, 24);
      g.fillStyle = 'rgba(20,12,24,0.45)'; g.fillRect(22, 52, 124, 5);
      g.fillStyle = 'rgba(20,12,24,0.25)'; g.fillRect(22, 57, 124, 2);
      // Name plaque under the eave.
      R(g, cx - 9, 50, 18, 7, '#1d2a3a'); R(g, cx - 9, 50, 18, 1, P.gold); R(g, cx - 9, 56, 18, 1, P.goldDark);
      D(g, cx - 9, 51, P.gold); D(g, cx + 8, 51, P.goldDark);
      for (let k = 0; k < 4; k++) { R(g, cx - 6 + k * 4, 52, 2, 1, P.gold); D(g, cx - 5 + k * 4, 54, P.gold); D(g, cx - 6 + k * 4, 53, P.goldDark); }
      // Upper storey bracket band.
      R(g, cx - 34, 16, 68, 16, VERM.dark);
      for (let x = cx - 34; x < cx + 34; x++) {
        const k = (x - cx + 34) % 6;
        D(g, x, 17, k < 3 ? '#2f8a76' : VERM.base); D(g, x, 18, k === 0 || k === 5 ? P.gold : VERM.base);
        D(g, x, 21, k < 2 ? WOOD.light : WOOD.dark); D(g, x, 22, k < 2 ? WOOD.base : WOOD.deep);
      }
      for (let k = 0; k < 6; k++) lattice(g, cx - 30 + k * 10, 24, 8, 7);
      drawRoof(g, cx, 28, 28, 46, 80, { lift: 5 });
      drawRoof(g, cx, 2, 21, 22, 46, { lift: 4 });
      goldCurl(g, cx - 23, 3, -1); goldCurl(g, cx + 22, 3, 1);
      goldCurl(g, cx - 47, 29, -1); goldCurl(g, cx + 46, 29, 1);
      R(g, cx - 1, -2, 2, 4, P.gold); D(g, cx - 1, -2, '#fff1b8'); R(g, cx - 2, 1, 4, 1, P.goldDark);
      // Red paper lanterns at the lower eave corners.
      for (const lx of [cx - 52, cx + 51]) {
        D(g, lx, 54, OUT); D(g, lx, 55, OUT);
        R(g, lx - 2, 56, 5, 1, P.goldDark);
        R(g, lx - 3, 57, 7, 5, '#d23a2a'); R(g, lx - 2, 57, 2, 5, '#f0664a'); R(g, lx + 2, 57, 1, 5, '#8e2216');
        R(g, lx - 2, 62, 5, 1, P.goldDark); D(g, lx, 63, '#f0c23e'); D(g, lx, 64, '#d6402f');
      }
    }, OUT));
  }

  function librarySprite() {
    const W = LIBRARY.w, cx = W >> 1;
    return cached('library:' + season(), () => build(W, LIBRARY.h, (g) => {
      // Stone base.
      R(g, 3, 58, W - 6, 9, STONE.base); R(g, 3, 58, W - 6, 1, STONE.hi); R(g, 3, 66, W - 6, 1, STONE.deep);
      for (let x = 3; x < W - 3; x += 8) R(g, x, 59, 1, 7, STONE.dark);
      // Walls: plaster with a dark timber frame.
      const wl = 7, wr = W - 7;
      R(g, wl, 25, wr - wl, 33, PLAS.base);
      R(g, wl, 25, wr - wl, 2, PLAS.dark);
      for (let y = 27; y < 58; y++) for (let x = wl; x < wr; x++) if (S.hash(x, y, 91) > 0.94) D(g, x, y, PLAS.dark);
      R(g, wl, 25, 2, 33, WOOD.dark); R(g, wr - 2, 25, 2, 33, WOOD.dark); R(g, wl, 49, wr - wl, 2, WOOD.dark); R(g, wl, 25, 1, 33, WOOD.base);
      // Moon window full of books.
      const wy = 37, r = 9;
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
      lattice(g, wr - 13, 35, 8, 14); lattice(g, wl + 4, 35, 8, 14);
      R(g, cx - 6, 51, 12, 6, WOOD.base); R(g, cx - 6, 51, 12, 1, WOOD.light);
      for (let k = 0; k < 3; k++) R(g, cx - 4 + k * 3, 53, 2, 2, PAPER);
      g.fillStyle = 'rgba(20,12,24,0.4)'; g.fillRect(wl, 25, wr - wl, 4);
      drawRoof(g, cx, 2, 25, 14, cx, { lift: 4 });
      goldCurl(g, cx - 15, 3, -1); goldCurl(g, cx + 14, 3, 1);
    }, OUT));
  }

  function pavilionSprite() {
    return cached('pavilion:' + season(), () => build(PAVILION.w, PAVILION.h, (g) => {
      const cx = 25;
      R(g, 2, 44, 46, 9, STONE.base); R(g, 2, 44, 46, 2, STONE.light); R(g, 2, 44, 46, 1, STONE.hi); R(g, 2, 52, 46, 1, STONE.deep);
      for (let x = 5; x < 48; x += 9) R(g, x, 47, 1, 5, STONE.dark);
      if (isWinter()) R(g, 3, 44, 40, 1, P.snow);
      R(g, 12, 16, 3, 29, VERM.dark); R(g, 35, 16, 3, 29, VERM.deep);
      R(g, 13, 22, 24, 1, WOOD.dark);
      pillar(g, 5, 14, 32); pillar(g, 40, 14, 32);
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

  // Peg positions inside the board sprite (local px); scrolls hang from these.
  const BOARD_SLOTS = [[11, 11], [19, 11], [27, 11], [11, 20], [19, 20], [27, 20]];
  function boardSprite() {
    return cached('board:' + season(), () => build(BOARD.w, BOARD.h, (g) => {
      R(g, 1, 5, 3, 31, WOOD.base); R(g, 1, 5, 1, 31, WOOD.light); R(g, 3, 5, 1, 31, WOOD.deep);
      R(g, 34, 5, 3, 31, WOOD.base); R(g, 34, 5, 1, 31, WOOD.light); R(g, 36, 5, 1, 31, WOOD.deep);
      R(g, 4, 8, 30, 23, WOOD.dark);
      for (let y = 9; y < 30; y++) for (let x = 5; x < 33; x++) {
        let col = (y - 9) % 7 === 6 ? WOOD.deep : S.hash(x >> 2, y, 101) > 0.55 ? '#8a5732' : '#7e4f2d';
        if ((y - 9) % 7 === 0) col = WOOD.light;
        D(g, x, y, col);
      }
      for (const [x, y] of BOARD_SLOTS) { R(g, x - 1, y - 1, 2, 2, WOOD.hi); D(g, x, y, WOOD.deep); }
      // Ledge with brush and ink stone.
      R(g, 3, 31, 32, 3, WOOD.base); R(g, 3, 31, 32, 1, WOOD.hi); R(g, 3, 33, 32, 1, WOOD.deep);
      R(g, 7, 29, 7, 2, '#26232b'); D(g, 8, 29, '#4a4652'); R(g, 10, 30, 2, 1, '#0d0c10');
      R(g, 18, 30, 9, 1, '#c9a46a'); D(g, 27, 30, '#2a2228'); D(g, 28, 30, '#2a2228');
      drawRoof(g, 19, 0, 8, 12, 20, { lift: 2 });
    }, OUT));
  }

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
      const s = season(), winter = s === 'winter';
      R(g, 0, 17, 10, 4, STONE.base); R(g, 0, 17, 10, 1, STONE.hi); R(g, 7, 18, 3, 3, STONE.dark);
      R(g, 3, 11, 4, 6, STONE.base); R(g, 3, 11, 1, 6, STONE.light); R(g, 6, 11, 1, 6, STONE.dark);
      R(g, 1, 10, 8, 2, STONE.light); R(g, 1, 11, 8, 1, STONE.dark);
      R(g, 1, 5, 8, 5, STONE.base); R(g, 1, 5, 1, 5, STONE.light); R(g, 8, 5, 1, 5, STONE.dark);
      R(g, 3, 6, 4, 3, '#4a2410');
      for (let x = -1; x <= 10; x++) { const y = 4 - (x < 1 || x > 8 ? 1 : 0); D(g, x, y, STONE.dark); }
      R(g, 0, 2, 10, 2, STONE.light); R(g, 2, 1, 6, 1, STONE.hi); R(g, 4, 0, 2, 1, STONE.light);
      if (winter) { R(g, 1, 1, 8, 1, P.snow); R(g, 0, 2, 6, 1, P.snow); R(g, 1, 10, 5, 1, P.snow); }
      else { D(g, 2, 2, P.grassDark[s]); D(g, 7, 3, P.grassDark[s]); D(g, 1, 19, P.grassDark[s]); }
    }, OUT));
  }

  function censerSprite() {
    return cached('censer', () => build(16, 13, (g) => {
      R(g, 2, 10, 2, 3, BRONZE.dark); R(g, 12, 10, 2, 3, BRONZE.deep); R(g, 7, 10, 2, 2, BRONZE.dark);
      R(g, 1, 5, 14, 6, BRONZE.base); R(g, 1, 5, 3, 6, BRONZE.light); R(g, 12, 5, 3, 6, BRONZE.dark);
      R(g, 2, 6, 1, 3, BRONZE.hi); D(g, 8, 8, BRONZE.patina); D(g, 5, 9, BRONZE.patina); D(g, 10, 7, BRONZE.patina);
      R(g, 0, 4, 16, 2, BRONZE.light); R(g, 0, 4, 16, 1, BRONZE.hi);
      R(g, 2, 3, 12, 1, '#5a4a3c');
      for (const [x, h] of [[6, 4], [8, 5], [10, 3]]) { R(g, x, 3 - h, 1, h, '#a0522d'); D(g, x, 2 - h, '#ff6a3a'); }
    }, BRONZE.deep));
  }

  function rockSprite(seed, w, h) {
    return cached(`rock:${seed}:${w}:${h}:${season()}`, () => build(w, h, (g) => {
      const s = season(), winter = s === 'winter';
      const cx = w / 2, cy = h * 0.6;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const nx = (x + 0.5 - cx) / (w / 2), ny = (y + 0.5 - cy) / (h * 0.62);
        const e = nx * nx + ny * ny * (ny < 0 ? 0.9 : 1.6) + (S.hash(x, y, seed) - 0.5) * 0.18;
        if (e > 1) continue;
        const lit = -nx * 0.7 - ny * 0.9;
        let col = lit > 0.55 ? STONE.hi : lit > 0.1 ? STONE.light : lit > -0.45 ? STONE.base : STONE.dark;
        if (y > h - 3) col = STONE.deep;
        if (ny < -0.35 && S.hash(x, y, seed + 1) > 0.45) col = winter ? P.snow : (S.hash(x, y, seed + 2) > 0.5 ? P.grassDark[s] : '#5f8a3e');
        if (S.hash(x, y, seed + 3) > 0.93) col = STONE.deep;
        D(g, x, y, col);
      }
    }, OUT));
  }

  function bonsaiSprite() {
    return cached('bonsai:' + season(), () => build(16, 15, (g) => {
      const s = season();
      R(g, 2, 11, 12, 3, '#2f5f8f'); R(g, 2, 11, 12, 1, '#5f93c4'); R(g, 3, 14, 10, 1, '#1d3a5a'); R(g, 3, 11, 2, 3, '#4a7db0');
      S.px.line(g, 7, 11, 6, 8, WOOD.dark); S.px.line(g, 6, 8, 9, 5, WOOD.dark); S.px.line(g, 7, 10, 7, 8, WOOD.light);
      S.px.line(g, 8, 6, 12, 5, WOOD.dark);
      const pal = s === 'winter' ? null : s === 'autumn' ? foliagePal(0, s) : PINE;
      for (const [x, y, r] of [[4, 5, 3], [10, 3, 3], [13, 5, 2]]) {
        if (!pal) { R(g, x - r, y, r * 2, 1, P.snow); continue; }
        R(g, x - r, y - 1, r * 2 + 1, 2, pal.base); R(g, x - r + 1, y - 2, r * 2 - 1, 1, pal.light); R(g, x - r, y + 1, r * 2 + 1, 1, pal.dark);
        D(g, x - r + 1, y - 2, pal.hi);
      }
    }, OUT));
  }

  /** A tiny jade-roofed shrine for the crag shoulder (growth 3). */
  function shrineSprite() {
    return cached('shrine:' + season(), () => build(20, 22, (g) => {
      R(g, 1, 18, 18, 4, STONE.base); R(g, 1, 18, 18, 1, STONE.hi); R(g, 1, 21, 18, 1, STONE.deep);
      pillar(g, 3, 9, 10); pillar(g, 12, 9, 10);
      R(g, 8, 11, 4, 7, '#2a160d'); D(g, 9, 14, P.lanternGlow); D(g, 10, 14, '#fff3c0'); D(g, 9, 15, P.lantern);
      drawRoof(g, 10, 0, 10, 4, 10, { lift: 2 });
      R(g, 9, -2, 2, 2, P.gold);
    }, OUT));
  }

  /** The peak's namesake: a stone beacon lantern on the summit. */
  function beaconSprite() {
    return cached('beacon:' + season(), () => build(13, 19, (g) => {
      const winter = isWinter();
      R(g, 0, 16, 13, 3, STONE.base); R(g, 0, 16, 13, 1, STONE.hi); R(g, 9, 17, 4, 2, STONE.dark);
      R(g, 4, 11, 5, 5, STONE.base); R(g, 4, 11, 1, 5, STONE.light); R(g, 8, 11, 1, 5, STONE.dark);
      R(g, 1, 5, 11, 6, STONE.base); R(g, 1, 5, 2, 6, STONE.light); R(g, 11, 5, 1, 6, STONE.dark);
      R(g, 3, 6, 7, 4, '#5a2a10'); R(g, 4, 7, 5, 2, '#ffd27a'); D(g, 5, 7, '#fff3c0');
      R(g, 1, 10, 11, 1, STONE.dark);
      drawRoof(g, 6.5, 0, 5, 2, 7, { lift: 1 });
      R(g, 6, -2, 1, 2, P.gold);
      if (winter) R(g, 1, 15, 8, 1, P.snow);
    }, OUT));
  }

  /* ---------------------------------------------------- the crag sprite */
  function cragSprite() {
    return cached('crag:' + season(), () => {
      const s = season(), winter = s === 'winter';
      const [c, g] = mk(CW + 2, CRH + 2);
      const im = g.createImageData(CW + 2, CRH + 2), d = im.data;
      const tones = ROCK.map(rgb);
      const W_ = winter ? ICE : WATER;
      const water = [W_.deep, W_.base, W_.light, W_.foam, W_.white].map(rgb);
      const snow = rgb(P.snow), snowS = rgb('#c9d7e4'), snowD = rgb('#a9bccb');
      const turf = TURF[s] || TURF.autumn;
      const grassL = rgb(winter ? P.snow : C.shade(turf[0], 0.08)), grassD = rgb(winter ? '#c9d7e4' : turf[1]);
      const heath = rgb(s === 'autumn' ? '#a8643a' : s === 'spring' ? '#9a7ab8' : s === 'summer' ? '#8c5f94' : '#dbe5ee');
      const lichen = rgb(s === 'winter' ? '#dfe8ee' : '#9fae7a');
      const put = (x, y, col) => { const i = ((y + 1) * (CW + 2) + x + 1) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; };
      for (let y = 0; y < CRH; y++) for (let lx = 0; lx < CW; lx++) {
        const i = y * CW + lx, kind = CK[i];
        if (!kind) continue;
        const x = lx + CR.x0, gy = CGY[i], h = hq(x, gy), k = CDEP[i];
        const b = bay(x, y);
        // Smooth-surface gradient for shading.
        const gx = hs(x + 1, gy) - hs(x - 1, gy), gyv = hs(x, gy + 1) - hs(x, gy - 1);
        let col;
        if (kind === 4) col = water[(x + y) % 3 === 0 ? 3 : 2];
        else if (kind === 5) {
          const rel = x + 0.5 - chanX(gy);
          col = rel < -2 ? water[3] : rel > 2 ? water[0] : rel < 0 ? water[2] : water[1];
          if (k === 1) col = water[4];
        }
        else if (kind === 1 || kind === 2) {
          // Tops: lit by facing (west and north faces brighter), snow up high.
          let t = 2.3 - gx * 0.3 - gyv * 0.1 + (b - 0.5) * 0.45;
          if (kind === 2) t -= 0.9;
          col = tones[clamp(Math.round(t), 0, 6)];
          const flat = Math.abs(gx) + Math.abs(gyv) < 3.2;
          const nh = S.hash(x, gy, 321);
          const snowLine = winter ? 0 : 60 + vnoise(x / 6, 0, 322) * 10;
          if (h > snowLine && (winter ? (flat || kind === 2 || nh < 0.6) : true)) col = t < 2.2 ? snow : nh < 0.3 ? snowD : snowS;
          else if (flat && h < 52 && kind === 2) col = nh < 0.4 ? grassD : nh < 0.82 ? grassL : heath;
          else if (kind === 2 && nh < 0.25) col = lichen;
        } else {
          // Cliff faces: strata, cracks, a lit lip and occluded feet.
          const span = (() => { let n = k; while (y + 1 + (n - k) < CRH && CK[(y + 1 + (n - k)) * CW + lx] === 3 && CGY[(y + 1 + (n - k)) * CW + lx] === gy) n++; return n; })();
          const joint = Math.floor((x + gy * 0.4) / 5);
          let t = 3.5 - clamp(gx, -6, 6) * 0.38 + (S.hash(joint, gy >> 3, 326) - 0.5) * 1.1 + (b - 0.5) * 0.35;
          if (Math.floor((x + 1 + gy * 0.4) / 5) !== joint && k > 1) t += 1.1;      // joint crack
          if (k === 1) t -= 1.3;
          if (span - k <= 1) t += 0.9;
          const str = (y + Math.floor(S.hash(joint, 0, 323) * 4)) % 4 === 0;
          if (str && k > 1 && S.hash(x, y, 327) < 0.7) t += 0.7;
          const lEmpty = lx === 0 || !CK[i - 1], rEmpty = lx === CW - 1 || !CK[i + 1];
          if (lEmpty) t -= 1.5; else if (rEmpty) t += 1.2;
          col = tones[clamp(Math.round(t), 1, 6)];
          if (winter && k === 1) col = snowS;
          else if (!winter && k === 1 && S.hash(x, gy, 325) < 0.3) col = grassD;
        }
        put(lx, y, col);
      }
      g.putImageData(im, 0, 0);
      // The spring: a dark cleft above where the cascade starts.
      const sx = SPRING.x - CR.x0 + 1, sy = SPRING.y + 1;
      R(g, sx - 2, sy - 4, 5, 4, '#1c1a26'); R(g, sx - 1, sy - 5, 3, 1, '#1c1a26'); D(g, sx - 2, sy - 4, ROCK[4]);
      R(g, sx - 1, sy - 2, 3, 2, rgbHex(water[2]));
      addOutline(c, g, '#221f2e');
      // Pines and boulders on the ledges, far ones first.
      const picks = [];
      for (const tp of CTOPS) {
        if (tp.h < 8 || tp.h > 44) continue;
        if (Math.abs(tp.x - chanX(tp.gy)) < 8 || Math.abs(tp.x - SUMMIT.x) < 8) continue;
        const r = S.hash(tp.x, tp.gy, 331);
        if (r < 0.04 && !picks.some((q) => Math.abs(q.x - tp.x) < 9 && Math.abs(q.sy - tp.sy) < 12)) picks.push(tp);
      }
      picks.sort((a, b) => a.gy - b.gy);
      for (const tp of picks) {
        const size = 8 + Math.floor(S.hash(tp.x, tp.gy, 332) * 4);
        const spr = pineSprite(700 + tp.x, size, s);
        g.drawImage(spr, tp.x - CR.x0 + 1 - Math.floor(spr.width / 2), tp.sy + 1 - spr.height + 3);
      }
      return c;
    });
  }
  const rgbHex = (a) => C.rgbToHex(a[0], a[1], a[2]);

  /* ---------------------------------------------- kite launch pad sprite */
  function padSprite() {
    return cached('pad:' + season() + ':' + Math.min(GROWTH, 3), () => build(PAD.w, PAD.h, (g) => {
      const winter = isWinter();
      const dx = DECK0.x - PAD.x, dy = DECK0.y - PAD.y, dw = DECK0.w, dh = DECK0.h;
      // Support struts under the overhang, down to the island's side.
      for (const [x0, x1] of [[dw - 4, dw - 22], [dw - 14, dw - 28]]) {
        S.px.line(g, dx + x0, dy + dh + 4, dx + x1, dy + dh + 22, DECK.dark);
        S.px.line(g, dx + x0 + 1, dy + dh + 4, dx + x1 + 1, dy + dh + 22, DECK.deep);
        S.px.line(g, dx + x0 - 1, dy + dh + 4, dx + x1 - 1, dy + dh + 22, DECK.light);
      }
      R(g, dx + dw - 8, dy + dh + 4, 3, 9, DECK.dark); D(g, dx + dw - 8, dy + dh + 4, DECK.light);
      // Deck: planks running east (the launch direction), lit from the top-left.
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
        const row = Math.floor(y / 4), ly = y % 4;
        const seam = Math.floor(S.hash(row, 1, 341) * 30) + 12;
        let col = ly === 3 ? DECK.dark : S.hash((x + row * 7) >> 3, row, 342) > 0.5 ? DECK.base : DECK.light;
        if (ly === 0) col = DECK.hi;
        if (x === seam || x === seam + 20) col = DECK.deep;
        if (x % 10 === 4 && (ly === 1)) col = DECK.deep;                 // nails over the joists
        if (S.hash(x, y, 343) > 0.96) col = DECK.dark;
        if (winter && ly < 2 && S.hash(x >> 1, row, 344) > 0.3) col = ly === 0 ? P.snow : '#dfe8ee';
        D(g, dx + x, dy + y, col);
      }
      // Launch mark: a painted chevron pointing east.
      if (!winter) for (let k = 0; k < 5; k++) { D(g, dx + dw - 12 + k, dy + 12 + k, '#e9d29a'); D(g, dx + dw - 12 + k, dy + 20 - k, '#e9d29a'); }
      // Front fascia and the east lip.
      R(g, dx, dy + dh, dw, 4, DECK.dark); R(g, dx, dy + dh, dw, 1, DECK.light); R(g, dx, dy + dh + 3, dw, 1, DECK.deep);
      for (let x = 2; x < dw; x += 10) D(g, dx + x, dy + dh + 1, DECK.hi);
      R(g, dx + dw - 2, dy, 2, dh, DECK.dark); R(g, dx + dw - 2, dy, 1, dh, DECK.light);
      // Railing along the north and south sides (open to the east).
      for (const ry of [dy - 1, dy + dh - 2]) {
        for (let x = 1; x < dw - 12; x += 9) { R(g, dx + x, ry - 6, 2, 7, DECK.base); D(g, dx + x, ry - 6, DECK.hi); D(g, dx + x + 1, ry - 1, DECK.deep); }
        R(g, dx + 1, ry - 6, dw - 12, 1, DECK.light); R(g, dx + 1, ry - 5, dw - 12, 1, DECK.dark);
      }
      // Windsock pole at the north-east corner, with a hook for the signal lantern.
      const px_ = SOCK.x - PAD.x;
      R(g, px_ - 1, 6, 2, dy + 2, WOOD.base); R(g, px_ - 1, 6, 1, dy + 2, WOOD.hi); R(g, px_ + 1, 8, 1, dy, WOOD.deep);
      R(g, px_ - 2, 4, 4, 2, BRONZE.light); D(g, px_ - 2, 4, BRONZE.hi);
      R(g, px_ - 6, 14, 5, 1, WOOD.dark); D(g, px_ - 6, 15, OUT);
      R(g, px_ - 8, 16, 5, 6, '#d23a2a'); R(g, px_ - 8, 16, 2, 6, '#f0664a'); R(g, px_ - 4, 16, 1, 6, '#8e2216');
      R(g, px_ - 7, 22, 3, 1, P.goldDark); R(g, px_ - 7, 15, 3, 1, P.goldDark);
      R(g, px_ - 3, dy + 1, 5, 2, STONE.base); R(g, px_ - 3, dy + 1, 5, 1, STONE.hi);
      // The kite rack: an A-frame with folded paper kites and gliders.
      const rx = 4, ry = dy + 2;
      R(g, rx, ry - 22, 2, 22, WOOD.base); R(g, rx, ry - 22, 1, 22, WOOD.hi);
      R(g, rx + 26, ry - 22, 2, 22, WOOD.dark); R(g, rx + 26, ry - 22, 1, 22, WOOD.base);
      R(g, rx, ry - 22, 28, 2, WOOD.light); R(g, rx, ry - 21, 28, 1, WOOD.dark);
      R(g, rx, ry - 6, 28, 2, WOOD.base); R(g, rx, ry - 6, 28, 1, WOOD.hi);
      const nk = GROWTH >= 1 ? 4 : 3;
      for (let k = 0; k < nk; k++) {
        const [a, b, c2] = KITE_COL[k % KITE_COL.length];
        const kx = rx + 3 + k * 6, ky = ry - 19;
        // A folded diamond kite leaning in the rack.
        for (let j = 0; j < 13; j++) {
          const hw = j < 5 ? Math.floor(j * 0.6) : Math.max(0, Math.floor((13 - j) * 0.35));
          for (let i = -hw; i <= hw; i++) D(g, kx + 2 + i, ky + j, i < 0 ? b : i === 0 ? a : c2);
        }
        D(g, kx + 2, ky + 4, PAPER);
        D(g, kx + 2, ky + 13, a); D(g, kx + 3, ky + 14, FLAG[(k + 1) % 5]); D(g, kx + 2, ky + 15, FLAG[(k + 3) % 5]);
      }
      if (GROWTH >= 2) {
        // A folded glider laid across the top bar.
        R(g, rx - 2, ry - 25, 32, 2, PAPER); R(g, rx - 2, ry - 25, 32, 1, '#fffaea'); R(g, rx + 12, ry - 26, 4, 4, '#2b836c');
        D(g, rx - 2, ry - 24, '#d9c9a0'); D(g, rx + 29, ry - 24, '#d9c9a0');
        if (winter) R(g, rx - 1, ry - 26, 10, 1, P.snow);
      }
      if (winter) { R(g, rx, ry - 23, 28, 1, P.snow); }
      // String spool / winch on the deck.
      const sx = dx + 8, sy = dy + 20;
      R(g, sx, sy, 8, 6, WOOD.dark); R(g, sx + 1, sy + 1, 6, 4, '#e9e1c8'); R(g, sx + 1, sy + 1, 6, 1, '#fffaea');
      for (let k = 0; k < 6; k += 2) D(g, sx + 1 + k, sy + 3, '#c8b890');
      R(g, sx - 1, sy - 1, 2, 8, WOOD.base); R(g, sx + 7, sy - 1, 2, 8, WOOD.deep); D(g, sx - 1, sy - 1, WOOD.hi);
      R(g, sx + 9, sy + 2, 3, 1, WOOD.light);
    }, OUT));
  }

  /* ============================================================ GROUND (5) */
  let fallMeasured = false;
  function measureFall(ctx) {
    // Find the lip (first soil pixel) and the underside's bottom under the exit (once).
    if (fallMeasured) return;
    const x0 = FALL[0].x, w = FALL.length, y0 = 200, h = 200;
    let d;
    try { d = ctx.getImageData(x0, y0, w, h).data; } catch (e) { return; }
    const soil = new Set(['#6e5a44', '#56442f', '#3d3022']);
    for (let i = 0; i < w; i++) {
      let lip = -1, bot = -1;
      for (let y = 0; y < h; y++) {
        const k = (y * w + i) * 4;
        if (d[k + 3] === 0) { if (lip >= 0) { bot = y0 + y - 1; break; } continue; }
        if (lip < 0 && soil.has(C.rgbToHex(d[k], d[k + 1], d[k + 2]))) lip = y0 + y;
      }
      if (lip > 0 && bot > lip) { FALL[i].lip = lip; FALL[i].bot = bot; fallMeasured = true; }
    }
  }

  function drawGround(ctx) {
    const s = season(), winter = s === 'winter';
    measureFall(ctx);
    // Courtyard paving in front of the temple, merging with the steps path.
    const X0 = 158, X1 = 256, Y0 = 148, Y1 = 208;
    const rowsB = [];
    for (let r = 0; r < 10; r++) {
      const b = []; let x = X0 - 6 + Math.floor(S.hash(r, 3, 41) * 9);
      while (x < X1 + 8) { b.push(x); x += 8 + Math.floor(S.hash(x, r, 42) * 6); }
      b.push(x); rowsB.push(b);
    }
    const stoneTones = [STONE.dark, STONE.base, STONE.light, STONE.hi];
    const moss = winter ? '#e9eef2' : P.grassDark[s];
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
      const r = Math.floor((y - Y0) / 7), ly = (y - Y0) % 7, b = rowsB[r];
      let k = 0; while (k + 1 < b.length && b[k + 1] <= x) k++;
      const stoneId = r * 40 + k;
      const edge = Math.min(x - X0, X1 - 1 - x, Y1 - 1 - y);
      if (edge < 9 && S.hash(stoneId, 9, 43) < 0.6) continue;     // ragged border
      let col;
      if (ly === 6 || x === b[k]) col = S.hash(x, y, 44) > 0.8 ? moss : '#4b4a52';
      else {
        const tone = Math.floor(S.hash(stoneId, 1, 45) * 2.2);
        const t = tone + (ly === 0 || x === b[k] + 1 ? 1 : 0) - (ly === 5 ? 1 : 0);
        col = stoneTones[clamp(t, 0, 3)];
        if (S.hash(x, y, 46) > 0.93) col = STONE.dark;
        if (winter && S.hash(stoneId, 2, 47) > 0.4 && ly < 4) col = P.snow;
      }
      D(ctx, x, y, col);
    }
    // Stepping stones: courtyard to the bell pavilion, and across the stream.
    for (const [x, y] of [[164, 210], [156, 214], [150, 210]]) stepStone(ctx, x, y, winter);
    // Spring pool at the foot of the crag.
    drawPool(ctx, winter);
    drawStream(ctx, winter);
    // Fallen leaves (autumn) / petals (spring) on the turf near the buildings.
    if (s === 'autumn' || s === 'spring') {
      const cols = s === 'autumn' ? ['#b9392a', P.leaf.autumn, P.leafAlt.autumn, '#de5a31'] : [P.leafAlt.spring, '#f8c9da'];
      for (let k = 0; k < 160; k++) {
        const x = 70 + Math.floor(S.hash(k, 1, 50) * 320), y = 120 + Math.floor(S.hash(k, 2, 50) * 140);
        const tx = Math.floor(x / T), ty = Math.floor(y / T);
        if (S.onRoad(tx, ty) || !S.islandAt(tx, ty) || (x < 124 && y < 140)) continue;
        if (x > 86 && x < 124) continue;
        D(ctx, x, y, cols[k % cols.length]);
        if (k % 3 === 0) D(ctx, x + 1, y, cols[(k + 1) % cols.length]);
      }
    }
  }
  function stepStone(ctx, x, y, winter) {
    groundShadow(ctx, x + 1, y + 1, 3, 1, 0.25);
    R(ctx, x - 3, y - 1, 6, 3, STONE.base); R(ctx, x - 3, y - 1, 6, 1, STONE.hi); R(ctx, x - 2, y + 2, 4, 1, STONE.dark);
    if (winter) R(ctx, x - 2, y - 1, 3, 1, P.snow);
  }

  function drawPool(ctx, winter) {
    const { x: cx, y: cy, rx, ry } = POOL;
    const W_ = winter ? ICE : WATER;
    for (let y = -ry - 1; y <= ry + 1; y++) for (let x = -rx - 2; x <= rx + 2; x++) {
      const e = (x * x) / ((rx + 1.5) * (rx + 1.5)) + (y * y) / ((ry + 1) * (ry + 1)) + (S.hash(x, y, 351) - 0.5) * 0.12;
      if (e > 1) continue;
      const inner = (x * x) / (rx * rx) + (y * y) / (ry * ry);
      let col;
      if (inner > 0.78) {
        // Rocky rim lit from the top-left.
        col = S.hash(x, y, 352) > 0.5 ? STONE.base : STONE.dark;
        if (y < 0 && x < 2) col = S.hash(x, y, 353) > 0.4 ? STONE.light : STONE.hi;
        if (y > 0 && x > 0) col = S.hash(x, y, 354) > 0.5 ? STONE.dark : STONE.deep;
        if (winter && y <= 0 && S.hash(x, y, 355) > 0.4) col = P.snow;
      } else {
        col = y < -ry * 0.3 ? W_.deep : inner > 0.5 && y > 0 ? W_.light : W_.base;
        if (winter && S.hash(x >> 1, y, 356) > 0.85) col = W_.white;
      }
      D(ctx, cx + x, cy + y, col);
    }
    for (let x = -rx; x <= rx; x++) if (S.hash(x, 5, 357) > 0.35) D(ctx, cx + x, cy + ry + 1 + (Math.abs(x) > rx - 3 ? -1 : 0), OUT);
    // Reeds and a couple of mossy stones on the rim.
    const reeds = winter ? '#b7a780' : '#5f8a3e', tip = winter ? '#e6dcc0' : '#8a5a2a';
    for (const [x, h] of [[cx + rx - 1, 6], [cx + rx + 1, 4], [cx - rx - 1, 5]]) { R(ctx, x, cy - h + 2, 1, h, reeds); D(ctx, x, cy - h + 1, tip); }
  }

  function drawStream(ctx, winter) {
    const W_ = winter ? ICE : WATER;
    // Banks: pebbles, lit on the west (light) side.
    for (const [x, y, side] of SBANK) {
      const h = S.hash(x, y, 361);
      if (h < 0.35) continue;
      const col = side < 0 ? (h > 0.75 ? STONE.hi : STONE.light) : (h > 0.75 ? STONE.dark : STONE.deep);
      D(ctx, x, y, winter && side < 0 && h > 0.6 ? P.snow : col);
    }
    for (const [x, y, s, d] of SPIX) {
      let col = d > 0.7 ? W_.light : d > 0.35 ? W_.base : W_.deep;
      if (d > 0.62 && S.hash(x, y, 362) > 0.7) col = W_.foam;
      if (winter) col = d > 0.55 ? (S.hash(x, y, 363) > 0.5 ? ICE.light : ICE.white) : d > 0.25 ? ICE.base : WATER.base; // frozen edges, open middle
      D(ctx, x, y, col);
    }
    // Run the water right over the lip.
    for (const f of FALL) {
      const k = f.x - (EXIT_X - 3);
      const top = 258;
      for (let y = top; y < f.lip; y++) {
        let col = k === 0 || k === 6 ? W_.light : k === 3 ? W_.deep : W_.base;
        if (y >= f.lip - 2) col = k % 2 ? W_.foam : W_.light;
        D(ctx, f.x, y, col);
      }
    }
    // Stones mid-stream with foam behind them.
    for (const [x, y] of [[100, 158], [104, 205], [100, 228]]) {
      R(ctx, x - 1, y, 3, 2, STONE.base); D(ctx, x - 1, y, STONE.hi); D(ctx, x + 1, y + 1, STONE.deep);
      if (!winter) { D(ctx, x - 1, y + 2, W_.foam); D(ctx, x + 1, y + 2, W_.foam); }
    }
  }

  /* ============================================================ GARDEN */
  const GROCKS = [[278, 182, 13, 9, 1], [318, 190, 10, 7, 2], [327, 193, 6, 4, 3], [338, 174, 8, 6, 4]];
  function drawGarden(ctx) {
    const s = season(), winter = s === 'winter';
    const { x: gx, y: gy, w: gw, h: gh } = GARDEN;
    groundShadow(ctx, gx + gw / 2 + 2, gy + gh / 2 + 2, gw / 2, gh / 2 - 2, 0.12);
    const sx0 = gx + 3, sy0 = gy + 6, sw = gw - 6, sh = gh - 10;
    R(ctx, sx0 - 2, sy0 - 2, sw + 4, sh + 4, STONE.dark);
    for (let x = sx0 - 2; x < sx0 + sw + 2; x += 5) { R(ctx, x, sy0 - 2, 4, 2, STONE.light); R(ctx, x, sy0 + sh, 4, 2, STONE.base); D(ctx, x, sy0 - 2, STONE.hi); }
    for (let y = sy0; y < sy0 + sh; y += 5) { R(ctx, sx0 - 2, y, 2, 4, STONE.light); R(ctx, sx0 + sw, y, 2, 4, STONE.base); }
    R(ctx, sx0 - 3, sy0 + sh + 2, sw + 6, 1, OUT);
    // Raked sand: parallel furrows, concentric ripples around the rocks.
    const pal = (winter ? ['#c6d4e0', '#e4ecf2', P.snow] : [SAND.dark, SAND.base, SAND.light]).map(rgb);
    const [c, g] = mk(sw, sh);
    const im = g.createImageData(sw, sh), d = im.data;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const wx = sx0 + x, wy = sy0 + y;
      let best = 1e9;
      for (const [rx, ry, rw, rh] of GROCKS) {
        const dx = (wx - rx) / (rw / 2 + 0.5), dy = (wy - (ry - rh * 0.35)) / (rh / 2 + 0.5);
        best = Math.min(best, Math.sqrt(dx * dx + dy * dy * 1.6) * (rw / 2));
      }
      const k = best < 14 ? Math.floor(best) % 3 : y % 3;
      const col = pal[k === 0 ? 0 : k === 1 ? 2 : 1];
      const i = (y * sw + x) * 4, j = S.hash(wx, wy, 111) > 0.96 ? 12 : 0;
      d[i] = col[0] - j; d[i + 1] = col[1] - j; d[i + 2] = col[2] - j; d[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    ctx.drawImage(c, sx0, sy0);
    if (s === 'autumn') for (let k = 0; k < 12; k++) D(ctx, sx0 + 50 + Math.floor(S.hash(k, 3, 112) * 44), sy0 + Math.floor(S.hash(k, 4, 112) * sh), k % 2 ? '#c8402b' : P.leaf.autumn);
    // Bamboo fence along the back.
    for (let x = gx; x < gx + gw; x += 3) {
      const h = 8 + (S.hash(x, 1, 113) > 0.6 ? 1 : 0);
      R(ctx, x, gy - h + 4, 2, h, '#9fb05a'); D(ctx, x, gy - h + 4, winter ? P.snow : '#d6e08a'); R(ctx, x + 1, gy - h + 5, 1, h - 1, '#6f7f34');
      D(ctx, x, gy - 1, '#6f7f34');
    }
    R(ctx, gx, gy - 2, gw, 1, '#5a4024'); R(ctx, gx, gy + 1, gw, 1, '#5a4024');
    for (const [rx, ry, rw, rh, seed] of GROCKS) place(ctx, rockSprite(1200 + seed, rw, rh), rx - rw / 2, ry - rh, [2, 1, 0.3]);
    if (GROWTH >= 2) {
      R(ctx, gx + gw - 18, gy + 30, 10, 3, STONE.light); R(ctx, gx + gw - 18, gy + 33, 10, 2, STONE.dark); R(ctx, gx + gw - 16, gy + 35, 6, 4, STONE.base);
      place(ctx, bonsaiSprite(), gx + gw - 21, gy + 16, [2, 1, 0.25]);
    }
    drawDesk(ctx, DESK.x, DESK.y);
    // Bamboo grove on the east edge.
    const nb = GROWTH >= 1 ? 7 : 5;
    for (let k = 0; k < nb; k++) {
      const x = gx + gw + 1 + (k % 4) * 2, h = 24 + Math.floor(S.hash(k, 5, 114) * 12), y = gy + 34 + (k % 2) * 3;
      R(ctx, x, y - h, 1, h, k % 2 ? '#6f8a3a' : '#9ab55a');
      for (let j = y - h; j < y; j += 5) D(ctx, x, j, '#4e6224');
      if (!winter) { D(ctx, x - 1, y - h + 2, '#7fae4a'); D(ctx, x + 1, y - h + 4, '#5f8a34'); D(ctx, x - 2, y - h + 3, '#7fae4a'); D(ctx, x + 2, y - h + 8, '#7fae4a'); }
      else { D(ctx, x, y - h, P.snow); D(ctx, x + 1, y - h + 5, P.snow); }
    }
  }

  function drawDesk(ctx, x, y) {
    const today = studyToday(), sets = prepSets();
    R(ctx, x + 3, y + 9, 8, 3, '#2f6f8a'); R(ctx, x + 3, y + 9, 8, 1, '#5aa0bd'); R(ctx, x + 3, y + 12, 8, 1, '#1d4a5c');
    groundShadow(ctx, x + 9, y + 8, 9, 2, 0.25);
    R(ctx, x, y, 18, 3, WOOD.base); R(ctx, x, y, 18, 1, WOOD.hi); R(ctx, x, y + 3, 18, 1, WOOD.deep);
    R(ctx, x + 1, y + 4, 2, 3, WOOD.dark); R(ctx, x + 15, y + 4, 2, 3, WOOD.dark);
    if (today > 0) {
      // Open book, brush, lit candle.
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

  function footings(ctx) {
    // Growth 1: the library wing is staked out: stone footings and a timber stack.
    const x0 = LIBRARY.x + 6, x1 = LIBRARY.x + LIBRARY.w - 8, y0 = LIBRARY.y + 40, y1 = LIBRARY.y + 62;
    for (let k = 0; k < 5; k++) for (const yy of [y0, y1]) {
      const x = x0 + Math.round(k * (x1 - x0 - 6) / 4);
      R(ctx, x, yy, 6, 4, STONE.base); R(ctx, x, yy, 6, 1, STONE.hi); R(ctx, x, yy + 3, 6, 1, STONE.deep);
    }
    S.px.line(ctx, x0 + 2, y0 + 4, x1 - 2, y0 + 4, '#d8c79a'); S.px.line(ctx, x0 + 2, y0 + 4, x0 + 2, y1, '#d8c79a'); S.px.line(ctx, x1 - 2, y0 + 4, x1 - 2, y1, '#d8c79a');
    groundShadow(ctx, x0 + 26, y0 + 16, 12, 2, 0.25);
    for (let k = 0; k < 3; k++) { R(ctx, x0 + 14 + k, y0 + 8 + k * 3, 24 - k * 2, 3, WOOD.base); R(ctx, x0 + 14 + k, y0 + 8 + k * 3, 24 - k * 2, 1, WOOD.hi); D(ctx, x0 + 14 + k, y0 + 9 + k * 3, WOOD.deep); }
  }

  /* ======================================================== STATIC (20) */
  let SHRINE = null;
  if (GROWTH >= 3) {
    let best = null;
    for (const tp of CTOPS) if (tp.x >= 128 && tp.x <= 150 && tp.h > 20 && (!best || tp.sy < best.sy)) best = tp;
    if (best) SHRINE = { x: Math.max(128, Math.min(146, best.x)), y: cragTopAt(Math.max(128, Math.min(146, best.x))) + 4 };
  }

  function drawBuildings(ctx) {
    const s = season();
    const items = [];
    items.push({ y: CR.y1 - 6, f: () => place(ctx, cragSprite(), CR.x0, 0, [4, 2, 0.24]) });
    items.push({ y: CR.y1 - 5.5, f: () => place(ctx, beaconSprite(), SUMMIT.x - 6, SUMMIT.y - 16, [2, 1, 0.2]) });
    if (SHRINE) items.push({ y: CR.y1 - 5, f: () => place(ctx, shrineSprite(), SHRINE.x - 10, SHRINE.y - 21, [2, 1, 0.25]) });
    items.push({ y: TEMPLE.y + 100, f: () => place(ctx, templeSprite(), TEMPLE.x, TEMPLE.y, [6, 3, 0.28]) });
    if (GROWTH >= 2) items.push({ y: LIBRARY.y + LIBRARY.h - 1, f: () => place(ctx, librarySprite(), LIBRARY.x, LIBRARY.y, [5, 3, 0.26]) });
    else if (GROWTH === 1) items.push({ y: LIBRARY.y + 30, f: () => footings(ctx) });
    items.push({ y: TEMPLE.y + 101, f: () => place(ctx, censerSprite(), CENSER.x - 8, CENSER.y - 12, [2, 1, 0.3]) });
    items.push({ y: PAVILION.y + PAVILION.h, f: () => place(ctx, pavilionSprite(), PAVILION.x, PAVILION.y, [4, 2, 0.26]) });
    items.push({ y: BOARD.y + BOARD.h, f: () => place(ctx, boardSprite(), BOARD.x, BOARD.y, [3, 1, 0.28]) });
    items.push({ y: GARDEN.y, f: () => drawGarden(ctx) });
    items.push({ y: DECK0.y + DECK0.h, f: () => place(ctx, padSprite(), PAD.x, PAD.y, [3, 2, 0.22]) });
    for (const [x, y] of LANTERNS) items.push({ y, f: () => { groundShadow(ctx, x + 2, y, 5, 1, 0.25); place(ctx, lanternSprite(), x - 5, y - 21, [2, 1, 0.22]); } });
    for (const [x, y, kind, size, seed] of TREES) {
      items.push({ y, f: () => {
        const spr = kind === 'pine' ? pineSprite(seed, size, s) : mapleSprite(seed, size, s);
        groundShadow(ctx, x + 2, y - 1, Math.round(spr.width * 0.36), 2, 0.22);
        place(ctx, spr, x - Math.floor(spr.width / 2) + 1, y - spr.height + 2, [3, 1, 0.18]);
      } });
    }
    items.push({ y: 138, f: () => place(ctx, rockSprite(1301, 12, 8), 122, 130, [2, 1, 0.3]) });
    items.push({ y: 222, f: () => place(ctx, rockSprite(1302, 9, 6), 112, 216, [2, 1, 0.3]) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.f();
  }

  /* ======================================================= LIGHTS (once) */
  const L = (o) => S.addLight(Object.assign({ island: ID }, o));
  for (const [x, y] of LANTERNS) L({ x, y: y - 14, r: 30, color: P.lanternGlow, intensity: 0.85, flicker: true });
  L({ x: TCX, y: TEMPLE.y + 68, r: 46, color: P.lantern, intensity: 0.8, flicker: true });
  L({ x: TCX - 40, y: TEMPLE.y + 64, r: 30, color: P.lanternGlow, intensity: 0.45 });
  L({ x: TCX + 40, y: TEMPLE.y + 64, r: 30, color: P.lanternGlow, intensity: 0.45 });
  L({ x: TCX - 52, y: TEMPLE.y + 60, r: 18, color: '#ff7a50', intensity: 0.7, flicker: true });
  L({ x: TCX + 51, y: TEMPLE.y + 60, r: 18, color: '#ff7a50', intensity: 0.7, flicker: true });
  L({ x: CENSER.x, y: CENSER.y - 12, r: 12, color: '#ff9a50', intensity: 0.6, flicker: true });
  L({ x: BOARD.x + 19, y: BOARD.y + 18, r: 26, color: '#ffe9a8', intensity: 0.65, on: () => scrollCount() > 0 });
  L({ x: SOCK.x - 6, y: SOCK.y + 13, r: 22, color: '#ff8a5a', intensity: 0.7, flicker: true });
  L({ x: POOL.x, y: POOL.y, r: 16, color: '#7fd6ff', intensity: 0.25 });
  L({ x: SUMMIT.x, y: SUMMIT.y - 8, r: 34, color: P.lanternGlow, intensity: 0.95, flicker: true });
  if (studyToday() > 0) L({ x: DESK.x + 14, y: DESK.y - 6, r: 14, color: P.lanternGlow, intensity: 0.7, flicker: true });
  if (GROWTH >= 2) L({ x: LIBRARY.x + 31, y: LIBRARY.y + 37, r: 30, color: P.lanternGlow, intensity: 0.6 });
  if (SHRINE) L({ x: SHRINE.x, y: SHRINE.y - 8, r: 18, color: P.lanternGlow, intensity: 0.6, flicker: true });

  /* ======================================================== HOTSPOTS */
  const LM = S.landmarks;
  const base = (k, d) => (LM[k] && LM[k].label) || d;
  const hot = (key, label, x, y, w, h) => S.addHotspot({ id: 'landmark:' + key, kind: 'landmark', landmark: key, biome: ID, island: ID, agent: AGENT, label, x, y, w, h, priority: 1 });
  const templeHot = hot('temple', base('temple', 'Temple'), TEMPLE.x + 6, TEMPLE.y - 2, 156, 110);
  const boardHot = hot('temple', 'Scroll board', BOARD.x - 2, BOARD.y - 2, BOARD.w + 4, BOARD.h + 4);
  const gardenHot = hot('studyGarden', base('studyGarden', 'Study Garden'), GARDEN.x - 4, GARDEN.y - 10, GARDEN.w + 14, GARDEN.h + 14);
  hot('kitePad', base('kitePad', 'Kite launch') + ' · paper kites to Clockspire', PAD.x - 2, PAD.y, PAD.w + 2, DECK0.y + DECK0.h + 6 - PAD.y);

  /* Places other modules may use (villagers): feet positions in native px. */
  S.monastery = {
    templeDoor: { x: TCX, y: TEMPLE.y + 108 },
    board: { x: BOARD.x + 19, y: BOARD.y + BOARD.h + 4 },
    desk: { x: DESK.x + 7, y: DESK.y + 12 },
    bell: { x: BELL.x, y: PAVILION.y + PAVILION.h },
    kitePad: { x: DECK0.x + 30, y: DECK0.y + 18 },
    windsock: { x: SOCK.x, y: SOCK.y },
    waterfall: { x: EXIT_X, y: 266 },
  };

  /* ======================================================= DYNAMIC */
  let scrollCache = { at: -1e9, list: [] };
  function scrollList(t) {
    const now = t == null ? scrollCache.at : t;
    if (now - scrollCache.at > 5 || now < scrollCache.at) {
      scrollCache = { at: now, list: upcomingDeadlines() };
      const n = scrollCache.list.length;
      const tb = base('temple', 'Temple');
      templeHot.label = n ? `${tb} · ${n} upcoming deadline${n === 1 ? '' : 's'}` : `${tb} · scroll board clear`;
      boardHot.label = n ? `Scroll board · ${n} upcoming deadline${n === 1 ? '' : 's'}` : 'Scroll board · no upcoming deadlines';
      const st = studyToday(), ps = prepSets();
      const bits = [];
      if (st) bits.push(`${st} study block${st === 1 ? '' : 's'} today`);
      if (ps) bits.push(`${ps} Quizlet set${ps === 1 ? '' : 's'}`);
      gardenHot.label = base('studyGarden', 'Study Garden') + (bits.length ? ' · ' + bits.join(', ') : '');
    }
    return scrollCache.list;
  }
  const scrollCount = () => scrollList().length;
  scrollList(0);

  // 100: the cascade on the crag, stream ripples, and the fall off the lip.
  const FALL_FADE = 78;
  S.registerDynamic(100, (ctx, t) => {
    const winter = isWinter();
    const W_ = winter ? ICE : WATER;
    // Cascade: bright streaks sliding down the falling water.
    const spd = winter ? 3 : rm ? 10 : 42;
    const off = Math.floor(t * spd);
    ctx.fillStyle = winter ? ICE.white : W_.foam;
    for (const [x, y] of CFALL) {
      const k = (y - off + x * 3 + 1000) % 7;
      if (k === 0) ctx.fillRect(x, y, 1, 1);
    }
    if (!winter) {
      ctx.fillStyle = W_.light;
      for (const [x, y] of CFALL) if ((y - off + x * 3 + 1003) % 7 === 0 && (x & 1)) ctx.fillRect(x, y, 1, 1);
    }
    // Stream ripples flowing downstream.
    const so = Math.floor(t * (winter ? 2 : rm ? 6 : 16));
    ctx.fillStyle = W_.foam;
    for (const [x, y, s, d] of SPIX) {
      if (winter && d > 0.3) continue;
      if (((Math.floor(s) - so) % 9 + 9) % 9 === 0 && d < 0.75 && S.hash(x, y, 371) > 0.35) ctx.fillRect(x, y, 1, 1);
    }
    // Splash where the cascade meets the pool.
    const fr = Math.floor(t * (rm ? 3 : 9));
    if (!winter) {
      ctx.fillStyle = W_.foam;
      for (let k = 0; k < 6; k++) ctx.fillRect(POOL.x + 2 + Math.floor(S.hash(k, fr, 372) * 9) - 4, POOL.y - 5 + Math.floor(S.hash(k, fr, 373) * 4), 1, 1);
      const ph = (t * 0.7) % 1, rr = Math.round(3 + ph * 7);
      ctx.globalAlpha = 0.6 * (1 - ph);
      ctx.fillStyle = W_.light;
      ctx.fillRect(POOL.x + 3 - rr, POOL.y, 1, 1); ctx.fillRect(POOL.x + 3 + rr, POOL.y, 1, 1); ctx.fillRect(POOL.x + 3, POOL.y + Math.round(rr * 0.4), 1, 1);
      ctx.globalAlpha = 1;
    }
    drawEdgeFall(ctx, t, winter);
  }, { island: ID });

  function drawEdgeFall(ctx, t, winter) {
    const W_ = winter ? ICE : WATER;
    const spd = winter ? 4 : rm ? 14 : 54;
    const off = Math.floor(t * spd);
    const n = FALL.length, mid = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      const f = FALL[i], x = f.x;
      const edgeCol = i === 0 || i === n - 1;
      const per = 5 + (i % 3), ph = Math.floor(S.hash(i, 0, 391) * per);
      // The sheet of water over the soil band and the underside.
      ctx.fillStyle = edgeCol ? W_.light : i === Math.round(mid) ? W_.deep : W_.base;
      ctx.fillRect(x, f.lip, 1, f.bot - f.lip + 1);
      ctx.fillStyle = edgeCol ? W_.white : W_.foam;
      for (let y = f.lip + ((off + ph) % per); y <= f.bot; y += per) ctx.fillRect(x, y, 1, edgeCol ? 1 : 2);
      // Below the underside it breaks into droplets, spreads a little and fades out.
      const y0 = f.bot + 1;
      for (let k = 0; k < FALL_FADE; k++) {
        const y = y0 + k, q = k / FALL_FADE;
        const keep = 1 - Math.pow(q, 0.75) * 1.05;
        if (keep <= 0) break;
        if (S.hash(i, y - off, 392) > keep * (q < 0.12 ? 1.4 : 1)) continue;
        const spread = Math.round((i - mid) * q * 0.9 + (S.hash(i, (y - off) >> 2, 393) - 0.5) * q * 2);
        const streak = (y - off + ph) % per === 0;
        ctx.fillStyle = streak || q > 0.6 ? W_.foam : edgeCol ? W_.light : W_.base;
        ctx.fillRect(x + spread, y, 1, 1);
      }
    }
    // Foam lip and a little spray where the water tips over.
    if (!winter) {
      const fr = Math.floor(t * (rm ? 2 : 8));
      ctx.fillStyle = WATER.white;
      for (let k = 0; k < 4; k++) {
        const f = FALL[Math.floor(S.hash(k, fr, 381) * n)];
        ctx.fillRect(f.x + (S.hash(k, fr, 382) < 0.5 ? -1 : 1), f.lip - 1 + Math.floor(S.hash(k, fr, 383) * 3), 1, 1);
      }
    }
  }

  // 200: the bronze bell (swings while the cycle bell rings), scrolls, lantern flames.
  S.registerDynamic(200, (ctx, t) => {
    const cer = S.cycle && S.cycle.ceremony;
    let sw = 0;
    if (cer && cer.progress < S.CEREMONY_BEATS.bell[1]) sw = Math.round(Math.sin(t * (rm ? 3 : 7)) * (rm ? 1 : 2));
    R(ctx, BELL.x, BELL.y - 3, 1, 3, '#2a2228');
    ctx.drawImage(bellSprite(), BELL.x - 6 + sw, BELL.y - 1);
    // Scrolls on the board, ribbon colour by urgency.
    const list = scrollList(t);
    const n = Math.min(BOARD_SLOTS.length, list.length);
    for (let k = 0; k < n; k++) {
      const days = daysUntil(list[k].due);
      const ribbon = days <= 1 ? '#d6402f' : days <= 3 ? '#e9a23b' : '#2b836c';
      const [sx, sy] = BOARD_SLOTS[k];
      ctx.drawImage(scrollSprite(ribbon), BOARD.x + sx - 4, BOARD.y + sy);
      if (!rm && Math.sin(t * 1.3 + k * 1.7) > 0.6) D(ctx, BOARD.x + sx + 2, BOARD.y + sy + 8, ribbon);
    }
    if (list.length > BOARD_SLOTS.length) {
      // Extra scrolls rolled up in a basket at the foot of the board.
      const bx = BOARD.x + 26, by = BOARD.y + 37, extra = Math.min(5, list.length - BOARD_SLOTS.length);
      for (let k = 0; k < extra; k++) { R(ctx, bx + k * 2, by - 6 - (k % 2), 2, 5, PAPER); D(ctx, bx + k * 2, by - 6 - (k % 2), '#d6402f'); }
      R(ctx, bx - 1, by - 3, 12, 4, '#a07a3a'); R(ctx, bx - 1, by - 3, 12, 1, '#c9a45a'); R(ctx, bx - 1, by + 1, 12, 1, WOOD.deep);
    }
    // Lantern flames.
    for (let i = 0; i < LANTERNS.length; i++) {
      const [x, y] = LANTERNS[i];
      const f = rm ? 0 : S.hash(i, Math.floor(t * 9), 130);
      R(ctx, x - 1, y - 14, 2, 2, f > 0.5 ? '#ffd27a' : '#ffb84d');
      D(ctx, x - 1 + (f > 0.75 ? 1 : 0), y - 15, '#fff3c0');
      if (f < 0.3) D(ctx, x, y - 13, '#ff8a3a');
    }
  }, { island: ID });

  // 400: incense smoke, prayer flags, windsock, spray mist, alert pennant.
  const shoulder = (x) => Math.min(cragTopAt(x), 9998) + 2;
  const FLAGLINES = [
    { a: [TCX - 47, TEMPLE.y + 22], b: [150, shoulder(150)], sag: 6, g: 0 },
    { a: [SOCK.x - 1, SOCK.y + 2], b: [PAD.x + 6, PAD.y + 20], sag: 5, g: 0 },
    { a: [TCX + 46, TEMPLE.y + 22], b: GROWTH >= 2 ? [LIBRARY.x + 16, LIBRARY.y + 4] : [LIBRARY.x + 20, LIBRARY.y + 40], sag: 6, g: 1 },
    { a: [PAVILION.x + 26, PAVILION.y + 1], b: [BOARD.x + 19, BOARD.y + 1], sag: 4, g: 2 },
    { a: SHRINE ? [SHRINE.x, SHRINE.y - 20] : [0, 0], b: [Math.round(PEAKS[0].x), cragTopAt(PEAKS[0].x) + 3], sag: 5, g: 3 },
  ].filter((l) => l.g <= GROWTH && (l.g < 3 || SHRINE));
  // A short flag post stands where a line ends on bare ground (growth 1 library site).
  const POSTS = GROWTH === 1 ? [[LIBRARY.x + 20, LIBRARY.y + 40]] : [];

  // Paper-window rects in world px (temple lattice bays, library windows).
  const WINDOWS = [];
  {
    const pillarsAt = [-60, -38, -16, 12, 34, 56].map((o) => 84 + o - 1);
    for (let k = 0; k + 1 < pillarsAt.length; k++) {
      if (k === 2) continue;
      const a = pillarsAt[k] + 5, b = pillarsAt[k + 1];
      WINDOWS.push([TEMPLE.x + a + 2, TEMPLE.y + 57, b - a - 4, 12]);
    }
    for (let k = 0; k < 6; k++) WINDOWS.push([TEMPLE.x + 84 - 30 + k * 10 + 1, TEMPLE.y + 25, 6, 5]);
    if (GROWTH >= 2) { const cx = LIBRARY.x + (LIBRARY.w >> 1); WINDOWS.push([cx - 7, LIBRARY.y + 31, 14, 14], [LIBRARY.x + 12, LIBRARY.y + 36, 6, 12], [LIBRARY.x + LIBRARY.w - 12, LIBRARY.y + 36, 6, 12]); }
  }

  let mistSpr = null;
  function mistSprite() {
    if (mistSpr) return mistSpr;
    const [c, g] = mk(30, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 30; x++) {
      const nx = (x - 15) / 15, ny = (y - 4) / 4, e = nx * nx + ny * ny;
      if (e > 1) continue;
      if (S.hash(x, y, 140) < (1 - e) * 0.9 && ((x + y) & 1 || e < 0.4)) { g.fillStyle = '#eef4fa'; g.fillRect(x, y, 1, 1); }
    }
    return (mistSpr = c);
  }

  function drawWindsock(ctx, t) {
    const x = SOCK.x, y = SOCK.y + 1;
    const wind = rm ? 0.7 : 0.62 + 0.28 * Math.sin(t * 0.23) + 0.1 * Math.sin(t * 1.7);
    const segs = 4;
    let px_ = x + 1, py = y;
    for (let k = 0; k < segs; k++) {
      const len = 3;
      const droop = (1 - wind) * (k + 1) * 1.3;
      const flap = rm ? 0 : Math.sin(t * 7 + k * 0.9) * 0.6 * wind;
      const hh = Math.max(1, 3 - Math.floor(k / 2));
      const nx = px_ + len * (0.4 + wind * 0.6), ny = py + droop * 0.6 + flap;
      const col = k % 2 ? '#f4efe4' : '#e0442e', dk = k % 2 ? '#c9c2b4' : '#9e2a1c';
      for (let j = 0; j < len; j++) {
        const xx = Math.round(px_ + (nx - px_) * (j / len)), yy = Math.round(py + (ny - py) * (j / len));
        ctx.fillStyle = col; ctx.fillRect(xx, yy - Math.floor(hh / 2), 1, hh);
        ctx.fillStyle = dk; ctx.fillRect(xx, yy - Math.floor(hh / 2) + hh, 1, 1);
      }
      px_ = nx; py = ny;
    }
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
    for (const [x, y] of POSTS) { R(ctx, x, y - 22, 2, 22, WOOD.base); R(ctx, x, y - 22, 1, 22, WOOD.hi); D(ctx, x, y - 23, P.gold); }
    // Prayer flags: a sagging string with five-colour flags fluttering.
    for (let li = 0; li < FLAGLINES.length; li++) {
      const Ln = FLAGLINES[li];
      const [ax, ay] = Ln.a, [bx, by] = POSTS.length && Ln.g === 1 && GROWTH === 1 ? [Ln.b[0], Ln.b[1] - 22] : Ln.b;
      const len = Math.max(Math.hypot(bx - ax, by - ay), 1);
      const sag = Ln.sag + (rm ? 0 : Math.sin(t * 0.9 + li) * 0.8);
      const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1));
      ctx.fillStyle = '#4a3a30';
      let prev = null;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps, x = Math.round(ax + (bx - ax) * u), y = Math.round(ay + (by - ay) * u + sag * 4 * u * (1 - u));
        if (prev !== null && Math.abs(prev - y) > 1) ctx.fillRect(x, Math.min(prev, y), 1, Math.abs(prev - y));
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
    drawWindsock(ctx, t);
    // Spray mist at the foot of the cascade and where the stream tips off.
    if (!isWinter()) {
      const m = mistSprite();
      for (let k = 0; k < 3; k++) {
        const ph = rm ? 0.5 : (t * 0.05 + k / 3) % 1;
        ctx.globalAlpha = (0.22 + 0.06 * Math.sin(t * 0.4 + k)) * Math.sin(ph * Math.PI);
        ctx.drawImage(m, POOL.x - 15 + Math.round((ph - 0.5) * 18), POOL.y - 12 - k * 2);
      }
      ctx.globalAlpha = 1;
    }
    // A red pennant on the temple finial when Abbot Quill's status is critical.
    if ((S.status[ID] || {}).level === 'critical') {
      const x = TCX, y = TEMPLE.y - 16;
      R(ctx, x - 1, y, 1, 16, OUT); R(ctx, x, y, 1, 16, WOOD.light); D(ctx, x, y - 1, P.gold);
      const f = rm ? 0 : Math.round(Math.sin(t * 6) * 1.2);
      R(ctx, x + 1, y + 1, 7, 2, '#e0322a'); R(ctx, x + 1, y + 3, 5 + f, 2, '#c42620'); R(ctx, x + 1, y + 5, 3, 1, '#9a1c16');
      D(ctx, x + 8 + f, y + 2, '#e0322a'); D(ctx, x + 2, y + 1, '#ff6a5a');
    }
  }, { island: ID });

  // 700: glow over the darkness for scrolls, flames and paper windows.
  S.registerDynamic(700, (ctx, t) => {
    const dark = 1 - ((S.time && S.time.light) == null ? 1 : S.time.light);
    const list = scrollList(t);
    const n = Math.min(BOARD_SLOTS.length, list.length);
    const pulse = rm ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.6);
    ctx.globalCompositeOperation = 'lighter';
    if (n) {
      for (let k = 0; k < n; k++) {
        const [sx, sy] = BOARD_SLOTS[k];
        const x = BOARD.x + sx - 3, y = BOARD.y + sy;
        ctx.fillStyle = `rgba(255,214,130,${(0.1 + 0.12 * pulse + 0.25 * dark).toFixed(3)})`;
        ctx.fillRect(x - 1, y, 8, 10);
        ctx.fillStyle = `rgba(255,236,170,${(0.12 + 0.3 * dark).toFixed(3)})`;
        ctx.fillRect(x, y + 1, 6, 7);
      }
    }
    if (dark > 0.2) {
      ctx.fillStyle = `rgba(255,190,90,${(0.35 * dark).toFixed(3)})`;
      for (const [x, y] of LANTERNS) ctx.fillRect(x - 2, y - 15, 4, 4);
      ctx.fillRect(SOCK.x - 8, SOCK.y + 10, 5, 6);
      if (SHRINE) ctx.fillRect(SHRINE.x - 2, SHRINE.y - 9, 4, 4);
      ctx.fillRect(SUMMIT.x - 3, SUMMIT.y - 10, 6, 3);
      // A soft dithered halo around the summit beacon so the peak reads from afar.
      ctx.fillStyle = `rgba(255,200,110,${(0.16 * dark).toFixed(3)})`;
      for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) {
        const r2 = x * x + y * y;
        if (r2 > 144 || r2 < 9 || ((x + y) & 1)) continue;
        if (bay(x + 12, y + 12) < 1 - r2 / 144) ctx.fillRect(SUMMIT.x + x, SUMMIT.y - 9 + y, 1, 1);
      }
      ctx.fillStyle = `rgba(255,186,96,${(0.22 * dark).toFixed(3)})`;
      for (const [x, y, w, h] of WINDOWS) ctx.fillRect(x, y, w, h);
      // Moonlit sparkle on the falling water.
      ctx.fillStyle = `rgba(150,210,255,${(0.12 * dark).toFixed(3)})`;
      for (const f of FALL) ctx.fillRect(f.x, f.lip, 1, f.bot - f.lip);
    }
    ctx.globalCompositeOperation = 'source-over';
  }, { island: ID });

  /* ======================================================= REGISTER */
  S.registerStatic(5, (ctx) => drawGround(ctx));
  S.registerStatic(20, (ctx) => drawBuildings(ctx));
})();
