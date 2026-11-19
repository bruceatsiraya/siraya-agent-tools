export const modelListImportScript = String.raw`
const picker = document.querySelector("#file");
if (picker) {
  document.querySelector("#import").addEventListener("click", () => picker.click());
  picker.addEventListener("change", async () => {
    const file = picker.files[0];
    if (!file) return;
    const button = document.querySelector("#import");
    button.disabled = true;
    try {
      const values = await readWorkbook(file);
      const result = await submit("/admin/model-list/import", "POST", { rows: values });
      feedback("Imported " + result.count + " rows. Reloading…");
      location.reload();
    } catch (error) {
      feedback(error.message, true);
    } finally {
      button.disabled = false;
      picker.value = "";
    }
  });
}

async function readWorkbook(file) {
  if (file.size > 2_000_000) throw new Error("Choose an XLSX file under 2 MB.");
  const archive = await file.arrayBuffer();
  const view = new DataView(archive);
  const bytes = new Uint8Array(archive);
  const decoder = new TextDecoder();
  const u16 = offset => view.getUint16(offset, true);
  const u32 = offset => view.getUint32(offset, true);
  let end = archive.byteLength - 22;
  while (end >= 0 && archive.byteLength - end <= 65557 &&
      (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== archive.byteLength)) end--;
  if (end < 0 || archive.byteLength - end > 65557) throw new Error("Invalid XLSX archive.");
  const entries = new Map();
  const entryCount = u16(end + 10);
  if (entryCount > 1000) throw new Error("Too many XLSX entries.");
  let offset = u32(end + 16);
  for (let entry = 0; entry < entryCount; entry++) {
    if (u32(offset) !== 0x02014b50) throw new Error("Invalid XLSX directory.");
    const nameLength = u16(offset + 28);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, { method: u16(offset + 10), size: u32(offset + 20), expanded: u32(offset + 24), local: u32(offset + 42) });
    offset += 46 + nameLength + u16(offset + 30) + u16(offset + 32);
  }

  async function documentAt(path) {
    const entry = entries.get(path);
    if (!entry) return null;
    if (entry.expanded > 4_000_000 || u32(entry.local) !== 0x04034b50) throw new Error("Invalid XLSX entry.");
    const start = entry.local + 30 + u16(entry.local + 26) + u16(entry.local + 28);
    if (start + entry.size > archive.byteLength) throw new Error("Truncated XLSX entry.");
    const compressed = bytes.subarray(start, start + entry.size);
    let content = compressed;
    if (entry.method === 8) {
      const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
      content = new Uint8Array(entry.expanded);
      let written = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (written + value.length > content.length) {
          await reader.cancel();
          throw new Error("Invalid XLSX entry size.");
        }
        content.set(value, written);
        written += value.length;
      }
      if (written !== content.length) throw new Error("Truncated XLSX entry.");
    } else if (entry.method !== 0) {
      throw new Error("Unsupported XLSX compression.");
    }
    const doc = new DOMParser().parseFromString(decoder.decode(content), "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Invalid XLSX XML.");
    return doc;
  }

  const elements = (node, name) => [...(node?.getElementsByTagNameNS("*", name) ?? [])];
  const workbook = await documentAt("xl/workbook.xml");
  const relationships = await documentAt("xl/_rels/workbook.xml.rels");
  const shared = elements(await documentAt("xl/sharedStrings.xml"), "si")
    .map(item => elements(item, "t").map(text => text.textContent).join(""));
  const fields = ["no", "family", "model", "modelidapiparameter", "category", "inputmodalities",
    "outputmodality", "contextwindow", "maxinput", "maxoutput", "rpm", "tpm", "ttft", "tps", "discountfactor", "apiformat"];
  const key = value => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const number = value => {
    if (typeof value === "number" || value === null) return value;
    const cleaned = value.trim().replace(/,/g, "");
    if (["", "-", "—", "–", "n/a"].includes(cleaned.toLowerCase())) return null;
    const match = cleaned.match(/^([0-9]+(?:\.[0-9]+)?)\s*([kmb%])?$/i);
    if (!match) throw new Error("Invalid numeric cell: " + value);
    return Number(match[1]) * ({ k: 1e3, m: 1e6, b: 1e9, "%": 0.01 }[match[2]?.toLowerCase()] ?? 1);
  };
  for (const sheet of elements(workbook, "sheet")) {
    const id = sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const target = elements(relationships, "Relationship").find(rel => rel.getAttribute("Id") === id)?.getAttribute("Target");
    if (!target) continue;
    const path = new URL(target, "https://workbook.invalid/xl/workbook.xml").pathname.slice(1);
    const worksheet = await documentAt(path);
    const matrix = elements(worksheet, "row").map(row => {
      const cells = [];
      for (const cell of elements(row, "c")) {
        const column = (cell.getAttribute("r") ?? "").match(/^[A-Z]+/)?.[0];
        if (!column || column.length > 3) continue;
        const index = [...column].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
        const type = cell.getAttribute("t");
        const value = elements(cell, "v")[0]?.textContent;
        cells[index] = type === "inlineStr" ? elements(cell, "t").map(text => text.textContent).join("")
          : value === undefined ? null : type === "s" ? shared[Number(value)] : type === "n" || !type ? Number(value) : value;
      }
      return cells;
    });
    const headerIndex = matrix.findIndex(row => row.some(cell => key(cell) === "modelidapiparameter") &&
      row.some(cell => key(cell) === "rpm") && row.some(cell => key(cell) === "tpm"));
    if (headerIndex < 0) continue;
    const labels = matrix[headerIndex].map(key);
    const mapped = fields.map(field => labels.findIndex(label => label === field ||
      ((field === "ttft" || field === "tps") && label?.startsWith(field))));
    return matrix.slice(headerIndex + 1).filter(row => String(row[mapped[3]] ?? "").trim()).map(row =>
      mapped.map((index, field) => {
        const value = row[index] ?? null;
        return field >= 10 && field <= 14 ? number(value) : field === 3 ? String(value).trim() : value;
      }));
  }
  throw new Error("Could not find the Model List v3 headers.");
}
`;
