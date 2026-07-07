-- F5: post moderation actions (admin review/resolve flow)
-- Adds a resolvable status to report rows and a hidden flag to posts.

ALTER TABLE post_reports
  ADD COLUMN status ENUM('pending', 'resolved', 'dismissed') NOT NULL DEFAULT 'pending',
  ADD COLUMN resolved_by INT NULL,
  ADD COLUMN resolved_at TIMESTAMP NULL,
  ADD INDEX idx_post_reports_status (status);

ALTER TABLE posts
  ADD COLUMN is_hidden TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN hidden_at TIMESTAMP NULL;
