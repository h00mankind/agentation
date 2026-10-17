import type { Annotation, Attachment } from "../types";

export const MAX_ATTACHMENTS = 4;
const MAX_EDGE = 1568;
const MAX_PNG_BYTES = 1024 * 1024;

function encode(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Image encoding failed"))),
      type,
      quality,
    ),
  );
}

/** Re-encode through a canvas: caps the long edge, strips metadata, and yields PNG or JPEG. */
export async function prepareImage(file: Blob): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Not an image");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const png = await encode(canvas, "image/png");
  if (png.size <= MAX_PNG_BYTES) return png;
  // JPEG has no alpha; paint transparent pixels white instead of black.
  context.globalCompositeOperation = "destination-over";
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return encode(canvas, "image/jpeg", 0.85);
}

export async function uploadAttachment(endpoint: string, blob: Blob): Promise<Attachment> {
  const response = await fetch(`${endpoint}/attachments`, {
    method: "POST",
    headers: { "Content-Type": blob.type },
    body: blob,
  });
  if (!response.ok) throw new Error(`Attachment upload failed: ${response.status}`);
  const attachment: Attachment = await response.json();
  // The id becomes part of a URL path.
  if (!/^[a-f0-9]{64}$/.test(attachment.id)) throw new Error("Invalid attachment id");
  return attachment;
}

/** JSON.stringify replacer that keeps local file paths out of payloads sent off-machine. */
export function omitAttachmentPaths(key: string, value: unknown) {
  return key === "attachments" && Array.isArray(value)
    ? value.map(({ path: _path, ...rest }: Attachment) => rest)
    : value;
}

/** Markdown bound for a webhook names each image file without its local directory. */
export function redactAttachmentPaths(output: string, annotations: readonly Annotation[]) {
  return annotations
    .flatMap((annotation) => annotation.attachments ?? [])
    .reduce((text, { path }) => text.split(path).join(path.split(/[\\/]/).pop()), output);
}
