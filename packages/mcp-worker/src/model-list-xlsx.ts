import { conditionLabel, type CatalogPrice } from "./siraya-prices.js";
import { headers, referenceNotes, type Cell } from "./model-list.js";

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

export function exportModelList(rows: Cell[][], catalog:{cells:Cell[];officialPrice?:CatalogPrice}[]=[]): Response {
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
  const banner = ["SIRAYA Model Router | Model List", ...referenceNotes,
    "Discount Factor is a multiplier. For example, 0.88 means 88% of list price."];
  const priceRows:Cell[][]=[["Model ID","Scenario","Conditions","Billing item","Currency","List price","Per quantity","Unit","Synced (UTC)"]];
  for(const row of catalog){
    const price=row.officialPrice;
    if(!price?.scenarios.length){priceRows.push([row.cells[3],"—"]);continue}
    for(const scenario of price.scenarios)for(const unit of scenario.units){
      priceRows.push([row.cells[3],scenario.name,conditionLabel(scenario),unit.billingUnit,scenario.currency,Number(unit.salePrice),Number(unit.unitScale),unit.unit,price.checkedAt]);
    }
  }
  const pricingBody=priceRows.map((row,i)=>'<row>'+row.map(v=>typeof v==='number'?'<c><v>'+v+'</v></c>':'<c s="'+(i?0:3)+'" t="inlineStr"><is><t>'+xml(String(v??''))+'</t></is></c>').join('')+'</row>').join('');
  const sheetRows = [...banner.map(value => [value]), headers, ...rows];
  const body = sheetRows.map((row, ri) => {
    const cells = row.map((value, ci) => {
      const ref = String.fromCharCode(65 + ci) + (ri + 1);
      const style = ri === 0 ? 1 : ri < 4 ? 2 : ri === 4 ? 3 : 4 + (ri % 2) * 3 +
        (typeof value === "number" ? ["Discount Factor", "TTFT (s)", "TPS"].includes(headers[ci]) ? 2 : 1 : 0);
      if (value === null) return `<c r="${ref}" s="${style}"/>`;
      return typeof value === "number" ? `<c r="${ref}" s="${style}"><v>${value}</v></c>` :
        `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${ri + 1}" ht="${ri === 0 ? 34 : ri === 4 ? 25 : 20}" customHeight="1">${cells}</row>`;
  }).join("");
  const fonts = [
    '<font><sz val="11"/><name val="Calibri"/><color rgb="FF17263C"/></font>',
    '<font><b/><sz val="20"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>',
    '<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>'
  ];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
    ...["112C4B", "EAF2FB", "23547F", "F4F8FC"].map(color =>
      `<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`)];
  const xf = (font: number, fill: number, number: number) =>
    `<xf numFmtId="${number}" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf>`;
  const styles = [xf(0, 0, 0), xf(1, 2, 0), xf(0, 3, 0), xf(2, 4, 0),
    ...[0, 5].flatMap(fill => [xf(0, fill, 0), xf(0, fill, 3), xf(0, fill, 164)])];
  const widths = [7, 17, 32, 43, 18, 15, 24, 22, 18, 16, 16, 16, 18, 13, 13];
  const columns = widths.map((width, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const merges = banner.map((_, index) => `<mergeCell ref="A${index + 1}:O${index + 1}"/>`).join("");
  return new Response(zip({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Model List" sheetId="1" r:id="rId1"/><sheet name="List Prices" sheetId="2" r:id="rId3"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId3" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00##"/></numFmts><fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${styles.length}">${styles.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "xl/worksheets/sheet2.xml": `<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="4" width="35" customWidth="1"/><col min="5" max="8" width="15" customWidth="1"/><col min="9" max="9" width="28" customWidth="1"/></cols><sheetData>${pricingBody}</sheetData><autoFilter ref="A1:I${priceRows.length}"/></worksheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${ns}"><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns}</cols><sheetData>${body}</sheetData><autoFilter ref="A5:O${rows.length + 5}"/><mergeCells count="${banner.length}">${merges}</mergeCells></worksheet>`
  }), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="SIRAYA Model Router - Model List.xlsx"',
      "cache-control": "no-store"
    }
  });
}
