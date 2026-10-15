import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { Storage } from '@google-cloud/storage';
import type { AppConfig, Deps } from './application/core';
import { FirestoreStore } from './infra/firestoreStore';
import { MemoryStore } from './infra/memoryStore';
import { GcsFileStore, MemoryFileStore } from './infra/files';
import { GeminiClient } from './infra/gemini';
import { CloudTranslator, DocumentAiOcr, GoogleSpeech } from './infra/googleServices';
import { CloudTasksQueue, DevSecretVerifier, GoogleOidcVerifier, InProcessQueue } from './infra/queues';
import { processDocumentJob } from './application/documents';

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  return {
    env: nodeEnv,
    projectId: env('GOOGLE_CLOUD_PROJECT'),
    publicAppUrl: env('PUBLIC_APP_URL', 'http://localhost:4200').replace(/\/$/, ''),
    superAdminEmails: (process.env.SUPER_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024,
    intensityChangeThresholdPct: Number(process.env.INTENSITY_CHANGE_THRESHOLD_PCT ?? 20),
    activeFactorSetId: env('ACTIVE_FACTOR_SET_ID', 'lk-energy-v1'),
    agentMaxSteps: Number(process.env.AGENT_MAX_STEPS ?? 16),
    shareLinkMaxDays: Number(process.env.SHARE_LINK_MAX_DAYS ?? 90),
  };
}

/**
 * Production wiring. All AI goes to real Google Cloud services. The in-memory store/queue options
 * exist only for offline development; they are refused when NODE_ENV=production.
 */
export function buildDeps(config: AppConfig): Deps {
  const isProd = config.env === 'production';
  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: config.projectId });

  const storeMode = process.env.STORE ?? 'firestore';
  const filesMode = process.env.FILES ?? 'gcs';
  const queueMode = process.env.QUEUE ?? (isProd ? 'cloudtasks' : 'inprocess');
  if (isProd && (storeMode !== 'firestore' || filesMode !== 'gcs' || queueMode !== 'cloudtasks')) {
    throw new Error('Production requires STORE=firestore, FILES=gcs and QUEUE=cloudtasks');
  }

  const store = storeMode === 'memory' ? new MemoryStore() : new FirestoreStore(getFirestore());
  const files = filesMode === 'memory' ? new MemoryFileStore() : new GcsFileStore(new Storage().bucket(env('UPLOAD_BUCKET')));
  const llm = new GeminiClient(config.projectId, env('VERTEX_LOCATION', 'global'), env('GEMINI_MODEL', 'gemini-2.5-flash'));
  const ocr = new DocumentAiOcr(process.env.DOCUMENTAI_PROCESSOR_NAME || null, env('DOCUMENTAI_LOCATION', 'us'));
  const translator = new CloudTranslator(config.projectId);
  const speech = new GoogleSpeech(
    process.env.SPEECH_LOCALES_JSON
      ? JSON.parse(process.env.SPEECH_LOCALES_JSON)
      : { tts: { en: 'en-IN', ta: 'ta-IN', si: null }, stt: { en: 'en-IN', ta: 'ta-IN', si: 'si-LK' } },
  );

  const internalAuth = process.env.INTERNAL_DEV_SECRET && !isProd
    ? new DevSecretVerifier(process.env.INTERNAL_DEV_SECRET)
    : new GoogleOidcVerifier(env('INTERNAL_AUDIENCE'), env('INTERNAL_INVOKER_EMAILS').split(',').map((s) => s.trim()));

  const deps: Deps = {
    config,
    store,
    files,
    llm,
    ocr,
    translator,
    speech,
    queue: null as never,
    identity: {
      verifyIdToken: async (token) => {
        const d = await getAuth().verifyIdToken(token, true);
        return { uid: d.uid, email: d.email ?? '', emailVerified: d.email_verified === true };
      },
    },
    internalAuth,
    clock: { now: () => new Date() },
  };

  if (queueMode === 'cloudtasks') {
    deps.queue = new CloudTasksQueue(
      env('TASKS_QUEUE_PATH'),
      `${env('WORKER_BASE_URL').replace(/\/$/, '')}/internal/tasks/process-document`,
      env('TASKS_INVOKER_EMAIL'),
      env('INTERNAL_AUDIENCE'),
    );
  } else {
    const q = new InProcessQueue(false);
    q.setHandler(async (job) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await processDocumentJob(deps, job);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
    });
    deps.queue = q;
  }
  return deps;
}
