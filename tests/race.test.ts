import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { runHeadlessRace } from '../src/cli/race';
import {
  COUNTDOWN_SECONDS,
  FIXED_DT,
  RACE_LAPS,
  RACER_ROSTER,
} from '../src/sim/constants';
import {
  computeLapProgress,
  createInitialRaceState,
  getCountdownLabel,
  getStartLightCount,
  stepRace,
} from '../src/sim/race';
import { getDefaultTrack } from '../src/sim/track';
import type { ControlInput } from '../src/sim/types';

const FULL_THROTTLE: ControlInput = { throttle: 1, brake: 0, steer: 0 };
const NEUTRAL: ControlInput = { throttle: 0, brake: 0, steer: 0 };

describe('3-lap 4-car race engine', () => {
  const track = getDefaultTrack();

  it('lines up 4 cars two-by-two behind the start line with the player last and holds them through 3, 2, 1, GO', () => {
    let state = createInitialRaceState(track);
    expect(state.phase).toBe('countdown');
    expect(state.totalLaps).toBe(RACE_LAPS);
    expect(state.racers).toHaveLength(4);

    const player = state.racers[state.playerIndex];
    expect(player.config.isPlayer).toBe(true);
    expect(player.position).toBe(4);
    expect(state.standings[3]).toBe(state.playerIndex);

    // Two-by-two check: two cars on left (-), two on right (+), all behind start line (negative lap progress)
    const leftCount = state.racers.filter((r) => r.projection.signedOffset < 0).length;
    const rightCount = state.racers.filter((r) => r.projection.signedOffset > 0).length;
    expect(leftCount).toBe(2);
    expect(rightCount).toBe(2);
    for (const r of state.racers) {
      expect(computeLapProgress(r, track)).toBeLessThan(0);
    }

    const startPositions = state.racers.map((r) => ({ x: r.car.x, z: r.car.z }));
    const seenLabels = new Set<string>();

    // Step through the entire 3-second countdown holding full throttle — NO car moves and clock stays at 0
    const countdownSteps = Math.round(COUNTDOWN_SECONDS / FIXED_DT);
    for (let i = 0; i < countdownSteps - 1; i++) {
      const label = getCountdownLabel(state);
      if (label) seenLabels.add(label);
      expect(getStartLightCount(state)).toBeGreaterThanOrEqual(2);
      state = stepRace(state, FULL_THROTTLE, false, track, FIXED_DT);
      expect(state.phase).toBe('countdown');
      expect(state.raceTime).toBe(0);
      for (let j = 0; j < 4; j++) {
        expect(state.racers[j].car.x).toBe(startPositions[j].x);
        expect(state.racers[j].car.z).toBe(startPositions[j].z);
        expect(state.racers[j].car.speed).toBe(0);
      }
    }

    expect(seenLabels.has('3')).toBe(true);
    expect(seenLabels.has('2')).toBe(true);
    expect(seenLabels.has('1')).toBe(true);

    // One more step transitions to GO!
    state = stepRace(state, FULL_THROTTLE, false, track, FIXED_DT);
    expect(state.phase).toBe('racing');
    expect(getCountdownLabel(state)).toBe('GO');
    expect(getStartLightCount(state)).toBe(0);

    // Next steps move the cars and advance the race clock
    for (let i = 0; i < 90; i++) {
      state = stepRace(state, FULL_THROTTLE, false, track, FIXED_DT);
    }
    expect(state.raceTime).toBeGreaterThan(1.4);
    expect(getCountdownLabel(state)).toBeNull();
    for (const r of state.racers) {
      expect(r.car.speed).toBeGreaterThan(10);
    }
  });

  it('gives three distinct rivals with ~10% lap pace spread, live position changes, and accurate finish ranking', () => {
    const rivals = RACER_ROSTER.filter((r) => !r.isPlayer);
    expect(rivals).toHaveLength(3);
    expect(new Set(rivals.map((r) => r.name)).size).toBe(3);
    expect(new Set(rivals.map((r) => r.color)).size).toBe(3);

    let state = createInitialRaceState(track);
    const seenPlayerPositions = new Set<number>([state.racers[state.playerIndex].position]);
    let playerFinishSnapshot: typeof state | null = null;

    for (let i = 0; i < 60 * 180; i++) {
      state = stepRace(state, NEUTRAL, true, track, FIXED_DT);
      seenPlayerPositions.add(state.racers[state.playerIndex].position);
      if (state.phase === 'finished' && playerFinishSnapshot === null) {
        playerFinishSnapshot = state;
      }
      if (state.racers.every((r) => r.finished)) {
        break;
      }
    }

    // Player changed position during the race (started 4th and overtook rivals)
    expect(seenPlayerPositions.size).toBeGreaterThanOrEqual(2);
    expect(playerFinishSnapshot).not.toBeNull();

    // At the exact moment the player finishes lap 3, finishers appear BEFORE any car still on track
    const snap = playerFinishSnapshot!;
    let seenUnfinished = false;
    for (const idx of snap.standings) {
      const r = snap.racers[idx];
      if (!r.finished) {
        seenUnfinished = true;
      } else {
        expect(seenUnfinished).toBe(false);
        expect(r.finishTime).not.toBeNull();
      }
    }

    // Once all 4 finish, rivals are spread out and quickest rival is about a tenth (~8-14%) faster per lap than slowest
    expect(state.racers.every((r) => r.finished)).toBe(true);
    const rivalResults = state.racers.filter((r) => !r.config.isPlayer);
    const rivalBestLaps = rivalResults.map((r) => r.bestLapTime!);
    const quickestLap = Math.min(...rivalBestLaps);
    const slowestLap = Math.max(...rivalBestLaps);
    const ratio = slowestLap / quickestLap;
    expect(ratio).toBeGreaterThan(1.07);
    expect(ratio).toBeLessThan(1.15);

    const rivalFinishTimes = rivalResults.map((r) => r.finishTime!);
    expect(Math.max(...rivalFinishTimes) - Math.min(...rivalFinishTimes)).toBeGreaterThan(6);
  });

  it('produces the exact same race twice when driven with the same player inputs', () => {
    const runScriptedRace = () => {
      let state = createInitialRaceState(track);
      for (let i = 0; i < 60 * 12; i++) {
        const input: ControlInput =
          i < 300
            ? { throttle: 1, brake: 0, steer: 0 }
            : { throttle: 0.7, brake: 0, steer: 0.25 };
        state = stepRace(state, input, false, track, FIXED_DT);
      }
      return state;
    };

    const runA = runScriptedRace();
    const runB = runScriptedRace();

    expect(runA.raceTime).toBe(runB.raceTime);
    expect(runA.standings).toEqual(runB.standings);
    for (let i = 0; i < 4; i++) {
      expect(runA.racers[i].car.x).toBe(runB.racers[i].car.x);
      expect(runA.racers[i].car.z).toBe(runB.racers[i].car.z);
      expect(runA.racers[i].car.speed).toBe(runB.racers[i].car.speed);
    }
  });

  it(
    'headless race CLI prints valid, byte-for-byte identical single-line JSON on consecutive runs',
    () => {
      const res = runHeadlessRace();
      expect(res.laps).toBe(3);
      expect(res.results).toHaveLength(4);

      // Strictly ordered by finishing time ascending
      for (let i = 1; i < res.results.length; i++) {
        expect(res.results[i].time).toBeGreaterThanOrEqual(res.results[i - 1].time);
      }

      const cli1 = execSync('npm run -s race', { encoding: 'utf8' }).trim();
      const cli2 = execSync('npm run -s race', { encoding: 'utf8' }).trim();
      expect(cli1).toBe(cli2);
      expect(cli1.split('\n')).toHaveLength(1);

      const parsed = JSON.parse(cli1) as {
        laps: number;
        results: Array<{ name: string; time: number; best: number }>;
      };
      expect(parsed).toEqual(res);
      for (const entry of parsed.results) {
        expect(typeof entry.name).toBe('string');
        expect(entry.time).toBeGreaterThan(60);
        expect(entry.best).toBeGreaterThan(20);
      }
    },
    20_000,
  );
});
