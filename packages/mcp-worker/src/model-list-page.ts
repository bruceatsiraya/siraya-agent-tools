import { siteSidebar, siteStyles } from "./site-shell.js";
import { headers, referenceNotes, type modelListRows } from "./model-list.js";

type Row = Awaited<ReturnType<typeof modelListRows>>[number];

function html(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function modelListPage(rows: Row[], generatedAt: string, live: boolean, admin: boolean, signedIn: boolean): Response {
  const mode = admin ? "?manage=1" : "";
  const body = rows.map(({ cells, category, infron, openRouter, manual, automatic }) => {
    const benchmark = [infron, openRouter].filter(Boolean).map(metric =>
      metric ? metric.source + " · TTFT " + (metric.ttft?.toFixed(2) ?? "—") + " s · " +
      (metric.tps?.toFixed(1) ?? "—") + " tok/s · " + metric.observed_at.slice(0, 10) : "").join("\n");
    const values = cells.map((value, index) => {
      const name = ({ 4: "discount", 11: "rpm", 12: "tpm", 13: "ttft", 14: "tps" } as const)[index as 4 | 11 | 12 | 13 | 14];
      if (name && (admin || name === "discount")) {
        const metric = name === "ttft" || name === "tps";
        const inputValue = metric ? manual[name] : value;
        const placeholder = metric ? ` placeholder="${html(automatic[name] ?? "—")}"` : "";
        const sources = name === "tps" && benchmark ? `<details><summary>Sources</summary><small>${html(benchmark)}</small></details>` : "";
        return `<td><input type="number" min="0" step="${name === "rpm" || name === "tpm" ? "1" : "any"}"
          ${name === "discount" ? 'max="1"' : ""}${placeholder}
          aria-label="${name} for ${html(cells[3])}" name="${name}" value="${html(inputValue)}">${sources}</td>`;
      }
      const formatted = typeof value === "number" && name === "ttft" ? value.toFixed(2)
        : typeof value === "number" && name === "tps" ? value.toFixed(1)
        : typeof value === "number" && index >= 8 && index <= 12 ? value.toLocaleString("en-US") : value;
      if (name === "tps" && benchmark) return `<td><details><summary>${html(formatted ?? "—")}</summary><small>${html(benchmark)}</small></details></td>`;
      return `<td${index === 2 || index === 3 ? " data-no-translate" : ""}>${html(formatted ?? "—")}</td>`;
    }).join("");
    return `<tr data-id="${html(cells[3])}" data-category="${html(category)}" data-family="${html(cells[1])}">${values}<td><button type="button" data-save>Save</button></td></tr>`;
  }).join("");
  const families = [...new Set(rows.map(row => String(row.cells[1])))].sort();
  const categories = [...new Set(rows.map(row => row.category))].sort();
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
  ${siteStyles}</style></head><body class="site-app">${siteSidebar(admin ? "/model-list?manage=1" : "/model-list")}
  <main id="site-main" data-shared-discounts="${signedIn}"><h1>Model List</h1><p>${live ? "Live SIRAYA catalog checked" : "Last available SIRAYA catalog"} · ${html(generatedAt)}</p>
  <div class="toolbar"><input id="search" type="search" placeholder="Search model, ID, or family" aria-label="Search models">
  <select id="category" aria-label="Category"><option value="">All categories</option>
  ${categories.map(category => `<option>${html(category)}</option>`).join("")}</select>
  <a class="button" href="/model-list${mode}">Refresh catalog</a>
  <a class="button" id="export" href="/model-list.xlsx${mode}">Export Excel</a>
  ${admin ? '<button type="button" id="import">Import Model List v3</button><input type="file" accept=".xlsx" id="file" hidden>' : ""}
  <button type="button" class="primary" id="save-all">Save all changes</button>
  <span id="count">${rows.length} models</span></div>
  ${admin ? `<form id="family-discount" class="toolbar">
    <label>Family <select name="family" required><option value="">Select a family</option>
      ${families.map(family => `<option>${html(family)}</option>`).join("")}</select></label>
    <label>Discount factor <input name="factor" type="number" min="0" max="1" step="any" placeholder="0.88" required></label>
    <button type="submit">Apply to family</button>
  </form>` : ""}<p id="status" role="status"></p>
  <div class="table-region" role="region" aria-label="Model specifications" tabindex="0"><table><thead><tr>
  ${headers.map(name => {
    const note = name === "RPM" || name === "TPM" ? referenceNotes[1]
      : name === "TTFT (s)" || name === "TPS" ? referenceNotes[0] : "";
    return `<th scope="col"${note ? ` title="${html(note)}" aria-describedby="metric-notes"` : ""}>${html(name)}</th>`;
  }).join("")}<th scope="col">Actions</th></tr></thead>
  <tbody>${body}</tbody></table></div>
  <p id="metric-notes">${referenceNotes.map(html).join(" ")}</p>
  <p>Weekly benchmark snapshots. Infron uses the 30-day median. OpenRouter uses the median of endpoint p50s over the preceding 30 minutes. ${admin ? "Open Sources to compare weekly figures." : "Expand TPS to compare sources."}</p>
  <p>Enter 0.88 for 88% of list price. ${signedIn ? "Saved changes update the shared Model List." : 'Discount edits are saved in this browser and included in its exports. <a href="/admin">Sign in</a> to update shared values.'}</p>
  ${admin ? '<p>Family discounts apply to all models in that family. Clear a TTFT or TPS override to use the automatic value.</p>' : ""}
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
const sharedDiscounts = document.querySelector("main").dataset.sharedDiscounts === "true";
const storageKey = "siraya:model-list:discounts";
let localDiscounts = new Map();
if (!sharedDiscounts) {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    for (const row of rows) {
      const id = row.dataset.id;
      if (!Object.hasOwn(stored, id)) continue;
      const value = stored[id];
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) continue;
      localDiscounts.set(id, value);
      const input = row.querySelector('input[name="discount"]');
      input.defaultValue = value ?? "";
      input.value = input.defaultValue;
    }
  } catch {
    feedback("Local discounts could not be loaded.", true);
  }
  document.querySelector("#export").addEventListener("click", async event => {
    if (!localDiscounts.size) return;
    event.preventDefault();
    try {
      const response = await fetch(event.currentTarget.href, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ discounts: Object.fromEntries(localDiscounts) })
      });
      if (!response.ok) throw new Error("Could not export the saved discounts.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "SIRAYA Model Router - Model List.xlsx";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      feedback(error.message, true);
    }
  });
}
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
  const controls = new Set([saveAll, ...rowButtons, ...(familyDiscount?.querySelectorAll("button") ?? [])]);
  for (const control of controls) control.disabled = true;
  try {
    const payload = edits.map(({ row, fields }) => ({
      id: row.dataset.id, values: Object.fromEntries(fields.map(({ input, value }) => [input.name, value]))
    }));
    if (sharedDiscounts) {
      await submit("/admin/model-list/save", "POST", { rows: payload });
    } else {
      const next = new Map(localDiscounts);
      for (const { id, values } of payload) next.set(id, values.discount);
      localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(next)));
      localDiscounts = next;
    }
    const count = edits.length;
    for (const { fields } of edits) {
      for (const { input, text } of fields) {
        const current = input.value;
        input.defaultValue = text;
        input.value = current;
      }
    }
    feedback("Saved " + count + (count === 1 ? " model" : " models") + (sharedDiscounts ? "." : " in this browser."));
  } catch (error) {
    feedback(error.message, true);
  } finally {
    saving = false;
    for (const control of controls) control.disabled = false;
  }
}

saveAll.addEventListener("click", () => saveRows(rows));
document.querySelector("tbody").addEventListener("click", event => {
  const button = event.target.closest("[data-save]");
  if (button) saveRows([button.closest("tr")]);
});
if (familyDiscount) {
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
