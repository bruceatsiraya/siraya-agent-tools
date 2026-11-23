// Run against the output of a Wrangler dry-run. All accounts and D1 data are ephemeral.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const {DatabaseSync} = require('node:sqlite');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const ids = ['gpt-4o', 'claude-sonnet-4'];
  const prices = Object.fromEntries(ids.map(id=>[id,{
    checkedAt:'2026-11-23T00:00:00Z',
    scenarios:[{currency:'USD',name:'Standard input',conditions:[{attribute:'Input Tokens',operator:'lte',value:'100000'}],
      units:[{billingUnit:'Input Tokens',salePrice:'5',unitScale:'1000000',unit:'tokens'}]}]
  }]));
  const worker=(await import(pathToFileURL(process.argv[2]).href)).default;
  const sqlite=new DatabaseSync(':memory:');
  const db={
    prepare(sql){
      const statement=sqlite.prepare(sql);let args=[];
      return {bind(...values){args=values;return this},run(){return {meta:statement.run(...args)}},
        all(){return {results:statement.all(...args)}},first(){return statement.get(...args)}};
    },
    batch(statements){return statements.map(s=>s.run())}
  };
  let origin;
  const server=http.createServer(async(req,res)=>{
    try {
      if(req.url==='/fixture/models'){res.end(JSON.stringify({data:ids.map(id=>({id,object:'model'}))}));return}
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const request=new Request(origin+req.url,{method:req.method,headers:req.headers,body:chunks.length?Buffer.concat(chunks):undefined});
      const response=await worker.fetch(request,{SIRAYA_METADATA:db,SIRAYA_API_KEY:'fixture',SIRAYA_BASE_URL:origin+'/fixture',
        SIRAYA_REGISTRY:{get:async()=>prices}});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch(e){console.error(e);res.writeHead(500);res.end()}
  });
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    origin='http://127.0.0.1:'+server.address().port;
    const dir = path.join(__dirname,'../packages/mcp-worker/migrations');
    for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()) {
      sqlite.exec(fs.readFileSync(path.join(dir,file),'utf8'));
    }
    const password=crypto.randomUUID(), salt=crypto.randomUUID();
    for(const role of ['sales','product']) {
      await db.prepare("INSERT INTO admin_users(username,password_hash,password_salt,pricing_role,created_at,updated_at) VALUES(?,?,?,?,datetime('now'),datetime('now'))")
        .bind(role,crypto.pbkdf2Sync(password,salt,100000,32,'sha256').toString('base64url'),salt,role).run();
    }
    browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});
    const errors=[];
    async function page(role) {
      const p=await (await browser.newContext()).newPage();
      p.setDefaultTimeout(10000);
      p.on('pageerror',e=>errors.push(e.message));
      p.on('dialog',d=>d.accept(d.type()==='prompt'?'E2E partner':undefined));
      if(role){
        await p.goto(origin+'/admin');
        await p.locator('[name=username]').fill(role);
        await p.locator('[name=password]').fill(password);
        await p.locator('#login-form button').click();
        await p.locator('a.primary[href="/sales"]').click();
        await p.locator('#models tr').first().waitFor();
      }
      return p;
    }
    const product=await page('product');
    const row=(p,id)=>p.locator('#models tr').filter({has:p.locator('small',{hasText:id})});
    async function price(p,id,value){
      const input=row(p,id).locator('.factor');
      await input.fill(value);await input.press('Tab');
    }
    for(const id of ids) await row(product,id).locator('.pick').check();
    await price(product,ids[0],'0.72');
    await price(product,ids[1],'0.68');
    const controls=p=>p.getByText('多 vendor 配價與價格模板',{exact:true});
    await controls(product).click();
    await Promise.all([product.waitForEvent('load'),product.locator('#save-template').click()]);
    const sales=await page('sales'), customer=await page();
    await sales.locator('[data-site-lang=en]').click();
    await sales.reload();
    await sales.getByRole('heading',{name:'Price calculator'}).waitFor();
    await sales.getByText('Multi-vendor pricing and templates',{exact:true}).waitFor();
    await sales.locator('[data-site-lang=zh]').click();
    assert.equal(await sales.locator('#save-template').count(),0);
    await controls(sales).click();
    const vendors=sales.locator('.batch-vendor');
    assert.equal(await vendors.count(),2);
    for(const box of await vendors.all())await box.check();
    await sales.locator('#adjust-mode').selectOption('delta');
    await sales.locator('#adjust-value').fill('-0.10');
    await sales.locator('#multi-apply').click();
    for(const id of ids) assert.equal(await row(sales,id).locator('.factor').inputValue(),'0.9');
    await sales.getByText('單一供應商及篩選配價',{exact:true}).click();
    await sales.locator('#overwrite').check();
    await sales.locator('#template').selectOption({label:'E2E partner · v1'});
    await sales.locator('#use-template').click();
    assert.equal(await row(sales,ids[0]).locator('.factor').inputValue(),'0.72');
    assert.equal(await row(sales,ids[1]).locator('.factor').inputValue(),'0.68');
    await sales.locator('#estimate-tiers').fill('1000:1, *:0.9');
    await sales.locator('#estimate-slider').focus();
    await sales.locator('#estimate-slider').press('End');
    assert.equal(await sales.locator('#estimate-amount').inputValue(),'20000');
    assert.equal(await sales.locator('#estimate-factor').textContent(),'63.5%');
    await sales.locator('#estimate-scope').selectOption('model');
    await sales.locator('#estimate-target').selectOption(ids[0]);
    assert.match(await sales.locator('#estimate-scenario').innerText(),/Input Tokens lte 100000/);
    await sales.locator('#estimate-slider').press('End');
    assert.equal(await sales.locator('#estimate-quantity').inputValue(),'1000000');
    assert.equal(await sales.locator('#estimate-factor').textContent(),'72.0%');
    assert.match(await sales.locator('#estimate-pay').textContent(),/3\.60/);
    await sales.locator('#customer').fill('E2E Customer');
    const submission=sales.waitForResponse(r=>r.url()===origin+'/sales/quotes'&&r.request().method()==='POST');
    await sales.locator('#create').click();
    const pending=await submission;
    assert.equal(pending.status(),202);
    const {id}=await pending.json(), oldUrl=origin+'/quote/'+id;
    assert.equal((await customer.goto(oldUrl)).status(),404);
    await product.reload();
    await product.getByText('最近報價',{exact:true}).click();
    await product.getByText('審核明細',{exact:true}).click();
    assert.match(await product.locator('details details table').innerText(),/0\.68/);
    await Promise.all([product.waitForEvent('load'),product.locator('[data-approve]').click()]);
    assert.equal((await customer.goto(oldUrl)).status(),200);
    assert.match(await customer.locator('main').innerText(),/v1/);
    assert.match(await customer.locator('table').innerText(),/0\.68/);
    assert.match(await customer.locator('table').innerText(),/USD 5 \/ 1000000 tokens/);
    prices[ids[0]].scenarios[0].units[0].salePrice='10';
    await customer.reload();
    assert.match(await customer.locator('table').innerText(),/USD 5 \/ 1000000 tokens/);
    assert.doesNotMatch(await customer.locator('table').innerText(),/USD 10 \/ 1000000 tokens/);
    await sales.reload();
    await sales.getByText('最近報價',{exact:true}).click();
    await sales.locator('[data-revise]').click();
    await sales.getByText('已載入修訂草稿',{exact:true}).waitFor();
    for(const model of ids)await price(sales,model,'1');
    await sales.locator('#create').click();
    await sales.locator('#open').waitFor();
    const revised=await sales.locator('#open').getAttribute('href');
    assert.equal((await customer.goto(revised)).status(),200);
    assert.match(await customer.locator('main').innerText(),/v2/);
    assert.deepEqual(await customer.locator('tbody tr td:nth-child(5)').allTextContents(),['1','1']);
    await customer.goto(oldUrl);
    assert.match(await customer.locator('table').innerText(),/0\.68/);
    assert.deepEqual(errors,[]);
    console.log('PASS: role login, two-vendor delta, template, approval, public access, revision, immutable original');
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));sqlite.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
