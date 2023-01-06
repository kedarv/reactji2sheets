import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/**
 * Create an GoogleAuth client with the given credentials
 */
const authorize = async (tokens) => {
    const creds = JSON.parse(tokens);
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_APIS_CLIENT_ID,
        process.env.GOOGLE_APIS_CLIENT_SECRET,
        process.env.GOOGLE_APIS_REDIRECT_URL
    );
    const auth = oauth2Client.setCredentials(creds);
    return oauth2Client;
};

export async function write(code, ts, channel, message, user, spreadsheetId) {
    const auth = await authorize(code);
    const googleSheets = google.sheets({ version: 'v4', auth: auth });
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

export const getGoogleAuthorizationUrl = (user_id) => {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_APIS_CLIENT_ID,
        process.env.GOOGLE_APIS_CLIENT_SECRET,
        process.env.GOOGLE_APIS_REDIRECT_URL
    );

    // TODO: manage refresh_token
    const authorizationUrl = oauth2Client.generateAuthUrl({
        // 'online' (default) or 'offline' (gets refresh_token)
        access_type: 'offline',
        scope: SCOPES,
        include_granted_scopes: true,
        state: JSON.stringify({ user_id: user_id }),
    });
    return authorizationUrl;
};

export const exchangeCodeForTokens = async (code) => {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_APIS_CLIENT_ID,
        process.env.GOOGLE_APIS_CLIENT_SECRET,
        process.env.GOOGLE_APIS_REDIRECT_URL
    );
    let { tokens } = await oauth2Client.getToken(code);
    return tokens;
};
