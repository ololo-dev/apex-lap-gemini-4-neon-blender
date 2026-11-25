import * as THREE from 'three';
import type { GhostSample } from '../sim/ghost';
import type { CarState } from '../sim/types';

interface DustParticle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}

/**
 * Renders one Vespera GT-7 chassis with a distinct livery color (or translucent
 * see-through ghost hologram), animated steering, 4-wheel spin, suspension roll/pitch,
 * reactive brake light bar, boost afterburner flames, and dust particles.
 */
export class CarVisual {
  readonly group = new THREE.Group();
  readonly dustGroup = new THREE.Group();

  private readonly bodyTiltGroup = new THREE.Group();
  private readonly liveryColor: string;
  private readonly isGhost: boolean;
  private wheelFL: THREE.Object3D | null = null;
  private wheelFR: THREE.Object3D | null = null;
  private wheelRL: THREE.Object3D | null = null;
  private wheelRR: THREE.Object3D | null = null;
  private brakeLightMat: THREE.MeshStandardMaterial | null = null;
  private boostFlames: THREE.Mesh[] = [];
  private fallbackMesh: THREE.Group;

  private readonly particles: DustParticle[] = [];
  private dustAccumulator = 0;
  private flamePhase = 0;

  constructor(liveryColor: string, isGhost = false) {
    this.liveryColor = liveryColor;
    this.isGhost = isGhost;
    this.group.name = isGhost ? 'VesperaGhost' : `VesperaCar_${liveryColor}`;
    this.group.add(this.bodyTiltGroup);

    this.fallbackMesh = this.createFallbackCar(liveryColor, isGhost);
    this.bodyTiltGroup.add(this.fallbackMesh);

    if (!isGhost) {
      this.initBoostFlames();
      this.initDustPool();
    } else {
      this.group.visible = false;
    }
  }

  private createFallbackCar(color: string, isGhost: boolean): THREE.Group {
    const g = new THREE.Group();
    const mat = isGhost
      ? new THREE.MeshStandardMaterial({
          color: '#6ce8ff',
          emissive: '#1ec8ff',
          emissiveIntensity: 0.75,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.72, 1.92), mat);
    body.position.y = 0.52;
    body.castShadow = !isGhost;
    g.add(body);
    return g;
  }

  private initBoostFlames(): void {
    const coneGeo = new THREE.ConeGeometry(0.11, 1.05, 10);
    // Point cone backwards along -X behind the dual rear exhaust tips
    coneGeo.rotateZ(Math.PI / 2);
    coneGeo.translate(-0.52, 0, 0);

    const outerMat = new THREE.MeshBasicMaterial({
      color: '#38d9ff',
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const innerGeo = new THREE.ConeGeometry(0.06, 0.65, 8);
    innerGeo.rotateZ(Math.PI / 2);
    innerGeo.translate(-0.32, 0, 0);
    const innerMat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    for (const ez of [-0.16, 0.16]) {
      const outer = new THREE.Mesh(coneGeo, outerMat);
      outer.position.set(-2.32, 0.34, ez);
      outer.visible = false;
      const core = new THREE.Mesh(innerGeo, innerMat);
      outer.add(core);
      this.bodyTiltGroup.add(outer);
      this.boostFlames.push(outer);
    }
  }

  /** Attaches a cloned instance of the shared Blender glTF car scene with this car's livery or ghost shader. */
  attachModelTemplate(template: THREE.Object3D): void {
    const model = template.clone(true);

    if (this.isGhost) {
      const ghostMat = new THREE.MeshStandardMaterial({
        color: '#7ef0ff',
        emissive: '#1cc8ff',
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.15,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      });
      model.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.castShadow = false;
          node.receiveShadow = false;
          node.material = ghostMat;
        }
      });
    } else {
      const paintMat = new THREE.MeshStandardMaterial({
        color: this.liveryColor,
        metalness: 0.35,
        roughness: 0.18,
      });
      model.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.castShadow = true;
        node.receiveShadow = true;

        if (node.material instanceof THREE.MeshStandardMaterial) {
          if (node.material.name === 'Vespera_Paint') {
            node.material = paintMat;
          } else if (node.name.includes('BrakeLight')) {
            const clonedBrake = node.material.clone();
            node.material = clonedBrake;
            this.brakeLightMat = clonedBrake;
          }
        }
      });
    }

    this.wheelFL = model.getObjectByName('Wheel_FL') ?? null;
    this.wheelFR = model.getObjectByName('Wheel_FR') ?? null;
    this.wheelRL = model.getObjectByName('Wheel_RL') ?? null;
    this.wheelRR = model.getObjectByName('Wheel_RR') ?? null;

    for (const w of [this.wheelFL, this.wheelFR, this.wheelRL, this.wheelRR]) {
      if (w) {
        w.rotation.order = 'YXZ';
      }
    }

    this.bodyTiltGroup.remove(this.fallbackMesh);
    this.bodyTiltGroup.add(model);
  }

  private initDustPool(): void {
    const geo = new THREE.DodecahedronGeometry(0.28, 0);
    for (let i = 0; i < 24; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: '#c9b48a',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.dustGroup.add(mesh);
      this.particles.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0.55 });
    }
  }

  private spawnDust(car: CarState): void {
    const fx = Math.cos(car.heading);
    const fz = Math.sin(car.heading);
    const rx = -fz;
    const rz = fx;
    const isOffRoad = car.offRoad;

    for (const side of [-0.84, 0.84]) {
      const slot = this.particles.find((p) => p.life <= 0);
      if (!slot) return;
      slot.life = isOffRoad ? 0.55 : 0.34;
      slot.maxLife = slot.life;
      slot.mesh.visible = true;
      slot.mesh.position.set(
        car.x - fx * 1.45 + rx * side,
        0.18,
        car.z - fz * 1.45 + rz * side,
      );
      slot.mesh.scale.setScalar(isOffRoad ? 0.95 : 0.6);
      slot.vx = -fx * 1.5;
      slot.vy = isOffRoad ? 2.1 : 1.0;
      slot.vz = -fz * 1.5;
      const mat = slot.mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(isOffRoad ? '#bfa574' : '#e4e7ec');
      mat.opacity = isOffRoad ? 0.55 : 0.32;
    }
  }

  private applyWheelPose(steerAngle: number, wheelSpin: number): void {
    const steerY = -steerAngle;
    const spinZ = -wheelSpin;
    if (this.wheelFL) {
      this.wheelFL.rotation.y = steerY;
      this.wheelFL.rotation.z = spinZ;
    }
    if (this.wheelFR) {
      this.wheelFR.rotation.y = steerY;
      this.wheelFR.rotation.z = spinZ;
    }
    if (this.wheelRL) {
      this.wheelRL.rotation.z = spinZ;
    }
    if (this.wheelRR) {
      this.wheelRR.rotation.z = spinZ;
    }
  }

  updateGhost(pose: GhostSample | null): void {
    if (!pose) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.group.position.set(pose.x, 0.02, pose.z);
    this.group.rotation.y = -pose.heading;
    this.applyWheelPose(pose.steerAngle, pose.wheelSpin);
  }

  update(car: CarState, dt: number): void {
    this.group.position.set(car.x, 0, car.z);
    this.group.rotation.y = -car.heading;

    const targetRoll = THREE.MathUtils.clamp(-car.lateralAccel * 0.0042, -0.065, 0.065);
    const targetPitch = THREE.MathUtils.clamp(car.longitudinalAccel * 0.0018, -0.045, 0.045);
    const blend = 1 - Math.exp(-12 * dt);
    this.bodyTiltGroup.rotation.x += (targetRoll - this.bodyTiltGroup.rotation.x) * blend;
    this.bodyTiltGroup.rotation.z += (targetPitch - this.bodyTiltGroup.rotation.z) * blend;

    this.applyWheelPose(car.steerAngle, car.wheelSpin);

    if (this.brakeLightMat) {
      this.brakeLightMat.emissive.set('#e80e0e');
      this.brakeLightMat.emissiveIntensity = car.braking ? 3.2 : 0.9;
    }

    // Animated twin exhaust boost flames when burning boost
    this.flamePhase += dt * 42;
    const showFlames = car.boosting && !car.offRoad;
    for (let i = 0; i < this.boostFlames.length; i++) {
      const flame = this.boostFlames[i];
      flame.visible = showFlames;
      if (showFlames) {
        const pulse = 0.85 + 0.3 * Math.sin(this.flamePhase + i * 2.1);
        flame.scale.set(pulse * 1.15, 0.9 + 0.15 * pulse, 0.9 + 0.15 * pulse);
      }
    }

    const shouldEmit =
      (car.offRoad && car.speed > 4) ||
      (!car.offRoad && Math.abs(car.lateralSpeed) > 3.8 && car.speed > 12);
    if (shouldEmit) {
      this.dustAccumulator += dt;
      if (this.dustAccumulator >= 0.045) {
        this.dustAccumulator = 0;
        this.spawnDust(car);
      }
    }

    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy *= Math.max(0, 1 - 2.4 * dt);
      const t = p.life / p.maxLife;
      p.mesh.scale.setScalar(0.75 + (1 - t) * 2.1);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = t * 0.48;
    }
  }
}
