# DRA Learning (`dra.lextalk.legal`) — Managed Auth Go-Live Guide

**Important:** This is a proposed Free-plan-compatible redesign. Do not merge or deploy the feature branch until the PR review passes and the Supabase project settings are configured. The current production Worker is not changed by this guide.

## What changes with managed authentication?

- Supabase Auth owns password verification, email confirmation, session issuance, and refresh.
- The browser uses the Supabase JavaScript client. The DRA Worker receives the access token as a Bearer token and validates it with the project's Supabase Auth `/auth/v1/user` endpoint.
- Cloudflare D1 remains the source of truth for DRA roles, test attempts, question bank, purchases, entitlements, classes and audit events. A new `auth_provider_user_id` maps the verified Supabase identity to the stable internal D1 user ID.
- The Worker does not calculate PBKDF2 password hashes and no longer sets a custom CPU limit. It is designed for Cloudflare Workers Free, within current account/request/subrequest limits.
- Never place a Supabase `service_role` or secret API key in browser code, Wrangler vars, GitHub secrets for this app, or a chat message. Only use the Supabase publishable key (or legacy anon public key) for this flow.

## 1. Create/configure the Supabase Auth project

1. Open [Supabase](https://supabase.com/dashboard/) and create/select a project on the Free plan.
2. Under **Authentication → Sign In / Providers**, enable Email/password sign-in and keep email confirmation enabled.
3. Under **Authentication → URL Configuration**, set **Site URL** to `https://dra.lextalk.legal`.
4. Add `https://dra.lextalk.legal/**` to **Redirect URLs**. For local Wrangler testing, also add the exact localhost URL it prints (for example `http://localhost:8787/**`).
5. Copy the project URL and the **publishable key** from Project Settings → API Keys. A legacy `anon` public key can also be used. Do not copy `service_role` or any key labelled secret.
6. Email confirmations are needed for safe admin bootstrapping. Supabase's default email service can be restrictive/rate-limited; configure a verified custom SMTP sender before inviting the public. Test signup, confirmation, password login and password reset in Supabase before launch.

Supabase JS reference: https://supabase.com/docs/reference/javascript/auth-signup and https://supabase.com/docs/reference/javascript/auth-signinwithpassword
Redirect configuration: https://supabase.com/docs/guides/auth/redirect-urls

## 2. GitHub setup (deployment remains disabled until merge)

Repository: `lextalklegal/dra-lextalk-legal`.

1. Review the managed-auth pull request and its validation checks first. The separate validation workflow does not deploy the site.
2. In repository **Settings → Secrets and variables → Actions**, add:
   - `CLOUDFLARE_API_TOKEN` — scoped to this Cloudflare account with Workers Scripts Edit and D1 Edit.
   - `CLOUDFLARE_ACCOUNT_ID` — account ID for the account managing `lextalk.legal`.
   - `CLOUDFLARE_D1_DATABASE_ID` — ID for the existing `dra-lextalk-legal-db` database.
   - `SUPABASE_URL` — HTTPS project URL from Supabase.
   - `SUPABASE_PUBLISHABLE_KEY` — Supabase publishable key or legacy anon public key.
3. Do not put any actual keys in checked-in files. At deploy time, the workflow writes the URL/public key into the temporary CI workspace only; it does not commit them. The publishable key is designed for public clients, but do not use `service_role` or a secret key.
4. The existing `dra-lextalk-legal-db` should already exist. Do not create a duplicate if it is visible in Cloudflare. Migration `0002_managed_auth.sql` adds the provider identity mapping without replacing internal user IDs.

The production deploy workflow only runs on pushes to `main` or when manually dispatched. Do not merge the feature PR or manually run the production workflow until reviewed and ready.

## 3. Local testing on Windows (no paid Cloudflare upgrade required)

Install Node.js 20+; then open PowerShell in the project directory:

```powershell
npm install
python scripts/configure_supabase.py "https://YOUR-PROJECT-REF.supabase.co" "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY"
Copy-Item env.example .dev.vars
```

Edit `.dev.vars` and set a long random `ADMIN_BOOTSTRAP_KEY`. Do not commit `.dev.vars`.

Then run:

```powershell
npm run db:local
npm run check
npm run validate
npm run dev
```

Open the local URL printed by Wrangler. Register a learner, confirm the email using the inbox link, then sign in and test the free mock. The script `configure_supabase.py` writes only the project URL and publishable/anon key to local `wrangler.jsonc` and `public/auth-config.js`. These are public-client values; never use a service/secret key. To prepare a deployment build, rerun with your actual project URL/key. The GitHub workflow configures the values in its ephemeral runner on each deployment.

## 4. Admin bootstrap

1. Register a normal student account from the website and confirm its email.
2. Set a long random Worker secret named `ADMIN_BOOTSTRAP_KEY`. For local test it is in `.dev.vars`; for production use the Cloudflare Worker secret configuration.
3. Open `/setup.html`, sign in using that existing confirmed Supabase account, enter the one-time bootstrap key, and promote the account to the first administrator.
4. Immediately delete the `ADMIN_BOOTSTRAP_KEY` secret. The backend also refuses to promote another account once an administrator already exists.
5. Sign in at `/admin.html`. Student accounts remain blocked from `/api/admin/*` by server-side role checks; do not rely on the page UI for security.

## 5. D1 migrations and free-test verification

The deployment workflow applies remote D1 migrations before the Worker deploy. The new migration adds `auth_provider_user_id` with a unique index. A verified Supabase identity is linked to an existing D1 profile only when its email is confirmed; otherwise the backend provisions a separate profile. Internal D1 IDs remain stable so attempts, purchases and entitlements are not orphaned.

Before public launch:

- Replace all illustrative questions with your verified MCQ bank. They are not official IIBF questions.
- Review and publish each translation in Admin. Unreviewed translations must not be offered in a test.
- Configure the free test format (for example 100 questions/120 minutes) only after enough complete/reviewed questions exist for that language.
- Confirm the free mock is allowed only once per registered account and that a second attempt is blocked server-side.
- Verify an unconfirmed email cannot start a mock (the Worker default is `REQUIRE_VERIFIED_EMAIL=true`).
- Verify admin APIs deny a normal student even if they manually call the endpoint.
- Ensure answer keys are not returned until submission.

## 6. Payments and live classes (still separate from auth)

Razorpay remains disabled until you add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`, test the checkout/webhook flow, finalise pricing/support/refund policies and explicitly activate plans. Test successful, failed, cancelled and delayed-capture outcomes. The app schedules classes and links to a meeting URL that you provide (Google Meet/Zoom/etc.); it does not host video.

## 7. Free-plan constraints and important cautions

- Supabase currently lists 50,000 monthly active users on the Free plan. Review current usage, project-pausing, backup and email delivery limits before launch: https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users and https://supabase.com/docs/guides/platform/billing-on-supabase
- The DRA Worker performs one Supabase Auth validation call per incoming API request that needs an identity. Monitor Worker request/subrequest usage, latency, Supabase Auth rate limits and failures.
- The current browser SDK persists its managed session in browser storage. Keep the SDK version pinned, avoid unsafe HTML rendering, maintain a strict Content Security Policy, and do not place tokens in URLs/logs. A future BFF/HttpOnly-cookie design can reduce JS token exposure but is a separate project.
- Password-reset UI, SMS OTP, WhatsApp API automation and automated backups are not implemented in the starter. Use Supabase's own email/password-reset functionality where available and add a complete user-facing reset flow before launch.
- Home and policy pages remain `noindex,nofollow` while demo questions/policy templates are present. Finalise privacy, terms, support/grievance contacts, data retention/deletion and business disclosures before opening indexing or accepting payments.

## 8. Test checklist

- Register with a new email and confirm the email link returns to `dra.lextalk.legal` (or localhost during development).
- Sign in/out, refresh the page, and verify the managed session renews.
- Confirm `/api/auth/me` returns the expected D1 profile, while no bearer token returns `user: null`.
- Promote the first confirmed user to admin, delete the bootstrap secret, and verify another bootstrap attempt fails.
- Try admin endpoints with a student account and verify `403 ADMIN_REQUIRED`.
- Complete the free mock, validate score/explanations, then confirm the second free attempt is blocked.
- Test unreviewed/missing translations, language switching and a missing provider config.
- Keep paid plans Draft until payment and business policies have been reviewed.
