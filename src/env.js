// ============================================================================
// env.js — Atmosfera: céu, sol/lua, ciclo dia-noite, nuvens, chuva,
// vento, turbulência, densidade do ar e clima dinâmico.
// ============================================================================
import * as THREE from 'three';

const RHO0 = 1.225;      // densidade ao nível do mar kg/m^3
const HSCALE = 8500;     // escala de altitude da atmosfera (m)

// --------------------------- ruído (value noise) ---------------------------
function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function turbulenceNoise(t, seed) {
  // soma de senos -> rajada suave em [-1, 1]
  return (
    Math.sin(t * 1.13 + seed) * 0.45 +
    Math.sin(t * 2.71 + seed * 1.7) * 0.28 +
    Math.sin(t * 5.37 + seed * 2.3) * 0.17 +
    Math.sin(t * 9.71 + seed * 3.1) * 0.10
  );
}

export const WEATHERS = {
  clear:  { name: 'Céu limpo',  wind: 2.5,  windDir: 240, gust: 0.4, turb: 0.25, clouds: 10, cloudAlpha: 0.55, rain: 0,  lightning: 0,   sunDim: 1.0,  fogMul: 1.0 },
  windy:  { name: 'Ventania',   wind: 11.5, windDir: 250, gust: 2.6, turb: 1.05, clouds: 20, cloudAlpha: 0.75, rain: 0,  lightning: 0,   sunDim: 0.96, fogMul: 1.0 },
  cloudy: { name: 'Nublado',    wind: 5.5,  windDir: 200, gust: 1.2, turb: 0.55, clouds: 40, cloudAlpha: 0.9,  rain: 0,  lightning: 0,   sunDim: 0.72, fogMul: 0.78 },
  storm:  { name: 'Tempestade', wind: 15.0, windDir: 190, gust: 4.5, turb: 1.7,  clouds: 44, cloudAlpha: 1.0,  rain: 1,  lightning: 0.1, sunDim: 0.38, fogMul: 0.52 },
};

// --------------------------- texturas de sprite ----------------------------
function makeCloudTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 128);
  const blobs = 26;
  for (let i = 0; i < blobs; i++) {
    const x = 40 + Math.random() * 176;
    const y = 55 + Math.random() * 40;
    const r = 18 + Math.random() * 34;
    const grd = g.createRadialGradient(x, y - r * 0.25, r * 0.1, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.85)');
    grd.addColorStop(0.6, 'rgba(245,248,255,0.4)');
    grd.addColorStop(1, 'rgba(240,245,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function makeGlowTexture(color) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grd.addColorStop(0, color);
  grd.addColorStop(0.35, color.replace(')', ',0.5)').replace('rgb', 'rgba'));
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function makeRainTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, 'rgba(190,215,255,0)');
  grd.addColorStop(0.5, 'rgba(190,215,255,0.85)');
  grd.addColorStop(1, 'rgba(190,215,255,0)');
  g.fillStyle = grd; g.fillRect(6, 0, 3.4, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const SKY_TOP = new THREE.Color();
const SKY_HOR = new THREE.Color();
const FOG_COL = new THREE.Color();

export class Environment {
  constructor(scene, quality) {
    this.scene = scene;
    this.timeOfDay = 10.2;       // horas
    this.timeSpeed = 60;         // x tempo real
    this.weatherKey = 'clear';
    this.t = 0;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.isNight = false;
    this.lightning = 0;          // intensidade do flash atual
    this._lightningT = 3;
    this.fogDist = 5000;

    // ---- luzes ----
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 50;
    this.sun.shadow.camera.far = 900;
    const sc = this.sun.shadow.camera;
    sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x40553a, 0.8);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x223344, 0.25);
    this.scene.add(this.ambient);

    // ---- domo do céu ----
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x2a6fd4) },
        horColor: { value: new THREE.Color(0xbfd9f2) },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunGlow: { value: new THREE.Color(0xffdd99) },
        glowPow: { value: 6.0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 topColor; uniform vec3 horColor; uniform vec3 sunDir; uniform vec3 sunGlow; uniform float glowPow;
        varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(horColor, topColor, pow(h, 0.62));
          float s = clamp(dot(normalize(vDir), normalize(sunDir)), 0.0, 1.0);
          col += sunGlow * pow(s, glowPow) * 0.55 * (0.25 + 0.75*h);
          col += sunGlow * pow(s, 90.0) * 1.6;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), this.skyMat);
    this.skyDome.scale.setScalar(11000);
    this.scene.add(this.skyDome);

    // ---- sol e lua ----
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture('rgb(255,238,190)'), transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    this.sunSprite.scale.setScalar(1400);
    this.scene.add(this.sunSprite);
    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture('rgb(200,220,255)'), transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending, opacity: 0.9,
    }));
    this.moonSprite.scale.setScalar(700);
    this.scene.add(this.moonSprite);

    // ---- estrelas ----
    {
      const n = 900, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.95);
        const r = 10400;
        pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
        pos[i * 3 + 1] = r * Math.cos(ph);
        pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
        const b = 0.4 + Math.random() * 0.6;
        col[i * 3] = b; col[i * 3 + 1] = b; col[i * 3 + 2] = b * (0.9 + Math.random() * 0.2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.stars = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false,
      }));
      this.scene.add(this.stars);
    }

    // ---- nuvens ----
    this.cloudTexture = makeCloudTexture();
    this.cloudGroup = new THREE.Group();
    this.scene.add(this.cloudGroup);
    this._cloudsTarget = 0;

    // ---- chuva ----
    this.rainTex = makeRainTexture();
    this.rain = null;
    this._rainTarget = 0;

    this._palette = {
      night:  { top: 0x050a18, hor: 0x0c1626, fog: 0x0a1322, hemi: 0x1a2438, sun: 0x8090c0 },
      dawn:   { top: 0x35508e, hor: 0xf2a75c, fog: 0xc9a084, hemi: 0x8a7c8e, sun: 0xffb868 },
      day:    { top: 0x2a6fd4, hor: 0xbfd9f2, fog: 0xb6cfe4, hemi: 0xbcd8ff, sun: 0xffffff },
      dusk:   { top: 0x2c3f7c, hor: 0xef8f4e, fog: 0xc08a6e, hemi: 0x7c6a84, sun: 0xff9e50 },
    };
    this._tmpA = new THREE.Color(); this._tmpB = new THREE.Color();

    this._applyWeather();
    this.setQuality(quality);
  }

  setQuality(q) {
    this.quality = q;
    const conf = {
      low:    { clouds: 10, rain: 420 },
      medium: { clouds: 22, rain: 900 },
      high:   { clouds: 32, rain: 1500 },
      ultra:  { clouds: 46, rain: 2200 },
    }[q];
    this._cloudsTarget = conf.clouds;
    this._rainTarget = conf.rain;
    this._syncClouds();
    this._syncRain();
  }

  setWeather(key) {
    this.weatherKey = key;
    this._applyWeather();
    this._syncClouds();
  }
  _applyWeather() {
    const w = WEATHERS[this.weatherKey];
    this.windSpeed = w.wind;
    this.windDirRad = w.windDir * Math.PI / 180;
    this.gust = w.gust;
    this.turb = w.turb;
    this.cfg = w;
  }

  getWind(out, t) {
    const g = this.gust;
    const gx = turbulenceNoise(t * 0.9, 1.1) * g;
    const gy = turbulenceNoise(t * 1.3, 5.7) * g * 0.6;
    const gz = turbulenceNoise(t * 0.7, 9.3) * g;
    const ws = this.windSpeed + gx * 0.6;
    out.set(Math.cos(this.windDirRad) * ws + gx, gy * 0.5, Math.sin(this.windDirRad) * ws + gz);
    return out;
  }

  // densidade do ar exponencial com altitude (m)
  airDensity(altM) { return RHO0 * Math.exp(-Math.max(0, altM) / HSCALE); }

  setCloudCountNow(n) { this._cloudsTarget = n; this._syncClouds(); }

  _syncClouds() {
    const n = this._cloudsTarget;
    while (this.cloudGroup.children.length < n) {
      const mat = new THREE.SpriteMaterial({
        map: this.cloudTexture, transparent: true, depthWrite: false,
        opacity: 0.9, rotation: Math.random() * Math.PI * 2,
        color: 0xffffff,
      });
      const s = new THREE.Sprite(mat);
      const sc = 380 + Math.random() * 420;
      s.scale.set(sc, sc * 0.42, 1);
      s.position.set((Math.random() - 0.5) * 9000, 550 + Math.random() * 700, (Math.random() - 0.5) * 9000);
      s.userData.speed = 0.4 + Math.random() * 0.8;
      this.cloudGroup.add(s);
    }
    while (this.cloudGroup.children.length > n) this.cloudGroup.children.pop();
    for (const c of this.cloudGroup.children) c.material.opacity = this.cfg.cloudAlpha;
  }

  _syncRain() {
    const n = this._rainTarget;
    if (!this.rain) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('vel', new THREE.BufferAttribute(new Float32Array(n), 1));
      const pos = geo.attributes.position.array;
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 260;
        pos[i * 3 + 1] = Math.random() * 120;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 260;
        geo.attributes.vel.array[i] = 55 + Math.random() * 40;
      }
      this.rain = new THREE.Points(geo, new THREE.PointsMaterial({
        map: this.rainTex, size: 2.6, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true,
      }));
      this.rain.frustumCulled = false;
      this.scene.add(this.rain);
    }
    this.rain.geometry.setDrawRange(0, n);
  }

  update(dt, cameraPos, focusPos) {
    this.t += dt;
    this.timeOfDay = (this.timeOfDay + dt * this.timeSpeed / 3600) % 24;

    // ---------- posição do sol ----------
    const tH = this.timeOfDay;
    const sunAng = ((tH - 6) / 12) * Math.PI;   // 6h nasce, 18h se põe
    const elev = Math.sin(sunAng);
    const az = Math.cos(sunAng);
    this.sunDir.set(az * 0.8, elev, az * 0.45).normalize();
    const day = THREE.MathUtils.clamp(elev * 2.4, 0, 1);        // 0 noite, 1 dia pleno
    this.isNight = elev < -0.06;

    // fases: night -> dawn/dusk -> day
    let phase = 'day';
    if (elev < -0.10) phase = 'night';
    else if (elev < 0.16) phase = (tH < 12) ? 'dawn' : 'dusk';
    const pal = this._palette[phase];

    const dim = this.cfg.sunDim;
    this.skyMat.uniforms.topColor.value.setHex(pal.top).multiplyScalar(day * 0.85 + 0.15);
    this.skyMat.uniforms.horColor.value.setHex(pal.hor).multiplyScalar(Math.max(0.22, day * dim + 0.1));
    this.skyMat.uniforms.sunDir.value.copy(this.sunDir);
    this.skyMat.uniforms.glowPow.value = (phase === 'day') ? 5 : 3;
    this.skyMat.uniforms.sunGlow.value.setHex(phase === 'day' ? 0xffe9b8 : pal.sun);

    this._tmpA.setHex(pal.fog);
    FOG_COL.copy(this._tmpA);
    if (this.scene.fog) {
      this.scene.fog.color.copy(FOG_COL);
      const targetFog = this.fogDist * this.cfg.fogMul * (0.55 + 0.45 * day);
      this.scene.fog.far += (targetFog - this.scene.fog.far) * Math.min(1, dt * 0.5);
      this.scene.fog.near = this.scene.fog.far * 0.12;
    }

    // ---------- luzes ----------
    const sunI = (0.15 + 2.9 * day) * dim;
    this.sun.intensity += (sunI - this.sun.intensity) * Math.min(1, dt * 2);
    this.sun.color.setHex(pal.sun);
    this.hemi.intensity = 0.12 + 0.75 * day * dim;
    this.hemi.color.setHex(pal.hemi);
    this.ambient.intensity = 0.1 + 0.2 * day;

    // sombras seguem a aeronave
    const f = focusPos;
    this.sun.position.copy(f).addScaledVector(this.sunDir, 400);
    this.sun.target.position.copy(f);

    // céu/sol/lua seguem a câmera (domo "infinito")
    this.skyDome.position.copy(cameraPos);
    this.stars.position.copy(cameraPos);
    this.sunSprite.position.copy(cameraPos).addScaledVector(this.sunDir, 9500);
    this.sunSprite.material.opacity = THREE.MathUtils.clamp(day * 1.4, 0, 1);
    this.moonSprite.position.copy(cameraPos).addScaledVector(this.sunDir, -9300).add(new THREE.Vector3(0, 900, 0));
    this.moonSprite.material.opacity = this.isNight ? 0.85 : 0;
    this.stars.material.opacity = this.isNight ? 0.9 : THREE.MathUtils.clamp((0.1 - elev) * 3, 0, 0.6);

    // ---------- nuvens ----------
    const wx = Math.cos(this.windDirRad) * this.windSpeed, wz = Math.sin(this.windDirRad) * this.windSpeed;
    for (const c of this.cloudGroup.children) {
      c.position.x += wx * c.userData.speed * dt;
      c.position.z += wz * c.userData.speed * dt;
      // recicla nuvens distantes ao redor da câmera
      const dx = c.position.x - cameraPos.x, dz = c.position.z - cameraPos.z;
      if (Math.abs(dx) > 5200) c.position.x = cameraPos.x - Math.sign(dx) * 5000 + (Math.random() - 0.5) * 800;
      if (Math.abs(dz) > 5200) c.position.z = cameraPos.z - Math.sign(dz) * 5000 + (Math.random() - 0.5) * 800;
      c.material.color.setScalar(0.35 + 0.65 * day);
    }

    // ---------- chuva ----------
    if (this.cfg.rain > 0 && this.rain) {
      const p = this.rain.geometry.attributes.position.array;
      const v = this.rain.geometry.attributes.vel.array;
      const n = this._rainTarget;
      this.rain.position.copy(cameraPos);
      for (let i = 0; i < n; i++) {
        p[i * 3 + 1] -= v[i] * dt;
        p[i * 3] += wx * dt * 0.7;
        if (p[i * 3 + 1] < -10) {
          p[i * 3] = (Math.random() - 0.5) * 260;
          p[i * 3 + 1] = 110 + Math.random() * 30;
          p[i * 3 + 2] = (Math.random() - 0.5) * 260;
        }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.material.opacity += ((this.cfg.rain ? 0.75 : 0) - this.rain.material.opacity) * Math.min(1, dt * 2);
    } else if (this.rain) {
      this.rain.material.opacity += (0 - this.rain.material.opacity) * Math.min(1, dt * 2);
    }

    // ---------- relâmpagos ----------
    if (this.cfg.lightning > 0) {
      this._lightningT -= dt;
      if (this._lightningT <= 0) {
        this.lightning = 1.0;
        this._lightningT = 4 + Math.random() * 14;
        if (this.onLightning) this.onLightning();
      }
    }
    this.lightning = Math.max(0, this.lightning - dt * 3.2);
    if (this.lightning > 0) {
      this.hemi.intensity += this.lightning * 2.2;
      this.skyMat.uniforms.horColor.value.addScalar(this.lightning * 0.35);
    }
  }

  // cor ambiente média para materiais emissivos (janelas à noite etc.)
  get nightFactor() { return THREE.MathUtils.clamp(-this.sunDir.y * 4 + 0.3, 0, 1); }
}
