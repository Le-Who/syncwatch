-- Enable Row Level Security to block public anon access (Deny-All by default)
-- The application server uses a Service Role key to bypass RLS, so no policies are needed, 
-- but this secures the PostgREST API from public data leaks.
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE playback_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Add missing index to foreign key column to prevent full table scans on DELETE SET NULL
CREATE INDEX IF NOT EXISTS idx_playback_snapshots_media_item_id ON playback_snapshots(media_item_id);
