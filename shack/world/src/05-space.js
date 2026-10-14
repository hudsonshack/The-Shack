/* The Shack: 05-space.js (Space)
 *
 * The midnight space the five islands float in, painted at SCREEN resolution
 * on #world (S.registerScreen), behind the world art, so it fills the whole
 * stage (letterbox included) with smooth gradients and crisp 1-device-px stars.
 * The islands stay pixel art on top.
 *
 * Screen layer -100 (device px, under the world art):
 *   a midnight blue-black ramp (#04060c -> #070b16 -> #0a1120 -> #0e1830),
 *   faint navy nebula wisps (#10203a..#173049, low alpha) along the gap between
 *   the north and south islands, fine-grain noise against banding (no checker
 *   dither), neutral ice-white stars (a few warm), a ringed planet and the moon
 *   in the real phase (a visible crescent even at new moon, faint earthshine).
 *   By day the ramp lifts a little (never past about #121b30) and a faint warm
 *   glow sits in the top-left corner only; dawn and dusk add a thin low-alpha
 *   warm band along the bottom edge. All of that is cached in one screen-sized
 *   canvas, rebuilt only on resize, a refit, a sky step or a moon step.
 *   Per frame: a few dozen stars twinkle gently and, rarely, a shooting star
 *   crosses (none by day, none with reduced motion). Each repaints only its own
 *   few pixels from the cache.
 *   The backdrop is laid out from the fit view (S.view.fit), so the planet sits
 *   under Clockspire and the moon right of the clock spire; while the camera
 *   is zoomed on an island the backdrop stays put, like a far sky.
 *
 * Dynamic 40 (native buffer, behind the islands): two small rock islets drift
 * slowly through the open gaps (pixel art, tinted toward space, fading out
 * before the world edge).
 *
 * Sets S.spaceColor to the ramp's mid tone and exposes
 * S.space = { moon(): {age, days, illumination, waxing, name}, moonPos, shoot(), redraw() }.
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S || typeof S.registerScreen !== 'function') return;

  const W = S.W, H = S.H, TILE = S.TILE;
  const RM = !!S.reducedMotion;

  /* ------------------------------------------------------------ helpers */
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (e0, e1, v) => { const x = clamp01((v - e0) / (e1 - e0)); return x * x * (3 - 2 * x); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
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
  function fbm(x, y, seed, oct) {
    let s = 0, amp = 0.5, tot = 0;
    for (let o = 0; o < oct; o++) { s += vnoise(x, y, seed + o * 17) * amp; tot += amp; x *= 2.03; y *= 2.03; amp *= 0.5; }
    return s / tot;
  }

  /** True if world px (x, y) is clear of every island (top rect grown by `m` px, plus its underside). */
  function inOpen(x, y, m) {
    for (const id of S.ISLANDS) {
      const r = S.islands[id];
      const x0 = r.x * TILE - m, x1 = (r.x + r.w) * TILE + m;
      const y0 = r.y * TILE - m - 2 * TILE, y1 = (r.y + r.h + r.depth) * TILE + m;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) return false;
    }
    return true;
  }
  /* The star river: a soft band through the gap between the north and south islands (world px). */
  const riverY = (x) => 424 + 34 * Math.sin(x / 260 + 0.6) - (x - 640) * 0.05;
  const riverAt = (x, y) => { const d = (y - riverY(x)) / 120; return Math.exp(-d * d); };

  /* ----------------------------------------------------------- palette
   * Midnight blue-black. Every tone keeps red below green (cool, not violet). */
  const RAMP_NIGHT = ['#04060c', '#070b16', '#0a1120', '#0e1830'].map(rgbOf);
  const RAMP_DAY = ['#0b1323', '#0e1729', '#10192d', '#121b30'].map(rgbOf);
  const RAMP_AT = [0, 0.34, 0.68, 1];
  const NEB_A = rgbOf('#10203a'), NEB_B = rgbOf('#173049'), HILITE = rgbOf('#15233d');
  const WARM_DAY = rgbOf('#ffc58c');
  const BAND = { dawn: rgbOf('#ff9f86'), dusk: rgbOf('#ff9a5c') };
  const STAR_COLS = ['#eef4ff', '#e3ecff', '#d4e2ff', '#f6f8ff', '#fff3df'];

  /* -------------------------------------------------------------- sky */
  const sky = { day: 0, twi: 0, kind: 'dusk', night: 1 };
  function updateSky() {
    const T = S.time, L = clamp01(T.light == null ? 1 : T.light);
    sky.day = smooth(0.12, 0.95, L);
    sky.night = 1 - smooth(0.05, 0.6, L);
    sky.twi = T.isDawn || T.isDusk ? clamp01(1 - Math.abs(L - 0.42) / 0.5) : 0;
    sky.kind = T.isDawn ? 'dawn' : 'dusk';
  }
  function rampAt(f, day) {
    let i = 0;
    while (i < RAMP_AT.length - 2 && f > RAMP_AT[i + 1]) i++;
    const u = clamp01((f - RAMP_AT[i]) / (RAMP_AT[i + 1] - RAMP_AT[i]));
    const n = mixRgb(RAMP_NIGHT[i], RAMP_NIGHT[i + 1], u), d = mixRgb(RAMP_DAY[i], RAMP_DAY[i + 1], u);
    return mixRgb(n, d, day);
  }
  function updateSpaceColor() { S.spaceColor = hexRgb(rampAt(0.55, Math.round(sky.day * 24) / 24)); }

  /* ======================================================= THE FIELD
   * Gradient, nebula, day glow and twilight band: smooth fields computed on a
   * coarse grid (1/8 device px) and upscaled with bilinear filtering. */
  const FIELD_STEP = 8;
  function buildField(V, day, twi, kind) {
    const fz = V.fit.z, fox = V.fit.ox, foy = V.fit.oy;
    const lw = Math.ceil(V.w / FIELD_STEP) + 2, lh = Math.ceil(V.h / FIELD_STEP) + 2;
    const c = mk(lw, lh), x2 = c.getContext('2d'), img = x2.createImageData(lw, lh), d = img.data;
    const band = BAND[kind] || BAND.dusk;
    const glowR = Math.max(V.w, V.h) * 0.42;
    for (let j = 0; j < lh; j++) {
      const Y = j * FIELD_STEP, fy = clamp01(Y / V.h);
      const base = rampAt(fy, day);
      for (let i = 0; i < lw; i++) {
        const X = i * FIELD_STEP;
        const wx = (X - fox) / fz, wy = (Y - foy) / fz;     // world px at the fit view
        // nebula: a few soft wisps, strongest along the star river
        const A = fbm(wx / 230, wy / 170, 11, 3), B = fbm(wx / 120 + 40, wy / 90, 23, 2);
        const river = riverAt(wx, wy + (A - 0.5) * 140);
        const neb = smooth(0.42, 0.78, A) * (0.35 + 0.65 * river);
        const wisp = smooth(0.5, 0.8, B) * river;
        let col = base;
        col = mixRgb(col, NEB_A, neb * 0.55 * (1 - 0.4 * day));
        col = mixRgb(col, NEB_B, wisp * 0.35 * (1 - 0.4 * day));
        col = mixRgb(col, HILITE, smooth(0.62, 0.9, A) * river * 0.3);
        // daytime: a faint warm glow from the top-left corner only
        if (day > 0.01) { const r = Math.hypot(X, Y) / glowR; col = mixRgb(col, WARM_DAY, day * 0.07 * Math.exp(-r * r * 2.2)); }
        // dawn / dusk: a thin warm band along the bottom edge
        if (twi > 0.01) { const e = (V.h - Y) / (V.h * 0.1); col = mixRgb(col, band, twi * 0.11 * Math.exp(-e * e)); }
        const o = (j * lw + i) * 4;
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
    }
    x2.putImageData(img, 0, 0);
    return c;
  }
  /* Fine-grain noise (0-2 levels of light, random, not a pattern) to break up 8-bit banding. */
  let noiseTile = null;
  function noisePattern(ctx) {
    if (!noiseTile) {
      noiseTile = mk(128, 128);
      const x2 = noiseTile.getContext('2d'), img = x2.createImageData(128, 128), d = img.data, r = S.rng(77);
      for (let k = 0; k < 128 * 128; k++) { d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = 255; d[k * 4 + 3] = Math.floor(r() * 3); }
      x2.putImageData(img, 0, 0);
    }
    return ctx.createPattern(noiseTile, 'repeat');
  }

  /* ============================================================ STARS
   * Laid out in world px at the fit view (so they extend past the world into
   * the letterbox) on 128 px cells, each seeded by its cell index. */
  const stars = { key: '', list: [], tw: [] };   // list: [x, y, alpha, colour, kind]; tw: twinkling ones
  function buildStars(V) {
    const key = V.fitVersion + '|' + V.w + 'x' + V.h;
    if (stars.key === key) return stars;
    const fz = V.fit.z, fox = V.fit.ox, foy = V.fit.oy;
    const wx0 = -fox / fz, wx1 = (V.w - fox) / fz, wy0 = -foy / fz, wy1 = (V.h - foy) / fz;
    const CELL = 128, list = [], tw = [];
    const dens = Math.min(1.2, Math.max(0.55, 1.6 / Math.max(1, fz))); // fewer, so a zoomed-out phone isn't snowed under
    for (let cy = Math.floor(wy0 / CELL); cy <= Math.floor(wy1 / CELL); cy++) {
      for (let cx = Math.floor(wx0 / CELL); cx <= Math.floor(wx1 / CELL); cx++) {
        const r = S.rng(((cx + 997) * 7919) ^ ((cy + 991) * 104729));
        const mid = riverAt((cx + 0.5) * CELL, (cy + 0.5) * CELL);
        const nTiny = Math.round((14 + 18 * mid) * dens), nSmall = Math.round((2.2 + 2 * mid) * dens + r());
        for (let n = 0; n < nTiny + nSmall; n++) {
          const wx = (cx + r()) * CELL, wy = (cy + r()) * CELL;
          const X = Math.round(fox + wx * fz), Y = Math.round(foy + wy * fz);
          const small = n >= nTiny;
          const col = STAR_COLS[(r() * (small && r() < 0.12 ? 5 : 4)) | 0];
          const bright = small && r() < 0.16;
          const a = small ? 0.5 + r() * 0.45 : 0.14 + r() * 0.3;
          if (X < 0 || Y < 0 || X >= V.w || Y >= V.h) continue;
          const s = [X, Y, a, col, bright ? 2 : 1];
          if (small && tw.length < 90 && r() < 0.5 && inOpen(wx, wy, 6)) tw.push({ x: X, y: Y, a, c: col, kind: s[4], ph: r() * 6.283, sp: 0.35 + r() * 0.9, last: -1 });
          else list.push(s);
        }
      }
    }
    // a few soft sparkles in open space
    const r = S.rng(4242);
    for (let tries = 0, made = 0; made < 9 && tries < 400; tries++) {
      const wx = wx0 + r() * (wx1 - wx0), wy = wy0 + r() * (wy1 - wy0);
      if (!inOpen(wx, wy, 14)) continue;
      const X = Math.round(fox + wx * fz), Y = Math.round(foy + wy * fz);
      if (X < 8 || Y < 8 || X >= V.w - 8 || Y >= V.h - 8) continue;
      tw.push({ x: X, y: Y, a: 0.85, c: r() < 0.3 ? '#fff2dc' : '#e8f0ff', kind: 3, ph: r() * 6.283, sp: 0.25 + r() * 0.4, last: -1 });
      made++;
    }
    stars.key = key; stars.list = list; stars.tw = tw;
    return stars;
  }
  /** Soft 4-point sparkle at device resolution (cached per size). */
  const sparkles = {};
  function sparkleSprite(dpr, col) {
    const key = dpr + col;
    if (sparkles[key]) return sparkles[key];
    const R = Math.round(3 + 2 * dpr), s = 2 * R + 1, c = mk(s, s), x2 = c.getContext('2d');
    const g = x2.createRadialGradient(R + 0.5, R + 0.5, 0, R + 0.5, R + 0.5, R);
    g.addColorStop(0, 'rgba(232,240,255,0.55)'); g.addColorStop(0.35, 'rgba(200,215,255,0.12)'); g.addColorStop(1, 'rgba(200,215,255,0)');
    x2.fillStyle = g; x2.fillRect(0, 0, s, s);
    x2.fillStyle = col;
    for (let k = 1; k <= R - 1; k++) { x2.globalAlpha = 0.75 * (1 - k / R); x2.fillRect(R + k, R, 1, 1); x2.fillRect(R - k, R, 1, 1); x2.fillRect(R, R + k, 1, 1); x2.fillRect(R, R - k, 1, 1); }
    x2.globalAlpha = 1; x2.fillStyle = '#ffffff'; x2.fillRect(R, R, 1, 1);
    return (sparkles[key] = c);
  }
  function drawStar(ctx, x, y, a, col, kind, dpr) {
    if (kind === 3) { const sp = sparkleSprite(dpr, col); const R = (sp.width - 1) / 2; ctx.globalAlpha = a; ctx.drawImage(sp, x - R, y - R); return; }
    ctx.fillStyle = col;
    ctx.globalAlpha = a;
    ctx.fillRect(x, y, 1, 1);
    if (kind === 2) {
      ctx.globalAlpha = a * 0.32;
      ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1); ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x, y + 1, 1, 1);
    }
  }

  /* ======================================================= RINGED PLANET
   * Under Clockspire's underside tip, in the gap between the two south islands.
   * Rendered per device pixel with 2x2 supersampling: banded, lit from the top
   * left, the ring passing behind and in front, with ring and planet shadows. */
  const PL = { cx: 604, cy: 686, R: 40, tilt: -0.3, squash: 0.3, r1: 1.38, r2: 2.18 };
  const LIGHT = (() => { const v = [-0.62, -0.55, 0.56]; const l = Math.hypot(v[0], v[1], v[2]); return v.map((a) => a / l); })();
  const BANDS = ['#cdb08e', '#b78f72', '#e0c9a8', '#a47d66', '#d6b996', '#c3a083', '#e6d3b6'].map(rgbOf);
  const RING_COL = rgbOf('#cfc2b0'), NIGHT_SIDE = rgbOf('#0b1220'), RIM_COL = rgbOf('#9fc4ff');
  function ringAt(r) {
    if (r < PL.r1 || r > PL.r2) return null;
    if (r < 1.52) return { a: 0.32, v: 0.62 };
    if (r > 1.8 && r < 1.87) return { a: 0.06, v: 0.5 };
    if (r < 1.8) return { a: 0.88, v: 0.86 + 0.06 * Math.sin(r * 38) };
    return { a: 0.7 * (1 - smooth(PL.r2 - 0.08, PL.r2, r)), v: 0.66 + 0.05 * Math.sin(r * 50) };
  }
  const planet = { key: '', c: null, ox: 0, oy: 0 };
  function buildPlanet(V) {
    const R = PL.R * V.fit.z;
    const key = R.toFixed(2);
    if (planet.key === key) return planet;
    const hx = Math.ceil(PL.r2 * R) + 3, hy = Math.ceil(R) + 3, cw = hx * 2, ch = hy * 2;
    const c = mk(cw, ch), x2 = c.getContext('2d'), img = x2.createImageData(cw, ch), d = img.data;
    const ct = Math.cos(PL.tilt), st = Math.sin(PL.tilt), sq = PL.squash, sz = Math.sqrt(1 - sq * sq);
    const e1 = [ct, st, 0], e2 = [-st * sq, ct * sq, sz];
    const nr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const L = LIGHT, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const SS = [0.25, 0.75];
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      let pr = 0, pg = 0, pb = 0, pa = 0;
      for (const sy of SS) for (const sx of SS) {
        const x = i + sx - hx, y = j + sy - hy;
        const a = x * ct + y * st, b = (-x * st + y * ct) / sq;
        const rr = Math.sqrt(a * a + b * b) / R;
        const ring = ringAt(rr);
        const P = [a * e1[0] + b * e2[0], a * e1[1] + b * e2[1], a * e1[2] + b * e2[2]];
        const front = P[2] > 0;
        const inPlanet = x * x + y * y <= R * R;
        let col = null, al = 0;
        if (inPlanet) {
          const z = Math.sqrt(Math.max(0, R * R - x * x - y * y));
          const N = [x / R, y / R, z / R];
          let lam = dot(N, L);
          const den = dot(nr, L);
          if (Math.abs(den) > 1e-4) {
            const s = -dot(nr, [x, y, z]) / den;
            if (s > 0) { const Q = [x + L[0] * s, y + L[1] * s, z + L[2] * s]; const rq = ringAt(Math.sqrt(dot(Q, Q)) / R); if (rq) lam *= 1 - 0.7 * rq.a; }
          }
          const lat = dot(N, nr) + (vnoise(N[0] * 5 + N[2] * 3, N[1] * 5, 91) - 0.5) * 0.08 + 0.025 * Math.sin(dot(N, e1) * 8);
          const bi = (lat + 1) * 0.5 * (BANDS.length * 2 - 0.001);
          const b0 = BANDS[Math.floor(bi) % BANDS.length], b1 = BANDS[(Math.floor(bi) + 1) % BANDS.length];
          const band = mixRgb(b0, b1, smooth(0.7, 1, bi % 1));
          const shade = 0.07 + 0.93 * Math.pow(Math.max(0, lam), 0.85);
          col = mixRgb(NIGHT_SIDE, band, shade);
          const rim = Math.sqrt(x * x + y * y) / R;
          if (rim > 0.9) col = mixRgb(col, RIM_COL, smooth(0.9, 1, rim) * 0.35 * smooth(0, 0.6, lam));
          al = 1;
        }
        if (ring && (front || !inPlanet)) {
          const pl = dot(P, L), disc = pl * pl - (dot(P, P) - R * R);
          const shadow = disc > 0 && -pl - Math.sqrt(disc) > 0;
          let v = ring.v - (a / (PL.r2 * R)) * 0.12;
          if (shadow) v *= 0.22;
          const rc = [RING_COL[0] * v, RING_COL[1] * v, RING_COL[2] * v];
          if (col) col = mixRgb(col, rc, ring.a);
          else { col = rc; al = ring.a; }
        }
        if (!col) continue;
        pr += col[0] * al; pg += col[1] * al; pb += col[2] * al; pa += al;
      }
      if (pa <= 0) continue;
      const o = (j * cw + i) * 4;
      d[o] = pr / pa; d[o + 1] = pg / pa; d[o + 2] = pb / pa; d[o + 3] = Math.round((pa / 4) * 255);
    }
    x2.putImageData(img, 0, 0);
    planet.key = key; planet.c = c; planet.ox = hx; planet.oy = hy;
    return planet;
  }

  /* ========================================================= THE MOON
   * Phase from S.now(): synodic month 29.530588853 d, reference new moon
   * 2000-01-06 18:14 UTC. Northern-hemisphere view (waxing lit on the right).
   * Right of the clock spire, in the open gap above Clockspire's NE corner. */
  const SYNODIC = 29.530588853, NEW_REF = Date.UTC(2000, 0, 6, 18, 14);
  function moonInfo(date) {
    const days = (date.getTime() - NEW_REF) / 864e5;
    const age = (((days / SYNODIC) % 1) + 1) % 1;
    const illumination = (1 - Math.cos(age * Math.PI * 2)) / 2;
    const waxing = age < 0.5;
    const names = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
    const name = names[Math.floor((age * 8 + 0.5) % 8)];
    return { age, days: age * SYNODIC, illumination, waxing, name };
  }
  const MOON = { x: 735, y: 165, R: 12 };
  const moon = { key: '', lit: null, dark: null, halo: null, R: 0, pad: 0 };
  function buildMoon(V, info) {
    const R = Math.max(7, MOON.R * V.fit.z);
    const key = R.toFixed(2) + '|' + Math.round(info.age * 240);
    if (moon.key === key) return moon;
    const pad = 2, size = Math.ceil(2 * R + 2 * pad), c0 = size / 2;
    const lit = mk(size, size), dark = mk(size, size);
    const li = lit.getContext('2d').createImageData(size, size), di = dark.getContext('2d').createImageData(size, size);
    // keep at least a 2.4 px lit limb, so a new moon is a thin bright crescent, never a dull disc
    let th = info.age * Math.PI * 2;
    const minTh = Math.acos(Math.max(-1, 1 - 2.4 / R));
    if (th < minTh) th = minTh; else if (th > Math.PI * 2 - minTh) th = Math.PI * 2 - minTh;
    const Lx = Math.sin(th), Lz = -Math.cos(th);
    const HI = rgbOf('#f4f6fa'), MID = rgbOf('#cdd5e2'), MAR = rgbOf('#a3aec0'), ES = rgbOf('#1a2640');
    const SS = [0.25, 0.75];
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      let lr = 0, lg = 0, lb = 0, la = 0, da = 0;
      for (const sy of SS) for (const sx of SS) {
        const x = (i + sx - c0) / R, y = (j + sy - c0) / R, r2 = x * x + y * y;
        if (r2 > 1) continue;
        const z = Math.sqrt(1 - r2);
        const k = smooth(-0.07, 0.09, x * Lx + z * Lz);       // soft terminator
        const mar = smooth(0.5, 0.72, fbm(x * 1.8 + 3, y * 1.8 + 1, 61, 3));
        const albedo = mixRgb(mixRgb(MID, HI, smooth(0.2, 1, z)), MAR, mar * 0.55);
        const limb = 0.8 + 0.2 * z;
        lr += albedo[0] * limb * k; lg += albedo[1] * limb * k; lb += albedo[2] * limb * k; la += k;
        da += 1 - k;
      }
      const o = (j * size + i) * 4;
      if (la > 0) { li.data[o] = lr / la; li.data[o + 1] = lg / la; li.data[o + 2] = lb / la; li.data[o + 3] = Math.round((la / 4) * 255); }
      if (da > 0) { di.data[o] = ES[0]; di.data[o + 1] = ES[1]; di.data[o + 2] = ES[2]; di.data[o + 3] = Math.round((da / 4) * 255); }
    }
    lit.getContext('2d').putImageData(li, 0, 0);
    dark.getContext('2d').putImageData(di, 0, 0);
    // a soft halo, drawn smooth at screen resolution
    const hr = Math.ceil(R * 3.4), halo = mk(hr * 2, hr * 2), hx = halo.getContext('2d');
    const g = hx.createRadialGradient(hr, hr, R * 0.9, hr, hr, hr);
    g.addColorStop(0, 'rgba(205,220,255,0.16)'); g.addColorStop(0.4, 'rgba(190,210,255,0.05)'); g.addColorStop(1, 'rgba(190,210,255,0)');
    hx.fillStyle = g; hx.fillRect(0, 0, hr * 2, hr * 2);
    Object.assign(moon, { key, lit, dark, halo, R, pad, size });
    return moon;
  }

  /* ========================================================= COMPOSE */
  let base = null, baseKey = '', field = null, fieldKey = '';
  let moonNow = moonInfo(S.now()), moonCheck = -999;
  function composeBase(V) {
    if (!base || base.width !== V.w || base.height !== V.h) base = mk(V.w, V.h);
    const bx = base.getContext('2d');
    const dq = Math.round(sky.day * 24) / 24, tq = Math.round(sky.twi * 24) / 24;
    const fk = V.fitVersion + '|' + V.w + 'x' + V.h + '|' + dq + '|' + tq + '|' + sky.kind;
    if (fk !== fieldKey) { field = buildField(V, dq, tq, sky.kind); fieldKey = fk; }
    bx.setTransform(1, 0, 0, 1, 0, 0);
    bx.globalAlpha = 1; bx.globalCompositeOperation = 'source-over';
    bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = 'low';
    bx.drawImage(field, 0, 0, field.width, field.height, 0, 0, field.width * FIELD_STEP, field.height * FIELD_STEP);
    bx.fillStyle = noisePattern(bx); bx.fillRect(0, 0, V.w, V.h);
    // stars fade a little by day (space never gets bright here)
    const vis = 1 - 0.55 * dq;
    const st = buildStars(V);
    for (const s of st.list) drawStar(bx, s[0], s[1], s[2] * vis, s[3], s[4], V.dpr);
    bx.globalAlpha = 1;
    const fz = V.fit.z;
    const pl = buildPlanet(V);
    bx.drawImage(pl.c, Math.round(V.fit.ox + PL.cx * fz) - pl.ox, Math.round(V.fit.oy + PL.cy * fz) - pl.oy);
    const m = buildMoon(V, moonNow);
    const mx = Math.round(V.fit.ox + MOON.x * fz), my = Math.round(V.fit.oy + MOON.y * fz);
    const hk = Math.round(sky.night * 10) / 10 * (0.3 + 0.7 * moonNow.illumination);
    if (hk > 0.03) { bx.globalAlpha = hk; bx.drawImage(m.halo, mx - m.halo.width / 2, my - m.halo.height / 2); }
    bx.globalAlpha = 0.9 * (1 - dq); if (bx.globalAlpha > 0.01) bx.drawImage(m.dark, mx - m.size / 2, my - m.size / 2);
    bx.globalAlpha = 1 - 0.3 * dq; bx.drawImage(m.lit, mx - m.size / 2, my - m.size / 2);
    bx.globalAlpha = 1;
    for (const s of st.tw) s.last = -1;
  }
  function backdropKey(V) {
    return V.fitVersion + '|' + V.w + 'x' + V.h + '|' + Math.round(sky.day * 24) + '|' + Math.round(sky.twi * 24) + '|' + sky.kind + '|' + Math.round(sky.night * 10) + '|' + moon.key;
  }

  /* ======================================================= SHOOTING STARS */
  let streak = null;
  function streakSprite() {
    if (streak) return streak;
    const w = 128, h = 5, c = mk(w, h), x2 = c.getContext('2d');
    const g = x2.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(200,215,255,0)'); g.addColorStop(0.7, 'rgba(220,232,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0.95)');
    x2.fillStyle = g; x2.fillRect(0, 2, w, 1);
    x2.globalAlpha = 0.35; x2.fillRect(w * 0.55, 1, w * 0.45, 3);
    x2.globalAlpha = 1; x2.fillStyle = '#ffffff'; x2.fillRect(w - 2, 1, 2, 3);
    return (streak = c);
  }
  const shot = { s: null, box: null, next: -1 };
  function scheduleShot(t) { shot.next = t + 35 + Math.random() * 45; }
  function spawnShot(V) {
    if (!V || !V.w) return false;
    const fz = V.fit.z;
    for (let tries = 0; tries < 30; tries++) {
      const X = Math.random() * V.w, Y = Math.random() * V.h * 0.7;
      const wx = (X - V.fit.ox) / fz, wy = (Y - V.fit.oy) / fz;
      if (!inOpen(wx, wy, 8)) continue;
      const left = Math.random() < 0.5, ang = (left ? Math.PI - 0.45 : 0.45) + (Math.random() - 0.5) * 0.3;
      const sp = (420 + Math.random() * 260) * V.dpr;
      shot.s = { x: X, y: Y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, age: 0, life: 0.55 + Math.random() * 0.35, len: (60 + Math.random() * 40) * V.dpr };
      return true;
    }
    return false;
  }
  function restore(ctx, b) {
    if (!b || !base) return;
    const x = Math.max(0, b.x | 0), y = Math.max(0, b.y | 0), w = Math.min(base.width - x, Math.ceil(b.w) + 1), h = Math.min(base.height - y, Math.ceil(b.h) + 1);
    if (w > 0 && h > 0) ctx.drawImage(base, x, y, w, h, x, y, w, h);
  }

  /* ========================================================= THE LAYER */
  let lastKey = '';
  let frameRef = null;
  S.registerScreen(-100, (ctx, V) => {
    frameRef = V;
    updateSky();
    updateSpaceColor();
    if (S.frame - moonCheck > 300 || moonCheck < 0) { moonCheck = S.frame; moonNow = moonInfo(S.now()); buildMoon(V, moonNow); }
    const key = backdropKey(V);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    if (V.full || key !== lastKey || !base) {
      composeBase(V);
      lastKey = backdropKey(V);
      ctx.globalAlpha = 1;
      ctx.drawImage(base, 0, 0);
      shot.box = null;
    }
    // twinkles: repaint a star only when its brightness has moved a step
    const vis = 1 - 0.55 * Math.round(sky.day * 24) / 24;
    const tt = RM ? V.t * 0.25 : V.t;
    for (const s of stars.tw) {
      const w = Math.sin(tt * s.sp + s.ph) * 0.7 + Math.sin(tt * s.sp * 2.3 + s.ph * 1.7) * 0.3;
      const a = Math.round(s.a * vis * (0.62 + 0.38 * w) * 32) / 32;
      if (a === s.last) continue;
      s.last = a;
      const R = s.kind === 3 ? Math.round(3 + 2 * V.dpr) : s.kind === 2 ? 1 : 0;
      ctx.globalAlpha = 1;
      ctx.drawImage(base, s.x - R, s.y - R, 2 * R + 1, 2 * R + 1, s.x - R, s.y - R, 2 * R + 1, 2 * R + 1);
      drawStar(ctx, s.x, s.y, a, s.c, s.kind, V.dpr);
    }
    ctx.globalAlpha = 1;
    // a rare shooting star (never by day or with reduced motion)
    if (shot.next < 0) scheduleShot(V.t - 20);
    if (!shot.s && V.t >= shot.next) { if (!RM && sky.night > 0.5 && !S.debug.paused) spawnShot(V); scheduleShot(V.t); }
    if (shot.box) { restore(ctx, shot.box); shot.box = null; }
    const s = shot.s;
    if (s) {
      s.age += V.dt || 0;
      if (s.age > s.life) shot.s = null;
      else {
        const f = s.age / s.life, fade = Math.min(1, f * 5, (1 - f) * 3) * (1 - sky.day);
        const hx = s.x + s.vx * s.age, hy = s.y + s.vy * s.age, sp = Math.hypot(s.vx, s.vy), ux = s.vx / sp, uy = s.vy / sp;
        const len = s.len * Math.min(1, f * 3);
        const spr = streakSprite();
        ctx.globalAlpha = fade;
        ctx.setTransform(ux, uy, -uy, ux, hx, hy);
        ctx.drawImage(spr, -len, -spr.height / 2, len, spr.height);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        const tx = hx - ux * len, ty = hy - uy * len, m = 4;
        shot.box = { x: Math.min(hx, tx) - m, y: Math.min(hy, ty) - m, w: Math.abs(hx - tx) + 2 * m, h: Math.abs(hy - ty) + 2 * m };
      }
    }
  });

  /* ======================================================= DRIFTING ISLETS
   * Tiny floating rocks: grass cap, rock underside tapering to a point, lit
   * from the top-left, tinted toward space by distance (fd 0..1). */
  function isletSprite(w, seed, fd, season) {
    const rnd = S.rng(seed);
    const capH = Math.max(2, Math.round(w / 5)), depth = Math.round(w * (0.55 + rnd() * 0.25));
    const tree = w >= 13 ? 6 : 0;
    const cw = w + 4, ch = capH + depth + 4 + tree;
    const grid = new Int8Array(cw * ch).fill(-1); // -1 empty, else palette index
    const cx = (cw - 1) / 2;
    // palette: 0 outline, 1-3 grass (light..dark), 4-7 rock (light..dark), 8 crystal, 9-11 leaves
    const g = season === 'winter' ? ['#f4f8fb', '#d6e2ea', '#aebfcc'] :
      [S.color.shade(S.PAL.grass[season] || S.PAL.grass.autumn, 0.2), S.PAL.grass[season] || S.PAL.grass.autumn, S.PAL.grassDark[season] || S.PAL.grassDark.autumn];
    const lf = S.PAL.leaf[season] || S.PAL.leaf.autumn;
    const pal = ['#070b16', g[0], g[1], g[2], '#9a98a2', '#76737f', '#53505f', '#383645', '#9be8ff', S.color.shade(lf, 0.25), lf, S.color.shade(lf, -0.3)];
    const tint = rgbOf('#0e1830');
    const P = pal.map((h, i) => (i === 0 ? h : hexRgb(mixRgb(rgbOf(h), tint, fd))));
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
    if (w >= 12) { const x = Math.round(cx + 1), y = capH + 2 + tree + Math.round(depth * 0.3); if (grid[y * cw + x] >= 0) grid[y * cw + x] = 8; }
    if (tree) {
      const tx = Math.round(cx - w * 0.15), b0 = 2 + tree;
      grid[(b0 - 1) * cw + tx] = 7; grid[(b0 - 2) * cw + tx] = 7;
      const crown = [[0, -6, 9], [-1, -5, 9], [0, -5, 10], [1, -5, 10], [-1, -4, 9], [0, -4, 10], [1, -4, 11], [-1, -3, 10], [0, -3, 11], [1, -3, 11]];
      for (const [dx, dy, k] of crown) grid[(b0 + dy) * cw + tx + dx] = k;
    }
    const c = mk(cw, ch), x2 = c.getContext('2d');
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      let idx = grid[y * cw + x];
      if (idx < 0) {
        const n = (xx, yy) => xx >= 0 && yy >= 0 && xx < cw && yy < ch && grid[yy * cw + xx] > 0;
        if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) idx = 0; else continue;
      }
      x2.fillStyle = P[idx]; x2.fillRect(x, y, 1, 1);
    }
    return c;
  }
  /* Two islets: one in the wide gap between the north and south islands, one
   * in the narrow gap above Clockspire. They fade in and out 64 px inside the
   * world edge, so nothing is ever cut off where the world buffer ends. */
  const DRIFT = [
    { y: 404, w: 16, sp: 1.6, x0: 150, fd: 0.32, seed: 71 },
    { y: 452, w: 12, sp: -1.1, x0: 1010, fd: 0.42, seed: 83 },
  ];
  const EDGE = 64;
  let driftSeason = '';
  S.registerDynamic(40, (ctx, t) => {
    const season = S.time.season || 'autumn';
    if (season !== driftSeason) { driftSeason = season; for (const d of DRIFT) d.sprite = isletSprite(d.w, d.seed, d.fd, season); }
    const span = W - 2 * EDGE + 60;
    for (const d of DRIFT) {
      const tt = RM ? 0 : t;
      const x = EDGE - 30 + ((((d.x0 + tt * d.sp) % span) + span) % span);
      const a = smooth(EDGE - 30, EDGE + 40, x) * smooth(W - EDGE + 30, W - EDGE - 40, x);
      if (a < 0.02) continue;
      const y = d.y + Math.round(Math.sin(tt * 0.5 + d.seed) * 1.5);
      ctx.globalAlpha = a;
      ctx.drawImage(d.sprite, Math.round(x - d.sprite.width / 2), Math.round(y - d.sprite.height / 2));
    }
    ctx.globalAlpha = 1;
  });

  /* =============================================================== API */
  S.space = {
    moon: () => moonInfo(S.now()),
    get moonPos() { return { x: MOON.x, y: MOON.y }; },
    /** Launch a shooting star now (handy for demos and previews). */
    shoot: () => spawnShot(frameRef),
    /** Repaint the whole backdrop on the next frame. */
    redraw: () => { lastKey = ''; },
  };

  updateSky();
  updateSpaceColor();
})();
