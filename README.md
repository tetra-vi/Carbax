# ComplyBridge AI 3.0

**Carbon Compliance. Carbon Intelligence. One AI Factory Assistant.**

A multi-tenant SaaS that helps small manufacturers turn everyday bills and logbooks into traceable carbon
evidence for international (EU CBAM) buyers, and monitor energy and emissions every month.
Built for the Google Cloud AI Builder Cup 2026 (Manufacturing track).

## What it does

1. A factory worker photographs a bill (English or Tamil UI, guided low-literacy mode, read-aloud help).
2. **Document AI + Gemini** (Vertex AI) read it; a person confirms or corrects every value.
3. **CarbonOps Autopilot** (deterministic rules + Gemini function calling over controlled tools) finds missing,
   duplicated or inconsistent evidence, drafts a request in the worker's language, and waits for owner approval.
4. When the evidence arrives, it re-checks automatically and resolves the task.
5. A **deterministic calculation engine** (no AI in the maths) computes energy-scope emissions with versioned,
   cited factors, and every number links to its source document.
6. **Carbon Intelligence** dashboard and **CarbonTwin Lite** what-if scenarios lead to tracked improvement actions.
7. A **readiness agent**, a human reviewer approval step, PDF/CSV/XLSX evidence packs, and expiring buyer links.

> ComplyBridge prepares evidence for human and independent review. It never certifies CBAM compliance.
> The energy-scope figure is not a complete CBAM embedded-emissions value (precursors and process emissions are excluded).

## Repository

| Path | Contents |
|---|---|
| `backend/` | Node.js + TypeScript + Express API for Cloud Run (clean architecture: domain / application / infra / http) |
| `frontend/` | Angular 20 + Angular Material app for Firebase Hosting (English + Tamil, guided mode) |
| `backend/factor-sets/` | Versioned emission factor sets (**the grid factor must be configured before use**) |
| `demo-data/` | Fictional demo bills, receipts and production logs (incl. Tamil and a prompt-injection test) |
| `e2e/` | Playwright browser walkthrough of the full journey |
| `scripts/deploy.sh` | Step-by-step Google Cloud deployment |
| `docs/` | Architecture, deployment, API, demo storyboard, limitations, test report |
| `firebase.json`, `firestore.rules`, `storage.rules` | Hosting rewrites and deny-all client rules |

## Quick start (local)

```bash
# Backend tests (no cloud needed)
cd backend && npm install && npm test          # 47 tests

# Frontend build
cd frontend && npm install && npx ng build
```

To run against real Google AI locally: `gcloud auth application-default login`, copy `backend/.env.example`
to `.env`, set `STORE=memory FILES=memory QUEUE=inprocess INTERNAL_DEV_SECRET=dev`, run the Firebase Auth
emulator and `npm run dev`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Deploy to Google Cloud

```bash
export PROJECT_ID=your-project-id SUPER_ADMIN_EMAILS=you@example.com
./scripts/deploy.sh setup      # APIs, Firestore, private bucket, service accounts, Cloud Tasks queue, rules
# Edit backend/factor-sets/lk-energy-v1.json: official grid factor + source + year
./scripts/deploy.sh api        # Cloud Run
# Put your Firebase web config in frontend/src/app/core/environment.ts
./scripts/deploy.sh web        # Firebase Hosting
./scripts/deploy.sh scheduler  # monthly Cloud Scheduler job
```

## Before you demo: checklist

- [ ] Grid emission factor configured from an official, cited source (calculations are refused until then).
- [ ] `GEMINI_MODEL` set to a current Gemini model in your region (check Vertex AI Model Garden; default `gemini-2.5-flash`).
- [ ] Firebase web config in `frontend/src/app/core/environment.ts`; Email/Password sign-in enabled.
- [ ] (Optional) Document AI OCR processor created and `DOCUMENTAI_PROCESSOR_NAME` set.
- [ ] Tamil UI text reviewed by a native speaker (`frontend/public/i18n/ta.json`).
- [ ] Speech locales verified for Tamil in Google's Speech-to-Text / Text-to-Speech docs.
- [ ] Budget alert created in Cloud Billing.

Read [docs/LIMITATIONS.md](docs/LIMITATIONS.md) and [docs/TEST_REPORT.md](docs/TEST_REPORT.md).
