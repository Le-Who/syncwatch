-- 1. Explicitly suppress the RLS linter warnings by defining strict DENY policies
-- This formally documents our Server-Authoritative (Service Role) architecture
DROP POLICY IF EXISTS "Strict Deny All public access" ON public.rooms;
CREATE POLICY "Strict Deny All public access" ON public.rooms FOR ALL USING (false);

DROP POLICY IF EXISTS "Strict Deny All public access" ON public.room_members;
CREATE POLICY "Strict Deny All public access" ON public.room_members FOR ALL USING (false);

DROP POLICY IF EXISTS "Strict Deny All public access" ON public.playlist_items;
CREATE POLICY "Strict Deny All public access" ON public.playlist_items FOR ALL USING (false);

DROP POLICY IF EXISTS "Strict Deny All public access" ON public.playback_snapshots;
CREATE POLICY "Strict Deny All public access" ON public.playback_snapshots FOR ALL USING (false);

DROP POLICY IF EXISTS "Strict Deny All public access" ON public.activity_log;
CREATE POLICY "Strict Deny All public access" ON public.activity_log FOR ALL USING (false);

-- 2. Resolve: Function Search Path Mutable for SECURITY DEFINER
-- Setting to 'public' explicit schema to satisfy the Supabase Linter 
ALTER FUNCTION public.sync_room_state(jsonb) SET search_path = public;
