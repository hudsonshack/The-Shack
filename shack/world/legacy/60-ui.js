/* The Shack \u2014 UI module: HUD, drawer panels and the Quest board.
 *
 * Implements S.ui.open(hotspot) and S.ui.hudUpdate() for the core.
 * Everything shown comes from S.data (real state) or the artifact's `db`
 * (quests + check-offs). Empty data gets an honest empty state.
 * All pixel art here (icons, portraits, header banners) is drawn once into
 * small canvases and shown scaled with nearest-neighbour sampling.
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S) return;

  const NY = 'America/New_York';
  const D = () => S.data || {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, w, pl) => `${n} ${n === 1 ? w : (pl || w + 's')}`;

  /* =================================================================== themes */
  const THEME = {
    square:    { name: 'Town Square', color: '#e8b75a', agent: 'hub' },
    monastery: { name: 'Highland Monastery', color: '#86d0b0', agent: 'academic-core' },
    mine:      { name: 'Copperpot Mine', color: '#f2c94c', agent: 'ledger-fi' },
    market:    { name: 'Neon Night Market', color: '#ff5fb0', agent: 'social-ops' },
    port:      { name: 'River Port Bazaar', color: '#63b4e6', agent: 'hustle-engine' },
    savings:   { name: 'Savings Row', color: '#b6d36b', agent: 'ledger-fi' },
    riverside: { name: 'Riverside', color: '#e39a5b', agent: null },
    north:     { name: 'School Hill', color: '#e07a5f', agent: 'academic-core' },
  };
  const AGENT_INFO = {
    hub:             { name: 'Mayor Tock', label: 'Director', biome: 'square', role: 'Director. Keeps the clock, rings the cycle bell, reads every report.' },
    'academic-core': { name: 'Abbot Quill', label: 'Academic-Core', biome: 'monastery', role: 'School. Classroom deadlines, study blocks and Quizlet sets.' },
    'ledger-fi':     { name: 'Grit Copperpot', label: 'Ledger-Fi', biome: 'mine', role: 'Money. Friday paychecks, budgets, savings goals, odd charges.' },
    'social-ops':    { name: 'Lumi', label: 'Social-Ops', biome: 'market', role: "Social. Angie's and the fidget store on TikTok, Reels and Shorts." },
    'hustle-engine': { name: "Cap'n Twirl", label: 'Hustle-Engine', biome: 'port', role: 'Store. The Shopify fidget shop, orders and arbitrage ideas.' },
  };
  const NAV = ['square', 'monastery', 'market', 'port', 'mine'];
  const NAV_SHORT = { square: 'Square', monastery: 'School', market: 'Social', port: 'Store', mine: 'Money' };
  const PLACE = { square: 'the square', monastery: 'the monastery', market: 'the market', port: 'the port', mine: 'the mine' };

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
    autumn: { pal: { A: '#e0893a', a: '#9c4f1f', v: '#ffd27a', s: '#7a4a22' }, rows: [
      '......aa', '....aAAa', '...aAAvA', '..aAAvAa', '.aAAvAAa', '.aAvAAa.', '.avaaa..', 's.......'] },
    winter: { pal: { w: '#dfeefa', W: '#ffffff', b: '#8fb8ff' }, rows: [
      '...w...', '.b.w.b.', '..bwb..', 'wwwWwww', '..bwb..', '.b.w.b.', '...w...'] },
    spring: { pal: { p: '#f2a7c3', P: '#ffd0e2', y: '#ffd27a', d: '#b8577c' }, rows: [
      '.dd.dd.', 'dPPdPPd', 'dPpypPd', '.dyyyd.', 'dPpypPd', 'dPPdPPd', '.dd.dd.'] },
    summer: { pal: { G: '#7cc35a', g: '#3f7a2a', y: '#e8f59a' }, rows: [
      '.....gg', '...gGGg', '..gGGyG', '.gGGyGg', 'gGGyGGg', 'gGyGGg.', 'gyggg..', 'y......'] },
    sun: { pal: { y: '#f2c94c', Y: '#ffe07a', W: '#fff6c8', o: '#c4952b' }, rows: [
      '....y....', '.y.....y.', '...ooo...', '..oYYYo..', 'y.oYWYo.y', '..oYYYo..', '...ooo...', '.y.....y.', '....y....'] },
    moon: { pal: { M: '#f3e8d2', m: '#b9ad98', s: '#ffe9a8' }, rows: [
      '...MMM...', '.MMMm....', '.MMm...s.', 'MMm......', 'MMm......', 'MMMm.....', '.MMMmm.MM', '..MMMMMM.'] },
    mist: { pal: { m: '#b9c3cf', d: '#7d8796' }, rows: [
      'mmmmmm.dd.', '..........', '.ddd.mmmmm', '..........', 'mmmmm.ddd.'] },
    rain: { pal: { C: '#c9d2dd', c: '#7d8796', b: '#63b4e6' }, rows: [
      '...cccc...', '..cCCCCc..', '.cCCCCCCcc', 'cCCCCCCCCc', '.cccccccc.', '..b..b..b.', '.b..b..b..', '..........'] },
    storm: { pal: { C: '#8a8fa3', c: '#4f5366', y: '#ffe07a', b: '#63b4e6' }, rows: [
      '...cccc...', '..cCCCCc..', '.cCCCCCCcc', 'cCCCCCCCCc', '.cccyyccc.', '..b.yy.b..', '.b..yb....', '.....y....'] },
    bell: { pal: { G: '#e8b75a', g: '#9c7433', W: '#fff3c4', k: '#6b4a1a' }, rows: [
      '...gg...', '..gGGg..', '.gGWGGg.', '.gGWGGg.', '.gGGGGg.', 'gGGGGGGg', 'gggggggg', '...kk...'] },
    alert: { pal: { y: '#ffb547', k: '#1d1a24', o: '#9c6a1c' }, rows: [
      '....y....', '...yyy...', '...yky...', '..yykyy..', '..yykyy..', '.yyyyyyy.', '.yyykyyy.', 'ooooooooo'] },
    alertCrit: { pal: { y: '#ff6b6b', k: '#1d1a24', o: '#8a2b2b' }, rows: [
      '....y....', '...yyy...', '...yky...', '..yykyy..', '..yykyy..', '.yyyyyyy.', '.yyykyyy.', 'ooooooooo'] },
    ok: { pal: { g: '#8ad17a', d: '#3f7a2a' }, rows: [
      '.......g', '......gd', '.....gd.', 'g...gd..', 'dg.gd...', '.dggd...', '..dd....'] },
    board: { pal: { w: '#9b6b3d', W: '#c08a52', P: '#f3e8d2', k: '#8a7d68', r: '#ff6b6b' }, rows: [
      'WWWWWWWWW', 'wPPPrPPPw', 'wPkkkkkPw', 'wPPPPPPPw', 'wPkkkkPPw', 'wPPPPPPPw', 'wwwwwwwww', '.w.....w.'] },
    replay: { pal: { a: '#f3e8d2', b: '#e8b75a' }, rows: [
      '..aaaa.b', '.a....bb', 'a....bbb', 'a.......', 'a.......', 'a......a', '.a....a.', '..aaaa..'] },
    soundOn: { pal: { a: '#f3e8d2', b: '#e8b75a' }, rows: [
      '...a.....', '..aa..b..', 'aaaa.b.b.', 'aaaa.b.b.', 'aaaa.b.b.', 'aaaa.b.b.', '..aa..b..', '...a.....'] },
    soundOff: { pal: { a: '#7d7388', r: '#ff6b6b' }, rows: [
      '...a.....', '..aa.....', 'aaaa.r.r.', 'aaaa..r..', 'aaaa.r.r.', 'aaaa.....', '..aa.....', '...a.....'] },
    minus: { pal: { a: '#f3e8d2' }, rows: ['.......', '.......', '.......', 'aaaaaaa', '.......', '.......', '.......'] },
    plus: { pal: { a: '#f3e8d2' }, rows: ['...a...', '...a...', '...a...', 'aaaaaaa', '...a...', '...a...', '...a...'] },
    fit: { pal: { a: '#f3e8d2' }, rows: ['aaa..aaa', 'a......a', 'a......a', '........', '........', 'a......a', 'a......a', 'aaa..aaa'] },
    close: { pal: { a: '#f3e8d2' }, rows: ['a.....a', '.a...a.', '..a.a..', '...a...', '..a.a..', '.a...a.', 'a.....a'] },
    coin: { pal: { y: '#f2c94c', Y: '#ffe07a', o: '#c4952b', k: '#8a6420' }, rows: [
      '..ooo..', '.oYYyo.', 'oYyoyyk', 'oYyoyyk', 'oyyoyyk', '.oyyyk.', '..kkk..'] },
    pin: { pal: { r: '#ff6b6b', R: '#ffb0b0', k: '#8a2b2b', n: '#b9ad98' }, rows: [
      '.rrr.', 'rRrrk', 'rrrrk', '.kkk.', '..n..', '..n..'] },
    bird: { pal: { w: '#f3e8d2', d: '#b9ad98', y: '#ffb547' }, rows: [
      '.........', '.ww...ww.', 'wddw.wddw', '....wy...', '.........'] },
  };
  const iconCache = {};
  function iconURL(name) {
    if (iconCache[name]) return iconCache[name];
    const ic = ICONS[name];
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
   * 16x16 head-and-shoulders sprites, lit from the top-left. */
  const OUT = '#1d1a24';
  const SKIN = { s: '#f2c9a0', S: '#d9a273', e: OUT, m: '#a0524a', n: '#e8ad86' };
  const PORTRAITS = {
    hub: { pal: Object.assign({}, SKIN, { o: OUT, H: '#2e2838', h: '#4b4360', B: '#e8b75a', M: '#e8b75a', W: '#e9e2d4', w: '#f7f2e8', R: '#c8453a', C: '#4a2f5c', c: '#6a4a80', V: '#b5823a', g: '#ffe07a' }), rows: [
      '................',
      '.....oooooo.....',
      '.....ohHHHo.....',
      '.....ohHHHo.....',
      '.....oBBBBo.....',
      '...oooooooooo...',
      '....osssssso....',
      '....osesseMo....',
      '....osssssMo....',
      '....osWWWWso....',
      '....oSsmmsSM....',
      '.....oSSSSoM....',
      '...ocwwRRwwCo...',
      '..ocCCwVVwCCCo..',
      '..oCCCCVgCCCCo..',
      '..oCCCCVVCCCCo..'] },
    'academic-core': { pal: Object.assign({}, SKIN, { o: OUT, h: '#fbe0bf', J: '#3f8f78', j: '#6cc0a0', Y: '#e89a2f', y: '#f7c35a', b: '#7a4a22' }), rows: [
      '................',
      '......oooo......',
      '.....oshhso.....',
      '....oshhssso....',
      '....osssssso....',
      '....osssssso....',
      '....oseSSeso....',
      '....osssssso....',
      '....oSsmmsSo....',
      '.....oSSSSo.....',
      '...ojJYYYYJJo...',
      '..ojJJbYYYJJJo..',
      '..oJJJJbYYJJJo..',
      '..oJJJYYbYJJJo..',
      '..oJJJYYYbJJJo..',
      '..oJJJYYYYbJJo..'] },
    'ledger-fi': { pal: Object.assign({}, SKIN, { o: OUT, Y: '#e8b75a', y: '#9c7433', L: '#fff6c8', l: '#ffe07a', C: '#c8642f', c: '#e8894a', b: '#f2c94c', G: '#5e6b3a', g: '#7d8a4c', K: '#4a3020', k: '#f2c94c' }), rows: [
      '................',
      '......oooo......',
      '.....oYLLYo.....',
      '....oYYllYYo....',
      '...oyyyyyyyyo...',
      '....osssssso....',
      '....oseSSeso....',
      '....oSsnnsSo....',
      '....ocCCCCco....',
      '...oCcCCCCcCo...',
      '..ogGCCbbCCGGo..',
      '..oGGGCbbCGGGo..',
      '..oGGGGCCGGGGo..',
      '..oKKKKkkKKKKo..',
      '..oGGGGGGGGGGo..',
      '..oGGGGGGGGGGo..'] },
    'social-ops': { pal: Object.assign({}, SKIN, { o: OUT, P: '#6b3fb0', p: '#9b6bff', H: '#3ef0ff', h: '#1d8fa0', N: '#ff4fa3', n: '#c22a78', C: '#3ef0ff', k: '#2b2633', l: '#9fffff' }), rows: [
      '................',
      '.....oooooo.....',
      '....oPpppPPo....',
      '...oPpPPPPPPo...',
      '..oHoPPPPPPoHo..',
      '..oHosssssPoHo..',
      '..ohosessesoho..',
      '....osssssso....',
      '....oSsmmsSo....',
      '.....oSSSSo.....',
      '...oNNnCCnNNo...',
      '..oNNNnCCnNNNo..',
      '..oNNNkkkkNNNo..',
      '..oNNNklkkNNNo..',
      '..oNNNkkkkNNNo..',
      '..oNNNnCCnNNNo..'] },
    'hustle-engine': { pal: Object.assign({}, SKIN, { o: OUT, T: '#3a2a4a', t: '#55406a', G: '#e8b75a', b: '#7a4a22', R: '#c8453a', W: '#f3e8d2', f: '#ff4fa3', F: '#3ef0ff' }), rows: [
      '................',
      '......oooo......',
      '..oooottttoooo..',
      '.oTTTTTGTTTTTTo.',
      '..ooTTTTTTTToo..',
      '....osssssso....',
      '....oseSSeso....',
      '....osssssso....',
      '....oSbmmbSo....',
      '.....obbbbo.....',
      '...oRWRWRWRWo...',
      '..oRWRWRWRWRWo..',
      '..oRWRWRWRWRWo..',
      '..oRWRWRWRWfFf..',
      '..oRWRWRWRWRfo..',
      '..oRWRWRWRWfFf..'] },
    hudson: { pal: Object.assign({}, SKIN, { o: OUT, H: '#6a4426', h: '#8a5a32', D: '#3f6fb0', d: '#5a8fd0', w: '#f3e8d2' }), rows: [
      '................',
      '.....oooooo.....',
      '....oHhhHHHo....',
      '...oHhHHHHHHo...',
      '...oHHsssssHo...',
      '....osssssso....',
      '....oseSSeso....',
      '....osssssso....',
      '....oSsmmsSo....',
      '.....oSSSSo.....',
      '...odDDwwDDDo...',
      '..odDDDwwDDDDo..',
      '..oDDDDDDDDDDo..',
      '..oDDdddddDDDo..',
      '..oDDDDDDDDDDo..',
      '..oDDDDDDDDDDo..'] },
    folk: { pal: Object.assign({}, SKIN, { o: OUT, W: '#f7f2e8', w: '#d6cdbd', H: '#8a5a32', A: '#e9e2d4', a: '#bdb3a2', G: '#5a8a5a' }), rows: [
      '.....oooooo.....',
      '....oWWWWWWo....',
      '....oWWWWwWo....',
      '.....owwwwo.....',
      '....oHsssHHo....',
      '....osssssso....',
      '....oseSSeso....',
      '....osssssso....',
      '....oSsmmsSo....',
      '.....oSSSSo.....',
      '...oGGAAAAGGo...',
      '..oGGAAAAAAGGo..',
      '..oGGAAAAAAGGo..',
      '..oGGAaaaaAGGo..',
      '..oGGAAAAAAGGo..',
      '..oGGAAAAAAGGo..'] },
    cat: { pal: { o: OUT, G: '#e0893a', g: '#b86424', w: '#f7f2e8', y: '#8ad17a', p: '#ff9ab0', k: OUT }, rows: [
      '................',
      '...oo......oo...',
      '...oGo....oGo...',
      '...oGGooooGGo...',
      '...oGGGGGGGGo...',
      '..oGGgGGGGgGGo..',
      '..oGykGGGGykGo..',
      '..oGGGGGGGGGGo..',
      '..owGGGppGGGwo..',
      '...owwGGGGwwo...',
      '....oogggoo.....',
      '...oGGGGGGGGo...',
      '..oGgGGwwGGgGo..',
      '..oGGgGwwGgGGo..',
      '..oGGGGwwGGGGo..',
      '..oGGGGwwGGGGo..'] },
  };
  const portraitCache = {};
  function portraitURL(who, theme) {
    const key = who + '|' + theme;
    if (portraitCache[key]) return portraitCache[key];
    const p = PORTRAITS[who] || PORTRAITS.folk;
    const base = (THEME[theme] || THEME.square).color;
    const c = cnv(20, 20), g = c.getContext('2d');
    // backdrop: theme colour, dark at the bottom-right, dithered bands, light from the top-left
    const dark = S.color.mix(base, '#15121d', 0.72), mid = S.color.mix(base, '#15121d', 0.55), lite = S.color.mix(base, '#15121d', 0.38);
    g.fillStyle = dark; g.fillRect(0, 0, 20, 20);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
      const d = x + y;
      if (d < 12 || (d < 18 && ((x + y) & 1) === 0)) { g.fillStyle = d < 8 ? lite : mid; g.fillRect(x, y, 1, 1); }
    }
    // a soft halo behind the head
    g.fillStyle = S.color.rgba(base, 0.22);
    g.fillRect(5, 3, 10, 9); g.fillRect(4, 4, 12, 7);
    // shadow of the figure toward the bottom-right
    g.fillStyle = 'rgba(10,8,16,0.45)';
    for (let j = 0; j < p.rows.length; j++) for (let i = 0; i < p.rows[j].length; i++) if (p.pal[p.rows[j][i]]) g.fillRect(3 + i, 5 + j, 1, 1);
    drawRows(g, p.rows, 2, 4, p.pal);
    portraitCache[key] = c.toDataURL();
    return portraitCache[key];
  }
  function whoFor(agent) { return PORTRAITS[agent] ? agent : 'folk'; }

  /* ----------------------------------------------------------- header banners
   * A little 160x36 pixel vignette per biome, drawn once, shown at 2x behind
   * the drawer header. */
  const bannerCache = {};
  function bannerURL(theme) {
    if (bannerCache[theme]) return bannerCache[theme];
    const W = 204, H = 36, OX = 30, X0 = -OX, X1 = W - OX, c = cnv(W, H), g = c.getContext('2d');
    const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x | 0, y | 0, w | 0, h | 0); };
    const hash = (x, y, s) => S.hash(x, y, s);
    const bands = (cols, y0, bh) => {
      cols.forEach((col, i) => R(X0, y0 + i * bh, W, bh, col));
      for (let i = 1; i < cols.length; i++) { g.fillStyle = cols[i]; for (let x = X0 + (i & 1); x < X1; x += 2) g.fillRect(x, y0 + i * bh - 1, 1, 1); }
    };
    const stars = (n, yMax, s) => { for (let i = 0; i < n; i++) { const x = X0 + ((hash(i, 1, s) * W) | 0), y = (hash(i, 2, s) * yMax) | 0; R(x, y, 1, 1, hash(i, 3, s) > 0.7 ? '#fff6c8' : 'rgba(255,255,255,0.55)'); } };
    const lantern = (x, y, col, glow) => {
      R(x, y - 3, 1, 3, '#3a2a20');
      g.fillStyle = S.color.rgba(glow, 0.18); g.fillRect(x - 4, y - 2, 9, 10); g.fillRect(x - 3, y - 3, 7, 12);
      R(x - 2, y, 5, 6, col); R(x - 1, y + 1, 1, 3, S.color.shade(col, 0.45)); R(x - 2, y, 5, 1, '#3a2a20'); R(x - 2, y + 6, 5, 1, '#3a2a20'); R(x, y + 7, 1, 1, '#e8b75a');
    };
    g.translate(OX, 0);
    switch (theme) {
      case 'monastery': {
        bands(['#1b2a36', '#20333f', '#28404a', '#2f4d55', '#385b5f'], 0, 6);
        stars(18, 14, 3);
        R(-12, 4, 5, 5, '#f3e8d2'); R(-13, 5, 7, 3, '#f3e8d2'); R(-10, 4, 3, 4, '#c9bfa8');
        for (let x = X0; x < X1; x++) { const h = 13 + Math.round(Math.sin(x * 0.07) * 5 + Math.sin(x * 0.19 + 2) * 3); R(x, H - h, 1, h, '#2a4148'); R(x, H - h, 1, 1, '#4d6a70'); }
        for (let x = X0; x < X1; x++) { const h = 7 + Math.round(Math.sin(x * 0.11 + 4) * 3 + Math.sin(x * 0.31) * 1.5); R(x, H - h, 1, h, '#1d302e'); if (hash(x, 0, 9) > 0.6) R(x, H - h, 1, 1, '#2f4a40'); }
        // pagoda
        const px0 = 120;
        R(px0 + 4, 20, 14, 18, '#7a3a2c'); R(px0 + 6, 22, 2, 16, '#c8453a'); R(px0 + 14, 22, 2, 16, '#c8453a'); R(px0 + 9, 25, 4, 13, '#2a1a14');
        R(px0 + 9, 26, 4, 3, '#ffb84d');
        R(px0, 17, 22, 3, '#2f6f5c'); R(px0 - 2, 19, 3, 1, '#2f6f5c'); R(px0 + 21, 19, 3, 1, '#2f6f5c'); R(px0 + 1, 16, 20, 1, '#86d0b0'); R(px0 + 3, 13, 16, 3, '#3f8f78');
        R(px0 + 5, 8, 12, 5, '#7a3a2c'); R(px0 + 3, 7, 16, 2, '#2f6f5c'); R(px0 + 4, 6, 14, 1, '#86d0b0'); R(px0 + 1, 8, 2, 1, '#2f6f5c'); R(px0 + 19, 8, 2, 1, '#2f6f5c');
        R(px0 + 10, 2, 2, 4, '#e8b75a');
        lantern(100, 12, '#ff9a3a', '#ffb84d'); lantern(146, 14, '#ff7a50', '#ff9a50');
        g.fillStyle = '#3a2a20'; for (let x = 92; x < 152; x++) g.fillRect(x, 8 + Math.round(Math.sin((x - 92) / 60 * Math.PI) * 3), 1, 1);
        // prayer flags
        const fl = ['#c8453a', '#f2c94c', '#86d0b0', '#63b4e6', '#f3e8d2'];
        for (let i = 0; i < 7; i++) R(60 + i * 7, 4 + (i % 2), 3, 4, fl[i % 5]);
        break;
      }
      case 'mine': {
        bands(['#3a2416', '#4a2e1b', '#5b3a22', '#6e4728', '#7f5430', '#8a5d36'], 0, 6);
        for (let y = 0; y < H; y++) for (let x = X0; x < X1; x++) { const v = hash(x, y, 4); if (v > 0.93) R(x, y, 1, 1, 'rgba(0,0,0,0.25)'); else if (v < 0.04) R(x, y, 1, 1, 'rgba(255,220,170,0.18)'); }
        // ore veins with sparkles
        for (const [x, y] of [[96, 6], [118, 14], [140, 7], [104, 24], [150, 22]]) { R(x, y, 3, 2, '#c4952b'); R(x + 1, y, 1, 1, '#f2c94c'); R(x, y - 1, 1, 1, '#fff6c8'); R(x - 1, y, 1, 1, '#fff6c8'); }
        // timber frame (mine mouth)
        R(110, 8, 4, 30, '#6b4424'); R(111, 8, 1, 30, '#8a5a32'); R(146, 8, 4, 30, '#6b4424'); R(147, 8, 1, 30, '#8a5a32');
        R(106, 5, 48, 4, '#7a4f2a'); R(106, 5, 48, 1, '#a06a3a'); R(114, 9, 32, 29, '#140c08');
        g.fillStyle = 'rgba(255,184,77,0.2)'; g.fillRect(124, 14, 12, 12); R(129, 9, 2, 3, '#3a2a20'); R(128, 12, 4, 3, '#ffb84d');
        // rails + cart
        R(X0, 31, W, 1, '#5a5a62'); R(X0, 34, W, 1, '#5a5a62');
        for (let x = X0 + 2; x < X1; x += 5) R(x, 30, 2, 5, '#4a3020');
        R(70, 24, 20, 8, '#5a5a62'); R(71, 25, 18, 6, '#7a7a84'); R(70, 24, 20, 1, '#9a9aa4'); R(72, 21, 16, 4, '#f2c94c'); R(74, 20, 4, 1, '#ffe07a'); R(80, 21, 1, 1, '#fff6c8');
        R(73, 32, 3, 3, '#2b2633'); R(84, 32, 3, 3, '#2b2633');
        break;
      }
      case 'market': {
        bands(['#140c24', '#1a0f2e', '#211338', '#2a1842', '#33204e'], 0, 7);
        stars(14, 16, 7);
        // skyline of stalls
        for (const [x, w, h, col] of [[84, 18, 14, '#2c1f45'], [104, 22, 18, '#251a3c'], [128, 16, 12, '#2c1f45'], [146, 14, 20, '#251a3c']]) { R(x, H - h, w, h, col); R(x, H - h, w, 1, '#4a3a70'); }
        // neon sign
        R(106, 22, 18, 7, '#1a0f2e'); R(106, 22, 18, 1, '#ff4fa3'); R(106, 28, 18, 1, '#ff4fa3'); R(106, 22, 1, 7, '#ff4fa3'); R(123, 22, 1, 7, '#ff4fa3');
        R(109, 24, 2, 3, '#3ef0ff'); R(113, 24, 3, 1, '#3ef0ff'); R(113, 26, 3, 1, '#3ef0ff'); R(118, 24, 3, 3, '#ffe07a');
        g.fillStyle = 'rgba(255,79,163,0.18)'; g.fillRect(104, 20, 22, 11);
        // string lights
        const bulbs = ['#ff4fa3', '#3ef0ff', '#ffe07a', '#9b6bff', '#8ad17a'];
        for (let x = X0; x < X1; x++) { const u = x - X0, y = 6 + Math.round(Math.abs(Math.sin(u / 25 * Math.PI)) * 6); R(x, y, 1, 1, '#4a3a60'); if (u % 6 === 3) { const b = bulbs[(u / 6 | 0) % 5]; R(x, y + 1, 1, 2, b); g.fillStyle = S.color.rgba(b, 0.25); g.fillRect(x - 1, y, 3, 4); } }
        // broadcast tower
        R(150, 2, 1, 20, '#8a7aa8'); R(148, 8, 5, 1, '#8a7aa8'); R(147, 14, 7, 1, '#8a7aa8'); R(149, 0, 3, 2, '#ff4fa3');
        break;
      }
      case 'port': {
        bands(['#1f3a52', '#25465f', '#2c526b', '#345f78'], 0, 5);
        stars(8, 12, 11);
        // far shore (Highlands) and the river
        for (let x = X0; x < X1; x++) { const h = 6 + Math.round(Math.sin(x * 0.06 + 1) * 3 + Math.sin(x * 0.17) * 1.5); R(x, 20 - h, 1, h, '#2a4038'); }
        bands(['#2f6290', '#3a72a3', '#3f7fb0'], 20, 6);
        for (let i = 0; i < 40; i++) { const x = X0 + ((hash(i, 5, 2) * W) | 0), y = 21 + ((hash(i, 6, 2) * 16) | 0); R(x, y, 2 + ((hash(i, 7, 2) * 3) | 0), 1, y > 30 ? '#6fb2d6' : '#4f8fbf'); }
        // cargo ship
        const sx = 104;
        R(sx, 22, 40, 6, '#5a3a24'); R(sx + 2, 28, 36, 2, '#3a2416'); R(sx, 22, 40, 1, '#8a5a32'); R(sx + 1, 25, 38, 1, '#c8453a');
        R(sx + 6, 17, 8, 5, '#c08a52'); R(sx + 15, 17, 8, 5, '#63b4e6'); R(sx + 24, 17, 8, 5, '#c08a52'); R(sx + 6, 17, 8, 1, '#e0b07a'); R(sx + 15, 17, 8, 1, '#9fd2f2'); R(sx + 24, 17, 8, 1, '#e0b07a');
        R(sx + 34, 4, 1, 18, '#3a2416'); R(sx + 28, 6, 6, 9, '#f3e8d2'); R(sx + 28, 6, 1, 9, '#c9bfa8'); R(sx + 35, 3, 4, 2, '#ff4fa3');
        R(sx - 2, 30, 44, 1, '#d8eef5');
        // pier
        R(60, 26, 40, 3, '#9b6b3d'); R(60, 26, 40, 1, '#c08a52'); for (let x = 62; x < 100; x += 8) R(x, 29, 2, 6, '#74502c');
        // gulls
        for (const [x, y] of [[86, 6], [94, 10]]) { R(x, y, 2, 1, '#f3e8d2'); R(x + 3, y, 2, 1, '#f3e8d2'); R(x + 2, y + 1, 1, 1, '#f3e8d2'); }
        break;
      }
      case 'savings': {
        bands(['#20302a', '#263a2e', '#2c4432', '#344e38'], 0, 6);
        for (let x = X0; x < X1; x++) { R(x, 30, 1, 8, '#4a5a2e'); if (hash(x, 1, 6) > 0.5) R(x, 29, 1, 1, '#6f7a35'); }
        // scaffold + crane
        for (let y = 12; y < 30; y += 6) R(96, y, 26, 1, '#c08a52');
        R(96, 12, 1, 18, '#c08a52'); R(121, 12, 1, 18, '#c08a52'); R(99, 20, 20, 10, '#9a9590'); R(99, 20, 20, 1, '#bdb7ae');
        R(104, 23, 3, 3, '#ffd27a'); R(111, 23, 3, 3, '#ffd27a');
        R(130, 2, 2, 28, '#e8b75a'); R(112, 2, 40, 2, '#e8b75a'); R(116, 4, 1, 6, '#5a5a62'); R(115, 10, 3, 2, '#5a5a62');
        // sapling with gold fruit
        R(146, 20, 2, 10, '#6b4424'); R(141, 12, 12, 9, '#4f8f33'); R(143, 11, 8, 1, '#6cbf4a'); R(142, 13, 2, 2, '#6cbf4a'); R(144, 16, 2, 2, '#f2c94c'); R(149, 14, 2, 2, '#f2c94c');
        // shield
        R(70, 16, 12, 10, '#5a85a8'); R(71, 26, 10, 2, '#5a85a8'); R(73, 28, 6, 2, '#5a85a8'); R(72, 18, 8, 6, '#8fb8d8');
        break;
      }
      case 'riverside': {
        bands(['#2a2236', '#33293f', '#3d3048', '#47374f'], 0, 6);
        stars(10, 12, 13);
        bands(['#2f6290', '#3f7fb0'], 30, 4);
        // inn facade
        R(92, 10, 60, 20, '#d9cdb4'); R(92, 10, 60, 1, '#f3e8d2'); R(88, 4, 68, 6, '#4a4458'); R(88, 4, 68, 1, '#6a6478');
        for (let x = 98; x < 150; x += 12) { R(x, 15, 6, 6, '#ffd27a'); R(x, 15, 6, 1, '#fff3c4'); R(x + 2, 15, 1, 6, '#c08a52'); g.fillStyle = 'rgba(255,184,77,0.15)'; g.fillRect(x - 2, 13, 10, 10); }
        R(118, 22, 7, 8, '#5a3a24'); R(84, 12, 6, 5, '#6b4424'); R(85, 13, 4, 3, '#e8b75a');
        // coins on the way (payday)
        for (const x of [60, 66, 72]) { R(x, 26, 3, 3, '#f2c94c'); R(x, 26, 1, 1, '#fff6c8'); }
        break;
      }
      case 'north': {
        bands(['#2a2236', '#30283c', '#382e44', '#40344a'], 0, 6);
        stars(10, 12, 17);
        R(96, 12, 50, 20, '#9a4a3a'); for (let y = 13; y < 32; y += 3) for (let x = 96 + ((y / 3) & 1) * 3; x < 146; x += 6) R(x, y, 5, 1, '#b85a48');
        R(92, 8, 58, 4, '#3a3446'); R(116, 2, 10, 6, '#3a3446'); R(119, 3, 4, 3, '#e8b75a');
        for (const x of [102, 112, 128, 138]) { R(x, 16, 5, 6, '#ffd27a'); R(x + 2, 16, 1, 6, '#9a4a3a'); }
        R(118, 22, 6, 10, '#3a2a20');
        R(80, 2, 1, 30, '#bdb7ae'); R(81, 3, 9, 6, '#c8453a'); R(81, 5, 9, 1, '#f3e8d2'); R(81, 3, 4, 3, '#3f6fb0');
        // a carrier bird with a letter
        R(40, 10, 3, 1, '#f3e8d2'); R(45, 10, 3, 1, '#f3e8d2'); R(43, 11, 2, 1, '#f3e8d2'); R(43, 12, 2, 2, '#e8b75a');
        break;
      }
      default: { // square
        bands(['#231d33', '#28213a', '#2e2642', '#352c4a'], 0, 6);
        stars(14, 14, 19);
        for (let y = 26; y < H; y += 4) for (let x = X0 + ((y / 4) & 1) * 3; x < X1; x += 6) { R(x, y, 5, 3, '#6a6570'); R(x, y, 5, 1, '#8a8590'); R(x + 4, y + 1, 1, 2, '#55505c'); }
        R(X0, 25, W, 1, '#4a4558');
        // bunting across the plaza
        const flags = ['#e8b75a', '#c8453a', '#86d0b0', '#63b4e6', '#ff5fb0'];
        for (let x = X0; x < X1; x++) { const u = x - X0, y = 3 + Math.round(Math.sin((u % 56) / 56 * Math.PI) * 4); R(x, y, 1, 1, '#4a3a2a'); if (u % 7 === 3) { const f = flags[(u / 7 | 0) % 5]; R(x - 1, y + 1, 3, 2, f); R(x, y + 3, 1, 1, f); } }
        // lamp posts with warm pools of light
        for (const lx of [12, 60, 154]) { g.fillStyle = 'rgba(255,210,122,0.12)'; g.fillRect(lx - 6, 10, 13, 16); g.fillRect(lx - 4, 8, 9, 20); R(lx, 14, 1, 12, '#2b2633'); R(lx - 1, 11, 3, 3, '#ffd27a'); R(lx - 1, 10, 3, 1, '#2b2633'); R(lx - 1, 25, 3, 1, '#2b2633'); }
        // clock tower (pointed roof, brass clock)
        const tx = 92;
        R(tx + 1, 8, 20, 30, '#8e8882'); R(tx + 1, 8, 2, 30, '#bdb7ae'); R(tx + 19, 8, 2, 30, '#6f6a66');
        for (let y = 10; y < 36; y += 4) R(tx + 3, y, 16, 1, '#7d7873');
        for (let i = 0; i < 7; i++) R(tx + 1 + Math.round(i * 1.5), 7 - i, 20 - i * 3, 1, i < 2 ? '#3b5b7a' : '#4a6f92');
        R(tx + 10, -1, 2, 2, '#e8b75a');
        R(tx + 5, 11, 12, 12, '#c4952b'); R(tx + 6, 12, 10, 10, '#fff3c4'); R(tx + 6, 12, 10, 1, '#ffffff'); R(tx + 10, 13, 2, 5, OUT); R(tx + 11, 16, 4, 2, OUT);
        g.fillStyle = 'rgba(255,230,168,0.16)'; g.fillRect(tx + 2, 9, 18, 16);
        R(tx + 7, 28, 8, 10, '#2a1d16'); R(tx + 7, 28, 8, 1, '#5a3a24');
        // fountain with a spout
        R(124, 27, 26, 5, '#77726f'); R(124, 27, 26, 1, '#bdb7ae'); R(126, 25, 22, 2, '#3f7fb0'); R(127, 25, 6, 1, '#6fb2d6');
        R(136, 18, 2, 8, '#6fb2d6'); R(134, 17, 6, 2, '#d8eef5'); R(133, 19, 1, 2, '#6fb2d6'); R(140, 19, 1, 2, '#6fb2d6'); R(132, 22, 1, 1, '#d8eef5'); R(141, 22, 1, 1, '#d8eef5');
        // quest board with pinned notes
        R(58, 18, 22, 10, '#7a5230'); R(58, 18, 22, 1, '#a06a3a'); R(60, 28, 2, 8, '#5a3a24'); R(76, 28, 2, 8, '#5a3a24');
        for (const [nx, nc] of [[61, '#f3e8d2'], [67, '#ffe3b0'], [73, '#f3e8d2']]) { R(nx, 20, 4, 5, nc); R(nx + 1, 20, 1, 1, '#c8453a'); }
        break;
      }
    }
    bannerCache[theme] = c.toDataURL();
    return bannerCache[theme];
  }

  /* ================================================================ time fmt */
  const fmtClock = new Intl.DateTimeFormat('en-US', { timeZone: NY, hour: 'numeric', minute: '2-digit', hour12: true });
  const fmtWhen = new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const fmtDateTZ = new Intl.DateTimeFormat('en-US', { timeZone: NY, month: 'short', day: 'numeric' });
  const fmtUTCDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  const fmtUTCMonth = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  function clockParts(d) {
    const s = fmtClock.format(d); // "2:47 AM"
    const m = s.match(/^(\d+:\d+)\s*([AP]M)$/i);
    return m ? { hm: m[1], ap: m[2].toUpperCase() } : { hm: s, ap: '' };
  }
  function parseDate(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return { dateOnly: true, y: +m[1], m: +m[2], d: +m[3] };
    const d = new Date(s);
    return isNaN(d) ? null : { dateOnly: false, date: d };
  }
  function nyToday() { const p = S.time.ny || S.nyParts(S.now()); return Date.UTC(p.year, p.month - 1, p.day); }
  /** Whole days from NY today to a date string (date-only or ISO). */
  function daysUntil(s) {
    const p = parseDate(s);
    if (!p) return null;
    let utc;
    if (p.dateOnly) utc = Date.UTC(p.y, p.m - 1, p.d);
    else { const q = S.nyParts(p.date); utc = Date.UTC(q.year, q.month - 1, q.day); }
    return Math.round((utc - nyToday()) / 864e5);
  }
  function dayLabel(s) {
    const p = parseDate(s);
    if (!p) return '';
    return p.dateOnly ? fmtUTCDay.format(new Date(Date.UTC(p.y, p.m - 1, p.d, 12))) : fmtWhen.format(p.date);
  }
  function dueChip(s) {
    const n = daysUntil(s);
    if (n == null) return `<span class="when">\u2014</span>`;
    const cls = n <= 0 ? 'now' : n <= 2 ? 'soon' : '';
    const big = n < 0 ? `${-n}d` : n === 0 ? 'NOW' : `${n}d`;
    const small = n < 0 ? 'LATE' : n === 0 ? 'TODAY' : n === 1 ? 'TMRW' : WD[(new Date(nyToday() + n * 864e5)).getUTCDay()];
    return `<span class="when ${cls}">${big}<b>${small}</b></span>`;
  }
  function rel(s) {
    const p = parseDate(s);
    if (!p) return '';
    if (p.dateOnly) { const n = daysUntil(s); return n === 0 ? 'today' : n === -1 ? 'yesterday' : n === 1 ? 'tomorrow' : n < 0 ? `${-n}d ago` : `in ${n}d`; }
    const ms = p.date.getTime() - S.now().getTime(), a = Math.abs(ms), past = ms < 0;
    const m = Math.round(a / 60000);
    let t;
    if (m < 1) return 'just now';
    if (m < 60) t = `${m}m`;
    else if (m < 60 * 36) t = `${Math.round(m / 60)}h`;
    else t = `${Math.round(m / 1440)}d`;
    return past ? `${t} ago` : `in ${t}`;
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
    if (v == null) return '\u2014';
    const d = dp != null ? dp : (Math.abs(v % 1) > 0.001 ? 2 : 0);
    return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function moneyShort(n) {
    const v = num(n);
    if (v == null) return '\u2014';
    return Math.abs(v) >= 10000 ? (v < 0 ? '-$' : '$') + (Math.abs(v) / 1000).toFixed(1) + 'k' : money(Math.round(v), 0);
  }

  /* =========================================================== html helpers */
  const sec = (title, body, opts = {}) => `<section class="sec"${opts.id ? ` id="${opts.id}"` : ''}><h3 class="sec-h">${opts.icon ? icon(opts.icon, 1) : ''}<span>${esc(title)}</span>${opts.n != null ? `<span class="n">${esc(opts.n)}</span>` : ''}</h3>${body}</section>`;
  const emptyBox = (msg, ic = 'mist') => `<p class="empty">${icon(ic, 1)}<span>${esc(msg)}</span></p>`;
  const tiles = (list, cols) => `<div class="tiles" style="--cols:${cols || list.length}">${list.map((t) => `<div class="tile ${t.tone || ''}"><span class="k">${esc(t.k)}</span><span class="v${t.sm ? ' sm' : ''}">${t.v}</span>${t.s ? `<span class="s">${esc(t.s)}</span>` : ''}</div>`).join('')}</div>`;
  const bar = (p, tone, tall, tick) => `<span class="bar ${tone || ''}${tall ? ' tall' : ''}"><i style="--p:${(clamp(p, 0, 1) * 100).toFixed(1)}%"></i>${tick != null ? `<span class="tick" style="left:${(clamp(tick, 0, 1) * 100).toFixed(1)}%"></span>` : ''}</span>`;
  const pill = (txt, tone) => `<span class="pill ${tone || ''}">${esc(txt)}</span>`;
  const PHASE = {
    uninit: ['not started', 'mute'], idle: ['idle', 'ok'], plan: ['planning', 'info'], execute: ['working', 'brass'], verify: ['checking', 'info'],
    error: ['error', 'crit'], blocked: ['blocked', 'warn'], done: ['done', 'ok'], working: ['working', 'brass'],
  };
  const phasePill = (ph) => { const p = PHASE[ph] || [ph || 'unknown', 'mute']; return pill(p[0], p[1]); };
  const feedPill = (s) => (s === 'connected' ? pill('feed connected', 'ok') : pill(s ? 'feed ' + s : 'feed unknown', 'mute'));

  /* =================================================================== data */
  const threadOf = (agent) => S.thread(agent) || null;
  const metricsOf = (agent) => S.metrics(agent) || {};
  const alertsFor = (agent) => {
    const th = threadOf(agent), label = th && th.label;
    return arr(D().alerts).filter((a) => a.agent === agent || (label && a.agent === label) || (AGENT_INFO[agent] && a.agent === AGENT_INFO[agent].label));
  };
  const tasksFor = (agent) => arr(D().tasks).filter((t) => t.agent === agent);
  const youTasks = () => arr(D().tasks).filter((t) => t.autonomy === 'human').slice().sort((a, b) => (a.priority || 9) - (b.priority || 9));
  const goalFor = (agent) => arr(D().goals).find((g) => g.agent === agent);
  const savingsGoal = (name) => arr(metricsOf('ledger-fi').savings).find((s) => s.name === name) || arr(D().savings_goals).find((s) => s.name === name) || null;

  /* ====================================================== shared fragments */
  function alertsSection(list, title = 'Alerts') {
    if (!list.length) return '';
    return sec(title, `<ul class="rows">${list.map((a) => `<li class="row" style="--g:auto 1fr auto">${icon(a.level === 'critical' ? 'alertCrit' : 'alert', 1)}<span class="t wrap">${esc(a.msg)}</span><span class="d">${esc(rel(a.at))}</span></li>`).join('')}</ul>`, { n: list.length });
  }
  function taskRows(list, opts = {}) {
    return `<ul class="rows">${list.map((t) => {
      const you = t.autonomy === 'human';
      const done = you && checks[t.id] && checks[t.id].done;
      return `<li class="row${done ? ' done' : ''}" style="--g:1fr auto"><span class="t wrap">${esc(t.title)}</span><span class="chips">${you ? '<span class="tag you">you</span>' : ''}${done ? pill('ticked', 'ok') : phasePill(t.phase)}</span>${(t.due || t.notes) && opts.notes !== false ? `<span class="d full">${t.due ? `Due ${esc(dayLabel(t.due))} (${esc(rel(t.due))})` : ''}${t.due && t.notes ? ' \u00b7 ' : ''}${t.notes ? esc(t.notes) : ''}</span>` : ''}</li>`;
    }).join('')}</ul>`;
  }
  function tasksSection(agent) {
    const list = tasksFor(agent);
    const g = goalFor(agent);
    let body = '';
    if (g) body += `<p class="note"><b>Goal ${esc(g.id)}:</b> ${esc(g.title)}</p>`;
    body += list.length ? taskRows(list) : emptyBox('No open tasks on the ledger for this agent.', 'ok');
    return sec('Tasks', body, { n: list.length });
  }
  function threadHeader(agent) {
    const th = threadOf(agent) || {};
    const lr = th.last_run ? rel(th.last_run) : 'never';
    const tl = [
      { k: 'Pending', v: esc(th.pending ?? 0), tone: th.pending ? 'accent' : 'mute' },
      { k: 'Blocked', v: esc(th.blocked ?? 0), tone: th.blocked ? 'crit' : 'mute' },
      { k: 'Done', v: esc(th.done ?? 0), tone: th.done ? 'ok' : 'mute' },
      { k: 'Last run', v: esc(lr), sm: true, tone: th.last_run ? '' : 'mute' },
    ];
    const summary = th.summary || 'Waiting for first cycle.';
    return tiles(tl, 4) + `<p class="summary">${esc(summary)}<small>${esc(th.label || AGENT_INFO[agent].label)} \u00b7 ${esc(th.domain || '')}${th.weight != null ? ` \u00b7 weight ${esc(th.weight)}` : ''}</small></p>`;
  }
  function bubblesLine(agent) {
    const b = arr((metricsOf(agent).world || {}).bubbles);
    if (!b.length) return '';
    return sec('Overheard in town', `<div class="chips">${b.map((x) => `<span class="quote">\u201c${esc(x)}\u201d</span>`).join('')}</div>`);
  }

  /* ========================================================= domain blocks */
  function deadlinesBlock(m, limit) {
    const list = arr(m.deadlines).slice().sort((a, b) => String(a.due).localeCompare(String(b.due)));
    const shown = limit ? list.slice(0, limit) : list;
    const body = shown.length
      ? `<ul class="rows">${shown.map((d) => `<li class="row" style="--g:44px 1fr auto">${dueChip(d.due)}<span><span class="t" style="display:block">${esc(d.title)}</span><span class="d">${esc(d.course || '')} \u00b7 ${esc(dayLabel(d.due))}</span></span><span class="tag">${esc(d.type || 'task')}</span></li>`).join('')}</ul>`
      : emptyBox(m.classroom_feed === 'connected' ? 'No upcoming deadlines. The scroll board is clear.' : 'No deadlines yet. They appear once the Classroom feed is connected and a cycle has read it.', 'bird');
    return sec('Deadlines', body, { n: list.length, icon: 'pin' });
  }
  function studyBlock(m) {
    const list = arr(m.study_blocks).slice().sort((a, b) => String(a.start).localeCompare(String(b.start)));
    const body = list.length
      ? `<ul class="rows">${list.map((b) => { const p = parseDate(b.start); const live = p && !p.dateOnly && p.date < S.now(); return `<li class="row${live ? ' hl' : ''}" style="--g:92px 1fr auto"><span class="num" style="text-align:left;font-size:17px">${esc(dayLabel(b.start))}</span><span class="t">${esc(b.title)}</span><span class="d">${esc(rel(b.start))}</span></li>`; }).join('')}</ul>`
      : emptyBox('No study blocks placed on the calendar yet.');
    return sec('Study blocks', body, { n: list.length });
  }
  function prepBlock(m) {
    const list = arr(m.prep_sets);
    const body = list.length
      ? `<ul class="rows">${list.map((s) => `<li class="row" style="--g:1fr auto"><span><span class="t" style="display:block">${esc(s.title)}</span>${s.file ? `<span class="d">${esc(String(s.file).split('/').pop())}</span>` : ''}</span><span class="num">${esc(s.cards ?? '?')}<span class="d"> cards</span></span></li>`).join('')}</ul>`
      : emptyBox('No Quizlet sets written yet. Abbot Quill writes one before each quiz or test.');
    return sec('Quizlet sets', body, { n: list.length });
  }
  function monthLabel(m) {
    const p = /^(\d{4})-(\d{2})$/.exec(m || '');
    return p ? fmtUTCMonth.format(new Date(Date.UTC(+p[1], +p[2] - 1, 15))) : 'This month';
  }
  function moneyTiles(m) {
    const inc = num(m.month_income), sp = num(m.month_spend);
    const net = inc != null && sp != null ? inc - sp : null;
    return tiles([
      { k: 'Income', v: esc(moneyShort(inc)), tone: inc ? 'ok' : 'mute' },
      { k: 'Spent', v: esc(moneyShort(sp)), tone: sp ? '' : 'mute' },
      { k: 'Net', v: esc(net == null ? '\u2014' : (net > 0 ? '+' : '') + moneyShort(net)), tone: net == null || (!inc && !sp) ? 'mute' : net >= 0 ? 'accent' : 'crit' },
      { k: 'Paychecks', v: esc(m.paychecks_month ?? 0), tone: m.paychecks_month ? '' : 'mute', s: 'this month' },
    ], 4);
  }
  function paydayBlock(m) {
    const pd = D().payday || {};
    const lp = m.last_paycheck;
    const today = S.time.isPayday;
    const p = S.time.ny || {};
    const daysTo = ((5 - (p.dow ?? 0)) + 7) % 7;
    let html = `<div class="kvline"><span>Paid <b>every ${esc(pd.weekday || 'Friday')}</b></span><span>${esc(pd.method || 'direct deposit')}</span><span>${today ? '<b style="color:var(--ok)">Payday is today</b>' : `next in <b>${daysTo}d</b>`}</span></div>`;
    if (lp && num(lp.amount) != null) html += `<ul class="rows"><li class="row" style="--g:auto 1fr auto">${icon('coin', 2)}<span><span class="t" style="display:block">Last paycheck</span><span class="d">${esc(dayLabel(lp.date))} \u00b7 ${esc(rel(lp.date))}</span></span><span class="num" style="color:var(--ok)">+${esc(money(lp.amount))}</span></li></ul>`;
    else html += emptyBox(m.bank_feed === 'connected' ? 'No paycheck seen yet this month.' : 'No paycheck data yet: the M&T alert emails are not connected, so deposits can\u2019t be seen. Your Friday direct deposit still lands either way.', 'coin');
    return sec('Payday', html, { icon: 'coin' });
  }
  function categoriesBlock(m) {
    const list = arr(m.categories);
    const p = S.time.ny || {};
    const monthFrac = p.day ? p.day / new Date(Date.UTC(p.year, p.month, 0)).getUTCDate() : null;
    const body = list.length
      ? `<ul class="rows">${list.map((c) => {
        const b = num(c.budget), s = num(c.spent) || 0, r = b ? s / b : 0;
        const tone = b ? (r >= 1 ? 'crit' : r >= 0.8 ? 'warn' : 'ok') : '';
        return `<li class="row" style="--g:1fr auto"><span class="t">${esc(c.name)}</span><span class="num">${esc(money(s, 0))}<span class="d"> / ${b ? esc(money(b, 0)) : 'no budget'}</span></span><span class="full">${b ? bar(r, tone, false, monthFrac) : ''}</span></li>`;
      }).join('')}</ul><p class="note">The tick marks how far through the month we are.</p>`
      : emptyBox('No spending categories yet. They fill in from bank alerts after the first cycles.');
    return sec('Budgets', body, { n: list.length });
  }
  function savingsRow(s) {
    const t = num(s.target), c = num(s.current) || 0;
    const r = t ? c / t : 0;
    let sub = '';
    if (t) {
      const dl = s.deadline ? daysUntil(s.deadline) : null;
      sub = `${Math.round(r * 100)}% of ${money(t, 0)}`;
      if (dl != null && dl > 0 && c < t) sub += ` \u00b7 ${money((t - c) / Math.max(1, dl / 7), 0)}/wk to hit ${dayLabel(s.deadline)}`;
      else if (s.deadline) sub += ` \u00b7 by ${dayLabel(s.deadline)}`;
    } else sub = 'No target set yet';
    return `<li class="row" style="--g:1fr auto"><span class="t">${esc(s.name)}</span><span class="num">${esc(money(c, 0))}</span><span class="full">${bar(r, t ? '' : 'mute', true)}</span><span class="d full">${esc(sub)}</span></li>`;
  }
  function savingsBlock(m) {
    const list = arr(m.savings).length ? arr(m.savings) : arr(D().savings_goals);
    const body = list.length ? `<ul class="rows">${list.map(savingsRow).join('')}</ul>` : emptyBox('No savings goals configured.');
    const anyNoTarget = list.some((s) => !num(s.target));
    return sec('Savings goals', body + (anyNoTarget ? `<p class="note">Set dollar targets (task T-0004) and the buildings on Savings Row start to grow.</p>` : ''), { n: list.length });
  }
  function anomaliesBlock(m) {
    const list = arr(m.anomalies);
    if (!list.length) return sec('Odd charges', emptyBox('Nothing odd spotted.', 'ok'));
    return sec('Odd charges', `<ul class="rows">${list.map((a) => `<li class="row" style="--g:auto 1fr auto">${icon('alert', 1)}<span><span class="t" style="display:block">${esc(a.merchant)}</span><span class="d">${esc(a.rule || '')}${a.date ? ' \u00b7 ' + esc(dayLabel(a.date)) : ''}</span></span><span class="num">${esc(money(a.amount))}</span></li>`).join('')}</ul>`, { n: list.length });
  }
  const NETS = { tiktok: 'TT', instagram: 'IG', youtube: 'YT', facebook: 'FB' };
  function clientsBlock(m) {
    const list = arr(m.clients).length ? arr(m.clients) : [];
    const cfg = arr(D().clients);
    let body;
    if (list.length) {
      body = `<ul class="rows">${list.map((c) => `<li class="row" style="--g:1fr auto auto"><span><span class="t" style="display:block">${esc(c.name)}</span><span class="chips" style="margin-top:3px">${arr(c.networks).map((n) => `<span class="net ${esc(n)}">${esc(NETS[n] || n)}</span>`).join('')}</span></span><span class="d" style="text-align:right">${num(c.retainer) != null ? esc(money(c.retainer, 0)) + '/mo' : 'retainer \u2014'}</span><span class="num">${esc(c.posts_next_7d ?? 0)}<span class="d"> posts</span></span></li>`).join('')}</ul>`;
    } else if (cfg.length) {
      body = `<ul class="rows">${cfg.map((c) => `<li class="row" style="--g:1fr auto"><span><span class="t" style="display:block">${esc(c.name)}</span><span class="d">${esc(c.location || c.note || c.type || '')}</span></span><span class="tag">${num(c.retainer) != null ? esc(money(c.retainer, 0)) + '/mo' : 'no posts yet'}</span></li>`).join('')}</ul><p class="note">Post counts show up after Lumi\u2019s first cycle reads Metricool.</p>`;
    } else body = emptyBox('No clients tracked yet.');
    return sec('Clients', body, { n: (list.length || cfg.length) });
  }
  function storeAdsBlock(m) {
    const a = m.store_ads;
    if (!a) {
      const ads = (D().store || {}).ads || {};
      return sec('Fidget store ads', emptyBox(`No ad or short-form numbers yet.${arr(ads.platforms).length ? ' Planned for ' + arr(ads.platforms).join(', ') + '.' : ''}`));
    }
    return sec('Fidget store ads', tiles([
      { k: 'Planned', v: esc(a.videos_planned ?? 0), tone: 'accent' },
      { k: 'Posted 7d', v: esc(a.videos_posted_7d ?? 0) },
      { k: 'Clicks 7d', v: esc(a.link_clicks_7d ?? 0) },
    ], 3) + (a.top_video ? `<p class="note"><b>Top video:</b> ${esc(a.top_video)}</p>` : ''));
  }
  function prospectsBlock(m) {
    const list = arr(m.prospects);
    const body = list.length
      ? `<ul class="rows">${list.map((p) => `<li class="row" style="--g:1fr auto"><span class="t">${esc(p.name)}</span>${pill(p.status || 'new', p.status === 'signed' ? 'ok' : p.status === 'drafted' ? 'info' : 'mute')}</li>`).join('')}</ul><p class="note">Outreach DMs are drafted only. You send them yourself.</p>`
      : emptyBox('No prospects yet. Lumi drafts outreach to local businesses during night cycles.');
    return sec('Prospects', body, { n: list.length });
  }
  function shopTiles(m) {
    const sh = m.shopify || {};
    const known = num(sh.orders_7d) != null;
    return tiles([
      { k: 'Orders 7d', v: esc(known ? sh.orders_7d : '\u2014'), tone: known ? 'accent' : 'mute' },
      { k: 'Revenue 7d', v: esc(moneyShort(sh.revenue_7d)), tone: num(sh.revenue_7d) != null ? 'ok' : 'mute' },
      { k: 'Low stock', v: esc(arr(sh.low_stock).length), tone: arr(sh.low_stock).length ? 'crit' : 'mute' },
      { k: 'DM drafts', v: esc(m.dm_drafts ?? 0), tone: m.dm_drafts ? '' : 'mute' },
    ], 4) + (known ? '' : `<p class="note">Shopify numbers appear once the Shopify connector is attached to the Director Routine.</p>`);
  }
  function lowStockBlock(m) {
    const list = arr((m.shopify || {}).low_stock);
    const body = list.length
      ? `<ul class="rows">${list.map((x) => `<li class="row" style="--g:auto 1fr">${'<span class="tag red">low</span>'}<span class="t">${esc(typeof x === 'string' ? x : x.name || JSON.stringify(x))}</span></li>`).join('')}</ul>`
      : (num((m.shopify || {}).orders_7d) != null ? emptyBox('Every crate is stocked.', 'ok') : emptyBox('Stock levels unknown until Shopify is connected.'));
    return sec('Low stock', body, { n: list.length });
  }
  function oppsBlock(m) {
    const list = arr(m.opportunities);
    const body = list.length
      ? `<ul class="rows">${list.map((o) => `<li class="row" style="--g:1fr auto"><span class="t">${esc(o.title)}</span><span class="num">${num(o.margin_pct) != null ? esc(o.margin_pct) + '%' : '\u2014'}<span class="d"> margin</span></span>${num(o.margin_pct) != null ? `<span class="full">${bar(o.margin_pct / 100, o.margin_pct >= 40 ? 'ok' : '', false)}</span>` : ''}</li>`).join('')}</ul>`
      : emptyBox('No arbitrage ideas researched yet.');
    return sec('Opportunities', body, { n: list.length });
  }
  function storeProjectBlock() {
    const st = D().store || {};
    const pr = arr(st.projects);
    if (!pr.length) return '';
    return sec('The store', pr.map((p) => `<div class="kvline"><span><b>${esc(p.name)}</b></span><span>${esc(p.status || '')}</span></div>${arr(p.kpis).length ? `<div class="chips">${arr(p.kpis).map((k) => `<span class="tag">${esc(k)}</span>`).join('')}</div>` : ''}`).join(''));
  }
  function cyclesBlock() {
    const cyc = arr(D().cycles);
    if (!cyc.length) return sec('Cycle schedule', emptyBox('No cycle schedule configured.'));
    const next = S.cycle.next && S.cycle.next.name;
    return sec('Cycle schedule', `<ul class="rows">${cyc.map((c) => `<li class="row${c.name === next ? ' hl' : ''}" style="--g:58px 1fr auto"><span class="num" style="text-align:left">${esc(c.local_time)}</span><span><span class="t" style="display:block;text-transform:capitalize">${esc(c.name)}</span><span class="d">${esc(c.focus || '')}</span></span>${c.name === next ? `<span class="pill brass plain" data-live="countdown">${esc(countdownText())}</span>` : ''}</li>`).join('')}</ul>`, { icon: 'bell' });
  }
  function runsBlock(limit = 6) {
    const runs = arr(D().runs).slice(0, limit);
    const body = runs.length
      ? `<ul class="rows">${runs.map((r) => `<li class="row" style="--g:1fr auto auto"><span><span class="t" style="display:block;text-transform:capitalize">${esc(r.cycle)}</span><span class="d">${esc(dayLabel(r.started))}${r.notes ? ' \u00b7 ' + esc(r.notes) : ''}</span></span><span class="num">${esc(r.tasks_run ?? 0)}<span class="d"> tasks</span></span>${pill(r.result || '?', r.result === 'ok' ? 'ok' : r.result === 'partial' ? 'warn' : r.result === 'failed' ? 'crit' : 'mute')}</li>`).join('')}</ul>`
      : emptyBox('No cycles have run yet. The first one rings the bell at the next scheduled time.', 'bell');
    return sec('Recent runs', body, { n: arr(D().runs).length });
  }
  function commitsBlock(limit = 8) {
    const list = arr(D().commits).slice(0, limit);
    const body = list.length
      ? `<ul class="rows">${list.map((c) => `<li class="row" style="--g:auto 1fr auto"><span class="tag">${esc(String(c.sha || '').slice(0, 7))}</span><span class="t">${esc(c.subject)}</span><span class="d">${esc(rel(c.at))}</span></li>`).join('')}</ul>`
      : emptyBox('No letters in the mail post yet.');
    return sec('Recent commits', body, { n: arr(D().commits).length });
  }

  /* ============================================================ panel bodies */
  const BODY = {};
  BODY['academic-core'] = () => {
    const m = metricsOf('academic-core');
    return [threadHeader('academic-core'), `<div class="chips">${feedPill(m.classroom_feed)}</div>`, alertsSection(alertsFor('academic-core')),
      deadlinesBlock(m), studyBlock(m), prepBlock(m), tasksSection('academic-core'), bubblesLine('academic-core')];
  };
  BODY['ledger-fi'] = () => {
    const m = metricsOf('ledger-fi');
    return [threadHeader('ledger-fi'), alertsSection(alertsFor('ledger-fi')),
      sec(monthLabel(m.month), `<div class="chips">${feedPill(m.bank_feed)}</div>` + moneyTiles(m)),
      paydayBlock(m), categoriesBlock(m), savingsBlock(m), anomaliesBlock(m), tasksSection('ledger-fi'), bubblesLine('ledger-fi')];
  };
  BODY['social-ops'] = () => {
    const m = metricsOf('social-ops');
    return [threadHeader('social-ops'), alertsSection(alertsFor('social-ops')),
      sec('This week', tiles([
        { k: 'Posts 7d', v: esc(m.scheduled_posts_7d ?? 0), tone: m.scheduled_posts_7d ? 'accent' : 'mute', s: 'scheduled' },
        { k: 'Drafts', v: esc(m.drafts_pending ?? 0), tone: m.drafts_pending ? '' : 'mute', s: 'to review' },
        { k: 'Clients', v: esc(arr(m.clients).length || arr(D().clients).length) },
        { k: 'Prospects', v: esc(arr(m.prospects).length), tone: arr(m.prospects).length ? '' : 'mute' },
      ], 4)),
      clientsBlock(m), storeAdsBlock(m), prospectsBlock(m), tasksSection('social-ops'), bubblesLine('social-ops')];
  };
  BODY['hustle-engine'] = () => {
    const m = metricsOf('hustle-engine');
    return [threadHeader('hustle-engine'), alertsSection(alertsFor('hustle-engine')),
      sec('Shopify \u00b7 last 7 days', shopTiles(m)), lowStockBlock(m), oppsBlock(m), storeProjectBlock(), tasksSection('hustle-engine'), bubblesLine('hustle-engine')];
  };
  BODY.hub = () => {
    const rows = S.BIOMES.map((b) => {
      const ag = S.agentForBiome(b), th = threadOf(ag) || {}, inf = AGENT_INFO[ag];
      const lvl = (S.status[b] || {}).level || 'idle';
      return `<li class="row click" data-act="biome" data-arg="${b}" style="--g:32px 1fr auto;--c:${THEME[b].color}"><img class="mini-portrait" src="${portraitURL(whoFor(ag), b)}" alt=""><span><span class="t" style="display:block">${esc(inf.name)} <span class="d">\u00b7 ${esc(th.label || inf.label)}</span></span><span class="d" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(th.summary || 'Waiting for first cycle.')}</span></span><span style="display:grid;justify-items:end;gap:3px">${phasePill(th.phase)}<span class="d">${esc(th.pending ?? 0)}\u00b7${esc(th.blocked ?? 0)}\u00b7${esc(th.done ?? 0)} ${icon(WEATHER[lvl].icon, 1)}</span></span></li>`;
    }).join('');
    const al = arr(D().alerts);
    const au = D().autonomy || {};
    const auKeys = Object.keys(au).filter((k) => k !== 'profile');
    const yt = youTasks(), ytDone = yt.filter((t) => checks[t.id] && checks[t.id].done).length;
    return [
      sec('The council', `<ul class="rows">${rows}</ul><p class="note">pending \u00b7 blocked \u00b7 done, and the weather over each biome.</p>`),
      al.length ? alertsSection(al, 'All alerts') : sec('Alerts', emptyBox('All quiet. No alerts from any biome.', 'ok')),
      sec('Your quests', `<div class="kvline"><span><b>${yt.length - ytDone}</b> open for you</span><span>${ytDone} ticked off</span></div>${bar(yt.length ? ytDone / yt.length : 0, 'ok')}<div class="btnrow"><button class="btn primary" data-act="quest">${icon('board', 1)} Open quest board</button></div>`),
      cyclesBlock(),
      runsBlock(4),
      auKeys.length ? sec(`Autonomy \u00b7 ${au.profile || 'custom'}`, `<div class="chips">${auKeys.map((k) => `<span class="pill ${au[k] === 'auto' ? 'ok' : au[k] === 'never' ? 'crit' : 'warn'}">${esc(k)}: ${esc(au[k])}</span>`).join('')}</div>`) : '',
      tasksSection('hub'),
    ];
  };

  /* ================================================================ weather */
  const WEATHER = {
    ok: { icon: 'sun', word: 'Clear' }, idle: { icon: 'mist', word: 'Mist' }, warn: { icon: 'rain', word: 'Rain' }, critical: { icon: 'storm', word: 'Storm' },
  };
  const SEV = { ok: 0, idle: 1, warn: 2, critical: 3 };
  function townWeather() {
    let worst = 'ok', where = [];
    for (const b of S.BIOMES) {
      const l = (S.status[b] || {}).level || 'ok';
      if (SEV[l] > SEV[worst]) { worst = l; where = [b]; } else if (l === worst) where.push(b);
    }
    const w = WEATHER[worst];
    let ic = w.icon, word = w.word;
    if (worst === 'ok') { ic = S.time.isNight ? 'moon' : 'sun'; word = S.time.isNight ? 'Clear night' : 'Clear'; }
    if (worst === 'warn' || worst === 'critical') word += ' over ' + (where.length > 2 ? where.length + ' biomes' : where.map((b) => b[0].toUpperCase() + b.slice(1)).join(' & '));
    const tip = S.BIOMES.map((b) => `${THEME[b].name}: ${WEATHER[(S.status[b] || {}).level || 'ok'].word}`).join('\n');
    return { icon: ic, word, tip, level: worst };
  }

  /* ================================================================ cycle */
  function countdownText() {
    const c = S.cycle || {};
    if (c.ceremony) return c.ceremony.name === 'manual' ? 'replaying' : 'in progress';
    if (!c.next) return 'no schedule';
    return dur(c.next.at.getTime() - S.now().getTime());
  }

  /* =============================================================== DOM refs */
  const $ = (id) => document.getElementById(id);
  let hud, panel, toast;
  const H = {}; // HUD element refs
  let current = null; // {kind, key}
  let lastHud = {};

  /* =================================================================== HUD */
  function buildHud() {
    hud = $('hud'); panel = $('panel'); toast = $('toast');
    if (!hud || !panel) return;
    const season = S.time.season || 'autumn';
    const sample = !!D().sample;
    hud.innerHTML = `
      <div class="hud-group hud-main pixel-frame" role="group" aria-label="Status">
        <button class="hud-cell hud-brand" data-act="biome" data-arg="square" title="Town Square: Mayor Tock's overview">
          ${icon('logo', 2)}
          <span style="display:flex;flex-direction:column"><span class="hud-title">THE SHACK</span><span class="hud-place">${esc((D().home_area || 'Cold Spring, NY').toUpperCase())}</span></span>
        </button>
        <div class="hud-cell"><div class="hud-stat"><span class="k" id="hud-day">\u2014</span><span class="v" id="hud-clock">\u2014</span></div></div>
        <div class="hud-cell c-season" id="hud-wx-cell"><span id="hud-season-ico">${icon(season, 2, season)}</span><div class="hud-stat"><span class="k" id="hud-season">${esc(season)}</span><span class="v txt" id="hud-wx"></span></div></div>
        <div class="hud-cell hud-cycle-cell"><span id="hud-cyc-ico">${icon('bell', 2)}</span><div class="hud-stat hud-cycle" id="hud-cycle"><span class="k" id="hud-cyc-k">Next cycle</span><span class="v" id="hud-cyc-v">\u2014</span><span class="minibar"><i id="hud-cyc-bar"></i></span></div></div>
        <div class="hud-cell c-alerts"><button class="hud-chip" id="hud-alerts" data-act="alerts" title="Alerts"></button>${sample ? '<span class="sample-badge" title="Previewing with example data, not your real state">SAMPLE DATA</span>' : ''}</div>
      </div>
      <div class="hud-group hud-ctrl pixel-frame" role="toolbar" aria-label="Controls">
        <div class="hud-cell" style="gap:6px">
          <button class="hud-btn" data-act="quest" title="Quest board (Q)">${icon('board', 2)}<span class="lbl">Quest board</span><kbd>Q</kbd><b class="count" id="hud-qcount" hidden></b></button>
          <button class="hud-btn" data-act="replay" title="Replay the cycle ceremony">${icon('replay', 2)}<span class="lbl">Replay cycle</span></button>
          <button class="hud-btn" data-act="sound" id="hud-sound" aria-pressed="false" title="Sound">${icon('soundOff', 2)}<span class="lbl">Sound off</span></button>
        </div>
        <div class="hud-cell c-zoom"><div class="hud-zoom">
          <button class="hud-btn sq" data-act="zoomout" title="Zoom out (-)" aria-label="Zoom out">${icon('minus', 2)}</button>
          <button class="hud-btn sq" data-act="fit" title="Fit the whole map (F)" aria-label="Fit map">${icon('fit', 2)}</button>
          <button class="hud-btn sq" data-act="zoomin" title="Zoom in (+)" aria-label="Zoom in">${icon('plus', 2)}</button>
          <span class="zl" id="hud-zoom">1.0\u00d7</span>
        </div></div>
      </div>`;
    hud.addEventListener('click', onAction);
    panel.addEventListener('click', onAction);
    panel.addEventListener('submit', onSubmit);
    panel.addEventListener('change', onChange);
    lastHud = {};
    hudUpdate();
    measureHud();
    window.addEventListener('resize', measureHud);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureHud, () => {});
  }
  /** Keep the drawer just below the HUD, however many rows the HUD wraps to. */
  let hudH = 0;
  function measureHud() {
    if (!hud) return;
    const r = hud.getBoundingClientRect();
    const h = Math.round(r.bottom - (hud.parentElement ? hud.parentElement.getBoundingClientRect().top : 0));
    if (h !== hudH) { hudH = h; document.getElementById('app').style.setProperty('--hud-h', h + 'px'); }
  }

  function setText(id, v) { if (lastHud[id] !== v) { lastHud[id] = v; const el = $(id); if (el) el.textContent = v; } }
  function setHTML(id, v) { if (lastHud[id] !== v) { lastHud[id] = v; const el = $(id); if (el) el.innerHTML = v; } }

  function hudUpdate() {
    if (!hud || !hud.firstElementChild) return;
    const now = S.now();
    const p = S.time.ny || S.nyParts(now);
    const cp = clockParts(now);
    setText('hud-day', `${WD[p.dow]} \u00b7 NEW YORK`);
    setHTML('hud-clock', `${esc(cp.hm)}<small>${esc(cp.ap)}</small>`);
    // season + weather
    const season = S.time.season || 'autumn';
    setText('hud-season', season);
    setHTML('hud-season-ico', icon(season, 2, season));
    const wx = townWeather();
    setHTML('hud-wx', `${icon(wx.icon, 2)}<span>${esc(wx.word)}</span>`);
    const cell = $('hud-wx-cell');
    if (cell && cell.title !== wx.tip) cell.title = wx.tip;
    // cycle
    const c = S.cycle || {};
    const cyc = $('hud-cycle');
    if (c.ceremony) {
      setText('hud-cyc-k', c.ceremony.name === 'manual' ? 'Cycle replay' : `Cycle \u00b7 ${c.ceremony.name}`);
      setText('hud-cyc-v', beatName(c.ceremony.progress));
      cyc && cyc.classList.add('live');
      const b = $('hud-cyc-bar'); if (b) b.style.setProperty('--p', (clamp(c.ceremony.progress, 0, 1) * 100).toFixed(1) + '%');
    } else {
      cyc && cyc.classList.remove('live');
      if (c.next) {
        setText('hud-cyc-k', `Next \u00b7 ${c.next.name}`);
        setText('hud-cyc-v', dur(c.next.at.getTime() - now.getTime()));
        const lastAt = c.last ? c.last.at.getTime() : c.next.at.getTime() - 8 * 3600e3;
        const pr = clamp((now.getTime() - lastAt) / Math.max(1, c.next.at.getTime() - lastAt), 0, 1);
        const b = $('hud-cyc-bar'); if (b) b.style.setProperty('--p', (pr * 100).toFixed(1) + '%');
        if (cyc && c.next.focus && cyc.title !== c.next.focus) cyc.title = `${c.next.name}: ${c.next.focus}`;
      } else { setText('hud-cyc-k', 'Next cycle'); setText('hud-cyc-v', 'none set'); }
    }
    // alerts
    const al = arr(D().alerts);
    const lvl = al.some((a) => a.level === 'critical') ? 'critical' : al.length ? 'warn' : 'zero';
    const ab = $('hud-alerts');
    if (ab) {
      const key = al.length + lvl;
      if (lastHud.alerts !== key) {
        lastHud.alerts = key;
        ab.className = 'hud-chip ' + lvl;
        ab.innerHTML = `${icon(lvl === 'critical' ? 'alertCrit' : lvl === 'warn' ? 'alert' : 'ok', 2)}<b>${al.length}</b><span>${al.length === 1 ? 'alert' : 'alerts'}</span>`;
        ab.title = al.length ? al.map((a) => `${a.agent}: ${a.msg}`).join('\n') : 'No alerts';
      }
    }
    // quest count: open you-tasks + quests with a fresh reply
    const open = youTasks().filter((t) => !(checks[t.id] && checks[t.id].done)).length;
    const qc = $('hud-qcount');
    if (qc) { const v = open ? String(open) : ''; if (qc.textContent !== v) qc.textContent = v; qc.hidden = !open; qc.title = `${open} open task${open === 1 ? '' : 's'} for you`; }
    // sound
    const sb = $('hud-sound');
    if (sb) {
      const on = !!(S.audio && S.audio.enabled), has = !!(S.audio && typeof S.audio.toggle === 'function');
      const key = on + '|' + has;
      if (lastHud.sound !== key) {
        lastHud.sound = key;
        sb.setAttribute('aria-pressed', on ? 'true' : 'false');
        sb.disabled = !has;
        sb.innerHTML = `${icon(on ? 'soundOn' : 'soundOff', 2)}<span class="lbl">${on ? 'Sound on' : 'Sound off'}</span>`;
        sb.title = has ? (on ? 'Sound is on (chiptune). Click to mute.' : 'Sound is off. Click for chiptune.') : 'Sound is not available';
      }
    }
    setText('hud-zoom', (S.cam ? S.cam.z : 1).toFixed(1) + '\u00d7');
    // live bits inside the open panel
    if (current && panel && !panel.hidden) {
      const cd = countdownText();
      panel.querySelectorAll('[data-live="countdown"]').forEach((el) => { if (el.textContent !== cd) el.textContent = cd; });
    }
  }

  /* ================================================================ drawer */
  function navStrip(active) {
    return `<nav class="ph-nav" aria-label="Biomes">${NAV.map((b, i) => `<button data-act="biome" data-arg="${b}" style="--c:${THEME[b].color}"${active === b ? ' aria-current="true"' : ''} title="${esc(THEME[b].name)}${i ? ` (${i})` : ''}"><i></i>${esc(NAV_SHORT[b])}</button>`).join('')}</nav>`;
  }
  function head({ who, theme, kicker, title, sub }) {
    return `<div class="panel-head">
      <div class="ph-banner" style="background-image:url(${bannerURL(theme)})"></div>
      <img class="portrait" src="${portraitURL(who, theme)}" alt="">
      <div class="ph-text"><div class="ph-kicker">${esc(kicker)}</div><h2 class="ph-title" id="panel-title">${esc(title)}</h2></div>
      ${sub ? `<div class="ph-sub">${esc(sub)}</div>` : ''}
      <button class="ph-x" data-act="close" aria-label="Close panel" title="Close (Esc)">${icon('close', 2)}</button>
    </div>`;
  }
  function show(theme, html, side, navActive) {
    if (!panel) return;
    const wasHidden = panel.hidden;
    panel.dataset.theme = theme;
    panel.setAttribute('aria-labelledby', 'panel-title');
    panel.classList.toggle('left', side === 'left');
    panel.innerHTML = html.replace('<!--NAV-->', navStrip(navActive));
    panel.hidden = false;
    const body = panel.querySelector('.panel-body');
    if (body) body.scrollTop = 0;
    if (wasHidden && !S.reducedMotion) {
      panel.classList.add('enter');
      requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.remove('enter')));
    }
  }
  /** Which side the drawer goes on so it doesn't cover what you clicked. */
  function sideFor(tx) { return tx >= 38 ? 'left' : 'right'; }

  function openBiome(biome) {
    if (biome === 'north') return openLandmark('school');
    if (biome === 'savings') return openSavings();
    if (biome === 'riverside') return openLandmark('inn');
    const t = THEME[biome];
    if (!t) return;
    const agent = t.agent;
    const inf = AGENT_INFO[agent];
    const th = threadOf(agent) || {};
    current = { kind: 'biome', key: biome };
    const parts = BODY[agent] ? BODY[agent]() : [];
    const reg = S.regions[biome];
    show(biome, head({ who: whoFor(agent), theme: biome, kicker: `${t.name} \u00b7 ${th.label || inf.label}`, title: inf.name, sub: inf.role }) +
      `<!--NAV--><div class="panel-body"><div class="chips">${phasePill(th.phase || (agent === 'hub' ? 'idle' : 'uninit'))}${agent !== 'hub' ? pill(WEATHER[(S.status[biome] || {}).level || 'ok'].word + ' over ' + PLACE[biome], (S.status[biome] || {}).level === 'critical' ? 'crit' : (S.status[biome] || {}).level === 'warn' ? 'warn' : 'mute') : ''}${agent !== 'hub' ? `<span class="pill plain mute">growth ${esc((S.status[biome] || {}).growth ?? 0)}/3</span>` : ''}</div>${parts.join('')}</div>`,
      reg ? sideFor(reg.x + reg.w / 2) : 'right', biome);
    try { S.focusRegion(biome); } catch (e) { /* camera optional */ }
  }

  function openSavings() {
    current = { kind: 'biome', key: 'savings' };
    const m = metricsOf('ledger-fi');
    const goals = arr(m.savings).length ? arr(m.savings) : arr(D().savings_goals);
    const total = goals.reduce((s, g) => s + (num(g.current) || 0), 0);
    const targ = goals.reduce((s, g) => s + (num(g.target) || 0), 0);
    const bld = [['apartment', 'Apartment fund', 'Floors rise as the fund fills'], ['garage', 'Car insurance', 'The shield fills in'], ['investTree', 'Invest', 'The tree grows and fruits']];
    show('savings', head({ who: 'ledger-fi', theme: 'savings', kicker: 'Savings Row \u00b7 Ledger-Fi', title: 'Savings Row', sub: 'Three buildings that grow with your three savings goals.' }) +
      `<!--NAV--><div class="panel-body">${tiles([{ k: 'Saved', v: esc(moneyShort(total)), tone: total ? 'ok' : 'mute' }, { k: 'Targets', v: esc(targ ? moneyShort(targ) : '\u2014'), tone: targ ? '' : 'mute' }, { k: 'Overall', v: targ ? Math.round(total / targ * 100) + '%' : '\u2014', tone: targ ? 'accent' : 'mute' }], 3)}
      ${savingsBlock(m)}
      ${sec('The buildings', `<ul class="rows">${bld.map(([k, n, d]) => `<li class="row click" data-act="landmark" data-arg="${k}" style="--g:1fr auto"><span><span class="t" style="display:block">${esc(S.landmarks[k] ? S.landmarks[k].label : n)}</span><span class="d">${esc(d)}</span></span><span class="d">open \u203a</span></li>`).join('')}</ul>`)}
      </div>`, 'right', null);
    try { S.focusRegion('savings'); } catch (e) { /* camera optional */ }
  }

  /* ---------------------------------------------------------------- villagers */
  let followTimer = 0, following = null;
  /** Glide the camera to a villager and keep them in view until the user drags. */
  function followVillager(id) {
    const v = S.villagers && S.villagers.byId && S.villagers.byId[id];
    clearTimeout(followTimer);
    if (!v || v.hidden || !S.cam) return;
    S.panTo(v.x, v.y - 10, Math.max(S.cam.z, Math.min(3, S.cam.maxZ || 3)));
    following = v;
    followTimer = setTimeout(() => { if (following === v && current && current.kind === 'villager') S.cam.follow = v; }, 520);
  }
  function openVillager(h) {
    const agent = h.agent && AGENT_INFO[h.agent] ? h.agent : null;
    const label = String(h.label || h.name || '');
    if (!agent) {
      const isHudson = /hudson/i.test(label) || h.player || h.id === 'villager:hudson' || h.id === 'villager:player';
      if (isHudson) { openHudson(); followVillager('player'); return; }
      const isCat = /cat|kitty/i.test(label);
      current = { kind: 'villager', key: h.id || label };
      const name = label.split(/[\u00b7,(]/)[0].trim() || 'A neighbour';
      const rest = label.slice(name.length).replace(/^[\s\u00b7,(-]+|\)$/g, '');
      show('square', head({ who: isCat ? 'cat' : 'folk', theme: 'square', kicker: 'Townsfolk \u00b7 Cold Spring', title: name, sub: rest || (isCat ? 'Patrols the square. Accepts chin scratches.' : 'A neighbour of the Shack.') }) +
        `<!--NAV--><div class="panel-body">${emptyBox(isCat ? 'Not an agent. Does no work at all, and is proud of it.' : 'Not one of your agents, just someone who lives here and keeps the town lively.', 'ok')}</div>`, 'right', null);
      return;
    }
    const inf = AGENT_INFO[agent], th = threadOf(agent) || {}, biome = inf.biome;
    current = { kind: 'villager', key: agent };
    const m = metricsOf(agent);
    const bub = arr((m.world || {}).bubbles);
    const al = alertsFor(agent);
    const ceremony = S.cycle && S.cycle.ceremony;
    let doing = 'Going about the day in ' + THEME[biome].name + '.';
    if (ceremony) doing = 'At the fountain for the cycle ceremony.';
    else if (S.time.isNight && S.time.ny && (S.time.ny.hour >= 23 || S.time.ny.hour < 5)) doing = 'Asleep. Zzz.';
    else if (agent === 'hub') doing = 'Minding the clock tower and the quest board.';
    show(biome, head({ who: whoFor(agent), theme: biome, kicker: `${agent === 'hub' ? 'Director' : th.label || inf.label} \u00b7 ${THEME[biome].name}`, title: inf.name, sub: inf.role }) +
      `<!--NAV--><div class="panel-body">
        <div class="chips">${phasePill(th.phase || (agent === 'hub' ? 'idle' : 'uninit'))}<span class="pill plain mute">${esc(doing)}</span></div>
        ${agent === 'hub' ? '' : threadHeader(agent)}
        ${bub.length ? sec('Says', `<div class="chips">${bub.map((x) => `<span class="quote">\u201c${esc(x)}\u201d</span>`).join('')}</div>`) : sec('Says', `<p class="quote">\u201c${esc(agent === 'hub' ? (S.cycle.next ? `Next bell rings for ${S.cycle.next.name} in ${countdownText()}.` : 'The clock keeps ticking.') : 'Waiting for my first cycle. Nothing to report yet!')}\u201d</p>`)}
        ${alertsSection(al)}
        ${glance(agent)}
        <div class="btnrow"><button class="btn primary" data-act="biome" data-arg="${biome}">${icon('fit', 1)} Visit ${esc(THEME[biome].name)}</button>${agent === 'hub' ? `<button class="btn" data-act="quest">${icon('board', 1)} Quest board</button>` : ''}</div>
      </div>`, sideFor((S.regions[biome].x + S.regions[biome].w / 2)), biome);
    followVillager(agent);
  }
  /** A compact slice of the agent's domain for the villager card. */
  function glance(agent) {
    const m = metricsOf(agent);
    if (agent === 'hub') return cyclesBlock();
    if (agent === 'academic-core') return deadlinesBlock(m, 3);
    if (agent === 'ledger-fi') return sec(monthLabel(m.month), moneyTiles(m));
    if (agent === 'social-ops') return sec('This week', tiles([
      { k: 'Posts 7d', v: esc(m.scheduled_posts_7d ?? 0), tone: m.scheduled_posts_7d ? 'accent' : 'mute' },
      { k: 'Drafts', v: esc(m.drafts_pending ?? 0), tone: m.drafts_pending ? '' : 'mute' },
      { k: 'Prospects', v: esc(arr(m.prospects).length), tone: arr(m.prospects).length ? '' : 'mute' }], 3));
    if (agent === 'hustle-engine') return sec('Shopify', shopTiles(m));
    return '';
  }
  function openHudson() {
    current = { kind: 'villager', key: 'hudson' };
    const yt = youTasks();
    const name = (D().player || {}).name || 'Hudson';
    show('square', head({ who: 'hudson', theme: 'square', kicker: 'You \u00b7 ' + (D().home_area || 'Cold Spring, NY'), title: name, sub: 'High-school student, busboy at Hudson House Inn, store owner. The boss of this whole town.' }) +
      `<!--NAV--><div class="panel-body">
        ${sec('On your plate', yt.length ? taskRows(yt) : emptyBox('Nothing on your plate. The agents have it covered.', 'ok'), { n: yt.length })}
        <div class="btnrow"><button class="btn primary" data-act="quest">${icon('board', 1)} Open quest board</button></div>
      </div>`, 'right', 'square');
  }

  /* --------------------------------------------------------------- landmarks */
  const LM = {};
  LM.inn = () => {
    const m = metricsOf('ledger-fi');
    const t2 = arr(D().tasks).find((t) => /M&T|bank|paycheck/i.test(t.title || '') && t.autonomy === 'human');
    return { who: 'hudson', owner: 'ledger-fi', sub: 'Where you bus tables. On Fridays the payday cart rolls coins to the mine vault.', body: [
      paydayBlock(m),
      sec('Bank feed', `<div class="chips">${feedPill(m.bank_feed)}</div><p class="note">${m.bank_feed === 'connected'
        ? 'Grit reads the M&T alert emails, so purchases and deposits show up in the mine.'
        : 'Your paycheck already direct-deposits to M&T checking every Friday, so nothing to fix there. Connecting the M&T alert emails later only lets Grit see deposits and purchases. Ask Claude for the walkthrough when you are ready.'}</p>${t2 ? taskRows([t2]) : ''}`),
    ] };
  };
  LM.school = () => {
    const m = metricsOf('academic-core');
    const t1 = arr(D().tasks).find((t) => /classroom/i.test(t.title || '') && t.autonomy === 'human');
    return { who: 'academic-core', sub: 'Classroom alerts fly from here to the monastery by carrier bird.', body: [
      sec('Classroom feed', `<div class="chips">${feedPill(m.classroom_feed)}</div>${m.classroom_feed === 'connected' ? '' : '<p class="note">Forward Classroom emails from the school Gmail to your personal Gmail and the birds start flying.</p>'}${t1 ? taskRows([t1]) : ''}`),
      deadlinesBlock(m, 4),
    ] };
  };
  LM.temple = () => { const m = metricsOf('academic-core'); return { who: 'academic-core', sub: 'Glowing scrolls on the board are your upcoming deadlines.', body: [deadlinesBlock(m), prepBlock(m)] }; };
  LM.studyGarden = () => { const m = metricsOf('academic-core'); return { who: 'academic-core', sub: 'Raked sand, bonsai and the week\u2019s study blocks.', body: [studyBlock(m), prepBlock(m)] }; };
  LM.mineEntrance = () => { const m = metricsOf('ledger-fi'); return { who: 'ledger-fi', sub: 'Where spending gets dug through, category by category.', body: [sec(monthLabel(m.month), moneyTiles(m)), categoriesBlock(m), anomaliesBlock(m)] }; };
  LM.vault = () => {
    const m = metricsOf('ledger-fi');
    return { who: 'ledger-fi', sub: 'Coin piles grow with this month\u2019s income.', body: [sec(monthLabel(m.month), `<div class="chips">${feedPill(m.bank_feed)}</div>` + moneyTiles(m)), paydayBlock(m), savingsBlock(m)] };
  };
  function goalLandmark(name, who, sub, how) {
    const s = savingsGoal(name) || { name, current: 0, target: null };
    const t = num(s.target), c = num(s.current) || 0;
    const stage = t ? Math.round(c / t * 100) : 0;
    return { who, sub, body: [
      tiles([{ k: 'Saved', v: esc(money(c, 0)), tone: c ? 'ok' : 'mute' }, { k: 'Target', v: esc(t ? money(t, 0) : '\u2014'), tone: t ? '' : 'mute' }, { k: 'Built', v: t ? stage + '%' : '0%', tone: t ? 'accent' : 'mute' }], 3),
      sec(name, `<ul class="rows">${savingsRow(s)}</ul><p class="note">${esc(how)}</p>`),
      t ? '' : emptyBox('No dollar target yet, so it stays at the starting stage. Tell Claude a target and deadline (task T-0004).', 'coin'),
    ] };
  }
  LM.apartment = () => goalLandmark('Apartment fund', 'ledger-fi', 'Under construction. One floor at a time.', 'Floors, scaffolding and the crane track the Apartment fund.');
  LM.garage = () => goalLandmark('Car insurance', 'ledger-fi', 'The shield over the door fills as you save.', 'The shield emblem fills with the Car insurance fund.');
  LM.investTree = () => goalLandmark('Invest', 'ledger-fi', 'Size, leaves and gold fruit follow the Invest goal.', 'From sapling to a fruiting tree as Invest grows.');
  LM.clockTower = () => ({ who: 'hub', sub: 'Shows real New York time. The bell starts each cycle.', body: [
    `<div class="btnrow"><button class="btn primary" data-act="replay">${icon('bell', 1)} Ring the bell (replay cycle)</button></div>`, cyclesBlock(), runsBlock(8)] });
  LM.mailPost = () => ({ who: 'hub', sub: 'Every change to the system arrives here as a letter.', body: [commitsBlock(10)] });
  LM.fountain = () => {
    const goals = arr(D().goals);
    return { who: 'hub', sub: 'Everyone gathers here at each cycle to hand in their reports.', body: [
      `<p class="summary">${S.cycle.next ? `Next gathering: <b>${esc(S.cycle.next.name)}</b> in <span data-live="countdown">${esc(countdownText())}</span>.` : 'No cycles scheduled.'}<small>Coins in the fountain are your goals</small></p>`,
      sec('Wishes (goals)', goals.length ? `<ul class="rows">${goals.map((g) => { const ag = g.agent, b = AGENT_INFO[ag] ? AGENT_INFO[ag].biome : 'square'; return `<li class="row click" data-act="biome" data-arg="${b}" style="--g:auto 1fr auto"><span class="tag">${esc(g.id)}</span><span class="t wrap">${esc(g.title)}</span><span class="d">${esc(AGENT_INFO[ag] ? AGENT_INFO[ag].name : '')}</span></li>`; }).join('')}</ul>` : emptyBox('No goals set.'), { n: goals.length }),
      `<div class="btnrow"><button class="btn" data-act="replay">${icon('replay', 1)} Replay the gathering</button></div>`,
    ] };
  };
  LM.broadcastTower = () => {
    const m = metricsOf('social-ops');
    const nets = {};
    for (const c of arr(m.clients)) for (const n of arr(c.networks)) nets[n] = (nets[n] || 0) + 1;
    return { who: 'social-ops', sub: 'Every scheduled post goes out from here (as a firework).', body: [
      tiles([{ k: 'Posts 7d', v: esc(m.scheduled_posts_7d ?? 0), tone: m.scheduled_posts_7d ? 'accent' : 'mute' }, { k: 'Drafts', v: esc(m.drafts_pending ?? 0), tone: m.drafts_pending ? '' : 'mute' }, { k: 'Networks', v: esc(Object.keys(nets).length), tone: Object.keys(nets).length ? '' : 'mute' }], 3),
      Object.keys(nets).length ? sec('On air', `<div class="chips">${Object.keys(nets).map((n) => `<span class="net ${esc(n)}">${esc(n)}</span>`).join('')}</div>`) : emptyBox('Off air. Nothing scheduled yet.'),
      clientsBlock(m)] };
  };
  function clientBy(re) { return arr(metricsOf('social-ops').clients).find((c) => re.test(c.name || '')) || arr(D().clients).find((c) => re.test(c.name || '')) || null; }
  LM.angiesStall = () => {
    const c = clientBy(/angie/i);
    const t5 = arr(D().tasks).find((t) => /angie/i.test(t.title || '') && t.autonomy === 'human');
    const body = c ? [
      tiles([{ k: 'Posts 7d', v: esc(c.posts_next_7d ?? 0), tone: c.posts_next_7d ? 'accent' : 'mute' }, { k: 'Retainer', v: esc(num(c.retainer) != null ? money(c.retainer, 0) : '\u2014'), tone: num(c.retainer) != null ? 'ok' : 'mute', s: 'per month' }, { k: 'Networks', v: esc(arr(c.networks).length || '\u2014'), tone: arr(c.networks).length ? '' : 'mute' }], 3),
      arr(c.networks).length ? `<div class="chips">${arr(c.networks).map((n) => `<span class="net ${esc(n)}">${esc(n)}</span>`).join('')}</div>` : '',
      c.location ? `<p class="note">Client in ${esc(c.location)}.</p>` : '',
    ] : [emptyBox("Angie's isn't in the client list yet.")];
    if (t5) body.push(sec('To do', taskRows([t5])));
    return { who: 'social-ops', sub: "Lumi's stall for Angie's, the Cold Spring client.", body };
  };
  LM.fidgetStall = () => { const m = metricsOf('social-ops'); const c = clientBy(/fidget/i); return { who: 'social-ops', sub: 'Promo stall for your fidget store: TikTok, Reels, Shorts.', body: [storeAdsBlock(m), c && arr(c.networks).length ? sec('Channels', `<div class="chips">${arr(c.networks).map((n) => `<span class="net ${esc(n)}">${esc(n)}</span>`).join('')}</div><p class="note">${esc(c.posts_next_7d ?? 0)} posts planned for the next 7 days.</p>`) : ''] }; };
  LM.billboard = () => {
    const m = metricsOf('social-ops'), a = m.store_ads || {};
    return { who: 'social-ops', sub: 'Scrolls the numbers that matter this week.', body: [
      tiles([{ k: 'Queued', v: esc(m.scheduled_posts_7d ?? 0), tone: m.scheduled_posts_7d ? 'accent' : 'mute', s: 'posts, 7 days' }, { k: 'Videos', v: esc(a.videos_planned ?? 0), tone: a.videos_planned ? '' : 'mute', s: 'planned' }, { k: 'Clicks', v: esc(a.link_clicks_7d ?? 0), tone: a.link_clicks_7d ? 'ok' : 'mute', s: 'link, 7 days' }], 3),
      (m.scheduled_posts_7d || a.videos_planned) ? '' : emptyBox('Standby screen: nothing queued yet.')] };
  };
  LM.bazaar = () => { const m = metricsOf('hustle-engine'); return { who: 'hustle-engine', sub: 'Stalls of spinners, cubes and pop-its. Ideas get tested here.', body: [oppsBlock(m), storeProjectBlock()] }; };
  LM.dock = () => {
    const m = metricsOf('hustle-engine'), sh = m.shopify || {};
    const o = num(sh.orders_7d);
    const line = o == null ? 'One ship stays moored, empty, until Shopify is connected.' : o === 0 ? 'No orders this week, so the ship rides high and empty.' : `${plural(o, 'order')} this week means cargo ships at the pier.`;
    return { who: 'hustle-engine', sub: 'Cargo ships bring in the week\'s orders.', body: [`<p class="summary">${esc(line)}<small>Ships moored scale with orders in the last 7 days</small></p>`, sec('Shopify \u00b7 last 7 days', shopTiles(m)), alertsSection(alertsFor('hustle-engine'), 'Harbour alerts'), storeProjectBlock()] };
  };
  LM.warehouse = () => { const m = metricsOf('hustle-engine'); return { who: 'hustle-engine', sub: 'Crates of stock. Red tags mean running low.', body: [lowStockBlock(m)] }; };

  function openLandmark(key, h) {
    if (key === 'questBoard') return openQuestBoard();
    const lm = S.landmarks[key] || { region: (h && h.biome) || 'square', label: (h && h.label) || key, x: 32, y: 20 };
    const fn = LM[key];
    const region = lm.region || (h && h.biome) || 'square';
    const theme = THEME[region] ? region : 'square';
    const info = fn ? fn() : { who: whoFor((h && h.agent) || THEME[theme].agent || 'hub'), sub: '', body: [emptyBox('A quiet corner of town.')] };
    current = { kind: 'landmark', key };
    const ownerAgent = info.owner || (info.who && AGENT_INFO[info.who] ? info.who : null);
    const navB = ownerAgent ? AGENT_INFO[ownerAgent].biome : null;
    const goto = navB && navB !== 'square' ? `<div class="btnrow"><button class="btn" data-act="biome" data-arg="${navB}">${icon('fit', 1)} ${esc(AGENT_INFO[ownerAgent].name)}\u2019s full report</button></div>` : '';
    show(theme, head({ who: info.who || 'folk', theme, kicker: `${THEME[theme].name}${ownerAgent ? ' \u00b7 ' + AGENT_INFO[ownerAgent].name : ''}`, title: lm.label.replace(/\s*\(.*\)$/, ''), sub: info.sub }) +
      `<!--NAV--><div class="panel-body">${info.body.join('')}${goto}</div>`, sideFor(lm.x), navB);
  }

  /* ============================================================= Quest board */
  let db = null, dbState = 'none', dbNote = '';
  let quests = [], questsLoaded = false, checks = {}, pendingChecks = {};
  let canWrite = true;
  const BIOME_OPTS = [['auto', 'Auto: Mayor Tock decides'], ['monastery', 'Monastery: school'], ['mine', 'Mine: money'], ['market', 'Market: social'], ['port', 'Port: fidget store']];
  const QSTATUS = { new: ['new', 'info'], accepted: ['accepted', 'brass'], done: ['done', 'ok'], declined: ['declined', 'mute'] };

  function initDb() {
    if (!(window.claude && typeof window.claude.use === 'function')) { dbState = 'none'; return; }
    dbState = 'pending';
    let p;
    try { p = window.claude.use('db'); } catch (e) { dbState = 'none'; return; }
    Promise.resolve(p).then((d) => {
      if (!d) { dbState = 'none'; refreshBoard(); return; }
      db = d; dbState = 'ready';
      try {
        db.collection('quests').orderBy('created', 'desc').limit(50).onSnapshot((snap) => {
          quests = snap.docs.map((doc) => Object.assign({ id: doc.id }, doc.data() || {}));
          questsLoaded = true; refreshBoard();
        }, (err) => { dbState = 'error'; dbNote = 'Quest board went offline' + (err && err.code ? ` (${err.code})` : '') + '. Showing what was loaded.'; refreshBoard(); });
        db.collection('checks').onSnapshot((snap) => {
          const next = {};
          for (const doc of snap.docs) next[doc.id] = doc.data() || {};
          checks = next; refreshBoard(); lastHud.qc = null;
        }, () => { /* checks are optional; the quests listener reports errors */ });
      } catch (e) { dbState = 'error'; dbNote = 'Quest board could not connect.'; }
      refreshBoard();
    }, () => { dbState = 'none'; refreshBoard(); });
  }

  function dbLine() {
    if (dbState === 'ready') return canWrite ? '' : 'You can read the board but not post from this account.';
    if (dbState === 'pending') return 'Connecting to the quest board\u2026';
    if (dbState === 'error') return dbNote || 'Quest board is offline right now.';
    return 'Read-only preview: posting quests and ticking tasks work when this page is opened on claude.ai.';
  }

  function openQuestBoard() {
    current = { kind: 'quest', key: 'questBoard' };
    const live = dbState === 'ready' && canWrite;
    show('square', head({ who: 'hub', theme: 'square', kicker: 'Town Square \u00b7 Mayor Tock', title: 'Quest Board', sub: 'Pin a request. Mayor Tock routes it to the right biome and replies at the next cycle.' }) +
      `<!--NAV--><div class="panel-body">
        <form class="qform" id="qform" autocomplete="off">
          <label class="sec-h" for="qtext" style="color:#e0c9a0"><span>New quest</span></label>
          <textarea id="qtext" name="text" maxlength="400" rows="3" placeholder="e.g. Make a Quizlet set for the precalc unit 2 test" ${live ? '' : 'disabled'}></textarea>
          <div class="qrow">
            <select id="qbiome" name="biome" aria-label="Who should take it" ${live ? '' : 'disabled'}>${BIOME_OPTS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
            <button class="btn primary" type="submit" ${live ? '' : 'disabled'}>${icon('pin', 2)} Pin it</button>
          </div>
          <p class="qstatus" id="qstatus">${esc(dbLine())}</p>
        </form>
        <section class="sec"><h3 class="sec-h"><span>Quests</span><span class="n" id="qcount"></span></h3><div id="qlist"></div></section>
        <section class="sec"><h3 class="sec-h"><span>Your tasks</span><span class="n" id="tcount"></span></h3><div id="tprog"></div><div id="tlist" class="rows"></div></section>
      </div>`, 'right', 'square');
    renderQuests(); renderChecks();
  }
  function refreshBoard() {
    if (current && current.kind === 'quest' && panel && !panel.hidden) {
      const live = dbState === 'ready' && canWrite;
      panel.querySelectorAll('#qform textarea, #qform select, #qform button').forEach((el) => { el.disabled = !live || el.dataset.busy === '1'; });
      const st = $('qstatus');
      if (st && !st.dataset.sticky) { st.className = 'qstatus'; st.textContent = dbLine(); }
      renderQuests(); renderChecks();
    }
    hudUpdate();
  }
  function renderQuests() {
    const box = $('qlist');
    if (!box) return;
    const c = $('qcount'); if (c) c.textContent = quests.length ? String(quests.length) : '';
    if (!quests.length) {
      box.innerHTML = emptyBox(dbState === 'ready' ? (questsLoaded ? 'No quests yet. Pin the first one above.' : 'Loading quests\u2026') : 'No quests to show here. Quests you pin on claude.ai appear in this list.', 'board');
      return;
    }
    box.innerHTML = `<div class="rows" style="gap:4px">${quests.map((q) => {
      const st = QSTATUS[q.status] || [q.status || 'new', 'mute'];
      const b = THEME[q.biome] ? q.biome : null;
      return `<article class="quest" style="--qc:${b ? THEME[b].color : 'var(--brass)'}"><div class="qh">${pill(st[0], st[1])}<span class="tag">${esc(b ? NAV_SHORT[b] : 'auto')}</span>${q.task_id ? `<span class="tag">${esc(q.task_id)}</span>` : ''}<span class="when-rel">${esc(rel(q.created))}</span></div><div class="qt">${esc(q.text)}</div>${q.reply ? `<div class="letter"><b>Mayor Tock replies</b>${esc(q.reply)}</div>` : (q.status === 'new' || !q.status ? '<div class="note">Mayor Tock reads this at the next cycle.</div>' : '')}</article>`;
    }).join('')}</div>`;
  }
  function renderChecks() {
    const box = $('tlist');
    if (!box) return;
    const yt = youTasks();
    const live = dbState === 'ready' && canWrite;
    const doneN = yt.filter((t) => checks[t.id] && checks[t.id].done).length;
    const c = $('tcount'); if (c) c.textContent = yt.length ? `${doneN}/${yt.length}` : '';
    const pr = $('tprog'); if (pr) pr.innerHTML = yt.length ? bar(doneN / yt.length, 'ok', true) : '';
    if (!yt.length) { box.innerHTML = emptyBox('No tasks need you right now.', 'ok'); return; }
    box.innerHTML = yt.map((t) => {
      const done = !!(checks[t.id] && checks[t.id].done);
      const busy = !!pendingChecks[t.id];
      const ag = AGENT_INFO[t.agent];
      return `<label class="check${done ? ' done' : ''}${live ? '' : ' ro'}"><input type="checkbox" data-task="${esc(t.id)}" ${done ? 'checked' : ''} ${!live || busy ? 'disabled' : ''}><span><span class="t" style="display:block">${esc(t.title)}</span><span class="d">${esc(t.id)}${ag ? ' \u00b7 ' + esc(ag.name) : ''}${t.due ? ' \u00b7 due ' + esc(dayLabel(t.due)) : ''}${t.notes ? ' \u00b7 ' + esc(t.notes) : ''}</span></span><span class="tag">P${esc(t.priority ?? '-')}</span></label>`;
    }).join('');
  }
  function onSubmit(e) {
    if (!e.target || e.target.id !== 'qform') return;
    e.preventDefault();
    const ta = $('qtext'), sel = $('qbiome'), st = $('qstatus');
    const text = (ta && ta.value || '').trim();
    const status = (msg, cls) => { if (st) { st.className = 'qstatus ' + (cls || ''); st.textContent = msg; st.dataset.sticky = cls ? '1' : ''; } };
    if (!db || dbState !== 'ready') { status(dbLine()); return; }
    if (!text) { status('Write the quest first.', 'err'); if (ta) ta.focus(); return; }
    const biome = sel && BIOME_OPTS.some(([v]) => v === sel.value) ? sel.value : 'auto';
    const btn = panel.querySelector('#qform button[type="submit"]');
    if (btn) { btn.disabled = true; btn.dataset.busy = '1'; }
    status('Pinning\u2026');
    db.collection('quests').add({ text: text.slice(0, 400), biome, status: 'new', created: new Date().toISOString() }).then(() => {
      if (ta) ta.value = '';
      status('Pinned. Mayor Tock will read it at the next cycle.', 'ok');
      showToast('Quest pinned to the board', 'pin');
      try { S.audio.sfx('bell'); } catch (err) { /* optional */ }
    }, (err) => {
      const code = err && err.code;
      if (code === 'invalid_argument' || code === 'not_granted') { canWrite = false; status('This account can read the board but not post to it.', 'err'); }
      else if (code === 'quota_exceeded') status('The board is full. Ask Claude to archive old quests.', 'err');
      else status('Could not pin it right now. Try again in a moment.', 'err');
    }).then(() => { if (btn) { btn.dataset.busy = ''; btn.disabled = !(dbState === 'ready' && canWrite); } setTimeout(() => { if (st) st.dataset.sticky = ''; }, 4000); });
  }
  function onChange(e) {
    const el = e.target;
    if (!el || !el.dataset || !el.dataset.task) return;
    const id = el.dataset.task;
    if (!db || dbState !== 'ready' || pendingChecks[id]) { el.checked = !!(checks[id] && checks[id].done); return; }
    const done = el.checked;
    pendingChecks[id] = true; el.disabled = true;
    checks = Object.assign({}, checks, { [id]: { done, at: new Date().toISOString() } });
    renderChecks(); hudUpdate();
    db.collection('checks').doc(id).set({ done, at: new Date().toISOString() }).then(() => {
      if (done) { showToast('Ticked off. Nice.', 'ok'); try { S.audio.sfx('coin'); } catch (err) { /* optional */ } }
    }, (err) => {
      const prev = Object.assign({}, checks); prev[id] = { done: !done }; checks = prev;
      if (err && (err.code === 'invalid_argument' || err.code === 'not_granted')) canWrite = false;
      showToast('Could not save that tick.', 'alert');
    }).then(() => { delete pendingChecks[id]; renderChecks(); hudUpdate(); });
  }

  /* ================================================================ toast */
  let toastTimer = 0;
  function showToast(msg, ic) {
    if (!toast) return;
    toast.innerHTML = `${ic ? icon(ic, 2) : ''}<span>${esc(msg)}</span>`;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2400);
  }

  /* ================================================================ actions */
  function close() {
    if (!panel) return;
    panel.hidden = true; panel.innerHTML = ''; current = null;
    if (following && S.cam && S.cam.follow === following) S.cam.follow = null;
    following = null; clearTimeout(followTimer);
  }
  function onAction(e) {
    const el = e.target.closest && e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act, arg = el.dataset.arg;
    switch (act) {
      case 'close': close(); break;
      case 'biome': openBiome(arg); break;
      case 'landmark': openLandmark(arg); break;
      case 'quest': if (current && current.kind === 'quest') close(); else openQuestBoard(); break;
      case 'alerts': openBiome('square'); break;
      case 'replay': S.startCeremony(); showToast('Mayor Tock rings the bell\u2026', 'bell'); try { S.audio.sfx('bell'); } catch (err) { /* optional */ } break;
      case 'sound':
        if (S.audio && typeof S.audio.toggle === 'function') { try { S.audio.toggle(); } catch (err) { /* optional */ } lastHud.sound = null; hudUpdate(); showToast(S.audio.enabled ? 'Sound on' : 'Sound off', S.audio.enabled ? 'soundOn' : 'soundOff'); }
        break;
      case 'zoomin': S.zoomBy(1.25); hudUpdate(); break;
      case 'zoomout': S.zoomBy(0.8); hudUpdate(); break;
      case 'fit': fit(); break;
      default: return;
    }
    if (act !== 'sound') { try { S.audio.sfx('click'); } catch (err) { /* optional */ } }
  }

  /** Fit the whole map. Uses a pan so it also cancels any camera glide in flight. */
  function fit() {
    if (S.cam && typeof S.panTo === 'function') { S.cam.follow = null; S.panTo(S.W / 2, S.H / 2, S.cam.fitZ); }
    else S.fitView();
    hudUpdate();
  }
  function beatName(pr) {
    const B = S.CEREMONY_BEATS || {};
    const names = { bell: 'bell rings', gather: 'gathering', council: 'council', disperse: 'heading out' };
    for (const k of Object.keys(names)) { const r = B[k]; if (r && pr >= r[0] && pr < r[1]) return names[k]; }
    return 'in progress';
  }
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    const typing = /input|textarea|select/i.test(tag || '') || (e.target && e.target.isContentEditable);
    if (e.key === 'Escape') {
      if (typing && e.target.blur) e.target.blur();
      if (panel && !panel.hidden) { close(); e.preventDefault(); }
      return;
    }
    if (typing) return;
    const k = e.key.toLowerCase();
    if (k === 'q') { if (current && current.kind === 'quest') close(); else openQuestBoard(); }
    else if (k === 'f') fit();
    else if (k === '1') openBiome('monastery');
    else if (k === '2') openBiome('market');
    else if (k === '3') openBiome('port');
    else if (k === '4') openBiome('mine');
    else return;
    e.preventDefault();
  }

  /* ================================================================ open() */
  function open(h) {
    if (!h) return;
    try {
      if (h.kind === 'landmark' && h.landmark) return openLandmark(h.landmark, h);
      if (h.kind === 'villager') return openVillager(h);
      if (h.kind === 'quest' || h.id === 'questBoard') return openQuestBoard();
      if (h.kind === 'biome') {
        const b = h.biome || (h.agent && AGENT_INFO[h.agent] && AGENT_INFO[h.agent].biome);
        return openBiome(b || 'square');
      }
      if (h.agent && AGENT_INFO[h.agent]) return openBiome(AGENT_INFO[h.agent].biome);
      if (h.biome) return openBiome(h.biome);
    } catch (err) {
      console.error('ui.open', err);
    }
  }

  S.ui = { open, hudUpdate, close, questBoard: openQuestBoard, toast: showToast };

  S.on('boot', () => {
    buildHud();
    window.addEventListener('keydown', onKey);
    initDb();
  });
  S.on('ceremony:start', () => { lastHud = Object.assign({}, lastHud, { 'hud-cyc-k': null }); });
})();
