const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE_STORAGE_PROVIDER = 'GOOGLE_DRIVE';
const DEFAULT_VISIBILITY = 'public';

let cachedAccounts = null;
const driveClientCache = new Map();
const oauthClientCache = new Map(); // Cache for OAuth clients

function normalizeVisibility(value, fallback = DEFAULT_VISIBILITY) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return String(value).toLowerCase() === 'private' ? 'private' : 'public';
}

function resolveCredentialsPath(credentialsPath) {
  if (!credentialsPath) {
    return null;
  }

  return path.isAbsolute(credentialsPath)
    ? credentialsPath
    : path.resolve(process.cwd(), credentialsPath);
}

function loadJsonFromPath(jsonPath) {
  const resolvedPath = resolveCredentialsPath(jsonPath);

  if (!resolvedPath) {
    return null;
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to read Google Drive JSON file at ${resolvedPath}: ${error.message}`);
  }
}

function parseCredentialsJson(credentialsJson) {
  if (!credentialsJson) {
    return null;
  }

  if (typeof credentialsJson === 'object') {
    return credentialsJson;
  }

  try {
    return JSON.parse(credentialsJson);
  } catch (error) {
    throw new Error('Google Drive credentials JSON is invalid');
  }
}

function normalizeAccountsCollection(value) {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value.accounts)) {
    return value.accounts;
  }

  if (Array.isArray(value.driveAccounts)) {
    return value.driveAccounts;
  }

  return null;
}

function buildLegacyCredentials(account) {
  if (!account.clientEmail || !account.privateKey) {
    return null;
  }

  return {
    type: 'service_account',
    client_email: account.clientEmail,
    private_key: String(account.privateKey).replace(/\\n/g, '\n')
  };
}

function resolveCredentials(account) {
  const credentials =
    parseCredentialsJson(account.credentialsJson) ||
    loadJsonFromPath(account.credentialsPath) ||
    parseCredentialsJson(account.credentials) ||
    buildLegacyCredentials(account);

  if (!credentials?.client_email || !credentials?.private_key) {
    throw new Error(
      `Google Drive account "${account.key}" must provide service-account JSON via credentialsJson, credentialsPath, credentials, or legacy clientEmail/privateKey fields`
    );
  }

  return {
    ...credentials,
    private_key: String(credentials.private_key).replace(/\\n/g, '\n')
  };
}

function buildAccountConfig(account, index) {
  const inlineCredentials =
    account.credentials ||
    account.credentialsJson ||
    account.serviceAccountJson ||
    (
      account.client_email &&
      account.private_key &&
      !account.clientEmail &&
      !account.privateKey
    ? account
    : null
    );
  const key = String(
    account.key ||
    account.accountKey ||
    account.name ||
    account.client_email ||
    account.clientEmail ||
    `drive-${index + 1}`
  );

  return {
    key,
    folderId: account.folderId || null,
    defaultVisibility: normalizeVisibility(account.visibility),
    credentialsPath: account.credentialsPath || account.serviceAccountPath || null,
    credentialsJson: account.credentialsJson || account.serviceAccountJson || null,
    credentials: inlineCredentials,
    clientEmail: account.clientEmail || null,
    privateKey: account.privateKey || null
  };
}

function loadDriveAccounts() {
  if (cachedAccounts) {
    return cachedAccounts;
  }

  let configuredAccounts =
    normalizeAccountsCollection(parseCredentialsJson(process.env.GOOGLE_DRIVE_ACCOUNTS)) ||
    normalizeAccountsCollection(
      loadJsonFromPath(
        process.env.GOOGLE_DRIVE_ACCOUNTS_PATH ||
        process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_PATH ||
        process.env.GOOGLE_DRIVE_CREDENTIALS_PATH
      )
    );

  if (configuredAccounts) {
    if (configuredAccounts.length === 0) {
      throw new Error('Google Drive accounts JSON must contain at least one account');
    }

    cachedAccounts = configuredAccounts.map(buildAccountConfig);
    return cachedAccounts;
  }

  const singleAccountConfig = {
    key: process.env.GOOGLE_DRIVE_ACCOUNT_KEY || 'default',
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || null,
    visibility: process.env.GOOGLE_DRIVE_VISIBILITY || DEFAULT_VISIBILITY,
    credentialsPath:
      process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_PATH ||
      process.env.GOOGLE_DRIVE_CREDENTIALS_PATH ||
      null,
    credentialsJson:
      process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_DRIVE_CREDENTIALS_JSON ||
      null,
    clientEmail: process.env.GOOGLE_DRIVE_CLIENT_EMAIL || null,
    privateKey: process.env.GOOGLE_DRIVE_PRIVATE_KEY || null
  };

  if (
    !singleAccountConfig.credentialsPath &&
    !singleAccountConfig.credentialsJson &&
    !singleAccountConfig.clientEmail &&
    !singleAccountConfig.privateKey
  ) {
    throw new Error(
      'Google Drive credentials are missing. Set GOOGLE_DRIVE_ACCOUNTS, GOOGLE_DRIVE_ACCOUNTS_PATH, or GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_PATH/GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON.'
    );
  }

  cachedAccounts = [buildAccountConfig(singleAccountConfig, 0)];
  return cachedAccounts;
}

function getDriveAccountByKey(accountKey) {
  const account = loadDriveAccounts().find(item => item.key === accountKey);

  if (!account) {
    throw new Error(`Google Drive account "${accountKey}" is not configured`);
  }

  return account;
}

function selectDriveAccount({ preferredAccountKey, usageCounts = {} } = {}) {
  const accounts = loadDriveAccounts();

  if (preferredAccountKey) {
    return getDriveAccountByKey(preferredAccountKey);
  }

  return [...accounts].sort((left, right) => {
    const leftUsage = usageCounts[left.key] || 0;
    const rightUsage = usageCounts[right.key] || 0;

    if (leftUsage !== rightUsage) {
      return leftUsage - rightUsage;
    }

    return left.key.localeCompare(right.key);
  })[0];
}

async function getDriveClient(account) {
  const cachedDriveClient = driveClientCache.get(account.key);

  if (cachedDriveClient) {
    return cachedDriveClient;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: resolveCredentials(account),
    scopes: [GOOGLE_DRIVE_SCOPE]
  });
  const authClient = await auth.getClient();
  const drive = google.drive({
    version: 'v3',
    auth: authClient
  });

  driveClientCache.set(account.key, drive);
  return drive;
}

// OAuth Token Support
async function getDriveClientFromOAuthToken(accessToken, cacheKey = 'oauth-default') {
  const cachedClient = oauthClientCache.get(cacheKey);

  if (cachedClient) {
    return cachedClient;
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
  });

  const drive = google.drive({
    version: 'v3',
    auth: oauth2Client,
  });

  oauthClientCache.set(cacheKey, drive);
  return drive;
}

async function listPermissions({ fileId, account }) {
  const drive = await getDriveClient(account);
  const response = await drive.permissions.list({
    fileId,
    supportsAllDrives: true,
    fields: 'permissions(id,type,role)'
  });

  return response.data.permissions || [];
}

async function syncDocumentSecurity({ fileId, accountKey, visibility = DEFAULT_VISIBILITY }) {
  const account = getDriveAccountByKey(accountKey);
  const drive = await getDriveClient(account);
  const normalizedVisibility = normalizeVisibility(visibility, account.defaultVisibility);
  const permissions = await listPermissions({ fileId, account });
  const publicPermissions = permissions.filter(permission => permission.type === 'anyone');

  if (normalizedVisibility === 'public') {
    const alreadyPublic = publicPermissions.some(permission => permission.role === 'reader');

    if (!alreadyPublic) {
      await drive.permissions.create({
        fileId,
        supportsAllDrives: true,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });
    }
  } else {
    for (const permission of publicPermissions) {
      await drive.permissions.delete({
        fileId,
        permissionId: permission.id,
        supportsAllDrives: true
      });
    }
  }

  return { visibility: normalizedVisibility };
}

async function updateDocumentMetadata({ fileId, accountKey, name }) {
  if (!name) {
    return null;
  }

  const account = getDriveAccountByKey(accountKey);
  const drive = await getDriveClient(account);
  const response = await drive.files.update({
    fileId,
    supportsAllDrives: true,
    fields: 'id,name',
    requestBody: {
      name
    }
  });

  return response.data;
}

async function deleteDocument({ fileId, accountKey }) {
  if (!fileId || !accountKey) {
    return null;
  }

  const account = getDriveAccountByKey(accountKey);
  const drive = await getDriveClient(account);

  await drive.files.delete({
    fileId,
    supportsAllDrives: true
  });

  return { deleted: true };
}

async function uploadDocument(file, options = {}) {
  if (!file) {
    throw new Error('Document file is required');
  }

  let drive;
  let folderId = null;
  let accountKey = null;
  const visibility = normalizeVisibility(options.visibility, DEFAULT_VISIBILITY);

  // Support both OAuth token and service account
  if (options.oauthAccessToken) {
    // Use OAuth token
    drive = await getDriveClientFromOAuthToken(options.oauthAccessToken);
    folderId = options.folderId || null;
    accountKey = 'oauth-user';
  } else {
    // Use service account
    const account = selectDriveAccount({
      preferredAccountKey: options.preferredAccountKey,
      usageCounts: options.usageCounts
    });
    drive = await getDriveClient(account);
    folderId = account.folderId;
    accountKey = account.key;
  }

  const response = await drive.files.create({
    requestBody: {
      name: file.originalname,
      ...(folderId ? { parents: [folderId] } : {})
    },
    media: {
      mimeType: file.mimetype || 'application/octet-stream',
      body: fs.createReadStream(file.path)
    },
    fields: 'id,name,mimeType,webViewLink',
    supportsAllDrives: true
  });
  
  const uploadedFile = response.data;

  // Only sync security for service accounts (OAuth has different permission model)
  if (!options.oauthAccessToken) {
    await syncDocumentSecurity({
      fileId: uploadedFile.id,
      accountKey,
      visibility
    });
  }

  return {
    provider: DRIVE_STORAGE_PROVIDER,
    accountKey,
    fileId: uploadedFile.id,
    visibility,
    fileUrl: `https://drive.google.com/uc?export=download&id=${uploadedFile.id}`,
    previewUrl: `https://drive.google.com/file/d/${uploadedFile.id}/preview`,
    webViewLink: uploadedFile.webViewLink || null
  };
}

module.exports = {
  DRIVE_STORAGE_PROVIDER,
  loadDriveAccounts,
  uploadDocument,
  deleteDocument,
  syncDocumentSecurity,
  updateDocumentMetadata,
  getDriveClientFromOAuthToken
};
