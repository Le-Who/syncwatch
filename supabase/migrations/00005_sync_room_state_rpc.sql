-- Migration to create sync_room_state RPC for atomic room updates

CREATE OR REPLACE FUNCTION sync_room_state(room_data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room_id uuid;
  v_owner_id uuid;
  v_item jsonb;
  v_index integer := 0;
BEGIN
  v_room_id := (room_data->>'id')::uuid;
  v_owner_id := (room_data->>'owner_id')::uuid;

  -- 1. Upsert Room
  INSERT INTO rooms (id, name, settings, owner_id)
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

  -- 2. Sync Playlist (Delete missing, Upsert existing/new)
  -- Delete items not in the new playlist
  DELETE FROM playlist_items
  WHERE room_id = v_room_id
  AND id NOT IN (
    SELECT (jsonb_array_elements(room_data->'playlist')->>'id')::uuid
  );

  -- Upsert items
  FOR v_item IN SELECT * FROM jsonb_array_elements(room_data->'playlist')
  LOOP
    INSERT INTO playlist_items (
      id, room_id, url, provider, title, duration, added_by, position, last_position, thumbnail
    )
    VALUES (
      (v_item->>'id')::uuid,
      v_room_id,
      v_item->>'url',
      v_item->>'provider',
      v_item->>'title',
      (v_item->>'duration')::integer,
      v_item->>'addedBy',
      v_index,
      COALESCE((v_item->>'lastPosition')::numeric, 0),
      v_item->>'thumbnail'
    )
    ON CONFLICT (id) DO UPDATE SET
      position = EXCLUDED.position,
      last_position = EXCLUDED.last_position;
      
    v_index := v_index + 1;
  END LOOP;

  -- 3. Sync Playback Snapshot
  INSERT INTO playback_snapshots (
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
