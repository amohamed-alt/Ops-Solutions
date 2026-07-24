const MAX_PDF_BYTES = 5 * 1024 * 1024;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const LINE_HEIGHT = 14;
const MAX_LINE_CHARACTERS = 92;
const SECTION_TITLES = new Set([
  'Executive overview', 'Period comparisons', 'Activity trend', 'Pipeline by stage',
  'Lead source performance', 'Market distribution', 'Owner performance', 'Call outcomes',
  'Meeting outcomes', 'Task outcomes', 'Action queue', 'CRM data quality'
]);

function ascii(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfEscape(value) {
  return ascii(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(csv).replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function wrapText(value, max = MAX_LINE_CHARACTERS) {
  const text = ascii(value);
  if (!text) return [''];
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const clipped = word.slice(0, max);
    if (!current) current = clipped;
    else if (`${current} ${clipped}`.length <= max) current += ` ${clipped}`;
    else {
      lines.push(current);
      current = clipped;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function reportLines(csv) {
  const lines = [];
  for (const [index, row] of parseCsv(csv).entries()) {
    const first = ascii(row[0]);
    if (index === 0) {
      lines.push({ text: first || 'Ops Intelligence Executive Report', style: 'title' });
      continue;
    }
    if (SECTION_TITLES.has(first)) {
      lines.push({ text: first, style: 'section' });
      continue;
    }
    if (row.every((cell) => !ascii(cell))) {
      lines.push({ text: '', style: 'space' });
      continue;
    }
    const joined = row.filter((cell) => ascii(cell)).map(ascii).join('  |  ');
    for (const wrapped of wrapText(joined)) lines.push({ text: wrapped, style: 'body' });
  }
  return lines.slice(0, 3000);
}

function paginate(lines) {
  const pages = [];
  let current = [];
  let remaining = PAGE_HEIGHT - MARGIN * 2 - 30;
  for (const line of lines) {
    const height = line.style === 'title' ? 28 : line.style === 'section' ? 24 : line.style === 'space' ? 8 : LINE_HEIGHT;
    if (remaining < height && current.length > 0) {
      pages.push(current);
      current = [];
      remaining = PAGE_HEIGHT - MARGIN * 2 - 30;
    }
    current.push(line);
    remaining -= height;
  }
  if (current.length || pages.length === 0) pages.push(current);
  return pages;
}

function pageStream(lines, pageNumber, pageCount) {
  const commands = ['q', '0.96 0.98 0.98 rg', `0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT} re f`, 'Q'];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    if (line.style === 'space') {
      y -= 8;
      continue;
    }
    const title = line.style === 'title';
    const section = line.style === 'section';
    const size = title ? 18 : section ? 12 : 9;
    if (section) commands.push('0.86 0.94 0.92 rg', `${MARGIN - 6} ${y - 5} ${PAGE_WIDTH - MARGIN * 2 + 12} 20 re f`);
    commands.push('BT', `/${title || section ? 'F2' : 'F1'} ${size} Tf`);
    commands.push(section ? '0.05 0.35 0.32 rg' : title ? '0.03 0.27 0.25 rg' : '0.12 0.22 0.22 rg');
    commands.push(`${MARGIN} ${y} Td`, `(${pdfEscape(line.text)}) Tj`, 'ET');
    y -= title ? 28 : section ? 24 : LINE_HEIGHT;
  }
  commands.push('BT', '/F1 8 Tf', '0.35 0.45 0.45 rg', `${MARGIN} 24 Td`, `(Ops Intelligence - Page ${pageNumber} of ${pageCount}) Tj`, 'ET');
  return commands.join('\n');
}

function buildPdfBuffer(pages) {
  const objects = [
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
  ];
  const pageIds = [];
  for (let index = 0; index < pages.length; index += 1) {
    const pageId = objects.length;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const stream = pageStream(pages[index], index + 1, pages.length);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'binary')} >>\nstream\n${stream}\nendstream`);
  }
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
  let output = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(output, 'binary');
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, 'binary');
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, 'binary');
}

export function buildRevenuePdf(csv) {
  const artifact = buildPdfBuffer(paginate(reportLines(csv)));
  if (artifact.byteLength > MAX_PDF_BYTES) {
    const error = new Error('The generated PDF exceeds the safe 5 MiB limit. Narrow the reporting period.');
    error.statusCode = 413;
    error.category = 'PDF_EXPORT_TOO_LARGE';
    throw error;
  }
  return artifact;
}

export async function buildRevenuePdfExport(postgres, workspace, query) {
  const { buildRevenueCsvExport } = await import('./report-exports.js');
  const source = await buildRevenueCsvExport(postgres, workspace, query);
  return {
    ...source,
    artifact: buildRevenuePdf(source.csv),
    contentType: 'application/pdf',
    fileName: source.fileName.replace(/\.csv$/i, '.pdf')
  };
}
