/* The Shack — world engine core.
 *
 * Every other module in src/ is a plain script that extends the global
 * `SHACK` object defined here. Modules register drawing callbacks, entities,
 * lights and hotspots; the core owns the canvases, camera, clock, layering,
 * input and the DOM overlay for speech bubbles and labels.
 *
 * Coordinates: the world is COLS x ROWS tiles of TILE px (native pixels).
 * All world art is drawn at native resolution into an offscreen buffer whose
 * open space stays transparent. Each frame the visible part of that buffer is
 * upscaled by a whole number k = ceil(zoom * devicePixelRatio) with
 * nearest-neighbour sampling into the "art" canvas, which the compositor then
 * scales by the remaining fraction with bilinear filtering ("sharp
 * bilinear"): every art pixel is the same size and its edges are softened by
 * at most one device pixel. The art canvas sits above #world, which holds the
 * screen-resolution space backdrop (S.registerScreen layers, see below).
 *
 * The camera is fixed: there is no drag, wheel, pinch or key control. It rests
 * at the fit view (the whole world centred in the stage minus S.viewInsets)
 * and only moves when the UI asks it to focus something (S.focusIsland,
 * S.focusRect, S.glideTo, S.follow) or to go back (S.fitView).
 *
 * Public API (beyond the drawing helpers):
 *   S.setViewInsets({top,right,bottom,left})   CSS px kept clear at the fit view (refits)
 *   S.fitView({animate})                       back to the fit view; emits 'camera:fit'
 *   S.focusIsland(id, freeRect?, opts?)        glide so the whole island fills freeRect; emits 'camera:focus'
 *   S.focusRect(worldRect, freeRect?, opts?)   the same for any world rect {x,y,w,h}
 *   S.glideTo(wx, wy, z?, freeRect?, opts?)    put a world point at the centre of freeRect at zoom z
 *   S.follow(entity, freeRect?)                keep an entity at the centre of freeRect
 *   S.isFocused()                              true while the camera is (or is gliding) off the fit view
 *   S.availRect()                              the fit area {x,y,w,h} (stage minus insets), CSS px
 *   S.panTo / S.zoomTo / S.zoomBy / S.focusRegion   older programmatic moves, kept for compatibility
 *   events: 'camera:fit' {animate}, 'camera:focus' {id,x,y,z}, 'camera:end' {mode},
 *           'view:resize' {w,h,dpr}, 'background:click' {x,y,wx,wy}
 * freeRect is {x, y, w, h} in CSS px relative to the stage canvas (#world).
 */
(function () {
  'use strict';

  const TILE = 16, COLS = 80, ROWS = 50;
  const W = TILE * COLS, H = TILE * ROWS;
  const DEBUG = window.SHACK_DEBUG && typeof window.SHACK_DEBUG === 'object' ? window.SHACK_DEBUG : {};

  const S = (window.SHACK = {
    TILE, COLS, ROWS, W, H,
    debug: DEBUG,
    reducedMotion: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  });
  const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  /* ------------------------------------------------------------------ data
   * State files are written by LLM agents, so the data can hold stray nulls,
   * wrong types or missing lists. normalizeData() fixes the shape once, so no
   * module can throw on it: every known list is an array of plain objects and
   * every known record is an object (or absent). */
  const DATA_LISTS = ['threads', 'alerts', 'tasks', 'goals', 'runs', 'commits', 'cycles', 'clients', 'savings_goals'];
  const DATA_OBJS = ['world', 'store', 'payday', 'business', 'brief', 'calendar', 'player', 'hermes', 'recaps', 'notifications', 'autonomy', 'weights'];
  function normalizeData(d) {
    if (!isObj(d)) d = {};
    for (const k of DATA_LISTS) d[k] = Array.isArray(d[k]) ? d[k].filter(isObj) : [];
    for (const k of DATA_OBJS) if (own(d, k) && d[k] != null && !isObj(d[k])) d[k] = {};
    if (!isObj(d.agents)) d.agents = {};
    for (const a of Object.keys(d.agents)) {
      if (!isObj(d.agents[a])) d.agents[a] = {};
      else if (own(d.agents[a], 'world') && !isObj(d.agents[a].world)) d.agents[a].world = {};
    }
    if (own(d, 'next_cycle') && !isObj(d.next_cycle)) d.next_cycle = null;
    if (own(d, 'money_days') && !Array.isArray(d.money_days)) d.money_days = [];
    return d;
  }
  function readData() {
    let d = null;
    if (DEBUG.data) d = DEBUG.data;
    else {
      const el = document.getElementById('shack-data');
      try { d = JSON.parse(el ? el.textContent : 'null'); } catch (e) { console.warn('SHACK: page data is not valid JSON', e); d = null; }
    }
    try { return normalizeData(d); } catch (e) { console.error('SHACK: data normalisation', e); return normalizeData({}); }
  }
  S.normalizeData = normalizeData;
  S.data = readData();
  /** The social media business's name, or its placeholder until Hudson picks one. */
  S.businessName = function () {
    const b = isObj(S.data.business) ? S.data.business : {};
    const s = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
    return s(b.name) || s(b.placeholder) || 'Social media business';
  };

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

  /** Landmark anchor points (tile coords). All fictional; real data drives them. Labels are sentence case. */
  S.landmarks = {
    clockTower:     { x: 39, y: 19, island: 'square', label: 'Clock tower' },
    fountain:       { x: 39, y: 26, island: 'square', label: 'Fountain' },
    questBoard:     { x: 35, y: 22, island: 'square', label: 'Request board' },
    mailPost:       { x: 43, y: 22, island: 'square', label: 'Mail post' },
    chronicle:      { x: 43, y: 28, island: 'square', label: "The Chronicle (J.A.R.V.I.S.'s log)" },
    dockNW:         { x: 31, y: 17, island: 'square', label: 'Kite landing (from Lantern Peak)' },
    dockNE:         { x: 48, y: 17, island: 'square', label: 'Blimp mast (from Neon Hollow)' },
    dockSW:         { x: 31, y: 29, island: 'square', label: 'Sky-ship pier (from Spindrift Harbor)' },
    dockSE:         { x: 48, y: 29, island: 'square', label: 'Rail station (from Copperhold)' },
    temple:         { x: 13, y: 7,  island: 'monastery', label: 'Temple' },
    studyGarden:    { x: 19, y: 13, island: 'monastery', label: 'Study garden' },
    kitePad:        { x: 23, y: 13, island: 'monastery', label: 'Kite launch' },
    broadcastTower: { x: 73, y: 6,  island: 'market', label: 'Broadcast tower' },
    angiesStall:    { x: 61, y: 9,  island: 'market', label: S.businessName() }, // Hudson's social media business (internal id kept)
    fidgetStall:    { x: 69, y: 13, island: 'market', label: 'Fidgetly promo stall' },
    billboard:      { x: 66, y: 4,  island: 'market', label: 'Billboard' },
    blimpMast:      { x: 56, y: 13, island: 'market', label: 'Blimp mast' },
    bazaar:         { x: 13, y: 37, island: 'port', label: 'Bazaar' },
    skyDock:        { x: 23, y: 33, island: 'port', label: 'Sky-ship dock' },
    warehouse:      { x: 7,  y: 41, island: 'port', label: 'Warehouse' },
    mineEntrance:   { x: 71, y: 32, island: 'mine', label: 'Mine entrance' },
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
    const start = S.nav.nodes[from] || S.nav.nodes.SQ;
    if (from === to || !own(S.nav.nodes, from) || !own(S.nav.nodes, to)) return [{ mode: 'walk', island: S.nav.island[from] || 'square', pts: [start.slice()] }];
    const prev = { [from]: null }, queue = [from];
    while (queue.length) {
      const n = queue.shift();
      if (n === to) break;
      for (const [m, pts, mode] of adj[n] || []) if (!(m in prev)) { prev[m] = [n, pts, mode]; queue.push(m); }
    }
    if (!(to in prev)) return [{ mode: 'walk', island: S.nav.island[from], pts: [start.slice()] }];
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
    hub:             { biome: 'square', character: 'J.A.R.V.I.S.', home: 'TOWER', item: 'bell', transport: null, color: '#5fd4ff' },
  };
  S.AGENTS = AGENTS;
  S.agentForBiome = (biome) => Object.keys(AGENTS).find((a) => AGENTS[a].biome === biome) || null;
  S.thread = (agent) => {
    const list = Array.isArray(S.data.threads) ? S.data.threads : [];
    return list.find((t) => isObj(t) && t.id === agent) || null;
  };
  S.metrics = (agent) => {
    const a = isObj(S.data.agents) ? S.data.agents : null;
    const m = a && own(a, agent) ? a[agent] : null;
    return isObj(m) ? m : {};
  };

  /* --------------------------------------------------------------- status
   * level: 'ok' | 'idle' | 'warn' | 'critical' — drives weather.
   * growth: 0..3 — drives how built-up each biome looks.
   * One bad record only blanks its own island's status, never the page.
   */
  function statusFor(biome, alerts) {
    const agent = S.agentForBiome(biome);
    const th = S.thread(agent) || {};
    const label = th.label;
    const mine = alerts.filter((a) => (label != null && a.agent === label) || a.agent === agent);
    let level = 'ok';
    if (!th.phase || th.phase === 'uninit') level = 'idle';
    if (th.phase === 'error' || mine.some((a) => a.level === 'warn')) level = 'warn';
    if (mine.some((a) => a.level === 'critical')) level = 'critical';
    const w = S.metrics(agent).world;
    let growth = isObj(w) && typeof w.growth === 'number' && isFinite(w.growth) ? w.growth : 0;
    const ds = isObj(DEBUG.status) ? DEBUG.status : null, dg = isObj(DEBUG.growth) ? DEBUG.growth : null;
    if (ds && own(ds, biome) && ['ok', 'idle', 'warn', 'critical'].includes(ds[biome])) level = ds[biome];
    if (dg && own(dg, biome) && typeof dg[biome] === 'number') growth = dg[biome];
    return { level, growth: Math.max(0, Math.min(3, growth | 0)), alerts: mine };
  }
  function computeStatus() {
    const out = {};
    const alerts = Array.isArray(S.data.alerts) ? S.data.alerts.filter(isObj) : [];
    for (const biome of S.BIOMES) {
      try { out[biome] = statusFor(biome, alerts); } catch (e) { console.error('SHACK: status for ' + biome, e); out[biome] = { level: 'idle', growth: 0, alerts: [] }; }
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
  const bootReal = Date.now();
  const debugStartMs = DEBUG.now ? new Date(DEBUG.now).getTime() : NaN;
  const debugStart = isFinite(debugStartMs) ? debugStartMs : null;

  S.now = () => (debugStart !== null ? new Date(debugStart + (DEBUG.freezeClock ? 0 : Date.now() - bootReal)) : new Date());

  /** Parts of a Date in New York time. */
  S.nyParts = function (d) {
    const p = {};
    for (const { type, value } of tzFmt.formatToParts(d)) p[type] = value;
    const hour = (+p.hour) % 24;
    return { year: +p.year, month: +p.month, day: +p.day, hour, minute: +p.minute, second: +p.second, dow: DOW[p.weekday] };
  };
  /** UTC ms of New York wall-clock y-mo-d hh:mm (DST-correct). */
  S.nyLocalToUtc = function (y, mo, d, hh, mm) {
    const want = Date.UTC(y, mo - 1, d, hh, mm);
    let t = want + 5 * 3.6e6;
    for (let i = 0; i < 3; i++) {
      const q = S.nyParts(new Date(t));
      const got = Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute);
      if (got === want) break;
      t += want - got;
    }
    return t;
  };

  function seasonFor(month) {
    if (month === 12 || month <= 2) return 'winter';
    if (month <= 5) return 'spring';
    if (month <= 8) return 'summer';
    return 'autumn';
  }

  /* Sunrise and sunset for Cold Spring, NY (41.42°N, 73.95°W) on the actual
   * date, NOAA's solar position approximation, in New York clock hours. */
  const LAT = 41.42, LON = -73.95;
  const sunCache = { key: '', rise: 7, set: 18.5 };
  function sunTimes(p) {
    const key = p.year + '-' + p.month + '-' + p.day;
    if (sunCache.key === key) return sunCache;
    // New York's UTC offset at local noon that day (so a DST switch at 2 AM doesn't skew the rest of the day)
    const off = Math.round((Date.UTC(p.year, p.month - 1, p.day, 12, 0) - S.nyLocalToUtc(p.year, p.month, p.day, 12, 0)) / 9e5) / 4;
    const doy = (Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 0)) / 864e5;
    const g = (2 * Math.PI / 365) * (doy - 1 + (12 - off) / 24 - 0.5);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const lat = (LAT * Math.PI) / 180;
    const c = Math.cos((90.833 * Math.PI) / 180) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl);
    const ha = (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
    sunCache.key = key;
    sunCache.rise = (720 - 4 * (LON + ha) - eq) / 60 + off;
    sunCache.set = (720 - 4 * (LON - ha) - eq) / 60 + off;
    return sunCache;
  }
  const WEEKDAY = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  /** Payday weekday index from S.data.payday.weekday ('Friday', 'fri', 5), Friday by default. */
  S.paydayDow = function () {
    const w = isObj(S.data.payday) ? S.data.payday.weekday : null;
    if (typeof w === 'number' && w >= 0 && w <= 6) return w | 0;
    if (typeof w === 'string') {
      const k = w.trim().toLowerCase();
      for (const name of Object.keys(WEEKDAY)) if (name === k || (k.length >= 3 && name.startsWith(k))) return WEEKDAY[name];
    }
    return 5;
  };

  /** Recomputed every frame. */
  S.time = {};
  function updateTime() {
    const d = S.now();
    const p = S.nyParts(d);
    const h = p.hour + p.minute / 60 + p.second / 3600;
    const sun = sunTimes(p), rise = sun.rise, set = sun.set;
    const tw = 0.75; // twilight length in hours
    let light;
    if (h < rise - tw || h > set + tw) light = 0;
    else if (h < rise + tw) light = (h - (rise - tw)) / (2 * tw);
    else if (h > set - tw) light = 1 - (h - (set - tw)) / (2 * tw);
    else light = 1;
    light = Math.max(0, Math.min(1, light));
    S.time.date = d; S.time.ny = p; S.time.hours = h; S.time.sunrise = rise; S.time.sunset = set;
    S.time.light = light;                    // 1 = full day, 0 = night
    S.time.isNight = light < 0.35;
    S.time.isDusk = h > set - tw && h < set + tw;
    S.time.isDawn = h > rise - tw && h < rise + tw;
    S.time.season = DEBUG.season || seasonFor(p.month);
    S.time.isFriday = p.dow === 5;
    S.time.isPayday = p.dow === S.paydayDow();
  }
  updateTime();

  /* --------------------------------------------------------------- cycles
   * The Director runs at the config's cycle times ('HH:MM' New York time).
   * The ceremony plays from 90 s before a cycle to 4 min after it, or on
   * demand via S.startCeremony(). S.data.next_cycle.at (computed when the
   * page was built) wins for S.cycle.next while it is still ahead.
   */
  const TIME_RE = /^\s*(\d{1,2}):(\d{2})\s*$/;
  const cycleCache = { key: '', src: null, list: [] };
  function cycleDates() {
    const p = S.time.ny, cycles = Array.isArray(S.data.cycles) ? S.data.cycles : [];
    const key = p.year + '-' + p.month + '-' + p.day;
    if (cycleCache.key === key && cycleCache.src === cycles) return cycleCache.list;
    const out = [];
    for (let dd = -1; dd <= 1; dd++) {
      const day = new Date(Date.UTC(p.year, p.month - 1, p.day + dd));
      const y = day.getUTCFullYear(), mo = day.getUTCMonth() + 1, dn = day.getUTCDate();
      for (const c of cycles) {
        if (!isObj(c)) continue;
        const m = TIME_RE.exec(typeof c.local_time === 'string' ? c.local_time : '');
        if (!m || +m[1] > 23 || +m[2] > 59) continue;
        out.push({ name: typeof c.name === 'string' && c.name ? c.name : 'check-in', focus: typeof c.focus === 'string' ? c.focus : '', at: new Date(S.nyLocalToUtc(y, mo, dn, +m[1], +m[2])) });
      }
    }
    out.sort((a, b) => a.at - b.at);
    cycleCache.key = key; cycleCache.src = cycles; cycleCache.list = out;
    return out;
  }
  const dataNextCache = { src: undefined, val: null };
  function dataNextCycle() {
    const nc = S.data.next_cycle;
    if (dataNextCache.src === nc) return dataNextCache.val;
    let val = null;
    if (isObj(nc) && typeof nc.at === 'string') {
      const at = Date.parse(nc.at);
      if (isFinite(at)) {
        const name = typeof nc.name === 'string' && nc.name ? nc.name : 'check-in';
        const c = (Array.isArray(S.data.cycles) ? S.data.cycles : []).find((x) => isObj(x) && x.name === name);
        val = { name, focus: c && typeof c.focus === 'string' ? c.focus : '', at: new Date(at) };
      }
    }
    dataNextCache.src = nc; dataNextCache.val = val;
    return val;
  }
  S.cycle = { next: null, last: null, ceremony: null };
  let manualCeremony = DEBUG.ceremony ? 0 : null; // ms since manual start
  S.startCeremony = function () { manualCeremony = 0; S.emit('ceremony:start', { manual: true }); };
  const CEREMONY_BEFORE = 90e3, CEREMONY_AFTER = 240e3, CEREMONY_MANUAL = 75e3;
  function updateCycle(dt) {
    const list = cycleDates(), now = S.time.date.getTime();
    let next = null, last = null;
    for (const c of list) { const at = c.at.getTime(); if (at > now) { if (!next) next = c; } else last = c; }
    const dn = dataNextCycle();
    if (dn && dn.at.getTime() > now && dn.at.getTime() - now < 8 * 864e5) next = dn;
    S.cycle.next = next; S.cycle.last = last;
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
      if (!phase && next) {
        const d = now - next.at.getTime();
        if (d > -CEREMONY_BEFORE && d < CEREMONY_AFTER) { phase = next.name; progress = (d + CEREMONY_BEFORE) / (CEREMONY_BEFORE + CEREMONY_AFTER); }
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
  S.on = (ev, fn) => { if (typeof fn === 'function') (listeners[ev] = listeners[ev] || []).push(fn); };
  S.off = (ev, fn) => { const l = listeners[ev]; if (!l) return; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  S.emit = (ev, payload) => { for (const fn of (listeners[ev] || []).slice()) { try { fn(payload); } catch (e) { console.error(e); } } };

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
    for (let guard = 0; guard < 8192; guard++) {
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
  const hexToRgb = (h) => { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
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
   *   order < 0   legacy native-resolution space, drawn under the islands
   *               (the space module now paints at screen resolution instead)
   *   order >= 0  islands: drawn into one full-size canvas, then cut into one
   *               canvas per island (S.islandBox) so each island can bob.
   *               Anything drawn outside every island box is discarded, so
   *               things spanning space (the rail bridge, ropes) belong in a
   *               dynamic layer using S.bobBetween().
   * DYNAMIC layers draw every frame into the native buffer, in ascending order:
   *   < 90 things out in space behind the islands (drifting islets)
   *   -- the islands are drawn here, each at its bob offset --
   *   100 water & ground animation   200 decor under people
   *   300 ENTITIES (y-sorted by the core)   400 things above people (birds, flags, smoke)
   *   500 weather   600 lighting/darkness   700 glow over the dark (fireworks, neon)
   *   800 in-canvas markers
   * The buffer starts transparent every frame: open space is see-through and
   * shows the screen backdrop. Anything blending with 'multiply' must stay
   * inside opaque art (a multiply over open space paints its colour there).
   * registerDynamic(order, fn, {island: id}) translates the context by that
   * island's bob before calling fn, so island-bound art bobs with it.
   * SCREEN layers (S.registerScreen(order, fn), order < 0) paint #world, the
   * device-resolution backdrop under the world art: fn(ctx, view) with
   * view = S.view = {w, h, dpr, cssW, cssH, z, ox, oy, fit: {z, ox, oy}, fitVersion,
   * full, moving, t, dt, frame} (device px; world point (wx, wy) is at
   * (ox + wx*z, oy + wy*z), and at (fit.ox + wx*fit.z, ...) at the fit view).
   * The core never clears #world except on resize, when view.full is true:
   * a screen layer repaints what it needs (all of it when full).
   */
  const statics = [], dynamics = [], entities = [], screenLayers = [];
  const byOrder = (a, b) => a.order - b.order;
  S.registerStatic = (order, fn) => { if (typeof fn !== 'function') return; statics.push({ order, fn }); statics.sort(byOrder); staticDirty = true; };
  S.registerDynamic = (order, fn, opts = {}) => { if (typeof fn !== 'function') return; dynamics.push({ order, fn, island: (opts && opts.island) || null }); dynamics.sort(byOrder); };
  S.registerScreen = (order, fn) => { if (typeof fn !== 'function') return; screenLayers.push({ order: Math.min(-1, +order || -1), fn }); screenLayers.sort(byOrder); V.full = true; };
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
  S.addHotspot = (h) => { if (!h || typeof h !== 'object') return h; if (h.priority == null) h.priority = 0; hotspots.push(h); return h; };
  S.hotspots = hotspots;
  function hitTest(wx, wy) {
    let best = null;
    for (const h of hotspots) {
      let r = h;
      if (typeof h.rect === 'function') { try { r = h.rect(); } catch (e) { r = null; } }
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

  /* UI hooks — replaced by the UI module. covers(rect) is optional: true when a
   * screen rect {x,y,w,h,l,t,r,b} (CSS px, canvas-relative) is under the UI. */
  S.ui = { open: () => {}, hudUpdate: () => {} };
  /* Audio hooks — replaced by the audio module. */
  S.audio = { sfx: () => {}, setBiome: () => {}, enabled: false };

  /* --------------------------------------------------------------- canvas */
  const canvas = document.getElementById('world');
  const screen = canvas.getContext('2d');
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
  const buffer = mkCanvas(W, H);
  const ctx = buffer.getContext('2d');
  const bg = mkCanvas(W, H);
  const bgx = bg.getContext('2d', { willReadFrequently: true });
  let sky = null, skyx = null, hasSky = false; // legacy static space (order < 0), allocated on demand
  /** Per-island static art: [{id, canvas, x, y, w, h}] (filled after the static draw). */
  S.islandLayers = [];
  S.canvas = canvas; S.buffer = buffer; S.ctx = ctx;
  canvas.style.cursor = 'default';
  canvas.style.imageRendering = 'auto';

  /* The art canvas: the visible world, upscaled by a whole number, then placed
   * and scaled by the remaining fraction with a CSS transform (bilinear in the
   * compositor). It sits right above #world, under #overlay. */
  const artWrap = document.createElement('div');
  const art = mkCanvas(1, 1), artx = art.getContext('2d');
  artWrap.className = 'shack-art';
  artWrap.setAttribute('aria-hidden', 'true');
  artWrap.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;pointer-events:none;';
  art.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;image-rendering:auto;will-change:transform;';
  artWrap.appendChild(art);
  if (canvas.parentNode) canvas.parentNode.insertBefore(artWrap, canvas.nextSibling);
  S.artCanvas = art;

  /* --------------------------------------------------------------- camera
   * cam.x/cam.y: world px at the centre of the view. cam.z: CSS px per native px.
   * cam.mode: 'fit' (resting), 'focus' (zoomed on something) or 'debug'
   * (SHACK_DEBUG.zoom/center forced it).
   */
  const RM = S.reducedMotion;
  const GLIDE_MS = 620;
  const FIT_MARGIN = 6;      // CSS px of breathing room around the world at the fit view
  const cam = (S.cam = { x: W / 2, y: H / 2, z: 1, minZ: 0.1, maxZ: 6, fitZ: 1, fitX: W / 2, fitY: H / 2, follow: null, followOff: null, pad: 0, mode: 'fit' });
  S.viewInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  const V = (S.view = { ctx: screen, w: 1, h: 1, dpr: 1, cssW: 0, cssH: 0, z: 1, ox: 0, oy: 0, fit: { z: 1, ox: 0, oy: 0 }, fitVersion: 0, full: true, moving: false, t: 0, dt: 0, frame: 0 });
  let viewW = 0, viewH = 0, dpr = 1;
  let glide = null;          // {x0,y0,z0,x1,y1,z1,start,dur}
  let focusReq = null;       // last focus request, re-applied on resize: {kind, rect|pt, ins, opts}

  const clampZ = (z) => Math.max(cam.minZ, Math.min(cam.maxZ, isFinite(z) && z > 0 ? z : cam.fitZ));
  /** The fit area: the stage minus S.viewInsets, CSS px relative to the canvas. */
  S.availRect = function () {
    const I = S.viewInsets;
    const x = Math.min(I.left, Math.max(0, viewW - 40)), y = Math.min(I.top, Math.max(0, viewH - 40));
    return { x, y, w: Math.max(40, viewW - x - I.right), h: Math.max(40, viewH - y - I.bottom) };
  };
  function computeFit() {
    const A = S.availRect();
    const z = Math.max(0.05, Math.min((A.w - 2 * FIT_MARGIN) / W, (A.h - 2 * FIT_MARGIN) / H));
    cam.fitZ = z;
    cam.fitX = W / 2 - (A.x + A.w / 2 - viewW / 2) / z;
    cam.fitY = H / 2 - (A.y + A.h / 2 - viewH / 2) / z;
    cam.minZ = Math.min(z, 1) * 0.5;
    V.fit.z = z * dpr;
    V.fit.ox = (viewW / 2 - cam.fitX * z) * dpr;
    V.fit.oy = (viewH / 2 - cam.fitY * z) * dpr;
    V.fitVersion++;
  }
  function setCam(x, y, z) {
    cam.z = clampZ(z);
    cam.x = isFinite(x) ? x : cam.fitX; cam.y = isFinite(y) ? y : cam.fitY;
  }
  function startGlide(x, y, z, animate) {
    z = clampZ(z);
    cam.follow = null;
    if (!animate || RM || !booted) { glide = null; setCam(x, y, z); V.moving = false; return; }
    glide = { x0: cam.x, y0: cam.y, z0: cam.z, x1: x, y1: y, z1: z, start: performance.now(), dur: GLIDE_MS };
  }
  function updateCamera(dt) {
    if (glide) {
      const u = Math.min(1, (performance.now() - glide.start) / glide.dur);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; // ease in-out cubic
      const z = glide.z0 * Math.pow(glide.z1 / glide.z0, e);
      // keep the motion straight on screen: interpolate the view centre in step with the zoom
      const span = 1 / glide.z1 - 1 / glide.z0;
      const k = Math.abs(span) < 1e-6 ? e : Math.max(0, Math.min(1, (1 / z - 1 / glide.z0) / span));
      setCam(glide.x0 + (glide.x1 - glide.x0) * k, glide.y0 + (glide.y1 - glide.y0) * k, z);
      V.moving = true;
      if (u >= 1) { setCam(glide.x1, glide.y1, glide.z1); glide = null; V.moving = false; S.emit('camera:end', { mode: cam.mode }); }
    } else if (cam.follow && !cam.follow.removed && isFinite(cam.follow.x) && isFinite(cam.follow.y)) {
      const o = cam.followOff || { x: 0, y: 0 };
      const tx = cam.follow.x + o.x, ty = cam.follow.y + o.y + S.bob(cam.follow.island);
      const f = RM ? 1 : Math.min(1, dt * 2.4);
      const nx = cam.x + (tx - cam.x) * f, ny = cam.y + (ty - cam.y) * f;
      V.moving = Math.abs(nx - cam.x) + Math.abs(ny - cam.y) > 0.01;
      cam.x = nx; cam.y = ny;
    } else V.moving = false;
  }
  /** Back to the fit view. */
  S.fitView = function (opts) {
    const animate = !!(opts && opts.animate);
    const was = cam.mode;
    cam.mode = 'fit'; focusReq = null; cam.pad = 0; cam.followOff = null;
    startGlide(cam.fitX, cam.fitY, cam.fitZ, animate);
    S.emit('camera:fit', { animate, from: was });
  };
  const insetsOf = (f) => ({ l: f.x, t: f.y, r: viewW - f.x - f.w, b: viewH - f.y - f.h });
  function freeFrom(ins) {
    const x = Math.max(0, ins.l), y = Math.max(0, ins.t);
    return { x, y, w: Math.max(80, viewW - x - Math.max(0, ins.r)), h: Math.max(80, viewH - y - Math.max(0, ins.b)) };
  }
  function goodRect(f) { return f && isFinite(f.x) && isFinite(f.y) && f.w > 0 && f.h > 0 ? f : null; }
  /**
   * Glide so world rect {x,y,w,h} fills freeRect (CSS px, canvas-relative; default:
   * the fit area). opts: {animate=true, margin=16, minZ=fit, maxZ=3, id}.
   * The view may run past the world edge: the backdrop fills it.
   */
  S.focusRect = function (rect, freeRect, opts) {
    opts = opts || {};
    if (!rect || !(rect.w > 0) || !(rect.h > 0)) return;
    const f = goodRect(freeRect) || S.availRect();
    const m = opts.margin == null ? 16 : +opts.margin || 0;
    let z = Math.min((f.w - 2 * m) / rect.w, (f.h - 2 * m) / rect.h);
    z = Math.max(opts.minZ == null ? cam.fitZ : +opts.minZ, Math.min(opts.maxZ == null ? 3 : +opts.maxZ, z));
    const cx = rect.x + rect.w / 2 - (f.x + f.w / 2 - viewW / 2) / z;
    const cy = rect.y + rect.h / 2 - (f.y + f.h / 2 - viewH / 2) / z;
    cam.mode = 'focus'; cam.followOff = null;
    focusReq = { kind: 'rect', rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, ins: insetsOf(f), opts };
    startGlide(cx, cy, z, opts.animate !== false);
    S.emit('camera:focus', { id: opts.id || null, x: cx, y: cy, z });
  };
  /** Zoom in on an island (its whole art box, underside included) inside freeRect. */
  S.focusIsland = function (id, freeRect, opts) {
    if (!own(S.islands, id)) return;
    const b = S.islandBox(id);
    S.focusRect(b, freeRect, Object.assign({ id }, opts || {}));
  };
  S.focusRegion = (id) => S.focusIsland(id);
  /** Put world point (wx, wy) at the centre of freeRect at zoom z (default: current). */
  S.glideTo = function (wx, wy, z, freeRect, opts) {
    opts = opts || {};
    if (!isFinite(wx) || !isFinite(wy)) return;
    const f = goodRect(freeRect) || S.availRect();
    z = clampZ(z || cam.z);
    const cx = wx - (f.x + f.w / 2 - viewW / 2) / z, cy = wy - (f.y + f.h / 2 - viewH / 2) / z;
    cam.mode = 'focus'; cam.followOff = null;
    focusReq = { kind: 'point', pt: { x: wx, y: wy, z }, ins: insetsOf(f), opts };
    startGlide(cx, cy, z, opts.animate !== false);
    S.emit('camera:focus', { id: opts.id || null, x: cx, y: cy, z });
  };
  /** Keep an entity ({x, y, island?}) at the centre of freeRect; any other camera call stops it. */
  S.follow = function (e, freeRect) {
    if (!e) { cam.follow = null; cam.followOff = null; return; }
    const f = goodRect(freeRect) || S.availRect();
    const z = glide ? glide.z1 : cam.z;   // a glide in flight finishes first, then the follow takes over
    cam.followOff = { x: -(f.x + f.w / 2 - viewW / 2) / z, y: -(f.y + f.h / 2 - viewH / 2) / z };
    cam.follow = e;
    if (cam.mode !== 'focus') { cam.mode = 'focus'; S.emit('camera:focus', { id: null, x: cam.x, y: cam.y, z }); }
  };
  S.isFocused = () => cam.mode === 'focus';
  /** Older API: glide the view centre to (wx, wy) at zoom z. A move to the fit zoom counts as the fit view. */
  S.panTo = function (wx, wy, z) {
    z = z || cam.z;
    if (Math.abs(z - cam.fitZ) < 1e-3) { S.fitView({ animate: true }); return; }
    cam.mode = 'focus'; focusReq = null; cam.followOff = null;
    startGlide(wx, wy, z, true);
    S.emit('camera:focus', { id: null, x: wx, y: wy, z });
  };
  S.zoomTo = (z, sx = viewW / 2, sy = viewH / 2) => {
    glide = null; cam.follow = null;
    const before = S.screenToWorld(sx, sy);
    cam.z = clampZ(z);
    const after = S.screenToWorld(sx, sy);
    cam.x += before.x - after.x; cam.y += before.y - after.y;
    if (cam.mode === 'fit' && Math.abs(cam.z - cam.fitZ) > 1e-3) { cam.mode = 'focus'; focusReq = null; S.emit('camera:focus', { id: null, x: cam.x, y: cam.y, z: cam.z }); }
  };
  S.zoomBy = (f, sx, sy) => S.zoomTo(cam.z * f, sx, sy);
  S.screenToWorld = (sx, sy) => ({ x: cam.x + (sx - viewW / 2) / cam.z, y: cam.y + (sy - viewH / 2) / cam.z });
  S.worldToScreen = (wx, wy) => ({ x: (wx - cam.x) * cam.z + viewW / 2, y: (wy - cam.y) * cam.z + viewH / 2 });

  /** Inset changes refit; the camera follows when it is at (or gliding to) the fit view. */
  S.setViewInsets = function (o) {
    if (!o || typeof o !== 'object') return;
    let changed = false;
    for (const k of ['top', 'right', 'bottom', 'left']) {
      if (!own(o, k)) continue;
      const v = Math.max(0, Math.round(+o[k] || 0));
      if (v !== S.viewInsets[k]) { S.viewInsets[k] = v; changed = true; }
    }
    if (!changed || !viewW) return;
    computeFit();
    if (cam.mode === 'fit') {
      if (glide) Object.assign(glide, { x1: cam.fitX, y1: cam.fitY, z1: cam.fitZ });
      else setCam(cam.fitX, cam.fitY, cam.fitZ);
    }
  };

  function resize() {
    const nd = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const nw = canvas.clientWidth, nh = canvas.clientHeight;
    if (!nw || !nh) return false;
    if (nw === viewW && nh === viewH && nd === dpr && S._camInit) return false;
    viewW = nw; viewH = nh; dpr = nd;
    const cw = Math.max(1, Math.round(viewW * dpr)), ch = Math.max(1, Math.round(viewH * dpr));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    V.w = canvas.width; V.h = canvas.height; V.dpr = dpr; V.cssW = viewW; V.cssH = viewH; V.full = true;
    computeFit();
    if (!S._camInit) {
      S._camInit = true;
      if (DEBUG.zoom || DEBUG.center) {
        cam.mode = 'debug';
        const z = +DEBUG.zoom || cam.fitZ;
        const c = Array.isArray(DEBUG.center) && DEBUG.center.length >= 2 ? DEBUG.center : null;
        setCam(c ? c[0] * TILE : cam.fitX, c ? c[1] * TILE : cam.fitY, z);
      } else setCam(cam.fitX, cam.fitY, cam.fitZ);
    } else if (cam.mode === 'fit') {
      if (glide) Object.assign(glide, { x1: cam.fitX, y1: cam.fitY, z1: cam.fitZ });
      else setCam(cam.fitX, cam.fitY, cam.fitZ);
    } else if (cam.mode === 'focus' && focusReq) {
      const f = freeFrom(focusReq.ins), o = Object.assign({}, focusReq.opts, { animate: false });
      if (focusReq.kind === 'rect') S.focusRect(focusReq.rect, f, o);
      else S.glideTo(focusReq.pt.x, focusReq.pt.y, focusReq.pt.z, f, o);
    }
    S.emit('view:resize', { w: viewW, h: viewH, dpr });
    return true;
  }
  let dprQuery = null;
  function watchDpr() {
    if (!window.matchMedia) return;
    try {
      if (dprQuery) dprQuery.removeEventListener('change', onDpr);
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      dprQuery.addEventListener('change', onDpr);
    } catch (e) { dprQuery = null; }
  }
  function onDpr() { watchDpr(); onResize(); }
  function onResize() { if (resize() && booted) frameNow(); }

  /* ---------------------------------------------------------------- input
   * Fixed camera: a pointer only clicks and hovers. Left button only; a tap
   * may wander 4 px (mouse) or 10 px (touch/pen) and still count. A click on
   * a hotspot or island opens it (S.ui.open); a click on open space emits
   * 'background:click'. Hover tooltips are for mice only. Ctrl+wheel (trackpad
   * pinch) over the map is swallowed so the page doesn't zoom by accident;
   * keyboard zoom (Ctrl/Cmd +/-) still reaches the browser.
   */
  let tap = null, hover = null, cursor = 'default';
  const setCursor = (c) => { if (c !== cursor) { cursor = c; canvas.style.cursor = c; } };
  function doHover(sx, sy) {
    hover = { x: sx, y: sy };
    const w = S.screenToWorld(sx, sy);
    const h = hitTest(w.x, w.y);
    setCursor(h ? 'pointer' : 'default');
    showTooltip(h, sx, sy);
  }
  canvas.addEventListener('pointerdown', (e) => {
    showTooltip(null);
    if (e.pointerType === 'mouse' && e.button !== 0) { tap = null; return; }
    if (tap && tap.id !== e.pointerId) { tap.cancel = true; return; } // a second finger: never a tap
    tap = { id: e.pointerId, x: e.offsetX, y: e.offsetY, slop: e.pointerType === 'mouse' ? 4 : 10, moved: false, cancel: false };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (tap && e.pointerId === tap.id) {
      if (Math.hypot(e.offsetX - tap.x, e.offsetY - tap.y) > tap.slop) tap.moved = true;
      return;
    }
    if (e.pointerType === 'mouse' && !e.buttons) doHover(e.offsetX, e.offsetY);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!tap || e.pointerId !== tap.id) return;
    const ok = !tap.moved && !tap.cancel;
    tap = null;
    if (ok) {
      const w = S.screenToWorld(e.offsetX, e.offsetY);
      const h = hitTest(w.x, w.y);
      if (h) { try { S.audio.sfx('click'); } catch (err) { /* optional */ } try { S.ui.open(h); } catch (err) { console.error('ui.open', err); } }
      else S.emit('background:click', { x: e.offsetX, y: e.offsetY, wx: w.x, wy: w.y });
    }
    if (e.pointerType === 'mouse') doHover(e.offsetX, e.offsetY);
  });
  canvas.addEventListener('pointercancel', (e) => { if (tap && e.pointerId === tap.id) tap = null; });
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' || !tap) { hover = null; showTooltip(null); setCursor('default'); } });
  canvas.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  canvas.addEventListener('gesturestart', (e) => e.preventDefault());

  /* ------------------------------------------------------- DOM overlays
   * Speech bubbles, name tags and the hover tooltip live in #overlay. Elements
   * are created hidden (visibility, so they can be measured), positioned on
   * whole CSS pixels from their bottom-centre anchor, and only written when
   * something changed. Tags and bubbles under the UI (S.ui.covers) fade out.
   */
  const overlay = document.getElementById('overlay');
  const tooltip = document.getElementById('tooltip');
  const tip = { text: null, w: 0, h: 0, tf: '' };
  function showTooltip(h, sx, sy) {
    if (!tooltip) return;
    if (!h || !h.label) { if (!tooltip.hidden) tooltip.hidden = true; tip.text = null; return; }
    const text = String(h.label);
    if (tooltip.hidden) tooltip.hidden = false;
    if (text !== tip.text) { tooltip.textContent = text; tip.text = text; tip.w = tooltip.offsetWidth; tip.h = tooltip.offsetHeight; }
    let x = sx + 14, y = sy + 12;
    if (x + tip.w > viewW - 4) x = Math.max(4, sx - 10 - tip.w);
    if (y + tip.h > viewH - 4) y = Math.max(4, sy - 8 - tip.h);
    const tf = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (tf !== tip.tf || tooltip.style.transform !== tf) { tip.tf = tf; tooltip.style.transform = tf; }
  }

  const recs = new Map();   // element -> record (labels and bubbles), for the size observer
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    for (const en of entries) {
      const r = recs.get(en.target);
      if (!r) continue;
      const b = en.borderBoxSize && (en.borderBoxSize[0] || en.borderBoxSize);
      r.w = b && b.inlineSize != null ? b.inlineSize : en.target.offsetWidth;
      r.h = b && b.blockSize != null ? b.blockSize : en.target.offsetHeight;
    }
  }) : null;
  function track(el, rec) {
    el.style.visibility = 'hidden';
    el.style.left = '0px'; el.style.top = '0px';
    rec.w = 0; rec.h = 0; rec.tf = ''; rec.vis = false; rec.op = 0; rec.opW = ''; rec.rect = { x: 0, y: 0, w: 0, h: 0, l: 0, t: 0, r: 0, b: 0 };
    recs.set(el, rec);
    if (ro) ro.observe(el);
  }
  function untrack(el) { recs.delete(el); if (ro) ro.unobserve(el); el.remove(); }
  function measure(r) { if (!ro || !r.w) { r.w = r.el.offsetWidth; r.h = r.el.offsetHeight; } }
  /** Read phase for one tag/bubble: where it goes and whether it shows (no DOM writes). */
  function place(r, x, y, show, dt, maxOp) {
    if (show && !r.w) measure(r);
    let want = 0;
    if (show && r.w) {
      const L = Math.round(x - r.w / 2), T = Math.round(y - r.h);
      const R = r.rect; R.x = R.l = L; R.y = R.t = T; R.w = r.w; R.h = r.h; R.r = L + r.w; R.b = T + r.h;
      r.nextTf = `translate(${L}px, ${T}px)`;
      want = maxOp;
      if (typeof S.ui.covers === 'function') { let c = false; try { c = !!S.ui.covers(R); } catch (e) { c = false; } if (c) want = 0; }
    }
    // ease opacity (fast); jump when appearing for the first time so nothing slides in from 0,0
    if (!r.vis && want > 0) r.op = want;
    else r.op += (want - r.op) * Math.min(1, RM ? 1 : dt * 14);
    if (Math.abs(r.op - want) < 0.02) r.op = want;
    r.nextVis = r.op > 0.01 && !!r.nextTf;
  }
  /** Write phase: only what changed. */
  function commit(r) {
    if (r.nextVis) {
      if (r.nextTf !== r.tf) { r.tf = r.nextTf; r.el.style.transform = r.tf; }
      const o = r.op >= 0.995 ? '' : r.op.toFixed(2);
      if (o !== r.opW) { r.opW = o; r.el.style.opacity = o; }
    }
    if (r.nextVis !== r.vis) { r.vis = r.nextVis; r.el.style.visibility = r.vis ? '' : 'hidden'; }
  }

  const bubbles = [];
  /**
   * Show a speech bubble above a world point or entity for `ms`.
   * anchor: entity ({x,y}) or {x,y} in native px. opts: {ms, tone:'info'|'warn'|'critical'|'quiet', biome, dy}
   */
  S.bubble = function (anchor, text, opts = {}) {
    if (!overlay || !anchor) return null;
    const el = document.createElement('div');
    el.className = 'bubble' + (opts.tone ? ' bubble--' + opts.tone : '') + (opts.biome ? ' bubble--' + opts.biome : '');
    el.textContent = text == null ? '' : String(text);
    const b = { el, anchor, born: performance.now(), ms: opts.ms || 4200, dy: opts.dy == null ? 40 : opts.dy };
    track(el, b);
    overlay.appendChild(el);
    bubbles.push(b);
    return b;
  };
  function updateBubbles(dt) {
    const now = performance.now();
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      const age = now - b.born, a = b.anchor;
      if (age > b.ms || !a || a.removed) { untrack(b.el); bubbles.splice(i, 1); continue; }
      const p = S.worldToScreen(a.x, a.y - (+b.dy || 0) + S.bob(a.island));
      const on = isFinite(p.x) && isFinite(p.y) && !(p.x < -60 || p.y < -40 || p.x > viewW + 60 || p.y > viewH + 40) && !a.hidden;
      const fade = Math.max(0, Math.min(1, age / 180, (b.ms - age) / 300));
      place(b, p.x, p.y, on, dt, fade);
      if (on && b.vis) b.op = Math.min(b.op, fade);
    }
    for (const b of bubbles) commit(b);
  }

  /**
   * Persistent name tag that follows an anchor (an entity or {x, y, island}).
   * opts: {color, dy (native px above the feet, default 34), className}.
   * Returns {el, anchor, dy, setText(text), remove()}. Hidden automatically when
   * the anchor is hidden, off screen or zoomed far out.
   */
  const labels = [];
  const LABEL_MIN_Z = 0.6;
  S.label = function (anchor, text, opts = {}) {
    if (!overlay) return { el: null, anchor, dy: 0, setText() {}, remove() {} };
    const el = document.createElement('div');
    el.className = 'nametag' + (opts.className ? ' ' + opts.className : '');
    if (opts.color) el.style.setProperty('--tag', opts.color);
    const L = {
      el, anchor, dy: opts.dy == null ? 34 : opts.dy, text: text == null ? '' : String(text),
      setText(t) { t = t == null ? '' : String(t); if (t !== L.text) { L.text = t; el.textContent = t; if (!ro) L.w = 0; } },
      remove() { untrack(el); const i = labels.indexOf(L); if (i >= 0) labels.splice(i, 1); },
    };
    el.textContent = L.text;
    track(el, L);
    overlay.appendChild(el);
    labels.push(L);
    return L;
  };
  function updateLabels(dt) {
    const show = cam.z >= LABEL_MIN_Z;
    for (const L of labels) {
      const a = L.anchor;
      let on = show && a && !a.hidden && !a.removed && !a.hideLabel;
      let p = null;
      if (on) {
        p = S.worldToScreen(a.x, a.y - (+L.dy || 0) + S.bob(a.island));
        on = isFinite(p.x) && isFinite(p.y) && !(p.x < -80 || p.y < -40 || p.x > viewW + 80 || p.y > viewH + 40);
      }
      place(L, p ? p.x : 0, p ? p.y : 0, on, dt, 1);
    }
    for (const L of labels) commit(L);
  }

  /* ---------------------------------------------------------------- loop */
  let last = performance.now(), t = 0, booted = false;
  const FRAME = 1000 / 30;
  S.frame = 0;

  function drawStatic() {
    hasSky = statics.some((s) => s.order < 0);
    if (hasSky && !sky) { sky = mkCanvas(W, H); skyx = sky.getContext('2d'); }
    if (skyx) skyx.clearRect(0, 0, W, H);
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
      const cv = mkCanvas(b.w, b.h);
      cv.getContext('2d').drawImage(bg, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
      return { id, canvas: cv, x: b.x, y: b.y, w: b.w, h: b.h };
    });
    staticDirty = false;
    S.emit('static:ready');
  }

  /** Space colour (the backdrop's mid tone; the space module keeps it in step with its ramp). */
  S.spaceColor = '#0a1120';

  function renderWorld(dt) {
    if (staticDirty) drawStatic();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    if (hasSky && sky) ctx.drawImage(sky, 0, 0);
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
    const lp = DEBUG.layerProfile ? (perf.layerMs = perf.layerMs || {}) : null;
    let lt = lp ? performance.now() : 0;
    const lmark = (k) => { ctx.getImageData(0, 0, 1, 1); const n = performance.now(); lp[k] = (lp[k] || 0) + n - lt; lt = n; };
    for (const d of dynamics) {
      if (!islandsDrawn && d.order >= 90) { drawIslands(); if (lp) lmark('islands'); }
      if (!entitiesDrawn && d.order >= 300) { drawEntities(); if (lp) lmark('entities'); }
      ctx.save();
      if (d.island) ctx.translate(0, S.bob(d.island));
      try { d.fn(ctx, t, dt); } catch (e) { console.error('dynamic layer', d.order, e); }
      ctx.restore();
      if (lp) lmark(d.order + (d.fn.name ? ':' + d.fn.name : '') + (d.island ? ':' + d.island : ''));
    }
    if (!islandsDrawn) drawIslands();
    if (!entitiesDrawn) drawEntities();
    if (DEBUG.perfFlush || lp) ctx.getImageData(0, 0, 1, 1); // profiling only: rasterise the buffer here, so 'present' is the upscale alone
  }

  /* Sharp-bilinear present: nearest-neighbour upscale of the visible world by k
   * into the art canvas, then a CSS transform puts it on whole device pixels and
   * scales it by the fraction left (zoom*dpr/k). Below 1 device px per art px the
   * region is drawn straight at its final size with smoothing (no lost lines). */
  const ART_MAX_PX = 36e6;
  const P = { k: -1, dpr: 0, bw: 0, bh: 0, tf: '', shown: true };
  function ensureArt(k, bw, bh) {
    const needW = bw + 2, needH = bh + 2;
    if (k === P.k && P.dpr === dpr && art.width >= needW && art.height >= needH && art.width <= needW * 2 + 256 && art.height <= needH * 2 + 256) return;
    const cw = Math.ceil((needW * 1.1) / 32) * 32, ch = Math.ceil((needH * 1.1) / 32) * 32;
    art.width = cw; art.height = ch;
    art.style.width = cw / dpr + 'px'; art.style.height = ch / dpr + 'px';
    P.k = k; P.dpr = dpr; P.bw = 0; P.bh = 0; P.tf = '';
  }
  function present() {
    const zd = cam.z * dpr;
    const ox = (viewW / 2 - cam.x * cam.z) * dpr, oy = (viewH / 2 - cam.y * cam.z) * dpr;
    V.z = zd; V.ox = ox; V.oy = oy;
    const DW = canvas.width, DH = canvas.height;
    const x0 = Math.max(0, Math.floor(-ox / zd) - 1), y0 = Math.max(0, Math.floor(-oy / zd) - 1);
    const x1 = Math.min(W, Math.ceil((DW - ox) / zd) + 1), y1 = Math.min(H, Math.ceil((DH - oy) / zd) + 1);
    const ok = isFinite(zd) && zd > 0 && x1 > x0 && y1 > y0;
    if (ok !== P.shown) { P.shown = ok; art.style.visibility = ok ? '' : 'hidden'; }
    if (!ok) return;
    const rw = x1 - x0, rh = y1 - y0;
    const dx0 = Math.round(ox + x0 * zd), dy0 = Math.round(oy + y0 * zd);
    const dw = Math.max(1, Math.round(ox + x1 * zd) - dx0), dh = Math.max(1, Math.round(oy + y1 * zd) - dy0);
    let k, bw, bh;
    if (zd < 0.999) { k = 0; bw = dw; bh = dh; }
    else {
      const n = Math.round(zd);
      k = Math.abs(zd - n) < 0.004 ? n : Math.ceil(zd);
      bw = rw * k; bh = rh * k;
      if (bw * bh > ART_MAX_PX) { k = -2; bw = dw; bh = dh; } // huge zoom: plain nearest at the final size
    }
    ensureArt(k, bw, bh);
    artx.setTransform(1, 0, 0, 1, 0, 0);
    artx.globalAlpha = 1; artx.globalCompositeOperation = 'source-over';
    artx.clearRect(0, 0, Math.min(art.width, Math.max(P.bw, bw) + 2), Math.min(art.height, Math.max(P.bh, bh) + 2));
    artx.imageSmoothingEnabled = k === 0;
    if (k === 0) artx.imageSmoothingQuality = 'high';
    artx.drawImage(buffer, x0, y0, rw, rh, 0, 0, bw, bh);
    P.bw = bw; P.bh = bh;
    const tf = `translate(${dx0 / dpr}px, ${dy0 / dpr}px) scale(${dw / bw}, ${dh / bh})`;
    if (tf !== P.tf) { P.tf = tf; art.style.transform = tf; }
  }

  let lastFill = '';
  function drawScreen(dt) {
    V.t = t; V.dt = dt; V.frame = S.frame;
    if (!screenLayers.length) {
      if (V.full || lastFill !== S.spaceColor) { lastFill = S.spaceColor; screen.setTransform(1, 0, 0, 1, 0, 0); screen.fillStyle = S.spaceColor; screen.fillRect(0, 0, canvas.width, canvas.height); }
    } else {
      for (const L of screenLayers) {
        screen.save();
        try { L.fn(screen, V); } catch (e) { console.error('screen layer', L.order, e); }
        screen.restore();
      }
    }
    V.full = false;
  }

  /* Frame timing, for tuning: S.perf.report() gives median / p95 ms per phase
   * over the last 240 frames (update, layers, present, screen, overlay, total).
   * SHACK_DEBUG.perfFlush rasterises the buffer before the present (so 'present'
   * is the upscale alone); SHACK_DEBUG.layerProfile also sums ms per dynamic
   * layer into S.perf.layerMs (both slow a frame down; previews only). */
  const PH = ['update', 'layers', 'present', 'screen', 'overlay', 'total'];
  const PN = 240;
  const perf = (S.perf = { n: 0, rings: {}, last: {} });
  for (const k of PH) perf.rings[k] = new Float32Array(PN);
  const mark = (k, ms) => { perf.rings[k][perf.n % PN] = ms; perf.last[k] = ms; };
  perf.report = function () {
    const n = Math.min(perf.n, PN), out = { frames: n };
    for (const k of PH) {
      const a = Array.from(perf.rings[k].subarray(0, n)).sort((x, y) => x - y);
      out[k] = n ? { p50: +a[Math.floor(n * 0.5)].toFixed(2), p95: +a[Math.min(n - 1, Math.floor(n * 0.95))].toFixed(2), mean: +(a.reduce((s, v) => s + v, 0) / n).toFixed(2) } : null;
    }
    return out;
  };
  perf.reset = () => { perf.n = 0; };

  function frameCore(dt) {
    const t0 = performance.now();
    try { updateTime(); } catch (e) { console.error('time', e); }
    try { updateBobs(t); } catch (e) { console.error('bobs', e); }
    try { updateCycle(dt); } catch (e) { console.error('cycle', e); }
    try { updateCamera(dt); } catch (e) { console.error('camera', e); glide = null; cam.follow = null; setCam(cam.fitX, cam.fitY, cam.fitZ); }
    if (!DEBUG.paused) for (const e of entities) { if (e.update) { try { e.update(dt, t); } catch (err) { console.error('entity update', err); e.update = null; } } }
    const t1 = performance.now();
    try { renderWorld(dt); } catch (e) { console.error('render', e); }
    const t2 = performance.now();
    try { present(); } catch (e) { console.error('present', e); }
    const t3 = performance.now();
    try { drawScreen(dt); } catch (e) { console.error('screen', e); }
    const t4 = performance.now();
    try { updateBubbles(dt); } catch (e) { console.error('bubbles', e); }
    try { updateLabels(dt); } catch (e) { console.error('labels', e); }
    if (hover && V.moving && S.frame % 3 === 0) { try { doHover(hover.x, hover.y); } catch (e) { /* hover is cosmetic */ } }
    const t5 = performance.now();
    mark('update', t1 - t0); mark('layers', t2 - t1); mark('present', t3 - t2); mark('screen', t4 - t3); mark('overlay', t5 - t4); mark('total', t5 - t0);
    perf.n++;
  }
  /** Render one frame right now (after a resize, so no blank frame is ever painted). */
  function frameNow() { frameCore(0); }

  function step(now) {
    requestAnimationFrame(step);
    if (document.hidden) { last = now; return; }
    const elapsed = now - last;
    if (elapsed < FRAME - 2 && !DEBUG.everyFrame) return;
    last = now;
    const dt = Math.min(0.1, Math.max(0, elapsed / 1000));
    if (!DEBUG.paused) t += dt;
    S.t = t; S.frame++;
    frameCore(dt);
    if (S.frame % 15 === 0) { try { S.ui.hudUpdate(); } catch (e) { console.error(e); } }
  }

  /** Called once after every module has loaded (the last <script> line). */
  S.boot = function () {
    if (booted) return;
    resize();
    try { updateTime(); updateCycle(0); } catch (e) { console.error('boot cycle', e); }
    window.addEventListener('resize', onResize);
    if (typeof ResizeObserver === 'function') { try { new ResizeObserver(onResize).observe(canvas); } catch (e) { /* window resize still works */ } }
    watchDpr();
    booted = true;
    S.emit('boot');
    S.emit('ready');
    last = performance.now() - FRAME; // the first animation frame renders at once
    requestAnimationFrame(step);
  };
})();
