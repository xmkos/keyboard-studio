import {MATRIX,validateSnapshot,buildAdvancedChanges,buildTravelExtras} from './protocol.mjs?v=mw27j5wi';
import {encodeMainLightSetting} from './rgb.mjs?v=mw27j5wi';
import {buildSleep} from './sleep.mjs?v=mw27j5wi';
import {planMacros} from './macro.mjs?v=mw27j5wi';
import {buildSide} from './side.mjs?v=mw27j5wi';
import {buildRemap} from './remap.mjs?v=mw27j5wi';
import {buildAdvancedBindingPlan,packedDksActions,rawDksTravel,rawModTapTime} from './advanced-bindings.mjs?v=mw27j5wi';

const MATRIX_POSITIONS=90;
const MODES=new Set(['normal','snap','toggleHold','toggleRepeat','dks','modTap']);
const PHYSICAL_HIDS=new Set(MATRIX.slice(0,MATRIX_POSITIONS).filter(Boolean));
const TARGET_HID=hid=>Number.isInteger(hid)&&(hid===0||(hid>=4&&hid<=115)||(hid>=224&&hid<=231));

function object(value,label){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${label} має бути об’єктом.`);
  return value;
}
function exactKeys(value,allowed,label){
  for(const key of Object.keys(value))if(!allowed.includes(key))throw new Error(`Непідтримуване поле ${label}.${key}.`);
}
function validateRows(rows,label,limit){
  if(!Array.isArray(rows)||rows.length>limit)throw new Error(`Некоректний список ${label}.`);
  const seen=new Set();
  for(const row of rows){
    object(row,label);
    if(!Number.isInteger(row.hid)||!PHYSICAL_HIDS.has(row.hid)||seen.has(row.hid))throw new Error(`Некоректна або дубльована фізична клавіша у ${label}.`);
    seen.add(row.hid);
  }
  return seen;
}

/** Validate the portable RT80-only profile shape without changing its input. */
export function validateNative(native){
  object(native,'Профіль RT80');
  exactKeys(native,['rgb','remaps','advanced','sleep','side','travel','fn','fnRaw','picture','mainLedOn','macros','keymapsRaw','macroTargets'],'profile');
  if(native.macroTargets!==undefined){if(!Array.isArray(native.macroTargets)||native.macroTargets.length>256)throw new Error('Некоректні цілі макросів.');const seen=new Set();for(const t of native.macroTargets){object(t,'macroTargets');exactKeys(t,['index','scope','hid'],'macroTargets');if(!Number.isInteger(t.index)||t.index<0||t.index>255||!PHYSICAL_HIDS.has(t.hid)||!['fn','sub:0','sub:1','sub:2','sub:3'].includes(t.scope)||seen.has(t.index))throw new Error('Некоректна ціль макросу.');seen.add(t.index);}}
  if(native.macros!==undefined){object(native.macros,'macros');for(const [id,bytes] of Object.entries(native.macros)){if(!/^(0|[1-9]\d{0,2})$/.test(id)||Number(id)>255||!Array.isArray(bytes)||bytes.length!==256||!bytes.every(b=>Number.isInteger(b)&&b>=0&&b<=255)||!(native.fnRaw?.some(row=>row.bytes?.[0]===9&&row.bytes?.[2]===Number(id))||native.keymapsRaw?.some(row=>row.bindings?.some(raw=>raw[0]===9&&raw[2]===Number(id)))))throw new Error('Некоректний або непов’язаний макрос у профілі.');}}
  if(native.mainLedOn!==undefined&&typeof native.mainLedOn!=='boolean')throw new Error('Некоректний стан основного підсвічування.');
  if(native.picture!==undefined&&(!Array.isArray(native.picture)||native.picture.length!==270||!native.picture.every(b=>Number.isInteger(b)&&b>=0&&b<=255)))throw new Error('Некоректні кольори клавіш у профілі.');
  if(native.keymapsRaw!==undefined){validateRows(native.keymapsRaw,'keymapsRaw',PHYSICAL_HIDS.size);for(const row of native.keymapsRaw){exactKeys(row,['hid','bindings'],'keymapsRaw');if(!Array.isArray(row.bindings)||row.bindings.length!==4||row.bindings.some(raw=>!Array.isArray(raw)||raw.length!==4||!raw.every(b=>Number.isInteger(b)&&b>=0&&b<=255)))throw new Error('Некоректні байти шарів.');}}
  if(native.fn!==undefined&&native.fnRaw!==undefined)throw new Error('Профіль містить два формати Fn.');
  if(native.fnRaw!==undefined){validateRows(native.fnRaw,'fnRaw',PHYSICAL_HIDS.size);for(const row of native.fnRaw){exactKeys(row,['hid','bytes'],'fnRaw');if(!Array.isArray(row.bytes)||row.bytes.length!==4||!row.bytes.every(b=>Number.isInteger(b)&&b>=0&&b<=255))throw new Error('Некоректні байти Fn.');}}
  if(native.fn!==undefined){validateRows(native.fn,'fn',PHYSICAL_HIDS.size);for(const row of native.fn){exactKeys(row,['hid','targetHid'],'fn');if(!TARGET_HID(row.targetHid))throw new Error('Некоректний Fn HID.');}}
  if(native.sleep!==undefined){object(native.sleep,'sleep');exactKeys(native.sleep,['bt','wired'],'sleep');buildSleep(Array(8).fill(0),native.sleep);}
  if(native.side!==undefined){object(native.side,'side');exactKeys(native.side,['effect','speed','brightness','rgb','dazzle'],'side');buildSide(Array(7).fill(0),native.side);}
  if(native.travel!==undefined){validateRows(native.travel,'travel',PHYSICAL_HIDS.size);for(const row of native.travel){exactKeys(row,['hid','release','deadzone'],'travel');const tables=Object.fromEntries([0,1,2,3,6,7].map(op=>[op,Array(128).fill(0)]));buildTravelExtras({modelId:2068,firmware:515,profile:0,profileRaw:0,mode:3,tables},{hids:[row.hid],release:row.release,deadzone:row.deadzone});}}
  if(Object.hasOwn(native,'rgb')){
    object(native.rgb,'rgb');
    exactKeys(native.rgb,['type','bright','speed','option','rgb','dazzle'],'rgb');
    if(native.rgb.dazzle!==undefined&&typeof native.rgb.dazzle!=='boolean')throw new Error('RGB dazzle має бути логічним значенням.');
    encodeMainLightSetting(native.rgb);
  }
  if(Object.hasOwn(native,'remaps')){
    const seen=validateRows(native.remaps,'remaps',PHYSICAL_HIDS.size);
    for(const row of native.remaps){
      exactKeys(row,['hid','targetHid'],'remaps');
      if(!TARGET_HID(row.targetHid))throw new Error('Некоректний HID-код перепризначення.');
    }
    if(seen.size!==native.remaps.length)throw new Error('Дубльована клавіша у remaps.');
  }
  if(Object.hasOwn(native,'advanced')){
    const seen=validateRows(native.advanced,'advanced',PHYSICAL_HIDS.size);
    const byHid=new Map();
    for(const row of native.advanced){
      const fields=row.mode==='dks'?['hid','mode','targets','triggerActions','triggerTravel']:
        row.mode==='modTap'?['hid','mode','holdHid','tapHid','holdMs']:
        row.mode==='snap'?['hid','mode','partnerHid']:
        ['hid','mode',...(row.mode==='toggleHold'||row.mode==='toggleRepeat'?['actionTargetHid']:[])];
      exactKeys(row,fields,'advanced');
      if(!MODES.has(row.mode))throw new Error('Непідтримуваний режим клавіші RT80.');
      if(row.mode==='snap'){
        if(!Number.isInteger(row.partnerHid)||!PHYSICAL_HIDS.has(row.partnerHid)||row.partnerHid===row.hid)throw new Error('Snap має містити іншу фізичну клавішу-пару.');
      }else if(row.mode==='dks'){
        if(!Array.isArray(row.targets)||row.targets.length!==4||row.targets.some(target=>!TARGET_HID(target)))throw new Error('DKS має містити чотири коректні цільові HID-коди.');
        if(!Array.isArray(row.triggerActions)||row.triggerActions.length!==4)throw new Error('DKS має містити дії для чотирьох підпрофілів.');
        row.triggerActions.forEach(packedDksActions);
        rawDksTravel(row.triggerTravel);
      }else if(row.mode==='modTap'){
        if(!TARGET_HID(row.holdHid)||!TARGET_HID(row.tapHid))throw new Error('Mod Tap має містити коректні HID-коди Hold і Tap.');
        rawModTapTime(row.holdMs);
      }else if((row.mode==='toggleHold'||row.mode==='toggleRepeat')&&row.actionTargetHid!==undefined){
        if(!TARGET_HID(row.actionTargetHid))throw new Error('Некоректний HID-код дії Toggle.');
      }
      byHid.set(row.hid,row);
    }
    for(const row of native.advanced)if(row.mode==='snap'){
      const partner=byHid.get(row.partnerHid);
      if(!partner||partner.mode!=='snap'||partner.partnerHid!==row.hid)throw new Error('Snap-пари мають бути взаємними у профілі.');
    }
    if(seen.size!==native.advanced.length)throw new Error('Дубльована клавіша у advanced.');
  }
  return native;
}

function applyChanges(working,changes){
  for(const change of changes){
    if(change.op===8)for(let sub=0;sub<4;sub++)working.tables[10][sub*128+change.pos]=change.values[sub];
    else working.tables[change.op][change.pos]=change.value;
  }
}

function applyRemaps(snapshot,working,remaps){
  for(const map of remaps){
    if(!Number.isInteger(map.layer)||Math.floor(map.layer/4)!==snapshot.profile||!Number.isInteger(map.pos)||map.pos<0||map.pos>=MATRIX_POSITIONS||!Array.isArray(map.bytes)||map.bytes.length!==4)
      throw new Error('План містить некоректний шар перепризначень.');
    const subprofile=map.layer%4;
    if(working.keymaps){
      for(const byte of map.bytes)if(!Number.isInteger(byte)||byte<0||byte>255)throw new Error('План містить пошкоджені байти перепризначення.');
      working.keymaps[subprofile].splice(map.pos*4,4,...map.bytes);
    }else if(map.layer===snapshot.profileRaw){
      for(const byte of map.bytes)if(!Number.isInteger(byte)||byte<0||byte>255)throw new Error('План містить пошкоджені байти перепризначення.');
      working.keymap.splice(map.pos*4,4,...map.bytes);
    }else throw new Error('Для змін Fn-підшару потрібні всі чотири зчитані шари.');
  }
  if(working.keymaps)working.keymap=working.keymaps[snapshot.profileRaw%4];
}

function diffRemaps(snapshot,working){
  const remaps=[];
  if(snapshot.keymaps){
    for(let sub=0;sub<4;sub++)for(let pos=0;pos<MATRIX_POSITIONS;pos++)if(MATRIX[pos]){
      const offset=pos*4,bytes=working.keymaps[sub].slice(offset,offset+4);
      if(bytes.some((byte,i)=>byte!==snapshot.keymaps[sub][offset+i]))remaps.push({layer:snapshot.profile*4+sub,pos,bytes});
    }
  }else if(snapshot.keymap){
    for(let pos=0;pos<MATRIX_POSITIONS;pos++)if(MATRIX[pos]){
      const offset=pos*4,bytes=working.keymap.slice(offset,offset+4);
      if(bytes.some((byte,i)=>byte!==snapshot.keymap[offset+i]))remaps.push({layer:snapshot.profileRaw,pos,bytes});
    }
  }
  return remaps;
}

function diffTables(snapshot,working){
  const changes=[];
  for(let pos=0;pos<MATRIX_POSITIONS;pos++)if(MATRIX[pos]){
    for(const op of [1,4,5,6,7,9])if(snapshot.tables[op]?.[pos]!==working.tables[op]?.[pos])changes.push({op,pos,value:working.tables[op][pos]});
    if(snapshot.tables[10]&&working.tables[10]){
      const values=Array.from({length:4},(_,sub)=>working.tables[10][sub*128+pos]);
      if(values.some((value,sub)=>value!==snapshot.tables[10][sub*128+pos]))changes.push({op:8,pos,values});
    }
  }
  return changes;
}

/** Plan native RGB, simple remaps, and supported advanced modes without mutation. */
export function buildNative(snapshot,native){
  validateSnapshot(snapshot);
  validateNative(native);
  const working=structuredClone(snapshot);
  if(native.keymapsRaw){if(!working.keymaps)throw new Error('Шари не зчитано.');for(const row of native.keymapsRaw){const pos=MATRIX.indexOf(row.hid);for(let sub=0;sub<4;sub++){const bytes=row.bindings[sub],old=working.keymaps[sub].slice(pos*4,pos*4+4);if(bytes[0]===9&&bytes.some((b,i)=>b!==old[i])&&!native.macros?.[String(bytes[2])])throw new Error('Нове посилання на макрос без вмісту.');working.keymaps[sub].splice(pos*4,4,...bytes);}}working.keymap=working.keymaps[snapshot.profileRaw%4];}
  if(native.travel)for(const row of native.travel)applyChanges(working,buildTravelExtras(working,{hids:[row.hid],release:row.release,deadzone:row.deadzone}));
  if(native.remaps?.length)applyRemaps(snapshot,working,buildRemap(working,native.remaps));
  if(native.advanced?.length){
    if(!snapshot.tables[9])throw new Error('Спочатку онови стан розширених налаштувань.');
    for(let pos=0;pos<MATRIX_POSITIONS;pos++)if(MATRIX[pos]){
      const mode=snapshot.tables[7][pos]&127;
      if(![0,2,3,4,5,7].includes(mode))throw new Error('Профіль змінює лише відомі режими; спершу виправ інші режими у GearHub.');
    }
    for(const settings of native.advanced){
      if(settings.mode==='dks'||settings.mode==='modTap'||settings.actionTargetHid!==undefined){
        const plan=buildAdvancedBindingPlan(working,settings);
        applyChanges(working,plan.changes);
        applyRemaps(snapshot,working,plan.remaps);
      }else{
        const changes=buildAdvancedChanges(working,settings);
        applyChanges(working,changes);
      }
    }
  }
  return {
    changes:diffTables(snapshot,working),
    remaps:diffRemaps(snapshot,working),
    fnremaps:native.fnRaw?.length?(snapshot.fnmap?native.fnRaw.flatMap(row=>{const pos=MATRIX.indexOf(row.hid),different=row.bytes.some((b,i)=>b!==snapshot.fnmap[pos*4+i]);if(different&&row.bytes[0]===9&&!native.macros?.[String(row.bytes[2])])throw new Error('Профіль містить нове посилання на макрос без його вмісту.');return different?[{pos,bytes:row.bytes.slice()}]:[];}):(()=>{throw new Error('Fn не зчитано.');})()):native.fn?.length?buildRemap({...snapshot,keymap:snapshot.fnmap},native.fn).map(({pos,bytes})=>({pos,bytes})):undefined,
    macros:native.macros?planMacros(snapshot,native.macros,native.fnRaw,native.keymapsRaw?.map(row=>{const pos=MATRIX.indexOf(row.hid);return {hid:row.hid,bindings:working.keymaps.map(map=>map.slice(pos*4,pos*4+4))};}),false,native.macroTargets?.map(t=>({...t,scope:t.scope==='fn'?'fn':`layer:${snapshot.profile*4+Number(t.scope.slice(4))}`}))):undefined,
    picture:native.picture?(snapshot.picture?[...native.picture,...snapshot.picture.slice(270)]:(()=>{throw new Error('Кольори клавіш не зчитано.');})()):undefined,
    sleep:native.sleep?buildSleep(snapshot.sleep,native.sleep):undefined,
    side:native.side?buildSide(snapshot.side,native.side):undefined,
    lighting:native.rgb?encodeMainLightSetting(native.rgb):undefined,
  };
}
