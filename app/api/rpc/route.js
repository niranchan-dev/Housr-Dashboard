import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { getSheetsData, ensureSheet, appendRow, updateSheet, spreadsheetId, ensureRequiredSheets as ensureRequiredSheetsLib } from "../../../lib/googleSheets";

// Sheets naming convention
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
  ['Occupancy Type',              'Extract',    'T',  'dimension', 'Reference reference — derived Solo/Twin from bed count (U)'],
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

// Simple in-memory cache for API requests
let cacheData = null;
let cacheExpiry = 0;

// Date Formatter in IST
function formatDate(date, formatStr) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";

  const tzOptions = { timeZone: 'Asia/Kolkata' };
  
  if (formatStr === 'yyyy-MM-dd') {
    const year = d.toLocaleDateString('en-US', { ...tzOptions, year: 'numeric' });
    const month = d.toLocaleDateString('en-US', { ...tzOptions, month: '2-digit' });
    const day = d.toLocaleDateString('en-US', { ...tzOptions, day: '2-digit' });
    return `${year}-${month}-${day}`;
  }
  
  if (formatStr === 'MMM-yyyy') {
    const month = d.toLocaleDateString('en-US', { ...tzOptions, month: 'short' });
    const year = d.toLocaleDateString('en-US', { ...tzOptions, year: 'numeric' });
    return `${month}-${year}`;
  }
  
  if (formatStr === 'yyyy-MM-dd HH:mm:ss') {
    const datePart = d.toLocaleDateString('en-US', { ...tzOptions, year: 'numeric', month: '2-digit', day: '2-digit' });
    const timePart = d.toLocaleTimeString('en-US', { ...tzOptions, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const [m, dy, y] = datePart.split('/');
    return `${y}-${m}-${dy} ${timePart}`;
  }
  
  return d.toISOString();
}

function colLetterToIndex(letter) {
  letter = String(letter).toUpperCase().replace(/[^A-Z]/g, '');
  if (!letter) return -1;
  let n = 0; 
  for (let i = 0; i < letter.length; i++) {
    n = n * 26 + (letter.charCodeAt(i) - 64);
  }
  return n - 1;
}

function colIndexToLetter(idx) {
  let s = '', n = idx + 1;
  while (n > 0) { 
    let r = (n - 1) % 26; 
    s = String.fromCharCode(65 + r) + s; 
    n = Math.floor((n - 1) / 26); 
  }
  return s;
}

function prevColLetter(currentLetter) {
  if (!currentLetter) return '';
  const idx = colLetterToIndex(currentLetter);
  if (idx <= 0) return '';
  return colIndexToLetter(idx - 1);
}

function toNum(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[, ₹$%]/g, ''));
  return isNaN(n) ? 0 : n;
}

function normDim(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

function isJunkDashboardRow(propertyCell) {
  const p = String(propertyCell || '').trim().toLowerCase();
  if (!p) return true;
  if (p.indexOf('total') >= 0) return true;
  if (p.indexOf('grand') >= 0) return true;
  if (p.indexOf('subtotal') >= 0) return true;
  if (p === 'sum' || p === 'count') return true;
  return false;
}

// Ensure database sheets exist
async function ensureRequiredSheets() {
  await ensureRequiredSheetsLib([
    { name: SHEETS.MAPPING, headers: ['Metric', 'Sheet', 'Column', 'Type', 'Notes'] },
    { name: SHEETS.AUDIT, headers: ['Timestamp', 'Date', 'Email', 'Display Name'] },
    { name: SHEETS.SNAPSHOTS, headers: ['Date', 'Total Revenue', 'LS Revenue', 'SS Revenue', 'LS Occupancy %', 'L+S Occupancy %', 'Source'] }
  ]);
}

// -------------------------------------------------------------
// Sheet parsing functions
// -------------------------------------------------------------

function parseMapping(values) {
  const map = {};
  // If the sheet was empty, seed defaults
  const rows = values.length > 1 ? values.slice(1) : DEFAULT_MAPPING;
  rows.filter(r => r[0]).forEach(r => {
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

function parseExtract(values, mapping) {
  if (values.length < 2) return { rows: [], reason: 'Extract has no data rows' };
  const headers = values[0];
  const body = values.slice(1);

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

  const get = m => mapping[m] ? colLetterToIndex(mapping[m].col) : -1;
  const idx = {
    property: get('Property'), city: get('City'),
    propType: get('Property Type'), occType: get('Occupancy Type'),
    status: get('Status'), bedCount: get('Bed Count'),
    tenure: get('Tenure (Days)'), rent: get('Contracted Rent'),
    revenue: get('Revenue (Long Stay)'), gst: get('GST')
  };
  
  let lastCity = '';
  const rows = body.map(r => {
    let city = idx.city >= 0 && idx.city < r.length ? normDim(r[idx.city]) : '';
    if (!city) city = lastCity; else lastCity = city;
    return {
      property: idx.property >= 0 && idx.property < r.length ? normDim(r[idx.property]) : '',
      city: city,
      propType: idx.propType >= 0 && idx.propType < r.length ? normDim(r[idx.propType]) : '',
      occType: (function() {
        var bc = idx.bedCount >= 0 && idx.bedCount < r.length ? toNum(r[idx.bedCount]) : 0;
        if (bc === 2) return 'Solo';
        if (bc === 1) return 'Twin';
        return '';
      })(),
      occTypeRaw: idxOccCV >= 0 && idxOccCV < r.length ? normDim(r[idxOccCV]) : (idx.occType >= 0 && idx.occType < r.length ? normDim(r[idx.occType]) : ''),
      status: idx.status >= 0 && idx.status < r.length ? String(r[idx.status] || '').trim() : '',
      beds: idx.bedCount >= 0 && idx.bedCount < r.length ? toNum(r[idx.bedCount]) : 0,
      tenure: idx.tenure >= 0 && idx.tenure < r.length ? toNum(r[idx.tenure]) : 0,
      rent: idxRentCC >= 0 && idxRentCC < r.length ? toNum(r[idxRentCC]) : (idx.rent >= 0 && idx.rent < r.length ? toNum(r[idx.rent]) : 0),
      revenue: idx.revenue >= 0 && idx.revenue < r.length ? toNum(r[idx.revenue]) : 0,
      gst: idx.gst >= 0 && idx.gst < r.length ? toNum(r[idx.gst]) : 0,
      flat: r.length > 6 ? String(r[6] || '').trim() : '',
      bed: r.length > 7 ? String(r[7] || '').trim() : '',
      statusRaw: r.length > 8 ? String(r[8] || '').trim() : '',
      propertyCR: r.length > 95 ? normDim(r[95]) : '',
      residentName: idxResName >= 0 && idxResName < r.length ? String(r[idxResName] || '').trim() : '',
      phone: idxPhone >= 0 && idxPhone < r.length ? String(r[idxPhone] || '').trim() : '',
      email: idxEmail >= 0 && idxEmail < r.length ? String(r[idxEmail] || '').trim() : '',
      moveIn: idxMoveIn >= 0 && idxMoveIn < r.length ? (r[idxMoveIn] ? formatDate(new Date(r[idxMoveIn]), 'yyyy-MM-dd') : '') : '',
      moveOut: idxMoveOut >= 0 && idxMoveOut < r.length ? (r[idxMoveOut] ? formatDate(new Date(r[idxMoveOut]), 'yyyy-MM-dd') : '') : ''
    };
  }).filter(r => r.property || r.city || r.status || r.beds > 0 || r.rent > 0);
  
  return { rows: rows, totalSourceRows: body.length };
}

function parseShortStay(values, mapping) {
  if (values.length < 2) return { rows: [], reason: 'Short Stay has no data rows' };
  const body = values.slice(1);
  const get = m => mapping[m] ? colLetterToIndex(mapping[m].col) : -1;
  const idx = {
    property: get('Short Stay Property'), date: get('Short Stay Date'),
    source: get('Short Stay Source'), revenue: get('Short Stay Revenue'),
    month: get('Short Stay Month'), city: get('Short Stay City'),
    nights: get('Short Stay Nights')
  };
  const rows = body.map(r => {
    let dateIso = null, y = null, m = null;
    if (idx.date >= 0 && idx.date < r.length) {
      const d = r[idx.date];
      if (d) { 
        const p = new Date(d); 
        if (!isNaN(p.getTime())) { 
          dateIso = formatDate(p, 'yyyy-MM-dd'); 
          y = p.getFullYear(); 
          m = p.getMonth() + 1; 
        } 
      }
    }
    let monthLabel = '';
    if (dateIso) {
      const p = new Date(dateIso + 'T00:00:00');
      monthLabel = formatDate(p, 'MMM-yyyy');
    } else if (idx.month >= 0 && idx.month < r.length) {
      const mv = r[idx.month];
      if (mv) {
        const p = new Date('1 ' + String(mv).replace('-', ' '));
        if (!isNaN(p.getTime())) { 
          monthLabel = formatDate(p, 'MMM-yyyy'); 
          y = p.getFullYear(); 
          m = p.getMonth() + 1; 
        } else {
          monthLabel = String(mv).trim();
        }
      }
    }
    return {
      property: idx.property >= 0 && idx.property < r.length ? normDim(r[idx.property]) : '',
      date: dateIso, year: y, monthNum: m,
      source: idx.source >= 0 && idx.source < r.length ? (normDim(r[idx.source]) || 'Direct') : 'Direct',
      revenue: idx.revenue >= 0 && idx.revenue < r.length ? toNum(r[idx.revenue]) : 0,
      month: monthLabel,
      city: idx.city >= 0 && idx.city < r.length ? normDim(r[idx.city]) : '',
      nights: idx.nights >= 0 && idx.nights < r.length ? toNum(r[idx.nights]) : 0
    };
  }).filter(r => r.month || r.city || r.property || r.revenue);
  
  return { rows: rows, totalSourceRows: body.length };
}

function parseLSSales(values, mapping) {
  if (values.length < 2) return { rows: [], reason: 'LS Sales has no data rows' };
  const body = values.slice(1);
  const get = k => mapping[k] ? colLetterToIndex(mapping[k].col) : -1;
  const idx = {
    date: get('LS Sales Date'), value: get('LS Sales Value'),
    owner: get('LS Sales Owner'), ownerAlt: get('LS Sales Owner Alt'),
    city: get('LS Sales City'), source: get('LS Sales Source'),
    beds: get('LS Sales Beds'), month: get('LS Sales Month'),
    property: get('LS Sales Property'), moveIn: get('LS Sales Move In Month'),
    prorated: get('LS Sales Prorated Rent')
  };
  const safeMonth = v => {
    if (!v) return { label: '', y: null, m: null };
    const p = new Date('1 ' + String(v).replace('-', ' '));
    if (!isNaN(p.getTime())) return { label: formatDate(p, 'MMM-yyyy'), y: p.getFullYear(), m: p.getMonth() + 1 };
    return { label: String(v).trim(), y: null, m: null };
  };
  const rows = body.map(r => {
    let dateIso = null, y = null, mn = null;
    if (idx.date >= 0 && idx.date < r.length) {
      const d = r[idx.date];
      if (d) { 
        const p = new Date(d); 
        if (!isNaN(p.getTime())) { 
          dateIso = formatDate(p, 'yyyy-MM-dd'); 
          y = p.getFullYear(); 
          mn = p.getMonth() + 1; 
        } 
      }
    }
    let monthInfo = { label: '', y: null, m: null };
    let moveInInfo = idx.moveIn >= 0 && idx.moveIn < r.length ? safeMonth(r[idx.moveIn]) : { label: '', y: null, m: null };
    if (dateIso) {
      const p = new Date(dateIso + 'T00:00:00');
      monthInfo = { label: formatDate(p, 'MMM-yyyy'), y: p.getFullYear(), m: p.getMonth() + 1 };
    } else if (idx.month >= 0 && idx.month < r.length) {
      monthInfo = safeMonth(r[idx.month]);
    }
    let owner = idx.owner >= 0 && idx.owner < r.length ? normDim(r[idx.owner]) : '';
    if (!owner && idx.ownerAlt >= 0 && idx.ownerAlt < r.length) owner = normDim(r[idx.ownerAlt]);
    return {
      date: dateIso, year: y, monthNum: mn,
      value: idx.value >= 0 && idx.value < r.length ? toNum(r[idx.value]) : 0,
      prorated: idx.prorated >= 0 && idx.prorated < r.length ? toNum(r[idx.prorated]) : 0,
      owner: owner || 'Unknown',
      city: idx.city >= 0 && idx.city < r.length ? normDim(r[idx.city]) : '',
      source: idx.source >= 0 && idx.source < r.length ? (normDim(r[idx.source]) || 'Direct') : 'Direct',
      beds: idx.beds >= 0 && idx.beds < r.length ? toNum(r[idx.beds]) : 0,
      property: idx.property >= 0 && idx.property < r.length ? normDim(r[idx.property]) : '',
      month: monthInfo.label, monthY: monthInfo.y, monthM: monthInfo.m,
      moveIn: moveInInfo.label, moveInY: moveInInfo.y, moveInM: moveInInfo.m
    };
  }).filter(r => r.date || r.value || r.property || r.city || r.beds);
  
  return { rows: rows, totalSourceRows: body.length };
}

function parseDashboardRows(values, mapping) {
  if (values.length < 2) return { rows: [], reason: 'Dashboard has no data rows', skippedJunk: 0 };
  const body = values.slice(1);
  const get = k => mapping[k] ? colLetterToIndex(mapping[k].col) : -1;
  const idx = {
    property: get('Dashboard Property'),
    city:     get('Dashboard City'),
    propType: get('Dashboard Property Type'),
    vsf:      get('Vacant Sales Focus'),
    ssbo:     get('Short Stay Beds Occupied'),
    target:   get('Dashboard Target'),
    achieved: get('Dashboard Achieved')
  };
  let lastCity = '', skipped = 0;
  const rows = body.map(r => {
    const rawProp = idx.property >= 0 && idx.property < r.length ? r[idx.property] : '';
    if (isJunkDashboardRow(rawProp)) { skipped++; return null; }
    let city = idx.city >= 0 && idx.city < r.length ? normDim(r[idx.city]) : '';
    if (!city) city = lastCity; else lastCity = city;
    return {
      property: normDim(rawProp),
      city: city,
      propType: idx.propType >= 0 && idx.propType < r.length ? normDim(r[idx.propType]) : '',
      vsf:      idx.vsf      >= 0 && idx.vsf      < r.length ? toNum(r[idx.vsf])      : 0,
      ssbo:     idx.ssbo     >= 0 && idx.ssbo     < r.length ? toNum(r[idx.ssbo])     : 0,
      target:   idx.target   >= 0 && idx.target   < r.length ? toNum(r[idx.target])   : 0,
      achieved: idx.achieved >= 0 && idx.achieved < r.length ? toNum(r[idx.achieved]) : 0
    };
  }).filter(Boolean);
  
  return { rows: rows, totalSourceRows: body.length, skippedJunk: skipped };
}

function parseSnapshots(values) {
  if (values.length < 2) return [];
  return values.slice(1).map(r => {
    const d = r[0] ? new Date(r[0]) : new Date();
    return {
      date: isNaN(d.getTime()) ? String(r[0]) : formatDate(d, 'yyyy-MM-dd'),
      totalRev: Number(r[1]) || 0,
      lsRev: Number(r[2]) || 0,
      ssRev: Number(r[3]) || 0,
      lsOcc: Number(r[4]) || 0,
      blendedOcc: Number(r[5]) || 0
    };
  }).filter(r => r.date).sort((a, b) => a.date.localeCompare(b.date));
}

function sumExtractColumn(values, colLetter) {
  if (!colLetter) return 0;
  try {
    const ci = colLetterToIndex(colLetter);
    if (values.length < 2 || ci < 0) return 0;
    let sum = 0;
    values.slice(1).forEach(r => {
      if (ci < r.length) sum += toNum(r[ci]);
    });
    return sum;
  } catch (e) {
    return 0;
  }
}

function getPrevMonthLSRevenue(extractValues, mapping) {
  const currentCol = (mapping['Revenue (Long Stay)'] || {}).col || '';
  const prevCol = prevColLetter(currentCol);
  if (!prevCol) return { value: 0, column: '', label: '' };
  
  const value = sumExtractColumn(extractValues, prevCol);
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const label = formatDate(d, 'MMM-yyyy');
  return { value: value, column: prevCol, label: label };
}

function buildFilterOptions(extract, shortSt, lsSales, dashRows) {
  const cities = new Set(), props = new Set(), types = new Set(), occ = new Set(), months = new Set();
  const lsMonths = new Set(), lsMoveIn = new Set(), lsSources = new Set(), lsProps = new Set();
  const lsCities = new Set();
  
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
  dashRows.rows.forEach(r => {
    addCity(cities, r.city);
    if (r.property) props.add(r.property);
    if (r.propType) types.add(r.propType);
  });
  lsSales.rows.forEach(r => {
    if (r.month)    lsMonths.add(r.month);
    if (r.moveIn)   lsMoveIn.add(r.moveIn);
    if (r.source)   lsSources.add(r.source);
    if (r.property) lsProps.add(r.property);
    addCity(lsCities, r.city);
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
      cities: Array.from(lsCities).sort()
    }
  };
}

// -------------------------------------------------------------
// Core Actions Implementation
// -------------------------------------------------------------

// Simple in-memory cache for audit log debouncing (1 hour)
const auditCache = new Map();
let lastSnapshotDate = '';

async function fetchDashboardBundle(email, isAdmin, force = false) {
  if (!force && cacheData && Date.now() < cacheExpiry) {
    const obj = { ...cacheData };
    obj.isAdmin = isAdmin;
    obj.userEmail = email;
    obj.cacheHit = true;
    return obj;
  }

  let rawData;
  try {
    // Unified batch read of all sheets in a single call
    rawData = await getSheetsData([
      `${SHEETS.MAPPING}!A:E`,
      `${SHEETS.EXTRACT}!A:CZ`,
      `${SHEETS.SHORTSTAY}!A:Z`,
      `${SHEETS.LSSALES}!A:EJ`,
      `${SHEETS.DASHBOARD}!A:AC`,
      `${SHEETS.SNAPSHOTS}!A:G`
    ]);
  } catch (error) {
    const errorMsg = String(error.message || '').toLowerCase();
    if (errorMsg.includes('not found') || errorMsg.includes('range') || error.status === 400) {
      console.warn("Required sheet missing during read, running ensureRequiredSheets...");
      await ensureRequiredSheets();
      // Retry once
      rawData = await getSheetsData([
        `${SHEETS.MAPPING}!A:E`,
        `${SHEETS.EXTRACT}!A:CZ`,
        `${SHEETS.SHORTSTAY}!A:Z`,
        `${SHEETS.LSSALES}!A:EJ`,
        `${SHEETS.DASHBOARD}!A:AC`,
        `${SHEETS.SNAPSHOTS}!A:G`
      ]);
    } else {
      throw error;
    }
  }

  const mappingValues = rawData[`${SHEETS.MAPPING}!A:E`] || [];
  const extractValues = rawData[`${SHEETS.EXTRACT}!A:CZ`] || [];
  const shortstayValues = rawData[`${SHEETS.SHORTSTAY}!A:Z`] || [];
  const lssalesValues = rawData[`${SHEETS.LSSALES}!A:EJ`] || [];
  const dashboardValues = rawData[`${SHEETS.DASHBOARD}!A:AC`] || [];
  const snapshotValues = rawData[`${SHEETS.SNAPSHOTS}!A:G`] || [];

  const mapping = parseMapping(mappingValues);
  
  // Validation Warnings
  const warnings = [];
  const ssHeaders = extractValues[0] || [];
  Object.values(mapping).forEach(m => {
    // Basic verification of column letters range
    const ci = colLetterToIndex(m.col);
    if (ci < 0) {
      warnings.push(`${m.metric}: invalid column mapping "${m.col}"`);
    }
  });

  const extract = parseExtract(extractValues, mapping);
  const shortStay = parseShortStay(shortstayValues, mapping);
  const lsSales = parseLSSales(lssalesValues, mapping);
  const dashRows = parseDashboardRows(dashboardValues, mapping);
  const snapshots = parseSnapshots(snapshotValues);

  // Write snapshot for load access background
  try {
    await writeDailySnapshot(email, mapping, extract, shortStay, dashRows, snapshots, 'dashboard-load');
  } catch (e) {
    console.error('Failed writing dashboard snapshot:', e);
  }

  const prevMonth = getPrevMonthLSRevenue(extractValues, mapping);

  const dimIndex = {};
  extract.rows.forEach(r => { if (r.property && !dimIndex[r.property]) dimIndex[r.property] = { city: r.city || '', type: r.propType || '' }; });
  dashRows.rows.forEach(r => { if (r.property && !dimIndex[r.property]) dimIndex[r.property] = { city: r.city || '', type: r.propType || '' }; });
  shortStay.rows.forEach(r => { if (r.property && !dimIndex[r.property]) dimIndex[r.property] = { city: r.city || '', type: '' }; });

  const sharedBundle = {
    ok: true,
    build: 'v8.2',
    generatedAt: new Date().toISOString(),
    currentMonthLabel: formatDate(new Date(), 'MMM-yyyy'),
    today: formatDate(new Date(), 'yyyy-MM-dd'),
    yesterday: formatDate(new Date(Date.now() - 86400000), 'yyyy-MM-dd'),
    revenueColumn: (mapping['Revenue (Long Stay)'] || {}).col || '?',
    source: spreadsheetId,
    warnings: warnings,
    mapping: mapping,
    extract: extract,
    shortStay: shortStay,
    lsSales: lsSales,
    dashboardRows: dashRows,
    dimensionIndex: dimIndex,
    filters: buildFilterOptions(extract, shortStay, lsSales, dashRows),
    prevMonth: prevMonth,
    snapshots: snapshots.slice(-90),
    counts: {
      extractRows: extract.rows.length,
      shortStayRows: shortStay.rows.length,
      lsSalesRows: lsSales.rows.length,
      dashboardRows: dashRows.rows.length,
      mappedMetrics: Object.keys(mapping).length,
      skippedDashboardJunk: dashRows.skippedJunk || 0
    }
  };

  // Cache data for 5 minutes
  cacheData = { ...sharedBundle };
  cacheExpiry = Date.now() + (300 * 1000);

  sharedBundle.isAdmin = isAdmin;
  sharedBundle.userEmail = email;
  sharedBundle.cacheHit = false;
  return sharedBundle;
}

// Write snapshot backup row
async function writeDailySnapshot(email, mapping, extract, shortStay, dashRows, snapshots, source = 'manual') {
  const todayStr = formatDate(new Date(), 'yyyy-MM-dd');

  // Fast check: did we already verify/write the snapshot today?
  if (lastSnapshotDate === todayStr && source === 'dashboard-load') {
    return { written: false, reason: 'already-snapshotted-today', date: todayStr };
  }

  // Check if today already has a snapshot in the spreadsheets list
  const exists = snapshots.some(s => s.date === todayStr);
  if (exists) {
    if (source === 'dashboard-load') {
      lastSnapshotDate = todayStr;
    }
    return { written: false, reason: 'already-snapshotted-today', date: todayStr };
  }

  let lsRev = 0, sellable = 0, occupied = 0;
  extract.rows.forEach(r => {
    const st = String(r.status || '').toLowerCase();
    if (STATUS.EXCLUDED.includes(st)) return;
    const beds = Number(r.beds) || 0;
    if (!STATUS.NOT_FOR_SALE.includes(st)) sellable += beds;
    if (STATUS.OCCUPIED.includes(st)) occupied += beds;
    lsRev += Number(r.revenue) || 0;
  });

  const nowY = new Date().getFullYear();
  const nowM = new Date().getMonth() + 1;
  const currentMonth = formatDate(new Date(), 'MMM-yyyy');
  let ssRev = 0;
  shortStay.rows.forEach(r => {
    if ((r.year === nowY && r.monthNum === nowM) || r.month === currentMonth) {
      ssRev += Number(r.revenue) || 0;
    }
  });

  let ssOccBeds = 0;
  dashRows.rows.forEach(r => { ssOccBeds += Number(r.ssbo) || 0; });

  const lsOcc = sellable ? occupied / sellable : 0;
  const blendedOcc = sellable ? (occupied + ssOccBeds) / sellable : 0;
  const total = lsRev + ssRev;

  await appendRow(SHEETS.SNAPSHOTS, [
    new Date().toISOString(),
    total,
    lsRev,
    ssRev,
    lsOcc,
    blendedOcc,
    source
  ]);

  if (source === 'dashboard-load') {
    lastSnapshotDate = todayStr;
  }

  return {
    written: true,
    date: todayStr,
    snapshot: { totalRev: total, lsRev, ssRev, lsOcc, blendedOcc }
  };
}

async function writeAuditAccess(email) {
  const cacheKey = email || '(anonymous)';
  const now = Date.now();
  const cachedTime = auditCache.get(cacheKey);
  
  if (cachedTime && now - cachedTime < 3600 * 1000) {
    // Debounce: already logged this user within the last hour
    return;
  }
  
  // Set cache timestamp
  auditCache.set(cacheKey, now);

  const dateStr = formatDate(new Date(), 'yyyy-MM-dd');
  const displayName = cacheKey === '(anonymous)' ? 'Anonymous'
    : cacheKey.split('@')[0].replace(/[._\-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  await appendRow(SHEETS.AUDIT, [
    new Date().toISOString(),
    dateStr,
    cacheKey,
    displayName
  ]);
}

// -------------------------------------------------------------
// POST / GET HTTP Handlers
// -------------------------------------------------------------

export async function GET(request) {
  return handleRequest(request);
}

export async function POST(request) {
  return handleRequest(request);
}

async function handleRequest(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const email = session.user.email || "";
    const isAdmin = !!session.user.isAdmin;

    // Log access
    try {
      await writeAuditAccess(email);
    } catch (e) {
      console.error('Audit logging failed:', e);
    }

    // Extract search parameters
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (!action) {
      return new Response(JSON.stringify({ ok: false, error: 'No action parameter provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Guard Admin Actions
    const adminOnlyActions = ['getAudit', 'saveMapping', 'resetMapping', 'diagnose', 'getLogic'];
    if (adminOnlyActions.includes(action) && !isAdmin) {
      return new Response(JSON.stringify({ ok: false, error: 'Admin access required. Signed in as: ' + email }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let result = null;

    switch (action) {
      case 'getData':
      case 'getDashboardData': {
        const force = searchParams.get('force') === 'true';
        result = await fetchDashboardBundle(email, isAdmin, force);
        break;
      }
      
      case 'refreshData': {
        cacheData = null; // Clear cache
        result = await fetchDashboardBundle(email, isAdmin, true);
        break;
      }

      case 'getLogic':
      case 'getLogicReference': {
        const rawData = await getSheetsData([`${SHEETS.LOGIC}!A:Z`]);
        result = rawData[`${SHEETS.LOGIC}!A:Z`] || [];
        break;
      }

      case 'getAudit':
      case 'getAuditLog': {
        const from = searchParams.get('from') || '';
        const to = searchParams.get('to') || '';
        const q = searchParams.get('q') || '';

        const rawData = await getSheetsData([`${SHEETS.AUDIT}!A2:D`]);
        const auditRows = rawData[`${SHEETS.AUDIT}!A2:D`] || [];

        let rows = auditRows.map(r => {
          const ts = r[0] ? new Date(r[0]) : null;
          const date = ts ? formatDate(ts, 'yyyy-MM-dd') : String(r[1] || '');
          return {
            timestamp: ts ? ts.toISOString() : '',
            timestampDisplay: ts ? formatDate(ts, 'yyyy-MM-dd HH:mm:ss') : '',
            date: date,
            email: String(r[2] || ''),
            displayName: String(r[3] || '')
          };
        }).filter(r => r.email);

        const totalEntries = rows.length;
        if (from) rows = rows.filter(r => r.date >= from);
        if (to)   rows = rows.filter(r => r.date <= to);
        if (q) {
          const lq = q.toLowerCase();
          rows = rows.filter(r => r.email.toLowerCase().includes(lq) || r.displayName.toLowerCase().includes(lq));
        }

        // Sort descending by timestamp
        rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        const uniq = {};
        rows.forEach(r => { uniq[r.email] = (uniq[r.email] || 0) + 1; });
        const topUsers = Object.keys(uniq).map(k => ({ email: k, count: uniq[k] }))
          .sort((a, b) => b.count - a.count).slice(0, 10);

        result = {
          ok: true,
          rows: rows.slice(0, 2000),
          totalRows: rows.length,
          uniqueUsers: Object.keys(uniq).length,
          totalEntries: totalEntries,
          topUsers: topUsers
        };
        break;
      }

      case 'saveMapping': {
        let rows = [];
        if (request.method === 'POST') {
          const body = await request.json();
          rows = body.rows || [];
        } else {
          const rowsStr = searchParams.get('rows');
          if (rowsStr) rows = JSON.parse(rowsStr);
        }

        const formattedRows = rows.map(r => [
          r.metric || '', 
          r.sheet || '', 
          (r.col || '').toUpperCase(), 
          r.type || 'dimension', 
          r.notes || ''
        ]);

        await ensureRequiredSheets();
        await updateSheet(SHEETS.MAPPING, [
          ['Metric', 'Sheet', 'Column', 'Type', 'Notes'],
          ...formattedRows
        ]);

        cacheData = null; // Invalidate cache
        result = { ok: true };
        break;
      }

      case 'resetMapping': {
        await ensureRequiredSheets();
        await updateSheet(SHEETS.MAPPING, [
          ['Metric', 'Sheet', 'Column', 'Type', 'Notes'],
          ...DEFAULT_MAPPING
        ]);
        cacheData = null; // Invalidate cache
        result = { ok: true, seeded: DEFAULT_MAPPING.length };
        break;
      }

      case 'diagnose': {
        const rawData = await getSheetsData([
          `${SHEETS.MAPPING}!A:E`,
          `${SHEETS.EXTRACT}!A:G`,
          `${SHEETS.SHORTSTAY}!A:G`,
          `${SHEETS.LSSALES}!A:G`,
          `${SHEETS.DASHBOARD}!A:G`
        ]);

        const mappingValues = rawData[`${SHEETS.MAPPING}!A:E`] || [];
        const mapping = parseMapping(mappingValues);

        result = {
          ok: true,
          build: 'v8.2',
          timestamp: new Date().toISOString(),
          currentMonth: formatDate(new Date(), 'MMM-yyyy'),
          sourceId: spreadsheetId,
          mappingMetricsCount: Object.keys(mapping).length,
          extractSample: rawData[`${SHEETS.EXTRACT}!A:G`]?.slice(0, 5) || [],
          shortStaySample: rawData[`${SHEETS.SHORTSTAY}!A:G`]?.slice(0, 5) || [],
          lsSalesSample: rawData[`${SHEETS.LSSALES}!A:G`]?.slice(0, 5) || [],
          dashboardSample: rawData[`${SHEETS.DASHBOARD}!A:G`]?.slice(0, 5) || [],
          currentUser: { email, isAdmin }
        };
        break;
      }

      default:
        return new Response(JSON.stringify({ ok: false, error: 'Unknown action: ' + action }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error handling RPC route:', error);
    return new Response(JSON.stringify({ ok: false, error: error.message, stack: error.stack }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
