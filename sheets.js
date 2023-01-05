import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/**
 * Create an GoogleAuth client with the given credentials
 */
function authorize() {
    const auth = new google.auth.GoogleAuth({
        keyFile: 'credentials.json',
        scopes: SCOPES,
    });
    return auth;
}

export async function write(ts, channel, message, user, spreadsheetId) {
    const auth = authorize();
    const client = await auth.getClient();
    const googleSheets = google.sheets({ version: 'v4', auth: client });
    await googleSheets.spreadsheets.values.append({
        auth,
        spreadsheetId,
        range: 'Sheet1!A2',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            majorDimension: 'ROWS',
            values: [[ts, channel, message, user]],
        },
    });
}
