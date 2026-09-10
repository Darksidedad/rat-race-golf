-- Apply only after the compatible application release is deployed and verified.
-- That release must create and remove draft picks exclusively through the RPCs in
-- supabase-draft-pick-integrity.sql. Keeping this revocation separate preserves
-- direct-write compatibility during a zero-downtime rollout.

begin;

revoke insert, delete on public.draft_picks from authenticated;

commit;
