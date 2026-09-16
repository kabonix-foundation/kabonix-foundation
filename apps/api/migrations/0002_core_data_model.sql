-- 0002_core_data_model.sql  (idempotent rewrite)
-- Step 4: Shared core data entities (Section 4.1 of the architecture doc).
--
-- IMPORTANT: This migration is written to be safe against databases where
-- db.js's old initSchema() already ran and created a bare `beneficiaries`
-- table. Every structural change uses ADD COLUMN IF NOT EXISTS or
-- CREATE TABLE IF NOT EXISTS so re-running is always safe.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. HOUSEHOLDS  (must exist before beneficiaries FK references it)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS households (
  id          SERIAL PRIMARY KEY,
  reference   TEXT UNIQUE,
  location    GEOGRAPHY(POINT, 4326),
  village     TEXT,
  district    TEXT,
  region      TEXT,
  attributes  JSONB NOT NULL DEFAULT '{}',
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS households_location_idx ON households USING GIST (location);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. BENEFICIARIES  (table may already exist from db.js initSchema)
--    Add every new column with IF NOT EXISTS — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS beneficiaries (
  id         SERIAL PRIMARY KEY,
  full_name  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Columns that may already exist (village, region, phone, location, created_by)
-- or are new — all added with IF NOT EXISTS so duplicates are skipped silently.
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS external_id       TEXT UNIQUE;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS preferred_name    TEXT;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS gender            TEXT CHECK (gender IN ('male','female','non_binary','prefer_not_to_say'));
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS date_of_birth     DATE;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS phone             TEXT;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS email             TEXT;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS location          GEOGRAPHY(POINT, 4326);
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS village           TEXT;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS ward              TEXT;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS district          TEXT;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS region            TEXT;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS country           TEXT NOT NULL DEFAULT 'Tanzania';
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS programme         TEXT;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS household_id      INTEGER REFERENCES households(id);
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS is_household_head BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS attributes        JSONB NOT NULL DEFAULT '{}';
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS is_active         BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS created_by        INTEGER REFERENCES users(id);
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS updated_by        INTEGER REFERENCES users(id);
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS beneficiaries_location_idx  ON beneficiaries USING GIST (location);
CREATE INDEX IF NOT EXISTS beneficiaries_household_idx ON beneficiaries (household_id);
CREATE INDEX IF NOT EXISTS beneficiaries_region_idx    ON beneficiaries (region, district);
CREATE INDEX IF NOT EXISTS beneficiaries_name_idx      ON beneficiaries USING GIN (to_tsvector('simple', full_name));

CREATE TABLE IF NOT EXISTS beneficiaries_history (
  history_id     SERIAL PRIMARY KEY,
  beneficiary_id INTEGER NOT NULL REFERENCES beneficiaries(id) ON DELETE CASCADE,
  snapshot       JSONB NOT NULL,
  changed_by     INTEGER REFERENCES users(id),
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. ORGANISATIONS / GROUPS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organisations (
  id              SERIAL PRIMARY KEY,
  external_id     TEXT UNIQUE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL
    CHECK (type IN ('cooperative','women_group','youth_group','ngo','government','private','community_org','other')),
  registration_no TEXT,
  location        GEOGRAPHY(POINT, 4326),
  village         TEXT,
  district        TEXT,
  region          TEXT,
  contact_name    TEXT,
  contact_phone   TEXT,
  contact_email   TEXT,
  member_count    INTEGER,
  attributes      JSONB NOT NULL DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      INTEGER REFERENCES users(id),
  updated_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organisations_location_idx ON organisations USING GIST (location);
CREATE INDEX IF NOT EXISTS organisations_type_idx     ON organisations (type);

CREATE TABLE IF NOT EXISTS organisation_members (
  id              SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  beneficiary_id  INTEGER NOT NULL REFERENCES beneficiaries(id) ON DELETE CASCADE,
  role            TEXT,
  joined_at       DATE,
  exited_at       DATE,
  UNIQUE (organisation_id, beneficiary_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. PROGRAMME / PROJECT
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS programmes (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  area        TEXT NOT NULL
    CHECK (area IN ('blue_economy','carbon','agriculture','renewable_energy','youth_women','conservation','data_collection','other')),
  description TEXT,
  start_date  DATE,
  end_date    DATE,
  status      TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('design','active','completed','suspended','cancelled')),
  budget_usd  NUMERIC(14,2),
  donor       TEXT,
  lead_staff  INTEGER REFERENCES users(id),
  attributes  JSONB NOT NULL DEFAULT '{}',
  created_by  INTEGER REFERENCES users(id),
  updated_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id                  SERIAL PRIMARY KEY,
  programme_id        INTEGER NOT NULL REFERENCES programmes(id),
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  description         TEXT,
  start_date          DATE,
  end_date            DATE,
  status              TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('design','active','completed','suspended','cancelled')),
  budget_usd          NUMERIC(14,2),
  expenditure_usd     NUMERIC(14,2) DEFAULT 0,
  target_beneficiaries INTEGER,
  lead_staff          INTEGER REFERENCES users(id),
  attributes          JSONB NOT NULL DEFAULT '{}',
  created_by          INTEGER REFERENCES users(id),
  updated_by          INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_programme_idx ON projects (programme_id);

CREATE TABLE IF NOT EXISTS project_staff (
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS project_milestones (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  due_date    DATE,
  status      TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed','overdue')),
  completed_at TIMESTAMPTZ,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. SITE / PLOT  (PostGIS geometry)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sites (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER REFERENCES projects(id),
  code        TEXT UNIQUE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL
    CHECK (type IN ('mangrove','carbon_plot','farm','aquaculture','coastal_zone','village','office','other')),
  location    GEOGRAPHY(POINT, 4326),
  boundary    GEOGRAPHY(POLYGON, 4326),
  area_ha     NUMERIC(12,4),
  elevation_m NUMERIC(8,2),
  description TEXT,
  attributes  JSONB NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  INTEGER REFERENCES users(id),
  updated_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sites_location_idx ON sites USING GIST (location);
CREATE INDEX IF NOT EXISTS sites_boundary_idx ON sites USING GIST (boundary);
CREATE INDEX IF NOT EXISTS sites_project_idx  ON sites (project_id);
CREATE INDEX IF NOT EXISTS sites_type_idx     ON sites (type);

CREATE TABLE IF NOT EXISTS sites_history (
  history_id SERIAL PRIMARY KEY,
  site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  snapshot   JSONB NOT NULL,
  changed_by INTEGER REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_beneficiaries (
  site_id        INTEGER NOT NULL REFERENCES sites(id)          ON DELETE CASCADE,
  beneficiary_id INTEGER NOT NULL REFERENCES beneficiaries(id)  ON DELETE CASCADE,
  role           TEXT,
  registered_at  DATE,
  PRIMARY KEY (site_id, beneficiary_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. INDICATORS & SURVEY RESPONSES
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS indicators (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  unit          TEXT,
  sdg_target    TEXT,
  programme_area TEXT,
  data_type     TEXT NOT NULL DEFAULT 'number'
    CHECK (data_type IN ('number','text','boolean','select','date')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS survey_responses (
  id              SERIAL PRIMARY KEY,
  form_id         INTEGER REFERENCES me_forms(id),
  project_id      INTEGER REFERENCES projects(id),
  site_id         INTEGER REFERENCES sites(id),
  beneficiary_id  INTEGER REFERENCES beneficiaries(id),
  organisation_id INTEGER REFERENCES organisations(id),
  submitted_by    INTEGER NOT NULL REFERENCES users(id),
  gps_location    GEOGRAPHY(POINT, 4326),
  gps_accuracy_m  NUMERIC(8,2),
  answers_json    JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('draft','submitted','approved','rejected','flagged')),
  reviewed_by     INTEGER REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  review_note     TEXT,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS survey_responses_project_idx     ON survey_responses (project_id);
CREATE INDEX IF NOT EXISTS survey_responses_site_idx        ON survey_responses (site_id);
CREATE INDEX IF NOT EXISTS survey_responses_beneficiary_idx ON survey_responses (beneficiary_id);
CREATE INDEX IF NOT EXISTS survey_responses_gps_idx         ON survey_responses USING GIST (gps_location);
CREATE INDEX IF NOT EXISTS survey_responses_status_idx      ON survey_responses (status);

CREATE TABLE IF NOT EXISTS indicator_values (
  id                 SERIAL PRIMARY KEY,
  survey_response_id INTEGER NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  indicator_id       INTEGER NOT NULL REFERENCES indicators(id),
  numeric_value      NUMERIC,
  text_value         TEXT,
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS indicator_values_indicator_idx ON indicator_values (indicator_id);

-- Wire me_submissions.beneficiary_id FK (safe if already exists — NOT VALID skips row scan)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_me_submission_beneficiary'
      AND table_name = 'me_submissions'
  ) THEN
    ALTER TABLE me_submissions
      ADD CONSTRAINT fk_me_submission_beneficiary
      FOREIGN KEY (beneficiary_id) REFERENCES beneficiaries(id)
      NOT VALID;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. DOCUMENTS / MEDIA
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS documents (
  id                 SERIAL PRIMARY KEY,
  filename           TEXT NOT NULL,
  original_name      TEXT NOT NULL,
  mime_type          TEXT NOT NULL,
  size_bytes         BIGINT,
  storage_key        TEXT NOT NULL,
  storage_bucket     TEXT NOT NULL DEFAULT 'kabonix-documents',
  project_id         INTEGER REFERENCES projects(id),
  site_id            INTEGER REFERENCES sites(id),
  beneficiary_id     INTEGER REFERENCES beneficiaries(id),
  survey_response_id INTEGER REFERENCES survey_responses(id),
  carbon_record_id   INTEGER,
  doc_type           TEXT NOT NULL DEFAULT 'other'
    CHECK (doc_type IN ('report','photo','agreement','policy','publication','audit','mrv','other')),
  title              TEXT,
  description        TEXT,
  visibility         TEXT NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('internal','partner','public')),
  uploaded_by        INTEGER REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_project_idx ON documents (project_id);
CREATE INDEX IF NOT EXISTS documents_site_idx    ON documents (site_id);
CREATE INDEX IF NOT EXISTS documents_type_idx    ON documents (doc_type);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. CARBON RECORDS  (schema only — no UI yet)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS carbon_projects (
  id                     SERIAL PRIMARY KEY,
  project_id             INTEGER REFERENCES projects(id),
  registry_id            TEXT UNIQUE,
  standard               TEXT NOT NULL DEFAULT 'vcs'
    CHECK (standard IN ('vcs','gs','art_trees','article6','other')),
  methodology            TEXT,
  ecosystem_type         TEXT NOT NULL
    CHECK (ecosystem_type IN ('mangrove','seagrass','coastal_wetland','terrestrial_forest','other')),
  crediting_period_start DATE,
  crediting_period_end   DATE,
  status                 TEXT NOT NULL DEFAULT 'design'
    CHECK (status IN ('design','validation','registered','active','completed','suspended')),
  article6_ref           TEXT,
  attributes             JSONB NOT NULL DEFAULT '{}',
  created_by             INTEGER REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carbon_landholders (
  id                SERIAL PRIMARY KEY,
  carbon_project_id INTEGER NOT NULL REFERENCES carbon_projects(id) ON DELETE CASCADE,
  beneficiary_id    INTEGER REFERENCES beneficiaries(id),
  organisation_id   INTEGER REFERENCES organisations(id),
  site_id           INTEGER REFERENCES sites(id),
  area_ha           NUMERIC(12,4),
  agreement_date    DATE,
  agreement_doc_id  INTEGER REFERENCES documents(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (beneficiary_id IS NOT NULL OR organisation_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS mrv_records (
  id                  SERIAL PRIMARY KEY,
  carbon_project_id   INTEGER NOT NULL REFERENCES carbon_projects(id) ON DELETE CASCADE,
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  gross_emissions_t   NUMERIC(14,4),
  removals_t          NUMERIC(14,4),
  leakage_t           NUMERIC(14,4) DEFAULT 0,
  net_sequestration_t NUMERIC(14,4) GENERATED ALWAYS AS
                        (removals_t - gross_emissions_t - leakage_t) STORED,
  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','under_review','verified','rejected')),
  verifier_name       TEXT,
  verified_at         TIMESTAMPTZ,
  verification_doc_id INTEGER REFERENCES documents(id),
  credits_issued      NUMERIC(14,4),
  credits_serial_from TEXT,
  credits_serial_to   TEXT,
  methodology_data    JSONB NOT NULL DEFAULT '{}',
  created_by          INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mrv_records_project_idx ON mrv_records (carbon_project_id);

-- Wire documents.carbon_record_id FK (safe if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_document_carbon_record'
      AND table_name = 'documents'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT fk_document_carbon_record
      FOREIGN KEY (carbon_record_id) REFERENCES mrv_records(id)
      NOT VALID;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. NOTIFICATION PREFERENCES
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notification_preferences (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  email         BOOLEAN NOT NULL DEFAULT TRUE,
  sms           BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp      BOOLEAN NOT NULL DEFAULT FALSE,
  in_app        BOOLEAN NOT NULL DEFAULT TRUE,
  subscriptions JSONB NOT NULL DEFAULT '["approval_required","submission_flagged","project_milestone_due","system_alert"]',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. AUDIT LOG INDEXES
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS audit_log_entity_idx  ON audit_log (entity, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_user_idx    ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx  ON audit_log (action);
