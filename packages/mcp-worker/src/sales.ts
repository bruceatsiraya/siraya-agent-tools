import { salesEditor, salesEditorScript, salesEditorStyles } from './sales-editor.js';
import { siteSidebar, siteStyles } from "./site-shell.js";
import { authenticateAdmin, type AuthEnv } from './auth.js';
import { headers, type Cell, type modelListRows } from './model-list.js';
type Rows = Awaited<ReturnType<typeof modelListRows>>;
interface Quote { id: string; customer: string; created_at: string; expires_at: string; revoked: number; note: string; rows_json: string }
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), {status, headers:{'content-type':'application/json','cache-control':'no-store'}});
export function validateQuote(input: unknown, rows: Rows) {
  const b = input as {customer?: unknown; days?: unknown; note?: unknown; items?: unknown};
  if (!b || typeof b.customer !== 'string' || !b.customer.trim() || b.customer.length > 120 || typeof b.days !== 'number' || !Number.isInteger(b.days) || b.days < 1 || b.days > 365 || typeof b.note !== 'string' || b.note.length > 2000 || !Array.isArray(b.items) || !b.items.length || b.items.length > 500) throw new Error('請填寫客戶名、1–365 天有效期及報價模型。');
  const byId = new Map(rows.map(r => [String(r.cells[3]), r.cells])); const seen = new Set<string>();
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
    if (!q || q.revoked || q.expires_at <= new Date().toISOString()) return page('報價無法使用','<p>報價已到期、已停用或不存在，請聯絡銷售代表。</p>',404);
    const cells = JSON.parse(q.rows_json) as Cell[][];
    return page(q.customer+' 專屬報價', `<div class="tag">專屬模型方案</div><h1 data-no-translate>${esc(q.customer)}</h1><p>報價日期 ${esc(q.created_at.slice(0,10))} · 有效至 ${esc(q.expires_at.slice(0,10))} UTC</p><section><h2>為您配置的模型報價</h2><p>折扣係數 0.8 表示按標準價的 80% 計費，計費基準以雙方約定為準。</p>${table(headers,cells)}</section>${q.note ? `<section><h2>報價說明</h2><p data-no-translate style="white-space:pre-wrap">${esc(q.note)}</p></section>` : ''}<button onclick="window.print()">列印 / 另存 PDF</button><p>持有此連結即可查看報價，請妥善保管。</p>`);
  }
  const identity = await authenticateAdmin(request, env);
  if (!identity) return request.method === 'GET' && url.pathname === '/sales' ? Response.redirect(url.origin+'/admin',302) : json({error:'unauthorized'},401);
  if (request.method !== 'GET' && identity.method === 'session' && request.headers.get('origin') !== url.origin) return json({error:'invalid_origin'},403);
  if (url.pathname === '/sales' && request.method === 'GET') {
    const rows = await loadRows();
    const saved = await env.SIRAYA_METADATA.prepare('SELECT id,customer,created_at,expires_at,revoked FROM sales_quotes ORDER BY created_at DESC LIMIT 100').all<Quote>();
    return page('銷售報價工作台', `${salesEditor(rows, identity.username)}<details><summary>最近報價</summary><section><p>報價保持生成時的價格。調整配價請建立新報價。</p><div class="scroll"><table><thead><tr><th>客戶</th><th>有效至</th><th>狀態</th><th>操作</th></tr></thead><tbody>${saved.results.map(q=>`<tr><td data-no-translate>${esc(q.customer)}</td><td>${esc(q.expires_at.slice(0,10))}</td><td>${q.revoked ? '已停用' : q.expires_at <= new Date().toISOString() ? '已到期' : '有效'}</td><td>${!q.revoked ? `<a href="/quote/${q.id}/${encodeURIComponent(q.customer)}" target="_blank" rel="noopener">查看</a> <button type="button" data-revoke="${q.id}">停用</button>` : '—'}</td></tr>`).join('')}</tbody></table></div></section></details><script>${salesEditorScript}</script>`);
  }
  if (url.pathname === '/sales/quotes' && request.method === 'POST') {
    let q;
    try { const text = await request.text(); if(text.length>150000) throw new Error('內容過長'); q = validateQuote(JSON.parse(text),await loadRows()); } catch(e) { return json({error:e instanceof Error ? e.message : '無效的報價'},400); }
    const id = Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
    const created = new Date(); const expires = new Date(created.getTime()+q.days*86400000);
    await env.SIRAYA_METADATA.prepare('INSERT INTO sales_quotes (id,customer,created_by,created_at,expires_at,note,rows_json) VALUES (?,?,?,?,?,?,?)').bind(id,q.customer,identity.username,created.toISOString(),expires.toISOString(),q.note,JSON.stringify(q.cells)).run();
    return json({url:url.origin+'/quote/'+id+'/'+encodeURIComponent(q.customer)},201);
  }
  const match = url.pathname.match(/^\/sales\/quotes\/([a-f0-9]{48})$/);
  if (match && request.method === 'DELETE') { await env.SIRAYA_METADATA.prepare('UPDATE sales_quotes SET revoked=1 WHERE id=?').bind(match[1]).run(); return json({ok:true}); }
  return json({error:'not_found'},404);
}
function table(names: string[], cells: Cell[][]) {return `<div class="scroll"><table><thead><tr>${names.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${cells.map(row=>`<tr>${row.map(c=>`<td data-no-translate>${esc(c ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
function page(title: string, body: string, status=200) {
  const internal = title === "銷售報價工作台";
  return new Response(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} | SIRAYA</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f5fa;color:#182b45;font:16px/1.6 system-ui,sans-serif}main{max-width:1440px;margin:auto;padding:32px clamp(18px,4vw,64px)}header{background:#102943;color:white;padding:18px 4vw;font-weight:750;letter-spacing:.12em}h1{font-size:clamp(28px,4vw,44px);line-height:1.25;letter-spacing:-.03em}h2{font-size:22px;margin:0 0 8px}p{color:#52647b}section{background:white;border:1px solid #dce3ed;border-radius:14px;padding:24px;margin:24px 0}nav,.tools{display:flex;gap:16px;align-items:center;flex-wrap:wrap}nav{margin-bottom:28px}.tag{color:#146960;font-weight:700;letter-spacing:.1em}.grid{display:grid;grid-template-columns:2fr 1fr;gap:20px}.wide{grid-column:1/-1}label{display:block;font-weight:600}input,textarea,button{font:inherit;padding:10px 12px;border:1px solid #b7c5d6;border-radius:7px;color:inherit}label input,textarea{display:block;width:100%;margin-top:6px}textarea{height:90px}input[type=checkbox]{width:20px;height:20px;accent-color:#15736a}button{cursor:pointer;background:white}.primary{background:#116d63;color:white;border-color:#116d63}button:disabled{opacity:.6}a{color:#146b98}small{display:block;color:#607189}.scroll{overflow:auto;margin:20px 0}.models{max-height:480px}table{border-collapse:collapse;width:100%;white-space:nowrap}td,th{text-align:left;border-bottom:1px solid #e0e6ee;padding:12px}th{position:sticky;top:0;background:#edf2f7}td input.factor{width:115px}#link{width:100%}[hidden]{display:none!important}@media(max-width:650px){.grid{grid-template-columns:1fr}section{padding:16px}}@media print{button,nav{display:none}section{border:0;padding:0}.scroll{overflow:visible}table{white-space:normal;font-size:10px}main{padding:0}}${siteStyles}${internal ? salesEditorStyles : ''}</style></head><body class="${internal ? 'site-app' : 'customer-quote'}">${internal ? siteSidebar("/sales") : '<header>SIRAYA Model Router</header>'}<main id="site-main">${body}</main>${internal ? '' : '<script src="/site-language.js" defer></script>'}</body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
}
