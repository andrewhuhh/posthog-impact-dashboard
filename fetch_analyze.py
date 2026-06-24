import csv
import http.client
import json
import math
import os
import re
import subprocess
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
REPO = "PostHog/posthog"
END = date(2026, 6, 23)
START = END - timedelta(days=90)
API = "https://api.github.com"


def gh_token() -> str:
    env_token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if env_token:
        return env_token.strip()
    return subprocess.check_output(["gh", "auth", "token"], text=True).strip()


TOKEN = gh_token()


def request_json(path_or_url: str, params=None, retries=4, method="GET", body=None):
    if path_or_url.startswith("http"):
        url = path_or_url
    else:
        url = f"{API}{path_or_url}"
    if params:
        url += ("&" if "?" in url else "?") + urlencode(params)
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {TOKEN}",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "posthog-impact-dashboard",
    }
    for attempt in range(retries):
        try:
            data = None
            if body is not None:
                data = json.dumps(body).encode("utf-8")
                headers["Content-Type"] = "application/json"
            with urlopen(Request(url, headers=headers, data=data, method=method), timeout=60) as response:
                payload = response.read().decode("utf-8")
                return json.loads(payload), response.headers
        except HTTPError as exc:
            if exc.code == 403 and path_or_url == "/graphql":
                raise
            if exc.code in (403, 429, 500, 502, 503, 504) and attempt < retries - 1:
                reset = exc.headers.get("X-RateLimit-Reset")
                wait = 2 ** attempt
                if reset and exc.code == 403:
                    wait = max(wait, int(reset) - int(time.time()) + 2)
                time.sleep(min(wait, 60))
                continue
            raise
        except URLError:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise
        except http.client.IncompleteRead:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise


def chunks(start: date, end: date, days=1):
    cursor = start
    while cursor <= end:
        chunk_end = min(end, cursor + timedelta(days=days - 1))
        yield cursor, chunk_end
        cursor = chunk_end + timedelta(days=1)


GRAPHQL_QUERY = """
query($query: String!, $after: String) {
  search(query: $query, type: ISSUE, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number
        title
        bodyText
        url
        mergedAt
        createdAt
        additions
        deletions
        changedFiles
        author { login }
        labels(first: 30) { nodes { name } }
        comments { totalCount }
        reviewThreads { totalCount }
        files(first: 100) { nodes { path additions deletions } totalCount }
        reviews(first: 80) { nodes { author { login } state submittedAt } totalCount }
      }
    }
  }
}
"""


def graphql(query: str, variables: dict):
    payload, _ = request_json("/graphql", method="POST", body={"query": query, "variables": variables})
    if payload.get("errors"):
        raise RuntimeError(json.dumps(payload["errors"], indent=2))
    return payload["data"]


def rest_search_day(query: str):
    nodes = []
    page = 1
    total = None
    while True:
        payload, _ = request_json(
            "/search/issues",
            {"q": query, "sort": "updated", "order": "asc", "per_page": 100, "page": page},
        )
        total = payload.get("total_count", total)
        for item in payload.get("items", []):
            pr = item.get("pull_request") or {}
            nodes.append({
                "number": item["number"],
                "title": item.get("title"),
                "bodyText": item.get("body") or "",
                "url": item.get("html_url"),
                "mergedAt": pr.get("merged_at") or item.get("closed_at"),
                "createdAt": item.get("created_at"),
                "additions": 0,
                "deletions": 0,
                "changedFiles": 0,
                "author": {"login": (item.get("user") or {}).get("login")},
                "labels": {"nodes": [{"name": label["name"]} for label in item.get("labels", [])]},
                "comments": {"totalCount": item.get("comments") or 0},
                "reviewThreads": {"totalCount": 0},
                "files": {"nodes": [], "totalCount": 0},
                "reviews": {"nodes": [], "totalCount": 0},
                "source_detail": "rest_search",
            })
        if len(payload.get("items", [])) < 100:
            return nodes, total or len(nodes)
        page += 1


def search_merged_prs():
    seen = {}
    counts = []
    cache_dir = DATA / "daily_graphql"
    cache_dir.mkdir(parents=True, exist_ok=True)
    for a, b in chunks(START, END, 1):
        cache_path = cache_dir / f"{a.isoformat()}.json"
        if cache_path.exists():
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            for node in cached["nodes"]:
                seen[node["number"]] = node
            counts.append(cached["count"])
            continue
        query = f"repo:{REPO} is:pr is:merged merged:{a.isoformat()}..{b.isoformat()}"
        after = None
        day_nodes = []
        try:
            while True:
                data = graphql(GRAPHQL_QUERY, {"query": query, "after": after})
                search = data["search"]
                total = search["issueCount"]
                for node in search.get("nodes", []):
                    if node:
                        node["source_detail"] = "graphql_rich"
                        seen[node["number"]] = node
                        day_nodes.append(node)
                if not search["pageInfo"]["hasNextPage"]:
                    break
                after = search["pageInfo"]["endCursor"]
        except HTTPError as exc:
            if exc.code != 403:
                raise
            print(f"GraphQL throttled on {a.isoformat()}; using REST search fallback")
            day_nodes, total = rest_search_day(query)
            for node in day_nodes:
                seen[node["number"]] = node
        count_row = {"start": a.isoformat(), "end": b.isoformat(), "count": total}
        counts.append(count_row)
        cache_path.write_text(json.dumps({"count": count_row, "nodes": day_nodes}), encoding="utf-8")
        print(f"Fetched {a.isoformat()}: {len(day_nodes)} PRs")
        time.sleep(0.8)
    return list(seen.values()), counts


def paged(path: str, params=None):
    params = dict(params or {})
    params["per_page"] = 100
    page = 1
    output = []
    while True:
        params["page"] = page
        payload, _ = request_json(path, params)
        output.extend(payload)
        if len(payload) < 100:
            return output
        page += 1


AREA_RULES = [
    ("Product analytics", re.compile(r"(^|/)(frontend/src/scenes|posthog/hogql|posthog/queries|posthog/models|posthog/api|ee/).*")),
    ("Data pipeline", re.compile(r"(^|/)(plugin-server|rust|posthog/clickhouse|posthog/temporal|posthog/tasks|posthog/batch_exports).*")),
    ("Infrastructure", re.compile(r"(^|/)(.github|charts|docker|bin|deploy|terraform|dev|posthog/settings|requirements|package-lock).*")),
    ("Frontend", re.compile(r"(^|/)(frontend|storybook|cypress).*")),
    ("Backend", re.compile(r"(^|/)(posthog|ee|common|products).*")),
    ("Docs", re.compile(r"(^|/)(docs|contents|README|\.md$).*")),
    ("Tests", re.compile(r"(^|/)(tests?|__tests__|spec|cypress|fixtures).*")),
]


def classify_file(path: str) -> str:
    for area, pattern in AREA_RULES:
        if pattern.search(path):
            return area
    return "Other"


def is_bot(login: str | None) -> bool:
    if not login:
        return True
    lowered = login.lower()
    return lowered.endswith("[bot]") or lowered in {
        "posthog-bot",
        "github-actions",
        "dependabot",
        "renovate",
        "vercel",
    }


def clamp(value, lo, hi):
    return max(lo, min(hi, value))


def pr_features(record):
    title = record.get("title") or ""
    body = record.get("bodyText") or ""
    text = f"{title}\n{body}".lower()
    labels = [label["name"].lower() for label in (record.get("labels") or {}).get("nodes", [])]
    files = (record.get("files") or {}).get("nodes", [])
    paths = [f["path"] for f in files]
    areas = Counter(classify_file(p) for p in paths)
    if not areas:
        areas["Unknown"] = 1
    production_areas = {area for area in areas if area not in {"Docs", "Tests", "Other"}}
    has_tests = any(classify_file(p) == "Tests" or re.search(r"(test|spec|cypress)", p, re.I) for p in paths)
    has_docs = any(classify_file(p) == "Docs" for p in paths)
    is_bug = any("bug" in label or "fix" in label for label in labels) or bool(
        re.search(r"\b(fix|bug|regression|broken|crash|error|incorrect|failed|failure)\b", text)
    )
    is_feature = any("feature" in label or "enhancement" in label for label in labels) or bool(
        re.search(r"\b(add|new|support|introduce|implement|enable|launch)\b", text)
    )
    is_perf = bool(re.search(r"\b(perf|performance|speed|latency|slow|optimi[sz]e|cache)\b", text))
    is_security = bool(re.search(r"\b(security|permission|auth|privacy|secret|token)\b", text))
    is_migration = any("migration" in p.lower() for p in paths) or "migration" in text
    review_comments = (record.get("reviewThreads") or {}).get("totalCount") or 0
    comments = (record.get("comments") or {}).get("totalCount") or 0
    changed_files = record.get("changedFiles") or (record.get("files") or {}).get("totalCount") or len(files)
    additions = record.get("additions") or 0
    deletions = record.get("deletions") or 0
    reviews = (record.get("reviews") or {}).get("nodes", [])
    review_engagement = len({(r.get("author") or {}).get("login") for r in reviews if (r.get("author") or {}).get("login")})

    score = 1.0
    score += 1.15 if is_bug else 0
    score += 1.00 if is_feature else 0
    score += 0.95 if is_perf else 0
    score += 0.90 if is_security else 0
    score += 0.55 if is_migration else 0
    score += 0.65 if has_tests and production_areas else 0
    score += 0.30 if has_docs and production_areas else 0
    score += min(1.15, 0.25 * len(production_areas))
    score += min(0.80, math.log1p(changed_files) / 3.0)
    score += min(0.80, math.log1p(additions + deletions) / 8.0)
    score += min(0.80, (review_comments + comments) / 16.0)
    score += min(0.55, review_engagement / 8.0)
    score = clamp(score, 0.6, 6.5)
    if not production_areas and has_docs:
        score *= 0.72

    return {
        "number": record["number"],
        "title": title,
        "author": (record.get("author") or {}).get("login"),
        "url": record.get("url"),
        "merged_at": record.get("mergedAt"),
        "labels": labels,
        "areas": dict(areas),
        "top_area": areas.most_common(1)[0][0] if areas else "Other",
        "production_area_count": len(production_areas),
        "has_tests": has_tests,
        "has_docs": has_docs,
        "is_bug": is_bug,
        "is_feature": is_feature,
        "is_perf": is_perf,
        "is_security": is_security,
        "is_migration": is_migration,
        "changed_files": changed_files,
        "additions": additions,
        "deletions": deletions,
        "comments": comments,
        "review_comments": review_comments,
        "reviewer_count": review_engagement,
        "reviews_truncated": ((record.get("reviews") or {}).get("totalCount") or 0) > len(reviews),
        "files_truncated": ((record.get("files") or {}).get("totalCount") or 0) > len(files),
        "impact_points": round(score, 2),
    }


def analyze(records, chunk_counts):
    pr_rows = []
    people = defaultdict(lambda: {
        "login": "",
        "prs": 0,
        "ship_points": 0.0,
        "bug_points": 0.0,
        "feature_points": 0.0,
        "perf_security_points": 0.0,
        "review_points": 0.0,
        "areas": Counter(),
        "evidence": [],
        "reviewed_prs": set(),
        "review_approvals": 0,
        "review_comments": 0,
        "recent_titles": [],
        "active_weeks": set(),
        "recent_30_ship_points": 0.0,
    })
    all_areas = Counter()

    for record in records:
        f = pr_features(record)
        author = f["author"]
        if not is_bot(author):
            person = people[author]
            person["login"] = author
            person["prs"] += 1
            person["ship_points"] += f["impact_points"]
            person["bug_points"] += f["impact_points"] if f["is_bug"] else 0
            person["feature_points"] += f["impact_points"] if f["is_feature"] else 0
            person["perf_security_points"] += f["impact_points"] if (f["is_perf"] or f["is_security"]) else 0
            for area, count in f["areas"].items():
                person["areas"][area] += count
                all_areas[area] += count
            person["evidence"].append(f)
            person["recent_titles"].append(f"#{record['number']} {f['title']}")
            if f.get("merged_at"):
                merged_day = datetime.fromisoformat(f["merged_at"].replace("Z", "+00:00")).date()
                person["active_weeks"].add(merged_day.isocalendar()[:2])
                if (END - merged_day).days <= 30:
                    person["recent_30_ship_points"] += f["impact_points"]

        review_seen = set()
        for review in (record.get("reviews") or {}).get("nodes", []):
            reviewer = (review.get("author") or {}).get("login")
            if is_bot(reviewer) or reviewer == author:
                continue
            key = (reviewer, record["number"])
            if key in review_seen:
                continue
            review_seen.add(key)
            reviewer_row = people[reviewer]
            reviewer_row["login"] = reviewer
            reviewer_row["reviewed_prs"].add(record["number"])
            state = review.get("state")
            reviewer_row["review_points"] += 0.55 if state == "APPROVED" else 0.35
            reviewer_row["review_approvals"] += 1 if state == "APPROVED" else 0
            reviewer_row["review_comments"] += 1 if state in {"COMMENTED", "CHANGES_REQUESTED"} else 0

        pr_rows.append({"number": record["number"], **f})

    max_ship = max((p["ship_points"] for p in people.values()), default=1)
    max_review = max((p["review_points"] for p in people.values()), default=1)
    max_breadth = max((len([a for a, c in p["areas"].items() if a not in {"Docs", "Tests", "Other"} and c >= 2]) for p in people.values()), default=1)
    max_active_weeks = max((len(p["active_weeks"]) for p in people.values()), default=1)

    people_rows = []
    for login, p in people.items():
        area_counts = dict(p["areas"])
        product_breadth = len([a for a, c in p["areas"].items() if a not in {"Docs", "Tests", "Other"} and c >= 2])
        quality_mix = 0
        if p["ship_points"]:
            quality_mix = (p["bug_points"] * 0.45 + p["perf_security_points"] * 0.65 + min(p["ship_points"], p["prs"] * 1.0)) / p["ship_points"]
        ship_norm = math.log1p(p["ship_points"]) / math.log1p(max_ship)
        review_norm = math.log1p(p["review_points"]) / math.log1p(max_review)
        breadth_norm = product_breadth / max_breadth if max_breadth else 0
        consistency_norm = len(p["active_weeks"]) / max_active_weeks if max_active_weeks else 0
        quality_norm = clamp(quality_mix, 0, 1.4) / 1.4
        score = 100 * (
            0.44 * ship_norm
            + 0.22 * review_norm
            + 0.16 * breadth_norm
            + 0.10 * quality_norm
            + 0.08 * consistency_norm
        )
        top_evidence = sorted(p["evidence"], key=lambda x: x["impact_points"], reverse=True)[:5]
        production_area_counts = Counter({k: v for k, v in area_counts.items() if k not in {"Tests", "Docs", "Other"}})
        top_area = production_area_counts.most_common(1)[0][0] if production_area_counts else (
            Counter(area_counts).most_common(1)[0][0] if area_counts else "Other"
        )
        people_rows.append({
            "login": login,
            "impact_score": round(score, 1),
            "prs_merged": p["prs"],
            "ship_points": round(p["ship_points"], 1),
            "review_points": round(p["review_points"], 1),
            "reviewed_prs": len(p["reviewed_prs"]),
            "review_approvals": p["review_approvals"],
            "review_comments": p["review_comments"],
            "bug_points": round(p["bug_points"], 1),
            "feature_points": round(p["feature_points"], 1),
            "perf_security_points": round(p["perf_security_points"], 1),
            "product_breadth": product_breadth,
            "active_weeks": len(p["active_weeks"]),
            "recent_30_ship_points": round(p["recent_30_ship_points"], 1),
            "components": {
                "shipped_outcome": round(100 * ship_norm, 1),
                "review_leverage": round(100 * review_norm, 1),
                "cross_area_ownership": round(100 * breadth_norm, 1),
                "quality_risk_mix": round(100 * quality_norm, 1),
                "consistency": round(100 * consistency_norm, 1),
            },
            "area_counts": area_counts,
            "top_area": top_area,
            "evidence": [
                {
                    "number": e.get("number"),
                    "title": e["title"],
                    "url": e["url"],
                    "impact_points": e["impact_points"],
                    "top_area": e["top_area"],
                    "why": ", ".join(
                        label for label, yes in [
                            ("bug/regression", e["is_bug"]),
                            ("feature/product", e["is_feature"]),
                            ("performance", e["is_perf"]),
                            ("security/privacy", e["is_security"]),
                            ("tests included", e["has_tests"]),
                            ("cross-area", e["production_area_count"] >= 2),
                        ] if yes
                    ) or "reviewed shipped change",
                }
                for e in top_evidence
            ],
        })

    people_rows.sort(key=lambda x: x["impact_score"], reverse=True)
    pr_rows.sort(key=lambda x: x["merged_at"] or "", reverse=True)
    return {
        "metadata": {
            "repo": REPO,
            "window_start": START.isoformat(),
            "window_end": END.isoformat(),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "merged_pr_count": len(pr_rows),
            "engineer_count": len([p for p in people_rows if p["prs_merged"] > 0 or p["reviewed_prs"] > 0]),
            "chunk_counts": chunk_counts,
            "model": {
                "definition": "Impact is reviewed work that changed product/customer outcomes, improved reliability or speed, reduced risk, or amplified others through substantive review. The model intentionally uses merged PRs, labels/text, touched areas, tests/docs, migrations, review engagement, and cross-area breadth; raw lines and commit counts are only minor complexity context.",
                "score_weights": {
                    "shipped_outcome": 0.44,
                    "review_leverage": 0.22,
                    "cross_area_ownership": 0.16,
                    "quality_risk_mix": 0.10,
                    "consistency": 0.08,
                },
                "aggregation_note": "Shipped work and review leverage use log scaling so one very active contributor does not win merely by raw PR volume. Individual PR value comes from labels/text, touched areas, tests/docs, migrations, review engagement, and risk or product signals.",
            },
        },
        "people": people_rows,
        "prs": pr_rows,
        "areas": [{"area": k, "files_touched": v} for k, v in all_areas.most_common()],
    }


def write_outputs(analysis):
    DATA.mkdir(exist_ok=True)
    (DATA / "analysis.json").write_text(json.dumps(analysis, indent=2), encoding="utf-8")
    with (DATA / "people.csv").open("w", newline="", encoding="utf-8") as fh:
        fieldnames = [
            "login", "impact_score", "prs_merged", "ship_points", "review_points",
            "reviewed_prs", "bug_points", "feature_points", "perf_security_points",
            "product_breadth", "top_area",
        ]
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in analysis["people"]:
            writer.writerow({k: row.get(k) for k in fieldnames})


def main():
    DATA.mkdir(exist_ok=True)
    records, chunk_counts = search_merged_prs()
    print(f"Found {len(records)} merged PRs from {START} through {END}")
    raw_path = DATA / "raw_pr_records.json"
    raw_path.write_text(json.dumps(records, indent=2), encoding="utf-8")
    analysis = analyze(records, chunk_counts)
    write_outputs(analysis)
    print(json.dumps({
        "merged_prs": analysis["metadata"]["merged_pr_count"],
        "engineers": analysis["metadata"]["engineer_count"],
        "top5": [p["login"] for p in analysis["people"][:5]],
    }, indent=2))


if __name__ == "__main__":
    main()
