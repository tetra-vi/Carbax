# Ecuraa AI 3.0 — UI Polish & Implementation Plan

**Date:** 2026-10-17  
**Plan Version:** 1.0.0  
**Target Architecture:** Angular 20 + Angular Material + Firebase Auth + Vertex AI  
**Goal:** Transform Ecuraa AI 3.0 into a visually consistent, internationally competitive, stable B2B SaaS platform.

---

## 1. Plan Overview & Execution Principles

This implementation plan organizes the 34 issues identified in `docs/UI_UX_AUDIT.md` into 6 controlled, sequential batches.

### Core Principles
1. **Safety First:** Preserve every existing business calculation, API contract, and verified domain logic.
2. **Incremental Delivery:** Complete and verify one batch before advancing to the next.
3. **No Regressions:** Maintain 100% passing tests (backend test suite and frontend production build).
4. **Honest Data:** Never replace real API responses with synthetic or hardcoded dashboard metrics.
5. **Universal Accessibility & Multilingual Quality:** Ensure WCAG 2.1 AA compliance and parity across English, Tamil, and Sinhala.

---

## 2. Implementation Batches

### Batch 1 — Audit & Critical/High Priority Bug Fixes
*Focus: Eliminate blocking user flow issues, application crashes, broken translations, and data-corrupting form behavior.*

- [ ] **SH-01:** Fix mobile VoiceMate drawer trap — add dismiss header and close trigger inside `cb-voicemate`.
- [ ] **AI-01:** Guard all period-dependent action buttons (`analyze`, `runAgent`, `runCalculation`, `simulate`, `checkReadiness`, `generateReport`) when `!s.periodId()`.
- [ ] **PUB-01:** Fix landing page feature translation pipe bug: wrap `(f.key + '.title') | t` and `(f.key + '.body') | t` in parentheses.
- [ ] **PUB-07:** Fix invite acceptance role translation pipe bug: wrap `('role.' + i.role) | t` in parentheses.
- [ ] **CORE-03:** Fix `FacilitiesPage` form reset bug: retain default country ("Sri Lanka"), timeZone ("Asia/Colombo"), and industry ("Aluminium") on reset.
- [ ] **PUB-04 & PUB-05:** Add password visibility toggles (`matSuffix` show/hide) and `<mat-error>` messages on Login and Registration forms.
- [ ] **PUB-06:** Replace hardcoded English and window `alert()` in Onboarding with localized i18n keys and `Notify` toast service.
- [ ] **EVI-04:** Fix `ReviewExtractionPage` measurement type change unit mismatch: auto-sync unit to valid default when type toggles between ELECTRICITY, FUEL, and PRODUCTION.
- [ ] **CORE-10:** Add an Admin Header to `/admin` with branding, language selector, and logout action so Platform Admins are not trapped outside the shell.

---

### Batch 2 — Global UI Foundation & Design System
*Focus: Establish a cohesive B2B SaaS design system tokens, typography, spacing, navigation hierarchy, and accessible dialogs.*

- [ ] **SH-05:** Consolidate CSS custom property design tokens in `frontend/src/styles.scss`:
  - Brand & Hover: `--cb-accent`, `--cb-accent-hover`, `--cb-accent-soft`
  - Neutral Surfaces: `--cb-surface`, `--cb-surface-card`, `--cb-border-subtle`, `--cb-border-focus`
  - Typography Colors: `--cb-text`, `--cb-text-muted` (darkened to `#4b5a59` for WCAG AA compliance)
  - Elevation Shadows: `--cb-shadow-sm`, `--cb-shadow-md`, `--cb-shadow-lg`
  - Spacing Scale: `--cb-space-xs` (4px), `--cb-space-sm` (8px), `--cb-space-md` (16px), `--cb-space-lg` (24px), `--cb-space-xl` (32px)
  - Border Radius: `--cb-radius-sm` (6px), `--cb-radius-md` (10px), `--cb-radius-lg` (16px)
- [ ] **SH-02:** Reorganize Sidebar Navigation into logical, collapsible/labeled groups:
  - *Operations & Evidence:* Dashboard, Guided Mode, Tasks, Documents, CarbonOps
  - *Intelligence & Planning:* Results & Lineage, CarbonTwin Lite, Actions, Compliance
  - *Management & Admin:* Facilities, Team, Subscription, Audit, Settings, Platform Admin
- [ ] **SH-03:** Polish Topbar for mobile viewports: responsive typography for organization name, compact action chips, and streamlined spacing.
- [ ] **SH-04:** Standardize `:focus-visible` focus ring token across all interactive elements.
- [ ] **CORE-04 & EVI-05 & AI-02 & AI-06:** Create a reusable `ConfirmDialog` / `PromptDialog` using Angular Material Dialog to replace all native `window.confirm` and `window.prompt` calls.
- [ ] **A11Y-01 & A11Y-02:** Add missing `aria-label` and `matTooltip` on all icon-only buttons.
- [ ] **I18N-02:** Update `cb-status` component with complete tone and icon mappings for `REVOKED`, `CANCELLED`, `LOW`, and `DECLINED`.
- [ ] **AI-09:** Add singleton playback state management in `cb-speak` to prevent audio overlap.

---

### Batch 3 — Core Screens Polish
*Focus: Elevate Dashboard, Facilities, Team, Documents, and Review Extraction.*

- [ ] **CORE-01:** Implement meaningful empty and loading states in `DashboardPage`:
  - When no facilities exist: clear invitation to configure plant.
  - When no reporting periods or calculation data exist: prominent notice with direct navigation to "Open Reporting Period".
  - Clean card KPI formatting with neutral trend placeholders.
- [ ] **CORE-02:** Polish `cb-bar-chart`:
  - Fluid SVG responsive scaling with adaptive bar widths.
  - Interactive tooltip badge on tap/hover.
  - Formatted units and period labels.
- [ ] **CORE-05:** Polish `FacilitiesPage`:
  - Card-based facility details with status badges.
  - Standardized period table with sorting, status chips, and confirmation dialogs for close/reopen.
  - Period month validation feedback.
- [ ] **CORE-06:** Polish `TeamPage`:
  - Human-readable language labels (`UI_LANGUAGES`) instead of raw codes.
  - Refined invite form alignment and email validation.
  - Safe confirmation dialog before toggling user status.
- [ ] **EVI-01 & EVI-02:** Polish `DocumentsPage`:
  - Accessible focus ring on `.dropzone` label (`:focus-within`).
  - Pre-upload file validation (format and size check).
  - Clear empty state when no documents have been uploaded for the period.
- [ ] **EVI-03:** Polish `ReviewExtractionPage`:
  - Add spreadsheet fallback preview and direct download action for `.csv` and `.xlsx` evidence.
  - Display and edit optional `fuelType` when measurement type is FUEL.
  - Side-by-side sticky preview layout on desktop, stacked on tablet/mobile.
  - Clean confirmation alert with navigation to Results.

---

### Batch 4 — AI Feature Screens Polish
*Focus: CarbonOps Autopilot, VoiceMate, CarbonTwin Lite, and Carbon Intelligence.*

- [ ] **AI-01 (CarbonOps):** Require active period before running rule analysis or Gemini agent; display prominent "Select Reporting Period" banner if unselected.
- [ ] **AI-02 (CarbonOps):** Replace `window.prompt` on task decline with `PromptDialog`.
- [ ] **CarbonOps UI:** Clear severity visual indicators (High: red, Medium: amber, Low: blue), human-readable agent tool action tags, and structured issue details.
- [ ] **AI-07 (VoiceMate):** Implement browser feature detection for audio recording (`audio/webm` vs `audio/mp4` on Safari/iOS).
- [ ] **AI-08 (VoiceMate):** Implement smooth auto-scroll to latest message in `cb-voicemate`.
- [ ] **VoiceMate UI:** Responsive full-height mobile panel with clear sticky close button, speaking indicator, and empty state prompt suggestions.
- [ ] **AI-03 & AI-04 (CarbonTwin):** Validate price inputs (non-negative), add clear hypothetical watermark/disclaimer card, and improve delta cost formatting with currency symbols.
- [ ] **CarbonTwin UI:** Clean slider controls with tick marks, baseline vs scenario comparative table with visual delta indicators (+/- colors).

---

### Batch 5 — Compliance, Admin & Settings
*Focus: Compliance readiness checklist, reviewer approval workflow, report packs, buyer portal, and comprehensive settings.*

- [ ] **SH-06 (Compliance):** Auto-select reporting period when navigating from notification route `/review/:reportId`.
- [ ] **AI-05 (Compliance):** Add clear helper text and validation when reviewer approves/rejects report package.
- [ ] **Compliance UI:** Organized readiness checklist with icons and detail popovers; report version history cards; download buttons with loading states.
- [ ] **PUB-09 (Shared Report):** Buyer portal polish: download progress spinners, file format icons, clean clarification form with character counter.
- [ ] **CORE-07 (Subscription):** Explicit "Current Plan" badge, color-coded quota usage meters, and responsive plan pricing cards.
- [ ] **CORE-08 (Audit):** Human-readable audit log change summary (key-value diff pills) instead of raw dumped JSON.
- [ ] **CORE-09 (Settings):** Comprehensive settings page:
  - Tab/Section 1: User Profile (name, email, role badge, assigned facilities).
  - Tab/Section 2: Organization Profile (company name, registration number, country, industry, address).
  - Tab/Section 3: Language & Accessibility (language selector, guided mode toggle with visual preview).
  - Tab/Section 4: Security (password reset trigger via Firebase Auth).
- [ ] **Admin Page:** Platform super admin dashboard polish with system health stats, filterable organization table, and suspension confirmation dialog.

---

### Batch 6 — Responsive, Accessibility, Multilingual & Final QA
*Focus: Sinhala translation catalog, viewport testing (360px–1920px), keyboard navigation, production build verification, and regression test suite.*

- [ ] **I18N-01:** Create complete `frontend/public/i18n/si.json` catalog (383+ keys translated to Sinhala), verify font rendering with Noto Sans Sinhala, and enable Sinhala in `UI_LANGUAGES`.
- [ ] **Responsive Verification:** Test layout breakpoints:
  - 360px & 390px mobile (compact topbar, collapsible drawer, single-column forms, touch targets >= 44x44px).
  - 768px & 1024px tablet (fluid grid cards, wrapped period picker).
  - 1280px, 1440px & 1920px desktop (max-width constraints, side-by-side previews).
- [ ] **Accessibility (WCAG 2.1 AA) Audit:**
  - Verify keyboard Tab flow on every page (no focus traps).
  - Verify screen reader attributes (`aria-label`, `aria-live="polite"`, `role="status"`).
  - Verify color contrast ratio >= 4.5:1 across all body text and badges.
- [ ] **Build & Test Verification:**
  - `npm run build` in `frontend` (zero errors, budget compliance).
  - `npm test` in `backend` (47/47 passing tests).
- [ ] **Regression & Documentation:**
  - Update `docs/UI_UX_AUDIT.md` (all issues marked VERIFIED).
  - Create `docs/UI_DESIGN_SYSTEM.md`.
  - Create `docs/UI_FIX_LOG.md`.
  - Create `docs/UI_REGRESSION_CHECKLIST.md`.

---

## 3. Definition of Done per Batch

Each batch must satisfy:
1. Every targeted issue is resolved with the smallest safe change.
2. Angular production build compiles cleanly without TypeScript or template errors.
3. No working backend or frontend features are removed or mocked.
4. Changes are verified across English, Tamil, and Sinhala.
5. Fix details are documented in `docs/UI_FIX_LOG.md`.
