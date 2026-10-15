# Demo guide and 3-minute storyboard

## Prepare (once, on the deployed app)
1. Register as the owner (Ravi). Create **Lanka Aluminium Works (fictional)** and the facility **Biyagama Extrusion Plant**.
2. Open periods **2026-01 … 2026-04**. Invite a **worker** (Tamil) and a **reviewer**; accept both invites in other browsers.
3. Upload and confirm Jan, Feb and Apr evidence from `demo-data/` (electricity PDF, diesel PDF, production CSV).
4. For March, upload only `diesel-2026-03-tamil.png` and `production-2026-03.csv`. **Do not** upload the March electricity bill yet.
5. Rehearse once and record each segment separately on the **live URL**.

## Storyboard (3:00)

| Time | Show | Say |
|---|---|---|
| 0:00–0:25 | Landing page, then a pile of paper bills | "Since 2026, EU buyers need carbon data from Asian suppliers. Small factories keep it in paper bills, with no sustainability team." |
| 0:25–0:45 | Worker on a phone switches to **Tamil**, guided mode, presses read-aloud | "Priya works in Tamil. One task per screen, big buttons, read-aloud." |
| 0:45–1:15 | Upload `diesel-2026-03-tamil.png`: Gemini extracts 950 L; side-by-side check, confirm | "Document AI and Gemini read the Tamil receipt; a person confirms every value. Original and corrections are kept." |
| 1:15–1:45 | Owner: **Run CarbonOps Autopilot** → missing March electricity bill → drafted Tamil request → approve → worker uploads `electricity-2026-03-photo.png` → task **Resolved** automatically | "A real agent: Gemini calls our tools, drafts the request, waits for human approval, and re-checks when the evidence arrives." |
| 1:45–2:15 | **Carbon results**: formula lines, factor version, source documents; **Dashboard** monthly charts | "The maths is deterministic code with cited factors, never AI. Every number traces to its bill." |
| 2:15–2:40 | **CarbonTwin**: diesel −10% with price → hypothetical change → create improvement action | "Owners test ideas on a copy of their data, then track the real result next month." |
| 2:40–3:00 | Readiness checklist → reviewer approves → buyer portal via secure link | "Ready for review, not 'certified'. Approved packs go to buyers through expiring links. And it repeats every month." |

## Bonus moments (if asked)
- Upload `injection-test-bill.pdf`: the warning appears and nothing is approved.
- Upload `diesel-2026-04-topup-kg.png` into April: a **unit conflict** (litres and kg) is detected.
- Try to approve a report as the owner: refused, because only the reviewer can approve (separation of duties).
- Audit trail shows every correction, agent tool call, approval and share.
