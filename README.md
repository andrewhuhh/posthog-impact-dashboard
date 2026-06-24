# PostHog Engineering Impact Dashboard

Dashboard for the Weave take-home assignment.

## Impact Definition

Impact is reviewed work that changed product or customer outcomes, improved reliability or speed, reduced operational risk, or amplified other engineers through substantive review.

The score intentionally avoids raw line-count or commit-count ranking. It combines:

- Shipped outcome: merged PRs weighted by product, bug/regression, performance, security, migration, test, documentation, and cross-area signals.
- Review leverage: review participation on other engineers' PRs.
- Ownership breadth: meaningful activity across product/system areas.
- Quality/risk mix: bug, regression, performance, security, and test-heavy work.
- Consistency: active weeks in the 90-day window.

Shipped work and review leverage use diminishing returns so very high PR volume does not automatically dominate.

## Data

- Repository: `PostHog/posthog`
- Window: `2026-03-25` through `2026-06-23`
- Merged PRs found: `9,279`
- Contributors scored: `211`

GitHub GraphQL supplied rich PR metadata, labels, files, and reviews where available. During secondary GitHub throttling, a subset of days fell back to GitHub REST search; those PRs still include title, body, author, labels, comments, and merge date, but have lighter file/review detail.

## Dashboard

Public URL: https://site-b8ww3m7wq-andrewhuhhs-projects.vercel.app

The current UI is styled after PostHog's product dashboard layout: resizable left app navigation, a scrollable inner content card inside a dashboard shell, sticky action/filter header, Lucide iconography, Inter body/control typography, Matter heading typography, bordered insight tiles, hover/focus info popovers for tile metadata, and a measured masonry tile grid that packs variable-height cards without fixed grid gaps.

Timer: 33 minutes 3 seconds, from 2026-06-23 15:41:55 to 16:14:58 America/Vancouver.

## Reproduce

```powershell
python fetch_analyze.py
Copy-Item -Force data\analysis.json site\public\data\analysis.json
cd site
npm install
npm run build
```

## Top 5

1. Gilbert09
2. pauldambra
3. rnegron
4. webjunkie
5. sampennington
