import { priceSummary } from './siraya-prices.js';
import { salesEditor, salesEditorScript, salesEditorStyles } from './sales-editor.js';
import { siteSidebar, siteStyles } from "./site-shell.js";
import { authenticateAdmin, type AuthEnv } from './auth.js';
import { correctQuoteIdentity, headers, type Cell, type modelListRows } from './model-list.js';
type Rows = Awaited<ReturnType<typeof modelListRows>>;
interface Quote { version:number; status:string; created_by:string; template_id:number|null; id: string; customer: string; created_at: string; expires_at: string; revoked: number; note: string; rows_json: string }
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), {status, headers:{'content-type':'application/json','cache-control':'no-store'}});
export function validateQuote(input: unknown, rows: Rows) {
  const b = input as {customer?: unknown; days?: unknown; note?: unknown; items?: unknown};
  if (!b || typeof b.customer !== 'string' || !b.customer.trim() || b.customer.length > 120 || typeof b.days !== 'number' || !Number.isInteger(b.days) || b.days < 1 || b.days > 365 || typeof b.note !== 'string' || b.note.length > 2000 || !Array.isArray(b.items) || !b.items.length || b.items.length > 500) throw new Error('請填寫客戶名、1–365 天有效期及報價模型。');
  const byId = new Map(rows.map(r => [String(r.cells[3]), r.officialPrice ? [...r.cells,priceSummary(r.officialPrice)] : r.cells])); const seen = new Set<string>();
  const cells = b.items.map((item: {id?: unknown; factor?: unknown}) => {
    if (!item || typeof item.id !== 'string' || seen.has(item.id) || !byId.has(item.id) || typeof item.factor !== 'number' || !Number.isFinite(item.factor) || item.factor < 0 || item.factor > 1) throw new Error('模型或折扣無效；折扣係數須介於 0 和 1。');
    seen.add(item.id); const c = [...byId.get(item.id)!]; c[0] = seen.size; c[4] = item.factor; return c;
  });
  return {customer:b.customer.trim(), days:b.days, note:b.note.trim(), cells};
}
export async function salesRoute(request: Request, env: AuthEnv, loadRows: () => Promise<Rows>): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/quote/')) {
    if (request.method !== 'GET') return json({error:'method_not_allowed'},405);
    const id = url.pathname.split('/')[2];
    if (!/^[a-f0-9]{48}$/.test(id ?? '')) return page('報價無法使用','<p>連結無效。</p>',404);
    const q = await env.SIRAYA_METADATA.prepare('SELECT * FROM sales_quotes WHERE id = ?').bind(id).first<Quote>();
    if (!q || (q.status && q.status !== "issued") || q.revoked || q.expires_at <= new Date().toISOString()) return page('報價無法使用','<p>報價已到期、已停用或不存在，請聯絡銷售代表。</p>',404);
    const cells = (JSON.parse(q.rows_json) as Cell[][]).map(correctQuoteIdentity);
    return page(q.customer+' 專屬報價', `<div class="tag">專屬模型方案</div><h1 data-no-translate>${esc(q.customer)}</h1><p>v${q.version ?? 1} · 報價日期 ${esc(q.created_at.slice(0,10))} · 有效至 ${esc(q.expires_at.slice(0,10))} UTC</p><section><h2>為您配置的模型報價</h2><p>折扣係數 0.8 表示按標準價的 80% 計費，計費基準以雙方約定為準。</p>${table(headers,cells)}</section>${q.note ? `<section><h2>報價說明</h2><p data-no-translate style="white-space:pre-wrap">${esc(q.note)}</p></section>` : ''}<button onclick="window.print()">列印 / 另存 PDF</button><p>持有此連結即可查看報價，請妥善保管。</p>`);
  }
  const identity = await authenticateAdmin(request, env);
  if (!identity) return request.method === 'GET' && url.pathname === '/sales' ? Response.redirect(url.origin+'/admin',302) : json({error:'unauthorized'},401);
  if (request.method !== 'GET' && identity.method === 'session' && request.headers.get('origin') !== url.origin) return json({error:'invalid_origin'},403);
  const db=env.SIRAYA_METADATA;
  const product=identity.pricing_role==='product';
  const floors=async()=>Object.fromEntries((await db.prepare('SELECT * FROM sales_floors').all<{model_id:string;factor:number}>()).results.map(r=>[r.model_id,r.factor]));
  if(request.method==='POST' && ['/sales/templates','/sales/floors','/sales/retire'].includes(url.pathname)){
    if(!product) return json({error:'需要產品權限'},403);
    try{
      const body=await request.json() as {name:string;items:unknown;id:number};
      if(url.pathname==='/sales/retire') await db.prepare('UPDATE sales_templates SET retired=1 WHERE id=?').bind(body.id).run();
      else {
        const rows=await loadRows();
        const items=validateQuote({customer:'設定',days:1,note:'',items:body.items},rows).cells.map(c=>({id:String(c[3]),factor:Number(c[4])}));
        if(url.pathname==='/sales/templates'){
          const name=body.name.trim();
          if(!name || name.length>100) throw Error('請輸入模板名稱（最多 100 字）');
          await db.prepare('INSERT INTO sales_templates(name,version,items_json,author) SELECT ?,COALESCE(MAX(version),0)+1,?,? FROM sales_templates WHERE name=?').bind(name,JSON.stringify(items),identity.username,name).run();
        }else{
          const bases=new Map(rows.map(r=>[String(r.cells[3]),typeof r.cells[4]==='number'?r.cells[4]:1]));
          if(items.some(i=>i.factor>bases.get(i.id)!)) throw Error('下限不可高於平台預設');
          await db.batch(items.map(i=>db.prepare('INSERT INTO sales_floors VALUES (?,?) ON CONFLICT(model_id) DO UPDATE SET factor=excluded.factor').bind(i.id,i.factor)));
        }
      }
      return json({ok:true});
    }catch(e){return json({error:e instanceof Error?e.message:'無效設定'},400)}
  }
  const action=url.pathname.match(/^\/sales\/quotes\/([a-f0-9]{48})\/(approve|revise)$/);
  if(action){
    const q=await db.prepare('SELECT * FROM sales_quotes WHERE id=?').bind(action[1]).first<Quote>();
    if(!q || (!product && q.created_by!==identity.username)) return json({error:'找不到報價'},404);
    if(action[2]==='revise' && request.method==='GET') return json({customer:q.customer,note:q.note,days:Math.round((Date.parse(q.expires_at)-Date.parse(q.created_at))/86400000),items:(JSON.parse(q.rows_json) as Cell[][]).map(c=>({id:c[3],factor:c[4]})),templateId:q.template_id});
    if(action[2]==='approve' && product && request.method==='POST'){
      const now=new Date().toISOString();
      const result=await db.prepare("UPDATE sales_quotes SET status='issued',approved_by=?,approved_at=? WHERE id=? AND status='pending' AND revoked=0 AND expires_at>?").bind(identity.username,now,q.id,now).run();
      return result.meta.changes?json({ok:true}):json({error:'版本已變更或到期'},409);
    }
    return json({error:'需要產品權限'},403);
  }
  if (url.pathname === '/sales' && request.method === 'GET') {
    const rows = await loadRows();
    const saved = await db.prepare('SELECT * FROM sales_quotes WHERE (? OR created_by=?) ORDER BY created_at DESC LIMIT 100').bind(Number(product),identity.username).all<Quote>();
    const templates=(await db.prepare("SELECT * FROM sales_templates t WHERE retired=0 AND version=(SELECT MAX(version) FROM sales_templates WHERE name=t.name) ORDER BY name").all<{id:number;name:string;version:number;items_json:string}>()).results;
    return page('銷售報價工作台', `${salesEditor(rows, identity.username, await floors(), templates, product)}<details><summary>最近報價</summary><section><p>報價保持生成時的價格。調整配價請建立新報價。</p><div class="scroll"><table><thead><tr><th>客戶</th><th>有效至</th><th>狀態</th><th>操作</th></tr></thead><tbody>${saved.results.map(q=>`<tr><td data-no-translate>${esc(q.customer)} · v${q.version}</td><td>${esc(q.expires_at.slice(0,10))}</td><td>${q.revoked ? '已停用' : q.expires_at <= new Date().toISOString() ? '已到期' : q.status==='pending'?'待特批':'有效'}</td><td><button data-revise="${q.id}">建立修訂</button> ${q.status==='pending'?`<details><summary>審核明細</summary>${esc(q.note)}${table(headers,JSON.parse(q.rows_json))}</details>${product&&!q.revoked?`<button data-approve="${q.id}">核准此版本</button>`:''}`:''} ${!q.revoked ? `${q.status==='issued'?`<a href="/quote/${q.id}/${encodeURIComponent(q.customer)}" target="_blank" rel="noopener">查看</a>`:''} <button type="button" data-revoke="${q.id}">停用</button>` : '—'}</td></tr>`).join('')}</tbody></table></div></section></details><script>${salesEditorScript}</script>`);
  }
  if (url.pathname === '/sales/quotes' && request.method === 'POST') {
    let q,parent:Quote|null=null,templateId:number|null=null,pending=false;
    try { const text = await request.text(); if(text.length>150000) throw new Error('內容過長'); const input=JSON.parse(text), rows=await loadRows(); q=validateQuote(input,rows);
      const limits=await floors(), bases=new Map(rows.map(r=>[String(r.cells[3]),typeof r.cells[4]==='number'?r.cells[4]:1]));
      pending=q.cells.some(c=>Number(c[4])===0 || Number(c[4])<(limits[String(c[3])]??bases.get(String(c[3]))!));
      if(input.parentId){
        parent=await db.prepare('SELECT * FROM sales_quotes WHERE id=?').bind(input.parentId).first<Quote>();
        if(!parent || (!product && parent.created_by!==identity.username) || parent.customer!==q.customer) throw Error('修訂必須使用相同客戶及授權報價');
      }
      if(input.templateId!=null){
        const t=await db.prepare('SELECT id FROM sales_templates WHERE id=?').bind(input.templateId).first<{id:number}>();
        if(!t) throw Error('找不到模板版本'); templateId=t.id;
      } } catch(e) { return json({error:e instanceof Error ? e.message : '無效的報價'},400); }
    const id = Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
    const created = new Date(); const expires = new Date(created.getTime()+q.days*86400000);
    try {
      await db.prepare('INSERT INTO sales_quotes (id,customer,created_by,created_at,expires_at,note,rows_json,parent_id,version,status,template_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(id,q.customer,parent?.created_by??identity.username,created.toISOString(),expires.toISOString(),q.note,JSON.stringify(q.cells),parent?.id??null,(parent?.version??0)+1,pending?'pending':'issued',templateId).run();
    }catch(e){if(parent && String(e).includes('UNIQUE')) return json({error:'已有新版本，請從最新版本修訂'},409);throw e}
    if(pending) return json({status:'pending',id},202);
    return json({url:url.origin+'/quote/'+id+'/'+encodeURIComponent(q.customer)},201);
  }
  const match = url.pathname.match(/^\/sales\/quotes\/([a-f0-9]{48})$/);
  if (match && request.method === 'DELETE') { await env.SIRAYA_METADATA.prepare('UPDATE sales_quotes SET revoked=1 WHERE id=? AND (? OR created_by=?)').bind(match[1],Number(product),identity.username).run(); return json({ok:true}); }
  return json({error:'not_found'},404);
}
function table(names: string[], cells: Cell[][]) {
  if(cells.some(row=>row.length===names.length+1) && names.length>5){
    names=[...names,"Siraya list price"];
    cells=cells.map(row=>row.length<names.length?[...row,null]:row);
  }
  return `<div class="scroll"><table><thead><tr>${names.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${cells.map(row=>`<tr>${row.map(c=>`<td data-no-translate style="white-space:pre-line">${esc(c ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
function page(title: string, body: string, status=200) {
  const internal = title === "銷售報價工作台";
  return new Response(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} | SIRAYA</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f5fa;color:#182b45;font:16px/1.6 system-ui,sans-serif}main{max-width:1440px;margin:auto;padding:32px clamp(18px,4vw,64px)}header{background:#102943;color:white;padding:18px 4vw;font-weight:750;letter-spacing:.12em}h1{font-size:clamp(28px,4vw,44px);line-height:1.25;letter-spacing:-.03em}h2{font-size:22px;margin:0 0 8px}p{color:#52647b}section{background:white;border:1px solid #dce3ed;border-radius:14px;padding:24px;margin:24px 0}nav,.tools{display:flex;gap:16px;align-items:center;flex-wrap:wrap}nav{margin-bottom:28px}.tag{color:#146960;font-weight:700;letter-spacing:.1em}.grid{display:grid;grid-template-columns:2fr 1fr;gap:20px}.wide{grid-column:1/-1}label{display:block;font-weight:600}input,textarea,button{font:inherit;padding:10px 12px;border:1px solid #b7c5d6;border-radius:7px;color:inherit}label input,textarea{display:block;width:100%;margin-top:6px}textarea{height:90px}input[type=checkbox]{width:20px;height:20px;accent-color:#15736a}button{cursor:pointer;background:white}.primary{background:#116d63;color:white;border-color:#116d63}button:disabled{opacity:.6}a{color:#146b98}small{display:block;color:#607189}.scroll{overflow:auto;margin:20px 0}.models{max-height:480px}table{border-collapse:collapse;width:100%;white-space:nowrap}td,th{text-align:left;border-bottom:1px solid #e0e6ee;padding:12px}th{position:sticky;top:0;background:#edf2f7}td input.factor{width:115px}#link{width:100%}[hidden]{display:none!important}@media(max-width:650px){.grid{grid-template-columns:1fr}section{padding:16px}}@media print{button,nav{display:none}section{border:0;padding:0}.scroll{overflow:visible}table{white-space:normal;font-size:10px}main{padding:0}}${siteStyles}${internal ? salesEditorStyles : ''}</style></head><body class="${internal ? 'site-app' : 'customer-quote'}">${internal ? siteSidebar("/sales") : '<header>SIRAYA Model Router</header>'}<main id="site-main">${body}</main>${internal ? '' : '<script src="/site-language.js" defer></script>'}</body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
}
