import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {convertWootingProfile} from '../wooting.mjs';

test('SOCD pairs on layer 0 become Snap pairs (A/D and W/S in the Valo profile)', () => {
  const p = convertWootingProfile(JSON.parse(readFileSync(new URL('./valo-fixture.json', import.meta.url), 'utf8')));
  assert.deepEqual(p.snapPairs, [[4, 7], [26, 22]]);
  assert.ok(p.losses.some(l => l.startsWith('SOCD / Rappy Snappy key pairs are imported')));
});

test('SOCD entry with an unmapped key is not imported as a pair', () => {
  const raw = JSON.parse(readFileSync(new URL('./valo-fixture.json', import.meta.url), 'utf8'));
  raw.data.akc = [{socd: {secondaryKey: {rowNr: 0, colNr: 5}, socd: 4}, keyIndex: {rowNr: 3, colNr: 1}, layer: 0}];
  const p = convertWootingProfile(raw);
  assert.equal(p.snapPairs, undefined);
  assert.ok(p.losses.some(l => l.includes('cannot be mapped')));
});

for (const [code, version, pairs] of [['74a58e7b4bc60a4ea8b45ec75f941d197e24', 14, [[7, 4], [22, 26]]], ['e3a4ff0a9ff22bd3ffc986f41675beb6fa45', 15, undefined]]) {
  test(`80HE ANSI profile ${code.slice(0, 6)} (v${version}) imports`, () => {
    const p = convertWootingProfile(JSON.parse(readFileSync(new URL(`./80he-ansi-${version}.json`, import.meta.url), 'utf8')));
    assert.equal(p.settings[26].actuation, version === 14 ? 0.4 : 0.9, 'W');
    assert.equal(p.settings[44].actuation, version === 14 ? 3 : 2.7, 'Space');
    assert.equal(p.settings[41].actuation, version === 14 ? 3 : 2, 'Esc is row 0 col 0 on the 80HE');
    assert.deepEqual(p.snapPairs?.map(pair => [...pair].sort((a, b) => a - b)).sort(), pairs && pairs.map(pair => [...pair].sort((a, b) => a - b)).sort());
  });
}
