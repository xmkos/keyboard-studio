// Optional local static server. Keyboard Studio talks to the keyboard from the browser (WebHID),
// so any HTTPS static host works too; WebHID only needs https:// or http://localhost.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn} from 'node:child_process';

const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT)||18780,origin=`http://127.0.0.1:${port}`;
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.webp':'image/webp'};
const server=http.createServer(async(req,res)=>{
  const name=new URL(req.url,origin).pathname;
  const file=name==='/'?'index.html':name.slice(1);
  // Only the app's own files: top-level .html/.css/.mjs and assets/*.webp, never tests, backups or legacy.
  const type=/^(assets\/)?[\w.-]+$/.test(file)&&!file.includes('..')?mime[path.extname(file)]:null;
  if(req.method!=='GET'||!type||(file.startsWith('assets/')&&type!==mime['.webp'])){res.writeHead(404);return res.end('Not found');}
  try{res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(await readFile(path.join(root,file)));}
  catch{res.writeHead(404);res.end('Not found');}
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} is already in use. Close the other copy and try again.`:e.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{
  console.log(`Keyboard Studio: ${origin}`);
  if(process.argv.includes('--open'))spawn('cmd',['/c','start','',origin],{windowsHide:true,stdio:'ignore'}).on('error',()=>console.error(`Open ${origin} in Chrome or Edge.`));
});
