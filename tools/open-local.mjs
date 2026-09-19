import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const file=fileURLToPath(new URL('../.runtime/bootstrap-url.txt',import.meta.url));
let text;
try{text=(await readFile(file,'utf8')).trim();}catch{console.error('Start Relay first. No bootstrap file is available.');process.exit(1);}
const url=new URL(text);
if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/bootstrap'||!/^\d+$/.test(url.port)||! /^[0-9a-f]{64}$/.test(url.searchParams.get('token')||''))throw Error('Unexpected local bootstrap URL; refusing to open it.');
const command=process.platform==='darwin'?'open':process.platform==='linux'?'xdg-open':null;
if(!command){console.error('Open the protected local bootstrap file in your own browser. Keep its contents private.');process.exit(1);}
const result=spawnSync(command,[text],{stdio:'ignore'});
if(result.error||result.status!==0){console.error('Could not open a browser. Use the protected local bootstrap file.');process.exit(1);}
console.log('Opened the one-time local unlock link. Subsequent visits can use http://127.0.0.1:'+url.port+'.');
