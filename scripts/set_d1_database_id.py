#!/usr/bin/env python3
"""Set the Cloudflare D1 database ID in wrangler.jsonc during CI deploy."""
from __future__ import annotations
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFIG = ROOT / "wrangler.jsonc"


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python scripts/set_d1_database_id.py <D1_DATABASE_ID>", file=sys.stderr)
        return 2
    database_id = sys.argv[1].strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,80}", database_id):
        print("Invalid D1 database ID format.", file=sys.stderr)
        return 2
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    bindings = config.get("d1_databases", [])
    if len(bindings) != 1 or bindings[0].get("binding") != "DB":
        print("Expected exactly one D1 binding named DB.", file=sys.stderr)
        return 1
    bindings[0]["database_id"] = database_id
    CONFIG.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("Configured D1 database ID for this workspace.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
