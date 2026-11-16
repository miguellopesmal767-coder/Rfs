// ============================================================================
// main.js — Real Flight Simulator 3D: integração de todos os sistemas.
// ============================================================================
import * as THREE from 'three';
import { Environment, WEATHERS } from './env.js';
import { World, terrainHeight, WORLD } from './world.js';
import { SPECS, buildAircraft, buildCockpit, CockpitInstruments } from './aircraft.js';
import { FlightModel } from './physics.js';
import { SoundSystem } from './audio.js';
import { InputSystem } from './controls.js';
import { HUD } from './hud.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const MS2KT = 1.94384;
const FT = 3.28084;

window.__errors = [];
window.addEventListener('error', (e) => {
  if (window.__errors.length < 20) window.__errors.push(String(e.message || e));
});

// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const canvas = $('gl');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb6cfe4, 500, 6000);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 15000);

const env = new Environment(scene, 'medium');
const world = new World(scene, env, 'medium');
const sound = new SoundSystem();
env.onLightning = () => sound.thunder();

const hud = new HUD();
const instruments = new CockpitInstruments();
const input = new InputSystem();

// ---------------------------------------------------------------------------
// estado do jogo
// ---------------------------------------------------------------------------
const GAME = {
  started: false,
  paused: false,
  aircraftKey: 'cessna',
  startMode: 'runway',
  quality: 'medium',
  camMode: 0,                       // 0 externa, 1 perseguição, 2 cockpit, 3 lateral
  camNames: ['CÂMERA EXTERNA', 'PERSEGUIÇÃO', 'COCKPIT', 'LATERAL'],
  orbit: { yaw: 2.2, pitch: 0.34, dist: 18 },
  tSim: 0,
  fm: null,
  ac: null,                         // { group, parts, spec }
  cockpit: null,
  touchMsg: '',
  lastAGL: Infinity,
  wasGround: false,
  fps: 0,
};

// ---------------------------------------------------------------------------
// construção da aeronave
// ---------------------------------------------------------------------------
function spawnAircraft(key) {
  if (GAME.ac) {
    scene.remove(GAME.ac.group);
    scene.remove(GAME.cockpit.group);
  }
  const { group, parts, spec } = buildAircraft(key);

  // disco de blur da hélice/fan
  const blurMat = new THREE.MeshBasicMaterial({ color: 0x1a1d22, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  if (parts.prop) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.98, 18), blurMat);
    parts.prop.add(disc);
    parts.blur = disc;
  }
  if (parts.fans) {
    parts.blurFans = [];
    for (const f of parts.fans) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.45, 18), blurMat.clone());
      parts.blurFans.push(disc);
      f.add(disc);
    }
  }

  // luz de pouso
  const landingLight = new THREE.SpotLight(0xfff2cc, 0, 260, 0.5, 0.5, 1.2);
  landingLight.position.set(0, -0.4, spec.key === 'airliner' ? 16 : 4);
  const llTarget = new THREE.Object3D();
  llTarget.position.set(0, -6, 80);
  group.add(landingLight, llTarget);
  landingLight.target = llTarget;
  parts.landingLight = landingLight;

  scene.add(group);
  const cockpit = buildCockpit(spec, instruments);
  // cockpit vive na cena (não na aeronave) e acompanha o transform no loop
  scene.add(cockpit.group);
  cockpit.group.visible = false;

  GAME.ac = { group, parts, spec };
  GAME.cockpit = cockpit;
  GAME.fm = new FlightModel(spec);

  // botões não aplicáveis ficam desativados
  $('btnSpr').classList.toggle('off', !spec.hasSpoiler);
  $('btnRvs').classList.toggle('off', !spec.hasReverse);

  GAME.orbit.dist = spec.cam.ext;
  return spec;
}

function spawn() {
  const spec = GAME.ac.spec;
  const fm = GAME.fm;
  if (GAME.startMode === 'runway') {
    const y = terrainHeight(-1250, 0) + spec.gear.height;
    fm.reset(new THREE.Vector3(-1250, y, 0), 90, 0, 0);
    input.flapsIdx = 1;
  } else {
    const y = terrainHeight(0, 0) + spec.gear.height + 300;
    fm.reset(new THREE.Vector3(-600, y, 0), 90, spec.vApproach * 1.9, 1);
    input.flapsIdx = 0;
  }
  input.gearDown = GAME.startMode === 'runway';
  input.throttle = GAME.startMode === 'runway' ? 0 : 0.7;
  input.spoilers = false; input.reverse = false;
  syncButtons();
  GAME.touchMsg = '';
  GAME.wasGround = fm.onGround;
  GAME.lastAGL = fm.onGround ? 0 : Infinity;   // não avisa toque no spawn
  GAME.camMode = 0;
  hud.setCam(GAME.camNames[0]);
  orbitBehind();
}

function orbitBehind() {
  const hdg = Math.atan2(GAME.ac.group.position.x, 0) * 0; // recalculado abaixo
  const fm = GAME.fm;
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(fm.quat);
  const hdgRad = Math.atan2(f.x, f.z);
  GAME.orbit.yaw = hdgRad + Math.PI;
  GAME.orbit.pitch = 0.32;
}

// ---------------------------------------------------------------------------
// botões / sincronização de UI
// ---------------------------------------------------------------------------
function syncButtons() {
  const spec = GAME.ac.spec;
  $('btnGear').classList.toggle('active', input.gearDown);
  $('gearSub').textContent = input.gearDown ? 'ABAIXADO' : 'RECOLHIDO';
  const fl = THREE.MathUtils.clamp(input.flapsIdx, 0, spec.flaps.length - 1);
  input.flapsIdx = fl;
  $('flapsSub').textContent = spec.flaps[fl].name;
  $('btnSpr').classList.toggle('active', input.spoilers);
  $('btnRvs').classList.toggle('active', input.reverse);
  $('btnBrk').classList.toggle('active', input.brakes > 0);
}

// ---------------------------------------------------------------------------
// qualidade gráfica
// ---------------------------------------------------------------------------
const QUALITY = {
  low:    { pr: 0.8, shadow: 0, fog: 2800, far: 13000, exposure: 1.0 },
  medium: { pr: 1.3, shadow: 1024, fog: 4500, far: 15000, exposure: 1.05 },
  high:   { pr: 1.8, shadow: 2048, fog: 6500, far: 18000, exposure: 1.05 },
  ultra:  { pr: 2.2, shadow: 4096, fog: 9500, far: 24000, exposure: 1.08 },
};
function applyQuality(q) {
  GAME.quality = q;
  const c = QUALITY[q];
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  renderer.setPixelRatio(Math.min(c.pr, dpr));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = c.shadow > 0;
  env.sun.castShadow = c.shadow > 0;
  if (c.shadow > 0) {
    if (env.sun.shadow.map) { env.sun.shadow.map.dispose(); env.sun.shadow.map = null; }
    env.sun.shadow.mapSize.set(c.shadow, c.shadow);
  }
  env.fogDist = c.fog;
  camera.far = c.far;
  camera.updateProjectionMatrix();
  env.setQuality(q);
  world.setQuality(q);
  hud.setQuality(q);
  document.querySelectorAll('#gfxChips .chip, #gfxChips2 .chip').forEach(ch => {
    ch.classList.toggle('sel', ch.dataset.v === q);
  });
}

// ---------------------------------------------------------------------------
// câmeras
// ---------------------------------------------------------------------------
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const _chasePos = new THREE.Vector3();
let _chaseInit = false;

function updateCamera(dt) {
  const { ac, fm } = GAME;
  const pos = ac.group.position;
  const spec = ac.spec;

  if (GAME.camMode === 2) {
    // cockpit
    _v1.fromArray(spec.cam.cockpit);
    ac.group.localToWorld(_v1);
    camera.position.copy(_v1);
    camera.quaternion.copy(fm.quat).multiply(_qFlip);
    // leve inclinação para baixo mantém o painel enquadrado em subida
    camera.rotateX(-0.13);
  } else if (GAME.camMode === 0) {
    // externa orbital
    const o = GAME.orbit;
    _v1.set(
      Math.sin(o.yaw) * Math.cos(o.pitch),
      Math.sin(o.pitch),
      Math.cos(o.yaw) * Math.cos(o.pitch)
    ).multiplyScalar(o.dist).add(pos);
    const gh = terrainHeight(_v1.x, _v1.z) + 1.5;
    if (_v1.y < gh) _v1.y = gh;
    camera.position.copy(_v1);
    camera.lookAt(pos);
  } else if (GAME.camMode === 1) {
    // perseguição suavizada
    _v1.fromArray(spec.cam.chase).applyQuaternion(fm.quat).add(pos);
    if (!_chaseInit) { _chasePos.copy(_v1); _chaseInit = true; }
    _chasePos.lerp(_v1, 1 - Math.exp(-dt * 3.5));
    const gh = terrainHeight(_chasePos.x, _chasePos.z) + 1.5;
    if (_chasePos.y < gh) _chasePos.y = gh;
    camera.position.copy(_chasePos);
    _v2.copy(pos).addScaledVector(_v3.set(0, 0, 1).applyQuaternion(fm.quat), 12);
    camera.lookAt(_v2);
  } else {
    // lateral
    _v1.set(spec.cam.ext * 0.85, 4, 0).applyQuaternion(fm.quat).add(pos);
    const gh = terrainHeight(_v1.x, _v1.z) + 1.5;
    if (_v1.y < gh) _v1.y = gh;
    camera.position.copy(_v1);
    camera.lookAt(pos);
  }
  cockpitVisibility();
}

function cockpitVisibility() {
  const isCockpit = GAME.camMode === 2;
  if (GAME.cockpit) {
    GAME.cockpit.group.visible = isCockpit;
    if (isCockpit && GAME.ac) {
      // alinha o cockpit à aeronave e esconde todo o exterior
      GAME.cockpit.group.position.copy(GAME.ac.group.position);
      GAME.cockpit.group.quaternion.copy(GAME.ac.group.quaternion);
      GAME.ac.group.visible = false;
    } else if (GAME.ac) {
      GAME.ac.group.visible = true;
    }
  }
  $('cockpitGlow').style.display = isCockpit ? 'block' : 'none';
}

// ---------------------------------------------------------------------------
// órbita / zoom no canvas
// ---------------------------------------------------------------------------
const pointers = new Map();
let pinchDist = 0;
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const p = pointers.get(e.pointerId);
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 1 && GAME.camMode === 0) {
    GAME.orbit.yaw -= dx * 0.006;
    GAME.orbit.pitch = THREE.MathUtils.clamp(GAME.orbit.pitch + dy * 0.005, 0.02, 1.45);
  } else if (pointers.size === 2 && GAME.camMode === 0) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    GAME.orbit.dist = THREE.MathUtils.clamp(GAME.orbit.dist * (pinchDist / Math.max(1, d)), 8, 600);
    pinchDist = d;
  }
});
const clearPointer = (e) => pointers.delete(e.pointerId);
canvas.addEventListener('pointerup', clearPointer);
canvas.addEventListener('pointercancel', clearPointer);
canvas.addEventListener('wheel', (e) => {
  if (GAME.camMode === 0) {
    GAME.orbit.dist = THREE.MathUtils.clamp(GAME.orbit.dist * (1 + e.deltaY * 0.001), 8, 600);
  }
}, { passive: true });

// ---------------------------------------------------------------------------
// animação visual da aeronave
// ---------------------------------------------------------------------------
function animateAircraft(dt) {
  const { ac, fm } = GAME;
  const parts = ac.parts;
  const fmLike = fm;

  ac.group.position.copy(fm.pos);
  ac.group.quaternion.copy(fm.quat);

  const rpm = fm.rpm;
  if (parts.prop) {
    parts.prop.rotation.z += rpm * 85 * dt;
    parts.blur.material.opacity = rpm * 0.28;
  }
  if (parts.fans) {
    for (const f of parts.fans) f.rotation.z += rpm * 60 * dt;
    if (parts.blurFans) for (const d of parts.blurFans) d.material.opacity = rpm * 0.3;
  }

  // superfícies de controle
  const flapAng = (input.flapsIdx / Math.max(1, ac.spec.flaps.length - 1)) * 0.62;
  if (parts.flapL) { parts.flapL.rotation.x = flapAng; parts.flapR.rotation.x = flapAng; }
  if (parts.ailL) {
    parts.ailL.rotation.x = -input.effRoll * 0.4;
    parts.ailR.rotation.x = input.effRoll * 0.4;
  }
  if (parts.elev) parts.elev.rotation.x = -input.effPitch * 0.45;
  if (parts.rudder) parts.rudder.rotation.y = -input.effYaw * 0.5;
  if (parts.spoilers) {
    const sp = fm.spoilers ? -0.95 : 0;
    for (const s of parts.spoilers) s.rotation.x += (sp - s.rotation.x) * Math.min(1, dt * 5);
  }

  // trem de pouso
  const gp = fm.gearPos;
  if (parts.gearN) parts.gearN.rotation.x = (1 - gp) * 1.5;
  if (parts.gearM) {
    parts.gearM.children.forEach((leg, i) => {
      const s = i === 0 ? -1 : 1;
      if (ac.spec.key === 'cessna') leg.rotation.z = (1 - gp) * 1.5 * s;
      else leg.rotation.z = (1 - gp) * 1.6 * s;
    });
  }
  if (parts.wheels && fm.onGround) {
    const gs = Math.hypot(fm.vel.x, fm.vel.z);
    for (const w of parts.wheels) w.rotation.x += gs * dt / 0.5;
  }

  // luzes
  const t = GAME.tSim;
  parts.beacon.visible = (t % 1.2) < 0.15;
  parts.strobeL.visible = parts.strobeR.visible = ((t % 1.6) < 0.05) || (((t + 0.12) % 1.6) < 0.05);
  const night = env.nightFactor;
  if (parts.landingLight) parts.landingLight.intensity = (night > 0.35 && fm.gearPos > 0.8) ? 55 : 0;
  if (parts.windowMat) parts.windowMat.emissiveIntensity = night * 0.9;
  if (GAME.cockpit) GAME.cockpit.light.intensity = isCockpitActive() ? (night > 0.2 ? 0.9 : 1.4) : 0;

  // manche do cockpit
  if (GAME.cockpit && GAME.cockpit.group.visible) {
    GAME.cockpit.yoke.rotation.x = input.effPitch * 0.25;
    GAME.cockpit.yoke.rotation.z = -input.effRoll * 0.6;
    GAME.cockpit.throttle.rotation.x = -0.8 - fm.throttle * 0.5;
  }
}
function isCockpitActive() { return GAME.camMode === 2; }

// ---------------------------------------------------------------------------
// avisos e HUD
// ---------------------------------------------------------------------------
function buildWarnings(fm, d, aglFt) {
  const list = [];
  if (fm.crashed) return list;
  if (fm.stalled && !fm.onGround) list.push(['stall', 'PERDA DE SUSTENTAÇÃO', '']);
  if (d.iasKt > fm.spec.vne * MS2KT * 1.02) list.push(['ovspd', 'VELOCIDADE EXCESSIVA', '']);
  if (fm.gLoad > 4.5 || fm.gLoad < -1.5) list.push(['g', 'FORÇA G EXTREMA', '']);
  if (!fm.onGround && aglFt < 130 && fm.vel.y < -6) list.push(['terr', 'TERRENO — ARREMETIDA', '']);
  if (!fm.gearDown && !fm.onGround && aglFt < 400 && fm.vel.y < -1 && d.iasKt < fm.spec.vApproach * 2.6 * MS2KT)
    list.push(['gear', 'TREM DE POUSO RECOLHIDO', '']);
  if (fm.fuel <= 0) list.push(['fuel', 'SEM COMBUSTÍVEL', '']);
  else if (fm.fuel / fm.spec.fuelCap < 0.1) list.push(['fuel', 'COMBUSTÍVEL BAIXO', 'amber']);
  if (fm.overheat) list.push(['temp', 'TEMPERATURA DO MOTOR ALTA', 'amber']);
  if (fm.onGround && fm.brakes > 0 && Math.hypot(fm.vel.x, fm.vel.z) > 1) list.push(['brk', 'FREIOS', 'green']);
  if (fm.reverse && fm.onGround) list.push(['rvs', 'REVERSO ATIVO', 'green']);
  if (fm.stalled === false && fm.alpha > (fm.spec.alphaStall - 3) * D2R && !fm.onGround && fm.vel.length() > 15)
    list.push(['pre', 'ATENÇÃO: ESTOL PRÓXIMO', 'amber']);
  return list;
}

// ---------------------------------------------------------------------------
// loop principal
// ---------------------------------------------------------------------------
const PHYS_DT = 1 / 120;
let lastT = performance.now();
let acc = 0;

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  let dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;

  if (!GAME.started || GAME.paused) {
    renderer.render(scene, camera);
    return;
  }

  input.sample(dt);

  // física em passos fixos
  acc += dt;
  let steps = 0;
  while (acc >= PHYS_DT && steps < 10) {
    GAME.fm.step(PHYS_DT, {
      pitch: input.effPitch, roll: input.effRoll, yaw: input.effYaw,
      throttle: input.throttle, brakes: input.brakes,
      gearDown: input.gearDown, flapsIdx: input.flapsIdx,
      spoilers: input.spoilers, reverse: input.reverse,
    }, env, terrainHeight, GAME.tSim);
    GAME.tSim += PHYS_DT;
    acc -= PHYS_DT;
    steps++;
    if (GAME.fm.crashed) break;
  }

  const fm = GAME.fm;
  const d = fm.data(env);
  const gh = terrainHeight(fm.pos.x, fm.pos.z);
  const aglFt = (fm.pos.y - gh) * FT;

  // mensagem de toque (só quando sai do ar para o solo — não no spawn/rolagem)
  if (fm.onGround && !GAME.wasGround && GAME.lastAGL > 15) {
    const fpm = Math.abs(fm.lastTouchVS * FT * 60);
    let q;
    if (fpm < 90) q = '✨ Toque perfeito!';
    else if (fpm < 300) q = '✅ Bom toque';
    else if (fpm < 600) q = '⚠️ Toque firme';
    else q = '⚠️ Toque muito forte';
    GAME.touchMsg = `${q} — ${fpm.toFixed(0)} ft/min`;
    sound.click();
  }
  GAME.wasGround = fm.onGround;
  GAME.lastAGL = aglFt;

  // crash
  if (fm.crashed && $('crashOverlay').classList.contains('hidden')) {
    $('crashReason').textContent = fm.crashReason;
    $('crashStats').textContent =
      `Velocidade no impacto: ${Math.round(d.gsKt)} kt · Toque: ${Math.round(fm.lastTouchVS * FT * 60)} ft/min`;
    $('crashOverlay').classList.remove('hidden');
    $('controls').classList.add('hidden');
  }

  // atmosfera e mundo
  env.update(dt, camera.position, fm.pos);
  world.update(dt, fm.pos, env.nightFactor);
  animateAircraft(dt);
  updateCamera(dt);

  // instrumentos do cockpit
  const f = _v1.set(0, 0, 1).applyQuaternion(fm.quat);
  const r = _v2.set(1, 0, 0).applyQuaternion(fm.quat);
  instruments.update(dt, {
    pitchDeg: Math.asin(THREE.MathUtils.clamp(f.y, -1, 1)) * R2D,
    rollRad: Math.atan2(r.y, Math.hypot(r.x, r.z)),
    iasKt: d.iasKt, altFt: d.altFt,
    vneKt: fm.spec.vne * MS2KT,
  });

  // HUD
  const envWind = env._wind;
  hud.update(dt, {
    iasKt: d.iasKt, gsKt: d.gsKt,
    altFt: d.altFt, aglFt,
    hdg: d.hdg, vsFpm: d.vsFpm,
    throttle: fm.throttle,
    fuelPct: (fm.fuel / fm.spec.fuelCap) * 100,
    temp: fm.temp,
    flapName: fm.spec.flaps[fm.flapsIdx].name,
    gearTxt: fm.gearPos > 0.98 ? 'ABAIXADO' : fm.gearPos < 0.02 ? 'RECOLHIDO' : 'MOVENDO…',
    gearCol: fm.gearPos > 0.98 ? '#7cff9e' : fm.gearPos < 0.02 ? '#dfeeff' : '#ffc24d',
    mach: d.mach,
    windTxt: `${Math.round(env.windSpeed * MS2KT)}KT/${Math.round((env.windDirRad * R2D + 360) % 360)}°`,
    quality: GAME.quality,
    touchMsg: GAME.touchMsg,
  });
  GAME.touchMsg = '';
  hud.setWarnings(buildWarnings(fm, d, aglFt));

  // áudio
  const camDist = camera.position.distanceTo(fm.pos);
  _v3.copy(fm.pos).sub(camera.position).normalize();
  const camRight = _v1.set(1, 0, 0).applyQuaternion(camera.quaternion);
  sound.update(dt, {
    type: fm.spec.engine.type, rpm: fm.rpm, throttle: fm.throttle,
    airspeedMS: fm.vel.length(),
    rainAmt: env.cfg.rain > 0 ? env.rain.material.opacity : 0,
    stall: fm.stalled && !fm.onGround,
    camDist, pan: _v3.dot(camRight), cockpit: GAME.camMode === 2,
  });

  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// UI: overlay inicial / pausa / crash
// ---------------------------------------------------------------------------
function chipGroup(id, onPick) {
  document.querySelectorAll(`#${id} .chip`).forEach(ch => {
    ch.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      document.querySelectorAll(`#${id} .chip`).forEach(c => c.classList.remove('sel'));
      ch.classList.add('sel');
      sound.click();
      onPick(ch.dataset.v);
    });
  });
}

function buildAircraftCards() {
  const cards = $('acCards');
  cards.innerHTML = '';
  for (const key of Object.keys(SPECS)) {
    const s = SPECS[key];
    const div = document.createElement('div');
    div.className = 'acard' + (key === GAME.aircraftKey ? ' sel' : '');
    div.dataset.v = key;
    div.innerHTML = `<div class="nm">${s.name}</div><div class="tp">${s.type}</div>
      <div class="st">${s.desc}<br>Peso: ${(s.mass / 1000).toFixed(1)} t · Motores: ${s.engine.count}${s.engine.type === 'jet' ? ' × jato' : ' × hélice'}<br>
      Estol ≈ ${Math.round(stallKt(s))} kt · Rotação ≈ ${Math.round(s.vRotate * MS2KT)} kt</div>`;
    div.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      cards.querySelectorAll('.acard').forEach(c => c.classList.remove('sel'));
      div.classList.add('sel');
      GAME.aircraftKey = key;
      sound.click();
    });
    cards.appendChild(div);
  }
}
function stallKt(s) {
  const cl = s.CL0 + s.CLa * s.alphaStall * D2R + (s.flaps[1] ? s.flaps[1].cl : 0);
  return Math.sqrt(2 * (s.mass + s.fuelCap * 0.5) * 9.81 / (1.225 * s.S * cl)) * MS2KT;
}

function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }

function startFlight() {
  sound.init(); sound.resume();
  hide('startOverlay');
  hide('loading');
  show('hud'); show('controls');
  spawnAircraft(GAME.aircraftKey);
  spawn();
  GAME.started = true;
  GAME.paused = false;
  hud.setCam(GAME.camNames[GAME.camMode]);
  lastT = performance.now();
}

function togglePause() {
  if (!GAME.started) return;
  GAME.paused = !GAME.paused;
  if (GAME.paused) show('pauseOverlay'); else { hide('pauseOverlay'); lastT = performance.now(); }
}

chipGroup('startChips', v => GAME.startMode = v);
chipGroup('wxChips', v => env.setWeather(v));
chipGroup('wxChips2', v => env.setWeather(v));
chipGroup('gfxChips', v => applyQuality(v));
chipGroup('gfxChips2', v => applyQuality(v));
chipGroup('timeChips', v => { env.timeOfDay = parseFloat(v); });
buildAircraftCards();

$('btnStart').addEventListener('pointerdown', (e) => { e.preventDefault(); startFlight(); });
$('btnResume').addEventListener('pointerdown', (e) => { e.preventDefault(); togglePause(); });
$('btnRestart').addEventListener('pointerdown', (e) => { e.preventDefault(); hide('pauseOverlay'); GAME.paused = false; spawn(); lastT = performance.now(); });
$('btnFlyAgain').addEventListener('pointerdown', (e) => { e.preventDefault(); hide('crashOverlay'); show('controls'); spawn(); lastT = performance.now(); });
$('btnPause').addEventListener('pointerdown', (e) => { e.preventDefault(); });

input.bind({
  joyZone: $('joyZone'), joyStick: $('joyStick'),
  thrSlider: $('thrSlider'), thrFill: $('thrFill'), thrHandle: $('thrHandle'),
  btnGear: $('btnGear'), btnFlaps: $('btnFlaps'), btnSpr: $('btnSpr'), btnRvs: $('btnRvs'),
  btnBrk: $('btnBrk'), btnRudL: $('btnRudL'), btnRudR: $('btnRudR'),
  btnCam: $('btnCam'), btnPause: $('btnPause'), btnTilt: $('btnTilt'), btnSound: $('btnSound'),
}, {
  click: () => { sound.init(); sound.click(); },
  syncGear: () => syncButtons(),
  syncFlaps: () => syncButtons(),
  syncSpr: () => syncButtons(),
  syncRvs: () => syncButtons(),
  syncBrk: () => syncButtons(),
  camera: () => {
    GAME.camMode = (GAME.camMode + 1) % 4;
    if (GAME.camMode === 0) orbitBehind();
    hud.setCam(GAME.camNames[GAME.camMode]);
    _chaseInit = false;
  },
  pause: () => togglePause(),
  tilt: () => {
    const go = async () => {
      const on = input.toggleTilt();
      $('btnTilt').style.background = on ? 'rgba(57,210,255,.4)' : '';
    };
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      DeviceOrientationEvent.requestPermission().then(() => go()).catch(() => { });
    } else go();
  },
  sound: () => {
    sound.init();
    sound.setEnabled(!sound.enabled);
    $('btnSound').textContent = sound.enabled ? '🔊' : '🔇';
  },
});

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------------------
// API de depuração/teste
// ---------------------------------------------------------------------------
window.SIM = {
  get state() {
    const fm = GAME.fm;
    if (!fm) return null;
    const d = fm.data(env);
    const gh = terrainHeight(fm.pos.x, fm.pos.z);
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    return {
      pos: fm.pos.toArray(), vel: fm.vel.toArray(),
      camPos: camera.position.toArray(),
      camLook: look.toArray(),
      acVisible: GAME.ac ? GAME.ac.group.visible : false,
      iasKt: d.iasKt, gsKt: d.gsKt, altFt: d.altFt, aglFt: (fm.pos.y - gh) * FT,
      hdg: d.hdg, alphaDeg: d.alphaDeg, onGround: fm.onGround, crashed: fm.crashed,
      rpm: fm.rpm, fuel: fm.fuel, throttle: fm.throttle, gearPos: fm.gearPos,
      stalled: fm.stalled, gLoad: fm.gLoad, vsFpm: d.vsFpm,
      started: GAME.started, paused: GAME.paused, craft: GAME.aircraftKey,
      camMode: GAME.camMode, timeOfDay: env.timeOfDay,
    };
  },
  step(n) {
    let nanAt = -1;
    for (let i = 0; i < n; i++) {
      GAME.fm.step(PHYS_DT, {
        pitch: input.effPitch, roll: input.effRoll, yaw: input.effYaw,
        throttle: input.throttle, brakes: input.brakes,
        gearDown: input.gearDown, flapsIdx: input.flapsIdx,
        spoilers: input.spoilers, reverse: input.reverse,
      }, env, terrainHeight, GAME.tSim);
      GAME.tSim += PHYS_DT;
      const f = GAME.fm;
      if (!isFinite(f.pos.x + f.pos.y + f.vel.x + f.vel.z + f.quat.x) && nanAt < 0) {
        nanAt = i;
        break;
      }
    }
    if (nanAt >= 0) {
      const f = GAME.fm;
      return { nanAt, pos: f.pos.toArray(), vel: f.vel.toArray(), quat: f.quat.toArray(),
        angVel: f.angVel.toArray(), rpm: f.rpm, onGround: f.onGround, crashed: f.crashed };
    }
    return this.state;
  },
  setInput(o) { Object.assign(input, o); },
  tp(x, y, z, hdg = 90, speed = 0) {
    GAME.fm.reset(new THREE.Vector3(x, y, z), hdg, speed, speed > 0 ? 1 : 0);
  },
  setTime(h) { env.timeOfDay = h; },
  setWeather(k) { env.setWeather(k); },
  setQuality(k) { applyQuality(k); },
  cam(m) { GAME.camMode = m; _chaseInit = false; },
  sceneObj: () => scene,
  rendererObj: () => renderer,
  camObj: () => camera,
  game: () => GAME,
  envObj: () => env,
  inputObj: () => input,
  // diagnóstico: o que está entre a câmera e a aeronave?
  raycast(nx = 0, ny = 0) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const hits = rc.intersectObjects(scene.children, true).slice(0, 4)
      .map(h => ({
        d: +h.distance.toFixed(1), type: h.object.type,
        geo: h.object.geometry ? h.object.geometry.type : '',
        verts: h.object.geometry && h.object.geometry.attributes.position ? h.object.geometry.attributes.position.count : 0,
        y: +h.point.y.toFixed(1),
        mat: h.object.material && h.object.material.type,
      }));
    return { hits };
  },
  errors: window.__errors,
};

// ---------------------------------------------------------------------------
// pré-construção do terreno próximo do aeroporto + primeira renderização
// ---------------------------------------------------------------------------
applyQuality(GAME.quality);
for (let i = 0; i < 200 && world.terrain.update(0, 0) > 0; i++) { /* constrói chunks */ }
camera.position.set(-80, 14, -60);
camera.lookAt(60, 9, 0);
env.update(0.016, camera.position, new THREE.Vector3(0, 8, 0));
world.update(0.016, new THREE.Vector3(0, 8, 0), 0);
renderer.render(scene, camera);
hide('loading');
frame();
