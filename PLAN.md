# Agent Office app: build plan

Porting the prototype in `../agent-office` (one `server.js`, one `public/index.html`)
into this Tauri 2 + React + TypeScript app. The prototype stays untouched as the
working reference; line numbers below refer to its files.

## Decisions already made

- **Shell**: Tauri 2. The Rust side reads `~/.claude`; there is no HTTP server in the final app.
- **Frontend**: React 19 + TypeScript + Vite, TanStack Query for the session state. No router while there is one screen.
- **Engine outside React**: the voxel renderer and simulation are plain TypeScript behind `createOffice()`. React mounts the canvas and never re-renders per frame.
- **One state contract**: a Zod schema in `src/shared/state.ts`, mirrored by Rust structs. Change both together.
- **Privacy rule carried over**: metadata only, never transcript text.

## Phase 0: Baseline

Status: done, not yet committed. The scaffold itself is in `e167300`.

- [x] Make the first commit of the untouched scaffold.
- [x] In `src-tauri/tauri.conf.json`, set `productName` and the window `title` to "Agent Office" and the window to about 1280 × 800 with a minimum of 900 × 560.
- [x] Fill in `description` and `authors` in `src-tauri/Cargo.toml`.
- [x] Delete the starter content in `src/App.tsx`, `src/App.css` and `src/assets`.
- [x] Add `"test": "vitest"` to the scripts in `package.json`.

**Done when** `npm run tauri dev` opens an empty window titled "Agent Office".

## Phase 1: Engine port, no data

Move the drawing code into `src/engine/` and get the empty office on screen.

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

- [ ] Paste each section into its file, then add types until `tsc` passes.
- [ ] Replace the script-level globals (`camera`, `view`, `light`, `layer`, `frame`, the buffers) with state owned by one `createOffice(canvas, tagsLayer)` instance that returns `{ apply, destroy }`.
- [ ] Split the walk grid from the drawing: `office.ts` currently paints furniture and fills `blocked` in the same pass (`solid`, `block`). Produce the footprints as data in `layout.ts`, build the grid from that once, and let `office.ts` only draw.
- [ ] Add `src/components/OfficeCanvas.tsx`: two refs, one `useEffect` that calls `createOffice` and returns `destroy`.
- [ ] Carry over the canvas and stage CSS (prototype lines 73–103, 135–144).
- [ ] Check in the Tauri window specifically: pixelated scaling, container-query sizing, drag, pinch and wheel zoom. Linux and macOS render with WebKit, not Chromium.

**Done when** the empty office draws, turns, zooms, resets on double-click, and follows the time of day.

## Phase 2: Live data from the prototype server

Borrow the old server so the frontend can be finished before any Rust is written.

- [ ] Write `src/shared/state.ts`: Zod schemas for `Agent`, `Supervisor`, `Session` and `OfficeState`, matching what `server.js` sends (lines 274–292 and 331–334).
- [ ] Write `src/data/source.ts`: an interface `subscribe(onState, onStatus)` returning an unsubscribe function.
- [ ] Write `src/data/sse-source.ts` on `EventSource('/events')`, parsing every message through the schema.
- [ ] Add the proxy in `vite.config.ts`: `server: { proxy: { '/events': 'http://127.0.0.1:4690' } }`.
- [ ] Add `useOfficeState()`: subscribes once and writes into the TanStack Query cache; exposes `state` and `connected`.
- [ ] Port the simulation into `src/engine/sim.ts` (prototype 1272–1514 and `apply`, 1570–1597): desks, workers, supervisors, interns, the door queue.
- [ ] Call `office.apply(state)` from `OfficeCanvas` whenever the state changes.

**Done when**, with `npm start` running in `../agent-office`, this window and the prototype in a browser show the same people doing the same things.

## Phase 3: React around the canvas

- [ ] `Header`: title, summary line, theme button (prototype `renderSummary`, 1553–1568). Keep the window-title counts ("(2 waiting) Agent Office").
- [ ] `SessionList` and `SessionCard` (prototype `renderLabels`, 1516–1549): name, short path, status line, staff list, meta line.
- [ ] `useTheme()`: saved choice, else the system's, applied before first paint (prototype 7–19 and 1753–1777).
- [ ] Hover link between a card and its name tag, and click-a-tag-to-scroll-to-card.
- [ ] Empty state and the lost-connection message.
- [ ] Move the remaining CSS over (prototype 21–72, 105–133) and keep the side-by-side layout rule.
- [ ] Move `ago`, `shortPath`, `plural` into `src/lib/format.ts` with tests.

**Done when** the app matches the prototype feature for feature and the prototype's `index.html` is no longer needed.

## Phase 4: Simulation fixes and tests

Improvements that were pending on the prototype, done here where they can be tested.

- [ ] **Everyone uses the door.** New sessions walk in from the door to their chair, and ended sessions walk out before their desk is removed. Today workers appear in the chair and vanish; the prototype's `desk.outside` flag (line 1264) is read but never set.
- [ ] A removed session's supervisor and interns walk out too instead of vanishing (`removeDesk`, 1509).
- [ ] On first load, people already in session start in place; only arrivals after load use the door.
- [ ] Decide what an 11th session looks like: more seats, or a visible "standing room" spot. Today it gets a card and no figure.
- [ ] Vitest for `floor.ts`: `route` finds a path, returns empty when walled in, `findSpot` never returns a blocked or taken cell.
- [ ] Vitest for `sim.ts` by feeding it state sequences: arrive, go idle, come back, supervisor replaced within the grace period, session ends mid-walk.
- [ ] Respect `prefers-reduced-motion` everywhere the prototype does.

**Done when** the tests pass and no figure ever appears or disappears anywhere but the door.

## Phase 5: Rust collectors

Port `server.js` into `src-tauri/src/`. From inside `src-tauri/`:

```bash
cargo add sysinfo dirs
cargo add rusqlite --features bundled
```

- [ ] `state.rs`: serde structs matching `src/shared/state.ts` field for field (`#[serde(rename_all = "camelCase")]`).
- [ ] `collectors/sessions.rs` (server.js 119–185, 258–307): read `sessions/<pid>.json`, keep live pids, find the project folder, name the session after its repo, read the current activity from the transcript tail.
- [ ] `collectors/agents.rs` (187–230): subagent transcripts, the working/finished rules and their four time limits, the `.meta.json` label.
- [ ] `collectors/observers.rs` (232–256, 295–306): the claude-mem link, opened read-only, with the 5-second retry; observers become supervisors and are never listed as sessions.
- [ ] `collectors/processes.rs` (309–322): memory per pid and pid-alive through `sysinfo`, replacing `ps`.
- [ ] Honour `CLAUDE_CONFIG_DIR` and `CLAUDE_MEM_DATA_DIR` as the prototype does.
- [ ] Every read tolerates a missing file, a half-written line and an unknown field. A broken input drops that one item, never the whole state.
- [ ] `lib.rs`: a background loop every second that builds the state and calls `app.emit("state", &state)` only when it changed; a `get_state` command for the first paint.
- [ ] `src/data/tauri-source.ts`: `invoke('get_state')` then `listen('state', ...)`, parsed through the same Zod schema.
- [ ] Switch the app to the Tauri source and remove the Vite proxy.
- [ ] Rust unit tests for the tail parser and the working/finished rules, using small fixture files.

**Done when** the app shows real sessions with `../agent-office` not running.

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

Phases 1 to 3 are the bulk of the work and depend on each other in order. Phase 4 can
wait until after Phase 5 if real data matters more than door behaviour. Phases 6, 7
and 8 are independent of each other.

Commit at the end of every phase. After Phase 2 the prototype and the app can be
compared side by side, so check parity before moving on from each later phase.
