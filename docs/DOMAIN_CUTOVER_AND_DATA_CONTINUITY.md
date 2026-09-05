# Domain cutover and data continuity

Updated: 2026-07-14

## Decision

The custom-domain cutover does not need to wait for the normalization scan to
finish. The browser application runs on Vercel, while the normalization worker
runs on Railway and reads/writes Supabase directly. DNS changes do not alter the
worker job name, lease, checkpoint, or database connection.

Do not point production traffic at a deployment until the dealer portal and
Trading Floor changes have been reviewed and deployed to a Vercel preview.

## No-full-rerun rule

- Keep `SHADOW_JOB_NAME=normalization-v4-dial-production` unchanged until the
  current scan completes.
- Resume from `normalization_shadow_checkpoints.last_source_record_id`; never
  reset the checkpoint to accelerate or recover the worker.
- Shadow output is upserted by `source_record_id`, so a retried lease updates the
  same row instead of creating a second normalized copy.
- Add new classification work as a separately named, checkpointed enrichment
  pass over only the required columns/rows. Do not restart the v4 scan to add
  Trading Floor categories.

## Trading Floor coverage

The UI and API expose:

- watches;
- non-watch luxury rows currently represented by `listing_type=OTHER`;
- unsplit multi-item rows represented by `listing_type=MULTI`;
- WTS, WTB, NTQ, and TRADE intent filters.

The current production archive contains WTS and WTB rows. MULTI, OTHER, NTQ,
and TRADE require a targeted classification/enrichment pass before those views
will contain data. That pass must have its own checkpoint and deterministic
upsert key; it must not rewrite raw messages or restart normalization v4.

## DNS cutover sequence

1. Deploy the reviewed branch to a Vercel preview and run dealer login, beta
   skip, Price Search, Trading Floor, logout, API health, and mobile smoke tests.
2. Add `watchfacts.com` and `www.watchfacts.com` to the `watchfacts-poc` Vercel
   project. Use the exact verification and routing records Vercel returns.
3. Keep DNS hosted at its current provider unless there is a separate migration
   plan. The authoritative nameservers are currently DigitalOcean, not GoDaddy.
4. Preserve the existing Microsoft 365 MX/SPF, DMARC, Twilio verification, and
   any DKIM records. Do not replace the nameservers just to change web hosting.
5. Lower web-record TTL before cutover, change only the apex/www web records,
   verify Vercel SSL, then test the public domain.
6. Keep the old origin available during the observation window and roll back by
   restoring only the previous apex/www web records if needed.

Dealer session cookies are host-only. Existing sessions on the Vercel preview
will not transfer to `watchfacts.com`; users will sign in once on the new host.
This does not affect stored listings or normalization progress.
