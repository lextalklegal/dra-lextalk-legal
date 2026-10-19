const LANGUAGES = [
  { code: 'en', name: 'English', examMedium: true },
  { code: 'hi', name: 'Hindi', examMedium: true },
  { code: 'mr', name: 'Marathi', examMedium: true },
  { code: 'ml', name: 'Malayalam', examMedium: true },
  { code: 'gu', name: 'Gujarati', examMedium: true },
  { code: 'kn', name: 'Kannada', examMedium: true },
  { code: 'or', name: 'Odia', examMedium: true },
  { code: 'bn', name: 'Bengali', examMedium: true },
  { code: 'ta', name: 'Tamil', examMedium: true },
  { code: 'te', name: 'Telugu', examMedium: true },
  { code: 'as', name: 'Assamese', examMedium: true }
];
const DEFAULT_LANGUAGES = new Set(LANGUAGES.map(x => x.code));
const authCache = new WeakMap();

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      ...extraHeaders
    }
  });
}
function error(message, status = 400, code = 'BAD_REQUEST', extra = {}) {
  return json({ error: { code, message, ...extra } }, status);
}
function nowIso() { return new Date().toISOString(); }
function addMinutes(date, minutes) { return new Date(date.getTime() + minutes * 60000).toISOString(); }
function addDays(date, days) { return new Date(date.getTime() + days * 86400000).toISOString(); }
function bytesToHex(bytes) { return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(''); }
function equalConstantTime(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function assertSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}
async function readJson(request, maxBytes = 1_500_000) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) throw new Error('Request body is too large.');
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('Request body is too large.');
  return JSON.parse(text || '{}');
}
async function loadUserFromManagedAuth(request, env) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  const supabaseUrl = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!token || !supabaseUrl || !publishableKey || !env.DB) return null;
  let parsedUrl;
  try { parsedUrl = new URL(supabaseUrl); } catch { return null; }
  if (parsedUrl.protocol !== 'https:') return null;

  let response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: { apikey: publishableKey, authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(6000)
    });
  } catch { return null; }
  if (!response.ok) return null;
  let identity;
  try { identity = await response.json(); } catch { return null; }
  if (!identity || typeof identity.id !== 'string' || !isEmail(identity.email)) return null;

  const providerId = identity.id;
  const email = identity.email.trim().toLowerCase();
  const metadata = identity.user_metadata && typeof identity.user_metadata === 'object' ? identity.user_metadata : {};
  const fullName = normalizeText(metadata.full_name || metadata.name || email.split('@')[0], 120) || email;
  const phone = normalizeText(identity.phone || metadata.phone || '', 25) || null;
  const emailVerified = identity.email_confirmed_at ? 1 : 0;
  const now = nowIso();

  let profile = await env.DB.prepare(`SELECT id,full_name,email,phone,role,email_verified,status,created_at FROM users WHERE auth_provider_user_id=? LIMIT 1`).bind(providerId).first();
  if (!profile) {
    const sameEmail = await env.DB.prepare(`SELECT id,auth_provider_user_id,status FROM users WHERE email=? COLLATE NOCASE LIMIT 1`).bind(email).first();
    if (sameEmail) {
      // Link an existing legacy profile only when the managed provider confirms ownership of this email.
      if (sameEmail.auth_provider_user_id || !emailVerified || sameEmail.status !== 'active') return null;
      const linked = await env.DB.prepare(`UPDATE users SET auth_provider_user_id=?,full_name=?,phone=?,email_verified=1,updated_at=? WHERE id=? AND auth_provider_user_id IS NULL`)
        .bind(providerId, fullName, phone, now, sameEmail.id).run();
      if (!Number(linked.meta?.changes || 0)) return null;
      profile = await env.DB.prepare(`SELECT id,full_name,email,phone,role,email_verified,status,created_at FROM users WHERE id=? LIMIT 1`).bind(sameEmail.id).first();
    } else {
      const localId = crypto.randomUUID();
      try {
        await env.DB.prepare(`INSERT INTO users (id,full_name,email,phone,password_hash,password_salt,auth_provider_user_id,role,email_verified,status,created_at,updated_at)
          VALUES (?,?,?,?, 'managed-by-supabase','managed-by-supabase',?,'student',?,'active',?,?)`)
          .bind(localId, fullName, email, phone, providerId, emailVerified, now, now).run();
      } catch { return null; }
      profile = await env.DB.prepare(`SELECT id,full_name,email,phone,role,email_verified,status,created_at FROM users WHERE id=? LIMIT 1`).bind(localId).first();
      if (profile) await writeAudit(env, profile, 'user.provisioned_by_managed_auth', 'user', profile.id);
    }
  } else {
    if (profile.status !== 'active') return null;
    try {
      await env.DB.prepare(`UPDATE users SET full_name=?,email=?,phone=?,email_verified=?,updated_at=? WHERE id=?`)
        .bind(fullName, email, phone, emailVerified, now, profile.id).run();
      profile = await env.DB.prepare(`SELECT id,full_name,email,phone,role,email_verified,status,created_at FROM users WHERE id=? LIMIT 1`).bind(profile.id).first();
    } catch { return null; }
  }
  if (!profile || profile.status !== 'active') return null;
  return { ...profile, email_verified: profile.email_verified === 1 || profile.email_verified === true };
}
async function getUser(request, env) {
  if (authCache.has(request)) return authCache.get(request);
  const pending = loadUserFromManagedAuth(request, env).catch(() => null);
  authCache.set(request, pending);
  return pending;
}
async function requireUser(request, env) {
  const user = await getUser(request, env);
  if (!user) return { response: error('Please sign in and confirm your email to continue.', 401, 'AUTH_REQUIRED') };
  return { user };
}
async function requireAdmin(request, env) {
  const result = await requireUser(request, env);
  if (result.response) return result;
  if (result.user.role !== 'admin') return { response: error('Administrator access is required.', 403, 'ADMIN_REQUIRED') };
  return result;
}
async function writeAudit(env, actor, action, entityType, entityId, metadata = null) {
  try {
    await env.DB.prepare(`INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), actor?.id || null, action, entityType || null, entityId || null, metadata ? JSON.stringify(metadata) : null, nowIso()).run();
  } catch (e) { /* Audit log failure must not expose internals to the user; alerting is configured separately. */ }
}
function isEmail(value) { return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254; }
function validateLanguage(value) { return DEFAULT_LANGUAGES.has(String(value || '')) ? String(value) : null; }
function normalizeText(value, max = 4000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }

async function activatePurchase(env, purchase, providerPaymentId, signature) {
  const now = nowIso();
  const plan = await env.DB.prepare('SELECT * FROM plans WHERE slug = ?').bind(purchase.plan_slug).first();
  if (!plan) throw new Error('Purchase plan was not found.');
  await env.DB.prepare(`UPDATE purchases SET status='paid', provider_payment_id=?, provider_signature=?, updated_at=? WHERE id=?`)
    .bind(providerPaymentId || null, signature || null, now, purchase.id).run();
  const expiresAt = plan.validity_days ? addDays(new Date(), Number(plan.validity_days)) : null;
  const entitlementId = crypto.randomUUID();
  await env.DB.prepare(`INSERT OR IGNORE INTO entitlements (id, user_id, plan_slug, purchase_id, status, expires_at, created_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)`)
    .bind(entitlementId, purchase.user_id, purchase.plan_slug, purchase.id, expiresAt, now).run();
  await writeAudit(env, { id: purchase.user_id }, 'payment.activated', 'purchase', purchase.id, { plan_slug: purchase.plan_slug });
}
async function razorpaySignature(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

async function handleAuth(request, env, path, method) {
  if (path === '/api/auth/me' && method === 'GET') {
    const user = await getUser(request, env);
    return json({ user: user || null, auth_configured: Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY) });
  }
  if (['/api/auth/register','/api/auth/login','/api/auth/logout','/api/auth/request-verification','/api/auth/verify-email'].includes(path)) {
    return error('Authentication is managed by the configured identity provider. Use the sign-in form on this site.', 410, 'MANAGED_AUTH_REQUIRED');
  }
  return null;
}

async function handleTests(request, env, path, method, user) {
  if (path === '/api/tests' && method === 'GET') {
    const rows = await env.DB.prepare(`SELECT id, slug, title, description, kind, is_free, question_count, duration_minutes, required_plan_slug, price_paise
      FROM test_configs WHERE status='published' ORDER BY is_free DESC, title ASC`).all();
    const tests = [];
    for (const row of (rows.results || [])) {
      let freeUsed = false;
      let entitled = false;
      if (user) {
        if (row.is_free && user.role !== 'admin') {
          freeUsed = !!(await env.DB.prepare(`SELECT id FROM test_attempts WHERE user_id=? AND test_config_id=? AND access_type='free' LIMIT 1`).bind(user.id, row.id).first());
        }
        if (row.required_plan_slug) {
          entitled = !!(await env.DB.prepare(`SELECT id FROM entitlements WHERE user_id=? AND plan_slug=? AND status='active' AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`).bind(user.id, row.required_plan_slug, nowIso()).first());
        }
      }
      tests.push({ ...row, can_start: user ? (user.role === 'admin' || (row.is_free ? !freeUsed : entitled)) : false, free_used: freeUsed, entitled });
    }
    return json({ tests, languages: LANGUAGES });
  }
  if (path === '/api/tests/start' && method === 'POST') {
    const auth = await requireUser(request, env);
    if (auth.response) return auth.response;
    const activeUser = auth.user;
    if (env.REQUIRE_VERIFIED_EMAIL === 'true' && !activeUser.email_verified) return error('Please verify your email before starting a test.', 403, 'EMAIL_VERIFICATION_REQUIRED');
    let body;
    try { body = await readJson(request, 8000); } catch { return error('Choose a test and language.', 400, 'INVALID_JSON'); }
    const slug = normalizeText(body.slug, 100);
    const languageCode = validateLanguage(body.language_code);
    if (!languageCode) return error('Select a supported language.', 422, 'INVALID_LANGUAGE');
    const config = await env.DB.prepare(`SELECT * FROM test_configs WHERE slug=? AND status='published' LIMIT 1`).bind(slug).first();
    if (!config) return error('This test is not available yet.', 404, 'TEST_NOT_AVAILABLE');
    let accessType = config.is_free ? 'free' : 'entitlement';
    if (activeUser.role === 'admin') accessType = 'admin_preview';
    if (!config.is_free && activeUser.role !== 'admin') {
      if (!config.required_plan_slug) return error('This paid test has not been configured for purchase yet.', 503, 'PAID_TEST_NOT_CONFIGURED');
      const entitlement = await env.DB.prepare(`SELECT id FROM entitlements WHERE user_id=? AND plan_slug=? AND status='active' AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`)
        .bind(activeUser.id, config.required_plan_slug, nowIso()).first();
      if (!entitlement) return error('This test requires an active paid plan.', 402, 'PAYMENT_REQUIRED');
    }
    if (config.is_free && activeUser.role !== 'admin') {
      const used = await env.DB.prepare(`SELECT id FROM test_attempts WHERE user_id=? AND test_config_id=? AND access_type='free' LIMIT 1`).bind(activeUser.id, config.id).first();
      if (used) return error('Your one free test has already been used. Choose a paid plan to continue practising.', 409, 'FREE_TEST_ALREADY_USED');
    }
    const questionRows = await env.DB.prepare(`
      SELECT q.id FROM questions q
      JOIN question_translations qt ON qt.question_id=q.id AND qt.language_code=? AND qt.reviewed_by IS NOT NULL AND qt.reviewed_at IS NOT NULL
      JOIN question_options o ON o.question_id=q.id
      JOIN option_translations ot ON ot.option_id=o.id AND ot.language_code=?
      WHERE q.status='published'
      GROUP BY q.id
      HAVING COUNT(DISTINCT o.id)=4 AND COUNT(DISTINCT ot.option_id)=4 AND SUM(o.is_correct)=1
      ORDER BY RANDOM() LIMIT ?`).bind(languageCode, languageCode, config.question_count).all();
    const questionIds = (questionRows.results || []).map(x => x.id);
    if (questionIds.length < Number(config.question_count)) {
      return error(`This test needs ${config.question_count} approved questions in ${LANGUAGES.find(x => x.code === languageCode)?.name || languageCode}. Only ${questionIds.length} complete questions are currently available. Please choose another language or ask the administrator to add reviewed translations.`, 422, 'INSUFFICIENT_QUESTIONS', { available: questionIds.length, required: config.question_count, language_code: languageCode });
    }
    const started = new Date();
    const attemptId = crypto.randomUUID();
    const attempt = env.DB.prepare(`INSERT INTO test_attempts (id,user_id,test_config_id,language_code,status,access_type,started_at,expires_at,total_questions,created_at)
      VALUES (?,?,?,?,'in_progress',?,?,?,?,?)`).bind(attemptId, activeUser.id, config.id, languageCode, accessType, started.toISOString(), addMinutes(started, Number(config.duration_minutes)), questionIds.length, started.toISOString());
    const inserts = [attempt];
    questionIds.forEach((questionId, index) => inserts.push(env.DB.prepare(`INSERT INTO test_attempt_questions (id,attempt_id,question_id,position) VALUES (?,?,?,?)`).bind(crypto.randomUUID(), attemptId, questionId, index + 1)));
    try { await env.DB.batch(inserts); }
    catch (e) {
      if (config.is_free && activeUser.role !== 'admin') return error('Your one free test has already been used. Choose a paid plan to continue practising.', 409, 'FREE_TEST_ALREADY_USED');
      return error('Could not create this test attempt. Please retry.', 500, 'ATTEMPT_CREATE_FAILED');
    }
    await writeAudit(env, activeUser, 'test.started', 'test_attempt', attemptId, { slug, language_code: languageCode });
    return json({ attempt_id: attemptId, expires_at: addMinutes(started, Number(config.duration_minutes)), total_questions: questionIds.length, duration_minutes: config.duration_minutes, language_code: languageCode, title: config.title }, 201);
  }
  if (path === '/api/tests/history' && method === 'GET') {
    const auth = await requireUser(request, env);
    if (auth.response) return auth.response;
    const rows = await env.DB.prepare(`SELECT a.id, a.language_code, a.status, a.access_type, a.started_at, a.submitted_at, a.score, a.total_questions, c.title, c.slug
      FROM test_attempts a JOIN test_configs c ON c.id=a.test_config_id WHERE a.user_id=? ORDER BY a.created_at DESC LIMIT 50`).bind(auth.user.id).all();
    return json({ attempts: rows.results || [] });
  }
  const attemptMatch = path.match(/^\/api\/tests\/attempt\/([a-f0-9-]+)$/i);
  if (attemptMatch && method === 'GET') {
    const auth = await requireUser(request, env);
    if (auth.response) return auth.response;
    return getAttemptResponse(env, auth.user, attemptMatch[1]);
  }
  if (path === '/api/tests/answer' && method === 'POST') {
    const auth = await requireUser(request, env);
    if (auth.response) return auth.response;
    let body;
    try { body = await readJson(request, 8000); } catch { return error('Invalid answer.', 400, 'INVALID_JSON'); }
    const attemptId = normalizeText(body.attempt_id, 60);
    const questionId = normalizeText(body.question_id, 60);
    const optionKey = normalizeText(body.option_key, 1).toUpperCase();
    if (!['A','B','C','D'].includes(optionKey)) return error('Choose one of the available options.', 422, 'INVALID_OPTION');
    const attempt = await env.DB.prepare('SELECT * FROM test_attempts WHERE id=? AND user_id=?').bind(attemptId, auth.user.id).first();
    if (!attempt) return error('Test attempt was not found.', 404, 'ATTEMPT_NOT_FOUND');
    if (attempt.status !== 'in_progress') return error('This test is no longer accepting answers.', 409, 'ATTEMPT_CLOSED');
    if (attempt.expires_at <= nowIso()) {
      await finalizeAttempt(env, attempt);
      return error('Time is over. Your attempt has been submitted.', 409, 'TIME_EXPIRED');
    }
    const item = await env.DB.prepare('SELECT id FROM test_attempt_questions WHERE attempt_id=? AND question_id=?').bind(attemptId, questionId).first();
    if (!item) return error('Question does not belong to this attempt.', 404, 'QUESTION_NOT_IN_ATTEMPT');
    await env.DB.prepare('UPDATE test_attempt_questions SET selected_option_key=?, answered_at=? WHERE id=?').bind(optionKey, nowIso(), item.id).run();
    return json({ ok: true });
  }
  const submitMatch = path.match(/^\/api\/tests\/attempt\/([a-f0-9-]+)\/submit$/i);
  if (submitMatch && method === 'POST') {
    const auth = await requireUser(request, env);
    if (auth.response) return auth.response;
    const attempt = await env.DB.prepare('SELECT * FROM test_attempts WHERE id=? AND user_id=?').bind(submitMatch[1], auth.user.id).first();
    if (!attempt) return error('Test attempt was not found.', 404, 'ATTEMPT_NOT_FOUND');
    if (attempt.status === 'in_progress') await finalizeAttempt(env, attempt);
    return getAttemptResponse(env, auth.user, submitMatch[1]);
  }
  return null;
}

async function finalizeAttempt(env, attempt) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS correct_count FROM test_attempt_questions tq
    JOIN question_options o ON o.question_id=tq.question_id AND o.option_key=tq.selected_option_key AND o.is_correct=1
    WHERE tq.attempt_id=?`).bind(attempt.id).first();
  const score = Number(row?.correct_count || 0);
  const status = attempt.expires_at <= nowIso() ? 'expired' : 'completed';
  await env.DB.prepare(`UPDATE test_attempts SET status=?, submitted_at=?, score=? WHERE id=? AND status='in_progress'`)
    .bind(status === 'expired' ? 'completed' : status, nowIso(), score, attempt.id).run();
  await writeAudit(env, { id: attempt.user_id }, 'test.submitted', 'test_attempt', attempt.id, { score, total_questions: attempt.total_questions });
}
async function getAttemptResponse(env, user, attemptId) {
  let attempt = await env.DB.prepare(`SELECT a.*, c.title, c.description, c.duration_minutes FROM test_attempts a JOIN test_configs c ON c.id=a.test_config_id WHERE a.id=? AND a.user_id=? LIMIT 1`).bind(attemptId, user.id).first();
  if (!attempt) return error('Test attempt was not found.', 404, 'ATTEMPT_NOT_FOUND');
  if (attempt.status === 'in_progress' && attempt.expires_at <= nowIso()) {
    await finalizeAttempt(env, attempt);
    attempt = await env.DB.prepare(`SELECT a.*, c.title, c.description, c.duration_minutes FROM test_attempts a JOIN test_configs c ON c.id=a.test_config_id WHERE a.id=? AND a.user_id=? LIMIT 1`).bind(attemptId, user.id).first();
  }
  const rows = await env.DB.prepare(`SELECT tq.id AS attempt_question_id, tq.question_id, tq.position, tq.selected_option_key,
    q.question_key, q.category, q.topic, q.difficulty, qt.question_text, qt.explanation_text
    FROM test_attempt_questions tq JOIN questions q ON q.id=tq.question_id
    JOIN question_translations qt ON qt.question_id=q.id AND qt.language_code=?
    WHERE tq.attempt_id=? ORDER BY tq.position`).bind(attempt.language_code, attemptId).all();
  const ids = (rows.results || []).map(r => r.question_id);
  const opts = ids.length ? await env.DB.prepare(`SELECT o.question_id, o.option_key, o.is_correct, ot.option_text FROM question_options o
    JOIN option_translations ot ON ot.option_id=o.id AND ot.language_code=?
    WHERE o.question_id IN (${ids.map(() => '?').join(',')}) ORDER BY o.option_key`).bind(attempt.language_code, ...ids).all() : { results: [] };
  const byQuestion = new Map();
  for (const option of (opts.results || [])) {
    if (!byQuestion.has(option.question_id)) byQuestion.set(option.question_id, []);
    byQuestion.get(option.question_id).push({ key: option.option_key, text: option.option_text, ...(attempt.status === 'completed' ? { is_correct: option.is_correct === 1 } : {}) });
  }
  const questions = (rows.results || []).map((row) => ({
    id: row.question_id,
    position: row.position,
    question_key: row.question_key,
    category: row.category,
    topic: row.topic,
    difficulty: row.difficulty,
    question_text: row.question_text,
    options: byQuestion.get(row.question_id) || [],
    selected_option_key: row.selected_option_key,
    ...(attempt.status === 'completed' ? { explanation_text: row.explanation_text || '', correct_option_key: (byQuestion.get(row.question_id) || []).find(o => o.is_correct)?.key || null } : {})
  }));
  const correctCount = attempt.status === 'completed' ? Number(attempt.score || 0) : null;
  return json({ attempt: {
    id: attempt.id, title: attempt.title, description: attempt.description, language_code: attempt.language_code,
    status: attempt.status, started_at: attempt.started_at, expires_at: attempt.expires_at, submitted_at: attempt.submitted_at,
    total_questions: attempt.total_questions, score: correctCount,
    percentage: correctCount == null || !attempt.total_questions ? null : Math.round((correctCount / attempt.total_questions) * 100)
  }, questions });
}

async function handleAdmin(request, env, path, method, user) {
  if (path === '/api/admin/bootstrap' && method === 'POST') {
    if (!user) return error('Sign in with an email-confirmed managed-auth account first.', 401, 'AUTH_REQUIRED');
    if (!user.email_verified) return error('Confirm this account email before creating the first administrator.', 403, 'EMAIL_CONFIRMATION_REQUIRED');
    if (!env.ADMIN_BOOTSTRAP_KEY) return error('ADMIN_BOOTSTRAP_KEY has not been configured as a Worker secret.', 503, 'BOOTSTRAP_NOT_CONFIGURED');
    const supplied = request.headers.get('x-bootstrap-key') || '';
    if (!equalConstantTime(supplied, env.ADMIN_BOOTSTRAP_KEY)) return error('Invalid bootstrap key.', 403, 'INVALID_BOOTSTRAP_KEY');
    let body;
    try { body = await readJson(request, 5000); } catch { return error('Invalid bootstrap request.', 400, 'INVALID_JSON'); }
    const fullName = normalizeText(body.full_name, 120) || user.full_name;
    if (fullName.length < 2) return error('Provide a valid administrator name.', 422, 'VALIDATION_ERROR');
    // A single conditional statement makes first-admin promotion safe against simultaneous requests.
    const now = nowIso();
    const promoted = await env.DB.prepare(`UPDATE users SET role='admin',full_name=?,updated_at=? WHERE id=? AND status='active' AND NOT EXISTS (SELECT 1 FROM users WHERE role='admin')`)
      .bind(fullName, now, user.id).run();
    if (!Number(promoted.meta?.changes || 0)) {
      const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE role='admin'`).first();
      if (Number(count?.n || 0) > 0) return error('An administrator already exists. Bootstrap is disabled.', 409, 'ADMIN_ALREADY_EXISTS');
      return error('The signed-in account could not be promoted. Confirm its email and retry.', 409, 'ADMIN_CREATE_FAILED');
    }
    await writeAudit(env, user, 'admin.bootstrapped', 'user', user.id);
    return json({ ok: true, message: 'Administrator role granted. Immediately delete ADMIN_BOOTSTRAP_KEY from Worker secrets and sign in at /admin.html.' }, 201);
  }
  if (!path.startsWith('/api/admin/')) return null;
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;
  user = auth.user;

  if (path === '/api/admin/stats' && method === 'GET') {
    const results = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE role=\'student\'').first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM questions WHERE status=\'draft\'').first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM questions WHERE status=\'published\'').first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM test_attempts').first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM test_attempts WHERE status=\'completed\'').first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM live_classes WHERE status=\'published\' AND starts_at > ?').bind(nowIso()).first()
    ]);
    return json({ stats: { students: Number(results[0]?.n || 0), draft_questions: Number(results[1]?.n || 0), published_questions: Number(results[2]?.n || 0), attempts: Number(results[3]?.n || 0), completed_attempts: Number(results[4]?.n || 0), upcoming_classes: Number(results[5]?.n || 0) } });
  }
  if (path === '/api/admin/questions' && method === 'GET') {
    const url = new URL(request.url);
    const status = ['draft','published','archived','all'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'all';
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 250);
    const where = status === 'all' ? '' : 'WHERE q.status = ?';
    const stmt = status === 'all'
      ? env.DB.prepare(`SELECT q.id,q.question_key,q.category,q.topic,q.difficulty,q.status,q.created_at,q.updated_at, GROUP_CONCAT(qt.language_code, ',') AS languages FROM questions q LEFT JOIN question_translations qt ON qt.question_id=q.id GROUP BY q.id ORDER BY q.updated_at DESC LIMIT ?`).bind(limit)
      : env.DB.prepare(`SELECT q.id,q.question_key,q.category,q.topic,q.difficulty,q.status,q.created_at,q.updated_at, GROUP_CONCAT(qt.language_code, ',') AS languages FROM questions q LEFT JOIN question_translations qt ON qt.question_id=q.id ${where} GROUP BY q.id ORDER BY q.updated_at DESC LIMIT ?`).bind(status, limit);
    const rows = await stmt.all();
    return json({ questions: rows.results || [] });
  }
  if (path === '/api/admin/questions/import' && method === 'POST') {
    let body;
    try { body = await readJson(request, 1_500_000); } catch { return error('The import file is too large or invalid. Try smaller CSV batches.', 400, 'INVALID_JSON'); }
    const rows = body.rows;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 300) return error('Submit between 1 and 300 CSV rows per import.', 422, 'INVALID_IMPORT_ROWS');
    const imported = [];
    const rowErrors = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const key = normalizeText(row.question_key, 80);
      const languageCode = validateLanguage(row.language_code);
      const questionText = normalizeText(row.question_text, 6000);
      const topic = normalizeText(row.topic, 160) || 'General DRA';
      const category = normalizeText(row.category, 160) || 'DRA';
      const difficulty = ['easy','medium','hard'].includes(row.difficulty) ? row.difficulty : 'medium';
      const correctKey = normalizeText(row.correct_option, 1).toUpperCase();
      const options = { A: normalizeText(row.option_a, 2000), B: normalizeText(row.option_b, 2000), C: normalizeText(row.option_c, 2000), D: normalizeText(row.option_d, 2000) };
      if (!key || !languageCode || questionText.length < 5 || !['A','B','C','D'].includes(correctKey) || Object.values(options).some(x => x.length < 1)) {
        rowErrors.push({ row: i + 2, question_key: key || null, message: 'Missing question_key, supported language, question text, one correct option (A–D) or one of the four option texts.' });
        continue;
      }
      try {
        let q = await env.DB.prepare('SELECT * FROM questions WHERE question_key=?').bind(key).first();
        const now = nowIso();
        if (!q) {
          const qid = crypto.randomUUID();
          await env.DB.prepare(`INSERT INTO questions (id,question_key,category,topic,difficulty,status,source_note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'draft',?,?,?,?)`)
            .bind(qid, key, category, topic, difficulty, normalizeText(row.source_note, 500) || null, user.id, now, now).run();
          q = { id: qid, question_key: key };
        } else {
          await env.DB.prepare(`UPDATE questions SET category=?, topic=?, difficulty=?, status='draft', updated_at=? WHERE id=?`)
            .bind(category, topic, difficulty, now, q.id).run();
        }
        for (const optKey of ['A','B','C','D']) {
          let option = await env.DB.prepare('SELECT * FROM question_options WHERE question_id=? AND option_key=?').bind(q.id, optKey).first();
          if (!option) {
            const optId = crypto.randomUUID();
            await env.DB.prepare('INSERT INTO question_options (id,question_id,option_key,is_correct) VALUES (?,?,?,?)').bind(optId, q.id, optKey, optKey === correctKey ? 1 : 0).run();
            option = { id: optId, is_correct: optKey === correctKey ? 1 : 0 };
          } else {
            await env.DB.prepare('UPDATE question_options SET is_correct=? WHERE id=?').bind(optKey === correctKey ? 1 : 0, option.id).run();
          }
          await env.DB.prepare(`INSERT INTO option_translations (option_id,language_code,option_text,created_at,updated_at) VALUES (?,?,?,?,?)
            ON CONFLICT(option_id,language_code) DO UPDATE SET option_text=excluded.option_text, updated_at=excluded.updated_at`)
            .bind(option.id, languageCode, options[optKey], now, now).run();
        }
        await env.DB.prepare(`INSERT INTO question_translations (question_id,language_code,question_text,explanation_text,reviewed_by,reviewed_at,created_at,updated_at)
          VALUES (?,?,?,?,NULL,NULL,?,?) ON CONFLICT(question_id,language_code) DO UPDATE SET question_text=excluded.question_text, explanation_text=excluded.explanation_text, reviewed_by=NULL, reviewed_at=NULL, updated_at=excluded.updated_at`)
          .bind(q.id, languageCode, questionText, normalizeText(row.explanation, 5000), now, now).run();
        imported.push({ question_key: key, language_code: languageCode, question_id: q.id });
      } catch (e) {
        rowErrors.push({ row: i + 2, question_key: key, message: 'Could not import this row. Check duplicate keys, database state and option correctness across languages.' });
      }
    }
    await writeAudit(env, user, 'question.bulk_imported', 'question_bank', null, { imported_rows: imported.length, row_errors: rowErrors.length });
    return json({ imported_rows: imported.length, errors: rowErrors.length, imported, row_errors: rowErrors, note: 'Imported questions are set to Draft and must be reviewed and published.' }, 200);
  }
  const reviewMatch = path.match(/^\/api\/admin\/questions\/([^/]+)\/review$/);
  if (reviewMatch && method === 'POST') {
    let body;
    try { body = await readJson(request, 5000); } catch { return error('Select the language to review.', 400, 'INVALID_JSON'); }
    const id = decodeURIComponent(reviewMatch[1]);
    const languageCode = validateLanguage(body.language_code);
    if (!languageCode) return error('Select a supported language.', 422, 'INVALID_LANGUAGE');
    const readiness = await env.DB.prepare(`SELECT qt.question_id, COUNT(DISTINCT o.id) AS option_count,
      COUNT(DISTINCT ot.option_id) AS translated_option_count, SUM(o.is_correct) AS correct_count
      FROM question_translations qt JOIN question_options o ON o.question_id=qt.question_id
      LEFT JOIN option_translations ot ON ot.option_id=o.id AND ot.language_code=qt.language_code
      WHERE qt.question_id=? AND qt.language_code=? GROUP BY qt.question_id`).bind(id, languageCode).first();
    if (!readiness) return error('This language has no imported question text.', 404, 'TRANSLATION_NOT_FOUND');
    if (Number(readiness.option_count) !== 4 || Number(readiness.translated_option_count) !== 4 || Number(readiness.correct_count) !== 1) {
      return error('This language needs four translated options and exactly one correct answer before it can be marked reviewed.', 422, 'TRANSLATION_NOT_READY');
    }
    const reviewedAt = nowIso();
    await env.DB.prepare('UPDATE question_translations SET reviewed_by=?, reviewed_at=?, updated_at=? WHERE question_id=? AND language_code=?')
      .bind(user.id, reviewedAt, reviewedAt, id, languageCode).run();
    const question = await env.DB.prepare('SELECT question_key FROM questions WHERE id=?').bind(id).first();
    await writeAudit(env, user, 'question.translation_reviewed', 'question', id, { question_key: question?.question_key, language_code: languageCode });
    return json({ ok: true, language_code: languageCode, reviewed_at: reviewedAt });
  }
  const questionDetailMatch = path.match(/^\/api\/admin\/questions\/([^/]+)$/);
  if (questionDetailMatch && method === 'GET') {
    const id = decodeURIComponent(questionDetailMatch[1]);
    const question = await env.DB.prepare('SELECT id,question_key,category,topic,difficulty,status,source_note,created_at,updated_at FROM questions WHERE id=?').bind(id).first();
    if (!question) return error('Question not found.', 404, 'QUESTION_NOT_FOUND');
    const translations = await env.DB.prepare('SELECT language_code,question_text,explanation_text,reviewed_by,reviewed_at FROM question_translations WHERE question_id=? ORDER BY language_code').bind(id).all();
    const options = await env.DB.prepare(`SELECT o.id,o.option_key,o.is_correct,ot.language_code,ot.option_text FROM question_options o LEFT JOIN option_translations ot ON ot.option_id=o.id WHERE o.question_id=? ORDER BY o.option_key,ot.language_code`).bind(id).all();
    const byLanguage = new Map();
    for (const t of (translations.results || [])) byLanguage.set(t.language_code, { language_code: t.language_code, question_text: t.question_text, explanation_text: t.explanation_text, reviewed_by: t.reviewed_by, reviewed_at: t.reviewed_at, options: [] });
    for (const o of (options.results || [])) {
      if (!o.language_code) continue;
      if (!byLanguage.has(o.language_code)) byLanguage.set(o.language_code, { language_code: o.language_code, question_text: '', explanation_text: '', reviewed_by: null, reviewed_at: null, options: [] });
      byLanguage.get(o.language_code).options.push({ key: o.option_key, text: o.option_text, is_correct: Number(o.is_correct) === 1 });
    }
    return json({ question, translations: [...byLanguage.values()] });
  }
  const statusMatch = path.match(/^\/api\/admin\/questions\/([^/]+)\/status$/);
  if (statusMatch && method === 'POST') {
    let body;
    try { body = await readJson(request, 5000); } catch { return error('Select a question status.', 400, 'INVALID_JSON'); }
    const status = ['draft','published','archived'].includes(body.status) ? body.status : null;
    if (!status) return error('Invalid question status.', 422, 'INVALID_STATUS');
    const id = decodeURIComponent(statusMatch[1]);
    const q = await env.DB.prepare('SELECT id,question_key FROM questions WHERE id=?').bind(id).first();
    if (!q) return error('Question not found.', 404, 'QUESTION_NOT_FOUND');
    if (status === 'published') {
      const ready = await env.DB.prepare(`SELECT qt.language_code FROM question_translations qt
        JOIN question_options o ON o.question_id=qt.question_id
        JOIN option_translations ot ON ot.option_id=o.id AND ot.language_code=qt.language_code
        WHERE qt.question_id=? AND qt.reviewed_by IS NOT NULL AND qt.reviewed_at IS NOT NULL
        GROUP BY qt.language_code
        HAVING COUNT(DISTINCT o.id)=4 AND COUNT(DISTINCT ot.option_id)=4 AND SUM(o.is_correct)=1 LIMIT 1`).bind(id).first();
      if (!ready) return error('Before publishing, review at least one complete language version and mark it reviewed. It must have the question, four translated options and exactly one correct answer.', 422, 'QUESTION_NOT_READY');
    }
    await env.DB.prepare('UPDATE questions SET status=?,updated_at=? WHERE id=?').bind(status, nowIso(), id).run();
    await writeAudit(env, user, `question.${status}`, 'question', id, { question_key: q.question_key });
    return json({ ok: true, status });
  }
  if (path === '/api/admin/test-configs' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT * FROM test_configs ORDER BY is_free DESC, title').all();
    return json({ configs: rows.results || [] });
  }
  const configMatch = path.match(/^\/api\/admin\/test-configs\/([^/]+)$/);
  if (configMatch && method === 'PUT') {
    let body;
    try { body = await readJson(request, 6000); } catch { return error('Invalid test settings.', 400, 'INVALID_JSON'); }
    const slug = decodeURIComponent(configMatch[1]);
    const current = await env.DB.prepare('SELECT * FROM test_configs WHERE slug=?').bind(slug).first();
    if (!current) return error('Test configuration not found.', 404, 'TEST_CONFIG_NOT_FOUND');
    const questionCount = Math.max(1, Math.min(Number(body.question_count || current.question_count), 200));
    const duration = Math.max(1, Math.min(Number(body.duration_minutes || current.duration_minutes), 240));
    const status = ['draft','published','archived'].includes(body.status) ? body.status : current.status;
    const priceInr = body.price_inr === null || body.price_inr === '' || body.price_inr === undefined ? current.price_paise == null ? null : current.price_paise / 100 : Number(body.price_inr);
    if (priceInr !== null && (!Number.isFinite(priceInr) || priceInr < 0 || priceInr > 100000)) return error('Enter a valid price.', 422, 'INVALID_PRICE');
    if (status === 'published') {
      const readyLanguages = await env.DB.prepare(`SELECT qt.language_code, COUNT(DISTINCT q.id) AS question_count
        FROM questions q
        JOIN question_translations qt ON qt.question_id=q.id
        JOIN question_options o ON o.question_id=q.id
        JOIN option_translations ot ON ot.option_id=o.id AND ot.language_code=qt.language_code
        WHERE q.status='published' AND qt.reviewed_by IS NOT NULL AND qt.reviewed_at IS NOT NULL
        GROUP BY qt.language_code, q.id
        HAVING COUNT(DISTINCT o.id)=4 AND COUNT(DISTINCT ot.option_id)=4 AND SUM(o.is_correct)=1`).all();
      const counts = new Map();
      for (const item of (readyLanguages.results || [])) counts.set(item.language_code, (counts.get(item.language_code) || 0) + 1);
      const bestCount = Math.max(0, ...counts.values());
      if (bestCount < questionCount) return error(`This test requires at least ${questionCount} published questions with complete options and reviewed text in one language. The current largest language bank has ${bestCount}.`, 422, 'INSUFFICIENT_PUBLISHED_QUESTIONS', { required: questionCount, available: bestCount });
    }
    await env.DB.prepare('UPDATE test_configs SET question_count=?,duration_minutes=?,status=?,price_paise=?,updated_at=? WHERE slug=?')
      .bind(questionCount, duration, status, priceInr == null ? null : Math.round(priceInr * 100), nowIso(), slug).run();
    await writeAudit(env, user, 'test_config.updated', 'test_config', current.id, { question_count: questionCount, duration_minutes: duration, status });
    return json({ ok: true });
  }
  if (path === '/api/admin/plans' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT * FROM plans ORDER BY name').all();
    return json({ plans: rows.results || [] });
  }
  const planMatch = path.match(/^\/api\/admin\/plans\/([^/]+)$/);
  if (planMatch && method === 'PUT') {
    let body;
    try { body = await readJson(request, 6000); } catch { return error('Invalid plan settings.', 400, 'INVALID_JSON'); }
    const slug = decodeURIComponent(planMatch[1]);
    const current = await env.DB.prepare('SELECT * FROM plans WHERE slug=?').bind(slug).first();
    if (!current) return error('Plan not found.', 404, 'PLAN_NOT_FOUND');
    const price = body.price_inr === '' || body.price_inr === null || body.price_inr === undefined ? null : Number(body.price_inr);
    const status = ['draft','active','archived'].includes(body.status) ? body.status : current.status;
    const validity = body.validity_days === '' || body.validity_days === undefined ? current.validity_days : Math.max(1, Math.min(Number(body.validity_days), 3650));
    const maxTests = body.max_mock_tests === '' || body.max_mock_tests === undefined ? current.max_mock_tests : body.max_mock_tests == null ? null : Math.max(1, Math.min(Number(body.max_mock_tests), 1000));
    if (price !== null && (!Number.isFinite(price) || price < 1 || price > 100000)) return error('Set a price between ₹1 and ₹1,00,000.', 422, 'INVALID_PRICE');
    if (status === 'active' && price === null && current.price_paise == null) return error('Set the plan price before activating it.', 422, 'PRICE_REQUIRED');
    if (status === 'active' && (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET)) return error('Set up both Razorpay key secrets before activating a paid plan.', 422, 'PAYMENT_GATEWAY_NOT_CONFIGURED');
    await env.DB.prepare('UPDATE plans SET price_paise=?,status=?,validity_days=?,max_mock_tests=?,updated_at=? WHERE slug=?')
      .bind(price === null ? current.price_paise : Math.round(price * 100), status, validity, maxTests, nowIso(), slug).run();
    await writeAudit(env, user, 'plan.updated', 'plan', current.id, { status, price_inr: price });
    return json({ ok: true });
  }
  if (path === '/api/admin/classes' && method === 'POST') {
    let body;
    try { body = await readJson(request, 20_000); } catch { return error('Invalid class form.', 400, 'INVALID_JSON'); }
    const title = normalizeText(body.title, 200);
    const startsAt = normalizeText(body.starts_at, 60);
    const language = validateLanguage(body.language_code) || 'hi';
    if (title.length < 4 || !startsAt || !Number.isFinite(Date.parse(startsAt))) return error('Enter a class title and valid start date/time.', 422, 'VALIDATION_ERROR');
    const isPaid = body.is_paid ? 1 : 0;
    const meetingUrl = normalizeText(body.meeting_url, 1000) || null;
    if (meetingUrl) {
      try { if (new URL(meetingUrl).protocol !== 'https:') return error('Meeting links must use HTTPS.', 422, 'INVALID_MEETING_URL'); }
      catch { return error('Enter a valid HTTPS meeting URL.', 422, 'INVALID_MEETING_URL'); }
    }
    const id = crypto.randomUUID();
    const now = nowIso();
    await env.DB.prepare(`INSERT INTO live_classes (id,title,description,language_code,instructor_name,starts_at,duration_minutes,meeting_url,is_paid,required_plan_slug,status,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?, ?,?,?)`)
      .bind(id, title, normalizeText(body.description, 4000), language, normalizeText(body.instructor_name, 120) || 'DRA Community India', new Date(startsAt).toISOString(), Math.max(15, Math.min(Number(body.duration_minutes || 60), 360)), meetingUrl, isPaid, isPaid ? normalizeText(body.required_plan_slug, 100) || 'dra-live-classes' : null, body.status === 'draft' ? 'draft' : 'published', user.id, now, now).run();
    await writeAudit(env, user, 'class.created', 'live_class', id, { title });
    return json({ ok: true, class_id: id }, 201);
  }
  if (path === '/api/admin/classes' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT id,title,language_code,instructor_name,starts_at,duration_minutes,is_paid,status,created_at FROM live_classes ORDER BY starts_at DESC LIMIT 100').all();
    return json({ classes: rows.results || [] });
  }
  return error('Admin API route not found.', 404, 'NOT_FOUND');
}

async function handleClasses(request, env, path, method, user) {
  if (path === '/api/classes' && method === 'GET') {
    const rows = await env.DB.prepare(`SELECT id,title,description,language_code,instructor_name,starts_at,duration_minutes,is_paid,required_plan_slug,status FROM live_classes WHERE status='published' AND starts_at > ? ORDER BY starts_at ASC LIMIT 100`).bind(nowIso()).all();
    return json({ classes: rows.results || [] });
  }
  const joinMatch = path.match(/^\/api\/classes\/([^/]+)\/join$/);
  if (joinMatch && method === 'POST') {
    const auth = await requireUser(request, env);
    if (auth.response) return auth.response;
    const id = decodeURIComponent(joinMatch[1]);
    const liveClass = await env.DB.prepare(`SELECT * FROM live_classes WHERE id=? AND status='published'`).bind(id).first();
    if (!liveClass) return error('This class is not available.', 404, 'CLASS_NOT_FOUND');
    if (liveClass.is_paid) {
      const plan = liveClass.required_plan_slug || 'dra-live-classes';
      const entitlement = await env.DB.prepare(`SELECT id FROM entitlements WHERE user_id=? AND plan_slug=? AND status='active' AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`).bind(auth.user.id, plan, nowIso()).first();
      if (!entitlement) return error('This class requires the relevant paid plan.', 402, 'PAYMENT_REQUIRED');
    }
    if (!liveClass.meeting_url) return error('The host has not added a meeting link yet.', 409, 'MEETING_LINK_PENDING');
    await env.DB.prepare(`INSERT OR IGNORE INTO class_enrollments (id,class_id,user_id,status,created_at) VALUES (?,?,?,'active',?)`).bind(crypto.randomUUID(), id, auth.user.id, nowIso()).run();
    return json({ join_url: liveClass.meeting_url, title: liveClass.title });
  }
  return null;
}

async function handlePayments(request, env, path, method, user) {
  if (path === '/api/plans' && method === 'GET') {
    const rows = await env.DB.prepare(`SELECT slug,name,description,price_paise,validity_days,max_mock_tests,includes_classes FROM plans WHERE status='active' AND price_paise IS NOT NULL ORDER BY price_paise`).all();
    return json({ plans: rows.results || [], payment_enabled: !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) });
  }
  if (path === '/api/payments/create-order' && method === 'POST') {
    const auth = await requireUser(request, env);
    if (auth.response) return auth.response;
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return error('Online payments are not configured yet. You can still use the free starter mock.', 503, 'PAYMENTS_NOT_CONFIGURED');
    let body;
    try { body = await readJson(request, 6000); } catch { return error('Choose a plan first.', 400, 'INVALID_JSON'); }
    const slug = normalizeText(body.plan_slug, 100);
    const plan = await env.DB.prepare(`SELECT * FROM plans WHERE slug=? AND status='active' AND price_paise > 0`).bind(slug).first();
    if (!plan) return error('This plan is not available for purchase.', 404, 'PLAN_NOT_AVAILABLE');
    const receipt = `dra_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { authorization: `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ amount: plan.price_paise, currency: 'INR', receipt, notes: { user_id: auth.user.id, plan_slug: plan.slug, app: 'dra.lextalk.legal' } })
    });
    if (!response.ok) return error('Payment gateway could not create an order. No payment has been taken.', 502, 'PAYMENT_ORDER_FAILED');
    const order = await response.json();
    const id = crypto.randomUUID();
    const now = nowIso();
    await env.DB.prepare(`INSERT INTO purchases (id,user_id,plan_slug,amount_paise,currency,status,provider,provider_order_id,created_at,updated_at) VALUES (?,?,?,?,'INR','pending','razorpay',?,?,?)`)
      .bind(id, auth.user.id, plan.slug, plan.price_paise, order.id, now, now).run();
    return json({ key_id: env.RAZORPAY_KEY_ID, order_id: order.id, amount: order.amount, currency: order.currency, plan: { slug: plan.slug, name: plan.name, description: plan.description } }, 201);
  }
  if (path === '/api/payments/verify' && method === 'POST') {
    const auth = await requireUser(request, env);
    if (auth.response) return auth.response;
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return error('Payment verification is not configured.', 503, 'PAYMENTS_NOT_CONFIGURED');
    let body;
    try { body = await readJson(request, 10_000); } catch { return error('Invalid payment confirmation.', 400, 'INVALID_JSON'); }
    const orderId = normalizeText(body.razorpay_order_id, 100);
    const paymentId = normalizeText(body.razorpay_payment_id, 100);
    const signature = normalizeText(body.razorpay_signature, 256);
    const purchase = await env.DB.prepare(`SELECT * FROM purchases WHERE provider_order_id=? AND user_id=?`).bind(orderId, auth.user.id).first();
    if (!purchase) return error('Purchase order not found.', 404, 'PURCHASE_NOT_FOUND');
    if (purchase.status === 'paid') return json({ ok: true, message: 'This payment has already been verified.' });
    const expected = await razorpaySignature(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
    if (!equalConstantTime(expected, signature)) return error('Payment signature could not be verified.', 400, 'INVALID_PAYMENT_SIGNATURE');
    const paymentLookup = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { authorization: `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}` }
    });
    if (!paymentLookup.ok) return error('Payment signature was accepted, but the gateway payment status could not be confirmed. Access has not been activated.', 502, 'PAYMENT_STATUS_UNCONFIRMED');
    const paymentDetails = await paymentLookup.json();
    if (paymentDetails.order_id !== orderId || Number(paymentDetails.amount) !== Number(purchase.amount_paise) || paymentDetails.currency !== 'INR') return error('Payment details do not match this order. Access has not been activated.', 400, 'PAYMENT_DETAILS_MISMATCH');
    if (paymentDetails.status !== 'captured') return error('Payment is not captured yet. Your access will activate after the gateway confirms capture.', 409, 'PAYMENT_NOT_CAPTURED');
    await activatePurchase(env, purchase, paymentId, signature);
    return json({ ok: true, message: 'Payment captured, verified and access activated.' });
  }
  if (path === '/api/payments/webhook' && method === 'POST') {
    if (!env.RAZORPAY_WEBHOOK_SECRET) return error('Webhook secret not configured.', 503, 'WEBHOOK_NOT_CONFIGURED');
    const raw = await request.text();
    const signature = request.headers.get('x-razorpay-signature') || '';
    const expected = await razorpaySignature(env.RAZORPAY_WEBHOOK_SECRET, raw);
    if (!equalConstantTime(expected, signature)) return error('Invalid webhook signature.', 400, 'INVALID_WEBHOOK_SIGNATURE');
    let event;
    try { event = JSON.parse(raw); } catch { return error('Invalid webhook payload.', 400, 'INVALID_JSON'); }
    if (event.event === 'payment.captured') {
      const payment = event.payload?.payment?.entity;
      const orderId = payment?.order_id;
      if (orderId) {
        const purchase = await env.DB.prepare('SELECT * FROM purchases WHERE provider_order_id=?').bind(orderId).first();
        if (purchase && purchase.status !== 'paid' && Number(payment.amount) === Number(purchase.amount_paise) && payment.currency === purchase.currency) await activatePurchase(env, purchase, payment.id, signature);
      }
    }
    return json({ ok: true });
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      if (!env.ASSETS) return new Response('DRA Learning assets binding is not configured.', { status: 500 });
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('x-content-type-options', 'nosniff');
      headers.set('referrer-policy', 'strict-origin-when-cross-origin');
      headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
      headers.set('x-frame-options', 'DENY');
      headers.set('content-security-policy', "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' https://cdn.jsdelivr.net https://checkout.razorpay.com; style-src 'self' 'unsafe-inline'; img-src 'self' https://lextalk.legal data:; connect-src 'self' https://*.supabase.co https://api.razorpay.com https://*.razorpay.com; frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com https://*.razorpay.com");
      if (url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname === '/auth-config.js') headers.set('cache-control', 'no-store, max-age=0');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    if (!env.DB) return error('Database binding is not configured.', 503, 'DATABASE_NOT_CONFIGURED');
    const path = url.pathname;
    const method = request.method.toUpperCase();
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: 'GET, POST, PUT, OPTIONS' } });
    if (method !== 'GET' && path !== '/api/payments/webhook' && (!request.headers.get('origin') || !assertSameOrigin(request))) return error('Cross-origin or origin-less state-changing request blocked.', 403, 'ORIGIN_NOT_ALLOWED');
    try {
      if (path === '/api/health' && method === 'GET') {
        const row = await env.DB.prepare('SELECT 1 AS ok').first();
        return json({ ok: Number(row?.ok) === 1, app: env.APP_NAME || 'DRA Learning', time: nowIso() });
      }
      const authResponse = await handleAuth(request, env, path, method);
      if (authResponse) return authResponse;
      const user = await getUser(request, env);
      const adminResponse = await handleAdmin(request, env, path, method, user);
      if (adminResponse) return adminResponse;
      const testResponse = await handleTests(request, env, path, method, user);
      if (testResponse) return testResponse;
      const classResponse = await handleClasses(request, env, path, method, user);
      if (classResponse) return classResponse;
      const paymentResponse = await handlePayments(request, env, path, method, user);
      if (paymentResponse) return paymentResponse;
      if (path === '/api/config' && method === 'GET') {
        return json({ app_name: env.APP_NAME || 'DRA Learning | Lex Talk Legal', languages: LANGUAGES, official_exam_url: 'https://www.iibf.org.in/certificate-examination-for-DRA', demo_question_bank: true, payment_enabled: !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET), community_whatsapp_url: env.COMMUNITY_WHATSAPP_URL || null });
      }
      if (path === '/api/classes' && method === 'GET') return json({ classes: [] });
      return error('API route not found.', 404, 'NOT_FOUND');
    } catch (e) {
      // Keep internal exception details out of client responses. Use Worker logs for debugging.
      console.error('DRA API error', { path, message: e?.message || 'unknown error' });
      return error('An unexpected server error occurred. Please retry or contact the administrator.', 500, 'INTERNAL_ERROR');
    }
  }
};
