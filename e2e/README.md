# Browser end-to-end walkthrough

Drives the full Ecuraa journey in Chromium (owner, Tamil-speaking worker on a phone, reviewer, buyer)
and saves screenshots to `shots/`.

It runs against the **local UI test harness** (real API and business logic, scripted Gemini test double,
Firebase Auth emulator). It does not call Google AI.

```bash
# 1. Firebase Auth emulator (from repo root)
npx firebase emulators:start --only auth --project demo-Ecuraa
# 2. Frontend test build + harness
(cd frontend && npx ng build --configuration e2e)
(cd backend && npm run harness)
# 3. Walkthrough
cd e2e && npm install && npx playwright install chromium && npm test
```
Reset emulator accounts between runs:
`curl -X DELETE http://127.0.0.1:9099/emulator/v1/projects/demo-complybridge/accounts`
