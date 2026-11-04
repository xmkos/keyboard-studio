import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeTrigger,matrixHids,decodeMchose,parseDumpText,ROWS} from '../mchose.mjs';

test('one trigger record decodes in 0.01 mm units',()=>{
  const [k]=decodeTrigger([0xa0,0x01,0x71,0x00,0x1d,0x1e,0x1d,0x1e]);
  assert.deepEqual(k,{switchType:0,keyMode:1,priority:0,actuation:1.14,rtPress:0.3,rtRelease:0.3,pressDeadzone:0.15,releaseDeadzone:0.15});
});
test('matrix entries map to HID codes',()=>{
  assert.deepEqual(matrixHids([0x10,0,0x14, 0xf0,0xff,1, 0,0,0]),[0x14,255,null]);
});
test('ROWS has the 68 keys of the Ace68',()=>{
  assert.equal(ROWS.flat().length,68);
});
test('a real Ace68-II dump decodes into 4 profiles with all keys mapped',()=>{
  const d=decodeMchose(parseDumpText(readFileSync(new URL('./ace68ii-dump.txt',import.meta.url),'utf8')));
  assert.equal(d.profiles.length,4);
  assert.equal(d.firmware,'0x0121');
  assert.match(d.build,/Nov\s+8 2025/);
  for(const p of d.profiles){
    const keys=p.rows.flat();
    assert.equal(keys.length,68);
    assert.ok(keys.filter(k=>k.travel).length>=66,'almost every key has travel data');
    for(const k of keys.filter(k=>k.travel))assert.ok(k.travel.actuation>=0.1&&k.travel.actuation<=4.5,`${k.label} actuation ${k.travel.actuation}`);
  }
});

test('encodeKeyPatch round-trips through decodeTrigger and keeps unknown bits',async()=>{
  const {encodeKeyPatch}=await import('../engine.mjs');
  const rec=[0xa0,0x01,0x71,0x00,0x1d,0x1e,0x1d,0x1e];
  const out=encodeKeyPatch(rec,{actuation:3.5,rtPress:0.25,rtRelease:0.35,pressDeadzone:0.1,releaseDeadzone:0.2,keyMode:0});
  const [k]=decodeTrigger(out);
  assert.deepEqual(k,{switchType:0,keyMode:0,priority:0,actuation:3.5,rtPress:0.25,rtRelease:0.35,pressDeadzone:0.1,releaseDeadzone:0.2});
  assert.equal(out[0],0xa0);
  assert.deepEqual(encodeKeyPatch(rec,{}),rec);
  assert.throws(()=>encodeKeyPatch(rec,{rtPress:0}),/RT/);
  assert.throws(()=>encodeKeyPatch(rec,{pressDeadzone:2}),/Мертва/);
  assert.throws(()=>encodeKeyPatch(rec,{keyMode:2}),/Режим/);
});
