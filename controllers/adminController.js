const fs = require('fs');
const path = require('path');
const prisma = require('../db');
const {
  getAccountStats,
  getBestAccount,
  setAccountActive,
  getAllAccounts,
  getAccount
} = require('../services/googleDriveOAuthService');

const DASHBOARD_MONTHS = 6;
const DEFAULT_USER_LIMIT = 25;
const DEFAULT_PAYMENT_LIMIT = 100;
const DEFAULT_SESSION_LIMIT = 20;
const PLAN_TYPES = new Set(['FREE', 'MONTHLY_PREMIUM', 'ANNUAL_PREMIUM', 'LIFETIME']);
const SUBSCRIPTION_STATUSES = new Set(['ACTIVE', 'EXPIRED', 'CANCELLED']);
const PAYMENT_STATUSES = new Set(['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED']);
const PAYMENT_METHODS = new Set(['MPESA', 'CARD', 'PAYPAL', 'GOOGLE_PAY']);
const STK_ENVIRONMENTS = new Set(['sandbox', 'production']);
const GOOGLE_VISIBILITIES = new Set(['public', 'private']);
const DEFAULT_APP_SETTINGS_ID = 'default';
const STUDYPARK_STORAGE_PATH = path.resolve(__dirname, '..', 'studypark.json');
const OAUTH_CREDENTIALS_PATH = path.resolve(__dirname, '..', 'oauth-credentials.json');

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short'
  }).format(date);
}

function buildRecentMonthBuckets(count) {
  const months = [];
  const now = new Date();

  for (let index = count - 1; index >= 0; index -= 1) {
    const bucketDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    months.push({
      key: monthKey(bucketDate),
      label: monthLabel(bucketDate),
      value: 0
    });
  }

  return months;
}

function formatActivityTime(createdAt) {
  return createdAt instanceof Date ? createdAt.toISOString() : createdAt;
}

async function getDashboardDriveStorageStats() {
  try {
    const accounts = await getAccountStats();
    const activeAccounts = accounts.filter((account) => account.isActive);
    const sourceAccounts = activeAccounts.length ? activeAccounts : accounts;

    const totalUsedBytes = sourceAccounts.reduce(
      (sum, account) => sum + Number(account.quotaUsedBytes || 0),
      0
    );
    const totalQuotaBytes = sourceAccounts.reduce(
      (sum, account) => sum + Number(account.quotaTotalBytes || 0),
      0
    );
    const totalFreeBytes = Math.max(0, totalQuotaBytes - totalUsedBytes);

    return {
      driveAccountsCount: accounts.length,
      activeDriveAccountsCount: activeAccounts.length,
      driveStorageUsedBytes: totalUsedBytes,
      driveStorageFreeBytes: totalFreeBytes,
      driveStorageTotalBytes: totalQuotaBytes,
      driveStorageUsedPercent: totalQuotaBytes
        ? Number(((totalUsedBytes / totalQuotaBytes) * 100).toFixed(2))
        : 0,
      driveStorageLastCheckedAt:
        sourceAccounts
          .map((account) => account.lastQuotaCheck)
          .filter(Boolean)
          .sort()
          .at(-1) || null
    };
  } catch (error) {
    console.warn('Unable to refresh Google Drive storage stats for dashboard:', error.message);
    return {
      driveAccountsCount: 0,
      activeDriveAccountsCount: 0,
      driveStorageUsedBytes: 0,
      driveStorageFreeBytes: 0,
      driveStorageTotalBytes: 0,
      driveStorageUsedPercent: 0,
      driveStorageLastCheckedAt: null
    };
  }
}

function normalizePlanType(value, fallback = 'FREE') {
  const normalized = String(value || fallback).trim().toUpperCase();
  return PLAN_TYPES.has(normalized) ? normalized : fallback;
}

function normalizeSubscriptionStatus(value, fallback = 'ACTIVE') {
  const normalized = String(value || fallback).trim().toUpperCase();
  return SUBSCRIPTION_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizePaymentStatus(value, fallback = 'PENDING') {
  const normalized = String(value || fallback).trim().toUpperCase();
  return PAYMENT_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizePaymentMethod(value, fallback = 'MPESA') {
  const normalized = String(value || fallback).trim().toUpperCase().replace(/[\s-]+/g, '_');
  return PAYMENT_METHODS.has(normalized) ? normalized : fallback;
}

function parseOptionalDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toOptionalTrimmedString(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }

  return String(value).trim();
}

function normalizeStkEnvironment(value, fallback = 'sandbox') {
  const normalized = String(value || fallback).trim().toLowerCase();
  return STK_ENVIRONMENTS.has(normalized) ? normalized : fallback;
}

function normalizeGoogleVisibility(value, fallback = 'public') {
  const normalized = String(value || fallback).trim().toLowerCase();
  return GOOGLE_VISIBILITIES.has(normalized) ? normalized : fallback;
}

function buildDefaultStudyParkConfig() {
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

function buildDefaultOAuthCredentialsConfig() {
  return {
    oauth: {
      accounts: []
    }
  };
}

function loadStudyParkConfig() {
  try {
    if (!fs.existsSync(STUDYPARK_STORAGE_PATH)) {
      return buildDefaultStudyParkConfig();
    }

    const raw = fs.readFileSync(STUDYPARK_STORAGE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...buildDefaultStudyParkConfig(),
      ...parsed,
      oauth: {
        ...buildDefaultStudyParkConfig().oauth,
        ...(parsed.oauth || {})
      }
    };
  } catch {
    return buildDefaultStudyParkConfig();
  }
}

function saveStudyParkConfig(config) {
  fs.writeFileSync(STUDYPARK_STORAGE_PATH, JSON.stringify(config, null, 2));
}

function loadOAuthCredentialsConfig() {
  try {
    if (!fs.existsSync(OAUTH_CREDENTIALS_PATH)) {
      return buildDefaultOAuthCredentialsConfig();
    }

    const raw = fs.readFileSync(OAUTH_CREDENTIALS_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (parsed.installed || parsed.web) {
      return {
        oauth: {
          accounts: [
            {
              id: 'credential-1',
              email: '',
              installed: parsed.installed || parsed.web
            }
          ]
        }
      };
    }

    return {
      ...buildDefaultOAuthCredentialsConfig(),
      ...parsed,
      oauth: {
        ...buildDefaultOAuthCredentialsConfig().oauth,
        ...(parsed.oauth || {})
      }
    };
  } catch {
    return buildDefaultOAuthCredentialsConfig();
  }
}

function saveOAuthCredentialsConfig(config) {
  fs.writeFileSync(OAUTH_CREDENTIALS_PATH, JSON.stringify(config, null, 2));
}

function normalizeOAuthAccount(account, index) {
  const resolvedEmail = toOptionalTrimmedString(
    account?.email ||
      account?.clientEmail ||
      account?.credentials?.client_email ||
      account?.credentialsJson?.client_email ||
      account?.key
  ).toLowerCase();
  const fallbackId = toOptionalTrimmedString(account?.id || account?.key) ||
    (resolvedEmail ? `account-${resolvedEmail}` : `account-${index + 1}`);

  return {
    id: toOptionalTrimmedString(account?.id, fallbackId) || fallbackId,
    email: resolvedEmail || fallbackId,
    token: typeof account?.token === 'object' && account?.token !== null ? account.token : {},
    quotaUsedBytes: Number(account?.quotaUsedBytes) || 0,
    quotaTotalBytes: Number(account?.quotaTotalBytes) || 15000000000,
    lastQuotaCheck: account?.lastQuotaCheck || null,
    isActive: account?.isActive !== false
  };
}

function normalizeOAuthCredentialAccount(account, index) {
  const installed = account?.installed || account?.web || account || {};
  const normalizedRedirectUris = Array.isArray(installed.redirect_uris)
    ? installed.redirect_uris.map((uri) => String(uri).trim()).filter(Boolean)
    : [];
  const email = toOptionalTrimmedString(account?.email || account?.client_email).toLowerCase();
  const fallbackId =
    toOptionalTrimmedString(account?.id || account?.key) ||
    (email ? `credential-${email}` : `credential-${index + 1}`);

  return {
    id: fallbackId,
    email,
    installed: {
      client_id: toOptionalTrimmedString(installed.client_id),
      project_id: toOptionalTrimmedString(installed.project_id),
      auth_uri: toOptionalTrimmedString(installed.auth_uri, 'https://accounts.google.com/o/oauth2/auth'),
      token_uri: toOptionalTrimmedString(installed.token_uri, 'https://oauth2.googleapis.com/token'),
      auth_provider_x509_cert_url: toOptionalTrimmedString(
        installed.auth_provider_x509_cert_url,
        'https://www.googleapis.com/oauth2/v1/certs'
      ),
      client_secret: toOptionalTrimmedString(installed.client_secret),
      redirect_uris: normalizedRedirectUris.length ? normalizedRedirectUris : ['http://localhost']
    }
  };
}

function writeStudyParkDriveAccounts(accounts) {
  const config = loadStudyParkConfig();
  config.oauth.accounts = Array.isArray(accounts)
    ? accounts.map((account, index) => normalizeOAuthAccount(account, index))
    : [];
  saveStudyParkConfig(config);
}

function writeOAuthCredentialAccounts(accounts) {
  const config = loadOAuthCredentialsConfig();
  config.oauth.accounts = Array.isArray(accounts)
    ? accounts.map((account, index) => normalizeOAuthCredentialAccount(account, index))
    : [];
  saveOAuthCredentialsConfig(config);
}

function serializeAppSettings(settings) {
  const driveAccountsMeta = readStudyParkDriveAccounts();
  const oauthCredentialAccountsMeta = readOAuthCredentialAccounts();

  return {
    id: settings.id,
    stkPush: {
      environment: settings.stkEnvironment,
      shortCodeType: settings.stkShortCodeType || 'paybill',
      businessShortCode: settings.stkBusinessShortCode || '',
      accountReference: settings.stkAccountReference || '',
      passkey: settings.stkPasskey || '',
      consumerKey: settings.stkConsumerKey || '',
      consumerSecret: settings.stkConsumerSecret || '',
      callbackUrl: settings.stkCallbackUrl || ''
    },
    googleCredentials: {
      accountKey: settings.googleAccountKey || 'default',
      folderId: settings.googleFolderId || '',
      visibility: settings.googleVisibility || 'public',
      accounts: driveAccountsMeta.accounts,
      sourcePath: driveAccountsMeta.sourcePath,
      sourceStatus: driveAccountsMeta.sourceStatus,
      credentialAccounts: oauthCredentialAccountsMeta.accounts,
      credentialsSourcePath: oauthCredentialAccountsMeta.sourcePath,
      credentialsSourceStatus: oauthCredentialAccountsMeta.sourceStatus
    },
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt
  };
}

function readOAuthCredentialAccounts() {
  const sourcePath = OAUTH_CREDENTIALS_PATH;

  try {
    if (!fs.existsSync(sourcePath)) {
      return {
        sourcePath,
        sourceStatus: 'missing',
        accounts: []
      };
    }

    const parsed = loadOAuthCredentialsConfig();
    const accounts = Array.isArray(parsed.oauth?.accounts)
      ? parsed.oauth.accounts
      : Array.isArray(parsed.accounts)
        ? parsed.accounts
        : [];

    return {
      sourcePath,
      sourceStatus: 'available',
      accounts: accounts.map((account, index) => normalizeOAuthCredentialAccount(account, index))
    };
  } catch {
    return {
      sourcePath,
      sourceStatus: 'missing',
      accounts: []
    };
  }
}

function readStudyParkDriveAccounts() {
  const sourcePath = STUDYPARK_STORAGE_PATH;

  try {
    if (!fs.existsSync(sourcePath)) {
      return {
        sourcePath,
        sourceStatus: 'missing',
        accounts: []
      };
    }

    const parsed = loadStudyParkConfig();
    const accounts = Array.isArray(parsed.oauth?.accounts)
      ? parsed.oauth.accounts
      : Array.isArray(parsed.accounts)
        ? parsed.accounts
        : [];

    return {
      sourcePath,
      sourceStatus: 'available',
      accounts: accounts.map((account, index) => normalizeOAuthAccount(account, index))
    };
  } catch {
    return {
      sourcePath,
      sourceStatus: 'missing',
      accounts: []
    };
  }
}

async function ensureAppSettings() {
  return prisma.appSettings.upsert({
    where: { id: DEFAULT_APP_SETTINGS_ID },
    update: {},
    create: { id: DEFAULT_APP_SETTINGS_ID }
  });
}

function calculateEndDate(planType, startDate = new Date()) {
  const normalizedPlanType = normalizePlanType(planType);

  if (normalizedPlanType === 'MONTHLY_PREMIUM') {
    return new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  if (normalizedPlanType === 'ANNUAL_PREMIUM') {
    return new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);
  }

  return null;
}

function resolvePaidPlanType(value, fallback = 'MONTHLY_PREMIUM') {
  const normalized = normalizePlanType(value, fallback);
  return normalized === 'FREE' ? fallback : normalized;
}

async function syncUserPremiumState(userId, tx) {
  const activeSubscription = await tx.subscription.findFirst({
    where: {
      userId,
      status: 'ACTIVE',
      planType: {
        not: 'FREE'
      }
    },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }]
  });

  await tx.user.update({
    where: { id: userId },
    data: {
      isPremium: Boolean(activeSubscription),
      planType: activeSubscription?.planType || 'FREE'
    }
  });

  return activeSubscription;
}

function serializeUserAccount(user) {
  const latestSubscription = user.subscriptions?.[0] || null;

  return {
    id: user.id,
    name: user.fullName,
    email: user.email,
    university: user.university,
    joinDate: user.createdAt,
    status: user.sessions?.length > 0 ? 'active' : 'inactive',
    isPremium: user.isPremium,
    documentsUploaded: user._count?.uploadedDocuments || 0,
    downloadsCount: user.documentsDownloaded,
    subscriptionId: latestSubscription?.id || null,
    planType: latestSubscription?.planType || user.planType || 'FREE',
    subscriptionStatus: latestSubscription?.status || (user.isPremium ? 'ACTIVE' : 'CANCELLED'),
    subscriptionStartDate: latestSubscription?.startDate || null,
    subscriptionEndDate: latestSubscription?.endDate || null,
    paymentId: latestSubscription?.paymentId || null,
  };
}

function buildPagination({ page, limit, total }) {
  const hasMore = page * limit < total;

  return {
    page,
    limit,
    total,
    hasMore,
    nextPage: hasMore ? page + 1 : null
  };
}

function serializeAdminSession(session) {
  return {
    id: session.id,
    token: session.token,
    isActive: session.isActive,
    sessionType: session.devicePublicKey ? 'app' : 'website',
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    user: session.user
      ? {
          id: session.user.id,
          name: session.user.fullName,
          email: session.user.email,
          university: session.user.university
        }
      : null
  };
}

class AdminController {
  async getAppSettings(req, res) {
    try {
      const settings = await ensureAppSettings();

      res.json({
        success: true,
        settings: serializeAppSettings(settings)
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Unable to load app settings' });
    }
  }

  async updateAppSettings(req, res) {
    try {
      const stkPush = req.body?.stkPush || {};
      const googleCredentials = req.body?.googleCredentials || {};

      if (Array.isArray(googleCredentials.accounts)) {
        writeStudyParkDriveAccounts(googleCredentials.accounts);
      }
      if (Array.isArray(googleCredentials.credentialAccounts)) {
        writeOAuthCredentialAccounts(googleCredentials.credentialAccounts);
      }

      const settings = await prisma.appSettings.upsert({
        where: { id: DEFAULT_APP_SETTINGS_ID },
        update: {
          stkEnvironment: normalizeStkEnvironment(stkPush.environment),
          stkShortCodeType: toOptionalTrimmedString(stkPush.shortCodeType, 'paybill'),
          stkBusinessShortCode: toOptionalTrimmedString(stkPush.businessShortCode),
          stkAccountReference: toOptionalTrimmedString(stkPush.accountReference),
          stkPasskey: toOptionalTrimmedString(stkPush.passkey),
          stkConsumerKey: toOptionalTrimmedString(stkPush.consumerKey),
          stkConsumerSecret: toOptionalTrimmedString(stkPush.consumerSecret),
          stkCallbackUrl: toOptionalTrimmedString(stkPush.callbackUrl),
          googleAccountKey: toOptionalTrimmedString(googleCredentials.accountKey, 'default') || 'default',
          googleFolderId: toOptionalTrimmedString(googleCredentials.folderId),
          googleVisibility: normalizeGoogleVisibility(googleCredentials.visibility),
          googleCredentialsJson: ''
        },
        create: {
          id: DEFAULT_APP_SETTINGS_ID,
          stkEnvironment: normalizeStkEnvironment(stkPush.environment),
          stkShortCodeType: toOptionalTrimmedString(stkPush.shortCodeType, 'paybill'),
          stkBusinessShortCode: toOptionalTrimmedString(stkPush.businessShortCode),
          stkAccountReference: toOptionalTrimmedString(stkPush.accountReference),
          stkPasskey: toOptionalTrimmedString(stkPush.passkey),
          stkConsumerKey: toOptionalTrimmedString(stkPush.consumerKey),
          stkConsumerSecret: toOptionalTrimmedString(stkPush.consumerSecret),
          stkCallbackUrl: toOptionalTrimmedString(stkPush.callbackUrl),
          googleAccountKey: toOptionalTrimmedString(googleCredentials.accountKey, 'default') || 'default',
          googleFolderId: toOptionalTrimmedString(googleCredentials.folderId),
          googleVisibility: normalizeGoogleVisibility(googleCredentials.visibility),
          googleCredentialsJson: ''
        }
      });

      res.json({
        success: true,
        message: 'App settings updated successfully',
        settings: serializeAppSettings(settings)
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Unable to update app settings' });
    }
  }

  async getDashboard(req, res) {
    try {
      const activeSessionWhere = {
        isActive: true,
        expiresAt: { gt: new Date() }
      };
      const monthBuckets = buildRecentMonthBuckets(DASHBOARD_MONTHS);
      const uploadsSince = new Date(Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth() - (DASHBOARD_MONTHS - 1),
        1
      ));

      const [
        totalDocuments,
        publishedDocuments,
        draftDocuments,
        archivedDocuments,
        totalUsers,
        premiumUsers,
        activeUsers,
        documentAggregates,
        documentsByCategory,
        recentDocuments,
        recentUsers,
        recentSubscriptions,
        uploadTimelineDocuments,
        topDocuments
      ] = await prisma.$transaction([
        prisma.document.count(),
        prisma.document.count({ where: { status: 'PUBLISHED' } }),
        prisma.document.count({ where: { status: 'DRAFT' } }),
        prisma.document.count({ where: { status: 'ARCHIVED' } }),
        prisma.user.count({ where: { isAdmin: false } }),
        prisma.user.count({ where: { isPremium: true, isAdmin: false } }),
        prisma.session.count({ where: activeSessionWhere }),
        prisma.document.aggregate({
          _avg: { rating: true },
          _sum: { downloadsCount: true, viewsCount: true }
        }),
        prisma.document.groupBy({
          by: ['category'],
          _count: { _all: true },
          orderBy: {
            _count: {
              category: 'desc'
            }
          }
        }),
        prisma.document.findMany({
          take: 5,
          orderBy: { uploadedAt: 'desc' },
          include: {
            uploadedBy: {
              select: {
                fullName: true
              }
            }
          }
        }),
        prisma.user.findMany({
          where: { isAdmin: false },
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            fullName: true,
            university: true,
            createdAt: true
          }
        }),
        prisma.subscription.findMany({
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: {
                fullName: true
              }
            }
          }
        }),
        prisma.document.findMany({
          where: {
            uploadedAt: { gte: uploadsSince }
          },
          select: {
            uploadedAt: true
          }
        }),
        prisma.document.findMany({
          take: 5,
          orderBy: [
            { viewsCount: 'desc' },
            { downloadsCount: 'desc' },
            { rating: 'desc' }
          ],
          select: {
            id: true,
            title: true,
            viewsCount: true,
            downloadsCount: true,
            rating: true
          }
        })
      ]);

      const uploadLookup = new Map(monthBuckets.map((bucket) => [bucket.key, bucket]));
      const driveStorageStats = await getDashboardDriveStorageStats();

      uploadTimelineDocuments.forEach((document) => {
        const key = monthKey(new Date(document.uploadedAt));
        const bucket = uploadLookup.get(key);
        if (bucket) {
          bucket.value += 1;
        }
      });

      const recentActivities = [
        ...recentDocuments.map((document) => ({
          id: `document-${document.id}`,
          action: 'New document uploaded',
          details: `${document.title} · ${document.category}`,
          type: 'upload',
          createdAt: formatActivityTime(document.uploadedAt)
        })),
        ...recentUsers.map((user) => ({
          id: `user-${user.id}`,
          action: 'New user registered',
          details: `${user.fullName} joined from ${user.university}`,
          type: 'user',
          createdAt: formatActivityTime(user.createdAt)
        })),
        ...recentSubscriptions.map((subscription) => ({
          id: `subscription-${subscription.id}`,
          action: 'Subscription activated',
          details: `${subscription.user?.fullName || 'A user'} started ${subscription.planType.replace(/_/g, ' ')}`,
          type: 'subscription',
          createdAt: formatActivityTime(subscription.createdAt)
        }))
      ]
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .slice(0, 8);

      res.json({
        success: true,
        stats: {
          totalDocuments,
          totalDownloads: documentAggregates._sum.downloadsCount || 0,
          totalViews: documentAggregates._sum.viewsCount || 0,
          totalUsers,
          premiumUsers,
          activeUsers,
          publishedDocuments,
          draftDocuments,
          archivedDocuments,
          averageRating: Number((documentAggregates._avg.rating || 0).toFixed(1)),
          ...driveStorageStats
        },
        documentsByCategory: documentsByCategory.map((group) => ({
          label: group.category,
          value: group._count._all
        })),
        monthlyUploads: monthBuckets.map(({ label, value }) => ({ label, value })),
        recentActivities,
        topDocuments: topDocuments.map((document) => ({
          id: document.id,
          title: document.title,
          views: document.viewsCount,
          downloads: document.downloadsCount,
          rating: document.rating
        }))
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Unable to load dashboard data' });
    }
  }

  async getUsers(req, res) {
    try {
      const activeSessionWhere = {
        isActive: true,
        expiresAt: { gt: new Date() }
      };
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);

      const [users, totalUsers, premiumUsers, activeUsers, newThisMonth] = await prisma.$transaction([
        prisma.user.findMany({
          where: { isAdmin: false },
          take: DEFAULT_USER_LIMIT,
          orderBy: { createdAt: 'desc' },
          include: {
            _count: {
              select: {
                uploadedDocuments: true
              }
            },
            sessions: {
              where: activeSessionWhere,
              select: {
                id: true
              }
            },
            subscriptions: {
              orderBy: { createdAt: 'desc' },
              take: 1
            }
          }
        }),
        prisma.user.count({ where: { isAdmin: false } }),
        prisma.user.count({ where: { isAdmin: false, isPremium: true } }),
        prisma.session.count({
          where: {
            ...activeSessionWhere,
            user: {
              isAdmin: false
            }
          }
        }),
        prisma.user.count({
          where: {
            isAdmin: false,
            createdAt: { gte: monthStart }
          }
        })
      ]);

      res.json({
        success: true,
        stats: {
          totalUsers,
          premiumUsers,
          activeUsers,
          newThisMonth
        },
        users: users.map(serializeUserAccount)
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Unable to load user data' });
    }
  }

  async getSessions(req, res) {
    try {
      const requestedPage = Number.parseInt(String(req.query.page || '1'), 10);
      const requestedLimit = Number.parseInt(String(req.query.limit || String(DEFAULT_SESSION_LIMIT)), 10);
      const sessionType = String(req.query.sessionType || '').trim().toLowerCase();
      const page = Number.isNaN(requestedPage) || requestedPage < 1 ? 1 : requestedPage;
      const limit = Number.isNaN(requestedLimit) || requestedLimit < 1
        ? DEFAULT_SESSION_LIMIT
        : Math.min(requestedLimit, 100);
      const skip = (page - 1) * limit;

      const where = {
        user: {
          isAdmin: false
        },
        ...(sessionType === 'app'
          ? { devicePublicKey: { not: null } }
          : sessionType === 'website'
            ? { devicePublicKey: null }
            : {})
      };

      const [sessions, total] = await prisma.$transaction([
        prisma.session.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            token: true,
            devicePublicKey: true,
            isActive: true,
            createdAt: true,
            expiresAt: true,
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                university: true
              }
            }
          },
        }),
        prisma.session.count({ where })
      ]);

      res.json({
        success: true,
        sessions: sessions.map(serializeAdminSession),
        pagination: buildPagination({ page, limit, total })
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Unable to load sessions data' });
    }
  }

  async deleteSession(req, res) {
    try {
      const { id } = req.params;

      const session = await prisma.session.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              isAdmin: true
            }
          }
        }
      });

      if (!session) {
        return res.status(404).json({ success: false, message: 'Session not found' });
      }

      if (session.user?.isAdmin) {
        return res.status(403).json({ success: false, message: 'Admin sessions cannot be removed here' });
      }

      await prisma.session.delete({
        where: { id }
      });

      res.json({
        success: true,
        message: 'Session removed successfully'
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Unable to remove session' });
    }
  }

  async getPayments(req, res) {
    try {
      const [payments, linkedSubscriptions, users, totalPayments, successfulPayments, pendingPayments, totalRevenue, activeSubscriptions] =
        await prisma.$transaction(async (tx) => {
          const paymentRows = await tx.payment.findMany({
            take: DEFAULT_PAYMENT_LIMIT,
            orderBy: { createdAt: 'desc' },
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  fullName: true,
                  university: true,
                  isPremium: true,
                  planType: true
                }
              }
            }
          });

          const subscriptionRows = paymentRows.length
            ? await tx.subscription.findMany({
                where: {
                  paymentId: {
                    in: paymentRows.map((payment) => payment.id)
                  }
                }
              })
            : [];

          const userRows = await tx.user.findMany({
            where: { isAdmin: false },
            take: DEFAULT_USER_LIMIT,
            orderBy: [{ isPremium: 'desc' }, { createdAt: 'desc' }],
            include: {
              _count: {
                select: {
                  uploadedDocuments: true
                }
              },
              sessions: {
                where: {
                  isActive: true,
                  expiresAt: { gt: new Date() }
                },
                select: {
                  id: true
                }
              },
              subscriptions: {
                orderBy: { createdAt: 'desc' },
                take: 1
              }
            }
          });

          const totalPaymentCount = await tx.payment.count();
          const successfulCount = await tx.payment.count({ where: { status: 'SUCCESS' } });
          const pendingCount = await tx.payment.count({ where: { status: 'PENDING' } });
          const revenueAggregate = await tx.payment.aggregate({
            where: { status: 'SUCCESS' },
            _sum: { amount: true }
          });
          const activeSubscriptionCount = await tx.subscription.count({ where: { status: 'ACTIVE' } });

          return [
            paymentRows,
            subscriptionRows,
            userRows,
            totalPaymentCount,
            successfulCount,
            pendingCount,
            revenueAggregate._sum.amount || 0,
            activeSubscriptionCount
          ];
        });

      const subscriptionByPaymentId = new Map(
        linkedSubscriptions.map((subscription) => [subscription.paymentId, subscription])
      );

      res.json({
        success: true,
        stats: {
          totalPayments,
          successfulPayments,
          pendingPayments,
          totalRevenue,
          activeSubscriptions
        },
        payments: payments.map((payment) => {
          const linkedSubscription = subscriptionByPaymentId.get(payment.id) || null;

          return {
            id: payment.id,
            userId: payment.userId,
            userName: payment.user?.fullName || 'Unknown user',
            userEmail: payment.user?.email || '',
            university: payment.user?.university || '',
            amount: payment.amount,
            currency: payment.currency,
            method: payment.method,
            status: payment.status,
            transactionId: payment.transactionId || null,
            planType: linkedSubscription?.planType || payment.planType || payment.user?.planType || 'FREE',
            subscriptionId: linkedSubscription?.id || null,
            createdAt: payment.createdAt,
            updatedAt: payment.updatedAt
          };
        }),
        accounts: users.map(serializeUserAccount)
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Unable to load payment data' });
    }
  }

  async updatePayment(req, res) {
    try {
      const { id } = req.params;
      const { amount, currency, method, status, transactionId, planType } = req.body;

      const payment = await prisma.payment.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
              university: true,
              planType: true
            }
          }
        }
      });
      if (!payment) {
        return res.status(404).json({ success: false, message: 'Payment not found' });
      }

      const parsedAmount = amount !== undefined ? Number(amount) : undefined;
      if (parsedAmount !== undefined && Number.isNaN(parsedAmount)) {
        return res.status(400).json({ success: false, message: 'Payment amount must be a valid number' });
      }

      const normalizedStatus = status ? normalizePaymentStatus(status, payment.status) : payment.status;
      const fallbackPlanType = payment.user?.planType && payment.user.planType !== 'FREE'
        ? payment.user.planType
        : 'MONTHLY_PREMIUM';
      const normalizedPlanType = resolvePaidPlanType(planType, fallbackPlanType);

      const { updatedPayment, linkedSubscription, activeSubscription } = await prisma.$transaction(async (tx) => {
        const savedPayment = await tx.payment.update({
          where: { id },
          data: {
            ...(parsedAmount !== undefined ? { amount: parsedAmount } : {}),
            ...(currency ? { currency: String(currency).trim().toUpperCase() } : {}),
            ...(method ? { method: normalizePaymentMethod(method, payment.method) } : {}),
            ...(status ? { status: normalizedStatus } : {}),
            ...(transactionId !== undefined ? { transactionId: transactionId ? String(transactionId).trim() : null } : {}),
            planType: normalizedPlanType
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
                university: true,
                planType: true
              }
            }
          }
        });

        let matchedSubscription = await tx.subscription.findFirst({
          where: { paymentId: savedPayment.id },
          orderBy: { createdAt: 'desc' }
        });

        if (normalizedStatus === 'SUCCESS') {
          const startDate = matchedSubscription?.startDate || new Date();
          const endDate =
            normalizedPlanType === 'LIFETIME'
              ? null
              : matchedSubscription?.endDate || calculateEndDate(normalizedPlanType, startDate);

          if (matchedSubscription) {
            matchedSubscription = await tx.subscription.update({
              where: { id: matchedSubscription.id },
              data: {
                planType: normalizedPlanType,
                status: 'ACTIVE',
                startDate,
                endDate
              }
            });
          } else {
            matchedSubscription = await tx.subscription.create({
              data: {
                userId: savedPayment.userId,
                paymentId: savedPayment.id,
                planType: normalizedPlanType,
                status: 'ACTIVE',
                startDate,
                endDate
              }
            });
          }
        } else if (matchedSubscription) {
          matchedSubscription = await tx.subscription.update({
            where: { id: matchedSubscription.id },
            data: {
              planType: matchedSubscription.planType,
              status: 'CANCELLED'
            }
          });
        }

        const currentActiveSubscription = await syncUserPremiumState(savedPayment.userId, tx);

        return {
          updatedPayment: savedPayment,
          linkedSubscription: matchedSubscription,
          activeSubscription: currentActiveSubscription
        };
      });

      res.json({
        success: true,
        payment: {
          id: updatedPayment.id,
          userId: updatedPayment.userId,
          userName: updatedPayment.user?.fullName || 'Unknown user',
          userEmail: updatedPayment.user?.email || '',
          university: updatedPayment.user?.university || '',
          amount: updatedPayment.amount,
          currency: updatedPayment.currency,
          method: updatedPayment.method,
          status: updatedPayment.status,
          transactionId: updatedPayment.transactionId || null,
          planType:
            linkedSubscription?.planType ||
            updatedPayment.planType ||
            activeSubscription?.planType ||
            updatedPayment.user?.planType ||
            'FREE',
          subscriptionId: linkedSubscription?.id || activeSubscription?.id || null,
          createdAt: updatedPayment.createdAt,
          updatedAt: updatedPayment.updatedAt
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Unable to update payment' });
    }
  }

  async updateUserSubscription(req, res) {
    try {
      const { id } = req.params;
      const {
        planType,
        subscriptionStatus,
        subscriptionStartDate,
        subscriptionEndDate
      } = req.body;

      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          subscriptions: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          sessions: {
            where: {
              isActive: true,
              expiresAt: { gt: new Date() }
            },
            select: {
              id: true
            }
          },
          _count: {
            select: {
              uploadedDocuments: true
            }
          }
        }
      });

      if (!user || user.isAdmin) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const latestSubscription = user.subscriptions[0] || null;
      const normalizedPlanType = normalizePlanType(planType, latestSubscription?.planType || user.planType || 'FREE');
      const normalizedStatus = normalizeSubscriptionStatus(
        subscriptionStatus,
        latestSubscription?.status || (user.isPremium ? 'ACTIVE' : 'CANCELLED')
      );

      const startDate = parseOptionalDate(subscriptionStartDate) || latestSubscription?.startDate || new Date();
      const endDate =
        normalizedPlanType === 'LIFETIME' || normalizedPlanType === 'FREE'
          ? null
          : parseOptionalDate(subscriptionEndDate) || latestSubscription?.endDate || calculateEndDate(normalizedPlanType, startDate);

      let updatedSubscription;

      if (latestSubscription) {
        updatedSubscription = await prisma.subscription.update({
          where: { id: latestSubscription.id },
          data: {
            planType: normalizedPlanType,
            status: normalizedStatus,
            startDate,
            endDate
          }
        });
      } else {
        updatedSubscription = await prisma.subscription.create({
          data: {
            userId: user.id,
            planType: normalizedPlanType,
            status: normalizedStatus,
            startDate,
            endDate
          }
        });
      }

      const isPremium = normalizedStatus === 'ACTIVE' && normalizedPlanType !== 'FREE';

      await prisma.user.update({
        where: { id: user.id },
        data: {
          isPremium,
          planType: isPremium ? normalizedPlanType : 'FREE'
        }
      });

      const refreshedUser = await prisma.user.findUnique({
        where: { id: user.id },
        include: {
          subscriptions: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          sessions: {
            where: {
              isActive: true,
              expiresAt: { gt: new Date() }
            },
            select: {
              id: true
            }
          },
          _count: {
            select: {
              uploadedDocuments: true
            }
          }
        }
      });

      res.json({
        success: true,
        account: serializeUserAccount(refreshedUser)
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Unable to update subscription' });
    }
  }

  async getOAuthAccounts(req, res) {
    try {
      const stats = await getAccountStats();
      res.json({
        success: true,
        accounts: stats,
        totalAccounts: stats.length,
        activeAccounts: stats.filter(a => a.isActive).length
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Failed to get OAuth accounts' });
    }
  }

  async getOAuthAccountStats(req, res) {
    try {
      const { accountId } = req.params;
      const stats = await getAccountStats(accountId);
      res.json({
        success: true,
        account: stats[0] || null
      });
    } catch (error) {
      console.error(error);
      const statusCode = error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({ success: false, message: error.message });
    }
  }

  async getBestOAuthAccount(req, res) {
    try {
      const bestAccount = await getBestAccount();
      const stats = await getAccountStats(bestAccount.id);
      res.json({
        success: true,
        account: stats[0]
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async setOAuthAccountActive(req, res) {
    try {
      const { accountId } = req.params;
      const { isActive } = req.body;

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ success: false, message: 'isActive must be a boolean' });
      }

      setAccountActive(accountId, isActive);
      const account = getAccount(accountId);

      res.json({
        success: true,
        message: `Account ${accountId} is now ${isActive ? 'active' : 'inactive'}`,
        account: account
      });
    } catch (error) {
      console.error(error);
      const statusCode = error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({ success: false, message: error.message });
    }
  }
}

module.exports = new AdminController();
