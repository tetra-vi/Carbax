import { CloudTasksClient } from '@google-cloud/tasks';
import { OAuth2Client } from 'google-auth-library';
import type { InternalCallVerifier, JobQueue } from '../ports';

/**
 * Cloud Tasks queue. Each task calls the worker endpoint on Cloud Run with an OIDC token
 * for the configured invoker service account. Task names equal job IDs, so a job is
 * never enqueued twice (Cloud Tasks de-duplicates by name).
 */
export class CloudTasksQueue implements JobQueue {
  private client = new CloudTasksClient();
  constructor(
    private readonly queuePath: string, // projects/P/locations/L/queues/Q
    private readonly workerUrl: string, // https://<service>/internal/tasks/process-document
    private readonly invokerServiceAccount: string,
    private readonly audience: string,
  ) {}
  async enqueue(job: { jobId: string; organizationId: string; type: string; payload: Record<string, string> }) {
    try {
      await this.client.createTask({
        parent: this.queuePath,
        task: {
          name: `${this.queuePath}/tasks/${job.jobId}`,
          httpRequest: {
            httpMethod: 'POST',
            url: this.workerUrl,
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify(job)).toString('base64'),
            oidcToken: { serviceAccountEmail: this.invokerServiceAccount, audience: this.audience },
          },
        },
      });
    } catch (e: unknown) {
      if ((e as { code?: number }).code === 6) return; // ALREADY_EXISTS: idempotent enqueue
      throw e;
    }
  }
}

/** Runs jobs in-process (local development and tests). */
export class InProcessQueue implements JobQueue {
  private handler: ((job: { jobId: string; organizationId: string; type: string; payload: Record<string, string> }) => Promise<void>) | null = null;
  private pending: Promise<void>[] = [];
  constructor(private readonly runImmediately = true) {}
  setHandler(h: InProcessQueue['handler']) {
    this.handler = h;
  }
  async enqueue(job: { jobId: string; organizationId: string; type: string; payload: Record<string, string> }) {
    if (!this.handler) throw new Error('No job handler registered');
    const h = this.handler;
    const p = (this.runImmediately ? Promise.resolve() : new Promise((r) => setTimeout(r, 10))).then(() => h(job)).catch(() => undefined);
    this.pending.push(p);
  }
  /** Test helper: wait for all queued jobs to finish. */
  async drain() {
    while (this.pending.length) {
      const batch = this.pending.splice(0);
      await Promise.all(batch);
    }
  }
}

/** Verifies Google-signed OIDC tokens from Cloud Tasks / Cloud Scheduler. */
export class GoogleOidcVerifier implements InternalCallVerifier {
  private client = new OAuth2Client();
  constructor(private readonly audience: string, private readonly allowedEmails: string[]) {}
  async verify(authorizationHeader: string | undefined): Promise<boolean> {
    if (!authorizationHeader?.startsWith('Bearer ')) return false;
    try {
      const ticket = await this.client.verifyIdToken({ idToken: authorizationHeader.slice(7), audience: this.audience });
      const p = ticket.getPayload();
      return !!p?.email && p.email_verified === true && this.allowedEmails.includes(p.email);
    } catch {
      return false;
    }
  }
}

/** Shared-secret verifier for local development only (never used when NODE_ENV=production). */
export class DevSecretVerifier implements InternalCallVerifier {
  constructor(private readonly secret: string) {}
  async verify(authorizationHeader: string | undefined): Promise<boolean> {
    return !!this.secret && authorizationHeader === `Bearer ${this.secret}`;
  }
}
