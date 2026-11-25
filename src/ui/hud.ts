import {
  MAX_BOOST_SPEED_KMH,
  MAX_OFF_ROAD_SPEED_KMH,
  MAX_ROAD_SPEED_KMH,
} from '../sim/constants';
import { getCountdownLabel, getStartLightCount } from '../sim/race';
import type { CircuitTrack } from '../sim/track';
import type { RaceState } from '../sim/types';
import {
  computeDisplayGear,
  formatLapTime,
  formatPosition,
  speedMetersPerSecToKmh,
} from './format';
import type { TouchControlName } from './inputState';

export interface HudCallbacks {
  readonly onToggleDemo: () => void;
  readonly onNewRace: () => void;
  readonly onTouchControl: (control: TouchControlName, active: boolean) => void;
}

export class HudView {
  private readonly speedFxEl: HTMLElement;
  private readonly speedValueEl: HTMLElement;
  private readonly speedBarFillEl: HTMLElement;
  private readonly boostBarFillEl: HTMLElement;
  private readonly boostPctEl: HTMLElement;
  private readonly gearEl: HTMLElement;
  private readonly positionEl: HTMLElement;
  private readonly lapNumberEl: HTMLElement;
  private readonly raceTimeEl: HTMLElement;
  private readonly currentTimeEl: HTMLElement;
  private readonly lastTimeEl: HTMLElement;
  private readonly bestTimeEl: HTMLElement;
  private readonly offRoadBannerEl: HTMLElement;
  private readonly demoBannerEl: HTMLElement;
  private readonly demoButtonEl: HTMLButtonElement;
  private readonly countdownOverlayEl: HTMLElement;
  private readonly countdownTextEl: HTMLElement;
  private readonly startLightEls: HTMLElement[];
  private readonly resultsOverlayEl: HTMLElement;
  private readonly resultsHeadingEl: HTMLElement;
  private readonly resultsBodyEl: HTMLElement;
  private readonly mapDotEls: SVGCircleElement[];
  private readonly ghostDotEl: SVGCircleElement;

  private readonly mapScale: number;
  private readonly mapOffsetX: number;
  private readonly mapOffsetZ: number;
  private lastResultsSignature = '';

  constructor(
    container: HTMLElement,
    track: CircuitTrack,
    initialRace: RaceState,
    callbacks: HudCallbacks,
  ) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of track.samples) {
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.z < minZ) minZ = s.z;
      if (s.z > maxZ) maxZ = s.z;
    }
    const pad = 16;
    const svgW = 168;
    const svgH = 128;
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    this.mapScale = Math.min((svgW - pad * 2) / spanX, (svgH - pad * 2) / spanZ);
    this.mapOffsetX = (svgW - spanX * this.mapScale) / 2 - minX * this.mapScale;
    this.mapOffsetZ = (svgH - spanZ * this.mapScale) / 2 - minZ * this.mapScale;

    const pathPoints: string[] = [];
    for (let i = 0; i < track.samples.length; i += 6) {
      const s = track.samples[i];
      pathPoints.push(
        `${(s.x * this.mapScale + this.mapOffsetX).toFixed(1)},${(s.z * this.mapScale + this.mapOffsetZ).toFixed(1)}`,
      );
    }
    const startGate = track.checkpoints[0];
    const startMapX = startGate.x * this.mapScale + this.mapOffsetX;
    const startMapZ = startGate.z * this.mapScale + this.mapOffsetZ;

    const dotMarkup = initialRace.racers
      .map((r, idx) => {
        const radius = r.config.isPlayer ? 4.8 : 3.8;
        const cls = r.config.isPlayer ? 'map-dot player' : 'map-dot rival';
        return `<circle class="${cls}" data-racer-dot="${idx}" cx="${startMapX.toFixed(1)}" cy="${startMapZ.toFixed(1)}" r="${radius}" fill="${r.config.color}" />`;
      })
      .join('');

    const roadCapPct = ((MAX_ROAD_SPEED_KMH / MAX_BOOST_SPEED_KMH) * 100).toFixed(1);

    container.innerHTML = `
      <div class="speed-fx" data-hud="speed-fx"></div>

      <div class="hud-top-left panel">
        <div class="brand-row">
          <span class="brand-accent"></span>
          <span class="brand-title">SOLARIS CIRCUIT</span>
          <span class="brand-car">VESPERA GT-7</span>
        </div>
        <div class="race-stats-row">
          <div class="stat-box">
            <span class="label">POS</span>
            <span class="stat-big mono" data-hud="position">4 / 4</span>
          </div>
          <div class="stat-box right">
            <span class="label">LAP</span>
            <span class="stat-big mono" data-hud="lap-number">1 / ${initialRace.totalLaps}</span>
          </div>
        </div>
        <div class="times-grid">
          <div class="time-row">
            <span class="label">RACE</span>
            <span class="mono" data-hud="race-time">00:00.000</span>
          </div>
          <div class="time-row">
            <span class="label">CURRENT</span>
            <span class="mono" data-hud="current-lap">00:00.000</span>
          </div>
          <div class="time-row">
            <span class="label">LAST</span>
            <span class="mono" data-hud="last-lap">--:--.---</span>
          </div>
          <div class="time-row best">
            <span class="label">BEST</span>
            <span class="mono" data-hud="best-lap">--:--.---</span>
          </div>
        </div>
      </div>

      <div class="hud-top-center">
        <div class="status-banner offroad hidden" data-hud="offroad-banner" role="alert">
          OFF ROAD &mdash; HELD TO ${MAX_OFF_ROAD_SPEED_KMH} KM/H
        </div>
        <div class="status-banner demo hidden" data-hud="demo-banner">
          DEMO MODE &middot; Press W/A/S/D, Space or Tap to Drive
        </div>
      </div>

      <div class="countdown-overlay hidden" data-hud="countdown">
        <div class="start-lights">
          <span class="light-lamp" data-light="0"></span>
          <span class="light-lamp" data-light="1"></span>
          <span class="light-lamp" data-light="2"></span>
          <span class="light-lamp" data-light="3"></span>
          <span class="light-lamp" data-light="4"></span>
        </div>
        <div class="countdown-text" data-hud="countdown-text">3</div>
      </div>

      <div class="results-overlay hidden" data-hud="results-overlay" role="dialog" aria-label="Race Results">
        <div class="results-card panel">
          <div class="results-header">
            <span class="results-tag">SOLARIS CIRCUIT &middot; ${initialRace.totalLaps} LAPS</span>
            <h2 class="results-title" data-hud="results-heading">RACE COMPLETE</h2>
          </div>
          <table class="results-table">
            <thead>
              <tr>
                <th>POS</th>
                <th>DRIVER</th>
                <th class="num">RACE TIME</th>
                <th class="num">BEST LAP</th>
              </tr>
            </thead>
            <tbody data-hud="results-body"></tbody>
          </table>
          <div class="results-footer">
            <button type="button" class="primary-btn" data-action="new-race">New Race (R)</button>
          </div>
        </div>
      </div>

      <div class="hud-top-right panel">
        <svg class="minimap" viewBox="0 0 ${svgW} ${svgH}" aria-label="Circuit map">
          <polygon class="map-outline" points="${pathPoints.join(' ')}" />
          <polygon class="map-road" points="${pathPoints.join(' ')}" />
          <line
            class="map-start"
            x1="${(startMapX - startGate.nx * 6).toFixed(1)}"
            y1="${(startMapZ - startGate.nz * 6).toFixed(1)}"
            x2="${(startMapX + startGate.nx * 6).toFixed(1)}"
            y2="${(startMapZ + startGate.nz * 6).toFixed(1)}"
          />
          <circle class="map-dot ghost hidden" data-hud="ghost-dot" cx="${startMapX.toFixed(1)}" cy="${startMapZ.toFixed(1)}" r="4.2" />
          ${dotMarkup}
        </svg>
        <div class="hud-actions">
          <button type="button" class="hud-btn" data-action="demo">Demo (M)</button>
          <button type="button" class="hud-btn secondary" data-action="reset">New Race (R)</button>
        </div>
      </div>

      <div class="hud-bottom-left panel controls-pill">
        <kbd>W</kbd>/<kbd>&uarr;</kbd> Accel
        <span class="sep">&middot;</span>
        <kbd>S</kbd>/<kbd>&darr;</kbd> Brake
        <span class="sep">&middot;</span>
        <kbd>A</kbd><kbd>D</kbd> Steer
        <span class="sep">&middot;</span>
        <kbd>Space</kbd>/<kbd>Shift</kbd> Boost
        <span class="sep">&middot;</span>
        <kbd>M</kbd> Demo
        <span class="sep">&middot;</span>
        <kbd>R</kbd> Reset
      </div>

      <div class="hud-bottom-right panel speed-cluster">
        <div class="speed-top">
          <span class="gear-badge" data-hud="gear">N</span>
          <div class="speed-readout">
            <span class="speed-num mono" data-hud="speed">0</span>
            <span class="speed-unit">KM/H</span>
          </div>
        </div>
        <div class="speed-bar-track">
          <div class="speed-bar-fill" data-hud="speed-bar"></div>
          <div class="speed-cap-tick" style="left:${roadCapPct}%"></div>
        </div>
        <div class="boost-row">
          <span class="boost-label">BOOST</span>
          <div class="boost-bar-track">
            <div class="boost-bar-fill" data-hud="boost-bar"></div>
          </div>
          <span class="boost-pct mono" data-hud="boost-pct">100%</span>
        </div>
      </div>

      <div class="touch-controls" data-hud="touch-controls" aria-label="Touch driving controls">
        <div class="touch-group touch-steer">
          <button type="button" class="touch-btn steer-btn" data-touch="left" aria-label="Steer Left">&larr;</button>
          <button type="button" class="touch-btn steer-btn" data-touch="right" aria-label="Steer Right">&rarr;</button>
        </div>
        <div class="touch-group touch-pedals">
          <button type="button" class="touch-btn boost-btn" data-touch="boost" aria-label="Boost">BOOST</button>
          <button type="button" class="touch-btn brake-btn" data-touch="brake" aria-label="Brake">BRK</button>
          <button type="button" class="touch-btn gas-btn" data-touch="throttle" aria-label="Accelerate">GAS</button>
        </div>
      </div>
    `;

    this.speedFxEl = container.querySelector('[data-hud="speed-fx"]') as HTMLElement;
    this.speedValueEl = container.querySelector('[data-hud="speed"]') as HTMLElement;
    this.speedBarFillEl = container.querySelector('[data-hud="speed-bar"]') as HTMLElement;
    this.boostBarFillEl = container.querySelector('[data-hud="boost-bar"]') as HTMLElement;
    this.boostPctEl = container.querySelector('[data-hud="boost-pct"]') as HTMLElement;
    this.gearEl = container.querySelector('[data-hud="gear"]') as HTMLElement;
    this.positionEl = container.querySelector('[data-hud="position"]') as HTMLElement;
    this.lapNumberEl = container.querySelector('[data-hud="lap-number"]') as HTMLElement;
    this.raceTimeEl = container.querySelector('[data-hud="race-time"]') as HTMLElement;
    this.currentTimeEl = container.querySelector('[data-hud="current-lap"]') as HTMLElement;
    this.lastTimeEl = container.querySelector('[data-hud="last-lap"]') as HTMLElement;
    this.bestTimeEl = container.querySelector('[data-hud="best-lap"]') as HTMLElement;
    this.offRoadBannerEl = container.querySelector('[data-hud="offroad-banner"]') as HTMLElement;
    this.demoBannerEl = container.querySelector('[data-hud="demo-banner"]') as HTMLElement;
    this.demoButtonEl = container.querySelector('[data-action="demo"]') as HTMLButtonElement;
    this.countdownOverlayEl = container.querySelector('[data-hud="countdown"]') as HTMLElement;
    this.countdownTextEl = container.querySelector('[data-hud="countdown-text"]') as HTMLElement;
    this.startLightEls = Array.from(container.querySelectorAll('[data-light]'));
    this.resultsOverlayEl = container.querySelector('[data-hud="results-overlay"]') as HTMLElement;
    this.resultsHeadingEl = container.querySelector('[data-hud="results-heading"]') as HTMLElement;
    this.resultsBodyEl = container.querySelector('[data-hud="results-body"]') as HTMLElement;
    this.ghostDotEl = container.querySelector('[data-hud="ghost-dot"]') as SVGCircleElement;
    this.mapDotEls = initialRace.racers.map(
      (_, idx) => container.querySelector(`[data-racer-dot="${idx}"]`) as SVGCircleElement,
    );

    this.demoButtonEl.addEventListener('click', () => {
      this.demoButtonEl.blur();
      callbacks.onToggleDemo();
    });
    const resetBtn = container.querySelector('[data-action="reset"]') as HTMLButtonElement;
    resetBtn.addEventListener('click', () => {
      resetBtn.blur();
      callbacks.onNewRace();
    });
    const newRaceBtn = container.querySelector('[data-action="new-race"]') as HTMLButtonElement;
    newRaceBtn.addEventListener('click', () => {
      newRaceBtn.blur();
      callbacks.onNewRace();
    });

    // Wire multi-touch / pointer handlers for on-screen phone controls
    const touchButtons = container.querySelectorAll<HTMLButtonElement>('[data-touch]');
    touchButtons.forEach((btn) => {
      const control = btn.dataset.touch as TouchControlName;
      const setActive = (active: boolean): void => {
        btn.classList.toggle('pressed', active);
        callbacks.onTouchControl(control, active);
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        setActive(true);
      });
      const release = (): void => setActive(false);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
    });
  }

  update(race: RaceState, demoMode: boolean): void {
    const player = race.racers[race.playerIndex];
    const { car, lap } = player;

    const kmh = speedMetersPerSecToKmh(car.speed);
    this.speedValueEl.textContent = String(kmh);
    this.gearEl.textContent = computeDisplayGear(car.forwardSpeed);

    const speedPct = Math.min(100, (kmh / MAX_BOOST_SPEED_KMH) * 100);
    this.speedBarFillEl.style.width = `${speedPct.toFixed(1)}%`;
    this.speedBarFillEl.classList.toggle('offroad', car.offRoad);
    this.speedBarFillEl.classList.toggle('boosting', car.boosting && !car.offRoad);

    // Boost charge gauge (0..100%)
    const boostPct = Math.round(car.boostCharge * 100);
    this.boostBarFillEl.style.width = `${boostPct}%`;
    this.boostBarFillEl.classList.toggle('burning', car.boosting);
    this.boostBarFillEl.classList.toggle('empty', boostPct === 0);
    this.boostPctEl.textContent = `${boostPct}%`;

    // Smooth peripheral speed-rush vignette above 160 km/h and during boost
    const rush = Math.max(0, Math.min(1, (kmh - 155) / (MAX_BOOST_SPEED_KMH - 155)));
    const fxOpacity = rush * (car.boosting && !car.offRoad ? 0.85 : 0.45);
    this.speedFxEl.style.opacity = fxOpacity.toFixed(3);

    this.positionEl.textContent = formatPosition(player.position, race.racers.length);
    const displayLap = Math.min(lap.currentLapNumber, race.totalLaps);
    this.lapNumberEl.textContent = `${displayLap} / ${race.totalLaps}`;

    const displayRaceTime = player.finishTime ?? race.raceTime;
    this.raceTimeEl.textContent = formatLapTime(displayRaceTime);
    this.currentTimeEl.textContent = formatLapTime(lap.currentLapTime);
    this.lastTimeEl.textContent = formatLapTime(lap.lastLapTime);
    this.bestTimeEl.textContent = formatLapTime(player.bestLapTime);

    this.offRoadBannerEl.classList.toggle('hidden', !car.offRoad || race.phase === 'finished');
    this.demoBannerEl.classList.toggle('hidden', !demoMode || race.phase === 'finished');
    this.demoButtonEl.classList.toggle('active', demoMode);
    this.demoButtonEl.textContent = demoMode ? 'Demo: ON (M)' : 'Demo (M)';

    // Countdown overlay (3, 2, 1, GO!)
    const countdownLabel = getCountdownLabel(race);
    this.countdownOverlayEl.classList.toggle('hidden', countdownLabel === null);
    if (countdownLabel !== null) {
      this.countdownTextEl.textContent = countdownLabel === 'GO' ? 'GO!' : countdownLabel;
      this.countdownTextEl.classList.toggle('go', countdownLabel === 'GO');
      const litCount = getStartLightCount(race);
      for (let i = 0; i < this.startLightEls.length; i++) {
        const lamp = this.startLightEls[i];
        lamp.classList.toggle('red', race.phase === 'countdown' && i < litCount);
        lamp.classList.toggle('green', countdownLabel === 'GO');
      }
    }

    // Update all 4 minimap dots + see-through ghost dot
    for (let i = 0; i < race.racers.length; i++) {
      const r = race.racers[i];
      const dot = this.mapDotEls[i];
      if (!dot) continue;
      dot.setAttribute('cx', (r.car.x * this.mapScale + this.mapOffsetX).toFixed(1));
      dot.setAttribute('cy', (r.car.z * this.mapScale + this.mapOffsetZ).toFixed(1));
    }

    if (race.ghostPose) {
      this.ghostDotEl.classList.remove('hidden');
      this.ghostDotEl.setAttribute(
        'cx',
        (race.ghostPose.x * this.mapScale + this.mapOffsetX).toFixed(1),
      );
      this.ghostDotEl.setAttribute(
        'cy',
        (race.ghostPose.z * this.mapScale + this.mapOffsetZ).toFixed(1),
      );
    } else {
      this.ghostDotEl.classList.add('hidden');
    }

    // Results table overlay when player finishes lap 3
    const showResults = race.phase === 'finished';
    this.resultsOverlayEl.classList.toggle('hidden', !showResults);
    if (showResults) {
      const sig = race.standings
        .map((idx) => {
          const r = race.racers[idx];
          return `${r.config.id}:${r.finished ? r.finishTime?.toFixed(3) : 'run'}:${r.bestLapTime?.toFixed(3) ?? ''}`;
        })
        .join('|');
      if (sig !== this.lastResultsSignature) {
        this.lastResultsSignature = sig;
        this.resultsHeadingEl.textContent = `RACE FINISH — P${player.position}`;
        this.resultsBodyEl.innerHTML = race.standings
          .map((idx, rank) => {
            const r = race.racers[idx];
            const rowClass = r.config.isPlayer ? 'player-row' : '';
            const timeCell = r.finished
              ? `<span class="mono">${formatLapTime(r.finishTime)}</span>`
              : '<span class="on-track-pill">On track</span>';
            return `
              <tr class="${rowClass}">
                <td class="pos-col mono">${rank + 1}</td>
                <td class="driver-col">
                  <span class="swatch" style="background:${r.config.color}"></span>
                  <span>${r.config.name}</span>
                </td>
                <td class="num">${timeCell}</td>
                <td class="num mono">${formatLapTime(r.bestLapTime)}</td>
              </tr>
            `;
          })
          .join('');
      }
    } else {
      this.lastResultsSignature = '';
    }
  }
}
