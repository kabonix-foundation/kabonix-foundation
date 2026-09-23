-- 0011_website_cms.sql
--
-- Adds image_url to posts and impact_stories so the CMS can attach a photo
-- to each item. Partners already have logo_url from migration 0001.

ALTER TABLE posts           ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE impact_stories  ADD COLUMN IF NOT EXISTS image_url TEXT;
