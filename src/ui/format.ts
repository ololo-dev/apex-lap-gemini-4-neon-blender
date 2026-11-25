import { KM_H_PER_M_S } from '../sim/constants';

/** Formats seconds as MM:SS.mmm (e.g. 00:38.412), or placeholder when null. */
export function formatLapTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) {
    return '--:--.---';
  }
  const safe = Math.max(0, seconds);
  const totalMillis = Math.round(safe * 1000);
  const minutes = Math.floor(totalMillis / 60000);
  const secs = Math.floor((totalMillis % 60000) / 1000);
  const millis = totalMillis % 1000;
  return (
    String(minutes).padStart(2, '0') +
    ':' +
    String(secs).padStart(2, '0') +
    '.' +
    String(millis).padStart(3, '0')
  );
}

/** Converts m/s to rounded display km/h. */
export function speedMetersPerSecToKmh(speedMetersPerSec: number): number {
  return Math.round(Math.max(0, speedMetersPerSec) * KM_H_PER_M_S);
}

/** Formats race standing as e.g. "3 / 4". */
export function formatPosition(position: number, total: number): string {
  return `${position} / ${total}`;
}

/** Derives a realistic display gear indicator ('R', 'N', or '1'..'6') from signed forward speed. */
export function computeDisplayGear(forwardSpeed: number): string {
  if (forwardSpeed < -0.4) return 'R';
  if (Math.abs(forwardSpeed) <= 0.4) return 'N';
  const kmh = forwardSpeed * KM_H_PER_M_S;
  if (kmh < 42) return '1';
  if (kmh < 82) return '2';
  if (kmh < 122) return '3';
  if (kmh < 160) return '4';
  if (kmh < 192) return '5';
  return '6';
}
