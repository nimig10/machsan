# 🗒️ לוג רוטינת הסריקה היומית

> כל הרצה יומית מוסיפה רשומה כאן (חוץ מימים ללא ממצאים — מדלגים בשקט).
> הסוכן של מחר קורא את הקובץ הזה ראשון כדי לדעת היכן עצרנו ולא לחזור על עבודה.

## 2026-05-29 — אתחול
- **נסרק:** —
- **תוקן:** אין (הקמת הרוטינה בלבד)
- **דווח (checklist):** אין
- **build/lint:** —
- הערה: הרוטינה הוקמה. הסבב האמיתי הראשון יתחיל בהרצה היומית הבאה.

## 2026-05-29 — סבב ראשון (dry-run ידני)
- **נסרק:** src/App.jsx, src/components/LessonsPage.jsx, src/utils.js
- **תוקן (safe):**
  - utils.js:692 — `ensureUnits` משווה `total_quantity` כמספר (`Number(...)`) → מונע בנייה מחדש מיותרת של units כשמגיע string.
  - utils.js:501 — `groupReservationItemsByCategory` משתמש ב-`Map` לפי id במקום `equipment.find` בלולאה (O(n+m) במקום O(n·m)).
  - LessonsPage.jsx:1153 — `isArchived` מוגן מ-null deref כש-session בלי `date` (`String(b?.date||"")`).
  - LessonsPage.jsx:2695/2714 — `normalizeLessonLecturerList(l)` מחושב פעם אחת ל-`cardLecturers` במקום פעמיים לכל כרטיס בכל render.
- **דווח (checklist, לא תוקן):** ראה גוף ה-PR — overdue-email timer reset, big Promise.all למיילים, openLessonId deps, full-table read ב-syncReservationStatusToBlob, ועוד.
- **build/lint:** PASS (0 errors)

## 2026-05-30 — סבב שני
- **נסרק:** src/App.jsx, src/components/LessonsPage.jsx, src/utils.js
- **תוקן (safe):** אין
- **דווח (checklist, לא תוקן):**
  - App.jsx:491–518 — `normalizeReservationsForArchive` (עותק מקומי) חסר את ה-guard `if (loan_type === "צוות") return normalizedReservation` שקיים ב-utils.js:665–675. הזמנות צוות שעברו `return_date` מועברות שגויה ל-"באיחור" ב-App.jsx, בעוד utils.js שומר אותן על "מאושר". לא תוקן אוטומטית — שינוי התנהגות גלויה.
- **build/lint:** PASS (0 errors)
