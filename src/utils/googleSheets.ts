import { Recipient } from "../types";

// Extract Spreadsheet ID from Google Sheets URLs
export function extractSpreadsheetId(urlOrId: string): string | null {
  if (!urlOrId) return null;
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  // If it's already a clean ID, return it
  if (/^[a-zA-Z0-9-_]{15,100}$/.test(urlOrId.trim())) {
    return urlOrId.trim();
  }
  return null;
}

// Fetch available Sheets (Tabs) for a spreadsheet ID
export async function fetchSpreadsheetTabs(
  spreadsheetId: string,
  accessToken: string
): Promise<string[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(title))`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || "Error al obtener hojas del documento");
  }

  const data = await response.json();
  const sheets = data.sheets || [];
  return sheets.map((s: any) => s.properties?.title).filter(Boolean);
}

// Fetch values from a spreadsheet and parse recipients based on header definitions
export async function fetchSpreadsheetRecipients(
  spreadsheetId: string,
  sheetName: string,
  nameColumnIndex: number,
  emailColumnIndex: number,
  accessToken: string
): Promise<{ recipients: Recipient[]; headers: string[] }> {
  // Fetch up to 1000 rows to keep it high performance
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(sheetName)}'!A1:Z1000`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || "Error al recuperar filas de la hoja");
  }

  const data = await response.json();
  const rows: string[][] = data.values || [];

  if (rows.length === 0) {
    return { recipients: [], headers: [] };
  }

  const headers = rows[0];
  const recipients: Recipient[] = [];

  // Parse remaining rows starting at index 1
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawName = row[nameColumnIndex]?.trim() || "";
    const rawEmail = row[emailColumnIndex]?.trim() || "";

    // Skip empty records
    if (rawName || rawEmail) {
      recipients.push({
        name: rawName,
        email: rawEmail,
        originalRowIndex: i + 1, // Store Excel-like row index
      });
    }
  }

  return { recipients, headers };
}
