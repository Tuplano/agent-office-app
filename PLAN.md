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

Status: Phases 9 to 15 done. Branch `feature/customizable-rooms`.

The user can rearrange the furniture, recolour the room, resize it and move its door and windows, or start from a ready-made room, all in an edit mode on the canvas. Decisions made:

- **The room is data.** One `Room` value holds the size, the finishes, what hangs on the walls and a list of placed pieces (`kind`, `x`, `y`, quarter turns, colour). Everything else is worked out from it: the picture, the blocked floor, the seats, the play spots, the hangouts, the door. Today `office.ts` and `layout.ts` say the same things twice and are kept in step by hand; that ends.
- **The default room is today's room, pixel for pixel.** The prototype parity tests keep running against it and only it.
- **Editing is on the canvas**: pick a piece, drag it over the floor, turn it, delete it, add one from a palette.
- **Any number of desks, including none.** Sessions without a chair use the overflow that exists: a lounge seat, then a cushion on the floor beside a lounge rug, then a cushion anywhere on the open floor, out from the middle of the room and apart from each other (`openFloor` in `sim.ts`). Whoever has no desk works on a laptop on their knees. So everyone has a figure, even in the empty room; a card and no figure is only for a room with no floor left. (At first a room with nowhere to sit showed a card and no figure; changed on 2026-10-13 at Kevin's asking.)
- **Saved in `localStorage`**, like the camera, so it works the same in the app and on the demo page. Checked with a Zod schema when read; anything that fails falls back to the default room.
- **Pieces snap to the walking grid** (4 units), so the blocked floor always matches what is drawn.
- **Colours are the user's to choose.** Any colour at all, from a picker, and a Random button that finishes the whole room in colours picked at random. There are no ready-made colours and no ready-made themes. (The first plan was swatches only; changed on 2026-10-12 at Kevin's asking.) The light of the hour is laid over whatever is chosen, so a room still darkens and warms as the day goes.
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

Added after Phase 15, at Kevin's asking (2026-10-13): the lists to add from show a small picture of each kind over its name (`src/engine/thumbs.ts`: drawn by the room's own pen, in the light of noon, once, and kept), and a kind can be dragged out of the list into the room (`carry`, `put` and `letGo` in `editor.ts`): it is shown where it would go while it is carried, in red where it will not fit, and put down where it is let go; what hangs goes on the wall under the pointer. A click still adds one to the middle of the room. Tested in `tests/edit.test.ts`; tried in the browser with drag events made by script, since a real drag with the mouse could not be driven from here.

Also added at Kevin's asking (2026-10-13): the ready-made rooms are no longer four buttons in the edit panel. Edit room opens them over the middle of the page, one at a time (`src/components/RoomChooser.tsx`), each drawn whole as it would look now with the sessions there are sitting in it (`drawRoom` in `src/engine/preview.ts`), with arrows and dots to go between them; after the last is a "+" for Customize your own room, which keeps the room there is. The panel keeps a "Ready-made rooms…" button that opens them again, and the box for copying a room out and pasting one in. The chooser opens every time Edit room is clicked.

### Phase 12: Colours and finishes

Status: done.

- [x] Finishes in the `Room` (`finish`, all of it optional): the walls, the two floor tones, the skirting, and the wood of the furniture (table tops, counters, shelves). A room that says nothing is drawn exactly as before; `src/engine/finish.ts` works out the rest, such as the shaded wall and the lighter and darker wood.
- [x] A colour per piece where it has an obvious one, kept in the piece's `tint`: the sofa, a table's chairs, the island's stools, the bean bags, the ping-pong table, the phone booth's glass, the checkerboard floors, the rug's patch, the plants' pots, a banner and the door. A piece can be put back as it comes; a table's chairs then go back to their mix of sage and olive.
- [x] In the edit panel, for the selected piece and for each part of the room's finish: a colour picker that takes any colour, starting from the one in use. A colour from the picker is taken when the picker is let go, not at every move within it, so one choice is one step to undo.
- [x] Random colours: one button that finishes the room in walls, floor, trim and wood picked at random (`randomFinish` in `finish.ts`): pale walls in some hue or now and then dark ones, a floor of wood or of stone, wood of some tone. A piece has a Random button of its own. As it comes puts the room's finish, or a piece, back.
- [x] Table tops are not a colour of their own: they follow the room's wood, so that a room's furniture stays of a piece.

**Done when** two rooms with the same furniture can look unmistakably different, by day and by lamp light.

### Phase 13: Room size and shell

Status: done.

- [x] Width and depth from 96 to 196, which is about 0.7 to 1.4 times today's, changed a step of 8 at a time from the edit panel. The east and south walls move, and everything keeps its distance from the north-west corner. A wall will not come in past what stands in its way: the room stays as it is and the panel names the piece. What hangs on a wall that gets shorter slides back onto it.
- [x] The door, windows, clocks and wall art slide along their wall and move between walls in edit mode. Moving the door moves where everyone comes in. (Done with Phase 11.)
- [x] The cat's naps and the supervisors' hangouts follow the furniture they belong to: the cat sleeps in a floor lamp's light, beside a planter, under a window and on the floor by the door, wherever those are, and only its home is the room's own; that keeps its distance from the south and east walls when they move.

**Done when** a small room with the door on another wall works as well as the default.

### Phase 14: Ready-made rooms

Status: done, except that the README says the room can be changed and does not show it: there is no picture of the rooms in it yet.

- [x] Four rooms saved as data in `src/engine/rooms.ts`: the default, all desks (six long tables, a chair for twenty-four), mostly lounge (three sofas, six bean bags, the cafe, the games and one table for two), and empty (the windows and the door). They share the default room's size and walls, stand on the grid as the editor would put them, and a test walks from the door to every seat in each.
- [x] A "Start from" list in the edit panel, under the piece picked out. Choosing one replaces the whole room, colours and size too, and is one step to undo. The one the room is now is marked, until the room is changed. Reset is starting from the default.
- [x] "Copy room" writes the room out as text, the same text it is saved as (`writeRoom` and `readRoom` in `store.ts`), onto the clipboard, or into the box in the panel where the clipboard cannot be reached. Text pasted into the box becomes the room with "Use this room", if it is a room the office can take; if not, the panel says why and nothing changes.
- [x] A pasted room is text from anywhere, so it is held to more than a saved one was: a piece's own measures are positive and at most two, nothing hangs higher than the wall, a kind is only one of those written down (not `constructor`), and the floor marks only its own cells however big a footprint is.
- [x] What was done in edit mode can still be undone after Done and Edit room again, so a room replaced by mistake is not lost while the app is open.
- [x] README and the demo page: both say the room can be changed. The demo page shows it by being editable, and its notice points at Edit room. The README has no picture.

**Done when** someone who never opens the palette can still have a room that is not the default.

### Phase 15: Furniture from 3D tools

Status: done and tested with model files the tests make themselves (`tests/models-made-up.ts`), and tried by hand in the browser with a chair, a table and a MagicaVoxel cactus. Not yet tried: a file exported by Blender itself, a model with a real texture in the window (the picture is opened by the browser, which the tests stand in for), dropping a file on the window (the file chooser was used), and any of it in the Tauri window.

Chairs, tables, desktops, plants, anything that stands still. The user makes it in a 3D tool, drops the file on the app in edit mode, and it joins the palette.

- [x] Reading a model: `.glb` (`src/import/glb.ts`, written here, no library) and `.vox` (`src/import/vox.ts`). The GLB reader and the triangle converter are in chunks of their own, fetched only when someone imports a `.glb`, and are used for reading alone. A GLB compressed with Draco or meshopt is turned down with the reason. Only the first model of a `.vox` is read.
- [x] Turning it into blocks (`src/import/mesh.ts`, `src/import/voxels.ts`): half-unit cubes, each the colour most of the triangle points in it had, from the material, the vertex colours or the texture; the colours are cut down to eight by median cut; what is shut in is marked as inside, and neighbours of one colour are merged into boxes that may run through it. Limits (`LIMITS` in `src/engine/models.ts`): 64 by 64 units of floor, 40 high, 400 boxes. A model too big starts at the size that fits; one of too many boxes is refused with the reason.
- [x] A kind of piece drawn from a list of boxes (`kindOf` in `src/engine/models.ts`), put into `FLOOR_KINDS` beside the kinds drawn by code. `place.ts` turns it, `layoutOf(room)` reads its seats and the edit mode moves it with no special case.
- [x] The import form (`src/components/ImportForm.tsx`), with a preview drawn by the room's own pen that can be turned (`src/engine/preview.ts`): name, size (a GLB comes in at 16 units to the metre, `METRE`), which way is its front, whether it blocks the floor (its box is whole cells) or lies flat like a rug, and whether it has a top and how high.
- [x] Seat markers: click on the model to sit someone down, turn them, raise or lower them, remove them; a pale figure sits there in the preview. It starts with one in the middle facing the front for a model the size of a chair, and an empty node whose name begins with `seat` sets one with no clicking. Up to eight.
- [x] Chairs and tables pair up by where they stand, in `layoutOf(room)`: a seat with a top where its sitter's laptop would go, 8 units in front, is a desk seat, and the laptop is drawn on that top at its height; a seat with nothing there is somewhere to rest, like a sofa. The built-in long table keeps its four chairs as one piece, and its top, the table for two's, the island's and the counter's will do for a chair that was brought in.
- [x] Imported kinds are saved in `localStorage` beside the room (`agent-office-models`), checked with a Zod schema that also keeps a pasted one within the limits. A room copied out as JSON carries the kinds it uses, and they are taken in with it or not at all; a piece whose kind is missing is left out, not an error.
- [x] In the palette, imported pieces sit under the built-in ones and can be renamed or deleted; deleting one that is in the room asks first, and takes its pieces out with it as one step. Undoing that brings the model back with its pieces, so a room never has a piece of a kind nobody knows standing unseen in it. A saved room that has one all the same, or a piece that no longer fits, opens without that piece and is not dropped for the default room.
- [x] Tests (`tests/models.test.ts`, and more in `tests/edit.test.ts` and `tests/edit-panel.test.tsx`): the converter on small made-up models (a cube, an L, two colours, thirty colours, one too big, one of too many boxes), both readers, a textured and a see-through model, a turned piece's seats, the pairing rule, the laptop's height, saving, and copying out and pasting in.

Also changed for this: `dragDropEnabled` is off for the Tauri window, so that a dropped file reaches the page; and a file dropped outside edit mode is taken and ignored, so that the window does not go off and open it.

Where a model's faces do not fall on the lines between cubes, the cubes are shared: a table top 11.2 units up gives the leg the cube where they meet, and the top is cut into a few more boxes round it. It is right at the size of a pixel, and it is why a simple table is 15 boxes and not 5.

**Done when** a chair and a table made in Blender can be imported and placed, a worker sits at them with a laptop on the table, and they look like part of the room at every hour.

## Talking to sessions (Phases 16 to 21)

Status: Phase 16 done; Phases 17 and 18 built, not yet tried in the app's window; the rest planned. Branch `feature/terminal-sessions`.

Until now the app only watches. These phases let you answer a session from the app, for Claude Code and for other terminal tools (Codex, Gemini).

What was decided (2026-10-14, with Kevin):

- **Two kinds of session, one rule each.** A session *started in the app* runs in a terminal the app owns, so you type to it in the app. A session *started somewhere else* (VS Code's terminal, any other terminal) is read along in the app, and when you want to answer, the app brings that terminal's window forward.
- **The app never types into a terminal it did not open.** The system does not allow it: on this machine `dev.tty.legacy_tiocsti` is 0, which is what stops one program pushing keys into another's terminal.
- **Any tool, the same way.** The only thing these tools share is that they run in a terminal, so the app's own terminal is the common ground. The tools are a fixed list on the Rust side (name, command): `claude`, `codex`, `gemini`. Adding one is one more entry.
- **No tmux, and no `claude attach`, in these phases.** tmux is not on Windows and has to be installed; `claude attach` is Claude only. Both are under "Later" below.
- **The privacy rule changes in Phase 19, and only there.** Reading along means showing the words of a conversation, which the README says the app never does. The collector stays as it is (metadata only, every second). The words are read only for the one session you open, only while it is open, and are never stored.
- **None of this is in the demo page.** There is no Rust side there; the buttons are not shown.
- **Quitting the app ends the sessions it started.** Closing the window does not (it goes to the tray). Quit asks first when any are running.

### Phase 16: Picking a session

Status: done. Tried in a headless browser against the demo feed (a click on a card's name, on the rest of the card and on a name tag; Escape; the back button), not yet by hand in the app's own window.

Before this a worker or a card could only be pointed at (`Pointed`). Nothing could be picked.

- [x] A click on a card, or on a worker's name tag in the office, picks that session. `selected` is kept in `App.tsx` beside `pointed`; Esc or the back button lets go. Esc is left alone while something is being typed into, which is what the terminal of Phase 17 will need.
- [x] `SessionView.tsx` takes the place of `SessionList` while a session is picked: the way back, its card, and one line saying it is answered in the terminal it runs in. The phases after this fill the rest.
- [x] The side panel grows while a session is picked (`main.picked`: half the window, 680px at most), and the office shrinks to fit beside it.
- [x] The picked worker's name tag stays lit in the office (`pickOut` in `sim.ts`, beside `point`).
- [x] A session that ends while it is picked: the list is back (`pickedOf` in `src/lib/picked.ts`). Nothing is said about it; the worker walking out is what shows it. A view that says "ended" comes with the terminals, where there is something left to read.
- [x] The room being edited puts the view away, and it is back when the editing is done.
- [x] Tests: the card with and without a way to open it, the view, `pickedOf`, and the tag marked and unmarked in `tests/sim.test.ts`. The clicks themselves are not tested: the tests have no page to click in.

**Done when** clicking a worker opens its view and Esc returns to the list.

### Phase 17: A terminal of the app's own

Status: built and tested on both sides, not yet tried by hand in the app's window. The Rust side is tested on real terminals running `sh` and `cat` (`terminals.rs`). The page side was tried in a headless browser with a stand-in for the Rust side: the bytes come out in colour, what is typed goes back, and leaving the view and coming back starts a new watch. Running Claude in the real window, and the ending of a terminal on Windows and macOS, are untried.

- [x] `portable-pty` 0.9 in `Cargo.toml` (ConPTY on Windows, so one crate for all three systems).
- [x] `src-tauri/src/terminals.rs`: a managed `Terminals` holding, for each id, the pty, a way to end the program, its writer and the last 256 KB it printed, cut at the start of a line. One reader thread and one waiting thread per terminal. The waiting one lets go of the pty once the program ends, which is what ends the reading on Windows.
- [x] Commands: `terminal_open(tool, cwd)` gives an id; `terminal_attach(id, channel)` replays what was kept and then streams (a Tauri `Channel` sending raw bytes, which the page gets as an `ArrayBuffer`; the end goes as `{ "exit": code }`); `terminal_write`, `terminal_resize`, `terminal_close`. Added: `terminal_detach(id, watch)`, so a view that closes stops being sent to. Each attach is given a number and only that number lets go, so a view that lets go late (React mounts twice in development) cannot cut off the one after it.
- [x] `tool` is a name from the list in `tools.rs` (`claude`, `codex`, `gemini`), never a command line from the page, and `cwd` must be a folder that exists. The page cannot start anything else. The terminal is started at 80 × 24 with `TERM=xterm-256color` and the page tells it its real size straight after.
- [x] `TerminalPane.tsx` (not `Terminal.tsx`: xterm's class has that name) with `@xterm/xterm` 6 and `@xterm/addon-fit`, in the page's colours and font, following the theme when it changes, loaded only when a terminal is shown so neither the demo nor the first paint carries xterm. **The content security policy changed:** `style-src` is now `'self' 'unsafe-inline'`. xterm writes its colours into `<style>` elements it makes; under `'self'` alone they are refused, and red text came out black (tried in a headless browser with the app's policy). Scripts stay `'self'` only, and with images, fonts and connections limited to the app itself, a style cannot send anything anywhere. Keep `index.html` free of inline `<style>`: Tauri then adds a nonce to `style-src`, and a browser ignores `'unsafe-inline'` beside a nonce.
- [x] The kept output is why closing the view and opening it again shows what was there: the page's terminal is thrown away each time, the Rust side's is not.
- [x] When the program ends the terminal is dropped and the page is told; the view says it ended, with its code. A view opened after that says only that it ended: what it printed went with it.
- [x] Escape stays with the terminal (Phase 16 leaves it alone while a text box has the keyboard, and xterm's is one).
- [x] The panel is 54% of the window, 720px at most, which is 80 columns at a 1280px window.
- [x] Rust tests with a plain shell: what is printed and the code it ends with, typing, a watcher who comes later starting from what was kept, a late letting-go, a watcher after the end, resizing, the cut at a line start, and ids, folders and programs that are not there. `tools.rs` tests that only the listed names are known.
- [x] ~~The temporary button~~, taken out again at Kevin's asking (2026-10-14): "Try a terminal: Claude in this folder" sat in the view of a session started elsewhere, and started a *new* Claude session in that folder, whose terminal then showed under the old session's card. It looked like typing to that session, and was not. Starting a session is "New session"'s job (Phase 18), where the session that starts is the one whose worker walks in and whose view holds the terminal. Until then nothing opens a terminal, and `SessionView` is handed `terminal={null}`.

**Done when** a temporary button opens `claude` in a folder, it can be typed to, and closing and reopening the view loses nothing. (Not tried in the app before the button went: Phase 18's "done when" is where it is first tried by hand.)

### Phase 18: New session

Status: built and tested on both sides, not yet tried by hand in the app's window. The flow was driven in a headless browser with a stand-in for the Rust side: the box finds the tools, a folder is browsed for, Start opens the new worker's view on its terminal, "End session" asks and ends it, and the folder is remembered. The Rust side's merging, waking and finding of tools are tested; asking the shell for `PATH` was tried here from a bare `PATH` (nvm's folder came back, in 0.2s, and Claude Code, Codex and Gemini were all found). The quit and update questions and the system's folder picker are unseen.

- [x] `tools.rs`: the list, and `tools_found` saying which are installed. They are found as a login shell would: `PATH` is asked of the person's own shell (`$SHELL -l -i -c`, fish spoken to in its own words) once, at start, and kept (`tools::PATH`). The shell runs in a terminal of its own: an interactive shell takes over the terminal it starts from, which under `tauri dev` is the developer's. Its answer is read from between two marks, since start-up files may print, and a shell that takes over 5s is given up on, for the app's own `PATH`. On Windows the app's own `PATH` is the whole one.
- [x] The program started is the file found on that `PATH`, and it runs with that `PATH`, so a tool started through `#!/usr/bin/env node` finds nvm's node. A tool that is not installed is refused with "… is not installed".
- [x] "New session" (`NewSession.tsx`), the **+** over the room: pick a tool (only those found, by their names: Claude Code, Codex, Gemini) and a folder (those used for a session before, newest first and eight at most, then those of the sessions open now; and "Browse…", the system's folder picker through `tauri-plugin-dialog`, used from Rust only, so it has no JS package and no capability entry). It shuts on Escape and on a click elsewhere, as the settings do.
- [x] The contract gains two fields on `Session`, in `state.rs` and `src/shared/state.ts` together: `tool`, and `terminal` (the app's terminal id, or null for a session started elsewhere).
- [x] Linking, by pid. The tool is started directly, not through a shell. A session the app runs is `term-<id>` from the moment its terminal opens, so its worker walks in once and stays. When Claude Code's own session file appears for that pid, its status, activity, interns and supervisor fill the same session, under the same id, and nobody walks out and in again (`Terminals::merge`, run after every collection). A tool with no collector yet (Codex, Gemini) has its session made from what the app knows: pid, folder, when it started.
- [x] Status for those, until Phase 21: busy while the terminal printed something in the last two seconds, idle otherwise, since the moment it changed. No "waiting for you" yet.
- [x] The office hears at once: the collecting thread waits on `park_timeout` in place of `sleep`, and a terminal opening or ending wakes it, so the worker walks in when Start is clicked and not up to a second later.
- [x] The view of a session with a `terminal` is the terminal, with "End session", which asks first in the view itself ("End it? This stops Codex."). When it ends the worker walks out, as any ended session does, and the view goes back to the list. The card says "Codex · in this app"; Claude Code is not named, since most sessions are.
- [x] Quit from the tray, and "Update to vX.Y.Z", ask first in the system's own dialog while any terminal is running ("2 sessions started in Agent Office are still running. Quitting ends them."), with "Keep them running" as the way out.
- [x] The empty-office line and the roster's label stop saying "Claude Code" only.
- [x] Not shown in the demo, nor while the room is being edited.
- [x] Remove Phase 17's temporary button. (Done early, in Phase 17.)
- [x] README: a new section, "What it runs".

**Done when** "New session", Codex, a folder: a worker walks in, picking them opens the terminal, you type to it, "End session" and they walk out. (Left for you: try it in the app. This is also the first time Phase 17's terminal is tried by hand.)

### Phase 19: Reading along

For a session started somewhere else. It is the conversation, not a picture of the other terminal's screen: a permission prompt or a menu is not in the transcript, and the card's "waiting for …" line is what tells you about those.

- [ ] Rewrite "What it reads, and what it never reads" in the README, and the privacy line in "Decisions already made" above, before any code: read only for the session you open, only while it is open, held in the page's memory, never stored, never part of the `state` that is sent every second.
- [ ] `conversation.rs`: `conversation_open(session_id, channel)` finds the transcript (`Projects::dir_for`), sends the last turns (who spoke, the text, the names of tools called), then follows the file as it grows. A half-written last line waits for its end, as `tail.rs` already does.
- [ ] Older turns load when scrolled up to, so a long session does not arrive all at once.
- [ ] `Conversation.tsx`: read-only, put on the page as text and never as HTML, so nothing in a transcript can run. It stays at the bottom while you are at the bottom.
- [ ] Tests on the fixtures in `collectors/fixtures`, and new ones for a turn with text, a tool call, and a file that grows.

**Done when** a session started in VS Code's terminal can be read in the app as it is written.

### Phase 20: Going to its terminal

- [ ] `host.rs`: walk up from the session's pid (`sysinfo`, as `processes.rs` does) to the first program known to hold terminals: VS Code and its relatives (`code`, `cursor`, `windsurf`), then terminal programs (`gnome-terminal-server`, `kitty`, `alacritty`, `wezterm`, `konsole`, Terminal, iTerm2, Windows Terminal). `Session` gains `host`, and the view says "In VS Code".
- [ ] "Reply in VS Code" in the view calls `session_focus(id)`:
  - On X11: bring forward the window that belongs to the host's pid (`x11rb`, `_NET_WM_PID` and `_NET_ACTIVE_WINDOW`).
  - VS Code where that is not possible: `code <folder>`, which brings forward the window that has the folder open. It opens a new window when no window has that folder open, so only when the folder is one a window has.
  - macOS: bring the app forward by pid. Windows: the console's window.
  - Wayland: an app cannot raise another's window. The view names the place and that is all.
- [ ] What this cannot do, said in the view where it applies: it brings the window, not the tab inside it. A program that keeps all its windows in one process (gnome-terminal) can only be brought forward as a whole.
- [ ] With no host found there is no button, only the folder.

**Done when** here (X11, VS Code): reading a session in the app, "Reply in VS Code" brings that window forward.

### Phase 21: Other tools, started elsewhere

After Phase 18 a Codex session started in the app has a worker. One started in a terminal still has none: the collector reads `~/.claude` only.

- [ ] Put what is Claude's own in `collectors/` behind one shape (a tool gives its sessions), so a second tool is a second module and not a branch in every function.
- [ ] Codex: its processes (`sysinfo`), each matched to its file under `~/.codex/sessions/<year>/<month>/<day>/rollout-<time>-<id>.jsonl`. The format of those files has not been read yet: do that first and write down what status can honestly be told from it.
- [ ] Reading along for Codex, on Phase 19's view.
- [ ] Gemini the same way, if it keeps files that say enough. To find out.
- [ ] The README's list of what is read grows by each of these.

**Done when** a Codex session started in any terminal gets a worker and can be read along.

### Later, not planned

- **One session in two places at once** (typing in VS Code and in the app): tmux, for any tool, on Linux and macOS, where it is installed.
- **Claude's background sessions** (`claude --bg`): the app's terminal can run `claude attach <id>` for one, which makes it typeable in the app without having started there.
- **"Move here"** for a session started elsewhere and since closed: `claude --resume <id>`, `codex resume`, in the app's terminal.

## Order and checkpoints

Phases 1 to 4 are the bulk of the work and depend on each other in order. Phases 6, 7
and 8 are independent of each other. Phases 9, 10 and 11 depend on each other in order;
12, 13, 14 and 15 each need 11 and are independent of each other. Phases 16, 17 and 18
depend on each other in order; 19 and 20 each need 16 only; 21 needs 18 and 19.

Commit at the end of every phase. From Phase 3 on, the prototype can be opened in a
browser on its own for a side-by-side look, but the app never connects to it.
