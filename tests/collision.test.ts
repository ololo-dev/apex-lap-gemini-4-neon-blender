import { describe, expect, it } from 'vitest';
import { createInitialCarState, stepCar } from '../src/sim/car';
import {
  detectCarContact,
  resolveAllCarCollisions,
  resolveCarPairCollision,
} from '../src/sim/collision';
import { CAR_HALF_LENGTH, FIXED_DT } from '../src/sim/constants';
import { computeAutoDriverInput } from '../src/sim/driver';
import { getDefaultTrack } from '../src/sim/track';
import type { CarState } from '../src/sim/types';

function makeMovingCar(x: number, z: number, heading: number, speed: number): CarState {
  const base = createInitialCarState(x, z, heading);
  const vx = Math.cos(heading) * speed;
  const vz = Math.sin(heading) * speed;
  return {
    ...base,
    vx,
    vz,
    forwardSpeed: speed,
    speed,
  };
}

describe('Car-to-car contact and overtaking', () => {
  it('detects overlap accurately and ignores separated cars', () => {
    const a = makeMovingCar(0, 0, 0, 20);
    const far = makeMovingCar(20, 0, 0, 20);
    expect(detectCarContact(a, far).collided).toBe(false);

    const overlap = makeMovingCar(CAR_HALF_LENGTH * 1.5, 0, 0, 10);
    const contact = detectCarContact(a, overlap);
    expect(contact.collided).toBe(true);
    expect(contact.depth).toBeGreaterThan(0.5);
  });

  it('pushes colliding cars apart and scrubs speed so neither passes through the other', () => {
    let rear = makeMovingCar(0, 0, 0, 42);
    let front = makeMovingCar(3.2, 0, 0, 18); // overlapping nose-to-tail
    const speedBeforeRear = rear.speed;

    const [resRear, resFront, hit] = resolveCarPairCollision(rear, front);
    expect(hit).toBe(true);
    expect(detectCarContact(resRear, resFront).collided).toBe(false);
    expect(resRear.x).toBeLessThan(resFront.x - CAR_HALF_LENGTH * 1.9);
    expect(resRear.speed).toBeLessThan(speedBeforeRear);

    // Simulate closing cars over multiple steps: rear never tunnels through front
    rear = makeMovingCar(0, 0, 0, 45);
    front = makeMovingCar(8, 0, 0, 12);
    for (let i = 0; i < 60; i++) {
      rear = stepCar(rear, { throttle: 1, brake: 0, steer: 0 }, true, FIXED_DT);
      front = stepCar(front, { throttle: 0.2, brake: 0, steer: 0 }, true, FIXED_DT);
      const solved = resolveAllCarCollisions([rear, front], 2);
      rear = solved.cars[0];
      front = solved.cars[1];
      expect(rear.x).toBeLessThan(front.x);
      expect(detectCarContact(rear, front).collided).toBe(false);
    }
  });

  it('makes a faster rival pull out laterally and go round a slower car ahead', () => {
    const track = getDefaultTrack();
    // Place slower car ahead on the main straight A->B and faster rival directly behind it
    const sSlow = track.sampleAtS(32);
    const sFast = track.sampleAtS(10);
    let slow = makeMovingCar(sSlow.x, sSlow.z, Math.atan2(sSlow.tz, sSlow.tx), 22);
    let fast = makeMovingCar(sFast.x, sFast.z, Math.atan2(sFast.tz, sFast.tx), 34);
    let maxLateralShift = 0;

    for (let i = 0; i < 60 * 5; i++) {
      const slowProj = track.projectPoint(slow.x, slow.z);
      const fastProj = track.projectPoint(fast.x, fast.z);

      const fastInput = computeAutoDriverInput(
        { car: fast, projection: fastProj },
        track,
        {
          pace: 1.0,
          preferredLane: 0,
          traffic: [{ car: slow, projection: slowProj }],
        },
      );
      const slowInput = computeAutoDriverInput(
        { car: slow, projection: slowProj },
        track,
        { pace: 0.72, preferredLane: 0 },
      );

      fast = stepCar(fast, fastInput, fastProj.onRoad, FIXED_DT);
      slow = stepCar(slow, slowInput, slowProj.onRoad, FIXED_DT);
      const solved = resolveAllCarCollisions([fast, slow], 2);
      fast = solved.cars[0];
      slow = solved.cars[1];

      maxLateralShift = Math.max(maxLateralShift, Math.abs(fastProj.signedOffset));
    }

    const finalFastS = track.projectPoint(fast.x, fast.z).s;
    const finalSlowS = track.projectPoint(slow.x, slow.z).s;

    // Fast rival pulled out laterally to go round and moved clearly ahead of the slower car
    expect(maxLateralShift).toBeGreaterThan(1.5);
    expect(finalFastS).toBeGreaterThan(finalSlowS + 2);
  });
});
