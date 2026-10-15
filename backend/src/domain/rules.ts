import { normaliseUnit } from './units';
import type {
  DocumentRecord,
  EvidenceIssue,
  Extraction,
  IssueType,
  Measurement,
  MeasurementType,
  ReportingPeriod,
  Severity,
} from './types';

// Deterministic evidence validation rules. These decide WHAT is wrong; Gemini only explains it.

export interface IssueDraft {
  key: string;
  type: IssueType;
  severity: Severity;
  category: MeasurementType | null;
  title: string;
  details: Record<string, unknown>;
  evidenceRefs: string[];
}

export interface RuleInput {
  period: ReportingPeriod;
  documents: DocumentRecord[];
  extractions: Extraction[];
  measurements: Measurement[]; // all measurements filed in this period (any state)
  currentIntensity: number | null;
  previousIntensity: number | null;
  previousPeriodKey: string | null;
  intensityChangeThresholdPct: number;
}

const CATEGORY_DOC_LABEL: Record<MeasurementType, string> = {
  ELECTRICITY: 'electricity bill',
  FUEL: 'fuel (diesel) receipt',
  PRODUCTION: 'production record',
};

export function monthName(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[m - 1]} ${y}`;
}

export function evaluateRules(input: RuleInput): IssueDraft[] {
  const { period } = input;
  const issues: IssueDraft[] = [];
  const confirmed = input.measurements.filter((m) => m.reviewState === 'CONFIRMED');
  const inMonth = confirmed.filter((m) => m.reportingMonth === period.key);
  const k = (...parts: string[]) => [period.id, ...parts].join('|');

  // 1. Missing required evidence categories for the reporting month.
  for (const cat of period.requiredCategories) {
    if (!inMonth.some((m) => m.type === cat)) {
      const pending = input.documents.filter(
        (d) => d.status === 'NEEDS_REVIEW' || d.status === 'QUEUED' || d.status === 'PROCESSING',
      );
      issues.push({
        key: k(cat === 'PRODUCTION' ? 'MISSING_PRODUCTION' : 'MISSING_CATEGORY', cat),
        type: cat === 'PRODUCTION' ? 'MISSING_PRODUCTION' : 'MISSING_CATEGORY',
        severity: 'HIGH',
        category: cat,
        title: `No confirmed ${CATEGORY_DOC_LABEL[cat]} for ${monthName(period.key)}.`,
        details: { reportingMonth: period.key, documentsAwaitingReview: pending.map((d) => d.id) },
        evidenceRefs: pending.map((d) => d.id),
      });
    }
  }

  // 2. Extractions awaiting human confirmation.
  for (const d of input.documents.filter((x) => x.status === 'NEEDS_REVIEW')) {
    issues.push({
      key: k('UNCONFIRMED_EXTRACTION', d.id),
      type: 'UNCONFIRMED_EXTRACTION',
      severity: 'MEDIUM',
      category: null,
      title: `Extracted values from "${d.fileName}" have not been confirmed by a person.`,
      details: { documentId: d.id },
      evidenceRefs: [d.id],
    });
  }

  // 3. Duplicate evidence: same invoice number from the same supplier on different documents.
  const confirmedExtractions = input.extractions.filter((e) => e.status === 'CONFIRMED' && e.invoiceNumber);
  const byInvoice = new Map<string, Extraction[]>();
  for (const e of confirmedExtractions) {
    const key = `${(e.supplierName ?? '').toLowerCase().trim()}#${e.invoiceNumber!.toLowerCase().trim()}`;
    byInvoice.set(key, [...(byInvoice.get(key) ?? []), e]);
  }
  for (const [invKey, group] of byInvoice) {
    const docIds = [...new Set(group.map((g) => g.documentId))];
    if (docIds.length > 1) {
      issues.push({
        key: k('DUPLICATE_DOCUMENT', invKey),
        type: 'DUPLICATE_DOCUMENT',
        severity: 'MEDIUM',
        category: null,
        title: `Invoice ${group[0].invoiceNumber} appears on ${docIds.length} different documents; it may be counted twice.`,
        details: { invoiceNumber: group[0].invoiceNumber, supplierName: group[0].supplierName },
        evidenceRefs: docIds,
      });
    }
  }
  // Same type, month, quantity and unit on different documents.
  const sig = new Map<string, Measurement[]>();
  for (const m of confirmed) {
    const s = `${m.type}#${m.reportingMonth}#${m.quantity}#${normaliseUnit(m.unit)}`;
    sig.set(s, [...(sig.get(s) ?? []), m]);
  }
  for (const [s, group] of sig) {
    const docIds = [...new Set(group.map((g) => g.sourceDocumentId))];
    if (docIds.length > 1) {
      issues.push({
        key: k('DUPLICATE_DOCUMENT', 'values', s),
        type: 'DUPLICATE_DOCUMENT',
        severity: 'MEDIUM',
        category: group[0].type,
        title: `Identical ${group[0].type.toLowerCase()} values (${group[0].quantity} ${group[0].unit}) were confirmed from ${docIds.length} documents.`,
        details: { quantity: group[0].quantity, unit: group[0].unit },
        evidenceRefs: docIds,
      });
    }
  }

  // 4. Unit conflicts: the same fuel recorded with mass and volume units in one month.
  const fuelUnits = new Map<string, Set<string>>();
  for (const m of inMonth.filter((x) => x.type === 'FUEL')) {
    const fuel = (m.fuelType ?? 'diesel').toLowerCase();
    const u = normaliseUnit(m.unit) ?? m.unit;
    fuelUnits.set(fuel, new Set([...(fuelUnits.get(fuel) ?? []), u]));
  }
  for (const [fuel, units] of fuelUnits) {
    const hasMass = units.has('kg') || units.has('t');
    const hasVolume = units.has('L');
    if (hasMass && hasVolume) {
      const refs = inMonth.filter((m) => m.type === 'FUEL').map((m) => m.sourceDocumentId);
      issues.push({
        key: k('UNIT_CONFLICT', fuel),
        type: 'UNIT_CONFLICT',
        severity: 'MEDIUM',
        category: 'FUEL',
        title: `${fuel} is recorded in both litres and kilograms for ${monthName(period.key)}. Confirm each unit is correct.`,
        details: { fuel, units: [...units] },
        evidenceRefs: [...new Set(refs)],
      });
    }
  }

  // 5. Invalid values.
  for (const m of confirmed.filter((x) => !(x.quantity > 0))) {
    issues.push({
      key: k('INVALID_VALUE', m.id),
      type: 'INVALID_VALUE',
      severity: 'HIGH',
      category: m.type,
      title: `A ${m.type.toLowerCase()} value of ${m.quantity} ${m.unit} is zero or negative.`,
      details: { measurementId: m.id, quantity: m.quantity },
      evidenceRefs: [m.sourceDocumentId],
    });
  }

  // 6. Evidence filed in the wrong month.
  for (const m of confirmed.filter((x) => x.reportingMonth !== period.key)) {
    issues.push({
      key: k('PERIOD_MISMATCH', m.id),
      type: 'PERIOD_MISMATCH',
      severity: 'MEDIUM',
      category: m.type,
      title: `A ${m.type.toLowerCase()} value for ${monthName(m.reportingMonth)} was filed in the ${monthName(period.key)} period and is excluded from this calculation.`,
      details: { measurementId: m.id, reportingMonth: m.reportingMonth },
      evidenceRefs: [m.sourceDocumentId],
    });
  }

  // 7. Missing source location for a confirmed value.
  for (const m of inMonth.filter((x) => !x.sourceSnippet && x.page === null)) {
    issues.push({
      key: k('MISSING_SOURCE', m.id),
      type: 'MISSING_SOURCE',
      severity: 'LOW',
      category: m.type,
      title: `The location of a ${m.type.toLowerCase()} value on its source document was not identified; a reviewer should check it.`,
      details: { measurementId: m.id },
      evidenceRefs: [m.sourceDocumentId],
    });
  }

  // 8. Unexplained emissions-intensity change versus the previous period.
  if (input.currentIntensity !== null && input.previousIntensity !== null && input.previousIntensity > 0) {
    const changePct = ((input.currentIntensity - input.previousIntensity) / input.previousIntensity) * 100;
    if (Math.abs(changePct) > input.intensityChangeThresholdPct) {
      issues.push({
        key: k('INTENSITY_CHANGE'),
        type: 'INTENSITY_CHANGE',
        severity: 'LOW',
        category: null,
        title: `Emissions intensity changed by ${changePct.toFixed(1)}% compared with ${monthName(input.previousPeriodKey!)}. This is worth investigating; it does not by itself indicate a fault.`,
        details: { changePct: Number(changePct.toFixed(2)), current: input.currentIntensity, previous: input.previousIntensity },
        evidenceRefs: [],
      });
    }
  }

  return issues;
}

export function toIssueId(key: string): string {
  // Stable, Firestore-safe identifier derived from the issue key.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    h1 = Math.imul(h1 ^ key.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ key.charCodeAt(i), 2246822519) >>> 0;
  }
  return `iss_${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export type { EvidenceIssue };
