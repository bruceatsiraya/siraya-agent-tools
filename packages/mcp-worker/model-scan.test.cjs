const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('../../scripts/model-audit.cjs');
const {inferCapabilities}=load('packages/sdk/src/index.ts');
const {correctModelIdentities}=load('packages/mcp-worker/src/model-corrections.ts');
const {applyStoredOverrides}=load('packages/mcp-worker/src/metadata.ts');
const worker=load('packages/mcp-worker/src/index.ts').default;

test('unfamiliar models are pending independently of the generic openai owner',()=>{
  for(const id of ['new-vendor-model-1','mystery-image-1','new-video-tool','something-gpt-9000']){
    const m=inferCapabilities({id,owned_by:'openai'});
    assert.equal(m.category,'unknown');assert.equal(m.providerName,'Unverified');
    assert.equal(m.identityCheck.status,'pending');assert.equal(m.identityCheck.vendor,'pending');assert.equal(m.identityCheck.category,'pending');
  }
  const knownVendor=inferCapabilities({id:'gemini-99-mystery-render',owned_by:'openai'});
  assert.equal(knownVendor.providerName,'Google');assert.equal(knownVendor.category,'unknown');assert.equal(knownVendor.identityCheck.vendor,'confirmed');
});
test('upstream structured evidence can resolve identity and conflicts stay pending',()=>{
  const m=inferCapabilities({id:'brand-new-image-generator',provider:'Google',category:'image',output_modalities:['text','image']});
  assert.equal(m.category,'image');assert.equal(m.providerName,'Google');assert.equal(m.identityCheck.status,'resolved');
  const conflict=inferCapabilities({id:'gemini-3.5-flash',category:'video'});
  assert.equal(conflict.category,'unknown');assert.equal(conflict.identityCheck.status,'pending');
  const contradictory=inferCapabilities({id:'new-api',provider:'Google',category:'text',output_modalities:['image']});
  assert.equal(contradictory.category,'unknown');
  const vendorConflict=inferCapabilities({id:'gpt-6.2-sol',provider:'Google'});
  assert.equal(vendorConflict.identityCheck.vendor,'pending');assert.equal(vendorConflict.providerName,'Unverified');
  assert.equal(inferCapabilities({id:'gpt-6.2-sol',owned_by:'anthropic'}).identityCheck.vendor,'pending');
  assert.equal(inferCapabilities({id:'gemini-3.5-flash',output_modalities:['3d']}).category,'unknown');
  const upstreamResolved=inferCapabilities({id:'face-swap-spicy',provider:'MiniMax'});
  assert.equal(upstreamResolved.providerName,'MiniMax');assert.equal(upstreamResolved.identityCheck.status,'resolved');
});
test('cached guesses are rechecked and stored manual confirmation survives rescans',async()=>{
  const registry={generatedAt:'2026-11-20T00:00:00.000Z',models:[{...inferCapabilities({id:'new-model-123'}),providerName:'OpenAI',category:'text'}]};
  const checked=correctModelIdentities(registry);
  assert.equal(checked.models[0].category,'unknown');assert.equal(checked.identitySummary.pendingCategory,1);
  const db={prepare(){return{all:async()=>({results:[{model_id:'new-model-123',patch_json:JSON.stringify({provider:'example',providerName:'Example AI',category:'image',_identity_review:{vendor:true,category:true}})}]})}}};
  const approved=await applyStoredOverrides(registry,db);
  assert.equal(approved.models[0].providerName,'Example AI');assert.equal(approved.models[0].category,'image');assert.equal(approved.models[0].identityCheck.status,'resolved');
  assert.equal(correctModelIdentities(approved).models[0].category,'image');
  const legacyDb={prepare(){return{all:async()=>({results:[{model_id:'kling-o1',patch_json:JSON.stringify({providerName:'OpenAI',category:'text'})}]})}}};
  const legacy=await applyStoredOverrides({generatedAt:registry.generatedAt,models:[inferCapabilities({id:'kling-o1'})]},legacyDb);
  assert.equal(legacy.models[0].category,'video');assert.equal(legacy.models[0].providerName,'Kling');
});
test('the platform scheduled sync fetches, checks and persists newly discovered models',async()=>{
  const previousFetch=global.fetch;const storage=new Map();const requests=[];
  global.fetch=async input=>{const url=String(input);requests.push(url);if(url==='https://scanner.test/v1/models')return new Response(JSON.stringify({data:[{id:'brand-new-generator',owned_by:'openai'},{id:'SIRAYA-Seedance-2.7-flash',owned_by:'openai'},{id:'gemini-99-new-mode',owned_by:'openai'}]}),{headers:{'content-type':'application/json'}});return new Response('Unavailable',{status:503})};
  const env={
    SIRAYA_API_KEY:'test-only-key',SIRAYA_BASE_URL:'https://scanner.test/v1',
    SIRAYA_REGISTRY:{get:async key=>storage.has(key)?JSON.parse(storage.get(key)):null,put:async(key,value)=>{storage.set(key,value)}},
    SIRAYA_METADATA:{prepare(){return{bind(){return this},all:async()=>({results:[]}),first:async()=>null,run:async()=>({})}}}
  };
  try{
    const tasks=[];await worker.scheduled({cron:'0 18 * * *'},env,{waitUntil:p=>tasks.push(p)});await Promise.all(tasks);
    assert.ok(requests.includes('https://scanner.test/v1/models'));assert.equal(storage.size,1);
    const stored=JSON.parse([...storage.values()][0]);
    assert.equal(stored.models.find(m=>m.id==='brand-new-generator').category,'unknown');
    assert.equal(stored.models.find(m=>m.id==='SIRAYA-Seedance-2.7-flash').category,'video');
    assert.equal(stored.models.find(m=>m.id==='gemini-99-new-mode').providerName,'Google');
    assert.equal(stored.identitySummary.pending,2);assert.equal(stored.identitySummary.pendingCategory,2);
    const response=await worker.fetch(new Request('https://platform.test/registry'),env);
    const served=await response.json();assert.equal(served.models.find(m=>m.id==='brand-new-generator').identityCheck.status,'pending');
  }finally{global.fetch=previousFetch}
});
