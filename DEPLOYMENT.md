# Housr Analytics – Deployment Guide (v6.0)

## Quick checklist after pasting any file

For each file you paste, verify the **build tag on line 1 or 2**:

| File             | Build marker (must be present) |
|------------------|--------------------------------|
| `Code.gs`        | `/* CODE BUILD v6.0 */`        |
| `Index.html`     | `data-build="v6.0"` on `<body>` |
| `Styles.html`    | `/* STYLES BUILD v6.0 */`      |
| `JavaScript.html`| `/* JS BUILD v6.0 */`          |

If any marker is missing, that file wasn't pasted completely — paste again before deploying.

## How to verify the live deployment

1. Open the web app URL → right-click → **View page source**
2. Press Ctrl+F and search for **`v6.0`** — should find **4 matches**
3. If you find fewer, that file's old version is still being served → re-paste the corresponding file and create a New Deployment Version

## Deployment steps

1. Apps Script editor → **Deploy ▸ Manage deployments**
2. Click ✏️ on your existing deployment
3. **Version**: pick **New version**
4. Click **Deploy**
5. Hard refresh the app (Ctrl+Shift+R or Cmd+Shift+R)

## File requirements

| Apps Script file | Type   | First line(s)                  |
|------------------|--------|--------------------------------|
| `Code.gs`        | Script | `/* CODE BUILD v6.0 */`        |
| `Index.html`     | HTML   | `<!DOCTYPE html>`              |
| `Styles.html`    | HTML   | `<style>`                      |
| `JavaScript.html`| HTML   | `<script>`                     |

⚠️ The HTML files **MUST** wrap their content in proper `<style>...</style>` / `<script>...</script>` tags. If your `JavaScript.html` opens with `/* JS BUILD … */` instead of `<script>`, the browser will treat the JS as plain text and dump it on the page. Same for Styles.html with `<style>`.

## Features in v6.0

- **Sidebar:** Dashboard · Occupancy · Short Stay · LS Sales · Mapping · Debug
- **Branding:** "Housr" gradient logo
- **Theme:** Light / Dark with full-page coverage
- **Filters:** Multi-select dropdowns attached to `<body>` so they always sit above other UI; with search, Select All, Clear
- **Current Month pill:** auto-updates every month
- **Dashboard:** 6 KPI cards (Total Rev, Short Stay Rev, Long Stay Rev, Long Stay Occupancy, Long+Short Occupancy, Total Properties), 2 charts, Bottom-10 pan-India table
- **Occupancy:** Long Stay + Long+Short Occupancy, Under Notice, Vacant Sales Focus, per-city cards, 2 charts, Top-15 leaderboard
- **Short Stay:** Own month picker (current year, defaults to current month) + 6 KPIs (Revenue Collected, ARR, Nights, YTD, FTD=yesterday, NMTD) + 3 pivot tables (Source × City)
- **LS Sales:** Independent filters (Month, Move-In Month, Source, Property) + Sales Value ⇄ Prorated Rent toggle + FTD/MTD/YTD pivot tables + Owner-wise + Beds-by-City chart
- **Mapping page:** Edit metric column letters live; "Reset to Defaults" button
- **Debug page:** Run Diagnose to verify backend reads and parsed rows

## Sheet10-faithful metrics

| Metric              | Formula |
|---------------------|---------|
| Total Beds          | Σ U where I ∉ (Moved out, Token cancelled) |
| Sellable Beds       | Σ U where I ∉ (Moved out, Token cancelled, Not for sale) |
| Beds Occupied       | Σ U where I ∈ (Occupied, Under Notice, Under Notice booked) |
| Beds Vacant         | Σ U where I ∈ (Vacant, Vacant-booked) |
| Under Notice        | Σ U where I ∈ (Under Notice, Under Notice booked) |
| Booked              | Σ U where I ∈ (Under Notice booked, Vacant-booked, Booked) |
| Occupancy %         | Beds Occupied ÷ Sellable Beds |
| Long + Short Occ %  | (Beds Occupied + Σ Dashboard!W) ÷ Sellable Beds |
| Contracted Rent     | Σ Z |
| Revenue (Long Stay) | Σ CB (update column letter monthly from Mapping page) |
| Rent Outstanding    | Contracted Rent − Revenue (LS) |
| GST                 | Σ CC |
| Revenue (Short Stay)| Σ Short Stay!S for selected month |
| Total Revenue       | LS + SS |
| Member Count        | Count rows where I ∈ Occupied bucket |
| Average Tenure      | AVG(Extract!Y) |
| Vacant Sales Focus  | Σ Dashboard!V |

## After first deploy

1. Open the app → **⚙ Mapping → ⟲ Reset to Defaults** (one-time, to seed v6.0 metrics)
2. Click **↻ Refresh Data**
3. Verify all 4 build markers in View Source

## Troubleshooting

| Symptom                                        | Fix |
|------------------------------------------------|-----|
| Page stuck on "Loading…", JS dumps as text     | `JavaScript.html` is missing `<script>...</script>` wrapper — re-paste |
| Page has no styling                            | `Styles.html` is missing `<style>...</style>` wrapper — re-paste |
| Dropdown filters hidden behind KPI cards       | Old `Styles.html` cached — verify `STYLES BUILD v6.0` in source |
| All pages empty except Short Stay              | `MappingConfig` has stale rows — go to Mapping → Reset to Defaults |
| LS Sales tables empty                          | Run Debug → Run Diagnose → check `firstLSSalesRow.date` is non-null |
| Select All / Clear in dropdowns doesn't work   | Old JavaScript.html — verify `JS BUILD v6.0` in source |
| Dark theme leaves white at bottom              | Old Styles.html — verify `STYLES BUILD v6.0` in source |
