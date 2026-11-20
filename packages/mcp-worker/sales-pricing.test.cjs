const {test}=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript');
const fs=require('node:fs');
const mod={};new Function('exports',ts.transpileModule(fs.readFileSync(__dirname+'/src/sales-pricing.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(mod);
const {applyVendor,effectiveFactor,restoreDraft}=mod;
const models=[{id:'a',vendor:'A',base:1},{id:'b',vendor:'A',base:0.9},{id:'c',vendor:'B',base:0.95}];
const empty=()=>({customer:'Customer',days:30,note:'Terms',vendors:{},models:{}});
test('vendor pricing survives switching vendors and model overrides win',()=>{
  let draft=applyVendor(empty(),models,'A',0.88);draft.models.a.override=0.75;
  draft=applyVendor(draft,models,'B',0.8);draft=applyVendor(draft,models,'A',0.85);
  assert.equal(effectiveFactor(models[0],draft),0.75);assert.equal(effectiveFactor(models[1],draft),0.85);assert.equal(effectiveFactor(models[2],draft),0.8);
  assert.ok(draft.models.a.selected);assert.ok(draft.models.c.selected);
});
test('vendor overwrite is explicit, zero is valid, and changes are immutable',()=>{
  const first=empty();first.models.a={selected:false,override:0.5};
  const next=applyVendor(first,models,'A',0,true,false);
  assert.equal(effectiveFactor(models[0],next),0);assert.equal(next.models.a.selected,false);
  assert.equal(first.models.a.override,0.5);assert.equal(first.vendors.A,undefined);
  assert.throws(()=>applyVendor(first,models,'A',1.5));assert.throws(()=>applyVendor(first,models,'unknown',0.8));
});
test('saved draft restores vendor rules, custom factors and selections without stale IDs',()=>{
  const first=applyVendor(empty(),models,'A',0.88);first.models.a.override=0.7;first.models.deleted={selected:true,override:0.1};
  const restored=restoreDraft(JSON.parse(JSON.stringify(first)),models);
  assert.equal(effectiveFactor(models[0],restored),0.7);assert.equal(effectiveFactor(models[1],restored),0.88);assert.equal(restored.models.deleted,undefined);
  first.models.a.override=8;assert.throws(()=>restoreDraft(first,models));
});
test('browser scripts parse and embedded model data cannot break out of JSON',()=>{
  const editor={};new Function('require','exports',ts.transpileModule(fs.readFileSync(__dirname+'/src/sales-editor.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(()=>mod,editor);
  new Function(editor.salesEditorScript);
  const id='test</script><script>alert(1)</script>';
  const html=editor.salesEditor([{cells:[1,'Vendor','Example',id,0.9,'LLM']}],'tester');
  const json=html.match(/<script id="pricing-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(json)[0].id,id);assert.ok(!json.includes('</script>'));
  const language={};new Function('exports',ts.transpileModule(fs.readFileSync(__dirname+'/src/site-language.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(language);
  new Function(language.siteLanguageScript);
});
test('vendor label corrections preserve previously inherited draft discounts',()=>{
  const current=[{id:'wan2.7-r2v',vendor:'Alibaba Cloud',base:1},{id:'happyhorse-1.1-i2v',vendor:'Alibaba Cloud',base:1},{id:'qwen3.5-plus',vendor:'Alibaba Cloud',base:1}];
  const previous={...empty(),vendors:{Wan:0.7,HappyHorse:0.8,Qwen:0.9,'Alibaba Cloud':0.95},models:{'wan2.7-r2v':{selected:true,override:null},'happyhorse-1.1-i2v':{selected:true,override:0.65},'qwen3.5-plus':{selected:true,override:null}}};
  const restored=restoreDraft(previous,current);
  assert.deepEqual(current.map(m=>effectiveFactor(m,restored)),[0.7,0.65,0.9]);
});
test('multi-vendor delta starts at each effective price and protects individual overrides',()=>{
  const draft=applyVendor(empty(),models,'A',0.8);
  draft.models.a.override=0.6;
  const vendors=new Set(['A','B']);
  assert.deepEqual(mod.vendorChanges(draft,models,vendors,-0.1,true,false),[{id:'b',factor:0.7},{id:'c',factor:0.85}]);
  assert.equal(mod.vendorChanges(draft,models,vendors,0.2,true,true).some(c=>!mod.validFactor(c.factor)),true);
  assert.equal(mod.vendorChanges(draft,models,vendors,0.9,false,true).length,3);
});
