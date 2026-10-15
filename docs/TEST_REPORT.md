# MVP acceptance test report

Run date: 14 October 2026. Environment: Node 22, Angular 20.3, Chromium (Playwright).

## Summary

| Suite | Result |
|---|---|
| Backend unit tests (domain: calculator, units, rules, state machines, anomalies, readiness, parsers) | **19 / 19 passed** |
| Backend API journey tests (full Lanka Aluminium Works story over HTTP) | **17 / 17 passed** |
| Backend security tests (isolation, roles, injection, idempotency, limits) | **11 / 11 passed** |
| TypeScript strict compile (backend) and Angular production build (frontend) | **passed** (initial bundle ~131 kB transferred) |
| Browser walkthrough (`e2e/run.js`): owner, Tamil worker on mobile, reviewer, buyer | **passed, 0 page/console errors**, 19 screenshots |

Run them yourself: `cd backend && npm test` and see `e2e/README.md`.

## What the tests use
- Real code paths: HTTP routes, validation, authorization, business logic, deterministic calculator, PDF/CSV/XLSX
  rendering, background job handling, Angular UI against the real API.
- **Test doubles** (in `backend/test/helpers.ts`, never shipped): scripted Gemini (returns the extraction embedded in a
  test file and drives the agent's tool calls), a prefixing translator, fake speech, in-memory Firestore/Storage, and an
  in-process queue that retries like Cloud Tasks. The browser walkthrough uses the Firebase Auth **emulator**.
- **Not exercised here:** live Vertex AI Gemini, Document AI, Cloud Translation, Speech APIs, Firestore, Cloud Storage
  and Cloud Tasks (no cloud credentials in the build environment). Run the demo in [DEMO.md](DEMO.md) on your deployed
  project to verify these integrations.

## Hand-calculated fixtures (verified by tests)
Test factor set (fixture only): grid 0.5 kg CO2e/kWh; diesel IPCC 2006 defaults 74,100 kg CO2/TJ × 43.0 TJ/Gg
= 3.1863 kg CO2 per kg; density 0.84 kg/L.

| Case | Expected | Result |
|---|---|---|
| 10,000 kWh, 1,000 L, 50 t | 5.0 + 2.6765 = 7.6765 t; 0.1535 t/t | ✓ |
| March: 10,200 kWh, 950 L (corrected from AI's 900 L), 50 t | 5.1 + 2.5427 = 7.6427 t; 0.1529 t/t | ✓ |
| CarbonTwin diesel −10% (855 L = 718.2 kg) | fuel 2.2884 t; cost −95 L × 350 = −33,250 LKR | ✓ |
| Improvement action baseline / target (diesel) | 950 L → 855 L; April follow-up 1,100 L | ✓ |

## Definition of Done (master prompt section 31)

| Item | Status |
|---|---|
| New company can register; user can sign in | ✓ (API test + browser) |
| Organization isolation | ✓ (cross-tenant reads return 404; tested) |
| Facility and reporting period creation | ✓ |
| Real document upload | ✓ (type sniffing, 10 MB limit, SHA-256 duplicate block) |
| Google AI actually extracts data | Implemented against Vertex AI Gemini + Document AI; **verify on your project** |
| Extracted data reviewed and corrected | ✓ (original + corrected values audited) |
| Missing evidence detected; CarbonOps creates actionable issue | ✓ |
| Worker submits corrected evidence; validation reruns | ✓ (SUBMITTED → REVALIDATING → RESOLVED) |
| Documented factors, deterministic formulas; traceable results | ✓ (refuses unconfigured grid factor) |
| CarbonTwin recalculates hypothetical scenarios | ✓ |
| Dashboard reflects persisted values | ✓ |
| Human review recorded | ✓ (reviewer-only approval, comment required) |
| PDF evidence package | ✓ (+ CSV, XLSX; approved versions immutable) |
| Runs on Cloud Run / Firebase | Deployment files and script provided; **deploy to verify** |
| Unauthorized users cannot access other companies' records | ✓ |
| Core workflows covered by tests | ✓ (47 backend tests + browser walkthrough) |
| AI limitations and calculation boundaries identified | ✓ (boundary on every calculation/report; LIMITATIONS.md) |

## Defects found and fixed during testing
1. A document waiting for retry after an AI error stayed in `PROCESSING`; it now returns to `QUEUED` with the error noted.
2. Google Fonts/Material Icons failed without CDN access; fonts and icons are now bundled with the app.
3. The confidence chip overlapped the "Type" field on the review screen; layout fixed.
4. Deployment script: comma-separated env values would have been split by gcloud; fixed with a custom delimiter.
5. Scenario assumptions showed "0 per kWh" when no price was entered; now says "not provided".
