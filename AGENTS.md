# Solaris Circuit — Vespera GT-7

A browser-based 3D racing game featuring an original grand touring race car (**Vespera GT-7**) on a 12-point closed circuit (**Solaris Circuit**), built with a strictly decoupled deterministic simulation engine and Three.js renderer.

## Commands

run: npm run dev
test: npm test
coverage: npm run coverage
lap: npm run -s lap
race: npm run -s race

## Stack

- **Language & Build**: TypeScript 5 + Vite 6
- **3D Rendering**: Three.js (installed as an npm dependency) + custom `.glb` 3D assets modeled in Blender
- **Testing & Coverage**: Vitest + `@vitest/coverage-v8`
- **Headless Runner**: Node.js (`tsx` / compiled ESM) executing the exact same `src/sim/` engine as the browser

## Architecture

The simulation rules and physics are kept completely separate from browser and 3D rendering code:

```
src/
  sim/               # Pure, deterministic simulation (zero DOM / Three.js imports)
    constants.ts     # Circuit waypoints A-L, speed limits (216 / 72 km/h), fixed dt, physics params
    types.ts         # Plain data structures for track, car, input, lap, and simulation state
    track.ts         # Closed centripetal Catmull-Rom spline, arc-length LUT, projection & gates
    car.ts           # Fixed-step 2D planar vehicle dynamics (grip-limited cornering, slip, off-road cap)
    lap.ts           # Ordered 12-point checkpoint progression & directional start-line crossing
    driver.ts        # Deterministic built-in autopilot (curvature speed profile + lookahead steering)
    engine.ts        # Fixed-timestep clock accumulator and simulation step orchestrator
  cli/
    lap.ts           # Headless CLI runner for the `lap:` command (prints single deterministic JSON line)
  render/            # Three.js 3D presentation layer
    scene.ts         # Sky dome, golden-hour lighting, directional shadows, fog
    trackMesh.ts     # 12 m procedural road, curbs, checkered start line, grass & gravel terrain
    scenery.ts       # Speed-cue props (distance boards, chevrons, light poles) + Blender glTF props
    carMesh.ts       # Blender Vespera GT-7 glTF rig (wheel spin, steering, body roll, dust/skid fx)
    camera.ts        # Behind-and-above chase camera with corner lookahead and speed-reactive FOV
  ui/                # Browser shell
    hud.ts           # Telemetry HUD (km/h, lap, current/last/best times, off-road & demo badges, minimap)
    input.ts         # Keyboard input (WASD / Arrows, M demo toggle, one-key player takeover, R reset)
    main.ts          # Browser bootstrap connecting FixedClock, simulation, renderer, and HUD
public/
  models/            # Original glTF (.glb) assets exported from Blender
tests/               # Vitest unit and integration tests for physics, track, laps, clock, driver & CLI
docs/
  demo/              # Real browser WebM lap recording and 3 extracted stills
```

## Controls

- `W` / `Up Arrow` — Accelerate
- `S` / `Down Arrow` — Brake (hold when stopped to reverse)
- `A` / `D` or `Left` / `Right Arrow` — Steer
- `M` — Toggle Demo Mode (autopilot)
- Any driving key (`W`/`A`/`S`/`D` or Arrow keys) — Immediately take back control from Demo Mode
- `R` — Reset car to the start line
