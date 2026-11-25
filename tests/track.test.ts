import { describe, expect, it } from 'vitest';
import { CIRCUIT_WAYPOINTS, ROAD_HALF_WIDTH, ROAD_WIDTH } from '../src/sim/constants';
import { CircuitTrack, getDefaultTrack } from '../src/sim/track';

describe('CircuitTrack', () => {
  const track = getDefaultTrack();

  it('uses the 12 official circuit waypoints in order A through L', () => {
    expect(track.waypoints).toHaveLength(12);
    expect(track.waypoints.map((w) => w.label).join('')).toBe('ABCDEFGHIJKL');
    expect(track.waypoints[0]).toEqual({ label: 'A', x: 0, z: 0 });
    expect(track.waypoints[1]).toEqual({ label: 'B', x: 120, z: 0 });
    expect(track.waypoints[11]).toEqual({ label: 'L', x: -100, z: -40 });
  });

  it('passes smoothly through every single waypoint as a closed curve', () => {
    for (const wp of CIRCUIT_WAYPOINTS) {
      const proj = track.projectPoint(wp.x, wp.z);
      expect(proj.distance).toBeLessThan(1e-6);
      expect(proj.onRoad).toBe(true);
    }

    // Continuity across the seam (s = 0 vs s = totalLength)
    const start = track.sampleAtS(0);
    const wrap = track.sampleAtS(track.totalLength);
    expect(Math.hypot(start.x - wrap.x, start.z - wrap.z)).toBeLessThan(1e-6);
    expect(track.wrapS(-10)).toBeCloseTo(track.totalLength - 10, 6);
  });

  it('defines a 12 m wide road (6 m half-width) around the centerline', () => {
    expect(ROAD_WIDTH).toBe(12);
    expect(track.roadHalfWidth).toBe(ROAD_HALF_WIDTH);

    const sample = track.sampleAtS(60);
    const insideLeft = track.projectPoint(
      sample.x - sample.nx * 5.8,
      sample.z - sample.nz * 5.8,
    );
    const insideRight = track.projectPoint(
      sample.x + sample.nx * 5.8,
      sample.z + sample.nz * 5.8,
    );
    const outsideRight = track.projectPoint(
      sample.x + sample.nx * 6.3,
      sample.z + sample.nz * 6.3,
    );

    expect(insideLeft.onRoad).toBe(true);
    expect(insideRight.onRoad).toBe(true);
    expect(outsideRight.onRoad).toBe(false);
    expect(insideRight.signedOffset).toBeGreaterThan(5.5);
    expect(insideLeft.signedOffset).toBeLessThan(-5.5);
  });

  it('faces point B from point A at the start line', () => {
    expect(track.startHeading).toBeCloseTo(0, 6);
    expect(track.checkpoints).toHaveLength(12);
    expect(track.checkpoints[0].x).toBe(0);
    expect(track.checkpoints[0].z).toBe(0);
  });

  it('creates a standalone CircuitTrack instance with smooth tangents', () => {
    const custom = new CircuitTrack(CIRCUIT_WAYPOINTS, ROAD_HALF_WIDTH, 40);
    expect(custom.totalLength).toBeGreaterThan(1000);
    for (let i = 0; i < custom.samples.length; i++) {
      const a = custom.samples[i];
      const b = custom.samples[(i + 1) % custom.samples.length];
      const dot = a.tx * b.tx + a.tz * b.tz;
      expect(dot).toBeGreaterThan(0.95);
    }
  });
});
