import { createInitialCarState, stepCar } from './car';
import { resolveAllCarCollisions } from './collision';
import {
  COUNTDOWN_SECONDS,
  FIXED_DT,
  GO_BANNER_SECONDS,
  GRID_SLOTS,
  RACE_LAPS,
  RACER_ROSTER,
} from './constants';
import { computeAutoDriverInput, type TrafficCarInfo } from './driver';
import {
  createInitialGhostTracker,
  sampleGhostPose,
  stepGhostTracker,
} from './ghost';
import { createInitialLapState, stepLap } from './lap';
import { CircuitTrack, getDefaultTrack } from './track';
import type {
  ControlInput,
  CountdownLabel,
  RacePhase,
  RacerConfig,
  RacerState,
  RaceState,
} from './types';

/**
 * Wrap-safe lap progress in metres: negative while queued behind the start line
 * on grid launch, monotonically increasing [0, totalLength) during each lap.
 */
export function computeLapProgress(racer: RacerState, track: CircuitTrack): number {
  const s = racer.projection.s;
  if (racer.lap.nextCheckpoint <= 2 && s > track.totalLength * 0.85) {
    return s - track.totalLength;
  }
  return s;
}

/**
 * Ranks all racers: finishers first (ascending finishTime), then racers still
 * on the road (descending completedLaps, then descending lapProgress).
 */
export function computeStandings(
  racers: readonly RacerState[],
  track: CircuitTrack,
): number[] {
  const indices = racers.map((_, idx) => idx);
  indices.sort((ia, ib) => {
    const a = racers[ia];
    const b = racers[ib];

    if (a.finished && b.finished) {
      return (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity);
    }
    if (a.finished !== b.finished) {
      return a.finished ? -1 : 1;
    }

    if (a.lap.completedLaps !== b.lap.completedLaps) {
      return b.lap.completedLaps - a.lap.completedLaps;
    }

    const progA = computeLapProgress(a, track);
    const progB = computeLapProgress(b, track);
    if (Math.abs(progA - progB) > 1e-6) {
      return progB - progA;
    }
    return a.config.gridSlot - b.config.gridSlot;
  });
  return indices;
}

/** Returns the active countdown text ('3', '2', '1', 'GO') or null once racing is underway. */
export function getCountdownLabel(state: RaceState): CountdownLabel {
  if (state.phase === 'countdown') {
    const remaining = Math.ceil(COUNTDOWN_SECONDS - state.countdownElapsed);
    if (remaining >= 3) return '3';
    if (remaining === 2) return '2';
    return '1';
  }
  if (state.phase === 'racing' && state.raceTime < GO_BANNER_SECONDS) {
    return 'GO';
  }
  return null;
}

/** Returns how many red start gantry lights (0..5) should be lit during countdown. */
export function getStartLightCount(state: RaceState): number {
  if (state.phase !== 'countdown') return 0;
  if (state.countdownElapsed < 1.0) return 2;
  if (state.countdownElapsed < 2.0) return 4;
  return 5;
}

function applyStandings(racers: RacerState[], track: CircuitTrack): {
  racers: RacerState[];
  standings: number[];
} {
  const standings = computeStandings(racers, track);
  const posByIndex = new Array<number>(racers.length);
  for (let rank = 0; rank < standings.length; rank++) {
    posByIndex[standings[rank]] = rank + 1;
  }
  const updated = racers.map((r, idx) =>
    r.position === posByIndex[idx] ? r : { ...r, position: posByIndex[idx] },
  );
  return { racers: updated, standings };
}

export function createInitialRaceState(
  track: CircuitTrack = getDefaultTrack(),
  roster: readonly RacerConfig[] = RACER_ROSTER,
  totalLaps: number = RACE_LAPS,
): RaceState {
  const rawRacers: RacerState[] = roster.map((cfg) => {
    const slot = GRID_SLOTS[cfg.gridSlot];
    const sample = track.sampleAtS(track.totalLength - slot.backDist);
    const x = sample.x + sample.nx * slot.lateralOffset;
    const z = sample.z + sample.nz * slot.lateralOffset;
    const heading = Math.atan2(sample.tz, sample.tx);

    const car = createInitialCarState(x, z, heading);
    const projection = track.projectPoint(x, z);
    return {
      config: cfg,
      car,
      lap: createInitialLapState(),
      projection,
      position: cfg.gridSlot + 1,
      finished: false,
      finishTime: null,
      bestLapTime: null,
    };
  });

  const { racers, standings } = applyStandings(rawRacers, track);
  const playerIndex = Math.max(
    0,
    racers.findIndex((r) => r.config.isPlayer),
  );

  return {
    phase: 'countdown',
    totalLaps,
    countdownElapsed: 0,
    raceTime: 0,
    racers,
    standings,
    playerIndex,
    ghostTracker: createInitialGhostTracker(),
    ghostPose: null,
  };
}

/**
 * Advances the entire 4-car race by exactly one fixed simulation step.
 * Pure & deterministic: identical inputs produce identical race trajectories.
 */
export function stepRace(
  state: RaceState,
  playerInput: ControlInput,
  playerDemoMode: boolean,
  track: CircuitTrack = getDefaultTrack(),
  dt: number = FIXED_DT,
): RaceState {
  // 1. Countdown phase: all four cars stand stationary on the grid; race clock stays at 0
  if (state.phase === 'countdown') {
    const nextElapsed = state.countdownElapsed + dt;
    if (nextElapsed + 1e-9 < COUNTDOWN_SECONDS) {
      return {
        ...state,
        countdownElapsed: nextElapsed,
      };
    }
    return {
      ...state,
      phase: 'racing',
      countdownElapsed: COUNTDOWN_SECONDS,
      raceTime: 0,
    };
  }

  // 2. Racing / Post-player-finish phase: step every car, resolve contacts, update laps & positions
  const prevPositions = state.racers.map((r) => ({ x: r.car.x, z: r.car.z }));

  // Build traffic list once per tick for rival & demo overtaking logic
  const allTraffic: TrafficCarInfo[] = state.racers.map((r) => ({
    car: r.car,
    projection: r.projection,
  }));

  const steppedCars = state.racers.map((racer, idx) => {
    const others = allTraffic.filter((_, j) => j !== idx);
    let control: ControlInput;

    if (racer.config.isPlayer && !playerDemoMode && !racer.finished) {
      control = playerInput;
    } else if (racer.finished) {
      // Gently cruise finished cars forward along the road so they clear the line without blocking
      control = computeAutoDriverInput(
        { car: racer.car, projection: racer.projection },
        track,
        { pace: 0.72, preferredLane: racer.config.preferredLane, traffic: others },
      );
    } else {
      control = computeAutoDriverInput(
        { car: racer.car, projection: racer.projection },
        track,
        {
          pace: racer.config.pace,
          preferredLane: racer.config.preferredLane,
          traffic: others,
          allowBoost: racer.config.isPlayer,
        },
      );
    }

    return stepCar(racer.car, control, racer.projection.onRoad, dt);
  });

  // 3. Pairwise car-to-car contact resolution (no car passes through another)
  const { cars: resolvedCars } = resolveAllCarCollisions(steppedCars, 2);
  const nextRaceTime = state.raceTime + dt;

  // 4. Re-project onto track and advance lap referee under the exact same rules for all cars
  const updatedRacers: RacerState[] = state.racers.map((racer, idx) => {
    const carAfterContact = resolvedCars[idx];
    const nextProjection = track.projectPoint(carAfterContact.x, carAfterContact.z);
    const syncedCar =
      carAfterContact.offRoad === !nextProjection.onRoad
        ? carAfterContact
        : { ...carAfterContact, offRoad: !nextProjection.onRoad };

    const nextLap = stepLap(
      racer.lap,
      prevPositions[idx].x,
      prevPositions[idx].z,
      syncedCar.x,
      syncedCar.z,
      !nextProjection.onRoad,
      track,
      dt,
    );

    let finished = racer.finished;
    let finishTime = racer.finishTime;
    let bestLapTime = racer.bestLapTime;

    if (!finished && nextLap.completedLaps >= state.totalLaps) {
      finished = true;
      // Sub-step exact race finish time (subtract residual post-line time carried into next lap)
      finishTime = Math.max(0, nextRaceTime - nextLap.currentLapTime);
      bestLapTime = nextLap.bestLapTime;
    } else if (!finished) {
      bestLapTime = nextLap.bestLapTime;
    }

    return {
      ...racer,
      car: syncedCar,
      lap: nextLap,
      projection: nextProjection,
      finished,
      finishTime,
      bestLapTime,
    };
  });

  const { racers: rankedRacers, standings } = applyStandings(updatedRacers, track);
  const prevPlayer = state.racers[state.playerIndex];
  const nextPlayer = rankedRacers[state.playerIndex];
  const ghostTracker = stepGhostTracker(
    state.ghostTracker,
    prevPlayer.lap,
    nextPlayer.lap,
    nextPlayer.car,
    nextPlayer.projection,
    track,
  );
  const ghostPose =
    nextPlayer.lap.completedLaps > 0
      ? sampleGhostPose(ghostTracker.bestLap, nextPlayer.lap.currentLapTime)
      : null;

  const playerFinished = nextPlayer.finished;
  const nextPhase: RacePhase = playerFinished ? 'finished' : 'racing';

  return {
    ...state,
    phase: nextPhase,
    raceTime: nextRaceTime,
    racers: rankedRacers,
    standings,
    ghostTracker,
    ghostPose,
  };
}
