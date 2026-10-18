# DRA Learning — Lex Talk Legal

Starter project for `dra.lextalk.legal`: multilingual DRA MCQ practice, one free starter mock, managed accounts, admin CSV import/review, class scheduling, membership and Razorpay integration foundations.

**Managed-auth redesign is prepared on a review branch; do not merge or deploy until the review and Supabase project configuration are complete.** The app uses Cloudflare Workers + D1 and delegates passwords, email confirmation and session refresh to Supabase Auth. The Worker verifies each access token with the Supabase Auth `/auth/v1/user` endpoint, then maps the verified identity to an internal D1 profile. The Worker no longer runs PBKDF2 password hashing, so it does not need a custom CPU limit. The initial migration seeds a small set of clearly labelled illustrative questions in English and Hindi; they are not official IIBF questions. Each language translation must be explicitly reviewed in Admin before it is eligible for tests. Replace/review the demo bank before public launch.

## Quick start

1. Create a Supabase project on the Free plan and enable email/password sign-in with email confirmation.
2. Add `https://dra.lextalk.legal/**` to Supabase Auth → URL Configuration → Redirect URLs; set the Site URL to `https://dra.lextalk.legal`. For local development, also allow the localhost URL printed by Wrangler.
3. Install Node.js 20+ and run `npm install`.
4. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in your local Wrangler vars (only the publishable/anon key, never service_role), and put a random `ADMIN_BOOTSTRAP_KEY` in `.dev.vars`.
5. Run `npm run db:local`, `npm run dev`, register a learner, and confirm the email.
6. Sign in at `/setup.html` with the confirmed account and bootstrap key to promote it to admin, then immediately remove the bootstrap secret.
7. Visit `/admin.html` and `/` to test the admin and student flows.

For GitHub-driven deployment, add these Actions secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`. The workflow writes the deployment URL/key into the ephemeral runner, applies D1 migrations and deploys; secrets are not committed. Then bind `dra.lextalk.legal`, set the one-time bootstrap secret, create your admin using a confirmed Supabase account and immediately remove the secret. The current design avoids a custom Worker CPU limit and is intended for the Cloudflare Workers Free plan, subject to actual request/subrequest quota and provider free-plan limits. Read `docs/DEPLOYMENT_GUIDE_HINGLISH.md` for full instructions.

## Admin CSV format

Use `sample-data/mcq-import-template.csv`. For the same question in several languages, create one row per language with the same `question_key`. Keep the correct answer key (A/B/C/D) consistent across language rows. Imports remain Draft until reviewed and published.

## Security and launch notes

- Supabase Auth is the source of truth for passwords, email confirmation, session issuance and token refresh. The browser SDK stores its session in browser storage; protect against XSS, keep dependencies pinned, and never place the Supabase service_role/secret key in the browser or Worker vars. The Worker calls Supabase Auth to validate bearer tokens and checks D1 roles before admin operations.
- D1 stores a separate internal profile ID and `auth_provider_user_id`; attempts, payments and entitlements continue referencing the internal profile ID. Existing legacy password columns are retained only for migration compatibility and are never used to authenticate users.
- Paid plans are seeded as Draft and payments are disabled unless gateway secrets are configured and plans are activated.
- Configure rate limiting on auth and admin routes, custom SMTP/email templates for reliable email confirmation and password reset, support/policy details, backups and account recovery before public launch.
- Supabase Free currently includes 50,000 monthly active users. Review current provider quotas and free-project pausing/backup limitations before launch; see Supabase pricing/usage docs.
- Mandatory DRA training and the official exam application must follow current IIBF requirements; this independent site does not issue IIBF certificates.

See `docs/DEPLOYMENT_GUIDE_HINGLISH.md` for detailed setup steps and current limitations.

## Search indexing

The homepage and policy templates currently use `noindex,nofollow` until the operator has supplied the real MCQ bank and finalised the legal/support pages. Before intentionally opening search indexing, review and remove those meta directives, then submit the final sitemap when one is added.
