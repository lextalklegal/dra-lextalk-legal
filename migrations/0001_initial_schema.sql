PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS email_verification_codes (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_login_limits (
  attempt_key TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_limits_lock ON auth_login_limits(locked_until);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  question_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'DRA',
  topic TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  source_note TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_status_topic ON questions(status, topic);

CREATE TABLE IF NOT EXISTS question_translations (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL,
  question_text TEXT NOT NULL,
  explanation_text TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (question_id, language_code)
);

CREATE TABLE IF NOT EXISTS question_options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_key TEXT NOT NULL CHECK (option_key IN ('A','B','C','D')),
  is_correct INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0,1)),
  UNIQUE (question_id, option_key)
);
CREATE INDEX IF NOT EXISTS idx_question_options_question ON question_options(question_id);

CREATE TABLE IF NOT EXISTS option_translations (
  option_id TEXT NOT NULL REFERENCES question_options(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL,
  option_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (option_id, language_code)
);

CREATE TABLE IF NOT EXISTS test_configs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'mock' CHECK (kind IN ('mock','topic','revision')),
  is_free INTEGER NOT NULL DEFAULT 0 CHECK (is_free IN (0,1)),
  question_count INTEGER NOT NULL DEFAULT 5,
  duration_minutes INTEGER NOT NULL DEFAULT 10,
  required_plan_slug TEXT,
  price_paise INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_test_configs_status ON test_configs(status, is_free);

CREATE TABLE IF NOT EXISTS test_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_config_id TEXT NOT NULL REFERENCES test_configs(id),
  language_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','expired','abandoned')),
  access_type TEXT NOT NULL CHECK (access_type IN ('free','entitlement','admin_preview')),
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  submitted_at TEXT,
  score INTEGER,
  total_questions INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_user_created ON test_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_status_expiry ON test_attempts(status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS one_free_attempt_per_user_test
  ON test_attempts(user_id, test_config_id)
  WHERE access_type = 'free';

CREATE TABLE IF NOT EXISTS test_attempt_questions (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES test_attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id),
  position INTEGER NOT NULL,
  selected_option_key TEXT CHECK (selected_option_key IN ('A','B','C','D')),
  answered_at TEXT,
  UNIQUE (attempt_id, question_id),
  UNIQUE (attempt_id, position)
);
CREATE INDEX IF NOT EXISTS idx_attempt_questions_attempt ON test_attempt_questions(attempt_id, position);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_paise INTEGER,
  validity_days INTEGER,
  max_mock_tests INTEGER,
  includes_classes INTEGER NOT NULL DEFAULT 0 CHECK (includes_classes IN (0,1)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_slug TEXT NOT NULL REFERENCES plans(slug),
  amount_paise INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded')),
  provider TEXT NOT NULL DEFAULT 'razorpay',
  provider_order_id TEXT UNIQUE,
  provider_payment_id TEXT,
  provider_signature TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_user_status ON purchases(user_id, status);

CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_slug TEXT NOT NULL REFERENCES plans(slug),
  purchase_id TEXT REFERENCES purchases(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, plan_slug, purchase_id)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_user_status ON entitlements(user_id, status, expires_at);

CREATE TABLE IF NOT EXISTS live_classes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  language_code TEXT NOT NULL DEFAULT 'hi',
  instructor_name TEXT NOT NULL DEFAULT 'DRA Community India',
  starts_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  meeting_url TEXT,
  is_paid INTEGER NOT NULL DEFAULT 0 CHECK (is_paid IN (0,1)),
  required_plan_slug TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled','completed')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classes_status_start ON live_classes(status, starts_at);

CREATE TABLE IF NOT EXISTS class_enrollments (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES live_classes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at TEXT NOT NULL,
  UNIQUE (class_id, user_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

INSERT OR IGNORE INTO test_configs
  (id, slug, title, description, kind, is_free, question_count, duration_minutes, required_plan_slug, price_paise, status, created_at, updated_at)
VALUES
  ('cfg-free-mock', 'free-mock', 'Free DRA Starter Mock', 'A short starter mock to try the platform. The seeded questions are illustrative practice examples, not official IIBF questions.', 'mock', 1, 5, 10, NULL, NULL, 'published', '2026-10-18T00:00:00.000Z', '2026-10-18T00:00:00.000Z'),
  ('cfg-premium-mock', 'premium-mock', 'Full-Length DRA Mock', 'Full-length practice mock. Activate after importing and reviewing the complete question bank and setting pricing.', 'mock', 0, 100, 120, 'dra-practice-pro', NULL, 'draft', '2026-10-18T00:00:00.000Z', '2026-10-18T00:00:00.000Z');

INSERT OR IGNORE INTO plans
  (id, slug, name, description, price_paise, validity_days, max_mock_tests, includes_classes, status, created_at, updated_at)
VALUES
  ('plan-practice', 'dra-practice-pro', 'DRA Practice Pro', 'Paid mock tests, topic-wise practice and progress history. Price to be configured by the platform owner.', NULL, 30, NULL, 0, 'draft', '2026-10-18T00:00:00.000Z', '2026-10-18T00:00:00.000Z'),
  ('plan-classes', 'dra-live-classes', 'DRA Live Classes', 'Access to eligible live classes and learning materials. Price to be configured by the platform owner.', NULL, 30, NULL, 1, 'draft', '2026-10-18T00:00:00.000Z', '2026-10-18T00:00:00.000Z');

-- Small illustrative seed bank so the starter can be tried end-to-end.
-- These are original practice examples, not official IIBF exam questions.
INSERT OR IGNORE INTO questions (id, question_key, category, topic, difficulty, status, source_note, created_by, created_at, updated_at) VALUES
('q-demo-001','DEMO001','Ethics and communication','Ethical recovery communication','easy','published','Original illustrative demo question; replace/review before public launch.',NULL,'2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-002','DEMO002','Customer service','Confidentiality of borrower information','easy','published','Original illustrative demo question; replace/review before public launch.',NULL,'2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-003','DEMO003','Communication','Responding to a repayment concern','easy','published','Original illustrative demo question; replace/review before public launch.',NULL,'2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-004','DEMO004','Professional conduct','Accurate record keeping','easy','published','Original illustrative demo question; replace/review before public launch.',NULL,'2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-005','DEMO005','Customer service','Handling a disputed amount','easy','published','Original illustrative demo question; replace/review before public launch.',NULL,'2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z');

INSERT OR IGNORE INTO question_translations (question_id, language_code, question_text, explanation_text, reviewed_by, reviewed_at, created_at, updated_at) VALUES
('q-demo-001','en','During a recovery interaction, which approach is most appropriate?','Professional recovery communication should remain respectful and follow applicable rules and authorised procedures.',NULL,NULL,'2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-001','hi','वसूली के दौरान कौन-सा तरीका सबसे उचित है?','वसूली के दौरान संवाद सम्मानजनक होना चाहिए और लागू नियमों तथा अधिकृत प्रक्रियाओं का पालन करना चाहिए।',NULL,NULL,'2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-002','en','How should a recovery agent handle a borrower’s personal information?','Personal information should be handled confidentially and shared only through authorised channels for a legitimate purpose.',NULL,NULL,'2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-002','hi','रिकवरी एजेंट को उधारकर्ता की निजी जानकारी कैसे संभालनी चाहिए?','निजी जानकारी गोपनीय रखनी चाहिए और वैध उद्देश्य के लिए केवल अधिकृत माध्यम से साझा करनी चाहिए।',NULL,NULL,'2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-003','en','A borrower says they cannot pay the full amount today. What should the agent do first?','Listen, communicate factually and explain only the options that are authorised by the lender’s process.',NULL,NULL,'2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-003','hi','उधारकर्ता कहता है कि वह आज पूरी राशि नहीं चुका सकता। एजेंट को सबसे पहले क्या करना चाहिए?','बात सुनें, तथ्यात्मक संवाद करें और केवल वही विकल्प बताएं जो ऋणदाता की प्रक्रिया के अनुसार अधिकृत हों।',NULL,NULL,'2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-004','en','Why is it important to record the details of a borrower interaction accurately?','Accurate records support accountability, continuity and later review of the interaction.',NULL,NULL,'2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-004','hi','उधारकर्ता से हुई बातचीत का सही रिकॉर्ड रखना क्यों महत्वपूर्ण है?','सही रिकॉर्ड जवाबदेही, आगे की कार्यवाही और बाद में समीक्षा में मदद करता है।',NULL,NULL,'2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-005','en','A borrower disputes the amount communicated by an agent. What is the best next step?','Avoid arguing or guessing; refer to the authorised account information and follow the lender’s dispute-handling process.',NULL,NULL,'2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-005','hi','उधारकर्ता एजेंट द्वारा बताई गई राशि पर आपत्ति करता है। अगला उचित कदम क्या है?','बहस या अनुमान लगाने के बजाय अधिकृत खाते की जानकारी देखें और ऋणदाता की विवाद-निवारण प्रक्रिया अपनाएं।',NULL,NULL,'2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z');

INSERT OR IGNORE INTO question_options (id, question_id, option_key, is_correct) VALUES
('q-demo-001-A','q-demo-001','A',1),('q-demo-001-B','q-demo-001','B',0),('q-demo-001-C','q-demo-001','C',0),('q-demo-001-D','q-demo-001','D',0),
('q-demo-002-A','q-demo-002','A',0),('q-demo-002-B','q-demo-002','B',1),('q-demo-002-C','q-demo-002','C',0),('q-demo-002-D','q-demo-002','D',0),
('q-demo-003-A','q-demo-003','A',0),('q-demo-003-B','q-demo-003','B',1),('q-demo-003-C','q-demo-003','C',0),('q-demo-003-D','q-demo-003','D',0),
('q-demo-004-A','q-demo-004','A',0),('q-demo-004-B','q-demo-004','B',0),('q-demo-004-C','q-demo-004','C',1),('q-demo-004-D','q-demo-004','D',0),
('q-demo-005-A','q-demo-005','A',0),('q-demo-005-B','q-demo-005','B',0),('q-demo-005-C','q-demo-005','C',0),('q-demo-005-D','q-demo-005','D',1);

INSERT OR IGNORE INTO option_translations (option_id, language_code, option_text, created_at, updated_at) VALUES
('q-demo-001-A','en','Speak respectfully, explain the verified facts and follow authorised procedure.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-001-A','hi','सम्मानपूर्वक बात करें, सत्यापित तथ्य बताएं और अधिकृत प्रक्रिया अपनाएं।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-001-B','en','Threaten the borrower to force immediate payment.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-001-B','hi','तुरंत भुगतान के लिए उधारकर्ता को धमकाएं।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-001-C','en','Share the borrower’s details publicly.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-001-C','hi','उधारकर्ता की जानकारी सार्वजनिक रूप से साझा करें।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-001-D','en','Promise a settlement that has not been authorised.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-001-D','hi','बिना अनुमति के समझौते का वादा करें।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-002-A','en','Send it to unrelated groups for advice.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-002-A','hi','सलाह के लिए इसे असंबंधित समूहों में भेजें।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-002-B','en','Keep it confidential and use authorised channels only.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-002-B','hi','इसे गोपनीय रखें और केवल अधिकृत माध्यमों का उपयोग करें।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-002-C','en','Post it on social media to find the borrower.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-002-C','hi','उधारकर्ता को खोजने के लिए इसे सोशल मीडिया पर डालें।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-002-D','en','Keep copies on a public computer.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-002-D','hi','इसकी प्रतियां सार्वजनिक कंप्यूटर पर रखें।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-003-A','en','Argue until the borrower agrees.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-003-A','hi','बहस करें जब तक उधारकर्ता सहमत न हो जाए।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-003-B','en','Listen and explain only verified, authorised options.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-003-B','hi','बात सुनें और केवल सत्यापित, अधिकृत विकल्प समझाएं।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-003-C','en','Invent a discount to close the conversation.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-003-C','hi','बात खत्म करने के लिए मनगढ़ंत छूट बताएं।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-003-D','en','Ignore the borrower and end the call.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-003-D','hi','उधारकर्ता को अनदेखा करके कॉल समाप्त करें।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-004-A','en','It allows the agent to alter history later.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-004-A','hi','इससे एजेंट बाद में रिकॉर्ड बदल सकता है।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-004-B','en','It removes the need to follow procedures.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-004-B','hi','इससे प्रक्रियाओं का पालन आवश्यक नहीं रहता।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-004-C','en','It supports accountability and later review.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-004-C','hi','यह जवाबदेही और बाद की समीक्षा में सहायता करता है।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-004-D','en','It guarantees that every borrower will pay.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-004-D','hi','यह सुनिश्चित करता है कि हर उधारकर्ता भुगतान करेगा।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-005-A','en','Guess the amount and insist that it is correct.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-005-A','hi','राशि का अनुमान लगाकर उसे सही बताएं।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-005-B','en','Post the dispute publicly.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-005-B','hi','विवाद को सार्वजनिक रूप से पोस्ट करें।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-005-C','en','Promise to erase the debt without approval.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-005-C','hi','बिना अनुमति के ऋण समाप्त करने का वादा करें।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
('q-demo-005-D','en','Check authorised account records and follow the dispute process.','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'),('q-demo-005-D','hi','अधिकृत खाते का रिकॉर्ड देखें और विवाद-निवारण प्रक्रिया अपनाएं।','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z');
