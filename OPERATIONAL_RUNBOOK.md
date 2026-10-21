# FindIt Operational Runbook: Production, Migrations, Backups & Incident Response

**System:** CMRIT Lost & Found Portal ("FindIt")
**Environment:** Production (Vercel Serverless + Neon Managed PostgreSQL)
**Classification:** Operational Guide & Emergency Runbook
**Last Updated:** October 2026

---

## 1. Environment Configuration & Secret Management

All production environment variables must be populated in the Vercel Project Dashboard (**Settings > Environment Variables**). **Never commit real credentials or keys to source control.**

### 1.1 Variable Categorization & Lifecycle Reference

Environment variables are categorized by operational requirement to prevent unnecessary credential exposure during runtime:

#### A. Runtime-Required Variables
These variables must be configured in every production deployment environment for normal web and worker operation:
- `APP_URL`: Canonical deployment domain (e.g. `https://findit.cmrit.ac.in` or Vercel production URL).
- `AUTH_SECRET`: Cryptographic secret used for HMAC-SHA256 session token generation and Auth.js JWT signing.
  > [!IMPORTANT]
  > **Entropy Guarantee:** The application code strictly validates `cleanSecret.length >= 16` (`MIN_AUTH_SECRET_LENGTH = 16`) and fails closed on startup if missing or too short. However, verifying true **256-bit entropy** is an **operational requirement** that operators must fulfill when generating the secret (e.g. `openssl rand -base64 32`). Code can only verify string length and presence.
- `DATABASE_URL`: Neon pooled database connection string (port 6543, with `?sslmode=require` and connection pooling parameters). Used for all runtime transactional queries.
- `DIRECT_URL`: Neon direct unpooled connection string (port 5432, with `?sslmode=require`).
- `WORKER_SECRET`: High-entropy Bearer token protecting background worker endpoint `/api/v1/internal/worker/tick`. Generate via `openssl rand -hex 24`.

#### B. Migration-Required Variables
- `DIRECT_URL`: Required by Prisma during migration execution (`npm run db:deploy` or `prisma migrate deploy`). Connects directly to PostgreSQL without PgBouncer pooler interference to acquire required transaction-level advisory locks.

#### C. Initial-Provisioning & Password Rotation Only (Not Required for Normal Runtime)
- `ADMIN_PASSWORD`: High-entropy initial password for administrator account `admin@cmrit.ac.in`. Only read during initial provisioning (`npm run db:seed`) or intentional credential rotation with `RESET_ADMIN_PASSWORD=true`.
  > [!CAUTION]
  > **Seed Safety Warning:** **DO NOT run `npm run db:seed` as a routine deployment or health check.** In an active production environment, running seeds unnecessarily risks data collisions, unintended re-initialization, or operational confusion. Routine deployment verification should strictly use read-only checks (e.g. `npx prisma migrate status`).
- `RESET_ADMIN_PASSWORD`: Optional temporary operational flag (`true`). When set alongside `ADMIN_PASSWORD`, triggers explicit rotation of the admin password hash during `db:seed`. Must be removed immediately after rotation.

#### D. Platform-Managed Variables
- `NODE_ENV`: Automatically managed by Vercel and hosting runtimes (`production` in production environments). Do not manually hardcode in `.env.production`.

#### E. Optional & Storage Provider Variables
Configure when external cloud object storage (S3 / Supabase Storage / MinIO) is enabled. If left unset, FindIt safely falls back to Zero-Config Database WebP storage:
- `STORAGE_ENDPOINT`: S3 endpoint URL (e.g. `https://<PROJECT_REF>.supabase.co/storage/v1/s3` or `https://s3.ap-south-1.amazonaws.com`).
- `STORAGE_BUCKET`: Private object storage bucket name (e.g. `findit-private`).
- `STORAGE_REGION`: Bucket region (e.g. `ap-south-1` or `us-east-1`).
- `STORAGE_ACCESS_KEY_ID`: Cloud storage access key ID.
- `STORAGE_SECRET_ACCESS_KEY`: Cloud storage secret access key.
- `STORAGE_FORCE_PATH_STYLE`: `true` for Supabase Storage and MinIO; `false` for AWS S3.
- `CRON_SECRET`: Optional Vercel automatic header token for Vercel Cron invocations.
- `TRUSTED_IP_HEADER`: Optional custom ingress IP header (e.g. `x-custom-ip`) if an enterprise proxy sits ahead of Vercel.

| Variable Name | Category | Security & Format Constraints |
| :--- | :--- | :--- |
| `APP_URL` | Runtime-Required | HTTPS absolute URL without trailing slash |
| `AUTH_SECRET` | Runtime-Required | Minimum 16 chars; operational requirement: 256-bit entropy (`openssl rand -base64 32`) |
| `DATABASE_URL` | Runtime-Required | Neon pooled string on port 6543 (`?sslmode=require`) |
| `DIRECT_URL` | Runtime & Migration | Neon direct unpooled string on port 5432 (`?sslmode=require`) |
| `WORKER_SECRET` | Runtime-Required | High-entropy hex token (`openssl rand -hex 24`) |
| `ADMIN_PASSWORD` | Initial-Provisioning Only | 16+ chars, uppercase, lowercase, numbers, symbols |
| `STORAGE_ENDPOINT` | Optional (Storage) | Fully qualified S3 API URL |
| `STORAGE_BUCKET` | Optional (Storage) | Private bucket name |
| `STORAGE_REGION` | Optional (Storage) | S3 region identifier |
| `STORAGE_ACCESS_KEY_ID` | Optional (Storage) | IAM / Storage service access key |
| `STORAGE_SECRET_ACCESS_KEY` | Optional (Storage) | IAM / Storage service secret key |
| `STORAGE_FORCE_PATH_STYLE` | Optional (Storage) | Boolean string (`true` or `false`) |

---

## 2. Security Controls: Application-Enforced vs. Deployment-Dependent

To ensure operational clarity, security mechanisms in FindIt are divided into controls guaranteed by application code versus controls that depend on cloud hosting configuration:

| Control Domain | Application-Enforced Control | Deployment / Hosting-Dependent Control |
| :--- | :--- | :--- |
| **Request Size & Upload Ceilings** | `createBoundedStream` stream-level byte counter aborts uploads exceeding 10MB even if `Content-Length` is missing or spoofed; Sharp rejects dimensions > 4096px / > 16.7MP. Client dropzone compresses photos to 1200px / 80% JPEG (150–350KB) and validates payload &lt; 4.0MB before direct POST. | **Vercel Gateway Limit:** Vercel automatically terminates requests > 4.5MB with HTTP 413 before serverless function execution.<br>**Direct-to-Object Fallback:** When S3 storage is configured, presigned direct S3 uploads bypass Vercel serverless limits.<br>**Self-Hosted Nginx/Docker:** Administrator must configure `client_max_body_size 10M;` at the reverse proxy. |
| **Presigned S3 Uploads & Worker Lifecycle** | Signs `ContentType` and `ContentLength: byteSize` in presigned PUT (`PutObjectCommand`). Background worker performs pre-download metadata inspection via `headObject(rawObjectKey)`; rejects and purges objects &gt; 10MB without downloading. Incremental bounded stream reader (Node `AsyncIterable` &amp; Web `ReadableStream`) terminates chunk-by-chunk at 10MB; streamed oversize errors are classified as terminal (`REJECTED`) without endless retries. Magic bytes signature verification enforces MIME match. Sharp strips EXIF/GPS and enforces 4096px / 16.7MP limits. Unprocessed raw objects are purged from storage upon thumbnail generation. `/api/v1/images/[id]` strictly forbids serving raw objects. | **Two Distinct Defense Phases:**<br>1. *Upload-Time Best-Effort Rejection:* In AWS S3, a presigned PUT with signed `Content-Length` header rejects mismatched body lengths with HTTP 403 at upload time. In Supabase Storage or MinIO, bucket configuration max size handles upload-time rejection.<br>2. *Post-Upload Authoritative Defense:* The worker performs pre-download `headObject` metadata inspection and chunk-by-chunk bounded stream reading (`createBoundedStream`), which terminates as `REJECTED` and cleans the storage object, guaranteeing defense even if upload-time checks are bypassed.<br>**Provider-Specific Storage Configuration:**<br>- *Supabase Storage:* Configure bucket-level Max File Size (10MB) via Supabase Dashboard &gt; Storage &gt; Bucket Settings.<br>- *AWS S3:* Standard AWS S3 buckets do not provide a generic bucket-level max file size setting; size constraints rely on signed `Content-Length` PUT headers, IAM permissions, and application bounded streams.<br>**AWS IAM Policy Permissions:**<br>The IAM user/role requires `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` on `arn:aws:s3:::<BUCKET>/*` (plus `s3:ListBucket` on the bucket ARN). *Note:* There is no separate `s3:HeadObject` IAM action in AWS; `HeadObject` calls are authorized by `s3:GetObject`. |
| **Storage Deletion Reliability & Durable Retries** | `storageAdapter.deleteObject()` guarantees reliable outcome reporting: treats successful deletion and confirmed absent objects (404 / NoSuchKey / NotFound) as idempotent success; surfaces transient provider errors (500, 503, timeouts) without swallowing; throws when storage is unconfigured.<br>`cleanupAbandonedUploads()` discovers all unpurged remote objects including attached rejected images where *either* `rawObjectKey` starts with `raw/` or `thumbObjectKey` starts with `thumb/`. If raw object deletion succeeds but thumbnail deletion fails (or vice versa), the successfully purged key is marked `purged:${id}` while the unpurged key is retained for subsequent sweep retries, preventing partial deletion from stranding the remaining object. For attached images (`reportId !== null`), the database row is strictly preserved to protect report integrity. For unattached uploads (`reportId === null`), the database row is deleted only after all remote objects are confirmed deleted or absent.<br>`handleProcessImage()` retains rawObjectKey on failure, enqueuing a durable `PURGE_STORAGE_OBJECT` job whose enqueue errors are visible/retryable. Retries skip reprocessing as valid upload but retry raw-object deletion.<br>`handlePurgeStorageObject()` throws on provider/unconfigured errors so the runner retries, only marking purged upon confirmed deletion or absence. | **Storage Provider Availability & Sweeps:** Transient S3 outages or rate limits will pause object deletion without data loss or key loss. Sweeps running on the configured worker tick (daily in `vercel.json` for Hobby compatibility, or 15-minute on Pro / external scheduler) and durable database jobs automatically retry deletions once the storage provider recovers. If storage credentials change, re-enable `STORAGE_ENDPOINT` in Vercel to resume purges. |
| **Abuse & Rate Limiting (IP Trust)** | In-memory sliding-window limiter bounded to 5,000 entries (prevents node OOM). Trust boundary: accepts only verified edge headers (`x-vercel-forwarded-for` or explicitly configured `TRUSTED_IP_HEADER`). Returns explicit `'unknown'` for untrusted/spoofable headers (`cf-connecting-ip`, `x-real-ip`, raw `x-forwarded-for`). Process-local defense-in-depth. | **Edge WAF & Distributed Limiting:** Because serverless lambdas do not share memory across instances, cluster-wide volumetric mitigation requires **Vercel Firewall / WAF Rate Limiting** or Upstash Redis.<br>**External Proxies/CDNs:** If an external proxy (e.g. Cloudflare) sits in front of Vercel, `x-vercel-forwarded-for` reflects the proxy IP; set `TRUSTED_IP_HEADER` or configure edge forwarding rules. |
| **Authentication & Tokens** | HMAC-SHA256 signed session tokens; rejects future-dated tokens (>60s clock skew) and expired tokens (>30d); timing-safe comparison; fails closed if `AUTH_SECRET` is missing or below minimum length (`MIN_AUTH_SECRET_LENGTH = 16`). | **Secret Entropy Requirement:** Administrator must generate and set an independent 256-bit `AUTH_SECRET` in Vercel settings (`openssl rand -base64 32`). Application code verifies string length &gt;= 16 and presence, but cannot verify cryptographic entropy. |
| **Claimant PII Protection** | Claimant email masked (`undefined`) on pending/rejected claims in both API services and Server Component render paths; revealed only to owner upon approval. | **Log Sanitization:** Ensure hosting log drains (e.g. Datadog, Axiom) do not log sensitive request parameters. |
| **Database Transactions & Concurrency** | PostgreSQL `FOR UPDATE` row locks guarantee single active claim approval and atomic report resolution during physical handoffs. | **Connection Pooling:** Administrator must configure `DATABASE_URL` pointing to PgBouncer pooler (port 6543) and `DIRECT_URL` pointing to direct instance (port 5432). |

---

## 3. Administrator Provisioning & Rotation Procedures

Production security strictly forbids default or hardcoded administrative credentials, and ensures that general re-seeding operations cannot silently reset passwords.

### 3.1 Initial One-Time Provisioning
1. **Set `ADMIN_PASSWORD` in Deployment Environment:** Generate a high-entropy secret (`openssl rand -base64 18`) and configure `ADMIN_PASSWORD` in Vercel environment variables.
2. **Execute Initial Seed:**
   ```bash
   npm run db:deploy
   npm run db:seed
   ```
   The seed script detects that no administrator exists and creates `admin@cmrit.ac.in` with `ORG_ADMIN` clearance.
3. **Verify Admin Clearance:**
   - Sign into `/login` using the **"Admin Login"** tab.
   - Confirm immediate redirection to `/[orgSlug]/moderation`.

### 3.2 Re-Seeding Safety Guard & Prohibition on Routine Seeding
> [!CAUTION]
> **Prohibition on Routine Production Seeding:** **DO NOT run `npm run db:seed` as a routine deployment step, health check, or post-migration script.**
> Running seeds unnecessarily against a live production database risks operational confusion, duplicate key warnings, or accidental credential resets. To verify schema readiness in production, operators should strictly use read-only inspection:
> ```bash
> npx prisma migrate status
> ```
> The seed script includes a protective guard: if an admin already exists and `RESET_ADMIN_PASSWORD` is not explicitly set, `db:seed` preserves existing admin credentials without modification and logs:
> `[Seed] Existing admin account preserved without resetting password.`

### 3.3 Deliberate Credential Rotation Procedure
When administrator credentials must be rotated:
1. Update `ADMIN_PASSWORD` in your deployment environment settings to the new value.
2. Set temporary flag: `RESET_ADMIN_PASSWORD=true`.
3. Execute `npm run db:seed`. The seed script verifies the explicit flag and rotates `password_hash`.
4. Remove or unset `RESET_ADMIN_PASSWORD` in the environment settings after rotation completes.

---

## 4. Database Migrations & Schema Deployment

FindIt uses Prisma with raw SQL extensions (`pgcrypto`, `pg_trgm`, `tsvector`).

### 4.1 Applying Migrations
- **Local / Preview:**
  ```bash
  npm run db:migrate
  ```
- **Production Deployment:**
  ```bash
  npm run db:deploy
  ```
  *Note:* `db:deploy` connects via `DIRECT_URL` (port 5432) to acquire migration advisory locks without pooler interference.

### 4.2 Idempotent Schema Guards
The seed and startup routines verify that required schema columns (such as `password_hash` on `users`) exist. If manual reconciliation is required:
```bash
npm run db:schema:fix
```

---

## 5. Database Backup & Disaster Recovery (Neon.tech)

Neon PostgreSQL provides automatic Continuous Archiving & Point-In-Time Restore (PITR) alongside instant branch-based snapshots.

### 5.1 Scheduled & On-Demand Snapshots
1. **Neon Console Snapshots:**
   - Log into the [Neon Console](https://console.neon.tech).
   - Navigate to the `cmrit-lost-and-found` project.
   - Create a branch snapshot prior to any major production schema change or data migration.
2. **Logical Dump (`pg_dump`):**
   ```bash
   # Export full database schema and data
   pg_dump "$DIRECT_URL" --format=custom --file="findit-backup-$(date +%Y%m%d%H%M).dump"
   ```

### 5.2 Point-In-Time Recovery Procedure
If accidental data loss or corruption occurs:
1. In the Neon Console, click **Restore to a point in time**.
2. Select the exact timestamp prior to the incident (e.g., 5 minutes before corruption).
3. Provision the restored branch as the new primary or point `DATABASE_URL` / `DIRECT_URL` in Vercel to the restored endpoint.
4. Verify application connectivity via `GET /api/v1/me`.

---

## 6. Rollout Strategy & Production Deployment

1. **Stage 1: Internal Security Validation (Staging / Branch Deployment)**
   - Deploy release commit to a password-protected Vercel Preview environment.
   - Run typecheck, unit tests, and smoke tests against a test database.
2. **Stage 2: Pilot Rollout (Campus Security & Floor Wardens)**
   - Provision accounts for 5 campus security officers.
   - Exercise dual-action flows: posting found items from security desk, verifying claims, and testing physical handoff at the reception desk.
3. **Stage 3: Full Campus Availability**
   - Announce portal to `@cmrit.ac.in` students and faculty.
   - Monitor rate-limit counters and serverless error rates.

---

## 7. Rollback Procedures

If critical defects or regressions are discovered in production:
1. **Instant Vercel Instant Rollback:**
   - Go to **Vercel Dashboard > Deployments**.
   - Locate the previous stable production deployment.
   - Click **Instant Rollback**. Traffic is shifted within seconds.
2. **Database Rollback:**
   - Prisma migrations are strictly forward-only. If a schema change needs rollback, apply a compensating migration rather than editing past migration files.

---

## 8. Incident Handling & Security Protocols

### 8.1 Compromised Account / Abuse Protocol
If an account is flagged for spam or fraudulent claims:
1. Navigate to `/cmrit-lost-and-found/moderation`.
2. Locate the offending report and click **Hide Listing**.
3. Disable the user account immediately to prevent future sessions:
   ```typescript
   await prisma.user.update({
     where: { email: 'offending_user@cmrit.ac.in' },
     data: { disabledAt: new Date() }
   });
   ```
   *Any existing session tokens for this user will immediately fail `getSessionUser` verification.*

### 8.2 Accidental PII Exposure Protocol
If a student inadvertently posts sensitive PII (e.g., credit card number or full national ID) in a public description or photo:
1. Moderator immediately marks report **HIDDEN**.
2. Moderator edits or permanently withdraws the report.
3. If an image contains sensitive data, purge the image row from `report_images` and delete the object from the S3 storage bucket.

---

## 9. Fair Abandoned-Upload & Orphaned-Object Sweeper Operations

FindIt runs a background sweeper (`uploadsService.cleanupAbandonedUploads()`) invoked during worker ticks or scheduled cron jobs to safely reclaim orphaned and abandoned object storage.

### 9.1 Core System Invariants
Every code path touching uploads, jobs, and storage adheres to these strict invariants:
1. **Confirmation Before Purge:** No image may be marked purged in the database until cloud storage confirms deletion (HTTP 204) or confirms the object is already absent (404 / `NoSuchKey` / `NotFound`).
2. **Key & Record Preservation:** Failed or unconfigured storage deletion must preserve the object key and durable database record. Provider errors must never be swallowed to mark work complete.
3. **Report Integrity:** Attached report-image rows (`reportId !== null`) are **never deleted** from the database by orphan cleanup; only lingering remote storage objects are purged, and keys are updated to `purged:${id}` with `cleanupAttempts: 0` and `nextRetryAt: null` once confirmed deleted or absent.
4. **Terminal Rejection:** Rejected images may be cleaned up from storage, but must never be reprocessed as valid images.
5. **Fair Scheduling & Bounded Backoff:** Failed cleanup must be scheduled durably with bounded exponential backoff (`nextRetryAt`); other eligible records must continue to make progress without head-of-line blocking or batch starvation.
6. **Non-Swallowing Fault Tolerance:** Storage errors, database errors, job enqueue failures, and cleanup failures must not be swallowed in a way that marks work complete or loses the only object key.
7. **Idempotency:** Cleanup routines and job handlers must be strictly idempotent under retries and concurrent worker ticks.
8. **Independent Partial Deletion Safety:** Rejected images remain eligible for cleanup while *either* `rawObjectKey` or `thumbObjectKey` remains remotely stored. If one object purge succeeds while the other fails, the succeeded object key is updated to `purged:${id}` while the unpurged key is preserved for subsequent sweep retries, preventing partial deletion from stranding orphans.

### 9.2 Backlog Metrics vs. Processing Eligibility
FindIt strictly separates the database predicate for candidate execution from the predicate for operational telemetry:
- **Outstanding Backlog Predicate (`buildOutstandingCleanupWhere`):** Matches all images requiring cleanup across the database (unattached expired pending uploads, unattached rejected uploads, lingering raw objects for READY images, unpurged raw objects for REJECTED images (`rawObjectKey: { startsWith: 'raw/' }`), and unpurged thumbnails for REJECTED images (`thumbObjectKey: { startsWith: 'thumb/' }`)). It does **not** restrict `nextRetryAt`, ensuring records undergoing backoff are counted in `totalBacklog`, `failedAttemptsCount`, and contribute to `oldestPendingAgeSeconds`.
- **Eligible Work Predicate (`buildEligibleCleanupWhere`):** Restricts the outstanding backlog to records whose retry time is null or due (`nextRetryAt: null` or `nextRetryAt: { lte: now }`). This predicate is used exclusively by `prisma.reportImage.findMany` to select the current bounded batch (`batchSize: 50`), ensuring failing records in backoff do not starve healthy candidates.
- **Fail-Safe Telemetry Availability (`metricsAvailable`):** If operational metric queries fail (e.g. transient database timeout), `getCleanupMetrics()` sets `metricsAvailable: false` with null counters (`totalBacklog: null, failedAttemptsCount: null, oldestPendingAgeSeconds: null`) and logs an explicit warning. This prevents metric query failures from ever being silently misread by dashboards or operators as zero backlog.

### 9.3 Worker Cadence, Cron Plan Limits & Deployment Options
The background runner endpoint `/api/v1/internal/worker/tick` executes background jobs and calls `uploadsService.cleanupAbandonedUploads()`.

#### A. Vercel Plan Limits & Configuration Alignment
- **Committed Configuration (`vercel.json`):**
  ```json
  {
    "crons": [
      {
        "path": "/api/v1/internal/worker/tick",
        "schedule": "0 0 * * *"
      }
    ]
  }
  ```
  *The repository defaults to `"0 0 * * *"` (daily at 00:00 UTC) to ensure baseline compatibility with Vercel Hobby accounts. Vercel strictly enforces a maximum frequency of once per day on Hobby accounts; deploying a sub-daily cron expression (such as `*/15 * * * *`) on Hobby causes Vercel deployments to fail at build time with an invalid schedule error.*

- **Operational Impact of Daily Cadence:**
  - Abandoned unattached uploads and lingering raw objects remain in cloud storage for up to 24 hours before the daily sweep reclaims them.
  - Queued background jobs (`PROCESS_IMAGE`, `COMPUTE_MATCHES`, `PURGE_STORAGE_OBJECT`) wait for the daily tick if triggered solely by cron (inline application actions and direct worker pings process them sooner).

- **15-Minute Cadence Options:**
  1. **Vercel Pro / Enterprise Accounts:** Sub-daily cron execution is fully supported down to 1 minute. Update `vercel.json` to:
     ```json
     {
       "crons": [
         {
           "path": "/api/v1/internal/worker/tick",
           "schedule": "*/15 * * * *"
         }
       ]
     }
     ```
  2. **External Scheduler for Hobby / Self-Hosted:** Set up an external cron dispatcher (e.g. GitHub Actions, Upstash QStash, or Cron-job.org) running every 15 minutes to trigger:
     ```http
     GET https://<APP_DOMAIN>/api/v1/internal/worker/tick
     Authorization: Bearer <WORKER_SECRET>
     ```

#### B. Failure & Durable Recovery Semantics
- **No Automatic Cron Retries:** Vercel Cron dispatches HTTP GET requests on a best-effort basis without automatic retries upon serverless timeout or HTTP failure.
- **Durable State Invariant:** Work is never lost if a cron tick is missed or fails. All queued jobs (`jobs` table with `status = 'QUEUED'`) and sweeper retry items (`report_images` table with `next_retry_at`) reside durably in PostgreSQL. When the next invocation occurs, `jobRunner.tick()` uses PostgreSQL `FOR UPDATE SKIP LOCKED` to atomically lock and process all pending eligible work.

#### C. Deployment Verification Checklist
Before declaring the worker active in production:
1. [ ] **Verify Cron Schedule:** Check Vercel Dashboard (**Project Settings > Cron Jobs**) and confirm the scheduled path is `/api/v1/internal/worker/tick`.
2. [ ] **Configure Worker Secret:** Set `WORKER_SECRET` (and `CRON_SECRET`) in Vercel Environment Variables.
3. [ ] **Check Invocations:** In the Vercel Dashboard (**Monitoring > Logs**), filter by `/api/v1/internal/worker/tick` and verify responses return HTTP 200 with `{ data: { processed: ..., errors: 0, jobs: { ... }, cleanup: { ... } } }`.
4. [ ] **Alert on Missed Ticks:** Configure an alert in your monitoring service (e.g. Datadog, Axiom, or Sentry) triggering if `/api/v1/internal/worker/tick` returns HTTP 403 or 500, or fails to execute within the expected time window.

#### D. Worker Response Observability, Failure Codes & Cleanup Isolation
The worker endpoint exposes a structured JSON payload separating job queue processing from storage cleanup status:
```json
{
  "data": {
    "processed": 4,
    "errors": 0,
    "jobs": {
      "processed": 4,
      "errors": 0
    },
    "cleanup": {
      "success": true,
      "cleanedCount": 2,
      "failedCount": 0,
      "processedInBatch": 2,
      "metricsAvailable": true,
      "totalBacklog": 0,
      "failedAttemptsCount": 0,
      "oldestPendingAgeSeconds": null
    }
  }
}
```

> [!IMPORTANT]
> **HTTP 200 Does Not Prove Cleanup Success:**
> The worker endpoint returns HTTP 200 whenever the worker request completes without an unhandled server crash, even if individual storage object deletions failed or the sweep encountered backoff conditions. **A successful HTTP status code alone does not prove that cleanup succeeded.** Automated synthetic monitoring and human operators must explicitly check:
> 1. `data.cleanup.success`: Must be `true`. Evaluates to `false` if the sweep threw an error or if any storage deletion failed (`failedCount > 0`).
> 2. `data.cleanup.failedCount`: Number of candidate images whose storage deletion failed in this tick. Must be `0` for healthy operations.
> 3. `data.cleanup.metricsAvailable`: Must be `true`. If database metric queries fail or time out, `metricsAvailable` is `false` and backlog counts are reported as `null` (never silently reported as `0`).
> 4. `data.cleanup.error`: When failures occur, this field returns a stable sanitized error code:
>    - `'STORAGE_DELETION_FAILED'`: Set when the sweep executed but one or more individual candidate storage deletions failed (`failedCount > 0`).
>    - `'CLEANUP_SWEEP_FAILED'`: Set when the top-level sweep execution threw an exception before or during batch processing.
>    - `undefined`: Omitted entirely when `success` is `true`.
>    - **Zero Data Exposure Guarantee:** This field **never** contains raw exception text, stack traces, object keys, bucket URLs, database connection strings, credentials, or provider response bodies. Operators should inspect server logs for sanitized error categories (`errorName`, `errorCode`).

### 9.4 Health & Alert Thresholds
Configure alerts on structured JSON log events with message `"Abandoned upload and orphaned object sweep completed"`:
- **WARNING — Elevated Backlog:** `totalBacklog > 200` or `oldestPendingAgeSeconds > 86400` (older than 24 hours). Indicates storage throughput bottleneck or high upload abandonment rate.
- **CRITICAL — Storage Outage / Starvation:** `failedAttemptsCount > 50` or any record reaching `cleanupAttempts >= 5`. Indicates persistent S3 authorization, network, or bucket-permission failure. Verify `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, and `STORAGE_ENDPOINT` credentials in Vercel settings.
- **Zero-Leak Guarantee:** Operational telemetry and log outputs strictly omit storage signed URLs, raw object keys, database credentials, and user PII.

---

## 10. Operator End-to-End Verification Procedure (Staging First)

To verify all security boundaries, transaction locks, and image storage workflows without impacting production data integrity:

### 10.1 Staging Environment Execution (Recommended)
1. **Provision Staging Environment:**
   - Deploy the build to a Vercel Preview environment connected to a separate Neon database branch.
   - Configure staging credentials (`AUTH_SECRET`, `WORKER_SECRET`, `STORAGE_*`).
2. **Execute Initial Seed & Admin Sign-in:**
   ```bash
   npm run db:deploy
   npm run db:seed
   ```
   - Log into `/login` via the **"Admin Login"** tab using `admin@cmrit.ac.in`. Confirm redirection to `/[orgSlug]/moderation`.
3. **Submit Test Report with Image:**
   - Sign in as a regular student (`student1@cmrit.ac.in`).
   - Create a found report at `/[orgSlug]/reports/new` with an uploaded photo.
   - Verify:
     - Client-side dropzone compresses and uploads the image.
     - Background worker processes thumbnail to WebP and sets image status to `READY`.
     - Direct image access `/api/v1/images/[id]` serves WebP thumbnail only, never the raw upload.
4. **Submit Claim & Verify Privacy:**
   - Sign in as a second student (`student2@cmrit.ac.in`).
   - Submit a claim on the item with answers and contact details.
   - Verify:
     - Owner view masks claimant email on pending claims.
     - Moderator view masks claimant email on pending claims.
5. **Approve Claim & Physical Handoff:**
   - Report owner approves the claim.
   - Verify claimant email is now revealed to owner.
   - Complete physical handoff using single-use handoff PIN.
   - Verify report status transitions atomically to `RESOLVED`.
6. **Trigger Worker Sweep:**
   - Call `GET /api/v1/internal/worker/tick` with `Authorization: Bearer <WORKER_SECRET>`.
   - Verify response has `cleanup.success: true` and 0 errors.

### 10.2 Production Environment Verification Constraints
> [!WARNING]
> **Production Testing Safety Rule:** **Never execute synthetic end-to-end tests or dummy reports in production without an approved maintenance window.**
> Creating dummy reports in production pollutes public campus listings, triggers real email notifications, and creates unwanted database records.
>
> If testing must occur in production during a maintenance window:
> 1. Use dedicated test accounts clearly prefixed with `ops-test@cmrit.ac.in`.
> 2. Immediately mark any test reports as **HIDDEN** via the moderation console or withdraw them.
> 3. Verify the background worker sweeps any associated storage objects cleanly.
