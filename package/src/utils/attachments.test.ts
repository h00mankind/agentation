import { describe, it, expect, vi, afterEach } from "vitest";
import { prepareImage, redactAttachmentPaths } from "./attachments";
import { generateOutput } from "./generate-output";
import type { Annotation } from "../types";

const HASH = "a".repeat(64);
const annotation: Annotation = {
  id: "1", x: 10, y: 20, comment: "Match this", element: "Button",
  elementPath: "body > button", timestamp: 0,
  attachments: [{ id: HASH, mimeType: "image/png", width: 1440, height: 900, path: `/Users/me/.agentation/attachments/${HASH}.png` }],
};

describe("redactAttachmentPaths", () => {
  it("keeps only the file name of each local path", () => {
    const output = redactAttachmentPaths(generateOutput([annotation], "/"), [annotation]);
    expect(output).not.toContain("/Users/me");
    expect(output).toContain(`- ${HASH}.png (1440×900)`);
  });
});

describe("prepareImage", () => {
  let drawn: { width: number; height: number } | undefined;

  function mockCanvas(pngBytes: number) {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 3136, height: 1000, close() {} })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: (_: unknown, _x: number, _y: number, width: number, height: number) => { drawn = { width, height }; },
      fillRect() {},
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback, type) {
      callback(new Blob([new Uint8Array(type === "image/png" ? pngBytes : 10)], { type }));
    });
  }

  afterEach(() => {
    drawn = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("caps the long edge at 1568px and keeps a small PNG", async () => {
    mockCanvas(500_000);
    const blob = await prepareImage(new Blob(["x"], { type: "image/webp" }));
    expect(drawn).toEqual({ width: 1568, height: 500 });
    expect(blob.type).toBe("image/png");
  });

  it("falls back to JPEG when the PNG exceeds 1 MiB", async () => {
    mockCanvas(1024 * 1024 + 1);
    const blob = await prepareImage(new Blob(["x"], { type: "image/png" }));
    expect(blob.type).toBe("image/jpeg");
  });

  it("rejects non-image files", async () => {
    await expect(prepareImage(new Blob(["x"], { type: "text/plain" }))).rejects.toThrow();
  });
});
