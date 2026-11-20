const {test} = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const fs = require('node:fs');
const ts = require('typescript');

test('migrated database enforces quote approval, immutable revisions and template versions', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const migrate = name => sqlite.exec(fs.readFileSync(__dirname+'/migrations/'+name,'utf8'));
  migrate('0002_admin_accounts.sql');
  migrate('0004_sales_quotes.sql');
  sqlite.prepare("INSERT INTO sales_quotes VALUES (?,'Legacy','rep','2026','2999',0,'','[]')").run('a'.repeat(48));
  migrate('0005_sales_pricing.sql');
  const db = {
    prepare(sql) {
      const stmt=sqlite.prepare(sql); let args=[];
      return {
        bind(...values){args=values;return this},
        first(){return stmt.get(...args)},
        all(){return {results:stmt.all(...args)}},
        run(){return {meta:stmt.run(...args)}}
      };
    },
    batch(stmts){return stmts.map(s=>s.run())}
  };
  let role='sales';
  const sales={};
  const code=ts.transpileModule(fs.readFileSync(__dirname+'/src/sales.ts','utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
  }).outputText;
  new Function('require','exports',code)(name=>name.includes('auth')?
    {authenticateAdmin:async()=>({method:'session',username:role==='product'?'pm':'rep',pricing_role:role})}:
    {headers:[],correctQuoteIdentity:c=>c},sales);
  const call=(path,body)=>sales.salesRoute(new Request('https://example.com'+path, body?
    {method:'POST',headers:{origin:'https://example.com'},body:JSON.stringify(body)}:{}),
    {SIRAYA_METADATA:db},async()=>[{cells:[1,'Vendor','Model','model',0.8]}]);
  const items=[{id:'model',factor:0.7}];
  const quote={customer:'C',days:30,note:'',items};
  assert.equal((await call('/quote/'+'a'.repeat(48))).status,200);
  assert.equal((await call('/sales/floors',{items})).status,403);
  assert.equal((await call('/sales/templates',{name:'Partner',items})).status,403);
  role='product';
  assert.equal((await call('/sales/floors',{items})).status,200);
  for(const factor of [0.70,0.69]){
    assert.equal((await call('/sales/templates',{name:'Partner',items:[{id:'model',factor}]})).status,200);
  }
  assert.equal(sqlite.prepare('SELECT MAX(version) AS v FROM sales_templates').get().v,2);
  role='sales';
  const issued=await call('/sales/quotes',{...quote,templateId:1});
  assert.equal(issued.status,201);
  const parentId=new URL((await issued.json()).url).pathname.split('/')[2];
  const revision={...quote,parentId,items:[{id:'model',factor:0.65}]};
  const pending=await call('/sales/quotes',revision);
  assert.equal(pending.status,202);
  const {id}=await pending.json();
  assert.equal((await call('/sales/quotes',revision)).status,409);
  assert.equal((await call('/quote/'+id)).status,404);
  assert.equal((await call('/sales/quotes/'+id+'/approve',{})).status,403);
  role='product';
  assert.equal((await call('/sales/quotes/'+id+'/approve',{})).status,200);
  const publicPage=await call('/quote/'+id);
  assert.match(await publicPage.text(),/0\.65/);
  assert.match(await (await call('/quote/'+parentId)).text(),/0\.7/);
  const snapshot=sqlite.prepare('SELECT * FROM sales_quotes WHERE id=?').get(id);
  assert.equal(snapshot.version,2);assert.equal(snapshot.approved_by,'pm');
  assert.equal((await call('/sales/quotes/'+id+'/approve',{})).status,409);
  sqlite.close();
});
