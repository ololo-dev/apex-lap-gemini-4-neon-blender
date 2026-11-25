import * as THREE from 'three';
import type { CircuitTrack } from '../sim/track';
import {
  createAsphaltTexture,
  createCurbTexture,
  createGrassTexture,
  createStartLineTexture,
} from './textures';

/**
 * Builds a closed flat ribbon along the track centerline between lateral offsets
 * [leftOffset, rightOffset] at height `y`.
 */
function buildTrackRibbonGeometry(
  track: CircuitTrack,
  leftOffset: number,
  rightOffset: number,
  y: number,
  vMetersPerRepeat: number,
): THREE.BufferGeometry {
  const samples = track.samples;
  const n = samples.length;
  const vertexCount = (n + 1) * 2;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];

  for (let i = 0; i <= n; i++) {
    const sample = samples[i % n];
    const s = i === n ? track.totalLength : sample.s;
    const vCoord = s / vMetersPerRepeat;

    const lx = sample.x + sample.nx * leftOffset;
    const lz = sample.z + sample.nz * leftOffset;
    const rx = sample.x + sample.nx * rightOffset;
    const rz = sample.z + sample.nz * rightOffset;

    const base = i * 2;
    positions[base * 3] = lx;
    positions[base * 3 + 1] = y;
    positions[base * 3 + 2] = lz;
    normals[base * 3 + 1] = 1;
    uvs[base * 2] = 0;
    uvs[base * 2 + 1] = vCoord;

    positions[(base + 1) * 3] = rx;
    positions[(base + 1) * 3 + 1] = y;
    positions[(base + 1) * 3 + 2] = rz;
    normals[(base + 1) * 3 + 1] = 1;
    uvs[(base + 1) * 2] = 1;
    uvs[(base + 1) * 2 + 1] = vCoord;

    if (i < n) {
      const a = base;
      const b = base + 1;
      const c = base + 2;
      const d = base + 3;
      // Winding order for upward (+Y) normal in right-handed XZ plane
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export function buildTrackGroup(track: CircuitTrack): THREE.Group {
  const group = new THREE.Group();
  group.name = 'TrackWorld';

  // 1. Flat grass ground plane (y = 0)
  const grassTex = createGrassTexture();
  const groundGeo = new THREE.PlaneGeometry(1600, 1600);
  const groundMat = new THREE.MeshStandardMaterial({
    map: grassTex,
    roughness: 0.94,
    metalness: 0.0,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(20, 0, 100);
  ground.receiveShadow = true;
  group.add(ground);

  // 2. Sandy gravel verge ribbons just outside the curbs for crisp road/ground contrast
  const hw = track.roadHalfWidth;
  const vergeMat = new THREE.MeshStandardMaterial({
    color: '#c8b68e',
    roughness: 0.96,
    metalness: 0.0,
  });
  const leftVerge = new THREE.Mesh(
    buildTrackRibbonGeometry(track, -(hw + 3.6), -(hw + 0.95), 0.014, 12),
    vergeMat,
  );
  const rightVerge = new THREE.Mesh(
    buildTrackRibbonGeometry(track, hw + 0.95, hw + 3.6, 0.014, 12),
    vergeMat,
  );
  leftVerge.receiveShadow = true;
  rightVerge.receiveShadow = true;
  group.add(leftVerge, rightVerge);

  // 3. Main 12m wide asphalt road surface
  const asphaltTex = createAsphaltTexture();
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTex,
    roughness: 0.78,
    metalness: 0.04,
  });
  const roadMesh = new THREE.Mesh(
    buildTrackRibbonGeometry(track, -hw, hw, 0.03, 18),
    roadMat,
  );
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // 4. Red-and-white painted curbs framing both road edges
  const curbTex = createCurbTexture();
  const curbMat = new THREE.MeshStandardMaterial({
    map: curbTex,
    roughness: 0.72,
    metalness: 0.02,
  });
  const leftCurb = new THREE.Mesh(
    buildTrackRibbonGeometry(track, -(hw + 1.05), -hw + 0.05, 0.042, 4.5),
    curbMat,
  );
  const rightCurb = new THREE.Mesh(
    buildTrackRibbonGeometry(track, hw - 0.05, hw + 1.05, 0.042, 4.5),
    curbMat,
  );
  leftCurb.receiveShadow = true;
  rightCurb.receiveShadow = true;
  group.add(leftCurb, rightCurb);

  // 5. High-contrast checkered start/finish line across point A
  const startGate = track.checkpoints[0];
  const startLineTex = createStartLineTexture();
  const startGeo = new THREE.PlaneGeometry(track.roadHalfWidth * 2, 3.0);
  const startMat = new THREE.MeshStandardMaterial({
    map: startLineTex,
    roughness: 0.65,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const startLine = new THREE.Mesh(startGeo, startMat);
  startLine.rotation.x = -Math.PI / 2;
  // Align plane width (X) across the road normal and depth (Z) along track tangent
  const tangentAngle = Math.atan2(startGate.tz, startGate.tx);
  startLine.rotation.z = tangentAngle + Math.PI / 2;
  startLine.position.set(startGate.x, 0.046, startGate.z);
  startLine.receiveShadow = true;
  group.add(startLine);

  // Painted 2x2 starting grid slots behind the start line
  const gridBoxMat = new THREE.MeshBasicMaterial({ color: '#f5f4ef' });
  const gridSlots = [
    { backDist: 5.5, lateralOffset: -2.6 },
    { backDist: 9.0, lateralOffset: 2.6 },
    { backDist: 14.5, lateralOffset: -2.6 },
    { backDist: 18.0, lateralOffset: 2.6 },
  ];
  for (const slot of gridSlots) {
    const smp = track.sampleAtS(track.totalLength - slot.backDist);
    const gx = smp.x + smp.nx * slot.lateralOffset + smp.tx * 2.35;
    const gz = smp.z + smp.nz * slot.lateralOffset + smp.tz * 2.35;
    const gAngle = Math.atan2(smp.tz, smp.tx);
    const frontBar = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.2), gridBoxMat);
    frontBar.rotation.x = -Math.PI / 2;
    frontBar.rotation.z = gAngle + Math.PI / 2;
    frontBar.position.set(gx, 0.048, gz);
    group.add(frontBar);
  }

  return group;
}
