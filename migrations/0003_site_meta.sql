-- 站点元信息配置表
CREATE TABLE IF NOT EXISTS site_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 默认配置项
INSERT OR IGNORE INTO site_meta (key, value) VALUES
    ('site_title', 'CList'),
    ('site_description', 'S3 兼容存储聚合服务'),
    ('site_keywords', 'cloud storage,s3,file manager'),
    ('site_logo', ''),
    ('site_favicon', ''),
    ('announcement', ''),
    ('footer_text', ''),
    ('custom_css', ''),
    ('custom_head_js', ''),
    ('custom_body_js', ''),
    ('allow_register', 'false'),
    ('open_api', 'false'),
    ('preview_external', ''),
    ('preview_iframe', ''),
    ('preview_iframe_types', '');
