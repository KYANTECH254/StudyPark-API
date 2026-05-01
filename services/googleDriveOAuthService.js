const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { OAuth2 } = google.auth;

const SCOPE = ['https://www.googleapis.com/auth/drive'];
const STORAGE_FILE = path.join(__dirname, '../studypark.json');
const OAUTH_CREDENTIALS_FILE = path.join(__dirname, '../oauth-credentials.json');

function normalizeOAuthCredentialEntry(entry, index = 0) {
  const installed = entry?.installed || entry?.web || entry;
  const fallbackId = entry?.id || entry?.key || `credential-${index + 1}`;
  const email = String(entry?.email || entry?.client_email || '').trim().toLowerCase();

  return {
    id: String(fallbackId).trim(),
    email,
    installed,
  };
}

// Load OAuth credentials from oauth-credentials.json
function loadOAuthCredentials(accountId = null, accountEmail = null) {
  if (!fs.existsSync(OAUTH_CREDENTIALS_FILE)) {
    throw new Error('oauth-credentials.json not found. Please set up OAuth credentials first.');
  }

  const credentials = JSON.parse(fs.readFileSync(OAUTH_CREDENTIALS_FILE, 'utf8'));

  if (credentials.installed || credentials.web) {
    return credentials.installed || credentials.web;
  }

  const rawAccounts = Array.isArray(credentials?.oauth?.accounts)
    ? credentials.oauth.accounts
    : Array.isArray(credentials?.accounts)
      ? credentials.accounts
      : [];

  const accounts = rawAccounts.map((entry, index) => normalizeOAuthCredentialEntry(entry, index));
  const normalizedEmail = String(accountEmail || '').trim().toLowerCase();

  const matchedAccount =
    accounts.find((entry) => accountId && entry.id === accountId) ||
    accounts.find((entry) => normalizedEmail && entry.email === normalizedEmail) ||
    accounts[0];

  if (!matchedAccount?.installed?.client_id || !matchedAccount?.installed?.client_secret) {
    throw new Error('No valid OAuth credential account found in oauth-credentials.json.');
  }

  return matchedAccount.installed;
}

// Create OAuth2 client
function createOAuth2Client(account = null) {
  const { client_id, client_secret, redirect_uris } = loadOAuthCredentials(
    account?.id || null,
    account?.email || null
  );
  return new OAuth2(client_id, client_secret, redirect_uris[0]);
}

// Load storage config from studypark.json
function loadStorageConfig() {
  if (!fs.existsSync(STORAGE_FILE)) {
    return {
      oauth: {
        accounts: [],
        settings: {
          minAvailableSpace: 1000000000,
          autoRotateAccounts: true,
          quotaCheckInterval: 3600000
        }
      }
    };
  }
  const content = fs.readFileSync(STORAGE_FILE, 'utf8');
  return JSON.parse(content);
}

// Save config to studypark.json
function saveStorageConfig(config) {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(config, null, 2));
}

// Get all accounts
function getAllAccounts() {
  const config = loadStorageConfig();
  return config.oauth.accounts || [];
}

// Get account by ID
function getAccount(accountId) {
  const accounts = getAllAccounts();
  return accounts.find(acc => acc.id === accountId);
}

// Get the best account (most available space)
async function getBestAccount() {
  const accounts = getAllAccounts();
  const activeAccounts = accounts.filter(acc => acc.isActive);

  if (activeAccounts.length === 0) {
    throw new Error('No active OAuth accounts found');
  }

  // Find account with most available space
  let bestAccount = null;
  let maxAvailableSpace = -1;

  for (const account of activeAccounts) {
    // Update quota if needed
    await updateAccountQuota(account.id);
    const updatedAccount = getAccount(account.id);
    const availableSpace = updatedAccount.quotaTotalBytes - updatedAccount.quotaUsedBytes;

    if (availableSpace > maxAvailableSpace) {
      maxAvailableSpace = availableSpace;
      bestAccount = updatedAccount;
    }
  }

  const config = loadStorageConfig();
  const minSpace = config.oauth.settings.minAvailableSpace || 1000000000;

  if (maxAvailableSpace < minSpace) {
    throw new Error(`No account has sufficient space. Need ${minSpace} bytes, best available: ${maxAvailableSpace}`);
  }

  return bestAccount;
}

// Update quota for an account
async function updateAccountQuota(accountId) {
  const account = getAccount(accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  try {
    const oauth2Client = createOAuth2Client(account);
    oauth2Client.setCredentials(account.token);
    
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const about = await drive.about.get({ fields: 'storageQuota' });

    const config = loadStorageConfig();
    const accIdx = config.oauth.accounts.findIndex(a => a.id === accountId);
    
    config.oauth.accounts[accIdx].quotaUsedBytes = about.data.storageQuota.usedBytes || 0;
    config.oauth.accounts[accIdx].quotaTotalBytes = about.data.storageQuota.limit || 15000000000;
    config.oauth.accounts[accIdx].lastQuotaCheck = new Date().toISOString();

    saveStorageConfig(config);
  } catch (error) {
    console.error(`Failed to update quota for account ${accountId}:`, error.message);
  }
}

// Get auth client for specific account
async function getAuthClient(accountId = null) {
  let account;

  if (accountId) {
    account = getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }
  } else {
    // Get best account by available space
    account = await getBestAccount();
  }

  const oauth2Client = createOAuth2Client(account);
  oauth2Client.setCredentials(account.token);
  
  // Store account ID for later reference
  oauth2Client._accountId = account.id;
  oauth2Client._accountEmail = account.email;

  return oauth2Client;
}

// Add new OAuth account
function addAccount(accountId, email, token) {
  const config = loadStorageConfig();
  config.oauth.accounts = config.oauth.accounts || [];

  // Check if account already exists
  if (config.oauth.accounts.find(a => a.id === accountId)) {
    throw new Error(`Account ${accountId} already exists`);
  }

  config.oauth.accounts.push({
    id: accountId,
    email: email,
    token: token,
    quotaUsedBytes: 0,
    quotaTotalBytes: 15000000000,
    lastQuotaCheck: null,
    isActive: true
  });

  saveStorageConfig(config);
  return config.oauth.accounts[config.oauth.accounts.length - 1];
}

// Update account token
function updateAccountToken(accountId, token) {
  const config = loadStorageConfig();
  const accIdx = config.oauth.accounts.findIndex(a => a.id === accountId);

  if (accIdx === -1) {
    throw new Error(`Account ${accountId} not found`);
  }

  config.oauth.accounts[accIdx].token = token;
  saveStorageConfig(config);
}

// Disable/enable account
function setAccountActive(accountId, isActive) {
  const config = loadStorageConfig();
  const accIdx = config.oauth.accounts.findIndex(a => a.id === accountId);

  if (accIdx === -1) {
    throw new Error(`Account ${accountId} not found`);
  }

  config.oauth.accounts[accIdx].isActive = isActive;
  saveStorageConfig(config);
}

// Upload file to Google Drive
async function uploadFileToDrive(fileStream, fileName, folderId, mimeType = 'application/octet-stream', preferredAccountId = null) {
  try {
    const authClient = await getAuthClient(preferredAccountId);
    const drive = google.drive({ version: 'v3', auth: authClient });

    const fileMetadata = {
      name: fileName,
      ...(folderId && { parents: [folderId] })
    };

    const media = {
      mimeType: mimeType,
      body: fileStream
    };

    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, webViewLink, webContentLink, size'
    });

    // Make file publicly accessible
    try {
      await drive.permissions.create({
        fileId: file.data.id,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });
    } catch (permError) {
      console.warn(`Failed to set public permissions for file ${file.data.id}:`, permError.message);
    }

    // Generate public download link
    const publicFileUrl = `https://drive.google.com/uc?export=download&id=${file.data.id}`;
    const publicPreviewUrl = `https://drive.google.com/file/d/${file.data.id}/preview`;

    // Update quota after upload
    if (file.data.size) {
      const config = loadStorageConfig();
      const accIdx = config.oauth.accounts.findIndex(a => a.id === authClient._accountId);
      if (accIdx !== -1) {
        config.oauth.accounts[accIdx].quotaUsedBytes += file.data.size;
        saveStorageConfig(config);
      }
    }

    return {
      fileId: file.data.id,
      fileUrl: publicFileUrl,
      previewUrl: publicPreviewUrl,
      accountId: authClient._accountId,
      accountEmail: authClient._accountEmail,
      fileSize: file.data.size
    };
  } catch (error) {
    throw new Error(`Failed to upload file to Google Drive: ${error.message}`);
  }
}

// Delete file from Google Drive
async function deleteFileFromDrive(fileId, accountId = null) {
  try {
    const authClient = await getAuthClient(accountId);
    const drive = google.drive({ version: 'v3', auth: authClient });

    await drive.files.delete({
      fileId: fileId
    });

    return true;
  } catch (error) {
    throw new Error(`Failed to delete file from Google Drive: ${error.message}`);
  }
}

// Get account statistics
async function getAccountStats(accountId = null) {
  let accounts;

  if (accountId) {
    const account = getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }
    accounts = [account];
  } else {
    accounts = getAllAccounts();
  }

  const stats = [];
  for (const account of accounts) {
    await updateAccountQuota(account.id);
    const updated = getAccount(account.id);
    stats.push({
      id: updated.id,
      email: updated.email,
      quotaUsedBytes: updated.quotaUsedBytes,
      quotaTotalBytes: updated.quotaTotalBytes,
      quotaUsedPercent: ((updated.quotaUsedBytes / updated.quotaTotalBytes) * 100).toFixed(2),
      quotaAvailableBytes: updated.quotaTotalBytes - updated.quotaUsedBytes,
      isActive: updated.isActive,
      lastQuotaCheck: updated.lastQuotaCheck
    });
  }

  return stats;
}

module.exports = {
  getAuthClient,
  uploadFileToDrive,
  deleteFileFromDrive,
  addAccount,
  updateAccountToken,
  setAccountActive,
  getAllAccounts,
  getAccount,
  getBestAccount,
  updateAccountQuota,
  getAccountStats,
  loadStorageConfig,
  saveStorageConfig,
  loadOAuthCredentials
};

