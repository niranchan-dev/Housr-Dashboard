import { google } from 'googleapis';

const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  ? process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n')
  : '';

if (!clientEmail || !privateKey) {
  console.warn("WARNING: Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.");
}

const auth = new google.auth.JWT(
  clientEmail,
  null,
  privateKey,
  ['https://www.googleapis.com/auth/spreadsheets']
);

export const sheets = google.sheets({ version: 'v4', auth });
export const spreadsheetId = process.env.SOURCE_SPREADSHEET_ID;

/**
 * Fetch values for multiple ranges in a single batch call.
 * Returns an object mapping range names to 2D arrays.
 * @param {string[]} ranges 
 */
export async function getSheetsData(ranges) {
  try {
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges,
    });
    const valueRanges = response.data.valueRanges || [];
    const result = {};
    ranges.forEach((range, index) => {
      const vr = valueRanges[index];
      result[range] = vr && vr.values ? vr.values : [];
    });
    return result;
  } catch (error) {
    console.error('Error in getSheetsData:', error);
    throw error;
  }
}

/**
 * Checks if a sheet exists. If not, inserts it and sets headers.
 * @param {string} sheetName 
 * @param {string[]} headers 
 */
export async function ensureSheet(sheetName, headers = []) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetExists = meta.data.sheets?.some(
      (s) => s.properties?.title === sheetName
    );

    if (sheetExists) return;

    // Create the sheet
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
              },
            },
          },
        ],
      },
    });

    // Write headers
    if (headers.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [headers],
        },
      });
    }
  } catch (error) {
    console.error(`Error in ensureSheet for "${sheetName}":`, error);
    throw error;
  }
}

/**
 * Ensures multiple sheets exist in a single metadata get check.
 * @param {Array<{name: string, headers: string[]}>} sheetDefinitions 
 */
export async function ensureRequiredSheets(sheetDefinitions) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheets = meta.data.sheets?.map(s => s.properties?.title) || [];

    for (const def of sheetDefinitions) {
      if (existingSheets.includes(def.name)) continue;

      console.log(`Creating missing sheet: ${def.name}`);
      // Create the sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: def.name,
                },
              },
            },
          ],
        },
      });

      // Write headers
      if (def.headers && def.headers.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${def.name}!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [def.headers],
          },
        });
      }
    }
  } catch (error) {
    console.error('Error in ensureRequiredSheets:', error);
    throw error;
  }
}

/**
 * Appends a row of values to a sheet.
 * @param {string} sheetName 
 * @param {any[]} values 
 */
export async function appendRow(sheetName, values) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:A`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [values],
      },
    });
  } catch (error) {
    console.error(`Error appending row to "${sheetName}":`, error);
    throw error;
  }
}

/**
 * Clears sheet contents and updates with new values (e.g. for configuration).
 * @param {string} sheetName 
 * @param {any[][]} values 
 */
export async function updateSheet(sheetName, values) {
  try {
    // Clear existing data
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });

    // Write new values
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values,
      },
    });
  } catch (error) {
    console.error(`Error updating sheet "${sheetName}":`, error);
    throw error;
  }
}
