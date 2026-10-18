# FindIt (Campus Lost & Found Platform)

Multi-tenant campus Lost-and-Found platform featuring deterministic candidate matching, privacy-preserving ownership claims, transactional handoff workflows, and scoped organization moderation.

## Tech Stack

- **Runtime & Framework:** TypeScript, Next.js (App Router), React 19
- **Styling & UI:** Tailwind CSS, PostCSS
- **Database:** PostgreSQL 16 + Prisma ORM + Raw SQL Migrations (`pgcrypto`, `pg_trgm`, `tsvector`)
- **Storage:** Private S3-Compatible Object Storage (MinIO locally / AWS S3 / Cloudflare R2 in prod)
- **Image Processing:** `sharp` for EXIF/GPS stripping and WebP thumbnail generation
- **Authentication:** Auth.js v5 (`next-auth@beta`) with JWT sessions, dev login, and Google OAuth
- **Background Worker:** PostgreSQL `jobs` table with `FOR UPDATE SKIP LOCKED`
- **Testing:** Vitest (unit/integration) and Playwright (E2E)

---

## Quickstart (Local Development)

### 1. Prerequisites
- [Node.js 22 LTS](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/)

### 2. Environment Setup
```bash
cp .env.example .env.local
cp .env.example .env
```

### 3. Start Local Infrastructure
Start PostgreSQL 16 and MinIO private S3 storage:
```bash
docker compose up -d
```

### 4. Database Migrations & Seeding
Apply migrations and seed the database with the initial campus organization (`apex-university`) and test users:
```bash
npm run db:deploy
npm run db:seed
```

### 5. Launch the Web Application
```bash
npm run dev
```
Visit [http://localhost:3000](http://localhost:3000).

### 6. Run Background Worker (Async Matching & Image Processing)
```bash
npm run worker:dev
```

### 7. Run Test Suite
```bash
npm run test
```

---

## Seed Test Accounts

The seed script creates the **Apex University** (`apex-university`) organization with 3 pre-configured users:

| Name | Email | Role | Purpose |
|---|---|---|---|
| Alice Chen | `alice@apex.edu` | `MEMBER` | Member A (Lost report poster / Claimant) |
| Bob Smith | `bob@apex.edu` | `MEMBER` | Member B (Found report poster) |
| Carol Davis | `carol@apex.edu` | `MODERATOR` | Campus Safety Office Moderator |

In development, test endpoints support the `x-test-email` header or mock dev sign-in.

---

## Phase Roadmap (All Phases Completed)

- [x] **Phase 0 — Foundation & Seed:** Next.js scaffold, Prisma + raw SQL baseline migration (`pgcrypto`, `pg_trgm`, `tsvector`), Auth.js v5 session, Docker Compose (PostgreSQL 16 + MinIO S3), and `GET /api/v1/me`.
- [x] **Phase 1 — Reports & Presigned Image Pipeline:** Presigned S3 upload (`POST /api/v1/uploads/presign`), asynchronous `PROCESS_IMAGE` worker (EXIF/GPS metadata stripping + WebP thumbnail generation via `sharp`), report CRUD, optimistic concurrency locking, and full-text (`tsvector`) + trigram (`pg_trgm`) search.
- [x] **Phase 2 — Deterministic Matching Engine:** Asynchronous `COMPUTE_MATCHES` worker with self-match guards, pure deterministic weighted multi-factor scorer (Category 0.25, Text/Trigrams 0.35, Attributes 0.15, Location 0.15, Temporal decay 0.10, threshold $\ge 0.35$), matches endpoint (`GET /api/v1/reports/[id]/matches`), and user feedback (`POST /api/v1/matches/[id]/feedback`).
- [x] **Phase 3 — Claims, Concurrency & Handoff:** Private claims submission (`POST /api/v1/reports/[id]/claims`) with self-claim prevention, inbox (`GET /api/v1/claims?box=incoming|outgoing`) with strict role-based `proof_text` privacy, transactional single active approval lock (`FOR UPDATE` row lock + partial unique index), gated post-approval handoff chat (`GET/POST /api/v1/claims/[id]/messages`), and atomic handoff confirmation (`POST /api/v1/claims/[id]/confirm-handoff`) resolving the report and auto-rejecting competing claims.
- [x] **Phase 4 — Moderation, Audit & Release Hardening:** Member report flagging with rate limiting (`POST /api/v1/reports/[id]/flag`), scoped organization moderator queue (`GET /api/v1/moderation/reports`), enforcement actions (`POST /api/v1/moderation/reports/[id]/action` - `HIDE`, `RESTORE`, `DISMISS_FLAGS`), tamper-evident append-only audit log (`audit_events` table), and comprehensive integration and full-user-journey tests.

---

## API Surface

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/v1/me` | `GET` | Required | Current user profile, active memberships, and organization roles |
| `/api/v1/reports` | `GET` | Tenant Member | Filtered report feed (full-text search, category, type, date range) |
| `/api/v1/reports` | `POST` | Tenant Member | Create LOST or FOUND report, triggers async image & match jobs |
| `/api/v1/reports/[id]` | `GET` | Tenant Member | Detail view of report (publicly sanitized, EXIF-stripped images) |
| `/api/v1/reports/[id]` | `PATCH` | Owner / Mod | Update report with optimistic concurrency check (`version`) |
| `/api/v1/reports/[id]/withdraw` | `POST` | Owner / Mod | Withdraw report from active listings |
| `/api/v1/reports/[id]/matches` | `GET` | Owner / Mod | Directional match suggestions with transparent explainability tags |
| `/api/v1/reports/[id]/claims` | `POST` | Tenant Member | Submit ownership claim with private `proof_text` (prevents self-claim) |
| `/api/v1/reports/[id]/flag` | `POST` | Tenant Member | Flag suspicious / abusive report (rate limited: 10/min) |
| `/api/v1/claims` | `GET` | Tenant Member | Incoming (as owner) or outgoing (as claimant) claims inbox |
| `/api/v1/claims/[id]/decision` | `POST` | Owner | Approve or reject claim with transactional `FOR UPDATE` concurrency lock |
| `/api/v1/claims/[id]/messages` | `GET` | Owner / Claimant | Retrieve gated handoff coordination messages (only when `APPROVED`) |
| `/api/v1/claims/[id]/messages` | `POST` | Owner / Claimant | Send handoff coordination message (only when `APPROVED`) |
| `/api/v1/claims/[id]/confirm-handoff` | `POST` | Claimant | Confirm physical item exchange; atomically marks claim `HANDOFF_CONFIRMED`, report `RESOLVED`, and auto-rejects pending claims |
| `/api/v1/matches/[id]/feedback` | `POST` | Report Owner | Dismiss match or submit relevance feedback |
| `/api/v1/moderation/reports` | `GET` | Moderator | Review open flagged reports within the organization |
| `/api/v1/moderation/reports/[id]/action` | `POST` | Moderator | Execute `HIDE`, `RESTORE`, or `DISMISS_FLAGS` and write immutable audit event |
| `/api/v1/uploads/presign` | `POST` | Tenant Member | Generate presigned S3 PUT URL for direct client upload |
| `/api/v1/internal/worker/tick` | `POST` | Worker Secret | Execute one batch of pending asynchronous background jobs (`SKIP LOCKED`) |
