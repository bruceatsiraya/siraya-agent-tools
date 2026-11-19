import { headers, type Cell } from "./model-list.js";

const encoder = new TextEncoder();

function xml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

// XLSX is a ZIP package. Stored entries keep the Worker export dependency-free.
function zip(files: Record<string, string>): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  let directorySize = 0;
  for (const [path, contents] of Object.entries(files)) {
    const name = encoder.encode(path);
    const bytes = encoder.encode(contents);
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + name.length);
    const entry = new Uint8Array(46 + name.length);
    const header = new DataView(local.buffer);
    const central = new DataView(entry.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(12, 33, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, bytes.length, true);
    header.setUint32(22, bytes.length, true);
    header.setUint16(26, name.length, true);
    local.set(name, 30);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    entry.set(local.subarray(4, 28), 6);
    central.setUint32(42, offset, true);
    entry.set(name, 46);
    chunks.push(local, bytes);
    directory.push(entry);
    offset += local.length + bytes.length;
    directorySize += entry.length;
  }
  const end = new Uint8Array(22);
  const footer = new DataView(end.buffer);
  footer.setUint32(0, 0x06054b50, true);
  footer.setUint16(8, directory.length, true);
  footer.setUint16(10, directory.length, true);
  footer.setUint32(12, directorySize, true);
  footer.setUint32(16, offset, true);
  const result = new Uint8Array(offset + directorySize + end.length);
  let position = 0;
  for (const chunk of [...chunks, ...directory, end]) {
    result.set(chunk, position);
    position += chunk.length;
  }
  return result.buffer;
}

export function exportModelList(rows: Cell[][]): Response {
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
  const body = [headers, ...rows].map((row, ri) => {
    const cells = row.map((value, ci) => {
      if (value === null) return "";
      const ref = String.fromCharCode(65 + ci) + (ri + 1);
      return typeof value === "number" ? `<c r="${ref}"><v>${value}</v></c>` :
        `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join("");
  return new Response(zip({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Model List" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="2" max="3" width="23" customWidth="1"/><col min="4" max="4" width="40" customWidth="1"/><col min="5" max="15" width="19" customWidth="1"/></cols><sheetData>${body}</sheetData><autoFilter ref="A1:O${rows.length + 1}"/></worksheet>`
  }), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="SIRAYA Model Router - Model List.xlsx"',
      "cache-control": "no-store"
    }
  });
}
