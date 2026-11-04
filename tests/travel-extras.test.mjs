import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildTravelExtras,MATRIX} from '../protocol.mjs';
test('release and deadzone encode selected keys and reject invalid input',()=>{
 const tables=Object.fromEntries([0,1,2,3,6,7].map(op=>[op,Array(128).fill(0)]));const s={modelId:2068,firmware:515,profile:0,profileRaw:0,mode:3,tables};const pos=MATRIX.indexOf(4);
 assert.deepEqual(buildTravelExtras(s,{hids:[4],release:1.5,deadzone:0.2}),[{op:1,pos,value:14},{op:6,pos,value:37}]);
 assert.throws(()=>buildTravelExtras(s,{hids:[4],release:1.5,deadzone:1.1}));assert.throws(()=>buildTravelExtras(s,{hids:[4,4],release:1,deadzone:0}));
});
