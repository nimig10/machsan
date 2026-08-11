// DateField — a date input that always reads DD/MM/YYYY and can be typed into.
//
// Replaces <input type="date"> at every call site. Two bugs forced it:
//
// 1. The native widget renders in the BROWSER's locale, which the page cannot
//    set (lang/dir/CSS are all ignored). An Israeli user on an English browser
//    saw 10/18/2026 in the field while the notice above it said 18/08/2026.
// 2. The native widget could not be typed into. Call sites were controlled
//    inputs whose onChange REJECTED out-of-range values without calling the
//    setter, so typing a year digit by digit produced 0002-.. / 0020-.. /
//    0202-.., each rejected, each reverting the DOM — and firing a toast.
//
// The fix for (2) is the same one lesson #42 reached for numeric fields:
// **validate on commit (blur/Enter), never on keystroke.** While the user
// types, the draft is local and nothing is reported upward.
//
// The value contract is unchanged: `value` in and `onChange` out are both ISO
// yyyy-mm-dd, so swapping this in touches no call-site state.
//
// The native picker is kept — a visually-hidden type="date" opened via
// showPicker(). On mobile that is the OS date wheel, which is far better than
// anything we would hand-roll, and losing it would be a real regression.

import { useRef, useState } from "react";
import { Calendar } from "lucide-react";
import { isoToHe, heToIso, maskDateInput, isValidIso } from "../utils/dateFormat.js";

export function DateField({
  value,
  onChange,
  min,
  max,
  disabled = false,
  onReject,            // optional (message) => void — e.g. showToast
  className = "form-input",
  style,               // the wrapper (flex row: text field + calendar button)
  inputStyle,          // the text field itself — for call sites that style inline
  placeholder = "DD/MM/YYYY",
  ...rest
}) {
  const [draft, setDraft] = useState(() => isoToHe(value));
  const [syncedValue, setSyncedValue] = useState(value);
  const [focused, setFocused] = useState(false);
  const pickerRef = useRef(null);

  // Resync when the value changes from OUTSIDE (a sibling field adjusting the
  // range, a form reset). Adjusted during render rather than in an effect —
  // the React docs' "adjusting state when a prop changes" pattern; an effect
  // here means an extra commit and a cascading-render lint error.
  // Skipped while focused so it can never fight what is being typed.
  if (!focused && value !== syncedValue) {
    setSyncedValue(value);
    setDraft(isoToHe(value));
  }

  function reject(message) {
    setDraft(isoToHe(value));      // snap back to the last good value
    if (message) onReject?.(message);
  }

  // Commit = the only place a value travels upward.
  //
  // ⚠️ Both exits set the draft back to the CURRENT `value`, never to what was
  // just typed — the parent is allowed to refuse. ProductionEditor rejects
  // weekends and ranges over 7 days, and several call sites early-return on an
  // empty value. Optimistically showing the typed text would leave the field
  // displaying a date the form does not hold, which is precisely how a booking
  // lands on the wrong day. When the parent DOES accept, its state update lands
  // in the same batch and the resync above rewrites the draft — one render,
  // no flash.
  function commit(text) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) {
      setDraft(isoToHe(value));
      if (value) onChange?.("");
      return;
    }
    const iso = heToIso(trimmed);
    if (!iso) return reject("תאריך לא תקין — הזינו בפורמט DD/MM/YYYY");
    if (min && isValidIso(min) && iso < min) return reject(`התאריך המוקדם ביותר האפשרי הוא ${isoToHe(min)}`);
    if (max && isValidIso(max) && iso > max) return reject(`התאריך המאוחר ביותר האפשרי הוא ${isoToHe(max)}`);
    setDraft(isoToHe(value));
    if (iso !== value) onChange?.(iso);
  }

  function openPicker() {
    const el = pickerRef.current;
    if (!el || disabled) return;
    // showPicker needs transient activation, which this click provides. It
    // throws in browsers/contexts that refuse; .click() is the old fallback.
    try { el.showPicker(); } catch { el.click(); }
  }

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 4, minWidth: 0, position: "relative", ...style }}>
      {/* dir="ltr" so the digits and slashes are not reordered inside the RTL
          page, and minWidth:0 so a flex/grid parent can shrink it instead of
          being pushed wide (lesson #30+#32). */}
      <input
        type="text"
        inputMode="numeric"
        dir="ltr"
        className={className}
        style={{ textAlign: "start", minWidth: 0, flex: "1 1 auto", ...inputStyle }}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onChange={(e) => setDraft(maskDateInput(e.target.value))}
        onBlur={(e) => { setFocused(false); commit(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === "Escape") { setDraft(isoToHe(value)); e.currentTarget.blur(); }
        }}
        {...rest}
      />
      <button
        type="button"
        className="btn btn-secondary btn-sm btn-icon"
        onClick={openPicker}
        disabled={disabled}
        aria-label="בחירת תאריך מלוח שנה"
        title="בחירת תאריך מלוח שנה"
        style={{ flex: "0 0 auto", paddingInline: 8 }}
      >
        <Calendar size={15} strokeWidth={1.75} />
      </button>
      {/* Visually hidden, NOT display:none — showPicker() refuses on an element
          that is not being rendered. */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={isValidIso(value) ? value : ""}
        min={min || undefined}
        max={max || undefined}
        disabled={disabled}
        onChange={(e) => { const v = e.target.value; if (v) commit(isoToHe(v)); }}
        style={{
          position: "absolute", bottom: 0, insetInlineEnd: 0,
          width: 1, height: 1, opacity: 0, padding: 0, border: 0,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
