import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AnnotationPopupCSS } from "./index";
import type { Attachment } from "../../types";

const attachment: Attachment = {
  id: "c".repeat(64), mimeType: "image/png", width: 10, height: 10, path: "/tmp/c.png",
};
let finishUpload!: (value: Attachment) => void;

vi.mock("../../utils/attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/attachments")>()),
  prepareImage: vi.fn(async (blob: Blob) => blob),
  uploadAttachment: vi.fn(() => new Promise<Attachment>((resolve) => { finishUpload = resolve; })),
}));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:local");
  URL.revokeObjectURL = vi.fn();
});

function pasteImage(textarea: HTMLElement) {
  const file = new File(["x"], "shot.png", { type: "image/png" });
  fireEvent.paste(textarea, { clipboardData: { files: [file] } });
}

describe("annotation popup attachments", () => {
  it("offers no attach control and ignores pasted images without a connected endpoint", () => {
    const onSubmit = vi.fn();
    render(<AnnotationPopupCSS element="Button" onSubmit={onSubmit} onCancel={() => {}} />);
    expect(screen.queryByLabelText("Attach image")).toBeNull();
    pasteImage(screen.getByRole("textbox"));
    expect(document.querySelector("img")).toBeNull();
  });

  it("uploads a pasted image, blocks submit until it is stored, then submits it", async () => {
    const onSubmit = vi.fn();
    render(
      <AnnotationPopupCSS element="Button" attachmentEndpoint="http://localhost:4747" onSubmit={onSubmit} onCancel={() => {}} />,
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Like this" } });
    pasteImage(textarea);
    await waitFor(() => expect(document.querySelector("img")?.getAttribute("src")).toBe("blob:local"));
    fireEvent.click(screen.getByText("Add"));
    expect(onSubmit).not.toHaveBeenCalled();

    finishUpload(attachment);
    await waitFor(() =>
      expect(document.querySelector("img")?.getAttribute("src")).toBe(`http://localhost:4747/attachments/${attachment.id}`),
    );
    fireEvent.click(screen.getByText("Add"));
    expect(onSubmit).toHaveBeenCalledWith("Like this", [attachment]);
  });

  it("drops a removed image from the submission", async () => {
    const onSubmit = vi.fn();
    render(
      <AnnotationPopupCSS element="Button" attachmentEndpoint="http://localhost:4747" initialAttachments={[attachment]} initialValue="Note" onSubmit={onSubmit} onCancel={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText("Remove image"));
    fireEvent.click(screen.getByText("Add"));
    expect(onSubmit).toHaveBeenCalledWith("Note", []);
  });
});
