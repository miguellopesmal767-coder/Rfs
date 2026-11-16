// ============================================================================
// physics.js — Modelo aerodinâmico baseado em forças:
// sustentação (CL x ângulo de ataque), arrasto, empuxo, gravidade,
// densidade do ar, estol, vento cruzado, turbulência, dinâmica rotacional
// (arfagem/rolagem/guinada), solo com freios/esteering e consumo.
// ============================================================================
import * as THREE from 'three';

const G = 9.81;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const MS2KT = 1.94384;
const FT = 3.28084;

export class FlightModel {
  constructor(spec) {
    this.spec = spec;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();     // taxas no corpo (rad/s): x=arf, y=gui, z=rol
    this.accWorld = new THREE.Vector3();   // para efeitos visuais

    this.throttle = 0;
    this.rpm = 0;                          // 0..1 (spool)
    this.temp = 20;
    this.fuel = spec.fuelCap;
    this.flapsIdx = 0;
    this.gearDown = true;
    this.gearPos = 1;                      // 1=abaixado, 0=recolhido
    this.spoilers = false;
    this.brakes = 0;
    this.reverse = false;
    this.engineOn = true;

    this.onGround = true;
    this.crashed = false;
    this.crashReason = '';
    this.stalled = false;
    this.overheat = false;
    this.gLoad = 1;
    this.touchedDown = false;
    this.lastTouchVS = 0;

    // vetores reutilizados
    this._fwd = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._airVel = new THREE.Vector3();
    this._vb = new THREE.Vector3();
    this._force = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._q2 = new THREE.Quaternion();
    this._eul = new THREE.Euler();
    this._wind = new THREE.Vector3();
    this.alpha = 0; this.beta = 0; this.qbar = 0;
  }

  reset(spawn, headingDeg, speed, altitude) {
    const spec = this.spec;
    this.pos.copy(spawn);
    this.quat.setFromEuler(new THREE.Euler(0, headingDeg * D2R, 0, 'YXZ'));
    // velocidade inicial ao longo do nariz
    this._fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.vel.copy(this._fwd).multiplyScalar(speed);
    if (altitude > 0) this.vel.y = 0;
    this.angVel.set(0, 0, 0);
    this.throttle = 0; this.rpm = 0; this.temp = 20;
    this.fuel = spec.fuelCap;
    this.flapsIdx = 0;
    this.gearDown = altitude === 0;
    this.gearPos = this.gearDown ? 1 : 0;
    this.spoilers = false; this.brakes = 0; this.reverse = false;
    this.onGround = altitude === 0;
    this.crashed = false; this.crashReason = '';
    this.stalled = false; this.touchedDown = false;
    this.gLoad = 1;
    if (altitude > 0) { this.throttle = 0.7; this.rpm = 0.7; }
  }

  get mass() { return this.spec.mass + this.fuel; }

  step(dt, input, env, groundH, t) {
    if (this.crashed) return;
    const spec = this.spec;

    // -------------------- sistemas --------------------
    // acelerador com resposta progressiva (spool)
    this.throttle = THREE.MathUtils.clamp(Number(input.throttle) || 0, 0, 1);
    const spoolT = spec.engine.spool;
    const rpmTarget = this.throttle;
    this.rpm += (rpmTarget - this.rpm) * Math.min(1, dt / spoolT);

    // temperatura do motor
    const tempTarget = 20 + this.rpm * (this.throttle > 0.9 ? 118 : 96);
    this.temp += (tempTarget - this.temp) * Math.min(1, dt * 0.05);
    this.overheat = this.temp > 108;
    const thrustEff = this.overheat ? 0.65 : 1;

    // combustível
    if (this.fuel > 0) {
      this.fuel = Math.max(0, this.fuel - this.throttle * spec.fuelBurn * dt);
    }
    this.engineOn = this.fuel > 0;

    // trem de pouso (animação 2.2 s)
    this.gearDown = input.gearDown;
    const gSpeed = spec.gear.retractable ? 1 / 2.2 : 99;
    this.gearPos = THREE.MathUtils.clamp(this.gearPos + (this.gearDown ? gSpeed : -gSpeed) * dt, 0, 1);

    this.flapsIdx = THREE.MathUtils.clamp(Number(input.flapsIdx) || 0, 0, spec.flaps.length - 1);
    this.spoilers = !!input.spoilers && spec.hasSpoiler;
    this.brakes = THREE.MathUtils.clamp(Number(input.brakes) || 0, 0, 1);
    this.reverse = !!input.reverse && spec.hasReverse;

    // -------------------- ar -------------------- 
    const rho = Math.max(env.airDensity(this.pos.y), 0.0001);
    env.getWind(this._wind, t);
    this._airVel.copy(this.vel).sub(this._wind);
    const V = this._airVel.length();

    this._fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this._up.set(0, 1, 0).applyQuaternion(this.quat);
    this._right.set(1, 0, 0).applyQuaternion(this.quat);

    // velocidade do ar no referencial do corpo
    this._q2.copy(this.quat).invert();
    this._vb.copy(this._airVel).applyQuaternion(this._q2);
    this.alpha = V > 2 ? Math.atan2(-this._vb.y, Math.max(0.001, this._vb.z)) : 0;
    this.beta = V > 2 ? Math.atan2(this._vb.x, Math.max(0.001, this._vb.z)) : 0;
    this.qbar = 0.5 * rho * V * V;

    // -------------------- coeficientes --------------------
    const flap = spec.flaps[this.flapsIdx];
    const aStall = spec.alphaStall * D2R - this.flapsIdx * 1.2 * D2R;
    let CL = spec.CL0 + spec.CLa * this.alpha + flap.cl;
    const aDeg = this.alpha * R2D;
    this.stalled = false;
    if (this.alpha > aStall) {
      // estol: perda progressiva de sustentação
      const over = (this.alpha - aStall) / D2R;
      const clMax = CL;
      CL = Math.max(clMax * (1 - over / 9), 0.35);
      this.stalled = over > 0.6;
    } else if (this.alpha < -0.14) {
      // alpha negativo extremo
      CL = Math.max(CL, -0.6);
    }
    if (this.spoilers) CL *= 0.62;

    let CD = spec.CD0 + spec.kInd * CL * CL + flap.cd
      + spec.gear.drag * this.gearPos
      + (this.spoilers ? 0.06 : 0)
      + (Math.abs(this.beta) > 0.12 ? 0.02 * Math.abs(this.beta) * 10 : 0);
    // arrasto compressivo
    const mach = V / 320;
    if (mach > 0.75) CD += (mach - 0.75) * 0.25;

    const S = spec.S;
    const qbarS = this.qbar * S;

    // -------------------- forças --------------------
    this._force.set(0, -this.mass * G, 0);

    // empuxo
    let thrust = 0;
    if (this.engineOn) {
      const rhoFac = rho / 1.225;
      if (spec.engine.type === 'prop') {
        const fade = THREE.MathUtils.clamp(V / (spec.vne * 1.6), 0, 1);
        thrust = spec.engine.maxThrust * this.rpm * (1 - spec.engine.thrustFade * fade) * rhoFac;
      } else {
        thrust = spec.engine.maxThrust * this.rpm * rhoFac * (0.35 + 0.65 * Math.min(1, this.rpm + 0.15));
      }
      thrust *= thrustEff;
      // reverso: mesmo em idle o jato empurra para trás (mínimo 30%)
      if (this.reverse && this.onGround) {
        thrust = -Math.abs(spec.engine.maxThrust) * 0.45 * Math.max(this.rpm, 0.3) * rhoFac * thrustEff;
      }
      this._tmp.copy(this._fwd).multiplyScalar(thrust / (spec.engine.count || 1) * (spec.engine.count || 1));
      this._force.add(this._tmp);
    }

    // sustentação (perpendicular ao vento relativo)
    if (V > 1) {
      const airDir = this._tmp.copy(this._airVel).normalize();
      // direção de sustentação: up projetado perpendicular ao vento relativo
      const liftDir = this._tmp2.copy(this._up).addScaledVector(airDir, -this._up.dot(airDir)).normalize();
      this._force.addScaledVector(liftDir, qbarS * CL);
      // arrasto
      this._force.addScaledVector(airDir, -qbarS * CD);
      // força lateral (derrapagem)
      const sideDir = this._tmp.copy(this._right).addScaledVector(airDir, -this._right.dot(airDir)).normalize();
      this._force.addScaledVector(sideDir, -qbarS * 1.1 * this.beta);
    }

    this.gLoad = this.qbarS * CL / (this.mass * G) * Math.cos(this.beta) || 0;

    // turbulência (acelerações aleatórias proporcionais ao clima)
    if (env.cfg.turb > 0 && !this.onGround) {
      const tb = env.cfg.turb * Math.min(1, 0.4 + V / 80);
      const tn = (s) => Math.sin(t * s * 1.7 + this.pos.x * 0.001 + this.pos.y * 0.0007) * Math.sin(t * s * 0.53);
      this._force.x += tn(1.1) * tb * this.mass * 1.1;
      this._force.y += tn(0.9) * tb * this.mass * 1.5;
      this._force.z += tn(1.3) * tb * this.mass * 1.1;
    }

    // -------------------- integração linear --------------------
    this.accWorld.copy(this._force).divideScalar(this.mass);
    this.vel.addScaledVector(this.accWorld, dt);
    this.pos.addScaledVector(this.vel, dt);

    // -------------------- dinâmica rotacional --------------------
    const qfac = this.qbar / (this.qbar + spec.qRef);
    const stallEff = THREE.MathUtils.clamp(1 - (Math.abs(this.alpha) - aStall * 0.85) / (aStall * 0.8), 0.25, 1);
    let ax = 0, ay = 0, az = 0;

    const elev = THREE.MathUtils.clamp(Number(input.pitch) || 0, -1, 1);
    const ail = THREE.MathUtils.clamp(Number(input.roll) || 0, -1, 1);
    const rud = THREE.MathUtils.clamp(Number(input.yaw) || 0, -1, 1);

    if (!this.onGround) {
      // arfagem: comando + estabilidade estática + amortecimento
      // "blanking": autoridade do profundador cai perto do estol,
      // então pleno comando trim a ~alphaStall em vez de girar sem controle
      const elevBlank = THREE.MathUtils.clamp(
        1 - Math.max(0, this.alpha - aStall * 0.6) / (aStall * 0.5), 0.08, 1);
      ax += -elev * spec.pitchPow * qfac * elevBlank * stallEff;
      ax += spec.pitchStab * (this.alpha - 2.0 * D2R) * qfac * stallEff;
      ax -= spec.pitchDamp * this.angVel.x * qfac;

      // rolagem: ailerons + efeito de guinada + amortecimento
      az += -ail * spec.rollPow * qfac * stallEff;
      az -= spec.rollDamp * this.angVel.z * qfac;
      az += -this.beta * 1.2 * qfac;             // diedro

      // guinada: leme (input.yaw: +1 = direita) + vertical de cauda + amortecimento
      ay += rud * spec.yawPow * qfac * stallEff;
      ay += spec.yawStab * this.beta * qfac;
      ay -= spec.yawDamp * this.angVel.y * qfac;

      // buffeting no estol
      if (this.stalled) {
        const b = 2.2 * (1 - Math.min(1, Math.abs(this.alpha - aStall) / (8 * D2R)));
        ax += (Math.random() - 0.5) * b;
        az += (Math.random() - 0.5) * b * 2.4;
      }
      // turbulência rotacional
      if (env.cfg.turb > 0) {
        const tb = env.cfg.turb * 0.5;
        ax += Math.sin(t * 2.3 + 5) * tb * 0.4;
        az += Math.sin(t * 3.1 + 2) * tb * 0.8;
        ay += Math.sin(t * 1.7 + 9) * tb * 0.3;
      }
    } else {
      // -------------------- SOLO --------------------
      // direção: leme no solo (trem de nariz) — input.yaw +1 = direita
      const vh = Math.hypot(this.vel.x, this.vel.z);
      const steerF = THREE.MathUtils.clamp(1 - vh / 60, 0.12, 1);
      ay += rud * spec.gear.steer * steerF * (vh > 0.5 ? 1 : 0);
      ay -= this.angVel.y * 8;
      az += -this.angVel.z * 10;   // rolagem travada no solo
      // arfagem no solo: só rotação pelo profundor
      ax += -elev * spec.pitchPow * qfac * (vh > spec.vRotate * 0.55 ? 1 : 0.15);
      ax -= this.angVel.x * 14;
    }

    this.angVel.x += ax * dt;
    this.angVel.y += ay * dt;
    this.angVel.z += az * dt;
    const maxRate = 3.2;
    this.angVel.x = THREE.MathUtils.clamp(this.angVel.x, -maxRate, maxRate);
    this.angVel.y = THREE.MathUtils.clamp(this.angVel.y, -maxRate, maxRate);
    this.angVel.z = THREE.MathUtils.clamp(this.angVel.z, -maxRate, maxRate);

    // integra quaternion: q' = q ⊗ (ω_corpo·dt/2) — taxas no referencial do corpo
    const w = this.angVel;
    const halfDt = dt * 0.5;
    const dq = new THREE.Quaternion(
      w.x * halfDt, w.y * halfDt, w.z * halfDt, 1
    );
    this.quat.multiply(dq);
    this.quat.normalize();

    // -------------------- SOLO / COLISÃO --------------------
    const gh = groundH(this.pos.x, this.pos.z);
    const gearY = spec.gear.height * (0.25 + 0.75 * this.gearPos);
    const contactY = gh + gearY;
    const wasGround = this.onGround;
    this.onGround = false;

    if (this.pos.y <= contactY + 0.05) {
      const vv = this.vel.y;
      const pitchE = Math.asin(THREE.MathUtils.clamp(this._fwd.y, -1, 1)) * R2D;
      const rollE = Math.atan2(this._right.y, Math.hypot(this._right.x, this._right.z)) * R2D;
      const vh = Math.hypot(this.vel.x, this.vel.z);

      const gearOK = this.gearPos > 0.92;
      const hardVS = vv < -7.5 - (spec.key === 'cessna' ? 1.5 : 0);
      const badAtt = Math.abs(rollE) > 14 || pitchE < -6 || pitchE > 17;
      const onRunway = Math.abs(this.pos.x) < 1330 && Math.abs(this.pos.z) < 320;
      const grassHard = !onRunway && vh > 42;

      if (!wasGround || vv < -0.5) this.lastTouchVS = vv;

      if (hardVS || (badAtt && vh > 15) || (!gearOK && vh > 12) || grassHard) {
        this.crashed = true;
        this.crashReason =
          hardVS ? `Impacto excessivo — ${Math.abs(vv * FT * 60).toFixed(0)} ft/min no toque` :
          (!gearOK && vh > 12) ? 'Pouso com trem recolhido' :
          (badAtt ? `Atitude incorreta no contato (roll ${rollE.toFixed(0)}°, pitch ${pitchE.toFixed(0)}°)` :
                    'Pouso fora do aeroporto em alta velocidade');
        return;
      }

      // sustentação já venceu o peso? → sobe livremente (decola)
      // (sem isso o avião fica preso na janela de 5 cm do solo)
      if (vv > 0.05) {
        this.onGround = false;
        this.touchedDown = true;
        return;
      }

      // ---- contato válido ----
      this.onGround = true;
      this.pos.y = contactY;
      this.touchedDown = true;
      if (!wasGround) this.lastTouchVS = vv;

      // mola de solo: amortece apenas a velocidade PARA O solo
      // (se a sustentação já venceu a gravidade, deixa subir)
      if (this.vel.y < 0) this.vel.y *= -0.15;

      // atrito de rolagem + freios + reverso
      const decel = (onRunway ? 0.35 : 1.6) + this.brakes * (onRunway ? 4.6 : 2.6)
        + (this.reverse && this.engineOn ? 2.4 : 0);
      if (vh > 0.01) {
        const f = Math.max(0, vh - decel * dt) / vh;
        this.vel.x *= f; this.vel.z *= f;
      }

      // atrito lateral dos pneus (impede derrapar de lado)
      const fwdH = this._tmp.set(this._fwd.x, 0, this._fwd.z).normalize();
      const rightH = this._tmp2.set(fwdH.z, 0, -fwdH.x).negate();
      const vAlong = this.vel.x * fwdH.x + this.vel.z * fwdH.z;
      let vSide = this.vel.x * rightH.x + this.vel.z * rightH.z;
      vSide *= Math.exp(-dt * 7);
      this.vel.x = fwdH.x * vAlong + rightH.x * vSide;
      this.vel.z = fwdH.z * vAlong + rightH.z * vSide;

      // atitude no solo: nivelar asas e limitar rotação
      // (euler.x: + = nariz para BAIXO; rotação nariz-cima diminui euler.x)
      this._eul.setFromQuaternion(this.quat, 'YXZ');
      this._eul.z += (0 - this._eul.z) * Math.min(1, dt * 10);
      this._eul.x = THREE.MathUtils.clamp(this._eul.x, -11.5 * D2R, 3.5 * D2R);
      if (vh < 4) this._eul.x += (spec.restPitch - this._eul.x) * Math.min(1, dt * 1.5);
      this.quat.setFromEuler(this._eul);
    }

    // teto estrutural
    if (this.pos.y > 14000) { this.pos.y = 14000; this.vel.y = Math.min(0, this.vel.y); }
  }

  // -------------------- dados derivados para HUD --------------------
  data(env) {
    const V = this.vel.length();
    const ias = V * Math.sqrt(Math.max(env.airDensity(this.pos.y), 0) / 1.225) * MS2KT;
    const gs = V * MS2KT;
    const hdg = (Math.atan2(this._fwd.x, this._fwd.z) * R2D + 360) % 360;
    const gh = 0; // preenchido pelo main quando necessário
    return {
      iasKt: ias, gsKt: gs,
      altFt: this.pos.y * FT,
      vsFpm: this.vel.y * FT * 60,
      hdg,
      mach: V / 320,
      gLoad: this.gLoad,
      alphaDeg: this.alpha * R2D,
      stallSpeedKt: this._stallSpeedKt(env),
    };
  }
  _stallSpeedKt(env) {
    const flap = this.spec.flaps[this.flapsIdx];
    const clMax = this.spec.CL0 + this.spec.CLa * this.spec.alphaStall * D2R + flap.cl;
    const rho = Math.max(env.airDensity(this.pos.y), 0.0001);
    const v = Math.sqrt(2 * this.mass * G / (rho * this.spec.S * clMax));
    return v * MS2KT;
  }
}
