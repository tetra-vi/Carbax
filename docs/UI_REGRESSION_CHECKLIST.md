# Ecuraa AI 3.0 — UI Regression Checklist

**Execution Date:** 2026-10-17  
**Test Scope:** Frontend Routes, Authentication, Permissions, Multi-tenant Isolation, Forms, Responsiveness, Localization

---

## Journey 1 — Factory Owner
- [ ] Login with valid owner credentials.
- [ ] Factory Dashboard renders KPI cards and charts without console errors.
- [ ] Navigate to Facilities; view existing facilities and create a new facility with defaults intact.
- [ ] Open a new reporting period (e.g., `2026-04`); verify period appears in selector.
- [ ] Upload evidence document; verify upload progress bar and honest status transitions.
- [ ] Navigate to Carbon Intelligence dashboard; view charts and anomaly insights.
- [ ] Navigate to Compliance; check readiness, generate report package, and view version history.

---

## Journey 2 — Factory Worker (Standard & Guided)
- [ ] Worker login; redirected to `/tasks` or `/guided` based on preference.
- [ ] View assigned tasks with localized messages.
- [ ] Open Task Detail; upload photo/document linked to task.
- [ ] Review extraction values; verify unit auto-resets when measurement type toggles.
- [ ] Confirm values; verify task status auto-resolves (`SUBMITTED → REVALIDATING → RESOLVED`).
- [ ] Switch to Guided Mode; verify large buttons, read-aloud TTS, and progress indicators.

---

## Journey 3 — CarbonOps Autopilot
- [ ] Open CarbonOps page with an active reporting period.
- [ ] Click "Run Rule Analysis"; verify deterministic issues appear with severity colors.
- [ ] Click "Run CarbonOps Agent"; verify Gemini tool calls log and task drafting.
- [ ] Owner approves drafted task with optional edited message or assignee.
- [ ] Verify worker receives notification and task appears in their queue.
- [ ] Owner declines task; verify accessible dialog prompts for reason and task is declined.

---

## Journey 4 — CarbonTwin Lite
- [ ] Open CarbonTwin simulator for an active reporting period.
- [ ] Adjust sliders (-50% to +50%) and input price values.
- [ ] Click "Simulate Scenario"; verify hypothetical results table and clear disclaimer.
- [ ] Create improvement action from scenario; verify action appears in Actions tracking list.

---

## Journey 5 — Independent Reviewer
- [ ] Login as Reviewer; navigate to Compliance / Review queue.
- [ ] Inspect evidence package and readiness checklist.
- [ ] Approve report with mandatory reviewer comment; verify status changes to `APPROVED`.
- [ ] Reject report with reason; verify period status allows correction.

---

## Journey 6 — Multilingual & Accessibility
- [ ] Switch language to Tamil (`தமிழ்`); verify every header, button, status chip, and form field translates without layout breakage or overflowing.
- [ ] Switch language to Sinhala (`සිංහල`); verify Sinhala font renders cleanly without tofu blocks.
- [ ] Fill form data (e.g., Onboarding or Facility); switch language; verify typed input is preserved.
- [ ] Test mobile viewport (360px & 390px): verify hamburger navigation, dismissible VoiceMate drawer, and readable tables.
- [ ] Keyboard navigation: Tab through landing, login, and dashboard; verify focus visible ring on all interactive elements.

---

## Journey 7 — Security & Admin
- [ ] Platform Super Admin logs in; navigates to `/admin`.
- [ ] Verify Admin Header with logout action and language switch.
- [ ] Verify non-admin users cannot access `/admin` (`superAdminGuard`).
- [ ] Verify client Firestore and Storage rules remain secure and deny-all.
