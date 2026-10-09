# Agent Office app: build plan

Porting the prototype in `../agent-office` (one `server.js`, one `public/index.html`)
into this Tauri 2 + React + TypeScript app. The prototype stays untouched as the
working reference; line numbers below refer to its files.

## Decisions already made

- **Shell**: Tauri 2. The Rust side reads `~/.claude`; there is no HTTP server in the final app.
- **Standalone from the start**: the app never connects to the prototype's server, in development or in a build. The prototype is read as a porting reference only.
- **Frontend**: React 19 + TypeScript + Vite, TanStack Query for the session state. No router while there is one screen.
- **Engine outside React**: the voxel renderer and simulation are plain TypeScript behind `createOffice()`. React mounts the canvas and never re-renders per frame.
- **One state contract**: a Zod schema in `src/shared/state.ts`, mirrored by Rust structs. Change both together.
- **Privacy rule carried over**: metadata only, never transcript text.
- **The light is the app's own**: unlike the prototype, the late afternoon turns orange from 15:00, night falls by 19:15 with more stars, and the lamps come on at 17:30 and light the room warm until morning. The parity tests borrow the prototype's light so they still compare the drawing.

## Phase 0: Baseline

Status: done.

- [x] Make the first commit of the untouched scaffold.
- [x] In `src-tauri/tauri.conf.json`, set `productName` and the window `title` to "Agent Office" and the window to about 1280 × 800 with a minimum of 900 × 560.
- [x] Fill in `description` and `authors` in `src-tauri/Cargo.toml`.
- [x] Delete the starter content in `src/App.tsx`, `src/App.css` and `src/assets`.
- [x] Add `"test": "vitest"` to the scripts in `package.json`.

**Done when** `npm run tauri dev` opens an empty window titled "Agent Office".

## Phase 1: Engine port, no data

Move the drawing code into `src/engine/` and get the empty office on screen.

Status: done, except pinch zoom, which has not been tried on a touch screen or trackpad.
`tests/prototype-parity.test.ts` checks the engine pixel for pixel against the prototype.
Two files beyond the table: `scene.ts` holds what one office instance owns, `index.ts` exports `createOffice`.
`apply` does nothing until the simulation arrives in Phase 2.

| Prototype `public/index.html` | New file |
|---|---|
| Palette and room constants, 175–224 | `palette.ts`, `constants.ts` |
| Seats, play spots, door, 226–246 | `layout.ts` |
| Daylight and colour toning, 293–362 | `light.ts` |
| Camera and projection, 368–402 | `camera.ts` |
| Rasterizer (`quad`, `makePen`), 404–478 | `raster.ts` |
| Floor grid and routing, 495–574 | `floor.ts` |
| `buildOffice`, 576–889 | `office.ts` |
| Figures, 891–1141 | `figures.ts` |
| Props, clocks, marks, `draw`, 1143–1270 | `draw.ts` |
| Drag, zoom, keyboard, 1599–1712 | `input.ts` |
| Render loop and relight timer, 1714–1751 | `loop.ts` |

- [x] Paste each section into its file, then add types until `tsc` passes.
- [x] Replace the script-level globals (`camera`, `view`, `light`, `layer`, `frame`, the buffers) with state owned by one `createOffice(canvas, tagsLayer)` instance that returns `{ apply, destroy }`.
- [x] Split the walk grid from the drawing: `office.ts` currently paints furniture and fills `blocked` in the same pass (`solid`, `block`). Produce the footprints as data in `layout.ts`, build the grid from that once, and let `office.ts` only draw.
- [x] Add `src/components/OfficeCanvas.tsx`: two refs, one `useEffect` that calls `createOffice` and returns `destroy`.
- [x] Carry over the canvas and stage CSS (prototype lines 73–103, 135–144).
- [x] Check in the Tauri window specifically: pixelated scaling, container-query sizing, drag, pinch and wheel zoom. Linux and macOS render with WebKit, not Chromium.

**Done when** the empty office draws, turns, zooms, resets on double-click, and follows the time of day.

## Phase 2: Rust collectors

Status: done. The transcript tail reader that sessions and agents share lives in `collectors/tail.rs`.

The app reads `~/.claude` itself. Port the logic of `server.js` into `src-tauri/src/`; the prototype's server is never run for this app. From inside `src-tauri/`:

```bash
cargo add sysinfo dirs
cargo add rusqlite --features bundled
```

- [x] Write `src/shared/state.ts`: Zod schemas for `Agent`, `Supervisor`, `Session` and `OfficeState`, matching the shape `server.js` builds (lines 274–292 and 331–334).
- [x] `state.rs`: serde structs matching `src/shared/state.ts` field for field (`#[serde(rename_all = "camelCase")]`).
- [x] `collectors/sessions.rs` (server.js 119–185, 258–307): read `sessions/<pid>.json`, keep live pids, find the project folder, name the session after its repo, read the current activity from the transcript tail.
- [x] `collectors/agents.rs` (187–230): subagent transcripts, the working/finished rules and their four time limits, the `.meta.json` label.
- [x] `collectors/observers.rs` (232–256, 295–306): the claude-mem link, opened read-only, with the 5-second retry; observers become supervisors and are never listed as sessions.
- [x] `collectors/processes.rs` (309–322): memory per pid and pid-alive through `sysinfo`, replacing `ps`.
- [x] Honour `CLAUDE_CONFIG_DIR` and `CLAUDE_MEM_DATA_DIR` as the prototype does.
- [x] Every read tolerates a missing file, a half-written line and an unknown field. A broken input drops that one item, never the whole state.
- [x] `lib.rs`: a background loop every second that builds the state and calls `app.emit("state", &state)` only when it changed; a `get_state` command for the first paint.
- [x] Write `src/data/source.ts`: an interface `subscribe(onState, onStatus)` returning an unsubscribe function.
- [x] `src/data/tauri-source.ts`: `listen('state', ...)` then `invoke('get_state')`, so no change falls between the two; parsed through the Zod schema.
- [x] Add `useOfficeFeed()`, mounted once in `App`, which subscribes and writes into the TanStack Query cache, and `useOfficeState()`, which reads `state` and `connected` from it.
- [x] Rust unit tests for the tail parser and the working/finished rules, using small fixture files.
- [x] `tests/fixtures/office-state.json`, checked from both sides: Rust serializes to it and the Zod schema reads it.

**Done when** the frontend receives a schema-valid state for the real sessions on this machine, with nothing but this app running.

## Phase 3: People in the office

Status: done. `tests/sim-parity.test.ts` steps the prototype's page script and the engine through the same sessions and checks every frame: positions, name tags and pixels.

- [x] Port the simulation into `src/engine/sim.ts` (prototype `makeDesk` to `removeDesk`, `apply`, and the frame loop): desks, workers, supervisors, interns, the door queue.
- [x] Call `office.apply(state)` from `OfficeCanvas` whenever the state changes.

**Done when** every live session sits in the office doing what it is really doing.

## Phase 4: React around the canvas

- [ ] `Header`: title, summary line, theme button (prototype `renderSummary`, 1553–1568). Keep the window-title counts ("(2 waiting) Agent Office").
- [ ] `SessionList` and `SessionCard` (prototype `renderLabels`, 1516–1549): name, short path, status line, staff list, meta line.
- [ ] `useTheme()`: saved choice, else the system's, applied before first paint (prototype 7–19 and 1753–1777).
- [ ] Hover link between a card and its name tag, and click-a-tag-to-scroll-to-card.
- [ ] Empty state and the lost-connection message.
- [ ] Move the remaining CSS over (prototype 21–72, 105–133) and keep the side-by-side layout rule.
- [ ] Move `ago`, `shortPath`, `plural` into `src/lib/format.ts` with tests.

**Done when** the app matches the prototype feature for feature and the prototype's `index.html` is no longer needed.

## Phase 5: Simulation fixes and tests

Improvements that were pending on the prototype, done here where they can be tested.

- [ ] **Everyone uses the door.** Ended sessions walk out before their desk is removed. New sessions already walk in from the door (the prototype gained that, and Phase 3 ported it); today a worker whose session ends just vanishes.
- [ ] A removed session's supervisor and interns walk out too instead of vanishing (`removeDesk`, 1509).
- [ ] On first load, people already in session start in place; only arrivals after load use the door.
- [ ] Decide what an 11th session looks like: more seats, or a visible "standing room" spot. Today it gets a card and no figure.
- [ ] Vitest for `floor.ts`: `route` finds a path, returns empty when walled in, `findSpot` never returns a blocked or taken cell.
- [ ] Vitest for `sim.ts` by feeding it state sequences: arrive, go idle, come back, supervisor replaced within the grace period, session ends mid-walk.
- [ ] Respect `prefers-reduced-motion` everywhere the prototype does.

**Done when** the tests pass and no figure ever appears or disappears anywhere but the door.

## Phase 6: Desktop features

```bash
npm run tauri add notification
npm run tauri add autostart
npm run tauri add window-state
```

- [ ] Tray icon (`tray-icon` feature on the `tauri` crate) with Show, Launch at login and Quit; the icon marks when someone is waiting.
- [ ] Closing the window hides to the tray; the collectors keep running.
- [ ] A notification when a session changes to waiting, naming the session and what it waits for. One per change, none on startup.
- [ ] Remember window size and position.
- [ ] Set a real content security policy in `tauri.conf.json` (it is `null` now) and trim `capabilities/default.json` to what is used. Remove `tauri-plugin-opener` if nothing calls it.

**Done when** the app is useful while its window is closed.

## Phase 7: Demo feed and the hosted page

- [ ] `src/data/demo-source.ts`: a scripted loop of sessions starting, working, spawning interns, waiting, idling and ending, on the same interface as the other sources.
- [ ] Choose the source at build time (`VITE_DATA_SOURCE=demo`), and fall back to the demo when the page is not running inside Tauri.
- [ ] A static web build with a "this is a demo" line and a download button.
- [ ] Deploy it with the portfolio.

**Done when** a visitor with nothing installed sees the office alive at a URL.

## Phase 8: Release

- [ ] App icon: `npm run tauri icon path/to/icon.png`.
- [ ] `npm run tauri build` locally; install the `.deb` and run it outside the dev environment.
- [ ] GitHub Actions with `tauri-apps/tauri-action` building Linux, macOS and Windows on a version tag.
- [ ] Test on Windows and macOS: session discovery, project-folder lookup, memory readout, tray.
- [ ] Decide on code signing (Apple Developer account, Windows certificate) or document the unsigned-install warnings.
- [ ] Auto-update: `npm run tauri add updater`, signing keys, release feed.
- [ ] README: what it reads, what it never reads, how to install.

**Done when** a tagged commit produces installers for all three systems.

## Order and checkpoints

Phases 1 to 4 are the bulk of the work and depend on each other in order. Phases 6, 7
and 8 are independent of each other.

Commit at the end of every phase. From Phase 3 on, the prototype can be opened in a
browser on its own for a side-by-side look, but the app never connects to it.
