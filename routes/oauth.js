const express = require('express');
const { google } = require('googleapis');
const {
  addAccount,
  getAccount,
  loadOAuthCredentials,
  updateAccountToken
} = require('../services/googleDriveOAuthService');

const router = express.Router();
const DRIVE_SCOPE = ['https://www.googleapis.com/auth/drive'];

function createOAuthClient() {
  const credentials = loadOAuthCredentials();
  return new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    credentials.redirect_uris[0]
  );
}

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'OAuth routes are available',
    endpoints: {
      authorize: '/auth/google',
      callback: '/auth/google/callback'
    }
  });
});

router.get('/google', (req, res) => {
  try {
    const oauth2Client = createOAuthClient();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: DRIVE_SCOPE
    });

    res.redirect(authUrl);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to start OAuth flow'
    });
  }
});

router.get('/google/callback', async (req, res) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Missing OAuth authorization code'
      });
    }

    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(String(code));
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();

    if (!data?.email) {
      return res.status(400).json({
        success: false,
        message: 'Unable to determine Google account email'
      });
    }

    const accountId = `account-${data.email.toLowerCase()}`;
    const existingAccount = getAccount(accountId);

    if (existingAccount) {
      updateAccountToken(accountId, tokens);
    } else {
      addAccount(accountId, data.email, tokens);
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>StudyPark OAuth</title>
          <style>
            body {
              margin: 0;
              font-family: Arial, sans-serif;
              background: #f0f7f3;
              color: #0f3d1f;
              display: grid;
              place-items: center;
              min-height: 100vh;
            }
            .card {
              background: white;
              border-radius: 16px;
              padding: 24px;
              box-shadow: 0 16px 40px rgba(15, 61, 31, 0.12);
              max-width: 420px;
              text-align: center;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Google Drive connected</h1>
            <p>${data.email} is now available for StudyPark uploads.</p>
            <p>You can close this window and return to the admin dashboard.</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message || 'OAuth callback failed'
    });
  }
});

module.exports = router;
