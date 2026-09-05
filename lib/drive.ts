import { JWT } from "google-auth-library";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const SCOPES = ["https://www.googleapis.com/auth/drive"];
const API = "https://www.googleapis.com/drive/v3";

let client: JWT | null = null;
function auth() {
  if (!client) {
    const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
    client = new JWT({ email: key.client_email, key: key.private_key, scopes: SCOPES });
  }
  return client;
}

async function call(path: string, init: RequestInit = {}) {
  const { token } = await auth().getAccessToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Drive ${path}: ${res.status} ${await res.text()}`);
  return res;
}

export const FOLDERS = { inbox: "1. To review", fix: "2. Fix", ready: "3. Ready to post" } as const;

const folderIds: Record<string, string> = {};
export async function folderId(name: string): Promise<string> {
  if (folderIds[name]) return folderIds[name];
  const root = process.env.DRIVE_ROOT_FOLDER_ID!;
  const q = encodeURIComponent(`'${root}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const found = await (await call(`/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`)).json();
  const id = found.files?.[0]?.id;
  // ponytail: service accounts have no Drive storage quota, so we never create folders. The team makes the three once.
  if (!id) throw new Error(`Drive folder "${name}" not found inside the root folder. Create it and share the root with the service account as Editor.`);
  folderIds[name] = id;
  return id;
}

export type DriveFile = { id: string; name: string; description?: string; mimeType: string; size?: string };

export async function listInbox(): Promise<DriveFile[]> {
  const inbox = await folderId(FOLDERS.inbox);
  const q = encodeURIComponent(`'${inbox}' in parents and mimeType contains 'video/' and trashed = false`);
  const res = await call(`/files?q=${q}&fields=files(id,name,description,mimeType,size)&orderBy=createdTime&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  return (await res.json()).files ?? [];
}

export async function download(fileId: string, toPath: string) {
  const res = await call(`/files/${fileId}?alt=media&supportsAllDrives=true`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(toPath));
}

export async function move(fileId: string, fromName: string, toName: string) {
  const [from, to] = await Promise.all([folderId(fromName), folderId(toName)]);
  await call(`/files/${fileId}?addParents=${to}&removeParents=${from}&supportsAllDrives=true`, { method: "PATCH", body: "{}" });
}

export async function writeText(folderName: string, name: string, text: string) {
  const parent = await folderId(folderName);
  const boundary = "sv" + Date.now();
  const meta = JSON.stringify({ name, parents: [parent], mimeType: "text/plain" });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
  const { token } = await auth().getAccessToken();
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive upload: ${res.status} ${await res.text()}`);
}

/** Metadata only, no storage quota needed. Shows in Drive's file details and search. */
export async function setDescription(fileId: string, text: string) {
  await call(`/files/${fileId}?supportsAllDrives=true`, { method: "PATCH", body: JSON.stringify({ description: text.slice(0, 4000) }) });
}
