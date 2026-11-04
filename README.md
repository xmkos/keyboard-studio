# Keyboard Studio

A browser app that edits a YUNZII RT80 keyboard (model 2068) over USB. It talks to the keyboard directly with **WebHID**, so there is no server, no tunnel and no driver. Everything runs on the page; nothing is sent anywhere.

## Use it
- Open the page in **Chrome or Edge on a computer** (Firefox and Safari have no WebHID).
- Plug the RT80 in by USB cable, close GearHub/QMK.top, press **Підключити**, pick the RT80 and allow access. The browser remembers the permission.
- On Linux you may need a udev rule so the browser can open the device. macOS and Windows need nothing.

## Share it with friends
It is static files, so any HTTPS host works (GitHub Pages, Netlify, Cloudflare Pages). WebHID needs `https://` or `http://localhost`. Each friend's browser talks to their own keyboard; their profiles and backups stay in their own browser.

## Run it locally
`node server.mjs` (Node 20+) serves http://127.0.0.1:18780, or double-click **Start Keyboard Studio.cmd**. The server only serves files; it never touches the keyboard.

## Status
The WebHID path ports the old PowerShell/HidSharp bridge frame for frame and is covered by a simulated keyboard in `tests/hid.test.mjs`. It has **not been tested on a real keyboard yet**: first connect and read, then try one small write. The old Node + PowerShell version is kept in `legacy/` (Windows only, needs IoT Manager's HidSharp.dll).

Wooting import by code asks api.wooting.io from the browser; if the browser blocks it, export the profile as JSON and import the file.

The app reads model 2068 with supported firmware and edits the current hardware slot: actuation, Rapid Trigger, simple remapping, Snap, DKS, Mod Tap, Toggle, supported main RGB effects, Fn mappings, side RGB, and 2.4G/Bluetooth backlight-off timers. The custom RGB, slot switch, Fn, side RGB, sleep and release/deadzone write protocols are source-backed but have not been hardware-write tested. Device support and full semantics vary by firmware. DKS action numbers are raw protocol values. RT80 Snap has not been proved equivalent to SOCD. Wooting import is partial and shows excluded fields. Native profiles include raw Fn records and referenced macro payloads where readable, custom RGB, supported backlight timers, side RGB and valid release/deadzone values when available. If any current release/deadzone value is outside the app’s editable range, that family is omitted from the portable profile. Native profiles preserve raw records for all four current-slot sublayers and Fn, plus readable referenced macro payloads. The separate QMK macro library and other hardware slots are not exported as one profile. Macro imports reject changed payloads when the index is referenced by a preserved mapping; the event editor supports bounded key, mouse-button and movement actions.

Not available here: screen/music RGB effects, polling rate, calibration, firmware updates and verified physical continuous RT behavior. The QMK.top Full Travel Continuous RT control is represented as its observed RT flag and 0.2 mm threshold initialization; no separate firmware mode is claimed. Use the original configurator for these, where it supports them. This app does not claim complete QMK.top parity.

Before an actual write, a snapshot is saved in this browser (last 12; download or re-import them from the Help panel) and the changed values are read back; stale state blocks the write. Backups cover fields the app knows how to restore, not every device setting. After an error, inspect the stated backup and read the device again. Only the selected current hardware slot is edited. Do not interrupt an in-progress write.

Software checks do not prove every feature has been physically tested on the keyboard.

The profile library may omit fields that cannot be represented safely; inspect imported profiles and device state before applying. Per-key custom RGB, Fn and other newly added device write paths are source-backed, not physically write-tested.

When a macro is created in a freshly read empty, unreferenced slot, its backup records that allocation. Restoring that backup restores bindings but leaves the now-unreferenced macro bytes in device memory; it is a behavioral rollback, not an exact memory restore. Empty or sparse existing macro data that cannot be restored and conflicting references are blocked. Macro event editing uses bounded key, mouse-button and movement events with delays of 1–65535 ms.
