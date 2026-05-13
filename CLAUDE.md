# מסמך מעבר חשבון — אפליקציית "מחסן קמרה"

## 🎯 רעיון האפליקציה
אפליקציית ניהול לבית ספר לקולנוע/סאונד בישראל ("קמרה"). מערכת בעברית עם RTL.
מטרה: לנהל את מחסן הציוד, אולפני ההקלטה, מסלולי לימוד, תלמידים, מרצים, שיעורים, והקצאות הסמכה.
כולל טפסים ציבוריים להשאלת ציוד והזמנת אולפנים, פורטל מרצים, ודשבורד אדמיניסטרציה.

## 🏗️ מבנה טכני

### Frontend
- React + Vite (Hebrew, RTL)
- כל הקוד ב-`src/` — `src/App.jsx` הוא ה-shell המרכזי (~7,309 שורות) ומכיל את האורקסטרציה (state גלובלי, routing, realtime channels, auth) + מספר דפים שטרם הוצאו (`EquipmentPage`, `KitsPage`, `PoliciesPage`, `ArchivePage`, `TeamPage`, `ManagerCalendarPage`, `SettingsPage`, `DamagedEquipmentPage`, וכמה מודלים)
- **פיצול לדפים ב-`src/components/` (כבר בוצע ל-~20 דפים)**: `DashboardPage`, `ReservationsPage`, `StudentsPage`, `LessonsPage`, `LecturersPage`, `CertificationsPage`, `StudioBookingPage`, `StaffManagementPage`, `StaffSchedulePage`, `SystemSettingsPage`, `SecretaryDashboardPage`, `ActivityLogsPage`, `PublicForm`, `LecturerPortal`, `StaffHub`, `PublicDisplayPage`, `PublicDailyTablePage`, `UserGuideVideosPage`, `EditReservationModal`, `CalendarGrid`, `CalendarViews`, `AIChatBot`, `InstallPrompt`, `SmartEquipmentImportButton`, `SmartExcelImportButton`, `UserGuideVideosModal`, `ui` (Toast/Modal/Loading/statusBadge)
- Hooks תחת `src/hooks/` (כרגע: `useNotifications.js`)

### Backend
- Vercel serverless functions ב-`api/` (Node.js)
- Supabase = Postgres + Auth + RLS
- Gmail SMTP (nodemailer) שולח מיילים (לא Resend, לא Supabase SMTP)

### Deploy
- GitHub repo: `nimig10/machsan` (main branch)
- Vercel project: **רק** `machsan` → app.camera.org.il (פרויקט `app` המיותר נמחק; בארגון נשארים גם `kupa-ktana` ו-`sound-academy` שאינם קשורים לפרויקט זה)
- Supabase project: `wxkyqgwwraojnbmyyfco` (name: "MACHSAN CAMERA")

## 🔀 שני מסדי נתונים — prod ו-dev (חובה לכבד)

**תמיד יש שני DBs נפרדים. לעולם לא לערבב ביניהם.**

| סביבה | Supabase project_ref | Dashboard | מתי בשימוש |
|-------|----------------------|-----------|-------------|
| **Production** | `wxkyqgwwraojnbmyyfco` (name: `MACHSAN CAMERA`, branch `main`) | https://supabase.com/dashboard/project/wxkyqgwwraojnbmyyfco | רק כשהקוד ב-`main` רץ ב-`app.camera.org.il` |
| **Development** | `mhvujejdlmtowypjdhjd` (branch name: `develop`, parent = prod) | https://supabase.com/dashboard/project/mhvujejdlmtowypjdhjd | localhost (`.env.local`) + Vercel Preview של feature branches |

**זרימת עבודה קבועה (חובה — תמיד בודקים בלוקאל לפני פרוד):**
1. **שלב 1 — Localhost על dev DB**: עבודה לוקאלית על `http://localhost:5174` (port נעול ב-`vite.config.js`). `.env.local` מצביע על **dev** (`mhvujejdlmtowypjdhjd`). כל מיגרציה / כתיבה / SQL-טסט הולך לשם. לא מעלים שום שינוי לפני שעבר בדיקה כאן.
2. **שלב 2 — Vercel Preview על dev DB**: push ל-feature branch → Preview משתמש באותו dev DB. שלב נוסף לבדיקה (במיוחד ל-PWA / mobile).
3. **שלב 3 — Production**: רק אחרי merge ל-`main` → הקוד ב-prod רץ מול **prod DB**. מיגרציות ל-prod נעשות אך ורק כשמבצעים merge מסודר או דרך `apply_migration` MCP על הפרויקט הראשי במודע.

**אסור לדלג על שלב 1.** כל פיצ'ר חדש או תיקון, ולו הקטן ביותר, נבדק בלוקאל על port 5174 + dev DB לפני שמעלים אותו.

**כללים:**
- כברירת מחדל, כל `execute_sql`/`apply_migration` דרך MCP יעבוד על **dev** (`mhvujejdlmtowypjdhjd`) — אלא אם המשתמש ביקש במפורש לכתוב לפרוד.
- כשמשתמשים ב-Supabase MCP, חובה לוודא שה-`project_id` שמועבר תואם לסביבה הנכונה.
- אסור לרוץ מיגרציה הרסנית (`DROP`, `DELETE` רחב, שינוי schema) מול prod בלי אישור מפורש של המשתמש לסשן הנוכחי.
- אם רואים שגיאה / נתונים חסרים — קודם לוודא לאיזה DB מחוברים, ולא להניח שהבעיה בקוד.

## 🗄️ מבנה נתונים (Supabase) — Tables-only (post Stage 13)

**אין יותר `public.store`** — הטבלה והכל סביבה (`store_snapshots`, `store_shrink_guard`, `kits_content_guard`, `is_protected_store_key`, `prune_store_snapshots`, DDL guard event triggers) הוסרו במיגרציה `20260430220000_drop_store_table_and_guards`. לא נשארו blobs בDB.

כל ישות חיה בטבלה ייעודית עם RLS + realtime:

| ישות | טבלה(ות) | API util |
|------|----------|----------|
| ציוד | `equipment` + `equipment_units` | `writeEquipmentToDB` ב-`utils.js` (RPC) |
| השאלות | `reservations_new` + `reservation_items` | `createReservation`, `updateReservationStatus` |
| קיטים | `kits` | `kitsApi.js` |
| צוות | `team_members` | `teamMembersApi.js` |
| קטגוריות + סינון | `categories` + `loan_type_filters` | `categoriesApi.js` |
| מרצים | `lecturers` | `lecturersApi.js` |
| שיעורים | `lessons` | `lessonsApi.js` |
| אולפנים | `studios` | `studiosApi.js` |
| הזמנות אולפנים | `studio_bookings` | `studioBookingsApi.js` |
| מדיניות | `policies` + `policy_assets` | `policiesApi.js` |
| הגדרות אתר | `site_settings` (כולל `managerToken`) | `siteSettingsApi.js` |
| מנהל מכללה | `college_manager` | `collegeManagerApi.js` |
| ראשי מחלקה | `dept_heads` | `deptHeadsApi.js` |
| סטודנטים + הסמכות | `students` + `certification_types` + `student_certifications` + `tracks` | `studentsApi.js` |

טבלאות נוספות (לא ישויות domain): `staff_members` (ישן) + `public.users` (חדש), `activity_logs`, `equipment_reports`, `auth_entity_map`, `staff_schedule_*`.

## ✅ Pattern לפיצ'ר חדש (חובה)
כל ישות חדשה חייבת להיווצר לפי הפטרן הזה. אסור — חזרתית, עם guard ב-ESLint — ליצור JSONB blob חדש או להשתמש ב-`storageGet/storageSet`/`api/store`.

1. **מיגרציה ב-`supabase/migrations/`** — `CREATE TABLE` עם עמודות מפורשות, `created_at`/`updated_at`, `touch_updated_at` trigger, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, ושלוש policies סטנדרטיות:
   - `service_role_all_<table>` — `FOR ALL TO service_role USING (true) WITH CHECK (true)`
   - `staff_all_<table>` — `FOR ALL TO authenticated USING (public.is_staff_member()) WITH CHECK (public.is_staff_member())`
   - `anon_read_<table>` — `FOR SELECT TO anon, authenticated USING (true)` (רק אם הטבלה מוצגת לציבור)
   - `ALTER PUBLICATION supabase_realtime ADD TABLE public.<table>` (אם צריך realtime)
2. **API util ב-`src/utils/<entity>Api.js`** עם singleton supabase client (`import { supabase } from "../supabaseClient.js"`). חתימות סטנדרטיות: `list<Entity>()`, `upsert<Entity>(row)`, `delete<Entity>(id)`, `syncAll<Entity>(arr)`. עיין ב-`kitsApi.js`/`teamMembersApi.js` כתבניות.
3. **App.jsx wrapper** ב-pattern של `loadKitsWrapped` — try/catch + source flag.
4. **Realtime channel** ב-App.jsx (אם הטבלה מתעדכנת בריצה) עם 400ms debounce.
5. **JSONB מותר רק** עבור value heterogeneous (כמו `site_settings.value`) או metadata חופשי קטן. לא להשתמש בJSONB כדי לאחסן מערכי domain רחב.

## 🛡️ Guardrails חיים
- **ESLint** ב-`eslint.config.js` חוסם: `storageGet(...)`, `storageSet(...)`, `supabase.from('store'...)`, `from('store_snapshots'...)`, `/api/store`. כל ניסיון להוסיף קוד כזה נכשל ב-`npm run lint`.
- **Supabase**: הטבלה `public.store` לא קיימת בDB. כל מי שינסה לקרוא/לכתוב יקבל שגיאת relation does not exist.
- נכון ל-2026-05-02: כל RPCs/triggers/tables של עידן ה-blob נמחקו לחלוטין (migrations `20260430220000` + `20260502000000`). RPCs פעילות שעדיין מתפקדות: `sync_equipment_from_json` (write path לציוד דרך `/api/sync-equipment`), ו-`create_reservation_v2`/`update_reservation_status_v1`/`delete_reservation_v1`/`create_lesson_reservations_v1` להזמנות — כולן כותבות אך ורק לטבלאות מנורמלות.

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

## 🔄 כתיבה לDB — Pattern החדש
כל ישות נכתבת דרך API util ייעודי שלה. דוגמא:
```js
import { syncAllKits, upsertKit, deleteKit } from "../utils/kitsApi.js";
await upsertKit({ id, name, items });          // single row upsert
await syncAllKits(arr);                         // batch upsert + delete-missing
await deleteKit(id);                            // single row delete
```
תחת המנוע: כל util משתמש ב-singleton `supabase` client → `supabase.from("<table>").upsert(...)` → RLS בודקת `is_staff_member()` → realtime בערוץ הטבלה משדר ל-tabs אחרים.

**אסור**:
- ❌ `storageGet`, `storageSet` (הוסרו, ESLint יחסום)
- ❌ `fetch("/api/store")` (הendpoint נמחק)
- ❌ `supabase.from("store")` (הטבלה לא קיימת)
- ❌ JSONB column חדש למערכי domain (השתמש בטבלה ייעודית)

## 🔥 נקודות חולשה/סיכון
1. **שתי מערכות auth במקביל** (`public.users` + `staff_members`) — הזרימה הראשית כבר ב-`public.users`, אבל `requireStaff`/`requireAdmin` ב-[api/_auth-helper.js:81-87](api/_auth-helper.js#L81-L87) עדיין מחזיקים fallback ל-`staff_members` (legacy) למקרים שלא היגרו. הטבלה הישנה עוד קיימת ו-15 קבצים מתייחסים אליה.
2. **App.jsx עדיין ~7.3k שורות** — מכיל את ה-shell + state גלובלי + ~8 דפים שטרם חולצו (`EquipmentPage`, `KitsPage`, `PoliciesPage`, `ArchivePage`, `TeamPage`, `ManagerCalendarPage`, `SettingsPage`, `DamagedEquipmentPage`). tech debt, לא חסם.
3. **`policy_assets` מאחסן PDF כ-Base64 ב-TEXT** — לא חסם אבל לא ארכיטקטונית נקי; כל קריאת מדיניות מושכת את כל ה-blob.

## 🎯 צעדים הבאים מומלצים (post Stage 13)

**✅ כבר בוצעו:**
- מחיקת פרויקט Vercel "app" המיותר.
- חילוץ ~20 דפים ראשיים מ-App.jsx ל-`src/components/` (Dashboard, Reservations, Students, Lessons, Lecturers, Certifications, StudioBooking, StaffManagement, StaffSchedule, SystemSettings, SecretaryDashboard, ActivityLogs, PublicForm, LecturerPortal, StaffHub, ועוד).
- העברת הזרימה הראשית של auth ל-`public.users` (nimig10@gmail.com + שאר הצוות כבר שם; הקומיט `e4895d2` מסנכרן עריכת permissions ל-public.users).

**עדיין פתוח:**
1. **לסגור את `staff_members` סופית** — להסיר את ה-fallback מ-`api/_auth-helper.js` (`requireStaff`/`requireAdmin`), לעבור על 15 הקבצים שמתייחסים לטבלה, ולמחוק את הטבלה במיגרציה. דרושה ודאות שכל המשתמשים הקיימים היגרו ל-`public.users`.
2. **לסיים את פיצול App.jsx** — להוציא את ה-8 דפים הנותרים (`EquipmentPage` ~700 שורות, `TeamPage` ~460, `ManagerCalendarPage` ~370, `KitsPage` ~370, `SettingsPage` ~230, `PoliciesPage` ~200, `ArchivePage` ~200, `DamagedEquipmentPage`). שאיפה: App.jsx <2k שורות (רק shell/state/routing).
3. **`policy_assets` ל-Supabase Storage** — להחליף את `data_base64` (TEXT) ב-bucket עם signed URL; טעינת מדיניות תוכל למשוך URL בלבד במקום blob.

## 🛠️ כלים זמינים
- **Supabase MCP** — `execute_sql`, `apply_migration`, `list_migrations`, `list_projects`
- **Vercel MCP** — `list_projects`, `get_project`, `list_deployments`, `deploy_to_vercel`
- **Git + GitHub CLI** (`gh`) — גישה מלאה ל-repo
- **Claude Preview** — לבדיקת UI ב-browser

---
*ההקשר המלא של הקוד נמצא ב-repo עצמו, והמצב הנוכחי ב-DB. כל העבודה commited + pushed.*
