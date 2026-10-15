# Deployment guide (Google Cloud)

Region used throughout: `asia-south1` (Mumbai). Change `REGION` in `scripts/deploy.sh` if needed.

## 0. Prerequisites
- Node.js 22, `gcloud` CLI, Firebase CLI (`npm i -g firebase-tools`), a Google Cloud project with billing and your Builder Cup credits.
- `gcloud auth login && gcloud auth application-default login && firebase login`
- In the Firebase console: add Firebase to the **same** project, enable **Authentication → Email/Password**,
  and register a **Web app** (copy its config).

## 1. One-time setup
```bash
export PROJECT_ID=your-project-id
export SUPER_ADMIN_EMAILS=you@example.com
./scripts/deploy.sh setup
```
This enables the APIs, creates Firestore (native), a private uniform-access bucket, two service accounts
(`complybridge-api` runtime, `complybridge-invoker` for Cloud Tasks/Scheduler), least-privilege IAM bindings,
the `document-processing` queue (3 attempts, exponential backoff) and deploys deny-all Firestore/Storage rules.

## 2. Configure emission factors (required)
Edit `backend/factor-sets/lk-energy-v1.json`:
```json
"electricity": { "country": "LK", "kgCo2ePerKWh": <official value>, "source": "<publisher, document, URL>", "year": <year> }
```
Use your national energy authority's or utility's published grid emission factor. Never use an AI-generated value.
The API installs factor sets at startup and refuses calculations while the value is `null`.

## 3. Optional: Document AI OCR
Console → Document AI → Create processor → **Document OCR** (location `us` or `eu`). Then:
```bash
export DOCUMENTAI_PROCESSOR_NAME=projects/<PROJECT_NUMBER>/locations/us/processors/<PROCESSOR_ID>
export DOCUMENTAI_LOCATION=us
```
Without it, Gemini reads files directly (multimodal) and the extraction record shows `engine: gemini-multimodal`.

## 4. Choose the Gemini model
Check Vertex AI → Model Garden for the current stable Flash model available to your project, then:
```bash
export GEMINI_MODEL=gemini-2.5-flash   # or the current model id
```
Test your extraction prompt with your sample bills in Google AI Studio first.

## 5. Deploy the API (Cloud Run)
```bash
./scripts/deploy.sh api
```
Builds from `backend/Dockerfile` with Cloud Build, deploys with the runtime service account, then sets
`WORKER_BASE_URL`/`INTERNAL_AUDIENCE` to the service URL and grants the invoker `run.invoker`.
The service accepts public traffic (Firebase Hosting rewrites); the app verifies Firebase ID tokens on every
API route and Google-signed OIDC tokens on `/internal/*`.

## 6. Deploy the web app (Firebase Hosting)
Paste your Firebase web config into `frontend/src/app/core/environment.ts`, then:
```bash
./scripts/deploy.sh web
```
`firebase.json` rewrites `/api/**` to the Cloud Run service `complybridge-api` in `asia-south1`.

## 7. Monthly automation (Cloud Scheduler)
```bash
./scripts/deploy.sh scheduler
gcloud scheduler jobs run complybridge-monthly-close --location asia-south1   # test now
```

## 8. Verify
```bash
curl https://<service-url>/api/v1/health
```
Then open `https://<PROJECT_ID>.web.app`, register, create the company and follow [DEMO.md](DEMO.md).
Check Cloud Logging for JSON request logs (`jsonPayload.message="request"`).

## 9. Cost control
- Create a budget alert: Billing → Budgets & alerts.
- Plan quotas (documents, AI calls, speech seconds) are enforced in the API per organization (`domain/plans.ts`).
- Cloud Run `--max-instances 5`; Cloud Tasks `--max-concurrent-dispatches 5`.

## Environment variables
See `backend/.env.example` for every variable with comments.

## Local development
```bash
# Terminal 1: Firebase Auth emulator
npx firebase emulators:start --only auth --project demo-complybridge
# Terminal 2: API with real Google AI (ADC), in-memory data
cd backend && GOOGLE_CLOUD_PROJECT=your-project-id STORE=memory FILES=memory QUEUE=inprocess \
  INTERNAL_DEV_SECRET=dev FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run dev
# Terminal 3: Angular dev server (proxies /api to :8080); use the e2e config to talk to the emulator
cd frontend && npx ng serve --configuration e2e
```
`npm run harness` (backend) starts the **test harness** with scripted AI doubles for UI work without cloud access.
