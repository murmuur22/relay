import test from 'node:test';
import assert from 'node:assert/strict';
import {gatewayForm,configFromForm} from '../../src/gateway-settings.js';
import {remoteReference} from '../remote-tls-helper.mjs';
test('separate-VM form roundtrips v3 paths and identity policy without silently downgrading',()=>{
 const ref=remoteReference('/etc/relay-backend',8444,'192.168.40.10','192.168.40.11');
 const form=gatewayForm(ref);assert.equal(form.mode,'remote-proxy');assert.deepEqual(configFromForm(form),ref);
 for(const edit of [f=>f.backendTLS.clientName='*.example.test',f=>f.backendTLS.clientCAPath='',f=>f.caddyTLS.clientKeyPath='secret contents',f=>f.trustedProxy='0.0.0.0',f=>f.bind='8.8.8.8']){const f=gatewayForm(ref);edit(f);assert.throws(()=>configFromForm(f));}
 form.mode='reverse-proxy';assert.throws(()=>configFromForm(form));
});
