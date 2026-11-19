import { headers, type modelListRows } from "./model-list.js";

type Row = Awaited<ReturnType<typeof modelListRows>>[number];

function html(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function modelListPage(rows: Row[], generatedAt: string, live: boolean, admin: boolean): Response {
  const mode = admin ? "?manage=1" : "";
  const body = rows.map(({ cells, infron, openRouter }) => {
    const benchmark = [infron, openRouter].filter(Boolean).map(metric =>
      metric ? metric.source + " · TTFT " + (metric.ttft?.toFixed(2) ?? "—") + " s · " +
      (metric.tps?.toFixed(1) ?? "—") + " tok/s · " + metric.observed_at.slice(0, 10) : "").join("\n");
    const values = cells.map((value, index) => {
      const name = ({ 10: "rpm", 11: "tpm", 14: "discount" } as Record<number,string>)[index];
      if (admin && name) {
        return `<td><input type="number" min="0" ${name === "discount" ? 'max="1" step="any"' : 'step="1"'}
          aria-label="${name} for ${html(cells[3])}" name="${name}" value="${html(value)}"></td>`;
      }
      const formatted = typeof value === "number" && index === 12 ? value.toFixed(2)
        : typeof value === "number" && index === 13 ? value.toFixed(1)
        : typeof value === "number" && index >= 7 && index <= 11 ? value.toLocaleString("en-US") : value;
      if (index === 13 && benchmark) return `<td><details><summary>${html(formatted ?? "—")}</summary><small>${html(benchmark)}</small></details></td>`;
      return `<td>${html(formatted ?? "—")}</td>`;
    }).join("");
    return `<tr data-id="${html(cells[3])}" data-category="${html(cells[4])}">${values}${admin ? '<td><button type="button" data-save>Save</button></td>' : ""}</tr>`;
  }).join("");
  const categories = [...new Set(rows.map(row => String(row.cells[4])))].sort();
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
  <title>Model List | SIRAYA Model Router</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f5f8fc;color:#17263c;font:14px/1.5 system-ui,sans-serif}
  a{color:#1454b2;text-decoration:none}a:hover{text-decoration:underline}header{background:#fff;border-bottom:1px solid #dbe4ef}
  nav,main{padding:18px clamp(16px,4vw,64px)}nav{display:flex;gap:24px;align-items:center;flex-wrap:wrap}
  nav strong{color:#102846}h1{font-size:clamp(30px,4vw,46px);margin:12px 0 0;letter-spacing:-.035em}
  p{margin:6px 0;color:#455b75}.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:20px 0 10px}
  input,select,button,.button{font:inherit;color:inherit;background:white;border:1px solid #b7c8df;border-radius:6px;padding:7px 10px}
  button,.button{cursor:pointer}.primary{color:white;background:#1454b2;border-color:#1454b2}.toolbar input[type=search]{width:min(300px,100%)}
  .table-region{overflow:auto;max-height:64vh;background:white;border:1px solid #dbe4ef;border-radius:9px}
  table{border-collapse:separate;border-spacing:0;width:100%;white-space:nowrap}
  th,td{text-align:left;padding:9px 11px;border-bottom:1px solid #e2eaf4}th{background:#e9f1fc;position:sticky;top:0;z-index:1}
  td:nth-child(4){font-family:ui-monospace,monospace;color:#274469}td input{width:100px;padding:4px}
  tbody tr:hover{background:#f6faff}summary{cursor:pointer}details small{white-space:pre-line;color:#455b75}
  #status{min-height:24px}#status[data-error]{color:#a32d25}
  </style></head><body><header><nav><strong>SIRAYA Model Router</strong><a href="/">Home</a><a href="/models">Model catalog</a>
  <a href="${admin ? "/admin" : "/model-list?manage=1"}">${admin ? "Administration" : "Manage list"}</a></nav></header>
  <main><h1>Model List</h1><p>${live ? "Live SIRAYA catalog checked" : "Last available SIRAYA catalog"} · ${html(generatedAt)}</p>
  <div class="toolbar"><input id="search" type="search" placeholder="Search model, ID, or family" aria-label="Search models">
  <select id="category" aria-label="Category"><option value="">All categories</option>
  ${categories.map(category => `<option>${html(category)}</option>`).join("")}</select>
  <a class="button" href="/model-list${mode}">Refresh catalog</a>
  <a class="button primary" href="/model-list.xlsx${mode}">Export Excel</a>
  ${admin ? '<button type="button" id="import">Import Model List v3</button><input type="file" accept=".xlsx" id="file" hidden>' : ""}
  <span id="count">${rows.length} models</span></div><p id="status" role="status"></p>
  <div class="table-region" role="region" aria-label="Model specifications" tabindex="0"><table><thead><tr>
  ${headers.map(name => `<th scope="col">${html(name)}</th>`).join("")}${admin ? '<th scope="col">Actions</th>' : ""}</tr></thead>
  <tbody>${body}</tbody></table></div>
  <p>Weekly benchmark snapshots. Infron uses the 30-day median. OpenRouter uses the median of endpoint p50s over the preceding 30 minutes. Expand TPS to compare sources.</p>
  ${admin ? '<p>Discount factors are visible in management mode and its Excel export. Enter 0.88 for 88% of list price. Imports preserve previously saved edits.</p>' : ""}
  </main><script src="/model-list.js" defer></script></body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
  });
}

export const modelListScript = String.raw`
const search = document.querySelector("#search");
const category = document.querySelector("#category");
const rows = [...document.querySelectorAll("tbody tr")];
const status = document.querySelector("#status");

function filter() {
  const term = search.value.trim().toLowerCase();
  let count = 0;
  for (const row of rows) {
    const names = [1, 2, 3].map(index => row.cells[index].textContent).join(" ").toLowerCase();
    row.hidden = !names.includes(term) || Boolean(category.value && category.value !== row.dataset.category);
    if (!row.hidden) count++;
  }
  document.querySelector("#count").textContent = count + " models";
}

function feedback(message, error = false) {
  status.textContent = message;
  status.toggleAttribute("data-error", error);
}

async function submit(path, method, body) {
  const response = await fetch(path, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || result.error || "Request failed.");
  return result;
}

search.addEventListener("input", filter);
category.addEventListener("change", filter);
document.querySelector("tbody").addEventListener("click", async event => {
  const button = event.target.closest("[data-save]");
  if (!button) return;
  const row = button.closest("tr");
  const fields = [...row.querySelectorAll("input")];
  if (fields.some(field => !field.reportValidity())) return;
  const values = Object.fromEntries(fields.map(field => [field.name, field.value === "" ? null : field.valueAsNumber]));
  button.disabled = true;
  try {
    await submit("/admin/model-list/" + encodeURIComponent(row.dataset.id), "PATCH", values);
    feedback("Saved " + row.dataset.id);
  } catch (error) {
    feedback(error.message, true);
  } finally {
    button.disabled = false;
  }
});
`;
