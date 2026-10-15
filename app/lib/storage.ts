export interface Storage {
  id: number;
  name: string;
  type: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  basePath: string;
  config: Record<string, any>;
  saving: Record<string, any>;
  isPublic: boolean;
  guestList: boolean;
  guestDownload: boolean;
  guestUpload: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StorageInput {
  name: string;
  type?: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
  basePath?: string;
  config?: Record<string, any>;
  saving?: Record<string, any>;
  isPublic?: boolean;
  guestList?: boolean;
  guestDownload?: boolean;
  guestUpload?: boolean;
}

interface StorageRow {
  id: number;
  name: string;
  type: string;
  endpoint: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  bucket: string;
  base_path: string;
  config_json: string | null;
  saving_json: string | null;
  is_public: number;
  guest_list: number | null;
  guest_download: number | null;
  guest_upload: number | null;
  created_at: string;
  updated_at: string;
}

function safeParseJson(value: string | null): Record<string, any> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as Record<string, any>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function rowToStorage(row: StorageRow): Storage {
  return {
    id: row.id,
    name: row.name?.trim() || "",
    type: row.type?.trim() || "s3",
    endpoint: row.endpoint?.trim() || "",
    region: row.region?.trim() || "",
    accessKeyId: row.access_key_id?.trim() || "",
    secretAccessKey: row.secret_access_key?.trim() || "",
    bucket: row.bucket?.trim() || "",
    basePath: row.base_path?.trim() || "",
    config: safeParseJson(row.config_json),
    saving: safeParseJson(row.saving_json),
    isPublic: row.is_public === 1,
    guestList: row.guest_list === 1 || (row.guest_list === null && row.is_public === 1),
    guestDownload: row.guest_download === 1 || (row.guest_download === null && row.is_public === 1),
    guestUpload: row.guest_upload === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAllStorages(db: D1Database): Promise<Storage[]> {
  const result = await db
    .prepare("SELECT * FROM storages ORDER BY name")
    .all<StorageRow>();

  return (result.results ?? []).map(rowToStorage);
}

export async function getPublicStorages(db: D1Database): Promise<Storage[]> {
  // Show storages that have any guest permission enabled (list, download, or upload)
  const result = await db
    .prepare("SELECT * FROM storages WHERE guest_list = 1 OR guest_download = 1 OR guest_upload = 1 OR is_public = 1 ORDER BY name")
    .all<StorageRow>();

  return (result.results ?? []).map(rowToStorage);
}

// 用户可见的存储：公开存储（is_public = 1），用户可下载其文件
export async function getStoragesForUser(db: D1Database): Promise<Storage[]> {
  const result = await db
    .prepare("SELECT * FROM storages WHERE is_public = 1 ORDER BY name")
    .all<StorageRow>();

  return (result.results ?? []).map(rowToStorage);
}

export async function getStorageById(
  db: D1Database,
  id: number
): Promise<Storage | null> {
  const result = await db
    .prepare("SELECT * FROM storages WHERE id = ?")
    .bind(id)
    .first<StorageRow>();

  return result ? rowToStorage(result) : null;
}

export async function getStorageByName(
  db: D1Database,
  name: string
): Promise<Storage | null> {
  const result = await db
    .prepare("SELECT * FROM storages WHERE name = ?")
    .bind(name)
    .first<StorageRow>();

  return result ? rowToStorage(result) : null;
}

export async function createStorage(
  db: D1Database,
  input: StorageInput
): Promise<Storage> {
  // Trim all string inputs to prevent signature mismatch errors
  const name = input.name.trim();
  const type = (input.type || "s3").trim();
  const endpoint = (input.endpoint || "").trim();
  const region = (input.region || "us-east-1").trim();
  const accessKeyId = (input.accessKeyId || "").trim();
  const secretAccessKey = (input.secretAccessKey || "").trim();
  const bucket = (input.bucket || "").trim();
  const basePath = (input.basePath || "").trim();
  const configJson = JSON.stringify(input.config || {});
  const savingJson = JSON.stringify(input.saving || {});
  const isPublic = input.isPublic ? 1 : 0;
  const guestList = input.guestList !== undefined ? (input.guestList ? 1 : 0) : isPublic;
  const guestDownload = input.guestDownload !== undefined ? (input.guestDownload ? 1 : 0) : isPublic;
  const guestUpload = input.guestUpload ? 1 : 0;

  const result = await db
    .prepare(
      `INSERT INTO storages (name, type, endpoint, region, access_key_id, secret_access_key, bucket, base_path, config_json, saving_json, is_public, guest_list, guest_download, guest_upload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      name,
      type,
      endpoint,
      region,
      accessKeyId,
      secretAccessKey,
      bucket,
      basePath,
      configJson,
      savingJson,
      isPublic,
      guestList,
      guestDownload,
      guestUpload
    )
    .first<StorageRow>();

  if (!result) {
    throw new Error("Failed to create storage");
  }

  return rowToStorage(result);
}

export async function updateStorage(
  db: D1Database,
  id: number,
  input: Partial<StorageInput>
): Promise<Storage | null> {
  const existing = await getStorageById(db, id);
  if (!existing) {
    return null;
  }

  const updates: string[] = [];
  const values: (string | number)[] = [];

  // Trim all string inputs to prevent signature mismatch errors
  if (input.name !== undefined) {
    updates.push("name = ?");
    values.push(input.name.trim());
  }
  if (input.type !== undefined) {
    updates.push("type = ?");
    values.push(input.type.trim());
  }
  if (input.endpoint !== undefined) {
    updates.push("endpoint = ?");
    values.push(input.endpoint.trim());
  }
  if (input.region !== undefined) {
    updates.push("region = ?");
    values.push(input.region.trim());
  }
  if (input.accessKeyId !== undefined) {
    updates.push("access_key_id = ?");
    values.push(input.accessKeyId.trim());
  }
  if (input.secretAccessKey !== undefined) {
    updates.push("secret_access_key = ?");
    values.push(input.secretAccessKey.trim());
  }
  if (input.bucket !== undefined) {
    updates.push("bucket = ?");
    values.push(input.bucket.trim());
  }
  if (input.basePath !== undefined) {
    updates.push("base_path = ?");
    values.push(input.basePath.trim());
  }
  if (input.config !== undefined) {
    const mergedConfig = {
      ...(existing.config || {}),
      ...(input.config || {}),
    };
    updates.push("config_json = ?");
    values.push(JSON.stringify(mergedConfig));
  }
  if (input.saving !== undefined) {
    updates.push("saving_json = ?");
    values.push(JSON.stringify(input.saving || {}));
  }
  if (input.isPublic !== undefined) {
    updates.push("is_public = ?");
    values.push(input.isPublic ? 1 : 0);
  }
  if (input.guestList !== undefined) {
    updates.push("guest_list = ?");
    values.push(input.guestList ? 1 : 0);
  }
  if (input.guestDownload !== undefined) {
    updates.push("guest_download = ?");
    values.push(input.guestDownload ? 1 : 0);
  }
  if (input.guestUpload !== undefined) {
    updates.push("guest_upload = ?");
    values.push(input.guestUpload ? 1 : 0);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push("updated_at = datetime('now')");
  values.push(id);

  const result = await db
    .prepare(
      `UPDATE storages SET ${updates.join(", ")} WHERE id = ? RETURNING *`
    )
    .bind(...values)
    .first<StorageRow>();

  return result ? rowToStorage(result) : null;
}

export async function deleteStorage(
  db: D1Database,
  id: number
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM storages WHERE id = ?")
    .bind(id)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

export async function initDatabase(_db: D1Database): Promise<void> {
  // No-op: Tables should be created via schema.sql before running
  // npx wrangler d1 execute clist --local --file=./schema.sql
  return;
}

// Backup types
export interface StorageBackupItem {
  name: string;
  type: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  basePath: string;
  config?: Record<string, any>;
  saving?: Record<string, any>;
  isPublic: boolean;
  guestList: boolean;
  guestDownload: boolean;
  guestUpload: boolean;
}

export interface BackupData {
  version: number;
  exportedAt: string;
  storages: StorageBackupItem[];
}

// Export all storages for backup (includes secrets)
export async function exportStoragesForBackup(db: D1Database): Promise<BackupData> {
  const storages = await getAllStorages(db);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    storages: storages.map((s) => ({
      name: s.name,
      type: s.type,
      endpoint: s.endpoint,
      region: s.region,
      accessKeyId: s.accessKeyId,
      secretAccessKey: s.secretAccessKey,
      bucket: s.bucket,
      basePath: s.basePath,
      config: s.config || {},
      saving: s.saving || {},
      isPublic: s.isPublic,
      guestList: s.guestList,
      guestDownload: s.guestDownload,
      guestUpload: s.guestUpload,
    })),
  };
}

// Import storages from backup
export async function importStoragesFromBackup(
  db: D1Database,
  backup: BackupData,
  mode: 'merge' | 'replace'
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  if (mode === 'replace') {
    // Delete all existing storages
    await db.prepare("DELETE FROM storages").run();
  }

  for (const item of backup.storages) {
    try {
      // Check if storage with same name exists
      const existing = await getStorageByName(db, item.name);

      if (existing) {
        if (mode === 'merge') {
          // Skip existing in merge mode
          skipped++;
          continue;
        }
      }

      await createStorage(db, {
        name: item.name,
        type: item.type,
        endpoint: item.endpoint,
        region: item.region,
        accessKeyId: item.accessKeyId,
        secretAccessKey: item.secretAccessKey,
        bucket: item.bucket,
        basePath: item.basePath,
        config: item.config || {},
        saving: item.saving || {},
        isPublic: item.isPublic,
        guestList: item.guestList,
        guestDownload: item.guestDownload,
        guestUpload: item.guestUpload,
      });
      imported++;
    } catch (err) {
      errors.push(`Failed to import "${item.name}": ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return { imported, skipped, errors };
}
