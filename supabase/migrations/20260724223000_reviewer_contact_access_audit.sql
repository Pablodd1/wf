CREATE TABLE IF NOT EXISTS public.reviewer_contact_access_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reviewer_id UUID NOT NULL,
  reviewer_email TEXT,
  reviewer_role TEXT NOT NULL CHECK (reviewer_role IN ('reviewer', 'admin')),
  staging_id UUID NOT NULL REFERENCES public.watch_staging(id) ON DELETE RESTRICT,
  source_record_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviewer_contact_access_created
  ON public.reviewer_contact_access_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviewer_contact_access_reviewer
  ON public.reviewer_contact_access_audit (reviewer_id, created_at DESC);

ALTER TABLE public.reviewer_contact_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reviewer_contact_access_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.reviewer_contact_access_audit TO service_role;

COMMENT ON TABLE public.reviewer_contact_access_audit IS
  'Immutable audit of reviewer/admin access to private seller contact evidence.';
