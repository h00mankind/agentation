import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { PageFeedbackToolbarCSS } from "./index";
import type { Annotation } from "../../types";
import type { ComponentProps } from "react";
import { getStorageKey } from "../../utils/storage";

function toolbarRoot() {
  return document.querySelector("agentation-toolbar")!.shadowRoot! as unknown as HTMLElement;
}

// Mock clipboard API
const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
};
const originalElementFromPoint = document.elementFromPoint;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("navigator", {
    clipboard: mockClipboard,
    userAgent: "test-agent",
  });
  mockClipboard.writeText.mockClear();
});

afterEach(() => {
  document.elementFromPoint = originalElementFromPoint;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PageFeedbackToolbarCSS", () => {
  describe("onAnnotationAdd callback", () => {
    it("should accept onAnnotationAdd prop without errors", () => {
      const handleAnnotation = vi.fn();
      expect(() =>
        render(<PageFeedbackToolbarCSS onAnnotationAdd={handleAnnotation} />)
      ).not.toThrow();
    });

    it("should type-check annotation callback parameter", () => {
      // This test verifies TypeScript types are correct at compile time
      const handleAnnotation = (annotation: Annotation) => {
        // Verify all expected properties are accessible
        expect(annotation).toHaveProperty("id");
        expect(annotation).toHaveProperty("x");
        expect(annotation).toHaveProperty("y");
        expect(annotation).toHaveProperty("comment");
        expect(annotation).toHaveProperty("element");
        expect(annotation).toHaveProperty("elementPath");
        expect(annotation).toHaveProperty("timestamp");
      };

      render(<PageFeedbackToolbarCSS onAnnotationAdd={handleAnnotation} />);
    });
  });

  describe("copyToClipboard prop", () => {
    it("should default copyToClipboard to true", () => {
      // Component should render without explicit copyToClipboard prop
      expect(() => render(<PageFeedbackToolbarCSS />)).not.toThrow();
    });

    it("should accept copyToClipboard={false} without errors", () => {
      expect(() =>
        render(<PageFeedbackToolbarCSS copyToClipboard={false} />)
      ).not.toThrow();
    });

    it("should accept copyToClipboard={true} without errors", () => {
      expect(() =>
        render(<PageFeedbackToolbarCSS copyToClipboard={true} />)
      ).not.toThrow();
    });
  });

  describe("combined props", () => {
    it("should accept both onAnnotationAdd and copyToClipboard props", () => {
      const handleAnnotation = vi.fn();
      expect(() =>
        render(
          <PageFeedbackToolbarCSS
            onAnnotationAdd={handleAnnotation}
            copyToClipboard={false}
          />
        )
      ).not.toThrow();
    });
  });
});

describe("Annotation type", () => {
  it("should include all required fields", () => {
    const annotation: Annotation = {
      id: "test-id",
      x: 50,
      y: 100,
      comment: "Test comment",
      element: "Button",
      elementPath: "body > div > button",
      timestamp: Date.now(),
    };

    expect(annotation.id).toBe("test-id");
    expect(annotation.x).toBe(50);
    expect(annotation.y).toBe(100);
    expect(annotation.comment).toBe("Test comment");
    expect(annotation.element).toBe("Button");
    expect(annotation.elementPath).toBe("body > div > button");
    expect(typeof annotation.timestamp).toBe("number");
  });

  it("should allow optional metadata fields", () => {
    const annotation: Annotation = {
      id: "test-id",
      x: 50,
      y: 100,
      comment: "Test comment",
      element: "Button",
      elementPath: "body > div > button",
      timestamp: Date.now(),
      selectedText: "Selected text content",
      boundingBox: { x: 100, y: 200, width: 150, height: 40 },
      nearbyText: "Context around the element",
      cssClasses: "btn btn-primary",
      nearbyElements: "div, span, a",
      computedStyles: "color: blue; font-size: 14px",
      fullPath: "html > body > div#app > main > button.btn",
      accessibility: "role=button, aria-label=Submit",
      isMultiSelect: false,
      isFixed: false,
    };

    expect(annotation.selectedText).toBe("Selected text content");
    expect(annotation.boundingBox).toEqual({
      x: 100,
      y: 200,
      width: 150,
      height: 40,
    });
    expect(annotation.cssClasses).toBe("btn btn-primary");
    expect(annotation.fullPath).toBe("html > body > div#app > main > button.btn");
    expect(annotation.accessibility).toBe("role=button, aria-label=Submit");
    expect(annotation.isMultiSelect).toBe(false);
    expect(annotation.isFixed).toBe(false);
  });
});

describe("blockInteractions", () => {
  it("lets the host handle picked clicks when interaction blocking is disabled", () => {
    localStorage.setItem("feedback-toolbar-settings", JSON.stringify({ blockInteractions: false }));
    const onClick = vi.fn();
    render(<><div onClick={onClick}>Host target</div><PageFeedbackToolbarCSS /></>);
    const target = screen.getByText("Host target");
    document.elementFromPoint = () => target;
    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });
    fireEvent.click(target);
    expect(onClick).toHaveBeenCalledOnce();
    expect(toolbarRoot().querySelector("[data-annotation-popup]")).not.toBeNull();
  });

  it("does not let a picked click reach a delegated host handler", () => {
    const onRowClick = vi.fn();
    render(
      <>
        <table>
          <tbody>
            <tr onClick={onRowClick}>
              <td>Cell</td>
            </tr>
          </tbody>
        </table>
        <PageFeedbackToolbarCSS />
      </>
    );

    const cell = screen.getByText("Cell");
    // jsdom has no layout; resolve the picked element to the clicked cell
    document.elementFromPoint = () => cell;

    // Activate feedback mode (blockInteractions defaults to true)
    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });

    fireEvent.click(cell);

    expect(onRowClick).not.toHaveBeenCalled();
    expect(toolbarRoot().querySelector("[data-annotation-popup]")).not.toBeNull();
  });
});

describe("cmd+shift multi-select", () => {
  it("opens the popup on modifier release even when the keydowns were never observed", () => {
    render(
      <>
        <p>First</p>
        <p>Second</p>
        <PageFeedbackToolbarCSS />
      </>
    );
    const first = screen.getByText("First");
    const second = screen.getByText("Second");

    // Modifiers are already held when feedback mode is activated
    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });

    document.elementFromPoint = () => first;
    fireEvent.click(first, { metaKey: true, shiftKey: true });
    document.elementFromPoint = () => second;
    fireEvent.click(second, { metaKey: true, shiftKey: true });

    expect(toolbarRoot().querySelector("[data-annotation-popup]")).toBeNull();

    fireEvent.keyUp(document, { key: "Shift", metaKey: true });

    expect(toolbarRoot().querySelector("[data-annotation-popup]")).not.toBeNull();
  });
});

describe("keyboard shortcuts", () => {
  it("leaves single-key shortcuts to the host page while the toolbar is collapsed", () => {
    // Layout mode mounts a palette that observes its size; jsdom has no ResizeObserver
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    render(
      <>
        <div tabIndex={0} data-testid="editor" />
        <PageFeedbackToolbarCSS />
      </>
    );
    const editor = screen.getByTestId("editor");

    // Collapsed: "l" is not intercepted (fireEvent returns false when defaultPrevented)
    expect(fireEvent.keyDown(editor, { key: "l" })).toBe(true);

    // Active: the same key is now a toolbar shortcut
    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });
    expect(fireEvent.keyDown(editor, { key: "l" })).toBe(false);
  });
});

describe("layout mode interruptions", () => {
  it.each(["pointer", "keyboard"])("cancels overlay exit immediately when reopened by %s", async (input) => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    render(<PageFeedbackToolbarCSS />);
    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });
    const toggle = () => input === "keyboard"
      ? fireEvent.keyDown(document, { key: "l" })
      : fireEvent.click(toolbarRoot().querySelector<HTMLButtonElement>('[aria-label="Layout mode"], [aria-label="Exit layout mode"]')!);
    toggle();
    toggle();
    expect(toolbarRoot().querySelector('[class*="overlayExiting"]')).not.toBeNull();
    toggle();
    expect(toolbarRoot().querySelector('[aria-label="Exit layout mode"]')).not.toBeNull();
    expect(toolbarRoot().querySelector('[class*="overlayExiting"]')).toBeNull();
    await act(async () => {});
  });
});

describe("clipboard delivery", () => {
  const annotation: Annotation = {
    id: "copy-test", x: 50, y: 100, comment: "Keep this feedback until copied",
    element: "Button", elementPath: "body > button", timestamp: Date.now(),
  };

  function setup(props: ComponentProps<typeof PageFeedbackToolbarCSS> = {}) {
    localStorage.setItem("feedback-toolbar-settings", JSON.stringify({ autoClearAfterCopy: true }));
    localStorage.setItem(getStorageKey(window.location.pathname), JSON.stringify([annotation]));
    render(<PageFeedbackToolbarCSS {...props} />);
    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });
    return within(toolbarRoot()).getByRole("button", { name: "Copy feedback" });
  }

  it("does not reload layout records as ordinary feedback markers", async () => {
    localStorage.setItem(getStorageKey(window.location.pathname), JSON.stringify([
      annotation,
      { ...annotation, id: "placement", kind: "placement", comment: "Stored layout item" },
      { ...annotation, id: "rearrange", kind: "rearrange", comment: "Stored rearrange item" },
    ]));
    const onCopy = vi.fn();
    render(<PageFeedbackToolbarCSS copyToClipboard={false} onCopy={onCopy} />);
    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });
    fireEvent.click(within(toolbarRoot()).getByRole("button", { name: "Copy feedback" }));
    await waitFor(() => expect(onCopy).toHaveBeenCalledOnce());
    expect(onCopy.mock.calls[0][0]).toContain(annotation.comment);
    expect(onCopy.mock.calls[0][0]).not.toContain("Stored layout item");
    expect(onCopy.mock.calls[0][0]).not.toContain("Stored rearrange item");
  });

  it("keeps feedback and does not show success when both copy methods fail", async () => {
    mockClipboard.writeText.mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
    const onCopy = vi.fn();
    const onAnnotationsClear = vi.fn();
    const copy = setup({ onCopy, onAnnotationsClear });
    fireEvent.click(copy);
    await waitFor(() => expect(onCopy).toHaveBeenCalledOnce());
    expect(onCopy.mock.calls[0][0]).toContain(annotation.comment);
    expect(copy.getAttribute("data-active")).toBe("false");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    expect(onAnnotationsClear).not.toHaveBeenCalled();
    expect(copy.hasAttribute("disabled")).toBe(false);
  });

  it("clears only after a successful fallback", async () => {
    mockClipboard.writeText.mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => true) });
    const onAnnotationsClear = vi.fn();
    const copy = setup({ onAnnotationsClear });
    fireEvent.click(copy);
    await waitFor(() => expect(copy.getAttribute("data-active")).toBe("true"));
    await waitFor(() => expect(onAnnotationsClear).toHaveBeenCalledWith([annotation]));
  });

  it("preserves callback-only copying when clipboard access is disabled by the consumer", async () => {
    const onCopy = vi.fn();
    const copy = setup({ copyToClipboard: false, onCopy });
    fireEvent.click(copy);
    expect(onCopy).toHaveBeenCalledOnce();
    expect(mockClipboard.writeText).not.toHaveBeenCalled();
    expect(copy.getAttribute("data-active")).toBe("true");
  });
});

describe("manual submission", () => {
  const annotation: Annotation = {
    id: "submit-test", x: 50, y: 100, comment: "Make this easier to read",
    element: "Button", elementPath: "body > button", timestamp: Date.now(),
  };

  function setup(
    props: ComponentProps<typeof PageFeedbackToolbarCSS> = {},
    settings: Record<string, unknown> = {},
    hasFeedback = true,
  ) {
    localStorage.setItem("feedback-toolbar-settings", JSON.stringify(settings));
    if (hasFeedback) {
      localStorage.setItem(getStorageKey(window.location.pathname), JSON.stringify([annotation]));
    }
    render(<PageFeedbackToolbarCSS {...props} />);
    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });
    return within(toolbarRoot()).getByText("Send Annotations").parentElement!.querySelector("button")!;
  }

  it("submits through the callback without making a webhook request", async () => {
    const onSubmit = vi.fn();
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const send = setup({ onSubmit });
    expect(send.disabled).toBe(false);
    expect(send.tabIndex).toBe(0);
    fireEvent.click(send);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toContain(annotation.comment);
    expect(onSubmit.mock.calls[0][1]).toEqual([annotation]);
    await waitFor(() => expect(send.getAttribute("data-no-hover")).toBe("true"));
    expect(request).not.toHaveBeenCalled();
  });

  it("uses the same callback-only delivery for the S shortcut", async () => {
    const onSubmit = vi.fn();
    setup({ onSubmit });
    fireEvent.keyDown(document, { key: "s" });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  });

  it.each([
    { label: "no destination", props: {}, settings: {}, canSend: false },
    { label: "manual prop webhook", props: { webhookUrl: "https://example.test/hook" }, settings: { webhooksEnabled: false }, canSend: true },
    { label: "manual settings webhook", props: {}, settings: { webhookUrl: "https://example.test/hook", webhooksEnabled: false }, canSend: true },
    { label: "auto-send webhook", props: { webhookUrl: "https://example.test/hook" }, settings: {}, canSend: false },
    { label: "callback with auto-send webhook", props: { webhookUrl: "https://example.test/hook", onSubmit: vi.fn() }, settings: {}, canSend: true },
  ])("exposes manual Send for $label only when usable", ({ props, settings, canSend }) => {
    const send = setup(props, settings);
    expect(send.disabled).toBe(!canSend);
    expect(send.tabIndex).toBe(canSend ? 0 : -1);
  });

  it("does not submit empty feedback", () => {
    const onSubmit = vi.fn();
    const send = setup({ onSubmit }, {}, false);
    expect(send.disabled).toBe(true);
    fireEvent.keyDown(document, { key: "s" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not intercept S when only automatic webhook delivery is enabled", () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    setup({ webhookUrl: "https://example.test/hook" });
    expect(fireEvent.keyDown(document, { key: "s" })).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps the hidden Send control out of keyboard navigation", () => {
    const send = setup({ onSubmit: vi.fn() });
    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });
    expect(send.tabIndex).toBe(-1);
  });

  it("clears feedback after successful callback delivery when requested", async () => {
    const onAnnotationsClear = vi.fn();
    const send = setup({ onSubmit: vi.fn(), onAnnotationsClear }, { autoClearAfterCopy: true });
    fireEvent.click(send);
    await waitFor(() => expect(onAnnotationsClear).toHaveBeenCalledWith([annotation]), { timeout: 2000 });
  });

  it("sends to both configured delivery mechanisms", async () => {
    const onSubmit = vi.fn();
    const request = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", request);
    const send = setup({ onSubmit, webhookUrl: "https://example.test/hook" }, { webhooksEnabled: false });
    fireEvent.click(send);
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ event: "submit", annotations: [annotation] });
  });

  it("preserves feedback after a webhook failure", async () => {
    const onAnnotationsClear = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const send = setup({ webhookUrl: "https://example.test/hook", onAnnotationsClear }, { webhooksEnabled: false, autoClearAfterCopy: true });
    fireEvent.click(send);
    await waitFor(() => expect(send.getAttribute("data-no-hover")).toBe("true"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    expect(onAnnotationsClear).not.toHaveBeenCalled();
    expect(send.disabled).toBe(false);
  });

  it.each(["throws", "rejects"])("preserves feedback when the callback %s", async (failure) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onAnnotationsClear = vi.fn();
    const onSubmit = vi.fn(() => {
      if (failure === "throws") throw new Error("Delivery failed");
      return Promise.reject(new Error("Delivery failed"));
    });
    const send = setup({ onSubmit, onAnnotationsClear }, { autoClearAfterCopy: true });
    fireEvent.click(send);
    await waitFor(() => expect(send.getAttribute("data-no-hover")).toBe("true"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    expect(onAnnotationsClear).not.toHaveBeenCalled();
    expect(send.disabled).toBe(false);
  });

  it("keeps local attachment paths out of webhook annotations and markdown", async () => {
    const hash = "b".repeat(64);
    const attachment = { id: hash, mimeType: "image/png" as const, width: 800, height: 600 };
    const request = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", request);
    localStorage.setItem(getStorageKey(window.location.pathname), JSON.stringify([{
      ...annotation,
      attachments: [{ ...attachment, path: `/Users/me/.agentation/attachments/${hash}.png` }],
    }]));
    const send = setup({ webhookUrl: "https://example.test/hook" }, { webhooksEnabled: false }, false);
    fireEvent.click(send);
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    const body: string = request.mock.calls[0][1].body;
    expect(body).not.toContain("/Users/me");
    const payload = JSON.parse(body);
    expect(payload.annotations[0].attachments).toEqual([attachment]);
    expect(payload.output).toContain(`- ${hash}.png (800×600)`);
  });

  it("waits for asynchronous callback delivery before reporting success", async () => {
    let complete!: () => void;
    const delivery = new Promise<void>(resolve => { complete = resolve; });
    const onSubmit = vi.fn(() => delivery);
    const send = setup({ onSubmit });
    fireEvent.click(send);
    expect(send.disabled).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(send.getAttribute("data-no-hover")).toBe("false");
    complete();
    await waitFor(() => expect(send.getAttribute("data-no-hover")).toBe("true"));
    expect(send.disabled).toBe(false);
  });
});

describe("shadow event boundaries", () => {
  it("keeps toolbar pointer events from dismissing host menus", () => {
    const onOutside = vi.fn();
    document.addEventListener("mousedown", onOutside);
    const view = render(<PageFeedbackToolbarCSS />);
    try {
      fireEvent.mouseDown(toolbarRoot().querySelector('[data-feedback-toolbar]')!, { composed: true });
      expect(onOutside).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("mousedown", onOutside);
      view.unmount();
    }
  });

  it("leaves typing inside a host web component alone", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    render(<PageFeedbackToolbarCSS />);
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const input = document.createElement("input");
    shadow.append(input);
    try {
      fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });
      expect(fireEvent.keyDown(input, { key: "l", composed: true })).toBe(true);
    } finally {
      await act(async () => { host.remove(); });
    }
  });
});

describe("toolbar viewport bounds", () => {
  it("does not leave a drag armed when press and release precede effect setup", () => {
    render(<PageFeedbackToolbarCSS />);
    const wrapper = toolbarRoot().querySelector<HTMLElement>("[data-agentation-toolbar]")!;
    const toggle = within(toolbarRoot()).getByRole("button", { name: "Start feedback mode" });
    act(() => {
      fireEvent.mouseDown(toggle, { button: 0, buttons: 1, clientX: 500, clientY: 130, composed: true });
      fireEvent.mouseUp(document.body);
    });
    const position = wrapper.style.cssText;
    fireEvent.mouseMove(document.body, { buttons: 1, clientX: 600, clientY: 130 });
    expect(wrapper.style.cssText).toBe(position);
    expect(wrapper.hasAttribute("data-dragging")).toBe(false);
  });

  it("cancels a missed release instead of dragging on unpressed pointer movement", () => {
    render(<PageFeedbackToolbarCSS />);
    const wrapper = toolbarRoot().querySelector<HTMLElement>("[data-agentation-toolbar]")!;
    const toggle = within(toolbarRoot()).getByRole("button", { name: "Start feedback mode" });
    fireEvent.mouseDown(toggle, { button: 0, buttons: 1, clientX: 500, clientY: 130, composed: true });
    const position = wrapper.style.cssText;
    fireEvent.mouseMove(document.body, { buttons: 0, clientX: 600, clientY: 130 });
    expect(wrapper.style.cssText).toBe(position);
    expect(wrapper.hasAttribute("data-dragging")).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it.each([true, false])("accepts the first new click after dragging (release click: %s)", (releaseClick) => {
    render(<PageFeedbackToolbarCSS />);
    document.elementFromPoint = () => null;
    const wrapper = toolbarRoot().querySelector<HTMLElement>("[data-agentation-toolbar]")!;
    const surface = wrapper.querySelector<HTMLButtonElement>('[aria-label="Start feedback mode"]')!;
    fireEvent.mouseDown(surface, { button: 0, clientX: 500, clientY: 130, composed: true });
    fireEvent.mouseMove(document.body, { buttons: 1, clientX: 550, clientY: 130 });
    fireEvent.mouseUp(document.body);
    if (releaseClick) fireEvent.click(surface);
    expect(surface.disabled).toBe(false);

    fireEvent.mouseDown(surface, { button: 0, clientX: 550, clientY: 130, composed: true });
    fireEvent.mouseUp(surface);
    fireEvent.click(surface);
    expect(surface.getAttribute("aria-expanded")).toBe("true");
  });

  it("starts a drag from the rendered position during an edge correction", () => {
    localStorage.setItem("feedback-toolbar-position", JSON.stringify({ x: 200, y: 120 }));
    render(<PageFeedbackToolbarCSS />);
    document.elementFromPoint = () => null;
    const wrapper = toolbarRoot().querySelector<HTMLElement>("[data-agentation-toolbar]")!;
    vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({
      x: 100, y: 120, left: 100, top: 120, right: 437, bottom: 164,
      width: 337, height: 44, toJSON: () => ({}),
    });
    fireEvent.mouseDown(wrapper.firstElementChild!, {
      button: 0, clientX: 420, clientY: 130, composed: true,
    });
    fireEvent.mouseMove(document.body, { buttons: 1, clientX: 440, clientY: 140 });
    expect(Number.parseFloat(wrapper.style.left)).toBe(120);
    expect(Number.parseFloat(wrapper.style.top)).toBe(130);
    fireEvent.mouseUp(document.body);
  });

  it.each([
    { label: "standard controls", props: {}, settings: {}, surfaceWidth: 297 },
    { label: "callback Send", props: { onSubmit: vi.fn() }, settings: {}, surfaceWidth: 337 },
    { label: "manual webhook Send", props: { webhookUrl: "https://example.test/hook" }, settings: { webhooksEnabled: false }, surfaceWidth: 337 },
    { label: "automatic webhook", props: { webhookUrl: "https://example.test/hook" }, settings: {}, surfaceWidth: 297 },
  ])("keeps $label visible after expanding at the left edge and dragging", ({ props, settings, surfaceWidth }) => {
    // The right-aligned 44px launcher is 20px from the left viewport edge.
    localStorage.setItem("feedback-toolbar-position", JSON.stringify({ x: -273, y: 120 }));
    localStorage.setItem("feedback-toolbar-settings", JSON.stringify(settings));
    render(<PageFeedbackToolbarCSS {...props} />);
    document.elementFromPoint = () => null;
    const wrapper = toolbarRoot().querySelector<HTMLElement>("[data-agentation-toolbar]")!;
    const surface = wrapper.firstElementChild!;
    const visibleLeft = () => Number.parseFloat(wrapper.style.left) + 337 - surfaceWidth;

    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });
    expect(visibleLeft()).toBe(20);

    fireEvent.mouseDown(surface, { button: 0, clientX: 30, clientY: 130, composed: true });
    fireEvent.mouseMove(document.body, { buttons: 1, clientX: -1000, clientY: 130 });
    fireEvent.mouseUp(document.body);
    expect(visibleLeft()).toBe(20);

    fireEvent.mouseDown(surface, { button: 0, clientX: 30, clientY: 130, composed: true });
    fireEvent.mouseMove(document.body, { buttons: 1, clientX: 3000, clientY: 130 });
    fireEvent.mouseUp(document.body);
    expect(Number.parseFloat(wrapper.style.left) + 337).toBe(window.innerWidth - 20);
  });

  it("rechecks the boundary when a Send destination is added while open", () => {
    localStorage.setItem("feedback-toolbar-position", JSON.stringify({ x: -273, y: 120 }));
    const view = render(<PageFeedbackToolbarCSS />);
    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });
    view.rerender(<PageFeedbackToolbarCSS onSubmit={vi.fn()} />);
    const wrapper = toolbarRoot().querySelector<HTMLElement>("[data-agentation-toolbar]")!;
    expect(Number.parseFloat(wrapper.style.left)).toBe(20);
  });
});


describe("keyboard and accessible controls", () => {
  it("exposes only the native launcher while collapsed", () => {
    render(<PageFeedbackToolbarCSS />);
    const buttons = within(toolbarRoot()).getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].tagName).toBe("BUTTON");
    expect(buttons[0].getAttribute("aria-label")).toBe("Start feedback mode");
    expect(buttons[0].getAttribute("title")).toContain("Ctrl+Shift+F");
    expect(buttons[0].getAttribute("title")).toContain("⌘⇧F");
    expect(buttons[0].querySelector("button")).toBeNull();
    expect(toolbarRoot().querySelector('[aria-label="Feedback controls"]')!.hasAttribute("inert")).toBe(true);
    expect(toolbarRoot().querySelector('[data-agentation-settings-panel]')!.hasAttribute("inert")).toBe(true);
  });

  it("names the controls, focuses them on keyboard activation, and returns focus on Exit", () => {
    render(<PageFeedbackToolbarCSS onSubmit={() => {}} />);
    const ui = within(toolbarRoot());
    const launcher = ui.getByRole("button", { name: "Start feedback mode" });
    launcher.focus();
    fireEvent.click(launcher, { detail: 0 });
    expect((toolbarRoot() as unknown as ShadowRoot).activeElement).toBe(ui.getByRole("button", { name: "Pause animations" }));
    for (const name of ["Pause animations", "Layout mode", "Hide markers", "Copy feedback", "Send Annotations", "Clear all", "Settings", "Exit"]) {
      expect(ui.getByRole("button", { name })).toBeTruthy();
    }
    fireEvent.click(ui.getByRole("button", { name: "Exit" }));
    expect((toolbarRoot() as unknown as ShadowRoot).activeElement).toBe(launcher);
    expect(ui.getAllByRole("button")).toHaveLength(1);
  });

  it("keeps the same toggle button and SVG through opening and closing", () => {
    render(<PageFeedbackToolbarCSS />);
    const ui = within(toolbarRoot());
    const toggle = ui.getByRole("button", { name: "Start feedback mode" }) as HTMLButtonElement;
    const icon = toggle.querySelector("svg");
    // No timer advance or animation completion between successive presses.
    for (let click = 0; click < 12; click++) {
      fireEvent.click(toggle);
      const open = click % 2 === 0;
      expect(ui.getByRole("button", { name: open ? "Exit" : "Start feedback mode" })).toBe(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe(String(open));
      expect(toggle.querySelector("svg")).toBe(icon);
      expect(toggle.disabled).toBe(false);
    }
  });



  it("keeps inactive settings pages out of navigation and returns focus through Escape", async () => {
    render(<PageFeedbackToolbarCSS />);
    // Avoid jsdom's :has/:checked selector bug on the existing switch styles.
    const button = (name: string) => toolbarRoot().querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
    const activeElement = () => (toolbarRoot() as unknown as ShadowRoot).activeElement;
    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });
    const settings = button("Settings");
    fireEvent.click(settings, { detail: 0 });
    await waitFor(() => expect(activeElement()).toBe(button("Switch to light mode")));
    expect(toolbarRoot().querySelector('input[aria-label="React Components"]')).not.toBeNull();
    expect(toolbarRoot().querySelector('input[aria-label="Hide Until Restart"]')).not.toBeNull();
    const input = toolbarRoot().querySelector('textarea[aria-label="Webhook URL"]')!;
    expect(input.closest("[inert]")).not.toBeNull();
    const nav = toolbarRoot().querySelector<HTMLButtonElement>('[class*="settingsNavLink"]')!;
    fireEvent.click(nav, { detail: 0 });
    const back = button("Back to settings");
    expect(activeElement()).toBe(back);
    expect(button("Switch to light mode").closest("[inert]")).not.toBeNull();
    expect(input.closest("[inert]")).toBeNull();
    fireEvent.click(back, { detail: 0 });
    expect(activeElement()).toBe(nav);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(settings.getAttribute("aria-expanded")).toBe("false");
    expect(activeElement()).toBe(settings);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(activeElement()).toBe(button("Start feedback mode"));
  });

  it("keeps consumer positioning classes reachable outside the shadow root", () => {
    const view = render(<PageFeedbackToolbarCSS className="consumer-position" />);
    const host = document.querySelector(".consumer-position");
    expect(host?.shadowRoot).toBe(toolbarRoot());
    view.rerender(<PageFeedbackToolbarCSS className="consumer-position-next" />);
    expect(document.querySelector(".consumer-position")).toBeNull();
    expect(document.querySelector(".consumer-position-next")).toBe(host);
  });
});
