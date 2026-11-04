import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSleep} from '../sleep.mjs';
test('sleep edits preserve deep timers, validate bounds and require a live snapshot',()=>{
 const before=[120,0,60,0,144,6,128,7];
 assert.deepEqual(buildSleep(before,{bt:1080,wired:0}),[56,4,0,0,144,6,128,7]);
 assert.deepEqual(before,[120,0,60,0,144,6,128,7]);
 for(const settings of [{bt:1081,wired:0},{bt:-1,wired:0},{bt:0.5,wired:0}]) assert.throws(()=>buildSleep(before,settings));
 assert.throws(()=>buildSleep(null,{bt:0,wired:0}));
});
