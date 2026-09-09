-- Match the existing resolver predicate. Nonunique by design: the resolver
-- still checks source ownership and ambiguity; this index supplies no identity.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE INDEX dealer_verified_contact_lookup_v3
 ON public.dealer_source_identities(public.normalize_seller_phone_identity(source_identity))
 WHERE verification_status='VERIFIED' AND upper(identity_type) IN('PHONE','WHATSAPP');
COMMIT;
