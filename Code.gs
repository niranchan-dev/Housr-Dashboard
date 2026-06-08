/* CODE BUILD v8.2 */
/**********************************************************************
 *  HOUSR ANALYTICS – Apps Script Backend (v8.2)
 *  --------------------------------------------
 *
 *  v8.1 — Target vs Achieved on Dashboard + city filter for LS Sales
 *           Dashboard!X = Target, Dashboard!AC = Achieved (per-property)
 *           LS Sales filters gain own City dimension
 *  v8.0a — Snapshot infrastructure (data layer only, no UI change)
 *           Daily snapshots tab + auto-derived prev-month + bundle includes history
 *  v7.0 — Vercel/Linear visual rebuild + forest/amber palette
 *  v6.6 — Bottom 10 adds Short Occupied column + 15-min auto-refresh
 *  v6.5 — Critical cache fix (isAdmin per-request) + Audit Log
 *  v6.4 — Admin allowlist + backend guards
 *  v6.3 — Bed-count derived Occupancy Type (U=2 Solo, U=1 Twin)
 *  v6.2 — Dashboard junk-row skip + dim normalization + mapping warnings
 *
 *  Key invariants (do not break):
 *    • isAdmin / userEmail computed FRESH per request, never cached
 *    • Admin-only functions guarded by requireAdmin_()
 *    • Cache stores only shared data, no per-user fields
 *    • Audit log writes are debounced 1h per user
 *********************************************************************/

const SOURCE_SPREADSHEET_ID = '1kz1icd2PaPM9qWhCy13tUOHhTKANwhlP1TpTEDsxrYQ';
const CONFIG_SPREADSHEET_ID = '';

// Admin allowlist (case-insensitive)
const ADMIN_EMAILS = ['niranchan@housr.in'];

function currentUserEmail_(e) {
  try {
    var email = Session.getActiveUser().getEmail();
    if (email) return email.toLowerCase();
  } catch (err) {}
  if (e && e.parameter && e.parameter.userEmail) {
    return String(e.parameter.userEmail).trim().toLowerCase();
  }
  return '';
}
function isAdmin_(e) {
  const email = currentUserEmail_(e);
  if (!email) return false;
  return ADMIN_EMAILS.some(function(a) { return String(a).toLowerCase() === email; });
}
function requireAdmin_(e) {
  if (!isAdmin_(e)) {
    throw new Error('Admin access required. Signed in as: ' + (currentUserEmail_(e) || 'unknown'));
  }
}

const SHEETS = {
  EXTRACT:   'Extract',
  SHORTSTAY: 'Short Stay',
  DASHBOARD: 'Dashboard',
  LOGIC:     'Sheet10',
  LSSALES:   'LS Sales',
  MAPPING:   'MappingConfig',
  AUDIT:     'AuditLog',
  SNAPSHOTS: 'Snapshots'
};

const STATUS = {
  EXCLUDED:     ['moved out', 'token cancelled'],
  NOT_FOR_SALE: ['not for sale'],
  OCCUPIED:     ['occupied', 'under notice', 'under notice booked'],
  VACANT:       ['vacant', 'vacant-booked', 'vacant booked'],
  UNDER_NOTICE: ['under notice', 'under notice booked'],
  BOOKED:       ['under notice booked', 'vacant-booked', 'vacant booked', 'booked']
};

const DEFAULT_MAPPING = [
  ['Property',                    'Extract',    'CQ', 'dimension', 'Property name'],
  ['City',                        'Extract',    'CT', 'dimension', 'City (forward-fills blanks)'],
  ['Property Type',               'Extract',    'CU', 'dimension', 'Property Type'],
  ['Occupancy Type',              'Extract',    'T',  'dimension', 'Reference only — derived Solo/Twin from bed count (U)'],
  ['Status',                      'Extract',    'I',  'dimension', 'Sheet10 occupancy bucket'],
  ['Bed Count',                   'Extract',    'U',  'count',     'Sheet10 SUMIFS column'],
  ['Tenure (Days)',               'Extract',    'Y',  'count',     'AVERAGE → Avg Tenure'],
  ['Contracted Rent',             'Extract',    'Z',  'currency',  'Σ Z'],
  ['Revenue (Long Stay)',         'Extract',    'CB', 'currency',  'Update column letter every month'],
  ['GST',                         'Extract',    'CC', 'currency',  'Σ CC'],

  ['Short Stay Property',         'Short Stay', 'A',  'dimension', 'Property name'],
  ['Short Stay Date',             'Short Stay', 'F',  'date',      'Daily check-in date'],
  ['Short Stay Source',           'Short Stay', 'K',  'dimension', 'Booking source'],
  ['Short Stay Revenue',          'Short Stay', 'S',  'currency',  'Σ S'],
  ['Short Stay Month',            'Short Stay', 'T',  'date',      'Month label'],
  ['Short Stay City',             'Short Stay', 'V',  'dimension', 'City'],
  ['Short Stay Nights',           'Short Stay', 'R',  'count',     'Nights'],

  ['Dashboard Property',          'Dashboard',  'A',  'dimension', 'Property name (filterable)'],
  ['Dashboard City',              'Dashboard',  'B',  'dimension', 'City (filterable)'],
  ['Dashboard Property Type',     'Dashboard',  'C',  'dimension', 'Property type (filterable)'],
  ['Vacant Sales Focus',          'Dashboard',  'V',  'count',     'Per-property numeric value'],
  ['Short Stay Beds Occupied',    'Dashboard',  'W',  'count',     'Per-property numeric value'],
  ['Dashboard Target',            'Dashboard',  'X',  'currency',  'v8.1: Per-property target (always column X)'],
  ['Dashboard Achieved',          'Dashboard',  'AC', 'currency',  'v8.1: Per-property achieved'],

  ['LS Sales Date',               'LS Sales',   'A',  'date',      'Sales date (drives FTD/MTD/YTD)'],
  ['LS Sales Value',              'LS Sales',   'AO', 'currency',  'Sales value'],
  ['LS Sales Owner',              'LS Sales',   'BG', 'dimension', 'Sales owner'],
  ['LS Sales Owner Alt',          'LS Sales',   'EC', 'dimension', 'Fallback owner column'],
  ['LS Sales City',               'LS Sales',   'EA', 'dimension', 'City'],
  ['LS Sales Source',             'LS Sales',   'EB', 'dimension', 'Lead source'],
  ['LS Sales Beds',               'LS Sales',   'EE', 'count',     'Beds sold'],
  ['LS Sales Month',              'LS Sales',   'EF', 'date',      'Month of sale (display only)'],
  ['LS Sales Property',           'LS Sales',   'EG', 'dimension', 'Property name'],
  ['LS Sales Move In Month',      'LS Sales',   'EH', 'date',      'Move-in month'],
  ['LS Sales Prorated Rent',      'LS Sales',   'EJ', 'currency',  'Prorated rent']
];

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  var response = null;
  
  try {
    if (!action) {
      throw new Error("No action parameter provided");
    }
    
    ensureMappingSheet_();
    
    var email = currentUserEmail_(e);
    if (email) {
      try { logUserAccess_(email); } catch (err) {}
    }
    
    switch (action) {
      case 'getData':
        var force = e.parameter.force === 'true';
        if (force) {
          response = refreshData(e);
        } else {
          response = getDashboardData(e);
        }
        break;
        
      case 'getLogic':
        response = getLogicReference(e);
        break;
        
      case 'getAudit':
        var from = e.parameter.from || '';
        var to = e.parameter.to || '';
        var q = e.parameter.q || '';
        response = getAuditLog(from, to, q, e);
        break;
        
      case 'saveMapping':
        var rowsStr = e.parameter.rows;
        if (!rowsStr) throw new Error("Missing rows parameter");
        var rows = JSON.parse(rowsStr);
        response = saveMapping(rows, e);
        break;
        
      case 'resetMapping':
        response = resetMapping(e);
        break;
        
      case 'diagnose':
        response = diagnose(e);
        break;
        
      default:
        throw new Error("Unknown action: " + action);
    }
  } catch (err) {
    response = { ok: false, error: err.message, stack: err.stack };
  }
  
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

var _cachedSourceSS = null;
var _cachedConfigSS = null;

function sourceSS_() {
  if (!_cachedSourceSS) {
    _cachedSourceSS = SpreadsheetApp.openById(SOURCE_SPREADSHEET_ID);
  }
  return _cachedSourceSS;
}

function configSS_() {
  if (!_cachedConfigSS) {
    if (CONFIG_SPREADSHEET_ID) {
      _cachedConfigSS = SpreadsheetApp.openById(CONFIG_SPREADSHEET_ID);
    } else {
      _cachedConfigSS = SpreadsheetApp.getActiveSpreadsheet() || sourceSS_();
    }
  }
  return _cachedConfigSS;
}
function colLetterToIndex_(letter) {
  letter = String(letter).toUpperCase().replace(/[^A-Z]/g, '');
  if (!letter) return -1;
  let n = 0; for (let i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64);
  return n - 1;
}
function currentMonthLabel_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM-yyyy');
}
function toNum_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[, ₹$%]/g, ''));
  return isNaN(n) ? 0 : n;
}
function normDim_(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}
function isJunkDashboardRow_(propertyCell) {
  const p = String(propertyCell || '').trim().toLowerCase();
  if (!p) return true;
  if (p.indexOf('total') >= 0) return true;
  if (p.indexOf('grand') >= 0) return true;
  if (p.indexOf('subtotal') >= 0) return true;
  if (p === 'sum' || p === 'count') return true;
  return false;
}

/* ============================================================ *
 *  AUDIT LOG
 * ============================================================ */
function ensureAuditSheet_() {
  const s = configSS_();
  let sh = s.getSheetByName(SHEETS.AUDIT);
  if (!sh) {
    sh = s.insertSheet(SHEETS.AUDIT);
    sh.getRange(1, 1, 1, 4).setValues([['Timestamp', 'Date', 'Email', 'Display Name']])
      .setFontWeight('bold').setBackground('#1f2937').setFontColor('#fff');
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, 4);
  }
  return sh;
}
function logUserAccess_(email) {
  if (!email) email = '(anonymous)';
  try {
    const cache = CacheService.getScriptCache();
    const k = 'AUDIT_' + email;
    if (cache.get(k)) return;
    cache.put(k, '1', 3600);
  } catch (e) {}
  try {
    const sh = ensureAuditSheet_();
    const now = new Date();
    const tz = Session.getScriptTimeZone();
    const dateStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const displayName = email === '(anonymous)' ? 'Anonymous'
      : email.split('@')[0].replace(/[._\-]/g, ' ').replace(/\b\w/g, function(l) { return l.toUpperCase(); });
    sh.appendRow([now, dateStr, email, displayName]);
  } catch (e) { console.error('audit log write failed:', e); }
}
function getAuditLog(startDate, endDate, searchText, e) {
  requireAdmin_(e);
  try {
    const s = configSS_();
    const sh = s.getSheetByName(SHEETS.AUDIT);
    if (!sh || sh.getLastRow() < 2) {
      return { ok: true, rows: [], totalRows: 0, uniqueUsers: 0, totalEntries: 0 };
    }
    const lastRow = sh.getLastRow();
    const values = sh.getRange(2, 1, lastRow - 1, 4).getValues();
    const tz = Session.getScriptTimeZone();
    let rows = values.map(function(r) {
      const ts = r[0] instanceof Date ? r[0] : null;
      const date = ts ? Utilities.formatDate(ts, tz, 'yyyy-MM-dd')
                      : (r[1] instanceof Date ? Utilities.formatDate(r[1], tz, 'yyyy-MM-dd') : String(r[1] || ''));
      return {
        timestamp: ts ? ts.toISOString() : '',
        timestampDisplay: ts ? Utilities.formatDate(ts, tz, 'yyyy-MM-dd HH:mm:ss') : '',
        date: date,
        email: String(r[2] || ''),
        displayName: String(r[3] || '')
      };
    }).filter(function(r) { return r.email; });

    const totalEntries = rows.length;
    if (startDate) rows = rows.filter(function(r) { return r.date >= startDate; });
    if (endDate)   rows = rows.filter(function(r) { return r.date <= endDate; });
    if (searchText) {
      const q = String(searchText).toLowerCase();
      rows = rows.filter(function(r) {
        return r.email.toLowerCase().indexOf(q) >= 0 ||
               r.displayName.toLowerCase().indexOf(q) >= 0;
      });
    }
    rows.sort(function(a, b) { return b.timestamp.localeCompare(a.timestamp); });

    const uniq = {};
    rows.forEach(function(r) { uniq[r.email] = (uniq[r.email] || 0) + 1; });
    const topUsers = Object.keys(uniq).map(function(k) { return { email: k, count: uniq[k] }; })
      .sort(function(a, b) { return b.count - a.count; }).slice(0, 10);

    return {
      ok: true, rows: rows.slice(0, 2000),
      totalRows: rows.length, uniqueUsers: Object.keys(uniq).length,
      totalEntries: totalEntries, topUsers: topUsers
    };
  } catch (err) { return { ok: false, error: err.message }; }
}

/* ============================================================ *
 *  MAPPING CONFIG
 * ============================================================ */
function ensureMappingSheet_() {
  const s = configSS_();
  let sh = s.getSheetByName(SHEETS.MAPPING);
  if (!sh) { sh = s.insertSheet(SHEETS.MAPPING); seedMapping_(sh); }
  else {
    const existing = new Set(sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues().map(r => String(r[0]).trim()).filter(Boolean));
    const missing = DEFAULT_MAPPING.filter(d => !existing.has(d[0]));
    if (missing.length) sh.getRange(sh.getLastRow() + 1, 1, missing.length, 5).setValues(missing);
  }
  return sh;
}
function seedMapping_(sh) {
  sh.clear();
  sh.getRange(1, 1, 1, 5).setValues([['Metric', 'Sheet', 'Column', 'Type', 'Notes']])
    .setFontWeight('bold').setBackground('#1f2937').setFontColor('#fff');
  sh.getRange(2, 1, DEFAULT_MAPPING.length, 5).setValues(DEFAULT_MAPPING);
  sh.setFrozenRows(1); sh.autoResizeColumns(1, 5);
}
function resetMapping(e) {
  requireAdmin_(e);
  const s = configSS_();
  let sh = s.getSheetByName(SHEETS.MAPPING);
  if (!sh) sh = s.insertSheet(SHEETS.MAPPING);
  seedMapping_(sh);
  safeCacheRemove_('DATA_BUNDLE_VD');
  return { ok: true, seeded: DEFAULT_MAPPING.length };
}
function getMapping() {
  ensureMappingSheet_();
  const sh = configSS_().getSheetByName(SHEETS.MAPPING);
  const values = sh.getDataRange().getValues();
  const map = {};
  values.slice(1).filter(r => r[0]).forEach(r => {
    map[String(r[0]).trim()] = {
      metric: String(r[0]).trim(),
      sheet:  String(r[1]).trim(),
      col:    String(r[2]).trim().toUpperCase(),
      type:   String(r[3] || 'dimension').trim().toLowerCase(),
      notes:  String(r[4] || '')
    };
  });
  return map;
}
function saveMapping(rows, e) {
  requireAdmin_(e);
  const sh = ensureMappingSheet_();
  sh.clear();
  sh.getRange(1, 1, 1, 5).setValues([['Metric', 'Sheet', 'Column', 'Type', 'Notes']])
    .setFontWeight('bold').setBackground('#1f2937').setFontColor('#fff');
  if (rows && rows.length) {
    const data = rows.map(r => [r.metric || '', r.sheet || '', (r.col || '').toUpperCase(), r.type || 'dimension', r.notes || '']);
    sh.getRange(2, 1, data.length, 5).setValues(data);
  }
  sh.setFrozenRows(1);
  safeCacheRemove_('DATA_BUNDLE_VD');
  return { ok: true };
}
function getLogicReference(e) {
  requireAdmin_(e);
  try {
    const sh = sourceSS_().getSheetByName(SHEETS.LOGIC);
    if (!sh) return [];
    return sh.getDataRange().getDisplayValues();
  } catch (err) { return [['Error reading Sheet10: ' + err.message]]; }
}

/* ============================================================ *
 *  SNAPSHOT INFRASTRUCTURE (v8.0a)
 * ============================================================ */

function prevColLetter_(currentLetter) {
  if (!currentLetter) return '';
  var idx = colLetterToIndex_(currentLetter);
  if (idx <= 0) return '';
  return colIndexToLetter_(idx - 1);
}
function colIndexToLetter_(idx) {
  var s = '', n = idx + 1;
  while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function sumExtractColumn_(mapping, colLetter) {
  if (!colLetter) return 0;
  try {
    var sh = sourceSS_().getSheetByName(SHEETS.EXTRACT);
    if (!sh) return 0;
    var ci = colLetterToIndex_(colLetter);
    if (ci < 0 || ci >= sh.getLastColumn()) return 0;
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return 0;
    var vals = sh.getRange(2, ci + 1, lastRow - 1, 1).getValues();
    var sum = 0;
    vals.forEach(function(r) { sum += toNum_(r[0]); });
    return sum;
  } catch (e) { return 0; }
}

function ensureSnapshotSheet_() {
  var s = configSS_();
  var sh = s.getSheetByName(SHEETS.SNAPSHOTS);
  if (!sh) {
    sh = s.insertSheet(SHEETS.SNAPSHOTS);
    sh.getRange(1, 1, 1, 7).setValues([[
      'Date', 'Total Revenue', 'LS Revenue', 'SS Revenue', 'LS Occupancy %', 'L+S Occupancy %', 'Source'
    ]]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#fff');
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, 7);
  }
  return sh;
}

function writeDailySnapshot_(source) {
  source = source || 'manual';
  try {
    var tz = Session.getScriptTimeZone();
    var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var sh = ensureSnapshotSheet_();

    var lastRow = sh.getLastRow();
    if (lastRow >= 2) {
      var dates = sh.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < dates.length; i++) {
        var d = dates[i][0];
        var ds = d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : String(d);
        if (ds === todayStr) {
          return { written: false, reason: 'already-snapshotted-today', date: todayStr };
        }
      }
    }

    var mapping = getMapping();
    var extract = readExtract_(mapping);
    var shortSt = readShortStay_(mapping);
    var dashRows = readDashboardRows_(mapping);

    var lsRev = 0, sellable = 0, occupied = 0;
    extract.rows.forEach(function(r) {
      var st = String(r.status || '').toLowerCase();
      if (STATUS.EXCLUDED.indexOf(st) >= 0) return;
      var beds = Number(r.beds) || 0;
      if (STATUS.NOT_FOR_SALE.indexOf(st) < 0) sellable += beds;
      if (STATUS.OCCUPIED.indexOf(st) >= 0) occupied += beds;
      lsRev += Number(r.revenue) || 0;
    });

    var nowY = new Date().getFullYear(), nowM = new Date().getMonth() + 1;
    var ssRev = 0;
    shortSt.rows.forEach(function(r) {
      if (r.year === nowY && r.monthNum === nowM) ssRev += Number(r.revenue) || 0;
    });

    var ssOccBeds = 0;
    dashRows.rows.forEach(function(r) { ssOccBeds += Number(r.ssbo) || 0; });

    var lsOcc = sellable ? occupied / sellable : 0;
    var blendedOcc = sellable ? (occupied + ssOccBeds) / sellable : 0;
    var total = lsRev + ssRev;

    sh.appendRow([new Date(), total, lsRev, ssRev, lsOcc, blendedOcc, source]);

    return {
      written: true, date: todayStr,
      snapshot: { totalRev: total, lsRev: lsRev, ssRev: ssRev, lsOcc: lsOcc, blendedOcc: blendedOcc }
    };
  } catch (e) {
    return { written: false, reason: 'error: ' + e.message };
  }
}

function getSnapshots(days) {
  days = Number(days) || 90;
  try {
    var sh = configSS_().getSheetByName(SHEETS.SNAPSHOTS);
    if (!sh || sh.getLastRow() < 2) return { ok: true, rows: [] };
    var tz = Session.getScriptTimeZone();
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
    var rows = vals.map(function(r) {
      var d = r[0] instanceof Date ? r[0] : new Date(r[0]);
      return {
        date: isNaN(d) ? String(r[0]) : Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
        totalRev: Number(r[1]) || 0,
        lsRev: Number(r[2]) || 0,
        ssRev: Number(r[3]) || 0,
        lsOcc: Number(r[4]) || 0,
        blendedOcc: Number(r[5]) || 0
      };
    }).filter(function(r) { return r.date; });
    rows.sort(function(a, b) { return a.date.localeCompare(b.date); });
    return { ok: true, rows: rows.slice(-days) };
  } catch (e) {
    return { ok: false, error: e.message, rows: [] };
  }
}

function installDailyTrigger(e) {
  requireAdmin_(e);
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'dailySnapshotTrigger_') {
      return { ok: true, message: 'Trigger already installed', existingCount: 1 };
    }
  }
  ScriptApp.newTrigger('dailySnapshotTrigger_')
    .timeBased().everyDays(1).atHour(0).nearMinute(5).create();
  return { ok: true, message: 'Daily snapshot trigger installed for ~12:05 AM' };
}
function dailySnapshotTrigger_() {
  writeDailySnapshot_('scheduled');
}
function runSnapshotNow(e) {
  requireAdmin_(e);
  return writeDailySnapshot_('manual-run');
}

function getPrevMonthLSRevenue_(mapping) {
  var currentCol = (mapping['Revenue (Long Stay)'] || {}).col || '';
  var prevCol = prevColLetter_(currentCol);
  if (!prevCol) return { value: 0, column: '', label: '' };
  var value = sumExtractColumn_(mapping, prevCol);
  var d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  var label = Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM-yyyy');
  return { value: value, column: prevCol, label: label };
}

/* ============================================================ *
 *  DATA LOAD
 * ============================================================ */
function getDashboardData(e) {
  const userEmail = currentUserEmail_(e);
  const admin = isAdmin_(e);

  try { logUserAccess_(userEmail); } catch (e) {}

  try {
    const cached = safeCacheGet_('DATA_BUNDLE_VD');
    if (cached) {
      try {
        const obj = JSON.parse(cached);
        obj.isAdmin = admin;
        obj.userEmail = userEmail;
        obj.cacheHit = true;
        return obj;
      } catch (e) {}
    }

    const mapping = getMapping();
    const warnings = validateMapping_(mapping);
    const extract = readExtract_(mapping);
    const shortSt = readShortStay_(mapping);
    const lsSales = readLSSales_(mapping);
    const dashRows = readDashboardRows_(mapping);

    try { writeDailySnapshot_('dashboard-load'); } catch (e) {}

    const prevMonth = getPrevMonthLSRevenue_(mapping);
    const snapshotData = getSnapshots(90);

    const dimIndex = {};
    extract.rows.forEach(r => { if (r.property && !dimIndex[r.property]) dimIndex[r.property] = { city: r.city || '', type: r.propType || '' }; });
    dashRows.rows.forEach(r => { if (r.property && !dimIndex[r.property]) dimIndex[r.property] = { city: r.city || '', type: r.propType || '' }; });
    shortSt.rows.forEach(r => { if (r.property && !dimIndex[r.property]) dimIndex[r.property] = { city: r.city || '', type: '' }; });

    const sharedBundle = {
      ok: true,
      build: 'v8.2',
      generatedAt: new Date().toISOString(),
      currentMonthLabel: currentMonthLabel_(),
      today: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      yesterday: Utilities.formatDate(new Date(Date.now() - 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      revenueColumn: (mapping['Revenue (Long Stay)'] || {}).col || '?',
      source: SOURCE_SPREADSHEET_ID,
      warnings: warnings,
      mapping: mapping,
      extract: extract,
      shortStay: shortSt,
      lsSales: lsSales,
      dashboardRows: dashRows,
      dimensionIndex: dimIndex,
      filters: buildFilterOptions_(extract, shortSt, lsSales, dashRows),
      prevMonth: prevMonth,
      snapshots: (snapshotData && snapshotData.rows) || [],
      counts: {
        extractRows: extract.rows.length,
        shortStayRows: shortSt.rows.length,
        lsSalesRows: lsSales.rows.length,
        dashboardRows: dashRows.rows.length,
        mappedMetrics: Object.keys(mapping).length,
        skippedDashboardJunk: dashRows.skippedJunk || 0
      }
    };
    safeCachePut_('DATA_BUNDLE_VD', sharedBundle, 300);

    sharedBundle.isAdmin = admin;
    sharedBundle.userEmail = userEmail;
    sharedBundle.cacheHit = false;
    return sharedBundle;
  } catch (err) {
    return { ok: false, error: err.message, stack: err.stack || null, isAdmin: admin, userEmail: userEmail };
  }
}
function refreshData(e) {
  safeCacheRemove_('DATA_BUNDLE_VD');
  return getDashboardData(e);
}

function validateMapping_(mapping) {
  const warnings = [];
  const ss = sourceSS_();
  Object.values(mapping).forEach(m => {
    const sh = ss.getSheetByName(m.sheet);
    if (!sh) { warnings.push(m.metric + ': sheet "' + m.sheet + '" not found'); return; }
    const ci = colLetterToIndex_(m.col);
    if (ci < 0 || ci >= sh.getLastColumn()) {
      warnings.push(m.metric + ': column ' + m.col + ' out of range on ' + m.sheet + ' (max ' + sh.getLastColumn() + ' cols)');
    }
  });
  return warnings;
}

function readExtract_(mapping) {
  const sh = sourceSS_().getSheetByName(SHEETS.EXTRACT);
  if (!sh) return { rows: [], reason: 'Sheet "Extract" not found' };
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return { rows: [], reason: 'Extract has no data rows' };
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const body = values.slice(1);

  const headers = values[0];
  const findCol = names => {
    for (let i = 0; i < headers.length; i++) {
      let h = String(headers[i]).toLowerCase().trim();
      if (names.some(n => h === n || h.includes(n))) return i;
    }
    return -1;
  };

  const idxResName = (function() {
    let i = findCol(['resident name', 'member name', 'tenant name', 'member', 'resident', 'name']);
    return i >= 0 ? i : 9; // Column J
  })();
  const idxPhone = (function() {
    let i = findCol(['phone', 'mobile', 'contact', 'phone number', 'contact no']);
    return i >= 0 ? i : 10; // Column K
  })();
  const idxEmail = (function() {
    let i = findCol(['email', 'e-mail']);
    return i >= 0 ? i : 11; // Column L
  })();
  const idxMoveIn = (function() {
    let i = findCol(['move in', 'move-in', 'joining date', 'check in', 'check-in', 'start date']);
    return i >= 0 ? i : 23; // Column X
  })();
  const idxMoveOut = (function() {
    let i = findCol(['move out', 'move-out', 'exit date', 'check out', 'check-out', 'end date']);
    return i >= 0 ? i : 24; // Column Y
  })();
  const idxRentCC = (function() {
    let i = findCol(['current month rent', 'current rent', 'rent']);
    return i >= 0 ? i : 80; // Column CC
  })();
  const idxOccCV = (function() {
    let i = findCol(['occupancy type', 'occ type']);
    return i >= 0 ? i : 99; // Column CV
  })();

  const get = m => mapping[m] ? colLetterToIndex_(mapping[m].col) : -1;
  const idx = {
    property: get('Property'), city: get('City'),
    propType: get('Property Type'), occType: get('Occupancy Type'),
    status: get('Status'), bedCount: get('Bed Count'),
    tenure: get('Tenure (Days)'), rent: get('Contracted Rent'),
    revenue: get('Revenue (Long Stay)'), gst: get('GST')
  };
  let lastCity = '';
  const rows = body.map(r => {
    let city = idx.city >= 0 ? normDim_(r[idx.city]) : '';
    if (!city) city = lastCity; else lastCity = city;
    return {
      property: idx.property >= 0 ? normDim_(r[idx.property]) : '',
      city: city,
      propType: idx.propType >= 0 ? normDim_(r[idx.propType]) : '',
      occType: (function() {
        var bc = idx.bedCount >= 0 ? toNum_(r[idx.bedCount]) : 0;
        if (bc === 2) return 'Solo';
        if (bc === 1) return 'Twin';
        return '';
      })(),
      occTypeRaw: idxOccCV >= 0 && idxOccCV < r.length ? normDim_(r[idxOccCV]) : (idx.occType >= 0 && idx.occType < r.length ? normDim_(r[idx.occType]) : ''),
      status: idx.status >= 0 ? String(r[idx.status] || '').trim() : '',
      beds: idx.bedCount >= 0 ? toNum_(r[idx.bedCount]) : 0,
      tenure: idx.tenure >= 0 ? toNum_(r[idx.tenure]) : 0,
      rent: idxRentCC >= 0 && idxRentCC < r.length ? toNum_(r[idxRentCC]) : (idx.rent >= 0 && idx.rent < r.length ? toNum_(r[idx.rent]) : 0),
      revenue: idx.revenue >= 0 ? toNum_(r[idx.revenue]) : 0,
      gst: idx.gst >= 0 ? toNum_(r[idx.gst]) : 0,
      flat: r.length > 6 ? String(r[6] || '').trim() : '',
      bed: r.length > 7 ? String(r[7] || '').trim() : '',
      statusRaw: r.length > 8 ? String(r[8] || '').trim() : '',
      propertyCR: r.length > 95 ? normDim_(r[95]) : '',
      residentName: idxResName >= 0 && idxResName < r.length ? String(r[idxResName] || '').trim() : '',
      phone: idxPhone >= 0 && idxPhone < r.length ? String(r[idxPhone] || '').trim() : '',
      email: idxEmail >= 0 && idxEmail < r.length ? String(r[idxEmail] || '').trim() : '',
      moveIn: idxMoveIn >= 0 && idxMoveIn < r.length ? (r[idxMoveIn] instanceof Date ? Utilities.formatDate(r[idxMoveIn], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[idxMoveIn] || '').trim()) : '',
      moveOut: idxMoveOut >= 0 && idxMoveOut < r.length ? (r[idxMoveOut] instanceof Date ? Utilities.formatDate(r[idxMoveOut], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[idxMoveOut] || '').trim()) : ''
    };
  }).filter(r => r.property || r.city || r.status || r.beds > 0 || r.rent > 0);
  return { rows: rows, totalSourceRows: body.length };
}

function readShortStay_(mapping) {
  const sh = sourceSS_().getSheetByName(SHEETS.SHORTSTAY);
  if (!sh) return { rows: [], reason: 'Sheet "Short Stay" not found' };
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return { rows: [], reason: 'Short Stay has no data rows' };
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const body = values.slice(1);
  const tz = Session.getScriptTimeZone();
  const get = m => mapping[m] ? colLetterToIndex_(mapping[m].col) : -1;
  const idx = {
    property: get('Short Stay Property'), date: get('Short Stay Date'),
    source: get('Short Stay Source'), revenue: get('Short Stay Revenue'),
    month: get('Short Stay Month'), city: get('Short Stay City'),
    nights: get('Short Stay Nights')
  };
  const rows = body.map(r => {
    let dateIso = null, y = null, m = null;
    if (idx.date >= 0) {
      const d = r[idx.date];
      if (d instanceof Date) { dateIso = Utilities.formatDate(d, tz, 'yyyy-MM-dd'); y = d.getFullYear(); m = d.getMonth() + 1; }
      else if (d) { const p = new Date(d); if (!isNaN(p)) { dateIso = Utilities.formatDate(p, tz, 'yyyy-MM-dd'); y = p.getFullYear(); m = p.getMonth() + 1; } }
    }
    let monthLabel = '';
    if (dateIso) {
      const p = new Date(dateIso + 'T00:00:00');
      monthLabel = Utilities.formatDate(p, tz, 'MMM-yyyy');
    } else if (idx.month >= 0) {
      const mv = r[idx.month];
      if (mv instanceof Date) { monthLabel = Utilities.formatDate(mv, tz, 'MMM-yyyy'); y = mv.getFullYear(); m = mv.getMonth() + 1; }
      else if (mv) {
        const p = new Date('1 ' + String(mv).replace('-', ' '));
        if (!isNaN(p)) { monthLabel = Utilities.formatDate(p, tz, 'MMM-yyyy'); y = p.getFullYear(); m = p.getMonth() + 1; }
        else monthLabel = String(mv).trim();
      }
    }
    return {
      property: idx.property >= 0 ? normDim_(r[idx.property]) : '',
      date: dateIso, year: y, monthNum: m,
      source: idx.source >= 0 ? (normDim_(r[idx.source]) || 'Direct') : 'Direct',
      revenue: idx.revenue >= 0 ? toNum_(r[idx.revenue]) : 0,
      month: monthLabel,
      city: idx.city >= 0 ? normDim_(r[idx.city]) : '',
      nights: idx.nights >= 0 ? toNum_(r[idx.nights]) : 0
    };
  }).filter(r => r.month || r.city || r.property || r.revenue);
  return { rows: rows, totalSourceRows: body.length };
}

function readLSSales_(mapping) {
  const m = mapping['LS Sales Date'];
  if (!m) return { rows: [], reason: 'LS Sales mapping not configured' };
  const sh = sourceSS_().getSheetByName(m.sheet);
  if (!sh) return { rows: [], reason: 'Sheet "' + m.sheet + '" not found' };
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return { rows: [], reason: m.sheet + ' has no data rows' };
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const body = values.slice(1);
  const tz = Session.getScriptTimeZone();
  const get = k => mapping[k] ? colLetterToIndex_(mapping[k].col) : -1;
  const idx = {
    date: get('LS Sales Date'), value: get('LS Sales Value'),
    owner: get('LS Sales Owner'), ownerAlt: get('LS Sales Owner Alt'),
    city: get('LS Sales City'), source: get('LS Sales Source'),
    beds: get('LS Sales Beds'), month: get('LS Sales Month'),
    property: get('LS Sales Property'), moveIn: get('LS Sales Move In Month'),
    prorated: get('LS Sales Prorated Rent')
  };
  const safeMonth = v => {
    if (v instanceof Date) return { label: Utilities.formatDate(v, tz, 'MMM-yyyy'), y: v.getFullYear(), m: v.getMonth() + 1 };
    if (!v) return { label: '', y: null, m: null };
    const p = new Date('1 ' + String(v).replace('-', ' '));
    if (!isNaN(p)) return { label: Utilities.formatDate(p, tz, 'MMM-yyyy'), y: p.getFullYear(), m: p.getMonth() + 1 };
    return { label: String(v).trim(), y: null, m: null };
  };
  const rows = body.map(r => {
    let dateIso = null, y = null, mn = null;
    if (idx.date >= 0) {
      const d = r[idx.date];
      if (d instanceof Date) { dateIso = Utilities.formatDate(d, tz, 'yyyy-MM-dd'); y = d.getFullYear(); mn = d.getMonth() + 1; }
      else if (d) { const p = new Date(d); if (!isNaN(p)) { dateIso = Utilities.formatDate(p, tz, 'yyyy-MM-dd'); y = p.getFullYear(); mn = p.getMonth() + 1; } }
    }
    let monthInfo = { label: '', y: null, m: null };
    let moveInInfo = idx.moveIn >= 0 ? safeMonth(r[idx.moveIn]) : { label: '', y: null, m: null };
    if (dateIso) {
      const p = new Date(dateIso + 'T00:00:00');
      monthInfo = { label: Utilities.formatDate(p, tz, 'MMM-yyyy'), y: p.getFullYear(), m: p.getMonth() + 1 };
    } else if (idx.month >= 0) {
      monthInfo = safeMonth(r[idx.month]);
    }
    let owner = idx.owner >= 0 ? normDim_(r[idx.owner]) : '';
    if (!owner && idx.ownerAlt >= 0) owner = normDim_(r[idx.ownerAlt]);
    return {
      date: dateIso, year: y, monthNum: mn,
      value: idx.value >= 0 ? toNum_(r[idx.value]) : 0,
      prorated: idx.prorated >= 0 ? toNum_(r[idx.prorated]) : 0,
      owner: owner || 'Unknown',
      city: idx.city >= 0 ? normDim_(r[idx.city]) : '',
      source: idx.source >= 0 ? (normDim_(r[idx.source]) || 'Direct') : 'Direct',
      beds: idx.beds >= 0 ? toNum_(r[idx.beds]) : 0,
      property: idx.property >= 0 ? normDim_(r[idx.property]) : '',
      month: monthInfo.label, monthY: monthInfo.y, monthM: monthInfo.m,
      moveIn: moveInInfo.label, moveInY: moveInInfo.y, moveInM: moveInInfo.m
    };
  }).filter(r => r.date || r.value || r.property || r.city || r.beds);
  return { rows: rows, totalSourceRows: body.length };
}

function readDashboardRows_(mapping) {
  const propM = mapping['Dashboard Property'];
  if (!propM) return { rows: [], reason: 'Dashboard Property mapping missing', skippedJunk: 0 };
  const sh = sourceSS_().getSheetByName(propM.sheet);
  if (!sh) return { rows: [], reason: 'Sheet "' + propM.sheet + '" not found', skippedJunk: 0 };
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return { rows: [], reason: 'Dashboard has no data rows', skippedJunk: 0 };
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const body = values.slice(1);
  const get = k => mapping[k] ? colLetterToIndex_(mapping[k].col) : -1;
  const idx = {
    property: get('Dashboard Property'),
    city:     get('Dashboard City'),
    propType: get('Dashboard Property Type'),
    vsf:      get('Vacant Sales Focus'),
    ssbo:     get('Short Stay Beds Occupied'),
    target:   get('Dashboard Target'),     // v8.1
    achieved: get('Dashboard Achieved')    // v8.1
  };
  let lastCity = '', skipped = 0;
  const rows = body.map(r => {
    const rawProp = idx.property >= 0 ? r[idx.property] : '';
    if (isJunkDashboardRow_(rawProp)) { skipped++; return null; }
    let city = idx.city >= 0 ? normDim_(r[idx.city]) : '';
    if (!city) city = lastCity; else lastCity = city;
    return {
      property: normDim_(rawProp),
      city: city,
      propType: idx.propType >= 0 ? normDim_(r[idx.propType]) : '',
      vsf:      idx.vsf      >= 0 ? toNum_(r[idx.vsf])      : 0,
      ssbo:     idx.ssbo     >= 0 ? toNum_(r[idx.ssbo])     : 0,
      target:   idx.target   >= 0 ? toNum_(r[idx.target])   : 0,    // v8.1
      achieved: idx.achieved >= 0 ? toNum_(r[idx.achieved]) : 0     // v8.1
    };
  }).filter(Boolean);
  return { rows: rows, totalSourceRows: body.length, skippedJunk: skipped };
}

function buildFilterOptions_(extract, shortSt, lsSales, dashRows) {
  const cities = new Set(), props = new Set(), types = new Set(), occ = new Set(), months = new Set();
  const lsMonths = new Set(), lsMoveIn = new Set(), lsSources = new Set(), lsProps = new Set();
  const lsCities = new Set();  // v8.1: dedicated LS Sales city list
  
  const addCity = (set, c) => {
    if (!c) return;
    let s = String(c).trim();
    if (s.toLowerCase() !== 'city' && s !== '') {
      set.add(s);
    }
  };

  extract.rows.forEach(r => {
    addCity(cities, r.city);
    if (r.property) props.add(r.property);
    if (r.propType) types.add(r.propType);
    if (r.occType) occ.add(r.occType);
  });
  shortSt.rows.forEach(r => {
    addCity(cities, r.city);
    if (r.property) props.add(r.property);
    if (r.month) months.add(r.month);
  });
  (dashRows.rows || []).forEach(r => {
    addCity(cities, r.city);
    if (r.property) props.add(r.property);
    if (r.propType) types.add(r.propType);
  });
  lsSales.rows.forEach(r => {
    if (r.month)    lsMonths.add(r.month);
    if (r.moveIn)   lsMoveIn.add(r.moveIn);
    if (r.source)   lsSources.add(r.source);
    if (r.property) lsProps.add(r.property);
    addCity(lsCities, r.city);   // v8.1
  });
  const sortMonth = arr => arr.sort((a, b) => new Date('1 ' + a) - new Date('1 ' + b));
  return {
    cities: Array.from(cities).sort(),
    properties: Array.from(props).sort(),
    propertyTypes: Array.from(types).sort(),
    occupancyTypes: Array.from(occ).sort(),
    months: sortMonth(Array.from(months)),
    lsSales: {
      months: sortMonth(Array.from(lsMonths)),
      moveIn: sortMonth(Array.from(lsMoveIn)),
      sources: Array.from(lsSources).sort(),
      properties: Array.from(lsProps).sort(),
      cities: Array.from(lsCities).sort()    // v8.1
    }
  };
}

function diagnose(e) {
  requireAdmin_(e);
  const out = { ok: true, build: 'v8.2', timestamp: new Date().toISOString(), currentMonth: currentMonthLabel_(), sourceId: SOURCE_SPREADSHEET_ID, sheets: {} };
  try {
    const ss = sourceSS_();
    out.sourceName = ss.getName();
    ss.getSheets().forEach(sh => { out.sheets[sh.getName()] = { rows: sh.getLastRow(), cols: sh.getLastColumn() }; });
    const mapping = getMapping();
    out.warnings = validateMapping_(mapping);
    out.mappingMetricsCount = Object.keys(mapping).length;
    out.mappingMetrics = Object.keys(mapping);
    out.metricResolution = {};
    Object.values(mapping).forEach(m => {
      const sh = ss.getSheetByName(m.sheet);
      if (!sh) { out.metricResolution[m.metric] = { error: 'sheet not found: ' + m.sheet }; return; }
      const colIdx = colLetterToIndex_(m.col);
      if (colIdx < 0 || colIdx >= sh.getLastColumn()) { out.metricResolution[m.metric] = { sheet: m.sheet, col: m.col, error: 'column out of range' }; return; }
      const lastRow = Math.min(sh.getLastRow(), 6);
      let sample = [];
      try { sample = sh.getRange(2, colIdx + 1, Math.max(lastRow - 1, 1), 1).getValues().map(r => r[0]); } catch (e) {}
      out.metricResolution[m.metric] = { sheet: m.sheet, col: m.col, type: m.type, sample: sample };
    });
    const extract = readExtract_(mapping);
    const shortSt = readShortStay_(mapping);
    const lsSales = readLSSales_(mapping);
    const dashRows = readDashboardRows_(mapping);
    out.extractRowsParsed = extract.rows.length;
    out.shortStayRowsParsed = shortSt.rows.length;
    out.lsSalesRowsParsed = lsSales.rows.length;
    out.dashboardRowsParsed = dashRows.rows.length;
    out.dashboardJunkSkipped = dashRows.skippedJunk;
    out.firstExtractRow = extract.rows[0] || null;
    out.firstShortStayRow = shortSt.rows[0] || null;
    out.firstLSSalesRow = lsSales.rows[0] || null;
    out.firstDashboardRow = dashRows.rows[0] || null;
    const statusCounts = {};
    extract.rows.forEach(r => { const s = String(r.status || '').toLowerCase().trim(); statusCounts[s] = (statusCounts[s] || 0) + 1; });
    out.statusCounts = statusCounts;
    const occTypes = {};
    extract.rows.forEach(r => { if (r.occType) occTypes[r.occType] = (occTypes[r.occType] || 0) + 1; });
    out.occupancyTypeCounts = occTypes;
    const bedCounts = {};
    extract.rows.forEach(r => { const k = String(r.beds || 0); bedCounts[k] = (bedCounts[k] || 0) + 1; });
    out.bedCountDistribution = bedCounts;
    const occRaw = {};
    extract.rows.forEach(r => { if (r.occTypeRaw) occRaw[r.occTypeRaw] = (occRaw[r.occTypeRaw] || 0) + 1; });
    out.occupancyTypeRawCounts = occRaw;
    const extractProps = new Set(extract.rows.map(r => r.property).filter(Boolean));
    const dashProps = new Set(dashRows.rows.map(r => r.property).filter(Boolean));
    const missingInDash = [];
    extractProps.forEach(p => { if (!dashProps.has(p)) missingInDash.push(p); });
    const missingInExtract = [];
    dashProps.forEach(p => { if (!extractProps.has(p)) missingInExtract.push(p); });
    out.propertyMatchAudit = {
      extractCount: extractProps.size,
      dashboardCount: dashProps.size,
      inExtractButNotDashboard: missingInDash.slice(0, 20),
      inDashboardButNotExtract: missingInExtract.slice(0, 20)
    };
    out.currentUser = { email: currentUserEmail_(e), isAdmin: isAdmin_(e) };
    out.prevMonth = getPrevMonthLSRevenue_(mapping);
    out.snapshotsAvailable = getSnapshots(90).rows.length;
    // v8.1 sanity check — target & achieved totals
    out.targetVsAchievedTotals = {
      target:   dashRows.rows.reduce(function(s, r) { return s + (Number(r.target) || 0); }, 0),
      achieved: dashRows.rows.reduce(function(s, r) { return s + (Number(r.achieved) || 0); }, 0)
    };
    // v8.1 status containing "short" for verification
    out.statusesWithShort = Object.keys(statusCounts).filter(function(k) { return k.indexOf('short') >= 0; });
  } catch (err) { out.ok = false; out.error = err.message; out.stack = err.stack; }
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
function testSourceAccess() {
  const ss = sourceSS_();
  const out = { name: ss.getName(), sheets: ss.getSheets().map(s => s.getName()), currentMonth: currentMonthLabel_() };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/* ============================================================ *
 *  SAFE CHUNKED CACHE IMPLEMENTATION (v9.0)
 * ============================================================ */
function safeCachePut_(key, obj, ttl) {
  try {
    const cache = CacheService.getScriptCache();
    const str = JSON.stringify(obj);
    const limit = 90000; // 90KB safe limit per chunk
    if (str.length < limit) {
      cache.put(key, str, ttl);
      cache.remove(key + '_chunks');
      return;
    }
    const chunks = [];
    let i = 0;
    while (i < str.length) {
      chunks.push(str.substring(i, i + limit));
      i += limit;
    }
    for (let c = 0; c < chunks.length; c++) {
      cache.put(key + '_chunk_' + c, chunks[c], ttl);
    }
    cache.put(key + '_chunks', String(chunks.length), ttl);
  } catch (e) {
    console.error('safeCachePut failed:', e);
  }
}

function safeCacheGet_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const chunksCountStr = cache.get(key + '_chunks');
    if (!chunksCountStr) {
      return cache.get(key);
    }
    const chunksCount = Number(chunksCountStr);
    if (isNaN(chunksCount) || chunksCount <= 0) return null;
    let str = '';
    for (let c = 0; c < chunksCount; c++) {
      const chunk = cache.get(key + '_chunk_' + c);
      if (!chunk) return null;
      str += chunk;
    }
    return str;
  } catch (e) {
    console.error('safeCacheGet failed:', e);
    return null;
  }
}

function safeCacheRemove_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const chunksCountStr = cache.get(key + '_chunks');
    if (chunksCountStr) {
      const count = Number(chunksCountStr);
      const keysToRemove = [key, key + '_chunks'];
      for (let c = 0; c < count; c++) keysToRemove.push(key + '_chunk_' + c);
      cache.removeAll(keysToRemove);
    } else {
      cache.removeAll([key]);
    }
  } catch (e) {
    console.error('safeCacheRemove failed:', e);
  }
}
