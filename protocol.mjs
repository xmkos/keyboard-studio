// Physical positions recovered from GearHub's RT80 matrix, not Wooting key IDs.
export const MATRIX = [41,53,43,57,225,224,0,30,20,4,0,0,58,31,26,22,29,227,59,32,8,7,27,226,60,33,21,9,6,0,61,34,23,10,25,0,62,35,28,11,5,44,63,36,24,13,17,0,64,37,12,14,16,0,65,38,18,15,54,230,66,39,19,51,55,0,67,45,47,52,56,228,68,46,48,0,229,80,69,42,49,40,82,81,76,74,75,78,77,79,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
export function validateSnapshot(s){
  if(!s||s.modelId!==2068||!Number.isInteger(s.firmware)||s.firmware<512||!Number.isInteger(s.profile)||s.profile<0||s.profile>4||!Number.isInteger(s.profileRaw)||Math.floor(s.profileRaw/4)!==s.profile||!Number.isInteger(s.mode)||s.mode<0||s.mode>3)throw new Error('Невідома модель або пошкоджений стан RT80.');
  for(const op of [0,1,2,3,6,7])if(!Array.isArray(s.tables?.[op])||s.tables[op].length!==128||!s.tables[op].every(b=>Number.isInteger(b)&&b>=0&&b<=255))throw new Error('Неповна відповідь магнітних налаштувань.');
  for(const op of [4,5,9,10])if(s.tables[op]!==undefined&&(!Array.isArray(s.tables[op])||s.tables[op].length!==(op===10?512:128)||!s.tables[op].every(b=>Number.isInteger(b)&&b>=0&&b<=255)))throw new Error('Пошкоджені розширені налаштування.');
  if(s.allKeymaps!==undefined&&(!Array.isArray(s.allKeymaps)||s.allKeymaps.length!==20||s.allKeymaps.some(map=>!Array.isArray(map)||map.length!==512||!map.every(b=>Number.isInteger(b)&&b>=0&&b<=255))))throw new Error('Пошкоджені шари клавіатури.');
  if(s.macros!==undefined&&(!s.macros||typeof s.macros!=='object'||Array.isArray(s.macros)||Object.entries(s.macros).some(([id,bytes])=>!/^(0|[1-9]\d{0,2})$/.test(id)||Number(id)>255||!Array.isArray(bytes)||bytes.length!==256||!bytes.every(b=>Number.isInteger(b)&&b>=0&&b<=255))))throw new Error('Пошкоджені дані макросів.');
  if(s.options!=null&&(!Array.isArray(s.options)||s.options.length!==3||!s.options.every(b=>Number.isInteger(b)&&b>=0&&b<=255)))throw new Error('Пошкоджена відповідь параметрів клавіатури.');
  if(s.picture!=null&&(!Array.isArray(s.picture)||s.picture.length!==384||!s.picture.every(b=>Number.isInteger(b)&&b>=0&&b<=255)))throw new Error('Пошкоджена відповідь кольорів клавіш.');
  if(s.fnmap!=null&&(!Array.isArray(s.fnmap)||s.fnmap.length!==512||!s.fnmap.every(b=>Number.isInteger(b)&&b>=0&&b<=255)))throw new Error('Пошкоджена відповідь Fn.');
  if(s.side!=null&&(!Array.isArray(s.side)||s.side.length!==7||!s.side.every(b=>Number.isInteger(b)&&b>=0&&b<=255)))throw new Error('Пошкоджена відповідь бокового RGB.');
  if(s.sleep!=null&&(!Array.isArray(s.sleep)||s.sleep.length!==8||!s.sleep.every(b=>Number.isInteger(b)&&b>=0&&b<=255)))throw new Error('Пошкоджена відповідь параметрів сну.');
  for(const [name,length] of [['lighting',8],['keymap',512]])if(s[name]!==undefined&&(!Array.isArray(s[name])||s[name].length!==length||!s[name].every(b=>Number.isInteger(b)&&b>=0&&b<=255)))throw new Error('Пошкоджена відповідь RGB або призначень клавіш.');
  if(s.keymaps!==undefined&&(!Array.isArray(s.keymaps)||s.keymaps.length!==4||s.keymaps.some(map=>!Array.isArray(map)||map.length!==512||!map.every(b=>Number.isInteger(b)&&b>=0&&b<=255))))throw new Error('Пошкоджені шари призначень клавіш.');
  return s;
}
export function publicState(s){
  validateSnapshot(s);
  return {connected:true,device:{name:'YUNZII RT80',modelId:s.modelId,firmware:s.firmware},profile:s.profile,mode:['comfort','sensitive','gaming','custom'][s.mode],capabilities:{advanced:!!s.tables[9]},keys:MATRIX.flatMap((hid,pos)=>hid?[{hid,index:0,pos,actuation:(s.tables[0][pos]+1)/10,release:(s.tables[1][pos]+1)/10,rtEnabled:!!(s.tables[7][pos]&128),rtDown:(s.tables[2][pos]+1)/10,rtUp:(s.tables[3][pos]+1)/10,deadzone:(39-s.tables[6][pos])/10,option:s.tables[7][pos]&127,modeName:({0:'normal',2:'dks',3:'modTap',4:'toggleHold',5:'toggleRepeat',7:'snap'})[s.tables[7][pos]&127]||'unknown',snapPartnerHid:(s.tables[7][pos]&127)===7?(MATRIX[s.tables[9]?.[pos]]||null):null,dksTravel:s.tables[4]?(s.tables[4][pos]+2)/10:null,modTapMs:s.tables[5]?s.tables[5][pos]*10:null,dksTriggers:s.tables[10]?Array.from({length:4},(_,i)=>s.tables[10][i*128+pos]):null}]:[])};
}

export function buildAdvancedChanges(snapshot,settings){
  validateSnapshot(snapshot);
  if(!snapshot.tables[9])throw new Error('Спочатку онови стан розширених налаштувань.');
  const modes={normal:0,toggleHold:4,toggleRepeat:5,snap:7};
  if(!settings||!Object.hasOwn(modes,settings.mode)||!Number.isInteger(settings.hid))throw new Error('Некоректний режим клавіші.');
  const pos=MATRIX.indexOf(settings.hid);
  if(pos<0||!settings.hid)throw new Error('Клавіші немає на RT80.');
  const partner=settings.mode==='snap'?MATRIX.indexOf(settings.partnerHid):-1;
  if(settings.mode==='snap'&&(!Number.isInteger(settings.partnerHid)||!settings.partnerHid||partner<0||partner===pos))throw new Error('Для Snap вибери дві різні клавіші RT80.');
  const next=structuredClone(snapshot.tables),affected=new Set([pos,...(partner>=0?[partner]:[])]);
  for(const p of [...affected]){
    const mode=next[7][p]&127;
    if(![0,4,5,7].includes(mode))throw new Error('Спочатку вимкни DKS або Mod Tap у GearHub, щоб зберегти їхні прив’язки.');
    if(mode===7){
      const old=next[9][p];
      if(old===p||!MATRIX[old]||(next[7][old]&127)!==7||next[9][old]!==p)throw new Error('Пара Snap несиметрична. Перевір її у GearHub перед зміною.');
      next[7][old]&=128;next[9][old]=0;affected.add(old);
      next[9][p]=0;
    }
    next[7][p]&=128;
  }
  next[7][pos]=(next[7][pos]&128)|modes[settings.mode];
  if(partner>=0){next[7][partner]=(next[7][partner]&128)|7;next[9][pos]=partner;next[9][partner]=pos;}
  const changes=[];
  for(const p of affected)for(const op of [7,9])if(next[op][p]!==snapshot.tables[op][p])changes.push({op,pos:p,value:next[op][p]});
  return changes;
}
function tenth(n,label,max=3.3){if(typeof n!=='number'||!Number.isFinite(n)||n<0.1||n>max||Math.abs(n*10-Math.round(n*10))>1e-7)throw new Error(`${label}: потрібне значення 0,1–${max} мм із кроком 0,1.`);return Math.round(n*10)-1;}
export function buildChanges(snapshot,patches){
  validateSnapshot(snapshot);
  if(!Array.isArray(patches)||patches.length===0||patches.length>MATRIX.filter(Boolean).length)throw new Error('Вибери клавіші, присутні на RT80.');
  const changes=[],seen=new Set();
  for(const p of patches){
    if(!p||!Number.isInteger(p.hid)||seen.has(p.hid))throw new Error('Некоректна або дубльована клавіша.');
    seen.add(p.hid);const pos=MATRIX.indexOf(p.hid);if(pos<0||p.hid===0)throw new Error('Цієї клавіші немає на RT80.');
    const option=snapshot.tables[7][pos]&127;
    if(![0,4,5,7].includes(option))throw new Error('Клавіша має DKS/Mod Tap. Зміни її режим у GearHub перед імпортом звичайного профілю.');
    if(typeof p.rtEnabled!=='boolean')throw new Error('Rapid Trigger має бути увімкнено або вимкнено.');
    for(const [op,value] of [[0,tenth(p.actuation,'Спрацювання')],[2,tenth(p.rtDown,'RT натискання')],[3,tenth(p.rtUp,'RT відпускання')],[7,option|(p.rtEnabled?128:0)]])if(snapshot.tables[op][pos]!==value)changes.push({op,pos,value});
  }
  return changes;
}


export function buildTravelExtras(snapshot, settings){
  validateSnapshot(snapshot);
  if(!settings||!Array.isArray(settings.hids)||!settings.hids.length||new Set(settings.hids).size!==settings.hids.length)throw new Error('Вибери різні клавіші RT80.');
  const release=tenth(settings.release,'Відпускання');
  const dead=settings.deadzone;
  if(typeof dead!=='number'||!Number.isFinite(dead)||dead<0||dead>1||Math.abs(dead*10-Math.round(dead*10))>1e-7)throw new Error('Deadzone: 0–1 мм із кроком 0,1.');
  const out=[];
  for(const hid of settings.hids){const pos=MATRIX.indexOf(hid);if(!hid||pos<0)throw new Error('Клавіші немає на RT80.');for(const [op,value] of [[1,release],[6,39-Math.round(dead*10)]])if(snapshot.tables[op][pos]!==value)out.push({op,pos,value});}
  return out;
}
