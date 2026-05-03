-- 20260503140000_realtime_publication_for_reservations.sql
--
-- PURPOSE:
--   Add public.reservations_new + public.reservation_items to the
--   supabase_realtime publication so INSERT/UPDATE/DELETE on those tables
--   broadcast postgres_changes events to every connected client.
--
-- THE BUG THIS FIXES:
--   When a warehouse admin deleted a reservation in the "בקשות" page, the
--   delete persisted to the DB correctly (delete_reservation_v1 RPC), but
--   other concurrently-open sessions — the lecturer portal, the public
--   form's mini-calendar, a second admin tab — kept showing the deleted
--   row until their next poll fired (15s for admin, 60s for lecturer).
--
--   In the worst case, a dept-head lecturer could click "approve" on a
--   stale row that no longer existed: the RPC correctly returned 404, but
--   the UI showed a generic error and the row stayed visible until the
--   next poll, making it look like delete + approve created a ghost
--   reservation.
--
-- WHY IT WAS BROKEN:
--   The legacy realtime channel (App.jsx "store-live-sync") subscribed to
--   public.store, but Stage 13 (migration 20260430220000) dropped that
--   table. So no client received realtime events for reservations at all.
--   Adding reservations_new + reservation_items to the publication is the
--   prerequisite for App.jsx to subscribe directly to those tables.
--
-- IDEMPOTENCY:
--   ALTER PUBLICATION ... ADD TABLE errors if the table is already in the
--   publication. Wrap in IF NOT EXISTS lookups against pg_publication_tables.
--
-- RLS:
--   Realtime respects RLS on the source table — clients only receive events
--   for rows they could SELECT. reservations_new already grants SELECT to
--   authenticated and anon (migration 021_anon_read_tracks_and_cert_types
--   chain), so all the relevant clients will receive events.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'reservations_new'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations_new;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'reservation_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reservation_items;
  END IF;
END$$;
