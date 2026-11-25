import * as THREE from 'three';
import { clamp, normalizeAngle } from '../sim/car';
import { MAX_BOOST_SPEED } from '../sim/constants';
import type { CarState } from '../sim/types';

export interface SpeedCameraMetrics {
  readonly fov: number;
  readonly backDist: number;
  readonly height: number;
  readonly lookAhead: number;
}

/**
 * Pure smooth speed-response curve for the chase camera (0..270 km/h).
 * Strictly monotonic and continuous with zero discontinuous jumps at any speed.
 */
export function computeSpeedCameraMetrics(speedMetersPerSec: number): SpeedCameraMetrics {
  const s = clamp(speedMetersPerSec / MAX_BOOST_SPEED, 0, 1);
  // Smooth ease-in-out power blend for natural stretching as speed climbs past 216 -> 270 km/h
  const stretch = s * s * (1.35 - 0.35 * s);
  return {
    fov: 56 + 26 * stretch, // 56 deg standstill -> ~70 deg @ 216 km/h -> 82 deg @ 270 km/h
    backDist: 6.8 + 3.6 * stretch, // 6.8 m standstill -> ~9.0 m @ 216 km/h -> 10.4 m @ 270 km/h
    height: 3.05 - 0.38 * stretch, // drops subtly closer to asphalt at top speed
    lookAhead: 7.2 + 6.8 * s,
  };
}

/**
 * Behind-and-above chase camera that widens its perspective and drops back
 * smoothly with speed, then settles again cleanly as the car slows.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private followHeading = 0;
  private smoothedSpeed = 0;
  private initialized = false;
  private readonly lookTarget = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(56, aspect, 0.3, 1400);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  reset(car: CarState): void {
    this.followHeading = car.heading;
    this.smoothedSpeed = car.speed;
    this.initialized = false;
    this.camera.position.set(0, 0, 0);
    this.update(car, 1 / 60);
  }

  update(car: CarState, dt: number): void {
    const safeDt = Math.min(Math.max(dt, 1 / 240), 0.25);
    if (!this.initialized) {
      this.followHeading = car.heading;
      this.smoothedSpeed = car.speed;
      this.initialized = true;
    } else {
      const headingDelta = normalizeAngle(car.heading - this.followHeading);
      const yawBlend = 1 - Math.exp(-7.2 * safeDt);
      this.followHeading = normalizeAngle(this.followHeading + headingDelta * yawBlend);

      const speedBlend = 1 - Math.exp(-4.6 * safeDt);
      this.smoothedSpeed += (car.speed - this.smoothedSpeed) * speedBlend;
    }

    const metrics = computeSpeedCameraMetrics(this.smoothedSpeed);

    const fx = Math.cos(this.followHeading);
    const fz = Math.sin(this.followHeading);
    const desiredPosX = car.x - fx * metrics.backDist;
    const desiredPosZ = car.z - fz * metrics.backDist;

    const posBlend = 1 - Math.exp(-13 * safeDt);
    if (this.camera.position.lengthSq() === 0) {
      this.camera.position.set(desiredPosX, metrics.height, desiredPosZ);
    } else {
      this.camera.position.x += (desiredPosX - this.camera.position.x) * posBlend;
      this.camera.position.y += (metrics.height - this.camera.position.y) * posBlend;
      this.camera.position.z += (desiredPosZ - this.camera.position.z) * posBlend;
    }

    const carFx = Math.cos(car.heading);
    const carFz = Math.sin(car.heading);
    this.lookTarget.set(
      car.x + carFx * metrics.lookAhead,
      1.05,
      car.z + carFz * metrics.lookAhead,
    );
    this.camera.lookAt(this.lookTarget);

    if (Math.abs(this.camera.fov - metrics.fov) > 0.02) {
      this.camera.fov = metrics.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
