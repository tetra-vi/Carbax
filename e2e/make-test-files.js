// Creates marker files understood by the scripted Gemini test double in backend/test/helpers.ts.
// They only work against the local UI harness, never against real Google AI.
const fs = require('fs');
const path = require('path');
const MARK = '\n%%TEST_EXTRACTION%%';
const dir = path.join(__dirname, 'files');
fs.mkdirSync(dir, { recursive: true });
function bill(type, month, q, unit) {
  const dt = type === 'ELECTRICITY' ? 'ELECTRICITY_BILL' : type === 'FUEL' ? 'FUEL_RECEIPT' : 'PRODUCTION_RECORD';
  return { documentType: dt, supplierName: type === 'ELECTRICITY' ? 'Lanka Grid Power Co. (fictional)' : 'Demo Supplier (fictional)', invoiceNumber: `${type}-${month}`, invoiceDate: `${month}-28`, detectedLanguage: 'en', suspiciousInstructions: false,
    items: [{ measurementType: type, reportingMonth: month, quantity: q, unit, fuelType: type === 'FUEL' ? 'diesel' : null, sourceSnippet: `Total ${q} ${unit}`, page: 1, confidence: type === 'FUEL' ? 'medium' : 'high' }] };
}
const files = {
  'feb-electricity.pdf': bill('ELECTRICITY', '2026-02', 10400, 'kWh'), 'feb-diesel.pdf': bill('FUEL', '2026-02', 1000, 'L'), 'feb-production.pdf': bill('PRODUCTION', '2026-02', 52, 't'),
  'mar-diesel.pdf': bill('FUEL', '2026-03', 900, 'L'), 'mar-production.pdf': bill('PRODUCTION', '2026-03', 50, 't'), 'mar-electricity-photo.pdf': bill('ELECTRICITY', '2026-03', 10200, 'kWh'),
};
for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), Buffer.from(`%PDF-1.4\n% test ${n}${MARK}${JSON.stringify(b)}`));
