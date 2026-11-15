# TeamWorkt Safety — Safety Pulse MVP
Date: 2026-11-15
Project: RBH Insulation pilot
File changed: `dashboard.html`

## Purpose
Give a small-business supervisor or owner a rapid, read-only snapshot of safety-report activity on the Home dashboard without requiring a separate analytics workflow. This is not a compliance score, incident prediction, or a substitute for investigation or mandatory reporting.

## Home dashboard behavior
Safety Pulse was initially displayed above the action cards, but the final November 15 layout places it **at the bottom of Home**, after the existing Home statistics, **Open My Work**, **Submit a safety report**, **Needs your attention**, and **Recent activity**. This keeps the primary employee and manager actions accessible before the overview.

### Four headline metrics
- **Reports · 30 days:** Number of reports created in the last rolling 30 days. The caption compares this count with the immediately preceding 30 days. The comparison is a *difference in reporting volume* and does not claim safety improved or worsened.
- **Unresolved reports:** Reports with status other than `closed`, `no_action`, or `duplicate`; this uses the dashboard's existing `isResolvedReport` logic.
- **Higher-severity open:** Unresolved reports where `potential_severity` resolves to Critical or Serious. An unspecified severity is not classified.
- **Overdue reports:** Unresolved reports where the dashboard's existing `isOverdue` helper returns true, taking current corrective-action due dates and status into account.

### Context panels
- **Recurring hazard categories · 90 days:** Groups reports in the rolling 90-day window by the exact hazard category and job-site name (case-insensitive matching). Only groups of two or more reports are displayed, with the three most frequent shown. Reports missing a hazard category are not guessed from descriptions. This is a repeated-report signal, not proof of a repeat incident.
- **Latest unresolved reports:** Shows three most recently created unresolved reports with reference number, report type, and current status. No reporter names or personal incident descriptions are shown.

### Navigation
The **View analytics** button opens the existing Safety Analytics page. In the November 15 follow-up, each recurring category/site group became a clickable drill-down into the existing Safety Inbox, with exact category/site matching and report-type and 30/60/90-day controls. Matching resolved records are included so trend counts do not disagree with historical lists; the ordinary Safety Inbox still hides resolved records by default. Use **Clear trend filter** to return to normal Inbox behavior. All filtering is performed on already-authorized in-memory reports.

### Empty states
- If no unresolved reports exist, the list explicitly says so.
- If no category/site combination repeats, the repeat panel says none identified in the last 90 days.
- Metrics show numeric zeros rather than fabricated trend estimates.
- The user only sees reports returned by their existing authenticated Supabase role and organization policies.

## Implementation constraints / safeguards
- Frontend-only: no Supabase migrations, new API calls, RLS changes, roles, notifications, email changes, or modifications to the four-step workflow.
- Reuses existing in-memory `allReports` dataset and existing due-date, severity and resolved-status helpers.
- Category, site, type, status and reference display values are HTML-escaped before inserting into the dashboard.
- Rendered from the existing Home snapshot refresh path, so live report reloads are reflected when Home refreshes.
- Responsive: 4 metric columns on desktop, 2 on mobile; secondary panels stack on narrow phones.

## Testing completed / still required
Completed:
- JavaScript syntax compiled successfully for the updated inline dashboard script before commit.
- Code check confirmed a single Safety Pulse root and live render hook.
- Post-commit source check should confirm the dashboard file contains the expected structure.

Still required on an authenticated RBH account:
- Verify mobile and desktop layout and View Analytics navigation.
- Check counts against current Inbox/Analytics, particularly the last-30-days count and overdue counts.
- Confirm a new report refresh updates the snapshot, and resolved reports no longer appear in the unresolved list.
- Test with no reports / no repeated categories.
- Verify each existing role sees only its current organization-approved data.

## Future refinements (not included)
**Follow-up implementation:** Recurring hazard drill-down by exact site/category, report type, and 30/60/90-day period was committed in dashboard.html (commit 01a376d). No additional API, schema, role or email changes. Still needs browser/mobile acceptance with at least two reports sharing a site/category; there were no such groups in the existing RBH pilot data during this source review. Future: wider analytics drill-down, more refined job-site views, and corrective-action completion rates. Preserve Build 54 for Scheduled Company Records Archive.

## 2026-11-15 follow-up: visible categories and filters
- RBH pilot data had **no repeated category-plus-site pair** in the rolling 90-day window. Many test reports had no hazard category. Earlier UI therefore offered no clickable entries, and its period/type filter was inaccessible.
- `dashboard.html` commit `536123c` now shows up to three actual category/site groups even when a group contains only one report. These are labelled **Hazard categories by site**, not recurring hazards; the no-repeat explanation remains explicit.
- New **Browse all reports with filters** entry point is always available in Safety Pulse, even with no category data. It opens the Safety Inbox with reporting-period (30/60/90-day) and report-type controls. Clicking a specific grouped entry also filters by exact category/site.
- The normal Safety Inbox still defaults to active reports. Drill-down intentionally includes resolved historical reports until cleared.
- JavaScript parse validation and post-commit code presence checks passed. **Authenticated live-browser acceptance and role-based testing remain open.**
