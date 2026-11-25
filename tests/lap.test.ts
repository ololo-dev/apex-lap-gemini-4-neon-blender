import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/sim/constants';
import { createInitialLapState, stepLap } from '../src/sim/lap';
import { getDefaultTrack } from '../src/sim/track';
import type { LapState } from '../src/sim/types';

function moveAlongSamples(
  initialLap: LapState,
  indices: number[],
  dt = FIXED_DT,
): LapState {
  const track = getDefaultTrack();
  let lap = initialLap;
  for (let i = 1; i < indices.length; i++) {
    const prev = track.samples[indices[i - 1]];
    const curr = track.samples[indices[i]];
    lap = stepLap(lap, prev.x, prev.z, curr.x, curr.z, false, track, dt);
  }
  return lap;
}

describe('Lap counting and anti-cheat rules', () => {
  const track = getDefaultTrack();

  it('counts a valid lap and records time, last lap, and best lap when all 12 points are passed in order', () => {
    const n = track.samples.length;
    const fullLapIndices: number[] = [];
    for (let i = 0; i <= n + 2; i += 2) {
      fullLapIndices.push(i % n);
    }

    const afterLap1 = moveAlongSamples(createInitialLapState(), fullLapIndices, 0.05);
    expect(afterLap1.completedLaps).toBe(1);
    expect(afterLap1.currentLapNumber).toBe(2);
    expect(afterLap1.lastLapTime).not.toBeNull();
    expect(afterLap1.bestLapTime).toBe(afterLap1.lastLapTime);
    expect(afterLap1.lastLapTime!).toBeGreaterThan(20);

    // Faster second lap updates bestLapTime while keeping lastLapTime accurate
    const afterLap2 = moveAlongSamples(afterLap1, fullLapIndices, 0.04);
    expect(afterLap2.completedLaps).toBe(2);
    expect(afterLap2.currentLapNumber).toBe(3);
    expect(afterLap2.lastLapTime!).toBeLessThan(afterLap1.lastLapTime!);
    expect(afterLap2.bestLapTime).toBe(afterLap2.lastLapTime);
  });

  it('does not count a lap when cutting across the middle and missing checkpoints', () => {
    let lap = createInitialLapState();
    const start = track.checkpoints[0];
    const pointB = track.checkpoints[1];
    const pointL = track.checkpoints[11];

    // Drive forward across B
    lap = stepLap(
      lap,
      pointB.x - pointB.tx * 5,
      pointB.z - pointB.tz * 5,
      pointB.x + pointB.tx * 5,
      pointB.z + pointB.tz * 5,
      false,
      track,
      FIXED_DT,
    );
    expect(lap.nextCheckpoint).toBe(2);

    // Shortcut directly across the infield to L, skipping C..K, then cross start line A forward
    lap = stepLap(
      lap,
      pointL.x - pointL.tx * 5,
      pointL.z - pointL.tz * 5,
      pointL.x + pointL.tx * 5,
      pointL.z + pointL.tz * 5,
      false,
      track,
      FIXED_DT,
    );
    lap = stepLap(
      lap,
      start.x - start.tx * 5,
      start.z - start.tz * 5,
      start.x + start.tx * 5,
      start.z + start.tz * 5,
      false,
      track,
      FIXED_DT,
    );

    expect(lap.completedLaps).toBe(0);
    expect(lap.lastLapTime).toBeNull();
    expect(lap.bestLapTime).toBeNull();
  });

  it('does not count a lap when crossing the start line the wrong way', () => {
    const start = track.checkpoints[0];
    // Even if all 12 checkpoints were somehow reached, crossing A backwards must NOT count
    const readyLap: LapState = {
      ...createInitialLapState(),
      nextCheckpoint: 12,
      currentLapTime: 35,
    };

    const afterReverseCross = stepLap(
      readyLap,
      start.x + start.tx * 4,
      start.z + start.tz * 4,
      start.x - start.tx * 4,
      start.z - start.tz * 4,
      false,
      track,
      FIXED_DT,
    );
    expect(afterReverseCross.completedLaps).toBe(0);
    expect(afterReverseCross.lastLapTime).toBeNull();
  });

  it('holds lap 1 stopwatch at zero until the car launches from the start line', () => {
    const start = track.checkpoints[0];
    const parked = stepLap(
      createInitialLapState(),
      start.x,
      start.z,
      start.x,
      start.z,
      false,
      track,
      FIXED_DT,
    );
    expect(parked.currentLapTime).toBe(0);
    expect(parked.completedLaps).toBe(0);
  });

  it('does not count a lap when driving the whole circuit in reverse', () => {
    const n = track.samples.length;
    const reverseIndices: number[] = [];
    for (let i = n; i >= 0; i -= 2) {
      reverseIndices.push(i % n);
    }

    const result = moveAlongSamples(createInitialLapState(), reverseIndices, 0.05);
    expect(result.completedLaps).toBe(0);
    expect(result.lastLapTime).toBeNull();
  });
});
