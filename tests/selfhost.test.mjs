import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {once} from 'node:events';
import {createApp,readPassword} from '../deploy/server.mjs';
import {blankLedger} from '../lib/ledger.ts';
const removeTestDir=(dir)=>{const target=resolve(dir);assert(target.startsWith(resolve(tmpdir())+sep+'qingzhang-'));rmSync(target,{recursive:true,force:true});};
test('自托管：登录、持久化、来源检查、并发校验及重启',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'qingzhang-test-')),web=join(dir,'web');mkdirSync(web);writeFileSync(join(web,'index.html'),'<!doctype html><h1>清账</h1>');
 const password='test-strong-password-123',headers={Authorization:'Basic '+Buffer.from('admin:'+password).toString('base64')};
 let app=createApp({dataDir:dir,webDir:web,user:'admin',password});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');let base='http://127.0.0.1:'+app.server.address().port;
 const post=(data,revision,origin=base)=>fetch(base+'/api/ledger',{method:'POST',headers:{...headers,'Content-Type':'application/json',Origin:origin},body:JSON.stringify({data,revision})});
 try{
  assert.equal((await fetch(base+'/healthz')).status,200);
  assert.equal((await fetch(base+'/')).status,401);
  assert.equal((await fetch(base+'/api/ledger',{headers:{'oai-authenticated-user-id':'spoof'}})).status,401);
  assert.equal((await fetch(base+'/',{headers})).status,200);
  assert.equal((await fetch(base+'/api/session',{headers}).then(r=>r.json())).userName,'admin');
  const d=blankLedger();d.company='自托管测试';d.opening={'1002':1000000,'3001':-1000000};
  assert.equal((await post(d,0,'https://evil.example')).status,403);
  const bad=structuredClone(d);bad.opening['1002']++;assert.equal((await post(bad,0)).status,400);
  let r=await post(d,0);assert.equal(r.status,200);assert.equal((await r.json()).revision,1);
  assert.equal((await post(d,0)).status,409);
  assert.equal((await fetch(base+'/api/ledger',{headers}).then(r=>r.json())).data.company,'自托管测试');
  d.vouchers.push({id:'test-1',number:'记-1',date:'2026-10-01',memo:'',closing:false,lines:[{summary:'收款',account:'1002',debit:100000,credit:0,flow:'sale'},{summary:'收入',account:'5001',debit:0,credit:100000,flow:''}]});
  assert.equal((await post(d,1)).status,200);d.vouchers[0].lines[0].debit=200000;d.vouchers[0].lines[1].credit=200000;assert.equal((await post(d,2)).status,200);
  await new Promise(resolve=>app.server.close(resolve));app.db.close();
  app=createApp({dataDir:dir,webDir:web,user:'admin',password});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');base='http://127.0.0.1:'+app.server.address().port;
  const persisted=await fetch(base+'/api/ledger',{headers}).then(r=>r.json());assert.equal(persisted.revision,3);assert.equal(persisted.data.vouchers[0].lines[0].debit,200000);
  d.vouchers=[];assert.equal((await post(d,3)).status,200);
  assert.equal((await fetch(base+'/api/ledger',{headers}).then(r=>r.json())).data.vouchers.length,0);
  assert.equal((await fetch(base+'/api/ledger',{method:'POST',headers:{...headers,'Content-Type':'text/plain'},body:'{}'})).status,415);
  assert.equal((await fetch(base+'/api/ledger',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'x'.repeat(4_000_001)})).status,413);
  assert.equal((await fetch(base+'/%2e%2e%2fledger.sqlite',{headers})).status,404);
 }finally{await new Promise(resolve=>app.server.close(resolve));app.db.close();removeTestDir(dir);}
});
test('自动生成密码持久化且不使用共享默认密码',()=>{const dir=mkdtempSync(join(tmpdir(),'qingzhang-password-'));try{const a=readPassword(dir,{}),b=readPassword(dir,{});assert.equal(a,b);assert.equal(a.length,32);assert.equal(readFileSync(join(dir,'admin-password'),'utf8').trim(),a);}finally{removeTestDir(dir);}});

