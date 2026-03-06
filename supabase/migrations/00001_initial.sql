-- Supabase Schema for SyncWatch

-- Rooms table
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT,
  owner_id UUID NOT NULL,
  settings JSONB NOT NULL DEFAULT '{"controlMode": "open", "autoplayNext": true, "looping": false}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Room Members table
CREATE TABLE room_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'moderator', 'guest')),
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);

-- Playlist Items table
CREATE TABLE playlist_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  provider TEXT NOT NULL,
  title TEXT NOT NULL,
  duration INTEGER DEFAULT 0,
  added_by TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Playback Snapshots table (for persistence if server restarts)
CREATE TABLE playback_snapshots (
  room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  media_item_id UUID REFERENCES playlist_items(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('playing', 'paused', 'buffering', 'ended')),
  base_position DOUBLE PRECISION NOT NULL DEFAULT 0,
  base_timestamp BIGINT NOT NULL,
  rate DOUBLE PRECISION NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Activity Log table
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_room_members_room_id ON room_members(room_id);
CREATE INDEX idx_playlist_items_room_id ON playlist_items(room_id);
CREATE INDEX idx_activity_log_room_id ON activity_log(room_id);

-- Note: The application currently uses an in-memory server-authoritative model 
-- for real-time synchronization to minimize latency and database writes. 
-- These tables can be used to persist room state periodically or when rooms become inactive.
