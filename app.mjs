import { convertWootingProfile, parseWootingCode } from './wooting.mjs';
import { RT80_LIGHT_EFFECTS } from './rgb.mjs';
import { validateNative } from './profiles.mjs';
import { call, wooting, hidSupported, setProgressHandler, watchDevice, backupText, importBackup, diagnostics, inspect } from './engine.mjs';
import {encodeMacroEvents} from './macro.mjs';

const $ = id => document.getElementById(id);
const STORAGE = 'rt80-studio.profiles.v1';
const rows = [
  [['Esc',41,4],...Array.from({length:12},(_,i)=>[`F${i+1}`,58+i,4]),['Del',76,4]],
  [['`',53,4],...Array.from({length:10},(_,i)=>[String((i+1)%10),30+i,4]),['−',45,4],['=',46,4],['Back',42,6],['Home',74,4]],
  [['Tab',43,6],...['Q','W','E','R','T','Y','U','I','O','P'].map(c=>[c,c.charCodeAt(0)-61,4]),['[',47,4],[']',48,4],['\\',49,4],['PgUp',75,4]],
  [['Caps',57,7],...['A','S','D','F','G','H','J','K','L'].map(c=>[c,c.charCodeAt(0)-61,4]),[';',51,4],["'",52,4],['Enter',40,7],['PgDn',78,4]],
  [['Shift',225,9],...['Z','X','C','V','B','N','M'].map(c=>[c,c.charCodeAt(0)-61,4]),[',',54,4],['.',55,4],['/',56,4],['Shift',229,5],['↑',82,4],['End',77,4]],
  [['Ctrl',224,5],['Win',227,5],['Alt',226,5],['Space',44,23],['Alt',230,4],['Fn',null,4],['Ctrl',228,4],['←',80,4],['↓',81,4],['→',79,4]]
];
const supportedHids = new Set(rows.flat().filter(k=>k[1]!==null).map(k=>k[1]));
const keyLabels = new Map(rows.flat().map(k=>[k[1],k[0]]));
let state = null, editor = {}, selected = new Set(), profiles = [], activeId = null, activeProfileNative, source = 'Локальний редактор', losses = [], busy = false;
const history = [], redoHistory = [];
const supportedEffects=RT80_LIGHT_EFFECTS.filter(effect=>!['LightMusicFollow2','LightScreenColor'].includes(effect.type));
const effectLabels={LightWave:'Wave',LightRipple:'Ripple',LightRaindrop:'Raindrop',LightSnake:'Snake',LightPressAction:'Press Action',LightConverage:'Converage',LightSineWave:'Sine Wave',LightKaleidoscope:'Kaleidoscope',LightPressActionOff:'Press Action Off',LightLineWave:'Line Wave',LightLaser:'Laser',LightCircleWave:'Circle Wave',LightDazzing:'Dazzing',LightRainDown:'Rain Down',LightMeteor:'Meteor',LightAlwaysOn:'Always On',LightBreath:'Breathing',LightNeon:'Neon'};
const clone = value => JSON.parse(JSON.stringify(value));
function status(message, type = '') { $('status').textContent = message; $('status').className = `status ${type}`; }
function snapshot() { return JSON.stringify({editor,selected:[...selected],activeId,activeProfileNative,includeNative:$('include-native').checked,source,losses,profileName:$('profile-name').value}); }
function recordHistory() { history.push(snapshot());if(history.length>50)history.shift();redoHistory.length=0;updateHistoryButtons(); }
function restoreSnapshot(value) { const saved=JSON.parse(value);editor=saved.editor;selected=new Set(saved.selected);activeId=saved.activeId;activeProfileNative=saved.activeProfileNative;$('include-native').checked=!!saved.includeNative;source=saved.source;losses=saved.losses;$('profile-name').value=saved.profileName;renderLibrary();syncControls(); }
function updateHistoryButtons() { $('undo').disabled=!history.length||busy;$('redo').disabled=!redoHistory.length||busy; }
function validateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Профіль не містить налаштувань клавіш.');
  const result = {};
  for (const [hidText, config] of Object.entries(settings)) {
    const hid = Number(hidText);
    if (!Number.isInteger(hid) || !supportedHids.has(hid)) throw new Error(`Клавіша HID ${hidText} відсутня на RT80.`);
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`Некоректні налаштування HID ${hid}.`);
    const item = {};
    for (const field of ['actuation','rtDown','rtUp']) {
      if (config[field] !== undefined) {
        if (typeof config[field] !== 'number' || !Number.isFinite(config[field]) || config[field] < .1 || config[field] > 3.3 || Math.abs(config[field]*10-Math.round(config[field]*10))>1e-7) throw new Error(`${keyLabels.get(hid)}: ${field} має бути від 0.1 до 3.3 мм із кроком 0.1 мм.`);
        item[field] = config[field];
      }
    }
    if (config.rtEnabled !== undefined) { if (typeof config.rtEnabled !== 'boolean') throw new Error('Rapid Trigger має бути true або false.'); item.rtEnabled = config.rtEnabled; }
    if (Object.keys(item).length!==4) throw new Error(`HID ${hid}: потрібні всі чотири параметри: actuation, rtEnabled, rtDown, rtUp.`);
    result[hid] = item;
  }
  if (!Object.keys(result).length) throw new Error('У профілі немає налаштувань клавіш.');
  return result;
}
function ownProfile(value) {
  if (value.format !== 'rt80-studio' || ![1,2].includes(value.version) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error('Невідомий формат або версія профілю Keyboard Studio.');
  if(value.native!==undefined)validateNative(value.native);
  return {name:value.name.trim(),settings:validateSettings(value.settings),...(value.native?{native:value.native}:{}),source:'Keyboard Studio',losses:[]};
}
try {
  const stored = JSON.parse(localStorage.getItem(STORAGE) || '[]');
  if (!Array.isArray(stored) || stored.length > 200) throw new Error('Некоректна бібліотека профілів.');
  profiles = stored.map(p=>({...ownProfile(p),id:typeof p.id==='string'?p.id:crypto.randomUUID(),source:typeof p.source==='string'?p.source:'Keyboard Studio',losses:Array.isArray(p.losses)?p.losses.filter(x=>typeof x==='string'):[]}));
} catch { status('Не вдалося прочитати локальну бібліотеку. Експортуй важливі профілі, якщо вони є в іншому браузері.','error'); }
function persist() {
  localStorage.setItem(STORAGE, JSON.stringify(profiles.map(p=>({...p,format:'rt80-studio',version:2}))));
}
function showProgress(p) {
  const overall=Math.round(Math.min(100,((p.step-1)+p.pct/100)/p.steps*100));
  $('progress').hidden=false;$('progress-step').textContent=`${p.steps>1?`Крок ${p.step} з ${p.steps} · `:''}${p.text}`;$('progress-pct').textContent=`${overall}%`;$('progress-fill').style.width=`${overall}%`;$('progress').querySelector('[role=progressbar]').setAttribute('aria-valuenow',overall);
}
async function request(url, body, opts) {
  if(url.startsWith('/api/wooting')) return wooting(new URL(url,'http://x').searchParams.get('code'));
  showProgress({step:1,steps:1,pct:0,text:'Починаю…'});
  try { return await call(url, body, opts); } finally { $('progress').hidden=true; }
}
function liveSettings(data) {
  const settings = {};
  for (const key of data.keys || []) if (supportedHids.has(key.hid)) {
    const item = {};
    for (const field of ['actuation','rtDown','rtUp']) if (typeof key[field] === 'number' && Number.isFinite(key[field])) item[field]=key[field];
    if (typeof key.rtEnabled === 'boolean') item.rtEnabled=key.rtEnabled;
    if (Object.keys(item).length) settings[key.hid]=item;
  }
  return settings;
}
const targetHidIsValid=hid=>Number.isInteger(hid)&&(hid===0||(hid>=4&&hid<=115)||(hid>=224&&hid<=231));
function bindingTarget(key,subprofile) {
  const binding=key?.bindings?.[subprofile];
  return binding?.simple&&targetHidIsValid(binding.targetHid)?binding.targetHid:undefined;
}
function decodeDksActions(packed) { return [packed&3,(packed>>>2)&3,(packed>>>4)&3,(packed>>>6)&3]; }
function nativeFromState(data) {
  if(!data?.connected)return undefined;
  const native={};
  if(data.options)native.mainLedOn=(data.options[0]&16)===0;
  if(data.picture)native.picture=data.picture.slice(0,270);
  if((data.keys||[]).every(key=>Array.isArray(key.bindings)&&key.bindings.length===4))native.keymapsRaw=data.keys.map(key=>({hid:key.hid,bindings:key.bindings.map(binding=>binding.raw.slice())}));
  if(data.fnmap)native.fnRaw=(data.keys||[]).map(key=>({hid:key.hid,bytes:data.fnmap.slice(key.pos*4,key.pos*4+4)}));
  const macroRecords=[...(native.fnRaw||[]).map(row=>row.bytes),...(native.keymapsRaw||[]).flatMap(row=>row.bindings)];const macroIds=new Set(macroRecords.filter(raw=>raw[0]===9).map(raw=>String(raw[2])));if(macroIds.size&&[...macroIds].every(id=>Array.isArray(data.macros?.[id])))native.macros=Object.fromEntries([...macroIds].map(id=>[id,data.macros[id].slice()]));
  if(data.sleep){const bt=data.sleep[0]+256*data.sleep[1],wired=data.sleep[2]+256*data.sleep[3];if(bt<=1080&&wired<=1080)native.sleep={bt,wired};}
  if(data.side){const [effect,speed,brightness,mode,r,g,b]=data.side;const side={effect,speed,brightness,rgb:(r<<16)|(g<<8)|b,dazzle:(mode&15)===8};try{validateNative({side});native.side=side;}catch{}}
  const travel=(data.keys||[]).map(({hid,release,deadzone})=>({hid,release,deadzone}));
  if(travel.length)try{validateNative({travel});native.travel=travel;}catch{}
  if(data.capabilities?.rgb&&data.rgb&&!['LightMusicFollow2','LightScreenColor'].includes(data.rgb.type))native.rgb={type:data.rgb.type,bright:data.rgb.bright,speed:data.rgb.speed,option:data.rgb.option,rgb:data.rgb.rgb,dazzle:data.rgb.dazzle};
  if(data.capabilities?.remap&&Array.isArray(data.remaps)&&data.remaps.every(row=>row.simple&&targetHidIsValid(row.targetHid)))native.remaps=data.remaps.map(({hid,targetHid})=>({hid,targetHid}));
  if(data.capabilities?.advanced){
    const keys=data.keys||[];let known=keys.length>0;
    const advanced=keys.map(key=>{
      const mode=key.modeName;
      if(mode==='snap')return {hid:key.hid,mode,partnerHid:key.snapPartnerHid};
      if(mode==='normal')return {hid:key.hid,mode};
      if(mode==='toggleHold'||mode==='toggleRepeat'){
        const actionTargetHid=bindingTarget(key,0);
        if(actionTargetHid===undefined)known=false;
        return {hid:key.hid,mode,...(actionTargetHid===undefined?{}:{actionTargetHid})};
      }
      if(mode==='dks'){
        const targets=Array.from({length:4},(_,i)=>bindingTarget(key,i));
        if(targets.some(value=>value===undefined)||!Array.isArray(key.dksTriggers)||key.dksTriggers.length!==4||!key.dksTriggers.every(value=>Number.isInteger(value)&&value>=0&&value<=255)||typeof key.dksTravel!=='number')known=false;
        return {hid:key.hid,mode,targets,triggerActions:(key.dksTriggers||[]).map(decodeDksActions),triggerTravel:key.dksTravel};
      }
      if(mode==='modTap'){
        const holdHid=bindingTarget(key,0),tapHid=bindingTarget(key,1);
        if(holdHid===undefined||tapHid===undefined||!Number.isInteger(key.modTapMs))known=false;
        return {hid:key.hid,mode,holdHid,tapHid,holdMs:key.modTapMs};
      }
      known=false;return {hid:key.hid,mode};
    });
    if(known&&advanced.every(row=>row.mode!=='snap'||Number.isInteger(row.partnerHid)))native.advanced=advanced;
  }
  return Object.keys(native).length?native:undefined;
}
function profileNative() {
  if(!$('include-native').checked)return undefined;
  return activeProfileNative||nativeFromState(state);
}
function captureNativeAfterWrite(data) {
  updateDevice(data);
  activeProfileNative=nativeFromState(data);
  $('include-native').checked=!!activeProfileNative;
  renderEditor();
}
function nativeDiffCount(native) {
  if(!native||!state?.connected)return 0;
  let count=0;
  const currentNative=nativeFromState(state);for(const key of ['sleep','side','travel','fnRaw','keymapsRaw','picture','mainLedOn','macros'])if(native[key]!==undefined&&JSON.stringify(native[key])!==JSON.stringify(currentNative?.[key]))count++;
  if(native.fn)for(const row of native.fn){const key=state.keys?.find(k=>k.hid===row.hid),raw=key&&state.fnmap?.slice(key.pos*4,key.pos*4+4);if(!raw||raw[0]!==0||raw[1]!==0||raw[2]!==row.targetHid||raw[3]!==0)count++;}
  if(native.rgb&&Object.keys(native.rgb).some(key=>native.rgb[key]!==state.rgb?.[key]))count++;
  if(native.remaps)for(const row of native.remaps){const current=state.remaps?.find(item=>item.hid===row.hid);if(!current||current.targetHid!==row.targetHid)count++;}
  if(native.advanced)for(const row of native.advanced){
    const current=state.keys?.find(item=>item.hid===row.hid);let differs=!current||current.modeName!==row.mode;
    if(current&&!differs){
      if(row.mode==='snap')differs=current.snapPartnerHid!==row.partnerHid;
      else if(row.mode==='dks')differs=current.dksTravel!==row.triggerTravel||!Array.isArray(current.dksTriggers)||current.dksTriggers.length!==4||current.dksTriggers.some((packed,i)=>JSON.stringify(decodeDksActions(packed))!==JSON.stringify(row.triggerActions[i]))||row.targets.some((target,i)=>bindingTarget(current,i)!==target);
      else if(row.mode==='modTap')differs=current.modTapMs!==row.holdMs||bindingTarget(current,0)!==row.holdHid||bindingTarget(current,1)!==row.tapHid;
      else if((row.mode==='toggleHold'||row.mode==='toggleRepeat')&&row.actionTargetHid!==undefined)differs=bindingTarget(current,0)!==row.actionTargetHid;
    }
    if(differs)count++;
  }
  return count;
}
function changes() {
  if (!state?.connected) return [];
  const current = new Map(state.keys.map(k=>[k.hid,k]));
  const native=profileNative(),reserved=new Set((native?.advanced||[]).filter(row=>row.mode==='dks'||row.mode==='modTap').map(row=>row.hid));
  return Object.entries(editor).flatMap(([hidText,settings])=>{
    const hid = Number(hidText), actual = current.get(hid);
    if (!actual||reserved.has(hid)) return [];
    const merged={...actual,...settings};
    const fields=['actuation','rtEnabled','rtDown','rtUp'];
    return fields.some(field=>actual[field]!==merged[field])?[{hid,...Object.fromEntries(fields.map(field=>[field,merged[field]]))}]:[];
  });
}
function renderLibrary() {
  $('profile-list').replaceChildren();
  $('profile-count').textContent=profiles.length;
  if (!profiles.length) { const p=document.createElement('p');p.className='empty-library';p.textContent='Поки що тут порожньо. Збережи поточні налаштування або імпортуй перший профіль.';$('profile-list').append(p); }
  for (const profile of profiles) {
    const button=document.createElement('button');button.className='profile-card';button.type='button';button.setAttribute('aria-pressed',String(profile.id===activeId));
    const title=document.createElement('strong');title.textContent=profile.name;
    const meta=document.createElement('span');meta.textContent=`${profile.source} · ${Object.keys(profile.settings).length} клавіш${profile.native?' · RT80':''}`;
    button.append(title,meta);
    if(profile.id===activeId){const dot=document.createElement('i');dot.className='profile-indicator';button.append(dot);}
    button.addEventListener('click',()=>loadProfile(profile));$('profile-list').append(button);
  }
}
function renderEditor() {
  $('macro-stage').disabled=!state?.connected||selected.size!==1||busy;
  $('continuous-on').disabled=!state?.connected||!selected.size||busy;$('continuous-off').disabled=!state?.connected||!selected.size||busy;
  $('led-on').disabled=!state?.options||busy;$('led-apply').disabled=!state?.options||busy;
  $('picture-apply').disabled=!state?.picture||!selected.size||busy;
  $('slot-select').disabled=!state?.connected||busy; $('slot-apply').disabled=!state?.connected||busy;
  $('fn-target').disabled=!state?.fnmap||busy; $('fn-apply').disabled=!state?.fnmap||selected.size!==1||busy;
  $('travel-extra-apply').disabled=!state?.connected||!selected.size||busy;
  const advanced=new Set((state?.keys||[]).filter(k=>!['normal','snap','toggleHold','toggleRepeat'].includes(k.modeName)).map(k=>k.hid));
  for (const key of document.querySelectorAll('.key[data-hid]')) {
    const hid=Number(key.dataset.hid);key.setAttribute('aria-pressed',String(selected.has(hid)));
    const settings=editor[hid],actual=state?.keys?.find(item=>item.hid===hid),depth=settings?.actuation??actual?.actuation??1.5;
    const fraction=Math.max(0,Math.min(1,(depth-.1)/3.2)),hue=Math.round(264-fraction*40),light=Math.round(33+fraction*7);
    key.style.setProperty('--heat',`hsl(${hue} 43% ${light}%)`);
    const mode=actual?.modeName,meta=key.querySelector('.key-meta')||key.appendChild(Object.assign(document.createElement('span'),{className:'key-meta'}));
    meta.textContent=mode==='snap'?`⇄ ${keyLabels.get(actual.snapPartnerHid)||''}`:['dks','modTap','toggleHold','toggleRepeat'].includes(mode)?{dks:'DKS',modTap:'MT',toggleHold:'TGL',toggleRepeat:'TGL'}[mode]:typeof depth==='number'&&(settings||actual)?depth.toFixed(1):'';
    key.classList.toggle('rt',!!(settings?.rtEnabled??actual?.rtEnabled));key.classList.toggle('snap',mode==='snap');key.classList.toggle('special',!!mode&&mode!=='normal'&&mode!=='snap');
    key.title=settings?`${keyLabels.get(hid)} · ${settings.actuation??'—'} мм${settings.rtEnabled?' · Rapid Trigger':''}`:keyLabels.get(hid);
    if(advanced.has(hid))key.title+=' · Спеціальний режим QMK.top: запис цих параметрів недоступний';
  }
  $('selection-count').textContent=`${selected.size} вибрано`;
  $('setting-selection').textContent=selected.size?`${selected.size} клавіш · ${[...selected].slice(0,7).map(hid=>keyLabels.get(hid)).join(', ')}${selected.size>7?'…':''}`:'Вибери клавіші на схемі';
  $('settings-fields').disabled=!selected.size || busy;
  $('rapid-fields').disabled=!selected.size || busy;
  $('source-label').textContent=source;
  $('current-profile-label').textContent=$('profile-name').value.trim()||'Без назви';
  $('editor-title').textContent=activeId?'Редактор профілю':'Редактор клавіш';
  $('editor-subtitle').textContent=Object.keys(editor).length?`${Object.keys(editor).length} клавіш у редакторі · натискай клавіші для вибору`:'Вибери клавіші та задай параметри для нового профілю.';
  $('losses').hidden=!losses.length;$('loss-list').replaceChildren();
  for(const loss of losses){const item=document.createElement('li');item.textContent=typeof loss==='string'?loss:JSON.stringify(loss);$('loss-list').append(item);}
  const pending=changes(),native=profileNative(),nativePending=nativeDiffCount(native);
  const blocked=pending.filter(k=>advanced.has(k.hid));
  $('pending-label').textContent=!state?.connected?'Для запису підключи RT80':blocked.length?`${blocked.length} клавіш мають спеціальний режим DKS, Mod Tap або невідомий режим. Поверни звичайний режим у QMK.top перед записом.`:pending.length||nativePending?`${pending.length} змін чутливості · ${nativePending} змін функцій RT80`:'Редактор збігається з клавіатурою';
  $('apply').disabled=busy||!state?.connected||(!pending.length&&!nativePending)||!!blocked.length;
  $('save-profile').disabled=busy||!Object.keys(editor).length;
  $('copy-profile').disabled=busy||!Object.keys(editor).length;
  $('delete-profile').disabled=busy||!activeId;
  $('export-profile').disabled=!Object.keys(editor).length;
  $('read-editor').disabled=busy||!state?.connected;
  for(const id of ['side-effect','side-bright','side-speed','side-color','side-dazzle','side-apply'])$(id).disabled=!state?.side||busy;
  if(![0,1,2,3,4].includes(state?.side?.[0]))$('side-apply').disabled=true;
  for(const id of ['sleep-bt','sleep-wired','sleep-apply'])$(id).disabled=!state?.sleep||busy;
  renderAdvanced();
  renderRemap();
  updateHistoryButtons();
  $('preview-summary').textContent=`Попередній перегляд · ${pending.length} змінених клавіш · ${nativePending} змін функцій RT80`;
  $('preview-rows').replaceChildren();
  const preview=state?.connected?pending:Object.entries(editor).map(([hid,settings])=>({hid:Number(hid),...settings}));
  if(!state?.connected)$('preview-summary').textContent=`Параметри профілю · ${preview.length} клавіш`;
  for(const key of preview){const row=document.createElement('tr');for(const value of [keyLabels.get(key.hid),`${key.actuation.toFixed(1)} мм`,key.rtEnabled?'Увімк.':'Вимк.',`${key.rtDown.toFixed(1)} / ${key.rtUp.toFixed(1)} мм`]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}$('preview-rows').append(row);}
}
function syncControls() {
  const first=editor[[...selected][0]];
  if(first){for(const [field,id] of [['actuation','actuation'],['rtUp','rt-up'],['rtDown','rt-down']])if(first[field]!==undefined)$(id).value=first[field];if(first.rtEnabled!==undefined)$('rt-enabled').checked=first.rtEnabled;}
  $('actuation-number').value=$('actuation').value;
  updateOutputs();renderEditor();
}
function updateOutputs(){for(const id of ['actuation','rt-up','rt-down'])$(`${id}-value`).textContent=`${Number($(id).value).toFixed(1)} мм`;$('actuation-number').value=$('actuation').value;$('switch-travel-value').textContent=`${Number($('actuation').value).toFixed(1)} мм`;const fraction=(Number($('actuation').value)-.1)/3.2,frame=Math.round(40*fraction);$('switch-sprite').style.backgroundPosition=`${frame/40*100}% 50%`;document.querySelector('.switch-cutaway').style.setProperty('--travel-position',`${fraction*100}%`);}
function loadProfile(profile) {
  recordHistory();
  editor=clone(profile.settings);activeId=profile.id??null;activeProfileNative=profile.native?clone(profile.native):undefined;$('include-native').checked=!!activeProfileNative;source=profile.source||'Імпорт';losses=profile.losses||[];$('profile-name').value=profile.name;
  renderLibrary();syncControls();status(`«${profile.name}» відкрито в редакторі. Перевір параметри перед застосуванням.`);
}
function updateDevice(data) {
  state=data;$('device-led').classList.toggle('connected',!!state.connected);$('connect').hidden=$('inspect-device').hidden=!!state.connected;
  $('side-status').textContent=state.connected?`Підключено · ${state.device?.firmware||'RT80'}`:'Немає з’єднання';
  $('connection-state').textContent=state.connected?'Підключено':'Очікую клавіатуру';$('connection-dot').classList.toggle('connected',!!state.connected);
  $('backups').replaceChildren();const placeholder=new Option('Вибери резервну копію','');$('backups').add(placeholder);
  for(const backup of state.backups||[])$('backups').add(new Option(backup,backup));
  $('restore').disabled=!state.connected||!$('backups').value||busy;
  if(state.options)$('led-on').checked=(state.options[0]&16)===0;
  $('picture-status').textContent=state.picture?'Кольори зчитано з RT80.':'Читання кольорів недоступне; запис заблоковано.';
  $('slot-select').value=state.profile;
  $('fn-status').textContent=state.fnmap?'Fn-шар зчитано. Вибери одну клавішу на схемі.':'Читання Fn недоступне; запис заблоковано.';
  const side=state.side;for(const id of ['side-effect','side-bright','side-speed','side-color','side-dazzle','side-apply'])$(id).disabled=!side||busy;
  if(side&&[0,1,2,3,4].includes(side[0])){$('side-effect').value=side[0];$('side-speed').value=side[1];$('side-bright').value=side[2];$('side-color').value='#'+side.slice(4,7).map(v=>v.toString(16).padStart(2,'0')).join('');$('side-dazzle').checked=(side[3]&15)===8;}
  else $('side-apply').disabled=true;
  $('side-status-read').textContent=side?'Зчитано з RT80. Перед записом буде створено резервну копію.':'Читання бокового RGB недоступне; запис заблоковано.';
  const sleep=state.sleep; for(const id of ['sleep-bt','sleep-wired','sleep-apply'])$(id).disabled=!sleep||busy;
  if(sleep){$('sleep-bt').value=sleep[0]+256*sleep[1];$('sleep-wired').value=sleep[2]+256*sleep[3];}
  $('sleep-status').textContent=sleep?'Зчитано з RT80. Перед записом буде створено резервну копію.':'Читання таймерів недоступне; запис заблоковано.';
  renderAdvanced();
  renderRemap();
  renderRgb();
  for(const feature of ['rgb','remap','advanced']){const badge=document.querySelector(`[data-tab="${feature}"] .nav-lock`);if(badge){const confirmed=typeof state.capabilities?.[feature]==='boolean';badge.textContent=confirmed?(state.capabilities[feature]?'✓':'—'):'…';badge.setAttribute('aria-label',confirmed?(state.capabilities[feature]?'Доступно':'Недоступно'):'Перевіряю');}}
}
function renderAdvanced() {
  const supported=state?.capabilities?.advanced===true,mode=$('advanced-mode').value,hids=[...selected],needed=mode==='snap'?2:1;
  $('advanced-selection').textContent=hids.length?`${hids.length} вибрано · ${hids.map(hid=>keyLabels.get(hid)).join(', ')}`:'Вибери одну клавішу або пару для Snap.';
  $('advanced-capability').textContent=supported?'Режими RT80 доступні. Перед кожною зміною створюється резервна копія.':'Ця версія застосунку не підтвердила безпечний запис режимів RT80.';
  $('advanced-mode').disabled=!supported||busy;
  $('apply-advanced').disabled=!supported||!state?.connected||busy||hids.length!==needed;
  $('advanced-hint').textContent=mode==='snap'?'Вибери рівно дві клавіші для пари Snap RT80.':mode==='normal'?'Звичайний режим вимикає спеціальну поведінку для вибраної клавіші.':mode==='toggleHold'?'Toggle Hold змінює стан клавіші натисканням.':'Toggle Repeat повторює дію клавіші після перемикання.';
  $('snap-visual').hidden=mode!=='snap';
  const [capA,capB]=[hids[0],hids[1]].map(hid=>keyLabels.get(hid)||'?');$('snap-cap-a').textContent=capA;$('snap-cap-b').textContent=capB;
  $('snap-caption').textContent=hids.length===2?`${capA} ⇄ ${capB}: клавіші не конфліктують.`:hids.length>2?'Забагато клавіш — потрібно рівно дві.':'Вибери на клавіатурі дві клавіші, наприклад A і D.';
  $('snap-visual').classList.toggle('ready',hids.length===2);
  const list=$('advanced-list');list.replaceChildren();
  const keys=(state?.keys||[]).filter(key=>key.modeName||key.snapPartnerHid!==undefined||key.dksTravel!==undefined||key.modTapMs!==undefined);
  if(!state?.connected||!keys.length){const empty=document.createElement('p');empty.textContent=state?.connected?'Для цих клавіш немає прочитаних додаткових режимів.':'Підключи RT80, щоб прочитати режими.';list.append(empty);return;}
  const seen=new Set();
  for(const key of keys){
    if(key.modeName==='snap'&&Number.isInteger(key.snapPartnerHid)){
      if(seen.has(key.hid))continue;seen.add(key.hid);seen.add(key.snapPartnerHid);
      const row=document.createElement('div');row.className='advanced-row snap-row';
      for(const part of [keyLabels.get(key.hid)||`HID ${key.hid}`,'⇄',keyLabels.get(key.snapPartnerHid)||`HID ${key.snapPartnerHid}`]){const el=document.createElement(part==='⇄'?'i':'kbd');el.textContent=part;row.append(el);}
      const tag=document.createElement('span');tag.textContent='Snap Tap';row.append(tag);list.append(row);continue;
    }const row=document.createElement('div');row.className='advanced-row';const label=document.createElement('strong');label.textContent=keyLabels.get(key.hid)||`HID ${key.hid}`;const value=document.createElement('span');value.textContent=key.modeName||'Звичайний режим';row.append(label,value);if(Number.isInteger(key.snapPartnerHid)){const partner=document.createElement('small');partner.textContent=`Snap · ${keyLabels.get(key.snapPartnerHid)||`HID ${key.snapPartnerHid}`}`;row.append(partner);}list.append(row);}
}
function renderRemap() {
  const supported=state?.capabilities?.remap===true,hid=selected.size===1?[...selected][0]:null,entry=(state?.remaps||[]).find(item=>item.hid===hid),current=Number(entry?.targetHid)||0;
  $('remap-selection').textContent=hid===null?selected.size?`Вибрано ${selected.size} клавіш · потрібно рівно одну.`:'Вибери одну клавішу на схемі.':`Клавіша ${keyLabels.get(hid)} · поточне призначення: ${current?keyLabels.get(current)||`HID ${current}`:'без перепризначення'}.`;
  $('remap-capability').textContent=supported?'Перепризначення перевірено для поточного апаратного профілю.':'Ця версія застосунку ще не підтвердила безпечне перепризначення.';
  const select=$('remap-target');select.replaceChildren(new Option('Без перепризначення','0'));
  for(const targetHid of supportedHids)if(targetHid!==hid)select.add(new Option(keyLabels.get(targetHid),String(targetHid)));
  select.value=String(current);select.disabled=!supported||!state?.connected||hid===null||busy;
  $('remap-current').textContent=hid===null?'Вибери одну клавішу, щоб побачити її поточне призначення.':`Фізична клавіша ${keyLabels.get(hid)} буде вводити ${current?keyLabels.get(current)||`HID ${current}`:'свою базову функцію'}.`;
  $('apply-remap').disabled=!supported||!state?.connected||hid===null||busy||Number(select.value)===current;
}
function renderRgb(reset=true) {
  const typeSelect=$('rgb-type'),current=state?.rgb||{type:'LightWave',speed:2,bright:2,option:0,rgb:0xffdb59,dazzle:true};
  if(reset||!typeSelect.options.length){typeSelect.replaceChildren();if(!supportedEffects.some(effect=>effect.type===current.type)){const unsupported=new Option(`Непідтримуваний ефект · ${current.type}`,current.type);unsupported.disabled=true;typeSelect.add(unsupported);}for(const effect of supportedEffects)typeSelect.add(new Option(effectLabels[effect.type]||effect.type,effect.type));}
  if(reset)typeSelect.value=current.type;
  const effect=supportedEffects.find(item=>item.type===typeSelect.value)||supportedEffects[0];
  if(reset){$('rgb-bright').value=current.bright??2;$('rgb-speed').value=current.speed??2;$('rgb-color').value=`#${(current.rgb??0xffdb59).toString(16).padStart(6,'0')}`;$('rgb-dazzle').checked=current.dazzle!==false;}
  $('rgb-bright').max=effect.maxBrightness;$('rgb-bright').value=Math.min(Number($('rgb-bright').value),effect.maxBrightness);$('rgb-bright').disabled=!state?.capabilities?.rgb||busy;
  $('rgb-speed').max=effect.maxSpeed;if(effect.maxSpeed)$('rgb-speed').value=Math.min(Number($('rgb-speed').value),effect.maxSpeed);$('rgb-speed').disabled=!state?.capabilities?.rgb||busy||effect.maxSpeed===0;$('rgb-speed-wrap').hidden=effect.maxSpeed===0;
  $('rgb-color-wrap').hidden=!effect.rgb;$('rgb-color').disabled=!state?.capabilities?.rgb||busy||!effect.rgb;
  $('rgb-dazzle-wrap').hidden=!effect.dazzle;$('rgb-dazzle').disabled=!state?.capabilities?.rgb||busy||!effect.dazzle;
  const optionSelect=$('rgb-option');optionSelect.replaceChildren();for(const [index,option] of effect.options.entries())optionSelect.add(new Option(option,index));
  $('rgb-option-wrap').hidden=!effect.options.length;$('rgb-option').disabled=!state?.capabilities?.rgb||busy||!effect.options.length;
  if(reset){const option=current.option??0;optionSelect.value=String(option<effect.options.length?option:0);}
  $('rgb-bright-value').textContent=$('rgb-bright').value;$('rgb-speed-value').textContent=$('rgb-speed').value;
  $('rgb-capability').textContent=state?.capabilities?.rgb?'Ефекти та діапазони відповідають перевіреним режимам RT80.':'Ця версія застосунку ще не підтвердила безпечне керування RGB.';
  $('rgb-description').textContent=effect.options.length?`Доступні варіанти: ${effect.options.join(', ')}.`:effect.maxSpeed?'Швидкість ефекту налаштовується нижче.':'Для цього ефекту швидкість не налаштовується.';
  $('apply-rgb').disabled=!state?.connected||state?.capabilities?.rgb!==true||busy||(!supportedEffects.some(item=>item.type===current.type)&&typeSelect.value===current.type);
  $('rgb-current-copy').textContent=state?.connected&&state.rgb?`${effectLabels[state.rgb.type]||state.rgb.type} · яскравість ${state.rgb.bright}/4${state.rgb.speed?` · швидкість ${state.rgb.speed}/4`:''}`:'Підключи RT80, щоб прочитати поточний ефект.';
  $('rgb-current-badge').textContent=state?.rgb?'Поточний стан зчитано':'Стан не зчитано';
  $('rgb-preview').style.setProperty('--rgb-color',$('rgb-color').value);
}
async function refresh(initial=false,load=false) {
  $('refresh').disabled=true;
  try {
    const data=await request(initial?'/api/state':'/api/state?full=1',undefined,{prompt:!initial});updateDevice(data);
    if((load||(initial&&!Object.keys(editor).length))&&state.connected){if(Object.keys(editor).length)recordHistory();editor=liveSettings(state);activeId=null;activeProfileNative=nativeFromState(state);$('include-native').checked=!!activeProfileNative;losses=[];source='Зчитано з RT80';$('profile-name').value='Мій RT80';renderLibrary();syncControls();}
    status(state.connected?`RT80 підключено. Апаратний профіль ${Number(state.profile)+1} · режим ${state.mode}. ${load?'Поточні параметри зчитано в редактор.':initial?'Кожна функція записується своєю кнопкою застосування.':'Стан оновлено; редактор збережено. Щоб замінити його поточними параметрами, натисни «Зчитати RT80».'}`:'Клавіатура недоступна. Можна редагувати та імпортувати локальні профілі.',state.connected?'success':'');
  } catch(error){state=null;$('connect').hidden=$('inspect-device').hidden=false;$('device-led').classList.remove('connected');$('side-status').textContent='Немає з’єднання';for(const feature of ['rgb','remap','advanced']){const badge=document.querySelector(`[data-tab="${feature}"] .nav-lock`);if(badge){badge.textContent='?';badge.setAttribute('aria-label','Не підтверджено');}}initial&&hidSupported()?status('Підключи RT80 кабелем USB і натисни «Підключити». Без клавіатури можна редагувати та імпортувати профілі.',''):status(hidSupported()?`Немає з’єднання з RT80: ${error.message} Не виходить? Довідка → «Скопіювати діагностику».`:error.message,'error');}
  finally{$('refresh').disabled=false;renderEditor();}
}
rows.forEach((row,r)=>{let column=1;row.forEach(([label,hid,width])=>{
  if(r===0&&column===5)column+=2;
  const key=document.createElement('button');key.type='button';key.className=`key${r===0?' function':''}${hid===44?' space':''}`;key.textContent=label;key.style.gridColumn=`${column} / span ${width}`;key.style.gridRow=r+1;key.setAttribute('aria-label',label==='↑'?'Стрілка вгору':label==='↓'?'Стрілка вниз':label==='←'?'Стрілка вліво':label==='→'?'Стрілка вправо':label);
  if(hid!==null){key.dataset.hid=hid;key.setAttribute('aria-pressed','false');key.addEventListener('click',()=>{selected.has(hid)?selected.delete(hid):selected.add(hid);syncControls();});}else{key.disabled=true;key.title='Fn — службова клавіша, не редагується';}
  $('keyboard').append(key);column+=width;
});});const knob=document.createElement('div');knob.className='knob';knob.title='Регулятор гучності';knob.setAttribute('aria-label','Регулятор гучності');$('keyboard').append(knob);
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.nav-item[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===button.dataset.tab));
  const tab=button.dataset.tab,remapSupported=state?.capabilities?.remap===true,rgbSupported=state?.capabilities?.rgb===true,editorViews=['quick','actuation','rapid','advanced','lighting','keys','system',...(remapSupported?['remap']:[])],unsupported=(tab==='rgb'&&!rgbSupported)||(tab==='remap'&&!remapSupported);
  $('profile-panel').hidden=tab!=='profiles';$('workspace').hidden=!editorViews.includes(tab);$('unsupported-panel').hidden=!unsupported;$('rgb-panel').hidden=tab!=='rgb'||!rgbSupported;$('advanced-panel').hidden=tab!=='advanced';$('help-panel').hidden=tab!=='help';
  $('workspace').dataset.view=editorViews.includes(tab)?tab:'quick';
  const titles={quick:['Швидкі налаштування','Вибери клавіші та налаштуй чутливість.'],actuation:['Точка спрацювання','Вистав глибину натискання для вибраних клавіш.'],rapid:['Rapid Trigger','Налаштуй точку повторного спрацювання та відпускання.'],remap:['Перепризначення','Зміни призначення клавіші в поточному апаратному профілі.'],rgb:['RGB','Налаштуй перевірені ефекти підсвічування RT80.'],lighting:['Додаткове підсвічування','Бокове RGB, основне світло та кольори окремих клавіш.'],keys:['Клавіші','Fn-шар, макроси, відпускання, мертва зона та Continuous RT. Спочатку вибери клавіші.'],system:['Таймери та слоти','Таймери вимкнення підсвічування та апаратний слот.']};
  if(titles[tab]){$('page-title').textContent=titles[tab][0];$('page-description').textContent=titles[tab][1];}
  if(['rgb','remap'].includes(tab)&&unsupported){$('unsupported-title').textContent=tab==='rgb'?'RGB':'Перепризначення';$('unsupported-eyebrow').textContent=tab==='rgb'?'ПІДСВІЧУВАННЯ':'ПРИЗНАЧЕННЯ КЛАВІШ';$('capability-symbol').textContent=tab==='rgb'?'✦':'↔';$('capability-title').textContent=tab==='rgb'?'Керування RGB недоступне':'Перепризначення недоступне';$('capability-copy').textContent=tab==='rgb'?`${state?.connected?'Ця прошивка не підтвердила керування RGB.':'Клавіатуру не зчитано (USB або зайнята іншою програмою). Закрий GearHub / QMK.top і натисни «Оновити».'}`:'Keyboard Studio поки не має перевіреного інтерфейсу для зміни призначень клавіш. Перепризначення Wooting буде зазначене у звіті імпорту й не записується в клавіатуру.';}
  if(tab==='profiles'){$('page-title').textContent='Мої профілі';$('page-description').textContent='Бібліотека профілів та імпорт Wooting.';}
  if(tab==='advanced'){$('page-title').textContent='Додатково';$('page-description').textContent='Спеціальні режими поведінки клавіш RT80.';renderAdvanced();}
  if(tab==='rgb'){$('page-title').textContent='RGB';$('page-description').textContent='Ефекти та колір підсвічування RT80.';renderRgb();}
  if(tab==='help'){$('page-title').textContent='Як це працює';$('page-description').textContent='Профілі, сумісність і резервні копії.';}
}));
$('undo').addEventListener('click',()=>{if(!history.length)return;redoHistory.push(snapshot());restoreSnapshot(history.pop());status('Редактор повернуто до попереднього стану.');});
$('redo').addEventListener('click',()=>{if(!redoHistory.length)return;history.push(snapshot());restoreSnapshot(redoHistory.pop());status('Зміни редактора повторено.');});
$('refresh').addEventListener('click',()=>refresh());
$('connect').addEventListener('click',()=>refresh());
async function shareText(text){try{await navigator.clipboard.writeText(text);status('Діагностику скопійовано. Встав її в повідомлення автору.','success');}catch{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/plain'}));a.download='keyboard-studio-diagnostics.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);status('Діагностику збережено як файл. Надішли його автору.','success');}}
$('copy-diagnostics').addEventListener('click',async()=>shareText(await diagnostics()));
for(const id of ['inspect-device','inspect-device-help'])$(id).addEventListener('click',async()=>{try{await shareText(await inspect());}catch(error){status(error.message,'error');}});
$('download-backup').addEventListener('click',()=>{const name=$('backups').value,text=backupText(name);if(!text)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
$('import-backup').addEventListener('click',()=>$('backup-input').click());
$('backup-input').addEventListener('change',async()=>{const file=$('backup-input').files[0];$('backup-input').value='';if(!file||file.size>2_000_000)return;try{const name=importBackup(await file.text());$('backups').add(new Option(name,name));$('backups').value=name;$('restore').disabled=!state?.connected;status('Резервну копію додано до цього браузера.','success');}catch(error){status(`Не вдалося додати копію: ${error.message}`,'error');}});
$('read-editor').addEventListener('click',()=>{if(changes().length&&!confirm('Замінити параметри редактора поточними параметрами RT80? Незбережені зміни редактора буде втрачено.'))return;refresh(false,true);});
$('select-wasd').addEventListener('click',()=>{selected=new Set([26,4,22,7]);syncControls();});
$('select-all').addEventListener('click',()=>{selected=new Set(supportedHids);syncControls();});
$('clear-selection').addEventListener('click',()=>{selected.clear();syncControls();});
for(const id of ['actuation','rt-up','rt-down'])$(id).addEventListener('input',updateOutputs);
$('actuation-number').addEventListener('input',()=>{const value=Number($('actuation-number').value);if(Number.isFinite(value)&&value>=.1&&value<=3.3){$('actuation').value=value;updateOutputs();}});
$('settings-form').addEventListener('submit',event=>{
  event.preventDefault();
  recordHistory();const config={actuation:Number($('actuation').value)};
  for(const hid of selected)editor[hid]={...editor[hid],...config};renderEditor();status(`Параметри задано для ${selected.size} клавіш у редакторі. Збережи профіль або застосуй до RT80.`);
});
$('rapid-form').addEventListener('submit',event=>{event.preventDefault();recordHistory();const config={rtEnabled:$('rt-enabled').checked,rtUp:Number($('rt-up').value),rtDown:Number($('rt-down').value)};for(const hid of selected)editor[hid]={...editor[hid],...config};renderEditor();status(`Rapid Trigger задано для ${selected.size} клавіш у редакторі. Збережи профіль або застосуй до RT80.`);});
$('new-profile').addEventListener('click',()=>{recordHistory();activeId=null;activeProfileNative=nativeFromState(state);$('include-native').checked=!!activeProfileNative;editor={};losses=[];source='Новий профіль';$('profile-name').value='Новий профіль';selected.clear();renderLibrary();renderEditor();status('Новий порожній профіль. Вибери клавіші та задай їхню чутливість.');});
$('include-native').addEventListener('change',()=>{if($('include-native').checked&&!activeProfileNative)activeProfileNative=nativeFromState(state);renderEditor();});
$('save-profile').addEventListener('click',()=>{
  try{
    const name=$('profile-name').value.trim();if(!name||name.length>100)throw new Error('Вкажи назву профілю довжиною до 100 символів.');
    const settings=validateSettings(editor),id=activeId||crypto.randomUUID(),native=profileNative();const profile={id,name,settings,...(native?{native}:{}),source,losses};
    const next=profiles.filter(p=>p.id!==id);if(next.length>=200)throw new Error('У бібліотеці вже 200 профілів. Експортуй їх перед очищенням браузера.');
    const previous=profiles;profiles=[...next,profile];try{persist();}catch(error){profiles=previous;throw new Error(`Браузер не зберіг профіль: ${error.message}. Експортуй JSON.`);}
    activeId=id;renderLibrary();renderEditor();status(`«${name}» збережено у цьому браузері.`,'success');
  }catch(error){status(error.message,'error');}
});
$('copy-profile').addEventListener('click',()=>{
  const previousId=activeId,previousName=$('profile-name').value;
  activeId=null;$('profile-name').value=`${previousName.trim()||'Мій профіль'} — копія`.slice(0,100);
  $('save-profile').click();
  if(activeId===null){activeId=previousId;$('profile-name').value=previousName;renderEditor();}
});
$('delete-profile').addEventListener('click',()=>{
  if(!activeId||!confirm('Видалити цей профіль із локальної бібліотеки? Параметри клавіатури та поточний редактор залишаться без змін.'))return;
  const previous=profiles;profiles=profiles.filter(p=>p.id!==activeId);
  try{persist();activeId=null;renderLibrary();renderEditor();status('Профіль видалено з бібліотеки. Параметри залишилися в редакторі.');}
  catch(error){profiles=previous;status(`Не вдалося видалити профіль: ${error.message}`,'error');}
});
$('export-profile').addEventListener('click',()=>{
  try{const native=profileNative(),profile={format:'rt80-studio',version:2,name:$('profile-name').value.trim()||'RT80',settings:validateSettings(editor),...(native?{native}:{})};const url=URL.createObjectURL(new Blob([JSON.stringify(profile,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${profile.name.replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,60)||'RT80'}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('JSON профілю підготовлено до завантаження.');}catch(error){status(error.message,'error');}
});
const lossTranslations={
  'Distances were rounded/clamped to RT80 0.1–3.3 mm in 0.1 mm steps.':'Відстані округлено й обмежено діапазоном RT80: 0.1–3.3 мм із кроком 0.1 мм.',
  'Outer split-spacebar keys are omitted; only the central Space key maps to RT80 Space.':'Крайні клавіші розділеного пробілу пропущено; переноситься лише центральний пробіл.',
  'Wooting continuous/strict Rapid Trigger behavior is not reproduced; only distances and enable states are imported.':'Безперервний / строгий режим Rapid Trigger Wooting не відтворюється; переносимо відстані та стан увімкнення.',
  'Key remaps and function layers were not imported; RT80 bindings remain unchanged.':'Перепризначення та Fn-шари не переносяться. Призначення клавіш RT80 зберігаються.',
  'Advanced keys (DKS, Mod Tap, Toggle, Rappy Snappy and SOCD that cannot be mapped) were not imported.':'Спеціальні функції DKS, Mod Tap, Toggle, Rappy Snappy та SOCD, які не вдалося зіставити, не переносяться.',
  'SOCD / Rappy Snappy key pairs are imported as RT80 Snap Tap pairs; Wooting mode details are not carried over and RT80 equivalence is unverified.':'Пари SOCD / Rappy Snappy переносяться як пари Snap Tap RT80. Деталі режиму Wooting не переносяться, еквівалентність не перевірено.',
  'Wooting 80HE F-row, navigation cluster and arrow keys have no verified RT80 mapping and were omitted.':'F-ряд, блок навігації та стрілки Wooting 80HE не зіставлено з RT80 і пропущено.',
  'Wooting RGB effects, per-key colors and lightbar settings were not imported.':'RGB-ефекти, кольори клавіш та світлова смуга Wooting не переносяться.',
  'Analog gamepad mappings, curves and joystick settings were not imported.':'Аналоговий геймпад, криві та налаштування джойстика не переносяться.',
  'Wooting Tachyon modes and DKS tick rates were not imported.':'Режими Tachyon та частота DKS Wooting не переносяться.',
  'Wooting nominal millimeter distances are preserved where possible; physical switch calibration/feel cannot be transferred.':'Відстані Wooting у міліметрах збережено, наскільки можливо. Фізичне калібрування та відчуття перемикачів перенести неможливо.',
  'Nominal distances are converted from Wooting’s 4 mm scale; physical switch calibration/feel cannot be transferred.':'Відстані перераховано зі шкали Wooting 4 мм. Фізичне калібрування та відчуття перемикачів перенести неможливо.'
};
function importValue(value) {
  const profile=value?.format==='rt80-studio'?ownProfile(value):convertWootingProfile(value);
  if(value?.format!=='rt80-studio'){
    profile.losses=(profile.losses||[]).map(loss=>lossTranslations[loss]||loss);
    for(const hid of Object.keys(profile.settings))if(!supportedHids.has(Number(hid))){delete profile.settings[hid];profile.losses.push(`Клавіша HID ${hid} відсутня на RT80; її параметри пропущено.`);}
    profile.source='Wooting v15';
    profile.losses.push('Режими DKS, Mod Tap і Toggle на RT80 зберігаються. Snap Tap береться з профілю Wooting: пар немає — Snap вимикається.');
    const wanted=profile.snapPairs||[],label=pairs=>pairs.map(([a,b])=>`${keyLabels.get(a)}⇄${keyLabels.get(b)}`).join(', ');
    const base=state?.connected&&state.capabilities?.advanced?nativeFromState(state)?.advanced:undefined;
    if(!base){if(wanted.length)profile.losses.push(`Пари Snap Tap (${label(wanted)}) не перенесено: підключи RT80, дочекайся зчитування й імпортуй знову.`);}
    else try{
      const byHid=new Map(base.map(row=>[row.hid,{...row}])),pairs=wanted.filter(pair=>pair.every(hid=>byHid.has(hid)));
      const wasOn=[...byHid.values()].filter(row=>row.mode==='snap'&&row.hid<row.partnerHid).map(row=>[row.hid,row.partnerHid]);
      for(const row of byHid.values())if(row.mode==='snap')byHid.set(row.hid,{hid:row.hid,mode:'normal'});
      for(const [a,b] of pairs){byHid.set(a,{hid:a,mode:'snap',partnerHid:b});byHid.set(b,{hid:b,mode:'snap',partnerHid:a});}
      const off=wasOn.filter(([a,b])=>!pairs.some(pair=>pair.includes(a)&&pair.includes(b)));
      if(pairs.length||off.length){const native={advanced:[...byHid.values()]};validateNative(native);profile.native=native;}
      if(pairs.length)profile.losses.push(`Snap Tap: ${label(pairs)} буде записано разом із чутливістю.`);
      if(off.length)profile.losses.push(`Snap Tap вимкнено: ${label(off)} (у профілі Wooting цих пар немає).`);
    }catch{profile.losses.push('Не вдалося підготувати Snap Tap; режими клавіш RT80 не змінено.');}
  }
  profile.settings=validateSettings(profile.settings);profile.name=String(profile.name||'Імпортований профіль').slice(0,100);profile.source=profile.source||'Wooting';loadProfile(profile);
}
$('code-form').addEventListener('submit',async event=>{
  event.preventDefault();$('import-code').disabled=true;status('Завантажую публічний профіль Wooting…');
  try{const code=parseWootingCode($('share-code').value);const value=await request(`/api/wooting?code=${encodeURIComponent(code)}`);importValue(value);}catch(error){status(`Не вдалося імпортувати: ${error.message}`,'error');}finally{$('import-code').disabled=false;}
});
$('import-file').addEventListener('click',()=>$('file-input').click());
$('file-input').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>2_000_000)throw new Error('JSON має бути меншим за 2 МБ.');importValue(JSON.parse(await file.text()));}catch(error){status(`Не вдалося прочитати профіль: ${error.message}`,'error');}finally{event.target.value='';}
});
$('apply').addEventListener('click',async()=>{
  if(busy||!state?.connected)return;busy=true;renderEditor();status('Створюю резервну копію та записую параметри…');
  try{const native=profileNative(),result=await request('/api/apply',{changes:changes(),...(native?{native}:{}),expectedProfile:state.profile,expectedRevision:state.revision});captureNativeAfterWrite(result.state);status(result.backup?`Параметри записано й перевірено. Резервна копія: ${result.backup}${result.allocatedMacros?.length?' При відновленні прив’язки повернуться, але невикористані дані нових макросів залишаться у пам’яті.':''}`:'Профіль RT80 уже збігається з редактором. Запис не потрібен.','success');}
  catch(error){status(`Запис не завершено: ${error.message}. Натисни «Оновити», щоб перевірити стан клавіатури.`,'error');}
  finally{busy=false;renderEditor();}
});
const macroEvents=[];for(const hid of supportedHids)$('event-key').add(new Option(keyLabels.get(hid),String(hid)));
$('event-type').addEventListener('change',()=>{const type=$('event-type').value;$('event-key-wrap').hidden=type!=='key';$('event-mouse-wrap').hidden=type!=='mouse';$('event-action-wrap').hidden=type==='move';$('event-move-wrap').hidden=type!=='move';});
function renderMacroEvents(){const list=$('macro-event-list');list.replaceChildren();macroEvents.forEach((event,i)=>{const row=document.createElement('li');const label=document.createElement('span');label.textContent=event.type==='move'?`Рух ${event.dx}, ${event.dy} · ${event.delay} мс`:`${event.type==='key'?(keyLabels.get(event.code)||event.code):$('event-mouse').querySelector(`option[value="${event.code}"]`)?.textContent} · ${event.action==='down'?'натиснути':'відпустити'} · ${event.delay} мс`;const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='Видалити';remove.addEventListener('click',()=>{macroEvents.splice(i,1);renderMacroEvents();});row.append(label,remove);list.append(row);});}
$('event-add').addEventListener('click',()=>{const type=$('event-type').value,delay=Number($('event-delay').value),event=type==='move'?{type,dx:Number($('event-dx').value),dy:Number($('event-dy').value),delay}:{type,code:Number($(type==='key'?'event-key':'event-mouse').value),action:$('event-action').value,delay};try{encodeMacroEvents(1,[event]);macroEvents.push(event);renderMacroEvents();}catch(error){status(`Подію не додано: ${error.message}`,'error');}});
$('macro-form').addEventListener('submit',event=>{event.preventDefault();if(!state?.connected||selected.size!==1||busy)return;try{
 const hid=[...selected][0],index=Number($('macro-index').value),scope=$('macro-layer').value,mode=Number($('macro-mode').value),bytes=encodeMacroEvents(Number($('macro-repeat').value),macroEvents);
 if(!Number.isInteger(index)||index<0||index>49)throw new Error('Індекс має бути від 0 до 49.');
 const next=clone(profileNative()||nativeFromState(state));if(!next)throw new Error('Профіль RT80 не зчитано.');const raw=[9,mode,index,0];
 if(scope==='fn'){const row=next.fnRaw?.find(item=>item.hid===hid);if(!row)throw new Error('Fn-шар не зчитано.');row.bytes=raw;}
 else{const key=state.keys.find(item=>item.hid===hid);if(key?.modeName!=='normal')throw new Error('Спочатку поверни клавішу до звичайного режиму.');const row=next.keymapsRaw?.find(item=>item.hid===hid);if(!row)throw new Error('Шари не зчитано.');const sub=Number(scope.slice(4));row.bindings[sub]=raw;if(sub===0&&next.remaps)next.remaps=next.remaps.filter(item=>item.hid!==hid);}
 next.macros={...(next.macros||{}),[index]:bytes};next.macroTargets=[...(next.macroTargets||[]).filter(item=>item.index!==index),{index,scope,hid}];
 const refs=[...(next.fnRaw||[]).map(row=>row.bytes),...(next.keymapsRaw||[]).flatMap(row=>row.bindings)];for(const id of Object.keys(next.macros))if(!refs.some(raw=>raw[0]===9&&raw[2]===Number(id)))delete next.macros[id];
 validateNative(next);recordHistory();activeProfileNative=next;$('include-native').checked=true;renderEditor();status('Макрос підготовлено. Перевір профіль і натисни «Застосувати до RT80».');
 }catch(error){status(`Макрос не підготовлено: ${error.message}`,'error');}});
for(const [id,enabled] of [['continuous-on',true],['continuous-off',false]])$(id).addEventListener('click',()=>{if(!state?.connected||!selected.size||busy)return;recordHistory();for(const hid of selected)editor[hid]={...editor[hid],rtEnabled:enabled,...(enabled?{rtDown:0.2,rtUp:0.2}:{})};syncControls();status('Налаштування RT підготовлено в редакторі. Перевір і застосуй до RT80.');});
$('led-form').addEventListener('submit',async event=>{event.preventDefault();if(busy||!state?.options)return;busy=true;renderEditor();status('Створюю резервну копію та змінюю підсвічування…');try{const result=await request('/api/led',{expectedRevision:state.revision,settings:{on:$('led-on').checked}});captureNativeAfterWrite(result.state);status(result.backup?`Стан підсвічування перевірено. Резервна копія: ${result.backup}`:'Стан уже збігається.','success');}catch(error){status(`Запис не завершено або не підтверджено: ${error.message}. Онови стан.`,'error');}finally{busy=false;renderEditor();}});
$('picture-form').addEventListener('submit',async event=>{event.preventDefault();if(busy||!state?.picture||!selected.size)return;busy=true;renderEditor();status('Створюю резервну копію та змінюю кольори…');
 try{const result=await request('/api/picture',{expectedRevision:state.revision,settings:{hids:[...selected],rgb:parseInt($('picture-color').value.slice(1),16)}});captureNativeAfterWrite(result.state);status(result.backup?`Кольори записано та перевірено. Резервна копія: ${result.backup}`:'Кольори вже збігаються.','success');}
 catch(error){status(`Запис кольорів не завершено або не підтверджено: ${error.message}. Онови стан.`,'error');}finally{busy=false;renderEditor();}
});
$('slot-form').addEventListener('submit',async event=>{event.preventDefault();if(busy||!state?.connected)return;const slot=Number($('slot-select').value);if(!confirm('Перемкнути апаратний слот? Поточний стан редактора буде замінено.'))return;
 busy=true;renderEditor();status('Створюю резервну копію та перемикаю слот…');
 try{const result=await request('/api/slot',{expectedRevision:state.revision,slot});updateDevice(result.state);editor=liveSettings(state);selected.clear();activeId=null;activeProfileNative=nativeFromState(state);$('include-native').checked=!!activeProfileNative;losses=[];source='Зчитано з RT80';$('profile-name').value='Мій RT80';history.length=0;redoHistory.length=0;renderLibrary();syncControls();status(`Слот ${slot+1} зчитано. ${result.backup?'Резервна копія: '+result.backup:'Слот уже був активний.'}`,'success');}
 catch(error){status(`Перемикання не завершено або не підтверджено: ${error.message}. Онови стан.`,'error');}finally{busy=false;renderEditor();}
});
$('fn-target').add(new Option('Вимкнено','0'));for(const hid of supportedHids)$('fn-target').add(new Option(keyLabels.get(hid),String(hid)));
$('fn-form').addEventListener('submit',async event=>{event.preventDefault();if(busy||!state?.fnmap||selected.size!==1)return;busy=true;renderEditor();status('Створюю резервну копію та змінюю Fn…');
 try{const result=await request('/api/fn',{expectedRevision:state.revision,settings:{hid:[...selected][0],targetHid:Number($('fn-target').value)}});captureNativeAfterWrite(result.state);status(result.backup?`Fn записано та перевірено. Резервна копія: ${result.backup}`:'Fn вже збігається.','success');}
 catch(error){status(`Запис Fn не завершено або не підтверджено: ${error.message}. Онови стан.`,'error');}finally{busy=false;renderEditor();}
});
$('side-effect').addEventListener('change',()=>{const effect=Number($('side-effect').value),max=({0:0,1:0,2:3,3:3,4:4})[effect];$('side-speed').max=max;$('side-speed').value=Math.min(Number($('side-speed').value),max);});
$('side-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy||!state?.connected||!state.side)return;
 const settings={effect:Number($('side-effect').value),speed:Number($('side-speed').value),brightness:Number($('side-bright').value),rgb:parseInt($('side-color').value.slice(1),16),dazzle:$('side-dazzle').checked};
 busy=true;$('side-apply').disabled=true;status('Створюю резервну копію та змінюю бокове RGB…');
 try{const result=await request('/api/side',{expectedRevision:state.revision,settings});captureNativeAfterWrite(result.state);status(result.backup?`Бокове RGB записано та перевірено. Резервна копія: ${result.backup}`:'Бокове RGB вже збігається.','success');}
 catch(error){status(`Запис не завершено: ${error.message}. Онови стан перед повтором.`,'error');}
 finally{busy=false;renderEditor();$('side-apply').disabled=!state?.side;}
});
$('travel-extra-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!state?.connected||!selected.size)return;
  const settings={hids:[...selected],release:Number($('release-extra').value),deadzone:Number($('deadzone-extra').value)};
  busy=true;$('travel-extra-apply').disabled=true;status('Створюю резервну копію та змінюю параметри…');
  try{const result=await request('/api/travel-extras',{expectedRevision:state.revision,settings});captureNativeAfterWrite(result.state);status(result.backup?`Параметри записано та перевірено. Резервна копія: ${result.backup}`:'Значення вже збігаються.','success');}
  catch(error){status(`Запис не завершено: ${error.message}. Онови стан перед повтором.`,'error');}
  finally{busy=false;renderEditor();}
});
$('sleep-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!state?.connected||!state.sleep)return;
  const settings={bt:Number($('sleep-bt').value),wired:Number($('sleep-wired').value)};
  busy=true;$('sleep-apply').disabled=true;status('Створюю резервну копію та змінюю таймери підсвічування…');
  try{const result=await request('/api/sleep',{expectedRevision:state.revision,settings});captureNativeAfterWrite(result.state);status(result.backup?`Таймери підсвічування записано та перевірено. Резервна копія: ${result.backup}`:'Таймери підсвічування вже збігаються.','success');}
  catch(error){status(`Запис таймерів не завершено або не підтверджено: ${error.message}. Онови стан перед повтором.`,'error');}
  finally{busy=false;$('sleep-apply').disabled=!state?.sleep;renderEditor();}
});
$('advanced-mode').addEventListener('change',renderAdvanced);
$('apply-advanced').addEventListener('click',async()=>{
  const hids=[...selected],mode=$('advanced-mode').value;if(!state?.connected||busy||state.capabilities?.advanced!==true||hids.length!==(mode==='snap'?2:1))return;
  busy=true;renderEditor();status('Створюю резервну копію та змінюю режим клавіш…');
  try{const settings={hid:hids[0],mode,...(mode==='snap'?{partnerHid:hids[1]}:{})};const result=await request('/api/advanced',{expectedRevision:state.revision,settings});captureNativeAfterWrite(result.state||result);status(`Режим RT80 змінено та включено до збережуваного стану профілю. Резервна копія: ${result.backup}`,'success');}
  catch(error){status(`Режим не змінено: ${error.message}`,'error');}
  finally{busy=false;renderEditor();}
});
$('remap-target').addEventListener('change',()=>{const hid=selected.size===1?[...selected][0]:null,current=Number((state?.remaps||[]).find(item=>item.hid===hid)?.targetHid)||0;$('apply-remap').disabled=!state?.connected||state?.capabilities?.remap!==true||busy||hid===null||Number($('remap-target').value)===current;});
$('apply-remap').addEventListener('click',async()=>{
  const hid=selected.size===1?[...selected][0]:null,targetHid=Number($('remap-target').value);if(hid===null||!state?.connected||busy||state.capabilities?.remap!==true)return;
  busy=true;renderEditor();status('Створюю резервну копію та змінюю призначення клавіші…');
  try{const result=await request('/api/remap',{expectedRevision:state.revision,settings:{hid,targetHid}});captureNativeAfterWrite(result.state||result);status(`Призначення змінено та включено до збережуваного стану профілю. Резервна копія: ${result.backup}`,'success');}
  catch(error){status(`Перепризначення не виконано: ${error.message}`,'error');}
  finally{busy=false;renderEditor();}
});
$('rgb-type').addEventListener('change',()=>renderRgb(false));
for(const id of ['rgb-bright','rgb-speed'])$(id).addEventListener('input',()=>{$(`${id}-value`).textContent=$(id).value;});
// Colour only applies when the rainbow mode ("dazzle") is off, so picking a colour switches it off.
$('rgb-color').addEventListener('input',()=>{ $('rgb-dazzle').checked=false; $('rgb-preview').style.setProperty('--rgb-color',$('rgb-color').value); });
$('side-color').addEventListener('input',()=>{ $('side-dazzle').checked=false; });
$('apply-rgb').addEventListener('click',async()=>{
  const type=$('rgb-type').value,effect=supportedEffects.find(item=>item.type===type);if(!effect||!state?.connected||busy||state.capabilities?.rgb!==true)return;
  const settings={type,speed:effect.maxSpeed?Number($('rgb-speed').value):0,bright:Number($('rgb-bright').value),option:effect.options.length?Number($('rgb-option').value):0};
  if(effect.rgb)settings.rgb=Number.parseInt($('rgb-color').value.slice(1),16);if(effect.dazzle)settings.dazzle=$('rgb-dazzle').checked;
  busy=true;renderRgb(false);status('Створюю резервну копію та змінюю підсвічування…');
  try{const result=await request('/api/rgb',{expectedRevision:state.revision,settings});captureNativeAfterWrite(result.state||result);status(`Підсвічування змінено та включено до збережуваного стану профілю. Резервна копія: ${result.backup}`,'success');}
  catch(error){status(`Підсвічування не змінено: ${error.message}`,'error');}
  finally{busy=false;renderEditor();renderRgb(false);}
});
$('backups').addEventListener('change',()=>{$('restore').disabled=!state?.connected||!$('backups').value||busy;});
$('restore').addEventListener('click',async()=>{
  const backup=$('backups').value;if(!backup||busy||!confirm('Відновити підтримувані параметри з цієї копії? Поточні параметри буде перезаписано.'))return;
  busy=true;$('restore').disabled=true;renderEditor();
  try{const result=await request('/api/restore',{backup,expectedRevision:state.revision});updateDevice(result.state||result);status(`Підтримувані параметри з копії відновлено. Редактор збережено без змін.${result.orphaned?.length?' Невикористані дані нових макросів залишилися в пам’яті клавіатури; повного відновлення пам’яті не заявлено.':''}`,'success');}
  catch(error){status(`Відновлення не завершено: ${error.message}`,'error');}finally{busy=false;renderEditor();$('restore').disabled=!state?.connected||!$('backups').value;}
});
const codeHids={Escape:41,Backquote:53,Tab:43,CapsLock:57,ShiftLeft:225,ShiftRight:229,ControlLeft:224,ControlRight:228,MetaLeft:227,AltLeft:226,AltRight:230,Space:44,Minus:45,Equal:46,Backspace:42,BracketLeft:47,BracketRight:48,Backslash:49,Semicolon:51,Quote:52,Enter:40,Comma:54,Period:55,Slash:56,ArrowLeft:80,ArrowRight:79,ArrowUp:82,ArrowDown:81,Delete:76,Home:74,PageUp:75,PageDown:78,End:77};
for(let i=0;i<26;i++)codeHids[`Key${String.fromCharCode(65+i)}`]=i+4;
for(let i=0;i<10;i++)codeHids[`Digit${(i+1)%10}`]=30+i;
for(let i=1;i<=12;i++)codeHids[`F${i}`]=57+i;
function tester(event){if(!$('tester').checked||/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))return;const hid=codeHids[event.code];if(hid===undefined)return;event.preventDefault();document.querySelector(`.key[data-hid="${hid}"]`)?.classList.toggle('testing',event.type==='keydown');}
$('tester').addEventListener('change',()=>{if($('tester').checked){document.addEventListener('keydown',tester);document.addEventListener('keyup',tester);status('Тестер увімкнено. Клавіші підсвічуються лише в цьому вікні; спрацювання браузера може перехоплювати системні комбінації.');}else{document.removeEventListener('keydown',tester);document.removeEventListener('keyup',tester);document.querySelectorAll('.testing').forEach(k=>k.classList.remove('testing'));status('Тестер вимкнено.');}});
window.addEventListener('blur',()=>document.querySelectorAll('.testing').forEach(k=>k.classList.remove('testing')));
setProgressHandler(showProgress);
watchDevice(()=>refresh(true));
renderLibrary();renderEditor();updateOutputs();renderRgb();refresh(true);
