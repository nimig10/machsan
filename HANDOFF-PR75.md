# HANDOFF — PR #75: שער נראות לפי רשימת ציוד + הסרת מערכת אישור צוות

> מסמך המשכיות לשיחה חדשה. קרא אותו + `CLAUDE.md` בתחילת הסשן.
> **PR:** https://github.com/nimig10/machsan/pull/75 · **ענף:** `feat/board-list-gate-and-crew-autoapprove` · **קומיט אחרון:** `a8010e2` (+ קומיט ה-HANDOFF הזה).
> **בסיס:** `main` @ `137bdf0` (PR #74). **מצב:** code-only, אפס DB · lint 0 errors · build נקי · **טרם נבדק ידנית ע"י המשתמש**.

---

## 🎯 מה הפיצ'ר עושה (2 שינויי מוצר בלוח ההפקות)

### שינוי 1 — טווח תאריכים מופיע בלוח רק אחרי הגשת רשימת ציוד
דרישת בעל המוצר: כל טווח צילום (`production_dates` row) "משתבץ בלוח" **רק** אחרי שהוגשה עבורו רשימת ציוד (הזמנה עם `production_date_id`). מכיוון שהזמנה דורשת שהטווח כבר קיים ב-DB, המודל הוא **הטווח נשמר חופשי בעורך אך מוסתר מהלוח הציבורי** עד שהוגשה עבורו רשימה.

- **מוסתר מסטודנטים אחרים**: כרטיסים + ברים בלוח-שנה + סינון חודשי + ספירות טאבים. הפקה שכל טווחיה ללא רשימות — נעלמת להם לגמרי.
- **הבמאי/צוות/ראש-מחלקה רואים הכל**: badge אדום על הכרטיס, ברים **דהויים** (`alpha 0.35`) בלוח-שנה, שורת אזהרה + כפתור "הגש רשימת ציוד" פר-טווח בתצוגת הפרטים, ו**מודאל post-save** חוסם אחרי פרסום/עדכון.
- **חל על סטודנטים בלבד** — צוות/ראש-מחלקה (`currentStudent=null` במרכבים) פטורים ורואים הכל.
- **Grandfathering**: הפקות שנוצרו **לפני** `LEGACY_PRODUCTION_CUTOFF_ISO` מתנהגות בדיוק כמו היום (כל הטווחים גלויים, אפס אזהרות/מודלים).

### שינוי 2 — הסרת מערכת אישור הצוות
הבמאי מרכיב את הצוות ישירות, ללא הזמנות/אישורים/"בקש להצטרף".

- שורות צוות מאושרות **אוטומטית בשמירה** (`autoApproveDirectorCrew` → `production_approve_crew_v1` הקיים).
- מייל לצוות נשאר — **נוסח יידוע** ("שובצת להפקה", ללא דרישת אישור).
- צלם/סאונד עדיין חייבים סטודנטים רשומים (ולידציה קיימת ללא שינוי).

---

## 🏗️ מפת מימוש (מה נגעתי + איפה)

| קובץ | מה עשיתי |
|------|----------|
| **`src/utils/productionVisibility.js`** (חדש) | מקור אמת יחיד לשער הנראות: `LEGACY_PRODUCTION_CUTOFF_ISO`, `isLegacyProduction(p)`, `submittedDateIds(p, reservations)`, `boardVisibleDates(p, reservations)`, `pendingDates(p, reservations)`. מחליף 3 עותקים inline של `submittedDateIds`. |
| **`src/utils/productionsApi.js`** | מחקתי `requestJoinProduction`/`withdrawJoinRequest`/`rejectCrewMember`/`removeCrewMember`/`checkCrewConflict`. השארתי `approveCrewMember`+`translateCrewError`. הוספתי `autoApproveDirectorCrew(crew)` — לולאה סדרתית best-effort על שורות `status==='invited' && invitedBy!=='self' && studentId`. |
| **`src/components/ProductionEditor.jsx`** | (א) `persist()` קורא `autoApproveDirectorCrew(blob.crew)` אחרי `upsertProduction` ומעדכן ל-`approved` מקומית. (ב) מחקתי `handleApproveCrew`/`handleRejectCrew` + כפתורי אשר/דחה + imports `Check`/`XIcon`/`rejectCrewMember`. (ג) pill סטטוס → "משובץ"/"תפקיד פנוי". (ד) סינון זומבי בטעינת crew (`invited_by='self' && status!=='approved'` מוסתרים). (ה) `lockedDateIds` דרך `submittedDateIds` (מדלג 'בוטל' — תיקון עקביות). (ו) שורת הסבר פר-טווח + **מודאל post-save** (`postSavePrompt` state, `closeOrPromptPending(blob)`). |
| **`src/components/ProductionsPage.jsx`** | מחקתי טאב "בקשות הפקה" + `JoinRequestDialog` + כל הנגזרות (`inboxRequests`/`outgoing`/`incoming`/`totalRequestsCount`/`joinTarget`/`editRequestTarget`) + כפתור "אני רוצה להצטרף"+`alreadyMember`. הוספתי `seesAllPending`/`showPendingFor(p)`/`datesForViewer(p)`/`visibleOnBoard(p)`. `ProductionCard` קיבל prop `showPending` + badge אדום. `ProductionDetail` קיבל `showPending` + אזהרות פר-טווח. לוח-שנה: טווחי pending דהויים ורק ל-`showPendingFor`. `productionInMonth` קיבל param `dateRanges`. crew pill → "משובץ". |
| **`src/components/PublicForm.jsx`** | `onOpenLoanForm(p, dateId?)` — כש-dateId נמצא, seed מלא של `production_date_id`+`borrow/return_date/time` מהטווח. מחקתי `pendingProductionRequests`. |
| **`src/components/StudentHub.jsx`** | מחקתי prop `pendingProductionRequests` + `badge` + בלוק הרנדור שלו. |
| **`api/notify-production-crew.js`** | נוסח בלבד: subject "שובצת לצוות הפקה", כותרת "שובצת להפקה", גוף "אין צורך באישור מצדך — השיבוץ נכנס לתוקף אוטומטית". **אפס שינוי בלוגיקת auth/פילטר.** |

---

## ⚙️ החלטות ארכיטקטורה קריטיות (אל תשבור)

1. **auto-approve דרך RPC, לא כתיבה ישירה של `approved`.** `production_crew_change_recheck_v1` (רענון snapshot + cert-recheck) הוא `service_role`-only, והטריגר יורה רק על DELETE/UPDATE של שורות approved — **לא על INSERT**. לכן העורך **חייב** להמשיך לכתוב `status:'invited'` ואז לקרוא ל-`production_approve_crew_v1` (שמריץ את ה-recheck בעצמו). כתיבה ישירה של `approved` תדלג על ה-recheck כשמוסיפים צוות להפקה עם הזמנה קיימת.
2. **סמנטיקת `status='approved'` נשמרת** לכל המנגנונים במורד: snapshot ב-`create_reservation_v2`, cert-gate `getProductionCertBlockers`, `hasApprovedPhotographer`, `deriveProductionCrewSnapshot`. **לא נגעתי באף אחד מהם.**
3. **שער הנראות = client-only.** שיעורים/הזמנות ב-DB לא השתנו. `archived_at` מחושב ב-DB מכל הטווחים — לא מושפע.
4. **Legacy cutoff** — הפקת legacy עוקפת את השער בכל נקודות המגע כי `boardVisibleDates`/`pendingDates` מחזירים "הכל"/"ריק" עבורה.

---

## 🔲 מה עוד לא נעשה / דורש החלטה

1. **בדיקה ידנית (Stage 1/2)** — 9 התרחישים למטה. **merge רק אחרי אישור מפורש של המשתמש.**
2. **קבוע `LEGACY_PRODUCTION_CUTOFF_ISO`** ב-`src/utils/productionVisibility.js` — כרגע `"2026-07-13"`. **לכוון לתאריך ה-merge בפועל** לפני מיזוג, אחרת הגבול legacy/חדש יהיה שגוי (הפקה שנוצרה ביום ה-merge עלולה ליפול לצד הלא-נכון).
3. **שלב ניקוי דאטה אופציונלי** (dev-first, **דורש אישור מפורש**, לא ב-PR הזה):
   - `UPDATE production_crew SET status='approved', updated_at=now() WHERE invited_by='director' AND status='invited' AND student_id IS NOT NULL` → ואז `SELECT production_crew_change_recheck_v1(production_id)` פר-הפקה מושפעת (flip ב-SQL לא מפעיל טריגר).
   - `DELETE FROM production_crew WHERE invited_by='self' AND status IN ('invited','rejected')` (זומבי בקשות).
   - פרוד קטן (~2 הפקות) — לבדוק דאטה בפועל קודם. שורות במאי מתכנסות גם לבד בשמירה הבאה (auto-approve).
   - הקשחה עתידית (לא נדרש): drop של policies `production_crew_self_enroll_insert`/`self_withdraw` (נהיו inert).
4. **תיעוד CLAUDE.md + לקח #33** — לכתוב אחרי אישור, כרגיל.
5. **מחיקת `HANDOFF-PR75.md`** לפני merge (או השארה — לשיקול המשתמש).

---

## 🧪 מדריך בדיקה ידנית (2 חשבונות סטודנט: A=במאי קולנוע, B=אחר)

**שינוי 1:**
1. A יוצר הפקה + 2 טווחים + צלם → מפרסם → **מודאל post-save** מציג 2 טווחים ממתינים → "אחר כך".
2. A: כרטיס עם badge "🚫 2 טווחים... מוסתרים"; לוח-שנה = 2 ברים דהויים; detail = אזהרה+כפתור פר-טווח. **B: ההפקה לא מופיעה בלוח כלל** (חודש + "כל ההפקות" + ספירת טאב).
3. A: "הגש רשימת ציוד" לטווח 1 → טופס נפתח בשלב 2 עם הטווח משובץ → השלמת הגשה.
4. B: רענון → ההפקה מופיעה עם **טווח 1 בלבד** (בר אחד בלוח-שנה).
5. ביטול ההזמנה של טווח 1 מ"ההזמנות שלי" → הטווח נעלם שוב מ-B ונפתח לעריכה אצל A (תיקון 'בוטל').
6. **Legacy**: הפקה קיימת מלפני ה-cutoff (יש ב-dev) מוצגת ל-B עם כל טווחיה, בלי אזהרות אצל הבמאי שלה.

**שינוי 2:**
7. A מוסיף איש סאונד + שמירה → מיידית "משובץ"; מייל יידוע ל-`nimig10@gmail.com`; אין UI בקשות בשום מקום; אין טאב "בקשות הפקה"; אין badge ב-StudentHub.
8. **הסמכות (regression)**: החלפת צלם בהפקה עם הזמנה מאושרת → ההזמנה חוזרת ל"ממתין" + snapshot של השם מתעדכן (recheck רץ דרך ה-RPC). פריט cert-required עם צלם לא-מוסמך → נחסם ב-cert-gate ב-ReservationsPage.
9. צוות/ראש-מחלקה: רואים הכל כולל pending (דהוי), read-only תקין; ארכיון ללא שינוי; השאלות פרטית/סאונד/יומית ללא שינוי.

---

## 🚫 אסור לגעת (anti-regressions)

`create_reservation_v2`/`update_reservation_status_v1`/נתיב כתיבת ההשאלות · חישוב 8-הימים (`minShootISO`/`fmtDeadline`/`validate`) + grandfathering תאריכי-עבר (PR #67) · `production_delete_v1` · דפוס `productionId` היציב (`useState(() => ...)`) · **צורת כתיבת crew בעורך — נולד `invited`** (נדרש לטריגר ה-recheck) · לוגיקת auth/פילטר ב-`notify-production-crew` (נוסח בלבד) · `api/production-deadline-reminder.js` (ללא שינוי, עדיין רלוונטי) · ארכיון `archived_at`.

---

## 🗂️ הערה: WIP נפרד שמור ב-stash (לא קשור ל-PR הזה)

לפני הפיצ'ר הזה, `git stash@{0}` שומר עבודה קודמת לא-מקומיטת:
`"WIP: identity-propagation (api/staff.js + StaffManagementPage.jsx) + local settings perms — pre-137bdf0-sync 2026-07-13"`.
זו הפצת שם/מייל של איש צוות לצד-שרת (`api/staff.js handleUpdate`) — **נפרד לגמרי** מ-PR זה. אם צריך אותה: `git stash list` → `git stash show -p stash@{0}`. אל תערבב עם הפיצ'ר הזה.

---

## ▶️ איך להמשיך בשיחה חדשה

```bash
git checkout feat/board-list-gate-and-crew-autoapprove
git pull
npm run dev          # localhost:5174 על dev DB (mhvujejdlmtowypjdhjd)
```
בתחילת הסשן: לשאול "נייד/מחשב" (כלל CLAUDE.md). זרימה: dev-first, merge רק באישור מפורש דרך merge-PR (main מוגן).
