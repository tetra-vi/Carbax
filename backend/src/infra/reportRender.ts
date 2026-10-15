import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import type {
  CalculationRun,
  DocumentRecord,
  EvidenceIssue,
  Facility,
  Measurement,
  Organization,
  ReadinessAssessment,
  Report,
} from '../domain/types';

export interface ReportModel {
  report: Report;
  organization: Organization;
  facility: Facility;
  calculation: CalculationRun;
  measurements: Measurement[];
  documents: DocumentRecord[];
  openIssues: EvidenceIssue[];
  readiness: ReadinessAssessment;
  reviewerName: string | null;
  generatedAt: string;
}

/** Built-in PDF fonts only cover Latin-1; non-Latin text (e.g. Tamil snippets) is marked, not mangled. */
function latin(s: string | null | undefined): string {
  if (!s) return '-';
  const cleaned = s.replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '\u0000');
  return cleaned.includes('\u0000') ? cleaned.replace(/\u0000+/g, '[non-Latin text]') : cleaned;
}

export function renderPdf(m: ReportModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `ComplyBridge evidence package ${m.report.periodKey} v${m.report.version}`, Author: 'ComplyBridge AI' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const r = m.calculation.result;
    const approved = m.report.status === 'APPROVED';
    const h = (n: number, t: string) => { doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).fillColor('#0f5132').text(`${n}. ${t}`).font('Helvetica').fontSize(10).fillColor('#000'); };
    const kv = (k: string, v: string) => doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(latin(v));

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f5132').text('Carbon Evidence Package');
    doc.font('Helvetica').fontSize(10).fillColor('#444').text('Prepared with ComplyBridge AI. Internal evidence for buyer review; not a certification.');
    doc.moveDown(0.3).fontSize(11).fillColor(approved ? '#0f5132' : '#b45309').font('Helvetica-Bold')
      .text(approved ? 'STATUS: INTERNALLY APPROVED FOR SHARING' : 'STATUS: DRAFT - NOT APPROVED');
    doc.fillColor('#000').font('Helvetica').fontSize(10);

    h(1, 'Organization');
    kv('Company', m.organization.name);
    kv('Country', m.organization.country);
    if (m.organization.registrationNumber) kv('Registration no.', m.organization.registrationNumber);
    kv('Contact', m.organization.contactEmail);

    h(2, 'Facility');
    kv('Facility', m.facility.name);
    kv('Location', `${m.facility.location}, ${m.facility.country}`);

    h(3, 'Reporting period');
    kv('Month', m.report.periodKey);

    h(4, 'Product and process scope');
    kv('Industry', m.facility.industry);
    kv('Processes', m.facility.processes.join(', ') || '-');
    kv('Products', m.facility.productCategories.join(', ') || '-');

    h(5, 'Calculation boundary');
    doc.text(m.calculation.boundary);
    doc.moveDown(0.2).text(m.calculation.allocationMethod);
    for (const c of m.calculation.coverage) doc.text(`${c.included ? '[included]' : '[not included]'} ${c.element} - ${c.note}`);

    h(6, 'Electricity consumption');
    kv('Confirmed grid electricity', `${r.electricityKWh} kWh`);
    h(7, 'Fuel consumption');
    kv('Confirmed diesel', `${r.dieselKg} kg`);
    h(8, 'Production quantity');
    kv('Confirmed output', `${r.productionT} t`);

    h(9, 'Emissions calculation summary');
    for (const l of m.calculation.result.lines) {
      doc.font('Helvetica-Bold').text(l.label).font('Helvetica').text(`Formula: ${l.formula}`);
      if (l.resultTCo2e !== null) doc.text(`Result: ${l.resultTCo2e} t CO2e`);
    }
    kv('Total (energy scope only)', `${r.totalTCo2e} t CO2e`);
    kv('Intensity', r.intensityTCo2ePerT !== null ? `${r.intensityTCo2ePerT} t CO2e per t product` : 'not available');
    if (m.calculation.incompleteReasons.length) doc.fillColor('#b45309').text(`Incomplete: ${m.calculation.incompleteReasons.join(' ')}`).fillColor('#000');

    h(10, 'Factors and methodology versions');
    kv('Factor set', `${m.calculation.factorSetId} v${m.calculation.factorSetVersion}`);
    kv('Formula version', m.calculation.formulaVersion);
    for (const a of m.calculation.assumptions) doc.text(`- ${a}`);

    h(11, 'Source document references');
    const docById = new Map(m.documents.map((d) => [d.id, d]));
    for (const meas of m.measurements) {
      const d = docById.get(meas.sourceDocumentId);
      doc.text(`${meas.type} ${meas.quantity} ${meas.unit} (${meas.reportingMonth}) <- ${latin(d?.fileName)} [${meas.sourceDocumentId}]${meas.corrected ? ' (corrected by reviewer)' : ''}`);
      if (meas.sourceSnippet) doc.fillColor('#555').text(`   "${latin(meas.sourceSnippet)}"`).fillColor('#000');
    }

    h(12, 'Completeness issues');
    if (!m.openIssues.length) doc.text('No open evidence issues.');
    for (const i of m.openIssues) doc.text(`[${i.severity}] ${latin(i.title)}`);
    for (const c of m.readiness.checks) doc.text(`${c.passed ? 'PASS' : 'OPEN'} - ${c.label}: ${latin(c.detail)}`);

    h(13, 'Data limitations');
    doc.text('Values were extracted with Google AI and confirmed by a person. The figure covers energy-related emissions only and is not a complete CBAM embedded-emissions value. Official verification by an accredited verifier has not been performed.');

    h(14, 'Reviewer comments');
    doc.text(latin(m.report.reviewerComment ?? 'No reviewer comment yet.'));

    h(15, 'Internal approval status');
    kv('Status', m.report.status);
    kv('Readiness', m.readiness.status);
    if (m.reviewerName) kv('Reviewer', m.reviewerName);
    if (m.report.reviewedAt) kv('Reviewed at', m.report.reviewedAt);

    h(16, 'Report generation date');
    doc.text(m.generatedAt);
    h(17, 'Report version');
    doc.text(`Version ${m.report.version} (report id ${m.report.id})`);
    doc.end();
  });
}

export function renderCsv(m: ReportModel): Buffer {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const docById = new Map(m.documents.map((d) => [d.id, d]));
  const rows: unknown[][] = [
    ['section', 'item', 'value', 'unit', 'reporting_month', 'source_document_id', 'source_file', 'corrected', 'note'],
    ['meta', 'organization', m.organization.name, '', '', '', '', '', ''],
    ['meta', 'facility', m.facility.name, '', '', '', '', '', ''],
    ['meta', 'period', m.report.periodKey, '', '', '', '', '', ''],
    ['meta', 'report_version', m.report.version, '', '', '', '', '', m.report.status],
    ['meta', 'factor_set', `${m.calculation.factorSetId} v${m.calculation.factorSetVersion}`, '', '', '', '', '', m.calculation.formulaVersion],
    ...m.measurements.map((x) => ['measurement', x.type, x.quantity, x.unit, x.reportingMonth, x.sourceDocumentId, docById.get(x.sourceDocumentId)?.fileName ?? '', x.corrected, x.sourceSnippet ?? '']),
    ...m.calculation.result.lines.map((l) => ['calculation', l.label, l.resultTCo2e ?? l.input, l.resultTCo2e !== null ? 't CO2e' : l.inputUnit, m.report.periodKey, l.sourceDocumentIds.join(' '), '', '', l.formula]),
    ['result', 'total', m.calculation.result.totalTCo2e, 't CO2e', m.report.periodKey, '', '', '', 'energy scope only'],
    ['result', 'intensity', m.calculation.result.intensityTCo2ePerT ?? '', 't CO2e/t', m.report.periodKey, '', '', '', ''],
  ];
  return Buffer.from('﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n'), 'utf8');
}

export async function renderXlsx(m: ReportModel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ComplyBridge AI';
  const s = wb.addWorksheet('Summary');
  s.addRows([
    ['Organization', m.organization.name],
    ['Facility', m.facility.name],
    ['Period', m.report.periodKey],
    ['Version', m.report.version],
    ['Status', m.report.status],
    ['Readiness', m.readiness.status],
    ['Total t CO2e (energy scope)', m.calculation.result.totalTCo2e],
    ['Intensity t CO2e/t', m.calculation.result.intensityTCo2ePerT ?? ''],
    ['Boundary', m.calculation.boundary],
  ]);
  s.getColumn(1).width = 30;
  s.getColumn(2).width = 80;
  const e = wb.addWorksheet('Evidence');
  e.addRow(['Type', 'Quantity', 'Unit', 'Month', 'Source document', 'Corrected', 'Snippet']);
  const docById = new Map(m.documents.map((d) => [d.id, d]));
  for (const x of m.measurements) e.addRow([x.type, x.quantity, x.unit, x.reportingMonth, docById.get(x.sourceDocumentId)?.fileName ?? x.sourceDocumentId, x.corrected ? 'yes' : 'no', x.sourceSnippet ?? '']);
  const c = wb.addWorksheet('Calculation');
  c.addRow(['Line', 'Input', 'Unit', 'Factor', 'Factor unit', 'Formula', 't CO2e']);
  for (const l of m.calculation.result.lines) c.addRow([l.label, l.input, l.inputUnit, l.factor ?? '', l.factorUnit ?? '', l.formula, l.resultTCo2e ?? '']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
