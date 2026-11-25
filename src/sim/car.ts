import {
  BOOST_BLEED_DECEL,
  BOOST_BURN_SECONDS,
  BOOST_EXTRA_ACCEL,
  BOOST_RECHARGE_SECONDS,
  CAR_PHYSICS,
  MAX_BOOST_SPEED,
  MAX_OFF_ROAD_SPEED,
  MAX_REVERSE_SPEED,
  MAX_ROAD_SPEED,
} from './constants';
import type { CarState, ControlInput } from './types';

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function moveToward(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

export function computeEffectiveMaxSteer(absForwardSpeed: number): number {
  const speedRatio = clamp(absForwardSpeed / MAX_ROAD_SPEED, 0, 1);
  return CAR_PHYSICS.maxSteerAngle * (1 - 0.56 * speedRatio * speedRatio);
}

export function createInitialCarState(x: number, z: number, heading: number): CarState {
  return {
    x,
    z,
    heading: normalizeAngle(heading),
    vx: 0,
    vz: 0,
    forwardSpeed: 0,
    lateralSpeed: 0,
    speed: 0,
    yawRate: 0,
    steerAngle: 0,
    wheelSpin: 0,
    braking: false,
    offRoad: false,
    boostCharge: 1,
    boosting: false,
    lateralAccel: 0,
    longitudinalAccel: 0,
    reverseHoldTime: 0,
  };
}

export function stepCar(
  car: CarState,
  input: ControlInput,
  onRoad: boolean,
  dt: number,
): CarState {
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);
  const steerInput = clamp(input.steer, -1, 1);
  const boostRequested = Boolean(input.boost);

  const fx = Math.cos(car.heading);
  const fz = Math.sin(car.heading);
  const rx = -fz;
  const rz = fx;

  let vFwd = car.vx * fx + car.vz * fz;
  const vLat = car.vx * rx + car.vz * rz;

  // Boost burn & recharge: full charge lasts 3 s, refills empty -> full in 10 s when not burning
  const canBurnBoost = boostRequested && car.boostCharge > 1e-6 && brake <= 0.05;
  let boostCharge = car.boostCharge;
  let boosting = false;
  if (canBurnBoost) {
    boosting = true;
    boostCharge = car.boostCharge - dt / BOOST_BURN_SECONDS;
    if (boostCharge < 1e-6) boostCharge = 0;
  } else if (!boostRequested) {
    boostCharge = car.boostCharge + dt / BOOST_RECHARGE_SECONDS;
    if (boostCharge > 1 - 1e-6) boostCharge = 1;
  }

  // Steering angle evolution (visual front wheels still turn when stopped, car body does not)
  const effectiveMaxSteer = computeEffectiveMaxSteer(Math.abs(vFwd));
  const targetSteer = steerInput * effectiveMaxSteer;
  const steerRate =
    Math.abs(steerInput) > 0.01 ? CAR_PHYSICS.steerRate : CAR_PHYSICS.steerReturnRate;
  const steerAngle = moveToward(car.steerAngle, targetSteer, steerRate * dt);

  // Off the road, boost NEVER lifts the 72 km/h (20 m/s) limit
  const roadSpeedCap = boosting ? MAX_BOOST_SPEED : MAX_ROAD_SPEED;
  const maxFwdSpeed = onRoad ? roadSpeedCap : MAX_OFF_ROAD_SPEED;
  const wasWithinOffRoadCap = !onRoad && car.speed <= MAX_OFF_ROAD_SPEED + 1e-6;

  let aLong = 0;
  let braking = false;
  let reverseHoldTime = car.reverseHoldTime;

  if (brake > 0.05) {
    braking = true;
    if (vFwd > 0.25) {
      aLong = -CAR_PHYSICS.brakeDecel * brake;
      reverseHoldTime = 0;
    } else if (vFwd > -0.25 && throttle < 0.05 && reverseHoldTime < CAR_PHYSICS.reverseEngageDelay) {
      // Come to a clean stop briefly, then reverse if brake is held longer
      vFwd = 0;
      reverseHoldTime += dt;
    } else {
      aLong = -CAR_PHYSICS.reverseAccel * brake;
    }
  } else {
    reverseHoldTime = 0;
    const effectiveThrottle = boosting ? Math.max(throttle, 1) : throttle;
    if (effectiveThrottle > 0.01) {
      if (vFwd < -0.25) {
        aLong = CAR_PHYSICS.brakeDecel * effectiveThrottle;
        braking = true;
      } else if (vFwd <= maxFwdSpeed) {
        const speedFrac = clamp(Math.max(0, vFwd) / MAX_ROAD_SPEED, 0, 1);
        const engineAccel =
          CAR_PHYSICS.engineAccelLow +
          (CAR_PHYSICS.engineAccelHigh - CAR_PHYSICS.engineAccelLow) * speedFrac;
        aLong = engineAccel * effectiveThrottle + (boosting && onRoad ? BOOST_EXTRA_ACCEL : 0);
      }
    } else if (Math.abs(vFwd) > 0.05) {
      aLong = -Math.sign(vFwd) * CAR_PHYSICS.coastDrag;
    } else {
      vFwd = 0;
    }
  }

  // Aerodynamic drag
  const aeroDrag = -CAR_PHYSICS.aeroDragCoeff * vFwd * Math.abs(vFwd);
  let nextVFwd = vFwd + (aLong + aeroDrag) * dt;

  // Smooth bleed back down to 216 km/h when boost ends while above normal road top speed
  if (onRoad && !boosting && nextVFwd > MAX_ROAD_SPEED) {
    nextVFwd = Math.max(MAX_ROAD_SPEED, nextVFwd - BOOST_BLEED_DECEL * dt);
  }

  // Prevent coasting or braking from overshooting zero into unintended reverse
  if (brake > 0.05 && vFwd > 0.25 && nextVFwd < 0) {
    nextVFwd = 0;
  } else if (
    brake <= 0.05 &&
    throttle <= 0.01 &&
    !boosting &&
    Math.sign(vFwd) !== 0 &&
    Math.sign(nextVFwd) !== Math.sign(vFwd)
  ) {
    nextVFwd = 0;
  }

  // Off-road gravel resistance rapidly brings speed down to 72 km/h and holds it there
  if (!onRoad) {
    if (nextVFwd > MAX_OFF_ROAD_SPEED) {
      if (wasWithinOffRoadCap) {
        nextVFwd = MAX_OFF_ROAD_SPEED;
      } else {
        nextVFwd = Math.max(
          MAX_OFF_ROAD_SPEED,
          nextVFwd - CAR_PHYSICS.offRoadExtraDrag * dt,
        );
      }
    }
  }

  // Strict top-speed (216 normal / 270 boosting) and reverse caps
  const hardMaxForward =
    onRoad && !boosting && vFwd <= MAX_ROAD_SPEED + 1e-6
      ? MAX_ROAD_SPEED
      : MAX_BOOST_SPEED;
  nextVFwd = clamp(nextVFwd, -MAX_REVERSE_SPEED, hardMaxForward);

  // Turning & lateral traction dynamics
  const maxLatAccel = onRoad
    ? CAR_PHYSICS.maxLateralAccelRoad
    : CAR_PHYSICS.maxLateralAccelOffRoad;
  const gripRate = onRoad
    ? CAR_PHYSICS.lateralGripRateRoad
    : CAR_PHYSICS.lateralGripRateOffRoad;

  let yawRate = 0;
  let newHeading = car.heading;
  let finalVFwd = nextVFwd;
  let finalVLat = 0;
  let lateralAccel = 0;

  if (Math.abs(nextVFwd) >= CAR_PHYSICS.standstillSpeedEps) {
    // Bicycle kinematic yaw rate, limited by available tire lateral grip (creates natural understeer)
    const kinematicYawRate =
      (nextVFwd / CAR_PHYSICS.wheelbase) * Math.tan(steerAngle);
    const reqLatAccel = Math.abs(nextVFwd * kinematicYawRate);
    const gripScale = reqLatAccel > maxLatAccel ? maxLatAccel / reqLatAccel : 1;
    yawRate = kinematicYawRate * gripScale;

    const dHeading = yawRate * dt;
    newHeading = normalizeAngle(car.heading + dHeading);

    // Project velocity into the rotated body frame
    const cosD = Math.cos(dHeading);
    const sinD = Math.sin(dHeading);
    const vFwdRot = nextVFwd * cosD + vLat * sinD;
    const vLatRot = -nextVFwd * sinD + vLat * cosD;

    // Finite lateral tire friction pulls lateral slip toward zero (pushing wide when saturated)
    const desiredLatChange = -vLatRot * Math.min(1, gripRate * dt);
    const maxLatChange = maxLatAccel * dt;
    const appliedLatChange = clamp(desiredLatChange, -maxLatChange, maxLatChange);
    finalVLat = vLatRot + appliedLatChange;

    // Slight cornering scrub drag proportional to lateral slip
    const scrub = Math.min(Math.abs(vFwdRot), Math.abs(vLatRot) * 0.14 * dt);
    finalVFwd = vFwdRot - Math.sign(vFwdRot) * scrub;

    lateralAccel = clamp(finalVFwd * yawRate, -maxLatAccel, maxLatAccel);
  }

  const newFx = Math.cos(newHeading);
  const newFz = Math.sin(newHeading);
  const newRx = -newFz;
  const newRz = newFx;

  let newVx = finalVFwd * newFx + finalVLat * newRx;
  let newVz = finalVFwd * newFz + finalVLat * newRz;
  let speed = Math.hypot(newVx, newVz);

  // Enforce strict planar speed ceilings
  const speedCeiling =
    !onRoad && wasWithinOffRoadCap
      ? MAX_OFF_ROAD_SPEED
      : hardMaxForward;
  if (speed > speedCeiling) {
    const scale = speedCeiling / speed;
    newVx *= scale;
    newVz *= scale;
    finalVFwd *= scale;
    finalVLat *= scale;
    speed = speedCeiling;
  }

  const newX = car.x + newVx * dt;
  const newZ = car.z + newVz * dt;
  const wheelSpin = car.wheelSpin + (finalVFwd / CAR_PHYSICS.wheelRadius) * dt;
  const longitudinalAccel = (finalVFwd - vFwd) / dt;

  return {
    x: newX,
    z: newZ,
    heading: newHeading,
    vx: newVx,
    vz: newVz,
    forwardSpeed: finalVFwd,
    lateralSpeed: finalVLat,
    speed,
    yawRate,
    steerAngle,
    wheelSpin,
    braking,
    offRoad: !onRoad,
    boostCharge,
    boosting,
    lateralAccel,
    longitudinalAccel,
    reverseHoldTime,
  };
}
