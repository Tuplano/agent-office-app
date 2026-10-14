# Agent Office

A desktop app that shows the Claude Code sessions running on your machine as people in a small voxel office. Each session is a worker with a card showing what it is doing, and you get a notification when one starts waiting for you. Subagents show up as interns.

A demo with made-up sessions is meant to live at https://tuplano.github.io/agent-office-app/. It is set up but may not be online yet. The room can be edited there too.

The office fills the window, with three buttons over its top right corner: music, the pencil that edits the room, and settings (the theme, and the music and its volume).

## Music

The note button plays a slow tune, and plays on while you work in other windows. It is made up as it goes, in the app, from four chords and a few notes picked over them: there is no recording in the app and nothing is fetched. It is off until you ask for it, the choice and the volume are remembered, and it stops while the window is closed to the tray.

## The room is yours to change

Click the pencil over the room ("Edit room") and the office becomes something you can rearrange. The people hold still while you do.

- First you are shown the rooms there are to start from, one at a time over the middle of the window, each as it would look with your sessions sitting in it: the office as it comes, all desks (six long tables, a chair for twenty-four), mostly lounge (three sofas, six bean bags, the cafe, the games and one table for two), and empty (four walls, the windows and the door). Then five in other sizes, each in colours of its own: the Gen Z loft (wide and dark, with neon, two arcades and ping-pong), the tiny studio (the smallest a room can be, in soft pink), the glass offices (the biggest, with two offices behind glass walls, each with its own door) the garden room (green and wood, with plants everywhere) and the corporate office (grey and navy, with sixteen cubicles in rows set back to back, a meeting room behind glass, an office for the boss, a pantry and a lounge). The arrows go from one to the next. After the last comes "Customize your own room", which starts you in a big empty room with nothing in it but the door. To keep the room you have, close the chooser. "Ready-made rooms…" in the panel shows them again.
- Click a piece to pick it, drag it across the floor or along the walls, turn it with R, remove it with Delete.
- Add more from the lists in the panel, which show a small picture of each piece: tables, sofas, plants, windows, clocks. Among the desks are a desk for one (the boss's), a cubicle with screens on three sides, and a meeting table that seats twelve. For dressing an office there are carpet, a filing cabinet, a water cooler, a fridge, a vending machine, and a whiteboard for the wall. Click one to add it to the middle of the room, or drag it into the room and let go where you want it. While you carry it, it is shown where it would go, in red where it will not fit. What hangs on a wall has to be dropped on a wall.
- Build rooms inside the room from the "Build walls" list: a wall, a glass wall, a half wall and an office door. A wall is drawn, not placed: click the kind you want, click in the room where it starts, and click where it ends. It is shown as you go, in red where it will not fit, and always runs straight. The next click carries on from where the last wall ended, so a corner is one more click; Esc stops, and Esc again puts the wall down. To take part of a wall away again, click "Cut a wall" and click on the wall where the cut starts and where it ends: that stretch goes, and what is left either side stays. What hangs on a wall (windows, clocks, boards, banners) hangs on either side of a wall or a glass wall you have drawn, too: drag it there. It goes with the wall if the wall behind it is cut or deleted. A half wall is too low to hang anything on. Nobody walks through a wall: drop an office door onto one and the wall opens for it, and the door opens for whoever comes by.
- What lies flat on the floor (the carpet, the lounge rug, the cafe floor and the games floor) comes in any size: pick it, and pull it by one of its corners. Its colour is yours to choose like any other piece's.
- Make the room wider or deeper, up to 300 each way, and pick any colour for the walls, the floor, the trim, the wood and most pieces.
- Undo and Redo go back and forth through what you did, and Reset brings back the room the app starts with. Starting from a ready-made room replaces the one you made: Undo brings it back, until the app is closed.

### Furniture of your own

A chair, a table, a plant or anything else that stands still can be made in a 3D tool and brought in. In edit mode, drop the file on the window, or click "Bring in a model…" under "Add to the floor". Two kinds of file are read:

- `.glb`, which Blender and most other tools export. It is measured in metres and comes in at 16 units to the metre, so a seat 45 cm up and a table top 75 cm up are the right height for the people in the room. Export it without Draco or meshopt compression.
- `.vox`, from MagicaVoxel. Its cubes come in one for one. Only the first model in the file is read.

The model is turned into coloured blocks once, and from then on it is drawn like everything else in the room, in the light of the hour. Its colours are cut down to eight, taken from its materials or the pictures it is painted with. A form shows it as it will look and asks:

- its name and its size (a model past 64 by 64 units of floor or 40 high is made smaller to fit, and one that comes to more than 400 boxes is turned down);
- which way its front faces, shown by an orange line;
- whether it stands in the way or lies flat like a rug;
- whether it has a top to work at, and how high that is;
- where people sit on it. Click on the model to sit someone down, then turn them or raise and lower them. Something the size of a chair starts with one seat in the middle. In a `.glb`, an empty object whose name begins with `seat` marks one, looking the way its front looks.

A seat with a top in front of it is a seat to work at: whoever sits there puts their laptop on that top. Put a chair you brought in up against a table you brought in, or against the end of one of the built-in tables, and it is a desk. A seat with nothing in front of it is somewhere to rest, like a sofa.

What you bring in joins the list to add from and stays there. It can be renamed or deleted; deleting one takes its pieces out of the room too, and asks first; Undo brings it back with them, until the app is closed. Pieces that are brought in stand still: nothing on them moves.

The room is kept on your machine (in the app's own storage, or the browser's on the demo page) and is there again the next time. With more sessions than chairs, the rest take a sofa or a bean bag, then a cushion on the floor beside a lounge rug, and with none of those a cushion anywhere on the open floor. Everyone without a desk works on a laptop on their knees. So every session has its figure in the room, even in an empty one, as long as there is floor left to sit on.

## What it reads, and what it never reads

Everything is read from your own machine by the app's Rust side. No server is involved.

It reads:

- `~/.claude/sessions/<pid>.json`, the file Claude Code keeps for each open session: its id, working folder, status (busy, idle, waiting), what it is waiting for, and a few timestamps.
- The end of each session's transcript (`~/.claude/projects/.../<session>.jsonl`, and the transcripts under `<session>/subagents`), the last 64 KB at most. From the last turn it keeps only who took it, why it stopped, what kinds of block it holds, and the name of the last tool called. The words of the conversation are parsed in memory to find those and are not kept, shown or stored.
- Whether a folder, or one of its parents, has a `.git` folder, to name a session after its repository.
- The running processes, to see whether a session's process is still alive and how much memory it holds.
- If you use claude-mem, `~/.claude-mem/claude-mem.db`, opened read-only, for one thing: which Claude session each observer session belongs to.

`CLAUDE_CONFIG_DIR` and `CLAUDE_MEM_DATA_DIR` are honoured if set.

It never reads your prompts or replies as text, your project files, or anything else under your home folder. It writes nothing to `~/.claude`. Its own files are the remembered window size and, if you switch it on, the launch-at-login entry.

## What it runs

Nothing, until you click **+** (New session). Then it starts the tool you picked (Claude Code, Codex or Gemini, whichever are installed) in the folder you picked, in a terminal inside the app, and its worker walks in. Click the worker to type to it. What you type goes to that program and nowhere else, and what it prints is shown there: the app keeps the last 256 KB of it in memory, to show again when you open the session again, and stores none of it.

To find the tools, the app asks your login shell once for its `PATH`, as a terminal would start it, so that tools installed through nvm or into `~/.local/bin` are found even when the app was started from the desktop. The folders you start sessions in are remembered in the app's own storage, to be offered first next time.

"End session" stops the program. Quitting the app, or restarting it to update, ends every session started in it, so while any are running it asks first. Closing the window does not: the app goes on in the tray. The app can only type to sessions it started: one started in another terminal is watched, as before, and answered there.

Nothing is sent anywhere. The one network request the app makes is the update check to GitHub (see below), and only in release builds.

## Install

Installers are on the [releases page](https://github.com/Tuplano/agent-office-app/releases). They are not signed with a paid certificate, so Windows and macOS warn you before the first run. The warnings are described below.

### Ubuntu and Debian

Download the `.deb` and install it:

```
sudo apt install ./Agent.Office_0.1.0_amd64.deb
```

Or download the `.AppImage`, make it executable (`chmod +x`) and run it. The AppImage needs FUSE 2 (`libfuse2` on Ubuntu 22.04 and 24.04).

Only the AppImage can update itself. With the `.deb`, the app tells you a new version exists and where to download it.

The tray icon needs a desktop that shows tray icons. GNOME does not do so by default; the AppIndicator extension adds it. Without it the app still works, but the icon is not shown: closing the window hides it all the same, and starting the app again brings the window back.

### Windows

Download the `.msi` or the `-setup.exe` and run it. Windows SmartScreen shows "Windows protected your PC". Click "More info", then "Run anyway".

### macOS

Download the `.dmg` for your Mac: `aarch64` for Apple Silicon, `x64` for Intel. Open it and drag the app to Applications.

The app is only ad-hoc signed, not signed by an Apple developer account and not notarized. The first time, macOS refuses to open it. Open System Settings, Privacy & Security, scroll to the message about "Agent Office" being blocked and click "Open Anyway", then confirm. If macOS says the app is damaged, run `xattr -dr com.apple.quarantine "/Applications/Agent Office.app"` once.

## While the window is closed

Closing the window hides it and the app keeps watching from the tray. The tray icon gets an orange dot while a session is waiting, and a notification names the session and what it waits for, once per change. Quit from the tray menu.

The tray menu has Show, Launch at login (off until you switch it on; it then starts hidden in the tray), Check for updates and Quit. On Windows and macOS a left click on the icon shows the window; on Linux the menu is the way in. Starting the app a second time shows the window of the one already running.

## Updates

A release build looks for a newer version about 20 seconds after it starts, and when you click "Check for updates" in the tray menu. Nothing is downloaded until you click "Update to vX.Y.Z" in the same place, and then it installs and restarts. Updates are signed, and the app only accepts ones signed with the author's key. Debug builds never check.

## Status

Built and run on Ubuntu. The Windows and macOS builds are produced by the GitHub workflows but have not been run by the author yet, so session discovery, the tray, notifications and updating are untested there. On Wayland the window's size is remembered but not its position.

## Build from source

You need Node 22 or later, Rust, and Tauri's [system prerequisites](https://v2.tauri.app/start/prerequisites/). On Debian and Ubuntu the tray also needs `libayatana-appindicator3-dev`.

```
npm ci
npm run tauri dev       # run the app
npm run tauri build     # installers, under src-tauri/target/release/bundle
npm run build:demo      # the static demo page, in dist-demo
```

`npm run tauri build` signs the updater files, so it needs `TAURI_SIGNING_PRIVATE_KEY` (the key or the path to it) in the environment, and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key has a password. Without a key the build fails at the end.

Tests and checks:

```
npx vitest run                # frontend tests
npx tsc --noEmit              # type check
cd src-tauri && cargo test    # Rust tests
cd src-tauri && cargo clippy --all-targets
```

The icon is drawn by `scripts/icon.mjs` into `src-tauri/app-icon.png`; `npm run tauri icon src-tauri/app-icon.png` makes every size from it.

The `Check` workflow runs the Rust and frontend tests on every push to `main` and every pull request, on Linux, Windows and macOS.

## Cutting a release

1. Set the same new version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
2. Commit, tag it `vX.Y.Z` and push the tag.
3. The `Release` workflow builds Linux, Windows and macOS (Apple Silicon and Intel) and attaches the installers and `latest.json` to a draft release.
4. Check the draft, then publish it. Installed apps find the update through `latest.json` on the latest published release.

The workflow needs repository secrets. `TAURI_SIGNING_PRIVATE_KEY` holds the updater's private key (its contents, not a path). `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` holds its password; the current key has none, so that secret is left unset. The matching public key is in `src-tauri/tauri.conf.json`. Lose the private key and installed apps can no longer be updated.

## License

MIT. See [LICENSE](LICENSE).
