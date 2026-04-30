/**
 * Google Drive client — used ONLY for the splits inbox feature.
 *
 * Service accounts cannot create files in personal My Drive folders, but
 * they CAN read and delete files in folders shared with them. This is
 * sufficient for the splits workflow: user uploads payment screenshots
 * to a Drive folder, the agent reads them, processes them, and removes
 * them from the inbox.
 *
 * If splits aren't used, this file is never imported and no Drive setup
 * is required.
 *
 * Required env vars (only when using splits):
 *   GOOGLE_APPLICATION_CREDENTIALS — path to service account JSON
 *   SPLITS_INBOX_FOLDER_ID         — Drive folder ID (shared with the SA)
 */

import { google, drive_v3 } from 'googleapis';

let drive: drive_v3.Drive | null = null;

function getDrive(): drive_v3.Drive {
  if (drive) return drive;
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  drive = google.drive({ version: 'v3', auth });
  return drive;
}

export function getSplitsInboxFolderId(): string | null {
  return process.env.SPLITS_INBOX_FOLDER_ID || null;
}

export async function listSplitsInbox(): Promise<{ id: string; name: string; mimeType: string }[]> {
  const folderId = getSplitsInboxFolderId();
  if (!folderId) return [];
  const d = getDrive();
  const res = await d.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 1000,
  });
  return (res.data.files || []).map(f => ({
    id: f.id!,
    name: f.name!,
    mimeType: f.mimeType!,
  }));
}

export async function fetchFileBuffer(fileId: string): Promise<Buffer> {
  const d = getDrive();
  const res = await d.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(res.data as ArrayBuffer);
}

export async function deleteFile(fileId: string): Promise<void> {
  const d = getDrive();
  try {
    await d.files.delete({ fileId });
  } catch {
    await d.files.update({ fileId, requestBody: { trashed: true } });
  }
}
