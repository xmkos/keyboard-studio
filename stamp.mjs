// Run before every deploy: node stamp.mjs
// GitHub Pages caches files for 10 minutes, so a visitor could get a new app.mjs with an old engine.mjs and the page breaks.
// A fresh ?v= on every local import, script and stylesheet makes the browser fetch them together.
import {readdir,readFile,writeFile} from 'node:fs/promises';
const v=Date.now().toString(36);
for(const f of (await readdir('.')).filter(f=>/\.(mjs|html)$/.test(f)&&f!=='stamp.mjs'&&f!=='server.mjs')){
  const old=await readFile(f,'utf8');
  const next=old.replace(/((?:from\s*|import\s*)['"]|(?:src|href)=")(\.\/[\w-]+\.(?:mjs|css))(?:\?v=\w+)?(['"])/g,`$1$2?v=${v}$3`);
  if(next!==old){await writeFile(f,next);console.log('stamped',f);}
}
