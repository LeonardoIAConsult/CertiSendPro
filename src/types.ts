export interface Recipient {
  name: string;
  email: string;
  originalRowIndex: number;
}

export interface CertificatePage {
  pageIndex: number;
  base64: string;
  extractedName: string;
  matchedRecipient: Recipient | null;
  status: "idle" | "analyzing" | "success" | "error" | "sending" | "sent" | "send_error";
  errorMessage: string | null;
}

export interface GoogleSheetsData {
  spreadsheetId: string;
  sheetName: string;
  recipients: Recipient[];
  headers: string[];
}
