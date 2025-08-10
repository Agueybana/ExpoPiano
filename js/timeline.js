// timeline.js (revised: reliable stop, RAF cancellation, loop playback, utility helpers)
import {saveJSON} from './utils.js';

export class Timeline {
  constructor(){
    this.events = []; // {t, type:'noteon'|'noteoff'|'cc', note, vel, cc, val}
    this.startTime = 0;
    this.recording = false;
    this.playing = false;
    this.playhead = 0;
    this.loop = false;
    this.length = 0;
    this._onEvent = ()=>{};
    this._raf = null;
    this._queuedStop = false;
    this._pausedAt = 0;
  }

  // Consumer registers a callback to receive events during playback.
  onEvent(fn){ this._onEvent = fn; }

  // --- Recording ------------------------------------------------------------

  recordStart(){
    this.events = [];
    this.startTime = performance.now();
    this.recording = true;
    this.length = 0;
  }

  recordStop(){
    this.recording = false;
    if(this.events.length){
      this.length = this.events[this.events.length-1].t;
      localStorage.setItem('starlight:recording', JSON.stringify(this.events));
    }
  }

  emit(type, payload){
    if(!this.recording) return;
    const t = performance.now() - this.startTime;
    if(type==='noteon'){
      this.events.push({t, type, note: payload.note, vel: payload.velocity});
    } else if(type==='noteoff'){
      this.events.push({t, type, note: payload.note});
    } else if(type==='cc'){
      this.events.push({t, type, cc: payload.cc, val: payload.value});
    }
  }

  loadSaved(){
    const s = localStorage.getItem('starlight:recording');
    if(!s) return false;
    try { 
      this.events = JSON.parse(s); 
      this.length = this.events.length ? this.events[this.events.length-1].t : 0; 
      return true; 
    } catch(e){ 
      return false; 
    }
  }

  export(){ saveJSON('starlight-recording.json', this.events); }
  import(json){ this.events = json; this.length = this.events.length ? this.events[this.events.length-1].t : 0; }
  clear(){ this.events = []; this.length = 0; }
  isEmpty(){ return this.events.length===0; }
  getDuration(){ return this.length; }
  setLoop(on){ this.loop = !!on; }

  // --- Playback -------------------------------------------------------------

  play(){
    if(!this.events.length) return;
    this.stop(); // ensure previous schedule cleared
    this.playing = true;
    this._queuedStop = false;
    this._schedule(0);
  }

  stop(){
    this.playing = false;
    this._queuedStop = true;
    this._pausedAt = 0;
    if(this._raf){ cancelAnimationFrame(this._raf); this._raf = null; }
  }

  pause(){
    if(!this.playing) return;
    this._queuedStop = true;
    if(this._raf){ cancelAnimationFrame(this._raf); this._raf = null; }
    this.playing = false;
    this._pausedAt = this.playhead;
  }

  resume(){
    if(this.playing || !this.events.length) return;
    const offset = this._pausedAt || 0;
    this.playing = true;
    this._queuedStop = false;
    this._schedule(offset);
  }

  _schedule(offset){
    if(!this.playing) return;
    const start = performance.now() - offset;
    let idx = this._findIndexAt(offset);
    const tick = ()=>{
      if(this._queuedStop){ this._raf = null; return; }
      const now = performance.now();
      const t = now - start;
      this.playhead = t;
      while(idx < this.events.length && this.events[idx].t <= t){
        const ev = this.events[idx++];
        if(ev.type==='noteon') this._onEvent('noteon', {note: ev.note, velocity: ev.vel});
        else if(ev.type==='noteoff') this._onEvent('noteoff', {note: ev.note});
        else if(ev.type==='cc') this._onEvent('cc', {cc: ev.cc, value: ev.val});
      }
      if(idx < this.events.length){
        this._raf = requestAnimationFrame(tick);
      } else {
        this.playing = false;
        this.playhead = this.length;
        if(this.loop && !this._queuedStop){
          this._schedule(0); // restart from beginning
          this.playing = true;
        }
      }
    };
    this._raf = requestAnimationFrame(tick);
  }

  _findIndexAt(tMs){
    let lo = 0, hi = this.events.length;
    while(lo < hi){
      const mid = (lo+hi)>>1;
      if(this.events[mid].t < tMs) lo = mid+1; else hi = mid;
    }
    return lo;
  }
}
