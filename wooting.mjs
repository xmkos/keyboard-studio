// Source: shipped Wootility index-BaoALhfv.js, xE/B2/xC, p$/nd and Jt/_5.
// Wooting v15 HE distances use 0..16383 over a nominal 4 mm travel.
const MAX = 16383;
const rows = [
  [],
  [41,30,31,32,33,34,35,36,37,38,39,45,46,42],
  [43,20,26,8,21,23,28,24,12,18,19,47,48,49],
  [57,4,22,7,9,10,11,13,14,15,51,52,null,40],
  [225,null,29,27,6,25,5,17,16,54,55,56,null,229],
  [224,227,226,null,null,null,44,null,null,null,230,101,228,null],
];
// Wooting 80HE: Esc sits at row 0 col 0 and the number row is row 1 (checked against two shared pro profiles:
// Esc/Tab/Caps = 0,0 / 2,0 / 3,0, WASD = 2,2 / 3,1 / 3,2 / 3,3, Space = 5,6). F-row cols 1+ and the right-hand nav cluster are not mapped.
const rows80 = [[41], [53,30,31,32,33,34,35,36,37,38,39,45,46,42], rows[2], rows[3], rows[4], rows[5]];
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
function fail(message) { throw new Error(`Wooting import: ${message}`); }
const SHARE_CODE = /^[a-f\d]{36}$/i;
const CUSTOM_SCHEME = /^web\+wootwoot:\/\//i;

function parseCustomShareUrl(value) {
  if (!CUSTOM_SCHEME.test(value)) fail('unsupported profile link protocol.');
  let url;
  try { url = new URL(value); } catch { fail('invalid profile link.'); }
  const authority = value.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1] ?? '';
  if (url.protocol !== 'web+wootwoot:' || url.hostname !== 'import-profile' || url.pathname !== '' || url.port || url.username || url.password || authority.includes('@') || value.includes('#')) fail('profile link must use web+wootwoot://import-profile.');
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== 'code') fail('profile link must contain exactly one code parameter.');
  const code = url.searchParams.get('code');
  if (!SHARE_CODE.test(code ?? '')) fail('profile code must be exactly 36 hexadecimal characters.');
  return code;
}

/** Extracts one Wootility share code from a code or official share link. Pure; does not fetch. */
export function parseWootingCode(input) {
  if (typeof input !== 'string' || input !== input.trim() || /[\u0000-\u0020\u007f]/.test(input)) fail('expected a profile code or official sharing link.');
  if (SHARE_CODE.test(input)) return input;
  if (CUSTOM_SCHEME.test(input)) return parseCustomShareUrl(input);
  if (!/^https:\/\//i.test(input)) fail('unsupported profile link protocol.');
  let url;
  try { url = new URL(input); } catch { fail('invalid profile link.'); }
  const authority = input.match(/^https:\/\/([^/?#]*)/i)?.[1] ?? '';
  if (url.protocol !== 'https:' || url.origin !== 'https://wootility.io' || url.pathname !== '/' || url.port || url.username || url.password || authority.includes('@') || input.includes('#')) fail('sharing link must use https://wootility.io/.');
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== 'protocol') fail('sharing link must contain exactly one protocol parameter.');
  return parseCustomShareUrl(url.searchParams.get('protocol'));
}

function raw(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > MAX) fail(`${label} must be an integer in 0..16383.`);
  return value;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be boolean.`);
  return value;
}
function entries(value, label) {
  if (value === undefined) return new Map();
  if (!Array.isArray(value) || value.length > 126) fail(`${label} must be a bounded sparse key array.`);
  const result = new Map();
  for (const entry of value) {
    if (!record(entry) || !record(entry.index)) fail(`${label} has an invalid entry.`);
    const {rowNr:r, colNr:c} = entry.index;
    if (!Number.isInteger(r) || r < 0 || r > 5 || !Number.isInteger(c) || c < 0 || c > 20 || !own(entry, 'value')) fail(`${label} has an invalid coordinate/value.`);
    const key = `${r},${c}`;
    if (result.has(key)) fail(`${label} contains duplicate coordinate ${key}.`);
    result.set(key, entry.value);
  }
  return result;
}

/** Pure conversion of supported Wooting v14 80HE ISO and v15 profiles; does not access devices or network. */
export function convertWootingProfile(input) {
  if (!record(input)) fail('expected a profile object.');
  const p = own(input, 'data') ? input.data : input;
  if (!record(p) || ![14,15].includes(p.version)) fail('only verified profile schemas v14 (80HE ISO) and v15 are supported; export a current Wootility JSON profile.');
  if (!record(p.target)) fail('missing source keyboard target.');
  const {device, layout} = p.target;
  // Wootility v14 stores 80HE travel distances directly in millimeters. Keep
  // this narrow until the other legacy device/layout coordinate maps are verified.
  const legacy80Iso = p.version === 14 && device === 10 && [0,1].includes(layout);
  if (p.version === 14 && !legacy80Iso) fail(`unverified v14 source keyboard/layout ${device}/${layout}; supported: Wooting 80HE ANSI/ISO.`);
  const supportedLayouts = device === 11 ? [0,1,3,4] : [0,1];
  if (!legacy80Iso && (![4,5,9,10,11].includes(device) || !supportedLayouts.includes(layout))) fail(`unverified source keyboard/layout ${device}/${layout}; supported: 80HE ANSI/ISO, 60HE/60HE ARM/60HE+ ANSI/ISO, 60HE v2 ANSI/ISO and split-spacebar layouts.`);
  if (typeof p.name !== 'string' || p.name.length > 200) fail('profile name is missing or too long.');
  if (!record(p.analog)) fail('missing analog settings.');
  const a = p.analog;
  const legacyDistance = (v, label) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) fail(`${label} must be a finite non-negative millimeter distance.`);
    return v;
  };
  const baseAct = legacy80Iso ? legacyDistance(a.actPoint, 'analog.actPoint') : raw(a.actPoint, 'analog.actPoint');
  const baseRT = legacy80Iso ? legacyDistance(a.rapidTriggerSensitivity, 'analog.rapidTriggerSensitivity') : raw(a.rapidTriggerSensitivity, 'analog.rapidTriggerSensitivity');
  const globalRT = boolean(a.rapidTrigger ?? false, 'analog.rapidTrigger');
  const baseDown = a.rapidTriggerSecondarySensitivity == null ? baseRT : legacy80Iso ? legacyDistance(a.rapidTriggerSecondarySensitivity, 'analog.rapidTriggerSecondarySensitivity') : raw(a.rapidTriggerSecondarySensitivity, 'analog.rapidTriggerSecondarySensitivity');
  if (a.enableDigital !== undefined && !boolean(a.enableDigital, 'analog.enableDigital')) fail('digital output is disabled in this profile; this cannot be reproduced by this importer.');
  const act = entries(p.customActuations, 'customActuations');
  const rt = entries(a.perKeyRapidTrigger, 'perKeyRapidTrigger');
  const losses = new Set();
  const distance = (v, label) => {
    if (legacy80Iso) {
      legacyDistance(v, label);
      const rounded = Math.round(Math.min(3.3, Math.max(0.1, v)) * 10) / 10;
      if (Math.abs(v - rounded) > 0.001) losses.add('Distances were rounded/clamped to RT80 0.1–3.3 mm in 0.1 mm steps.');
      return rounded;
    }
    const mm = raw(v, label) * 4 / MAX;
    const rounded = Math.round(Math.min(3.3, Math.max(0.1, mm)) * 10) / 10;
    // Normalized integers have small unavoidable encoding error; report material quantization only.
    if (Math.abs(mm - rounded) > 0.001) losses.add('Distances were rounded/clamped to RT80 0.1–3.3 mm in 0.1 mm steps.');
    return rounded;
  };
  for (const [key, value] of act) if (legacy80Iso) {
    legacyDistance(value, `customActuations[${key}]`);
  } else raw(value, `customActuations[${key}]`);
  for (const [key, value] of rt) {
    if (typeof value === 'boolean') continue;
    if (!record(value)) fail(`invalid Rapid Trigger value at ${key}.`);
    if (own(value, 'sensitivity')) legacy80Iso ? legacyDistance(value.sensitivity, `RT[${key}].sensitivity`) : raw(value.sensitivity, `RT[${key}].sensitivity`);
    if (value.secondarySensitivity != null) legacy80Iso ? legacyDistance(value.secondarySensitivity, `RT[${key}].secondarySensitivity`) : raw(value.secondarySensitivity, `RT[${key}].secondarySensitivity`);
    if (own(value, 'strictActuationRange')) boolean(value.strictActuationRange, `RT[${key}].strictActuationRange`);
    for (const field of Object.keys(value)) if (!['sensitivity','secondarySensitivity','strictActuationRange'].includes(field)) losses.add(`Unknown per-key RT field ${field} was not imported.`);
  }
  const grid = device === 10 ? rows80 : rows;
  const settings = {};
  const iso = layout === 1 || layout === 4;
  for (let r = 0; r <= 5; r++) for (let c = 0; c < grid[r].length; c++) {
    const hid = grid[r][c] ?? (iso && r === 4 && c === 1 ? 100 : null);
    if (hid === null) continue;
    const key = `${r},${c}`;
    // v15 sparse RT list is authoritative when present; omitted keys are disabled.
    const value = rt.has(key) ? rt.get(key) : (a.perKeyRapidTrigger === undefined ? globalRT : false);
    const enabled = typeof value === 'boolean' ? value : true;
    // Shipped xd labels primary sensitivity Press and secondary sensitivity Release.
    const down = record(value) ? value.sensitivity ?? baseRT : baseRT;
    const up = record(value) ? value.secondarySensitivity ?? a.rapidTriggerSecondarySensitivity ?? down : baseDown;
    settings[hid] = {actuation:distance(act.get(key) ?? baseAct, `actuation ${key}`),rtEnabled:enabled,rtUp:distance(up, `RT up ${key}`),rtDown:distance(down, `RT down ${key}`)};
  }
  for (const key of new Set([...act.keys(), ...rt.keys()])) {
    const [r,c] = key.split(',').map(Number);
    if (!grid[r]?.[c]) losses.add(`Source physical key ${key} has no verified RT80 mapping and was omitted.`);
  }
  if (device === 10) losses.add('Wooting 80HE F-row, navigation cluster and arrow keys have no verified RT80 mapping and were omitted.');
  if (layout === 3 || layout === 4) losses.add('Outer split-spacebar keys are omitted; only the central Space key maps to RT80 Space.');
  if (a.rapidTriggerStrictActuationRange !== undefined || [...rt.values()].some(v => record(v) && own(v,'strictActuationRange'))) losses.add('Wooting continuous/strict Rapid Trigger behavior is not reproduced; only distances and enable states are imported.');
  if (p.remap != null) losses.add('Key remaps and function layers were not imported; RT80 bindings remain unchanged.');
  // SOCD pairs on the base layer become RT80 Snap pairs; everything else in akc/dks stays unimported.
  const snapPairs = [], seenPairs = new Set();
  let unmappedAkc = 0;
  const hidAt = (i) => record(i) && Number.isInteger(i.rowNr) && Number.isInteger(i.colNr) ? (grid[i.rowNr]?.[i.colNr] ?? (iso && i.rowNr === 4 && i.colNr === 1 ? 100 : undefined)) : undefined;
  for (const item of Array.isArray(p.akc) ? p.akc : []) {
    const s = record(item) ? (item.socd ?? item.rappySnappy) : undefined, h1 = hidAt(item?.keyIndex), h2 = hidAt(s?.secondaryKey);
    if (!record(s) || item.layer !== 0 || !h1 || !h2 || h1 === h2) { unmappedAkc++; continue; }
    const id = [h1, h2].sort((x, y) => x - y).join();
    if (seenPairs.has(id)) continue;
    if (snapPairs.some(([x, y]) => [x, y].some((k) => k === h1 || k === h2))) { unmappedAkc++; continue; }
    seenPairs.add(id); snapPairs.push([h1, h2]);
  }
  if (unmappedAkc || (p.dks?.length ?? 0)) losses.add('Advanced keys (DKS, Mod Tap, Toggle, Rappy Snappy and SOCD that cannot be mapped) were not imported.');
  if (snapPairs.length) losses.add('SOCD / Rappy Snappy key pairs are imported as RT80 Snap Tap pairs; Wooting mode details are not carried over and RT80 equivalence is unverified.');
  if (p.rgb != null || p.lightbar != null) losses.add('Wooting RGB effects, per-key colors and lightbar settings were not imported.');
  if (p.gamepad != null) losses.add('Analog gamepad mappings, curves and joystick settings were not imported.');
  if (a.tachyonMode || a.tachyonModeFocus || own(a,'dksTickRate')) losses.add('Wooting Tachyon modes and DKS tick rates were not imported.');
  for (const field of Object.keys(a)) if (!['actPoint','rapidTriggerSensitivity','rapidTriggerSecondarySensitivity','rapidTrigger','enableDigital','perKeyRapidTrigger','rapidTriggerStrictActuationRange','tachyonMode','tachyonModeFocus','dksTickRate'].includes(field)) losses.add(`Unknown analog field ${field} was not imported.`);
  for (const field of Object.keys(p)) if (!['version','name','target','analog','customActuations','remap','akc','dks','rgb','gamepad','lightbar','metadata','desc','guid'].includes(field)) losses.add(`Unknown profile field ${field} was not imported.`);
  losses.add(legacy80Iso
    ? 'Wooting nominal millimeter distances are preserved where possible; physical switch calibration/feel cannot be transferred.'
    : 'Nominal distances are converted from Wooting’s 4 mm scale; physical switch calibration/feel cannot be transferred.');
  return {name:p.name,source:{version:p.version,device,layout},settings,losses:[...losses],...(snapPairs.length ? {snapPairs} : {})};
}
