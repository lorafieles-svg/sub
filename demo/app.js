/* ============================================================
   ОТКЛИК — прототип ядра
   Дыхание → звук → ведение → отпечаток → среда.
   Всё локально: аудио не пишется и не передаётся.
   ============================================================ */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const frac = (x) => x - Math.floor(x);
const TAU = Math.PI * 2;

/* ---------------- настройки и хранилище ---------------- */

const DEFAULT_MIX = { sea: 0.55, wind: 0.18 };

const DEFAULTS = {
  bass: 0,
  timbre: 'neutral',
  mic: true,
  soft: false,
  haptics: false,
  volume: 0.6,
  muted: false,
  speaker: false,
  quietStart: false,
  response: 1.0,      // «отклик»: насколько сильно дыхание управляет звуком
  room: 'medium',     // размер пространства (реверб)
  mix: DEFAULT_MIX,
  mixes: [
    { name: 'Берег', mix: { sea: 0.7, wind: 0.22 } },
    { name: 'Лес утром', mix: { birds: 0.5, stream: 0.35, wind: 0.25 } },
    { name: 'Ночь у огня', mix: { crickets: 0.45, fire: 0.35, wind: 0.15 } },
    { name: 'Дождь', mix: { rain: 0.65, thunder: 0.25 } },
  ],
};

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
let history = store.get('history', []);
let fingerprint = store.get('fingerprint', { rf: null });
let customSounds = [];   // [{id, name, buffer}] — свои файлы

const saveSettings = () => store.set('settings', settings);

/* ============================================================
   ГЕНЕРАТОРЫ СРЕД
   Ни одного аудиофайла: каждая среда синтезируется в буфер
   при первом включении. Семантика — не «трек», а текстура.
   ============================================================ */

function writeBurst(L, R, sr, pos, dur, amp, pan, decay) {
  const len = Math.floor(dur * sr);
  for (let j = 0; j < len; j++) {
    const i = pos + j;
    if (i < 0 || i >= L.length) continue;
    const e = Math.exp(-(j / len) * (decay || 4));
    const v = (Math.random() * 2 - 1) * e * amp;
    L[i] += v * (1 - pan * 0.6);
    R[i] += v * (0.3 + pan * 0.7);
  }
}

function writeChirp(L, R, sr, pos, dur, f0, slope, amp, pan) {
  const len = Math.floor(dur * sr);
  let ph = 0;
  for (let j = 0; j < len; j++) {
    const u = j / len;
    const f = f0 * (1 + (slope - 1) * u) * (1 + 0.03 * Math.sin(u * 40));
    ph += (TAU * f) / sr;
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 1.2) * Math.exp(-u * 1.5);
    const v = Math.sin(ph) * env * amp;
    const i = pos + j;
    if (i < 0 || i >= L.length) continue;
    L[i] += v * (1 - pan * 0.6);
    R[i] += v * (0.25 + pan * 0.75);
  }
}

function writeTone(L, R, sr, pos, dur, fStart, fEnd, amp, pan) {
  const len = Math.floor(dur * sr);
  let ph = 0;
  for (let j = 0; j < len; j++) {
    const u = j / len;
    const f = fStart + (fEnd - fStart) * u;
    ph += (TAU * f) / sr;
    const env = Math.sin(Math.PI * u) ** 1.5;
    const i = pos + j;
    if (i < 0 || i >= L.length) continue;
    const v = Math.sin(ph) * env * amp;
    L[i] += v * (1 - pan * 0.6);
    R[i] += v * (0.25 + pan * 0.75);
  }
}

const GENERATORS = {
  /* море: бурый шум + медленные волны + пена на гребне */
  sea(L, R, sr) {
    const n = L.length;
    let bl = 0, br = 0;
    const p1 = Math.random() * TAU, p2 = Math.random() * TAU, p3 = Math.random() * TAU;
    const T1 = 9 + Math.random() * 3, T2 = 13 + Math.random() * 4, T3 = 6 + Math.random() * 2;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let env = 0.45 + 0.3 * Math.sin((TAU * t) / T1 + p1) + 0.16 * Math.sin((TAU * t) / T2 + p2) + 0.09 * Math.sin((TAU * t) / T3 + p3);
      env = clamp(env, 0.05, 1);
      bl += (Math.random() * 2 - 1 - bl) * 0.012;
      br += (Math.random() * 2 - 1 - br) * 0.012;
      const foam = Math.pow(env, 5) * 0.09;
      L[i] = bl * 3.2 * env + (Math.random() * 2 - 1) * foam;
      R[i] = br * 3.2 * env + (Math.random() * 2 - 1) * foam;
    }
  },

  /* дождь: высокочастотный шум + капли */
  rain(L, R, sr) {
    const n = L.length;
    let hl = 0, hr = 0, pl = 0, pr = 0;
    for (let i = 0; i < n; i++) {
      const wl = Math.random() * 2 - 1, wr = Math.random() * 2 - 1;
      hl = 0.92 * (hl + wl - pl); pl = wl;
      hr = 0.92 * (hr + wr - pr); pr = wr;
      L[i] = hl * 0.45;
      R[i] = hr * 0.45;
    }
    const drops = Math.floor((n / sr) * 42);
    for (let k = 0; k < drops; k++) {
      const pos = Math.floor(Math.random() * n);
      writeBurst(L, R, sr, pos, 0.004 + Math.random() * 0.018, 0.2 + Math.random() * 0.5, Math.random(), 3);
    }
  },

  /* ручей: полосовой шум + пузырьки */
  stream(L, R, sr) {
    const n = L.length;
    let hl = 0, pl = 0, lp = 0, lp2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      hl = 0.965 * (hl + w - pl); pl = w;
      lp += (hl - lp) * 0.35;
      lp2 += (lp - lp2) * 0.08;
      const t = i / sr;
      const mod = 0.75 + 0.25 * Math.sin((TAU * t) / 7.3);
      L[i] = lp2 * 1.5 * mod;
      R[i] = lp2 * 1.5 * mod * 0.92;
    }
    for (let k = 0; k < 70; k++) {
      const pos = Math.floor(Math.random() * n);
      writeTone(L, R, sr, pos, 0.04 + Math.random() * 0.1, 260 + Math.random() * 320, 620 + Math.random() * 700, 0.05 + Math.random() * 0.06, Math.random());
    }
  },

  /* лес: ветер в кронах + птицы */
  birds(L, R, sr) {
    const n = L.length;
    let lp = 0, lp2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * 0.01;
      lp2 += (w - lp2) * 0.11;
      const t = i / sr;
      const amb = (lp * 0.4 + lp2 * 0.05) * (0.55 + 0.45 * Math.sin((TAU * t) / 13 + 1));
      L[i] = amb;
      R[i] = amb * 0.9;
    }
    const groups = Math.floor((n / sr) * 2.4) + 6;
    for (let g = 0; g < groups; g++) {
      const start = Math.random() * n;
      const pan = 0.15 + Math.random() * 0.7;
      const near = Math.random() > 0.35;
      const notes = 1 + Math.floor(Math.random() * 4);
      let off = 0;
      for (let k = 0; k < notes; k++) {
        const dur = 0.04 + Math.random() * 0.07;
        const f0 = near ? 1900 + Math.random() * 2100 : 3000 + Math.random() * 1800;
        const amp = (near ? 0.10 : 0.045) * (0.7 + Math.random() * 0.6);
        writeChirp(L, R, sr, Math.floor(start + off * sr), dur, f0, 0.6 + Math.random() * 0.8, amp, pan);
        off += dur + 0.02 + Math.random() * 0.05;
      }
    }
  },

  /* сверчки */
  crickets(L, R, sr) {
    const n = L.length;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += (Math.random() * 2 - 1 - lp) * 0.004;
      L[i] = lp * 0.1;
      R[i] = lp * 0.1;
    }
    for (let b = 0; b < 5; b++) {
      const rate = 2.2 + Math.random() * 2.4;
      const f = 3800 + Math.random() * 1500;
      const pan = Math.random();
      const amp = 0.05 + Math.random() * 0.09;
      const tStart = Math.random() * 0.4;
      const total = Math.floor((n / sr) * rate) + 1;
      for (let c = 0; c < total; c++) {
        const t0 = tStart + c / rate;
        for (let p = 0; p < 3; p++) {
          const pos = Math.floor((t0 + p * 0.021) * sr);
          const len = Math.floor(0.009 * sr);
          for (let j = 0; j < len; j++) {
            const i = pos + j;
            if (i < 0 || i >= n) continue;
            const env = Math.sin((Math.PI * j) / len);
            const v = Math.sin((TAU * f * j) / sr) * env * amp;
            L[i] += v * (1 - pan * 0.8);
            R[i] += v * (0.2 + pan * 0.8);
          }
        }
      }
    }
  },

  /* костёр: низкий гул + треск */
  fire(L, R, sr) {
    const n = L.length;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += (Math.random() * 2 - 1 - lp) * 0.006;
      const t = i / sr;
      const breath = 0.7 + 0.3 * Math.sin((TAU * t) / 5.7);
      L[i] = lp * 0.5 * breath;
      R[i] = lp * 0.5 * breath;
    }
    for (let k = 0; k < 260; k++) {
      const pos = Math.floor(Math.random() * n);
      const big = Math.random() > 0.93;
      writeBurst(L, R, sr, pos, big ? 0.03 + Math.random() * 0.05 : 0.002 + Math.random() * 0.008, big ? 0.5 : 0.15 + Math.random() * 0.35, Math.random(), big ? 6 : 12);
    }
  },

  /* ветер */
  wind(L, R, sr) {
    const n = L.length;
    let lp = 0, lp2 = 0;
    const p1 = Math.random() * TAU, p2 = Math.random() * TAU;
    const T1 = 8 + Math.random() * 5, T2 = 15 + Math.random() * 6;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const gust = clamp(0.5 + 0.4 * Math.sin((TAU * t) / T1 + p1) + 0.25 * Math.sin((TAU * t) / T2 + p2), 0.05, 1);
      const a = 0.004 + 0.022 * gust;
      lp += (Math.random() * 2 - 1 - lp) * a;
      lp2 += (lp - lp2) * 0.45;
      L[i] = lp2 * 3.4 * (0.35 + 0.65 * gust);
      R[i] = lp2 * 3.4 * (0.35 + 0.65 * gust) * 0.88;
    }
  },

  /* гроза: дождь + далёкий гром */
  thunder(L, R, sr) {
    const n = L.length;
    let hl = 0, hr = 0, pl = 0, pr = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      const wl = Math.random() * 2 - 1, wr = Math.random() * 2 - 1;
      hl = 0.9 * (hl + wl - pl); pl = wl;
      hr = 0.9 * (hr + wr - pr); pr = wr;
      lp += (wl - lp) * 0.0018;
      L[i] = hl * 0.18 + lp * 0.4;
      R[i] = hr * 0.18 + lp * 0.4;
    }
    for (let k = 0; k < 2; k++) {
      const pos = Math.floor((0.15 + k * 0.45 + Math.random() * 0.1) * n);
      const len = Math.floor((1.6 + Math.random() * 1.8) * sr);
      let prev = 0;
      for (let j = 0; j < len; j++) {
        const i = pos + j;
        if (i >= n) break;
        const u = j / len;
        const env = Math.pow(1 - u, 2.2) * Math.min(1, u * 24) * 1.6;
        prev += (Math.random() * 2 - 1 - prev) * 0.0035;
        const v = prev * env * 6;
        L[i] += v;
        R[i] += v * 0.85;
      }
    }
  },

  /* поезд */
  train(L, R, sr) {
    const n = L.length;
    let lp = 0, lp2 = 0, pl = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * 0.0015;
      lp2 = 0.985 * (lp2 + w - pl); pl = w;
      L[i] = lp * 2.2 + lp2 * 0.05;
      R[i] = lp * 2.2 + lp2 * 0.06;
    }
    const period = 1.42;
    for (let c = 0; c * period < n / sr; c++) {
      const base = Math.floor((c * period + 0.1) * sr);
      for (let p = 0; p < 4; p++) {
        const pos = base + Math.floor(p * 0.075 * sr);
        const len = Math.floor(0.045 * sr);
        let prev = 0;
        for (let j = 0; j < len; j++) {
          const i = pos + j;
          if (i < 0 || i >= n) continue;
          prev += (Math.random() * 2 - 1 - prev) * 0.06;
          const env = Math.exp(-(j / len) * 7);
          const v = prev * env * 1.6;
          L[i] += v;
          R[i] += v * 0.9;
        }
      }
    }
  },

  /* кафе: приглушённый говор + посуда */
  cafe(L, R, sr) {
    const n = L.length;
    for (let v = 0; v < 4; v++) {
      const pos0 = Math.floor(Math.random() * n);
      const len = Math.floor((2 + Math.random() * 3) * sr);
      const pan = Math.random();
      const fBase = 180 + Math.random() * 220;
      let ph = 0, lp = 0, lp2 = 0;
      for (let j = 0; j < len; j++) {
        const i = (pos0 + j) % n;
        const u = j / len;
        const env = Math.sin(Math.PI * u) * 0.5 + 0.1;
        ph += (TAU * (fBase + 30 * Math.sin(u * 27))) / sr;
        const src = Math.sin(ph) * 0.5 + (Math.random() * 2 - 1) * 0.5;
        lp += (src - lp) * 0.18;
        lp2 += (lp - lp2) * 0.35;
        const val = lp2 * env * 0.16;
        L[i] += val * (1 - pan * 0.5);
        R[i] += val * (0.5 + pan * 0.5);
      }
    }
    for (let k = 0; k < 22; k++) {
      const pos = Math.floor(Math.random() * n);
      writeTone(L, R, sr, pos, 0.08 + Math.random() * 0.16, 2400 + Math.random() * 1600, 2200 + Math.random() * 1400, 0.03 + Math.random() * 0.05, Math.random());
    }
    for (let k = 0; k < 5; k++) {
      const pos = Math.floor(Math.random() * n);
      writeBurst(L, R, sr, pos, 0.12 + Math.random() * 0.2, 0.05, Math.random(), 2.5);
    }
  },
};

/* ---- каталог сред ---- */

// target — целевая RMS буфера: балансируем «плотные» и «редкие» текстуры,
// иначе птицы с редкими событиями звучат громче дождя
const LAYERS = {
  sea:      { name: 'Море',    group: 'Вода',   icon: 'waves',   gen: GENERATORS.sea,      target: 0.19 },
  stream:   { name: 'Ручей',   group: 'Вода',   icon: 'stream',  gen: GENERATORS.stream,   target: 0.18 },
  rain:     { name: 'Дождь',   group: 'Вода',   icon: 'rain',    gen: GENERATORS.rain,     target: 0.16 },
  birds:    { name: 'Птицы',   group: 'Лес',    icon: 'bird',    gen: GENERATORS.birds,    target: 0.10 },
  wind:     { name: 'Ветер',   group: 'Лес',    icon: 'wind',    gen: GENERATORS.wind,     target: 0.16 },
  crickets: { name: 'Сверчки', group: 'Ночь',   icon: 'moon',    gen: GENERATORS.crickets, target: 0.095 },
  fire:     { name: 'Костёр',  group: 'Огонь',  icon: 'fire',    gen: GENERATORS.fire,     target: 0.12 },
  thunder:  { name: 'Гроза',   group: 'Погода', icon: 'thunder', gen: GENERATORS.thunder,  target: 0.165 },
  train:    { name: 'Поезд',   group: 'Город',  icon: 'train',   gen: GENERATORS.train,    target: 0.16 },
  cafe:     { name: 'Кафе',    group: 'Город',  icon: 'cafe',    gen: GENERATORS.cafe,     target: 0.10 },
};

const GROUPS = ['Вода', 'Лес', 'Ночь', 'Огонь', 'Погода', 'Город', 'Мои звуки'];

const ICONS = {
  waves: '<path d="M2 15c2.2-2.2 4.4-2.2 6.6 0s4.4 2.2 6.6 0 4.4-2.2 6.6 0"/><path d="M2 10c2.2-2.2 4.4-2.2 6.6 0s4.4 2.2 6.6 0 4.4-2.2 6.6 0"/>',
  stream: '<path d="M8 3c-2 3 2 4 0 7s2 4 0 7"/><path d="M15 3c-2 3 2 4 0 7s2 4 0 7"/>',
  rain: '<path d="M6.5 11a4 4 0 0 1 7.7-1.3A3 3 0 0 1 18 15.4H7.2A3 3 0 0 1 6.5 11z"/><path d="M8 17.5l-1 3M12 17.5l-1 3M16 17.5l-1 3"/>',
  bird: '<path d="M3 13c2.4-3.6 5.4-3.6 7.2 0C12 9.4 15 9.4 17.4 13"/><path d="M17 7.5c1.6 0 2.6 1 2.6 2.2"/>',
  wind: '<path d="M3 8h9a2.4 2.4 0 1 0-2.4-2.4"/><path d="M3 13h13a2.4 2.4 0 1 1-2.4 2.4"/><path d="M3 18h6"/>',
  moon: '<path d="M16 3.5a8.5 8.5 0 1 0 4.2 13.2A7 7 0 0 1 16 3.5z"/>',
  fire: '<path d="M12 3s4.6 3.7 4.6 7.6a4.6 4.6 0 0 1-9.2 0c0-1.8.8-2.8 1.8-3.9 0 1.9.8 2.8 1.8 2.8 0-2.6.6-4.4 1-6.5z"/>',
  thunder: '<path d="M6.5 10a4 4 0 0 1 7.7-1.3A3 3 0 0 1 18 14.4H7.2A3 3 0 0 1 6.5 10z"/><path d="M13 13l-2.6 4.6h3.2L11.4 22l4.2-5.6h-3.2z"/>',
  train: '<rect x="5" y="4" width="14" height="12" rx="3"/><path d="M5 10h14M9 16v3M15 16v3M7 21h10"/>',
  cafe: '<path d="M4 8h11v5.5A4.5 4.5 0 0 1 10.5 18h-2A4.5 4.5 0 0 1 4 13.5z"/><path d="M15 9.5h1.8a2.4 2.4 0 1 1 0 4.8H15"/><path d="M7 4.5c-.8 1 .8 1.6 0 2.6M11 4.5c-.8 1 .8 1.6 0 2.6"/>',
  wave2: '<path d="M4 12h2M9 8v8M14 5v14M19 10v4"/>',
  more: '<path d="M12 5v14M5 12h14"/>',
};

/* ============================================================
   СВОИ ЗВУКИ (IndexedDB, локально)
   ============================================================ */

function idbOpen() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('no idb'));
    const r = indexedDB.open('otklik', 1);
    r.onupgradeneeded = () => { try { r.result.createObjectStore('sounds', { keyPath: 'id' }); } catch {} };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function idbAll() {
  try {
    const db = await idbOpen();
    return await new Promise((res, rej) => {
      const tx = db.transaction('sounds', 'readonly');
      const req = tx.objectStore('sounds').getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
  } catch { return []; }
}

async function idbPut(obj) {
  try {
    const db = await idbOpen();
    return await new Promise((res) => {
      const tx = db.transaction('sounds', 'readwrite');
      tx.objectStore('sounds').put(obj);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    });
  } catch { return false; }
}

async function idbDel(id) {
  try {
    const db = await idbOpen();
    return await new Promise((res) => {
      const tx = db.transaction('sounds', 'readwrite');
      tx.objectStore('sounds').delete(id);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    });
  } catch { return false; }
}

function decodeAudio(arrayBuffer, sr) {
  const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, sr || 48000);
  return new Promise((res, rej) => {
    const p = ctx.decodeAudioData(arrayBuffer, res, rej);
    if (p && p.then) p.then(res).catch(rej);
  });
}

async function loadCustomSounds() {
  const rows = await idbAll();
  for (const row of rows) {
    try {
      const buf = await decodeAudio(row.data, 48000);
      customSounds.push({ id: row.id, name: row.name, buffer: buf });
    } catch {}
  }
  Object.keys(settings.mix || {}).forEach((id) => {
    if (id.startsWith('my-') && !customSounds.find((c) => c.id === id)) delete settings.mix[id];
  });
}

function layerDef(id) {
  if (LAYERS[id]) return LAYERS[id];
  const c = customSounds.find((s) => s.id === id);
  if (c) return { name: c.name, group: 'Мои звуки', icon: 'wave2', buffer: c.buffer, custom: true };
  return null;
}

function layerName(id) {
  const d = layerDef(id);
  return d ? d.name : null;
}

/* ============================================================
   АУДИО-ДВИЖОК
   ============================================================ */

const SCALES = {
  dark:    { notes: [55.0, 82.41, 110.0, 130.81], pad: [110.0, 164.81, 220.0, 261.63] },
  neutral: { notes: [65.41, 98.0, 130.81, 155.56], pad: [130.81, 196.0, 261.63, 311.13] },
  light:   { notes: [87.31, 130.81, 174.61, 220.0], pad: [174.61, 261.63, 349.23, 440.0] },
};

const ROOMS = { small: { sec: 1.4, decay: 3.2, mix: 0.18 }, medium: { sec: 2.6, decay: 2.4, mix: 0.26 }, large: { sec: 4.4, decay: 1.9, mix: 0.36 } };

const bufferCache = new Map();

function normalizeBuffer(buf, targetRms) {
  const chans = [];
  let sum = 0, n = 0, peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    chans.push(d);
    for (let i = 0; i < d.length; i++) {
      sum += d[i] * d[i];
      peak = Math.max(peak, Math.abs(d[i]));
    }
    n += d.length;
  }
  if (!n || peak === 0) return;
  const rms = Math.sqrt(sum / n);
  let g = (targetRms || 0.1) / Math.max(0.0001, rms);
  if (peak * g > 0.9) g = 0.9 / peak;
  chans.forEach((d) => { for (let i = 0; i < d.length; i++) d[i] *= g; });
}

function crossfadeLoop(ctx, buf, seconds) {
  const sr = buf.sampleRate;
  const X = Math.floor(seconds * sr);
  const len = buf.length - X;
  const out = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const s = buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1));
    const d = out.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = s[i];
      if (i < X) {
        const t = i / X;
        d[i] = s[i] * t + s[len + i] * (1 - t);
      }
    }
  }
  return out;
}

function getLayerBuffer(id, def, ctx) {
  // свои файлы: та же обработка, что и у встроенных слоёв —
  // нормализация по RMS и бесшовная петля, иначе на стыке слышен щелчок
  if (def.buffer) {
    const key = 'custom:' + id;
    let b = bufferCache.get(key);
    if (!b) {
      b = def.buffer;
      try { normalizeBuffer(b, 0.15); } catch {}
      try { if (b.length > b.sampleRate * 1.2) b = crossfadeLoop(ctx, b, 0.35); } catch {}
      bufferCache.set(key, b);
    }
    return b;
  }
  const key = id + '@' + ctx.sampleRate;
  let b = bufferCache.get(key);
  if (b) return b;
  const seconds = 12;
  b = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  def.gen(b.getChannelData(0), b.getChannelData(1), ctx.sampleRate);
  normalizeBuffer(b, def.target || 0.08);
  b = crossfadeLoop(ctx, b, 0.35);
  bufferCache.set(key, b);
  return b;
}

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.running = false;
    this.layers = new Map();
  }

  init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const ctx = this.ctx;
    const room = ROOMS[settings.room] || ROOMS.medium;

    this.master = ctx.createGain();
    this.master.gain.value = 0;

    // для динамика телефона: срезаем низ и не даём «бубнить»
    this.hpFilter = ctx.createBiquadFilter();
    this.hpFilter.type = 'highpass';
    this.hpFilter.frequency.value = settings.speaker ? 130 : 20;
    this.hpFilter.Q.value = 0.6;
    this.master.connect(this.hpFilter);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 3;
    comp.attack.value = 0.02; comp.release.value = 0.3;
    this.hpFilter.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(room.sec, room.decay);
    this.wet = ctx.createGain(); this.wet.gain.value = room.mix;
    this.dry = ctx.createGain(); this.dry.gain.value = 0.85;
    this.reverb.connect(this.wet).connect(this.master);
    this.dry.connect(this.master);

    /* --- генеративная основа --- */
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 420;
    this.droneFilter.Q.value = 0.9;
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0;
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

    this.subGain = ctx.createGain(); this.subGain.gain.value = 0;
    this.subGain.connect(this.dry);
    [46, 48.5].forEach((f) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      o.connect(this.subGain); o.start(); this.oscs.push(o);
    });

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

    /* --- среда --- */
    this.ambientBus = ctx.createGain();
    this.ambientBus.gain.value = 0;
    this.ambientBus.connect(this.dry);
    const ambWet = ctx.createGain();
    ambWet.gain.value = 0.3;
    this.ambientBus.connect(ambWet).connect(this.reverb);

    // панорама
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      this.master.disconnect();
      this.master.connect(pan).connect(this.hpFilter);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.03;
      const lg = ctx.createGain(); lg.gain.value = 0.3;
      lfo.connect(lg).connect(pan.pan); lfo.start(); this.oscs.push(lfo);
    }

    this.space = 0;
    this.applyMix();
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
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /* --- слои среды --- */

  ensureLayer(id) {
    if (this.layers.has(id)) return this.layers.get(id);
    const def = layerDef(id);
    if (!def) return null;
    let buf;
    try { buf = getLayerBuffer(id, def, this.ctx); } catch { return null; }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = (Math.random() - 0.5) * 0.25;
      src.connect(gain).connect(pan).connect(this.ambientBus);
    } else {
      src.connect(gain).connect(this.ambientBus);
    }
    src.start();
    const node = { src, gain, def };
    this.layers.set(id, node);
    this.oscs.push(src);
    return node;
  }

  setLayer(id, v) {
    const node = this.ensureLayer(id);
    if (!node) return;
    const t = this.ctx.currentTime;
    const target = Math.pow(clamp(v, 0, 1), 1.25);
    node.gain.gain.setTargetAtTime(target, t, 0.25);
    node.target = target;
  }

  applyMix() {
    if (!this.ctx) return;
    Object.keys(settings.mix || {}).forEach((id) => {
      const v = settings.mix[id];
      if (v > 0.001) this.setLayer(id, v);
      else if (this.layers.has(id)) this.setLayer(id, 0);
    });
  }

  refreshMix() {
    if (!this.ctx) return;
    Object.entries(settings.mix || {}).forEach(([id, v]) => {
      if (this.layers.has(id)) this.setLayer(id, v);
      else if (v > 0.001) this.setLayer(id, v);
    });
  }

  masterTarget() {
    if (settings.muted) return 0.0001;
    return 0.18 + 0.60 * clamp(settings.volume, 0, 1);
  }

  start() {
    const t = this.ctx.currentTime;
    const target = this.masterTarget();
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(0.0001, t);
    if (settings.quietStart && !settings.muted) {
      // «тихий старт»: первые секунды вполголоса, чтобы не напугать
      this.master.gain.exponentialRampToValueAtTime(Math.max(0.0001, target * 0.35), t + 2.5);
      this.master.gain.exponentialRampToValueAtTime(target, t + 18);
    } else {
      this.master.gain.exponentialRampToValueAtTime(target, t + 3.2);
    }
    this.running = true;
  }

  /** общий регулятор громкости: применяется мгновенно и без щелчков */
  setVolume(v, muted) {
    if (!this.ctx || !this.running) return;
    const t = this.ctx.currentTime;
    if (typeof muted === 'boolean') settings.muted = muted;
    if (typeof v === 'number') settings.volume = clamp(v, 0, 1);
    const target = this.masterTarget();
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(target, t, 0.08);
  }

  setSpeaker(on) {
    if (!this.ctx) return;
    settings.speaker = !!on;
    const t = this.ctx.currentTime;
    this.hpFilter.frequency.setTargetAtTime(on ? 130 : 20, t, 0.2);
  }

  setPaused(paused) {
    if (!this.ctx || !this.running) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(paused ? 0.0001 : this.masterTarget(), t, paused ? 0.25 : 0.6);
  }

  update({ env, phase, slope, lead, space }) {
    if (!this.running) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const k = clamp(settings.response, 0.35, 1.6);
    const e = clamp(0.5 + (env - 0.5) * k, 0, 1);

    const timbreShift = settings.timbre === 'dark' ? -120 : settings.timbre === 'light' ? 220 : 0;
    const bassMul = Math.pow(2, settings.bass / 6) * (settings.speaker ? 0.55 : 1);
    const air = clamp(slope * 6 * k, 0, 1);

    this.droneFilter.frequency.setTargetAtTime(clamp(240 + 620 * e + timbreShift, 90, 4200), t, 0.09);
    this.droneGain.gain.setTargetAtTime((space ? 0.10 : 0.20) * (0.45 + 0.55 * e), t, 0.2);
    this.subGain.gain.setTargetAtTime((0.05 + 0.16 * e) * bassMul * (space ? 0.4 : 1), t, 0.12);
    this.airGain.gain.setTargetAtTime(0.015 + 0.085 * air, t, 0.08);
    this.airFilter.frequency.setTargetAtTime(320 + 900 * e, t, 0.1);
    this.padGain.gain.setTargetAtTime((lead ? 0.075 : 0.13) * (0.6 + 0.4 * e), t, 0.3);
    this.wet.gain.setTargetAtTime((ROOMS[settings.room] || ROOMS.medium).mix + 0.2 * (1 - e), t, 0.25);
    this.droneFilter.Q.setTargetAtTime(0.9 + 1.6 * (1 - e), t, 0.25);

    // среда дышит вместе с вами, но очень деликатно — и уходит в тишину в финале
    const ambLevel = (0.82 + 0.18 * e) * (1 - 0.88 * (space || 0));
    this.ambientBus.gain.setTargetAtTime(ambLevel, t, 0.3);
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

/* ============================================================
   ДЕТЕКТОР ДЫХАНИЯ
   ============================================================ */

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

  tick() {
    if (!this.ready) return this.state();
    this.analyser.getByteFrequencyData(this.buf);

    let sum = 0, n = 0;
    for (let i = this.lo; i < this.hi; i++) { sum += this.buf[i]; n++; }
    const raw = (sum / n) / 255;

    if (raw < this.floor) this.floor = this.floor * 0.92 + raw * 0.08;
    else this.floor += 0.00008;
    if (raw > this.peak) this.peak = raw; else this.peak *= 0.9993;
    const span = Math.max(0.02, this.peak - this.floor);
    const norm = clamp((raw - this.floor) / span, 0, 1);

    const a = norm > this.env ? 0.30 : 0.09;
    this.prevEnv = this.env;
    this.env += (norm - this.env) * a;

    // адаптивные пороги: локальные min/max огибающей.
    // фиксированные 0.55/0.28 не работают на поверхностном дыхании —
    // огибающая просто не опускается ниже порога, и частота не считается
    if (this.envMin == null) { this.envMin = this.env; this.envMax = this.env; }
    this.envMin += (this.env - this.envMin) * (this.env < this.envMin ? 0.25 : 0.0015);
    this.envMax += (this.env - this.envMax) * (this.env > this.envMax ? 0.25 : 0.0015);
    const dyn = this.envMax - this.envMin;
    const hi = this.envMin + 0.62 * dyn;
    const lo = this.envMin + 0.28 * dyn;

    const now = performance.now();
    if (this.lastOnset == null) this.lastOnset = 0;
    if (dyn > 0.12 && this.env > hi && this.phase !== 'inhale' && now - this.lastOnset > 1200) {
      this.phase = 'inhale';
      this.lastOnset = now;
      this.onsets.push(now);
      if (this.onsets.length > 8) this.onsets.shift();
      if (settings.haptics && navigator.vibrate) navigator.vibrate(14);
    } else if (this.env < lo && this.phase !== 'exhale') {
      this.phase = 'exhale';
    }

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
    const dynamics = clamp(dyn / 0.35, 0, 1);
    this.quality = clamp(snr * 0.45 + clamp(iv.length / 4, 0, 1) * 0.35 + dynamics * 0.2, 0, 1);
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

/* ============================================================
   ВИЗУАЛИЗАЦИЯ
   ============================================================ */

class Visualizer {
  constructor(canvas) {
    this.c = canvas;
    this.x = canvas.getContext('2d');
    this.history = [];
    try { this.reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { this.reduce = false; }
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
    this.particles = Array.from({ length: this.reduce ? 18 : 64 }, () => ({
      a: Math.random() * TAU,
      r: 0.28 + Math.random() * 0.55,
      s: this.reduce ? 0 : 0.15 + Math.random() * 0.6,
      z: 0.3 + Math.random() * 0.7,
    }));
  }

  destroy() { window.removeEventListener('resize', this.onResize); }

  draw({ env, phase, targetEnv, pacerProgress, lead, t }) {
    const x = this.x, W = this.w, H = this.h;
    const cx = W / 2, cy = H * 0.46;
    const baseR = Math.min(W, H) * 0.17;
    const amp = Math.min(W, H) * 0.085;

    const bg = x.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.8);
    bg.addColorStop(0, 'rgba(24,46,52,0.55)');
    bg.addColorStop(0.55, 'rgba(10,14,20,0.9)');
    bg.addColorStop(1, '#0a0e14');
    x.fillStyle = bg;
    x.fillRect(0, 0, W, H);

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
      x.arc(px, py, 1.1 + p.z * 1.2, 0, TAU);
      x.fill();
    }
    x.restore();

    const r = baseR + amp * env;
    const glow = x.createRadialGradient(cx, cy, r * 0.05, cx, cy, r * 3.1);
    glow.addColorStop(0, `rgba(127,227,212,${0.10 + 0.16 * env})`);
    glow.addColorStop(0.45, `rgba(43,143,134,${0.07 + 0.09 * env})`);
    glow.addColorStop(1, 'rgba(43,143,134,0)');
    x.fillStyle = glow;
    x.beginPath(); x.arc(cx, cy, r * 3.1, 0, TAU); x.fill();

    const core = x.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.1, cx, cy, r);
    core.addColorStop(0, 'rgba(200,255,246,0.92)');
    core.addColorStop(0.32, 'rgba(127,227,212,0.55)');
    core.addColorStop(1, 'rgba(20,70,70,0.20)');
    x.fillStyle = core;
    x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill();

    x.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const rr = baseR * (1.45 + i * 0.42) + amp * env * (1 - i * 0.18);
      x.strokeStyle = `rgba(127,227,212,${0.16 - i * 0.04})`;
      x.beginPath();
      const start = tsec * (0.10 + i * 0.05) + i;
      x.arc(cx, cy, rr, start, start + Math.PI * (1.2 + 0.3 * env));
      x.stroke();
    }

    if (lead != null) {
      const rr = baseR * 2.55;
      x.lineWidth = 2;
      x.strokeStyle = 'rgba(127,227,212,0.10)';
      x.beginPath(); x.arc(cx, cy, rr, 0, TAU); x.stroke();
      x.strokeStyle = 'rgba(127,227,212,0.55)';
      x.beginPath();
      x.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + pacerProgress * TAU);
      x.stroke();
      x.lineWidth = 1;
    }

    this.history.push(env);
    if (this.history.length > 260) this.history.shift();
    const hy = H * 0.86, hh = H * 0.075;
    x.strokeStyle = 'rgba(127,227,212,0.35)';
    x.lineWidth = 1.2;
    x.beginPath();
    const step = W / 260;
    this.history.forEach((v, i) => {
      const px = i * step, py = hy - v * hh;
      i === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
    });
    x.stroke();
  }
}

/* ============================================================
   СЕССИЯ
   ============================================================ */

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
  space: 0,
  pacerT: 0,
  guided: false,
  paused: false,
  pausedAt: 0,
  hidden: false,
  timerDriver: null,
  night: false,
  wakeLock: null,
};

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function pacerEnv(p, soft) {
  const inFrac = soft ? 0.46 : 0.42;
  if (p < inFrac) return smoothstep(p / inFrac);
  return 1 - smoothstep((p - inFrac) / (1 - inFrac));
}

function stopPreview() {
  Workshop.loading = false;
  if (Workshop.timer) { clearInterval(Workshop.timer); Workshop.timer = null; }
  if (Workshop.engine) {
    const e = Workshop.engine;
    Workshop.engine = null;
    e.stop(true);
  }
  const lbl = $('#btn-preview');
  if (lbl) { lbl.classList.remove('on'); lbl.classList.remove('loading'); lbl.textContent = 'Слушать среду'; }
}

async function startSession(customDur, opts) {
  if (Session.active) return;
  opts = opts || {};

  // первая встреча: объясняем микрофон и задаём один вопрос о безопасности
  if (!store.get('onboarded') && !opts.skipOnboard) {
    openOnboarding();
    return;
  }

  stopPreview();
  const dur = customDur || Session.duration || 180;
  const night = !!opts.night || dur >= 900;

  showScreen('s-session');
  Session.active = true;
  Session.paused = false;
  Session.hidden = false;
  Session.night = night;
  Session.duration = dur;
  Session.startAt = performance.now();
  Session.lastFrame = Session.startAt;
  Session.phase = 'mirror';
  Session.calmAt = null;
  Session.calmHold = 0;
  Session.rateSamples = [];
  Session.qualitySamples = [];
  Session.space = 0;
  Session.pacerT = 0;
  Session.startRate = fingerprint.rf ? fingerprint.rf + 1.2 : 6.5;
  Session.targetRate = Session.startRate;

  setPhaseLabel(night ? 'Ночь' : 'Зеркало', night ? 'Замолчим, когда вы уснёте.' : 'Просто дышите. Мы подстроимся.');
  setBreathCue('зеркало');
  $('#rate-out').textContent = '—';
  $('#s-session').classList.remove('paused');
  setPauseUI(false);

  // ВАЖНО: AudioContext создаём синхронно, в жесте пользователя.
  // Любой await до этого лишает Safari/iOS права на автозапуск звука.
  try {
    Session.engine = new AudioEngine();
    Session.engine.init();
    Session.engine.start();
  } catch (err) {
    Session.active = false;
    showScreen('s-intro');
    toast('Звук не запустился. Проверьте, что вкладка не в беззвучном режиме');
    return;
  }

  // система может приостановить звук (звонок, другое приложение) — не теряем сессию
  if (Session.engine.ctx) {
    Session.engine.ctx.onstatechange = () => {
      const st = Session.engine && Session.engine.ctx && Session.engine.ctx.state;
      if (st === 'suspended' && Session.active && !Session.paused) {
        togglePause();
        toast('Система приостановила звук — нажмите «продолжить»');
      }
    };
  }

  if (Session.viz) Session.viz.destroy();
  Session.viz = new Visualizer($('#viz'));

  Session.detector = new BreathDetector(Session.engine.ctx);
  Session.guided = !settings.mic;
  setMicState(false);

  startDriver();
  requestWakeLock();
  initMediaSession();

  if (settings.mic) {
    try {
      await Session.detector.start();
      if (!Session.active) { Session.detector.stop(); return; }
      setMicState(true);
      Session.guided = false;
    } catch (e) {
      setMicState(false);
      Session.guided = true;
      toast('Без микрофона тоже работает: поведём вас по такту');
    }
  }
}

/* --- планировщик: requestAnimationFrame + страховка для фоновой вкладки --- */
function startDriver() {
  stopDriver();
  Session.hidden = document.hidden;
  if (Session.hidden) {
    // rAF в скрытой вкладке не тикает — иначе сессия «замерзает» и не заканчивается
    Session.timerDriver = setInterval(() => loop(performance.now()), 250);
  } else {
    Session.raf = requestAnimationFrame(loop);
  }
}

function stopDriver() {
  cancelAnimationFrame(Session.raf);
  Session.raf = 0;
  if (Session.timerDriver) { clearInterval(Session.timerDriver); Session.timerDriver = null; }
}

function scheduleNext() {
  if (Session.hidden) {
    if (!Session.timerDriver) Session.timerDriver = setInterval(() => loop(performance.now()), 250);
  } else {
    Session.raf = requestAnimationFrame(loop);
  }
}

/* --- экран не должен гаснуть во время дыхания --- */
async function requestWakeLock() {
  try {
    if (!('wakeLock' in navigator)) return;
    Session.wakeLock = await navigator.wakeLock.request('screen');
    Session.wakeLock.addEventListener('release', () => { Session.wakeLock = null; });
  } catch {}
}

function releaseWakeLock() {
  try { Session.wakeLock && Session.wakeLock.release(); } catch {}
  Session.wakeLock = null;
}

/* --- управление с локскрина / из наушников --- */
function initMediaSession() {
  try {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: 'Отклик — дыхание',
      artist: mixName(settings.mix),
      album: 'Отклик',
    });
    navigator.mediaSession.setActionHandler('pause', () => Session.active && !Session.paused && togglePause());
    navigator.mediaSession.setActionHandler('play', () => Session.active && Session.paused && togglePause());
    navigator.mediaSession.setActionHandler('stop', () => Session.active && finishSession('partial', true));
  } catch {}
}

function clearMediaSession() {
  try {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = null;
    ['pause', 'play', 'stop'].forEach((a) => navigator.mediaSession.setActionHandler(a, null));
  } catch {}
}

/* --- пауза --- */
function togglePause() {
  if (!Session.active) return;
  Session.paused = !Session.paused;
  Session.engine && Session.engine.setPaused(Session.paused);
  $('#s-session').classList.toggle('paused', Session.paused);
  setPauseUI(Session.paused);
  if (Session.paused) {
    Session.pausedAt = performance.now();
    setBreathCue('пауза');
    toast('Пауза. Продолжим, когда будете готовы');
  } else {
    // сдвигаем старт, чтобы пауза не съедала сессию
    Session.startAt += performance.now() - (Session.pausedAt || performance.now());
    Session.lastFrame = performance.now();
    Session.pausedAt = 0;
    toast('Продолжаем');
  }
}

function setPauseUI(paused) {
  const b = $('#btn-pause');
  if (!b) return;
  b.classList.toggle('on', paused);
  b.setAttribute('aria-pressed', String(paused));
  const icon = $('#pause-icon');
  if (icon) icon.setAttribute('d', paused ? 'M8 5l11 7-11 7z' : 'M9 5v14M15 5v14');
  b.setAttribute('aria-label', paused ? 'Продолжить' : 'Пауза');
}

/* --- продлить сессию --- */
function extendSession(sec) {
  if (!Session.active) return;
  Session.duration += sec || 120;
  toast(`Добавили ${Math.round((sec || 120) / 60)} мин — всё, что нужно`);
  $('#timer').textContent = fmtTime(Math.max(0, Session.duration - (performance.now() - Session.startAt) / 1000));
}

function setBreathCue(text) {
  const el = $('#breath-cue');
  if (el) el.textContent = text;
}

/* --- среда во время сессии --- */
function openSessionSheet() {
  if (!Session.active) return;
  const softLive = $('#set-soft-live');
  if (softLive) softLive.checked = !!settings.soft;
  renderLayers('#layer-list-session');
  renderSessionMixes();
  openSheet('#session-sheet');
}

function renderSessionMixes() {
  const host = $('#session-mixes-row');
  if (!host) return;
  host.innerHTML = '';
  (settings.mixes || []).forEach((m) => {
    const b = document.createElement('button');
    b.className = 'saved-chip';
    b.textContent = m.name;
    b.addEventListener('click', () => {
      settings.mix = Object.assign({}, m.mix);
      saveSettings();
      applyMixLive();
      renderLayers('#layer-list-session');
      renderLayers();
      updateMixUI();
      toast(`Среда «${m.name}»`);
    });
    host.appendChild(b);
  });
}

function applyMixLive() {
  const engine = Session.active ? Session.engine : Workshop.engine;
  if (!engine) return;
  Object.keys(settings.mix || {}).forEach((id) => {
    if (settings.mix[id] > 0.001) engine.setLayer(id, settings.mix[id]);
    else if (engine.layers && engine.layers.has(id)) engine.setLayer(id, 0);
  });
  try {
    if ('mediaSession' in navigator && navigator.mediaSession.metadata) {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: 'Отклик — дыхание', artist: mixName(settings.mix), album: 'Отклик',
      });
    }
  } catch {}
}

/* --- проверка наушников: левый / правый --- */
function testHeadphones() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);
    const play = (pan, at) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 440;
      const g = ctx.createGain();
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.9, at + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
      o.connect(g);
      if (p) { p.pan.value = pan; g.connect(p).connect(master); } else { g.connect(master); }
      o.start(at); o.stop(at + 0.6);
    };
    const t = ctx.currentTime + 0.05;
    play(-1, t);
    play(1, t + 0.75);
    setTimeout(() => { try { ctx.close(); } catch {} }, 1800);
    toast('Слева, затем справа. Если не так — проверьте баланс');
  } catch {
    toast('Не получилось проверить звук');
  }
}

/* --- первая встреча --- */
let onboardChoice = null;

function openOnboarding() {
  const sheet = $('#onboard-sheet');
  if (!sheet) return;
  sheet.hidden = false;
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  onboardChoice = null;
  $$('#screen-row .outcome-btn').forEach((b) => b.classList.remove('sel'));
}

function closeOnboarding() {
  const sheet = $('#onboard-sheet');
  if (!sheet) return;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  sheet.hidden = true;
}

function completeOnboarding(forceGuided) {
  if (onboardChoice === 'yes' || onboardChoice === 'sometimes') {
    settings.soft = true;
    const cb = $('#set-soft');
    if (cb) cb.checked = true;
  }
  if (forceGuided) {
    settings.mic = false;
    const cb = $('#set-mic');
    if (cb) cb.checked = false;
  }
  saveSettings();
  store.set('onboarded', true);
  closeOnboarding();
  startSession(chosenDuration, { skipOnboard: true });
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

  if (Session.paused) {
    Session.lastFrame = now;
    if (Session.viz) {
      Session.viz.draw({
        env: 0.34, phase: 'pause', targetEnv: 0.34, pacerProgress: 0,
        lead: null, t: now, paused: true,
      });
    }
    scheduleNext();
    return;
  }

  const dt = Math.min(0.25, (now - Session.lastFrame) / 1000);
  Session.lastFrame = now;

  const elapsed = (now - Session.startAt) / 1000;
  const total = Session.duration;

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

  const st = Session.detector ? Session.detector.tick() : { env: 0, phase: 'exhale', rate: null, quality: 0, live: false };
  const guided = Session.guided || !st.live;

  if (phase !== 'mirror') {
    const leadElapsed = elapsed - mirrorEnd;
    const target = fingerprint.rf || 5.5;
    const steps = Math.min(8, Math.floor(leadElapsed / 30));
    const wanted = Math.max(target, Session.startRate - steps * 0.4);
    Session.targetRate += (wanted - Session.targetRate) * Math.min(1, dt * 0.6);
  } else {
    Session.targetRate = Session.startRate;
  }
  const period = 60 / Session.targetRate;
  Session.pacerT += dt;
  const pacerP = (Session.pacerT % period) / period;
  const pEnv = pacerEnv(pacerP, settings.soft);

  // тактильная и текстовая подсказка фазы — для тех, кто дышит с закрытыми глазами
  const cuePhase = guided || phase !== 'mirror' ? pacerP : (st.phase === 'inhale' ? 0.2 : 0.7);
  if (settings.haptics && navigator.vibrate && cuePhase < (Session._cuePrev || 0)) {
    navigator.vibrate(phase === 'space' ? 0 : 22);
  }
  Session._cuePrev = cuePhase;

  if (phase === 'space') setBreathCue('тишина');
  else if (Session.night && phase === 'lead') setBreathCue('ночь · дышите свободно');
  else setBreathCue(cuePhase < (settings.soft ? 0.46 : 0.42) ? 'вдох' : 'выдох');

  const userEnv = st.env;
  const lead = phase === 'lead';
  const audioEnv = guided ? pEnv : phase === 'mirror' ? userEnv : clamp(0.62 * pEnv + 0.38 * userEnv, 0, 1);

  const prevP = Session._lastP == null ? pEnv : Session._lastP;
  Session.space = phase === 'space' ? smoothstep((elapsed - leadEnd) / Math.max(1, total - leadEnd)) : 0;

  Session.engine.update({
    env: audioEnv,
    phase: st.phase,
    slope: guided ? Math.abs(pEnv - prevP) * 12 : st.slope,
    lead: lead || phase === 'space',
    space: Session.space,
  });
  Session._lastP = pEnv;

  Session.viz.draw({
    env: guided ? pEnv : clamp(0.7 * userEnv + 0.3 * pEnv, 0, 1),
    phase: st.phase,
    targetEnv: pEnv,
    pacerProgress: pacerP,
    lead: lead ? true : null,
    t: now,
  });

  const shownRate = st.rate && !guided ? st.rate : Session.targetRate;
  $('#rate-out').textContent = shownRate ? shownRate.toFixed(1).replace('.', ',') : '—';
  if (st.rate) Session.rateSamples.push(st.rate);
  if (st.quality) Session.qualitySamples.push(st.quality);
  $('#timer').textContent = fmtTime(total - elapsed);

  if (phase === 'lead' && st.rate) {
    const inCorridor = Math.abs(st.rate - Session.targetRate) <= 1.5;
    Session.calmHold = inCorridor ? Session.calmHold + dt : 0;
    if (Session.calmHold >= 30 && Session.calmAt == null) Session.calmAt = elapsed - 30;
  }

  if (elapsed >= total) { finishSession('complete'); return; }
  scheduleNext();
}

async function finishSession(status, early) {
  if (!Session.active) return;
  Session.active = false;
  Session.paused = false;
  stopDriver();
  releaseWakeLock();
  clearMediaSession();
  $('#s-session').classList.remove('paused');

  const elapsed = early ? (performance.now() - Session.startAt) / 1000 : Session.duration;
  if (Session.detector) Session.detector.stop();
  await Session.engine.stop(status !== 'complete');

  const rates = Session.rateSamples.filter((r) => r > 2 && r < 30);
  const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  const quality = Session.qualitySamples.length
    ? Session.qualitySamples.reduce((a, b) => a + b, 0) / Session.qualitySamples.length
    : 0;

  const record = {
    ts: Date.now(),
    dur: Math.round(elapsed),
    mode: Session.night ? 'night' : Session.guided ? 'guided' : 'mirror+lead',
    minutesToCalm: Session.calmAt != null ? Math.round(Session.calmAt / 6) / 10 : null,
    rate: avgRate ? Math.round(avgRate * 10) / 10 : null,
    quality: Math.round(quality * 100),
    soft: settings.soft,
    timbre: settings.timbre,
    mix: mixName(settings.mix),
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

  if (!fingerprint.rf && rates.length >= 3) {
    fingerprint.rf = avgRate ? clamp(Math.round((avgRate - 0.6) * 2) / 2, 4.5, 7) : 5.5;
    store.set('fingerprint', fingerprint);
  }

  renderResult(record);
  showScreen('s-result');
}

function renderResult(rec) {
  const val = rec.minutesToCalm;
  $('#res-eyebrow').textContent = 'сессия завершена' + (rec.mix ? ' · ' + rec.mix : '');
  $('#res-minutes').textContent = val != null ? val.toFixed(1).replace('.', ',') : '—';

  const prev = history.length > 1 ? history.slice(0, -1).reverse().find((r) => r.minutesToCalm != null) : null;
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
    <div class="fact"><div class="fact-k">среда</div><div class="fact-v">${rec.mix || '—'}</div></div>
    <div class="fact"><div class="fact-k">quality</div><div class="fact-v">${rec.quality}%</div></div>
  `;

  $$('.outcome-btn').forEach((b) => b.classList.remove('sel'));
}

function saveOutcome(val) {
  const last = history[history.length - 1];
  if (last && last.outcome == null) { last.outcome = val; store.set('history', history); }
  if (val === 'worse') {
    toast('Спасибо. Попробуем мягче — без задержек и с коротким вдохом');
    settings.soft = true;
    saveSettings();
    $('#set-soft').checked = true;
  } else if (val === 'better') {
    toast('Записали. Завтра станет точнее');
  } else {
    toast('Записали');
  }
}

/* ============================================================
   МАСТЕРСКАЯ СРЕДЫ
   ============================================================ */

const Workshop = {
  engine: null,
  timer: null,
  t0: 0,
  loading: false,
};

function mixName(mix) {
  const on = Object.entries(mix || {}).filter(([id, v]) => v > 0.02 && layerName(id)).sort((a, b) => b[1] - a[1]);
  if (!on.length) return 'Только ваше дыхание';
  const names = on.slice(0, 2).map(([id]) => layerName(id));
  return names.join(' + ') + (on.length > 2 ? ` +${on.length - 2}` : '');
}

function renderLayers(target) {
  const host = $(target || '#layer-list');
  if (!host) return;
  const isMain = !target || target === '#layer-list';
  host.innerHTML = '';

  GROUPS.forEach((group) => {
    let ids;
    if (group === 'Мои звуки') {
      ids = customSounds.map((c) => c.id);
      if (!ids.length) ids = [];
    } else {
      ids = Object.keys(LAYERS).filter((id) => LAYERS[id].group === group);
    }
    if (!ids.length && group !== 'Мои звуки') return;

    const sec = document.createElement('div');
    sec.className = 'layer-group';
    sec.innerHTML = `<div class="group-head">${group}</div>`;

    if (!ids.length) {
      sec.innerHTML += `<div class="group-empty">Своих звуков пока нет — можно добавить файл ниже.</div>`;
    }

    ids.forEach((id) => {
      const def = layerDef(id);
      if (!def) return;
      const vol = Math.round(((settings.mix && settings.mix[id]) || 0) * 100);
      const row = document.createElement('div');
      row.className = 'layer' + (vol > 0 ? ' on' : '');
      row.dataset.id = id;
      row.innerHTML = `
        <button class="layer-toggle" aria-pressed="${vol > 0}">
          <span class="l-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[def.icon] || ICONS.waves}</svg></span>
          <span class="l-name">${escapeHtml(def.name)}</span>
        </button>
        <div class="l-controls">
          <input class="l-vol" type="range" min="0" max="100" step="1" value="${vol}" aria-label="Громкость: ${escapeHtml(def.name)}" />
          ${def.custom ? '<button class="l-del" title="Удалить">×</button>' : ''}
        </div>`;
      sec.appendChild(row);

      const toggle = row.querySelector('.layer-toggle');
      const slider = row.querySelector('.l-vol');

      toggle.addEventListener('click', () => {
        const on = !row.classList.contains('on');
        row.classList.toggle('on', on);
        toggle.setAttribute('aria-pressed', String(on));
        settings.mix[id] = on ? Math.max(0.35, slider.value / 100) : 0;
        slider.value = Math.round(settings.mix[id] * 100);
        saveSettings();
        if (isMain) updateMixUI();
        applyMixLive();
      });

      slider.addEventListener('input', () => {
        const v = Number(slider.value) / 100;
        settings.mix[id] = v;
        row.classList.toggle('on', v > 0);
        toggle.setAttribute('aria-pressed', String(v > 0));
        saveSettings();
        if (isMain) updateMixUI();
        applyMixLive();
      });

      const del = row.querySelector('.l-del');
      if (del) del.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        customSounds = customSounds.filter((c) => c.id !== id);
        delete settings.mix[id];
        saveSettings();
        await idbDel(id);
        renderLayers();
        renderLayers('#layer-list-session');
        updateMixUI();
        toast('Звук удалён');
      });
    });

    host.appendChild(sec);
  });

  if (isMain) updateMixUI();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function updateMixUI() {
  const name = mixName(settings.mix);
  const title = $('#mix-title');
  if (title) title.textContent = name;
  const chip = $('#mix-chip-name');
  if (chip) chip.textContent = name;
  renderSavedMixes();
  renderQuickMixes();
}

/** общий регулятор громкости: один источник правды для всех экранов */
function syncVolumeUI() {
  const v = Math.round(clamp(settings.volume, 0, 1) * 100);
  const slider = $('#vol-slider');
  if (slider && document.activeElement !== slider) slider.value = String(v);
  const setV = $('#set-volume');
  if (setV && document.activeElement !== setV) setV.value = String(Math.max(10, v));

  const mute = $('#btn-mute');
  if (mute) {
    mute.classList.toggle('muted', !!settings.muted);
    mute.setAttribute('aria-pressed', String(!!settings.muted));
    mute.setAttribute('aria-label', settings.muted ? 'Включить звук' : 'Выключить звук');
  }
  const waves = $('#vol-waves');
  if (waves) waves.style.opacity = settings.muted || v === 0 ? '0.15' : '1';
  const icon = $('#vol-icon');
  if (icon) icon.style.opacity = settings.muted ? '0.4' : '1';
}

function setVolume(v, muted) {
  if (typeof v === 'number') settings.volume = clamp(v, 0, 1);
  if (typeof muted === 'boolean') settings.muted = muted;
  saveSettings();
  if (Session.engine) Session.engine.setVolume(settings.volume, settings.muted);
  if (Workshop.engine) Workshop.engine.setVolume(settings.volume, settings.muted);
  syncVolumeUI();
}

function toggleMute() {
  setVolume(settings.volume, !settings.muted);
  toast(settings.muted ? 'Звук выключен — только визуал и вибрация' : 'Звук включён');
}

function renderQuickMixes() {
  const host = $('#quick-mixes');
  if (!host) return;
  host.innerHTML = '';
  const current = JSON.stringify(settings.mix);
  (settings.mixes || []).slice(0, 6).forEach((m) => {
    const b = document.createElement('button');
    b.className = 'quick-mix' + (JSON.stringify(m.mix) === current ? ' active' : '');
    b.textContent = m.name;
    b.addEventListener('click', () => {
      settings.mix = Object.assign({}, m.mix);
      saveSettings();
      updateMixUI();
      applyMixLive();
      renderLayers();
      renderLayers('#layer-list-session');
      toast(`Среда «${m.name}»`);
    });
    host.appendChild(b);
  });
}

function renderSavedMixes() {
  const host = $('#saved-row');
  if (!host) return;
  host.innerHTML = '';
  (settings.mixes || []).forEach((m, idx) => {
    const b = document.createElement('button');
    b.className = 'saved-chip';
    b.innerHTML = `${escapeHtml(m.name)}<span class="saved-x" data-idx="${idx}">×</span>`;
    b.addEventListener('click', (e) => {
      if (e.target.classList.contains('saved-x')) {
        settings.mixes.splice(idx, 1);
        saveSettings();
        renderSavedMixes();
        return;
      }
      settings.mix = Object.assign({}, m.mix);
      saveSettings();
      renderLayers();
      if (Workshop.engine) {
        Workshop.engine.refreshMix();
        Object.keys(settings.mix).forEach((id) => {
          if (settings.mix[id] > 0) Workshop.engine.setLayer(id, settings.mix[id]);
        });
      }
      toast(`Среда «${m.name}»`);
    });
    host.appendChild(b);
  });
  if (!(settings.mixes || []).length) {
    host.innerHTML = '<span class="muted-small">Пока пусто — соберите среду и сохраните.</span>';
  }
}

function saveCurrentMix() {
  const name = mixName(settings.mix);
  if (!Object.values(settings.mix).some((v) => v > 0.02)) {
    return toast('Включите хотя бы один звук');
  }
  settings.mixes = settings.mixes || [];
  if (settings.mixes.some((m) => m.name === name)) return toast('Такая среда уже есть');
  settings.mixes.push({ name, mix: Object.assign({}, settings.mix) });
  saveSettings();
  renderSavedMixes();
  toast(`Сохранили «${name}»`);
}

function togglePreview() {
  const btn = $('#btn-preview');
  if (Workshop.engine) { stopPreview(); return; }
  if (Workshop.loading) return;

  Workshop.loading = true;
  removeSpinner();
  btn.textContent = 'Готовим среду…';
  btn.classList.add('loading');

  // даём браузеру отрисовать состояние, пока синтезируются буферы
  setTimeout(() => {
    Workshop.loading = false;
    Workshop.engine = new AudioEngine();
    Workshop.engine.init();
    Workshop.engine.start();
    btn.classList.remove('loading');
    btn.classList.add('on');
    btn.textContent = 'Остановить';
    Workshop.t0 = performance.now();

    let last = performance.now();
    Workshop.timer = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      Workshop.pacer = (Workshop.pacer || 0) + dt;
      const period = 10;
      const p = (Workshop.pacer % period) / period;
      const e = pacerEnv(p, settings.soft);
      const slope = (e - (Workshop.lastE == null ? e : Workshop.lastE)) * 12;
      Workshop.lastE = e;
      if (Workshop.engine) {
        Workshop.engine.update({ env: e, phase: p < 0.42 ? 'inhale' : 'exhale', slope, lead: false, space: 0 });
      }
    }, 55);
  }, 30);
}

function removeSpinner() {
  const s = document.querySelector('.spin');
  if (s) s.remove();
}

/* ============================================================
   ОТПЕЧАТОК
   ============================================================ */

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
    const timbre = settings.timbre === 'dark' ? 'тёмный тембр' : settings.timbre === 'light' ? 'светлый тембр' : 'нейтральный тембр';
    const mix = mixName(settings.mix);
    f.innerHTML = `<b>${rf}</b> вдоха/мин · ${timbre} · <b>${Math.round(median(history.map((h) => h.dur)) / 60)}</b> мин · ${mix}`;
  }

  const vals = history.filter((h) => h.minutesToCalm != null).map((h) => h.minutesToCalm);
  $('#print-median').textContent = vals.length ? `медиана ${median(vals).toFixed(1).replace('.', ',')} мин` : 'пока нет измерений';

  drawChart(vals);

  const factors = $('#factors');
  if (n < 3) {
    factors.innerHTML = '<li class="muted">Появится после нескольких сессий.</li>';
  } else {
    const better = history.filter((h) => h.outcome === 'better').length;
    const worse = history.filter((h) => h.outcome === 'worse').length;
    const avgQ = Math.round(median(history.map((h) => h.quality)));
    const mixes = {};
    history.forEach((h) => { if (h.mix) mixes[h.mix] = (mixes[h.mix] || 0) + 1; });
    const topMix = Object.entries(mixes).sort((a, b) => b[1] - a[1])[0];
    factors.innerHTML = `
      ${fingerprint.rf ? `<li><span>ваша частота</span><span class="bar">${fingerprint.rf.toFixed(1).replace('.', ',')} / мин</span></li>` : ''}
      ${topMix ? `<li><span>чаще всего</span><span class="bar">${escapeHtml(topMix[0])}</span></li>` : ''}
      <li><span>сессий «спокойнее»</span><span class="bar">${better} из ${n}</span></li>
      <li><span>качество сигнала</span><span class="bar">${avgQ}%</span></li>
      ${worse ? `<li><span>«хуже»</span><span class="bar">${worse}</span></li>` : ''}
    `;
  }

  const sc = $('#sessions-count');
  if (sc) sc.textContent = `сессий: ${n}`;
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
    x.beginPath(); x.arc(px(i), py(v), 2.6, 0, TAU);
    x.fillStyle = '#7fe3d4'; x.fill();
  });
}

/* ============================================================
   НАВИГАЦИЯ
   ============================================================ */

function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  if (id === 's-print') setTimeout(renderFingerprint, 60);
  if (id === 's-intro') setTimeout(renderFingerprint, 60);
  if (id === 's-sound') setTimeout(renderLayers, 40);
  if (id !== 's-sound') stopPreview();
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

/* ============================================================
   СОБЫТИЯ
   ============================================================ */

let chosenDuration = 180;
let chosenNight = false;

$$('#duration-row .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    $$('#duration-row .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    chosenDuration = Number(chip.dataset.dur);
    chosenNight = chip.dataset.night === '1';
  });
});

$('#btn-start').addEventListener('click', () => startSession(chosenDuration, { night: chosenNight }));
$('#btn-stop').addEventListener('click', () => finishSession('partial', true));
$('#btn-pause').addEventListener('click', togglePause);
$('#btn-mute').addEventListener('click', toggleMute);
$('#btn-amb').addEventListener('click', openSessionSheet);
$('#btn-extend').addEventListener('click', () => extendSession(120));
$('#btn-close-session-sheet').addEventListener('click', () => closeSheet($('#session-sheet')));
$('#btn-hp-test').addEventListener('click', testHeadphones);

$('#set-soft-live').addEventListener('change', (e) => {
  settings.soft = e.target.checked;
  saveSettings();
  const cb = $('#set-soft');
  if (cb) cb.checked = settings.soft;
  toast(settings.soft ? 'Мягкий режим: короче вдох, длиннее выдох' : 'Обычный ритм');
});

$('#vol-slider').addEventListener('input', (e) => setVolume(Number(e.target.value) / 100));
$('#vol-slider').addEventListener('change', () => { settings.muted = settings.volume > 0 ? false : settings.muted; saveSettings(); syncVolumeUI(); });

/* первая встреча */
$$('#screen-row .outcome-btn').forEach((b) => {
  b.addEventListener('click', () => {
    $$('#screen-row .outcome-btn').forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
    onboardChoice = b.dataset.screen;
    if (onboardChoice === 'yes' || onboardChoice === 'sometimes') {
      toast('Включим мягкий режим: без задержек, короче вдох');
    }
  });
});
$('#btn-onboard-start').addEventListener('click', () => completeOnboarding(false));
$('#btn-onboard-skip').addEventListener('click', () => completeOnboarding(true));

/* ещё раз с той же настройкой */
$('#btn-again').addEventListener('click', () => startSession(Session.duration || chosenDuration, { night: Session.night }));
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
$('#btn-print-breathe').addEventListener('click', () => startSession(chosenDuration, { night: chosenNight }));

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

/* звуковая мастерская */
$('#btn-sound').addEventListener('click', () => showScreen('s-sound'));
$('#btn-sound-back').addEventListener('click', () => showScreen('s-intro'));
$('#mix-chip').addEventListener('click', () => showScreen('s-sound'));
$('#btn-preview').addEventListener('click', togglePreview);
$('#btn-save-mix').addEventListener('click', saveCurrentMix);
$('#btn-sound-breathe').addEventListener('click', () => startSession(chosenDuration, { night: chosenNight }));

$('#btn-add-custom').addEventListener('click', () => $('#file-custom').click());

$('#file-custom').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) return toast('Файл больше 12 МБ — не сохраним');
  try {
    const arr = await file.arrayBuffer();
    const buf = await decodeAudio(arr.slice(0), 48000);
    const id = 'my-' + Date.now().toString(36);
    const name = (file.name.replace(/\.[^.]+$/, '') || 'свой звук').slice(0, 28);
    customSounds.push({ id, name, buffer: buf });
    await idbPut({ id, name, data: arr });
    settings.mix[id] = 0.5;
    saveSettings();
    renderLayers();
    if (Workshop.engine) Workshop.engine.setLayer(id, 0.5);
    toast('Добавили. Теперь это ваш звук');
  } catch (err) {
    toast('Не получилось прочитать файл — попробуйте mp3 или wav');
  }
});

/* настройки */
$('#set-bass').addEventListener('input', (e) => { settings.bass = Number(e.target.value); saveSettings(); });
$('#set-timbre').addEventListener('change', (e) => { settings.timbre = e.target.value; saveSettings(); toast('Тембр применится в следующей сессии'); });
$('#set-volume').addEventListener('input', (e) => {
  setVolume(Number(e.target.value) / 100);
});
$('#set-response').addEventListener('input', (e) => { settings.response = Number(e.target.value) / 100; saveSettings(); });
$('#set-room').addEventListener('change', (e) => { settings.room = e.target.value; saveSettings(); toast('Пространство применится в следующей сессии'); });
$('#set-mic').addEventListener('change', (e) => { settings.mic = e.target.checked; saveSettings(); });
$('#set-soft').addEventListener('change', (e) => { settings.soft = e.target.checked; saveSettings(); });
$('#set-haptics').addEventListener('change', (e) => { settings.haptics = e.target.checked; saveSettings(); });
$('#set-speaker').addEventListener('change', (e) => {
  settings.speaker = e.target.checked;
  saveSettings();
  [Session.engine, Workshop.engine].forEach((en) => en && en.setSpeaker(settings.speaker));
  toast(settings.speaker ? 'Режим динамика: меньше низа' : 'Режим наушников');
});
$('#set-quiet').addEventListener('change', (e) => { settings.quietStart = e.target.checked; saveSettings(); });

$('#btn-reset-settings').addEventListener('click', () => {
  const keepMixes = settings.mixes;
  settings = Object.assign({}, DEFAULTS, { mixes: keepMixes });
  saveSettings();
  syncControlsFromSettings();
  [Session.engine, Workshop.engine].forEach((en) => en && en.setSpeaker(settings.speaker));
  syncVolumeUI();
  renderLayers();
  toast('Настройки вернулись к исходным');
});

document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  if (e.key === 'Escape') {
    closeSheet($('#settings-sheet'));
    closeSheet($('#help-sheet'));
    closeSheet($('#session-sheet'));
    if (Session.active) finishSession('partial', true);
    return;
  }
  if (typing) return;

  if (e.code === 'Space' && Session.active) {
    e.preventDefault();
    togglePause();
  } else if (e.code === 'Space' && !Session.active) {
    e.preventDefault();
    startSession(chosenDuration, { night: chosenNight });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setVolume(clamp(settings.volume + 0.05, 0, 1), false);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    setVolume(clamp(settings.volume - 0.05, 0, 1));
  } else if (e.key.toLowerCase() === 'm') {
    toggleMute();
  }
});

/* вкладка ушла в фон: сессия не должна «замерзать» */
document.addEventListener('visibilitychange', () => {
  if (!Session.active) return;
  const hidden = document.hidden;
  if (hidden === Session.hidden) return;
  Session.hidden = hidden;
  stopDriver();
  Session.lastFrame = performance.now();
  startDriver();
  if (!hidden) requestWakeLock();
});

/* ============================================================
   СТАРТ
   ============================================================ */

function syncControlsFromSettings() {
  const set = (sel, val) => { const el = $(sel); if (el) el.value = val; };
  const check = (sel, val) => { const el = $(sel); if (el) el.checked = !!val; };
  set('#set-bass', settings.bass);
  set('#set-timbre', settings.timbre);
  set('#set-volume', Math.round(settings.volume * 100));
  set('#set-response', Math.round(settings.response * 100));
  set('#set-room', settings.room);
  check('#set-mic', settings.mic);
  check('#set-soft', settings.soft);
  check('#set-haptics', settings.haptics);
  check('#set-speaker', settings.speaker);
  check('#set-quiet', settings.quietStart);
  syncVolumeUI();
}

syncControlsFromSettings();
renderFingerprint();
updateMixUI();

loadCustomSounds().then(() => {
  renderLayers();
});

/* Отладочный доступ к состоянию (в продакшн-сборке вырезается).
   Нужен для автотестов и ручной проверки сценариев. */
window.__otklik = {
  Session,
  Workshop,
  get settings() { return settings; },
  get history() { return history; },
  get fingerprint() { return fingerprint; },
  get customSounds() { return customSounds; },
};
