// midi.js (dropdown-first UX; no separate "Grant MIDI" button)
// Emits: 'inputs-changed', 'input-selected', 'noteon', 'noteoff', 'sustain'
import {Emitter, now} from './utils.js';

export class MIDIManager extends Emitter {
  constructor(){
    super();
    this.midi = null;
    this.inputs = [];
    this.currentInput = null;
    this.sustain = false;
    this._accessRequested = false;
  }

  async requestAccess(){
    if(this._accessRequested) return !!this.midi;
    this._accessRequested = true;

    if(!navigator.requestMIDIAccess){
      console.warn('WebMIDI not supported in this browser.');
      this.emit('midi-unsupported');
      return false;
    }
    try {
      this.midi = await navigator.requestMIDIAccess({ sysex: false });
      this.midi.onstatechange = () => this.refreshInputs();
      this.refreshInputs();
      return true;
    } catch (err){
      console.error('MIDI access denied/unavailable:', err);
      return false;
    }
  }

  init(){
    // No-op: permission will be requested when user clicks the Input dropdown
    this.refreshInputs(); // emit empty list so UI shows request row
  }

  refreshInputs(){
    this.inputs = [];
    if(!this.midi){
      this.emit('inputs-changed', this.inputs);
      return;
    }
    for(const input of this.midi.inputs.values()){
      this.inputs.push(input);
    }
    this.inputs.sort((a,b)=>
      (a.manufacturer||'').localeCompare(b.manufacturer||'') ||
      (a.name||'').localeCompare(b.name||'')
    );
    this.emit('inputs-changed', this.inputs);

    if(this.inputs.length){
      if(!this.currentInput || !this.inputs.find(i=>i.id===this.currentInput.id)){
        this.setInput(this.inputs[0].id);
      }
    } else {
      this.setInput(null);
    }
  }

  setInput(id){
    if(this.currentInput) this.currentInput.onmidimessage = null;
    this.currentInput = id ? this.inputs.find(i=>i.id===id) || null : null;
    if(this.currentInput){
      this.currentInput.onmidimessage = (e)=>this._onMIDIMessage(e);
      this.emit('input-selected', this.currentInput);
    } else {
      this.emit('input-selected', null);
    }
  }

  _onMIDIMessage(e){
    const [status, data1, data2] = e.data;
    const cmd = status >> 4;
    const ch = status & 0xf;
    const t = now();
    switch(cmd){
      case 9: // note on
        if(data2===0){ this.emit('noteoff', {note:data1, velocity:0, ch, t}); }
        else { this.emit('noteon', {note:data1, velocity:data2/127, ch, t}); }
        break;
      case 8: // note off
        this.emit('noteoff', {note:data1, velocity:data2/127, ch, t});
        break;
      case 11: // CC
        this._handleCC(data1, data2, ch, t);
        break;
      default:
        break;
    }
  }

  _handleCC(cc, value, ch, t){
    if(cc===64){ // sustain
      const on = value>=64;
      this.sustain = on;
      this.emit('sustain', {on, ch, t});
    }
  }
}
