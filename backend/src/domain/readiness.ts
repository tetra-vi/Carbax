import type {
  CalculationRun,
  DocumentRecord,
  EvidenceIssue,
  FactorSet,
  Measurement,
  ReadinessCheck,
  ReadinessStatus,
  ReportingPeriod,
} from './types';

export interface ReadinessInput {
  period: ReportingPeriod;
  documents: DocumentRecord[];
  measurements: Measurement[];
  openIssues: EvidenceIssue[];
  calculation: CalculationRun | null;
  factorSet: FactorSet | null;
  reviewerApproved: boolean;
}

/** Deterministic verification-readiness assessment. "Ready" means ready for HUMAN review, never certified. */
export function assessReadiness(input: ReadinessInput): { status: ReadinessStatus; checks: ReadinessCheck[] } {
  const { period, documents, measurements, openIssues, calculation, factorSet } = input;
  const confirmed = measurements.filter((m) => m.reviewState === 'CONFIRMED' && m.reportingMonth === period.key);
  const checks: ReadinessCheck[] = [];

  const missingCats = period.requiredCategories.filter((c) => !confirmed.some((m) => m.type === c));
  checks.push({
    id: 'coverage',
    label: 'All required evidence categories present',
    passed: missingCats.length === 0,
    detail: missingCats.length ? `Missing: ${missingCats.join(', ')}` : 'Electricity, fuel and production evidence confirmed.',
  });

  const unconfirmed = documents.filter((d) => d.status === 'NEEDS_REVIEW' || d.status === 'QUEUED' || d.status === 'PROCESSING');
  checks.push({
    id: 'confirmation',
    label: 'All extracted values confirmed by a person',
    passed: unconfirmed.length === 0,
    detail: unconfirmed.length ? `${unconfirmed.length} document(s) still awaiting confirmation.` : 'Every extracted value was reviewed.',
  });

  const failedDocs = documents.filter((d) => d.status === 'FAILED');
  checks.push({
    id: 'processing',
    label: 'No failed document processing',
    passed: failedDocs.length === 0,
    detail: failedDocs.length ? `${failedDocs.length} document(s) failed processing and need re-upload.` : 'All documents processed.',
  });

  const highOrMedium = openIssues.filter((i) => i.severity !== 'LOW');
  checks.push({
    id: 'issues',
    label: 'No unresolved high or medium evidence issues',
    passed: highOrMedium.length === 0,
    detail: highOrMedium.length ? `${highOrMedium.length} unresolved issue(s).` : 'No blocking issues.',
  });

  checks.push({
    id: 'calculation',
    label: 'Deterministic calculation run on current evidence',
    passed: !!calculation && calculation.status === 'COMPLETE',
    detail: calculation ? `Calculation ${calculation.id} (${calculation.formulaVersion}) status ${calculation.status}.` : 'No calculation has been run.',
  });

  checks.push({
    id: 'factors',
    label: 'Emission factor set is versioned and sourced',
    passed: !!factorSet && factorSet.status === 'ACTIVE' && !!factorSet.electricity.source && !!factorSet.diesel.source,
    detail: factorSet
      ? `${factorSet.name} v${factorSet.version} (${factorSet.status}).`
      : 'No factor set available.',
  });

  const lineage = calculation
    ? calculation.result.lines.every((l) => l.measurementIds.length === 0 || l.sourceDocumentIds.length > 0)
    : false;
  checks.push({
    id: 'lineage',
    label: 'Every reported number traces to a source document',
    passed: lineage,
    detail: lineage ? 'All calculation lines reference source documents.' : 'Source references incomplete or calculation missing.',
  });

  checks.push({
    id: 'method',
    label: 'Methodology boundary documented',
    passed: !!calculation?.boundary,
    detail: calculation?.boundary ? 'Boundary and coverage checklist recorded with the calculation.' : 'Boundary not recorded.',
  });

  checks.push({
    id: 'review',
    label: 'Human reviewer approval recorded',
    passed: input.reviewerApproved,
    detail: input.reviewerApproved ? 'A reviewer approved this evidence package.' : 'Awaiting reviewer approval.',
  });

  const passed = (id: string) => checks.find((c) => c.id === id)!.passed;
  let status: ReadinessStatus;
  if (!passed('coverage')) status = 'MISSING_EVIDENCE';
  else if (!passed('confirmation') || !passed('processing') || !passed('calculation')) status = 'INCOMPLETE';
  else if (!passed('issues')) status = 'INCONSISTENT_DATA';
  else if (!passed('factors') || !passed('lineage') || !passed('method')) status = 'REQUIRES_METHOD_REVIEW';
  else if (!passed('review')) status = 'READY_FOR_HUMAN_REVIEW';
  else status = 'APPROVED_FOR_SHARING';

  return { status, checks };
}
