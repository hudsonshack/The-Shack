/* The Shack: 05-space.js (Space)
 *
 * The starry space the five islands float in.
 *
 * STATIC (order < 0, drawn once into the sky canvas):
 *   -100 nebula: deep indigo at the top to violet below, a soft violet-magenta
 *        star river through the gap between the north and south islands, teal
 *        wisps, dust lanes, all quantised with ordered dithering into bands;
 *        three layers of stars (tiny, small, a few bright 4-point sparkles),
 *        a far spiral galaxy, distant rock islets and the ringed planet (its
 *        ring passes behind and in front, lit from the top-left, with real
 *        ring and planet shadows).
 *
 * DYNAMIC (order < 90, behind the islands):
 *   10 day / twilight wash: soft blue-violet by day with a warm sun glow from
 *      the top-left corner; pink-orange edges at dawn and dusk. The ringed
 *      planet is laid back over the wash so it still reads by day.
 *   20 star twinkle (a few hundred cached points)
 *   30 the moon, in the real current phase (synodic month from a reference
 *      new moon), pixel-correct terminator, craters and maria
 *   40 tiny rock islets drifting very slowly across space
 *   50 shooting stars every 6 to 15 s (rarer with reduced motion, none by day)
 *   60 letterbox join: world edges that face a visible letterbox fade (dithered)
 *      to S.spaceColor as it shows on screen, so any aspect ratio joins without
 *      a seam (nothing is drawn when no letterbox shows)
 *
 * Also sets S.spaceColor to the average tone of the world's outer band as lit
 * right now (night sky + day wash + twilight, weighted toward the letterbox
 * sides actually showing), and exposes
 * S.space = { moon(): {age, days, illumination, waxing, name}, moonPos, shoot() } for anyone who wants it.
 *
 * Placement keeps clear of the HUD at fit view: the moon sits in the open gap
 * right of the clock spire, below the status card; the ringed planet sits under
 * Clockspire, above the control dock.
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S) return;

  const W = S.W, H = S.H, TILE = S.TILE;
  const RM = !!S.reducedMotion;

  /* ------------------------------------------------------------ helpers */
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (e0, e1, v) => { const x = clamp01((v - e0) / (e1 - e0)); return x * x * (3 - 2 * x); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
  const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bayer = (x, y) => (B4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
  /** Ordered-dither quantise v (0..1) to an integer step 0..levels at pixel x,y. */
  const dqi = (v, levels, x, y) => { const s = clamp01(v) * levels; let b = Math.floor(s); if (s - b > bayer(x, y)) b++; return b > levels ? levels : b; };
  const rgbOf = (h) => S.color.hexToRgb(h);
  const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const hexRgb = (c) => S.color.rgbToHex(c[0], c[1], c[2]);

  function vnoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = S.hash(xi, yi, seed), b = S.hash(xi + 1, yi, seed), c = S.hash(xi, yi + 1, seed), d = S.hash(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, seed, oct = 4) {
    let s = 0, amp = 0.5, tot = 0;
    for (let o = 0; o < oct; o++) { s += vnoise(x, y, seed + o * 17) * amp; tot += amp; x *= 2.03; y *= 2.03; amp *= 0.5; }
    return s / tot;
  }

  /** True if native px (x, y) is clear of every island (top rect grown by `m` px, plus its underside). */
  function inOpen(x, y, m = 16) {
    for (const id of S.ISLANDS) {
      const r = S.islands[id];
      const x0 = r.x * TILE - m, x1 = (r.x + r.w) * TILE + m;
      const y0 = r.y * TILE - m - TILE, y1 = (r.y + r.h + r.depth) * TILE + m;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) return false;
    }
    return x >= 2 && y >= 2 && x < W - 2 && y < H - 2;
  }

  /* The star river: a soft band through the gap between the north and south islands. */
  const riverY = (x) => 424 + 34 * Math.sin(x / 260 + 0.6) - (x - 640) * 0.05;
  function riverAt(x, y) {
    const d = (y - riverY(x)) / 112;
    return Math.exp(-d * d);
  }

  /* ----------------------------------------------------------- palettes */
  const VIOLET = ['#05041a', '#090723', '#0e0b2d', '#140f38', '#1b1343', '#24184f', '#2f1d5b', '#3c2367', '#4b2a71', '#5c3279', '#70397f'];
  const TEAL = ['#05041a', '#071026', '#091a33', '#0c2440', '#112f4c', '#173c58'];
  const EDGE_FALLBACK = '#0e0b2d'; // until the sky has been painted and measured

  /* Edge statistics: the average colour of an RGBA buffer over the world's
   * outer band, separately for the left+right columns and the top+bottom rows.
   * Returned as {lr: [r, g, b, a], tb: [r, g, b, a]} with rgb premultiplied by a,
   * so a wash drawn at globalAlpha k composites as  c * (1 - k*a) + k * rgb. */
  const BAND = 32;
  function edgeStats(d) {
    const acc = (x0, y0, x1, y1, s) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const o = (y * W + x) * 4, a = d[o + 3] / 255;
        s[0] += d[o] * a; s[1] += d[o + 1] * a; s[2] += d[o + 2] * a; s[3] += a; s[4]++;
      }
    };
    const lr = [0, 0, 0, 0, 0], tb = [0, 0, 0, 0, 0];
    acc(0, 0, BAND, H, lr); acc(W - BAND, 0, W, H, lr);
    acc(0, 0, W, BAND, tb); acc(0, H - BAND, W, H, tb);
    const norm = (s) => [s[0] / s[4], s[1] / s[4], s[2] / s[4], s[3] / s[4]];
    return { lr: norm(lr), tb: norm(tb) };
  }
  let nightEdge = null, dayEdge = null, edgeGen = 0;
  const twiEdge = {};

  /* ============================================================ NEBULA */
  function paintNebula(img) {
    const d = img.data;
    // Low-frequency fields on a coarse grid, interpolated per pixel.
    const G = 4, gw = W / G + 2, gh = H / G + 2;
    const fA = new Float32Array(gw * gh), fB = new Float32Array(gw * gh), fC = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const x = gx * G, y = gy * G, i = gy * gw + gx;
      fA[i] = fbm(x / 150, y / 120, 11, 5);
      fB[i] = fbm(x / 90 + 40, y / 70, 23, 4);
      fC[i] = fbm(x / 210 + 9, y / 190 + 5, 37, 4);
    }
    const samp = (f, x, y) => {
      const gx = x / G, gy = y / G, x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0;
      const i = y0 * gw + x0;
      const a = f[i], b = f[i + 1], c = f[i + gw], e = f[i + gw + 1];
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
    };
    const VR = VIOLET.map(rgbOf), TR = TEAL.map(rgbOf), nV = VR.length - 1, nT = TR.length - 1;
    for (let y = 0; y < H; y++) {
      const ty = y / H;
      for (let x = 0; x < W; x++) {
        const A = samp(fA, x, y), B = samp(fB, x, y), C = samp(fC, x, y);
        // deep indigo above, violet below, a little lighter towards the right
        const g = ty * 0.85 + (x / W) * 0.15;
        // star river, wobbled by noise so its edge is cloudy
        const band = riverAt(x, y + (A - 0.5) * 120);
        const neb = band * smooth(0.3, 0.78, A);
        const core = band * smooth(0.58, 0.86, A) * smooth(0.3, 0.7, C);
        const dust = band * smooth(0.56, 0.72, B);
        const haze = smooth(0.45, 0.85, C);
        const teal = (1 - band) * (1 - band) * smooth(0.55, 0.82, B) * smooth(0.4, 0.7, C);
        let v = 0.06 + g * 0.28 + neb * 0.44 + core * 0.36 + haze * 0.12 - dust * 0.2;
        v += (S.hash(x, y, 5) - 0.5) * 0.02;
        const o = (y * W + x) * 4;
        let c;
        if (smooth(0.05, 0.6, teal) > bayer(x + 2, y + 1)) c = TR[dqi(v * 0.9 + teal * 0.32, nT, x, y)];
        else c = VR[dqi(v, nV, x, y)];
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
    }
  }

  /* ============================================================= STARS */
  const TINY = ['#2c2a58', '#37336a', '#433e78', '#4e4a86'];
  const SMALL = ['#c9c4f0', '#e9e6ff', '#ffe8c4', '#bcd2ff', '#f6c8e0'];
  const twinkles = []; // {x, y, ph, sp, c, big}

  function setPx(img, x, y, hex, a = 1) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const c = rgbOf(hex), d = img.data, o = (y * W + x) * 4;
    d[o] = lerp(d[o], c[0], a); d[o + 1] = lerp(d[o + 1], c[1], a); d[o + 2] = lerp(d[o + 2], c[2], a);
  }

  function paintStars(img) {
    const rnd = S.rng(4242);
    twinkles.length = 0;
    // tiny: dim dust of stars, thicker in the river
    for (let n = 0; n < 2600; n++) {
      const x = (rnd() * W) | 0, y = (rnd() * H) | 0;
      const b = riverAt(x, y);
      if (rnd() > 0.35 + b * 0.65) continue;
      setPx(img, x, y, TINY[(rnd() * TINY.length) | 0], 0.9);
    }
    // small: crisp 1 px stars, some with soft arms
    for (let n = 0; n < 420; n++) {
      const x = (rnd() * W) | 0, y = (rnd() * H) | 0;
      if (rnd() > 0.5 + riverAt(x, y) * 0.5) continue;
      const c = SMALL[(rnd() * SMALL.length) | 0];
      setPx(img, x, y, c, 0.55 + rnd() * 0.45);
      const big = rnd() < 0.22;
      if (big) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) setPx(img, x + dx, y + dy, c, 0.22);
      if (twinkles.length < 360 && inOpen(x, y, 4)) twinkles.push({ x, y, ph: rnd() * 6.283, sp: 0.6 + rnd() * 1.8, c, big });
    }
    // bright 4-point sparkles, only in open space
    let made = 0, tries = 0;
    while (made < 16 && tries++ < 600) {
      const x = 8 + ((rnd() * (W - 16)) | 0), y = 8 + ((rnd() * (H - 16)) | 0);
      if (!inOpen(x, y, 10)) continue;
      const warm = rnd() < 0.35;
      sparkle(img, x, y, 2 + ((rnd() * 3) | 0), warm);
      twinkles.push({ x, y, ph: rnd() * 6.283, sp: 0.5 + rnd() * 0.8, c: warm ? '#fff0c8' : '#e8f0ff', big: true, spark: true });
      made++;
    }
  }

  function sparkle(img, x, y, arm, warm) {
    const C = warm ? ['#ffffff', '#ffe9b0', '#e8a86a', '#8a5a6a'] : ['#ffffff', '#d8e4ff', '#8e9ae0', '#4a4a8e'];
    setPx(img, x, y, C[0]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let k = 1; k <= arm; k++) setPx(img, x + dx * k, y + dy * k, C[Math.min(3, k)], k === arm ? 0.6 : 0.95);
    }
    for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) setPx(img, x + dx, y + dy, C[2], 0.45);
  }

  /** A far spiral galaxy: a tiny tilted smudge with a bright core. */
  function paintGalaxy(img, cx, cy) {
    for (let j = -6; j <= 6; j++) for (let i = -12; i <= 12; i++) {
      const u = i * 0.94 + j * 0.34, v = (-i * 0.34 + j * 0.94) * 2.6;
      const r = Math.sqrt(u * u + v * v), a = Math.atan2(v, u);
      const arm = 0.5 + 0.5 * Math.cos(2 * a - r * 0.55);
      const k = Math.exp(-r / 5.5) * (0.45 + 0.55 * arm);
      const q = dqi(k, 4, cx + i, cy + j);
      if (q <= 0) continue;
      setPx(img, cx + i, cy + j, ['', '#3a2f6a', '#6a5aa0', '#b8a8e0', '#fff4e0'][q], 0.9);
    }
  }

  /* ============================================================ ISLETS
   * Tiny floating rocks: grass cap, rock underside tapering to a point, lit
   * from the top-left, tinted toward space by distance (fd 0..1).
   */
  function isletSprite(w, seed, fd, season) {
    const rnd = S.rng(seed);
    const capH = Math.max(2, Math.round(w / 5)), depth = Math.round(w * (0.55 + rnd() * 0.25));
    const tree = w >= 13 ? 6 : 0;
    const cw = w + 4, ch = capH + depth + 4 + tree;
    const grid = new Int8Array(cw * ch).fill(-1); // -1 empty, else palette index
    const cx = (cw - 1) / 2;
    // palette: 0 outline, 1-3 grass (light..dark), 4-7 rock (light..dark), 8 crystal
    const g = season === 'winter' ? ['#f4f8fb', '#d6e2ea', '#aebfcc'] :
      [S.color.shade(S.PAL.grass[season] || S.PAL.grass.autumn, 0.2), S.PAL.grass[season] || S.PAL.grass.autumn, S.PAL.grassDark[season] || S.PAL.grassDark.autumn];
    const lf = S.PAL.leaf[season] || S.PAL.leaf.autumn;
    const pal = ['#120e22', g[0], g[1], g[2], '#a08e96', '#7a687e', '#56465f', '#3a2e48', '#9be8ff', S.color.shade(lf, 0.25), lf, S.color.shade(lf, -0.3)];
    const tint = rgbOf('#241c4a');
    const P = pal.map((h, i) => hexRgb(mixRgb(rgbOf(h), i === 0 ? rgbOf('#0b0820') : tint, i === 0 ? fd * 0.6 : fd)));
    for (let y = 0; y < capH + depth; y++) {
      let hw;
      if (y < capH) { const t = (y + 0.5) / capH; hw = (w / 2) * Math.sqrt(1 - Math.pow(1 - t, 2) * 0.6); }
      else { const t = (y - capH + 0.5) / depth; hw = (w / 2) * Math.pow(1 - t, 0.85) * (1 - 0.12 * t) + (rnd() - 0.5) * 1.4; }
      for (let x = 0; x < cw; x++) {
        const dx = x - cx;
        if (Math.abs(dx) > hw) continue;
        const yy = y + 2 + tree;
        let idx;
        if (y < capH) idx = y === 0 || dx < -hw * 0.4 ? 1 : (y === capH - 1 ? 3 : 2);
        else {
          const side = dx / Math.max(1, hw); // -1 left (lit) .. 1 right (dark)
          const t = (y - capH) / depth;
          let tone = 4 + (side > -0.3 ? 1 : 0) + (side > 0.45 ? 1 : 0) + (t > 0.55 ? 1 : 0);
          if (S.hash(x, y, seed) < 0.18) tone = Math.min(7, tone + 1);
          idx = Math.min(7, tone);
          if (y === capH && S.hash(x, 9, seed) < 0.6) idx = 3; // grass lip hanging over
        }
        grid[yy * cw + x] = idx;
      }
    }
    // a glowing crystal on bigger islets
    if (w >= 12) { const x = Math.round(cx + 1), y = capH + 2 + tree + Math.round(depth * 0.3); if (grid[y * cw + x] >= 0) grid[y * cw + x] = 8; }
    // a little tree on the bigger islets: a trunk and a round crown in the season's leaf colours
    if (tree) {
      const tx = Math.round(cx - w * 0.15), base = 2 + tree;
      grid[(base - 1) * cw + tx] = 7; grid[(base - 2) * cw + tx] = 7;
      const crown = [[0, -6, 9], [-1, -5, 9], [0, -5, 10], [1, -5, 10], [-1, -4, 9], [0, -4, 10], [1, -4, 11], [-1, -3, 10], [0, -3, 11], [1, -3, 11]];
      for (const [dx, dy, k] of crown) grid[(base + dy) * cw + tx + dx] = k;
    }
    const c = mk(cw, ch), x2 = c.getContext('2d');
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      let idx = grid[y * cw + x];
      if (idx < 0) {
        const n = (xx, yy) => xx >= 0 && yy >= 0 && xx < cw && yy < ch && grid[yy * cw + xx] >= 0 && grid[yy * cw + xx] !== 0;
        if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) idx = 0; else continue;
      }
      x2.fillStyle = P[idx]; x2.fillRect(x, y, 1, 1);
    }
    return c;
  }

  const FAR_ISLETS = [[476, 150, 7, 0.62], [826, 52, 6, 0.66], [50, 436, 9, 0.55], [1238, 446, 8, 0.58], [452, 640, 7, 0.6], [1180, 20, 6, 0.68], [820, 780, 6, 0.65], [12, 760, 8, 0.6]];

  /* ======================================================= RINGED PLANET */
  /* Under Clockspire's underside tip (about native 613) and above the control
   * dock (native 733+ at every fit view down to 1280x720): the sphere spans
   * cy +/- 40 and the ring cy +/- 36 by cx +/- 84. */
  const PL = { cx: 604, cy: 686, R: 40, tilt: -0.3, squash: 0.3, r1: 1.38, r2: 2.18 };
  const LIGHT = (() => { const v = [-0.62, -0.55, 0.56]; const l = Math.hypot(v[0], v[1], v[2]); return v.map((a) => a / l); })();
  const BANDS = [
    ['#2a1634', '#6a3048', '#b05a5e', '#e08e70', '#f6c296'], // peach
    ['#28163a', '#5e2c4e', '#9a4a62', '#c87478', '#eaa696'], // rose
    ['#2e2240', '#6e5260', '#ae8a7a', '#dcbc98', '#f8e4bc'], // cream
    ['#22142e', '#52283e', '#84404e', '#b05e5c', '#d48870'], // rust
  ];
  const BAND_SEQ = [2, 0, 2, 1, 3, 0, 2, 0, 1, 2, 3, 2, 0, 2];
  const RING = ['#1e1836', '#4a3e62', '#857492', '#bcaab0', '#e8dccb'];
  let planetCanvas = null;

  /** Ring structure at radius r (planet radii): coverage 0..1 and base brightness 0..1. */
  function ringAt(r) {
    if (r < PL.r1 || r > PL.r2) return null;
    if (r < 1.52) return { a: 0.5, v: 0.45 };                     // faint inner ring
    if (r > 1.8 && r < 1.87) return null;                         // the gap
    if (r < 1.8) return { a: 1, v: 0.8 + 0.1 * Math.sin(r * 38) }; // bright main ring
    return { a: 1, v: 0.58 + 0.06 * Math.sin(r * 50) };           // outer ring
  }

  function buildPlanet() {
    const R = PL.R, hx = Math.ceil(PL.r2 * R) + 3, hy = R + 4;
    const cw = hx * 2 + 1, ch = hy * 2 + 1;
    const c = mk(cw, ch), x2 = c.getContext('2d');
    const img = x2.createImageData(cw, ch), d = img.data;
    const ct = Math.cos(PL.tilt), st = Math.sin(PL.tilt), sq = PL.squash, sz = Math.sqrt(1 - sq * sq);
    const e1 = [ct, st, 0], e2 = [-st * sq, ct * sq, sz];
    const nr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const L = LIGHT;
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const put = (i, j, hex) => { const col = rgbOf(hex), o = (j * cw + i) * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255; };
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const x = i - hx + 0.5, y = j - hy + 0.5;
      const wx = PL.cx + i - hx, wy = PL.cy + j - hy; // world px, for world-aligned dither
      // ring hit (plane through the centre)
      const a = x * ct + y * st, b = (-x * st + y * ct) / sq;
      const rr = Math.sqrt(a * a + b * b) / R;
      const ring = ringAt(rr);
      const P = [a * e1[0] + b * e2[0], a * e1[1] + b * e2[1], a * e1[2] + b * e2[2]];
      const front = P[2] > 0;
      const inPlanet = x * x + y * y <= R * R;
      const ringHere = !!ring && (ring.a >= 1 || (wx + wy) % 2 === 0);
      const ringTone = () => {
        // shadowed by the planet?
        const pl = dot(P, L), disc = pl * pl - (dot(P, P) - R * R);
        const shadow = disc > 0 && -pl - Math.sqrt(disc) > 0;
        let v = ring.v - (a / (PL.r2 * R)) * 0.14;               // brighter toward the light
        if (rr > PL.r2 - 0.05) v -= 0.25;                         // darker outer edge
        if (shadow) v = 0.12;
        return RING[dqi(v, 4, wx, wy)];
      };
      if (ringHere && front) { put(i, j, ringTone()); continue; }
      if (inPlanet) {
        const z = Math.sqrt(Math.max(0, R * R - x * x - y * y));
        const N = [x / R, y / R, z / R];
        let lam = dot(N, L);
        // ring shadow on the planet
        const Ps = [x, y, z], den = dot(nr, L);
        if (Math.abs(den) > 1e-4) {
          const s = -dot(nr, Ps) / den;
          if (s > 0) { const Q = [x + L[0] * s, y + L[1] * s, z + L[2] * s]; const rq = ringAt(Math.sqrt(dot(Q, Q)) / R); if (rq && rq.a >= 1) lam *= 0.35; }
        }
        const lat = dot(N, nr) + (vnoise(N[0] * 6 + N[2] * 3, N[1] * 6, 91) - 0.5) * 0.09 + 0.03 * Math.sin(dot(N, e1) * 9);
        const band = BANDS[BAND_SEQ[Math.max(0, Math.min(BAND_SEQ.length - 1, Math.floor((lat + 1) * 0.5 * BAND_SEQ.length)))]];
        const v = 0.08 + 0.92 * Math.max(0, lam) + 0.06 * (S.hash(i, j, 77) - 0.5);
        let q = dqi(v, 4, wx, wy);
        const rim = Math.sqrt(x * x + y * y) / R;
        if (rim > 0.93 && lam > 0.35) q = 4;          // bright limb, top-left
        put(i, j, rim > 0.97 && lam < 0.05 ? '#120c22' : band[q]);
        continue;
      }
      if (ringHere && !front) put(i, j, ringTone());
    }
    x2.putImageData(img, 0, 0);
    // a tiny moonlet
    x2.fillStyle = '#d8cfe0'; x2.fillRect(hx + Math.round(-PL.r2 * R * 0.92), hy - 14, 2, 2);
    x2.fillStyle = '#6a5a86'; x2.fillRect(hx + Math.round(-PL.r2 * R * 0.92) + 1, hy - 13, 1, 1);
    planetCanvas = { canvas: c, x: PL.cx - hx, y: PL.cy - hy };
    return planetCanvas;
  }

  /* ========================================================= THE MOON
   * Phase from S.now(): synodic month 29.530588853 d, reference new moon
   * 2000-01-06 18:14 UTC. Northern-hemisphere view (waxing lit on the right).
   */
  const SYNODIC = 29.530588853, NEW_REF = Date.UTC(2000, 0, 6, 18, 14);
  function moonInfo(date) {
    const days = (date.getTime() - NEW_REF) / 864e5;
    const age = (((days / SYNODIC) % 1) + 1) % 1;
    const illumination = (1 - Math.cos(age * Math.PI * 2)) / 2;
    const waxing = age < 0.5;
    const names = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
    const name = names[Math.floor(((age * 8) + 0.5) % 8)];
    return { age, days: age * SYNODIC, illumination, waxing, name };
  }
  /* In the open gap right of the clock spire, above Clockspire's NE corner:
   * below the HUD status card (native y <= 114 at fit view, phone included)
   * and left of the blimp's route (x 768..896). */
  const MOON = { x: 735, y: 165, R: 13 };
  const CRATERS = [[-0.05, 0.64, 0.13], [0.52, 0.42, 0.1], [-0.2, 0.28, 0.09], [0.12, -0.66, 0.08], [0.66, -0.18, 0.07], [-0.6, -0.5, 0.08]];
  const MARIA = [[-0.32, -0.28, 0.34], [0.18, -0.3, 0.22], [0.36, 0.04, 0.24], [-0.5, 0.18, 0.3], [0.05, 0.12, 0.14]];
  let moonCache = { key: '', canvas: null };

  /** Two canvases: the sunlit part, and the earthshine-dark part (hidden by day). */
  function buildMoon(info) {
    const R = MOON.R, size = R * 2 + 1 + 8, off = 4;
    const lit = mk(size, size), dark = mk(size, size);
    const li = lit.getContext('2d').createImageData(size, size), di = dark.getContext('2d').createImageData(size, size);
    const L5 = ['#8a7f92', '#b3a898', '#d3c8ac', '#ebe2c4', '#fcf8e6'];
    const DARK = ['#1b1838', '#231f45', '#2e2954', '#3a3462'];
    const ca = Math.cos(info.age * Math.PI * 2);
    const put = (img, i, j, hex) => { const col = rgbOf(hex), o = (j * size + i) * 4; img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255; };
    for (let j = 0; j <= 2 * R; j++) for (let i = 0; i <= 2 * R; i++) {
      const x = (i - R) / (R + 0.5), y = (j - R) / (R + 0.5);
      const r2 = x * x + y * y;
      if (r2 > 1) continue;
      const s = Math.sqrt(1 - y * y), xt = s * ca;
      // signed distance (moon radii) into the sunlit side
      const into = info.waxing ? x - xt : -xt - x;
      const pi = i + off, pj = j + off;
      let shade = 0, rim = 0;
      for (const [mx, my, mr] of MARIA) { const dd = ((x - mx) ** 2 + (y - my) ** 2) / (mr * mr); if (dd < 1 && vnoise(x * 5 + 3, y * 5, 61) > 0.32) shade = 1; }
      for (const [cx2, cy2, cr] of CRATERS) {
        const dx = x - cx2, dy = y - cy2, dd = Math.sqrt(dx * dx + dy * dy) / cr;
        if (dd < 0.72) { shade = 2; rim = 0; }
        else if (dd < 1.08 && shade !== 2) rim = dx + dy > 0 ? 1 : -1; // lit lip bottom-right, shadowed lip top-left
      }
      const edge = Math.sqrt(r2);
      if (into > 0) {
        let q = 3;
        if (shade === 1) q = 2;
        if (shade === 2) q = 1;
        if (rim === 1) q = Math.min(4, q + 1);
        if (rim === -1) q = Math.max(1, q - 1);
        if (edge > 0.88 && q > 2) q--;                 // limb darkening
        if (into < 0.1) q = Math.max(0, q - 2);        // the terminator: one soft step
        else if (into < 0.22) q = Math.max(0, q - 1);
        else if (edge < 0.55 && shade === 0 && rim === 0) q = 4;
        put(li, pi, pj, L5[q]);
      } else {
        put(di, pi, pj, edge > 0.9 ? DARK[3] : DARK[shade === 2 ? 0 : shade ? 1 : 2]);
      }
    }
    lit.getContext('2d').putImageData(li, 0, 0);
    dark.getContext('2d').putImageData(di, 0, 0);
    return { lit, dark };
  }
  function moonHalo() {
    const R = MOON.R, size = R * 2 + 1 + 40, c = mk(size, size), x2 = c.getContext('2d');
    const m = size / 2;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const r = Math.hypot(i + 0.5 - m, j + 0.5 - m);
      if (r <= R + 1) continue;
      const k = smooth(R + 20, R + 2, r);
      const q = dqi(k * 0.75, 3, i, j);
      if (!q) continue;
      x2.fillStyle = ['', 'rgba(170,160,230,0.10)', 'rgba(190,180,240,0.16)', 'rgba(220,214,255,0.24)'][q];
      x2.fillRect(i, j, 1, 1);
    }
    return c;
  }
  let haloCanvas = null;

  /* ====================================================== STATIC SPACE */
  let spaceCache = { key: '', canvas: null };
  function buildSpace() {
    const season = S.time.season || 'autumn';
    if (spaceCache.canvas && spaceCache.key === season) return spaceCache.canvas;
    const c = mk(W, H), x2 = c.getContext('2d');
    const img = x2.createImageData(W, H);
    paintNebula(img);
    paintStars(img);
    paintGalaxy(img, 1196, 400);
    paintGalaxy(img, 470, 534);
    nightEdge = edgeStats(img.data); edgeGen++;
    x2.putImageData(img, 0, 0);
    for (const [x, y, w, fd] of FAR_ISLETS) {
      const sp = isletSprite(w, x * 7 + y, fd, season);
      x2.drawImage(sp, Math.round(x - sp.width / 2), Math.round(y - sp.height / 2));
    }
    const pl = planetCanvas || buildPlanet();
    x2.drawImage(pl.canvas, pl.x, pl.y);
    spaceCache = { key: season, canvas: c };
    return c;
  }

  S.registerStatic(-100, (ctx) => { ctx.drawImage(buildSpace(), 0, 0); });

  /* ======================================================== DAY & DUSK */
  let dayCanvas = null;
  const twiCanvas = {};
  function buildDay() {
    const c = mk(W, H), x2 = c.getContext('2d');
    const img = x2.createImageData(W, H), d = img.data;
    const top = rgbOf('#93a2ea'), bot = rgbOf('#7f72cc'), sun = rgbOf('#ffe2b0'), sunCore = rgbOf('#fff4dc');
    const STEP = 5;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let c0 = mixRgb(top, bot, y / H * 0.9 + x / W * 0.1);
      const r = Math.hypot(x + 30, y + 40);
      const glow = Math.exp(-r / 230), core = Math.exp(-r / 70);
      c0 = mixRgb(c0, sun, Math.min(1, glow * 1.2));
      c0 = mixRgb(c0, sunCore, core);
      const a = 0.74 + 0.2 * glow;
      const o = (y * W + x) * 4, bb = bayer(x, y);
      d[o] = Math.min(255, Math.floor(c0[0] / STEP + bb) * STEP);
      d[o + 1] = Math.min(255, Math.floor(c0[1] / STEP + bb) * STEP);
      d[o + 2] = Math.min(255, Math.floor(c0[2] / STEP + bb) * STEP);
      d[o + 3] = Math.round((Math.floor(a * 20 + bb) / 20) * 255);
    }
    dayEdge = edgeStats(d); edgeGen++;
    x2.putImageData(img, 0, 0);
    return c;
  }
  function buildTwilight(kind) {
    const c = mk(W, H), x2 = c.getContext('2d');
    const img = x2.createImageData(W, H), d = img.data;
    const A = rgbOf(kind === 'dawn' ? '#ff86c0' : '#ff7a8a'), B = rgbOf(kind === 'dawn' ? '#ffb48e' : '#ffaa52');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      // the low edge glows like a horizon, the sun's corner warms, the top blushes a little
      // (no side blush: the left and right edges meet the letterbox on wide screens)
      const low = Math.exp(-(H - y) / 150);
      const sun = Math.exp(-Math.hypot(x + 20, y + 20) / 330);
      const top = Math.exp(-y / 60) * 0.3;
      const k = clamp01(low * 0.95 + sun * 0.8 + top);
      const q = dqi(k, 6, x, y);
      if (!q) continue;
      const c0 = mixRgb(A, B, clamp01(low * 1.2 + sun * 0.3));
      const o = (y * W + x) * 4;
      d[o] = c0[0]; d[o + 1] = c0[1]; d[o + 2] = c0[2]; d[o + 3] = Math.round(q / 6 * 0.5 * 255);
    }
    twiEdge[kind] = edgeStats(d); edgeGen++;
    x2.putImageData(img, 0, 0);
    return c;
  }

  /** Camera footprint this frame: the visible world rect (native px, clamped) so
   * full-screen layers skip off-camera pixels, and how far the view reaches past
   * each world edge (native px; > 0 means that side shows letterbox). */
  const view = { x: 0, y: 0, w: W, h: H, l: 0, r: 0, t: 0, b: 0 };
  function updateView() {
    const cv = S.canvas, vw = cv && cv.clientWidth, vh = cv && cv.clientHeight;
    if (!vw || !vh || !S.screenToWorld) { Object.assign(view, { x: 0, y: 0, w: W, h: H, l: 0, r: 0, t: 0, b: 0 }); return; }
    const a = S.screenToWorld(0, 0), b = S.screenToWorld(vw, vh);
    const x0 = Math.max(0, Math.floor(a.x) - 2), y0 = Math.max(0, Math.floor(a.y) - 2);
    const x1 = Math.min(W, Math.ceil(b.x) + 2), y1 = Math.min(H, Math.ceil(b.y) + 2);
    if (x1 > x0 && y1 > y0) Object.assign(view, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    else Object.assign(view, { x: 0, y: 0, w: W, h: H });
    // a side counts once its bar is at least half a screen pixel wide
    const z = (S.cam && S.cam.z) || 1, cut = 0.5 / z;
    view.l = -a.x > cut ? -a.x : 0; view.r = b.x - W > cut ? b.x - W : 0;
    view.t = -a.y > cut ? -a.y : 0; view.b = b.y - H > cut ? b.y - H : 0;
    view.spanX = b.x - a.x; view.spanY = b.y - a.y;
  }

  /** Day amount, twilight amount and which twilight, from S.time. */
  const sky = { day: 0, twi: 0, kind: 'dusk', night: 1 };
  function updateSky() {
    const T = S.time, L = clamp01(T.light == null ? 1 : T.light);
    sky.day = smooth(0.12, 0.95, L);
    sky.night = 1 - smooth(0.05, 0.6, L);
    const inTwi = T.isDawn || T.isDusk;
    sky.twi = inTwi ? clamp01(1 - Math.abs(L - 0.42) / 0.5) : 0;
    sky.kind = T.isDawn ? 'dawn' : 'dusk';
  }
  /* The letterbox colour: the world's outer band as lit right now. Each wash
   * composites over the night tone exactly as layer 10 draws it (globalAlpha
   * sky.day, then sky.twi), averaged over the band. Left/right and top/bottom
   * tones are blended by how much of each letterbox is on screen, so the colour
   * moves smoothly while zooming. Recomputed only when its inputs step. */
  function bandTone(side, day, twi, kind) {
    let c = nightEdge ? nightEdge[side].slice(0, 3) : rgbOf(EDGE_FALLBACK);
    const over = (e, k) => { c = [0, 1, 2].map((i) => c[i] * (1 - k * e[3]) + k * e[i]); };
    if (day >= 0.01 && dayEdge) over(dayEdge[side], day);
    if (twi >= 0.01 && twiEdge[kind]) over(twiEdge[kind][side], twi);
    return c;
  }
  /* 50-atmosphere multiplies the whole world by a faint cool night tint (its
   * layer 600, after space is drawn; read through its public S.atmo.sky()).
   * The letterbox is never tinted, so S.spaceColor carries the same tint while
   * the edge ramp aims at the untinted tone: once multiplied, the world's edge
   * lands exactly on the letterbox colour. Without that module: no tint. */
  const NIGHT_TINT = rgbOf('#d3d6f0');
  function nightTintK() {
    let a = null;
    try { a = S.atmo && typeof S.atmo.sky === 'function' ? S.atmo.sky() : null; } catch (e) { a = null; }
    return a && typeof a.n === 'number' ? smooth(0.25, 1, a.n) : 0;
  }
  let lastEdgeKey = -1, rampColor = EDGE_FALLBACK;
  function updateSpaceColor(build) {
    // the washes' edge stats come from their canvases; build them when they are about to show
    if (build && sky.day >= 0.01 && !dayCanvas) dayCanvas = buildDay();
    if (build && sky.twi >= 0.01 && !twiCanvas[sky.kind]) twiCanvas[sky.kind] = buildTwilight(sky.kind);
    const lrA = (view.l + view.r) * (view.spanY || H), tbA = (view.t + view.b) * (view.spanX || W);
    const f = lrA + tbA > 0 ? Math.round((tbA / (lrA + tbA)) * 20) / 20 : 0;
    // the colour steps with these quantised inputs; it isn't recomputed every frame
    const dq = Math.round(sky.day * 40), tq = Math.round(sky.twi * 40), nq = Math.round(nightTintK() * 40);
    const key = (((edgeGen * 2 + (sky.kind === 'dawn' ? 1 : 0)) * 21 + Math.round(f * 20)) * 41 + nq) * 1681 + tq * 41 + dq; // all small ints: one number
    if (key === lastEdgeKey) return;
    lastEdgeKey = key;
    const tone = mixRgb(bandTone('lr', dq / 40, tq / 40, sky.kind), bandTone('tb', dq / 40, tq / 40, sky.kind), f);
    const tint = mixRgb([255, 255, 255], NIGHT_TINT, nq / 40);
    rampColor = hexRgb(tone);
    S.spaceColor = hexRgb([0, 1, 2].map((i) => (tone[i] * tint[i]) / 255));
  }

  S.registerDynamic(10, (ctx) => {
    updateSky();
    updateView();
    updateSpaceColor(true);
    if (sky.day < 0.01 && sky.twi < 0.01) return;
    const v = view;
    if (sky.day >= 0.01) {
      if (!dayCanvas) dayCanvas = buildDay();
      ctx.globalAlpha = sky.day;
      ctx.drawImage(dayCanvas, v.x, v.y, v.w, v.h, v.x, v.y, v.w, v.h);
      // lay the ringed planet back over the wash so it still reads by day
      const pl = planetCanvas;
      if (pl) { ctx.globalAlpha = sky.day * 0.72; ctx.drawImage(pl.canvas, pl.x, pl.y); }
    }
    if (sky.twi >= 0.01) {
      const tc = twiCanvas[sky.kind] || (twiCanvas[sky.kind] = buildTwilight(sky.kind));
      ctx.globalAlpha = sky.twi;
      ctx.drawImage(tc, v.x, v.y, v.w, v.h, v.x, v.y, v.w, v.h);
    }
    ctx.globalAlpha = 1;
  });

  /* ============================================================ TWINKLE */
  S.registerDynamic(20, (ctx, t) => {
    const vis = 1 - sky.day * 0.92;
    if (vis < 0.05 || !twinkles.length) return;
    const tt = RM ? t * 0.3 : t;
    for (let i = 0; i < twinkles.length; i++) {
      const s = twinkles[i];
      const w = Math.sin(tt * s.sp + s.ph) + 0.35 * Math.sin(tt * s.sp * 2.7 + s.ph * 1.7);
      if (s.spark) {
        // sparkles breathe: arms grow and shrink a pixel
        const k = 0.5 + 0.5 * w;
        ctx.globalAlpha = vis * (0.35 + 0.5 * k);
        ctx.fillStyle = s.c;
        if (k > 0.55) { ctx.fillRect(s.x - 3, s.y, 1, 1); ctx.fillRect(s.x + 3, s.y, 1, 1); ctx.fillRect(s.x, s.y - 3, 1, 1); ctx.fillRect(s.x, s.y + 3, 1, 1); }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(s.x, s.y, 1, 1);
        continue;
      }
      if (w < 0.7) continue;
      const k = Math.min(1, (w - 0.7) / 0.6);
      ctx.globalAlpha = vis * k;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s.x, s.y, 1, 1);
      if (s.big && k > 0.6) {
        ctx.globalAlpha = vis * k * 0.55;
        ctx.fillStyle = s.c;
        ctx.fillRect(s.x - 1, s.y, 3, 1); ctx.fillRect(s.x, s.y - 1, 1, 3);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(s.x, s.y, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  });

  /* =============================================================== MOON */
  let moonNow = moonInfo(S.now()), moonCheck = 0;
  S.space = { moon: () => moonInfo(S.now()), get moonPos() { return { x: MOON.x, y: MOON.y }; } };

  S.registerDynamic(30, (ctx) => {
    if (S.frame - moonCheck > 90 || !moonCache.canvas) { moonCheck = S.frame; moonNow = moonInfo(S.now()); }
    const key = Math.round(moonNow.age * 400);
    if (moonCache.key !== key) moonCache = { key, canvas: buildMoon(moonNow) };
    if (!haloCanvas) haloCanvas = moonHalo();
    const R = MOON.R;
    // halo, brighter the fuller the moon and the darker the sky
    const hk = sky.night * (0.25 + 0.75 * moonNow.illumination);
    if (hk > 0.03) { ctx.globalAlpha = hk; ctx.drawImage(haloCanvas, MOON.x - haloCanvas.width / 2 + 0.5 | 0, MOON.y - haloCanvas.height / 2 + 0.5 | 0); }
    // by day the moon is pale and its earthshine side melts into the sky
    const m = moonCache.canvas;
    ctx.globalAlpha = 1 - sky.day;
    if (ctx.globalAlpha > 0.01) ctx.drawImage(m.dark, MOON.x - R - 4, MOON.y - R - 4);
    ctx.globalAlpha = 1 - sky.day * 0.25;
    ctx.drawImage(m.lit, MOON.x - R - 4, MOON.y - R - 4);
    ctx.globalAlpha = 1;
  });

  /* ======================================================= DRIFTING ISLETS */
  const DRIFT = [
    { y: 406, w: 16, sp: 2.2, x0: 150, fd: 0.3, seed: 71 },
    { y: 456, w: 11, sp: -1.6, x0: 1060, fd: 0.42, seed: 83 },
    { y: 132, w: 9, sp: 1.2, x0: 640, fd: 0.5, seed: 97 },
  ];
  let driftSeason = '';
  S.registerDynamic(40, (ctx, t) => {
    const season = S.time.season || 'autumn';
    if (season !== driftSeason) { driftSeason = season; for (const d of DRIFT) d.sprite = isletSprite(d.w, d.seed, d.fd, season); }
    const span = W + 80;
    ctx.globalAlpha = 1 - sky.day * 0.7;
    for (const d of DRIFT) {
      const tt = RM ? 0 : t;
      const x = ((((d.x0 + tt * d.sp) % span) + span) % span) - 40;
      const y = d.y + Math.round(Math.sin(tt * 0.5 + d.seed) * 1.5);
      ctx.drawImage(d.sprite, Math.round(x - d.sprite.width / 2), Math.round(y - d.sprite.height / 2));
    }
    ctx.globalAlpha = 1;
  });

  /* ======================================================= SHOOTING STARS */
  const shooters = [];
  let nextShot = -1;
  const TAIL = ['#ffffff', '#fff3cc', '#ffd6f0', '#b6a6ff', '#6a5ab8'];
  function scheduleShot(t) { nextShot = t + (RM ? 30 + Math.random() * 30 : 6 + Math.random() * 9); }
  function spawnShot() {
    for (let tries = 0; tries < 20; tries++) {
      const x = 40 + Math.random() * (W - 80), y = 20 + Math.random() * (H * 0.75);
      if (!inOpen(x, y, 0)) continue;
      const left = Math.random() < 0.5;
      const ang = (left ? Math.PI - 0.5 : 0.5) + (Math.random() - 0.5) * 0.35;
      const sp = 230 + Math.random() * 140;
      shooters.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, age: 0, life: 0.7 + Math.random() * 0.5, len: 26 + ((Math.random() * 16) | 0) });
      return;
    }
  }
  /** Launch a shooting star now (handy for demos and previews). */
  S.space.shoot = () => spawnShot();

  S.registerDynamic(50, (ctx, t, dt) => {
    if (nextShot < 0) scheduleShot(t + (RM ? 0 : -4));
    if (t >= nextShot) {
      if (sky.day < 0.6 && !S.debug.paused) spawnShot();
      scheduleShot(t);
    }
    if (!shooters.length) return;
    for (let i = shooters.length - 1; i >= 0; i--) {
      const s = shooters[i];
      s.age += dt || 0;
      if (s.age > s.life) { shooters.splice(i, 1); continue; }
      const f = s.age / s.life;
      const fade = Math.min(1, f * 6, (1 - f) * 3) * (1 - sky.day * 0.8);
      const hx = s.x + s.vx * s.age, hy = s.y + s.vy * s.age;
      const sp = Math.hypot(s.vx, s.vy), ux = s.vx / sp, uy = s.vy / sp;
      const len = Math.round(s.len * Math.min(1, f * 4));
      let lx = -9999, ly = -9999;
      for (let k = 0; k <= len; k++) {
        const px = Math.round(hx - ux * k), py = Math.round(hy - uy * k);
        if (px === lx && py === ly) continue;
        lx = px; ly = py;
        const ci = Math.min(TAIL.length - 1, Math.floor((k / (len + 1)) * TAIL.length));
        if (ci >= 3 && (px + py) & 1) continue;
        ctx.globalAlpha = fade * (k === 0 ? 1 : 0.95 - 0.5 * (k / len));
        ctx.fillStyle = TAIL[ci];
        ctx.fillRect(px, py, 1, 1);
        if (k < len * 0.3) { ctx.globalAlpha *= 0.45; ctx.fillRect(px, py + 1, 1, 1); } // a thicker, softer head
      }
      // a little glint around the head
      ctx.globalAlpha = fade * 0.5;
      ctx.fillStyle = '#e8e0ff';
      const hxr = Math.round(hx), hyr = Math.round(hy);
      ctx.fillRect(hxr - 1, hyr, 1, 1); ctx.fillRect(hxr + 1, hyr, 1, 1); ctx.fillRect(hxr, hyr - 1, 1, 1); ctx.fillRect(hxr, hyr + 1, 1, 1);
    }
    ctx.globalAlpha = 1;
  });

  /* ===================================================== LETTERBOX JOIN
   * Where the view reaches past a world edge (pillarbox on a wide laptop,
   * letterbox on a zoomed-out phone) the core fills the screen with
   * S.spaceColor. Space fades to that colour (its untinted tone; see
   * nightTintK) over the last F px of each such edge with an ordered-dither
   * alpha ramp, so the join has no seam at any aspect ratio. Drawn after every
   * space layer (stars, moon, islets and shooting stars fade with it) and
   * before the islands, which stay crisp on top.
   * F is about 40 screen px, capped so it never reaches the moon or the planet.
   * Cost: up to four pattern fills of a few thousand px; tiles rebuild only
   * when the colour or F steps.
   */
  const ramp = { F: 0, color: '', pat: {} };
  function rampTile(len, side, rgb) {
    const horiz = side === 'l' || side === 'r';
    const w = horiz ? len : 4, h = horiz ? 4 : len;
    const c = mk(w, h), x2 = c.getContext('2d'), img = x2.createImageData(w, h), d = img.data;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = side === 'l' ? i : side === 'r' ? len - 1 - i : side === 't' ? j : len - 1 - j; // px in from the world edge
      const u = 1 - (k + 0.5) / len, a = u * u * (3 - 2 * u);
      const q = Math.min(8, Math.floor(a * 8 + bayer(i, j)));
      const o = (j * w + i) * 4;
      d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = Math.round((q / 8) * 255);
    }
    x2.putImageData(img, 0, 0);
    return c;
  }
  S.registerDynamic(60, (ctx) => {
    if (!(view.l || view.r || view.t || view.b)) return;
    const z = (S.cam && S.cam.z) || 1;
    const F = Math.max(24, Math.min(64, Math.round(40 / z / 8) * 8));
    if (ramp.F !== F || ramp.color !== rampColor) {
      ramp.F = F; ramp.color = rampColor; ramp.pat = {};
      const rgb = rgbOf(rampColor);
      for (const s of ['l', 'r', 't', 'b']) ramp.pat[s] = ctx.createPattern(rampTile(F, s, rgb), s === 'l' || s === 'r' ? 'repeat-y' : 'repeat-x');
    }
    const fill = (s, x, y, w, h) => {
      if (!ramp.pat[s]) return;
      ctx.save(); ctx.translate(x, y); ctx.fillStyle = ramp.pat[s]; ctx.fillRect(0, 0, w, h); ctx.restore();
    };
    if (view.l) fill('l', 0, 0, F, H);
    if (view.r) fill('r', W - F, 0, F, H);
    if (view.t) fill('t', 0, 0, W, F);
    if (view.b) fill('b', 0, H - F, W, F);
  });

  // Space colour at load, before the first frame (refined on the first frame,
  // once the sky has been painted and the camera sized).
  updateSky();
  updateSpaceColor(false);
})();
