import { strToU8, zipSync } from 'fflate';

import { buildRevenueCsvExport } from './report-exports.js';

const MAX_XLSX_BYTES = 5 * 1024 * 1024;
const SECTION_TITLES = new Set([
  'Executive overview', 'Period comparisons', 'Activity trend', 'Pipeline by stage',
  'Lead source performance', 'Market distribution', 'Owner performance', 'Call outcomes',
  'Meeting outcomes', 'Task outcomes', 'Action queue', 'CRM data quality'
]);

function xml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const source = String(csv).replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function columnName(index) {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function inlineCell(reference, value, style = 0) {
  return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function worksheetXml(rows) {
  const maxColumns = Math.max(1, ...rows.map((row) => row.length));
  const lastColumn = columnName(maxColumns - 1);
  const merges = [];
  const body = rows.map((row, rowIndex) => {
    const number = rowIndex + 1;
    const first = row[0] ?? '';
    const isTitle = number === 1;
    const isSection = SECTION_TITLES.has(first);
    const isMetadata = number >= 2 && number <= 11;
    const previousIsSection = SECTION_TITLES.has(rows[rowIndex - 1]?.[0]);
    if ((isTitle || isSection) && maxColumns > 1) merges.push(`A${number}:${lastColumn}${number}`);
    const cells = row.map((cell, columnIndex) => {
      let style = 0;
      if (isTitle) style = 1;
      else if (isSection) style = 2;
      else if (previousIsSection) style = 3;
      else if (isMetadata && columnIndex === 0) style = 4;
      return inlineCell(`${columnName(columnIndex)}${number}`, cell, style);
    }).join('');
    return `<row r="${number}">${cells}</row>`;
  }).join('');
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((range) => `<mergeCell ref="${range}"/>`).join('')}</mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${Math.max(1, rows.length)}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols><col min="1" max="1" width="28" customWidth="1"/>${maxColumns > 1 ? `<col min="2" max="${maxColumns}" width="18" customWidth="1"/>` : ''}</cols>
  <sheetData>${body}</sheetData>${mergeXml}
</worksheet>`;
}

function workbookFiles(sheetXml, generatedAt) {
  return {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Executive Report" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="14"/><name val="Arial"/></font><font><b/><color rgb="FF123D3A"/><sz val="10"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF123D3A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD8F3ED"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Ops Solutions Revenue Intelligence Export</dc:title><dc:creator>Ops Solutions</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${xml(generatedAt)}</dcterms:created></cp:coreProperties>`),
    'docProps/app.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Ops Solutions</Application></Properties>`)
  };
}

export function buildRevenueXlsx(csv, generatedAt = new Date().toISOString()) {
  const rows = parseCsv(csv);
  return Buffer.from(zipSync(workbookFiles(worksheetXml(rows), generatedAt), { level: 6 }));
}

export async function buildRevenueXlsxExport(postgres, workspace, query) {
  const base = await buildRevenueCsvExport(postgres, workspace, query);
  const artifact = buildRevenueXlsx(base.csv, base.report.generatedAt);
  if (artifact.byteLength > MAX_XLSX_BYTES) {
    const error = new Error('This XLSX export is too large. Narrow the reporting filters and try again.');
    error.statusCode = 413;
    error.category = 'EXPORT_TOO_LARGE';
    throw error;
  }
  return {
    artifact,
    report: base.report,
    viewName: base.viewName,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: base.fileName.replace(/\.csv$/i, '.xlsx')
  };
}
