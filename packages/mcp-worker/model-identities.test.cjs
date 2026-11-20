const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('../../scripts/model-audit.cjs');
const audit=require('../../docs/model-identity-audit.json');
const sdk=load('packages/sdk/src/index.ts');
const {correctModelIdentities}=load('packages/mcp-worker/src/model-corrections.ts');
const {modelListRows,correctQuoteIdentity}=load('packages/mcp-worker/src/model-list.ts');
const legacyExceptions=new Set(['siraya-seedance-2.5-flash','gemini-nano-banana-2.1','gemini-omni-1.1-flash-preview']);
test('all audited IDs have the checked upstream vendor and category in the SDK and cache',()=>{
  assert.equal(audit.models.length,180);
  for(const expected of audit.models){
    const model=sdk.inferCapabilities({id:expected.id,owned_by:'openai'});
    assert.equal(model.providerName,expected.vendor,expected.id+' vendor');assert.equal(model.category,expected.category,expected.id+' category');
    const old={...model,providerName:expected.previousVendor,category:expected.previousCategory,pricing:{unit:'unchanged'}};
    const corrected=correctModelIdentities({models:[old]}).models[0];
    assert.equal(corrected.providerName,expected.vendor,expected.id+' cached vendor');assert.equal(corrected.category,expected.category,expected.id+' cached category');
    assert.equal(corrected.pricing,old.pricing);
    if(!legacyExceptions.has(model.id.toLowerCase())){assert.equal(corrected.apiFormats,old.apiFormats);assert.equal(corrected.supportedParameters,old.supportedParameters);assert.equal(corrected.features,old.features)}
  }
});
test('legacy workbook vendor labels cannot override checked model identities',async()=>{
  const models=audit.models.map(m=>sdk.inferCapabilities({id:m.id}));
  const db={prepare(sql){return{all:async()=>({results:sql.includes('FROM model_list_specs')?models.map(m=>({model_id:m.id,baseline:JSON.stringify([0,'Wrong vendor']),rpm:null,tpm:null,discount:null})):[]})}}};
  const rows=await modelListRows(db,{models});
  for(const row of rows){const expected=audit.models.find(m=>m.id===row.cells[3]);assert.equal(row.cells[1],expected.vendor);assert.equal(row.category,expected.category==='text'?'LLM':expected.category[0].toUpperCase()+expected.category.slice(1))}
  assert.equal(rows.find(r=>r.cells[3]==='kling-tts').category,'Audio');
  assert.equal(rows.find(r=>r.cells[3]==='wan2.7-r2v').category,'Video');
});
test('routing prefixes and overlapping model tokens do not change upstream identity',()=>{
  for(const [id,vendor,category] of [['NSFW-Dola-Seedream-5.5','BytePlus','image'],['SIRAYA-Seedance-2.5-flash','BytePlus','video'],['kling-o1','Kling','video'],['kling-tts','Kling','audio'],['FW-MiniMax-M2.5','MiniMax','text'],['gpt-4.1','OpenAI','text']]){
    const m=sdk.inferCapabilities({id});assert.equal(m.providerName,vendor);assert.equal(m.category,category);
  }
});
test('existing quote classification is corrected without changing the price snapshot',()=>{
  const cells=[1,'Wan','Wan R2V','wan2.7-r2v',0.73,'LLM','image','video',null,null,null,300,5000000,null,null];
  const corrected=correctQuoteIdentity(cells);
  assert.equal(corrected[1],'Alibaba Cloud');assert.equal(corrected[5],'Video');assert.equal(corrected[4],0.73);
  assert.equal(cells[5],'LLM');
  for(const index of [0,2,3,4,6,7,8,9,10,11,12,13,14])assert.equal(corrected[index],cells[index]);
});
