import assert from 'node:assert/strict';
import fs from 'node:fs';
import {convertWootingProfile,parseWootingCode} from '../wooting.mjs';
const p = JSON.parse(fs.readFileSync(new URL('./wooting-fixture.json',import.meta.url),'utf8'));
const userFixture = JSON.parse(fs.readFileSync(new URL('./user-wooting-fixture.json',import.meta.url),'utf8'));
const before = JSON.stringify(p);
const out = convertWootingProfile(p);
assert.equal(JSON.stringify(p),before,'must not mutate source');
assert.equal(out.name,'Valorant');
assert.deepEqual(out.settings[26],{actuation:0.5,rtEnabled:true,rtUp:0.2,rtDown:0.2});
assert.deepEqual(out.settings[4],out.settings[26]);
assert.equal(out.settings[41].actuation,3.3);
assert.equal(out.settings[8].rtEnabled,false,'v15 sparse RT omissions are disabled');
assert(out.losses.some(v=>v.includes('split-spacebar')));
assert(out.losses.some(v=>v.includes('SOCD')));
assert.equal(out.settings[44].actuation,2);
const userOut=convertWootingProfile(userFixture);
assert.equal(userOut.name,'Valo');
assert.deepEqual(userOut.source,{version:14,device:10,layout:1});
assert.deepEqual(userOut.settings[26],{actuation:0.1,rtEnabled:true,rtUp:0.2,rtDown:0.2},'80HE ISO W uses legacy millimeter values and per-key RT');
assert.deepEqual(userOut.settings[4],{actuation:0.1,rtEnabled:true,rtUp:0.2,rtDown:0.2},'80HE ISO A maps to HID 4');
assert.deepEqual(userOut.settings[7],{actuation:0.1,rtEnabled:true,rtUp:0.2,rtDown:0.2},'80HE ISO D maps to HID 7');
assert.deepEqual(userOut.settings[44],{actuation:3,rtEnabled:true,rtUp:0.2,rtDown:0.2},'80HE ISO Space maps to HID 44');
assert.equal(userOut.settings[227].actuation,3.3,'out-of-range actuation clamps to RT80 maximum');
assert(userOut.losses.some(v=>v.includes('rounded/clamped')));
assert(userOut.losses.some(v=>v.includes('SOCD')),'unsupported AKC/SOCD is reported');
assert(userOut.losses.some(v=>v.includes('continuous/strict Rapid Trigger')),'unsupported strict RT behavior is reported');
assert.ok(convertWootingProfile({...userFixture.data,target:{device:10,layout:0}}).settings[4],'80HE ANSI is accepted (same coordinates as ISO)');
assert.throws(()=>convertWootingProfile({...userFixture.data,target:{device:9,layout:1}}),/unverified.*v14/);
assert.throws(()=>convertWootingProfile({...userFixture.data,analog:{...userFixture.data.analog,actPoint:-0.1}}),/non-negative/);
assert.throws(()=>convertWootingProfile({...userFixture.data,analog:{...userFixture.data.analog,perKeyRapidTrigger:[{index:{rowNr:2,colNr:0},value:{sensitivity:'0.2'}}]}}),/finite non-negative/);
function change(fn) { const v=structuredClone(p.data);fn(v);return v; }
assert.throws(()=>convertWootingProfile(change(v=>v.version=16)),/v14.*v15/);
assert.throws(()=>convertWootingProfile(change(v=>v.target.device=99)),/unverified/);
assert.throws(()=>convertWootingProfile(change(v=>v.target.layout=2)),/unverified/);
assert.throws(()=>convertWootingProfile(change(v=>{v.target.device=4;v.target.layout=3;})),/unverified/);
assert.throws(()=>convertWootingProfile(change(v=>v.analog.actPoint=NaN)),/integer/);
assert.throws(()=>convertWootingProfile(change(v=>v.analog.rapidTrigger='false')),/boolean/);
assert.throws(()=>convertWootingProfile(change(v=>v.customActuations.push(v.customActuations[0]))),/duplicate/);
assert.throws(()=>convertWootingProfile(change(v=>v.customActuations[0].index.rowNr=-1)),/coordinate/);
assert.throws(()=>convertWootingProfile(change(v=>v.analog.enableDigital=false)),/disabled/);
const symmetric=convertWootingProfile(change(v=>{delete v.analog.perKeyRapidTrigger;v.analog.rapidTrigger=true;}));
assert.equal(symmetric.settings[8].rtEnabled,true);
const asymmetric=convertWootingProfile(change(v=>{v.analog.perKeyRapidTrigger[0].value.secondarySensitivity=1638;}));
assert.equal(asymmetric.settings[26].rtUp,0.4);
assert.equal(asymmetric.settings[26].rtDown,0.2);
assert.equal(convertWootingProfile(change(v=>v.analog.actPoint=0)).settings[8].actuation,0.1);
const iso=convertWootingProfile(change(v=>{v.target.device=4;v.target.layout=1;v.customActuations.push({index:{rowNr:4,colNr:1},value:8192});}));
assert.equal(iso.settings[100].actuation,2,'ISO extra key maps to Non-US backslash');
const isoSplit=convertWootingProfile(change(v=>{v.target.layout=4;v.customActuations.push({index:{rowNr:4,colNr:1},value:8192});}));
assert.equal(isoSplit.settings[100].actuation,2);
assert(isoSplit.losses.some(v=>v.includes('split-spacebar')));
const code='0123456789abcdef0123456789abcdef0123';
const custom=`web+wootwoot://import-profile?code=${code}`;
const shared=`https://wootility.io/?protocol=${encodeURIComponent(custom)}`;
assert.equal(parseWootingCode(code),code);
assert.equal(parseWootingCode(custom),code);
assert.equal(parseWootingCode(shared),code);
assert.equal(parseWootingCode(code.toUpperCase()),code.toUpperCase(),'preserves code case');
for(const bad of [
  '0123456789abcdef0123456789abcdef012',
  `web+wootwoot://import-profile?code=${code}&code=${code}`,
  `web+wootwoot://import-profile?code=${code}&extra=1`,
  `web+wootwoot://user@import-profile?code=${code}`,
  `web+wootwoot://wrong-host?code=${code}`,
  `web+wootwoot://import-profile?code=${code}#fragment`,
  `http://wootility.io/?protocol=${encodeURIComponent(custom)}`,
  `https://evil.example/?protocol=${encodeURIComponent(custom)}`,
  `https://user:pass@wootility.io/?protocol=${encodeURIComponent(custom)}`,
  `https://wootility.io/other?protocol=${encodeURIComponent(custom)}`,
  `https://wootility.io/?protocol=${encodeURIComponent(custom)}&protocol=${encodeURIComponent(custom)}`,
  `https://wootility.io/?protocol=${encodeURIComponent(`https://evil.example/?code=${code}`)}`,
]) assert.throws(()=>parseWootingCode(bad),/Wooting import:/);
console.log('Wooting importer: sharing-link parsing, profile mapping, validation, quantization and RT semantics passed.');

