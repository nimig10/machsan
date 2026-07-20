# HANDOFF — סנכרון מפגשי קורס ליומן גוגל של המרצה (ICS)

> מסמך מעבר לשיחה חדשה. עודכן: 2026-07-20. קרא גם את **GOOGLE_CALENDAR_SYNC_PLAN.md** (התכנית המלאה) ואת **CLAUDE.md** (חוקי הפרויקט).

## 🎯 מטרה

בכל **יצירה/עריכה/מחיקה** של קורס, כל **מרצה משויך** מקבל אוטומטית את מפגשי הקורס כאירועים ביומן גוגל שלו, והיומן נשאר מסונכרן.

**החלטות שאושרו:** שיטה = **ICS במייל** (בלי Google Calendar API) · תזמון = **מחזור חיים מלא** · נמענים = **כל מרצי המפגש** (`session.lecturerIds[]`).

## 📍 מצב נוכחי (git / PR / DB)

- **ענף:** `claude/course-google-calendar-sync-fhkwoo` · **PR #81** → https://github.com/nimig10/machsan/pull/81
- **HEAD אחרון:** `9e4b67c` (fix: מייל אחד למרצה). כל העבודה committed + pushed.
- **מיגרציה הוחלה על dev בלבד** (`mhvujejdlmtowypjdhjd`) — הטבלה `lesson_calendar_events` קיימת ב-dev. **טרם הוחלה על prod** (`wxkyqgwwraojnbmyyfco`).
- **lint 0 errors · build נקי.**

## 🗂️ קבצים

| קובץ | תפקיד |
|------|-------|
| `supabase/migrations/20260720120000_create_lesson_calendar_events.sql` | טבלת מיפוי (RLS-on ללא policies, API-only) — `(lesson,session_key,lecturer)` → uid/sequence/last_hash/status + snapshot זמן (`event_date`/`start_time`/`end_time`/`summary`) ל-CANCEL אמין |
| `api/_ics.js` | בונה iCalendar ידני (בלי תלות npm). זמנים ב-UTC נגזרים מ-Asia/Jerusalem דרך `Intl` (DST בלי VTIMEZONE), folding+escaping. `buildIcs(events,{method})` |
| `api/calendar-sync.js` | ה-endpoint. reconcile מבוסס-DB. auth: `requireStaff` **או** `X-Cron-Secret`. `POST {lessonId}` / `GET ?force_test=<id>` / `GET ?reconcile=all` |
| `src/utils/calendarSyncApi.js` | `syncLessonCalendar(lessonId)` — טריגר fire-and-forget מהקליינט |
| `src/components/LessonsPage.jsx` | חיווט: אחרי `doSaveLesson` (יצירה/עריכה, ~שורה 740) ואחרי `del` (מחיקה, ~שורה 1135) |
| `GOOGLE_CALENDAR_SYNC_PLAN.md` | מסמך התכנון המלא |

**env — אפס חדשים:** `GMAIL_USER`/`GMAIL_PASS`/`CRON_SECRET`/`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.

## 🔑 עקרונות ליבה (אל תשבור)

1. **UID דטרמיניסטי:** `machsan-{lessonId}-{session._key}-{lecturerId}@camera.org.il`. `session._key` יציב ונשמר ב-`schedule` jsonb → UID שורד שינוי תאריך/שעה, כך עריכה = עדכון (SEQUENCE++) ולא כפילות.
2. **Reconcile מבוסס-DB:** ה-endpoint גוזר את המצב הרצוי מה-`lessons` החי (מנותק מנתיב השמירה). מחיקת קורס → אין מפגשים → CANCEL לכל השורות.
3. **עתידי בלבד ל-REQUEST:** נשלחות הזמנות רק ל-`date >= today` (Asia/Jerusalem). מפגשי-עבר קיימים **לא** מבוטלים כשעובר זמנם (מנוהל דרך `allKeys` מול `futureByKey`).
4. **מייל אחד למרצה** עם כל המפגשים (VCALENDAR מרובה-VEVENT) + רשימה בגוף המייל. CANCEL = מייל נפרד רק כשמוחקים.
5. **`last_hash`** = זיהוי שינוי אמיתי → שמירה חוזרת בלי שינוי לא שולחת כלום (idempotent).

## 🐞 הבעיה הפתוחה (המשימה המרכזית להמשך)

**תסמין:** בבדיקת המשתמש — עדכן תאריכי מפגשים, אבל האירועים ביומן גוגל **לא התעדכנו**.

**אבחון:** צד השרת **תקין** — טבלת המיפוי הראתה בדיוק את המפגשים הנכונים עם `sequence:1` (העדכון נשלח). גוגל פשוט **לא החיל** את עדכון ה-SEQUENCE (המשיך להציג את התאריך הישן של אותו UID). זו הנקודה הרגישה של iMIP/ICS מול Gmail.

**מה כבר נוסה:**
- ניסיתי **מייל-לכל-מפגש** (VEVENT יחיד למייל) → **המשתמש דחה** ("מסורבל, לא רוצה 4 מיילים למרצה"). **הוחזר למייל אחד.**
- לכן הפתרון של מייל-לכל-מפגש **מחוץ לשולחן**.

**היפותזות שטרם נשללו (להמשך):**
- (a) Gmail לא מחיל אמין עדכוני SEQUENCE על אירוע לא-מאושר → **אישור ההזמנה ("כן") ע"י המרצה** אמור לשפר.
- (b) **עיכוב התפשטות** — הצילומים נלקחו ~3 דק' אחרי השליחה; ייתכן שהעדכון נקלט מאוחר יותר.
- (c) **שאריות אירועים** מבדיקות קודמות ביומן (UIDs ישנים) שיוצרים בלבול.
- (d) מגבלת iMIP מובנית של Gmail מול שולח שאינו Workspace/Calendar-API.

**מצב איפוס לבדיקה נקייה:** מחקתי את שורות המיפוי של קורס הבדיקה ב-dev כדי להתחיל מאפס.

## 🧪 קורס הבדיקה (dev)

- lesson_id: `lesson_1784520057940`, שם: **"יום שמייח"**
- מרצה: id `lec_1783843528919_1`, מייל `nimig10+r1@gmail.com`
- מפגשים (2026): `sk-mrsp5lua-k9w5dr`=23/07 · `sk-mrsp5lua-na8ilf`=28/07 · `sk-mrsp5lua-grtlaz`=06/08 · `sk-mrsp5lua-7os2ni`=12/08 (כולם 10:00–13:00, חדר "סטודיו קטן")
- **שורות המיפוי נמחקו** — השמירה הבאה תיצור הזמנות טריות (seq 0).

## ▶️ צעדי המשך מומלצים

1. **בדיקה נקייה של יצירה:** מחק מהיומן את שאריות "יום שמייח" → שמור את הקורס מחדש → אמור להגיע **מייל אחד** עם 4 המפגשים, שנכנסים ל-23/07, 28/07, 06/08, 12/08. אשר את ההזמנה ("כן").
2. **בדיקת עדכון:** שנה שעת מפגש ושמור → בדוק אם האירוע זז/מתעדכן (מייל אחד).
3. **אם העדכון עדיין לא נתפס אמין** גם אחרי אישור → זו מגבלת iMIP. יש להחליט:
   - **Google Calendar API (OAuth)** — הדרך היחידה לסנכרון-מושלם/אפס-קליק. **לוגיקת הגזירה (`reconcileLesson`) + טבלת המיפוי נשמרות כמעט כמו-שהן**; מחליפים רק את שכבת השליחה (`sendIcs`) בקריאות `events.insert/update/delete` של Calendar API, ומאחסנים refresh token פר-מרצה. דורש פרויקט Google Cloud + מסך הסכמה + UX "חיבור יומן".
   - או להשלים עם "יצירה עובדת, עדכון best-effort + אישור" ולתעד למשתמש.

## 🔧 איך לבדוק/לתפעל

- **בדיקה ידנית של קורס בודד:** `GET /api/calendar-sync?force_test=<lessonId>` עם header `Authorization: Bearer <CRON_SECRET>` (מריץ reconcile, מחזיר `{requests, cancels, emailed}`).
- **בדיקת מצב DB (dev):** `SELECT * FROM lesson_calendar_events WHERE lesson_id='...'`.
- **כפיית resend:** `UPDATE lesson_calendar_events SET last_hash='reset' WHERE lesson_id='...'` → reconcile הבא שולח ב-seq גבוה יותר. (⚠️ אם היומן כבר במחק — עדיף DELETE של השורות + מחיקת אירועים ביומן, כי seq נמוך מ-UID קיים בגוגל = מתעלם.)
- **E2E דורש את הסביבה של Vercel** (הפונקציות ב-`api/` + creds של Gmail + dev DB). ה-**Preview של PR #81 מחובר ל-dev DB** — זו סביבת הבדיקה המעשית גם מהמחשב. `localhost:5174` (vite) טוב לשינויי קליינט, אבל `/api/*` לא רץ שם בלי `vercel dev`.

## ⚠️ זרימת עבודה בשיחה הבאה (מחשב)

- המשתמש יהיה על **מחשב** → חלה **הזרימה הישנה (localhost-first, Stage 1)** לשינויי קליינט. אבל **בדיקת ה-E2E של הפיצ'ר הזה היא על ה-Preview** (ראה למעלה).
- **מיגרציה ל-prod + merge עדיין ממתינים לאישור מפורש** של המשתמש אחרי שהפיצ'ר עובד תקין.
- כל `CREATE OR REPLACE`/שינוי schema = dev-first + אישור מפורש (CLAUDE.md).

## 🧷 קצוות ידועים (לא באגים קריטיים)

- נתיבי שמירה משניים (ייבוא XL ~1811, פותר קונפליקטים ~1010) **לא** דוחפים סנכרון — יסתנכרנו בעריכה הבאה או ב-`reconcile=all`.
- **Undo** של מחיקת קורס לא דוחף סנכרון-חוזר (האירועים כבר בוטלו) → יחזרו בעריכה הבאה או ב-`reconcile=all`.
- מפתח `_key` legacy מספרי-בלבד (`sk-123`) מתאפס ב-normalize → churn חד-פעמי (CANCEL ישן + REQUEST חדש). נדיר.
- `reconcile=all` **לא** רשום כ-cron ב-`vercel.json` בכוונה (הרצתו = backfill המוני לכל המרצים).
- כתובת המכללה + הערת קומה מקודדות כקבועים ב-`api/calendar-sync.js` (`COLLEGE_ADDRESS="רחוב ריבל 5, תל אביב"`, `COLLEGE_FLOOR_NOTE="בכניסה לבניין יורדים במדרגות לקומה מינוס 2"`). המיקום נכנס לשדה LOCATION (כפתור "מסלול" ביומן) + שם החדר לתיאור.
