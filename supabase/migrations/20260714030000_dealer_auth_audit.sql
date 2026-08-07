CREATE TABLE IF NOT EXISTS public.dealer_auth_audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NULL,
  email_normalized TEXT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('LOGIN', 'LOGOUT', 'REFRESH', 'PASSWORD_RESET')),
  result TEXT NOT NULL,
  ip_hint TEXT NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_auth_audit_created_at ON public.dealer_auth_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_auth_audit_user_created ON public.dealer_auth_audit_log (user_id, created_at DESC) WHERE user_id IS NOT NULL;

ALTER TABLE public.dealer_auth_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dealer_auth_audit_log FROM anon, authenticated;
