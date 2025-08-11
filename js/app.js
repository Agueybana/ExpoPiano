// js/app.js (revised)
// - Fixes keyboard + mouse/touch behavior.
// - Injects a Metronome BPM slider next to the BPM readout; keeps display in sync.
// - Bumps renderer floor visually to touch the keyboard line.
// - Keeps metronome out of recording.

import {MIDIManager} from './midi.js';
import {Synth} from './audio.js';
import {PianoUI} from './piano.js';
import {Renderer} from './renderer.js';
import {TempoEstimator, KEYBOARD_MAP, loadTranspose, saveTranspose} from './utils.js';
import {THEMES} from './theme.js';
import {Timeline} from './timeline.js';
import {SettingsUI} from './settings.js';

const $ = (id)=>document.getElementById(id);
const on = (el, ev, fn)=> el && el.addEventListener(ev, fn);

const stage = $('stage');
const post = $('post');
const pianoEl = $('keyboard');

const renderer = new Renderer(stage, post);
renderer.setFloorAdjust(-8); // visually remove tiny gap at impact

const midi = new MIDIManager();
const synth = new Synth();
const piano = new PianoUI(pianoEl);
const tempo = new TempoEstimator();
const timeline = new Timeline();
const settings = new SettingsUI();

// UI refs
const midiSelect = $('midi-input');
const refreshBtn = $('refresh-midi');
const rogueGrantBtn = $('request-midi');
const bpmReadout = $('bpm-readout');
const metronomeBtn = $('metronome-btn');
const metronomeVol = $('metronome-vol');
const recordBtn = $('record-btn');
const playBtn = $('play-btn');
const loopBtn = $('loop-btn');
const stopBtn = $('stop-btn');
const transposeSlider = $('transpose');
const masterVolume = $('master-volume');
const enableBloom = $('enable-bloom');
const enableTrails = $('enable-trails');
const enableShadows = $('enable-shadows');
const enableExplosions = $('enable-explosions');
const explosionType = $('explosion-type');
const particleBudget = $('particle-budget');
const themeSelect = $('theme-select');
const voiceMode = $('voice-mode');
const polyphony = $('polyphony');
const reverbRoom = $('reverb-room');
const reverbSize = $('reverb-size');
const reverbMix = $('reverb-mix');
const delayTime = $('delay-time');
const delayFeedback = $('delay-feedback');
const delayMix = $('delay-mix');
const compKeys = $('computer-keys');
const labelMode = $('label-mode');
const exportBtn = $('export-json');
const importInput = $('import-json');
const clearRecs = $('clear-recordings');
const pianoSound = $('piano-sound');

// Kill legacy button if present
if (rogueGrantBtn && rogueGrantBtn.parentNode) rogueGrantBtn.parentNode.removeChild(rogueGrantBtn);

// Theme init
if(themeSelect){
  for(const t of THEMES){
    if(![...themeSelect.options].some(o=>o.value===t.id)){
      const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; themeSelect.appendChild(o);
    }
  }
  themeSelect.value = 'neon';
}
let currentTheme = THEMES.find(t=>t.id===(themeSelect?.value||'neon')) || THEMES[0];
document.documentElement.style.setProperty('--bg', currentTheme.bg);
renderer.setTheme(currentTheme);

// Transpose persistence
let transpose = loadTranspose();
if(transposeSlider) transposeSlider.value = String(transpose);

// MIDI via dropdown
midi.init();
const REQUEST_VALUE = '__request__';
function rebuildMIDIOptions(inputs){
  if(!midiSelect) return;
  midiSelect.innerHTML = '';
  if(!midi.midi){
    const req = document.createElement('option');
    req.value = REQUEST_VALUE; req.textContent = 'Request MIDI Access…';
    midiSelect.appendChild(req);
  }
  if(!inputs || !inputs.length){
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = midi.midi ? 'No devices found' : '—';
    midiSelect.appendChild(opt);
  } else {
    for(const i of inputs){
      const opt = document.createElement('option');
      opt.value = i.id;
      opt.textContent = `${i.manufacturer||''} ${i.name}`.trim() || 'MIDI Device';
      midiSelect.appendChild(opt);
    }
  }
}
midi.on('inputs-changed', (inputs)=>rebuildMIDIOptions(inputs));
midi.on('input-selected', (input)=>{
  if(!midiSelect) return;
  midiSelect.value = input ? input.id : (midi.midi ? '' : REQUEST_VALUE);
});
on(midiSelect, 'mousedown', async ()=>{
  if(!midi.midi){
    const ok = await midi.requestAccess();
    if(!ok) return;
    midi.refreshInputs();
  }
});
on(midiSelect, 'change', ()=>{
  const v = midiSelect.value;
  if(v === REQUEST_VALUE){ midi.requestAccess().then(ok=>{ if(ok) midi.refreshInputs(); }); }
  else { midi.setInput(v); }
});
on(refreshBtn, 'click', ()=>midi.refreshInputs());

// Align renderer lanes to keys
function updateLaneAlignment(){
  const map = piano.getKeyRects();
  renderer.updateKeyboardRect(map);
}
window.addEventListener('resize', updateLaneAlignment);
setTimeout(updateLaneAlignment, 200);

// Note handling (transpose-aware)
function transposed(note){
  const n = note + transpose;
  if(n < 21 || n > 108) return null;
  return n;
}
function handleNoteOn(rawNote, velocity){
  const note = transposed(rawNote);
  if(note==null) return;
  synth.noteOn(note, velocity);
  const key = piano.keys.get(note);
  if(key){
    renderer.noteOn(note, velocity);
    piano.press(note);
    piano.trailBegin(note, renderer.colorFor(note, velocity));
  }
  tempo.onset(performance.now(), velocity);
  const bpm = tempo.bpm;
  // Update BPM readout but don't change metronome speed
  if(bpm) updateBPMReadout(bpm);
  timeline.emit('noteon', {note, velocity});
}
function handleNoteOff(rawNote){
  const note = transposed(rawNote);
  if(note==null) return;
  synth.noteOff(note);
  renderer.noteOff(note);
  piano.release(note);
  piano.trailEnd(note);
  timeline.emit('noteoff', {note});
}

// MIDI -> app
midi.on('noteon', ({note, velocity})=>handleNoteOn(note, velocity));
midi.on('noteoff', ({note})=>handleNoteOff(note));
midi.on('sustain', ({on})=>synth.setSustain(on));

// PianoUI emits pointer events (includes swipe)
piano.on('pointerdown', (m)=>handleNoteOn(m, 0.85));
piano.on('pointerup',   (m)=>handleNoteOff(m));

// Computer keyboard
if(compKeys) compKeys.checked = true; // default ON
const downKeys = new Set();
function kd(e){
  const key = e.key?.toLowerCase?.();
  const n = key && KEYBOARD_MAP[key];
  if(!n) return;
  if(compKeys && !compKeys.checked) return;
  if(downKeys.has(n)) return;
  downKeys.add(n);
  e.preventDefault(); // keep focus here; avoid browser shortcuts
  handleNoteOn(n, 0.8);
}
function ku(e){
  const key = e.key?.toLowerCase?.();
  const n = key && KEYBOARD_MAP[key];
  if(!n) return;
  if(compKeys && !compKeys.checked) return;
  downKeys.delete(n);
  e.preventDefault();
  handleNoteOff(n);
}
window.addEventListener('keydown', kd, {passive:false});
window.addEventListener('keyup', ku, {passive:false});

// Controls
on(masterVolume, 'input', ()=>synth.setMasterVolume(parseFloat(masterVolume.value || '0.8')));
on(enableBloom, 'change', ()=>renderer.setBloom(!!enableBloom.checked));
on(enableTrails, 'change', ()=>renderer.setTrails(!!enableTrails.checked));
on(enableShadows, 'change', ()=>piano.setKeyShadows(!!enableShadows.checked));
on(enableExplosions, 'change', ()=>renderer.setExplosions(!!enableExplosions.checked));
on(explosionType, 'change', ()=>renderer.setExplosionType(explosionType.value));
on(particleBudget, 'input', ()=>renderer.setBudget(parseInt(particleBudget.value||'16000',10)));
on(themeSelect, 'change', ()=>{
  currentTheme = THEMES.find(t=>t.id===(themeSelect.value)) || THEMES[0];
  renderer.setTheme(currentTheme);
  document.documentElement.style.setProperty('--bg', currentTheme.bg);
});
on(reverbRoom, 'change', ()=>synth.setReverb(reverbRoom.value, parseFloat(reverbSize?.value||'1'), parseFloat(reverbMix?.value||'0.25')));
on(reverbSize, 'input', ()=>synth.setReverb(reverbRoom?.value||'studio', parseFloat(reverbSize.value||'1'), parseFloat(reverbMix?.value||'0.25')));
on(reverbMix, 'input', ()=>synth.setReverb(reverbRoom?.value||'studio', parseFloat(reverbSize?.value||'1'), parseFloat(reverbMix.value||'0.25')));
on(delayTime, 'input', ()=>synth.setDelay(parseFloat(delayTime.value||'320'), parseFloat(delayFeedback?.value||'0.35'), parseFloat(delayMix?.value||'0.22')));
on(delayFeedback, 'input', ()=>synth.setDelay(parseFloat(delayTime?.value||'320'), parseFloat(delayFeedback.value||'0.35'), parseFloat(delayMix?.value||'0.22')));
on(delayMix, 'input', ()=>synth.setDelay(parseFloat(delayTime?.value||'320'), parseFloat(delayFeedback?.value||'0.35'), parseFloat(delayMix.value||'0.22')));
on(labelMode, 'change', ()=>piano.setLabels(labelMode.value));
on(transposeSlider, 'input', ()=>{
  transpose = parseInt(transposeSlider.value||'0',10) || 0;
  saveTranspose(transpose);
  updateLaneAlignment();
});
on(pianoSound, 'change', ()=>synth.setPianoSound(pianoSound.value));

// Set piano sound selector to upright to match audio.js default
if(pianoSound) {
  pianoSound.value = 'upright';
}

// Initial FX
if(reverbRoom && reverbSize && reverbMix) synth.setReverb(reverbRoom.value, parseFloat(reverbSize.value||'1'), parseFloat(reverbMix.value||'0.25'));
if(delayTime && delayFeedback && delayMix) synth.setDelay(parseFloat(delayTime.value||'320'), parseFloat(delayFeedback.value||'0.35'), parseFloat(delayMix.value||'0.22'));
if(metronomeVol) synth.setMetronomeVolume(parseFloat(metronomeVol.value||'0.35'));

/* ---------- Metronome (audible + BPM UI, never recorded) ---------- */
let metronomeOn = false;

// Inject a compact BPM slider next to the readout if it doesn't exist.
let metronomeSlider = document.getElementById('metronome-bpm');
if(!metronomeSlider && bpmReadout && bpmReadout.parentElement){
  metronomeSlider = document.createElement('input');
  metronomeSlider.type = 'range';
  metronomeSlider.id = 'metronome-bpm';
  metronomeSlider.min = '40';
  metronomeSlider.max = '240';
  metronomeSlider.step = '1';
  metronomeSlider.value = '120';
  metronomeSlider.style.verticalAlign = 'middle';
  metronomeSlider.style.width = '120px';
  bpmReadout.parentElement.insertBefore(metronomeSlider, bpmReadout.nextSibling);
  const spacer = document.createTextNode(' ');
  bpmReadout.parentElement.insertBefore(spacer, metronomeSlider);
}

function updateBPMReadout(val){
  if(bpmReadout) bpmReadout.textContent = val ? String(Math.round(val)) : '—';
}
updateBPMReadout(parseInt(metronomeSlider?.value||'120',10));

on(metronomeBtn, 'click', ()=>{
  metronomeOn = !metronomeOn;
  if(metronomeBtn) metronomeBtn.style.color = metronomeOn ? 'var(--ok)' : '';
  synth.setMetronome(metronomeOn);
  const bpm = parseInt(metronomeSlider?.value||'120',10);
  if(metronomeOn) synth.setMetronomeBPM(bpm);
  updateBPMReadout(bpm);
});

if(metronomeSlider){
  metronomeSlider.addEventListener('input', ()=>{
    const bpm = metronomeSlider.valueAsNumber || 120;
    if(metronomeOn) synth.setMetronomeBPM(bpm);
    updateBPMReadout(bpm);
  });
}
on(metronomeVol, 'input', ()=>synth.setMetronomeVolume(parseFloat(metronomeVol.value||'0.35')));

// Record/Play/Loop/Stop
on(recordBtn, 'click', ()=>{
  if(!timeline.recording){
    recordBtn?.classList.add('recording');
    timeline.recordStart();
  } else {
    recordBtn?.classList.remove('recording');
    timeline.recordStop();
  }
});
on(playBtn, 'click', ()=>{
  if(!timeline.events.length) timeline.loadSaved();
  
  // Calculate fall time based on gravity (matching renderer physics)
  const fallTime = 1.2; // seconds for notes to fall from top to bottom
  
  // Pre-schedule visual notes for playback
  const schedulePlaybackNotes = () => {
    const events = timeline.events;
    const startTime = performance.now();
    
    // Schedule all visual notes ahead of time
    for(const event of events) {
      if(event.type === 'noteon') {
        // Schedule visual note to start falling before it should sound
        setTimeout(() => {
          const note = transposed(event.note);
          if(note == null) return;
          
          // Only show visual, don't play sound yet
          const key = piano.keys.get(note);
          if(key){
            renderer.noteOnPlayback(note, event.vel, fallTime * 1000);
            piano.press(note);
            piano.trailBegin(note, renderer.colorFor(note, event.vel));
          }
        }, Math.max(0, event.t - fallTime * 1000));
      } else if(event.type === 'noteoff') {
        // Schedule note off at the original time
        setTimeout(() => {
          const note = transposed(event.note);
          if(note == null) return;
          renderer.noteOff(note);
          piano.release(note);
          piano.trailEnd(note);
        }, event.t);
      }
    }
  };
  
  // Schedule visual notes
  schedulePlaybackNotes();
  
  // Handle audio playback at the correct times
  timeline.onEvent((type, payload)=>{
    if(type==='noteon') {
      const note = transposed(payload.note);
      if(note != null) {
        synth.noteOn(note, payload.velocity);
      }
    }
    else if(type==='noteoff') {
      const note = transposed(payload.note);
      if(note != null) {
        synth.noteOff(note);
      }
    }
  });
  
  timeline.play();
});
on(loopBtn, 'click', ()=>{
  timeline.setLoop(!timeline.loop);
  if(loopBtn) loopBtn.textContent = timeline.loop ? '⟲ Loop On' : '⟲ Loop Off';
});
on(stopBtn, 'click', ()=>{
  if(timeline.recording){ recordBtn?.classList.remove('recording'); timeline.recordStop(); }
  timeline.stop();
  synth.stopAll();
});

// Export/Import
on(exportBtn, 'click', ()=>timeline.export());
on(importInput, 'change', async ()=>{
  const file = importInput.files?.[0];
  if(!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    timeline.import(data);
    alert('Imported recording.');
  } catch(e){
    alert('Failed to import: '+e.message);
  }
});
on(clearRecs, 'click', ()=>{
  localStorage.removeItem('starlight:recording');
  alert('Cleared saved recordings.');
});

// Keep lanes synced after initial render
setTimeout(updateLaneAlignment, 450);

// Per-key trail loop
function tickTrails(){
  if(piano.keys){
    for(const [m, k] of piano.keys){
      if(k.trailState){
        piano.trailUpdate(m, synth.sustainPedal);
      }
    }
  }
  requestAnimationFrame(tickTrails);
}
tickTrails();

/* ------------ Settings: ensure Key Glow toggle exists ---------------- */
(function ensureKeyGlowControl(){
  let toggle = document.getElementById('enable-key-glow');
  if(!toggle){
    const panel = document.getElementById('settings-panel');
    const visuals = panel?.querySelector('section');
    if(visuals){
      const label = document.createElement('label');
      label.innerHTML = '<input type="checkbox" id="enable-key-glow" /> Glow on keys';
      visuals.appendChild(label);
      toggle = label.querySelector('input');
    }
  }
  if(toggle){
    toggle.checked = false;
    piano.setKeyGlow(false);
    toggle.addEventListener('change', ()=>piano.setKeyGlow(toggle.checked));
  }
})();
