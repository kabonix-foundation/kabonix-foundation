-- 0006_data_quality.sql — Data Standards & Quality (Section 4.2)
--
-- Note: originally drafted as 0005, but 0005_meal_data_collection_permissions.sql
-- already exists in this repo. Renumbered to 0006.
--
-- Also note: `indicators`, `sites` and `organisations` already exist (created
-- in 0002 with their own schemas). This migration EXTENDS them rather than
-- recreating them, and is fully idempotent — safe to run on any database that
-- already has 0001–0005 applied.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. EXTEND INDICATORS with MEAL-framework columns
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE indicators ADD COLUMN IF NOT EXISTS meal_reference TEXT;
ALTER TABLE indicators ADD COLUMN IF NOT EXISTS direction      TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'indicators_direction_chk'
  ) THEN
    ALTER TABLE indicators
      ADD CONSTRAINT indicators_direction_chk
      CHECK (direction IS NULL OR direction IN ('increase','decrease','neutral'));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. FORM FIELD → INDICATOR MAPPING
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS form_field_indicators (
  form_id      INT  NOT NULL REFERENCES me_forms(id)   ON DELETE CASCADE,
  field_id     TEXT NOT NULL,
  indicator_id INT  NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
  PRIMARY KEY (form_id, field_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. VERSIONED SUBMISSIONS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS me_submission_revisions (
  id             SERIAL PRIMARY KEY,
  submission_id  INT  NOT NULL REFERENCES me_submissions(id) ON DELETE CASCADE,
  revision_no    INT  NOT NULL,
  answers_json   JSONB NOT NULL,
  change_summary TEXT,
  changed_by     INT REFERENCES users(id),
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id, revision_no)
);
CREATE INDEX IF NOT EXISTS me_submission_revisions_sub_idx
  ON me_submission_revisions (submission_id, revision_no DESC);

-- Backfill: every existing submission becomes revision 1.
INSERT INTO me_submission_revisions (submission_id, revision_no, answers_json, changed_by, change_summary)
SELECT s.id, 1, s.answers_json, s.submitted_by, 'initial submission'
FROM me_submissions s
WHERE NOT EXISTS (
  SELECT 1 FROM me_submission_revisions r WHERE r.submission_id = s.id
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. DE-DUP: BENEFICIARIES
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS name_normalised TEXT;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS de_dup_hash      TEXT;
CREATE INDEX IF NOT EXISTS beneficiaries_de_dup_hash_idx ON beneficiaries (de_dup_hash);

UPDATE beneficiaries
   SET name_normalised = lower(btrim(regexp_replace(full_name, '\s+', ' ', 'g')))
 WHERE name_normalised IS NULL AND full_name IS NOT NULL;

UPDATE beneficiaries
   SET de_dup_hash = md5(
         lower(btrim(regexp_replace(full_name, '\s+', ' ', 'g'))) || '|' ||
         lower(btrim(coalesce(village, '')))
       )
 WHERE de_dup_hash IS NULL AND full_name IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. DE-DUP: SITES AND ORGANISATIONS
-- ═══════════════════════════════════════════════════════════════════════════

-- `sites` (0002) has name/location/type but not village/district/region.
-- Add them so sites carry the same geographic descriptors as beneficiaries
-- and organisations, and so the de-dup index below can scope by district.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS village  TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS region   TEXT;

ALTER TABLE sites         ADD COLUMN IF NOT EXISTS name_normalised TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS name_normalised TEXT;

UPDATE sites
   SET name_normalised = lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
 WHERE name_normalised IS NULL AND name IS NOT NULL;

UPDATE organisations
   SET name_normalised = lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
 WHERE name_normalised IS NULL AND name IS NOT NULL;

-- Same village name in two districts is legitimately two different sites.
-- COALESCE keeps the index usable when district hasn't been filled in yet.
CREATE UNIQUE INDEX IF NOT EXISTS sites_name_district_uidx
  ON sites (name_normalised, COALESCE(district, ''));

CREATE UNIQUE INDEX IF NOT EXISTS organisations_name_uidx
  ON organisations (name_normalised);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. SEED THE STANDARD INDICATOR SET
-- ═══════════════════════════════════════════════════════════════════════════
-- Columns used match the existing indicators schema plus the two columns
-- added above. programme_area uses the same keys as the programmes table
-- so future roll-ups can join on area.

INSERT INTO indicators
  (code, name, description, unit, sdg_target, programme_area, data_type, meal_reference, direction)
VALUES
  ('MEAL-IND-001', 'Beneficiaries reached',  'Distinct beneficiaries registered in the reporting period', 'people',     '1.4',  'community',        'number', 'MEAL-OUTPUT-01',  'increase'),
  ('MEAL-IND-002', 'Household size',         'Average persons per registered household',                  'persons',    NULL,   'community',        'number', 'MEAL-OUTPUT-02',  'neutral'),
  ('MEAL-IND-003', 'Women beneficiaries',    'Share of registered beneficiaries who are women',            '%',          '5.5',  'youth_women',      'number', 'MEAL-OUTCOME-01', 'increase'),
  ('MEAL-IND-004', 'Villages covered',       'Distinct sites with at least one active beneficiary',        'sites',      '11.a', 'community',        'number', 'MEAL-OUTPUT-03',  'increase'),
  ('MEAL-IND-005', 'Mangrove area restored', 'Hectares of mangrove under active restoration',              'ha',         '14.2', 'blue_economy',     'number', 'MEAL-OUTCOME-02', 'increase'),
  ('MEAL-IND-006', 'CO2-eq sequestered',     'Verified sequestration attributable to programme sites',     'tCO2e',      '13.2', 'carbon',           'number', 'MEAL-OUTCOME-03', 'increase'),
  ('MEAL-IND-007', 'Solar households',       'Households with installed solar home systems',               'households', '7.1',  'renewable_energy', 'number', 'MEAL-OUTCOME-04', 'increase'),
  ('MEAL-IND-008', 'Women trained',          'Women completing business or technical training',            'people',     '8.3',  'youth_women',      'number', 'MEAL-OUTPUT-04',  'increase')
ON CONFLICT (code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. LINK household_baseline FIELDS TO STANDARD INDICATORS
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO form_field_indicators (form_id, field_id, indicator_id)
SELECT f.id, m.field_id, i.id
FROM me_forms f
CROSS JOIN (VALUES
  ('beneficiary_name', 'MEAL-IND-001'),
  ('village',          'MEAL-IND-004'),
  ('household_size',   'MEAL-IND-002')
) AS m(field_id, indicator_code)
JOIN indicators i ON i.code = m.indicator_code
WHERE f.key = 'household_baseline'
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. ADD VALIDATION CONSTRAINTS TO THE DEMO FORM SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════
-- Only touches the row if it doesn't already carry the new keys, so re-runs
-- are safe and admin edits are preserved.

UPDATE me_forms
   SET schema_json = '[
     {"id":"beneficiary_name","label":"Beneficiary full name","type":"text",    "required":true, "minLength":2, "maxLength":120},
     {"id":"village",         "label":"Village",              "type":"text",    "required":true, "minLength":2, "maxLength":80},
     {"id":"programme_area",  "label":"Programme area",       "type":"select",  "required":true, "options":["Blue Economy","Climate-smart Agriculture","Renewable Energy","Youth & Women Entrepreneurship"]},
     {"id":"household_size",  "label":"Household size",       "type":"number",  "required":true, "min":1, "max":60, "integer":true},
     {"id":"gps_lat",         "label":"GPS latitude",         "type":"number",  "required":false,"min":-90,  "max":90},
     {"id":"gps_lng",         "label":"GPS longitude",        "type":"number",  "required":false,"min":-180, "max":180},
     {"id":"notes",           "label":"Notes",                "type":"textarea","required":false,"maxLength":2000}
   ]'::jsonb
 WHERE key = 'household_baseline'
   AND schema_json::text NOT LIKE '%"minLength"%';
