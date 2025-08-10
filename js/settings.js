// settings.js (revised)
// - Still opens/closes the panel.
// - If the theme <select> is empty (first load), populate it (unchanged behavior).
// - No hard dependency on new controls; app.js injects "Key Glow" if missing.

import {THEMES} from './theme.js';

export class SettingsUI {
  constructor(){
    this.panel = document.getElementById('settings-panel');
    this.themeSelect = document.getElementById('theme-select');

    if(this.themeSelect && !this.themeSelect.options.length){
      for(const t of THEMES){
        const opt = document.createElement('option');
        opt.value = t.id; opt.textContent = t.name; this.themeSelect.appendChild(opt);
      }
    }
    this._wire();
  }

  open(){ this.panel?.classList.remove('hidden'); }
  close(){ this.panel?.classList.add('hidden'); }

  _wire(){
    const openBtn = document.getElementById('settings-btn');
    const closeBtn = document.getElementById('close-settings');
    openBtn?.addEventListener('click', ()=>this.open());
    closeBtn?.addEventListener('click', ()=>this.close());
    window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') this.close(); });
  }
}
