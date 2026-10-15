# ComplyBridge AI frontend (Angular 20 + Angular Material)

- `npm install && npx ng build` produces `dist/frontend/browser` for Firebase Hosting.
- Put your Firebase web app config in `src/app/core/environment.ts`.
- `npx ng serve` proxies `/api` to `http://localhost:8080` (see `proxy.conf.json`).
- `--configuration e2e` uses the Firebase Auth emulator (local testing only).
- Translations: `public/i18n/en.json`, `public/i18n/ta.json` (Tamil needs native-speaker review).

Pages live in `src/app/pages/` (public, manage, evidence, carbon), core services in `src/app/core/`.
