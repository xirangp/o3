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
