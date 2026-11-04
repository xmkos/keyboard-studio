import test from 'node:test';
import assert from 'node:assert/strict';
import {MATRIX} from '../protocol.mjs';
import {RT80_LIGHT_EFFECTS, encodeMainLightSetting, mainLightReadRequest, decodeMainLightSetting, encodeCustomPicture, customPictureReadRequests, decodeCustomPicture} from '../rgb.mjs';

test('RT80 effect contract matches the model RGB layout', () => {
  assert.equal(RT80_LIGHT_EFFECTS.length, 21);
  assert.deepEqual(RT80_LIGHT_EFFECTS.find(x => x.type === 'LightWave').options, ['right','left','down','up']);
  assert.deepEqual(RT80_LIGHT_EFFECTS.find(x => x.type === 'LightUserPicture').options, ['pattern1','pattern2','pattern3']);
  assert.equal(RT80_LIGHT_EFFECTS.find(x => x.type === 'LightNeon').maxSpeed, 0);
});

test('main LED encoder and decoder preserve effect, speed, options and RGB', () => {
  const sent = encodeMainLightSetting({type:'LightWave', speed:2, bright:4, option:3, rgb:0xffffff, dazzle:true});
  assert.equal(sent.length, 64);
  assert.deepEqual([...sent.slice(0, 8)], [7,4,2,4,0x38,0xfa,0xff,0xfa]);
  const reply = new Uint8Array(64);
  reply.set([135,4,2,4,0x38,0xfa,0xff,0xfa]);
  assert.deepEqual(decodeMainLightSetting(reply), {type:'LightWave',speed:2,bright:4,option:3,rgb:0xffffff,dazzle:true});
  assert.equal(mainLightReadRequest()[0], 135);
  assert.throws(() => encodeMainLightSetting({type:'LightWave',speed:5,bright:4,option:0,rgb:0}));
  assert.throws(() => encodeMainLightSetting({type:'LightWave',speed:0,bright:5,option:0,rgb:0}));
  assert.throws(() => encodeMainLightSetting({type:'LightWave',speed:0,bright:4,option:4,rgb:0}));
  assert.throws(() => encodeMainLightSetting({type:'LightWave',speed:0,bright:4,option:0,rgb:0,dazzle:'false'}));
});

test('music-follow and user-picture use GearHub-specific mode nibbles', () => {
  assert.equal(encodeMainLightSetting({type:'LightMusicFollow2',speed:1,bright:3,option:2,dazzle:true})[4], 0x20);
  assert.deepEqual([...encodeMainLightSetting({type:'LightUserPicture',speed:0,bright:4,option:1}).slice(0,8)], [7,13,4,4,0x10,0,200,200]);
});

test('custom per-key picture uses RT80 matrix positions and fixed GearHub pages', () => {
  const keyHid = MATRIX.find((hid, pos) => pos < 90 && hid !== 0);
  const pages = encodeCustomPicture([{hid:keyHid,rgb:0x123456}]);
  assert.equal(pages.length,7);
  assert.deepEqual([...pages[0].slice(0,8)], [12,0,0,1,0,0,0,0]);
  const pos = MATRIX.indexOf(keyHid);
  assert.deepEqual([...pages[Math.floor(pos * 3 / 56)].slice(8 + ((pos * 3) % 56), 8 + ((pos * 3) % 56) + 3)], [0x12,0x34,0x56]);
  assert.deepEqual(customPictureReadRequests().map(x => [...x]), Array.from({length:6},(_,p)=>[140,0,p]));
  const readPages = Array.from({length:6},()=>new Uint8Array(64));
  for (let i=0;i<pages.length;i++) for (let j=0;j<56;j++) {
    const offset=i*56+j;
    if (offset < 270) readPages[Math.floor(offset/64)][offset%64]=pages[i][8+j];
  }
  assert.equal(decodeCustomPicture(readPages).find(x=>x.hid===keyHid).rgb,0x123456);
  assert.throws(() => encodeCustomPicture([{hid:0,rgb:0}]));
  assert.throws(() => encodeCustomPicture([{hid:keyHid,rgb:-1}]));
});
