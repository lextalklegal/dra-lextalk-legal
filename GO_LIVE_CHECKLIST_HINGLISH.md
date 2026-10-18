# DRA Learning — Go-Live Checklist (Hinglish)

**Current state:** source project is prepared and local static validation passes. It is **not deployed** to GitHub/Cloudflare yet. The workflow and required settings are in the repository package; they still need your GitHub and Cloudflare account actions.

## Required from you

1. **GitHub repository**: create a private repository called `dra-lextalk-legal` (or share the exact repository you want to use) and upload this project, preserving `.github/workflows/deploy.yml`, `src/`, `public/`, `migrations/`, `sample-data/`, and `scripts/`. Set the default branch to `main`.
2. **Cloudflare D1 database**: create `dra-lextalk-legal-db` under the same Cloudflare account that manages `lextalk.legal`. Save the returned database ID securely.
3. **GitHub Actions repository secrets**: add `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_D1_DATABASE_ID`. The API token needs Workers Scripts edit and D1 edit access for the correct account.
4. **Worker plan**: confirm the current Cloudflare plan and cost before launch. This code uses PBKDF2-SHA256 with 600,000 iterations and asks for `cpu_ms: 1000`; Workers Free is limited to 10 ms CPU/request, so don't assume auth will operate correctly on Free. Cloudflare currently lists Workers Paid at a minimum $5 USD/month. No billing change has been made.
5. **Custom domain**: after the first deploy succeeds, add `dra.lextalk.legal` in Cloudflare → Workers & Pages → `dra-lextalk-legal` → Settings → Domains & Routes → Add Custom Domain. The `lextalk.legal` zone must be active in that Cloudflare account.
6. **Admin bootstrap**: add a long random `ADMIN_BOOTSTRAP_KEY` as a Worker secret, visit `/setup.html` to create the first admin, then immediately delete that Worker secret. Set the admin password yourself; do not send it in chat or put it in Git.
7. **MCQ bank**: use `sample-data/mcq-import-template.csv`. Upload and review the correct answer, question, options, explanation and each language version. Imported translations are not considered eligible for tests until you press “Mark this language reviewed” in Admin.
8. **Real exam settings**: change the 5-question demo smoke test to the actual free-test format after enough verified questions have been imported. The seeded practice questions are illustrative, not official IIBF questions.
9. **Public legal/support pages**: review/finalise Terms, Privacy, cancellation/refund policy (if selling), support email, data retention/deletion process and any applicable business disclosures before accepting paid users.
10. **Production smoke test**: register a test learner, log in/out, review/publish translations, take and submit the free test, confirm the second free attempt is blocked, test admin-only endpoints, test language switching, and verify the official IIBF link. Payment is disabled until Razorpay test-mode setup and validation are complete.

## GitHub Actions workflow

The workflow runs on push to `main` or manually from GitHub Actions. It installs the pinned Wrangler CLI, checks JavaScript, validates the D1 schema and local assets, substitutes the D1 ID from the repository secret, applies remote migrations and deploys the Worker/static assets.

## Important limits / not yet done

- This project has not been pushed to your GitHub repository by this session.
- No Cloudflare API token, account ID, D1 database ID, custom domain or admin credential has been configured by this session.
- Password reset and SMS/WhatsApp OTP automation are not yet implemented.
- Live class links are supplied by you (e.g. Google Meet/Zoom); the app does not host live video itself.
- Razorpay remains disabled until account credentials, webhook secret, policies and a complete test-mode checkout are configured.
