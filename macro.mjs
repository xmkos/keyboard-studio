import {MATRIX} from './protocol.mjs';
export function macroReferences(snapshot){
 if(!Array.isArray(snapshot.allKeymaps)||snapshot.allKeymaps.length!==20||!snapshot.fnmap)throw new Error('Усі шари та Fn мають бути зчитані для перевірки макросів.');
 const refs=new Map();const scan=(map,scope)=>{if(!Array.isArray(map)||map.length!==512)throw new Error('Пошкоджений шар призначень.');for(let pos=0;pos<90;pos++)if(map[pos*4]===9){const id=map[pos*4+2];if(!refs.has(id))refs.set(id,[]);refs.get(id).push({scope,pos});}};
 snapshot.allKeymaps.forEach((map,i)=>scan(map,`layer:${i}`));scan(snapshot.fnmap,'fn');return refs;
}
export function macroFrames(index,bytes){
 if(!Number.isInteger(index)||index<0||index>255||!Array.isArray(bytes)||bytes.length!==256||!bytes.every(b=>Number.isInteger(b)&&b>=0&&b<=255))throw new Error('Некоректні дані макросу.');
 const chunks=Array.from({length:5},(_,i)=>bytes.slice(i*56,i*56+56)),used=chunks.map(c=>c.some(x=>x!==0)),count=used.filter(Boolean).length;
 if(!count||used.some((v,i)=>v!==(i<count)))throw new Error('Формат макросу не можна безпечно записати без перевірки пристрою.');
 return chunks.slice(0,count).map((c,i)=>[22,index,i,56,i===count-1?1:0,0,0,0,...c,...Array(56-c.length).fill(0)]);
}
export function planMacros(snapshot,macros,fnRaw,keymapsRaw,restore=false,targets=[],allocated=[]){
 const refs=macroReferences(snapshot),allowed=new Map((fnRaw||[]).map(row=>[`fn:${MATRIX.indexOf(row.hid)}`,row.bytes]));
 for(const row of keymapsRaw||[])for(let sub=0;sub<4;sub++)allowed.set(`layer:${snapshot.profile*4+sub}:${MATRIX.indexOf(row.hid)}`,row.bindings[sub]);
 const out=[];Object.defineProperty(out,'orphaned',{value:[]});
 const final=structuredClone(snapshot);for(const row of fnRaw||[]){const pos=MATRIX.indexOf(row.hid);final.fnmap.splice(pos*4,4,...row.bytes);}for(const row of keymapsRaw||[]){const pos=MATRIX.indexOf(row.hid);for(let sub=0;sub<4;sub++)final.allKeymaps[snapshot.profile*4+sub].splice(pos*4,4,...row.bindings[sub]);}const finalRefs=macroReferences(final);
 for(const [key,bytes] of Object.entries(macros||{})){const id=Number(key);if(!restore&&![...allowed.values()].some(raw=>raw[0]===9&&raw[2]===id))throw new Error('Макрос не використовується кінцевим профілем.');const old=snapshot.macros?.[key];if(!Array.isArray(old)||old.length!==256)throw new Error('Початковий макрос не зчитано; запис заблоковано.');if(bytes.every((b,i)=>old[i]===b))continue;
  if(restore&&bytes.every(b=>b===0)&&allocated.includes(id)){if(finalRefs.has(id))throw new Error('Виділений макрос ще використовується; відновлення заблоковано.');out.orphaned.push(id);continue;}
  macroFrames(id,bytes);const allocation=old.every(b=>b===0)&&!(refs.get(id)||[]).length&&!restore;
  if(!allocation)try{macroFrames(id,old);}catch{throw new Error('Початковий макрос неможливо безпечно відновити; запис заблоковано.');}
  for(const ref of refs.get(id)||[]){const target=allowed.get(`${ref.scope}:${ref.pos}`),map=ref.scope==='fn'?snapshot.fnmap:snapshot.allKeymaps[Number(ref.scope.slice(6))];if(!target||(target.every((b,i)=>b===map[ref.pos*4+i])&&!targets.some(t=>t.index===id&&t.scope===ref.scope&&MATRIX.indexOf(t.hid)===ref.pos)))throw new Error('Макрос використовується іншим шаром або клавішею; перенесення заблоковано.');}
  out.push({index:id,bytes:bytes.slice(),...(allocation?{allocation:true}:{})});
 }
 return out;
}

export function encodeMacroEvents(repeat,events){
 if(!Number.isInteger(repeat)||repeat<0||repeat>65535||!Array.isArray(events)||!events.length)throw new Error('Вкажи повторення та список подій.');
 const out=[repeat&255,repeat>>8];
 for(const event of events){const delay=event?.delay;if(!Number.isInteger(delay)||delay<1||delay>65535)throw new Error('Затримка має бути цілим числом 1–65535 мс.');
  if(event.type==='move'){if(!Number.isInteger(event.dx)||event.dx< -128||event.dx>127||!Number.isInteger(event.dy)||event.dy< -128||event.dy>127)throw new Error('Рух миші має бути від -128 до 127.');out.push(249,delay<=127?delay:0,event.dx&255,event.dy&255);if(delay>127)out.push(delay&255,delay>>8);}
  else {const code=event.code;if(!['key','mouse'].includes(event.type)||!Number.isInteger(code)||(event.type==='key'?(code<4||code>239):(code<240||code>244))||!['down','up'].includes(event.action))throw new Error('Некоректна подія клавіші або кнопки миші.');out.push(code,delay<=127?(event.action==='down'?delay+128:delay):(event.action==='down'?128:0));if(delay>127)out.push(delay&255,delay>>8);}
 }
 if(out.length>256)throw new Error('Макрос перевищує 256 байтів.');return out.concat(Array(256-out.length).fill(0));
}
