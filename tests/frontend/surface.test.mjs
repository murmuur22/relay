import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mockAssets} from './mock-assets.mjs';
import {Manager} from '../../server/streams.mjs';
let browser,serve;
before(async()=>{serve=await mockAssets(new URL('./surface-fixture.html',import.meta.url));browser=await chromium.launch({chromiumSandbox:true});});
after(async()=>{await browser?.close();});
async function surface(t) {
  const page=await browser.newPage();t.after(()=>page.close());await serve(page);
  await page.addInitScript(()=>{
    window.messages=[];
    class Socket {static OPEN=1;readyState=1;send(raw){window.messages.push(JSON.parse(raw));}close(){this.readyState=3;this.onclose?.();}
      constructor(){queueMicrotask(()=>{this.onopen?.();this.onmessage?.({data:JSON.stringify({type:'state',state:'live'})});});}}
    window.WebSocket=Socket;
  });
  await page.goto('http://relay-test.invalid/');
  await page.locator('.stream-status.live').waitFor();
  await page.getByRole('application').focus();
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));
  await page.evaluate(()=>window.messages=[]);
  return page;
}
for(const kind of ['paste','composition'])for(const [name,text,expected] of [
  ['3000 characters','x'.repeat(3000),'x'.repeat(3000)],
  ['Unicode boundaries','a'.repeat(1023)+'😀'.repeat(1200),'a'.repeat(1023)+'😀'.repeat(1200)],
  ['JSON escaping','\u0001'.repeat(4096),'\u0001'.repeat(4096)],
  ['total limit','a'.repeat(4095)+'😀extra','a'.repeat(4095)],
])test(`${kind} sends bounded Unicode-safe chunks: ${name}`,async t=>{
  const page=await surface(t);
  await page.evaluate(({kind,text})=>{
    const input=document.querySelector('[role=application]');
    if(kind==='paste') {const data=new DataTransfer();data.setData('text/plain',text);input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));}
    else {input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.dispatchEvent(new CompositionEvent('compositionend',{data:text,bubbles:true}));}
  },{kind,text});
  const messages=await page.evaluate(()=>window.messages.filter(m=>m.type==='text'));
  for(const m of messages){assert.ok(m.text.length<=2048);assert.ok(m.text.isWellFormed());assert.ok(Buffer.byteLength(JSON.stringify(m))<8192);}
  assert.equal(messages.map(m=>m.text).join(''),expected);
  const inserted=[],manager=new Manager('/unused-synthetic',[]);
  for(const m of messages)await manager.input({cdp:{send:async(method,params)=>{assert.equal(method,'Input.insertText');inserted.push(params.text);}}},{width:800,height:500},m);
  assert.equal(inserted.join(''),expected);
});

test('blur invalidates an outstanding surface focus activation',async t=>{
  const page=await surface(t);
  await page.evaluate(()=>{
    const input=document.querySelector('[role=application]');input.blur();
    window.activation=new Promise(resolve=>window.resolveActivation=resolve);input.focus();
    window.dispatchEvent(new Event('blur'));window.resolveActivation();
  });
  await page.keyboard.type('must not dispatch');
  assert.deepEqual(await page.evaluate(()=>window.messages.filter(m=>m.type==='text')),[]);
});

for(const event of ['surface blur','browser blur','visibility loss','teardown'])test(`surface sends explicit release on ${event}`,async t=>{
  const page=await surface(t);await page.keyboard.down('Shift');
  await page.evaluate(event=>{
    if(event==='surface blur')document.querySelector('[role=application]').blur();
    if(event==='browser blur')window.dispatchEvent(new Event('blur'));
    if(event==='visibility loss'){Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));}
    if(event==='teardown')window.destroySurface();
  },event);
  const messages=await page.evaluate(()=>window.messages);
  assert.ok(messages.some(m=>m.type==='release'));
});
