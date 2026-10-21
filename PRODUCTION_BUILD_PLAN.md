# FindIt: Production Hardening & Build Plan

**Repository:** FindIt (CMRIT Lost & Found Platform)
**Date:** October 2026
**Status:** Hardened & Tested — Pending Deployment Acceptance Gates

---

## 1. Verified Repository Baseline & Architecture Audit

### 1.1 Technical Stack & Runtime Environment
- **Runtime & Language:** Node.js 22 LTS, TypeScript 5.8+ (`tsconfig.json` target ES2022).
- **Web Framework:** Next.js `16.4.2` (App Router, React `19.3.1`, Webpack build mode).
- **Styling:** Tailwind CSS `4.3.3` with `@tailwindcss/postcss`.
- **Database & ORM:** PostgreSQL 16 on Neon, Prisma ORM `6.4.1` with dual connection pooling (`DATABASE_URL` via PgBouncer on 6543, `DIRECT_URL` on 5432).
- **Storage Tier:** Dual-tier adapter (S3-compatible MinIO/Supabase S3 + zero-config database WebP fallback).
- **Image Processing:** `sharp` `0.35.5` (failOn: 'error', 16MP limit, EXIF auto-rotate, metadata strip, WebP format conversion).
- **Cryptography & Security:** Native Node.js `crypto` (`scryptSync`, `randomBytes`, `timingSafeEqual`, `createHmac`).
- **Background Worker & Cron:** PostgreSQL `jobs` table with `FOR UPDATE SKIP LOCKED`; daily Vercel cron at `0 0 * * *`.
- **Testing:** Vitest `5.0.5` (unit and integration tests), Playwright `1.64.1` (E2E).

---

## 2. Implemented Security Controls

| Security Control | Implementation Location | Verification |
| :--- | :--- | :--- |
| **Fail-Closed `AUTH_SECRET` & Entropy Guard** | `src/lib/session.ts` (`getAuthSecret`) | Throws clear error on missing/empty secret or if length is below minimum 16 characters (`MIN_AUTH_SECRET_LENGTH = 16`); returns `null` on token verification. 256-bit entropy documented as operational requirement. Unit tested in `tests/unit/session.test.ts`. |
| **Future-Dated Token Rejection** | `src/lib/session.ts` (`verifySessionToken`) | Rejects future-dated tokens beyond 60s clock skew; rejects tokens older than 30 days. Strict 64-hex HMAC validation. Unit tested in `tests/unit/session.test.ts`. |
| **Bounded Rate Limiter** | `src/lib/rate-limit.ts` (`RateLimiter`) | Bounded to 5,000 max entries with automatic eviction to prevent memory exhaustion. Resolves proxy-verified client IP (`getTrustworthyClientIp`). Unit tested in `tests/unit/rate-limit.test.ts`. |
| **Account Enumeration Defense** | `app/api/v1/auth/login/route.ts` | Unified generic error (`'Invalid email or password'`) for missing account and bad password, with dummy `verifyPassword` execution to eliminate timing side-channels. |
| **Minimized Claimant Email Disclosure** | `src/modules/claims/service.ts`, `app/(app)/[orgSlug]/claims/page.tsx` | Claimant email is masked (`undefined`) on pending/rejected claims, and revealed ONLY to the report owner upon `APPROVED` or `HANDOFF_CONFIRMED`. Hidden from moderators/admins. Unit tested in `tests/unit/claim-privacy.test.ts`. |
| **Image Decompression Bomb & Parser Guard** | `app/api/v1/uploads/direct/route.ts`, `src/modules/uploads/image-processor.ts` | Pre-flight `Content-Length` check; single-file enforcement; magic bytes verification; Sharp deep parser metadata check with `limitInputPixels: 16,777,216` and 4096px dimension ceiling. Unit tested in `tests/unit/image-upload-hardening.test.ts`. |
| **Presigned Upload & Worker Lifecycle Hardening** | `src/modules/uploads/storage-adapter.ts`, `src/jobs/handlers.ts`, `src/modules/reports/repository.ts` | Signed `ContentLength` and `ContentType` in PUT URL; worker pre-download `headObject` metadata check (> 10MB rejected and purged); stream byte cap during download; magic bytes MIME validation; raw objects deleted after thumbnail generation; `/api/v1/images/[id]` forbids raw object access; sweep cleans abandoned pending uploads. AWS IAM permission verified as `s3:GetObject` (no invalid `s3:HeadObject`). Unit tested in `tests/unit/presigned-upload-security.test.ts`. |
| **Storage Deletion Reliability & Durable Retries** | `src/modules/uploads/storage-adapter.ts`, `src/modules/uploads/service.ts`, `src/jobs/handlers.ts` | `storageAdapter.deleteObject()` treats 404/NoSuchKey as idempotent success, surfaces provider errors without swallowing, and throws on unconfigured storage. `cleanupAbandonedUploads` discovers all unpurged remote objects including attached rejected images where *either* `rawObjectKey` or `thumbObjectKey` remains unpurged, preventing partial delete stranding. For attached images (`reportId !== null`), it purges remote objects and updates keys to `purged:${id}` while strictly preserving the database row to protect report integrity. For unattached uploads (`reportId === null`), it deletes both storage and database records once deletion succeeds. `handleProcessImage` retains raw keys, propagates non-duplicate purge-job enqueue failures, and retries raw-object deletion without reprocessing rejected uploads. `handlePurgeStorageObject` throws so runner retries. Unit tested in `tests/unit/storage-deletion-handling.test.ts`. |
| **Fair Sweeper Pagination & Retry Backoff** | `src/modules/uploads/service.ts`, `prisma/schema.prisma` (`cleanupAttempts`, `nextRetryAt`, index `report_images_cleanup_idx`) | Bounded batch processing (`batchSize: 50`) and cursor pagination. Exponential backoff (`min(30 * 2^(attempts-1), 3600)` seconds) for repeatedly failing storage deletions. Filter `nextRetryAt: null | { lte: now }` automatically prevents persistent failures from monopolizing batches and starving newly eligible records. Separated database predicates: `buildOutstandingCleanupWhere` tracks complete backlog and oldest pending age including backoff items; `buildEligibleCleanupWhere` selects the bounded processing batch. Safe operational metrics (`getCleanupMetrics()`) track `totalBacklog`, `failedAttemptsCount`, `oldestPendingAgeSeconds`, and fail-safe `metricsAvailable` flag without disclosing signed URLs, keys, or PII. Tested in `tests/unit/storage-deletion-handling.test.ts` (multi-batch fairness, recovery, metrics). |
| **Worker Cadence, Cron Durability & Structured Observability** | `vercel.json`, `app/api/v1/internal/worker/tick/route.ts`, `src/jobs/runner.ts` | Default daily schedule (`0 0 * * *`) in `vercel.json` provides baseline compatibility with Vercel Hobby plan limits, preventing deployment build failures; 15-minute cadence supported via Vercel Pro or external dispatchers. Worker endpoint protected by `WORKER_SECRET` / `CRON_SECRET`. All jobs (`jobs` table with `status = 'QUEUED'`) and retry states (`next_retry_at`) are durable in PostgreSQL, guaranteeing full recovery via `FOR UPDATE SKIP LOCKED` upon missed cron ticks. `jobRunner.tick()` returns structured `WorkerTickResult` isolating `jobs` and `cleanup` statuses, returning stable sanitized error codes (`CLEANUP_SWEEP_FAILED`, `STORAGE_DELETION_FAILED`) without raw exception or credential disclosure, allowing monitors to detect storage cleanup failures even when job processing succeeds. Unit tested in `tests/unit/worker-cron.test.ts` and `tests/unit/job-runner.test.ts`. |
| **Safe Admin Provisioning & Rotation** | `prisma/seed.ts` | General re-seeding preserves existing admin credentials without silent resets. Credential rotation requires deliberate `RESET_ADMIN_PASSWORD=true` alongside `ADMIN_PASSWORD`. Documented in `OPERATIONAL_RUNBOOK.md`. |
| **Tooling & Linter Compliance** | `eslint.config.mjs`, `package.json` | Migrated to ESLint 9 flat config compatible with Next.js 16. Fixed all React 19 / Next.js 16 lint errors. |

---

## 3. Remaining Deployment Requirements (Target Environment)

Per the project completion rule, the following checks must be completed in the target production environment before the service is labeled production-ready:

1. **Production Database Migration:** Execute `npm run db:deploy` against the live production Neon instance.
2. **Initial Admin Provisioning:** Set `ADMIN_PASSWORD` in Vercel environment variables and run `npm run db:seed`. Confirm login via `/login` Admin tab.
3. **Secret Provisioning:** Verify that `AUTH_SECRET` is set to an independent 256-bit secret (`openssl rand -base64 32`) in Vercel settings.
4. **Disaster Recovery Drill:** Verify branch creation and point-in-time restore in the Neon console.
5. **Staff Pilot Cohort:** Validate end-to-end handoff workflow with campus security personnel.
