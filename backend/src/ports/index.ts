// Ports (interfaces) for every external dependency. Production adapters live in src/infra;
// tests inject in-memory or scripted adapters so business logic is testable without the cloud.

export type Filter = [field: string, op: '==' | 'in', value: unknown];

export interface StoreTx {
  get<T>(path: string): Promise<T | null>;
  set<T extends object>(path: string, data: T): void;
  update(path: string, data: Record<string, unknown>): void;
  create<T extends object>(path: string, data: T): void;
}

export interface DocStore {
  get<T>(path: string): Promise<T | null>;
  /** Fails with ConflictError if the document already exists. */
  create<T extends object>(path: string, data: T): Promise<void>;
  set<T extends object>(path: string, data: T): Promise<void>;
  update(path: string, data: Record<string, unknown>): Promise<void>;
  delete(path: string): Promise<void>;
  list<T>(collectionPath: string, filters?: Filter[]): Promise<T[]>;
  /** Query a collection id across all parents (admin/monitoring use only). */
  listGroup<T>(collectionId: string, filters?: Filter[]): Promise<T[]>;
  transaction<R>(fn: (tx: StoreTx) => Promise<R>): Promise<R>;
}

export class ConflictError extends Error {}

export interface FileStore {
  write(path: string, data: Buffer, contentType: string): Promise<void>;
  read(path: string): Promise<Buffer>;
  exists(path: string): Promise<boolean>;
}

export type LlmPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema (object)
}

export interface ToolLoopResult {
  finalText: string | null;
  steps: number;
}

export interface LlmClient {
  readonly model: string;
  /** `schema` uses the Gemini OpenAPI-subset Schema format (type, properties, required, nullable, enum). */
  generateJson<T>(req: { system: string; parts: LlmPart[]; schema: Record<string, unknown> }): Promise<T>;
  generateText(req: { system: string; parts: LlmPart[] }): Promise<string>;
  runTools(req: {
    system: string;
    prompt: string;
    tools: ToolDeclaration[];
    maxSteps: number;
    execute: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  }): Promise<ToolLoopResult>;
}

export interface OcrEngine {
  readonly enabled: boolean;
  readonly name: string;
  extractText(data: Buffer, mimeType: string): Promise<{ text: string; pageCount: number }>;
}

export interface Translator {
  translate(text: string, target: string, source?: string): Promise<{ text: string; detectedSource: string | null }>;
}

export interface SpeechService {
  synthesize(text: string, language: string): Promise<{ audioBase64: string; mimeType: string }>;
  transcribe(audioBase64: string, mimeType: string, language: string): Promise<{ transcript: string; confidence: number | null; durationSeconds: number }>;
  /** Locale codes known to work for this deployment (checked against Google's documented support). */
  supportedLocales(): { tts: Record<string, string | null>; stt: Record<string, string | null> };
}

export interface JobQueue {
  enqueue(job: { jobId: string; organizationId: string; type: string; payload: Record<string, string> }): Promise<void>;
}

export interface IdentityVerifier {
  verifyIdToken(token: string): Promise<{ uid: string; email: string; emailVerified: boolean }>;
}

/** Verifies calls from Cloud Tasks / Cloud Scheduler to internal endpoints. */
export interface InternalCallVerifier {
  verify(authorizationHeader: string | undefined): Promise<boolean>;
}

export interface Clock {
  now(): Date;
}
