import type { ControlInput } from '../sim/types';

const THROTTLE_CODES = new Set(['KeyW', 'ArrowUp']);
const BRAKE_CODES = new Set(['KeyS', 'ArrowDown']);
const LEFT_CODES = new Set(['KeyA', 'ArrowLeft']);
const RIGHT_CODES = new Set(['KeyD', 'ArrowRight']);
const BOOST_CODES = new Set(['Space', 'ShiftLeft', 'ShiftRight']);
const DEMO_TOGGLE_CODES = new Set(['KeyM']);
const RESET_CODES = new Set(['KeyR']);

export type TouchControlName = 'left' | 'right' | 'throttle' | 'brake' | 'boost';

export function isDrivingKeyCode(code: string): boolean {
  return (
    THROTTLE_CODES.has(code) ||
    BRAKE_CODES.has(code) ||
    LEFT_CODES.has(code) ||
    RIGHT_CODES.has(code) ||
    BOOST_CODES.has(code)
  );
}

export interface KeyActionResult {
  readonly demoModeChanged: boolean;
  readonly resetRequested: boolean;
}

/**
 * Pure keyboard + touch input controller supporting WASD/Arrows, Boost (Space/Shift),
 * Demo Mode toggle (`M`), one-key/one-tap player takeover, touch driving controls, and reset (`R`).
 */
export class InputController {
  private readonly pressed = new Set<string>();
  private readonly touchActive = new Set<TouchControlName>();
  private demoMode: boolean;

  constructor(initialDemoMode = false) {
    this.demoMode = initialDemoMode;
  }

  isDemoMode(): boolean {
    return this.demoMode;
  }

  setDemoMode(enabled: boolean): void {
    this.demoMode = enabled;
  }

  toggleDemoMode(): boolean {
    this.demoMode = !this.demoMode;
    return this.demoMode;
  }

  onKeyDown(code: string, repeat = false): KeyActionResult {
    this.pressed.add(code);

    // One driving key immediately hands control back to the player when Demo Mode is active
    if (this.demoMode && isDrivingKeyCode(code)) {
      this.demoMode = false;
      return { demoModeChanged: true, resetRequested: false };
    }

    if (!repeat && DEMO_TOGGLE_CODES.has(code)) {
      this.demoMode = !this.demoMode;
      return { demoModeChanged: true, resetRequested: false };
    }

    if (!repeat && RESET_CODES.has(code)) {
      return { demoModeChanged: false, resetRequested: true };
    }

    return { demoModeChanged: false, resetRequested: false };
  }

  onKeyUp(code: string): void {
    this.pressed.delete(code);
  }

  /** Activates or releases an on-screen touch driving button; tapping exits Demo Mode. */
  setTouchControl(control: TouchControlName, active: boolean): boolean {
    if (active) {
      this.touchActive.add(control);
      if (this.demoMode) {
        this.demoMode = false;
        return true;
      }
    } else {
      this.touchActive.delete(control);
    }
    return false;
  }

  clearKeys(): void {
    this.pressed.clear();
    this.touchActive.clear();
  }

  getPlayerInput(): ControlInput {
    const throttle =
      this.hasAny(THROTTLE_CODES) || this.touchActive.has('throttle') ? 1 : 0;
    const brake = this.hasAny(BRAKE_CODES) || this.touchActive.has('brake') ? 1 : 0;
    const left = this.hasAny(LEFT_CODES) || this.touchActive.has('left') ? 1 : 0;
    const right = this.hasAny(RIGHT_CODES) || this.touchActive.has('right') ? 1 : 0;
    const boost = this.hasAny(BOOST_CODES) || this.touchActive.has('boost');
    return {
      throttle,
      brake,
      steer: right - left,
      boost,
    };
  }

  private hasAny(codes: ReadonlySet<string>): boolean {
    for (const c of codes) {
      if (this.pressed.has(c)) return true;
    }
    return false;
  }
}
