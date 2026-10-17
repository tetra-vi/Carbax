# ComplyBridge AI 3.0 — UI Design System & Component Guidelines

## 1. Visual Philosophy

ComplyBridge AI 3.0 is designed as an **enterprise-grade B2B Carbon Compliance & Intelligence platform** tailored for manufacturers, plant managers, sustainability directors, and European buyers.

The design emphasizes:
- **Trust & Precision:** Deterministic data and citations are prioritized over decorative flair.
- **Clarity over Clutter:** High-density operational data without visual noise.
- **Universal Accessibility:** High-contrast text, clear focus rings, dual-indicator statuses (text + icon), and low-literacy worker modes.
- **Restrained Modernism:** Sustainability-inspired teal/green accents on neutral surfaces with subtle borders and elevation shadows. No arbitrary neon gradients or ungrounded glassmorphism.

---

## 2. Design Tokens

### Color Tokens

```scss
:root {
  /* Primary Brand (Teal / Emerald) */
  --cb-accent: #0f766e;           /* Main interactive buttons, links, brand */
  --cb-accent-hover: #115e59;     /* Button hover, active state */
  --cb-accent-soft: #e6f4f1;      /* Selected backgrounds, pill backgrounds */
  --cb-accent-subtle: #f0fdf4;    /* Subtle highlight */

  /* Neutral Backgrounds & Surfaces */
  --cb-bg: #f7f9f9;               /* Main app background */
  --cb-surface: #ffffff;          /* Cards, modals, tables, topbar */
  --cb-surface-elevated: #ffffff; /* Dropdowns, popovers, menus */
  --cb-border: #d9e1e0;           /* Card borders, table dividers */
  --cb-border-subtle: #edf2f1;    /* Inner row dividers */
  --cb-border-focus: #0f766e;     /* Focused inputs */

  /* Typography Colors */
  --cb-text: #1d2a29;             /* Primary text (contrast > 12:1) */
  --cb-text-secondary: #334155;   /* Secondary text */
  --cb-muted: #4b5a59;            /* Helper text, captions (WCAG AA compliant > 4.5:1) */

  /* Semantic Status Tokens */
  --cb-good: #166534;             /* Approved, confirmed, active, resolved */
  --cb-good-bg: #e7f6ec;
  --cb-bad: #b91c1c;              /* High severity, failed, rejected, revoked */
  --cb-bad-bg: #fdecec;
  --cb-warn: #92400e;             /* Pending approval, medium severity, warning */
  --cb-warn-bg: #fef3c7;
  --cb-busy: #1e40af;             /* Queued, processing, calculating */
  --cb-busy-bg: #e8eefc;

  /* Elevation Shadows */
  --cb-shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --cb-shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
  --cb-shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.04);

  /* Spacing Scale */
  --cb-space-xs: 4px;
  --cb-space-sm: 8px;
  --cb-space-md: 16px;
  --cb-space-lg: 24px;
  --cb-space-xl: 32px;

  /* Border Radii */
  --cb-radius-sm: 6px;
  --cb-radius-md: 10px;
  --cb-radius-lg: 16px;
  --cb-radius-pill: 9999px;

  /* Focus Indicator */
  --cb-focus-ring: 0 0 0 3px rgba(15, 118, 110, 0.35);
}
```

---

## 3. Typography Scale

- **Page Title (`h1`):** `1.5rem` (`24px`), font-weight: 700, line-height: 1.25, letter-spacing: -0.02em.
- **Section Heading (`h2`):** `1.15rem` (`18px`), font-weight: 600, line-height: 1.35.
- **Card Title (`h3`):** `1rem` (`16px`), font-weight: 600, line-height: 1.4.
- **Body Text:** `0.9375rem` (`15px`), font-weight: 400, line-height: 1.5.
- **Caption / Helper (`.small`, `.muted`):** `0.8125rem` (`13px`), font-weight: 400.
- **Font Stack:** `'Roboto', 'Noto Sans Tamil', 'Noto Sans Sinhala', sans-serif`.

---

## 4. Component Standards

### Status Chips (`cb-status`)
Status must **always combine icon + label text** (never color alone):
- Good (Green): `check_circle` icon (Approved, Confirmed, Resolved, Active, Ready)
- Bad (Red): `error` icon (Failed, Rejected, High Severity, Revoked)
- Warn (Amber): `info` icon (Pending, Medium Severity, Draft, Needs Review)
- Busy (Blue): `hourglass_top` icon (Processing, Queued, Calculating, Running)

### Accessible Dialogs
Replace native window alerts and prompts with Angular Material dialogs:
- Accessible focus trapping (WCAG 2.1).
- Escape key to dismiss.
- Explicit translated primary and cancel buttons.

### Responsive Breakpoints
- **Mobile (< 768px):** Single column forms, collapsed sidebar, stacked preview, touch targets >= 44x44px.
- **Tablet (768px – 1024px):** 2-column grids, wrapped period selectors, compact data tables.
- **Desktop (1024px+):** Side-by-side previews, full multi-column dashboard, sticky navigation.
