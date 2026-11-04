import {MATRIX, validateSnapshot} from './protocol.mjs?v=mw27j5wi';

const MODE = Object.freeze({dks: 2, modTap: 3, toggleHold: 4, toggleRepeat: 5});

function byte(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError(`${label} must be a byte`);
  return value;
}

function matrixPos(hid) {
  const pos = MATRIX.indexOf(hid);
  if (!hid || pos < 0 || pos > 127) throw new RangeError('HID is not an RT80 matrix key');
  return pos;
}

function encodeKeymapWrite(profile, subprofile, pos, keyBytes) {
  if (!Number.isInteger(profile) || profile < 0 || profile > 4) throw new RangeError('profile must be 0..4');
  if (!Number.isInteger(subprofile) || subprofile < 0 || subprofile > 3) throw new RangeError('subprofile must be 0..3');
  if (!Array.isArray(keyBytes) || keyBytes.length !== 4) throw new TypeError('keyBytes must contain four configToMatrix bytes');
  const frame = new Uint8Array(64);
  frame.set([19, profile * 4 + subprofile, pos], 0);
  frame.set(keyBytes.map((v, i) => byte(v, `keyBytes[${i}]`)), 8);
  return frame;
}

function simpleMagWrite(op, pos, values, commit) {
  const data = values.map((v, i) => byte(v, `value[${i}]`));
  if (!data.length) throw new TypeError('simple magnetism write needs data');
  return Uint8Array.from([101, op, 0, pos, commit ? 1 : 0, 0, 0, 0, ...data]);
}

function packedDksActions(actions) {
  if (!Array.isArray(actions) || actions.length !== 4) throw new TypeError('each DKS subprofile needs four stage actions');
  const packed = actions.reduce((value, action, stage) => {
    if (!Number.isInteger(action) || action < 0 || action > 3) throw new RangeError('DKS stage action must be a 2-bit code (0..3)');
    return value | (action << (stage * 2));
  }, 0);
  // GearHub's DKS editor rejects impossible trigger-point combinations. The
  // current editor's A1(byte) decoder documents the same packed constraints:
  // D is binary, C supports 0..2, and composite A/B positions require their
  // later trigger points to be present.
  const a = packed & 3, b = (packed >>> 2) & 3, c = (packed >>> 4) & 3, d = (packed >>> 6) & 3;
  if (d > 1 || c > 2 || (b === 3 && c < 2) || (a === 3 && b < 2)) {
    throw new RangeError('DKS trigger actions form an unsupported GearHub combination');
  }
  return packed;
}

function decodeDksActions(packed) {
  byte(packed, 'packed DKS actions');
  return [packed & 3, (packed >>> 2) & 3, (packed >>> 4) & 3, (packed >>> 6) & 3];
}

function rawDksTravel(mm) {
  if (typeof mm !== 'number' || !Number.isFinite(mm) || mm < 0.5 || mm > 2.5 || Math.abs(mm * 10 - Math.round(mm * 10)) > 1e-7) {
    throw new RangeError('DKS trigger travel must be 0.5..2.5 mm in 0.1 mm steps');
  }
  return Math.round(mm * 10) - 2;
}

function rawModTapTime(ms) {
  if (!Number.isInteger(ms) || ms < 0 || ms > 2550 || ms % 10 !== 0) throw new RangeError('Mod Tap time must be 0..2550 ms in 10 ms steps');
  return ms / 10;
}

/**
 * Produce pure GearHub command payloads for magnetic advanced bindings.
 * `bindings` are four bytes already returned by GearHub configToMatrix.
 * DKS bindings are indexed by subprofile 0..3; MT uses subprofile 0=hold,
 * subprofile 1=tap; Toggle uses subprofile 0.
 */
export function buildAdvancedBindingFrames({profile, hid, mode, fire = false, bindings, triggerActions, triggerTravel, holdMs}) {
  const pos = matrixPos(hid);
  if (!Number.isInteger(profile) || profile < 0 || profile > 4) throw new RangeError('profile must be 0..4');
  if (!Object.hasOwn(MODE, mode)) throw new Error('unsupported advanced key mode');
  if (typeof fire !== 'boolean') throw new TypeError('fire must be boolean');

  let bindingSlots;
  let magneticWrites;
  if (mode === 'dks') {
    if (!Array.isArray(bindings) || bindings.length !== 4) throw new TypeError('DKS requires four subprofile bindings');
    if (!Array.isArray(triggerActions) || triggerActions.length !== 4) throw new TypeError('DKS requires actions for four subprofiles');
    const actionBytes = triggerActions.map(packedDksActions);
    const triggerRaw = rawDksTravel(triggerTravel);
    bindingSlots = bindings.map((keyBytes, subprofile) => ({subprofile, keyBytes}));
    magneticWrites = [
      simpleMagWrite(7, pos, [MODE.dks | (fire ? 128 : 0)], false),
      simpleMagWrite(4, pos, [triggerRaw], false),
      simpleMagWrite(8, pos, actionBytes, true),
    ];
  } else if (mode === 'modTap') {
    if (!bindings || !Array.isArray(bindings.hold) || !Array.isArray(bindings.tap)) throw new TypeError('Mod Tap requires hold and tap configToMatrix bytes');
    const rawTime = rawModTapTime(holdMs);
    bindingSlots = [{subprofile: 0, keyBytes: bindings.hold}, {subprofile: 1, keyBytes: bindings.tap}];
    magneticWrites = [
      simpleMagWrite(7, pos, [MODE.modTap | (fire ? 128 : 0)], false),
      simpleMagWrite(5, pos, [rawTime], true),
    ];
  } else {
    if (!Array.isArray(bindings)) throw new TypeError('Toggle requires one configToMatrix binding');
    bindingSlots = [{subprofile: 0, keyBytes: bindings}];
    magneticWrites = [simpleMagWrite(7, pos, [MODE[mode] | (fire ? 128 : 0)], true)];
  }

  return {
    matrixPos: pos,
    profile,
    bindingWrites: bindingSlots.map(({subprofile, keyBytes}) => encodeKeymapWrite(profile, subprofile, pos, keyBytes)),
    magneticWrites,
    readback: advancedReadbackRequestSpec(pos, mode, profile),
  };
}

/** GET 229 (`0xE5`) pages for exact GearHub readback of the changed fields. */
export function advancedReadbackRequestSpec(pos, mode, profile = 0) {
  byte(pos, 'matrixPos');
  if (!Number.isInteger(profile) || profile < 0 || profile > 4) throw new RangeError('profile must be 0..4');
  if (!Object.hasOwn(MODE, mode)) throw new Error('unsupported advanced key mode');
  const requests = [];
  for (const op of mode === 'dks' ? [7, 4, 10] : mode === 'modTap' ? [7, 5] : [7]) {
    const pages = op === 10 ? 8 : 2;
    for (let page = 0; page < pages; page++) requests.push(Uint8Array.of(229, op, 1, page));
  }
  return {
    magneticRequests: requests,
    modeRawAt: {op: 7, pos},
    ...(mode === 'dks' ? {travelRawAt: {op: 4, pos}, triggerActionBytesAt: [0, 1, 2, 3].map(subprofile => ({op: 10, offset: subprofile * 128 + pos}))} : {}),
    ...(mode === 'modTap' ? {holdTimeRawAt: {op: 5, pos}} : {}),
    keymapReads: (mode === 'dks' ? [0, 1, 2, 3] : mode === 'modTap' ? [0, 1] : [0]).map(subprofile => ({profile, subprofile, layerRaw: profile * 4 + subprofile, matrixPos: pos, command: 'GET_KEYMATRIX', pages: 8, pageSize: 64})),
  };
}

function targetHid(hid, label) {
  if (!Number.isInteger(hid) || !(hid === 0 || (hid >= 4 && hid <= 115) || (hid >= 224 && hid <= 231))) {
    throw new RangeError(`${label} must be a valid keyboard HID or 0`);
  }
  return hid;
}

function currentMaps(snapshot) {
  if (!Array.isArray(snapshot.keymaps) || snapshot.keymaps.length !== 4 ||
      snapshot.keymaps.some(map => !Array.isArray(map) || map.length !== 512 || !map.every(b => Number.isInteger(b) && b >= 0 && b <= 255))) {
    throw new Error('Advanced bindings need all four current profile keymaps.');
  }
  return snapshot.keymaps;
}

/**
 * Build a pure, snapshot-aware plan from user-facing HID settings. This does
 * not send anything to the keyboard. `changes` use the magnetism table shape
 * consumed by the backup/write/readback boundary; `remaps` use absolute layer
 * numbers (`profile * 4 + subprofile`) and configToMatrix records.
 */
export function buildAdvancedBindingPlan(snapshot, settings) {
  if (!snapshot || !settings) throw new TypeError('snapshot and settings are required');
  validateSnapshot(snapshot);
  const profile = snapshot.profile;
  if (!Number.isInteger(profile) || profile < 0 || profile > 4) throw new RangeError('profile must be 0..4');
  if (!snapshot.tables || !Array.isArray(snapshot.tables[7]) || snapshot.tables[7].length !== 128) throw new Error('The RT80 mode table is unavailable.');
  if (!snapshot.tables[9]) throw new Error('Advanced RT80 settings are unavailable.');

  const {hid, mode} = settings;
  const pos = matrixPos(hid);
  const modeByte = snapshot.tables[7][pos];
  const currentMode = modeByte & 127;
  if (![0, 2, 3, 4, 5, 7].includes(currentMode)) throw new Error('The selected key has an unsupported RT80 mode.');

  const changes = [];
  const pushChange = (op, at, value) => {
    if (snapshot.tables[op]?.[at] !== value) changes.push({op, pos: at, value});
  };
  const remaps = [];
  let maps;
  const addRemap = (subprofile, target, at = pos) => {
    maps ??= currentMaps(snapshot);
    targetHid(target, `target ${subprofile}`);
    const bytes = [0, 0, target, 0];
    const map = maps[subprofile];
    const offset = at * 4;
    if (bytes.some((b, i) => map[offset + i] !== b)) remaps.push({layer: profile * 4 + subprofile, pos: at, bytes});
  };

  // A special binding can replace a healthy Snap pair, but must never silently
  // detach a malformed one. Turn off the reciprocal partner and clear both
  // linkage bytes as part of the same verified operation.
  if (currentMode === 7) {
    const partner = snapshot.tables[9][pos];
    if (!Number.isInteger(partner) || partner < 0 || partner >= MATRIX.length || partner === pos || !MATRIX[partner] ||
        (snapshot.tables[7][partner] & 127) !== 7 || snapshot.tables[9][partner] !== pos) {
      throw new Error('The selected key has a broken Snap pairing; repair it in GearHub first.');
    }
    pushChange(7, partner, snapshot.tables[7][partner] & 128);
    pushChange(9, partner, 0);
    pushChange(9, pos, 0);
  }

  let nextMode;
  if (mode === 'dks') {
    nextMode = MODE.dks;
    if (!Array.isArray(settings.targets) || settings.targets.length !== 4) throw new TypeError('DKS needs four target HIDs.');
    if (!Array.isArray(settings.triggerActions) || settings.triggerActions.length !== 4) throw new TypeError('DKS needs actions for four subprofiles.');
    if (!Array.isArray(snapshot.tables[10]) || snapshot.tables[10].length !== 512) throw new Error('DKS trigger-action state is unavailable.');
    if (!Array.isArray(snapshot.tables[4]) || snapshot.tables[4].length !== 128) throw new Error('DKS trigger-travel state is unavailable.');
    const packed = settings.triggerActions.map(packedDksActions);
    const travel = rawDksTravel(settings.triggerTravel);
    for (let subprofile = 0; subprofile < 4; subprofile++) addRemap(subprofile, settings.targets[subprofile]);
    const current = Array.from({length: 4}, (_, subprofile) => snapshot.tables[10][subprofile * 128 + pos]);
    if (packed.some((v, i) => current[i] !== v)) changes.push({op: 8, pos, values: packed});
    pushChange(4, pos, travel);
  } else if (mode === 'modTap') {
    nextMode = MODE.modTap;
    if (!Array.isArray(snapshot.tables[5]) || snapshot.tables[5].length !== 128) throw new Error('Mod Tap timing state is unavailable.');
    addRemap(0, targetHid(settings.holdHid, 'holdHid'));
    addRemap(1, targetHid(settings.tapHid, 'tapHid'));
    pushChange(5, pos, rawModTapTime(settings.holdMs));
  } else if (mode === 'toggleHold' || mode === 'toggleRepeat') {
    nextMode = MODE[mode];
    if (settings.actionTargetHid !== undefined) addRemap(0, targetHid(settings.actionTargetHid, 'actionTargetHid'));
  } else {
    throw new Error('unsupported advanced key mode');
  }

  pushChange(7, pos, (modeByte & 128) | nextMode);
  return {changes, remaps};
}

export {decodeDksActions, packedDksActions, rawDksTravel, rawModTapTime};
