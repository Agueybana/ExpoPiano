// audio.js – Sample-based piano + FX + fixed metronome (revised)

export class Synth {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
    this.masterGain.gain.value = 0.8;

    this.buffers = new Map();
    this.activeVoices = new Map();
    this.sustainPedal = false;

    // FX chain
    this.convolver = this.ctx.createConvolver();
    this.reverbGain = this.ctx.createGain();
    this.delayNode = this.ctx.createDelay(5.0);
    this.delayGain = this.ctx.createGain();
    this.delayFeedback = this.ctx.createGain();
    this.convolver.connect(this.reverbGain).connect(this.masterGain);
    this.delayNode.connect(this.delayGain).connect(this.masterGain);
    this.delayNode.connect(this.delayFeedback).connect(this.delayNode);

    // Metronome (scheduler)
    this.metroGain = this.ctx.createGain();
    this.metroGain.connect(this.masterGain);
    this.metroGain.gain.value = 0.35;

    this._metroOn = false;
    this._metroBpm = 120;
    this._metroInterval = null;
    this._metroNext = 0;
    this._metroLookaheadMs = 25;
    this._metroScheduleHorizon = 0.1;

    this.loadSamples();
    this.loadImpulse('medium-room');
  }

  async loadSamples() {
    const notes = [21,24,27,30,33,36,39,42,45,48,51,54,57,60,63,66,69,72,75,78,81,84,87,90,93,96,99,102,105,108];
    for (let midi of notes) {
      try{
        const url = `samples/${midi}.mp3`;
        const buf = await fetch(url).then(r => r.arrayBuffer()).then(b => this.ctx.decodeAudioData(b));
        this.buffers.set(midi, buf);
      }catch(_){}
    }
  }

  async loadImpulse(name) {
    try{
      const url = `impulses/${name}.wav`;
      const buf = await fetch(url).then(r => r.arrayBuffer()).then(b => this.ctx.decodeAudioData(b));
      this.convolver.buffer = buf;
    }catch(_){}
  }

  noteOn(midi, velocity) {
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const nearest = this.findNearestSample(midi);
    const buf = this.buffers.get(nearest);
    if (!buf) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, (midi - nearest) / 12);

    const gain = this.ctx.createGain();

    const noteRange = (midi - 21) / (108 - 21);
    const volumeCurve = 1 - (noteRange * 0.4);
    const finalVelocity = velocity * volumeCurve;

    gain.gain.value = finalVelocity;

    src.connect(gain);
    gain.connect(this.masterGain);
    gain.connect(this.convolver);
    gain.connect(this.delayNode);

    src.start();
    this.activeVoices.set(midi, {src, gain});
  }

  noteOff(midi) {
    if (this.sustainPedal) return;
    const v = this.activeVoices.get(midi);
    if (v) {
      v.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      v.gain.gain.setValueAtTime(v.gain.gain.value, this.ctx.currentTime);
      v.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.5);
      v.src.stop(this.ctx.currentTime + 0.5);
      this.activeVoices.delete(midi);
    }
  }

  stopAll() {
    for (let [midi, v] of this.activeVoices) {
      v.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      v.gain.gain.setValueAtTime(v.gain.gain.value, this.ctx.currentTime);
      v.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.05);
      v.src.stop(this.ctx.currentTime + 0.05);
    }
    this.activeVoices.clear();
  }

  findNearestSample(midi) {
    let nearest = 21;
    let minDiff = Infinity;
    for (let note of this.buffers.keys()) {
      let diff = Math.abs(note - midi);
      if (diff < minDiff) { minDiff = diff; nearest = note; }
    }
    return nearest;
  }

  setMasterVolume(v) { this.masterGain.gain.value = v; }
  setSustain(on) { this.sustainPedal = on; }
  setReverb(room, _size, mix) {
    this.loadImpulse(room);
    this.reverbGain.gain.value = mix;
  }
  setDelay(timeMs, feedback, mix) {
    this.delayNode.delayTime.value = Math.max(0, Math.min(5, (timeMs||320)/1000));
    this.delayFeedback.gain.value = feedback;
    this.delayGain.gain.value = mix;
  }

  // Metronome
  setMetronome(on){
    this._metroOn = !!on;
    if(!on){
      if(this._metroInterval) clearInterval(this._metroInterval);
      this._metroInterval = null;
    }else{
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if(!this._metroInterval){
        this._metroNext = this.ctx.currentTime + 0.05;
        this._metroInterval = setInterval(()=>this._scheduleMetronome(), this._metroLookaheadMs);
      }
    }
  }
  setMetronomeBPM(bpm){
    const val = Math.max(20, Math.min(300, bpm||120));
    this._metroBpm = val;
  }
  setMetronomeVolume(v){ this.metroGain.gain.value = v; }

  _scheduleMetronome(){
    if(!this._metroOn) return;
    const now = this.ctx.currentTime;
    const interval = 60 / (this._metroBpm || 120);
    while(this._metroNext < now + this._metroScheduleHorizon){
      this._clickAt(this._metroNext);
      this._metroNext += interval;
    }
  }
  _clickAt(t){
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(1000, t);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    osc.connect(g).connect(this.metroGain);
    osc.start(t);
    osc.stop(t + 0.1);
  }
}
