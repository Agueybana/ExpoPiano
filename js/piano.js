// piano.js (revised)
// - Realistic layout with absolute black-key placement.
// - Fixed: black layer no longer blocks clicks on white keys.
// - Supports mouse/touch swipe-gliss.
// - Key glow trails fade out; can be toggled by Settings.

import {midiToNote} from './utils.js';

export class PianoUI {
  constructor(rootEl){
    this.root = rootEl;
    this.keys = new Map();
    this.labelMode = 'notes';
    this.enableKeyShadows = true;
    this.keyGlowEnabled = true;

    this.whiteLayer = document.createElement('div');
    this.whiteLayer.className = 'white-keys';
    this.blackLayer = document.createElement('div');
    this.blackLayer.className = 'black-keys';
    Object.assign(this.blackLayer.style, {
      position: 'absolute', inset: '0 0 0 0', display: 'block',
      /* IMPORTANT: the container does not catch events anymore */
      pointerEvents: 'none'
    });

    this.root.appendChild(this.whiteLayer);
    this.root.appendChild(this.blackLayer);

    this._build();

    this._layout = this._layout.bind(this);
    this.resizeObserver = new ResizeObserver(this._layout);
    this.resizeObserver.observe(this.root);

    this._drag = {active:false, pointerId:null, lastMidi:null};
    this._wireSwipe();
  }

  _build(){
    const isBlack = (m) => [1,3,6,8,10].includes(m%12);

    // Whites
    for(let m=21; m<=108; m++){
      if(isBlack(m)) continue;
      const el = document.createElement('div');
      el.className = 'key';
      el.dataset.midi = m;

      const label = document.createElement('span'); label.className = 'label';
      const trail = document.createElement('canvas'); trail.className = 'trail';
      const ctx = trail.getContext('2d');

      el.appendChild(label); el.appendChild(trail);
      this.whiteLayer.appendChild(el);

      const noteName = midiToNote(m);
      this.keys.set(m, { el, label, trail, trailCtx: ctx, noteName, trailState: null });
    }

    // Blacks (absolute; their individual nodes catch events)
    for(let m=21; m<=108; m++){
      if(!isBlack(m)) continue;
      const el = document.createElement('div');
      el.className = 'key black';
      el.dataset.midi = m;
      el.style.pointerEvents = 'auto';

      const label = document.createElement('span'); label.className = 'label';
      const trail = document.createElement('canvas'); trail.className = 'trail';
      const ctx = trail.getContext('2d');

      el.appendChild(label); el.appendChild(trail);
      this.blackLayer.appendChild(el);

      const noteName = midiToNote(m);
      this.keys.set(m, { el, label, trail, trailCtx: ctx, noteName, trailState: null });
    }

    this._updateLabels();
    setTimeout(this._layout, 60);
  }

  _layout(){
    const whites = Array.from(this.keys.keys()).filter(m=>![1,3,6,8,10].includes(m%12)).sort((a,b)=>a-b);
    const blacks = Array.from(this.keys.keys()).filter(m=>[1,3,6,8,10].includes(m%12)).sort((a,b)=>a-b);

    const rect = this.root.getBoundingClientRect();
    const W = Math.max(1, Math.floor(rect.width));
    const H = Math.max(1, Math.floor(rect.height));
    const whiteCount = whites.length;
    const whiteW = W / whiteCount;

    // Resize white trails to fit
    for(let i=0;i<whiteCount;i++){
      const m = whites[i];
      const k = this.keys.get(m);
      const r = k.el.getBoundingClientRect();
      const w = Math.max(4, Math.floor(r.width));
      const h = Math.max(20, Math.floor(H * 0.58));
      if(k.trail.width !== w || k.trail.height !== h){
        k.trail.width = w;
        k.trail.height = h;
        k.trailCtx.clearRect(0,0,w,h);
      }
    }

    // Build semitone coordinates for equal 12-step spacing (A0 left)
    const stepFrom = { 'A':2, 'B':1, 'C':2, 'D':2, 'E':1, 'F':2, 'G':2 };
    const whiteLeftX = [];
    const whiteLeftS = [];
    let S = 0;
    for(let i=0;i<whiteCount;i++){
      const m = whites[i];
      const letter = this.keys.get(m).noteName[0];
      whiteLeftX[i] = i * whiteW;
      whiteLeftS[i] = S;
      S += stepFrom[letter];
    }
    whiteLeftX[whiteCount] = W;
    whiteLeftS[whiteCount] = S;

    const leftmostWhiteMidi = whites[0];
    const blackW = whiteW * 0.6;
    const blackH = Math.round(H * 0.60);

    for(const m of blacks){
      const k = this.keys.get(m);
      const Scenter = (m - leftmostWhiteMidi) + 0.5;
      let i = 0;
      while(i < whiteCount && !(whiteLeftS[i] <= Scenter && Scenter < whiteLeftS[i+1])) i++;
      if(i >= whiteCount) i = whiteCount - 1;

      const S0 = whiteLeftS[i]; const S1 = whiteLeftS[i+1];
      const p = (Scenter - S0) / ((S1 - S0) || 1);

      const xCenter = whiteLeftX[i] + p * whiteW;
      const left = Math.round(xCenter - blackW/2);

      Object.assign(k.el.style, {
        position: 'absolute',
        left: left + 'px',
        width: Math.round(blackW) + 'px',
        height: Math.round(blackH) + 'px',
        top: '0px',
        pointerEvents: 'auto'
      });

      const r = k.el.getBoundingClientRect();
      const w = Math.max(4, Math.floor(r.width));
      const h = Math.max(10, Math.floor(H * 0.42));
      if(k.trail.width !== w || k.trail.height !== h){
        k.trail.width = w; k.trail.height = h; k.trailCtx.clearRect(0,0,w,h);
      }
    }

    this._updateLabels();
  }

  _wireSwipe(){
    const keyFromTarget = (t)=>{
      if(!t) return null;
      if(t.classList?.contains('key')) return t;
      if(t.closest) return t.closest('.key');
      return null;
    };

    const pressKey = (m)=>this.emit('pointerdown', m);
    const releaseKey = (m)=>this.emit('pointerup', m);

    this.root.addEventListener('pointerdown', (e)=>{
      if(e.button !== 0 && e.pointerType !== 'touch') return;
      const el = keyFromTarget(e.target); if(!el) return;
      const midi = parseInt(el.dataset.midi,10);
      this._drag = {active:true, pointerId:e.pointerId, lastMidi:midi};
      this.root.setPointerCapture?.(e.pointerId);
      pressKey(midi);
    });

    this.root.addEventListener('pointermove', (e)=>{
      if(!this._drag.active || e.pointerId !== this._drag.pointerId) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const keyEl = keyFromTarget(el); if(!keyEl) return;
      const midi = parseInt(keyEl.dataset.midi,10);
      if(midi !== this._drag.lastMidi){
        if(this._drag.lastMidi != null) releaseKey(this._drag.lastMidi);
        this._drag.lastMidi = midi;
        pressKey(midi);
      }
    });

    const endDrag = (e)=>{
      if(!this._drag.active || e.pointerId !== this._drag.pointerId) return;
      if(this._drag.lastMidi != null) releaseKey(this._drag.lastMidi);
      this._drag = {active:false, pointerId:null, lastMidi:null};
    };
    this.root.addEventListener('pointerup', endDrag);
    this.root.addEventListener('pointercancel', endDrag);
    this.root.addEventListener('pointerleave', (e)=>{
      if(!this._drag.active) return;
      if(this._drag.lastMidi != null) releaseKey(this._drag.lastMidi);
      this._drag = {active:false, pointerId:null, lastMidi:null};
    });

    // Per-key simple taps as well
    for(const k of this.keys.values()){
      const down = (ev)=>{ ev.preventDefault?.(); this.emit('pointerdown', parseInt(k.el.dataset.midi,10)); };
      const up   = (ev)=>{ ev.preventDefault?.(); this.emit('pointerup', parseInt(k.el.dataset.midi,10)); };
      k.el.addEventListener('mousedown', down);
      k.el.addEventListener('mouseup', up);
      k.el.addEventListener('touchstart', down, {passive:false});
      k.el.addEventListener('touchend', up);
      k.el.addEventListener('mouseleave', (e)=>{ if(e.buttons) up(e); });
    }
  }

  on(type, fn){ (this._em||(this._em=new Map())).set(type, fn); }
  emit(type, payload){ const fn = this._em && this._em.get(type); if(fn) fn(payload); }

  setLabels(mode){ this.labelMode = mode; this._updateLabels(); }
  setKeyShadows(on){ this.enableKeyShadows = on; this.root.classList.toggle('no-shadows', !on); }
  setKeyGlow(on){ this.keyGlowEnabled = !!on; if(!on) this._clearAllTrails(); }

  press(midi){ const k = this.keys.get(midi); if(!k) return; k.el.classList.add('pressed'); }
  release(midi){ const k = this.keys.get(midi); if(!k) return; k.el.classList.remove('pressed'); }

  _updateLabels(){
    for(const [m, k] of this.keys){
      if(this.labelMode==='none'){ k.label.textContent = ''; }
      else if(this.labelMode==='notes'){ k.label.textContent = k.noteName; }
      else if(this.labelMode==='pc'){ k.label.textContent = ''; }
    }
  }

  trailBegin(midi, color){
    if(!this.keyGlowEnabled) return;
    const k = this.keys.get(midi); if(!k) return;
    const ctx = k.trailCtx;
    k.trailState = { active: true, color, lastY: k.trail.height, startTime: performance.now(), fading: false, fadeLevel: 1 };
    ctx.clearRect(0,0,k.trail.width,k.trail.height);
  }

  trailUpdate(midi, sustained){
    const k = this.keys.get(midi); if(!k || !k.trailState) return;
    const { trail, trailCtx: ctx } = k;
    const s = k.trailState;

    if(!this.keyGlowEnabled){ this.trailEnd(midi); }

    const now = performance.now();
    const dt = Math.min(0.05, (now - (s.lastT || now))/1000);
    s.lastT = now;

    if(s.active){
      const speed = sustained ? 140 : 260;
      const height = Math.max(2, speed*dt);
      const y = Math.max(0, (s.lastY ?? trail.height) - height);

      const img = ctx.getImageData(0,0,trail.width,trail.height);
      ctx.clearRect(0,0,trail.width,trail.height);
      ctx.putImageData(img, 0, -height);

      const grad = ctx.createLinearGradient(0, y, 0, y+height);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, colorWithAlpha(s.color, 0.9));
      ctx.fillStyle = grad;
      ctx.fillRect(0, trail.height - height, trail.width, height);

      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = 'rgba(255,255,255,0.985)';
      ctx.fillRect(0,0,trail.width,trail.height);
      ctx.globalCompositeOperation = 'source-over';

      s.lastY = y;
    } else if(s.fading){
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0,0,trail.width,trail.height);
      ctx.globalCompositeOperation = 'source-over';
      s.fadeLevel -= 0.08;
      if(s.fadeLevel <= 0){
        ctx.clearRect(0,0,trail.width,trail.height);
        k.trailState = null;
      }
    }
  }

  trailEnd(midi){
    const k = this.keys.get(midi); if(!k || !k.trailState) return;
    k.trailState.active = false;
    k.trailState.fading = true;
  }

  _clearAllTrails(){
    for(const k of this.keys.values()){
      if(k.trailState){
        const ctx = k.trailCtx;
        ctx.clearRect(0,0,k.trail.width,k.trail.height);
        k.trailState = null;
      }
    }
  }

  getKeyRects(){
    const map = new Map();
    for(const [m, k] of this.keys){
      map.set(m, k.el.getBoundingClientRect());
    }
    return map;
  }
}

function colorWithAlpha(css, a){
  return css.replace(/hsl\(([^)]+)\)/, `hsla($1, ${a})`).replace(/hsla\(([^,]+,[^,]+,[^,]+),[^)]+\)/, `hsla($1, ${a})`);
}
