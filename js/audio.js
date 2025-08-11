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
    
    // Support for multiple piano sample sets
    this.currentPianoSet = 'upright';
    this.pianoSets = {
      modern: new Map(),
      classic: new Map(),
      upright: new Map()
    };
    
    // Mapping for classic piano OGG files
    this.classicFileMap = this.createClassicFileMap();
    
    // Mapping for upright piano AIFF files
    this.uprightFileMap = this.createUprightFileMap();

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

  createClassicFileMap() {
    // Map classic piano samples based on their actual note names
    // Only natural notes (white keys) are available, black keys will use pitch-shifting
    const noteToMidi = {
      'a0': 21, 'b0': 23,
      'c1': 24, 'd1': 26, 'e1': 28, 'f1': 29, 'g1': 31, 'a1': 33, 'b1': 35,
      'c2': 36, 'd2': 38, 'e2': 40, 'f2': 41, 'g2': 43, 'a2': 45, 'b2': 47,
      'c3': 48, 'd3': 50, 'e3': 52, 'f3': 53, 'g3': 55, 'a3': 57, 'b3': 59,
      'c4': 60, 'd4': 62, 'e4': 64, 'f4': 65, 'g4': 67, 'a4': 69, 'b4': 71,
      'c5': 72, 'd5': 74, 'e5': 76, 'f5': 77, 'g5': 79, 'a5': 81, 'b5': 83,
      'c6': 84, 'd6': 86, 'e6': 88, 'f6': 89, 'g6': 91, 'a6': 93, 'b6': 95,
      'c7': 96, 'd7': 98, 'e7': 100, 'f7': 101, 'g7': 103, 'a7': 105, 'b7': 107,
      'c8': 108
    };
    
    // Choose the best available file for each note (some have duplicates)
    const fileMapping = {
      'a0': '448573__tedagame__a0.ogg',
      'b0': '448565__tedagame__b0.ogg',
      'c1': '448540__tedagame__c1.ogg',
      'd1': '448606__tedagame__d1.ogg',
      'e1': '448616__tedagame__e1.ogg',
      'f1': '448581__tedagame__f1.ogg',
      'g1': '448557__tedagame__g1.ogg',
      'a1': '448572__tedagame__a1.ogg',
      'b1': '448564__tedagame__b1.ogg',
      'c2': '448541__tedagame__c2.ogg',
      'd2': '448600__tedagame__d2.ogg',
      'e2': '448615__tedagame__e2.ogg',
      'f2': '448587__tedagame__f2.ogg',
      'g2': '448558__tedagame__g2.ogg',
      'a2': '448563__tedagame__a2.ogg',
      'b2': '448569__tedagame__b2.ogg',
      'c3': '448538__tedagame__c3.ogg',
      'd3': '448601__tedagame__d3.ogg',
      'e3': '448614__tedagame__e3.ogg',
      'f3': '448584__tedagame__f3.ogg',
      'g3': '448559__tedagame__g3.ogg',
      'a3': '448562__tedagame__a3.ogg',
      'b3': '448568__tedagame__b3.ogg',
      'c4': '448539__tedagame__c4.ogg',
      'd4': '448602__tedagame__d4.ogg',
      'e4': '448613__tedagame__e4.ogg',
      'f4': '448585__tedagame__f4.ogg',
      'g4': '448552__tedagame__g4.ogg',
      'a4': '448561__tedagame__a4.ogg',
      'b4': '448536__tedagame__b4.ogg',
      'c5': '448532__tedagame__c5.ogg',
      'd5': '448603__tedagame__d5.ogg',
      'e5': '448612__tedagame__e5.ogg',
      'f5': '448582__tedagame__f5.ogg',
      'g5': '448553__tedagame__g5.ogg',
      'a5': '448560__tedagame__a5.ogg',
      'b5': '448537__tedagame__b5.ogg',
      'c6': '448533__tedagame__c6.ogg',
      'd6': '448604__tedagame__d6.ogg',
      'e6': '448611__tedagame__e6.ogg',
      'f6': '448583__tedagame__f6.ogg',
      'g6': '448554__tedagame__g6.ogg',
      'a6': '448567__tedagame__a6.ogg',
      'b6': '448534__tedagame__b6.ogg',
      'c7': '448545__tedagame__c7.ogg',
      'd7': '448605__tedagame__d7.ogg',
      'e7': '448610__tedagame__e7.ogg',
      'f7': '448580__tedagame__f7.ogg',
      'g7': '448555__tedagame__g7.ogg',
      'a7': '448566__tedagame__a7.ogg',
      'b7': '448535__tedagame__b7.ogg',
      'c8': '448543__tedagame__c8.ogg'
    };
    
    // Create MIDI to filename map for all available natural notes
    const midiToFile = new Map();
    for (const [note, midi] of Object.entries(noteToMidi)) {
      if (fileMapping[note]) {
        midiToFile.set(midi, fileMapping[note]);
      }
    }
    
    return midiToFile;
  }

  createUprightFileMap() {
    // Map upright piano samples - includes ALL 88 keys (with sharps/flats)
    // Note: -1 octave in filenames corresponds to MIDI octave -1
    const midiToFile = new Map();
    
    // Parse the upright sample filenames and map to MIDI notes
    // Format: number-note+octave (e.g., 09-a-1 is A-1, which is MIDI 9)
    const files = {
      // Octave -1
      9: '277101__beskhu__09-a-1.aiff',  // A-1 (MIDI 9)
      10: '277100__beskhu__10-a-1.aiff', // A#-1 (MIDI 10)
      11: '277099__beskhu__11-b-1.aiff', // B-1 (MIDI 11)
      
      // Octave 0
      12: '277098__beskhu__12-c0.aiff',  // C0 (MIDI 12)
      13: '277105__beskhu__13-c0.aiff',  // C#0 (MIDI 13)
      14: '277104__beskhu__14-d0.aiff',  // D0 (MIDI 14)
      15: '277103__beskhu__15-d0.aiff',  // D#0 (MIDI 15)
      16: '277102__beskhu__16-e0.aiff',  // E0 (MIDI 16)
      17: '277107__beskhu__17-f0.aiff',  // F0 (MIDI 17)
      18: '277106__beskhu__18-f0.aiff',  // F#0 (MIDI 18)
      19: '277091__beskhu__19-g0.aiff',  // G0 (MIDI 19)
      20: '277090__beskhu__20-g0.aiff',  // G#0 (MIDI 20)
      
      // A0 to C8 (MIDI 21-108)
      21: '277089__beskhu__21-a0.aiff',  // A0
      22: '277088__beskhu__22-a0.aiff',  // A#0
      23: '277095__beskhu__23-b0.aiff',  // B0
      24: '277094__beskhu__24-c1.aiff',  // C1
      25: '277093__beskhu__25-c1.aiff',  // C#1
      26: '277092__beskhu__26-d1.aiff',  // D1
      27: '277097__beskhu__27-d1.aiff',  // D#1
      28: '277096__beskhu__28-e1.aiff',  // E1
      29: '277064__beskhu__29-f1.aiff',  // F1
      30: '277065__beskhu__30-f1.aiff',  // F#1
      31: '277062__beskhu__31-g1.aiff',  // G1
      32: '277063__beskhu__32-g1.aiff',  // G#1
      33: '277068__beskhu__33-a1.aiff',  // A1
      34: '277069__beskhu__34-a1.aiff',  // A#1
      35: '277066__beskhu__35-b1.aiff',  // B1
      36: '277067__beskhu__36-c2.aiff',  // C2
      37: '277060__beskhu__37-c2.aiff',  // C#2
      38: '277061__beskhu__38-d2.aiff',  // D2
      39: '277073__beskhu__39-d2.aiff',  // D#2
      40: '277072__beskhu__40-e2.aiff',  // E2
      41: '277075__beskhu__41-f2.aiff',  // F2
      42: '277074__beskhu__42-f2.aiff',  // F#2
      43: '277077__beskhu__43-g2.aiff',  // G2
      44: '277076__beskhu__44-g2.aiff',  // G#2
      45: '277079__beskhu__45-a2.aiff',  // A2
      46: '277078__beskhu__46-a2.aiff',  // A#2
      47: '277071__beskhu__47-b2.aiff',  // B2
      48: '277070__beskhu__48-c3.aiff',  // C3
      49: '277128__beskhu__49-c3.aiff',  // C#3
      50: '277129__beskhu__50-d3.aiff',  // D3
      51: '277130__beskhu__51-d3.aiff',  // D#3
      52: '277131__beskhu__52-e3.aiff',  // E3
      53: '277132__beskhu__53-f3.aiff',  // F3
      54: '277133__beskhu__54-f3.aiff',  // F#3
      55: '277134__beskhu__55-g3.aiff',  // G3
      56: '277135__beskhu__56-g3.aiff',  // G#3
      57: '277136__beskhu__57-a3.aiff',  // A3
      58: '277137__beskhu__58-a3.aiff',  // A#3
      59: '277147__beskhu__59-b3.aiff',  // B3
      60: '277146__beskhu__60-c4.aiff',  // C4 (Middle C)
      61: '277145__beskhu__61-c4.aiff',  // C#4
      62: '277144__beskhu__62-d4.aiff',  // D4
      63: '277143__beskhu__63-d4.aiff',  // D#4
      64: '277142__beskhu__64-e4.aiff',  // E4
      65: '277141__beskhu__65-f4.aiff',  // F4
      66: '277140__beskhu__66-f4.aiff',  // F#4
      67: '277139__beskhu__67-g4.aiff',  // G4
      68: '277138__beskhu__68-g4.aiff',  // G#4
      69: '277114__beskhu__69-a4.aiff',  // A4
      70: '277115__beskhu__70-a4.aiff',  // A#4
      71: '277112__beskhu__71-b4.aiff',  // B4
      72: '277113__beskhu__72-c5.aiff',  // C5
      73: '277110__beskhu__73-c5.aiff',  // C#5
      74: '277111__beskhu__74-d5.aiff',  // D5
      75: '277108__beskhu__75-d5.aiff',  // D#5
      76: '277109__beskhu__76-e5.aiff',  // E5
      77: '277116__beskhu__77-f5.aiff',  // F5
      78: '277117__beskhu__78-f5.aiff',  // F#5
      79: '277123__beskhu__79-g5.aiff',  // G5
      80: '277122__beskhu__80-g5.aiff',  // G#5
      81: '277125__beskhu__81-a5.aiff',  // A5
      82: '277124__beskhu__82-a5.aiff',  // A#5
      83: '277119__beskhu__83-b5.aiff',  // B5
      84: '277118__beskhu__84-c6.aiff',  // C6
      85: '277121__beskhu__85-c6.aiff',  // C#6
      86: '277120__beskhu__86-d6.aiff',  // D6
      87: '277127__beskhu__87-d6.aiff',  // D#6
      88: '277126__beskhu__88-e6.aiff',  // E6
      89: '277084__beskhu__89-f6.aiff',  // F6
      90: '277085__beskhu__90-f6.aiff',  // F#6
      91: '277086__beskhu__91-g6.aiff',  // G6
      92: '277087__beskhu__92-g6.aiff',  // G#6
      93: '277080__beskhu__93-a6.aiff',  // A6
      94: '277081__beskhu__94-a6.aiff',  // A#6
      95: '277082__beskhu__95-b6.aiff',  // B6
      96: '277083__beskhu__96-c7.aiff',  // C7
    };
    
    // Map only the standard 88 piano keys (A0/MIDI 21 to C8/MIDI 108)
    for (let midi = 21; midi <= 96; midi++) {
      if (files[midi]) {
        midiToFile.set(midi, files[midi]);
      }
    }
    
    return midiToFile;
  }

  async loadSamples() {
    const modernNotes = [21,24,27,30,33,36,39,42,45,48,51,54,57,60,63,66,69,72,75,78,81,84,87,90,93,96,99,102,105,108];
    
    // Load modern piano samples (MP3)
    for (let midi of modernNotes) {
      try{
        const url = `samples/${midi}.mp3`;
        const buf = await fetch(url).then(r => r.arrayBuffer()).then(b => this.ctx.decodeAudioData(b));
        this.pianoSets.modern.set(midi, buf);
      }catch(_){}
    }
    
    // Load classic piano samples (OGG) - load ALL available samples for better accuracy
    for (const [midi, filename] of this.classicFileMap.entries()) {
      try{
        const url = `samples-classic/${filename}`;
        const buf = await fetch(url).then(r => r.arrayBuffer()).then(b => this.ctx.decodeAudioData(b));
        this.pianoSets.classic.set(midi, buf);
      }catch(_){}
    }
    
    // Load upright piano samples (AIFF) - includes all 88 keys with sharps/flats
    for (const [midi, filename] of this.uprightFileMap.entries()) {
      try{
        const url = `samples-upright/${filename}`;
        const buf = await fetch(url).then(r => r.arrayBuffer()).then(b => this.ctx.decodeAudioData(b));
        this.pianoSets.upright.set(midi, buf);
      }catch(_){}
    }
    
    // Set initial buffers to upright as per user request
    this.buffers = this.pianoSets.upright;
    this.currentPianoSet = 'upright';
  }
  
  setPianoSound(setName) {
    if (this.pianoSets[setName]) {
      this.currentPianoSet = setName;
      this.buffers = this.pianoSets[setName];
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
    // First check if we have an exact match
    if (this.buffers.has(midi)) {
      return midi;
    }
    
    // For classic piano with only natural notes, handle black keys intelligently
    if (this.currentPianoSet === 'classic') {
      const pitchClass = midi % 12;
      const isBlackKey = [1, 3, 6, 8, 10].includes(pitchClass);
      
      if (isBlackKey) {
        // For black keys, prefer the white key below to avoid similar sounds
        // This makes C# use C (not D), D# use D (not E), etc.
        const lowerNote = midi - 1;
        if (this.buffers.has(lowerNote)) {
          return lowerNote;
        }
      }
    }
    
    // Find the closest available sample
    let nearest = 21;
    let minDiff = Infinity;
    
    for (let note of this.buffers.keys()) {
      let diff = Math.abs(note - midi);
      if (diff < minDiff) { 
        minDiff = diff; 
        nearest = note; 
      }
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
