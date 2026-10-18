# DRA Learning (dra.lextalk.legal) — Deployment Guide

This is a starter application, not yet deployed to your Cloudflare account. The public pages and API are designed to run together as one Cloudflare Worker with static assets and a D1 database.

## Pehle kya ready rakhna hai

1. Cloudflare account with the `lextalk.legal` zone active.
2. GitHub repository for this project.
3. Node.js 20+ on your Windows computer.
4. The D1 database ID that Cloudflare gives you.
5. Admin name, email and a unique password (minimum 14 characters for first admin).
6. Your original MCQs with verified answer keys and explanations. Begin with English/Hindi rows; add further reviewed translations using the same `question_key`.
7. Before paid launch: Razorpay account, pricing decision, support email, refund/cancellation policy, privacy/terms review. Credentials are NOT needed for the free pilot.

## GitHub se automatic deployment (recommended)

Project ko ek private GitHub repository mein push/upload karo (example: `dra-lextalk-legal`) aur branch ka naam `main` rakho. Repository → **Settings → Secrets and variables → Actions → New repository secret** mein ye 3 secrets add karo:

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token, Workers Scripts edit aur D1 edit permissions ke saath, sahi account ke liye.
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare dashboard mein account ID.
- `CLOUDFLARE_D1_DATABASE_ID` — isi app ke `dra-lextalk-legal-db` D1 database ka ID.

Cloudflare dashboard mein pehle D1 database create karo:

```bash
npx wrangler d1 create dra-lextalk-legal-db
```

Us command ka D1 ID GitHub secret mein save karo. **Database ID secret se deploy workflow `wrangler.jsonc` mein substitute hota hai; local tracked config mein apna ID commit karna zaroori nahi.** Uske baad source files `main` par push karo ya GitHub → Actions → `Validate and deploy DRA Learning` → Run workflow chalao. Workflow checks run karega, remote D1 migration apply karega aur Worker/assets deploy karega. First run se pehle database create hona aur teenon secrets ka sahi hona zaroori hai.

Deployment ke baad Cloudflare dashboard → Workers & Pages → `dra-lextalk-legal` → Settings / Domains & Routes → Add Custom Domain mein `dra.lextalk.legal` add karo. Agar domain option available na ho, confirm karo ki `lextalk.legal` zone isi Cloudflare account mein active hai.

## Password hashing aur Cloudflare plan

Login/register mein PBKDF2-SHA256 ke 600,000 iterations use hote hain. Cloudflare Workers Free tier per request sirf 10 ms CPU allow karta hai; isliye is authentication implementation ko Free tier par deploy karke production login kaam karega assume mat karo. Safe launch ke liye Workers Paid plan (currently minimum US$5/month according to Cloudflare pricing; usage/fees may change) ya external managed authentication provider ke integration ki zaroorat hai. Billing plan change se pehle apne Cloudflare account mein current price aur taxes confirm karo.

## Step 1 — Upload project to GitHub

- Download/unzip the project.
- Create or choose a private GitHub repository, for example `dra-lextalk-legal`.
- Upload all files while keeping folder names: `src`, `public`, `migrations`, `sample-data`, `scripts`, `docs`.
- Do not upload `.dev.vars`, any password, API key or payment secret.

## Step 2 — Install local tools

Install Node.js 20 or newer, then open PowerShell in the project folder and run:

```powershell
npm install
npm run check
npx wrangler login
```

`npm run check` runs JavaScript syntax checks. It does not deploy anything.

## Step 3 — Create the D1 database

```powershell
npx wrangler d1 create dra-lextalk-legal-db
```

Cloudflare prints a database ID. Open `wrangler.jsonc` and replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with the exact ID. Save the file. Do not make another D1 database if you already created the one for this project; use its existing ID.

## Step 4 — Apply database schema

For a local development copy:

```powershell
npm run db:local
```

For the live Cloudflare database, when ready:

```powershell
npm run db:remote
```

The initial migration creates accounts, sessions, questions, translations, test configurations, test attempts, plans, payments, entitlements, classes and audit logs. It seeds one clearly labelled free demo test with five illustrative English/Hindi questions. They are NOT official IIBF questions. Import your own verified bank and mark each language translation as reviewed in Admin before test attempts can use it.

## Step 5 — Local development and first admin

1. Copy `env.example` to `.dev.vars` in the project root.
2. Replace `ADMIN_BOOTSTRAP_KEY` with a long random value. Never commit `.dev.vars`.
3. Run `npm run dev`.
4. Open the local URL Wrangler prints, then open `/setup.html`.
5. Create the first administrator. Then sign in at `/admin.html`.
6. `ADMIN_BOOTSTRAP_KEY` in `.dev.vars` is still active for local. Once you deploy production, delete the production secret after creating the first admin. Do not put the key in GitHub.

## Step 6 — Deploy to Cloudflare

Once the D1 ID and migration are correct:

```powershell
npx wrangler deploy
```

The initial deployment will use the Worker name `dra-lextalk-legal`. Test the `workers.dev` preview URL first. Then in Cloudflare Dashboard open **Workers & Pages → dra-lextalk-legal → Settings / Domains & Routes → Add Custom Domain**, choose `dra.lextalk.legal`, and complete the prompts. The `lextalk.legal` zone must be managed/active in the same Cloudflare account.

## Step 7 — Create the live administrator

Set the one-time secret on the deployed Worker:

```powershell
npx wrangler secret put ADMIN_BOOTSTRAP_KEY
```

Paste a long random secret when prompted. Open `https://dra.lextalk.legal/setup.html`, create the first admin, then immediately remove the secret:

```powershell
npx wrangler secret delete ADMIN_BOOTSTRAP_KEY
```

If an administrator already exists, the bootstrap API rejects further admin creation. Do not leave the bootstrap key configured longer than needed.

## Step 8 — Upload MCQs

- Open `/admin.html` and sign in.
- Use the downloadable template `sample-data/mcq-import-template.csv` or the example `sample-data/mcq-two-language-example.csv`.
- One CSV row = one language version of a question. Use the same `question_key` for translations of the same question (e.g. `DRA-0001` in English and Hindi).
- The correct option letter (A/B/C/D) MUST be the same across all translations of that question; only option text is translated.
- Every row must have question text, all four option texts and the correct option.
- Import batches of at most 300 rows are supported. Imported questions are Draft. Review them and publish from the Question Bank table.
- The platform does not auto-publish machine-translated content. Review legal terms and subject accuracy in each language.
- The Free Starter Mock is configured for 5 questions and 10 minutes for initial smoke testing. It can start only in a language that has at least five complete, published and explicitly reviewed questions. Before public launch, replace the illustrative demo bank with your verified MCQs and set the free mock to the intended full test format (for example, 100 questions / 120 minutes) after confirming sufficient reviewed questions exist.
- A premium mock is seeded as Draft for 100 questions / 120 minutes. Publish only after there are enough reviewed questions in at least one language; students still require an active paid entitlement.

## Step 9 — Configure paid plans (do after free flow is tested)

Do not activate paid plans until pricing, refund/support policies and gateway settings are ready. First use Razorpay **Test Mode**. Set secrets:

```powershell
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
```

Configure a Razorpay webhook pointed to `https://dra.lextalk.legal/api/payments/webhook` for the `payment.captured` event and use the exact webhook secret in the Worker. Enter test-mode prices in Admin → Paid membership packages, save plans as active only after verifying the checkout flow. The server checks the checkout signature and the gateway-side payment record before granting an entitlement. Test successful, failed, cancelled and delayed-capture payments before going live.

## Step 10 — Optional email verification and WhatsApp

Email code delivery is optional. If you later want it, configure a verified sender and set secrets for `RESEND_API_KEY`, `EMAIL_FROM`, and a separate random `AUTH_PEPPER`. Turn `REQUIRE_VERIFIED_EMAIL` to `true` only after testing email delivery. If no email provider is configured, students can still register because the default is `false`.

To show the DRA Community India WhatsApp button, put the real invite URL in `COMMUNITY_WHATSAPP_URL` in `wrangler.jsonc` and deploy again. Do not use a placeholder or expose a private group link without the group's consent.

## Search indexing and safe beta

Homepage and Terms/Privacy pages are set to `noindex,nofollow` because the seeded MCQs are illustrative and policy pages contain placeholders. Keep this setting during private smoke testing. Remove it only after replacing sample questions with verified content, finalising policies/support contacts, and completing a production review. `robots.txt` disallows admin/setup/API crawling, but robots rules are not access controls; admin APIs are protected by authentication and role checks.

## Current implementation scope / limitations

- Included: responsive public website, register/login/logout, salted PBKDF2 password hashes, HttpOnly session cookies, single-use free mock per registered account, timed attempts, answer saving, server-side grading, result explanations, language-specific question/option tables, CSV import, admin publication checks, test and plan settings, class schedule/join links, audit logs, Razorpay order/signature/payment-state foundations, official IIBF link, policy drafts.
- Not yet deployed to your Cloudflare account. The GitHub workflow is configured, but repository creation/upload, Cloudflare deployment secrets, D1 creation, custom-domain binding, one-time admin bootstrap, and production smoke tests still require account access/actions.
- Payment remains unavailable until secrets and active plans are configured. The current plan records are Draft; no user can be charged by default.
- Live classes use a meeting link from the provider you choose (Google Meet/Zoom/etc.); the platform does not provide video hosting.
- No automatic AI translation is activated. Upload and review translation rows yourself; the source stores 11 language codes so languages can be added as verified translations are prepared.
- Password-reset flow, SMS OTP, WhatsApp API automation, confirmed email delivery and automated backups are not yet implemented.
- For public production use, configure Cloudflare rate limiting/WAF for `/api/auth/login`, `/api/auth/register`, `/api/admin/bootstrap`, payment routes; review data protection terms, contact/grievance details, backups, monitoring and account recovery.

## Test checklist before launch

- Register a learner and log out/in.
- Start the free mock in English and Hindi; complete it; verify the score and answers.
- Confirm the same learner cannot start the free mock a second time.
- Try an unpopulated language and confirm the interface reports missing reviewed translations without crashing.
- Import sample CSV, publish after review and confirm a published test only shows available reviewed language versions.
- Try admin endpoints as a student and verify access is denied.
- Verify that answer keys are not sent before test submission.
- Keep paid plans Draft until the Razorpay test-mode flow and refund/support process have been reviewed.

## Official references

- Cloudflare Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- Cloudflare static assets: https://developers.cloudflare.com/workers/static-assets/
- D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
- Cloudflare Worker secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- IIBF DRA certificate exam page: https://www.iibf.org.in/certificate-examination-for-DRA
