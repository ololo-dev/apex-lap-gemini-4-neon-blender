import './style.css';
import { FIXED_DT, MAX_FRAME_DT } from '../sim/constants';
import { FixedClock } from '../sim/engine';
import { createInitialRaceState, getCountdownLabel, stepRace } from '../sim/race';
import { getDefaultTrack } from '../sim/track';
import type { RaceState, SimState } from '../sim/types';
import { GameRenderer } from '../render/renderer';
import { HudView } from './hud';
import { InputController } from './inputState';

interface ExposedRaceSnapshot {
  readonly race: RaceState;
  readonly countdown: string | null;
  readonly demoMode: boolean;
  readonly cameraFov: number;
  readonly cameraDist: number;
  readonly state: SimState;
  setDemoMode(enabled: boolean): void;
  reset(): void;
}

declare global {
  interface Window {
    __RACE_STATE__?: ExposedRaceSnapshot;
    __GAME_STATE__?: ExposedRaceSnapshot;
  }
}

function bootstrap(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const hudRoot = document.getElementById('hud');
  if (!canvas || !hudRoot) {
    throw new Error('Missing #game-canvas or #hud mount element');
  }

  const track = getDefaultTrack();
  const params = new URLSearchParams(window.location.search);
  const startInDemo = params.get('demo') === '1' || params.get('demo') === 'true';

  const input = new InputController(startInDemo);
  const clock = new FixedClock(FIXED_DT, MAX_FRAME_DT);
  let raceState = createInitialRaceState(track);

  const renderer = new GameRenderer(canvas, track, raceState);

  const startNewRace = (): void => {
    raceState = createInitialRaceState(track);
    clock.reset();
    renderer.reset(raceState);
  };

  const hud = new HudView(hudRoot, track, raceState, {
    onToggleDemo: () => {
      input.toggleDemoMode();
    },
    onNewRace: startNewRace,
    onTouchControl: (control, active) => {
      input.setTouchControl(control, active);
    },
  });

  window.addEventListener('keydown', (event) => {
    if (event.code.startsWith('Arrow') || event.code === 'Space') {
      event.preventDefault();
    }
    const action = input.onKeyDown(event.code, event.repeat);
    if (action.resetRequested) {
      startNewRace();
    }
  });

  window.addEventListener('keyup', (event) => {
    input.onKeyUp(event.code);
  });

  window.addEventListener('blur', () => {
    input.clearKeys();
  });

  window.addEventListener('resize', () => {
    renderer.resize(window.innerWidth, window.innerHeight);
  });

  const publishSnapshot = (): void => {
    const player = raceState.racers[raceState.playerIndex];
    const snapshot: ExposedRaceSnapshot = {
      race: raceState,
      countdown: getCountdownLabel(raceState),
      demoMode: input.isDemoMode(),
      cameraFov: renderer.getCameraFov(),
      cameraDist: renderer.getCameraDistanceToPlayer(raceState),
      state: {
        elapsedTime: raceState.raceTime,
        car: player.car,
        lap: player.lap,
        projection: player.projection,
      },
      setDemoMode: (enabled: boolean) => input.setDemoMode(enabled),
      reset: startNewRace,
    };
    window.__RACE_STATE__ = snapshot;
    window.__GAME_STATE__ = snapshot;
  };

  let lastTimestamp = performance.now();
  const tick = (now: number): void => {
    const rawDt = Math.max(0, (now - lastTimestamp) / 1000);
    lastTimestamp = now;

    clock.advance(rawDt, (dt) => {
      raceState = stepRace(
        raceState,
        input.getPlayerInput(),
        input.isDemoMode(),
        track,
        dt,
      );
    });

    renderer.render(raceState, rawDt);
    hud.update(raceState, input.isDemoMode());
    publishSnapshot();
    requestAnimationFrame(tick);
  };

  hud.update(raceState, input.isDemoMode());
  publishSnapshot();
  requestAnimationFrame(tick);
}

bootstrap();
