/* The Shack: 70-audio.js (Audio)
 *
 * Procedural WebAudio chiptune. No audio files: every sound is built from
 * oscillators, a pulse-wave table and a noise buffer.
 *
 *   S.audio = { enabled, toggle(), sfx(name), setBiome(id) }
 *
 * - Off by default. The AudioContext is only created/resumed inside a user
 *   gesture (the HUD Sound button calls toggle() from a click). A remembered
 *   "on" preference arms the audio, which then starts on the first click or
 *   key press anywhere on the page.
 * - One ambient loop per biome, chosen from the biome under the camera centre
 *   (checked once a second) and crossfaded:
 *     square    a gentle town waltz (3/4, triangle bass, pulse melody, clock chimes)
 *     monastery slow pentatonic temple bells with long decay over a singing-bowl drone
 *     mine      bouncy square bass, pickaxe clinks and thumps, a whistled dwarf tune
 *     market    synthwave arpeggio with a soft detuned pad, kick and clap
 *     port      a 6/8 sea shanty on triangle, squeezebox blips, filtered-noise waves
 * - Notes are placed on the audio clock by a lookahead scheduler (a 40 ms timer
 *   schedules everything in the next 300 ms at exact AudioContext times), so
 *   timer jitter never reaches the rhythm.
 * - Night (S.time.light) lowers the volume and the tempo.
 * - SFX: bell, coin, click, firework, chirp, cart, splash.
 */
(function () {
  'use strict';
  const S = window.SHACK;
  if (!S) return;

  const AC = window.AudioContext || window.webkitAudioContext;
  const KEY = 'shack.audio';
  const MASTER = 0.15;          // overall level when it is day
  const LOOKAHEAD = 0.3;        // seconds of music scheduled ahead
  const TICK_MS = 40;           // scheduler wake-up period
  const MAX_VOICES = 110;       // safety cap for music voices
  const MUSIC = 1, SFX_LEVEL = 3.8; // inner levels under the master

  let enabled = false;
  try { enabled = window.localStorage.getItem(KEY) === '1'; } catch (e) { /* storage blocked */ }

  let ac = null;                // AudioContext (created lazily, inside a gesture)
  let G = null;                 // shared nodes
  let tracks = null;            // ambient loops
  let current = null;           // id of the loop that is fading in / playing
  let wanted = 'square';        // loop the camera asks for
  let candidate = null, candidateN = 0;
  let schedTimer = 0, trackTimer = 0, stopTimer = 0;
  let voices = 0;
  let masterTarget = -1;
  const lastSfx = {};

  const mf = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  /* ------------------------------------------------------------ the graph */

  function pulseWave(duty) {
    const n = 40, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return ac.createPeriodicWave(re, im);
  }

  function gain(v, to) {
    const g = ac.createGain();
    g.gain.value = v;
    if (to) g.connect(to);
    return g;
  }

  function makeImpulse(seconds, decay) {
    const rate = ac.sampleRate, len = Math.floor(rate * seconds);
    const buf = ac.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const x = i / len;
        lp += ((Math.random() * 2 - 1) - lp) * 0.55;          // a little darker than white
        d[i] = lp * Math.pow(1 - x, decay) * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
      }
    }
    return buf;
  }

  function build() {
    ac = new AC();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.25;
    comp.connect(ac.destination);

    const master = gain(0, comp);
    const music = gain(MUSIC, master);
    const sfx = gain(SFX_LEVEL, master);

    // Warm room reverb shared by everything.
    const verb = ac.createConvolver();
    verb.buffer = makeImpulse(2.4, 3.2);
    const verbTone = ac.createBiquadFilter();
    verbTone.type = 'lowpass'; verbTone.frequency.value = 3200;
    const revIn = gain(1);
    revIn.connect(verb); verb.connect(verbTone); verbTone.connect(gain(0.42, master));
    const sfxRev = gain(0.35, revIn);
    sfx.connect(sfxRev);

    // White noise, 2 s, looped with random offsets.
    const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    if (S.debug.audioNoMusic) music.gain.value = 0;  // dev preview: measure SFX alone
    G = { comp, master, music, sfx, revIn, noise: nb, p12: pulseWave(0.125), p25: pulseWave(0.25), p50: pulseWave(0.5) };
    tracks = TRACKS.map(makeTrack);
    ac.onstatechange = () => { if (ac.state === 'running') disarm(); };
  }

  function makeTrack(def) {
    const out = gain(def.trim, G.music);
    const bus = gain(0, out);
    bus.connect(gain(def.rev, G.revIn));
    // Per-track echo (tempo-ish delay), fading together with the bus.
    const wet = gain(1, bus);
    const dl = ac.createDelay(1.5);
    dl.delayTime.value = def.echo[0];
    const tone = ac.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = 2400;
    const fb = gain(def.echo[1]);
    wet.connect(dl); dl.connect(tone); tone.connect(fb); fb.connect(dl);
    tone.connect(gain(def.echo[2], bus));
    return Object.assign({}, def, { bus, dry: bus, wet, running: false, stopAt: 0, i: 0, next: 0, state: {} });
  }

  /* --------------------------------------------------------------- voices */

  function src(w, f, t) {
    const o = ac.createOscillator();
    if (typeof w === 'string') o.type = w; else o.setPeriodicWave(w);
    o.frequency.setValueAtTime(f, t);
    return o;
  }
  function track(node, music) {
    if (!music) return;
    voices++;
    node.onended = () => { voices--; };
  }

  /** One oscillator note.
   *  o: {w, f, t, d, v, a?, r?, env:'hold'|'pluck', lp?, q?, slide?, slideT?, det?} */
  function note(out, o, music = true) {
    if (music && voices > MAX_VOICES) return;
    const t = o.t, a = o.a || 0.005, d = Math.max(a + 0.01, o.d), r = o.r || 0.06;
    const s = src(o.w, o.f, t);
    if (o.det) s.detune.setValueAtTime(o.det, t);
    if (o.slide) s.frequency.exponentialRampToValueAtTime(o.slide, t + (o.slideT || d));
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.v, t + a);
    let end;
    if (o.env === 'pluck') {
      g.gain.exponentialRampToValueAtTime(0.0006, t + d);
      end = t + d + 0.02;
    } else {
      g.gain.setValueAtTime(o.v, t + d);
      g.gain.exponentialRampToValueAtTime(0.0006, t + d + r);
      end = t + d + r + 0.02;
    }
    if (o.lp) {
      const f = ac.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.setValueAtTime(o.lp, t); f.Q.value = o.q || 0.7;
      s.connect(f); f.connect(g);
    } else s.connect(g);
    g.connect(out);
    track(s, music);
    s.start(t); s.stop(end);
    return s;
  }

  /** Filtered noise burst. o: {t, d, v, type?, f, q?, fEnd?, a?, env?, r?} */
  function noise(out, o, music = true) {
    if (music && voices > MAX_VOICES) return;
    const t = o.t, a = o.a || 0.002, d = Math.max(a + 0.01, o.d);
    const s = ac.createBufferSource();
    s.buffer = G.noise; s.loop = true;
    const f = ac.createBiquadFilter();
    f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f, t); f.Q.value = o.q || 1;
    if (o.fEnd) f.frequency.exponentialRampToValueAtTime(o.fEnd, t + d);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.v, t + a);
    let end;
    if (o.env === 'hold') {
      const r = o.r || 0.1;
      g.gain.setValueAtTime(o.v, t + d);
      g.gain.exponentialRampToValueAtTime(0.0006, t + d + r);
      end = t + d + r + 0.02;
    } else {
      g.gain.exponentialRampToValueAtTime(0.0006, t + d);
      end = t + d + 0.02;
    }
    s.connect(f); f.connect(g); g.connect(out);
    track(s, music);
    s.start(t, Math.random() * 1.6); s.stop(end);
    return { s, g, f };
  }

  /** Struck bell: inharmonic sine partials, higher ones dying first. */
  const BELL_PARTS = [[0.5, 0.32, 1.25], [1, 1, 1], [2, 0.42, 0.62], [2.76, 0.3, 0.45], [4.07, 0.13, 0.3], [5.43, 0.07, 0.2]];
  const CHIME_PARTS = [[1, 1, 1], [2.76, 0.28, 0.4], [5.4, 0.1, 0.18]];
  function bell(out, f, t, v, decay, parts = BELL_PARTS, music = true) {
    if (music && voices > MAX_VOICES) return;
    for (const [ratio, amp, dk] of parts) {
      const fr = f * ratio;
      if (fr > 12000) continue;
      const s = src('sine', fr, t);
      const g = ac.createGain();
      const end = t + decay * dk;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v * amp, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0005, end);
      s.connect(g); g.connect(out);
      track(s, music);
      s.start(t); s.stop(end + 0.03);
    }
  }

  /** Soft drum thump: a sine that falls in pitch. */
  function thump(out, t, v, f0 = 120, f1 = 42, d = 0.22, music = true) {
    note(out, { w: 'sine', f: f0, slide: f1, slideT: d * 0.6, t, d, v, a: 0.002, env: 'pluck' }, music);
  }

  /** Pickaxe on rock: two bright inharmonic pings and a tick of noise. */
  function clink(out, t, v, f, music = true) {
    note(out, { w: 'sine', f, t, d: 0.16, v, a: 0.001, env: 'pluck' }, music);
    note(out, { w: 'sine', f: f * 1.47, t, d: 0.09, v: v * 0.6, a: 0.001, env: 'pluck' }, music);
    noise(out, { t, d: 0.035, v: v * 0.9, type: 'bandpass', f: 5200, q: 3 }, music);
  }

  /* --------------------------------------------------------------- tracks
   * Each loop: {id, bpm, spb (steps per beat), len (steps per loop), swing,
   * rev (reverb send), echo [time, feedback, mix], step(s, t, sd, loop, tr)}.
   * `t` is the exact audio time of the step, `sd` the step length in seconds.
   */

  // Town waltz in F, 3/4: eighth-note steps, 6 per bar, 8 bars.
  const W_BASS = [41, 50, 46, 48, 41, 43, 48, 41];
  const W_CHORD = [[57, 60, 65], [57, 62, 65], [58, 62, 65], [55, 60, 64], [57, 60, 65], [55, 58, 62], [55, 58, 64], [57, 60, 65]];
  const W_MEL = [
    [[0, 72, 4], [4, 69, 2]],
    [[0, 74, 3], [3, 72, 1], [4, 69, 2]],
    [[0, 70, 4], [4, 74, 2]],
    [[0, 72, 5]],
    [[0, 69, 2], [2, 72, 2], [4, 77, 2]],
    [[0, 74, 3], [3, 72, 1], [4, 70, 2]],
    [[0, 67, 2], [2, 70, 2], [4, 76, 2]],
    [[0, 77, 5]],
  ];

  // Temple bells: D "yo" pentatonic (D E G A B).
  const M_SCALE = [62, 64, 67, 69, 71, 74, 76, 79, 81, 83, 86];
  const M_PHRASE = [[0, 5], [3, 3], [4, 4], [8, 2], [12, 3], [14, 1], [16, 5], [19, 6], [20, 4], [24, 3], [26, 2], [28, 0]];

  // Mine: A minor stomp, eighth steps, 8 per bar, 4 bars.
  const N_ROOT = [45, 45, 41, 43];
  const N_BASS = [0, 12, 7, 12, 0, 12, 7, 10];
  const N_MEL = [
    [[0, 69, 1], [1, 72, 1], [2, 76, 2], [5, 74, 1], [6, 72, 2]],
    [[0, 69, 3], [4, 64, 2], [6, 67, 2]],
    [[0, 65, 1], [1, 69, 1], [2, 72, 2], [4, 74, 2], [6, 72, 2]],
    [[0, 71, 3], [3, 67, 1], [4, 74, 2], [6, 71, 1], [7, 69, 1]],
  ];

  // Market: Am F C G, sixteenth steps, 16 per bar, 4 bars.
  const K_TONES = [[57, 60, 64, 69, 72], [57, 60, 65, 69, 72], [55, 60, 64, 67, 72], [55, 59, 62, 67, 71]];
  const K_PAD = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
  const K_BASS = [45, 41, 48, 43];
  const K_ARP = [0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 4, 2, 1, 3, 4, 3];

  // Port: D dorian shanty in 6/8, eighth steps, 6 per bar, 8 bars.
  const P_ROOT = [38, 38, 36, 36, 38, 34, 36, 38];
  const P_CHORD = [[57, 62, 65], [57, 62, 65], [55, 60, 64], [55, 60, 64], [57, 62, 65], [58, 62, 65], [55, 60, 64], [57, 62, 65]];
  const P_MEL = [
    [[0, 62, 2], [2, 62, 1], [3, 65, 2], [5, 69, 1]],
    [[0, 69, 3], [3, 67, 1], [4, 65, 1], [5, 64, 1]],
    [[0, 64, 2], [2, 60, 1], [3, 64, 2], [5, 67, 1]],
    [[0, 67, 3], [3, 65, 1], [4, 64, 1], [5, 62, 1]],
    [[0, 62, 2], [2, 65, 1], [3, 69, 2], [5, 74, 1]],
    [[0, 74, 2], [2, 72, 1], [3, 70, 2], [5, 69, 1]],
    [[0, 67, 2], [2, 64, 1], [3, 67, 2], [5, 64, 1]],
    [[0, 62, 5]],
  ];

  function melodyAt(bars, s, per) {
    const bar = Math.floor(s / per), pos = s % per;
    const list = bars[bar] || [];
    for (const n of list) if (n[0] === pos) return n;
    return null;
  }

  const TRACKS = [
    {
      id: 'square', trim: 4.4, bpm: 100, spb: 2, len: 48, swing: 0, rev: 0.32, echo: [0.3, 0.22, 0.22],
      step(s, t, sd, loop, tr) {
        const bar = Math.floor(s / 6), pos = s % 6;
        // oom: triangle bass on beat 1, fifth on beat 3 every other bar for lilt
        if (pos === 0) note(tr.dry, { w: 'triangle', f: mf(W_BASS[bar]), t, d: sd * 1.7, v: 0.22, a: 0.004, env: 'pluck' });
        if (pos === 4 && bar % 2 === 1) note(tr.dry, { w: 'triangle', f: mf(W_BASS[bar] + 7), t, d: sd * 1.2, v: 0.13, env: 'pluck' });
        // pah-pah: soft pulse chord stabs on beats 2 and 3
        if (pos === 2 || pos === 4) for (const m of W_CHORD[bar]) note(tr.dry, { w: G.p25, f: mf(m), t, d: sd * 0.75, v: 0.028, lp: 1700, env: 'pluck' });
        // melody: music-box pulse on even loops, a flute-like triangle an octave up on odd loops
        const n = melodyAt(W_MEL, s, 6);
        if (n) {
          if (loop % 2 === 0) note(tr.wet, { w: G.p12, f: mf(n[1]), t, d: sd * n[2] * 0.88, v: 0.065, a: 0.01, r: 0.14, lp: 2600 });
          else note(tr.wet, { w: 'triangle', f: mf(n[1] + 12), t, d: sd * n[2] * 0.85, v: 0.15, a: 0.02, r: 0.18 });
        }
        // the clock tower answers at the end of each phrase
        if (pos === 3 && bar === 3) bell(tr.wet, mf(84), t, 0.035, 1.8, CHIME_PARTS);
        if (pos === 3 && bar === 7) { bell(tr.wet, mf(81), t, 0.03, 1.8, CHIME_PARTS); bell(tr.wet, mf(77), t + sd, 0.03, 2.2, CHIME_PARTS); }
      },
    },
    {
      id: 'monastery', trim: 2.6, bpm: 52, spb: 2, len: 32, swing: 0, rev: 0.75, echo: [0.52, 0.3, 0.3],
      onStart(t, tr) { tr.state.droneUntil = 0; },
      step(s, t, sd, loop, tr) {
        const loopDur = sd * 32;
        // singing-bowl drone: D3 + A3, two slightly detuned sines, re-struck every loop with overlap
        if (s === 0) {
          for (const [m, det] of [[50, -4], [50, 5], [57, 3]]) note(tr.dry, { w: 'sine', f: mf(m), det, t, d: loopDur, v: 0.035, a: 3.2, r: 3.4 });
          bell(tr.dry, mf(50), t, 0.13, 7.5);                  // the deep temple bell
        }
        // phrase with a little drift each loop
        for (const [at, idx] of M_PHRASE) {
          if (at !== s) continue;
          if (loop > 0 && Math.random() < 0.15) continue;
          let k = idx;
          if (loop > 0 && Math.random() < 0.22) k = clamp(k + (Math.random() < 0.5 ? -1 : 1), 0, M_SCALE.length - 1);
          bell(tr.wet, mf(M_SCALE[k]), t + rand(0, 0.03), 0.075, rand(3.4, 4.6));
        }
        // wind chimes: a few faint high notes per loop
        if (s % 4 === 2 && Math.random() < 0.18) bell(tr.wet, mf(pick(M_SCALE.slice(7))), t + rand(0, sd), 0.022, 2.4, CHIME_PARTS);
      },
    },
    {
      id: 'mine', trim: 3.5, bpm: 112, spb: 2, len: 32, swing: 0.12, rev: 0.22, echo: [0.27, 0.2, 0.16],
      step(s, t, sd, loop, tr) {
        const bar = Math.floor(s / 8), pos = s % 8;
        const r = N_ROOT[bar];
        // bouncy octave bass on a 50% pulse, a touch of filter snap
        const iv = pos === 7 ? (bar === 3 ? 14 : bar === 2 ? 7 : 10) : N_BASS[pos];  // no Eb over F
        note(tr.dry, { w: G.p50, f: mf(r + iv), t, d: sd * 0.72, v: 0.12, a: 0.003, lp: pos % 2 ? 1300 : 900, q: 3, env: 'pluck' });
        // pickaxe thumps on 1 and 3, clinks on 2 and 4
        if (pos === 0 || pos === 4) thump(tr.dry, t, 0.14, 120, 50, 0.16);
        if ((pos === 2 || pos === 6) && Math.random() < 0.88) clink(tr.dry, t + rand(0, 0.012), 0.05, pick([2650, 2900, 3150]));
        if (pos % 2 === 1) noise(tr.dry, { t, d: 0.03, v: 0.018, type: 'highpass', f: 7000 });
        // a whistled dwarf tune, resting every third loop
        if (loop % 3 !== 2) {
          const n = melodyAt(N_MEL, s, 8);
          if (n) note(tr.wet, { w: G.p25, f: mf(n[1]), t, d: sd * n[2] * 0.8, v: 0.055, a: 0.006, r: 0.06, lp: 2400 });
        } else if (pos === 5 && Math.random() < 0.5) clink(tr.wet, t, 0.035, 3600);
      },
    },
    {
      id: 'market', trim: 4.0, bpm: 100, spb: 4, len: 64, swing: 0, rev: 0.3, echo: [0.45, 0.38, 0.34],
      step(s, t, sd, loop, tr) {
        const bar = Math.floor(s / 16), pos = s % 16;
        // soft detuned saw pad, one chord per bar
        if (pos === 0) for (const m of K_PAD[bar]) for (const det of [-9, 8]) note(tr.dry, { w: 'sawtooth', f: mf(m), det, t, d: sd * 15, v: 0.022, a: 0.5, r: 0.9, lp: 760, q: 0.8 });
        // the arpeggio: 25% pulse, filter opens and closes across the loop
        const cut = 1000 + 1500 * (0.5 - 0.5 * Math.cos((s / 64) * Math.PI * 2));
        const m = K_TONES[bar][K_ARP[pos]] + 12;
        note(tr.wet, { w: G.p25, f: mf(m), t, d: sd * 0.9, v: pos % 4 === 0 ? 0.05 : 0.036, a: 0.002, lp: cut, q: 2.5, env: 'pluck' });
        // driving eighth-note bass
        if (pos % 2 === 0) note(tr.dry, { w: 'sawtooth', f: mf(K_BASS[bar]), t, d: sd * 1.6, v: 0.08, a: 0.003, lp: 420, q: 2, env: 'pluck' });
        // gentle drums; the first bar of every other loop breathes
        const drums = !(loop % 2 === 1 && bar === 0);
        if (drums) {
          if (pos === 0 || pos === 8) thump(tr.dry, t, 0.11, 150, 60, 0.2);
          if (pos === 4 || pos === 12) { noise(tr.dry, { t, d: 0.18, v: 0.04, type: 'bandpass', f: 1800, q: 0.8 }); }
          if (pos % 4 === 2) noise(tr.dry, { t, d: 0.04, v: 0.01, type: 'highpass', f: 8000 });
        }
      },
    },
    {
      id: 'port', trim: 1.5, bpm: 62, spb: 3, len: 48, swing: 0, rev: 0.35, echo: [0.32, 0.18, 0.15],
      onStart(t, tr) { startWaves(tr, t); },
      onStop(t, tr) { stopWaves(tr, t); },
      step(s, t, sd, loop, tr) {
        const bar = Math.floor(s / 6), pos = s % 6;
        // bass: root on 1, fifth on 4 (the 6/8 sway)
        if (pos === 0) note(tr.dry, { w: 'triangle', f: mf(P_ROOT[bar] + 12), t, d: sd * 2.6, v: 0.2, env: 'pluck' });
        if (pos === 3) note(tr.dry, { w: 'triangle', f: mf(P_ROOT[bar] + 7), t, d: sd * 2.2, v: 0.14, env: 'pluck' });
        // squeezebox: soft pulse chord on the off-beats
        if (pos === 2 || pos === 5) for (const m of P_CHORD[bar]) note(tr.dry, { w: G.p50, f: mf(m), t, d: sd * 0.7, v: 0.022, a: 0.02, lp: 1100, r: 0.05 });
        // the tune on triangle, a fife an octave up
        const n = melodyAt(P_MEL, s, 6);
        if (n) note(tr.wet, { w: 'triangle', f: mf(n[1] + 12), t, d: sd * n[2] * 0.86, v: 0.17, a: 0.012, r: 0.1 });
        // the ship's bell: ding-ding at the end of every other verse
        if (bar === 7 && pos === 3 && loop % 2 === 1) { bell(tr.wet, mf(81), t, 0.04, 2.2, CHIME_PARTS); bell(tr.wet, mf(81), t + sd * 0.8, 0.035, 2.4, CHIME_PARTS); }
      },
    },
  ];

  /** River waves: looping noise, lowpassed, swelling with a slow LFO. */
  function startWaves(tr, t) {
    stopWaves(tr, t);
    const s = ac.createBufferSource();
    s.buffer = G.noise; s.loop = true;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 0.4;
    const g = gain(0.0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.04, t + 2.5);
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoAmp = gain(0.03);
    const lfoCut = gain(320);
    lfo.connect(lfoAmp); lfoAmp.connect(g.gain);
    lfo.connect(lfoCut); lfoCut.connect(f.frequency);
    // a second, faster ripple layer on top
    const s2 = ac.createBufferSource();
    s2.buffer = G.noise; s2.loop = true;
    const f2 = ac.createBiquadFilter();
    f2.type = 'bandpass'; f2.frequency.value = 1400; f2.Q.value = 0.6;
    const g2 = gain(0.012);
    const lfo2 = ac.createOscillator();
    lfo2.frequency.value = 0.27;
    const lfo2Amp = gain(0.01);
    lfo2.connect(lfo2Amp); lfo2Amp.connect(g2.gain);
    s.connect(f); f.connect(g); g.connect(tr.dry);
    s2.connect(f2); f2.connect(g2); g2.connect(tr.dry);
    s.start(t, Math.random()); s2.start(t, Math.random()); lfo.start(t); lfo2.start(t);
    tr.state.waves = [s, s2, lfo, lfo2];
  }
  function stopWaves(tr, t) {
    if (!tr.state.waves) return;
    for (const n of tr.state.waves) { try { n.stop(t + 0.05); } catch (e) { /* already stopped */ } }
    tr.state.waves = null;
  }

  /* ------------------------------------------------------------ scheduler */

  function nightness() {
    const L = S.time && typeof S.time.light === 'number' ? S.time.light : 1;
    return 1 - clamp((L - 0.15) / 0.45, 0, 1);
  }

  function schedule() {
    if (!ac || ac.state !== 'running' || !tracks) return;
    const now = ac.currentTime, horizon = now + LOOKAHEAD;
    const tempo = 1 - 0.16 * nightness();
    for (const tr of tracks) {
      if (!tr.running) continue;
      if (tr.stopAt && now > tr.stopAt) {
        tr.running = false; tr.stopAt = 0;
        if (tr.onStop) tr.onStop(now, tr);
        continue;
      }
      if (tr.next < now - 0.15) tr.next = now + 0.03;     // recover after a stall
      let guard = 0;
      while (tr.next < horizon && guard++ < 48) {
        const s = tr.i % tr.len, loop = Math.floor(tr.i / tr.len);
        const sd = 60 / (tr.bpm * tempo) / tr.spb;
        try { tr.step(s, tr.next, sd, loop, tr); } catch (e) { tr.running = false; break; }
        tr.next += tr.swing ? sd * (s % 2 === 0 ? 1 + tr.swing : 1 - tr.swing) : sd;
        tr.i++;
      }
    }
  }

  /* ---------------------------------------------------- biome & crossfade */

  const BIOME_TRACK = {
    square: 'square', meadow: 'square', north: 'square',
    monastery: 'monastery',
    market: 'market',
    mine: 'mine', savings: 'mine',
    port: 'port', riverside: 'port', river: 'port',
  };

  function crossfadeTo(id) {
    if (!ac || !tracks) { current = null; return; }
    const now = ac.currentTime;
    for (const tr of tracks) {
      const on = tr.id === id;
      const p = tr.bus.gain;
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.setTargetAtTime(on ? 1 : 0, now + 0.02, on ? 0.9 : 0.75);
      if (on) {
        tr.stopAt = 0;
        if (!tr.running) {
          tr.running = true; tr.i = 0; tr.next = now + 0.1; tr.state = {};
          if (tr.onStart) tr.onStart(now + 0.1, tr);
        }
      } else if (tr.running && !tr.stopAt) tr.stopAt = now + 4.5;
    }
    current = id;
  }

  function cameraTrack() {
    const cam = S.cam;
    if (!cam || typeof S.biomeAt !== 'function') return 'square';
    const tx = Math.floor(cam.x / S.TILE), ty = Math.floor(cam.y / S.TILE);
    return BIOME_TRACK[S.biomeAt(tx, ty)] || 'square';
  }

  function trackTick() {
    if (!enabled || !ac || ac.state !== 'running') return;
    const id = cameraTrack();
    if (id === wanted) candidate = null;
    else if (id === candidate) { if (++candidateN >= 2) { wanted = id; candidate = null; } }
    else { candidate = id; candidateN = 1; }
    if (wanted !== current) crossfadeTo(wanted);
    // night: quieter
    const target = MASTER * (1 - 0.4 * nightness());
    if (Math.abs(target - masterTarget) > 0.002) {
      masterTarget = target;
      G.master.gain.setTargetAtTime(target, ac.currentTime, 1.5);
    }
  }

  /* ------------------------------------------------------- on, off, arm */

  function canStartNow() {
    const ua = navigator.userActivation;
    return !ua || ua.isActive;
  }

  /** Create/resume the context and start the loops. Must run inside a gesture. */
  function start() {
    if (!AC) return false;
    if (!ac) {
      if (!canStartNow()) return false;
      try { build(); } catch (e) { ac = null; G = null; tracks = null; return false; }
    }
    clearTimeout(stopTimer);
    if (ac.state !== 'running') { try { ac.resume().catch(() => {}); } catch (e) { /* ignored */ } }
    const now = ac.currentTime;
    masterTarget = MASTER * (1 - 0.4 * nightness());
    G.master.gain.cancelScheduledValues(now);
    G.master.gain.setValueAtTime(G.master.gain.value, now);
    G.master.gain.setTargetAtTime(masterTarget, now, 0.5);
    wanted = cameraTrack(); candidate = null;
    current = null;
    crossfadeTo(wanted);
    if (!schedTimer) schedTimer = setInterval(schedule, TICK_MS);
    if (!trackTimer) trackTimer = setInterval(trackTick, 1000);
    schedule();
    // If the browser has not let the context run yet (some only allow it on
    // pointerup/click), keep listening; onstatechange disarms once it runs.
    if (ac.state === 'running') disarm(); else arm();
    return true;
  }

  function stop() {
    if (schedTimer) { clearInterval(schedTimer); schedTimer = 0; }
    if (trackTimer) { clearInterval(trackTimer); trackTimer = 0; }
    if (!ac) return;
    const now = ac.currentTime;
    G.master.gain.cancelScheduledValues(now);
    G.master.gain.setValueAtTime(G.master.gain.value, now);
    G.master.gain.setTargetAtTime(0, now, 0.08);
    masterTarget = -1;
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      if (enabled || !ac) return;
      const t = ac.currentTime;
      for (const tr of tracks) {
        if (tr.running && tr.onStop) tr.onStop(t, tr);
        tr.running = false; tr.stopAt = 0;
        tr.bus.gain.cancelScheduledValues(t); tr.bus.gain.setValueAtTime(0, t);
      }
      current = null;
      ac.suspend().catch(() => {});
    }, 450);
  }

  // A remembered "on" waits for the first gesture anywhere on the page.
  const GESTURES = ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click'];
  let armed = false;
  function onGesture() { if (enabled && (!ac || ac.state !== 'running')) start(); }
  function arm() {
    if (armed) return;
    armed = true;
    for (const ev of GESTURES) window.addEventListener(ev, onGesture, true);
  }
  function disarm() {
    if (!armed) return;
    armed = false;
    for (const ev of GESTURES) window.removeEventListener(ev, onGesture, true);
  }

  function save() {
    try { window.localStorage.setItem(KEY, enabled ? '1' : '0'); } catch (e) { /* storage blocked */ }
  }

  function toggle() {
    enabled = !enabled;
    save();
    if (enabled) {
      if (start()) jingle(true);
      else arm();
    } else {
      disarm();
      jingle(false);
      stop();
    }
    return enabled;
  }

  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    if (document.hidden) { if (ac.state === 'running') ac.suspend().catch(() => {}); }
    else if (enabled) ac.resume().catch(() => {});
  });

  /* ------------------------------------------------------------------ SFX */

  const SFX_GAP = { click: 0.04, coin: 0.07, bell: 0.6, firework: 0.12, chirp: 0.35, cart: 0.8, splash: 0.3 };

  function duckMusic(t, depth, hold) {
    const p = G.music.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.setTargetAtTime(depth * (S.debug.audioNoMusic ? 0 : MUSIC), t, 0.05);
    p.setTargetAtTime(S.debug.audioNoMusic ? 0 : MUSIC, t + hold, 0.9);
  }

  const SFX = {
    click(o, t) {
      note(o, { w: G.p50, f: 1250, slide: 900, slideT: 0.03, t, d: 0.04, v: 0.09, lp: 3200, env: 'pluck' }, false);
    },
    coin(o, t) {
      note(o, { w: G.p25, f: mf(83), t, d: 0.07, v: 0.1, r: 0.01 }, false);
      note(o, { w: G.p25, f: mf(88), t: t + 0.07, d: 0.38, v: 0.1, env: 'pluck' }, false);
    },
    bell(o, t) {
      duckMusic(t, 0.45, 1.6);
      bell(o, mf(67), t, 0.2, 6, BELL_PARTS, false);         // the clock tower's big G
      bell(o, mf(79), t + 0.002, 0.04, 2.2, CHIME_PARTS, false);
      noise(o, { t, d: 0.05, v: 0.035, type: 'bandpass', f: 2500, q: 2 }, false);  // the strike
    },
    firework(o, t) {
      const near = current === 'market' ? 1 : 0.45;
      noise(o, { t, d: 1.1, v: 0.3 * near, type: 'lowpass', f: 1600, fEnd: 120, q: 0.7, a: 0.004 }, false);
      thump(o, t, 0.3 * near, 95, 34, 0.45, false);
      const n = 6 + ((Math.random() * 6) | 0);
      for (let i = 0; i < n; i++) noise(o, { t: t + 0.22 + Math.random() * 0.8, d: 0.025, v: 0.06 * near, type: 'highpass', f: 4500 + Math.random() * 2500 }, false);
    },
    chirp(o, t) {
      const f = rand(2400, 2900);
      note(o, { w: 'sine', f, slide: f * 1.5, slideT: 0.07, t, d: 0.09, v: 0.1, a: 0.004, env: 'pluck' }, false);
      note(o, { w: 'sine', f: f * 1.12, slide: f * 1.7, slideT: 0.06, t: t + 0.13, d: 0.08, v: 0.09, a: 0.004, env: 'pluck' }, false);
      if (Math.random() < 0.5) note(o, { w: 'sine', f: f * 1.3, slide: f * 0.95, slideT: 0.1, t: t + 0.25, d: 0.12, v: 0.07, a: 0.004, env: 'pluck' }, false);
    },
    cart(o, t) {
      const r = noise(o, { t, d: 1.0, v: 0.3, type: 'lowpass', f: 360, q: 0.9, a: 0.08, env: 'hold', r: 0.45 }, false);
      if (r) {                                                   // wheels over rail joints
        const lfo = ac.createOscillator();
        lfo.type = 'square'; lfo.frequency.value = 9;
        const amt = gain(0.1);
        lfo.connect(amt); amt.connect(r.g.gain);
        lfo.start(t); lfo.stop(t + 1.5);
      }
      clink(o, t + 0.12, 0.06, 1500, false);
      clink(o, t + 0.62, 0.05, 1850, false);
    },
    splash(o, t) {
      note(o, { w: 'sine', f: 520, slide: 150, slideT: 0.1, t, d: 0.13, v: 0.12, a: 0.002, env: 'pluck' }, false);
      noise(o, { t: t + 0.01, d: 0.5, v: 0.18, type: 'bandpass', f: 1700, fEnd: 380, q: 0.9, a: 0.01 }, false);
      for (let i = 0; i < 3; i++) note(o, { w: 'sine', f: rand(1700, 2700), slide: rand(2800, 3400), slideT: 0.03, t: t + 0.16 + i * rand(0.07, 0.12), d: 0.05, v: 0.025, a: 0.001, env: 'pluck' }, false);
    },
  };

  function sfx(name) {
    if (!enabled || !ac || ac.state !== 'running' || !SFX[name]) return;
    const t = ac.currentTime + 0.005;
    if (lastSfx[name] && t - lastSfx[name] < (SFX_GAP[name] || 0.05)) return;
    lastSfx[name] = t;
    try { SFX[name](G.sfx, t); } catch (e) { /* never let a sound break the world */ }
  }

  /** Little arpeggio when sound turns on, a falling blip when it turns off. */
  function jingle(on) {
    if (!ac || ac.state === 'closed') return;
    const t = ac.currentTime + 0.01;
    if (on) [72, 76, 79, 84].forEach((m, i) => note(G.sfx, { w: G.p25, f: mf(m), t: t + i * 0.07, d: i === 3 ? 0.3 : 0.08, v: 0.08, lp: 3000, env: i === 3 ? 'pluck' : 'hold', r: 0.02 }, false));
    else [79, 72].forEach((m, i) => note(G.sfx, { w: G.p25, f: mf(m), t: t + i * 0.07, d: 0.07, v: 0.06, lp: 2400, env: 'pluck' }, false));
  }

  function setBiome(id) {
    const tr = BIOME_TRACK[id] || (TRACKS.some((x) => x.id === id) ? id : null);
    if (!tr) return;
    wanted = tr; candidate = null;
    if (enabled && ac && ac.state === 'running' && tr !== current) crossfadeTo(tr);
  }

  /* ------------------------------------------------------------------ API */

  S.audio = {
    get enabled() { return enabled; },
    toggle,
    sfx,
    setBiome,
    /** Current loop id ('square', 'monastery', 'mine', 'market', 'port') or null when silent. */
    get biome() { return enabled && ac && ac.state === 'running' ? current : null; },
    /** Small diagnostic for the dev preview. */
    state() { return { enabled, context: ac ? ac.state : 'none', loop: current, voices, running: tracks ? tracks.filter((t) => t.running).map((t) => t.id) : [] }; },
  };

  if (enabled) arm();
})();
