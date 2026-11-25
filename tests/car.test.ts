import { describe, expect, it } from 'vitest';
import { createInitialCarState, stepCar } from '../src/sim/car';
import {
  FIXED_DT,
  KM_H_PER_M_S,
  MAX_OFF_ROAD_SPEED,
  MAX_REVERSE_SPEED,
  MAX_ROAD_SPEED,
} from '../src/sim/constants';
import type { CarState, ControlInput } from '../src/sim/types';

function runCarSteps(
  initial: CarState,
  input: ControlInput,
  onRoad: boolean,
  seconds: number,
): CarState {
  let car = initial;
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    car = stepCar(car, input, onRoad, FIXED_DT);
  }
  return car;
}

describe('Car driving physics', () => {
  it('accelerates up to 216 km/h (60 m/s) on the road and no more', () => {
    let car = createInitialCarState(0, 0, 0);
    const accel: ControlInput = { throttle: 1, brake: 0, steer: 0 };

    car = runCarSteps(car, accel, true, 12);
    expect(car.speed).toBeCloseTo(MAX_ROAD_SPEED, 1);
    expect(car.speed * KM_H_PER_M_S).toBeLessThanOrEqual(216 + 1e-6);
    expect(car.speed * KM_H_PER_M_S).toBeGreaterThan(215);

    // Holding throttle even longer never exceeds 216 km/h
    car = runCarSteps(car, accel, true, 6);
    expect(car.speed).toBeLessThanOrEqual(MAX_ROAD_SPEED + 1e-9);
  });

  it('brakes to a stop and reverses when brake is held longer', () => {
    let car = createInitialCarState(0, 0, 0);
    car = runCarSteps(car, { throttle: 1, brake: 0, steer: 0 }, true, 2.5);
    expect(car.forwardSpeed).toBeGreaterThan(20);

    // Brake until stopped
    let stopped = false;
    for (let i = 0; i < 180; i++) {
      car = stepCar(car, { throttle: 0, brake: 1, steer: 0 }, true, FIXED_DT);
      if (Math.abs(car.forwardSpeed) < 0.05) {
        stopped = true;
        break;
      }
    }
    expect(stopped).toBe(true);
    expect(car.braking).toBe(true);

    // Continue holding brake to reverse
    car = runCarSteps(car, { throttle: 0, brake: 1, steer: 0 }, true, 2.5);
    expect(car.forwardSpeed).toBeLessThan(-8);
    expect(Math.abs(car.forwardSpeed)).toBeLessThanOrEqual(MAX_REVERSE_SPEED + 1e-6);

    // Throttle while reversing slows back toward forward
    const afterThrottle = runCarSteps(car, { throttle: 1, brake: 0, steer: 0 }, true, 1.5);
    expect(afterThrottle.forwardSpeed).toBeGreaterThan(car.forwardSpeed);
  });

  it('does not turn on the spot when standing still, but turns while moving', () => {
    const start = createInitialCarState(0, 0, 0);
    const stationarySteer = runCarSteps(
      start,
      { throttle: 0, brake: 0, steer: 1 },
      true,
      2.0,
    );
    expect(stationarySteer.heading).toBe(0);
    expect(stationarySteer.yawRate).toBe(0);
    expect(stationarySteer.x).toBe(0);
    expect(stationarySteer.z).toBe(0);

    // Moving + steering right turns heading toward +Z (positive heading)
    let movingRight = runCarSteps(start, { throttle: 1, brake: 0, steer: 0 }, true, 1.5);
    movingRight = runCarSteps(movingRight, { throttle: 0.4, brake: 0, steer: 1 }, true, 1.0);
    expect(movingRight.heading).toBeGreaterThan(0.3);
    expect(movingRight.z).toBeGreaterThan(1);

    // Moving + steering left turns heading toward -Z (negative heading)
    let movingLeft = runCarSteps(start, { throttle: 1, brake: 0, steer: 0 }, true, 1.5);
    movingLeft = runCarSteps(movingLeft, { throttle: 0.4, brake: 0, steer: -1 }, true, 1.0);
    expect(movingLeft.heading).toBeLessThan(-0.3);
    expect(movingLeft.z).toBeLessThan(-1);
  });

  it('carries the car wide when a corner is taken too fast', () => {
    // Low-speed cornering vs high-speed cornering with the same full-right steering input
    let slowCar = createInitialCarState(0, 0, 0);
    slowCar = runCarSteps(slowCar, { throttle: 1, brake: 0, steer: 0 }, true, 1.2); // ~18 m/s
    let fastCar = createInitialCarState(0, 0, 0);
    fastCar = runCarSteps(fastCar, { throttle: 1, brake: 0, steer: 0 }, true, 8.0); // ~60 m/s

    const slowTurn = runCarSteps(slowCar, { throttle: 0.3, brake: 0, steer: 1 }, true, 1.0);
    const fastTurn = runCarSteps(fastCar, { throttle: 0.3, brake: 0, steer: 1 }, true, 1.0);

    // Effective turning radius R = v / |yawRate| is much larger (wider) at high speed
    const slowRadius = slowTurn.speed / Math.max(Math.abs(slowTurn.yawRate), 1e-4);
    const fastRadius = fastTurn.speed / Math.max(Math.abs(fastTurn.yawRate), 1e-4);
    expect(fastRadius).toBeGreaterThan(slowRadius * 3);
    // Lateral slip pushes the fast car outward (negative lateral velocity during a right turn)
    expect(Math.abs(fastTurn.lateralSpeed)).toBeGreaterThan(0.5);
  });

  it('holds the car to 72 km/h (20 m/s) off the road until back on road', () => {
    // Accelerating from rest off-road never exceeds 72 km/h
    const offRoadAccel = runCarSteps(
      createInitialCarState(0, 20, 0),
      { throttle: 1, brake: 0, steer: 0 },
      false,
      6.0,
    );
    expect(offRoadAccel.offRoad).toBe(true);
    expect(offRoadAccel.speed).toBeCloseTo(MAX_OFF_ROAD_SPEED, 1);
    expect(offRoadAccel.speed * KM_H_PER_M_S).toBeLessThanOrEqual(72 + 1e-6);

    // Leaving the road at 216 km/h rapidly slows down and holds at 72 km/h
    let fastCar = runCarSteps(
      createInitialCarState(0, 0, 0),
      { throttle: 1, brake: 0, steer: 0 },
      true,
      10.0,
    );
    expect(fastCar.speed * KM_H_PER_M_S).toBeGreaterThan(200);

    fastCar = runCarSteps(fastCar, { throttle: 1, brake: 0, steer: 0 }, false, 1.5);
    expect(fastCar.offRoad).toBe(true);
    expect(fastCar.speed).toBeLessThanOrEqual(MAX_OFF_ROAD_SPEED + 1e-6);

    // Returning to road allows accelerating past 72 km/h again
    const backOnRoad = runCarSteps(fastCar, { throttle: 1, brake: 0, steer: 0 }, true, 3.0);
    expect(backOnRoad.offRoad).toBe(false);
    expect(backOnRoad.speed * KM_H_PER_M_S).toBeGreaterThan(150);
  });

  it('coasts gently to a stop when neither throttle nor brake is pressed', () => {
    let car = runCarSteps(
      createInitialCarState(0, 0, 0),
      { throttle: 1, brake: 0, steer: 0 },
      true,
      0.5,
    );
    const speedBeforeCoast = car.speed;
    car = runCarSteps(car, { throttle: 0, brake: 0, steer: 0 }, true, 6.0);
    expect(car.speed).toBeLessThan(speedBeforeCoast);
    expect(car.speed).toBeCloseTo(0, 2);
  });
});
