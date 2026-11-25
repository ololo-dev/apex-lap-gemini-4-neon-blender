import { FIXED_DT } from '../sim/constants';
import { computeAutoDriverInput } from '../sim/driver';
import { createInitialSimState, stepSimulation } from '../sim/engine';
import { getDefaultTrack } from '../sim/track';

export interface HeadlessLapResult {
  readonly laps: number;
  readonly time: number;
  readonly offRoad: number;
}

/**
 * Runs the built-in driver for one complete lap using the exact same simulation
 * engine and fixed timestep as the browser game.
 */
export function runHeadlessLap(maxSimSeconds = 300): HeadlessLapResult {
  const track = getDefaultTrack();
  let state = createInitialSimState(track);
  const maxSteps = Math.ceil(maxSimSeconds / FIXED_DT);

  for (let i = 0; i < maxSteps && state.lap.completedLaps < 1; i++) {
    const input = computeAutoDriverInput(state, track);
    state = stepSimulation(state, input, track, FIXED_DT);
  }

  const rawTime = state.lap.lastLapTime ?? state.lap.currentLapTime;
  const rawOffRoad =
    state.lap.completedLaps > 0
      ? state.lap.lastLapOffRoadTime
      : state.lap.totalOffRoadTime;

  return {
    laps: state.lap.completedLaps,
    time: Number(rawTime.toFixed(3)),
    offRoad: Number(rawOffRoad.toFixed(3)),
  };
}

// Execute when invoked directly as a CLI entrypoint
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('/lap.ts') || process.argv[1].endsWith('\\lap.ts'));

if (isMain) {
  const result = runHeadlessLap();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
