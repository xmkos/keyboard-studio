import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MATRIX} from '../protocol.mjs';
import {buildNative,validateNative} from '../profiles.mjs';

function snapshot(){
  const tables=Object.fromEntries([0,1,2,3,4,5,6,7,9,10].map(op=>[op,Array(op===10?512:128).fill(0)]));
  tables[6].fill(39);
  const keymaps=Array.from({length:4},()=>Array(512).fill(0));
  return {modelId:2068,firmware:515,profile:2,profileRaw:8,mode:3,tables,keymaps,keymap:keymaps[0]};
}

test('validates known native profile features and reciprocal Snap pairs',()=>{
  const profile={rgb:{type:'LightAlwaysOn',bright:3},remaps:[{hid:4,targetHid:224}],advanced:[
    {hid:4,mode:'snap',partnerHid:7},{hid:7,mode:'snap',partnerHid:4},{hid:26,mode:'toggleHold'}
  ]};
  assert.equal(validateNative(profile),profile);
  for(const invalid of [
    {unsupported:true},
    {remaps:[{hid:4,targetHid:1}]},
    {remaps:[{hid:4,targetHid:4},{hid:4,targetHid:7}]},
    {remaps:[{hid:4,targetHid:232}]},
    {advanced:[{hid:4,mode:'dks'}]},
    {advanced:[{hid:4,mode:'snap',partnerHid:7}]},
    {advanced:[{hid:4,mode:'snap',partnerHid:7},{hid:7,mode:'toggleHold'}]},
    {advanced:[{hid:4,mode:'snap',partnerHid:4},{hid:4,mode:'snap',partnerHid:4}]},
    {advanced:[{hid:4,mode:'normal',partnerHid:7}]},
    {advanced:[{hid:4,mode:'dks',targets:[4,7,8,9],triggerActions:[[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]],triggerTravel:0.75}]},
    {advanced:[{hid:4,mode:'dks',targets:[4,7,8,9],triggerActions:[[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]],triggerTravel:0.7,extra:true}]},
    {advanced:[{hid:4,mode:'modTap',holdHid:4,tapHid:7,holdMs:205}]},
    {advanced:[{hid:0,mode:'normal'}]},
    {rgb:{type:'LightAlwaysOn',bright:5}},
    {rgb:{type:'LightAlwaysOn',bright:2,unexpected:true}},
  ])assert.throws(()=>validateNative(invalid));
});

test('buildNative combines RGB, remaps, and sequential advanced changes without mutating inputs',()=>{
  const s=snapshot();
  const posA=MATRIX.indexOf(4),posB=MATRIX.indexOf(7);
  s.tables[7][posA]=7;s.tables[7][posB]=7;s.tables[9][posA]=posB;s.tables[9][posB]=posA;
  const before=structuredClone(s);
  const native={
    rgb:{type:'LightAlwaysOn',bright:3},
    remaps:[{hid:4,targetHid:224}],
    advanced:[{hid:4,mode:'normal'},{hid:7,mode:'toggleHold'}]
  };
  const plan=buildNative(s,native);
  assert.deepEqual(plan.changes,[
    {op:7,pos:posA,value:0},{op:9,pos:posA,value:0},
    {op:7,pos:posB,value:4},{op:9,pos:posB,value:0}
  ]);
  assert.deepEqual(plan.remaps,[{layer:8,pos:posA,bytes:[0,0,224,0]}]);
  assert.equal(plan.lighting[0],7);assert.equal(plan.lighting[1],1);assert.equal(plan.lighting[3],3);
  assert.deepEqual(s,before);
  assert.equal(native.advanced[0].mode,'normal');
});

test('buildNative rejects unsupported current modes, missing advanced tables, and absent keymap when required',()=>{
  const native={advanced:[{hid:4,mode:'normal'}]};
  const s=snapshot();
  s.tables[7][MATRIX.indexOf(26)]=6;
  assert.throws(()=>buildNative(s,native));
  const noAdvanced=snapshot();delete noAdvanced.tables[9];
  assert.throws(()=>buildNative(noAdvanced,native));
  const noKeymap=snapshot();delete noKeymap.keymap;
  assert.throws(()=>buildNative(noKeymap,{remaps:[{hid:4,targetHid:5}]}));
});

test('buildNative composes DKS and its bindings with basic remaps and returns exact table/keymap diffs',()=>{
  const s=snapshot(),before=structuredClone(s),pos=MATRIX.indexOf(4);
  const plan=buildNative(s,{
    remaps:[{hid:4,targetHid:115}],
    advanced:[{hid:4,mode:'dks',targets:[7,8,9,10],triggerActions:[[1,2,2,0],[0,1,2,1],[3,2,1,0],[2,2,2,1]],triggerTravel:0.7}]
  });
  assert.deepEqual(plan.changes,[
    {op:4,pos,value:5},{op:7,pos,value:2},{op:8,pos,values:[41,100,27,106]}
  ]);
  assert.deepEqual(plan.remaps.map(x=>[x.layer,x.pos,x.bytes]),[
    [8,pos,[0,0,7,0]],[9,pos,[0,0,8,0]],[10,pos,[0,0,9,0]],[11,pos,[0,0,10,0]]
  ]);
  assert.deepEqual(s,before);
});

test('buildNative composes Mod Tap bindings and timing without requiring a base-layer remap entry',()=>{
  const s=snapshot(),pos=MATRIX.indexOf(4);
  const plan=buildNative(s,{advanced:[{hid:4,mode:'modTap',holdHid:224,tapHid:115,holdMs:200}]});
  assert.deepEqual(plan.changes,[{op:5,pos,value:20},{op:7,pos,value:3}]);
  assert.deepEqual(plan.remaps.map(x=>[x.layer,x.pos,x.bytes]),[
    [8,pos,[0,0,224,0]],[9,pos,[0,0,115,0]]
  ]);
});

test('native profile preserves and plans source-backed sleep, side and travel fields',()=>{
 const s=snapshot();s.sleep=[10,0,20,0,111,1,222,2];s.side=[1,0,2,7,1,2,3];
 const native={sleep:{bt:90,wired:120},side:{effect:2,speed:3,brightness:4,rgb:0x112233,dazzle:false},travel:[{hid:4,release:1.5,deadzone:0.2}]};
 const plan=buildNative(s,JSON.parse(JSON.stringify(native)));const pos=MATRIX.indexOf(4);
 assert.deepEqual(plan.sleep,[90,0,120,0,111,1,222,2]);assert.deepEqual(plan.side,[8,2,3,4,7,17,34,51]);
 assert.ok(plan.changes.some(x=>x.op===1&&x.pos===pos&&x.value===14));assert.ok(plan.changes.some(x=>x.op===6&&x.pos===pos&&x.value===37));
 assert.throws(()=>buildNative({...s,sleep:null},native));
});

test('Fn native profile compares against live Fn layer, not base mappings',()=>{
 const s=snapshot(),pos=MATRIX.indexOf(4);s.fnmap=Array(512).fill(0);s.keymap[pos*4+2]=7;
 const plan=buildNative(s,{fn:[{hid:4,targetHid:7}]});assert.deepEqual(plan.fnremaps,[{pos,bytes:[0,0,7,0]}]);
 assert.throws(()=>buildNative({...s,fnmap:null},{fn:[{hid:4,targetHid:7}]}));
 assert.deepEqual(buildNative(s,{fn:[]}).fnremaps,undefined);
});

test('portable picture profile preserves destination opaque tail',()=>{const s=snapshot();s.picture=Array(270).fill(1).concat(Array(114).fill(91));const plan=buildNative(s,{picture:Array(270).fill(7)});assert.deepEqual(plan.picture.slice(0,270),Array(270).fill(7));assert.deepEqual(plan.picture.slice(270),Array(114).fill(91));});

test('raw Fn profile preserves complex binding bytes and requires a live layer',()=>{const s=snapshot(),pos=MATRIX.indexOf(4);s.fnmap=Array(512).fill(0);const row={hid:4,bytes:[24,224,115,20]};assert.deepEqual(buildNative(s,{fnRaw:[row]}).fnremaps,[{pos,bytes:row.bytes}]);assert.throws(()=>buildNative({...s,fnmap:null},{fnRaw:[row]}));assert.throws(()=>validateNative({fnRaw:[{hid:4,bytes:[999,0,0,0]}]}));});

test('portable Fn profile cannot introduce macro references without macro content',()=>{const s=snapshot();s.fnmap=Array(512).fill(0);const row={hid:4,bytes:[9,0,2,0]};assert.throws(()=>buildNative(s,{fnRaw:[row]}),/макрос/);const pos=MATRIX.indexOf(4);s.fnmap.splice(pos*4,4,...row.bytes);assert.deepEqual(buildNative(s,{fnRaw:[row]}).fnremaps,[]);});
