#!/usr/bin/env bash
# ComplyBridge AI 3.0 - Google Cloud deployment (Cloud Run + Firebase Hosting).
# Run from the repository root after `gcloud auth login` and `firebase login`.
# Read each step before running it: this enables billable services in YOUR project.
#
# Usage:
#   export PROJECT_ID=your-project-id
#   export SUPER_ADMIN_EMAILS=you@example.com
#   ./scripts/deploy.sh setup     # one-time: APIs, bucket, service accounts, queue, Firestore
#   ./scripts/deploy.sh api       # build and deploy the Cloud Run API
#   ./scripts/deploy.sh web       # build and deploy the Angular app to Firebase Hosting
#   ./scripts/deploy.sh scheduler # create the monthly Cloud Scheduler job
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-complybridge-api}"
BUCKET="${BUCKET:-${PROJECT_ID}-complybridge-uploads}"
QUEUE="${QUEUE:-document-processing}"
API_SA="complybridge-api@${PROJECT_ID}.iam.gserviceaccount.com"
INVOKER_SA="complybridge-invoker@${PROJECT_ID}.iam.gserviceaccount.com"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-flash}"

gcloud config set project "$PROJECT_ID" >/dev/null

setup() {
  echo "==> Enabling APIs"
  gcloud services enable aiplatform.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
    artifactregistry.googleapis.com firestore.googleapis.com storage.googleapis.com documentai.googleapis.com \
    translate.googleapis.com speech.googleapis.com texttospeech.googleapis.com cloudtasks.googleapis.com \
    cloudscheduler.googleapis.com secretmanager.googleapis.com logging.googleapis.com monitoring.googleapis.com \
    firebase.googleapis.com identitytoolkit.googleapis.com

  echo "==> Firestore (native mode, ${REGION})"
  gcloud firestore databases describe --database='(default)' >/dev/null 2>&1 || \
    gcloud firestore databases create --location="$REGION" --type=firestore-native

  echo "==> Private upload bucket"
  gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1 || \
    gcloud storage buckets create "gs://${BUCKET}" --location="$REGION" --uniform-bucket-level-access --public-access-prevention

  echo "==> Service accounts"
  gcloud iam service-accounts describe "$API_SA" >/dev/null 2>&1 || gcloud iam service-accounts create complybridge-api --display-name="ComplyBridge API runtime"
  gcloud iam service-accounts describe "$INVOKER_SA" >/dev/null 2>&1 || gcloud iam service-accounts create complybridge-invoker --display-name="ComplyBridge Cloud Tasks/Scheduler invoker"

  echo "==> Least-privilege roles for the API runtime"
  for role in roles/datastore.user roles/aiplatform.user roles/documentai.apiUser roles/cloudtranslate.user \
              roles/cloudtasks.enqueuer roles/logging.logWriter roles/monitoring.metricWriter roles/serviceusage.serviceUsageConsumer; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${API_SA}" --role="$role" --condition=None >/dev/null
  done
  gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --member="serviceAccount:${API_SA}" --role=roles/storage.objectAdmin >/dev/null
  # The API creates Cloud Tasks that carry an OIDC token for the invoker account.
  gcloud iam service-accounts add-iam-policy-binding "$INVOKER_SA" --member="serviceAccount:${API_SA}" --role=roles/iam.serviceAccountUser >/dev/null

  echo "==> Cloud Tasks queue (retries with exponential backoff)"
  gcloud tasks queues describe "$QUEUE" --location="$REGION" >/dev/null 2>&1 || \
    gcloud tasks queues create "$QUEUE" --location="$REGION" --max-attempts=3 --min-backoff=10s --max-backoff=300s --max-concurrent-dispatches=5

  echo "==> Firestore + Storage security rules and indexes"
  firebase deploy --project "$PROJECT_ID" --only firestore:rules,firestore:indexes,storage

  cat <<EOF

Setup complete. Before deploying the API:
  1. Edit backend/factor-sets/lk-energy-v1.json and set the official grid emission factor, source and year.
  2. (Optional) Create a Document AI "Document OCR" processor in the console and note its resource name.
  3. Create a billing budget alert: Billing > Budgets & alerts (e.g. USD 50).
EOF
}

api() {
  echo "==> Building and deploying ${SERVICE} to Cloud Run (${REGION})"
  local url
  # First deploy to learn the URL, then set URL-dependent variables.
  gcloud run deploy "$SERVICE" --source backend --region "$REGION" --service-account "$API_SA" \
    --allow-unauthenticated --memory 1Gi --cpu 1 --max-instances 5 --timeout 300 \
    --set-env-vars "^|^GOOGLE_CLOUD_PROJECT=${PROJECT_ID}|UPLOAD_BUCKET=${BUCKET}|GEMINI_MODEL=${GEMINI_MODEL}|VERTEX_LOCATION=global|ACTIVE_FACTOR_SET_ID=lk-energy-v1|PUBLIC_APP_URL=https://${PROJECT_ID}.web.app|SUPER_ADMIN_EMAILS=${SUPER_ADMIN_EMAILS:-}|DOCUMENTAI_PROCESSOR_NAME=${DOCUMENTAI_PROCESSOR_NAME:-}|DOCUMENTAI_LOCATION=${DOCUMENTAI_LOCATION:-us}|TASKS_QUEUE_PATH=projects/${PROJECT_ID}/locations/${REGION}/queues/${QUEUE}|TASKS_INVOKER_EMAIL=${INVOKER_SA}|INTERNAL_INVOKER_EMAILS=${INVOKER_SA}|WORKER_BASE_URL=https://placeholder|INTERNAL_AUDIENCE=https://placeholder|ALLOWED_ORIGINS=https://${PROJECT_ID}.web.app,https://${PROJECT_ID}.firebaseapp.com"
  url=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
  gcloud run services update "$SERVICE" --region "$REGION" --update-env-vars "WORKER_BASE_URL=${url},INTERNAL_AUDIENCE=${url}"
  gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" --member="serviceAccount:${INVOKER_SA}" --role=roles/run.invoker >/dev/null
  echo "API deployed: ${url}"
  curl -fsS "${url}/api/v1/health" && echo
}

web() {
  echo "==> Building Angular (production) and deploying to Firebase Hosting"
  ( cd frontend && npm ci && npx ng build )
  firebase deploy --project "$PROJECT_ID" --only hosting
}

scheduler() {
  local url
  url=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
  echo "==> Monthly close job (1st of each month, 06:00 Asia/Colombo)"
  gcloud scheduler jobs describe complybridge-monthly-close --location "$REGION" >/dev/null 2>&1 && \
    gcloud scheduler jobs delete complybridge-monthly-close --location "$REGION" --quiet
  gcloud scheduler jobs create http complybridge-monthly-close --location "$REGION" \
    --schedule="0 6 1 * *" --time-zone="Asia/Colombo" --http-method=POST \
    --uri="${url}/internal/scheduler/monthly-close" \
    --oidc-service-account-email="$INVOKER_SA" --oidc-token-audience="$url"
  echo "Run it now to test: gcloud scheduler jobs run complybridge-monthly-close --location $REGION"
}

case "${1:-}" in
  setup) setup ;;
  api) api ;;
  web) web ;;
  scheduler) scheduler ;;
  *) echo "Usage: $0 {setup|api|web|scheduler}"; exit 1 ;;
esac
