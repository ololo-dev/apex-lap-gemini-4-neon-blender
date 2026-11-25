import type { CircuitWaypoint } from './types';

/** Official 12-point circuit coordinates (metres: +x east, +z south). */
export const CIRCUIT_WAYPOINTS: readonly CircuitWaypoint[] = [
  { label: 'A', x: 0, z: 0 },
  { label: 'B', x: 120, z: 0 },
  { label: 'C', x: 200, z: 40 },
  { label: 'D', x: 220, z: 120 },
  { label: 'E', x: 160, z: 180 },
  { label: 'F', x: 80, z: 160 },
  { label: 'G', x: 40, z: 220 },
  { label: 'H', x: -60, z: 240 },
  { label: 'I', x: -140, z: 180 },
  { label: 'J', x: -120, z: 80 },
  { label: 'K', x: -180, z: 20 },
  { label: 'L', x: -100, z: -40 },
] as const;

export const ROAD_WIDTH = 12;
export const ROAD_HALF_WIDTH = ROAD_WIDTH / 2;

/** Fixed simulation timestep (seconds) shared by browser and headless CLI. */
export const FIXED_DT = 1 / 60;
/** Clamp raw browser frame delta so tab sleeps don't spiral, while allowing slow 1-2 FPS rendering. */
export const MAX_FRAME_DT = 1.0;

export const KM_H_PER_M_S = 3.6;

/** Strict road, boost, and off-road speed caps. */
export const MAX_ROAD_SPEED_KMH = 216;
export const MAX_ROAD_SPEED = MAX_ROAD_SPEED_KMH / KM_H_PER_M_S; // 60 m/s
export const MAX_BOOST_SPEED_KMH = 270;
export const MAX_BOOST_SPEED = MAX_BOOST_SPEED_KMH / KM_H_PER_M_S; // 75 m/s
export const MAX_OFF_ROAD_SPEED_KMH = 72;
export const MAX_OFF_ROAD_SPEED = MAX_OFF_ROAD_SPEED_KMH / KM_H_PER_M_S; // 20 m/s
export const MAX_REVERSE_SPEED = 15; // 54 km/h

/** Boost burn (3 s full -> empty) and recharge (10 s empty -> full) timings. */
export const BOOST_BURN_SECONDS = 3;
export const BOOST_RECHARGE_SECONDS = 10;
export const BOOST_EXTRA_ACCEL = 24.0; // m/s^2 surge while burning boost on road
export const BOOST_BLEED_DECEL = 15.0; // m/s^2 smooth bleed back to 216 km/h when boost ends

/** Vehicle geometry & physical tuning (Vespera GT-7). */
export const CAR_PHYSICS = {
  wheelbase: 2.7,
  wheelRadius: 0.345,
  maxSteerAngle: 0.56, // rad (~32 deg at low speed)
  steerRate: 4.8, // rad/s
  steerReturnRate: 6.5, // rad/s
  engineAccelLow: 16.5, // m/s^2 off the line
  engineAccelHigh: 7.5, // m/s^2 near top speed
  brakeDecel: 28.0, // m/s^2
  reverseAccel: 10.5, // m/s^2
  reverseEngageDelay: 0.12, // seconds holding brake at standstill before reversing
  coastDrag: 1.4, // m/s^2 rolling resistance
  aeroDragCoeff: 0.0012, // aerodynamic drag coefficient
  offRoadExtraDrag: 38.0, // strong gravel deceleration when entering off-road above 72 km/h
  maxLateralAccelRoad: 15.8, // m/s^2 (~1.61G slicks) -> taking fast corners too fast pushes wide
  maxLateralAccelOffRoad: 8.5, // m/s^2 loose gravel/grass
  lateralGripRateRoad: 11.5, // s^-1 lateral velocity damping when within traction circle
  lateralGripRateOffRoad: 5.5, // s^-1
  standstillSpeedEps: 0.08, // m/s below which the car does not turn on the spot
} as const;

export const CHECKPOINT_GATE_HALF_WIDTH = 14;
export const START_LINE_HALF_WIDTH = 10;
export const SPLINE_SUBDIVISIONS_PER_SEGMENT = 120;

/** Race format & car collision footprint (metres). */
export const RACE_LAPS = 3;
export const COUNTDOWN_SECONDS = 3;
export const GO_BANNER_SECONDS = 1.0;

export const CAR_HALF_LENGTH = 2.25; // 4.5 m overall length
export const CAR_HALF_WIDTH = 1.0; // 2.0 m overall width

/** Two-by-two starting grid behind the start line (distance behind A, lateral offset). */
export const GRID_SLOTS: readonly { readonly backDist: number; readonly lateralOffset: number }[] = [
  { backDist: 5.5, lateralOffset: -2.6 }, // P1 (front-left)
  { backDist: 9.0, lateralOffset: 2.6 }, // P2 (front-right)
  { backDist: 14.5, lateralOffset: -2.6 }, // P3 (rear-left)
  { backDist: 18.0, lateralOffset: 2.6 }, // P4 (rear-right — player starts last)
] as const;

/**
 * Four-car roster: three original rivals with distinct names, colours, and deterministic paces
 * (quickest rival ~10% faster per lap than the slowest) plus the player starting last in P4.
 */
export const RACER_ROSTER = [
  {
    id: 'rival-sora',
    name: 'Sora Sato',
    color: '#14a870',
    isPlayer: false,
    pace: 0.835,
    preferredLane: -0.9,
    gridSlot: 0,
  },
  {
    id: 'rival-marcus',
    name: 'Marcus Reed',
    color: '#e6a817',
    isPlayer: false,
    pace: 0.92,
    preferredLane: 0.9,
    gridSlot: 1,
  },
  {
    id: 'rival-elena',
    name: 'Elena Vance',
    color: '#246ef2',
    isPlayer: false,
    pace: 0.985,
    preferredLane: -0.3,
    gridSlot: 2,
  },
  {
    id: 'player',
    name: 'Vespera GT-7 (You)',
    color: '#e83b1e',
    isPlayer: true,
    pace: 1.0,
    preferredLane: 0,
    gridSlot: 3,
  },
] as const;
