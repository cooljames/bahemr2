CREATE TABLE IF NOT EXISTS companies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  type       TEXT    NOT NULL DEFAULT 'other',
  contact    TEXT,
  memo       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL UNIQUE,
  password   TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  role       TEXT    NOT NULL DEFAULT 'pending',
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS boards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT,
  type        TEXT    NOT NULL DEFAULT 'general',
  access_role TEXT    NOT NULL DEFAULT 'all',
  write_role  TEXT    NOT NULL DEFAULT 'all',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id    INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES users(id),
  company_id  INTEGER REFERENCES companies(id),
  title       TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'submitted',
  assigned_to INTEGER REFERENCES users(id),
  is_pinned   INTEGER NOT NULL DEFAULT 0,
  view_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reception_data (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id             INTEGER NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
  patient_name        TEXT,
  patient_dob         TEXT,
  patient_gender      TEXT,
  patient_phone       TEXT,
  patient_nationality TEXT,
  id_type             TEXT,
  id_number           TEXT,
  chief_complaint     TEXT,
  symptoms            TEXT,
  exam_results        TEXT,
  vessel_name         TEXT,
  port_of_call        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id),
  content    TEXT    NOT NULL,
  parent_id  INTEGER REFERENCES comments(id),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0
);

-- file_data: Base64 인코딩된 파일 바이너리 (R2 대신 D1에 직접 저장)
CREATE TABLE IF NOT EXISTS attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  uploader_id INTEGER NOT NULL REFERENCES users(id),
  filename    TEXT    NOT NULL,
  stored_key  TEXT    NOT NULL,
  file_size   INTEGER NOT NULL,
  mime_type   TEXT    NOT NULL,
  file_data   TEXT    NOT NULL,  -- Base64 인코딩된 파일 본문
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  changed_by  INTEGER NOT NULL REFERENCES users(id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  memo        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_board       ON posts(board_id);
CREATE INDEX IF NOT EXISTS idx_posts_author      ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_company     ON posts(company_id);
CREATE INDEX IF NOT EXISTS idx_posts_status      ON posts(status);
CREATE INDEX IF NOT EXISTS idx_comments_post     ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_attachments_post  ON attachments(post_id);
CREATE INDEX IF NOT EXISTS idx_users_company     ON users(company_id);

INSERT OR IGNORE INTO users (id, email, password, name, role)
VALUES (1, 'dsayhong@gmail.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '시스템관리자', 'superadmin');

INSERT OR IGNORE INTO boards (id, name, description, type, access_role, write_role, sort_order, created_by)
VALUES
  (1, '공지사항',   '시스템 공지 및 안내사항',     'notice',    'all',   'admin', 1, 1),
  (2, '자유게시판', '자유롭게 의견을 나누는 공간', 'general',   'all',   'all',   2, 1),
  (3, '접수게시판', 'EMR 사전접수 데이터 제출',    'reception', 'staff', 'all',   3, 1);
