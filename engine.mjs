// Keyboard Studio engine: runs in the browser. WebHID talks to the keyboard, backups live in this browser.
// It replaces the old Node server: app.mjs calls call(url, body) exactly as it used to fetch('/api/...').
import {MATRIX,buildChanges,buildAdvancedChanges,buildTravelExtras,publicState,validateSnapshot} from './protocol.mjs';
import {encodeMainLightSetting,decodeMainLightSetting} from './rgb.mjs';
import {buildRemap,decodeRemaps} from './remap.mjs';
import {buildNative} from './profiles.mjs';
import {buildAdvancedBindingPlan} from './advanced-bindings.mjs';
import {buildSleep} from './sleep.mjs';
import {buildSide} from './side.mjs';
import {buildPicture} from './picture.mjs';
import {buildMainLed} from './options.mjs';
import {macroReferences,planMacros} from './macro.mjs';
import {createDevice,czFrame} from './hid.mjs';

// Any 0x3151 (YUNZII) device is offered, so a friend with another model can still connect and send a log. Writes stay locked to RT80 (model 2068) in hid.mjs.
const FILTERS=[{vendorId:0x3151}];

// ---- diagnostics: a small in-memory log the user can copy and send; nothing is uploaded ----
const LOG=[];
export function log(kind,text){LOG.push(`${new Date().toISOString().slice(11,23)} ${kind} ${text}`);if(LOG.length>800)LOG.shift();}
const hex=a=>Array.from(a.slice(0,16),b=>b.toString(16).padStart(2,'0')).join(' ');
const describe=d=>`${d.productName||'?'} vid=${d.vendorId.toString(16)} pid=${d.productId.toString(16)} opened=${d.opened} collections=[${d.collections.map(c=>`usagePage=${c.usagePage.toString(16)} usage=${c.usage.toString(16)} feature=[${(c.featureReports||[]).map(r=>`id${r.reportId}:${(r.items||[]).reduce((n,i)=>n+i.reportSize*i.reportCount,0)/8}B`).join(',')}] in=${(c.inputReports||[]).length} out=${(c.outputReports||[]).length}`).join(' | ')}]`;
export async function diagnostics(){
  const granted=hidSupported()?await navigator.hid.getDevices().catch(()=>[]):[];
  return ['Keyboard Studio diagnostics',`time: ${new Date().toISOString()}`,`browser: ${navigator.userAgent}`,`webhid: ${hidSupported()} secureContext: ${isSecureContext}`,`granted devices: ${granted.length?'':'none'}`,...granted.map(d=>'  '+describe(d)),`connected: ${dev?describe(dev):'no'}`,'--- log (tx/rx = first 16 bytes of each 64-byte feature report) ---',...LOG].join('\n');
}
export const hidSupported=()=>typeof navigator!=='undefined'&&!!navigator.hid;
let hid=null,dev=null,onProgress=()=>{},lastAll=null,prog={step:1,steps:1};
export const setProgressHandler=fn=>{onProgress=fn;};
const setStep=(step,steps,text)=>{prog={step,steps};onProgress({busy:true,step,steps,pct:0,text});};
const report=(pct,text)=>onProgress({busy:true,...prog,pct,text});

const timeout=(p,ms)=>new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('Клавіатура не відповіла вчасно.')),ms);p.then(v=>{clearTimeout(t);res(v);},e=>{clearTimeout(t);rej(e);});});
const hasConfig=d=>d.collections.some(c=>c.featureReports?.length);
// requestDevice needs a click, so only the Connect/Refresh buttons pass prompt=true; page load reuses an earlier grant.
export async function connect(prompt){
  if(!hidSupported())throw new Error('Цей браузер не вміє працювати з USB HID. Відкрий сторінку в Chrome або Edge на комп’ютері.');
  if(dev?.opened)return;
  let list=(await navigator.hid.getDevices()).filter(d=>d.vendorId===0x3151);
  if(!list.some(hasConfig)&&prompt)list=await navigator.hid.requestDevice({filters:FILTERS});
  const d=list.find(hasConfig);
  log('connect',`candidates: ${list.length?list.map(describe).join(' ; '):'none'}`);
  if(!d)throw new Error(list.length?'Вибрано не той інтерфейс клавіатури. Натисни «Підключити» та вибери інший запис RT80 у списку.':'Клавіатуру не підключено. Натисни «Підключити», вибери RT80 і дозволь доступ.');
  if(!d.opened)await d.open();
  dev=d;lastAll=null;log('connect',`opened ${describe(d)}`);
  hid=createDevice({
    sendFeature:data=>dev.sendFeatureReport(0,data),
    getFeature:async()=>{const v=await timeout(dev.receiveFeatureReport(0),4000);const a=new Uint8Array(v.buffer,v.byteOffset,v.byteLength);return a.length===65?a.slice(1):a;}
  },{report,trace:(k,b)=>log(k,hex(b))});
}
// Read-only look at any HID device (any brand): descriptor layout plus a GET_FEATURE of each listed report. Nothing is written.
const reportInfo=r=>`id${r.reportId}[${(r.items||[]).map(i=>`up=${(i.usagePage||0).toString(16)} u=${(i.usages||[]).slice(0,4).map(u=>u.toString(16)).join('/')} ${i.reportSize}x${i.reportCount}`).join('; ')}]`;
// Read-only probe for the MCHOSE family (vid 0x41e4, 64-byte reports on usagePage 1 / usage 0). Sends only the two read commands the vendor driver uses for info (3, 4); no writes.
const hexAll=a=>Array.from(a,b=>b.toString(16).padStart(2,'0')).join(' ');
async function probeMchose(d){
  for(const [name,cmd] of [['info',3],['base',4]]){
    const reply=new Promise(res=>{const on=e=>{d.removeEventListener('inputreport',on);clearTimeout(t);res(e);};const t=setTimeout(()=>{d.removeEventListener('inputreport',on);res(null);},1500);d.addEventListener('inputreport',on);});
    try{await d.sendReport(0,czFrame(cmd,56));}catch(e){log('probe',`${name} send failed: ${e.message}`);continue;}
    const e=await reply;
    log('probe',`${name} (cmd ${cmd}) reply: ${e?hexAll(new Uint8Array(e.data.buffer,e.data.byteOffset,e.data.byteLength)):'none within 1.5s'}`);
  }
}
export async function inspect(){
  if(!hidSupported())throw new Error('Цей браузер не вміє працювати з USB HID. Відкрий сторінку в Chrome або Edge на комп’ютері.');
  let picked=[];
  try{picked=await navigator.hid.requestDevice({filters:[]});}catch(e){log('inspect',`picker: ${e.name}: ${e.message}`);}
  if(!picked.length)log('inspect','no device chosen (the list was empty or cancelled)');
  for(const d of picked){
    log('inspect',describe(d));
    const wasOpen=d.opened;
    try{if(!wasOpen)await d.open();}catch(e){log('inspect',`open failed: ${e.message}`);continue;}
    for(const c of d.collections){
      log('inspect',`collection usagePage=${c.usagePage.toString(16)} usage=${c.usage.toString(16)} in=[${(c.inputReports||[]).map(reportInfo)}] out=[${(c.outputReports||[]).map(reportInfo)}] feature=[${(c.featureReports||[]).map(reportInfo)}]`);
      for(const r of c.featureReports||[]){
        try{const v=await timeout(d.receiveFeatureReport(r.reportId),2000);log('inspect',`GET_FEATURE id${r.reportId} (${v.byteLength}B): ${hex(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))}`);}
        catch(e){log('inspect',`GET_FEATURE id${r.reportId} failed: ${e.message}`);}
      }
    }
    if(d.vendorId===0x41e4&&d.collections.some(c=>c.usagePage===1&&c.usage===0&&(c.outputReports||[]).length))await probeMchose(d);
    if(!wasOpen)await d.close().catch(()=>{});
  }
  return diagnostics();
}
export function watchDevice(onChange){
  if(!hidSupported())return;
  navigator.hid.addEventListener('disconnect',e=>{log('event','disconnect');if(e.device===dev){dev=null;hid=null;onChange();}});
  navigator.hid.addEventListener('connect',e=>{if(e.device.vendorId===0x3151)onChange();});
}

// ---- backups (browser storage; key = file name, so files from the old Node app import unchanged) ----
const BK='ks-backup:';
const names=()=>Object.keys(localStorage).filter(k=>k.startsWith(BK)).map(k=>k.slice(BK.length)).sort().reverse();
const nameOk=n=>/^rt80-[a-zA-Z0-9-]+\.json$/.test(n||'');
function saveBackup(name,text){
  try{localStorage.setItem(BK+name,text);}catch{throw new Error('Не вдалося зберегти резервну копію (браузер не дає місця). Запис скасовано.');}
  for(const old of names().slice(12))localStorage.removeItem(BK+old);
}
function backup(s,allocatedMacros=[]){
  const name=`rt80-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID().slice(0,8)}.json`;
  const {allKeymaps,...snapshot}=s; // restore never reads the other slots' layers
  saveBackup(name,JSON.stringify({format:'rt80-magnetic-backup',version:1,createdAt:new Date().toISOString(),allocatedMacros,snapshot},null,1));
  return name;
}
export const backupText=name=>nameOk(name)?localStorage.getItem(BK+name):null;
export function importBackup(text){
  const saved=JSON.parse(text);
  if(saved.format!=='rt80-magnetic-backup'||saved.version!==1)throw new Error('Це не резервна копія RT80.');
  validateSnapshot(saved.snapshot);
  const name=`rt80-imported-${Date.now().toString(36)}.json`;saveBackup(name,JSON.stringify(saved));return name;
}

// ---- keyboard access ----
async function device(request){
  if(!hid)throw new Error('Клавіатуру не підключено. Натисни «Підключити».');
  if((request.action==='read'||request.action==='apply')&&!request.full&&lastAll)request={...request,cache:lastAll};
  const snap=validateSnapshot(request.action==='read'?await hid.readState(request.extraMacros||[],request.cache):request.action==='switch'?await hid.switchSlot(request.slot,lastAll):await hid.applyWrite(request));
  if(snap.allKeymaps)lastAll=snap.allKeymaps;
  return snap;
}
// Keyboard operations run one at a time; a third waiting request is rejected.
let queue=Promise.resolve(),waiting=0;
function exclusive(fn){
  if(waiting>=2)throw new Error('Забагато операцій у черзі. Дочекайся завершення поточної.');
  waiting++;
  const run=queue.then(async()=>{waiting--;setStep(1,1,'Читаю клавіатуру');return await fn();});
  queue=run.catch(()=>{});
  return run;
}
async function revision(s){
  const copy=structuredClone(s);
  if(copy.allKeymaps&&copy.fnmap&&copy.macros){const refs=macroReferences(copy);copy.macros=Object.fromEntries(Object.entries(copy.macros).filter(([id])=>refs.has(Number(id))));}
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(copy)));
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function state(s){
  const exposed=publicState(s);
  if(s.keymaps)for(const key of exposed.keys)key.bindings=s.keymaps.map(map=>{const raw=map.slice(key.pos*4,key.pos*4+4);return {raw,targetHid:raw[2],simple:raw[0]===0&&raw[1]===0&&raw[3]===0};});
  return {...exposed,capabilities:{advanced:!!s.tables[9],bindings:!!s.keymaps,rgb:!!s.lighting,remap:!!s.keymap},macros:s.macros??{},options:s.options??null,picture:s.picture??null,fnmap:s.fnmap??null,side:s.side??null,sleep:s.sleep??null,rgb:s.lighting?decodeMainLightSetting(Uint8Array.from(s.lighting)):null,remaps:s.keymap?decodeRemaps(s.keymap):[],revision:await revision(s),backups:names()};
}
async function writeVerified(before,changes,mode,remaps=[],lighting=null,sleep=null,side=null,fnremaps=[],picture=null,options=null,macrowrites=[]){
  const after=await device({action:'apply',before,changes,mode,remaps,lighting,sleep,side,fnremaps,picture,options,macrowrites});
  for(const c of changes){const matches=c.op===8?c.values.every((b,i)=>after.tables[10][i*128+c.pos]===b):after.tables[c.op][c.pos]===c.value;if(!matches)throw new Error('Перевірка запису не пройшла. Використай резервну копію; автоматичний повтор запису вимкнено.');}
  if(after.profileRaw!==before.profileRaw||after.mode!==mode)throw new Error('Режим або профіль змінився під час запису. Перевір налаштування та резервну копію.');
  for(const map of remaps)if(map.bytes.some((b,i)=>(after.keymaps?.[map.layer%4]||after.keymap)[map.pos*4+i]!==b))throw new Error('Перевірка перепризначення не пройшла. Скористайся резервною копією.');
  for(const macro of macrowrites)if(!after.macros?.[macro.index]||macro.bytes.some((b,i)=>after.macros[macro.index][i]!==b))throw new Error('Перевірка макросу не пройшла. Скористайся резервною копією.');
  if(options&&(!after.options||options.some((b,i)=>after.options[i]!==b)))throw new Error('Перевірка стану підсвічування не пройшла.');
  if(picture&&(!after.picture||picture.slice(0,270).some((b,i)=>after.picture[i]!==b)))throw new Error('Перевірка кольорів клавіш не пройшла. Скористайся резервною копією.');
  for(const map of fnremaps)if(!after.fnmap||map.bytes.some((b,i)=>after.fnmap[map.pos*4+i]!==b))throw new Error('Перевірка Fn не пройшла. Скористайся резервною копією.');
  if(side&&(!after.side||side.slice(1).some((b,i)=>after.side[i]!==b)))throw new Error('Перевірка бокового RGB не пройшла. Скористайся резервною копією.');
  if(sleep&&(!after.sleep||sleep.some((b,i)=>after.sleep[i]!==b)))throw new Error('Перевірка параметрів сну не пройшла. Скористайся резервною копією.');
  if(lighting&&lighting.some((b,i)=>i>0&&after.lighting[i]!==b))throw new Error('Перевірка RGB не пройшла. Скористайся резервною копією.');
  return after;
}

const WRITES=['/api/apply','/api/advanced','/api/binding','/api/remap','/api/rgb','/api/travel-extras','/api/led','/api/picture','/api/fn','/api/side','/api/sleep','/api/restore'];
export async function call(url,data,opts){
  log('call',url);
  try{return await run(url,data,opts);}catch(e){log('error',`${url}: ${e.message}`);throw e;}
}
async function run(url,data,{prompt=false}={}){
  const u=new URL(url,'http://x'),path=u.pathname;
  await connect(prompt);
  if(path==='/api/state')return exclusive(async()=>state(await device({action:'read',full:u.searchParams.get('full')==='1'})));
  if(path==='/api/slot')return exclusive(async()=>{
    const before=await device({action:'read'});
    if(data.expectedRevision!==await revision(before))throw new Error('Дані змінилися. Онови стан.');
    if(!Number.isInteger(data.slot)||data.slot<0||data.slot>4)throw new Error('Некоректний слот.');
    if(data.slot===before.profile&&before.profileRaw===data.slot*4)return {state:await state(before),backup:null};
    const filename=backup(before);
    try{const after=await device({action:'switch',slot:data.slot});return {state:await state(after),backup:filename};}
    catch(e){throw new Error(`${e.message} Резервна копія: ${filename}`);}
  });
  if(!WRITES.includes(path))throw new Error('Невідома операція.');
  return exclusive(async()=>{
    let savedBackup;
    if(path==='/api/restore'){if(!nameOk(data.backup))throw new Error('Некоректна назва резервної копії.');const text=backupText(data.backup);if(!text)throw new Error('Резервну копію не знайдено в цьому браузері.');savedBackup=JSON.parse(text);}
    const rawMacroIds=Object.keys(path==='/api/restore'?(savedBackup?.snapshot?.macros||{}):(data.native?.macros||{}));
    if(rawMacroIds.some(id=>!/^(0|[1-9]\d{0,2})$/.test(id)||Number(id)>255))throw new Error('Некоректний індекс макросу.');
    setStep(1,3,'Читаю клавіатуру');
    const before=await device({action:'read',extraMacros:rawMacroIds.map(Number)});
    if(data.expectedRevision!==await revision(before))throw new Error('Дані клавіатури змінилися. Натисни «Оновити» та переглянь зміни знову.');
    let changes=[],mode=before.mode,remaps=[],lighting=null,sleep=null,side=null,fnremaps=[],picture=null,options=null,macrowrites=[],orphaned=[];
    if(path==='/api/restore'){
      const saved=savedBackup;
      if(saved.format!=='rt80-magnetic-backup'||saved.version!==1)throw new Error('Некоректний формат копії.');
      const old=validateSnapshot(saved.snapshot);if(old.profileRaw!==before.profileRaw)throw new Error('Копія належить іншому слоту. Спочатку перемкни клавіатуру на той слот.');
      if(old.options&&!before.options)throw new Error('Опції з копії зараз не зчитано; відновлення заблоковано.');
      if(old.options&&old.options.some((b,i)=>b!==before.options[i]))options=old.options;
      if(old.picture&&!before.picture)throw new Error('Кольори клавіш із копії зараз не зчитано; відновлення заблоковано.');
      if(old.picture&&old.picture.some((b,i)=>b!==before.picture[i]))picture=old.picture;
      if(old.fnmap&&!before.fnmap)throw new Error('Fn із копії зараз не зчитано; відновлення заблоковано.');
      if(old.fnmap)for(let pos=0;pos<90;pos++){if(!MATRIX[pos])continue;const bytes=old.fnmap.slice(pos*4,pos*4+4);if(bytes.some((b,i)=>b!==before.fnmap[pos*4+i]))fnremaps.push({pos,bytes});}
      if(old.side&&!before.side)throw new Error('Бокове RGB з копії зараз не зчитано; відновлення заблоковано.');
      if(old.sleep&&!before.sleep)throw new Error('Таймери сну з копії зараз не зчитано; відновлення заблоковано.');
      if(old.side&&before.side&&old.side.some((b,i)=>b!==before.side[i]))side=[8,...old.side];
      if(old.sleep&&before.sleep&&old.sleep.some((b,i)=>b!==before.sleep[i]))sleep=old.sleep;
      if(old.macros){const fnRaw=old.fnmap?MATRIX.slice(0,90).flatMap((h,pos)=>h?[{hid:h,bytes:old.fnmap.slice(pos*4,pos*4+4)}]:[]):[];const keymapsRaw=old.keymaps?MATRIX.slice(0,90).flatMap((h,pos)=>h?[{hid:h,bindings:old.keymaps.map(map=>map.slice(pos*4,pos*4+4))}]:[]):[];macrowrites=planMacros(before,old.macros,fnRaw,keymapsRaw,true,[],Array.isArray(saved.allocatedMacros)?saved.allocatedMacros:[]);orphaned=macrowrites.orphaned;}
      mode=old.mode;for(const op of [0,1,2,3,4,5,6,7,9])if(old.tables[op])for(let pos=0;pos<90;pos++){
        const value=op===7&&!old.tables[9]?(before.tables[7][pos]&127)|(old.tables[7][pos]&128):old.tables[op][pos];
        if(value!==before.tables[op][pos])changes.push({op,pos,value});
      }
      if(old.tables[10])for(let pos=0;pos<90;pos++){const values=Array.from({length:4},(_,i)=>old.tables[10][i*128+pos]);if(values.some((b,i)=>before.tables[10][i*128+pos]!==b))changes.push({op:8,pos,values});}
      if(old.keymaps)for(let sub=0;sub<4;sub++)for(let pos=0;pos<90;pos++){const bytes=old.keymaps[sub].slice(pos*4,pos*4+4);if(bytes.some((b,i)=>b!==before.keymaps[sub][pos*4+i]))remaps.push({layer:before.profile*4+sub,pos,bytes});}
      else if(old.keymap)for(let pos=0;pos<90;pos++){const bytes=old.keymap.slice(pos*4,pos*4+4);if(bytes.some((b,i)=>b!==before.keymap[pos*4+i]))remaps.push({layer:before.profileRaw,pos,bytes});}
      if(old.lighting&&old.lighting.some((b,i)=>i>0&&b!==before.lighting[i]))lighting=[7,...old.lighting.slice(1)];
    }else if(path==='/api/led'){options=buildMainLed(before.options,data.settings?.on);if(options.every((b,i)=>b===before.options[i]))options=null;}
    else if(path==='/api/picture'){picture=buildPicture(before.picture,data.settings);if(picture.every((b,i)=>b===before.picture[i]))picture=null;}
    else if(path==='/api/fn'){if(!before.fnmap)throw new Error('Спочатку зчитай Fn-шар.');const maps=buildRemap({...before,keymap:before.fnmap},[data.settings]);fnremaps=maps.map(({pos,bytes})=>({pos,bytes})).filter(m=>m.bytes.some((b,i)=>before.fnmap[m.pos*4+i]!==b));}
    else if(path==='/api/side'){side=buildSide(before.side,data.settings);if(side.slice(1).every((b,i)=>b===before.side[i]))side=null;}
    else if(path==='/api/travel-extras'){changes=buildTravelExtras(before,data.settings);mode=3;}
    else if(path==='/api/sleep'){sleep=buildSleep(before.sleep,data.settings);if(sleep.every((b,i)=>b===before.sleep[i]))sleep=null;}
    else if(path==='/api/advanced'){changes=buildAdvancedChanges(before,data.settings);mode=3;}
    else if(path==='/api/binding'){const plan=buildAdvancedBindingPlan(before,data.settings);changes=plan.changes;remaps=plan.remaps;mode=3;}
    else if(path==='/api/remap')remaps=buildRemap(before,[data.settings]);
    else if(path==='/api/rgb'){
      if(['LightMusicFollow2','LightScreenColor'].includes(data.settings?.type))throw new Error('Цей ефект потребує окремої служби або редактора кольорів.');
      lighting=Array.from(encodeMainLightSetting(data.settings).slice(0,8));
      if(lighting.every((b,i)=>i===0||b===before.lighting[i]))lighting=null;
    }else{
      if(data.expectedProfile!==before.profile)throw new Error('Змінився слот клавіатури.');
      let working=before;
      if(data.native!==undefined){
        const plan=buildNative(before,data.native);changes=plan.changes;remaps=plan.remaps;
        if(data.native.mainLedOn!==undefined){const next=buildMainLed(before.options,data.native.mainLedOn);if(next.some((b,i)=>b!==before.options[i]))options=next;}
        if(plan.sleep&&plan.sleep.some((b,i)=>b!==before.sleep[i]))sleep=plan.sleep;
        if(plan.fnremaps)fnremaps=plan.fnremaps;
        if(plan.macros)macrowrites=plan.macros;
        if(plan.picture&&plan.picture.some((b,i)=>b!==before.picture[i]))picture=plan.picture;
        if(plan.side&&plan.side.slice(1).some((b,i)=>b!==before.side[i]))side=plan.side;
        if(plan.lighting){lighting=Array.from(plan.lighting.slice(0,8));if(lighting.every((b,i)=>i===0||b===before.lighting[i]))lighting=null;}
        working=structuredClone(before);for(const c of changes){
          if(c.op===8)c.values.forEach((value,sub)=>working.tables[10][sub*128+c.pos]=value);
          else working.tables[c.op][c.pos]=c.value;
        }
      }
      const scalar=data.changes||[];
      if(!Array.isArray(scalar))throw new Error('Некоректні налаштування профілю.');
      if(scalar.length)changes.push(...buildChanges(working,scalar));
      else if(data.native===undefined)throw new Error('Немає змін для застосування.');
      // One final value per table/key also covers RT changes on a newly assigned mode.
      changes=[...new Map(changes.map(c=>[`${c.op}:${c.pos}`,c])).values()];
      if(changes.length)mode=3;
    }
    if(changes.length===0&&remaps.length===0&&!lighting&&!sleep&&!side&&!fnremaps.length&&!picture&&!options&&!macrowrites.length&&mode===before.mode)return {state:await state(before),backup:null,orphaned};
    setStep(2,3,'Створюю резервну копію');
    const filename=backup(before,macrowrites.filter(m=>m.allocation).map(m=>m.index));
    setStep(3,3,'Записую на клавіатуру');
    try{const after=await writeVerified(before,changes,mode,remaps,lighting,sleep,side,fnremaps,picture,options,macrowrites);return {state:await state(after),backup:filename,orphaned,allocatedMacros:macrowrites.filter(m=>m.allocation).map(m=>m.index)};}
    catch(e){throw new Error(`${e.message} Резервна копія: ${filename}`);}
  });
}

// Wooting's API may refuse browser requests (CORS); the caller then falls back to JSON import.
export async function wooting(code){
  if(!/^[0-9a-f]{36}$/i.test(code||''))throw new Error('Код Wooting має містити 36 шістнадцяткових символи.');
  let r;try{r=await fetch(`https://api.wooting.io/public/wootility/profiles?code=${code}`,{signal:AbortSignal.timeout(12000),redirect:'error'});}
  catch{throw new Error('Браузер не зміг звернутися до Wooting. Завантаж профіль у Wootility як JSON і імпортуй файлом.');}
  if(!r.ok)throw new Error(`Wooting повернув ${r.status}. Перевір код або імпортуй JSON.`);
  const text=await r.text();if(text.length>1_000_000)throw new Error('Завеликий профіль Wooting.');return JSON.parse(text);
}
