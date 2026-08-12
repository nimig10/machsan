# מסמך מעבר חשבון — אפליקציית "מחסן קמרה"

> **מסמך ההקשר היחיד לסשנים חדשים.** עדכני ל-**2026-08-12** (אחרי PR #114).
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
| מה השתנה ומתי | **בארכיון החיצוני** (`03-ציר-זמן/`) — לא בקובץ הזה |
| איך בודקים לפני merge | **זרימת העבודה** למטה + **🛡️ Guardrails חיים** |

> 🗄️ **ארכיון היסטורי חיצוני — שני מאגרים, אותו תוכן.**
>
> | | איפה | נגיש לסוכן בענן? |
> |---|---|---|
> | **ראשי** | Obsidian vault מקומי — `C:\Users\NIMROD\Documents\Obsldian\SOUND CAMERA APP` | ❌ **לא** — דיסק מקומי. סשן ענן לא רואה אותו |
> | **משני** | Google Drive — [ארכיון מידע והיסטוריה לאפליקציה](https://drive.google.com/drive/folders/1Wzue8s1KPTTGi84dGECg3bZcZmG_dZDv) (`1Wzue8s1KPTTGi84dGECg3bZcZmG_dZDv`) | ✅ **כן** — דרך ה-Drive connector |
>
> **המשני אינו גיבוי מת** (הוא היה "קפוא" בין 01/08 ל-09/08 — בוטל): הוא המאגר
> **היחיד שסוכן בענן מסוגל להגיע אליו**, ולכן הוא חייב להישאר מעודכן.
> מבנה זהה בשני המאגרים: `01-מפת-המערכת/` · `02-לקחים/` · `03-ציר-זמן/` ·
> `04-תקריות/` · `05-נהלים/` · `06-מסד-נתונים/` · `99-מקורות-גולמיים/`,
> ו-`00-התחלה-כאן.md` כאינדקס.
> מכיל: הסיפור המלא של **כל** הלקחים, אינדקס **כל** ה-PRs מ-#1, פוסט-מורטמים
> לתקריות, ניתוחי-עומק לתת-מערכות, ומדיניות השאלת-הציוד הרשמית.
> *(בכוונה בלי מספרים — הם התיישנו כאן פעמיים.)*
>
> ⚠️ **מגבלת כלים בדרייב: אפשר ליצור קובץ חדש, אי אפשר לערוך קיים.** ל-connector
> יש `create_file` ואין `update`. נוט חדש — כן; עדכון נוט קיים (למשל
> `00-התחלה-כאן.md`) — רק ידנית או מה-vault. **אל תיצור קובץ בשם שכבר קיים** —
> זה מייצר כפילות ולא מעדכן, וכפילות היא בדיוק המחלה שהארכיון בא לרפא.
>
> **📖 קריאה — לפי בקשה מפורשת בלבד.** לא אוטומטית, לא כברירת מחדל. אם התשובה
> כבר בקובץ הזה — אין סיבה לפנות לארכיון.
> **✍️ כתיבה — חובה שוטפת.** כל PR שמוזג, כל תקלה שמתגלה, כל שינוי ארכיטקטורה
> נכתבים לשם כחלק מהעבודה (Stage 4 למטה). הארכיון לא נטען אוטומטית — אבל הוא
> כן חייב להישאר מעודכן.

> 📏 **תקציב הקובץ: אין מספר קסם — צפיפות-מידע, לא גודל.** הקובץ נטען בכל סשן
> ומתחרה על תשומת-הלב של הסוכן, ולכן **המבחן של כל שורה הוא "האם זה
> כלל-חובה-לדעת-מראש, או נרטיב שאפשר לשלוף בזמן אמת?"** — לא ספירת-תווים.
> **מה שייך לכאן**: זרימת עבודה · ארכיטקטורה ולוגיקה עסקית · אנטי-רגרסיות.
> **מה שייך לארכיון** (🗄️ למעלה): היסטוריה, סיפורי-מקור, changelog, פוסט-מורטמים.
> פיצ'ר חדש **לא** מוסיף שורה לקובץ הזה. לקח חדש נוסף **רק אם משהו נשבר בפועל**,
> בפורמט כלל+נימוק בלבד — לא סיפור. **אל תשכפל**: אם זה כבר בלקח, הסעיף הנושאי
> מפנה אליו ולא חוזר עליו.
>
> *זוקק 2026-08-01: 91K → 78K. ההיסטוריה לא נמחקה — היא עברה לארכיון.*

## 🎯 רעיון האפליקציה

אפליקציית ניהול לבית ספר לקולנוע/סאונד בישראל ("קמרה"). מערכת בעברית עם RTL.
ניהול מחסן ציוד, אולפני הקלטה, מסלולי לימוד, תלמידים, מרצים, שיעורים, הסמכות.
טפסים ציבוריים להשאלת ציוד והזמנת אולפנים, פורטל מרצים, דשבורד אדמיניסטרציה, ולוח הפקות.

## 🏗️ מבנה טכני

### Frontend
- React + Vite (עברית, RTL).
- `src/App.jsx` — shell מרכזי (הקובץ הגדול ביותר בריפו). מכיל orchestration גלובלי (state, routing, realtime, auth bootstrap) + **8 דפים inline** שעוד לא חולצו.
- `src/components/LessonsPage.jsx` — הרכיב הגדול ביותר (עורך הקורס, לוח השיעורים, ייבוא XL, פאנל התנגשויות).
- `src/components/` — רכיבי הדפים.
- `src/utils/` — entity APIs + helpers (`jewishHolidays.js` · `lessonBookings.js` · `studioOverlap.js` · `productionVisibility.js` · `calendarSyncApi.js` · `loanPolicy.js` · `dateFormat.js` · `returnFlow.js` · `nightChecklist.js` · `studentPhone.js`).
- `src/components/DateField.jsx` — **שדה התאריך היחיד באפליקציה.** אסור `<input type="date">` חדש (לקח #50).
- `src/hooks/` — `useNotifications.js` · `useAutoGrowTextarea.js` (המדידה היחידה
  לתיבת טקסט אדפטיבית — ראה `.claude/skills/auto-grow-textarea`).

### Backend
- Vercel serverless functions ב-`api/` (Node 20 — `engines` ב-package.json ו-CI).
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

> ⚠️ **שני ה-DB נגישים דרך Supabase MCP — אבל רק פרוד מופיע ב-`list_projects`/`list_organizations`** (עניין *רישום*, לא *גישה*: `execute_sql`/`apply_migration` עם `project_id: "mhvujejdlmtowypjdhjd"` מפורש עובדים מצוין ל-dev). **אל תסיק מהיעדרו ב-list שאין חיבור.** תמיד לנקוב `project_id` מפורש (ראו גם כללים נוספים למטה).

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
4. **Stage 4 — תיעוד בארכיון (חובה, מ-2026-08-01)**: אחרי כל merge — לכתוב ל**שני מאגרי הארכיון** (ראה 🗄️ בראש הקובץ; בסשן ענן — ל-Drive). ראה "כתיבה לארכיון" למטה.

**אסור לדלג על שלב הבדיקה הידנית.** SQL smoke + `npm run test:db` הם בדיקות עזר — **לא תחליף** לבדיקה של המשתמש בדפדפן.

#### ✍️ כתיבה לארכיון — Stage 4 בפירוט

> **קריאה מהארכיון = לפי בקשה בלבד. כתיבה אליו = תמיד.** האסימטריה מכוונת:
> הארכיון לא אמור להעמיס על סשן עבודה, אבל הוא כן חייב להישאר מעודכן.

| מתי | לאן | מה |
|---|---|---|
| **כל PR שמוזג** | `03-ציר-זמן/<חודש>.md` | שורה: מספר PR · תאריך · כותרת אמיתית · קישור ללקח (אם נגזר) · מזהה מיגרציה (אם יש) |
| **PR שהוליד anti-regression** | `02-לקחים/` נוט חדש + שורה ב-`CLAUDE.md` | הכלל **המלא** בארכיון; ב-CLAUDE.md רק כלל+נימוק |
| **תקלת ייצור / באג שהתגלה** | `04-תקריות/` | מה קרה · השפעה · איך התגלה · תיקון. **גם אם עוד לא תוקן** — לתעד כפתוח |
| **שינוי ארכיטקטורה** (טבלה/RPC/תת-מערכת) | `01-מפת-המערכת/` או `06-מסד-נתונים/` | עדכון הנוט הקיים |

> 🔬 **הכלל שקובע את כל ערך הארכיון: מה שנכתב שם חייב להיות עמוק יותר ממה
> שכאן — אחרת אין לו סיבה להתקיים.** נוט שהוא תקציר של `CLAUDE.md` הוא נוט
> מיותר ומזיק (כפילות). מה שחייב להיכנס לנוט ו**אין לו מקום כאן**: הסיפור עם
> **נתונים אמיתיים** (שמות, תאריכים, מספרי PR/קומיט, מספרים מדודים) · שורש
> הבעיה · **מה נוסה ולא עבד** (זה מה שמונע מאיתנו לנסות שוב) · הקשר
> ארכיטקטוני רחב. **סדר גודל: 5–15KB לנוט, לא 500 בתים.**

- **יעד הכתיבה: שני המאגרים** (ראה 🗄️ בראש הקובץ). מי שיש לו גישה לשניהם כותב
  לשניהם; **סוכן בענן כותב ל-Drive** — זה מה שהוא מסוגל להגיע אליו, ובלעדיו
  Stage 4 פשוט לא קורה בסשן ענן. אין נוהל "רק המקומי" יותר.
- אין זמן/הקשר לנוט מלא? **שורה ב-`03-ציר-זמן/` היא המינימום** — עדיף מעט מכלום.
- הנוהל המלא (פורמט frontmatter, תגיות, חוזה הנוט): `05-נהלים/נוהל-עדכון-הארכיון`.

> 💻 **זרימת מחשב — חוק מרכוז ה-localhost** (נקבע 2026-07-23):
> כשעובדים במקביל על כמה PRs, **הענף שרץ על `localhost:5174` חייב להכיל את כל העבודה שטרם מוזגה** — המשתמש מרכז את כל הבדיקות למקום אחד ובודק הכל יחד לפני מיזוג.
> - **ענפים נפרדים ל-PR עדיין נכונים** — הפרדה נעשית ב-git, לא בסביבת הבדיקה. לערום את הענפים זה על זה (`git rebase <ענף-קודם>`) כך ש-localhost הוא **האיחוד** של כולם, ולפרק רק כשה-PRs עולים בפועל.
> - **אסור להחליף ענף באמצע סשן בלי להגיד מה ייעלם מהמסך.** מעבר לענף שיצא מ-main מוציא פיצ'רים שהמשתמש בודק כרגע (קרה בפועל, ובלבל את המשתמש). היגיינת ענפים לא שווה כלום אם היא עולה למשתמש בסביבת הבדיקה.
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

**`CREATE OR REPLACE FUNCTION` הוא שינוי schema** ודורש אישור מפורש של המשתמש לסשן הנוכחי (ראו גם "כללים נוספים" למטה — אישור תוכנית מראש ≠ אישור לרוץ על prod).

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
| תרגול לילה (מבחן + נעילה) | `night_quiz_attempts` + `night_quiz_answers` + `night_closing_checklists` | `api/night-training.js` + `nightTrainingApi.js` |

**טבלאות תומכות**: `users` (מראת auth — **המקור הפעיל להרשאות**), `activity_logs`,
`equipment_reports`, `auth_entity_map`, `auth_rate_limits`, `staff_members` (legacy,
ה-fallback הוסר), `staff_schedule_assignments`/`_preferences`, `staff_daily_tasks`,
`staff_personal_tasks`, `staff_hub_checkoffs`, `reservation_staff_assignments`.

> **RLS-on ללא policies, API-only**: `staff_schedule_*`, `staff_personal_tasks`,
> `staff_hub_checkoffs`, `lesson_calendar_events`, `announcements`(+`_views`),
> `night_quiz_attempts`/`night_quiz_answers`/`night_closing_checklists`.
> אין להם גישת-קליינט ישירה — רק דרך ה-endpoint שלהם.
>
> ⚠️ **לשלושת ה-`night_*` אסור לתת policy ל-`anon`/`authenticated` — לעולם.**
> `night_quiz_answers.correct_text` הוא **מפתח התשובות** של מבחן הלילה, ו-
> `night_quiz_attempts.seed`+`question_ids` מאפשרים לשחזר מבחן (ותשובותיו) לבד.
> policy "לנוחות" מבטלת בשקט את כל הסיבה שהניקוד עבר לשרת.

**עמודות שנוספו ל-`reservations_new`** — כולן **display-only**; אף guard/RPC/חישוב
זמינות לא קורא אותן, וכולן **בלי FK** במכוון כדי לשרוד מחיקת משתמש:
`production_id`+`production_date_id` (FK אופציונליים, SET NULL) ·
`original_items` jsonb (סנאפ-שוט מוקפא של מה שיצא — לקח #35+#44) ·
`return_outcomes` jsonb (סנאפ-שוט מוקפא של **החריגים** שנרשמו בהחזרה — לקח #48) ·
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
  `student_modify_reservation_item_v1` · `mark_overdue_email_sent` ·
  `save_edited_reservation_v1` (**היחידה שהיא `SECURITY INVOKER`** — היא קיימת
  לאטומיות ולא לסמכות, ולכן חייבת להישאר כפופה לאותו RLS; **אסור לחזור
  ל-UPDATE+DELETE+INSERT מהקליינט**, שהשאיר בקשה בלי ציוד כשהרשת נפלה באמצע.
  מפתח שחסר מ-`p_fields` משמר את העמודה — כך `original_items` לא נמחק, לקח #35+#44).
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

### סדרי גודל בפרוד

⚠️ **אל תסתמך על מספרים כתובים** — הסנאפ-שוט האחרון (05/2026) התיישן. פיצ'ר
שעובר על אוסף חייב להיבדק על **גודל-פרוד אמיתי** (לקח #39): `execute_sql` מול
`wxkyqgwwraojnbmyyfco`. סדרי גודל היסטוריים לייחוס — בארכיון.

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

> ⚠️ **Anti-regression**: זהו guard **per-student** ונפרד מ-guard ה-**per-equipment** (`status IN ('מאושר','באיחור','פעילה')`). כל `CREATE OR REPLACE` של `create_reservation_v2` חייב לכלול **את שלושתם**: per-student guard, equipment-availability, ו-crew-derive (PR #45). יש עכשיו טסט CI `run_student_overlap_tests` (5 תרחישים) ב-`npm run test:db`.

### השאלת צוות (`loan_type="צוות"`) ו-`באיחור` — מכוון, לא באג ✅
השאלת ציוד של איש צוות מתנהגת **כמו כל השאלה רגילה** לעניין איחור: כשעובר ה-`return_date` והסטטוס `מאושר` → עוברת ל-`באיחור` (וחוסמת מלאי בחלון 48h כמו כל באיחור). מי שכותב זאת ל-DB הוא ה-cron `api/check-overdue.js`, שפוטר **רק** `שיעור` — **לא** `צוות`. גם `normalizeReservationsForArchive` ב-`App.jsx` עושה זאת נכון. **אושר ע"י בעל המוצר (2026-05-30).**

- **קוד מת ידוע (רוטינת הסריקה: אל תדווח שוב)**: ל-`utils.js` עותק מקביל של `normalizeReservationsForArchive` עם guard ישן שמשאיר `מאושר` — **inert**, רץ רק על rows שכבר `מאושר`, לכל היותר הבהוב רגעי שמתקן את עצמו בפול הבא.

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
1. **`normalizeEquipmentTagFlags` ו-`EXTERNAL_LOAN_TYPES`↔RPC מסונכרן** — ראה לקח #21 לרקע המלא.
2. `UnitsModal.saveAll` clamp: `external_loan_hold_count` ל-`[0, units.length]`, וכש-`restrictAll` → `hold_count=0`. PR #52 הוסיף auto-sync דו-כיווני (N≥units.length→restrictAll; ביטול restrictAll→N=0).

---

## 🎬 לוח הפקות (Productions Board)

### זרימה
`StudentHub` → `ProductionsPage` (board=published) → `ProductionEditor` (כותרת,
תיאור 800 תווים, Drive URL, צבע, סוג כללית/kit, עד 7 ימי צילום, צוות —
**פוטוגרף+סאונד חייבים סטודנט רשום**).

- **צוות ללא אישורים** (PR #75): הבמאי מרכיב ישירות; שורות נכתבות `invited`
  ומאושרות אוטומטית בשמירה דרך `production_approve_crew_v1`
  (`autoApproveDirectorCrew`). מנגנון "בקש להצטרף"/inbox **הוסר לחלוטין**.
- **השאלת ציוד** — bridge ל-PublicForm עם `loan_type="הפקה"` + `production_id`;
  עם `dateId` נוחת **ישר בשלב הציוד** (`setStep(3)`) ממולא-מראש, ואם להפקה
  `kit_id` — נעול לפריטי הערכה. **חובת רשימה פר-טווח**: טווח מופיע בלוח רק
  אחרי הגשת רשימה (לקח #33).

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
5. **`production_delete_v1`** — ראה לקח #8 (hard-delete אטומי, נקרא ישירות מ-React; אסור endpoint עוקף).
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

`EXCLUDE constraint` **`studio_bookings_no_overlap`** (btree_gist, מיגרציה
`20260621120000`) חוסם פיזית ואטומית שתי קביעות **persisted** חופפות על אותו חדר.
ה-`WHERE` שלו: `lesson_auto=false AND status<>'נדחה' AND start/end NOT NULL`.
הפונקציה `studio_booking_tsrange` היא IMMUTABLE ובונה `tsrange` מ-TEXT עם
`make_timestamp` (לא `text::timestamp`, שהוא STABLE) כולל **wrap-around לילה**
(`end<=start → +1 יום`). שגיאת `23P01` ממופה ל-`error:"studio_overlap"` ב-
[studioBookingsApi.js](src/utils/studioBookingsApi.js) → toast עברית + revert אופטימי.

**מכוסה**: כל צירוף של קביעות persisted (student↔student, student↔team, team↔team),
יום ולילה. **לא מכוסה**: שיעור↔קביעה — שיעורים לא persisted ולכן ה-`EXCLUDE` לא רואה
אותם; החסימה שם בקליינט בלבד (פער מודע ומקובל — החלטת בעל המוצר).

> **פער פתוח (Layer B)**: נתיב הכתיבה של הצוות הוא עדיין `syncAllStudioBookings`
> מערך-מלא עם delete-missing — ה-constraint מונע כפילות אך **לא clobber**.

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

שרשרת הפונקציות (כולן ב-`LessonsPage.jsx`, `grep` לפי השם): מודאל מצב
(`upsert` / `create_only`) → `readImportRowsFromFile()` → `buildImportGroups()`
(ולידציה שורה-שורה; כשלים ל-`reportErrors`) → `runLessonImportRows()` (בדיקת
התנגשויות מרצה+חדר, צבירה ל-`baseLesson.schedule`).

- **קורס שכל מפגשיו נפסלו נופל לדוח** — לא נכנס חלקית.
- **retry**: עריכת שורה כושלת בדוח מריצה אותה שוב **באותו pipeline**
  (`runLessonImportRows([row],{retry:true})`); אם עברה — יוצאת מהדוח.

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

**העדכון ידני במכוון**: Gmail לא מעדכן אירוע שנוסף דרך "Add to Calendar", ולכן
מפגש שהוזז/בוטל **מתואר במילים** והמרצה מתקן בעצמו; מפגש **חדש** כן מקבל קובץ
(עוד לא ביומן → אין סיכון כפילות). כל מסלול ה-iMIP נוסה ונכשל — אל תנסה שוב.

⚠️ `rooms` על ה-entry הוא **תצוגה בלבד ואינו נכנס ל-hash** (הכיתה כבר בתוך
`description` שכן נכנס) — אחרת נשלחים מיילי-שינוי שקריים.

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
משתמש שהמייל שלו רשום בכמה תפקידים רואה בכל HUB את כל הממשקים שלו: `roleFlags` מועברים לכל שלוש הזהויות (`staff_user`/`lecturer_portal_user`/`public_student_roles`), ומעבר-תפקיד = `sessionStorage.active_role` + reload (מסך "מעביר…"). כרטיסי מעבר: StudentHub ("פורטל מרצה"/"ניהול מערכת"), LecturerPortal ("ניהול מערכת"/"מעבר לתצוגת סטודנט"), StaffHub ("מעבר לתצוגת סטודנט/מרצה") — כולם בצהוב `#f5a623`, מותני-דגלים בלבד. פירוט מלא (דגלים נגזרים, מחיקה בטוחה): לקח #31.

### קליינט auth — נקודות קריטיות שאסור לשבור
- **`lock`/listener fire-and-forget/Identity-confirmation modal** (`src/supabaseClient.js`) — anti-regressions מלאים בלקחים #2, #3, #4. אין לשכפל כאן.
- סיסמה מינ׳ 6 תווים. **Supabase setting חובה: "Prevent use of leaked passwords" = OFF.**

### API auth helper: `api/_auth-helper.js`
- `requireStaff` — staff לפי `public.users` בלבד (`is_admin`/`is_warehouse`). אין fallback ל-`staff_members`.
- `requireAdmin` — admin בלבד.
- `requireUser` — כל משתמש מאומת.
- `resolveUserRole` — `{role: "staff"|"user"|"anon"}` מ-`public.users`.

### Email
- **password-reset**: Gmail SMTP + nodemailer ב-`api/auth.js`. `buildResetEmail`.
- **כל שאר המיילים** (אישור בקשה `new`, איחור `overdue`, אישור אולפן, התראת ראש מחלקה, סיום קורס, ...) עוברים דרך [api/send-email.js](api/send-email.js) (Gmail SMTP, nodemailer). אנונימי מורשה רק `new`/`team_notify`/`dept_head_notify`; כל השאר דורש JWT או header `X-Cron-Secret`.

### קרונים ו-deep-links (הפירוט המלא בארכיון)
- **תזכורת דדליין הפקה** — [api/production-deadline-reminder.js](api/production-deadline-reminder.js),
  cron יומי 09:00 UTC ב-[vercel.json](vercel.json). דורש `CRON_SECRET` + `GMAIL_USER`/`GMAIL_PASS`.
- **`?app=productions`** — [PublicForm.jsx](src/components/PublicForm.jsx) קורא `?app=`
  ב-init של `studentApp` (`hub`/`forms`/`productions`). **אין routing אחר ללוח
  ההפקות** — הוא state פנימי, לא pathname.

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
- ללא `aggregateKey` — התנהגות זהה למה שהיה (backwards-compatible). עם המפתח —
  toast יחיד מתעדכן ל-"2 X נמחקו" → "3…"; ה-timer מתאפס בכל לחיצה, נעלם 3.5s
  אחרי האחרונה. 13 callsites קיימים (רשימה מלאה בארכיון).
- **קריטי**: סינכרוני לחלוטין בתוך `setToasts(prev => ...)` + `useRef` ל-Map של טיימרים. **אסור** להוסיף async/await בנתיב הזה — `aggregateKey` נוצר בדיוק כדי לא להאט את לחיצת הכפתור.

### שאר הדפוסים (מפרט מלא בארכיון)
- **Undo stack** — 15 פעולות; ה-state setter רץ **לפני** הרשת (אופטימי), ואז
  `Promise.all` במקביל.
- **ניתוק אוטומטי** — admin/staff אחרי **60 דקות** חוסר פעילות. מימוש ב-[App.jsx](src/App.jsx).
- **טמפלטי ייבוא XL** — אדמין מעלה ב"הגדרות מערכת"; אחסון ב-**מיחזור `policy_assets`**
  (אין טבלה/מיגרציה חדשה), `loadXlTemplate(slot)` ב-[src/utils/xlTemplatesApi.js](src/utils/xlTemplatesApi.js)
  עם fallback ל-constants `*_TEMPLATE_B64`.

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
9. **`session.studioIds[]` מערך — הכתיבה תמיד יוצאת כמערך**, לעולם לא כזוג `studioId`+`secondaryStudioId`. הזוג הישן נשאר **קריאה בלבד** לשורות legacy (עדיין חי ב-~10 קבצי-תצוגה — אל תסיר אותו, רק אל תכתוב אליו). מחרוזת ריקה ב-index `i` שומרת את העמודה במקומה (position-preserving).
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
30+32. **מלכודת CSS: `overflow-x:auto` לבדו מקדם את `overflow-y` ל-`auto`** (המפרט לא מאפשר ציר אחד `visible` והשני `auto`) ומחזיר סרגל אנכי. גוף טבלת לוח השיעורים חייב `display:flex;flexDirection:column` **בלי שום `overflow`**; עטיפת טבלת הדסקטופ חייבת `overflowX:"auto",overflowY:"hidden"` מפורש, **בלי `maxHeight`**. **`minWidth:0` חובה גם על טורי grid וגם על flex item** — בלעדיו `min-width:auto` מייצר גלישה (בעורך הקורס טבלה רחבה דוחפת את הכרטיס לרוחב-יתר; בפאנל הבקשה צ'יפ מייל LTR שאינו נשבר דוחף את **ה-X מחוץ לפאנל**). לכן תוכן LTR בתוך כותרת RTL חייב `maxWidth:"100%"` + ellipsis, ובכותרת יושב **רק** ה-X — לחצני פעולה עולים לראש גוף המודאל (תבנית `ReservationsPage`). בעורך הקורס בנוסף: מודאל "רשימת תלמידים" (`position:fixed`) **חייב להישאר מחוץ ל-grid**, ה-`useEffect` שגוזר תעודה ממסלול חייב `if (!initial) return` (קורס חדש נשאר "ללא תעודה"), ומייל סיום-קורס מדולג לקורס בלי `certificateTemplateType`.
31. **`is_student`/`is_lecturer` הם דגלים נגזרים מהטבלאות החיות — אסור first-match** (זה השאיר מרצה+סטודנט עם דגל אחד). `is_admin`/`is_warehouse` אוטוריטטיביים ולא מנוקים אוטומטית. **מחיקת איש צוות = הסרת-תפקיד; אסור למחוק auth user של מייל שעדיין רשום כסטודנט/מרצה** (הבאג המקורי מחק סיסמה של סטודנט). **אסור להחזיר שדה `password` ל-create/invite** — הוא דרס סיסמה קיימת; onboarding אחיד דרך "שכחת סיסמה?".
33. **`submittedDateIds` ב-productionVisibility.js הוא מקור-האמת היחיד ל"טווח עם רשימה" — אסור לשכפל inline** (החליף 3 עותקים). **שער הלוח אחיד לכל ההפקות; `LEGACY_PRODUCTION_CUTOFF_ISO` שורד רק כדי לתחום *מחיקה אוטומטית*** (`isRangeAutoPrunable`, לפי `created_at` של **הטווח**). הפטור הישן היה ברמת-ההפקה ולכן חל גם על טווח שנוסף שנה אחר כך — וטווח כזה לא קיבל **לא** לחצן ולא אזהרה (שניהם באותו `!isLegacy` בעורך), כלומר סטודנט בלי שום דרך להגיש. **אסור להחיל את המחיקה רטרואקטיבית**: הסתרה הפיכה, מחיקה לא, ו-`handleEditorClose` מוחק בלי דיאלוג אישור. **אסור לכתוב `status:'approved'` ישירות ב-INSERT של crew** — הטריגר לא יורה על INSERT וה-recheck הוא service_role-only, אז snapshot/cert-gate יישארו מיושנים; חייב לעבור דרך `production_approve_crew_v1`. הגשר לטופס נוחת `setStep(3)` וחייב לזרוע `borrow_date`/`return_date`, אחרת `availEq` ריק.
34. **צ'יפי קטגוריה נגזרים מאותו מאגר שהרשימה מרנדרת** — צ'יפ גלוי שמחזיר רשימה ריקה הוא באג. **סמנטיקת "כללי" קדושה**: פריט בלי תיוג (או עם `soundOnly` **וגם** `photoOnly`) מופיע בכל פילטר — **אסור בדיקת-דגל קשיחה**, היא הפכה 19 פריטים בפרוד לבלתי-נגישים. מאגר הצ'יפים = מאגר הסקשנים **פחות פילטר-הקטגוריה עצמו**, ובהחלפת סוג מאפסים את הבחירה. `EquipmentPage` מסנן ברמת-קטגוריה — **סמנטיקה שונה במכוון, לא לאחד**.
35+44. **הארכיון קורא ציוד דרך `archiveItems(r)` = `original_items ?? items`** — בהחזרה חלקית `reservation_items` מתרוקן, ולכן **גם סינון הארכיון חייב לרוץ נגד `archiveItems`** ולא נגד השורות החיות. `original_items` נחתם **פעם אחת** ולעולם לא נדרס, ו-`saveEditedReservation` **חייב לשאת אותו ב-UPDATE** אחרת החותמת נמחקת בכל עריכה. **אסור שורות `reservation_items` עם כמות 0** (ה-`CHECK` נשאר; ~25 מסכי רינדור נשברים). סמנטיקת הזמן בארכיון היא **חפיפת חלון-ההשאלה**, לא נקודת-זמן. פער ידוע: `restore_reservation_v1` לא משחזר את `original_items` — וכך גם `return_outcomes`/`returned_by_*`/`approved_by_*`; מחיקה מהארכיון ושחזור מאבדים את כל ארבעתן.
36. **מתיחת "באיחור" בלוחות היא גאומטריה בלבד, דרך `stretchOverdueForCalendar` בלבד** — מבוסס `getEffectiveStatus` ולא `r.status` הגולמי (פורטל מרצה דוחף שורות גולמיות ל-state). **המתיחה לא מגיעה לשום טקסט** — `overdue_since` נושא את התאריך האמיתי. שורה מתוחה היא אובייקט חדש בכל רינדור → **השוואות בחירה חייבות id**, לא זהות-אובייקט. **אסור להעביר רשימה מתוחה ל-`computeEquipmentAvailability`**.
37+41. **`activity_logs` אינו מקור זהות קביל** — `user_id`/`user_name` מגיעים מגוף הבקשה ולא מה-JWT (החלטה מודעת). לכן `returned_by_*`/`approved_by_*` נגזרים **בשרת מה-JWT** ב-PATCH נפרד אחרי ה-RPC — **בלי לגעת ב-`update_reservation_status_v1`**. ה-PATCH מסונן `status=eq.הוחזר` ו**לא** מגויט על `changed`; כישלון = log + 200, לא שגיאה למשתמש; המיזוג האופטימי חייב `|| null` ולא `?? r.returned_by_name` (שימור ערך ישן מציג שקר); ה-whitelist ב-`updateReservationStatus` בולע כל שדה שלא נרשם בו. **השער האמיתי הוא ה-endpoint, לא סינון ב-UI**: `activity-log` דורש `requireStaff` על `write`/`delete`; ראש מחלקה נבדק גם על **סטטוס המקור** (אחרת מושך `מאושר`→`ממתין` ומשחרר מלאי חי) וגם על היקף `loan_types`; `reconcile=all` חי דורש cron secret ולא רק JWT.
38. **חוזה ה-ICS נקבע אמפירית מול Gmail — אל תשנה בלי בדיקה מקצה-לקצה מול תיבה אמיתית**: `METHOD:PUBLISH` ולא `REQUEST`, בלי `ORGANIZER`/`ATTENDEE`/`SEQUENCE`, **אסור `encoding:"base64"`** על חלק היומן (הפיל את הפרסור), ו-`LOCATION` = כתובת המכללה בלבד בגרשיים **עבריים** (ASCII `"` עובר HTML-escape בצד גוגל; שם חדר בקידומת מזיז את הפין). **שורות המצב נשמרות רק אחרי שליחה מוצלחת** (`if (ok)`) — אחרת מרצה נשאר מסונכרן-לכאורה לנצח בלי מייל. מפגשים חוזרים מתאחדים ל-VEVENT אחד עם **`RDATE` ולא `RRULE`** (מעל ~7 VEVENTs Gmail מפסיק לרנדר את הצ'יפ; RDATE שומר שעון-קיר במעבר שעון). **`maxDuration=60` ב-vercel.json חובה**, שליחה **טורית** עם `SEND_GAP_MS` ולא `Promise.all` (Gmail חונק bursts), retry רק על רשת/5xx **לעולם לא על 4xx**. `_key` מתחדש רק בהתנגשות אמיתית.
39. **פיצ'ר שעובר על אוסף — לבדוק על גודל-פרוד, לא על גודל-dev** — ספירת השורות בשתי הסביבות היא חלק מהבדיקה. שני כשלים נפרדים באותו יום נבעו מזה: קרון טורי שנפל על timeout ב-166 קורסים (עבד על 52 ב-dev), וקובץ ICS שחצה את סף ה-VEVENTs של Gmail בקורס אמיתי בן 13 מפגשים.
40. **עדכון פריטים בבקשה קיימת: `add`/`increase` בלבד — `replace` הוסר במכוון** מכל השכבות. **`בדיקת עדכון` הוא display-state בלבד** (נגזר מ-`pending_update_id`) — **אסור להוסיפו למערך חוסמי-המלאי**. **אסור להזרים `reservation_pending_items` ל-`reservation_items` לפני אישור** — הישיבה בטבלה נפרדת היא כל ההגנה על המלאי (בלתי-נראים ל-CTEs). חלונות ההתראה מסונכרנים בין `loanPolicy.js` ל-`student_submit_reservation_update_v3`; ה-`_v1` ל-`service_role` בלבד כדי שלא יעקפו את שער ה-lead-time. **`loanPolicy.js`, `reservationUpdateReview.js` ו-`announcementPolicy.js` חייבים להישאר חסרי-תלויות** — ה-API ב-Node מייבא אותם, וייבוא `src/utils.js` יגרור את קליינט Supabase ויפיל את ה-bundle.
42. **`useState` שנזרע מ-prop אסינכרוני + כפתור שמירה גלובלי = אובדן נתונים** — ה-initializer רץ פעם אחת, וקפא על placeholder ריק; "שמור הגדרות" כתב אותו על רשימות שלמות ב-DB. **אסור להחזיר `syncAllSiteSettings` לדף ההגדרות** (כל פאנל כותב רק את המפתחות שלו דרך `setSetting`), **ואסור להסיר את ה-`DATA-LOSS GUARD`** שממלא רק חוסרים ב-draft. שדות מספריים ב-`onBlur` ולא debounce (הקלדת "20" כתבה 2 ואז 20).
43. **קהל ההודעה נקבע בשרת מדגלי `public.users`, לא מ-`active_role`** שהקליינט שולט בו; שתי הטבלאות RLS-on בלי policy — `/api/announcement` הוא הדרך היחידה פנימה (ב-`site_settings` הודעה לצוות הייתה נוחתת בדפדפן של כל סטודנט). ה-PK `(announcement_id,user_id,seen_on)` עושה את כל עבודת ה"כמה פעמים", ו-`ON CONFLICT DO NOTHING` מונע מרענון לשרוף את המכסה. **הצפייה נרשמת ברגע ההצגה ולא בסגירה** — אחרת רענון מחזיר את ההודעה בלי סוף. גוף ההודעה מרונדר ב**רכיבי React ולא `dangerouslySetInnerHTML`** (טקסט אדמין, אבל מוצג לכל המכללה).
45. **נגן וידאו: פוסטר בדף, נגן במסך מלא** — **אסור לכפות `aspectRatio`/ריפוד-קבוע סביב `iframe` חוצה-מקור** (לא ניתן למדידה מבחוץ; שני קבועים נוסו ונכשלו). במסך מלא ה-iframe מקבל את כל החלון בלי כפיית יחס והנגן מרפד בעצמו. פוסטר ב-**`contain` ולא `cover`** + `onError`. **מעדיפים YouTube "לא רשום" על Drive** — לנגן `/preview` של Drive אין auto-hide ואין דרך נתמכת להסתיר את פקדיו. **הפוסטר של יוטיוב משקר על הצורה**: `hqdefault` הוא **תמיד** 480×360 עם פסים צרובים בפיקסלים; `oardefault` נותן יחס אמיתי אך קיים רק לצורה לא-סטנדרטית, ובהיעדרו חוזר **placeholder אפור 120×90 עם HTTP 200 — לא 404**. לכן שרשרת הפוסטרים חייבת **שומר סף גודל** ולא רק `onError`.

46. **שדה שנפתח לעריכה ב-`ProductionEditor` חייב להיבדק מול `handleEditorClose`** — המסלול הזה שומר **רק** כשיש טווחי תאריכים לגזום, ואחרת קורא ל-`onClose()` בלי לכתוב כלום. שחרור "סוג ההפקה" מהנעילה בלי לטפל בזה יצר **אובדן נתונים שקט**: הסטודנט שינה ל"כללית", סגר, והשינוי נזרק — בעוד `forcedKit`/`prodKit` ב-PublicForm המשיכו להגביל לערכה הישנה. שתי ההגבלות עצמן תקינות ונגזרות **חיות** מ-`productions[].kitId`, ולכן מספיק לשמור ולרענן; אין להן סנאפ-שוט לתקן.

47. **"בטל פעולה" כותב **רק** את הבקשות שהפעולה עצמה נגעה בהן (`resIds` על ה-snapshot)** — ה-diff הישן זיהה שורות לפי **נוכחות** בלבד, ולכן שינוי-במקום (סטטוס) נפל בין הכיסאות ולא נכתב מעולם; ומכיוון שהמערך היה ריק, `[].every()===true` דיווח **הצלחה על אפס עבודה**. וכשמוסיפים כתיבת-סטטוס — היא **חייבת** להיות מוגבלת ל-scope: ה-realtime משתמש ב-`_setReservations` הגולמי ולכן **לא דוחף snapshot**, כך שביטול היה דורס שינוי חי של אדמין אחר. `scope===null` ⇒ לא נכתב סטטוס כלל (ביטול חלקי ניתן לתיקון, דריסת עמית לא). ההשוואה דרך `getEffectiveStatus` ולא `r.status` (לקח #19) — היא שבולעת את רעש הנרמול `מאושר`→`באיחור`. **409 מה-guard של לקח #22 הוא תשובה נכונה** (הציוד יצא בינתיים), לא תקלה.

48. **`return_outcomes` הוא סנאפ-שוט מוקפא של החריגים בלבד, ו-NULL הוא המצב התקין** — `פגום`/`נעלם` נשמרים, `תקין` **לעולם לא**; החזרה נקייה משאירה NULL, וזה מה שמאפשר לכל שורה שקדמה לפיצ'ר להתרנדר בדיוק כמו קודם. **אסור לגזור אותו מ-`equipment_units`** — סטטוס יחידה זז לגיטימית `פגום`→`בתיקון`→`תקין` ב"ציוד בדיקה", וגזירה חיה הייתה משכתבת היסטוריה. **אסור להוסיפו ל-`SET` של `save_edited_reservation_v1`** — הוא שורד עריכות דווקא בזכות היעדרותו משם (היפוך מ-`original_items`). הכתיבה היא PATCH ב-service_role **לפני** ה-RPC, עם `&return_outcomes=is.null` שהופך אותה לחד-פעמית ב-URL; כישלון **מבטל** את ההחזרה במקום להשלים אותה (`stage:"outcomes"`). **מספרי היחידות אינדיקטיביים ולא פורנזיים** — `reservation_items.unit_id` לא נכתב אף פעם, ולכן אסור לצבור מהם סטטיסטיקה, ו**חובה** להשאיר את הערת ההסתייגות במודאל.

49. **מרענן טוקן אחד בלבד, וה-`lock` הוא שרשור-promise** — Supabase מסובב refresh token בכל שימוש עם חלון חסד של **10 שניות בלבד**, ומעבר לו reuse-detection **מבטל את הטוקן וצאצאיו**. לכן שני מרעננים לא-מסונכרנים לא "עושים עבודה כפולה" אלא **הורסים את הסשן** (`Invalid Refresh Token`) וכל קריאה הופכת ל-403 אנונימי. `autoRefreshToken` כבר מתקתק כל 30ש׳ ומרענן ב-90ש׳ לפקיעה — **אסור להוסיף `setInterval` שקורא ל-`refreshSession`** (היה כזה, כל 4 דקות, עם הערה שהוא "מונע פקיעה"; הוא גרם לה). **אסור לכבות `autoRefreshToken`** — זה מחליף ניתוק אקראי בניתוק ודאי. ה-`lock` **חייב להישאר שרשור-promise ולא `navigator.locks`** (לקח #2) ו**חייב** `.then(fn, fn)` — ארגומנט יחיד תוקע את התור לנצח אחרי כישלון אחד. במובייל זה היה שכיח במיוחד: טיימרים קפואים ברקע יורים **יחד** בחזרה לאפליקציה.

50. **תאריכים עוברים דרך `DateField` — אסור `<input type="date">` חדש** (חריג יחיד: ה-input המוסתר שהרכיב עצמו פותח בו את הבורר הטבעי, וה-`LessonDateInput` המקומי ב-LessonsPage שקדם לו). **הפורמט של השדה הטבעי נקבע ע"י שפת הדפדפן ואינו ניתן לשליטה מהדף** — `lang`/`dir`/CSS מתעלמים ממנו; משתמש עם דפדפן באנגלית ראה `10/18/2026` בשדה בזמן שההודעה מעליו אמרה `18/08/2026`, על טופס שבו חודש שגוי = אין ציוד ביום הצילום. **הוולידציה חייבת לרוץ ב-commit (blur/Enter) ולא בכל הקלדה** — שדה מבוקר שדוחה ערך בלי לקרוא ל-setter מחזיר את ה-DOM לערך הישן, ולכן הקלדת שנה ספרה-ספרה (`0002`→`0020`→`0202`) נמחקה בכל תו והשדה היה בלתי-ניתן להקלדה (זהה בשורשו ללקח #42). **המסכה מפרמטת רק בהוספה בסוף** (`maskWhileTyping`; `maskDateInput` הגולמי אסור ב-`onChange`) — בנייה-מחדש-מהספרות באמצע המחרוזת הרסנית: `18/08/2026` עם היום מסומן + הקלדת `1` הפכה ל-`10/82/026`, וכל שכתוב כזה גם מקפיץ את הסמן לסוף השדה, כך שאי אפשר לתקן ספרה בודדת. עריכה באמצע/מחיקה/הדבקה עוברות byte-for-byte, ואין מה לאבד — `heToIso` מקבל גם `18092026`, ו-blur מפרמט מחדש. **שנה דו-ספרתית נדחית ולא מנוחשת**, ו**ערך חלקי לעולם לא נחשב תאריך** — שם נולדות הזמנות בתאריך שגוי. `dateFormat.js` נשאר חסר-תלויות ובלי `new Date()` (חישוב שנה מעוברת הוא אריתמטיקה; `Date` כבר נשך כאן סביב DST של Asia/Jerusalem).

> ⚠️ **השאלות-שיעור (`loan_type='שיעור'`) לעולם לא נסגרות אוטומטית** — `check-overdue.js` מדלג עליהן בתכנון, אז הן נשארות `מאושר` לתמיד. הן **לא חוסמות בקשות עתידיות** (תאריכי עבר לא חופפים לעתיד), אבל סריקת הקצאת-יתר "כל-הזמנים" עלולה להציג אותן כבעיה שאינה קיימת.

---

## 🛡️ Guardrails חיים

- **ESLint** ([eslint.config.js](eslint.config.js)) חוסם: `storageGet`, `storageSet`, `supabase.from('store'...)`, `from('store_snapshots'...)`, `/api/store`. רמה=ERROR.
- **`no-undef` = ERROR** ([eslint.config.js](eslint.config.js), מ-PR #42) — מזהה בשימוש בלי import/הגדרה = **שגיאת build, ה-CI נכשל**. רקע והכלל המלא: לקח #17.
- **`react-hooks/rules-of-hooks` = ERROR** (אותו קובץ) — hook בתוך תנאי/לולאה משנה את סדר ה-hooks וגורם לקריסה. גם זה מפיל build.
- **CI workflow** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) — `Lint & build` רץ על כל PR/push. `DB smoke (dev project)` רץ אם `SUPABASE_DEV_URL`/`SUPABASE_DEV_SERVICE_ROLE_KEY` מוגדרים ב-GitHub secrets (כרגע לא — הוא מדלג נקי).
- **Global Error Boundary** ([src/components/ErrorBoundary.jsx](src/components/ErrorBoundary.jsx)) — Hebrew/RTL fallback עוטף את `<App/>` ב-StrictMode.
- **DB smoke** (`npm run test:db`, [scripts/run-db-smoke.mjs](scripts/run-db-smoke.mjs)) — 52 scenarios: `run_reservation_overlap_tests` (13) + `run_productions_regression_tests` (6) + `run_student_overlap_tests` (5) + `run_studio_overlap_tests` (6) + `run_availability_peak_tests` (3 — peak-concurrent, קורא ל-`create_reservation_v2` האמיתי, PR #63) + `run_reservation_update_tests` (16) + `run_reservation_update_v3_tests` (3 — עדכון פריטים, PR #85). מסרב לרוץ אם ה-hostname לא `mhvujejdlmtowypjdhjd`. status נוכחי: **52/52 PASS**.
- **Auth-guard tests** (`npm run test:auth`, [scripts/run-auth-guard-tests.mjs](scripts/run-auth-guard-tests.mjs)) — 12 בדיקות שמקבעות את **שני** צדי לקח #49: שאין טיימר שמריץ `refreshSession` ב-[src/App.jsx](src/App.jsx), ש-`autoRefreshToken`/`persistSession` נשארים דלוקים (ה"תיקון" הנאיבי הוא לכבות אותם), שה-`lock` הוא **שרשור-promise ולא `navigator.locks`** (לקח #2), ושהוא מסתעף `.then(fn, fn)` — ארגומנט יחיד היה תוקע את התור לנצח אחרי כישלון אחד. ברובן **בדיקות סטטיות של הקוד** כי `supabaseClient.js` קורא ל-`createClient` ב-module scope ולא ניתן לייבוא תחת Node; מה שצריך קיבוע הוא צורת-הקוד, כי הבאג היה שורה סבירה-למראה שמישהו יתפתה להחזיר. הבדיקות משמיטות הערות לפני הסריקה — אחרת התיעוד שמסביר מה אסור מפיל את הגארד של עצמו. **בלי רשת ובלי DB.** status נוכחי: **12/12 PASS**.
- **Date-format tests** (`npm run test:dates`, [scripts/run-date-format-tests.mjs](scripts/run-date-format-tests.mjs)) — 54 בדיקות על [src/utils/dateFormat.js](src/utils/dateFormat.js), הלוגיקה שמאחורי [DateField](src/components/DateField.jsx). המרכזית: **כל תחילית של "18/10/2026" מתפרשת ל-`null`** — פרסר שמקבל ערך חלקי הוא בדיוק איך שהקלדה חצי-גמורה הופכת להזמנה בתאריך שגוי. בנוסף: שנה דו-ספרתית נדחית ולא מנוחשת · `31/02` ו-`29/02` בשנה לא-מעוברת נדחים ולא מתגלגלים · כלל 400 השנים · המסכה לא כופה `/` נגרר (זה נלחם ב-backspace) · **11 בדיקות על עריכה באמצע השדה** — `maskWhileTyping` מפרמט רק בהוספה בסוף (לקח #50) · והמודול נשאר חסר-תלויות ובלי `new Date()`. **בלי רשת ובלי DB.** status נוכחי: **54/54 PASS**.
- **Student-phone tests** (`npm run test:phone`, [scripts/run-student-phone-tests.mjs](scripts/run-student-phone-tests.mjs)) — 39 בדיקות על [src/utils/studentPhone.js](src/utils/studentPhone.js). המודול חולץ **אחרי שהלוגיקה נשברה פעמיים ביומיים**, ושתי השבירות מקובעות כאן: `pickSubmissionPhone` שם את **`directorPhone` לפני `form.phone` בהפקה בלבד** (בהפקה אין שדה טלפון בשלב 1, ולכן `form.phone` שם הוא תמיד מילוי-אוטומטי), ו-`mayOverwriteRosterPhone` מחזיר `false` לכל ערך שלא הוקלד — **ערך שמולא אוטומטית אינו קלט משתמש ואסור לו לדרוס נתון קיים**. בנוסף סריקה סטטית ש-`api/create-reservation.js` **שומר את הפילטר `or=(phone.is.null,phone.eq.)` ללא תנאי ואינו מקבל `phoneTyped` מגוף הבקשה** — ה-endpoint אנונימי, ודריסה חייבת לעבור ב-`record-student-phone` המאומת-JWT שגוזר זהות מהטוקן. **בלי רשת ובלי DB.** status נוכחי: **39/39 PASS**.
- **Production-visibility tests** (`npm run test:prodvis`, [scripts/run-production-visibility-tests.mjs](scripts/run-production-visibility-tests.mjs)) — 22 בדיקות על [src/utils/productionVisibility.js](src/utils/productionVisibility.js). מקבעות ששער הלוח **אחיד** (`boardVisibleDates` מתעלמת מ-`createdAt` של ההפקה, כולל הפקה בלי חותמת), ובעיקר את **גארד אובדן-הנתונים**: `isRangeAutoPrunable` מחזיר `false` לחותמת חסרה/ריקה/לפני החתך — כי `handleEditorClose` **מוחק** את מה שהוא מחזיר עליו `true`, בלי דיאלוג אישור. יש גם סריקה סטטית ש-`isLegacyProduction` לא חזר לאף קובץ תחת `src/`. **בלי רשת ובלי DB.** status נוכחי: **22/22 PASS**.
- **Announcement-policy tests** (`npm run test:announce`, [scripts/run-announcement-tests.mjs](scripts/run-announcement-tests.mjs)) — 32 בדיקות על [src/utils/announcementPolicy.js](src/utils/announcementPolicy.js): 4 סוגי קהל × דגלי תפקיד (כולל מרובה-תפקידים ומשתמש חסר-דגלים), `display_days` 1 מול 2, "כבר נראתה היום", ומיצוי אחרי היום השני. **בלי רשת ובלי DB.** status נוכחי: **32/32 PASS**.
- **Loan-policy tests** (`npm run test:policy`, [scripts/run-loan-policy-tests.mjs](scripts/run-loan-policy-tests.mjs)) — 27 בדיקות על [src/utils/loanPolicy.js](src/utils/loanPolicy.js): חלונות ההתראה פר-סוג, גבולות מדויקים (24h/3h), גלגול שישי/שבת, ו-`computeUpdateDeadline`. 4 מהן **סורקות את `ProductionEditor.jsx` סטטית** ומוודאות שהניסוח למשתמש תואם ל-`loanMinDays("הפקה")` ומופיע במקום אחד בלבד — שם הכלל תוקן פעם והמחרוזות נשארו שבורות (ראה אנטי-רגרסיה 2 בלוח ההפקות). **בלי רשת ובלי DB.** status נוכחי: **27/27 PASS**.
- **Return-flow tests** (`npm run test:return`, [scripts/run-return-flow-tests.mjs](scripts/run-return-flow-tests.mjs)) — 78 בדיקות על [src/utils/returnFlow.js](src/utils/returnFlow.js), הלוגיקה של מסך החזרת הציוד. זו הזרימה השוטפת **היחידה שכותבת למלאי**, ולכן מקובע בעיקר מה שהורס: `applyUnitOutcomes` מחזיר את **מערך הציוד המלא** (מערך חלקי מוחק את היחידות של כל פריט שהושמט — לקח #21), לא מוסיף/מוריד יחידות, ולא נוגע ביחידה שלא נכללה ב-outcomes. בנוסף: `pickUnitsForReturn` בוחר `תקין` בלבד, דטרמיניסטית ומיון מספרי (#10 אחרי #9), לעולם לא יותר מהכמות המושאלת ולעולם לא ממציא יחידה; `fault` נשמר רק על `פגום`; והמודול נשאר חסר-תלויות. **44 מהן על סנאפ-שוט הארכיון** (לקח #48), והחשובה בהן היא ש-`readReturnOutcomes` מחזיר `null` לכל שורה שקדמה לפיצ'ר — המסלול של כל הארכיון בפרוד. **בלי רשת ובלי DB.** status נוכחי: **78/78 PASS**.
- **Night-training tests** (`npm run test:night`, [scripts/run-night-quiz-tests.mjs](scripts/run-night-quiz-tests.mjs)) — 67 בדיקות על [api/_night-quiz.js](api/_night-quiz.js) ו-[src/utils/nightChecklist.js](src/utils/nightChecklist.js). מקבעות שלושה דברים שקל לשבור בשקט: (1) **מפתח התשובות לא עוזב את השרת** — סריקה עמוקה של `buildAttemptView().public` ושל `toStudentResult()` לכל שדה תשובה, ובדיקה **סטטית** שאף קובץ תחת `src/` לא מייבא את הבנק (זו ההוכחה שהתשובות לא נכנסות ל-bundle); (2) **מעבר = 100% בלבד** — 14/15 נכשל; (3) **אותו seed מייצר את אותו מבחן** — השרת שומר רק `(seed, question_ids)` ומשחזר את המבחן כדי לנקד, אז הגרלה לא-דטרמיניסטית הייתה מנקדת סטודנטים לא נכון. בנוסף: תקינות הבנק (32 שאלות, 17 mc + 15 tf), פיזור אחיד של התשובה הנכונה בין 4 המיקומים (תופס באג Fisher-Yates קלאסי), עמידות ניקוד לקלט זבל, ו-26 פריטי הצ'ק ליסט ללא HTML גולמי. **בלי רשת ובלי DB.** status נוכחי: **67/67 PASS**.
- **ICS smoke** (`npm run test:ics`, [scripts/run-ics-smoke.mjs](scripts/run-ics-smoke.mjs)) — 20 בדיקות על חוזה קובץ היומן, הקצב ושערי ה-endpoint (PR #81, הורחב ב-#89): `METHOD:PUBLISH` בלי `ORGANIZER`/`ATTENDEE`/`SEQUENCE`, UID לכל VEVENT, קיפול ≤75 אוקטטים, round-trip base64, `escParam`, `COLLEGE_ADDRESS` בגרשיים עבריים בלי ASCII `"`, `LOCATION` בלי שם חדר, איסור `encoding` מפורש על חלק היומן, `maxDuration ≥ 60`, שליחה מרווחת (לא `Promise.all` על מרצים), איחוד חזרות ל-`RDATE` ונכונות DST, הקרון dry-run בלבד, **שער ה-cron-secret על `reconcile=all` חי**, ו**דיווח כשל שמירת הסנאפ-שוט** (שתי האחרונות מ-PR #89). **בלי רשת ובלי DB.** status נוכחי: **20/20 PASS**. כל בדיקה כאן מקבעת כשל אמיתי שקרה — ראה לקח #38.

---

## 🤖 רוטינת סריקה יומית אוטומטית

סוכן ענן אוטונומי (הוקם PR #26–#30) רץ יומית ב-09:00 שעון ישראל, סורק **hot files
בלבד** ([src/App.jsx](src/App.jsx), [src/components/LessonsPage.jsx](src/components/LessonsPage.jsx),
[src/utils.js](src/utils.js), `supabase/migrations/**`), מתקן אוטומטית **רק** תיקונים
בטוחים (null-guards, cleanup, dead code) ומצטבר ל-**PR מתגלגל יחיד** על `claude/daily-audit`.
כל היתר → checklist ב-PR. קוראת את CLAUDE.md בתחילת כל ריצה כדי לכבד את ה-anti-regressions.

**החוזה המלא** (היקף, פרוצדורה, פורמט PR ולוג) — [.claude/audit-routine.md](.claude/audit-routine.md);
הלוג המתמשך — [.claude/audit-log.md](.claude/audit-log.md). **קונפיגורציית הטריגר בענן**
(שם, מודל, connectors, איך משהים/עורכים) חיה בארכיון, לא כאן.

### חוקי ברזל (תקציר — המלא ב-audit-routine.md)
- ⛔ **code-only**: אסור לגעת ב-DB/schema/RPC/migration (לא dev ולא prod). בעיות DB → checklist בלבד.
- ⛔ אסור למזג — **המיזוג הוא של המשתמש בלבד**, אחרי בדיקה ידנית ב-Preview.
- ⛔ אסור לדחוף ל-`main`; רק לענף `claude/daily-audit`.
- 🔂 **מקסימום push אחד ביום** = build אחד ב-Vercel. אימות (`lint`+`build`) מקומי בלבד; אסור לדחוף "כדי לבדוק".
- 🤫 **יום ללא ממצאים → אפס push** (דילוג שקט — זה התרחיש הנפוץ).
- 🧪 כל PR חייב לכלול מקטע **"מדריך בדיקה ידנית"** בשפת משתמש (חובה מ-PR #30).

---

## 🔥 נקודות חולשה / סיכון

1. **dev לא מיושר ל-prod** — RLS כבוי על `users`/`equipment`/`equipment_units`/`reservations_new`/`reservation_items`/`staff_daily_tasks`, ויש FK ל-`staff_members`. לא קריטי: dev הוא sandbox.
2. **10 המיגרציות של PR #85 אינן רשומות בהיסטוריית המיגרציות של Supabase** (הוחלו דרך ה-SQL Editor). הסכימה מוחלת במלואה ואומתה, אבל בהקמת סביבה חדשה מהקבצים: רובן idempotent — **`CREATE POLICY` ייכשל** על טבלה שכבר יש לה אותו. מקור האמת = קבצי המיגרציה בריפו.
3. **`staff_members` legacy** — הקוד הפעיל לא משתמש בו כ-fallback. בפרוד 9 שורות בלי FK. למחוק אחרי וידוא שאין תלות היסטורית.
4. **`policy_assets` שומר PDF וטמפלטי XL כ-Base64 ב-TEXT** — כל קריאה מושכת blob שלם. tech debt.

---

## 📜 היסטוריית PRs — בארכיון, לא כאן

**כל ה-PRs מ-#1 ועד #114** (כולל ~40 שמעולם לא נכנסו לקובץ הזה) מתועדים חודש-חודש
ב-`03-ציר-זמן/` שבארכיון החיצוני — כותרת אמיתית, תאריך, וקישור ללקח שנגזר.
כאן **לא** נשמר אינדקס: הכלל שנגזר מכל PR כבר חי ב-🎓 לקחים למעלה, וזה מה שמחייב.

> "מתי נכנס הפיצ'ר הזה ולמה?" → שאלת-ארכיון (🗄️ בראש הקובץ).
> "מה אסור לשבור?" → כאן, לא שם.
