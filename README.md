# DRA Learning — Lex Talk Legal

Starter project for `dra.lextalk.legal`: multilingual DRA MCQ practice, one free starter mock, accounts, admin CSV import/review, class scheduling, membership and Razorpay integration foundations.

**This project is not deployed yet.** It uses Cloudflare Workers + static assets + D1. The GitHub Actions workflow at `.github/workflows/deploy.yml` validates and deploys on pushes to `main` after the required Cloudflare secrets are configured. The workflow is provided but has not been run against your Cloudflare account. The initial migration seeds a small set of clearly labelled illustrative questions in English and Hindi; they are not official IIBF questions. Each language translation must be explicitly reviewed in Admin before it is eligible for tests. Replace/review the demo bank before public launch.

## Quick start

1. Install Node.js 20+.
2. Run `npm install`.
3. Copy `env.example` to `.dev.vars` and set a random `ADMIN_BOOTSTRAP_KEY` for local setup.
4. Run `npm run db:local`.
5. Run `npm run dev`.
6. Visit `/setup.html` once to create the first admin, then `/admin.html`.
7. Visit `/` to test the student experience.

For GitHub-driven deployment, create the D1 database first and add the repository Actions secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_D1_DATABASE_ID`. The workflow applies migrations and deploys. Then bind `dra.lextalk.legal`, set the one-time bootstrap secret, create your admin and remove the secret. Use the paid Cloudflare Workers plan for the current 600,000-iteration PBKDF2 password hashing; the Free plan’s 10 ms CPU cap is not a safe production assumption for this flow. Read `docs/DEPLOYMENT_GUIDE_HINGLISH.md` for full instructions.

## Admin CSV format

Use `sample-data/mcq-import-template.csv`. For the same question in several languages, create one row per language with the same `question_key`. Keep the correct answer key (A/B/C/D) consistent across language rows. Imports remain Draft until reviewed and published.

## Security and launch notes

- Passwords are hashed with PBKDF2-SHA256 (600,000 iterations); sessions are token-hashed and stored in D1, with HttpOnly cookies. The Worker config requests a 1-second CPU limit; use an eligible Workers Paid plan before production launch.
- Paid plans are seeded as Draft and payments are disabled unless gateway secrets are configured and plans are activated.
- Configure Cloudflare rate limiting, support/policy details and account recovery before public launch.
- Mandatory DRA training and the official exam application must follow current IIBF requirements; this independent site does not issue IIBF certificates.

See `docs/DEPLOYMENT_GUIDE_HINGLISH.md` for detailed setup steps and current limitations.

## Search indexing

The homepage and policy templates currently use `noindex,nofollow` until the operator has supplied the real MCQ bank and finalised the legal/support pages. Before intentionally opening search indexing, review and remove those meta directives, then submit the final sitemap when one is added.
