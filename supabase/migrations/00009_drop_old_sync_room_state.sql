-- Drop the old, vulnerable version of sync_room_state 
-- It lacked row-level locks (deadlock risk) and missed the search_path security lint.
DROP FUNCTION IF EXISTS public.sync_room_state(uuid, text, jsonb, text, jsonb, jsonb, integer);
