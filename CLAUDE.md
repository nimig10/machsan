# מסמך מעבר חשבון — אפליקציית "מחסן קמרה"

> מסמך הקשר יחיד לסשנים חדשים. סנאפ-שוט עדכני נכון ל-**2026-06-21** (סוף סשן — אחרי PR #48–#49). **PR #48**: **guard אטומי ל-double-booking של אולפנים** — `EXCLUDE constraint` (`studio_bookings_no_overlap`) + `btree_gist` + פונקציית `studio_booking_tsrange` IMMUTABLE (מיגרציה `20260621120000`, **הוחלה ב-dev וב-prod**), סגירת פערי בדיקת-חפיפה בקביעות לילה (סטודנט+צוות), helper משותף `src/utils/studioOverlap.js`, מיפוי `23P01`→`studio_overlap`, וטסט CI `run_studio_overlap_tests` (smoke עכשיו **30/30**). **PR #49**: עיצוב עורך הקורס — לחצני הוספה בסגול אחיד `#9b59b6` + שם הקורס דינמי בכותרת. baseline קודם: PR #46–#47 (crew snapshot recheck-refresh `20260613150000` + שחזור per-student overlap guard `20260613153000` + `getEffectiveStatus` גוזר "באיחור"), PR #44–#45 (crew snapshot `20260604120000`), PR #39–#43 (מובייל + `HH:MM` + מייל דדליין הפקה + `no-undef`=error).

## 🎯 רעיון האפליקציה

אפליקציית ניהול לבית ספר לקולנוע/סאונד בישראל ("קמרה"). מערכת בעברית עם RTL.
ניהול מחסן ציוד, אולפני הקלטה, מסלולי לימוד, תלמידים, מרצים, שיעורים, הסמכות.
טפסים ציבוריים להשאלת ציוד והזמנת אולפנים, פורטל מרצים, דשבורד אדמיניסטרציה, ולוח הפקות.

## 🏗️ מבנה טכני

### Frontend
- React + Vite (עברית, RTL).
- `src/App.jsx` — shell מרכזי (~7,475 שורות). מכיל orchestration גלובלי (state, routing, realtime, auth bootstrap) + **8 דפים inline** שעוד לא חולצו.
- `src/components/LessonsPage.jsx` — ~4,105 שורות (PR #24 הוסיף עמודות מרצה מרובות + lecturerIds[] לכל מפגש).
- `src/components/` — 32 קבצי JSX.
- `src/utils/` — 18 קבצי utils (15 entity APIs + `jewishHolidays.js` + `lessonBookings.js` + `studioOverlap.js`).
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

> ⚠️ **שני ה-DB נגישים דרך Supabase MCP — אבל רק פרוד מופיע ב-`list_projects`.** `list_organizations` מחזיר רק `nimig10's Org` (`cadhrpjnudiawwqlvwun`) שמכיל את פרוד בלבד, ולכן dev **לא** מופיע ברשימה. זה עניין של *רישום* ולא של *גישה*: ל-token יש גישה ברמת הפרויקט גם ל-dev, ו-`execute_sql`/`apply_migration` עם `project_id: "mhvujejdlmtowypjdhjd"` מפורש עובדים מצוין. **אל תסיק מהיעדרו ב-list שאין חיבור ל-dev.** הסיכון: קריאת MCP בלי `project_id` מפורש עלולה ליפול על הפרויקט היחיד שב-list = פרוד. לכן — תמיד לנקוב `project_id` מפורש.

### ⚠️ זרימת עבודה קבועה — חובה, אסור לדלג

1. **Stage 1 — localhost על dev DB**: `http://localhost:5174` (port נעול ב-`vite.config.js`). כל מיגרציה/כתיבה/SQL-טסט הולך ל-dev. **המשתמש בודק ידנית בדפדפן ומאשר במפורש שעובד.**
2. **Stage 2 — Vercel Preview על dev DB**: push ל-feature branch → Preview מתחבר ל-dev DB. שלב נוסף לבדיקה (בעיקר PWA/mobile).
3. **Stage 3 — Production**: רק אחרי שהמשתמש אישר Stage 1 במפורש — מחילים מיגרציה ל-prod דרך `apply_migration` MCP **לפני** ה-merge ל-main.

**אסור לדלג על Stage 1.** SQL smoke + `npm run test:db` הם בדיקות עזר — **לא תחליף** לבדיקה ידנית של המשתמש בדפדפן.

> 🟢 **שינוי workflow פעיל — תקופת מובייל (מ-2026-05-31, ~3 שבועות) — זו הזרימה בפועל כרגע, חובה לכבד:**
> למשתמש **אין גישה ל-localhost** (עובד מהטלפון). לכן **Stage 1 (localhost) מוחלף ב-Stage 2 (Vercel Preview)**:
> 1. כל שינוי קוד → ענף + **PR ייעודי** → Vercel Preview (מחובר ל-**dev DB**).
> 2. המשתמש בודק **במובייל על ה-Preview** ומאשר.
> 3. רק אז **merge ל-main** — וה-merge נעשה דרך **merge-PR** (main מוגן מ-push ישיר; משתמשים ב-`mcp__github__merge_pull_request`).
> - לבדיקת **עיצוב מיילים** מהנייד: לרנדר את ה-HTML דרך `buildEmail` ולשלוח **תמונת PNG** (headless chromium ב-`/opt/pw-browsers/...`) — קל יותר מ-HTML לגלילה בנייד.
> - תיקוני **חירום/hotfix** נדחפו ל-main באישור מפורש של המשתמש בלבד.
> - **שאר חוקי הברזל ללא שינוי** — שינויי DB/schema/migration עדיין dev-first ובאישור מפורש, ואין merge בלי אישור המשתמש.

> 📧 **כתובת מייל לבדיקות:** `nimig10@gmail.com` — כל בדיקת מיילים (תצוגות עיצוב, `force_test` של קרונים וכו') נשלחת לכתובת הזו.

**`CREATE OR REPLACE FUNCTION` הוא שינוי schema** ודורש אישור מפורש של המשתמש לסשן הנוכחי. אישור תוכנית מראש **לא** מהווה אישור לרוץ על prod.

### כללים נוספים
- **חוק ברזל**: כל בדיקה/מיגרציה/כתיבה רצה **קודם על dev** (`mhvujejdlmtowypjdhjd`). גישה או עדכון של **prod** (`wxkyqgwwraojnbmyyfco`) מותרים **רק** אחרי שהמשתמש אישר במפורש בסשן הנוכחי ש-dev עובד תקין. אישור תוכנית מראש ≠ אישור לרוץ על prod.
- חובה לנקוב `project_id` **מפורש** בכל קריאת MCP — אסור להסתמך על ברירת מחדל (ה-list מציג רק את פרוד, ראו הערה למעלה). ל-dev: `project_id: "mhvujejdlmtowypjdhjd"`.
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
- **הזמנות**: `create_reservation_v2` (**עודכן ב-PR #45, מיגרציה `20260604120000`** — גוזר crew snapshot מ-`production_crew` המאושר כש-`production_id` קיים והשם מגיע ריק; **לוגיקת availability/overlap זהה byte-for-byte ל-`20260516160000`** — עדיין חוסם רק מאושר/באיחור/פעילה), `create_lesson_reservations_v1`, `update_reservation_status_v1`, `delete_reservation_v1`, `restore_reservation_v1`, `student_modify_reservation_item_v1`, `mark_overdue_email_sent`.
- **לוח הפקות**: `production_approve_crew_v1`, `production_check_crew_conflict_v1`, `production_crew_change_recheck_v1`, **`production_delete_v1` (HARD_DELETE, atomic — 2026-05-25)**, `crew_is_certified_for_equipment`, `check_director_no_overlap_for_production`, `run_productions_regression_tests`.
- **בדיקות overlap**: `assert_reservation_overlap_ok`, `run_reservation_overlap_tests`, `run_student_overlap_tests` (5 תרחישים — per-student guard, PR #47), `run_studio_overlap_tests` (6 תרחישים — studio EXCLUDE guard, PR #48).
- **קביעות אולפן**: `studio_booking_tsrange(date,start,end)` — פונקציית helper IMMUTABLE שבונה `tsrange` משדות TEXT (עם wrap-around של לילה 21:30→08:00), משמשת את ה-`EXCLUDE constraint` `studio_bookings_no_overlap` (PR #48, מיגרציה `20260621120000`). ראו סעיף "הזמנות אולפן".
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

### 🧍 Per-student overlap guard (גלובלי — כל סוגי ההשאלה)
ב-`create_reservation_v2`: אותו סטודנט (`lower(email)`) **לא יכול להגיש** בקשה חדשה שחופפת בזמן לבקשה קיימת שלו — בכל סוג (פרטית/סאונד/קולנוע יומית/הפקה, כולל חוצה-סוגים. נוסף ב-`20260518120000`, **שוחזר ב-`20260613153000`** אחרי ש-PR #45 הפיל אותו בשוגג). סטטוסים חוסמים = כל מה ש**אינו** `בוטל`/`הוחזר`/`נדחה`; שיעורים (`loan_type='שיעור'`/`lesson_auto`) **לא** נספרים. ה-RPC זורק עם הטוקן `student_overlap` → [api/create-reservation.js](api/create-reservation.js) ממפה ל-`error:"student_overlap"` → [PublicForm.jsx](src/components/PublicForm.jsx) מציג הודעה ברורה. בנוסף יש **pre-check חוסם בקליינט בשלב האישור** (אותה הודעה, feedback מיידי).

> ⚠️ **Anti-regression**: זהו guard **per-student** ונפרד מ-guard ה-**per-equipment** (`status IN ('מאושר','באיחור','פעילה')`). כל `CREATE OR REPLACE` של `create_reservation_v2` חייב לכלול **את שלושתם**: per-student guard, equipment-availability, ו-crew-derive (PR #45). הרגרסיה ב-PR #45 קרתה כי הפונקציה הוצהרה מחדש על בסיס גרסה ישנה. יש עכשיו טסט CI `run_student_overlap_tests` (5 תרחישים) ב-`npm run test:db`.

### השאלת צוות (`loan_type="צוות"`) ו-`באיחור` — מכוון, לא באג ✅
השאלת ציוד של איש צוות מתנהגת **כמו כל השאלה רגילה** לעניין איחור: כשעובר ה-`return_date` והסטטוס `מאושר` → עוברת ל-`באיחור` (וחוסמת מלאי בחלון 48h כמו כל באיחור). מי שכותב זאת ל-DB הוא ה-cron `api/check-overdue.js`, שפוטר **רק** `שיעור` — **לא** `צוות`. גם `normalizeReservationsForArchive` ב-`App.jsx` עושה זאת נכון. **אושר ע"י בעל המוצר (2026-05-30).**

- **קוד מת ידוע**: ל-`utils.js` יש עותק מקביל של `normalizeReservationsForArchive` עם guard ישן `if (loan_type==="צוות") return` (משאיר `מאושר`). הוא **inert** — רץ רק על rows שכבר `מאושר`, ב-ReservationsPage/DashboardPage local re-normalize, ולכל היותר גורם להבהוב רגעי שמתקן את עצמו בפול הבא. אינו משנה את ההתנהגות בפועל.
- **לרוטינת הסריקה היומית**: ההבדל בין `App.jsx` ל-`utils.js` בטיפול ב-`loan_type==="צוות"` ב-overdue הוא **ידוע ומכוון — אל תדווח עליו שוב**.

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
6. **Crew snapshot חייב להישאר טרי** — ההזמנה שומרת snapshot של `crew_photographer_name/phone` + `crew_sound_name/phone` (cert-gate `getProductionCertBlockers` ב-[ReservationsPage.jsx](src/components/ReservationsPage.jsx) קורא מהם). הוא נגזר ב-`create_reservation_v2` **בזמן הגשה** (PR #45, מיגרציה `20260604120000`) **וגם מרוענן ב-`production_crew_change_recheck_v1`** כשצוות מאושר/משתנה אחרי ההגשה (מיגרציה `20260613150000`). **אסור לגעת בלוגיקת ה-overlap/cert-flip בתוך ה-recheck** — רק הוספת רענון ה-snapshot (fill-from-approved, לא מאפס תפקיד ריק). בלי הרענון, צוות שאושר אחרי הגשת רשימת הציוד לא מופיע בלוח הבקרה והסמכותיו לא נספרות.

---

## 🎙️ הזמנות אולפן — `studio_bookings`

הטבלה מכילה **4 סוגי הזמנות** (שדה `bookingKind` או נגזר):

| סוג | מי יוצר | מקור | זיהוי בקוד |
|-----|---------|------|------------|
| `lesson` | אדמין | **נגזר אוטומטית** מ-`lessons.schedule[]` ע"י `buildLessonStudioBookings()` ב-[src/utils/lessonBookings.js](src/utils/lessonBookings.js) — לא persisted | `lesson_auto: true` / `lesson_id` |
| `team` | אדמין/איש צוות | קביעת זמן באולפן לטכנאי/מדריך | `teamMemberId` / `bookingKind === "team"` |
| `student` | סטודנט | טופס PublicForm "הזמנת אולפן" יום | `studentName` + לא בלילה |
| `night` | סטודנט | אותו טופס, slot לילה 21:30+ | `isNight === true` |

### 🛡️ Guard נגד double-booking של אולפן (PR #48 — race-proof ב-DB)
**הבעיה ההיסטורית**: לא הייתה שום אכיפה בצד השרת — כל בדיקות החפיפה היו בצד הלקוח בלבד מול מערך בזיכרון שעלול להיות מיושן, ואז כתיבה ישירה. תחת race / state מיושן (במיוחד מובייל) שני קובעים עברו בדיקה מקומית ושניהם כתבו = כפילות.

**התיקון (מיגרציה `20260621120000`, הוחלה ב-dev וב-prod):**
- **`EXCLUDE constraint` `studio_bookings_no_overlap`** עם `btree_gist`: `EXCLUDE USING gist (studio_id WITH =, studio_booking_tsrange(date,start_time,end_time) WITH &&)` ב-`WHERE (lesson_auto=false AND status<>'נדחה' AND start_time/end_time NOT NULL)`. חוסם **פיזית ואטומית** שתי קביעות persisted חופפות על אותו חדר — **עמיד ל-race**.
- **`studio_booking_tsrange`** IMMUTABLE: בונה `tsrange` מ-TEXT עם `make_timestamp` (לא `text::timestamp` — STABLE) + wrap-around לילה (`end<=start → +1 יום`). שורות לילה שומרות 21:30/08:00 ולכן מטופלות גנרית.
- **מיפוי שגיאה**: `23P01` (exclusion_violation) → `error:"studio_overlap"` ב-[studioBookingsApi.js](src/utils/studioBookingsApi.js) (`upsert` + `syncAll`) → הודעת עברית ב-PublicForm/StudioBookingPage (revert אופטימי + toast).
- **פערי לילה בקליינט נסגרו**: הוסרו gates ה-`!isNight` שגרמו לקביעות לילה (סטודנט+צוות) ועריכות-לילה לדלג על בדיקת החפיפה. כל בדיקות החפיפה אוחדו דרך helper משותף מנרמל-לילה [src/utils/studioOverlap.js](src/utils/studioOverlap.js) (`rangesOverlap`/`buildStudioBookingInterval`).
- טסט CI `run_studio_overlap_tests` (6 תרחישים) → smoke **30/30**.

**מה מכוסה ומה לא:**
- ✅ **race-proof ב-DB** לכל הצירופים של קביעות persisted: `student↔student`, `student↔team`, `team↔team`, וכל שילובי יום/לילה.
- ⚠️ **שיעור↔קביעה — בדיקת לקוח בלבד** (לא ב-DB): שיעורים **לא persisted** (anti-regression), אז ה-`EXCLUDE` לא "רואה" אותם. החסימה בפועל מתבצעת ע"י בדיקות הלקוח ([PublicForm.jsx](src/components/PublicForm.jsx) `getStudioBookingValidationError` + [LessonsPage.jsx](src/components/LessonsPage.jsx) `findBookingConflicts`, מנורמלות לילה ועוברות על כל N הכיתות). **נשאר פער תיאורטי לתרחיש race/state-מיושן מול שיעור** — מודע ומקובל (שיעורים נוצרים ע"י אדמין, concurrency נמוך). בעל המוצר בחר להישאר עם זה (2026-06-21).

**Anti-regression**:
1. כל `CREATE OR REPLACE` של ה-constraint/הפונקציה — לשמר את ה-`WHERE` (lesson_auto + נדחה + NOT NULL) ואת ה-wrap-around של הלילה.
2. **לפני הוספת ה-constraint חובה דה-דופ** של כפילויות קיימות (אחרת `ALTER` נכשל). שאילתת הזיהוי (self-join על `studio_booking_tsrange &&`) מתועדת כהערה במיגרציה. בפרוד נמצאה ונוקתה כפילות אחת (טל ארז, ANALOG MIX ROOM, 2026-05-11).
3. **שארית נדחתה (Layer B)**: נתיב הכתיבה של הצוות עדיין `syncAllStudioBookings` מערך-מלא (delete-missing) — באג נפרד של אובדן קביעות מקבילות (clobber). ה-constraint מונע כפילות אך לא את ה-delete-missing. מומלץ follow-up: מעבר לכתיבות שורה-בודדת.

### N כיתות לקורס/מפגש (PR #20, PR #21)
שיעור יכול להחזיק **מערך של N כיתות** — `lesson.studios[]` ברמת הקורס, ו-`session.studioIds[]` ברמת המפגש. החליף את הזוג `studioId`+`secondaryStudioId` (PR #17). `buildLessonStudioBookings` יוצר N derived rows — אחד לכל אולפן. בדיקת חפיפה ב-[LessonsPage.jsx:847](src/components/LessonsPage.jsx#L847) (`findLessonConflict`) קוראת ל-`getLessonSessionStudioIds` → `getEffectiveLessonStudioIds` שמחזיר את כל ה-N אולפנים → **בדיקת קונפליקט תופסת את כל הכיתות במקביל**.

**Backwards compatibility בקריאה**: `normalizeSessionStudioIds` ב-[lessonsApi.js:22](src/utils/lessonsApi.js#L22) — אם השורה הישנה מכילה `studioId`/`secondaryStudioId` בלבד, הם נארזים למערך. **השמירה תמיד יוצאת כ-`studioIds[]`**.

### `course_studios` JSONB column (PR #21)
ברמת הקורס יש עמודה ייעודית `lessons.course_studios jsonb` (מיגרציה `20260525150000`) שמחליפה את הגזירה האוטומטית של איחוד `union(schedule[].studioIds)`. למה: ב-PR הקודם כל override מפגש "דלף" לרמת הקורס וגרם ל-phantom column אחרי reload. עכשיו: chips של הקורס נשמרים ישירות, overrides של מפגש נשארים inline.

- **Helper**: `normalizeCourseStudiosColumn` + `buildCourseStudiosFromLesson` ב-[lessonsApi.js:36](src/utils/lessonsApi.js#L36).
- **Read fallback**: אם השורה מהDB ריקה בעמודה החדשה (legacy) — נגזר union משדות ישנים.
- **UI**: dropdown בפאנל "שיוך כיתות לימוד" מציג את **כל הכיתות במערכת** (לא רק את אלה שכבר בקורס).

### N מרצים למפגש + `course_lecturers` JSONB column (PR #24 — ממוזג)

**רעיון**: מפגש בודד יכול להיות משויך ל-N מרצים מתוך `courseLecturers` (chips של הקורס) — דפוס מקביל ל-N כיתות אבל **לא זהה**.

**הבדל מהותי מול כיתות**: chip ב-"מרצי הקורס" **לא** מוסיף עמודה ל-grid אוטומטית. עמודה נוספת מתווספת רק על ידי לחיצה מפורשת על "👤 הוסף עמודת מרצה" ב-row הכפתורים, ונסגרת על ידי "👤 הסר עמודת מרצה". הרצפה תמיד 1, התקרה היא `courseLecturers.length`.

**Shape**:
- `session.lecturerIds[]` — מערך position-preserving, mirror של `session.studioIds[]`. עמודה ריקה = `""`. trailing empties נחתכים ב-`blobToRow` ([lessonsApi.js:159](src/utils/lessonsApi.js#L159)).
- `session.lecturerId` (סקלר) — נשמר כ-shim ל-legacy code paths (LecturerPortal filter, PublicDisplay, buildLessonStudioBookings). תמיד נגזר מ-`lecturerIds[0]`.
- `lesson.lecturers[]` (course-level chips) — `[{lecturerId, instructorName}]`. נשמר ב-`course_lecturers jsonb` (מיגרציה `20260526200000`).

**Helpers ב-[lessonsApi.js](src/utils/lessonsApi.js)**:
- `normalizeSessionLecturerIds(session)` ([:38](src/utils/lessonsApi.js#L38)) — mirror של `normalizeSessionStudioIds`. legacy scalar `lecturerId` → `[lecturerId]`.
- `normalizeCourseLecturersColumn(raw)` ([:80](src/utils/lessonsApi.js#L80)) — מקבל JSONB → `[{lecturerId, instructorName}]` עם dedup.
- `buildCourseLecturersFromLesson(rawLesson)` ([:104](src/utils/lessonsApi.js#L104)) — fallback derivation לrows legacy: union של `lecturer_id` + `session.lecturerIds[]`.
- `trimTrailingEmpties(arr)` ([:48](src/utils/lessonsApi.js#L48)) — משותף ל-studios + lecturers.

**Helpers ב-[LessonsPage.jsx](src/components/LessonsPage.jsx)**:
- `normalizeScheduleLecturerIds(entry)` ([:343](src/components/LessonsPage.jsx#L343)) — מירור של `normalizeScheduleStudioIds`. כלול ב-`normalizeScheduleEntry`.
- `updateSessionLecturerSlot(sessionIndex, colIdx, value)` ([:3013](src/components/LessonsPage.jsx#L3013)) — mirror של `updateSessionStudioSlot`. מעדכן `lecturerIds[colIdx]` + `lecturerId` (סקלר) + `instructorName`.
- `addLecturerColumn()` ([:3037](src/components/LessonsPage.jsx#L3037)) — appends empty slot. cap = `courseLecturers.length`.
- `removeLecturerColumn()` ([:3050](src/components/LessonsPage.jsx#L3050)) — drops last slot. floor = 1. מוחק גם ערכים שיש בעמודה האחרונה (כפתור "ביטול" של הטופס משמש כ-undo רחב).
- **state**: `lecturerColumnCount` ([:2802](src/components/LessonsPage.jsx#L2802)) — מאותחל לפי `max(1, widest session.lecturerIds.length)`.

**Helper ב-[lessonBookings.js](src/utils/lessonBookings.js)**:
- `normalizeSessionLecturerIdList(session)` ([:22](src/utils/lessonBookings.js#L22)) — position-independent (filtered empties) — לקריאה בלבד.
- `getEffectiveLessonLecturerIds(session, lesson)` ([:40](src/utils/lessonBookings.js#L40)) — מירור של `getEffectiveLessonStudioIds`.
- `buildLessonStudioBookings` ([:130](src/utils/lessonBookings.js#L130)) — `instructorName` של booking הוא **join של כל מרצי המפגש ב-" + "** (separator עם רווחים). לדוגמה: "נעם מאירי + יבגני יאנוב".

**XL import** ([LessonsPage.jsx:1411-1416](src/components/LessonsPage.jsx#L1411)):
- `instructorIdxs = findAllH("מרצה", "מורה", "lecturer", "teacher", "instructor")` — תופס את כל עמודות "מרצה 1", "מרצה 2", "מרצה N" באותה שורה.
- `rowInfo.instructorNames` — מערך של כל השמות בעמודות (תאים ריקים מסוננים).
- `importSessionMergeKey` ([:1283](src/components/LessonsPage.jsx#L1283)) — **ללא lecturer**: שתי שורות XL עם אותו `(date, start, end, topic)` מתמזגות למפגש אחד עם `lecturerIds[]` מאוחד (כמו classrooms).
- בfunction merge ([:1568-1601](src/components/LessonsPage.jsx#L1568)) — `mergedLecturerIds` נבנה בנוסף ל-`mergedStudioIds`.

**LecturerPortal filter** ([LecturerPortal.jsx:274-285](src/components/LecturerPortal.jsx#L274)):
- מרצה רואה שיעור גם אם הוא ב-`lesson.lecturers[]` (chips) או ב-`session.lecturerIds[]` (column 2+). לא מסתפק ב-`lesson.lecturerId` סקלר.

**מיגרציה `20260526200000_lessons_course_lecturers.sql`** (הוחלה ב-dev **וב-prod** — אומת 2026-05-29 ש-`public.lessons.course_lecturers jsonb DEFAULT '[]'` קיים בפרוד):
```sql
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS course_lecturers jsonb NOT NULL DEFAULT '[]'::jsonb;
```
עמודה אופציונלית עם DEFAULT — אין נזק לrows קיימים.

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
- **התנהגות במיזוג**: מערכים זוכים לעדיפות לפי הראשון שיש בו `topic`/`kitId`/`lecturerId`. אם N שורות שונות בכיתה — כל ה-studioIds מתאחדים ל-`session.studioIds[]` במערך אחד (PR #20).

### "שיוך כיתות לימוד" panel (PR #21)
מנהל את `course_studios` של הקורס כ-chips ניתנים להוספה/הסרה. dropdown מציג את **כל הכיתות במערכת**. position-based binding (`value={sessionIds[colIdx]}` — לא לפי studioId, אחרת החלפת ערך בעמודה תיצור orphan). chip שאינו ב-course_studios אבל יש מפגש שמשתמש בו = override של מפגש בלבד, לא דולף לרמת הקורס.

### Conflict resolver modal (PR #20, PR #21)
חפיפה (חדר או מרצה) פותחת **modal לפתרון inline** ([ConflictResolverCard ב-LessonsPage.jsx:131](src/components/LessonsPage.jsx#L131)):
- מציג את כל המפגשים בקונפליקט (`findAllLessonRoomConflicts` / `findAllLessonLecturerConflicts` → arrays).
- מאפשר לשנות כיתה/מרצה של ה-**מפגש האחר** ישירות (`applyOtherLessonFix`).
- Textarea להודעה מותאמת + כפתור WhatsApp deep-link (`wa.me/<phone>?text=<encoded>`).
- אם הסיבה לקונפליקט היא חדר אחר — שולח מייל אוטומטי `studio_lesson_conflict` ([api/send-email.js](api/send-email.js)) עם block "💬 הודעה מהמכללה" אופציונלי. **לא לכפול את ה-`custom_message`** ב-`studentMessageSection` הישן (כבר טופל).

### Splitting classroom column values ב-XL import (PR #20)
`splitImportCellValues` ב-[LessonsPage.jsx:585](src/components/LessonsPage.jsx#L585) חותך תאי "כיתה" לפי `,;،，` וכו'. **רק עמודת הכיתה** — עמודת המרצה לא נחתכת (יש לעצב כל מרצה כשורה נפרדת ב-XL).

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
- **password-reset**: Gmail SMTP + nodemailer ב-`api/auth.js`. `buildResetEmail`.
- **כל שאר המיילים** (אישור בקשה `new`, איחור `overdue`, אישור אולפן, התראת ראש מחלקה, סיום קורס, ...) עוברים דרך [api/send-email.js](api/send-email.js) (Gmail SMTP, nodemailer). אנונימי מורשה רק `new`/`team_notify`/`dept_head_notify`; כל השאר דורש JWT או header `X-Cron-Secret`.

### 📧 מייל תזכורת דדליין הפקה (PR #39 — cron יומי חדש)
- **קובץ**: [api/production-deadline-reminder.js](api/production-deadline-reminder.js) — Vercel cron יומי **09:00 UTC** (רשום ב-[vercel.json](vercel.json) ליד `notify-course-end-7days`).
- **מתי שולח**: יום אחד לפני המועד האחרון להגשת רשימת ציוד = ה-shoot date הפנוי הקרוב ביותר עם `daysToShoot===8` (= `daysToDeadline===1`, מקביל ל-`equipmentDeadline` ב-[ProductionsPage.jsx](src/components/ProductionsPage.jsx)). **נשלח רק אם טרם הוגשה רשימת ציוד** לאותו תאריך.
- **למי**: הבמאי בלבד (`productions.director_email`). מייל אחד להפקה — כולל **טווח תאריכי הצילום** (תאריכים בלבד, בלי שעות) וכפתור יחיד "🎬 כניסה ללוח ההפקות".
- **סוג מייל חדש** `production_deadline` ב-[api/send-email.js](api/send-email.js) (`isProductionDeadline`).
- **Idempotency בלי DB**: התאמת-יום-מדויקת + cron יומי יחיד (אותה תבנית כמו `notify-course-end-7days`). **אין עמודה חדשה, אין מיגרציה.**
- מצב בדיקה ידני: `GET /api/production-deadline-reminder?force_test=<email>` (דורש header `Authorization: Bearer <CRON_SECRET>`).
- **env נדרש**: `CRON_SECRET` (קיים בפרוד — All Environments) + `GMAIL_USER`/`GMAIL_PASS`. אותו `CRON_SECRET` משמש גם את `Authorization` של ה-cron וגם את `X-Cron-Secret` ל-send-email.

### Deep-link ללוח הפקות (PR #39)
- `https://app.camera.org.il/?app=productions` — [PublicForm.jsx](src/components/PublicForm.jsx) קורא `?app=` ב-init של `studentApp` (ערכים תקפים: `hub`/`forms`/`productions`). אחרי login הסטודנט/במאי נוחת **ישר על לוח ההפקות**. כפתור מייל התזכורת משתמש ב-URL הזה. אין routing אחר ללוח ההפקות (הוא state פנימי, לא pathname).

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

## 🎨 UX Patterns גלובליים

### Toast aggregation (PR #22)
`showToast(type, msg, opts?)` ב-[App.jsx](src/App.jsx) תומך באגרגציה אופציונלית:
```js
showToast("success", "X נמחק", {
  aggregateKey: "lesson-delete",
  pluralize: n => `${n} X נמחקו`,
});
```
- ללא `aggregateKey` — התנהגות זהה לחלוטין למה שהיה (backwards-compatible).
- עם `aggregateKey` — toast יחיד מתעדכן ל-"2 X נמחקו" → "3..." כשהמשתמש מוחק ברצף. ה-timer מתאפס בכל לחיצה ונעלם 3.5s אחרי הפעולה האחרונה.
- **קריטי**: סינכרוני לחלוטין בתוך `setToasts(prev => ...)` + `useRef` ל-Map של טיימרים. **אסור** להוסיף async/await בנתיב הזה — `aggregateKey` נוצר בדיוק כדי לא להאט את לחיצת הכפתור.
- callsites קיימים: `lesson-delete`, `lecturer-delete`, `cert-type-delete`, `archive-delete`, `staff-user-delete`, `staff-pref-delete`, `staff-shift-delete`, `staff-lesson-day-delete`, `studio-delete`, `studio-booking-student-delete`, `studio-booking-team-delete`, `reservation-delete`, `category-delete`.

### Undo stack (PR #22)
- **גודל**: 15 פעולות (היה 10).
- **Optimistic**: state setter רץ **לפני** הקריאה לרשת. `setUndoStack(prev => prev.slice(0,-1))` מיידי, אחר כך `Promise.all([...reservationPromises, ...entityPromises])` במקביל. הלחיצה מרגישה מיידית.
- **Toast מצוין**: `undo-action` אגרגציה — מציג "X פעולות בוטלו" כשמשתמש לוחץ Undo ברצף.

### Inactivity logout (PR #22)
admin/staff מתנתק אוטומטית אחרי **60 דקות** של חוסר פעילות (היה 20m). מימוש ב-[App.jsx:6060](src/App.jsx#L6060).

### XL import templates — admin upload (PR #23)
- אדמין מעלה טמפלטים ב-**הגדרות מערכת** ("טמפלטים לייבוא Excel (XL)") — 2 slots: `xl_template_courses` + `xl_template_students`.
- אחסון: **מיחזור `policy_assets`** (אותה טבלה של PDFs) — אין מיגרציה, אין טבלה חדשה. הbase64 נשמר ב-`data_base64` text.
- הורדה ב-"הגדרות → אדמיניסטרציה" קוראת ל-`loadXlTemplate(slot)` ב-[src/utils/xlTemplatesApi.js](src/utils/xlTemplatesApi.js); אם אין שורה → fallback ל-`COURSES_TEMPLATE_B64`/`STUDENTS_TEMPLATE_B64` (constants ב-App.jsx).
- 100% backwards-compatible: בלי upload המשתמש מקבל את אותו טמפלט המובנה שהיה תמיד.

---

## 🧩 דפים שעוד inline ב-App.jsx (8 דפים, ~3,800 שורות)

| דף | שורה ב-App.jsx |
|------|---------------|
| `EquipmentPage` | 1435 |
| `PoliciesPage` | 3045 |
| `ArchivePage` | 3249 (קיים `src/components/ArchivePage.jsx` נטוש) |
| `TeamPage` | 3450 |
| `KitsPage` | 4136 |
| `ManagerCalendarPage` | 4509 |
| `SettingsPage` | 4989 |
| `DamagedEquipmentPage` | 5233 |

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
9. **`session.studioIds[]` array — לא `studioId`+`secondaryStudioId`** (PR #20). הזוג הישן הוסר. דפים שעוד מסתמכים על `getEffectiveLessonStudioIds`/`getLessonSessionStudioIds` (חוזרים array). שמירת position מותרת — empty string ב-index `i` שומר את העמודה במקומה.
10. **`course_studios` jsonb explicit column** (PR #21). אסור לחזור לגזירת union מ-`schedule[]` ברמת הקורס — זה גרם ל-phantom columns אחרי reload. chips של הקורס נשמרים ישירות, overrides של מפגש נשארים inline.
11. **Toast aggregation — סינכרוני בלבד** (PR #22). אסור להוסיף async/await/network בנתיב `aggregateKey`. כל הלוגיקה רצה בתוך `setToasts(prev => ...)` + `useRef`. אם מוסיפים latency — `aggregateKey` מפסיק להיות "קוסמטי בלבד" כפי שתוכנן.
12. **Custom message in `studio_lesson_conflict` email** (PR #20). `custom_message` מוצג ב-block "💬 הודעה מהמכללה" בלבד. אסור להחזיר אותו ל-`studentMessageSection` הישן — בעבר זה גרם ל-2 תיבות זהות במייל.
13. **`session.lecturerIds[]` array — לא scalar `lecturerId`** (PR #24). הוספת `session.lecturerIds[]` במקביל ל-`session.lecturerId`. **`lecturerId` חייב להיות נגזר מ-`lecturerIds[0]`** בכל code path (`updateSessionLecturerSlot`, `addLecturerColumn`, `removeLecturerColumn`, XL import builder). שבירת הקשר הזה תפצל את ה-UI מה-state ומה-display surfaces (LecturerPortal/PublicDisplay/buildLessonStudioBookings) שעדיין קוראים את הסקלר.
14. **`course_lecturers` jsonb explicit column** (PR #24). אסור לחזור לגזירת union מ-`schedule[]` ברמת הקורס. דפוס מקביל ל-`course_studios` של PR #21. ה-fallback ל-derivation קיים רק לrows שנכתבו **לפני** המיגרציה — אחרי כתיבה אחת השורה מקבלת `course_lecturers: [...]`.
15. **כפתור "הוסף עמודת מרצה" ≠ chip ב-"מרצי הקורס"** (PR #24). הוספת chip ב-"מרצי הקורס" **לא** מוסיפה עמודה ל-grid (בניגוד ל-`addCourseStudio` של PR #20 שכן מוסיף). העמודות נוספות **אך ורק** דרך לחיצה מפורשת על "👤 הוסף עמודת מרצה". זה דפוס מודע, לא באג — היפוך מהאינטואיציה ב-PR #20.
16. **Lecturer multi-column XL import — column-based, לא row-based** (PR #24). שורת XL עם 3 עמודות "מרצה 1/2/3" מייצרת מפגש עם `lecturerIds = [3 ids]`. שורות עם אותו `(date, time, topic)` אבל מרצים שונים בעמודה היחידה מתמזגות (`importSessionMergeKey` בלי lecturer). אסור להחזיר את ה-lecturer ל-merge key.
17. **כל `usage` חייב `import` — `no-undef` עכשיו ERROR** (PR #40–#42). PR #39 הוסיף שימושים ב-`formatTime` ל-5 קבצים אבל עריכות ה-`import` **נכשלו בשקט** (parallel edits) → `formatTime is not defined` בזמן ריצה → **קריסת דפים** (טופס השאלת ציוד, `/daily`, `/daily-table`, ארכיון, הזמנת אולפן). lint+build עברו כי `no-undef` היה `warn`. תיקון: ייבוא ב-5 קבצים (#40) + 2 missing-imports נוספים שנמצאו בסריקת `no-undef` כוללת — `updateReservationStatus` ב-[CalendarViews.jsx](src/components/CalendarViews.jsx) ו-`deleteReservation` ב-[App.jsx](src/App.jsx) (#41) + העלאת `no-undef` ל-`error` (#42). **לקח: כשמוסיפים usage של helper — לוודא import באותו commit; ה-build חוסם עכשיו. כשעורכים imports במקביל בכמה קבצים — לאמת שכל אחת הצליחה.**
18. **`formatTime(t)` ב-[src/utils.js](src/utils.js)** (PR #39) — helper מרכזי לתצוגת שעת-יום: `String(t).slice(0,5)` → `HH:MM`. חותך שניות גולמיות מה-DB (`09:30:00`→`09:30`) ומאחד מול ערכים שכבר `HH:MM`. **כל תצוגת שעה משתמשת בו** — אסור להציג `borrow_time`/`return_time`/`startTime`/`endTime` גולמי. (במייל הקרון משתמשים ב-slice מקומי כי זה Node, לא ה-bundle.)
19. **`getEffectiveStatus` הוא מקור-האמת היחיד לסטטוס מוצג** (PR #47, [src/utils.js](src/utils.js)). גוזר `מאושר`→`באיחור` כשעבר זמן ההחזרה (mirror של `normalizeReservationsForArchive`), ו-`מאושר`→`פעילה` כשהחל זמן ההוצאה. שיעורים (`שיעור`) מוחרגים מ-`באיחור` (להם נתיב `הוחזר`). **אסור לחזור לגרסה שמחזירה רק `פעילה`** — זה גרם לקפיצה פעילה↔באיחור בתצוגות (PublicForm "ההזמנות שלי" טוען rows גולמיים ל-state המשותף ש-App מנרמל; שני המקורות חייבים להסכים). תופס overdue **מיד** בלי תלות בקרון `check-overdue.js`. הערה: `getAvailable` משתמש בו ולכן מחיל את חלון ה-48h של `באיחור` מיד (מכוון, עקבי עם מצב שאחרי הקרון).
20. **double-booking של אולפן נחסם ברמת ה-DB** (PR #48). ה-`EXCLUDE constraint` `studio_bookings_no_overlap` עמיד-race לקביעות persisted (student/team). **כל בדיקת חפיפה בקליינט עוברת דרך `rangesOverlap` ב-[studioOverlap.js](src/utils/studioOverlap.js)** — אסור להחזיר gate של `!isNight` (גרם לקביעות לילה לדלג על הבדיקה) ואסור השוואות מחרוזות גולמיות במקום ה-helper. **שיעור↔קביעה נשאר client-only** (שיעורים לא persisted). כל `CREATE OR REPLACE` של ה-constraint/`studio_booking_tsrange` — לשמר wrap-around לילה + ה-`WHERE`, ולעשות דה-דופ לפני re-add.

---

## 🛡️ Guardrails חיים

- **ESLint** ([eslint.config.js](eslint.config.js)) חוסם: `storageGet`, `storageSet`, `supabase.from('store'...)`, `from('store_snapshots'...)`, `/api/store`. רמה=ERROR.
- **`no-undef` = ERROR** ([eslint.config.js](eslint.config.js), מ-PR #42) — מזהה בשימוש בלי import/הגדרה = **שגיאת build, ה-CI נכשל**. נוסף אחרי שהשבית את הפרוד import חסר של `formatTime` (PR #40). **חוק: כל `usage` חדש חייב `import` תואם באותו commit — אחרת ה-build ייפול. אל תוסיף `formatTime(...)`/helper בלי לוודא שהוא מיובא בקובץ.**
- **CI workflow** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) — `Lint & build` רץ על כל PR/push. `DB smoke (dev project)` רץ אם `SUPABASE_DEV_URL`/`SUPABASE_DEV_SERVICE_ROLE_KEY` מוגדרים ב-GitHub secrets (כרגע לא — הוא מדלג נקי).
- **Global Error Boundary** ([src/components/ErrorBoundary.jsx](src/components/ErrorBoundary.jsx)) — Hebrew/RTL fallback עוטף את `<App/>` ב-StrictMode.
- **DB smoke** (`npm run test:db`, [scripts/run-db-smoke.mjs](scripts/run-db-smoke.mjs)) — 30 scenarios: `run_reservation_overlap_tests` (13) + `run_productions_regression_tests` (6) + `run_student_overlap_tests` (5) + `run_studio_overlap_tests` (6). מסרב לרוץ אם ה-hostname לא `mhvujejdlmtowypjdhjd`. status נוכחי: **30/30 PASS**.

---

## 🤖 רוטינת סריקה יומית אוטומטית

מנגנון שהוקם ב-2026-05-29 (PR #27–#30): **סוכן ענן אוטונומי** רץ פעם ביום, סורק את הקבצים החמים, מתקן תיקונים בטוחים בלבד ומדווח על השאר ב-PR מתגלגל יחיד.

### שני חלקים

1. **קבצים בריפו = מקור האמת** (לקרוא במלואם לפני נגיעה ברוטינה):
   - **[.claude/audit-routine.md](.claude/audit-routine.md)** — החוזה הקבוע: היקף, חוקי ברזל, פרוצדורה צעד-צעד, פורמט PR + פורמט לוג. ה-prompt של הטריגר רק מצביע על הקובץ הזה — כל הלוגיקה בו.
   - **[.claude/audit-log.md](.claude/audit-log.md)** — לוג state מתמשך; כל ריצה עם ממצאים מוסיפה רשומה. הסוכן של מחר קורא אותו ראשון כדי לא לחזור על עבודה.

2. **הגדרת הטריגר — בענן, לא בריפו** (Claude Code on the web → Routines; לא נראה מתוך הריפו, מתועד כאן):
   - שם: **"סריקה יומית — machsan"**, סטטוס **Active**, סוג **Remote** (ענן).
   - תזמון: **כל יום 09:00 שעון ישראל (Asia/Jerusalem)**.
   - Repository: `nimig10/machsan`. Model: **Opus 4.8**.
   - Connectors: **Context7 + Vercel בלבד** — ה-Supabase connector **הוסר במכוון** כדי שלרוטינה לא תהיה דרך פיזית לגעת ב-DB (חסם קשיח).
   - Permissions: **"Allow unrestricted branch pushes" כבוי** → הסוכן מוגבל לדחוף רק לענפי `claude/*` (main מוגן).

### מה הרוטינה עושה
- סורקת **hot files בלבד**: [src/App.jsx](src/App.jsx), [src/components/LessonsPage.jsx](src/components/LessonsPage.jsx), [src/utils.js](src/utils.js), ו-`supabase/migrations/**` + RPCs (קריאה/דיווח בלבד).
- מצב **"תקן בטוח + דווח השאר"**: מתקנת אוטומטית רק תיקונים בטוחים (null-guards, cleanup, dead code, אופטימיזציות ללא שינוי התנהגות). כל היתר → checklist ב-PR.
- קוראת את **CLAUDE.md בתחילת כל ריצה** כדי לכבד את כל ה-anti-regressions.
- מצטברת ל-**Rolling PR יחיד** על ענף `claude/daily-audit` (לא פותחת PR חדש כל יום — מעדכנת קיים).
- כל PR כולל מקטע **"🧪 מדריך בדיקה ידנית"** בשפת משתמש (איפה במסך / מה לבדוק / על מה לשמור שלא נשבר) — חובה מ-PR #30.

### חוקי ברזל (תקציר — המלא ב-audit-routine.md)
- ⛔ **code-only**: אסור לגעת ב-DB/schema/RPC/migration (לא dev ולא prod). בעיות DB → checklist בלבד.
- ⛔ אסור למזג — **המיזוג הוא של המשתמש בלבד**, אחרי בדיקה ידנית ב-Preview.
- ⛔ אסור לדחוף ל-`main`; רק לענף `claude/daily-audit`.
- 🔂 **מקסימום push אחד ביום** = build אחד ב-Vercel. אימות (`lint`+`build`) מקומי בלבד; אסור לדחוף "כדי לבדוק".
- 🤫 **יום ללא ממצאים → אפס push** (דילוג שקט מוחלט — זה התרחיש הנפוץ).

### איך להשהות / לערוך / למחוק
בדף **Claude Code on the web → Routines**:
- **השהיה**: כיבוי toggle "Repeats" של הרוטינה.
- **עריכה** (תזמון/מודל/connectors/הרשאות): אייקון העיפרון.
- **מחיקה**: אייקון המחיקה.
שינוי החוזה עצמו (היקף, חוקים, פורמט) נעשה בקוד — עריכת [.claude/audit-routine.md](.claude/audit-routine.md) ב-PR רגיל.

---

## 🔥 נקודות חולשה / סיכון

1. **dev לא מיושר ל-prod** — RLS כבוי על `users`/`equipment`/`equipment_units`/`reservations_new`/`reservation_items`/`staff_daily_tasks`, ויש FK constraints ל-`staff_members`. לא קריטי כי dev = sandbox.
2. **`staff_members` legacy** — הקוד הפעיל לא משתמש כ-fallback. ב-prod: 9 rows, אין FK. ב-dev: row אחד + יש FKs. למחוק אחרי וידוא שאין תלות היסטורית.
3. **App.jsx ~7,475 שורות** — 8 דפים inline (טבלה למעלה).
4. **`policy_assets` שומר PDF + XL templates כ-Base64 ב-TEXT** — קריאת מדיניות / טמפלט מושכת blob שלם. tech debt.

---

## 🛠️ כלים זמינים

- **Supabase MCP** — `execute_sql`, `apply_migration`, `list_migrations`, `list_projects`, `get_advisors`.
- **Vercel MCP** — `list_projects`, `get_project`, `list_deployments`, `deploy_to_vercel`.
- **Git + GitHub CLI (`gh`)** — גישה מלאה ל-repo.
- **Context7 MCP** (`ctx7`) — docs של ספריות (דורש restart של Claude Code כשמתקינים).

---

## 📜 היסטוריית PRs אחרונים שעלו לפרוד

- **2026-06-21** — **PR #48** — **guard אטומי נגד double-booking של אולפנים**: `EXCLUDE constraint` `studio_bookings_no_overlap` + `btree_gist` + פונקציית `studio_booking_tsrange` IMMUTABLE (מיגרציה `20260621120000`, הוחלה ב-dev וב-prod; נוקתה כפילות קיימת אחת בפרוד) → race-proof ל-`student↔student/team↔team` וכל שילובי יום/לילה. + סגירת פערי בדיקת-חפיפה בקביעות לילה (סטודנט+צוות) ע"י helper משותף [studioOverlap.js](src/utils/studioOverlap.js) (`rangesOverlap`), מיפוי `23P01`→`studio_overlap`, וטסט CI `run_studio_overlap_tests` (6) → smoke **30/30**. שיעור↔קביעה נשאר client-only (לא persisted). ראה סעיף "🛡️ Guard נגד double-booking" + לקח #20.
- **2026-06-21** — **PR #49** — עיצוב עורך הקורס ([LessonsPage.jsx](src/components/LessonsPage.jsx)): לחצני ההוספה (שיעור נוסף / הוסף עמודת מרצה / הוסף מרצה / הוסף כיתה) עברו לסגול אחיד `#9b59b6` התואם ללחצן "➕ הוסף" הראשי, ושם הקורס הנערך מוצג **דינמית** בכותרת העורך (מתעדכן תוך כדי הקלדה).
- **2026-06-13** — **PR #47** — **חסימת בקשות השאלה חופפות לאותו סטודנט (כל הסוגים)**: שחזור ה-per-student overlap guard ב-`create_reservation_v2` (מיגרציה `20260613153000`) שהופל בשוגג ב-PR #45 + חידוד (התעלמות משיעורים, self-exclude) + **פאנל צף חוסם בשלב האישור ב-[PublicForm.jsx](src/components/PublicForm.jsx)** (עם הנחיה לבטל ב"ההזמנות שלי") + מיפוי שגיאה `student_overlap` ב-[api/create-reservation.js](api/create-reservation.js) + טסט CI `run_student_overlap_tests` (5). **בנוסף**: `getEffectiveStatus` גוזר "באיחור" (לקח #19 — סוף הקפיצה פעילה↔באיחור). ראה הסעיף "🧍 Per-student overlap guard".
- **2026-06-13** — **PR #46** — תיקון **crew snapshot מתיישן**: `production_crew_change_recheck_v1` עכשיו **מרענן** את `crew_*_name/phone` על ההזמנות המקושרות כשצוות מאושר/משתנה אחרי הגשת רשימת הציוד (מיגרציה `20260613150000`) + **backfill חד-פעמי** לשורות קיימות. תוקן באג בו איש סאונד שאושר אחרי ההגשה לא הופיע בלוח הבקרה והסמכותיו נחסמו שלא לצורך. ראה anti-regression #6 בקטע ההפקות.
- **2026-06-04** — **PR #45** — **crew snapshot מועבר לכל הזמנת date-range של הפקה**: `create_reservation_v2` גוזר crew מ-`production_crew` המאושר כש-`production_id` קיים והשם ריק (מיגרציה `20260604120000`, safety net — overlap זהה ל-`20260516160000`), + הקליינט ([PublicForm.jsx](src/components/PublicForm.jsx)) re-derive בזמן submit + re-seed זהות סטודנט ב-"שלח בקשה נוספת" reset. תוקן race שבו snapshot ריק תקע הזמנות ב-"דרושה הסמכה".
- **2026-05-31** — **PR #44** — רענון CLAUDE.md ל-PR #39–#43 + הדגשת זרימת המובייל (Stage 1 localhost מוחלף ב-Stage 2 Vercel Preview עד שתחזור גישת ה-localhost).
- **2026-05-31** — **PR #43** — תצוגת הפקה (לוח הפקות → מצב תצוגה): תוויות **"יציאה:" / "חזרה:"** בטווחי תאריכי הצילום ([ProductionsPage.jsx](src/components/ProductionsPage.jsx)) — ברור מתי הציוד יוצא ומתי חוזר. שורה אחת.
- **2026-05-31** — **PR #42** — הקשחת CI: **`no-undef` → `error`** ([eslint.config.js](eslint.config.js)) + מחיקת 2 בלוקי **קוד-מת** (סינון `{false && …}` ב-PublicForm; טופס login ישן לא-נגיש ב-LecturerPortal). ראה לקח 17.
- **2026-05-31** — **PR #41** — hotfix: ייבוא חסר `updateReservationStatus` ([CalendarViews.jsx](src/components/CalendarViews.jsx)) + `deleteReservation` ([App.jsx](src/App.jsx)) — קריסות סמויות (שינוי סטטוס בלוח מנהל; מחיקה מארכיון) שנמצאו בסריקת `no-undef`. ראה לקח 17.
- **2026-05-31** — **PR #40** — 🚨 **hotfix השבתת פרוד**: ייבוא חסר של `formatTime` ב-5 קבצים (PublicForm/PublicDailyTable/Archive/PublicDisplay/StudioBooking). טופס השאלת הציוד קרס בשלב התאריכים/אישור. ראה לקח 17.
- **2026-05-31** — **PR #39** — תיקוני מובייל: (1) helper `formatTime` + **תצוגת זמן אחידה `HH:MM`** בכל האפליקציה; (2) תוויות "הוצאה/החזרה" בפאנל "בקשות אחרונות" בדשבורד; (3) **מייל תזכורת דדליין הפקה** (cron [api/production-deadline-reminder.js](api/production-deadline-reminder.js) + סוג `production_deadline` ב-send-email + רישום ב-[vercel.json](vercel.json)); (4) **deep-link** `?app=productions`; (5) הערת workflow מובייל ב-CLAUDE.md.
- **2026-05-29** — **PR #30** — חוזה הרוטינה: חובת מקטע **"🧪 מדריך בדיקה ידנית"** בשפת משתמש בכל PR יומי (איפה במסך / מה לבדוק / מה לא לשבור). עדכון [.claude/audit-routine.md](.claude/audit-routine.md).
- **2026-05-29** — **PR #29** — חוזה הרוטינה: **מקסימום push אחד ביום** ל-Vercel + **אפס push בסריקה ריקה** (דילוג שקט). עדכון [.claude/audit-routine.md](.claude/audit-routine.md).
- **2026-05-29** — **PR #28** — הסבב הראשון של הרוטינה (dry-run ידני): **4 תיקוני safe + 7 דווחו**. תיקונים: [src/utils.js](src/utils.js) (`ensureUnits` השוואה מספרית; `groupReservationItemsByCategory` עם `Map` במקום `find` בלולאה), [src/components/LessonsPage.jsx](src/components/LessonsPage.jsx) (`isArchived` מוגן מ-null deref; `normalizeLessonLecturerList` מחושב פעם אחת לכרטיס).
- **2026-05-29** — **PR #27** — הקמת תשתית הרוטינה: [.claude/audit-routine.md](.claude/audit-routine.md) (החוזה) + [.claude/audit-log.md](.claude/audit-log.md) (לוג state). ראו סעיף "🤖 רוטינת סריקה יומית אוטומטית".
- **2026-05-29** — **PR #26** — CLAUDE.md: הבהרה ששני ה-DB נגישים דרך Supabase MCP אך רק prod מופיע ב-`list_projects`; חיזוק חוק dev-first; חובת `project_id` מפורש בכל קריאת MCP.
- **2026-05-28** — **PR #25** — קיבוץ פריטי ציוד בהשאלה לפי קטגוריה + תיקוני מובייל (כולל גלישת שמות ציוד ארוכים ב-modal "צפייה מהירה" של דשבורד צוות).
- **2026-05-26** — **PR #24** (**ממוזג**) — N עמודות מרצה למפגש (`session.lecturerIds[]`) + כפתורי "+ / − הוסף/הסר עמודת מרצה". XL import: `findAllH("מרצה",...)` תופס "מרצה 1/2/3" כעמודות נפרדות, merge key ללא lecturer. עמודה חדשה `lessons.course_lecturers jsonb` (מיגרציה `20260526200000` — **הוחלה ב-prod, אומת 2026-05-29**). תיקון multi-classroom import bundled. LecturerPortal filter מתקן מרצים משניים.
- **2026-05-25** — **PR #23** — Admin מעלה טמפלטים ל-XL import מתוך "הגדרות מערכת". מיחזור `policy_assets` עם slots `xl_template_courses` + `xl_template_students`. אין מיגרציה. fallback ל-base64 המובנה אם אין upload.
- **2026-05-25** — **PR #22** — UX: aggregate delete toasts (single counter toast במחיקות עוקבות), undo stack 10→15 + optimistic state + parallel network, admin/staff idle timeout 20m→60m.
- **2026-05-25** — **PR #21** — Lessons UX overhaul: conflict resolver modal עם textarea + WhatsApp + edit-other-session, lecturer chips עם click-to-promote, view-mode toggle (grouped/flat), creation timestamp, resizable classroom columns, persistence ל-`course_studios jsonb` (מיגרציה `20260525150000`).
- **2026-05-25** — **PR #20** — N כיתות לקורס/מפגש (`studios[]` / `studioIds[]` במקום הזוג הישן), conflict resolver V1, fix team-booking email lookup.

> פיצ'רים מוקדמים יותר (PR #11–#19, לוח הפקות #15, CI+ErrorBoundary #16, ייבוא XL #19, atomic production delete) — מתועדים בסעיפים הייעודיים שלהם למעלה; שורות ההיסטוריה הגרנולריות הוסרו לקיצור.

---

*ההקשר המלא של הקוד נמצא ב-repo, מצב חי ב-DB. כל העבודה committed + pushed.*
