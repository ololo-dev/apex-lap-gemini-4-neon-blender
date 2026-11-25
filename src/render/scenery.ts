import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CircuitTrack } from '../sim/track';
import { createChevronTexture, createSignTexture } from './textures';

function enableShadows(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function isSafeOffRoad(track: CircuitTrack, x: number, z: number, minDist: number): boolean {
  return track.projectPoint(x, z).distance >= minDist;
}

export interface SceneryRig {
  readonly group: THREE.Group;
  updateStartLights(phase: 'countdown' | 'racing' | 'finished', litRedCount: number): void;
}

/**
 * Populates trackside props that create an unmistakable sense of speed and scale:
 * corner chevron signs, braking markers, sponsor hoardings, roadside bollards,
 * light poles, and custom Blender-modeled glTF assets (start gantry, grandstands, pine groves).
 */
export function buildSceneryGroup(
  track: CircuitTrack,
  loader: GLTFLoader,
): SceneryRig {
  const group = new THREE.Group();
  group.name = 'Scenery';
  const startLightMats: THREE.MeshStandardMaterial[] = [];

  const postMat = new THREE.MeshStandardMaterial({
    color: '#2b303a',
    metalness: 0.65,
    roughness: 0.35,
  });
  const bollardRed = new THREE.MeshStandardMaterial({ color: '#df2d1e', roughness: 0.4 });
  const bollardWhite = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.4 });
  const lampGlow = new THREE.MeshStandardMaterial({
    color: '#fff6d6',
    emissive: '#ffdf8c',
    emissiveIntensity: 1.4,
  });

  // 1. Regular roadside bollards & trackside light poles (strong rhythmic speed cues!)
  const bollardGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.95, 8);
  const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 7.6, 8);
  const armGeo = new THREE.BoxGeometry(0.14, 0.14, 2.2);
  const lampGeo = new THREE.BoxGeometry(0.32, 0.14, 0.72);

  for (let s = 14; s < track.totalLength - 8; s += 18) {
    const sample = track.sampleAtS(s);
    const angle = Math.atan2(sample.tz, sample.tx);

    // Alternating red/white bollards flanking both sides of the track
    for (const side of [-1, 1] as const) {
      const bx = sample.x + sample.nx * (side * 9.8);
      const bz = sample.z + sample.nz * (side * 9.8);
      if (isSafeOffRoad(track, bx, bz, 8.8)) {
        const bollard = new THREE.Mesh(
          bollardGeo,
          Math.floor(s / 18) % 2 === 0 ? bollardRed : bollardWhite,
        );
        bollard.position.set(bx, 0.475, bz);
        bollard.castShadow = true;
        group.add(bollard);
      }
    }

    // Light poles every 54 m on alternating / outer side
    if (Math.round(s) % 54 < 18) {
      const outerSide = sample.curvature >= 0 ? -1 : 1;
      const px = sample.x + sample.nx * (outerSide * 10.6);
      const pz = sample.z + sample.nz * (outerSide * 10.6);
      if (isSafeOffRoad(track, px, pz, 9.5)) {
        const poleGroup = new THREE.Group();
        poleGroup.position.set(px, 0, pz);
        poleGroup.rotation.y = -angle;

        const pole = new THREE.Mesh(poleGeo, postMat);
        pole.position.y = 3.8;
        pole.castShadow = true;
        poleGroup.add(pole);

        const arm = new THREE.Mesh(armGeo, postMat);
        arm.position.set(0, 7.5, -outerSide * 1.0);
        poleGroup.add(arm);

        const lamp = new THREE.Mesh(lampGeo, lampGlow);
        lamp.position.set(0, 7.38, -outerSide * 1.9);
        poleGroup.add(lamp);

        group.add(poleGroup);
      }
    }
  }

  // 2. High-visibility Corner Chevron Boards on outside of every medium/tight corner
  const chevronRightMat = new THREE.MeshStandardMaterial({
    map: createChevronTexture(true),
    roughness: 0.4,
  });
  const chevronLeftMat = new THREE.MeshStandardMaterial({
    map: createChevronTexture(false),
    roughness: 0.4,
  });
  const chevronBackMat = new THREE.MeshStandardMaterial({ color: '#1b1f27', roughness: 0.6 });
  const chevronGeo = new THREE.BoxGeometry(0.16, 1.45, 2.2);
  const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6);

  for (let s = 20; s < track.totalLength; s += 12) {
    const sample = track.sampleAtS(s);
    if (Math.abs(sample.curvature) < 0.009) continue;

    const turnRight = sample.curvature > 0;
    const outerSide = turnRight ? -1 : 1; // outside of a right turn is to the left (-nx, -nz)
    const cx = sample.x + sample.nx * (outerSide * 10.4);
    const cz = sample.z + sample.nz * (outerSide * 10.4);
    if (!isSafeOffRoad(track, cx, cz, 9.2)) continue;

    const boardGroup = new THREE.Group();
    boardGroup.position.set(cx, 0, cz);
    // Face approaching car (-tx, -tz)
    boardGroup.rotation.y = -Math.atan2(sample.tz, sample.tx);

    const mats = [
      chevronBackMat,
      turnRight ? chevronRightMat : chevronLeftMat, // -X face faces approaching car
      chevronBackMat,
      chevronBackMat,
      chevronBackMat,
      chevronBackMat,
    ];
    const board = new THREE.Mesh(chevronGeo, mats);
    board.position.y = 1.35;
    board.castShadow = true;
    boardGroup.add(board);

    for (const lz of [-0.75, 0.75]) {
      const leg = new THREE.Mesh(legGeo, postMat);
      leg.position.set(0, 0.65, lz);
      boardGroup.add(leg);
    }
    group.add(boardGroup);
  }

  // 3. Original Circuit Sponsor Hoardings along straighter stretches
  const signConfigs = [
    { label: 'SOLARIS RING', bg: '#131924', fg: '#f8f5ee', accent: '#e83b1e' },
    { label: 'VESPERA GT-7', bg: '#e83b1e', fg: '#ffffff', accent: '#131924' },
    { label: 'APEX CHRONO', bg: '#f4f1ea', fg: '#151b26', accent: '#f0b429' },
    { label: 'SOLSTICE AERO', bg: '#16283b', fg: '#ffd166', accent: '#e83b1e' },
  ];
  const signMats = signConfigs.map(
    (cfg) =>
      new THREE.MeshStandardMaterial({
        map: createSignTexture(cfg.label, cfg.bg, cfg.fg, cfg.accent),
        roughness: 0.45,
      }),
  );
  const hoardingGeo = new THREE.BoxGeometry(9.0, 1.35, 0.25);

  let signIdx = 0;
  for (let s = 30; s < track.totalLength - 30; s += 88) {
    const sample = track.sampleAtS(s);
    if (Math.abs(sample.curvature) > 0.008) continue;
    for (const side of [-1, 1] as const) {
      const hx = sample.x + sample.nx * (side * 11.4);
      const hz = sample.z + sample.nz * (side * 11.4);
      if (!isSafeOffRoad(track, hx, hz, 10.5)) continue;
      const mesh = new THREE.Mesh(hoardingGeo, signMats[signIdx % signMats.length]);
      mesh.position.set(hx, 0.72, hz);
      mesh.rotation.y = -Math.atan2(sample.tz, sample.tx);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      signIdx += 1;
    }
  }

  // 4. Distant coastal mountain horizon ring (flat ground inside circuit, scenic vista outside)
  const hillMat = new THREE.MeshStandardMaterial({
    color: '#7a9789',
    roughness: 0.96,
    flatShading: true,
  });
  for (let i = 0; i < 24; i++) {
    const theta = (i / 24) * Math.PI * 2;
    const dist = 520 + (i % 3) * 70;
    const height = 22 + ((i * 19) % 28);
    const radius = 95 + ((i * 13) % 55);
    const hill = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 11), hillMat);
    hill.position.set(20 + Math.cos(theta) * dist, height * 0.44, 100 + Math.sin(theta) * dist);
    group.add(hill);
  }

  // 5. Load Blender-modeled Start/Finish Gantry at point A with controllable countdown lights
  const startGate = track.checkpoints[0];
  const startAngle = Math.atan2(startGate.tz, startGate.tx);
  loader.load('/models/start-gantry.glb', (gltf) => {
    const gantry = gltf.scene;
    enableShadows(gantry);
    gantry.position.set(startGate.x, 0, startGate.z);
    gantry.rotation.y = -startAngle;

    for (let k = 0; k < 5; k++) {
      const lens = gantry.getObjectByName(`LightLens_${k}`);
      if (lens instanceof THREE.Mesh && lens.material instanceof THREE.MeshStandardMaterial) {
        const cloned = lens.material.clone();
        lens.material = cloned;
        startLightMats[k] = cloned;
      }
    }
    group.add(gantry);
  });

  // 6. Load Blender-modeled Grandstands beside the start/finish straight & final corner
  loader.load('/models/grandstand.glb', (gltf) => {
    const template = gltf.scene;
    enableShadows(template);

    const placements = [
      { s: 46, side: -1, dist: 21 },
      { s: 82, side: -1, dist: 21 },
      { s: track.totalLength - 46, side: 1, dist: 22 },
    ];
    for (const p of placements) {
      const smp = track.sampleAtS(p.s);
      const gx = smp.x + smp.nx * (p.side * p.dist);
      const gz = smp.z + smp.nz * (p.side * p.dist);
      if (!isSafeOffRoad(track, gx, gz, 15)) continue;
      const stand = template.clone(true);
      stand.position.set(gx, 0, gz);
      // Grandstand front faces +Z in glTF (Blender -Y); rotate to face the road
      const baseAngle = -Math.atan2(smp.tz, smp.tx);
      stand.rotation.y = p.side < 0 ? baseAngle : baseAngle + Math.PI;
      group.add(stand);
    }
  });

  // 7. Load Blender-modeled Pine Trees scattered around the circuit perimeter & infield
  loader.load('/models/pine-tree.glb', (gltf) => {
    const treeTemplate = gltf.scene;
    enableShadows(treeTemplate);

    let seed = 9001;
    const nextRand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let s = 15; s < track.totalLength; s += 26) {
      const smp = track.sampleAtS(s);
      for (const side of [-1, 1] as const) {
        const offset = 18 + nextRand() * 28;
        const tx = smp.x + smp.nx * (side * offset);
        const tz = smp.z + smp.nz * (side * offset);
        if (!isSafeOffRoad(track, tx, tz, 15.5)) continue;
        // Keep space clear around grandstands near the start straight
        if (Math.abs(tx - 60) < 42 && Math.abs(tz + 22) < 16) continue;

        const tree = treeTemplate.clone(true);
        const scale = 0.85 + nextRand() * 0.65;
        tree.scale.setScalar(scale);
        tree.position.set(tx, 0, tz);
        tree.rotation.y = nextRand() * Math.PI * 2;
        group.add(tree);
      }
    }
  });

  return {
    group,
    updateStartLights(phase, litRedCount): void {
      for (let k = 0; k < startLightMats.length; k++) {
        const mat = startLightMats[k];
        if (!mat) continue;
        if (phase === 'countdown') {
          const isLit = k < litRedCount;
          mat.color.set(isLit ? '#ff2020' : '#1b1d22');
          mat.emissive.set(isLit ? '#ff1818' : '#000000');
          mat.emissiveIntensity = isLit ? 3.5 : 0;
        } else {
          mat.color.set('#28e664');
          mat.emissive.set('#20e058');
          mat.emissiveIntensity = 3.2;
        }
      }
    },
  };
}
