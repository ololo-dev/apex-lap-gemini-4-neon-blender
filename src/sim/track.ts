import {
  CHECKPOINT_GATE_HALF_WIDTH,
  CIRCUIT_WAYPOINTS,
  ROAD_HALF_WIDTH,
  SPLINE_SUBDIVISIONS_PER_SEGMENT,
  START_LINE_HALF_WIDTH,
} from './constants';
import type {
  CheckpointGate,
  CircuitWaypoint,
  TrackProjection,
  TrackSample,
  Vec2,
} from './types';

function dist2D(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/**
 * Evaluates a centripetal Catmull-Rom spline segment between p1 and p2
 * using Barry & Goldman's pyramidal formulation (alpha = 0.5).
 * Guaranteed to pass through p1 at u=0 and p2 at u=1 without cusps or self-loops.
 */
function evalCentripetalCatmullRom(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  u: number,
): Vec2 {
  const alpha = 0.5;
  const dt0 = Math.max(Math.pow(dist2D(p0, p1), alpha), 1e-4);
  const dt1 = Math.max(Math.pow(dist2D(p1, p2), alpha), 1e-4);
  const dt2 = Math.max(Math.pow(dist2D(p2, p3), alpha), 1e-4);

  const t0 = 0;
  const t1 = dt0;
  const t2 = t1 + dt1;
  const t3 = t2 + dt2;
  const t = t1 + u * (t2 - t1);

  const lerpPt = (a: Vec2, b: Vec2, ta: number, tb: number): Vec2 => {
    const w = (t - ta) / (tb - ta);
    return {
      x: a.x + (b.x - a.x) * w,
      z: a.z + (b.z - a.z) * w,
    };
  };

  const a1 = lerpPt(p0, p1, t0, t1);
  const a2 = lerpPt(p1, p2, t1, t2);
  const a3 = lerpPt(p2, p3, t2, t3);
  const b1 = lerpPt(a1, a2, t0, t2);
  const b2 = lerpPt(a2, a3, t1, t3);
  return lerpPt(b1, b2, t1, t2);
}

export class CircuitTrack {
  readonly waypoints: readonly CircuitWaypoint[];
  readonly samples: readonly TrackSample[];
  readonly checkpoints: readonly CheckpointGate[];
  readonly totalLength: number;
  readonly roadHalfWidth: number;
  readonly startHeading: number;

  constructor(
    waypoints: readonly CircuitWaypoint[] = CIRCUIT_WAYPOINTS,
    roadHalfWidth: number = ROAD_HALF_WIDTH,
    subdivisionsPerSegment: number = SPLINE_SUBDIVISIONS_PER_SEGMENT,
  ) {
    this.waypoints = waypoints;
    this.roadHalfWidth = roadHalfWidth;

    const count = waypoints.length;
    const rawPoints: Vec2[] = [];
    const waypointSampleIndices: number[] = [];

    for (let i = 0; i < count; i++) {
      waypointSampleIndices.push(rawPoints.length);
      const p0 = waypoints[(i - 1 + count) % count];
      const p1 = waypoints[i];
      const p2 = waypoints[(i + 1) % count];
      const p3 = waypoints[(i + 2) % count];

      for (let step = 0; step < subdivisionsPerSegment; step++) {
        const u = step / subdivisionsPerSegment;
        rawPoints.push(evalCentripetalCatmullRom(p0, p1, p2, p3, u));
      }
    }

    const n = rawPoints.length;
    const arcLengths = new Float64Array(n);
    let runningLength = 0;
    for (let i = 1; i < n; i++) {
      runningLength += dist2D(rawPoints[i - 1], rawPoints[i]);
      arcLengths[i] = runningLength;
    }
    this.totalLength = runningLength + dist2D(rawPoints[n - 1], rawPoints[0]);

    const samples: TrackSample[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = rawPoints[(i - 1 + n) % n];
      const curr = rawPoints[i];
      const next = rawPoints[(i + 1) % n];

      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      const tx = dx / len;
      const tz = dz / len;
      // Right-hand normal in XZ plane (+x east, +z south): clockwise 90 deg from forward
      const nx = -tz;
      const nz = tx;

      // Signed curvature via circumscribed circle of (prev, curr, next)
      const ax = curr.x - prev.x;
      const az = curr.z - prev.z;
      const bx = next.x - curr.x;
      const bz = next.z - curr.z;
      const cx = next.x - prev.x;
      const cz = next.z - prev.z;
      const cross = ax * bz - az * bx; // positive => right turn (+Z clockwise)
      const denom = Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(cx, cz);
      const curvature = denom > 1e-8 ? (2 * cross) / denom : 0;

      samples[i] = {
        x: curr.x,
        z: curr.z,
        s: arcLengths[i],
        tx,
        tz,
        nx,
        nz,
        curvature,
      };
    }
    this.samples = samples;

    this.checkpoints = waypoints.map((wp, idx) => {
      const sample = samples[waypointSampleIndices[idx]];
      return {
        index: idx,
        label: wp.label,
        x: wp.x,
        z: wp.z,
        s: sample.s,
        tx: sample.tx,
        tz: sample.tz,
        nx: sample.nx,
        nz: sample.nz,
        halfWidth: idx === 0 ? START_LINE_HALF_WIDTH : CHECKPOINT_GATE_HALF_WIDTH,
      };
    });

    // Spec: car starts on point A, facing point B
    const a = waypoints[0];
    const b = waypoints[1];
    this.startHeading = Math.atan2(b.z - a.z, b.x - a.x);
  }

  /** Wraps any arc-length coordinate into [0, totalLength). */
  wrapS(s: number): number {
    const mod = s % this.totalLength;
    return mod < 0 ? mod + this.totalLength : mod;
  }

  /** Samples centerline position, tangent, normal, and curvature at arc-length s. */
  sampleAtS(rawS: number): TrackSample {
    const s = this.wrapS(rawS);
    const samples = this.samples;
    const n = samples.length;

    // Binary search for largest i with samples[i].s <= s
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (samples[mid].s <= s) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    const i0 = lo;
    const i1 = (lo + 1) % n;
    const a = samples[i0];
    const b = samples[i1];
    const segLen = i1 === 0 ? this.totalLength - a.s : b.s - a.s;
    const t = segLen > 1e-8 ? (s - a.s) / segLen : 0;

    const txRaw = a.tx + (b.tx - a.tx) * t;
    const tzRaw = a.tz + (b.tz - a.tz) * t;
    const tLen = Math.hypot(txRaw, tzRaw) || 1;
    const tx = txRaw / tLen;
    const tz = tzRaw / tLen;

    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      s,
      tx,
      tz,
      nx: -tz,
      nz: tx,
      curvature: a.curvature + (b.curvature - a.curvature) * t,
    };
  }

  /** Exact global closest-point projection onto the closed track centerline. */
  projectPoint(x: number, z: number): TrackProjection {
    const samples = this.samples;
    const n = samples.length;

    let bestDistSq = Infinity;
    let bestI = 0;
    let bestT = 0;
    let bestCx = samples[0].x;
    let bestCz = samples[0].z;

    for (let i = 0; i < n; i++) {
      const a = samples[i];
      const b = samples[(i + 1) % n];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const abLenSq = abx * abx + abz * abz;
      let t = 0;
      if (abLenSq > 1e-10) {
        t = ((x - a.x) * abx + (z - a.z) * abz) / abLenSq;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
      }
      const cx = a.x + abx * t;
      const cz = a.z + abz * t;
      const dx = x - cx;
      const dz = z - cz;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestI = i;
        bestT = t;
        bestCx = cx;
        bestCz = cz;
      }
    }

    const a = samples[bestI];
    const b = samples[(bestI + 1) % n];
    const segLen = bestI + 1 === n ? this.totalLength - a.s : b.s - a.s;
    const s = this.wrapS(a.s + segLen * bestT);

    const txRaw = a.tx + (b.tx - a.tx) * bestT;
    const tzRaw = a.tz + (b.tz - a.tz) * bestT;
    const tLen = Math.hypot(txRaw, tzRaw) || 1;
    const tx = txRaw / tLen;
    const tz = tzRaw / tLen;
    const nx = -tz;
    const nz = tx;

    const distance = Math.sqrt(bestDistSq);
    const signedOffset = (x - bestCx) * nx + (z - bestCz) * nz;
    const curvature = a.curvature + (b.curvature - a.curvature) * bestT;

    return {
      s,
      distance,
      signedOffset,
      centerX: bestCx,
      centerZ: bestCz,
      tx,
      tz,
      nx,
      nz,
      curvature,
      onRoad: distance <= this.roadHalfWidth,
    };
  }
}

let defaultTrackCache: CircuitTrack | null = null;

export function getDefaultTrack(): CircuitTrack {
  if (!defaultTrackCache) {
    defaultTrackCache = new CircuitTrack();
  }
  return defaultTrackCache;
}
