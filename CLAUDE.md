# Keyboard Studio

Browser app (WebHID). It edits a YUNZII RT80 keyboard (model 2068) over USB HID. UI is in Ukrainian.

## Run
- Static app. `node server.mjs` serves http://127.0.0.1:18780 (or `Start Keyboard Studio.cmd`). Any HTTPS static host also works; WebHID needs a secure context and Chrome/Edge.
- No build step, no dependencies. Tests: `node --test tests/` (`tests/http-smoke.mjs` is a smoke script, needs the server running).
- The keyboard is driven from the browser with WebHID. `legacy/` holds the old Node + PowerShell bridge (Windows only), not maintained.

## Files
- `engine.mjs`: what server.mjs used to do. `call(url,body)` keeps the old `/api/...` names (state, apply, remap, rgb, side, sleep, fn, led, picture, travel-extras, advanced, binding, slot, restore); also WebHID connect, browser backups (localStorage `ks-backup:<name>`), Wooting fetch. Writes make a backup and read back.
- `hid.mjs`: RT80 HID protocol over a link `{sendFeature,getFeature}` (port of hardware.ps1: frames, retries, waits). Tested with a fake keyboard in `tests/hid.test.mjs`.
- `server.mjs`: static file server only.
- `mchose.mjs`: read-only decoder for MCHOSE/Cizhou keyboards (vid 0x41e4, e.g. Ace68-II): key trigger (8 bytes/key, 0.01 mm), key matrix (3 bytes/key), Ace68 layout. Fed by `dumpMchose` in `engine.mjs` (read commands only). Real dump fixture: `tests/ace68ii-dump.txt`.
- `protocol.mjs`, `wooting.mjs`: protocol frames, Wooting profile import.
- `rgb.mjs`, `side.mjs`, `sleep.mjs`, `picture.mjs`, `options.mjs`, `remap.mjs`, `macro.mjs`, `advanced-bindings.mjs`: one builder per feature. Each has a test in `tests/`.
- `profiles.mjs`: native profile validation.
- `index.html`, `app.mjs`, `style.css`: the whole UI (one page, no framework). `app.mjs` `request()` calls the engine.

## UI structure
- Left nav buttons use `data-tab`. The click handler is in `app.mjs` (search `editorViews`).
- Views that use the keyboard + `#workspace`: quick, actuation, rapid, remap, advanced, lighting, keys, system.
- `#workspace[data-view=…]` plus CSS in `style.css` choose which cards show.
- Extra device settings live in `#device-cards`. Each block is `.device-group[data-group=lighting|keys|system]`. To add one: add the block with a `data-group`. No JS change needed.
- Separate panels: profiles, rgb, advanced, help, unsupported.
- Feature gates come from `state.capabilities` (rgb, remap, advanced). Controls are disabled until `/api/state` reads the device.

## Rules
- Never write to the keyboard without the backup + read-back flow in `engine.mjs`.
- Most write paths are source-backed from QMK.top, not hardware-tested. Keep the notices honest.
- Files use CRLF line endings. Keep them.
- Reference: QMK.top (GearHub) needs a connected device to show its UI.

## Notes
- HID reads sometimes fail once. `hid.mjs` retries each feature report up to 4 times. A full read takes about 30 s.
- Keycaps show live values: `.key-meta` is filled in `renderEditor` (actuation mm, `⇄ partner` for Snap Tap, DKS/MT/TGL). Classes `rt`, `snap`, `special` mark state.
- Snap Tap (SOCD) UI: `#snap-visual` in `index.html`, filled in `renderAdvanced`.
- HID speed: about 1 in 35 replies hangs 5 s (random, firmware side). A full read sends ~170 commands, so it is slow. `engine.mjs` keeps `lastAll` (all 20 keymap layers) and later reads re-read only the current slot (`cache` in `hid.mjs`). `/api/state?full=1` (the Оновити button) forces a full read. Writes pass `fresh:true`, so `hid.mjs` skips its own pre-read.
- Wooting import maps layer-0 SOCD pairs to RT80 Snap pairs (`snapPairs` in `wooting.mjs`, applied in `importValue` in `app.mjs`). Test fixture: `tests/valo-fixture.json`.
- Wooting 80HE (device 10, v14 mm or v15 raw, ANSI or ISO) uses `rows80` in `wooting.mjs`: Esc is row 0 col 0, number row is row 1. F-row cols 1+ and the nav/arrow cluster are not mapped yet. Fixtures: `tests/80he-ansi-14.json`, `tests/80he-ansi-15.json`. Rappy Snappy and SOCD both import as Snap pairs.
- Write speed (measured on the real RT80): one commit flag on the LAST item saves every staged key (81 keys in one batch, kept after a slot reload), so `apply` commits once per 100 items instead of once per key. After a write, `Read-Touched` re-reads only the tables/pages that were written and copies the rest from `before` (only when `fresh`). Reads wait 5 ms after SetFeature (3 and 6 ms gave 0 wrong replies in 72 reads). Backup of the script before these changes: none in repo; the old behaviour is the non-`fresh` path.
- Not done: replacing the 500 ms/1000 ms sleeps after remap, fn, RGB, side, sleep and picture writes (small gain, untested), cancelling the 5 s stall with overlapped IO, and a long-lived PowerShell helper.
- `exclusive()` in `engine.mjs` queues keyboard operations (max 2 waiting, then 409) instead of rejecting a second request at once.
- RGB colour only works when "dazzle" (mode byte 8, shown as "Різнокольоровий режим") is OFF (mode byte 7 = custom colour). Picking a colour in the UI unticks it. Main and side RGB both follow this.

- WebHID port is NOT hardware-tested yet. Open questions: whether the RT80 config interface is exposed (collection with feature reports), whether `receiveFeatureReport(0)` includes a report-ID byte (engine strips it when the length is 65), and whether a dropped reply rejects or hangs (engine gives up after 4 s).
- Progress comes from `hid.mjs` `report()` through `setProgressHandler`; no polling.
- MCHOSE write (confirmed working on a friend's Ace68-II, 2026-11-04, reported by the user; only actuation of one key tested): `mchoseSetActuation` in `engine.mjs` edits one key actuation (command 161, one 56-byte window, backup in localStorage `ks-mchose:`, read back and compare). No separate save step was needed (vendor driver sends none). Read path is confirmed against M HUB by a friend.
- MCHOSE in the main UI (2026-11-04): «Підключити» offers RT80 and MCHOSE (picker filter usagePage 1 / usage 0 for 0x41e4; a granted device connects on load). `mchoseSession` dumps the keyboard; after that `call()` routes every /api/... name to `mchoseCall` in `engine.mjs`, which returns a state of the RT80 shape (`layout:'ace68'`, 0.01 mm steps, 4 profiles; `/api/slot` only picks which profile region the editor edits, it does not switch the hardware profile). `app.mjs` `setLayout` swaps the 6-row RT80 grid for the 5-row Ace68 grid and the 0.1/0.01 mm precision. Capabilities rgb/remap/advanced are false, so those tabs show "unsupported". The dialog «Розширені налаштування Ace68-II» (`showMchose`) edits deadzones and the raw mode flag. Rapid Trigger on/off is mapped to keyMode 1/0 (probable, not proven). Not covered: remap (vendor uses command 776 area), lighting, DKS/MT/TGL writes, calibration, hardware profile switch.
- Logs: in memory, errors/writes/connects also in localStorage `ks-log`; the share dialog copies, saves, or opens a prefilled public GitHub issue (`reportText`). Nothing is uploaded automatically.
- Before every deploy run `node stamp.mjs` (cache-busting ?v= on local imports; GitHub Pages caches 10 minutes).
