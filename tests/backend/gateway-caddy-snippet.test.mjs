import test from 'node:test';
import assert from 'node:assert/strict';
import {caddySnippet} from '../../server/gateway-caddy.mjs';
test('Caddy snippet scopes hosts, overwrites forwarding fields and defaults to deny',()=>{
 const c={proxy:{desktopOrigin:'https://desktop.example.test',trustedProxy:'127.0.0.1'},deployment:{bind:'127.0.0.1',appBaseDomain:'apps.example.test'},port:18444};
 const text=caddySnippet(c);assert.match(text,/https:\/\/desktop.example.test, https:\/\/\*.apps.example.test/);assert.match(text,/respond "Configure source restrictions before enabling access" 403/);assert.match(text,/request_header -X-Forwarded-\*/);assert.match(text,/header_up X-Forwarded-Proto https/);assert.match(text,/reverse_proxy 127.0.0.1:18444/);
 const privateText=caddySnippet(c,['127.0.0.1/32']);assert.match(privateText,/@denied not remote_ip 127.0.0.1\/32/);assert.match(privateText,/respond @denied/);
 for(const v of ['0.0.0.0/0','127.0.0.1/32\nrespond ok','192.168.0.1/24','example.com'])assert.throws(()=>caddySnippet(c,[v]));
});
