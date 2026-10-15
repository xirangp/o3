-- S3 存储连接信息表
CREATE TABLE IF NOT EXISTS storages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 's3',
    endpoint TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'us-east-1',
    access_key_id TEXT NOT NULL,
    secret_access_key TEXT NOT NULL,
    bucket TEXT NOT NULL,
    base_path TEXT DEFAULT '',
    config_json TEXT DEFAULT '{}',
    saving_json TEXT DEFAULT '{}',
    is_public INTEGER DEFAULT 0,
    guest_list INTEGER DEFAULT 1,
    guest_download INTEGER DEFAULT 1,
    guest_upload INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 会话表
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_type TEXT NOT NULL DEFAULT 'guest',
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);

-- 分享链接表
CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    storage_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    is_directory INTEGER DEFAULT 0,
    share_token TEXT NOT NULL UNIQUE,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (storage_id) REFERENCES storages(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_storages_is_public ON storages(is_public);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(share_token);
CREATE INDEX IF NOT EXISTS idx_shares_storage_id ON shares(storage_id);

-- 审计日志表
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    storage_id INTEGER,
    path TEXT,
    user_type TEXT NOT NULL DEFAULT 'guest',
    ip TEXT,
    user_agent TEXT,
    detail TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (storage_id) REFERENCES storages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_storage_id ON audit_logs(storage_id);

-- 文件夹密码保护表
CREATE TABLE IF NOT EXISTS folder_passwords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    storage_id INTEGER NOT NULL,
    folder_path TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    hint TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (storage_id) REFERENCES storages(id) ON DELETE CASCADE,
    UNIQUE(storage_id, folder_path)
);

CREATE INDEX IF NOT EXISTS idx_folder_passwords_storage_id ON folder_passwords(storage_id);
CREATE INDEX IF NOT EXISTS idx_folder_passwords_path ON folder_passwords(storage_id, folder_path);

-- 注册用户表（区别于管理员：用户仅可下载公开存储的文件）
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
