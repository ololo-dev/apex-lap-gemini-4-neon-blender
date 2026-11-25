import { normalizeAngle } from './car';
import type { CircuitTrack } from './track';
import type { CarState, LapState, TrackProjection } from './types';

export interface GhostSample {
  readonly t: number;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly steerAngle: number;
  readonly wheelSpin: number;
}

export interface GhostRecording {
  readonly lapTime: number;
  readonly samples: readonly GhostSample[];
}

export interface GhostTracker {
  readonly bestLap: GhostRecording | null;
  readonly activeSamples: readonly GhostSample[];
  readonly recordingStarted: boolean;
  readonly startOffsetTime: number;
}

const SAMPLE_INTERVAL = 0.05; // 20 Hz smooth recording

export function createInitialGhostTracker(): GhostTracker {
  return {
    bestLap: null,
    activeSamples: [],
    recordingStarted: false,
    startOffsetTime: 0,
  };
}

function makeSample(t: number, car: CarState): GhostSample {
  return {
    t,
    x: car.x,
    z: car.z,
    heading: car.heading,
    steerAngle: car.steerAngle,
    wheelSpin: car.wheelSpin,
  };
}

/**
 * Records the player's current lap from the start line and replaces `bestLap`
 * whenever a quicker valid lap is completed.
 */
export function stepGhostTracker(
  tracker: GhostTracker,
  prevLap: LapState,
  nextLap: LapState,
  car: CarState,
  projection: TrackProjection,
  track: CircuitTrack,
): GhostTracker {
  // Completed a valid lap: promote to bestLap if faster (or first completed lap)
  if (nextLap.completedLaps > prevLap.completedLaps) {
    const completedTime = nextLap.lastLapTime ?? prevLap.currentLapTime;
    let bestLap = tracker.bestLap;

    if (
      tracker.activeSamples.length >= 2 &&
      (bestLap === null || completedTime < bestLap.lapTime)
    ) {
      const endT = Math.max(
        tracker.activeSamples[tracker.activeSamples.length - 1].t + 1e-3,
        completedTime - tracker.startOffsetTime,
      );
      bestLap = {
        lapTime: completedTime,
        samples: [...tracker.activeSamples, makeSample(endT, car)],
      };
    }

    return {
      bestLap,
      activeSamples: [makeSample(nextLap.currentLapTime, car)],
      recordingStarted: true,
      startOffsetTime: 0,
    };
  }

  // Wait until car crosses onto the circuit from the starting grid (s in [0, totalLength * 0.5))
  if (!tracker.recordingStarted) {
    if (projection.s < track.totalLength * 0.5 && car.speed > 0.1) {
      return {
        ...tracker,
        recordingStarted: true,
        startOffsetTime: nextLap.currentLapTime,
        activeSamples: [makeSample(0, car)],
      };
    }
    return tracker;
  }

  const relT = Math.max(0, nextLap.currentLapTime - tracker.startOffsetTime);
  const last = tracker.activeSamples[tracker.activeSamples.length - 1];
  if (!last || relT - last.t >= SAMPLE_INTERVAL) {
    return {
      ...tracker,
      activeSamples: [...tracker.activeSamples, makeSample(relT, car)],
    };
  }

  return tracker;
}

/**
 * Evaluates the interpolated see-through ghost pose at `lapTime` seconds into the lap.
 * Returns null when no best lap exists yet or after the ghost crosses the finish line.
 */
export function sampleGhostPose(
  bestLap: GhostRecording | null,
  lapTime: number,
): GhostSample | null {
  if (!bestLap || bestLap.samples.length === 0) {
    return null;
  }
  const samples = bestLap.samples;
  const last = samples[samples.length - 1];
  if (lapTime < 0 || lapTime > last.t) {
    return null;
  }
  if (samples.length === 1 || lapTime <= samples[0].t) {
    return samples[0];
  }

  // Binary search for largest index lo with samples[lo].t <= lapTime
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid].t <= lapTime) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  const a = samples[lo];
  const b = samples[Math.min(lo + 1, samples.length - 1)];
  const span = b.t - a.t;
  const u = span > 1e-8 ? (lapTime - a.t) / span : 0;
  const dHeading = normalizeAngle(b.heading - a.heading);

  return {
    t: lapTime,
    x: a.x + (b.x - a.x) * u,
    z: a.z + (b.z - a.z) * u,
    heading: normalizeAngle(a.heading + dHeading * u),
    steerAngle: a.steerAngle + (b.steerAngle - a.steerAngle) * u,
    wheelSpin: a.wheelSpin + (b.wheelSpin - a.wheelSpin) * u,
  };
}
