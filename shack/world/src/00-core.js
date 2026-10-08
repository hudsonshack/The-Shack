/* The Shack — world engine core.
 *
 * Every other module in src/ is a plain script that extends the global
 * `SHACK` object defined here. Modules register drawing callbacks, entities,
 * lights and hotspots; the core owns the canvas, camera, clock, layering,
 * input and the DOM overlay for speech bubbles and labels.
 *
 * Coordinates: the world is COLS x ROWS tiles of TILE px (native pixels).
 * All drawing happens at native resolution into an offscreen buffer, which is
 * then scaled to the screen with nearest-neighbour sampling.
 */
(function () {
  'use strict';

  const TILE = 16, COLS = 64, ROWS = 40;
  const W = TILE * COLS, H = TILE * ROWS;
  const DEBUG = window.SHACK_DEBUG || {};

  const S = (window.SHACK = {
    TILE, COLS, ROWS, W, H,
    debug: DEBUG,
    reducedMotion: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  });

  /* ------------------------------------------------------------------ data */

  function readData() {
    if (DEBUG.data) return DEBUG.data;
    const el = document.getElementById('shack-data');
    try { return JSON.parse(el ? el.textContent : 'null') || {}; } catch (e) { return {}; }
  }
  S.data = readData();

  /* --------------------------------------------------------------- the map
   * Biome regions (tile rects, inclusive x/y, exclusive x+w/y+h). The river
   * (the Hudson) runs down the west edge and opens into a harbour bay by the
   * port, like the real river at Cold Spring.
   */
  S.regions = {
    monastery: { x: 6, y: 0, w: 20, h: 15, name: 'Highland Monastery', agent: 'academic-core' },
    market:    { x: 40, y: 0, w: 24, h: 16, name: 'Neon Night Market', agent: 'social-ops' },
    square:    { x: 25, y: 13, w: 15, h: 13, name: 'Town Square', agent: 'hub' },
    port:      { x: 6, y: 26, w: 19, h: 14, name: 'River Port Bazaar', agent: 'hustle-engine' },
    mine:      { x: 40, y: 25, w: 24, h: 15, name: 'Copperpot Mine', agent: 'ledger-fi' },
    savings:   { x: 25, y: 27, w: 15, h: 13, name: 'Savings Row', agent: 'ledger-fi' },
    meadow:    { x: 40, y: 16, w: 24, h: 9, name: 'East Meadow', agent: null },
    riverside: { x: 6, y: 15, w: 19, h: 11, name: 'Riverside', agent: null },
    north:     { x: 26, y: 0, w: 14, h: 13, name: 'School Hill', agent: 'academic-core' },
  };
  S.BIOMES = ['monastery', 'market', 'port', 'mine']; // the four agent biomes

  /** West bank of the river: tiles with x < riverEdge(y) are water. */
  S.riverEdge = function (ty) {
    const base = 4 + Math.round(Math.sin(ty * 0.35) * 0.8 + Math.sin(ty * 0.11 + 1) * 0.6);
    if (ty >= 29) return base + Math.min(6, ty - 28); // harbour bay by the port
    return base;
  };
  S.isWater = (tx, ty) => tx < S.riverEdge(ty);

  /** Which region a tile belongs to (water returns 'river'). */
  S.biomeAt = function (tx, ty) {
    if (S.isWater(tx, ty)) return 'river';
    for (const id of ['square', 'monastery', 'market', 'port', 'mine', 'savings', 'north', 'riverside', 'meadow']) {
      const r = S.regions[id];
      if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return id;
    }
    return 'meadow';
  };

  /** Landmark anchor points (tile coords, the spot in front of the door). */
  S.landmarks = {
    clockTower:     { x: 32, y: 16, region: 'square', label: 'Clock Tower' },
    fountain:       { x: 32, y: 21, region: 'square', label: 'Fountain' },
    questBoard:     { x: 28, y: 19, region: 'square', label: 'Quest Board' },
    mailPost:       { x: 36, y: 19, region: 'square', label: 'Mail Post' },
    temple:         { x: 15, y: 6, region: 'monastery', label: 'Monastery Temple' },
    studyGarden:    { x: 21, y: 10, region: 'monastery', label: 'Study Garden' },
    school:         { x: 29, y: 6, region: 'north', label: 'School' },
    broadcastTower: { x: 58, y: 5, region: 'market', label: 'Broadcast Tower' },
    angiesStall:    { x: 46, y: 9, region: 'market', label: "Angie's stall" },
    fidgetStall:    { x: 52, y: 12, region: 'market', label: 'Fidget store promo stall' },
    billboard:      { x: 51, y: 3, region: 'market', label: 'Billboard' },
    bazaar:         { x: 15, y: 32, region: 'port', label: 'Bazaar' },
    dock:           { x: 9, y: 34, region: 'port', label: 'Dock' },
    warehouse:      { x: 20, y: 36, region: 'port', label: 'Warehouse' },
    mineEntrance:   { x: 56, y: 28, region: 'mine', label: 'Mine Entrance' },
    vault:          { x: 48, y: 35, region: 'mine', label: 'Vault' },
    inn:            { x: 10, y: 19, region: 'riverside', label: 'Hudson House Inn' },
    apartment:      { x: 28, y: 33, region: 'savings', label: 'Apartment (Apartment fund)' },
    garage:         { x: 32, y: 36, region: 'savings', label: 'Garage (Car insurance)' },
    investTree:     { x: 37, y: 32, region: 'savings', label: 'Investment tree (Invest)' },
  };

  /** Navigation graph. Nodes are tile coords; edges are orthogonal polylines
   * (tile points) that the terrain draws as roads and villagers walk along. */
  S.nav = {
    nodes: {
      SQ: [32, 20], SQN: [32, 15], SQW: [26, 20], SQE: [38, 20], SQS: [32, 25],
      JW: [20, 20], JN: [32, 11], JE: [45, 20], JS: [32, 29],
      MON: [15, 9], SCHOOL: [29, 7], INN: [10, 20],
      MKT: [51, 10], PORT: [15, 31], DOCK: [9, 33],
      MINE: [52, 31], MINEDOOR: [56, 29],
      APT: [28, 31], GAR: [32, 34], TREE: [37, 31],
      QUEST: [28, 20], MAIL: [36, 20], TOWER: [32, 17],
    },
    edges: [
      ['SQ', 'SQN', [[32, 20], [32, 15]]],
      ['SQ', 'SQW', [[32, 20], [26, 20]]],
      ['SQ', 'SQE', [[32, 20], [38, 20]]],
      ['SQ', 'SQS', [[32, 20], [32, 25]]],
      ['SQ', 'QUEST', [[32, 20], [28, 20]]],
      ['SQ', 'MAIL', [[32, 20], [36, 20]]],
      ['SQN', 'TOWER', [[32, 15], [32, 17]]],
      ['SQN', 'JN', [[32, 15], [32, 11]]],
      ['JN', 'SCHOOL', [[32, 11], [29, 11], [29, 7]]],
      ['SQW', 'JW', [[26, 20], [20, 20]]],
      ['JW', 'MON', [[20, 20], [20, 13], [15, 13], [15, 9]]],
      ['JW', 'INN', [[20, 20], [10, 20]]],
      ['JW', 'PORT', [[20, 20], [20, 27], [15, 27], [15, 31]]],
      ['PORT', 'DOCK', [[15, 31], [15, 33], [9, 33]]],
      ['SQE', 'JE', [[38, 20], [45, 20]]],
      ['JE', 'MKT', [[45, 20], [45, 14], [51, 14], [51, 10]]],
      ['JE', 'MINE', [[45, 20], [45, 31], [52, 31]]],
      ['MINE', 'MINEDOOR', [[52, 31], [56, 31], [56, 29]]],
      ['SQS', 'JS', [[32, 25], [32, 29]]],
      ['JS', 'APT', [[32, 29], [28, 29], [28, 31]]],
      ['JS', 'GAR', [[32, 29], [32, 34]]],
      ['JS', 'TREE', [[32, 29], [37, 29], [37, 31]]],
    ],
    /** Minecart rails from the mine yard to the square (drawn by the mine module). */
    rails: [[52, 32], [46, 32], [46, 23], [39, 23]],
    /** River lane boats sail along (tile x, from north to south). */
    riverLaneX: 2,
  };

  /** Shortest path between two nav nodes as a list of tile points. */
  S.route = function (from, to) {
    if (from === to) return [S.nav.nodes[from].slice()];
    const adj = {};
    for (const [a, b, pts] of S.nav.edges) {
      (adj[a] = adj[a] || []).push([b, pts]);
      (adj[b] = adj[b] || []).push([a, pts.slice().reverse()]);
    }
    const prev = { [from]: null }, queue = [from];
    while (queue.length) {
      const n = queue.shift();
      if (n === to) break;
      for (const [m, pts] of adj[n] || []) if (!(m in prev)) { prev[m] = [n, pts]; queue.push(m); }
    }
    if (!(to in prev)) return [S.nav.nodes[from].slice()];
    const chain = [];
    for (let n = to; prev[n]; n = prev[n][0]) chain.unshift(prev[n][1]);
    const out = [];
    for (const pts of chain) for (const p of pts) {
      const last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p.slice());
    }
    return out;
  };

  /** Tiles that buildings and props occupy. Modules call S.reserve() at load
   * time for everything solid they draw; scattered decor (trees, rocks,
   * flowers) checks S.isFree() so it never lands on someone else's building. */
  const reserved = new Uint8Array(COLS * ROWS);
  S.reserve = (tx, ty, w = 1, h = 1) => {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++)
      if (x >= 0 && y >= 0 && x < COLS && y < ROWS) reserved[y * COLS + x] = 1;
  };
  /** True if a tile is on a road (any nav edge, 2 tiles wide: the line tile and the one right/below it). */
  const roadTiles = new Uint8Array(COLS * ROWS);
  S.onRoad = (tx, ty) => tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS && roadTiles[ty * COLS + tx] === 1;
  S.isReserved = (tx, ty) => tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS || reserved[ty * COLS + tx] === 1;
  S.isFree = (tx, ty) => !S.isReserved(tx, ty) && !S.onRoad(tx, ty) && !S.isWater(tx, ty);

  // Mark road tiles: every nav edge segment, 2 tiles wide.
  for (const [, , pts] of S.nav.edges) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const tx = x + dx, ty = y + dy;
            if (tx < COLS && ty < ROWS) roadTiles[ty * COLS + tx] = 1;
          }
    }
  }


  S.tileToPx = (tx, ty) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
  S.regionCenterPx = (id) => { const r = S.regions[id]; return { x: (r.x + r.w / 2) * TILE, y: (r.y + r.h / 2) * TILE }; };

  /* ------------------------------------------------------------- agents */

  const AGENTS = {
    'academic-core': { biome: 'monastery', character: 'Abbot Quill', home: 'MON', item: 'scroll', courier: 'bird' },
    'ledger-fi':     { biome: 'mine', character: 'Grit Copperpot', home: 'MINE', item: 'coins', courier: 'cart' },
    'social-ops':    { biome: 'market', character: 'Lumi', home: 'MKT', item: 'poster', courier: 'lantern' },
    'hustle-engine': { biome: 'port', character: "Cap'n Twirl", home: 'PORT', item: 'crate', courier: 'boat' },
    hub:             { biome: 'square', character: 'Mayor Tock', home: 'TOWER', item: 'bell', courier: null },
  };
  S.AGENTS = AGENTS;
  S.agentForBiome = (biome) => Object.keys(AGENTS).find((a) => AGENTS[a].biome === biome) || null;
  S.thread = (agent) => (S.data.threads || []).find((t) => t.id === agent) || null;
  S.metrics = (agent) => (S.data.agents || {})[agent] || {};

  /* --------------------------------------------------------------- status
   * level: 'ok' | 'idle' | 'warn' | 'critical' — drives weather.
   * growth: 0..3 — drives how built-up each biome looks.
   */
  function computeStatus() {
    const out = {};
    const alerts = S.data.alerts || [];
    for (const biome of S.BIOMES) {
      const agent = S.agentForBiome(biome);
      const th = S.thread(agent) || {};
      const label = th.label;
      const mine = alerts.filter((a) => a.agent === label || a.agent === agent);
      let level = 'ok';
      if (!th.phase || th.phase === 'uninit') level = 'idle';
      if (th.phase === 'error' || mine.some((a) => a.level === 'warn')) level = 'warn';
      if (mine.some((a) => a.level === 'critical')) level = 'critical';
      const w = (S.metrics(agent).world || {});
      let growth = typeof w.growth === 'number' ? w.growth : 0;
      if (DEBUG.status && DEBUG.status[biome]) level = DEBUG.status[biome];
      if (DEBUG.growth && typeof DEBUG.growth[biome] === 'number') growth = DEBUG.growth[biome];
      out[biome] = { level, growth: Math.max(0, Math.min(3, growth | 0)), alerts: mine };
    }
    return out;
  }
  S.status = computeStatus();

  /* ----------------------------------------------------------------- time
   * Real New York time drives the sky; SHACK_DEBUG.now overrides it.
   */
  const TZ = 'America/New_York';
  const tzFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
  });
  const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // Approximate sunrise / sunset in local clock hours for Cold Spring, NY (41.4°N), by month.
  const SUN = [[7.25, 16.85], [6.85, 17.45], [7.1, 19.0], [6.35, 19.6], [5.75, 20.1], [5.42, 20.5],
               [5.6, 20.5], [6.1, 20.0], [6.6, 19.15], [7.1, 18.35], [6.7, 16.75], [7.15, 16.5]];
  const bootReal = Date.now();
  const debugStart = DEBUG.now ? new Date(DEBUG.now).getTime() : null;

  S.now = () => (debugStart !== null ? new Date(debugStart + (DEBUG.freezeClock ? 0 : Date.now() - bootReal)) : new Date());

  /** Parts of a Date in New York time. */
  S.nyParts = function (d) {
    const p = {};
    for (const { type, value } of tzFmt.formatToParts(d)) p[type] = value;
    const hour = (+p.hour) % 24;
    return { year: +p.year, month: +p.month, day: +p.day, hour, minute: +p.minute, second: +p.second, dow: DOW[p.weekday] };
  };

  function seasonFor(month) {
    if (month === 12 || month <= 2) return 'winter';
    if (month <= 5) return 'spring';
    if (month <= 8) return 'summer';
    return 'autumn';
  }

  /** Recomputed every frame. */
  S.time = {};
  function updateTime() {
    const d = S.now();
    const p = S.nyParts(d);
    const h = p.hour + p.minute / 60 + p.second / 3600;
    const [rise, set] = SUN[p.month - 1];
    const tw = 0.75; // twilight length in hours
    let light;
    if (h < rise - tw || h > set + tw) light = 0;
    else if (h < rise + tw) light = (h - (rise - tw)) / (2 * tw);
    else if (h > set - tw) light = 1 - (h - (set - tw)) / (2 * tw);
    else light = 1;
    light = Math.max(0, Math.min(1, light));
    Object.assign(S.time, {
      date: d, ny: p, hours: h, sunrise: rise, sunset: set,
      light,                                   // 1 = full day, 0 = night
      isNight: light < 0.35,
      isDusk: h > set - tw && h < set + tw,
      isDawn: h > rise - tw && h < rise + tw,
      season: DEBUG.season || seasonFor(p.month),
      isFriday: p.dow === 5,
      isPayday: p.dow === 5,
    });
  }
  updateTime();

  /* --------------------------------------------------------------- cycles
   * The Director runs at the config's cycle times. The ceremony plays from
   * 90 s before a cycle to 4 min after it, or on demand via S.startCeremony().
   */
  function cycleDates() {
    const cycles = S.data.cycles || [];
    const now = S.time.date, p = S.time.ny;
    const out = [];
    for (let dd = -1; dd <= 1; dd++) for (const c of cycles) {
      const [hh, mm] = c.local_time.split(':').map(Number);
      // Build the instant for New York local hh:mm on day p.day+dd.
      const minutesFromNow = ((dd * 24 + hh - p.hour) * 60 + (mm - p.minute)) - p.second / 60;
      out.push({ name: c.name, focus: c.focus, at: new Date(now.getTime() + minutesFromNow * 60000) });
    }
    return out.sort((a, b) => a.at - b.at);
  }
  S.cycle = { next: null, last: null, ceremony: null };
  let manualCeremony = DEBUG.ceremony ? 0 : null; // ms since manual start
  S.startCeremony = function () { manualCeremony = 0; S.emit('ceremony:start', { manual: true }); };
  const CEREMONY_BEFORE = 90e3, CEREMONY_AFTER = 240e3, CEREMONY_MANUAL = 75e3;
  function updateCycle(dt) {
    const list = cycleDates(), now = S.time.date.getTime();
    S.cycle.next = list.find((c) => c.at.getTime() > now) || null;
    S.cycle.last = list.filter((c) => c.at.getTime() <= now).pop() || null;
    let phase = null, progress = 0;
    if (manualCeremony !== null) {
      manualCeremony += dt * 1000;
      progress = manualCeremony / CEREMONY_MANUAL;
      if (progress >= 1) { manualCeremony = null; S.emit('ceremony:end', { manual: true }); }
      else phase = 'manual';
    } else {
      for (const c of list) {
        const d = now - c.at.getTime();
        if (d > -CEREMONY_BEFORE && d < CEREMONY_AFTER) { phase = c.name; progress = (d + CEREMONY_BEFORE) / (CEREMONY_BEFORE + CEREMONY_AFTER); }
      }
    }
    const was = S.cycle.ceremony;
    S.cycle.ceremony = phase ? { name: phase, progress } : null;
    if (!was && phase && phase !== 'manual') S.emit('ceremony:start', { manual: false, name: phase });
    if (was && !phase && was.name !== 'manual') S.emit('ceremony:end', { manual: false });
  }
  /* Ceremony beats as fractions of progress, so every module agrees:
   *   0.00–0.15 bell rings   0.15–0.45 villagers walk to the square
   *   0.45–0.70 gathered, reports handed over   0.70–1.00 head back out. */
  S.CEREMONY_BEATS = { bell: [0, 0.15], gather: [0.15, 0.45], council: [0.45, 0.7], disperse: [0.7, 1] };

  /* ------------------------------------------------------------- events */
  const listeners = {};
  S.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  S.emit = (ev, payload) => { for (const fn of listeners[ev] || []) { try { fn(payload); } catch (e) { console.error(e); } } };

  /* ---------------------------------------------------------------- rng */
  S.rng = function (seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  /** Deterministic hash noise for a tile, 0..1. */
  S.hash = (x, y, s = 0) => {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  /* -------------------------------------------------------- pixel helpers */
  const px = (S.px = {});
  px.rect = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  px.dot = (ctx, x, y, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), 1, 1); };
  px.line = (ctx, x0, y0, x1, y1, c) => {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    ctx.fillStyle = c;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      ctx.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  px.circle = (ctx, cx, cy, r, c) => {
    ctx.fillStyle = c;
    for (let y = -r; y <= r; y++) {
      const w = Math.floor(Math.sqrt(r * r - y * y + r * 0.8));
      ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
    }
  };
  /** Checkerboard dither of colour c over a rect (density 0.5). */
  px.dither = (ctx, x, y, w, h, c, phase = 0) => {
    ctx.fillStyle = c;
    for (let j = 0; j < h; j++) for (let i = (j + phase) & 1; i < w; i += 2) ctx.fillRect(x + i, y + j, 1, 1);
  };
  /** Draw a sprite given as rows of characters; palette maps char -> colour; '.' or ' ' = transparent. */
  px.sprite = (ctx, rows, x, y, palette, flip = false) => {
    x = Math.round(x); y = Math.round(y);
    const w = rows[0].length;
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.' || ch === ' ') continue;
        const c = palette[ch];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x + (flip ? w - 1 - i : i), y + j, 1, 1);
      }
    }
  };

  /* --------------------------------------------------------------- colour */
  const hexToRgb = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  S.color = {
    hexToRgb, rgbToHex,
    mix: (a, b, t) => { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); },
    shade: (c, amt) => { const A = hexToRgb(c); const t = amt < 0 ? 0 : 255, p = Math.abs(amt); return rgbToHex(A[0] + (t - A[0]) * p, A[1] + (t - A[1]) * p, A[2] + (t - A[2]) * p); },
    rgba: (c, a) => { const A = hexToRgb(c); return `rgba(${A[0]},${A[1]},${A[2]},${a})`; },
  };

  /** Shared 16-bit palette. Biome modules may add their own, but use these
   * for anything that crosses biomes (roads, water, outlines, people). */
  S.PAL = {
    outline: '#1d1a24', ink: '#2b2633', shadow: 'rgba(20,16,30,0.28)',
    water: '#3f7fb0', waterDeep: '#2f6290', waterLight: '#6fb2d6', foam: '#d8eef5',
    dirt: '#a5784a', dirtDark: '#86603a', dirtLight: '#c09466',
    cobble: '#9a9590', cobbleDark: '#77726f', cobbleLight: '#bdb7ae',
    plank: '#9b6b3d', plankDark: '#74502c',
    grass: { spring: '#6fae4a', summer: '#5d9c3e', autumn: '#8f9a45', winter: '#dfe8ee' },
    grassDark: { spring: '#548e37', summer: '#467d2e', autumn: '#6f7a35', winter: '#c3d1da' },
    leaf: { spring: '#7cc35a', summer: '#4f8f33', autumn: '#d4782f', winter: '#7e8f86' },
    leafAlt: { spring: '#f2a7c3', summer: '#3f7a2a', autumn: '#e0a93a', winter: '#5f726a' },
    skin: ['#f2c9a0', '#d9a273', '#a86f4b', '#6e4630'],
    gold: '#f2c94c', goldDark: '#c4952b', neonPink: '#ff4fa3', neonCyan: '#3ef0ff', neonViolet: '#9b6bff',
    lantern: '#ffb84d', lanternGlow: '#ffd27a', snow: '#f4f8fb',
  };

  /* --------------------------------------------------------------- layers
   * Static layers are drawn once into a cached background (call
   * S.invalidateStatic() if something they depend on changes).
   * Dynamic layers draw every frame, in ascending order:
   *   100 water & ground animation   200 decor under people
   *   300 ENTITIES (y-sorted by the core)   400 things above people (birds, canopies)
   *   500 weather   600 lighting/darkness   700 glow effects over the dark (fireworks, neon)
   *   800 in-canvas markers
   */
  const statics = [], dynamics = [], entities = [];
  S.registerStatic = (order, fn) => { statics.push({ order, fn }); statics.sort((a, b) => a.order - b.order); staticDirty = true; };
  S.registerDynamic = (order, fn) => { dynamics.push({ order, fn }); dynamics.sort((a, b) => a.order - b.order); };
  /** Entity: {x, y (native px at the feet), update?(dt,t), draw(ctx,t), hidden?} */
  S.addEntity = (e) => { entities.push(e); return e; };
  S.removeEntity = (e) => { const i = entities.indexOf(e); if (i >= 0) entities.splice(i, 1); };
  S.entities = entities;
  let staticDirty = true;
  S.invalidateStatic = () => { staticDirty = true; };

  /** Light sources for the night overlay: {x, y, r, color, intensity 0..1, flicker?, nightOnly? (default true), on?() } */
  S.lights = [];
  S.addLight = (l) => { S.lights.push(Object.assign({ intensity: 1, nightOnly: true }, l)); return l; };

  /* -------------------------------------------------------------- hotspots
   * Clickable world areas: {id, kind:'biome'|'villager'|'landmark', label,
   * x,y,w,h (native px) or rect(): {x,y,w,h}, biome?, agent?, priority?}.
   * Clicks call S.ui.open(hotspot). Hover shows the label as a tooltip.
   */
  const hotspots = [];
  S.addHotspot = (h) => { hotspots.push(Object.assign({ priority: 0 }, h)); return h; };
  S.hotspots = hotspots;
  function hitTest(wx, wy) {
    let best = null;
    for (const h of hotspots) {
      const r = h.rect ? h.rect() : h;
      if (!r) continue;
      if (wx >= r.x && wx < r.x + r.w && wy >= r.y && wy < r.y + r.h) {
        if (!best || (h.priority || 0) > (best.priority || 0)) best = h;
      }
    }
    if (best) return best;
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    const b = S.biomeAt(tx, ty);
    if (S.BIOMES.includes(b) || b === 'square' || b === 'savings' || b === 'north') {
      const reg = S.regions[b];
      return { id: 'biome:' + b, kind: 'biome', biome: b, label: reg.name, agent: reg.agent };
    }
    return null;
  }
  S.hitTest = hitTest;

  /* UI hooks — replaced by the UI module. */
  S.ui = { open: (h) => console.log('open', h), hudUpdate: () => {} };
  /* Audio hooks — replaced by the audio module. */
  S.audio = { sfx: () => {}, setBiome: () => {}, enabled: false };

  /* --------------------------------------------------------------- canvas */
  const canvas = document.getElementById('world');
  const screen = canvas.getContext('2d');
  const buffer = document.createElement('canvas'); buffer.width = W; buffer.height = H;
  const ctx = buffer.getContext('2d');
  const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
  const bgx = bg.getContext('2d');
  S.canvas = canvas; S.buffer = buffer; S.ctx = ctx;

  /* --------------------------------------------------------------- camera
   * cam.x/cam.y: world px at the centre of the view. cam.z: screen px per native px.
   */
  const cam = (S.cam = { x: W / 2, y: H / 2, z: 1, minZ: 0.5, maxZ: 5, fitZ: 1, follow: null });
  let viewW = 0, viewH = 0, dpr = 1;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    viewW = canvas.clientWidth; viewH = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(viewW * dpr));
    canvas.height = Math.max(1, Math.round(viewH * dpr));
    const fit = Math.min(viewW / W, viewH / H);
    cam.fitZ = fit; cam.minZ = Math.min(fit, 1) * 0.9;
    if (!S._camInit) { S._camInit = true; cam.z = DEBUG.zoom || Math.max(fit, Math.min(1.25, viewW < 700 ? 1 : fit)); if (DEBUG.center) { cam.x = DEBUG.center[0] * TILE; cam.y = DEBUG.center[1] * TILE; } }
    clampCam();
  }
  function clampCam() {
    cam.z = Math.max(cam.minZ, Math.min(cam.maxZ, cam.z));
    const hw = viewW / cam.z / 2, hh = viewH / cam.z / 2;
    cam.x = hw * 2 >= W ? W / 2 : Math.max(hw, Math.min(W - hw, cam.x));
    cam.y = hh * 2 >= H ? H / 2 : Math.max(hh, Math.min(H - hh, cam.y));
  }
  S.screenToWorld = (sx, sy) => ({ x: cam.x + (sx - viewW / 2) / cam.z, y: cam.y + (sy - viewH / 2) / cam.z });
  S.worldToScreen = (wx, wy) => ({ x: (wx - cam.x) * cam.z + viewW / 2, y: (wy - cam.y) * cam.z + viewH / 2 });
  S.zoomTo = (z, sx = viewW / 2, sy = viewH / 2) => {
    const before = S.screenToWorld(sx, sy);
    cam.z = z; clampCam();
    const after = S.screenToWorld(sx, sy);
    cam.x += before.x - after.x; cam.y += before.y - after.y; clampCam();
  };
  S.zoomBy = (f, sx, sy) => S.zoomTo(cam.z * f, sx, sy);
  S.fitView = () => { cam.z = cam.fitZ; cam.x = W / 2; cam.y = H / 2; cam.follow = null; clampCam(); };
  /** Smoothly centre on a world point (and optionally zoom). */
  let panAnim = null;
  S.panTo = (wx, wy, z) => { panAnim = { x: wx, y: wy, z: z || cam.z, t: 0 }; cam.follow = null; };
  S.focusRegion = (id) => { const c = S.regionCenterPx(id); const r = S.regions[id]; const z = Math.min(viewW / ((r.w + 6) * TILE), viewH / ((r.h + 6) * TILE)); S.panTo(c.x, c.y, Math.max(cam.fitZ, Math.min(4, z))); };

  /* ---------------------------------------------------------------- input */
  let drag = null, moved = false;
  const pointers = new Map();
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pointers.size === 1) { drag = { x: e.offsetX, y: e.offsetY, cx: cam.x, cy: cam.y }; moved = false; }
    else drag = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    const prevP = pointers.get(e.pointerId);
    if (pointers.size === 2 && prevP) {
      const [a, b] = [...pointers.values()];
      const d0 = Math.hypot(a.x - b.x, a.y - b.y);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      const [c, d] = [...pointers.values()];
      const d1 = Math.hypot(c.x - d.x, c.y - d.y);
      if (d0 > 0) S.zoomBy(d1 / d0, (c.x + d.x) / 2, (c.y + d.y) / 2);
      moved = true; return;
    }
    if (prevP) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (drag) {
      const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      if (moved) { cam.x = drag.cx - dx / cam.z; cam.y = drag.cy - dy / cam.z; cam.follow = null; panAnim = null; clampCam(); }
    } else {
      const w = S.screenToWorld(e.offsetX, e.offsetY);
      const h = hitTest(w.x, w.y);
      canvas.style.cursor = h ? 'pointer' : 'grab';
      showTooltip(h, e.offsetX, e.offsetY);
    }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (drag && !moved && e.type === 'pointerup') {
      const w = S.screenToWorld(e.offsetX, e.offsetY);
      const h = hitTest(w.x, w.y);
      if (h) { S.audio.sfx('click'); S.ui.open(h); }
    }
    if (pointers.size === 0) drag = null;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => showTooltip(null));
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); S.zoomBy(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    const step = 40 / cam.z;
    if (e.key === '+' || e.key === '=') S.zoomBy(1.25);
    else if (e.key === '-' || e.key === '_') S.zoomBy(0.8);
    else if (e.key === '0') S.fitView();
    else if (e.key === 'ArrowLeft') { cam.x -= step; clampCam(); }
    else if (e.key === 'ArrowRight') { cam.x += step; clampCam(); }
    else if (e.key === 'ArrowUp') { cam.y -= step; clampCam(); }
    else if (e.key === 'ArrowDown') { cam.y += step; clampCam(); }
    else return;
    e.preventDefault();
  });

  /* ------------------------------------------------------- DOM overlays
   * Speech bubbles and the hover tooltip live in #overlay, positioned over
   * the canvas every frame.
   */
  const overlay = document.getElementById('overlay');
  const tooltip = document.getElementById('tooltip');
  function showTooltip(h, sx, sy) {
    if (!tooltip) return;
    if (!h || !h.label) { tooltip.hidden = true; return; }
    tooltip.textContent = h.label;
    tooltip.hidden = false;
    tooltip.style.transform = `translate(${Math.round(sx + 14)}px, ${Math.round(sy + 12)}px)`;
  }
  const bubbles = [];
  /**
   * Show a speech bubble above a world point or entity for `ms`.
   * anchor: entity ({x,y}) or {x,y} in native px. opts: {ms, tone:'info'|'warn'|'critical'|'quiet', biome, dy}
   */
  S.bubble = function (anchor, text, opts = {}) {
    if (!overlay) return null;
    const el = document.createElement('div');
    el.className = 'bubble' + (opts.tone ? ' bubble--' + opts.tone : '') + (opts.biome ? ' bubble--' + opts.biome : '');
    el.textContent = text;
    overlay.appendChild(el);
    const b = { el, anchor, born: performance.now(), ms: opts.ms || 4200, dy: opts.dy == null ? 26 : opts.dy };
    bubbles.push(b);
    return b;
  };
  function updateBubbles() {
    const now = performance.now();
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      const age = now - b.born;
      if (age > b.ms || (b.anchor && b.anchor.removed)) { b.el.remove(); bubbles.splice(i, 1); continue; }
      const p = S.worldToScreen(b.anchor.x, b.anchor.y - b.dy);
      const off = p.x < -60 || p.y < -40 || p.x > viewW + 60 || p.y > viewH + 40;
      b.el.hidden = off;
      if (!off) {
        const fade = Math.min(1, age / 180, (b.ms - age) / 300);
        b.el.style.opacity = fade.toFixed(2);
        b.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
      }
    }
  }

  /* ---------------------------------------------------------------- loop */
  let last = performance.now(), acc = 0, t = 0, booted = false;
  const FRAME = 1000 / 30;
  S.frame = 0;

  function drawStatic() {
    bgx.clearRect(0, 0, W, H);
    for (const s of statics) {
      bgx.save();
      try { s.fn(bgx, S); } catch (e) { console.error('static layer', s.order, e); }
      bgx.restore();
    }
    staticDirty = false;
  }

  function render(dt) {
    if (staticDirty) drawStatic();
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0);
    let entitiesDrawn = false;
    const drawEntities = () => {
      entities.sort((a, b) => a.y - b.y);
      for (const e of entities) {
        if (e.hidden) continue;
        ctx.save();
        try { e.draw(ctx, t); } catch (err) { console.error('entity draw', err); e.hidden = true; }
        ctx.restore();
      }
      entitiesDrawn = true;
    };
    for (const d of dynamics) {
      if (!entitiesDrawn && d.order >= 300) drawEntities();
      ctx.save();
      try { d.fn(ctx, t, dt); } catch (e) { console.error('dynamic layer', d.order, e); }
      ctx.restore();
    }
    if (!entitiesDrawn) drawEntities();

    // Blit to screen.
    screen.setTransform(1, 0, 0, 1, 0, 0);
    screen.imageSmoothingEnabled = false;
    screen.fillStyle = '#0d0b14';
    screen.fillRect(0, 0, canvas.width, canvas.height);
    const z = cam.z * dpr;
    const sx = (viewW / 2 - cam.x * cam.z) * dpr, sy = (viewH / 2 - cam.y * cam.z) * dpr;
    screen.drawImage(buffer, 0, 0, W, H, Math.round(sx), Math.round(sy), Math.round(W * z), Math.round(H * z));
  }

  function step(now) {
    requestAnimationFrame(step);
    if (document.hidden) { last = now; return; }
    const elapsed = now - last;
    if (elapsed < FRAME - 2 && !S.debug.everyFrame) return;
    last = now;
    const dt = Math.min(0.1, elapsed / 1000);
    if (!S.debug.paused) t += dt;
    S.t = t; S.frame++;
    updateTime();
    updateCycle(dt);
    if (panAnim) {
      panAnim.t = Math.min(1, panAnim.t + dt * 2.2);
      const k = 1 - Math.pow(1 - panAnim.t, 3);
      cam.x += (panAnim.x - cam.x) * k; cam.y += (panAnim.y - cam.y) * k; cam.z += (panAnim.z - cam.z) * k;
      clampCam();
      if (panAnim.t >= 1) panAnim = null;
    } else if (cam.follow && !cam.follow.removed) { cam.x += (cam.follow.x - cam.x) * 0.08; cam.y += (cam.follow.y - cam.y) * 0.08; clampCam(); }
    if (!S.debug.paused) for (const e of entities) { if (e.update) { try { e.update(dt, t); } catch (err) { console.error('entity update', err); e.update = null; } } }
    render(dt);
    updateBubbles();
    if (S.frame % 15 === 0) { try { S.ui.hudUpdate(); } catch (e) { console.error(e); } }
  }

  /** Called once after every module has loaded (the last <script> line). */
  S.boot = function () {
    if (booted) return; booted = true;
    resize();
    window.addEventListener('resize', resize);
    S.emit('boot');
    S.emit('ready');
    requestAnimationFrame(step);
  };
})();
