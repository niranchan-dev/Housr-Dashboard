import { getSheetsData, ensureSheet, appendRow } from "@/lib/googleSheets";

const SHEETS = {
  EXTRACT:   'Extract',
  SHORTSTAY: 'Short Stay',
  DASHBOARD: 'Dashboard',
  MAPPING:   'MappingConfig',
  SNAPSHOTS: 'Snapshots'
};

const STATUS = {
  EXCLUDED:     ['moved out', 'token cancelled'],
  NOT_FOR_SALE: ['not for sale'],
  OCCUPIED:     ['occupied', 'under notice', 'under notice booked']
};

function colLetterToIndex(letter) {
  letter = String(letter).toUpperCase().replace(/[^A-Z]/g, '');
  if (!letter) return -1;
  let n = 0; 
  for (let i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64);
  return n - 1;
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
  if (p.indexOf('total') >= 0 || p.indexOf('grand') >= 0 || p.indexOf('subtotal') >= 0) return true;
  if (p === 'sum' || p === 'count') return true;
  return false;
}

function formatDateIST(date, formatStr) {
  const d = new Date(date);
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
  return d.toISOString();
}

export async function GET(request) {
  return handleCron(request);
}

export async function POST(request) {
  return handleCron(request);
}

async function handleCron(request) {
  try {
    // 1. Verify cron authorization token
    const authHeader = request.headers.get('Authorization');
    if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized cron request' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. Ensure Snapshots tab exists
    await ensureSheet(SHEETS.SNAPSHOTS, [
      'Date', 'Total Revenue', 'LS Revenue', 'SS Revenue', 'LS Occupancy %', 'L+S Occupancy %', 'Source'
    ]);

    // 3. Batch read the required data
    const rawData = await getSheetsData([
      `${SHEETS.MAPPING}!A:E`,
      `${SHEETS.EXTRACT}!A:CZ`,
      `${SHEETS.SHORTSTAY}!A:Z`,
      `${SHEETS.DASHBOARD}!A:AC`,
      `${SHEETS.SNAPSHOTS}!A:A` // Date column to check duplicates
    ]);

    const mappingValues = rawData[`${SHEETS.MAPPING}!A:E`] || [];
    const extractValues = rawData[`${SHEETS.EXTRACT}!A:CZ`] || [];
    const shortstayValues = rawData[`${SHEETS.SHORTSTAY}!A:Z`] || [];
    const dashboardValues = rawData[`${SHEETS.DASHBOARD}!A:AC`] || [];
    const snapshotDates = (rawData[`${SHEETS.SNAPSHOTS}!A:A`] || []).slice(1).map(r => r[0]);

    // 4. Parse mapping
    const mapping = {};
    mappingValues.slice(1).filter(r => r[0]).forEach(r => {
      mapping[String(r[0]).trim()] = {
        metric: String(r[0]).trim(),
        sheet:  String(r[1]).trim(),
        col:    String(r[2]).trim().toUpperCase(),
        type:   String(r[3] || 'dimension').trim().toLowerCase()
      };
    });

    const get = m => mapping[m] ? colLetterToIndex(mapping[m].col) : -1;
    const idxExtract = {
      status: get('Property'), // Wait, mapping has keys like 'Status'
      statusKey: get('Status'),
      beds: get('Bed Count'),
      revenue: get('Revenue (Long Stay)')
    };

    const idxShort = {
      property: get('Short Stay Property'),
      revenue: get('Short Stay Revenue'),
      month: get('Short Stay Month'),
      year: get('Short Stay Date'),
      nights: get('Short Stay Nights')
    };

    const idxDash = {
      property: get('Dashboard Property'),
      ssbo: get('Short Stay Beds Occupied')
    };

    // Prevent duplicate snapshots for today
    const todayStr = formatDateIST(new Date(), 'yyyy-MM-dd');
    const duplicate = snapshotDates.some(d => {
      if (!d) return false;
      const parsed = new Date(d);
      return !isNaN(parsed.getTime()) && formatDateIST(parsed, 'yyyy-MM-dd') === todayStr;
    });

    if (duplicate) {
      return new Response(JSON.stringify({ ok: true, message: 'Snapshot already written for today.', date: todayStr }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 5. Compute Extract Long Stay values
    let lsRev = 0, sellable = 0, occupied = 0;
    extractValues.slice(1).forEach(r => {
      const st = idxExtract.statusKey >= 0 && idxExtract.statusKey < r.length 
        ? String(r[idxExtract.statusKey]).toLowerCase().trim() 
        : '';
      if (STATUS.EXCLUDED.includes(st)) return;
      const beds = idxExtract.beds >= 0 && idxExtract.beds < r.length 
        ? toNum(r[idxExtract.beds]) 
        : 0;
      if (!STATUS.NOT_FOR_SALE.includes(st)) sellable += beds;
      if (STATUS.OCCUPIED.includes(st)) occupied += beds;

      const rev = idxExtract.revenue >= 0 && idxExtract.revenue < r.length 
        ? toNum(r[idxExtract.revenue]) 
        : 0;
      lsRev += rev;
    });

    // 6. Compute Short Stay Revenue
    const nowY = new Date().getFullYear();
    const nowM = new Date().getMonth() + 1;
    const currentMonthLabel = formatDateIST(new Date(), 'MMM-yyyy');
    let ssRev = 0;

    shortstayValues.slice(1).forEach(r => {
      let isCurrentMonth = false;
      if (idxShort.year >= 0 && idxShort.year < r.length && r[idxShort.year]) {
        const d = new Date(r[idxShort.year]);
        if (!isNaN(d.getTime()) && d.getFullYear() === nowY && (d.getMonth() + 1) === nowM) {
          isCurrentMonth = true;
        }
      } else if (idxShort.month >= 0 && idxShort.month < r.length && r[idxShort.month]) {
        if (String(r[idxShort.month]).trim() === currentMonthLabel) {
          isCurrentMonth = true;
        }
      }

      if (isCurrentMonth) {
        ssRev += idxShort.revenue >= 0 && idxShort.revenue < r.length ? toNum(r[idxShort.revenue]) : 0;
      }
    });

    // 7. Compute Dashboard Short Stay occupancy beds
    let ssOccBeds = 0;
    dashboardValues.slice(1).forEach(r => {
      const prop = idxDash.property >= 0 && idxDash.property < r.length ? r[idxDash.property] : '';
      if (isJunkDashboardRow(prop)) return;
      const ssbo = idxDash.ssbo >= 0 && idxDash.ssbo < r.length ? toNum(r[idxDash.ssbo]) : 0;
      ssOccBeds += ssbo;
    });

    // 8. Calculate Occupancies
    const lsOcc = sellable ? occupied / sellable : 0;
    const blendedOcc = sellable ? (occupied + ssOccBeds) / sellable : 0;
    const totalRev = lsRev + ssRev;

    // 9. Append Row
    await appendRow(SHEETS.SNAPSHOTS, [
      new Date().toISOString(),
      totalRev,
      lsRev,
      ssRev,
      lsOcc,
      blendedOcc,
      'cron-trigger'
    ]);

    return new Response(JSON.stringify({
      ok: true,
      message: 'Daily snapshot backup completed successfully.',
      date: todayStr,
      snapshot: { totalRev, lsRev, ssRev, lsOcc, blendedOcc }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error running daily cron snapshot:', error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
