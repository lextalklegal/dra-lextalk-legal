# Managed-auth redesign — code review notes

## Scope

This is a proposed code change for review only. It removes in-Worker password hashing and local session issuance, and delegates credentials, email confirmation, and session refresh to Supabase Auth. Cloudflare Workers + D1 remain the application runtime and data store. This package has not been deployed, and no production files were modified by this draft.

## What changed

- Added the Supabase browser auth client and a deployment-generated public auth configuration.
- Changed login/signup/logout to Supabase Auth. The browser sends the current access token in `Authorization: Bearer …` for app API requests.
- Changed the Worker to validate the token through the configured Supabase Auth `/auth/v1/user` endpoint, then map the verified Supabase user ID to a separate internal D1 profile ID. D1 remains authoritative for roles and status; user-editable provider metadata never grants admin rights.
- Added `migrations/0002_managed_auth.sql` to introduce the unique provider-user mapping without changing internal user IDs used by attempts, purchases and entitlements.
- Reworked first-admin bootstrap so it promotes an already registered and email-confirmed provider account only once, requires a separate Worker secret, and no longer hashes passwords in the Worker.
- Removed the custom CPU limit from `wrangler.jsonc` and updated CSP for the Supabase Auth SDK and API.
- Updated the deployment workflow to configure Supabase URL and publishable key from GitHub Actions secrets in the ephemeral runner workspace, without committing those values.
- Added a separate pull-request validation workflow which does not deploy.

## Local validations completed

- JavaScript syntax checks passed for `src/index.js`, `public/app.js`, `public/admin.js`, `public/setup.js`, and `public/auth-client.js`.
- SQLite validation applied both migrations to an in-memory database and checked the seeded demo test/question bank.
- Static asset references and MCQ import template checks passed.
- The Supabase deployment-config script passed a smoke test using dummy URL/key values; those dummy values were not retained in the project.

## Not yet integration-tested

- No Supabase project URL/key has been configured for this draft.
- Email confirmation and redirect need to be tested in the operator's Supabase project, including custom SMTP for reliable public email delivery.
- D1 migration `0002_managed_auth.sql` has not been applied to production by this draft.
- No Cloudflare Worker deployment, DNS/domain binding, or admin bootstrap has occurred as part of this redesign.
- Full signup/login/refresh/admin/bootstrap/free-test flows need a staging run before merge.

## Operational/security notes

- Add GitHub Actions secrets: `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, in addition to the existing Cloudflare secrets.
- Only the Supabase publishable key or legacy anon public key may be used. Never use the `service_role`/secret key.
- Supabase Auth should keep email confirmation enabled. The Worker defaults `REQUIRE_VERIFIED_EMAIL=true` for test starts and bootstrap requires a confirmed email.
- The browser SDK persists its session in browser storage. CSP, escaping and avoiding unsafe HTML are important; a future HttpOnly-cookie/BFF design could reduce token exposure but is not part of this draft.
- The Worker validates each authenticated API request through one Supabase Auth call. Monitor CPU, latency, subrequests, Supabase usage and rate limits in beta.
- Password reset UI, SMTP setup, rate limiting review, privacy/terms, data retention and production recovery steps remain pre-launch tasks.
- `public/auth-config.js` and Wrangler config contain placeholders in source; the deployment workflow injects the real project URL/publishable key into its temporary runner. Do not commit real project config values or secrets.
