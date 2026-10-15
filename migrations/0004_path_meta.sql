-- 路径元信息表（对齐 AList Meta 模型）
CREATE TABLE IF NOT EXISTS path_meta (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    storage_id INTEGER NOT NULL,
    path TEXT NOT NULL DEFAULT '',
    password TEXT DEFAULT '',
    p_sub INTEGER DEFAULT 1,
    write_access INTEGER DEFAULT 1,
    w_sub INTEGER DEFAULT 1,
    hide TEXT DEFAULT '',
    h_sub INTEGER DEFAULT 1,
    readme TEXT DEFAULT '',
    r_sub INTEGER DEFAULT 1,
    header TEXT DEFAULT '',
    header_sub INTEGER DEFAULT 1,
    footer TEXT DEFAULT '',
    footer_sub INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (storage_id) REFERENCES storages(id) ON DELETE CASCADE,
    UNIQUE(storage_id, path)
);

CREATE INDEX IF NOT EXISTS idx_path_meta_storage_id ON path_meta(storage_id);
CREATE INDEX IF NOT EXISTS idx_path_meta_path ON path_meta(storage_id, path);
