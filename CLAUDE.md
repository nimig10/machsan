# מסמך מעבר חשבון — אפליקציית "מחסן קמרה"

> **מסמך ההקשר היחיד לסשנים חדשים.** עדכני ל-**2026-07-25** (אחרי PR #97).
>
> **לפני שנוגעים בקוד — שני דברים חובה**: בלוק **זרימת העבודה** מיד למטה (השאלה
> הראשונה בכל שיחה חדשה היא *נייד או מחשב?*), וסעיף **🎓 לקחים נלמדו** — שם יושבים
> כל ה-anti-regressions, וזו הסמכות היחידה לשאלה "מה אסור לשבור".

### 🗺️ איפה כל סוג מידע יושב

לכל סוג מידע יש **בעלים אחד**. אם משהו מתועד פעמיים — זו תקלה, לא גיבוי: שני
העותקים יסתרו זה את זה תוך כמה PRs. בסיום פיצ'ר, לעדכן את הבעלים ולא להוסיף
סיכום נוסף בראש הקובץ.

| מה מחפשים | הבעלים |
|---|---|
| מה אסור לשבור, ולמה | **🎓 לקחים נלמדו** (בסוף הקובץ) — הסמכות היחידה |
| איך תת-מערכת עובדת | הסעיף הנושאי שלה: הפקות · אולפנים · יומן מרצה · auth · ייבוא XL |
| מה חוסם מלאי | **🚨 כלל ברזל: סטטוסים שחוסמים מלאי** |
| מה השתנה ומתי | **📜 היסטוריית PRs** — שורה אחת ל-PR |
| איך בודקים לפני merge | **זרימת העבודה** למטה + **🛡️ Guardrails חיים** |

> 📏 **תקציב הקובץ: ~65K תווים.** הוא נטען בכל סשן ובא על חשבון המקום לעבוד בקוד.
> פיצ'ר חדש מוסיף **שורה אחת** ל-📜 היסטוריה. לקח חדש נוסף **רק אם משהו נשבר בפועל**,
> ובפורמט כלל+נימוק — לא סיפור. חורגים מהתקציב → **מקצצים לפני שמוסיפים**.
> אל תשכפל: אם זה כבר בלקח, הסעיף הנושאי מפנה אליו ולא חוזר עליו.

## 🎯 רעיון האפליקציה

אפליקציית ניהול לבית ספר לקולנוע/סאונד בישראל ("קמרה"). מערכת בעברית עם RTL.
ניהול מחסן ציוד, אולפני הקלטה, מסלולי לימוד, תלמידים, מרצים, שיעורים, הסמכות.
טפסים ציבוריים להשאלת ציוד והזמנת אולפנים, פורטל מרצים, דשבורד אדמיניסטרציה, ולוח הפקות.

## 🏗️ מבנה טכני

### Frontend
- React + Vite (עברית, RTL).
- `src/App.jsx` — shell מרכזי (הקובץ הגדול ביותר בריפו). מכיל orchestration גלובלי (state, routing, realtime, auth bootstrap) + **8 דפים inline** שעוד לא חולצו.
- `src/components/LessonsPage.jsx` — הרכיב הגדול ביותר (עורך הקורס, לוח השיעורים, ייבוא XL, פאנל התנגשויות).
- `src/components/` — 32 קבצי JSX.
- `src/utils/` — 20 קבצי utils (entity APIs + `jewishHolidays.js` + `lessonBookings.js` + `studioOverlap.js` + `productionVisibility.js` + `calendarSyncApi.js`).
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

### ⚠️ זרימת עבודה — חובה, אסור לדלג

#### ❓ שלב 0 — השאלה הראשונה בכל שיחה חדשה: "עובדים על נייד או על מחשב?"

**לשאול לפני שנוגעים בקוד.** אי אפשר להסיק את התשובה מההקשר, והיא קובעת את זרימת
העבודה לכל אורך הסשן. (זה נכשל בפועל — סוכן שדילג על השאלה תכנן זרימת localhost
למשתמש שישב על טלפון.)

| התשובה | מה משתנה |
|---|---|
| **מחשב** (ברירת מחדל) | שלושת השלבים כמות-שהם. **Stage 1 חובה** + חל *חוק מרכוז ה-localhost* |
| **נייד** | **Stage 1 מוחלף ב-Stage 2** (Vercel Preview). אין localhost כלל |

לא נשאל או לא נענה → לפעול לפי זרימת **המחשב** (localhost-first).

#### שלושת השלבים

1. **Stage 1 — localhost על dev DB**: `http://localhost:5174` (port נעול ב-`vite.config.js`). כל מיגרציה/כתיבה/SQL-טסט הולך ל-dev. **המשתמש בודק ידנית בדפדפן ומאשר במפורש שעובד.**
   > ✅ **`/api/*` רץ מקומית — E2E מלא אפשרי ב-localhost.** `vite.config.js` טוען `devApi()` מ-[scripts/vite-api-plugin.mjs](scripts/vite-api-plugin.mjs), שמריץ את ה-handlers מ-`api/*.js` **in-process**, טוען `.env.local` ל-`process.env`, ועושה **cache-bust בכל בקשה** (עריכה ב-`api/` נתפסת בלי restart). אין צורך ב-`vercel dev` ולא ב-Preview כדי לבדוק endpoint. אימות מהיר: `GET /api/<route>` מחזיר 401/400 ולא 404.
   > ⚠️ **`strictPort: 5174` נופל בשקט** אם תהליך node ישן עוד תפוס על הפורט — `npm run dev` פשוט לא עולה וקל לפספס. אם השרת לא עולה, לוודא שאין תהליך node ישן על הפורט.
2. **Stage 2 — Vercel Preview על dev DB**: push ל-feature branch → Preview מתחבר ל-dev DB. בזרימת המחשב זה שלב נוסף; **בזרימת הנייד זה השלב המרכזי**.
3. **Stage 3 — Production**: רק אחרי שהמשתמש אישר את שלב הבדיקה שלו במפורש — מחילים מיגרציה ל-prod דרך `apply_migration` MCP **לפני** ה-merge ל-main.

**אסור לדלג על שלב הבדיקה הידנית.** SQL smoke + `npm run test:db` הם בדיקות עזר — **לא תחליף** לבדיקה של המשתמש בדפדפן.

> 💻 **זרימת מחשב — חוק מרכוז ה-localhost** (נקבע 2026-07-23):
> כשעובדים במקביל על כמה PRs, **הענף שרץ על `localhost:5174` חייב להכיל את כל העבודה שטרם מוזגה** — המשתמש מרכז את כל הבדיקות למקום אחד ובודק הכל יחד לפני מיזוג.
> - **ענפים נפרדים ל-PR עדיין נכונים** — הפרדה נעשית ב-git, לא בסביבת הבדיקה. לערום את הענפים זה על זה (`git rebase <ענף-קודם>`) כך ש-localhost הוא **האיחוד** של כולם, ולפרק רק כשה-PRs עולים בפועל.
> - **אסור להחליף ענף באמצע סשן בלי להגיד מה ייעלם מהמסך.** מעבר לענף שיצא מ-main מוציא פיצ'רים שהמשתמש בודק כרגע — זה קרה, והמשתמש שאל "איפה הפיצ'ר הזה???" באמצע בדיקה. היגיינת ענפים לא שווה כלום אם היא עולה למשתמש בסביבת הבדיקה.
> - **סדר מיזוג**: למזג לפי סדר הערימה (התחתון ראשון), ואחרי כל מיזוג לרבייס את מה שנשאר מעל main כדי למנוע התנגשויות.
> - **חריג יחיד**: לפצל כשהערימה באמת מסוכנת — שני ענפים שעורכים את אותן שורות, או מיגרציה שחייבת לנחות לבד.

> 🟢 **זרימת נייד** (רק אם המשתמש ענה "נייד"): אין גישה ל-localhost, ולכן **Stage 1 מוחלף ב-Stage 2**:
> 1. כל שינוי קוד → ענף + **PR ייעודי** → Vercel Preview (מחובר ל-**dev DB**).
> 2. המשתמש בודק **במובייל על ה-Preview** ומאשר.
> 3. רק אז **merge ל-main** — דרך **merge-PR** (main מוגן מ-push ישיר; `mcp__github__merge_pull_request`).
> - לבדיקת **עיצוב מיילים** מהנייד: לרנדר את ה-HTML דרך `buildEmail` ולשלוח **תמונת PNG** (headless chromium ב-`/opt/pw-browsers/...`) — קל יותר מ-HTML לגלילה בנייד.
> - תיקוני **חירום/hotfix** נדחפים ל-main באישור מפורש של המשתמש בלבד.
> - **שאר חוקי הברזל ללא שינוי** — שינויי DB/schema/migration עדיין dev-first ובאישור מפורש, ואין merge בלי אישור המשתמש.
>
> ⚠️ **מלכודת: כתובת Preview היא פר-דפלוימנט וקפואה.** כל push יוצר URL חדש
> (`machsan-<hash>-…vercel.app`); הישן **לא** מתעדכן לעולם. משתמש שנשאר על לשונית
> קודמת בודק build מלפני כמה סבבים ומדווח שהתיקון לא עבד — **זה קרה, ובזבז סבבים
> שלמים**. אחרי כל push למסור את ה-URL **החדש**, או להפנות לפרודקשן אחרי merge.
> אם דיווח לא מסתדר עם הקוד — לבדוק את ה-hash בכתובת **לפני** שמחפשים באג.

> 📧 **כתובת מייל לבדיקות:** `nimig10@gmail.com` — כל בדיקת מיילים (תצוגות עיצוב, `force_test` של קרונים וכו') נשלחת לכתובת הזו.

**`CREATE OR REPLACE FUNCTION` הוא שינוי schema** ודורש אישור מפורש של המשתמש לסשן הנוכחי. אישור תוכנית מראש **לא** מהווה אישור לרוץ על prod.

### כללים נוספים
- **חוק ברזל**: כל בדיקה/מיגרציה/כתיבה רצה **קודם על dev** (`mhvujejdlmtowypjdhjd`). גישה או עדכון של **prod** (`wxkyqgwwraojnbmyyfco`) מותרים **רק** אחרי שהמשתמש אישר במפורש בסשן הנוכחי ש-dev עובד תקין. אישור תוכנית מראש ≠ אישור לרוץ על prod.
- חובה לנקוב `project_id` **מפורש** בכל קריאת MCP — אסור להסתמך על ברירת מחדל (ה-list מציג רק את פרוד, ראו הערה למעלה). ל-dev: `project_id: "mhvujejdlmtowypjdhjd"`.
- שגיאה/נתונים חסרים — קודם לוודא לאיזה DB מחוברים, לא להניח שהבעיה בקוד.

---

## 🗄️ מבנה DB — Tables-only (אין `public.store`)

ה-blob (`public.store`) הוסר ב-`20260430220000`. כל ישות יושבת בטבלה נורמלית.

### טבלאות domain

| ישות | טבלה(ות) | API util |
|---|---|---|
| ציוד | `equipment` + `equipment_units` | `writeEquipmentToDB` (RPC) ב-utils.js |
| השאלות | `reservations_new` + `reservation_items` | `createReservation`, `updateReservationStatus` |
| קיטים / צוות / קטגוריות | `kits` · `team_members` · `categories`+`loan_type_filters` | `kitsApi` · `teamMembersApi` · `categoriesApi` |
| מרצים / שיעורים / אולפנים | `lecturers` · `lessons` · `studios` | `lecturersApi` · `lessonsApi` · `studiosApi` |
| הזמנות אולפן | `studio_bookings` | `studioBookingsApi.js` |
| מדיניות | `policies` + `policy_assets` (Base64 PDF + טמפלטי XL) | `policiesApi.js` |
| הגדרות / מנהל / ראשי מחלקה | `site_settings` · `college_manager` · `dept_heads` | `siteSettingsApi` · `collegeManagerApi` · `deptHeadsApi` |
| סטודנטים | `students` + `certification_types` + `student_certifications` + `tracks` | `studentsApi.js` |
| לוח הפקות | `productions` + `production_dates`/`_crew`/`_slots` | `productionsApi.js` |
| יומן המרצה | `lesson_calendar_events` | `api/calendar-sync.js` + `calendarSyncApi.js` |
| הודעה יומית | `announcements` + `announcement_views` | `api/announcement.js` + `announcementPolicy.js` |
| עדכון פריטים בבקשה | `reservation_item_updates` + `reservation_pending_items` | `reservationUpdatesApi.js` + 2 endpoints |

**טבלאות תומכות**: `users` (מראת auth — **המקור הפעיל להרשאות**), `activity_logs`,
`equipment_reports`, `auth_entity_map`, `auth_rate_limits`, `staff_members` (legacy,
ה-fallback הוסר), `staff_schedule_assignments`/`_preferences`, `staff_daily_tasks`,
`staff_personal_tasks`, `staff_hub_checkoffs`, `reservation_staff_assignments`.

> **RLS-on ללא policies, API-only**: `staff_schedule_*`, `staff_personal_tasks`,
> `staff_hub_checkoffs`, `lesson_calendar_events`, `announcements`(+`_views`).
> אין להם גישת-קליינט ישירה — רק דרך ה-endpoint שלהם.

**עמודות שנוספו ל-`reservations_new`** — כולן **display-only**; אף guard/RPC/חישוב
זמינות לא קורא אותן, וכולן **בלי FK** במכוון כדי לשרוד מחיקת משתמש:
`production_id`+`production_date_id` (FK אופציונליים, SET NULL) ·
`original_items` jsonb (סנאפ-שוט מוקפא של מה שיצא — לקח #35+#44) ·
`returned_by_staff_id`+`returned_by_name` (מי החזיר בפועל) ·
`approved_by_staff_id`+`approved_by_name` (מי אישר בפועל) — שתי האחרונות נגזרות-JWT
בשרת דרך helper משותף `stampActor`, לקח #37+#41.
בנוסף: `productions.kit_id` (מגביל את ההזמנה לפריטי הערכה) ו-2 עמודות השאלת-חוץ על
`equipment` — **על `equipment` ולא `equipment_units`**, כי הטופס טוען `select("*")`
ולא מושך unit rows (לקח #21).

### RPCs פעילות

- **ציוד** — `sync_equipment_from_json` ⚠️ **delete+reinsert של units + COALESCE**,
  ולכן דגלים שלא שוטחו ל-camelCase נמחקים בשקט (לקח #21).
- **הזמנות** — `create_reservation_v2` (**4 guards**: per-student overlap,
  זמינות peak-concurrent, crew-derive, השאלת-חוץ) · `update_reservation_status_v1`
  (**guard אטומי נגד הקצאת-יתר באישור**, לקח #22) · `create_lesson_reservations_v1` ·
  `delete_reservation_v1` · `restore_reservation_v1` ·
  `student_modify_reservation_item_v1` · `mark_overdue_email_sent`.
- **עדכון פריטים בבקשה** — `student_submit_reservation_update_v3`→`_v1` ו-
  `staff_review_reservation_update_v3`→`_v1`. **כל ארבעתן `service_role` בלבד**;
  ה-`_v1` חסומות ל-`anon/authenticated` כדי שלא יעקפו את שער ה-lead-time (לקח #40).
- **לוח הפקות** — `production_approve_crew_v1` · `production_crew_change_recheck_v1` ·
  `production_delete_v1` (**HARD delete אטומי**) · `productions_refresh_archive_v1` ·
  `crew_is_certified_for_equipment` · `check_director_no_overlap_for_production` ·
  `production_check_crew_conflict_v1` (inert — נותק מהקליינט ב-PR #75).
- **אולפנים** — `studio_booking_tsrange` (IMMUTABLE, מזין את ה-`EXCLUDE constraint`).
- **Auth** — `is_admin`, `is_staff_member`, `is_known_lecturer_email`, `link_auth_to_entity`.
- **טסטים** — `run_*_tests` (ראה 🛡️ Guardrails). ⚠️ כולן `SECURITY DEFINER` וניתנות
  להרצה ע"י `anon` בפרוד; דפוס ותיק ולא רגרסיה (נוגעות רק בשורות `test-`), אך
  הזדמנות הקשחה: `REVOKE ... FROM anon, authenticated`.

### Triggers
`touch_updated_at` · `set_updated_at` · `update_users_updated_at` ·
`production_crew_after_change_trigger` · `production_dates_director_overlap_trg` ·
`productions_status_director_overlap_trg` ·
`production_crew_photographer_sound_must_be_student`.

### סדרי גודל בפרוד — סנאפ-שוט, לא מצב חי

⚠️ נמדד **2026-05-25** (השאלות/ציוד אומתו 2026-07-19) ומאז לא רוענן. שימושי כסדר
גודל — למשל להערכת עומס לפני פיצ'ר שעובר על אוסף (לקח #39) — **אבל לא כמצב נוכחי.**
לספירה אמיתית: `execute_sql` מול `wxkyqgwwraojnbmyyfco`.

`users`≈107 · `students`≈168 · `lecturers`≈31 · `lessons`≈145 (הקרון מדד 166
ב-07-20) · `studio_bookings`≈295 · `reservations_new`≈167 (+`reservation_items`≈1,379)
· `equipment`≈131 (+`equipment_units`≈321) · `productions`≈23 (כולן legacy מול
ה-cutoff של PR #75) · `staff_members`=9 (legacy).

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

### 🚫 הגבלת השאלת-חוץ של ציוד (PR #51–#53)
איש המחסן יכול לסמן פריט שלא ייצא מהקמפוס בהשאלות שפיזית מוציאות ציוד החוצה — **`פרטית` + `הפקה` בלבד** (קבוע `EXTERNAL_LOAN_TYPES` ב-[src/utils.js](src/utils.js)). שאר הסוגים (`סאונד`/`קולנוע יומית`/`צוות`/`שיעור`) **לא מושפעים**.

**שתי דרגות הגבלה** (שתיהן ב-`UnitsModal` ב-[App.jsx](src/App.jsx), פאנל "🔒 הגבלת השאלת חוץ"):
- **חסימה מלאה** — `external_loan_restricted=true` ("הגבל את כל היחידות"). הפריט **נעלם לגמרי** מ-step 3 של PublicForm בהשאלה פרטית/הפקה.
- **החזקת N יחידות** — `external_loan_hold_count=N` ("החסר N יחידות"). הפריט זמין אך ה-available pool מצומצם ב-N כך ש-≥N יחידות תמיד נשארות בקמפוס.

**אכיפה בשתי שכבות**:
1. **קליינט** — [PublicForm.jsx](src/components/PublicForm.jsx): `visibleAvailEq` מסנן פריטים `externalLoanRestricted` בסוגי השאלת-חוץ, ו-`availEq` מאפס/מקטין את ה-`avail` לפי ה-hold-count. תלוי ב-`form.loan_type` ב-deps.
2. **DB (race-proof)** — `create_reservation_v2` (guard רביעי): `external_restricted`→זריקה; `hold_count`→`v_available := GREATEST(0, v_available - v_ext_hold)`. ה-API ([api/create-reservation.js](api/create-reservation.js)) ממפה `external_restricted`→409 → toast עברית ב-PublicForm.

**UI נוסף**: chips בכרטיס הציוד (🔒 "מוגבל להשאלת חוץ" אדום / 🔒 "מוחזק בקמפוס: N" צהוב), כפתור "יחידות" נוסף בתוך `EqForm` (`onOpenUnits`). הכפתור הישן "לא מוגבל בהשאלה פרטית" ברמת-קטגוריה **הוסר** — `privateLoanUnlimited` עבר לרמת פריט בלבד (toggle ב-`EqForm`).

**Anti-regression**:
1. **`normalizeEquipmentTagFlags` חייב לשטח את העמודות ל-camelCase** (ב-**שני** העותקים — `App.jsx` ו-`utils.js`). בלי זה, כתיבת-מערך-מלא הבאה (`sync_equipment_from_json`) שולחת keys ריקים, ה-RPC עושה `COALESCE→false/0`, והערכים השמורים **נמחקים בשקט**.
2. `UnitsModal.saveAll` clamp: `external_loan_hold_count` ל-`[0, units.length]`, וכש-`restrictAll` → `hold_count=0`. PR #52 הוסיף auto-sync דו-כיווני (N≥units.length→restrictAll; ביטול restrictAll→N=0).
3. רשימת הסוגים המושפעים = `EXTERNAL_LOAN_TYPES` בקליינט **ו**-`v_loan_type IN ('פרטית','הפקה')` ב-RPC — לשמור מסונכרן.

---

## 🎬 לוח הפקות (Productions Board)

### זרימה
1. סטודנט → **StudentHub** ([src/components/StudentHub.jsx](src/components/StudentHub.jsx)) — 2 כרטיסים: "מערכת הפניות" / "לוח הפקות".
2. **ProductionsPage** — board (published), inbox (בקשות נכנסות/יוצאות). חיפוש סטודנטים = טקסט חופשי.
3. **ProductionEditor** — כותרת, תיאור (800 תווים), Drive URL, צבע, סוג (כללית / kit), עד 7 ימי צילום, צוות. פוטוגרף + סאונד חייבים סטודנט רשום.
4. **צוות — ללא אישורים (PR #75)**: הבמאי מרכיב את הצוות ישירות בעורך; שורות נכתבות `invited` ומאושרות אוטומטית בשמירה דרך `production_approve_crew_v1` (`autoApproveDirectorCrew`). מנגנון "בקש להצטרף"/inbox הוסר לחלוטין. מייל יידוע נשלח לצוות ("שובצת להפקה").
5. **השאלת ציוד להפקה** — bridge ל-PublicForm עם `loan_type="הפקה"` + `production_id`. עם `dateId` (כפתור פר-טווח) נוחת **ישר בשלב הציוד** (`setStep(3)`) ממולא-מראש. ב-step 3, אם להפקה `kit_id` — נעול לפריטי הערכה. **חובת רשימה פר-טווח (הפקות חדשות)**: טווח מופיע בלוח רק אחרי הגשת רשימה; ראה לקח #33.

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

**4 סוגי הזמנות** בטבלה אחת:

| סוג | מי יוצר | זיהוי בקוד | הערה |
|---|---|---|---|
| `lesson` | אדמין | `lesson_auto:true` / `lesson_id` | **נגזר מ-`lessons.schedule[]` ע"י `buildLessonStudioBookings()` — לא persisted** |
| `team` | אדמין/צוות | `teamMemberId` | קביעה לטכנאי/מדריך |
| `student` | סטודנט | `studentName`, לא לילה | טופס "הזמנת אולפן" |
| `night` | סטודנט | `isNight:true` | slot לילה 21:30+ |

### 🛡️ Guard נגד double-booking (race-proof ב-DB)

היסטורית לא הייתה אכיפת-שרת בכלל: כל הבדיקות היו בקליינט מול מערך בזיכרון, ותחת
race שני קובעים עברו בדיקה מקומית ושניהם כתבו.

`EXCLUDE constraint` **`studio_bookings_no_overlap`** (btree_gist, מיגרציה
`20260621120000`) חוסם פיזית ואטומית שתי קביעות **persisted** חופפות על אותו חדר.
ה-`WHERE` שלו: `lesson_auto=false AND status<>'נדחה' AND start/end NOT NULL`.
הפונקציה `studio_booking_tsrange` היא IMMUTABLE ובונה `tsrange` מ-TEXT עם
`make_timestamp` (לא `text::timestamp`, שהוא STABLE) כולל **wrap-around לילה**
(`end<=start → +1 יום`). שגיאת `23P01` ממופה ל-`error:"studio_overlap"` ב-
[studioBookingsApi.js](src/utils/studioBookingsApi.js) → toast עברית + revert אופטימי.

**מכוסה**: כל צירוף של קביעות persisted (student↔student, student↔team, team↔team),
יום ולילה. **לא מכוסה**: שיעור↔קביעה — שיעורים לא persisted ולכן ה-`EXCLUDE` לא רואה
אותם; החסימה שם היא בקליינט בלבד. פער מודע ומקובל (שיעורים נוצרים ע"י אדמין,
concurrency נמוך) — החלטת בעל המוצר 2026-06-21.

> **פער פתוח (Layer B)**: נתיב הכתיבה של הצוות עדיין `syncAllStudioBookings`
> מערך-מלא עם delete-missing, שיכול לדרוס קביעות מקבילות. ה-constraint מונע כפילות
> אך לא clobber. follow-up מומלץ: כתיבות שורה-בודדת.

**לפני הוספת/החלפת ה-constraint — חובה דה-דופ** של כפילויות קיימות, אחרת ה-`ALTER`
נכשל; שאילתת הזיהוי מתועדת כהערה במיגרציה. שאר כללי ה-anti-regression: לקח #20.

### N כיתות ו-N מרצים למפגש

מפגש מחזיק **מערכים**: `session.studioIds[]` ו-`session.lecturerIds[]`, שניהם
position-preserving (מחרוזת ריקה שומרת עמודה במקומה). ברמת הקורס יש **עמודות jsonb
ייעודיות** — `lessons.course_studios` ו-`lessons.course_lecturers` — ולא גזירת union
מהמפגשים (לקחים #10, #14).

- **קריאה תואמת-אחורה**: שורה ישנה עם `studioId`/`secondaryStudioId` סקלריים נארזת
  למערך. **השמירה תמיד יוצאת כמערך.**
- **`session.lecturerId` הסקלרי נשמר כ-shim** ל-code paths שעוד קוראים אותו
  (LecturerPortal, PublicDisplay, buildLessonStudioBookings) ותמיד נגזר מ-`[0]`.
- **הבדל מכוון בין כיתות למרצים**: chip ב"מרצי הקורס" **לא** מוסיף עמודה ל-grid —
  רק לחיצה על "הוסף עמודת מרצה" מוסיפה. אצל כיתות זה כן אוטומטי. לקח #15.
- `instructorName` של booking נגזר הוא **join של כל מרצי המפגש ב-`" + "`**.
- מרצה רואה שיעור אם הוא ב-`lesson.lecturers[]` **או** ב-`session.lecturerIds[]` —
  לא מסתפקים בסקלר.

ה-helpers חיים ב-[lessonsApi.js](src/utils/lessonsApi.js) (`normalize*`,
`buildCourse*`, `trimTrailingEmpties`), ב-[lessonBookings.js](src/utils/lessonBookings.js)
(`getEffectiveLesson*Ids`) וב-[LessonsPage.jsx](src/components/LessonsPage.jsx)
(`updateSession*Slot`, `add/removeLecturerColumn`) — `grep` לפי השם.

### Toggle ידני "צרף סטודיו הקלטות"

קיים **רק ב-team + student bookings** ב-MAIN CONTROL/DIGITAL MIX ROOM — **לא
בשיעורים** (לקח #7). כשמסומן נוצרות **2 רשומות נפרדות** באותם תאריך/שעה; **אין
עמודת `companion_booking_id`**, וההתאמה בעריכה נעשית ב-runtime לפי
`date+studioId+studentEmail+startTime+endTime`. הסרת ה-toggle בעריכה מוחקת את
ה-companion.

---

## 📊 ייבוא XL לשיעורים

file picker → מודאל מצב → parser → validation עם **שמירה חלקית** → דוח שגיאות
שאפשר לערוך ולנסות שוב. כל ה-pipeline ב-[LessonsPage.jsx](src/components/LessonsPage.jsx),
ספריית `xlsx`.

1. **מודאל מצב** — `upsert` (עדכון+יצירה) או `create_only`.
2. **`readImportRowsFromFile()`** — `XLSX.read` → `sheet_to_json` → התאמת עמודות לפי
   שמות עבריים ("קורס"/"תאריך"/"התחלה"…).
3. **`buildImportGroups()`** — ולידציה שורה-שורה: קורס, מסלול, מרצה קיים, תאריך,
   חלון שעות, חדר. כשלים נאספים ל-`reportErrors`.
4. **`runLessonImportRows()`** — שורות תקינות נכנסות, נבדקות מול התנגשויות מרצה+חדר,
   ומצטברות ל-`baseLesson.schedule`. **קורס שכל מפגשיו נפסלו נופל לדוח.**
5. **retry** — עריכת שורה כושלת בדוח מריצה אותה שוב **באותו pipeline**
   (`runLessonImportRows([row],{retry:true})`), ואם עברה היא יוצאת מהדוח.

**`splitImportCellValues` חותך תאים לפי `,;،，` — רק בעמודת הכיתה.** עמודת המרצה
לא נחתכת; כל מרצה הוא עמודה נפרדת ("מרצה 1/2/3") או שורה נפרדת. ריבוי-מרצים הוא
column-based — לקח #16.

**`dedupeScheduleEntries`** מאחד מפגשים כפולים לפי `date__startTime__endTime`, ורץ
בטעינה, בייבוא ובשמירה. במיזוג, שדות נלקחים מהראשון שיש בו ערך, וכל ה-`studioIds`
מתאחדים למערך אחד.

**`normalizeLessonLecturerList`** מאחד 3 מקורות למרצי הקורס (סקלר + `lecturers[]` +
מרצי-מפגש) עם dedup לפי id-או-שם-מנורמל. **החיפוש חייב לעבור דרכו** ולא דרך
`instructorName` בלבד, אחרת מרצים משניים לא נמצאים. אותו predicate מזין את פילטר
"ללא מרצה".

### שעת סיום — כללים לא-אינטואיטיביים
`lessonEndTimeOptions(start, current)` מסנן לשעות שאחרי ההתחלה, אבל:
**`00:00` מתווסף במפורש בסוף ואינו מסונן פנימה** — הוא סיום חוקי (ערב עד חצות) אך
לא שעת התחלה, ומיון מחרוזות היה מציב אותו ראשון ומעיף אותו. **ערך שמור שכבר לא
עומד בכלל נשאר ברשימה**, כדי שפתיחת מפגש ישן לא תשכתב אותו בשקט. גרירת הסיום
כשההתחלה עוברת אותו ממומשת **פעם אחת** ב-`updateSessionField`, כדי שמובייל ודסקטופ
לא ייפרדו. חל על 4 נקודות בחירה.

### פאנל "שיוך כיתות לימוד"
מנהל את `course_studios` כ-chips; ה-dropdown מציג את **כל** הכיתות במערכת.
ה-binding הוא **לפי מיקום** (`value={sessionIds[colIdx]}`) ולא לפי studioId — אחרת
החלפת ערך בעמודה יוצרת orphan. chip שיש רק במפגש ולא ב-`course_studios` הוא override
של המפגש ואינו דולף לרמת הקורס.

### מודאל פתרון התנגשויות
חפיפת חדר או מרצה פותחת `ConflictResolverCard`: מציג את כל המפגשים המתנגשים, מאפשר
לשנות כיתה/מרצה של **המפגש האחר** ישירות, ומציע הודעה מותאמת + deep-link ל-WhatsApp.
בהתנגשות חדר נשלח מייל `studio_lesson_conflict` — ה-`custom_message` שלו מוצג
**רק** בבלוק "💬 הודעה מהמכללה" (לקח #12).

---

## 📅 מפגשי קורס ליומן המרצה

מרצה מקבל את מפגשיו ליומן גוגל והיומן נשאר מעודכן — **בלי Google Calendar API ובלי
OAuth**, דרך קובץ iCalendar במייל. **כל כללי הפורמט והקצב הם לקח #38 — הם נקבעו
אמפירית מול Gmail ואסור לשנותם בלי בדיקה מקצה-לקצה מול תיבה אמיתית.**

### שני סוגי מייל, וזהו

| מתי | מה נשלח | ICS? |
|---|---|---|
| פעם ראשונה שמודיעים למרצה על הקורס | **הזמנה** `course_calendar_invite` — "Add to Calendar" אחד פורס את כל מפגשיו | ✅ הכל |
| כל שינוי אחר כך (הוזז/נוסף/בוטל/נמחק) | **הודעת שינויים** `course_sessions_changed` עם לפני←אחרי | ✅ **רק מה שנוסף** |
| שמירה בלי שינוי אמיתי | כלום (idempotent דרך `last_hash`) | — |

**העדכון ידני במכוון**: Gmail לא מעדכן אירוע שנוסף דרך "Add to Calendar", ולכן מפגש
שהוזז או בוטל **מתואר במילים** והמרצה מתקן בעצמו. מפגש **חדש** כן מקבל קובץ — הוא
עוד לא ביומן, אז אין סיכון כפילות. החלטת בעל המוצר (2026-07-20) אחרי שכל מסלול
ה-iMIP נכשל.

נוסח ההזמנה כולל בלוק **"📍 מקום הלימוד"** — הכיתות שהמרצה מלמד בהן, הכתובת והוראות
הכניסה, פעם אחת ולא בכל שורה. `rooms` על ה-entry הוא **תצוגה בלבד ואינו נכנס
ל-hash** (הכיתה כבר בתוך `description` שכן נכנס) — אחרת נשלחים מיילי-שינוי שקריים.

### מודל הדלתא

`lesson_calendar_events` שומרת פר `(lesson_id, session_key, lecturer_id)` **סנאפ-שוט
של מה שנמסר למרצה בפועל**. `reconcileLesson` ב-[api/calendar-sync.js](api/calendar-sync.js)
גוזר את הרצוי מה-`lessons` החי ומשווה:

- מפתח ברצוי בלי שורה → **added**
- שורה עם `last_hash` שונה → **changed** (ה"לפני" מגיע מהסנאפ-שוט — זו כל סיבת קיומו)
- שורה `active` שמפתחה נעלם → **removed** (`status='cancelled'`; השורה נשמרת כדי לא לדווח שוב)
- מפגש **עבר** — לא נוגעים בו לעולם

**קורס שנמחק מטופל בחינם**: אין שורה ב-`lessons` → אין רצוי → הכל מדווח כמבוטל.

### נקודות הפעלה

`POST {lessonId}` (קליינט, אחרי שמירה/מחיקה) · `GET ?force_test=<lessonId>` ·
`GET ?reconcile=all[&dryrun=1]`. אימות `requireStaff` **או** `X-Cron-Secret`;
**`reconcile=all` חי דורש את ה-cron secret** ולא רק JWT של צוות (לקח #37+#41).
אפס env חדשים. בקליינט מחווט מ-`doSaveLesson`, מחיקת קורס, **ייבוא XL** ו**פאנל
ההתנגשויות**. מיילים דרך `/api/send-email` בלבד — אין transporter שני.

> ⚠️ **ה-cron היומי הוא `dryrun=1` בלבד.** `reconcile=all` ללא dryrun ישלח הזמנה
> לכל מרצה במכללה — **אסור לרשום אותו כ-cron**.

---

## 🔐 Auth + זרימות

### Login — Password only
`supabase.auth.signInWithPassword` ב-`handleLogin` ([PublicForm.jsx](src/components/PublicForm.jsx)). **אין magic link login.** ה-`flowType: "implicit"` ב-[src/supabaseClient.js](src/supabaseClient.js) קיים רק לקישורי password-reset (כולל in-app browsers כמו WhatsApp).

### Onboarding משתמש חדש
**אין יצירת חשבון מפורשת.** משתמש חדש (סטודנט/מרצה/צוות) שעוד אין לו `auth.users` row — לוחץ "שכחת סיסמה?" → `/api/auth` action `send-reset-email` → Gmail SMTP → המשתמש יוצר סיסמה → מתחבר. `auth.users` נוצר רק כשהמשתמש יוצר סיסמה. **גם "הוספת איש צוות" עוברת את אותו תהליך** (PR #73) — הטופס בניהול צוות לא כולל סיסמה; `handleCreate` ב-[api/staff.js](api/staff.js) יוצר auth בלי password (או משדרג-ממזג משתמש קיים בלי לגעת בסיסמתו).

### מולטי-תפקיד (PR #73)
משתמש שהמייל שלו רשום בכמה תפקידים רואה בכל HUB את כל הממשקים שלו: דגלי `is_student`/`is_lecturer` **נגזרים** מהטבלאות החיות (סנכרון ב-ensure-user/reset + drift-detection בלוגין), `roleFlags` מועברים לכל שלוש הזהויות (`staff_user`/`lecturer_portal_user`/`public_student_roles`), ומעבר-תפקיד = `sessionStorage.active_role` + reload (מסך "מעביר…"). כרטיסי מעבר: StudentHub ("פורטל מרצה"/"ניהול מערכת"), LecturerPortal ("ניהול מערכת"/"מעבר לתצוגת סטודנט"), StaffHub ("מעבר לתצוגת סטודנט/מרצה") — כולם בצהוב `#f5a623`, מותני-דגלים בלבד. מחיקת איש צוות של מייל שעדיין סטודנט/מרצה = הסרת-תפקיד בלבד. ראה לקח #31.

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
admin/staff מתנתק אוטומטית אחרי **60 דקות** של חוסר פעילות (היה 20m). מימוש ב-[App.jsx](src/App.jsx).

### XL import templates — admin upload (PR #23)
- אדמין מעלה טמפלטים ב-**הגדרות מערכת** ("טמפלטים לייבוא Excel (XL)") — 2 slots: `xl_template_courses` + `xl_template_students`.
- אחסון: **מיחזור `policy_assets`** (אותה טבלה של PDFs) — אין מיגרציה, אין טבלה חדשה. הbase64 נשמר ב-`data_base64` text.
- הורדה ב-"הגדרות → אדמיניסטרציה" קוראת ל-`loadXlTemplate(slot)` ב-[src/utils/xlTemplatesApi.js](src/utils/xlTemplatesApi.js); אם אין שורה → fallback ל-`COURSES_TEMPLATE_B64`/`STUDENTS_TEMPLATE_B64` (constants ב-App.jsx).
- 100% backwards-compatible: בלי upload המשתמש מקבל את אותו טמפלט המובנה שהיה תמיד.

---

## 🧩 דפים שעוד inline ב-App.jsx

שמונה דפים שטרם חולצו לקבצים משלהם. ל-`grep` לפי השם — **מספרי שורה לא נשמרים כאן**,
הם התיישנו בכל PR ושלחו קוראים לקוד הלא-נכון:

`EquipmentPage` · `PoliciesPage` · `TeamPage` · `KitsPage` · `ManagerCalendarPage` ·
`SettingsPage` · `DamagedEquipmentPage` · `ArchivePage`

⚠️ **`ArchivePage` ב-App.jsx הוא קוד מת — לא מרונדר לעולם.** הקובץ החי הוא
[src/components/ArchivePage.jsx](src/components/ArchivePage.jsx) (סאב-תצוגה של
`ReservationsPage`). אומת ב-PR #78, ונערך בפועל ב-PR #95 — לפני עריכת "הארכיון"
לוודא באיזה משניהם נוגעים.

שאיפה: App.jsx = shell/state/routing בלבד.

---

## 🎓 לקחים נלמדו (anti-regressions)

> כל שורה כאן נכתבה **אחרי** שמשהו נשבר בפועל. הפורמט הוא **הכלל** ואז *למה* —
> הנימוק קיים כדי שאיש לא "יתקן" את הכלל בחזרה. הסיפור המלא של כל באג חי ב-PR שלו.
> המספור **קבוע לנצח**: הפניות "ראה לקח #N" פזורות בקוד ובקומיטים. לקחים שמוזגו
> נושאים מספר כפול, והמספר המשוחרר נשאר ריק.

1. **dedup של `lecturers` לפי `lower(email)` לפני `lower(name)`** — יש UNIQUE על email, ו-dedup לפי שם מייצר 23505. ה-bootstrap ב-App.jsx מחלץ מרצים משיעורים אוטומטית.
2. **אסור להחזיר את `lock` ל-default ב-`supabaseClient.js`** — `navigator.locks` יוצר deadlock תחת Edge tracking-prevention ו-PWA standalone.
3. **אסור `await routeByRoles` ב-onAuthStateChange** — ה-listener חייב להישאר fire-and-forget; await חוסם את `signInWithPassword` ועובר את ה-safety timer של 10 שניות.
4. **אסור להחזיר את ה-Identity-confirmation modal** — RLS + FK על `public.users.email` כבר מספקים את ההגנה.
5. **`באיחור` חוסם רק בחלון 48h, אסור `FAR_FUTURE`** — חסימת-לנצח חסמה כל השאלה עתידית. `OVERDUE_BLOCK_BUFFER_MS` ב-utils.js + App.jsx.
6. **`toDateTime()` מחזיר number ולא Date** — אל תקרא `.getTime()` על התוצאה.
7. **אסור auto-coupling של MAIN CONTROL → סטודיו הקלטות בשיעורים** (הוסר ב-`6c89345`) — שיעור לא משריין אולפן שני מעצמו; צריך לבחור כיתה משנית במפורש. ה-toggle הידני ב-team/student booking נשאר opt-in.
8. **`production_delete_v1` נקרא ישירות מ-React** (`supabase.rpc`) — hard-delete אטומי בטרנזקציה אחת. אסור להחזיר endpoint עוקף.
9. **`session.studioIds[]` מערך, לא `studioId`+`secondaryStudioId`** — הזוג הישן הוסר. מחרוזת ריקה ב-index `i` שומרת את העמודה במקומה (position-preserving).
10. **`course_studios` jsonb מפורש — אסור לחזור לגזירת union מ-`schedule[]`** — הגזירה גרמה ל-phantom columns אחרי reload; overrides של מפגש נשארים inline.
11. **Toast aggregation סינכרוני בלבד — אסור async/await/network בנתיב `aggregateKey`** — כל הלוגיקה בתוך `setToasts(prev=>...)` + `useRef`; latency הופך אותו ממנגנון קוסמטי לעיכוב בלחיצה.
12. **`custom_message` מוצג רק בבלוק "💬 הודעה מהמכללה"** — החזרתו ל-`studentMessageSection` הישן יצרה 2 תיבות זהות במייל `studio_lesson_conflict`.
13. **`session.lecturerIds[]` מערך, ו-`lecturerId` הסקלרי חייב להיגזר מ-`lecturerIds[0]`** בכל code path — שבירת הקשר מפצלת את ה-UI מ-display surfaces שעדיין קוראים את הסקלר (LecturerPortal/PublicDisplay/buildLessonStudioBookings).
14. **`course_lecturers` jsonb מפורש — אסור לחזור לגזירת union** — מקביל ל-#10. ה-fallback קיים רק לשורות שנכתבו לפני המיגרציה.
15. **chip ב"מרצי הקורס" ≠ עמודה ב-grid** — עמודה נוספת **רק** בלחיצה על "הוסף עמודת מרצה". מכוון, והיפוך מהתנהגות הכיתות ב-#9 — אל ת"תקן".
16. **ייבוא XL של מרצים הוא column-based — אסור להחזיר lecturer ל-`importSessionMergeKey`** — שורות עם אותו `(date,start,end,topic)` חייבות להתמזג למפגש אחד עם `lecturerIds[]` מאוחד.
17. **כל `usage` חדש חייב `import` תואם באותו commit — `no-undef` הוא ERROR** — ייבוא חסר של `formatTime` הפיל 5 דפים בפרוד בזמן ריצה כש-lint עבר. כשעורכים imports במקביל בכמה קבצים — לאמת שכל עריכה הצליחה.
18. **אסור להציג `borrow_time`/`return_time`/`startTime`/`endTime` גולמי — הכל דרך `formatTime`** — הוא חותך שניות מה-DB (`09:30:00`→`09:30`). (בקרונים יש slice מקומי כי זה Node ולא ה-bundle.)
19. **`getEffectiveStatus` הוא מקור-האמת היחיד לסטטוס מוצג** — גוזר `מאושר`→`באיחור`/`פעילה`, מחריג שיעורים מ-`באיחור`. **אסור לחזור לגרסה שמחזירה רק `פעילה`**: PublicForm טוען שורות גולמיות ל-state המשותף ש-App מנרמל, ואי-הסכמה בין השניים גרמה לקפיצה פעילה↔באיחור.
20. **חפיפת אולפנים נחסמת ב-DB (`studio_bookings_no_overlap`), וכל בדיקת קליינט עוברת דרך `rangesOverlap`** — אסור gate של `!isNight` (גרם לקביעות לילה לדלג על הבדיקה) ואסור השוואת מחרוזות גולמית. **שיעור↔קביעה נשאר client-only** (שיעורים לא persisted). כל `CREATE OR REPLACE` של ה-constraint/`studio_booking_tsrange` — לשמר wrap-around לילה + ה-`WHERE`, ולדה-דפ לפני re-add.
21. **`normalizeEquipmentTagFlags` חייב לשטח את דגלי השאלת-החוץ ל-camelCase בשני העותקים** (App.jsx + utils.js) — אחרת `sync_equipment_from_json` (delete+reinsert + COALESCE) **מאפס אותם בשקט** בכתיבת-מערך-מלא הבאה. `EXTERNAL_LOAN_TYPES` בקליינט חייב להישאר מסונכרן עם `v_loan_type IN ('פרטית','הפקה')` ב-RPC.
22. **אישור בקשה הוא נקודת אכיפה שנייה לזמינות** — `update_reservation_status_v1` נועל `FOR UPDATE` ובודק מלאי במעבר לתוך `מאושר`, אחרת `approve_overbook`→409. **אסור להחיל את ה-guard על אישור-חוזר או על `באיחור`/`פעילה`→`מאושר`** (הם כבר מחזיקים מלאי). בנוסף: ReservationsPage **חייב** להריץ `saveEditedReservation(updated,{silent:true})` לפני `approveReservation` — האישור הוא status-only ובלעדיו עריכת פריטים נמחקת בשקט.
23. **`reservation_staff_assignments` היא טבלת-צד מנותקת — אסור להוסיף לה אכיפה או לגעת בה מ-RPC של הזמנות** — הפיצ'ר ניהולי בלבד. אין שיוך → אין תצוגה, אין חסימה, הסטטוסים זורמים כרגיל. כתיבה רק דרך 2 ה-actions ב-api/staff-schedule.js.
24. **`NavigationRoute` ב-sw.js חייב להישאר `NetworkFirst` — אסור cache-first** — cache-first על הקיוסק יצר death-spiral: index ישן→chunk 404→`registerSW` לא רץ→SW לא מתעדכן→מסך לבן קבוע. **`/daily-table` לא רושם SW בכלל** (unregister+purge, `NetworkOnly`). התיקון מונע הישנות אך לא משחרר מכשיר שכבר תקוע — שם צריך ניקוי cache ידני פעם אחת.
25. **זמינות ציוד = `workingUnits − MAX_concurrent`, אסור `SUM`** — שתי בקשות בחלונות **זרים** תופסות יחידה פיזית אחת, וסכימה ניפחה אותן ל-`זמין: 0` שגוי. בקשות ש**כן** חופפות עדיין חוסמות — הסימטריה מכוונת. helper יחיד `computeEquipmentAvailability`; כל `CREATE OR REPLACE` של שתי ה-RPC חייב לשמר `MAX(c)` ואת סמנטיקת `tstzrange '[)'`.
26. **ארכיון הפקות נגזר מ-`productions.archived_at` — אסור לחשב "הסתיימה" בקליינט** — מתוחזק אך ורק ע"י `productions_refresh_archive_v1`. ה-RPC חייב לשמר `Asia/Jerusalem` (לא `current_date`), gate ל-`status='published'`, `COALESCE(old_at,now())` (re-save לא מאפס חלון-חודש) ו-`IS DISTINCT FROM`. **ארכוב לא משנה `status`** — אחרת RLS ותצוגות נשברות והטריגר נורה. הרשומה לעולם לא נמחקת; חלון החודש של הסטודנט הוא view-filter בלבד.
27. **כל שאילתת `equipment` שמזינה state חייבת `select("*, units:equipment_units(*)")`** — בלי ה-join `eq.units=undefined`, ו-`ensureUnits` ממציא יחידות `תקין` ומוחק סטטוס אמיתי (פגום/בתיקון/נעלם "חזרו לתקין"). בנוסף: פאנל "משימות להיום" נטען app-level — **אסור fetch פר-mount** (הבהוב בכל ניווט), והצ'קבוקסים אופטימיים בלבד.
28. **ייצוא PDF = browser-print בלבד, אסור להכניס ספריית PDF** — jsPDF/pdfmake/html2canvas שוברות עברית בלי font-embedding+bidi שלא קיימים בריפו. המקור לרשימה חייב להיות אותו נגזר שהמסך מרנדר (`filtered`+`groupedCategories`), אחרת ה-PDF לא תואם לסינון. כל קלט-משתמש עובר `esc` לפני שרבוב ל-HTML.
29. **שיוך חדר בשיעור הוא פר-מפגש — אסור fallback לרמת-קורס כשלמפגש יש מערך `studioIds`** (גם ריק = "אין חדר"); fallback רק ל-legacy בלי מערך כלל. **אסור לארוז (drop-empties) את המערך ב-`getLessonScheduleEntries`** — האריזה מוחקת את האות "מערך מפורש" ומחזירה את ה-fallback, מה שייצר קביעות-רפאים. כל 7 בודקי החפיפה מדלגים על מפגשי עבר.
30+32. **מלכודת CSS: `overflow-x:auto` לבדו מקדם את `overflow-y` ל-`auto`** (המפרט לא מאפשר ציר אחד `visible` והשני `auto`) ומחזיר סרגל אנכי. גוף טבלת לוח השיעורים חייב `display:flex;flexDirection:column` **בלי שום `overflow`**; עטיפת טבלת הדסקטופ חייבת `overflowX:"auto",overflowY:"hidden"` מפורש, **בלי `maxHeight`**. בעורך הקורס: **`minWidth:0` על שני טורי ה-grid** (בלעדיו `min-width:auto` של grid item גורם לטבלה הרחבה לדחוף את הכרטיס לרוחב-יתר), ומודאל "רשימת תלמידים" (`position:fixed`) **חייב להישאר מחוץ ל-grid**, ה-`useEffect` שגוזר תעודה ממסלול חייב `if (!initial) return` (קורס חדש נשאר "ללא תעודה"), ומייל סיום-קורס מדולג לקורס בלי `certificateTemplateType`.
31. **`is_student`/`is_lecturer` הם דגלים נגזרים מהטבלאות החיות — אסור first-match** (זה השאיר מרצה+סטודנט עם דגל אחד). `is_admin`/`is_warehouse` אוטוריטטיביים ולא מנוקים אוטומטית. **מחיקת איש צוות = הסרת-תפקיד; אסור למחוק auth user של מייל שעדיין רשום כסטודנט/מרצה** (הבאג המקורי מחק סיסמה של סטודנט). **אסור להחזיר שדה `password` ל-create/invite** — הוא דרס סיסמה קיימת; onboarding אחיד דרך "שכחת סיסמה?".
33. **`submittedDateIds` ב-productionVisibility.js הוא מקור-האמת היחיד ל"טווח עם רשימה" — אסור לשכפל inline** (החליף 3 עותקים). **אסור להוריד את `LEGACY_PRODUCTION_CUTOFF_ISO`** — זה יגייס הפקות ישנות רטרואקטיבית ויעלים אותן מהלוח. **אסור לכתוב `status:'approved'` ישירות ב-INSERT של crew** — הטריגר לא יורה על INSERT וה-recheck הוא service_role-only, אז snapshot/cert-gate יישארו מיושנים; חייב לעבור דרך `production_approve_crew_v1`. הגשר לטופס נוחת `setStep(3)` וחייב לזרוע `borrow_date`/`return_date`, אחרת `availEq` ריק.
34. **צ'יפי קטגוריה נגזרים מאותו מאגר שהרשימה מרנדרת** — צ'יפ גלוי שמחזיר רשימה ריקה הוא באג. **סמנטיקת "כללי" קדושה**: פריט בלי תיוג (או עם `soundOnly` **וגם** `photoOnly`) מופיע בכל פילטר — **אסור בדיקת-דגל קשיחה**, היא הפכה 19 פריטים בפרוד לבלתי-נגישים. מאגר הצ'יפים = מאגר הסקשנים **פחות פילטר-הקטגוריה עצמו**, ובהחלפת סוג מאפסים את הבחירה. `EquipmentPage` מסנן ברמת-קטגוריה — **סמנטיקה שונה במכוון, לא לאחד**.
35+44. **הארכיון קורא ציוד דרך `archiveItems(r)` = `original_items ?? items`** — בהחזרה חלקית `reservation_items` מתרוקן, ולכן **גם סינון הארכיון חייב לרוץ נגד `archiveItems`** ולא נגד השורות החיות (אחרת חיפוש פורנזי מפספס בדיוק את מה שמחפשים). `original_items` נחתם **פעם אחת** ולעולם לא נדרס, ו-`saveEditedReservation` **חייב לשאת אותו ב-UPDATE** אחרת החותמת נמחקת בכל עריכה. **אסור שורות `reservation_items` עם כמות 0** — ה-`CHECK` נשאר ו-~25 מסכי רינדור היו נשברים. סמנטיקת הזמן בארכיון היא **חפיפת חלון-ההשאלה**, לא נקודת-זמן. פער ידוע: `restore_reservation_v1` לא משחזר את העמודה.
36. **מתיחת "באיחור" בלוחות היא גאומטריה בלבד, דרך `stretchOverdueForCalendar` בלבד** — מבוסס `getEffectiveStatus` ולא `r.status` הגולמי (פורטל מרצה דוחף שורות גולמיות ל-state). **המתיחה לא מגיעה לשום טקסט** — `overdue_since` נושא את התאריך האמיתי. שורה מתוחה היא אובייקט חדש בכל רינדור → **השוואות בחירה חייבות id**, לא זהות-אובייקט. **אסור להעביר רשימה מתוחה ל-`computeEquipmentAvailability`**.
37+41. **`activity_logs` אינו מקור זהות קביל** — `user_id`/`user_name` מגיעים מגוף הבקשה ולא מה-JWT (החלטה מודעת: גזירה מהטוקן תשנה שמות שכבר מוצגים). לכן `returned_by_*`/`approved_by_*` נגזרים **בשרת מה-JWT** ב-PATCH נפרד אחרי ה-RPC — **בלי לגעת ב-`update_reservation_status_v1`**. ה-PATCH מסונן `status=eq.הוחזר` ו**לא** מגויט על `changed`; כישלון = log + 200, לא שגיאה למשתמש; המיזוג האופטימי חייב `|| null` ולא `?? r.returned_by_name` (שימור ערך ישן מציג שקר); ה-whitelist ב-`updateReservationStatus` בולע כל שדה שלא נרשם בו. **השער האמיתי הוא ה-endpoint, לא סינון ב-UI**: `activity-log` דורש `requireStaff` על `write`/`delete`; ראש מחלקה נבדק גם על **סטטוס המקור** (אחרת יכול למשוך `מאושר` ל-`ממתין` ולשחרר מלאי חי) וגם על היקף `loan_types`; `reconcile=all` חי דורש cron secret ולא רק JWT.
38. **חוזה ה-ICS נקבע אמפירית מול Gmail — אל תשנה בלי בדיקה מקצה-לקצה מול תיבה אמיתית**: `METHOD:PUBLISH` ולא `REQUEST` (ריבוי UID אינו iTIP תקין), בלי `ORGANIZER`/`ATTENDEE`/`SEQUENCE`, **אסור `encoding:"base64"`** על חלק היומן (הוא מה שהפיל את הפרסור), ו-`LOCATION` = כתובת המכללה בלבד בגרשיים **עבריים** (שם חדר בקידומת הזיז את הפין; ASCII `"` עובר HTML-escape בצד גוגל). **שורות המצב נשמרות רק אחרי שליחה מוצלחת** (`if (ok)`) — אחרת מרצה נשאר מסונכרן-לכאורה ולנצח בלי מייל. מפגשים חוזרים מתאחדים ל-VEVENT אחד עם `RDATE` (מעל ~7 VEVENTs Gmail מפסיק לרנדר את הצ'יפ) — `RDATE` ולא `RRULE`, כדי לשמור שעון-קיר במעבר שעון. **`maxDuration=60` ב-vercel.json חובה** ושליחה **טורית** עם `SEND_GAP_MS` — לא `Promise.all` (Gmail חונק bursts); retry רק על רשת/5xx, **לעולם לא על 4xx**. `_key` מתחדש רק בהתנגשות אמיתית, אחרת נשלח מייל-שינויים שקרי.
39. **פיצ'ר שעובר על אוסף — לבדוק על גודל-פרוד, לא על גודל-dev** — ספירת השורות בשתי הסביבות היא חלק מהבדיקה. שני כשלים נפרדים באותו יום נבעו מזה: קרון טורי שנפל על timeout ב-166 קורסים (עבד על 52 ב-dev), וקובץ ICS שחצה את סף ה-VEVENTs של Gmail בקורס אמיתי בן 13 מפגשים.
40. **עדכון פריטים בבקשה קיימת: `add`/`increase` בלבד — `replace` הוסר במכוון** מכל השכבות. **`בדיקת עדכון` הוא display-state בלבד** (נגזר מ-`pending_update_id`) — **אסור להוסיפו למערך חוסמי-המלאי**. **אסור להזרים `reservation_pending_items` ל-`reservation_items` לפני אישור** — הישיבה בטבלה נפרדת היא כל ההגנה על המלאי (הם בלתי-נראים ל-CTEs). חלונות ההתראה חייבים להישאר מסונכרנים בין `loanPolicy.js` ל-`student_submit_reservation_update_v3`; ה-`_v1` מוענקות ל-`service_role` בלבד כדי שלא יעקפו את שער ה-lead-time. **`loanPolicy.js`, `reservationUpdateReview.js` ו-`announcementPolicy.js` חייבים להישאר חסרי-תלויות** — ה-API ב-Node מייבא אותם, וייבוא `src/utils.js` יגרור את קליינט Supabase ויפיל את ה-bundle.
42. **`useState` שנזרע מ-prop אסינכרוני + כפתור שמירה גלובלי = אובדן נתונים** — ה-initializer רץ פעם אחת, וקפא על placeholder ריק; "שמור הגדרות" כתב אותו על רשימות שלמות ב-DB. **אסור להחזיר `syncAllSiteSettings` לדף ההגדרות** (כל פאנל כותב רק את המפתחות שלו דרך `setSetting`), **ואסור להסיר את ה-`DATA-LOSS GUARD`** שממלא רק חוסרים ב-draft. שדות מספריים ב-`onBlur` ולא debounce (הקלדת "20" כתבה 2 ואז 20).
43. **קהל ההודעה נקבע בשרת מדגלי `public.users`, לא מ-`active_role`** שהקליינט שולט בו; שתי הטבלאות RLS-on בלי policy — `/api/announcement` הוא הדרך היחידה פנימה (ב-`site_settings` הודעה לצוות הייתה נוחתת בדפדפן של כל סטודנט). ה-PK `(announcement_id,user_id,seen_on)` עושה את כל עבודת ה"כמה פעמים", ו-`ON CONFLICT DO NOTHING` מונע מרענון לשרוף את המכסה. **הצפייה נרשמת ברגע ההצגה ולא בסגירה** — אחרת רענון מחזיר את ההודעה בלי סוף. גוף ההודעה מרונדר ב**רכיבי React ולא `dangerouslySetInnerHTML`** (טקסט אדמין, אבל מוצג לכל המכללה).
45. **נגן וידאו: פוסטר בדף, נגן במסך מלא — אסור לכפות `aspectRatio` סביב נגן שיש לו chrome משלו** — `iframe` חוצה-מקור אי אפשר למדוד ואי אפשר לעצב מבפנים, ולכן כל קבוע-ריפוד הוא ניחוש שנשבר ברוחב אחר (שניים נוסו ונכשלו). סרגל Drive הוא גובה **קבוע**, אז בתיבה נמוכה הוא בולע שליש והסרטון נחתך; **הרוחב קובע גם את גודל הפקדים**, אז תיבה רחבה פורסת אותם על כל המסך. במסך מלא ה-iframe מקבל את כל החלון בלי כפיית יחס והנגן מרפד בעצמו. **הכלל חל גם על תמונת הפוסטר ולא רק על הנגן**: `videoOrientation` מתאר את ה**סרטון**, בעוד שמה שמרונדר הוא **תמונה** — יוטיוב מגיש still רוחבי גם לסרטון אנכי, אז תיבה לפי הכיוון המוצהר החזירה את השטח המת. התיבה מתכווצת סביב התמונה ולא כופה עליה יחס. **תמונת יוטיוב חייבת להיות וריאנט 16:9** — `maxresdefault` (לא תמיד קיים) עם נפילה ל-`mqdefault` (קיים תמיד); **`hqdefault`/`sddefault` הם 4:3 עם פסים שחורים צרובים בקובץ** ואף פריסה לא תסיר אותם. `videoThumbnailSrcs` מחזירה רשימה מדורגת כי אי אפשר לדעת מראש אילו וריאנטים קיימים, ו-`onError` צועד בה. **מעדיפים YouTube "לא רשום" על Drive לסרטוני הדרכה** — נגן `/preview` של Drive לא מיישם auto-hide ואין דרך נתמכת להסתיר את פקדיו; המעבר הוא הדבקת קישור אחר בלבד.

> ⚠️ **השאלות-שיעור (`loan_type='שיעור'`) לעולם לא נסגרות אוטומטית** — `check-overdue.js` מדלג עליהן בתכנון, אז הן נשארות `מאושר` לתמיד. הן **לא חוסמות בקשות עתידיות** (תאריכי עבר לא חופפים לעתיד), אבל סריקת הקצאת-יתר "כל-הזמנים" עלולה להציג אותן כבעיה שאינה קיימת.

---

## 🛡️ Guardrails חיים

- **ESLint** ([eslint.config.js](eslint.config.js)) חוסם: `storageGet`, `storageSet`, `supabase.from('store'...)`, `from('store_snapshots'...)`, `/api/store`. רמה=ERROR.
- **`no-undef` = ERROR** ([eslint.config.js](eslint.config.js), מ-PR #42) — מזהה בשימוש בלי import/הגדרה = **שגיאת build, ה-CI נכשל**. נוסף אחרי שהשבית את הפרוד import חסר של `formatTime` (PR #40). **חוק: כל `usage` חדש חייב `import` תואם באותו commit — אחרת ה-build ייפול. אל תוסיף `formatTime(...)`/helper בלי לוודא שהוא מיובא בקובץ.**
- **CI workflow** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) — `Lint & build` רץ על כל PR/push. `DB smoke (dev project)` רץ אם `SUPABASE_DEV_URL`/`SUPABASE_DEV_SERVICE_ROLE_KEY` מוגדרים ב-GitHub secrets (כרגע לא — הוא מדלג נקי).
- **Global Error Boundary** ([src/components/ErrorBoundary.jsx](src/components/ErrorBoundary.jsx)) — Hebrew/RTL fallback עוטף את `<App/>` ב-StrictMode.
- **DB smoke** (`npm run test:db`, [scripts/run-db-smoke.mjs](scripts/run-db-smoke.mjs)) — 52 scenarios: `run_reservation_overlap_tests` (13) + `run_productions_regression_tests` (6) + `run_student_overlap_tests` (5) + `run_studio_overlap_tests` (6) + `run_availability_peak_tests` (3 — peak-concurrent, קורא ל-`create_reservation_v2` האמיתי, PR #63) + `run_reservation_update_tests` (16) + `run_reservation_update_v3_tests` (3 — עדכון פריטים, PR #85). מסרב לרוץ אם ה-hostname לא `mhvujejdlmtowypjdhjd`. status נוכחי: **52/52 PASS**.
- **Announcement-policy tests** (`npm run test:announce`, [scripts/run-announcement-tests.mjs](scripts/run-announcement-tests.mjs)) — 32 בדיקות על [src/utils/announcementPolicy.js](src/utils/announcementPolicy.js): 4 סוגי קהל × דגלי תפקיד (כולל מרובה-תפקידים ומשתמש חסר-דגלים), `display_days` 1 מול 2, "כבר נראתה היום", ומיצוי אחרי היום השני. **בלי רשת ובלי DB.** status נוכחי: **32/32 PASS**.
- **Loan-policy tests** (`npm run test:policy`, [scripts/run-loan-policy-tests.mjs](scripts/run-loan-policy-tests.mjs)) — 23 בדיקות על [src/utils/loanPolicy.js](src/utils/loanPolicy.js): חלונות ההתראה פר-סוג, גבולות מדויקים (24h/3h), גלגול שישי/שבת, ו-`computeUpdateDeadline`. **בלי רשת ובלי DB.** status נוכחי: **23/23 PASS**.
- **ICS smoke** (`npm run test:ics`, [scripts/run-ics-smoke.mjs](scripts/run-ics-smoke.mjs)) — 20 בדיקות על חוזה קובץ היומן, הקצב ושערי ה-endpoint (PR #81, הורחב ב-#89): `METHOD:PUBLISH` בלי `ORGANIZER`/`ATTENDEE`/`SEQUENCE`, UID לכל VEVENT, קיפול ≤75 אוקטטים, round-trip base64, `escParam`, `COLLEGE_ADDRESS` בגרשיים עבריים בלי ASCII `"`, `LOCATION` בלי שם חדר, איסור `encoding` מפורש על חלק היומן, `maxDuration ≥ 60`, שליחה מרווחת (לא `Promise.all` על מרצים), איחוד חזרות ל-`RDATE` ונכונות DST, הקרון dry-run בלבד, **שער ה-cron-secret על `reconcile=all` חי**, ו**דיווח כשל שמירת הסנאפ-שוט** (שתי האחרונות מ-PR #89). **בלי רשת ובלי DB.** status נוכחי: **20/20 PASS**. כל בדיקה כאן מקבעת כשל אמיתי שקרה — ראה לקח #38.

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

1. **dev לא מיושר ל-prod** — RLS כבוי על `users`/`equipment`/`equipment_units`/`reservations_new`/`reservation_items`/`staff_daily_tasks`, ויש FK ל-`staff_members`. לא קריטי: dev הוא sandbox.
2. **10 המיגרציות של PR #85 הוחלו על prod דרך ה-SQL Editor** ולכן **אינן רשומות בהיסטוריית המיגרציות של Supabase**. הסכימה מוחלת במלואה (אומתה + 19/19 טסטים על prod), אבל מי שמריץ אותן שוב או מקים סביבה חדשה מהקבצים צריך לדעת: רובן idempotent, אבל **`CREATE POLICY` ייכשל** על טבלה שכבר יש לה אותו. **מקור האמת נשאר קבצי המיגרציה ב-repo.**
3. **`run_*_tests` ניתנות להרצה ע"י `anon` בפרוד** — ראה הערה ב-🗄️ מבנה DB.
4. **`staff_members` legacy** — הקוד הפעיל לא משתמש בו כ-fallback. בפרוד 9 שורות בלי FK; ב-dev שורה אחת **עם** FK. למחוק אחרי וידוא שאין תלות היסטורית.
5. **App.jsx הוא הקובץ הגדול בריפו** — 8 דפים inline שטרם חולצו.
6. **`policy_assets` שומר PDF וטמפלטי XL כ-Base64 ב-TEXT** — כל קריאה מושכת blob שלם. tech debt.

---

## 🛠️ כלים זמינים

- **Supabase MCP** — `execute_sql`, `apply_migration`, `list_migrations`, `list_projects`, `get_advisors`.
- **Vercel MCP** — `list_projects`, `get_project`, `list_deployments`, `deploy_to_vercel`.
- **Git + GitHub CLI (`gh`)** — גישה מלאה ל-repo.
- **Context7 MCP** (`ctx7`) — docs של ספריות (דורש restart של Claude Code כשמתקינים).

---

## 📜 היסטוריית PRs

**שורה אחת ל-PR.** מה שהשתנה, ולאן ללכת לפרטים. הפירוט המלא של כל שינוי חי ב-PR
עצמו בגיטהאב, והכללים שנגזרו ממנו חיים ב-🎓 לקחים — כאן זה אינדקס בלבד.

| תאריך | PR | מה |
|---|---|---|
| 2026-07-25 | **#97** | גלאי כשל שליחת היומן היה מת; `seen` בהודעה ללא בדיקת קהל; נגן וידאו → פוסטר+מסך-מלא ב-4 משטחים (לקח #45); לחצן התנתקות קבור ב-Staff Hub; ניקוי CLAUDE.md |
| 2026-07-23 | **#95** | סינון זמן + פריטי ציוד בארכיון הבקשות (לקח #35+#44) |
| 2026-07-23 | **#93** | הודעה יומית חד-פעמית (`announcements`, מיגרציה `20260723120000`) + פירוק כפתור השמירה הגלובלי בהגדרות (לקחים #42, #43) |
| 2026-07-23 | **#92** | מצב עריכה כ-toggle בכרטיס הבקשה; הוסרו לחצני `+` והבורר נשאר מסלול ההוספה היחיד |
| 2026-07-23 | **#91** | 🚨 "הגדרות מערכת" יכול היה למחוק את סרטוני ההדרכה בשמירה (לקח #42) |
| 2026-07-23 | **#90** | לחצני כרטיס ההזמנה נחתכו בקצה המסך במובייל |
| 2026-07-23 | **#89** | הקשחת 3 endpoints: `activity-log` ללא אימות, ראש מחלקה ללא בדיקת סטטוס-מקור, כשל שמירת סנאפ-שוט ביומן (לקח #37+#41) |
| 2026-07-22 | **#88** | חותמת "מי אישר" (`approved_by_*`, מיגרציה `20260722170000`) + תיקון פילטר "סוג פעולה" ביומן הפעילות |
| 2026-07-22 | **#87** | הקשחת נתיב "הוחזר": timeout, retry עם `refreshSession` על 401/403, והודעות שגיאה ספציפיות |
| 2026-07-22 | **#85** | עדכון פריטי ציוד בבקשה קיימת (10 מיגרציות `20260722120000`→`20260722160000`, לקח #40) |
| 2026-07-20 | **#81** | מפגשי קורס ליומן המרצה דרך ICS במייל (`lesson_calendar_events`, לקח #38) |
| 2026-07-19 | **#80** | "איש צוות מטפל" בארכיון — `returned_by_*` נגזר-JWT (מיגרציה `20260719130000`, לקח #37) |
| 2026-07-19 | **#79** | מתיחת בר "באיחור" בכל לוחות השנה (לקח #36) |
| 2026-07-19 | **#78** | עריכת כמויות בבקשה "באיחור" + `original_items` (מיגרציה `20260719120000`, לקח #35) |
| 2026-07-15 | **#77** | סינון סוג ציוד מסנן גם את צ'יפי הקטגוריות (לקח #34) |
| 2026-07-14 | **#75** | לוח הפקות v2: חובת רשימת ציוד פר-טווח + הסרת מערכת אישור הצוות (לקח #33) |
| 2026-07-12 | **#74** | עורך קורס דו-טורי, ברירת-מחדל "ללא תעודה", horizontal-only scroll (לקח #30+#32) |
| 2026-07-12 | **#73** | ממשק מולטי-תפקיד + הוספת/הסרת איש צוות בטוחה (לקח #31) |
| 2026-07-07 | **#72** | לוח שיעורים בגובה אדפטיבי + הפרדת עבר/עתיד (לקח #30+#32) |
| 2026-07-07 | **#71** | התנגשות חדרים נגזרת פר-מפגש ולא מרמת-הקורס (לקח #29) |
| 2026-07-07 | **#69** | ייצוא PDF לרשימת הציוד המסוננת (לקח #28) |
| 2026-07-06 | **#68** | פאנל "משימות להיום" ב-Staff Hub + תיקון קריאת סטטוס יחידות ציוד (לקח #27) |
| 2026-07-05 | **#67** | ארכיון להפקות שהסתיימו (`archived_at` + cron יומי, לקח #26) |
| 2026-07-05 | **#66** | לחצני תפעול בראש מודאל הבקשה; קטגוריות ותמונות בערכה |
| 2026-07-05 | **#64–#65** | קביעות צוות ברובריקת "קביעות"; קישור דו-כיווני בדשבורד; תיקון `TIME_SLOTS` שנעצר ב-19:30 |
| 2026-07-01 | **#63** | זמינות ציוד לפי שיא-מקבילי במקום סכימה (לקח #25) + hotfix `/daily-table` בלי SW (לקח #24) |
| 2026-06-29 | **#61** | Service Worker network-first — מניעת מסך לבן בקיוסק (לקח #24) |
| 2026-06-29 | **#60** | "לא משויך" באדום בלוז העובדים; סידור פאנלים בעורך הקורס |
| 2026-06-28 | **#58** | שיוך איש צוות מטפל לבקשת השאלה — טבלת-צד מנותקת (לקח #23) |
| 2026-06-28 | **#57** | שיפורי פאנל ולוח שיבוץ עובדים: draft-buffer, נעילה, העדפות |
| 2026-06-25 | **#55** | guard אטומי נגד הקצאת-יתר באישור + שמירת עריכות לפני אישור (לקח #22) |
| 2026-06-23 | **#51–#54** | הגבלת השאלת-חוץ של ציוד: 2 עמודות על `equipment` + guard רביעי ב-RPC (לקח #21) |
| 2026-06-21 | **#48–#50** | guard אטומי נגד double-booking של אולפנים (`EXCLUDE constraint`, לקח #20) + עיצוב עורך הקורס |
| 2026-06-13 | **#47** | חסימת בקשות חופפות לאותו סטודנט + `getEffectiveStatus` גוזר "באיחור" (לקח #19) |
| 2026-06-13 | **#46** | crew snapshot מתיישן — רענון ב-`production_crew_change_recheck_v1` |
| 2026-06-04 | **#45** | crew snapshot נגזר ב-`create_reservation_v2` לכל הזמנת הפקה |
| 2026-05-31 | **#39–#44** | `formatTime` אחיד + 🚨 hotfix ייבוא חסר שהשבית את הפרוד + `no-undef`→ERROR (לקח #17, #18); מייל דדליין הפקה; deep-link ללוח הפקות |
| 2026-05-29 | **#26–#30** | הקמת רוטינת הסריקה היומית (`.claude/audit-routine.md` + `audit-log.md`) והסבב הראשון שלה |
| 2026-05-25 | **#20–#25** | N כיתות ו-N מרצים למפגש (`studioIds[]`/`lecturerIds[]` + עמודות jsonb ייעודיות), conflict resolver, ייבוא XL, toast aggregation, undo stack (לקחים #9–#16) |

> PRs מוקדמים מ-#20 מתועדים בסעיפים הנושאיים שלהם. הריפו הוא הארכיון.
