"""
Job Alert Agent
Scrapes career pages for new postings and sends email alerts via Gmail SMTP.
New jobs are detected by comparing against a local JSON state file.
"""

import json
import os
import smtplib
import time
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------------------------

GMAIL_USER   = os.environ["GMAIL_USER"]    # your Gmail address
GMAIL_PASS   = os.environ["GMAIL_PASS"]    # Gmail App Password (not your login password)
NOTIFY_EMAIL = os.environ.get("NOTIFY_EMAIL", GMAIL_USER)  # where to send alerts

STATE_FILE = Path("data/seen_jobs.json")

# ---------------------------------------------------------------------------
# COMPANY DEFINITIONS
# Each entry needs:
#   name        – display name
#   url         – careers page to scrape
#   parser      – name of a parser function below
#   keywords    – optional list; if set, only jobs containing any keyword are
#                 included (case-insensitive match against title)
# ---------------------------------------------------------------------------

COMPANIES = [
    # --- Autonomous Trucking ---
    {
        "name": "Aurora Innovation",
        "url": "https://aurora.tech/careers",
        "parser": "greenhouse",
        "gh_board": "aurora-innovation",
        "keywords": ["commercial", "business development", "partnerships", "operations", "strategy"],
    },
    {
        "name": "Kodiak Robotics",
        "url": "https://jobs.lever.co/kodiak",
        "parser": "lever",
        "keywords": ["commercial", "business", "partnerships", "operations"],
    },
    {
        "name": "Torc Robotics",
        "url": "https://jobs.lever.co/torc",
        "parser": "lever",
        "keywords": ["commercial", "business", "strategy", "operations", "partnerships"],
    },
    {
        "name": "Waabi",
        "url": "https://jobs.lever.co/waabi",
        "parser": "lever",
        "keywords": ["commercial", "business", "partnerships", "operations"],
    },
    {
        "name": "Gatik",
        "url": "https://jobs.lever.co/gatik",
        "parser": "lever",
        "keywords": ["commercial", "business", "growth", "operations"],
    },
    {
        "name": "Einride",
        "url": "https://www.einride.tech/careers",
        "parser": "greenhouse",
        "gh_board": "einride",
        "keywords": ["commercial", "business development", "partnerships", "sales", "operations"],
    },
    {
        "name": "Plus AI",
        "url": "https://jobs.lever.co/plus-ai",
        "parser": "lever",
        "keywords": ["commercial", "business", "partnerships", "operations", "program"],
    },
    # --- Airport / Industrial / Yard ---
    {
        "name": "Outrider",
        "url": "https://jobs.lever.co/outrider",
        "parser": "lever",
        "keywords": ["commercial", "business", "operations", "customer", "partnerships"],
    },
    {
        "name": "Isee AI",
        "url": "https://www.isee.ai/careers",
        "parser": "greenhouse",
        "gh_board": "isee",
        "keywords": [],
    },
    {
        "name": "Fernride",
        "url": "https://jobs.lever.co/fernride",
        "parser": "lever",
        "keywords": [],
    },
    # --- Urban / Robotaxi ---
    {
        "name": "Waymo",
        "url": "https://waymo.com/joinus/",
        "parser": "waymo",
        "keywords": ["commercial", "business", "partnerships", "operations", "strategy"],
    },
    {
        "name": "Motional",
        "url": "https://motional.com/careers",
        "parser": "greenhouse",
        "gh_board": "motional",
        "keywords": ["commercial", "business", "partnerships", "operations"],
    },
    {
        "name": "May Mobility",
        "url": "https://jobs.lever.co/maymobility",
        "parser": "lever",
        "keywords": ["commercial", "business", "operations", "partnerships"],
    },
    # --- Platform / Software ---
    {
        "name": "Oxa",
        "url": "https://jobs.lever.co/oxa",
        "parser": "lever",
        "keywords": ["commercial", "business", "partnerships", "sales"],
    },
    {
        "name": "Mobileye",
        "url": "https://mobileye.com/careers/",
        "parser": "mobileye",
        "keywords": ["commercial", "business", "partnerships", "sales", "operations"],
    },
    # --- Stack AV (custom page) ---
    {
        "name": "Stack AV",
        "url": "https://stackav.com/careers",
        "parser": "generic",
        "keywords": ["commercial", "business", "operations", "partnerships"],
    },
]

# ---------------------------------------------------------------------------
# PARSERS
# Each parser receives the URL and returns a list of dicts:
#   { "id": str, "title": str, "location": str, "url": str }
# ---------------------------------------------------------------------------

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}


def fetch(url: str, retries: int = 3) -> requests.Response | None:
    for attempt in range(retries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            print(f"  [warn] fetch {url} attempt {attempt+1} failed: {e}")
            time.sleep(2 ** attempt)
    return None


def parse_lever(company: dict) -> list[dict]:
    """Lever boards expose a clean JSON API."""
    board_slug = company["url"].rstrip("/").split("/")[-1]
    api = f"https://api.lever.co/v0/postings/{board_slug}?mode=json"
    r = fetch(api)
    if not r:
        return []
    try:
        data = r.json()
    except Exception:
        return []
    jobs = []
    for post in data:
        jobs.append({
            "id": post.get("id", ""),
            "title": post.get("text", ""),
            "location": post.get("categories", {}).get("location", ""),
            "url": post.get("hostedUrl", company["url"]),
        })
    return jobs


def parse_greenhouse(company: dict) -> list[dict]:
    """Greenhouse board JSON API."""
    board = company.get("gh_board", "")
    if not board:
        return []
    api = f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true"
    r = fetch(api)
    if not r:
        return []
    try:
        data = r.json().get("jobs", [])
    except Exception:
        return []
    jobs = []
    for post in data:
        loc = ""
        if post.get("offices"):
            loc = post["offices"][0].get("name", "")
        jobs.append({
            "id": str(post.get("id", "")),
            "title": post.get("title", ""),
            "location": loc,
            "url": post.get("absolute_url", company["url"]),
        })
    return jobs


def parse_waymo(company: dict) -> list[dict]:
    """Waymo careers page (Google Jobs schema)."""
    r = fetch(company["url"])
    if not r:
        return []
    soup = BeautifulSoup(r.text, "html.parser")
    jobs = []
    for tag in soup.select("li[data-job-id]"):
        job_id = tag.get("data-job-id", "")
        title_el = tag.select_one(".job-title, h3, h4, [class*='title']")
        loc_el = tag.select_one(".job-location, [class*='location']")
        link_el = tag.select_one("a")
        title = title_el.get_text(strip=True) if title_el else ""
        location = loc_el.get_text(strip=True) if loc_el else ""
        href = link_el["href"] if link_el and link_el.get("href") else company["url"]
        if not href.startswith("http"):
            href = "https://waymo.com" + href
        jobs.append({"id": job_id, "title": title, "location": location, "url": href})
    return jobs


def parse_mobileye(company: dict) -> list[dict]:
    """Mobileye uses a Greenhouse board under 'mobileye'."""
    company_copy = dict(company)
    company_copy["gh_board"] = "mobileye"
    return parse_greenhouse(company_copy)


def parse_generic(company: dict) -> list[dict]:
    """
    Generic fallback: look for <a> tags that look like job postings.
    Heuristic: anchors whose text is longer than 10 chars and whose
    href contains 'job', 'career', 'position', or 'apply'.
    """
    r = fetch(company["url"])
    if not r:
        return []
    soup = BeautifulSoup(r.text, "html.parser")
    jobs = []
    seen = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True)
        if len(text) < 10:
            continue
        href_lower = href.lower()
        if not any(k in href_lower for k in ("job", "career", "position", "apply", "opening", "role")):
            continue
        if not href.startswith("http"):
            from urllib.parse import urljoin
            href = urljoin(company["url"], href)
        job_id = href  # use URL as stable ID for generic pages
        if job_id in seen:
            continue
        seen.add(job_id)
        jobs.append({"id": job_id, "title": text, "location": "", "url": href})
    return jobs


PARSERS = {
    "lever": parse_lever,
    "greenhouse": parse_greenhouse,
    "waymo": parse_waymo,
    "mobileye": parse_mobileye,
    "generic": parse_generic,
}

# ---------------------------------------------------------------------------
# KEYWORD FILTERING
# ---------------------------------------------------------------------------

def matches_keywords(job: dict, keywords: list[str]) -> bool:
    if not keywords:
        return True
    title_lower = job["title"].lower()
    return any(kw.lower() in title_lower for kw in keywords)


# ---------------------------------------------------------------------------
# STATE MANAGEMENT  (persisted to data/seen_jobs.json)
# ---------------------------------------------------------------------------

def load_state() -> dict:
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return {}


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


# ---------------------------------------------------------------------------
# EMAIL
# ---------------------------------------------------------------------------

def build_email_html(new_jobs: dict[str, list[dict]]) -> str:
    total = sum(len(v) for v in new_jobs.values())
    rows = ""
    for company, jobs in new_jobs.items():
        rows += f"""
        <tr>
          <td colspan="3" style="padding:14px 0 6px;font-size:13px;font-weight:600;
              color:#111;border-top:1px solid #e5e5e5;">{company}</td>
        </tr>"""
        for job in jobs:
            loc = f" &nbsp;·&nbsp; {job['location']}" if job["location"] else ""
            rows += f"""
        <tr>
          <td style="padding:5px 0;font-size:14px;color:#111;">
            <a href="{job['url']}" style="color:#0070f3;text-decoration:none;">{job['title']}</a>
          </td>
          <td style="padding:5px 0 5px 12px;font-size:13px;color:#666;white-space:nowrap;">
            {job['location']}
          </td>
        </tr>"""

    date_str = datetime.utcnow().strftime("%B %d, %Y")
    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
             background:#f9f9f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;
              border:1px solid #e5e5e5;padding:28px 32px;">
    <p style="font-size:12px;color:#999;margin:0 0 16px;">{date_str}</p>
    <h1 style="font-size:20px;font-weight:600;color:#111;margin:0 0 4px;">
      {total} new job posting{"s" if total != 1 else ""}
    </h1>
    <p style="font-size:14px;color:#666;margin:0 0 20px;">
      From your AV &amp; transportation watchlist
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      {rows}
    </table>
    <p style="font-size:12px;color:#bbb;margin:24px 0 0;border-top:1px solid #e5e5e5;padding-top:16px;">
      Sent by your GitHub Actions job alert agent · unsubscribe by disabling the workflow
    </p>
  </div>
</body>
</html>"""


def send_email(new_jobs: dict[str, list[dict]]) -> None:
    total = sum(len(v) for v in new_jobs.values())
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"[Job Alert] {total} new posting{'s' if total != 1 else ''} — AV watchlist"
    msg["From"] = GMAIL_USER
    msg["To"] = NOTIFY_EMAIL

    html = build_email_html(new_jobs)
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(GMAIL_USER, GMAIL_PASS)
        server.sendmail(GMAIL_USER, NOTIFY_EMAIL, msg.as_string())
    print(f"✉  Email sent — {total} new jobs")


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def run() -> None:
    state = load_state()
    new_jobs: dict[str, list[dict]] = {}

    for company in COMPANIES:
        name = company["name"]
        parser_fn = PARSERS.get(company["parser"])
        if not parser_fn:
            print(f"[skip] No parser for {name}")
            continue

        print(f"Checking {name} …")
        try:
            jobs = parser_fn(company)
        except Exception as e:
            print(f"  [error] {name}: {e}")
            jobs = []

        # Apply keyword filter
        filtered = [j for j in jobs if matches_keywords(j, company.get("keywords", []))]

        # Detect new ones
        seen_ids = set(state.get(name, []))
        fresh = [j for j in filtered if j["id"] not in seen_ids]

        if fresh:
            new_jobs[name] = fresh
            print(f"  → {len(fresh)} new job(s)")
        else:
            print(f"  → nothing new ({len(filtered)} matched, all seen)")

        # Update state with ALL scraped IDs (not just filtered) to avoid
        # re-alerting on jobs that don't match keywords after a keyword change.
        all_ids = [j["id"] for j in jobs]
        state[name] = list(set(state.get(name, [])) | set(all_ids))

        time.sleep(1)  # be polite

    save_state(state)

    if new_jobs:
        send_email(new_jobs)
    else:
        print("No new jobs found — no email sent.")


if __name__ == "__main__":
    run()
