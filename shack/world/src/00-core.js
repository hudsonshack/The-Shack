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

  const TILE = 16, COLS = 80, ROWS = 50;
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

  /* ----------------------------------------------------------- the islands
   * The world is five floating islands in starry space. Each island has a
   * walkable top (a tile rect; the islands module draws its organic edge
   * inside it) and a rocky underside `depth` tiles tall below its south edge.
   * Island ids keep the agent-biome names; display names come from here.
   * Hub-and-spoke: every biome island connects only to Clockspire (square).
   */
  S.islands = {
    square:    { x: 30, y: 15, w: 20, h: 17, depth: 6, name: 'Clockspire',       agent: 'hub',           bob: { amp: 2, period: 7.0, phase: 0.0 } },
    monastery: { x: 3,  y: 2,  w: 23, h: 16, depth: 6, name: 'Lantern Peak',     agent: 'academic-core', bob: { amp: 2, period: 6.1, phase: 1.3 } },
    market:    { x: 54, y: 2,  w: 23, h: 16, depth: 6, name: 'Neon Hollow',      agent: 'social-ops',    bob: { amp: 2, period: 6.6, phase: 2.6 } },
    port:      { x: 3,  y: 29, w: 23, h: 15, depth: 5, name: 'Spindrift Harbor', agent: 'hustle-engine', bob: { amp: 2, period: 5.7, phase: 3.9 } },
    mine:      { x: 54, y: 29, w: 23, h: 15, depth: 5, name: 'Copperhold',       agent: 'ledger-fi',     bob: { amp: 2, period: 6.3, phase: 5.1 } },
  };
  S.ISLANDS = ['square', 'monastery', 'market', 'port', 'mine'];
  S.BIOMES = ['monastery', 'market', 'port', 'mine']; // the four agent islands
  S.regions = S.islands;                              // old name, same objects

  /** Island id whose walkable top contains tile (tx, ty), or null (space). */
  S.islandAt = function (tx, ty) {
    for (const id of S.ISLANDS) {
      const r = S.islands[id];
      if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return id;
    }
    return null;
  };
  S.biomeAt = (tx, ty) => S.islandAt(tx, ty) || 'void';
  S.isVoid = (tx, ty) => !S.islandAt(tx, ty);
  S.isWater = () => false; // water belongs to the island modules now (rivers, waterfalls)

  /** Pixel box an island's static art is cut into (room for roofs above, underside below). */
  S.islandBox = function (id) {
    const r = S.islands[id];
    const x0 = Math.max(0, (r.x - 2) * TILE), y0 = Math.max(0, (r.y - 3) * TILE);
    const x1 = Math.min(W, (r.x + r.w + 2) * TILE), y1 = Math.min(H, (r.y + r.h + r.depth + 1) * TILE);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  /** Island whose box contains native pixel (x, y), preferring the one whose top contains it. */
  S.islandAtPx = function (x, y) {
    const top = S.islandAt(Math.floor(x / TILE), Math.floor(y / TILE));
    if (top) return top;
    for (const id of S.ISLANDS) { const b = S.islandBox(id); if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return id; }
    return null;
  };

  /* Bobbing: each island drifts up and down a couple of pixels. */
  const bobs = {};
  for (const id of S.ISLANDS) bobs[id] = 0;
  S.bob = (id) => (id && bobs[id]) || 0;
  /** Vertical offset between two islands at fraction u (0 = a, 1 = b), for things spanning space (rail bridges, ropes). */
  S.bobBetween = (a, b, u) => Math.round(S.bob(a) + (S.bob(b) - S.bob(a)) * u);
  function updateBobs(t) {
    for (const id of S.ISLANDS) {
      const b = S.islands[id].bob;
      bobs[id] = S.reducedMotion || DEBUG.noBob ? 0 : Math.round(Math.sin((t / b.period) * Math.PI * 2 + b.phase) * b.amp);
    }
  }

  /** Landmark anchor points (tile coords). All fictional; real data drives them. */
  S.landmarks = {
    clockTower:     { x: 39, y: 19, island: 'square', label: 'Clock Tower' },
    fountain:       { x: 39, y: 26, island: 'square', label: 'Fountain' },
    questBoard:     { x: 35, y: 22, island: 'square', label: 'Quest Board' },
    mailPost:       { x: 43, y: 22, island: 'square', label: 'Mail Post' },
    chronicle:      { x: 43, y: 28, island: 'square', label: "The Chronicle (Mayor Tock's recaps)" },
    dockNW:         { x: 31, y: 17, island: 'square', label: 'Kite landing (from Lantern Peak)' },
    dockNE:         { x: 48, y: 17, island: 'square', label: 'Blimp mast (from Neon Hollow)' },
    dockSW:         { x: 31, y: 29, island: 'square', label: 'Sky-ship pier (from Spindrift Harbor)' },
    dockSE:         { x: 48, y: 29, island: 'square', label: 'Rail station (from Copperhold)' },
    temple:         { x: 13, y: 7,  island: 'monastery', label: 'Monastery Temple' },
    studyGarden:    { x: 19, y: 13, island: 'monastery', label: 'Study Garden' },
    kitePad:        { x: 23, y: 13, island: 'monastery', label: 'Kite launch' },
    broadcastTower: { x: 73, y: 6,  island: 'market', label: 'Broadcast Tower' },
    angiesStall:    { x: 61, y: 9,  island: 'market', label: "Angie's stall" },
    fidgetStall:    { x: 69, y: 13, island: 'market', label: 'Fidgetly promo stall' },
    billboard:      { x: 66, y: 4,  island: 'market', label: 'Billboard' },
    blimpMast:      { x: 56, y: 13, island: 'market', label: 'Blimp mast' },
    bazaar:         { x: 13, y: 37, island: 'port', label: 'Bazaar' },
    skyDock:        { x: 23, y: 33, island: 'port', label: 'Sky-ship dock' },
    warehouse:      { x: 7,  y: 41, island: 'port', label: 'Warehouse' },
    mineEntrance:   { x: 71, y: 32, island: 'mine', label: 'Mine Entrance' },
    vault:          { x: 64, y: 41, island: 'mine', label: 'Vault' },
    crystalInvest:  { x: 59, y: 39, island: 'mine', label: 'Invest crystal' },
    crystalCar:     { x: 62, y: 39, island: 'mine', label: 'Car insurance crystal' },
    crystalHome:    { x: 65, y: 39, island: 'mine', label: 'Apartment fund crystal' },
    railStation:    { x: 56, y: 33, island: 'mine', label: 'Rail station' },
  };

  /** Navigation graph. Nodes are tile coords. Walk edges are orthogonal
   * polylines drawn as paths (2 tiles wide); transport edges cross space:
   *   kite  Lantern Peak ↔ Clockspire      blimp Neon Hollow ↔ Clockspire
   *   ship  Spindrift Harbor ↔ Clockspire  rail  Copperhold ↔ Clockspire (sky-rail bridge)
   */
  S.nav = {
    nodes: {
      SQ: [39, 23], TOWER: [39, 19], QUEST: [35, 23], MAIL: [43, 23], CHRON: [43, 27],
      D_NW: [31, 17], D_NE: [48, 17], D_SW: [31, 29], D_SE: [48, 29],
      MON: [13, 10], GARDEN: [19, 13], KITE: [23, 13],
      MKT: [65, 10], BLIMP: [56, 13],
      PORT: [14, 36], SHIP: [23, 33],
      MINE: [66, 36], MINEDOOR: [71, 32], STATION: [56, 33],
    },
    island: {
      SQ: 'square', TOWER: 'square', QUEST: 'square', MAIL: 'square', CHRON: 'square', D_NW: 'square', D_NE: 'square', D_SW: 'square', D_SE: 'square',
      MON: 'monastery', GARDEN: 'monastery', KITE: 'monastery', MKT: 'market', BLIMP: 'market',
      PORT: 'port', SHIP: 'port', MINE: 'mine', MINEDOOR: 'mine', STATION: 'mine',
    },
    // [a, b, points, mode]  (mode defaults to 'walk')
    edges: [
      ['SQ', 'TOWER', [[39, 23], [39, 19]]],
      ['SQ', 'QUEST', [[39, 23], [35, 23]]],
      ['SQ', 'MAIL', [[39, 23], [43, 23]]],
      ['MAIL', 'CHRON', [[43, 23], [43, 27]]],
      ['QUEST', 'D_NW', [[35, 23], [33, 23], [33, 17], [31, 17]]],
      ['QUEST', 'D_SW', [[35, 23], [33, 23], [33, 29], [31, 29]]],
      ['MAIL', 'D_NE', [[43, 23], [46, 23], [46, 17], [48, 17]]],
      ['MAIL', 'D_SE', [[43, 23], [46, 23], [46, 29], [48, 29]]],
      ['MON', 'GARDEN', [[13, 10], [13, 13], [19, 13]]],
      ['GARDEN', 'KITE', [[19, 13], [23, 13]]],
      ['MKT', 'BLIMP', [[65, 10], [65, 13], [56, 13]]],
      ['PORT', 'SHIP', [[14, 36], [14, 33], [23, 33]]],
      ['MINE', 'MINEDOOR', [[66, 36], [71, 36], [71, 32]]],
      ['MINE', 'STATION', [[66, 36], [66, 33], [56, 33]]],
      ['KITE', 'D_NW', [[23, 13], [31, 17]], 'kite'],
      ['BLIMP', 'D_NE', [[56, 13], [48, 17]], 'blimp'],
      ['SHIP', 'D_SW', [[23, 33], [31, 29]], 'ship'],
      ['STATION', 'D_SE', [[56, 33], [52, 33], [52, 29], [48, 29]], 'rail'],
    ],
    /** The sky-rail bridge from Copperhold to Clockspire (the mine module draws it). */
    rails: [[56, 33], [52, 33], [52, 29], [48, 29]],
    /** Which transport serves each biome island. */
    transport: { monastery: 'kite', market: 'blimp', port: 'ship', mine: 'rail' },
  };

  /**
   * Route between two nav nodes as legs:
   *   [{mode: 'walk', island, pts: [[tx,ty], ...]}, {mode: 'kite'|'blimp'|'ship'|'rail', from, to, pts}, ...]
   * Consecutive walk edges on the same island merge into one leg.
   */
  S.route = function (from, to) {
    const adj = {};
    for (const [a, b, pts, mode] of S.nav.edges) {
      (adj[a] = adj[a] || []).push([b, pts, mode || 'walk']);
      (adj[b] = adj[b] || []).push([a, pts.slice().reverse(), mode || 'walk']);
    }
    if (from === to) return [{ mode: 'walk', island: S.nav.island[from], pts: [S.nav.nodes[from].slice()] }];
    const prev = { [from]: null }, queue = [from];
    while (queue.length) {
      const n = queue.shift();
      if (n === to) break;
      for (const [m, pts, mode] of adj[n] || []) if (!(m in prev)) { prev[m] = [n, pts, mode]; queue.push(m); }
    }
    if (!(to in prev)) return [{ mode: 'walk', island: S.nav.island[from], pts: [S.nav.nodes[from].slice()] }];
    const chain = [];
    for (let n = to; prev[n]; n = prev[n][0]) chain.unshift({ a: prev[n][0], b: n, pts: prev[n][1], mode: prev[n][2] });
    const legs = [];
    for (const e of chain) {
      const last = legs[legs.length - 1];
      if (e.mode === 'walk' && last && last.mode === 'walk' && last.island === S.nav.island[e.a]) {
        for (const p of e.pts) { const q = last.pts[last.pts.length - 1]; if (q[0] !== p[0] || q[1] !== p[1]) last.pts.push(p.slice()); }
      } else if (e.mode === 'walk') legs.push({ mode: 'walk', island: S.nav.island[e.a], pts: e.pts.map((p) => p.slice()) });
      else legs.push({ mode: e.mode, from: e.a, to: e.b, pts: e.pts.map((p) => p.slice()) });
    }
    return legs;
  };

  /** Tiles that buildings and props occupy. Modules call S.reserve() at load
   * time for everything solid they draw; scattered decor checks S.isFree()
   * so it never lands on someone else's building. */
  const reserved = new Uint8Array(COLS * ROWS);
  S.reserve = (tx, ty, w = 1, h = 1) => {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++)
      if (x >= 0 && y >= 0 && x < COLS && y < ROWS) reserved[y * COLS + x] = 1;
  };
  /** True if a tile is on a walking path (2 tiles wide: the line tile and the one right/below it). */
  const roadTiles = new Uint8Array(COLS * ROWS);
  S.onRoad = (tx, ty) => tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS && roadTiles[ty * COLS + tx] === 1;
  S.isReserved = (tx, ty) => tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS || reserved[ty * COLS + tx] === 1;
  /** Free for decor: on an island top, at least one tile in from its edge, not reserved, not a path. */
  S.isFree = (tx, ty) => {
    const id = S.islandAt(tx, ty);
    if (!id || S.isReserved(tx, ty) || S.onRoad(tx, ty)) return false;
    const r = S.islands[id];
    return tx > r.x && tx < r.x + r.w - 1 && ty > r.y && ty < r.y + r.h - 1;
  };
  for (const [, , pts, mode] of S.nav.edges) {
    if (mode && mode !== 'walk') continue;
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
  S.regionCenterPx = (id) => { const r = S.islands[id]; return { x: (r.x + r.w / 2) * TILE, y: (r.y + r.h / 2) * TILE }; };

  /* ------------------------------------------------------------- agents */

  const AGENTS = {
    'academic-core': { biome: 'monastery', character: 'Abbot Quill', home: 'MON', item: 'scroll', transport: 'kite', color: '#86d0b0' },
    'ledger-fi':     { biome: 'mine', character: 'Grit Copperpot', home: 'MINE', item: 'coins', transport: 'rail', color: '#f2c94c' },
    'social-ops':    { biome: 'market', character: 'Lumi', home: 'MKT', item: 'poster', transport: 'blimp', color: '#ff5fb0' },
    'hustle-engine': { biome: 'port', character: "Cap'n Twirl", home: 'PORT', item: 'crate', transport: 'ship', color: '#63b4e6' },
    hub:             { biome: 'square', character: 'Mayor Tock', home: 'TOWER', item: 'bell', transport: null, color: '#e8b75a' },
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
   * STATIC layers are drawn once (call S.invalidateStatic() if something
   * they depend on changes):
   *   order < 0   space: drawn into the sky canvas (never bobs)
   *   order >= 0  islands: drawn into one full-size canvas, then cut into one
   *               canvas per island (S.islandBox) so each island can bob.
   *               Anything drawn outside every island box is discarded, so
   *               things spanning space (the rail bridge, ropes) belong in a
   *               dynamic layer using S.bobBetween().
   * DYNAMIC layers draw every frame, in ascending order:
   *   < 90 space animation (behind the islands: twinkles, shooting stars, planets)
   *   -- the islands are drawn here, each at its bob offset --
   *   100 water & ground animation   200 decor under people
   *   300 ENTITIES (y-sorted by the core)   400 things above people (birds, flags, smoke)
   *   500 weather   600 lighting/darkness   700 glow over the dark (fireworks, neon)
   *   800 in-canvas markers
   * registerDynamic(order, fn, {island: id}) translates the context by that
   * island's bob before calling fn, so island-bound art bobs with it.
   */
  const statics = [], dynamics = [], entities = [];
  S.registerStatic = (order, fn) => { statics.push({ order, fn }); statics.sort((a, b) => a.order - b.order); staticDirty = true; };
  S.registerDynamic = (order, fn, opts = {}) => { dynamics.push({ order, fn, island: opts.island || null }); dynamics.sort((a, b) => a.order - b.order); };
  /** Entity: {x, y (native px at the feet), island? (bobs with it; null while flying), update?(dt,t), draw(ctx,t), hidden?} */
  S.addEntity = (e) => { entities.push(e); return e; };
  S.removeEntity = (e) => { const i = entities.indexOf(e); if (i >= 0) entities.splice(i, 1); };
  S.entities = entities;
  let staticDirty = true;
  S.invalidateStatic = () => { staticDirty = true; };

  /** Light sources for the night overlay: {x, y, r, color, intensity 0..1, flicker?, nightOnly? (default true), on?(), island?} */
  S.lights = [];
  S.addLight = (l) => { const o = Object.assign({ intensity: 1, nightOnly: true }, l); S.lights.push(o); return o; };

  /* -------------------------------------------------------------- hotspots
   * Clickable world areas: {id, kind:'biome'|'villager'|'landmark', label,
   * x,y,w,h (native px) or rect(): {x,y,w,h}, biome?, agent?, priority?}.
   * Clicks call S.ui.open(hotspot). Hover shows the label as a tooltip.
   */
  const hotspots = [];
  S.addHotspot = (h) => { if (h.priority == null) h.priority = 0; hotspots.push(h); return h; };
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
    const id = S.islandAtPx(wx, wy);
    if (id) {
      const r = S.islands[id];
      return { id: 'biome:' + id, kind: 'biome', biome: id, island: id, label: r.name, agent: r.agent };
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
  const sky = document.createElement('canvas'); sky.width = W; sky.height = H;
  const skyx = sky.getContext('2d');
  /** Per-island static art: [{id, canvas, x, y, w, h}] (filled after the static draw). */
  S.islandLayers = [];
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
    panAnim = null;
    const before = S.screenToWorld(sx, sy);
    cam.z = z; clampCam();
    const after = S.screenToWorld(sx, sy);
    cam.x += before.x - after.x; cam.y += before.y - after.y; clampCam();
  };
  S.zoomBy = (f, sx, sy) => S.zoomTo(cam.z * f, sx, sy);
  S.fitView = () => { panAnim = null; cam.z = cam.fitZ; cam.x = W / 2; cam.y = H / 2; cam.follow = null; clampCam(); };
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
    const b = { el, anchor, born: performance.now(), ms: opts.ms || 4200, dy: opts.dy == null ? 40 : opts.dy };
    bubbles.push(b);
    return b;
  };
  function updateBubbles() {
    const now = performance.now();
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      const age = now - b.born;
      if (age > b.ms || (b.anchor && b.anchor.removed)) { b.el.remove(); bubbles.splice(i, 1); continue; }
      const p = S.worldToScreen(b.anchor.x, b.anchor.y - b.dy + S.bob(b.anchor.island));
      const off = p.x < -60 || p.y < -40 || p.x > viewW + 60 || p.y > viewH + 40;
      b.el.hidden = off;
      if (!off) {
        const fade = Math.min(1, age / 180, (b.ms - age) / 300);
        b.el.style.opacity = fade.toFixed(2);
        b.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
      }
    }
  }

  /**
   * Persistent name tag that follows an anchor (an entity or {x, y, island}).
   * opts: {color, dy (native px above the feet, default 34), className}.
   * Returns {el, setText(text), remove()}. Hidden automatically when the
   * anchor is hidden or zoomed far out.
   */
  const labels = [];
  S.label = function (anchor, text, opts = {}) {
    if (!overlay) return { setText() {}, remove() {} };
    const el = document.createElement('div');
    el.className = 'nametag' + (opts.className ? ' ' + opts.className : '');
    if (opts.color) el.style.setProperty('--tag', opts.color);
    el.textContent = text;
    overlay.appendChild(el);
    const L = { el, anchor, dy: opts.dy == null ? 34 : opts.dy, setText(t) { el.textContent = t; }, remove() { el.remove(); const i = labels.indexOf(L); if (i >= 0) labels.splice(i, 1); } };
    labels.push(L);
    return L;
  };
  function updateLabels() {
    const show = cam.z >= 0.75;
    for (const L of labels) {
      const a = L.anchor;
      if (!show || a.hidden || a.removed || a.hideLabel) { L.el.hidden = true; continue; }
      const p = S.worldToScreen(a.x, a.y - L.dy + S.bob(a.island));
      const off = p.x < -80 || p.y < -40 || p.x > viewW + 80 || p.y > viewH + 40;
      L.el.hidden = off;
      if (!off) L.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
    }
  }

  /* ---------------------------------------------------------------- loop */
  let last = performance.now(), acc = 0, t = 0, booted = false;
  const FRAME = 1000 / 30;
  S.frame = 0;

  function drawStatic() {
    skyx.clearRect(0, 0, W, H);
    bgx.clearRect(0, 0, W, H);
    for (const st of statics) {
      const c = st.order < 0 ? skyx : bgx;
      c.save();
      try { st.fn(c, S); } catch (e) { console.error('static layer', st.order, e); }
      c.restore();
    }
    // Cut the island art into one canvas per island so each can bob on its own.
    S.islandLayers = S.ISLANDS.map((id) => {
      const b = S.islandBox(id);
      const cv = document.createElement('canvas'); cv.width = b.w; cv.height = b.h;
      cv.getContext('2d').drawImage(bg, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
      return { id, canvas: cv, x: b.x, y: b.y, w: b.w, h: b.h };
    });
    staticDirty = false;
    S.emit('static:ready');
  }

  /** Background colour shown beyond the world edge (the sky module may change it). */
  S.spaceColor = '#07060f';

  function render(dt) {
    if (staticDirty) drawStatic();
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(sky, 0, 0);
    let islandsDrawn = false, entitiesDrawn = false;
    const drawIslands = () => {
      for (const L of S.islandLayers) ctx.drawImage(L.canvas, L.x, L.y + S.bob(L.id));
      islandsDrawn = true;
    };
    const drawEntities = () => {
      entities.sort((a, b) => a.y - b.y);
      for (const e of entities) {
        if (e.hidden) continue;
        ctx.save();
        if (e.island) ctx.translate(0, S.bob(e.island));
        try { e.draw(ctx, t); } catch (err) { console.error('entity draw', err); e.hidden = true; }
        ctx.restore();
      }
      entitiesDrawn = true;
    };
    for (const d of dynamics) {
      if (!islandsDrawn && d.order >= 90) drawIslands();
      if (!entitiesDrawn && d.order >= 300) drawEntities();
      ctx.save();
      if (d.island) ctx.translate(0, S.bob(d.island));
      try { d.fn(ctx, t, dt); } catch (e) { console.error('dynamic layer', d.order, e); }
      ctx.restore();
    }
    if (!islandsDrawn) drawIslands();
    if (!entitiesDrawn) drawEntities();

    // Blit to screen.
    screen.setTransform(1, 0, 0, 1, 0, 0);
    screen.imageSmoothingEnabled = false;
    screen.fillStyle = S.spaceColor;
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
    updateBobs(t);
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
    updateLabels();
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
