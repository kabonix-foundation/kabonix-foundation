-- Grant the MEAL / Compliance Officer operational ownership of
-- Data Collection & M&E while retaining approval and export controls.
-- This migration also updates databases that were already seeded.

INSERT INTO permissions (role_id, module, level)
SELECT r.id, 'data_collection', permission_level
FROM roles r
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('approve'), ('export')) AS levels(permission_level)
WHERE r.key = 'meal_officer'
ON CONFLICT (role_id, module, level) DO NOTHING;
