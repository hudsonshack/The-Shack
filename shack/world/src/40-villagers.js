/* The Shack v2 — VILLAGERS: every character and every moving vehicle.
 *
 * Characters (y-sorted entities, 1.5x the v1 size: ~18-24 px wide, 27-33 px tall):
 *   Mayor Tock (hub, never leaves Clockspire), Abbot Quill (academic-core),
 *   Grit Copperpot (ledger-fi), Lumi (social-ops), Cap'n Twirl (hustle-engine),
 *   Hudson (the player, wanders Clockspire) and three islanders: a bun seller on
 *   Neon Hollow, a kid flying a kite on Spindrift Harbor and a cat on Clockspire.
 *   Sprites are painted in code at load: 4 directions x 4-frame walk cycle, idle
 *   breathing and blinks, poses (bell, hang, carry), selective 1 px outline and
 *   3+ tones lit from the top-left. Bouncy walk + footstep dust puffs.
 *
 * Travel (S.route legs): walk legs follow the island paths; transport legs ride the
 * island's vehicle, all of which are owned here:
 *   kite   Lantern Peak <-> Clockspire  big paper glider kite, Quill hangs from its bar
 *   blimp  Neon Hollow  <-> Clockspire  neon blimp, Lumi rides in the gondola
 *   ship   Spindrift    <-> Clockspire  small sailing sky-ship, Twirl at the wheel
 *   rail   Copperhold   <-> Clockspire  minecart following S.nav.rails exactly
 * Each vehicle idles at its home dock (kite folded on the pad, blimp moored at the
 * mast, ship at the pier head, cart at the station). Characters carry .island while
 * on an island and null while crossing space; vehicles in space bob with
 * S.bobBetween(home, 'square', u).
 *
 * Deliveries: metrics.world.deliveries > 0 sends parcels (scroll, coins, poster,
 * crate) over on the island's vehicle; Mayor Tock walks to the dock, collects them
 * and posts them at the mail post. With no deliveries the vehicles only make the
 * occasional empty run (no parcel is ever invented).
 * Cycle ceremony (S.cycle.ceremony + S.CEREMONY_BEATS): bell, everyone travels to
 * Clockspire by their transport, gathers at the fountain, hands over their item,
 * travels home. Friday payday (S.time.isPayday): a little gold sky-cart flies in
 * from the edge of space to the Copperhold vault every so often.
 * Night: most head home ("Zzz"; Lumi and Twirl sleep aboard their vehicles).
 * Bubbles carry only real data (metrics.world.bubbles, thread summaries, alerts)
 * or honest empty-state lines, about one every 4-7 s world-wide.
 *
 * Layers: entities 300 (people, vehicles; flying vehicles sort last),
 *   200 footstep dust {island}, 400 hand-overs, sparkles, kite string,
 *   700 Zzz + neon/lamp glows, 800 the player marker.
 * Hotspots: kind 'villager', priority 2, rect() follows the sprite incl. bob.
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S || !S.islands || !S.nav || !S.route) return;

  const P = S.PAL, T = S.TILE, RM = !!S.reducedMotion;
  const shade = S.color.shade, mix = S.color.mix;
  const INK = P.outline;
  const rnd = S.rng(40712);
  const rand = (a, b) => a + (b - a) * rnd();
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, u) => a + (b - a) * u;
  const smooth = (u) => u * u * (3 - 2 * u);
  const sfx = (name) => { try { if (S.audio && typeof S.audio.sfx === 'function') S.audio.sfx(name); } catch (e) { /* sound is optional */ } };

  function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
  const R = (g, x, y, w, h, c) => { if (w <= 0 || h <= 0) return; g.fillStyle = c; g.fillRect(x, y, w, h); };
  const D = (g, x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  const rampCache = {};
  function ramp(hex) {
    if (!rampCache[hex]) rampCache[hex] = { hi: shade(hex, 0.38), lt: shade(hex, 0.18), b: hex, sh: shade(hex, -0.22), dk: shade(hex, -0.45) };
    return rampCache[hex];
  }

  /* ================================================================ sprite toolkit */

  /** Selective 1 px outline: each empty pixel touching the sprite takes a darkened
   *  version of its neighbour's colour (softer than flat black at 3x zoom). */
  function outline(cv, k = 0.72) {
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
  /** Paint with fn(g) on a padded canvas, then outline it. */
  function paint(w, h, fn, k) {
    const c = mk(w + 2, h + 2), g = c.getContext('2d');
    g.translate(1, 1); fn(g); g.setTransform(1, 0, 0, 1, 0, 0);
    return k === false ? c : outline(c, k);
  }
  /** Filled ellipse, row by row (integer pixels). */
  function ell(g, cx, cy, rx, ry, col) {
    for (let y = -ry; y <= ry; y++) { const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / ((ry + 0.4) * (ry + 0.4))))); R(g, cx - w, cy + y, w * 2 + 1, 1, col); }
  }

  /* ================================================================ human painter
   * Canvas CWxCH; feet (the anchor) at (CX, FY). Builds are in native pixels and
   * already 1.5x the v1 figures. The painter works facing 'down', 'up' or 'side'
   * (left); right-facing frames are mirrored.
   */
  const CW = 48, CH = 52, CX = 24, FY = 47;
  const EYE = '#231e2c';
  const BUILD = {
    normal: { hw: 14, hh: 13, tw: 12, th: 8, leg: 7, lw: 4, aw: 3 },
    dwarf: { hw: 14, hh: 12, tw: 16, th: 8, leg: 5, lw: 5, aw: 3, overlap: 1 },
    kid: { hw: 12, hh: 11, tw: 10, th: 6, leg: 5, lw: 3, aw: 2 },
  };
  const HEAD_IN = { 13: [3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3], 12: [3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3], 11: [3, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2] };
  const blushOf = (skin) => mix(skin, '#ff6f7d', 0.42);

  function paintHuman(g, Dz, dir, o, meta) {
    const L = BUILD[Dz.build || 'normal'];
    const walk = !!o.walk, f = walk ? o.f : 0;
    const up = walk && (f & 1) ? 1 : 0;                       // passing frames: body rises (bouncy)
    const legTop0 = FY - L.leg + 1, ty0 = legTop0 - L.th;
    const c = {
      g, D: Dz, L, dir, f, walk, o, meta,
      hw: L.hw, hh: L.hh, tw: L.tw, th: L.th, aw: L.aw,
      hx: CX - (L.hw >> 1), tx: CX - (L.tw >> 1),
      ty: ty0 - up, legTop: legTop0 - up, fy: FY,
      skin: ramp(Dz.skin),
    };
    c.hy = c.ty - L.hh + (L.overlap || 0) + (o.breath ? 1 : 0);
    c.ey = c.hy + (L.hh >= 13 ? 6 : 5);
    c.swingL = walk ? (f === 1 ? 1 : f === 3 ? -1 : 0) : 0; c.swingR = -c.swingL;
    c.liftL = walk && f === 1 ? 2 : 0; c.liftR = walk && f === 3 ? 2 : 0;
    c.pose = o.pose || null;
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
    meta.top = c.hy - (Dz.hatH || 1);
  }

  function headShape(c) {
    const { g, hx, hy, hw, hh, skin, dir } = c, ins = HEAD_IN[hh];
    for (let i = 0; i < hh; i++) {
      const s = ins[i];
      R(g, hx + s, hy + i, hw - 2 * s, 1, skin.b);
      D(g, hx + hw - 1 - s, hy + i, skin.sh);
      if (i >= hh - 4 && i < hh - 1) D(g, hx + hw - 2 - s, hy + i, skin.sh);
    }
    R(g, hx + 3, hy + hh - 2, hw - 6, 1, skin.sh);
    D(g, hx + 2, hy + 2, skin.lt); D(g, hx + 3, hy + 1, skin.lt); D(g, hx + 2, hy + 3, skin.lt); D(g, hx + 1, hy + 4, skin.lt);
    if (dir === 'down' || dir === 'up') {
      D(g, hx - 1, c.ey + 1, skin.b); D(g, hx - 1, c.ey + 2, skin.sh);
      D(g, hx + hw, c.ey + 1, skin.sh); D(g, hx + hw, c.ey + 2, skin.dk);
    }
  }
  function eyePix(g, x, y, col) {
    R(g, x, y, 2, 3, col); D(g, x, y, '#ffffff'); D(g, x + 1, y + 2, shade(col, 0.28));
  }
  function faceFront(c) {
    const { g, hx, hw, skin, o, ey } = c, Dz = c.D;
    const m = hw >= 14 ? 3 : 2, e1 = hx + m, e2 = hx + hw - 2 - m;
    c.ex1 = e1; c.ex2 = e2;
    if (o.blink || Dz.sleepy) { R(g, e1, ey + 2, 2, 1, skin.dk); R(g, e2, ey + 2, 2, 1, skin.dk); }
    else { eyePix(g, e1, ey, Dz.eye || EYE); eyePix(g, e2, ey, Dz.eye || EYE); }
    const bl = blushOf(skin.b);
    R(g, e1 - 1, ey + 3, 2, 1, bl); R(g, e2 + 1, ey + 3, 2, 1, bl);
    const cx = hx + (hw >> 1), mc = mix(skin.dk, '#7a2a36', 0.35);
    D(g, cx - 1, ey + 4, mc); D(g, cx, ey + 4, mc);
    D(g, cx, ey + 2, skin.sh);
  }
  function faceSide(c) {
    const { g, hx, skin, o, ey } = c, Dz = c.D;
    const ex = hx + 2;
    c.ex1 = ex;
    if (o.blink || Dz.sleepy) R(g, ex, ey + 2, 2, 1, skin.dk); else eyePix(g, ex, ey, Dz.eye || EYE);
    D(g, hx - 1, ey + 2, skin.b); D(g, hx - 1, ey + 3, skin.sh);
    D(g, hx + 1, ey + 4, mix(skin.dk, '#7a2a36', 0.35));
    R(g, ex + 1, ey + 3, 2, 1, blushOf(skin.b));
    R(g, hx + 8, ey, 2, 3, skin.sh); D(g, hx + 8, ey, skin.b); D(g, hx + 9, ey + 2, skin.dk);
  }

  function torsoFront(c) {
    const { g, tx, ty, tw, th } = c, r = ramp(c.D.top);
    R(g, tx, ty, tw, th, r.b);
    R(g, tx, ty + 1, 1, th - 1, r.lt); R(g, tx + tw - 1, ty, 1, th, r.sh);
    R(g, tx, ty + th - 1, tw, 1, r.sh); R(g, tx + 1, ty, 3, 1, r.hi);
    R(g, tx + (tw >> 1) - 2, ty, 4, 1, c.skin.sh);
  }
  function torsoSide(c) {
    const { g, tx, ty, tw, th } = c, r = ramp(c.D.top);
    const x0 = tx + 2, w = tw - 4;
    c.sx0 = x0; c.sw = w;
    R(g, x0, ty, w, th, r.b);
    R(g, x0, ty + 1, 1, th - 1, r.lt); R(g, x0 + w - 1, ty, 1, th, r.sh);
    R(g, x0, ty + th - 1, w, 1, r.sh); D(g, x0 + 1, ty, r.hi); D(g, x0 + 2, ty, r.hi);
  }
  function armsFront(c) {
    const { g, tx, ty, tw, th, aw, skin, pose, dir } = c, r = ramp(c.D.sleeve || c.D.top);
    const lx = tx - aw, rx = tx + tw;
    const hang = (x, swing, left) => {
      const top = ty + 1, hy = ty + th - 2 + swing;
      R(g, x, top, aw, hy - top, r.b);
      if (left) R(g, x, top + 1, 1, hy - top - 1, r.lt); else R(g, x + aw - 1, top + 1, 1, hy - top - 1, r.sh);
      R(g, x, top, aw, 1, left ? r.hi : r.lt);
      R(g, x, hy, aw, 2, skin.b); D(g, left ? x + aw - 1 : x, hy + 1, skin.sh);
      return [x + (aw >> 1), hy + 1];
    };
    const raised = (x, left) => {
      const top = ty - 7;
      R(g, x, top, aw, ty + 3 - top, r.b);
      if (left) R(g, x, top, 1, ty + 3 - top, r.lt); else R(g, x + aw - 1, top, 1, ty + 3 - top, r.sh);
      R(g, x, top - 2, aw, 2, skin.b); D(g, left ? x : x + aw - 1, top - 2, skin.lt);
      return [x + (aw >> 1), top - 2];
    };
    if (pose === 'hang' && dir !== 'side') { c.handL = raised(lx, true); c.handR = raised(rx, false); return; }
    if (pose === 'carry' && dir === 'down') {
      // forearms come in to hold something against the chest
      for (const [x, left] of [[lx, true], [rx, false]]) {
        R(g, x, ty + 1, aw, 4, r.b); R(g, x, ty + 1, aw, 1, left ? r.hi : r.lt);
        if (!left) R(g, x + aw - 1, ty + 2, 1, 3, r.sh);
      }
      R(g, tx, ty + 4, 3, 2, r.b); R(g, tx + tw - 3, ty + 4, 3, 2, r.sh);
      R(g, tx + 2, ty + 4, 2, 2, skin.b); R(g, tx + tw - 4, ty + 4, 2, 2, skin.b);
      c.handL = [tx + 3, ty + 5]; c.handR = [tx + tw - 3, ty + 5];
      return;
    }
    c.handL = hang(lx, c.swingL, true);
    if (pose === 'raise' && dir === 'down') c.handR = raised(rx, false);
    else c.handR = hang(rx, c.swingR, false);
  }
  function armSide(c) {
    const { g, tx, ty, tw, th, aw, skin, pose } = c, r = ramp(c.D.sleeve || c.D.top);
    if (pose === 'hang') {
      const ax = tx + (tw >> 1) - 1, top = ty - 7;
      R(g, ax, top, aw, ty + 3 - top, r.b); R(g, ax, top, 1, ty + 3 - top, r.lt);
      R(g, ax, top - 2, aw, 2, skin.b);
      c.handS = [ax + 1, top - 2];
      return;
    }
    if (pose === 'carry') {
      const ax = tx + (tw >> 1) - 1;
      R(g, ax, ty + 1, aw, 4, r.b); R(g, ax, ty + 1, 1, 4, r.lt);
      R(g, ax - 4, ty + 4, 5, 2, r.b); R(g, ax - 4, ty + 4, 5, 1, r.lt);
      R(g, ax - 6, ty + 4, 2, 2, skin.b);
      c.handS = [ax - 5, ty + 5];
      return;
    }
    const sw = c.walk ? (c.f === 0 ? 1 : c.f === 2 ? -1 : 0) : 0;
    const ax = tx + (tw >> 1) - 1 + sw, hy = ty + th - 2;
    R(g, ax, ty + 1, aw, hy - ty - 1, r.b); R(g, ax, ty + 1, 1, hy - ty - 1, r.lt);
    D(g, ax, ty + 1, r.hi); D(g, ax + aw - 1, ty + 2, r.sh);
    R(g, ax, hy, aw, 2, skin.b); D(g, ax + aw - 1, hy + 1, skin.sh);
    c.handS = [ax + 1, hy + 1];
  }
  function legsFront(c) {
    const { g, L, fy } = c, pr = ramp(c.D.pants), sr = ramp(c.D.shoes), lw = L.lw;
    const xs = [CX - 1 - lw, CX + 1];
    xs.forEach((lx, i) => {
      const lift = i ? c.liftR : c.liftL, top = c.legTop, bot = fy - 2 - lift;
      R(g, lx, top, lw, bot - top + 1, pr.b);
      if (i === 0) R(g, lx, top, 1, bot - top + 1, pr.lt);
      R(g, lx + lw - 1, top, 1, bot - top + 1, pr.sh);
      const sx = i === 0 ? lx - 1 : lx, sw = lw + 1, sy = fy - 1 - lift;
      R(g, sx, sy, sw, 2, sr.b); R(g, sx, sy, sw, 1, sr.lt); R(g, sx, sy + 1, sw, 1, sr.sh);
      D(g, i === 0 ? sx : sx + sw - 1, sy, i === 0 ? sr.hi : sr.b);
    });
    R(g, CX - 1, c.legTop, 2, 1, pr.sh);
  }
  function legsSide(c) {
    const { g, L, fy, f, walk } = c, lw = L.lw;
    const x0 = CX - (lw >> 1) - 1;
    const pr = ramp(c.D.pants), sr = ramp(c.D.shoes), far = ramp(shade(c.D.pants, -0.24)), farS = ramp(shade(c.D.shoes, -0.22));
    let nDx = 0, fDx = 0, nLift = 0, fLift = 0;
    if (walk) {
      if (f === 0) { nDx = -2; fDx = 2; } else if (f === 2) { nDx = 2; fDx = -2; } else if (f === 1) fLift = 2; else nLift = 2;
    }
    const leg = (dx, lift, col, sc) => {
      const top = c.legTop, bot = fy - 2 - lift, n = bot - top + 1;
      for (let k = 0; k < n; k++) {
        const ox = Math.round(dx * (k / Math.max(1, n - 1)));
        R(g, x0 + ox, top + k, lw, 1, col.b); D(g, x0 + ox, top + k, col.lt); D(g, x0 + ox + lw - 1, top + k, col.sh);
      }
      const sy = fy - 1 - lift, sx = x0 + dx - 1;
      R(g, sx, sy, lw + 1, 2, sc.b); R(g, sx, sy, lw + 1, 1, sc.lt); R(g, sx + 1, sy + 1, lw, 1, sc.sh); D(g, sx, sy, sc.hi);
    };
    leg(fDx, fLift, far, farS); leg(nDx, nLift, pr, sr);
  }
  function robeFront(c) {
    const { g, tx, tw, fy } = c, r = ramp(c.D.robe);
    const top = c.ty + c.th - 1;
    const sway = c.walk ? (c.f === 1 ? -1 : c.f === 3 ? 1 : 0) : 0;
    for (let y = top; y <= fy - 1; y++) {
      const k = y - top, wd = Math.min(2, (k + 1) >> 2), s = y >= fy - 3 ? sway : 0;
      const x0 = tx - wd + s, w = tw + 2 * wd;
      R(g, x0, y, w, 1, r.b); D(g, x0, y, r.lt); D(g, x0 + 1, y, r.lt); D(g, x0 + w - 1, y, r.sh); D(g, x0 + w - 2, y, r.sh);
    }
    for (let y = top + 1; y < fy - 1; y++) D(g, tx + (tw >> 1) + (y >= fy - 3 ? sway : 0), y, r.sh);
    for (let y = top + 2; y < fy - 2; y += 2) D(g, tx + 3, y, r.hi);
    R(g, tx - 2 + sway, fy - 1, tw + 4, 1, c.D.hem || r.dk);
    const sand = c.D.feet || '#7a5230';
    const foot = (x) => { R(g, x, fy, 3, 1, c.skin.sh); D(g, x, fy, sand); D(g, x + 2, fy, sand); };
    if (!c.walk || !(c.f & 1)) { foot(tx + 1); foot(tx + tw - 4); }
    else if (c.f === 1) foot(tx + 1 + sway); else foot(tx + tw - 4 + sway);
  }
  function robeSide(c) {
    const { g, tx, tw, fy } = c, r = ramp(c.D.robe);
    const top = c.ty + c.th - 1;
    const sway = c.walk ? (c.f === 0 ? -1 : c.f === 2 ? 1 : 0) : 0;
    for (let y = top; y <= fy - 1; y++) {
      const k = y - top, wd = Math.min(2, (k + 1) >> 2), s = y >= fy - 3 ? sway : 0;
      const x0 = tx + 2 - wd + s, w = tw - 4 + wd + (y >= fy - 4 ? 1 : 0);
      R(g, x0, y, w, 1, r.b); D(g, x0, y, r.lt); D(g, x0 + w - 1, y, r.sh);
    }
    for (let y = top + 1; y < fy - 1; y++) D(g, tx + 6 + (y >= fy - 3 ? sway : 0), y, r.sh);
    R(g, tx + sway, fy - 1, tw - 2, 1, c.D.hem || r.dk);
    const sand = c.D.feet || '#7a5230';
    R(g, tx - 1 + sway, fy, 4, 1, c.skin.sh); D(g, tx - 1 + sway, fy, sand);
    if (c.walk && (c.f === 1 || c.f === 3)) R(g, tx + 5, fy, 3, 1, shade(c.skin.sh, -0.15));
  }

  /* hair styles: fn(c, ramp) */
  const HAIR = {
    none() {},
    short(c, r) {
      const { g, hx, hy, hw, hh, dir } = c, ins = HEAD_IN[hh];
      R(g, hx + 3, hy - 1, hw - 6, 1, r.b);
      for (let i = 0; i < 4; i++) { const s = Math.max(0, ins[i] - (i ? 0 : 1)); R(g, hx + s, hy + i, hw - 2 * s, 1, r.b); D(g, hx + hw - 1 - s, hy + i, r.sh); }
      if (dir === 'down') {
        for (let x = 0; x < hw; x++) { if (x % 4 !== 3) D(g, hx + x, hy + 4, x < 3 ? r.lt : r.b); if (x % 4 === 1) D(g, hx + x, hy + 5, r.sh); }
        R(g, hx, hy + 4, 1, 4, r.b); R(g, hx + hw - 1, hy + 4, 1, 4, r.sh);
      } else if (dir === 'up') {
        for (let i = 4; i < hh - 2; i++) { const s = ins[i]; R(g, hx + s, hy + i, hw - 2 * s, 1, r.b); D(g, hx + hw - 1 - s, hy + i, r.sh); D(g, hx + s, hy + i, r.lt); }
        for (let x = hx + 2; x < hx + hw - 2; x += 2) D(g, x, hy + hh - 2, r.sh);
        D(g, hx + 5, hy + 5, r.sh); D(g, hx + 8, hy + 7, r.sh);
      } else {
        for (let i = 4; i < hh - 3; i++) R(g, hx + 6, hy + i, hw - 6 - ins[i], 1, i > hh - 6 ? r.sh : r.b);
        R(g, hx, hy + 4, 5, 1, r.b); D(g, hx + 1, hy + 5, r.sh); D(g, hx + 3, hy + 5, r.b);
      }
      R(g, hx + 3, hy + 1, 4, 1, r.lt); D(g, hx + 4, hy, r.hi); D(g, hx + 5, hy, r.hi);
      D(g, hx + hw - 5, hy - 2, r.b); D(g, hx + hw - 4, hy - 3, r.lt); D(g, hx + hw - 4, hy - 2, r.sh);
    },
    bob(c, r) {
      const { g, hx, hy, hw, hh, dir } = c, ins = HEAD_IN[hh];
      R(g, hx + 2, hy - 1, hw - 4, 1, r.b);
      for (let i = 0; i < 4; i++) { const s = Math.max(0, ins[i] - 1) - (i > 1 ? 1 : 0); R(g, hx + s, hy + i, hw - 2 * s, 1, r.b); D(g, hx + hw - 1 - s, hy + i, r.sh); }
      if (dir === 'down') {
        R(g, hx - 1, hy + 4, 3, hh - 3, r.b); R(g, hx + hw - 2, hy + 4, 3, hh - 3, r.sh); D(g, hx - 1, hy + 5, r.lt);
        R(g, hx + 2, hy + 4, 7, 1, r.b); R(g, hx + 2, hy + 5, 3, 1, r.b); D(g, hx + 9, hy + 4, r.sh); D(g, hx + 10, hy + 4, r.b);
        R(g, hx - 2, hy + hh, 3, 1, r.b); R(g, hx + hw - 1, hy + hh, 3, 1, r.sh);
      } else if (dir === 'up') {
        for (let i = 4; i <= hh; i++) R(g, hx - 1, hy + i, hw + 2, 1, i === hh ? r.sh : r.b);
        R(g, hx + hw, hy + 3, 1, hh - 2, r.sh); R(g, hx - 1, hy + 4, 1, hh - 4, r.lt);
        for (let x = hx + 1; x < hx + hw; x += 3) D(g, x, hy + hh - 1, r.sh);
      } else {
        for (let i = 4; i <= hh; i++) R(g, hx + 5, hy + i, hw - 4, 1, i === hh ? r.sh : r.b);
        R(g, hx + hw, hy + 3, 1, hh - 2, r.sh);
        R(g, hx, hy + 4, 4, 1, r.b); D(g, hx, hy + 5, r.b);
      }
      R(g, hx + 3, hy + 1, 5, 1, r.lt); D(g, hx + 4, hy, r.hi); D(g, hx + 5, hy, r.hi); D(g, hx + 6, hy + 2, r.hi);
    },
    bald(c) {
      const { g, hx, hy, skin } = c;
      D(g, hx + 4, hy + 1, skin.hi); D(g, hx + 5, hy + 1, skin.hi); D(g, hx + 3, hy + 2, skin.hi); D(g, hx + 4, hy + 2, '#ffffff');
    },
    side(c, r) { // sideburns + back hair under a hat
      const { g, hx, hy, hw, hh, dir } = c, ins = HEAD_IN[hh];
      if (dir === 'down') { R(g, hx, hy + 3, 2, 6, r.b); D(g, hx, hy + 3, r.lt); R(g, hx + hw - 2, hy + 3, 2, 6, r.sh); }
      else if (dir === 'up') {
        for (let i = 2; i < hh - 3; i++) { const s = ins[i]; R(g, hx + s, hy + i, hw - 2 * s, 1, i === hh - 4 ? r.sh : r.b); D(g, hx + hw - 1 - s, hy + i, r.sh); }
        for (let x = hx + 1; x < hx + hw - 1; x += 2) D(g, x, hy + 4, r.lt);
      } else { for (let i = 2; i < hh - 4; i++) R(g, hx + 7, hy + i, hw - 7 - ins[i], 1, i > hh - 6 ? r.sh : r.b); R(g, hx + 5, hy + 4, 2, 4, r.b); D(g, hx + 9, hy + 4, r.lt); }
    },
    tied(c, r) { // under a tricorn; low ponytail with a red ribbon
      const { g, hx, hy, hw, hh, dir } = c, ins = HEAD_IN[hh];
      if (dir === 'down') { R(g, hx, hy + 3, 1, 6, r.b); R(g, hx + hw - 1, hy + 3, 1, 6, r.sh); }
      else if (dir === 'up') {
        for (let i = 2; i < hh - 1; i++) { const s = ins[i]; R(g, hx + s, hy + i, hw - 2 * s, 1, r.b); D(g, hx + hw - 1 - s, hy + i, r.sh); }
        const cx = hx + (hw >> 1);
        R(g, cx - 1, hy + hh - 1, 2, 1, '#c2372e');
        R(g, cx - 1, hy + hh, 3, 5, r.b); D(g, cx + 1, hy + hh, r.sh); D(g, cx, hy + hh + 4, r.sh); D(g, cx - 1, hy + hh + 1, r.lt);
      } else {
        for (let i = 2; i < hh - 2; i++) R(g, hx + 7, hy + i, hw - 7 - ins[i], 1, r.b);
        D(g, hx + hw, hy + hh - 4, '#c2372e'); D(g, hx + hw, hy + hh - 3, '#c2372e');
        R(g, hx + hw, hy + hh - 2, 2, 5, r.b); D(g, hx + hw + 1, hy + hh, r.sh);
      }
    },
  };

  /* ================================================================ character designs */
  const GOLD = ramp(P.gold);

  const TOCK = {
    build: 'normal', skin: P.skin[0], top: '#80293b', sleeve: '#2d3459', pants: '#33313e', shoes: '#211d29', hair: 'side', hairCol: '#c9c6d2', hatH: 9,
    poses: ['raise', 'carry'], walkPoses: ['carry'],
    legs(c) {
      const { g, tx, tw, dir } = c, coat = ramp('#2d3459'), y = c.legTop;
      if (dir === 'side') { R(g, c.tx + tw - 5, y, 4, 4, coat.b); D(g, c.tx + tw - 2, y + 3, coat.sh); R(g, c.tx + tw - 2, y, 1, 3, coat.sh); return; }
      R(g, tx, y, 3, 4, coat.b); D(g, tx, y, coat.lt); D(g, tx, y + 3, coat.sh);
      R(g, tx + tw - 3, y, 3, 4, coat.sh); D(g, tx + tw - 1, y + 3, coat.dk);
      if (dir === 'up') { R(g, tx + 3, y, tw - 6, 3, coat.b); R(g, tx + (tw >> 1) - 1, y, 1, 3, coat.dk); }
    },
    torso(c) {
      const { g, tx, ty, tw, th, dir } = c, coat = ramp('#2d3459'), ws = ramp('#80293b');
      if (dir === 'down') {
        R(g, tx, ty, 3, th, coat.b); R(g, tx, ty + 1, 1, th - 1, coat.lt); D(g, tx + 1, ty, coat.hi);
        R(g, tx + tw - 3, ty, 3, th, coat.b); R(g, tx + tw - 1, ty, 1, th, coat.sh);
        D(g, tx + 3, ty + 1, coat.b); D(g, tx + tw - 4, ty + 1, coat.sh); // lapels
        R(g, tx + 4, ty, 4, 1, '#f1ebdd'); D(g, tx + 4, ty + 1, '#f1ebdd'); D(g, tx + 7, ty + 1, '#d8d0c0');
        R(g, tx + 5, ty + 1, 2, 1, '#c8423c'); D(g, tx + 5, ty + 2, '#93282c'); D(g, tx + 6, ty + 2, '#c8423c');
        D(g, tx + 5, ty + 4, P.gold); D(g, tx + 5, ty + 6, P.goldDark);
        D(g, tx + 6, ty + 4, '#fff1b0'); D(g, tx + 7, ty + 5, P.gold); D(g, tx + 8, ty + 5, P.goldDark); // watch chain
        R(g, tx + 3, ty + th - 1, tw - 6, 1, ws.dk);
      } else if (dir === 'up') {
        R(g, tx, ty, tw, th, coat.b); R(g, tx, ty, 1, th, coat.lt); R(g, tx + tw - 1, ty, 1, th, coat.sh); R(g, tx + 1, ty, 3, 1, coat.hi);
        R(g, tx + (tw >> 1), ty + th - 3, 1, 3, coat.dk); D(g, tx + 3, ty + th - 2, P.goldDark); D(g, tx + tw - 4, ty + th - 2, P.goldDark);
      } else {
        const x0 = c.sx0, w = c.sw;
        R(g, x0, ty, w, th, coat.b); R(g, x0 + w - 1, ty, 1, th, coat.sh); D(g, x0 + 1, ty, coat.hi);
        R(g, x0, ty + 1, 2, th - 2, ws.b); D(g, x0, ty, '#f1ebdd'); D(g, x0 + 1, ty, '#c8423c'); D(g, x0, ty + 4, P.gold); D(g, x0 + 1, ty + 5, P.goldDark);
      }
    },
    head(c) {
      const { g, hx, hy, hw, dir, ey, skin } = c, hat = ramp('#2b2433'), mus = ramp('#e4e0ea');
      const crown = (x0, w) => {
        R(g, x0, hy - 8, w, 9, hat.b); R(g, x0, hy - 8, 1, 9, hat.lt); R(g, x0 + 1, hy - 8, 2, 1, hat.hi); R(g, x0 + w - 1, hy - 8, 1, 9, hat.sh);
        R(g, x0, hy - 1, w, 2, P.goldDark); R(g, x0, hy - 1, w, 1, P.gold); D(g, x0 + 1, hy - 1, '#fff1b0');
        D(g, x0 + w - 2, hy - 7, hat.sh);
      };
      if (dir === 'side') {
        crown(hx + 2, hw - 6);
        R(g, hx - 2, hy + 1, hw + 2, 2, hat.b); R(g, hx - 2, hy + 1, hw + 2, 1, hat.lt); D(g, hx + hw - 1, hy + 2, hat.dk);
        R(g, hx, hy + 3, 6, 1, skin.sh);
        R(g, hx - 2, ey + 3, 5, 1, mus.b); D(g, hx - 3, ey + 2, mus.lt); D(g, hx + 2, ey + 4, mus.sh);
        // monocle ring
        D(g, hx + 1, ey - 1, P.gold); D(g, hx + 4, ey - 1, P.gold); R(g, hx + 1, ey + 3, 4, 1, P.goldDark); D(g, hx + 4, ey, P.gold); D(g, hx + 4, ey + 1, P.goldDark);
        D(g, hx + 5, ey + 4, P.gold); D(g, hx + 6, ey + 5, P.goldDark);
      } else {
        crown(hx + 2, hw - 4);
        R(g, hx - 1, hy + 1, hw + 2, 2, hat.b); R(g, hx - 1, hy + 1, hw + 2, 1, hat.lt); R(g, hx - 1, hy + 1, 2, 1, hat.hi); D(g, hx + hw, hy + 2, hat.dk);
        if (dir === 'down') {
          R(g, hx + 1, hy + 3, hw - 2, 1, skin.sh);
          const cx = hx + (hw >> 1);
          // bushy grey brows, handlebar moustache
          R(g, c.ex1 - 1, ey - 2, 3, 1, mus.sh); D(g, c.ex1 - 1, ey - 2, mus.b);
          R(g, cx - 3, ey + 3, 6, 1, mus.b); D(g, cx - 4, ey + 4, mus.b); D(g, cx + 3, ey + 4, mus.sh); D(g, cx - 5, ey + 3, mus.lt); D(g, cx + 4, ey + 3, mus.sh);
          D(g, cx - 2, ey + 3, mus.hi); D(g, cx - 1, ey + 4, skin.dk); D(g, cx, ey + 4, skin.dk);
          // monocle around the right eye, chain down to the coat
          const e = c.ex2;
          R(g, e - 1, ey - 1, 4, 1, P.gold); R(g, e - 1, ey + 3, 4, 1, P.goldDark); D(g, e - 1, ey, P.gold); D(g, e - 1, ey + 1, P.gold); D(g, e - 1, ey + 2, P.goldDark);
          D(g, e + 2, ey, P.gold); D(g, e + 2, ey + 1, P.goldDark); D(g, e + 2, ey + 2, P.goldDark);
          if (!c.o.blink) D(g, e + 1, ey, '#bfe6ff');
          D(g, e + 3, ey + 4, P.goldDark); D(g, e + 3, ey + 5, P.gold); D(g, e + 2, ey + 6, P.goldDark);
        }
      }
    },
    front(c) {
      if (c.pose !== 'raise' || c.dir !== 'down') return;
      const { g } = c, [x, y] = c.handR;
      // a brass hand bell held up high
      R(g, x - 1, y - 7, 3, 1, GOLD.lt); R(g, x - 2, y - 6, 5, 3, GOLD.b); R(g, x - 2, y - 6, 1, 3, GOLD.hi); R(g, x + 2, y - 6, 1, 3, GOLD.sh);
      R(g, x - 3, y - 3, 7, 1, GOLD.sh); D(g, x, y - 2, '#5a4030'); D(g, x, y - 8, '#5a4030'); D(g, x - 1, y - 5, '#fff3b0');
    },
  };

  const QUILL = {
    build: 'normal', skin: P.skin[1], top: '#e59a2f', robe: '#e59a2f', sleeve: '#e59a2f', hem: '#2e8f70', hair: 'bald', feet: '#6b4426',
    poses: ['hang'],
    torso(c) {
      const { g, tx, ty, tw, th, dir } = c, jade = ramp('#2f9e78');
      if (dir === 'down') {
        for (let k = 0; k < th; k++) { const x = tx + k, w = 3; R(g, x, ty + k, w, 1, jade.b); D(g, x + w - 1, ty + k, jade.sh); }
        D(g, tx, ty, jade.hi); D(g, tx + 1, ty, jade.lt);
        R(g, tx, ty + th - 1, tw, 1, '#6b4426'); D(g, tx + 4, ty + th - 1, P.gold);
        R(g, tx + 3, ty, 6, 1, c.skin.sh);
        // scroll satchel on the left hip
        R(g, tx - 3, ty + 4, 4, 4, '#8a5a32'); D(g, tx - 3, ty + 4, '#a8784a'); R(g, tx - 3, ty + 7, 4, 1, '#5e3a1e');
        R(g, tx - 2, ty + 2, 2, 2, '#f3e6c4'); D(g, tx - 1, ty + 2, '#d8c6a0');
      } else if (dir === 'up') {
        for (let k = 0; k < th; k++) { const x = tx + tw - 3 - k; R(g, x, ty + k, 3, 1, jade.b); D(g, x + 2, ty + k, jade.sh); }
        R(g, tx, ty + th - 1, tw, 1, '#6b4426');
        R(g, tx + 2, ty + 1, 1, 5, '#6b4426');
      } else {
        const x0 = c.sx0, w = c.sw;
        R(g, x0, ty, 3, th, jade.b); D(g, x0, ty, jade.hi); R(g, x0, ty + th - 1, w, 1, '#6b4426');
        R(g, x0 + w - 1, ty + 3, 3, 4, '#8a5a32'); D(g, x0 + w, ty + 2, '#f3e6c4'); D(g, x0 + w + 1, ty + 2, '#d8c6a0');
      }
    },
    head(c) {
      const { g, hx, hy, hw, hh, dir, ey } = c, wh = ramp('#efeae0');
      if (dir === 'down') {
        R(g, c.ex1 - 1, ey - 2, 3, 1, wh.b); R(g, c.ex2, ey - 2, 3, 1, wh.sh);
        const cx = hx + (hw >> 1);
        R(g, cx - 2, hy + hh - 1, 4, 2, wh.b); R(g, cx - 1, hy + hh + 1, 2, 1, wh.sh); D(g, cx - 2, hy + hh - 1, wh.hi);
      } else if (dir === 'side') {
        R(g, hx + 1, ey - 2, 3, 1, wh.b);
        R(g, hx, hy + hh - 1, 3, 2, wh.b); D(g, hx + 1, hy + hh + 1, wh.sh);
      }
    },
    front(c) {
      const { g, dir, pose } = c;
      if (dir === 'up' || pose === 'hang') return;
      const [hxp, hyp] = dir === 'side' ? c.handS : c.handR;
      const x = hxp + (dir === 'side' ? -2 : 0), y = hyp;
      // little paper lantern on a cord
      D(g, x, y + 1, '#3a2a20'); D(g, x, y + 2, '#3a2a20');
      R(g, x - 1, y + 3, 3, 1, '#3a2a20');
      R(g, x - 2, y + 4, 5, 4, '#e0662f'); R(g, x - 2, y + 4, 1, 4, '#f59a52'); R(g, x - 1, y + 5, 2, 2, '#ffd27a'); D(g, x - 1, y + 5, '#fff6cf'); R(g, x + 2, y + 4, 1, 4, '#b6451f');
      R(g, x - 1, y + 8, 3, 1, '#3a2a20');
      c.meta.lamp = [x, y + 5];
    },
  };

  const GRIT = {
    build: 'dwarf', skin: P.skin[1], top: '#3f6f90', sleeve: '#3f6f90', pants: '#5a4030', shoes: '#33241c', hair: 'none', hatH: 5,
    behind(c) {
      const { g, dir, hx, hy } = c, wood = ramp('#8f5d34'), iron = ramp('#8a8794');
      if (dir === 'up') {
        for (let i = 0; i < 16; i++) { D(g, hx - 1 + i, hy + 19 - i, wood.b); D(g, hx - 1 + i, hy + 20 - i, wood.sh); }
        R(g, hx + 11, hy + 1, 9, 1, iron.lt); R(g, hx + 10, hy + 2, 2, 1, iron.b); R(g, hx + 19, hy + 2, 2, 1, iron.b); D(g, hx + 9, hy + 3, iron.sh); D(g, hx + 21, hy + 3, iron.sh);
      } else if (dir === 'side') {
        for (let i = 0; i < 12; i++) { D(g, hx + 9 + i, hy + 18 - i, wood.b); D(g, hx + 10 + i, hy + 18 - i, wood.sh); }
        R(g, hx + 17, hy + 6, 6, 1, iron.lt); R(g, hx + 16, hy + 7, 2, 1, iron.b); R(g, hx + 23, hy + 7, 1, 1, iron.b); D(g, hx + 15, hy + 8, iron.sh); D(g, hx + 18, hy + 6, iron.hi);
      }
    },
    torso(c) {
      const { g, tx, ty, tw, th, dir } = c, vest = ramp('#7b4a2b');
      if (dir === 'down') {
        R(g, tx, ty, 5, th, vest.b); R(g, tx, ty, 1, th, vest.lt); D(g, tx + 1, ty, vest.hi);
        R(g, tx + tw - 5, ty, 5, th, vest.b); R(g, tx + tw - 1, ty, 1, th, vest.sh);
        R(g, tx, ty + th - 2, tw, 2, '#2e2420'); R(g, tx + (tw >> 1) - 2, ty + th - 2, 4, 2, P.goldDark); R(g, tx + (tw >> 1) - 1, ty + th - 2, 2, 1, P.gold);
        R(g, tx + tw - 5, ty + 2, 4, 3, '#3f7a4a'); D(g, tx + tw - 5, ty + 2, '#62a06a'); R(g, tx + tw - 5, ty + 4, 4, 1, '#f3e6c4');
      } else if (dir === 'up') {
        R(g, tx, ty, tw, th - 2, vest.b); R(g, tx, ty, 1, th - 2, vest.lt); R(g, tx + tw - 1, ty, 1, th - 2, vest.sh);
        R(g, tx + (tw >> 1), ty + 1, 1, th - 3, vest.sh);
        R(g, tx, ty + th - 2, tw, 2, '#2e2420');
      } else {
        R(g, c.sx0 + c.sw - 6, ty, 6, th, vest.b); R(g, c.sx0 + c.sw - 6, ty, 1, th, vest.lt); R(g, c.sx0 + c.sw - 1, ty, 1, th, vest.sh);
        R(g, c.sx0, ty + th - 2, c.sw, 2, '#2e2420'); R(g, c.sx0, ty + th - 2, 2, 1, P.gold);
      }
    },
    head(c) {
      const { g, hx, hy, hw, hh, dir, ey, tx, ty, tw } = c, hel = ramp('#d6a434'), bd = ramp('#c8642a');
      if (dir === 'down') {
        const cx = hx + (hw >> 1);
        R(g, hx + 1, ey + 2, hw - 2, hy + hh - ey - 2, bd.b);
        R(g, tx + 2, ty, tw - 4, 3, bd.b); R(g, tx + 3, ty + 3, tw - 6, 2, bd.b); R(g, tx + 5, ty + 5, tw - 10, 1, bd.sh);
        R(g, cx - 3, ty + 4, 1, 3, bd.sh); R(g, cx + 2, ty + 4, 1, 3, bd.sh); D(g, cx - 3, ty + 6, P.gold); D(g, cx + 2, ty + 6, P.gold);
        for (let y = ey + 2; y < ty + 5; y++) for (let x = hx + 1; x < hx + hw - 1; x++) if (S.hash(x, y, 7) > 0.72) D(g, x, y, bd.lt);
        R(g, hx + 1, ey + 2, 1, 4, bd.lt); R(g, hx + hw - 2, ey + 2, 1, 4, bd.sh);
        R(g, cx - 4, ey + 2, 8, 1, bd.hi); R(g, cx - 1, ey + 4, 2, 1, bd.dk);
        D(g, cx - 1, ey + 1, c.skin.lt); D(g, cx, ey + 1, c.skin.sh);
        R(g, c.ex1 - 1, ey - 2, 3, 1, bd.b); R(g, c.ex2, ey - 2, 3, 1, bd.sh);
      } else if (dir === 'side') {
        R(g, hx - 1, ey + 2, 7, hy + hh - ey - 2, bd.b); R(g, tx + 2, ty, 5, 3, bd.b); R(g, tx + 2, ty + 3, 3, 2, bd.b); D(g, tx + 2, ty + 5, bd.sh); D(g, tx + 2, ty + 6, P.gold);
        for (let y = ey + 2; y < ty + 3; y++) for (let x = hx - 1; x < hx + 6; x++) if (S.hash(x, y, 9) > 0.72) D(g, x, y, bd.lt);
        R(g, hx - 1, ey + 2, 4, 1, bd.hi); R(g, hx + 1, ey - 2, 3, 1, bd.b);
        R(g, hx + 6, ey + 2, 1, 4, bd.sh);
      } else {
        R(g, hx + 1, ey + 2, hw - 2, 4, bd.sh); D(g, hx, ey + 3, bd.b); D(g, hx + hw - 1, ey + 3, bd.sh);
      }
      // mining helmet with a brass lamp
      const top = hy - 4;
      for (let i = 0; i < 7; i++) { const s = i === 0 ? 3 : i === 1 ? 1 : 0; R(g, hx + s, top + i, hw - 2 * s, 1, hel.b); D(g, hx + hw - 1 - s, top + i, hel.sh); D(g, hx + s, top + i, hel.lt); }
      R(g, hx + 3, top + 1, 4, 1, hel.hi); D(g, hx + 2, top + 2, hel.hi);
      R(g, hx - 2, top + 7, hw + 4, 1, hel.sh); D(g, hx - 2, top + 7, hel.b); D(g, hx - 1, top + 7, hel.lt);
      R(g, hx + 1, top + 6, hw - 2, 1, hel.dk);
      if (dir === 'down') {
        const cx = hx + (hw >> 1);
        R(g, cx - 3, top, 6, 5, '#4a4450'); R(g, cx - 2, top + 1, 4, 3, '#fff2b0'); D(g, cx - 2, top + 1, '#ffffff'); D(g, cx + 1, top + 3, '#e8c860');
        R(g, hx + 1, top + 8, hw - 2, 1, c.skin.sh);
      } else if (dir === 'side') {
        R(g, hx - 3, top + 1, 4, 4, '#4a4450'); R(g, hx - 3, top + 2, 2, 2, '#fff2b0'); D(g, hx - 3, top + 2, '#ffffff');
        R(g, hx, top + 8, 6, 1, c.skin.sh);
      } else R(g, hx + (hw >> 1) - 1, top + 1, 3, 4, '#4a4450');
    },
    front(c) {
      const { g, dir } = c, wood = ramp('#8f5d34'), iron = ramp('#8a8794');
      if (dir !== 'down') return;
      const [x, y] = c.handR;
      for (let i = 0; i < 15; i++) { const dx = i > 7 ? 1 : 0; D(g, x + dx, y + 1 - i, wood.b); if (i > 1) D(g, x + dx - 1, y + 1 - i, wood.lt); }
      const cx = x + 1, hy = y - 14;
      R(g, cx - 3, hy, 7, 1, iron.lt); R(g, cx - 4, hy + 1, 9, 1, iron.b); D(g, cx - 1, hy, iron.hi);
      D(g, cx - 5, hy + 2, iron.sh); D(g, cx - 6, hy + 3, iron.sh); D(g, cx + 5, hy + 2, iron.dk); D(g, cx + 6, hy + 3, iron.dk); D(g, cx, hy + 1, '#5e5a66');
    },
  };

  const LUMI = {
    build: 'normal', skin: P.skin[0], top: '#35d8ea', sleeve: '#35d8ea', pants: '#26222f', shoes: '#f3f0f6', hair: 'bob', hairCol: '#cf3f9c', eye: '#3a1f4a',
    torso(c) {
      const { g, tx, ty, tw, th, dir } = c, pk = P.neonPink;
      if (dir === 'down') {
        R(g, tx + 4, ty, 4, th - 1, '#1f1b29'); D(g, tx + 5, ty + 2, '#fff2b8'); D(g, tx + 6, ty + 3, '#ff9fd0'); D(g, tx + 5, ty + 4, '#3ef0ff');
        R(g, tx + 3, ty, 1, th, pk); R(g, tx + 8, ty, 1, th, shade(pk, -0.12));
        R(g, tx, ty + th - 1, tw, 1, shade(pk, -0.25)); D(g, tx + 1, ty, '#ffffff');
        R(g, tx + 4, ty, 4, 1, c.skin.sh);
      } else if (dir === 'up') {
        R(g, tx + 3, ty + 2, 6, 3, '#2a8fa6'); R(g, tx + 5, ty + 3, 2, 1, pk); D(g, tx + 4, ty + 2, '#4ab8cc');
        R(g, tx, ty + th - 1, tw, 1, shade(pk, -0.25));
      } else {
        R(g, c.sx0, ty, 2, th - 1, '#1f1b29'); R(g, c.sx0 + 2, ty, 1, th, pk); R(g, c.sx0, ty + th - 1, c.sw, 1, shade(pk, -0.25));
      }
    },
    head(c) {
      const { g, hx, hy, hw, dir, ey } = c, band = ramp('#2e2a38'), cup = ramp('#eeeaf6');
      if (dir === 'side') {
        for (let i = 0; i < 7; i++) D(g, hx + 6 + (i > 4 ? 1 : 0), hy - 1 + i, band.b);
        R(g, hx + 7, ey - 1, 3, 4, '#3a3448'); D(g, hx + 7, ey - 1, '#5a5468'); D(g, hx + 8, ey + 1, P.neonCyan); R(g, hx + 9, ey, 1, 3, '#24202e');
      } else {
        R(g, hx + 1, hy - 2, hw - 2, 1, band.b); D(g, hx + 3, hy - 2, band.hi); D(g, hx, hy - 1, band.b); D(g, hx + hw - 1, hy - 1, band.sh);
        R(g, hx - 3, ey - 1, 3, 4, cup.b); D(g, hx - 3, ey - 1, cup.hi); R(g, hx - 2, ey, 1, 2, P.neonCyan);
        R(g, hx + hw, ey - 1, 3, 4, cup.sh); D(g, hx + hw, ey - 1, cup.b); R(g, hx + hw + 1, ey, 1, 2, P.neonCyan);
      }
    },
    front(c) {
      const { g, dir } = c;
      if (dir === 'up') return;
      const [hxp, hyp] = dir === 'side' ? c.handS : c.handR;
      const x = hxp + (dir === 'side' ? -4 : -2), y = hyp - 2;
      R(g, x, y, 5, 4, '#3a3644'); D(g, x, y, '#6a6676'); R(g, x + 1, y + 1, 3, 2, '#7fd8ff'); D(g, x + 1, y + 1, '#d8f6ff'); D(g, x + 4, y, '#ff3b5c');
      c.meta.phone = [x + 2, y + 1];
    },
  };

  const TWIRL = {
    build: 'normal', skin: P.skin[1], top: '#f1ece2', sleeve: '#b8382e', pants: '#3a3346', shoes: '#2a2028', hair: 'tied', hairCol: '#4a2e1c', hatH: 5,
    legs(c) {
      const { g, L, fy, dir } = c, boot = ramp('#4a3226');
      if (dir === 'side') return;
      [CX - 1 - L.lw, CX + 1].forEach((lx, i) => {
        const lift = i ? c.liftR : c.liftL;
        R(g, lx, fy - 4 - lift, L.lw, 3, boot.b); R(g, lx, fy - 4 - lift, L.lw, 1, '#7a5a3e'); D(g, i ? lx + L.lw - 1 : lx, fy - 3 - lift, i ? boot.sh : boot.lt);
      });
    },
    torso(c) {
      const { g, tx, ty, tw, th, dir } = c, coat = ramp('#b8382e'), navy = '#2c3e6e';
      if (dir === 'down') {
        R(g, tx + 3, ty + 2, 6, 1, navy); R(g, tx + 3, ty + 5, 6, 1, navy);
        R(g, tx, ty, 3, th, coat.b); R(g, tx, ty, 1, th, coat.lt); R(g, tx + tw - 3, ty, 3, th, coat.b); R(g, tx + tw - 1, ty, 1, th, coat.sh);
        D(g, tx + 2, ty + 2, P.gold); D(g, tx + 2, ty + 5, P.gold); D(g, tx + tw - 3, ty + 2, P.goldDark); D(g, tx + tw - 3, ty + 5, P.goldDark);
        R(g, tx + 3, ty + th - 1, 6, 1, '#5a3a22'); R(g, tx + 5, ty + th - 1, 2, 1, P.gold);
        R(g, tx + 4, ty, 4, 1, c.skin.sh);
        R(g, tx, c.legTop, 3, 3, coat.b); D(g, tx, c.legTop, coat.lt); R(g, tx + tw - 3, c.legTop, 3, 3, coat.sh);
      } else if (dir === 'up') {
        R(g, tx, ty, tw, th, coat.b); R(g, tx, ty, 1, th, coat.lt); R(g, tx + tw - 1, ty, 1, th, coat.sh); R(g, tx + 1, ty, 3, 1, coat.hi);
        R(g, tx, c.legTop, tw, 3, coat.b); R(g, tx + tw - 1, c.legTop, 1, 3, coat.sh); R(g, tx + (tw >> 1), ty + th - 2, 1, 5, coat.dk);
      } else {
        const x0 = c.sx0, w = c.sw;
        R(g, x0, ty + 2, 2, 1, navy); R(g, x0, ty + 5, 2, 1, navy);
        R(g, x0 + 2, ty, w - 2, th, coat.b); R(g, x0 + w - 1, ty, 1, th, coat.sh); D(g, x0 + 2, ty + 3, P.gold);
        R(g, x0 + w - 4, c.legTop, 4, 3, coat.b); D(g, x0 + w - 1, c.legTop + 2, coat.sh);
      }
    },
    head(c) {
      const { g, hx, hy, hw, dir, ey, skin } = c, hat = ramp('#2b2236'), trim = P.gold, hair = ramp('#4a2e1c');
      if (dir === 'down') {
        const cx = hx + (hw >> 1);
        R(g, cx - 2, ey + 3, 4, 1, hair.b); D(g, cx - 3, ey + 4, hair.sh); D(g, cx + 2, ey + 4, hair.sh); D(g, cx - 1, ey + 4, skin.dk); D(g, cx, ey + 4, skin.dk);
        R(g, cx - 1, ey + 5, 2, 2, hair.b);
        R(g, hx + 2, hy - 4, hw - 4, 4, hat.b); R(g, hx + 3, hy - 4, 3, 1, hat.hi); D(g, hx + hw - 3, hy - 3, hat.sh);
        R(g, hx - 2, hy, hw + 4, 2, hat.b); R(g, hx - 2, hy - 1, 3, 1, hat.b); R(g, hx + hw - 1, hy - 1, 3, 1, hat.sh); D(g, hx - 2, hy - 2, hat.b); D(g, hx + hw + 1, hy - 2, hat.sh);
        R(g, hx - 2, hy + 1, hw + 4, 1, trim); D(g, hx - 2, hy - 2, trim); D(g, hx + hw + 1, hy - 2, P.goldDark);
        R(g, hx - 1, hy - 1, hw + 2, 1, hat.lt);
        R(g, cx - 1, hy + 2, 2, 1, hat.b); D(g, cx - 1, hy + 2, trim);
        R(g, hx + 1, hy + 2, hw - 2, 1, skin.sh); D(g, cx - 1, hy + 2, hat.b); D(g, cx, hy + 2, trim);
        // a feather
        D(g, hx + hw - 3, hy - 5, '#63b4e6'); D(g, hx + hw - 2, hy - 6, '#63b4e6'); D(g, hx + hw - 1, hy - 7, '#a8dcf8');
      } else if (dir === 'side') {
        R(g, hx - 2, ey + 3, 4, 1, hair.b); R(g, hx - 1, ey + 5, 2, 2, hair.b); D(g, hx, ey + 6, hair.sh);
        R(g, hx + 2, hy - 4, hw - 6, 4, hat.b); D(g, hx + 2, hy - 4, hat.hi); D(g, hx + 3, hy - 4, hat.hi);
        R(g, hx - 4, hy, hw + 4, 2, hat.b); D(g, hx - 4, hy - 1, hat.b); D(g, hx + hw - 1, hy - 1, hat.sh);
        R(g, hx - 4, hy + 1, hw + 4, 1, trim); D(g, hx - 4, hy - 1, trim);
        R(g, hx, hy + 2, 6, 1, skin.sh);
        D(g, hx + hw - 4, hy - 5, '#63b4e6'); D(g, hx + hw - 3, hy - 6, '#a8dcf8');
      } else {
        R(g, hx + 2, hy - 4, hw - 4, 4, hat.b); R(g, hx - 2, hy, hw + 4, 2, hat.b); D(g, hx - 2, hy - 1, hat.b); D(g, hx + hw + 1, hy - 1, hat.sh);
        R(g, hx - 2, hy + 1, hw + 4, 1, trim); R(g, hx + 3, hy - 4, 3, 1, hat.hi);
      }
    },
  };

  const HUDSON = {
    build: 'normal', skin: P.skin[0], top: '#4a78c8', sleeve: '#4a78c8', pants: '#2f3b5e', shoes: '#f0eef2', hair: 'short', hairCol: '#5c3a22',
    torso(c) {
      const { g, tx, ty, tw, th, dir } = c, hood = ramp('#4a78c8'), bag = ramp('#e08a3a');
      if (dir === 'down') {
        R(g, tx + 2, ty, tw - 4, 1, hood.lt); D(g, tx + 4, ty + 1, '#f4f1ea'); D(g, tx + 4, ty + 2, '#f4f1ea'); D(g, tx + 7, ty + 1, '#f4f1ea'); D(g, tx + 7, ty + 2, '#d6d2ca');
        R(g, tx + 3, ty + 4, 6, 3, hood.sh); R(g, tx + 3, ty + 4, 6, 1, hood.dk);
        R(g, tx, ty, 2, 3, bag.b); D(g, tx, ty, bag.lt); R(g, tx + tw - 2, ty, 2, 3, bag.sh);
        R(g, tx, ty + th - 1, tw, 1, hood.dk);
      } else if (dir === 'up') {
        R(g, tx + 3, ty, tw - 6, 2, hood.sh);
        R(g, tx + 1, ty + 1, tw - 2, 7, bag.b); R(g, tx + 1, ty + 1, tw - 2, 1, bag.lt); R(g, tx + tw - 2, ty + 1, 1, 7, bag.sh); R(g, tx + 1, ty + 1, 1, 7, bag.lt);
        R(g, tx + 2, ty + 4, tw - 4, 3, bag.sh); R(g, tx + 2, ty + 4, tw - 4, 1, '#f3d27a'); D(g, tx + 1, ty + 1, bag.hi);
        R(g, tx + 1, ty + 8, tw - 2, 1, bag.dk);
      } else {
        R(g, c.sx0 + c.sw - 1, ty, 3, 7, bag.b); D(g, c.sx0 + c.sw, ty, bag.lt); R(g, c.sx0 + c.sw + 1, ty + 1, 1, 6, bag.sh);
        R(g, c.sx0, ty + 4, 4, 3, hood.sh);
        D(g, c.sx0 + 1, ty + 1, '#f4f1ea'); D(g, c.sx0 + 1, ty + 2, '#d6d2ca');
      }
    },
  };

  const BAKER = {
    build: 'normal', skin: P.skin[2], top: '#7aa8d8', sleeve: '#7aa8d8', pants: '#4a4250', shoes: '#3a2a22', hair: 'short', hairCol: '#2e2018', hatH: 8,
    torso(c) {
      const { g, tx, ty, tw, th, dir } = c, ap = ramp('#f4efe6');
      if (dir === 'down') { R(g, tx + 1, ty + 1, tw - 2, th - 1, ap.b); R(g, tx + 1, ty + 1, 1, th - 1, ap.lt); R(g, tx + tw - 2, ty + 1, 1, th - 1, ap.sh); R(g, tx + 1, c.legTop, tw - 2, 3, ap.sh); R(g, tx + 2, c.legTop, tw - 4, 2, ap.b); D(g, tx + 4, ty + 4, '#e0a050'); }
      else if (dir === 'up') { R(g, tx + 1, ty + th - 2, tw - 2, 1, '#f4efe6'); D(g, tx + (tw >> 1), ty + th - 1, '#f4efe6'); }
      else { R(g, c.sx0, ty + 1, 4, th - 1, ap.b); R(g, c.sx0, c.legTop, 4, 3, ap.sh); }
    },
    head(c) {
      const { g, hx, hy, hw, dir, ey } = c, hat = ramp('#fbf8f2'), mus = ramp('#2e2018');
      const x0 = dir === 'side' ? hx + 1 : hx + 1, w = hw - 2;
      R(g, x0, hy - 1, w, 2, hat.sh); R(g, x0 - 1, hy - 7, w + 2, 6, hat.b); R(g, x0, hy - 8, w, 1, hat.b);
      R(g, x0 - 1, hy - 7, 2, 3, hat.hi); D(g, x0 + w, hy - 6, hat.sh); D(g, x0 + w, hy - 5, hat.sh); D(g, x0 + 4, hy - 5, hat.sh); D(g, x0 + 8, hy - 4, hat.sh); D(g, x0 + 3, hy - 3, hat.sh);
      if (dir === 'down') { const cx = hx + (hw >> 1); R(g, cx - 3, ey + 3, 6, 1, mus.b); D(g, cx - 3, ey + 3, mus.lt); D(g, cx + 2, ey + 4, mus.b); D(g, cx - 3, ey + 4, mus.b); }
      else if (dir === 'side') R(g, hx - 1, ey + 3, 4, 1, mus.b);
    },
    front(c) {
      const { g, dir } = c;
      if (dir === 'up') return;
      const [hxp, hyp] = dir === 'side' ? c.handS : c.handR;
      const x = hxp - (dir === 'side' ? 6 : 4), y = hyp - 3;
      R(g, x, y + 2, 9, 2, '#a8743a'); R(g, x, y + 2, 9, 1, '#c8955a'); R(g, x, y + 4, 9, 1, '#7e5226');
      for (const bx of [x + 1, x + 4]) { R(g, bx, y, 3, 2, '#e3a64e'); D(g, bx, y, '#f6cf86'); D(g, bx + 2, y + 1, '#b8712a'); }
      R(g, x + 7, y - 1, 2, 3, '#d48c38'); D(g, x + 7, y - 1, '#f0c070');
    },
  };

  const KID = {
    build: 'kid', skin: P.skin[3], top: '#f2c94c', sleeve: '#f2c94c', pants: '#4a6fb0', shoes: '#c84a3a', hair: 'short', hairCol: '#1e1612', hatH: 3,
    legs(c) { // shorts: knees show
      const { g, L, fy } = c;
      if (c.dir === 'side') { const x0 = CX - (L.lw >> 1) - 1; R(g, x0, fy - 3, L.lw, 1, c.skin.b); return; }
      [CX - 1 - L.lw, CX + 1].forEach((lx, i) => { const lift = i ? c.liftR : c.liftL; R(g, lx, fy - 3 - lift, L.lw, 1, c.skin.b); });
    },
    torso(c) { const { g, tx, ty, tw, dir } = c; if (dir !== 'side') R(g, tx, ty + 2, tw, 1, '#d6453a'); else R(g, c.sx0, ty + 2, c.sw, 1, '#d6453a'); },
    head(c) {
      const { g, hx, hy, hw, dir } = c, cap = ramp('#d6453a');
      R(g, hx + 1, hy - 2, hw - 2, 3, cap.b); D(g, hx + 3, hy - 2, cap.hi); D(g, hx + 2, hy - 1, cap.lt); D(g, hx + hw - 2, hy, cap.sh); D(g, hx + (hw >> 1), hy - 3, '#f2c94c');
      if (dir === 'down') R(g, hx + 1, hy + 1, hw - 2, 1, cap.sh);
      else if (dir === 'side') { R(g, hx - 3, hy + 1, 5, 1, cap.sh); D(g, hx - 3, hy + 1, cap.b); }
      else R(g, hx + 2, hy + 1, hw - 4, 1, cap.dk);
    },
  };

  /* frames: {down|up|left|right: {w0..w3, i0, i1, ib, <pose>, <pose>:w0..3}, meta} */
  const KEYS = [['w0', { walk: 1, f: 0 }], ['w1', { walk: 1, f: 1 }], ['w2', { walk: 1, f: 2 }], ['w3', { walk: 1, f: 3 }], ['i0', {}], ['i1', { breath: 1 }], ['ib', { blink: 1 }]];
  function buildFrames(Dz) {
    const fr = { down: {}, up: {}, left: {}, right: {}, meta: {} };
    const keys = KEYS.slice();
    for (const p of Dz.poses || []) keys.push([p, { pose: p }], [p + ':b', { pose: p, blink: 1 }]);
    for (const p of Dz.walkPoses || []) for (let f = 0; f < 4; f++) keys.push([p + ':w' + f, { pose: p, walk: 1, f }]);
    for (const dir of ['down', 'up', 'side']) for (const [k, o0] of keys) {
      const cv = mk(CW, CH), g = cv.getContext('2d'), meta = {};
      paintHuman(g, Dz, dir, Object.assign({}, o0), meta);
      outline(cv);
      if (dir === 'side') {
        fr.left[k] = cv; fr.right[k] = flip(cv);
        fr.meta['left' + k] = meta;
        const mir = (p) => p && [CW - 1 - p[0], p[1]];
        fr.meta['right' + k] = { hand: mir(meta.hand), handL: mir(meta.handL), top: meta.top, lamp: mir(meta.lamp), phone: mir(meta.phone) };
      } else { fr[dir][k] = cv; fr.meta[dir + k] = meta; }
    }
    return fr;
  }

  /* ---------------------------------------------------------------- the cat */
  const CATC = { a: '#e08a3a', b: '#b25e24', c: '#f8d6a6', d: '#8a4418', e: '#2a2433', g: '#7ccf5a', p: '#f09aa0' };
  function paintCat(mode, f, blink) {
    // facing left; 20 x 15 box, feet on the last row
    return paint(20, 15, (g) => {
      const A = ramp(CATC.a);
      if (mode === 'walk') {
        // tail
        const tw = [0, -1, 0, 1][f];
        for (let i = 0; i < 6; i++) D(g, 17 + (i > 3 ? 1 : 0) + (i > 4 ? tw : 0), 7 - i, i < 2 ? CATC.a : CATC.b);
        D(g, 18 + tw, 1, CATC.b);
        // body
        R(g, 6, 6, 12, 5, CATC.a); R(g, 6, 6, 12, 1, A.lt); R(g, 7, 10, 10, 1, CATC.b);
        for (const x of [9, 12, 15]) R(g, x, 6, 1, 3, CATC.b);
        R(g, 7, 9, 5, 2, CATC.c);
        // legs (two pairs alternate)
        const a = f % 2 === 0 ? [[7, 0], [15, 0], [9, 1], [17, 1]] : [[8, 1], [16, 1], [6, 0], [14, 0]];
        for (const [x, back] of a) { R(g, x, 11, 2, 3, back ? CATC.b : CATC.a); D(g, x, 13, back ? CATC.d : CATC.c); }
        // head
        R(g, 1, 3, 7, 6, CATC.a); R(g, 1, 3, 7, 1, A.lt); R(g, 2, 7, 4, 2, CATC.c);
        D(g, 1, 1, CATC.a); D(g, 1, 2, CATC.a); D(g, 2, 2, CATC.p); D(g, 6, 1, CATC.a); D(g, 6, 2, CATC.a); D(g, 5, 2, CATC.b);
        D(g, 2, 5, blink ? CATC.d : CATC.g); D(g, 5, 5, blink ? CATC.d : CATC.g); if (!blink) { D(g, 2, 4, CATC.e); D(g, 5, 4, CATC.e); }
        D(g, 0, 6, CATC.c); D(g, 3, 6, CATC.p);
      } else if (mode === 'sit') {
        // facing the viewer, tail curled round
        R(g, 6, 6, 9, 8, CATC.a); R(g, 6, 6, 1, 8, A.lt); R(g, 14, 6, 1, 8, CATC.b); R(g, 8, 8, 5, 6, CATC.c);
        R(g, 7, 13, 2, 1, CATC.c); R(g, 12, 13, 2, 1, CATC.c);
        for (let i = 0; i < 6; i++) D(g, 15 + (i > 2 ? 1 : 0), 13 - i, i === 5 ? CATC.b : CATC.a);
        R(g, 5, 0, 11, 7, CATC.a); R(g, 5, 0, 11, 1, A.lt); D(g, 5, -1 + 1, CATC.a);
        D(g, 5, 0, CATC.a); D(g, 6, -1 + 1, CATC.p); D(g, 15, 0, CATC.b); D(g, 14, 0, CATC.p);
        R(g, 6, 3, 2, 2, blink ? CATC.a : CATC.g); R(g, 13, 3, 2, 2, blink ? CATC.a : CATC.g);
        if (blink) { R(g, 6, 4, 2, 1, CATC.d); R(g, 13, 4, 2, 1, CATC.d); } else { D(g, 7, 3, CATC.e); D(g, 13, 3, CATC.e); }
        R(g, 8, 4, 5, 3, CATC.c); D(g, 10, 5, CATC.p);
        for (const x of [8, 11]) D(g, x, 1, CATC.b);
      } else { // loaf, asleep
        R(g, 4, 7, 14, 7, CATC.a); R(g, 4, 7, 14, 1, A.lt); R(g, 5, 13, 12, 1, CATC.b);
        for (const x of [9, 12, 15]) R(g, x, 7, 1, 3, CATC.b);
        R(g, 1, 6, 7, 6, CATC.a); R(g, 1, 6, 7, 1, A.lt); D(g, 1, 5, CATC.a); D(g, 2, 5, CATC.p); D(g, 6, 5, CATC.a); D(g, 5, 5, CATC.b);
        R(g, 2, 9, 2, 1, CATC.d); R(g, 5, 9, 2, 1, CATC.d); R(g, 2, 10, 4, 2, CATC.c);
        R(g, 15, 12, 4, 2, CATC.b); D(g, 18, 11, CATC.a);
      }
    });
  }
  let catFr = null;
  function catFrames() {
    if (catFr) return catFr;
    const l = [0, 1, 2, 3].map((f) => paintCat('walk', f, false));
    catFr = { left: l, right: l.map(flip), sit: paintCat('sit', 0, false), sitBlink: paintCat('sit', 0, true), loaf: paintCat('loaf', 0, false) };
    return catFr;
  }

  /* ---------------------------------------------------------------- parcels + items */
  const ITEMS = {};
  function itemSprite(kind) {
    if (ITEMS[kind]) return ITEMS[kind];
    let s;
    if (kind === 'scroll') s = paint(11, 7, (g) => { R(g, 1, 1, 9, 5, '#f3e6c4'); R(g, 1, 1, 9, 1, '#fff8e4'); R(g, 0, 0, 2, 7, '#d8c6a0'); D(g, 0, 0, '#efe2bc'); R(g, 9, 0, 2, 7, '#c8b48a'); R(g, 1, 3, 9, 1, '#c8423c'); R(g, 4, 2, 2, 3, '#93282c'); D(g, 4, 2, '#e85a50'); D(g, 5, 5, '#c8423c'); D(g, 4, 6, '#c8423c'); });
    else if (kind === 'coins') s = paint(10, 9, (g) => { R(g, 1, 3, 8, 6, '#a8784a'); R(g, 1, 3, 2, 6, '#c8955a'); R(g, 7, 3, 2, 6, '#7e5226'); R(g, 2, 2, 6, 1, '#8a5a32'); R(g, 3, 0, 4, 2, P.gold); D(g, 3, 0, '#fff1b0'); D(g, 6, 1, P.goldDark); R(g, 3, 5, 4, 2, P.gold); D(g, 4, 5, '#fff1b0'); D(g, 6, 6, P.goldDark); });
    else if (kind === 'poster') s = paint(9, 11, (g) => { R(g, 0, 0, 9, 11, '#2a1f3a'); R(g, 1, 1, 7, 5, P.neonPink); R(g, 1, 1, 7, 1, '#ff9fd0'); R(g, 3, 2, 3, 2, '#ffffff'); D(g, 4, 4, '#ffd8ec'); R(g, 1, 7, 7, 1, P.neonCyan); R(g, 1, 9, 5, 1, '#8a7aa8'); });
    else if (kind === 'crate') s = paint(11, 9, (g) => { R(g, 0, 0, 11, 9, '#b07a44'); R(g, 0, 0, 11, 1, '#d29a5c'); R(g, 0, 0, 1, 9, '#c88f52'); R(g, 10, 0, 1, 9, '#86592e'); R(g, 0, 8, 11, 1, '#7a5028'); R(g, 1, 4, 9, 1, '#7a5028'); D(g, 2, 2, P.neonCyan); D(g, 3, 2, '#63b4e6'); D(g, 8, 6, P.neonPink); });
    else s = paint(5, 5, (g) => { R(g, 0, 0, 5, 5, P.gold); });
    ITEMS[kind] = s;
    return s;
  }
  const COIN = paint(3, 3, (g) => { R(g, 0, 0, 3, 3, P.gold); D(g, 0, 0, '#fff1b0'); D(g, 2, 2, P.goldDark); }, 0.6);

  /* ================================================================ vehicle sprites
   * Each returns cached canvases plus the anchor (in canvas px) the logic uses.
   */
  const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bay = (x, y) => (BAY[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
  /** Pick a tone for a lit surface (l in -1..1) with ordered dithering between tiers. */
  function tone(rp, l, x, y) {
    const t = [[0.5, rp.hi], [0.18, rp.lt], [-0.22, rp.b], [-0.55, rp.sh]];
    for (const [th, col] of t) { if (l > th + 0.06) return col; if (l > th - 0.06) return bay(x, y) < (l - th + 0.06) / 0.12 ? col : null; }
    return rp.dk;
  }
  function litPix(g, rp, l, x, y) {
    let col = tone(rp, l, x, y);
    if (!col) { const t = [[0.5, rp.lt], [0.18, rp.b], [-0.22, rp.sh], [-0.55, rp.dk]]; for (const [th, c2] of t) if (l > th - 0.07) { col = c2; break; } }
    D(g, x, y, col || rp.dk);
  }

  // ---- the paper glider kite (Lantern Peak). Bar row = KITE_BAR (canvas), centre x = KITE_CX.
  const KITE_CX = 24, KITE_BAR = 27;
  let kiteSpr = null;
  function kiteSprites() {
    if (kiteSpr) return kiteSpr;
    const W = 46, cx = 23;
    const open = paint(W, 29, (g) => {
      const lead = (x) => 1 + (Math.abs(x - cx) * 15) / 22;
      const trail = (x) => 12 + Math.pow(Math.abs(x - cx) / 22, 1.4) * 5;
      for (let x = 1; x < W - 1; x++) {
        const y0 = Math.ceil(lead(x)), y1 = Math.floor(trail(x));
        for (let y = y0; y <= y1; y++) {
          const left = x < cx, e = y - y0;
          let col = left ? '#f6eed6' : '#e2d4b0';
          if (e < 1) col = '#6b4426';
          else if (e < 3) col = left ? '#3fae86' : '#2b836c';
          else if (e === 3) col = left ? '#86d0b0' : '#5fb09a';
          else if (Math.abs(x - cx) % 7 === 0) col = left ? '#d8caa6' : '#c4b48e';
          else if (left && S.hash(x, y, 77) > 0.86) col = '#fff8e4';
          if (y === y1 && e > 2) col = left ? '#c8423c' : '#a83430';
          D(g, x, y, col);
        }
      }
      ell(g, cx, 9, 3, 2, '#d6402f'); D(g, cx - 1, 8, '#f07a5a'); D(g, cx - 2, 9, '#f07a5a'); D(g, cx + 2, 10, '#a82a20');
      for (let y = 1; y < 21; y++) D(g, cx, y, y < 13 ? '#7a5230' : '#5e3e22');
      S.px.line(g, cx, 13, cx - 7, 25, '#6b4426'); S.px.line(g, cx, 13, cx + 7, 25, '#4a3018');
      R(g, cx - 8, 25, 17, 2, '#7a5230'); R(g, cx - 8, 25, 17, 1, '#b8885a'); D(g, cx - 8, 25, '#d8a870');
    });
    const folded = paint(30, 7, (g) => {
      for (let x = 0; x < 30; x++) {
        const h = Math.max(1, Math.round(3 - Math.abs(x - 15) / 6));
        for (let k = -h; k <= h; k++) D(g, x, 3 + k, k < 0 ? '#f6eed6' : k === 0 ? '#e2d4b0' : '#3fae86');
      }
      R(g, 0, 3, 30, 1, '#7a5230'); D(g, 4, 2, '#fff8e4'); D(g, 9, 2, '#fff8e4');
      R(g, 13, 1, 2, 5, '#c8423c'); D(g, 13, 1, '#e85a50');
    });
    kiteSpr = { open, folded };
    return kiteSpr;
  }

  // ---- the neon blimp (Neon Hollow). Anchor = envelope centre BL_A in the east-facing canvas.
  const BL_W = 80, BL_H = 66, BL_A = [40, 16], BL_FLOOR = 43; // rider feet = A.y + BL_FLOOR
  let blimpSpr = null;
  function blimpSprites() {
    if (blimpSpr) return blimpSpr;
    const [ax, ay] = BL_A, rx = 31, ry = 12;
    const env = ramp('#4c3a8e'), fin = ramp('#2fd6ea');
    const back = mk(BL_W, BL_H), g = back.getContext('2d');
    // cables first (behind the envelope's lower edge)
    S.px.line(g, ax - 11, ay + 10, ax - 13, ay + 30, '#2a2238'); S.px.line(g, ax + 11, ay + 10, ax + 12, ay + 30, '#2a2238');
    S.px.line(g, ax - 4, ay + 11, ax - 7, ay + 30, '#3a3250'); S.px.line(g, ax + 4, ay + 11, ax + 6, ay + 30, '#3a3250');
    // tail fins (west end)
    for (let k = 0; k < 9; k++) { R(g, ax - rx + 1 + k, ay - 3 - (9 - k), 1, 9 - k, k < 2 ? fin.lt : fin.b); R(g, ax - rx + 1 + k, ay + 4, 1, 8 - k, fin.sh); }
    R(g, ax - rx + 1, ay - 12, 2, 2, fin.hi);
    // envelope
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
      const tx = x < 0 ? x / (rx * 0.98) : x / rx, tyy = y / (ry * (x < 0 ? 0.92 + 0.08 * (1 + x / rx) : 1));
      const q = tx * tx + tyy * tyy;
      if (q > 1) continue;
      const nz = Math.sqrt(Math.max(0, 1 - q));
      const l = -0.45 * tx - 0.75 * tyy + 0.35 * nz - 0.1;
      litPix(g, env, l, ax + x, ay + y);
    }
    // neon stripes, LED belt rail, nose cap, heart
    for (let x = -rx + 3; x <= rx - 4; x++) {
      const yy = Math.round(ry * Math.sqrt(Math.max(0, 1 - (x / rx) * (x / rx))));
      for (const k of [-0.55, 0.55]) D(g, ax + x, ay + Math.round(yy * k), k < 0 ? (x < 0 ? '#ff7fc0' : P.neonPink) : '#c03080');
      if (x % 3 === 0) D(g, ax + x, ay, '#241c40');
    }
    for (let y = -6; y <= 6; y++) { const w = Math.round(3 * Math.sqrt(1 - (y * y) / 49)); R(g, ax + rx - 2 - w, ay + y, w + 2, 1, y < -1 ? '#ffe7a0' : y < 3 ? P.gold : P.goldDark); }
    D(g, ax + rx, ay - 1, '#fff1b0');
    const HEART = ['.pp.pp.', 'pwpppPp', 'pppppPp', '.pppPp.', '..pPp..', '...p...'];
    S.px.sprite(g, HEART, ax - 9, ay - 3, { p: P.neonPink, P: '#c03080', w: '#ffffff' });
    // gondola back wall (inside, behind the rider)
    const gx0 = ax - 14, gx1 = ax + 13, gy = ay + BL_FLOOR - 13;
    R(g, gx0 + 1, gy, gx1 - gx0 - 1, 4, '#1a1424'); R(g, gx0 + 1, gy, gx1 - gx0 - 1, 1, '#3a2e52');
    outline(back);
    const front = mk(BL_W, BL_H), h = front.getContext('2d');
    const gr = ramp('#352a4c');
    for (let y = gy + 1; y <= gy + 15; y++) {
      const ins = y > gy + 12 ? (y - gy - 12) * 3 : 0;
      for (let x = gx0 + ins; x <= gx1 - ins; x++) litPix(h, gr, (x < (gx0 + gx1) / 2 ? 0.3 : -0.1) - (y - gy) * 0.05, x, y);
    }
    R(h, gx0, gy + 1, gx1 - gx0 + 1, 1, P.neonPink); D(h, gx0, gy + 1, '#ffb0d8');
    for (let x = gx0 + 3; x < gx1 - 2; x += 5) R(h, x, gy + 5, 3, 3, x < ax ? '#9ff6ff' : P.neonCyan);
    for (let x = gx0 + 3; x < gx1 - 2; x += 5) D(h, x, gy + 5, '#ffffff');
    R(h, gx0 + 2, gy + 10, gx1 - gx0 - 3, 1, '#c03080');
    outline(front);
    blimpSpr = { back, front, backW: flip(back), frontW: flip(front) };
    return blimpSpr;
  }

  // ---- the sky-ship (Spindrift Harbor). Anchor SH_A = deck centre in the east-facing canvas.
  const SH_W = 70, SH_H = 62, SH_A = [34, 44], SH_WHEEL = -20; // rider stands at A.x + SH_WHEEL
  let shipSpr = null;
  function shipSprites() {
    if (shipSpr) return shipSpr;
    const [ax, ay] = SH_A;
    const wood = ramp('#9b6b3d'), sail = ramp('#f2ead4'), blue = '#63b4e6';
    const top = (x) => (x < ax - 18 ? ay - 7 : x > ax + 14 ? Math.round(ay - 5 - (x - ax - 14) * 0.45) : ay - 5);
    const bot = (x) => Math.round(ay + 10 - Math.pow((x - ax) / 30, 2) * 12);
    function mastAndSails(g, full) {
      // bowsprit + forestay
      S.px.line(g, ax + 26, ay - 9, ax + 34, ay - 14, '#5e3e22'); S.px.line(g, ax + 26, ay - 8, ax + 34, ay - 13, '#8a5a32');
      // mast
      R(g, ax + 2, ay - 40, 2, 37, '#7a5230'); R(g, ax + 2, ay - 40, 1, 37, '#a8784a'); R(g, ax, ay - 41, 6, 1, '#5e3e22');
      // crow's nest
      R(g, ax - 1, ay - 33, 8, 3, '#8a5a32'); R(g, ax - 1, ay - 33, 8, 1, '#b8885a');
      // boom
      R(g, ax - 18, ay - 12, 22, 2, '#6b4426'); R(g, ax - 18, ay - 12, 22, 1, '#9b6b3d');
      if (full) {
        for (let y = ay - 29; y <= ay - 13; y++) {
          const k = (y - (ay - 29)) / 16, w = Math.round(4 + k * 15 + Math.sin(k * Math.PI) * 3);
          for (let x = ax + 1 - w; x <= ax + 1; x++) {
            const u = (ax + 1 - x) / Math.max(1, w), l = 0.62 - u * 0.55 + Math.sin(k * Math.PI) * 0.15;
            litPix(g, sail, l, x, y);
          }
          if (Math.abs(y - (ay - 20)) <= 1) for (let x = ax + 1 - w; x <= ax + 1; x++) D(g, x, y, y === ay - 21 ? '#8fd0f4' : blue);
        }
        // spinner emblem
        for (const [dx, dy] of [[-7, -16], [-10, -14], [-5, -13]]) D(g, ax + dx, ay + dy, '#2b6a9a');
        D(g, ax - 7, ay - 14, '#f2c94c');
        // jib
        for (let y = ay - 36; y <= ay - 10; y++) {
          const k = (y - (ay - 36)) / 26, w = Math.round(k * 22);
          for (let x = ax + 5; x <= ax + 5 + w; x++) litPix(g, sail, 0.35 - (x - ax - 5) / 40 + (1 - k) * 0.2, x, y);
        }
      } else {
        R(g, ax - 16, ay - 15, 19, 3, sail.b); R(g, ax - 16, ay - 15, 19, 1, sail.hi); R(g, ax - 16, ay - 13, 19, 1, sail.sh);
        for (const x of [ax - 13, ax - 7, ax - 1]) R(g, x, ay - 15, 1, 3, '#c8423c');
        S.px.line(g, ax + 4, ay - 38, ax + 26, ay - 10, '#d8d0bc');
      }
      // stern lantern post
      R(g, ax - 30, ay - 18, 1, 12, '#5e3e22'); R(g, ax - 31, ay - 22, 3, 4, '#3a2a20'); D(g, ax - 30, ay - 21, '#ffd27a');
    }
    const backFull = mk(SH_W, SH_H), backFurl = mk(SH_W, SH_H);
    mastAndSails(backFull.getContext('2d'), true); mastAndSails(backFurl.getContext('2d'), false);
    // the far bulwark behind the deck
    for (const cv of [backFull, backFurl]) { const g = cv.getContext('2d'); for (let x = ax - 30; x <= ax + 28; x++) R(g, x, top(x) - 2, 1, 3, '#5e3e22'); outline(cv); }
    const front = mk(SH_W, SH_H), h = front.getContext('2d');
    for (let x = ax - 31; x <= ax + 30; x++) {
      const t0 = top(x), b0 = bot(x);
      for (let y = t0; y <= b0; y++) {
        const k = (y - t0) / Math.max(1, b0 - t0);
        let col = tone(wood, 0.55 - k * 1.3 - (x > ax + 18 ? 0.1 : 0), x, y) || wood.sh;
        if ((y - t0) % 3 === 2) col = shade(col, -0.18);
        if (y === t0) col = '#e8c860';
        else if (y === t0 + 1) col = '#c4952b';
        else if (y === t0 + 4 || y === t0 + 5) col = y === t0 + 4 ? '#8fd0f4' : blue;
        D(h, x, y, col);
      }
    }
    for (const px0 of [ax - 8, ax + 4, ax + 16]) { const py = top(px0) + 8; R(h, px0 - 1, py - 1, 4, 4, '#c4952b'); R(h, px0, py, 2, 2, '#2a3a52'); D(h, px0, py, '#7fb8e0'); }
    // little feathered sky-wing under the hull
    for (let k = 0; k < 10; k++) R(h, ax - 10 + k, ay + 6 + (k >> 1), 10 - k, 1, k < 2 ? '#ffffff' : k < 6 ? '#d8eef5' : '#9fc8d8');
    // the wheel at the stern, in front of the captain
    const wx = ax + SH_WHEEL + 6, wy = ay - 11;
    R(h, wx, wy, 1, 7, '#5e3e22');
    for (let a = 0; a < 4; a++) { const th = (a / 4) * Math.PI + 0.4; S.px.line(h, wx - Math.round(Math.cos(th) * 5), wy - Math.round(Math.sin(th) * 5), wx + Math.round(Math.cos(th) * 5), wy + Math.round(Math.sin(th) * 5), '#6b4426'); }
    for (let a = 0; a < 28; a++) { const th = (a / 28) * Math.PI * 2; D(h, wx + Math.round(Math.cos(th) * 3.6), wy + Math.round(Math.sin(th) * 3.6), Math.sin(th) + Math.cos(th) < 0 ? '#d8a870' : '#8a5a32'); }
    R(h, wx - 1, wy - 1, 2, 2, P.gold);
    outline(front);
    shipSpr = { backFull, backFurl, front, backFullW: flip(backFull), backFurlW: flip(backFurl), frontW: flip(front) };
    return shipSpr;
  }

  // ---- minecart (Copperhold sky-rail). Anchor MC_A = rail centre.
  const MC_W = 28, MC_H = 20, MC_A = [14, 12];
  let cartSpr = null;
  function cartSprites() {
    if (cartSpr) return cartSpr;
    const [ax, ay] = MC_A, body = ramp('#6d6876'), rim = ramp('#b4b0bc');
    function build(side) {
      const x0 = side ? ax - 11 : ax - 8, x1 = side ? ax + 10 : ax + 7;
      const back = mk(MC_W, MC_H), g = back.getContext('2d');
      R(g, x0 + 1, ay - 10, x1 - x0 - 1, 3, '#2e2a36'); R(g, x0 + 1, ay - 10, x1 - x0 - 1, 1, rim.sh);
      const front = mk(MC_W, MC_H), h = front.getContext('2d');
      R(h, x0, ay - 8, x1 - x0 + 1, 1, rim.b); R(h, x0, ay - 8, 3, 1, rim.hi); D(h, x1, ay - 8, rim.sh);
      for (let y = ay - 7; y <= ay + 1; y++) for (let x = x0; x <= x1; x++) litPix(h, body, 0.4 - (x - x0) / (x1 - x0) * 0.6 - (y - ay + 7) * 0.06, x, y);
      R(h, x0 + 1, ay - 4, x1 - x0 - 1, 2, '#9b6b3d'); R(h, x0 + 1, ay - 3, x1 - x0 - 1, 1, '#74502c');
      for (const x of [x0 + 2, x1 - 2]) { D(h, x, ay - 6, '#d8d4de'); D(h, x, ay, '#d8d4de'); }
      R(h, x0 + 1, ay + 2, x1 - x0 - 1, 1, '#46424e');
      const wheels = side ? [x0 + 4, x1 - 4] : [x0, x1];
      for (const wx of wheels) { R(h, wx - 2, ay + 2, 4, 4, '#2b2733'); R(h, wx - 1, ay + 3, 2, 2, '#a29eaa'); D(h, wx - 1, ay + 3, '#d8d4de'); }
      outline(back); outline(front);
      return { back, front };
    }
    const coins = mk(MC_W, MC_H), g = coins.getContext('2d');
    for (let x = ax - 10; x <= ax + 9; x++) { const hh = 2 + ((x * 7) % 3 === 0 ? 1 : 0); R(g, x, ay - 8 - hh, 1, hh, x % 3 ? P.gold : P.goldDark); }
    D(g, ax - 6, ay - 11, '#fff3b0'); D(g, ax + 3, ay - 11, '#ffffff'); D(g, ax, ay - 10, '#a8784a');
    cartSpr = { side: build(true), end: build(false), coins };
    return cartSpr;
  }

  // ---- the gold payday sky-cart (two wing frames), facing left.
  let payFr = null;
  function paySprites() {
    if (payFr) return payFr;
    const mkf = (wingUp) => paint(34, 26, (g) => {
      const gold = ramp(P.gold);
      for (let x = 7; x <= 28; x++) {
        const hh = x < 10 || x > 25 ? 1 : 0;
        for (let y = 11 + hh; y <= 20 - hh; y++) litPix(g, gold, 0.5 - (x - 7) / 21 * 0.8 - (y - 11) * 0.05, x, y);
      }
      R(g, 6, 10, 24, 1, '#fff1b0'); R(g, 7, 14, 22, 1, P.goldDark); R(g, 7, 18, 22, 1, P.goldDark);
      // coin emblem
      ell(g, 17, 16, 2, 2, '#fff1b0'); D(g, 17, 16, P.goldDark);
      // heap of coins
      for (let x = 9; x <= 26; x++) { const hh = 2 + Math.round(Math.sin((x - 9) / 17 * Math.PI) * 3); R(g, x, 10 - hh, 1, hh, x % 2 ? P.gold : P.goldDark); }
      D(g, 14, 5, '#ffffff'); D(g, 20, 6, '#fff1b0'); D(g, 11, 8, '#fff1b0');
      // wheels (decorative) + a little propeller hub at the nose
      R(g, 10, 21, 3, 3, '#5a4030'); R(g, 23, 21, 3, 3, '#5a4030'); D(g, 11, 22, '#c8955a'); D(g, 24, 22, '#c8955a');
      R(g, 3, 14, 4, 3, '#8a8794'); D(g, 3, 14, '#d8d4de');
      // feathered wing
      const wy = wingUp ? 2 : 13, dir = wingUp ? -1 : 1;
      for (let k = 0; k < 8; k++) R(g, 15 + k, wy + (wingUp ? 8 - k : k) * 0 + (wingUp ? 7 - k : 0), 2, wingUp ? k + 2 : 9 - k, k < 3 ? '#ffffff' : '#e8eef8');
      void dir;
    });
    payFr = [mkf(true), mkf(false)];
    return payFr;
  }
  
  /* ================================================================ places (native px, feet) */
  const NODE_IS = S.nav.island;
  const nodePx = (n) => { const p = S.nav.nodes[n]; return [p[0] * T + T, p[1] * T + T]; };
  const tpx = (p) => [p[0] * T + T, p[1] * T + T];
  const ptOf = (o, fb) => (o && isFinite(o.x) && isFinite(o.y) ? [Math.round(o.x), Math.round(o.y)] : fb);
  function place(node, via, face, extra) {
    const pl = Object.assign({ node, island: NODE_IS[node], via: via || [], face: face || null }, extra || {});
    pl.px = pl.via.length ? pl.via[pl.via.length - 1] : nodePx(node);
    return pl;
  }
  const MON = S.monastery || {};
  const td = ptOf(MON.templeDoor, [224, 158]), bd = ptOf(MON.board, [187, 206]), dk = ptOf(MON.desk, [303, 200]), bl = ptOf(MON.bell, [143, 206]);
  const PL = {
    // Mayor Tock (Clockspire)
    tower: place('TOWER', [[640, 312]], 'down'),
    quest: place('QUEST', [[580, 376]], 'up'),
    mail: place('MAIL', [[700, 378]], 'up'),
    plaza: place('SQ', [[640, 392]], 'down'),
    chronicle: place('CHRON', [[726, 448], [726, 474]], 'left'),
    // Abbot Quill (Lantern Peak)
    templeDoor: place('MON', [[td[0], td[1] + 2]], 'up'),
    board: place('MON', [[td[0], bd[1] + 4], [bd[0], bd[1] + 4]], 'up'),
    desk: place('GARDEN', [[dk[0], 224], [dk[0], dk[1] + 4]], 'up'),
    bell: place('MON', [[td[0], bl[1] + 8], [bl[0], bl[1] + 8]], 'up'),
    // Grit Copperpot (Copperhold)
    mineMouth: place('MINEDOOR', [[1152, 520]], 'up'),
    vault: place('MINE', [[1176, 592], [1176, 680], [1100, 680]], 'up'),
    crystals: place('MINE', [[970, 592], [970, 660]], 'up'),
    station: place('STATION', [[950, 548]], 'up'),
    cottage: place('STATION', [[1024, 544], [1024, 520]], 'up'),
    // Lumi (Neon Hollow)
    angies: place('MKT', [[1056, 212], [972, 212], [972, 170]], 'up'),
    film: place('MKT', [[1056, 240], [1078, 240], [1078, 250]], 'right'),
    fidget: place('MKT', [[1056, 240], [1100, 240]], 'up'),
    billboard: place('MKT', [[1056, 116]], 'up'),
    // Cap'n Twirl (Spindrift Harbor)
    stalls: place('PORT', [[150, 604]], 'up'),
    yellowStall: place('PORT', [[284, 614]], 'up'),
    warehouse: place('PORT', [[212, 600], [212, 678], [142, 678]], 'up'),
    pier: place('SHIP', [[428, 544]], 'right'),
    // visits to Clockspire
    visitQuill: place('QUEST', [[560, 388]], 'up'),
    visitGrit: place('MAIL', [[722, 384], [722, 396]], 'left'),
    visitLumi: place('SQ', [[618, 362]], 'down'),
    visitTwirl: place('SQ', [[664, 362]], 'down'),
    // the ceremony ring around the fountain
    // (Tock on the plaza medallion north of the fountain; the four agents in a shallow arc
    //  in front of him, open in the middle so he stays in view; Hudson watching from the
    //  west end of the row. One row only, so name tags never land on someone's body.)
    cTock: place('SQ', [[640, 372]], 'down'),
    cQuill: place('QUEST', [[574, 384], [574, 396]], 'right'),
    cLumi: place('MAIL', [[706, 384], [706, 396]], 'left'),
    cGrit: place('QUEST', [[604, 384], [604, 410]], 'right'),
    cTwirl: place('MAIL', [[676, 384], [676, 410]], 'left'),
    cHudson: place('QUEST', [[544, 384], [544, 394]], 'right'),
    // Hudson's wander
    h1: place('QUEST', [[552, 384], [552, 340]], 'down'),
    h2: place('SQ', [[640, 352]], 'down'),
    h3: place('MAIL', [[752, 384], [752, 336]], 'down'),
    h4: place('SQ', [[600, 392]], 'right'),
    h5: place('QUEST', [[570, 378]], 'up'),
    h6: place('D_SW', [[536, 472]], 'left'),
    // islanders
    bun1: place('BLIMP', [[944, 224]], 'down'),
    bun2: place('MKT', [[1056, 198]], 'left'),
    bun3: place('MKT', [[1056, 240], [1124, 240]], 'down'),
  };
  const CEREMONY_SPOT = { hub: PL.cTock, 'academic-core': PL.cQuill, 'social-ops': PL.cLumi, 'ledger-fi': PL.cGrit, 'hustle-engine': PL.cTwirl };

  /* ---------------------------------------------------------------- path cleaning */
  function cleanPath(pts) {
    let out = [];
    for (const p of pts) { const l = out[out.length - 1]; if (!l || Math.abs(l[0] - p[0]) > 0.01 || Math.abs(l[1] - p[1]) > 0.01 || (p[2] || 0) !== (l[2] || 0)) out.push(p.slice()); }
    // drop the middle of axis-aligned collinear triples (removes overshoot detours and spikes)
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 1; i + 1 < out.length; i++) {
        const a = out[i - 1], b = out[i], c = out[i + 1];
        if ((b[2] || 0) || (c[2] || 0)) continue;
        if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) { out.splice(i, 1); changed = true; break; }
      }
      const o2 = [];
      for (const p of out) { const l = o2[o2.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1] || (p[2] || 0)) o2.push(p); }
      if (o2.length !== out.length) changed = true;
      out = o2;
    }
    return out;
  }
  const pathLen = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };

  /* ================================================================ vehicle paths
   * Every vehicle runs between its 'home' dock (biome island) and its 'hub' dock
   * on Clockspire. path(u) gives the anchor at u (0 = home, 1 = hub), without bob.
   */
  function bezier(P0, P1, P2, P3, u) {
    const m = 1 - u;
    return [m * m * m * P0[0] + 3 * m * m * u * P1[0] + 3 * m * u * u * P2[0] + u * u * u * P3[0], m * m * m * P0[1] + 3 * m * m * u * P1[1] + 3 * m * u * u * P2[1] + u * u * u * P3[1]];
  }
  /** Resample a parametric curve by arc length so travel speed is even. */
  function arcTable(fn, n = 200) {
    const pts = [], acc = [0];
    for (let i = 0; i <= n; i++) pts.push(fn(i / n));
    for (let i = 1; i <= n; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const len = acc[n];
    return { len, at(u) {
      const s = clamp(u, 0, 1) * len;
      let lo = 0, hi = n;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (acc[mid] < s) lo = mid; else hi = mid; }
      const k = acc[hi] - acc[lo] > 0 ? (s - acc[lo]) / (acc[hi] - acc[lo]) : 0;
      return [lerp(pts[lo][0], pts[hi][0], k), lerp(pts[lo][1], pts[hi][1], k)];
    } };
  }

  // kite: rider feet from the Lantern Peak pad to the Clockspire landing pad
  const KITE_HOME = ptOf(MON.kitePad, [406, 224]), KITE_HUB = [506, 292];
  const kitePath = arcTable((u) => {
    const e = smooth(u);
    return [lerp(KITE_HOME[0], KITE_HUB[0], e), lerp(KITE_HOME[1], KITE_HUB[1], u) - Math.sin(Math.PI * Math.pow(u, 0.8)) * 72];
  });
  // blimp: envelope centre from the Neon Hollow ring to the Clockspire mast eye
  const MK = (S.market && S.market.dock) || { x: 884, y: 102 };
  const BLIMP_HOME = [Math.round(MK.x) - 32, Math.round(MK.y)], BLIMP_HUB = [836, 232];
  const blimpPath = arcTable((u) => [lerp(BLIMP_HOME[0], BLIMP_HUB[0], u) - Math.sin(Math.PI * u) * 34, lerp(BLIMP_HOME[1], BLIMP_HUB[1], smooth(u))]);
  // ship: deck centre from the Spindrift pier head (bow east) to the Clockspire pier (bow west)
  const PD = (S.port && S.port.dock) || { x: 448, y: 544 };
  const SHIP_HOME = [Math.round(PD.x) + 32, Math.round(PD.y) - 2], SHIP_HUB = [414, 482];
  // Out east from the Spindrift pier head, round in front of Clockspire's pier (south of it,
  // so the hull never crosses the planks), then up into the berth at the pier's west end.
  const shipPath = arcTable((u) => bezier(SHIP_HOME, [SHIP_HOME[0] + 65, SHIP_HOME[1] + 11], [SHIP_HUB[0] + 56, SHIP_HUB[1] + 28], SHIP_HUB, u));
  // rail: the cart follows S.nav.rails exactly (rounded corners like the bridge), sampled per px
  const RAIL = (function () {
    const pts = (S.nav.rails || []).map(([x, y]) => [x * T + 8, y * T + 8]);
    if (pts.length < 2) return null;
    const ext = (a, b, d) => { const dx = Math.sign(a[0] - b[0]), dy = Math.sign(a[1] - b[1]); return [a[0] + dx * d, a[1] + dy * d]; };
    pts[0] = ext(pts[0], pts[1], 18);                                   // run in to the Copperhold buffer
    pts[pts.length - 1] = ext(pts[pts.length - 1], pts[pts.length - 2], -6); // stop short of Clockspire's buffer
    const RAD = 12, samp = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      let [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const dx = Math.sign(bx - ax), dy = Math.sign(by - ay);
      if (i > 0) { ax += dx * RAD; ay += dy * RAD; }
      if (i + 2 < pts.length) { bx -= dx * RAD; by -= dy * RAD; }
      const len = Math.abs(bx - ax) + Math.abs(by - ay);
      for (let k = 0; k < len; k++) samp.push([ax + dx * k, ay + dy * k, dx, dy]);
      if (i + 2 < pts.length) {
        const [cx, cy] = pts[i + 1], [nx, ny] = pts[i + 2];
        const ex = Math.sign(nx - cx), ey = Math.sign(ny - cy);
        const ox = cx - dx * RAD + ex * RAD, oy = cy - dy * RAD + ey * RAD;
        const steps = Math.round((Math.PI / 2) * RAD);
        for (let k = 0; k < steps; k++) {
          const th = (k / steps) * (Math.PI / 2);
          const ux = -ex * Math.cos(th) + dx * Math.sin(th), uy = -ey * Math.cos(th) + dy * Math.sin(th);
          samp.push([ox + RAD * ux, oy + RAD * uy, dx * Math.cos(th) + ex * Math.sin(th), dy * Math.cos(th) + ey * Math.sin(th)]);
        }
      }
    }
    const z = pts[pts.length - 1], q = samp[samp.length - 1];
    samp.push([z[0], z[1], q ? q[2] : -1, q ? q[3] : 0]);
    return samp;
  })();
  // the bridge bobs column by column between Copperhold (east) and Clockspire (west)
  const RAIL_MX = S.islands.mine.x * T + 18, RAIL_SX = (S.islands.square.x + S.islands.square.w) * T + 9;
  const railU = (x) => clamp((RAIL_MX - x) / (RAIL_MX - RAIL_SX), 0, 1);

  /* ================================================================ data */
  const data = S.data || {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  const metrics = (a) => (S.metrics ? S.metrics(a) : {}) || {};
  const thread = (a) => (S.thread ? S.thread(a) : null);
  const LABEL = { 'academic-core': 'Academic-Core', 'ledger-fi': 'Ledger-Fi', 'social-ops': 'Social-Ops', 'hustle-engine': 'Hustle-Engine', hub: 'Hub' };
  function alertsFor(agent) {
    const th = thread(agent), lab = (th && th.label) || LABEL[agent];
    return arr(data.alerts).filter((a) => a && a.msg && (a.agent === agent || a.agent === lab));
  }
  const openHumanTasks = () => arr(data.tasks).filter((t) => t && t.autonomy === 'human' && t.phase !== 'done');
  const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const deliveriesOf = (agent) => { const d = Number((metrics(agent).world || {}).deliveries); return isFinite(d) && d > 0 ? d : 0; };

  function agentLines(agent) {
    const out = [], m = metrics(agent), w = m.world || {}, th = thread(agent);
    for (const b of arr(w.bubbles)) if (typeof b === 'string' && b.trim()) out.push({ text: b.trim(), tone: 'info' });
    for (const a of alertsFor(agent)) out.push({ text: a.msg, tone: a.level === 'critical' ? 'critical' : 'warn' });
    if (th && th.summary) out.push({ text: th.summary, tone: !th.last_run || th.phase === 'uninit' ? 'quiet' : 'info' });
    if (agent === 'academic-core') {
      if (!arr(m.deadlines).length) out.push({ text: m.classroom_feed === 'connected' ? 'No deadlines on the scrolls' : 'No Classroom mail yet', tone: 'quiet' });
    } else if (agent === 'ledger-fi') {
      if (m.bank_feed !== 'connected') out.push({ text: 'Bank alerts not linked yet', tone: 'quiet' });
      if (arr(m.savings).length && arr(m.savings).every((s) => s && s.target == null)) out.push({ text: 'Savings goals need targets', tone: 'quiet' });
    } else if (agent === 'social-ops') {
      if (!m.scheduled_posts_7d) out.push({ text: 'No posts queued yet', tone: 'quiet' });
      if (!arr(m.clients).length) out.push({ text: 'No client feeds loaded yet', tone: 'quiet' });
    } else if (agent === 'hustle-engine') {
      const sh = m.shopify || {};
      if (sh.orders_7d == null) out.push({ text: 'Shopify not hooked up yet', tone: 'quiet' });
      else if (sh.orders_7d === 0) out.push({ text: 'No orders this week', tone: 'quiet' });
    }
    return out;
  }
  function tockLines() {
    const out = [];
    out.push(() => { const n = S.cycle && S.cycle.next; return n && n.at ? { text: 'Next bell at ' + nyFmt.format(n.at), tone: 'info' } : { text: 'No cycle times set', tone: 'quiet' }; });
    const runs = arr(data.runs);
    if (runs.length && runs[0]) out.push({ text: 'Last cycle: ' + runs[0].cycle + ' (' + runs[0].result + ')', tone: runs[0].result === 'ok' ? 'info' : 'warn' });
    else out.push({ text: 'No cycle has run yet', tone: 'quiet' });
    const q = openHumanTasks().length;
    out.push({ text: q ? plural(q, 'quest') + ' on the board' : 'Quest board is clear', tone: q ? 'info' : 'quiet' });
    const al = arr(data.alerts).length;
    if (al) out.push({ text: plural(al, 'alert') + ' on file', tone: arr(data.alerts).some((a) => a && a.level === 'critical') ? 'critical' : 'warn' });
    return out;
  }
  function hudsonLines() {
    const out = [], tasks = openHumanTasks();
    if (tasks.length) {
      out.push({ text: plural(tasks.length, 'quest') + ' for me', tone: 'info' });
      const top = tasks.slice().sort((a, b) => (a.priority || 9) - (b.priority || 9))[0];
      if (top && top.title) out.push({ text: 'Next: ' + top.title, tone: 'info', max: 2 });
    } else out.push({ text: 'No quests for me right now', tone: 'quiet' });
    out.push(() => (S.time.isPayday ? { text: 'Friday: payday!', tone: 'info' } : null));
    return out;
  }
  /** Split a line into bubble-sized chunks (one line each, ~24 chars). */
  function chunks(text, max) {
    const LIM = 25, words = String(text).split(/\s+/), out = [];
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

  /* ================================================================ particles (dust, sparks, item flights) */
  const dust = { square: [], monastery: [], market: [], port: [], mine: [] };
  const DUST_COL = { square: '#d6cfc2', monastery: '#cfc4a6', market: '#9a8ac0', port: '#e2cfa0', mine: '#dca066' };
  function puff(island, x, y, n) {
    const list = dust[island];
    if (!list || RM || list.length > 40) return;
    for (let i = 0; i < (n || 2); i++) list.push({ x: x + rand(-2, 2), y: y - rand(0, 1), vx: rand(-6, 6), t: 0, life: rand(0.35, 0.6) });
  }
  const sparks = [];   // {x, y, t, life, col, island}
  const flights = [];  // {spr, x0, y0, x1, y1, t, dur, h, island, done}
  function burst(x, y, col, n, island) {
    const N = RM ? Math.min(3, n || 6) : n || 6;
    for (let i = 0; i < N; i++) sparks.push({ x: x + rand(-6, 6), y: y + rand(-7, 2), t: -rand(0, 0.35), life: rand(0.5, 0.9), col, island: island || null });
  }
  function fly(spr, x0, y0, x1, y1, dur, h, island, done) { flights.push({ spr, x0, y0, x1, y1, t: 0, dur, h, island: island || null, done }); }
  function onScreen(x, y, pad = 0) {
    if (!S.canvas || !S.worldToScreen) return true;
    const p = S.worldToScreen(x, y), w = S.canvas.clientWidth || 0, h = S.canvas.clientHeight || 0;
    return p.x > -pad && p.y > -pad && p.x < w + pad && p.y < h + pad;
  }

  /* ================================================================ villagers */
  const villagers = [], byId = {};
  const HOURS = () => (S.time && typeof S.time.hours === 'number' ? S.time.hours : 12);
  const asleepAt = (h, sl) => (sl ? (sl[0] > sl[1] ? h >= sl[0] || h < sl[1] : h >= sl[0] && h < sl[1]) : false);
  let clock = 0;

  function makeVillager(o) {
    const v = Object.assign({
      x: 0, y: 0, island: null, dir: 'down', speed: 28, hurry: 1, dist: 0, wait: rand(0.5, 3),
      plan: null, si: 0, at: null, target: null, pending: null, riding: null, sleeping: false, hidden: false,
      blinkT: rand(1, 4), blinkOn: 0, breathT: rnd(), stepLen: 5, queue: [], bubbleUntil: 0, lineIdx: Math.floor(rnd() * 5),
      h: 30, shadowW: 14, lastFrame: -1, carrying: null, pose: null, hopY: 0,
    }, o);
    if (v.design) { v.fr = buildFrames(v.design); const m = v.fr.meta.downi0; v.h = FY - (m && m.top != null ? m.top : FY - 30); }
    v.tagDy = v.h + 5;
    v.update = (dt, t) => updateV(v, dt, t);
    v.draw = (ctx, t) => { if (v.riding) return; if (v.drawFn) v.drawFn(v, ctx, t); else drawV(v, ctx, t); };
    villagers.push(v); if (v.id) byId[v.id] = v;
    S.addEntity(v);
    return v;
  }
  function setAt(v, pl) {
    v.at = pl; v.plan = null; v.target = null; v.pending = null;
    if (!pl.stay) { v.riding = null; v.x = pl.px[0]; v.y = pl.px[1]; v.island = pl.island; }
    if (pl.face) v.dir = pl.face;
  }
  const nodePlace = (n) => place(n, [], null);

  // walk edges in px, for re-planning from the middle of a path
  const WALK_EDGES = S.nav.edges.filter((e) => !e[3] || e[3] === 'walk').map(([a, b, pts]) => ({ a, b, island: NODE_IS[a], pts: pts.map(tpx) }));
  function snapToNav(v) {
    let best = null;
    for (const e of WALK_EDGES) {
      if (e.island !== v.island) continue;
      let acc = 0;
      for (let i = 0; i + 1 < e.pts.length; i++) {
        const [ax, ay] = e.pts[i], [bx, by] = e.pts[i + 1], L = Math.hypot(bx - ax, by - ay) || 1;
        const k = clamp(((v.x - ax) * (bx - ax) + (v.y - ay) * (by - ay)) / (L * L), 0, 1);
        const qx = ax + (bx - ax) * k, qy = ay + (by - ay) * k, d = Math.hypot(v.x - qx, v.y - qy);
        if (!best || d < best.d) best = { d, e, i, q: [Math.round(qx), Math.round(qy)], along: acc + L * k };
        acc += L;
      }
    }
    if (!best) return null;
    const { e, i, q } = best, total = pathLen(e.pts);
    if (best.along <= total - best.along) { const pts = [q]; for (let j = i; j >= 0; j--) pts.push(e.pts[j]); return { pts, node: e.a }; }
    const pts = [q]; for (let j = i + 1; j < e.pts.length; j++) pts.push(e.pts[j]); return { pts, node: e.b };
  }
  /** Points from the dock node to the seat (with kinds), reversed for getting off. */
  function revPts(node, board) {
    const full = [nodePx(node)].concat(board), out = [];
    for (let i = full.length - 1; i >= 1; i--) out.push([full[i - 1][0], full[i - 1][1], full[i][2] || 0]);
    return out;
  }
  const busy = (v) => { const st = v.plan && v.plan[v.si]; return !!(st && st.t === 'ride' && st.ph && st.ph !== 'await'); };

  function planTo(v, target, hurry) {
    if (busy(v)) { v.pending = { target, hurry }; return; }
    v.pending = null; v.hurry = hurry || 1;
    const V0 = v.riding;
    if (!V0 && v.at === target) { v.plan = null; v.target = null; if (target.face) v.dir = target.face; return; }
    let head = [], startNode;
    if (V0) startNode = V0.ends[V0.end || 'home'].node;
    else if (v.at && !v.at.stay) { head = v.at.via.slice().reverse(); head.push(nodePx(v.at.node)); startNode = v.at.node; }
    else {
      const sn = snapToNav(v);
      if (!sn) return;
      head = sn.pts; startNode = sn.node;
    }
    const legs = S.route(startNode, target.node), steps = [];
    if (V0) {
      const tr = legs.find((l) => l.mode !== 'walk');
      const firstWalk = legs[0] && legs[0].mode === 'walk' ? legs[0].pts.length : 0;
      const keep = (tr && VEH[tr.mode] === V0 && firstWalk <= 1) || (!tr && target.stay === V0 && V0.end === 'home');
      if (!keep) steps.push({ t: 'ride', V: V0, from: V0.end, to: V0.end, ph: 'alight' });
    }
    let cur = { t: 'walk', island: v.island, pts: V0 ? [nodePx(startNode)] : [[v.x, v.y]].concat(head) };
    for (const leg of legs) {
      if (leg.mode === 'walk') { for (const p of leg.pts) cur.pts.push(tpx(p)); cur.island = leg.island; continue; }
      const V = VEH[leg.mode];
      if (!V) continue;
      cur.pts = cleanPath(cur.pts);
      if (cur.pts.length > 1) steps.push(cur);
      const from = NODE_IS[leg.from] === 'square' ? 'hub' : 'home';
      steps.push({ t: 'ride', V, from, to: from === 'hub' ? 'home' : 'hub' });
      cur = { t: 'walk', island: NODE_IS[leg.to], pts: [nodePx(leg.to)] };
    }
    for (const p of target.via) cur.pts.push(p.slice());
    cur.pts = cleanPath(cur.pts);
    if (cur.pts.length > 1) steps.push(cur);
    if (target.stay) steps.push({ t: 'ride', V: target.stay, from: 'home', to: null });
    v.plan = steps; v.si = 0; v.target = target; v.at = null;
    startStep(v);
  }
  function startStep(v) {
    const st = v.plan && v.plan[v.si];
    if (!st) { finishPlan(v); return; }
    if (st.t === 'walk') { v.wpts = st.pts; v.wi = 1; v.island = st.island; v.at = null; }
    else if (st.t === 'ride' && !st.ph) st.ph = 'await';
  }
  function stepDone(v) {
    v.si++;
    if (v.pending) { const p = v.pending; v.pending = null; planTo(v, p.target, p.hurry); return; }
    startStep(v);
  }
  function finishPlan(v) {
    const tg = v.target;
    v.plan = null; v.target = null; v.hurry = 1;
    if (tg) { v.at = tg; if (tg.face && !tg.stay) v.dir = tg.face; }
    if (v.onArrive) { const f = v.onArrive; v.onArrive = null; f(v); }
  }
  /** Move along v.wpts; returns true when done. Point kinds: 0 walk, 1 climb, 2 hop. */
  function walkUpdate(v, dt) {
    let step = v.speed * v.hurry * dt;
    v.climbing = false;
    while (step > 0 && v.wi < v.wpts.length) {
      const p = v.wpts[v.wi], kind = p[2] || 0;
      if (kind === 2) {
        if (!v.hop) v.hop = { x0: v.x, y0: v.y, t: 0 };
        const H = v.hop;
        H.t = Math.min(1, H.t + (dt * Math.max(1, v.hurry)) / 0.45);
        v.x = lerp(H.x0, p[0], H.t); v.y = lerp(H.y0, p[1], H.t); v.hopY = -Math.round(Math.sin(Math.PI * H.t) * 7);
        if (Math.abs(p[0] - H.x0) > 2) v.dir = p[0] < H.x0 ? 'left' : 'right';
        if (H.t >= 1) { v.hop = null; v.hopY = 0; v.wi++; }
        return v.wi >= v.wpts.length;
      }
      const dx = p[0] - v.x, dy = p[1] - v.y, d = Math.hypot(dx, dy), sp = kind === 1 ? 0.55 : 1;
      if (d > 0.01) v.dir = kind === 1 ? (dy < 0 ? 'up' : 'down') : Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
      v.climbing = kind === 1;
      if (d <= step * sp) { v.x = p[0]; v.y = p[1]; v.wi++; step -= d / sp; v.dist += d; }
      else { v.x += (dx / d) * step * sp; v.y += (dy / d) * step * sp; v.dist += step * sp; step = 0; }
    }
    return v.wi >= v.wpts.length;
  }
  function rideUpdate(v, st, dt) {
    const V = st.V;
    if (st.ph === 'await') {
      if (v.riding === V) {
        if (V.trip) return;
        if (V.end !== st.from) { V.go(st.from); return; }
        st.ph = 'ride';
      } else {
        if (V.trip || (V.rider && V.rider !== v) || (V.reserved && V.reserved !== v)) return;
        if (V.end !== st.from) { V.go(st.from); return; }
        V.reserved = v;
        v.wpts = [[v.x, v.y]].concat(V.ends[st.from].board); v.wi = 1;
        st.ph = 'board';
      }
    }
    if (st.ph === 'board') { if (!walkUpdate(v, dt)) return; V.attach(v); st.ph = V.mode === 'kite' ? 'grab' : 'ride'; st.tt = 0.7; }
    if (st.ph === 'grab') { st.tt -= dt; if (st.tt > 0) return; st.ph = 'ride'; }
    if (st.ph === 'ride') {
      if (!st.to) { stepDone(v); return; }
      V.speedMul = v.hurry > 1 ? 1.35 : 1;
      V.go(st.to, { onArrive: () => { st.ph = 'alight'; } });
      if (st.ph === 'ride') st.ph = 'riding';
      return;
    }
    if (st.ph === 'riding') return;
    if (st.ph === 'alight') {
      V.detach(v);
      const E = V.ends[st.to];
      v.wpts = [[v.x, v.y]].concat(revPts(E.node, E.board)); v.wi = 1;
      st.ph = 'leaving';
    }
    if (st.ph === 'leaving') {
      if (!walkUpdate(v, dt)) return;
      if (st.to === 'home') V.reserved = null;
      v.at = nodePlace(V.ends[st.to].node);
      stepDone(v);
    }
  }

  function updateV(v, dt, t) {
    if (v.tick) v.tick(v, dt, t);
    v.blinkT -= dt;
    if (v.blinkT <= 0) { v.blinkOn = 0.14; v.blinkT = rand(2.5, 5.5); }
    if (v.blinkOn > 0) v.blinkOn -= dt;
    const st = v.plan && v.plan[v.si];
    if (st) {
      if (st.t === 'walk') { if (walkUpdate(v, dt)) stepDone(v); }
      else if (st.t === 'ride') rideUpdate(v, st, dt);
      // footstep dust on each footfall
      const n = Math.floor(v.dist / v.stepLen) % 4;
      if (n !== v.lastFrame) { if ((n === 0 || n === 2) && v.dust !== false && !v.climbing && !v.hop && !v.riding && st.t === 'walk' && v.island) puff(v.island, v.x + (n ? 3 : -3), v.y, 2); v.lastFrame = n; }
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
  const isWalking = (v) => { const st = v.plan && v.plan[v.si]; return !!(st && (st.t === 'walk' || st.ph === 'board' || st.ph === 'leaving') && !v.hop); };
  function frameOf(v, t, dirOverride, forceKey) {
    const fr = v.fr, dir = dirOverride || v.dir, dirSet = fr[dir] || fr.down;
    let key;
    if (forceKey && dirSet[forceKey]) key = forceKey;
    else if (v.pose && dirSet[v.pose]) key = v.blinkOn > 0 && dirSet[v.pose + ':b'] ? v.pose + ':b' : v.pose;
    else if (isWalking(v)) { const n = Math.floor(v.dist / v.stepLen) % 4; key = v.carrying && dirSet['carry:w' + n] ? 'carry:w' + n : 'w' + n; }
    else if (v.carrying && dirSet.carry) key = 'carry';
    else if (v.blinkOn > 0 || v.sleeping) key = 'ib';
    else key = Math.floor(t / (RM ? 1.4 : 0.9) + v.breathT * 3) & 1 ? 'i1' : 'i0';
    return { cv: dirSet[key], meta: fr.meta[dir + key] || {} };
  }
  /** Draw a character's sprite with feet at (x, y). */
  function drawFigure(v, ctx, t, x, y, dirOverride, forceKey, noShadow) {
    x = Math.round(x); y = Math.round(y);
    let bounce = 0;
    if (!RM && isWalking(v) && !v.climbing && !dirOverride) bounce = -Math.round(Math.abs(Math.sin((Math.PI * v.dist) / (2 * v.stepLen))) * 1.6);
    if (!noShadow && !v.climbing) ctx.drawImage(shadowSpr(v.shadowW), x - (v.shadowW >> 1), y - 2);
    const { cv, meta } = frameOf(v, t, dirOverride, forceKey);
    const oy = y - FY + bounce + v.hopY;
    if (cv) ctx.drawImage(cv, x - CX, oy);
    if (v.overlay) v.overlay(v, ctx, t, meta, x - CX, oy, dirOverride || v.dir);
    return meta;
  }
  function drawV(v, ctx, t) { if (!v.hidden) drawFigure(v, ctx, t, v.x, v.y); }

  /* ================================================================ vehicles */
  const VEH = {};
  const ISL_OF = (V, end) => (end === 'hub' ? 'square' : V.home);
  function makeVehicle(o) {
    const V = Object.assign({ end: 'home', trip: null, rider: null, reserved: null, cargo: null, facing: 1, u: 0, speedMul: 1, island: null, open: 0, x: 0, y: 0, ax: 0, ay: 0, off: 0 }, o);
    V.go = (to, opts = {}) => {
      if (V.trip) return;
      if (V.end === to) { if (opts.onArrive) opts.onArrive(); return; }
      V.trip = { from: V.end, to, k: 0, onArrive: opts.onArrive || null };
      V.end = null;
      if (V.onDepart) V.onDepart(V);
    };
    V.attach = (v) => { V.rider = v; v.riding = V; v.at = null; v.hopY = 0; V.place(); };
    V.detach = (v) => {
      V.rider = null; v.riding = null;
      const s = V.seat();
      v.x = s[0]; v.y = s[1]; v.island = ISL_OF(V, V.end || 'home');
    };
    V.place = () => {
      if (V.trip) { const k = clamp(V.trip.k, 0, 1), e = smooth(k); V.u = V.trip.from === 'home' ? e : 1 - e; }
      else V.u = V.end === 'hub' ? 1 : 0;
      const a = V.path(V.u);
      V.ax = a[0]; V.ay = a[1];
      V.off = V.bobAt ? V.bobAt(V.u, V.ax) : S.bobBetween(V.home, 'square', V.u);
      const r = V.rider;
      if (r) {
        const s = V.seat();
        r.x = s[0];
        if (V.trip) { r.island = null; r.y = s[1] + V.off; } else { r.island = ISL_OF(V, V.end); r.y = s[1]; }
      }
      V.x = V.ax; V.y = V.sortY();
    };
    V.update = (dt) => {
      const prevX = V.ax;
      if (V.trip) {
        V.trip.k += (dt * V.speedMul) / V.dur;
        V.place();
        if (V.trip.k >= 1) {
          const tr = V.trip; V.end = tr.to; V.trip = null; V.speedMul = 1;
          V.place();
          if (V.onArriveV) V.onArriveV(V, tr.to);
          if (tr.onArrive) tr.onArrive();
        }
      } else V.place();
      const vx = V.ax - prevX;
      if (V.turns) {
        const want = V.trip ? (Math.abs(vx) > 0.02 ? Math.sign(vx) : V.facingWant || V.facing) : V.end === 'hub' ? V.hubFacing : V.homeFacing;
        V.facingWant = want;
        V.facing = clamp(V.facing + Math.sign(want - V.facing) * dt * 2.2, -1, 1);
        if (Math.abs(V.facing - want) < 0.05) V.facing = want;
      }
      if (V.tickV) V.tickV(V, dt);
    };
    S.addEntity(V);
    VEH[V.mode] = V;
    return V;
  }
  /** Draw a vehicle canvas pair (back/front) mirrored by facing, squashed while turning. */
  function drawFacing(ctx, cv, anchorX, x, y, facing, anchorY) {
    const f = Math.max(0.18, Math.abs(facing)), w = Math.max(2, Math.round(cv.width * f));
    const ax = facing >= 0 ? anchorX : cv.width - 1 - anchorX;
    ctx.drawImage(cv, 0, 0, cv.width, cv.height, Math.round(x - ax * f), Math.round(y - anchorY), w, cv.height);
  }
  /* Night tint for art out in open space. The atmosphere darkens each island through a
   * mask cut to its silhouette, so a vehicle over space would stay day-bright: draw it into
   * a scratch canvas, multiply by the same sky colour, add the same veil, then blit. */
  const tintA = mk(200, 128), tintB = mk(200, 128), tgA = tintA.getContext('2d'), tgB = tintB.getContext('2d');
  function skyNow() {
    const sk = S.atmo && typeof S.atmo.sky === 'function' ? S.atmo.sky() : null;
    return sk && (sk.mul !== '#ffffff' || sk.la > 0.002) ? sk : null;
  }
  const overSpace = (x, y) => !S.islandAt(Math.floor(x / T), Math.floor(y / T));
  function drawTinted(ctx, bx, by, bw, bh, fn) {
    const sk = skyNow();
    if (!sk) { fn(ctx); return; }
    bx = Math.round(bx); by = Math.round(by); bw = Math.min(200, bw); bh = Math.min(128, bh);
    tgA.setTransform(1, 0, 0, 1, 0, 0); tgA.clearRect(0, 0, bw, bh);
    tgA.translate(-bx, -by); fn(tgA); tgA.setTransform(1, 0, 0, 1, 0, 0);
    tgB.globalCompositeOperation = 'copy'; tgB.drawImage(tintA, 0, 0);
    tgB.globalCompositeOperation = 'multiply'; tgB.fillStyle = sk.mul; tgB.fillRect(0, 0, bw, bh);
    tgB.globalCompositeOperation = 'destination-in'; tgB.drawImage(tintA, 0, 0);
    if (sk.la > 0.002) { tgB.globalCompositeOperation = 'source-atop'; tgB.fillStyle = S.color.rgba(sk.lift, Math.min(0.85, sk.la)); tgB.fillRect(0, 0, bw, bh); }
    tgB.globalCompositeOperation = 'source-over';
    ctx.drawImage(tintB, 0, 0, bw, bh, bx, by, bw, bh);
  }
  /** Wrap a vehicle's draw so it is tinted while its anchor is out over space. box(V) -> [x, y, w, h]. */
  function tintWhenInSpace(V, box) {
    const raw = V.draw;
    V.draw = (ctx, t) => {
      if (!overSpace(V.ax, V.ay)) { raw(ctx, t); return; }
      const b = box(V);
      drawTinted(ctx, b[0], b[1], b[2], b[3], (g) => raw(g, t));
    };
  }
  function drawRider(V, ctx, t, x, y, dir, key) {
    const r = V.rider;
    if (!r || r.hidden) return null;
    return drawFigure(r, ctx, t, x, y, dir, key || (r.sleeping ? 'ib' : null), true);
  }

  // ---- the kite (Lantern Peak <-> Clockspire)
  const kite = makeVehicle({
    mode: 'kite', id: 'kite', owner: 'academic-core', home: 'monastery', dur: 7.5,
    ends: { home: { node: 'KITE', board: [[KITE_HOME[0], KITE_HOME[1]]] }, hub: { node: 'D_NW', board: [[KITE_HUB[0], KITE_HUB[1]]] } },
    path: (u) => kitePath.at(u),
    seat: () => [Math.round(kite.ax), Math.round(kite.ay)],
    sortY: () => (kite.trip ? 1e5 + kite.ay : kite.ay + (kite.open > 0.5 ? 2 : -3)),
    tickV(V, dt) { const want = V.trip || V.rider || V.cargo ? 1 : 0; V.open = clamp(V.open + Math.sign(want - V.open) * dt * 2.5, 0, 1); },
    draw(ctx, t) {
      const V = kite, K = kiteSprites(), x = Math.round(V.ax), off = V.off, y = Math.round(V.ay) + off;
      if (V.open < 0.5) { ctx.drawImage(K.folded, x - 15, y - 7); return; }
      const sway = V.trip && !RM ? Math.round(Math.sin(t * 2.3) * 1.5) : 0;
      const bar = y - 23 + sway, kx = x - KITE_CX, ky = bar - KITE_BAR;
      // ribbon tail streaming behind
      const back = V.trip ? (V.trip.to === 'hub' ? -1 : 1) : -1;
      for (let j = 0; j < 7; j++) {
        const tx = x + 1 + back * (j * 2 + 2) + Math.round(Math.sin(t * 6 + j) * 1.2), ty = ky + 18 + j * 2;
        D(ctx, tx, ty, j % 2 ? '#c8423c' : '#86d0b0');
      }
      ctx.drawImage(K.open, kx, ky);
      if (V.rider) {
        const dir = V.trip ? (V.trip.to === 'hub' ? 'right' : 'left') : 'down';
        drawRider(V, ctx, t, x, y + sway, dir, 'hang');
      } else if (V.cargo) {
        R(ctx, x, bar + 1, 1, 6, '#e8e0cc');
        const spr = itemSprite(V.cargo); ctx.drawImage(spr, x - (spr.width >> 1), bar + 7);
      }
    },
  });

  // ---- the neon blimp (Neon Hollow <-> Clockspire)
  const blimp = makeVehicle({
    mode: 'blimp', id: 'blimp', owner: 'social-ops', home: 'market', dur: 9, turns: true, facing: 1, homeFacing: 1, hubFacing: -1,
    ends: {
      home: { node: 'BLIMP', board: [[Math.round(MK.x) + 22, 214], [Math.round(MK.x) + 22, BLIMP_HOME[1] + BL_FLOOR, 1], [BLIMP_HOME[0] + 16, BLIMP_HOME[1] + BL_FLOOR], [BLIMP_HOME[0], BLIMP_HOME[1] + BL_FLOOR, 2]] },
      hub: { node: 'D_NE', board: [[797, 290], [797, BLIMP_HUB[1] + BL_FLOOR, 1], [BLIMP_HUB[0] - 16, BLIMP_HUB[1] + BL_FLOOR], [BLIMP_HUB[0], BLIMP_HUB[1] + BL_FLOOR, 2]] },
    },
    path: (u) => blimpPath.at(u),
    seat: () => [Math.round(blimp.ax), Math.round(blimp.ay) + BL_FLOOR],
    sortY: () => (blimp.trip ? 1e5 + blimp.ay : blimp.ay),
    draw(ctx, t) {
      const V = blimp, B = blimpSprites(), x = Math.round(V.ax), y = Math.round(V.ay) + V.off, f = V.facing;
      const east = f >= 0, fl = BL_FLOOR;
      // gangplank to the mast while moored
      if (!V.trip) {
        const px0 = V.end === 'home' ? x + 14 : 799, px1 = V.end === 'home' ? Math.round(MK.x) + 18 : x - 14;
        R(ctx, px0, y + fl - 1, px1 - px0, 3, INK); R(ctx, px0, y + fl - 1, px1 - px0, 1, '#b8885a'); R(ctx, px0, y + fl, px1 - px0, 1, '#7a5230');
        for (let k = px0 + 2; k < px1; k += 4) D(ctx, k, y + fl - 5, '#c9b48a');
        R(ctx, px0, y + fl - 5, px1 - px0, 1, 'rgba(201,180,138,0.55)');
      }
      drawFacing(ctx, east ? B.back : B.backW, BL_A[0], x, y, f, BL_A[1]);
      if (Math.abs(f) > 0.5) drawRider(V, ctx, t, x, y + fl, 'down');
      drawFacing(ctx, east ? B.front : B.frontW, BL_A[0], x, y, f, BL_A[1]);
      if (V.cargo && !V.rider && Math.abs(f) > 0.5) { const spr = itemSprite(V.cargo); ctx.drawImage(spr, x - (spr.width >> 1), y + fl - 16); }
      // tail propeller + LED ticker
      const sgn = f >= 0 ? 1 : -1, tail = x - sgn * Math.round(33 * Math.abs(f));
      const ph = RM ? 0 : Math.floor(t * (V.trip ? 18 : 4)) % 3;
      ctx.fillStyle = '#d8d4e8';
      if (ph === 0) ctx.fillRect(tail, y - 4, 1, 9); else if (ph === 1) { ctx.fillRect(tail, y - 2, 1, 2); ctx.fillRect(tail, y + 1, 1, 2); } else ctx.fillRect(tail, y, 1, 1);
      if (Math.abs(f) > 0.7 && !RM) for (let i = 0; i < 5; i++) {
        const dx = ((Math.floor(t * 14) + i * 9) % 44) - 22;
        D(ctx, x + Math.round(dx * Math.abs(f)), y, '#9ff6ff');
      }
    },
  });

  // ---- the sky-ship (Spindrift Harbor <-> Clockspire)
  const ship = makeVehicle({
    mode: 'ship', id: 'ship', owner: 'hustle-engine', home: 'port', dur: 8.5, turns: true, facing: 1, homeFacing: 1, hubFacing: -1,
    ends: {
      home: { node: 'SHIP', board: [[Math.round(PD.x) - 4, Math.round(PD.y)], [SHIP_HOME[0] + SH_WHEEL, SHIP_HOME[1], 2]] },
      hub: { node: 'D_SW', board: [[458, 480], [SHIP_HUB[0] - SH_WHEEL, SHIP_HUB[1], 2]] },
    },
    path: (u) => shipPath.at(u),
    seat: () => [Math.round(ship.ax + SH_WHEEL * Math.sign(ship.facing || 1) * Math.max(0.2, Math.abs(ship.facing))), Math.round(ship.ay)],
    sortY: () => (ship.trip ? 1e5 + ship.ay : ship.ay + 14),
    draw(ctx, t) {
      const V = ship, Sh = shipSprites(), x = Math.round(V.ax), bobS = V.trip && !RM ? Math.round(Math.sin(t * 2.1) * 1.2) : 0, y = Math.round(V.ay) + V.off + bobS, f = V.facing;
      const east = f >= 0, full = !!V.trip;
      // sky-wake: little cloud puffs off the stern
      if (V.trip && !RM) {
        const sgn = east ? -1 : 1;
        for (let k = 0; k < 6; k++) {
          const ph = (t * 1.6 + k / 6) % 1, wx = x + sgn * Math.round((30 + ph * 26) * Math.abs(f)), wy = y + 4 + Math.round(Math.sin(k * 2.1) * 3);
          ctx.globalAlpha = 0.55 * (1 - ph); R(ctx, wx - 1, wy, 3, 2, '#e8f4ff'); ctx.globalAlpha = 1;
        }
      }
      drawFacing(ctx, east ? (full ? Sh.backFull : Sh.backFurl) : (full ? Sh.backFullW : Sh.backFurlW), SH_A[0], x, y, f, SH_A[1]);
      // pennant at the masthead
      const mx = x + Math.round(3 * f), my = y - 41, fw = Math.sign(f) || 1;
      for (let k = 0; k < 5; k++) D(ctx, mx - fw * (k + 1), my + Math.round(Math.sin(t * 7 + k) * (RM ? 0 : 1)) + (k > 2 ? 1 : 0), k < 3 ? '#63b4e6' : '#f2c94c');
      if (Math.abs(f) > 0.5) drawRider(V, ctx, t, V.rider ? V.rider.x : x, y, east ? 'right' : 'left');
      if (V.cargo && Math.abs(f) > 0.5) { const spr = itemSprite(V.cargo); ctx.drawImage(spr, x + Math.round(8 * f) - (spr.width >> 1), y - spr.height + 1); }
      drawFacing(ctx, east ? Sh.front : Sh.frontW, SH_A[0], x, y, f, SH_A[1]);
    },
  });

  // ---- the minecart (Copperhold <-> Clockspire on the sky-rail)
  const RAIL_N = RAIL ? RAIL.length - 1 : 0;
  const cart = makeVehicle({
    mode: 'rail', id: 'minecart', owner: 'ledger-fi', home: 'mine', dur: RAIL ? RAIL_N / 34 : 6,
    ends: {
      home: { node: 'STATION', board: [[RAIL ? Math.round(RAIL[0][0]) - 8 : 912, 546], [RAIL ? Math.round(RAIL[0][0]) : 922, RAIL ? Math.round(RAIL[0][1]) : 536, 2]] },
      hub: { node: 'D_SE', board: [[RAIL ? Math.round(RAIL[RAIL_N][0]) + 4 : 786, 486], [RAIL ? Math.round(RAIL[RAIL_N][0]) : 782, RAIL ? Math.round(RAIL[RAIL_N][1]) : 472, 2]] },
    },
    path: (u) => { if (!RAIL) return [922, 536]; const s = u * RAIL_N, i = Math.min(RAIL_N, Math.floor(s)), j = Math.min(RAIL_N, i + 1), k = s - i; cart.dirv = RAIL[i]; return [lerp(RAIL[i][0], RAIL[j][0], k), lerp(RAIL[i][1], RAIL[j][1], k)]; },
    bobAt: (u, x) => S.bobBetween('mine', 'square', railU(x)),
    seat: () => [Math.round(cart.ax), Math.round(cart.ay) + 1],
    sortY: () => cart.ay + 7,
    onDepart() { if (onScreen(cart.ax, cart.ay)) sfx('cart'); },
    draw(ctx, t) {
      const V = cart, C = cartSprites(), dv = V.dirv || [0, 0, -1, 0];
      const side = Math.abs(dv[2]) >= Math.abs(dv[3]);
      const rattle = V.trip && !RM ? Math.floor(t * 14) & 1 : 0;
      const x = Math.round(V.ax), y = Math.round(V.ay) + V.off - rattle;
      const set = side ? C.side : C.end;
      ctx.drawImage(set.back, x - MC_A[0], y - MC_A[1]);
      if (V.rider) {
        const goingHub = V.trip ? V.trip.to === 'hub' : V.end === 'home';
        const dir = side ? (dv[2] * (goingHub ? 1 : -1) < 0 ? 'left' : 'right') : (dv[3] * (goingHub ? 1 : -1) < 0 ? 'up' : 'down');
        drawRider(V, ctx, t, x, y + 1, V.trip ? dir : 'down');
      } else if (V.cargo) ctx.drawImage(C.coins, x - MC_A[0], y - MC_A[1]);
      ctx.drawImage(set.front, x - MC_A[0], y - MC_A[1]);
    },
  });

  tintWhenInSpace(kite, (V) => [V.ax - 40, V.ay + V.off - 64, 80, 80]);
  tintWhenInSpace(blimp, (V) => { const x0 = Math.min(V.ax - 46, 794), x1 = Math.max(V.ax + 46, Math.round(MK.x) + 22); return [x0, V.ay + V.off - 22, x1 - x0, 76]; });
  tintWhenInSpace(ship, (V) => [V.ax - 64, V.ay + V.off - 50, 128, 72]);
  tintWhenInSpace(cart, (V) => [V.ax - 20, V.ay + V.off - 52, 40, 64]);

  /* ================================================================ the characters */
  const roleOf = (agent, fb) => { const th = thread(agent); return (th && th.domain) || fb; };
  const tock = makeVillager({
    id: 'hub', agent: 'hub', name: 'Mayor Tock', role: 'the Director', design: TOCK, speed: 28, stepLen: 5,
    work: [PL.tower, PL.quest, PL.mail, PL.plaza, PL.chronicle], dwell: [7, 14], home: PL.tower, sleep: [23, 5.25], item: 'bell', homeIsland: 'square',
  });
  const quill = makeVillager({
    id: 'academic-core', agent: 'academic-core', name: 'Abbot Quill', role: 'School', design: QUILL, speed: 25, stepLen: 5,
    work: [PL.templeDoor, PL.board, PL.desk, PL.bell], visit: PL.visitQuill, dwell: [8, 16], home: PL.templeDoor, sleep: [21.5, 5.0], item: 'scroll', homeIsland: 'monastery', V: kite,
  });
  const grit = makeVillager({
    id: 'ledger-fi', agent: 'ledger-fi', name: 'Grit Copperpot', role: 'Finances', design: GRIT, speed: 23, stepLen: 4, shadowW: 18,
    work: [PL.mineMouth, PL.vault, PL.crystals, PL.station], visit: PL.visitGrit, dwell: [8, 15], home: PL.cottage, sleep: [22, 6], item: 'coins', homeIsland: 'mine', V: cart,
  });
  const lumi = makeVillager({
    id: 'social-ops', agent: 'social-ops', name: 'Lumi', role: 'Social media', design: LUMI, speed: 31, stepLen: 5,
    work: [PL.angies, PL.film, PL.fidget, PL.billboard], visit: PL.visitLumi, dwell: [6, 12], sleep: [1, 8.5], item: 'poster', homeIsland: 'market', V: blimp,
  });
  const twirl = makeVillager({
    id: 'hustle-engine', agent: 'hustle-engine', name: "Cap'n Twirl", role: 'Side hustles', design: TWIRL, speed: 28, stepLen: 5,
    work: [PL.stalls, PL.yellowStall, PL.warehouse, PL.pier], visit: PL.visitTwirl, dwell: [7, 14], sleep: [22.5, 6], item: 'crate', homeIsland: 'port', V: ship,
  });
  lumi.home = { node: 'BLIMP', island: 'market', via: [], face: 'down', stay: blimp, px: nodePx('BLIMP') };
  twirl.home = { node: 'SHIP', island: 'port', via: [], face: 'right', stay: ship, px: nodePx('SHIP') };
  const AGENTS = [tock, quill, grit, lumi, twirl];
  const hudson = makeVillager({
    id: 'player', kind: 'player', name: (data.player && data.player.name) || 'Hudson', design: HUDSON, speed: 32, stepLen: 5,
    work: [PL.h1, PL.h2, PL.h3, PL.h4, PL.h5, PL.h6], dwell: [4, 9], home: PL.tower, sleep: [22.5, 6.5], homeIsland: 'square',
  });
  for (const v of AGENTS) v.lines = v === tock ? tockLines() : agentLines(v.agent);
  hudson.lines = hudsonLines();

  /* ================================================================ timers (frame clock, so pausing works) */
  const timers = [];
  function after(s, fn) { timers.push({ at: clock + s, fn }); }

  /* ================================================================ deliveries + Mayor Tock's mail round */
  const AGENT_ITEM = { 'academic-core': 'scroll', 'ledger-fi': 'coins', 'social-ops': 'poster', 'hustle-engine': 'crate' };
  const DROP = {
    kite: { at: [518, 296], place: place('D_NW', [[530, 296]], 'left') },
    blimp: { at: [776, 298], place: place('D_NE', [[764, 298]], 'right') },
    ship: { at: [474, 481], place: place('D_SW', [[488, 481]], 'left') },
    rail: { at: [798, 488], place: place('D_SE', [[786, 488]], 'right') },
  };
  const MAIL_SLOT = [694, 344];
  const parcels = [];   // {kind, x, y, place, state}
  function cargoPos(V) {
    if (V.mode === 'kite') return [V.ax, V.ay - 10 + V.off];
    if (V.mode === 'blimp') return [V.ax, V.ay + BL_FLOOR - 10 + V.off];
    if (V.mode === 'ship') return [V.ax + 8 * (V.facing || 1), V.ay - 6 + V.off];
    return [V.ax, V.ay - 10 + V.off];
  }
  for (const V of [kite, blimp, ship, cart]) {
    V.onArriveV = (VV, end) => {
      if (end !== 'hub' || VV.rider) return;
      if (VV.cargo) {
        const kind = VV.cargo, [cx, cy] = cargoPos(VV), D0 = DROP[VV.mode];
        VV.cargo = null;
        fly(itemSprite(kind), cx, cy, D0.at[0], D0.at[1] - 4, 0.7, 14, 'square', () => {
          parcels.push({ kind, x: D0.at[0], y: D0.at[1], place: D0.place, state: 'waiting' });
          burst(D0.at[0], D0.at[1] - 6, '#fff3b0', 5, 'square');
          if (kind === 'coins' && onScreen(D0.at[0], D0.at[1])) sfx('coin');
        });
        after(1.6, () => { if (!VV.rider && VV.end === 'hub' && !VV.reserved) VV.go('home'); });
      } else after(rand(2, 4), () => { if (!VV.rider && VV.end === 'hub' && !VV.reserved) VV.go('home'); });
    };
  }
  const parcelEnt = S.addEntity({ x: 0, y: 0, island: 'square', update() { parcelEnt.y = 480; }, draw(ctx) {
    for (const p of parcels) {
      if (p.state !== 'waiting') continue;
      const spr = itemSprite(p.kind);
      ctx.drawImage(shadowSpr(10), p.x - 5, p.y - 2);
      ctx.drawImage(spr, Math.round(p.x) - (spr.width >> 1), Math.round(p.y) - spr.height + 1);
    }
  } });
  function vehicleFree(V) {
    const o = byId[V.owner];
    return V.end === 'home' && !V.trip && !V.rider && !V.reserved && !(o && o.plan && o.plan.some((st) => st.t === 'ride' && st.V === V));
  }
  const sched = { kite: 0, blimp: 0, ship: 0, rail: 0, payday: 0 };
  function scheduleTick(t) {
    for (const V of [kite, blimp, ship, cart]) {
      if (t < sched[V.mode]) continue;
      const d = deliveriesOf(V.owner);
      sched[V.mode] = t + (d > 0 ? clamp(95 / (1 + d * 0.5), 32, 95) : 240) * rand(0.8, 1.25) * (RM ? 1.5 : 1);
      if (CER.active || !vehicleFree(V) || parcels.length >= 4) continue;
      if (S.time.isNight && rnd() < 0.75) continue;
      V.cargo = d > 0 ? AGENT_ITEM[V.owner] : null;   // no data, no parcel: just an empty run
      V.go('hub');
    }
    if (S.time.isPayday && t >= sched.payday) {
      sched.payday = t + (RM ? 220 : 140) * rand(0.8, 1.2);
      const h = HOURS();
      if (h > 6.5 && h < 21.5 && !CER.active) startPayday();
    }
  }

  /* ================================================================ brains */
  const CER = { active: false, beat: null, rung: 0, nextRing: 0, slots: [], rate: 1 / 75, lastP: null, endSaid: false };
  const ceremonyHolds = () => CER.active && CER.beat !== 'disperse';
  function wake(v) {
    if (!v.sleeping && !v.hidden) return;
    v.sleeping = false;
    if (v.hidden) { v.hidden = false; if (v.home && !v.home.stay) setAt(v, v.home); }
  }
  function goSleep(v) {
    if (v.at !== v.home) { planTo(v, v.home); v.onArrive = (vv) => { vv.wait = 0.2; }; return; }
    if (!v.sleeping) { v.sleeping = true; if (!v.home.stay) v.hidden = true; }
    v.wait = 5;
  }
  function agentBrain(v) {
    if (ceremonyHolds()) return;
    v.wait = 1;
    if (asleepAt(HOURS(), v.sleep) && !CER.active) { goSleep(v); return; }
    if (v.sleeping) { wake(v); v.wait = 1.5; return; }
    let next;
    const onHub = v.island === 'square' || (v.riding && v.riding.end === 'hub');
    if (onHub) next = pick(v.work);
    else if (v.visit && rnd() < 0.22) next = v.visit;
    else { const opts = v.work.filter((p) => p !== v.at); next = pick(opts.length ? opts : v.work); }
    planTo(v, next);
    v.onArrive = (vv) => { vv.wait = vv.at === vv.visit ? rand(9, 15) : rand(vv.dwell[0], vv.dwell[1]); };
  }
  for (const v of [quill, grit, lumi, twirl]) v.brain = agentBrain;

  tock.brain = function (v) {
    if (ceremonyHolds()) return;
    v.wait = 1;
    if (asleepAt(HOURS(), v.sleep) && !CER.active) { goSleep(v); return; }
    if (v.sleeping) { wake(v); v.wait = 1; return; }
    const p = parcels.find((q) => q.state === 'waiting');
    if (p && !v.carrying) {
      p.state = 'claimed';
      planTo(v, p.place, 1.25);
      v.onArrive = (vv) => {
        vv.dir = p.place.face || 'down';
        burst(p.x, p.y - 6, '#fff3b0', 4, 'square');
        parcels.splice(parcels.indexOf(p), 1);
        vv.carrying = p.kind;
        vv.wait = 0.6;
        vv.brain = (w) => {
          w.brain = tock.brainMain;
          planTo(w, PL.mail);
          w.onArrive = (z) => {
            const spr = itemSprite(z.carrying); z.carrying = null;
            fly(spr, z.x, z.y - 16, MAIL_SLOT[0], MAIL_SLOT[1], 0.55, 8, 'square', () => burst(MAIL_SLOT[0], MAIL_SLOT[1], '#fff3b0', 6, 'square'));
            z.wait = rand(2, 4);
            if (rnd() < 0.5) say(z, { text: 'Delivery posted', tone: 'info' }, clock + 0.6);
          };
        };
      };
      return;
    }
    const opts = v.work.filter((q) => q !== v.at);
    planTo(v, pick(opts));
    v.onArrive = (vv) => { vv.wait = rand(vv.dwell[0], vv.dwell[1]); };
  };
  tock.brainMain = tock.brain;

  hudson.brain = function (v) {
    if (ceremonyHolds()) return;
    v.wait = 1;
    if (asleepAt(HOURS(), v.sleep) && !CER.active) { goSleep(v); return; }
    if (v.sleeping) { wake(v); return; }
    const opts = v.work.filter((p) => p !== v.at);
    planTo(v, pick(opts));
    v.onArrive = (vv) => { vv.wait = rand(4, 9); if (vv.at === PL.h5 && openHumanTasks().length && rnd() < 0.6) say(vv, hudson.lines[0], clock); };
  };

  /* ---------------------------------------------------------------- islanders */
  // a bun seller strolling Neon Hollow
  const baker = makeVillager({ id: 'baker', kind: 'ambient', name: 'Bun seller', design: BAKER, speed: 22, stepLen: 5, sleep: [21, 6.5], work: [PL.bun1, PL.bun2, PL.bun3], home: PL.bun3, dwell: [10, 22], homeIsland: 'market' });
  baker.brain = function (v) {
    v.wait = 1;
    if (asleepAt(HOURS(), v.sleep) && !CER.active) { goSleep(v); return; }
    if (v.sleeping) { wake(v); return; }
    const opts = v.work.filter((p) => p !== v.at);
    planTo(v, pick(opts)); v.onArrive = (vv) => { vv.wait = rand(vv.dwell[0], vv.dwell[1]); };
  };
  // a kid flying a kite on Spindrift Harbor's meadow
  const KID_A = [118, 540], KID_B = [212, 538];
  const kid = makeVillager({ id: 'kid', kind: 'ambient', name: 'Kid', design: KID, speed: 40, stepLen: 4, shadowW: 11, sleep: [19.5, 7.5], island: 'port' });
  kid.x = KID_A[0]; kid.y = KID_A[1]; kid.kite = { x: KID_A[0] + 20, y: KID_A[1] - 70 };
  kid.brain = function (v) {
    if (asleepAt(HOURS(), v.sleep) && !CER.active) { v.hidden = true; v.sleeping = true; v.wait = 5; return; }
    if (v.sleeping) { v.sleeping = false; v.hidden = false; }
    const tgt = Math.abs(v.x - KID_A[0]) < 4 ? KID_B : KID_A;
    v.plan = [{ t: 'walk', island: 'port', pts: [[v.x, v.y], [tgt[0], tgt[1] + Math.round(rand(-3, 3))]] }]; v.si = 0; startStep(v);
    v.onArrive = (vv) => { vv.wait = rand(1.5, 5); vv.dir = 'up'; };
  };
  kid.tick = (v, dt, t) => {
    const k = v.kite, wind = Math.sin(t * 0.37) * 12;
    const tx = v.x + 26 + wind, ty = v.y - 76 + Math.sin(t * 1.3) * 6;
    k.x += (tx - k.x) * Math.min(1, dt * 1.2); k.y += (ty - k.y) * Math.min(1, dt * 1.2);
  };
  // the Clockspire cat
  const CAT_SPOTS = [[590, 404], [692, 404], [552, 330], [752, 420], [612, 472], [700, 300]];
  const cat = makeVillager({ id: 'cat', kind: 'ambient', name: 'Cat', speed: 30, stepLen: 3, h: 15, shadowW: 12, dust: false, island: 'square' });
  cat.x = CAT_SPOTS[0][0]; cat.y = CAT_SPOTS[0][1]; cat.mode = 'loaf'; cat.spot = 0;
  cat.brain = function (v) {
    let i = Math.floor(rnd() * CAT_SPOTS.length);
    if (i === v.spot) i = (i + 1) % CAT_SPOTS.length;
    v.spot = i;
    const s = CAT_SPOTS[i], hub = [640 + Math.round(rand(-8, 8)), 384];
    v.plan = [{ t: 'walk', island: 'square', pts: cleanPath([[v.x, v.y], hub, s]) }]; v.si = 0; startStep(v);
    const night = S.time.isNight;
    v.onArrive = (vv) => { vv.mode = rnd() < (night ? 0.85 : 0.5) ? 'loaf' : 'sit'; vv.wait = rand(night ? 30 : 14, night ? 60 : 34); };
  };
  cat.drawFn = (v, ctx, t) => {
    const F = catFrames(), x = Math.round(v.x), y = Math.round(v.y);
    ctx.drawImage(shadowSpr(12), x - 6, y - 2);
    let spr;
    if (v.plan) { const set = v.dir === 'right' ? F.right : F.left; spr = set[Math.floor(v.dist / 3) % 4]; }
    else if (v.mode === 'loaf') spr = F.loaf;
    else spr = v.blinkOn > 0 ? F.sitBlink : F.sit;
    ctx.drawImage(spr, x - (spr.width >> 1), y - spr.height + 1);
  };

  /* ================================================================ Friday payday sky-cart */
  const pay = S.addEntity({ x: 0, y: 1e5, island: null, hidden: true, state: 'off', k: 0, px: 0, py: 0, facing: -1, update: null, draw: null });
  const PAY_FROM = [1350, 548], PAY_HOVER = [1104, 690], PAY_TO = [1356, 610], VAULT_DOOR = [1098, 642];
  function startPayday() { if (pay.state !== 'off') return; pay.state = 'in'; pay.k = 0; pay.hidden = false; pay.coins = 0; }
  pay.update = (dt) => {
    if (pay.state === 'off') { pay.hidden = true; return; }
    if (pay.state === 'in') {
      pay.k = Math.min(1, pay.k + dt / 6.5);
      const e = smooth(pay.k), p = bezier(PAY_FROM, [1290, 470], [1170, 640], PAY_HOVER, e);
      pay.px = p[0]; pay.py = p[1] + Math.round(S.bob('mine') * e); pay.facing = -1;
      if (pay.k >= 1) { pay.state = 'drop'; pay.k = 0; pay.nextCoin = 0.3; }
    } else if (pay.state === 'drop') {
      pay.k += dt; pay.py = PAY_HOVER[1] + S.bob('mine') + Math.round(Math.sin(pay.k * 3) * 1.5);
      pay.nextCoin -= dt;
      if (pay.nextCoin <= 0 && pay.coins < 7) {
        pay.coins++; pay.nextCoin = 0.42;
        fly(COIN, pay.px, pay.py - 18, VAULT_DOOR[0] + rand(-4, 4), VAULT_DOOR[1] + rand(-3, 3), 0.65, 16, 'mine', (f) => { burst(f.x1, f.y1, '#fff3b0', 3, 'mine'); });
        if (pay.coins === 1 && onScreen(VAULT_DOOR[0], VAULT_DOOR[1])) sfx('coin');
      }
      if (pay.k > 4.2) { pay.state = 'out'; pay.k = 0; }
    } else {
      pay.k = Math.min(1, pay.k + dt / 6);
      const e = pay.k * pay.k, p = bezier(PAY_HOVER, [1150, 640], [1260, 560], PAY_TO, e);
      pay.px = p[0]; pay.py = p[1] + Math.round(S.bob('mine') * (1 - e)); pay.facing = 1;
      if (pay.k >= 1) { pay.state = 'off'; pay.hidden = true; }
    }
    pay.x = pay.px; pay.y = 1e5 + pay.py;
  };
  pay.drawRaw = (ctx, t) => {
    const F = paySprites(), spr = F[RM ? 0 : Math.floor(t * 6) & 1], x = Math.round(pay.px), y = Math.round(pay.py);
    if (pay.facing > 0) { ctx.save(); ctx.scale(-1, 1); ctx.drawImage(spr, -x - 18, y - 24); ctx.restore(); }
    else ctx.drawImage(spr, x - 18, y - 24);
    // nose propeller
    const pxp = x + (pay.facing > 0 ? 17 : -17), ph = RM ? 0 : Math.floor(t * 20) % 2;
    R(ctx, pxp, y - 13 - (ph ? 3 : 1), 1, ph ? 7 : 3, '#e8e4ee');
    if (pay.state !== 'off' && !RM) for (let k = 0; k < 3; k++) { const s = (t * 2 + k / 3) % 1; ctx.globalAlpha = 1 - s; D(ctx, x - pay.facing * Math.round(20 + s * 18), y - 10 + k * 3, '#fff3b0'); ctx.globalAlpha = 1; }
  };
  pay.draw = (ctx, t) => {
    if (!overSpace(pay.px, pay.py - 8)) { pay.drawRaw(ctx, t); return; }
    drawTinted(ctx, pay.px - 44, pay.py - 30, 88, 36, (g) => pay.drawRaw(g, t));
  };

  /* ================================================================ the cycle ceremony */
  function ceremonyName(c) {
    if (c.name && c.name !== 'manual') return c.name;
    const l = S.cycle && S.cycle.last;
    return l ? l.name : 'cycle';
  }
  function beatOf(p) {
    const B = S.CEREMONY_BEATS || { bell: [0, 0.15], gather: [0.15, 0.45], council: [0.45, 0.7], disperse: [0.7, 1] };
    return p < B.bell[1] ? 'bell' : p < B.gather[1] ? 'gather' : p < B.council[1] ? 'council' : 'disperse';
  }
  const people = () => AGENTS.concat(hudson.hidden && !hudson.sleeping ? [] : [hudson]);
  const spotOf = (v) => (v === hudson ? PL.cHudson : CEREMONY_SPOT[v.agent]);
  function beginCeremony(c) {
    CER.active = true; CER.beat = null; CER.rung = 0; CER.nextRing = 0; CER.endSaid = false; CER.lastP = c.progress; CER.slots = [];
    CER.rate = c.name === 'manual' ? 1 / 75 : 1 / 330;
    for (const v of AGENTS.concat([hudson])) { wake(v); v.queue.length = 0; v.wait = 0; v.pose = null; }
    if (tock.carrying) { tock.carrying = null; burst(tock.x, tock.y - 16, '#fff3b0', 4, tock.island); }
    tock.brain = tock.brainMain;
    const p = c.progress, B = S.CEREMONY_BEATS;
    if (p >= B.council[0] && p < B.council[1]) {
      // joined late: everyone is already gathered round the fountain
      for (const v of AGENTS.concat([hudson])) {
        const V = v.V;
        if (V) {
          if (V.rider) { V.rider.riding = null; V.rider = null; }
          V.trip = null; V.end = 'hub'; V.reserved = v; V.cargo = null; V.facing = V.hubFacing || 1; V.place();
        }
        setAt(v, spotOf(v));
      }
    }
  }
  function endCeremony() {
    CER.active = false; CER.beat = null;
    for (const v of AGENTS.concat([hudson])) { v.pose = null; if (!v.plan) v.wait = Math.min(v.wait, rand(0.5, 3)); }
  }
  function gatherAll(h) {
    for (const v of people()) {
      if (v === tock && CER.beat === 'bell') continue;
      const spot = spotOf(v);
      if (v.at === spot || v.target === spot || (v.pending && v.pending.target === spot)) continue;
      v.onArrive = null;
      planTo(v, spot, h);
    }
  }
  function enterBeat(beat, c) {
    CER.beat = beat;
    const fast = CER.rate > 1 / 120 ? 1.7 : 1.15;
    if (beat === 'bell') {
      if (tock.at !== PL.tower) planTo(tock, PL.tower, 1.6);
      tock.onArrive = null;
      say(tock, { text: 'Ding! The ' + ceremonyName(c) + ' cycle', tone: 'info' }, clock + 0.3);
      sfx('bell'); CER.rung = 1; CER.nextRing = clock + 1.8;
      gatherAll(fast);
    } else if (beat === 'gather') {
      tock.pose = null;
      gatherAll(fast);
      if (tock.at !== PL.cTock && tock.target !== PL.cTock) { tock.onArrive = null; planTo(tock, PL.cTock, 1.4); }
    } else if (beat === 'council') {
      tock.pose = null;
      gatherAll(2.2);
      if (tock.at !== PL.cTock && tock.target !== PL.cTock) planTo(tock, PL.cTock, 2);
      const B = S.CEREMONY_BEATS, dur = Math.max(4, (B.council[1] - c.progress) / CER.rate);
      const order = [quill, grit, lumi, twirl];
      CER.slots = order.map((v, i) => ({ v, at: clock + 0.8 + (i * dur * 0.8) / order.length, done: false }));
    } else if (beat === 'disperse') {
      for (const v of AGENTS.concat([hudson])) {
        v.pose = null;
        if (v === tock || v === hudson) { v.wait = rand(0.5, 3); continue; }
        planTo(v, pick(v.work));
        v.onArrive = (vv) => { vv.wait = rand(vv.dwell[0], vv.dwell[1]); };
      }
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
      const there = tock.at === PL.tower && !tock.plan;
      if (there) {
        tock.dir = 'down';
        tock.pose = Math.floor(clock * 4) & 1 ? 'raise' : null;
        if (clock >= CER.nextRing && CER.rung < 3) { CER.rung++; CER.nextRing = clock + 1.8; sfx('bell'); }
      } else tock.pose = null;
    } else if (beat === 'council') {
      for (const v of people()) if (!v.plan && !v.hidden && v.at === spotOf(v)) { if (v === tock) v.dir = 'down'; else faceTo(v, tock.x, tock.y); }
      for (const s of CER.slots) {
        const v = s.v;
        if (s.done || clock < s.at || v.at !== spotOf(v) || v.plan) continue;
        s.done = true;
        fly(itemSprite(v.item), v.x, v.y - 18, tock.x, tock.y - 20, 0.9, 18, 'square', (f) => {
          burst(f.x1, f.y1, '#fff3b0', 8, 'square');
          if (v.item === 'coins') sfx('coin');
        });
        say(v, nextLine(v), clock);
      }
    }
  }

  /* ================================================================ speech bubbles */
  const liveBubbles = [];
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
  const bubbleDy = (v) => v.tagDy + (v.tagOff ? Math.round(v.tagOff) : 0) + rideLift(v) + Math.round(23 / Math.max(0.5, S.cam ? S.cam.z : 1));
  function flushSpeech(t) {
    for (const v of villagers) {
      if (!v.queue.length) continue;
      if (v.hidden) { v.queue.length = 0; continue; }
      const q = v.queue[0];
      if (t >= q.at) {
        v.queue.shift();
        const tone = q.tone && q.tone !== 'info' ? q.tone : undefined;
        const b = S.bubble(v, q.text, { tone, biome: v.homeIsland, ms: v.queue.length ? 2700 : 3800, dy: bubbleDy(v) });
        if (b) liveBubbles.push({ b, v, text: q.text, end: t + (v.queue.length ? 2.7 : 3.8) });
      }
    }
    for (let i = liveBubbles.length - 1; i >= 0; i--) { const L = liveBubbles[i]; if (t > L.end) liveBubbles.splice(i, 1); else L.b.dy = bubbleDy(L.v); }
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
    const wts = cand.map((v) => { const w = (v.agent && v.agent !== 'hub' && alertsFor(v.agent).length ? 1.6 : 1) * (v === hudson ? 0.6 : 1); tot += w; return w; });
    let r = rnd() * tot, i = 0;
    while (i < cand.length - 1 && r > wts[i]) { r -= wts[i]; i++; }
    say(cand[i], nextLine(cand[i]), t);
  }

  /* ================================================================ overlays on sprites */
  const SPIN_COL = ['#3ef0ff', '#ff4fa3', '#f2c94c'];
  twirl.overlay = (v, ctx, t, meta, ox, oy, dir) => {
    if (!meta.hand || dir === 'up') return;
    const cx = ox + meta.hand[0] + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0), cy = oy + meta.hand[1] - 3;
    const a = t * (RM ? 2 : 15);
    R(ctx, cx, cy, 1, 1, '#e8e4ee');
    for (let i = 0; i < 3; i++) {
      const th = a + (i * Math.PI * 2) / 3, lx = Math.round(cx + Math.cos(th) * 2.5), ly = Math.round(cy + Math.sin(th) * 2.5);
      R(ctx, lx, ly, 1, 1, SPIN_COL[i]);
      if (!RM) R(ctx, Math.round(cx + Math.cos(th - 0.7) * 2.5), Math.round(cy + Math.sin(th - 0.7) * 2.5), 1, 1, 'rgba(255,255,255,0.4)');
    }
  };
  tock.overlay = (v, ctx, t, meta, ox, oy, dir) => {
    if (!v.carrying) return;
    const spr = itemSprite(v.carrying);
    if (dir === 'up') return;
    const hx = dir === 'down' ? ox + CX : ox + (meta.hand ? meta.hand[0] : CX);
    ctx.drawImage(spr, Math.round(hx - (spr.width >> 1)), oy + FY - 21);
  };
  quill.overlay = (v, ctx, t, meta, ox, oy) => {
    if (!meta.lamp || RM) return;
    const k = Math.sin(t * 7.3) + Math.sin(t * 11.1);
    if (k > 1.1) D(ctx, ox + meta.lamp[0], oy + meta.lamp[1], '#ffffff');
  };
  lumi.overlay = (v, ctx, t, meta, ox, oy) => {
    if (!meta.phone || RM) return;
    if (v.at === PL.film && Math.floor(t * 1.5) & 1) D(ctx, ox + meta.phone[0] + 2, oy + meta.phone[1] - 1, '#ff3b5c');
  };

  /* ================================================================ lights following people and vehicles */
  const light = (o) => S.addLight(o);
  const quillLamp = light({ x: -99, y: -99, r: 24, color: P.lanternGlow, intensity: 0.85, flicker: 0.12, on: () => !quill.hidden });
  const gritLamp = light({ x: -99, y: -99, r: 20, color: '#fff2b0', intensity: 0.75, on: () => !grit.hidden && !grit.sleeping });
  const lumiGlow = light({ x: -99, y: -99, r: 15, color: P.neonCyan, intensity: 0.45, on: () => !lumi.hidden && !lumi.sleeping });
  const blimpGlow = light({ x: -99, y: -99, r: 40, color: P.neonPink, intensity: 0.55 });
  const shipLamp = light({ x: -99, y: -99, r: 24, color: P.lantern, intensity: 0.8, flicker: 0.1 });
  const cartLamp = light({ x: -99, y: -99, r: 18, color: '#fff2b0', intensity: 0.75, on: () => !!cart.trip });
  const payLight = light({ x: -99, y: -99, r: 30, color: P.gold, intensity: 0.75, on: () => pay.state !== 'off' });
  // soft personal glows so nobody vanishes into the dark at fit zoom (Tock's watch-chain lamp,
  // Twirl's pocket lantern, Hudson's phone screen); hidden or riding people switch theirs off
  const onFoot = (v) => () => !v.hidden && !v.riding && !(v.sleeping && v.home && !v.home.stay);
  const tockGlow = light({ x: -99, y: -99, r: 20, color: '#ffd9a0', intensity: 0.6, on: onFoot(tock) });
  const twirlGlow = light({ x: -99, y: -99, r: 20, color: P.lantern, intensity: 0.65, flicker: 0.08, on: () => !twirl.hidden && !(twirl.riding && twirl.riding.trip) });
  const hudsonGlow = light({ x: -99, y: -99, r: 17, color: '#cfe6ff', intensity: 0.5, on: onFoot(hudson) });
  // positions snap to a 3 px grid so a walking light rebuilds the island's darkness every few frames, not every frame
  const q3 = (n) => Math.round(n / 3) * 3;
  function lightAt(L, v, dx, dy) { L.x = q3(v.x + dx); L.y = q3(v.y + dy); L.island = v.island || null; }
  function vehLight(L, V, dx, dy) { L.x = Math.round(V.ax + dx); L.island = V.trip ? null : ISL_OF(V, V.end); L.y = Math.round(V.ay + dy + (V.trip ? V.off : 0)); }
  function followLights() {
    lightAt(quillLamp, quill, quill.dir === 'left' ? -6 : quill.dir === 'right' ? 6 : 5, -10);
    lightAt(gritLamp, grit, grit.dir === 'left' ? -4 : grit.dir === 'right' ? 4 : 0, -26);
    lightAt(lumiGlow, lumi, 0, -14);
    lightAt(tockGlow, tock, 0, -16);
    lightAt(twirlGlow, twirl, 0, -14);
    lightAt(hudsonGlow, hudson, 0, -14);
    vehLight(blimpGlow, blimp, 0, 4);
    vehLight(shipLamp, ship, -31 * (ship.facing >= 0 ? 1 : -1), -20);
    vehLight(cartLamp, cart, 0, -4);
    payLight.x = Math.round(pay.px); payLight.y = Math.round(pay.py) - 12; payLight.island = null;
  }

  /* ================================================================ hotspots + name tags */
  function addVillagerHotspot(v, label, agent) {
    S.addHotspot({
      id: 'villager:' + (agent || v.id), kind: 'villager', agent: agent || null, character: v.name, biome: v.homeIsland, island: v.homeIsland,
      label, priority: 2,
      rect: () => {
        if (v.hidden) return null;
        const b = v.island ? S.bob(v.island) : 0, up = v.riding === kite && kite.open > 0.5 ? 26 : 0;
        return { x: Math.round(v.x) - 11, y: Math.round(v.y) - v.h - up + b, w: 22, h: v.h + up + 3 };
      },
    });
  }
  const tags = [];
  for (const v of AGENTS) {
    addVillagerHotspot(v, v.name + ' · ' + (v === tock ? 'the Director' : roleOf(v.agent, v.role)), v.agent);
    tags.push({ v, L: S.label(v, v.name, { color: (S.AGENTS[v.agent] || {}).color, dy: v.tagDy }) });
  }
  addVillagerHotspot(hudson, hudson.name + ' · that’s you', null);
  tags.push({ v: hudson, L: S.label(hudson, hudson.name, { color: '#9fd4ff', dy: hudson.tagDy }) });
  /* Name tags are DOM boxes of fixed screen size, so when people stand close (the council,
   * Tock passing Hudson) or the view is zoomed out they pile up. Each frame, stack any
   * overlapping tags upward (lowest tag keeps its place) and ease toward that offset. */
  // riders' tags clear their vehicle: above the kite sail, above the blimp's envelope
  const rideLift = (v) => (v.riding === kite && kite.open > 0.5 ? 26 : v.riding === blimp ? 20 : 0);
  const baseDy = (v) => v.tagDy + rideLift(v);
  function updateTags() {
    const z = Math.max(0.3, S.cam ? S.cam.z : 1), live = [];
    for (const T of tags) {
      const v = T.v;
      if (T.off == null) T.off = 0;
      if (v.hidden) { T.off = 0; T.L.dy = baseDy(v); continue; }
      // widths are estimated from the text (12-13 px UI font) so this never forces a DOM layout
      let wpx = v.name.length * 7 + 14, hpx = 21;
      // a speech bubble rides just above its speaker's tag: treat tag + bubble as one block
      for (const B of liveBubbles) if (B.v === v && B.b && B.b.el && B.b.el.isConnected) {
        wpx = Math.max(wpx, Math.min(182, B.text.length * 7 + 18)); hpx = 21 + 30;
      }
      live.push({ T, x: v.x, y: v.y + S.bob(v.island) - baseDy(v), w: (wpx + 4) / z, h: hpx / z });
    }
    live.sort((a, b) => b.y - a.y);
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (let i = 1; i < live.length; i++) {
        const a = live[i];
        for (let j = 0; j < i; j++) {
          const b = live[j];
          if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && a.y > b.y - b.h && a.y - a.h < b.y) { a.y = b.y - b.h; moved = true; }
        }
      }
      if (!moved) break;
    }
    for (const it of live) {
      const T = it.T, v = T.v, want = v.y + S.bob(v.island) - baseDy(v) - it.y;
      T.off += (want - T.off) * (RM ? 1 : 0.35);
      if (Math.abs(want - T.off) < 0.3) T.off = want;
      v.tagOff = T.off;
      T.L.dy = baseDy(v) + Math.round(T.off);
    }
  }
  S.villagers = { list: villagers, byId, vehicles: VEH, parcels };

  /* ================================================================ dynamic layers */
  // 200: footstep dust, per island so it bobs with the ground
  for (const id of S.ISLANDS) {
    S.registerDynamic(200, (ctx) => {
      const list = dust[id];
      if (!list.length) return;
      const col = S.time.season === 'winter' ? '#f4f8fb' : DUST_COL[id];
      for (const p of list) {
        const k = p.t / p.life, r = 1 + Math.round(k * 2);
        ctx.globalAlpha = 0.7 * (1 - k);
        R(ctx, Math.round(p.x + p.vx * p.t) - r, Math.round(p.y - k * 4), r * 2, 1, col);
        if (r > 1) R(ctx, Math.round(p.x + p.vx * p.t) - r + 1, Math.round(p.y - k * 4) - 1, r * 2 - 2, 1, col);
      }
      ctx.globalAlpha = 1;
    }, { island: id });
  }
  // 400: hand-overs, sparkles, the kid's kite
  let kidKite = null;
  function sparkleAt(ctx, x, y, k, col) {
    x = Math.round(x); y = Math.round(y);
    D(ctx, x, y, '#ffffff');
    if (k > 0.4) { ctx.fillStyle = col || '#fff3b0'; ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1); ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x, y + 1, 1, 1); }
    if (k > 0.75) { ctx.fillStyle = 'rgba(255,246,207,0.7)'; ctx.fillRect(x - 2, y, 1, 1); ctx.fillRect(x + 2, y, 1, 1); ctx.fillRect(x, y - 2, 1, 1); ctx.fillRect(x, y + 2, 1, 1); }
  }
  S.registerDynamic(400, (ctx, t) => {
    if (!kid.hidden) {
      if (!kidKite) kidKite = paint(13, 17, (g) => {
        for (let j = 0; j < 17; j++) { const hw = j <= 7 ? j * 0.85 : (16 - j) * 0.7; const w = Math.round(hw); for (let i = -w; i <= w; i++) D(g, 6 + i, j, (i < 0) !== (j > 7) ? '#e8423a' : P.gold); }
        R(g, 6, 0, 1, 17, '#8a5a32'); R(g, 1, 7, 11, 1, '#8a5a32'); D(g, 4, 3, '#fff3b0'); D(g, 3, 5, '#ffb0a0');
      }, 0.6);
      const b = S.bob('port'), k = kid.kite, hx = Math.round(kid.x) + 4, hy = Math.round(kid.y) - 14 + b;
      const kx = Math.round(k.x), ky = Math.round(k.y) + b;
      ctx.fillStyle = 'rgba(245,240,230,0.7)';
      const n = Math.max(Math.abs(kx - hx), Math.abs(ky - hy));
      for (let i = 0; i <= n; i++) { const u = i / n, sag = Math.sin(u * Math.PI) * 5; ctx.fillRect(Math.round(hx + (kx - hx) * u), Math.round(hy + (ky - hy) * u + sag), 1, 1); }
      for (let j = 0; j < 6; j++) { const tx = kx + 1 - j * 2 + Math.round(Math.sin(t * 5 + j) * 1.5), ty = ky + 16 + j * 3; D(ctx, tx, ty, j % 2 ? '#e8423a' : P.gold); }
      ctx.drawImage(kidKite, kx - 7, ky - 1);
    }
    for (const f of flights) {
      const u = clamp(f.t / f.dur, 0, 1), b = f.island ? S.bob(f.island) : 0;
      const x = f.x0 + (f.x1 - f.x0) * u, y = f.y0 + (f.y1 - f.y0) * u - Math.sin(Math.PI * u) * f.h + b;
      ctx.drawImage(f.spr, Math.round(x) - (f.spr.width >> 1), Math.round(y) - (f.spr.height >> 1));
    }
    for (const s of sparks) {
      if (s.t < 0) continue;
      const k = 1 - s.t / s.life, b = s.island ? S.bob(s.island) : 0;
      if (RM) { D(ctx, Math.round(s.x), Math.round(s.y - s.t * 6 + b), s.col); continue; }
      sparkleAt(ctx, s.x, s.y - s.t * 10 + b, k, s.col);
    }
  });
  // 700: Zzz over the dark, and the blimp's neon
  const Z_BIG = ['#####', '...#.', '..#..', '.#...', '#####'], Z_SMALL = ['####', '..#.', '.#..', '####'];
  function drawZ(ctx, x, y, big, col) {
    const rows = big ? Z_BIG : Z_SMALL;
    ctx.fillStyle = 'rgba(29,26,36,0.7)';
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') { ctx.fillRect(x + i + 1, y + j + 1, 1, 1); ctx.fillRect(x + i - 1, y + j, 1, 1); ctx.fillRect(x + i, y + j - 1, 1, 1); } });
    ctx.fillStyle = col || '#e9e6ff';
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') ctx.fillRect(x + i, y + j, 1, 1); });
  }
  /** A soft three-step glow (alpha discs) over the dark. */
  function halo(ctx, x, y, r, col, a) {
    for (const [k, al] of [[1, 0.1], [0.66, 0.14], [0.36, 0.22]]) { ctx.globalAlpha = a * al; S.px.circle(ctx, x, y, Math.max(1, Math.round(r * k)), col); }
    ctx.globalAlpha = 1;
  }
  function zzzAt(ctx, t, zx, zy, seed) {
    for (let i = 0; i < 3; i++) {
      const ph = (t * (RM ? 0.15 : 0.32) + i / 3 + seed) % 1;
      ctx.globalAlpha = Math.min(1, ph * 4, (1 - ph) * 2) * 0.85;
      drawZ(ctx, Math.round(zx + ph * 10 + Math.sin(ph * 6) * 1.5), Math.round(zy - ph * 22), i !== 1);
    }
    ctx.globalAlpha = 1;
  }
  S.registerDynamic(700, (ctx, t) => {
    let seed = 0;
    for (const v of AGENTS.concat([hudson, baker])) {
      seed += 0.37;
      if (!v.sleeping) continue;
      if (v.riding) { zzzAt(ctx, t, v.x + 4, v.y - v.h - 4 + (v.island ? S.bob(v.island) : 0), seed); continue; }
      if (v === baker || (v === hudson && tock.sleeping)) continue;   // one Zzz per door
      const H = v.home && v.home.px;
      if (H) zzzAt(ctx, t, H[0] + 6, H[1] - 40 + S.bob(v.homeIsland), seed);
    }
    if (!cat.plan && cat.mode === 'loaf') zzzAt(ctx, t, cat.x + 6, cat.y - 14 + S.bob('square'), 0.5);
    const night = 1 - clamp(S.time.light == null ? 1 : S.time.light, 0, 1);
    if (night > 0.3) {
      // lanterns on the vehicles out in space (their art is sky-tinted, so these read as lit)
      if (overSpace(ship.ax, ship.ay)) {
        const f = ship.facing, x = Math.round(ship.ax), y = Math.round(ship.ay) + ship.off;
        halo(ctx, x - Math.round(30 * f), y - 21, 9, P.lanternGlow, night);
        ctx.globalAlpha = 0.85 * night;
        D(ctx, x - Math.round(30 * f), y - 21, '#fff3c0');
        for (const dx of [-8, 4, 16]) R(ctx, Math.round(x + (dx + (f < 0 ? 1 : 0)) * f), y + 3, 2, 2, '#ffd890');
        ctx.globalAlpha = 1;
      }
      if (kite.trip && kite.open > 0.5) {
        // a little paper lantern swings from the end of the kite bar after dark
        const sway = !RM ? Math.round(Math.sin(t * 2.3) * 1.5) : 0, bar = Math.round(kite.ay) + kite.off - 23 + sway;
        const lx = Math.round(kite.ax) + (kite.trip.to === 'hub' ? 8 : -8), ly = bar + 4 + (!RM ? Math.round(Math.sin(t * 3.1)) : 0);
        halo(ctx, lx, ly + 2, 9, P.lanternGlow, night);
        ctx.globalAlpha = Math.min(1, 0.4 + night);
        D(ctx, lx, bar + 1, '#3a2a20'); D(ctx, lx, bar + 2, '#3a2a20');
        R(ctx, lx - 1, ly, 3, 4, '#e0662f'); R(ctx, lx, ly + 1, 1, 2, '#ffd27a'); D(ctx, lx - 1, ly, '#f59a52');
        ctx.globalAlpha = 1;
      }
      if (cart.trip && cart.rider && overSpace(cart.ax, cart.ay)) halo(ctx, Math.round(cart.ax), Math.round(cart.ay) + cart.off - 25, 8, '#fff2b0', night);
      if (pay.state !== 'off' && overSpace(pay.px, pay.py - 8)) halo(ctx, Math.round(pay.px), Math.round(pay.py) - 12, 13, P.gold, 0.8 * night);
      const V = blimp, x = Math.round(V.ax), y = Math.round(V.ay) + V.off;
      // the neon blimp should be the brightest thing in the night sky: glow, both stripes, a lit gondola
      const af = Math.abs(V.facing), sg = V.facing >= 0 ? 1 : -1;
      halo(ctx, x, y + BL_FLOOR - 7, 15, P.neonCyan, 0.55 * night);
      halo(ctx, x - Math.round(6 * V.facing), y, 12, P.neonPink, 0.5 * night);
      ctx.globalAlpha = 0.85 * night;
      for (let dx = -26; dx <= 26; dx += 2) {
        const yy = Math.round(12 * Math.sqrt(Math.max(0, 1 - (dx / 31) * (dx / 31))) * 0.55), xx = x + Math.round(dx * af);
        D(ctx, xx, y - yy, '#ff9fd0'); if (!(dx & 2)) D(ctx, xx, y + yy, '#e050a8');
      }
      ctx.globalAlpha = 0.95 * night;
      for (let dx = -10; dx <= 10; dx += 5) R(ctx, x + dx - 1, y + BL_FLOOR - 8, 3, 3, '#bff8ff');
      R(ctx, x - 13, y + BL_FLOOR - 12, 27, 1, P.neonPink);
      D(ctx, x + Math.round((31 - 1) * af) * sg, y - 1, '#fff1b0');
      ctx.globalAlpha = 1;
    }
  });
  // 800: the player marker
  S.registerDynamic(800, (ctx, t) => {
    if (hudson.hidden || hudson.riding) return;
    const b = S.bob(hudson.island), x = Math.round(hudson.x), y = Math.round(hudson.y) - hudson.h - 7 + b + (RM ? 0 : Math.round(Math.sin(t * 3.2)));
    R(ctx, x - 3, y - 1, 7, 2, INK); R(ctx, x - 2, y + 1, 5, 1, INK); R(ctx, x - 1, y + 2, 3, 1, INK); D(ctx, x, y + 3, INK);
    R(ctx, x - 2, y, 5, 1, P.gold); R(ctx, x - 1, y + 1, 3, 1, P.goldDark); D(ctx, x, y + 2, P.goldDark); D(ctx, x - 2, y, '#fff2b8');
  });

  /* ================================================================ boot + the per-frame driver */
  S.on('boot', () => {
    const h = HOURS();
    const startAt = (v) => {
      if (v.sleep && asleepAt(h, v.sleep) && v.home) {
        if (v.home.stay) { const V = v.home.stay; V.end = 'home'; V.place(); V.attach(v); v.at = v.home; v.sleeping = true; }
        else { setAt(v, v.home); v.hidden = true; v.sleeping = true; }
      } else setAt(v, pick(v.work));
    };
    for (const V of [kite, blimp, ship, cart]) V.place();
    for (const v of AGENTS) startAt(v);
    startAt(hudson); startAt(baker);
    kid.island = 'port'; kid.hidden = asleepAt(h, kid.sleep); kid.sleeping = kid.hidden;
    cat.island = 'square';
    // stagger the first trips so the world wakes up gently, with one already under way
    sched.kite = 6 + rnd() * 10; sched.blimp = 3 + rnd() * 8; sched.ship = 9 + rnd() * 12; sched.rail = 2 + rnd() * 6; sched.payday = 4 + rnd() * 6;
    const first = pick([kite, blimp, ship, cart]);
    if (!S.cycle.ceremony && vehicleFree(first) && !(S.time.isNight)) {
      first.cargo = deliveriesOf(first.owner) > 0 ? AGENT_ITEM[first.owner] : null;
      first.go('hub'); first.trip.k = rand(0.25, 0.5); first.place();
      sched[first.mode] = 30 + rnd() * 20;
    }
  });

  const driver = S.addEntity({ x: 0, y: -1e6, hidden: true, island: null, draw() {}, update(dt, t) {
    clock = t;
    for (let i = timers.length - 1; i >= 0; i--) if (clock >= timers[i].at) { const f = timers[i].fn; timers.splice(i, 1); f(); }
    ceremonyTick(dt);
    scheduleTick(t);
    bubbleTick(t);
    followLights();
    updateTags();
    for (const id in dust) { const list = dust[id]; for (let i = list.length - 1; i >= 0; i--) { list[i].t += dt; if (list[i].t > list[i].life) list.splice(i, 1); } }
    for (let i = flights.length - 1; i >= 0; i--) { const f = flights[i]; f.t += dt; if (f.t >= f.dur) { flights.splice(i, 1); if (f.done) f.done(f); } }
    for (let i = sparks.length - 1; i >= 0; i--) { sparks[i].t += dt; if (sparks[i].t > sparks[i].life) sparks.splice(i, 1); }
  } });
  void driver;
  if (window.SHACK_DEBUG) S._vdbg = {   // preview-only hook (sprite sheets in tests)
     buildFrames, designs: { TOCK, QUILL, GRIT, LUMI, TWIRL, HUDSON, BAKER, KID }, catFrames, itemSprite, kiteSprites, blimpSprites, shipSprites, cartSprites, paySprites };

})();
