import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import {
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Database,
  Download,
  ExternalLink,
  FileJson,
  Files,
  Filter,
  Folder,
  Gauge,
  GripVertical,
  Info,
  ListFilter,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Table2,
  Trophy,
  UserRound,
  Users,
  X,
} from "lucide-react";
import "./styles.css";

type ReviewInteraction = {
  example: string;
  pr_number: number;
  pr_title: string;
  pr_url: string;
  review_quality_percent: number;
  review_quality_score: number;
  sources: string[];
  substantive: boolean;
};

type ContributorQuality = {
  communication_quality_average: number;
  confidence: string;
  contributor: string;
  executive_summary: string;
  high_confidence_impact_count: number;
  ownership_signal: number;
  quality_consistency_percent: number;
  quality_score: number;
  representative_sources: string[];
  review_interactions: ReviewInteraction[];
  review_leverage_quality: number;
  reviewed_pr_count: number;
  reviewed_review_interaction_count: number;
  risks_or_caveats: string[];
  score_distribution: { max: number; median: number; min: number };
  top_strengths: string[];
  weighted_pr_quality_average: number;
};

type RubricScore = {
  justification: string;
  score: number;
  sources: string[];
};

type QualitativePr = {
  areas: string[];
  confidence: string;
  contributor: string;
  existing_impact_points: number;
  limitations: string[];
  merged_at: string;
  pr_number: number;
  pr_quality_score: number;
  pr_title: string;
  pr_url: string;
  scores: Record<string, RubricScore>;
  summary_judgment: string;
  work_type: string;
};

type AnalysisDashboard = {
  contributors: ContributorQuality[];
  reviews: QualitativePr[];
  sourceCount: number;
  generatedAt: string;
  cohortStart: string;
  cohortEnd: string;
  repo: string;
};

type PageMode = "leaderboard" | "contributor" | "raw";
type RawTable = "contributors" | "prs";

type RouteState = {
  pageMode: PageMode;
  contributor?: string;
  rawTable: RawTable;
};

type TooltipContent = {
  kicker?: string;
  title?: string;
  description?: string;
  rows?: {
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
  }[];
};

type DropdownOption<T extends string | number> = {
  value: T;
  label: string;
  description?: string;
};

const rubricLabels: Record<string, string> = {
  problem_importance: "Problem importance",
  technical_soundness: "Technical soundness",
  risk_handling: "Risk handling",
  review_collaboration: "Review collaboration",
  test_validation: "Test validation",
  area_leverage: "Area leverage",
  communication: "Communication",
};

const rubricColors = ["#f5a623", "#2451f5", "#20745f", "#d64f2a", "#7e2bc8", "#111111", "#8f969e"];
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function parseRoute(): RouteState {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const search = new URLSearchParams(window.location.search);

  if (path.startsWith("/contributors/")) {
    return {
      pageMode: "contributor",
      contributor: decodeURIComponent(path.replace("/contributors/", "")),
      rawTable: "contributors",
    };
  }

  if (path === "/data") {
    return {
      pageMode: "raw",
      rawTable: search.get("table") === "prs" ? "prs" : "contributors",
    };
  }

  return {
    pageMode: "leaderboard",
    rawTable: "contributors",
  };
}

function contributorPath(contributor: string) {
  return `/contributors/${encodeURIComponent(contributor)}`;
}

function rawPath(table: RawTable) {
  return `/data?table=${table}`;
}

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatRank(rank: number) {
  return `#${formatNumber(rank)}`;
}

function pct(value: number) {
  return `${formatNumber(Math.round(value))}%`;
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatDateTime(date: string) {
  return new Date(date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function averageRubricScores(reviews: QualitativePr[]) {
  const totals = new Map<string, { total: number; count: number }>();

  reviews.forEach((review) => {
    Object.entries(review.scores).forEach(([key, value]) => {
      const current = totals.get(key) ?? { total: 0, count: 0 };
      totals.set(key, { total: current.total + value.score, count: current.count + 1 });
    });
  });

  return Array.from(totals.entries()).map(([key, value]) => ({
    key,
    label: rubricLabels[key] ?? key,
    percent: (value.total / value.count / 5) * 100,
    score: value.total / value.count,
  }));
}

function contributorReviews(data: AnalysisDashboard, contributor: string) {
  return data.reviews.filter((review) => review.contributor === contributor);
}

function topAreas(reviews: QualitativePr[]) {
  const counts = new Map<string, number>();
  reviews.forEach((review) => review.areas.forEach((area) => counts.set(area, (counts.get(area) ?? 0) + 1)));
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

function reasonFor(person: ContributorQuality, rank: number) {
  return `${formatRank(rank)} in the analysis because ${person.executive_summary.replace(/^.*?shows /i, "").replace(/\.$/, "")}.`;
}

function RankMarker({ rank }: { rank: number }) {
  return <span className="rank-leading">{formatRank(rank)}</span>;
}

function DropdownControl<T extends string | number>({
  label,
  value,
  options,
  onChange,
  leading,
  displayValue,
}: {
  label: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  leading?: React.ReactNode;
  displayValue?: string;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="dropdown-control" ref={dropdownRef}>
      <button
        className={`dropdown-trigger ${open ? "open" : ""}`}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="dropdown-leading" aria-hidden="true">{leading}</span>
        <span className="dropdown-value">{displayValue ?? selected?.label}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="dropdown-sheet" role="listbox" aria-label={label}>
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                className={`dropdown-option ${active ? "active" : ""}`}
                type="button"
                role="option"
                aria-selected={active}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>
                  <b>{option.label}</b>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
                {active ? <Check size={15} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function EdgeAwarePopover({
  id,
  trigger,
  children,
  className = "",
}: {
  id: string;
  trigger: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLSpanElement | null>(null);

  const updatePosition = () => {
    const triggerRect = wrapRef.current?.getBoundingClientRect();
    const popover = popoverRef.current;

    if (!triggerRect || !popover) {
      return;
    }

    const margin = 12;
    const boundaryLeft = margin;
    const boundaryRight = window.innerWidth - margin;
    const boundaryBottom = window.innerHeight - margin;
    const boundaryWidth = Math.max(220, boundaryRight - boundaryLeft);
    const desiredWidth = className.includes("analysis-date-popover") ? 340 : 360;
    const width = Math.min(desiredWidth, boundaryWidth);
    const centeredLeft = triggerRect.left + triggerRect.width / 2 - width / 2;
    const leftAligned = triggerRect.left;
    const rightAligned = triggerRect.right - width;
    const hasRoomRight = leftAligned + width <= boundaryRight;
    const hasRoomLeft = rightAligned >= boundaryLeft;
    const preferredLeft = hasRoomRight && !hasRoomLeft
      ? leftAligned
      : hasRoomLeft && !hasRoomRight
        ? rightAligned
        : centeredLeft;
    const left = Math.max(boundaryLeft, Math.min(preferredLeft, boundaryRight - width));
    const belowTop = triggerRect.bottom + 10;
    const aboveTop = triggerRect.top - popover.offsetHeight - 10;
    const top = belowTop + popover.offsetHeight <= boundaryBottom ? belowTop : Math.max(8, aboveTop);

    setStyle({ left, top, width });
  };

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <span
      className="info-wrap"
      ref={wrapRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {trigger}
      {open ? createPortal(
        <span className={`info-popover edge-aware-popover ${className}`} id={id} role="tooltip" ref={popoverRef} style={style}>
          {children}
        </span>,
        document.body,
      ) : null}
    </span>
  );
}

function TileActions({ title, description }: { title: string; description: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const copyMarkdown = async () => {
    const tile = menuRef.current?.closest(".tile");
    const body = tile?.querySelector(".tile-body, .selected-body") as HTMLElement | null;
    const content = body?.innerText.trim() || description;

    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => {
      setCopied(false);
      setOpen(false);
    }, 850);
  };

  return (
    <div className="tile-actions" ref={menuRef}>
      <button className={`icon-button ${open ? "active" : ""}`} aria-label={`${title} actions`} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div className="tile-action-menu" role="menu">
          <button type="button" role="menuitem" onClick={copyMarkdown}>
            {copied ? <Check size={14} aria-hidden="true" /> : <Files size={14} aria-hidden="true" />}
            {copied ? "Copied" : "Copy as Markdown"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TileHeader({
  color,
  title,
  description,
  tooltip,
}: {
  color: string;
  title: string;
  description: string;
  tooltip?: TooltipContent;
}) {
  const tooltipId = `tip-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;

  return (
    <div className="tile-head">
      <span className="tile-accent" style={{ background: color }} />
      <div>
        <h3>
          {title}
          {tooltip ? (
            <EdgeAwarePopover
              id={tooltipId}
              trigger={(
                <button className="info-trigger" aria-label={`About ${title}`} aria-describedby={tooltipId}>
                  <Info size={16} aria-hidden="true" />
                </button>
              )}
            >
              {tooltip.kicker ? <span className="popover-kicker">{tooltip.kicker}</span> : null}
              <span className="popover-title">{tooltip.title ?? title}</span>
              {tooltip.description ? <span className="popover-description">{tooltip.description}</span> : null}
              {tooltip.rows?.map((row) => (
                <span className="popover-row" key={row.label}>
                  {row.icon}
                  <span><b>{row.label}</b>{row.value}</span>
                </span>
              ))}
            </EdgeAwarePopover>
          ) : null}
        </h3>
        <p>{description}</p>
      </div>
      <TileActions title={title} description={description} />
    </div>
  );
}

function AnalysisDate({ data }: { data: AnalysisDashboard }) {
  const dateText = formatDate(data.cohortEnd);
  const startText = formatDate(data.cohortStart);

  return (
    <span className="analysis-date-wrap">
      Analysis through{" "}
      <EdgeAwarePopover
        id="analysis-date-popover"
        className="analysis-date-popover"
        trigger={(
          <span className="analysis-date" tabIndex={0} aria-describedby="analysis-date-popover">
            {dateText}
          </span>
        )}
      >
        <span className="popover-kicker">analysis window</span>
        <span className="popover-title">{dateText}</span>
        <span className="popover-description">
          De facto source of truth for this dashboard, covering a reconstructed cohort from {startText} through {dateText}.
        </span>
        <span className="popover-row"><CalendarDays size={14} aria-hidden="true" /><span><b>Generated</b> {new Date(data.generatedAt).toLocaleString()}</span></span>
        <span className="popover-row"><ListFilter size={14} aria-hidden="true" /><span><b>PRs qualitatively reviewed</b> {formatNumber(data.reviews.length)}</span></span>
        <span className="popover-row"><CircleUserRound size={14} aria-hidden="true" /><span><b>Contributors ranked</b> {formatNumber(data.contributors.length)}</span></span>
      </EdgeAwarePopover>
    </span>
  );
}

function PersonRow({
  person,
  rank,
  onOpen,
}: {
  person: ContributorQuality;
  rank: number;
  onOpen: () => void;
}) {
  return (
    <button className="person-row" type="button" onClick={onOpen}>
      <div className="rank"><RankMarker rank={rank} /></div>
      <div className="person-main">
        <div className="handle">@{person.contributor}</div>
        <div className="summary">{reasonFor(person, rank)}</div>
        <div className="metrics">
          <span>{person.confidence} confidence</span>
          <span>{person.reviewed_pr_count} reviewed PRs</span>
          <span>{person.high_confidence_impact_count} high-confidence impact PRs</span>
        </div>
      </div>
      <div className="score">
        <strong>{person.quality_score}</strong>
        <span>quality score</span>
      </div>
    </button>
  );
}

function ComponentBars({ items }: { items: { key: string; label: string; percent: number }[] }) {
  return (
    <div className="bars">
      {items.map((item, index) => (
        <div className="bar-row" key={item.key}>
          <div className="bar-label">
            <span>{item.label}</span>
            <b>{pct(item.percent)}</b>
          </div>
          <div className="track">
            <div className="fill" style={{ width: `${item.percent}%`, background: rubricColors[index % rubricColors.length] }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Sidebar({
  onResizeStart,
  pageMode,
  navigatePage,
  contributors,
  selectedContributor,
  openContributor,
  rawTable,
  navigateRawTable,
  mobileOpen,
  closeMobileSidebar,
}: {
  onResizeStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
  pageMode: PageMode;
  navigatePage: (mode: PageMode) => void;
  contributors: ContributorQuality[];
  selectedContributor?: string;
  openContributor: (index: number) => void;
  rawTable: RawTable;
  navigateRawTable: (table: RawTable) => void;
  mobileOpen: boolean;
  closeMobileSidebar: () => void;
}) {
  const [sectionsOpen, setSectionsOpen] = useState(true);
  const [dataOpen, setDataOpen] = useState(true);
  const [contributorSheetOpen, setContributorSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filteredContributors = contributors.filter((person) =>
    person.contributor.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const topFive = contributors.slice(0, 5);
  const remainingContributors = contributors.slice(5);
  const displayedContributors = query ? filteredContributors : remainingContributors;

  useEffect(() => {
    if (!contributorSheetOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContributorSheetOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contributorSheetOpen]);

  return (
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="workspace">
        <div className="avatar">P</div>
        <strong>PostHog impact</strong>
      </div>
      <div className="mode-switch">
        <button className={pageMode !== "raw" ? "active" : ""} onClick={() => { navigatePage("leaderboard"); closeMobileSidebar(); }}>
          <BarChart3 size={15} aria-hidden="true" />Graphs
        </button>
        <button className={pageMode === "raw" ? "active" : ""} onClick={() => { navigatePage("raw"); closeMobileSidebar(); }}>
          <Table2 size={15} aria-hidden="true" />Raw
        </button>
      </div>
      <nav className="side-nav">
        <button className="side-section-toggle" type="button" onClick={() => setSectionsOpen((open) => !open)}>
          <span><Folder size={14} aria-hidden="true" />Project</span>
          <ChevronRight className={sectionsOpen ? "expanded" : ""} size={14} aria-hidden="true" />
        </button>
        {sectionsOpen ? (
          <div className="side-section">
            <button className={`side-row ${pageMode === "leaderboard" ? "active" : ""}`} onClick={() => { navigatePage("leaderboard"); closeMobileSidebar(); }}>
              <LayoutDashboard size={15} aria-hidden="true" />Leaderboard home
            </button>
            <button
              className={`side-row has-sheet ${pageMode === "contributor" ? "active" : ""}`}
              onClick={() => setContributorSheetOpen((open) => !open)}
              aria-expanded={contributorSheetOpen}
            >
              <Gauge size={15} aria-hidden="true" />Contributor page
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <button className="side-section-toggle" type="button" onClick={() => setDataOpen((open) => !open)}>
          <span><Database size={14} aria-hidden="true" />Data</span>
          <ChevronRight className={dataOpen ? "expanded" : ""} size={14} aria-hidden="true" />
        </button>
        {dataOpen ? (
          <div className="side-section">
            <button
              className={`side-row ${pageMode === "raw" && rawTable === "contributors" ? "active" : ""}`}
              onClick={() => { navigateRawTable("contributors"); closeMobileSidebar(); }}
            >
              <Table2 size={15} aria-hidden="true" />Raw contributor table
            </button>
            <button
              className={`side-row ${pageMode === "raw" && rawTable === "prs" ? "active" : ""}`}
              onClick={() => { navigateRawTable("prs"); closeMobileSidebar(); }}
            >
              <ListFilter size={15} aria-hidden="true" />Raw PR reviews
            </button>
            <a className="side-row" href="/data/analysis/contributor_quality_scores.json" download><Download size={15} aria-hidden="true" />Download scores</a>
          </div>
        ) : null}
      </nav>
      {contributorSheetOpen ? (
        <div className="sidebar-extension">
          <div className="sidebar-extension-head">
            <b>Contributor profiles</b>
            <button className="icon-button" onClick={() => setContributorSheetOpen(false)} aria-label="Close contributor profiles">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <label className="sidebar-search">
            <Search size={14} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search contributors" />
          </label>
          {!query ? (
            <div className="sidebar-extension-group">
              <p>Top five</p>
              {topFive.map((person, index) => (
                <button
                  className={`contributor-link ${selectedContributor === person.contributor ? "active" : ""}`}
                  key={person.contributor}
                  onClick={() => {
                    openContributor(index);
                    setContributorSheetOpen(false);
                    closeMobileSidebar();
                  }}
                >
                  <span>{formatRank(index + 1)}</span>
                  <b>@{person.contributor}</b>
                  <em>{formatNumber(person.quality_score)}</em>
                </button>
              ))}
            </div>
          ) : null}
          <div className="sidebar-extension-group">
            <p>{query ? "Matching contributors" : "Rest"}</p>
            {displayedContributors.map((person) => {
              const index = contributors.findIndex((candidate) => candidate.contributor === person.contributor);
              return (
                <button
                  className={`contributor-link ${selectedContributor === person.contributor ? "active" : ""}`}
                  key={person.contributor}
                  onClick={() => {
                    openContributor(index);
                    setContributorSheetOpen(false);
                    closeMobileSidebar();
                  }}
                >
                  <span>{formatRank(index + 1)}</span>
                  <b>@{person.contributor}</b>
                  <em>{formatNumber(person.quality_score)}</em>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="sidebar-note">
        The imported qualitative analysis is the primary layer: ranking, contributor pages, and raw tables use its reviewed evidence.
      </div>
      <div className="sidebar-bottom">
        <a href="https://github.com/PostHog/posthog" target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" />Source repo</a>
        <a href="/data/analysis/qualitative_pr_reviews.json" target="_blank" rel="noreferrer"><FileJson size={15} aria-hidden="true" />Reviewed PRs</a>
      </div>
      <button className="resize-handle" onPointerDown={onResizeStart} aria-label="Resize sidebar">
        <GripVertical size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}

function LeaderboardHome({
  data,
  openContributor,
}: {
  data: AnalysisDashboard;
  openContributor: (index: number) => void;
}) {
  const topFive = data.contributors.slice(0, 5);

  return (
    <section className="leaderboard-home" id="rankings">
      <section className="tile tile-wide">
        <TileHeader
          color="#2451f5"
          title="Leaderboard home"
          description="Ranked contributors, using qualitative PR review and programmatic source evidence as the primary impact model."
          tooltip={{
            kicker: "Ranking source",
            description: "This view uses the imported contributor order as the dashboard's source of truth.",
            rows: [
              { icon: <Trophy size={14} aria-hidden="true" />, label: "Ranking basis", value: "Final contributor quality assessment" },
              { icon: <ListFilter size={14} aria-hidden="true" />, label: "Cohort", value: `${formatNumber(data.contributors.length)} ranked contributors from the exported analysis` },
              { icon: <Database size={14} aria-hidden="true" />, label: "Evidence", value: `${formatNumber(data.reviews.length)} qualitatively reviewed PRs plus ${formatNumber(data.sourceCount)} cached source records` },
            ],
          }}
        />
        <div className="tile-body">
          <div className="quicklinks">
            {topFive.map((person, index) => (
              <button className="quicklink" key={person.contributor} onClick={() => openContributor(index)}>
                <span className="quicklink-rank"><RankMarker rank={index + 1} /></span>
                <b>@{person.contributor}</b>
                <em>{formatNumber(person.quality_score)} quality score</em>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="tile raw-table-tile">
        <TileHeader
          color="#111111"
          title="Complete leaderboard"
          description="All ranked contributors from the analysis export, ordered by its final quality assessment."
          tooltip={{
            kicker: "Leaderboard table",
            description: "A compact audit view of the contributor-level summary file.",
            rows: [
              { icon: <CircleUserRound size={14} aria-hidden="true" />, label: "Rows", value: "One row per ranked contributor" },
              { icon: <Gauge size={14} aria-hidden="true" />, label: "Quality", value: "Final 0-100 contributor score" },
              { icon: <Filter size={14} aria-hidden="true" />, label: "Open", value: "Jumps to the contributor profile with deeper evidence" },
            ],
          }}
        />
        <div className="tile-body leaderboard-table">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Engineer</th>
                <th>Quality</th>
                <th>Reviewed PRs</th>
                <th>High confidence</th>
                <th>Consistency</th>
                <th>Confidence</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {data.contributors.map((person, index) => (
                <tr key={person.contributor}>
                  <td>{formatRank(index + 1)}</td>
                  <td>@{person.contributor}</td>
                  <td>{formatNumber(person.quality_score)}</td>
                  <td>{formatNumber(person.reviewed_pr_count)}</td>
                  <td>{formatNumber(person.high_confidence_impact_count)}</td>
                  <td>{pct(person.quality_consistency_percent)}</td>
                  <td>{person.confidence}</td>
                  <td>
                    <button className="table-link" onClick={() => openContributor(index)}>View profile</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function ContributorProfile({ data, person, rank }: { data: AnalysisDashboard; person: ContributorQuality; rank: number }) {
  const reviews = contributorReviews(data, person.contributor);
  const rubric = averageRubricScores(reviews);
  const areas = topAreas(reviews).slice(0, 6);
  const maxArea = Math.max(...areas.map(([, count]) => count), 1);

  return (
    <section className="insight-grid contributor-profile-grid">
      <section className="tile selected-tile">
        <TileHeader
          color="#f5a623"
          title={`${formatRank(rank)} @${person.contributor}`}
          description={person.executive_summary}
          tooltip={{
            kicker: "Contributor profile",
            description: "Profile summary from the contributor quality export.",
            rows: [
              { icon: <Trophy size={14} aria-hidden="true" />, label: "Rank", value: `${formatRank(rank)} in the analysis output` },
              { icon: <Gauge size={14} aria-hidden="true" />, label: "Score", value: `${formatNumber(person.quality_score)}/100 final quality score` },
              { icon: <ListFilter size={14} aria-hidden="true" />, label: "Sample", value: `${formatNumber(person.reviewed_pr_count)} reviewed PRs, ${formatNumber(person.high_confidence_impact_count)} high-confidence impact PRs` },
            ],
          }}
        />
        <div className="selected-body">
          <div className="selected-metric">
            <b>{formatNumber(person.quality_score)}</b>
            <span>Quality score</span>
          </div>
          <div className="metric-strip">
            <div><b>{formatNumber(person.reviewed_pr_count)}</b><span>Reviewed PRs</span></div>
            <div><b>{formatNumber(person.high_confidence_impact_count)}</b><span>High-confidence impact</span></div>
            <div><b>{person.confidence}</b><span>Confidence</span></div>
          </div>
          <a className="lemon-button" href={`https://github.com/${person.contributor}`} target="_blank" rel="noreferrer">
            <ExternalLink size={16} aria-hidden="true" />GitHub profile
          </a>
        </div>
      </section>

      <section className="tile">
        <TileHeader
          color="#2451f5"
          title="Rubric breakdown"
          description="Average score across this contributor's reviewed PR sample, normalized from the 0-5 review rubric."
          tooltip={{
            kicker: "Rubric averages",
            description: "Each bar averages the scored dimensions across this contributor's reviewed PRs.",
            rows: [
              { icon: <Gauge size={14} aria-hidden="true" />, label: "Scale", value: "Scores were assigned from 0 to 5, then normalized to percentages for display" },
              { icon: <ListFilter size={14} aria-hidden="true" />, label: "Dimensions", value: "Importance, soundness, risk handling, collaboration, validation, leverage, and communication" },
              { icon: <Database size={14} aria-hidden="true" />, label: "Rows included", value: `${formatNumber(reviews.length)} reviewed PRs for @${person.contributor}` },
            ],
          }}
        />
        <div className="tile-body">
          <ComponentBars items={rubric} />
        </div>
      </section>

      <section className="tile">
        <TileHeader
          color="#20745f"
          title="Why they rank highly"
          description="Human-readable strengths and caveats from the qualitative assessment."
          tooltip={{
            kicker: "Narrative assessment",
            description: "This card carries the plain-language interpretation, not a separate formula.",
            rows: [
              { icon: <Check size={14} aria-hidden="true" />, label: "Strengths", value: "Positive evidence that supports the contributor's rank" },
              { icon: <Filter size={14} aria-hidden="true" />, label: "Caveats", value: "Known weaknesses, sparse signals, or reasons to avoid over-reading the score" },
            ],
          }}
        />
        <div className="tile-body narrative-list">
          <h4>Strengths</h4>
          <ul>
            {person.top_strengths.map((strength) => <li key={strength}>{strength}</li>)}
          </ul>
          <h4>Caveats</h4>
          <ul>
            {person.risks_or_caveats.map((risk) => <li key={risk}>{risk}</li>)}
          </ul>
        </div>
      </section>

      <section className="tile">
        <TileHeader
          color="#7e2bc8"
          title="Quality signals"
          description="Contributor-level summary metrics from the analysis export."
          tooltip={{
            kicker: "Contributor metrics",
            description: "These values summarize the contributor-level scoring inputs exported by the analysis pipeline.",
            rows: [
              { icon: <Gauge size={14} aria-hidden="true" />, label: "Weighted PR quality", value: "Impact-weighted average quality across reviewed PRs" },
              { icon: <BarChart3 size={14} aria-hidden="true" />, label: "Consistency", value: "How reliably the reviewed PR sample cleared the quality threshold" },
              { icon: <CircleUserRound size={14} aria-hidden="true" />, label: "Review leverage", value: "Visible review activity quality where available" },
            ],
          }}
        />
        <div className="tile-body facts">
          <dl>
            <div><dt>Weighted PR quality average</dt><dd>{formatNumber(person.weighted_pr_quality_average)}</dd></div>
            <div><dt>Quality consistency</dt><dd>{pct(person.quality_consistency_percent)}</dd></div>
            <div><dt>Review leverage quality</dt><dd>{pct(person.review_leverage_quality)}</dd></div>
            <div><dt>Ownership signal</dt><dd>{formatNumber(person.ownership_signal)}/5</dd></div>
            <div><dt>Communication average</dt><dd>{formatNumber(person.communication_quality_average)}/5</dd></div>
            <div><dt>PR score range</dt><dd>{formatNumber(person.score_distribution.min)}-{formatNumber(person.score_distribution.max)}</dd></div>
          </dl>
        </div>
      </section>

      <section className="tile tile-wide">
        <TileHeader
          color="#111111"
          title="Reviewed PR evidence"
          description="Representative PRs reviewed in the analysis, with quality score, work type, and summary judgment."
          tooltip={{
            kicker: "PR-level evidence",
            description: "Each row links to a PR that the analysis scored for this contributor.",
            rows: [
              { icon: <ExternalLink size={14} aria-hidden="true" />, label: "Link target", value: "The original GitHub pull request" },
              { icon: <Gauge size={14} aria-hidden="true" />, label: "Quality score", value: "0-100 PR quality score" },
              { icon: <ListFilter size={14} aria-hidden="true" />, label: "Work type", value: "Classification such as reliability, migration, product, performance, infra, bugfix, or DX" },
            ],
          }}
        />
        <div className="tile-body evidence-list">
          {reviews.map((review) => (
            <a className="evidence analysis-evidence" href={review.pr_url} key={review.pr_number} target="_blank" rel="noreferrer">
              <span className="pr">{formatRank(review.pr_number)}</span>
              <span className="evidence-title">{review.pr_title}</span>
              <span className="tag">{review.work_type}</span>
              <span className="score-pill">{formatNumber(review.pr_quality_score)}</span>
              <span className="why">{review.summary_judgment}</span>
            </a>
          ))}
        </div>
      </section>

      <section className="tile">
        <TileHeader
          color="#d64f2a"
          title="Review interactions"
          description="Visible review examples that informed the collaboration and review leverage portions of the analysis."
          tooltip={{
            kicker: "Review evidence",
            description: "Only public GitHub review context is represented here.",
            rows: [
              { icon: <CircleUserRound size={14} aria-hidden="true" />, label: "Interaction", value: "Example review event or inline review comment captured in the analysis" },
              { icon: <Gauge size={14} aria-hidden="true" />, label: "Review quality", value: "Signal strength assigned to that visible interaction" },
              { icon: <Filter size={14} aria-hidden="true" />, label: "Limitation", value: "Private Slack, design, incident, or deleted review context is not included" },
            ],
          }}
        />
        <div className="tile-body review-interactions">
          {person.review_interactions.map((interaction) => (
            <a className="review-card" href={interaction.pr_url} key={`${interaction.pr_number}-${interaction.example}`} target="_blank" rel="noreferrer">
              <b>{formatRank(interaction.pr_number)} {interaction.pr_title}</b>
              <span>{interaction.example}</span>
              <em>{formatNumber(interaction.review_quality_percent)}% review quality signal</em>
            </a>
          ))}
        </div>
      </section>

      <section className="tile">
        <TileHeader
          color="#8f969e"
          title="Area footprint"
          description="Areas represented in this contributor's reviewed PR sample."
          tooltip={{
            kicker: "Reviewed areas",
            description: "Area counts come from the PRs reviewed for this contributor.",
            rows: [
              { icon: <BarChart3 size={14} aria-hidden="true" />, label: "Count", value: "Number of reviewed PRs tagged with each area" },
              { icon: <Filter size={14} aria-hidden="true" />, label: "Scope", value: "This is a sampled reviewed footprint, not all repository work by the contributor" },
            ],
          }}
        />
        <div className="tile-body area-list">
          {areas.map(([area, count]) => (
            <div className="area-row" key={area}>
              <span>{area}</span>
              <div className="area-track"><div style={{ width: `${Math.min(100, count / maxArea * 100)}%` }} /></div>
              <b>{formatNumber(count)}</b>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function RawDataView({ data, table }: { data: AnalysisDashboard; table: RawTable }) {
  return (
    <section className="raw-view">
      {table === "contributors" ? (
        <section className="tile raw-table-tile">
          <TileHeader
            color="#111111"
            title="Contributor quality scores"
            description="Raw contributor summary export."
            tooltip={{
              kicker: "Raw contributor export",
              description: "This table mirrors the contributor-level JSON file used by the dashboard.",
              rows: [
                { icon: <Database size={14} aria-hidden="true" />, label: "Source file", value: "contributor_quality_scores.json" },
                { icon: <CircleUserRound size={14} aria-hidden="true" />, label: "Rows", value: `${formatNumber(data.contributors.length)} contributors` },
                { icon: <Gauge size={14} aria-hidden="true" />, label: "Displayed fields", value: "Final quality, reviewed PR count, review leverage, ownership, and communication" },
              ],
            }}
          />
          <div className="tile-body leaderboard-table">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Contributor</th>
                  <th>Quality</th>
                  <th>PRs</th>
                  <th>Review quality</th>
                  <th>Ownership</th>
                  <th>Communication</th>
                </tr>
              </thead>
              <tbody>
                {data.contributors.map((person, index) => (
                  <tr key={person.contributor}>
                    <td>{formatRank(index + 1)}</td>
                    <td>@{person.contributor}</td>
                    <td>{formatNumber(person.quality_score)}</td>
                    <td>{formatNumber(person.reviewed_pr_count)}</td>
                    <td>{pct(person.review_leverage_quality)}</td>
                    <td>{formatNumber(person.ownership_signal)}/5</td>
                    <td>{formatNumber(person.communication_quality_average)}/5</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {table === "prs" ? (
        <section className="tile raw-table-tile">
          <TileHeader
            color="#2451f5"
            title="Qualitative PR reviews"
            description="PR-level qualitative review rows used to support contributor scoring."
            tooltip={{
              kicker: "Raw PR export",
              description: "This table mirrors the PR-level qualitative review JSON file.",
              rows: [
                { icon: <Database size={14} aria-hidden="true" />, label: "Source file", value: "qualitative_pr_reviews.json" },
                { icon: <ListFilter size={14} aria-hidden="true" />, label: "Rows", value: `${formatNumber(data.reviews.length)} reviewed PRs` },
                { icon: <ExternalLink size={14} aria-hidden="true" />, label: "PR column", value: "Opens the original GitHub pull request for validation" },
              ],
            }}
          />
          <div className="tile-body leaderboard-table">
            <table>
              <thead>
                <tr>
                  <th>PR</th>
                  <th>Contributor</th>
                  <th>Quality</th>
                  <th>Type</th>
                  <th>Merged</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {data.reviews.map((review) => (
                  <tr key={review.pr_number}>
                    <td><a className="table-link" href={review.pr_url} target="_blank" rel="noreferrer">{formatRank(review.pr_number)}</a></td>
                    <td>@{review.contributor}</td>
                    <td>{formatNumber(review.pr_quality_score)}</td>
                    <td>{review.work_type}</td>
                    <td>{formatDateTime(review.merged_at)}</td>
                    <td>{review.summary_judgment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function App() {
  const [data, setData] = useState<AnalysisDashboard | null>(null);
  const [route, setRoute] = useState<RouteState>(() => parseRoute());
  const [sidebarWidth, setSidebarWidth] = useState(252);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/data/analysis/contributor_quality_scores.json").then((response) => response.json() as Promise<ContributorQuality[]>),
      fetch("/data/analysis/qualitative_pr_reviews.json").then((response) => response.json() as Promise<QualitativePr[]>),
      fetch("/data/analysis/quality_assessment_sources.json").then((response) => response.json() as Promise<Record<string, unknown>>),
    ]).then(([contributors, reviews, sources]) => {
      setData({
        contributors,
        reviews,
        sourceCount: Object.keys(sources).length,
        generatedAt: "2026-06-24T00:02:14.898715+00:00",
        cohortStart: "2026-05-24",
        cohortEnd: "2026-06-23",
        repo: "PostHog/posthog",
      });
    });
  }, []);

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) {
      return;
    }

    const onScroll = () => setHeaderScrolled(card.scrollTop > 4);
    onScroll();
    card.addEventListener("scroll", onScroll);
    return () => card.removeEventListener("scroll", onScroll);
  }, []);

  const onResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const onPointerMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(Math.min(360, Math.max(208, startWidth + moveEvent.clientX - startX)));
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const viewOptions: DropdownOption<PageMode>[] = [
    { value: "leaderboard", label: "Leaderboard home", description: "Complete ranking and top-five shortcuts" },
    { value: "contributor", label: "Contributor profile", description: "Individual qualitative score breakdown and evidence" },
    { value: "raw", label: "Raw data", description: "Audit tables for contributor and PR review rows" },
  ];
  const rawTableOptions: DropdownOption<RawTable>[] = [
    { value: "contributors", label: "Contributor scores", description: "Contributor-level quality export" },
    { value: "prs", label: "PR reviews", description: "PR-level qualitative review rows" },
  ];

  const contributors = data?.contributors ?? [];
  const routeContributor = route.contributor?.toLowerCase();
  const routedContributorIndex = routeContributor
    ? contributors.findIndex((person) => person.contributor.toLowerCase() === routeContributor)
    : -1;
  const selected = routedContributorIndex >= 0 ? routedContributorIndex : 0;
  const selectedPerson = contributors[selected] ?? contributors[0];
  const pageMode = route.pageMode;
  const contributorOptions: DropdownOption<number>[] = contributors.map((person, index) => ({
    value: index,
    label: `${formatRank(index + 1)} @${person.contributor}`,
    description: `${formatNumber(person.quality_score)} score - ${formatNumber(person.reviewed_pr_count)} reviewed PRs`,
  }));

  const viewIcon = pageMode === "leaderboard" ? <Trophy /> : pageMode === "contributor" ? <UserRound /> : <Table2 />;
  const contributorLeading = pageMode === "contributor" ? <RankMarker rank={selected + 1} /> : <Plus />;

  const navigate = (url: string, replace = false) => {
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== url) {
      if (replace) {
        window.history.replaceState(null, "", url);
      } else {
        window.history.pushState(null, "", url);
      }
    }
    setRoute(parseRoute());
    cardRef.current?.scrollTo({ top: 0 });
  };

  const navigatePage = (mode: PageMode) => {
    if (mode === "leaderboard") {
      navigate("/");
      return;
    }
    if (mode === "raw") {
      navigate(rawPath(route.rawTable));
      return;
    }
    navigate(contributorPath(selectedPerson?.contributor ?? contributors[0]?.contributor ?? ""));
  };

  const openContributor = (index: number) => {
    const person = contributors[index];
    if (person) {
      navigate(contributorPath(person.contributor));
    }
  };

  useEffect(() => {
    if (!data || route.pageMode !== "contributor" || !route.contributor) {
      return;
    }
    const matchingPerson = data.contributors.find((person) => person.contributor.toLowerCase() === route.contributor?.toLowerCase());
    if (!matchingPerson && data.contributors[0]) {
      navigate(contributorPath(data.contributors[0].contributor), true);
    }
  }, [data, route.pageMode, route.contributor]);

  const headerText = useMemo(() => {
    if (pageMode === "leaderboard") {
      return "Ranked view of the most impactful PostHog engineers, backed by qualitative PR review and source evidence.";
    }
    if (pageMode === "contributor" && selectedPerson) {
      return selectedPerson.executive_summary;
    }
    return "Raw contributor and PR review rows for auditability.";
  }, [pageMode, selectedPerson]);

  if (!data || !selectedPerson) {
    return <main className="loading">Loading analysis...</main>;
  }

  return (
    <div className="app-shell" style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}>
      <button className="mobile-menu-button" type="button" onClick={() => setMobileSidebarOpen(true)} aria-label="Open navigation">
        <Menu size={18} aria-hidden="true" />
      </button>
      {mobileSidebarOpen ? (
        <button className="mobile-sidebar-backdrop" type="button" onClick={() => setMobileSidebarOpen(false)} aria-label="Close navigation" />
      ) : null}
      <Sidebar
        onResizeStart={onResizeStart}
        pageMode={pageMode}
        navigatePage={navigatePage}
        contributors={contributors}
        selectedContributor={pageMode === "contributor" ? selectedPerson.contributor : undefined}
        openContributor={openContributor}
        rawTable={route.rawTable}
        navigateRawTable={(table) => navigate(rawPath(table))}
        mobileOpen={mobileSidebarOpen}
        closeMobileSidebar={() => setMobileSidebarOpen(false)}
      />
      <main className="content-shell">
        <div className="content-card" ref={cardRef}>
          <header className={`dashboard-header ${headerScrolled ? "scrolled" : ""}`}>
            <div className="title-row">
              <div className="title-left">
                <span className="title-icon"><Gauge size={19} aria-hidden="true" /></span>
                <h1>Engineering Impact Dashboard</h1>
              </div>
              <div className="actions">
                <a className="lemon-button" href="/data/analysis/contributor_quality_scores.json" target="_blank" rel="noreferrer">
                  <ExternalLink size={16} aria-hidden="true" />Analysis source
                </a>
                <a className="lemon-button" href="/data/analysis/contributor_quality_scores.json" download>
                  <Download size={16} aria-hidden="true" />Export scores
                </a>
              </div>
            </div>
            {pageMode === "contributor" ? (
              <div className="assessment-overview">
                <span>Assessment overview</span>
                <p>{headerText}</p>
              </div>
            ) : (
              <p>{headerText}</p>
            )}
            <div className="filter-row">
              <DropdownControl
                label="View"
                value={pageMode}
                options={viewOptions}
                onChange={navigatePage}
                leading={viewIcon}
              />
              <DropdownControl
                label="Contributor"
                value={selected}
                options={contributorOptions}
                onChange={openContributor}
                leading={contributorLeading}
                displayValue={pageMode === "contributor" ? `@${selectedPerson.contributor}` : "Contributor"}
              />
              {pageMode === "raw" ? (
                <DropdownControl
                  label="Raw table"
                  value={route.rawTable}
                  options={rawTableOptions}
                  onChange={(table) => navigate(rawPath(table))}
                  leading={<Table2 />}
                />
              ) : null}
              <AnalysisDate data={data} />
            </div>
          </header>
          <div className="header-scroll-sentinel" />
          {pageMode === "leaderboard" ? (
            <LeaderboardHome data={data} openContributor={openContributor} />
          ) : pageMode === "contributor" ? (
            <ContributorProfile data={data} person={selectedPerson} rank={selected + 1} />
          ) : (
            <RawDataView data={data} table={route.rawTable} />
          )}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

