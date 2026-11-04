import {test} from 'node:test';import assert from 'node:assert/strict';import {buildMainLed} from '../options.mjs';
test('main LED changes only its flag and requires a snapshot',()=>{assert.deepEqual(buildMainLed([0xad,0x81,7],true),[0xad,0x81,7]);assert.deepEqual(buildMainLed([0xad,0x81,7],false),[0xbd,0x81,7]);assert.throws(()=>buildMainLed(null,true));});
