import { createInitialCarState, stepCar } from './car';
import { FIXED_DT, MAX_FRAME_DT } from './constants';
import { createInitialLapState, stepLap } from './lap';
import { CircuitTrack, getDefaultTrack } from './track';
import type { ControlInput, SimState } from './types';

export function createInitialSimState(
  track: CircuitTrack = getDefaultTrack(),
): SimState {
  const start = track.waypoints[0];
  const car = createInitialCarState(start.x, start.z, track.startHeading);
  const projection = track.projectPoint(car.x, car.z);
  return {
    elapsedTime: 0,
    car,
    lap: createInitialLapState(),
    projection,
  };
}

/** Advances the entire simulation by exactly one fixed step (dt seconds). */
export function stepSimulation(
  state: SimState,
  input: ControlInput,
  track: CircuitTrack = getDefaultTrack(),
  dt: number = FIXED_DT,
): SimState {
  const prevX = state.car.x;
  const prevZ = state.car.z;

  const nextCar = stepCar(state.car, input, state.projection.onRoad, dt);
  const nextProjection = track.projectPoint(nextCar.x, nextCar.z);
  const syncedCar =
    nextCar.offRoad === !nextProjection.onRoad
      ? nextCar
      : { ...nextCar, offRoad: !nextProjection.onRoad };

  const nextLap = stepLap(
    state.lap,
    prevX,
    prevZ,
    syncedCar.x,
    syncedCar.z,
    !nextProjection.onRoad,
    track,
    dt,
  );

  return {
    elapsedTime: state.elapsedTime + dt,
    car: syncedCar,
    lap: nextLap,
    projection: nextProjection,
  };
}

/**
 * Fixed-timestep accumulator so rendering frame rate never changes game physics
 * or distance travelled per second.
 */
export class FixedClock {
  readonly fixedDt: number;
  readonly maxFrameDt: number;
  private accumulator = 0;

  constructor(fixedDt: number = FIXED_DT, maxFrameDt: number = MAX_FRAME_DT) {
    this.fixedDt = fixedDt;
    this.maxFrameDt = maxFrameDt;
  }

  reset(): void {
    this.accumulator = 0;
  }

  /**
   * Consumes raw elapsed wall-clock seconds, calling `onStep(fixedDt)` for each
   * full fixed step accrued. Returns the number of fixed steps executed.
   */
  advance(rawDtSeconds: number, onStep: (dt: number) => void): number {
    if (rawDtSeconds <= 0 || !Number.isFinite(rawDtSeconds)) {
      return 0;
    }
    this.accumulator += Math.min(rawDtSeconds, this.maxFrameDt);
    let steps = 0;
    // Small epsilon prevents floating-point drift from dropping an exact boundary step
    while (this.accumulator + 1e-9 >= this.fixedDt) {
      this.accumulator = Math.max(0, this.accumulator - this.fixedDt);
      onStep(this.fixedDt);
      steps += 1;
    }
    return steps;
  }

  get remainder(): number {
    return this.accumulator;
  }
}
