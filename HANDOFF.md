# Handoff — `feat/user-guide-videos-per-audience`

> מסמך מעבר בין מחשבים. תאריך: 2026-05-12 (לפי `currentDate` של המכונה הקודמת).

## איפה אנחנו

- **Branch**: `feat/user-guide-videos-per-audience`
- **HEAD commit**: `e0430be` — `feat(user-guide): audience-specific guides for Staff Hub + Lecturer Portal`
- **Base**: `main` (`820ac62`)
- **PR**: https://github.com/nimig10/machsan/pull/13 — **פתוח, לא מוזג**

## מה הפיצ'ר עושה

הוספת 2 מסלולי "המדריך למשתמש" במקביל לזה של הסטודנט הקיים. שלושה אגנים עצמאיים ב-`site_settings`:

| קהל | מקור הסרטונים | איפה נצפים |
|---|---|---|
| **סטודנטים** (קיים, ללא שינוי) | `userGuideVideos` | PublicForm → InfoPanel → tab `userGuide` |
| **צוות** (חדש) | `staffUserGuideVideos` | Staff Hub → כפתור "המדריך למשתמש" → **דף מלא** עם "חזרה ל-Staff Hub" |
| **מרצים** (חדש) | `lecturerUserGuideVideos` | Lecturer Portal → כפתור "המדריך למשתמש" ליד "ארכיון קורסים" → **modal צף** |

תמיכה ב-YouTube + Google Drive + orientation אופקי/אנכי — אותה לוגיקת `videoEmbedSrc` כמו הסטודנט.

## קבצים שהשתנו (commit `e0430be`)

| קובץ | סוג |
|---|---|
| `src/components/UserGuideVideosPage.jsx` | **חדש** — דף מלא (Staff Hub) |
| `src/components/UserGuideVideosModal.jsx` | **חדש** — modal (Lecturer Portal) |
| `src/components/SystemSettingsPage.jsx` | modified — חילוץ ל-`renderVideoPanel({draftKey, title, description})` + 3 קריאות |
| `src/components/StaffHub.jsx` | modified — כפתור "המדריך למשתמש" → `onNavigate("user-guide")` |
| `src/components/LecturerPortal.jsx` | modified — כפתור "המדריך למשתמש" ליד "ארכיון קורסים" + modal |
| `src/App.jsx` | modified — `staffView === "user-guide"` route חדש + import |

**אין שינוי schema** (`site_settings` הוא JSONB key/value — מפתחות חדשים נכתבים בשמירה הראשונה).

## איך לחדש עבודה במכונה אחרת

```bash
git fetch origin
git checkout feat/user-guide-videos-per-audience
git pull
npm install   # אם חבילה כלשהי השתנתה — כרגע לא
npm run dev   # localhost:5174 + host:true → נגיש גם מ-LAN
```

`.env.local` חייב להצביע על dev DB (`mhvujejdlmtowypjdhjd`) — קיים כבר, אל תשנה אותו.

## בדיקות שעדיין לא בוצעו במלואן

- [ ] Admin login → "הגדרות מערכת" → לראות **3 פאנלי** "המדריך למשתמש" (סטודנטים / צוות / מרצים)
- [ ] להעלות סרטון בכל פאנל (1 אופקי, 1 אנכי) → "שמור הגדרות"
- [ ] **Staff Hub** → "המדריך למשתמש" → דף מלא עם רק הסרטונים של הצוות → "חזרה ל-Staff Hub" עובד
- [ ] **Lecturer Portal** → "המדריך למשתמש" ליד "ארכיון קורסים" → modal עם רק סרטוני המרצים
- [ ] **PublicForm** (סטודנט) → InfoPanel → tab "userGuide" → הסרטונים של הסטודנטים בלבד (regression)
- [ ] Orientation: סרטון אנכי 9:16, אופקי 16:9 בתצוגת fullscreen
- [ ] PWA/Mobile: 192.168.1.98:5174 — פתיחה תקינה במסך 360px
- [ ] בדיקת prod אחרי merge

## החלטות UX לאורך הדרך

1. **Staff = דף מלא, מרצים = modal** — לפי בקשת המשתמש בשיחה הקודמת. Staff Hub מנוטר באמצעות `setStaffView("user-guide")` כך שמתאים לתבנית הניווט הקיימת.
2. **לא לעשות refactor ל-InfoPanel הקיים** — הקוד של ה-tab `userGuide` ב-PublicForm.jsx נשאר זהה כדי לא לסכן רגרסיה לסטודנטים.
3. **`videoEmbedSrc` מוכפל בכוונה** ב-`UserGuideVideosPage.jsx` + `UserGuideVideosModal.jsx` (וב-PublicForm.jsx). 8 שורות קוד. אם כן רוצים — מאוחר יותר לחלץ ל-`utils.js`.
4. **לא הוגן ב-admin role** — כפתור "המדריך למשתמש" ב-Staff Hub זמין לכל הצוות (לא רק admin). admin הוא היחיד שמעלה דרך "הגדרות מערכת".
5. **App.jsx: ה-`staffView === "user-guide"` view לא עטוף ב-`topbar`** — `UserGuideVideosPage` מנהל header משלו (כותרת + "חזרה ל-Staff Hub"). הוסר ב-iteration אחרון לפי בקשת המשתמש.

## נקודות פתוחות / שאלות לעצמך

1. **האם להחיל את ה-page pattern גם על Lecturer Portal?** — כרגע מרצים רואים modal. אם המשתמש יבקש — להחליף ל-route נפרד.
2. **האם לחלץ `videoEmbedSrc` ל-`utils.js`?** — אופציונלי, יבטל 3 העתקים.
3. **PR #13 לא נבדק בפרוד עדיין** — להמתין לבדיקה לוקאלית מלאה לפני merge.

## פעולות לפני merge ל-main

1. ✅ Vite build נקי (אומת ×4)
2. ✅ אין `console.log` / TODO / FIXME ברכיבים החדשים
3. [ ] בדיקות מלאות (ראה checklist למעלה)
4. [ ] Merge דרך GitHub UI (squash recommended)
5. [ ] Vercel auto-deploy → בדיקה ב-`app.camera.org.il`

## הקשר שצריך לדעת לשיחה הבאה

- העבודה האחרונה הייתה PR #11 (`3fe16ad`) — 4-feature bundle כולל "רשימות ציוד", פילטרי calendar, תאריכי החודש הקודם/הבא, ועריכת דיווחי סטודנט. כל זה כבר ב-main.
- PR #12 (`7695cdd`) — post-audit fixes (list-mine email encoding + modal state leak). ב-main.
- כל הפיצ'רים האחרונים בפרוד היו display-only. אין מיגרציות פתוחות. DB schema של prod ו-dev מסונכרן.
- אם נדרשת בדיקה של dev DB: project_id `mhvujejdlmtowypjdhjd`.
- אם נדרש prod: project_id `wxkyqgwwraojnbmyyfco` — תמיד לבקש אישור לפני כתיבה.

## משתמשים לבדיקה (dev DB)

- `nimig10+s50@gmail.com` / `nini90` — סטודנט סאונד
- (יוצרים נוספים לפי הצורך)
