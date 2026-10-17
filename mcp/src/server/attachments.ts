/**
 * Image attachments. Files are content-addressed under <dataDir>/attachments,
 * named by the sha256 of their bytes, so identical uploads share one file.
 */

import { createHash, randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, readdirSync, utimesSync, writeFileSync } from "fs";
import { join } from "path";
import { getDataDir } from "./config.js";
import type { Annotation, Attachment } from "../types.js";

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_ANNOTATION = 4;
export const ATTACHMENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type MimeType = Attachment["mimeType"];
type ImageInfo = Pick<Attachment, "mimeType" | "width" | "height">;

const EXTENSIONS: Record<MimeType, string> = { "image/png": "png", "image/jpeg": "jpg" };
const ID_PATTERN = /^[a-f0-9]{64}$/;
const FILE_PATTERN = /^([a-f0-9]{64})\.(png|jpg)$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function attachmentsDir(): string {
  return join(getDataDir(), "attachments");
}

export function isAttachmentId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function attachmentId(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function attachmentPath(dir: string, id: string, mimeType: MimeType): string {
  return join(dir, `${id}.${EXTENSIONS[mimeType]}`);
}

/** Sniffs magic bytes and reads dimensions. Content-Type from the client is never consulted. */
export function sniffImage(bytes: Buffer): ImageInfo | null {
  if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return sniffPng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return sniffJpeg(bytes);
  return null;
}

function sniffPng(bytes: Buffer): ImageInfo | null {
  // IHDR is mandatory and must come first: length(4) type(4) width(4) height(4).
  if (bytes.length < 24 || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return dimensions("image/png", bytes.readUInt32BE(16), bytes.readUInt32BE(20));
}

function sniffJpeg(bytes: Buffer): ImageInfo | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Markers with no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) return null;
    if (isStartOfFrame(marker)) {
      if (offset + 9 > bytes.length) return null;
      return dimensions("image/jpeg", bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5));
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  return null;
}

// DHT (C4), JPG (C8) and DAC (CC) share the C0-CF range but are not frame headers.
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function dimensions(mimeType: MimeType, width: number, height: number): ImageInfo | null {
  return width > 0 && height > 0 ? { mimeType, width, height } : null;
}

/**
 * Stores sniffed image bytes. Returns null for anything that is not PNG or JPEG.
 * A repeat upload refreshes the file's mtime, so startup GC measures age from the last upload.
 */
export function writeAttachment(
  dir: string,
  bytes: Buffer,
): { attachment: Attachment; created: boolean } | null {
  const info = sniffImage(bytes);
  if (!info) return null;

  const id = attachmentId(bytes);
  const path = attachmentPath(dir, id, info.mimeType);
  const attachment: Attachment = { id, ...info, path };
  mkdirSync(dir, { recursive: true });

  if (existsSync(path)) {
    const now = new Date();
    utimesSync(path, now, now);
    return { attachment, created: false };
  }

  // Write under a unique temp name, then rename, so a reader never sees a partial file.
  const temp = join(dir, `.${id}.${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(temp, bytes);
  renameSync(temp, path);
  return { attachment, created: true };
}

export function readAttachment(
  dir: string,
  id: string,
): { bytes: Buffer; mimeType: MimeType } | null {
  if (!isAttachmentId(id)) return null;
  for (const mimeType of Object.keys(EXTENSIONS) as MimeType[]) {
    const path = attachmentPath(dir, id, mimeType);
    if (existsSync(path)) return { bytes: readFileSync(path), mimeType };
  }
  return null;
}

/**
 * Validates client-supplied attachments. The client's `path` is discarded and
 * replaced with this server's path, since the path is only meaningful locally.
 */
export function parseAttachments(raw: unknown, dir: string): Attachment[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS_PER_ANNOTATION) return null;
  const parsed: Attachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const { id, mimeType, width, height } = item as Record<string, unknown>;
    if (!isAttachmentId(id) || !isMimeType(mimeType) || !isPositiveInteger(width) || !isPositiveInteger(height)) {
      return null;
    }
    parsed.push({ id, mimeType, width, height, path: attachmentPath(dir, id, mimeType) });
  }
  return parsed;
}

function isMimeType(value: unknown): value is MimeType {
  return value === "image/png" || value === "image/jpeg";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export type WebhookAnnotation = Omit<Annotation, "attachments"> & {
  attachments?: Array<Omit<Attachment, "path">>;
};

/** Webhook receivers get metadata only, so local directory names stay on this machine. */
export function toWebhookAnnotation(annotation: Annotation): WebhookAnnotation {
  if (!annotation.attachments) return annotation;
  return {
    ...annotation,
    attachments: annotation.attachments.map(({ id, mimeType, width, height }) => ({ id, mimeType, width, height })),
  };
}

/**
 * Removes files for attachments an annotation just released, unless a remaining
 * annotation still references the same id.
 */
export function releaseAttachments(
  dir: string,
  released: Array<Pick<Attachment, "id" | "mimeType">>,
  referencedIds: ReadonlySet<string>,
): void {
  for (const { id, mimeType } of released) {
    if (!referencedIds.has(id)) rmSync(attachmentPath(dir, id, mimeType), { force: true });
  }
}

/** Startup sweep: removes every file that no annotation references. */
export function deleteUnreferenced(dir: string, referencedIds: ReadonlySet<string>): number {
  return sweep(dir, (id) => !referencedIds.has(id));
}

/** Startup GC: unreferenced files, plus any file whose mtime is older than maxAgeMs. */
export function gcAttachments(
  dir: string,
  referencedIds: ReadonlySet<string>,
  maxAgeMs: number,
  now = Date.now(),
): number {
  const cutoff = now - maxAgeMs;
  return deleteUnreferenced(dir, referencedIds) + sweep(dir, (_id, mtimeMs) => mtimeMs < cutoff);
}

function sweep(dir: string, shouldRemove: (id: string, mtimeMs: number) => boolean): number {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    const match = FILE_PATTERN.exec(name);
    if (!match) continue;
    const path = join(dir, name);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat || !shouldRemove(match[1], stat.mtimeMs)) continue;
    rmSync(path, { force: true });
    removed++;
  }
  return removed;
}
