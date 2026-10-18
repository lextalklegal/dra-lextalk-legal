#!/usr/bin/env python3
"""Configure Supabase URL and publishable key for the deployment workspace only."""
from __future__ import annotations
import json, pathlib, re, sys
from urllib.parse import urlparse
ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'wrangler.jsonc'
PUBLIC_CONFIG = ROOT / 'public' / 'auth-config.js'
def main() -> int:
    if len(sys.argv) != 3:
        print('Usage: python scripts/configure_supabase.py <SUPABASE_URL> <PUBLISHABLE_OR_ANON_KEY>', file=sys.stderr)
        return 2
    url, key = sys.argv[1].strip().rstrip('/'), sys.argv[2].strip()
    parsed = urlparse(url)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.query or parsed.fragment or parsed.username or parsed.password:
        print('Invalid Supabase URL: use the HTTPS project URL from Supabase settings.', file=sys.stderr); return 2
    if len(key) < 20 or 'YOUR_SUPABASE_' in key or 'service_role' in key.lower() or 'secret' in key.lower():
        print('Invalid key. Use the Supabase publishable key or legacy anon public key, never a service_role/secret key.', file=sys.stderr); return 2
    cfg = json.loads(CONFIG.read_text(encoding='utf-8'))
    cfg.setdefault('vars', {})['SUPABASE_URL'] = url
    cfg['vars']['SUPABASE_PUBLISHABLE_KEY'] = key
    CONFIG.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    public = '/* Generated at deploy time. This file may contain ONLY the Supabase publishable/anon key. */\n'
    public += 'window.DRA_AUTH_CONFIG = Object.freeze(' + json.dumps({'url':url,'publishableKey':key}, ensure_ascii=False) + ');\n'
    PUBLIC_CONFIG.write_text(public, encoding='utf-8')
    print('Configured Supabase Auth for this deployment workspace (key value omitted).')
    return 0
if __name__ == '__main__': raise SystemExit(main())
