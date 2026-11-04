import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MATRIX,buildChanges,publicState,validateSnapshot} from '../protocol.mjs';

function snapshot(){return {modelId:2068,firmware:515,profile:0,profileRaw:0,mode:3,tables:Object.fromEntries([0,1,2,3,6,7].map(op=>[op,Array(128).fill(op===6?39:0)]))};}
test('RT80 physical matrix positions match source, including A/D and nonalphabetical order',()=>{
  assert.equal(MATRIX.length,128);assert.equal(MATRIX.indexOf(4),9);assert.equal(MATRIX.indexOf(7),21);assert.equal(MATRIX.indexOf(26),14);assert.equal(MATRIX.indexOf(22),15);assert.equal(MATRIX.indexOf(44),41);
  assert.equal(new Set(MATRIX.filter(Boolean)).size,MATRIX.filter(Boolean).length);
});
test('patch changes selected key, preserves snap mode and unrelated fields',()=>{
  const s=snapshot();s.tables[7][9]=7;
  const changes=buildChanges(s,[{hid:4,actuation:0.2,rtEnabled:true,rtDown:0.3,rtUp:0.4}]);
  assert.deepEqual(changes,[{op:0,pos:9,value:1},{op:2,pos:9,value:2},{op:3,pos:9,value:3},{op:7,pos:9,value:135}]);
  assert.equal(s.tables[7][9],7);assert(!changes.some(c=>[1,6].includes(c.op)));
});
test('rejects out of range, false precision, nonboolean RT, duplicates, nonexistent keys, advanced mode',()=>{
  const p={hid:4,actuation:0.2,rtEnabled:true,rtDown:0.2,rtUp:0.2};
  for(const patch of [{...p,actuation:4},{...p,actuation:NaN},{...p,actuation:0.15},{...p,rtEnabled:1},{...p,hid:0},{...p,hid:999}])assert.throws(()=>buildChanges(snapshot(),[patch]));
  assert.throws(()=>buildChanges(snapshot(),[p,p]));const s=snapshot();s.tables[7][9]=2;assert.throws(()=>buildChanges(s,[p]));
});
test('read state decoding and snapshot validation fail closed',()=>{
  const s=snapshot();s.tables[0][9]=1;s.tables[7][9]=135;s.tables[2][9]=2;s.tables[3][9]=3;
  const a=publicState(s).keys.find(k=>k.hid===4);assert.equal(a.actuation,.2);assert.equal(a.rtDown,.3);assert.equal(a.rtUp,.4);assert.equal(a.option,7);assert.equal(a.rtEnabled,true);
  assert.throws(()=>validateSnapshot({...s,modelId:1846}));assert.throws(()=>validateSnapshot({...s,tables:{}}));assert.throws(()=>validateSnapshot({...s,profileRaw:20}));
});
