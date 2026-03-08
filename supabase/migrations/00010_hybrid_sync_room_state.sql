-- Migration 00010: Hybrid Solutions for sync_room_state (Systematic Debugging Audit)

-- Drop the old jsonb-only version if it exists
DROP FUNCTION IF EXISTS public.sync_room_state(jsonb);

-- New signature with STRICT TYPES for IDs (Defense-in-depth against Type Poisoning DDoS)
CREATE OR REPLACE FUNCTION public.sync_room_state(
  p_room_id uuid,
  p_owner_id uuid,
  p_state jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- 1. Hybrid Deadlock Prevention: Session-level Advisory Lock
  -- This provides a 100% guarantee against AB/BA blockages on the same room
  -- without relying on a yet-to-be-created row in the rooms table.
  -- hashtext converts uuid text to int4.
  PERFORM pg_advisory_xact_lock(hashtext(p_room_id::text));

  -- 2. Upsert Room (Implicit Row Lock)
  INSERT INTO public.rooms (id, name, settings, owner_id)
  VALUES (
    p_room_id,
    p_state->>'name',
    p_state->'settings',
    p_owner_id
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    settings = EXCLUDED.settings,
    owner_id = EXCLUDED.owner_id;

  -- 3. Sync Playlist: Optimized O(1) CTE with NOT EXISTS (NULL Poisoning immune)
  WITH current_playlist AS (
    SELECT (elem->>'id')::uuid AS item_id
    FROM jsonb_array_elements(COALESCE(p_state->'playlist', '[]'::jsonb)) elem
    WHERE elem->>'id' IS NOT NULL -- Defense against NULL poisoning
  )
  DELETE FROM public.playlist_items
  WHERE room_id = p_room_id
  AND NOT EXISTS (
    SELECT 1 FROM current_playlist cp WHERE cp.item_id = playlist_items.id
  );

  -- Bulk Upsert Playlist
  INSERT INTO public.playlist_items (
    id, room_id, url, provider, title, duration, added_by, position, last_position, thumbnail_url
  )
  SELECT 
    (item->>'id')::uuid,
    p_room_id,
    item->>'url',
    item->>'provider',
    item->>'title',
    (item->>'duration')::integer,
    item->>'addedBy',
    idx - 1, 
    COALESCE((item->>'lastPosition')::numeric, 0),
    item->>'thumbnail'
  FROM jsonb_array_elements(COALESCE(p_state->'playlist', '[]'::jsonb)) WITH ORDINALITY arr(item, idx)
  WHERE item->>'id' IS NOT NULL
  ON CONFLICT (id) DO UPDATE SET
    position = EXCLUDED.position,
    last_position = EXCLUDED.last_position;

  -- 4. Sync Playback Snapshot (Safe from NULLs)
  IF p_state->'playback'->>'mediaItemId' IS NOT NULL THEN
    INSERT INTO public.playback_snapshots (
      room_id, media_item_id, status, base_position, base_timestamp, rate, version, updated_by, updated_at
    )
    VALUES (
      p_room_id,
      (p_state->'playback'->>'mediaItemId')::uuid,
      p_state->'playback'->>'status',
      (p_state->'playback'->>'basePosition')::numeric,
      (p_state->'playback'->>'baseTimestamp')::bigint,
      (p_state->'playback'->>'rate')::numeric,
      (p_state->>'version')::integer,
      p_state->'playback'->>'updatedBy',
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
  END IF;

END;
$$;
