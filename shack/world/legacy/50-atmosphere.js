/* The Shack: atmosphere. Sky light, night darkness with light holes, cloud
 * shadows, season particles and per-biome weather.
 *
 * Owns (see WORLD_SPEC.md):
 *   dyn 500  drifting cloud shadows by day, per-biome weather from
 *            S.status[biome].level (idle mist, warn grey overcast, critical
 *            darker storm overcast; the rain itself is drawn at 600), season particles (autumn leaves, winter snow,
 *            spring petals)
 *   dyn 600  sky tint and darkness driven by S.time.light (deep-blue night,
 *            warm dusk, pink dawn) with dithered light holes for every S.lights
 *            entry; then, over the dark: rain streaks and splashes (dimmed and
 *            cooled at night so they stay readable), lightning flashes confined
 *            to the stormy region, summer-night fireflies
 *
 * Cost: the darkness is three cached native-res canvases (multiply tint, blue
 * lift, light bloom) that are only rebuilt when the sky level, a light's
 * flicker step or a light's on() state changes. Weather shade/mist are cached
 * per biome and redrawn only when their drift offset moves a whole pixel.
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S) return;

  const W = S.W, H = S.H, TILE = S.TILE;
  const CO = S.color;
  const RM = !!S.reducedMotion;
  const DBG = S.debug || {};
  const PART = RM ? 0.3 : 1;          // particle count multiplier
  const SPD = RM ? 0.6 : 1;           // particle speed multiplier

  /* ------------------------------------------------------------ helpers */
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (e0, e1, v) => { const x = clamp01((v - e0) / (e1 - e0)); return x * x * (3 - 2 * x); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
  const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bayer = (x, y) => (B4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
  /** Ordered-dither quantise v (0..1) to `levels` steps at pixel x,y. */
  const dq = (v, levels, x, y) => { const s = v * levels; let b = Math.floor(s); if (s - b > bayer(x, y)) b++; return (b > levels ? levels : b) / levels; };
  const RGBC = {};
  const rgb = (h) => RGBC[h] || (RGBC[h] = CO.hexToRgb(h));
  const rgba = (h, a) => { const c = rgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')'; };

  /** Value noise; optional periods make it tile (for scrolling textures). */
  function vnoise(x, y, seed, px, py) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const wx = (a) => (px ? ((a % px) + px) % px : a), wy = (a) => (py ? ((a % py) + py) % py : a);
    const x0 = wx(xi), x1 = wx(xi + 1), y0 = wy(yi), y1 = wy(yi + 1);
    const a = S.hash(x0, y0, seed), b = S.hash(x1, y0, seed), c = S.hash(x0, y1, seed), d = S.hash(x1, y1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /* Optional profiling: SHACK_DEBUG.atmoProfile = true collects ms per layer. */
  const prof = DBG.atmoProfile ? (DBG.atmoStats = { w500: 0, w600: 0, frames: 0, rebuilds: 0 }) : null;

  /* ================================================================ SKY
   * Keyframes by S.time.light (1 = day, 0 = night): [light, multiply tint,
   * lift colour, lift alpha]. The multiply darkens and tints; the lift lays a
   * thin deep-blue veil over it so night reads blue, not black.
   */
  const NIGHT = [0, '#56619e', '#0d1440', 0.3];
  const SKY = {
    dusk: [[1, '#ffffff', '#ff9a4a', 0], [0.8, '#ffe2b6', '#ff9a4a', 0.04], [0.55, '#f2a684', '#ff6a4a', 0.08],
           [0.32, '#a8869e', '#6a3a7a', 0.12], [0.12, '#6872aa', '#1c2058', 0.22], NIGHT],
    dawn: [[1, '#ffffff', '#ffb2a8', 0], [0.8, '#ffe2d8', '#ffa8b0', 0.05], [0.55, '#f4a4b8', '#ff86b4', 0.1],
           [0.32, '#a890c8', '#6a4aa8', 0.14], [0.12, '#6872aa', '#1c2058', 0.22], NIGHT],
  };
  function skyNow() {
    const T = S.time;
    const L = clamp01(T.light == null ? 1 : T.light), h = T.hours || 12;
    const dawn = h < 12;
    let mul, lift, la;
    if (L >= 1) {
      // Golden afternoon before dusk, soft peach morning after dawn.
      const g = dawn ? 1 - smooth(T.sunrise + 0.75, T.sunrise + 1.75, h) : smooth(T.sunset - 2.25, T.sunset - 0.75, h);
      mul = g > 0.01 ? CO.mix('#ffffff', dawn ? '#ffeede' : '#ffe6c0', g * 0.85) : '#ffffff';
      lift = '#000000'; la = 0;
    } else {
      const K = dawn ? SKY.dawn : SKY.dusk;
      let i = 0;
      while (i < K.length - 2 && L < K[i + 1][0]) i++;
      const a = K[i], b = K[i + 1];
      const f = clamp01((a[0] - L) / (a[0] - b[0]));
      mul = CO.mix(a[1], b[1], f); lift = CO.mix(a[2], b[2], f); la = lerp(a[3], b[3], f);
    }
    // nightOnly lamps come on through dusk and are full by deep twilight.
    const lampK = smooth(0.15, 0.85, 1 - L);
    return { L, n: 1 - L, mul, lift, la, lampK };
  }

  /* ============================================================ LIGHTS
   * Stamps are dithered radial alpha masks. The dither is world-aligned (the
   * Bayer phase follows the stamp's top-left), so overlapping lights share
   * one pattern instead of fighting.
   */
  const stampCache = new Map();
  function stampMask(kind, r, ox, oy) {
    const key = kind + r + '|' + (ox & 3) + (oy & 3);
    let c = stampCache.get(key);
    if (c) return c;
    const s = 2 * r + 1;
    c = mk(s, s);
    const x = c.getContext('2d'), img = x.createImageData(s, s), d = img.data;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const dd = Math.hypot(i - r, j - r) / (r + 0.5);
      if (dd >= 1) continue;
      let f;
      if (kind === 'g') { f = 1 - dd; f = f * f * f; }          // bloom: tight bright core
      else { f = 1 - dd * dd; f *= f; }                         // light pool: soft wide falloff
      const q = dq(f, 6, i + ox, j + oy);
      if (q <= 0) continue;
      const k = (j * s + i) * 4;
      d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = Math.round(q * 255);
    }
    x.putImageData(img, 0, 0);
    stampCache.set(key, c);
    return c;
  }
  function stampColor(kind, r, ox, oy, color) {
    const key = kind + r + '|' + (ox & 3) + (oy & 3) + color;
    let c = stampCache.get(key);
    if (c) return c;
    const m = stampMask(kind, r, ox, oy);
    c = mk(m.width, m.height);
    const x = c.getContext('2d');
    x.drawImage(m, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    stampCache.set(key, c);
    return c;
  }
  const tintCache = {};
  const poolTint = (c) => tintCache[c] || (tintCache[c] = CO.mix(c, '#ffffff', 0.12));

  const mulC = mk(W, H), mulX = mulC.getContext('2d');
  const liftC = mk(W, H), liftX = liftC.getContext('2d');
  let lastSig = '', active = [];

  function lightLevel(l, sky, t) {
    if (typeof l.on === 'function') { let on = false; try { on = !!l.on(); } catch (e) { on = false; } if (!on) return 0; }
    let a = l.intensity == null ? 1 : +l.intensity || 0;
    if (l.nightOnly !== false) a *= sky.lampK;
    if (a < 0.02) return 0;
    const fl = l.flicker === true ? 0.16 : +l.flicker || 0;
    if (fl > 0 && !RM) {
      const q = Math.floor(t * 6) / 6, s = (l.x * 0.37 + l.y * 0.71) % 6.283;
      const w = 0.55 * Math.sin(q * 6.1 + s) + 0.3 * Math.sin(q * 13.3 + s * 2.1) + 0.15 * Math.sin(q * 23.9 + s * 3.7);
      a *= 1 - fl * (0.5 + 0.5 * w);
    }
    return a > 1 ? 1 : a;
  }

  function collectLights(sky, t) {
    active.length = 0;
    let sig = sky.mul + sky.lift + sky.la.toFixed(3);
    for (const l of S.lights) {
      if (!l || !isFinite(l.x) || !isFinite(l.y)) continue;
      const a = lightLevel(l, sky, t);
      if (a <= 0) continue;
      const qa = Math.round(a * 40);
      if (!qa) continue;
      const x = Math.round(l.x), y = Math.round(l.y), r = Math.max(3, Math.min(160, Math.round(+l.r || 24)));
      active.push({ x, y, r, a: qa / 40, color: l.color || '#ffd27a' });
      sig += '|' + x + ',' + y + ',' + r + ',' + qa;
    }
    return sig;
  }

  /* Two cached layers: `mul` (multiplied: sky tint with warm pools cut in) and
   * `veil` (source-over: thin night-blue veil with holes, plus a soft warm haze
   * around each lamp, which reads as bloom). */
  function rebuildDark(sky) {
    if (prof) prof.rebuilds++;
    mulX.globalCompositeOperation = 'source-over'; mulX.globalAlpha = 1;
    mulX.fillStyle = sky.mul; mulX.fillRect(0, 0, W, H);
    liftX.globalCompositeOperation = 'source-over'; liftX.globalAlpha = 1;
    liftX.clearRect(0, 0, W, H);
    const veil = sky.la > 0.002;
    if (veil) { liftX.fillStyle = rgba(sky.lift, sky.la); liftX.fillRect(0, 0, W, H); }
    // Pools replace the sky tint with the lamp's own warm colour (no blow-out where pools overlap).
    liftX.globalCompositeOperation = 'destination-out';
    for (const L of active) {
      const ox = L.x - L.r, oy = L.y - L.r;
      mulX.globalAlpha = L.a;
      mulX.drawImage(stampColor('p', L.r, ox, oy, poolTint(L.color)), ox, oy);
      if (veil) { liftX.globalAlpha = L.a; liftX.drawImage(stampMask('p', L.r, ox, oy), ox, oy); }
    }
    liftX.globalCompositeOperation = 'source-over';
    const bloomK = 0.12 + 0.3 * sky.n;
    for (const L of active) {
      const gr = Math.max(3, Math.round(L.r * 0.45)), gx = L.x - gr, gy = L.y - gr;
      liftX.globalAlpha = L.a * bloomK;
      liftX.drawImage(stampColor('g', gr, gx, gy, L.color), gx, gy);
    }
    liftX.globalAlpha = 1;
  }

  /* ========================================================= WEATHER
   * One record per agent biome, built lazily the first time it needs weather.
   * The mask is the region with an organic, noise-wobbled, dithered edge;
   * map borders count as "far away" so weather runs right to the edge there.
   */
  const TEX = {};
  /** Tileable overcast texture, drawn with 'multiply': cool grey with darker billows. */
  function cloudTexture(kind) {
    if (TEX[kind]) return TEX[kind];
    const s = 256, c = mk(s, s), x = c.getContext('2d'), img = x.createImageData(s, s), d = img.data;
    const storm = kind === 'storm';
    const tones = (storm ? ['#848ca6', '#6a728e', '#545c79'] : ['#a9b1c5', '#959eb5', '#808aa4']).map(rgb);
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const n = vnoise(i / 32, j / 32, storm ? 31 : 21, 8, 8) * 0.62 + vnoise(i / 16, j / 16, storm ? 32 : 22, 16, 16) * 0.28 + vnoise(i / 8, j / 8, 23, 32, 32) * 0.1;
      const q = dq(smooth(0.3, 0.8, n), 2, i, j);
      const col = tones[Math.round(q * 2)];
      const k = (j * s + i) * 4;
      d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return (TEX[kind] = c);
  }
  /** Tileable mist: long horizontal wisps. */
  function mistTexture() {
    if (TEX.mist) return TEX.mist;
    const w = 256, h = 128, c = mk(w, h), x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data;
    const col = rgb('#e8f0f6');
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const n = vnoise(i / 64, j / 10, 41, 4, 13) * 0.65 + vnoise(i / 21.333, j / 6.4, 42, 12, 20) * 0.35;
      const v = smooth(0.42, 0.8, n);
      const a = dq(v, 4, i, j);
      if (!a) continue;
      const k = (j * w + i) * 4;
      d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = Math.round(a * 255);
    }
    x.putImageData(img, 0, 0);
    return (TEX.mist = c);
  }

  const WX = {};
  if (DBG.atmoProfile) DBG.atmoWX = WX;
  function wxFor(id) {
    if (WX[id]) return WX[id];
    const g = S.regions[id];
    const R = { x: g.x * TILE, y: g.y * TILE, w: g.w * TILE, h: g.h * TILE };
    const mval = new Float32Array(R.w * R.h);
    const maskC = mk(R.w, R.h), mx = maskC.getContext('2d'), img = mx.createImageData(R.w, R.h), d = img.data;
    const farL = R.x <= 0, farR = R.x + R.w >= W, farT = R.y <= 0, farB = R.y + R.h >= H;
    const seed = id.length * 17 + id.charCodeAt(0);
    for (let j = 0; j < R.h; j++) for (let i = 0; i < R.w; i++) {
      const gx = R.x + i, gy = R.y + j;
      const dd = Math.min(farL ? 1e4 : i, farR ? 1e4 : R.w - 1 - i, farT ? 1e4 : j, farB ? 1e4 : R.h - 1 - j);
      const wob = (vnoise(gx / 26, gy / 26, seed) - 0.5) * 26 + (vnoise(gx / 9, gy / 9, seed + 1) - 0.5) * 8;
      const m = clamp01((dd + wob - 2) / 30);
      mval[j * R.w + i] = m;
      if (m > bayer(gx, gy)) d[(j * R.w + i) * 4 + 3] = 255;
    }
    mx.putImageData(img, 0, 0);
    const flashC = mk(R.w, R.h), fx = flashC.getContext('2d');
    fx.drawImage(maskC, 0, 0); fx.globalCompositeOperation = 'source-in'; fx.fillStyle = '#9fb2e6'; fx.fillRect(0, 0, R.w, R.h);
    return (WX[id] = {
      id, R, mval, maskC, flashC,
      shadeC: mk(R.w, R.h), shadeKey: '', mistC: mk(R.w, R.h), mistKey: '',
      shade: 0, mist: 0, rain: 0, storm: 0,
      drops: [], splashes: [], acc: 0,
      nextBolt: 0, flashT: -1, bolt: null,
    });
  }
  const maskAt = (w, x, y) => {
    const i = (x - w.R.x) | 0, j = (y - w.R.y) | 0;
    return i < 0 || j < 0 || i >= w.R.w || j >= w.R.h ? 0 : w.mval[j * w.R.w + i];
  };

  /** Redraw a scrolling texture into a biome-sized canvas, masked to the region. */
  function paintMasked(w, canvas, tex, offX, offY) {
    const x = canvas.getContext('2d');
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, w.R.w, w.R.h);
    const tw = tex.width, th = tex.height;
    // World-anchored so the texture lines up with neighbours and does not jump.
    const sx = (((w.R.x + offX) % tw) + tw) % tw, sy = (((w.R.y + offY) % th) + th) % th;
    for (let y = -sy; y < w.R.h; y += th) for (let xx = -sx; xx < w.R.w; xx += tw) x.drawImage(tex, xx, y);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(w.maskC, 0, 0);
    x.globalCompositeOperation = 'source-over';
  }

  function spawnDrop(w, storm) {
    const R = w.R;
    for (let tries = 0; tries < 5; tries++) {
      const gx = R.x + Math.random() * R.w, gy = R.y + Math.random() * R.h;
      const m = maskAt(w, gx, gy);
      if (Math.random() > m * m) continue;
      const fall = storm ? rnd(46, 80) : rnd(36, 64);
      const slant = storm ? 0.42 : 0.24;
      w.drops.push({ gx: gx | 0, gy: gy | 0, fall, slant, len: storm ? 7 : 5, life: 0, dur: fall / ((storm ? 330 : 250) * SPD), heavy: storm && Math.random() < 0.35 });
      return;
    }
  }

  function makeBolt(w) {
    const R = w.R;
    let x = R.x + R.w * rnd(0.22, 0.78), y = R.y + (R.y <= 0 ? 0 : 6);
    let gy = 0;
    for (let k = 0; k < 8; k++) {
      gy = R.y + R.h * rnd(0.45, 0.85);
      if (maskAt(w, x, gy) > 0.6) break;
    }
    const pts = [[x | 0, y | 0]];
    while (y < gy) { y += rnd(5, 11); x += rnd(-7, 7); pts.push([x | 0, Math.min(gy, y) | 0]); }
    const branch = [];
    if (pts.length > 4) {
      let [bx, by] = pts[1 + ((Math.random() * (pts.length - 3)) | 0)];
      const dir = Math.random() < 0.5 ? -1 : 1;
      branch.push([bx, by]);
      for (let k = 0; k < 3; k++) { bx += dir * rnd(4, 9); by += rnd(4, 8); branch.push([bx | 0, by | 0]); }
    }
    return { pts, branch, gx: pts[pts.length - 1][0], gy: pts[pts.length - 1][1] };
  }
  /** Flash envelope: a double strike that decays. */
  const flashAlpha = (ft) => (ft < 0 ? 0 : ft < 0.07 ? 1 : ft < 0.14 ? 0.25 : ft < 0.24 ? 0.85 : Math.max(0, 0.85 * (1 - (ft - 0.24) / 0.5)));

  function updateWeather(dt, t) {
    for (const id of S.BIOMES) {
      const st = S.status && S.status[id];
      const level = (st && st.level) || 'ok';
      if (level === 'ok' && !WX[id]) continue;
      const w = wxFor(id);
      const tgt = {
        shade: level === 'critical' ? 1 : level === 'warn' ? 0.9 : 0,
        mist: level === 'idle' ? 1 : level === 'warn' ? 0.25 : 0,
        rain: level === 'critical' ? 1 : level === 'warn' ? 0.6 : 0,
        storm: level === 'critical' ? 1 : 0,
      };
      const k = Math.min(1, dt * 0.8);
      for (const p in tgt) w[p] += (tgt[p] - w[p]) * k;
      w.level = level;
      // Rain.
      const rate = (w.storm > 0.5 ? 520 : 420) * w.rain * PART * (w.R.w * w.R.h) / (384 * 240);
      w.acc += rate * dt;
      let n = 0;
      while (w.acc >= 1 && n++ < 40) { w.acc -= 1; spawnDrop(w, w.storm > 0.5); }
      if (w.acc > 4) w.acc = 0;
      for (let i = w.drops.length - 1; i >= 0; i--) {
        const d = w.drops[i];
        d.life += dt;
        if (d.life >= d.dur) {
          w.splashes.push({ x: d.gx, y: d.gy, age: 0, water: S.isWater((d.gx / TILE) | 0, (d.gy / TILE) | 0), big: d.heavy });
          w.drops[i] = w.drops[w.drops.length - 1]; w.drops.pop();
        }
      }
      for (let i = w.splashes.length - 1; i >= 0; i--) {
        const s = w.splashes[i];
        s.age += dt;
        if (s.age > (s.water ? 0.42 : 0.2)) { w.splashes[i] = w.splashes[w.splashes.length - 1]; w.splashes.pop(); }
      }
      // Lightning (never with reduced motion).
      if (!RM && level === 'critical' && w.storm > 0.8) {
        if (!w.nextBolt) w.nextBolt = t + rnd(1.5, 4);
        if (t >= w.nextBolt) { w.flashT = 0; w.bolt = makeBolt(w); w.nextBolt = t + rnd(5, 12); }
      }
      if (w.flashT >= 0) { w.flashT += dt; if (w.flashT > 0.8) { w.flashT = -1; w.bolt = null; } }
    }
  }

  function drawWeather(ctx, t) {
    for (const id of S.BIOMES) {
      const w = WX[id];
      if (!w) continue;
      const R = w.R;
      // Grey cloud shade, slowly drifting east.
      if (w.shade > 0.01) {
        const kind = w.level === 'critical' || (w.storm > 0.5) ? 'storm' : 'cloud';
        const ox = Math.floor(t * (kind === 'storm' ? 7 : 4) * SPD), oy = Math.floor(t * 1.2 * SPD);
        const key = kind + ox + ',' + oy;
        if (key !== w.shadeKey) { paintMasked(w, w.shadeC, cloudTexture(kind), -ox, -oy); w.shadeKey = key; }
        // Overcast: wash out colour first, then darken with the cool cloud tone.
        ctx.globalCompositeOperation = 'saturation';
        ctx.globalAlpha = Math.min(1, w.shade) * (kind === 'storm' ? 0.55 : 0.4);
        ctx.drawImage(w.shadeC, R.x, R.y);
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = Math.min(1, w.shade) * (1 - 0.2 * sky.n);   // the night already darkens
        ctx.drawImage(w.shadeC, R.x, R.y);
        ctx.globalCompositeOperation = 'source-over';
      }
      // Low mist bands.
      if (w.mist > 0.01) {
        const ox = Math.floor(t * 3 * SPD), oy = Math.round(Math.sin(t * 0.25) * 2);
        const key = ox + ',' + oy;
        if (key !== w.mistKey) { paintMasked(w, w.mistC, mistTexture(), -ox, oy); w.mistKey = key; }
        ctx.globalAlpha = w.mist * 0.38;
        ctx.drawImage(w.mistC, R.x, R.y);
      }
      ctx.globalAlpha = 1;
    }
  }

  /* Rain is drawn after the darkness (layer 600) so it stays readable at night;
   * by day the sky multiply is white, so this is identical to drawing it at 500.
   * At night it is dimmed and cooled instead of being multiplied to nothing. */
  function drawRain(ctx, sky) {
    const nk = 1 - 0.5 * sky.n;
    const cSplash = 'rgba(' + (214 - 60 * sky.n | 0) + ',' + (230 - 40 * sky.n | 0) + ',246,' + (0.75 * nk).toFixed(3) + ')';
    const cStreak = 'rgba(' + (196 - 70 * sky.n | 0) + ',' + (214 - 50 * sky.n | 0) + ',240,' + (0.62 * nk).toFixed(3) + ')';
    const cHead = 'rgba(' + (240 - 60 * sky.n | 0) + ',' + (247 - 40 * sky.n | 0) + ',255,' + (0.9 * nk).toFixed(3) + ')';
    for (const id of S.BIOMES) {
      const w = WX[id];
      if (!w) continue;
      // Splashes under the rain.
      if (w.splashes.length) {
        ctx.fillStyle = cSplash;
        for (const s of w.splashes) {
          const x = s.x, y = s.y;
          if (s.water) {
            const f = s.age < 0.1 ? 0 : s.age < 0.25 ? 1 : 2;
            if (f === 0) ctx.fillRect(x - 1, y, 3, 1);
            else if (f === 1) { ctx.fillRect(x - 1, y - 1, 3, 1); ctx.fillRect(x - 1, y + 1, 3, 1); ctx.fillRect(x - 2, y, 1, 1); ctx.fillRect(x + 2, y, 1, 1); }
            else { ctx.fillRect(x - 2, y - 1, 5, 1); ctx.fillRect(x - 2, y + 1, 5, 1); ctx.fillRect(x - 3, y, 1, 1); ctx.fillRect(x + 3, y, 1, 1); }
          } else {
            const f = s.age < 0.07 ? 0 : s.age < 0.14 ? 1 : 2;
            if (f === 0) ctx.fillRect(x - 1, y, 3, 1);
            else if (f === 1) { ctx.fillRect(x - 2, y - 1, 1, 1); ctx.fillRect(x + 2, y - 1, 1, 1); ctx.fillRect(x, y - 2, 1, 1); if (s.big) { ctx.fillRect(x - 1, y - 3, 1, 1); ctx.fillRect(x + 1, y - 3, 1, 1); } }
            else { ctx.fillRect(x - 3, y, 1, 1); ctx.fillRect(x + 3, y, 1, 1); }
          }
        }
      }
      // Rain streaks: a slanted 1px streak with a brighter head.
      if (w.drops.length) {
        ctx.fillStyle = cStreak;
        for (const d of w.drops) {
          const rem = d.fall * (1 - d.life / d.dur);
          const hx = Math.round(d.gx - rem * d.slant), hy = Math.round(d.gy - rem);
          const L = d.len, half = L >> 1;
          ctx.fillRect(hx - Math.round(L * d.slant), hy - L, 1, half);
          ctx.fillRect(hx - Math.round(half * d.slant), hy - L + half, 1, L - half - 1);
        }
        ctx.fillStyle = cHead;
        for (const d of w.drops) {
          const rem = d.fall * (1 - d.life / d.dur);
          ctx.fillRect(Math.round(d.gx - rem * d.slant), Math.round(d.gy - rem) - 1, 1, d.heavy ? 2 : 1);
        }
      }
    }
  }

  /* After the darkness: lightning lights up just that region. */
  function drawLightning(ctx) {
    for (const id of S.BIOMES) {
      const w = WX[id];
      if (!w || w.flashT < 0) continue;
      const a = flashAlpha(w.flashT);
      if (a > 0.01) {
        // 'screen' brightens what is there instead of fogging it over.
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = a * (0.28 + 0.22 * (1 - S.time.light));
        ctx.drawImage(w.flashC, w.R.x, w.R.y);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      const b = w.bolt;
      if (b && w.flashT < 0.3 && !(w.flashT > 0.07 && w.flashT < 0.14)) {
        const seg = (pts, glow, core) => {
          for (let i = 0; i + 1 < pts.length; i++) {
            const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
            S.px.line(ctx, x0 - 1, y0, x1 - 1, y1, glow); S.px.line(ctx, x0 + 1, y0, x1 + 1, y1, glow);
          }
          for (let i = 0; i + 1 < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; S.px.line(ctx, x0, y0, x1, y1, core); }
        };
        seg(b.branch, 'rgba(150,180,255,0.5)', '#dfe8ff');
        seg(b.pts, 'rgba(170,196,255,0.75)', '#fffbe8');
        // Ground strike spark.
        ctx.fillStyle = '#fffbe8';
        ctx.fillRect(b.gx - 2, b.gy, 5, 1); ctx.fillRect(b.gx - 1, b.gy - 1, 3, 1); ctx.fillRect(b.gx, b.gy + 1, 1, 1);
      }
    }
  }

  /* ==================================================== CLOUD SHADOWS */
  function cloudSprite(seed) {
    const r = S.rng(seed);
    const cw = 150 + ((r() * 90) | 0), ch = 64 + ((r() * 40) | 0);
    const blobs = [];
    const nb = 5 + ((r() * 4) | 0);
    for (let i = 0; i < nb; i++) {
      const t = i / (nb - 1);
      blobs.push([cw * (0.16 + 0.68 * t) + (r() - 0.5) * 14, ch * (0.5 + (r() - 0.5) * 0.3), Math.min(ch * 0.46, 18 + r() * 24) * (1 - Math.abs(t - 0.5) * 0.7)]);
    }
    const c = mk(cw, ch), x = c.getContext('2d'), img = x.createImageData(cw, ch), d = img.data;
    const col = rgb('#aeb6d2');
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      let f = 0;
      for (const [bx, by, br] of blobs) { const q = 1 - Math.hypot((i - bx) * 0.85, j - by) / br; if (q > f) f = q; }
      if (f <= 0) continue;
      const wob = (vnoise(i / 7, j / 7, seed) - 0.5) * 0.25;
      const v = smooth(0, 0.45, f + wob);
      const a = dq(v, 3, i, j);
      if (!a) continue;
      const k = (j * cw + i) * 4;
      d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = Math.round(a * 255);
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  const CLOUDS = [];
  function initClouds() {
    const n = RM ? 3 : 6;
    for (let i = 0; i < n; i++) {
      const c = cloudSprite(101 + i * 7);
      CLOUDS.push({ c, x: (i / n) * (W + 300) - 200 + rnd(-40, 40), y: rnd(-30, H - 40), vx: rnd(5, 8) * SPD, vy: rnd(0.8, 1.8) * SPD });
    }
  }
  function drawClouds(ctx, dt, sky) {
    const k = smooth(0.35, 0.95, sky.L);
    for (const c of CLOUDS) {
      c.x += c.vx * dt; c.y += c.vy * dt;
      if (c.x > W + 10 || c.y > H + 10) { c.x = -c.c.width - rnd(0, 160); c.y = rnd(-c.c.height, H - 60); }
      if (k > 0.01) { ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = k * 0.8; ctx.drawImage(c.c, Math.round(c.x), Math.round(c.y)); }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /* =================================================== SEASON PARTICLES */
  // [main, dark, light] per leaf/petal colour.
  const LEAF = {
    autumn: [['#d4782f', '#8e4519', '#f2a256'], ['#e0a93a', '#9c6a1a', '#f6d06a'], ['#c4502a', '#7a2a16', '#e8784a'], ['#b98a3c', '#6e4c1c', '#dcb062']],
    spring: [['#f6b6cc', '#d27c9c', '#ffe4ee'], ['#ffd2e2', '#e09ab6', '#ffffff'], ['#fff0f5', '#e2aec2', '#ffffff']],
  };
  // Frames as [dx, dy, tone] (0 main, 1 dark, 2 light): tilted, edge-on, tilted back, lying flat.
  const LEAF_F = [
    [[1, 0, 0], [2, 0, 2], [0, 1, 0], [1, 1, 0], [2, 1, 1]],
    [[0, 0, 0], [1, 0, 2], [2, 0, 0], [3, 0, 1]],
    [[0, 0, 2], [1, 0, 0], [0, 1, 1], [1, 1, 0], [2, 1, 0]],
    [[1, 0, 2], [0, 1, 0], [1, 1, 0], [2, 1, 1], [3, 1, 1]],
  ];
  const PETAL_F = [[[0, 0, 2], [1, 0, 0], [1, 1, 1]], [[0, 0, 2], [1, 1, 0]], [[0, 0, 0], [0, 1, 1]], [[0, 0, 2], [1, 0, 0], [2, 0, 1]]];

  let leaves = [], leafSeason = '';
  function spawnLeaf(p, season, initial) {
    const cols = LEAF[season];
    p.x = rnd(-20, W);
    p.y = initial ? rnd(-20, H - 40) : rnd(-20, H - 80);
    p.gy = p.y + rnd(30, 140);
    p.vy = (season === 'spring' ? rnd(8, 14) : rnd(12, 22)) * SPD;
    p.ph = rnd(0, 6.28); p.sw = rnd(1.2, 2.4); p.amp = season === 'spring' ? rnd(8, 16) : rnd(5, 11);
    p.col = cols[(Math.random() * cols.length) | 0];
    p.age = initial ? rnd(0, 1) : 0; p.rest = -1; p.restDur = rnd(1.5, 4);
    return p;
  }
  function updateLeaves(dt, t, season, wind) {
    if (season !== leafSeason) {
      leafSeason = season;
      const n = Math.round((season === 'autumn' ? 84 : season === 'spring' ? 80 : 0) * PART);
      leaves = [];
      for (let i = 0; i < n; i++) leaves.push(spawnLeaf({}, season, true));
    }
    for (const p of leaves) {
      p.age += dt;
      if (p.rest >= 0) {
        p.rest += dt;
        if (p.water) { p.x += 4 * dt; p.y += 2 * dt; }
        if (p.rest > (p.water ? 1.6 : p.restDur)) spawnLeaf(p, season, false);
        continue;
      }
      p.y += p.vy * dt;
      p.x += (wind + Math.cos(t * p.sw + p.ph) * p.amp) * dt;
      if (p.y >= p.gy) { p.y = p.gy; p.rest = 0; p.water = S.isWater((p.x / TILE) | 0, (p.y / TILE) | 0); }
    }
  }
  function drawLeaves(ctx, t, season) {
    const frames = season === 'spring' ? PETAL_F : LEAF_F;
    for (const p of leaves) {
      let a = Math.min(1, p.age / 0.5);
      let f;
      if (p.rest >= 0) { f = 3; const dur = p.water ? 1.6 : p.restDur; a *= 1 - smooth(dur - 0.8, dur, p.rest); }
      else { const s = Math.sin(t * p.sw * 2.2 + p.ph); f = s > 0.45 ? 0 : s < -0.45 ? 2 : 1; }
      if (a <= 0.02) continue;
      ctx.globalAlpha = a;
      const x = Math.round(p.x), y = Math.round(p.y);
      // A soft 1px shadow beneath falling leaves sells the height.
      if (p.rest < 0 && season === 'autumn') { ctx.fillStyle = 'rgba(20,16,30,0.18)'; const h = Math.min(6, (p.gy - p.y) * 0.08) | 0; ctx.fillRect(x + 1 + h, y + 3 + h, 2, 1); }
      for (const [dx, dy, tone] of frames[f]) { ctx.fillStyle = p.col[tone]; ctx.fillRect(x + dx, y + dy, 1, 1); }
    }
    ctx.globalAlpha = 1;
  }

  let flakes = [];
  function initSnow() {
    flakes = [];
    const n = Math.round(170 * PART);
    for (let i = 0; i < n; i++) {
      const z = Math.random();
      flakes.push({ x: rnd(0, W), y: rnd(0, H), z, vy: (8 + z * 16) * SPD, ph: rnd(0, 6.28), sw: rnd(0.6, 1.6), amp: rnd(4, 10), sz: z > 0.86 ? 3 : z > 0.5 ? 2 : 1 });
    }
  }
  function updateSnow(dt, t, wind) {
    if (!flakes.length) initSnow();
    for (const f of flakes) {
      f.y += f.vy * dt;
      f.x += (wind * (0.5 + f.z) + Math.sin(t * f.sw + f.ph) * f.amp) * dt;
      if (f.y > H + 3) { f.y = -3; f.x = rnd(-10, W); }
      if (f.x > W + 3) f.x -= W + 6; else if (f.x < -3) f.x += W + 6;
    }
  }
  function drawSnow(ctx) {
    ctx.fillStyle = 'rgba(244,248,251,0.75)';
    for (const f of flakes) if (f.sz === 1) ctx.fillRect(Math.round(f.x), Math.round(f.y), 1, 1);
    ctx.fillStyle = '#f4f8fb';
    for (const f of flakes) if (f.sz === 2) ctx.fillRect(Math.round(f.x), Math.round(f.y), 2, 2);
    for (const f of flakes) if (f.sz === 3) { const x = Math.round(f.x), y = Math.round(f.y); ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); }
    ctx.fillStyle = 'rgba(160,178,204,0.7)';
    for (const f of flakes) if (f.sz === 2) ctx.fillRect(Math.round(f.x) + 1, Math.round(f.y) + 1, 1, 1);
    ctx.fillStyle = '#ffffff';
    for (const f of flakes) if (f.sz === 3) ctx.fillRect(Math.round(f.x), Math.round(f.y), 1, 1);
  }

  /* Summer-night fireflies hover over grass, never water or roads. */
  let flies = [];
  function initFlies() {
    flies = [];
    const n = Math.round(46 * PART);
    const homes = ['meadow', 'riverside', 'savings', 'monastery', 'north', 'square'];
    let guard = 0;
    while (flies.length < n && guard++ < 2000) {
      const id = homes[(Math.random() * homes.length) | 0], g = S.regions[id];
      const tx = g.x + ((Math.random() * g.w) | 0), ty = g.y + ((Math.random() * g.h) | 0);
      if (S.isWater(tx, ty) || S.onRoad(tx, ty) || S.isWater(tx - 1, ty)) continue;
      flies.push({ ax: tx * TILE + rnd(0, 16), ay: ty * TILE + rnd(0, 16), ph: rnd(0, 6.28), sp: rnd(0.7, 1.4), rx: rnd(6, 16), ry: rnd(4, 9) });
    }
  }
  function drawFlies(ctx, t, k) {
    if (!flies.length) initFlies();
    const tt = t * SPD;
    for (const f of flies) {
      const b0 = Math.sin(tt * 1.3 * f.sp + f.ph);
      const b = b0 > 0 ? b0 * b0 : 0;
      const x = Math.round(f.ax + Math.sin(tt * 0.45 * f.sp + f.ph) * f.rx + Math.sin(tt * 1.1 + f.ph * 2) * 2);
      const y = Math.round(f.ay + Math.sin(tt * 0.7 * f.sp + f.ph * 1.7) * f.ry);
      const a = (0.25 + 0.75 * b) * k;
      if (a < 0.03) continue;
      ctx.globalAlpha = a * 0.3;
      ctx.fillStyle = '#c8f25a';
      ctx.fillRect(x - 2, y, 1, 1); ctx.fillRect(x + 2, y, 1, 1); ctx.fillRect(x, y - 2, 1, 1); ctx.fillRect(x, y + 2, 1, 1);
      ctx.globalAlpha = a * 0.65;
      ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fbffd0';
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  /* ============================================================ LAYERS */
  /** Visible world rect (native px, clamped), so full-screen composites skip off-camera pixels. */
  function viewRect() {
    const c = S.canvas;
    if (!c || !S.screenToWorld) return { x: 0, y: 0, w: W, h: H };
    const a = S.screenToWorld(0, 0), b = S.screenToWorld(c.clientWidth || W, c.clientHeight || H);
    const x0 = Math.max(0, Math.floor(a.x) - 2), y0 = Math.max(0, Math.floor(a.y) - 2);
    const x1 = Math.min(W, Math.ceil(b.x) + 2), y1 = Math.min(H, Math.ceil(b.y) + 2);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: W, h: H };
  }

  let sky = skyNow(), darkOn = false;

  S.registerDynamic(500, (ctx, t, dt) => {
    const t0 = prof ? performance.now() : 0;
    dt = dt || 0;
    sky = skyNow();
    if (!CLOUDS.length) initClouds();
    drawClouds(ctx, dt, sky);
    updateWeather(dt, t);
    const season = S.time.season || 'autumn';
    const wind = 6 + 5 * Math.sin(t * 0.11);
    if (season === 'autumn' || season === 'spring') { updateLeaves(dt, t, season, wind); drawLeaves(ctx, t, season); }
    else if (leaves.length) { leaves = []; leafSeason = ''; }
    if (season === 'winter') { updateSnow(dt, t, wind); drawSnow(ctx); }
    drawWeather(ctx, t);
    if (prof) prof.w500 += performance.now() - t0;
  });

  S.registerDynamic(600, (ctx, t) => {
    const t0 = prof ? performance.now() : 0;
    const dim = sky.mul !== '#ffffff' || sky.la > 0.002;
    if (dim) {
      const sig = collectLights(sky, t);
      if (sig !== lastSig || !darkOn) { const r0 = prof ? performance.now() : 0; rebuildDark(sky); lastSig = sig; if (prof) prof.rebuildMs = (prof.rebuildMs || 0) + performance.now() - r0; }
      darkOn = true;
      // Only composite the part of the world the camera can see.
      const v = viewRect();
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(mulC, v.x, v.y, v.w, v.h, v.x, v.y, v.w, v.h);
      ctx.globalCompositeOperation = 'source-over';
      if (sky.la > 0.002 || active.length) ctx.drawImage(liftC, v.x, v.y, v.w, v.h, v.x, v.y, v.w, v.h);
    } else darkOn = false;
    drawRain(ctx, sky);
    drawLightning(ctx);
    if (S.time.season === 'summer' && sky.n > 0.35) drawFlies(ctx, t, smooth(0.35, 0.8, sky.n));
    if (prof) { prof.w600 += performance.now() - t0; prof.frames++; }
  });
})();
