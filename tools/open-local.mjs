import {readFile,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../.runtime/',import.meta.url));
let text;
try{
 let file=root+'open-url.txt';
 try{await stat(root+'setup-url.txt');file=root+'setup-url.txt';}catch(e){if(e.code!=='ENOENT')throw e;}
 const mode=(await stat(file)).mode&0o777;if(mode!==0o600)throw Error('Unsafe credential file permissions');
 text=(await readFile(file,'utf8')).trim();
 const url=new URL(text);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||!/^\d+$/.test(url.port)||url.username||url.password||url.search||(url.hash&&!/^#[0-9a-f]{64}$/.test(url.hash)))throw Error('Unexpected local URL');
}catch{console.error('Start Relay first. A protected local enrollment/login URL is required.');process.exit(1);}
const command=process.platform==='darwin'?'open':process.platform==='linux'?'xdg-open':null;
if(!command){console.error('Open .runtime/setup-url.txt for first enrollment, otherwise .runtime/open-url.txt. Keep the setup credential private.');process.exit(1);}
const result=spawnSync(command,[text],{stdio:'ignore'});
if(result.error||result.status!==0){console.error('Could not open a browser. Use the protected local URL file.');process.exit(1);}
console.log('Opened local enrollment/login. Existing accounts require their password; restart does not bypass login.');
