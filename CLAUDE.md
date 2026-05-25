# מסמך מעבר חשבון — אפליקציית "מחסן קמרה"

> מסמך הקשר יחיד לסשנים חדשים. סנאפ-שוט עדכני נכון ל-**2026-05-25**.

## 🎯 רעיון האפליקציה

אפליקציית ניהול לבית ספר לקולנוע/סאונד בישראל ("קמרה"). מערכת בעברית עם RTL.
ניהול מחסן ציוד, אולפני הקלטה, מסלולי לימוד, תלמידים, מרצים, שיעורים, הסמכות.
טפסים ציבוריים להשאלת ציוד והזמנת אולפנים, פורטל מרצים, דשבורד אדמיניסטרציה, ולוח הפקות.

## 🏗️ מבנה טכני

### Frontend
- React + Vite (עברית, RTL).
- `src/App.jsx` — shell מרכזי (~7,423 שורות). מכיל orchestration גלובלי (state, routing, realtime, auth bootstrap) + **8 דפים inline** שעוד לא חולצו.
- `src/components/` — 32 קבצי JSX.
- `src/utils/` — 16 קבצי utils (14 entity APIs + `jewishHolidays.js` + `lessonBookings.js`).
- `src/hooks/` — `useNotifications.js`.

### Backend
- Vercel serverless functions ב-`api/` (Node 22).
- Supabase = Postgres + Auth + RLS + Realtime.
- Gmail SMTP (nodemailer) ב-`api/auth.js` שולח קישורי password-reset. **לא Supabase SMTP, לא Resend.**

### Deploy
- GitHub: `nimig10/machsan`, ענף יחיד `main`.
- Vercel project: `machsan` → `app.camera.org.il`.
- Supabase prod: `wxkyqgwwraojnbmyyfco` (`MACHSAN CAMERA`).

---

## 🔀 שני מסדי נתונים — חובה לכבד

| סביבה | project_ref | מתי בשימוש |
|-------|-------------|-------------|
| **Production** | `wxkyqgwwraojnbmyyfco` | רק כשהקוד ב-`main` רץ ב-`app.camera.org.il` |
| **Development** | `mhvujejdlmtowypjdhjd` | localhost (`.env.local`) + Vercel Preview של feature branches |

### ⚠️ זרימת עבודה קבועה — חובה, אסור לדלג

1. **Stage 1 — localhost על dev DB**: `http://localhost:5174` (port נעול ב-`vite.config.js`). כל מיגרציה/כתיבה/SQL-טסט הולך ל-dev. **המשתמש בודק ידנית בדפדפן ומאשר במפורש שעובד.**
2. **Stage 2 — Vercel Preview על dev DB**: push ל-feature branch → Preview מתחבר ל-dev DB. שלב נוסף לבדיקה (בעיקר PWA/mobile).
3. **Stage 3 — Production**: רק אחרי שהמשתמש אישר Stage 1 במפורש — מחילים מיגרציה ל-prod דרך `apply_migration` MCP **לפני** ה-merge ל-main.

**אסור לדלג על Stage 1.** SQL smoke + `npm run test:db` הם בדיקות עזר — **לא תחליף** לבדיקה ידנית של המשתמש בדפדפן.

**`CREATE OR REPLACE FUNCTION` הוא שינוי schema** ודורש אישור מפורש של המשתמש לסשן הנוכחי. אישור תוכנית מראש **לא** מהווה אישור לרוץ על prod.

### כללים נוספים
- כל `execute_sql`/`apply_migration` דרך MCP פועל על **dev** by default. כתיבה לפרוד דורשת אישור מפורש לסשן.
- חובה לוודא `project_id` תואם לסביבה בכל קריאת MCP.
- שגיאה/נתונים חסרים — קודם לוודא לאיזה DB מחוברים, לא להניח שהבעיה בקוד.

---

## 🗄️ מבנה DB — Tables-only (אין `public.store`)

ה-blob (`public.store`) הוסר ב-`20260430220000` יחד עם כל המנגנון מסביבו. כל ישות יושבת בטבלה נורמלית.

### טבלאות domain

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
| מדיניות | `policies` + `policy_assets` (Base64 PDFs) | `policiesApi.js` |
| הגדרות אתר | `site_settings` | `siteSettingsApi.js` |
| מנהל מכללה | `college_manager` | `collegeManagerApi.js` |
| ראשי מחלקה | `dept_heads` | `deptHeadsApi.js` |
| סטודנטים | `students` + `certification_types` + `student_certifications` + `tracks` | `studentsApi.js` |
| לוח הפקות | `productions` + `production_dates` + `production_crew` + `production_slots` | `productionsApi.js` |

טבלאות תומכות: `users` (מראת auth, source הפעיל להרשאות), `staff_members` (legacy, fallback הוסר), `activity_logs`, `equipment_reports`, `auth_entity_map`, `staff_schedule_assignments`, `staff_schedule_preferences`, `staff_daily_tasks`, `auth_rate_limits`.

`reservations_new` קיבל FK אופציונליים: `production_id` + `production_date_id` (ON DELETE SET NULL).
`productions.kit_id` (FK → `kits`, ON DELETE SET NULL) — כש-set, הזמנת ההפקה מוגבלת לפריטי הערכה.

### RPCs פעילות

- **ציוד**: `sync_equipment_from_json`.
- **הזמנות**: `create_reservation_v2`, `create_lesson_reservations_v1`, `update_reservation_status_v1`, `delete_reservation_v1`, `restore_reservation_v1`, `student_modify_reservation_item_v1`, `mark_overdue_email_sent`.
- **לוח הפקות**: `production_approve_crew_v1`, `production_check_crew_conflict_v1`, `production_crew_change_recheck_v1`, **`production_delete_v1` (HARD_DELETE, atomic — 2026-05-25)**, `crew_is_certified_for_equipment`, `check_director_no_overlap_for_production`, `run_productions_regression_tests`.
- **בדיקות overlap**: `assert_reservation_overlap_ok`, `run_reservation_overlap_tests`.
- **Auth helpers**: `is_admin`, `is_staff_member`, `is_known_lecturer_email`, `link_auth_to_entity`.

### Triggers
`touch_updated_at`, `set_updated_at`, `update_users_updated_at`, `production_crew_after_change_trigger`, `production_dates_director_overlap_trg`, `productions_status_director_overlap_trg`, `production_crew_photographer_sound_must_be_student`.

### מצב חי בפרוד (2026-05-25)
`auth.users`=107, `public.users`=107 (מיושר), `students`=168, `lecturers`=31, `lessons`=145, `studio_bookings`=295, `reservations_new`=87, `productions`=2, `staff_members`=9 (legacy, אין FK), `auth_rate_limits`=4.

---

## 🚨 כלל ברזל: סטטוסים שחוסמים מלאי

**רק** הסטטוסים האלה תופסים מלאי / חוסמים בקשות חופפות:
- `מאושר` — אישור איש המחסן
- `באיחור` — ציוד עוד בחוץ אחרי תאריך החזרה
- `פעילה` — ציוד יצא לסטודנט

**לא חוסמות**: `ממתין`, `אישור ראש מחלקה`, `נדחה`, `הוחזר`, `בוטל`.

### חלון 48h ל-`באיחור`
הזמנת `באיחור` חוסמת השאלה עתידית **רק** אם ה-borrow_date החדש בטווח 48h אחרי ה-`return_date` המתוכנן. מימוש: `OVERDUE_BLOCK_BUFFER_MS = 48*60*60*1000` ב-[src/utils.js](src/utils.js) + [src/App.jsx](src/App.jsx).

**Anti-regression**: כל שינוי ב-`create_reservation_v2`/`update_reservation_status_v1`/RPC חדש עם overlap-check — חובה לוודא `r.status IN ('מאושר','באיחור','פעילה')` בלבד.

---

## 🎬 לוח הפקות (Productions Board)

### זרימה
1. סטודנט → **StudentHub** ([src/components/StudentHub.jsx](src/components/StudentHub.jsx)) — 2 כרטיסים: "מערכת הפניות" / "לוח הפקות".
2. **ProductionsPage** — board (published), inbox (בקשות נכנסות/יוצאות). חיפוש סטודנטים = טקסט חופשי.
3. **ProductionEditor** — כותרת, תיאור (800 תווים), Drive URL, צבע, סוג (כללית / kit), עד 7 ימי צילום, צוות. פוטוגרף + סאונד חייבים סטודנט רשום.
4. **בקשת הצטרפות** (`requestJoinProduction`) — סטודנט אחר בוחר תפקיד פתוח → במאי מאשר/דוחה.
5. **השאלת ציוד להפקה** — bridge ל-PublicForm עם `loan_type="הפקה"` + `production_id`. ב-step 3, אם להפקה `kit_id` — נעול לפריטי הערכה.

### חוקים יחודיים להפקה (לא משפיעים על פרטית/סאונד/קולנוע יומית/שיעור)
- **8 ימים מראש (inclusive)** להגשת רשימת ציוד.
- **Per-student overlap guard** ב-`create_reservation_v2`: אותו `lower(email)` לא יכול להגיש 2 השאלות חופפות בכל סוג.
- **Director-overlap guard** ב-triggers: אותו `director_student_id` לא יכול לבמא 2 הפקות published חופפות.
- **`production_dates_max_7_days`** CHECK.
- **Cert recheck**: שינוי צלם/סאונדמן בהפקה עם הזמנה מאושרת → trigger קורא ל-`production_crew_change_recheck_v1` → אם הצוות החדש לא מוסמך, הזמנה חוזרת ל-`ממתין`.
- **`student_modify_reservation_item_v1`** מקבל סטטוס `אישור ראש מחלקה` (סטודנט/במאי יכול לבטל/להסיר פריט גם אחרי שעברה לראש מחלקה).

### גישה לראשי מחלקה
`LecturerPortal` → tab "לוח הפקות" (גלוי רק אם `myDeptHead`). `ProductionsPage` במצב read-only.

### Anti-regressions
1. **השאלות אחרות לא הושפעו** — לוגיקת ההפקה מותנית ב-`isProductionLoan` (`loan_type==="הפקה"`).
2. **8-day inclusive** — אל תחזיר ל-9 (היה bug). חישוב `minShootISO`/`minDays`/`fmtDeadline`.
3. **Director overlap trigger דולג כשתאריכים לא משתנים** (מיגרציה `20260518130000`). אם תבדוק ב-UPDATE ללא השוואת OLD vs NEW, כל edit ייכשל.
4. **Stable productionId** ב-`ProductionEditor.jsx`: `useState(() => initial?.id || genId("prod"))`, לא `const`. אחרת retry של publish שנכשל יוצר draft חדש.
5. **`production_delete_v1` הוא HARD_DELETE atomic** (2026-05-25). קוראים אליו ישירות מהקליינט דרך `supabase.rpc("production_delete_v1")`. אסור להחזיר API endpoint עוקף.

---

## 🎙️ הזמנות אולפן — `studio_bookings`

הטבלה מכילה **4 סוגי הזמנות** (שדה `bookingKind` או נגזר):

| סוג | מי יוצר | מקור | זיהוי בקוד |
|-----|---------|------|------------|
| `lesson` | אדמין | **נגזר אוטומטית** מ-`lessons.schedule[]` ע"י `buildLessonStudioBookings()` ב-[src/utils/lessonBookings.js](src/utils/lessonBookings.js) — לא persisted | `lesson_auto: true` / `lesson_id` |
| `team` | אדמין/איש צוות | קביעת זמן באולפן לטכנאי/מדריך | `teamMemberId` / `bookingKind === "team"` |
| `student` | סטודנט | טופס PublicForm "הזמנת אולפן" יום | `studentName` + לא בלילה |
| `night` | סטודנט | אותו טופס, slot לילה 21:30+ | `isNight === true` |

### כיתה משנית בשיעורים (PR #17)
שיעור יכול להחזיק `studioId` (ראשית) + `secondaryStudioId` (משנית) פר session ב-`schedule[]`. `buildLessonStudioBookings` יוצר 2 derived rows — אחד לכל אולפן. בדיקת חפיפה ב-[src/components/LessonsPage.jsx:586](src/components/LessonsPage.jsx#L586) (`findLessonConflict`) קוראת ל-`getLessonSessionStudioIds` שמחזיר מערך של שני האולפנים → **בדיקת קונפליקט תופסת גם את המשנית**.

**Validation בעת שמירה** ([LessonsPage.jsx:2469-2470](src/components/LessonsPage.jsx#L2469)): `duplicateClassroomSession` — `session.studioId !== session.secondaryStudioId`. שגיאה: "כיתה משנית לא יכולה להיות זהה לכיתה הראשית".

### Toggle ידני "צרף סטודיו הקלטות" (PR #17)
קיים רק ב-**team + student bookings** ב-MAIN CONTROL/DIGITAL MIX ROOM. **לא בשיעורים** (הוסר ב-`6c89345`).

- **UI**: checkbox עם `name="addRecordingStudio"` ב-[PublicForm.jsx:5939](src/components/PublicForm.jsx#L5939) (create) + [:6353](src/components/PublicForm.jsx#L6353) (edit). תנאי: `isControlRoomStudio(selectedStudio) && studios.some(isRecordingStudio)`.
- **DB**: כשmarked, נוצרות **2 רשומות נפרדות** ב-`studio_bookings` עם תאריך/שעה זהים. **אין עמודת `companion_booking_id`** ב-schema.
- **Edit**: matching של ה-companion נעשה ב-runtime לפי tuple (`date+studioId+studentEmail+startTime+endTime`). אם המשתמש מסיר את ה-toggle בעריכה → DELETE על ה-companion ([PublicForm.jsx:6053-6062](src/components/PublicForm.jsx#L6053)).
- **Team edit** ב-[StudioBookingPage.jsx:456](src/components/StudioBookingPage.jsx#L456): `teamAddRecordingStudio` מאותחל ב-`Boolean(hasRecordingCompanion)` בפתיחת modal עריכה.

**Anti-regression**: אסור להחזיר auto-coupling ב-lesson path. שיעור ב-MAIN CONTROL לא ייצור booking ב-הקלטות אוטומטית — רק אם המשתמש בחר `secondaryStudioId = הקלטות`.

---

## 📊 ייבוא XL לשיעורים (PR #19)

זרימה מלאה: file picker → mode dialog → parser → validation עם partial save → דוח שגיאות עם עריכה+retry.

### זרימה
1. **כפתור ייבוא** ב-[LessonsPage.jsx:1839](src/components/LessonsPage.jsx#L1839) → file input מקבל `.csv,.tsv,.xlsx,.xls`. ספריה: `xlsx` (import line 3).
2. **Pre-import mode dialog** ([:1480-1510](src/components/LessonsPage.jsx#L1480)) — radio: `"upsert"` (עדכון+יצירה) או `"create_only"` (יצירה בלבד). state: `pendingImportMode` ([:279](src/components/LessonsPage.jsx#L279)).
3. **Parser** `readImportRowsFromFile()` ([:949-1011](src/components/LessonsPage.jsx#L949)) — `XLSX.read()` → `XLSX.utils.sheet_to_json()` → column-matching לפי שמות עבריים ("קורס","תאריך","התחלה"...). מחזיר `{sheets, importRows, importErrors}`.
4. **Grouping + validation** `buildImportGroups()` ([:1014-1112](src/components/LessonsPage.jsx#L1014)) — בודק שורה-שורה: קורס/מסלול/מרצה קיים/תאריך/חלון שעות/חדר. שגיאות → `reportErrors` array (`addImportError`, [:1029](src/components/LessonsPage.jsx#L1029)).
5. **Partial save** `runLessonImportRows()` ([:1114-1275](src/components/LessonsPage.jsx#L1114)) — שורות תקינות נכנסות ל-groups → לולאת sessions per group, conflict checks (lecturer + room) → sessions תקינות מצטברות ל-`baseLesson.schedule`. **קורסים עם 0 sessions תקינים נופלים מהדוח**.

### דוח שגיאות עם עריכה ו-retry
- **Shape של error row** ([:825-841](src/components/LessonsPage.jsx#L825)): `{sheet, rowNumber, courseName, track, instructorName, date, startTime, endTime, studioName, topic, notes, kitName, phone, email, reason}`.
- **עריכת שורה כושלת**: state `editingImportErrorKey` ([:1313](src/components/LessonsPage.jsx#L1313)) + `importErrorDraft` ([:1314-1329](src/components/LessonsPage.jsx#L1314)).
- **Retry**: `retryImportErrorDraft()` ([:1341-1374](src/components/LessonsPage.jsx#L1341)) — ממיר draft → import format → קורא ל-`runLessonImportRows([row], {retry: true, replaceErrorIdentities: [originalKey]})`. רץ באותו pipeline. אם תקין — הקורס נוצר/מתעדכן והשורה יוצאת מהדוח.

### מרצים מרובים לקורס
- **Shape**: `lesson.lecturers = [{lecturerId?, instructorName}, ...]`.
- **Normalize**: `normalizeLessonLecturerList(lesson)` ([:352-370](src/components/LessonsPage.jsx#L352)) — מאחד 3 מקורות: primary (`lesson.lecturerId`/`instructorName`) + `lesson.lecturers[]` + `lesson.schedule[].lecturerId`/`instructorName`. dedupe לפי id-or-normalized-name.
- **חיפוש** (hotfix `e2dac20`): [LessonsPage.jsx:746](src/components/LessonsPage.jsx#L746) משתמש ב-`normalizeLessonLecturerList` במקום ב-`lesson.instructorName` בלבד → תופס גם מרצי-קורס נוספים וגם מרצי-מפגש.

### "ללא מרצה" filter
predicate: `isWithoutLecturer(lesson)` ([:716](src/components/LessonsPage.jsx#L716)) = `!hasAssignedLecturer(lesson)`. `hasAssignedLecturer` ([:707-715](src/components/LessonsPage.jsx#L707)) = true אם יש לפחות אחד מ: `lecturerId`/`instructorName`/`lecturers[]`/per-session lecturer. toggle: `showUnassignedLecturerOnly` ([:1801-1818](src/components/LessonsPage.jsx#L1801)).

### איחוד מפגשים כפולים (`dedupeScheduleEntries`)
- **מיקום**: [LessonsPage.jsx:144-172](src/components/LessonsPage.jsx#L144).
- **מפתח dedup**: `date__startTime__endTime`.
- **מתי**: על load (`getLessonDisplaySchedule` [:175](src/components/LessonsPage.jsx#L175)), בייבוא ([:1206](src/components/LessonsPage.jsx#L1206)), על שמירה ב-edit form ([:2074](src/components/LessonsPage.jsx#L2074), [:2458](src/components/LessonsPage.jsx#L2458)).
- **התנהגות במיזוג**: מערכים זוכים לעדיפות לפי הראשון שיש בו `topic`/`kitId`/`lecturerId`. אם 2 שורות שונות בכיתה — האחת נכנסת ל-`studioId`, השנייה ל-`secondaryStudioId` ([:162-167](src/components/LessonsPage.jsx#L162)).

### "שיוך כיתות לימוד" panel
[LessonsPage.jsx:2765-2804](src/components/LessonsPage.jsx#L2765). מנהל `studioId` + `secondaryStudioId` ברמת קורס, מפיץ ל-**כל** sessions ([:2774-2778, :2792](src/components/LessonsPage.jsx#L2774)).

---

## 🔐 Auth + זרימות

### Login — Password only
`supabase.auth.signInWithPassword` ב-`handleLogin` ([PublicForm.jsx](src/components/PublicForm.jsx)). **אין magic link login.** ה-`flowType: "implicit"` ב-[src/supabaseClient.js](src/supabaseClient.js) קיים רק לקישורי password-reset (כולל in-app browsers כמו WhatsApp).

### Onboarding משתמש חדש
**אין יצירת חשבון מפורשת.** משתמש חדש (סטודנט/מרצה/צוות) שעוד אין לו `auth.users` row — לוחץ "שכחת סיסמה?" → `/api/auth` action `send-reset-email` → Gmail SMTP → המשתמש יוצר סיסמה → מתחבר. `auth.users` נוצר רק כשהמשתמש יוצר סיסמה.

### קליינט auth — נקודות קריטיות שאסור לשבור
- **`lock: async (_, __, fn) => fn()`** ב-`src/supabaseClient.js` — bypass של navigator.locks (deadlock תחת Edge tracking-prevention / PWA standalone). **אסור להחזיר.**
- **listener fire-and-forget** — onAuthStateChange קורא ל-`routeByRoles(session)` בלי `await`. עטיפה ב-await חוסמת את `signInWithPassword` ועוברת את ה-10s safety timer.
- **Identity-confirmation modal — הוסר** ב-`bd3742c`. אסור להחזיר. RLS + FK על `public.users.email` כבר מספקים את ההגנה.
- סיסמה מינ׳ 6 תווים. **Supabase setting חובה: "Prevent use of leaked passwords" = OFF.**

### API auth helper: `api/_auth-helper.js`
- `requireStaff` — staff לפי `public.users` בלבד (`is_admin`/`is_warehouse`). אין fallback ל-`staff_members`.
- `requireAdmin` — admin בלבד.
- `requireUser` — כל משתמש מאומת.
- `resolveUserRole` — `{role: "staff"|"user"|"anon"}` מ-`public.users`.

### Email
Gmail SMTP + nodemailer ב-`api/auth.js`. `buildResetEmail`.

---

## ✅ Pattern לפיצ'ר חדש (חובה)

כל ישות חדשה לפי הפטרן:

1. **מיגרציה** ב-`supabase/migrations/` — `CREATE TABLE` עם עמודות מפורשות, `created_at`/`updated_at`, `touch_updated_at` trigger, RLS + 3 policies (`service_role_all_<table>`, `staff_all_<table>`, `anon_read_<table>` אם ציבורי), `ALTER PUBLICATION supabase_realtime ADD TABLE` אם realtime.
2. **UNIQUE indexes** — dedup בקליינט חייב לעבוד על אותו שדה. ראה לקח 1 למטה.
3. **API util** ב-`src/utils/<entity>Api.js` עם singleton supabase (`import { supabase } from "../supabaseClient.js"`). חתימות: `list<Entity>()`, `upsert<Entity>(row)`, `delete<Entity>(id)`, `syncAll<Entity>(arr)`. תבניות: [src/utils/kitsApi.js](src/utils/kitsApi.js)/[src/utils/teamMembersApi.js](src/utils/teamMembersApi.js).
4. **App.jsx wrapper** בסגנון `loadKitsWrapped` — try/catch + source flag.
5. **Realtime channel** ב-App.jsx (אם רלוונטי) עם debounce 400ms.
6. **JSONB מותר רק** ל-value heterogeneous (כמו `site_settings.value`) או metadata חופשי קטן. **לא** לאחסון מערכי domain.

### Batched writes (חובה ל-N>~20)
אסור `Promise.all` יחיד על כל השורות — רווי את HTTP/1.1 per-host limit, יוצר `ERR_CONNECTION_CLOSED`. השתמש ב-`inBatches(rows, fn, 4)` (ראה [src/utils/studentsApi.js](src/utils/studentsApi.js)). כשמשתמש עורך שורה אחת, חשב diff ושלח רק הפרשים (`syncStudentsDiff`).

### אסור
- ❌ `storageGet`/`storageSet` (ESLint יחסום)
- ❌ `fetch("/api/store")` (endpoint נמחק)
- ❌ `supabase.from("store"...)` (טבלה לא קיימת)
- ❌ JSONB חדש למערכי domain
- ❌ `Promise.all` ענק ב-bulk upsert

---

## 🧩 דפים שעוד inline ב-App.jsx (8 דפים, ~3,800 שורות)

| דף | שורה ב-App.jsx |
|------|---------------|
| `EquipmentPage` | 1431 |
| `PoliciesPage` | 3038 |
| `ArchivePage` | 3242 (קיים `src/components/ArchivePage.jsx` נטוש) |
| `TeamPage` | 3440 |
| `KitsPage` | 4126 |
| `ManagerCalendarPage` | 4499 |
| `SettingsPage` | 4979 |
| `DamagedEquipmentPage` | 5210 |

שאיפה: App.jsx < 2k שורות (shell/state/routing בלבד).

---

## 🎓 לקחים נלמדו (anti-regressions)

1. **Email-first dedup ב-`lecturers`** — bootstrap ב-App.jsx מחלץ מרצים אוטומטית משיעורים. dedup חייב לבדוק `lower(email)` **לפני** `lower(name)`. UNIQUE על email — dedup לפי שם יוצר 23505.
2. **navigator.locks deadlock** — אסור להחזיר את `lock` ל-default ב-`supabaseClient.js`.
3. **Listener fire-and-forget** — אסור `await routeByRoles` ב-onAuthStateChange.
4. **Identity-confirmation modal** — אסור להחזיר.
5. **`FAR_FUTURE` block ל-`באיחור`** — היה bug שחסם כל השאלה עתידית. עכשיו 48h בלבד.
6. **`toDateTime()` מחזיר number, לא Date** — אל תקרא `.getTime()` על התוצאה.
7. **Auto-coupling MAIN CONTROL → סטודיו הקלטות בשיעורים** — הוסר לחלוטין בקומיט `6c89345`. שיעור ב-MAIN CONTROL לא משריין אוטומטית את סטודיו הקלטות. אם צריך גם הקלטות — לבחור כיתה משנית במפורש. ה-toggle הידני "צרף סטודיו הקלטות" ב-team/student booking נשמר כ-opt-in.
8. **`production_delete_v1` atomic hard-delete** — קוראים ישירות מ-React (`supabase.rpc`), לא דרך API endpoint נפרד. כל הפעולה ב-transaction יחיד של Postgres. ראה מיגרציה `20260525120000`.

---

## 🛡️ Guardrails חיים

- **ESLint** ([eslint.config.js](eslint.config.js)) חוסם: `storageGet`, `storageSet`, `supabase.from('store'...)`, `from('store_snapshots'...)`, `/api/store`. רמה=ERROR.
- **CI workflow** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) — `Lint & build` רץ על כל PR/push. `DB smoke (dev project)` רץ אם `SUPABASE_DEV_URL`/`SUPABASE_DEV_SERVICE_ROLE_KEY` מוגדרים ב-GitHub secrets (כרגע לא — הוא מדלג נקי).
- **Global Error Boundary** ([src/components/ErrorBoundary.jsx](src/components/ErrorBoundary.jsx)) — Hebrew/RTL fallback עוטף את `<App/>` ב-StrictMode.
- **DB smoke** (`npm run test:db`, [scripts/run-db-smoke.mjs](scripts/run-db-smoke.mjs)) — 19 scenarios: `run_reservation_overlap_tests` (13) + `run_productions_regression_tests` (6). מסרב לרוץ אם ה-hostname לא `mhvujejdlmtowypjdhjd`. status נוכחי: **19/19 PASS**.

---

## 🔥 נקודות חולשה / סיכון

1. **dev לא מיושר ל-prod** — RLS כבוי על `users`/`equipment`/`equipment_units`/`reservations_new`/`reservation_items`/`staff_daily_tasks`, ויש FK constraints ל-`staff_members`. לא קריטי כי dev = sandbox.
2. **`staff_members` legacy** — הקוד הפעיל לא משתמש כ-fallback. ב-prod: 9 rows, אין FK. ב-dev: row אחד + יש FKs. למחוק אחרי וידוא שאין תלות היסטורית.
3. **App.jsx ~7,423 שורות** — 8 דפים inline (טבלה למעלה).
4. **`policy_assets` שומר PDF כ-Base64 ב-TEXT** — קריאת מדיניות מושכת blob שלם. tech debt.

---

## 🛠️ כלים זמינים

- **Supabase MCP** — `execute_sql`, `apply_migration`, `list_migrations`, `list_projects`, `get_advisors`.
- **Vercel MCP** — `list_projects`, `get_project`, `list_deployments`, `deploy_to_vercel`.
- **Git + GitHub CLI (`gh`)** — גישה מלאה ל-repo.
- **Context7 MCP** (`ctx7`) — docs של ספריות (דורש restart של Claude Code כשמתקינים).

---

## 📜 היסטוריית PRs אחרונים שעלו לפרוד

- **2026-05-25** — `867daeb` Atomic production delete: `production_delete_v1` עבר ל-HARD_DELETE atomic, `api/delete-production.js` נמחק (135 שורות). מיגרציה `20260525120000`.
- **2026-05-23** — PR #19 + hotfix `e2dac20` — ייבוא XL לשיעורים (מצב partial, דוח מפורט, איחוד כפילות), חיפוש לפי מרצים מרובים, ביטול auto-coupling סטודיו הקלטות לשיעורים (קומיט `6c89345`).
- **2026-05-22** — PR #18 + PR #17 — Hard delete לרזרבציות הפקה דרך API (הוחלף ב-RPC ב-2026-05-25), `secondaryStudioId` בשיעורים, toggle ידני "צרף סטודיו הקלטות" ב-team/student.
- **2026-05-20** — PR #16 — CI workflow + Global Error Boundary + DB smoke. ניקוי `staff_members` fallback מהקוד (`b6af87a`). מיגרציה `auth_rate_limits`.
- **2026-05-18** — PR #15 — לוח הפקות (4 טבלאות + 17 מיגרציות). 48h overdue buffer. StudentHub. tab "לוח הפקות" ב-LecturerPortal.
- **2026-05-12** — PR #14 — ביטול הזמנה ע"י סטודנט = hard delete. PR #13 — מדריך וידאו לקהלי צוות/מרצים.
- **2026-05-11** — PR #11 — פאנל "רשימות פעילות" ב-PublicForm step 2, פילטרים לוח (סגול=ראש מחלקה, אדום=באיחור), תאריכי חודש סמוך בלוח, דיווחי תקלה ניתנים לעריכה.

---

*ההקשר המלא של הקוד נמצא ב-repo, מצב חי ב-DB. כל העבודה committed + pushed.*
