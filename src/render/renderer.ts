import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getStartLightCount } from '../sim/race';
import type { CircuitTrack } from '../sim/track';
import type { RaceState } from '../sim/types';
import { ChaseCamera } from './camera';
import { CarVisual } from './carMesh';
import { createGameScene, type SceneRig } from './scene';
import { buildSceneryGroup, type SceneryRig } from './scenery';
import { buildTrackGroup } from './trackMesh';

export class GameRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly sceneRig: SceneRig;
  private readonly sceneryRig: SceneryRig;
  private readonly chaseCamera: ChaseCamera;
  private readonly carVisuals: CarVisual[];
  private readonly ghostVisual: CarVisual;

  constructor(canvas: HTMLCanvasElement, track: CircuitTrack, initialRace: RaceState) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.sceneRig = createGameScene();
    const loader = new GLTFLoader();

    this.sceneRig.scene.add(buildTrackGroup(track));
    this.sceneryRig = buildSceneryGroup(track, loader);
    this.sceneRig.scene.add(this.sceneryRig.group);

    // Spawn one distinct liveried Vespera GT-7 visual per racer + see-through best-lap ghost
    this.carVisuals = initialRace.racers.map((racer) => {
      const visual = new CarVisual(racer.config.color, false);
      this.sceneRig.scene.add(visual.group);
      this.sceneRig.scene.add(visual.dustGroup);
      return visual;
    });
    this.ghostVisual = new CarVisual('#6ce8ff', true);
    this.sceneRig.scene.add(this.ghostVisual.group);

    loader.load('/models/vespera-gt7.glb', (gltf) => {
      for (const visual of this.carVisuals) {
        visual.attachModelTemplate(gltf.scene);
      }
      this.ghostVisual.attachModelTemplate(gltf.scene);
    });

    this.chaseCamera = new ChaseCamera(window.innerWidth / Math.max(1, window.innerHeight));
    this.reset(initialRace);
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    this.renderer.setSize(w, h, false);
    this.chaseCamera.resize(w / h);
  }

  reset(race: RaceState): void {
    for (let i = 0; i < race.racers.length; i++) {
      this.carVisuals[i]?.update(race.racers[i].car, 1 / 60);
    }
    this.ghostVisual.updateGhost(race.ghostPose);
    const playerCar = race.racers[race.playerIndex].car;
    this.chaseCamera.reset(playerCar);
    this.sceneRig.updateSunTarget(playerCar.x, playerCar.z);
    this.sceneryRig.updateStartLights(race.phase, getStartLightCount(race));
  }

  render(race: RaceState, frameDt: number): void {
    const dt = Math.min(Math.max(frameDt, 1 / 240), 0.25);
    for (let i = 0; i < race.racers.length; i++) {
      this.carVisuals[i]?.update(race.racers[i].car, dt);
    }
    this.ghostVisual.updateGhost(race.ghostPose);
    const playerCar = race.racers[race.playerIndex].car;
    this.chaseCamera.update(playerCar, dt);
    this.sceneRig.updateSunTarget(playerCar.x, playerCar.z);
    this.sceneryRig.updateStartLights(race.phase, getStartLightCount(race));
    this.renderer.render(this.sceneRig.scene, this.chaseCamera.camera);
  }

  getCameraFov(): number {
    return this.chaseCamera.camera.fov;
  }

  getCameraDistanceToPlayer(race: RaceState): number {
    const p = race.racers[race.playerIndex].car;
    return Math.hypot(
      this.chaseCamera.camera.position.x - p.x,
      this.chaseCamera.camera.position.z - p.z,
    );
  }
}
