import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { runHeadlessLap } from '../src/cli/lap';
import { FIXED_DT } from '../src/sim/constants';
import { computeAutoDriverInput } from '../src/sim/driver';
import { createInitialSimState, FixedClock, stepSimulation } from '../src/sim/engine';
import { getDefaultTrack } from '../src/sim/track';
import type { ControlInput } from '../src/sim/types';

describe('Fixed-timestep clock & deterministic built-in driver', () => {
  const track = getDefaultTrack();

  it('covers the exact same distance per second regardless of frame rate (slow vs fast render)', () => {
    const runAtFrameRate = (fps: number, durationSec: number) => {
      const clock = new FixedClock(FIXED_DT, 1.0);
      let state = createInitialSimState(track);
      const frameDt = 1 / fps;
      const frames = Math.round(durationSec * fps);
      const input: ControlInput = { throttle: 1, brake: 0, steer: 0 };

      for (let f = 0; f < frames; f++) {
        clock.advance(frameDt, (dt) => {
          state = stepSimulation(state, input, track, dt);
        });
      }
      return state;
    };

    // 4 FPS (very slow machine) vs 60 FPS vs 120 FPS over 3 seconds
    const slow4fps = runAtFrameRate(4, 3);
    const std60fps = runAtFrameRate(60, 3);
    const fast120fps = runAtFrameRate(120, 3);

    expect(slow4fps.car.x).toBeCloseTo(std60fps.car.x, 8);
    expect(slow4fps.car.z).toBeCloseTo(std60fps.car.z, 8);
    expect(slow4fps.car.speed).toBeCloseTo(std60fps.car.speed, 8);
    expect(fast120fps.car.x).toBeCloseTo(std60fps.car.x, 8);
    expect(fast120fps.elapsedTime).toBeCloseTo(3.0, 6);
  });

  it('ignores non-positive or non-finite raw frame deltas and supports reset', () => {
    const clock = new FixedClock(FIXED_DT, 1.0);
    let steps = 0;
    clock.advance(0, () => {
      steps += 1;
    });
    clock.advance(-0.1, () => {
      steps += 1;
    });
    clock.advance(Number.NaN, () => {
      steps += 1;
    });
    expect(steps).toBe(0);

    clock.advance(FIXED_DT * 0.5, () => {
      steps += 1;
    });
    expect(clock.remainder).toBeGreaterThan(0);
    clock.reset();
    expect(clock.remainder).toBe(0);
  });

  it('built-in driver brakes for corners and completes a full lap without leaving the road', () => {
    let state = createInitialSimState(track);
    let brakeTicks = 0;
    let maxCenterDist = 0;

    for (let i = 0; i < 60 * 120 && state.lap.completedLaps < 1; i++) {
      const input = computeAutoDriverInput(state, track);
      if (input.brake > 0.1) brakeTicks += 1;
      state = stepSimulation(state, input, track, FIXED_DT);
      maxCenterDist = Math.max(maxCenterDist, state.projection.distance);
    }

    expect(state.lap.completedLaps).toBe(1);
    expect(state.lap.lastLapOffRoadTime).toBe(0);
    expect(state.lap.totalOffRoadTime).toBe(0);
    expect(maxCenterDist).toBeLessThan(track.roadHalfWidth);
    expect(brakeTicks).toBeGreaterThan(60); // brakes visibly for corners
  });

  it('headless lap runner and CLI produce valid, identical JSON on consecutive runs', () => {
    const resA = runHeadlessLap();
    const resB = runHeadlessLap();
    expect(resA).toEqual(resB);
    expect(resA.laps).toBe(1);
    expect(resA.time).toBeGreaterThan(15);
    expect(resA.offRoad).toBe(0);

    const out1 = execSync('npm run -s lap', { encoding: 'utf8' }).trim();
    const out2 = execSync('npm run -s lap', { encoding: 'utf8' }).trim();
    expect(out1).toBe(out2);
    expect(out1.split('\n')).toHaveLength(1);

    const parsed = JSON.parse(out1) as { laps: number; time: number; offRoad: number };
    expect(parsed.laps).toBe(1);
    expect(typeof parsed.time).toBe('number');
    expect(parsed.offRoad).toBe(0);
  });
});
