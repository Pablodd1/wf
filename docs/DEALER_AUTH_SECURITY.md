# Dealer Authentication and Security Workflow

## Current beta implementation

- Supabase Auth email/password accounts only; public sign-up is not exposed.
- Login and refresh tokens are stored in `HttpOnly`, `Secure`, `SameSite=Lax` cookies.
- Dealer, review, admin, analytics, clean, and reprocess routes use a shared client gate.
- Login responses never expose service-role credentials or raw tokens to browser JavaScript.
- Login errors are intentionally generic and attempts receive a best-effort server rate limit.
- The beta skip is session-tab only. It grants access only to the dealer portal, Price Search, and Trading Floor; it does not create an authenticated dealer session or unlock operations, admin, or review routes.
- Human approval accepts only a signed-in `reviewer`/`admin` session (legacy server operator tokens remain available for controlled automation).
- Successful, denied, role-denied, and logout events are written to the append-only dealer authentication audit table when available.

## Account provisioning

1. Create or invite users in Supabase Authentication > Users.
2. Set `app_metadata.role` to `dealer`, `reviewer`, or `admin` with a trusted server/admin workflow.
3. Never let a browser update `app_metadata`.
4. Disable public sign-ups and require email confirmation.
5. Use individual accounts. Never share dealer passwords.

## Production hardening before removing beta status

1. Set `VITE_ENABLE_DEALER_SKIP=false` in Vercel and redeploy.
2. Require MFA for reviewer and admin roles.
3. Continue the API authorization inventory and gate every remaining privileged endpoint, not only its route UI.
4. Replace the current IP hint with a one-way keyed hash before broad production use.
5. Add password reset through Supabase's verified-email flow.
6. Configure Vercel WAF rate limiting for `/api/dealer-auth`.
7. Add inactive-account suspension and quarterly access reviews.
8. Rotate exposed legacy credentials and keep production/staging credentials separate.

## Beta UI/UX review protocol

- Freeze information architecture during data validation; allow copy, spacing, accessibility, and responsive fixes.
- Record beta feedback by task: finding a listing, researching a reference, reviewing an exception, and approving a correction.
- Capture completion time, error rate, abandoned steps, search refinements, and confidence in the result.
- Do not redesign around comments alone. Pair feedback with observed task behavior and data-quality evidence.
- After two beta rounds, lock navigation and workflow states, then redesign visual hierarchy and polish.
