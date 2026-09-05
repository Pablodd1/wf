# WatchFacts Admin Platform — Comprehensive UI/UX Assessment
**Date:** 2026-07-01  
**Scope:** `src/pages/`, `src/components/` (React + Vite + Tailwind + shadcn/ui)  
**Primary User:** Admin / Owner  
**Dataset Scale:** 2.39M records  

---

## Executive Summary

The WatchFacts admin platform has a strong visual identity (dark luxury theme, gold accents) and functional depth, but suffers from **information architecture debt** (15→7 page consolidation incomplete), **navigation overload**, **inconsistent interaction patterns**, and **accessibility gaps**. The admin experience is fragmented across multiple pages with overlapping purposes, creating cognitive load for the primary user who needs full data control.

---

## 1. Information Architecture (IA)

### 1.1 Navigation Overload & Confusing Labels
**Severity: P0**

**Issue:** `TabNav.tsx` (lines 9-202) shows **11 tabs** in a horizontal scrollable bar. Labels are ambiguous:
- "Clean" → "Manual Analysis" (unclear difference from "Review")
- "Reprocess" → "78k records" (technical jargon, not a user goal)
- "Parsing" → "Engine Demo" (sounds like a developer tool, not admin feature)
- "Study" → "Step-by-Step" (vague purpose)
- "Prices" / "Demand" / "Insight" — three separate research pages that could be consolidated

**Code Ref:** `src/components/TabNav.tsx:9-202`

**Impact:** Admin must scroll horizontally to see all options. Tab labels use internal terminology ("Parsing", "Reprocess") rather than user-centric language ("Data Quality", "Re-run Pipeline").

**Fix:**
```tsx
// Consolidate into 5 primary tabs + overflow menu
const primaryTabs = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/review", label: "Review Queue", icon: Eye, badge: humanCount },
  { to: "/clean", label: "Analyze & Fix", icon: Sparkles }, // renamed from "Clean"
  { to: "/reprocess", label: "Re-run Pipeline", icon: RefreshCw }, // renamed
  { to: "/analytics", label: "Reports", icon: BarChart3 }, // consolidate Prices/Demand/Insight here
];
```

### 1.2 Orphaned / Duplicate Pages Still in Codebase
**Severity: P0**

**Issue:** App.tsx (lines 16-35) registers routes for pages that were supposedly consolidated:
- `/analytics` AND `/analytics-dashboard` → two analytics pages
- `/review` AND `/review-queue` → two review pages
- `/demo` AND `/demo-mode` → duplicate demo pages
- `/admin/data` referenced in footer but routes to login

**Code Ref:** `src/App.tsx:16-35`, `src/pages/AnalyticsPage.tsx`, `src/pages/AnalyticsDashboard.tsx`

**Impact:** Dead code increases bundle size, creates confusion about which page is canonical, and broken routes (`/admin/data`) show login instead of data browser.

**Fix:**
1. Remove duplicate routes from `App.tsx`
2. Delete or archive: `AnalyticsPage.tsx`, `ReviewQueue.tsx`, `DemoMode.tsx`
3. Fix `/admin/data` route — currently redirects to login page instead of data browser

### 1.3 Missing "Unified Reports" Integration
**Severity: P1**

**Issue:** The context mentions a "UnifiedReports" page with verdict tabs, but `App.tsx` has no `/reports` or `/unified-reports` route. The `UnifiedReports.tsx` file (lines 1-15) is essentially empty — just a redirect stub.

**Code Ref:** `src/pages/UnifiedReports.tsx:1-15`

**Fix:** Implement the consolidated reports page as the primary analytics destination, with sub-tabs for:
- Verdict breakdown (Approved / Review / Human / Recycle / Trash)
- Price Research
- Demand Signals
- Data Quality Audit

### 1.4 Inconsistent Page Shell Patterns
**Severity: P1**

**Issue:** Some pages use `<Layout>` + `<TabNav>` (AdminPage, ReviewPage, CleanPage), while others use custom navbars (InsightDetails has its own `NavBar()` function at line 496). The public-facing pages (Home, Trading) use a completely different white-themed header.

**Code Ref:** `src/pages/InsightDetails.tsx:496-517`, `src/pages/Home.tsx`

**Impact:** Admin loses context when switching between tools. The "Dealer Login" nav on public pages doesn't indicate admin access.

**Fix:** Create a single `AdminLayout` component that wraps all admin pages with consistent:
- Dark theme navbar with stats
- Tab navigation
- Breadcrumb or page title

---

## 2. Visual Design

### 2.1 Color Token Inconsistency
**Severity: P1**

**Issue:** Multiple color systems coexist:
- Tailwind custom colors: `text-emerald-400`, `text-amber-400`, `text-red-400` (CleanPage, AdminPage)
- CSS variables: `--success: #22C55E`, `--warning: #F59E0B`, `--danger: #EF4444` (index.css)
- Hardcoded hex values: `#198754`, `#dc3545` (InsightDetails.tsx lines 13-14)
- Bootstrap-style colors: `text-info`, `text-warning` (DetailModal.tsx)

**Code Ref:** `src/pages/InsightDetails.tsx:13-14`, `src/pages/CleanPage.tsx:24-27`, `src/index.css:42-47`

**Impact:** Same semantic meaning (e.g., "success") renders differently across pages. The green for "Approved" is `#22C55E` in one place, `#198754` in another.

**Fix:** Enforce exclusive use of Tailwind custom colors or CSS variables. Create a `VerdictColors` constant:
```ts
export const VERDICT_COLORS = {
  APPROVED:  { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', dot: '#22C55E' },
  HUMAN:     { bg: 'bg-amber-500/10',  text: 'text-amber-400',  border: 'border-amber-500/30',  dot: '#F59E0B' },
  REVIEW:    { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/30', dot: '#EAB308' },
  RECYCLE:   { bg: 'bg-red-500/10',    text: 'text-red-400',    border: 'border-red-500/30',    dot: '#EF4444' },
  TRASH:     { bg: 'bg-gray-500/10',   text: 'text-gray-400',   border: 'border-gray-500/30',   dot: '#6B7280' },
} as const;
```

### 2.2 Typography Scale Issues
**Severity: P1**

**Issue:** Font sizes are extremely small across admin pages:
- Tab labels: `text-xs` (12px) with `tracking-wider`
- Stats labels: `text-[10px]` (10px)
- Table headers: `text-[10px]` (EnhancedResidue.tsx line 211)
- Action buttons: `text-[10px]` to `text-xs`

**Code Ref:** `src/components/TabNav.tsx:16`, `src/sections/EnhancedResidue.tsx:211`

**Impact:** At 10px, text fails WCAG 2.1 minimum size recommendations (12px equivalent for readability). On high-DPI screens this is barely legible.

**Fix:** Establish a minimum 12px (`text-xs`) for all functional text, 14px (`text-sm`) for primary labels. Use `text-xs` only for metadata (timestamps, secondary info).

### 2.3 Spacing Inconsistency
**Severity: P2**

**Issue:** Padding and gap values vary arbitrarily:
- Cards: `p-4` (16px) in AdminPage, `p-3` (12px) in StatsBar
- Grid gaps: `gap-3` (12px) in AdminPage stats, `gap-2` (8px) in ReprocessPage
- Section margins: `mb-8` (32px) in some places, `mb-6` (24px) in others

**Code Ref:** `src/pages/AdminPage.tsx:239`, `src/pages/ReprocessPage.tsx:187`

**Fix:** Define standard spacing tokens in Tailwind config and use consistently:
```js
spacing: {
  'section': '2rem',    // 32px between sections
  'card': '1rem',       // 16px inside cards
  'element': '0.75rem', // 12px between related elements
}
```

### 2.4 Confidence Tier Badges Need Visual Hierarchy
**Severity: P1**

**Issue:** Confidence is displayed inconsistently:
- `ConfidenceRing` component (svg circle, 36px) in WatchCard
- `text-[11px] font-mono` percentage in EnhancedResidue table
- Raw percentage with emoji labels in InsightDetails (line 305-306): `score === 100 ? '✓ VERIFIED' : score >= 90 ? '🔍 REVIEW'`

**Code Ref:** `src/components/ui/ConfidenceRing.tsx`, `src/pages/InsightDetails.tsx:305-306`

**Impact:** No unified confidence language. The emoji labels look unprofessional for an admin tool.

**Fix:** Standardize on 4 confidence tiers with consistent badges:
```tsx
function ConfidenceBadge({ score }: { score: number }) {
  if (score === 100) return <Badge variant="verified">100% Verified</Badge>;
  if (score >= 90)  return <Badge variant="review">{score}% Review</Badge>;
  if (score >= 80)  return <Badge variant="check">{score}% Check</Badge>;
  return <Badge variant="flagged">{score}% Flagged</Badge>;
}
```

---

## 3. Usability Issues

### 3.1 Hidden 1-Year Date Filter
**Severity: P0**

**Issue:** The context states "1-year date filter applied but not visible in UI." In `InsightDetails.tsx` (line 111), the date range is hardcoded:
```tsx
dateRange: 'Jun 24 — Dec 21',
```

**Code Ref:** `src/pages/InsightDetails.tsx:111`

**Impact:** Admin cannot see or modify the date filter. The displayed range "Jun 24 — Dec 21" is ambiguous (which year?) and doesn't match a 1-year window.

**Fix:** Add an explicit date range picker to the Insight Details header:
```tsx
<div className="flex items-center gap-2">
  <span className="text-xs text-text-muted">Date Range:</span>
  <select value={dateRange} onChange={e => setDateRange(e.target.value)}>
    <option value="1y">Last 1 Year</option>
    <option value="6m">Last 6 Months</option>
    <option value="3m">Last 3 Months</option>
    <option value="custom">Custom...</option>
  </select>
  <span className="text-xs text-text-secondary">{dateRangeStart} — {dateRangeEnd}</span>
</div>
```

### 3.2 No Loading State for 18MB Data Fetch
**Severity: P0**

**Issue:** `useWatchData.ts` (lines 188-234) fetches an 18MB `parsedWatches.json`. While there's a module-level cache, the initial load shows "Loading records..." text only. No progress indicator for the multi-second download.

**Code Ref:** `src/hooks/useWatchData.ts:188-234`, `src/pages/ReviewPage.tsx:331-338`

**Impact:** On slow connections, admin may think the page is broken. The `console.time('loadWatchData')` is developer-only.

**Fix:** Add a progress indicator:
```tsx
// In useWatchData.ts
const [progress, setProgress] = useState(0);
// Use ReadableStream to track download progress
const reader = res.body?.getReader();
let received = 0;
while (true) {
  const { done, value } = await reader!.read();
  if (done) break;
  received += value.length;
  setProgress(Math.round((received / contentLength) * 100));
}
```

### 3.3 Missing Feedback on Bulk Actions
**Severity: P1**

**Issue:** In `AdminPage.tsx` (lines 152-169), bulk actions show a simple text message that auto-dismisses. No toast notification system. The `message` state is just a string rendered in a banner.

**Code Ref:** `src/pages/AdminPage.tsx:248-255`

**Impact:** If admin navigates away during a long-running reprocess, they lose the feedback. Error messages are plain text without retry options.

**Fix:** Implement a toast/notification system:
```tsx
// Add react-hot-toast or similar
toast.promise(runBulkAction('reprocess'), {
  loading: 'Re-processing 78k records...',
  success: 'Re-process complete! 12,400 approved',
  error: (err) => `Failed: ${err.message}`,
});
```

### 3.4 Edit Modal — Confusing "Save & Re-run" vs "Save"
**Severity: P1**

**Issue:** `DetailModal.tsx` has "Save & Re-run" button (line 405) but the `handleSaveLocal` callback (line 145-150) only calls `onEdit(updated)` — it doesn't actually trigger a pipeline re-run. The `EditModal.tsx` also has "Save & Re-run Pipeline" (line 341) with the same issue.

**Code Ref:** `src/components/DetailModal.tsx:145-150`, `src/components/EditModal.tsx:83-91`

**Impact:** Button label promises re-run that doesn't happen. Admin expects the record to be re-processed after editing.

**Fix:** Either:
1. Rename button to "Save Changes" and add a separate "Re-run Pipeline" action, OR
2. Actually trigger re-run via API after save:
```tsx
const handleSaveAndRerun = async () => {
  await onEdit(updated);
  await fetch('/api/reprocess', { method: 'POST', body: JSON.stringify({ ids: [record.id] }) });
  toast.success('Saved and re-processed');
};
```

### 3.5 Keyboard Shortcuts Not Discoverable
**Severity: P2**

**Issue:** `ReviewPage.tsx` (lines 133-199) has keyboard shortcuts (N/P/E/A/R/S) but they're only discoverable via the `?` or `H` key. No visual indicator.

**Code Ref:** `src/pages/ReviewPage.tsx:133-199`

**Fix:** Add a persistent keyboard hint bar at the bottom of the review page:
```tsx
<div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-bg-card border border-border-default rounded-full px-4 py-2 flex items-center gap-4 text-[10px] text-text-muted">
  <span><kbd className="px-1 rounded bg-bg-elevated">N</kbd> Next</span>
  <span><kbd className="px-1 rounded bg-bg-elevated">P</kbd> Prev</span>
  <span><kbd className="px-1 rounded bg-bg-elevated">E</kbd> Edit</span>
  <span><kbd className="px-1 rounded bg-bg-elevated">A</kbd> Approve</span>
  <span><kbd className="px-1 rounded bg-bg-elevated">?</kbd> Help</span>
</div>
```

---

## 4. Mobile Responsiveness

### 4.1 Horizontal Scroll on Tables
**Severity: P0**

**Issue:** `EnhancedResidue.tsx` (line 210-220) uses a fixed grid layout:
```tsx
<div className="grid grid-cols-[60px_100px_80px_100px_80px_100px_180px] gap-2 ... min-w-[700px]">
```

**Code Ref:** `src/sections/EnhancedResidue.tsx:210-220`

**Impact:** On mobile (< 700px), the table requires horizontal scrolling. The `mobile-table-scroll` utility class is applied, but the column headers don't stick, making it hard to track which column is which.

**Fix:** Convert to a card-based layout on mobile (< md breakpoint):
```tsx
{/* Desktop: table */}
<div className="hidden md:block">...</div>

{/* Mobile: cards */}
<div className="md:hidden space-y-3">
  {sorted.map(record => (
    <div key={record.id} className="bg-bg-card border border-border-default rounded-lg p-3">
      <div className="flex justify-between">
        <span className="font-mono text-xs">{record.reference || 'N/A'}</span>
        <span className={`text-xs font-bold ${severityColor}`}>{record.severity}</span>
      </div>
      {/* Expandable details */}
    </div>
  ))}
</div>
```

### 4.2 TabNav Horizontal Scroll Without Visual Cue
**Severity: P1**

**Issue:** `TabNav.tsx` uses `overflow-x-auto hide-scrollbar` (line 10). On mobile, there's no visual indication that more tabs exist off-screen.

**Code Ref:** `src/components/TabNav.tsx:10`

**Fix:** Add scroll indicators or convert to a dropdown on mobile:
```tsx
// Mobile: hamburger menu with sections
const [menuOpen, setMenuOpen] = useState(false);
<div className="md:hidden">
  <button onClick={() => setMenuOpen(!menuOpen)}><Menu size={20} /></button>
  {menuOpen && <div className="absolute top-14 left-0 right-0 bg-bg-card border-b">{tabs}</div>}
</div>
```

### 4.3 StatsBar Cramped on Small Screens
**Severity: P1**

**Issue:** `StatsBar.tsx` (lines 68-102) shows 4 stat cards in a flex row. On mobile, each card gets ~25% width, making text unreadable.

**Code Ref:** `src/components/StatsBar.tsx:68-102`

**Fix:** Stack vertically on mobile:
```tsx
<div className="flex flex-col md:flex-row gap-3 h-full">
  {stats.map((stat, i) => (
    <motion.div className="flex-1 ..." key={stat.label}>...</motion.div>
  ))}
</div>
```

### 4.4 AdminPage Grid Collapses Poorly
**Severity: P2**

**Issue:** `AdminPage.tsx` (line 239) uses `grid-cols-2 md:grid-cols-4 lg:grid-cols-5` for stats. On very small screens, 2 columns with long numbers cause overflow.

**Code Ref:** `src/pages/AdminPage.tsx:239`

**Fix:** Use `grid-cols-1 sm:grid-cols-2 lg:grid-cols-5` and ensure `value` text wraps or scales.

---

## 5. Accessibility Issues

### 5.1 Insufficient Color Contrast
**Severity: P0**

**Issue:** Multiple contrast failures:
- `text-text-muted` (#6B7280) on `bg-bg-card` (#111118): ratio ~3.8:1 (fails WCAG AA for small text)
- `text-[10px]` labels throughout: small text needs 4.5:1 ratio
- Gold primary (#C9A96E) on white: used in InsightDetails header (line 174) — ratio ~2.9:1

**Code Ref:** `src/index.css:29-41`, `src/pages/InsightDetails.tsx:174`

**Fix:**
- Darken `text-muted` to `#9CA3AF` (already used for `text-secondary`, which passes)
- Ensure all `text-[10px]` uses at least `#9CA3AF` on dark backgrounds
- On light backgrounds (InsightDetails), use dark navy text for gold elements

### 5.2 Missing ARIA Labels on Interactive Elements
**Severity: P1**

**Issue:**
- `TabNav.tsx` links have no `aria-current` for active state
- `EnhancedResidue.tsx` action buttons (Approve, Edit, Delete) have `title` attributes but no `aria-label`
- Sort buttons in EnhancedResidue have no `aria-sort` attribute
- The `×` close button in InsightDetails (line 395) has no `aria-label`

**Code Ref:** `src/components/TabNav.tsx:12-28`, `src/sections/EnhancedResidue.tsx:290-316`

**Fix:**
```tsx
// TabNav
<NavLink to="/admin" aria-current={isActive ? 'page' : undefined}>...</NavLink>

// EnhancedResidue actions
<button aria-label={`Approve record ${record.id}`} title="Approve & Publish">...</button>
<button aria-label={`Edit record ${record.id}`} title="Edit & Re-run">...</button>

// Sort headers
<button aria-sort={sortKey === 'id' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
```

### 5.3 Modal Focus Trap Missing
**Severity: P1**

**Issue:** `DetailModal.tsx` and `EditModal.tsx` handle Escape key (line 113-118) but don't trap focus within the modal. Tabbing can move focus to background elements.

**Code Ref:** `src/components/DetailModal.tsx:113-118`

**Fix:** Use a focus trap hook:
```tsx
import { useFocusTrap } from '@mantine/hooks';
// or implement manually
const trapRef = useFocusTrap(open);
<motion.div ref={trapRef}>...</motion.div>
```

### 5.4 Images Lack Alt Text
**Severity: P2**

**Issue:** Watch images in `WatchCard.tsx` (line 47-62) use `alt={record.reference}` which is often empty. The fallback SVG has no accessible text.

**Code Ref:** `src/components/WatchCard.tsx:47-62`

**Fix:**
```tsx
<img
  src={record.imageUrl}
  alt={record.reference ? `${record.brand} ${record.reference}` : 'Watch image'}
  loading="lazy"
/>
```

### 5.5 Form Inputs Lack Associated Labels
**Severity: P1**

**Issue:** In `InsightDetails.tsx` (lines 198-212), the search input has no `<label>` element — only a placeholder. Screen readers won't announce the field purpose.

**Code Ref:** `src/pages/InsightDetails.tsx:198-212`

**Fix:**
```tsx
<label htmlFor="ref-search" className="sr-only">Reference Number</label>
<input id="ref-search" type="text" placeholder="Enter reference..." />
```

---

## 6. Specific Actionable Recommendations

### P0 (Critical — Fix Immediately)

| # | Issue | File | Fix |
|---|-------|------|-----|
| 1 | Remove duplicate/orphaned routes | `App.tsx` | Delete `AnalyticsPage`, `ReviewQueue`, `DemoMode` routes; fix `/admin/data` |
| 2 | Consolidate TabNav to 5 items | `TabNav.tsx` | Merge Prices/Demand/Insight into Reports; rename technical labels |
| 3 | Add visible date filter to InsightDetails | `InsightDetails.tsx` | Add date range picker with explicit "Last 1 Year" label |
| 4 | Fix mobile table layout | `EnhancedResidue.tsx` | Card-based layout for < md screens |
| 5 | Improve contrast for text-muted | `index.css` | Change `--text-muted` to `#9CA3AF` or darker |
| 6 | Add loading progress for 18MB fetch | `useWatchData.ts` | Implement ReadableStream progress tracking |

### P1 (High — Fix This Sprint)

| # | Issue | File | Fix |
|---|-------|------|-----|
| 7 | Standardize verdict colors | All pages | Create `VERDICT_COLORS` constant and replace all ad-hoc colors |
| 8 | Increase minimum font size to 12px | All components | Replace `text-[10px]` functional text with `text-xs` |
| 9 | Fix "Save & Re-run" button | `DetailModal.tsx`, `EditModal.tsx` | Either rename or implement actual re-run |
| 10 | Add ARIA labels to all interactive elements | `TabNav.tsx`, `EnhancedResidue.tsx` | Add `aria-label`, `aria-current`, `aria-sort` |
| 11 | Implement focus trap in modals | `DetailModal.tsx`, `EditModal.tsx` | Use `useFocusTrap` or manual implementation |
| 12 | Add toast notifications | `AdminPage.tsx` | Integrate `react-hot-toast` or `sonner` |
| 13 | Create unified `AdminLayout` | New file | Wrap all admin pages with consistent shell |
| 14 | Add mobile menu for TabNav | `TabNav.tsx` | Hamburger dropdown for < md screens |

### P2 (Medium — Fix Next Sprint)

| # | Issue | File | Fix |
|---|-------|------|-----|
| 15 | Standardize spacing tokens | `tailwind.config.js` | Add `section`, `card`, `element` spacing utilities |
| 16 | Add keyboard shortcut hints | `ReviewPage.tsx` | Persistent bottom bar with shortcut keys |
| 17 | Improve image alt text | `WatchCard.tsx`, `InsightDetails.tsx` | Descriptive alt with brand + reference |
| 18 | Add form labels | `InsightDetails.tsx`, `EditModal.tsx` | Associate `<label>` with every input |
| 19 | StatsBar mobile stacking | `StatsBar.tsx` | `flex-col` on mobile |
| 20 | AdminPage grid responsiveness | `AdminPage.tsx` | `grid-cols-1 sm:grid-cols-2` for stats |

---

## Appendix: File Inventory

### Pages (`src/pages/`)
| File | Lines | Status | Notes |
|------|-------|--------|-------|
| `AdminPage.tsx` | 449 | Active | Owner dashboard, needs layout consolidation |
| `ReviewPage.tsx` | 809 | Active | Human review mode, keyboard shortcuts |
| `CleanPage.tsx` | 308 | Active | Manual analysis, good UX pattern |
| `ReprocessPage.tsx` | 341 | Active | Pipeline re-run, good progress indicators |
| `InsightDetails.tsx` | 517 | Active | Light theme outlier, needs dark mode |
| `PriceResearch.tsx` | ~29000 | Active | Large file, likely needs splitting |
| `DemandSignals.tsx` | ~16000 | Active | Likely overlaps with analytics |
| `AnalyticsDashboard.tsx` | ~17500 | Active | Consolidate with AnalyticsPage |
| `AnalyticsPage.tsx` | ~2000 | **Orphan** | Remove — duplicate of AnalyticsDashboard |
| `ReviewQueue.tsx` | ~14000 | **Orphan** | Remove — duplicate of ReviewPage |
| `DemoPage.tsx` | ~22500 | Active | Parsing demo |
| `DemoMode.tsx` | ? | **Orphan** | Remove — duplicate of DemoPage |
| `Home.tsx` | ~12000 | Active | Public landing page |
| `UnifiedReports.tsx` | 15 | Stub | Empty redirect — implement or remove |

### Components (`src/components/`)
| File | Lines | Role |
|------|-------|------|
| `Navbar.tsx` | 126 | Admin header with stats |
| `TabNav.tsx` | 202 | Horizontal tab navigation — overloaded |
| `Layout.tsx` | 33 | Simple wrapper — needs expansion |
| `StatsBar.tsx` | 104 | Sticky stats bar |
| `WatchCard.tsx` | 192 | Card component — good pattern |
| `DetailModal.tsx` | 443 | Full record view with inline edit |
| `EditModal.tsx` | 349 | Separate edit modal — merge with DetailModal? |
| `FloatingNav.tsx` | ~100 | Unused? |
| `WorkflowSidebar.tsx` | ~200 | Unused? |

---

*Assessment conducted by code review of `/home/jasme/watchfacts-poc/src/` and live site analysis of `https://watchfacts-poc.vercel.app`.*
