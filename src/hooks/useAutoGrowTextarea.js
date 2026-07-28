// useAutoGrowTextarea.js — the one measurement behind every adaptive text box.
//
// See .claude/skills/auto-grow-textarea/SKILL.md for when to use it. The three
// rules encoded here each cost a real bug, so they are load-bearing:
//
//  1. `overflow: hidden` (via AUTO_GROW_TEXTAREA_STYLE) is required, not
//     cosmetic. While the element keeps its own scrollbar, `scrollHeight`
//     reports the visible box rather than the full content, and the measurement
//     is silently wrong.
//  2. Reset the height before reading `scrollHeight`. It can only ever report
//     MORE than an explicit height, never less, so without the reset the box
//     grows and then refuses to shrink when lines are deleted.
//  3. Re-fit on value change, not only on keystroke. Text arrives without a
//     keystroke constantly here — loaded from the server after first paint,
//     restored from a draft, reset programmatically.
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

// Spread onto the textarea. `resize: none` is deliberate: a hand-dragged height
// is erased by the next keystroke anyway, so offering the handle is a lie.
export const AUTO_GROW_TEXTAREA_STYLE = {
  overflow: "hidden",
  resize: "none",
};

export function useAutoGrowTextarea(value, { maxHeight } = {}) {
  const ref = useRef(null);

  const fit = useCallback((el) => {
    const node = el || ref.current;
    if (!node) return;
    node.style.height = "auto";
    const next = maxHeight ? Math.min(node.scrollHeight, maxHeight) : node.scrollHeight;
    node.style.height = `${next}px`;
    // Past the cap the box has to scroll again — the honest fallback when the
    // container genuinely cannot grow.
    node.style.overflowY = maxHeight && node.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [maxHeight]);

  // Layout effect so the first paint is already the right height — a plain
  // effect shows one frame at the default height and flickers.
  useLayoutEffect(() => { fit(); }, [value, fit]);

  // Fonts land after first paint and change the line height under us; without
  // this the initial measurement can be a few pixels short.
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts?.ready) return undefined;
    let cancelled = false;
    document.fonts.ready.then(() => { if (!cancelled) fit(); }).catch(() => {});
    return () => { cancelled = true; };
  }, [fit]);

  return { ref, fit };
}
