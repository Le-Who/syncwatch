-- Migration 00011: Rename 'guest' to 'viewer'
-- Eliminates legacy fallback terminology to clarify read-only participants
-- Fully idempotent: safe to run multiple times.

-- 1. Update existing records (idempotent: 0 rows affected on re-run)
UPDATE public.room_members 
SET role = 'viewer' 
WHERE role = 'guest';

-- 2. Drop the old constraint (idempotent via IF EXISTS)
ALTER TABLE public.room_members 
DROP CONSTRAINT IF EXISTS room_members_role_check;

-- 3. Add the new constraint (idempotent via pg_constraint check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'room_members_role_check' 
      AND conrelid = 'public.room_members'::regclass
  ) THEN
    ALTER TABLE public.room_members 
    ADD CONSTRAINT room_members_role_check 
    CHECK (role = ANY (ARRAY['owner'::text, 'moderator'::text, 'viewer'::text]));
  END IF;
END $$;
