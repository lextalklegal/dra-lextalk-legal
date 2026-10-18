# DRA Learning — Go-Live Checklist (Hinglish)

**Current state:** managed-auth redesign is a draft review package. Production code and deployment have not been changed. Do not replace/merge or deploy until the PR review and Supabase configuration are complete. A successful local validation is not a live deployment.

## Required from you

1. **GitHub repository**: use `lextalklegal/dra-lextalk-legal`; review the proposed managed-auth PR and do not merge until the checks and configuration are approved.
2. **Cloudflare D1 database**: create `dra-lextalk-legal-db` under the same Cloudflare account that manages `lextalk.legal`. Save the returned database ID securely.
3. **Supabase Auth project**: create/select a Supabase project on its Free plan. Enable email/password sign-in and keep email confirmation enabled. Set Site URL to `https://dra.lextalk.legal` and add `https://dra.lextalk.legal/**` to the allowed Redirect URLs. Configure custom SMTP for reliable production email; the default email service may be rate-limited.
4. **GitHub Actions repository secrets**: add `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`. Use only the Supabase publishable/anon key, never `service_role` or a secret API key. The Cloudflare token needs Workers Scripts edit and D1 edit access for the correct account.
5. **Cloudflare Free plan**: the redesigned Worker must not set a custom `cpu_ms` limit. Password verification and session refresh are delegated to Supabase Auth, so the Worker does not run the old expensive PBKDF2 operation. Monitor actual CPU time, request counts, subrequests and provider limits after beta launch.
6. **Custom domain**: after the first deploy succeeds, add `dra.lextalk.legal` in Cloudflare → Workers & Pages → `dra-lextalk-legal` → Settings → Domains & Routes → Add Custom Domain. The `lextalk.legal` zone must be active in that Cloudflare account.
7. **Admin bootstrap**: register a normal account and confirm its email. Add a long random `ADMIN_BOOTSTRAP_KEY` as a Worker secret, visit `/setup.html`, sign in with that existing Supabase account and promote it to the first admin. Immediately delete that Worker secret. Do not put it in Git or send it in chat.
8. **MCQ bank**: use `sample-data/mcq-import-template.csv`. Upload and review the correct answer, question, options, explanation and each language version. Imported translations are not considered eligible for tests until you press “Mark this language reviewed” in Admin.
9. **Real exam settings**: change the 5-question demo smoke test to the actual free-test format after enough verified questions have been imported. The seeded practice questions are illustrative, not official IIBF questions.
10. **Public legal/support pages**: review/finalise Terms, Privacy, cancellation/refund policy (if selling), support email, data retention/deletion process and any applicable business disclosures before accepting paid users.
11. **Production smoke test**: register a test learner, log in/out, review/publish translations, take and submit the free test, confirm the second free attempt is blocked, test admin-only endpoints, test language switching, and verify the official IIBF link. Payment is disabled until Razorpay test-mode setup and validation are complete.

## GitHub Actions workflow

The deployment workflow runs only on `main` or when manually dispatched; a separate validation workflow runs pull-request checks and does not deploy. The deploy workflow configures the D1 ID and Supabase project values from Actions secrets in the temporary runner workspace, applies migrations and deploys the Worker/static assets. Do not merge the PR or manually run the deploy workflow until review is complete.

## Important limits / not yet done

- Supabase auth, redirect URLs, publishable key and Cloudflare secrets must be configured by the operator; do not paste keys or passwords in chat.
- No production deployment, domain binding or admin promotion should occur until the branch/PR review has passed.
- Supabase owns password reset and email confirmation; add and test a user-facing reset-password flow before public launch. SMS/WhatsApp OTP automation is not implemented.
- Supabase Free plan limits, project pause/backup terms, and email delivery quotas should be reviewed before public launch. Live class links are supplied by you (e.g. Google Meet/Zoom); the app does not host live video itself.
- Razorpay remains disabled until account credentials, webhook secret, policies and a complete test-mode checkout are configured.
