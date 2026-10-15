# REST API (v1)

Base path `/api/v1`. All routes except those marked **public** require `Authorization: Bearer <Firebase ID token>`.
Errors: `{ "error": { "code", "message", "details?" } }`. Validation uses zod; uploads are multipart.

| Method & path | Roles | Purpose |
|---|---|---|
| GET `/health` | public | Liveness |
| GET `/me` · PATCH `/me/preferences` | any | Profile, organization, language, guided mode |
| POST `/organizations` | signed-in, no org | Register company (first user becomes OWNER, 30-day trial) |
| GET/PATCH `/organizations/current` | owner (patch) | Company profile |
| GET `/members` · PATCH `/members/:uid` | owner (reviewer read) | Team, roles, facility access, disable |
| POST `/members/invites` | owner | Create 7-day invite link |
| GET `/invites/:token` | public | Invite details · POST `/invites/:token/accept` (email must match) |
| POST/GET `/facilities` · GET/PATCH `/facilities/:id` | owner (write) | Facilities; archive with integrity check |
| POST/GET `/reporting-periods` · GET `/reporting-periods/:id` | owner (create) | Monthly periods |
| POST `/reporting-periods/:id/analyze` | owner, reviewer | Run rules + recalculate |
| POST `/reporting-periods/:id/close` · `/reopen` | owner | Close; controlled reopen with reason |
| GET `/reporting-periods/:id/documents` · `/measurements` · `/readiness` · `/agent-runs` · `/scenarios` | per role | Period views |
| POST `/documents` (multipart `file`, `periodId`, `declaredType?`, `relatedTaskId?`) | owner, worker | Upload (type sniffing, size limit, duplicate check, enqueue) |
| GET `/documents/:id` · `/documents/:id/file` | facility access | Metadata · authorised file stream |
| POST `/documents/:id/process` | owner, worker | Retry a failed document |
| GET `/extractions/:id` · POST `/extractions/:id/confirm` · `/reject` | owner, worker, reviewer | Human review of AI values |
| GET `/issues` · POST `/issues/:id/recheck` | owner, reviewer | Evidence issues |
| POST `/carbonops/run` | owner, reviewer | Gemini function-calling agent |
| GET `/tasks` · GET `/tasks/:id` | per role | Workers see only their approved tasks |
| POST `/tasks/:id/approve` · `/decline` | owner | Human approval (optional edits) |
| POST `/tasks/:id/respond` | assignee | Note / start |
| POST `/calculations/run` · GET `/calculations/:id` | owner, reviewer | Deterministic engine |
| GET `/intelligence/dashboard` · POST `/intelligence/explain` | owner, reviewer | KPIs, series, anomalies, AI explanation |
| POST `/scenarios` · GET `/scenarios/:id` | owner, reviewer | CarbonTwin (hypothetical) |
| POST/GET `/improvement-actions` · PATCH `/:id` · POST `/:id/evaluate` | owner (worker: own) | Actions and measured follow-up |
| POST `/reports/generate` · GET `/reports` · GET `/reports/:id` | owner, reviewer | Draft report v(n) |
| POST `/reports/:id/approve` · `/reject` | **reviewer only** | Approval requires readiness READY_FOR_HUMAN_REVIEW |
| GET `/reports/:id/download?format=pdf|csv|xlsx` | owner, reviewer | Files |
| POST `/reports/:id/share` · GET `/reports/:id/shares` · POST `/shares/:id/revoke` | owner | Expiring buyer links |
| GET `/shared/:token` · GET `/shared/:token/download` · POST `/shared/:token/clarifications` | public (token) | Buyer portal |
| POST `/assistant/chat` · `/transcribe` · `/speak` · `/translate` · GET `/assistant/speech-support` | members | VoiceMate |
| GET `/notifications` · POST `/notifications/:id/read` | member | In-app notifications |
| GET `/audit` | owner, reviewer | Audit trail |
| GET `/subscription` · `/usage` | owner | Plan, limits, usage (no payments) |
| GET `/admin/organizations` · PATCH `/admin/organizations/:id` · GET `/admin/jobs` · `/admin/health` | super admin | Platform admin (no document access) |
| POST `/internal/tasks/process-document` · `/internal/scheduler/monthly-close` | Google OIDC (invoker SA) | Cloud Tasks / Scheduler |
