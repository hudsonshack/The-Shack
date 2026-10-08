/* The Shack — villagers: every character and everything that travels between places.
 *
 * Characters (y-sorted entities via S.addEntity):
 *   Mayor Tock (hub), Abbot Quill (academic-core), Grit Copperpot (ledger-fi),
 *   Lumi (social-ops), Cap'n Twirl (hustle-engine), Hudson (the player) and the
 *   townsfolk: a baker, a kid with a kite, a cat and a fisher on the Inn jetty.
 *   Sprites are painted in code at load (1 px selective outline, 3-tone shading
 *   from the top-left, 4-direction 4-frame walk cycles, idle breathing and blinks)
 *   and cached in small offscreen canvases.
 *
 * Routines walk S.route() between S.nav nodes: work spots in each biome, visits to
 * the square, home to bed late at night (a soft "Zzz" over the door).
 *
 * Speech bubbles (S.bubble) carry only real data: metrics.world.bubbles, thread
 * summaries, alerts (warn/critical tone) and honest empty-state lines.
 *
 * Delivery network (rate from metrics.world.deliveries, gentle when 0):
 *   carrier birds school -> monastery -> square, minecarts on S.nav.rails,
 *   floating lanterns market -> square, a cargo skiff down the river lane to the
 *   dock and a porter who carries the crate to the square.
 * Friday payday: the innkeeper wheels a coin cart from the Inn to the vault.
 * Cycle ceremony (S.cycle.ceremony + S.CEREMONY_BEATS): bell, gather, council, disperse.
 *
 * Layers: entities (300), couriers / kite / handed items (400), Zzz (700), player marker (800).
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S) return;

  const P = S.PAL, TILE = S.TILE, RM = !!S.reducedMotion;
  const shade = S.color.shade, mix = S.color.mix;
  const INK = P.outline;
  const rnd = S.rng(90210);
  const rand = (a, b) => a + (b - a) * rnd();
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  const R = (g, x, y, w, h, c) => { if (w <= 0 || h <= 0) return; g.fillStyle = c; g.fillRect(x, y, w, h); };
  const D = (g, x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  /** S.addLight stores a copy; keep a handle on the stored object so we can move it. */
  function light(o) { S.addLight(o); return S.lights[S.lights.length - 1]; }
  const rampCache = {};
  function ramp(hex) {
    if (!rampCache[hex]) rampCache[hex] = { hi: shade(hex, 0.36), lt: shade(hex, 0.17), b: hex, sh: shade(hex, -0.24), dk: shade(hex, -0.46) };
    return rampCache[hex];
  }

  /* ================================================================ sprite toolkit */

  /** Selective 1 px outline: every empty pixel touching the sprite takes a darkened
   *  version of its neighbour's colour (reads softer than flat black at 3x zoom). */
  function outline(cv, k = 0.74) {
    const g = cv.getContext('2d'), w = cv.width, h = cv.height;
    const img = g.getImageData(0, 0, w, h), d = img.data, src = new Uint8ClampedArray(d);
    const ink = S.color.hexToRgb(INK);
    const A = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : src[(y * w + x) * 4 + 3]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (A(x, y) > 0) continue;
      let n = -1;
      if (A(x, y - 1) > 0) n = ((y - 1) * w + x) * 4;
      else if (A(x - 1, y) > 0) n = (y * w + x - 1) * 4;
      else if (A(x + 1, y) > 0) n = (y * w + x + 1) * 4;
      else if (A(x, y + 1) > 0) n = ((y + 1) * w + x) * 4;
      if (n < 0) continue;
      const i = (y * w + x) * 4;
      d[i] = src[n] + (ink[0] - src[n]) * k; d[i + 1] = src[n + 1] + (ink[1] - src[n + 1]) * k; d[i + 2] = src[n + 2] + (ink[2] - src[n + 2]) * k; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return cv;
  }
  function flip(cv) {
    const c = mk(cv.width, cv.height), g = c.getContext('2d');
    g.scale(-1, 1); g.drawImage(cv, -cv.width, 0);
    return c;
  }
  /** Paint a small sprite with fn(g) on a padded canvas and outline it. */
  function paint(w, h, fn, k) {
    const c = mk(w + 2, h + 2), g = c.getContext('2d');
    g.translate(1, 1); fn(g); g.setTransform(1, 0, 0, 1, 0, 0);
    return outline(c, k);
  }
  /** ASCII sprite: rows of chars, palette char -> colour, '.' transparent. */
  function ascii(rows, pal, k) {
    return paint(rows[0].length, rows.length, (g) => {
      rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const c = pal[row[i]]; if (c) D(g, i, j, c); } });
    }, k);
  }

  /* ================================================================ human painter
   * Painter coordinates: body centre x = 12, feet on row 27. Canvases are 28x30 and
   * painted with a +2 x offset (room for pickaxes and lanterns); the entity anchor
   * (feet centre) sits at canvas (AX, AY).
   */
  const OX = 2, SW = 28, SH = 30, AX = 14, AY = 27;
  const EYE = '#231e2c';
  const BUILD = {
    normal: { head: [7, 8, 10, 9], torso: [8, 17, 8, 6], aw: 2, legs: [[9, 3], [12, 3]], fy: 27, dip: 1 },
    dwarf: { head: [7, 11, 10, 8], torso: [6, 19, 12, 6], aw: 2, legs: [[8, 4], [12, 4]], fy: 27, dip: 0 },
    kid: { head: [8, 13, 8, 7], torso: [9, 20, 6, 4], aw: 1, legs: [[10, 2], [12, 2]], fy: 27, dip: 0 },
  };
  const inset = (i, n) => (i === 0 || i === n - 1 ? 2 : i === 1 || i === n - 2 ? 1 : 0);
  const blush = (skin) => mix(skin, '#ff6f7d', 0.38);

  function paintHuman(g, Dz, dir, o, meta) {
    const L = BUILD[Dz.build || 'normal'];
    const walk = !!o.walk, f = walk ? o.f : 0, stride = walk && (f & 1) === 1;
    const up = stride && L.dip ? 1 : 0;
    const [hx, hy0, hw, hh] = L.head, [tx, ty0, tw, th] = L.torso;
    const c = {
      g, D: Dz, L, dir, f, walk, stride, o, meta, hx, hw, hh, tx, tw, th, aw: L.aw, fy: L.fy,
      hy: hy0 + up + (o.breath ? 1 : 0), ty: ty0 + up, legTop: ty0 + th + up,
      skin: ramp(Dz.skin),
    };
    c.ey = c.hy + hh - 5;
    c.swingL = walk ? (f === 1 ? 1 : f === 3 ? -1 : 0) : 0; c.swingR = -c.swingL;
    c.liftL = walk && f === 3 ? 1 : 0; c.liftR = walk && f === 1 ? 1 : 0;
    if (Dz.behind) Dz.behind(c);
    if (dir === 'side') {
      if (Dz.robe) robeSide(c); else legsSide(c);
      if (Dz.legs) Dz.legs(c);
      torsoSide(c);
      if (Dz.torso) Dz.torso(c);
      armSide(c);
      headShape(c); faceSide(c);
    } else {
      if (Dz.robe) robeFront(c); else legsFront(c);
      if (Dz.legs) Dz.legs(c);
      torsoFront(c);
      if (Dz.torso) Dz.torso(c);
      armsFront(c);
      headShape(c);
      if (dir === 'down') faceFront(c);
    }
    (HAIR[Dz.hair] || HAIR.none)(c, ramp(Dz.hairCol || '#4a3020'));
    if (Dz.head) Dz.head(c);
    if (Dz.front) Dz.front(c);
    meta.hand = dir === 'side' ? c.handS : c.handR;
    meta.handL = c.handL;
    meta.top = c.hy - (Dz.hatH || 0);
  }

  function headShape(c) {
    const { g, hx, hy, hw, hh, skin } = c;
    for (let i = 0; i < hh; i++) {
      const s = inset(i, hh);
      R(g, hx + s, hy + i, hw - 2 * s, 1, skin.b);
      D(g, hx + hw - 1 - s, hy + i, skin.sh);
    }
    R(g, hx + 2, hy + hh - 1, hw - 4, 1, skin.sh);
    D(g, hx + 2, hy + 1, skin.lt); D(g, hx + 1, hy + 2, skin.lt); D(g, hx + 2, hy + 2, skin.lt);
  }
  function faceFront(c) {
    const { g, hx, hw, skin, o, ey } = c;
    const ex1 = hx + (hw >> 1) - 2, ex2 = hx + (hw >> 1) + 1;
    c.ex1 = ex1; c.ex2 = ex2;
    if (o.blink) { D(g, ex1, ey + 1, skin.dk); D(g, ex2, ey + 1, skin.dk); }
    else { R(g, ex1, ey, 1, 2, c.D.eye || EYE); R(g, ex2, ey, 1, 2, c.D.eye || EYE); D(g, ex1, ey, shade(c.D.eye || EYE, 0.25)); D(g, ex2, ey, shade(c.D.eye || EYE, 0.25)); }
    const bl = blush(skin.b);
    D(g, ex1 - 1, ey + 2, bl); D(g, ex2 + 1, ey + 2, bl);
    D(g, hx + (hw >> 1) - 1, ey + 3, skin.dk); D(g, hx + (hw >> 1), ey + 3, skin.sh);
  }
  function faceSide(c) {
    const { g, hx, skin, o, ey } = c;
    if (o.blink) D(g, hx + 2, ey + 1, skin.dk); else { R(g, hx + 2, ey, 1, 2, c.D.eye || EYE); D(g, hx + 2, ey, shade(c.D.eye || EYE, 0.25)); }
    D(g, hx - 1, ey + 1, skin.b); D(g, hx - 1, ey + 2, skin.sh);
    D(g, hx + 1, ey + 3, skin.dk);
    D(g, hx + 3, ey + 2, blush(skin.b));
    D(g, hx + 5, ey, skin.sh); D(g, hx + 5, ey + 1, skin.dk);
    c.ex1 = hx + 2;
  }

  function torsoFront(c) {
    const { g, tx, ty, tw, th } = c, r = ramp(c.D.top);
    R(g, tx, ty, tw, th, r.b);
    R(g, tx, ty, 1, th, r.lt); R(g, tx + tw - 1, ty, 1, th, r.sh);
    R(g, tx, ty + th - 1, tw, 1, r.sh); R(g, tx + 1, ty, 2, 1, r.hi);
  }
  function torsoSide(c) {
    const { g, tx, ty, tw, th } = c, r = ramp(c.D.top);
    const x0 = tx + 1, w = tw - 2;
    c.sx0 = x0; c.sw = w;
    R(g, x0, ty, w, th, r.b);
    R(g, x0, ty, 1, th, r.lt); R(g, x0 + w - 1, ty, 1, th, r.sh);
    R(g, x0, ty + th - 1, w, 1, r.sh); D(g, x0 + 1, ty, r.hi);
  }
  function armsFront(c) {
    const { g, tx, ty, tw, th, aw, skin } = c, r = ramp(c.D.sleeve || c.D.top);
    const arm = (x, swing, left) => {
      const hy = ty + th - 1 + swing;
      R(g, x, ty, aw, hy - ty, r.b);
      if (left) R(g, x, ty + 1, 1, hy - ty - 1, r.lt); else if (aw > 1) R(g, x + aw - 1, ty + 1, 1, hy - ty - 1, r.sh);
      R(g, x, ty, aw, 1, left ? r.hi : r.lt);
      R(g, x, hy, aw, 1, skin.b); if (aw > 1) D(g, left ? x : x + aw - 1, hy, left ? skin.b : skin.sh);
      return hy;
    };
    const lx = tx - aw, rx = tx + tw;
    c.handL = [lx + OX, arm(lx, c.swingL, true)];
    if (c.o.pose === 'raise' && c.dir === 'down') {
      R(g, rx, ty - 5, aw, 6, r.b); R(g, rx + aw - 1, ty - 5, 1, 6, r.sh); R(g, rx, ty - 6, aw, 1, skin.b);
      c.handR = [rx + OX, ty - 6];
    } else c.handR = [rx + OX + aw - 1, arm(rx, c.swingR, false)];
  }
  function armSide(c) {
    const { g, tx, ty, tw, th, aw, skin } = c, r = ramp(c.D.sleeve || c.D.top);
    const sw = c.walk ? (c.f === 1 ? 1 : c.f === 3 ? -1 : 0) : 0;
    const ax = tx + (tw >> 1) - 1 + sw, hy = ty + th - 1;
    R(g, ax, ty + 1, aw, hy - ty - 1, r.b); R(g, ax, ty + 1, 1, hy - ty - 1, r.lt);
    D(g, ax, ty + 1, r.hi);
    R(g, ax, hy, aw, 1, skin.b);
    if (sw) D(g, ax + (sw > 0 ? aw : -1), hy - 1, r.sh);
    c.handS = [ax + OX, hy];
  }
  function legsFront(c) {
    const { g, L, fy } = c, pr = ramp(c.D.pants), sr = ramp(c.D.shoes);
    L.legs.forEach(([lx, lw], i) => {
      const lift = i === 0 ? c.liftL : c.liftR, top = c.legTop, bot = fy - 1 - lift;
      R(g, lx, top, lw, bot - top + 1, pr.b);
      if (i === 0) { R(g, lx, top, 1, bot - top + 1, pr.lt); R(g, lx + lw - 1, top + 1, 1, bot - top, pr.sh); }
      else R(g, lx + lw - 1, top, 1, bot - top + 1, pr.sh);
      R(g, lx, fy - lift, lw, 1, sr.b); D(g, i === 0 ? lx : lx + lw - 1, fy - lift, i === 0 ? sr.lt : sr.dk);
      if (c.dir === 'down') D(g, lx + (i === 0 ? 1 : 0), fy - lift, sr.lt);
    });
  }
  function legsSide(c) {
    const { g, L, fy } = c, pr = ramp(c.D.pants), sr = ramp(c.D.shoes);
    const far = ramp(shade(c.D.pants, -0.22)), farS = ramp(shade(c.D.shoes, -0.2));
    const lw = L.legs[0][1], x0 = c.tx + ((c.tw - lw) >> 1);
    const top = c.legTop, bot = fy - 1, half = Math.max(1, Math.floor((bot - top + 1) / 2));
    const leg = (d1, d2, col, sc, lift) => {
      for (let y = top; y <= bot - lift; y++) { const dx = y < top + half ? d1 : d2; R(g, x0 + dx, y, lw, 1, col.b); D(g, x0 + dx, y, col.lt); D(g, x0 + dx + lw - 1, y, col.sh); }
      R(g, x0 + d2 - 1, fy - lift, lw + 1, 1, sc.b); D(g, x0 + d2 - 1, fy - lift, sc.lt);
    };
    if (c.stride) {
      if (c.f === 1) { leg(1, 2, far, farS, 1); leg(-1, -2, pr, sr, 0); }
      else { leg(-1, -2, far, farS, 0); leg(1, 2, pr, sr, 1); }
    } else leg(0, 0, pr, sr, 0);
  }
  function robeFront(c) {
    const { g, tx, tw, fy } = c, r = ramp(c.D.robe);
    const top = c.ty + c.th - 1;
    const sway = c.walk ? (c.f === 1 ? -1 : c.f === 3 ? 1 : 0) : 0;
    for (let y = top; y < fy; y++) {
      const wd = y - top >= 1 ? 1 : 0, s = y >= fy - 2 ? sway : 0, x0 = tx - wd + s, w = tw + 2 * wd;
      R(g, x0, y, w, 1, r.b); D(g, x0, y, r.lt); D(g, x0 + w - 1, y, r.sh);
    }
    for (let y = top + 1; y < fy - 1; y++) D(g, tx + (tw >> 1) + (y >= fy - 2 ? sway : 0), y, r.sh);
    for (let y = top + 2; y < fy - 2; y += 2) D(g, tx + 1, y, r.lt);
    R(g, tx - 1 + sway, fy - 1, tw + 2, 1, c.D.hem || r.dk);
    const sand = c.D.feet || '#7a5230';
    const foot = (x) => { R(g, x, fy, 2, 1, c.skin.sh); D(g, x, fy, sand); };
    if (!c.walk || !c.stride) { foot(tx + 1); foot(tx + tw - 3); }
    else if (c.f === 1) foot(tx + 1 + sway); else foot(tx + tw - 3 + sway);
  }
  function robeSide(c) {
    const { g, tx, tw, fy } = c, r = ramp(c.D.robe);
    const top = c.ty + c.th - 1;
    const sway = c.walk ? (c.f === 1 ? -1 : c.f === 3 ? 1 : 0) : 0;
    for (let y = top; y < fy; y++) {
      const wd = y - top >= 2 ? 1 : 0, s = y >= fy - 2 ? sway : 0, x0 = tx + 1 - wd + s, w = tw - 2 + wd + (y >= fy - 3 ? 1 : 0);
      R(g, x0, y, w, 1, r.b); D(g, x0, y, r.lt); D(g, x0 + w - 1, y, r.sh);
    }
    for (let y = top + 1; y < fy - 1; y++) D(g, tx + 4 + (y >= fy - 2 ? sway : 0), y, r.sh);
    R(g, tx + sway, fy - 1, tw - 1, 1, c.D.hem || r.dk);
    const sand = c.D.feet || '#7a5230';
    if (!c.stride || c.f === 1) { R(g, tx - 1 + sway, fy, 3, 1, c.skin.sh); D(g, tx - 1 + sway, fy, sand); }
    if (c.stride && c.f === 3) { R(g, tx + tw - 4, fy, 2, 1, c.skin.sh); }
  }

  /* hair styles: fn(c, ramp) */
  const HAIR = {
    none() {},
    short(c, r) {
      const { g, hx, hy, hw, hh, dir } = c;
      for (let i = 0; i < 3; i++) { const s = inset(i, hh); R(g, hx + s, hy + i, hw - 2 * s, 1, r.b); D(g, hx + hw - 1 - s, hy + i, r.sh); }
      if (dir === 'down') {
        R(g, hx, hy + 3, 1, 3, r.b); R(g, hx + hw - 1, hy + 3, 1, 3, r.sh);
        for (const x of [1, 2, 4, 5, 7, 8]) D(g, hx + x, hy + 3, r.b);
        D(g, hx + 3, hy + 3, r.sh); D(g, hx + 1, hy + 4, r.sh);
      } else if (dir === 'up') {
        for (let i = 3; i < hh - 2; i++) { const s = inset(i, hh); R(g, hx + s, hy + i, hw - 2 * s, 1, r.b); D(g, hx + hw - 1 - s, hy + i, r.sh); }
        R(g, hx + 2, hy + hh - 2, hw - 4, 1, r.sh);
      } else {
        for (let i = 3; i < hh - 2; i++) { const s = inset(i, hh); R(g, hx + 6, hy + i, hw - 6 - s, 1, r.b); D(g, hx + hw - 1 - s, hy + i, r.sh); }
        D(g, hx, hy + 3, r.b); D(g, hx + 1, hy + 3, r.b); D(g, hx + 4, hy + 3, r.b); D(g, hx + 5, hy + 3, r.b);
      }
      R(g, hx + 2, hy + 1, 3, 1, r.lt); D(g, hx + 3, hy, r.hi);
      D(g, hx + hw - 3, hy - 1, r.b); D(g, hx + hw - 4, hy - 1, r.lt);
    },
    bob(c, r) {
      const { g, hx, hy, hw, hh, dir } = c;
      for (let i = 0; i < 3; i++) { const s = inset(i, hh); R(g, hx + s - (i === 2 ? 1 : 0), hy + i, hw - 2 * s + (i === 2 ? 2 : 0), 1, r.b); }
      if (dir === 'down') {
        R(g, hx - 1, hy + 3, 2, hh - 3, r.b); R(g, hx + hw - 1, hy + 3, 2, hh - 3, r.sh);
        R(g, hx + 1, hy + 3, 5, 1, r.b); R(g, hx + 1, hy + 4, 2, 1, r.b); D(g, hx + 6, hy + 3, r.sh);
        D(g, hx - 2, hy + hh - 1, r.b); D(g, hx + hw + 1, hy + hh - 1, r.sh);
        D(g, hx - 1, hy + 4, r.lt);
      } else if (dir === 'up') {
        for (let i = 3; i < hh; i++) R(g, hx - 1, hy + i, hw + 2, 1, r.b);
        R(g, hx + hw, hy + 3, 1, hh - 3, r.sh);
        D(g, hx - 2, hy + hh - 1, r.b); D(g, hx + hw + 1, hy + hh - 1, r.sh);
        R(g, hx + 1, hy + hh - 2, hw - 2, 1, r.sh);
      } else {
        for (let i = 3; i < hh; i++) R(g, hx + 5, hy + i, hw - 4, 1, r.b);
        R(g, hx + hw, hy + 3, 1, hh - 3, r.sh);
        R(g, hx, hy + 3, 3, 1, r.b); D(g, hx, hy + 4, r.b);
        D(g, hx + hw + 1, hy + hh - 1, r.b);
      }
      R(g, hx + 2, hy + 1, 4, 1, r.lt); D(g, hx + 3, hy, r.hi); D(g, hx + 4, hy, r.hi);
    },
    bald(c, r) {
      const { g, hx, hy, dir, skin } = c;
      D(g, hx + 3, hy + 1, skin.hi); D(g, hx + 4, hy + 1, skin.hi); D(g, hx + 3, hy + 2, skin.hi);
      if (dir === 'up') { D(g, hx, c.ey, skin.sh); D(g, hx + c.hw - 1, c.ey, skin.dk); }
      void r;
    },
    grey(c, r) { // sideburns under a hat
      const { g, hx, hy, hw, hh, dir } = c;
      if (dir === 'down') { R(g, hx, hy + 2, 1, 4, r.b); R(g, hx + hw - 1, hy + 2, 1, 4, r.sh); }
      else if (dir === 'up') {
        for (let i = 2; i < 6; i++) { const s = inset(i, hh); R(g, hx + s, hy + i, hw - 2 * s, 1, i === 5 ? r.sh : r.b); D(g, hx + hw - 1 - s, hy + i, r.sh); }
        for (let x = hx + 1; x < hx + hw - 1; x += 2) D(g, x, hy + 3, r.lt);
        D(g, hx + 2, hy + 6, r.sh); D(g, hx + hw - 3, hy + 6, r.sh);
      } else { for (let i = 2; i < 6; i++) R(g, hx + 6, hy + i, hw - 6 - inset(i, hh), 1, i === 5 ? r.sh : r.b); D(g, hx + 7, hy + 3, r.lt); D(g, hx + 4, hy + 3, r.b); D(g, hx + 4, hy + 4, r.sh); }
    },
    tied(c, r) { // under a tricorn; low ponytail
      const { g, hx, hy, hw, hh, dir } = c;
      if (dir === 'down') { R(g, hx, hy + 2, 1, 4, r.b); R(g, hx + hw - 1, hy + 2, 1, 4, r.sh); }
      else if (dir === 'up') {
        for (let i = 2; i < hh - 1; i++) { const s = inset(i, hh); R(g, hx + s, hy + i, hw - 2 * s, 1, r.b); D(g, hx + hw - 1 - s, hy + i, r.sh); }
        D(g, hx + (hw >> 1) - 1, hy + hh - 1, '#c2372e'); D(g, hx + (hw >> 1), hy + hh - 1, '#c2372e');
        R(g, hx + (hw >> 1) - 1, hy + hh, 2, 3, r.b); D(g, hx + (hw >> 1), hy + hh + 2, r.sh);
      } else {
        for (let i = 2; i < hh - 2; i++) R(g, hx + 6, hy + i, hw - 6 - inset(i, hh), 1, r.b);
        D(g, hx + hw, hy + hh - 3, '#c2372e'); R(g, hx + hw, hy + hh - 2, 1, 3, r.b);
      }
    },
    bun(c, r) {
      HAIR.short(c, r);
      const { g, hx, hy, hw, dir } = c;
      const bx = dir === 'side' ? hx + hw - 3 : hx + (hw >> 1) - 2;
      R(g, bx, hy - 3, 4, 3, r.b); R(g, bx + 1, hy - 3, 2, 1, r.lt); D(g, bx + 3, hy - 2, r.sh);
    },
  };

  /* ================================================================ character designs */
  const GOLD = ramp(P.gold);

  const TOCK = {
    build: 'normal', skin: P.skin[0], top: '#80293b', sleeve: '#2d3459', pants: '#33313e', shoes: '#211d29', hair: 'grey', hairCol: '#c3c0cc', hatH: 5,
    poses: ['raise'],
    torso(c) {
      const { g, tx, ty, tw, th, dir } = c, coat = ramp('#2d3459');
      if (dir === 'down') {
        R(g, tx, ty, 2, th, coat.b); R(g, tx, ty + 1, 1, th - 1, coat.lt);
        R(g, tx + tw - 2, ty, 2, th, coat.b); R(g, tx + tw - 1, ty, 1, th, coat.sh);
        D(g, tx + 2, ty, coat.hi); D(g, tx + tw - 3, ty, coat.lt); D(g, tx + 2, ty + 1, coat.b);
        R(g, tx + 3, ty, 2, 1, '#f1ebdd'); D(g, tx + 3, ty + 1, '#c8423c'); D(g, tx + 4, ty + 1, '#93282c');
        D(g, tx + 3, ty + 3, P.gold); D(g, tx + 3, ty + 4, shade('#80293b', -0.3));
        D(g, tx + 4, ty + 3, P.goldDark); D(g, tx + 5, ty + 4, P.gold);
        R(g, tx, c.legTop, 2, 2, coat.b); D(g, tx, c.legTop, coat.lt); R(g, tx + tw - 2, c.legTop, 2, 2, coat.sh);
      } else if (dir === 'up') {
        R(g, tx, ty, tw, th, coat.b); R(g, tx, ty, 1, th, coat.lt); R(g, tx + tw - 1, ty, 1, th, coat.sh); R(g, tx + 1, ty, 2, 1, coat.hi);
        R(g, tx, c.legTop, tw, 2, coat.b); R(g, tx + tw - 1, c.legTop, 1, 2, coat.sh);
        R(g, tx + (tw >> 1), ty + th - 2, 1, 4, coat.dk); D(g, tx + 2, ty + th - 2, P.goldDark); D(g, tx + tw - 3, ty + th - 2, P.goldDark);
      } else {
        const x0 = c.sx0, w = c.sw;
        R(g, x0, ty, w, th, coat.b); R(g, x0 + w - 1, ty, 1, th, coat.sh); D(g, x0 + 1, ty, coat.hi);
        R(g, x0, ty + 1, 1, th - 2, '#80293b'); D(g, x0, ty, '#f1ebdd'); D(g, x0, ty + 3, P.gold);
        R(g, x0 + w - 3, c.legTop, 3, 2, coat.b); D(g, x0 + w - 1, c.legTop + 1, coat.sh);
      }
    },
    head(c) {
      const { g, hx, hy, hw, dir, ey, skin } = c, hat = ramp('#2b2433');
      const mus = ramp('#dedae4');
      if (dir === 'side') {
        R(g, hx + 1, hy - 4, hw - 4, 5, hat.b); R(g, hx + 1, hy - 4, 1, 5, hat.lt); R(g, hx + hw - 4, hy - 4, 1, 5, hat.sh); D(g, hx + 2, hy - 4, hat.hi);
        R(g, hx + 1, hy, hw - 4, 1, P.goldDark); D(g, hx + 2, hy, P.gold);
        R(g, hx - 2, hy + 1, hw + 1, 1, hat.b); D(g, hx - 2, hy + 1, hat.lt); D(g, hx + hw - 2, hy + 1, hat.sh);
        R(g, hx, hy + 2, 5, 1, skin.sh);
        R(g, hx - 1, ey + 2, 3, 1, mus.b); D(g, hx - 2, ey + 1, mus.lt); D(g, hx + 1, ey + 2, mus.sh);
        D(g, hx + 1, ey - 1, P.gold); D(g, hx + 3, ey, P.gold); D(g, hx + 3, ey + 1, P.goldDark); D(g, hx + 3, ey + 3, P.goldDark); D(g, hx + 4, ey + 4, P.gold);
      } else {
        R(g, hx + 1, hy - 4, hw - 2, 5, hat.b); R(g, hx + 1, hy - 4, 1, 5, hat.lt); R(g, hx + hw - 2, hy - 4, 1, 5, hat.sh);
        R(g, hx + 2, hy - 4, 2, 1, hat.hi);
        R(g, hx + 1, hy, hw - 2, 1, P.goldDark); D(g, hx + (hw >> 1) - 1, hy, P.gold); D(g, hx + (hw >> 1), hy, '#fff1b0');
        R(g, hx - 1, hy + 1, hw + 2, 1, hat.b); R(g, hx - 1, hy + 1, 2, 1, hat.lt); D(g, hx + hw, hy + 1, hat.sh);
        if (dir === 'down') {
          R(g, hx + 1, hy + 2, hw - 2, 1, skin.sh);
          const cx = hx + (hw >> 1);
          R(g, cx - 2, ey + 2, 4, 1, mus.b); D(g, cx - 3, ey + 1, mus.lt); D(g, cx + 2, ey + 1, mus.sh); D(g, cx - 1, ey + 2, mus.hi);
          D(g, cx - 1, ey + 3, skin.sh); D(g, cx, ey + 3, skin.sh);
          const e = c.ex2;
          D(g, e + 1, ey - 1, P.gold); D(g, e + 1, ey, P.goldDark); D(g, e + 1, ey + 1, P.gold); D(g, e, ey - 1, P.goldDark);
          D(g, e + 2, ey + 2, P.goldDark); D(g, e + 2, ey + 3, P.gold);
          if (!c.o.blink) D(g, e, ey, '#9fd9ff');
        }
      }
    },
    front(c) {
      if (c.o.pose !== 'raise' || c.dir !== 'down') return;
      const { g } = c, [x, y] = c.handR, bx = x - OX - 1;
      R(g, bx, y - 5, 3, 1, GOLD.lt); R(g, bx - 1, y - 4, 5, 2, GOLD.b); R(g, bx - 1, y - 4, 1, 2, GOLD.hi); R(g, bx + 3, y - 4, 1, 2, GOLD.sh);
      R(g, bx - 2, y - 2, 7, 1, GOLD.sh); D(g, bx + 1, y - 1, '#5a4030'); D(g, bx + 1, y - 6, '#5a4030');
    },
  };

  const QUILL = {
    build: 'normal', skin: P.skin[1], top: '#e59a2f', robe: '#e59a2f', sleeve: '#e59a2f', hem: '#2e8f70', hair: 'bald', feet: '#6b4426',
    torso(c) {
      const { g, tx, ty, tw, th, dir } = c, jade = ramp('#2f9e78');
      if (dir === 'down') {
        for (let k = 0; k < th; k++) { const w = Math.min(tw, 3 + k); R(g, tx, ty + k, w, 1, jade.b); D(g, tx + w - 1, ty + k, jade.sh); }
        R(g, tx, ty, 1, th, jade.lt); D(g, tx + 1, ty, jade.hi);
        R(g, tx, ty + th - 1, tw, 1, jade.dk); D(g, tx + 3, ty + th - 1, P.gold);
        // satchel strap and scroll satchel on the left hip
        D(g, tx + tw - 2, ty, '#6b4426'); D(g, tx + tw - 3, ty + 1, '#6b4426');
        R(g, tx - 2, ty + 3, 3, 3, '#8a5a32'); D(g, tx - 2, ty + 3, '#a8784a'); R(g, tx - 2, ty + 5, 3, 1, '#5e3a1e');
        D(g, tx - 2, ty + 2, '#f3e6c4'); D(g, tx - 1, ty + 1, '#f3e6c4'); D(g, tx - 1, ty + 2, '#d8c6a0');
      } else if (dir === 'up') {
        for (let k = 0; k < th; k++) { const w = Math.min(tw, 3 + k); R(g, tx + tw - w, ty + k, w, 1, jade.b); D(g, tx + tw - 1, ty + k, jade.sh); }
        R(g, tx, ty + th - 1, tw, 1, jade.dk);
        R(g, tx + 1, ty + 1, 1, 4, '#6b4426');
      } else {
        const x0 = c.sx0, w = c.sw;
        R(g, x0, ty, 2, th, jade.b); D(g, x0, ty, jade.hi); R(g, x0, ty + th - 1, w, 1, jade.dk);
        R(g, x0 + w - 1, ty + 2, 2, 3, '#8a5a32'); D(g, x0 + w, ty + 1, '#f3e6c4'); D(g, x0 + w - 1, ty + 1, '#d8c6a0');
      }
    },
    front(c) {
      const { g, dir } = c;
      const [hxp, hyp] = dir === 'side' ? c.handS : c.handR;
      const x = hxp - OX + (dir === 'side' ? -1 : 0), y = hyp;
      if (dir === 'up') return;
      D(g, x, y + 1, '#3a2a20');
      R(g, x - 1, y + 2, 3, 1, '#3a2a20');
      R(g, x - 1, y + 3, 3, 3, '#e0662f'); D(g, x - 1, y + 3, '#f59a52'); D(g, x, y + 4, '#ffd27a'); D(g, x + 1, y + 5, '#b6451f');
      R(g, x - 1, y + 6, 3, 1, '#3a2a20');
    },
  };

  const GRIT = {
    build: 'dwarf', skin: P.skin[1], top: '#3f6f90', sleeve: '#3f6f90', pants: '#5a4030', shoes: '#33241c', hair: 'none', hatH: 3,
    behind(c) {
      const { g, dir, hx, hy } = c, wood = ramp('#8f5d34'), iron = ramp('#8a8794');
      if (dir === 'up') {
        for (let i = 0; i < 12; i++) { D(g, hx - 1 + i, hy + 13 - i, wood.b); D(g, hx - 1 + i, hy + 14 - i, wood.sh); }
        R(g, hx + 8, hy - 1, 6, 1, iron.lt); D(g, hx + 7, hy, iron.b); D(g, hx + 14, hy, iron.b); D(g, hx + 6, hy + 1, iron.sh); D(g, hx + 15, hy + 1, iron.sh);
      } else if (dir === 'side') {
        for (let i = 0; i < 8; i++) { D(g, hx + 7 + i, hy + 12 - i, wood.b); D(g, hx + 8 + i, hy + 12 - i, wood.sh); }
        R(g, hx + 13, hy + 3, 4, 1, iron.lt); D(g, hx + 12, hy + 4, iron.b); D(g, hx + 17, hy + 4, iron.b); D(g, hx + 11, hy + 5, iron.sh); D(g, hx + 14, hy + 3, iron.hi);
      }
    },
    torso(c) {
      const { g, tx, ty, tw, th, dir } = c, vest = ramp('#7b4a2b');
      if (dir === 'down') {
        R(g, tx, ty, 4, th, vest.b); R(g, tx, ty, 1, th, vest.lt); D(g, tx + 1, ty, vest.hi);
        R(g, tx + tw - 4, ty, 4, th, vest.b); R(g, tx + tw - 1, ty, 1, th, vest.sh);
        R(g, tx, ty + th - 2, tw, 1, '#2e2420'); R(g, tx + (tw >> 1) - 1, ty + th - 2, 2, 1, P.gold);
        R(g, tx + tw - 4, ty + 2, 3, 3, '#3f7a4a'); D(g, tx + tw - 4, ty + 2, '#62a06a'); R(g, tx + tw - 4, ty + 4, 3, 1, '#f3e6c4');
      } else if (dir === 'up') {
        R(g, tx, ty, tw, th - 1, vest.b); R(g, tx, ty, 1, th - 1, vest.lt); R(g, tx + tw - 1, ty, 1, th - 1, vest.sh);
        R(g, tx, ty + th - 2, tw, 1, '#2e2420');
      } else {
        R(g, c.sx0 + c.sw - 5, ty, 5, th, vest.b); R(g, c.sx0 + c.sw - 5, ty, 1, th, vest.lt); R(g, c.sx0 + c.sw - 1, ty, 1, th, vest.sh);
        R(g, c.sx0, ty + th - 2, c.sw, 1, '#2e2420'); D(g, c.sx0, ty + th - 2, P.gold);
      }
    },
    head(c) {
      const { g, hx, hy, hw, hh, dir, ey, tx, ty, tw } = c, hel = ramp('#d6a434'), bd = ramp('#c8642a');
      // beard first (helmet brim sits over it)
      if (dir === 'down') {
        const cx = hx + (hw >> 1);
        R(g, hx + 1, ey + 2, hw - 2, hy + hh - ey - 2, bd.b);
        R(g, tx + 2, ty, tw - 4, 2, bd.b); R(g, tx + 3, ty + 2, tw - 6, 2, bd.b);
        R(g, cx - 2, ty + 4, 1, 2, bd.sh); R(g, cx + 1, ty + 4, 1, 2, bd.sh); D(g, cx - 2, ty + 5, P.gold); D(g, cx + 1, ty + 5, P.gold);
        for (let y = ey + 2; y < ty + 4; y++) for (let x = hx + 1; x < hx + hw - 1; x++) if (S.hash(x, y, 7) > 0.72) D(g, x, y, bd.lt);
        R(g, hx + 1, ey + 2, 1, 3, bd.lt); R(g, hx + hw - 2, ey + 2, 1, 3, bd.sh);
        R(g, cx - 3, ey + 2, 6, 1, bd.hi); D(g, cx - 1, ey + 3, bd.dk); D(g, cx, ey + 3, bd.dk);
        D(g, cx - 1, ey + 1, c.skin.lt); D(g, cx, ey + 1, c.skin.sh);
        D(g, c.ex1 - 1, ey - 1, bd.b); D(g, c.ex1, ey - 1, bd.b); D(g, c.ex2, ey - 1, bd.b); D(g, c.ex2 + 1, ey - 1, bd.sh);
      } else if (dir === 'side') {
        R(g, hx - 1, ey + 2, 5, hy + hh - ey - 2, bd.b); R(g, tx + 1, ty, 4, 2, bd.b); R(g, tx + 1, ty + 2, 2, 2, bd.b); D(g, tx + 1, ty + 4, bd.sh); D(g, tx + 1, ty + 5, P.gold);
        for (let y = ey + 2; y < ty + 3; y++) for (let x = hx - 1; x < hx + 4; x++) if (S.hash(x, y, 9) > 0.72) D(g, x, y, bd.lt);
        R(g, hx - 1, ey + 2, 3, 1, bd.hi); D(g, hx + 1, ey - 1, bd.b); D(g, hx + 2, ey - 1, bd.b);
        R(g, hx + 4, ey + 2, 1, 3, bd.sh);
      } else {
        R(g, hx + 1, ey + 1, hw - 2, 3, bd.sh); D(g, hx, ey + 2, bd.b); D(g, hx + hw - 1, ey + 2, bd.sh);
      }
      // helmet
      const top = hy - 3;
      for (let i = 0; i < 5; i++) { const s = i === 0 ? 2 : i === 1 ? 1 : 0; R(g, hx + s, top + i, hw - 2 * s, 1, hel.b); D(g, hx + hw - 1 - s, top + i, hel.sh); D(g, hx + s, top + i, hel.lt); }
      R(g, hx + 2, top + 1, 3, 1, hel.hi);
      R(g, hx - 1, top + 5, hw + 2, 1, hel.sh); D(g, hx - 1, top + 5, hel.b);
      R(g, hx + 1, top + 4, hw - 2, 1, hel.dk);
      if (dir === 'down') {
        const cx = hx + (hw >> 1);
        R(g, cx - 2, top, 4, 4, '#4a4450'); R(g, cx - 1, top + 1, 2, 2, '#fff2b0'); D(g, cx - 1, top + 1, '#ffffff');
        R(g, hx + 1, top + 6, hw - 2, 1, c.skin.sh);
      } else if (dir === 'side') {
        R(g, hx - 2, top + 1, 3, 3, '#4a4450'); R(g, hx - 2, top + 2, 1, 1, '#fff2b0'); D(g, hx - 1, top + 2, '#fff2b0');
        R(g, hx, top + 6, 5, 1, c.skin.sh);
      } else {
        R(g, hx + (hw >> 1) - 1, top + 1, 2, 3, '#4a4450');
      }
    },
    front(c) {
      const { g, dir } = c, wood = ramp('#8f5d34'), iron = ramp('#8a8794');
      if (dir !== 'down') return;
      const [x0, y0] = c.handR, x = x0 - OX, y = y0;
      for (let i = 0; i < 11; i++) { const dx = i > 5 ? 1 : 0; D(g, x + dx, y + 1 - i, wood.b); if (i > 1) D(g, x + dx - 1, y + 1 - i, wood.lt); }
      const cx = x + 1, hy = y - 10;
      R(g, cx - 2, hy, 5, 1, iron.lt); R(g, cx - 3, hy + 1, 7, 1, iron.b); D(g, cx - 1, hy, iron.hi);
      D(g, cx - 4, hy + 2, iron.sh); D(g, cx + 4, hy + 2, iron.dk); D(g, cx, hy + 1, '#5e5a66');
    },
  };

  const LUMI = {
    build: 'normal', skin: P.skin[0], top: '#35d8ea', sleeve: '#35d8ea', pants: '#26222f', shoes: '#f3f0f6', hair: 'bob', hairCol: '#cf3f9c', eye: '#3a1f4a',
    torso(c) {
      const { g, tx, ty, tw, th, dir } = c, pk = P.neonPink;
      if (dir === 'down') {
        R(g, tx + 3, ty, 2, th - 1, '#1f1b29'); D(g, tx + 3, ty + 1, '#fff2b8'); D(g, tx + 4, ty + 2, '#ff9fd0');
        R(g, tx + 2, ty, 1, th, pk); R(g, tx + 5, ty, 1, th, shade(pk, -0.1));
        R(g, tx, ty + th - 1, tw, 1, shade(pk, -0.2)); D(g, tx + 1, ty, '#ffffff');
      } else if (dir === 'up') {
        R(g, tx + 2, ty + 1, 4, 3, '#2a8fa6'); R(g, tx + 3, ty + 2, 2, 1, pk);
        R(g, tx, ty + th - 1, tw, 1, shade(pk, -0.2));
      } else {
        R(g, c.sx0, ty, 1, th, pk); R(g, c.sx0, ty + th - 1, c.sw, 1, shade(pk, -0.2));
      }
    },
    head(c) {
      const { g, hx, hy, hw, dir, ey } = c, band = ramp('#2e2a38'), cup = ramp('#eeeaf6');
      if (dir === 'side') {
        for (let i = 0; i < 5; i++) D(g, hx + 4 + (i > 2 ? 1 : 0), hy - 1 + i, band.b);
        R(g, hx + 4, ey - 1, 3, 3, cup.b); D(g, hx + 4, ey - 1, cup.hi); D(g, hx + 5, ey, P.neonCyan); D(g, hx + 6, ey + 1, cup.sh);
      } else {
        R(g, hx + 1, hy - 1, hw - 2, 1, band.b); D(g, hx + 2, hy - 1, band.hi); D(g, hx, hy, band.b); D(g, hx + hw - 1, hy, band.sh);
        R(g, hx - 2, ey - 1, 2, 3, cup.b); D(g, hx - 2, ey - 1, cup.hi); D(g, hx - 1, ey, P.neonCyan); R(g, hx + hw, ey - 1, 2, 3, cup.sh); D(g, hx + hw, ey - 1, cup.b); D(g, hx + hw, ey, P.neonCyan);
      }
    },
    front(c) {
      const { g, dir } = c;
      if (dir === 'up') return;
      const [hxp, hyp] = dir === 'side' ? c.handS : c.handR;
      const x = hxp - OX + (dir === 'side' ? -2 : -1), y = hyp - 1;
      R(g, x, y, 4, 3, '#3a3644'); D(g, x, y, '#6a6676'); R(g, x + 1, y + 1, 2, 1, '#7fd8ff'); D(g, x + 1, y + 1, '#d8f6ff'); D(g, x + 3, y, '#ff3b5c');
    },
  };

  const TWIRL = {
    build: 'normal', skin: P.skin[1], top: '#f1ece2', sleeve: '#b8382e', pants: '#3a3346', shoes: '#2a2028', hair: 'tied', hairCol: '#4a2e1c', hatH: 4,
    legs(c) {
      const { g, L, fy, dir } = c, boot = ramp('#3d2b25');
      if (dir === 'side') return;
      L.legs.forEach(([lx, lw], i) => {
        const lift = i === 0 ? c.liftL : c.liftR;
        R(g, lx, fy - 2 - lift, lw, 2, boot.b); R(g, lx, fy - 2 - lift, lw, 1, '#6a4a34'); D(g, i === 0 ? lx : lx + lw - 1, fy - 1 - lift, i === 0 ? boot.lt : boot.sh);
      });
    },
    torso(c) {
      const { g, tx, ty, tw, th, dir } = c, coat = ramp('#b8382e'), navy = '#2c3e6e';
      if (dir === 'down') {
        R(g, tx + 2, ty + 1, 4, 1, navy); R(g, tx + 2, ty + 3, 4, 1, navy);
        R(g, tx, ty, 2, th, coat.b); R(g, tx, ty, 1, th, coat.lt); R(g, tx + tw - 2, ty, 2, th, coat.b); R(g, tx + tw - 1, ty, 1, th, coat.sh);
        D(g, tx + 1, ty + 1, P.gold); D(g, tx + 1, ty + 3, P.gold); D(g, tx + tw - 2, ty + 1, P.goldDark); D(g, tx + tw - 2, ty + 3, P.goldDark);
        R(g, tx + 2, ty + th - 1, 4, 1, '#5a3a22'); D(g, tx + 3, ty + th - 1, P.gold);
        R(g, tx, c.legTop, 2, 2, coat.b); D(g, tx, c.legTop, coat.lt); R(g, tx + tw - 2, c.legTop, 2, 2, coat.sh);
      } else if (dir === 'up') {
        R(g, tx, ty, tw, th, coat.b); R(g, tx, ty, 1, th, coat.lt); R(g, tx + tw - 1, ty, 1, th, coat.sh); R(g, tx + 1, ty, 2, 1, coat.hi);
        R(g, tx, c.legTop, tw, 2, coat.b); R(g, tx + tw - 1, c.legTop, 1, 2, coat.sh); R(g, tx + (tw >> 1), ty + th - 1, 1, 3, coat.dk);
      } else {
        const x0 = c.sx0, w = c.sw;
        R(g, x0, ty + 1, 2, 1, navy); R(g, x0, ty + 3, 2, 1, navy);
        R(g, x0 + 2, ty, w - 2, th, coat.b); R(g, x0 + w - 1, ty, 1, th, coat.sh); D(g, x0 + 2, ty + 2, P.gold);
        R(g, x0 + w - 3, c.legTop, 3, 2, coat.b); D(g, x0 + w - 1, c.legTop + 1, coat.sh);
      }
    },
    head(c) {
      const { g, hx, hy, hw, dir, ey, skin } = c, hat = ramp('#2b2236'), trim = P.gold, hair = ramp('#4a2e1c');
      if (dir === 'down') {
        const cx = hx + (hw >> 1);
        R(g, cx - 2, ey + 2, 4, 1, hair.b); D(g, cx - 3, ey + 3, hair.sh); D(g, cx + 2, ey + 3, hair.sh); D(g, cx - 1, ey + 3, skin.dk);
        R(g, cx - 1, ey + 4, 2, 1, hair.b);
        R(g, hx + 2, hy - 3, hw - 4, 3, hat.b); R(g, hx + 2, hy - 3, 2, 1, hat.hi); D(g, hx + hw - 3, hy - 2, hat.sh);
        R(g, hx - 1, hy, hw + 2, 2, hat.b); R(g, hx - 1, hy - 1, 2, 1, hat.b); R(g, hx + hw - 1, hy - 1, 2, 1, hat.sh);
        R(g, hx - 1, hy + 1, hw + 2, 1, trim); D(g, hx - 1, hy - 1, trim); D(g, hx + hw, hy - 1, P.goldDark);
        R(g, cx - 1, hy + 2, 2, 1, hat.b); D(g, cx - 1, hy + 2, trim);
        R(g, hx + 1, hy + 2, hw - 2, 1, skin.sh); D(g, cx - 1, hy + 2, hat.b); D(g, cx, hy + 2, trim);
        R(g, hx, hy - 1, hw, 1, hat.lt);
      } else if (dir === 'side') {
        R(g, hx - 1, ey + 2, 3, 1, hair.b); D(g, hx, ey + 4, hair.b); D(g, hx + 1, ey + 4, hair.sh);
        R(g, hx + 2, hy - 3, hw - 5, 3, hat.b); D(g, hx + 2, hy - 3, hat.hi);
        R(g, hx - 3, hy, hw + 3, 2, hat.b); D(g, hx - 3, hy - 1, hat.b); D(g, hx + hw - 1, hy - 1, hat.sh);
        R(g, hx - 3, hy + 1, hw + 3, 1, trim); D(g, hx - 3, hy - 1, trim);
        R(g, hx, hy + 2, 5, 1, skin.sh);
      } else {
        R(g, hx + 2, hy - 3, hw - 4, 3, hat.b); R(g, hx - 1, hy, hw + 2, 2, hat.b); D(g, hx - 1, hy - 1, hat.b); D(g, hx + hw, hy - 1, hat.sh);
        R(g, hx - 1, hy + 1, hw + 2, 1, trim); R(g, hx + 2, hy - 3, 2, 1, hat.hi);
      }
    },
  };

  const HUDSON = {
    build: 'normal', skin: P.skin[0], top: '#4a78c8', sleeve: '#4a78c8', pants: '#2f3b5e', shoes: '#f0eef2', hair: 'short', hairCol: '#5c3a22',
    torso(c) {
      const { g, tx, ty, tw, th, dir } = c, hood = ramp('#4a78c8'), bag = ramp('#e08a3a');
      if (dir === 'down') {
        R(g, tx + 1, ty, tw - 2, 1, hood.lt); D(g, tx + 3, ty + 1, '#f4f1ea'); D(g, tx + 4, ty + 1, '#f4f1ea'); D(g, tx + 3, ty + 2, '#d6d2ca');
        R(g, tx + 2, ty + 3, 4, 2, hood.sh); R(g, tx + 2, ty + 3, 4, 1, hood.dk);
        D(g, tx, ty, bag.b); D(g, tx, ty + 1, bag.sh); D(g, tx + tw - 1, ty, bag.b); D(g, tx + tw - 1, ty + 1, bag.sh);
      } else if (dir === 'up') {
        R(g, tx + 2, ty, tw - 4, 1, hood.sh);
        R(g, tx + 1, ty + 1, tw - 2, 5, bag.b); R(g, tx + 1, ty + 1, tw - 2, 1, bag.lt); R(g, tx + tw - 2, ty + 1, 1, 5, bag.sh);
        R(g, tx + 2, ty + 3, tw - 4, 2, bag.sh); R(g, tx + 2, ty + 3, tw - 4, 1, '#f3d27a'); D(g, tx + 1, ty + 1, bag.hi);
      } else {
        R(g, c.sx0 + c.sw - 1, ty + 1, 2, 5, bag.b); D(g, c.sx0 + c.sw, ty + 1, bag.lt); R(g, c.sx0 + c.sw, ty + 4, 1, 2, bag.sh);
        D(g, c.sx0 + c.sw - 2, ty, bag.sh);
        R(g, c.sx0, ty + 3, 3, 2, hood.sh);
      }
    },
  };

  const BAKER = {
    build: 'normal', skin: P.skin[1], top: '#6f9fd0', sleeve: '#6f9fd0', pants: '#4a4250', shoes: '#3a2a22', hair: 'short', hairCol: '#7a4a2a', hatH: 5,
    torso(c) {
      const { g, tx, ty, tw, th, dir } = c, ap = ramp('#f4efe6');
      if (dir === 'down') { R(g, tx + 1, ty + 1, tw - 2, th - 1, ap.b); R(g, tx + 1, ty + 1, 1, th - 1, ap.lt); R(g, tx + tw - 2, ty + 1, 1, th - 1, ap.sh); R(g, tx + 1, c.legTop, tw - 2, 2, ap.sh); D(g, tx + 3, ty + 3, '#d8a050'); }
      else if (dir === 'up') { R(g, tx + 2, ty + th - 2, tw - 4, 1, '#f4efe6'); }
      else { R(g, c.sx0, ty + 1, 3, th - 1, ap.b); R(g, c.sx0, c.legTop, 3, 2, ap.sh); }
    },
    head(c) {
      const { g, hx, hy, hw, dir, ey } = c, hat = ramp('#fbf8f2'), mus = ramp('#7a4a2a');
      const x0 = dir === 'side' ? hx : hx + 1, w = dir === 'side' ? hw - 2 : hw - 2;
      R(g, x0, hy - 1, w, 2, hat.sh); R(g, x0 - 1, hy - 5, w + 2, 4, hat.b); R(g, x0, hy - 6, w, 1, hat.b);
      R(g, x0 - 1, hy - 5, 2, 2, hat.hi); D(g, x0 + w, hy - 4, hat.sh); D(g, x0 + 3, hy - 4, hat.sh); D(g, x0 + 6, hy - 3, hat.sh);
      if (dir === 'down') { const cx = hx + (hw >> 1); R(g, cx - 2, ey + 2, 4, 1, mus.b); D(g, cx - 2, ey + 2, mus.lt); }
      else if (dir === 'side') R(g, hx - 1, ey + 2, 3, 1, mus.b);
    },
    front(c) {
      const { g, dir } = c;
      if (dir === 'up') return;
      const [hxp, hyp] = dir === 'side' ? c.handS : c.handR;
      const x = hxp - OX - (dir === 'side' ? 4 : 3), y = hyp - 2;
      R(g, x, y + 1, 6, 3, '#a8743a'); R(g, x, y + 1, 6, 1, '#c8955a'); D(g, x + 1, y + 2, '#7e5226'); D(g, x + 3, y + 2, '#7e5226'); D(g, x + 5, y + 3, '#7e5226');
      R(g, x + 1, y - 1, 3, 2, '#e3a64e'); D(g, x + 1, y - 1, '#f6cf86'); D(g, x + 4, y, '#d48c38'); D(g, x + 4, y - 2, '#f0c070'); D(g, x + 3, y - 1, '#b8712a');
    },
  };

  const KID = {
    build: 'kid', skin: P.skin[2], top: '#f2c94c', sleeve: '#f2c94c', pants: '#4a6fb0', shoes: '#c84a3a', hair: 'short', hairCol: '#2e2018', hatH: 2,
    legs(c) { // shorts: knees show
      const { g, L, fy } = c;
      if (c.dir === 'side') { const lw = L.legs[0][1], x0 = c.tx + ((c.tw - lw) >> 1); if (!c.stride) R(g, x0, fy - 2, lw, 1, c.skin.b); return; }
      L.legs.forEach(([lx, lw], i) => { const lift = i === 0 ? c.liftL : c.liftR; R(g, lx, fy - 2 - lift, lw, 1, c.skin.b); });
    },
    torso(c) { const { g, tx, ty, tw, dir } = c; if (dir !== 'side') R(g, tx, ty + 1, tw, 1, '#d6453a'); else R(g, c.sx0, ty + 1, c.sw, 1, '#d6453a'); },
    head(c) {
      const { g, hx, hy, hw, dir } = c, cap = ramp('#d6453a');
      R(g, hx + 1, hy - 1, hw - 2, 2, cap.b); D(g, hx + 2, hy - 1, cap.hi); D(g, hx + hw - 2, hy, cap.sh);
      if (dir === 'down') R(g, hx + 1, hy + 1, hw - 2, 1, cap.sh);
      else if (dir === 'side') R(g, hx - 2, hy + 1, 4, 1, cap.sh);
      else R(g, hx + 2, hy + 1, hw - 4, 1, cap.dk);
    },
  };

  const PORTER = {
    build: 'normal', skin: P.skin[2], top: '#5f7590', sleeve: '#5f7590', pants: '#5a4836', shoes: '#2e2420', hair: 'none', hatH: 2,
    torso(c) { const { g, tx, ty, tw, dir } = c; if (dir !== 'side') for (let x = tx + 1; x < tx + tw - 1; x += 2) D(g, x, ty + 2, shade('#5f7590', -0.15)); },
    head(c) {
      const { g, hx, hy, hw, hh, dir } = c, cap = ramp('#b8433a');
      for (let i = 0; i < 4; i++) { const s = inset(i, hh); R(g, hx + s, hy + i - 1, hw - 2 * s, 1, cap.b); D(g, hx + hw - 1 - s, hy + i - 1, cap.sh); }
      R(g, hx, hy + 2, hw, 1, cap.dk); R(g, hx + 2, hy - 1, 2, 1, cap.hi);
      for (let x = hx + 1; x < hx + hw - 1; x += 2) D(g, x, hy + 1, cap.lt);
      if (dir === 'side') R(g, hx + 6, hy + 3, hw - 6, 3, '#2c2018');
      if (dir === 'up') R(g, hx + 1, hy + 3, hw - 2, 3, '#2c2018');
    },
  };
  const PORTER_CARRY = Object.assign({}, PORTER, {
    front(c) {
      const { g, dir, tx, ty, tw } = c, wd = ramp('#b07a44');
      const box = (x, y, w, h) => { R(g, x, y, w, h, wd.b); R(g, x, y, w, 1, wd.lt); R(g, x, y, 1, h, wd.lt); R(g, x + w - 1, y, 1, h, wd.sh); R(g, x, y + h - 1, w, 1, wd.sh); R(g, x + 1, y + (h >> 1), w - 2, 1, wd.dk); D(g, x + 1, y + 1, '#f2c94c'); };
      if (dir === 'down') box(tx - 2, ty - 1, tw + 4, 6);
      else if (dir === 'up') box(tx - 2, ty - 3, tw + 4, 4);
      else box(tx - 3, ty - 1, 7, 6);
    },
  });
  const INNKEEPER = {
    build: 'normal', skin: P.skin[1], top: '#f1ece0', sleeve: '#f1ece0', pants: '#3a3440', shoes: '#2a2228', hair: 'bun', hairCol: '#3a2a34',
    torso(c) {
      const { g, tx, ty, tw, th, dir } = c, ap = ramp('#2f6b4a');
      if (dir === 'down') { R(g, tx + 1, ty + 2, tw - 2, th - 2, ap.b); R(g, tx + 1, ty + 2, 1, th - 2, ap.lt); R(g, tx + 1, c.legTop, tw - 2, 3, ap.sh); D(g, tx + 3, ty + 3, P.gold); }
      else if (dir === 'up') R(g, tx, ty + 3, tw, 1, ap.b);
      else { R(g, c.sx0, ty + 2, 3, th - 2, ap.b); R(g, c.sx0, c.legTop, 3, 3, ap.sh); }
    },
  };

  /* frames: {down|up|left|right: {w0..w3, i0, i1, ib, pose...}, meta} */
  const KEYS = [['w0', { walk: 1, f: 0 }], ['w1', { walk: 1, f: 1 }], ['w2', { walk: 1, f: 2 }], ['w3', { walk: 1, f: 3 }], ['i0', {}], ['i1', { breath: 1 }], ['ib', { blink: 1 }]];
  function buildFrames(Dz) {
    const fr = { down: {}, up: {}, left: {}, right: {}, meta: {} };
    const keys = KEYS.concat((Dz.poses || []).map((p) => [p, { pose: p }]));
    for (const dir of ['down', 'up', 'side']) for (const [k, o0] of keys) {
      const cv = mk(SW, SH), g = cv.getContext('2d'), meta = {};
      g.translate(OX, 0);
      paintHuman(g, Dz, dir, Object.assign({}, o0), meta);
      g.setTransform(1, 0, 0, 1, 0, 0);
      outline(cv);
      if (dir === 'side') {
        fr.left[k] = cv; fr.right[k] = flip(cv);
        fr.meta['left' + k] = meta;
        fr.meta['right' + k] = { hand: meta.hand && [SW - 1 - meta.hand[0], meta.hand[1]], top: meta.top };
      } else { fr[dir][k] = cv; fr.meta[dir + k] = meta; }
    }
    return fr;
  }

  /* ---------------------------------------------------------------- small sprites */
  const CAT_PAL = { a: '#e08a3a', b: '#b25e24', c: '#f8d6a6', e: '#2a2433', p: '#f09aa0', w: '#fff6e6', g: '#7ccf5a' };
  const CAT = {
    walk: [
      ['..b.b........', '.aaaa.......a', 'aegaa.......a', 'apaaaaaaaaaba', '.acabababaa..', '..ccaaaaaaa..', '..a.a....a.a.', '..b.b....b.b.'],
      ['..b.b........', '.aaaa.......a', 'aegaa......ba', 'apaaaaaaaaaa.', '.acabababaa..', '..ccaaaaaaa..', '...aa...aa...', '...bb...bb...'],
      ['..b.b........', '.aaaa.......a', 'aegaa.......a', 'apaaaaaaaaaba', '.acabababaa..', '..ccaaaaaaa..', '.a..a...a..a.', '.b..b...b..b.'],
      ['..b.b........', '.aaaa......a.', 'aegaa......ba', 'apaaaaaaaaaa.', '.acabababaa..', '..ccaaaaaaa..', '...aa...aa...', '...bb...bb...'],
    ],
    sit: ['.b...b...', '.aaaaa...', '.gaaag...', '.aapaa...', '..ccc....', '.acccaa..', '.acccaa.a', '.acccaa.a', '.bbabbaa.'],
    sitBlink: ['.b...b...', '.aaaaa...', '.eaaae...', '.aapaa...', '..ccc....', '.acccaa..', '.acccaa.a', '.acccaa.a', '.bbabbaa.'],
    loaf: ['..b.b.......', '.aaaa.aaaa..', 'aeaeabababaa', 'apaaaaaaaaaa', '.ccaaaaaaaab', '..aaaaaaaab.'],
  };
  let catFr = null;
  function catFrames() {
    if (catFr) return catFr;
    const l = CAT.walk.map((r) => ascii(r, CAT_PAL));
    catFr = { left: l, right: l.map(flip), sit: ascii(CAT.sit, CAT_PAL), sitBlink: ascii(CAT.sitBlink, CAT_PAL), loaf: ascii(CAT.loaf, CAT_PAL) };
    return catFr;
  }

  // Fisher seated on the jetty, facing the river (west). Rod and line are drawn live.
  const FISH_PAL = { h: '#7b7a3e', H: '#5c5b2c', s: P.skin[1], S: shade(P.skin[1], -0.22), e: EYE, r: '#b8433a', R: '#7e2a24', k: '#f0d9a0', j: '#3f5a86', J: '#2e4266', b: '#3a2a20', w: '#d9d4c8' };
  const FISHER = [
    '....hhhh....',
    '...hhhhhh...',
    '..HHHHHHHH..',
    '...ssshhh...',
    '..sesssSh...',
    '.ssssssSh...',
    '..wSsssS....',
    '..rrRrrrR...',
    '.srRrrRrrR..',
    '..rkrRrkrR..',
    '..rrRrrRrR..',
    '.jjjjjjjJJ..',
    'jjjjjjjjJ...',
    'jJ..........',
    'jJ..........',
    'bb..........',
  ];
  let fisherSpr = null;

  function sparkleAt(ctx, x, y, k, col) {
    x = Math.round(x); y = Math.round(y);
    D(ctx, x, y, '#ffffff');
    if (k > 0.4) { ctx.fillStyle = col || '#fff3b0'; ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1); ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x, y + 1, 1, 1); }
    if (k > 0.75) { ctx.fillStyle = 'rgba(255,246,207,0.7)'; ctx.fillRect(x - 2, y, 1, 1); ctx.fillRect(x + 2, y, 1, 1); ctx.fillRect(x, y - 2, 1, 1); ctx.fillRect(x, y + 2, 1, 1); }
  }

  // Items handed to Tock in the council.
  const ITEMS = {};
  function itemSprite(kind) {
    if (ITEMS[kind]) return ITEMS[kind];
    let s;
    if (kind === 'scroll') s = paint(7, 5, (g) => { R(g, 1, 0, 5, 5, '#f3e6c4'); R(g, 1, 0, 5, 1, '#fff8e4'); R(g, 0, 0, 1, 5, '#d8c6a0'); R(g, 6, 0, 1, 5, '#d8c6a0'); R(g, 1, 2, 5, 1, '#c8423c'); D(g, 3, 3, '#93282c'); });
    else if (kind === 'coins') s = paint(7, 5, (g) => { R(g, 0, 2, 4, 3, P.goldDark); R(g, 0, 2, 4, 1, P.gold); R(g, 3, 0, 4, 5, P.goldDark); R(g, 3, 0, 4, 1, '#fff1b0'); R(g, 3, 2, 4, 1, P.gold); D(g, 4, 0, '#ffffff'); });
    else if (kind === 'poster') s = paint(6, 7, (g) => { R(g, 0, 0, 6, 7, '#2a1f3a'); R(g, 1, 1, 4, 3, P.neonPink); R(g, 1, 5, 4, 1, P.neonCyan); D(g, 2, 2, '#ffffff'); });
    else if (kind === 'crate') s = paint(7, 6, (g) => { R(g, 0, 0, 7, 6, '#b07a44'); R(g, 0, 0, 7, 1, '#d29a5c'); R(g, 0, 0, 1, 6, '#c88f52'); R(g, 6, 0, 1, 6, '#86592e'); R(g, 1, 3, 5, 1, '#7a5028'); D(g, 3, 1, P.neonCyan); });
    else s = paint(4, 4, (g) => { R(g, 0, 0, 4, 4, P.gold); });
    ITEMS[kind] = s;
    return s;
  }

  // Vehicles (painted procedurally, outlined).
  const MC = { rim: '#b4b0bc', body: '#6d6876', dark: '#46424e', wood: '#9b6b3d', woodD: '#74502c', wheel: '#2b2733', hub: '#a29eaa' };
  function minecart(side, loaded) {
    const w = side ? 14 : 12, h = 10;
    return paint(w, h, (g) => {
      if (loaded) {
        for (let i = 1; i < w - 1; i++) { const hgt = 1 + ((i * 7) % 3 === 0 ? 1 : 0); R(g, i, 3 - hgt, 1, hgt, (i % 3) ? P.gold : P.goldDark); }
        D(g, 3, 1, '#fff3b0'); D(g, w - 5, 1, '#ffffff'); D(g, 6, 2, '#a8784a'); D(g, w - 3, 2, '#8a8794');
      }
      R(g, 0, 3, w, 1, MC.rim); D(g, 0, 3, '#e6e2ec');
      R(g, side ? 0 : 0, 4, w, 4, MC.body); R(g, 0, 4, 1, 4, shade(MC.body, 0.2)); R(g, w - 1, 4, 1, 4, MC.dark);
      R(g, 1, 5, w - 2, 1, MC.wood); R(g, 1, 6, w - 2, 1, MC.woodD);
      for (const x of side ? [2, w - 3] : [2, w - 3]) D(g, x, 4, '#d8d4de');
      R(g, 1, 8, w - 2, 1, MC.dark);
      if (side) { R(g, 2, 9, 3, 1, MC.wheel); R(g, w - 5, 9, 3, 1, MC.wheel); D(g, 3, 8, MC.hub); D(g, w - 4, 8, MC.hub); }
      else { R(g, 0, 8, 2, 2, MC.wheel); R(g, w - 2, 8, 2, 2, MC.wheel); }
    });
  }
  function handcart(dir, loaded) { // dir: 'right' | 'down' | 'up'
    const wood = ramp('#a8743c');
    if (dir === 'right') return paint(16, 10, (g) => {
      if (loaded) { R(g, 6, 1, 8, 2, P.goldDark); R(g, 7, 0, 6, 1, P.gold); D(g, 8, 0, '#fff3b0'); D(g, 11, 1, '#fff3b0'); D(g, 9, 2, P.gold); }
      R(g, 4, 3, 11, 4, wood.b); R(g, 4, 3, 11, 1, wood.hi); R(g, 4, 6, 11, 1, wood.sh); R(g, 14, 3, 1, 4, wood.sh);
      for (const x of [7, 10, 13]) R(g, x, 4, 1, 2, wood.dk);
      R(g, 0, 4, 4, 1, '#6b4426'); D(g, 0, 4, '#8a5a32');
      R(g, 7, 7, 4, 3, '#3a2a20'); R(g, 8, 7, 2, 3, '#5e4430'); D(g, 8, 8, '#c8b090');
    });
    return paint(12, 11, (g) => {
      if (loaded) { R(g, 2, 1, 8, 2, P.goldDark); R(g, 3, 0, 6, 1, P.gold); D(g, 4, 0, '#fff3b0'); D(g, 7, 1, '#fff3b0'); }
      R(g, 1, 3, 10, 5, wood.b); R(g, 1, 3, 10, 1, wood.hi); R(g, 1, 7, 10, 1, wood.sh); R(g, 10, 3, 1, 5, wood.sh);
      R(g, 3, 4, 1, 3, wood.dk); R(g, 8, 4, 1, 3, wood.dk);
      R(g, 0, 7, 2, 4, '#3a2a20'); R(g, 10, 7, 2, 4, '#3a2a20');
      if (dir === 'up') { R(g, 2, 8, 1, 3, '#6b4426'); R(g, 9, 8, 1, 3, '#6b4426'); }
    });
  }
  function skiff(horizontal, loaded) {
    const hull = ramp('#c64a3a'), deck = ramp('#a8743c');
    if (horizontal) return paint(26, 14, (g) => {
      // pennant mast at the stern
      R(g, 4, 0, 1, 7, '#5a4030'); R(g, 5, 0, 3, 1, P.neonCyan); R(g, 5, 1, 2, 1, '#2aa9b8');
      // deck
      R(g, 1, 6, 22, 3, deck.b); R(g, 1, 6, 22, 1, deck.hi); for (let x = 4; x < 22; x += 4) D(g, x, 7, deck.sh);
      R(g, 22, 7, 2, 2, deck.b); D(g, 24, 8, deck.sh);
      if (loaded) {
        R(g, 9, 2, 6, 5, '#b07a44'); R(g, 9, 2, 6, 1, '#d29a5c'); R(g, 14, 2, 1, 5, '#86592e'); R(g, 10, 4, 4, 1, '#7a5028'); D(g, 11, 3, P.neonPink);
        R(g, 15, 4, 5, 3, '#c08850'); R(g, 15, 4, 5, 1, '#deaa6a'); R(g, 19, 4, 1, 3, '#86592e'); D(g, 17, 5, P.neonCyan);
      }
      // hull
      R(g, 0, 9, 25, 1, '#f1ece2'); R(g, 1, 10, 24, 2, hull.b); R(g, 1, 10, 24, 1, hull.lt); R(g, 3, 12, 20, 1, hull.sh);
      R(g, 23, 9, 2, 1, '#f1ece2'); D(g, 25, 9, '#d8d2c6');
      D(g, 6, 10, '#f2c94c'); D(g, 12, 10, '#f2c94c'); D(g, 18, 10, '#f2c94c');
    });
    return paint(13, 24, (g) => {
      R(g, 2, 1, 9, 19, hull.b); R(g, 1, 3, 11, 15, hull.b); R(g, 3, 20, 7, 2, hull.b); R(g, 5, 22, 3, 1, hull.sh);
      R(g, 1, 3, 1, 15, hull.lt); R(g, 11, 3, 1, 15, hull.sh);
      R(g, 3, 2, 7, 18, '#f1ece2'); R(g, 4, 3, 5, 16, deck.b); R(g, 4, 3, 5, 1, deck.hi); for (let y = 6; y < 19; y += 3) R(g, 4, y, 5, 1, deck.sh);
      R(g, 6, 0, 1, 4, '#5a4030'); R(g, 7, 0, 3, 1, P.neonCyan);
      if (loaded) { R(g, 4, 7, 5, 4, '#b07a44'); R(g, 4, 7, 5, 1, '#d29a5c'); R(g, 8, 7, 1, 4, '#86592e'); D(g, 6, 8, P.neonPink); R(g, 4, 12, 5, 4, '#c08850'); R(g, 4, 12, 5, 1, '#deaa6a'); D(g, 6, 13, P.neonCyan); }
    });
  }
  function birdFrames() {
    const pal = { w: '#f4f2ee', g: '#b9b6c4', r: '#c8423c', o: '#f2a33a', e: EYE };
    return [
      ascii(['g...g', '.g.g.', '.wwwo', '..w..'], pal),
      ascii(['.....', 'ggwgg', '.wwwo', '.....'], pal),
      ascii(['.....', '.www.', 'gwwwo', 'g...g'], pal),
    ];
  }
  let birdFr = null;
  function lanternSprite() {
    return paint(5, 7, (g) => {
      R(g, 1, 0, 3, 1, '#3a2a20'); R(g, 0, 1, 5, 5, '#ff8a3d'); R(g, 0, 1, 1, 5, '#ffb46a'); R(g, 4, 1, 1, 5, '#d5602a');
      R(g, 1, 2, 3, 3, '#ffd27a'); D(g, 2, 3, '#fff6cf'); R(g, 1, 6, 3, 1, '#3a2a20');
    }, 0.6);
  }
  let lanternSpr = null;
  function kiteSprite() {
    return paint(9, 11, (g) => {
      for (let j = 0; j < 11; j++) { const hw = j <= 4 ? j : 10 - j; const w = Math.max(1, Math.round(hw * 0.8)); for (let i = -w; i <= w; i++) D(g, 4 + i, j, (i < 0) !== (j > 4) ? '#e8423a' : P.gold); }
      R(g, 4, 0, 1, 11, '#8a5a32'); R(g, 1, 4, 7, 1, '#8a5a32'); D(g, 3, 2, '#fff3b0');
    }, 0.6);
  }
  let kiteSpr = null;

  /* ================================================================ places + routing */
  const nodePx = (n) => { const p = S.nav.nodes[n]; return [p[0] * TILE + TILE, p[1] * TILE + TILE]; };
  const tpx = (p) => [p[0] * TILE + TILE, p[1] * TILE + TILE];
  function place(node, via, face, extra) {
    const pl = Object.assign({ node, via: via || [], face: face || null }, extra || {});
    pl.px = pl.via.length ? pl.via[pl.via.length - 1] : nodePx(node);
    return pl;
  }
  const PL = {
    // Mayor Tock
    tower: place('TOWER', [[528, 266]], 'down'),
    quest: place('QUEST', [[456, 336], [456, 316]], 'up'),
    mail: place('MAIL', [[586, 336], [586, 318]], 'up'),
    plaza: place('SQ', [], 'down'),
    fountainN: place('SQ', [[568, 336], [568, 339]], 'down'),
    // Abbot Quill
    templeDoor: place('MON', [[256, 108]], 'up'),
    stairs: place('MON', [], 'down'),
    garden: place('MON', [[256, 200], [330, 200]], 'up'),
    // Grit Copperpot
    mineMouth: place('MINEDOOR', [[912, 473]], 'up'),
    ledger: place('MINE', [[868, 512], [868, 590], [848, 590]], 'up'),
    vault: place('MINE', [[868, 512], [868, 602], [784, 602]], 'up'),
    cottage: place('MINEDOOR', [[912, 498], [1007, 498], [1007, 460]], 'up'),
    // Lumi
    angies: place('MKT', [[760, 176], [760, 164]], 'up'),
    film: place('MKT', [[876, 176], [876, 224]], 'up'),
    billboard: place('MKT', [[846, 176], [846, 124]], 'up'),
    studio: place('MKT', [[846, 176], [846, 130], [958, 130], [958, 100]], 'up'),
    // Cap'n Twirl
    dock: place('DOCK', [[124, 544]], 'left'),
    stalls: place('PORT', [[256, 556], [204, 556]], 'up'),
    bazaar: place('PORT', [[262, 512], [262, 496]], 'right'),
    // square visits
    visitQuill: place('SQ', [[480, 336], [480, 318]], 'up'),
    visitGrit: place('SQ', [[604, 336], [604, 322]], 'up'),
    visitLumi: place('SQ', [[560, 336], [560, 304]], 'up'),
    visitTwirl: place('SQ', [[500, 336], [500, 356]], 'down'),
    // ceremony circle around the fountain (FOUNTAIN 568,373)
    cTock: place('SQ', [[568, 336], [568, 339]], 'down'),
    cQuill: place('SQ', [[526, 336], [526, 366]], 'right'),
    cLumi: place('SQ', [[606, 336], [606, 364]], 'left'),
    cGrit: place('SQ', [[528, 336], [528, 412], [548, 412]], 'up'),
    cTwirl: place('SQ', [[528, 336], [528, 420], [588, 420], [588, 412]], 'up'),
    cHudson: place('SQ', [[496, 336], [496, 380]], 'right'),
    // Hudson's square wander
    h1: place('SQ', [[470, 332]], 'down'),
    h2: place('SQ', [[528, 300]], 'down'),
    h3: place('SQ', [[600, 340]], 'left'),
    h4: place('SQ', [[504, 392]], 'down'),
    h5: place('SQ', [[456, 336], [456, 318]], 'up'),
    h6: place('SQ', [[548, 330]], 'right'),
    innDoor: place('INN', [[176, 324]], 'up'),
    // townsfolk
    bakerInn: place('INN', [[196, 336], [196, 326]], 'down'),
    bakerSq: place('SQ', [[484, 336], [484, 356]], 'down'),
    bakerQuest: place('SQ', [[440, 336], [440, 330]], 'right'),
    pier: place('DOCK', [[96, 545]], 'left'),
    crateDrop: place('MAIL', [[600, 336], [600, 324]], 'up'),
    vaultDrop: place('JE', [[736, 512], [776, 512]], 'down'),
  };

  function pathLen(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]); return s; }
  function cleanPath(pts) {
    const out = [];
    for (const p of pts) { const l = out[out.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push([p[0], p[1]]); }
    // remove there-and-back spikes
    for (let i = 1; i + 1 < out.length; i++) {
      const a = out[i - 1], c = out[i + 1];
      if (a[0] === c[0] && a[1] === c[1]) { out.splice(i, 2); i = Math.max(0, i - 2); }
    }
    return out;
  }
  function planPath(A, B) {
    const pts = [];
    for (let i = A.via.length - 1; i >= 0; i--) pts.push(A.via[i]);
    for (const p of S.route(A.node, B.node)) pts.push(tpx(p));
    for (const p of B.via) pts.push(p);
    if (!A.via.length) pts.unshift(nodePx(A.node));
    return cleanPath(pts);
  }

  /* ================================================================ data */
  const data = S.data || {};
  const metrics = (a) => (S.metrics ? S.metrics(a) : {}) || {};
  const thread = (a) => (S.thread ? S.thread(a) : null);
  const LABEL = { 'academic-core': 'Academic-Core', 'ledger-fi': 'Ledger-Fi', 'social-ops': 'Social-Ops', 'hustle-engine': 'Hustle-Engine', hub: 'Hub' };
  function alertsFor(agent) {
    const th = thread(agent), lab = (th && th.label) || LABEL[agent];
    return (data.alerts || []).filter((a) => a && a.msg && (a.agent === agent || a.agent === lab));
  }
  const openHumanTasks = () => (data.tasks || []).filter((t) => t && t.autonomy === 'human' && t.phase !== 'done');
  const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  function agentLines(agent) {
    const out = [], m = metrics(agent), w = m.world || {}, th = thread(agent);
    for (const b of w.bubbles || []) if (typeof b === 'string' && b.trim()) out.push({ text: b.trim(), tone: 'info' });
    for (const a of alertsFor(agent)) out.push({ text: a.msg, tone: a.level === 'critical' ? 'critical' : 'warn' });
    if (th && th.summary) out.push({ text: th.summary, tone: !th.last_run || th.phase === 'uninit' ? 'quiet' : 'info' });
    if (agent === 'academic-core') {
      if (!(m.deadlines || []).length) out.push({ text: m.classroom_feed === 'connected' ? 'No deadlines on the scrolls' : 'No Classroom mail yet', tone: 'quiet' });
      if (!(m.study_blocks || []).length && m.classroom_feed === 'connected') out.push({ text: 'No study blocks set yet', tone: 'quiet' });
    } else if (agent === 'ledger-fi') {
      if (m.bank_feed !== 'connected') out.push({ text: 'Bank alerts not linked yet', tone: 'quiet' });
      if (!m.last_paycheck) out.push({ text: 'No paycheck logged yet', tone: 'quiet' });
      if ((m.savings || []).length && (m.savings || []).every((s) => s.target == null)) out.push({ text: 'Savings goals need targets', tone: 'quiet' });
    } else if (agent === 'social-ops') {
      if (!m.scheduled_posts_7d) out.push({ text: 'No posts queued yet', tone: 'quiet' });
      if (!(m.clients || []).length) out.push({ text: 'No client feeds loaded yet', tone: 'quiet' });
    } else if (agent === 'hustle-engine') {
      const sh = m.shopify || {};
      if (sh.orders_7d == null) out.push({ text: 'Shopify not hooked up yet', tone: 'quiet' });
      else if (sh.orders_7d === 0) out.push({ text: 'No orders this week', tone: 'quiet' });
    }
    return out;
  }
  function tockLines() {
    const out = [];
    out.push(() => { const n = S.cycle && S.cycle.next; return n && n.at ? { text: 'Next bell at ' + nyFmt.format(n.at), tone: 'info' } : null; });
    const runs = data.runs || [];
    if (runs.length) out.push({ text: 'Last cycle: ' + runs[0].cycle + ' (' + runs[0].result + ')', tone: runs[0].result === 'ok' ? 'info' : 'warn' });
    else out.push({ text: 'No cycle has run yet', tone: 'quiet' });
    const q = openHumanTasks().length;
    out.push({ text: q ? plural(q, 'quest') + ' on the board' : 'Quest board is clear', tone: q ? 'info' : 'quiet' });
    const al = (data.alerts || []).length;
    if (al) out.push({ text: plural(al, 'alert') + ' on file', tone: (data.alerts || []).some((a) => a.level === 'critical') ? 'critical' : 'warn' });
    return out;
  }
  function hudsonLines() {
    const out = [], tasks = openHumanTasks();
    if (tasks.length) {
      out.push({ text: plural(tasks.length, 'quest') + ' for me', tone: 'info' });
      const top = tasks.slice().sort((a, b) => (a.priority || 9) - (b.priority || 9))[0];
      if (top && top.title) out.push({ text: 'Next: ' + top.title, tone: 'info', max: 2 });
    }
    out.push(() => (S.time.isPayday ? { text: 'Friday: payday!', tone: 'info' } : null));
    return out;
  }

  /** Split a line into bubble-sized chunks (the bubble is one line, ~26 chars). */
  function chunks(text, max) {
    const LIM = 21, words = String(text).split(/\s+/), out = [];
    let cur = '';
    for (const w of words) {
      if (!cur) cur = w;
      else if ((cur + ' ' + w).length <= LIM) cur += ' ' + w;
      else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    if (max && out.length > max) { out.length = max; out[max - 1] = out[max - 1].replace(/[\s,.;:]*$/, '') + '…'; }
    return out.map((s, i) => (i > 0 && !/^[A-Z0-9]/.test(s) ? '…' : '') + (i < out.length - 1 && !/[.!?…,;:]$/.test(s) ? s + '…' : s));
  }

  /* ================================================================ villagers */
  const villagers = [];
  const byId = {};
  const HOURS = () => (S.time && typeof S.time.hours === 'number' ? S.time.hours : 12);
  const asleepAt = (h, sl) => (sl ? (sl[0] > sl[1] ? h >= sl[0] || h < sl[1] : h >= sl[0] && h < sl[1]) : false);

  function makeVillager(o) {
    const v = Object.assign({
      x: 0, y: 0, dir: 'down', speed: 20, path: null, pi: 0, dist: 0, at: null, from: null, to: null,
      wait: rand(0.5, 3), hidden: false, sleeping: false, blinkT: rand(1, 4), blinkOn: 0, breathT: rnd(), hurry: 1,
      bubbleUntil: 0, lineIdx: Math.floor(rnd() * 5), queue: [], h: 24, dy: 30,
    }, o);
    if (v.design) v.fr = buildFrames(v.design);
    if (v.designAlt) v.frAlt = buildFrames(v.designAlt);
    v.update = (dt, t) => updateV(v, dt, t);
    v.draw = (ctx, t) => (v.drawFn ? v.drawFn(v, ctx, t) : drawV(v, ctx, t));
    villagers.push(v); if (v.id) byId[v.id] = v;
    S.addEntity(v);
    return v;
  }
  function setAt(v, pl) {
    v.at = pl; v.from = null; v.to = null; v.path = null;
    v.x = pl.px[0]; v.y = pl.px[1];
    if (pl.face) v.dir = pl.face;
  }
  function go(v, pl, hurry) {
    v.hurry = hurry || 1;
    if (!v.at && v.path && v.from && v.to) return redirect(v, pl);
    const A = v.at || pl;
    v.from = A; v.to = pl; v.at = null;
    v.path = planPath(A, pl); v.pi = 0;
    if (v.path.length && (v.path[0][0] !== Math.round(v.x) || v.path[0][1] !== Math.round(v.y))) v.path.unshift([v.x, v.y]);
  }
  function redirect(v, pl) {
    if (v.to === pl) return;
    const here = [v.x, v.y];
    const fwd = cleanPath([here].concat(v.path.slice(v.pi), planPath(v.to, pl)));
    const back = cleanPath([here].concat(v.path.slice(0, v.pi).reverse(), planPath(v.from, pl)));
    v.path = pathLen(fwd) <= pathLen(back) ? fwd : back;
    v.pi = 0; v.to = pl; v.from = v.from || pl;
  }
  function arrived(v) {
    const pl = v.to;
    v.at = pl; v.to = null; v.from = null; v.path = null; v.hurry = 1;
    if (pl && pl.face) v.dir = pl.face;
    if (v.onArrive) { const f = v.onArrive; v.onArrive = null; f(v); }
  }

  function updateV(v, dt, t) {
    if (v.tick) v.tick(v, dt, t);
    // blink + breathing
    v.blinkT -= dt;
    if (v.blinkT <= 0) { v.blinkOn = 0.14; v.blinkT = rand(2.5, 5.5); }
    if (v.blinkOn > 0) v.blinkOn -= dt;
    if (v.path) {
      let step = v.speed * v.hurry * dt;
      while (step > 0 && v.path && v.pi < v.path.length) {
        const [tx, ty] = v.path[v.pi], dx = tx - v.x, dy = ty - v.y, d = Math.hypot(dx, dy);
        if (d > 0.01) v.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
        if (d <= step) { v.x = tx; v.y = ty; v.pi++; step -= d; v.dist += d; }
        else { v.x += (dx / d) * step; v.y += (dy / d) * step; v.dist += step; step = 0; }
      }
      if (v.path && v.pi >= v.path.length) arrived(v);
      return;
    }
    if (v.wait > 0) { v.wait -= dt; return; }
    if (v.brain) v.brain(v, t);
  }

  const shadowCache = {};
  function shadowSpr(w) {
    if (shadowCache[w]) return shadowCache[w];
    const c = mk(w, 4), g = c.getContext('2d');
    g.fillStyle = P.shadow;
    g.fillRect(2, 0, w - 4, 1); g.fillRect(0, 1, w, 2); g.fillRect(2, 3, w - 4, 1);
    shadowCache[w] = c;
    return c;
  }
  function frameOf(v, t) {
    const fr = (v.carrying && v.frAlt) || v.fr;
    const dirSet = fr[v.dir] || fr.down;
    let key;
    if (v.pose && dirSet[v.pose]) key = v.pose;
    else if (v.path) key = 'w' + (Math.floor(v.dist / (v.stepLen || 4)) % 4);
    else if (v.blinkOn > 0) key = 'ib';
    else key = (Math.floor(t / (RM ? 1.4 : 0.9) + v.breathT * 3) & 1) ? 'i1' : 'i0';
    return { cv: dirSet[key], meta: fr.meta[v.dir + key] || {} };
  }
  function drawV(v, ctx, t) {
    const x = Math.round(v.x), y = Math.round(v.y);
    ctx.drawImage(shadowSpr(v.shadowW || 12), x - (v.shadowW || 12) / 2 + 1, y - 2);
    const { cv, meta } = frameOf(v, t);
    if (cv) ctx.drawImage(cv, x - AX, y - AY);
    if (v.overlay) v.overlay(v, ctx, t, meta, x - AX, y - AY);
  }

  /* -------------------------------------------------- the five agents + Hudson */
  const CEREMONY_SPOT = { hub: PL.cTock, 'academic-core': PL.cQuill, 'social-ops': PL.cLumi, 'ledger-fi': PL.cGrit, 'hustle-engine': PL.cTwirl };
  const roleOf = (agent, fallback) => { const th = thread(agent); return (th && th.domain) || fallback; };

  const ceremonyHolds = () => CER.active && CER.beat !== 'disperse';
  function agentBrain(v) {
    if (ceremonyHolds()) return;
    const h = HOURS();
    if (asleepAt(h, v.sleep)) {
      if (v.at !== v.home) { go(v, v.home); return; }
      v.sleeping = true; v.hidden = true; v.wait = 5; return;
    }
    if (v.sleeping) { v.sleeping = false; v.hidden = false; }
    // mostly work in the biome; sometimes stroll to the square and back
    let next;
    if (v.visit && v.at !== v.visit && rnd() < v.visitChance) next = v.visit;
    else { const opts = v.work.filter((p) => p !== v.at); next = pick(opts.length ? opts : v.work); }
    go(v, next);
    v.onArrive = (vv) => { vv.wait = vv.at === vv.visit ? rand(6, 11) : rand(v.dwell[0], v.dwell[1]); };
  }

  const tock = makeVillager({
    id: 'hub', agent: 'hub', kind: 'agent', name: 'Mayor Tock', biome: 'square', design: TOCK, speed: 19, h: 26, dy: 33,
    work: [PL.tower, PL.quest, PL.mail, PL.plaza, PL.fountainN], dwell: [7, 14], home: PL.tower, sleep: [23, 5.25], item: 'bell',
    zzz: [528, 236],
  });
  const quill = makeVillager({
    id: 'academic-core', agent: 'academic-core', kind: 'agent', name: 'Abbot Quill', biome: 'monastery', design: QUILL, speed: 17, h: 22, dy: 29,
    work: [PL.templeDoor, PL.stairs, PL.garden], visit: PL.visitQuill, visitChance: 0.22, dwell: [8, 16], home: PL.templeDoor, sleep: [21.5, 5.0], item: 'scroll',
    zzz: [256, 84],
  });
  const grit = makeVillager({
    id: 'ledger-fi', agent: 'ledger-fi', kind: 'agent', name: 'Grit Copperpot', biome: 'mine', design: GRIT, speed: 16, h: 20, dy: 27, shadowW: 14, stepLen: 3,
    work: [PL.mineMouth, PL.ledger, PL.vault], visit: PL.visitGrit, visitChance: 0.18, dwell: [8, 15], home: PL.cottage, sleep: [22, 6], item: 'coins',
    zzz: [1007, 430],
  });
  const lumi = makeVillager({
    id: 'social-ops', agent: 'social-ops', kind: 'agent', name: 'Lumi', biome: 'market', design: LUMI, speed: 24, h: 22, dy: 29,
    work: [PL.angies, PL.film, PL.billboard], visit: PL.visitLumi, visitChance: 0.22, dwell: [6, 12], home: PL.studio, sleep: [1, 8.5], item: 'poster',
    zzz: [958, 72],
  });
  const twirl = makeVillager({
    id: 'hustle-engine', agent: 'hustle-engine', kind: 'agent', name: "Cap'n Twirl", biome: 'port', design: TWIRL, speed: 21, h: 24, dy: 31,
    work: [PL.dock, PL.stalls, PL.bazaar], visit: PL.visitTwirl, visitChance: 0.2, dwell: [7, 14], home: PL.dock, sleep: [22.5, 6], item: 'crate',
    zzz: [72, 520],
  });
  const AGENTS = [tock, quill, grit, lumi, twirl];
  for (const v of AGENTS) { v.brain = agentBrain; v.lines = v === tock ? tockLines() : agentLines(v.agent); }

  const hudson = makeVillager({
    id: 'player', kind: 'player', name: 'Hudson', biome: 'square', design: HUDSON, speed: 23, h: 22, dy: 29,
    work: [PL.h1, PL.h2, PL.h3, PL.h4, PL.h5, PL.h6], dwell: [4, 9], home: PL.innDoor, sleep: [22.5, 6.5],
  });
  hudson.lines = hudsonLines();
  hudson.brain = function (v) {
    if (ceremonyHolds()) return;
    if (asleepAt(HOURS(), v.sleep)) {
      if (v.at !== v.home) { go(v, v.home); return; }
      v.sleeping = true; v.hidden = true; v.wait = 5; return;
    }
    if (v.sleeping) { v.sleeping = false; v.hidden = false; setAt(v, v.home); }
    const opts = v.work.filter((p) => p !== v.at);
    go(v, pick(opts));
    v.onArrive = (vv) => { vv.wait = rand(4, 9); if (vv.at === PL.h5 && openHumanTasks().length && rnd() < 0.6) say(vv, hudson.lines[0], S.t || 0); };
  };

  // Tock's lamp-lit and gadget extras drawn over the sprite
  quill.overlay = (v, ctx, t, meta, ox, oy) => {
    if (v.dir === 'up' || !meta.hand) return;
    const k = Math.sin(t * 7.3) + Math.sin(t * 11.1);
    if (k > 1.2 && !RM) D(ctx, ox + meta.hand[0] + (v.dir === 'left' ? -1 : v.dir === 'right' ? 1 : 0), oy + meta.hand[1] + 4, '#fff6cf');
  };
  const SPIN_COL = ['#3ef0ff', '#ff4fa3', '#f2c94c'];
  twirl.overlay = (v, ctx, t, meta, ox, oy) => {
    if (!meta.hand || v.dir === 'up') return;
    const cx = ox + meta.hand[0] + (v.dir === 'left' ? -1 : v.dir === 'right' ? 1 : 0), cy = oy + meta.hand[1] - 2;
    const a = t * (RM ? 2 : 14);
    D(ctx, cx, cy, '#e8e4ee');
    for (let i = 0; i < 3; i++) {
      const th = a + (i * Math.PI * 2) / 3, lx = Math.round(cx + Math.cos(th) * 2), ly = Math.round(cy + Math.sin(th) * 2);
      D(ctx, lx, ly, SPIN_COL[i]);
      if (!RM) D(ctx, Math.round(cx + Math.cos(th - 0.6) * 2), Math.round(cy + Math.sin(th - 0.6) * 2), 'rgba(255,255,255,0.35)');
    }
  };
  lumi.overlay = (v, ctx, t, meta, ox, oy) => {
    if (v.path || v.at !== PL.film || !meta.hand) return;
    if ((Math.floor(t * 1.5) & 1) && !RM) D(ctx, ox + meta.hand[0] + 2, oy + meta.hand[1] - 1, '#ff3b5c');
  };

  /* -------------------------------------------------- townsfolk */
  const baker = makeVillager({
    id: 'baker', kind: 'ambient', name: 'Baker', design: BAKER, speed: 16, h: 24, sleep: [20, 4.5],
    work: [PL.bakerInn, PL.bakerSq, PL.bakerQuest], home: PL.bakerInn, dwell: [10, 22],
  });
  baker.brain = function (v) {
    if (asleepAt(HOURS(), v.sleep)) { if (v.at !== v.home) { go(v, v.home); return; } v.hidden = true; v.sleeping = true; v.wait = 5; return; }
    if (v.sleeping) { v.sleeping = false; v.hidden = false; }
    const opts = v.work.filter((p) => p !== v.at);
    go(v, pick(opts)); v.onArrive = (vv) => { vv.wait = rand(vv.dwell[0], vv.dwell[1]); };
  };

  const KID_A = [652, 360], KID_B = [710, 358];
  const kid = makeVillager({ id: 'kid', kind: 'ambient', name: 'Kid', design: KID, speed: 30, h: 16, dy: 22, stepLen: 3, shadowW: 10, sleep: [19.5, 7.5] });
  kid.x = KID_A[0]; kid.y = KID_A[1]; kid.kite = { x: KID_A[0] + 18, y: KID_A[1] - 54, vx: 0 };
  kid.brain = function (v) {
    if (asleepAt(HOURS(), v.sleep)) { v.hidden = true; v.sleeping = true; v.wait = 5; return; }
    if (v.sleeping) { v.sleeping = false; v.hidden = false; }
    const tgt = Math.abs(v.x - KID_A[0]) < 2 ? KID_B : KID_A;
    v.path = [[v.x, v.y], [tgt[0], tgt[1] + Math.round(rand(-3, 3))]]; v.pi = 0; v.to = null;
    v.wait = rand(1.5, 5);
  };
  kid.tick = (v, dt, t) => {
    const k = v.kite, wind = Math.sin(t * 0.37) * 10;
    const tx = v.x + 22 + wind, ty = v.y - 58 + Math.sin(t * 1.3) * 5;
    k.x += (tx - k.x) * Math.min(1, dt * 1.2); k.y += (ty - k.y) * Math.min(1, dt * 1.2);
  };

  const CAT_SPOTS = [[600, 283], [538, 406], [512, 266], [444, 316], [470, 384]];
  const cat = makeVillager({ id: 'cat', kind: 'ambient', name: 'Cat', speed: 22, h: 9, dy: 14, shadowW: 10 });
  cat.x = CAT_SPOTS[0][0]; cat.y = CAT_SPOTS[0][1]; cat.mode = 'loaf'; cat.spot = 0;
  cat.brain = function (v) {
    let i = Math.floor(rnd() * CAT_SPOTS.length);
    if (i === v.spot) i = (i + 1) % CAT_SPOTS.length;
    v.spot = i;
    const s = CAT_SPOTS[i], hub = [528 + Math.round(rand(-6, 6)), 338];
    v.path = cleanPath([[v.x, v.y], hub, s]); v.pi = 0; v.to = null;
    const night = S.time.isNight;
    v.onArriveCat = true;
    v.wait = 0;
    v.mode = rnd() < (night ? 0.2 : 0.55) ? 'loaf' : 'sit';
    v.restFor = rand(night ? 6 : 14, night ? 14 : 34);
  };
  cat.tick = (v, dt) => { if (!v.path && v.onArriveCat) { v.onArriveCat = false; v.wait = v.restFor; } void dt; };
  cat.drawFn = (v, ctx, t) => {
    const F = catFrames(), x = Math.round(v.x), y = Math.round(v.y);
    ctx.drawImage(shadowSpr(10), x - 4, y - 2);
    let spr;
    if (v.path) { const set = v.dir === 'right' ? F.right : F.left; spr = set[Math.floor(v.dist / 3) % 4]; }
    else if (v.mode === 'loaf') spr = F.loaf;
    else spr = v.blinkOn > 0 ? F.sitBlink : F.sit;
    ctx.drawImage(spr, x - (spr.width >> 1), y - spr.height + 1);
    if (!v.path && v.mode === 'loaf' && !RM) {
      const ph = (t * 0.5) % 1; ctx.globalAlpha = 0.8 * (1 - ph);
      drawZ(ctx, x + 4 + Math.round(ph * 3), y - 10 - Math.round(ph * 7), false, '#f4f0ff');
      ctx.globalAlpha = 1;
    }
  };

  // Fisher on the Inn's jetty (never walks; goes home at night).
  const FISH = { x: 58, y: 368, tipX: 38, tipY: 354 };
  const fisher = makeVillager({ id: 'fisher', kind: 'ambient', name: 'Fisher', h: 16, sleep: [20.5, 5.25] });
  fisher.x = FISH.x; fisher.y = FISH.y; fisher.biteT = rand(8, 20); fisher.catchT = 0; fisher.wait = 9e9;
  fisher.tick = (v, dt) => {
    v.hidden = asleepAt(HOURS(), v.sleep) && !CER.active;
    if (v.hidden) return;
    v.biteT -= dt;
    if (v.biteT <= 0 && v.catchT <= 0) { v.catchT = 1.6; }
    if (v.catchT > 0) {
      v.catchT -= dt;
      if (v.catchT <= 0) { v.biteT = rand(20, 45); splashes.push({ x: FISH.tipX - 8, y: FISH.y + 10, t: 0 }); if (onScreen(v.x, v.y)) S.audio.sfx('splash'); }
    }
  };
  fisher.drawFn = (v, ctx, t) => {
    if (!fisherSpr) fisherSpr = ascii(FISHER, FISH_PAL);
    const x = Math.round(v.x), y = Math.round(v.y);
    const bite = v.catchT > 0, k = bite ? 1 - v.catchT / 1.6 : 0;
    const tipX = FISH.tipX + (bite ? Math.round(k * 4) : 0), tipY = FISH.tipY + (bite ? Math.round(Math.sin(k * Math.PI) * 4) : Math.round(Math.sin(t * 0.8)));
    ctx.drawImage(fisherSpr, x - 6, y - 16);
    // rod
    S.px.line(ctx, x - 5, y - 8, tipX, tipY, '#6b4426');
    D(ctx, tipX, tipY, '#e8e4ee');
    // line + bobber
    const bx = FISH.tipX - 10, by = FISH.y + 13 + (bite && k < 0.4 ? 2 : Math.round(Math.sin(t * 2.1) * 0.6));
    ctx.fillStyle = 'rgba(240,240,240,0.55)';
    const n = Math.max(1, by - tipY);
    for (let i = 0; i <= n; i += 2) ctx.fillRect(Math.round(tipX + (bx - tipX) * (i / n)), tipY + i, 1, 1);
    if (!(bite && k > 0.45)) { D(ctx, bx, by, '#e8423a'); D(ctx, bx, by - 1, '#ffffff'); }
    if (bite && k > 0.45) { // the catch arcs up out of the water
      const u = (k - 0.45) / 0.55, fx = Math.round(bx + (x - 2 - bx) * u), fy = Math.round(by - Math.sin(u * Math.PI) * 18 + (y - 4 - by) * u);
      R(ctx, fx - 1, fy, 3, 1, '#9fc8d8'); D(ctx, fx + 2, fy - 1, '#6f9fb8'); D(ctx, fx - 1, fy, '#d8f0f8');
    }
  };

  /* ================================================================ bubbles */
  function onScreen(x, y, pad = 0) {
    if (!S.canvas || !S.worldToScreen) return true;
    const p = S.worldToScreen(x, y), w = S.canvas.clientWidth || 0, h = S.canvas.clientHeight || 0;
    return p.x > -pad && p.y > -pad && p.x < w + pad && p.y < h + pad;
  }
  function resolveLine(l) { return typeof l === 'function' ? l() : l; }
  function nextLine(v) {
    const L = v.lines || [];
    for (let k = 0; k < L.length; k++) {
      const l = resolveLine(L[(v.lineIdx + k) % L.length]);
      if (l && l.text) { v.lineIdx = (v.lineIdx + k + 1) % L.length; return l; }
    }
    return null;
  }
  function say(v, line, t) {
    if (!line || !line.text || v.hidden) return;
    const parts = chunks(line.text, line.max || 3);
    v.queue = parts.map((p, i) => ({ text: p, tone: line.tone, at: t + i * 2.7 }));
    v.bubbleUntil = t + parts.length * 2.7 + 0.6;
  }
  function flushSpeech(t) {
    for (const v of villagers) {
      if (!v.queue.length) continue;
      if (v.hidden) { v.queue.length = 0; continue; }
      const q = v.queue[0];
      if (t >= q.at) {
        v.queue.shift();
        const tone = q.tone && q.tone !== 'info' ? q.tone : undefined;
        S.bubble(v, q.text, { tone, biome: v.biome, ms: v.queue.length ? 2700 : 3800, dy: v.dy || 30 });
      }
    }
  }
  let nextBubbleAt = 2 + rnd() * 2;
  function bubbleTick(t) {
    flushSpeech(t);
    if (t < nextBubbleAt) return;
    nextBubbleAt = t + rand(4, 7);
    if (CER.active && CER.beat !== 'disperse') return;
    const pool = AGENTS.concat([hudson]).filter((v) => v.lines && v.lines.length && !v.hidden && !v.sleeping && t > v.bubbleUntil);
    if (!pool.length) return;
    const vis = pool.filter((v) => onScreen(v.x, v.y - 20, -10));
    const cand = vis.length ? vis : pool;
    let tot = 0;
    const wts = cand.map((v) => { const w = (v.agent && alertsFor(v.agent).length ? 1.6 : 1) * (v === hudson ? 0.6 : 1); tot += w; return w; });
    let r = rnd() * tot, i = 0;
    while (i < cand.length - 1 && r > wts[i]) { r -= wts[i]; i++; }
    say(cand[i], nextLine(cand[i]), t);
  }

  /* ================================================================ particles + flights (layer 400) */
  const flights = [];   // arcs of items/coins: {spr, x0,y0,x1,y1, t, dur, h, done}
  const sparks = [];    // {x, y, t, life, col}
  const splashes = [];  // {x, y, t}
  function burst(x, y, col, n) {
    const N = RM ? Math.min(3, n || 6) : n || 6;
    for (let i = 0; i < N; i++) sparks.push({ x: x + rand(-5, 5), y: y + rand(-6, 2), t: -rand(0, 0.35), life: rand(0.5, 0.9), col });
  }
  function fly(spr, x0, y0, x1, y1, dur, h, done) { flights.push({ spr, x0, y0, x1, y1, t: 0, dur, h, done }); }

  /* ================================================================ couriers */
  const rate = (agent, base) => {
    const d = Number((metrics(agent).world || {}).deliveries) || 0;
    return clamp(base / (1 + d * 0.6), base * 0.25, base) * (RM ? 1.6 : 1) * rand(0.75, 1.25);
  };
  const night = () => !!(S.time && S.time.isNight);

  // Carrier birds: school bell cupola -> monastery scroll board -> square mail post.
  const BIRD_PTS = { school: [452, 112, 70], board: [200, 158, 38], mail: [583, 304, 30] };
  const birds = [];
  function launchBird() {
    birds.push({ leg: 0, u: 0, rest: 0, from: BIRD_PTS.school, to: BIRD_PTS.board, dur: 6.5 });
  }
  function birdTick(b, dt) {
    if (b.rest > 0) { b.rest -= dt; if (b.rest <= 0 && b.leg === 1) { b.from = BIRD_PTS.board; b.to = BIRD_PTS.mail; b.u = 0; b.dur = 9; } return; }
    b.u += dt / b.dur;
    if (b.u >= 1) {
      b.u = 1;
      if (b.leg === 0) { b.leg = 1; b.rest = 2.2; if (onScreen(b.to[0], b.to[1])) S.audio.sfx('chirp'); }
      else { b.done = true; burst(b.to[0], b.to[1] - b.to[2], '#fff3b0', 5); }
    }
  }
  function birdPos(b) {
    const u = b.u, e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    const gx = b.from[0] + (b.to[0] - b.from[0]) * e, gy = b.from[1] + (b.to[1] - b.from[1]) * e;
    const alt = b.from[2] + (b.to[2] - b.from[2]) * e + Math.sin(Math.PI * u) * 34;
    return { gx, gy, x: gx, y: gy - alt };
  }

  // Minecarts on the rails: out of the mine mouth, along S.nav.rails to the buffer at the square.
  function railPath() {
    const rails = (S.nav.rails || []).map(([x, y]) => [x * TILE + 8, y * TILE + 8]);
    if (rails.length < 2) return null;
    const pts = [[912, 452], [912, rails[0][1]]].concat(rails);
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const dx = Math.sign(prev[0] - last[0]), dy = Math.sign(prev[1] - last[1]);
    pts[pts.length - 1] = [last[0] + dx * 12, last[1] + dy * 12];
    // round the corners (radius 10, like the mine's rails) and sample every 1 px
    const RAD = 10, out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (i === 0 || i === pts.length - 1) { out.push(p); continue; }
      const a = pts[i - 1], b = pts[i + 1];
      const d1 = [Math.sign(p[0] - a[0]), Math.sign(p[1] - a[1])], d2 = [Math.sign(b[0] - p[0]), Math.sign(b[1] - p[1])];
      const s = [p[0] - d1[0] * RAD, p[1] - d1[1] * RAD], e = [p[0] + d2[0] * RAD, p[1] + d2[1] * RAD];
      for (let k = 0; k <= 8; k++) { const u = k / 8, m = 1 - u; out.push([m * m * s[0] + 2 * m * u * p[0] + u * u * e[0], m * m * s[1] + 2 * m * u * p[1] + u * u * e[1]]); }
    }
    const samp = [out[0]];
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1], b = out[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 1; s <= Math.ceil(d); s++) { const u = Math.min(1, s / Math.ceil(d)); samp.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); }
    }
    return samp;
  }
  let RAIL = null;
  const MCS = {};
  const cart = makeVillager({ id: 'minecart', kind: 'vehicle', h: 10, hidden: true });
  cart.state = 'idle'; cart.s = 0; cart.loaded = true;
  function launchCart() { if (!RAIL || cart.state !== 'idle') return; cart.state = 'out'; cart.s = 0; cart.loaded = true; cart.hidden = false; if (onScreen(912, 480)) S.audio.sfx('cart'); }
  cart.tick = (v, dt) => {
    if (!RAIL || v.state === 'idle') { v.hidden = true; return; }
    const N = RAIL.length - 1, sp = 30;
    if (v.state === 'out') {
      const rem = N - v.s; v.s += dt * (rem < 30 ? Math.max(6, sp * rem / 30) : sp);
      if (v.s >= N - 0.5) { v.s = N; v.state = 'unload'; v.pause = 3.5; burst(RAIL[N][0], RAIL[N][1] - 8, '#fff3b0', 7); if (onScreen(RAIL[N][0], RAIL[N][1])) S.audio.sfx('coin'); }
    } else if (v.state === 'unload') { v.pause -= dt; if (v.pause < 2) v.loaded = false; if (v.pause <= 0) v.state = 'back'; }
    else if (v.state === 'back') { v.s -= dt * sp; if (v.s <= 0) { v.s = 0; v.state = 'idle'; } }
    const i = clamp(Math.floor(v.s), 0, N), j = Math.min(N, i + 1), u = v.s - i;
    const p = RAIL[i], q = RAIL[j];
    v.rx = p[0] + (q[0] - p[0]) * u; v.ry = p[1] + (q[1] - p[1]) * u;
    const a = RAIL[Math.max(0, i - 3)], b = RAIL[Math.min(N, i + 3)];
    v.horiz = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
    v.x = v.rx; v.y = v.ry + 5;
    v.hidden = v.ry < 466;
  };
  cart.drawFn = (v, ctx, t) => {
    const key = (v.horiz ? 's' : 'f') + (v.loaded ? 1 : 0);
    if (!MCS[key]) MCS[key] = minecart(v.horiz, v.loaded);
    const spr = MCS[key], moving = v.state === 'out' || v.state === 'back';
    const bob = moving && !RM ? Math.floor(t * 12) & 1 : 0;
    const x = Math.round(v.rx), y = Math.round(v.ry);
    ctx.drawImage(shadowSpr(spr.width - 2), x - (spr.width >> 1) + 2, y + 3);
    ctx.drawImage(spr, x - (spr.width >> 1), y - spr.height + 5 - bob);
  };

  // Floating lanterns: from the market, drifting over to the square.
  const lanterns = [];
  const LANTERN_FROM = [[760, 140], [846, 110], [900, 160]], LANTERN_TO = [[548, 296], [586, 292], [470, 300], [520, 318]];
  const lanternLights = [];
  for (let i = 0; i < 4; i++) lanternLights.push(light({ x: -99, y: -99, r: 14, color: P.lantern, intensity: 0.75, flicker: 0.12, on: () => lanternLights[i]._on }));
  function launchLantern() {
    if (lanterns.length >= 4) return;
    const a = pick(LANTERN_FROM), b = pick(LANTERN_TO);
    lanterns.push({ a, b, u: 0, dur: rand(16, 22), ph: rnd() * 6, light: lanternLights.find((l) => !l._on) || null });
  }

  // Cargo skiff down the river lane to the dock, then a porter carries the crate to the square.
  function boatPath() {
    const x = Math.max(16, (S.nav.riverLaneX || 2) * TILE - 10), pts = [[x, -30], [x, 532]];
    for (let k = 1; k <= 10; k++) { const a = Math.PI - (k / 10) * (Math.PI / 2); pts.push([x + 24 + Math.cos(a) * 24, 532 + Math.sin(a) * 24]); }
    pts.push([66, 556]);
    return pts;
  }
  const BOAT_PTS = boatPath(), BOAT_LEN = pathLen(BOAT_PTS) || 1;
  function along(pts, s) {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + d >= s || i === pts.length - 1) { const u = d ? clamp((s - acc) / d, 0, 1) : 0; return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, dx: b[0] - a[0], dy: b[1] - a[1] }; }
      acc += d;
    }
    return { x: pts[0][0], y: pts[0][1], dx: 0, dy: 1 };
  }
  const BOATS = {};
  const boatLight = light({ x: -99, y: -99, r: 16, color: P.lanternGlow, intensity: 0.7, flicker: 0.1, on: () => !boat.hidden });
  const boat = makeVillager({ id: 'skiff', kind: 'vehicle', h: 12, hidden: true });
  boat.state = 'idle'; boat.s = 0; boat.loaded = true;
  function launchBoat() { if (boat.state !== 'idle') return; boat.state = 'in'; boat.s = 0; boat.loaded = true; boat.hidden = false; }
  boat.tick = (v, dt) => {
    if (v.state === 'idle') { v.hidden = true; return; }
    const sp = 26;
    if (v.state === 'in') {
      const rem = BOAT_LEN - v.s; v.s += dt * (rem < 40 ? Math.max(5, sp * rem / 40) : sp);
      if (v.s >= BOAT_LEN - 0.5) { v.s = BOAT_LEN; v.state = 'docked'; v.loaded = false; startPorter(); if (onScreen(66, 556)) S.audio.sfx('splash'); }
    } else if (v.state === 'out') { v.s -= dt * sp; if (v.s <= 0) { v.s = 0; v.state = 'idle'; } }
    const p = along(BOAT_PTS, v.s);
    v.bx = p.x; v.by = p.y; v.horiz = Math.abs(p.dx) > Math.abs(p.dy);
    v.x = v.bx; v.y = v.by + (v.horiz ? 6 : 10);
    v.hidden = false;
    boatLight.x = v.bx + (v.horiz ? -8 : 0); boatLight.y = v.by - (v.horiz ? 4 : 8);
  };
  boat.drawFn = (v, ctx, t) => {
    const key = (v.horiz ? 'h' : 'v') + (v.loaded ? 1 : 0);
    if (!BOATS[key]) BOATS[key] = skiff(v.horiz, v.loaded);
    const spr = BOATS[key], x = Math.round(v.bx), y = Math.round(v.by);
    const bob = RM ? 0 : Math.round(Math.sin(t * 2.4));
    const moving = v.state === 'in' || v.state === 'out';
    // wake
    if (moving && !RM) {
      ctx.fillStyle = 'rgba(216,238,245,0.6)';
      for (let k = 0; k < 6; k++) {
        const ph = (t * 3 + k * 0.6) % 4;
        if (v.horiz) { const wx = x - 14 - k * 3; ctx.fillRect(wx, y + 2 - Math.round(ph / 2), 2, 1); ctx.fillRect(wx, y + 6 + Math.round(ph / 2), 2, 1); }
        else { const wy = y - 14 - k * 3 + (v.state === 'out' ? 28 + k * 6 : 0); ctx.fillRect(x - 5 - Math.round(ph / 2), wy, 1, 2); ctx.fillRect(x + 5 + Math.round(ph / 2), wy, 1, 2); }
      }
    } else if (!RM) {
      ctx.fillStyle = 'rgba(216,238,245,0.45)';
      const ph = Math.floor(t * 1.2) % 3;
      ctx.fillRect(x - 12 - ph, y + 7, 3, 1); ctx.fillRect(x + 10 + ph, y + 7, 3, 1);
    }
    if (v.horiz) ctx.drawImage(spr, x - 13, y - 9 + bob);
    else ctx.drawImage(spr, x - 7, y - 12 + bob);
  };

  const porter = makeVillager({ id: 'porter', kind: 'ambient', name: 'Porter', design: PORTER, designAlt: PORTER_CARRY, speed: 19, h: 22, hidden: true });
  porter.wait = 9e9;
  const crates = [];   // delivered crates resting in the square: {x, y, t}
  function startPorter() {
    setAt(porter, PL.pier); porter.hidden = false; porter.carrying = true; porter.wait = 0.6;
    porter.brain = (v) => {
      v.brain = null;
      go(v, PL.crateDrop);
      v.onArrive = (vv) => {
        vv.carrying = false;
        const c = { x: PL.crateDrop.px[0] - 1, y: PL.crateDrop.px[1] - 3, t: 0 };
        crates.push(c); burst(c.x, c.y - 4, '#fff3b0', 6);
        vv.wait = 1.2;
        vv.brain = (w) => { w.brain = null; go(w, PL.pier); w.onArrive = (z) => { z.hidden = true; z.wait = 9e9; boat.state = 'out'; boat.loaded = false; }; };
      };
    };
  }
  const crateEnt = makeVillager({ id: 'crates', kind: 'prop', h: 6 });
  crateEnt.x = PL.crateDrop.px[0]; crateEnt.y = PL.crateDrop.px[1] - 2; crateEnt.wait = 9e9;
  crateEnt.tick = (v, dt) => {
    for (let i = crates.length - 1; i >= 0; i--) { crates[i].t += dt; if (crates[i].t > 28) { burst(crates[i].x, crates[i].y - 3, '#fff3b0', 5); crates.splice(i, 1); } }
    v.hidden = !crates.length;
  };
  crateEnt.drawFn = (v, ctx) => {
    const spr = itemSprite('crate');
    for (const c of crates) { ctx.drawImage(shadowSpr(10), c.x - 4, c.y + 1); ctx.drawImage(spr, Math.round(c.x) - 4, Math.round(c.y) - 6); }
  };

  // Friday payday: the innkeeper wheels a coin cart from Hudson House Inn to the vault.
  const keeper = makeVillager({ id: 'innkeeper', kind: 'ambient', name: 'Innkeeper', design: INNKEEPER, speed: 17, h: 22, hidden: true });
  keeper.wait = 9e9; keeper.cartLoaded = true;
  const HC = {};
  function startPayday() {
    if (!keeper.hidden) return;
    setAt(keeper, PL.innDoor); keeper.hidden = false; keeper.cartLoaded = true; keeper.wait = 0.8;
    keeper.brain = (v) => {
      v.brain = null;
      go(v, PL.vaultDrop);
      v.onArrive = (vv) => {
        vv.dir = 'down';
        for (let i = 0; i < 5; i++) {
          setTimeoutT(i * 0.45, () => {
            fly(itemSprite('coins'), vv.x + 2, vv.y + 2, 764 + rand(-3, 3), 556, 0.7, 12, (f) => { burst(f.x1, f.y1, '#fff3b0', 4); if (i === 0 && onScreen(764, 556)) S.audio.sfx('coin'); });
            if (i === 3) vv.cartLoaded = false;
          });
        }
        vv.wait = 3.5;
        vv.brain = (w) => { w.brain = null; go(w, PL.innDoor); w.onArrive = (z) => { z.hidden = true; z.wait = 9e9; }; };
      };
    };
  }
  keeper.overlay = (v, ctx) => {
    const d = v.dir, k = (d === 'left' || d === 'right' ? 'right' : d) + (v.cartLoaded ? 1 : 0);
    if (!HC[k]) HC[k] = d === 'left' || d === 'right' ? handcart('right', v.cartLoaded) : handcart(d, v.cartLoaded);
    let spr = HC[k];
    const x = Math.round(v.x), y = Math.round(v.y);
    if (d === 'left') { if (!HC[k + 'L']) HC[k + 'L'] = flip(spr); spr = HC[k + 'L']; ctx.drawImage(spr, x - 20, y - 11); }
    else if (d === 'right') ctx.drawImage(spr, x + 2, y - 11);
    else if (d === 'down') ctx.drawImage(spr, x - 7, y - 3);
  };
  keeper.drawFn = (v, ctx, t) => {
    if (v.dir === 'up') { // cart ahead (behind the keeper on screen)
      const k = 'up' + (v.cartLoaded ? 1 : 0); if (!HC[k]) HC[k] = handcart('up', v.cartLoaded);
      ctx.drawImage(HC[k], Math.round(v.x) - 7, Math.round(v.y) - 24);
    }
    drawV(v, ctx, t);
  };

  // A tiny timer list driven by the frame clock (no real timeouts, so pausing works).
  const timers = [];
  let clock = 0;
  function setTimeoutT(s, fn) { timers.push({ at: clock + s, fn }); }

  /* ================================================================ the cycle ceremony */
  const CER = { active: false, beat: null, rung: 0, nextRing: 0, handed: 0, slots: [], rate: 1 / 75, lastP: null, endSaid: false };
  function ceremonyName(c) {
    if (c.name && c.name !== 'manual') return c.name;
    const l = S.cycle && S.cycle.last;
    return l ? l.name : 'cycle';
  }
  function beatOf(p) {
    const B = S.CEREMONY_BEATS || { bell: [0, 0.15], gather: [0.15, 0.45], council: [0.45, 0.7], disperse: [0.7, 1] };
    return p < B.bell[1] ? 'bell' : p < B.gather[1] ? 'gather' : p < B.council[1] ? 'council' : 'disperse';
  }
  const secsLeft = (p, end) => Math.max(0.5, (end - p) / Math.max(1e-4, CER.rate));
  function wake(v) { if (v.hidden && v.sleeping) { v.sleeping = false; v.hidden = false; setAt(v, v.home); } }
  function beginCeremony(c) {
    CER.active = true; CER.beat = null; CER.rung = 0; CER.handed = 0; CER.endSaid = false; CER.lastP = c.progress;
    CER.rate = c.name === 'manual' ? 1 / 75 : 1 / 330;
    for (const v of AGENTS) { wake(v); v.queue.length = 0; }
    const p = c.progress, B = S.CEREMONY_BEATS;
    if (p >= B.council[0] && p < B.council[1]) {   // joined late: they are already gathered
      for (const v of AGENTS) setAt(v, CEREMONY_SPOT[v.agent]);
      if (!hudson.hidden) setAt(hudson, PL.cHudson);
    }
  }
  function endCeremony() {
    CER.active = false; CER.beat = null;
    for (const v of AGENTS.concat([hudson])) { v.pose = null; v.hurry = 1; v.wait = Math.min(v.wait, rand(0.5, 3)); }
  }
  function enterBeat(beat, c) {
    CER.beat = beat;
    const p = c.progress, B = S.CEREMONY_BEATS;
    if (beat === 'bell') {
      if (tock.at !== PL.tower) go(tock, PL.tower, 1.6);
      tock.onArrive = null;
      say(tock, { text: 'Ding! The ' + ceremonyName(c) + ' cycle', tone: 'info' }, clock);
    }
    if (beat === 'gather' || beat === 'council') {
      tock.pose = null;
      const left = secsLeft(p, B.gather[1]);
      for (const v of AGENTS.concat(hudson.hidden ? [] : [hudson])) {
        const spot = v === hudson ? PL.cHudson : CEREMONY_SPOT[v.agent];
        if (v.at === spot) continue;
        const est = pathLen(v.path ? [[v.x, v.y]].concat(v.path.slice(v.pi)) : planPath(v.at || spot, spot));
        go(v, spot, clamp(est / (v.speed * left * 0.9), 1, 3.2));
        v.onArrive = null; v.wait = 0;
      }
    }
    if (beat === 'council') {
      const dur = secsLeft(p, B.council[1]), order = [quill, grit, lumi, twirl];
      CER.slots = order.map((v, i) => ({ v, at: clock + 0.6 + (i * dur * 0.8) / order.length, done: false }));
    }
    if (beat === 'disperse') {
      for (const v of AGENTS.concat([hudson])) { v.pose = null; v.hurry = 1; v.onArrive = null; if (!v.path) v.wait = rand(0.3, 2.5); }
      if (!CER.endSaid) { CER.endSaid = true; say(tock, { text: 'Reports in. Back to work!', tone: 'info' }, clock); }
    }
  }
  function faceTo(v, x, y) {
    const dx = x - v.x, dy = y - v.y;
    v.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
  }
  function ceremonyTick(dt) {
    const c = S.cycle && S.cycle.ceremony;
    if (!c) { if (CER.active) endCeremony(); return; }
    if (!CER.active) beginCeremony(c);
    if (CER.lastP != null && c.progress > CER.lastP && dt > 0) CER.rate = CER.rate * 0.9 + ((c.progress - CER.lastP) / dt) * 0.1;
    CER.lastP = c.progress;
    const beat = beatOf(c.progress);
    if (beat !== CER.beat) enterBeat(beat, c);
    if (beat === 'bell') {
      if (tock.at === PL.tower) {
        tock.dir = 'down'; tock.pose = 'raise';
        if (clock >= CER.nextRing && CER.rung < 3) {
          CER.rung++; CER.nextRing = clock + 1.7;
          S.audio.sfx('bell');
        }
      }
      tock.pose = tock.at === PL.tower ? (Math.floor(clock * 4) & 1 ? 'raise' : null) : null;
    } else if (beat === 'council') {
      for (const v of AGENTS.concat([hudson])) if (!v.path && !v.hidden) { if (v === tock) v.dir = 'down'; else faceTo(v, tock.x, tock.y); }
      for (const s of CER.slots) {
        if (s.done || clock < s.at || s.v.path) continue;
        s.done = true;
        const v = s.v;
        fly(itemSprite(v.item), v.x, v.y - 12, tock.x, tock.y - 14, 0.9, 16, (f) => {
          burst(f.x1, f.y1, '#fff3b0', 8);
          if (v.item === 'coins') S.audio.sfx('coin');
        });
        say(v, nextLine(v), clock);
      }
    }
  }

  /* ================================================================ Zzz + marker */
  const Z_BIG = ['#####', '...#.', '..#..', '.#...', '#####'], Z_SMALL = ['####', '..#.', '.#..', '####'];
  function drawZ(ctx, x, y, big, col) {
    const rows = big ? Z_BIG : Z_SMALL;
    ctx.fillStyle = 'rgba(29,26,36,0.7)';
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') { ctx.fillRect(x + i + 1, y + j + 1, 1, 1); ctx.fillRect(x + i - 1, y + j, 1, 1); ctx.fillRect(x + i, y + j - 1, 1, 1); } });
    ctx.fillStyle = col || '#e9e6ff';
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') ctx.fillRect(x + i, y + j, 1, 1); });
  }

  /* ================================================================ lights following people */
  const quillLamp = light({ x: -99, y: -99, r: 20, color: P.lanternGlow, intensity: 0.8, flicker: 0.12, on: () => !quill.hidden });
  const gritLamp = light({ x: -99, y: -99, r: 16, color: '#fff2b0', intensity: 0.7, on: () => !grit.hidden });
  const lumiGlow = light({ x: -99, y: -99, r: 13, color: P.neonCyan, intensity: 0.45, on: () => !lumi.hidden });
  function followLights() {
    const hm = (v) => { const fr = v.fr.meta[v.dir + (v.path ? 'w0' : 'i0')]; return fr && fr.hand; };
    const qh = hm(quill);
    quillLamp.x = qh && quill.dir !== 'up' ? Math.round(quill.x) - AX + qh[0] : Math.round(quill.x); quillLamp.y = qh && quill.dir !== 'up' ? Math.round(quill.y) - AY + qh[1] + 4 : Math.round(quill.y) - 14;
    gritLamp.x = Math.round(grit.x) + (grit.dir === 'left' ? -3 : grit.dir === 'right' ? 3 : 0); gritLamp.y = Math.round(grit.y) - 20;
    lumiGlow.x = Math.round(lumi.x); lumiGlow.y = Math.round(lumi.y) - 12;
  }

  /* ================================================================ hotspots */
  function addVillagerHotspot(v, label, agent) {
    S.addHotspot({
      id: 'villager:' + (agent || v.id), kind: 'villager', agent: agent || null, character: v.name, biome: v.biome,
      label, priority: 2,
      rect: () => (v.hidden ? null : { x: Math.round(v.x) - 8, y: Math.round(v.y) - v.h, w: 16, h: v.h + 3 }),
    });
  }
  addVillagerHotspot(tock, 'Mayor Tock, the Director', 'hub');
  addVillagerHotspot(quill, 'Abbot Quill, ' + roleOf('academic-core', 'School'), 'academic-core');
  addVillagerHotspot(grit, 'Grit Copperpot, ' + roleOf('ledger-fi', 'Finances'), 'ledger-fi');
  addVillagerHotspot(lumi, 'Lumi, ' + roleOf('social-ops', 'Social media'), 'social-ops');
  addVillagerHotspot(twirl, "Cap'n Twirl, " + roleOf('hustle-engine', 'Side hustles'), 'hustle-engine');
  addVillagerHotspot(hudson, ((data.player && data.player.name) || 'Hudson') + ', that’s you', null);
  S.villagers = { list: villagers, byId };

  /* ================================================================ spawn schedule */
  const sched = { bird: 0, cart: 0, lantern: 0, boat: 0, payday: 0 };
  function scheduleTick(t) {
    if (t >= sched.bird) { sched.bird = t + rate('academic-core', 75); if (!(night() && rnd() < 0.6)) launchBird(); }
    if (t >= sched.cart) { sched.cart = t + rate('ledger-fi', 80); launchCart(); }
    if (t >= sched.lantern) { sched.lantern = t + rate('social-ops', 60); launchLantern(); }
    if (t >= sched.boat) { sched.boat = t + rate('hustle-engine', 110); launchBoat(); }
    if (S.time.isPayday && t >= sched.payday) {
      sched.payday = t + (RM ? 220 : 140) * rand(0.8, 1.2);
      const h = HOURS();
      if (h > 6.5 && h < 21.5) startPayday();
    }
  }

  /* ================================================================ boot */
  S.on('boot', () => {
    RAIL = railPath();
    const h = HOURS();
    const startAt = (v) => {
      if (v.sleep && asleepAt(h, v.sleep) && v.home) { setAt(v, v.home); v.hidden = true; v.sleeping = true; }
      else setAt(v, pick(v.work));
    };
    for (const v of AGENTS) startAt(v);
    startAt(hudson);
    startAt(baker);
    kid.hidden = asleepAt(h, kid.sleep); kid.sleeping = kid.hidden;
    fisher.hidden = asleepAt(h, fisher.sleep);
    // stagger the first deliveries so the world wakes up gently
    sched.bird = 3 + rnd() * 8; sched.cart = 1 + rnd() * 6; sched.lantern = 2 + rnd() * 6; sched.boat = 4 + rnd() * 10; sched.payday = 3 + rnd() * 6;
    // something already under way on load
    if (RAIL) { cart.state = 'out'; cart.s = Math.floor(RAIL.length * rand(0.35, 0.6)); cart.hidden = false; }
    launchLantern(); if (lanterns[0]) lanterns[0].u = rand(0.3, 0.6);
  });
  S.on('ceremony:start', () => { CER.lastP = null; });

  /* per-frame driver: an invisible entity keeps the update order simple */
  const driver = makeVillager({ id: 'driver', kind: 'system', hidden: true, y: -1e6 });
  driver.wait = 9e9;
  driver.tick = (v, dt, t) => {
    clock = t;
    for (let i = timers.length - 1; i >= 0; i--) if (clock >= timers[i].at) { const f = timers[i].fn; timers.splice(i, 1); f(); }
    ceremonyTick(dt);
    scheduleTick(t);
    bubbleTick(t);
    followLights();
    for (let i = birds.length - 1; i >= 0; i--) { birdTick(birds[i], dt); if (birds[i].done) birds.splice(i, 1); }
    for (let i = lanterns.length - 1; i >= 0; i--) {
      const L = lanterns[i]; L.u += dt / L.dur;
      if (L.u >= 1) { burst(L.b[0], L.b[1] - 8, '#ffd27a', 5); if (L.light) L.light._on = false; lanterns.splice(i, 1); }
    }
    for (let i = flights.length - 1; i >= 0; i--) { const f = flights[i]; f.t += dt; if (f.t >= f.dur) { flights.splice(i, 1); if (f.done) f.done(f); } }
    for (let i = sparks.length - 1; i >= 0; i--) { sparks[i].t += dt; if (sparks[i].t > sparks[i].life) sparks.splice(i, 1); }
    for (let i = splashes.length - 1; i >= 0; i--) { splashes[i].t += dt; if (splashes[i].t > 0.8) splashes.splice(i, 1); }
  };

  /* ================================================================ layer 400: things above people */
  S.registerDynamic(400, (ctx, t) => {
    // kite on a long string
    if (!kid.hidden) {
      if (!kiteSpr) kiteSpr = kiteSprite();
      const k = kid.kite, hx = Math.round(kid.x) + 3, hy = Math.round(kid.y) - 10;
      const kx = Math.round(k.x), ky = Math.round(k.y);
      ctx.fillStyle = 'rgba(245,240,230,0.7)';
      const n = Math.max(Math.abs(kx - hx), Math.abs(ky - hy));
      for (let i = 0; i <= n; i += 1) { const u = i / n, sag = Math.sin(u * Math.PI) * 4; ctx.fillRect(Math.round(hx + (kx - hx) * u), Math.round(hy + (ky - hy) * u + sag), 1, 1); }
      for (let j = 0; j < 5; j++) { const tx = kx + 1 - j * 2 + Math.round(Math.sin(t * 5 + j) * 1.5), ty = ky + 10 + j * 3; D(ctx, tx, ty, j % 2 ? '#e8423a' : P.gold); }
      ctx.drawImage(kiteSpr, kx - 5, ky - 1);
    }
    // carrier birds with ground shadows
    if (!birdFr) birdFr = birdFrames();
    for (const b of birds) {
      const p = birdPos(b), flap = b.rest > 0 ? 1 : Math.floor(t * 10) % 3;
      ctx.fillStyle = 'rgba(20,16,30,0.18)'; ctx.fillRect(Math.round(p.gx) - 2, Math.round(p.gy), 4, 1);
      const spr = birdFr[b.rest > 0 ? 1 : flap];
      const left = b.to[0] < b.from[0];
      if (left) { ctx.save(); ctx.scale(-1, 1); ctx.drawImage(spr, -Math.round(p.x) - 3, Math.round(p.y) - 3); ctx.restore(); }
      else ctx.drawImage(spr, Math.round(p.x) - 3, Math.round(p.y) - 3);
      // a tiny letter tied on
      D(ctx, Math.round(p.x) + (left ? 1 : -1), Math.round(p.y) + 1, '#f3e6c4');
    }
    // floating lanterns
    if (!lanternSpr) lanternSpr = lanternSprite();
    for (const L of lanterns) {
      const u = L.u, e = u * u * (3 - 2 * u);
      const x = L.a[0] + (L.b[0] - L.a[0]) * e + Math.sin(t * 0.9 + L.ph) * 4;
      const y = L.a[1] + (L.b[1] - L.a[1]) * e - Math.sin(Math.PI * u) * 46 - (u < 0.1 ? 0 : 0);
      const a = u < 0.08 ? u / 0.08 : u > 0.9 ? (1 - u) / 0.1 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = 'rgba(20,16,30,0.12)'; ctx.fillRect(Math.round(L.a[0] + (L.b[0] - L.a[0]) * e) - 2, Math.round(L.a[1] + (L.b[1] - L.a[1]) * e) + 4, 5, 1);
      ctx.drawImage(lanternSpr, Math.round(x) - 3, Math.round(y) - 4);
      if (!RM && (Math.floor(t * 6 + L.ph) % 5 === 0)) D(ctx, Math.round(x), Math.round(y) - 1, '#ffffff');
      ctx.globalAlpha = 1;
      if (L.light) { L.light._on = true; L.light.x = Math.round(x); L.light.y = Math.round(y); }
    }
    // items handed over, coins hopping
    for (const f of flights) {
      const u = clamp(f.t / f.dur, 0, 1);
      const x = f.x0 + (f.x1 - f.x0) * u, y = f.y0 + (f.y1 - f.y0) * u - Math.sin(Math.PI * u) * f.h;
      ctx.drawImage(f.spr, Math.round(x) - (f.spr.width >> 1), Math.round(y) - (f.spr.height >> 1));
    }
    // splashes
    for (const s of splashes) {
      const r = 2 + Math.round(s.t * 8);
      ctx.fillStyle = `rgba(216,238,245,${(0.8 * (1 - s.t / 0.8)).toFixed(2)})`;
      ctx.fillRect(s.x - r, s.y, 2, 1); ctx.fillRect(s.x + r - 1, s.y, 2, 1); ctx.fillRect(s.x - 1, s.y - 1 - Math.round(s.t * 6), 1, 2);
    }
    // sparkles
    for (const s of sparks) {
      if (s.t < 0) continue;
      const k = 1 - s.t / s.life;
      if (RM) { D(ctx, Math.round(s.x), Math.round(s.y - s.t * 6), s.col); continue; }
      sparkleAt(ctx, s.x, s.y - s.t * 10, k, s.col);
    }
  });

  /* ================================================================ layer 700: Zzz over the dark */
  S.registerDynamic(700, (ctx, t) => {
    for (const v of AGENTS.concat([hudson])) {
      if (!v.sleeping || !v.zzz) continue;
      const [zx, zy] = v.zzz;
      for (let i = 0; i < 3; i++) {
        const ph = ((t * (RM ? 0.15 : 0.32)) + i / 3) % 1;
        ctx.globalAlpha = Math.min(1, ph * 4, (1 - ph) * 2) * 0.85;
        drawZ(ctx, Math.round(zx + ph * 10 + Math.sin(ph * 6) * 1.5), Math.round(zy - ph * 20), i !== 1);
      }
      ctx.globalAlpha = 1;
    }
  });

  /* ================================================================ layer 800: player marker */
  S.registerDynamic(800, (ctx, t) => {
    if (hudson.hidden) return;
    const x = Math.round(hudson.x), y = Math.round(hudson.y) - 31 + (RM ? 0 : Math.round(Math.sin(t * 3.2)));
    R(ctx, x - 3, y - 1, 7, 1, INK); R(ctx, x - 3, y, 7, 1, INK); R(ctx, x - 2, y + 1, 5, 1, INK); R(ctx, x - 1, y + 2, 3, 1, INK); D(ctx, x, y + 3, INK);
    R(ctx, x - 2, y, 5, 1, P.gold); R(ctx, x - 1, y + 1, 3, 1, P.goldDark); D(ctx, x, y + 2, P.goldDark); D(ctx, x - 2, y, '#fff2b8');
  });
})();
