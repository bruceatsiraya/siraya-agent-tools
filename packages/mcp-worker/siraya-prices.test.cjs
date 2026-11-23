const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const api={};
new Function('exports',ts.transpileModule(fs.readFileSync(__dirname+'/src/siraya-prices.ts','utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
}).outputText)(api);

test('syncs complete paginated pricing and keeps the previous snapshot on upstream failure',async()=>{
  let saved;
  const kv={put:async(_,value)=>{saved=value},get:async()=>JSON.parse(saved)};
  const pricing=[{currency:'USD',name:'Standard',conditions:[{attribute:'Input Tokens',operator:'lte',value:'100000'}],
    units:[{billingUnit:'Input Tokens',salePrice:'4.50',unitScale:'1000000',unit:'tokens'}]}];
  const fetchPage=async url=>Response.json({data:{
    total:2,items:[{code:'Model-'+new URL(url).searchParams.get('page'),pricing}]
  }});
  const prices=await api.syncOfficialPrices(kv,fetchPage);
  assert.equal(Object.keys(prices).length,2);
  assert.match(api.priceSummary(prices['model-2']),/Input Tokens lte 100000\nInput Tokens: USD 4\.50 \/ 1000000 tokens/);
  const previous=saved;
  await assert.rejects(api.syncOfficialPrices(kv,async url=>url.includes('page=1')?fetchPage(url):new Response('',{status:503})));
  assert.equal(saved,previous);
  assert.deepEqual(await api.officialPrices(kv),prices);
});
