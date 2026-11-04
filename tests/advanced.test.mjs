import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildAdvancedChanges,publicState} from '../protocol.mjs';
const snapshot=()=>({modelId:2068,firmware:515,profile:0,profileRaw:0,mode:3,tables:Object.fromEntries([0,1,2,3,4,5,6,7,9,10].map(op=>[op,Array(op===10?512:128).fill(0)]))});
function apply(s,changes){for(const c of changes)s.tables[c.op][c.pos]=c.value;return s;}
test('Snap replaces reciprocal pairs, releases former partner and preserves RT',()=>{
 const s=snapshot();s.tables[7][9]=135;s.tables[7][21]=7;s.tables[9][9]=21;s.tables[9][21]=9;
 const next=apply(structuredClone(s),buildAdvancedChanges(s,{hid:4,mode:'snap',partnerHid:26}));
 assert.equal(next.tables[7][9],135);assert.equal(next.tables[9][9],14);assert.equal(next.tables[7][14],7);assert.equal(next.tables[9][14],9);assert.equal(next.tables[7][21],0);assert.equal(next.tables[9][21],0);
 assert.equal(publicState(next).keys.find(k=>k.hid===4).snapPartnerHid,26);
});
test('editing a current Snap pair is idempotent; toggling clears both links',()=>{
 const s=snapshot();apply(s,buildAdvancedChanges(s,{hid:4,mode:'snap',partnerHid:7}));
 assert.deepEqual(buildAdvancedChanges(s,{hid:4,mode:'snap',partnerHid:7}),[]);
 const next=apply(structuredClone(s),buildAdvancedChanges(s,{hid:4,mode:'toggleHold'}));
 assert.equal(next.tables[7][9],4);assert.equal(next.tables[7][21],0);assert.equal(next.tables[9][9],0);assert.equal(next.tables[9][21],0);
});
test('invalid/ambiguous bindings and DKS/MT changes fail without mutation',()=>{
 const s=snapshot();const before=JSON.stringify(s);
 for(const x of [{hid:0,mode:'normal'},{hid:4,mode:'snap',partnerHid:4},{hid:4,mode:'snap',partnerHid:999},{hid:4,mode:'dks'}])assert.throws(()=>buildAdvancedChanges(s,x));
 assert.equal(JSON.stringify(s),before);s.tables[7][9]=3;assert.throws(()=>buildAdvancedChanges(s,{hid:4,mode:'normal'}));s.tables[7][9]=7;assert.throws(()=>buildAdvancedChanges(s,{hid:4,mode:'normal'}));
});
