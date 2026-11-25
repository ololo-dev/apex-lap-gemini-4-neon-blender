# Apex Lap — Gemini 4 Neon with Blender

A 3D racing game built by **Gemini 4 Neon** (high, in the Antigravity CLI)
**with Blender** in one [ololo](https://ololo.dev) session of the Apex Lap
project: three timed rounds (drive a lap, race the rivals, make it feel
fast), scored by a panel of judges. The car (Vespera GT-7), the start
gantry, the grandstand and the pine trees were modelled in Blender over its
MCP server and exported as glTF into `public/models/`.

- Play it: https://ololo-dev.github.io/apex-lap-gemini-4-neon-blender/
- Session: `TY4ODX`, 557 points
- The code is as the agent left it at the end of the session; only this
  top section of the README, the `.gitignore` and the Pages workflow were
  added afterwards. The workflow rewrites the game's `/models/...` requests
  to relative ones after the build, because on Pages the game lives under
  `/apex-lap-gemini-4-neon-blender/`.

How to run and test it locally is in [AGENTS.md](AGENTS.md). The agent's
own README follows.

---

# Solaris Circuit — Vespera GT-7

A 3D browser racing game: one original car (**Vespera GT-7**), one 12-point circuit (**Solaris Circuit**), a behind-the-car chase camera, fixed-timestep physics, deterministic autopilot, and lap timing against the clock.

## Commands

run: npm run dev
test: npm test
coverage: npm run coverage
lap: npm run -s lap
race: npm run -s race

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Append `?demo=1` to launch directly in Demo Mode.

## Stack & Layout

- **TypeScript + Vite + Three.js + Vitest**
- `src/sim/`: Pure deterministic simulation engine (circuit spline, car dynamics, lap/checkpoint referee, fixed-timestep clock, built-in autopilot) — zero browser or Three.js dependencies.
- `src/cli/lap.ts`: Headless one-lap runner sharing `src/sim/` directly.
- `src/render/`: Three.js 3D scene, procedural road/terrain, chase camera, and Blender-modeled `.glb` car and scenery assets in `public/models/`.
- `src/ui/`: Telemetry HUD, minimap, keyboard input, and browser entry point.
- `tests/`: Automated unit and integration tests covering driving physics, off-road cap, lap rules, fixed-timestep invariance, autopilot, and CLI determinism.
- `docs/demo/`: Browser WebM recording (`lap.webm`) and three stills (`start-line.png`, `mid-corner.png`, `after-lap.png`).

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Accelerate (up to 216 km/h on road, 72 km/h off road) |
| `S` / `↓` | Brake / hold to reverse |
| `A` / `D` or `←` / `→` | Steer (only while moving) |
| `M` | Toggle Demo Mode (press any driving key to take over immediately) |
| `R` | Reset to start line |
