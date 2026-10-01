// Explicit local-only disposable Docker qualification. No published ports, host
// networking, daemon mounts, privileged containers or existing service mutation.
import {execFileSync} from 'node:child_process';
import {mkdtemp,realpath,cp,mkdir,writeFile,chmod,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {remotePKI} from '../tests/remote-tls-helper.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const run=(cmd,args,timeout=30000)=>execFileSync(cmd,args,{encoding:'utf8',timeout,stdio:['ignore','pipe','pipe']}).trim();
const context=run('docker',['context','show']),endpoint=process.env.DOCKER_HOST||run('docker',['context','inspect',context,'--format','{{.Endpoints.docker.Host}}']);
assert.ok(endpoint.startsWith('unix:///')&&!process.env.DOCKER_CONTEXT?.startsWith('ssh:'),'Only a local Unix Docker endpoint is allowed');
// Pin all subsequent invocations to the endpoint actually inspected.
const docker=args=>run('docker',['--host',endpoint,...args],120000);
assert.equal(docker(['info','--format','{{.OSType}}']),'linux');
const image=process.env.RELAY_TEST_NODE_IMAGE,binary=process.env.RELAY_TEST_CADDY_LINUX;
assert.match(image??'',/^node@sha256:[a-f0-9]{64}$/,'Set RELAY_TEST_NODE_IMAGE to the inspected local Node image digest');
assert.ok(binary?.startsWith('/'),'Set RELAY_TEST_CADDY_LINUX to a checksummed matching Linux Caddy binary');
docker(['image','inspect',image]);
const dir=await realpath(await mkdtemp(tmpdir()+'/relay-remote-ns-')),id='relay-063-'+randomBytes(6).toString('hex'),containers=[];let network=false;
try{
 await mkdir(dir+'/source',0o755);await mkdir(dir+'/fixture',0o700);
 // Explicit allowlist, not an archive of the developer's working folder.
 for(const name of ['server','dist','node_modules','version.js','package.json'])await cp(root+'/'+name,dir+'/source/'+name,{recursive:true});
 await mkdir(dir+'/source/updater/web',{recursive:true});await cp(root+'/updater/web/broker-client.mjs',dir+'/source/updater/web/broker-client.mjs');
 await mkdir(dir+'/source/tests');for(const name of ['remote-container-role.mjs','remote-tls-helper.mjs'])await cp(root+'/tests/'+name,dir+'/source/tests/'+name);
 const fixture=dir+'/fixture';await remotePKI(fixture);await cp(binary,fixture+'/caddy');await chmod(fixture+'/caddy',0o755);
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',fixture+'/browser.key','-out',fixture+'/browser.pem','-subj','/CN=desktop.example.test','-addext','subjectAltName=DNS:desktop.example.test,DNS:*.apps.example.test,DNS:sibling.example.test','-addext','basicConstraints=critical,CA:TRUE'],{stdio:'ignore'});await chmod(fixture+'/browser.key',0o600);await chmod(fixture+'/browser.pem',0o600);
 docker(['network','create','--internal','--label','relay.disposable='+id,id]);network=true;
 const topology={};
 for(const role of ['relay','caddy','client']){
  const name=id+'-'+role;containers.push(name);
  docker(['create','--name',name,'--label','relay.disposable='+id,'--network',id,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=128','--memory=512m','--user',String(process.getuid()),'--tmpfs','/tmp:rw,nosuid,nodev,size=64m','--mount',`type=bind,src=${dir}/source,dst=/source,readonly`,'--mount',`type=bind,src=${fixture},dst=/fixture`,'--workdir','/source','--env','RELAY_FIXTURE_ROLE='+role,image,'node','tests/remote-container-role.mjs']);
  docker(['start',name]);
  const inspect=JSON.parse(docker(['inspect',name]))[0];assert.equal(inspect.HostConfig.Privileged,false);assert.deepEqual(inspect.HostConfig.PortBindings,{});topology[role]=inspect.NetworkSettings.Networks[id].IPAddress;
 }
 assert.equal(new Set(Object.values(topology)).size,3);await writeFile(fixture+'/topology.json',JSON.stringify(topology),{mode:0o600});
 const code=docker(['wait',id+'-client']);
 console.log(docker(['logs',id+'-client']));
 assert.equal(code,'0','Isolated client qualification failed');
 console.log('PASS distinct container network namespaces; local Docker only, no host ports or production services');
}finally{
 for(const name of containers.reverse())try{docker(['rm','-f',name]);}catch{}
 if(network)docker(['network','rm',id]);
 await rm(dir,{recursive:true,force:true});
}
