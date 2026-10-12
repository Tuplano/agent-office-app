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
- **The room is the app's own**: where it differs from the prototype it is on purpose. The late afternoon turns orange from 15:00, night falls by 19:15, and the lamps come on at 17:30 and light the room warm until morning. Each window has its own view (`outside.ts`). The cat sits, roams, sleeps and gets the zoomies (`cat.ts`). The desks are bare until someone sits at one: a worker at the long tables brings their own laptop in under their arm, leaves it on the desk while they are in, and takes it out with them (`laptopOf` in `figures.ts`). The parity tests borrow the prototype's light and leave out the pixels where the two empty rooms differ, and where a laptop is being carried, so they still compare the people.

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

Status: done, except that the hover link, the tag-to-card scroll and the theme button have been checked in tests and by reading, not by hand in the window.

- [x] `Header`: title, summary line, theme button (prototype `renderSummary`, 1553–1568). Keep the window-title counts ("(2 waiting) Agent Office"); they are set on the Tauri window itself, which needs the `core:window:allow-set-title` permission.
- [x] `SessionList` and `SessionCard` (prototype `renderLabels`, 1516–1549): name, short path, status line, staff list, meta line.
- [x] `useTheme()`: saved choice, else the system's, applied before first paint by `public/theme.js`, a file rather than an inline script so a content security policy can allow it (prototype 7–19 and 1753–1777).
- [x] Hover link between a card and its name tag, and click-a-tag-to-scroll-to-card.
- [x] Empty state and the lost-connection message.
- [x] Move the remaining CSS over (prototype 21–72, 105–133) and keep the side-by-side layout rule.
- [x] Move `ago`, `shortPath`, `plural` into `src/lib/format.ts` with tests. The lines of text built from a session live beside them in `src/lib/describe.ts`.

**Done when** the app matches the prototype feature for feature and the prototype's `index.html` is no longer needed.

## Phase 5: Simulation fixes and tests

Status: done and tested by feeding the simulation state sequences (`tests/sim.test.ts`, `tests/floor.test.ts`), with every frame checked for people appearing, vanishing or jumping anywhere but the door; none of it has been looked at by hand in the window.

Improvements that were pending on the prototype, done here where they can be tested.

- [x] **Everyone uses the door.** Ended sessions walk out before their desk is removed. New sessions already walk in from the door (the prototype gained that, and Phase 3 ported it); today a worker whose session ends just vanishes.
- [x] A removed session's supervisor and interns walk out too instead of vanishing (`removeDesk`, 1509).
- [x] On first load, people already in session start in place; only arrivals after load use the door.
- [x] Decide what an 11th session looks like: it sits and works somewhere else in the room (a free lounge seat, else a cushion on the open floor beside the lounge), arrives and leaves by the door like anyone, and walks to the first chair that frees up, the one who has waited longest first. With nowhere left at all it still gets a card and no figure.
- [x] Vitest for `floor.ts`: `route` finds a path, returns empty when walled in, `findSpot` never returns a blocked or taken cell.
- [x] Vitest for `sim.ts` by feeding it state sequences: arrive, go idle, come back, supervisor replaced within the grace period, session ends mid-walk.
- [x] Respect `prefers-reduced-motion` everywhere the prototype does.

**Done when** the tests pass and no figure ever appears or disappears anywhere but the door.

## Phase 6: Desktop features

Status: done in code, built and unit-tested (`alerts.rs`, `tray.rs`, `lib.rs`), but none of it has been tried by hand in a running window: the tray menu, close-to-tray, the second launch, the notification pop-up and the dev window under the new policy are all unseen. Windows and macOS are untested; only Linux was built. On Wayland a window cannot be placed by the app, so only its size, not its position, is restored there. "Launch at login" was never switched on here.
Two additions to the brief: the single-instance plugin, so a second launch shows the first window, and a start with `--hidden` (what launch at login passes), which stays in the tray. The window is created hidden in `tauri.conf.json` and shown in `setup`, so a hidden start never flashes. The opener plugin is gone: nothing called it. The notification, autostart, window-state and single-instance plugins are used from Rust only, so none has a JS package or a capability entry.

```bash
npm run tauri add notification
npm run tauri add autostart
npm run tauri add window-state
npm run tauri add single-instance
```

- [x] Tray icon (`tray-icon` feature on the `tauri` crate) with Show, Launch at login and Quit; the icon marks when someone is waiting.
- [x] Closing the window hides to the tray; the collectors keep running.
- [x] A notification when a session changes to waiting, naming the session and what it waits for. One per change, none on startup.
- [x] Remember window size and position.
- [x] Set a real content security policy in `tauri.conf.json` (it is `null` now) and trim `capabilities/default.json` to what is used. Remove `tauri-plugin-opener` if nothing calls it.

**Done when** the app is useful while its window is closed.

## Phase 7: Demo feed and the hosted page

Status: built, not yet live. Left for you: push `main`, turn on Pages (repository Settings, Pages, Source: "GitHub Actions"), then link to the page from the portfolio. The workflow is `.github/workflows/demo.yml`.

- [x] `src/data/demo-source.ts`: a scripted loop of sessions starting, working, spawning interns, waiting, idling and ending, on the same interface as the other sources.
- [x] Choose the source at build time (`VITE_DATA_SOURCE=demo`), and fall back to the demo when the page is not running inside Tauri.
- [x] A static web build with a "this is a demo" line and a download button.
- [ ] Deploy it with the portfolio.

**Done when** a visitor with nothing installed sees the office alive at a URL.

## Phase 8: Release

Status: built and checked on Linux only. Done here: the icon (`scripts/icon.mjs`, drawn from the app's own palette), the updater (`update.rs`, release builds only, signed), single-instance in release builds only, `.github/workflows/release.yml` and `check.yml`, the README, and a real `npm run tauri build` that produced the .deb, .rpm and AppImage with their signatures. Installing the .deb and running it is left to you, and nothing built has been launched. Installers are unsigned for now (no Apple or Windows certificate); the README documents the warnings, and macOS builds are ad-hoc signed so that Apple Silicon will open them after "Open Anyway". Left for you: add the repository secret `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only if the key has a password; the current one has none), push a `vX.Y.Z` tag, publish the draft release, and test on Windows and macOS. None of the workflows has run yet.

- [x] App icon: `npm run tauri icon path/to/icon.png`.
- [x] `npm run tauri build` locally. (Installing the `.deb` and running it outside the dev environment is still to do.)
- [ ] GitHub Actions with `tauri-apps/tauri-action` building Linux, macOS and Windows on a version tag. (Written in `release.yml`, not yet run.)
- [ ] Test on Windows and macOS: session discovery, project-folder lookup, memory readout, tray.
- [x] Decide on code signing (Apple Developer account, Windows certificate) or document the unsigned-install warnings. Decision: unsigned for now, warnings documented in the README.
- [x] Auto-update: `npm run tauri add updater`, signing keys, release feed. (The feed is `latest.json` on the latest release; untried until a first release exists.)
- [x] README: what it reads, what it never reads, how to install.

**Done when** a tagged commit produces installers for all three systems.

## The customizable room (Phases 9 to 15)

Status: Phases 9, 10, 11 and 13 done. Branch `feature/customizable-rooms`.

The user can rearrange the furniture, recolour the room, resize it and move its door and windows, or start from a ready-made room, all in an edit mode on the canvas. Decisions made:

- **The room is data.** One `Room` value holds the size, the finishes, what hangs on the walls and a list of placed pieces (`kind`, `x`, `y`, quarter turns, colour). Everything else is worked out from it: the picture, the blocked floor, the seats, the play spots, the hangouts, the door. Today `office.ts` and `layout.ts` say the same things twice and are kept in step by hand; that ends.
- **The default room is today's room, pixel for pixel.** The prototype parity tests keep running against it and only it.
- **Editing is on the canvas**: pick a piece, drag it over the floor, turn it, delete it, add one from a palette.
- **Any number of desks, including none.** Sessions without a chair use the overflow that exists: a lounge seat, a cushion on the floor, and with nowhere at all a card and no figure.
- **Saved in `localStorage`**, like the camera, so it works the same in the app and on the demo page. Checked with a Zod schema when read; anything that fails falls back to the default room.
- **Pieces snap to the walking grid** (4 units), so the blocked floor always matches what is drawn.
- **Colours come from swatches**, not a free colour picker, so the room keeps its look at every hour of the day.
- **While editing, the people hold still.** After each change they are put straight where they now belong, as on a first load; the door is for when the room is not being rebuilt around them.
- **Furniture can come from 3D tools, and is still drawn as blocks.** A model made in Blender or MagicaVoxel is turned into coloured boxes once, when it is imported, and from then on the pixel engine draws it like any built-in piece: same camera, same light by the hour, same hard edges. The engine is not swapped for WebGL, and the built-in pieces stay written as code so the default room keeps its pixels. Looked at and turned down: sprite images, which would pin the camera to four views and lose the depth buffer, and a Three.js renderer, which would replace the drawing code and the picture tests and change the look.
- **Imported pieces stand still.** What moves on its own (the people, the cat, the ping-pong ball, the arcade screen, the coffee machine light, the door, the clocks' digits) stays in code.

### Phase 9: The room as data

Status: done. No visible change. The biggest phase, and the one everything else stands on.

- [x] Golden pictures first (`tests/golden.test.ts`): the empty office from six views at five hours, the office with everyone in, and a morning of arrivals, recorded from the code as it was. The refactor kept every pixel.
- [x] `src/engine/room.ts`: the `Room` type, its Zod schema, and `DEFAULT_ROOM`.
- [x] `src/engine/pieces.ts`: one definition per kind of piece that stands on the floor, in its own coordinates: how it is drawn, the floor it blocks, the seats, play spots and hangouts it offers, and what moves on it each frame (the arcade screen, the coffee machine light, the ping-pong ball). Kinds: long table with four chairs, cafe counter, island with stools, planter, phone booth, sofa, bean bag, low table, floor lamp, ping-pong table, arcade cabinet, tree, bush, grass, the lounge rug and the two checkerboard floors.
- [x] `src/engine/place.ts`: a pen that draws a piece where it is placed and turned by quarter turns, as `bodyFrame` already does for people, and one for a piece on any of the four walls.
- [x] `src/engine/walls.ts`: what hangs on the walls as data too: the door, windows, clocks, mural, mood board, shelves, neon sign, banners.
- [x] `layoutOf(room)` gives the seats, play spots, hangouts, footprints, door, spare floor and cat naps. `sim.ts`, `figures.ts`, `draw.ts`, `cat.ts` and `floor.ts` read them from the scene; the module-level `SEATS`, `PLAY`, `HANGOUTS`, `FOOTPRINTS`, `DOOR` are gone.
- [x] The room's size has left `constants.ts` (`W`, `D`, `GRID`): walls, floor, the walking grid and the camera's centre take it from the room, and the starting zoom fits whatever size it is.

Two things the default room's list of pieces has to keep, both checked by tests:

- **Its order is the order of drawing and of numbering.** Chairs fill a table at a time in turn, facing the starting view first; games come before places to flop; supervisors' hangouts are numbered as the pieces come. The prototype comparison holds the default room to the prototype's numbers, which is why the counter and the floor lamp sit where they do in the list.
- **A piece of a kind nobody knows is left out**, in the picture and on the floor, and is not an error.

**Done when** the golden pictures and both parity tests pass untouched, and nothing about the room's contents is left in a module-level constant.

### Phase 10: A room that changes under people

Status: done. Still no editor; driven from tests.

- [x] `office.setRoom(room)`: checks it, rebuilds the floor and the layout, redraws, resettles everyone and saves it. A room with something wrong with it is turned down: what is wrong comes back as a list, each with the piece it is about, and nothing changes.
- [x] Resettling (`sim.setRoom`): every chair, lounge seat, game and standing spot is given up and handed out again in the order sessions arrived; nobody walks. Whoever was on the way out is gone at once. The cat sits down where it is, or turns up at home when its floor is gone.
- [x] What makes a room sound (`src/engine/valid.ts`): pieces inside the walls, none standing on another (a rug may lie under anything but another rug), what hangs on a wall fitting on it and not over its neighbour, one door with the two cells inside it clear, and each side from 96 to 196 in steps of 4. A seat nobody can walk to is allowed; its worker is simply put there.
- [x] Somewhere to stand that has ended up in the furniture or through a wall (a hangout, a side of the ping-pong table, one of the cat's places) is not offered.
- [x] Load and save in `localStorage` (`src/engine/store.ts`), with a version of the saved shape; a room saved in another shape, or one that is not sound, is dropped for the default.
- [x] Tests: rooms with no desks, no lounge, nothing at all; a room swapped mid-walk, mid-game and while someone is leaving; a door on another wall; every frame still held to the rules in `tests/sim.test.ts`, which now also say that nobody is outside the walls and nobody stands in the furniture.

**Done when** any valid room can replace another at any moment without anyone ending up inside furniture or outside the walls.

### Phase 11: Edit mode: arranging the furniture

Status: done. What stands on the floor and what hangs on the walls can both be rearranged.

- [x] Finding what is under the pointer: a third buffer beside colour and depth that records which piece drew each pixel (`pieceAt`), and the floor point under the pointer worked back from the camera (`floorAt`).
- [x] Select, drag with snapping, turn, delete, duplicate. While a piece is held the room is drawn with it where it is held, washed red where it does not fit, and it goes back if let go there. Dragging empty floor still turns the camera; a click on nothing lets go of the piece picked out.
- [x] Every edit is a plain function from one `Room` to the next (`src/engine/edit.ts`), so undo and redo are a list of rooms, and the edits are tested without a canvas. `src/engine/editor.ts` ties them to the pointer, the keys, the people and the saved room, and takes a change only when the room is still sound.
- [x] While editing, the people hold still: everyone is put in place when it starts and after each change, arrivals are simply there, and the cat sits.
- [x] React around it: an Edit room button in the header, which becomes Undo, Redo, Reset and Done; the side panel shows the piece picked out, the palette and a list of what is in the room in place of the session cards. The name tags are hidden while editing.
- [x] Keyboard: arrows move the selected piece the way they point on the screen, R turns it, Delete removes it, Escape lets go, Ctrl+Z and Ctrl+Shift+Z undo and redo. The palette and the list of pieces are real buttons, so a piece can be picked without the pointer.
- [x] One new piece: a table for two, since four-seat tables are coarse to arrange with (the default room has no floor left for a third long one).
- [x] A rug may not lie over another rug, so that adding one never hides it under the last.
- [x] What hangs on the walls is edited the same way, brought forward from Phase 13: the door, windows, clocks, shelves and wall art are picked with a click, slide along their wall, and go onto another wall when dragged over it or turned (a turn takes one round to the next wall). They can be added from the palette, copied and deleted; a new one goes on a wall that can be seen. There is one door, which cannot be deleted or copied, and moving it moves where everyone comes in.

**Done when** the default room can be taken apart and rebuilt differently by hand, it survives a restart, and the people sit in it sensibly.

### Phase 12: Colours and finishes

- [ ] Finishes in the `Room`: walls, the two floor tones, trim.
- [ ] A colour per piece where it has an obvious one: the sofa, the chairs, the table tops, the bean bags, the ping-pong table.
- [ ] Swatches in the edit panel for the selected piece and for the room; a few whole themes that set everything at once.

**Done when** two rooms with the same furniture can look unmistakably different, by day and by lamp light.

### Phase 13: Room size and shell

Status: done.

- [x] Width and depth from 96 to 196, which is about 0.7 to 1.4 times today's, changed a step of 8 at a time from the edit panel. The east and south walls move, and everything keeps its distance from the north-west corner. A wall will not come in past what stands in its way: the room stays as it is and the panel names the piece. What hangs on a wall that gets shorter slides back onto it.
- [x] The door, windows, clocks and wall art slide along their wall and move between walls in edit mode. Moving the door moves where everyone comes in. (Done with Phase 11.)
- [x] The cat's naps and the supervisors' hangouts follow the furniture they belong to: the cat sleeps in a floor lamp's light, beside a planter, under a window and on the floor by the door, wherever those are, and only its home is the room's own; that keeps its distance from the south and east walls when they move.

**Done when** a small room with the door on another wall works as well as the default.

### Phase 14: Ready-made rooms

- [ ] Three or four rooms made with the editor itself and saved as data: the default, all desks, mostly lounge, empty.
- [ ] A "Start from" list in the edit panel. Choosing one replaces the room and can be undone.
- [ ] Copy the room out as JSON and paste one in, which is also how the ready-made rooms get written.
- [ ] README and the demo page: say the room can be changed, and show it.

**Done when** someone who never opens the palette can still have a room that is not the default.

### Phase 15: Furniture from 3D tools

Chairs, tables, desktops, plants, anything that stands still. The user makes it in a 3D tool, drops the file on the app in edit mode, and it joins the palette.

- [ ] Reading a model: `.glb` (Blender and most other tools) and `.vox` (MagicaVoxel). The GLB reader is loaded only when someone imports, and is used for reading alone; nothing is drawn with it.
- [ ] Turning it into blocks: half-unit cubes, which is one pixel at the home zoom, each taking the colour of the material or texture it lies on; the colours are cut down to a handful, and neighbours of one colour are merged into boxes. Limits of about 64 by 64 units of floor, 40 high and a few hundred boxes; a model past them is scaled down, or refused with the reason.
- [ ] A kind of piece drawn from a list of boxes, beside the kinds drawn by code. It is the same `FloorKind` to everything else, so `place.ts` turns it, `layoutOf(room)` reads its seats and the edit mode moves it with no special case.
- [ ] The import form, with a preview that can be turned: name, scale (GLB is in metres, so it starts at the size a metre is for the people in the room), which way is its front, whether it blocks the floor (its size snapped to the walking grid) or lies flat like a rug, and the height of its top.
- [ ] Seat markers: click where someone sits, turn the arrow the way they look, set the height; a ghost figure sits there in the preview. It starts with one in the middle facing the front for a model the size of a chair, and a node named `seat` in the file sets one with no clicking. A sofa has several.
- [ ] Chairs and tables pair up by where they stand, in `layoutOf(room)`: a seat with a top in the cell in front of it is a desk seat, and its worker's laptop goes on that top; a seat with nothing in front is somewhere to rest. The built-in long table keeps its four chairs as one piece.
- [ ] Imported kinds are saved in `localStorage` beside the room, checked with a Zod schema. A room copied out as JSON carries the kinds it uses; a piece whose kind is missing is left out, not an error.
- [ ] In the palette, imported pieces sit with the built-in ones and can be renamed or deleted; deleting one that is in the room asks first.
- [ ] Tests: the converter on small made-up models (a cube, an L, two colours, one too big), a turned piece's seats, and the pairing rule.

**Done when** a chair and a table made in Blender can be imported and placed, a worker sits at them with a laptop on the table, and they look like part of the room at every hour.

## Order and checkpoints

Phases 1 to 4 are the bulk of the work and depend on each other in order. Phases 6, 7
and 8 are independent of each other. Phases 9, 10 and 11 depend on each other in order;
12, 13, 14 and 15 each need 11 and are independent of each other.

Commit at the end of every phase. From Phase 3 on, the prototype can be opened in a
browser on its own for a side-by-side look, but the app never connects to it.
