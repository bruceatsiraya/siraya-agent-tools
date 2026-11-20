const fs=require('node:fs');
const ts=require('typescript');
const path=require('node:path');
const cache={};
function load(file){
  file=path.resolve(file);if(cache[file])return cache[file];const out={};cache[file]=out;
  new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(name=>name==='@siraya/agent'?load('packages/sdk/src/index.ts'):load(path.resolve(path.dirname(file),name.replace(/\.js$/,'.ts'))),out);return out;
}
const sdk=load('packages/sdk/src/index.ts');
const correction=load('packages/mcp-worker/src/model-corrections.ts');
const listing=load('packages/mcp-worker/src/model-list.ts');
const fixtures=require('../docs/model-identity-audit.json');
async function publicList(){
  const html=await(await fetch('https://siraya-mcp.bruceatsiraya.xyz/model-list')).text();
  return [...html.matchAll(/<tr\s+data-id="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)].map(match=>{const cells=[...match[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m=>m[1].replace(/<[^>]+>/g,'').trim());return{id:match[1],vendor:cells[1],category:cells[5]}});
}
async function main(){
  if(process.argv.includes('--capture-list')){console.log(JSON.stringify(await publicList()));return}
  const remote=process.argv.includes('--remote');
  const registry=remote?await(await fetch('https://siraya-mcp.bruceatsiraya.xyz/registry',{headers:{'cache-control':'no-cache'}})).json():{models:fixtures.models.map(m=>({...sdk.inferCapabilities({id:m.id}),providerName:m.previousVendor,category:m.previousCategory}))};
  const actual=remote?registry:correction.correctModelIdentities(registry);
  const expected=new Map(fixtures.models.map(m=>[m.id,m]));const failures=[];
  for(const m of actual.models){const want=expected.get(m.id);if(!want){failures.push('Unaudited model: '+m.id);continue}if(m.providerName!==want.vendor||m.category!==want.category)failures.push(m.id+': '+m.providerName+'/'+m.category+' expected '+want.vendor+'/'+want.category)}
  for(const m of fixtures.models)if(!actual.models.some(row=>row.id===m.id))failures.push('Missing model: '+m.id);
  const rows=await listing.modelListRows({prepare(){return{all:async()=>({results:[]})}}},actual);
  for(const row of rows){const want=expected.get(String(row.cells[3]));if(!want||row.cells[1]!==want.vendor||row.category!==(want.category==='text'?'LLM':want.category[0].toUpperCase()+want.category.slice(1)))failures.push('Model list mismatch: '+row.cells[3])}
  if(remote){
    const html=await(await fetch('https://siraya-mcp.bruceatsiraya.xyz/model-list')).text();
    for(const row of rows){const id=String(row.cells[3]);const match=[...html.matchAll(/<tr\s+data-id="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)].find(m=>m[1]===id);if(!match){failures.push('Missing live list row: '+id);continue}const cells=[...match[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m=>m[1].replace(/<[^>]+>/g,'').trim());if(cells[1]!==row.cells[1]||cells[5]!==row.category)failures.push('Live list mismatch: '+id+' '+cells[1]+'/'+cells[5])}
  }
  if(failures.length){console.error(failures.join('\n'));process.exitCode=1;return}
  console.log(JSON.stringify({models:actual.models.length,listAndQuoteModels:rows.length,categories:actual.models.reduce((a,m)=>(a[m.category]=(a[m.category]||0)+1,a),{}),unverifiedVendor:actual.models.filter(m=>m.provider==='unknown').map(m=>m.id),result:'PASS'},null,2));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={load};
