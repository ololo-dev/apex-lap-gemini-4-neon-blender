import { describe, expect, it } from 'vitest';
import {
  computeDisplayGear,
  formatLapTime,
  formatPosition,
  speedMetersPerSecToKmh,
} from '../src/ui/format';
import { InputController, isDrivingKeyCode } from '../src/ui/inputState';

describe('UI formatting helpers', () => {
  it('formats lap times cleanly and handles null/invalid inputs', () => {
    expect(formatLapTime(null)).toBe('--:--.---');
    expect(formatLapTime(Number.NaN)).toBe('--:--.---');
    expect(formatLapTime(0)).toBe('00:00.000');
    expect(formatLapTime(38.412)).toBe('00:38.412');
    expect(formatLapTime(65.004)).toBe('01:05.004');
  });

  it('converts m/s to km/h, formats race position, and derives display gears', () => {
    expect(speedMetersPerSecToKmh(60)).toBe(216);
    expect(speedMetersPerSecToKmh(20)).toBe(72);
    expect(speedMetersPerSecToKmh(-5)).toBe(0);
    expect(formatPosition(3, 4)).toBe('3 / 4');
    expect(formatPosition(1, 4)).toBe('1 / 4');

    expect(computeDisplayGear(-5)).toBe('R');
    expect(computeDisplayGear(0)).toBe('N');
    expect(computeDisplayGear(8)).toBe('1');
    expect(computeDisplayGear(18)).toBe('2');
    expect(computeDisplayGear(30)).toBe('3');
    expect(computeDisplayGear(40)).toBe('4');
    expect(computeDisplayGear(50)).toBe('5');
    expect(computeDisplayGear(60)).toBe('6');
  });
});

describe('InputController', () => {
  it('reads WASD, Arrow keys, and Space/Shift boost', () => {
    const input = new InputController(false);
    input.onKeyDown('KeyW');
    input.onKeyDown('ArrowRight');
    input.onKeyDown('Space');
    expect(input.getPlayerInput()).toEqual({ throttle: 1, brake: 0, steer: 1, boost: true });

    input.onKeyUp('KeyW');
    input.onKeyUp('ArrowRight');
    input.onKeyUp('Space');
    input.onKeyDown('ArrowDown');
    input.onKeyDown('KeyA');
    expect(input.getPlayerInput()).toEqual({ throttle: 0, brake: 1, steer: -1, boost: false });

    input.clearKeys();
    expect(input.getPlayerInput()).toEqual({ throttle: 0, brake: 0, steer: 0, boost: false });
  });

  it('supports touch driving controls for steer, accelerate, brake, and boost and exits demo mode on tap', () => {
    const input = new InputController(true);
    expect(input.isDemoMode()).toBe(true);

    const exited = input.setTouchControl('throttle', true);
    expect(exited).toBe(true);
    expect(input.isDemoMode()).toBe(false);

    input.setTouchControl('left', true);
    input.setTouchControl('boost', true);
    expect(input.getPlayerInput()).toEqual({ throttle: 1, brake: 0, steer: -1, boost: true });

    input.setTouchControl('left', false);
    input.setTouchControl('right', true);
    input.setTouchControl('throttle', false);
    input.setTouchControl('brake', true);
    input.setTouchControl('boost', false);
    expect(input.getPlayerInput()).toEqual({ throttle: 0, brake: 1, steer: 1, boost: false });
  });

  it('toggles Demo Mode with M and returns control to the player on a single driving key', () => {
    const input = new InputController(false);
    expect(input.isDemoMode()).toBe(false);

    const toggleOn = input.onKeyDown('KeyM', false);
    expect(toggleOn.demoModeChanged).toBe(true);
    expect(input.isDemoMode()).toBe(true);

    // Key repeat on M should not flicker demo mode
    const repeatM = input.onKeyDown('KeyM', true);
    expect(repeatM.demoModeChanged).toBe(false);
    expect(input.isDemoMode()).toBe(true);

    // One driving key immediately hands control back to player
    expect(isDrivingKeyCode('KeyW')).toBe(true);
    const takeOver = input.onKeyDown('KeyW', false);
    expect(takeOver.demoModeChanged).toBe(true);
    expect(input.isDemoMode()).toBe(false);
    expect(input.getPlayerInput().throttle).toBe(1);

    input.setDemoMode(true);
    expect(input.toggleDemoMode()).toBe(false);
  });

  it('requests reset when R is pressed', () => {
    const input = new InputController(false);
    const res = input.onKeyDown('KeyR', false);
    expect(res.resetRequested).toBe(true);
    const rep = input.onKeyDown('KeyR', true);
    expect(rep.resetRequested).toBe(false);
  });
});
