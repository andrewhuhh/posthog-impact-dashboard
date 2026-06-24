# PostHog Engineering Impact Dashboard

Single-page dashboard for the PostHog engineering impact take-home.

Public dashboard URL: https://posthog-impact-dashboard-seven.vercel.app

## Impact Definition

Impact is reviewed engineering work that changed product or customer outcomes, improved reliability or speed, reduced operational risk, or amplified other engineers through review and ownership.

The dashboard uses the imported qualitative/programmatic analysis export as its source of truth. The ranking is not based on raw commits, lines of code, file count, or raw PR count. It combines:

- Impact rank from the contributor-level analysis.
- PR quality score across reviewed evidence.
- Problem importance, technical soundness, risk handling, review collaboration, validation, area leverage, and communication rubric scores.
- Strengths and caveats from the qualitative assessment.
- Representative PR and review evidence linked back to GitHub.
- Public GitHub profile names and avatars, with handle fallback where unavailable.

## Data

- Repository analyzed: `PostHog/posthog`
- Analysis window: `2026-05-24` through `2026-06-23`
- Contributors ranked: `210`
- PRs qualitatively reviewed: `385`
- Cached source records: `6,656`

Runtime dashboard data is cached in `site/public/data/analysis/` so the page loads without GitHub API calls.

## Dashboard

The UI is styled after PostHog's product dashboard layout: resizable left navigation on desktop, mobile sheet navigation, scrollable inner content card, sticky header controls, Lucide iconography, Inter body/control typography, Matter heading typography, bordered insight tiles, edge-aware info popovers, and card action menus.

## Reproduce

```powershell
cd site
npm install
npm run build
```

To refresh the dashboard cache from the analysis export, copy:

```powershell
Copy-Item -Force ..\..\workweave-posthog-assessment\data\contributor_quality_scores.json public\data\analysis\contributor_quality_scores.json
Copy-Item -Force ..\..\workweave-posthog-assessment\data\qualitative_pr_reviews.json public\data\analysis\qualitative_pr_reviews.json
Copy-Item -Force ..\..\workweave-posthog-assessment\data\quality_assessment_sources.json public\data\analysis\quality_assessment_sources.json
```

## Current Top 5

1. Tom Owers (`@Gilbert09`)
2. Paul D'Ambra (`@pauldambra`)
3. Andrew Maguire (`@andrewm4894`)
4. Sam Pennington (`@sampennington`)
5. Julian Bez (`@webjunkie`)
