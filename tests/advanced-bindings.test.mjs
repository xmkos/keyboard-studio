import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildAdvancedBindingFrames, buildAdvancedBindingPlan, decodeDksActions, packedDksActions} from '../advanced-bindings.mjs';

function snapshot(profile = 2) {
  return {
    modelId: 2068, firmware: 512, profile, profileRaw: profile * 4, mode: 3,
    tables: Object.fromEntries([[0, 128], [1, 128], [2, 128], [3, 128], [4, 128], [5, 128], [6, 128], [7, 128], [9, 128], [10, 512]].map(([op, n]) => [op, Array(n).fill(0)])),
    keymaps: Array.from({length: 4}, () => Array(512).fill(0)),
    keymap: Array(512).fill(0),
  };
}

test('DKS packs four constrained 2-bit stage codes per each of four subprofiles', () => {
  const triggerActions = [[1, 2, 2, 0], [0, 1, 2, 1], [3, 2, 1, 0], [2, 2, 2, 1]];
  const plan = buildAdvancedBindingFrames({
    profile: 2, hid: 41, mode: 'dks', fire: true,
    bindings: [[0, 4, 5, 0], [0, 6, 7, 0], [0, 8, 9, 0], [0, 10, 11, 0]],
    triggerActions, triggerTravel: 0.7,
  });
  assert.deepEqual(triggerActions.map(packedDksActions), [41, 100, 27, 106]);
  assert.deepEqual(decodeDksActions(41), [1, 2, 2, 0]);
  assert.deepEqual(plan.bindingWrites.map(frame => [frame[0], frame[1], frame[2], [...frame.slice(8, 12)]]), [
    [19, 8, 0, [0, 4, 5, 0]], [19, 9, 0, [0, 6, 7, 0]],
    [19, 10, 0, [0, 8, 9, 0]], [19, 11, 0, [0, 10, 11, 0]],
  ]);
  assert.deepEqual(plan.magneticWrites.map(frame => [...frame]), [
    [101, 7, 0, 0, 0, 0, 0, 0, 130],
    [101, 4, 0, 0, 0, 0, 0, 0, 5],
    [101, 8, 0, 0, 1, 0, 0, 0, 41, 100, 27, 106],
  ]);
  assert.deepEqual(plan.readback.triggerActionBytesAt.map(x => x.offset), [0, 128, 256, 384]);
  assert.deepEqual(plan.readback.keymapReads.map(x => x.layerRaw), [8, 9, 10, 11]);
  assert.deepEqual(plan.readback.magneticRequests.filter(x => x[1] === 10).map(x => [...x]), Array.from({length: 8}, (_, page) => [229, 10, 1, page]));
});

test('Mod Tap maps hold to subprofile 0 and tap to subprofile 1 with 10 ms units', () => {
  const plan = buildAdvancedBindingFrames({profile: 1, hid: 41, mode: 'modTap', holdMs: 200, bindings: {hold: [0, 10, 0, 0], tap: [0, 11, 0, 0]}});
  assert.deepEqual(plan.bindingWrites.map(frame => [frame[1], [...frame.slice(8, 12)]]), [[4, [0, 10, 0, 0]], [5, [0, 11, 0, 0]]]);
  assert.deepEqual(plan.magneticWrites.map(frame => [...frame]), [[101, 7, 0, 0, 0, 0, 0, 0, 3], [101, 5, 0, 0, 1, 0, 0, 0, 20]]);
  assert.deepEqual(plan.readback.magneticRequests.map(frame => [...frame]), [[229, 7, 1, 0], [229, 7, 1, 1], [229, 5, 1, 0], [229, 5, 1, 1]]);
});

test('Toggle variants use their distinct mode bytes and one binding subprofile', () => {
  for (const [mode, rawMode] of [['toggleHold', 4], ['toggleRepeat', 5]]) {
    const plan = buildAdvancedBindingFrames({profile: 0, hid: 41, mode, bindings: [0, 12, 0, 0]});
    assert.equal(plan.bindingWrites.length, 1);
    assert.deepEqual([...plan.magneticWrites[0]], [101, 7, 0, 0, 1, 0, 0, 0, rawMode]);
    assert.deepEqual(plan.readback.magneticRequests.map(x => [...x]), [[229, 7, 1, 0], [229, 7, 1, 1]]);
  }
});

test('Rejects malformed DKS action arrays, invalid time and non-RT80 keys', () => {
  assert.throws(() => packedDksActions([0, 0, 0, 4]));
  assert.throws(() => packedDksActions([0, 1, 2, 3]));
  assert.throws(() => buildAdvancedBindingFrames({profile: 0, hid: 41, mode: 'dks', bindings: Array(4).fill([0, 4, 0, 0]), triggerActions: Array(4).fill([0, 0, 0, 0]), triggerTravel: 0.75}));
  assert.throws(() => buildAdvancedBindingFrames({profile: 0, hid: 41, mode: 'modTap', holdMs: 205, bindings: {hold: [0, 1, 0, 0], tap: [0, 1, 0, 0]}}));
  assert.throws(() => buildAdvancedBindingFrames({profile: 0, hid: 999, mode: 'toggleHold', bindings: [0, 1, 0, 0]}));
});

test('Builds snapshot-aware DKS changes and absolute-layer remaps', () => {
  const state = snapshot();
  const plan = buildAdvancedBindingPlan(state, {
    hid: 41, mode: 'dks', targets: [4, 5, 6, 7], triggerActions: [[1, 2, 2, 0], [0, 1, 2, 1], [3, 2, 1, 0], [2, 2, 2, 1]], triggerTravel: 0.7,
  });
  assert.deepEqual(plan.changes, [{op: 8, pos: 0, values: [41, 100, 27, 106]}, {op: 4, pos: 0, value: 5}, {op: 7, pos: 0, value: 2}]);
  assert.deepEqual(plan.remaps, [4, 5, 6, 7].map((target, subprofile) => ({layer: 8 + subprofile, pos: 0, bytes: [0, 0, target, 0]})));
  assert.deepEqual(state.tables[7], Array(128).fill(0));
});

test('Builds Mod Tap, allows mode-only Toggle plans, and validates Snap before detaching', () => {
  const state = snapshot(1);
  const mt = buildAdvancedBindingPlan(state, {hid: 41, mode: 'modTap', holdHid: 225, tapHid: 4, holdMs: 200});
  assert.deepEqual(mt.changes, [{op: 5, pos: 0, value: 20}, {op: 7, pos: 0, value: 3}]);
  assert.deepEqual(mt.remaps, [
    {layer: 4, pos: 0, bytes: [0, 0, 225, 0]},
    {layer: 5, pos: 0, bytes: [0, 0, 4, 0]},
  ]);
  const toggle = snapshot(1);
  delete toggle.keymaps;
  assert.deepEqual(buildAdvancedBindingPlan(toggle, {hid: 41, mode: 'toggleHold'}), {changes: [{op: 7, pos: 0, value: 4}], remaps: []});

  const snapped = snapshot(1);
  snapped.tables[7][0] = 7;
  snapped.tables[7][1] = 7;
  snapped.tables[9][0] = 1;
  snapped.tables[9][1] = 0;
  const detached = buildAdvancedBindingPlan(snapped, {hid: 41, mode: 'toggleRepeat'});
  assert.deepEqual(detached.changes, [
    {op: 7, pos: 1, value: 0}, {op: 9, pos: 0, value: 0}, {op: 7, pos: 0, value: 5},
  ]);
  snapped.tables[9][1] = 2;
  assert.throws(() => buildAdvancedBindingPlan(snapped, {hid: 41, mode: 'toggleRepeat'}), /broken Snap pairing/);
});
