const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const utils=require('../client-utils');
const reservations=require('../reservations');
const itemId='11111111-1111-4111-8111-111111111111',key='22222222-2222-4222-8222-222222222222';
const appScript=[...fs.readFileSync(require.resolve('../index.html'),'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(s=>s.includes('const SB_URL='));
function fixture(fragment=''){
  const elements=new Map(),listeners={},saved=new Map();
  const item={id:itemId,name:'Gift',price:'10 €',reserved:false,mine:false,fulfilled:false,reserved_by:'PRIVATE GUEST NAME'};
  const receipt={item_id:itemId,receipt_key:key,share_slug:'test-list',name:'Gift',price:'10 €',list_name:'Christmas'};
  const storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
  const getElement=id=>{if(!elements.has(id)){const classes=new Set();elements.set(id,{innerHTML:'',textContent:'',value:'',hidden:false,style:{},classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k)}})}return elements.get(id)};
  const client={rpc:async(name,args)=>{
    if(name==='get_shared_list')return {data:{name:'Christmas',emoji:'🎄',items:[structuredClone(item)]},error:null};
    if(name==='reserve_item'){item.reserved=true;item.mine=true;return {error:null}};
    if(name==='get_reservation_receipt')return {data:item.reserved&&(item.mine||args.p_key===key)?receipt:null,error:null};
    if(name.startsWith('cancel_reservation')){item.reserved=false;item.mine=false;return {error:null}};
    throw new Error(name);
  }};
  const ctx=vm.createContext({supabase:{createClient:()=>client},WishlistUtils:utils,WishlistReservations:reservations,
    document:{getElementById:getElement,addEventListener:(name,fn)=>listeners[name]=fn,hidden:false},
    window:{addEventListener(){}},location:{search:'?l=test-list',hash:fragment,origin:'https://wishlist.example'},
    localStorage:storage,crypto:require('node:crypto').webcrypto,URL,URLSearchParams,
    setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,console,navigator:{clipboard:{writeText:async()=>{}}}});
  vm.runInContext(appScript,ctx);
  return {ctx,item,elements,storage,async ready(){await vm.runInContext('loadGuest()',ctx)},async click(act,id=itemId){const target={dataset:{act,id},disabled:false,textContent:''};await listeners.click({target:{closest:()=>target},preventDefault(){}})}};
}
test('reserve flow confirms the flag, hides identities, persists a receipt and supports cancellation',async()=>{
  const f=fixture();await f.ready();await f.click('res');
  assert.ok(f.elements.get('sheet').innerHTML.includes('Reserve this gift'));
  assert.ok(!f.elements.get('sheet').innerHTML.includes('Your name'));
  await f.click('doRes');
  assert.ok(f.elements.get('root').innerHTML.includes('Reserved by you'));
  assert.ok(!f.elements.get('root').innerHTML.includes('PRIVATE GUEST NAME'));
  assert.ok(f.elements.get('sheet').innerHTML.includes('Reserved for you'));
  assert.ok(f.elements.get('sheet').innerHTML.includes('mailto:'));
  assert.equal(reservations.createStore(f.storage,'https://wishlist.example').list().length,1);
  await f.click('savedReservations');await f.click('openSaved');
  assert.ok(f.elements.get('sheet').innerHTML.includes('Cancel reservation'));
  await f.click('unres');assert.equal(f.item.reserved,false);
  assert.equal(reservations.createStore(f.storage,'https://wishlist.example').list().length,0);
});
test('a private link restores management on a new browser without the original browser token',async()=>{
  const f=fixture('#reservation='+itemId+'&key='+key);f.item.reserved=true;f.item.mine=false;await f.ready();
  await f.click('item');assert.ok(f.elements.get('sheet').innerHTML.includes('Cancel reservation'));
  assert.ok(!f.elements.get('sheet').innerHTML.includes('PRIVATE GUEST NAME'));
});
