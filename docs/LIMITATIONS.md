# Known limitations (read before demoing or selling)

## Regulatory scope
- The calculation covers **energy-related emissions only** (grid electricity + diesel CO2). Precursor emissions,
  process emissions (e.g. anode consumption, PFCs), other fuels and multi-product allocation are not included.
  It is **not** a complete CBAM embedded-emissions figure; the boundary and coverage checklist say so on every report.
- "Approved for sharing" is an internal reviewer approval. Nothing in ComplyBridge is a certification or an
  accredited verification. CBAM scope, thresholds, default values and methods must be checked against current
  European Commission material by a qualified specialist before customer use.
- The CBAM default-value cost comparison from the original concept is **not implemented**: official default values
  were not loaded, and the product does not promise savings. CarbonTwin shows only user-priced hypothetical changes.

## Configuration you must provide
- **Grid emission factor**: `backend/factor-sets/lk-energy-v1.json` ships with `null`; calculations are refused
  until an official, cited value is configured. Diesel factors are IPCC 2006 defaults; density 0.84 kg/L is an assumption.
- **Gemini model id**: default `gemini-2.5-flash`. Google's model-versions page lists its retirement as
  "not before October 16, 2026". Check Model Garden and set `GEMINI_MODEL` to a current model.
- **Firebase web config** and **Document AI processor** (optional).

## AI and languages
- Extraction quality depends on the document; low-confidence values are flagged and every value needs human confirmation.
- Tamil UI strings (`frontend/public/i18n/ta.json`) were drafted without native-speaker review. **Have them reviewed.**
- Sinhala and other languages are listed as "coming soon/planned": the catalog structure is ready, translations are not.
- Speech locale support differs between Speech-to-Text and Text-to-Speech; the defaults are `en-IN`/`ta-IN`
  (Sinhala TTS disabled). Verify against Google's supported-language pages and set `SPEECH_LOCALES_JSON`.
- PDF reports use built-in Latin fonts; non-Latin snippets are marked "[non-Latin text]" in the PDF (CSV/XLSX keep them).

## Product scope
- One user belongs to one organization. Buyers use share links rather than accounts.
- Notifications are in-app only (no email/SMS).
- No real payment processing: plans are assigned by the platform admin during pilots. Prices are hypotheses.
- Rate limiting is per Cloud Run instance (in-memory); use Cloud Armor for global limits at scale.
- What was **not** tested here: real Google AI, Document AI, Translation, Speech, Firestore, Cloud Storage and Cloud Tasks
  calls (no cloud credentials were available in the build environment). Their adapters compile against the official SDKs
  and the business logic around them is fully tested with doubles. Test them in your project after deployment.
