// ============================================================================
// hud.js — Interface: velocidade, altitude, direção, combustível, avisos.
// ============================================================================
export class HUD {
  constructor() {
    this.el = {};
    for (const id of ['gSpd', 'gGs', 'gAlt', 'gAgl', 'gHdg', 'gVs', 'sThr', 'bThr', 'sFuel', 'bFuel',
      'sTemp', 'bTemp', 'sFlaps', 'sGear', 'sMach', 'sWind', 'warnings', 'fpsBox', 'camName',
      'touchdownMsg', 'gearSub', 'flapsSub', 'brkSub']) {
      this.el[id] = document.getElementById(id);
    }
    this._warnCache = '';
    this._fpsAcc = 0; this._fpsN = 0;
    this._tdT = 0;
  }

  update(dt, d) {
    // d: dados derivados
    const e = this.el;
    e.gSpd.textContent = Math.round(d.iasKt);
    e.gGs.textContent = 'GS ' + Math.round(d.gsKt);
    e.gAlt.textContent = Math.round(d.altFt).toLocaleString('pt-BR');
    e.gAgl.textContent = 'AGL ' + Math.round(d.aglFt).toLocaleString('pt-BR');
    e.gHdg.textContent = String(Math.round(d.hdg)).padStart(3, '0') + '°';
    const vs = Math.round(d.vsFpm / 50) * 50;
    e.gVs.textContent = 'VS ' + (vs > 0 ? '+' : '') + vs.toLocaleString('pt-BR');
    e.sThr.textContent = Math.round(d.throttle * 100) + '%' + (d.reverse ? ' RVS' : '');
    e.bThr.style.width = (d.throttle * 100) + '%';
    e.sFuel.textContent = Math.round(d.fuelPct) + '%';
    e.bFuel.style.width = d.fuelPct + '%';
    e.sTemp.textContent = Math.round(d.temp) + '°C';
    e.bTemp.style.width = Math.min(100, d.temp) + '%';
    e.sFlaps.textContent = d.flapName;
    e.sGear.textContent = d.gearTxt;
    e.sGear.style.color = d.gearCol;
    e.sMach.textContent = d.mach.toFixed(2);
    e.sWind.textContent = d.windTxt;

    // FPS
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc >= 0.5) {
      e.fpsBox.textContent = 'FPS ' + Math.round(this._fpsN / this._fpsAcc) + ' · ' + d.quality.toUpperCase();
      this._fpsAcc = 0; this._fpsN = 0;
    }

    // mensagens de toque
    if (d.touchMsg) {
      e.touchdownMsg.textContent = d.touchMsg;
      e.touchdownMsg.style.opacity = 1;
      this._tdT = 3.5;
    } else if (this._tdT > 0) {
      this._tdT -= dt;
      if (this._tdT <= 0) e.touchdownMsg.style.opacity = 0;
    }
  }

  setWarnings(list) {
    // lista de [id, texto, classe]
    const key = JSON.stringify(list);
    if (key === this._warnCache) return;
    this._warnCache = key;
    const w = this.el.warnings;
    w.innerHTML = '';
    for (const [, txt, cls] of list) {
      const div = document.createElement('div');
      div.className = 'warnBox ' + (cls || '');
      div.textContent = txt;
      w.appendChild(div);
    }
  }

  setCam(name) { this.el.camName.textContent = 'CÂMERA: ' + name; }
  setQuality(q) { this._quality = q; }
}
