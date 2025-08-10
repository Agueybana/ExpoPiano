// renderer.js (revised)
// - Floor clamps exactly to the canvas bottom (keyboard top) with a tiny visual adjust.
// - Falling notes appear to touch the piano line; no big gap.

import { clamp, seededRandom, hsl } from './utils.js';

export class Renderer {
    constructor(canvas, postCanvas){
        this.canvas = canvas;
        this.post = postCanvas;
        this.ctx = canvas.getContext('2d');
        this.width = 0; this.height = 0;

        this.enableBloom = true;
        this.enableTrails = true;
        this.enableExplosions = false;
        this.explosionType = 'sphere';
        this.budget = 16000;

        this.themeHue = 210;
        this.themeSat = 0.9;
        this.themeLight = 0.6;

        this.bpm = 0;
        this.noteMin = 21;
        this.noteMax = 108;
        this.lanes = new Map();

        this.falling = [];
        this.particles = [];

        this.gravity = 480;
        this.air = 0.01;
        this.wind = 0;
        this.focalLength = 300;

        this.floorY = null;
        this.floorAdjustPx = -6; // nudge upward to visually "touch" keyboard

        this.lastTime = performance.now();
        window.addEventListener('resize', ()=>this._resize());
        this._resize();
        this._loop = this._loop.bind(this);
        requestAnimationFrame(this._loop);
    }

    setFloorAdjust(px){ this.floorAdjustPx = px|0; }

    _resize(){
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const rect = this.canvas.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width * dpr));
        const h = Math.max(1, Math.floor(rect.height * dpr));
        this.canvas.width = this.post.width = this.width = w;
        this.canvas.height = this.post.height = this.height = h;
        this.canvas.style.width = rect.width+'px';
        this.canvas.style.height = rect.height+'px';
        this.post.style.width = rect.width+'px';
        this.post.style.height = rect.height+'px';
        if(this.lanes.size===0) this._provisionalLanes();
        this._draw(true);
    }

    _provisionalLanes(){
        const margin = Math.floor(this.width * 0.05);
        const usable = Math.max(1, this.width - margin*2);
        for(let m=this.noteMin; m<=this.noteMax; m++){
            const i = m - this.noteMin;
            const x = margin + (usable * (i/87));
            this.lanes.set(m, {x, w: Math.max(4, Math.floor(usable/87 * 0.22))});
        }
        this.floorY = this.height - 1;
    }

    setTheme(theme){
        this.themeHue = theme.baseHue;
        this.themeSat = theme.sat;
        this.themeLight = theme.light;
        this._draw(true);
    }

    setBudget(n){ this.budget = n|0; }
    setBloom(on){ this.enableBloom = on; }
    setTrails(on){ this.enableTrails = on; }
    setExplosions(on) { this.enableExplosions = on; }
    setExplosionType(type) { this.explosionType = type; }
    setBPM(bpm){ this.bpm = bpm; }
    
    updateKeyboardRect(keyRectsByMidi){
        const view = this.canvas.getBoundingClientRect();
        const scaleX = this.width / (view.width || 1);
        const scaleY = this.height / (view.height || 1);
        this.lanes.clear();

        let minTop = Infinity;
        for(const [midi, r] of keyRectsByMidi){
            if(!r) continue;
            const x = ((r.left - view.left) + r.width/2) * scaleX;
            const w = Math.max(4, Math.floor((r.width||1) * scaleX * 0.3));
            this.lanes.set(midi, {x, w});
            const topY = (r.top - view.top) * scaleY;
            if(topY < minTop) minTop = topY;
        }
        if(this.lanes.size===0) this._provisionalLanes();

        // Clamp: if keys are *below* the canvas, minTop >= canvas.height.
        // We want the floor to be at (height - 1) with a slight negative adjust.
        let floor = Number.isFinite(minTop) ? Math.min(this.height - 1, Math.floor(minTop)) : (this.height - 1);
        floor = Math.max(0, Math.min(this.height - 1, floor + (this.floorAdjustPx||0)));
        this.floorY = floor;

        this._draw(true);
    }

    colorFor(note, vel){
        const hue = (this.themeHue + (note%12)*30 + (this.bpm%120))%360;
        const s = clamp(this.themeSat * (0.65 + vel*0.35), 0, 1);
        const l = clamp(this.themeLight * (0.45 + vel*0.55), 0, 1);
        return hsl(hue, s, l, 1);
    }

    noteOn(midi, velocity){
        const lane = this.lanes.get(midi);
        if (!lane) return;

        const x = lane.x;
        const w = lane.w;
        const color = this.colorFor(midi, velocity);

        const baseH = 22 + velocity*36;
        const obj = {
            midi, x, w: Math.max(4, w), y: -baseH, vy: 0, h: baseH,
            color, on: performance.now(), off: null, landed: false, alpha: 1,
            duration: 0, maxH: baseH, velocity
        };
        this.falling.push(obj);

        if (!this.enableExplosions) this._burstAt(x, 6, midi, velocity);
    }

    noteOff(midi){
        for(let i=this.falling.length-1; i>=0; i--){
            const n = this.falling[i];
            if(n.midi===midi && n.off==null){
                n.off = performance.now();
                n.duration = n.off - n.on;
                break;
            }
        }
    }

    _floorY(){ return this.floorY != null ? this.floorY : (this.height - 1); }

    _update(dt){
        const bpm = this.bpm||0;
        this.gravity = 400 + Math.min(600, bpm*2.6);
        this.wind = Math.sin(performance.now()/680) * (bpm*0.3);

        const floorY = this._floorY();

        for(let i=this.falling.length-1; i>=0; i--){
            const n = this.falling[i];
            if(!n.landed){
                if(n.off == null) {
                    n.duration = performance.now() - n.on;
                    const elongation = 1 + Math.min(2, n.duration / 2000);
                    n.maxH = n.h * elongation;
                }
                n.vy += this.gravity * dt;
                n.vy *= (1 - this.air*dt*60);
                n.y += n.vy * dt;
                n.x += this.wind * dt * 0.2;
                n.h = Math.min(n.h + 12*dt, n.maxH);

                if(n.y + n.h >= floorY){
                    n.y = floorY - n.h;
                    n.vy = 0;
                    n.landed = true;
                    if (this.enableExplosions) this._triggerExplosion(n.x, floorY, n.midi, n.velocity, n.duration);
                }
            } else {
                if(n.off==null){
                    n.h += Math.sin(performance.now()/220) * 0.12;
                } else {
                    n.alpha -= 1.7 * dt;
                    n.h -= 64 * dt;
                    if(n.alpha <= 0 || n.h <= 3){
                        this.falling.splice(i,1);
                        continue;
                    }
                }
            }
        }

        for(let i=this.particles.length-1; i>=0; i--){
            const p = this.particles[i];
            p.vx += p.ax * dt;
            p.vy += p.ay * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;

            if (p.vz !== undefined) {
                p.vz *= (1 - 0.5 * dt);
                p.z += p.vz * dt;
            }
            if (p.wigglePhase !== undefined) p.x += Math.sin(p.wigglePhase + p.t * p.wiggleSpeed) * 2;
            if (p.flicker !== undefined) p.alpha = p.baseAlpha * (0.5 + Math.sin(p.flicker + p.t * 20) * 0.5);

            p.t += dt;
            if(p.y > this.height + 60 || p.x < -60 || p.x > this.width+60 || p.t > p.life){
                this.particles.splice(i,1);
            } else if (p.z !== undefined && p.z < -this.focalLength + 10) {
                this.particles.splice(i, 1);
            }
        }
    }

    _draw(forceBackground=false){
        const ctx = this.ctx;

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = forceBackground ? 'rgb(8,10,16)' : 'rgba(5,8,14,0.22)';
        ctx.fillRect(0,0,this.width,this.height);

        ctx.strokeStyle = 'rgba(255,255,255,0.045)';
        ctx.lineWidth = 1;
        for(const {x} of this.lanes.values()){
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.height-2); ctx.stroke();
        }

        // Piano "floor" line is blended softly to avoid a visible gap
        const fY = Math.min(this.height - 1, this._floorY()+0.5);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath(); ctx.moveTo(0, fY); ctx.lineTo(this.width, fY); ctx.stroke();

        for(const n of this.falling){
            const w = Math.max(4, n.w);
            const x0 = n.x - w/2;
            const y0 = n.y;
            const y1 = n.y + n.h;
            const grd = ctx.createLinearGradient(n.x, y0, n.x, y1);
            grd.addColorStop(0, 'rgba(255,255,255,0.0)');
            grd.addColorStop(1, n.color);
            if(this.enableBloom){
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = Math.max(0, n.alpha) * 0.35;
                ctx.fillStyle = n.color;
                ctx.fillRect(x0 - 4, y0 - 6, w + 8, n.h + 12);
            }
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = Math.max(0, n.alpha);
            ctx.fillStyle = grd;
            ctx.fillRect(x0, y0, w, n.h);
            if(n.landed && n.off==null){
                ctx.globalAlpha = Math.max(0, n.alpha) * 0.8;
                ctx.fillStyle = 'rgba(255,255,255,0.18)';
                ctx.fillRect(x0, y1 - 2, w, 2);
            }
            ctx.globalAlpha = 1;
        }

        if(this.enableTrails){
            ctx.globalCompositeOperation = 'lighter';
            for(const p of this.particles){
                ctx.save();
                let screenX = p.x, screenY = p.y, screenSize = p.size, scale = 1.0;
                if (p.z !== undefined && this.focalLength > 0) {
                    scale = this.focalLength / (this.focalLength + p.z);
                    if (scale <= 0) { ctx.restore(); continue; }
                    screenX = (p.x - this.width/2) * scale + this.width/2;
                    screenY = (p.y - this.height/2) * scale + this.height/2;
                    screenSize = p.size * scale;
                }
                ctx.translate(screenX, screenY);
                let alpha = Math.max(0, 1 - p.t/p.life) * (scale > 0.5 ? 1 : scale * 2);
                if (p.alpha !== undefined) alpha *= p.alpha;

                if(this.enableBloom && (!p.sparkle || (p.sparkle && Math.sin(p.t * 50) > 0.5))){
                    ctx.globalAlpha = alpha*0.35;
                    ctx.beginPath(); ctx.arc(0,0,screenSize*3.0, 0, Math.PI*2); ctx.fillStyle = p.color; ctx.fill();
                }

                ctx.globalAlpha = alpha;
                ctx.fillStyle = p.color;

                switch(p.shape){
                    case 'triangle':
                        ctx.rotate(p.spin * p.t);
                        ctx.beginPath();
                        ctx.moveTo(0, -screenSize);
                        ctx.lineTo(-screenSize, screenSize);
                        ctx.lineTo(screenSize, screenSize);
                        ctx.closePath();
                        ctx.fill();
                        break;
                    case 'square':
                        ctx.rotate(p.spin * p.t);
                        ctx.fillRect(-screenSize, -screenSize, screenSize*2, screenSize*2);
                        break;
                    case 'ring':
                        ctx.beginPath();
                        ctx.arc(0,0,screenSize*1.4, 0, Math.PI*2);
                        ctx.lineWidth = Math.max(1, 2 * scale);
                        ctx.strokeStyle = p.color;
                        ctx.stroke();
                        break;
                    default:
                        ctx.beginPath();
                        ctx.arc(0,0,screenSize, 0, Math.PI*2);
                        ctx.fill();
                }
                ctx.restore();
            }
        }
    }

    /* ------- particles/explosions: unchanged from your previous version ------- */
    _burstAt(x, y, midi, velocity){
        const rand = seededRandom(midi*10007 + Math.random()*1e6);
        const bpmFactor = clamp((this.bpm||60)/120, 0.4, 2);
        const N = 8 + Math.floor(10*velocity);
        for(let i=0;i<N;i++){
            const a = -Math.PI/2 + (rand()-0.5)*0.9;
            const speed = 120*bpmFactor + velocity*260 + rand()*120;
            const vx = Math.cos(a)*speed + this.wind*0.2;
            const vy = Math.sin(a)*speed + this.gravity*(-0.02);
            const life = 0.6 + rand()*0.8 + velocity*0.3;
            const size = 1.6 + velocity*3.8 + rand()*1.6;
            const color = this.colorFor(midi, velocity);
            const shape = (()=>{
                const bpm = this.bpm||90;
                if(bpm<80) return 'circle';
                if(bpm<110) return rand()<0.5 ? 'circle' : 'triangle';
                if(bpm<140) return 'triangle';
                if(bpm<170) return 'square';
                return 'ring';
            })();
            this.particles.push({
                x, y, vx, vy, ax: this.wind*0.8, ay: this.gravity*0.4,
                life, t: 0, size, color, shape, spin: (rand()-0.5)*10
            });
            if(this.particles.length > this.budget) this.particles.shift();
        }
    }

    _triggerExplosion(x, y, midi, velocity, duration) {
        const durationFactor = 1 + Math.min(2, duration / 2000);
        switch(this.explosionType) {
            case 'sphere':   this._sphereExplosion(x, y, midi, velocity, durationFactor); break;
            case 'fountain': this._fountainExplosion(x, y, midi, velocity, durationFactor); break;
            case 'shatter':  this._shatterExplosion(x, y, midi, velocity, durationFactor); break;
            case 'quantum':  this._quantumExplosion(x, y, midi, velocity, durationFactor); break;
            case 'nova':     this._novaExplosion(x, y, midi, velocity, durationFactor); break;
            default:         this._sphereExplosion(x, y, midi, velocity, durationFactor);
        }
    }

    _sphereExplosion(x, y, midi, velocity, durationFactor) {
        const rand = seededRandom(midi*10007 + Math.random()*1e6);
        const N = Math.floor((40 + 80 * velocity) * durationFactor);
        const baseSpeed = 300 + 500 * velocity;
        const color = this.colorFor(midi, velocity);

        // Multi-layered 3D sparkle diffusion effect
        const layers = 3;
        for (let layer = 0; layer < layers; layer++) {
            const layerDelay = layer * 0.15;
            const layerN = Math.floor(N / layers);
            
            for (let i = 0; i < layerN; i++) {
                const theta = rand() * Math.PI * 2;
                const phi = Math.acos(2 * rand() - 1);
                const speed = baseSpeed * (0.3 + rand() * 0.7) * Math.sqrt(durationFactor) * (1 - layer * 0.2);

                const vx = speed * Math.sin(phi) * Math.cos(theta);
                const vy = -Math.abs(speed * Math.sin(phi) * Math.sin(theta)) * 0.8;
                const vz = speed * Math.cos(phi);

                const life = (2.0 + rand() * 2.0 + velocity * 0.5) * durationFactor;
                const size = (1.0 + velocity * 4.0 + rand() * 2.0) * Math.pow(durationFactor, 0.3) * (1 + layer * 0.3);
                const shape = layer === 0 ? 'circle' : (layer === 1 ? 'ring' : 'triangle');
                
                // Add sparkle effect
                const sparkle = rand() > 0.7;
                
                this.particles.push({
                    x: x + (rand() - 0.5) * layer * 10,
                    y: y - layer * 5,
                    z: (rand() - 0.5) * 50 * layer,
                    vx, vy, vz,
                    ax: (rand() - 0.5) * 200 * Math.sin(i),
                    ay: this.gravity * 0.5,
                    life, t: -layerDelay, size, color, shape,
                    spin: sparkle ? (rand() * 50) : ((rand() - 0.5) * 20),
                    sparkle,
                    pulse: rand() * Math.PI * 2
                });

                if (this.particles.length > this.budget) this.particles.shift();
            }
        }
    }

    _fountainExplosion(x, y, midi, velocity, durationFactor) {
        const rand = seededRandom(midi*10007 + Math.random()*1e6);
        const N = Math.floor((60 + 100 * velocity) * durationFactor);
        const color = this.colorFor(midi, velocity);

        // Wiggly worm fountain effect with spiral motion
        const streams = 5 + Math.floor(velocity * 5);
        for (let stream = 0; stream < streams; stream++) {
            const streamAngle = (stream / streams) * Math.PI * 2;
            const streamN = Math.floor(N / streams);
            
            for (let i = 0; i < streamN; i++) {
                const t = i / streamN;
                const wiggle = Math.sin(t * Math.PI * 4) * 50;
                const spiral = t * Math.PI * 6;
                
                const baseAngle = streamAngle + spiral * 0.3;
                const speed = (300 + rand() * 400) * velocity * durationFactor * (1 - t * 0.3);
                const spread = 0.1 + t * 0.5;
                
                const vx = Math.cos(baseAngle) * speed * spread + wiggle * 0.5;
                const vy = -speed * (1.5 + rand() * 0.5) * (1 - t * 0.2);
                const vz = Math.sin(baseAngle) * speed * spread;

                const life = (3.0 + rand() * 2.0) * durationFactor;
                const size = (1.5 + velocity * 3.0 + t * 2.0) * Math.pow(durationFactor, 0.4);
                
                // Create worm-like connected particles
                const wormSegment = i % 3;
                
                this.particles.push({
                    x: x + Math.cos(streamAngle) * wiggle * 0.2,
                    y: y - i * 0.5,
                    z: Math.sin(streamAngle) * wiggle * 0.2,
                    vx, vy, vz,
                    ax: Math.sin(t * Math.PI * 8) * 100,
                    ay: this.gravity * 0.8,
                    life, t: -i * 0.01, size, color,
                    shape: wormSegment === 0 ? 'circle' : 'square',
                    spin: spiral * 2,
                    wigglePhase: rand() * Math.PI * 2,
                    wiggleSpeed: 10 + rand() * 10
                });

                if (this.particles.length > this.budget) this.particles.shift();
            }
        }
    }

    _shatterExplosion(x, y, midi, velocity, durationFactor) {
        const rand = seededRandom(midi*10007 + Math.random()*1e6);
        const N = Math.floor((50 + 70 * velocity) * durationFactor);
        const color = this.colorFor(midi, velocity);

        // Crystal shatter with glass-like fragments
        const shards = 8 + Math.floor(velocity * 12);
        
        for (let shard = 0; shard < shards; shard++) {
            const shardAngle = (shard / shards) * Math.PI * 2 + rand() * 0.3;
            const shardN = Math.floor(N / shards);
            
            // Create jagged shard shapes
            for (let i = 0; i < shardN; i++) {
                const fragment = i / shardN;
                const shardSpeed = (400 + rand() * 500) * velocity * Math.sqrt(durationFactor);
                const elevation = -0.1 - rand() * 0.4 - fragment * 0.3;
                
                // Add rotation and tumbling motion
                const tumbleX = Math.sin(fragment * Math.PI * 3) * 100;
                const tumbleY = Math.cos(fragment * Math.PI * 2) * 50;
                
                const vx = Math.cos(shardAngle) * shardSpeed + tumbleX;
                const vy = elevation * shardSpeed + tumbleY;
                const vz = Math.sin(shardAngle) * shardSpeed * 0.7;

                const life = (2.0 + rand() * 1.5) * durationFactor;
                const size = (2.0 + velocity * 6.0 * (1 - fragment * 0.5)) * Math.pow(durationFactor, 0.35);
                
                // Glass-like appearance
                const glassAlpha = 0.3 + rand() * 0.7;
                
                this.particles.push({
                    x: x + Math.cos(shardAngle) * fragment * 20,
                    y: y - fragment * 10,
                    z: Math.sin(shardAngle) * fragment * 20,
                    vx, vy, vz,
                    ax: vx * -0.6,
                    ay: this.gravity * 0.6,
                    life, t: -fragment * 0.05, size, color,
                    shape: 'triangle',
                    spin: (rand() - 0.5) * 40 + fragment * 20,
                    alpha: glassAlpha,
                    baseAlpha: glassAlpha,
                    shardGroup: shard
                });

                if (this.particles.length > this.budget) this.particles.shift();
            }
        }
    }

    _quantumExplosion(x, y, midi, velocity, durationFactor) {
        const rand = seededRandom(midi*10007 + Math.random()*1e6);
        const N = Math.floor((70 + 100 * velocity) * durationFactor);
        const color = this.colorFor(midi, velocity);

        // Quantum probability cloud with teleporting particles
        const quantumClouds = 4 + Math.floor(velocity * 3);
        
        for (let cloud = 0; cloud < quantumClouds; cloud++) {
            const cloudPhase = (cloud / quantumClouds) * Math.PI * 2;
            const cloudN = Math.floor(N / quantumClouds);
            
            for (let i = 0; i < cloudN; i++) {
                const t = i / cloudN;
                const quantumPhase = t * Math.PI * 4 + cloudPhase;
                
                // Quantum tunneling effect - particles randomly jump positions
                const tunnelChance = rand();
                const baseRadius = 100 + rand() * 150 * velocity;
                const tunnelRadius = tunnelChance > 0.7 ? baseRadius * 3 : baseRadius;
                
                // Wave function collapse pattern
                const waveAngle = quantumPhase + Math.sin(quantumPhase * 5) * 2;
                const waveRadius = tunnelRadius * (1 + Math.sin(t * Math.PI * 8) * 0.5);
                
                const vx = Math.cos(waveAngle) * waveRadius * durationFactor;
                const vy = -Math.abs(Math.sin(waveAngle * 3) * waveRadius) - 100;
                const vz = Math.sin(waveAngle) * waveRadius * 0.8;

                const life = (2.5 + rand() * 3.5) * durationFactor;
                const size = (0.5 + velocity * 2.5 + Math.sin(quantumPhase) * 1.5) * Math.pow(durationFactor, 0.3);
                
                // Quantum entanglement pairs
                const entangled = i % 2 === 0;
                
                this.particles.push({
                    x: x + Math.cos(cloudPhase) * 30 * cloud,
                    y: y - cloud * 10,
                    z: Math.sin(cloudPhase) * 30 * cloud,
                    vx: vx * (entangled ? 1 : -1),
                    vy: vy + (entangled ? -50 : 50),
                    vz: vz * (entangled ? 1 : -1),
                    ax: Math.sin(quantumPhase * 7) * 300,
                    ay: this.gravity * 0.2,
                    life, t: -cloud * 0.1, size, color,
                    shape: entangled ? 'ring' : 'circle',
                    spin: quantumPhase * 15,
                    quantumPhase: quantumPhase,
                    tunneling: tunnelChance > 0.7,
                    flicker: rand() * Math.PI * 2,
                    alpha: 1,
                    baseAlpha: 1
                });

                if (this.particles.length > this.budget) this.particles.shift();
            }
        }
    }

    _novaExplosion(x, y, midi, velocity, durationFactor) {
        const rand = seededRandom(midi*10007 + Math.random()*1e6);
        const N = Math.floor((80 + 120 * velocity) * durationFactor);
        const color = this.colorFor(midi, velocity);

        // Supernova with plasma jets and stellar debris
        const core = Math.floor(N * 0.3);
        const jets = Math.floor(N * 0.4);
        const debris = Math.floor(N * 0.3);
        
        // Phase 1: Core collapse and rebound
        for (let i = 0; i < core; i++) {
            const coreAngle = rand() * Math.PI * 2;
            const corePhi = Math.acos(2 * rand() - 1);
            const coreSpeed = (500 + rand() * 700) * velocity * durationFactor;
            
            // Pulsating core effect
            const pulse = Math.sin(i * 0.1) * 0.5 + 0.5;
            const coreRadius = pulse * 50;
            
            const vx = coreSpeed * Math.sin(corePhi) * Math.cos(coreAngle) * pulse;
            const vy = -Math.abs(coreSpeed * Math.sin(corePhi) * Math.sin(coreAngle)) * 0.7;
            const vz = coreSpeed * Math.cos(corePhi) * pulse;

            const life = (3.0 + rand() * 2.0) * durationFactor;
            const size = (3.0 + velocity * 8.0 * pulse) * Math.pow(durationFactor, 0.4);
            
            this.particles.push({
                x: x + Math.cos(coreAngle) * coreRadius * 0.2,
                y: y + Math.sin(coreAngle) * coreRadius * 0.1,
                z: 0,
                vx, vy, vz,
                ax: -vx * 0.3,
                ay: this.gravity * 0.3,
                life, t: -pulse * 0.2, size, color,
                shape: 'circle',
                spin: coreAngle * 10,
                glow: true,
                pulsePhase: pulse
            });
        }
        
        // Phase 2: Plasma jets (bipolar)
        for (let jet = 0; jet < 2; jet++) {
            const jetDirection = jet === 0 ? 1 : -1;
            const jetN = Math.floor(jets / 2);
            
            for (let i = 0; i < jetN; i++) {
                const t = i / jetN;
                const jetSpiral = t * Math.PI * 8;
                const jetRadius = (1 - t) * 100 * velocity;
                
                const jetAngle = jetSpiral * 0.3;
                const jetSpeed = (600 + rand() * 400) * velocity * durationFactor;
                
                const vx = Math.cos(jetAngle) * jetRadius * jetDirection;
                const vy = -jetSpeed * (2.0 + t);
                const vz = Math.sin(jetAngle) * jetRadius * jetDirection;

                const life = (4.0 + rand() * 2.0) * durationFactor;
                const size = (2.0 + velocity * 5.0 * (1 - t * 0.5)) * Math.pow(durationFactor, 0.4);
                
                this.particles.push({
                    x: x + vx * 0.1,
                    y: y - t * 20,
                    z: vz * 0.1,
                    vx: vx + (rand() - 0.5) * 100,
                    vy: vy,
                    vz: vz + (rand() - 0.5) * 100,
                    ax: Math.sin(jetSpiral) * 200 * jetDirection,
                    ay: this.gravity * 0.1,
                    life, t: -t * 0.3, size, color,
                    shape: t < 0.5 ? 'circle' : 'ring',
                    spin: jetSpiral * 5,
                    jetStream: true
                });

                if (this.particles.length > this.budget) this.particles.shift();
            }
        }
        
        // Phase 3: Stellar debris field
        for (let i = 0; i < debris; i++) {
            const debrisAngle = rand() * Math.PI * 2;
            const debrisPhi = Math.acos(2 * rand() - 1);
            const debrisSpeed = (200 + rand() * 600) * velocity * durationFactor;
            const debrisSize = rand();
            
            const vx = debrisSpeed * Math.sin(debrisPhi) * Math.cos(debrisAngle);
            const vy = -Math.abs(debrisSpeed * Math.sin(debrisPhi) * Math.sin(debrisAngle)) * 0.5 - 200;
            const vz = debrisSpeed * Math.cos(debrisPhi);

            const life = (2.0 + rand() * 4.0 + debrisSize * 2.0) * durationFactor;
            const size = (0.5 + velocity * 2.0 + debrisSize * 3.0) * Math.pow(durationFactor, 0.35);
            
            this.particles.push({
                x: x + (rand() - 0.5) * 50,
                y: y + (rand() - 0.5) * 20,
                z: (rand() - 0.5) * 50,
                vx, vy, vz,
                ax: (rand() - 0.5) * 100,
                ay: this.gravity * 0.8,
                life, t: -rand() * 0.5, size, color,
                shape: debrisSize > 0.7 ? 'square' : (debrisSize > 0.4 ? 'triangle' : 'circle'),
                spin: (rand() - 0.5) * 30,
                debrisGlow: debrisSize > 0.8
            });

            if (this.particles.length > this.budget) this.particles.shift();
        }
    }

    _loop(){
        const t = performance.now();
        const dt = Math.min(0.05, (t - this.lastTime)/1000);
        this.lastTime = t;
        this._update(dt);
        this._draw();
        requestAnimationFrame(this._loop);
    }
}
