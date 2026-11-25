import { describe, expect, it } from 'vitest';
import { computeSpeedCameraMetrics } from '../src/render/camera';
import { createInitialCarState, stepCar } from '../src/sim/car';
import {
  BOOST_BURN_SECONDS,
  BOOST_RECHARGE_SECONDS,
  FIXED_DT,
  KM_H_PER_M_S,
  MAX_BOOST_SPEED,
  MAX_OFF_ROAD_SPEED,
  MAX_ROAD_SPEED,
} from '../src/sim/constants';
import {
  createInitialGhostTracker,
  sampleGhostPose,
  stepGhostTracker,
} from '../src/sim/ghost';
import { createInitialLapState } from '../src/sim/lap';
import { createInitialRaceState, stepRace } from '../src/sim/race';
import { getDefaultTrack } from '../src/sim/track';
import type { CarState, ControlInput, LapState } from '../src/sim/types';

function stepCarForSeconds(
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

describe('Boost mechanics', () => {
  it('lifts road speed past 216 km/h up to 270 km/h while burning and drains in 3 seconds', () => {
    // Accelerate to 216 km/h first
    let car = stepCarForSeconds(
      createInitialCarState(0, 0, 0),
      { throttle: 1, brake: 0, steer: 0, boost: false },
      true,
      10,
    );
    expect(car.speed).toBeCloseTo(MAX_ROAD_SPEED, 1);
    expect(car.boostCharge).toBe(1);

    // Hold boost for 1.5 seconds -> half charge left, surging cleanly past 216 up to 270 km/h
    car = stepCarForSeconds(
      car,
      { throttle: 1, brake: 0, steer: 0, boost: true },
      true,
      1.5,
    );
    expect(car.boosting).toBe(true);
    expect(car.boostCharge).toBeCloseTo(0.5, 2);
    expect(car.speed * KM_H_PER_M_S).toBeGreaterThan(250);
    expect(car.speed).toBeLessThanOrEqual(MAX_BOOST_SPEED + 1e-6);

    // Hold remaining 1.5 seconds -> reaches 270 km/h cap and empties right at 3.0 seconds total
    car = stepCarForSeconds(
      car,
      { throttle: 1, brake: 0, steer: 0, boost: true },
      true,
      BOOST_BURN_SECONDS - 1.5,
    );
    expect(car.speed).toBeCloseTo(MAX_BOOST_SPEED, 1);
    expect(car.boostCharge).toBeCloseTo(0, 3);

    // One more step with boost still held: boost stops burning and does NOT recharge until released
    const stillHeld = stepCar(
      car,
      { throttle: 1, brake: 0, steer: 0, boost: true },
      true,
      FIXED_DT,
    );
    expect(stillHeld.boosting).toBe(false);
    expect(stillHeld.boostCharge).toBe(0);
  });

  it('recharges from empty to full in 10 seconds only while boost is not burning, and settles back to 216 km/h', () => {
    // Drain boost completely
    let car = stepCarForSeconds(
      createInitialCarState(0, 0, 0),
      { throttle: 1, brake: 0, steer: 0, boost: true },
      true,
      BOOST_BURN_SECONDS + 0.1,
    );
    expect(car.boostCharge).toBe(0);

    // Release boost for 5 seconds -> half recharged (0.5) and settled back to <= 216 km/h
    car = stepCarForSeconds(
      car,
      { throttle: 1, brake: 0, steer: 0, boost: false },
      true,
      BOOST_RECHARGE_SECONDS / 2,
    );
    expect(car.boostCharge).toBeCloseTo(0.5, 2);
    expect(car.speed).toBeLessThanOrEqual(MAX_ROAD_SPEED + 1e-6);

    // Remaining 5 seconds -> full recharge (1.0) at exactly 10 seconds
    car = stepCarForSeconds(
      car,
      { throttle: 1, brake: 0, steer: 0, boost: false },
      true,
      BOOST_RECHARGE_SECONDS / 2,
    );
    expect(car.boostCharge).toBeCloseTo(1.0, 3);
  });

  it('never lifts the 72 km/h limit when boosting off the road', () => {
    const car = stepCarForSeconds(
      createInitialCarState(0, 25, 0),
      { throttle: 1, brake: 0, steer: 0, boost: true },
      false,
      2.5,
    );
    expect(car.offRoad).toBe(true);
    expect(car.speed).toBeLessThanOrEqual(MAX_OFF_ROAD_SPEED + 1e-6);
    expect(car.speed * KM_H_PER_M_S).toBeLessThanOrEqual(72 + 1e-6);
  });
});

describe('Speed-reactive chase camera curve', () => {
  it('smoothly widens FOV and pulls camera back as speed increases with zero jumps', () => {
    const slow = computeSpeedCameraMetrics(0);
    const roadTop = computeSpeedCameraMetrics(MAX_ROAD_SPEED);
    const boostTop = computeSpeedCameraMetrics(MAX_BOOST_SPEED);

    expect(roadTop.fov).toBeGreaterThan(slow.fov + 8);
    expect(boostTop.fov).toBeGreaterThan(roadTop.fov + 8);
    expect(roadTop.backDist).toBeGreaterThan(slow.backDist + 1.2);
    expect(boostTop.backDist).toBeGreaterThan(roadTop.backDist + 1.0);

    // Check continuity & monotonicity across 1 m/s steps from 0 to 75 m/s (no jumps anywhere)
    let prev = computeSpeedCameraMetrics(0);
    for (let v = 1; v <= MAX_BOOST_SPEED; v += 1) {
      const curr = computeSpeedCameraMetrics(v);
      expect(curr.fov).toBeGreaterThanOrEqual(prev.fov);
      expect(curr.backDist).toBeGreaterThanOrEqual(prev.backDist);
      expect(curr.fov - prev.fov).toBeLessThan(1.0);
      expect(curr.backDist - prev.backDist).toBeLessThan(0.15);
      prev = curr;
    }
  });
});

describe('Best-lap ghost recorder and non-blocking replay', () => {
  const track = getDefaultTrack();

  it('replays the best lap from the start line in step with the clock and replaces it on a quicker lap', () => {
    let tracker = createInitialGhostTracker();
    let prevLap: LapState = createInitialLapState();

    // Before first lap completion, no ghost exists
    expect(sampleGhostPose(tracker.bestLap, 0)).toBeNull();

    // Simulate Lap 1 (40.0 s) moving along track
    const sample1 = track.sampleAtS(5);
    const carStart = { ...createInitialCarState(sample1.x, sample1.z, 0), speed: 30 };
    const projStart = track.projectPoint(carStart.x, carStart.z);
    tracker = stepGhostTracker(tracker, prevLap, { ...prevLap, currentLapTime: 0.1 }, carStart, projStart, track);

    const sampleMid = track.sampleAtS(500);
    const carMid = { ...createInitialCarState(sampleMid.x, sampleMid.z, 0.5), speed: 40 };
    const projMid = track.projectPoint(carMid.x, carMid.z);
    tracker = stepGhostTracker(tracker, prevLap, { ...prevLap, currentLapTime: 20.1 }, carMid, projMid, track);

    const lap1Done: LapState = {
      ...prevLap,
      completedLaps: 1,
      currentLapNumber: 2,
      currentLapTime: 0.01,
      lastLapTime: 40.0,
      bestLapTime: 40.0,
    };
    tracker = stepGhostTracker(tracker, prevLap, lap1Done, carStart, projStart, track);
    expect(tracker.bestLap).not.toBeNull();
    expect(tracker.bestLap!.lapTime).toBe(40.0);

    // Mid-lap pose interpolates smoothly in step with clock
    const poseAt0 = sampleGhostPose(tracker.bestLap, 0);
    const poseAt10 = sampleGhostPose(tracker.bestLap, 10);
    expect(poseAt0).not.toBeNull();
    expect(poseAt10).not.toBeNull();
    expect(poseAt0!.x).toBeCloseTo(sample1.x, 3);
    expect(poseAt10!.x).not.toBeCloseTo(poseAt0!.x, 1);
    expect(sampleGhostPose(tracker.bestLap, 999)).toBeNull();

    // Slower Lap 2 (42.0 s) does NOT replace the 40.0 s ghost
    prevLap = lap1Done;
    tracker = stepGhostTracker(tracker, prevLap, { ...prevLap, currentLapTime: 21.0 }, carMid, projMid, track);
    const lap2Slower: LapState = {
      ...prevLap,
      completedLaps: 2,
      currentLapNumber: 3,
      currentLapTime: 0.01,
      lastLapTime: 42.0,
      bestLapTime: 40.0,
    };
    tracker = stepGhostTracker(tracker, prevLap, lap2Slower, carStart, projStart, track);
    expect(tracker.bestLap!.lapTime).toBe(40.0);

    // Faster Lap 3 (36.5 s) DOES replace the ghost!
    prevLap = lap2Slower;
    tracker = stepGhostTracker(tracker, prevLap, { ...prevLap, currentLapTime: 18.0 }, carMid, projMid, track);
    const lap3Faster: LapState = {
      ...prevLap,
      completedLaps: 3,
      currentLapNumber: 4,
      currentLapTime: 0.01,
      lastLapTime: 36.5,
      bestLapTime: 36.5,
    };
    tracker = stepGhostTracker(tracker, prevLap, lap3Faster, carStart, projStart, track);
    expect(tracker.bestLap!.lapTime).toBe(36.5);
  });

  it('activates the ghost in a real race after lap 1, lets cars pass through it, and boosts past 216 km/h in demo mode', () => {
    let state = createInitialRaceState(track);
    let maxSpeedKmh = 0;
    let sawBoostBurn = false;
    let sawBoostRefill = false;
    let minCharge = 1;
    let sawGhostOnLap2 = false;

    for (let i = 0; i < 60 * 140 && !state.racers[state.playerIndex].finished; i++) {
      state = stepRace(state, { throttle: 0, brake: 0, steer: 0 }, true, track, FIXED_DT);
      const p = state.racers[state.playerIndex];
      maxSpeedKmh = Math.max(maxSpeedKmh, p.car.speed * KM_H_PER_M_S);
      if (p.car.boosting) sawBoostBurn = true;
      minCharge = Math.min(minCharge, p.car.boostCharge);
      if (minCharge < 0.7 && p.car.boostCharge > 0.95) sawBoostRefill = true;
      if (p.lap.completedLaps >= 1 && state.ghostPose !== null) {
        sawGhostOnLap2 = true;
      }
    }

    expect(sawBoostBurn).toBe(true);
    expect(sawBoostRefill).toBe(true);
    expect(maxSpeedKmh).toBeGreaterThan(220);
    expect(sawGhostOnLap2).toBe(true);
    expect(state.ghostTracker.bestLap).not.toBeNull();
  });
});
