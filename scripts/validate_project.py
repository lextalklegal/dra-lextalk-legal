#!/usr/bin/env python3
"""Lightweight local validation for DRA Learning starter (no network required)."""
from __future__ import annotations
import json
import pathlib
import re
import sqlite3
import subprocess
import sys
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parents[1]

class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.refs = []
    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        for attr in ('href', 'src'):
            value = values.get(attr, '')
            if value and value.startswith('/') and not value.startswith('//') and not value.startswith('/#'):
                self.refs.append(value.split('?', 1)[0].split('#', 1)[0])

def main() -> int:
    failures = []
    config_path = ROOT / 'wrangler.jsonc'
    try:
        config = json.loads(config_path.read_text(encoding='utf-8'))
        if config.get('assets', {}).get('directory') != './public': failures.append('Wrangler assets.directory must be ./public')
        if config.get('assets', {}).get('binding') != 'ASSETS': failures.append('Wrangler assets binding must be ASSETS')
        if config.get('d1_databases', [{}])[0].get('binding') != 'DB': failures.append('D1 binding must be DB')
        if str(config.get('d1_databases', [{}])[0].get('database_id', '')).startswith('REPLACE_'):
            print('NOTE: Replace the D1 database_id in wrangler.jsonc before remote deployment.')
    except Exception as exc:
        failures.append(f'wrangler.jsonc is not valid JSONC-without-comments: {exc}')

    for file in ('src/index.js', 'public/app.js', 'public/admin.js', 'public/setup.js', 'public/auth-client.js', 'public/site-redesign.js'):
        result = subprocess.run(['node', '--check', str(ROOT / file)], capture_output=True, text=True)
        if result.returncode:
            failures.append(f'JavaScript syntax failed for {file}: {result.stderr.strip()}')
    print('JavaScript syntax: ' + ('PASS' if not failures else 'CHECK'))

    try:
        db = sqlite3.connect(':memory:')
        db.execute('PRAGMA foreign_keys=ON')
        db.executescript((ROOT / 'migrations/0001_initial_schema.sql').read_text(encoding='utf-8'))
        db.executescript((ROOT / 'migrations/0002_managed_auth.sql').read_text(encoding='utf-8'))
        tables = db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
        if tables < 15: failures.append(f'Expected schema tables, found {tables}')
        tests = {row[0]: row[1:] for row in db.execute('SELECT slug, question_count, status, is_free FROM test_configs')}
        if tests.get('free-mock') != (5, 'published', 1): failures.append('Free mock seed configuration is missing or unexpected')
        if config.get('limits', {}).get('cpu_ms') is not None: failures.append('Free-plan Worker config must not set a custom cpu_ms limit; authentication is delegated to managed auth.')
        if not config.get('vars', {}).get('SUPABASE_URL', '').startswith('https://'): failures.append('Supabase URL placeholder/runtime variable is missing.')
        if tests.get('premium-mock', (None, None, None))[1] != 'draft': failures.append('Premium mock should remain Draft by default')
        for lang in ('en', 'hi'):
            n = db.execute('''SELECT COUNT(*) FROM (
                SELECT q.id FROM questions q
                JOIN question_translations qt ON qt.question_id=q.id AND qt.language_code=?
                JOIN question_options o ON o.question_id=q.id
                JOIN option_translations ot ON ot.option_id=o.id AND ot.language_code=?
                WHERE q.status='published' GROUP BY q.id HAVING COUNT(DISTINCT o.id)=4 AND COUNT(DISTINCT ot.option_id)=4 AND SUM(o.is_correct)=1
            )''', (lang, lang)).fetchone()[0]
            if n < 5: failures.append(f'Free mock requires 5 complete questions in {lang}; found {n}')
        print(f'SQL migration and demo seed: PASS ({tables} tables; {db.execute("SELECT COUNT(*) FROM questions").fetchone()[0]} demo questions)')
    except Exception as exc:
        failures.append(f'SQL migration validation failed: {exc}')

    parser = AssetParser()
    for html in (ROOT / 'public').glob('*.html'):
        parser.feed(html.read_text(encoding='utf-8'))
    for ref in parser.refs:
        if ref in ('', '/'): ref = '/index.html'
        target = ROOT / 'public' / ref.lstrip('/')
        if not target.is_file(): failures.append(f'Missing local asset referenced by HTML: {ref}')
    workflow = ROOT / '.github/workflows/deploy.yml'
    workflow_text = workflow.read_text(encoding='utf-8') if workflow.exists() else ''
    for secret in ('CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'):
        if secret not in workflow_text: failures.append(f'Deploy workflow is missing required secret reference: {secret}')
    worker_source = (ROOT / 'src/index.js').read_text(encoding='utf-8')
    if 'PBKDF2' in worker_source or 'PASSWORD_ITERATIONS' in worker_source: failures.append('Worker still performs compute-heavy custom password hashing; managed auth should own password verification.')
    if 'SUPABASE_PUBLISHABLE_KEY' not in worker_source or '/auth/v1/user' not in worker_source: failures.append('Managed-auth provider validation is missing.')
    if 'reviewed_at IS NOT NULL' not in worker_source:
        failures.append('Question review gate is missing from API code')
    if not (ROOT / 'GO_LIVE_CHECKLIST_HINGLISH.md').exists(): failures.append('Go-live checklist is missing')

    template = ROOT / 'sample-data/mcq-import-template.csv'
    if not template.exists() or 'question_key' not in template.read_text(encoding='utf-8').splitlines()[0]: failures.append('MCQ CSV template header missing')
    print('HTML local assets and MCQ template: ' + ('PASS' if not failures else 'CHECK'))

    if failures:
        for failure in failures: print('FAIL:', failure)
        return 1
    print('Overall validation: PASS')
    return 0

if __name__ == '__main__':
    sys.exit(main())
