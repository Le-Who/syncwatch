DROP INDEX IF EXISTS public.idx_playback_snapshots_media_item_id;

DROP POLICY IF EXISTS "Allow full access to rooms" ON public.rooms;
DROP POLICY IF EXISTS "Allow full access to room_members" ON public.room_members;
DROP POLICY IF EXISTS "Allow full access to playlist_items" ON public.playlist_items;
DROP POLICY IF EXISTS "Allow full access to playback_snapshots" ON public.playback_snapshots;
DROP POLICY IF EXISTS "Allow full access to activity_log" ON public.activity_log;

CREATE OR REPLACE FUNCTION public.sync_room_state(room_data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_room_id uuid;
  v_owner_id uuid;
  v_item jsonb;
  v_index integer := 0;
BEGIN
  v_room_id := (room_data->>'id')::uuid;
  v_owner_id := (room_data->>'owner_id')::uuid;

  PERFORM 1 FROM public.rooms WHERE id = v_room_id FOR UPDATE;

  INSERT INTO public.rooms (id, name, settings, owner_id)
  VALUES (
    v_room_id,
    room_data->>'name',
    room_data->'settings',
    v_owner_id
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    settings = EXCLUDED.settings,
    owner_id = EXCLUDED.owner_id;

  DELETE FROM public.playlist_items
  WHERE room_id = v_room_id
  AND id NOT IN (
    SELECT (jsonb_array_elements(room_data->'playlist')->>'id')::uuid
  );

  INSERT INTO public.playlist_items (
    id, room_id, url, provider, title, duration, added_by, position, last_position, thumbnail_url
  )
  SELECT 
    (item->>'id')::uuid,
    v_room_id,
    item->>'url',
    item->>'provider',
    item->>'title',
    (item->>'duration')::integer,
    item->>'addedBy',
    idx - 1,
    COALESCE((item->>'lastPosition')::numeric, 0),
    item->>'thumbnail'
  FROM jsonb_array_elements(room_data->'playlist') WITH ORDINALITY arr(item, idx)
  ON CONFLICT (id) DO UPDATE SET
    position = EXCLUDED.position,
    last_position = EXCLUDED.last_position;

  INSERT INTO public.playback_snapshots (
    room_id, media_item_id, status, base_position, base_timestamp, rate, version, updated_by, updated_at
  )
  VALUES (
    v_room_id,
    (room_data->'playback'->>'mediaItemId')::uuid,
    room_data->'playback'->>'status',
    (room_data->'playback'->>'basePosition')::numeric,
    (room_data->'playback'->>'baseTimestamp')::bigint,
    (room_data->'playback'->>'rate')::numeric,
    (room_data->>'version')::integer,
    room_data->'playback'->>'updatedBy',
    NOW()
  )
  ON CONFLICT (room_id) DO UPDATE SET
    media_item_id = EXCLUDED.media_item_id,
    status = EXCLUDED.status,
    base_position = EXCLUDED.base_position,
    base_timestamp = EXCLUDED.base_timestamp,
    rate = EXCLUDED.rate,
    version = EXCLUDED.version,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at;

END;
$$;
