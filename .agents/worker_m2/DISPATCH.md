## 2026-08-17T09:17:30Z

You are Worker Agent for Milestone 2: Co-Browsing Virtual PC Hardening & Security Invariants.
Your metadata directory is: c:\Users\Default.L-HCG-9FVVGS3\OneDrive\Desktop\WatchParty\.agents\worker_m2

MANDATORY FIRST STEP: Read the authoritative request file:
c:\Users\Default.L-HCG-9FVVGS3\OneDrive\Desktop\WatchParty\.agents\ORIGINAL_REQUEST.md
Also read the survey reports and project architecture:
- c:\Users\Default.L-HCG-9FVVGS3\OneDrive\Desktop\WatchParty\PROJECT.md
- c:\Users\Default.L-HCG-9FVVGS3\OneDrive\Desktop\WatchParty\.agents\explorer_survey_2\survey_report.md
- c:\Users\Default.L-HCG-9FVVGS3\OneDrive\Desktop\WatchParty\.agents\explorer_survey_2\handoff.md

FILE WRITE OWNERSHIP:
You exclusively own and may edit:
- `vm-service/index.ts`
- `vm-service/cdp-browser.ts`
- `vm-service/dedicated-chrome.ts`
- `src/components/watchparty/virtual-browser.tsx`

DO NOT edit files outside your assigned ownership.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A forensic auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Tasks:
1. Fix Input Drop Defect (BUG-VM-01): In `src/components/watchparty/virtual-browser.tsx`, when taking/requesting floor control, send Opcode 16 (`request-control` with binary payload: `[0x10, len, ...userId]`) over WebSocket to `vm-service`, and Opcode 17 (`release-control`) when releasing floor, so `floorManager.isController(ws)` authenticates user inputs.
2. Implement Opcode 12 CDP frame navigation decoder in `src/components/watchparty/virtual-browser.tsx` (`ws.onmessage`) to decode `[0x0C, len_hi, len_lo, ...url]` and update the browser address bar immediately without needing 3s HTTP polling.
3. In `src/components/watchparty/virtual-browser.tsx`, clamp normalized cursor coordinates strictly to `[0.0, 1.0]` in `getNormalizedCoords` to ensure no out-of-bounds coordinates are sent during drag/move events.
4. In `vm-service/dedicated-chrome.ts`, apply `sanitizeUrl()` before page navigation to protect against SSRF and file scheme access.
5. In `vm-service/cdp-browser.ts`, enforce floor control checks on Opcode 11 and remove insecure arbitrary script evaluations.
6. In `vm-service/index.ts`, ensure proper floor queue promotion and cleanup on client disconnection.
7. Run `bun test` via terminal tool and verify `src/__tests__/vm-service.test.ts` and all other tests pass cleanly.
8. Document all changes and verification results in `c:\Users\Default.L-HCG-9FVVGS3\OneDrive\Desktop\WatchParty\.agents\worker_m2\handoff.md`.
9. Send completion message via `send_message`.
