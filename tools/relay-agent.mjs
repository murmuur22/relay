#!/usr/bin/env node
// API-only client. Never imports server stores, writes configuration, or follows redirects.
import http from 'node:http';
import https from 'node:https';
import {open,constants} from 'node:fs/promises';
const HELP=`Relay agent API tracer (experimental, session-bound credentials, maximum 900 seconds)
Usage: node tools/relay-agent.mjs state|list|plan|apply --url https://relay.example
       (--token-file PATH | --token-stdin) [--input PATH|-] [--json]
       --loopback-http permits HTTP only to literal 127.0.0.1 or [::1] test servers.
state/list: shared targets and Gateway app state, stable IDs and revision.
plan: bounded JSON {expectedRevision,change:{type:"target"|"app",id,set}}.
      App creation uses id:null. Input must include a freshly read revision.
apply: submit the exact saved plan JSON; retries reconcile the same plan.
Tokens never belong in argv, URLs or logs. Token files must be owner-only regular files.
No redirects, insecure TLS option, durable automation, or rollback guarantee.
`;
const fail=(code,message,status)=>Object.assign(new Error(message),{code,status});
async function bounded(stream,max){let size=0;const chunks=[];for await(const chunk of stream){size+=chunk.length;if(size>max)throw fail('INPUT_TOO_LARGE','Input exceeds the bounded size');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');}
async function file(path,max,protectedToken=false){
 let f;try{f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const s=await f.stat();if(!s.isFile()||s.size>max||(protectedToken&&((s.mode&0o077)!==0||s.uid!==process.getuid())))throw fail('CREDENTIAL_FILE','Expected a protected owner-only regular token file');return await bounded(f.createReadStream({autoClose:false}),max);}catch(e){if(e.code==='INPUT_TOO_LARGE'||e.code==='CREDENTIAL_FILE')throw e;throw fail('INPUT_FILE','Unable to read the required regular input file');}finally{await f?.close();}
}
function request(url,secret,body){return new Promise((resolve,reject)=>{
 const data=body===undefined?undefined:JSON.stringify(body),transport=url.protocol==='https:'?https:http;
 const req=transport.request(url,{method:data===undefined?'GET':'POST',rejectUnauthorized:true,headers:{authorization:'Bearer '+secret,accept:'application/json',...(data?{'content-type':'application/json','content-length':Buffer.byteLength(data)}:{})}},async res=>{
  try{
   if(res.statusCode>=300&&res.statusCode<400){res.destroy();throw fail('REDIRECT_REFUSED','Redirect refused; Bearer credentials were not forwarded',res.statusCode);}
   const text=await bounded(res,131072);let result;try{result=JSON.parse(text);}catch{throw fail('RESPONSE','Server returned an invalid JSON response',res.statusCode);}
   if(res.statusCode<200||res.statusCode>=300)throw fail('API_REJECTED','Agent API rejected the request (HTTP '+res.statusCode+'). Read state or renew authorization before retrying.',res.statusCode);
   resolve(result);
  }catch(e){reject(e);}
 });
 req.setTimeout(15000,()=>req.destroy(fail('TIMEOUT','Agent API request timed out; read state before retrying an apply')));
 req.on('error',()=>reject(fail('CONNECTION','Connection or verified TLS failed; read state before retrying an apply')));req.end(data);
});}
async function main(){
 const args=process.argv.slice(2);if(args.length===1&&['--help','help','-h'].includes(args[0])){process.stdout.write(HELP);return;}
 const command=args.shift();if(!['state','list','plan','apply'].includes(command))throw fail('USAGE','Expected state, list, plan or apply; use --help');
 const options={};while(args.length){const key=args.shift();if(!['--url','--token-file','--token-stdin','--input','--json','--loopback-http'].includes(key)||key in options)throw fail('USAGE','Unknown or duplicate option; use --help');if(['--json','--loopback-http','--token-stdin'].includes(key))options[key]=true;else{const value=args.shift();if(!value||value.startsWith('--'))throw fail('USAGE','Option requires a value');options[key]=value;}}
 let base;try{base=new URL(options['--url']);}catch{throw fail('URL','Expected a verified HTTPS origin');}
 if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||!['https:','http:'].includes(base.protocol))throw fail('URL','Expected an origin without credentials, path, query or fragment');
 if(base.protocol==='http:'&&!(options['--loopback-http']&&/^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::[0-9]+)?\/?$/.test(options['--url'])))throw fail('HTTPS_REQUIRED','Verified HTTPS required; literal loopback HTTP needs --loopback-http');
 if(!!options['--token-file']===!!options['--token-stdin'])throw fail('CREDENTIAL_INPUT','Choose exactly one protected token file or --token-stdin');
 const mutation=['plan','apply'].includes(command);if(mutation!==!!options['--input']||options['--token-stdin']&&options['--input']==='-')throw fail('INPUT','Plan/apply need --input PATH|-; token and JSON cannot share stdin');
 const secret=(options['--token-file']?await file(options['--token-file'],128,true):await bounded(process.stdin,128)).trim();if(!/^[a-f0-9]{64}$/.test(secret))throw fail('CREDENTIAL_INPUT','Expected one bounded agent token, not a browser cookie');
 let body;if(mutation){const text=options['--input']==='-'?await bounded(process.stdin,16384):await file(options['--input'],16384);try{body=JSON.parse(text);}catch{throw fail('JSON_INPUT','Expected bounded JSON input');}if(!body||typeof body!=='object'||Array.isArray(body))throw fail('JSON_INPUT','Expected a JSON object');}
 const result=await request(new URL('/api/agent/v1/'+(mutation?(command==='plan'?'plans':'apply'):'state'),base),secret,body);
 process.stdout.write(options['--json']?JSON.stringify(result)+'\n':JSON.stringify(result,null,2)+'\n');
}
main().catch(e=>{const error={code:e.code??'CLIENT_ERROR',message:e.message,status:e.status};process.stderr.write(process.argv.includes('--json')?JSON.stringify({error})+'\n':'Relay agent: '+error.message+'\n');process.exitCode=1;});
