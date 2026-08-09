// nightChecklist.js — the 26 closing tasks students work through at the end of
// a night session, in order.
//
// ⚠️ MUST STAY DEPENDENCY-FREE.
// api/night-training.js imports CHECKLIST_ITEM_COUNT and CHECKLIST_VERSION from
// here so the recorded totals are server-authoritative. Importing src/utils.js
// (or anything reaching supabaseClient.js) would drag import.meta and the
// browser Supabase client into the serverless bundle — the same constraint that
// governs announcementPolicy.js and loanPolicy.js (lesson #40).
//
// WHY `parts` AND NOT A PLAIN STRING
// ----------------------------------
// The source app emphasised warnings with inline <span class="warn">…</span>
// and injected them via innerHTML. Rendering that here would mean
// dangerouslySetInnerHTML, which lesson #43 rules out for body text shown to
// the whole college. Each task is therefore a list of segments; a segment with
// warn:true is the emphasised run. The renderer maps parts to <span>s — no HTML
// parsing anywhere. run-night-quiz-tests.mjs asserts no segment contains < or >.

// Bump when the task list changes, so a stored completion says which list it was.
export const CHECKLIST_VERSION = 1;

export const CHECKLIST_ITEMS = [
  { id: 1, parts: [
      { text: "סדרו את הציוד בחדר שהוגדר ע\"י המדריך התורן — מיקרופונים באריזות המקוריות שלהם." },
  ] },
  { id: 2, parts: [
      { text: "גלגלו ומיינו כבלים לפי סוגים, מונחים אחד לצד השני (לא אחד על השני)." },
  ] },
  { id: 3, parts: [
      { text: "גלגלו בעדינות את כבלי האוזניות כדי שלא יפרמו." },
  ] },
  { id: 4, parts: [
      { text: "אם לקחתם כיסא מחדר אחר — החזירו אותו למקומו." },
  ] },
  { id: 5, parts: [
      { text: "ודאו שהחדר והמסדרון נשארים מסודרים ונקיים." },
  ] },
  { id: 6, parts: [
      { text: "נעלו את החדר לאחר סידור הציוד." },
  ] },
  { id: 7, parts: [
      { text: "כבו את כל המזגנים בחדרים שהשתמשתם בהם." },
  ] },
  { id: 8, parts: [
      { text: "כבו את כל עמדות הסאונד הפעילות." },
  ] },
  { id: 9, parts: [
      { text: "כבו את התאורה בתוך החדרים שתרגלתם בהם " },
      { text: "(⚠️ לא במסדרון ולא בסטודיו הגדול)", warn: true },
      { text: "." },
  ] },
  { id: 10, parts: [
      { text: "כבו את החשמל הראשי של העמדה בה עבדתם." },
  ] },
  { id: 11, parts: [
      { text: "היכנסו לסטודיו הגדול וצלמו וידאו של 3 הבריחים כשהם נעולים, ושה\"פס ברזל השחור\" מונח כראוי." },
  ] },
  { id: 12, parts: [
      { text: "בדקו ש\"כנף הדלת\" הימנית בסטודיו הגדול במצב נכון." },
  ] },
  { id: 13, parts: [
      { text: "צלמו את שלט המזגן בסטודיו כאשר המזגן כבוי." },
  ] },
  { id: 14, parts: [
      { text: "צלמו וידאו של נעילת דלת הסטודיו הגדול, ולאחר הנעילה דחפו את הדלת כדי לוודא שהיא נעולה טוב." },
  ] },
  { id: 15, parts: [
      { text: "צלמו וידאו של דלת החירום שמעל הקפיטריה — נעולה, טרוקה, עם ה\"פס ברזל השחור\" במקום הנכון." },
  ] },
  { id: 16, parts: [
      { text: "צלמו וידאו של הבריח של המעלית." },
  ] },
  { id: 17, parts: [
      { text: "ודאו שכל שאר הדלתות בבית הספר טרוקות ונעולות, ושלא נעל אף אחד בטעות בחדר או בשירותים." },
  ] },
  { id: 18, parts: [
      { text: "ודאו שהציוד האישי שלכם איתכם (מפתחות בית, פלאפון, תיקים/ארנקים, כוננים ניידים)." },
  ] },
  { id: 19, parts: [
      { text: "קראו את דף ההדגשים התלוי על דלת המטבח וודאו שמילאתם את כל המשימות הרשומות בו." },
  ] },
  { id: 20, parts: [
      { text: "הקישו את קוד האזעקה בפאנל — תתחיל ספירה לאחור מלווה בצפצוף, " },
      { text: "יש לכם 180 שניות (3 דקות) לצאת", warn: true },
      { text: " מגבולות בית הספר." },
  ] },
  { id: 21, parts: [
      { text: "עלו בזהירות וצלמו וידאו של נעילת דלת היציאה החומה." },
  ] },
  { id: 22, parts: [
      { text: "נתקו את המפתח שסוגר את דלת הבניין הראשית, " },
      { text: "ורק לאחר מכן", warn: true },
      { text: " זרקו אותו לצינור. צלמו וידאו של השלכת המפתח לצינור (כך שיראו בסרטון שהמפתח אכן נפל ולא נשאר בצינור). אם המפתח נתקע — דחפו אותו במוט האלומיניום המחובר לדלת בעזרת החבל השחור." },
  ] },
  { id: 23, parts: [
      { text: "צלמו את נעילת דלת הכניסה לבניין." },
  ] },
  { id: 24, parts: [
      { text: "צלמו את הכנסת מפתח הכניסה לבניין לתוך הכספת." },
  ] },
  { id: 25, parts: [
      { text: "אם אתם לא האחרונים לצאת: שלחו למדריך התורן הודעת \"יצאתי\"." },
  ] },
  { id: 26, parts: [
      { text: "אם אתם כן האחרונים לצאת ואתם נועלים: שלחו את כל הסרטונים למדריך התורן — " },
      { text: "תוך 3 דקות בלבד", warn: true },
      { text: " ממועד הנחת המפתח בכספת. " },
      { text: "⚠️ אין לשלוח את הסרטונים לפני שיצאתם/נעלתם בפועל.", warn: true },
  ] },
];

export const CHECKLIST_ITEM_COUNT = CHECKLIST_ITEMS.length;
