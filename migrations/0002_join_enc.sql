-- Adds an encrypted copy of the join token so the admin can re-display the join
-- link from the admin page. Encrypted (AES-256-GCM) under a key DERIVED FROM THE
-- ADMIN TOKEN, which is never stored in the DB (only its SHA-256 hash is). A DB
-- dump therefore still yields no working join links — recovering one requires the
-- admin token, which lives only in the admin URL. See src/joinlink.ts.
--
-- Nullable: groups created before this migration simply won't have a re-sharable
-- link (the admin page degrades gracefully).
ALTER TABLE groups ADD COLUMN join_enc TEXT;
