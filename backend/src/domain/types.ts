// Core domain types for ComplyBridge AI 3.0.
// All timestamps are ISO-8601 strings. All tenant data lives under organizations/{organizationId}.

export const ROLES = ['OWNER', 'WORKER', 'REVIEWER', 'BUYER'] as const;
export type Role = (typeof ROLES)[number];

export const LANGUAGES = ['en', 'ta', 'si', 'hi', 'id', 'vi', 'th', 'ms'] as const;
export type Language = (typeof LANGUAGES)[number];

export type PlanId = 'TRIAL' | 'STARTER' | 'GROWTH' | 'BUSINESS' | 'BUYER_NETWORK';

export interface Organization {
  id: string;
  name: string;
  registrationNumber?: string;
  country: string;
  address?: string;
  contactEmail: string;
  phone?: string;
  industry: string;
  plan: PlanId;
  trialEndsAt?: string;
  preferredLanguage: Language;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  createdBy: string;
}

export interface UserIndex {
  uid: string;
  email: string;
  organizationId: string | null;
}

export interface Member {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  facilityIds: string[]; // ['*'] = all facilities
  status: 'ACTIVE' | 'DISABLED';
  language: Language;
  guidedMode: boolean;
  joinedAt: string;
}

export interface Invite {
  id: string; // also the token hash key
  organizationId: string;
  organizationName: string;
  email: string;
  role: Role;
  facilityIds: string[];
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedBy?: string;
  acceptedAt?: string;
}

export interface Facility {
  id: string;
  organizationId: string;
  name: string;
  location: string;
  country: string;
  timeZone: string;
  industry: string;
  processes: string[];
  productCategories: string[];
  methodologies: string[];
  baselinePeriod?: string; // YYYY-MM
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
}

export const PERIOD_STATUSES = [
  'DRAFT',
  'COLLECTING_DATA',
  'PROCESSING',
  'NEEDS_CORRECTION',
  'READY_FOR_REVIEW',
  'APPROVED',
  'CLOSED',
] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export const MEASUREMENT_TYPES = ['ELECTRICITY', 'FUEL', 'PRODUCTION'] as const;
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number];

export interface ReportingPeriod {
  id: string;
  organizationId: string;
  facilityId: string;
  year: number;
  month: number; // 1-12
  key: string; // YYYY-MM
  status: PeriodStatus;
  requiredCategories: MeasurementType[];
  latestCalculationId?: string;
  latestReadiness?: ReadinessStatus;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export const DOCUMENT_TYPES = [
  'ELECTRICITY_BILL',
  'FUEL_RECEIPT',
  'PRODUCTION_RECORD',
  'METER_READING',
  'OTHER',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type DocumentStatus = 'QUEUED' | 'PROCESSING' | 'NEEDS_REVIEW' | 'CONFIRMED' | 'REJECTED' | 'FAILED';

export interface DocumentRecord {
  id: string;
  organizationId: string;
  facilityId: string;
  periodId: string;
  declaredType?: DocumentType;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storagePath: string;
  checksum: string; // sha256 of file bytes
  status: DocumentStatus;
  uploadedBy: string;
  uploadedAt: string;
  relatedTaskId?: string;
  jobId?: string;
  extractionId?: string;
  error?: string;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface ExtractedItem {
  measurementType: MeasurementType;
  reportingMonth: string | null; // YYYY-MM
  periodStart: string | null;
  periodEnd: string | null;
  quantity: number | null;
  unit: string | null;
  fuelType: string | null;
  sourceSnippet: string | null;
  page: number | null;
  confidence: Confidence;
}

export interface Extraction {
  id: string;
  organizationId: string;
  documentId: string;
  periodId: string;
  facilityId: string;
  documentType: DocumentType;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  detectedLanguage: string | null;
  items: ExtractedItem[];
  warnings: string[];
  engine: string; // e.g. "documentai-ocr+gemini" | "gemini-multimodal" | "spreadsheet-parser"
  modelVersion: string | null;
  rawTextRef: string | null; // storage path of OCR text (never logged)
  status: 'NEEDS_REVIEW' | 'CONFIRMED' | 'REJECTED';
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface Measurement {
  id: string;
  organizationId: string;
  facilityId: string;
  periodId: string;
  type: MeasurementType;
  reportingMonth: string; // YYYY-MM
  quantity: number; // as confirmed, in `unit`
  unit: string;
  canonicalQuantity: number;
  canonicalUnit: 'kWh' | 'kg' | 't';
  fuelType: string | null;
  sourceDocumentId: string;
  extractionId: string;
  itemIndex: number;
  sourceSnippet: string | null;
  page: number | null;
  aiValue: number | null; // what AI extracted
  aiUnit: string | null;
  corrected: boolean;
  reviewState: 'CONFIRMED' | 'SUPERSEDED';
  confirmedBy: string;
  confirmedAt: string;
}

export type IssueType =
  | 'MISSING_CATEGORY'
  | 'MISSING_PRODUCTION'
  | 'DUPLICATE_DOCUMENT'
  | 'UNIT_CONFLICT'
  | 'INVALID_VALUE'
  | 'PERIOD_MISMATCH'
  | 'UNCONFIRMED_EXTRACTION'
  | 'MISSING_SOURCE'
  | 'INTENSITY_CHANGE'
  | 'REVIEW_INCOMPLETE';

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface EvidenceIssue {
  id: string; // deterministic from key
  key: string;
  organizationId: string;
  facilityId: string;
  periodId: string;
  type: IssueType;
  severity: Severity;
  category: MeasurementType | null;
  title: string; // deterministic English description
  details: Record<string, unknown>;
  evidenceRefs: string[]; // document / measurement ids
  status: 'OPEN' | 'RESOLVED';
  taskId?: string;
  detectedAt: string;
  resolvedAt?: string;
  resolution?: string;
}

export const TASK_STATUSES = [
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_FOR_EVIDENCE',
  'SUBMITTED',
  'REVALIDATING',
  'RESOLVED',
  'REJECTED',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface AgentTask {
  id: string;
  organizationId: string;
  facilityId: string;
  periodId: string;
  issueId: string | null;
  kind: 'EVIDENCE_REQUEST' | 'MONTHLY_COLLECTION';
  title: string;
  messageEnglish: string;
  messageLocalized: string | null;
  localizedLanguage: Language | null;
  machineTranslated: boolean;
  assigneeUid: string | null;
  approvalState: 'PENDING_APPROVAL' | 'APPROVED' | 'NOT_REQUIRED' | 'DECLINED';
  approvedBy?: string;
  status: TaskStatus;
  createdBy: string; // uid or "agent:carbonops" / "system:scheduler"
  createdAt: string;
  updatedAt: string;
  responseDocumentIds: string[];
  responseNote?: string;
  history: { at: string; by: string; from: TaskStatus | null; to: TaskStatus; note?: string }[];
}

export interface FactorSet {
  id: string;
  version: string;
  name: string;
  status: 'ACTIVE' | 'TEST_ONLY' | 'RETIRED';
  electricity: {
    country: string;
    kgCo2ePerKWh: number | null; // must be configured from an official, cited source
    source: string;
    year: number | null;
  };
  diesel: {
    co2KgPerTJ: number;
    ncvTJPerGg: number;
    densityKgPerL: number;
    source: string;
  };
  notes: string;
}

export interface CalculationLine {
  label: string;
  measurementType: MeasurementType;
  input: number;
  inputUnit: string;
  factor: number | null;
  factorUnit: string | null;
  formula: string;
  resultTCo2e: number | null;
  measurementIds: string[];
  sourceDocumentIds: string[];
}

export interface CalculationResult {
  electricityKWh: number;
  dieselKg: number;
  productionT: number;
  electricityTCo2e: number;
  fuelTCo2e: number;
  totalTCo2e: number;
  intensityTCo2ePerT: number | null;
  lines: CalculationLine[];
}

export interface CalculationRun {
  id: string;
  organizationId: string;
  facilityId: string;
  periodId: string;
  periodKey: string;
  factorSetId: string;
  factorSetVersion: string;
  formulaVersion: string;
  boundary: string;
  allocationMethod: string;
  assumptions: string[];
  coverage: { element: string; included: boolean; note: string }[];
  result: CalculationResult;
  status: 'COMPLETE' | 'INCOMPLETE';
  incompleteReasons: string[];
  createdBy: string;
  createdAt: string;
}

export interface ScenarioInputs {
  electricityChangePct: number;
  dieselChangePct: number;
  productionChangePct: number;
  dieselPricePerL?: number | null;
  electricityPricePerKWh?: number | null;
  currency?: string | null;
}

export interface Scenario {
  id: string;
  organizationId: string;
  facilityId: string;
  periodId: string;
  baseCalculationId: string;
  inputs: ScenarioInputs;
  baseline: CalculationResult;
  projected: CalculationResult;
  delta: { totalTCo2e: number; intensityTCo2ePerT: number | null; costChange: number | null };
  assumptions: string[];
  explanation: string | null;
  explanationIsAiGenerated: boolean;
  status: 'HYPOTHETICAL';
  createdBy: string;
  createdAt: string;
}

export type ActionStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface ImprovementAction {
  id: string;
  organizationId: string;
  facilityId: string;
  title: string;
  description: string;
  metric: 'DIESEL_L' | 'ELECTRICITY_KWH' | 'INTENSITY';
  scenarioId: string | null;
  issueId: string | null;
  assigneeUid: string | null;
  startDate: string;
  dueDate: string;
  baselinePeriodId: string;
  baselineValue: number;
  targetValue: number;
  status: ActionStatus;
  completionEvidence: string | null;
  followUps: { periodId: string; periodKey: string; actualValue: number; changePct: number; evaluatedAt: string }[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export const READINESS_STATUSES = [
  'INCOMPLETE',
  'MISSING_EVIDENCE',
  'INCONSISTENT_DATA',
  'REQUIRES_METHOD_REVIEW',
  'READY_FOR_HUMAN_REVIEW',
  'APPROVED_FOR_SHARING',
] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

export interface ReadinessCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface ReadinessAssessment {
  status: ReadinessStatus;
  checks: ReadinessCheck[];
  outstandingIssues: { id: string; title: string; severity: Severity }[];
  summary: string | null;
  summaryIsAiGenerated: boolean;
  assessedAt: string;
}

export interface Report {
  id: string;
  organizationId: string;
  facilityId: string;
  periodId: string;
  periodKey: string;
  version: number;
  calculationId: string;
  readiness: ReadinessAssessment;
  status: 'DRAFT' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  pdfPath: string | null;
  csvPath: string | null;
  xlsxPath: string | null;
  reviewerUid?: string;
  reviewerComment?: string;
  reviewedAt?: string;
  createdBy: string;
  createdAt: string;
}

export interface ShareGrant {
  id: string;
  organizationId: string;
  reportId: string;
  buyerName: string;
  buyerEmail: string;
  tokenHash: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  accessLog: { at: string; action: 'VIEW' | 'DOWNLOAD' | 'CLARIFICATION' }[];
  clarifications: { at: string; message: string; name: string }[];
}

export interface AuditEvent {
  id: string;
  organizationId: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  occurredAt: string;
}

export interface Job {
  id: string;
  organizationId: string;
  type: 'PROCESS_DOCUMENT';
  payload: Record<string, string>;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRun {
  id: string;
  organizationId: string;
  periodId: string;
  goal: string;
  model: string;
  toolActions: { tool: string; args: Record<string, unknown>; ok: boolean; result: unknown }[];
  finalMessage: string | null;
  status: 'SUCCEEDED' | 'FAILED';
  error?: string;
  startedBy: string;
  startedAt: string;
  finishedAt: string;
}

export interface UsageRecord {
  month: string; // YYYY-MM
  documentsProcessed: number;
  aiCalls: number;
  speechSeconds: number;
  reportsGenerated: number;
}
