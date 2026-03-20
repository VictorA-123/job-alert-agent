"""
Job Alert Agent v2
Scrapes career pages, detects new postings, writes jobs.json for the dashboard,
and sends an optional Gmail digest email.
"""

import json
import os
import smtplib
import time
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------------------------

GMAIL_USER   = os.environ.get("GMAIL_USER", "")
GMAIL_PASS   = os.environ.get("GMAIL_PASS", "")
NOTIFY_EMAIL = os.environ.get("NOTIFY_EMAIL", GMAIL_USER)

STATE_FILE  = Path("data/seen_jobs.json")
JOBS_FILE   = Path("docs/jobs.json")          # written to docs/ for GitHub Pages

# ---------------------------------------------------------------------------
# COMPANY DEFINITIONS
# ---------------------------------------------------------------------------

COMPANIES = [
    {
        "name": "Aurora Innovation",
        "url": "https://aurora.tech/careers",
        "parser": "greenhouse",
        "gh_board": "aurora-innovation",
        "keywords": ["commercial", "business development", "partnerships", "operations", "strategy"],
    },
    {
        "name": "Kodiak Robotics",
        "url": "https://kodiak.ai/careers",
        "parser": "generic",
        "keywords": ["commercial", "business", "partnerships", "operations"],
    },
    {
        "name": "Torc Robotics",
        "url": "https://job-boards.greenhouse.io/torcrobotics",
        "parser": "greenhouse",
        "gh_board": "torcrobotics",
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
        "url": "https://gatik.ai/careers/",
        "parser": "generic",
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
        "url": "https://plus.ai/careers",
        "parser": "generic",
        "keywords": ["commercial", "business", "partnerships", "operations", "program"],
    },
    {
        "name": "Outrider",
        "url": "https://job-boards.greenhouse.io/outrider",
        "parser": "greenhouse",
        "gh_board": "outrider",
        "keywords": ["commercial", "business", "operations", "customer", "partnerships"],
    },
{
    "name": "Isee AI",
    "url": "https://jobs.lever.co/isee",
    "parser": "lever",
    "keywords": ["commercial", "business", "operations", "partnerships", "sales"],
},
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
        "url": "https://job-boards.greenhouse.io/maymobility",
        "parser": "greenhouse",
        "gh_board": "maymobility",
        "keywords": ["commercial", "business", "operations", "partnerships"],
    },
    {
        "name": "Mobileye",
        "url": "https://mobileye.com/careers/",
        "parser": "mobileye",
        "keywords": ["commercial", "business", "partnerships", "sales", "operations"],
    },
    {
        "name": "Stack AV",
        "url": "https://stackav.com/careers",
        "parser": "generic",
        "keywords": ["commercial", "business", "operations", "partnerships"],
    },
    {
        "name": "Glydways",
        "url": "https://www.glydways.com/careers/",
        "parser": "generic",
        "keywords": ["commercial", "business", "operations", "partnerships", "sales"],
    },
    {
        "name": "Pronto",
        "url": "https://ats.rippling.com/pronto/jobs?jobBoardSlug=pronto&page=0",
        "parser": "rippling",
        "rippling_slug": "pronto",
        "keywords": ["commercial", "business", "partnerships", "operations"],
    },
    {
        "name": "Intramotev",
        "url": "https://intramotev.com/careers/",
        "parser": "generic",
        "keywords": [],
    },
    {
        "name": "Zoox",
        "url": "https://jobs.lever.co/zoox",
        "parser": "lever",
        "keywords": ["commercial", "business", "partnerships", "operations", "strategy"],
    },
]

# ---------------------------------------------------------------------------
# PARSERS
# ---------------------------------------------------------------------------

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}


def fetch(url: str, retries: int = 3):
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
        # Extract description from lever content blocks
        description = ""
        lists = post.get("lists", [])
        if lists:
            for block in lists:
                description += block.get("text", "") + "\n" + "\n".join(block.get("content", [])) + "\n"
        additional = post.get("additional", "")
        if additional:
            description += additional

        jobs.append({
            "id": post.get("id", ""),
            "title": post.get("text", ""),
            "location": post.get("categories", {}).get("location", ""),
            "url": post.get("hostedUrl", company["url"]),
            "description": description.strip(),
            "salary": "",
        })
    return jobs


def parse_greenhouse(company: dict) -> list[dict]:
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
        # Clean HTML from description
        raw_desc = post.get("content", "")
        if raw_desc:
            soup = BeautifulSoup(raw_desc, "html.parser")
            description = soup.get_text(separator="\n").strip()
        else:
            description = ""
        jobs.append({
            "id": str(post.get("id", "")),
            "title": post.get("title", ""),
            "location": loc,
            "url": post.get("absolute_url", company["url"]),
            "description": description,
            "salary": "",
        })
    return jobs


def parse_waymo(company: dict) -> list[dict]:
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
        jobs.append({"id": job_id, "title": title, "location": location, "url": href, "description": "", "salary": ""})
    return jobs


def parse_mobileye(company: dict) -> list[dict]:
    company_copy = dict(company)
    company_copy["gh_board"] = "mobileye"
    return parse_greenhouse(company_copy)


def parse_generic(company: dict) -> list[dict]:
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
        if href in seen:
            continue
        seen.add(href)
        jobs.append({"id": href, "title": text, "location": "", "url": href, "description": "", "salary": ""})
    return jobs


def parse_rippling(company: dict) -> list[dict]:
    slug = company.get("rippling_slug", "")
    api = f"https://ats.rippling.com/api/w/{slug}/jobs/public?page=0&pageSize=100"
    r = fetch(api)
    if not r:
        return []
    try:
        data = r.json()
    except Exception:
        return []
    jobs = []
    for post in data.get("results", data if isinstance(data, list) else []):
        loc = post.get("location", {})
        location = loc.get("city", "") if isinstance(loc, dict) else str(loc)
        jobs.append({
            "id": str(post.get("id", post.get("uid", ""))),
            "title": post.get("title", post.get("name", "")),
            "location": location,
            "url": f"https://ats.rippling.com/{slug}/jobs/{post.get('id', post.get('uid', ''))}",
            "description": "",
            "salary": "",
        })
    return jobs


PARSERS = {
    "lever": parse_lever,
    "greenhouse": parse_greenhouse,
    "waymo": parse_waymo,
    "mobileye": parse_mobileye,
    "generic": parse_generic,
    "rippling": parse_rippling,
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
# STATE MANAGEMENT
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
# JOBS.JSON OUTPUT  (for dashboard)
# ---------------------------------------------------------------------------

def load_jobs_file() -> list[dict]:
    if JOBS_FILE.exists():
        with open(JOBS_FILE) as f:
            data = json.load(f)
            return data.get("jobs", [])
    return []


def save_jobs_file(all_jobs: list[dict]) -> None:
    JOBS_FILE.parent.mkdir(parents=True, exist_ok=True)
    output = {
        "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "jobs": all_jobs,
    }
    with open(JOBS_FILE, "w") as f:
        json.dump(output, f, indent=2)

# ---------------------------------------------------------------------------
# EMAIL
# ---------------------------------------------------------------------------

def build_email_html(new_jobs: dict) -> str:
    total = sum(len(v) for v in new_jobs.values())
    rows = ""
    for company, jobs in new_jobs.items():
        rows += f"""
        <tr>
          <td colspan="2" style="padding:14px 0 6px;font-size:13px;font-weight:600;
              color:#111;border-top:1px solid #e5e5e5;">{company}</td>
        </tr>"""
        for job in jobs:
            rows += f"""
        <tr>
          <td style="padding:5px 0;font-size:14px;color:#111;">
            <a href="{job['url']}" style="color:#0070f3;text-decoration:none;">{job['title']}</a>
          </td>
          <td style="padding:5px 0 5px 12px;font-size:13px;color:#666;white-space:nowrap;">
            {job.get('location', '')}
          </td>
        </tr>"""

    date_str = datetime.now(timezone.utc).strftime("%B %d, %Y")
    dashboard_url = "https://victora-123.github.io/job-alert-agent/"
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
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
    <div style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e5e5;">
      <a href="{dashboard_url}" style="display:inline-block;padding:10px 20px;
         background:#111;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;">
        Open Dashboard →
      </a>
    </div>
    <p style="font-size:12px;color:#bbb;margin:16px 0 0;">
      Sent by your job alert agent
    </p>
  </div>
</body></html>"""


def send_email(new_jobs: dict) -> None:
    if not GMAIL_USER or not GMAIL_PASS:
        print("Email credentials not set — skipping email.")
        return
    total = sum(len(v) for v in new_jobs.values())
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"[Job Alert] {total} new posting{'s' if total != 1 else ''} — open your dashboard"
    msg["From"] = GMAIL_USER
    msg["To"] = NOTIFY_EMAIL
    msg.attach(MIMEText(build_email_html(new_jobs), "html"))
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(GMAIL_USER, GMAIL_PASS)
        server.sendmail(GMAIL_USER, NOTIFY_EMAIL, msg.as_string())
    print(f"✉  Email sent — {total} new jobs")

# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def run() -> None:
    state = load_state()
    existing_jobs = load_jobs_file()

    # Index existing jobs by id so we can merge cleanly
    existing_by_id = {j["id"]: j for j in existing_jobs}

    new_jobs_by_company: dict = {}
    all_current_ids = set()

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

        filtered = [j for j in jobs if matches_keywords(j, company.get("keywords", []))]
        seen_ids = set(state.get(name, []))

        fresh = [j for j in filtered if j["id"] not in seen_ids]

        if fresh:
            new_jobs_by_company[name] = fresh
            print(f"  → {len(fresh)} new job(s)")
        else:
            print(f"  → nothing new ({len(filtered)} matched)")

        # Add new jobs to the jobs file data
        for job in filtered:
            job_id = job["id"]
            all_current_ids.add(job_id)
            if job_id not in existing_by_id:
                existing_by_id[job_id] = {
                    "id": job_id,
                    "company": name,
                    "title": job["title"],
                    "url": job["url"],
                    "description": job.get("description", ""),
                    "salary": job.get("salary", ""),
                    "location": job.get("location", ""),
                    "date_found": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    "status": "new",
                }

        all_ids = [j["id"] for j in jobs]
        state[name] = list(set(state.get(name, [])) | set(all_ids))
        time.sleep(1)

    # Write updated jobs.json (keep all jobs, new ones added)
    all_jobs = list(existing_by_id.values())
    save_jobs_file(all_jobs)
    print(f"✓ jobs.json written — {len(all_jobs)} total jobs")

    save_state(state)

    if new_jobs_by_company:
        send_email(new_jobs_by_company)
    else:
        print("No new jobs — no email sent.")


if __name__ == "__main__":
    run()