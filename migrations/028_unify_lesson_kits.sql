-- 028_unify_lesson_kits.sql
--
-- Converts lesson kits (kit.kitType='lesson') into regular kits tagged by
-- loanTypes=['שיעור']. Lesson↔kit association moves fully to lesson.kitId (+
-- the existing per-session lesson.schedule[i].kitId). Old-style kit.lessonId
-- orphans are migrated into lesson.kitId where the target lesson doesn't
-- already have one.
--
-- Data model change: loanType (string) → loanTypes (JSONB array).
-- All existing kits with a non-empty loanType string are converted to a
-- single-element loanTypes array. kitType='lesson' kits get loanTypes=['שיעור'].
--
-- Backup: the store_shrink_guard trigger will produce a store_snapshots row
-- automatically before the kits update lands.

begin;

-- 1) Capture current kits into a snapshot we can reference for the lessons
--    second step (otherwise we'd lose kit.lessonId after step 2). Using a
--    temp table so we do NOT create a store row (that would persist).
create temp table _kits_pre_028 on commit drop as
  select data as kits_data from store where key = 'kits';

-- 2) Propagate orphan kit.lessonId → lesson.kitId (only when the target
--    lesson doesn't already have a kitId).
update store s
set data = (
  select jsonb_agg(
    case
      when (lesson->>'kitId') is null or (lesson->>'kitId') = ''
      then lesson
           || jsonb_build_object(
             'kitId',
             coalesce(
               (
                 select kit->>'id'
                 from (select jsonb_array_elements(kits_data) as kit from _kits_pre_028) src
                 where (src.kit->>'kitType') = 'lesson'
                   and (src.kit->>'lessonId') = (lesson->>'id')
                 limit 1
               ),
               lesson->>'kitId'
             )
           )
      else lesson
    end
  )
  from jsonb_array_elements(s.data) as lesson
)
where s.key = 'lessons';

-- 3) Convert kits:
--    - Remove kitType, lessonId, instructorName, instructorPhone, instructorEmail, schedule
--    - Rename loanType (string) → loanTypes (array): lesson kits get ['שיעור'],
--      student kits with a non-empty loanType get [loanType], others get [].
update store
set data = (
  select jsonb_agg(
    case
      when (kit->>'kitType') = 'lesson'
      then (kit - 'kitType' - 'lessonId' - 'loanType' - 'instructorName' - 'instructorPhone' - 'instructorEmail' - 'schedule')
           || jsonb_build_object('loanTypes', jsonb_build_array('שיעור'))
      when (kit->>'loanType') is not null and (kit->>'loanType') <> ''
      then (kit - 'kitType' - 'lessonId' - 'loanType' - 'instructorName' - 'instructorPhone' - 'instructorEmail' - 'schedule')
           || jsonb_build_object('loanTypes', jsonb_build_array(kit->>'loanType'))
      else (kit - 'kitType' - 'lessonId' - 'loanType' - 'instructorName' - 'instructorPhone' - 'instructorEmail' - 'schedule')
           || jsonb_build_object('loanTypes', '[]'::jsonb)
    end
  )
  from jsonb_array_elements(data) as kit
)
where key = 'kits';

commit;
