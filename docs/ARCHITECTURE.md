# Architecture

**Multi-tenant SaaS · modular monolith · clean architecture · event-driven background processing · controlled agentic AI**

```
Browser (Angular + Material, Firebase Auth)
   │  Firebase ID token on every API call
   ▼
Firebase Hosting ──/api/**──► Cloud Run: complybridge-api (Node.js/TypeScript/Express)
                                 │  http      → validation (zod), auth, RBAC, rate limits
                                 │  application → use cases (orgs, documents, CarbonOps, calculations, reports…)
                                 │  domain    → pure rules: calculator, units, evidence rules, readiness, state machines
                                 │  infra     → adapters (interfaces in src/ports)
                                 ├── Cloud Firestore (all tenant data under organizations/{orgId}/…)
                                 ├── Cloud Storage (private bucket: originals, OCR text, reports)
                                 ├── Vertex AI Gemini (extraction, agent function calling, explanations)
                                 ├── Document AI OCR (optional; Gemini multimodal fallback)
                                 ├── Cloud Translation (agent messages in the worker's language)
                                 ├── Speech-to-Text / Text-to-Speech (VoiceMate)
                                 └── Cloud Tasks ──OIDC──► /internal/tasks/process-document (same service)
Cloud Scheduler ──OIDC──► /internal/scheduler/monthly-close
```

## Live in the prototype vs planned

| Live (implemented and tested) | Planned (designed, not built) |
|---|---|
| Firebase Auth, RBAC, tenant isolation | Real subscription payments (no fake payment screens exist) |
| Firestore, private Cloud Storage | Buyer network across many suppliers |
| Gemini on Vertex AI: extraction, function-calling agent, explanations | BigQuery / Looker Studio analytics |
| Document AI OCR (when a processor is configured) | Additional CBAM sectors, process and precursor emissions |
| Cloud Translation, Speech-to-Text, Text-to-Speech | UK CBAM, EUDR module |
| Cloud Tasks background jobs with idempotency and retries | ERP / utility connectors |
| Cloud Scheduler monthly close | Sinhala and further UI languages (catalog structure ready) |
| Cloud Run, Firebase Hosting, Cloud Logging (structured JSON) | Eventarc storage trigger (not needed: uploads go through the API, which enqueues the job directly) |

## Key design decisions

- **Gemini never does maths.** It reads documents and explains. All emissions numbers come from
  `backend/src/domain/calculator.ts` (decimal-safe, versioned formula `energy-scope-v1.0`).
- **Factors are configuration, not AI output.** `factorSets/{id}` is versioned and cited; calculations are refused
  while the grid factor is unconfigured. Diesel uses IPCC 2006 defaults (74,100 kg CO2/TJ, NCV 43.0 TJ/Gg).
- **Humans confirm AI values.** Extractions are `NEEDS_REVIEW` until a person confirms or corrects them. Original
  AI value, corrected value, who and when are stored and audited.
- **The agent is a tool loop, not a chatbot.** CarbonOps can only call 14 declared tools. Each validates its
  arguments (zod), is scoped to one organization and period, and is audited. It cannot write arbitrary data, approve
  reports or send messages: drafted tasks stay `PENDING_APPROVAL` until an owner approves.
- **Prompt-injection defence.** Document text is untrusted data, wrapped in markers; the extraction call has no
  tools; instruction-like text is flagged; AI output must pass schema validation or the job fails visibly.
- **Browsers never touch Firestore or Storage.** Rules deny all client access; the API enforces every permission.
- **Approved reports are immutable.** Corrections require reopening the period (owner, reason, audited) and a new version.

## Data model (Firestore)

All tenant data lives under `organizations/{orgId}` for isolation:

| Collection | Purpose |
|---|---|
| `organizations/{orgId}` | Company profile, plan, trial end, status |
| `…/members/{uid}` | Role, facility access (`['*']` = all), language, guided mode |
| `…/facilities/{id}` | Plant, processes, products, methodologies |
| `…/periods/{per_<facility>_<YYYY-MM>}` | Monthly period; deterministic id prevents duplicates; status machine |
| `…/documents/{id}` | File metadata, SHA-256 checksum (duplicate prevention), status, job id |
| `…/jobs/{id}` | Background job state, attempts, last error (idempotency) |
| `…/extractions/{id}` | AI output, warnings, engine, model version |
| `…/measurements/{id}` | Confirmed values with canonical units and source lineage |
| `…/issues/{iss_<hash>}` | Deterministic evidence issues (stable id per rule key) |
| `…/tasks/{id}` | Evidence requests, approval state, status history |
| `…/agentRuns/{id}` | Every agent tool call, arguments, result |
| `…/calculations/{id}` | Versioned results, boundary, coverage, assumptions |
| `…/scenarios/{id}`, `…/actions/{id}` | CarbonTwin scenarios and improvement actions |
| `…/reports/{id}`, `…/shares/{id}` | Report versions and buyer share grants (hashed tokens) |
| `…/audit/{id}`, `…/notifications/{id}`, `…/usage/{YYYY-MM}` | Audit trail, in-app notifications, metering |
| `users/{uid}`, `invites/{sha256}`, `shareTokens/{sha256}`, `factorSets/{id}` | Global indexes and configuration |

## Roles and permissions

| Capability | Owner | Worker | Reviewer | Buyer (share link) | Super admin |
|---|---|---|---|---|---|
| Company, facilities, team, subscription | ✓ | | | | plan/status only |
| Upload evidence, confirm values | ✓ | assigned facilities | confirm only | | |
| Run CarbonOps, approve drafted tasks | run + approve | | run | | |
| Dashboard, results, CarbonTwin | ✓ | | ✓ | | |
| Approve / reject reports | | | ✓ (only role) | | |
| Share / revoke buyer links | ✓ | | | | |
| View shared approved report | | | | ✓ | |
| Customer documents | ✓ | assigned | ✓ | shared report only | **no access** |

## CarbonOps Autopilot workflow

1. Deterministic rules (`domain/rules.ts`) detect missing categories, unconfirmed extractions, duplicates (invoice and
   value), unit conflicts, invalid values, wrong-month evidence, missing source locations, intensity changes.
2. Issues are upserted with stable ids; issues that disappear are resolved and their tasks closed.
3. Gemini runs with function calling over: `getReportingPeriod`, `getConfirmedMeasurements`, `findMissingRecords`,
   `detectDuplicates`, `validateUnits`, `listOpenIssues`, `createEvidenceIssue` (re-runs rules only),
   `listEligibleAssignees`, `draftClarification`, `assignTask`, `requestHumanApproval`, `queueReanalysis`,
   `getCalculationSummary`, `explainFinding`.
4. Messages are translated to the assignee's language with Cloud Translation and labelled "machine translated".
5. Owner approves (optionally editing text or assignee), and the worker is notified in-app.
6. Worker uploads evidence linked to the task: `SUBMITTED → REVALIDATING → RESOLVED` automatically after confirmation.

## Multilingual and accessibility

- Runtime catalogs `frontend/public/i18n/{en,ta}.json` (383 strings each); switching language keeps form state.
- Language preference stored on the member profile; Noto Sans Tamil/Sinhala fonts are bundled (no CDN dependency).
- Guided mode: one task per screen, large buttons, progress, read-aloud (Text-to-Speech).
- Voice input: Speech-to-Text transcript is shown for confirmation before it is sent.
- Status chips always combine icon + text (never colour alone); skip link; keyboard focus styles; responsive layout.
