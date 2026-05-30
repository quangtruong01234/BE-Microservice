CREATE TABLE IF NOT EXISTS posts (
  id          INT          NOT NULL AUTO_INCREMENT,
  user_id     INT          NOT NULL,
  content     TEXT         NOT NULL,
  image_url   VARCHAR(500) NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS likes (
  id         INT       NOT NULL AUTO_INCREMENT,
  user_id    INT       NOT NULL,
  post_id    INT       NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_likes_user_post (user_id, post_id),
  INDEX idx_likes_post_id (post_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS comments;
CREATE TABLE comments (
  id         INT            NOT NULL AUTO_INCREMENT,
  post_id    INT            NOT NULL,
  user_id    INT            NOT NULL,
  content    VARCHAR(1000)  NOT NULL,
  created_at TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mpath      VARCHAR(255)   NOT NULL DEFAULT '',
  parentId   INT            NULL,
  PRIMARY KEY (id),
  INDEX idx_comments_post_id (post_id),
  FOREIGN KEY (parentId) REFERENCES comments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
