import { FIXED_DT, RACE_LAPS } from '../sim/constants';
import { createInitialRaceState, stepRace } from '../sim/race';
import { getDefaultTrack } from '../sim/track';
import type { ControlInput } from '../sim/types';

export interface HeadlessRaceEntry {
  readonly name: string;
  readonly time: number;
  readonly best: number;
}

export interface HeadlessRaceResult {
  readonly laps: number;
  readonly results: readonly HeadlessRaceEntry[];
}

const NEUTRAL_INPUT: ControlInput = { throttle: 0, brake: 0, steer: 0 };

/**
 * Runs a complete 3-lap 4-car race with zero browser dependencies using the exact
 * same simulation rules and built-in driver as the page.
 */
export function runHeadlessRace(maxSimSeconds = 420): HeadlessRaceResult {
  const track = getDefaultTrack();
  let state = createInitialRaceState(track);
  const maxSteps = Math.ceil(maxSimSeconds / FIXED_DT);

  for (let i = 0; i < maxSteps; i++) {
    if (state.racers.every((r) => r.finished)) {
      break;
    }
    state = stepRace(state, NEUTRAL_INPUT, true, track, FIXED_DT);
  }

  const results: HeadlessRaceEntry[] = state.standings.map((idx) => {
    const r = state.racers[idx];
    const raceTime = r.finishTime ?? state.raceTime;
    const bestLap = r.bestLapTime ?? r.lap.bestLapTime ?? 0;
    return {
      name: r.config.name,
      time: Number(raceTime.toFixed(3)),
      best: Number(bestLap.toFixed(3)),
    };
  });

  return {
    laps: RACE_LAPS,
    results,
  };
}

const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('/race.ts') || process.argv[1].endsWith('\\race.ts'));

if (isMain) {
  const result = runHeadlessRace();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
