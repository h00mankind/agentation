import { describe, it, expect } from "vitest";
import { generateOutput } from "./generate-output";
import type { Annotation } from "../types";

const HASH = "a".repeat(64);
const annotation: Annotation = {
  id: "1", x: 10, y: 20, comment: "Match this", element: "Button",
  elementPath: "body > button", timestamp: 0,
  attachments: [{ id: HASH, mimeType: "image/png", width: 1440, height: 900, path: `/Users/me/.agentation/attachments/${HASH}.png` }],
};

describe("generateOutput reference images", () => {
  it.each(["compact", "standard", "detailed", "forensic"] as const)("lists path and dimensions at %s detail", (level) => {
    const output = generateOutput([annotation, { ...annotation, id: "2", attachments: undefined }], "/", level);
    expect(output).toContain(`Reference images:\n${level === "compact" ? "   " : ""}- /Users/me/.agentation/attachments/${HASH}.png (1440×900)`);
    expect(output.match(/Reference images:/g)).toHaveLength(1);
  });
});
