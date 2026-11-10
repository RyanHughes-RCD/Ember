// Small synthesized sound effects (no audio files needed). Unlocked on first tap,
// which iOS Safari requires.

let ctx = null;
let master = null;
let enabled = true;
let ambience = null;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuffer(c, seconds) {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function tone(freq, dur, { type = 'sine', vol = 0.2, delay = 0, slide = 0 } = {}) {
  const c = ac();
  if (!c || !enabled) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur, { vol = 0.3, freq = 1200, q = 0.8, delay = 0, type = 'bandpass' } = {}) {
  const c = ac();
  if (!c || !enabled) return;
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const f = c.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

function crackles(n, spread, vol = 0.25) {
  for (let i = 0; i < n; i++) {
    noise(0.03 + Math.random() * 0.04, { vol: vol * (0.4 + Math.random()), freq: 1500 + Math.random() * 3000, q: 2, delay: Math.random() * spread });
  }
}

export const sfx = {
  unlock() { ac(); },
  setEnabled(on) {
    enabled = on;
    if (!on) stopAmbience();
  },
  tap() { tone(520, 0.06, { type: 'triangle', vol: 0.06 }); },
  select() { tone(660, 0.07, { type: 'triangle', vol: 0.08, slide: 1.2 }); },
  deselect() { tone(440, 0.07, { type: 'triangle', vol: 0.07, slide: 0.8 }); },
  error() { tone(180, 0.15, { type: 'square', vol: 0.05, slide: 0.7 }); },
  stoke() {
    noise(0.7, { vol: 0.35, freq: 400, q: 0.5, type: 'lowpass' });
    crackles(14, 0.9, 0.3);
  },
  pick() {
    noise(0.12, { vol: 0.22, freq: 2600, q: 0.7 });
    tone(880, 0.07, { type: 'triangle', vol: 0.06, delay: 0.03, slide: 1.25 });
  },
  coin() { tone(988, 0.08, { type: 'square', vol: 0.05 }); tone(1319, 0.18, { type: 'square', vol: 0.05, delay: 0.07 }); },
  upgrade() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.1, delay: i * 0.07 })); },
  extinguish() { noise(1.6, { vol: 0.25, freq: 2500, q: 0.4, type: 'highpass' }); tone(220, 1.2, { vol: 0.06, slide: 0.5 }); },
  sift() { noise(0.9, { vol: 0.4, freq: 900, q: 0.6 }); noise(0.6, { vol: 0.2, freq: 3000, q: 1, delay: 0.2 }); },
  reveal(rarity) {
    switch (rarity) {
      case 'uncommon': tone(784, 0.18, { type: 'triangle', vol: 0.08 }); break;
      case 'rare': tone(988, 0.25, { type: 'triangle', vol: 0.09 }); tone(1319, 0.3, { type: 'sine', vol: 0.06, delay: 0.06 }); break;
      case 'epic': [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.35, { type: 'sine', vol: 0.08, delay: i * 0.06 })); break;
      case 'legendary':
        [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.6, { type: 'triangle', vol: 0.1, delay: i * 0.09 }));
        tone(2093, 1.2, { type: 'sine', vol: 0.05, delay: 0.55 });
        break;
      default: tone(587, 0.08, { type: 'triangle', vol: 0.05 });
    }
  },
  milestone() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.4, { type: 'triangle', vol: 0.09, delay: i * 0.12 })); },
};

/** Soft ambient crackle while the fire burns. */
export function startAmbience() {
  if (ambience || !enabled) return;
  const c = ac();
  if (!c) return;
  ambience = setInterval(() => {
    if (!enabled || document.hidden) return;
    crackles(1 + Math.floor(Math.random() * 3), 0.6, 0.06);
  }, 700);
}

export function stopAmbience() {
  if (ambience) clearInterval(ambience);
  ambience = null;
}
