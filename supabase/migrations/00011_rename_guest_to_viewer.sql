UPDATE public.room_members 
SET role = 'viewer' 
WHERE role = 'guest';

ALTER TABLE public.room_members 
DROP CONSTRAINT IF EXISTS room_members_role_check;

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
