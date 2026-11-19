import { editableFields, headers, type modelListRows } from "./model-list.js";

type Row = Awaited<ReturnType<typeof modelListRows>>[number];

function html(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function modelListPage(rows: Row[], generatedAt: string, live: boolean, admin: boolean): Response {
  const mode = admin ? "?manage=1" : "";
  const body = rows.map(({ cells, infron, openRouter, manual, automatic }) => {
    const benchmark = [infron, openRouter].filter(Boolean).map(metric =>
      metric ? metric.source + " · TTFT " + (metric.ttft?.toFixed(2) ?? "—") + " s · " +
      (metric.tps?.toFixed(1) ?? "—") + " tok/s · " + metric.observed_at.slice(0, 10) : "").join("\n");
    const values = cells.map((value, index) => {
      const name = editableFields[index - 10];
      if (admin && name) {
        const metric = name === "ttft" || name === "tps";
        const inputValue = metric ? manual[name] : value;
        const placeholder = metric ? ` placeholder="${html(automatic[name] ?? "—")}"` : "";
        const sources = name === "tps" && benchmark ? `<details><summary>Sources</summary><small>${html(benchmark)}</small></details>` : "";
        return `<td><input type="number" min="0" step="${name === "rpm" || name === "tpm" ? "1" : "any"}"
          ${name === "discount" ? 'max="1"' : ""}${placeholder}
          aria-label="${name} for ${html(cells[3])}" name="${name}" value="${html(inputValue)}">${sources}</td>`;
      }
      const formatted = typeof value === "number" && index === 12 ? value.toFixed(2)
        : typeof value === "number" && index === 13 ? value.toFixed(1)
        : typeof value === "number" && index >= 7 && index <= 11 ? value.toLocaleString("en-US") : value;
      if (index === 13 && benchmark) return `<td><details><summary>${html(formatted ?? "—")}</summary><small>${html(benchmark)}</small></details></td>`;
      return `<td>${html(formatted ?? "—")}</td>`;
    }).join("");
    return `<tr data-id="${html(cells[3])}" data-category="${html(cells[4])}" data-family="${html(cells[1])}">${values}${admin ? '<td><button type="button" data-save>Save</button></td>' : ""}</tr>`;
  }).join("");
  const families = [...new Set(rows.map(row => String(row.cells[1])))].sort();
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
  <span id="count">${rows.length} models</span></div>
  ${admin ? `<form id="family-discount" class="toolbar">
    <label>Family <select name="family" required><option value="">Select a family</option>
      ${families.map(family => `<option>${html(family)}</option>`).join("")}</select></label>
    <label>Discount factor <input name="factor" type="number" min="0" max="1" step="any" placeholder="0.88" required></label>
    <button type="submit">Apply to family</button>
    <button type="button" class="primary" id="save-all">Save all changes</button>
  </form>` : ""}<p id="status" role="status"></p>
  <div class="table-region" role="region" aria-label="Model specifications" tabindex="0"><table><thead><tr>
  ${headers.map(name => `<th scope="col">${html(name)}</th>`).join("")}${admin ? '<th scope="col">Actions</th>' : ""}</tr></thead>
  <tbody>${body}</tbody></table></div>
  <p>Weekly benchmark snapshots. Infron uses the 30-day median. OpenRouter uses the median of endpoint p50s over the preceding 30 minutes. ${admin ? "Open Sources to compare weekly figures." : "Expand TPS to compare sources."}</p>
  ${admin ? '<p>Discount factors are visible in management mode and its Excel export. Enter 0.88 for 88% of list price. Family discounts apply to all models in that family. Clear a TTFT or TPS override to use the automatic value.</p>' : ""}
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
const saveAll = document.querySelector("#save-all");
const familyDiscount = document.querySelector("#family-discount");
const rowButtons = [...document.querySelectorAll("[data-save]")];
let saving = false;

async function saveRows(targetRows) {
  if (saving) return;
  const edits = [];
  for (const row of targetRows) {
    const inputs = [...row.querySelectorAll("input")].filter(input => input.validity.badInput || input.value !== input.defaultValue);
    if (inputs.some(input => !input.reportValidity())) {
      feedback("Check the values for " + row.dataset.id + ".", true);
      return;
    }
    if (inputs.length) {
      edits.push({ row, fields: inputs.map(input => ({ input, text: input.value, value: input.value === "" ? null : input.valueAsNumber })) });
    }
  }
  if (!edits.length) {
    feedback("No unsaved changes.");
    return;
  }

  saving = true;
  const controls = new Set([saveAll, ...rowButtons, ...familyDiscount.querySelectorAll("button")]);
  for (const control of controls) control.disabled = true;
  try {
    const payload = edits.map(({ row, fields }) => ({
      id: row.dataset.id, values: Object.fromEntries(fields.map(({ input, value }) => [input.name, value]))
    }));
    const { count } = await submit("/admin/model-list/save", "POST", { rows: payload });
    for (const { fields } of edits) {
      for (const { input, text } of fields) {
        const current = input.value;
        input.defaultValue = text;
        input.value = current;
      }
    }
    feedback("Saved " + count + (count === 1 ? " model." : " models."));
  } catch (error) {
    feedback(error.message, true);
  } finally {
    saving = false;
    for (const control of controls) control.disabled = false;
  }
}

if (saveAll && familyDiscount) {
  saveAll.addEventListener("click", () => saveRows(rows));
  document.querySelector("tbody").addEventListener("click", event => {
    const button = event.target.closest("[data-save]");
    if (button) saveRows([button.closest("tr")]);
  });
  familyDiscount.addEventListener("submit", event => {
    event.preventDefault();
    if (saving) return;
    const { family, factor } = familyDiscount.elements;
    const matches = rows.filter(row => row.dataset.family === family.value);
    for (const row of matches) row.querySelector('input[name="discount"]').value = factor.value;
    feedback("Filled " + matches.length + " " + family.value + " models. Use Save all changes to confirm.");
  });
}
`;
