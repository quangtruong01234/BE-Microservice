-- Remove legacy-broken Cloudinary URLs from social post image arrays.
-- Social runs with synchronize:false, so apply this manually on existing DBs.
-- Matches the historical bad URL shapes reported by FE:
--   /trybuy/posts/trybuy/posts/
--   /undefined_

UPDATE posts AS p
SET image_urls = COALESCE(
  (
    SELECT JSON_ARRAYAGG(post_image_urls.url)
    FROM JSON_TABLE(
      p.image_urls,
      '$[*]' COLUMNS (url VARCHAR(2048) PATH '$')
    ) AS post_image_urls
    WHERE LOCATE('/trybuy/posts/trybuy/posts/', post_image_urls.url) = 0
      AND LOCATE('/undefined_', post_image_urls.url) = 0
  ),
  JSON_ARRAY()
)
WHERE p.id IN (
  SELECT broken_posts.id
  FROM (
    SELECT DISTINCT source_posts.id
    FROM posts AS source_posts
    JOIN JSON_TABLE(
      source_posts.image_urls,
      '$[*]' COLUMNS (url VARCHAR(2048) PATH '$')
    ) AS broken_post_image_urls
    WHERE LOCATE('/trybuy/posts/trybuy/posts/', broken_post_image_urls.url) > 0
      OR LOCATE('/undefined_', broken_post_image_urls.url) > 0
  ) AS broken_posts
  );
