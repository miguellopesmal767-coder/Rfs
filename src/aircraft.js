// ============================================================================
// aircraft.js — Aeronaves detalhadas (fuselagem, asas, motores, superfícies
// de controle animadas, trem retrátil, cockpit funcional) + especificações
// de física individuais.
// Eixo: nariz para +Z, asa ao longo de X, cima +Y.
// ============================================================================
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// ESPECIFICAÇÕES DE FÍSICA (SI)
// ---------------------------------------------------------------------------
export const SPECS = {
  cessna: {
    key: 'cessna', name: 'SK-172 Skytourer', type: 'MONOMOTOR A PISTÃO',
    desc: 'Leve e estável · ideal para treino',
    mass: 1000, fuelCap: 130, fuelBurn: 0.0078,          // kg, kg/s @100%
    S: 16.2, b: 11.0, chord: 1.5,
    CL0: 0.33, CLa: 5.05, alphaStall: 16.2, CD0: 0.034, kInd: 0.055,
    flaps: [{ name: 'UP', cl: 0, cd: 0 }, { name: '15°', cl: 0.38, cd: 0.022 }, { name: '30°', cl: 0.72, cd: 0.065 }],
    engine: { type: 'prop', count: 1, maxThrust: 4300, spool: 0.9, thrustFade: 0.55 },
    hasReverse: false, hasSpoiler: false,
    gear: { height: 0.85, drag: 0.02, retractable: true, steer: 0.85 },
    vne: 84, vRotate: 28, vApproach: 33,
    // potências de comando (rad/s² por unidade a q_ref) e amortecimentos
    pitchPow: 13, rollPow: 62, yawPow: 16,
    pitchDamp: 18, rollDamp: 20, yawDamp: 12,
    pitchStab: 30, yawStab: 5.0, qRef: 900,
    gearY: 0.85, restPitch: -0.016,
    cam: { cockpit: [0, 0.62, 1.1], chase: [0, 3.4, -13], ext: 16 },
    sound: 'prop',
  },
  jet: {
    key: 'jet', name: 'EJ-450 Prestige', type: 'JATO EXECUTIVO',
    desc: 'Bimotores · cabine privativa · rápido',
    mass: 7200, fuelCap: 2600, fuelBurn: 0.34,
    S: 26.5, b: 15.6, chord: 2.2,
    CL0: 0.22, CLa: 4.85, alphaStall: 14.5, CD0: 0.023, kInd: 0.046,
    flaps: [{ name: 'UP', cl: 0, cd: 0 }, { name: '10°', cl: 0.28, cd: 0.014 }, { name: '20°', cl: 0.55, cd: 0.042 }, { name: 'FULL', cl: 0.85, cd: 0.09 }],
    engine: { type: 'jet', count: 2, maxThrust: 30000, spool: 2.4, thrustFade: 0.25 },
    hasReverse: true, hasSpoiler: true,
    gear: { height: 1.25, drag: 0.018, retractable: true, steer: 0.6 },
    vne: 165, vRotate: 62, vApproach: 68,
    pitchPow: 11, rollPow: 34, yawPow: 8,
    pitchDamp: 9, rollDamp: 15, yawDamp: 8,
    pitchStab: 22, yawStab: 4.5, qRef: 2400,
    gearY: 1.25, restPitch: -0.006,
    cam: { cockpit: [0, 1.05, 5.6], chase: [0, 5.2, -24], ext: 26 },
    sound: 'jet',
  },
  airliner: {
    key: 'airliner', name: 'A-320 JatoLinha', type: 'AVIÃO COMERCIAL',
    desc: 'Bimotor a jato · 150 pax · longo alcance',
    mass: 52000, fuelCap: 15000, fuelBurn: 2.5,
    S: 181, b: 36, chord: 5.2,
    CL0: 0.22, CLa: 5.55, alphaStall: 15.0, CD0: 0.024, kInd: 0.044,
    flaps: [{ name: 'UP', cl: 0, cd: 0 }, { name: '10°', cl: 0.3, cd: 0.016 }, { name: '20°', cl: 0.66, cd: 0.05 }, { name: 'FULL', cl: 1.05, cd: 0.115 }],
    engine: { type: 'jet', count: 2, maxThrust: 240000, spool: 3.6, thrustFade: 0.18 },
    hasReverse: true, hasSpoiler: true,
    gear: { height: 3.3, drag: 0.02, retractable: true, steer: 0.42 },
    vne: 180, vRotate: 74, vApproach: 72,
    pitchPow: 4.6, rollPow: 13, yawPow: 3.6,
    pitchDamp: 5.5, rollDamp: 9, yawDamp: 5.5,
    pitchStab: 14, yawStab: 3.2, qRef: 9000,
    gearY: 3.3, restPitch: -0.004,
    cam: { cockpit: [0, 2.2, 14.5], chase: [0, 12, -58], ext: 55 },
    sound: 'jet',
  },
};

// ---------------------------------------------------------------------------
// materiais auxiliares
// ---------------------------------------------------------------------------
const matGlass = () => new THREE.MeshStandardMaterial({ color: 0x22344a, roughness: 0.08, metalness: 0.9 });
const matDark = () => new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.7 });
const matTire = () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 });
const matMetal = () => new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.32, metalness: 0.85 });

function fuselageMat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.55 });
}
function windowStripTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 64);
  g.fillStyle = '#9fd0ff';
  for (let x = 12; x < 500; x += 18) g.fillRect(x, 22, 8, 11);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// instrumentos do cockpit (texturas de canvas atualizadas)
// ---------------------------------------------------------------------------
class Gauge {
  constructor(size, draw) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = size; this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw = draw;
    this.size = size;
    this._t = 0;
  }
  update(state) {
    this.ctx.clearRect(0, 0, this.size, this.size);
    this.draw(this.ctx, this.size, state);
    this.texture.needsUpdate = true;
  }
}

function dialBase(g, s, label) {
  g.fillStyle = '#0a0e14'; g.fillRect(0, 0, s, s);
  g.fillStyle = '#101820'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2a3a4c'; g.lineWidth = s * 0.02;
  g.beginPath(); g.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#8fb4d6'; g.font = `${s * 0.09}px Arial`; g.textAlign = 'center';
  g.fillText(label, s / 2, s * 0.78);
}
function needle(g, s, ang, len, color, w) {
  g.save(); g.translate(s / 2, s / 2); g.rotate(ang);
  g.strokeStyle = color; g.lineWidth = w || s * 0.02;
  g.beginPath(); g.moveTo(0, s * 0.08); g.lineTo(0, -s * len); g.stroke();
  g.restore();
}
const TAU = Math.PI * 2;

export class CockpitInstruments {
  constructor() {
    // indicador de atitude
    this.att = new Gauge(256, (g, s, st) => {
      g.save();
      g.beginPath(); g.arc(s / 2, s / 2, s * 0.46, 0, TAU); g.clip();
      const pitchPx = THREE.MathUtils.clamp(st.pitchDeg / 40, -1.2, 1.2) * s * 0.42;
      const rollRad = -st.rollRad;
      g.save(); g.translate(s / 2, s / 2); g.rotate(rollRad); g.translate(0, pitchPx);
      g.fillStyle = '#2f7fd4'; g.fillRect(-s, -s * 1.6, s * 2, s * 1.6);
      g.fillStyle = '#7a4d2a'; g.fillRect(-s, 0, s * 2, s * 1.6);
      g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(-s, 0); g.lineTo(s, 0); g.stroke();
      for (const d of [-20, -10, 10, 20]) {
        const y = -d / 40 * s * 0.42;
        g.beginPath(); g.moveTo(-s * 0.14, y); g.lineTo(s * 0.14, y); g.stroke();
      }
      g.restore();
      // marca fixa da aeronave
      g.strokeStyle = '#ffcf3d'; g.lineWidth = s * 0.025;
      g.beginPath(); g.moveTo(s * 0.2, s / 2); g.lineTo(s * 0.38, s / 2); g.lineTo(s * 0.44, s / 2 + s * 0.05);
      g.moveTo(s * 0.8 - s * 0.2, s / 2); g.lineTo(s * (1 - 0.38), s / 2); g.lineTo(s * (1 - 0.44), s / 2 + s * 0.05);
      g.stroke();
      g.restore();
      g.strokeStyle = '#2a3a4c'; g.lineWidth = s * 0.02;
      g.beginPath(); g.arc(s / 2, s / 2, s * 0.46, 0, TAU); g.stroke();
    });
    // velocidade
    this.asi = new Gauge(256, (g, s, st) => {
      dialBase(g, s, 'KT');
      for (let v = 0; v <= 200; v += 20) {
        const a = -Math.PI * 1.25 + (v / 200) * TAU * 0.75;
        g.save(); g.translate(s / 2, s / 2); g.rotate(a);
        g.strokeStyle = v >= st.vneKt ? '#ff5050' : '#cfe4f7'; g.lineWidth = s * 0.012;
        g.beginPath(); g.moveTo(0, -s * 0.38); g.lineTo(0, -s * 0.44); g.stroke();
        if (v % 40 === 0) {
          g.fillStyle = '#cfe4f7'; g.font = `${s * 0.1}px Arial`; g.textAlign = 'center';
          g.fillText(v, Math.sin(a) * s * 0.3, -Math.cos(a) * s * 0.3 + s * 0.035);
        }
        g.restore();
      }
      needle(g, s, -Math.PI * 1.25 + THREE.MathUtils.clamp(st.iasKt / 200, 0, 1) * TAU * 0.75, 0.36, '#ff5a3c');
      g.fillStyle = '#fff'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.03, 0, TAU); g.fill();
    });
    // altímetro
    this.alt = new Gauge(256, (g, s, st) => {
      dialBase(g, s, 'FT x100');
      for (let v = 0; v < 10; v++) {
        const a = (v / 10) * TAU;
        g.save(); g.translate(s / 2, s / 2); g.rotate(a);
        g.strokeStyle = '#cfe4f7'; g.lineWidth = s * 0.012;
        g.beginPath(); g.moveTo(0, -s * 0.38); g.lineTo(0, -s * 0.44); g.stroke();
        g.restore();
      }
      needle(g, s, (st.altFt % 10000) / 10000 * TAU, 0.34, '#fff');
      needle(g, s, (st.altFt / 100000) * TAU, 0.2, '#8fb4d6', s * 0.03);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.03, 0, TAU); g.fill();
    });
    this.gauges = [this.att, this.asi, this.alt];
    this._acc = 0;
  }
  update(dt, state) {
    this._acc += dt;
    if (this._acc < 0.1) return;   // 10 Hz
    this._acc = 0;
    this.att.update(state); this.asi.update(state); this.alt.update(state);
  }
}

// ---------------------------------------------------------------------------
function makeWheel(r, w) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 12), matTire());
  tire.rotation.z = Math.PI / 2;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, w * 1.05, 8), matMetal());
  hub.rotation.z = Math.PI / 2;
  g.add(tire, hub);
  g.userData.r = r;
  return g;
}

// Superfície de controle articulada
function surface(wingSpan, chord, thick, material) {
  const pivot = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(wingSpan, thick, chord), material);
  m.position.z = chord / 2;
  pivot.add(m);
  return pivot;
}

// ---------------------------------------------------------------------------
// CONSTRUÇÃO DAS AERONAVES
// ---------------------------------------------------------------------------
function buildCessna() {
  const grp = new THREE.Group();
  const parts = {};
  const white = fuselageMat(0xe9edf2);
  const accent = fuselageMat(0x2a6fd4);
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.3, metalness: 0.45 });

  // fuselagem
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.5, 5.2, 12), white);
  fus.rotation.x = Math.PI / 2; fus.position.z = 0.2;
  fus.userData.cockpitHide = true;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.5, 12), accent);
  nose.rotation.x = Math.PI / 2; nose.position.z = 3.55;
  nose.userData.cockpitHide = true;
  const tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.8, 10), white);
  tailCone.rotation.x = -Math.PI / 2; tailCone.position.z = -3.2;
  grp.add(fus, nose, tailCone);

  // para-brisa / cabine
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 1.7), matGlass());
  cabin.position.set(0, 0.42, 1.5);
  cabin.userData.cockpitHide = true;
  grp.add(cabin);

  // asa alta
  const wing = new THREE.Mesh(new THREE.BoxGeometry(11, 0.16, 1.55), wingMat);
  wing.position.set(0, 0.95, 0.75);
  wing.rotation.y = 0;
  grp.add(wing);
  for (const s of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.9, 6), matMetal());
    strut.position.set(s * 1.7, 0.35, 0.7);
    strut.rotation.z = s * 0.85;
    grp.add(strut);
    // ponta
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 1.2), accent);
    tip.position.set(s * 5.6, 0.95, 0.75);
    grp.add(tip);
  }

  // flaps + ailerons (articulados)
  parts.flapL = surface(2.6, 0.5, 0.09, accent); parts.flapL.position.set(-1.9, 0.95, -0.05);
  parts.flapR = surface(2.6, 0.5, 0.09, accent); parts.flapR.position.set(1.9, 0.95, -0.05);
  parts.ailL = surface(2.4, 0.42, 0.08, accent); parts.ailL.position.set(-4.2, 0.95, -0.02);
  parts.ailR = surface(2.4, 0.42, 0.08, accent); parts.ailR.position.set(4.2, 0.95, -0.02);
  grp.add(parts.flapL, parts.flapR, parts.ailL, parts.ailR);

  // empenagem
  const hStab = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 1.0), wingMat);
  hStab.position.set(0, 0.18, -4.1);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 1.1), wingMat);
  fin.position.set(0, 0.85, -4.2);
  grp.add(hStab, fin);
  const finTip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 1.1), accent);
  finTip.position.set(0, 1.7, -4.2);
  grp.add(finTip);

  parts.elev = surface(3.3, 0.4, 0.07, accent); parts.elev.position.set(0, 0.18, -4.65);
  parts.rudder = surface(1.0, 0.5, 0.07, accent);
  parts.rudder.rotation.y = Math.PI / 2;
  parts.rudder.position.set(0, 0.85, -4.75);
  // rudder pivot: caixa vertical
  parts.rudder.children[0].geometry = new THREE.BoxGeometry(0.09, 1.3, 0.5);
  parts.rudder.children[0].position.set(0, 0, 0.25);
  grp.add(parts.elev, parts.rudder);

  // hélice
  const propG = new THREE.Group();
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 10), matMetal());
  spinner.rotation.x = Math.PI / 2; spinner.position.z = 0.25;
  const blade1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.9, 0.05), matDark());
  const blade2 = blade1.clone(); blade2.rotation.z = Math.PI / 2;
  propG.add(spinner, blade1, blade2);
  propG.position.z = 4.35;
  parts.prop = propG;
  grp.add(propG);

  // trem de pouso retrátil
  parts.gear = new THREE.Group();
  const mkLeg = (x, z, len, wheelR) => {
    const lg = new THREE.Group();
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 6), matMetal());
    leg.position.y = -len / 2;
    const wheel = makeWheel(wheelR, 0.18);
    wheel.position.y = -len;
    lg.add(leg, wheel);
    lg.position.set(x, 0, z);
    lg.userData.wheel = wheel;
    return lg;
  };
  parts.gearN = mkLeg(0, 2.4, 0.62, 0.24);
  parts.gearM = new THREE.Group();
  const mLegL = mkLeg(-1.35, 0.35, 0.55, 0.27);
  const mLegR = mkLeg(1.35, 0.35, 0.55, 0.27);
  parts.gearM.add(mLegL, mLegR);
  parts.gear.add(parts.gearN, parts.gearM);
  parts.gear.position.y = 0.0;
  grp.add(parts.gear);
  parts.wheels = [parts.gearN.userData.wheel, mLegL.userData.wheel, mLegR.userData.wheel];

  // luzes
  parts.navL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  parts.navL.position.set(-5.8, 0.95, 0.75);
  parts.navR = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: 0x20ff40 }));
  parts.navR.position.set(5.8, 0.95, 0.75);
  parts.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  parts.beacon.position.set(0, 1.85, -0.5);
  parts.strobeL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  parts.strobeL.position.copy(parts.navL.position);
  parts.strobeR = parts.strobeL.clone(); parts.strobeR.position.copy(parts.navR.position);
  grp.add(parts.navL, parts.navR, parts.beacon, parts.strobeL, parts.strobeR);

  grp.traverse(o => { if (o.isMesh && o.material !== matTire()) { o.castShadow = true; } });
  return { grp, parts };
}

// ---------------------------------------------------------------------------
function buildJet() {
  const grp = new THREE.Group();
  const parts = {};
  const white = fuselageMat(0xf2f4f7);
  const accent = fuselageMat(0x1f3f6e);
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf1, roughness: 0.3, metalness: 0.5 });

  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.7, 10.5, 14), white);
  fus.rotation.x = Math.PI / 2; fus.position.z = 0;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.95, 2.6, 14), white);
  nose.rotation.x = Math.PI / 2; nose.position.z = 6.5;
  const tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.4, 12), accent);
  tailCone.rotation.x = -Math.PI / 2; tailCone.position.z = -6.9;
  fus.userData.cockpitHide = true;
  nose.userData.cockpitHide = true;
  grp.add(fus, nose, tailCone);

  const winTex = windowStripTexture();
  winTex.repeat.set(4, 1);
  const winMat = new THREE.MeshStandardMaterial({
    color: 0x18263a, roughness: 0.15, metalness: 0.8,
    emissive: 0xffdf9e, emissiveMap: winTex, emissiveIntensity: 0,
  });
  const winStrip = new THREE.Mesh(new THREE.CylinderGeometry(0.96, 0.96, 7.4, 14, 1, true), winMat);
  winStrip.rotation.x = Math.PI / 2; winStrip.position.z = 0.6;
  winStrip.userData.cockpitHide = true;
  grp.add(winStrip);
  parts.windowMat = winMat;

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.62, 1.5), matGlass());
  cockpit.position.set(0, 0.55, 5.3);
  cockpit.userData.cockpitHide = true;
  grp.add(cockpit);

  // asas baixas enflechadas
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(7.3, 0.2, 2.3), wingMat);
    w.position.set(s * 3.9, -0.35, -0.4);
    w.rotation.y = -s * 0.42;
    w.rotation.z = s * 0.06;
    grp.add(w);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 1.1), accent);
    tip.position.set(s * 7.35, 0.02, -1.75);
    tip.rotation.y = -s * 0.42;
    grp.add(tip);
  }
  parts.flapL = surface(3.2, 0.7, 0.1, accent); parts.flapL.position.set(-3.2, -0.33, -1.25); parts.flapL.rotation.y = 0.42;
  parts.flapR = surface(3.2, 0.7, 0.1, accent); parts.flapR.position.set(3.2, -0.33, -1.25); parts.flapR.rotation.y = -0.42;
  parts.ailL = surface(2.6, 0.55, 0.09, accent); parts.ailL.position.set(-5.6, -0.26, -1.9); parts.ailL.rotation.y = 0.42;
  parts.ailR = surface(2.6, 0.55, 0.09, accent); parts.ailR.position.set(5.6, -0.26, -1.9); parts.ailR.rotation.y = -0.42;
  grp.add(parts.flapL, parts.flapR, parts.ailL, parts.ailR);

  // motores traseiros
  parts.fans = [];
  for (const s of [-1, 1]) {
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.55, 2.3, 12), matMetal());
    nac.rotation.x = Math.PI / 2;
    nac.position.set(s * 1.35, 0.32, -3.6);
    const intake = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.08, 8, 14), matDark());
    intake.position.set(s * 1.35, 0.32, -2.45);
    const fan = new THREE.Group();
    for (let b = 0; b < 9; b++) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.03), matDark());
      bl.rotation.z = (b / 9) * TAU;
      bl.position.set(Math.sin((b / 9) * TAU) * 0.26, Math.cos((b / 9) * TAU) * 0.26, 0);
      fan.add(bl);
    }
    fan.position.set(s * 1.35, 0.32, -2.5);
    grp.add(nac, intake, fan);
    parts.fans.push(fan);
  }

  // T-cauda
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 1.9), accent);
  fin.position.set(0, 1.8, -5.6);
  const hStab = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.13, 1.5), wingMat);
  hStab.position.set(0, 3.05, -5.9);
  grp.add(fin, hStab);
  parts.elev = surface(5.4, 0.6, 0.09, accent); parts.elev.position.set(0, 3.05, -6.68);
  parts.rudder = new THREE.Group();
  const rud = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.2, 0.8), accent);
  rud.position.set(0, 0, 0.42);
  parts.rudder.add(rud);
  parts.rudder.position.set(0, 1.85, -6.05);
  grp.add(parts.elev, parts.rudder);

  // trem
  parts.gear = new THREE.Group();
  const mkLeg = (x, z, len, wheelR, wheelW) => {
    const lg = new THREE.Group();
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 6), matMetal());
    leg.position.y = -len / 2;
    const wheel = makeWheel(wheelR, wheelW);
    wheel.position.y = -len;
    lg.add(leg, wheel);
    lg.position.set(x, 0, z);
    lg.userData.wheel = wheel;
    return lg;
  };
  parts.gearN = mkLeg(0, 4.4, 0.85, 0.26, 0.16);
  parts.gearM = new THREE.Group();
  const mL = mkLeg(-1.5, -0.6, 0.95, 0.3, 0.2);
  const mR = mkLeg(1.5, -0.6, 0.95, 0.3, 0.2);
  parts.gearM.add(mL, mR);
  parts.gear.add(parts.gearN, parts.gearM);
  grp.add(parts.gear);
  parts.wheels = [parts.gearN.userData.wheel, mL.userData.wheel, mR.userData.wheel];

  // spoilers
  parts.spoilers = [];
  for (const s of [-1, 1]) {
    const sp = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.7), accent);
    panel.position.z = 0.35;
    sp.add(panel);
    sp.position.set(s * 2.6, -0.2, -0.6);
    grp.add(sp);
    parts.spoilers.push(sp);
  }

  // luzes
  parts.navL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  parts.navL.position.set(-7.6, 0, -1.8);
  parts.navR = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color: 0x20ff40 }));
  parts.navR.position.set(7.6, 0, -1.8);
  parts.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  parts.beacon.position.set(0, 1.0, 0.4);
  parts.strobeL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  parts.strobeL.position.copy(parts.navL.position);
  parts.strobeR = parts.strobeL.clone(); parts.strobeR.position.copy(parts.navR.position);
  grp.add(parts.navL, parts.navR, parts.beacon, parts.strobeL, parts.strobeR);

  grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { grp, parts };
}

// ---------------------------------------------------------------------------
function buildAirliner() {
  const grp = new THREE.Group();
  const parts = {};
  const white = fuselageMat(0xf4f6f8);
  const accent = fuselageMat(0x0f9d58);
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.34, metalness: 0.5 });

  const fus = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 1.7, 30, 18), white);
  fus.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(2.0, 18, 12), white);
  nose.scale.set(1, 1, 2.4); nose.position.z = 15;
  const tailCone = new THREE.Mesh(new THREE.ConeGeometry(1.7, 6.5, 14), white);
  tailCone.rotation.x = -Math.PI / 2; tailCone.position.z = -18.2;
  fus.userData.cockpitHide = true;
  nose.userData.cockpitHide = true;
  grp.add(fus, nose, tailCone);

  const winTex = windowStripTexture();
  winTex.repeat.set(10, 1);
  const winMat = new THREE.MeshStandardMaterial({
    color: 0x18263a, roughness: 0.15, metalness: 0.8,
    emissive: 0xffdf9e, emissiveMap: winTex, emissiveIntensity: 0,
  });
  const winStrip = new THREE.Mesh(new THREE.CylinderGeometry(2.02, 2.02, 26, 18, 1, true), winMat);
  winStrip.rotation.x = Math.PI / 2;
  winStrip.userData.cockpitHide = true;
  grp.add(winStrip);
  parts.windowMat = winMat;

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 1.9), matGlass());
  cockpit.position.set(0, 1.2, 15.6);
  cockpit.userData.cockpitHide = true;
  grp.add(cockpit);

  // faixa da livery
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(2.03, 1.72, 30, 18, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x0f9d58, roughness: 0.35, metalness: 0.5, side: THREE.DoubleSide }));
  stripe.rotation.x = Math.PI / 2;
  stripe.scale.y = 0.06;   // anel fino? — não; use posição
  grp.remove(stripe);

  // asas enflechadas com diedro
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(16.5, 0.55, 4.6), wingMat);
    w.position.set(s * 8.6, -1.1, -1.2);
    w.rotation.y = -s * 0.5;
    w.rotation.z = s * 0.09;
    grp.add(w);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, 2.2), accent);
    tip.position.set(s * 16.4, -0.2, -4.9);
    tip.rotation.y = -s * 0.5;
    grp.add(tip);
  }
  parts.flapL = surface(6.5, 1.6, 0.22, accent); parts.flapL.position.set(-5.0, -1.05, -3.2); parts.flapL.rotation.y = 0.5;
  parts.flapR = surface(6.5, 1.6, 0.22, accent); parts.flapR.position.set(5.0, -1.05, -3.2); parts.flapR.rotation.y = -0.5;
  parts.ailL = surface(5.0, 1.2, 0.18, accent); parts.ailL.position.set(-12.0, -0.62, -5.6); parts.ailL.rotation.y = 0.5;
  parts.ailR = surface(5.0, 1.2, 0.18, accent); parts.ailR.position.set(12.0, -0.62, -5.6); parts.ailR.rotation.y = -0.5;
  grp.add(parts.flapL, parts.flapR, parts.ailL, parts.ailR);

  // motores sob as asas
  parts.fans = [];
  for (const s of [-1, 1]) {
    const nacG = new THREE.Group();
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.35, 4.6, 16), matMetal());
    nac.rotation.x = Math.PI / 2;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.16, 8, 16), matDark());
    lip.position.z = -2.3;
    const fan = new THREE.Group();
    for (let b = 0; b < 12; b++) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.3, 0.05), matDark());
      bl.rotation.z = (b / 12) * TAU;
      bl.position.set(Math.sin((b / 12) * TAU) * 0.66, Math.cos((b / 12) * TAU) * 0.66, 0);
      fan.add(bl);
    }
    fan.position.z = -2.1;
    nacG.add(nac, lip, fan);
    nacG.position.set(s * 6.4, -2.6, -0.6);
    nacG.rotation.y = s * 0.06;
    grp.add(nacG);
    parts.fans.push(fan);
  }

  // empenagem
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.35, 7.4, 5.2), accent);
  fin.position.set(0, 4.6, -16.6);
  const hStab = new THREE.Mesh(new THREE.BoxGeometry(13.5, 0.4, 3.4), wingMat);
  hStab.position.set(0, 1.6, -17.6);
  grp.add(fin, hStab);
  parts.elev = surface(13.0, 1.4, 0.2, accent); parts.elev.position.set(0, 1.6, -19.35);
  parts.rudder = new THREE.Group();
  const rud = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6.2, 2.0), accent);
  rud.position.set(0, 0, 1.05);
  parts.rudder.add(rud);
  parts.rudder.position.set(0, 4.4, -17.5);
  grp.add(parts.elev, parts.rudder);

  // trem de pouso alto
  parts.gear = new THREE.Group();
  const mkLeg = (x, z, len, wheelR, wheelW, wheels = 1) => {
    const lg = new THREE.Group();
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, len, 8), matMetal());
    leg.position.y = -len / 2;
    lg.add(leg);
    const wh = [];
    for (let i = 0; i < wheels; i++) {
      const wheel = makeWheel(wheelR, wheelW);
      wheel.position.set(i % 2 === 0 ? 0.42 * wheelR : -0.42 * wheelR, -len, 0);
      lg.add(wheel); wh.push(wheel);
    }
    lg.position.set(x, 0, z);
    lg.userData.wheels = wh;
    return lg;
  };
  parts.gearN = mkLeg(0, 12.4, 2.4, 0.5, 0.3);
  parts.gearM = new THREE.Group();
  const mL = mkLeg(-3.1, -1.4, 2.7, 0.62, 0.4, 2);
  const mR = mkLeg(3.1, -1.4, 2.7, 0.62, 0.4, 2);
  parts.gearM.add(mL, mR);
  parts.gear.add(parts.gearN, parts.gearM);
  grp.add(parts.gear);
  parts.wheels = [...parts.gearN.userData.wheels, ...mL.userData.wheels, ...mR.userData.wheels];

  // spoilers
  parts.spoilers = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const sp = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 1.1), accent);
      panel.position.z = 0.55;
      sp.add(panel);
      sp.position.set(s * (6 + i * 4), -0.75, -2.4);
      grp.add(sp);
      parts.spoilers.push(sp);
    }
  }

  // luzes
  parts.navL = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  parts.navL.position.set(-16.8, -0.15, -4.6);
  parts.navR = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 4), new THREE.MeshBasicMaterial({ color: 0x20ff40 }));
  parts.navR.position.set(16.8, -0.15, -4.6);
  parts.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  parts.beacon.position.set(0, 2.15, 2);
  parts.strobeL = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  parts.strobeL.position.copy(parts.navL.position);
  parts.strobeR = parts.strobeL.clone(); parts.strobeR.position.copy(parts.navR.position);
  grp.add(parts.navL, parts.navR, parts.beacon, parts.strobeL, parts.strobeR);

  grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { grp, parts };
}

// ---------------------------------------------------------------------------
// COCKPIT (painel funcional compartilhado)
// ---------------------------------------------------------------------------
export function buildCockpit(spec, instruments) {
  const g = new THREE.Group();
  const [cx, cy, cz] = spec.cam.cockpit;
  const panelW = spec.key === 'airliner' ? 3.4 : 1.7;
  const panelY = cy - 0.32;

  const dash = new THREE.Mesh(new THREE.BoxGeometry(panelW, 0.34, 0.42), matDark());
  dash.position.set(cx, panelY, cz + 0.58);
  const shade = new THREE.Mesh(new THREE.BoxGeometry(panelW + 0.2, 0.44, 0.34), matDark());
  shade.position.set(cx, panelY + 0.52, cz + 0.5);
  shade.rotation.x = -0.9;
  g.add(dash, shade);

  const gaugeMeshes = [];
  const gw = panelW * 0.2;
  const order = [instruments.asi, instruments.att, instruments.alt];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(gw, gw),
      new THREE.MeshBasicMaterial({ map: order[i].texture, toneMapped: false })
    );
    m.position.set(cx + (i - 1) * gw * 1.15, panelY + 0.3, cz + 0.42);
    m.rotation.x = -0.1;
    g.add(m);
    gaugeMeshes.push(m);
  }

  // manche / sidestick
  const yoke = new THREE.Group();
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8), matDark());
  column.position.y = -0.25;
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.028, 8, 16), matDark());
  wheel.rotation.x = Math.PI / 2;
  yoke.add(column, wheel);
  yoke.position.set(cx + (panelW > 2 ? -panelW * 0.32 : 0), panelY - 0.05, cz + 0.2);
  g.add(yoke);

  // manetes
  const thrG = new THREE.Group();
  for (let i = 0; i < (spec.engine.count > 1 ? 2 : 1); i++) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.3, 6), matMetal());
    t.position.set(i * 0.09 - 0.045, 0, 0);
    t.rotation.x = -0.8;
    thrG.add(t);
  }
  thrG.position.set(cx + panelW * 0.32, panelY - 0.02, cz + 0.3);
  g.add(thrG);

  // luz interna (painel iluminado também de dia, intensidade sobe à noite)
  const light = new THREE.PointLight(0xffd9a0, 1.6, 6, 2);
  light.position.set(cx, panelY + 0.55, cz + 0.45);
  g.add(light);

  return { group: g, yoke, throttle: thrG, light };
}

// ---------------------------------------------------------------------------
export function buildAircraft(key) {
  const spec = SPECS[key];
  let built;
  if (key === 'cessna') built = buildCessna();
  else if (key === 'jet') built = buildJet();
  else built = buildAirliner();
  return { group: built.grp, parts: built.parts, spec };
}
