"use client";

import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { useExitCompletion } from "../../hooks/use-exit-completion";
import styles, { css as popupCss } from "./styles.module.scss";
import { ensureStyles } from "../../utils/ensure-styles";
import { AnnotationEditor, type AnnotationEditorHandle } from "./annotation-editor";
import { originalSetTimeout } from "../../utils/freeze-animations";
import type { Attachment } from "../../types";

// =============================================================================
// Helpers
// =============================================================================

// =============================================================================
// Types
// =============================================================================

export interface AnnotationPopupCSSProps {
  /** Element name to display in header */
  element: string;
  /** Optional timestamp display (e.g., "@ 1.23s" for animation feedback) */
  timestamp?: string;
  /** Optional selected/highlighted text */
  selectedText?: string;
  /** Placeholder text for the textarea */
  placeholder?: string;
  /** Initial value for textarea (for edit mode) */
  initialValue?: string;
  /** Label for submit button (default: "Add") */
  submitLabel?: string;
  /** Called when annotation is submitted with text and any uploaded reference images */
  onSubmit: (text: string, attachments: Attachment[]) => void;
  /** Called when popup is cancelled/dismissed */
  onCancel: () => void;
  /** Called when delete button is clicked (only shown if provided) */
  onDelete?: () => void;
  /** Optional host-provided action for opening the detected source in an editor. */
  onOpenSource?: () => void;
  /** Attribute-only selection can be saved without a feedback comment. */
  allowEmpty?: boolean;
  /** Position styles (left, top) */
  style?: React.CSSProperties;
  /** Custom color for submit button and textarea focus (hex) */
  accentColor?: string;
  /** External exit state (parent controls exit animation) */
  isExiting?: boolean;
  /** Called after the externally controlled exit animation finishes. */
  onExitComplete?: () => void;
  /** Light mode styling */
  lightMode?: boolean;
  /** Computed styles for the selected element */
  computedStyles?: Record<string, string>;
  /** Server endpoint for image uploads; attaching is offered only when set */
  attachmentEndpoint?: string;
  /** Reference images already on the annotation (edit mode) */
  initialAttachments?: Attachment[];
}

export interface AnnotationPopupCSSHandle {
  /** Shake the popup (e.g., when user clicks outside) */
  shake: () => void;
}

// =============================================================================
// Component
// =============================================================================

export const AnnotationPopupCSS = forwardRef<AnnotationPopupCSSHandle, AnnotationPopupCSSProps>(
  function AnnotationPopupCSS(
    {
      element,
      timestamp,
      selectedText,
      placeholder = "What should change?",
      initialValue = "",
      submitLabel = "Add",
      onSubmit,
      onCancel,
      onDelete,
      onOpenSource,
      allowEmpty = false,
      style,
      accentColor = "#3c82f7",
      isExiting = false,
      onExitComplete,
      lightMode = false,
      computedStyles,
      attachmentEndpoint,
      initialAttachments,
    },
    ref
  ) {
    const [isShaking, setIsShaking] = useState(false);
    const [animState, setAnimState] = useState<"initial" | "enter" | "entered" | "exit">("initial");
    const editorRef = useRef<AnnotationEditorHandle>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      ensureStyles(popupRef.current?.getRootNode(), "annotation-popup", popupCss);
    }, []);
    const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Animate in on mount and focus textarea
    useEffect(() => {
      // Start enter animation (use originalSetTimeout to bypass freeze patch)
      const startTimer = originalSetTimeout(() => {
        setAnimState(previous => previous === "initial" ? "enter" : previous);
      }, 0);
      return () => {
        clearTimeout(startTimer);
        if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
      };
    }, []);

    useEffect(() => {
      if (isExiting) return;
      const timer = originalSetTimeout(() => editorRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }, [isExiting]);

    // Shake animation
    const shake = useCallback(() => {
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
      setIsShaking(true);
      shakeTimerRef.current = originalSetTimeout(() => {
        setIsShaking(false);
        editorRef.current?.focus();
      }, 250);
    }, []);

    // Expose shake to parent via ref
    useImperativeHandle(ref, () => ({
      shake,
    }), [shake]);

    // Handle cancel with exit animation
    const handleCancel = useCallback(() => {
      if (onExitComplete) {
        onCancel();
        return;
      }
      setAnimState("exit");
    }, [onCancel, onExitComplete]);

    const visibleAnimState = isExiting ? "exit" : animState;
    useExitCompletion(popupRef, visibleAnimState === "exit", () => {
      if (isExiting) onExitComplete?.();
      else onCancel();
    });
    const popupClassName = [
      styles.popup,
      lightMode ? styles.light : "",
      visibleAnimState === "enter" ? styles.enter : "",
      visibleAnimState === "entered" ? styles.entered : "",
      visibleAnimState === "exit" ? styles.exit : "",
      isShaking && visibleAnimState !== "exit" ? styles.shake : "",
    ].filter(Boolean).join(" ");

    return (
      <div
        ref={popupRef}
        className={popupClassName}
        data-annotation-popup
        style={style}
        onAnimationEnd={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.animationName.includes("popupEnter") && !isExiting) {
            setAnimState("entered");
          }
        }}
        onKeyDownCapture={(event) => {
          if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          handleCancel();
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <AnnotationEditor
          ref={editorRef}
          element={element}
          timestamp={timestamp}
          selectedText={selectedText}
          placeholder={placeholder}
          initialValue={initialValue}
          submitLabel={submitLabel}
          onSubmit={onSubmit}
          onCancel={handleCancel}
          onDelete={onDelete}
          onOpenSource={onOpenSource}
          allowEmpty={allowEmpty}
          accentColor={accentColor}
          computedStyles={computedStyles}
          attachmentEndpoint={attachmentEndpoint}
          initialAttachments={initialAttachments}
          disabled={visibleAnimState === "exit"}
        />
      </div>
    );
  }
);

export default AnnotationPopupCSS;
