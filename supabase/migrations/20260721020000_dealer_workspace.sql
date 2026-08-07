CREATE TABLE IF NOT EXISTS public.dealer_account_preferences (
  auth_user_id UUID PRIMARY KEY,
  display_currency TEXT NOT NULL DEFAULT 'USD'
    CHECK (display_currency IN ('USD', 'HKD', 'EUR', 'GBP', 'CHF', 'CNY', 'JPY', 'SGD')),
  email_notifications BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dealer_support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL,
  dealer_id UUID REFERENCES public.dealers(id) ON DELETE SET NULL,
  subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 160),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 10 AND 5000),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_tickets_user_created
  ON public.dealer_support_tickets (auth_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_tickets_status_created
  ON public.dealer_support_tickets (status, created_at DESC);

ALTER TABLE public.dealer_account_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_support_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dealer_account_preferences FROM anon, authenticated;
REVOKE ALL ON public.dealer_support_tickets FROM anon, authenticated;
GRANT ALL ON public.dealer_account_preferences TO service_role;
GRANT ALL ON public.dealer_support_tickets TO service_role;
