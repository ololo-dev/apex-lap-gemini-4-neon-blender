import type { CircuitTrack } from './track';
import type { CheckpointGate, LapState } from './types';

export interface GateCrossingResult {
  readonly crossed: boolean;
  readonly alpha: number;
}

/**
 * Checks whether movement from (prevX, prevZ) to (currX, currZ) crosses
 * a checkpoint gate in the forward direction within its lateral span.
 */
export function checkGateCrossingForward(
  prevX: number,
  prevZ: number,
  currX: number,
  currZ: number,
  gate: CheckpointGate,
): GateCrossingResult {
  const dPrev = (prevX - gate.x) * gate.tx + (prevZ - gate.z) * gate.tz;
  const dCurr = (currX - gate.x) * gate.tx + (currZ - gate.z) * gate.tz;

  if (dPrev > 0 || dCurr <= 0) {
    return { crossed: false, alpha: 0 };
  }

  const denom = dCurr - dPrev;
  const alpha = denom > 1e-9 ? -dPrev / denom : 0;
  const crossX = prevX + (currX - prevX) * alpha;
  const crossZ = prevZ + (currZ - prevZ) * alpha;
  const lateralOffset = (crossX - gate.x) * gate.nx + (crossZ - gate.z) * gate.nz;

  if (Math.abs(lateralOffset) > gate.halfWidth) {
    return { crossed: false, alpha: 0 };
  }

  return { crossed: true, alpha };
}

export function createInitialLapState(): LapState {
  return {
    completedLaps: 0,
    currentLapNumber: 1,
    currentLapTime: 0,
    lastLapTime: null,
    bestLapTime: null,
    nextCheckpoint: 1, // Point A (0) is the start line; next required point is B (1)
    currentLapOffRoadTime: 0,
    lastLapOffRoadTime: 0,
    totalOffRoadTime: 0,
  };
}

export function stepLap(
  lap: LapState,
  prevX: number,
  prevZ: number,
  currX: number,
  currZ: number,
  offRoad: boolean,
  track: CircuitTrack,
  dt: number,
): LapState {
  // On lap 1, hold the stopwatch at 00:00.000 until the car launches from the start line
  if (
    lap.completedLaps === 0 &&
    lap.currentLapTime === 0 &&
    Math.hypot(currX - prevX, currZ - prevZ) < 1e-4
  ) {
    return lap;
  }

  const waypointCount = track.checkpoints.length;
  const offRoadStep = offRoad ? dt : 0;
  const totalOffRoadTime = lap.totalOffRoadTime + offRoadStep;

  // Ordered checkpoint progression through B..L (indices 1..11)
  if (lap.nextCheckpoint < waypointCount) {
    const gate = track.checkpoints[lap.nextCheckpoint];
    const crossing = checkGateCrossingForward(prevX, prevZ, currX, currZ, gate);
    return {
      ...lap,
      currentLapTime: lap.currentLapTime + dt,
      currentLapOffRoadTime: lap.currentLapOffRoadTime + offRoadStep,
      totalOffRoadTime,
      nextCheckpoint: crossing.crossed ? lap.nextCheckpoint + 1 : lap.nextCheckpoint,
    };
  }

  // All 12 waypoints passed in order — check forward crossing of the start line (A)
  const startGate = track.checkpoints[0];
  const finish = checkGateCrossingForward(prevX, prevZ, currX, currZ, startGate);
  if (!finish.crossed) {
    return {
      ...lap,
      currentLapTime: lap.currentLapTime + dt,
      currentLapOffRoadTime: lap.currentLapOffRoadTime + offRoadStep,
      totalOffRoadTime,
    };
  }

  const timeToLine = finish.alpha * dt;
  const timeAfterLine = (1 - finish.alpha) * dt;
  const completedLapTime = lap.currentLapTime + timeToLine;
  const completedLapOffRoad = lap.currentLapOffRoadTime + (offRoad ? timeToLine : 0);
  const completedLaps = lap.completedLaps + 1;
  const bestLapTime =
    lap.bestLapTime === null
      ? completedLapTime
      : Math.min(lap.bestLapTime, completedLapTime);

  return {
    completedLaps,
    currentLapNumber: completedLaps + 1,
    currentLapTime: timeAfterLine,
    lastLapTime: completedLapTime,
    bestLapTime,
    nextCheckpoint: 1,
    currentLapOffRoadTime: offRoad ? timeAfterLine : 0,
    lastLapOffRoadTime: completedLapOffRoad,
    totalOffRoadTime,
  };
}
