import test from 'node:test';
import assert from 'node:assert/strict';
import {gatewayForm,configFromForm} from '../../src/gateway-settings.js';
test('proxy setup form serializes versioned external origin without local certificate fields',()=>{
 const form=gatewayForm();form.mode='reverse-proxy';form.desktopOrigin='https://desktop.example.test';form.appBaseDomain='apps.example.test';form.trustedProxy='127.0.0.1';form.targets[0].upstream='http://127.0.0.1:8096';
 form.sourceRangesText='192.168.40.0/24, 100.64.0.0/24';
 const c=configFromForm(form);assert.deepEqual(c.sourceRanges,['192.168.40.0/24','100.64.0.0/24']);assert.equal(c.version,2);assert.equal(c.mode,'reverse-proxy');assert.equal(c.desktopOrigin,form.desktopOrigin);assert.equal(c.trustedProxy,'127.0.0.1');assert.equal(c.keyPath,undefined);assert.equal(c.certPath,undefined);
 assert.deepEqual(configFromForm(gatewayForm(c)),c);
 form.desktopOrigin='https://desktop.example.test:0';assert.throws(()=>configFromForm(form));
});
