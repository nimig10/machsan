# מסמך מעבר חשבון — אפליקציית "מחסן קמרה"

## 📦 שינויים אחרונים שעלו לפרוד

- **2026-05-21** — עדכון מצב אחרי pull ל-`38a9f25` וסריקה מול הקוד + Supabase MCP, כולל הצלבה מול production ו-dev.
  - `src/App.jsx` כרגע ~7,044 שורות. 8 דפים עדיין inline, אבל מספרי השורות זזו.
  - `src/components/` מכיל 32 קבצי JSX, כולל `StudentHub`, `ProductionsPage`, `ProductionEditor`, `ErrorBoundary`.
  - production (`wxkyqgwwraojnbmyyfco`) נבדק read-only דרך `supabase_codex`/`supabase-codex`: המצב התפעולי נראה תקין. RLS מופעל על 6 הטבלאות המרכזיות, אין auth orphans, ואין FK שמצביע ל-`staff_members`.
  - dev (`mhvujejdlmtowypjdhjd`) משמש לבדיקות בלבד ואינו מיושר לגמרי ל-production: RLS כבוי על 6 טבלאות מרכזיות, ויש עדיין 3 FK constraints שמצביעים ל-`staff_members`.
  - `staff_members` כבר לא משמש fallback פעיל בקוד `api/`/`src`; `api/_auth-helper.js` פותר staff רק דרך `public.users`. הטבלה עדיין קיימת ב-DB: ב-production יש 9 rows, ב-dev יש row אחד.
  - `policy_assets` עדיין מאחסן PDFs כ-Base64 ב-DB. זה tech debt/ביצועים, לא חסם מיידי: production מכיל row אחד (~221KB Base64), dev מכיל 4 rows (~1.95MB Base64).
  - auth orphans נבדקו ב-read-only ונמצאו נקיים בשתי הסביבות: production `auth.users`=104 ו-`public.users`=104; dev `auth.users`=6 ו-`public.users`=6.
  - בדיקות: `npm run lint` עובר עם 229 warnings קיימות; `npm run build` עובר אחרי הרצה מחוץ ל-sandbox.
- **2026-05-18** — לוח הפקות (PR #15) עלה לפרוד עם 25 מיגרציות.
  - 4 טבלאות חדשות: `productions`/`production_dates`/`production_crew`/`production_slots` + `productions.kit_id` (FK ל-`kits`).
  - StudentHub חדש (מסך נחיתה לסטודנט) + tab "לוח הפקות" ב-LecturerPortal לראשי מחלקה.
  - Per-student overlap guard + director-overlap guard ב-`create_reservation_v2`/`production_dates` triggers.
  - מדיניות 8 ימי הודעה (inclusive) להגשת רשימת ציוד להפקה (היה 9).
  - Mobile fixes לעורך ההפקה (crew + dates rows).
  - **`OVERDUE_BLOCK_BUFFER_MS = 48h`** — הזמנת `באיחור` חוסמת השאלה עתידית רק 48 שעות אחרי `return_date` המתוכנן (במקום לעולם). מוגדר ב-`src/utils.js` + `src/App.jsx`.

## 🎯 רעיון האפליקציה
אפליקציית ניהול לבית ספר לקולנוע/סאונד בישראל ("קמרה"). מערכת בעברית עם RTL.
מטרה: לנהל את מחסן הציוד, אולפני ההקלטה, מסלולי לימוד, תלמידים, מרצים, שיעורים, והקצאות הסמכה.
כולל טפסים ציבוריים להשאלת ציוד והזמנת אולפנים, פורטל מרצים, ודשבורד אדמיניסטרציה.

## 🏗️ מבנה טכני

### Frontend
- React + Vite (Hebrew, RTL).
- `src/App.jsx` הוא ה-shell המרכזי (~7,044 שורות נכון ל-2026-05-21). מכיל orchestration גלובלי: state, routing, realtime channels, auth bootstrap. בנוסף עדיין מוטמעים בו 8 דפים שלא חולצו.
- 32 קבצי JSX ב-`src/components/`. הדפים/רכיבים שכבר חולצו (alphabetical):
  `ActivityLogsPage`, `ArchivePage` *(קובץ קיים אבל לא מיובא — הפעיל הוא inline ב-App.jsx)*, `CertificationsPage`, `DashboardPage`, `EditReservationModal`, `ErrorBoundary`, `LecturerPortal`, `LecturersPage`, `LessonsPage`, `ProductionEditor`, `ProductionsPage`, `PublicDailyTablePage`, `PublicDisplayPage`, `PublicForm`, `ReservationsPage`, `SecretaryDashboardPage`, `StaffHub`, `StaffManagementPage`, `StaffSchedulePage`, `StudentHub`, `StudentsPage`, `StudioBookingPage`, `SystemSettingsPage`, `UserGuideVideosModal`, `UserGuideVideosPage`. רכיבים תומכים: `AIChatBot`, `CalendarGrid`, `CalendarViews`, `InstallPrompt`, `SmartEquipmentImportButton`, `SmartExcelImportButton`, `ui` (Toast/Modal/Loading/StatusBadge).
- Hooks ב-`src/hooks/`: רק `useNotifications.js` כרגע.
- API utils ב-`src/utils/`: 14 utils של ישויות + שני utils תומכים (`jewishHolidays.js`, `lessonBookings.js`).

### Backend
- Vercel serverless functions ב-`api/` (Node.js, runtime 22).
- Supabase = Postgres + Auth + RLS + Realtime.
- Gmail SMTP (nodemailer) ב-`api/auth.js` שולח מיילים (קישורי password reset). **לא Supabase SMTP, לא Resend.**

### Deploy
- GitHub repo: `nimig10/machsan` (main branch).
- Vercel project: `machsan` בלבד → `app.camera.org.il` (פרויקטים נוספים בארגון `kupa-ktana` ו-`sound-academy` לא קשורים לפרויקט זה).
- Supabase project (prod): `wxkyqgwwraojnbmyyfco` (name: "MACHSAN CAMERA").

## 🔀 שני מסדי נתונים — prod ו-dev (חובה לכבד)

**תמיד יש שני DBs נפרדים. לעולם לא לערבב ביניהם.**

| סביבה | Supabase project_ref | Dashboard | מתי בשימוש |
|-------|----------------------|-----------|-------------|
| **Production** | `wxkyqgwwraojnbmyyfco` (name: `MACHSAN CAMERA`, branch `main`) | https://supabase.com/dashboard/project/wxkyqgwwraojnbmyyfco | רק כשהקוד ב-`main` רץ ב-`app.camera.org.il` |
| **Development** | `mhvujejdlmtowypjdhjd` (branch name: `develop`, parent = prod) | https://supabase.com/dashboard/project/mhvujejdlmtowypjdhjd | localhost (`.env.local`) + Vercel Preview של feature branches |

**זרימת עבודה קבועה (חובה — תמיד בודקים בלוקאל לפני פרוד):**
1. **שלב 1 — Localhost על dev DB**: `http://localhost:5174` (port נעול ב-`vite.config.js`). `.env.local` מצביע על **dev** (`mhvujejdlmtowypjdhjd`). כל מיגרציה / כתיבה / SQL-טסט הולך לשם.
2. **שלב 2 — Vercel Preview על dev DB**: push ל-feature branch → Preview מתחבר לאותו dev DB. שלב נוסף לבדיקה במיוחד ל-PWA / mobile.
3. **שלב 3 — Production**: רק אחרי merge ל-`main` הקוד רץ מול **prod DB**. מיגרציות ל-prod נעשות אך ורק כשמבצעים merge מסודר, או דרך `apply_migration` MCP על הפרויקט הראשי במודע.

**אסור לדלג על שלב 1.** כל פיצ'ר/תיקון, אפילו הקטן ביותר, נבדק בלוקאל על port 5174 + dev DB לפני שמעלים.

**כללים:**
- כברירת מחדל, כל `execute_sql`/`apply_migration` דרך MCP פועל על **dev** (`mhvujejdlmtowypjdhjd`) — אלא אם המשתמש ביקש במפורש לכתוב לפרוד.
- כשמשתמשים ב-Supabase MCP, חובה לוודא שה-`project_id` שמועבר תואם לסביבה.
- אסור לרוץ מיגרציה הרסנית (`DROP`, `DELETE` רחב, שינוי schema) מול prod בלי אישור מפורש של המשתמש לסשן הנוכחי.
- אם רואים שגיאה / נתונים חסרים — קודם לוודא לאיזה DB מחוברים, לא להניח שהבעיה בקוד.

## 🗄️ מבנה נתונים (Supabase) — Tables-only

**אין `public.store`** — הוסר ב-`20260430220000_drop_store_table_and_guards` יחד עם כל המנגנון מסביבו (`store_snapshots`, `store_shrink_guard`, `kits_content_guard`, `is_protected_store_key`, `prune_store_snapshots`, DDL guard event triggers). לא נשארו blobs ב-DB.

**33 טבלאות `public` קיימות (verified):**

| ישות domain | טבלה(ות) | API util |
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
| מדיניות + נכסי PDF | `policies` + `policy_assets` | `policiesApi.js` |
| הגדרות אתר | `site_settings` (כולל `managerToken`) | `siteSettingsApi.js` |
| מנהל מכללה | `college_manager` | `collegeManagerApi.js` |
| ראשי מחלקה | `dept_heads` | `deptHeadsApi.js` |
| סטודנטים + הסמכות | `students` + `certification_types` + `student_certifications` + `tracks` | `studentsApi.js` |
| **לוח הפקות** | `productions` + `production_dates` + `production_crew` + `production_slots` | `productionsApi.js` |

טבלאות תומכות (לא domain): `users` (מראת auth ו-source הפעיל להרשאות צוות), `staff_members` (legacy; הטבלה עדיין קיימת אך fallback הקוד הוסר), `activity_logs`, `equipment_reports`, `auth_entity_map`, `staff_schedule_assignments`, `staff_schedule_preferences`, `staff_daily_tasks`, `auth_rate_limits`.

`reservations_new` קיבל שתי עמודות FK אופציונליות: `production_id` (→ `productions.id`, ON DELETE SET NULL) ו-`production_date_id` (→ `production_dates.id`, ON DELETE SET NULL). הזמנות שאינן הפקה — שתי העמודות NULL.

`productions` כולל גם `kit_id` (→ `kits.id`, ON DELETE SET NULL). כש-`kit_id` מוגדר, השאלת ההפקה מוגבלת לפריטי הערכה בלבד; NULL = "כללית" (ללא הגבלה).

**RPCs פעילות:**
- כתיבה לציוד: `sync_equipment_from_json`.
- הזמנות: `create_reservation_v2`, `create_lesson_reservations_v1`, `update_reservation_status_v1`, `delete_reservation_v1`, `restore_reservation_v1`, `student_modify_reservation_item_v1`, `mark_overdue_email_sent`.
- **לוח הפקות**: `production_approve_crew_v1`, `production_check_crew_conflict_v1`, `production_crew_change_recheck_v1`, `production_delete_v1`, `crew_is_certified_for_equipment`, `check_director_no_overlap_for_production`, `run_productions_regression_tests` (read-only).
- בדיקות overlap: `assert_reservation_overlap_ok`, `run_reservation_overlap_tests`.
- Auth helpers: `is_admin`, `is_staff_member`, `is_known_lecturer_email`, `link_auth_to_entity`.
- Triggers: `touch_updated_at`, `set_updated_at`, `update_users_updated_at`, `production_crew_after_change_trigger`, `production_dates_director_overlap_trg`, `productions_status_director_overlap_trg`, `production_crew_photographer_sound_must_be_student`.

**ספירות/מצב חיים לפי Supabase MCP (snapshot 2026-05-21, read-only):**
- **production** (`wxkyqgwwraojnbmyyfco`, namespace `mcp__supabase_codex__`): `public.users`=104, `staff_members`=9, `productions`=3. RLS מופעל על `users`, `equipment`, `equipment_units`, `reservations_new`, `reservation_items`, `staff_daily_tasks`; אין auth orphans; אין FK ל-`staff_members`; `policy_assets` מכיל row אחד (~221KB Base64).
- **dev** (`mhvujejdlmtowypjdhjd`, namespace `mcp__supabase__`): `public.users`=6, `students`=10, `lecturers`=15, `staff_members`=1, `productions`=6. `get_project_url` החזיר `https://mhvujejdlmtowypjdhjd.supabase.co`. dev הוא סביבת בדיקות בלבד ואינו מיושר לגמרי ל-production.

**RLS advisory חי (2026-05-21):** האזהרה הקריטית קיימת ב-dev בלבד: RLS כבוי על `public.users`, `public.equipment`, `public.equipment_units`, `public.reservations_new`, `public.reservation_items`, `public.staff_daily_tasks`. ב-production RLS מופעל על הטבלאות האלה. לא להפעיל RLS אוטומטית ב-dev בלי policies תואמות, כי זה עלול לחסום קריאות/כתיבות קיימות.

## ✅ Pattern לפיצ'ר חדש (חובה)
כל ישות חדשה חייבת להיווצר לפי הפטרן הזה. אסור — חזרתית, עם guard ב-ESLint — ליצור JSONB blob חדש או להשתמש ב-`storageGet/storageSet`/`api/store`.

1. **מיגרציה ב-`supabase/migrations/`** — `CREATE TABLE` עם עמודות מפורשות, `created_at`/`updated_at`, `touch_updated_at` trigger, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, ושלוש policies סטנדרטיות:
   - `service_role_all_<table>` — `FOR ALL TO service_role USING (true) WITH CHECK (true)`
   - `staff_all_<table>` — `FOR ALL TO authenticated USING (public.is_staff_member()) WITH CHECK (public.is_staff_member())`
   - `anon_read_<table>` — `FOR SELECT TO anon, authenticated USING (true)` (רק אם הטבלה מוצגת לציבור)
   - `ALTER PUBLICATION supabase_realtime ADD TABLE public.<table>` (אם צריך realtime)
2. **אינדקסים unique** — אם יש שדה שצריך להיות ייחודי (כמו email), הוסף UNIQUE index ו**ודא שכל ה-dedup בצד הקליינט עובד על אותו שדה**, לא על שדה אחר (ראה הערה על email-first dedup בסעיף "לקחים נלמדו").
3. **API util ב-`src/utils/<entity>Api.js`** עם singleton supabase client (`import { supabase } from "../supabaseClient.js"`). חתימות סטנדרטיות: `list<Entity>()`, `upsert<Entity>(row)`, `delete<Entity>(id)`, `syncAll<Entity>(arr)`. תבניות: `kitsApi.js`/`teamMembersApi.js`.
4. **App.jsx wrapper** ב-pattern של `loadKitsWrapped` — try/catch + source flag.
5. **Realtime channel** ב-App.jsx (אם הטבלה מתעדכנת בריצה) עם 400ms debounce.
6. **JSONB מותר רק** עבור value heterogeneous (כמו `site_settings.value`) או metadata חופשי קטן. לא לאחסון מערכי domain רחבים.

### Batched writes (חובה לישויות גדולות)
לישות עם N>~20 שורות (תלמידים, ציוד, מרצים), אסור לעטוף את כל ה-rows ב-`Promise.all` יחיד — זה רווי את ה-HTTP/1.1 per-host limit ויוצר `ERR_CONNECTION_CLOSED` בקנה מידה (ראה `studentsApi.syncAllStudents` עם `inBatches(rows, fn, 4)`). כשהאדמין עורך שורה אחת, לחשב diff מ-prev ל-next ולשלוח רק את ההפרשים (`syncStudentsDiff` + `studentDiff` ב-`dualWriteCertifications`).

## 🛡️ Guardrails חיים
- **ESLint** ב-`eslint.config.js` חוסם: `storageGet(...)`, `storageSet(...)`, `supabase.from('store'...)`, `from('store_snapshots'...)`, `/api/store`. כל ניסיון להוסיף קוד כזה נכשל ב-`npm run lint`.
- **Supabase**: הטבלה `public.store` לא קיימת. כל קריאה/כתיבה מקבלת `relation does not exist`.
- כל RPCs/triggers/tables של עידן ה-blob נמחקו לחלוטין (מיגרציות `20260430220000` + `20260502000000`). פעילות נשארו רק כתיבה לציוד (`sync_equipment_from_json`) וזרימת הזמנות מנורמלת (`create_reservation_v2`, `update_reservation_status_v1`, `delete_reservation_v1`, `create_lesson_reservations_v1`, `restore_reservation_v1`, `student_modify_reservation_item_v1`).

## 🚨 כלל ברזל: סטטוסים שחוסמים מלאי

**רק** ההזמנות בסטטוסים הבאים נספרות כתופסות מלאי / חוסמות בקשות חדשות חופפות:
- `מאושר` — אישור איש המחסן (הציוד התחייב לבקשה)
- `באיחור` — הציוד עוד בחוץ אחרי תאריך החזרה
- `פעילה` — הציוד יצא לסטודנט

**לא חוסמות** (לעולם!): `ממתין`, `אישור ראש מחלקה`, `נדחה`, `הוחזר`, `בוטל`.

הסיבה: כל עוד הבקשה לא הגיעה לסטטוס `מאושר`, היא לא תופסת מלאי בפועל. רק אישור איש המחסן הופך אותה למחויבת. שני סטודנטים יכולים להחזיק `ממתין` חופפים על אותו פריט — איש המחסן יבחר את מי לאשר.

### תת-כלל: חלון 48h ל-`באיחור` (2026-05-18)

הזמנת `באיחור` חוסמת השאלות עתידיות **רק כאשר** ה-borrow_date של ההשאלה החדשה נופל בטווח של **48 שעות אחרי** ה-`return_date` המתוכנן של ההזמנה הבאיחור. השאלה שמתחילה מעבר ל-48h — לא חסומה (מניחים שהציוד יחזור).

מימוש: קבוע `OVERDUE_BLOCK_BUFFER_MS = 48 * 60 * 60 * 1000` ב-[src/utils.js](src/utils.js) + [src/App.jsx](src/App.jsx). מוחל ב-4 מקומות: 2 copies של `availableUnitsAt` + 2 copies של `getReservationApprovalConflicts`. ה-overlap check בצד ה-server (`create_reservation_v2`) משתמש בתאריכי ההזמנה הממשיים — לא נחוץ buffer שם.

**Anti-regression**: כל שינוי ב-`create_reservation_v2`, ב-`update_reservation_status_v1`, או ביצירת RPC חדש שעושה overlap-check — חובה לאמת ש-`r.status IN ('מאושר','באיחור','פעילה')` בלבד. ראה `supabase/migrations/20260516160000_create_reservation_v2_pending_not_blocking.sql` — תיקון של רגרסיה שכללה `ממתין` ברשימה החוסמת.

## 🎬 לוח הפקות (Productions Board)

הפיצ'ר נכנס לפרוד ב-2026-05-18 (PR #15). מערכת תכנון הפקות שמהקדם את זרימת השאלת הציוד — הבמאי מפרסם הפקה, מרכיב צוות, ורק אז קופץ לטופס השאלת ציוד דרך bridge ייעודי.

**ארכיטקטורה:**
- 4 טבלאות: `productions` (parent), `production_dates` (1..N תאריכי צילום), `production_crew` (1..N תפקידי צוות + הזמנות), `production_slots` (תשתית קיימת, לא בשימוש מהקליינט נכון לעכשיו).
- `reservations_new` קיבל FK אופציונליים: `production_id` + `production_date_id`. הזמנת הפקה מקושרת לטווח תאריכים ספציפי.
- `productions.kit_id` (אופציונלי): כש-set, השאלת ההפקה תוגבל אך-ורק לפריטי הערכה ההיא. NULL = "כללית" (חופשי).

**זרימה מצומצמת:**
1. **סטודנט קולנוע מתחבר → StudentHub** (`src/components/StudentHub.jsx`) — מסך נחיתה עם 2 כרטיסים: "מערכת הפניות" / "לוח הפקות".
2. **לוח הפקות** (`ProductionsPage`) — board (כל ההפקות המפורסמות), inbox (בקשות נכנסות/יוצאות). הסינון לפי שם סטודנט הוא טקסט-חופשי (לא חושף רשימה).
3. **יצירת הפקה** (`ProductionEditor`) — כותרת, תיאור (800 תווים), Drive URL אופציונלי, צבע, **סוג ההפקה** (כללית / kit), תאריכי צילום (עד 7 ימים לטווח), צוות (פוטוגרף + סאונד חייבים סטודנט רשום; שאר התפקידים יכולים להיות מותאמים אישית או placeholders ריקים).
4. **בקשת הצטרפות** (`requestJoinProduction`) — סטודנט אחר רואה את ההפקה, בוחר תפקיד פתוח, הבמאי מאשר/דוחה.
5. **השאלת ציוד להפקה** — מהעורך/Detail modal יש כפתור "השאלת ציוד להפקה" שעובר ל-PublicForm עם `loan_type="הפקה"` + `production_id` ממולאים. בצעד 2 מוצגים chips של תאריכי הצילום (טווחים שכבר הוגשה רשימה עבורם — נסתרים). בצעד 3, אם להפקה יש `kit_id`, התפריט נעול לפריטי הערכה.

**חוקים יחודיים להפקה (לא משפיעים על פרטית/סאונד/קולנוע יומית/שיעור):**
- **8 ימים מראש (inclusive)** להגשת רשימת ציוד — היום נספר כיום 0, החל מ-PR #15. כל חישוב deadline פר-תאריך-צילום מבוסס על זה.
- **per-student overlap guard ב-`create_reservation_v2`**: אותו `lower(email)` לא יכול להגיש 2 השאלות פעילות עם חפיפת זמנים (כל סוג השאלה, לא רק הפקה). סטטוסים פעילים = הכל חוץ מ-`בוטל`/`הוחזר`/`נדחה`.
- **director-overlap guard ב-`productions` + `production_dates` triggers**: אותו `director_student_id` לא יכול להיות במאי של 2 הפקות published עם חפיפת `production_dates`. אישור crew membership של סטודנט בכמה הפקות חופפות **כן מותר** (ההגבלה היחידה היא ברמת הבמאי).
- **`production_dates_max_7_days`** CHECK constraint: `end_date - start_date <= 6`.
- **Cert recheck**: אם הצלם או הסאונדמן משתנים על הפקה שכבר יש לה הזמנת ציוד מאושרת, ה-trigger `production_crew_after_change_trigger` מפעיל את `production_crew_change_recheck_v1` שבודק certs בכל פריטי הציוד — אם הצוות החדש לא מוסמך, ההזמנה חוזרת ל-`ממתין`.
- **`student_modify_reservation_item_v1`** מקבל גם סטטוס `אישור ראש מחלקה` (נוסף ב-PR #15) — אז סטודנט/במאי יכול להסיר פריטים או לבטל את כל ההזמנה גם אחרי שעברה לראש מחלקה.

**גישה לראשי מחלקה**: `LecturerPortal` הוסיף tab שלישי "לוח הפקות" שגלוי רק אם `myDeptHead` קיים. הוא משתמש באותו `ProductionsPage` במצב read-only (`currentStudent={null}` → אין יצירה/עריכה/הצטרפות).

**Anti-regressions:**
1. **השאלות אחרות לא הושפעו**: כל הלוגיקה החדשה בקליינט מותנית ב-`isProductionLoan` (loan_type==="הפקה"). אם משנים את הזרימה הזאת, חובה לוודא שפרטית/סאונד/קולנוע יומית/שיעור עובדים בדיוק כמו לפני.
2. **8-day inclusive — אל תחזיר ל-9**: ה-policy מבוסס "today + 7 ימי קלנדר = הכי קרוב". בכל הקבצים שמחשבים `minShootISO`/`minDays`/`fmtDeadline` ל-loan_type הפקה.
3. **Director overlap trigger דולג כשתאריכים לא משתנים** (מיגרציה `20260518130000`) — אם תחזיר את הבדיקה ב-UPDATE ללא השוואת OLD vs NEW, כל edit על הפקה קיימת ייכשל גם אם החפיפה היא pre-existing.
4. **Stable productionId via useState** — ב-`ProductionEditor.jsx` חובה לייצב את ה-`productionId` דרך `useState(() => initial?.id || genId("prod"))`, לא `const ... = ...`. אחרת כל retry של publish שנכשל יצר draft חדש (באג שזוהה ב-session-4).

## 🔐 Auth + זרימות

### זרימת Login
- **Password-only** דרך `supabase.auth.signInWithPassword` ב-`handleLogin` ([PublicForm.jsx](src/components/PublicForm.jsx)). **אין magic link login.** ה-`flowType: "implicit"` ב-`src/supabaseClient.js` קיים אך ורק כדי שקישורי password-reset יעבדו (כולל in-app browsers כמו WhatsApp/Telegram, איפה ש-PKCE נכשל). `detectSessionInUrl: true` משויך לאותה סיבה.
- **משתמש חדש = "שכחת סיסמה?"**: לתלמיד/מרצה/צוות שעוד אין לו `auth.users` row, ה-onboarding היחיד — לחיצה על "שכחת סיסמה?" → `/api/auth` action `send-reset-email` שולח קישור איפוס דרך Gmail SMTP → המשתמש פותח את הקישור ויוצר סיסמה → מעכשיו מתחבר רגיל. **`auth.users` נוצר רק כשהמשתמש יוצר סיסמה בפועל**, לא בעצם הקיום שלו ב-`students`/`lecturers`/`staff_members`.
- **קליינט auth** — `src/supabaseClient.js`:
  - `lock: async (_, __, fn) => fn()` — bypass של navigator.locks. מספר קריאות `getSession()` מקבילות + `autoRefreshToken` יוצרים deadlock תחת Edge tracking-prevention / PWA standalone. אסור להחזיר.
  - ה-auth listener ב-PublicForm קורא ל-`routeByRoles(session)` **fire-and-forget** (לא `await`). supabase-js עוטף את כל ה-listeners ב-`Promise.all` בתוך `_notifyAllSubscribers`, שעוטף ב-`signInWithPassword`. אם תעטוף `routeByRoles` ב-`await`, ה-DB-fetches שלו (~5 שאילתות + `/api/auth`) יחסמו את `signInWithPassword` ויעברו את ה-10s safety timer של handleLogin. הותר אחרי תקלה ב-prod.
- `handleLogin` עצמו כן `await`-ים `routeByRoles` בנפרד אחרי `signInWithPassword`, אז הזרימה לא נשברה.
- סיסמה מינ׳: 6 תווים (המשתמש דחה 8). מיפוי הודעות שגיאה לעברית ב-`src/components/PublicForm.jsx`.
- **Supabase setting חובה**: "Prevent use of leaked passwords" = **OFF** (אחרת HaveIBeenPwned דוחה סיסמאות סבירות).

### Identity confirmation modal — הוסר
הייתה בעבר מודאל "אישור זהות" שהוצג בכל login כדי להגן מפני autofill. הוסר לחלוטין בקומיט `bd3742c` — `public.users.email` כבר FK-bound ל-auth session, ו-RLS בודקת זהות בכל קריאה. אסור להחזיר את ה-modal הזה — הוא יצר חוסר אמון אצל המשתמשים בלי להוסיף הגנה מעבר למה ש-Supabase Auth + RLS כבר אוכפים.

### API auth helper: `api/_auth-helper.js`
- `requireStaff(req, res)` — צריך staff לפי `public.users` בלבד (`is_admin` או `is_warehouse`). fallback legacy ל-`staff_members` הוסר.
- `requireAdmin(req, res)` — צריך admin
- `requireUser(req, res)` — כל משתמש מאומת
- `resolveUserRole(req)` — מחזיר `{role: "staff"|"user"|"anon"}` רק מ-public.users (בלי fallback)

### Email
Gmail SMTP + nodemailer ב-`api/auth.js`. `buildResetEmail` בונה את גוף ה-HTML של קישור איפוס.

## 🧩 דפים שעוד inline ב-App.jsx
8 דפים עוד לא חולצו. שורות מאומתות מחדש ב-2026-05-21:

| דף | מיקום ב-App.jsx | ~שורות |
|------|----------------|---------|
| `EquipmentPage` | 1431–3038 | ~1,600 |
| `PoliciesPage` | 3038–3242 | ~200 |
| `ArchivePage` | 3242–3440 | ~200 (קיים `src/components/ArchivePage.jsx` נטוש, לא מיובא) |
| `TeamPage` | 3440–4126 | ~690 |
| `KitsPage` | 4126–4499 | ~370 |
| `ManagerCalendarPage` | 4499–4979 | ~480 |
| `SettingsPage` | 4979–5210 | ~230 |
| `DamagedEquipmentPage` | 5210+ | ~200 |

## 🔄 כתיבה ל-DB — Pattern החדש
כל ישות נכתבת דרך API util ייעודי שלה. דוגמא:
```js
import { syncAllKits, upsertKit, deleteKit } from "../utils/kitsApi.js";
await upsertKit({ id, name, items });          // single row upsert
await syncAllKits(arr);                         // batch upsert + delete-missing
await deleteKit(id);                            // single row delete
```
תחת המכסה: כל util משתמש ב-singleton `supabase` client → `supabase.from("<table>").upsert(...)` → RLS בודקת `is_staff_member()` → realtime בערוץ הטבלה משדר ל-tabs אחרים.

**אסור**:
- ❌ `storageGet`, `storageSet` (הוסרו, ESLint יחסום)
- ❌ `fetch("/api/store")` (הendpoint נמחק)
- ❌ `supabase.from("store")` (הטבלה לא קיימת)
- ❌ JSONB column חדש למערכי domain (השתמש בטבלה ייעודית)
- ❌ `Promise.all` ענק ב-bulk upsert של ישות גדולה (השתמש ב-`inBatches`)

## 🎓 לקחים נלמדו (anti-regressions)
1. **Email-first dedup ב-`lecturers`**: ה-bootstrap ב-App.jsx מחלץ מרצים אוטומטית משיעורים. ה-dedup חייב לבדוק `lower(email)` **לפני** `lower(name)`, כי הטבלה מחזיקה UNIQUE index על `lower(email)`. dedup לפי שם בלבד יוצר UUID חדש אם השם נכתב מעט אחרת ("איציק רוזן" vs "ד\"ר איציק רוזן") → 23505.
2. **navigator.locks deadlock**: אסור להחזיר את `lock` ל-default ב-`supabaseClient.js`. ראה הסעיף Auth.
3. **listener fire-and-forget**: אסור להחזיר `await` ל-`routeByRoles` בתוך ה-onAuthStateChange listener. ראה הסעיף Auth.
4. **Identity-confirmation modal**: אסור להחזיר. ראה הסעיף Identity confirmation.
5. **`FAR_FUTURE` block ל-`באיחור`**: היה bug שחסם **כל** השאלה עתידית כשהיתה הזמנה ב-`באיחור` (טופל ב-2026-05-18). עכשיו ה-block מוגבל ל-48h בלבד (`OVERDUE_BLOCK_BUFFER_MS`). אסור להחזיר ל-`FAR_FUTURE`.
6. **`toDateTime()` מחזיר timestamp (number), לא Date**: בקוד ב-[src/utils.js](src/utils.js) הפונקציה קוראת `.getTime()` בפנים ומחזירה מספר. אל תקרא ל-`.getTime()` על התוצאה — תקבל TypeError ("getTime is not a function"). נגרם בעבר בסטטוס approval של בקשה.

## 🔥 נקודות חולשה / סיכון
1. **production נראה תקין תפעולית כרגע** — RLS מופעל על הטבלאות המרכזיות, auth/public users מיושרים, ואין auth orphans לפי בדיקת read-only מ-2026-05-21.
2. **dev לא מיושר לגמרי ל-production** — RLS כבוי על `users`, `equipment`, `equipment_units`, `reservations_new`, `reservation_items`, `staff_daily_tasks`, ויש עדיין FK constraints ל-`staff_members`. כרגע זה לא קריטי כי dev משמש לבדיקות בלבד, אבל זה עלול להטעות בבדיקות לפני העלאה.
3. **`staff_members` עדיין קיימת כטבלת legacy** — הקוד הפעיל כבר לא משתמש בה כ-fallback. ב-production אין אליה FK אבל יש 9 rows; ב-dev יש row אחד ועדיין יש FKs. מומלץ למחוק רק אחרי וידוא שאין תלות חיצונית/היסטורית.
4. **App.jsx ~7.0k שורות** — 8 דפים inline (ראה טבלה). tech debt, לא חסם.
5. **`policy_assets` מאחסן PDF כ-Base64 ב-TEXT** — כל קריאת מדיניות מושכת את כל ה-blob. ארכיטקטונית לא נקי, לא חסם מיידי.
6. **חשבונות auth "orphan"** — נבדק ב-2026-05-21 ונמצא נקי בשתי הסביבות.

## 🎯 צעדים הבאים מומלצים
1. **לשמור על production יציב** — לפני כל שינוי DB בפרוד לוודא במפורש namespace/project (`wxkyqgwwraojnbmyyfco`) ולעבוד רק עם מיגרציה מכוונת. כרגע אין תיקון קריטי דחוף בפרוד.
2. **ליישר dev כשיהיה זמן** — RLS ו-FKs של `staff_members` ב-dev לא דחופים כרגע, אבל כדאי ליישר אותם לפני בדיקות משמעותיות של אבטחה/הרשאות.
3. **לסגור את `staff_members` סופית** — fallback כבר הוסר מהקוד; ב-production אין FK לטבלה, אבל יש rows. למחוק רק אחרי וידוא שאין תלות חיצונית/היסטורית.
4. **לסיים את פיצול App.jsx** — להוציא את 8 הדפים הנותרים. אחרי החילוץ — למחוק את `src/components/ArchivePage.jsx` הנטוש או להחליף בו את ה-inline. שאיפה: App.jsx < 2k שורות (shell/state/routing בלבד).
5. **`policy_assets` ל-Supabase Storage** — להחליף את `data_base64` (TEXT) ב-bucket עם signed URL; טעינת מדיניות תוכל למשוך URL בלבד במקום blob. לא חסם מיידי.

## 🛠️ כלים זמינים
- **Supabase MCP** — `execute_sql`, `apply_migration`, `list_migrations`, `list_projects`.
- **Vercel MCP** — `list_projects`, `get_project`, `list_deployments`, `deploy_to_vercel`.
- **Git + GitHub CLI** (`gh`) — גישה מלאה ל-repo.

---
*ההקשר המלא של הקוד נמצא ב-repo, והמצב הנוכחי ב-DB. כל העבודה committed + pushed.*
