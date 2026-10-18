CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE report_type AS ENUM ('LOST', 'FOUND');
CREATE TYPE report_status AS ENUM ('OPEN', 'RESOLVED', 'WITHDRAWN', 'EXPIRED', 'HIDDEN');
CREATE TYPE claim_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'HANDOFF_CONFIRMED');
CREATE TYPE member_role AS ENUM ('MEMBER', 'MODERATOR', 'ORG_ADMIN');
CREATE TYPE image_status AS ENUM ('PENDING_UPLOAD', 'PROCESSING', 'READY', 'REJECTED');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject text UNIQUE NOT NULL,
  email text UNIQUE NOT NULL,
  display_name text NOT NULL,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  verified_email_domain text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'MEMBER',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id),
  type report_type NOT NULL,
  status report_status NOT NULL DEFAULT 'OPEN',
  category text NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 100),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 3000),
  color text,
  brand text,
  occurred_at timestamptz,
  location_label text NOT NULL CHECK (char_length(location_label) BETWEEN 2 AND 100),
  location_area text,
  search_document tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(category, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(color, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '') || ' ' || coalesce(location_label, '')), 'C')
  ) STORED,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE report_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES reports(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL REFERENCES users(id),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  raw_object_key text UNIQUE NOT NULL,
  thumb_object_key text UNIQUE,
  status image_status NOT NULL DEFAULT 'PENDING_UPLOAD',
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  width integer,
  height integer,
  sha256 text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE report_features (
  report_id uuid PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
  normalized_terms text[] NOT NULL DEFAULT '{}',
  feature_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE report_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lost_report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  found_report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  score real NOT NULL CHECK (score BETWEEN 0 AND 1),
  reasons jsonb NOT NULL DEFAULT '[]',
  algorithm_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (lost_report_id <> found_report_id),
  UNIQUE (lost_report_id, found_report_id)
);

CREATE TABLE match_feedback (
  match_id uuid NOT NULL REFERENCES report_matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dismissed boolean NOT NULL DEFAULT false,
  useful boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);

CREATE TABLE claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  claimant_id uuid NOT NULL REFERENCES users(id),
  status claim_status NOT NULL DEFAULT 'PENDING',
  proof_text text NOT NULL CHECK (char_length(proof_text) BETWEEN 10 AND 1500),
  decision_by uuid REFERENCES users(id),
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, claimant_id)
);

CREATE UNIQUE INDEX one_active_claim_per_report 
  ON claims(report_id) 
  WHERE status IN ('APPROVED', 'HANDOFF_CONFIRMED');

CREATE TABLE claim_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE moderation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 500),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACTIONED', 'DISMISSED')),
  reviewed_by uuid REFERENCES users(id),
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (report_id, reporter_id)
);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('PROCESS_IMAGE', 'COMPUTE_MATCHES', 'SEND_EMAIL', 'EXPIRE_REPORTS')),
  dedupe_key text UNIQUE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reports_feed_idx ON reports(organization_id, status, type, created_at DESC);
CREATE INDEX reports_owner_idx ON reports(owner_id, created_at DESC);
CREATE INDEX reports_search_idx ON reports USING gin(search_document);
CREATE INDEX reports_title_trgm_idx ON reports USING gin(title gin_trgm_ops);
CREATE INDEX reports_expiry_idx ON reports(expires_at) WHERE status = 'OPEN';
CREATE INDEX matches_lost_idx ON report_matches(organization_id, lost_report_id, score DESC);
CREATE INDEX matches_found_idx ON report_matches(organization_id, found_report_id, score DESC);
CREATE INDEX claims_report_idx ON claims(report_id, status, created_at DESC);
CREATE INDEX claims_claimant_idx ON claims(claimant_id, status, created_at DESC);
CREATE INDEX jobs_poll_idx ON jobs(available_at, created_at) WHERE status = 'QUEUED';
CREATE INDEX audit_entity_idx ON audit_events(organization_id, entity_type, entity_id, created_at DESC);
