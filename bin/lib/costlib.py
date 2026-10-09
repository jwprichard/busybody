"""Transcript cost estimates shared by bin/room-cost and bin/role.

Sums message.usage per message.model, de-duplicated by requestId, at LIST prices
(templates/prices.json). An estimate, not an invoice: see limitations/lead-cost-is-estimated.md.
"""
import glob, json, os, re, sys
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from officeroot import bb_env  # noqa: E402

ENGINE_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
NZ = ZoneInfo("Pacific/Auckland")
PROJECTS = bb_env(None, "CLAUDE_PROJECTS", "SCH_CLAUDE_PROJECTS") or os.path.expanduser("~/.claude/projects")


def load_prices():
    with open(os.path.join(ENGINE_ROOT, "templates", "prices.json")) as f:
        return json.load(f)["models"]


def price_for(prices, model):
    for k, v in prices.items():
        if model.startswith(k):
            return v
    return None


def encode_cwd(cwd):
    return re.sub(r"[^A-Za-z0-9]", "-", cwd)


def transcript_files(session_id, cwd):
    base = os.path.join(PROJECTS, encode_cwd(cwd))
    files = []
    main = os.path.join(base, session_id + ".jsonl")
    if os.path.exists(main):
        files.append(main)
    files += sorted(glob.glob(os.path.join(base, session_id, "subagents", "agent-*.jsonl")))
    return files


def collect(files):
    """requestId -> (timestamp, model, usage). Streaming repeats a request across rows; keep the fullest."""
    best = {}
    for path in files:
        try:
            fh = open(path, encoding="utf-8", errors="replace")
        except OSError:
            continue
        with fh:
            for line in fh:
                if '"usage"' not in line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                m = d.get("message")
                if not isinstance(m, dict) or not isinstance(m.get("usage"), dict):
                    continue
                model = m.get("model") or ""
                if not model or model.startswith("<"):
                    continue
                key = d.get("requestId") or m.get("id") or d.get("uuid")
                if not key:
                    continue
                u = m["usage"]
                ts = d.get("timestamp") or ""
                old = best.get(key)
                if old is None or (u.get("output_tokens") or 0) >= (old[2].get("output_tokens") or 0):
                    best[key] = (ts, model, u)
    return best


def row_cost(prices, model, u):
    p = price_for(prices, model)
    if p is None or any(p.get(k) is None for k in ("input", "output", "cache_read")):
        return 0.0, False
    cc = u.get("cache_creation") or {}
    w1 = cc.get("ephemeral_1h_input_tokens")
    w5 = cc.get("ephemeral_5m_input_tokens")
    if w1 is None and w5 is None:
        w5, w1 = u.get("cache_creation_input_tokens") or 0, 0
    w1, w5 = w1 or 0, w5 or 0
    c = ((u.get("input_tokens") or 0) * p["input"] + (u.get("output_tokens") or 0) * p["output"]
         + (u.get("cache_read_input_tokens") or 0) * p["cache_read"]
         + w5 * p["cache_write_5m"] + w1 * p["cache_write_1h"]) / 1e6
    return c, True


def nz_date(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(NZ).date()
    except ValueError:
        return None


def summarise(files, prices, today=None):
    today = today or datetime.now(NZ).date()
    rows = collect(files)
    total = day = 0.0
    mix, unpriced, last = {}, set(), ""
    for ts, model, u in rows.values():
        c, ok = row_cost(prices, model, u)
        if not ok:
            unpriced.add(model)
        total += c
        fam = re.sub(r"^claude-|-\d.*$", "", model)
        mix[fam] = mix.get(fam, 0.0) + c
        if nz_date(ts) == today:
            day += c
        last = max(last, ts)
    return {"today": round(day, 4), "total": round(total, 4), "mix": mix, "unpriced": sorted(unpriced),
            "last_activity": last, "requests": len(rows)}
