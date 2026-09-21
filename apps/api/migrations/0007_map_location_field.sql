-- 0007_map_location_field.sql
--
-- Replace the two manual lat/lng number inputs on the household baseline
-- form with a single map-based location picker. The map picker writes to the
-- same answers.gps_lat / answers.gps_lng keys, so no submission data changes
-- and no server-side code that reads answers_json needs to move.
--
-- The new field is type: 'map'. Client-side, app.js's fieldHtml() renders a
-- Leaflet picker for it (see maps.js). Server-side, the validation loop in
-- server.js recognises 'map' and checks gps_lat/gps_lng instead of
-- answers.location.

UPDATE me_forms
   SET schema_json = '[
     {"id":"beneficiary_name","label":"Beneficiary full name","type":"text",    "required":true, "minLength":2, "maxLength":120},
     {"id":"village",         "label":"Village",              "type":"text",    "required":true, "minLength":2, "maxLength":80},
     {"id":"programme_area",  "label":"Programme area",       "type":"select",  "required":true, "options":["Blue Economy","Climate-smart Agriculture","Renewable Energy","Youth & Women Entrepreneurship"]},
     {"id":"household_size",  "label":"Household size",       "type":"number",  "required":true, "min":1, "max":60, "integer":true},
     {"id":"location",        "label":"Site location",        "type":"map",     "required":true},
     {"id":"notes",           "label":"Notes",                "type":"textarea","required":false,"maxLength":2000}
   ]'::jsonb
 WHERE key = 'household_baseline';
