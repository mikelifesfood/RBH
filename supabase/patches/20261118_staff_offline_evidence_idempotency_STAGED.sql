-- STAGED ONLY — do not apply before revised manage-action-evidence Edge Function is tested.
-- Additive metadata to guarantee one offline photo id produces one attachment.
BEGIN;
ALTER TABLE public.report_attachments
  ADD COLUMN IF NOT EXISTS offline_evidence_id uuid,
  ADD COLUMN IF NOT EXISTS offline_evidence_sha256 text,
  ADD COLUMN IF NOT EXISTS offline_uploaded_by uuid;
CREATE UNIQUE INDEX IF NOT EXISTS report_attachments_offline_idempotency_ux
  ON public.report_attachments (organization_id,offline_uploaded_by,offline_evidence_id)
  WHERE offline_evidence_id IS NOT NULL;
ALTER TABLE public.report_attachments
  ADD CONSTRAINT report_attachments_offline_digest_chk
  CHECK (offline_evidence_sha256 IS NULL OR offline_evidence_sha256 ~ '^[a-f0-9]{64}$')
  NOT VALID;
REVOKE UPDATE (offline_evidence_id,offline_evidence_sha256,offline_uploaded_by)
  ON public.report_attachments FROM anon,authenticated;
COMMIT;
-- Backfill/constraint validation is safe separately:
-- ALTER TABLE public.report_attachments VALIDATE CONSTRAINT report_attachments_offline_digest_chk;
