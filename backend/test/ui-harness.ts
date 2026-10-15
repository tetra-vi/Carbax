// LOCAL UI TEST HARNESS ONLY (never deployed): runs the real API with the scripted test doubles from
// helpers.ts, trusts Firebase Auth *emulator* tokens, and serves the built frontend for browser testing.
import express from 'express';
import { join } from 'node:path';
import { buildTestDeps } from './helpers';

const h = buildTestDeps(new Date().toISOString());
h.deps.identity = {
  verifyIdToken: async (token: string) => {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (payload.iss !== 'https://securetoken.google.com/demo-complybridge') throw new Error('Not an emulator token');
    return { uid: payload.user_id, email: payload.email, emailVerified: true };
  },
};
h.deps.config.superAdminEmails = ['admin@platform.test'];
h.deps.config.publicAppUrl = 'http://localhost:8080';
const dist = process.argv[2] ?? join(__dirname, '..', '..', 'frontend', 'dist', 'frontend', 'browser');
void h.install().then(() => {
  const outer = express();
  outer.use(express.static(dist));
  outer.get(/^\/(?!api\/|internal\/|healthz).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  outer.use(h.app);
  outer.listen(8080, () => console.log('UI harness on http://localhost:8080'));
});
