const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(__dirname + '/src/sales.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
function setup(identity = null, quote = null) {
  const exports = {};
  new Function('require', 'exports', code)(name => name.includes('auth') ? {
    authenticateAdmin: async () => identity
  } : { headers: ['Model', 'Factor'], correctQuoteIdentity: cells=>cells }, exports);
  const writes = [];
  const env = { SIRAYA_METADATA: { prepare(sql) { return {
    bind(...args) { writes.push({sql,args}); return this; },
    first: async () => quote, run: async () => ({}), all: async () => ({results:sql.includes('sales_floors')?[{model_id:'model-id',factor:0.7}]:[]})
  }; } } };
  return { ...exports, env, writes };
}
const rows = [{cells:[1,'Family','Model','model-id',1],category:'LLM'}];
const body = {customer:' 客戶 ',days:30,note:'',items:[{id:'model-id',factor:0.8}]};
test('validates factors and creates an independent snapshot', () => {
  const s = setup();
  assert.equal(s.validateQuote(body, rows).cells[0][4], 0.8);
  assert.equal(rows[0].cells[4],1);
  for (const factor of [-1,2,null,'0.8',NaN]) assert.throws(()=>s.validateQuote({...body,items:[{id:'model-id',factor}]},rows));
  assert.throws(()=>s.validateQuote({...body,items:[...body.items,...body.items]},rows));
  assert.throws(()=>s.validateQuote({...body,customer:' '},rows));
});
test('anonymous visitors cannot create or revoke quotes', async () => {
  const s = setup();
  for (const method of ['POST','DELETE']) assert.equal((await s.salesRoute(new Request('https://example.com/sales/quotes',{method}),s.env,async()=>rows)).status,401);
});
test('session writes reject cross-origin requests', async () => {
  const s = setup({username:'sales',method:'session'});
  const response = await s.salesRoute(new Request('https://example.com/sales/quotes',{method:'POST',headers:{origin:'https://attacker.com'},body:JSON.stringify(body)}),s.env,async()=>rows);
  assert.equal(response.status,403); assert.equal(s.writes.length,0);
});
test('public quote renders stored values, escapes content and denies revoked quotes', async () => {
  const quote = {customer:'<script>bad()</script>',expires_at:'2999-01-01',created_at:'2026-11-19',revoked:0,rows_json:JSON.stringify([['model',0.8]]),note:'<img src=x>'};
  const s = setup(null, quote);
  const req = new Request('https://example.com/quote/'+'a'.repeat(48)+'/changed-name');
  const res = await s.salesRoute(req,s.env,async()=>{throw Error('must use snapshot');});
  assert.equal(res.status,200); const html = await res.text();
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>bad()'));
  assert.ok(html.includes('0.8')); assert.equal(res.headers.get('cache-control'),'no-store');
  quote.revoked = 1; assert.equal((await s.salesRoute(req,s.env,async()=>rows)).status,404);
  quote.revoked = 0; quote.expires_at = '2000-01-01'; assert.equal((await s.salesRoute(req,s.env,async()=>rows)).status,404);
});
test('authenticated creation persists customer and emits an unguessable URL', async () => {
  const s = setup({username:'sales',method:'session'});
  const res = await s.salesRoute(new Request('https://example.com/sales/quotes',{method:'POST',headers:{origin:'https://example.com'},body:JSON.stringify(body)}),s.env,async()=>rows);
  assert.equal(res.status,201); const {url} = await res.json();
  assert.match(url,/\/quote\/[a-f0-9]{48}\//); assert.equal(decodeURIComponent(url.split('/').pop()),'客戶');
  assert.equal(s.writes[0].args[1],'客戶'); assert.equal(JSON.parse(s.writes[0].args[6])[0][4],0.8);
});
