# HANDOFF — PR #81: מפגשי קורס ליומן המרצה

> מסמך מעבר לשיחה חדשה. עודכן **2026-07-20**. קרא גם את **CLAUDE.md** (חוקי הפרויקט + סעיף "📅 מפגשי קורס ליומן המרצה" + לקח #38).
> **מחק את הקובץ הזה אחרי המיזוג** — מסמך מעבר שנשאר בריפו הופך למידע שגוי (בדיוק מה שקרה ל-HANDOFF הקודם).

---

## 🎯 מה הפיצ'ר עושה

1. **פתיחת קורס** → **מייל אחד** לכל מרצה עם קובץ יומן → לחיצה אחת על **"Add to Calendar"** פורסת את כל מפגשיו ביומן גוגל.
2. **שינוי אחר כך** (הזזה / הוספה / מחיקה / מחיקת קורס) → **מייל הודעה בשפה ברורה** עם לפני←אחרי, והמרצה **מעדכן ידנית**. **רק מפגש שנוסף** מגיע עם קובץ יומן.
3. **מחיקת קורס** → מייל ביטול לכל המפגשים.

**למה העדכון ידני:** Gmail לא מעדכן אירוע שנוסף דרך "Add to Calendar". ניסינו iMIP (`REQUEST` + `SEQUENCE`) — לא עובד. **החלטת בעל המוצר (2026-07-20).**

---

## 📍 מצב נוכחי

- **ענף:** `claude/course-google-calendar-sync-fhkwoo` · **PR #81** OPEN + MERGEABLE
- **HEAD:** `0736f65`. הכל committed + pushed.
- **בדיקות:** `lint` 0 שגיאות · `build` נקי · `npm run test:ics` **12/12** · `npm run test:db` **33/33**
- **dev:** שתי המיגרציות הוחלו · נקי משאריות זמניות
- **prod:** ❌ **לא נגעו** — המיגרציות לא הוחלו, ה-PR לא מוזג. `app.camera.org.il` לא השתנה.

---

## ✅ מה כבר נבדק ועובד (מול dev)

| תרחיש | תוצאה |
|---|---|
| יצירת קורס → הזמנה | `invites:1 · emailed:1` — "Add to Calendar" מוסיף את כל המפגשים |
| שמירה ללא שינוי | **אפס מיילים** (idempotent דרך `last_hash`) |
| הזזת מפגש | `changed:1 · notices:1` — לפני←אחרי, בלי ICS |
| הוספה + מחיקה יחד | `added:1 · removed:1` — ICS רק לחדש |
| מחיקת קורס | `removed:N · notices:1` — מייל ביטול, לא מדווח שוב |
| dry-run על 52 קורסים | 13 עם דריפט, **`emailed:0`** — לא שולח כלום |
| שם המרצה בפנייה | עובד גם למחיקת קורס (נופל לטבלת `lecturers`) |
| כתובת + Directions | הפין נוחת על המכללה |
| **פאנל התנגשויות** | ✅ **המשתמש אישר שעובד** |
| קורס עם 4 מרצים | **10.4 שניות** — עבר אחרי `maxDuration=60` |

---

## ⏭️ מה נשאר לעשות

### 1. בדיקה ידנית אחרונה — **ייבוא XL**
זה **השער היחיד שנסגר ולא נבדק דרך הממשק**. צור/ייבא גיליון עם כמה קורסים ווודא שכל מרצה מקבל מייל. שאר התרחישים נבדקו.

### 2. מיגרציות לפרוד — **דורש אישור מפורש של המשתמש**
פרויקט `wxkyqgwwraojnbmyyfco`, לפי הסדר:
1. `20260720120000_create_lesson_calendar_events.sql` — **מעולם לא הוחלה בפרוד**
2. `20260720140000_lesson_calendar_events_location.sql` — עמודת `location`

לוודא לפני: הטבלה אכן לא קיימת · `CRON_SECRET`/`GMAIL_USER`/`GMAIL_PASS` קיימים (**אפס env חדשים**).

### 3. מיזוג PR #81 ל-main
דרך merge-PR (main מוגן מ-push ישיר).

---

## ⚠️ הערות תפעוליות לפני עלייה לאוויר

**(1) המייל הראשון בפרוד הוא הזמנה מלאה.** 145 קורסים, 31 מרצים. הפעם הראשונה שקורס קיים נשמר אחרי המיזוג — המרצה מקבל הזמנה עם **כל מפגשיו העתידיים**. נכון, אבל מפתיע. **אין blast המוני** — הקרון היומי הוא dry-run בלבד.

**(2) עדכונים ידניים במכוון** — שווה ליידע את המרצים בהטמעה.

**(3) Google Calendar API נשאר פתוח להמשך.** נדחה כמסורבל, לא נפסל. אם יוחלט לעבור: הגזירה, טבלת המצב, `last_hash` וחישוב הדלתא **נשארים** — מוחלפת רק שכבת השליחה (`events.insert/patch/delete`), והעדכונים הופכים אוטומטיים. ה-API **חינמי** (1M/יום מול ~2,000 ב-backfill). המחיר: פרויקט ייעודי, מסך הסכמה, ואימות — `calendar.events` הוא **sensitive** ולא restricted → ימים-שבועות, ואפשר לעבוד לא-מאומת בינתיים (הטוקנים לא פגים ב-production, רק אזהרה למשתמש). מסלול **"Internal"** (בלי אימות) **לא זמין** — המרצים בג'ימייל פרטי, לא בדומיין Workspace.

---

## 🔑 חוקי ברזל של הפיצ'ר (לקח #38 — אל תשבור)

1. **`METHOD:PUBLISH`, לא `REQUEST`.** REQUEST עם כמה UID אינו iTIP תקין (RFC 5546); Gmail סירב לזהות הזמנה. ב-PUBLISH **אין** `ORGANIZER`/`ATTENDEE`/`SEQUENCE`.
2. **אסור `encoding:"base64"`** על חלק ה-`text/calendar`. הוא נוסה כ"תיקון" לעברית ו**הוא מה שהפיל** את הפרסור ל-`Unable to load event`. ברירת המחדל של nodemailer עובדת.
3. **`LOCATION` = כתובת המכללה בלבד, בגרשיים עבריים `״` (U+05F4).** שם חדר בקידומת מזיז את הפין (גוגל מגאוקדת מילה-במילה); ASCII `"` עובר HTML-escape בצד גוגל ל-`ריב&quot;ל`. שם החדר + הערת הקומה ב-`DESCRIPTION`.
4. **`if (ok)` לפני כתיבת המצב** — שורות נשמרות רק אחרי שליחה מוצלחת, אחרת כשל SMTP משאיר מרצה מסונכרן-לכאורה לנצח.
5. **שליחה טורית עם `SEND_GAP_MS`** — לא `Promise.all` על מרצים. Gmail חונק bursts.
6. **`maxDuration=60`** ב-`vercel.json` — קורס 4-מרצים = 10.4s, מעל ברירת המחדל.

`npm run test:ics` מקבע את כל אלה — 12 בדיקות, בלי רשת ובלי DB.

---

## 🗂️ קבצים

| קובץ | תפקיד |
|---|---|
| [api/calendar-sync.js](api/calendar-sync.js) | הליבה — גזירה, חישוב דלתא, שליחה, שמירה |
| [api/_ics.js](api/_ics.js) | `buildIcs(events,{method})` + `escParam` |
| [api/send-email.js](api/send-email.js) | 2 סוגים חדשים + צירוף ICS |
| [src/utils/calendarSyncApi.js](src/utils/calendarSyncApi.js) | `syncLessonCalendar` — מחזיר `{ok,reason}` |
| [src/components/LessonsPage.jsx](src/components/LessonsPage.jsx) | חיווט: save · delete · XL import · פאנל התנגשויות |
| [scripts/run-ics-smoke.mjs](scripts/run-ics-smoke.mjs) | `npm run test:ics` |
| `supabase/migrations/20260720120000` + `20260720140000` | טבלה + `location` |

---

## 🧪 איך לבדוק

**`/api/*` רץ ב-localhost** — `devApi()` ב-[vite.config.js](vite.config.js) מריץ handlers in-process עם cache-bust בכל בקשה (עריכה ב-`api/` נתפסת בלי restart). **אין צורך ב-Preview.**

```bash
npm run dev          # מתוך C:\machsan
# בדיקה ידנית של קורס:
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:5174/api/calendar-sync?force_test=<lessonId>"
# דריפט בלי לשלוח:
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:5174/api/calendar-sync?reconcile=all&dryrun=1"
```

**מייל בדיקה:** `nimig10@gmail.com` (ואפשר `+t1`, `+t2`… למרצים מרובים — הכל מגיע לאותה תיבה).

### ⚠️ מלכודות שעלו לנו זמן היום — תבדוק אותן ראשונות
1. **`strictPort:5174` נופל בשקט** אם תהליך node ישן תפוס. `Get-NetTCPConnection -LocalPort 5174 -State Listen`. `TaskStop` הורג את npm ולא את ה-node הבן.
2. **`.env.local` מתיישן** — `GMAIL_PASS` היה App Password ישן והכל נכשל ב-`535 BadCredentials`. השוואה מול Vercel: `vercel env pull`.
3. **הרשת כאן לא יציבה** — באמצע העבודה גם SMTP וגם GitHub נחסמו לכמה דקות וחזרו לבד. לפני שמחפשים באג, לבדוק קישוריות. (GitHub fallback: `ssh://git@ssh.github.com:443/nimig10/machsan.git`.)

---

## 📜 סדר האירועים (למי שתוהה למה זה לקח כל כך הרבה)

ה-PR המקורי נבנה סביב **הזמנות iMIP**. הוא לא עבד, ולא בגלל באג אחד אלא **שלוש שכבות שהסתירו זו את זו**:

1. `GMAIL_PASS` מיושן → `535` → `emailed:0`. תוקן — אבל **שרת רפאים על 5174** הסתיר את התיקון.
2. `METHOD:REQUEST` עם 4 UID שונים → Gmail נפל לזיהוי-חכם ("Add to Calendar" בלי RSVP), והאירועים שנוצרו היו **עותקים מנותקים** ששום `SEQUENCE` לא יכול לעדכן. → `PUBLISH`.
3. `encoding:"base64"` שנוסף כ"תיקון" → `Unable to load event`. → הוסר.

**הלקח המתודולוגי:** כמעט כל טעות אבחון היום נבעה מ**שינוי שני משתנים בבת אחת**. הבדיקה שסגרה את זה (`P2`) שינתה משתנה אחד. אם משהו לא עובד — בודקים משתנה אחד בכל פעם, ולא מניחים שהתיקון הקודם עבד.
