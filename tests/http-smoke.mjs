import assert from 'node:assert/strict';
const origin='http://127.0.0.1:18780',seen=new Set();
async function visit(path){
 if(seen.has(path))return;seen.add(path);const r=await fetch(origin+path);assert.equal(r.status,200,`${path} HTTP status`);
 assert.match(r.headers.get('content-type'),path.endsWith('.mjs')?/javascript/:/text\/html/);
 const text=await r.text();const refs=path==='/'?[...text.matchAll(/<script[^>]*type="module"[^>]*src="\.\/([^" ]+)"/g)].map(m=>m[1]):[...text.matchAll(/(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]\.\/([^'"]+)['"]/g)].map(m=>m[1]);
 for(const ref of refs)await visit('/'+ref);
}
await visit('/');assert.ok(seen.has('/app.mjs'));console.log(`Served ${seen.size} HTML/module files with valid MIME types.`);
