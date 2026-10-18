# Deployment & GitHub Push Blueprint: Vercel & Neon PostgreSQL

**Audience:** Developer deploying FindIt (CMRIT Lost & Found) to production on Vercel  
**Scope:** Git repository initialization, GitHub push checklist, Neon/Supabase PostgreSQL configuration, Vercel environment variables, and serverless background cron setup.

---

## Step 1: Initialize Git and Push to GitHub

Run these commands in your project root terminal:

```bash
# 1. Initialize git (if not already done)
git init

# 2. Add all simplified UI and CMRIT branding changes
git add .

# 3. Commit changes
git commit -m "feat: rebrand to cmrit, simplify ui, prepare for vercel deployment"

# 4. Link your remote GitHub repository and push
git branch -M main
git remote add origin https://github.com/your-username/cmrit-lost-and-found.git
git push -u origin main
```

---

## Step 2: Set Up Managed PostgreSQL (Free Tier)

Because Vercel serverless functions require an external database connection:
1. Create a free account on [Neon.tech](https://neon.tech) or [Supabase.com](https://supabase.com).
2. Create a new PostgreSQL project named `cmrit-lost-and-found`.
3. Copy your connection strings:
   - **Pooled Connection String** (for `DATABASE_URL`): used by application queries via connection pooler (`pgbouncer` on port `6543` / `5432` with pooling).
   - **Direct Connection String** (for `DIRECT_URL`): required by Prisma migrations directly connecting to port `5432`.

---

## Step 3: Configure Vercel Deployment

1. Head to [Vercel Dashboard](https://vercel.com).
2. Click **Add New > Project** and import your `cmrit-lost-and-found` GitHub repository.
3. Keep the default build settings:
   - **Framework Preset:** Next.js
   - **Build Command:** `next build`
   - **Output Directory:** `.next`
   - **Install Command:** `npm ci` (or `npm install`)

---

## Step 4: Configure Production Environment Variables on Vercel

In your Vercel project settings under **Settings > Environment Variables**, add the following keys:

| Environment Variable | Description | Example / Source |
| :--- | :--- | :--- |
| `NODE_ENV` | Production mode flag | `production` |
| `APP_URL` | Your live Vercel deployment URL | `https://cmrit-lost-and-found.vercel.app` |
| `AUTH_SECRET` | Cryptographic secret for Auth.js v5 | Generate via `openssl rand -base64 32` |
| `DATABASE_URL` | Neon/Supabase pooled connection string | `postgresql://user:pass@ep-xyz-pooler.us-east-1.aws.neon.tech/cmrit-lost-and-found?sslmode=require` |
| `DIRECT_URL` | Neon/Supabase direct connection string | `postgresql://user:pass@ep-xyz.us-east-1.aws.neon.tech/cmrit-lost-and-found?sslmode=require` |
| `STORAGE_ENDPOINT` | S3-compatible storage endpoint | `https://s3.us-east-1.amazonaws.com` (or Cloudflare R2 / Supabase Storage S3 URL) |
| `STORAGE_REGION` | Storage region | `us-east-1` (or `auto` for Cloudflare R2) |
| `STORAGE_BUCKET` | Private bucket name | `cmrit-private-storage` |
| `STORAGE_ACCESS_KEY_ID` | Storage access key ID | `your_access_key` |
| `STORAGE_SECRET_ACCESS_KEY` | Storage secret access key | `your_secret_key` |
| `STORAGE_FORCE_PATH_STYLE` | Path-style flag for S3 (set `false` for AWS S3/R2) | `false` |
| `WORKER_SECRET` | Secret token protecting internal worker tick endpoints | Generate via `openssl rand -hex 24` |

---

## Step 5: Configure Serverless Cron Jobs (`vercel.json`)

To ensure background jobs (image EXIF sanitization and match scoring) run automatically on serverless Vercel without needing a dedicated worker VM, the project includes `vercel.json` in the root directory:

```json
{
  "crons": [
    {
      "path": "/api/v1/internal/worker/tick",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

**How it works:** Vercel automatically sends an authenticated HTTP GET ping to `/api/v1/internal/worker/tick` every 5 minutes (passing `Authorization: Bearer <CRON_SECRET>`). The endpoint processes queued tasks utilizing PostgreSQL `FOR UPDATE SKIP LOCKED` for atomic, non-blocking queue processing.

---

## Step 6: Deploy and Verify

1. Click **Deploy** in the Vercel dashboard.
2. Once the build succeeds, run database migrations against your production database:
   ```bash
   DATABASE_URL="<your_neon_direct_or_pooled_url>" DIRECT_URL="<your_neon_direct_url>" npx prisma migrate deploy
   ```
3. Seed the CMRIT organization and initial data in production:
   ```bash
   DATABASE_URL="<your_neon_url>" npx tsx prisma/seed.ts
   ```
4. Visit your live `.vercel.app` URL, navigate to `/cmrit-lost-and-found/reports`, and test the simplified UI!
