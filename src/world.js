// ============================================================================
// world.js — Terreno procedural em chunks com LOD, oceano, aeroporto
// completo (pista sinalizada, luzes, terminal, torre, hangares), cidade
// instanciada, estradas, florestas e população animada.
// ============================================================================
import * as THREE from 'three';

// --------------------------- altura do terreno -----------------------------
function hash2(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct) {
  let v = 0, amp = 0.5, f = 1, tot = 0;
  for (let i = 0; i < oct; i++) {
    v += vnoise(x * f, y * f) * amp;
    tot += amp; amp *= 0.5; f *= 2.07;
  }
  return v / tot;
}
function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export const WORLD = {
  seaLevel: 0,
  airportH: 8,
  runwayHalfLen: 1300,
  runwayW: 45,
};

// rect "dentro" com margem suave: retorna 0..1
function rectBlend(x, z, x0, x1, z0, z1, margin) {
  const dx = Math.max(x0 - x, 0, x - x1);
  const dz = Math.max(z0 - z, 0, z - z1);
  const d = Math.sqrt(dx * dx + dz * dz);
  return 1 - smoothstep(0, margin, d);
}

// Altura analítica do terreno — usada pela malha E pela física/colisão.
export function terrainHeight(x, z) {
  const cont = fbm(x * 0.00022 + 3.7, z * 0.00022 + 1.2, 4);        // continentes
  const hills = fbm(x * 0.0013 + 9.1, z * 0.0013 + 4.4, 4);
  const ridged = 1 - Math.abs(fbm(x * 0.00052 + 21.3, z * 0.00052 + 13.8, 3) * 2 - 1);

  let h = (cont - 0.42) * 900;                                       // base -380..+520
  h += (hills - 0.5) * 90;
  h += ridged * ridged * ridged * 780 * smoothstep(150, 1200, Math.sqrt(x * x + (z - 700) * (z - 700)));

  // oceano para o sul e oeste distantes
  const sea = smoothstep(-600, -2600, z) + smoothstep(-900, -3200, x);
  h = h * (1 - Math.min(1, sea)) + (-40) * Math.min(1, sea);

  // platô do aeroporto (pista ao longo do eixo X em z=0)
  const wApt = rectBlend(x, z, -1750, 1750, -320, 320, 420);
  h = THREE.MathUtils.lerp(h, WORLD.airportH, wApt);

  // platô da cidade
  const wCity = rectBlend(x, z, -350, 950, 380, 1350, 260);
  h = THREE.MathUtils.lerp(h, WORLD.airportH + 3.2, wCity);

  return h;
}

// --------------------------- materiais compartilhados ----------------------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function runwayTexture() {
  // canvas 2048x128 -> pista 2600m x 45m  (1px ≈ 1.27m em X, 0.35m em Y)
  return canvasTex(2048, 128, (g, w, h) => {
    const XM = w / 2600, YM = h / 45;             // px por metro
    const mx = (m) => m * XM, my = (m) => m * YM;
    // asfalto
    g.fillStyle = '#2b2e33'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(${120 + Math.random() * 60},${120 + Math.random() * 60},${120 + Math.random() * 60},0.06)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 1);
    }
    // juntas do pavimento a cada 15m
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    for (let x = 0; x < w; x += mx(15)) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    // faixas laterais (0.9m)
    g.fillStyle = '#e8e8e8';
    g.fillRect(0, h / 2 - my(21.3) - my(0.45), w, my(0.9));
    g.fillRect(0, h / 2 + my(21.3) - my(0.45), w, my(0.9));
    // linha central tracejada (traço 30m, vão 20m, 0.9m)
    for (let x = mx(12); x < w - mx(60); x += mx(50)) g.fillRect(x, h / 2 - my(0.45), mx(30), my(0.9));
    // piano keys (threshold): 6 barras por lado, 30m x 1.7m
    const thr = (x0) => {
      for (let i = 0; i < 6; i++) {
        const off = 4 + i * 3.4;                    // afastamento do centro (m)
        g.fillRect(x0, h / 2 - my(off + 0.85), mx(30), my(1.7));
        g.fillRect(x0, h / 2 + my(off - 0.85), mx(30), my(1.7));
      }
    };
    thr(mx(8)); thr(w - mx(38));
    // zona de toque: pares de barras 22m a 150/300m do threshold
    const tdz = (x0, dir) => {
      for (const dm of [150, 300]) {
        for (const off of [9, 15]) {
          g.fillRect(x0 + dir * mx(dm), h / 2 - my(off + 0.85), mx(22), my(1.7));
          g.fillRect(x0 + dir * mx(dm), h / 2 + my(off - 0.85), mx(22), my(1.7));
        }
      }
    };
    tdz(mx(50), 1); tdz(w - mx(72), -1);
    // números 09/27 (18m de altura)
    g.fillStyle = '#e8e8e8';
    g.font = `bold ${my(15)}px Arial`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(mx(80), h / 2); g.rotate(Math.PI / 2); g.fillText('27', 0, 0); g.restore();
    g.save(); g.translate(w - mx(80), h / 2); g.rotate(-Math.PI / 2); g.fillText('09', 0, 0); g.restore();
  });
}

function windowTexture() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
    for (let y = 8; y < 250; y += 16) {
      for (let x = 10; x < 250; x += 14) {
        if (Math.random() < 0.82) {
          g.fillStyle = Math.random() < 0.5 ? '#ffd98a' : '#cfe6ff';
          g.fillRect(x, y, 8, 9);
        }
      }
    }
  });
}

// ============================================================================
class ChunkedTerrain {
  constructor(scene, mat) {
    this.scene = scene;
    this.mat = mat;
    this.chunk = 560;
    this.radius = 4;
    this.map = new Map();
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this._pending = [];
  }
  key(cx, cz) { return cx + '|' + cz; }

  update(px, pz) {
    const ccx = Math.floor(px / this.chunk), ccz = Math.floor(pz / this.chunk);
    // remove distantes
    for (const [k, m] of this.map) {
      const [cx, cz] = k.split('|').map(Number);
      if (Math.max(Math.abs(cx - ccx), Math.abs(cz - ccz)) > this.radius + 1) {
        this.group.remove(m); m.geometry.dispose();
        this.map.delete(k);
      }
    }
    // fila dos que faltam, ordenados por distância
    this._pending.length = 0;
    for (let dx = -this.radius; dx <= this.radius; dx++) {
      for (let dz = -this.radius; dz <= this.radius; dz++) {
        const k = this.key(ccx + dx, ccz + dz);
        if (!this.map.has(k)) this._pending.push([ccx + dx, ccz + dz, dx * dx + dz * dz]);
      }
    }
    this._pending.sort((a, b) => a[2] - b[2]);
    // constrói 2 por frame
    let built = 0;
    while (this._pending.length && built < 2) {
      const [cx, cz] = this._pending.shift();
      const m = this._build(cx, cz);
      this.map.set(this.key(cx, cz), m);
      this.group.add(m);
      built++;
    }
    return this._pending.length;
  }

  _build(cx, cz) {
    const size = this.chunk;
    const ox = cx * size, oz = cz * size;
    const dChunks = Math.max(Math.abs(cx), Math.abs(cz));
    const seg = dChunks <= 1 ? 26 : dChunks <= 2 ? 14 : 8;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color(0x4d7a34), cGrass2 = new THREE.Color(0x3f6a2c),
      cSand = new THREE.Color(0x9a8c60), cRock = new THREE.Color(0x6f6a62),
      cSnow = new THREE.Color(0xe8edf2), cField = new THREE.Color(0x77913e);
    const tmpC = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + ox, z = pos.getZ(i) + oz;
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      const slope = Math.abs(terrainHeight(x + 6, z) - h) + Math.abs(terrainHeight(x, z + 6) - h);
      if (h < 2.5) tmpC.copy(cSand);
      else if (h > 520 + vnoise(x * 0.01, z * 0.01) * 60) tmpC.copy(cSnow);
      else if (slope > 26) tmpC.copy(cRock);
      else {
        tmpC.copy(vnoise(x * 0.02, z * 0.02) > 0.5 ? cGrass : cGrass2);
        if (vnoise(x * 0.006 + 40, z * 0.006) > 0.72) tmpC.copy(cField);
      }
      tmpC.multiplyScalar(0.92 + vnoise(x * 0.09, z * 0.09) * 0.16);
      colors[i * 3] = tmpC.r; colors[i * 3 + 1] = tmpC.g; colors[i * 3 + 2] = tmpC.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.translate(0, 0, 0);
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.position.set(ox, 0, oz);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }
}

// ============================================================================
// População: pessoas animadas + veículos de serviço
// ============================================================================
class Person {
  constructor() {
    const shirt = new THREE.Color().setHSL(Math.random(), 0.55, 0.5);
    const pants = [0x2a3550, 0x333333, 0x5a4a3a][Math.floor(Math.random() * 3)];
    const skin = [0xe8b88a, 0xc98d5e, 0x8a5a3a, 0xf0c8a0][Math.floor(Math.random() * 4)];
    this.group = new THREE.Group();
    const M = (c) => new THREE.MeshLambertMaterial({ color: c });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.55, 6), M(shirt));
    torso.position.y = 1.05;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), M(skin));
    head.position.y = 1.5;
    this.legL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.72, 5), M(pants));
    this.legR = this.legL.clone();
    this.legL.material = M(pants); this.legR.material = M(pants);
    this.armL = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.55, 5), M(shirt));
    this.armR = this.armL.clone();
    this.legL.position.set(0.09, 0.38, 0); this.legR.position.set(-0.09, 0.38, 0);
    this.armL.position.set(0.24, 1.02, 0); this.armR.position.set(-0.24, 1.02, 0);
    // pivôs para animar
    this.pivotLL = new THREE.Group(); this.pivotLL.position.set(0.09, 0.74, 0); this.legL.position.set(0, -0.36, 0); this.pivotLL.add(this.legL);
    this.pivotLR = new THREE.Group(); this.pivotLR.position.set(-0.09, 0.74, 0); this.legR.position.set(0, -0.36, 0); this.pivotLR.add(this.legR);
    this.pivotAL = new THREE.Group(); this.pivotAL.position.set(0.24, 1.3, 0); this.armL.position.set(0, -0.27, 0); this.pivotAL.add(this.armL);
    this.pivotAR = new THREE.Group(); this.pivotAR.position.set(-0.24, 1.3, 0); this.armR.position.set(0, -0.27, 0); this.pivotAR.add(this.armR);
    this.group.add(torso, head, this.pivotLL, this.pivotLR, this.pivotAL, this.pivotAR);
    torso.castShadow = false;
    this.speed = 0.9 + Math.random() * 0.8;
    this.phase = Math.random() * Math.PI * 2;
    this.state = 'walk';
    this.pauseT = 0;
    this.wp = 0;
    this.path = null;
  }
  update(dt) {
    if (this.state === 'pause') {
      this.pauseT -= dt;
      this.pivotLL.rotation.x = 0; this.pivotLR.rotation.x = 0;
      this.pivotAL.rotation.x = 0; this.pivotAR.rotation.x = 0;
      if (this.pauseT <= 0) this.state = 'walk';
      return;
    }
    const wp = this.path[this.wp];
    const dx = wp[0] - this.group.position.x, dz = wp[1] - this.group.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.2) {
      this.wp = (this.wp + 1) % this.path.length;
      if (Math.random() < 0.25) { this.state = 'pause'; this.pauseT = 2 + Math.random() * 6; }
      return;
    }
    const step = this.speed * dt;
    this.group.position.x += dx / d * step;
    this.group.position.z += dz / d * step;
    this.group.rotation.y = Math.atan2(dx, dz);
    this.phase += dt * this.speed * 5.5;
    const s = Math.sin(this.phase) * 0.55;
    this.pivotLL.rotation.x = s; this.pivotLR.rotation.x = -s;
    this.pivotAL.rotation.x = -s * 0.7; this.pivotAR.rotation.x = s * 0.7;
  }
}

class ServiceVehicle {
  constructor(kind) {
    this.kind = kind;
    const g = new THREE.Group();
    const M = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.2 });
    if (kind === 'fuel') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 5.2), M(0xd8dde2));
      body.position.y = 1.5;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 1.6), M(0x2a4d7a));
      cab.position.set(0, 1.2, 3.1);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 3.4, 10), M(0xc0c8ce));
      tank.rotation.x = Math.PI / 2; tank.position.set(0, 2.0, -0.6);
      g.add(body, cab, tank);
      this.wheels = [];
      for (const [x, z] of [[1.0, 1.9], [-1.0, 1.9], [1.0, -1.7], [-1.0, -1.7]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.34, 10), M(0x181818));
        w.rotation.z = Math.PI / 2; w.position.set(x, 0.48, z);
        g.add(w); this.wheels.push(w);
      }
    } else { // baggage tug + carts
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 2.4), M(0xd8b23a));
      body.position.y = 0.85;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.0), M(0x34506a));
      cab.position.set(0, 1.6, 0.7);
      g.add(body, cab);
      this.wheels = [];
      for (const [x, z] of [[0.75, 0.8], [-0.75, 0.8], [0.75, -0.8], [-0.75, -0.8]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 8), M(0x181818));
        w.rotation.z = Math.PI / 2; w.position.set(x, 0.34, z);
        g.add(w); this.wheels.push(w);
      }
      this.carts = [];
      for (let i = 1; i <= 2; i++) {
        const cart = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 2.0), M(0x7a3434));
        box.position.y = 0.95;
        cart.add(box);
        const cw = [];
        for (const [x, z] of [[0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.24, 8), M(0x181818));
          w.rotation.z = Math.PI / 2; w.position.set(x, 0.3, z);
          cart.add(w); cw.push(w);
        }
        cart.userData.wheels = cw;
        this.carts.push(cart);
      }
    }
    this.group = g;
    this.t = Math.random() * 100;
    this.wp = 0;
  }
  followPath(path, speed, dt) {
    const wp = path[this.wp % path.length];
    const dx = wp[0] - this.group.position.x, dz = wp[1] - this.group.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 3) { this.wp++; return; }
    const step = speed * dt;
    this.group.position.x += dx / d * step;
    this.group.position.z += dz / d * step;
    const target = Math.atan2(dx, dz);
    let diff = target - this.group.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.group.rotation.y += diff * Math.min(1, dt * 3);
    for (const w of this.wheels) w.rotation.x += step / 0.5;
    if (this.carts) {
      let lead = this.group.position;
      const back = new THREE.Vector3(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
      this.carts.forEach((c, i) => {
        const goal = 4.2 * (i + 1);
        const want = new THREE.Vector3().copy(lead).addScaledVector(back, goal - (i === 0 ? 0 : 0));
        // posição: segue o ponto atrás do veículo
        const tx = wp[0] - want.x, tz = wp[1] - want.z;
        const dd = Math.hypot(tx, tz);
        if (dd > 4.0 * (i + 1)) {
          c.position.x += (dx / d) * step;
          c.position.z += (dz / d) * step;
        }
        let cd = target - c.rotation.y;
        while (cd > Math.PI) cd -= Math.PI * 2;
        while (cd < -Math.PI) cd += Math.PI * 2;
        c.rotation.y += cd * Math.min(1, dt * 2.4);
        for (const w of c.userData.wheels) w.rotation.x += step / 0.45;
      });
    }
  }
}

class Crowd {
  constructor(scene) {
    this.scene = scene;
    this.people = [];
    this.vehicles = [];
    this.group = new THREE.Group();
    scene.add(this.group);

    // caminhos na área do terminal (apron)
    const paths = [
      [[-60, 118], [60, 118], [90, 138], [60, 158], [-60, 158], [-90, 138]],
      [[-140, 116], [-60, 112], [0, 116], [60, 112], [140, 116], [140, 132], [-140, 132]],
      [[120, 150], [170, 150], [170, 190], [120, 190]],
      [[-120, 150], [-170, 150], [-170, 190], [-120, 190]],
    ];
    for (let i = 0; i < 18; i++) {
      const p = new Person();
      const path = paths[i % paths.length];
      p.path = path;
      const s = path[Math.floor(Math.random() * path.length)];
      p.group.position.set(s[0] + Math.random() * 8 - 4, WORLD.airportH, s[1] + Math.random() * 8 - 4);
      this.people.push(p);
      this.group.add(p.group);
    }
    // equipe de solo perto da pista
    const rwPath = [[-220, 62], [-60, 62], [60, 62], [220, 62], [60, 54], [-60, 54]];
    for (let i = 0; i < 4; i++) {
      const p = new Person();
      p.path = rwPath;
      p.group.position.set(rwPath[i * 2 % rwPath.length][0], WORLD.airportH, rwPath[0][1]);
      p.speed = 0.7 + Math.random() * 0.5;
      this.people.push(p);
      this.group.add(p.group);
    }

    // veículos de serviço com rotas próprias
    const fuel = new ServiceVehicle('fuel');
    fuel.path = [[150, 125], [320, 125], [320, 142], [150, 142]];
    fuel.group.position.set(150, WORLD.airportH, 125);
    fuel.speed = 5.5;
    this.vehicles.push(fuel);
    this.group.add(fuel.group);

    const tug = new ServiceVehicle('tug');
    tug.path = [[-320, 125], [-150, 125], [-150, 142], [-320, 142]];
    tug.group.position.set(-320, WORLD.airportH, 125);
    tug.speed = 4.5;
    tug.carts.forEach((c, i) => {
      c.position.set(-320 - 4.2 * (i + 1), WORLD.airportH, 125);
      this.group.add(c);
    });
    this.vehicles.push(tug);
    this.group.add(tug.group);
  }
  update(dt) {
    for (const p of this.people) p.update(dt);
    for (const v of this.vehicles) v.followPath(v.path, v.speed, dt);
  }
}

// ============================================================================
export class World {
  constructor(scene, env, quality) {
    this.scene = scene;
    this.env = env;
    this.quality = quality;

    // ---------- terreno ----------
    const terraMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.terrain = new ChunkedTerrain(scene, terraMat);

    // ---------- oceano ----------
    const oceanGeo = new THREE.PlaneGeometry(26000, 26000, 48, 48);
    oceanGeo.rotateX(-Math.PI / 2);
    this.oceanGeo = oceanGeo;
    this.oceanBase = oceanGeo.attributes.position.array.slice();
    this.ocean = new THREE.Mesh(oceanGeo, new THREE.MeshStandardMaterial({
      color: 0x14548a, roughness: 0.15, metalness: 0.55, transparent: true, opacity: 0.94,
    }));
    this.ocean.position.y = WORLD.seaLevel;
    this.ocean.receiveShadow = false;
    scene.add(this.ocean);

    // ---------- aeroporto ----------
    this._buildAirport(scene);
    this._buildCity(scene);
    this._buildTrees(scene);
    this.crowd = new Crowd(scene);

    this.setQuality(quality);
    this._t = 0;
  }

  // ---------------------------------------------------------------- aeroporto
  _buildAirport(scene) {
    const g = new THREE.Group();
    const H = WORLD.airportH;

    // ---- pista ----
    const rl = WORLD.runwayHalfLen * 2, rw = WORLD.runwayW;
    const rwy = new THREE.Mesh(
      new THREE.PlaneGeometry(rl, rw),
      new THREE.MeshStandardMaterial({ map: runwayTexture(), roughness: 0.92, metalness: 0.0 })
    );
    rwy.rotation.x = -Math.PI / 2;
    rwy.position.set(0, H + 0.06, 0);
    rwy.receiveShadow = true;
    g.add(rwy);

    // taxiway + apron
    const taxiMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.95 });
    const taxi = new THREE.Mesh(new THREE.PlaneGeometry(60, 26), taxiMat);
    taxi.rotation.x = -Math.PI / 2; taxi.position.set(0, H + 0.05, 90);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(760, 120), taxiMat.clone());
    apron.rotation.x = -Math.PI / 2; apron.position.set(0, H + 0.05, 170);
    apron.receiveShadow = true;
    g.add(taxi, apron);
    for (const x of [-340, 0, 340]) {
      const link = new THREE.Mesh(new THREE.PlaneGeometry(26, 90), taxiMat);
      link.rotation.x = -Math.PI / 2; link.position.set(x, H + 0.045, 50);
      g.add(link);
      // linha amarela central
      const line = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 86), new THREE.MeshBasicMaterial({ color: 0xd8c22e }));
      line.rotation.x = -Math.PI / 2; line.position.set(x, H + 0.07, 50);
      g.add(line);
    }

    // ---- terminal ----
    const winTex = windowTexture();
    this.winTex = winTex;
    const term = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(320, 22, 46),
      new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.5, metalness: 0.15 }));
    body.position.y = 11; body.castShadow = true; body.receiveShadow = true;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(320.4, 12, 47),
      new THREE.MeshStandardMaterial({
        color: 0x1c2c40, roughness: 0.12, metalness: 0.85,
        emissive: 0xffc873, emissiveMap: winTex, emissiveIntensity: 0,
      }));
    glass.position.y = 9;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(326, 2.4, 52),
      new THREE.MeshStandardMaterial({ color: 0x51606e, roughness: 0.6 }));
    roof.position.y = 23;
    term.add(body, glass, roof);
    term.position.set(0, H, 225);
    g.add(term);

    // cais de embarque (fingers)
    for (const x of [-120, 0, 120]) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 60),
        new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: 0.6 }));
      finger.position.set(x, H + 2.5, 180);
      finger.castShadow = true;
      g.add(finger);
    }

    // ---- torre de controle ----
    const tower = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(5, 7, 46, 12),
      new THREE.MeshStandardMaterial({ color: 0xd5dbe2, roughness: 0.55 }));
    shaft.position.y = 23;
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(10, 8, 9, 12),
      new THREE.MeshStandardMaterial({
        color: 0x24344a, roughness: 0.2, metalness: 0.7,
        emissive: 0x86b8ff, emissiveIntensity: 0,
      }));
    cab.position.y = 50; cab.castShadow = true;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(10.5, 4, 12), new THREE.MeshStandardMaterial({ color: 0x8d99a6 }));
    cap.position.y = 56.5;
    tower.add(shaft, cab, cap);
    tower.position.set(190, H, 210);
    g.add(tower);
    this.towerCab = cab;

    // ---- hangares ----
    for (const x of [-520, -400]) {
      const hg = new THREE.Group();
      const back = new THREE.Mesh(new THREE.BoxGeometry(70, 18, 40), new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.7 }));
      back.position.y = 9;
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 70, 14, 1, false, 0, Math.PI),
        new THREE.MeshStandardMaterial({ color: 0x848e98, roughness: 0.65, metalness: 0.3, side: THREE.DoubleSide }));
      arch.rotation.z = Math.PI / 2; arch.rotation.y = Math.PI / 2;
      arch.position.y = 12;
      hg.add(back, arch);
      hg.position.set(x, H, 215);
      hg.traverse(o => { if (o.isMesh) o.castShadow = true; });
      g.add(hg);
    }

    // ---- luzes da pista (instanced) ----
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lightGeo = new THREE.SphereGeometry(0.55, 6, 4);
    const pts = [];
    for (let x = -1290; x <= 1290; x += 60) { pts.push([x, rw / 2 + 3, 0xffffff]); pts.push([x, -rw / 2 - 3, 0xffffff]); }
    for (let z = -rw / 2; z <= rw / 2; z += 6) { pts.push([-1298, z, 0x35ff70]); pts.push([1298, z, 0xff4030]); }
    for (let x = -1200; x <= 1200; x += 90) pts.push([x, 0, 0x8ad4ff * 0 + 0x66c6ff]); // centro
    const inst = new THREE.InstancedMesh(lightGeo, lightMat, pts.length);
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    pts.forEach((p, i) => {
      mtx.makeTranslation(p[0], H + 0.5, p[1]);
      inst.setMatrixAt(i, mtx);
      col.setHex(p[2]);
      inst.setColorAt(i, col);
    });
    g.add(inst);
    inst.material.transparent = true;
    this.runwayLights = inst;

    // PAPI simples: 4 luzes à esquerda do threshold 09
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: i < 2 ? 0xff4030 : 0x35ff70 }));
      l.position.set(1230, H + 0.6, -rw / 2 - 10 - i * 4);
      g.add(l);
    }

    // ---- estrada aeroporto->cidade ----
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.95 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(16, 560), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = Math.PI / 2;
    road.position.set(0, H + 0.04, 360);
    g.add(road);
    const road2 = new THREE.Mesh(new THREE.PlaneGeometry(16, 900), roadMat);
    road2.rotation.x = -Math.PI / 2;
    road2.position.set(430, H + 0.04, 810);
    g.add(road2);
    const road3 = new THREE.Mesh(new THREE.PlaneGeometry(16, 1100), roadMat);
    road3.rotation.x = -Math.PI / 2;
    road3.rotation.z = Math.PI / 2;
    road3.position.set(0, H + 0.04, 480);
    // (via interna da cidade)
    road3.position.set(0, H + 3.2 + 0.04, 700);
    g.add(road2, road3);

    scene.add(g);
  }

  // ---------------------------------------------------------------- cidade
  _buildCity(scene) {
    const group = new THREE.Group();
    const cityH = WORLD.airportH + 3.2;

    // grade de quarteirões com ruas
    const cell = 92, nx = 13, nz = 9;
    const x0 = -330, z0 = 420;
    const maxCount = nx * nz * 2;
    const winTex = this.winTex;

    const bMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.55, metalness: 0.25,
      emissive: 0xffdf9e, emissiveMap: winTex, emissiveIntensity: 0,
    });
    const bGeo = new THREE.BoxGeometry(1, 1, 1);
    bGeo.translate(0, 0.5, 0);
    this.buildings = new THREE.InstancedMesh(bGeo, bMat, maxCount);
    this.buildings.receiveShadow = true;
    this.buildings.castShadow = true;

    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    let i = 0;
    for (let gx = 0; gx < nx && i < maxCount; gx++) {
      for (let gz = 0; gz < nz && i < maxCount; gz++) {
        const bx = x0 + gx * cell + 30, bz = z0 + gz * cell + 30;
        const n = 1 + (Math.random() < 0.5 ? 1 : 0);
        for (let k = 0; k < n && i < maxCount; k++) {
          const w = 20 + Math.random() * 26;
          const d = 20 + Math.random() * 26;
          const centerBoost = 1 - Math.hypot(gx - nx / 2, gz - nz / 2) / (nx * 0.7);
          const h = 14 + Math.random() * 40 + Math.max(0, centerBoost) * 130 * Math.random();
          const px = bx + (Math.random() - 0.5) * 26 + k * (w + 6);
          const pz = bz + (Math.random() - 0.5) * 26;
          mtx.makeTranslation(px, cityH, pz);
          mtx.scale(new THREE.Vector3(w, h, d));
          this.buildings.setMatrixAt(i, mtx);
          col.setHSL(0.55 + Math.random() * 0.1, 0.08 + Math.random() * 0.1, 0.45 + Math.random() * 0.3);
          this.buildings.setColorAt(i, col);
          i++;
        }
      }
    }
    this.buildings.count = i;
    group.add(this.buildings);

    // ruas da cidade
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.95 });
    for (let gx = 0; gx <= nx; gx++) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(10, nz * cell + 40), roadMat);
      r.rotation.x = -Math.PI / 2;
      r.position.set(x0 + gx * cell, cityH + 0.03, z0 + nz * cell / 2);
      group.add(r);
    }
    for (let gz = 0; gz <= nz; gz++) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(nx * cell + 40, 10), roadMat);
      r.rotation.x = -Math.PI / 2;
      r.position.set(x0 + nx * cell / 2, cityH + 0.03, z0 + gz * cell);
      group.add(r);
    }

    // postes com luz à noite (sprites)
    this.streetLights = new THREE.Group();
    const poleGeo = new THREE.CylinderGeometry(0.14, 0.18, 7, 5);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x40484f });
    const glowGeo = new THREE.SphereGeometry(0.4, 6, 4);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
    for (let gx = 1; gx < nx; gx += 2) {
      for (let gz = 1; gz < nz; gz += 2) {
        const p = new THREE.Mesh(poleGeo, poleMat);
        p.position.set(x0 + gx * cell, cityH + 3.5, z0 + gz * cell);
        const gl = new THREE.Mesh(glowGeo, glowMat);
        gl.position.set(0, 3.6, 0);
        p.add(gl);
        this.streetLights.add(p);
      }
    }
    group.add(this.streetLights);
    this.cityGroup = group;
    scene.add(group);
  }

  // ---------------------------------------------------------------- florestas
  _buildTrees(scene) {
    const maxTrees = 1400;
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 4, 5);
    trunkGeo.translate(0, 2, 0);
    const crownGeo = new THREE.IcosahedronGeometry(3.2, 0);
    crownGeo.translate(0, 6.4, 0);
    this.trunkMesh = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5d452c }), maxTrees);
    this.crownMesh = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0x3f6d2c, flatShading: true }), maxTrees);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    let i = 0;
    let guard = 0;
    while (i < maxTrees && guard++ < maxTrees * 14) {
      const x = (Math.random() - 0.5) * 7200;
      const z = (Math.random() - 0.5) * 7200;
      // evita pista/cidade
      if (rectBlend(x, z, -1800, 1800, -340, 340, 60) > 0.01) continue;
      if (rectBlend(x, z, -400, 1000, 380, 1400, 60) > 0.01) continue;
      const h = terrainHeight(x, z);
      if (h < 3 || h > 460) continue;
      const slope = Math.abs(terrainHeight(x + 8, z) - h) + Math.abs(terrainHeight(x, z + 8) - h);
      if (slope > 14) continue;
      const sc = 0.8 + Math.random() * 1.7;
      p.set(x, h - 0.2, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
      s.set(sc, sc * (0.9 + Math.random() * 0.5), sc);
      mtx.compose(p, q, s);
      this.trunkMesh.setMatrixAt(i, mtx);
      this.crownMesh.setMatrixAt(i, mtx);
      col.setHSL(0.26 + Math.random() * 0.09, 0.5, 0.28 + Math.random() * 0.14);
      this.crownMesh.setColorAt(i, col);
      i++;
    }
    this.trunkMesh.count = i;
    this.crownMesh.count = i;
    this.trunkMesh.frustumCulled = false;
    this.crownMesh.frustumCulled = false;
    this.treeGroup = new THREE.Group();
    this.treeGroup.add(this.trunkMesh, this.crownMesh);
    scene.add(this.treeGroup);
  }

  // ---------------------------------------------------------------- qualidade
  setQuality(q) {
    this.quality = q;
    const conf = {
      low:    { trees: 300, shadow: false, cityRange: 1500 },
      medium: { trees: 650, shadow: true, cityRange: 2600 },
      high:   { trees: 1000, shadow: true, cityRange: 3800 },
      ultra:  { trees: 1400, shadow: true, cityRange: 5000 },
    }[q];
    this.trunkMesh.count = Math.min(this.trunkMesh.count, conf.trees);
    this.crownMesh.count = conf.trees;
    this.trunkMesh.castShadow = conf.shadow;
    this.crownMesh.castShadow = conf.shadow;
    this.crownMesh.receiveShadow = conf.shadow;
    this.buildings.castShadow = q === 'ultra';
    this._cityRange = conf.cityRange;
  }

  update(dt, planePos, nightF) {
    this._t += dt;
    // terreno segue a aeronave
    this.terrain.update(planePos.x, planePos.z);
    // oceano segue a câmera (x,z) com ondas leves
    this.ocean.position.x = planePos.x;
    this.ocean.position.z = planePos.z;
    const p = this.oceanGeo.attributes.position.array;
    const base = this.oceanBase;
    for (let i = 0; i < p.length; i += 3) {
      p[i + 1] = Math.sin(this._t * 1.1 + base[i] * 0.02 + base[i + 2] * 0.013) * 0.6;
    }
    this.oceanGeo.attributes.position.needsUpdate = true;

    // cidade some além do alcance (otimização por distância)
    const dCity = Math.hypot(planePos.x - 300, planePos.z - 900);
    const vis = dCity < this._cityRange;
    this.cityGroup.visible = vis;
    this.streetLights.visible = vis;

    // emissivas noturnas
    const glow = nightF;
    this.buildings.material.emissiveIntensity = glow * 0.85;
    this.towerCab.material.emissiveIntensity = glow * 1.2;
    this.runwayLights.material.opacity = 0.25 + glow * 0.75;
    this.streetLights.children.forEach((pole) => {
      const gl = pole.children[0];
      if (gl) gl.material = gl.material || glowMatShared;
    });

    // população viva
    this.crowd.update(dt);
  }
}
const glowMatShared = new THREE.MeshBasicMaterial({ color: 0xffd98a });
