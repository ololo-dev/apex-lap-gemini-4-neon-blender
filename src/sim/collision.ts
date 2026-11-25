import { CAR_HALF_LENGTH, CAR_HALF_WIDTH, MAX_BOOST_SPEED } from './constants';
import type { CarState } from './types';

export interface ObbContact {
  readonly collided: boolean;
  /** Unit normal pointing from car A toward car B */
  readonly nx: number;
  readonly nz: number;
  /** Positive penetration depth (metres) */
  readonly depth: number;
}

interface Axis2D {
  readonly x: number;
  readonly z: number;
}

function projectHalfExtent(
  fx: number,
  fz: number,
  rx: number,
  rz: number,
  axis: Axis2D,
): number {
  return (
    Math.abs(fx * axis.x + fz * axis.z) * CAR_HALF_LENGTH +
    Math.abs(rx * axis.x + rz * axis.z) * CAR_HALF_WIDTH
  );
}

/**
 * Exact 2D Separating Axis Theorem (SAT) overlap test between two car OBBs.
 */
export function detectCarContact(a: CarState, b: CarState): ObbContact {
  const dx = b.x - a.x;
  const dz = b.z - a.z;

  // Quick broadphase reject (diagonal of 4.5x2.0m car is ~4.93m)
  const maxReach = 2 * Math.hypot(CAR_HALF_LENGTH, CAR_HALF_WIDTH);
  if (dx * dx + dz * dz > maxReach * maxReach) {
    return { collided: false, nx: 0, nz: 0, depth: 0 };
  }

  const afx = Math.cos(a.heading);
  const afz = Math.sin(a.heading);
  const arx = -afz;
  const arz = afx;

  const bfx = Math.cos(b.heading);
  const bfz = Math.sin(b.heading);
  const brx = -bfz;
  const brz = bfx;

  const axes: readonly Axis2D[] = [
    { x: afx, z: afz },
    { x: arx, z: arz },
    { x: bfx, z: bfz },
    { x: brx, z: brz },
  ];

  let minOverlap = Infinity;
  let bestAxisX = 1;
  let bestAxisZ = 0;

  for (const axis of axes) {
    const centerDist = Math.abs(dx * axis.x + dz * axis.z);
    const extA = projectHalfExtent(afx, afz, arx, arz, axis);
    const extB = projectHalfExtent(bfx, bfz, brx, brz, axis);
    const overlap = extA + extB - centerDist;
    if (overlap <= 0) {
      return { collided: false, nx: 0, nz: 0, depth: 0 };
    }
    if (overlap < minOverlap) {
      minOverlap = overlap;
      // Orient normal from A toward B
      const sign = dx * axis.x + dz * axis.z >= 0 ? 1 : -1;
      bestAxisX = axis.x * sign;
      bestAxisZ = axis.z * sign;
    }
  }

  return {
    collided: true,
    nx: bestAxisX,
    nz: bestAxisZ,
    depth: minOverlap,
  };
}

function syncCarVelocityFields(
  car: CarState,
  x: number,
  z: number,
  vx: number,
  vz: number,
): CarState {
  let finalVx = vx;
  let finalVz = vz;
  let speed = Math.hypot(finalVx, finalVz);
  if (speed > MAX_BOOST_SPEED) {
    const scale = MAX_BOOST_SPEED / speed;
    finalVx *= scale;
    finalVz *= scale;
    speed = MAX_BOOST_SPEED;
  }
  const fx = Math.cos(car.heading);
  const fz = Math.sin(car.heading);
  const rx = -fz;
  const rz = fx;
  return {
    ...car,
    x,
    z,
    vx: finalVx,
    vz: finalVz,
    forwardSpeed: finalVx * fx + finalVz * fz,
    lateralSpeed: finalVx * rx + finalVz * rz,
    speed,
  };
}

/**
 * Resolves overlap between two cars: pushes them apart along the minimum
 * translation vector, exchanges damped impact impulse, and scrubs speed.
 */
export function resolveCarPairCollision(
  a: CarState,
  b: CarState,
): readonly [CarState, CarState, boolean] {
  const contact = detectCarContact(a, b);
  if (!contact.collided) {
    return [a, b, false];
  }

  const { nx, nz, depth } = contact;
  const push = depth * 0.5 + 0.015;
  const ax = a.x - nx * push;
  const az = a.z - nz * push;
  const bx = b.x + nx * push;
  const bz = b.z + nz * push;

  let avx = a.vx;
  let avz = a.vz;
  let bvx = b.vx;
  let bvz = b.vz;

  // Relative velocity along contact normal (negative means closing)
  const relVn = (bvx - avx) * nx + (bvz - avz) * nz;
  if (relVn < 0) {
    const restitution = 0.24;
    const impulse = -(1 + restitution) * relVn * 0.5;
    avx -= impulse * nx;
    avz -= impulse * nz;
    bvx += impulse * nx;
    bvz += impulse * nz;
  }

  // Realistic contact speed scrub proportional to collision severity
  const closingSpeed = Math.max(0, -relVn);
  const scrubFactor = Math.max(0.84, 0.96 - closingSpeed * 0.008);
  avx *= scrubFactor;
  avz *= scrubFactor;
  bvx *= scrubFactor;
  bvz *= scrubFactor;

  return [
    syncCarVelocityFields(a, ax, az, avx, avz),
    syncCarVelocityFields(b, bx, bz, bvx, bvz),
    true,
  ];
}

/**
 * Resolves all pairwise car-to-car contacts across the field with iterative passes
 * so no two cars ever overlap or pass through one another.
 */
export function resolveAllCarCollisions(
  cars: readonly CarState[],
  iterations = 2,
): { readonly cars: CarState[]; readonly hadCollision: boolean } {
  const next = cars.slice();
  let hadCollision = false;

  for (let iter = 0; iter < iterations; iter++) {
    let iterHit = false;
    for (let i = 0; i < next.length; i++) {
      for (let j = i + 1; j < next.length; j++) {
        const [resA, resB, hit] = resolveCarPairCollision(next[i], next[j]);
        if (hit) {
          next[i] = resA;
          next[j] = resB;
          iterHit = true;
          hadCollision = true;
        }
      }
    }
    if (!iterHit) break;
  }

  return { cars: next, hadCollision };
}
