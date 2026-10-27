/* ============================================================
   ОТКЛИК — прототип ядра
   Дыхание → звук → ведение → отпечаток.
   Всё локально: аудио не пишется и не передаётся.
   ============================================================ */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------------- настройки и хранилище ---------------- */

const DEFAULTS = { bass: 0, timbre: 'neutral', mic: true, soft: false, haptics: false };

const store = {
  get(k, d) {
    try { const v = localStorage.getItem('otklik.' + k); return v ? JSON.parse(v) : d; }
    catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('otklik.' + k, JSON.stringify(v)); } catch {}
  },
};

let settings = Object.assign({}, DEFAULTS, store.get('settings', {}));
let history = store.get('history', []);       // [{ts, dur, mode, minutesToCalm, rate, quality, outcome}]
let fingerprint = store.get('fingerprint', { rf: null });

/* ---------------- звуковой движок ---------------- */

const SCALES = {
  dark:    { notes: [55.0, 82.41, 110.0, 130.81], pad: [110.0, 164.81, 220.0, 261.63] },
  neutral: { notes: [65.41, 98.0, 130.81, 155.56], pad: [130.81, 196.0, 261.63, 311.13] },
  light:   { notes: [87.31, 130.81, 174.61, 220.0], pad: [174.61, 261.63, 349.23, 440.0] },
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.running = false;
    this.env = 0;
  }

  init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const ctx = this.ctx;

    // мастер-цепочка: лимитер защищает слух
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 3;
    comp.attack.value = 0.02; comp.release.value = 0.3;
    this.master.connect(comp).connect(ctx.destination);

    // реверб: генерируем импульс сами — никаких сэмплов
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.6, 2.4);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.28;
    this.dry = ctx.createGain(); this.dry.gain.value = 0.85;
    this.reverb.connect(this.wet).connect(this.master);
    this.dry.connect(this.master);

    // подложка: дрон через ФНЧ
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 420;
    this.droneFilter.Q.value = 0.9;
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0.0;
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.dry); this.droneGain.connect(this.reverb);

    this.oscs = [];
    const scale = SCALES[settings.timbre] || SCALES.neutral;
    scale.notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (i - 1.5) * 4;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.5 : 0.22;
      o.connect(g).connect(this.droneFilter);
      o.start();
      this.oscs.push(o);
    });

    // саб — «телесный» бас
    this.subGain = ctx.createGain(); this.subGain.gain.value = 0;
    this.subGain.connect(this.dry);
    [46, 48.5].forEach((f) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      o.connect(this.subGain); o.start(); this.oscs.push(o);
    });

    // пэд — аккорд
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 1200;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.reverb); this.padGain.connect(this.dry);
    scale.pad.forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      o.detune.value = (i % 2 ? 1 : -1) * 3;
      const g = ctx.createGain(); g.gain.value = 0.12;
      o.connect(g).connect(this.padFilter); o.start(); this.oscs.push(o);
    });

    // воздух — шум через полосовой фильтр
    this.airGain = ctx.createGain(); this.airGain.gain.value = 0;
    this.airFilter = ctx.createBiquadFilter();
    this.airFilter.type = 'bandpass'; this.airFilter.frequency.value = 700; this.airFilter.Q.value = 0.7;
    this.airFilter.connect(this.airGain);
    this.airGain.connect(this.reverb); this.airGain.connect(this.dry);

    const noise = ctx.createBufferSource();
    noise.buffer = this._noise(3);
    noise.loop = true;
    noise.connect(this.airFilter);
    noise.start();
    this.oscs.push(noise);

    // медленный панорамный дрейф
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = 0;
      this.master.disconnect();
      this.master.connect(pan).connect(comp);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.03;
      const lg = ctx.createGain(); lg.gain.value = 0.35;
      lfo.connect(lg).connect(pan.pan); lfo.start(); this.oscs.push(lfo);
    }

    this.space = 0;
  }

  _noise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.6;
    return buf;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  start() {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(0.0001, t);
    this.master.gain.exponentialRampToValueAtTime(0.55, t + 3.5);
    this.running = true;
  }

  /** обновление параметров графа от дыхания */
  update({ env, phase, slope, lead, space }) {
    if (!this.running) return;
    const ctx = this.ctx, t = ctx.currentTime, tau = 0.09;
    const timbreShift = settings.timbre === 'dark' ? -120 : settings.timbre === 'light' ? 220 : 0;
    const bassMul = Math.pow(2, settings.bass / 6);
    const air = clamp(slope * 6, 0, 1);

    const cutoff = clamp(240 + 620 * env + timbreShift, 90, 4200);
    this.droneFilter.frequency.setTargetAtTime(cutoff, t, tau);

    const droneLevel = (space ? 0.10 : 0.20) * (0.45 + 0.55 * env);
    this.droneGain.gain.setTargetAtTime(droneLevel, t, 0.2);

    this.subGain.gain.setTargetAtTime((0.05 + 0.16 * env) * bassMul * (space ? 0.4 : 1), t, 0.12);
    this.airGain.gain.setTargetAtTime(0.015 + 0.085 * air, t, 0.08);
    this.airFilter.frequency.setTargetAtTime(320 + 900 * env, t, 0.1);
    this.padGain.gain.setTargetAtTime((lead ? 0.075 : 0.13) * (0.6 + 0.4 * env), t, 0.3);
    this.wet.gain.setTargetAtTime(0.24 + 0.22 * (1 - env), t, 0.25);
    this.droneFilter.Q.setTargetAtTime(0.9 + 1.6 * (1 - env), t, 0.25);
  }

  stop(fast) {
    if (!this.ctx || !this.running) return Promise.resolve();
    this.running = false;
    const t = this.ctx.currentTime;
    const dur = fast ? 0.4 : 2.4;
    try {
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), t);
      this.master.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } catch {}
    return new Promise((resolve) => {
      setTimeout(() => {
        try { this.oscs.forEach((o) => o.stop && o.stop()); } catch {}
        try { this.ctx.close(); } catch {}
        resolve();
      }, dur * 1000 + 120);
    });
  }
}

/* ---------------- детектор дыхания ---------------- */

class BreathDetector {
  constructor(ctx) {
    this.ctx = ctx;
    this.ready = false;
    this.stream = null;
    this.env = 0;
    this.prevEnv = 0;
    this.floor = 0.02;
    this.peak = 0.05;
    this.phase = 'exhale';
    this.onsets = [];
    this.rate = null;
    this.quality = 0;
    this.lastSignal = 0;
    this.t = 0;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    src.connect(this.analyser);
    this.buf = new Uint8Array(this.analyser.frequencyBinCount);
    this.binHz = this.ctx.sampleRate / this.analyser.fftSize;
    this.lo = Math.max(1, Math.round(150 / this.binHz));
    this.hi = Math.round(2600 / this.binHz);
    this.ready = true;
    return true;
  }

  tick(dt) {
    if (!this.ready) return this.state();
    this.analyser.getByteFrequencyData(this.buf);

    let sum = 0, n = 0;
    for (let i = this.lo; i < this.hi; i++) { sum += this.buf[i]; n++; }
    const raw = (sum / n) / 255;

    // адаптивные шум/пик
    if (raw < this.floor) this.floor = this.floor * 0.92 + raw * 0.08;
    else this.floor += 0.00008;
    if (raw > this.peak) this.peak = raw; else this.peak *= 0.9993;
    const span = Math.max(0.02, this.peak - this.floor);

    const norm = clamp((raw - this.floor) / span, 0, 1);

    // асимметричное сглаживание: вдох «быстрее», выдох «мягче»
    const a = norm > this.env ? 0.30 : 0.09;
    this.prevEnv = this.env;
    this.env += (norm - this.env) * a;

    // фаза с гистерезисом
    const now = performance.now();
    if (this.env > 0.55 && this.phase !== 'inhale') {
      this.phase = 'inhale';
      this.onsets.push(now);
      if (this.onsets.length > 8) this.onsets.shift();
      if (settings.haptics && navigator.vibrate) navigator.vibrate(14);
    } else if (this.env < 0.28 && this.phase !== 'exhale') {
      this.phase = 'exhale';
    }

    // частота по интервалам вдохов
    const iv = [];
    for (let i = 1; i < this.onsets.length; i++) {
      const d = (this.onsets[i] - this.onsets[i - 1]) / 1000;
      if (d > 2 && d < 14) iv.push(d);
    }
    if (iv.length >= 2) {
      iv.sort((x, y) => x - y);
      const med = iv[Math.floor(iv.length / 2)];
      const r = 60 / med;
      this.rate = this.rate == null ? r : this.rate + (r - this.rate) * 0.25;
      this.lastSignal = now;
    }

    const snr = clamp((span - 0.03) / 0.16, 0, 1);
    const validShare = clamp(iv.length / 4, 0, 1);
    this.quality = clamp(snr * 0.6 + validShare * 0.4, 0, 1);

    return this.state();
  }

  get silent() { return this.ready && performance.now() - this.lastSignal > 9000; }

  state() {
    return {
      env: this.env,
      slope: this.env - this.prevEnv,
      phase: this.phase,
      rate: this.rate,
      quality: this.quality,
      live: this.ready && !this.silent,
    };
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.ready = false;
  }
}

/* ---------------- визуализация ---------------- */

class Visualizer {
  constructor(canvas) {
    this.c = canvas;
    this.x = canvas.getContext('2d');
    this.history = [];
    this.dpr = 1;
    this.particles = [];
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.c.width = Math.max(1, r.width * this.dpr);
    this.c.height = Math.max(1, r.height * this.dpr);
    this.w = r.width; this.h = r.height;
    this.x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.particles = Array.from({ length: 64 }, () => ({
      a: Math.random() * Math.PI * 2,
      r: 0.28 + Math.random() * 0.55,
      s: 0.15 + Math.random() * 0.6,
      z: 0.3 + Math.random() * 0.7,
    }));
  }

  destroy() { window.removeEventListener('resize', this.onResize); }

  draw({ env, phase, targetEnv, pacerProgress, lead, t }) {
    const x = this.x, W = this.w, H = this.h;
    const cx = W / 2, cy = H * 0.46;
    const baseR = Math.min(W, H) * 0.17;
    const amp = Math.min(W, H) * 0.085;

    // фон
    const bg = x.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.8);
    bg.addColorStop(0, 'rgba(24,46,52,0.55)');
    bg.addColorStop(0.55, 'rgba(10,14,20,0.9)');
    bg.addColorStop(1, '#0a0e14');
    x.fillStyle = bg;
    x.fillRect(0, 0, W, H);

    // частицы-«светлячки», дышат вместе с нами
    x.save();
    x.globalCompositeOperation = 'lighter';
    const tsec = t / 1000;
    for (const p of this.particles) {
      const angle = p.a + tsec * 0.02 * p.s;
      const rad = Math.min(W, H) * (0.20 + p.r * 0.42 + env * 0.07 * p.z);
      const px = cx + Math.cos(angle) * rad;
      const py = cy + Math.sin(angle) * rad * 0.92;
      const alpha = 0.06 + 0.16 * env * p.z;
      x.fillStyle = `rgba(127,227,212,${alpha})`;
      x.beginPath();
      x.arc(px, py, 1.1 + p.z * 1.2, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();

    // ядро
    const r = baseR + amp * env;
    const glow = x.createRadialGradient(cx, cy, r * 0.05, cx, cy, r * 3.1);
    glow.addColorStop(0, `rgba(127,227,212,${0.10 + 0.16 * env})`);
    glow.addColorStop(0.45, `rgba(43,143,134,${0.07 + 0.09 * env})`);
    glow.addColorStop(1, 'rgba(43,143,134,0)');
    x.fillStyle = glow;
    x.beginPath(); x.arc(cx, cy, r * 3.1, 0, Math.PI * 2); x.fill();

    const core = x.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.1, cx, cy, r);
    core.addColorStop(0, 'rgba(200,255,246,0.92)');
    core.addColorStop(0.32, 'rgba(127,227,212,0.55)');
    core.addColorStop(1, 'rgba(20,70,70,0.20)');
    x.fillStyle = core;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();

    // кольца
    x.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const rr = baseR * (1.45 + i * 0.42) + amp * env * (1 - i * 0.18);
      x.strokeStyle = `rgba(127,227,212,${0.16 - i * 0.04})`;
      x.beginPath();
      const start = tsec * (0.10 + i * 0.05) + i;
      x.arc(cx, cy, rr, start, start + Math.PI * (1.2 + 0.3 * env));
      x.stroke();
    }

    // такт ведения: тонкая дуга прогресса вдоха/выдоха
    if (lead != null) {
      const rr = baseR * 2.55;
      x.lineWidth = 2;
      x.strokeStyle = 'rgba(127,227,212,0.10)';
      x.beginPath(); x.arc(cx, cy, rr, 0, Math.PI * 2); x.stroke();
      x.strokeStyle = 'rgba(127,227,212,0.55)';
      x.beginPath();
      x.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + pacerProgress * Math.PI * 2);
      x.stroke();
      x.lineWidth = 1;
    }

    // «ваше дыхание» — линия внизу
    this.history.push(env);
    if (this.history.length > 260) this.history.shift();
    const hy = H * 0.86, hh = H * 0.075;
    x.strokeStyle = 'rgba(127,227,212,0.35)';
    x.lineWidth = 1.2;
    x.beginPath();
    const step = W / 260;
    this.history.forEach((v, i) => {
      const px = i * step;
      const py = hy - v * hh;
      i === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
    });
    x.stroke();

    if (settings.haptics && phase === 'inhale' && navigator.vibrate) { /* вибро уже вызвано в детекторе */ }

    return r;
  }
}

/* ---------------- сессия ---------------- */

const Session = {
  active: false,
  startAt: 0,
  duration: 180,
  engine: null,
  detector: null,
  viz: null,
  raf: 0,
  lastFrame: 0,
  phase: 'mirror',
  targetRate: 6,
  startRate: 6,
  calmAt: null,
  calmHold: 0,
  rateSamples: [],
  qualitySamples: [],
  outcome: null,
  space: 0,
  pacerT: 0,
};

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function pacerEnv(p, soft) {
  const inFrac = soft ? 0.46 : 0.42;
  if (p < inFrac) return smoothstep(p / inFrac);
  return 1 - smoothstep((p - inFrac) / (1 - inFrac));
}

async function startSession(customDur) {
  if (Session.active) return;
  const dur = customDur || Session.duration || 180;

  showScreen('s-session');
  Session.active = true;
  Session.duration = dur;
  Session.startAt = performance.now();
  Session.lastFrame = Session.startAt;
  Session.phase = 'mirror';
  Session.calmAt = null;
  Session.calmHold = 0;
  Session.rateSamples = [];
  Session.qualitySamples = [];
  Session.outcome = null;
  Session.space = 0;
  Session.pacerT = 0;
  Session.startRate = fingerprint.rf ? fingerprint.rf + 1.2 : 6.5;
  Session.targetRate = Session.startRate;
  Session.guided = false;

  setPhaseLabel('Зеркало', 'Просто дышите. Мы подстроимся.');
  $('#rate-out').textContent = '—';

  // аудио — сразу в жесте пользователя (требование iOS)
  Session.engine = new AudioEngine();
  Session.engine.init();
  Session.engine.start();

  // визуализация
  if (Session.viz) Session.viz.destroy();
  Session.viz = new Visualizer($('#viz'));

  // визуал живёт сразу — даже пока ждём разрешение на микрофон
  Session.detector = new BreathDetector(Session.engine.ctx);
  Session.guided = !settings.mic;
  setMicState(false);
  Session.raf = requestAnimationFrame(loop);

  // микрофон
  if (settings.mic) {
    try {
      await Session.detector.start();
      setMicState(true);
      Session.guided = false;
    } catch (e) {
      setMicState(false);
      Session.guided = true;
      toast('Без микрофона тоже работает: поведём вас по такту');
    }
  }
}

function setMicState(on) {
  $('#mic-state').querySelector('.mic-dot').classList.toggle('off', !on);
  $('#mic-text').textContent = on ? 'микрофон · на устройстве' : 'без микрофона · ведём по такту';
}

function setPhaseLabel(name, hint) {
  $('#phase-name').textContent = name;
  if (hint != null) $('#phase-hint').textContent = hint;
}

function loop(now) {
  if (!Session.active) return;
  const dt = Math.min(0.1, (now - Session.lastFrame) / 1000);
  Session.lastFrame = now;

  const elapsed = (now - Session.startAt) / 1000;
  const total = Session.duration;
  const progress = clamp(elapsed / total, 0, 1);

  // --- фазы ---
  const mirrorEnd = clamp(total * 0.22, 12, 30);
  const leadEnd = total * 0.8;
  let phase;
  if (elapsed < mirrorEnd) phase = 'mirror';
  else if (elapsed < leadEnd) phase = 'lead';
  else phase = 'space';

  if (phase !== Session.phase) {
    if (phase === 'lead') setPhaseLabel('Ведение', 'Не старайтесь. Просто не мешайте.');
    if (phase === 'space') setPhaseLabel('Пространство', 'Дальше — тишина. Она ваша.');
    Session.phase = phase;
  }

  // --- детекция ---
  const st = Session.detector ? Session.detector.tick(dt) : { env: 0, phase: 'exhale', rate: null, quality: 0, live: false };
  const guided = Session.guided || !st.live;

  // --- ведение: цель замедляется ступенями ---
  if (phase !== 'mirror') {
    const leadElapsed = elapsed - mirrorEnd;
    const target = fingerprint.rf || 5.5;
    const steps = Math.min(8, Math.floor(leadElapsed / 30));
    const wanted = Math.max(target, Session.startRate - steps * 0.4);
    Session.targetRate = Session.targetRate + (wanted - Session.targetRate) * Math.min(1, dt * 0.6);
  } else {
    Session.targetRate = Session.startRate;
  }
  const period = 60 / Session.targetRate;
  Session.pacerT += dt;
  const pacerP = (Session.pacerT % period) / period;
  const pEnv = pacerEnv(pacerP, settings.soft);

  // --- итоговая огибающая для звука ---
  const userEnv = st.env;
  const lead = phase === 'lead';
  const audioEnv = guided
    ? pEnv
    : phase === 'mirror'
      ? userEnv
      : clamp(0.62 * pEnv + 0.38 * userEnv, 0, 1);

  // --- тишина в финале ---
  Session.space = phase === 'space' ? smoothstep((elapsed - leadEnd) / Math.max(1, total - leadEnd)) : 0;

  Session.engine.update({
    env: audioEnv,
    phase: st.phase,
    slope: guided ? Math.abs(pEnv - (Session._lastP || pEnv)) * 12 : st.slope,
    lead: lead || phase === 'space',
    space: Session.space,
  });
  Session._lastP = pEnv;

  // --- визуал ---
  Session.viz.draw({
    env: guided ? pEnv : clamp(0.7 * userEnv + 0.3 * pEnv, 0, 1),
    phase: st.phase,
    targetEnv: pEnv,
    pacerProgress: pacerP,
    lead: lead ? true : null,
    t: now,
  });

  // --- показания ---
  const shownRate = st.rate && !guided ? st.rate : Session.targetRate;
  $('#rate-out').textContent = shownRate ? shownRate.toFixed(1).replace('.', ',') : '—';
  if (st.rate) Session.rateSamples.push(st.rate);
  if (st.quality) Session.qualitySamples.push(st.quality);
  $('#timer').textContent = fmtTime(total - elapsed);

  // --- «минуты до покоя» ---
  if (phase === 'lead' && st.rate) {
    const inCorridor = Math.abs(st.rate - Session.targetRate) <= 1.5;
    Session.calmHold = inCorridor ? Session.calmHold + dt : 0;
    if (Session.calmHold >= 30 && Session.calmAt == null) {
      Session.calmAt = elapsed - 30;
    }
  }

  if (elapsed >= total) { finishSession('complete'); return; }
  Session.raf = requestAnimationFrame(loop);
}

async function finishSession(status, early) {
  if (!Session.active) return;
  Session.active = false;
  cancelAnimationFrame(Session.raf);

  const elapsed = early ? (performance.now() - Session.startAt) / 1000 : Session.duration;

  if (Session.detector) Session.detector.stop();

  // финальное затухание: в «пространстве» оно уже почти нулевое
  await Session.engine.stop(status !== 'complete');

  const rates = Session.rateSamples.filter((r) => r > 2 && r < 30);
  const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  const quality = Session.qualitySamples.length
    ? Session.qualitySamples.reduce((a, b) => a + b, 0) / Session.qualitySamples.length
    : 0;

  const record = {
    ts: Date.now(),
    dur: Math.round(elapsed),
    mode: Session.guided ? 'guided' : 'mirror+lead',
    minutesToCalm: Session.calmAt != null ? Math.round(Session.calmAt / 6) / 10 : null,
    rate: avgRate ? Math.round(avgRate * 10) / 10 : null,
    quality: Math.round(quality * 100),
    soft: settings.soft,
    timbre: settings.timbre,
    timeOfDay: new Date().getHours(),
    outcome: null,
  };

  if (elapsed < 10) {
    toast('Сессия не началась — ничего страшного');
    showScreen('s-intro');
    return;
  }

  history.push(record);
  store.set('history', history);

  // «отпечаток»: после 2+ сессий появляется персональная частота
  if (!fingerprint.rf && rates.length >= 3) {
    const comfortable = avgRate ? clamp(Math.round((avgRate - 0.6) * 2) / 2, 4.5, 7) : 5.5;
    fingerprint.rf = comfortable;
    store.set('fingerprint', fingerprint);
  }

  renderResult(record);
  showScreen('s-result');
}

function renderResult(rec) {
  const val = rec.minutesToCalm;
  $('#res-minutes').textContent = val != null ? val.toFixed(1).replace('.', ',') : '—';

  const prev = history.length > 1
    ? history.slice(0, -1).reverse().find((r) => r.minutesToCalm != null)
    : null;

  const delta = $('#res-delta');
  delta.classList.remove('flat');
  if (val == null) {
    delta.textContent = 'пока не измерено — нужно поймать ваш ритм';
    delta.classList.add('flat');
  } else if (prev) {
    const d = val - prev.minutesToCalm;
    if (Math.abs(d) < 0.15) { delta.textContent = 'как в прошлый раз'; delta.classList.add('flat'); }
    else if (d < 0) delta.textContent = `на ${Math.abs(d).toFixed(1).replace('.', ',')} мин быстрее прошлого раза`;
    else { delta.textContent = `на ${d.toFixed(1).replace('.', ',')} мин дольше прошлого раза`; delta.classList.add('flat'); }
  } else {
    delta.textContent = 'первая точка на графике';
    delta.classList.add('flat');
  }

  $('#res-facts').innerHTML = `
    <div class="fact"><div class="fact-k">длительность</div><div class="fact-v">${fmtTime(rec.dur)}</div></div>
    <div class="fact"><div class="fact-k">ваш ритм</div><div class="fact-v">${rec.rate ? rec.rate.toFixed(1).replace('.', ',') + ' / мин' : '—'}</div></div>
    <div class="fact"><div class="fact-k">режим</div><div class="fact-v">${rec.mode === 'guided' ? 'по такту' : 'зеркало + ведение'}</div></div>
    <div class="fact"><div class="fact-k">quality</div><div class="fact-v">${rec.quality}%</div></div>
  `;

  $$('.outcome-btn').forEach((b) => b.classList.remove('sel'));
}

function saveOutcome(val) {
  const last = history[history.length - 1];
  if (last && last.outcome == null) {
    last.outcome = val;
    store.set('history', history);
  }
  if (val === 'worse') {
    toast('Спасибо. Попробуем мягче — без задержек и с коротким вдохом');
    settings.soft = true;
    store.set('settings', settings);
    $('#set-soft').checked = true;
  } else if (val === 'better') {
    toast('Записали. Завтра станет точнее');
  } else {
    toast('Записали');
  }
}

/* ---------------- отпечаток ---------------- */

function renderFingerprint() {
  const n = history.length;
  const need = 3;
  const f = $('#formula');

  if (n === 0) {
    f.innerHTML = '<span class="dim">Ещё нет данных. Одна сессия — и появится первая точка.</span>';
  } else if (n < need) {
    f.innerHTML = `нужно ещё <b>${need - n}</b> ${plural(need - n, 'сессия', 'сессии', 'сессий')} — и мы соберём вашу формулу`;
  } else {
    const rf = fingerprint.rf ? fingerprint.rf.toFixed(1).replace('.', ',') : '5,5';
    const mode = modeOfHour();
    const timbre = settings.timbre === 'dark' ? 'тёмный тембр' : settings.timbre === 'light' ? 'светлый тембр' : 'нейтральный тембр';
    f.innerHTML = `<b>${rf}</b> вдоха/мин · ${timbre} · <b>${Math.round(median(history.map(h => h.dur)) / 60)}</b> мин · ${mode}`;
  }

  const vals = history.filter((h) => h.minutesToCalm != null).map((h) => h.minutesToCalm);
  $('#print-median').textContent = vals.length
    ? `медиана ${median(vals).toFixed(1).replace('.', ',')} мин`
    : 'пока нет измерений';

  drawChart(vals);

  const factors = $('#factors');
  if (n < 3) {
    factors.innerHTML = '<li class="muted">Появится после нескольких сессий.</li>';
  } else {
    const better = history.filter((h) => h.outcome === 'better').length;
    const worse = history.filter((h) => h.outcome === 'worse').length;
    const avgQ = Math.round(median(history.map((h) => h.quality)));
    const rfLine = fingerprint.rf
      ? `<li><span>ваша частота</span><span class="bar">${fingerprint.rf.toFixed(1).replace('.', ',')} / мин</span></li>`
      : '';
    factors.innerHTML = `
      ${rfLine}
      <li><span>сессий «спокойнее»</span><span class="bar">${better} из ${n}</span></li>
      <li><span>качество сигнала</span><span class="bar">${avgQ}%</span></li>
      ${worse ? `<li><span>«хуже»</span><span class="bar">${worse}</span></li>` : ''}
      <li><span>оптимальная длительность</span><span class="bar">${Math.round(median(history.map(h => h.dur)) / 30) * 0.5} мин</span></li>
    `;
  }

  $('#sessions-count').textContent = `сессий: ${n}`;
}

function modeOfHour() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'утро';
  if (h >= 12 && h < 18) return 'день';
  if (h >= 18 && h < 23) return 'вечер';
  return 'ночь';
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function drawChart(vals) {
  const c = $('#chart');
  const rect = c.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = rect.width * dpr; c.height = rect.height * dpr;
  const x = c.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = rect.width, H = rect.height;
  x.clearRect(0, 0, W, H);

  x.strokeStyle = 'rgba(255,255,255,0.06)';
  x.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (H / 4) * i;
    x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke();
  }

  if (vals.length < 2) {
    x.fillStyle = 'rgba(140,154,169,0.55)';
    x.font = '12px -apple-system, sans-serif';
    x.fillText('график появится после второй сессии', 4, H / 2 + 4);
    return;
  }

  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = Math.max(0.4, (max - min) * 0.25);
  const lo = min - pad, hi = max + pad;
  const px = (i) => 6 + (i / (vals.length - 1)) * (W - 12);
  const py = (v) => H - 10 - ((v - lo) / (hi - lo)) * (H - 24);

  const grad = x.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(127,227,212,0.22)');
  grad.addColorStop(1, 'rgba(127,227,212,0)');
  x.beginPath();
  x.moveTo(px(0), H);
  vals.forEach((v, i) => x.lineTo(px(i), py(v)));
  x.lineTo(px(vals.length - 1), H);
  x.closePath();
  x.fillStyle = grad; x.fill();

  x.beginPath();
  vals.forEach((v, i) => (i === 0 ? x.moveTo(px(i), py(v)) : x.lineTo(px(i), py(v))));
  x.strokeStyle = 'rgba(127,227,212,0.9)';
  x.lineWidth = 1.6;
  x.stroke();

  vals.forEach((v, i) => {
    x.beginPath(); x.arc(px(i), py(v), 2.6, 0, Math.PI * 2);
    x.fillStyle = '#7fe3d4'; x.fill();
  });
}

/* ---------------- навигация и UI ---------------- */

let currentScreen = 's-intro';

function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  currentScreen = id;
  if (id === 's-print') setTimeout(renderFingerprint, 60);
  if (id === 's-intro') setTimeout(renderFingerprint, 60);
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}

function openSheet(id) {
  const el = $(id);
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
}
function closeSheet(el) {
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
}

/* ---------------- события ---------------- */

let chosenDuration = 180;

$$('#duration-row .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    $$('#duration-row .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    chosenDuration = Number(chip.dataset.dur);
  });
});

$('#btn-start').addEventListener('click', () => startSession(chosenDuration));
$('#btn-stop').addEventListener('click', () => finishSession('partial', true));

$('#btn-home').addEventListener('click', () => { showScreen('s-intro'); renderFingerprint(); });

$$('.outcome-btn').forEach((b) => {
  b.addEventListener('click', () => {
    $$('.outcome-btn').forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
    saveOutcome(b.dataset.out);
  });
});

$('#btn-fingerprint-link').addEventListener('click', () => showScreen('s-print'));
$('#btn-print-back').addEventListener('click', () => showScreen('s-intro'));
$('#btn-print-breathe').addEventListener('click', () => startSession(chosenDuration));

$('#btn-reset').addEventListener('click', () => {
  history = [];
  fingerprint = { rf: null };
  store.set('history', history);
  store.set('fingerprint', fingerprint);
  renderFingerprint();
  toast('Модель сброшена. Ничего не осталось');
});

$('#btn-settings').addEventListener('click', () => openSheet('#settings-sheet'));
$('#btn-close-settings').addEventListener('click', () => closeSheet($('#settings-sheet')));
$('#btn-help').addEventListener('click', () => openSheet('#help-sheet'));
$('#btn-close-help').addEventListener('click', () => closeSheet($('#help-sheet')));

$$('.sheet').forEach((s) => {
  s.addEventListener('click', (e) => { if (e.target === s) closeSheet(s); });
});

$('#set-bass').addEventListener('input', (e) => {
  settings.bass = Number(e.target.value);
  store.set('settings', settings);
});
$('#set-timbre').addEventListener('change', (e) => {
  settings.timbre = e.target.value;
  store.set('settings', settings);
  toast('Тембр применится в следующей сессии');
});
$('#set-mic').addEventListener('change', (e) => {
  settings.mic = e.target.checked;
  store.set('settings', settings);
});
$('#set-soft').addEventListener('change', (e) => {
  settings.soft = e.target.checked;
  store.set('settings', settings);
});
$('#set-haptics').addEventListener('change', (e) => {
  settings.haptics = e.target.checked;
  store.set('settings', settings);
});

/* начальная синхронизация тумблеров */
$('#set-bass').value = settings.bass;
$('#set-timbre').value = settings.timbre;
$('#set-mic').checked = settings.mic;
$('#set-soft').checked = settings.soft;
$('#set-haptics').checked = settings.haptics;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet($('#settings-sheet')), closeSheet($('#help-sheet'));
});

renderFingerprint();
