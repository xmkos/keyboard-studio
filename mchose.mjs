// MCHOSE "Cizhou" keyboards (vid 0x41e4, e.g. Ace68-II): read-only decoding of the dump taken by engine.mjs.
// Formats come from the vendor web driver (M HUB). Units: 0.01 mm. Nothing here talks to hardware.
// Ace68 physical layout: [hid, label, x, width] in key units, 5 rows. HID 255 = Fn.
export const ROWS=[
  [[41,'Esc',0,1],[30,'1',1,1],[31,'2',2,1],[32,'3',3,1],[33,'4',4,1],[34,'5',5,1],[35,'6',6,1],[36,'7',7,1],[37,'8',8,1],[38,'9',9,1],[39,'0',10,1],[45,'-',11,1],[46,'=',12,1],[42,'Bksp',13,2],[73,'Ins',15,1]],
  [[43,'Tab',0,1.5],[20,'Q',1.5,1],[26,'W',2.5,1],[8,'E',3.5,1],[21,'R',4.5,1],[23,'T',5.5,1],[28,'Y',6.5,1],[24,'U',7.5,1],[12,'I',8.5,1],[18,'O',9.5,1],[19,'P',10.5,1],[47,'[',11.5,1],[48,']',12.5,1],[49,'\\',13.5,1.5],[76,'Del',15,1]],
  [[57,'Caps',0,1.75],[4,'A',1.75,1],[22,'S',2.75,1],[7,'D',3.75,1],[9,'F',4.75,1],[10,'G',5.75,1],[11,'H',6.75,1],[13,'J',7.75,1],[14,'K',8.75,1],[15,'L',9.75,1],[51,';',10.75,1],[52,"'",11.75,1],[40,'Enter',12.75,2.25],[75,'PgUp',15,1]],
  [[225,'Shift',0,2.25],[29,'Z',2.25,1],[27,'X',3.25,1],[6,'C',4.25,1],[25,'V',5.25,1],[5,'B',6.25,1],[17,'N',7.25,1],[16,'M',8.25,1],[54,',',9.25,1],[55,'.',10.25,1],[56,'/',11.25,1],[229,'Shift',12.25,1.75],[82,'↑',14,1],[78,'PgDn',15,1]],
  [[224,'Ctrl',0,1.25],[227,'Win',1.25,1.25],[226,'Alt',2.5,1.25],[44,'Space',3.75,6.25],[230,'Alt',10,1],[255,'Fn',11,1],[228,'Ctrl',12,1],[80,'←',13,1],[81,'↓',14,1],[79,'→',15,1]],
];
const u16=(lo,hi)=>lo|hi<<8;
// 8 bytes per key: [0xA0|switch, priority<<4|mode, actLo, actHi&1|pressPrec<<3|releasePrec<<1, rtPressLo, rtPressHi&1|pressDz<<1, rtReleaseLo, rtReleaseHi&1|releaseDz<<1]
export function decodeTrigger(b,count=80){
  const out=[];
  for(let i=0;i<count;i++){
    const k=b.slice(i*8,i*8+8);if(k.length<8)break;
    out.push({switchType:k[0]&15,keyMode:k[1]&15,priority:k[1]>>4,actuation:(u16(k[2],k[3]&1)+1)/100,rtPress:(u16(k[4],k[5]&1)+1)/100,rtRelease:(u16(k[6],k[7]&1)+1)/100,pressDeadzone:(k[5]>>1&127)/100,releaseDeadzone:(k[7]>>1&127)/100});
  }
  return out;
}
// Key matrix: 3 bytes per key [type, code1, code2]. Type 0x10 = normal key (code2 = HID; or code1 = modifier bitmask, bit0 = LCtrl = HID 224); 0xf0/0xff = Fn.
export function matrixHids(b){
  const hids=[];
  for(let i=0;i+2<b.length;i+=3){const [t,c1,c2]=b.slice(i,i+3);hids.push(t===0x10?(c2||(c1?224+Math.log2(c1&-c1):null)):t===0xf0&&c1===0xff?255:null);}
  return hids;
}
const pad=(a,n)=>a&&a.length>=n?a:null;
export function decodeMchose(regions){
  const info=pad(regions.info,2),profiles=[];
  for(let p=0;p<4;p++){
    const trig=pad(regions[`key-trigger profile${p}`],8),mat=pad(regions[`key-matrix layer${p*4}`],3);
    if(!trig||!mat)continue;
    const travel=decodeTrigger(trig),hids=matrixHids(mat),byHid=new Map();
    hids.forEach((h,i)=>{if(h!=null&&!byHid.has(h))byHid.set(h,i);});
    profiles.push({index:p,rows:ROWS.map(row=>row.map(([hid,label,x,w])=>({hid,label,x,w,index:byHid.has(hid)?byHid.get(hid):null,travel:byHid.has(hid)?travel[byHid.get(hid)]||null:null})))});
  }
  if(!profiles.length)return null;
  const text=info?String.fromCharCode(...info.slice(2).filter(c=>c>=32&&c<127)).trim():'';
  return {firmware:info?`0x${u16(info[0],info[1]).toString(16).padStart(4,'0')}`:'?',build:text,currentProfileGuess:regions.base?.[0]??null,profiles};
}
// Parses the text engine.mjs puts in the share dialog ("dump <name> (cmd..) got N: hex ...") back into byte arrays.
export function parseDumpText(text){
  const regions={};
  for(const line of text.split(/\r?\n/)){
    const m=line.match(/ dump (.+?) \(cmd \d+ off \d+ size \d+\) got \d+(?: ERROR [^:]*)?: ?([0-9a-f ]*)$/i);
    if(m)regions[m[1]]=m[2].trim()?m[2].trim().split(/\s+/).map(h=>parseInt(h,16)):[];
  }
  return regions;
}
