# מסמך מעבר חשבון — אפליקציית "מחסן קמרה"

## 🎯 רעיון האפליקציה
אפליקציית ניהול לבית ספר לקולנוע/סאונד בישראל ("קמרה"). מערכת בעברית עם RTL.
מטרה: לנהל את מחסן הציוד, אולפני ההקלטה, מסלולי לימוד, תלמידים, מרצים, שיעורים, והקצאות הסמכה.
כולל טפסים ציבוריים להשאלת ציוד והזמנת אולפנים, פורטל מרצים, ודשבורד אדמיניסטרציה.

## 🏗️ מבנה טכני

### Frontend
- React + Vite (Hebrew, RTL)
- כל הקוד ב-`src/` — `src/App.jsx` הוא הענק המרכזי (~7,381 שורות)
- רכיבים עיקריים ב-`src/components/`

### Backend
- Vercel serverless functions ב-`api/` (Node.js)
- Supabase = Postgres + Auth + RLS
- Gmail SMTP (nodemailer) שולח מיילים (לא Resend, לא Supabase SMTP)

### Deploy
- GitHub repo: `nimig10/machsan` (main branch)
- Vercel project: "machsan" → app.camera.org.il
- יש גם פרויקט Vercel בשם "app" — מיותר, להתעלם/למחוק
- Supabase project: `wxkyqgwwraojnbmyyfco` (name: "MACHSAN CAMERA")

## 🗄️ מבנה נתונים (Supabase)

### טבלת `store` — JSONB key/value
לוב האפליקציה. כל ישות מאוחסנת כשורה עם `key` ו-`data` (JSONB):

| key | סוג | תוכן |
|---|---|---|
| `kits` | array | קיטים של ציוד לשיעורים |
| `reservations` | array (ריק כרגע — עבר ל-`reservation_items`) | השאלות |
| `equipment` | array | יחידות ציוד |
| `lessons` | array | שיעורים/קורסים |
| `lecturers` | array | מרצים |
| `studios` | array | אולפנים |
| `studio_bookings` | array | הזמנות אולפנים |
| `categories` | array | קטגוריות ציוד |
| `teamMembers` | array | צוות |
| `certifications` | object | `{types, students, trackSettings, tracks}` — הסמכות + תלמידים + מסלולים |
| `policies`, `siteSettings`, `deptHeads` | object | הגדרות |

### טבלאות נוספות
- `reservation_items` — reservations עברו לכאן (Stage 5, הקומיט `1939e73`)
- `staff_members` (ישן) + `public.users` (חדש) — שתי מערכות auth במקביל
- `activity_logs` — תיעוד פעולות (עמודות: `id, created_at, user_id, user_name, action, entity, entity_id, details`)
- `store_snapshots` — היסטוריית גיבויים אוטומטית של store (מיגרציה 011)
- `equipment_reports`, `auth_entity_map`, `staff_schedule_*`

## 🛡️ הגנות DB קריטיות (נבנו ב-2026-04)
- **`store_shrink_guard` trigger** (מיגרציה 011) — חוסם כתיבה שמצמצמת מערך מוגן ביותר מ-10% + שורה. שומר snapshot אוטומטית.
- **`is_protected_store_key()`** — פונקציה שמחזירה את רשימת המפתחות המוגנים. **אירוע קריטי ב-2026-04-19**: הפונקציה נדרסה ידנית ב-SQL Editor (על ידי AI או אדם) לרשימה מצומצמת → איבדנו 122 תלמידים + 12 סוגי הסמכות. שוחזרו מ-snapshot 234. מיגרציה 016_restore_protected_key_list החזירה את הרשימה, מיגרציה 017_lock_guard_functions חוסמת DROP של פונקציות guard.
- **`kits_content_guard` trigger** (מיגרציה 016/017) — חוסם מחיקת תוכן של 2+ קיטים בו-זמנית.

## 🔐 Auth + זרימות

### זרימת Login
- Supabase Auth (email+password או magic link)
- **בעיה ידועה**: `nimig10@gmail.com` (האדמין) נמצא ב-`staff_members` (טבלה ישנה) אבל לא ב-`public.users` → `resolveUserRole()` מחזיר `"user"`. לכן `/api/store` POST משתמש ב-`requireStaff` שיש לו fallback לטבלה הישנה.
- סיסמה מינ׳: 6 תווים (המשתמש דחה 8). קיים מיפוי הודעות שגיאה לעברית ב-`src/components/PublicForm.jsx:1444`.
- **Supabase setting חובה**: "Prevent use of leaked passwords" = OFF (אחרת HaveIBeenPwned דוחה סיסמאות).

### API auth helper: `api/_auth-helper.js`
- `requireStaff(req, res)` — צריך staff (public.users OR staff_members fallback)
- `requireAdmin(req, res)` — צריך admin
- `requireUser(req, res)` — כל משתמש מאומת
- `resolveUserRole(req)` — מחזיר `{role: "staff"|"user"|"anon"}` רק מ-public.users (בלי fallback!)

### Email
נשלח דרך Gmail SMTP עם nodemailer ב-`api/auth.js` (פונקציה `buildResetEmail`).
לא דרך Supabase SMTP. לא דרך Resend.

## 🧩 דפים עיקריים ב-App.jsx
- **אדמיניסטרציה**: ניהול חדרים, הסמכת אולפן, שיעורים, מרצים, סטודנטים (הרובריקה שהייתה פגומה), נהלים, הגדרות.
- **מחסנאי**: ניהול השאלות, ציוד, קיטים, צוות, קטגוריות, הסמכות ציוד.
- **PublicForm** (`src/components/PublicForm.jsx`) — הטופס הציבורי להשאלות + הזמנת אולפנים. משתמשי התלמידים/מרצים.
- **LecturerPortal** (`src/components/LecturerPortal.jsx`) — פורטל מרצים.
- **CertificationsPage** (`src/components/CertificationsPage.jsx`) — עריכת סוגי הסמכה ציוד/אולפן.
- **StudentsPage** (`src/components/StudentsPage.jsx`) — ניהול תלמידים + מסלולים.

## 🔄 כתיבה ל-store — `storageSet()`
ב-`src/utils.js:174`. הזרימה:
1. Client קורא `storageSet("kits", newArray)`
2. בודק sanity (מינימום פריטים) + Hebrew corruption
3. גיבוי מקומי אוטומטי למפתחות קריטיים
4. שולח JWT auth token (תוקן היום)
5. POST ל-`/api/store` (Vercel)
6. `/api/store` (`api/store.js`) — עם auth gate חדש: `STAFF_ONLY_KEYS` דורש staff; `studio_bookings` פתוח
7. כותב ל-Supabase עם `SERVICE_ROLE_KEY`
8. Trigger `store_shrink_guard` בודק ומשמור snapshot

## 🔥 נקודות חולשה/סיכון
1. **שתי מערכות auth במקביל** (`public.users` + `staff_members`) — קל לטעות איזו טבלה לבדוק.
2. **כל הנתונים ב-JSONB** — קל למחוק הכל בפעולה אחת. `store_shrink_guard` ההגנה היחידה.
3. **PublicForm מקבלת `certifications` מלא כ-state** — אם הטעינה חלקית והיא קוראת `storageSet("certifications", state)`, תכתוב cache ריק. זה מה שקרה ב-04-19.
4. **אין bundler protection** — מישהו עם גישה ל-SQL Editor יכול לדרוס פונקציות (טופל חלקית במיגרציה 017).
5. **פרויקט "app" ב-Vercel מיותר** — צורך build minutes כפולים בכל push.

## 📝 ההיסטוריה האחרונה של הסשן
- תחילה: verify של commit `1939e73`.
- הסרתי dead code (`PublicForm_REMOVED`, `CertificationsPage_REMOVED`) — ~1,100 שורות מ-App.jsx.
- תיקנתי password reset בעברית + פונט כפתור במייל.
- **אסון 04-19**: 122 תלמידים נעלמו. שיחזרתי מ-snapshot 234. גיליתי ש-`is_protected_store_key` נדרסה ידנית.
- מיגרציה `016_restore_protected_key_list` — החזרתי את רשימת המפתחות המוגנים.
- מיגרציה `017_lock_guard_functions` — DDL event trigger שחוסם DROP של פונקציות guard.
- תיקון `api/store.js` — הוספתי auth gate עם `requireStaff`. `STAFF_ONLY_KEYS` מוגדר. `studio_bookings` נשאר פתוח.
- תיקון `utils.js` — `storageSet` שולח עכשיו `Authorization: Bearer <token>`.
- תיקון `StudentsPage.jsx` — client-side shrink guard (רק students >10% או types→0).
- **Commit אחרון**: `0f39158` — "fix(auth): use requireStaff for store writes".

## 🎯 צעדים הבאים מומלצים
1. **לבדוק שהתיקון עובד**: אחרי הדיפלוי של `0f39158` — לערוך תלמיד ולראות שאין יותר 401.
2. **למחוק פרויקט Vercel "app"** (Settings → Advanced → Delete).
3. **לאחד את מערכות ה-auth** — להעביר את `nimig10@gmail.com` ל-`public.users` עם `is_admin=true`.
4. **Refactor PublicForm** — להפסיק לשלוח את `certifications` המלא כ-state; להשתמש ב-patches.
5. **לצמצם את App.jsx** — עדיין 7,381 שורות, ניתן לפצל ל-pages/hooks.

## 🛠️ כלים זמינים
- **Supabase MCP** — `execute_sql`, `apply_migration`, `list_migrations`, `list_projects`
- **Vercel MCP** — `list_projects`, `get_project`, `list_deployments`, `deploy_to_vercel`
- **Git + GitHub CLI** (`gh`) — גישה מלאה ל-repo
- **Claude Preview** — לבדיקת UI ב-browser

---
*ההקשר המלא של הקוד נמצא ב-repo עצמו, והמצב הנוכחי ב-DB. כל העבודה commited + pushed.*
