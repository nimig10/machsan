# HANDOFF — הרובריקה כמקור האמת לשם הסטודנט

> ⚠️ **הקובץ הזה נמחק לפני ה-merge.** הוא קיים רק על הענף
> `feat/roster-name-source-of-truth`, בדיוק כמו ה-HANDOFF שקדמו לו
> (הוסרו ב-`16ff076` וב-PR #118).
> נכתב 2026-08-20. הסמכות לתוכן היא **גוף ה-PR** ו-`CLAUDE.md`, לא הקובץ הזה.

## איפה הדברים עומדים

| | מצב |
|---|---|
| קוד | ✅ נדחף — 5 קומיטים על `feat/roster-name-source-of-truth` |
| `npm run test:identity` (חדש) | ✅ **100/100** |
| 10 החבילות הקיימות | ✅ ירוקות — checkout 196 · return 85 · night 67 · dates 54 · phone 39 · announce 32 · policy 27 · prodvis 22 · ics 20 · auth 12 |
| `lint` · `build` | ✅ 0 errors (217 warnings — זהה ל-baseline) · עובר |
| `npm run test:db` מול **dev** | ✅ **52/52** |
| שינויי DB / מיגרציות | ➖ **אין. אף מיגרציה, אף RPC.** רק קוד |
| Backfill **dev** | ✅ dry-run החזיר **0 שורות** — dev נקי, אין מה לתקן |
| Backfill **prod** (31 שורות) | ⛔ **לא רץ** — מחכה לאישור מפורש אחרי הבדיקה הידנית |
| **בדיקה ידנית בדפדפן** | ⛔ **לא נעשתה** — זה מה שנשאר |
| תיעוד `CLAUDE.md` + ארכיון | ⛔ **לא נעשה** — Stage 4, אחרי המיזוג |

---

## מה הבאג היה, בשורה אחת

שדות "שם פרטי"/"שם משפחה" בטופס ההשאלה היו **input חופשי**, הערך שרד בטיוטת
`sessionStorage`, ובורר סוג-ההשאלה **לא איפס אותו** — ולכן שם שהוקלד בטופס
"קולנוע יומית" **דלף** להשאלת הפקה, שבה הכרטיס רק *נראה* קריאה-בלבד אבל רינדר את
אותו `form.student_first_name`. משם הוא נצרב ל-`reservations_new.student_name`.

**האבחנה שהפריכה את ההשערה המקורית**: יולי יחזקאלי **מעולם לא שינתה שם ב"הגדרות
חשבון"** — `students.name`, `users.full_name` ומטא-דאטת ה-auth כולם עדיין
"יולי יחזקאלי". בכל ה-DB יש **שורה אחת** עם "פורת": ההזמנה.

**זו לא תקלה חד-פעמית — 31 שורות בפרוד, 3 סטודנטים:**

| ברובריקה | נצרב בהזמנות | שורות |
|---|---|---|
| נימרוד גרא | נמרוד גרא | 29 |
| אופק ירימי | אופק ירמי | 1 |
| יולי יחזקאלי | יולי פורת | 1 |

**והנזק תפקודי, לא קוסמטי**: חיפוש הצוות מסנן על `student_name`; שער ההסמכות
מתאים צוות הפקה להסמכות **לפי שם מנורמל**; ו-`api/check-overdue.js` קורא את השם
מה-DB למייל האיחור **ולגוף ההתראה לנייד**. האחרון הוא הסיבה שהתיקון בנתונים ולא
בתצוגה — שכבת "פתירה חיה" בקליינט לא יכולה להגיע לקרון.

---

## מה צריך כדי להמשיך במחשב אחר

```bash
git fetch origin
git checkout feat/roster-name-source-of-truth
npm install
npm run dev          # http://localhost:5174
```

**הדבר היחיד שלא נוסע עם git הוא `.env.local`** — הוא gitignored ולכן חייב להיווצר
ידנית במחשב החדש. חובה שיצביע ל-**dev**, אחרת הבדיקה תרוץ מול פרוד:

```bash
grep -o "mhvujejdlmtowypjdhjd\|wxkyqgwwraojnbmyyfco" .env.local | sort -u   # חייב להחזיר רק dev
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5174/api/auth      # 405, לא 404
```

⚠️ `strictPort: 5174` **נופל בשקט** אם תהליך node ישן תפוס על הפורט — אם השרת לא
עולה, זו הסיבה הראשונה לבדוק.

**להרצת `npm run test:db`** צריך לייצא את המשתנים (הסקריפט קורא `process.env` ולא
טוען `.env.local` לבד). הוא מסרב לרוץ אם ה-hostname אינו dev:

```bash
export SUPABASE_URL=$(grep -m1 '^SUPABASE_URL=' .env.local | cut -d= -f2- | tr -d '"'"'"' \r')
export SUPABASE_SERVICE_ROLE_KEY=$(grep -m1 '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2- | tr -d '"'"'"' \r')
npm run test:db
```

---

## נתוני בדיקה — כבר קיימים ב-dev, נוסעים איתך

ה-DB משותף, אז זה יהיה שם גם מהמחשב החדש.

**סטודנט הבדיקה: `nimig10+s3@gmail.com` — "שלומי ברכה"**

| מה יש לו | כמות |
|---|---|
| מסלול לימודים | הנדסאי קולנוע ב |
| קביעות אולפן | **6** |
| הפקות שהוא במאי שלהן | **7** |
| שורות צוות מאושרות | **3** |
| הזמנות ציוד | **0** ← צריך להגיש אחת בשלב א׳ |

💡 כל הסטודנטים ב-dev הם aliases של `nimig10+sN@gmail.com`, כלומר **"שכחת סיסמה?"
נוחת בתיבה שלך** ואפשר להתחבר בתור כל אחד מהם.

⚠️ **7 ההזמנות שקיימות ב-dev הן פיקסטורות `test-*` של זרימת ההוצאה ולא שייכות לאף
סטודנט ברוסטר.** לכן חייבים להגיש בקשה חדשה בשלב א׳ לפני שבודקים את הקסקייד בשלב ד׳.

---

## מדריך בדיקה ידנית

### א. הטופס נעול
1. התחבר כ-`nimig10+s3@gmail.com` → "השאלת ציוד" → **"קולנוע יומית"**.
2. ✅ מופיע **כרטיס 👤** עם שם, מייל ומסלול, ומתחתיו "לעדכון פרטים אלה — פנה/י לצוות המחסן".
3. ✅ **אין** שדות "שם פרטי" / "שם משפחה" / "אימייל" / "קורס / כיתה" להקלדה.
   ניתנים לעריכה **רק טלפון ושם הפרויקט**.
4. **בדיקת הדליפה המקורית**: עבור ל-**"הפקה"** → הכרטיס חייב להציג **אותו שם בדיוק**.
5. רענן (F5) באמצע הטופס → הטיוטה חוזרת (תאריכים/ציוד), והשם עדיין מהרוסטר.
6. השלם והגש בקשה אחת.

### ב. מה נכתב ל-DB
7. פאנל ניהול → "בקשות" → הבקשה החדשה מציגה **בדיוק** את `students.name`.

### ג. "הגדרות חשבון" — אין יותר שינוי שם
8. אצל הסטודנט → ⚙️ → ✅ **אין שדה "שם מלא"**, במקומו כרטיס קריאה-בלבד. יש טלפון ומתג התראות.
9. שנה טלפון → "שמירה" → ✅ הצלחה, **והשם והמסלול לא נעלמו** (בדוק מיד בטופס
   שהכרטיס עדיין מציג שם + מסלול). ← זה תיקון **F3**.

### ד. הקסקייד — הבדיקה המרכזית
10. פאנל ניהול → "סטודנטים" → ערוך את **שלומי ברכה**, שנה שם משפחה ל-"ברכה-בדיקה", סגור.
11. ✅ הבקשה מסעיף א׳ מציגה את השם החדש.
12. ✅ **חיפוש**: השם החדש מוצא אותה. **השם הישן לא מוצא** ← זה הסימן שה-DB באמת
    התעדכן ולא רק התצוגה.
13. ✅ **הזמנות אולפן**: 6 הקביעות שלו מציגות את השם החדש.
14. ✅ **לוח הפקות**: 7 ההפקות מציגות "במאי: ברכה-בדיקה".

### ה. שער ההסמכות — הנזק התפקודי
15. הפקה published שהוא **צלם ראשי מאושר** בה, עם בקשת השאלה מוגשת הכוללת פריט
    שדורש הסמכה שהוא עבר. לפני השינוי — "אשר" זמין.
16. אחרי שינוי השם → ✅ **"אשר" עדיין זמין ואין "דרושה הסמכה"**.
    אם הופיעה חסימה — קסקייד `crew_photographer_name` לא רץ.

### ו. עריכה ואישור לא מחזירים שם ישן (F1)
17. "עריכת בקשה" על בקשה שהשם בה התעדכן → שנה שעת החזרה → שמור.
18. ✅ השם **נשאר החדש**. חזור על זה דרך "אשר" על בקשה ממתינה.

### ז. סטודנט ללא מסלול
19. נקה את מסלול הלימודים של סטודנט בדיקה שני ברובריקה.
20. התחבר בתור אותו סטודנט → "השאלת ציוד" → ✅ הכרטיס מציג
    "לא הוגדר מסלול לימודים", **וכפתור "המשך" משלב 1 עובד** (אסור שייתקע).
21. החזר לו את המסלול.

### ח. ניקוי
22. החזר את שמו של שלומי ברכה דרך הרובריקה → ✅ הקסקייד מחזיר גם את הבקשות
    והקביעות (הוכחה שהמנגנון דו-כיווני ואידמפוטנטי).
23. `npm run test:db` על dev → 52/52.

---

## מה נשאר אחרי הבדיקה

### 1. Backfill פרוד — **רק אחרי אישור מפורש**

`wxkyqgwwraojnbmyyfco`. הרץ **לפי הסדר**, עם ה-dry-run לפני ואחרי (אחרי — חייב 0 שורות).
זה תיקון נתונים ולא סכמה, ולכן **אין קובץ ב-`supabase/migrations/`**.

```sql
-- 6a. dry-run
SELECT r.id, r.loan_type, r.email, r.student_name AS old_name, btrim(s.name) AS roster_name
  FROM public.reservations_new r
  JOIN public.students s ON lower(btrim(s.email)) = lower(btrim(r.email))
 WHERE COALESCE(btrim(s.name),'') <> ''
   AND btrim(COALESCE(r.student_name,'')) IS DISTINCT FROM btrim(s.name)
   AND COALESCE(r.loan_type,'') <> 'שיעור';

-- 6b. הבקשות
UPDATE public.reservations_new r SET student_name = btrim(s.name)
  FROM public.students s
 WHERE lower(btrim(s.email)) = lower(btrim(r.email))
   AND COALESCE(btrim(s.name),'') <> ''
   AND btrim(COALESCE(r.student_name,'')) IS DISTINCT FROM btrim(s.name)
   AND COALESCE(r.loan_type,'') <> 'שיעור';

-- 6c. סנאפ-שוט הצוות — נגזר מאותו join שה-RPC משתמש בו, לא לפי שם
UPDATE public.reservations_new r SET crew_photographer_name = btrim(s.name)
  FROM public.production_crew pc JOIN public.students s ON s.id = pc.student_id
 WHERE r.production_id = pc.production_id
   AND pc.role = 'photographer' AND pc.status = 'approved'
   AND COALESCE(btrim(s.name),'') <> ''
   AND r.crew_photographer_name IS DISTINCT FROM btrim(s.name);

UPDATE public.reservations_new r SET crew_sound_name = btrim(s.name)
  FROM public.production_crew pc JOIN public.students s ON s.id = pc.student_id
 WHERE r.production_id = pc.production_id
   AND pc.role = 'sound' AND pc.status = 'approved'
   AND COALESCE(btrim(s.name),'') <> ''
   AND r.crew_sound_name IS DISTINCT FROM btrim(s.name);

-- 6d. אולפנים והפקות — לפי student_id / director_student_id
UPDATE public.studio_bookings b SET student_name = btrim(s.name)
  FROM public.students s
 WHERE s.id = b.student_id AND COALESCE(b.lesson_auto,false) = false
   AND COALESCE(btrim(s.name),'') <> '' AND b.student_name IS DISTINCT FROM btrim(s.name);

UPDATE public.productions p SET director_name = btrim(s.name)
  FROM public.students s
 WHERE s.id = p.director_student_id
   AND COALESCE(btrim(s.name),'') <> '' AND p.director_name IS DISTINCT FROM btrim(s.name);
```

- `'שיעור'` מוחרג — שורות שיעור נושאות שם **מרצה** מול מייל מרצה.
- `'צוות'` **אינו** מוחרג — שורה כזו עם המייל של הסטודנט שייכת לאותו אדם.
- 2 הסטודנטים בפרוד בלי מייל מדולגים ב-join. שווה לדווח לצוות שימלאו.

### 2. תיעוד (Stage 4)
- **`CLAUDE.md` → 🎓 לקחים**: לקח ממוספר חדש (הבא בתור — **#56**), כלל-ואז-נימוק.
- **`CLAUDE.md` → 🛡️ Guardrails**: שורה ל-`npm run test:identity` (100 בדיקות).
- **ארכיון, שני המאגרים**: נוט ב-`04-תקריות/` עם הנתונים האמיתיים — 31 השורות,
  3 הסטודנטים, מנגנון הדליפה, **ומה נדחה ולמה** (תצוגה חיה: 34 קבצים, 4 צרכנים
  בשרת, שני עותקי `normalizeReservationsForArchive` שאינם זהים). + שורה ב-
  `03-ציר-זמן/` + ארבע שאילתות ה-backfill ב-`06-מסד-נתונים/`.

### 3. מחיקת הקובץ הזה לפני ה-merge.

---

## מה השתנה — מפת הקוד

| קובץ | מה |
|---|---|
| `src/utils/studentIdentity.js` **(חדש)** | מודול טהור חסר-תלויות. `normalizeNameKey` (זהה בית-בית ל-2 העותקים החיים) · `emailKeyOf` · `splitFullName`/`joinName` · `resolveRosterName` · `nameNeedsCascade` · 4 סלקטורים לקסקייד |
| `scripts/run-student-identity-tests.mjs` **(חדש)** | 100 בדיקות. בלי רשת ובלי DB |
| `src/components/PublicForm.jsx` | `rosterMe` · אפקט זריעה בדריסה ללא תנאי · מחיקת שני ה-setters ו-4 השדות · כרטיס קריאה-בלבד · `ok1` בלי `course` · תיקון F3 · מודאל בלי שדה שם |
| `api/auth.js` | `update-student-credentials` לא קורא `name` מהגוף; `nextName` נגזר מ-`me.name` |
| `api/create-reservation.js` | `rosterNameFor()` — שליפה מהרוסטר ב-`email=eq.` ודריסה לפני ה-RPC |
| `src/utils/reservationEdit.js` | `student_name` הוסר מ-`p_fields` (F1) |
| `src/components/StudentsPage.jsx` | `cascadeStudentRenames()` מחובר ל-`save()` |
| `src/components/StaffManagementPage.jsx` | `.ilike("email")` → `.in("id", ids)` (F2) |

---

## אנטי-רגרסיות שנקבעו כאן (המלא ילך ל-CLAUDE.md)

1. **אין שדה שם חופשי — לא בקליינט ולא ב-endpoint.** הסרה מה-UI בלבד משאירה את
   הדלת פתוחה ל-bundle ישן. `api/auth.js` פשוט לא קורא `name` מהגוף, ו-
   `api/create-reservation.js` (אנונימי!) מקנוניקל מהרוסטר.
2. **הקסקייד מפתחו מייל / `student_id` — לעולם לא השם הישן.** השם הישן הוא הערך
   שכבר הוכח כלא-אמין, ושני סטודנטים יכולים לחלוק אותו. לצוות ההפקה אין בכלל
   מייל על השורה, ולכן המפתח הוא `production_crew.student_id` (FK אמיתי).
3. **`student_name` אסור ב-`p_fields`.** מפתח חסר משמר את העמודה. אין שדה שם ב-
   `EditReservationModal`, ולקח #22 מריץ `saveEditedReservation` לפני **כל** אישור —
   אז המפתח היה מקפיא מחדש שם ישן ומבטל את הקסקייד.
4. **`.in("id", ids)` ולא `.ilike("email", …)`.** ב-SQL LIKE `_` הוא wildcard של
   תו בודד; כתובת שמכילה קו-תחתון הייתה משנה שם גם לאנשים אחרים.
5. **`night_*` ו-`equipment_reports` מוחרגים מהקסקייד במכוון** — סנאפ-שוטי זהות
   ששורדים מחיקת סטודנט (לקח #37). כתיבה אליהם משכתבת היסטוריית מבחנים. יש
   בדיקה **שלילית** שמקבעת את ההחרגה.
6. **`create_reservation_v2` לא נגע.** הקנוניקליזציה ב-JS, כדי לא לסכן את 4 ה-guards.

---

## ממצאים פתוחים — לא ב-PR הזה

1. **שינוי מייל ברובריקה מנתק את כל ההיסטוריה של הסטודנט** — `reservations_new.email`
   לא מקומפל, ולכן רשימת הבקשות שלו מפסיקה להתאים, קרון האיחור שולח לכתובת הישנה,
   וה-guard נגד חפיפות מפסיק לראות את השורות הישנות. **הוחלט: PR נפרד** — זה מפתח
   זהות ומגיע לו אישור ובדיקה משלו.
2. **`students.email` בלי UNIQUE index** — `students_email_lower_idx` הוא
   `lower(email)` **לא-ייחודי**, וכל שאילתות השרת עושות `email=eq.<lowercased>`
   שלא יכול להשתמש בו. שורה עם מייל ב-mixed-case לא תימצא בהתחברות.
   ל-`lecturers` יש כבר גם UNIQUE וגם `ilike`.
3. **11 חבילות הטסטים הטהורות לא רצות ב-CI** — `.github/workflows/ci.yml` מריץ
   `lint` + `build` + `test:db` בלבד.
