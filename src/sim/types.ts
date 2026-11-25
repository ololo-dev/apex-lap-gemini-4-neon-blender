export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export interface CircuitWaypoint {
  readonly label: string;
  readonly x: number;
  readonly z: number;
}

export interface TrackSample {
  readonly x: number;
  readonly z: number;
  readonly s: number;
  readonly tx: number;
  readonly tz: number;
  readonly nx: number;
  readonly nz: number;
  readonly curvature: number;
}

export interface CheckpointGate {
  readonly index: number;
  readonly label: string;
  readonly x: number;
  readonly z: number;
  readonly s: number;
  readonly tx: number;
  readonly tz: number;
  readonly nx: number;
  readonly nz: number;
  readonly halfWidth: number;
}

export interface TrackProjection {
  readonly s: number;
  readonly distance: number;
  readonly signedOffset: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly tx: number;
  readonly tz: number;
  readonly nx: number;
  readonly nz: number;
  readonly curvature: number;
  readonly onRoad: boolean;
}

export interface ControlInput {
  /** Throttle in [0, 1] */
  readonly throttle: number;
  /** Brake / reverse in [0, 1] */
  readonly brake: number;
  /** Steering in [-1, 1]: -1 = left, +1 = right */
  readonly steer: number;
  /** Optional boost burn request */
  readonly boost?: boolean;
}

export interface CarState {
  readonly x: number;
  readonly z: number;
  /** Heading in radians: 0 = +X (east), +PI/2 = +Z (south / right turn) */
  readonly heading: number;
  readonly vx: number;
  readonly vz: number;
  /** Signed forward speed along car heading (m/s) */
  readonly forwardSpeed: number;
  /** Lateral velocity along car right axis (m/s) */
  readonly lateralSpeed: number;
  /** Total planar speed magnitude (m/s) */
  readonly speed: number;
  /** Current yaw rate (rad/s) */
  readonly yawRate: number;
  /** Front wheel steer angle (rad, + = right) */
  readonly steerAngle: number;
  /** Cumulative wheel spin angle (rad) */
  readonly wheelSpin: number;
  /** True while braking with forward motion */
  readonly braking: boolean;
  /** True when outside the 12 m road surface */
  readonly offRoad: boolean;
  /** Boost energy remaining in [0, 1] (full charge = 3 s burn, 10 s recharge) */
  readonly boostCharge: number;
  /** True while boost is actively burning */
  readonly boosting: boolean;
  /** Lateral acceleration (m/s^2) for visual body roll */
  readonly lateralAccel: number;
  /** Longitudinal acceleration (m/s^2) for visual body pitch */
  readonly longitudinalAccel: number;
  /** Time brake has been held while stopped, for smooth reverse engagement */
  readonly reverseHoldTime: number;
}

export interface LapState {
  /** Number of completed valid laps */
  readonly completedLaps: number;
  /** 1-based display lap number (completedLaps + 1) */
  readonly currentLapNumber: number;
  /** Elapsed time on the current lap (seconds) */
  readonly currentLapTime: number;
  /** Most recently completed lap time (seconds), or null before first completion */
  readonly lastLapTime: number | null;
  /** Fastest completed lap time (seconds), or null before first completion */
  readonly bestLapTime: number | null;
  /** Next required waypoint index in 1..12 (1 = B, ..., 11 = L, 12 = ready for start line A) */
  readonly nextCheckpoint: number;
  /** Total off-road seconds accumulated during the current lap */
  readonly currentLapOffRoadTime: number;
  /** Off-road seconds recorded on the last completed lap */
  readonly lastLapOffRoadTime: number;
  /** Total off-road seconds accumulated across the whole run */
  readonly totalOffRoadTime: number;
}

export interface SimState {
  readonly elapsedTime: number;
  readonly car: CarState;
  readonly lap: LapState;
  readonly projection: TrackProjection;
}

export type RacePhase = 'countdown' | 'racing' | 'finished';

export type CountdownLabel = '3' | '2' | '1' | 'GO' | null;

export interface RacerConfig {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly isPlayer: boolean;
  /** Deterministic pace multiplier for AI driving (1.0 = full built-in pace) */
  readonly pace: number;
  /** Slight preferred lateral offset (m) for natural pack diversity */
  readonly preferredLane: number;
  /** 0-based starting grid slot (0 = pole P1, 3 = last P4) */
  readonly gridSlot: number;
}

export interface RacerState {
  readonly config: RacerConfig;
  readonly car: CarState;
  readonly lap: LapState;
  readonly projection: TrackProjection;
  /** 1-based live race position (1..4) */
  readonly position: number;
  /** True once the racer has completed all race laps */
  readonly finished: boolean;
  /** Total race time from GO to crossing the finish line on the final lap (seconds) */
  readonly finishTime: number | null;
  /** Best completed lap time locked at finish (or live best while racing) */
  readonly bestLapTime: number | null;
}

import type { GhostSample, GhostTracker } from './ghost';

export interface RaceState {
  readonly phase: RacePhase;
  readonly totalLaps: number;
  /** Seconds elapsed since the countdown started */
  readonly countdownElapsed: number;
  /** Race clock in seconds — remains 0 until GO */
  readonly raceTime: number;
  /** All racers in stable roster order */
  readonly racers: readonly RacerState[];
  /** Racer indices sorted in live standings / finishing order (0th = 1st place) */
  readonly standings: readonly number[];
  /** Index of the player in `racers` */
  readonly playerIndex: number;
  /** Best-lap ghost recording tracker for the player */
  readonly ghostTracker: GhostTracker;
  /** Live interpolated ghost pose for the current lap, or null if none active */
  readonly ghostPose: GhostSample | null;
}
