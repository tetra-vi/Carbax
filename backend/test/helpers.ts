// Test harness. These doubles stand in for Google services ONLY inside automated tests.
// Production wiring (src/container.ts) always uses the real Gemini, Document AI, Translation and Speech APIs.
import request from 'supertest';
import type { AppConfig, Deps } from '../src/application/core';
import type { FactorSet } from '../src/domain/types';
import { MemoryStore } from '../src/infra/memoryStore';
import { MemoryFileStore } from '../src/infra/files';
import { DevSecretVerifier, InProcessQueue } from '../src/infra/queues';
import { createApp } from '../src/http/app';
import { processDocumentJob } from '../src/application/documents';
import type { LlmClient, LlmPart, OcrEngine, SpeechService, ToolDeclaration, Translator } from '../src/ports';

/** Test-only factor set with round illustrative values. Never shipped as a real factor. */
export const TEST_FACTORS: FactorSet = {
  id: 'test-factors-v1',
  version: '1.0.0',
  name: 'TEST FIXTURE ONLY',
  status: 'ACTIVE',
  electricity: { country: 'TEST', kgCo2ePerKWh: 0.5, source: 'Test fixture value (not a real grid factor)', year: 2026 },
  diesel: { co2KgPerTJ: 74100, ncvTJPerGg: 43.0, densityKgPerL: 0.84, source: 'IPCC 2006 defaults (test copy)' },
  notes: 'Used by automated tests only.',
};

export const MARKER = '\n%%TEST_EXTRACTION%%';

/** Builds a fake PDF whose body carries the extraction the scripted Gemini double should return. */
export function fakePdf(extraction: unknown, salt = Math.random().toString(36)): Buffer {
  return Buffer.from(`%PDF-1.4\n% test ${salt}${MARKER}${JSON.stringify(extraction)}`);
}

export class ScriptedLlm implements LlmClient {
  readonly model = 'scripted-test-double';
  calls: string[] = [];
  agentPlan: 'normal' | 'malicious' = 'normal';
  async generateJson<T>(req: { system: string; parts: LlmPart[] }): Promise<T> {
    this.calls.push('generateJson');
    const inline = req.parts.find((p): p is { inlineData: { mimeType: string; data: string } } => 'inlineData' in p);
    const body = Buffer.from(inline!.inlineData.data, 'base64').toString('utf8');
    const i = body.indexOf(MARKER);
    if (i < 0) throw new Error('Unreadable document');
    return JSON.parse(body.slice(i + MARKER.length)) as T;
  }
  async generateText(req: { system: string; parts: LlmPart[] }): Promise<string> {
    this.calls.push('generateText');
    return `AI explanation (${req.system.slice(0, 20)}...)`;
  }
  async runTools(req: { system: string; prompt: string; tools: ToolDeclaration[]; maxSteps: number; execute: (n: string, a: Record<string, unknown>) => Promise<unknown> }) {
    this.calls.push('runTools');
    let steps = 0;
    if (this.agentPlan === 'malicious') {
      await req.execute('deleteAllData', {}).catch(() => undefined);
      await req.execute('assignTask', { taskId: 'tsk_does_not_exist', assigneeUid: 'x' }).catch(() => undefined);
      return { finalText: 'attempted', steps: 2 };
    }
    const issues = (await req.execute('listOpenIssues', {})) as { id: string; severity: string; hasTask: boolean; title: string }[];
    const people = (await req.execute('listEligibleAssignees', {})) as { uid: string; role: string }[];
    const worker = people.find((p) => p.role === 'WORKER') ?? people[0];
    for (const iss of issues) {
      steps++;
      if (iss.severity === 'LOW') {
        await req.execute('explainFinding', { issueId: iss.id, explanation: 'Worth investigating.' });
        continue;
      }
      if (iss.hasTask) continue;
      const { taskId } = (await req.execute('draftClarification', { issueId: iss.id, message: `Please upload the missing evidence: ${iss.title}` })) as { taskId: string };
      await req.execute('assignTask', { taskId, assigneeUid: worker.uid });
      await req.execute('requestHumanApproval', { taskId });
    }
    return { finalText: `Prepared requests for ${issues.length} issue(s).`, steps };
  }
}

export class FakeTranslator implements Translator {
  async translate(text: string, target: string) {
    return { text: `[${target}] ${text}`, detectedSource: 'en' };
  }
}

export class FakeSpeech implements SpeechService {
  supportedLocales() {
    return { tts: { en: 'en-IN', ta: 'ta-IN' }, stt: { en: 'en-IN', ta: 'ta-IN' } };
  }
  async synthesize() {
    return { audioBase64: Buffer.from('ID3fake').toString('base64'), mimeType: 'audio/mpeg' };
  }
  async transcribe() {
    return { transcript: 'march bill uploaded', confidence: 0.9, durationSeconds: 3 };
  }
}

export const disabledOcr: OcrEngine = { enabled: false, name: 'none', extractText: async () => ({ text: '', pageCount: 0 }) };

export function buildTestDeps(start = '2026-05-03T09:00:00Z') {
  let now = new Date(start);
  const config: AppConfig = {
    env: 'test',
    projectId: 'test-project',
    publicAppUrl: 'https://app.example.test',
    superAdminEmails: ['admin@platform.test'],
    maxUploadBytes: 2 * 1024 * 1024,
    intensityChangeThresholdPct: 20,
    activeFactorSetId: TEST_FACTORS.id,
    agentMaxSteps: 16,
    shareLinkMaxDays: 90,
  };
  const queue = new InProcessQueue(true);
  const llm = new ScriptedLlm();
  const deps: Deps = {
    config,
    store: new MemoryStore(),
    files: new MemoryFileStore(),
    llm,
    ocr: disabledOcr,
    translator: new FakeTranslator(),
    speech: new FakeSpeech(),
    queue,
    identity: {
      verifyIdToken: async (token: string) => {
        const m = token.match(/^tok:([\w-]+):(.+)$/);
        if (!m) throw new Error('bad token');
        return { uid: m[1], email: m[2], emailVerified: true };
      },
    },
    internalAuth: new DevSecretVerifier('internal-test-secret'),
    clock: { now: () => now },
  };
  // Mirrors Cloud Tasks: a thrown error means "retry", up to the job's maxAttempts.
  queue.setHandler(async (job) => {
    for (let i = 0; i < 3; i++) {
      try {
        await processDocumentJob(deps, job);
        return;
      } catch {
        /* retry */
      }
    }
  });
  const app = createApp(deps);
  return {
    deps,
    app,
    queue,
    llm,
    setNow: (iso: string) => (now = new Date(iso)),
    async install() {
      await deps.store.set(`factorSets/${TEST_FACTORS.id}`, TEST_FACTORS);
    },
  };
}

export type Harness = ReturnType<typeof buildTestDeps>;

export function client(h: Harness, uid: string, email: string) {
  const token = `tok:${uid}:${email}`;
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (url: string) => auth(request(h.app).get(url)),
    post: (url: string, body?: object) => auth(request(h.app).post(url)).send(body ?? {}),
    patch: (url: string, body?: object) => auth(request(h.app).patch(url)).send(body ?? {}),
    upload: (url: string, fields: Record<string, string>, file: Buffer, name: string, type = 'application/pdf') => {
      let r = auth(request(h.app).post(url));
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      return r.attach('file', file, { filename: name, contentType: type });
    },
  };
}

export function bill(type: 'ELECTRICITY' | 'FUEL' | 'PRODUCTION', month: string, quantity: number, unit: string, extra: Record<string, unknown> = {}) {
  const docType = type === 'ELECTRICITY' ? 'ELECTRICITY_BILL' : type === 'FUEL' ? 'FUEL_RECEIPT' : 'PRODUCTION_RECORD';
  return {
    documentType: docType,
    supplierName: type === 'ELECTRICITY' ? 'Lanka Grid Power Co. (fictional)' : 'Demo Supplier',
    invoiceNumber: `${type}-${month}`,
    invoiceDate: `${month}-28`,
    detectedLanguage: 'en',
    suspiciousInstructions: false,
    items: [{ measurementType: type, reportingMonth: month, quantity, unit, fuelType: type === 'FUEL' ? 'diesel' : null, sourceSnippet: `Total ${quantity} ${unit}`, page: 1, confidence: 'high' }],
    ...extra,
  };
}
