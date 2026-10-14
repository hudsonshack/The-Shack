/* The Shack: UI module. The Today column, the HUD, drawer panels, the Chronicle and the request board.
 *
 * Implements S.ui.open(hotspot) and S.ui.hudUpdate() for the core, plus S.ui.openTodos() (open to-dos for
 * the villagers' bubbles) and S.ui.covers(rect) (true when a stage rect is under the drawer, HUD or Today).
 *
 * Today (#today, docked left on a Mac, a slide-over below 1100px, the default view on phones): date and
 * greeting, J.A.R.V.I.S.'s brief, today's calendar, the to-do list (Hudson's own to-dos in db `todos` plus
 * the agent tasks that need him, ticked in db `checks`), school, the social media business, money on
 * Saturdays, and when the data was last updated.
 * HUD (in #stage): the status card (top centre; hidden while a panel is open or an island is focused) and
 * the dock (Ask J.A.R.V.I.S., Chronicle, sound). The camera is fixed: opening a panel glides in on its
 * island, closing it glides back to the fit view.
 * Everything shown comes from S.data (real state) or the artifact's db. Empty data gets an honest empty
 * state. Agent-written text goes through plain() before it is shown.
 * Keys: N add a to-do, A (or Q) ask J.A.R.V.I.S., C Chronicle, T Today (narrow screens), 1-5 islands, Esc.
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S) return;

  const NY = 'America/New_York';
  const D = () => S.data || {};
  /* State files are written by LLM agents and the db by people, so values can be null or the wrong type:
   * arr() drops null entries, objs() keeps only records, strs() only non-empty strings. */
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => x != null) : []);
  const objs = (v) => arr(v).filter((x) => typeof x === 'object' && !Array.isArray(x));
  const strs = (v) => arr(v).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const rec = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, w, pl) => `${n} ${n === 1 ? w : (pl || w + 's')}`;
  const own = (o, k) => o != null && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  const pick = (o, k) => (own(o, k) ? o[k] : undefined);
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  /* ================================================================ names */
  const bizName = () => { const b = rec(D().business); return str(b.name) || str(b.placeholder) || 'Social media business'; };
  const player = () => rec(D().player);
  const playerName = () => str(player().name) || 'Hudson';
  const address = () => str(player().address) || 'Mr. Shackelford';
  const isl = (id, fb) => (S.islands && S.islands[id] && str(S.islands[id].name)) || fb;
  const THEME = {
    square:    { name: isl('square', 'Clockspire'), color: '#5fd4ff', agent: 'hub' },
    monastery: { name: isl('monastery', 'Lantern Peak'), color: '#86d0b0', agent: 'academic-core' },
    market:    { name: isl('market', 'Neon Hollow'), color: '#ff5fb0', agent: 'social-ops' },
    port:      { name: isl('port', 'Spindrift Harbor'), color: '#63b4e6', agent: 'hustle-engine' },
    mine:      { name: isl('mine', 'Copperhold'), color: '#f2c94c', agent: 'ledger-fi' },
  };
  const moneyDays = () => { const l = strs(D().money_days); return l.length ? l : ['Saturday']; };
  const moneyDaysText = () => { const l = moneyDays().map((d) => cap(d.toLowerCase())); return l.length > 1 ? l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1] : l[0]; };
  const AGENT_INFO = {
    hub:             { name: 'J.A.R.V.I.S.', short: 'J.A.R.V.I.S.', area: () => 'Hub', biome: 'square', label: 'Director',
      role: () => 'Runs the daily check-in, reads every report, writes your morning brief and keeps the Chronicle.' },
    'academic-core': { name: 'Abbot Quill', short: 'Abbot Quill', area: () => 'School', biome: 'monastery', label: 'Academic-Core',
      role: () => 'School: Classroom deadlines, study blocks and Quizlet sets.' },
    'ledger-fi':     { name: 'Grit Copperpot', short: 'Grit', area: () => 'Money', biome: 'mine', label: 'Ledger-Fi',
      role: () => `Money: paychecks, budgets, savings goals and odd charges. Checks in on ${moneyDaysText()}s.` },
    'social-ops':    { name: 'Lumi', short: 'Lumi', area: () => bizName(), biome: 'market', label: 'Social-Ops',
      role: () => `Your ${bizName() === 'Social media business' ? 'social media business' : 'social media business, ' + bizName()}: client posts (Angie's is your first client), footage and approvals.` },
    'hustle-engine': { name: "Cap'n Twirl", short: "Cap'n Twirl", area: () => 'Fidgetly store', biome: 'port', label: 'Hustle-Engine',
      role: () => 'Fidgetly, your Shopify store: orders, stock and new product ideas.' },
  };
  const agentInfo = (a) => pick(AGENT_INFO, a) || null;
  /** Which agent an alert or text label belongs to ('Academic-Core', 'academic-core', 'Abbot Quill', 'School'). */
  function agentOf(label) {
    const l = str(label).toLowerCase();
    if (!l) return null;
    for (const k of Object.keys(AGENT_INFO)) {
      const a = AGENT_INFO[k];
      if (l === k || l === a.label.toLowerCase() || l === a.name.toLowerCase() || l === a.short.toLowerCase() || l === a.area().toLowerCase()) return k;
    }
    for (const t of objs(D().threads)) if (str(t.label).toLowerCase() === l && agentInfo(t.id)) return t.id;
    return null;
  }
  const colorOf = (agent) => { const a = agentInfo(agent); return a ? THEME[a.biome].color : '#8593ab'; };
  /** Island order for the nav strip and the 1-5 keys. */
  const NAV = ['square', 'monastery', 'market', 'port', 'mine'];
  const NAV_SHORT = { square: 'Hub', monastery: 'School', market: 'Business', port: 'Fidgetly', mine: 'Money' };
  const PLACE = { square: THEME.square.name, monastery: THEME.monastery.name, market: THEME.market.name, port: THEME.port.name, mine: THEME.mine.name };
  const TRANSPORT = {
    kite:  { name: 'paper kites and gliders', short: 'kite', icon: 'kite' },
    blimp: { name: 'the neon blimp', short: 'blimp', icon: 'blimp' },
    ship:  { name: 'the sky-ship', short: 'sky-ship', icon: 'ship' },
    rail:  { name: 'a minecart on the sky-rail bridge', short: 'minecart', icon: 'cart' },
  };
  const transportOf = (biome) => pick(TRANSPORT, (S.nav && S.nav.transport && S.nav.transport[biome]) || pick({ monastery: 'kite', market: 'blimp', port: 'ship', mine: 'rail' }, biome)) || null;
  const NET_NAME = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', facebook: 'Facebook', x: 'X', twitter: 'X', linkedin: 'LinkedIn', pinterest: 'Pinterest', threads: 'Threads' };
  const netName = (n) => pick(NET_NAME, String(n).toLowerCase()) || String(n);
  const netKey = (n) => { const k = String(n).toLowerCase(); return own(NET_NAME, k) ? k : 'other'; };
  /** Landmark labels as shown in panels (sentence case, plain vocabulary). */
  const LM_LABEL_FIX = { 'Clock Tower': 'Clock tower', 'Quest Board': 'Request board', 'Mail Post': 'Mail post', 'Monastery Temple': 'Temple', 'Study Garden': 'Study garden', 'Broadcast Tower': 'Broadcast tower', 'Mine Entrance': 'Mine entrance' };
  function lmLabel(key) {
    if (key === 'angiesStall' || key === 'bizStall') return bizName();
    if (key === 'questBoard') return 'Request board';
    if (key === 'chronicle') return 'The Chronicle';
    const lm = S.landmarks && pick(S.landmarks, key);
    let l = plain(str(lm && lm.label) || key).replace(/\s*\((?:from|J\.A\.R\.V\.I\.S\.|Mayor)[^)]*\)\s*$/i, '');
    return pick(LM_LABEL_FIX, l) || l;
  }

  /** Agent-written text in plain English: no task or goal ids, setup-doc references, file names, env vars,
   * blogIds or raw URLs (links are shown as buttons instead), and the hub's old name replaced. */
  function plain(s) {
    let t = typeof s === 'string' ? s : s == null ? '' : String(s);
    t = t.replace(/\bMayor Tock\b/g, 'J.A.R.V.I.S.').replace(/\bTock\b/g, 'J.A.R.V.I.S.');
    t = t.replace(/\s*\((?:[^()]*?(?:SETUP(?:\.md)?|\btask\s+[TG]-\d+|\b[TG]-\d{3,})[^()]*)\)/gi, '');
    t = t.replace(/\b(?:see\s+)?SETUP(?:\.md)?(?:\s+step\s*\d+)?\.?/gi, '');
    t = t.replace(/,?\s*\b[TG]-\d{3,}\s+(?:done|closed|finished)\b/g, '');
    t = t.replace(/\b(?:task\s+)?[TG]-\d{3,}\b:?/g, '');
    t = t.replace(/[;,]?\s*(?:(?:connect|link|open|see|go|visit)\s+)?(?:it\s+)?(?:(?:at|here|via|on)\s*)?:?\s*https?:\/\/[^\s)]+/gi, '');
    t = t.replace(/\s*\b(?:brand\s+)?blogId[\s=:]*\d+/gi, '');
    t = t.replace(/;?\s*\bdue \d{4}-\d{2}-\d{2}\.?/g, '');
    t = t.replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, (v) => (/_(?:KEY|TOKEN|SECRET)$/.test(v) ? 'its key' : 'a setting'));
    t = t.replace(/\b(brand|account|blog)\s+#?\d{5,}\b/gi, '$1');
    t = t.replace(/(?:^|\s)(?:[\w.-]+\/)+[\w.-]+\.(?:md|json|py|js|txt|ya?ml|csv)\b/g, '');
    t = t.replace(/\b[\w-]+\.(?:md|json|py|ya?ml)\b/g, '');
    t = t.replace(/<=/g, '≤').replace(/>=/g, '≥');
    t = t.replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,;:!?)])/g, '$1').replace(/\(\s+/g, '(')
      .replace(/([;,:])(?=[.!?]|$)/g, '').replace(/^[\s;,:.]+/, '').trim();
    return t;
  }
  /** The first http(s) link in agent text as a button-able link: {url, label}. */
  function linkIn(s, preferred) {
    const raw = str(preferred) || ((typeof s === 'string' && /https?:\/\/[^\s)]+/i.exec(s)) || [''])[0];
    if (!/^https?:\/\//i.test(raw)) return null;
    let host = '';
    try { host = new URL(raw).hostname.replace(/^www\./, ''); } catch (e) { return null; }
    const label = /metricool/.test(host) ? 'Open Metricool' : /drive\.google/.test(host) ? 'Open folder' : /shopify/.test(host) ? 'Open Shopify' : /classroom\.google/.test(host) ? 'Open Classroom' : 'Open ' + host;
    return { url: raw.replace(/[.,;]+$/, ''), label };
  }
  const extLink = (l, cls) => (l ? `<a class="${cls || 'lnk'}" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ${icon('ext', 2)}</a>` : '');
  /** Agent summaries in plain words ("Skipped: ..." reads as resting). */
  const summaryText = (s) => plain(s).replace(/^Skipped:\s*/i, 'Resting this check-in: ').replace(/^Store pulse by hub:\s*/i, 'Store check: ');
  /** Run notes with character names instead of agent ids. */
  function namesIn(s) {
    let t = plain(s);
    for (const k of Object.keys(AGENT_INFO)) {
      if (k === 'hub') continue;
      const a = AGENT_INFO[k];
      t = t.replace(new RegExp(`\\b(?:${k.replace('-', '[- ]')}|${a.label.replace('-', '[- ]')})\\b`, 'gi'), a.short);
    }
    return t.replace(/\bhustle pulse by hub\b/gi, 'store check').replace(/\bquest board\b/gi, 'request board');
  }

  /* ============================================================ pixel canvas */
  function cnv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function drawRows(g, rows, x, y, pal) {
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      for (let i = 0; i < row.length; i++) {
        const c = pal[row[i]];
        if (!c) continue;
        g.fillStyle = c; g.fillRect(x + i, y + j, 1, 1);
      }
    }
  }

  /* ------------------------------------------------------------------ icons */
  const ICONS = {
    logo: { pal: { r: '#3b5b7a', R: '#5a85a8', t: '#8fb8d8', s: '#bdb7ae', S: '#8e8882', W: '#fff3c4', k: '#1d1a24', d: '#3a2a20', g: '#e8b75a' }, rows: [
      '....g....', '...rtr...', '..rRtRr..', '.rRRRRRr.', 'rrrrrrrrr', '.sssssss.', '.sSWWWSs.', '.sWWkWWs.', '.sWWkkWs.', '.sSWWWSs.', '.sssssss.', '.sSsdsSs.', '.ssSdSss.', 'sssssssss'] },
    moon: { pal: { M: '#f3e8d2', m: '#b9ad98', s: '#ffe9a8' }, rows: [
      '...MMM...', '.MMMm....', '.MMm...s.', 'MMm......', 'MMm......', 'MMMm.....', '.MMMmm.MM', '..MMMMMM.'] },
    sun: { pal: { y: '#f2c94c', Y: '#ffe07a', W: '#fff6c8', o: '#c4952b' }, rows: [
      '....y....', '.y.....y.', '...ooo...', '..oYYYo..', 'y.oYWYo.y', '..oYYYo..', '...ooo...', '.y.....y.', '....y....'] },
    mist: { pal: { m: '#9fb0c6', d: '#5b6880' }, rows: [
      'mmmmmm.dd.', '..........', '.ddd.mmmmm', '..........', 'mmmmm.ddd.'] },
    rain: { pal: { C: '#c9d2dd', c: '#7d8796', b: '#5fc8ff' }, rows: [
      '...cccc...', '..cCCCCc..', '.cCCCCCCcc', 'cCCCCCCCCc', '.cccccccc.', '..b..b..b.', '.b..b..b..', '..........'] },
    storm: { pal: { C: '#8a8fa3', c: '#4f5366', y: '#ffe07a', b: '#5fc8ff' }, rows: [
      '...cccc...', '..cCCCCc..', '.cCCCCCCcc', 'cCCCCCCCCc', '.cccyyccc.', '..b.yy.b..', '.b..yb....', '.....y....'] },
    bell: { pal: { G: '#5fd4ff', g: '#2a8fb8', W: '#e8fbff', k: '#1b6f99' }, rows: [
      '...gg...', '..gGGg..', '.gGWGGg.', '.gGWGGg.', '.gGGGGg.', 'gGGGGGGg', 'gggggggg', '...kk...'] },
    alert: { pal: { y: '#f2c14e', k: '#1d1a24', o: '#9c6a1c' }, rows: [
      '....y....', '...yyy...', '...yky...', '..yykyy..', '..yykyy..', '.yyyyyyy.', '.yyykyyy.', 'ooooooooo'] },
    alertCrit: { pal: { y: '#ff6b6b', k: '#1d1a24', o: '#8a2b2b' }, rows: [
      '....y....', '...yyy...', '...yky...', '..yykyy..', '..yykyy..', '.yyyyyyy.', '.yyykyyy.', 'ooooooooo'] },
    info: { pal: { b: '#7fb2ff', B: '#b9d3ff', k: '#0b111d' }, rows: [
      '..bbbbb..', '.bBBBBBb.', 'bBBkBBBBb', 'bBBBBBBBb', 'bBBkkBBBb', 'bBBBkBBBb', 'bBBkkkBBb', '.bBBBBBb.', '..bbbbb..'] },
    ok: { pal: { g: '#5fd38d', d: '#2f7a4a' }, rows: [
      '.......g', '......gd', '.....gd.', 'g...gd..', 'dg.gd...', '.dggd...', '..dd....'] },
    board: { pal: { w: '#9b6b3d', W: '#c08a52', P: '#f3e8d2', k: '#8a7d68', r: '#ff6b6b' }, rows: [
      'WWWWWWWWW', 'wPPPrPPPw', 'wPkkkkkPw', 'wPPPPPPPw', 'wPkkkkPPw', 'wPPPPPPPw', 'wwwwwwwww', '.w.....w.'] },
    ask: { pal: { c: '#2a8fb8', C: '#5fd4ff', k: '#e8fbff' }, rows: [
      '.ccccccc.', 'cCCCCCCCc', 'cCkCkCkCc', 'cCCCCCCCc', '.cccCccc.', '...cc....', '..c......'] },
    today: { pal: { r: '#e8b75a', R: '#f6cd7c', w: '#e7edf7', k: '#5b6880', d: '#b6c2d6' }, rows: [
      '.k.....k.', 'RRRRRRRRR', 'rrrrrrrrr', 'wwwwwwwww', 'wkwwkwwkw', 'wwwwwwwww', 'wkwwkwwdw', 'wwwwwwwww'] },
    replay: { pal: { a: '#e7edf7', b: '#5fd4ff' }, rows: [
      '..aaaa.b', '.a....bb', 'a....bbb', 'a.......', 'a.......', 'a......a', '.a....a.', '..aaaa..'] },
    soundOn: { pal: { a: '#e7edf7', b: '#5fd4ff' }, rows: [
      '...a.....', '..aa..b..', 'aaaa.b.b.', 'aaaa.b.b.', 'aaaa.b.b.', 'aaaa.b.b.', '..aa..b..', '...a.....'] },
    soundOff: { pal: { a: '#b6c2d6', r: '#ff6b6b' }, rows: [
      '...a.....', '..aa.....', 'aaaa.r.r.', 'aaaa..r..', 'aaaa.r.r.', 'aaaa.....', '..aa.....', '...a.....'] },
    close: { pal: { a: '#e7edf7' }, rows: ['a.....a', '.a...a.', '..a.a..', '...a...', '..a.a..', '.a...a.', 'a.....a'] },
    del: { pal: { a: '#8593ab' }, rows: ['a...a', '.a.a.', '..a..', '.a.a.', 'a...a'] },
    ext: { pal: { a: '#5fd4ff' }, rows: ['..aaa', '...aa', '..a.a', '.a...', 'a....'] },
    coin: { pal: { y: '#f2c94c', Y: '#ffe07a', o: '#c4952b', k: '#8a6420' }, rows: [
      '..ooo..', '.oYYyo.', 'oYyoyyk', 'oYyoyyk', 'oyyoyyk', '.oyyyk.', '..kkk..'] },
    pin: { pal: { r: '#ff6b6b', R: '#ffb0b0', k: '#8a2b2b', n: '#b9ad98' }, rows: [
      '.rrr.', 'rRrrk', 'rrrrk', '.kkk.', '..n..', '..n..'] },
    bird: { pal: { w: '#e7edf7', d: '#8593ab', y: '#f2c14e' }, rows: [
      '.........', '.ww...ww.', 'wddw.wddw', '....wy...', '.........'] },
    scroll: { pal: { P: '#f3e8d2', p: '#c9b88f', k: '#7a5a3a', r: '#c8453a', w: '#9b6b3d' }, rows: [
      '.wwwwwwww.', 'wPPPPPPPPw', '.wPkkkkPw.', '..PPPPPPp.', '..PkkkkPp.', '..PPPPPPp.', '..PkkPPPp.', '..PPPPrPp.', '.wPPPPPPw.', 'wwwwwwwwww'] },
    wing: { pal: { w: '#e7edf7', d: '#8593ab', y: '#5fd4ff' }, rows: [
      '......ww', '....wwwd', '..wwwwd.', '.wwwwd..', 'wwwdd...', 'yyyyyyyy', '.yy..yy.'] },
    kite: { pal: { r: '#c8453a', R: '#ff7a5a', y: '#f2c94c', k: '#3a2a20' }, rows: [
      '...R...', '..RRr..', '.RRyrr.', 'RRyyyrr', '.rryrr.', '..rrr..', '...k...', '..k....', '...k...'] },
    blimp: { pal: { p: '#ff5fb0', P: '#ff9ad0', c: '#3ef0ff', k: '#2b2633' }, rows: [
      '..pppppp..', '.pPPpppppp', 'pPPppppppc', 'pppppppppc', '.pppppppp.', '...kkkk...', '...kcck...'] },
    ship: { pal: { s: '#f3e8d2', S: '#c9bfa8', w: '#9b6b3d', W: '#c08a52', k: '#3a2416', b: '#63b4e6' }, rows: [
      '....k.....', '...sk.....', '..ssk.....', '.sSsk.....', 'sssSkb....', '....k.....', 'WWWWWWWWW.', '.wwwwwwww.', '..kkkkkk..'] },
    cart: { pal: { g: '#7a7a84', G: '#9a9aa4', y: '#f2c94c', Y: '#ffe07a', k: '#2b2633' }, rows: [
      '..yYyy...', '.yyyyyy..', 'GGGGGGGGG', 'gggggggg.', '.gggggg..', '.k....k..', 'kkkkkkkkk'] },
    crystal: { pal: { c: '#b7a6ff', C: '#e2dcff', d: '#6f5bd0' }, rows: [
      '..C..', '.CCc.', '.Ccc.', 'CCccd', 'Cccdd', '.ccd.', '..d..'] },
    holo: { pal: { c: 'rgba(95,212,255,0.85)', C: '#c8f5ff', k: '#e8fbff', d: '#1b6f99' }, rows: [
      '..dccd..', '.dcCCcd.', '.ckcckc.', '.cccccc.', '..cddc..', '...cc...', '.dcccccd', 'dccCCccd'] },
  };
  const iconCache = {};
  function iconURL(name) {
    if (own(iconCache, name)) return iconCache[name];
    const ic = pick(ICONS, name);
    if (!ic) return '';
    const w = Math.max(...ic.rows.map((r) => r.length)), h = ic.rows.length;
    const c = cnv(w, h);
    drawRows(c.getContext('2d'), ic.rows, 0, 0, ic.pal);
    iconCache[name] = { url: c.toDataURL(), w, h };
    return iconCache[name];
  }
  function icon(name, scale = 2, alt = '') {
    const ic = iconURL(name);
    if (!ic) return '';
    return `<img class="ico" src="${ic.url}" width="${ic.w * scale}" height="${ic.h * scale}" alt="${esc(alt)}"${alt ? '' : ' aria-hidden="true"'}>`;
  }

  /* -------------------------------------------------------------- portraits
   * 16x16 head-and-shoulders sprites on a 20x20 backdrop, lit from the top-left. J.A.R.V.I.S. is a
   * translucent cyan hologram with scan lines. */
  const OUT = '#1d1a24';
  const SKIN = { s: '#f2c9a0', S: '#d9a273', e: OUT, m: '#a0524a', n: '#e8ad86' };
  const PORTRAITS = {
    hub: { holo: true, pal: { d: 'rgba(27,111,153,0.95)', c: 'rgba(95,212,255,0.78)', h: '#c8f5ff', e: '#ffffff', m: 'rgba(27,111,153,0.95)' }, rows: [
      '................',
      '.....dddddd.....',
      '....dchhcccd....',
      '...dchccccccd...',
      '...dccccccccd...',
      '...dceecceecd...',
      '...dccccccccd...',
      '...dcccmmcccd...',
      '....dccccccd....',
      '.....dccccd.....',
      '......dccd......',
      '..dccccccccccd..',
      '.dcchccccccchcd.',
      '.dccccchhcccccd.',
      '.dccccccccccccd.',
      '.dccccccccccccd.'] },
    'academic-core': { pal: Object.assign({}, SKIN, { o: OUT, h: '#fbe0bf', J: '#3f8f78', j: '#6cc0a0', Y: '#e89a2f', y: '#f7c35a', b: '#7a4a22' }), rows: [
      '................', '......oooo......', '.....oshhso.....', '....oshhssso....', '....osssssso....', '....osssssso....', '....oseSSeso....', '....osssssso....',
      '....oSsmmsSo....', '.....oSSSSo.....', '...ojJYYYYJJo...', '..ojJJbYYYJJJo..', '..oJJJJbYYJJJo..', '..oJJJYYbYJJJo..', '..oJJJYYYbJJJo..', '..oJJJYYYYbJJo..'] },
    'ledger-fi': { pal: Object.assign({}, SKIN, { o: OUT, Y: '#e8b75a', y: '#9c7433', L: '#fff6c8', l: '#ffe07a', C: '#c8642f', c: '#e8894a', b: '#f2c94c', G: '#5e6b3a', g: '#7d8a4c', K: '#4a3020', k: '#f2c94c' }), rows: [
      '................', '......oooo......', '.....oYLLYo.....', '....oYYllYYo....', '...oyyyyyyyyo...', '....osssssso....', '....oseSSeso....', '....oSsnnsSo....',
      '....ocCCCCco....', '...oCcCCCCcCo...', '..ogGCCbbCCGGo..', '..oGGGCbbCGGGo..', '..oGGGGCCGGGGo..', '..oKKKKkkKKKKo..', '..oGGGGGGGGGGo..', '..oGGGGGGGGGGo..'] },
    'social-ops': { pal: Object.assign({}, SKIN, { o: OUT, P: '#6b3fb0', p: '#9b6bff', H: '#3ef0ff', h: '#1d8fa0', N: '#ff4fa3', n: '#c22a78', C: '#3ef0ff', k: '#2b2633', l: '#9fffff' }), rows: [
      '................', '.....oooooo.....', '....oPpppPPo....', '...oPpPPPPPPo...', '..oHoPPPPPPoHo..', '..oHosssssPoHo..', '..ohosessesoho..', '....osssssso....',
      '....oSsmmsSo....', '.....oSSSSo.....', '...oNNnCCnNNo...', '..oNNNnCCnNNNo..', '..oNNNkkkkNNNo..', '..oNNNklkkNNNo..', '..oNNNkkkkNNNo..', '..oNNNnCCnNNNo..'] },
    'hustle-engine': { pal: Object.assign({}, SKIN, { o: OUT, T: '#3a2a4a', t: '#55406a', G: '#e8b75a', b: '#7a4a22', R: '#c8453a', W: '#f3e8d2', f: '#ff4fa3', F: '#3ef0ff' }), rows: [
      '................', '......oooo......', '..oooottttoooo..', '.oTTTTTGTTTTTTo.', '..ooTTTTTTTToo..', '....osssssso....', '....oseSSeso....', '....osssssso....',
      '....oSbmmbSo....', '.....obbbbo.....', '...oRWRWRWRWo...', '..oRWRWRWRWRWo..', '..oRWRWRWRWRWo..', '..oRWRWRWRWfFf..', '..oRWRWRWRWRfo..', '..oRWRWRWRWfFf..'] },
    hudson: { pal: Object.assign({}, SKIN, { o: OUT, H: '#6a4426', h: '#8a5a32', D: '#3f6fb0', d: '#5a8fd0', w: '#f3e8d2' }), rows: [
      '................', '.....oooooo.....', '....oHhhHHHo....', '...oHhHHHHHHo...', '...oHHsssssHo...', '....osssssso....', '....oseSSeso....', '....osssssso....',
      '....oSsmmsSo....', '.....oSSSSo.....', '...odDDwwDDDo...', '..odDDDwwDDDDo..', '..oDDDDDDDDDDo..', '..oDDdddddDDDo..', '..oDDDDDDDDDDo..', '..oDDDDDDDDDDo..'] },
    folk: { pal: Object.assign({}, SKIN, { o: OUT, W: '#f7f2e8', w: '#d6cdbd', H: '#8a5a32', A: '#e9e2d4', a: '#bdb3a2', G: '#5a8a5a' }), rows: [
      '.....oooooo.....', '....oWWWWWWo....', '....oWWWWwWo....', '.....owwwwo.....', '....oHsssHHo....', '....osssssso....', '....oseSSeso....', '....osssssso....',
      '....oSsmmsSo....', '.....oSSSSo.....', '...oGGAAAAGGo...', '..oGGAAAAAAGGo..', '..oGGAAAAAAGGo..', '..oGGAaaaaAGGo..', '..oGGAAAAAAGGo..', '..oGGAAAAAAGGo..'] },
    cat: { pal: { o: OUT, G: '#e0893a', g: '#b86424', w: '#f7f2e8', y: '#8ad17a', p: '#ff9ab0', k: OUT }, rows: [
      '................', '...oo......oo...', '...oGo....oGo...', '...oGGooooGGo...', '...oGGGGGGGGo...', '..oGGgGGGGgGGo..', '..oGykGGGGykGo..', '..oGGGGGGGGGGo..',
      '..owGGGppGGGwo..', '...owwGGGGwwo...', '....oogggoo.....', '...oGGGGGGGGo...', '..oGgGGwwGGgGo..', '..oGGgGwwGgGGo..', '..oGGGGwwGGGGo..', '..oGGGGwwGGGGo..'] },
  };
  const portraitCache = {};
  function portraitURL(who, theme) {
    const key = who + '|' + theme;
    if (own(portraitCache, key)) return portraitCache[key];
    const p = pick(PORTRAITS, who) || PORTRAITS.folk;
    const base = (pick(THEME, theme) || THEME.square).color;
    const c = cnv(20, 20), g = c.getContext('2d');
    const ground = '#0b111d';
    const dark = S.color.mix(base, ground, 0.8), mid = S.color.mix(base, ground, 0.66), lite = S.color.mix(base, ground, 0.5);
    g.fillStyle = dark; g.fillRect(0, 0, 20, 20);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
      const d = x + y;
      if (d < 12 || (d < 18 && ((x + y) & 1) === 0)) { g.fillStyle = d < 8 ? lite : mid; g.fillRect(x, y, 1, 1); }
    }
    if (p.holo) {
      // projector glow under the figure and a soft halo
      g.fillStyle = 'rgba(95,212,255,0.16)'; g.fillRect(4, 3, 12, 17); g.fillRect(2, 12, 16, 8);
      g.fillStyle = 'rgba(200,245,255,0.10)'; g.fillRect(6, 1, 8, 2);
      drawRows(g, p.rows, 2, 4, p.pal);
      // horizontal scan lines across the hologram
      g.fillStyle = 'rgba(5,8,15,0.32)';
      for (let y = 5; y < 20; y += 2) g.fillRect(2, y, 16, 1);
      g.fillStyle = 'rgba(200,245,255,0.35)'; g.fillRect(3, 11, 14, 1);
    } else {
      g.fillStyle = S.color.rgba(base, 0.22);
      g.fillRect(5, 3, 10, 9); g.fillRect(4, 4, 12, 7);
      g.fillStyle = 'rgba(5,8,15,0.45)';
      for (let j = 0; j < p.rows.length; j++) for (let i = 0; i < p.rows[j].length; i++) if (p.pal[p.rows[j][i]]) g.fillRect(3 + i, 5 + j, 1, 1);
      drawRows(g, p.rows, 2, 4, p.pal);
    }
    portraitCache[key] = c.toDataURL();
    return portraitCache[key];
  }
  const whoFor = (agent) => (own(PORTRAITS, agent) ? agent : 'folk');

  /* ----------------------------------------------------------- header banners
   * A little pixel vignette per island, drawn once, shown at 2x behind the drawer header. */
  const bannerCache = {};
  function bannerURL(theme) {
    if (own(bannerCache, theme)) return bannerCache[theme];
    const W = 204, H = 36, OX = 30, X0 = -OX, X1 = W - OX, c = cnv(W, H), g = c.getContext('2d');
    const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x | 0, y | 0, w | 0, h | 0); };
    const hash = (x, y, s) => S.hash(x, y, s);
    const bands = (cols, y0, bh) => {
      cols.forEach((col, i) => R(X0, y0 + i * bh, W, bh, col));
      for (let i = 1; i < cols.length; i++) { g.fillStyle = cols[i]; for (let x = X0 + (i & 1); x < X1; x += 2) g.fillRect(x, y0 + i * bh - 1, 1, 1); }
    };
    const stars = (n, yMax, s) => { for (let i = 0; i < n; i++) { const x = X0 + ((hash(i, 1, s) * W) | 0), y = (hash(i, 2, s) * yMax) | 0; R(x, y, 1, 1, hash(i, 3, s) > 0.7 ? '#e8f0ff' : 'rgba(232,240,255,0.5)'); } };
    const lantern = (x, y, col, glow) => {
      R(x, y - 3, 1, 3, '#3a2a20');
      g.fillStyle = S.color.rgba(glow, 0.18); g.fillRect(x - 4, y - 2, 9, 10); g.fillRect(x - 3, y - 3, 7, 12);
      R(x - 2, y, 5, 6, col); R(x - 1, y + 1, 1, 3, S.color.shade(col, 0.45)); R(x - 2, y, 5, 1, '#3a2a20'); R(x - 2, y + 6, 5, 1, '#3a2a20'); R(x, y + 7, 1, 1, '#e8b75a');
    };
    g.translate(OX, 0);
    switch (theme) {
      case 'monastery': {
        bands(['#0a1420', '#0e1a28', '#122230', '#172a36', '#1c323c'], 0, 6);
        stars(18, 14, 3);
        R(-12, 4, 5, 5, '#e8f0ff'); R(-13, 5, 7, 3, '#e8f0ff'); R(-10, 4, 3, 4, '#b6c2d6');
        for (let x = X0; x < X1; x++) { const h = 13 + Math.round(Math.sin(x * 0.07) * 5 + Math.sin(x * 0.19 + 2) * 3); R(x, H - h, 1, h, '#22363e'); R(x, H - h, 1, 1, '#41606a'); }
        for (let x = X0; x < X1; x++) { const h = 7 + Math.round(Math.sin(x * 0.11 + 4) * 3 + Math.sin(x * 0.31) * 1.5); R(x, H - h, 1, h, '#172a28'); if (hash(x, 0, 9) > 0.6) R(x, H - h, 1, 1, '#2a453b'); }
        const px0 = 120;
        R(px0 + 4, 20, 14, 18, '#7a3a2c'); R(px0 + 6, 22, 2, 16, '#c8453a'); R(px0 + 14, 22, 2, 16, '#c8453a'); R(px0 + 9, 25, 4, 13, '#2a1a14');
        R(px0 + 9, 26, 4, 3, '#ffb84d');
        R(px0, 17, 22, 3, '#2f6f5c'); R(px0 - 2, 19, 3, 1, '#2f6f5c'); R(px0 + 21, 19, 3, 1, '#2f6f5c'); R(px0 + 1, 16, 20, 1, '#86d0b0'); R(px0 + 3, 13, 16, 3, '#3f8f78');
        R(px0 + 5, 8, 12, 5, '#7a3a2c'); R(px0 + 3, 7, 16, 2, '#2f6f5c'); R(px0 + 4, 6, 14, 1, '#86d0b0'); R(px0 + 1, 8, 2, 1, '#2f6f5c'); R(px0 + 19, 8, 2, 1, '#2f6f5c');
        R(px0 + 10, 2, 2, 4, '#e8b75a');
        lantern(100, 12, '#ff9a3a', '#ffb84d'); lantern(146, 14, '#ff7a50', '#ff9a50');
        g.fillStyle = '#3a2a20'; for (let x = 92; x < 152; x++) g.fillRect(x, 8 + Math.round(Math.sin((x - 92) / 60 * Math.PI) * 3), 1, 1);
        const fl = ['#c8453a', '#f2c94c', '#86d0b0', '#63b4e6', '#f3e8d2'];
        for (let i = 0; i < 7; i++) R(60 + i * 7, 4 + (i % 2), 3, 4, fl[i % 5]);
        break;
      }
      case 'mine': {
        bands(['#2a1a10', '#36220f', '#432b16', '#52351b', '#5f3e22', '#684427'], 0, 6);
        for (let y = 0; y < H; y++) for (let x = X0; x < X1; x++) { const v = hash(x, y, 4); if (v > 0.93) R(x, y, 1, 1, 'rgba(0,0,0,0.25)'); else if (v < 0.04) R(x, y, 1, 1, 'rgba(255,220,170,0.14)'); }
        for (const [x, y] of [[96, 6], [118, 14], [140, 7], [104, 24], [150, 22]]) { R(x, y, 3, 2, '#c4952b'); R(x + 1, y, 1, 1, '#f2c94c'); R(x, y - 1, 1, 1, '#fff6c8'); R(x - 1, y, 1, 1, '#fff6c8'); }
        R(110, 8, 4, 30, '#6b4424'); R(111, 8, 1, 30, '#8a5a32'); R(146, 8, 4, 30, '#6b4424'); R(147, 8, 1, 30, '#8a5a32');
        R(106, 5, 48, 4, '#7a4f2a'); R(106, 5, 48, 1, '#a06a3a'); R(114, 9, 32, 29, '#140c08');
        g.fillStyle = 'rgba(255,184,77,0.2)'; g.fillRect(124, 14, 12, 12); R(129, 9, 2, 3, '#3a2a20'); R(128, 12, 4, 3, '#ffb84d');
        R(X0, 31, W, 1, '#5a5a62'); R(X0, 34, W, 1, '#5a5a62');
        for (let x = X0 + 2; x < X1; x += 5) R(x, 30, 2, 5, '#4a3020');
        R(70, 24, 20, 8, '#5a5a62'); R(71, 25, 18, 6, '#7a7a84'); R(70, 24, 20, 1, '#9a9aa4'); R(72, 21, 16, 4, '#f2c94c'); R(74, 20, 4, 1, '#ffe07a'); R(80, 21, 1, 1, '#fff6c8');
        R(73, 32, 3, 3, '#2b2633'); R(84, 32, 3, 3, '#2b2633');
        break;
      }
      case 'market': {
        bands(['#080c1c', '#0c1024', '#11142c', '#161834', '#1c1c3c'], 0, 7);
        stars(14, 16, 7);
        for (const [x, w, h, col] of [[84, 18, 14, '#1d1c38'], [104, 22, 18, '#181832'], [128, 16, 12, '#1d1c38'], [146, 14, 20, '#181832']]) { R(x, H - h, w, h, col); R(x, H - h, w, 1, '#3a3a68'); }
        // creator-studio sign: a camera in neon
        R(104, 21, 22, 9, '#0c1024'); R(104, 21, 22, 1, '#ff4fa3'); R(104, 29, 22, 1, '#ff4fa3'); R(104, 21, 1, 9, '#ff4fa3'); R(125, 21, 1, 9, '#ff4fa3');
        R(108, 23, 9, 5, '#3ef0ff'); R(109, 24, 7, 3, '#0c1024'); R(111, 24, 3, 3, '#3ef0ff'); R(117, 24, 3, 3, '#3ef0ff'); R(121, 23, 2, 2, '#ffe07a');
        g.fillStyle = 'rgba(255,79,163,0.16)'; g.fillRect(102, 19, 26, 13);
        const bulbs = ['#ff4fa3', '#3ef0ff', '#ffe07a', '#9b6bff', '#8ad17a'];
        for (let x = X0; x < X1; x++) { const u = x - X0, y = 6 + Math.round(Math.abs(Math.sin(u / 25 * Math.PI)) * 6); R(x, y, 1, 1, '#2e2e52'); if (u % 8 === 3) { const b = bulbs[(u / 8 | 0) % 5]; R(x, y + 1, 1, 2, b); } }
        R(150, 2, 1, 20, '#7a7aa8'); R(148, 8, 5, 1, '#7a7aa8'); R(147, 14, 7, 1, '#7a7aa8'); R(149, 0, 3, 2, '#ff4fa3');
        break;
      }
      case 'port': {
        bands(['#0c1830', '#102038', '#142842', '#18304c'], 0, 6);
        stars(12, 18, 11);
        for (let x = X0; x < X1; x++) { const h = 6 + Math.round(Math.sin(x * 0.09 + 1) * 2 + Math.sin(x * 0.23) * 1.5); R(x, H - h, 1, h, '#44587a'); R(x, H - h, 1, 1, '#6f86aa'); }
        for (let x = 52; x < 100; x++) { const d = Math.min(x - 52, 100 - x); const h = Math.min(9, 2 + (d >> 1)); R(x, 26, 1, h, x % 3 ? '#6b5640' : '#57452f'); }
        R(50, 23, 52, 3, '#5d8a3e'); R(50, 23, 52, 1, '#86b85a');
        R(84, 20, 30, 3, '#9b6b3d'); R(84, 20, 30, 1, '#c08a52'); for (let x = 88; x < 114; x += 8) R(x, 23, 2, 5, '#74502c');
        R(66, 12, 10, 11, '#d9cdb4'); R(65, 10, 12, 3, '#3b5b7a'); R(69, 16, 3, 3, '#ffd27a');
        const sx = 122;
        R(sx + 4, 6, 30, 7, '#c8453a'); R(sx + 2, 7, 34, 5, '#c8453a'); R(sx + 5, 6, 28, 1, '#ff7a5a'); R(sx + 4, 9, 30, 1, '#f3e8d2');
        R(sx + 10, 13, 1, 6, '#3a2416'); R(sx + 28, 13, 1, 6, '#3a2416');
        R(sx, 19, 40, 6, '#5a3a24'); R(sx + 2, 25, 36, 2, '#3a2416'); R(sx, 19, 40, 1, '#8a5a32'); R(sx + 1, 22, 38, 1, '#63b4e6');
        R(sx + 8, 15, 6, 4, '#c08a52'); R(sx + 16, 15, 6, 4, '#63b4e6'); R(sx + 24, 15, 6, 4, '#c08a52');
        g.fillStyle = 'rgba(255,255,255,0.12)'; for (let i = 0; i < 4; i++) g.fillRect(sx - 6 - i * 7, 21 + (i & 1), 5, 1);
        for (const [x, y] of [[30, 8], [40, 12]]) { R(x, y, 2, 1, '#e8f0ff'); R(x + 3, y, 2, 1, '#e8f0ff'); R(x + 2, y + 1, 1, 1, '#e8f0ff'); }
        break;
      }
      default: { // square
        bands(['#060a14', '#081020', '#0b1528', '#0e1a30'], 0, 6);
        stars(14, 14, 19);
        for (let y = 26; y < H; y += 4) for (let x = X0 + ((y / 4) & 1) * 3; x < X1; x += 6) { R(x, y, 5, 3, '#5d6270'); R(x, y, 5, 1, '#7d8290'); R(x + 4, y + 1, 1, 2, '#4a4f5c'); }
        R(X0, 25, W, 1, '#3a4054');
        for (const lx of [12, 60, 154]) { g.fillStyle = 'rgba(255,210,122,0.10)'; g.fillRect(lx - 6, 10, 13, 16); g.fillRect(lx - 4, 8, 9, 20); R(lx, 14, 1, 12, '#2b2633'); R(lx - 1, 11, 3, 3, '#ffd27a'); R(lx - 1, 10, 3, 1, '#2b2633'); R(lx - 1, 25, 3, 1, '#2b2633'); }
        const tx = 92;
        R(tx + 1, 8, 20, 30, '#8e8882'); R(tx + 1, 8, 2, 30, '#bdb7ae'); R(tx + 19, 8, 2, 30, '#6f6a66');
        for (let y = 10; y < 36; y += 4) R(tx + 3, y, 16, 1, '#7d7873');
        for (let i = 0; i < 7; i++) R(tx + 1 + Math.round(i * 1.5), 7 - i, 20 - i * 3, 1, i < 2 ? '#3b5b7a' : '#4a6f92');
        R(tx + 10, -1, 2, 2, '#e8b75a');
        R(tx + 5, 11, 12, 12, '#c4952b'); R(tx + 6, 12, 10, 10, '#fff3c4'); R(tx + 6, 12, 10, 1, '#ffffff'); R(tx + 10, 13, 2, 5, OUT); R(tx + 11, 16, 4, 2, OUT);
        R(tx + 7, 28, 8, 10, '#2a1d16'); R(tx + 7, 28, 8, 1, '#5a3a24');
        // the holo-console with J.A.R.V.I.S. projected above it
        const hx = 130;
        R(hx, 30, 10, 6, '#2a3852'); R(hx, 30, 10, 1, '#5fd4ff'); R(hx + 3, 29, 4, 1, '#c8f5ff');
        g.fillStyle = 'rgba(95,212,255,0.12)'; g.fillRect(hx - 2, 10, 14, 19); g.fillRect(hx + 1, 6, 8, 4);
        g.fillStyle = 'rgba(95,212,255,0.75)'; g.fillRect(hx + 3, 9, 4, 4); g.fillRect(hx + 2, 14, 6, 6); g.fillRect(hx + 1, 15, 8, 3);
        g.fillStyle = '#e8fbff'; g.fillRect(hx + 3, 10, 1, 1); g.fillRect(hx + 6, 10, 1, 1);
        g.fillStyle = 'rgba(5,8,15,0.35)'; for (let y = 9; y < 21; y += 2) g.fillRect(hx + 1, y, 8, 1);
        // request board with pinned notes
        R(58, 18, 22, 10, '#7a5230'); R(58, 18, 22, 1, '#a06a3a'); R(60, 28, 2, 8, '#5a3a24'); R(76, 28, 2, 8, '#5a3a24');
        for (const [nx, nc] of [[61, '#f3e8d2'], [67, '#ffe3b0'], [73, '#f3e8d2']]) { R(nx, 20, 4, 5, nc); R(nx + 1, 20, 1, 1, '#c8453a'); }
        break;
      }
    }
    bannerCache[theme] = c.toDataURL();
    return bannerCache[theme];
  }

  /* ================================================================ time
   * Everything is New York time. A "day" is a key = Date.UTC(y, m - 1, d) of the NY calendar date. */
  const fmtClock = new Intl.DateTimeFormat('en-US', { timeZone: NY, hour: 'numeric', minute: '2-digit', hour12: true });
  const fmtLongToday = new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'long', month: 'long', day: 'numeric' });
  const fmtUTCDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  const fmtUTCDayY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const fmtUTCMonth = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const fmtUTCShort = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const fmtUTCShortY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  const fmtUTCMonthY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const fmtUTCWeekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' });
  const fmtUTCWd = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' });
  const DAY = 864e5;
  const nyNow = () => S.nyParts(S.now());
  const dayKeyOf = (p) => Date.UTC(p.year, p.month - 1, p.day);
  const todayKey = () => dayKeyOf(nyNow());
  const dayDate = (k) => new Date(k + DAY / 2);
  const isoDay = (k) => dayDate(k).toISOString().slice(0, 10);
  const clockOf = (ms) => fmtClock.format(new Date(ms));
  function clockParts(d) {
    const s = fmtClock.format(d);
    const m = s.match(/^(\d+:\d+)\s*([AP]M)$/i);
    return m ? { hm: m[1], ap: m[2].toUpperCase() } : { hm: s, ap: '' };
  }
  /** NY wall-clock time to a UTC instant (ms), correct across DST changes. */
  function nyLocalToUtc(y, mo, d, hh, mm) {
    const want = Date.UTC(y, mo - 1, d, hh, mm);
    let t = want;
    for (let i = 0; i < 3; i++) {
      const q = S.nyParts(new Date(t));
      const got = Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute);
      if (got === want) break;
      t += want - got;
    }
    return t;
  }
  /** A date or time string as {allDay, day, at}: 'YYYY-MM-DD' (all day), an ISO time with an offset, or a
   * zone-less 'YYYY-MM-DDTHH:MM' (New York wall-clock time). null when it isn't a date. */
  function parseWhen(s) {
    if (typeof s !== 'string' || !s) return null;
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 ? { allDay: true, day: Date.UTC(+m[1], +m[2] - 1, +m[3]), at: null } : null;
    m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(s);
    if (m) { const at = nyLocalToUtc(+m[1], +m[2], +m[3], +m[4], +m[5]); return { allDay: false, day: Date.UTC(+m[1], +m[2] - 1, +m[3]), at }; }
    const d = new Date(s);
    if (isNaN(d)) return null;
    return { allDay: false, day: dayKeyOf(S.nyParts(d)), at: d.getTime() };
  }
  const daysFrom = (day, today) => Math.round((day - (today == null ? todayKey() : today)) / DAY);
  function daysUntil(s) { const p = parseWhen(s); return p ? daysFrom(p.day) : null; }
  /** "Tue, Oct 13" (with the year when it isn't this year). */
  function dayLabel(s) {
    const p = parseWhen(s);
    if (!p) return '';
    const y = new Date(p.day).getUTCFullYear();
    const base = (y !== nyNow().year ? fmtUTCDayY : fmtUTCDay).format(dayDate(p.day));
    return p.allDay ? base : `${base}, ${clockOf(p.at)}`;
  }
  /** A due date in words: "Overdue · 2 days", "Today", "Tomorrow", "Wed", "Oct 30". */
  function dueWord(day) {
    const n = daysFrom(day);
    if (n < 0) return `Overdue · ${plural(-n, 'day')}`;
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n < 7) return fmtUTCWd.format(dayDate(day));
    const y = new Date(day).getUTCFullYear();
    if (n > 60) return 'By ' + (y !== nyNow().year ? fmtUTCMonthY : fmtUTCMonth).format(dayDate(day)).replace(/ \d{4}$/, (x) => (y !== nyNow().year ? x : ''));
    return (y !== nyNow().year ? fmtUTCShortY : fmtUTCShort).format(dayDate(day));
  }
  const dueTone = (day) => { const n = daysFrom(day); return n < 0 ? 'now' : n === 0 ? 'soon' : ''; };
  const dueChip = (s) => { const p = parseWhen(s); return p ? `<span class="when ${dueTone(p.day)}">${esc(dueWord(p.day))}</span>` : '<span class="when">—</span>'; };
  /** When something happened, in plain words: "just now", "12 min ago", "3h ago", "yesterday 11:14 AM",
   * "Sat 11:14 AM", "Jun 15". A time slightly ahead of this device's clock reads "just now". */
  function relPast(s) {
    const p = parseWhen(s);
    if (!p) return '';
    const today = todayKey(), n = daysFrom(p.day, today);
    if (p.allDay) return n === 0 ? 'today' : n === -1 ? 'yesterday' : n < 0 && n > -7 ? fmtUTCWeekday.format(dayDate(p.day)) : fmtUTCShort.format(dayDate(p.day));
    const ms = S.now().getTime() - p.at;
    if (ms < 60e3 && ms > -10 * 60e3) return 'just now';
    if (ms < 0) return n === 0 ? 'today ' + clockOf(p.at) : fmtUTCShort.format(dayDate(p.day));
    if (ms < 3600e3) return `${Math.round(ms / 60e3)} min ago`;
    if (n === 0) return `${Math.round(ms / 3600e3)}h ago`;
    if (n === -1) return 'yesterday ' + clockOf(p.at);
    if (n > -7) return fmtUTCWd.format(dayDate(p.day)) + ' ' + clockOf(p.at);
    const y = new Date(p.day).getUTCFullYear();
    return (y !== nyNow().year ? fmtUTCShortY : fmtUTCShort).format(dayDate(p.day));
  }
  /** "6:18 AM" today, "yesterday 7:33 PM", "Mon 7:33 PM", "Oct 2, 7:33 PM". */
  function clockWhen(ms) {
    const day = dayKeyOf(S.nyParts(new Date(ms))), n = daysFrom(day);
    const t = clockOf(ms);
    if (n === 0) return ms > S.now().getTime() + 60e3 ? 'today ' + t : t;
    if (n === -1) return 'yesterday ' + t;
    if (n === 1) return 'tomorrow ' + t;
    if (n > -7 && n < 7) return fmtUTCWeekday.format(dayDate(day)) + ' ' + t;
    return fmtUTCShort.format(dayDate(day)) + ', ' + t;
  }
  function dur(ms) {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m >= 10) return `${m}m`;
    return `${m}m ${String(sec).padStart(2, '0')}s`;
  }
  function money(n, dp) {
    const v = num(n);
    if (v == null) return '—';
    const d = dp != null ? dp : (Math.abs(v % 1) > 0.001 ? 2 : 0);
    return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  /** Rounded only from $1,000 up; below that the exact amount ("$94.50"). */
  function moneyShort(n) {
    const v = num(n);
    if (v == null) return '—';
    if (Math.abs(v) >= 10000) return (v < 0 ? '-$' : '$') + (Math.abs(v) / 1000).toFixed(1) + 'k';
    if (Math.abs(v) >= 1000) return money(Math.round(v), 0);
    return money(v);
  }

  /* ============================================================== check-ins */
  function cycleTimes() {
    return objs(D().cycles).map((c) => /^(\d{1,2}):(\d{2})$/.exec(String(c.local_time || '').trim())).filter(Boolean)
      .map((x) => ({ h: +x[1], m: +x[2] })).filter((c) => c.h < 24 && c.m < 60).sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));
  }
  const clock12 = (c) => `${((c.h + 11) % 12) + 1}:${String(c.m).padStart(2, '0')} ${c.h < 12 ? 'AM' : 'PM'}`;
  /** The next check-in (New York time) on a day matching ok(dow, dayOfMonth), within ~6 weeks:
   * {c, days, date, running}. One that began less than 45 minutes ago counts as still running. */
  function nextCycleOn(ok) {
    const list = cycleTimes();
    if (!list.length) return null;
    const p = nyNow(), nowMin = p.hour * 60 + p.minute, base = dayKeyOf(p);
    for (let d = 0; d <= 42; d++) {
      const date = new Date(base + d * DAY);
      if (!ok(date.getUTCDay(), date.getUTCDate())) continue;
      for (const c of list) {
        const at = c.h * 60 + c.m;
        if (d > 0 || at > nowMin) return { c, days: d, date, running: false };
        if (nowMin - at < 45) return { c, days: 0, date, running: true };
      }
    }
    return null;
  }
  /** The next check-in as {at (ms), name}: the core's clock, else the state's next_cycle, else the config. */
  function nextCheckIn() {
    const now = S.now().getTime();
    const c = S.cycle && S.cycle.next;
    if (c && c.at && typeof c.at.getTime === 'function' && c.at.getTime() > now) return { at: c.at.getTime(), name: c.name };
    const nc = rec(D().next_cycle), p = parseWhen(nc.at);
    if (p && p.at && p.at > now) return { at: p.at, name: str(nc.name) };
    const n = nextCycleOn(() => true);
    if (n && !n.running) { const dd = n.date; return { at: nyLocalToUtc(dd.getUTCFullYear(), dd.getUTCMonth() + 1, dd.getUTCDate(), n.c.h, n.c.m), name: '' }; }
    return null;
  }
  const lastCheckIn = () => { const c = S.cycle && S.cycle.last; return c && c.at && typeof c.at.getTime === 'function' ? c.at.getTime() : null; };
  function countdownText() {
    const c = S.cycle || {};
    if (c.ceremony) return c.ceremony.name === 'manual' ? 'replaying' : 'in progress';
    const n = nextCheckIn();
    return n ? 'in ' + dur(n.at - S.now().getTime()) : 'no schedule';
  }
  /** "today's 6:15 AM check-in", "tomorrow's ...", "Sunday's ...", "the ... check-in on Nov 1". */
  function cyclePhrase(n) {
    const t = clock12(n.c);
    if (n.days === 0) return `today’s ${t} check-in`;
    if (n.days === 1) return `tomorrow’s ${t} check-in`;
    if (n.days < 7) return `${fmtUTCWeekday.format(n.date)}’s ${t} check-in`;
    if (n.days === 7) return `next ${fmtUTCWeekday.format(n.date)}’s ${t} check-in`;
    return `the ${t} check-in on ${fmtUTCShort.format(n.date)}`;
  }

  /* =========================================================== html helpers */
  const sec = (title, body, opts = {}) => `<section class="sec"${opts.id ? ` id="${opts.id}"` : ''}><h3 class="sec-h">${opts.icon ? icon(opts.icon, 2) : ''}<span>${esc(title)}</span>${opts.n != null ? `<span class="n">${esc(opts.n)}</span>` : ''}</h3>${body}</section>`;
  const emptyBox = (msg, ic = 'mist') => `<p class="empty">${icon(ic, 2)}<span>${esc(msg)}</span></p>`;
  const tiles = (list, cols) => `<div class="tiles" style="--cols:${cols || list.length}">${list.map((t) => `<div class="tile ${t.tone || ''}"><span class="k">${esc(t.k)}</span><span class="v${t.sm ? ' sm' : ''}">${t.v}</span>${t.s ? `<span class="s">${esc(t.s)}</span>` : ''}</div>`).join('')}</div>`;
  const bar = (p, tone, tall, tick) => `<span class="bar ${tone || ''}${tall ? ' tall' : ''}"><i style="--p:${(clamp(p, 0, 1) * 100).toFixed(1)}%"></i>${tick != null ? `<span class="tick" style="left:${(clamp(tick, 0, 1) * 100).toFixed(1)}%"></span>` : ''}</span>`;
  const pill = (txt, tone) => `<span class="pill ${tone || ''}">${esc(txt)}</span>`;
  const who = (agent) => { const a = agentInfo(agent); return a ? `<span class="who" style="--c:${colorOf(agent)}">${esc(a.short)}</span>` : ''; };
  const PHASE = {
    uninit: ['not started', 'mute'], idle: ['resting', 'mute'], plan: ['planning', 'info'], execute: ['working', 'brass'], verify: ['checking', 'info'],
    error: ['error', 'crit'], blocked: ['blocked', 'warn'], done: ['done', 'ok'], working: ['working', 'brass'],
  };
  const phasePill = (ph) => { const p = pick(PHASE, ph) || [str(ph) || 'unknown', 'mute']; return pill(p[0], p[1]); };
  const feedPill = (s, what) => (s === 'connected' ? pill(`${what} connected`, 'ok') : pill(`${what} ${str(s) || 'not connected'}`, 'mute'));

  /* =================================================================== data */
  const threadOf = (agent) => { try { return S.thread(agent) || null; } catch (e) { return null; } };
  const metricsOf = (agent) => { try { return rec(S.metrics(agent)); } catch (e) { return {}; } };
  const isWarn = (a) => !/^(info|notice|note)$/i.test(str(a.level));
  const allAlerts = () => objs(D().alerts).filter((a) => str(a.msg));
  const alertsFor = (agent) => allAlerts().filter((a) => agentOf(a.agent) === agent);
  const tasksFor = (agent) => objs(D().tasks).filter((t) => t.agent === agent && t.phase !== 'done');
  const humanTasks = () => objs(D().tasks).filter((t) => t.autonomy === 'human' && t.phase !== 'done' && str(t.id) && str(t.title));
  const goalFor = (agent) => objs(D().goals).find((g) => g.agent === agent);
  const savingsList = () => (objs(metricsOf('ledger-fi').savings).length ? objs(metricsOf('ledger-fi').savings) : objs(D().savings_goals));
  const savingsGoal = (name) => savingsList().find((s) => s.name === name) || null;
  const clientsCfg = () => objs(D().clients).filter((c) => str(c.name));
  const realClients = () => clientsCfg().filter((c) => c.type !== 'in-house');
  const clientMetric = (name) => { const n = str(name).toLowerCase().replace(/\s*\(.*\)$/, ''); return objs(metricsOf('social-ops').clients).find((c) => { const m = str(c.name).toLowerCase(); return m && (m === n || n.startsWith(m) || m.startsWith(n)); }) || null; };
  /** "free trial (sample package)" -> {main: 'Free trial', detail: 'sample package'}. */
  function statusParts(s) {
    const t = plain(str(s));
    const m = /^(.*?)\s*\((.*)\)\s*$/.exec(t);
    return { main: cap(m ? m[1] : t), detail: m ? m[2] : '' };
  }
  const metricoolAlert = () => alertsFor('social-ops').find((a) => /metricool/i.test(a.msg)) || null;
  const fidgetAdsStatus = () => str(rec(metricsOf('social-ops').store_ads).status) || str(rec(rec(D().store).ads).status);
  const fidgetLive = () => /^(active|running|live|on)$/i.test(fidgetAdsStatus());
  /** A link for an agent task: its own `link`, else the obvious one (Raw folder, Metricool) from real data. */
  function taskLink(t) {
    const l = linkIn('', t.link);
    if (l) return l;
    const title = str(t.title);
    if (t.agent !== 'social-ops') return null;
    if (/raw folder|footage|clips|shoot/i.test(title)) {
      const c = realClients().find((x) => str(x.raw_folder_url)) || null;
      if (c) { const r = linkIn('', c.raw_folder_url); if (r) return { url: r.url, label: 'Open Raw folder' }; }
    }
    if (/metricool/i.test(title)) { const a = metricoolAlert(); const r = a && linkIn(a.msg, a.link); if (r) return r; }
    return null;
  }

  /* ====================================================== shared fragments */
  function alertRow(a, showWho) {
    const crit = a.level === 'critical', info = !isWarn(a);
    const l = linkIn(a.msg, a.link), ag = agentOf(a.agent);
    return `<li class="row" style="--g:auto 1fr auto">${icon(info ? 'info' : crit ? 'alertCrit' : 'alert', 2)}<span><span class="t wrap" style="display:block">${esc(plain(a.msg) || 'Alert')}</span>${(showWho && ag) || l ? `<span class="chips" style="margin-top:5px">${showWho && ag ? who(ag) : ''}${extLink(l)}</span>` : ''}</span><span class="d">${esc(relPast(a.at))}</span></li>`;
  }
  /** Warnings as "Alerts" and info notices as "Heads-up", each with its own icon. */
  function alertsSection(list, opts = {}) {
    const warn = list.filter(isWarn), info = list.filter((a) => !isWarn(a));
    let out = '';
    if (warn.length) out += sec(opts.title || 'Alerts', `<ul class="rows">${warn.map((a) => alertRow(a, opts.who)).join('')}</ul>`, { n: warn.length, id: opts.id });
    if (info.length) out += sec('Heads-up', `<ul class="rows">${info.map((a) => alertRow(a, opts.who)).join('')}</ul>`, { n: info.length, id: warn.length ? null : opts.id });
    return out;
  }
  /** Tasks in plain English. Hudson's own (autonomy human) show a due chip and a "you" tag, never agent phases. */
  function taskRows(list) {
    return `<ul class="rows">${list.map((t) => {
      const you = t.autonomy === 'human';
      const done = you && checkDone(t.id);
      const due = parseWhen(t.due);
      const hint = plain(str(t.hint));
      const l = you ? taskLink(t) : null;
      const right = done ? pill('ticked', 'ok') : you ? (due ? `<span class="when ${dueTone(due.day)}">${esc(dueWord(due.day))}</span>` : '<span class="tag you">you</span>') : phasePill(t.phase);
      return `<li class="row${done ? ' done' : ''}" style="--g:1fr auto"><span class="t wrap">${esc(plain(t.title))}</span>${right}${hint || l || (you && due) ? `<span class="d full">${you && due ? '<span class="tag you">you</span> ' : ''}${esc(hint)}${l ? ' ' + extLink(l) : ''}</span>` : ''}</li>`;
    }).join('')}</ul>`;
  }
  function tasksSection(agent) {
    const list = tasksFor(agent).sort((a, b) => (a.autonomy === 'human' ? 0 : 1) - (b.autonomy === 'human' ? 0 : 1) || (num(a.priority) || 9) - (num(b.priority) || 9));
    const g = goalFor(agent);
    let body = '';
    if (g && str(g.title)) body += `<p class="note"><b>Goal:</b> ${esc(plain(g.title))}</p>`;
    body += list.length ? taskRows(list) : emptyBox('Nothing open here right now.', 'ok');
    return sec('Tasks', body, { n: list.length });
  }
  function threadHeader(agent) {
    const th = threadOf(agent) || {};
    const lr = th.last_run ? relPast(th.last_run) : 'never';
    const tl = [
      { k: 'Open', v: esc(num(th.pending) ?? 0), tone: th.pending ? 'accent' : 'mute', s: 'tasks' },
      { k: 'Blocked', v: esc(num(th.blocked) ?? 0), tone: th.blocked ? 'crit' : 'mute' },
      { k: 'Done', v: esc(num(th.done) ?? 0), tone: th.done ? 'ok' : 'mute' },
      { k: 'Last check-in', v: esc(lr), sm: true, tone: th.last_run ? '' : 'mute' },
    ];
    const inf = agentInfo(agent);
    const summary = summaryText(th.summary) || 'Waiting for the first check-in.';
    return tiles(tl, 4) + `<p class="summary">${esc(summary)}<small>${esc(inf.name)} · ${esc(inf.area())}</small></p>`;
  }
  function bubblesLine(agent) {
    const b = strs(rec(metricsOf(agent).world).bubbles).map(plain).filter(Boolean);
    if (!b.length) return '';
    return sec('Overheard on the island', `<div class="chips">${b.map((x) => `<span class="quote">“${esc(x)}”</span>`).join('')}</div>`);
  }
  /** One button per landmark on an island, so every map spot is reachable by keyboard. */
  function landmarkList(biome) {
    const keys = Object.keys(S.landmarks || {}).filter((k) => rec(S.landmarks[k]).island === biome);
    if (!keys.length) return '';
    return sec('On this island', `<div class="chips">${keys.map((k) => `<button class="btn small" data-act="landmark" data-arg="${esc(k)}">${esc(lmLabel(k))}</button>`).join('')}</div>`);
  }

  /* ========================================================= domain blocks */
  function deadlinesBlock(m, limit) {
    const list = objs(m.deadlines).map((d) => ({ d, p: parseWhen(d.due) })).filter((x) => x.p && daysFrom(x.p.day) >= -1).sort((a, b) => a.p.day - b.p.day);
    const shown = limit ? list.slice(0, limit) : list;
    const body = shown.length
      ? `<ul class="rows">${shown.map(({ d }) => `<li class="row" style="--g:62px 1fr auto">${dueChip(d.due)}<span><span class="t wrap" style="display:block">${esc(plain(d.title))}</span><span class="d">${esc(plain(d.course))}${d.course ? ' · ' : ''}${esc(dayLabel(d.due))}</span></span>${/quiz|test|exam/i.test(str(d.type) + ' ' + str(d.title)) ? `<span class="tag amber">${/test|exam/i.test(str(d.type) + str(d.title)) ? 'Test' : 'Quiz'}</span>` : ''}</li>`).join('')}</ul>`
      : emptyBox(m.classroom_feed === 'connected' ? 'No upcoming deadlines. The scroll board is clear.' : 'No deadlines yet. They appear once the Classroom feed is connected.', 'bird');
    return sec('Deadlines', body, { n: list.length, icon: 'pin' });
  }
  /** A study block is live from its start to its end (or an hour after the start). */
  function blockSpan(b) {
    const s = parseWhen(b.start);
    if (!s || !s.at) return null;
    const e = parseWhen(b.end);
    return { s, start: s.at, end: e && e.at && e.at > s.at ? e.at : s.at + 3600e3 };
  }
  function studyBlock(m) {
    const now = S.now().getTime();
    const list = objs(m.study_blocks).map((b) => ({ b, sp: blockSpan(b) })).filter((x) => x.sp && x.sp.end > now - DAY).sort((a, b) => a.sp.start - b.sp.start);
    const body = list.length
      ? `<ul class="rows">${list.map(({ b, sp }) => { const live = sp.start <= now && now < sp.end, past = sp.end <= now; return `<li class="row${live ? ' hl' : ''}${past ? ' done' : ''}" style="--g:110px 1fr auto"><span class="num" style="text-align:left;font-size:14px">${esc(clockWhen(sp.start))}</span><span class="t wrap">${esc(plain(b.title))}</span>${live ? pill('now', 'accent') : ''}</li>`; }).join('')}</ul>`
      : emptyBox('No study blocks on the calendar right now.');
    return sec('Study blocks', body, { n: list.length });
  }
  function prepBlock(m) {
    const list = objs(m.prep_sets).filter((s) => str(s.title));
    const body = list.length
      ? `<ul class="rows">${list.map((s) => `<li class="row" style="--g:1fr auto"><span class="t wrap">${esc(plain(s.title))}</span><span class="num">${num(s.cards) != null ? esc(plural(s.cards, 'card')) : ''}</span></li>`).join('')}</ul>`
      : emptyBox('No Quizlet sets yet. Abbot Quill writes one before each quiz or test.');
    return sec('Quizlet sets', body, { n: list.length });
  }
  function monthLabel(m) {
    const p = /^(\d{4})-(\d{2})$/.exec(m || '');
    return p ? fmtUTCMonth.format(new Date(Date.UTC(+p[1], +p[2] - 1, 15))) : 'This month';
  }
  /** True once Grit has real bank numbers: the feed is connected or real amounts have been tallied. */
  const moneyTracked = (m) => m.bank_feed === 'connected' || num(m.month_income) > 0 || num(m.month_spend) > 0;
  function moneyTiles(m) {
    if (!moneyTracked(m)) {
      return tiles(['Income', 'Spent', 'Net', 'Paychecks'].map((k) => ({ k, v: '—', tone: 'mute' })), 4)
        + `<p class="note">Not tracked yet. Turn on M&amp;T email alerts and Grit fills these in at the next money check-in.</p>`;
    }
    const inc = num(m.month_income), sp = num(m.month_spend);
    const net = inc != null && sp != null ? inc - sp : null;
    return tiles([
      { k: 'Income', v: esc(moneyShort(inc)), tone: inc ? 'ok' : 'mute' },
      { k: 'Spent', v: esc(moneyShort(sp)), tone: sp ? '' : 'mute' },
      { k: 'Net', v: esc(net == null ? '—' : (net > 0 ? '+' : '') + moneyShort(net)), tone: net == null || (!inc && !sp) ? 'mute' : net >= 0 ? 'accent' : 'crit' },
      { k: 'Paychecks', v: esc(num(m.paychecks_month) ?? 0), tone: m.paychecks_month ? '' : 'mute', s: 'this month' },
    ], 4);
  }
  const moneySection = (m) => sec(monthLabel(m.month), `<div class="chips">${feedPill(m.bank_feed, 'Bank alerts')}</div>` + moneyTiles(m));
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const paydayIndex = () => { const w = str(rec(D().payday).weekday).toLowerCase(); const i = WEEKDAYS.findIndex((d) => d === w || d.slice(0, 3) === w.slice(0, 3)); return i >= 0 ? i : 5; };
  function paydayBlock(m) {
    const pd = rec(D().payday);
    const lp = rec(m.last_paycheck);
    const p = nyNow();
    const idx = paydayIndex(), wd = cap(WEEKDAYS[idx]);
    const daysTo = ((idx - (new Date(dayKeyOf(p)).getUTCDay())) + 7) % 7;
    let html = `<div class="kvline"><span>Paid every <b>${esc(wd)}</b></span>${str(pd.method) ? `<span>${esc(plain(pd.method))}</span>` : ''}<span>${daysTo === 0 ? '<b style="color:var(--ok)">Payday is today</b>' : `Next payday <b>${daysTo === 1 ? 'tomorrow' : esc(wd) + ' (in ' + plural(daysTo, 'day') + ')'}</b>`}</span></div>`;
    if (num(lp.amount) != null) html += `<ul class="rows"><li class="row" style="--g:auto 1fr auto">${icon('coin', 2)}<span><span class="t" style="display:block">Last paycheck</span><span class="d">${esc(dayLabel(lp.date))} · ${esc(relPast(lp.date))}</span></span><span class="num" style="color:var(--ok)">+${esc(money(lp.amount))}</span></li></ul>`;
    else html += emptyBox(m.bank_feed === 'connected' ? 'No paycheck seen yet this month.' : 'No paycheck data yet: bank alerts aren’t on, so deposits can’t be seen. Your direct deposit still lands either way.', 'coin');
    return sec('Payday', html, { icon: 'coin' });
  }
  function categoriesBlock(m) {
    const list = objs(m.categories).filter((c) => str(c.name));
    const p = nyNow();
    const monthFrac = p.day / new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
    const body = list.length
      ? `<ul class="rows">${list.map((c) => {
        const b = num(c.budget), s = num(c.spent) || 0, r = b ? s / b : 0;
        const tone = b ? (r >= 1 ? 'crit' : r >= 0.8 ? 'warn' : 'ok') : '';
        return `<li class="row" style="--g:1fr auto"><span class="t">${esc(plain(c.name))}</span><span class="num">${esc(money(s))}<span class="d"> / ${b ? esc(money(b, 0)) : 'no budget'}</span></span><span class="full">${b ? bar(r, tone, false, monthFrac) : ''}</span></li>`;
      }).join('')}</ul><p class="note">The tick marks how far through the month we are.</p>`
      : emptyBox(m.bank_feed === 'connected' ? 'No spending categories yet.' : 'No spending categories yet. They fill in from bank alerts once those are on.');
    return sec('Budgets', body, { n: list.length });
  }
  const CRYSTAL_COL = { Invest: '#f2c94c', 'Car insurance': '#63b4e6', 'Apartment fund': '#b48cff' };
  function savingsRow(s, hl) {
    const t = num(s.target), c = num(s.current) || 0;
    const r = t ? c / t : 0;
    let sub = '';
    if (t) {
      const dl = s.deadline ? daysUntil(s.deadline) : null;
      sub = `${Math.round(r * 100)}% of ${money(t, 0)}`;
      if (dl != null && dl > 0 && c < t) sub += ` · ${money((t - c) / Math.max(1, dl / 7), 0)} a week to reach it ${dl > 60 ? dueWord(parseWhen(s.deadline).day).toLowerCase() : 'by ' + dayLabel(s.deadline)}`;
      else if (s.deadline) sub += ` · by ${dayLabel(s.deadline)}`;
    } else sub = 'No target set yet';
    const col = pick(CRYSTAL_COL, s.name);
    return `<li class="row${hl ? ' hl' : ''}" style="--g:1fr auto"><span class="t">${esc(plain(s.name))}</span><span class="num">${esc(money(c))}</span><span class="full"${col ? ` style="--bc:${col}"` : ''}>${bar(r, t ? '' : 'mute', true)}</span><span class="d full">${esc(sub)}</span></li>`;
  }
  function savingsBlock() {
    const list = savingsList().filter((s) => str(s.name));
    const body = list.length ? `<ul class="rows">${list.map((s) => savingsRow(s)).join('')}</ul>` : emptyBox('No savings goals set up yet.');
    const anyNoTarget = list.some((s) => !num(s.target));
    return sec('Savings goals', body + (anyNoTarget ? `<p class="note">Ask J.A.R.V.I.S. to set a target (for example “Set the Invest goal to $500 by June”) and the savings crystals in ${esc(PLACE.mine)} start to grow.</p>` : ''), { n: list.length });
  }
  function anomaliesBlock(m) {
    const list = objs(m.anomalies);
    if (!list.length) return sec('Odd charges', m.bank_feed === 'connected' ? emptyBox('Nothing odd spotted.', 'ok') : emptyBox('No bank data yet, so odd charges can’t be checked.'));
    return sec('Odd charges', `<ul class="rows">${list.map((a) => `<li class="row" style="--g:auto 1fr auto">${icon('alert', 2)}<span><span class="t wrap" style="display:block">${esc(plain(a.merchant))}</span><span class="d">${esc(plain(a.rule))}${a.date ? ' · ' + esc(dayLabel(a.date)) : ''}</span></span><span class="num">${esc(money(a.amount))}</span></li>`).join('')}</ul>`, { n: list.length });
  }
  /** Hudson's clients (not his own brand), with status, accounts, posts, approval and the Raw folder. */
  function clientsBlock() {
    const list = realClients();
    let body;
    if (list.length) {
      body = `<ul class="rows">${list.map((c) => {
        const met = clientMetric(c.name);
        const st = statusParts(c.status);
        const nets = strs(met && met.networks).length ? strs(met.networks) : strs(c.accounts);
        const posts = met ? num(met.posts_next_7d) : null;
        const raw = linkIn('', c.raw_folder_url);
        const tag = num(c.retainer) != null ? `${money(c.retainer, 0)}/mo` : st.main;
        const subs = [plain(c.location), st.detail].filter(Boolean).join(' · ');
        return `<li class="row" style="--g:1fr auto"><span><span class="t wrap" style="display:block;font-weight:700">${esc(plain(c.name))}</span>${subs ? `<span class="d">${esc(subs)}</span>` : ''}</span>${tag ? `<span class="tag">${esc(tag)}</span>` : ''}
          <span class="full chips">${nets.map((n) => `<span class="net ${esc(netKey(n))}">${esc(netName(n))}</span>`).join('')}</span>
          <span class="d full">${posts != null ? esc(plural(posts, 'post')) + ' in the next 7 days' : 'Post counts appear once these accounts are linked in Metricool'}${c.owner_approved === false ? ' · auto-posting waits for the owner’s OK' : c.owner_approved === true ? ' · owner approved auto-posting' : ''}</span>
          ${raw ? `<span class="full">${extLink({ url: raw.url, label: 'Open Raw folder' })}</span>` : ''}</li>`;
      }).join('')}</ul>`;
    } else body = emptyBox('No clients yet. Ask J.A.R.V.I.S. to add one.');
    return sec('Clients', body, { n: list.length });
  }
  function storeAdsBlock(m) {
    const a = rec(m.store_ads);
    if (!fidgetLive()) return sec('Fidgetly (your own brand)', emptyBox('Paused while you focus on clients. Tell J.A.R.V.I.S. when you want to restart it.', 'mist'));
    if (!Object.keys(a).length) {
      const ads = rec(rec(D().store).ads);
      return sec('Fidgetly (your own brand)', emptyBox(`No ad or short-form numbers yet.${strs(ads.platforms).length ? ' Planned for ' + strs(ads.platforms).join(', ') + '.' : ''}`));
    }
    return sec('Fidgetly (your own brand)', tiles([
      { k: 'Planned', v: esc(num(a.videos_planned) ?? 0), tone: 'accent', s: 'videos' },
      { k: 'Posted', v: esc(num(a.videos_posted_7d) ?? 0), s: 'last 7 days' },
      { k: 'Clicks', v: esc(num(a.link_clicks_7d) ?? 0), s: 'last 7 days' },
    ], 3) + (str(a.top_video) ? `<p class="note"><b>Top video:</b> ${esc(plain(a.top_video))}</p>` : ''));
  }
  function prospectsBlock(m) {
    const list = objs(m.prospects).filter((p) => str(p.name));
    const resting = /^skipped/i.test(str((threadOf('social-ops') || {}).summary));
    const body = list.length
      ? `<ul class="rows">${list.map((p) => `<li class="row" style="--g:1fr auto"><span class="t">${esc(plain(p.name))}</span>${pill(str(p.status) || 'new', p.status === 'signed' ? 'ok' : p.status === 'drafted' ? 'info' : 'mute')}</li>`).join('')}</ul><p class="note">Outreach messages are drafted only. You send them yourself.</p>`
      : emptyBox(resting ? 'Lumi isn’t prospecting yet. She rests until Metricool has accounts linked.' : 'No prospects yet. Lumi drafts outreach to local businesses at the daily check-in.');
    return sec('Prospects', body, { n: list.length });
  }
  function shopTiles(m) {
    const sh = rec(m.shopify);
    const known = num(sh.orders_7d) != null;
    const low = num(sh.low_stock_variants) ?? arr(sh.low_stock).length;
    return tiles([
      { k: 'Orders', v: esc(known ? sh.orders_7d : '—'), tone: known ? 'accent' : 'mute', s: 'last 7 days' },
      { k: 'Revenue', v: esc(moneyShort(sh.revenue_7d)), tone: num(sh.revenue_7d) ? 'ok' : 'mute', s: 'last 7 days' },
      { k: 'Low stock', v: esc(low || (known ? 0 : '—')), tone: low ? 'crit' : 'mute', s: num(sh.zero_stock_variants) ? `${sh.zero_stock_variants} sold out` : 'items' },
      { k: 'DM drafts', v: esc(num(m.dm_drafts) ?? 0), tone: m.dm_drafts ? '' : 'mute' },
    ], 4) + (known ? '' : `<p class="note">Shopify numbers appear once Shopify is connected to the daily check-in.</p>`);
  }
  function lowStockBlock(m) {
    const sh = rec(m.shopify);
    const list = arr(sh.low_stock).map((x) => (typeof x === 'string' ? x : str(rec(x).name))).filter(Boolean);
    const known = num(sh.orders_7d) != null;
    const body = list.length
      ? `<ul class="rows">${list.map((x) => `<li class="row" style="--g:auto 1fr">${/\(0\)|\bat 0\b|sold out/i.test(x) ? '<span class="tag red">sold out</span>' : '<span class="tag amber">low</span>'}<span class="t wrap">${esc(plain(x))}</span></li>`).join('')}</ul>`
      : (known ? emptyBox('Every crate is stocked.', 'ok') : emptyBox('Stock levels unknown until Shopify is connected.'));
    return sec('Low stock', body, { n: (list.length || known) ? list.length : null });
  }
  function oppsBlock(m) {
    const list = objs(m.opportunities).filter((o) => str(o.title));
    const body = list.length
      ? `<ul class="rows">${list.map((o) => `<li class="row" style="--g:1fr auto"><span class="t wrap">${esc(plain(o.title))}</span><span class="num">${num(o.margin_pct) != null ? esc(Math.round(o.margin_pct)) + '%' : '—'}<span class="d"> margin</span></span>${num(o.margin_pct) != null ? `<span class="full">${bar(o.margin_pct / 100, o.margin_pct >= 40 ? 'ok' : '', false)}</span>` : ''}</li>`).join('')}</ul>`
      : emptyBox('No new product ideas yet.');
    return sec('Product ideas', body, { n: list.length });
  }
  function storeProjectBlock() {
    const st = rec(D().store);
    const pr = objs(st.projects).filter((p) => str(p.name));
    if (!pr.length) return '';
    const sh = rec(metricsOf('hustle-engine').shopify);
    const vals = [];
    if (num(sh.orders_7d) != null) vals.push(['Orders this week', String(sh.orders_7d)]);
    if (num(sh.revenue_7d) != null) vals.push(['Revenue', moneyShort(sh.revenue_7d)]);
    if (num(sh.low_stock_variants) != null) vals.push(['Low stock', String(sh.low_stock_variants)]);
    return sec('The store', pr.map((p) => `<div class="kvline"><span><b>${esc(plain(p.name))}</b></span><span>${esc(cap(plain(p.status)))}</span></div>`).join('')
      + (vals.length ? `<div class="kvline">${vals.map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join('')}</div>` : ''));
  }
  function cyclesBlock() {
    const cyc = objs(D().cycles).filter((c) => /^(\d{1,2}):(\d{2})$/.test(String(c.local_time || '').trim()));
    if (!cyc.length) return sec('Check-in schedule', emptyBox('No check-in time is set.'));
    const nx = nextCheckIn();
    return sec('Check-in schedule', `<ul class="rows">${cyc.map((c) => { const t = /^(\d{1,2}):(\d{2})$/.exec(c.local_time.trim()); const isNext = nx && (!nx.name || nx.name === c.name); const focus = cap(plain(c.focus)); return `<li class="row${isNext ? ' hl' : ''}" style="--g:72px 1fr auto"><span class="num" style="text-align:left;font-size:14px">${esc(clock12({ h: +t[1], m: +t[2] }))}</span><span><span class="t" style="display:block">${esc(cap(plain(str(c.name)) || 'daily'))} check-in</span>${focus ? `<span class="d" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden" title="${esc(focus)}">${esc(focus)}</span>` : ''}</span>${isNext ? `<span class="pill accent plain" data-live="countdown">${esc(countdownText())}</span>` : ''}</li>`; }).join('')}</ul>`, { icon: 'bell' });
  }
  function runsBlock(limit = 6) {
    const runs = objs(D().runs).slice(0, limit);
    const body = runs.length
      ? `<ul class="rows">${runs.map((r) => `<li class="row" style="--g:1fr auto"><span><span class="t" style="display:block">${esc(relPast(r.started) || 'Check-in')}</span>${str(r.notes) ? `<span class="d" style="display:block;overflow-wrap:anywhere">${esc(namesIn(r.notes))}</span>` : ''}</span>${pill(r.result === 'ok' ? 'ok' : str(r.result) || '?', r.result === 'ok' ? 'ok' : r.result === 'partial' ? 'warn' : r.result === 'failed' ? 'crit' : 'mute')}</li>`).join('')}</ul>`
      : emptyBox('No check-ins have run yet.', 'bell');
    return sec('Recent check-ins', body, { n: objs(D().runs).length });
  }
  function commitsBlock(limit = 8) {
    const all = objs(D().commits).filter((c) => str(c.subject) && !/^merge\b/i.test(c.subject)), list = all.slice(0, limit);
    const body = list.length
      ? `<ul class="rows">${list.map((c) => `<li class="row" style="--g:1fr auto"><span class="t wrap">${esc(cap(namesIn(c.subject.replace(/^\w+(?:\([\w-]+\))?:\s*/, ''))))}</span><span class="d">${esc(relPast(c.at))}</span></li>`).join('')}</ul>`
      : emptyBox('No letters at the mail post yet.');
    return sec('Recent changes', body, { n: all.length });
  }
  /** What the agents may do on their own, in plain words. */
  function autonomyBlock() {
    const au = rec(D().autonomy);
    const WORDS = { read: 'read your feeds', draft: 'write drafts', 'write-repo': 'update their notes', 'calendar-write': 'add calendar events and study blocks', 'social-schedule': 'schedule client posts', 'dm-send': 'send DMs', 'external-send': 'send emails to other people', spend: 'spend money' };
    const g = { auto: [], ask: [], never: [] };
    for (const k of Object.keys(au)) { if (k === 'profile' || !own(WORDS, k)) continue; const v = au[k]; if (own(g, v)) g[v].push(WORDS[k]); }
    if (!g.auto.length && !g.ask.length && !g.never.length) return '';
    return sec('What the agents may do', `<ul class="rows">${[['auto', 'On their own', 'ok'], ['ask', 'Ask you first', 'warn'], ['never', 'Never', 'crit']].filter(([k]) => g[k].length).map(([k, l, tone]) => `<li class="row" style="--g:120px 1fr"><span>${pill(l, tone)}</span><span class="t wrap">${esc(cap(g[k].join(', ')))}</span></li>`).join('')}</ul>`);
  }

  /* ================================================================ Hermes */
  function hermesState() {
    const h = D().hermes;
    if (!h || typeof h !== 'object') return { on: false, text: 'Hermes not checked yet' };
    if (h.enabled === false) return { on: false, text: 'Hermes is switched off' };
    if (h.available === true) return { on: true, text: 'Hermes on', model: str(h.model) };
    if (h.available === false) return { on: false, text: 'Hermes is off' };
    return { on: false, text: 'Hermes not checked yet' };
  }
  function hermesBlock() {
    const h = rec(D().hermes), st = hermesState();
    const uses = strs(h.use_for).map(plain);
    const line = st.on
      ? 'Hermes, a free AI model, writes first drafts and J.A.R.V.I.S. checks them.'
      : 'Hermes (optional, a free AI that writes first drafts) is off. Everything still works without it. Ask J.A.R.V.I.S. to add an OpenRouter key if you want it.';
    return sec('Hermes, the drafting helper', `<div class="chips">${pill(st.text, st.on ? 'ok' : 'mute')}${h.checked ? `<span class="note">checked ${esc(relPast(h.checked))}</span>` : ''}</div><p class="note">${esc(line)}</p>${uses.length ? `<div class="chips">${uses.map((u) => `<span class="tag">${esc(u)}</span>`).join('')}</div>` : ''}`, { icon: 'wing', id: 'hermes' });
  }

  /* ================================================================ weather */
  const WEATHER = {
    ok: { icon: 'sun', word: 'Clear' }, idle: { icon: 'mist', word: 'Mist' }, warn: { icon: 'rain', word: 'Rain' }, critical: { icon: 'storm', word: 'Storm' },
  };
  const SEV = { ok: 0, idle: 1, warn: 2, critical: 3 };
  const levelOf = (b) => { const l = rec(S.status && S.status[b]).level; return own(WEATHER, l) ? l : 'ok'; };
  function townWeather() {
    let worst = 'ok';
    for (const b of S.BIOMES || []) { const l = levelOf(b); if (SEV[l] > SEV[worst]) worst = l; }
    let ic = WEATHER[worst].icon;
    if (worst === 'ok') ic = S.time && S.time.isNight ? 'moon' : 'sun';
    return { icon: ic, level: worst };
  }
  /** One plain status for an island: "All clear", "Resting", "2 warnings", "Critical". */
  function islandStatus(biome) {
    const ag = THEME[biome].agent, l = levelOf(biome);
    const warns = alertsFor(ag).filter(isWarn);
    if (l === 'critical') return pill('Critical', 'crit');
    if (warns.length) return pill(plural(warns.length, 'warning'), 'warn');
    if (l === 'idle') return pill('Resting', 'mute');
    return pill('All clear', 'ok');
  }

  /* =============================================================== DOM refs */
  const $ = (id) => document.getElementById(id);
  let app, stage, hud, panel, toast, todayEl, card, dock;
  let current = null; // {kind, key}
  let lastHud = {};
  let opener = null;
  const mq = (q) => !!(window.matchMedia && window.matchMedia(q).matches);
  const isPhone = () => mq('(max-width: 700px)');
  const isNarrow = () => mq('(max-width: 1099px)');
  const panelOpen = () => !!(panel && !panel.hidden);

  /* ================================================================== HUD */
  function buildHud() {
    app = $('app'); stage = $('stage') || (S.canvas && S.canvas.parentElement); hud = $('hud'); panel = $('panel'); toast = $('toast'); todayEl = $('today');
    if (!hud || !panel) return;
    const sample = !!D().sample;
    hud.innerHTML = `
      <div class="hud-card glass" role="group" aria-label="Status">
        <div class="hc-g"><button class="hud-brand" data-act="biome" data-arg="square" title="${esc(THEME.square.name)}: J.A.R.V.I.S.’s overview">${icon('logo', 2)}<span class="hud-title">THE SHACK</span></button></div>
        <div class="hc-g hud-time" title="New York time"><b id="hud-clock">—</b><span class="hud-day" id="hud-day"></span></div>
        <div class="hc-g hc-cycle hud-cycle" id="hud-cycle">${icon('bell', 2)}<span id="hud-cyc-k">Next check-in</span><span class="v" id="hud-cyc-v" aria-live="off"></span></div>
        <div class="hc-g hc-chips"><button class="hud-chip" id="hud-alerts" data-act="alerts"></button><button class="hud-chip on" id="hud-hermes" data-act="hermes" hidden><span class="dot"></span><span>Hermes on</span></button><span class="hud-chip stale" id="hud-stale" hidden></span></div>
        ${sample ? '<span class="sample-badge" title="Previewing with example data, not your real state">SAMPLE DATA</span>' : ''}
      </div>
      <div class="hud-dock glass" role="toolbar" aria-label="Controls">
        <button class="hud-btn today-btn" data-act="today" id="hud-today" aria-expanded="false" aria-controls="today" title="Today (T)">${icon('today', 2)}<span class="lbl">Today</span></button>
        <button class="hud-btn ask" data-act="requests" title="Ask J.A.R.V.I.S. for something (A)">${icon('ask', 2)}<span class="lbl">Ask <span class="lbl-x">J.A.R.V.I.S.</span></span><kbd>A</kbd><b class="count" id="hud-rcount" hidden></b></button>
        <button class="hud-btn" data-act="chronicle" title="The Chronicle: J.A.R.V.I.S.’s log (C)">${icon('scroll', 2)}<span class="lbl">Chronicle</span><kbd>C</kbd></button>
        <span class="sep" aria-hidden="true"></span>
        <button class="hud-btn sq" data-act="sound" id="hud-sound" aria-pressed="false" title="Sound" aria-label="Sound">${icon('soundOff', 2)}</button>
      </div>`;
    card = hud.querySelector('.hud-card'); dock = hud.querySelector('.hud-dock');
    hud.addEventListener('click', onAction);
    panel.addEventListener('click', onAction);
    panel.addEventListener('submit', onSubmit);
    panel.addEventListener('input', onPanelInput);
    panel.addEventListener('focusin', onPanelFocus);
    if (toast) toast.addEventListener('click', onToastClick);
    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) window.addEventListener(type, ghostGuard, true);
    window.addEventListener('pointerdown', (e) => { if (ghostUntil && overUi(e.target)) ghostUntil = 0; }, true);
    lastHud = {};
    hudUpdate();
    layout();
    window.addEventListener('resize', layout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout, () => {});
    if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(() => layout()); ro.observe(card); ro.observe(dock); if (stage) ro.observe(stage); }
  }
  /* Touch "ghost" taps: the core opens a panel on pointerup, and the browser's follow-up mouse and click
   * events for that tap then land on whatever the new sheet put under the finger. For a moment after a
   * canvas open, drop mouse/click events on the panel and HUD unless a fresh pointerdown landed there. */
  let ghostUntil = 0;
  const overUi = (t) => !!(t && t.closest && t.closest('#panel, #hud, #today'));
  function ghostGuard(e) {
    if (!ghostUntil) return;
    if (performance.now() > ghostUntil) { ghostUntil = 0; return; }
    if (!overUi(e.target)) return;
    e.preventDefault(); e.stopPropagation();
  }

  /** Measure the HUD and tell the core how much of the stage it covers (fit view), where the dock and
   * toast go while a drawer is open, and the narrow/phone Today mode. Cheap and idempotent. */
  let lastInsets = '', layoutMode = '';
  function layout() {
    if (!hud || !card || !dock || !stage) return;
    const mode = isPhone() ? 'phone' : isNarrow() ? 'slide' : 'docked';
    if (mode !== layoutMode) { const first = !layoutMode; layoutMode = mode; setTodayOpen(mode === 'phone', true, first); }
    const sh = stage.clientHeight;
    const ins = { top: Math.round(card.offsetTop + card.offsetHeight + 10), right: 0, bottom: Math.round(Math.max(0, sh - dock.offsetTop) + 10), left: 0 };
    const key = ins.top + ',' + ins.bottom;
    if (key !== lastInsets) {
      lastInsets = key;
      try { if (typeof S.setViewInsets === 'function') S.setViewInsets(ins); else S.viewInsets = ins; } catch (e) { console.error('setViewInsets', e); }
    }
    app.style.setProperty('--dock-h', dock.offsetHeight + 'px');
    placeFloating();
  }
  /** While a drawer is open on a wide stage, the dock and toast sit in the free area beside it. */
  let shortDrawer = false;
  function placeFloating() {
    if (!stage || !app) return;
    let fr = 0, dr = 0;
    shortDrawer = false;
    if (panelOpen() && !isPhone()) {
      const pw = panel.offsetWidth + 24;
      fr = pw;
      if (stage.clientWidth - pw >= dock.offsetWidth + 24) dr = pw; else shortDrawer = true;
    }
    stage.style.setProperty('--free-r', fr + 'px');
    dock.style.setProperty('--free-r', dr + 'px');
    app.classList.toggle('drawer-short', shortDrawer);
  }
  /** The status card shows only on the main view: not while a panel or the Today slide-over is open,
   * and not while the camera is focused on an island. */
  function cardAway() {
    let focused = false;
    try { focused = typeof S.isFocused === 'function' ? !!S.isFocused() : false; } catch (e) { focused = false; }
    return panelOpen() || (layoutMode !== 'docked' && todayOpen) || focused;
  }
  function syncCard() {
    if (!app) return;
    const away = cardAway();
    if (app.classList.contains('card-away') !== away) { app.classList.toggle('card-away', away); coverStamp = -1; }
  }

  function setText(id, v) { if (lastHud[id] !== v) { lastHud[id] = v; const el = $(id); if (el) el.textContent = v; } }
  function setHTML(id, v) { if (lastHud[id] !== v) { lastHud[id] = v; const el = $(id); if (el) el.innerHTML = v; } }
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  let lastMinute = '', lastDay = null;
  function hudUpdate() {
    if (!hud || !card) return;
    const now = S.now();
    const p = S.nyParts(now);
    const cp = clockParts(now);
    setHTML('hud-clock', `${esc(cp.hm)}<small>${esc(cp.ap)}</small>`);
    setText('hud-day', DAYS[p.dow] || '');
    // next check-in
    const c = S.cycle || {};
    const cyc = $('hud-cycle');
    if (c.ceremony) {
      setHTML('hud-cyc-k', `Check-in <b>${esc(c.ceremony.name === 'manual' ? 'replay' : 'in progress')}</b>: ${esc(beatName(c.ceremony.progress))}`);
      setText('hud-cyc-v', 'now');
      if (cyc) cyc.classList.add('live');
    } else {
      if (cyc) cyc.classList.remove('live');
      const n = nextCheckIn();
      if (n) {
        setHTML('hud-cyc-k', `Next check-in: <b>${esc(clockWhen(n.at))}</b>`);
        setText('hud-cyc-v', 'in ' + dur(n.at - now.getTime()));
        const tip = `J.A.R.V.I.S.’s daily check-in writes your morning brief and updates everything here.`;
        if (cyc && cyc.title !== tip) cyc.title = tip;
      } else { setHTML('hud-cyc-k', 'Next check-in: <b>not scheduled</b>'); setText('hud-cyc-v', ''); }
    }
    const v = $('hud-cyc-v'); if (v) v.hidden = !v.textContent;
    // alerts chip: warnings and critical only (info notices are "Heads-up", not alerts)
    const al = allAlerts().filter(isWarn);
    const lvl = al.some((a) => a.level === 'critical') ? 'critical' : al.length ? 'warn' : 'zero';
    const wx = townWeather();
    const ab = $('hud-alerts');
    if (ab) {
      const key = al.length + lvl + wx.icon;
      if (lastHud.alerts !== key) {
        lastHud.alerts = key;
        ab.className = 'hud-chip ' + lvl;
        ab.innerHTML = `${icon(wx.icon, 2)}<span>${al.length ? `<b>${al.length}</b> ${al.length === 1 ? 'alert' : 'alerts'}` : 'No alerts'}</span>`;
        const lines = al.map((a) => { const ag = agentOf(a.agent); return (ag ? AGENT_INFO[ag].short + ': ' : '') + plain(a.msg); });
        ab.title = lines.length ? lines.join('\n') : 'All quiet. No warnings from any island.';
        ab.setAttribute('aria-label', `${al.length ? plural(al.length, 'alert') : 'No alerts'}. Open J.A.R.V.I.S.’s overview.`);
      }
    }
    const hb = $('hud-hermes');
    if (hb) { const on = hermesState().on; if (hb.hidden === on) hb.hidden = !on; }
    // stale data
    const st = $('hud-stale');
    if (st) {
      const g = parseWhen(D().generated), old = g && g.at && now.getTime() - g.at > 26 * 3600e3;
      const txt = old ? `Data from ${daysFrom(g.day) > -7 ? fmtUTCWd.format(dayDate(g.day)) : fmtUTCShort.format(dayDate(g.day))}` : '';
      if (st.textContent !== txt) { st.textContent = txt; st.hidden = !old; st.title = old ? `This page was last updated ${clockWhen(g.at)}. It refreshes at the next check-in.` : ''; }
    }
    // open requests awaiting a reply
    const rc = $('hud-rcount');
    if (rc) { const n = requestsWaiting(); const t = n ? String(n) : ''; if (rc.textContent !== t) rc.textContent = t; rc.hidden = !n; rc.title = n ? `${plural(n, 'request')} waiting for J.A.R.V.I.S.’s reply` : ''; }
    // sound
    const sb = $('hud-sound');
    if (sb) {
      const on = !!(S.audio && S.audio.enabled), has = !!(S.audio && typeof S.audio.toggle === 'function');
      const key = on + '|' + has;
      if (lastHud.sound !== key) {
        lastHud.sound = key;
        sb.setAttribute('aria-pressed', on ? 'true' : 'false');
        sb.disabled = !has;
        sb.innerHTML = icon(on ? 'soundOn' : 'soundOff', 2);
        sb.title = has ? (on ? 'Sound is on. Click to mute.' : 'Sound is off. Click for chiptune.') : 'Sound is not available';
        sb.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
      }
    }
    syncCard();
    // live bits inside the open panel
    if (current && panelOpen()) {
      const cd = countdownText();
      panel.querySelectorAll('[data-live="countdown"]').forEach((el) => { if (el.textContent !== cd) el.textContent = cd; });
    }
    // the Today column follows the clock: every minute (current event, due chips), and a new day at midnight
    const dk = dayKeyOf(p), mk = p.hour + ':' + p.minute;
    if (lastDay !== null && dk !== lastDay) { lastDay = dk; renderToday(true); if (current && panelOpen()) reopen(); }
    else if (mk !== lastMinute) { lastDay = dk; lastMinute = mk; renderToday(false); }
  }

  /* ================================================================ drawer */
  function navStrip(active) {
    return `<nav class="ph-nav" aria-label="Islands">${NAV.map((b, i) => `<button data-act="biome" data-arg="${b}" style="--c:${THEME[b].color}"${active === b ? ' aria-current="true"' : ''} title="${esc(THEME[b].name)} (${i + 1})"><i></i>${esc(NAV_SHORT[b])}</button>`).join('')}</nav>`;
  }
  function head({ who: w, theme, kicker, title, sub }) {
    return `<div class="panel-head">
      <div class="ph-banner" style="background-image:url(${bannerURL(theme)})"></div>
      <img class="portrait" src="${portraitURL(w, theme)}" alt="">
      <div class="ph-text"><div class="ph-kicker">${esc(kicker)}</div><h2 class="ph-title" id="panel-title" tabindex="-1">${esc(title)}</h2></div>
      ${sub ? `<p class="ph-sub">${esc(sub)}</p>` : ''}
    </div>`;
  }
  /** Open the drawer. opts: {nav (active island or null), wy (world y: on a phone, things in the lower
   * half of the world get a top sheet), tall (a reading panel: taller phone sheet), focus (island to
   * glide to), at ([x, y] world point that must stay in view)}. */
  function show(theme, html, opts = {}) {
    if (!panel) return;
    const wasHidden = panel.hidden;
    if (wasHidden) { const a = document.activeElement; opener = a && a !== document.body && a !== S.canvas && !panel.contains(a) ? a : null; }
    if (layoutMode !== 'docked' && todayOpen) setTodayOpen(false);
    const top = isPhone() && opts.wy != null && opts.wy > S.H / 2;
    panel.classList.toggle('top', top);
    panel.classList.toggle('tall', !!opts.tall && !top);
    app.classList.toggle('sheet-top', top);
    panel.dataset.theme = own(THEME, theme) ? theme : 'square';
    panel.setAttribute('aria-labelledby', 'panel-title');
    panel.innerHTML = `<button class="ph-x" data-act="close" aria-label="Close panel" title="Close (Esc)">${icon('close', 2)}</button><div class="panel-scroll">${html.replace('<!--NAV-->', opts.nav === false ? '' : navStrip(opts.nav))}</div>`;
    panel.hidden = false;
    app.classList.add('panel-open');
    const sc = panel.querySelector('.panel-scroll');
    if (sc) sc.scrollTop = 0;
    if (wasHidden && !S.reducedMotion) {
      panel.classList.add('enter');
      requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.remove('enter')));
    }
    syncCard();
    placeFloating();
    coverStamp = -1;
    const t = $('panel-title');
    if (t) { try { t.focus({ preventScroll: true }); } catch (e) { /* old browsers */ } }
    if (opts.focus) focusIsland(opts.focus);
  }
  /** Re-render the open panel in place (new day, data change), keeping its scroll position. */
  function reopen() {
    if (!current || !panelOpen()) return;
    const sc = panel.querySelector('.panel-scroll'), y = sc ? sc.scrollTop : 0;
    const c = current;
    try {
      if (c.kind === 'biome') openBiome(c.key, true);
      else if (c.kind === 'landmark') openLandmark(c.key, null, true);
      else if (c.kind === 'chronicle') openChronicle(c.key, null, true);
      else if (c.kind === 'requests') refreshBoard();
    } catch (e) { console.error('reopen', e); }
    const sc2 = panel.querySelector('.panel-scroll'); if (sc2) sc2.scrollTop = y;
  }

  /* ================================================================ camera
   * The camera is fixed at the fit view. Opening a panel glides in on its island, in the part of the
   * stage the drawer leaves free; closing glides back. The view may run past the world edge while a
   * drawer is open (S.cam.pad), so corner islands can be centred without over-zooming. */
  function freeRect() {
    const vw = stage ? stage.clientWidth : window.innerWidth, vh = stage ? stage.clientHeight : window.innerHeight;
    const away = cardAway();
    const y0 = !away && card ? card.offsetTop + card.offsetHeight + 8 : 8;
    const y1 = dock ? dock.offsetTop - 8 : vh - 8;
    if (!panelOpen()) return { x: 0, y: y0, w: vw, h: Math.max(120, y1 - y0) };
    if (isPhone()) {
      const pt = panel.offsetTop, pb = pt + panel.offsetHeight;
      return panel.classList.contains('top')
        ? { x: 0, y: pb + 8, w: vw, h: Math.max(100, y1 - pb - 8) }
        : { x: 0, y: 8, w: vw, h: Math.max(100, pt - 16) };
    }
    const pw = panel.offsetWidth + 24;
    const yb = shortDrawer ? vh - 8 : y1;
    return { x: 0, y: 8, w: Math.max(160, vw - pw), h: Math.max(120, (shortDrawer ? panel.offsetTop + panel.offsetHeight : yb) - 8) };
  }
  /** Glide so world point (wx, wy) lands in the middle of the free area at zoom z. */
  function glideTo(wx, wy, z) {
    if (!S.cam || typeof S.panTo !== 'function' || !stage) return;
    const f = freeRect(), vw = stage.clientWidth, vh = stage.clientHeight;
    z = clamp(z, S.cam.minZ || 0.3, Math.min(4, S.cam.maxZ || 4));
    const dx = vw / 2 - (f.x + f.w / 2), dy = vh / 2 - (f.y + f.h / 2);
    const cx = wx + dx / z, cy = wy + dy / z, hw = vw / z / 2, hh = vh / z / 2;
    const need = Math.max(0, hw - cx, cx - (S.W - hw), hh - cy, cy - (S.H - hh));
    S.cam.pad = Math.ceil(need) + 4;
    S.cam.follow = null;
    S.panTo(cx, cy, z);
  }
  /** Glide to an island so it sits, whole if it fits, in the part of the stage the drawer leaves free. */
  function focusIsland(id) {
    const r = S.islands && pick(S.islands, id);
    if (!r || !S.cam) return;
    if (typeof S.focusRect === 'function' && typeof S.islandBox === 'function' && typeof S.setViewInsets === 'function') {
      // the island's art box, plus room for towers and spires that rise above it
      try { const b = S.islandBox(id); S.focusRect({ x: b.x, y: b.y - 24, w: b.w, h: b.h + 24 }, freeRect(), { id, margin: 10 }); return; } catch (e) { console.error('focusIsland', e); }
    }
    const T = S.TILE, f = freeRect();
    const top = r.y - 3, bottom = r.y + r.h + r.depth;
    const fitZ = num(S.cam.fitZ) || 1;
    const z = clamp(Math.min(f.w / ((r.w + 4) * T), f.h / ((bottom - top + 1) * T)), Math.min(1, fitZ), 3);
    glideTo((r.x + r.w / 2) * T, ((top + bottom) / 2 + 0.5) * T, z);
  }
  /** Back to the fixed fit view (and let the core's clamp take over again). */
  function backToFit() {
    if (!S.cam) return;
    S.cam.follow = null;
    if (typeof S.setViewInsets === 'function' && typeof S.fitView === 'function') { try { S.fitView({ animate: true }); } catch (e) { console.error(e); } return; }
    if (typeof S.panTo === 'function') {
      S.panTo(S.W / 2, S.H / 2, num(S.cam.fitZ) || 1);
      setTimeout(() => { if (!panelOpen() && S.cam) S.cam.pad = 0; }, 800);
    } else if (typeof S.fitView === 'function') S.fitView();
  }

  /** Stage rect of a UI element ({l, t, r, b}), or null when it isn't showing. */
  function uiRect(el) {
    if (!el || el.hidden || el.offsetParent === null) return null;
    const r = el.getBoundingClientRect(), c = (stage || S.canvas).getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { l: r.left - c.left, t: r.top - c.top, r: r.right - c.left, b: r.bottom - c.top };
  }
  let coverStamp = -1, coverList = [];
  function coverRects() {
    const stamp = (S.frame || 0);
    if (stamp === coverStamp) return coverList;
    coverStamp = stamp;
    coverList = [uiRect(panel), cardAway() ? null : uiRect(card), uiRect(dock), layoutMode !== 'docked' && todayOpen ? uiRect(todayEl) : null, toast && !toast.hidden ? uiRect(toast) : null].filter(Boolean);
    return coverList;
  }
  /** True when a stage rect ({x, y, w, h}, {l, t, r, b}, {left, top, right, bottom} or a DOMRect) is
   * under the drawer, the status card, the dock, the toast or the Today slide-over. */
  function covers(rect) {
    if (!rect || !stage) return false;
    let l, t, r, b;
    if (num(rect.w) != null) { l = rect.x; t = rect.y; r = rect.x + rect.w; b = rect.y + rect.h; }
    else if (num(rect.width) != null) { l = num(rect.left) ?? rect.x; t = num(rect.top) ?? rect.y; r = l + rect.width; b = t + rect.height; }
    else if (num(rect.l) != null) { l = rect.l; t = rect.t; r = rect.r; b = rect.b; }
    else { l = rect.left; t = rect.top; r = rect.right; b = rect.bottom; }
    if ([l, t, r, b].some((v) => num(v) == null)) return false;
    return coverRects().some((c) => l < c.r && r > c.l && t < c.b && b > c.t);
  }

  /* ============================================================ panel bodies */
  const BODY = {};
  BODY['academic-core'] = () => {
    const m = metricsOf('academic-core');
    return [threadHeader('academic-core'), `<div class="chips">${feedPill(m.classroom_feed, 'Classroom')}</div>`, alertsSection(alertsFor('academic-core')),
      deadlinesBlock(m), studyBlock(m), prepBlock(m), tasksSection('academic-core'), bubblesLine('academic-core')];
  };
  BODY['ledger-fi'] = () => {
    const m = metricsOf('ledger-fi');
    return [threadHeader('ledger-fi'), alertsSection(alertsFor('ledger-fi')),
      moneySection(m), paydayBlock(m), categoriesBlock(m), savingsBlock(), anomaliesBlock(m), tasksSection('ledger-fi'), bubblesLine('ledger-fi')];
  };
  BODY['social-ops'] = () => {
    const m = metricsOf('social-ops');
    const posts = num(m.scheduled_posts_7d);
    return [threadHeader('social-ops'), alertsSection(alertsFor('social-ops')),
      sec('This week', tiles([
        { k: 'Posts', v: esc(posts ?? 0), tone: posts ? 'accent' : 'mute', s: 'next 7 days' },
        { k: 'Drafts', v: esc(num(m.drafts_pending) ?? 0), tone: m.drafts_pending ? '' : 'mute', s: 'to review' },
        { k: 'Clients', v: esc(realClients().length), tone: realClients().length ? '' : 'mute' },
        { k: 'Prospects', v: esc(objs(m.prospects).length), tone: objs(m.prospects).length ? '' : 'mute' },
      ], 4)),
      clientsBlock(), storeAdsBlock(m), prospectsBlock(m), tasksSection('social-ops'), bubblesLine('social-ops')];
  };
  BODY['hustle-engine'] = () => {
    const m = metricsOf('hustle-engine');
    return [threadHeader('hustle-engine'), alertsSection(alertsFor('hustle-engine')),
      sec('Shopify', shopTiles(m)), lowStockBlock(m), oppsBlock(m), storeProjectBlock(), tasksSection('hustle-engine'), bubblesLine('hustle-engine')];
  };
  BODY.hub = () => {
    const rows = (S.BIOMES || []).filter((b) => own(THEME, b)).map((b) => {
      const ag = THEME[b].agent, th = threadOf(ag) || {}, inf = AGENT_INFO[ag];
      const summary = summaryText(th.summary) || 'Waiting for the first check-in.';
      const needs = humanTasks().filter((t) => t.agent === ag && !checkDone(t.id)).length;
      const lvl = levelOf(b);
      return `<li><button class="row" data-act="biome" data-arg="${b}" style="--g:40px 1fr auto;--c:${THEME[b].color}" title="Open ${esc(THEME[b].name)}"><img class="mini-portrait" src="${portraitURL(whoFor(ag), b)}" alt=""><span style="min-width:0"><span class="t wrap" style="display:block"><b>${esc(inf.name)}</b> <span class="d">· ${esc(inf.area())}</span></span><span class="d" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere">${esc(summary)}</span></span><span style="display:grid;justify-items:end;gap:5px">${needs ? pill(`${needs} need${needs === 1 ? 's' : ''} you`, 'brass') : pill('nothing for you', 'mute')}<span title="${esc(WEATHER[lvl].word)} over ${esc(THEME[b].name)}">${icon(WEATHER[lvl].icon, 2)}</span></span></button></li>`;
    }).join('');
    const al = allAlerts();
    const open = todoItems().filter((x) => !x.done).length;
    return [
      chronicleTeaser(),
      sec('The council', `<ul class="rows">${rows}</ul><p class="note">The icon is the weather over each island: rain means a warning there.</p>`),
      al.length ? alertsSection(al, { title: 'All alerts', who: true, id: 'alerts' }) : sec('Alerts', emptyBox('All quiet. No alerts from any island.', 'ok'), { id: 'alerts' }),
      sec('To-dos', `<p class="note">${open ? `<b>${esc(plural(open, 'to-do'))}</b> open. Your to-dos live in the Today column.` : 'Nothing open. Your to-dos live in the Today column.'}</p><div class="btnrow"><button class="btn primary" data-act="show-todos">${icon('today', 2)} Show to-dos</button><button class="btn" data-act="requests">${icon('ask', 2)} Ask J.A.R.V.I.S.</button></div>`),
      landmarkList('square'),
      `<details class="behind" id="behind"><summary>Behind the scenes</summary><div class="inner">${[cyclesBlock(), runsBlock(5), hermesBlock(), autonomyBlock()].join('')}</div></details>`,
    ];
  };

  function openBiome(biome, again) {
    const t = pick(THEME, biome);
    if (!t) return;
    const agent = t.agent, inf = AGENT_INFO[agent];
    current = { kind: 'biome', key: biome };
    const parts = BODY[agent] ? BODY[agent]() : [];
    const chips = agent === 'hub' ? '' : `<div class="chips">${islandStatus(biome)}</div>`;
    show(biome, head({ who: whoFor(agent), theme: biome, kicker: `${inf.name} · ${inf.area()}`, title: t.name, sub: inf.role() }) +
      `<!--NAV--><div class="panel-body">${chips}${parts.join('')}${agent === 'hub' ? '' : landmarkList(biome)}</div>`, { nav: biome, wy: islandCy(biome), tall: agent === 'hub', focus: again ? null : biome });
  }
  function islandCy(id) { const r = S.islands && pick(S.islands, id); return r ? ((r.y - 3 + r.y + r.h + r.depth) / 2 + 0.5) * S.TILE : S.H / 2; }

  /* ---------------------------------------------------------------- villagers */
  const villagerById = (id) => (S.villagers && S.villagers.byId && pick(S.villagers.byId, id)) || null;
  function villagerIsland(id, fb) { const v = villagerById(id); return v && !v.hidden && own(THEME, v.island) ? v.island : fb; }
  function openVillager(h) {
    const agent = h.agent && agentInfo(h.agent) ? h.agent : null;
    const label = plain(String(h.label || h.name || ''));
    if (!agent) {
      const isHudson = /hudson/i.test(label) || h.player || h.id === 'villager:hudson' || h.id === 'villager:player';
      if (isHudson) { openHudson(); return; }
      const isCat = /cat|kitty/i.test(label);
      current = { kind: 'villager', key: h.id || label };
      const name = label.split(/[·,(]/)[0].trim() || 'A neighbour';
      const rest = label.slice(name.length).replace(/^[\s·,(-]+|\)$/g, '');
      const where = own(THEME, h.biome) ? h.biome : 'square';
      show(where, head({ who: isCat ? 'cat' : 'folk', theme: where, kicker: `Islander · ${PLACE[where]}`, title: name, sub: rest || (isCat ? 'Patrols the plaza. Accepts chin scratches.' : 'A neighbour on the islands.') }) +
        `<!--NAV--><div class="panel-body">${emptyBox(isCat ? 'Not an agent. Does no work at all, and is proud of it.' : 'Not one of your agents, just someone who lives here and keeps the islands lively.', 'ok')}</div>`, { nav: null, focus: where });
      return;
    }
    const inf = AGENT_INFO[agent], biome = inf.biome;
    current = { kind: 'villager', key: agent };
    const m = metricsOf(agent);
    const bub = strs(rec(m.world).bubbles).map(plain).filter(Boolean);
    const ceremony = S.cycle && S.cycle.ceremony;
    const tr = transportOf(biome);
    const vv = villagerById(agent);
    let doing = agent === 'hub' ? `At the holo-console by the clock tower on ${PLACE.square}.` : `Out and about on ${THEME[biome].name}.`;
    if (ceremony) doing = `At the ${PLACE.square} fountain for the check-in.`;
    else if (vv && vv.sleeping) doing = 'Asleep. Zzz.';
    else if (vv && vv.riding && tr) doing = `Riding the ${tr.short} to ${PLACE.square}.`;
    else if (vv && agent !== 'hub' && vv.island === 'square') doing = `Visiting ${PLACE.square}.`;
    const n = nextCheckIn();
    const says = agent === 'hub'
      ? (ceremony ? `The check-in is underway, ${address()}.` : n ? `Next check-in ${clockWhen(n.at)}, ${address()}.` : `The clock keeps good time, ${address()}.`)
      : 'Waiting for my first check-in. Nothing to report yet!';
    const where = villagerIsland(agent, biome);
    show(biome, head({ who: whoFor(agent), theme: biome, kicker: `${inf.area()} · ${THEME[biome].name}`, title: inf.name, sub: inf.role() }) +
      `<!--NAV--><div class="panel-body">
        <p class="note">${esc(doing)}</p>
        ${agent === 'hub' ? '' : threadHeader(agent)}
        ${sec('Says', bub.length ? `<div class="chips">${bub.map((x) => `<span class="quote">“${esc(x)}”</span>`).join('')}</div>` : `<p class="quote">“${esc(says)}”</p>`)}
        ${alertsSection(alertsFor(agent))}
        ${glance(agent)}
        <div class="btnrow"><button class="btn primary" data-act="biome" data-arg="${biome}">Visit ${esc(THEME[biome].name)}</button>${agent === 'hub' ? `<button class="btn" data-act="requests">${icon('ask', 2)} Ask J.A.R.V.I.S.</button><button class="btn" data-act="chronicle">${icon('scroll', 2)} Chronicle</button>` : ''}</div>
      </div>`, { nav: biome, wy: villagerY(agent, biome), focus: where });
  }
  function villagerY(id, island) { const v = villagerById(id); return v && !v.hidden && num(v.y) != null ? v.y : islandCy(island); }
  function glance(agent) {
    const m = metricsOf(agent);
    if (agent === 'hub') return cyclesBlock();
    if (agent === 'academic-core') return deadlinesBlock(m, 3);
    if (agent === 'ledger-fi') return moneySection(m);
    if (agent === 'social-ops') return clientsBlock();
    if (agent === 'hustle-engine') return sec('Shopify', shopTiles(m));
    return '';
  }
  function openHudson() {
    current = { kind: 'villager', key: 'hudson' };
    const items = todoItems().filter((x) => !x.done);
    show('square', head({ who: 'hudson', theme: 'square', kicker: 'You · ' + PLACE.square, title: playerName(), sub: `High-school student. Runs ${bizName() === 'Social media business' ? 'a social media business' : bizName()} and the Fidgetly store. Boss of all five islands.` }) +
      `<!--NAV--><div class="panel-body">
        ${sec('On your plate', items.length ? `<ul class="rows">${items.slice(0, 6).map((it) => `<li class="row" style="--g:1fr auto"><span class="t wrap">${esc(it.text)}</span>${it.dueDay != null ? `<span class="when ${dueTone(it.dueDay)}">${esc(dueWord(it.dueDay))}</span>` : ''}</li>`).join('')}</ul>${items.length > 6 ? `<p class="note">and ${esc(plural(items.length - 6, 'more', 'more'))} in the Today column.</p>` : ''}` : emptyBox('Nothing on your plate. The agents have it covered.', 'ok'), { n: items.length })}
        <div class="btnrow"><button class="btn primary" data-act="show-todos">${icon('today', 2)} Show to-dos</button><button class="btn" data-act="requests">${icon('ask', 2)} Ask J.A.R.V.I.S.</button></div>
      </div>`, { nav: 'square', wy: villagerY('player', 'square'), focus: villagerIsland('player', 'square') });
  }

  /* --------------------------------------------------------------- landmarks */
  const LM = {};
  LM.temple = () => { const m = metricsOf('academic-core'); return { who: 'academic-core', sub: 'Glowing scrolls on the board are your upcoming deadlines.', body: [deadlinesBlock(m), prepBlock(m)] }; };
  LM.studyGarden = () => { const m = metricsOf('academic-core'); return { who: 'academic-core', sub: 'Raked sand, bonsai and the week’s study blocks.', body: [studyBlock(m), prepBlock(m)] }; };
  LM.mineEntrance = () => { const m = metricsOf('ledger-fi'); return { who: 'ledger-fi', sub: 'Where spending gets dug through, category by category.', body: [moneySection(m), categoriesBlock(m), anomaliesBlock(m)] }; };
  LM.vault = () => { const m = metricsOf('ledger-fi'); return { who: 'ledger-fi', sub: 'Coin piles grow with this month’s income.', body: [moneySection(m), paydayBlock(m), savingsBlock()] }; };
  function crystalLandmark(name, color, sub) {
    const s = savingsGoal(name) || { name, current: 0, target: null };
    const t = num(s.target), c = num(s.current) || 0;
    const r = t ? c / t : 0;
    const pct = t ? Math.round(r * 100) : null;
    let pace = '';
    if (t && c < t && s.deadline) {
      const dl = daysUntil(s.deadline);
      if (dl != null && dl > 0) pace = `${money((t - c) / Math.max(1, dl / 7), 0)} a week reaches it ${dl > 60 ? dueWord(parseWhen(s.deadline).day).toLowerCase() : 'by ' + dayLabel(s.deadline)}.`;
      else pace = `The deadline (${dayLabel(s.deadline)}) has passed.`;
    } else if (t && c >= t) pace = 'Goal reached. The crystal is fully grown.';
    const ask = `Set the ${name} goal to $___ by ___`;
    const body = [`<div class="crystal-card" style="--cc:${color}">
        <div class="big"><b>${esc(money(c))}</b><span>${t ? 'of ' + esc(money(t, 0)) : 'saved so far'}</span><span class="pct">${pct != null ? pct + '%' : '—'}</span></div>
        ${bar(r, '', false).replace('class="bar ', 'class="bar crystal ')}
        <div class="kvline"><span>Saved <b>${esc(money(c))}</b></span><span>Target <b>${t ? esc(money(t, 0)) : 'not set'}</b></span>${s.deadline ? `<span>By <b>${esc(dayLabel(s.deadline))}</b></span>` : ''}</div>
      </div>`];
    if (pace) body.push(`<p class="note">${esc(pace)}</p>`);
    if (!t) body.push(`<div class="empty">${icon('crystal', 2)}<span>No target yet, so the crystal stays a small seed. Ask J.A.R.V.I.S. (for example “${esc(ask)}”) and it starts to grow.</span></div><div class="btnrow"><button class="btn primary" data-act="requests" data-arg="${esc(ask.replace(/\$___ by ___$/, '$'))}">${icon('ask', 2)} Ask J.A.R.V.I.S. to set it</button></div>`);
    body.push(sec('All savings goals', `<ul class="rows">${savingsList().filter((g) => str(g.name)).map((g) => savingsRow(g, g.name === name)).join('')}</ul>`));
    return { who: 'ledger-fi', sub, body };
  }
  LM.crystalInvest = () => crystalLandmark('Invest', CRYSTAL_COL.Invest, 'A gold crystal that grows with the Invest goal.');
  LM.crystalCar = () => crystalLandmark('Car insurance', CRYSTAL_COL['Car insurance'], 'A blue crystal that grows with the Car insurance fund.');
  LM.crystalHome = () => crystalLandmark('Apartment fund', CRYSTAL_COL['Apartment fund'], 'A violet crystal that grows with the Apartment fund.');
  LM.clockTower = () => ({ who: 'hub', sub: 'Shows real New York time. The bell rings at each daily check-in.', body: [
    `<div class="btnrow"><button class="btn" data-act="replay">${icon('replay', 2)} Replay the check-in</button></div>`, cyclesBlock(), runsBlock(8)] });
  LM.mailPost = () => ({ who: 'hub', sub: 'Every change to the system arrives here as a letter.', body: [commitsBlock(10)] });
  LM.fountain = () => {
    const goals = objs(D().goals).filter((g) => str(g.title));
    const n = nextCheckIn();
    return { who: 'hub', sub: 'Everyone gathers here at each check-in to hand in their reports.', body: [
      `<p class="summary">${n ? `Next gathering <b>${esc(clockWhen(n.at))}</b> (<span data-live="countdown">${esc(countdownText())}</span>).` : 'No check-ins scheduled.'}<small>Coins in the fountain are your goals.</small></p>`,
      sec('Wishes (goals)', goals.length ? `<ul class="rows">${goals.map((g) => { const ag = g.agent, inf = agentInfo(ag); const b = inf ? inf.biome : 'square'; return `<li><button class="row" data-act="biome" data-arg="${b}" style="--g:1fr auto"><span class="t wrap">${esc(plain(g.title))}</span>${inf ? who(ag) : ''}</button></li>`; }).join('')}</ul>` : emptyBox('No goals set.'), { n: goals.length }),
      `<div class="btnrow"><button class="btn" data-act="replay">${icon('replay', 2)} Replay the check-in</button></div>`,
    ] };
  };
  LM.broadcastTower = () => {
    const m = metricsOf('social-ops');
    const nets = {}, read = objs(m.clients);
    for (const c of read) for (const n of strs(c.networks)) nets[netKey(n) === 'other' ? n : netKey(n)] = 1;
    const nn = Object.keys(nets).length;
    return { who: 'social-ops', sub: 'Every scheduled post goes out from here (as a firework).', body: [
      tiles([{ k: 'Posts', v: esc(num(m.scheduled_posts_7d) ?? 0), tone: m.scheduled_posts_7d ? 'accent' : 'mute', s: 'next 7 days' }, { k: 'Drafts', v: esc(num(m.drafts_pending) ?? 0), tone: m.drafts_pending ? '' : 'mute', s: 'to review' }, { k: 'Networks', v: esc(read.length ? nn : '—'), tone: nn ? '' : 'mute', s: 'linked' }], 3),
      nn ? sec('On air', `<div class="chips">${Object.keys(nets).map((n) => `<span class="net ${esc(netKey(n))}">${esc(netName(n))}</span>`).join('')}</div>`)
        : emptyBox(metricoolAlert() ? 'Off air: no social accounts are linked in Metricool yet.' : 'Off air. Nothing scheduled yet.'),
      clientsBlock()] };
  };
  LM.angiesStall = () => {
    const m = metricsOf('social-ops');
    const todo = humanTasks().filter((t) => t.agent === 'social-ops').sort(byDueThenPriority);
    const ma = metricoolAlert();
    const body = [
      tiles([{ k: 'Posts', v: esc(num(m.scheduled_posts_7d) ?? 0), tone: m.scheduled_posts_7d ? 'accent' : 'mute', s: 'next 7 days' }, { k: 'Clients', v: esc(realClients().length), tone: realClients().length ? '' : 'mute' }, { k: 'Drafts', v: esc(num(m.drafts_pending) ?? 0), tone: m.drafts_pending ? '' : 'mute', s: 'to review' }], 3),
      ma ? `<p class="note">${esc('No social accounts are linked in Metricool yet.')} ${extLink(linkIn(ma.msg, ma.link) && { url: linkIn(ma.msg, ma.link).url, label: 'Link accounts' })}</p>` : '',
      clientsBlock(),
    ];
    if (todo.length) body.push(sec('Waiting on you', taskRows(todo), { n: todo.length }));
    return { who: 'social-ops', title: bizName(), sub: `Your social media business. Angie's is your first client. The studio gets busier as more client posts are queued.`, body };
  };
  LM.bizStall = LM.angiesStall;
  LM.fidgetStall = () => {
    const m = metricsOf('social-ops'), c = clientMetric('fidget');
    return { who: 'social-ops', sub: 'Promo stall for Fidgetly, your own store: TikTok, Reels and Shorts.', body: [
      `<div class="chips">${fidgetLive() ? pill('promotion on', 'ok') : pill('paused', 'mute')}</div>`,
      storeAdsBlock(m),
      c && strs(c.networks).length ? sec('Channels', `<div class="chips">${strs(c.networks).map((n) => `<span class="net ${esc(netKey(n))}">${esc(netName(n))}</span>`).join('')}</div><p class="note">${esc(plural(num(c.posts_next_7d) ?? 0, 'post'))} planned for the next 7 days.</p>`) : ''] };
  };
  LM.billboard = () => {
    const m = metricsOf('social-ops'), a = rec(m.store_ads);
    return { who: 'social-ops', sub: 'Scrolls the numbers that matter this week.', body: [
      tiles([{ k: 'Queued', v: esc(num(m.scheduled_posts_7d) ?? 0), tone: m.scheduled_posts_7d ? 'accent' : 'mute', s: 'posts, 7 days' }, { k: 'Videos', v: esc(num(a.videos_planned) ?? 0), tone: a.videos_planned ? '' : 'mute', s: 'planned' }, { k: 'Clicks', v: esc(num(a.link_clicks_7d) ?? 0), tone: a.link_clicks_7d ? 'ok' : 'mute', s: 'link, 7 days' }], 3),
      (m.scheduled_posts_7d || a.videos_planned) ? '' : emptyBox('Standby: nothing queued yet.')] };
  };
  LM.bazaar = () => { const m = metricsOf('hustle-engine'); return { who: 'hustle-engine', sub: 'Stalls of spinners, cubes and pop-its. New product ideas get tested here.', body: [oppsBlock(m), storeProjectBlock()] }; };
  LM.skyDock = () => {
    const m = metricsOf('hustle-engine'), sh = rec(m.shopify);
    const o = num(sh.orders_7d);
    const line = o == null ? 'One sky-ship stays moored, empty, until Shopify is connected.' : o === 0 ? 'No orders this week, so the sky-ship rides high and empty.' : `${plural(o, 'order')} this week, so cargo ships crowd the dock.`;
    return { who: 'hustle-engine', sub: 'Sky-ships bring in the week’s orders and carry Cap’n Twirl to Clockspire.', body: [`<p class="summary">${esc(line)}<small>Ships at the dock follow orders in the last 7 days.</small></p>`, sec('Shopify', shopTiles(m)), alertsSection(alertsFor('hustle-engine'), { title: 'Harbor alerts' }), dockRun('port'), storeProjectBlock()] };
  };
  LM.warehouse = () => { const m = metricsOf('hustle-engine'); return { who: 'hustle-engine', sub: 'Crates of stock. Red tags are sold out, amber ones are running low.', body: [lowStockBlock(m)] }; };
  function dockRun(biome) {
    const agent = THEME[biome].agent, inf = AGENT_INFO[agent], th = threadOf(agent) || {};
    const tr = transportOf(biome) || { name: 'transport', short: 'transport', icon: 'bird' };
    const w = rec(metricsOf(agent).world);
    const del = num(w.deliveries) || 0;
    const last = th.last_run;
    const cargo = strs(w.bubbles).map(plain).filter(Boolean);
    const lead = last ? `${inf.name}’s last delivery reached ${PLACE.square} ${relPast(last)}.` : `No deliveries yet. ${inf.name} makes the first run after the first check-in.`;
    return sec('Delivery run', `<div class="route">${icon(tr.icon, 2)}<b>${esc(PLACE[biome])}</b><span class="arrow" aria-hidden="true"></span><b>${esc(PLACE.square)}</b></div>
      <p class="summary">${esc(lead)}<small>Travels by ${esc(tr.name)}.</small></p>
      ${tiles([
        { k: 'Parcels', v: esc(del), tone: del ? 'accent' : 'mute', s: 'this check-in' },
        { k: 'Last delivery', v: esc(last ? relPast(last) : 'never'), sm: true, tone: last ? '' : 'mute' },
      ], 2)}
      ${cargo.length ? `<div class="chips">${cargo.map((x) => `<span class="quote">“${esc(x)}”</span>`).join('')}</div>` : ''}`, { icon: tr.icon });
  }
  function dockLandmark(biome, sub, extra) {
    const agent = THEME[biome].agent;
    return () => ({ who: agent, owner: agent, sub, body: [dockRun(biome)].concat(extra ? extra() : []) });
  }
  LM.dockNW = dockLandmark('monastery', `Abbot Quill lands here on a paper kite with scrolls from ${PLACE.monastery}.`, () => [deadlinesBlock(metricsOf('academic-core'), 3)]);
  LM.dockNE = dockLandmark('market', `The neon blimp from ${PLACE.market} moors here with Lumi’s posters.`);
  LM.dockSW = dockLandmark('port', `Cap’n Twirl’s sky-ship ties up here with crates from ${PLACE.port}.`, () => [sec('Shopify', shopTiles(metricsOf('hustle-engine')))]);
  LM.dockSE = dockLandmark('mine', `The minecart rolls in over the sky-rail from ${PLACE.mine} with coins for the vault.`, () => [paydayBlock(metricsOf('ledger-fi'))]);
  LM.kitePad = dockLandmark('monastery', `Abbot Quill launches from here on a paper kite to ${PLACE.square}.`);
  LM.blimpMast = dockLandmark('market', `Lumi boards the neon blimp here for ${PLACE.square}.`);
  LM.railStation = dockLandmark('mine', `Grit Copperpot’s minecart leaves for ${PLACE.square} along the sky-rail.`, () => [paydayBlock(metricsOf('ledger-fi'))]);
  LM.dock = LM.skyDock;

  function openLandmark(key, h, again) {
    if (key === 'questBoard' || key === 'requestBoard') { openRequests(null, { fromMap: !!h }); return; }
    if (key === 'chronicle') { const c = S.landmarks && S.landmarks.chronicle; openChronicle(null, h && c && num(c.y) != null ? (c.y + 0.5) * S.TILE : null); return; }
    if (/holo|jarvis|console/i.test(key)) { openBiome('square'); return; } // the J.A.R.V.I.S. holo-console opens his overview
    const lm = (S.landmarks && pick(S.landmarks, key)) || { island: (h && (h.island || h.biome)) || 'square', label: (h && h.label) || key, x: 40, y: 23 };
    const region = own(THEME, lm.island) ? lm.island : own(THEME, lm.region) ? lm.region : (h && own(THEME, h.biome) ? h.biome : 'square');
    const fn = pick(LM, key);
    const info = fn ? fn() : { who: whoFor((h && h.agent) || THEME[region].agent || 'hub'), sub: '', body: [emptyBox('A quiet corner of the islands.')] };
    current = { kind: 'landmark', key };
    const ownerAgent = info.owner || (info.who && agentInfo(info.who) ? info.who : null);
    const navB = ownerAgent ? AGENT_INFO[ownerAgent].biome : null;
    const goto = navB && navB !== 'square' ? `<div class="btnrow"><button class="btn" data-act="biome" data-arg="${navB}">${esc(AGENT_INFO[ownerAgent].name)}’s full report</button></div>` : '';
    const fy = num(lm.y) != null ? (lm.y + 0.5) * S.TILE : islandCy(region);
    show(region, head({ who: info.who || 'folk', theme: region, kicker: `${THEME[region].name}${ownerAgent ? ' · ' + AGENT_INFO[ownerAgent].name : ''}`, title: info.title || lmLabel(key), sub: info.sub }) +
      `<!--NAV--><div class="panel-body">${info.body.join('')}${goto}</div>`, { nav: navB || region, wy: fy, focus: again ? null : region });
  }

  /* ============================================================ Chronicle
   * J.A.R.V.I.S.'s recaps from S.data.recaps.{daily,weekly,monthly} (newest first). */
  let chronTab = 'daily';
  const CHRON_TABS = [['daily', 'Day'], ['weekly', 'Week'], ['monthly', 'Month']];
  const AREAS = [['school', 'School', 'monastery'], ['money', 'Money', 'mine'], ['social', 'Business', 'market'], ['store', 'Fidgetly', 'port']];
  const STAT_LABEL = { cycles: 'check-ins', skipped_spokes: 'islands resting', hermes_drafts: 'Hermes drafts', quizlet_cards: 'Quizlet cards', deadlines_next_7d: 'deadlines in the next 7 days', study_blocks_set: 'study blocks added', study_blocks: 'study blocks', prep_sets: 'Quizlet sets', deadlines: 'deadlines', orders: 'orders', unfulfilled: 'waiting to ship', posts: 'posts', posts_scheduled: 'posts scheduled' };
  const fmtLongDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
  function periodLabel(p) {
    p = String(p || '');
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p);
    if (m) {
      const n = daysUntil(p);
      return { title: fmtLongDay.format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12))), tag: n === 0 ? 'today' : n === -1 ? 'yesterday' : n < 0 ? `${-n} days ago` : '' };
    }
    m = /^(\d{4})-W(\d{1,2})$/.exec(p);
    if (m) {
      const jan4 = Date.UTC(+m[1], 0, 4), dow = (new Date(jan4).getUTCDay() + 6) % 7;
      const mon = jan4 - dow * DAY + (+m[2] - 1) * 7 * DAY;
      return { title: `Week ${+m[2]}`, tag: `${fmtUTCShort.format(new Date(mon + DAY / 2))} – ${fmtUTCShort.format(new Date(mon + 6 * DAY + DAY / 2))}` };
    }
    if (/^\d{4}-\d{2}$/.test(p)) return { title: monthLabel(p), tag: '' };
    return { title: p || 'Undated entry', tag: '' };
  }
  function statValue(k, v) {
    if (typeof v === 'number' && isFinite(v)) {
      if (/income|spend|spent|revenue|saved|earn|cost|amount|paid|money|balance|retainer/i.test(k)) return money(v);
      if (/hours?$/i.test(k)) return (Math.round(v * 10) / 10) + ' h';
      if (/pct|percent/i.test(k)) return Math.round(v) + '%';
      return (Math.round(v * 10) / 10).toLocaleString('en-US');
    }
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (v == null || v === '') return '—';
    if (Array.isArray(v)) return String(v.length);
    if (typeof v === 'object') return '…';
    return plain(String(v));
  }
  function statKey(k, v) {
    let l = pick(STAT_LABEL, k) || String(k).replace(/_/g, ' ').replace(/\bpct\b/i, '%').replace(/\s+hours?$/i, '').replace(/\b7d\b/, '(7 days)').trim();
    if (v === 1 && /s$/.test(l) && !/\bss$/.test(l)) l = l.replace(/^(\S+?)s\b/, '$1').replace(/(\w)s$/, '$1');
    return l;
  }
  function statsTable(stats) {
    if (!stats || typeof stats !== 'object') return '';
    const keys = AREAS.map((a) => a[0]).concat(Object.keys(stats).filter((k) => k !== 'system' && !AREAS.some((a) => a[0] === k)));
    const rows = keys.filter((k) => own(stats, k) && stats[k] && typeof stats[k] === 'object' && Object.keys(stats[k]).length).map((k) => {
      const a = AREAS.find((x) => x[0] === k) || [k, cap(k), 'square'];
      const cells = Object.keys(stats[k]).map((sk) => `<span><b>${esc(statValue(sk, stats[k][sk]))}</b>${esc(statKey(sk, stats[k][sk]))}</span>`).join('');
      return `<tr><th scope="row" style="--c:${THEME[a[2]] ? THEME[a[2]].color : 'var(--border-strong)'}">${esc(a[1])}</th><td>${cells}</td></tr>`;
    });
    return rows.length ? `<table class="stats"><tbody>${rows.join('')}</tbody></table>` : '';
  }
  function chronEntry(e) {
    const pl = periodLabel(e.period);
    const hl = strs(e.highlights).map(plain).filter(Boolean), nu = strs(e.needs_you).map(plain).filter(Boolean);
    const st = statsTable(e.stats);
    return `<article class="chron">
      <h3 class="chron-h">${esc(pl.title)}${pl.tag ? `<small>${esc(pl.tag)}</small>` : ''}</h3>
      ${str(e.chronicle) ? `<p class="chron-lead">${esc(plain(e.chronicle))}<cite>J.A.R.V.I.S., ${esc(PLACE.square)}</cite></p>` : `<p class="note">No chronicle text for this entry.</p>`}
      ${hl.length ? sec('Highlights', `<ul class="chron-list">${hl.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`, { n: hl.length }) : ''}
      ${nu.length ? sec('Needs you', `<ul class="chron-list you">${nu.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`, { n: nu.length }) : ''}
      ${st ? sec('By the numbers', st) : ''}
    </article>`;
  }
  function chronEmpty(tab) {
    const what = tab === 'weekly' ? 'weekly' : tab === 'monthly' ? 'monthly' : 'daily';
    if (what === 'weekly') {
      const today = todayKey();
      const sun = objs(D().runs).some((r) => { const p = parseWhen(r.started); return p && new Date(p.day).getUTCDay() === 0 && daysFrom(p.day, today) > -8 && daysFrom(p.day, today) <= 0; });
      if (sun) return 'Last Sunday’s weekly recap is missing. J.A.R.V.I.S. writes it at the next check-in.';
    }
    const n = nextCycleOn(what === 'weekly' ? (dow) => dow === 0 : what === 'monthly' ? (dow, dom) => dom === 1 : () => true);
    if (!n) return `No check-in time is set, so no ${what} entries yet.`;
    if (n.running) return `The first ${what} entry appears when ${cyclePhrase(n)} finishes.`;
    return `The first ${what} entry appears after ${cyclePhrase(n)}.`;
  }
  function chronicleList(tab) {
    return arr(rec(D().recaps)[tab]).filter((e) => e && typeof e === 'object').slice().sort((a, b) => String(b.period || '').localeCompare(String(a.period || '')));
  }
  /** tab: switch to that tab (null from the HUD, keys, lectern or hub: back to Day). */
  function openChronicle(tab, wy, again) {
    chronTab = tab && CHRON_TABS.some(([k]) => k === tab) ? tab : 'daily';
    const switching = !!tab && current && current.kind === 'chronicle';
    current = { kind: 'chronicle', key: chronTab };
    const list = chronicleList(chronTab);
    const tabs = `<nav class="ph-nav" role="tablist" aria-label="Chronicle period">${CHRON_TABS.map(([k, l]) => {
      const n = chronicleList(k).length;
      return `<button role="tab" data-act="chron-tab" data-arg="${k}" aria-selected="${k === chronTab}" style="--c:var(--jarvis)">${esc(l)}${n ? ` <span class="tag">${n}</span>` : ''}</button>`;
    }).join('')}</nav>`;
    const body = list.length ? list.slice(0, 31).map(chronEntry).join('') : emptyBox(chronEmpty(chronTab), 'scroll');
    const keep = switching && panel.classList.contains('top') ? S.H : wy;
    show('square', head({ who: 'hub', theme: 'square', kicker: `${PLACE.square} · J.A.R.V.I.S.`, title: 'The Chronicle', sub: 'J.A.R.V.I.S.’s log of what every island actually did.' }) +
      `${tabs}<div class="panel-body" role="tabpanel">${body}</div>`, { nav: false, wy: keep, tall: true, focus: switching || again ? null : 'square' });
    if (switching) { const b = panel.querySelector(`[data-act="chron-tab"][data-arg="${chronTab}"]`); if (b) b.focus({ preventScroll: true }); }
  }
  function chronicleTeaser() {
    const e = chronicleList('daily')[0];
    if (!e || !str(e.chronicle)) return sec('The Chronicle', emptyBox(chronEmpty('daily'), 'scroll'), { icon: 'scroll' });
    const t = plain(e.chronicle);
    const cut = t.length > 220 ? t.slice(0, 220).replace(/\s+\S*$/, '') + '…' : t;
    return sec('The Chronicle', `<p class="summary">${esc(cut)}<small>${esc(periodLabel(e.period).title)}</small></p><div class="btnrow"><button class="btn" data-act="chronicle">${icon('scroll', 2)} Read the Chronicle</button></div>`, { icon: 'scroll' });
  }

  /* ===================================================================== db
   * window.claude.use('db'): collections `quests` (requests to J.A.R.V.I.S.), `checks` (agent tasks Hudson
   * ticked: doc id = task id, {task, done: true, at}; unticking deletes the doc) and `todos` (Hudson's own
   * list: {text, done, created, updated, due?, reply?, task_id?}). Listeners recover from dropped
   * connections with backoff; a revoked or missing grant makes the lists read-only for this visit. */
  let db = null, dbState = 'none', canWrite = true;
  const L = { quests: { state: 'off', tries: 0 }, checks: { state: 'off', tries: 0 }, todos: { state: 'off', tries: 0 } };
  const TERMINAL = new Set(['revoked', 'not_granted', 'capability_disabled', 'capability_removed', 'invalid_argument', 'transform_error']);
  const KNOWN = new Set(['invalid_argument', 'resource_exhausted', 'quota_exceeded', 'unavailable', 'revoked', 'not_granted', 'capability_disabled', 'capability_removed', 'transform_error']);
  let quests = [], questsLoaded = false;
  let checks = Object.create(null);       // task id -> {done, at}
  const pendingCheck = Object.create(null); // task id -> {v, confirmed}
  let todosRemote = Object.create(null);   // doc id -> body
  const todoOverride = Object.create(null); // doc id -> {data} | {deleted: true}, plus confirmed
  let todosLoaded = false;
  const writeChain = Object.create(null);

  function initDb() {
    if (!(window.claude && typeof window.claude.use === 'function')) { dbState = 'none'; refreshAll(); return; }
    dbState = 'pending';
    let p;
    try { p = window.claude.use('db'); } catch (e) { dbState = 'unavailable'; refreshAll(); return; }
    Promise.resolve(p).then((d) => {
      if (!d || typeof d.collection !== 'function') { dbState = 'unavailable'; refreshAll(); return; }
      db = d; dbState = 'ready';
      listen('quests', () => db.collection('quests').orderBy('created', 'desc').limit(50), (snap) => {
        quests = arr(snap && snap.docs).map((doc) => Object.assign({}, rec(doc.data && doc.data()), { id: doc.id }));
        questsLoaded = true;
      });
      listen('checks', () => db.collection('checks').limit(500), (snap) => {
        const next = Object.create(null);
        for (const doc of arr(snap && snap.docs)) { const b = rec(doc.data && doc.data()); const task = str(b.task) || doc.id; if (b.done === true) next[task] = b; }
        checks = next;
        for (const k of Object.keys(pendingCheck)) if (pendingCheck[k].confirmed) delete pendingCheck[k];
      });
      listen('todos', () => db.collection('todos').limit(500), (snap) => {
        const next = Object.create(null);
        for (const doc of arr(snap && snap.docs)) next[doc.id] = rec(doc.data && doc.data());
        todosRemote = next; todosLoaded = true;
        for (const k of Object.keys(todoOverride)) if (todoOverride[k].confirmed) delete todoOverride[k];
      });
      refreshAll();
    }, () => { dbState = 'unavailable'; refreshAll(); });
  }
  function listen(name, query, onSnap) {
    const st = L[name];
    st.state = 'connecting';
    try {
      st.unsub = query().onSnapshot((snap) => {
        st.state = 'live'; st.tries = 0;
        try { onSnap(snap); } catch (e) { console.error('db snapshot', name, e); }
        refreshAll();
      }, (err) => {
        st.unsub = null;
        const code = err && err.code;
        if (TERMINAL.has(code)) { st.state = 'dead'; if (code !== 'invalid_argument' && code !== 'transform_error') canWrite = false; }
        else {
          st.state = 'retrying';
          const wait = [2e3, 5e3, 15e3, 30e3, 60e3][Math.min(st.tries++, 4)];
          setTimeout(() => { if (db && st.state === 'retrying') listen(name, query, onSnap); }, wait);
        }
        refreshAll();
      });
    } catch (e) { st.state = 'dead'; console.error('db listen', name, e); }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function attempt(op, n) {
    let p;
    try { p = op(); } catch (e) { return Promise.reject({ code: 'invalid_argument', message: String((e && e.message) || e) }); }
    return Promise.resolve(p).catch((err) => {
      const code = err && err.code;
      if (n === 0 && (code === 'unavailable' || !KNOWN.has(code))) return sleep(300 + Math.random() * 500).then(() => attempt(op, 1));
      throw err;
    });
  }
  /** One write at a time per document. */
  function dbWrite(path, op) {
    const prev = own(writeChain, path) ? writeChain[path] : Promise.resolve();
    const next = prev.catch(() => {}).then(() => attempt(op, 0));
    writeChain[path] = next;
    return next;
  }
  function writeFailed(err, what) {
    const code = err && err.code;
    let msg;
    if (code === 'revoked' || code === 'not_granted' || code === 'capability_disabled' || code === 'capability_removed' || code === 'invalid_argument') { canWrite = false; msg = `Couldn’t save ${what}. Your list is read-only here.`; }
    else if (code === 'resource_exhausted') msg = `Too many changes at once. Give it a moment, then try ${what} again.`;
    else if (code === 'quota_exceeded') msg = 'The list is full. Delete a few finished to-dos, then try again.';
    else msg = `Couldn’t save ${what}. Check your connection and try again.`;
    showToast(msg, 'alert', 5000);
    refreshAll();
  }
  /** db document ids allow letters, digits and _ - . ~ : @ + only. */
  function safeId(id) {
    let s = String(id).replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 180);
    if (!s || s === '.' || s === '..') s = '_' + Math.abs([...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
    return s;
  }
  const writable = (name) => !!db && dbState === 'ready' && canWrite && L[name].state !== 'dead';
  function checkDone(id) { if (own(pendingCheck, id)) return pendingCheck[id].v; return !!(own(checks, id) && checks[id].done === true); }
  function refreshAll() { renderTodos(); refreshBoard(); if (todayBuilt) renderTodayDbNote(); try { hudUpdate(); } catch (e) { console.error(e); } }

  /* ============================================================== to-dos */
  /** Hudson's own to-dos: db docs merged with optimistic local changes. */
  function ownTodos() {
    const ids = new Set(Object.keys(todosRemote).concat(Object.keys(todoOverride)));
    const out = [];
    for (const id of ids) {
      const o = own(todoOverride, id) ? todoOverride[id] : null;
      if (o && o.deleted) continue;
      const d = o ? o.data : todosRemote[id];
      if (!d || typeof d !== 'object') continue;
      const text = str(d.text);
      if (!text) continue;
      const due = parseWhen(d.due);
      out.push({ id, text, done: d.done === true, created: str(d.created), updated: str(d.updated), due: due && due.allDay ? due.day : null, reply: str(d.reply), raw: d });
    }
    return out;
  }
  const byDueThenPriority = (a, b) => { const da = parseWhen(a.due), dbb = parseWhen(b.due); return (da ? da.day : Infinity) - (dbb ? dbb.day : Infinity) || (num(a.priority) || 9) - (num(b.priority) || 9); };
  /** Every to-do, own and agent, sorted: overdue, today, dated, undated; agent tasks by priority. */
  function todoItems() {
    const today = todayKey();
    const items = [];
    for (const t of ownTodos()) {
      const up = parseWhen(t.updated);
      items.push({ key: 'o:' + t.id, kind: 'own', id: t.id, text: t.text, done: t.done, doneDay: t.done && up ? up.day : null, dueDay: t.due, reply: plain(t.reply), created: t.created, raw: t.raw });
    }
    for (const t of humanTasks()) {
      const due = parseWhen(t.due), ck = own(checks, t.id) ? parseWhen(checks[t.id].at) : null;
      items.push({ key: 'a:' + t.id, kind: 'agent', id: t.id, text: plain(t.title), agent: t.agent, priority: num(t.priority) || 9, dueDay: due ? due.day : null, done: checkDone(t.id), doneDay: ck ? ck.day : today, link: taskLink(t), hint: plain(str(t.hint)) });
    }
    const bucket = (it) => (it.dueDay == null ? 3 : it.dueDay < today ? 0 : it.dueDay === today ? 1 : 2);
    items.sort((a, b) => bucket(a) - bucket(b) || (a.dueDay ?? 0) - (b.dueDay ?? 0) || (a.kind === b.kind ? 0 : a.kind === 'own' ? -1 : 1)
      || (a.kind === 'agent' ? a.priority - b.priority : String(b.created).localeCompare(String(a.created))));
    return items;
  }
  /** Open to-dos for the villagers' bubbles: [{kind: 'own'|'agent', id, text, due ('YYYY-MM-DD'|null), overdue, agent}]. */
  function openTodos() {
    const today = todayKey();
    return todoItems().filter((x) => !x.done).map((x) => ({ kind: x.kind, id: x.id, text: x.text, due: x.dueDay != null ? isoDay(x.dueDay) : null, overdue: x.dueDay != null && x.dueDay < today, agent: x.agent || null }));
  }

  /* ================================================================ Today */
  let todayBuilt = false, todayOpen = false;
  const uidMap = new Map();
  const uidOf = (key) => { if (!uidMap.has(key)) uidMap.set(key, 'tdi' + uidMap.size); return uidMap.get(key); };
  const sticky = new Map(); // key -> {list: 'open'|'done', until}
  let justAdded = null, stickyTimer = 0;
  function buildToday() {
    if (!todayEl) return;
    todayEl.innerHTML = `<div class="td">
      <header class="td-head" id="td-head"></header>
      <section class="td-sec" id="td-brief" aria-label="J.A.R.V.I.S. brief"></section>
      <section class="td-sec" id="td-cal" aria-labelledby="td-cal-h"></section>
      <section class="td-sec" id="td-todos" aria-labelledby="td-todo-h">
        <h2 class="td-h" id="td-todo-h"><i style="--c:var(--brass)"></i>To-dos <span class="n" id="td-todo-n"></span></h2>
        <form class="td-add" id="td-add" autocomplete="off">
          <span class="td-in"><input id="td-new" type="text" maxlength="200" placeholder="Add a to-do" aria-label="New to-do"><kbd aria-hidden="true">N</kbd></span>
          <select id="td-due" aria-label="When it’s due"><option value="">No date</option><option value="today">Today</option><option value="tomorrow">Tomorrow</option><option value="pick">Pick a date…</option></select>
          <button class="td-addbtn" type="submit" aria-label="Add to-do" title="Add (Enter)">+</button>
          <input id="td-date" type="date" aria-label="Due date" hidden>
        </form>
        <p class="td-note" id="td-dbnote" hidden></p>
        <ul class="td-list" id="td-list"></ul>
        <details class="td-done" id="td-done" hidden><summary id="td-done-s">Done today</summary><ul class="td-list" id="td-donelist"></ul></details>
      </section>
      <section class="td-sec" id="td-school" aria-labelledby="td-school-h"></section>
      <section class="td-sec" id="td-social" aria-labelledby="td-social-h"></section>
      <section class="td-sec td-money" id="td-money" aria-labelledby="td-money-h"></section>
      <footer class="td-foot" id="td-foot"></footer>
    </div>`;
    todayEl.addEventListener('click', onTodayClick);
    todayEl.addEventListener('change', onTodayChange);
    todayEl.addEventListener('submit', onTodayAdd);
    todayEl.addEventListener('focusout', () => { if (sticky.size) setTimeout(renderTodos, 0); });
    todayBuilt = true;
    renderToday(true);
  }
  const setBlock = (id, html) => { const el = $(id); if (!el) return; const h = html || ''; if (el.__html !== h) { el.__html = h; el.innerHTML = h; } el.hidden = !h; };
  function renderToday(full) {
    if (!todayBuilt) return;
    const parts = [['td-head', headBlock], ['td-brief', briefBlock], ['td-cal', calBlock], ['td-school', schoolBlock], ['td-social', socialBlock], ['td-money', moneyBlock], ['td-foot', footBlock]];
    for (const [id, fn] of parts) { try { setBlock(id, fn()); } catch (e) { console.error('today block', id, e); setBlock(id, ''); } }
    renderTodayDbNote();
    renderTodos();
    if (full) { const d = $('td-due'); if (d) d.value = ''; const dt = $('td-date'); if (dt) dt.hidden = true; }
  }
  function headBlock() {
    const now = S.now(), p = S.nyParts(now);
    const b = rec(D().brief), briefToday = str(b.date) === isoDay(dayKeyOf(p));
    const part = p.hour < 5 ? 'evening' : p.hour < 12 ? 'morning' : p.hour < 17 ? 'afternoon' : 'evening';
    let greet = `Good ${part}, ${address()}.`;
    const bg = plain(str(b.greeting));
    if (briefToday && bg) { const m = /\b(morning|afternoon|evening)\b/i.exec(bg); if (!m || m[1].toLowerCase() === part) greet = bg; }
    const line = briefToday ? plain(str(b.line)) : '';
    const btn = layoutMode === 'phone' ? `<button class="td-x" data-act="today-close" title="Show the world">World ${icon('ext', 2)}</button>` : `<button class="td-x" data-act="today-close" aria-label="Close Today" title="Close (Esc)">${icon('close', 2)}</button>`;
    return `<div class="td-top"><h1 class="td-date">${esc(fmtLongToday.format(now))}${D().sample ? '<span class="td-sample" title="Previewing with example data">SAMPLE</span>' : ''}</h1>${btn}</div>`
      + `<div class="td-hello"><span class="td-holo"><img src="${portraitURL('hub', 'square')}" alt="J.A.R.V.I.S."></span><div><p class="td-greet">${esc(greet)}</p>${line ? `<p class="td-line">${esc(line)}</p>` : ''}</div></div>`;
  }
  const BRIEF_SKIP = /^(today|school|your to-?dos|to-?dos|calendar)$/i;
  function briefBlock() {
    const b = rec(D().brief);
    const secs = objs(b.sections).map((s) => ({ title: plain(str(s.title)), items: strs(s.items).map(plain).filter(Boolean) })).filter((s) => s.title && s.items.length && !BRIEF_SKIP.test(s.title));
    if (!secs.length) return '';
    const p = parseWhen(b.date), today = todayKey();
    const fresh = p && p.day === today;
    let h = 'J.A.R.V.I.S. brief', small = '';
    if (fresh) { const w = parseWhen(b.written); if (w && w.at) small = clockOf(w.at); }
    else if (p) { const n = daysFrom(p.day, today); h = n === -1 ? 'From yesterday’s brief' : n > -7 && n < 0 ? `From ${fmtUTCWeekday.format(dayDate(p.day))}’s brief` : `From the ${fmtUTCShort.format(dayDate(p.day))} brief`; }
    else h = 'From the last brief';
    return `<div class="td-card td-brief"><h2 class="td-h"><i></i>${esc(h)}${small ? ` <small>${esc(small)}</small>` : ''}</h2>${secs.map((s) => `<div class="td-sub"><h3>${esc(s.title)}</h3><ul class="td-bul">${s.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div>`;
  }
  /** Calendar events (state/calendar.json) with all-day spans and NY times resolved. */
  function calEvents() {
    const cal = rec(D().calendar);
    // Until J.A.R.V.I.S. has written a calendar (no `updated` yet), show Abbot Quill's study blocks
    // and due dates so Today is never emptier than the school data behind it.
    let list = objs(cal.events);
    if (!list.length && !cal.updated) {
      const m = metricsOf('academic-core') || {};
      list = objs(m.study_blocks).map((b) => ({ title: b.title, start: b.start, end: b.end, all_day: false, source: 'study-block' }))
        .concat(objs(m.deadlines).map((d) => ({ title: 'Due: ' + str(d.title) + (d.course ? ' (' + str(d.course) + ')' : ''), start: d.due, all_day: true, source: 'classroom' })));
    }
    return list.map((e) => {
      const s = parseWhen(e.start);
      const title = plain(str(e.title));
      if (!s || !title) return null;
      const en = parseWhen(e.end);
      const allDay = e.all_day === true || s.allDay;
      const startDay = s.day;
      const endDay = allDay ? (en && en.day > startDay ? en.day : startDay + DAY) : startDay + DAY;
      const end = !allDay && s.at ? (en && en.at && en.at > s.at ? en.at : s.at + 3600e3) : null;
      return { title, loc: plain(str(e.location)), source: str(e.source), allDay, startDay, endDay, at: allDay ? null : s.at, end };
    }).filter(Boolean);
  }
  const evSub = (e) => [e.loc, e.source === 'study-block' ? 'Study block' : e.source === 'todo' ? 'From your to-dos' : ''].filter(Boolean).join(' · ');
  function calBlock() {
    const today = todayKey(), now = S.now().getTime();
    const evs = calEvents();
    const allDay = evs.filter((e) => e.allDay && e.startDay <= today && today < e.endDay);
    const timed = evs.filter((e) => !e.allDay && e.startDay === today).sort((a, b) => a.at - b.at);
    const cur = timed.filter((e) => e.at <= now && now < e.end);
    const next = cur.length ? null : timed.find((e) => e.at > now);
    let html = `<h2 class="td-h" id="td-cal-h"><i style="--c:var(--jarvis)"></i>Today</h2>`;
    if (!allDay.length && !timed.length) html += '<p class="td-empty">Nothing on the calendar today.</p>';
    if (allDay.length) html += `<div class="td-chips">${allDay.map((e) => `<div class="td-chip"><b>All day</b><span>${esc(e.title)}</span></div>`).join('')}</div>`;
    if (timed.length) {
      html += `<ul class="td-cal">${timed.map((e) => {
        const isCur = cur.includes(e), isNext = e === next, past = !isCur && e.end <= now;
        const left = isNext ? e.at - now : 0;
        const flag = isCur ? 'Now' : isNext ? (left < 2 * 3600e3 ? `In ${left < 3600e3 ? Math.max(1, Math.round(left / 60e3)) + ' min' : dur(left)}` : 'Next') : '';
        const sub = evSub(e);
        return `<li class="td-ev${isCur || isNext ? ' cur' : ''}${past ? ' past' : ''}"><time>${esc(clockOf(e.at))}</time><span class="tt">${esc(e.title)}</span>${flag ? `<span class="flag">${esc(flag)}</span>` : '<span></span>'}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</li>`;
      }).join('')}</ul>`;
    }
    // the rest of the week, grouped by day
    const days = [];
    for (let d = 1; d <= 6; d++) {
      const k = today + d * DAY;
      const ad = evs.filter((e) => e.allDay && e.startDay <= k && k < e.endDay && (e.startDay === k || d === 1));
      const tm = evs.filter((e) => !e.allDay && e.startDay === k).sort((a, b) => a.at - b.at);
      if (ad.length || tm.length) days.push({ k, d, ad, tm });
    }
    if (days.length) {
      html += `<div class="td-days"><h3>Next few days</h3>${days.map((x) => `<div class="td-day"><b>${esc(x.d === 1 ? 'Tmrw' : fmtUTCWd.format(dayDate(x.k)))}</b><div>${x.ad.map((e) => `<span>${esc(e.title)}</span>`).join('')}${x.tm.map((e) => `<span><time>${esc(clockOf(e.at))}</time>${esc(e.title)}</span>`).join('')}</div></div>`).join('')}</div>`;
    }
    return html;
  }
  function schoolBlock() {
    const m = metricsOf('academic-core');
    const today = todayKey(), now = S.now().getTime();
    const sets = objs(m.prep_sets).filter((s) => str(s.title));
    const dl = objs(m.deadlines).map((d) => ({ d, p: parseWhen(d.due) })).filter((x) => x.p && str(x.d.title)).map((x) => Object.assign(x, { n: daysFrom(x.p.day, today) }))
      .filter((x) => x.n >= 0 && x.n <= 7).sort((a, b) => a.p.day - b.p.day || String(a.d.title).localeCompare(String(b.d.title)));
    const calStarts = calEvents().filter((e) => !e.allDay && e.startDay === today).map((e) => e.at);
    const blocks = objs(m.study_blocks).map((b) => ({ b, sp: blockSpan(b) })).filter((x) => x.sp && x.sp.s.day === today && x.sp.end > now && !calStarts.some((t) => Math.abs(t - x.sp.start) < 60e3)).sort((a, b) => a.sp.start - b.sp.start);
    const heads = alertsFor('academic-core').filter((a) => !isWarn(a));
    if (!dl.length && !blocks.length && !heads.length) return '';
    let html = `<h2 class="td-h" id="td-school-h"><i style="--c:var(--school)"></i>School${dl.length ? ` <span class="n">${dl.length}</span>` : ''}<button class="td-go" data-act="biome" data-arg="monastery">${esc(PLACE.monastery)}</button></h2>`;
    if (dl.length) {
      html += `<ul class="td-rows">${dl.map(({ d, p }) => {
        const kind = /test|exam/i.test(str(d.type) + ' ' + str(d.title)) ? 'Test' : /quiz/i.test(str(d.type) + ' ' + str(d.title)) ? 'Quiz' : '';
        const set = kind ? sets.find((s) => str(s.file).split('/').pop().startsWith(isoDay(p.day))) : null;
        const sub = [plain(str(d.course)), set ? `Quizlet set ready${num(set.cards) ? ' (' + plural(set.cards, 'card') + ')' : ''}` : ''].filter(Boolean).join(' · ');
        return `<li class="td-row"><span class="when ${dueTone(p.day)}">${esc(dueWord(p.day))}</span><span class="tt">${esc(plain(d.title))}${kind ? `<span class="tag amber">${kind}</span>` : ''}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</li>`;
      }).join('')}</ul>`;
    }
    if (blocks.length) html += `<div class="td-sub"><h3>Study blocks today</h3><ul class="td-cal">${blocks.map(({ b, sp }) => `<li class="td-ev${sp.start <= now ? ' cur' : ''}"><time>${esc(clockOf(sp.start))}</time><span class="tt">${esc(plain(b.title))}</span>${sp.start <= now ? '<span class="flag">Now</span>' : '<span></span>'}</li>`).join('')}</ul></div>`;
    for (const a of heads) html += `<p class="td-heads">${icon('info', 2)}<span><b>Heads-up:</b> ${esc(plain(a.msg))}</span></p>`;
    return html;
  }
  function socialBlock() {
    const m = metricsOf('social-ops');
    const clients = realClients();
    const ma = metricoolAlert();
    const drafts = num(m.drafts_pending) || 0;
    if (!clients.length && !ma && !drafts) return '';
    let html = `<h2 class="td-h" id="td-social-h"><i style="--c:var(--social)"></i>${esc(bizName())}<button class="td-go" data-act="biome" data-arg="market">${esc(PLACE.market)}</button></h2>`;
    for (const c of clients) {
      const met = clientMetric(c.name), st = statusParts(c.status);
      const nets = strs(met && met.networks).length ? strs(met.networks) : strs(c.accounts);
      const posts = met ? num(met.posts_next_7d) : null;
      const tag = num(c.retainer) != null ? `${money(c.retainer, 0)}/mo` : st.main;
      const lines = [];
      if (posts != null) lines.push(`${plural(posts, 'post')} queued for the next 7 days`);
      if (c.owner_approved === false) lines.push('Auto-posting waits for the owner’s OK');
      const raw = linkIn('', c.raw_folder_url);
      html += `<div class="td-client"><div class="nm">${esc(plain(c.name))}${tag ? `<span class="tag">${esc(tag)}</span>` : ''}</div><div class="sub">${esc([plain(c.location), nets.map(netName).join(', ')].filter(Boolean).join(' · '))}</div>${lines.length || raw ? `<ul class="td-lines" style="--c:var(--social)">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}${raw ? `<li>Footage goes in the Raw folder ${extLink({ url: raw.url, label: 'Open Raw folder' })}</li>` : ''}</ul>` : ''}</div>`;
    }
    const gen = [];
    if (drafts) gen.push(esc(`${plural(drafts, 'draft')} waiting for your review`));
    if (ma) { const l = linkIn(ma.msg, ma.link); gen.push(`No social accounts are linked in Metricool yet${l ? ' ' + extLink({ url: l.url, label: 'Link accounts' }) : ''}`); }
    if (gen.length) html += `<ul class="td-lines" style="--c:var(--warn)">${gen.map((g) => `<li>${g}</li>`).join('')}</ul>`;
    return html;
  }
  const isMoneyDay = () => { const wd = WEEKDAYS[new Date(todayKey()).getUTCDay()]; return moneyDays().some((d) => { const l = d.toLowerCase(); return l === wd || l.slice(0, 3) === wd.slice(0, 3); }); };
  function moneyBlock() {
    if (!isMoneyDay()) return '';
    const m = metricsOf('ledger-fi');
    const wk = m.week && typeof m.week === 'object' ? m.week : null;
    const connected = m.bank_feed === 'connected';
    let html = `<h2 class="td-h" id="td-money-h"><i style="--c:var(--b-mine)"></i>Money <small>weekly check-in</small><button class="td-go" data-act="biome" data-arg="mine">${esc(PLACE.mine)}</button></h2>`;
    const inc = wk ? num(wk.income ?? wk.week_income) : num(m.month_income), sp = wk ? num(wk.spend ?? wk.spent ?? wk.week_spend) : num(m.month_spend);
    const real = connected || (wk && (inc || sp)) || (!wk && moneyTracked(m));
    if (!real) {
      html += `<div class="td-card"><p class="td-note" style="color:var(--text-2)">Bank alerts aren’t on yet, so Grit can’t see purchases or paychecks. Ask J.A.R.V.I.S. to walk you through turning on M&amp;T email alerts.</p>${tiles([{ k: 'In', v: '—', tone: 'mute' }, { k: 'Out', v: '—', tone: 'mute' }, { k: 'Net', v: '—', tone: 'mute' }], 3)}</div>`;
      return html;
    }
    const net = inc != null && sp != null ? inc - sp : null;
    const cats = objs(wk ? (wk.categories || wk.top_categories) : m.categories).filter((c) => str(c.name) && num(c.spent) != null).sort((a, b) => b.spent - a.spent).slice(0, 3);
    const pc = rec(wk ? (wk.paycheck || wk.last_paycheck) : m.last_paycheck);
    const label = wk ? 'This week' : `${monthLabel(m.month).replace(/ \d{4}$/, '')} so far`;
    html += `<div class="td-card"><div class="td-sub"><h3>${esc(label)}</h3></div>${tiles([
      { k: 'In', v: esc(moneyShort(inc)), tone: inc ? 'ok' : 'mute' },
      { k: 'Out', v: esc(moneyShort(sp)), tone: sp ? '' : 'mute' },
      { k: 'Net', v: esc(net == null ? '—' : (net > 0 ? '+' : '') + moneyShort(net)), tone: net == null ? 'mute' : net >= 0 ? 'ok' : 'crit' },
    ], 3)}${cats.length ? `<ul class="td-lines" style="--c:var(--b-mine)">${cats.map((c) => `<li>${esc(plain(c.name))} <b style="color:var(--text)">${esc(money(c.spent))}</b></li>`).join('')}</ul>` : ''}${num(pc.amount) != null ? `<p class="td-note">Last paycheck <b style="color:var(--ok)">+${esc(money(pc.amount))}</b>${pc.date ? ' · ' + esc(dayLabel(pc.date)) : ''}</p>` : ''}</div>`;
    return html;
  }
  function footBlock() {
    const g = parseWhen(D().generated), now = S.now().getTime();
    const n = nextCheckIn();
    const old = g && g.at && now - g.at > 26 * 3600e3;
    const up = g && g.at ? `Updated ${clockWhen(g.at)}` : 'Not updated yet';
    const nx = n ? ` · next check-in ${clockWhen(n.at)}` : '';
    let html = old
      ? `<p class="warn">${esc(`This data is from ${dayLabel(D().generated)}. It refreshes at the next check-in${n ? ' (' + clockWhen(n.at) + ')' : ''}.`)}</p>`
      : `<p>${esc(up + nx)}</p>`;
    if (!isMoneyDay()) html += `<p class="faint">Money check-in: ${esc(moneyDaysText())}</p>`;
    html += `<div class="btnrow"><button class="btn ask" data-act="requests">${icon('ask', 2)} Ask J.A.R.V.I.S.</button><button class="btn" data-act="chronicle">${icon('scroll', 2)} Chronicle</button></div>`;
    return html;
  }
  function renderTodayDbNote() {
    const el = $('td-dbnote');
    if (!el) return;
    let t = '', warn = false;
    if (dbState === 'none') t = 'Preview only: to-dos save when this page is open on claude.ai.';
    else if (dbState === 'unavailable') t = 'To-dos aren’t available in this view.';
    else if (dbState === 'pending') t = 'Connecting…';
    else if (!canWrite || L.todos.state === 'dead') { t = 'Your list is read-only right now. Showing what was loaded.'; warn = true; }
    else if (L.todos.state === 'retrying') t = 'Reconnecting…';
    if (el.textContent !== t) el.textContent = t;
    el.hidden = !t; el.classList.toggle('warn', warn);
    const live = writable('todos');
    for (const id of ['td-new', 'td-due', 'td-date']) { const x = $(id); if (x && x.disabled === live) x.disabled = !live; }
    const btn = todayEl && todayEl.querySelector('.td-addbtn'); if (btn) btn.disabled = !live;
    const inp = $('td-new'); if (inp) { const ph = dbState === 'pending' ? 'Connecting…' : 'Add a to-do'; if (inp.placeholder !== ph) inp.placeholder = ph; }
  }
  function todoRow(it) {
    const live = it.kind === 'own' ? writable('todos') : writable('checks');
    const id = uidOf(it.key);
    const dueCls = it.dueDay == null ? '' : it.dueDay < todayKey() ? ' over' : it.dueDay === todayKey() ? ' today' : '';
    const meta = [];
    // the due tag leads the meta row under the text, so the text gets the column's full width
    if (it.dueDay != null) meta.push(`<span class="td-due${dueCls}">${esc(dueWord(it.dueDay))}</span>`);
    if (it.kind === 'agent') meta.push(who(it.agent));
    if (it.hint) meta.push(`<span class="note">${esc(it.hint)}</span>`);
    if (it.link) meta.push(extLink(it.link));
    return `<li class="td-item${it.done ? ' done' : ''}${live ? '' : ' ro'}${justAdded === it.key ? ' new' : ''}" data-key="${esc(it.key)}">`
      + `<input type="checkbox" class="td-cb" id="${id}" data-role="tick"${it.done ? ' checked' : ''}${live ? '' : ' disabled'}>`
      + `<label class="td-text" for="${id}">${esc(it.text)}</label>`
      + (it.kind === 'own' && live ? `<button class="td-del" type="button" data-role="del" aria-label="Delete “${esc(it.text)}”" title="Delete">${icon('del', 2)}</button>` : '<span></span>')
      + (meta.length ? `<div class="td-meta">${meta.join('')}</div>` : '')
      + (it.reply ? `<p class="td-reply">${icon('holo', 2)}<span>${esc(it.reply)}</span></p>` : '')
      + '</li>';
  }
  const keyOfEl = (el) => { const li = el && el.closest && el.closest('[data-key]'); return li ? li.dataset.key : null; };
  function renderTodos() {
    if (!todayBuilt) return;
    const ul = $('td-list'), dl = $('td-donelist'), det = $('td-done');
    if (!ul || !dl) return;
    const today = todayKey(), nowT = performance.now();
    const active = document.activeElement;
    const aKey = active && todayEl.contains(active) ? keyOfEl(active) : null, aRole = active && active.dataset ? active.dataset.role : null;
    const open = [], done = [];
    let nextWake = Infinity;
    for (const it of todoItems()) {
      let list = it.done ? 'done' : 'open';
      const st = sticky.get(it.key);
      if (st) {
        if (st.until > nowT || aKey === it.key) { list = st.list; nextWake = Math.min(nextWake, st.until); } else sticky.delete(it.key);
      }
      if (list === 'done' && it.kind === 'own' && it.done && it.doneDay !== today && !st) continue; // finished on an earlier day
      (list === 'open' ? open : done).push(it);
    }
    patchList(ul, open);
    patchList(dl, done);
    justAdded = null;
    const n = $('td-todo-n'); if (n) { const t = open.filter((x) => !x.done).length; const v = t ? String(t) : ''; if (n.textContent !== v) n.textContent = v; }
    if (!open.length) { if (!ul.querySelector('.td-empty')) ul.innerHTML = `<li class="td-empty">${dbState === 'ready' && !todosLoaded ? 'Loading your to-dos…' : 'All clear. Nothing on your list.'}</li>`; }
    else { const e = ul.querySelector('.td-empty'); if (e) e.remove(); }
    det.hidden = !done.length;
    const allToday = done.every((x) => x.doneDay === today);
    const s = $('td-done-s'); if (s) { const v = `${allToday ? 'Done today' : 'Done'} (${done.length})`; if (s.textContent !== v) s.textContent = v; }
    // keep keyboard focus on the same row
    if (aKey && document.activeElement !== active) {
      const li = todayEl.querySelector(`[data-key="${CSS.escape(aKey)}"]`);
      const el = li && (li.querySelector(`[data-role="${aRole || 'tick'}"]`) || li.querySelector('.td-cb'));
      if (el && el.offsetParent !== null) el.focus({ preventScroll: true });
    }
    clearTimeout(stickyTimer);
    if (nextWake < Infinity) stickyTimer = setTimeout(renderTodos, Math.max(50, nextWake - nowT + 30));
  }
  /** Keyed update of a list: unchanged rows keep their DOM nodes (and focus). */
  function patchList(ul, items) {
    const existing = new Map();
    for (const li of Array.from(ul.children)) { if (li.dataset && li.dataset.key) existing.set(li.dataset.key, li); else li.remove(); }
    let prev = null;
    for (const it of items) {
      const html = todoRow(it).replace(' new"', '"');
      let li = existing.get(it.key);
      if (!li || li.__sig !== html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = todoRow(it);
        const n = tpl.content.firstElementChild;
        n.__sig = html;
        if (li) li.replaceWith(n);
        li = n;
      }
      existing.delete(it.key);
      const want = prev ? prev.nextSibling : ul.firstChild;
      if (li !== want) ul.insertBefore(li, want);
      prev = li;
    }
    for (const li of existing.values()) li.remove();
  }
  function itemByKey(key) { return todoItems().find((x) => x.key === key) || null; }
  function onTodayChange(e) {
    const el = e.target;
    if (el.id === 'td-due') { const dt = $('td-date'); if (dt) { dt.hidden = el.value !== 'pick'; if (el.value === 'pick') { dt.value = isoDay(todayKey() + DAY); try { dt.focus(); if (dt.showPicker) dt.showPicker(); } catch (err) { /* picker needs a gesture */ } } } return; }
    if (!el.classList || !el.classList.contains('td-cb')) return;
    const key = keyOfEl(el), it = key && itemByKey(key);
    if (!it) return;
    if (it.kind === 'own') setOwnDone(it, el.checked, el);
    else setAgentDone(it, el.checked, el);
  }
  function setOwnDone(it, done, el) {
    if (!writable('todos')) { if (el) el.checked = it.done; return; }
    const now = new Date().toISOString();
    const data = Object.assign({}, it.raw, { done, updated: now });
    const o = todoOverride[it.id] = { data };
    sticky.set(it.key, { list: done ? 'open' : 'done', until: performance.now() + 2600 });
    renderTodos();
    if (done) { try { S.audio.sfx('coin'); } catch (err) { /* optional */ } }
    dbWrite('todos/' + it.id, () => db.collection('todos').doc(it.id).update({ done, updated: now })).then(() => { if (todoOverride[it.id] === o) o.confirmed = true; }, (err) => {
      if (todoOverride[it.id] === o) delete todoOverride[it.id];
      sticky.delete(it.key); renderTodos(); writeFailed(err, 'that tick');
    });
  }
  function setAgentDone(it, done, el) {
    if (!writable('checks')) { if (el) el.checked = it.done; return; }
    const docId = safeId(it.id), now = new Date().toISOString();
    const pc = pendingCheck[it.id] = { v: done };
    sticky.set(it.key, { list: done ? 'open' : 'done', until: performance.now() + 2600 });
    renderTodos(); hudUpdate();
    if (done) { try { S.audio.sfx('coin'); } catch (err) { /* optional */ } }
    const ref = () => db.collection('checks').doc(docId);
    dbWrite('checks/' + docId, done ? () => ref().set({ task: it.id, done: true, at: now }) : () => ref().delete()).then(() => {
      if (pendingCheck[it.id] === pc) { pc.confirmed = true; if (done) checks[it.id] = { task: it.id, done: true, at: now }; else delete checks[it.id]; }
    }, (err) => {
      if (pendingCheck[it.id] === pc) delete pendingCheck[it.id];
      sticky.delete(it.key); renderTodos(); writeFailed(err, 'that tick');
    });
  }
  function deleteTodo(it) {
    if (!writable('todos')) return;
    const prevData = Object.assign({}, it.raw);
    const o = todoOverride[it.id] = { deleted: true };
    // focus moves to the next row (or the add box) so the keyboard doesn't fall back to the page
    const li = todayEl.querySelector(`[data-key="${CSS.escape(it.key)}"]`);
    const kb = !!(li && li.contains(document.activeElement) && document.activeElement.matches(':focus-visible'));
    const nxt = kb && li && (li.nextElementSibling || li.previousElementSibling);
    renderTodos();
    const f = nxt && nxt.isConnected && nxt.querySelector('.td-cb');
    if (f) f.focus({ preventScroll: true }); else if (kb) { const a = $('td-new'); if (a) a.focus({ preventScroll: true }); }
    dbWrite('todos/' + it.id, () => db.collection('todos').doc(it.id).delete()).then(() => {
      if (todoOverride[it.id] === o) o.confirmed = true;
      showToast(`Deleted “${it.text.length > 40 ? it.text.slice(0, 38) + '…' : it.text}”`, 'del', 6000, { label: 'Undo', fn: () => restoreTodo(it.id, prevData) });
    }, (err) => { if (todoOverride[it.id] === o) delete todoOverride[it.id]; renderTodos(); writeFailed(err, 'that change'); });
  }
  function restoreTodo(id, data) {
    if (!writable('todos')) return;
    const o = todoOverride[id] = { data };
    renderTodos();
    dbWrite('todos/' + id, () => db.collection('todos').doc(id).set(data)).then(() => { if (todoOverride[id] === o) o.confirmed = true; }, (err) => { if (todoOverride[id] === o) delete todoOverride[id]; renderTodos(); writeFailed(err, 'that to-do'); });
  }
  function onTodayAdd(e) {
    if (!e.target || e.target.id !== 'td-add') return;
    e.preventDefault();
    const inp = $('td-new'), sel = $('td-due'), dt = $('td-date');
    const text = (inp && inp.value || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) { if (inp) inp.focus(); return; }
    if (!writable('todos')) { showToast(dbState === 'none' ? 'Open The Shack on claude.ai to save to-dos.' : 'Your list is read-only right now.', 'alert'); return; }
    let due = null;
    const today = todayKey();
    if (sel && sel.value === 'today') due = isoDay(today);
    else if (sel && sel.value === 'tomorrow') due = isoDay(today + DAY);
    else if (sel && sel.value === 'pick' && dt && /^\d{4}-\d{2}-\d{2}$/.test(dt.value)) due = dt.value;
    let ref;
    try { ref = db.collection('todos').doc(); } catch (err) { writeFailed({ code: 'invalid_argument' }, 'that to-do'); return; }
    const now = new Date().toISOString();
    const body = { text, done: false, created: now, updated: now };
    if (due) body.due = due;
    const o = todoOverride[ref.id] = { data: body };
    justAdded = 'o:' + ref.id;
    inp.value = '';
    if (sel) sel.value = '';
    if (dt) dt.hidden = true;
    renderTodos();
    inp.focus();
    dbWrite('todos/' + ref.id, () => ref.set(body)).then(() => { if (todoOverride[ref.id] === o) o.confirmed = true; }, (err) => {
      if (todoOverride[ref.id] === o) delete todoOverride[ref.id];
      renderTodos();
      if (inp && !inp.value) inp.value = text;
      writeFailed(err, 'that to-do');
    });
  }
  function onTodayClick(e) {
    const del = e.target.closest && e.target.closest('[data-role="del"]');
    if (del) { const it = itemByKey(keyOfEl(del)); if (it && it.kind === 'own') deleteTodo(it); return; }
    onAction(e);
  }
  /** Docked: always shown. Slide mode: a slide-over. Phone: the default full-screen view. */
  function setTodayOpen(open, quiet, first) {
    todayOpen = !!open;
    if (!app) return;
    app.classList.toggle('today-open', todayOpen && layoutMode !== 'docked');
    const b = $('hud-today'); if (b) b.setAttribute('aria-expanded', String(todayOpen));
    if (todayEl) { if (layoutMode === 'docked' || todayOpen) todayEl.removeAttribute('inert'); else todayEl.setAttribute('inert', ''); }
    if (!first && todayBuilt) setBlock('td-head', headBlock());
    syncCard();
    coverStamp = -1;
    if (!quiet && todayOpen && todayEl) { const h = todayEl.querySelector('.td-date'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }
  }
  /** Bring the to-do list into view (and the add box into focus when asked). */
  function showTodos(focusAdd) {
    if (layoutMode !== 'docked') { if (panelOpen()) close(); setTodayOpen(true, true); }
    const sec2 = $('td-todos');
    if (sec2) sec2.scrollIntoView({ block: 'start', behavior: S.reducedMotion ? 'auto' : 'smooth' });
    const inp = $('td-new');
    if (focusAdd && inp && !inp.disabled) inp.focus({ preventScroll: true });
    else if (!focusAdd) { const h = $('td-todo-h'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }
  }

  /* ======================================================== Request board */
  const REQ_AREAS = () => [['auto', 'Let J.A.R.V.I.S. decide'], ['monastery', 'School (Abbot Quill)'], ['mine', 'Money (Grit)'], ['market', `${bizName()} (Lumi)`], ['port', 'Fidgetly store (Cap’n Twirl)']];
  const REQ_AREA_SHORT = () => ({ monastery: 'School', mine: 'Money', market: bizName(), port: 'Fidgetly store', square: 'Hub', auto: 'J.A.R.V.I.S. decides' });
  const QSTATUS = { new: ['Waiting for the next check-in', 'info'], accepted: ['On it', 'accent'], done: ['Done', 'ok'], declined: ['Declined', 'mute'] };
  let reqDraft = { text: '', biome: 'auto' };
  try { const d = JSON.parse(localStorage.getItem('shack.reqDraft') || 'null'); if (d && typeof d.text === 'string') reqDraft = { text: d.text.slice(0, 400), biome: typeof d.biome === 'string' ? d.biome : 'auto' }; } catch (e) { /* storage blocked */ }
  function saveDraft() { try { localStorage.setItem('shack.reqDraft', JSON.stringify(reqDraft)); } catch (e) { /* storage blocked */ } }
  const requestsWaiting = () => quests.filter((q) => !str(q.reply) && !/^(done|declined)$/.test(str(q.status))).length;
  function reqLine() {
    if (dbState === 'ready' && writable('quests')) return '';
    if (dbState === 'ready') return L.quests.state === 'retrying' ? 'Reconnecting…' : 'Requests are read-only right now.';
    if (dbState === 'pending') return 'Connecting…';
    if (dbState === 'unavailable') return 'Requests aren’t available in this view.';
    return 'Preview only: requests send when this page is open on claude.ai.';
  }
  function openRequests(prefill, opts = {}) {
    current = { kind: 'requests', key: 'requests' };
    if (typeof prefill === 'string' && prefill) reqDraft.text = prefill;
    const live = writable('quests');
    const n = nextCheckIn();
    const areas = REQ_AREAS();
    const biome = areas.some(([v]) => v === reqDraft.biome) ? reqDraft.biome : 'auto';
    show('square', head({ who: 'hub', theme: 'square', kicker: `${PLACE.square} · J.A.R.V.I.S.`, title: 'Ask J.A.R.V.I.S.', sub: `Ask for anything. J.A.R.V.I.S. hands it to the right island and replies at the next check-in${n ? ' (' + clockWhen(n.at) + ')' : ''}.` }) +
      `<!--NAV--><div class="panel-body">
        <form class="qform" id="qform" autocomplete="off">
          <label class="sec-h" for="qtext"><span>New request</span></label>
          <textarea id="qtext" name="text" maxlength="400" rows="3" placeholder="e.g. Make a Quizlet set for the precalc unit 2 test"${live ? '' : ' disabled'}>${esc(reqDraft.text)}</textarea>
          <div class="qrow">
            <select id="qbiome" name="biome" aria-label="Who should take it"${live ? '' : ' disabled'}>${areas.map(([v, l]) => `<option value="${v}"${v === biome ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
            <button class="btn primary" type="submit"${live ? '' : ' disabled'}>Send</button>
          </div>
          <p class="qstatus" id="qstatus">${esc(reqLine())}</p>
        </form>
        <section class="sec"><h3 class="sec-h"><span>Your requests</span><span class="n" id="qcount"></span></h3><div id="qlist"></div></section>
        <p class="note">Your own to-dos live in the Today column. <button class="lnk" style="background:none;border-left:0;border-right:0;border-top:0;padding:0;cursor:pointer" data-act="show-todos">Show to-dos</button></p>
      </div>`, { nav: 'square', tall: true, wy: opts.fromMap ? islandCy('square') : null, focus: 'square' });
    renderQuests();
    if (prefill && !live) showToast(dbState === 'none' ? 'Open The Shack on claude.ai to send this.' : 'Requests are read-only right now. Your text is kept for later.', 'ask', 4000);
    const ta = $('qtext');
    if (ta && !ta.disabled && (prefill || reqDraft.text)) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
  function refreshBoard() {
    if (!(current && current.kind === 'requests' && panelOpen())) return;
    const live = writable('quests');
    panel.querySelectorAll('#qform textarea, #qform select, #qform button').forEach((el) => { const v = !live || el.dataset.busy === '1'; if (el.disabled !== v) el.disabled = v; });
    const st = $('qstatus');
    if (st && !st.dataset.sticky) { st.className = 'qstatus'; const t = reqLine(); if (st.textContent !== t) st.textContent = t; }
    renderQuests();
  }
  function renderQuests() {
    const box = $('qlist');
    if (!box) return;
    const c = $('qcount'); if (c) c.textContent = quests.length ? String(quests.length) : '';
    let html;
    if (!quests.length) html = emptyBox(dbState === 'ready' ? (questsLoaded ? 'No requests yet. Ask for the first one above.' : 'Loading requests…') : 'Requests you send appear here with J.A.R.V.I.S.’s replies.', 'ask');
    else {
      const short = REQ_AREA_SHORT();
      html = `<div class="rows" style="gap:6px">${quests.map((q) => {
        const st = pick(QSTATUS, q.status) || QSTATUS.new;
        const b = own(THEME, q.biome) ? q.biome : null;
        const text = typeof q.text === 'string' ? q.text : '';
        const reply = plain(str(q.reply));
        return `<article class="quest" style="--qc:${b ? THEME[b].color : 'var(--jarvis)'}"><div class="qh">${pill(st[0], st[1])}<span class="tag">${esc(b ? pick(short, b) : short.auto)}</span><span class="when-rel">${esc(typeof q.created === 'string' ? relPast(q.created) : '')}</span></div><div class="qt">${esc(text)}</div>${reply ? `<div class="letter"><b>J.A.R.V.I.S. replies</b>${esc(reply)}</div>` : ''}</article>`;
      }).join('')}</div>`;
    }
    if (box.__html !== html) { box.__html = html; box.innerHTML = html; }
  }
  function onPanelInput(e) {
    const el = e.target;
    if (el.id === 'qtext') { reqDraft.text = el.value.slice(0, 400); saveDraft(); }
    else if (el.id === 'qbiome') { reqDraft.biome = el.value; saveDraft(); }
  }
  /** On a phone, typing in a bottom sheet would sit under the keyboard: move the sheet up first. */
  function onPanelFocus(e) {
    if (!isPhone() || !/^(TEXTAREA|INPUT)$/.test(e.target.tagName) || panel.classList.contains('top')) return;
    panel.classList.add('top'); panel.classList.remove('tall'); app.classList.add('sheet-top');
    setTimeout(() => { try { e.target.scrollIntoView({ block: 'center' }); } catch (err) { /* ok */ } }, 50);
  }
  function onSubmit(e) {
    if (!e.target || e.target.id !== 'qform') return;
    e.preventDefault();
    const ta = $('qtext'), sel = $('qbiome'), st = $('qstatus');
    const text = (ta && ta.value || '').trim();
    const status = (msg, cls) => { if (st) { st.className = 'qstatus ' + (cls || ''); st.textContent = msg; st.dataset.sticky = cls ? '1' : ''; } };
    if (!writable('quests')) { status(reqLine()); return; }
    if (!text) { status('Write the request first.', 'err'); if (ta) ta.focus(); return; }
    const biome = sel && REQ_AREAS().some(([v]) => v === sel.value) ? sel.value : 'auto';
    const btn = panel.querySelector('#qform button[type="submit"]');
    if (btn) { btn.disabled = true; btn.dataset.busy = '1'; }
    status('Sending…');
    let ref;
    try { ref = db.collection('quests').doc(); } catch (err) { status('Couldn’t send it.', 'err'); return; }
    const body = { text: text.slice(0, 400), biome, status: 'new', created: new Date().toISOString() };
    dbWrite('quests/' + ref.id, () => ref.set(body)).then(() => {
      if (ta) ta.value = '';
      reqDraft = { text: '', biome: 'auto' }; saveDraft();
      if (sel) sel.value = 'auto';
      status(`Sent. J.A.R.V.I.S. reads it at the next check-in.`, 'ok');
      try { S.audio.sfx('bell'); } catch (err) { /* optional */ }
    }, (err) => {
      const code = err && err.code;
      if (code === 'invalid_argument' || code === 'not_granted' || code === 'revoked' || code === 'capability_disabled' || code === 'capability_removed') { canWrite = false; status('Requests are read-only right now. Your text is kept.', 'err'); }
      else if (code === 'quota_exceeded') status('The board is full. Ask Claude to archive old requests.', 'err');
      else if (code === 'resource_exhausted') status('Too many requests at once. Wait a moment and try again.', 'err');
      else status('Couldn’t send it right now. Try again in a moment.', 'err');
    }).then(() => { if (btn) { btn.dataset.busy = ''; btn.disabled = !writable('quests'); } setTimeout(() => { if (st) st.dataset.sticky = ''; }, 4000); refreshAll(); });
  }

  /* ================================================================ toast */
  let toastTimer = 0, toastAction = null;
  function showToast(msg, ic, ms, action) {
    if (!toast) return;
    toastAction = action && typeof action.fn === 'function' ? action : null;
    toast.innerHTML = `${ic ? icon(ic, 2) : ''}<span>${esc(msg)}</span>${toastAction ? `<button class="tbtn" type="button" data-toast="act">${esc(toastAction.label)}</button>` : ''}`;
    toast.hidden = false;
    coverStamp = -1;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; toastAction = null; coverStamp = -1; }, ms || 2600);
  }
  function onToastClick(e) {
    const b = e.target.closest && e.target.closest('[data-toast="act"]');
    if (!b || !toastAction) return;
    const a = toastAction; toastAction = null; toast.hidden = true; clearTimeout(toastTimer);
    try { a.fn(); } catch (err) { console.error(err); }
  }

  /* ================================================================ actions */
  function close(keepCamera) {
    if (!panel || panel.hidden) return;
    const hadFocus = panel.contains(document.activeElement);
    panel.hidden = true; panel.innerHTML = ''; current = null;
    panel.classList.remove('top', 'tall');
    app.classList.remove('panel-open', 'sheet-top');
    placeFloating();
    coverStamp = -1;
    if (!keepCamera) backToFit();
    syncCard();
    if (opener && opener.isConnected && typeof opener.focus === 'function' && !(opener.closest && opener.closest('#today[inert]'))) { try { opener.focus({ preventScroll: true }); } catch (e) { /* ok */ } }
    else if (hadFocus && document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    opener = null;
  }
  function onAction(e) {
    const el = e.target.closest && e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act, arg = el.dataset.arg;
    const fromHud = !!el.closest('#hud');
    switch (act) {
      case 'close': close(); break;
      case 'biome': openBiome(arg); break;
      case 'landmark': openLandmark(arg); break;
      case 'quest': case 'requests': if (current && current.kind === 'requests' && fromHud) close(); else openRequests(arg); break;
      case 'chronicle': if (current && current.kind === 'chronicle' && fromHud) close(); else openChronicle(); break;
      case 'chron-tab': openChronicle(arg); break;
      case 'alerts': openBiome('square'); setTimeout(() => { const a = $('alerts'); if (a) a.scrollIntoView({ block: 'start', behavior: S.reducedMotion ? 'auto' : 'smooth' }); }, 60); break;
      case 'hermes': openBiome('square'); setTimeout(() => { const d = $('behind'); if (d) { d.open = true; const h = $('hermes'); (h || d).scrollIntoView({ block: 'start' }); } }, 60); break;
      case 'replay': if (typeof S.startCeremony === 'function') { S.startCeremony(); showToast('Replaying the check-in…', 'bell'); try { S.audio.sfx('bell'); } catch (err) { /* optional */ } } break;
      case 'sound':
        if (S.audio && typeof S.audio.toggle === 'function') { try { S.audio.toggle(); } catch (err) { /* optional */ } lastHud.sound = null; hudUpdate(); showToast(S.audio.enabled ? 'Sound on' : 'Sound off', S.audio.enabled ? 'soundOn' : 'soundOff'); }
        break;
      case 'today': setTodayOpen(!todayOpen); break;
      case 'today-close': setTodayOpen(false); { const b = $('hud-today'); if (b && layoutMode !== 'docked') b.focus({ preventScroll: true }); } break;
      case 'show-todos': showTodos(false); break;
      default: return;
    }
    if (act !== 'sound') { try { S.audio.sfx('click'); } catch (err) { /* optional */ } }
  }
  function beatName(pr) {
    const B = S.CEREMONY_BEATS || {};
    const names = { bell: 'bell rings', gather: 'gathering', council: 'reports', disperse: 'heading out' };
    for (const k of Object.keys(names)) { const r = B[k]; if (r && pr >= r[0] && pr < r[1]) return names[k]; }
    return 'in progress';
  }
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable);
    if (e.key === 'Escape') {
      if (typing) { if (t.blur) t.blur(); e.preventDefault(); return; } // first Esc leaves the field, the next one closes
      if (panelOpen()) { close(); e.preventDefault(); return; }
      if (layoutMode === 'slide' && todayOpen) { setTodayOpen(false); const b = $('hud-today'); if (b) b.focus({ preventScroll: true }); e.preventDefault(); }
      return;
    }
    if (typing || e.repeat) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'n') { showTodos(true); }
    else if (k === 'a' || k === 'q') { if (current && current.kind === 'requests') close(); else openRequests(); }
    else if (k === 'c') { if (current && current.kind === 'chronicle') close(); else openChronicle(); }
    else if (k === 't' && layoutMode !== 'docked') setTodayOpen(!todayOpen);
    else if (/^[1-5]$/.test(k)) openBiome(NAV[+k - 1]);
    else return;
    e.preventDefault();
  }

  /* ================================================================ open() */
  function open(h) {
    if (!h) return;
    ghostUntil = performance.now() + 450; // the core calls this on pointerup: swallow that tap's ghost click
    try {
      if (h.kind === 'landmark' && h.landmark) return openLandmark(h.landmark, h);
      if (h.kind === 'villager') return openVillager(h);
      if (h.kind === 'quest' || h.id === 'questBoard') return openRequests(null, { fromMap: true });
      if (h.kind === 'chronicle' || h.id === 'chronicle') return openChronicle();
      if (h.kind === 'biome') {
        const b = h.biome || (h.agent && agentInfo(h.agent) && AGENT_INFO[h.agent].biome);
        return openBiome(own(THEME, b) ? b : 'square');
      }
      if (h.agent && agentInfo(h.agent)) return openBiome(AGENT_INFO[h.agent].biome);
      if (h.biome && own(THEME, h.biome)) return openBiome(h.biome);
    } catch (err) {
      console.error('ui.open', err);
    }
  }

  S.ui = {
    open, hudUpdate, close,
    questBoard: openRequests, requests: openRequests, chronicle: openChronicle, island: openBiome, landmark: openLandmark, toast: showToast,
    today: (v) => setTodayOpen(v == null ? !todayOpen : !!v), showTodos,
    openTodos, covers, plain, bizName,
    isPanelOpen: panelOpen,
  };

  /** The core places the hover tooltip right of / below the cursor; flip it when that would overflow. */
  function keepTooltipOnScreen(e) {
    const tip = document.getElementById('tooltip');
    if (!tip || tip.hidden || e.buttons || !S.canvas) return;
    const vw = S.canvas.clientWidth, vh = S.canvas.clientHeight, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.offsetX + 14, y = e.offsetY + 12;
    if (x + w <= vw - 4 && y + h <= vh - 4) return;
    if (x + w > vw - 4) x = Math.max(4, e.offsetX - 10 - w);
    if (y + h > vh - 4) y = Math.max(4, e.offsetY - 8 - h);
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  S.on('boot', () => {
    try { if (!document.documentElement.lang) document.documentElement.lang = 'en'; } catch (e) { /* ok */ }
    buildHud();
    buildToday();
    window.addEventListener('keydown', onKey);
    if (S.canvas) S.canvas.addEventListener('pointermove', keepTooltipOnScreen);
    // Clicking empty space closes the drawer (and the Today slide-over). The new core emits
    // 'background:click'; with an older core, a plain canvas click that hits nothing does the same.
    S.on('background:click', () => { if (panelOpen()) close(); else if (layoutMode === 'slide' && todayOpen) setTodayOpen(false); });
    if (typeof S.setViewInsets !== 'function' && S.canvas) {
      S.canvas.addEventListener('click', (e) => {
        if (e.button !== 0 || typeof S.screenToWorld !== 'function' || typeof S.hitTest !== 'function') return;
        const w = S.screenToWorld(e.offsetX, e.offsetY);
        if (!S.hitTest(w.x, w.y)) { if (panelOpen()) close(); else if (layoutMode === 'slide' && todayOpen) setTodayOpen(false); }
      });
    }
    S.on('camera:focus', syncCard);
    S.on('camera:fit', syncCard);
    S.on('resize', layout);
    initDb();
  });
  S.on('ceremony:start', () => { lastHud = Object.assign({}, lastHud, { 'hud-cyc-k': null }); });
})();
