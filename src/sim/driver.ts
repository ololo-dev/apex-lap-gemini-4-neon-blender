import { clamp, computeEffectiveMaxSteer, normalizeAngle } from './car';
import { CAR_PHYSICS, MAX_BOOST_SPEED, MAX_ROAD_SPEED } from './constants';
import type { CircuitTrack } from './track';
import type { CarState, ControlInput, SimState, TrackProjection } from './types';

const LOOKAHEAD_SCAN_DIST = 135; // metres ahead for braking profile
const LOOKAHEAD_SCAN_STEP = 3; // metres between curvature checks
const SAFE_LATERAL_ACCEL = CAR_PHYSICS.maxLateralAccelRoad * 0.82;
const SAFE_BRAKE_DECEL = CAR_PHYSICS.brakeDecel * 0.8;

export interface TrafficCarInfo {
  readonly car: CarState;
  readonly projection: TrackProjection;
}

export interface AutoDriverOptions {
  /** Pace multiplier (e.g. 0.905..1.0); scales both straight speed and cornering speed */
  readonly pace?: number;
  /** Baseline preferred lateral lane offset (metres from centerline) */
  readonly preferredLane?: number;
  /** Other cars on the circuit for overtaking & collision avoidance */
  readonly traffic?: readonly TrafficCarInfo[];
  /** When true, deterministically burns boost on long straights and releases before corners */
  readonly allowBoost?: boolean;
}

function forwardTrackDelta(fromS: number, toS: number, totalLength: number): number {
  let ds = toS - fromS;
  if (ds < -totalLength * 0.5) ds += totalLength;
  else if (ds > totalLength * 0.5) ds -= totalLength;
  return ds;
}

/**
 * Chooses a clean lateral passing lane when approaching a slower car ahead so
 * rivals actively pull out and go round slower traffic while staying on the 12 m road.
 */
function computeOvertakeGuidance(
  car: CarState,
  projection: TrackProjection,
  preferredLane: number,
  traffic: readonly TrafficCarInfo[],
  track: CircuitTrack,
): { readonly targetLane: number; readonly cautionSpeed: number; readonly overtaking: boolean } {
  const aheadCurv = Math.max(
    Math.abs(projection.curvature),
    Math.abs(track.sampleAtS(projection.s + 16).curvature),
  );
  // 12 m road (-6..+6): keep passing lanes comfortably inside the road while giving room to pass
  const cornerTightness = clamp(aheadCurv * 20, 0, 0.22);
  const maxLane = (track.roadHalfWidth - 2.3) * (1 - cornerTightness); // 3.7m straight -> 2.9m corner
  let targetLane = clamp(preferredLane * (1 - cornerTightness * 2), -maxLane, maxLane);
  let cautionSpeed = MAX_BOOST_SPEED;

  // Detect any slower or close car ahead within 42 m so we pull out early and pass cleanly
  let nearestBlocking: {
    ds: number;
    otherOffset: number;
    otherSpeed: number;
  } | null = null;

  for (const other of traffic) {
    const ds = forwardTrackDelta(projection.s, other.projection.s, track.totalLength);
    if (ds <= 0.5 || ds > 42) continue;

    const lateralGap = Math.abs(other.projection.signedOffset - projection.signedOffset);
    const closing = other.car.forwardSpeed < car.forwardSpeed + 1.5;
    if (lateralGap < 2.9 && (closing || ds < 10)) {
      if (!nearestBlocking || ds < nearestBlocking.ds) {
        nearestBlocking = {
          ds,
          otherOffset: other.projection.signedOffset,
          otherSpeed: other.car.forwardSpeed,
        };
      }
    }
  }

  if (!nearestBlocking) {
    return { targetLane, cautionSpeed, overtaking: false };
  }

  // Pick the clearer side (left or right) to go round the slower car
  const passGap = 3.4;
  const candidateLeft = clamp(nearestBlocking.otherOffset - passGap, -maxLane, maxLane);
  const candidateRight = clamp(nearestBlocking.otherOffset + passGap, -maxLane, maxLane);

  const scoreCandidate = (lane: number): number => {
    let score = Math.abs(lane - nearestBlocking!.otherOffset) * 3.0;
    score -= Math.abs(lane - projection.signedOffset) * 0.1;
    for (const other of traffic) {
      const ds = forwardTrackDelta(projection.s, other.projection.s, track.totalLength);
      if (ds > -5 && ds < 20) {
        const gap = Math.abs(other.projection.signedOffset - lane);
        if (gap < 2.3) {
          score -= (2.3 - gap) * 6.0;
        }
      }
    }
    return score;
  };

  targetLane =
    scoreCandidate(candidateLeft) >= scoreCandidate(candidateRight)
      ? candidateLeft
      : candidateRight;

  // Only lift slightly if directly on the bumper before clearing laterally
  const latGapNow = Math.abs(nearestBlocking.otherOffset - projection.signedOffset);
  if (nearestBlocking.ds < 5.5 && latGapNow < 1.85) {
    cautionSpeed = Math.max(12, nearestBlocking.otherSpeed);
  }

  return { targetLane, cautionSpeed, overtaking: true };
}

/**
 * Pure deterministic autopilot shared between browser Demo Mode, racing rivals,
 * and the headless `lap:` / `race:` CLIs.
 */
export function computeAutoDriverInput(
  state: Pick<SimState, 'car' | 'projection'>,
  track: CircuitTrack,
  options: AutoDriverOptions = {},
): ControlInput {
  const { car, projection } = state;
  const pace = clamp(options.pace ?? 1.0, 0.7, 1.05);
  const preferredLane = options.preferredLane ?? 0;
  const traffic = options.traffic ?? [];
  const allowBoost = Boolean(options.allowBoost);

  const currentS = projection.s;
  const forwardSpeed = Math.max(0, car.forwardSpeed);
  const maxPaceSpeed = (allowBoost ? MAX_BOOST_SPEED : MAX_ROAD_SPEED) * pace;
  const paceLatAccel = SAFE_LATERAL_ACCEL * pace * pace;

  // 1. Speed profile: scan upcoming curvature and brake smoothly in time for corners
  let targetSpeed = maxPaceSpeed;
  for (let d = 0; d <= LOOKAHEAD_SCAN_DIST; d += LOOKAHEAD_SCAN_STEP) {
    const sample = track.sampleAtS(currentS + d);
    const absK = Math.abs(sample.curvature);
    if (absK > 1e-4) {
      const cornerSpeed = Math.sqrt(paceLatAccel / absK);
      const entrySpeed = Math.sqrt(
        cornerSpeed * cornerSpeed + 2 * SAFE_BRAKE_DECEL * d,
      );
      if (entrySpeed < targetSpeed) {
        targetSpeed = entrySpeed;
      }
    }
  }

  // Deterministic straightaway boost burn on the main straight (L->A->B),
  // surging cleanly past 216 km/h toward 270 km/h, then releasing well before braking so charge refills to 100%
  const onMainStraight = currentS > track.totalLength - 58 || currentS < 85;
  const boostWindowOpen =
    allowBoost &&
    !car.offRoad &&
    Math.abs(projection.signedOffset) < 3.4 &&
    onMainStraight &&
    forwardSpeed > 22;

  let boost = false;
  if (boostWindowOpen && (car.boostCharge >= 0.75 || (car.boosting && car.boostCharge > 0.05))) {
    boost = true;
    targetSpeed = maxPaceSpeed;
  }
  if (!boost) {
    targetSpeed = Math.min(targetSpeed, MAX_ROAD_SPEED * pace);
  }

  // Overtaking lane guidance when racing around other cars
  let targetLane = 0;
  let overtaking = false;
  if (traffic.length > 0) {
    const guidance = computeOvertakeGuidance(
      car,
      projection,
      preferredLane,
      traffic,
      track,
    );
    targetLane = guidance.targetLane;
    targetSpeed = Math.min(targetSpeed, guidance.cautionSpeed);
    overtaking = guidance.overtaking;
  }

  // Extra caution margin if drifting near the edge of the 12 m road
  const absOffset = Math.abs(projection.signedOffset);
  const cautionThreshold = overtaking ? 3.5 : 2.2;
  if (absOffset > cautionThreshold) {
    const marginScale = clamp(1 - (absOffset - cautionThreshold) * 0.16, 0.55, 1);
    targetSpeed = Math.min(targetSpeed, maxPaceSpeed * marginScale);
    if (absOffset > 4.2) {
      targetLane = 0;
    }
  }
  targetSpeed = clamp(targetSpeed, 14, maxPaceSpeed);

  // 2. Longitudinal control (throttle / brake)
  let throttle = 0;
  let brake = 0;
  const speedError = targetSpeed - car.forwardSpeed;
  if (speedError < -0.7) {
    brake = clamp((-speedError - 0.5) / 5.5, 0.15, 1);
  } else if (speedError > 0.25) {
    throttle = clamp(speedError / 4.0, 0.25, 1);
  } else {
    throttle = 0.2;
  }

  if (brake > 0.05) {
    boost = false;
  }

  // 3. Pure-pursuit steering toward lookahead point (crisper lane change when overtaking)
  const lookaheadDist = overtaking
    ? clamp(6.0 + forwardSpeed * 0.24, 6.0, 17)
    : clamp(7.5 + forwardSpeed * 0.34, 7.5, 24);
  const aim = track.sampleAtS(currentS + lookaheadDist);
  const aimX = aim.x + aim.nx * targetLane;
  const aimZ = aim.z + aim.nz * targetLane;
  const dx = aimX - car.x;
  const dz = aimZ - car.z;
  const distToAim = Math.hypot(dx, dz);

  const desiredHeading = Math.atan2(dz, dx);
  const headingError = normalizeAngle(desiredHeading - car.heading);
  const curvatureCmd =
    (2 * Math.sin(headingError)) / Math.max(distToAim, 3.5);
  const desiredWheelAngle =
    Math.atan(CAR_PHYSICS.wheelbase * curvatureCmd) - 0.08 * car.yawRate;

  const effectiveMaxSteer = computeEffectiveMaxSteer(forwardSpeed);
  const steer = clamp(desiredWheelAngle / Math.max(effectiveMaxSteer, 0.05), -1, 1);

  return { throttle, brake, steer, boost };
}
