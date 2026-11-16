// ============================================================================
// controls.js — Entrada: joystick virtual (toque), slider de acelerador,
// botões físicos, teclado e inclinação do dispositivo.
// ============================================================================
export class InputSystem {
  constructor() {
    this.pitch = 0;     // -1 nariz para baixo .. +1 puxar
    this.roll = 0;      // -1 esq .. +1 dir
    this.yaw = 0;       // -1 esq .. +1 dir
    this.throttle = 0;
    this.brakes = 0;
    this.gearDown = true;
    this.flapsIdx = 0;
    this.spoilers = false;
    this.reverse = false;

    this._keys = {};
    this._tiltOn = false;
    this._tiltPitch = 0;
    this._tiltRoll = 0;
    this._joyId = null;
    this._thrId = null;
    this._rudId = null;
    this.onCamera = null;
    this.onPause = null;
    this.onTiltToggle = null;
    this.onSoundToggle = null;
  }

  bind({ joyZone, joyStick, thrSlider, thrFill, thrHandle,
    btnGear, btnFlaps, btnSpr, btnRvs, btnBrk, btnRudL, btnRudR,
    btnCam, btnPause, btnTilt, btnSound }, cb) {

    this.onCamera = cb.camera; this.onPause = cb.pause;
    this.onTiltToggle = cb.tilt; this.onSoundToggle = cb.sound;

    // ---------------- joystick ----------------
    const stick = joyStick;
    const baseR = () => joyZone.querySelector('#joyBase').clientWidth / 2 - 26;
    let jx = 0, jy = 0;
    const setStick = () => {
      stick.style.transform = `translate(calc(-50% + ${jx}px), calc(-50% + ${jy}px))`;
    };
    const joyMove = (e) => {
      const r = joyZone.getBoundingClientRect();
      const bx = r.left + 24 + 62, by = r.bottom - 26 - 62;  // centro aproximado da base
      const base = joyZone.querySelector('#joyBase');
      const br = base.getBoundingClientRect();
      const cx = br.left + br.width / 2, cy = br.top + br.height / 2;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const max = br.width / 2 - 10;
      const d = Math.hypot(dx, dy);
      if (d > max) { dx *= max / d; dy *= max / d; }
      jx = dx; jy = dy; setStick();
      this.roll = dx / max;
      this.pitch = -dy / max;
    };
    joyZone.addEventListener('pointerdown', (e) => {
      if (this._joyId !== null) return;
      this._joyId = e.pointerId;
      joyZone.setPointerCapture(e.pointerId);
      joyMove(e);
    });
    joyZone.addEventListener('pointermove', (e) => { if (e.pointerId === this._joyId) joyMove(e); });
    const joyEnd = (e) => {
      if (e.pointerId !== this._joyId) return;
      this._joyId = null;
      jx = 0; jy = 0; setStick();
      this.roll = 0; this.pitch = 0;
    };
    joyZone.addEventListener('pointerup', joyEnd);
    joyZone.addEventListener('pointercancel', joyEnd);

    // ---------------- acelerador ----------------
    const thrSet = (e) => {
      const r = thrSlider.getBoundingClientRect();
      const t = 1 - THREE.clamp((e.clientY - r.top) / r.height, 0, 1);
      this.throttle = t;
      const pct = Math.round(t * 100);
      thrFill.style.height = pct + '%';
      thrHandle.style.bottom = `calc(${pct}% - ${(pct / 100) * 34}px)`;
      thrHandle.textContent = pct + '%';
    };
    thrSlider.addEventListener('pointerdown', (e) => {
      if (this._thrId !== null) return;
      this._thrId = e.pointerId;
      thrSlider.setPointerCapture(e.pointerId);
      thrSet(e);
    });
    thrSlider.addEventListener('pointermove', (e) => { if (e.pointerId === this._thrId) thrSet(e); });
    const thrEnd = (e) => { if (e.pointerId === this._thrId) this._thrId = null; };
    thrSlider.addEventListener('pointerup', thrEnd);
    thrSlider.addEventListener('pointercancel', thrEnd);

    // ---------------- botões ----------------
    const press = (el, on, off) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); });
      if (off) {
        el.addEventListener('pointerup', off);
        el.addEventListener('pointercancel', off);
        el.addEventListener('pointerleave', off);
      }
    };
    press(btnGear, () => { this.gearDown = !this.gearDown; cb.click(); cb.syncGear(this.gearDown); });
    press(btnFlaps, () => { this.flapsIdx++; cb.click(); cb.syncFlaps(this.flapsIdx); });
    press(btnSpr, () => { this.spoilers = !this.spoilers; cb.click(); cb.syncSpr(this.spoilers); });
    press(btnRvs, () => { this.reverse = !this.reverse; cb.click(); cb.syncRvs(this.reverse); });
    press(btnBrk, () => { this.brakes = 1; cb.syncBrk(true); }, () => { this.brakes = 0; cb.syncBrk(false); });
    press(btnRudL, () => { this._yawL = true; this._yawUpd(); }, () => { this._yawL = false; this._yawUpd(); });
    press(btnRudR, () => { this._yawR = true; this._yawUpd(); }, () => { this._yawR = false; this._yawUpd(); });

    btnCam.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onCamera && this.onCamera(); });
    btnPause.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onPause && this.onPause(); });
    btnTilt.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onTiltToggle && this.onTiltToggle(); });
    btnSound.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onSoundToggle && this.onSoundToggle(); });

    // ---------------- teclado ----------------
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this._keys[e.code] = true;
      switch (e.code) {
        case 'KeyG': this.gearDown = !this.gearDown; cb.click(); cb.syncGear(this.gearDown); break;
        case 'KeyF': this.flapsIdx++; cb.click(); cb.syncFlaps(this.flapsIdx); break;
        case 'KeyV': this.spoilers = !this.spoilers; cb.click(); cb.syncSpr(this.spoilers); break;
        case 'KeyR': this.reverse = !this.reverse; cb.click(); cb.syncRvs(this.reverse); break;
        case 'KeyB': this.brakes = 1; cb.syncBrk(true); break;
        case 'KeyC': this.onCamera && this.onCamera(); break;
        case 'KeyP': case 'Escape': this.onPause && this.onPause(); break;
      }
    });
    window.addEventListener('keyup', (e) => {
      this._keys[e.code] = false;
      if (e.code === 'KeyB') { this.brakes = 0; cb.syncBrk(false); }
    });

    window.addEventListener('deviceorientation', (e) => {
      if (!this._tiltOn) return;
      this._tiltRoll = THREE.clamp((e.gamma || 0) / 28, -1, 1);
      this._tiltPitch = THREE.clamp(((e.beta || 0) - 38) / 30, -1, 1);
    });
  }

  _yawUpd() {
    this.yaw = (this._yawL ? -1 : 0) + (this._yawR ? 1 : 0);
  }

  toggleTilt() { this._tiltOn = !this._tiltOn; return this._tiltOn; }
  get tiltOn() { return this._tiltOn; }

  // chamado a cada frame antes da física
  sample(dt) {
    const k = this._keys;
    let kp = (k['ArrowUp'] ? 1 : 0) - (k['ArrowDown'] ? 1 : 0);
    let kr = (k['ArrowRight'] ? 1 : 0) - (k['ArrowLeft'] ? 1 : 0);
    let ky = (k['KeyE'] ? 1 : 0) - (k['KeyQ'] ? 1 : 0);
    const kt = ((k['KeyW'] || k['PageUp'] ? 1 : 0) - (k['KeyS'] || k['PageDown'] ? 1 : 0)) * dt * 0.5;
    if (kt !== 0) {
      this.throttle = THREE.clamp(this.throttle + kt, 0, 1);
      const fill = document.getElementById('thrFill');
      const handle = document.getElementById('thrHandle');
      if (fill) {
        const pct = Math.round(this.throttle * 100);
        fill.style.height = pct + '%';
        handle.style.bottom = `calc(${pct}% - ${(pct / 100) * 34}px)`;
        handle.textContent = pct + '%';
      }
    }
    if (this._tiltOn) {
      // inclinação soma ao joystick
      this.effPitch = THREE.clamp(this.pitch + this._tiltPitch, -1, 1);
      this.effRoll = THREE.clamp(this.roll + this._tiltRoll, -1, 1);
    } else {
      this.effPitch = THREE.clamp(this.pitch + kp, -1, 1);
      this.effRoll = THREE.clamp(this.roll + kr, -1, 1);
    }
    this.effYaw = THREE.clamp(this.yaw + ky, -1, 1);
  }
}

// pequeno helper local (evita importar three aqui)
const THREE = {
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
};
