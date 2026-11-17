-- ---------------------------------------------------------------
-- Task Management System - database schema (MySQL 8 / Amazon RDS)
-- ---------------------------------------------------------------
-- The application runs this file automatically at startup
-- (CREATE TABLE IF NOT EXISTS), so it is safe to run many times.

-- Registered users. The password is never stored in plain text,
-- only its bcrypt hash.
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,
  email         VARCHAR(255)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Tasks. Each task belongs to exactly one user (user_id).
-- Deleting a user also deletes their tasks (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS tasks (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED  NOT NULL,
  title        VARCHAR(200)  NOT NULL,
  description  TEXT          NULL,
  due_date     DATE          NULL,
  completed    BOOLEAN       NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMP     NULL,
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tasks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_tasks_user (user_id, completed)
);

-- File attachments. The file itself lives in Amazon S3;
-- the database only keeps the S3 object key and some metadata.
CREATE TABLE IF NOT EXISTS attachments (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id       INT UNSIGNED  NOT NULL,
  original_name VARCHAR(255)  NOT NULL,
  storage_key   VARCHAR(500)  NOT NULL,
  mime_type     VARCHAR(100)  NOT NULL,
  size_bytes    INT UNSIGNED  NOT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_attachments_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
