## 2026-08-09T19:49:33Z
Your working directory is `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/worker_m5`.
You are M5 Containerization & Build Worker.

Objective: Implement Milestone 5 (R5: Cloud Containerization & Deployment Setup) and prepare final production build.

Required Reading:
- `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/ORIGINAL_REQUEST.md`
- `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/PROJECT.md`
- `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/explorer_m5_1/handoff.md`
- `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/explorer_m5_2/handoff.md`

Implementation Requirements:
1. **TypeScript & Build Configuration**:
   - Add `"bun-types"` to `tsconfig.json` `compilerOptions.types`.
   - Fix property names (`userColor` -> `color`) in `src/__tests__/m4-empirical-verification.test.ts`.
   - Remove `typescript: { ignoreBuildErrors: true }` from `next.config.ts` so `bun run build` strictly checks TypeScript errors.
2. **Environment Variable Bindings**:
   - Create root `.env.example` documenting `PORT`, `CORS_ORIGIN`, `PUBLIC_URL`, `DATABASE_URL`, `NEXT_PUBLIC_SYNC_SERVICE_URL`, `NEXT_PUBLIC_VM_SERVICE_URL`.
   - Update `mini-services/sync-service/index.ts` and `vm-service/index.ts` to dynamically bind `process.env.PORT`, `process.env.CORS_ORIGIN`, `process.env.PUBLIC_URL`.
3. **Dockerfiles & Low-RAM Flags**:
   - Create `vm-service/Dockerfile` (Node 20 slim with Chromium, ffmpeg, fonts, and dependencies).
   - Create `mini-services/sync-service/Dockerfile` (Bun/Node 20 container).
   - Update `vm-service/dedicated-chrome.ts` to include `--disable-dev-shm-usage` & `--disable-gpu` and use cross-platform `os.tmpdir()` instead of hardcoded Windows profile paths.
4. **Docker Compose & Render Blueprint**:
   - Update `docker-compose.yml` to use service build contexts (`./vm-service`, `./mini-services/sync-service`), wire `PORT`, `CORS_ORIGIN`, `PUBLIC_URL`, `DATABASE_URL`, and add healthchecks.
   - Create root `render.yaml` declarative blueprint defining `watchparty-web`, `watchparty-vm`, and `watchparty-sync` services tuned for Render's 512MB RAM tier (`--disable-dev-shm-usage`, `--js-flags="--max-old-space-size=512"`).
5. **Verification**:
   - Run `bun test` (100% tests passing).
   - Run `npx tsc --noEmit` (0 TypeScript errors).
   - Run `bun run lint` (0 ESLint errors).
   - Run `bun run build` (Next.js production build succeeds cleanly).
