-- 0012_multiple_images.sql
--
-- Adds `image_urls` (JSONB array of strings) to posts and impact_stories.
-- Each item can now have multiple photos, and the public site renders them
-- as a slide preview on the card.
--
-- The old single `image_url` column is kept for backward compatibility but
-- should be treated as deprecated. New writes go to `image_urls`; this
-- migration backfills existing single images into the new array.

ALTER TABLE posts           ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE impact_stories  ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE posts
   SET image_urls = jsonb_build_array(image_url)
 WHERE image_url IS NOT NULL
   AND image_url <> ''
   AND image_urls = '[]'::jsonb;

UPDATE impact_stories
   SET image_urls = jsonb_build_array(image_url)
 WHERE image_url IS NOT NULL
   AND image_url <> ''
   AND image_urls = '[]'::jsonb;