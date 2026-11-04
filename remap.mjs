import {MATRIX,validateSnapshot} from './protocol.mjs?v=mw27j5wi';

// GearHub's configToMatrix at index-bundle offset 1866266 encodes a normal
// mapping as [0,0,targetHid,0]. GET 137 returns eight 64-byte pages; the first
// 90 four-byte records describe the current profile's base matrix layer and
// the remaining bytes are firmware padding. Fn banks are not handled here.
const KEYMAP_BYTES=512;
const MATRIX_POSITIONS=90;

function validHid(hid){
  return Number.isInteger(hid)&&(hid===0||(hid>=4&&hid<=115)||(hid>=224&&hid<=231));
}

function asKeymap(keymap){
  if(!Array.isArray(keymap)||keymap.length!==KEYMAP_BYTES||!keymap.every(b=>Number.isInteger(b)&&b>=0&&b<=255))
    throw new Error('Пошкоджена таблиця перепризначень RT80.');
  return keymap;
}

function asSettings(settings){
  if(!Array.isArray(settings)||settings.length===0||settings.length>MATRIX.filter((hid,pos)=>hid&&pos<MATRIX_POSITIONS).length)
    throw new Error('Вибери клавіші, присутні на RT80.');
  const seen=new Set();
  return settings.map(setting=>{
    if(!setting||!Number.isInteger(setting.hid)||seen.has(setting.hid))throw new Error('Некоректна або дубльована клавіша.');
    seen.add(setting.hid);
    const pos=MATRIX.indexOf(setting.hid);
    if(!setting.hid||pos<0||pos>=MATRIX_POSITIONS)throw new Error('Цієї клавіші немає на RT80.');
    if(!validHid(setting.targetHid))throw new Error('Некоректний HID-код призначення.');
    return {hid:setting.hid,targetHid:setting.targetHid,pos};
  });
}

/** Build only the selected key writes; unselected and unknown bindings are untouched. */
export function buildRemap(snapshot,settings){
  validateSnapshot(snapshot);
  const keymap=asKeymap(snapshot.keymap);
  return asSettings(settings).flatMap(({pos,targetHid})=>{
    const bytes=[0,0,targetHid,0],offset=pos*4;
    if(bytes.every((b,i)=>keymap[offset+i]===b))return [];
    return [{layer:snapshot.profileRaw,pos,bytes}];
  });
}

/** Decode the RT80's first 90 four-byte matrix bindings, retaining raw records. */
export function decodeRemaps(keymap){
  asKeymap(keymap);
  return MATRIX.slice(0,MATRIX_POSITIONS).flatMap((hid,pos)=>{
    if(!hid)return [];
    const offset=pos*4,raw=keymap.slice(offset,offset+4);
    const simple=raw[0]===0&&raw[1]===0&&raw[3]===0&&validHid(raw[2]);
    return [{hid,targetHid:raw[2],raw,simple}];
  });
}
