export interface Share {
  id: string;
  storageId: number;
  filePath: string;
  isDirectory: boolean;
  shareToken: string;
  expiresAt: string | null;
  createdAt: string;
}

interface ShareRow {
  id: string;
  storage_id: number;
  file_path: string;
  is_directory: number;
  share_token: string;
  expires_at: string | null;
  created_at: string;
}

import { secureRandomToken } from "./security";

function generateRandomToken(length: number = 24): string {
  return secureRandomToken(length);
}

function generateShareId(): string {
  return `share_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export async function createShare(
  db: D1Database,
  storageId: number,
  filePath: string,
  isDirectory: boolean,
  expiresAt?: string
): Promise<Share> {
  const id = generateShareId();
  const shareToken = generateRandomToken();
  const createdAt = new Date().toISOString();

  const query = `
    INSERT INTO shares (id, storage_id, file_path, is_directory, share_token, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  await db.prepare(query).bind(id, storageId, filePath, isDirectory ? 1 : 0, shareToken, expiresAt || null, createdAt).run();

  return {
    id,
    storageId,
    filePath,
    isDirectory,
    shareToken,
    expiresAt: expiresAt || null,
    createdAt,
  };
}

export async function getShareByToken(db: D1Database, token: string): Promise<Share | null> {
  const query = `SELECT * FROM shares WHERE share_token = ?`;
  const result = await db.prepare(query).bind(token).first<ShareRow>();

  if (!result) {
    return null;
  }

  // Check if share has expired
  if (result.expires_at) {
    const expiresAt = new Date(result.expires_at);
    if (expiresAt < new Date()) {
      return null;
    }
  }

  return {
    id: result.id,
    storageId: result.storage_id,
    filePath: result.file_path,
    isDirectory: result.is_directory === 1,
    shareToken: result.share_token,
    expiresAt: result.expires_at,
    createdAt: result.created_at,
  };
}

export async function getShareById(db: D1Database, id: string): Promise<Share | null> {
  const query = `SELECT * FROM shares WHERE id = ?`;
  const result = await db.prepare(query).bind(id).first<ShareRow>();

  if (!result) {
    return null;
  }

  return {
    id: result.id,
    storageId: result.storage_id,
    filePath: result.file_path,
    isDirectory: result.is_directory === 1,
    shareToken: result.share_token,
    expiresAt: result.expires_at,
    createdAt: result.created_at,
  };
}

export async function getAllShares(db: D1Database, storageId?: number): Promise<Share[]> {
  let query = `SELECT * FROM shares WHERE 1=1`;
  const bindings: (string | number)[] = [];

  if (storageId !== undefined) {
    query += ` AND storage_id = ?`;
    bindings.push(storageId);
  }

  query += ` ORDER BY created_at DESC`;

  const result = await db.prepare(query).bind(...bindings).all<ShareRow>();

  return (result.results || []).map((row) => ({
    id: row.id,
    storageId: row.storage_id,
    filePath: row.file_path,
    isDirectory: row.is_directory === 1,
    shareToken: row.share_token,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

export async function deleteShare(db: D1Database, id: string): Promise<void> {
  const query = `DELETE FROM shares WHERE id = ?`;
  await db.prepare(query).bind(id).run();
}

export async function cleanExpiredShares(db: D1Database): Promise<void> {
  const query = `DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at < datetime('now')`;
  await db.prepare(query).run();
}
