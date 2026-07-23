---
name: auto-grow-textarea
description: Use whenever adding, editing, or reviewing a <textarea> in this repo, or when the user asks for a text box to be adaptive / grow with the text / stop scrolling internally ("תיבה אדפטיבית", "שתתארך לפי הטקסט", "auto-resize", "אין לי מקום לכתוב"). Text boxes here fit their content instead of scrolling inside a fixed height.
---

# Text boxes grow with their content

**Default for every `<textarea>` in this app: it fits its content.** A fixed-height
box with an inner scrollbar hides what the user wrote from the user who is writing
it — and in an RTL layout the scrollbar lands on the left edge, where nobody looks.

Never hand-roll the measurement. Use the shared hook:
**[src/hooks/useAutoGrowTextarea.js](src/hooks/useAutoGrowTextarea.js)**

## How to apply

```jsx
import { useAutoGrowTextarea, AUTO_GROW_TEXTAREA_STYLE } from "../hooks/useAutoGrowTextarea.js";

const body = useAutoGrowTextarea(form.body);

<textarea
  ref={body.ref}
  rows={1}
  value={form.body}
  onChange={e => { const v = e.target.value; setForm(f => ({ ...f, body: v })); body.fit(e.target); }}
  style={{
    ...AUTO_GROW_TEXTAREA_STYLE,
    width: "100%", padding: "10px 12px", borderRadius: 8,
    border: "1px solid var(--border)", background: "var(--surface)",
    color: "var(--text)", fontFamily: "inherit", lineHeight: 1.6,
    minHeight: 110,   // comfortable while empty
    fontSize: 16,     // 16px minimum — anything smaller makes iOS zoom on focus
  }}
/>
```

`rows={1}` — the height comes from the measurement, so a larger `rows` only sets a
floor that fights `minHeight`.

## The three traps (each one cost a real bug)

1. **`overflow: "hidden"` is required, not cosmetic.** While the element keeps its
   own scrollbar, `scrollHeight` reports the visible box instead of the full
   content and the measurement is simply wrong. Same family as lessons #30/#32 in
   CLAUDE.md, from the other side: there the automatic promotion to `auto` added a
   scrollbar nobody asked for, here it breaks the math silently.
2. **Reset `height = "auto"` before reading `scrollHeight`.** It can only report
   *more* than an explicit height, never less — skip the reset and the box grows
   but never shrinks back when lines are deleted.
3. **Resize on value change, not only on keystroke.** Text arrives without a
   keystroke all the time in this codebase: loaded from the server after the first
   render, restored from a `localStorage` draft, reset programmatically. The hook's
   `useEffect` covers those; `fit(e.target)` in `onChange` is still worth calling
   because the effect runs after paint and can flicker for a frame while typing.

## When NOT to auto-grow

- The textarea sits in a container with a genuinely fixed height that cannot
  scroll → pass `{ maxHeight }` to the hook. Past that height it stops and scrolls
  normally, which is the honest fallback.
- Inside a modal, prefer letting the box grow and the **modal body** scroll
  (`overflowY: "auto"` on `.modal-body`) — that is how this app's modals already
  behave.

## Repo conventions this must respect

- **Inline styles**, not CSS classes — that is how every form in this codebase is
  written.
- **RTL** — no `text-align` or direction overrides; the surrounding `dir="rtl"`
  handles it.
- **`fontSize: 16`** on anything a phone can focus (memory: every change must work
  in the mobile PWA). Below 16px iOS Safari zooms the page on focus and the user
  has to pinch back out.
- **`resize: "none"`** comes from `AUTO_GROW_TEXTAREA_STYLE`. Do not re-add
  `resize: "vertical"` alongside auto-grow — a hand-dragged height is erased on the
  next keystroke.

## Converting an existing textarea

~30 `<textarea>` elements exist across ~13 files (`src/App.jsx`,
`src/components/*.jsx`). Find them with `grep -rn "<textarea" --include=*.jsx src/`.

Per element: add the hook, add `ref` + `rows={1}`, spread `AUTO_GROW_TEXTAREA_STYLE`,
call `fit` in `onChange`, and **delete any `rows={N}` / `resize` / fixed `height`
left behind**. Then look at the box on a 398px viewport before calling it done —
the failure mode is a container that could not absorb the new height, and it only
shows on a phone.
