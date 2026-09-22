import test from 'node:test';
import assert from 'node:assert/strict';
import {sameSiteDomains} from '../../server/experimental-gateway-domains.mjs';
test('operator naming supports private home names, public suffixes and delegated free domains',()=>{
 for(const parent of ['relay.home.arpa','example.test','example.com','example.co.uk','example.dev','myrelay.duckdns.org'])assert.equal(sameSiteDomains('desktop.'+parent,'apps.'+parent),true,parent);
});
test('operator naming refuses separate sites, public suffix siblings and malformed namespaces',()=>{
 for(const [desktop,apps] of [['desktop.github.io','apps.github.io'],['desktop.duckdns.org','apps.duckdns.org'],['desktop.example.com','apps.other.com'],['desktop.example.com','desktop.example.com'],['Desktop.example.com','apps.example.com'],['desktop.localhost','apps.localhost'],['desktop.com','apps.com'],['desktop.example.com','apps.example.com.evil.test']])assert.equal(sameSiteDomains(desktop,apps),false,desktop+' / '+apps);
});
