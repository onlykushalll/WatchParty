## 2026-08-09T19:15:51Z
You are a Remediation Worker subagent (ID: teamwork_preview_worker_m3_fix).
Working directory: c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/teamwork_preview_worker_m3_fix

Mandatory Input Files:
- Original Request: c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/ORIGINAL_REQUEST.md
- Reviewer 2 Handoff: c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/teamwork_preview_reviewer_m3_2/handoff.md
- Challenger 1 Handoff: c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/teamwork_preview_challenger_m3_1/handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work.

Task:
Fix the 2 specific defects in Milestone 3:
1. **Sanitize `NaN` / `Infinity` in `normalizeCoordinates` (`vm-service/index.ts` & `vm-service/dedicated-chrome.ts`)**:
   - Update coordinate normalization logic so that if input `x` or `y` is `NaN`, `Infinity`, `-Infinity`, `null`, `undefined`, or not a number, it defaults safely to `0` before clamping.
   - Example:
     ```ts
     function sanitizeUnit(v: number): number {
       if (typeof v !== 'number' || isNaN(v) || !isFinite(v)) return 0;
       return Math.min(1, Math.max(0, v));
     }
     ```
   - Ensure `bun test` passes all 62 tests across all test suites, including `STRESS: Coordinate Normalization math with extreme out-of-bounds, Infinity, and NaN inputs`.

2. **Floor Control Lock Authorization in `dedicated-chrome.ts`**:
   - In `vm-service/dedicated-chrome.ts`, enforce single-writer security invariant check (`isController(ws)`) before handling remote input events (`type === 2..7`), dropping unauthorized input frames from sockets that are not the current floor holder.

Verification:
- Run `bun test` to ensure 100% test pass rate (all 62+ tests passing).
- Run `bun run lint` to ensure 0 ESLint errors.
- Run `bunx tsc --noEmit` to ensure 0 TypeScript errors.
- Run `bun run build` to ensure clean Next.js build.

Output:
Write changes summary to `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/teamwork_preview_worker_m3_fix/changes.md` and deliver handoff report to `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/teamwork_preview_worker_m3_fix/handoff.md`. Communicate back when done.
