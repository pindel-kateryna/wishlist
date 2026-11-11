const { test } = require('node:test');
const assert = require('node:assert/strict');
const { receiptLink, parseReceiptFragment, createStore, createService } = require('../reservations');
const itemId='11111111-1111-4111-8111-111111111111', key='22222222-2222-4222-8222-222222222222';
const receipt={item_id:itemId,receipt_key:key,share_slug:'shared-list',name:'Gift',price:'10 €',list_name:'Christmas'};
function storage(){const entries=new Map();return {getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v)}}
test('a receipt link keeps its single-reservation secret in the fragment',()=>{
  const url=new URL(receiptLink('https://wishlist.example',receipt));
  assert.equal(url.search,'?l=shared-list');assert.ok(!url.search.includes(key));
  assert.deepEqual(parseReceiptFragment(url.hash),{itemId,key});
  assert.equal(parseReceiptFragment('#reservation=invalid&key=invalid'),null);
});
test('reservations persist across reloads without guest names or browser tokens',()=>{
  const memory=storage();const store=createStore(memory,'https://wishlist.example');
  assert.equal(store.save({...receipt,guest_token:'do-not-store',guest_name:'Private name'}).persisted,true);
  const loaded=createStore(memory,'https://wishlist.example').list();
  assert.equal(loaded.length,1);assert.equal(loaded[0].receipt_key,key);
  assert.ok(!JSON.stringify(loaded).includes('Private name'));assert.ok(!JSON.stringify(loaded).includes('do-not-store'));
  store.save(receipt);assert.equal(store.list().length,1);store.remove(itemId);assert.equal(store.list().length,0);
});
test('storage failure still provides a usable private backup link',()=>{
  const store=createStore({getItem(){throw Error('blocked')},setItem(){throw Error('full')}},'https://wishlist.example');
  const saved=store.save(receipt);assert.equal(saved.persisted,false);assert.ok(saved.link.includes(key));assert.equal(store.list().length,1);
});
test('malformed storage and receipts are handled safely',()=>{
  assert.deepEqual(createStore({getItem:()=>'{bad'},'https://wishlist.example').list(),[]);
  assert.throws(()=>createStore(storage(),'https://wishlist.example').save({item_id:'bad'}),/Invalid/);
});
test('a successful RPC is not treated as a confirmed reservation without the returned status',async()=>{
  const service=createService({rpc:async()=>({error:null})});
  await assert.rejects(service.reserve(itemId,'browser-token',async()=>({items:[{id:itemId,reserved:false,mine:false}]})),/Could not confirm/);
});
test('rapid repeated clicks submit only one reservation request',async()=>{
  let release;const barrier=new Promise(resolve=>release=resolve);let writes=0;
  const service=createService({rpc:async()=>{writes++;await barrier;return {error:null}}});
  const first=service.reserve(itemId,'browser-token',async()=>({items:[{id:itemId,reserved:true,mine:true}]}));
  await assert.rejects(service.reserve(itemId,'browser-token',async()=>({items:[]})),/already being processed/);
  release();assert.equal((await first).mine,true);assert.equal(writes,1);
});
test('a server error is reported and does not permanently lock the button',async()=>{
  let fails=true;const service=createService({rpc:async()=>fails?{error:new Error('Already reserved')}:{error:null}});
  await assert.rejects(service.reserve(itemId,'token',async()=>({items:[]})),/Already reserved/);
  fails=false;assert.equal((await service.reserve(itemId,'token',async()=>({items:[{id:itemId,reserved:true,mine:true}]}))).reserved,true);
});
test('cancellation uses the receipt capability and verifies the updated status',async()=>{
  const calls=[];const service=createService({rpc:async(name,args)=>{calls.push({name,args});return {error:null}}});
  await service.cancel(itemId,'browser-token',key,async()=>({items:[{id:itemId,reserved:false,mine:false}]}));
  assert.equal(calls[0].name,'cancel_reservation_receipt');assert.deepEqual(calls[0].args,{p_item:itemId,p_key:key});
  await assert.rejects(service.cancel(itemId,'browser-token',null,async()=>({items:[{id:itemId,reserved:true,mine:true}]})),/Could not confirm cancellation/);
});
