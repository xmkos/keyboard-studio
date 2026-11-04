import {MATRIX} from './protocol.mjs';
export function buildPicture(current,settings){
 if(!Array.isArray(current)||current.length!==384||!current.every(v=>Number.isInteger(v)&&v>=0&&v<=255))throw new Error('Кольори клавіш не зчитано.');
 if(!settings||!Array.isArray(settings.hids)||!settings.hids.length||new Set(settings.hids).size!==settings.hids.length||!Number.isInteger(settings.rgb)||settings.rgb<0||settings.rgb>0xffffff)throw new Error('Некоректні кольори клавіш.');
 const rgb=settings.rgb===0xffffff?0xfafffa:settings.rgb;
 const result=current.slice();for(const hid of settings.hids){const pos=MATRIX.indexOf(hid);if(!hid||pos<0||pos>=90)throw new Error('Клавіші немає на RT80.');result.splice(pos*3,3,(rgb>>16)&255,(rgb>>8)&255,rgb&255);}return result;
}
