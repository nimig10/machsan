# תכנית: סנכרון מפגשי קורס ליומן גוגל של המרצה (ICS)

## Context — למה השינוי הזה

באפליקציה **"קמרה סאונד APP"** (מכללת קמרה אובסקורה וסאונד), כשנפתח/נערך קורס, המרצה לא מקבל את
מפגשי הקורס ליומן האישי — הוא מעתיק ידנית תאריכים/שעות מלוח השיעורים. המטרה: **בכל יצירה/עריכה/מחיקה
של קורס, כל מרצה משויך יקבל אוטומטית את המפגשים שהוא מלמד כאירועים ביומן גוגל**, והיומן יישאר מסונכרן.

**מצב הריפו (אומת מול הקוד החי):** HEAD = `c5f0393` (PR #80, 2026-07-19) — מסונכרן לקומיט האחרון,
תואם את הסנאפ-שוט ב-CLAUDE.md. ענף עבודה: `claude/course-google-calendar-sync-fhkwoo`, עץ נקי.

**שאלת ה-API — הוכרעה:** לא נדרש Google Calendar API. נשתמש ב**הזמנות ICS במייל** (VCALENDAR/VEVENT
עם `method:REQUEST`) דרך תשתית ה-Gmail SMTP + nodemailer הקיימת ([api/send-email.js](api/send-email.js)).
מכסה את כל המרצים (אין תלות בהסכמת OAuth), מתלבש 100% על הארכיטקטורה הקיימת, ניתן לשדרוג ל-Google API
בעתיד בלי לזרוק לוגיקה.

**החלטות שאושרו:** שיטה = ICS במייל · תזמון = מחזור חיים מלא (יצירה+עריכה+מחיקה) · נמענים = כל מרצי
המפגש (`session.lecturerIds[]`, לא רק מרצה ראשי).

---

## עקרון ליבה #1 — מזהה אירוע יציב

לכל מפגש יש מזהה יציב **`session._key`** (`sk-{base36}-{random}`, נוצר ב-
[LessonsPage.jsx:17](src/components/LessonsPage.jsx#L17), נשמר ב-`normalizeScheduleEntry`).
אומת שהוא **נשמר בתוך `schedule` jsonb** ב-`blobToRow` (ה-`...rest` שומר את `_key`,
[lessonsApi.js:197](src/utils/lessonsApi.js#L197)). מזה נגזר UID דטרמיניסטי:

```
UID = machsan-{lessonId}-{session._key}-{lecturerId}@camera.org.il
```

ה-UID **שורד שינוי תאריך/שעה** → עריכה = אותו UID עם `DTSTART` מעודכן + `SEQUENCE++` (עדכון, לא כפילות).
> ⚠️ קצה: מפתח legacy מספרי-בלבד (`sk-123`) מתאפס ב-normalize → churn חד-פעמי (CANCEL ישן + REQUEST חדש). נדיר, בלי backfill.

## עקרון ליבה #2 — Endpoint מבוסס reconcile (מנותק מנתיב השמירה)

יש **הרבה** נקודות שמירה (`syncAllLessons` ב-538/1010/1082/1135/1811 ב-LessonsPage), ומחיקת קורס
נעשית ע"י העברת מערך מצומצם ל-`syncAllLessons` (delete-missing). לכן ה-endpoint **לא** יקבל דלתא
מהקליינט אלא יגזור את **המצב הרצוי מה-DB** ויעשה reconcile מול טבלת מיפוי:
- מפגש קיים ב-DB שאין לו שורת-מיפוי / hash שונה → **REQUEST**.
- שורת-מיפוי שאין לה מפגש תואם ב-DB (מפגש נמחק / מרצה הוסר / הקורס נמחק) → **CANCEL**.
- זהה → דילוג (idempotent — re-save לא שולח כלום).

יתרון: מחיקת קורס מטופלת "בחינם" (אין מפגשים ב-DB → CANCEL לכל השורות), והקליינט רק צריך "לדחוף"
`lessonId` בלי לחשב דבר.

---

## ארכיטקטורה

### 1) גזירת אירועים (server-side)
הגזירה רצה בשרת (Gmail הוא server-side). service-role REST קורא: `lessons` (עמודת `schedule` jsonb —
`_key/date/startTime/endTime/topic/lecturerIds/studioIds` + `course_lecturers`/`lecturer_id`),
`lecturers` (id→email+name, אומת `email` ב-[lecturersApi.js:52](src/utils/lecturersApi.js#L52)),
`studios` (id→שם חדר). הלוגיקה משקפת את [`getLessonScheduleEntries`](src/utils/lessonBookings.js#L88)
+ [`getEffectiveLessonLecturerIds`](src/utils/lessonBookings.js#L79).

לכל טאפל **(מפגש × מרצה)** VEVENT: `UID`/`SEQUENCE` כנ"ל · `DTSTART`/`DTEND` עם `TZID=Asia/Jerusalem`
· `SUMMARY = {שם קורס} — {topic}` · `LOCATION = שמות החדרים` · `DESCRIPTION = מסלול+תיאור` ·
`ORGANIZER` = **`"מכללת קמרה אובסקורה וסאונד" <${GMAIL_USER}>`** (מחרוזת קיימת,
[send-email.js:433](api/send-email.js#L433)) · `ATTENDEE` = מייל המרצה.
**סינון עתידי:** מסנכרנים רק `date >= today` (עקבי עם לקחים #29/#71). מרצה ללא מייל → דילוג+לוג.

### 2) טבלת מיפוי/state
מיגרציה `supabase/migrations/{ts}_lesson_calendar_events.sql`:
```
lesson_calendar_events(
  id, lesson_id, session_key, lecturer_id, lecturer_email,
  uid text, sequence int default 0, last_hash text,
  status text default 'active',   -- active | cancelled
  created_at, updated_at,
  UNIQUE(lesson_id, session_key, lecturer_id))
```
RLS-on **ללא policies** (API-only דרך service-role, כמו `staff_personal_tasks`/`staff_hub_checkoffs`) +
`touch_updated_at`. **dev-first, prod רק אחרי אישור מפורש של המשתמש** (חוק ברזל).
`last_hash` = hash של תוכן ה-VEVENT (זיהוי שינוי אמיתי בלבד → מונע spam).

### 3) בניית ICS — hand-built (בלי dependency)
עקבי עם הקוד שבונה HTML ידנית. קובץ `api/_ics.js`: `buildIcs(events,{method})` — VCALENDAR עם
`METHOD:REQUEST|CANCEL`, **בלוק VTIMEZONE קבוע ל-Asia/Jerusalem** (מטפל ב-DST), CRLF, line-folding
75 אוקטטים, escaping (`,;\`+newline). METHOD יחיד ל-VCALENDAR → REQUEST ו-CANCEL בשני מיילים נפרדים.

### 4) שליחה — nodemailer `icalEvent`
מייל **אחד למרצה לכל ריצה**, כל מפגשיו כ-VEVENTs מרובים ב-VCALENDAR אחד:
`transporter.sendMail({ from, to, subject, icalEvent:{ method, content } })` (transporter קיים
[send-email.js:31](api/send-email.js#L31), `service:"gmail"`, `GMAIL_USER/PASS`). ריצה שולחת ≤2 מיילים
למרצה (REQUEST לחדשים/משתנים + CANCEL לנמחקים).

### 5) נקודות הפעלה
**`api/calendar-sync.js`** — auth: `requireStaff` (JWT) **או** `X-Cron-Secret` (דפוס
[api/staff-schedule.js](api/staff-schedule.js) + הקרונים). מקבל `{ lessonId }`, מריץ reconcile.
- **קליינט:** `src/utils/calendarSyncApi.js` חדש — `syncLessonCalendar(lessonId)` POST עם JWT,
  **fire-and-forget** (לא חוסם/שובר את `syncAllLessons`). קריאה אחרי
  [`doSaveLesson`](src/components/LessonsPage.jsx#L732) ובנתיב מחיקת הקורס (עם ה-lessonId שהוסר).
  toast עדין ("אירועי היומן נשלחו למרצים").
- **cron יומי (הקשחה, מומלץ):** רישום ב-[vercel.json](vercel.json) → `/api/calendar-sync?reconcile=all`
  שסורק את כל הקורסים ומתקן drift — רשת ביטחון לכל נתיב-שמירה שלא דחף (idempotent דרך ה-hash).
  להריץ בבאטצ'ים (אזהרת Promise.all flood).

**env — אפס חדשים:** `GMAIL_USER`/`GMAIL_PASS`/`CRON_SECRET`/`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.

---

## קבצים

**חדשים:** `supabase/migrations/{ts}_lesson_calendar_events.sql` · `api/_ics.js` ·
`api/calendar-sync.js` · `src/utils/calendarSyncApi.js`.
**שינוי:** [src/components/LessonsPage.jsx](src/components/LessonsPage.jsx) (חיווט אחרי save/delete) ·
[vercel.json](vercel.json) (cron reconcile).
**שימוש חוזר (בלי שינוי):** `getLessonScheduleEntries`/`getEffectiveLessonLecturerIds`
([lessonBookings.js](src/utils/lessonBookings.js)) כמראה ללוגיקת השרת · transporter+דפוסי auth
מ-send-email/staff-schedule · מחרוזת ה-`from` הקיימת.

---

## אימות (end-to-end) — dev-first, חוקי הברזל

> ⚠️ בתחילת היישום לשאול "נייד או מחשב?" (קובע זרימת עבודה). מיגרציה: dev תחילה; prod רק אחרי אישור
> מפורש של המשתמש שה-dev עובד. מייל בדיקה: `nimig10@gmail.com`.

1. **Stage 1 (localhost על dev DB):** להחיל מיגרציה ל-dev. ליצור קורס עם `nimig10@gmail.com` כמרצה +
   מפגשים עתידיים → לשמור → לוודא שהגיע מייל ICS ושהאירועים נכנסו ליומן גוגל.
2. **עריכה:** לשנות שעת מפגש → האירוע **מתעדכן** (לא כפול), `SEQUENCE` עלה.
3. **מחיקת מפגש:** להסיר מפגש → **ביטול** אירוע.
4. **מחיקת קורס:** למחוק קורס → ביטול כל האירועים.
5. **Idempotency:** שמירה חוזרת בלי שינוי → **לא** נשלח מייל.
6. **מרובה-מרצים:** מפגש עם 2 מרצים → כל אחד מקבל רק את המפגש שלו.
7. מצב בדיקה ידני: `GET /api/calendar-sync?force_test=<lessonId>` (gated ב-`CRON_SECRET`).
8. `npm run lint` + `npm run build` נקיים (`no-undef`=error — כל usage עם import תואם).
9. רק אחרי אישור Stage 1 של המשתמש → מיגרציה ל-prod → ואז merge.

---

## מחוץ להיקף שלב 1 (לעתיד)
- Google Calendar API (אפס-קליק) — שדרוג; לוגיקת הגזירה + טבלת המיפוי נשמרות.
