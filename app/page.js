export default function Dashboard() {
  return (
    <>
      <div className="app">

  <aside className="sidebar" id="sidebar">
    <div className="brand">
      <div className="logo">H</div>
      <div>
        <div className="brand-title">Housr</div>
        <div className="brand-sub">Analytics Suite</div>
      </div>
    </div>

    <nav className="nav">
      <a href="#" className="nav-item active" data-page="dashboard"><span>🏠</span> Dashboard<kbd>1</kbd></a>
      <a href="#" className="nav-item" data-page="occupancy"><span>🛏️</span> Occupancy<kbd>2</kbd></a>
      <a href="#" className="nav-item" data-page="shortstay"><span>🏨</span> Short Stay<kbd>3</kbd></a>
      <a href="#" className="nav-item" data-page="lssales"><span>💼</span> LS Sales<kbd>4</kbd></a>
      <a href="#" className="nav-item" data-page="properties"><span>🏢</span> Property View<kbd>5</kbd></a>
      <a href="#" className="nav-item" data-page="mapping"><span>⚙️</span> Mapping</a>
      <a href="#" className="nav-item" data-page="audit"><span>📋</span> Audit Log</a>
      <a href="#" className="nav-item" data-page="debug"><span>🔧</span> Debug</a>
    </nav>

    <div className="sidebar-footer">
      <div className="user-pill" id="userPill"></div>
      <div className="shortcut-hint">Press <kbd>?</kbd> for shortcuts</div>
      <button className="btn btn-ghost" id="themeToggle">🌓 Toggle Theme</button>
      <button className="btn btn-primary" id="refreshBtn">↻ Refresh Data</button>
    </div>
  </aside>

  <main className="main">
    <header className="topbar">
      <button className="icon-btn" id="menuBtn">☰</button>
      <div className="page-title-wrap">
        <span className="page-title" id="pageTitle">Dashboard Overview</span>
        <span className="pill" id="currentMonthPill">Loading…</span>
      </div>
      <div className="topbar-right">
        <span className="muted" id="lastUpdated">Loading…</span>
      </div>
    </header>

    <div id="errorBanner" className="error-banner hidden"></div>

    <section className="filters card" id="filterBar">
      <div className="filter"><label>City</label><div className="ms" data-filter="city" data-placeholder="All Cities"></div></div>
      <div className="filter"><label>Property</label><div className="ms" data-filter="property" data-placeholder="All Properties"></div></div>
      <div className="filter"><label>Property Type</label><div className="ms" data-filter="ptype" data-placeholder="All Types"></div></div>
      <div className="filter"><label>Occupancy Type</label><div className="ms" data-filter="occ" data-placeholder="All Occupancy"></div></div>
      <div className="filter filter-actions"><button className="btn btn-ghost" id="clearFilters">Clear All</button></div>
    </section>

    <div id="activeFilterChips" className="active-filter-chips hidden"></div>

    
    <section className="page" id="page-dashboard">

      
      <div className="hero-card" id="heroDashboard">
        <div>
          <div className="hero-label">Total Revenue</div>
          <div className="hero-value" id="heroTotalRev">—</div>
          <div className="hero-sub" id="heroTotalSub"></div>
        </div>
        <div className="hero-secondary">
          <div className="hero-label">Long Stay</div>
          <div className="hero-value" id="heroLSRev">—</div>
          <div className="hero-sub" id="heroLSSub"></div>
        </div>
        <div className="hero-secondary">
          <div className="hero-label">Short Stay</div>
          <div className="hero-value" id="heroSSRev">—</div>
          <div className="hero-sub" id="heroSSSub"></div>
        </div>
        <div className="hero-secondary">
          <div className="hero-label">Properties</div>
          <div className="hero-value" id="heroProps">—</div>
          <div className="hero-sub" id="heroPropsSub"></div>
        </div>
      </div>

      
      <div className="bento">
        <div className="kpi cell-4 purple">
          <div className="kpi-label">Long Stay Occupancy</div>
          <div className="kpi-value" id="kpiLSOcc">—</div>
          <div className="kpi-sub" id="kpiLSOccSub"></div>
        </div>
        <div className="kpi cell-4 cyan">
          <div className="kpi-label">Long + Short Occupancy</div>
          <div className="kpi-value" id="kpiBlendedOcc">—</div>
          <div className="kpi-sub" id="kpiBlendedOccSub"></div>
        </div>
        <div className="kpi cell-4 amber">
          <div className="kpi-label">Avg Tenure</div>
          <div className="kpi-value" id="kpiAvgTenure">—</div>
          <div className="kpi-sub" id="kpiAvgTenureSub"></div>
        </div>
      </div>

      
      <div className="bento">
        <div className="card cell-8">
          <div className="card-head"><h3>Revenue by City</h3><span className="muted">Long Stay + Short Stay (current month)</span></div>
          <div className="chart-wrap"><canvas id="chartRevCity"></canvas></div>
        </div>
        <div className="card cell-4">
          <div className="card-head"><h3>Beds Occupied by City</h3></div>
          <div className="chart-wrap"><canvas id="chartBedsCity"></canvas></div>
        </div>
      </div>

      
      <div className="card">
        <div className="card-head">
          <h3>Target vs Achieved by City</h3>
          <span className="muted">Dashboard!X (Target) vs Dashboard!AC (Achieved) • current month</span>
        </div>
        <div className="chart-wrap" style={{height: '380px'}}><canvas id="chartTargetAchieved"></canvas></div>
      </div>

      
      <div className="card">
        <div className="card-head">
          <h3>Bottom 10 Properties by Occupancy %</h3>
          <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
            <span className="muted">Pan-India • not affected by filters</span>
            <button className="btn btn-ghost btn-sm" data-export="#bottom10Table" data-filename="bottom10-properties.csv">⬇ CSV</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table" id="bottom10Table">
            <thead><tr><th>#</th><th>Property</th><th>City</th><th>Type</th><th className="num">Sellable</th><th className="num">Occupied</th><th className="num">Short Occupied</th><th className="num">Occ %</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </section>

    
    <section className="page hidden" id="page-occupancy">
      <div className="kpi-grid" id="kpiOccupancy"></div>
      <div className="grid-2">
        
        <div className="card"><div className="card-head"><h3>Vacant Beds by City</h3><span className="muted">Share of total vacant</span></div><div className="chart-wrap-pie"><canvas id="chartVacantCity"></canvas></div></div>
        
        <div className="card"><div className="card-head"><h3>Coliving vs Homes</h3><span className="muted">Sellable beds share</span></div><div className="chart-wrap-pie"><canvas id="chartColHomes"></canvas></div></div>
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Top 15 Properties by Occupancy %</h3>
          <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
            <span className="muted">Leaderboard (min 3 sellable beds) • includes Short Occupied</span>
            <button className="btn btn-ghost btn-sm" data-export="#top15Table" data-filename="top15-properties.csv">⬇ CSV</button>
          </div>
        </div>
        <div className="table-wrap">
          
          <table className="data-table" id="top15Table">
            <thead><tr><th>#</th><th>Property</th><th>City</th><th>Type</th><th className="num">Sellable</th><th className="num">Occupied</th><th className="num">Short Occupied</th><th className="num">Occ %</th><th>Trend</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </section>

    
    <section className="page hidden" id="page-shortstay">
      <section className="filters card">
        <div className="filter" style={{gridColumn: 'span 4'}}>
          <label>Months (multi-select)</label>
          <div className="ms" data-filter="ssMonths" data-placeholder="Default = current month"></div>
        </div>
      </section>

      <div className="kpi-grid kpi-6" id="kpiShortStay"></div>
      <div className="card"><div className="card-head"><h3>FTD — Source × City</h3><span className="muted" id="ftdSub"></span></div><div className="table-wrap" id="ftdTableWrap"></div></div>
      <div className="card"><div className="card-head"><h3>MTD — Source × City</h3><span className="muted" id="mtdSub"></span></div><div className="table-wrap" id="mtdTableWrap"></div></div>
      <div className="card"><div className="card-head"><h3>YTD — Source × City</h3><span className="muted" id="ytdSub"></span></div><div className="table-wrap" id="ytdTableWrap"></div></div>
    </section>

    
    <section className="page hidden" id="page-lssales">
      <section className="filters-ls">
        <div className="filter"><label>Month of Sale</label><div className="ms" data-filter="lsMonth" data-placeholder="All Months"></div></div>
        <div className="filter"><label>City</label><div className="ms" data-filter="lsCity" data-placeholder="All Cities"></div></div>
        <div className="filter"><label>Source</label><div className="ms" data-filter="lsSource" data-placeholder="All Sources"></div></div>
        <div className="filter"><label>Property</label><div className="ms" data-filter="lsProperty" data-placeholder="All Properties"></div></div>
        <div className="filter-actions">
          <div className="toggle-group" id="lsMetricToggle">
            <button data-m="value" className="active">Sales Value</button>
            <button data-m="prorated">Prorated Rent</button>
          </div>
        </div>
      </section>

      <div className="kpi-grid" id="kpiLSSales"></div>
      <div className="card"><div className="card-head"><h3>FTD — Source × City</h3><span className="muted" id="lsFtdSub"></span></div><div className="table-wrap" id="lsFtdTableWrap"></div></div>
      <div className="card"><div className="card-head"><h3>MTD — Source × City</h3><span className="muted" id="lsMtdSub"></span></div><div className="table-wrap" id="lsMtdTableWrap"></div></div>
      <div className="card"><div className="card-head"><h3>YTD — Source × City</h3><span className="muted" id="lsYtdSub"></span></div><div className="table-wrap" id="lsYtdTableWrap"></div></div>
      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3>Owner-wise Sales</h3>
            <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
              <span className="muted" id="ownerSub"></span>
              <button className="btn btn-ghost btn-sm" data-export="#ownerTable" data-filename="owner-sales.csv">⬇ CSV</button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table" id="ownerTable">
              <thead><tr><th>#</th><th>Owner</th><th className="num">Beds Sold</th><th className="num">Sales Value</th><th className="num">Prorated Rent</th><th>Share</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
        
        <div className="card"><div className="card-head"><h3>Beds Sold by City</h3><span className="muted">Share of MTD beds sold</span></div><div className="chart-wrap-pie"><canvas id="chartLsBedsCity"></canvas></div></div>
      </div>
    </section>
    
    
    <section className="page hidden" id="page-properties">
      <div className="prop-header-card card">
        <div className="prop-header-left">
          <label htmlFor="propAircraftSelect">Select Property</label>
          <select id="propAircraftSelect" className="btn btn-ghost">
            <option value="">Loading properties...</option>
          </select>
          <span id="propSummaryTotals" className="prop-totals"></span>
        </div>
        <div id="propStatusCounts" className="prop-badges">
          
        </div>
      </div>
      <div className="card full-width" style={{padding: '24px', minHeight: '400px', marginTop: '16px'}}>
        <div className="aircraft-grid" id="aircraftGrid">
          <div className="muted" style={{textAlign: 'center', padding: '40px'}}>Select a property to view its room layout.</div>
        </div>
      </div>
    </section>

    
    <section className="page hidden" id="page-mapping">
      <div className="card">
        <div className="card-head">
          <h3>Mapping Configuration</h3>
          <div>
            <button className="btn btn-ghost" id="resetMapping">⟲ Reset to Defaults</button>
            <button className="btn btn-ghost" id="addMappingRow">+ Add Row</button>
            <button className="btn btn-primary" id="saveMapping">💾 Save</button>
          </div>
        </div>
        <p className="muted small">Edit metric → column mapping. <strong>Reset to Defaults</strong> wipes and re-seeds.</p>
        <div className="table-wrap">
          <table className="data-table" id="mapTable">
            <thead><tr><th>Metric</th><th>Sheet</th><th>Column</th><th>Type</th><th>Notes</th><th></th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Logic Reference (Sheet10)</h3><span className="muted">Read-only snapshot</span></div>
        <div className="table-wrap" id="logicWrap"><div className="muted">Loading…</div></div>
      </div>
    </section>

    
    <section className="page hidden" id="page-audit">
      <section className="filters card">
        <div className="filter">
          <label>From Date</label>
          <input type="date" id="auditFrom" className="audit-date" />
        </div>
        <div className="filter">
          <label>To Date</label>
          <input type="date" id="auditTo" className="audit-date" />
        </div>
        <div className="filter" style={{gridColumn: 'span 2'}}>
          <label>Search by email or name</label>
          <input type="text" id="auditSearch" className="audit-search" placeholder="e.g. niranchan or @housr" />
        </div>
        <div className="filter filter-actions">
          <button className="btn btn-primary" id="auditApply">Apply</button>
          <button className="btn btn-ghost" id="auditClear">Clear</button>
        </div>
      </section>

      <div className="kpi-grid kpi-3" id="kpiAudit"></div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3>Top Users</h3>
            <span className="muted">By access count in selected range</span>
          </div>
          <div className="table-wrap">
            <table className="data-table" id="topUsersTable">
              <thead><tr><th>#</th><th>Email</th><th className="num">Accesses</th><th>Share</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Daily Access Count</h3></div>
          <div className="chart-wrap"><canvas id="chartAuditDaily"></canvas></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Access Log</h3>
          <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
            <span className="muted" id="auditCountSub"></span>
            <button className="btn btn-ghost btn-sm" data-export="#auditTable" data-filename="audit-log.csv">⬇ CSV</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table" id="auditTable">
            <thead><tr><th>#</th><th>Timestamp</th><th>Email</th><th>Display Name</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </section>

    
    <section className="page hidden" id="page-debug">
      <div className="card">
        <div className="card-head">
          <h3>Debug & Diagnostics</h3>
          <button className="btn btn-primary" id="runDiag">▶ Run Diagnose</button>
        </div>
        <p className="muted small">Verifies source access, mapping resolution, parsed row counts.</p>
        <pre id="diagOut" style={{background: 'var(--surface-2)', padding: '14px', borderRadius: '8px', maxHeight: '600px', overflow: 'auto', fontSize: '12px', whiteSpace: 'pre-wrap', color: 'var(--text)'}}>Click "Run Diagnose" to begin…</pre>
      </div>
      <div className="card">
        <div className="card-head"><h3>Current Bundle Summary</h3></div>
        <pre id="bundleOut" style={{background: 'var(--surface-2)', padding: '14px', borderRadius: '8px', maxHeight: '400px', overflow: 'auto', fontSize: '12px', whiteSpace: 'pre-wrap', color: 'var(--text)'}}></pre>
      </div>
    </section>

  </main>
</div>

<div className="loader" id="loader"><div className="spinner"></div><div>Loading…</div></div>


<div id="shortcutsModal" className="modal-overlay hidden">
  <div className="modal-card">
    <div className="modal-header">
      <h3>⌨️ Keyboard Shortcuts</h3>
      <button className="close-modal-btn" id="closeShortcutsBtn">×</button>
    </div>
    <div className="modal-body">
      <div className="shortcut-list">
        <div className="shortcut-row"><kbd>1</kbd><span>Navigate to Dashboard Overview</span></div>
        <div className="shortcut-row"><kbd>2</kbd><span>Navigate to Occupancy View</span></div>
        <div className="shortcut-row"><kbd>3</kbd><span>Navigate to Short Stay Analytics</span></div>
        <div className="shortcut-row"><kbd>4</kbd><span>Navigate to Long Stay Sales</span></div>
        <div className="shortcut-row"><kbd>R</kbd><span>Force Refresh Data</span></div>
        <div className="shortcut-row"><kbd>T</kbd><span>Toggle Light/Dark Theme</span></div>
        <div className="shortcut-row"><kbd>?</kbd><span>Open Shortcuts Help</span></div>
      </div>
    </div>
  </div>
</div>


<div id="residentModal" className="modal-overlay hidden">
  <div className="modal-card" style={{maxWidth: '480px'}}>
    <div className="modal-header">
      <h3 id="resModalTitle">🏢 Resident Details</h3>
      <button className="close-modal-btn" id="closeResBtn">×</button>
    </div>
    <div className="modal-body" id="resModalBody">
      
    </div>
  </div>
</div>
    </>
  );
}
