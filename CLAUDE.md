# מסמך מעבר חשבון — אפליקציית "מחסן קמרה"

> מסמך הקשר יחיד לסשנים חדשים. סנאפ-שוט עדכני נכון ל-**2026-07-12** (אחרי PR #50–#74). **PR #74 — פריסה דו-טורית בעורך הקורס + ברירת מחדל תעודה + guard מייל סיום קורס (code-only, אפס DB)**: שינויי UI בעורך הקורס ([LessonsPage.jsx](src/components/LessonsPage.jsx) `LessonForm`) + guard במייל. (1) **פריסה דו-טורית** לצמצום גלילה — `display:grid` מותנה `isMobile` (`minmax(0,0.9fr) minmax(0,1.5fr)` בדסקטופ, `1fr` במובייל), `minWidth:0` על שני הטורים (מונע מהטבלה הרחבה לדחוף את ה-card לרוחב-יתר). **טור שמאל (RTL end)**: לוח שיעורים בלבד (רחב). **טור ימין (RTL start)**: פרטי הקורס · שיוך כיתות · שליחת מייל למרצה · **תעודת גמר** (הועברה לתחתית הטור הימני). ה-modal של "רשימת תלמידים" (`position:fixed`) הוצא מחוץ ל-grid. (2) **ברירת מחדל "ללא תעודה" ביצירת קורס** — ה-`useEffect` שגזר סוג-תעודה מהמסלול מדולג ב-create mode (`if (!initial) return`); edit mode ללא שינוי (עדיין עוקב אחרי המסלול). (3) **חסימת מייל סיום-קורס לקורס ללא תעודה** — [api/notify-course-end-7days.js](api/notify-course-end-7days.js) מדלג על קורס עם `certificateTemplateType` ריק (guard חדש — קורס ללא תעודה לא מייצר תעודות, אין מה להזכיר למרצה). (4) **גלילה אנכית בטבלת לוח השיעורים בוטלה** — עטיפת טבלת הדסקטופ `overflowX:"auto",overflowY:"hidden"`: `overflowY:"hidden"` מפורש מונע מהדפדפן לקדם את הציר האנכי ל-`auto` (שהחזיר סרגל אנכי דק); גלילה אופקית בלבד כשהעמודות רחבות מהטור, בלי סרגל אנכי, בלי חיתוך (אין maxHeight). הרחבת לקח #30. ראה לקח #32. **PR #73 — ממשק מולטי-תפקיד ב-HUB + הוספת/הסרת איש צוות בטוחה (code-only, אפס DB)**: משתמש שהמייל שלו רשום בכמה תפקידים (סטודנט/מרצה/צוות) רואה בכל HUB את **כל** הממשקים שההרשאות שלו מקנות; חד-תפקידי רואה רק את שלו. (1) **סנכרון דגלים לאמת החיה** — `is_student`/`is_lecturer` ב-`public.users` הם דגלים **נגזרים** מטבלאות `students`/`lecturers`: [api/auth.js](api/auth.js) `computeLiveRoleFlags`+`upsertPublicUserWithLiveFlags` (בדיקת כל המקורות במקביל, לא first-match; משותף ל-`ensure-user`+reset-email; set **וגם** clear), + **זיהוי drift בלוגין** ב-`routeByRolesCore` ([PublicForm.jsx](src/components/PublicForm.jsx)) — קריאת סנכרון לשרת רק על אי-התאמה. `is_admin`/`is_warehouse` אוטוריטטיביים ב-users ולעולם לא מנוקים אוטומטית. (2) **UI מעבר-תפקיד**: כרטיסי "פורטל מרצה"/"ניהול מערכת" ב-[StudentHub.jsx](src/components/StudentHub.jsx) (מותני-דגלים), "מעבר לתצוגת סטודנט" ב-[LecturerPortal.jsx](src/components/LecturerPortal.jsx), כל לחצני המעבר בצהוב `#f5a623`; מסך **"מעביר…"** במקום הבהוב מסך login במעבר (`switching` state), hint-fallthrough ב-`routeByRolesInner` (hint כושל → מנקים ונופלים לעדיפות ברירת-מחדל), דילוג drift+300ms בזמן switch (ביצועים). (3) **הוספת איש צוות ללא סיסמה** ([StaffManagementPage.jsx](src/components/StaffManagementPage.jsx)+[api/staff.js](api/staff.js)) — שדה הסיסמה הוסר (onboarding אחיד דרך "שכחת סיסמה?"; השרת לא כותב/דורס סיסמה); מייל קיים → **שדרוג-מיזוג** למולטי-תפקיד במקום 409 (דגלי צוות ב-OR, is_student/is_lecturer נשמרים, permissions ממוזגות, `promoted:true`); **autocomplete** מסטודנטים/מרצים רשומים (צוות קיים מסונן); שם פרטי/משפחה נפרדים (נשמר `full_name` יחיד). (4) **תיקון קריטי**: מחיקת איש צוות = **הסרת-תפקיד** כשהמייל עדיין סטודנט/מרצה פעיל (PATCH דגלי-צוות בלבד, `downgraded:true` — שורת users+auth+סיסמה נשמרים); מחיקה מלאה (users+auth) רק כשאין תפקיד בשום מקום. ראה לקח #31. **PR #72 — שיפורי UI בעורך הקורס (code-only)**: (1) **לוח שיעורים בגובה אדפטיבי** — הוסר ה-scroll הפנימי מטבלת המפגשים ([LessonsPage.jsx](src/components/LessonsPage.jsx), דסקטופ+מובייל), כך שהיא גדלה עם מספר המפגשים והדף עצמו גולל (הטופס יושב ב-`<div className="card">` בזרימת הדף, לא במודאל). ⚠️ הסרת ה-overflow חייבת להיות **מלאה** — `overflow-x:auto` לבדו מקדם את `overflow-y` ל-`auto` (כלל CSS) ומחזיר סרגל אנכי. (2) **הפרדה ויזואלית עבר/עתיד** — מפגש עם `session.date < today()` מוצג אפור+מעומעם (`opacity:0.6`)+tooltip; עתידי נשאר סגול/בהיר. (3) **לחצן "💾 עדכן קורס" עליון** ליד "ביטול" בכותרת הטופס (אותו `handleSave`) — שמירה בלי גלילה לתחתית. אפס DB. ראה לקח #30. **PR #71 — תיקון פאנל התנגשות קביעות חדרים בעורך הקורס (code-only)**: פאנל "התנגשות עם קביעות חדרים" בעורך הקורס ([LessonsPage.jsx](src/components/LessonsPage.jsx)) התעלם מהשיוך הפר-מפגש בטבלת "לוח שיעורים" — מפגש שסומן "ללא שיוך" (או חדר אחר) עדיין הצליב מול **כיתות הקורס הגלובליות** וחסם שמירה. השורש: `getEffectiveLessonStudioIds` ([lessonBookings.js](src/utils/lessonBookings.js)) עשה fallback לרמת-הקורס כשמערך `studioIds` של המפגש היה ריק. **תוקן בשכבת-הנתונים** (ה"באקאנד" — אין RPC לשיעורים, הם נגזרים): מערך `studioIds` מפורש הוא מקור-האמת (ריק=אין חדר, בלי fallback), ו-`getLessonScheduleEntries` משמר את המערך הגולמי + הסקלרים כך שגם `buildLessonStudioBookings` מפסיק לייצר קביעת-רפאים למפגש "ללא שיוך" (fallback לקורס רק ל-legacy בלי מערך). **+ סינון עתידי**: 7 בודקי החפיפה (4 חדרים + 3 מרצים) מדלגים על מפגשי-עבר (`session.date < today()`) — קביעות שכבר עברו אינן ניתנות לתיקון. **צוות+סטודנט**: הפאנל מציג כל קביעה חוסמת בנפרד (dedup לפי `booking.id` בלבד) → מפגש עתידי בחדר עם קביעת-צוות **וגם** קביעת-סטודנט מציג את שתיהן. אפס DB · lint 0 · build נקי. ראה לקח #29. **PR #69 — כפתור ייצוא PDF לרשימת הציוד המסוננת (תפעול מחסן)** (code-only): בטולבר של **תפעול מחסן → ציוד** (סאב-תצוגה "active") נוסף כפתור **"🖨️ ייצוא PDF"** שמפיק PDF של רשימת הציוד המוצגת — משקף **בדיוק את הסינון הפעיל** בדף (קטגוריה/חיפוש/סוג), מקובץ לפי קטגוריה. מרנדר את המערך `filtered` בקיבוץ `groupedCategories` — אותו מקור נתונים בדיוק שהרשת במסך משתמשת בו ([App.jsx](src/App.jsx) `EquipmentPage.exportEquipmentPdf`). **דפוס browser-print** (HTML `dir=rtl` → `window.open` → `window.print()` → "שמור כ-PDF"), Hebrew/RTL-safe, זהה ל-`exportPDF` ב-[ReservationsPage.jsx](src/components/ReservationsPage.jsx) — **אין ספריית PDF, אין תלות חדשה**. תוכן מינימלי (שם פריט + כמות כוללת), escaping (`esc`) מפני הזרקת HTML, toast כשהסינון ריק / חלון קופץ חסום. **אפס DB.** ראה לקח #28. **PR #68 — פאנל "משימות להיום" ב-Staff Hub (מגובה-DB) + תיקון קריאת סטטוס יחידות ציוד**: פאנל מתקפל בפינה ימנית-תחתונה של ה-Staff Hub לכל עובד — משמרת היום (open/prep/close), בקשות השאלה שהוא מטפל בהן היום (out/return + שעות מ-`reservation_staff_assignments`), הערת מנהל, ההערה שלו, ומשימות ידניות (≤150 תווים). **צ'קבוקס ביצוע לכל פריט**: משימות אישיות + בקשות עם עמודת `done` משלהן; משמרת+הערות דרך טבלת check-off מאוחדת `staff_hub_checkoffs` (presence=בוצע). **מגובה-DB**: 3 מיגרציות (`20260706120000` staff_personal_tasks, `20260706130000` `reservation_staff_assignments.done` display-only, `20260706140000` staff_hub_checkoffs — כולן RLS-on ללא policies, API-only, הוחלו ב-dev; prod לפני merge). API: 6 actions ב-[api/staff-schedule.js](api/staff-schedule.js) (`my-today`, add/toggle/delete-personal-task, toggle-loan-handled, set-checkoff), "היום" ב-Asia/Jerusalem. **טעינה app-level**: [App.jsx](src/App.jsx) `myToday`+`loadMyToday` (מתרענן בכניסה ל-hub, נשמר ב-state → אין fetch/הבהוב פר-ניווט), מועבר ל-[StaffHub.jsx](src/components/StaffHub.jsx). צ'קבוקסים אופטימיים-בלבד. מובייל/PWA: `fixed`+safe-area, מקופל-במובייל+badge מונה, input 16px. **תיקון באג יחידות ציוד** (code-only): סטטוס יחידה (פגום/בתיקון/נעלם) חזר ל"תקין" ולא הופיע ב"ציוד בדיקה" — הקריאה שלפה `equipment` עם `select("*")` בלי טבלת הבת `equipment_units`, אז `ensureUnits` המציא יחידות `תקין`. תוקן ע"י `select("*, units:equipment_units(*)")` ב-4 אתרי הקריאה ([App.jsx](src/App.jsx)). ראה לקח #27. **PR #67 — ארכיון להפקות שהסתיימו (מגובה-DB) + עיצוב אפור + סינון חודשי**: הפקה "מסתיימת" כשהתאריך האחרון שלה (`max(end_date)` מכל טווחי הצילום) עובר → יוצאת מהלוח הפעיל לתצוגת **"ארכיון"** (מתג "לוח / ארכיון" בתוך לוח ההפקות, ב-3 נקודות ההרכבה: סטודנט/צוות/ראש-מחלקה). **מגובה-DB**: עמודת `productions.archived_at` (מיגרציה `20260705120000`, **הוחלה ב-dev**; prod לפני merge) + RPC `productions_refresh_archive_v1(p_production_id?)` (חישוב מ-`max(end_date) < היום(Asia/Jerusalem)`, gate ל-`published`, `COALESCE(old_at, now())` שומר זמן-ארכוב ראשון, מעדכן רק שורות ששונו) + backfill + **cron יומי** [api/productions-archive.js](api/productions-archive.js) (03:00 UTC). קליינט ([src/utils/productionsApi.js](src/utils/productionsApi.js) `archivedAt` ל-blob + refresh post-save לארכוב/שחזור מיידי; [ProductionsPage.jsx](src/components/ProductionsPage.jsx) `belongsToTab` על כרטיסים+לוח-שנה): **סטודנט רואה ארכיון של חודש בלבד, צוות/ראש-מחלקה לתמיד — הרשומה לעולם לא נמחקת** (ההסתרה-אחרי-חודש היא view-filter). הפקה שהסתיימה מוצגת ב**אפור** (`ARCHIVED_COLOR`, כרטיס+בר) עם badge **"ההפקה הסתיימה"**. **סינון חודשי**: ברירת מחדל הלוח מציג רק הפקות שטווחן חופף לחודש שבלוח-שנה (`productionInMonth`), סוויץ "חודש נבחר / כל ההפקות" (`scopeAll`), **"ההפקות שלי" (הבמאי) תמיד גלוי**. `ProductionEditor.validate()` עושה grandfather לתאריכי-עבר שלא שונו → שחזור ע"י הוספת טווח עתידי נשמר. ראה לקח #26. **PR #66 — לחצני תפעול בראש מודאל הבקשה + קטגוריות/תמונות בערכה** (code-only): לחצני אשר/דחה/עריכה/PDF/מחק/סגור הועברו מה-footer ל**ראש** מודאל התצוגה ([ReservationsPage.jsx](src/components/ReservationsPage.jsx)) — נגישים בלי גלילה מעבר לרשימת ציוד ארוכה; רשימת הציוד בערכה ([App.jsx](src/App.jsx) `KitsPage`) מקובצת לפי קטגוריה + תמונות 32px. **PR #64–#65** (מוזגו לפרוד): #65 — קביעות צוות בבלוז עובדים (רובריקת "קביעות" מציגה גם team, לא רק student) + קישור "בקשות אחרונות"⇄"לוח השאלות ציוד" בדשבורד (SLAVE לפילטרים, לחיצה על בר→מודאל, החלפת צדדים) + קטגוריות ברשימת ציוד בתצוגת בקשה + תיקון `TIME_SLOTS` שנעצר ב-19:30 במודאל העריכה. **PR #63 — חישוב זמינות ציוד לפי שיא-מקבילי (peak-concurrent) במקום סכימה**: הזמינות חושבה `workingUnits − SUM(כל הביקוש החופף)` במקום `workingUnits − MAX_concurrent(בחלון)` — שתי בקשות חוסמות בחלונות **זרים** בתוך חלון בקשה אחד נספרו פעמיים, ופריט 2-יח' הוצג `זמין: 0` וחסם/דחה אישור. תוקן בכל המשטחים: קליינט (`computeEquipmentAvailability` ב-[src/utils.js](src/utils.js) + wrappers) ושרת (`create_reservation_v2` `20260701120000` + `update_reservation_status_v1` `20260701120100` → `MAX(c)` במקום `SUM`, byte-for-byte עם כל ה-guards). טסט `run_availability_peak_tests` (`20260701120200`, קורא ל-RPC האמיתי) → smoke **33/33**. **שלוש המיגרציות הוחלו ב-dev וב-prod.** ראה לקח #25. **(hotfix `57b657b`, 29/06, ישיר ל-main): `/daily-table` לעולם לא רושם SW** — ריפוי-עצמי לקיוסק תקוע, ראה לקח #24. **PR #61 — ניווט network-first ב-Service Worker (מניעת מסך לבן בקיוסק)**: `NavigationRoute` ב-[src/sw.js](src/sw.js) עבר מ-cache-first ל-**`NetworkFirst`** (`networkTimeoutSeconds: 5`) עם `PrecacheFallbackPlugin`→`index.html`. מכשיר מחובר תמיד מושך `index.html` טרי מהרשת (hashes עדכניים); נופל ל-precache רק offline. סוגר **death-spiral** של תצוגת `/daily-table` ב-Fully Kiosk: ה-index הישן בה-precache הצביע על `assets/index-<hash>.js` שנמחק אחרי דפלוי→404→מודול הכניסה נכשל→`registerSW` ב-[main.jsx](src/main.jsx) לא רץ→ה-SW לא התעדכן לבד→מסך לבן קבוע. **code-only, אפס DB.** ראה לקח #24. **PR #60 — תיקונים אסתטיים נקודתיים** (code-only): (1) "לא משויך"/"לא שויך" באדום מודגש (`#ef4444`) בלוז העובדים — שיוך כיתה ([StaffSchedulePage.jsx](src/components/StaffSchedulePage.jsx) כרטיס+טבלה) ואיש-צוות-מטפל בבקשות ההשאלה (`LoanChip`+מודאל); (2) סידור פאנלים בטופס יצירת/עריכת קורס ([LessonsPage.jsx](src/components/LessonsPage.jsx)) — "לוח שיעורים" הועבר אל **מתחת** ל"שיוך כיתות לימוד" (פרטי הקורס→שיוך כיתות→לוח שיעורים). **PR #58 — שיוך איש צוות מטפל לבקשת השאלה (תיאום פנימי, מנותק לחלוטין)**: טבלת-צד `reservation_staff_assignments` (מיגרציה `20260628120000`, **הוחלה ב-dev וב-prod**) שמשייכת איש צוות אחראי על **הוצאה/החזרה** של בקשת השאלה. **מנותקת לחלוטין ממערכת ההשאלות** — FK חד-כיווני `ON DELETE CASCADE`→`reservations_new`, `kind` out/return, `UNIQUE(reservation_id,kind)`, RLS read-all + service-write, realtime. כתיבה רק דרך 2 actions אדיטיביים ב-`api/staff-schedule.js` (`assign/unassign-loan-handler`; אדמין משייך כל אחד, צוות רק את עצמו); קריאה ב-`App.jsx` (`loanHandlers` state + realtime channel). UI: בלוז עובדים תת-רובריקות "תפעול כללי"/"בקשות השאלה" בפאנל המנהל (dropdown תואם-משמרת) ובהעדפת הצוות (checkbox V לפי חפיפת זמן) + אייקון 🔧 על צ'יפ העובד + "שם הסטודנט"/"איש צוות מטפל" בכרטיס/מודאל; תצוגת מחסן **read-only** (ReservationsPage כרטיס/מודאל/עריכה + DashboardPage). **אפס שינוי ב-RPC/סטטוסים/נתיב כתיבת ההשאלה — בקשה זורמת בכל הסטטוסים גם בלי אף אחראי; אסתטי/ניהולי בלבד.** ראה לקח #23. **PR #57 — שיפורי פאנל ולוח שיבוץ עובדים** (`StaffSchedulePage.jsx`, code-only): עריכת מולטי-עובד עם draft-buffer ו-Save יחיד, פאנל מנהל גלובלי "שיבוץ עובדים", ברירת מחדל ללא משמרת, DESELECT (לחיצה חוזרת מנקה), נעילה צבעונית (Lock אמבר), טעינת העדפת עובד + צ'יפ כחול+עיגול, "עריכה אחרונה מנצחת אלא אם נעול", סינון משימות לפי תאימות משמרת. + **docs(claude)**: ברירת מחדל לזרימת מחשב (localhost-first) + חובת שאלת "נייד/מחשב" בתחילת כל שיחה. **PR #55 — guard אטומי נגד הקצאת-יתר באישור + שמירת עריכות בעת אישור**: `update_reservation_status_v1` קיבל **בדיקת זמינות בצד-שרת** (מיגרציה `20260625120000`, **הוחלה ב-dev וב-prod**) — במעבר לתוך `מאושר` מסטטוס שאינו חוסם, נועל `FOR UPDATE` את שורות הציוד ומוודא `healthy − overlapping_blocking_demand (ללא ההזמנה עצמה) ≥ quantity`, אחרת זריקה `approve_overbook`→409. סוגר את ה-TOCTOU race שבו שני מאשרים על state מיושן אישרו בקשות חופפות מעבר למלאי (קודם הבדיקה הייתה client-only). בנוסף: כפתור "אשר והעבר למאושר" ב-`EditReservationModal` **שומר קודם** את עריכות הפריטים/שעות (`saveEditedReservation` עם `{silent}`, מחזיר boolean) ורק אז מאשר — תיקון לבאג שבו trim-ואז-אישור מחק עריכות בשקט. ראה לקח #22. **PR #51–#53 — הגבלת השאלת-חוץ של ציוד**: שתי עמודות חדשות על `equipment` (`external_loan_restricted` בוליאני + `external_loan_hold_count` integer, מיגרציה `20260623120000`, **הוחלה ב-dev וב-prod**) שמאפשרות לאיש המחסן לחסום פריט רגיש מ-`פרטית`/`הפקה` או להחזיק N יחידות בקמפוס; אכיפה ב-`create_reservation_v2` (guard רביעי, מיגרציה `20260623120200`) + `sync_equipment_from_json` ממראה את העמודות (`20260623120100`) + UI בפאנל היחידות (`UnitsModal`) + הסתרה ב-`PublicForm` step 3 + מיפוי שגיאה `external_restricted`. ראה סעיף "🚫 הגבלת השאלת-חוץ" + לקח #21. **PR #50** — docs refresh ל-PR #48–#49. **PR #48**: **guard אטומי ל-double-booking של אולפנים** — `EXCLUDE constraint` (`studio_bookings_no_overlap`) + `btree_gist` + פונקציית `studio_booking_tsrange` IMMUTABLE (מיגרציה `20260621120000`, **הוחלה ב-dev וב-prod**), סגירת פערי בדיקת-חפיפה בקביעות לילה (סטודנט+צוות), helper משותף `src/utils/studioOverlap.js`, מיפוי `23P01`→`studio_overlap`, וטסט CI `run_studio_overlap_tests` (smoke עכשיו **30/30**). **PR #49**: עיצוב עורך הקורס — לחצני הוספה בסגול אחיד `#9b59b6` + שם הקורס דינמי בכותרת. baseline קודם: PR #46–#47 (crew snapshot recheck-refresh `20260613150000` + שחזור per-student overlap guard `20260613153000` + `getEffectiveStatus` גוזר "באיחור"), PR #44–#45 (crew snapshot `20260604120000`), PR #39–#43 (מובייל + `HH:MM` + מייל דדליין הפקה + `no-undef`=error).

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

> ❓ **חובה — בתחילת כל שיחה חדשה לשאול: "עובדים על מכשיר נייד או על מחשב?"** (לפני תחילת עבודה כלשהי). התשובה קובעת איזו זרימת עבודה חלה לכל אורך הסשן:
> - **מחשב** → **זרימת העבודה הישנה (ברירת המחדל)** = 3 השלבים למעלה כמות-שהם, כולל **Stage 1 (localhost על dev DB)** כשלב חובה. **אסור לדלג על Stage 1.**
> - **נייד** → **זרימת המובייל** (ראו הבלוק הירוק למטה) — Stage 1 (localhost) מוחלף ב-Stage 2 (Vercel Preview).
>
> ברירת המחדל היא **הזרימה הישנה (מחשב)**. אם מסיבה כלשהי לא נשאל/לא נענה — לפעול לפי הזרימה הישנה (localhost-first).

> 🟢 **זרימת המובייל (חלה רק אם המשתמש ענה "נייד" בתחילת הסשן):**
> כשלמשתמש **אין גישה ל-localhost** (עובד מהטלפון), **Stage 1 (localhost) מוחלף ב-Stage 2 (Vercel Preview)**:
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

טבלאות תומכות: `users` (מראת auth, source הפעיל להרשאות), `staff_members` (legacy, fallback הוסר), `activity_logs`, `equipment_reports`, `auth_entity_map`, `staff_schedule_assignments`, `staff_schedule_preferences`, `staff_daily_tasks`, `reservation_staff_assignments` (טבלת-צד מנותקת לשיוך איש-צוות מטפל להוצאה/החזרה של בקשת השאלה — PR #58, FK חד-כיווני `ON DELETE CASCADE`, **לא נוגעת בלוגיקת ההשאלות**; + עמודת `done` display-only למעקב עצמי — PR #68), `staff_personal_tasks` (משימות ידניות של עובד ל-Staff Hub, פר staff+יום — PR #68), `staff_hub_checkoffs` (מעקב-ביצוע מאוחד למשמרת-היום/הערות בפאנל "משימות להיום", presence=בוצע — PR #68), `auth_rate_limits`. (3 האחרונות RLS-on ללא policies, API-only דרך `/api/staff-schedule`.)

`reservations_new` קיבל FK אופציונליים: `production_id` + `production_date_id` (ON DELETE SET NULL).
`productions.kit_id` (FK → `kits`, ON DELETE SET NULL) — כש-set, הזמנת ההפקה מוגבלת לפריטי הערכה.
`equipment` קיבל 2 עמודות הגבלת-השאלת-חוץ (PR #51, מיגרציה `20260623120000`): `external_loan_restricted boolean DEFAULT false` (חוסם את הפריט כולו מ-`פרטית`/`הפקה`) + `external_loan_hold_count integer DEFAULT 0` (כמה יחידות להחזיק בקמפוס). **על `equipment` ולא `equipment_units`** — טופס ההשאלה טוען ציוד דרך `select("*")` ולא מושך unit rows, אז flag ברמת-unit לא היה עושה round-trip. ראה סעיף "🚫 הגבלת השאלת-חוץ".

### RPCs פעילות

- **ציוד**: `sync_equipment_from_json` (**עודכן ב-PR #51, מיגרציה `20260623120100`** — ממראה גם את `external_loan_restricted`/`external_loan_hold_count` מ-JSON keys `externalLoanRestricted`/`externalLoanHoldCount`; שאר הלוגיקה byte-for-byte זהה. ⚠️ **delete+reinsert של units + COALESCE ל-false/0** — לכן App.jsx חייב לשטח את העמודות ל-camelCase על כל row, אחרת כתיבת-מערך-מלא תאפס את הערכים השמורים).
- **הזמנות**: `create_reservation_v2` (**עודכן ב-PR #51, מיגרציה `20260623120200`** — נוסף **guard רביעי: הגבלת השאלת-חוץ** ל-`פרטית`/`הפקה` בלבד — `external_loan_restricted=TRUE`→זריקה `external_restricted`; `external_loan_hold_count=N`→מקטין את ה-available pool ב-N. נבנה **byte-for-byte על `20260613153000`** ושומר את כל 3 ה-guards הקודמים. baseline קודם PR #45 `20260604120000` — crew snapshot מ-`production_crew` המאושר; **לוגיקת availability/overlap זהה ל-`20260516160000`** — חוסם רק מאושר/באיחור/פעילה), `create_lesson_reservations_v1`, **`update_reservation_status_v1` (עודכן ב-PR #55, מיגרציה `20260625120000`** — נוסף **guard אטומי נגד הקצאת-יתר באישור**: במעבר לתוך `מאושר` מסטטוס שאינו חוסם, `FOR UPDATE` על שורות הציוד + בדיקת `healthy − overlapping_blocking_demand (r.id<>self) ≥ qty`, אחרת `approve_overbook`. אישור-חוזר ו-`באיחור`/`פעילה`→`מאושר` מדולגים. שאר הלוגיקה byte-for-byte. סוגר את ה-race ש-`getReservationApprovalConflicts` בקליינט לבדו לא כיסה), `delete_reservation_v1`, `restore_reservation_v1`, `student_modify_reservation_item_v1`, `mark_overdue_email_sent`.
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
21. **הגבלת השאלת-חוץ — flag ברמת `equipment`, אכיפה דו-שכבתית** (PR #51). העמודות `external_loan_restricted`/`external_loan_hold_count` יושבות על `equipment` (לא `equipment_units` — הטופס לא מושך unit rows). **`normalizeEquipmentTagFlags` חייב לשטח אותן ל-camelCase בשני העותקים** (App.jsx + utils.js) — אחרת `sync_equipment_from_json` (delete+reinsert + COALESCE→false/0) **מאפס בשקט** את הערכים בכתיבת-מערך-מלא הבאה. רשימת הסוגים המושפעים `פרטית`/`הפקה` חייבת להישאר מסונכרנת בין `EXTERNAL_LOAN_TYPES` (קליינט) ל-`v_loan_type IN (...)` (RPC). כל `CREATE OR REPLACE` של `create_reservation_v2` חייב לשמר את **כל 4 ה-guards** (per-student, per-equipment, crew-derive, external-loan). ראה סעיף "🚫 הגבלת השאלת-חוץ".
22. **אישור בקשה = נקודת אכיפה שנייה לזמינות (race-proof), והאישור מ-modal העריכה חייב לשמור קודם** (PR #55). היסטורית, בדיקת הזמינות רצה **רק** ב-`create_reservation_v2` (הגשה); האישור (`update_reservation_status_v1`) לא בדק כלום וההגנה היחידה הייתה `getReservationApprovalConflicts` **בקליינט** מול state בזיכרון — שתי בקשות `ממתין` (לא חוסמות) שאושרו על snapshot מיושן יצרו הקצאת-יתר. עכשיו ה-RPC נועל `FOR UPDATE` ובודק `healthy − overlapping_blocking_demand (ללא self) ≥ qty` במעבר לתוך `מאושר`, וזורק `approve_overbook` (→409, מיפוי ב-[api/update-reservation-status.js](api/update-reservation-status.js), הודעת עברית + רענון ב-`doApprove`). **אסור להחיל את ה-guard על אישור-חוזר או על `באיחור`/`פעילה`→`מאושר`** (הם כבר מחזיקים מלאי) — רק על מעבר מסטטוס לא-חוסם. בנפרד: ב-[EditReservationModal](src/components/EditReservationModal.jsx) כפתורי האישור קוראים `onApprove({...form, items})`, אבל ההורה ב-[ReservationsPage.jsx](src/components/ReservationsPage.jsx) **חייב להריץ `saveEditedReservation(updated,{silent:true})` לפני `approveReservation`** — אחרת עריכת פריטים/שעות לפני אישור נמחקת בשקט (האישור הוא status-only). `saveEditedReservation` מחזיר boolean ו-`{silent}` מדלג על toast+סגירה כשמשרשרים אליו אישור.
23. **שיוך איש צוות לבקשת השאלה — טבלת-צד מנותקת, אפס השפעה על לוגיקת ההשאלות** (PR #58). הפיצ'ר **אסתטי/ניהולי בלבד**. `reservation_staff_assignments` (FK חד-כיווני `ON DELETE CASCADE`→`reservations_new`, `kind` out/return, `UNIQUE(reservation_id,kind)`, RLS read-all + service-write, realtime). **אסור** להוסיף שום שדה/לוגיקה ל-`create_reservation_v2`/`update_reservation_status_v1`/נתיב כתיבת ההשאלה (`saveEditedReservation`) — האחראי חי **בטבלת-הצד בלבד**. **אין שיוך → אין תצוגה, אין חסימה, הסטטוסים זורמים כרגיל.** כתיבה רק דרך 2 actions אדיטיביים ב-[api/staff-schedule.js](api/staff-schedule.js) (`assign/unassign-loan-handler`; אדמין משייך כל אחד, צוות רק את עצמו); קריאה ב-[App.jsx](src/App.jsx) (`loanHandlers` state + realtime channel "loan-handlers-live", מועבר לדפים). UI: helpers ברמת-מודול ב-[StaffSchedulePage.jsx](src/components/StaffSchedulePage.jsx) (`getDayStudentLoans`/`shiftCoversTime`/`loanHandlerFor`) — פאנל מנהל/העדפה + צ'יפ לוח + 🔧; תצוגת מחסן read-only (ReservationsPage כרטיס/מודאל/עריכה + DashboardPage). **כל `CREATE OR REPLACE` או edit עתידי של RPC הזמנות — לא לגעת בטבלה הזו, ולא להוסיף לה אכיפה.**
24. **Service Worker — ניווט network-first, אסור לחזור ל-cache-first** (PR #61, [src/sw.js](src/sw.js)). ה-`NavigationRoute` חייב להישאר `NetworkFirst` (+`PrecacheFallbackPlugin`→`index.html`), **לא** `createHandlerBoundToURL('index.html')` (cache-first). המעבר נעשה כי cache-first על תצוגת קיוסק (`/daily-table` ב-Fully Kiosk) יצר **death-spiral** אחרי דפלוי: `index.html` ישן בה-precache→`assets/index-<hash-ישן>.js` שנמחק→**404**→מודול הכניסה נכשל→`registerSW` ב-[main.jsx](src/main.jsx) לא רץ→ה-SW לא מתעדכן לבד→מסך לבן קבוע עד ניקוי ידני. עם network-first, מכשיר מחובר תמיד מביא index טרי. **שחזור מתקיעה קיימת = ניקוי cache ידני במכשיר פעם אחת** (Fully Kiosk: Clear Cache + Clear Web Storage + Restart, או Android Settings→Apps→Clear Data) — התיקון מונע **הישנות** אך לא משחרר מכשיר שכבר תקוע על ה-SW הישן. תמיכת offline נשמרת (fallback ל-precache). **המשך (hotfix `57b657b`, ישיר ל-main): `/daily-table` לעולם לא רושם SW** — `isKioskPage = pathname.startsWith('/daily-table')` ב-[main.jsx](src/main.jsx) → תמיד מסלול desktop (unregister SW + purge caches + reload-once), בלי קשר ל-User-Agent; `sw.js` מוסיף `NetworkOnly` ל-`/daily-table` כ-defense-in-depth. network-first לבדו לא שחרר קיוסק שכבר היה תקוע, אז בדף הזה פשוט לא רושמים SW בכלל. מובייל בדפים אחרים ממשיך לקבל PWA רגיל.
25. **חישוב זמינות ציוד = שיא-מקבילי (peak-concurrent), אסור לחזור ל-SUM** (PR #63). זמינות פריט מחושבת `workingUnits − MAX_concurrent_demand(בחלון הבקשה)`, **לא** `workingUnits − SUM(כל הביקוש החופף)`. שתי בקשות חוסמות בחלונות **זרים** (שלא חופפים זה-לזה) תופסות יחידה פיזית אחת בכל רגע (fungible) — סכימה מנפחה כשחלון הבקשה משתרע על כמה בקשות זרות (פריט 2-יח' עם 2 השאלות-יחידה זרות דּוּוח 0 זמין וחסם/דחה אישור). **הסימטריה מכוונת**: שתי בקשות ש**כן חופפות** בזמן על פריט 2-יח' → שיא=2 → `זמין: 0` = חוסר במלאי (בקשה שלישית חופפת נחסמת) — peak-concurrent **מקטין** רק את הניפוח של חלונות זרים, לא מרפה חסימה אמיתית (מוודא ב-smoke P3). התיקון בכל המשטחים: **קליינט** — helper יחיד `computeEquipmentAvailability` ב-[src/utils.js](src/utils.js) (סריקת peak על נק' ההתחלה); `getAvailable`/`getReservationApprovalConflicts`/`getEquipmentBlockingDetails` ([EditReservationModal.jsx](src/components/EditReservationModal.jsx)) הם wrappers דקים סביבו. **שרת** — `create_reservation_v2` (מיגרציה `20260701120000`) + `update_reservation_status_v1` (`20260701120100`) מחשבים `MAX(c)` על CTE `blk` במקום `SUM` (byte-for-byte, שומרים את **כל** ה-guards). **שתיהן הוחלו ב-dev וב-prod.** אגב התיקון: המודאל עבר מ-`total_quantity`→`workingUnits` ומ-`FAR_FUTURE`→חלון 48h ל-`באיחור` (עקבי עם `getAvailable`+לקח #5). Anti-regression: כל `CREATE OR REPLACE` של שתי ה-RPC חייב לשמר `MAX(c)` (לא `SUM`), סמנטיקת `tstzrange '[)'`, וכל ה-guards. טסט CI `run_availability_peak_tests` (3 תרחישים, מיגרציה `20260701120200`, **קורא ל-create_reservation_v2 האמיתי**) ב-`npm run test:db` → smoke **33/33**.

26. **ארכיון הפקות = `archived_at` מגובה-DB, אסור לחשב "הסתיימה" בקליינט** (PR #67). מצב הארכיון של הפקה נשמר ב-`productions.archived_at` (מקור אמת: `NULL`=פעילה / timestamp=מתי הסתיימה לראשונה), נגזר מ-`max(production_dates.end_date) < היום(Asia/Jerusalem)`, ומתוחזק **אך ורק** ע"י `productions_refresh_archive_v1(p_production_id?)` — שנקרא (א) post-save מהקליינט להפקה בודדת (ארכוב/שחזור מיידי, ב-[productionsApi.js](src/utils/productionsApi.js) `upsertProduction`), ו-(ב) cron יומי ([api/productions-archive.js](api/productions-archive.js)) לכל ה-`published`. הקליינט **קורא** `archivedAt` ולא מחשב "הסתיימה" בעצמו. `belongsToTab` ב-[ProductionsPage.jsx](src/components/ProductionsPage.jsx) מפצל לוח (`!archivedAt`) מול ארכיון (`archivedAt`); `archiveVisibleTo` מגביל את **הסטודנט** לחלון חודש (`ARCHIVE_STUDENT_WINDOW_MS`) בעוד צוות/ראש-מחלקה (`currentStudent=null`) רואים הכל. **הרשומה לעולם לא נמחקת** — "מחיקה מהארכיון של הסטודנט אחרי חודש" היא **view-filter** בלבד (הצוות שומר לתיעוד לתמיד). Anti-regression: (a) ה-RPC חייב לשמר `Asia/Jerusalem` (לא `current_date`), gate ל-`status='published'` (טיוטות לא מתארכבות), `COALESCE(old_at, now())` (re-save לא מאפס חלון-חודש), ו-`IS DISTINCT FROM` (דילוג no-op → אפס realtime churn); (b) ארכוב **לא משנה `status`** → RLS (`public_read_published`/`director_read_own`) ותצוגות אחרות עובדות, וה-`productions_director_overlap_trg` לא נורה (`AFTER UPDATE OF status, director_student_id` — `archived_at` לא ברשימה); (c) `production_delete_v1` (HARD delete) **לא נגעו בו**. **שחזור**: `ProductionEditor.validate()` עושה grandfather לתאריכי-עבר שלא-שונו (השוואה מול `initial.dates` לפי `id`+שדות) — בלעדיו כלל 8-הימים חוסם הוספת טווח עתידי להפקה שהסתיימה. **סינון חודשי** (`productionInMonth` + `scopeAll`): הלוח הפעיל מציג כברירת מחדל רק הפקות שטווחן חופף לחודש שבלוח-שנה; "ההפקות שלי" (הבמאי) **תמיד** גלוי ללא סינון; הארכיון לא מושפע מהסינון החודשי.

27. **פאנל "משימות להיום" ב-Staff Hub + תיקון קריאת סטטוס יחידות** (PR #68). **(א) הפאנל**: נטען **app-level** — `myToday`+`loadMyToday` ב-[App.jsx](src/App.jsx) (מתרענן כשמגיעים ל-hub, נשמר ב-state), מועבר כ-prop ל-[StaffHub.jsx](src/components/StaffHub.jsx) `TodayTasksPanel`; **אסור** לחזור ל-fetch פר-mount (גרם להבהוב טעינה בכל ניווט). כל הנתונים/כתיבות דרך `/api/staff-schedule` (`requireStaff`, staff_id מה-JWT, service-role) — 3 הטבלאות (`staff_personal_tasks`, `staff_hub_checkoffs`, ועמודת `reservation_staff_assignments.done`) הן **RLS-on ללא policies** (אין גישת-קליינט ישירה, כמו `staff_schedule_*`). מעקב-ביצוע: משימות אישיות + בקשות-השאלה עם עמודת `done` משלהן; משמרת-יום + הערות (מ-3 טבלאות ללא done) דרך טבלת check-off **מאוחדת** `staff_hub_checkoffs` (presence=בוצע, action `set-checkoff` upsert/delete). צ'קבוקסים **אופטימיים-בלבד** (setState מיידי, `refreshMyToday` רק על כישלון) — refetch פר-קליק גרם ל-lag. "היום" מחושב בשרת ב-`Asia/Jerusalem`. `reservation_staff_assignments.done` הוא **display-only** — לא נוגע בלוגיקת ההשאלות (כיבוד לקח #23). **(ב) תיקון קריאת סטטוס יחידות**: היחידות יושבות בטבלת בת `equipment_units`; קריאת `equipment` עם `select("*")` **לא** מושכת אותן → `eq.units=undefined` → `ensureUnits` ([App.jsx](src/App.jsx)) ממציא יחידות בברירת מחדל `status:"תקין"` ומוחק את הסטטוס האמיתי (הכתיבה תמיד עבדה — ה-RPC כותב `unit->>'status'`; רק הקריאה נשברה, לכן פגום/בתיקון/נעלם "חזרו לתקין" ולא הופיעו ב"ציוד בדיקה"). **Anti-regression: כל שאילתת `equipment` שמזינה state חייבת `select("*, units:equipment_units(*)")`** — תוקן ב-4 אתרים (load ראשוני, realtime refetch, סנכרון מלאי ציבורי, רענון מרצה). `ensureUnits` ממיין יחידות לפי הסיפרה שב-`id`.

28. **ייצוא PDF = דפוס browser-print, אסור להכניס ספריית PDF** (PR #69). כפתור "🖨️ ייצוא PDF" ב-`EquipmentPage` ([App.jsx](src/App.jsx) `exportEquipmentPdf`) מפיק רשימת ציוד אדפטיבית-לסינון. **המקור לרשימה חייב להיות `filtered` (App.jsx:1622) בקיבוץ `groupedCategories` (App.jsx:1795)** — אותו נגזר שהרשת במסך מרנדרת, כך שה-PDF תמיד תואם למה שרואים (אסור לייצא את `equipment` הגולמי או להעתיק לוגיקת סינון). **הטכניקה = browser-print בלבד**: מחרוזת `<html dir="rtl">` → `window.open` → `document.write` → `window.print()`, זהה ל-`exportPDF` ב-[ReservationsPage.jsx:380](src/components/ReservationsPage.jsx). זו **הדרך היחידה שעברית/RTL עובדות** בקוד הזה — הדפדפן מרנדר טקסט HTML רגיל, אין רסטריזציה/פונט מוטמע. **אסור להוסיף jsPDF/pdfmake/html2canvas** — הן שוברות עברית בלי font-embedding + bidi שלא קיימים בריפו. כל ערך מקלט-משתמש (שם ציוד/קטגוריה) חייב לעבור escaping (`esc`) לפני שרבוב ל-HTML (ל-`exportPDF` בהזמנות אין escape — לא להעתיק את החוסר הזה). guard ל-`window.open` שנחסם (popup blocker) → toast, לא קריסה שקטה. **code-only, אפס DB.**

29. **התנגשות חדרים בשיעורים = שיוך פר-מפגש, אסור fallback לרמת-קורס, ורק עתידי** (PR #71). פאנל "התנגשות עם קביעות חדרים" בעורך הקורס נגזר משיוך הכיתה של **כל מפגש בנפרד** (`session.studioIds[]` בטבלת לוח השיעורים) — **לא** משדות הכיתה הגלובליים של הקורס. השורש: `getEffectiveLessonStudioIds` ב-[lessonBookings.js](src/utils/lessonBookings.js) נפל ל-`getLessonCourseStudioIds(lesson)` כשמערך המפגש היה ריק, כך שמפגש שסומן "ללא שיוך" הצליב מול חדר ברירת-המחדל של הקורס וחסם שמירה. **התיקון**: מערך `studioIds` **מפורש** (גם ריק לגמרי) הוא מקור-האמת = "אין חדר", ו-fallback לרמת-הקורס חל **רק על מפגשי legacy בלי מערך כלל** (סקלר `studioId`/`secondaryStudioId` קודם, אז קורס). כדי שהתיקון יעבור גם ל-`buildLessonStudioBookings` (התצוגה הנגזרת שמאכלסת לוח ציבורי/`daily-table`/זמינות הזמנת אולפן), **`getLessonScheduleEntries` חייב לשמר את המערך הגולמי (עם הריקים) + השדות הסקלריים** — אחרת האריזה שמוחקת ריקים מוחקת את האות "מערך מפורש" ומחזירה את ה-fallback. תוצאה: מפגש "ללא שיוך" לא יוצר עוד **קביעת-רפאים** בחדר הקורס. **סינון עתידי בלבד**: כל 7 בודקי החפיפה (`findBookingConflicts`/`findLessonConflict`/`findAllLessonRoomConflicts`/`findRoomConflictInList` + `findLecturerConflict`/`findAllLessonLecturerConflicts`/`findLecturerConflictsAcross`) מדלגים על `session.date < today()`. **צוות+סטודנט**: ה-dedup ב-`findBookingConflicts` הוא לפי `booking.id` בלבד (לא חדר/סלוט) → קביעת-צוות וקביעת-סטודנט חופפות על אותו חדר מוצגות **שתיהן**. **Anti-regression**: אסור להחזיר fallback לרמת-קורס כשלמפגש יש מערך `studioIds`; אסור לארוז (drop-empties) את המערך ב-`getLessonScheduleEntries` לפני שהוא מגיע ל-getter; שיעורים לא persisted → אין אכיפת-DB, הכול בשכבת ה-JS המשותפת [lessonBookings.js](src/utils/lessonBookings.js).

30. **טבלת לוח השיעורים = גובה אדפטיבי, אסור `overflow` על מכולת הגוף** (PR #72). טבלת "לוח שיעורים" בעורך הקורס ([LessonsPage.jsx](src/components/LessonsPage.jsx)) מציגה את **כל** המפגשים בגובה מלא — **בלי `maxHeight`/scroll פנימי** (הדף עצמו גולל; הטופס יושב ב-`<div className="card">` בזרימת הדף, לא במודאל בגובה קבוע). ⚠️ **מלכודת CSS**: הגדרת `overflow-x:auto` בלבד על מכולת הגוף **מקדמת אוטומטית** את `overflow-y` ל-`auto` (מפרט CSS — `visible` מול `auto/scroll` אינו אפשרי) ומחזירה סרגל גלילה אנכי (בצד שמאל ב-RTL). לכן מכולת גוף הטבלה חייבת `display:flex;flexDirection:column` **בלי שום `overflow`**. מפגש שחלף (`session.date < today()`) מוצג אפור+`opacity:0.6`+tooltip; לחצן "💾 עדכן קורס" משוכפל לכותרת הטופס ליד "ביטול" (אותו `handleSave`) לשמירה בלי גלילה לתחתית. code-only, אפס DB.

31. **מולטי-תפקיד: דגלים נגזרים, מחיקת-צוות ≠ השמדת-משתמש, אין שדה סיסמה** (PR #73). ארבעה עקרונות: **(א) `is_student`/`is_lecturer` ב-`public.users` הם דגלים נגזרים** — מקור האמת הוא הטבלאות החיות (`students` לפי `email=eq.`, `lecturers` פעילים לפי `email=ilike.`). מסונכרנים ע"י `computeLiveRoleFlags`+`upsertPublicUserWithLiveFlags` ([api/auth.js](api/auth.js) — משותף ל-`ensure-user`+reset-email, בודק **כל** המקורות במקביל ועושה set+clear) + זיהוי drift בלוגין ב-`routeByRolesCore` ([PublicForm.jsx](src/components/PublicForm.jsx), קריאת שרת רק על אי-התאמה; מדולג בזמן role-switch — ביצועים). **אסור לחזור ל-first-match** (זה מה שהשאיר מרצה+סטודנט עם דגל אחד). `is_admin`/`is_warehouse` **אוטוריטטיביים** ב-users — לעולם לא מנוקים אוטומטית ע"י הסנכרון. **(ב) מחיקת איש צוות = הסרת-תפקיד, לא השמדה**: `handleDelete` ב-[api/staff.js](api/staff.js) בודק אם המייל עדיין סטודנט/מרצה-פעיל → אם כן, PATCH `is_admin/is_warehouse=false` בלבד (`downgraded:true`) — שורת users, ה-auth user והסיסמה **נשמרים**; מחיקה מלאה רק ליתום. **אסור למחוק auth user של מייל שרשום במקום כלשהו** — הבאג המקורי מחק את הסיסמה של סטודנט ששודרג-והוסר (מראה של אותו guard שכבר היה ב-`delete-student-auth` ב-api/auth.js). **(ג) אין שדה סיסמה בטפסי יצירה**: onboarding אחיד לכולם דרך "שכחת סיסמה?" — **אסור להחזיר `password` ל-create/invite ב-api/staff.js** (הוא דרס סיסמה קיימת של סטודנט ששודרג); יצירת auth היא `email_confirm:true` בלי password. מייל קיים ב-create → שדרוג-מיזוג (דגלי צוות OR, שאר הדגלים לא נגעים) במקום 409. **(ד) מעבר-תפקיד**: מנגנון `active_role` ב-sessionStorage + reload; `switching` state מציג "מעביר…" במקום הבהוב login; hint כושל → מנקים `active_role` ונופלים לעדיפות ברירת-מחדל (בלי dead-end). כרטיסי המעבר ב-StudentHub מותנים ב-`public_student_roles` (נכתב ב-`routeToStudent` מהשורה המסונכרנת).

32. **עורך הקורס דו-טורי + ברירת-מחדל תעודה + horizontal-only scroll** (PR #74, code-only). ארבעה חלקים ב-`LessonForm` ([LessonsPage.jsx](src/components/LessonsPage.jsx)) + guard במייל: **(א) פריסה דו-טורית** — הפאנלים עטופים ב-`display:grid` מותנה `isMobile` (`minmax(0,0.9fr) minmax(0,1.5fr)` בדסקטופ / `1fr` במובייל). **טור שמאל = לוח שיעורים בלבד** (רחב); **טור ימין = פרטי הקורס · שיוך כיתות · שליחת מייל · תעודת גמר**. **`minWidth:0` על שני הטורים קריטי** — בלעדיו `min-width:auto` של grid item גורם לטבלה הרחבה לדחוף את ה-card לרוחב-יתר. ה-modal "רשימת תלמידים" (`position:fixed`) חייב להישאר **מחוץ** ל-grid (רק 2 טורים). **(ב) ברירת-מחדל "ללא תעודה" ביצירת קורס** — ה-`useEffect` שגוזר `certificateTemplateType` מהמסלול חייב `if (!initial) return` בראשו: קורס **חדש** נשאר "ללא תעודה" עד בחירה ידנית; **edit mode ללא שינוי** (עדיין עוקב אחרי המסלול). **אסור להסיר את ה-gate** — בלעדיו בחירת מסלול דורסת מיד את "ללא תעודה". **(ג) מייל סיום-קורס מדולג לקורס ללא תעודה** — [api/notify-course-end-7days.js](api/notify-course-end-7days.js): `if (!String(lesson.certificateTemplateType||"").trim()) continue;` (קורס ללא תעודה לא מייצר תעודות → אין למרצה מה לסמן → לא נשלח מייל). **(ד) horizontal-only scroll — מלכודת CSS** (הרחבת לקח #30): עטיפת טבלת הדסקטופ **חייבת** `overflowX:"auto",overflowY:"hidden"` — `overflowX:"auto"` **לבדו** מקדם את `overflow-y` מ-`visible` ל-`auto` (כלל CSS: אי-אפשר ציר אחד `visible` והשני `auto`) ומחזיר סרגל אנכי דק. `overflowY:"hidden"` מפורש שובר את הקידום → אופקי בלבד כשהעמודות רחבות מהטור, אנכי לעולם לא. **אין `maxHeight`** (אחרת `hidden` יחתוך) — הדף עצמו גולל אנכית. מובייל (כרטיסים) לא מושפע.

> ⚠️ **השאלות-שיעור (`loan_type='שיעור'`) לעולם לא נסגרות אוטומטית**: `check-overdue.js` שורה ~115 מדלג עליהן (`return false`), אז הן נשארות `מאושר` לתמיד — **בתכנון**. הן צוברות כשורות `מאושר` בעבר אך **לא חוסמות בקשות עתידיות** (תאריכי עבר לא חופפים לעתיד). סריקת הקצאת-יתר "כל-הזמנים" עלולה להציג אותן כ-over-allocation היסטורי שאינו בעיה תפעולית.

---

## 🛡️ Guardrails חיים

- **ESLint** ([eslint.config.js](eslint.config.js)) חוסם: `storageGet`, `storageSet`, `supabase.from('store'...)`, `from('store_snapshots'...)`, `/api/store`. רמה=ERROR.
- **`no-undef` = ERROR** ([eslint.config.js](eslint.config.js), מ-PR #42) — מזהה בשימוש בלי import/הגדרה = **שגיאת build, ה-CI נכשל**. נוסף אחרי שהשבית את הפרוד import חסר של `formatTime` (PR #40). **חוק: כל `usage` חדש חייב `import` תואם באותו commit — אחרת ה-build ייפול. אל תוסיף `formatTime(...)`/helper בלי לוודא שהוא מיובא בקובץ.**
- **CI workflow** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) — `Lint & build` רץ על כל PR/push. `DB smoke (dev project)` רץ אם `SUPABASE_DEV_URL`/`SUPABASE_DEV_SERVICE_ROLE_KEY` מוגדרים ב-GitHub secrets (כרגע לא — הוא מדלג נקי).
- **Global Error Boundary** ([src/components/ErrorBoundary.jsx](src/components/ErrorBoundary.jsx)) — Hebrew/RTL fallback עוטף את `<App/>` ב-StrictMode.
- **DB smoke** (`npm run test:db`, [scripts/run-db-smoke.mjs](scripts/run-db-smoke.mjs)) — 33 scenarios: `run_reservation_overlap_tests` (13) + `run_productions_regression_tests` (6) + `run_student_overlap_tests` (5) + `run_studio_overlap_tests` (6) + `run_availability_peak_tests` (3 — peak-concurrent, קורא ל-`create_reservation_v2` האמיתי, PR #63). מסרב לרוץ אם ה-hostname לא `mhvujejdlmtowypjdhjd`. status נוכחי: **33/33 PASS**.

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

- **2026-07-12** — **PR #74** — **פריסה דו-טורית בעורך הקורס + ברירת מחדל תעודה + guard מייל סיום קורס** (code-only, אפס DB): (1) **פריסה דו-טורית** ב-`LessonForm` ([LessonsPage.jsx](src/components/LessonsPage.jsx)) לצמצום גלילה — `display:grid` מותנה `isMobile`, `minWidth:0` על הטורים; **טור שמאל = לוח שיעורים** (רחב), **טור ימין = פרטי הקורס · שיוך כיתות · שליחת מייל · תעודת גמר**; מובייל = טור יחיד. (2) **ברירת מחדל "ללא תעודה" ביצירת קורס** — ה-`useEffect` שגוזר תעודה מהמסלול מדולג ב-create mode (`if (!initial) return`); edit ללא שינוי. (3) **חסימת מייל סיום-קורס לקורס ללא תעודה** — [api/notify-course-end-7days.js](api/notify-course-end-7days.js) מדלג על `certificateTemplateType` ריק. (4) **גלילה אנכית בטבלת לוח השיעורים בוטלה** — עטיפה `overflowX:"auto",overflowY:"hidden"` (מונע קידום CSS של הציר האנכי ל-auto; אופקי בלבד כשהעמודות רחבות). ראה לקח #32.
- **2026-07-12** — **PR #73** — **ממשק מולטי-תפקיד ב-HUB + הוספת/הסרת איש צוות בטוחה** (code-only, אפס DB): (1) דגלי `is_student`/`is_lecturer` נגזרים מהטבלאות החיות — `computeLiveRoleFlags`+`upsertPublicUserWithLiveFlags` ([api/auth.js](api/auth.js), כל המקורות לא first-match, ensure-user+reset) + drift-detection בלוגין ([PublicForm.jsx](src/components/PublicForm.jsx)); (2) כרטיסי/לחצני מעבר-תפקיד בכל שלושת ה-HUB (צהוב `#f5a623`), מסך "מעביר…", hint-fallthrough; (3) הוספת איש צוות **ללא סיסמה** + שדרוג-מיזוג למייל קיים (במקום 409) + autocomplete מסטודנטים/מרצים + שם פרטי/משפחה ([StaffManagementPage.jsx](src/components/StaffManagementPage.jsx), [api/staff.js](api/staff.js)); (4) **תיקון קריטי**: מחיקת איש צוות = הסרת-תפקיד כשהמייל עדיין סטודנט/מרצה (auth+סיסמה נשמרים), מחיקה מלאה רק ליתום. ראה לקח #31.

- **2026-07-07** — **PR #72** — **שיפורי UI בעורך הקורס** (code-only): (1) **לוח שיעורים בגובה אדפטיבי** — הוסר ה-scroll הפנימי מטבלת המפגשים ([LessonsPage.jsx](src/components/LessonsPage.jsx), דסקטופ+מובייל); הטבלה גדלה עם מספר המפגשים והדף גולל. ⚠️ הסרת ה-overflow חייבת להיות מלאה — `overflow-x:auto` לבדו מקדם `overflow-y` ל-`auto` ומחזיר סרגל אנכי. (2) **הפרדת עבר/עתיד** — מפגש `date < today()` אפור+מעומעם+tooltip; עתידי סגול/בהיר. (3) **לחצן "💾 עדכן קורס" עליון** ליד "ביטול" (אותו `handleSave`) — שמירה בלי גלילה לתחתית. אפס DB · lint 0 · build נקי. ראה לקח #30.
- **2026-07-07** — **PR #71** — **תיקון פאנל התנגשות קביעות חדרים בעורך הקורס** (code-only): הפאנל "התנגשות עם קביעות חדרים" ([LessonsPage.jsx](src/components/LessonsPage.jsx)) הצליב מול כיתות הקורס הגלובליות במקום מול השיוך הפר-מפגש בטבלת לוח השיעורים → מפגש "ללא שיוך"/חדר-אחר חסם שמירה שגויה. תוקן בשכבת-הנתונים ([lessonBookings.js](src/utils/lessonBookings.js)): `getEffectiveLessonStudioIds` מכבד מערך `studioIds` מפורש (ריק=אין חדר, בלי fallback לקורס; legacy בלבד נופל לסקלר→קורס) + `getLessonScheduleEntries` משמר את המערך הגולמי/סקלרים כך ש-`buildLessonStudioBookings` מפסיק לייצר קביעת-רפאים. **+ סינון עתידי** ב-7 בודקי החפיפה (4 חדרים + 3 מרצים, `session.date < today()`). צוות+סטודנט חופפים על אותו חדר → שתי הקביעות מוצגות. אפס DB · lint 0 · build נקי. ראה לקח #29.
- **2026-07-07** — **PR #69** — **כפתור ייצוא PDF לרשימת הציוד המסוננת (תפעול מחסן)** (code-only): כפתור "🖨️ ייצוא PDF" בטולבר של תפעול מחסן → ציוד (סאב-תצוגה "active") שמפיק PDF של רשימת הציוד המוצגת — משקף בדיוק את הסינון הפעיל (קטגוריה/חיפוש/סוג), מקובץ לפי קטגוריה. `exportEquipmentPdf` ב-[App.jsx](src/App.jsx) `EquipmentPage` מרנדר את `filtered` בקיבוץ `groupedCategories` (אותו מקור שהמסך מציג). דפוס browser-print (HTML `dir=rtl` → `window.open` → `window.print()`), Hebrew/RTL-safe, זהה ל-`exportPDF` ב-[ReservationsPage.jsx](src/components/ReservationsPage.jsx) — **אין ספריית PDF**. תוכן מינימלי (שם+כמות), escaping מפני הזרקה, toast כשריק/חלון חסום. אפס DB · lint 0 · build נקי. ראה לקח #28.
- **2026-07-06** — **PR #68** — **פאנל "משימות להיום" ב-Staff Hub (מגובה-DB) + תיקון קריאת סטטוס יחידות ציוד**: פאנל מתקפל לכל עובד ב-Staff Hub — משמרת היום, בקשות השאלה שהוא מטפל בהן (out/return+שעות), הערת מנהל, ההערה שלו, משימות ידניות (≤150). צ'קבוקס ביצוע לכל פריט (משימות/בקשות עם `done` משלהן; משמרת+הערות דרך `staff_hub_checkoffs`). 3 מיגרציות (staff_personal_tasks, rsa.done, staff_hub_checkoffs — RLS-on ללא policies, **הוחלו ב-dev וב-prod**), 6 actions ב-[api/staff-schedule.js](api/staff-schedule.js), טעינה app-level ([App.jsx](src/App.jsx) `myToday`), מובייל/PWA. **+ תיקון באג**: סטטוס יחידות (פגום/בתיקון/נעלם) חזר ל"תקין" — הקריאה שלפה `equipment` בלי `equipment_units`; תוקן ע"י join `units:equipment_units(*)` ב-4 אתרים (code-only). smoke 33/33. ראה לקח #27.
- **2026-07-05** — **PR #67** — **ארכיון להפקות שהסתיימו (מגובה-DB) + עיצוב אפור + סינון חודשי**: הפקה "מסתיימת" כשהתאריך האחרון (`max(end_date)`) עובר → עוברת לתצוגת **"ארכיון"** (מתג בלוח ההפקות, ב-3 המסכים). עמודת `productions.archived_at` (מיגרציה `20260705120000`, **הוחלה ב-dev; prod לפני merge**) + RPC `productions_refresh_archive_v1` (Asia/Jerusalem, gate ל-`published`, `COALESCE` שומר זמן-ארכוב, no-op skip) + backfill + **cron יומי** [api/productions-archive.js](api/productions-archive.js). קליינט: `archivedAt` ל-blob + refresh post-save (ארכוב/שחזור מיידי); `belongsToTab` על כרטיסים+לוח-שנה; **סטודנט=ארכיון חודש, צוות/ראש-מחלקה=לתמיד — הרשומה לעולם לא נמחקת**; הפקה שהסתיימה באפור (`ARCHIVED_COLOR`) + badge "ההפקה הסתיימה"; **סינון חודשי** (`productionInMonth`+`scopeAll`) עם "ההפקות שלי" תמיד גלוי; `ProductionEditor.validate()` grandfather לתאריכי-עבר → שחזור ע"י תאריך עתידי. DB: backfill/idempotent/round-trip-שחזור אומתו, smoke **33/33**. ראה לקח #26.
- **2026-07-05** — **PR #66** — **לחצני תפעול בראש מודאל הבקשה + קטגוריות/תמונות בערכה** (code-only): לחצני אשר/דחה/עריכה/PDF/מחק/סגור הועברו ל**ראש** מודאל התצוגה ([ReservationsPage.jsx](src/components/ReservationsPage.jsx)) — נגישים בלי גלילה; רשימת הציוד בערכה ([App.jsx](src/App.jsx) `KitsPage`) מקובצת לפי קטגוריה + תמונות 32px.
- **2026-07-01** — **PR #63** — **חישוב זמינות ציוד לפי שיא-מקבילי במקום סכימה**: הזמינות חושבה `workingUnits − SUM(כל הביקוש החופף)` במקום `workingUnits − MAX_concurrent(בחלון)`. שתי בקשות חוסמות בחלונות זרים (לא חופפות זו-לזו) שנפלו בתוך חלון בקשה אחד נספרו פעמיים → פריט 2-יח' הוצג `זמין: 0` וחסם/דחה אישור (`approve_overbook`). תוקן בכל המשטחים: **קליינט** — helper `computeEquipmentAvailability` ([src/utils.js](src/utils.js)) + wrappers (`getAvailable`/`getReservationApprovalConflicts`/`getEquipmentBlockingDetails`); **שרת** — `create_reservation_v2` (`20260701120000`) + `update_reservation_status_v1` (`20260701120100`) → `MAX(c)` במקום `SUM`, byte-for-byte עם כל ה-guards. **שתי המיגרציות + טסט `run_availability_peak_tests` (`20260701120200`, 3 תרחישים) הוחלו ב-dev וב-prod; smoke 30→33.** אגב: המודאל עבר ל-`workingUnits`+חלון 48h. ראה לקח #25. **בנוסף — hotfix `57b657b` (ישיר ל-main, 29/06): `/daily-table` לעולם לא רושם SW** (unregister+purge בכל טעינה, `NetworkOnly` ל-`sw.js`) — ריפוי-עצמי לקיוסק תקוע; ראה לקח #24.
- **2026-06-29** — **PR #61** — **ניווט network-first ב-Service Worker — מניעת מסך לבן בקיוסק** (code-only): `NavigationRoute` ב-[src/sw.js](src/sw.js) עבר מ-cache-first (`createHandlerBoundToURL`) ל-**`NetworkFirst`** (`networkTimeoutSeconds: 5`) + `PrecacheFallbackPlugin`→`index.html`. סוגר death-spiral של `/daily-table` ב-Fully Kiosk (index ישן בה-precache→chunk 404→`registerSW` לא רץ→SW לא מתעדכן→מסך לבן). מכשיר מחובר תמיד מביא index טרי; offline נופל ל-precache. אבחנה: הפרוד היה תקין לחלוטין (HTML/JS 200, deploy READY) — התקלה לוקלית בקיוסק. ראה לקח #24.
- **2026-06-29** — **PR #60** — **תיקונים אסתטיים נקודתיים** (code-only): (1) "לא משויך"/"לא שויך" באדום מודגש (`#ef4444`) בלוז העובדים — שיוך כיתה ([StaffSchedulePage.jsx](src/components/StaffSchedulePage.jsx) כרטיס+טבלה) ואיש-צוות-מטפל בבקשות ההשאלה (`LoanChip`+מודאל פרטים); (2) סידור פאנלים בטופס יצירת/עריכת קורס ([LessonsPage.jsx](src/components/LessonsPage.jsx)) — "לוח שיעורים" הועבר אל מתחת ל"שיוך כיתות לימוד" (פרטי הקורס→שיוך כיתות→לוח שיעורים). שינוי סדר/צבע בלבד, אפס שינוי לוגי.
- **2026-06-28** — **PR #58** — **שיוך איש צוות מטפל לבקשת השאלה (תיאום פנימי, מנותק לחלוטין)**: טבלת-צד `reservation_staff_assignments` (מיגרציה `20260628120000`, **הוחלה ב-dev וב-prod**) — FK חד-כיווני `ON DELETE CASCADE`, `kind` out/return, `UNIQUE(reservation_id,kind)`, RLS read-all/service-write, realtime. 2 actions ב-`api/staff-schedule.js` (`assign/unassign-loan-handler`) + `loanHandlers` ב-App.jsx + UI בלוז עובדים (תת-רובריקות "תפעול כללי"/"בקשות השאלה", 🔧) ותצוגת מחסן read-only (ReservationsPage + DashboardPage). **אפס שינוי ב-RPC/סטטוסים/נתיב כתיבת ההשאלה — בקשה זורמת בכל הסטטוסים גם בלי אף אחראי.** ראה לקח #23.
- **2026-06-28** — **PR #57** — **שיפורי פאנל ולוח שיבוץ עובדים** (`StaffSchedulePage.jsx`, code-only): מולטי-עובד draft-buffer + Save יחיד, פאנל מנהל גלובלי, ברירת מחדל ללא משמרת, DESELECT, נעילה צבעונית (Lock), טעינת העדפת עובד + צ'יפ כחול+עיגול, "עריכה אחרונה מנצחת אלא אם נעול", סינון משימות לפי תאימות משמרת. + **docs(claude)**: ברירת מחדל לזרימת מחשב (localhost-first) + חובת שאלת "נייד/מחשב" בתחילת שיחה.
- **2026-06-25** — **PR #55** — **guard אטומי נגד הקצאת-יתר באישור + שמירת עריכות בעת אישור**: `update_reservation_status_v1` קיבל בדיקת זמינות בצד-שרת (מיגרציה `20260625120000`, הוחלה ב-dev וב-prod) — `FOR UPDATE` + `healthy − overlapping_blocking_demand (ללא self) ≥ qty` במעבר לתוך `מאושר`, אחרת `approve_overbook`→409. סוגר את ה-TOCTOU race של אישור כפול על state מיושן (קודם client-only). + כפתור "אשר והעבר למאושר" שומר קודם את עריכות הפריטים/שעות ([ReservationsPage.jsx](src/components/ReservationsPage.jsx) `saveEditedReservation` עם `{silent}`+boolean) ורק אז מאשר — תיקון לבאג trim-ואז-אישור שמחק עריכות. ראה לקח #22.
- **2026-06-25** — **PR #54** — docs: רענון CLAUDE.md ל-PR #50–#53 (הגבלת השאלת-חוץ).
- **2026-06-25** — **PR #53** — דיוק טקסט בהסבר הגבלת השאלת-חוץ ב-`UnitsModal`: "קולנוע" → "קולנוע יומית" ([App.jsx](src/App.jsx), שורה אחת).
- **2026-06-25** — **PR #52** — ליטוש UX להגבלת השאלת-חוץ ([App.jsx](src/App.jsx) `UnitsModal`): **auto-sync דו-כיווני** בין "הגבל את כל היחידות" לשדה ה-N (N≥units→restrictAll; ביטול restrictAll→N=0; restrictAll מציג units.length בשדה) + הבהרת טקסט ההסבר.
- **2026-06-23** — **PR #51** — **הגבלת השאלת-חוץ של ציוד**: 2 עמודות על `equipment` (`external_loan_restricted` + `external_loan_hold_count`, מיגרציה `20260623120000`) + guard רביעי ב-`create_reservation_v2` (`20260623120200`, byte-for-byte על `20260613153000`) + `sync_equipment_from_json` ממראה את העמודות (`20260623120100`) + UI בפאנל היחידות + הסתרה ב-PublicForm step 3 + chips בכרטיס + מיפוי שגיאה `external_restricted`→409. בנוסף: `privateLoanUnlimited` הועבר מרמת-קטגוריה לרמת-פריט (toggle ב-`EqForm`). **כל 3 המיגרציות הוחלו ב-dev וב-prod.** ראה סעיף "🚫 הגבלת השאלת-חוץ" + לקח #21.
- **2026-06-21** — **PR #50** — docs: רענון CLAUDE.md ל-PR #48–#49 (studio overlap guard + lessons editor UI).
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
