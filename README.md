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

## Phase Roadmap

- [x] **Phase 0 — Foundation & Seed:** Next.js scaffold, Prisma + raw SQL migration, Auth.js session, Docker Compose (Postgres + MinIO), and `/api/v1/me` route.
- [ ] **Phase 1 — Reports & Presigned Image Pipeline:** Presigned S3 upload, `PROCESS_IMAGE` worker (EXIF stripping via `sharp`), report CRUD, full-text & trigram search.
- [ ] **Phase 2 — Deterministic Matching Engine:** `COMPUTE_MATCHES` worker, weighted multi-attribute scorer (`category`, `ts_rank_cd`, `pg_trgm`, `color/brand`, `location`, `date`), matches tab.
- [ ] **Phase 3 — Claims, Concurrency & Handoff:** Private claims (`proof_text`), single active approval lock (`FOR UPDATE`), handoff chat (`claim_messages`), and atomic resolution.
- [ ] **Phase 4 — Moderation, Audit & Release Hardening:** Flagging, moderation queue (`HIDE`/`RESTORE`/`DISMISS_FLAGS`), immutable audit logs, rate limiting, and Playwright E2E.
