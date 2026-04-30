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
1. **שתי מערכות auth במקביל** (`public.users` + `staff_members`) — `requireStaff` עם fallback מטפל; nimig10@gmail.com כבר ב-public.users.
2. **פרויקט "app" ב-Vercel מיותר** — צורך build minutes כפולים בכל push.
3. **App.jsx ענק** (~7,000 שורות) — tech debt ארוך טווח, לא חסם.

## 🎯 צעדים הבאים מומלצים (post Stage 13)
1. **למחוק פרויקט Vercel "app"** (Settings → Advanced → Delete) — מיותר.
2. **לאחד מערכות auth סופית** — להוציא את `staff_members` מהקוד (nimig10 כבר ב-public.users).
3. **לצמצם את App.jsx** (~7,000 שורות) — לפצל ל-pages/hooks.
4. **Storage לPDF** — `policy_assets` כרגע Base64 ב-TEXT; העברה ל-Supabase Storage תעשה למערכת יותר נקייה ארכיטקטונית.

## 🛠️ כלים זמינים
- **Supabase MCP** — `execute_sql`, `apply_migration`, `list_migrations`, `list_projects`
- **Vercel MCP** — `list_projects`, `get_project`, `list_deployments`, `deploy_to_vercel`
- **Git + GitHub CLI** (`gh`) — גישה מלאה ל-repo
- **Claude Preview** — לבדיקת UI ב-browser

---
*ההקשר המלא של הקוד נמצא ב-repo עצמו, והמצב הנוכחי ב-DB. כל העבודה commited + pushed.*
