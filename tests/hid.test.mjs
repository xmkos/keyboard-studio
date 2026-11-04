import test from 'node:test';
import assert from 'node:assert/strict';
import {frame,createDevice,czFrame} from '../hid.mjs';
import {validateSnapshot} from '../protocol.mjs';

// A fake RT80: answers the read commands from tables, applies write commands, and checks every frame it receives.
function fakeKeyboard(){
  const zeroTail=(a,size)=>a.map((v,i)=>i%size>=90&&i%size<128?0:v);
  const tables={};
  for(const op of [0,1,2,3,4,5,6,7,9])tables[op]=zeroTail(Array.from({length:128},(_,i)=>(op*31+i*7)%200),128);
  tables[10]=zeroTail(Array.from({length:512},(_,i)=>(i*3)%250),128);
  const keymaps=Array.from({length:20},(_,l)=>Array.from({length:512},(_,i)=>i>=360?0:(l*13+i*5)%7));
  const fn=Array.from({length:512},(_,i)=>i>=360?0:(i*5)%7),picture=Array.from({length:384},(_,i)=>i%256);
  const k={tables,keymaps,fn,picture,profileRaw:4,mode:1,sent:[],staged:[]};
  const page=(arr,p)=>arr.slice(p*64,p*64+64);
  k.link={
    sendFeature(d){
      assert.equal(d.length,64);k.sent.push(d);k.last=d;
      const [c,a,b,c3]=d;
      if(c===101){k.staged.push(Array.from(d));if(d[4]){for(const s of k.staged){if(s[1]===8)for(let i=0;i<4;i++)tables[10][i*128+s[3]]=s[8+i];else tables[s[1]][s[3]]=s[8];}k.staged=[];}}
      if(c===19)for(let i=0;i<4;i++)keymaps[a][b*4+i]=d[8+i];
      if(c===29)k.mode=a;
      const r=new Uint8Array(64);r[0]=c;
      if(c===143)r.set([0x14,0x08,0,0],1);
      else if(c===128)r.set([515&255,515>>8],1);
      else if(c===133)r[1]=k.profileRaw;
      else if(c===157)r[1]=k.mode;
      else if(c===134)r.set([0,1,2,3],1);
      else if(c===135)r.set([1,2,3,4,5,6,7],1);
      else if(c===136)r.set([1,2,3,4,5,6,7],1);
      else if(c===146)r.set([1,2,3,4,5,6,7,8],1);
      else if(c===229)r.set(page(tables[a],c3),0);
      else if(c===137)r.set(page(keymaps[a],b),0);
      else if(c===144)r.set(page(fn,b),0);
      else if(c===140)r.set(page(picture,b),0);
      k.reply=r;return Promise.resolve();
    },
    getFeature(){return Promise.resolve(k.reply);}
  };
  return k;
}
const quick={delay:async()=>{}};

test('frame puts the checksum at index cb and keeps data',()=>{
  const d=frame([229,0,1,0]);
  assert.equal(d.length,64);assert.equal(d[7],255-((229+0+1+0)&255));
  const l=frame([7,1,2,3,4,5,6,7],8);assert.equal(l[8],255-(35&255));
});

test('readState reads the whole RT80 and passes validation',async()=>{
  const k=fakeKeyboard(),dev=createDevice(k.link,quick);
  const s=validateSnapshot(await dev.readState());
  assert.equal(s.modelId,2068);assert.equal(s.profileRaw,4);assert.equal(s.profile,1);
  assert.deepEqual(s.tables[0],k.tables[0]);assert.deepEqual(s.tables[10],k.tables[10]);
  assert.equal(s.allKeymaps.length,20);assert.deepEqual(s.keymap,k.keymaps[4]);assert.deepEqual(s.picture,k.picture);
  assert.deepEqual(s.options,[1,2,3]);assert.equal(s.lighting.length,8);
});

test('cached read only re-reads the current slot',async()=>{
  const k=fakeKeyboard(),dev=createDevice(k.link,quick),first=await dev.readState();
  k.sent.length=0;
  await dev.readState([],first.allKeymaps);
  assert.equal(k.sent.filter(d=>d[0]===137).length,4*6);
});

test('applyWrite sends valid frames and re-reads what it wrote',async()=>{
  const k=fakeKeyboard(),dev=createDevice(k.link,quick),before=await dev.readState();
  k.sent.length=0;
  const after=await dev.applyWrite({before,mode:before.mode,changes:[{op:0,pos:5,value:9},{op:7,pos:5,value:3}],remaps:[{layer:4,pos:2,bytes:[0,0,44,0]}],lighting:null,sleep:null,side:null,fnremaps:[],picture:null,options:null,macrowrites:[]});
  assert.equal(after.tables[0][5],9);assert.equal(after.tables[7][5],3);assert.deepEqual(after.keymap.slice(8,12),[0,0,44,0]);
  const writes=k.sent.filter(d=>d[0]===101);
  assert.equal(writes.length,2);assert.equal(writes[0][4],0);assert.equal(writes[1][4],1);
  for(const d of k.sent){if(d[0]===101){let s=0;for(let i=0;i<7;i++)s+=d[i];assert.equal(d[7],255-(s&255));}}
});

test('applyWrite refuses a bad change before any change frame',async()=>{
  const k=fakeKeyboard(),dev=createDevice(k.link,quick),before=await dev.readState();
  k.sent.length=0;
  await assert.rejects(dev.applyWrite({before,mode:before.mode,changes:[{op:0,pos:95,value:1}],remaps:[],macrowrites:[],fnremaps:[]}),/Некоректна команда/);
  assert.equal(k.sent.filter(d=>d[0]===101).length,0);
});

test('a dropped reply is retried',async()=>{
  const k=fakeKeyboard();let fails=2;const real=k.link.getFeature;
  k.link.getFeature=()=>fails-->0?Promise.reject(new Error('lost')):real();
  const s=await createDevice(k.link,quick).readState();
  assert.equal(s.modelId,2068);
});

test('czFrame matches the vendor driver layout',()=>{
  const f=czFrame(3,56);
  assert.deepEqual(Array.from(f.slice(0,8)),[0x55,3,0,56,56,0,0,0]);
  const w=czFrame(5,0,300,[1,2]);
  assert.deepEqual(Array.from(w.slice(0,10)),[0x55,5,0,(2+44+1+0+1+2)&255,2,44,1,0,1,2]);
});

test('czRead reads a region in 56-byte chunks and retries a lost reply',async()=>{
  const {czRead}=await import('../engine.mjs');
  const byteAt=(cmd,o)=>(cmd*7+o)&255;let listeners=[],drop=1;
  const dev={
    addEventListener(n,f){listeners.push(f);},removeEventListener(n,f){listeners=listeners.filter(x=>x!==f);},
    async sendReport(id,f){
      assert.equal(id,0);assert.equal(f[0],0x55);
      const [cmd,size,lo,hi]=[f[1],f[4],f[5],f[6]],offset=lo|hi<<8;
      assert.equal(f[3],(size+lo+hi)&255);
      if(drop-->0)return;
      const r=new Uint8Array(64);r.set([0xaa,cmd,0,0,size,lo,hi,0]);for(let i=0;i<size;i++)r[8+i]=byteAt(cmd,offset+i);
      queueMicrotask(()=>listeners.slice().forEach(l=>l({data:new DataView(r.buffer)})));
    }
  };
  const r=await czRead(dev,160,1024,130);
  assert.equal(r.error,undefined);assert.equal(r.bytes.length,130);
  assert.deepEqual(r.bytes,Array.from({length:130},(_,i)=>byteAt(160,1024+i)));
});

test('MCHOSE actuation write: backup, 56-byte window, verify, restore',async()=>{
  const {readFileSync}=await import('node:fs');
  const {parseDumpText,decodeMchose}=await import('../mchose.mjs');
  const eng=await import('../engine.mjs');
  const store=new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{setItem:(k,v)=>store.set(k,v),getItem:k=>store.get(k)??null,removeItem:k=>store.delete(k),get length(){return store.size;},key:i=>[...store.keys()][i],__keys:()=>[...store.keys()]}});
  // Object.keys(localStorage) must list the stored keys
  const keysOf=Object.keys;Object.keys=o=>o===globalThis.localStorage?[...store.keys()]:keysOf(o);
  const regions=parseDumpText(readFileSync(new URL('./ace68ii-dump.txt',import.meta.url),'utf8'));
  const mem=[];for(let p=0;p<4;p++)mem.push(...regions[`key-trigger profile${p}`]);
  const original=mem.slice();let listeners=[],writes=[];
  const dev={opened:true,
    addEventListener(n,f){listeners.push(f);},removeEventListener(n,f){listeners=listeners.filter(x=>x!==f);},
    async sendReport(id,f){
      const [cmd,size,lo,hi]=[f[1],f[4],f[5],f[6]],off=lo|hi<<8;
      let sum=size+lo+hi;for(let i=0;i<size;i++)sum+=f[8+i];assert.equal(f[3],sum&255);
      const r=new Uint8Array(64);r.set([0xaa,cmd,0,0,size,lo,hi,0]);
      if(cmd===160)for(let i=0;i<size;i++)r[8+i]=mem[off+i];
      else if(cmd===161){writes.push({off,size});assert.equal(size,56);assert.equal(off%8,0);assert.ok(off+size<=4096);for(let i=0;i<size;i++)mem[off+i]=f[8+i];}
      queueMicrotask(()=>listeners.slice().forEach(l=>l({data:new DataView(r.buffer)})));
    }};
  eng.useMchoseDevice(dev,regions);
  const before=decodeMchose(regions),w=before.profiles[1].rows.flat().find(k=>k.label==='W');
  const res=await eng.mchoseSetActuation(1,w.index,0.9);
  const after=res.mchose.profiles[1].rows.flat().find(k=>k.label==='W');
  assert.equal(after.travel.actuation,0.9);
  assert.equal(after.travel.rtPress,w.travel.rtPress);
  const changed=mem.map((b,i)=>b!==original[i]?i:-1).filter(i=>i>=0);
  assert.ok(changed.every(i=>i>=1024+w.index*8&&i<1024+w.index*8+8),'only that key record changed');
  assert.equal(writes.length,1);assert.ok(res.backup);
  await assert.rejects(()=>eng.mchoseSetActuation(1,w.index,9),/Спрацювання/);
  const back=await eng.mchoseRestore(1);
  assert.deepEqual(mem,original);
  assert.equal(back.mchose.profiles[1].rows.flat().find(k=>k.label==='W').travel.actuation,w.travel.actuation);
  Object.keys=keysOf;
});
