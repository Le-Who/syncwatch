-- Explicitly set the search_path to an empty string to satisfy the Supabase Linter (0011_function_search_path_mutable)
ALTER FUNCTION public.sync_room_state(jsonb) SET search_path = '';
