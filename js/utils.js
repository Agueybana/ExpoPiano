// utils.js (revised: helpers, tempo estimator, keyboard map, transpose persistence, color math,
// + AI math (sigmoid, softmax, categorical), key/scale detection, seeded RNG factory)
export const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
export const lerp = (a, b, t) => a + (b - a) * t;

export const now = () => performance.now();

// MIDI helpers
export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const midiToNote = (m) => {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const name = names[((m%12)+12)%12];
  const oct = Math.floor(m/12) - 1;
  return `${name}${oct}`;
};

// Deterministic PRNG per note for consistent coloring
export function seededRandom(seed) {
  let t = seed + 0x6d2b79f5;
  return function() {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// General seeded RNG factory (for AI sampling)
export function makeRNG(seedNumber=123456789) {
  const rand = seededRandom(seedNumber|0);
  return {
    uniform: ()=>rand(),
    int: (lo, hi)=> lo + Math.floor(rand() * (hi - lo + 1)),
    choice: (arr)=> arr[Math.floor(rand()*arr.length)]
  };
}

// Simple event emitter
export class Emitter {
  constructor(){ this.map = new Map(); }
  on(type, fn){ (this.map.get(type) ?? this.map.set(type, []).get(type)).push(fn); return () => this.off(type, fn); }
  off(type, fn){ const arr = this.map.get(type); if(!arr) return; const i = arr.indexOf(fn); if(i>=0) arr.splice(i,1); }
  emit(type, ...args){ const arr = this.map.get(type); if(!arr) return; for(const fn of [...arr]) try{ fn(...args); } catch(e){ console.error(e); } }
}

// BPM estimator using inter-onset intervals with robust median filter
export class TempoEstimator {
  constructor(windowMs = 8000){
    this.events = [];
    this.windowMs = windowMs;
    this.bpm = 0;
  }
  onset(t, v){
    this.events.push({t, v});
    const cutoff = t - this.windowMs;
    while(this.events.length && this.events[0].t < cutoff) this.events.shift();
    this.compute();
  }
  compute(){
    if(this.events.length < 3){ this.bpm = 0; return; }
    const d = [];
    for(let i=1;i<this.events.length;i++){
      const dt = this.events[i].t - this.events[i-1].t;
      if(dt > 50 && dt < 2000) d.push(dt);
    }
    if(!d.length){ this.bpm = 0; return; }
    d.sort((a,b)=>a-b);
    const median = d[Math.floor(d.length/2)];
    this.bpm = Math.round(60000 / median);
  }
}

// Keyboard mapping for computer input - intuitive piano layout
export const KEYBOARD_MAP = {
  // Main row white keys (C4-E5): A S D F G H J K L ; '
  'a': 60, // C4
  's': 62, // D4
  'd': 64, // E4
  'f': 65, // F4
  'g': 67, // G4
  'h': 69, // A4
  'j': 71, // B4
  'k': 72, // C5
  'l': 74, // D5
  ';': 76, // E5
  "'": 77, // F5
  
  // Top row black keys: W E T Y U O P [ ]
  'w': 61, // C#4
  'e': 63, // D#4
  't': 66, // F#4
  'y': 68, // G#4
  'u': 70, // A#4
  'o': 73, // C#5
  'p': 75, // D#5
  '[': 78, // F#5
  ']': 80, // G#5
  
  // Bottom row white keys (C3-B3): Z X C V B N M
  'z': 48, // C3
  'x': 50, // D3
  'c': 52, // E3
  'v': 53, // F3
  'b': 55, // G3
  'n': 57, // A3
  'm': 59, // B3
  
  // Number row for higher octave (C5-B5): 1 2 3 4 5 6 7 8 9 0
  '1': 72, // C5 (duplicate of K for convenience)
  '2': 74, // D5
  '3': 76, // E5
  '4': 77, // F5
  '5': 79, // G5
  '6': 81, // A5
  '7': 83, // B5
  '8': 84, // C6
  '9': 86, // D6
  '0': 88, // E6
  
  // Additional keys for lower octave (C2-B2)
  'q': 36, // C2
  'r': 38, // D2
  'i': 40, // E2
  ',': 41, // F2
  '.': 43, // G2
  '/': 45, // A2
  '\\': 47, // B2
};

// Global transpose state (persisted)
const TRANSPOSE_KEY = 'starlight:transpose';
export function loadTranspose(){
  const v = localStorage.getItem(TRANSPOSE_KEY);
  return v ? parseInt(v, 10) : 0;
}
export function saveTranspose(semi){
  localStorage.setItem(TRANSPOSE_KEY, String(semi|0));
}

// Color helpers for lanes/particles
export function hsl(h, s, l, a=1){
  return `hsla(${(h%360+360)%360}, ${Math.round(s*100)}%, ${Math.round(l*100)}%, ${a})`;
}

// Save JSON data to file
export function saveJSON(filename, data) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------- AI math + musical helpers ----------------
export function sigmoid(x){ return 1/(1+Math.exp(-x)); }

export function softmax(arr, temperature=1.0){
  const t = Math.max(1e-3, temperature);
  const m = Math.max(...arr);
  const exps = arr.map(v => Math.exp((v - m)/t));
  const sum = exps.reduce((a,b)=>a+b,0) || 1;
  return exps.map(v=>v/sum);
}

export function sampleCategorical(probs, rng){
  let r = (rng?.uniform?.() ?? Math.random());
  let cum = 0;
  for(let i=0;i<probs.length;i++){
    cum += probs[i];
    if(r <= cum) return i;
  }
  return probs.length-1;
}

// Derive likely key center from recent notes (greedy histogram vs diatonic templates)
const MAJOR_MASK = [1,0,1,0,1,1,0,1,0,1,0,1]; // ionian
const MINOR_MASK = [1,0,1,1,0,1,0,1,1,0,1,0]; // aeolian
export function estimateKey(notes){
  if(!notes.length) return { tonic: 0, mode: 'major' };
  const hist = new Array(12).fill(0);
  for(const n of notes){
    hist[((n%12)+12)%12] += 1;
  }
  let best = {score:-1, tonic:0, mode:'major'};
  for(let tonic=0;tonic<12;tonic++){
    for(const [mask,mode] of [[MAJOR_MASK,'major'],[MINOR_MASK,'minor']]){
      let s=0;
      for(let i=0;i<12;i++){
        const m = mask[(i-tonic+12)%12];
        if(m) s += hist[i];
      }
      if(s>best.score) best = {score:s, tonic, mode};
    }
  }
  return { tonic: best.tonic, mode: best.mode };
}

export function scaleFor(tonic, mode){
  const major = [0,2,4,5,7,9,11];
  const minor = [0,2,3,5,7,8,10];
  const rel = (mode==='major') ? major : minor;
  return new Set(rel.map(d=> (tonic + d + 1200) % 12));
}

export function snapToScale(midi, scaleSet){
  const pc = ((midi%12)+12)%12;
  if(scaleSet.has(pc)) return midi;
  // find nearest pitch class in scale (up/down preference small)
  for(let d=1; d<6; d++){
    const up = (pc + d) % 12;
    const dn = (pc - d + 12) % 12;
    if(scaleSet.has(up)) return midi + d;
    if(scaleSet.has(dn)) return midi - d;
  }
  return midi;
}
