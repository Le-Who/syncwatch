-- Durable canonical snapshot, with relational compatibility retained atomically.
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS state jsonb;

-- Reconstruct only data the legacy writer actually stored. Connection IDs,
-- readiness and active leadership are ephemeral and deliberately not revived.
UPDATE public.rooms r SET state = jsonb_build_object(
  'name', r.name, 'settings', r.settings, 'chat', '[]'::jsonb,
  'flashbacks', '{}'::jsonb, 'leaderId', null, 'mediaRun', 0,
  'participantRoles', CASE WHEN r.owner_id IS NULL THEN '[]'::jsonb
    ELSE jsonb_build_array(jsonb_build_object('id',r.owner_id,'role','owner','joinedAt',0)) END,
  'playlist', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', i.id, 'url', i.url, 'provider', i.provider, 'title', i.title,
    'duration', i.duration, 'addedBy', i.added_by, 'lastPosition', i.last_position,
    'thumbnail', i.thumbnail_url) ORDER BY i.position, i.id)
    FROM public.playlist_items i WHERE i.room_id = r.id), '[]'::jsonb),
  'playback', COALESCE((SELECT jsonb_build_object(
    'mediaItemId', p.media_item_id,
    'status', CASE WHEN p.status = 'buffering' THEN 'paused' ELSE p.status END,
    'basePosition', p.base_position, 'baseTimestamp', p.base_timestamp,
    'rate', p.rate, 'updatedBy', p.updated_by)
    FROM public.playback_snapshots p WHERE p.room_id = r.id),
    '{"mediaItemId":null,"status":"paused","basePosition":0,"baseTimestamp":0,"rate":1,"updatedBy":"system"}'::jsonb),
  'version', COALESCE((SELECT p.version FROM public.playback_snapshots p WHERE p.room_id=r.id),1),
  'sequence', COALESCE((SELECT p.version FROM public.playback_snapshots p WHERE p.room_id=r.id),1)
) WHERE r.state IS NULL;

ALTER TABLE public.rooms ALTER COLUMN state SET NOT NULL;
ALTER TABLE public.rooms ALTER COLUMN state SET DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.sync_room_state(p_room_id uuid, p_owner_id uuid, p_state jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_room_id::text));
  -- A delayed write-behind job must not overwrite a newer persisted snapshot.
  IF EXISTS (SELECT 1 FROM public.rooms WHERE id=p_room_id
    AND COALESCE((state->>'version')::bigint,0) > COALESCE((p_state->>'version')::bigint,0)) THEN
    RETURN;
  END IF;
  INSERT INTO public.rooms(id,name,settings,owner_id,state)
    VALUES(p_room_id,p_state->>'name',p_state->'settings',p_owner_id,p_state)
    ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,settings=EXCLUDED.settings,
      owner_id=EXCLUDED.owner_id,state=EXCLUDED.state;

  DELETE FROM public.playlist_items i WHERE room_id=p_room_id AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_state->'playlist','[]'::jsonb)) item
    WHERE (item->>'id')::uuid=i.id);
  INSERT INTO public.playlist_items(id,room_id,url,provider,title,duration,added_by,position,last_position,thumbnail_url)
    SELECT (item->>'id')::uuid,p_room_id,item->>'url',item->>'provider',item->>'title',
      (item->>'duration')::numeric::integer,item->>'addedBy',idx-1,
      COALESCE((item->>'lastPosition')::numeric,0),item->>'thumbnail'
    FROM jsonb_array_elements(COALESCE(p_state->'playlist','[]'::jsonb)) WITH ORDINALITY arr(item,idx)
    ON CONFLICT(id) DO UPDATE SET url=EXCLUDED.url,provider=EXCLUDED.provider,
      title=EXCLUDED.title,duration=EXCLUDED.duration,added_by=EXCLUDED.added_by,
      position=EXCLUDED.position,last_position=EXCLUDED.last_position,thumbnail_url=EXCLUDED.thumbnail_url;

  -- Persist null media too: clearing the queue clears the compatibility snapshot.
  INSERT INTO public.playback_snapshots(room_id,media_item_id,status,base_position,base_timestamp,rate,version,updated_by,updated_at)
    VALUES(p_room_id,(p_state->'playback'->>'mediaItemId')::uuid,
      p_state->'playback'->>'status',(p_state->'playback'->>'basePosition')::numeric,
      (p_state->'playback'->>'baseTimestamp')::bigint,(p_state->'playback'->>'rate')::numeric,
      (p_state->>'version')::integer,p_state->'playback'->>'updatedBy',now())
    ON CONFLICT(room_id) DO UPDATE SET media_item_id=EXCLUDED.media_item_id,
      status=EXCLUDED.status,base_position=EXCLUDED.base_position,base_timestamp=EXCLUDED.base_timestamp,
      rate=EXCLUDED.rate,version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at;
END;
$$;

-- Declare the service-only boundary after the final function replacement.
REVOKE EXECUTE ON FUNCTION public.sync_room_state(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_room_state(uuid,uuid,jsonb) TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT ON public.rooms TO service_role;
