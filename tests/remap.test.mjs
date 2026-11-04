import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MATRIX} from '../protocol.mjs';
import {buildRemap,decodeRemaps} from '../remap.mjs';

function snapshot(profileRaw=8){
  return {modelId:2068,firmware:515,profile:profileRaw/4,profileRaw,mode:3,
    tables:Object.fromEntries([0,1,2,3,6,7].map(op=>[op,Array(128).fill(op===6?39:0)])),
    keymap:Array(512).fill(0)};
}

test('builds simple target writes at RT80 physical positions and preserves unselected data',()=>{
  const s=snapshot();
  s.keymap.splice(4*4,4,7,8,9,10); // Unknown binding on an unselected key.
  s.keymap.splice(21*4,4,0,0,7,0);
  const changes=buildRemap(s,[{hid:4,targetHid:224},{hid:7,targetHid:0}]);
  assert.deepEqual(changes,[
    {layer:8,pos:9,bytes:[0,0,224,0]},
    {layer:8,pos:21,bytes:[0,0,0,0]}
  ]);
  assert.deepEqual(s.keymap.slice(4*4,4*4+4),[7,8,9,10]);
});

test('does not emit writes for already matching remaps',()=>{
  const s=snapshot(16);
  s.keymap.splice(9*4,4,0,0,42,0);
  assert.deepEqual(buildRemap(s,[{hid:4,targetHid:42}]),[]);
});

test('decodes physical records and retains unsupported raw bindings',()=>{
  const keymap=Array(512).fill(0);
  keymap.splice(9*4,4,0,0,42,0);
  keymap.splice(21*4,4,1,2,3,4);
  keymap.splice(15*4,4,0,0,1,0); // Reserved protocol IDs are not simple mappings.
  keymap.splice(89*4,4,0,0,231,0);
  const decoded=decodeRemaps(keymap);
  assert.equal(decoded.length,MATRIX.slice(0,90).filter(Boolean).length);
  assert.deepEqual(decoded.find(x=>x.hid===4),{hid:4,targetHid:42,raw:[0,0,42,0],simple:true});
  assert.deepEqual(decoded.find(x=>x.hid===7),{hid:7,targetHid:3,raw:[1,2,3,4],simple:false});
  assert.deepEqual(decoded.find(x=>x.hid===22),{hid:22,targetHid:1,raw:[0,0,1,0],simple:false});
  assert.deepEqual(decoded.find(x=>x.hid===79),{hid:79,targetHid:231,raw:[0,0,231,0],simple:true});
});

test('rejects bad snapshots, unsupported physical keys, duplicate keys, and invalid target HID',()=>{
  const s=snapshot();
  assert.throws(()=>buildRemap({...s,profileRaw:20},[{hid:4,targetHid:1}]));
  for(const patch of [
    [{hid:0,targetHid:1}],
    [{hid:999,targetHid:1}],
    [{hid:4,targetHid:116}],
    [{hid:4,targetHid:1}],
    [{hid:4,targetHid:2}],
    [{hid:4,targetHid:3}],
    [{hid:4,targetHid:223}],
    [{hid:4,targetHid:232}],
    [{hid:4,targetHid:1},{hid:4,targetHid:2}],
  ])assert.throws(()=>buildRemap(s,patch));
  assert.throws(()=>buildRemap({...s,keymap:Array(360).fill(0)},[{hid:4,targetHid:1}]));
  assert.throws(()=>decodeRemaps(Array(360).fill(0)));
});
