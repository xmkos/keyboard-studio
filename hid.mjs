// RT80 HID protocol over a "link" ({sendFeature(Uint8Array64), getFeature()->Uint8Array64}).
// Port of the old hardware.ps1: same frames, retries and waits. Waits are hardware calibration, do not trim them.
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// 64 data bytes; the checksum goes at index cb and overwrites that byte (as in hardware.ps1, where it was packet[cb+1]).
export function frame(data,cb=7){const d=new Uint8Array(64);d.set(data);let s=0;for(let i=0;i<cb;i++)s+=d[i];d[cb]=255-(s&255);return d;}
const bad=(list,max=255)=>list.some(b=>!Number.isInteger(b)||b<0||b>max);
export function createDevice(link,{report=()=>{},delay=sleep}={}){
  const P={done:0,total:0,base:0,span:100,phase:'Читаю клавіатуру'};
  const say=(pct,text)=>report(Math.max(0,Math.min(100,Math.round(pct))),text);
  async function send(data,cb=7,wait=12){
    const d=frame(data,cb);
    // The RT80 sometimes drops a feature report under load; the same packet is safe to resend.
    for(let t=1;t<=4;t++){try{await link.sendFeature(d);break;}catch(e){if(t===4)throw e;await delay(30*t);}}
    await delay(wait);
  }
  async function read(data,echo=false){
    P.done++;if(P.total>0&&P.done%4===0)say(P.base+P.span*Math.min(0.99,P.done/P.total),P.phase);
    let reply;
    for(let t=1;t<=4;t++){
      await send(data,7,5);
      try{reply=await link.getFeature();break;}catch(e){if(t===4)throw e;await delay(30*t);}
    }
    if(echo&&reply[0]!==data[0])throw new Error('Клавіатура повернула неочікувану відповідь. Закрий інші конфігуратори та повтори.');
    return Array.from(reply);
  }
  async function pages(cmd,count,keep){const out=[];for(let p=0;p<count;p++)out.push(...await read(cmd(p)));while(out.length<keep)out.push(0);return out;}
  async function readTable(op){
    const pageCount=op===10?8:2,bytes=await pages(p=>[229,op,1,p],pageCount,0);
    // Firmware tail bytes outside the RT80 matrix are not settings and may contain stale data.
    for(let plane=0;plane<pageCount/2;plane++)for(let tail=90;tail<128;tail++)bytes[plane*128+tail]=0;
    return bytes;
  }
  async function readKeymap(layer){const m=await pages(p=>[137,layer,p],6,512);for(let i=360;i<512;i++)m[i]=0;return m.slice(0,512);}
  async function readFn(){const m=await pages(p=>[144,1,p],6,512);for(let i=360;i<512;i++)m[i]=0;return m.slice(0,512);}
  async function readPicture(){return (await pages(p=>[140,0,p],6,0)).slice(0,384);}
  const readMacro=idx=>pages(p=>[139,idx,p],4,0);
  async function readState(extraMacros=[],cache=null){
    P.done=0;P.total=cache?75:175;P.base=0;P.span=100;P.phase='Читаю клавіатуру';
    const identity=await read([143],true),model=(identity[1]|identity[2]<<8|identity[3]<<16|identity[4]<<24)>>>0;
    if(model!==2068)throw new Error(`Модель ${model} не є перевіреною RT80 (2068). Запис заблоковано.`);
    const firmware=await read([128],true),fw=firmware[1]|firmware[2]<<8;
    if(fw<512)throw new Error('Ця версія прошивки не підтримує перевірений магнітний протокол.');
    const profile=await read([133],true),mode=await read([157],true);
    if(profile[1]>19||mode[1]>3)throw new Error('Некоректний профіль або режим RT80.');
    const tables={};for(const op of [0,1,2,3,4,5,6,7,9,10])tables[op]=await readTable(op);
    let options=null;try{options=(await read([134,0],true)).slice(2,5);}catch{}
    let picture=null;try{picture=await readPicture();}catch{}
    let fnmap=null;try{fnmap=await readFn();}catch{}
    const lighting=(await read([135],true)).slice(0,8);
    let side=null;try{side=(await read([136],true)).slice(1,8);}catch{}
    let sleepT=null;try{sleepT=(await read([146],true)).slice(1,9);}catch{}
    const base=Math.floor(profile[1]/4)*4,allKeymaps=[];
    for(let layer=0;layer<20;layer++)allKeymaps.push(cache&&(layer<base||layer>=base+4)?cache[layer]:await readKeymap(layer));
    const keymaps=allKeymaps.slice(base,base+4),indices=new Set();
    const scan=m=>{for(let pos=0;pos<90;pos++)if(m[pos*4]===9)indices.add(m[pos*4+2]);};
    allKeymaps.forEach(scan);if(fnmap)scan(fnmap);
    for(const i of extraMacros){if(!Number.isInteger(i)||i<0||i>255)throw new Error('Некоректний індекс макросу.');indices.add(i);}
    const macros={};for(const i of [...indices].sort((a,b)=>a-b))macros[i]=await readMacro(i);
    return {modelId:model,firmware:fw,profile:Math.floor(profile[1]/4),profileRaw:profile[1],mode:mode[1],tables,options,picture,fnmap,side,sleep:sleepT,lighting,keymap:keymaps[profile[1]%4],keymaps,allKeymaps,macros};
  }
  // After a write, re-read only what was written; everything else is copied from the state read just before.
  async function readTouched(before,req){
    const r={...before},profile=await read([133],true),mode=await read([157],true);
    r.profileRaw=profile[1];r.profile=Math.floor(profile[1]/4);r.mode=mode[1];
    r.tables={...before.tables};
    for(const op of new Set(req.changes.map(c=>c.op===8?10:c.op)))r.tables[op]=await readTable(op);
    if(req.remaps.length){
      const all=[...before.allKeymaps];
      for(const layer of new Set(req.remaps.map(m=>m.layer)))all[layer]=await readKeymap(layer);
      const base=r.profile*4;r.allKeymaps=all;r.keymaps=all.slice(base,base+4);r.keymap=r.keymaps[profile[1]%4];
    }
    if(req.options)try{r.options=(await read([134,0],true)).slice(2,5);}catch{r.options=null;}
    if(req.picture)r.picture=await readPicture();
    if(req.fnremaps.length)r.fnmap=await readFn();
    if(req.lighting)r.lighting=(await read([135],true)).slice(0,8);
    if(req.side)r.side=(await read([136],true)).slice(1,8);
    if(req.sleep)r.sleep=(await read([146],true)).slice(1,9);
    if(req.macrowrites.length){r.macros={...before.macros};for(const m of req.macrowrites)r.macros[m.index]=await readMacro(m.index);}
    return r;
  }
  async function writeItem(op,pos,value,commit){await send([101,op,0,pos,commit?1:0,0,0,0,value]);if(commit)await delay(500);}
  async function applyWrite(req){
    const {before}=req;
    for(const m of req.macrowrites){
      if(!Number.isInteger(m.index)||m.index<0||m.index>255||m.bytes.length!==256||bad(m.bytes))throw new Error('Некоректний макрос.');
      const used=[0,1,2,3,4].map(p=>m.bytes.slice(p*56,Math.min(256,p*56+56)).some(b=>b!==0)),count=used.filter(Boolean).length;
      if(count===0)throw new Error('Порожній макрос не можна безпечно записати.');
      if(used.some((u,p)=>u!==(p<count)))throw new Error('Непідтримуване розташування даних макросу.');
      for(let page=0;page<count;page++){
        const d=new Uint8Array(64);d[0]=22;d[1]=m.index;d[2]=page;d[3]=56;d[4]=page===count-1?1:0;
        for(let i=0;i<56;i++){const o=page*56+i;if(o<256)d[8+i]=m.bytes[o];}
        await send(d);await delay(100);
      }
      await delay(500);
    }
    // Measured on the RT80: staged items are all saved by one final commit. Commit every 100 so a huge change never relies on an unmeasured limit.
    const byPos=new Map();for(const c of req.changes){if(!byPos.has(c.pos))byPos.set(c.pos,[]);byPos.get(c.pos).push(c);}
    const flat=[...byPos.values()].flat();
    for(let k=0;k<flat.length;k++){
      const c=flat[k],commit=k===flat.length-1||(k+1)%100===0;
      if(k%5===0)say(50*(k+1)/flat.length,`Записую налаштування ${k+1}/${flat.length}`);
      if(!Number.isInteger(c.pos)||c.pos<0||c.pos>89||![0,1,2,3,4,5,6,7,8,9].includes(c.op))throw new Error('Некоректна команда зміни.');
      if(c.op===8){
        if(c.values.length!==4||bad(c.values))throw new Error('Некоректні етапи DKS.');
        await send([101,8,0,c.pos,commit?1:0,0,0,0,...c.values]);if(commit)await delay(500);
      }else{
        if(bad([c.value]))throw new Error('Некоректне значення зміни.');
        await writeItem(c.op,c.pos,c.value,commit);
      }
    }
    if(req.remaps.length)say(40,'Записую призначення клавіш');
    for(const m of req.remaps){
      if(Math.floor(m.layer/4)!==before.profile||m.layer<0||m.layer>19||m.pos<0||m.pos>89||m.bytes.length!==4||bad(m.bytes))throw new Error('Некоректне перепризначення.');
      const d=new Uint8Array(64);d[0]=19;d[1]=m.layer;d[2]=m.pos;d.set(m.bytes,8);
      await send(d);await delay(500);
    }
    if(req.lighting){
      say(45,'Записую підсвічування');
      if(req.lighting.length!==8||req.lighting[0]!==7||bad(req.lighting))throw new Error('Некоректна команда RGB.');
      await send(req.lighting,8);await delay(1000);
    }
    if(req.options){
      if(req.options.length!==3||bad(req.options))throw new Error('Некоректні параметри клавіатури.');
      await send([6,0,...req.options]);await delay(500);
    }
    if(req.picture){
      say(45,'Записую кольори клавіш');
      if(req.picture.length!==384||bad(req.picture))throw new Error('Некоректні кольори клавіш.');
      for(let page=0;page<=6;page++){
        const d=new Uint8Array(64);d[0]=12;d[3]=1;d[4]=page;
        for(let i=0;i<56;i++){const o=page*56+i;if(o<384)d[8+i]=req.picture[o];}
        await send(d);await delay(100);
      }
      await delay(500);
    }
    for(const m of req.fnremaps){
      if(m.pos<0||m.pos>89||m.bytes.length!==4||bad(m.bytes))throw new Error('Некоректне Fn-призначення.');
      const d=new Uint8Array(64);d[0]=21;d[1]=1;d[2]=m.pos;d.set(m.bytes,8);
      await send(d);await delay(500);
    }
    if(req.side){
      say(45,'Записую бокове RGB');
      if(req.side.length!==8||req.side[0]!==8||bad(req.side))throw new Error('Некоректна команда бокового RGB.');
      await send(req.side,8);await delay(1000);
    }
    if(req.sleep){
      say(45,'Записую таймери');
      if(req.sleep.length!==8||bad(req.sleep))throw new Error('Некоректні параметри сну.');
      const d=new Uint8Array(64);d[0]=18;d.set(req.sleep,8);
      await send(d);await delay(500);
    }
    if(req.mode!==before.mode){await send([29,req.mode]);await delay(500);}
    P.base=50;P.span=50;P.phase='Перевіряю запис';P.done=0;P.total=20;say(50,P.phase);
    return readTouched(before,req);
  }
  async function switchSlot(slot,cache){
    if(!Number.isInteger(slot)||slot<0||slot>4)throw new Error('Некоректний слот.');
    await send([5,slot*4]);await delay(500);
    const after=await readState([],cache);
    if(after.profileRaw!==slot*4)throw new Error('Перемикання слоту не підтверджено. Онови стан клавіатури.');
    return after;
  }
  return {readState,applyWrite,switchSlot};
}
