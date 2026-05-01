const fs = require('fs');
const prisma = require('../db');
const {
  DRIVE_STORAGE_PROVIDER,
  uploadDocument,
  deleteDocument: deleteDriveDocument,
  syncDocumentSecurity,
  updateDocumentMetadata
} = require('../services/googleDriveService');
const { uploadFileToDrive, deleteFileFromDrive } = require('../services/googleDriveOAuthService');
const { buildDocumentMetadataData } = require('../services/metadataService');

const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_DRIVE_VISIBILITY = 'public';
const DOCUMENT_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED'
};

function toClientStatus(status) {
  return String(status || DOCUMENT_STATUS.DRAFT).toLowerCase();
}

function toPublicDocument(document) {
  if (!document) {
    return null;
  }

  return {
    id: document.id,
    title: document.title,
    description: document.description,
    type: document.type,
    category: document.category,
    university: document.university,
    year: document.year,
    status: toClientStatus(document.status),
    fileUrl: document.fileUrl,
    previewUrl: document.previewUrl,
    rating: document.rating,
    downloads: document.downloadsCount ?? 0,
    views: document.viewsCount ?? 0,
    uploaderId: document.uploadedById ?? null,
    uploaderName: document.uploadedBy?.fullName ?? null,
    uploadedAt: document.uploadedAt ?? document.createdAt,
    publishedAt: document.publishedAt,
    archivedAt: document.archivedAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}

function serializeRecordsWithDocument(records) {
  return records.map(record => ({
    ...record,
    document: toPublicDocument(record.document)
  }));
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized === '' ? undefined : normalized;
}

function normalizeComparisonText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeProfileText(value) {
  return normalizeComparisonText(value)
    .split(' ')
    .filter(token => token.length >= 3);
}

function normalizeNullableText(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
  }

  return false;
}

function normalizeRating(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function normalizeUserRating(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 5) {
    return null;
  }

  return parsed;
}

async function countDistinctViewedDocuments(client, userId) {
  const viewedDocuments = await client.viewHistory.groupBy({
    by: ['documentId'],
    where: { userId }
  });

  return viewedDocuments.length;
}

async function countDistinctDownloadedDocuments(client, userId) {
  const downloadedDocuments = await client.download.groupBy({
    by: ['documentId'],
    where: { userId }
  });

  return downloadedDocuments.length;
}

async function refreshDocumentRating(documentId) {
  const aggregate = await prisma.rating.aggregate({
    where: { documentId },
    _avg: { rating: true },
    _count: { rating: true }
  });

  const averageRating = Number((aggregate._avg.rating || 0).toFixed(1));
  const totalRatings = aggregate._count.rating || 0;

  await prisma.document.update({
    where: { id: documentId },
    data: { rating: averageRating }
  });

  return {
    averageRating,
    totalRatings
  };
}

async function buildDocumentRatingSummary(documentId, userId) {
  const [document, aggregate, existingRating] = await Promise.all([
    prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, status: true, rating: true }
    }),
    prisma.rating.aggregate({
      where: { documentId },
      _avg: { rating: true },
      _count: { rating: true }
    }),
    userId
      ? prisma.rating.findUnique({
        where: { userId_documentId: { userId, documentId } },
        select: { rating: true }
      })
      : Promise.resolve(null)
  ]);

  if (!document) {
    return null;
  }

  return {
    document,
    averageRating: Number((aggregate._avg.rating ?? document.rating ?? 0).toFixed(1)),
    totalRatings: aggregate._count.rating || 0,
    userRating: existingRating?.rating ?? null
  };
}

function normalizeDriveVisibility(value, fallback = DEFAULT_DRIVE_VISIBILITY) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return String(value).toLowerCase() === 'private' ? 'private' : 'public';
}

function scoreDocumentForUser(document, user) {
  if (!user) {
    return 0;
  }

  let score = 0;
  const userUniversity = normalizeComparisonText(user.university);
  const documentUniversity = normalizeComparisonText(document.university);

  if (userUniversity && documentUniversity === userUniversity) {
    score += 120;
  }

  const courseTokens = tokenizeProfileText(user.course);
  if (courseTokens.length > 0) {
    const haystack = normalizeComparisonText([
      document.title,
      document.description,
      document.category,
      document.type,
      document.university
    ].filter(Boolean).join(' '));

    let matchedTokens = 0;
    for (const token of courseTokens) {
      if (haystack.includes(token)) {
        matchedTokens += 1;
      }
    }

    score += matchedTokens * 35;
  }

  score += Math.min(document.downloadsCount || 0, 50);
  score += Math.round((document.rating || 0) * 4);
  score += Math.min(document.viewsCount || 0, 20);

  return score;
}

function sortDocumentsForUser(documents, user) {
  return [...documents].sort((left, right) => {
    const scoreDifference = scoreDocumentForUser(right, user) - scoreDocumentForUser(left, user);
    if (scoreDifference !== 0) {
      return scoreDifference;
    }

    const publishedAtDifference = new Date(right.publishedAt || right.createdAt).getTime()
      - new Date(left.publishedAt || left.createdAt).getTime();
    if (publishedAtDifference !== 0) {
      return publishedAtDifference;
    }

    return String(right.id).localeCompare(String(left.id));
  });
}

function normalizeDocumentStatus(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toUpperCase();
  if (normalized === DOCUMENT_STATUS.PUBLISHED) {
    return DOCUMENT_STATUS.PUBLISHED;
  }

  if (normalized === DOCUMENT_STATUS.ARCHIVED) {
    return DOCUMENT_STATUS.ARCHIVED;
  }

  if (normalized === DOCUMENT_STATUS.DRAFT) {
    return DOCUMENT_STATUS.DRAFT;
  }

  return fallback;
}

function isManagedDriveDocument(document) {
  return (
    document?.storageProvider === DRIVE_STORAGE_PROVIDER &&
    Boolean(document.storageAccountKey) &&
    Boolean(document.storageFileId)
  );
}

function buildManagedStorageData(driveUpload) {
  return {
    fileUrl: driveUpload.fileUrl,
    previewUrl: driveUpload.previewUrl,
    storageProvider: DRIVE_STORAGE_PROVIDER,
    storageAccountKey: driveUpload.accountKey,
    storageFileId: driveUpload.fileId,
    storageVisibility: driveUpload.visibility
  };
}

function buildExternalStorageData(fileUrl, previewUrl) {
  return {
    fileUrl,
    previewUrl: previewUrl || null,
    storageProvider: null,
    storageAccountKey: null,
    storageFileId: null,
    storageVisibility: null
  };
}

function buildDocumentWhere(params = {}, options = {}) {
  const where = {};
  const {
    type,
    category,
    university,
    year,
    search,
    status
  } = params;

  if (options.publishedOnly) {
    where.status = DOCUMENT_STATUS.PUBLISHED;
  } else {
    const normalizedStatus = normalizeDocumentStatus(status, undefined);
    if (normalizedStatus) {
      where.status = normalizedStatus;
    }
  }

  if (type) where.type = type;
  if (category) where.category = category;
  if (university) where.university = university;
  if (year) where.year = year;
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { category: { contains: search } },
      { university: { contains: search } },
      { type: { contains: search } }
    ];
  }

  return where;
}

async function getDriveUsageCounts() {
  const groupedDocuments = await prisma.document.groupBy({
    by: ['storageAccountKey'],
    where: {
      storageProvider: DRIVE_STORAGE_PROVIDER,
      storageAccountKey: { not: null }
    },
    _count: {
      _all: true
    }
  });

  return groupedDocuments.reduce((usageCounts, group) => {
    if (group.storageAccountKey) {
      usageCounts[group.storageAccountKey] = group._count._all;
    }

    return usageCounts;
  }, {});
}

async function rollbackManagedUpload(uploadedManagedFile) {
  if (!uploadedManagedFile?.fileId || !uploadedManagedFile?.accountKey) {
    return;
  }

  try {
    await deleteDriveDocument({
      fileId: uploadedManagedFile.fileId,
      accountKey: uploadedManagedFile.accountKey
    });
  } catch (cleanupError) {
    console.error('Failed to rollback uploaded Google Drive file:', cleanupError);
  }
}

async function tryDeleteManagedDocument(document, warnings, warningMessage) {
  if (!isManagedDriveDocument(document)) {
    return;
  }

  try {
    await deleteDriveDocument({
      fileId: document.storageFileId,
      accountKey: document.storageAccountKey
    });
  } catch (error) {
    console.error(error);
    warnings.push(warningMessage);
  }
}

class DocumentController {
  async create(req, res) {
    let uploadedFileId = null;

    try {
      const {
        title,
        description,
        type,
        category,
        university,
        year,
        status,
        fileUrl,
        previewUrl,
        rating,
        driveVisibility,
        driveFolderId
      } = req.body;
      const uploadedFile = req.file;
      const externalFileUrl = normalizeOptionalText(fileUrl);
      const externalPreviewUrl = normalizeNullableText(previewUrl);
      const normalizedStatus = normalizeDocumentStatus(status, DOCUMENT_STATUS.DRAFT);
      const notifyAllUsers = normalizeBoolean(req.body.notifyAllUsers);

      if (!title || !type || !category || !university || !year) {
        return res.status(400).json({ success: false, message: 'All required fields must be provided' });
      }

      if (!uploadedFile && !externalFileUrl) {
        return res.status(400).json({ success: false, message: 'A document file or fileUrl is required' });
      }

      let storageData;

      if (uploadedFile) {
        try {
          const fileStream = fs.createReadStream(uploadedFile.path);
          const driveUpload = await uploadFileToDrive(
            fileStream,
            uploadedFile.originalname || 'document',
            normalizeOptionalText(driveFolderId),
            uploadedFile.mimetype || 'application/octet-stream',
            normalizeOptionalText(req.body.oauthAccountId) // Optional: let user specify account
          );
          
          uploadedFileId = driveUpload.fileId;
          storageData = {
            fileUrl: driveUpload.fileUrl,
            previewUrl: driveUpload.previewUrl,
            storageProvider: DRIVE_STORAGE_PROVIDER,
            storageAccountKey: driveUpload.accountId, // Store which account uploaded this
            storageFileId: driveUpload.fileId,
            storageVisibility: normalizeDriveVisibility(driveVisibility)
          };
        } catch (error) {
          throw new Error(`Failed to upload file to Google Drive: ${error.message}`);
        }
      } else {
        storageData = buildExternalStorageData(externalFileUrl, externalPreviewUrl);
      }

      const now = new Date();
      const metadataData = await buildDocumentMetadataData(prisma, {
        type,
        category,
        university
      });
      const document = await prisma.document.create({
        data: {
          title: String(title).trim(),
          description: normalizeNullableText(description),
          year: String(year).trim(),
          status: normalizedStatus,
          rating: normalizeRating(rating, 0.0),
          uploadedById: req.userId,
          uploadedAt: now,
          publishedAt: normalizedStatus === DOCUMENT_STATUS.PUBLISHED ? now : null,
          archivedAt: normalizedStatus === DOCUMENT_STATUS.ARCHIVED ? now : null,
          ...metadataData,
          ...storageData
        },
        include: {
          uploadedBy: {
            select: {
              fullName: true
            }
          }
        }
      });

      if (notifyAllUsers) {
        await prisma.appNotification.create({
          data: {
            title: 'New document added',
            message: `${document.title} was added to the library for ${document.university}.`,
            type: 'DOCUMENT_UPLOADED',
            actionUrl: document.previewUrl || document.fileUrl || null,
            createdById: req.userId
          }
        });
      }

      res.status(201).json({ success: true, document: toPublicDocument(document) });
    } catch (error) {
      console.error(error);

      if (uploadedFileId) {
        try {
          await deleteFileFromDrive(uploadedFileId);
        } catch (deleteError) {
          console.error('Failed to cleanup uploaded file:', deleteError);
        }
      }

      const message = req.file
        ? `Failed to upload document to Google Drive: ${error.message}`
        : 'Server error';

      res.status(500).json({ success: false, message });
    } finally {
      if (req.file?.path) {
        fs.promises.unlink(req.file.path).catch(() => {});
      }
    }
  }

  async getAdminDocuments(req, res) {
    try {
      const parsedPage = Number.parseInt(req.query.page, 10);
      const currentPage = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
      const skip = (currentPage - 1) * DEFAULT_PAGE_SIZE;
      const where = buildDocumentWhere(req.query, { publishedOnly: false });

      const [documents, total] = await prisma.$transaction([
        prisma.document.findMany({
          where,
          include: {
            uploadedBy: {
              select: {
                fullName: true
              }
            }
          },
          orderBy: [
            { uploadedAt: 'desc' },
            { id: 'desc' }
          ],
          skip,
          take: DEFAULT_PAGE_SIZE
        }),
        prisma.document.count({ where })
      ]);

      const hasMore = skip + documents.length < total;

      res.json({
        success: true,
        documents: documents.map(toPublicDocument),
        pagination: {
          page: currentPage,
          limit: DEFAULT_PAGE_SIZE,
          total,
          hasMore,
          nextPage: hasMore ? currentPage + 1 : null
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async getAll(req, res) {
    try {
      const parsedPage = Number.parseInt(req.query.page, 10);
      const currentPage = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
      const skip = (currentPage - 1) * DEFAULT_PAGE_SIZE;
      const where = buildDocumentWhere(req.query, { publishedOnly: true });
      const hasSearchQuery = Boolean(normalizeOptionalText(req.query.search));
      const canPersonalize = Boolean(req.user && !hasSearchQuery);

      let documents;
      let total;

      if (canPersonalize) {
        const allDocuments = await prisma.document.findMany({
          where,
          orderBy: [
            { publishedAt: 'desc' },
            { id: 'desc' }
          ]
        });

        const rankedDocuments = sortDocumentsForUser(allDocuments, req.user);
        total = rankedDocuments.length;
        documents = rankedDocuments.slice(skip, skip + DEFAULT_PAGE_SIZE);
      } else {
        [documents, total] = await prisma.$transaction([
          prisma.document.findMany({
            where,
            orderBy: [
              { publishedAt: 'desc' },
              { id: 'desc' }
            ],
            skip,
            take: DEFAULT_PAGE_SIZE
          }),
          prisma.document.count({ where })
        ]);
      }

      const hasMore = skip + documents.length < total;

      res.json({
        success: true,
        documents: documents.map(toPublicDocument),
        pagination: {
          page: currentPage,
          limit: DEFAULT_PAGE_SIZE,
          total,
          hasMore,
          nextPage: hasMore ? currentPage + 1 : null
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async getById(req, res) {
    try {
      const { id } = req.params;
      const document = await prisma.document.findUnique({ where: { id } });

      if (!document || document.status !== DOCUMENT_STATUS.PUBLISHED) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }

      res.json({ success: true, document: toPublicDocument(document) });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async getRatingSummary(req, res) {
    try {
      const { id } = req.params;
      const summary = await buildDocumentRatingSummary(id);

      if (!summary || summary.document.status !== DOCUMENT_STATUS.PUBLISHED) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }

      res.json({
        success: true,
        documentId: id,
        averageRating: summary.averageRating,
        totalRatings: summary.totalRatings
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async getUserRating(req, res) {
    try {
      const { id } = req.params;
      const userId = req.userId;
      const summary = await buildDocumentRatingSummary(id, userId);

      if (!summary || (!req.isAdmin && summary.document.status !== DOCUMENT_STATUS.PUBLISHED)) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }

      res.json({
        success: true,
        documentId: id,
        userRating: summary.userRating,
        averageRating: summary.averageRating,
        totalRatings: summary.totalRatings
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async update(req, res) {
    let uploadedManagedFile = null;

    try {
      const { id } = req.params;
      const {
        title,
        description,
        type,
        category,
        university,
        year,
        status,
        fileUrl,
        previewUrl,
        rating,
        driveVisibility,
        driveFolderId
      } = req.body;
      const uploadedFile = req.file;
      const existingDocument = await prisma.document.findUnique({ where: { id } });

      if (!existingDocument) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }

      const warnings = [];
      const externalFileUrl = normalizeOptionalText(fileUrl);
      const externalPreviewUrl = normalizeNullableText(previewUrl);
      const normalizedRating = normalizeRating(rating, undefined);
      const normalizedStatus = normalizeDocumentStatus(status, undefined);
      const requestedVisibility = normalizeDriveVisibility(
        driveVisibility,
        existingDocument.storageVisibility || DEFAULT_DRIVE_VISIBILITY
      );
      const switchingToExternalFile = !uploadedFile && Boolean(externalFileUrl);
      const metadataData = await buildDocumentMetadataData(prisma, {
        type,
        category,
        university
      });
      const updateData = {
        ...(title && { title: String(title).trim() }),
        ...(description !== undefined && { description: normalizeNullableText(description) }),
        ...metadataData,
        ...(year && { year: String(year).trim() }),
        ...(normalizedRating !== undefined && { rating: normalizedRating })
      };

      if (normalizedStatus) {
        updateData.status = normalizedStatus;

        if (normalizedStatus === DOCUMENT_STATUS.PUBLISHED && !existingDocument.publishedAt) {
          updateData.publishedAt = new Date();
        }

        if (normalizedStatus === DOCUMENT_STATUS.ARCHIVED) {
          updateData.archivedAt = new Date();
        } else if (existingDocument.archivedAt) {
          updateData.archivedAt = null;
        }
      }

      if (uploadedFile) {
        try {
          const fileStream = fs.createReadStream(uploadedFile.path);
          const driveUpload = await uploadFileToDrive(
            fileStream,
            uploadedFile.originalname || 'document',
            normalizeOptionalText(driveFolderId) || (isManagedDriveDocument(existingDocument) ? existingDocument.storageFolderId : null),
            uploadedFile.mimetype || 'application/octet-stream'
          );
          
          uploadedManagedFile = { fileId: driveUpload.fileId };
          Object.assign(updateData, {
            fileUrl: driveUpload.fileUrl,
            previewUrl: driveUpload.previewUrl,
            storageProvider: DRIVE_STORAGE_PROVIDER,
            storageAccountKey: 'oauth-user',
            storageFileId: driveUpload.fileId,
            storageVisibility: requestedVisibility
          });
        } catch (error) {
          throw new Error(`Failed to upload file to Google Drive: ${error.message}`);
        }
      } else if (switchingToExternalFile) {
        Object.assign(
          updateData,
          buildExternalStorageData(
            externalFileUrl,
            externalPreviewUrl !== undefined ? externalPreviewUrl : existingDocument.previewUrl
          )
        );
      } else {
        if (!isManagedDriveDocument(existingDocument) && externalPreviewUrl !== undefined) {
          updateData.previewUrl = externalPreviewUrl;
        }

        if (driveVisibility !== undefined && isManagedDriveDocument(existingDocument)) {
          updateData.storageVisibility = requestedVisibility;
        }
      }

      let updatedDocument;

      try {
        updatedDocument = await prisma.document.update({
          where: { id },
          data: updateData,
          include: {
            uploadedBy: {
              select: {
                fullName: true
              }
            }
          }
        });
      } catch (error) {
        if (uploadedManagedFile) {
          try {
            await deleteFileFromDrive(uploadedManagedFile.fileId);
          } catch (deleteError) {
            console.error('Failed to cleanup uploaded file:', deleteError);
          }
        }

        throw error;
      }

      const replacingManagedFile = uploadedFile || switchingToExternalFile;

      if (replacingManagedFile) {
        await tryDeleteManagedDocument(
          existingDocument,
          warnings,
          'The previous Google Drive file could not be deleted automatically.'
        );
      } else if (isManagedDriveDocument(existingDocument)) {
        if (title && title !== existingDocument.title) {
          try {
            await updateDocumentMetadata({
              fileId: existingDocument.storageFileId,
              accountKey: existingDocument.storageAccountKey,
              name: title
            });
          } catch (error) {
            console.error(error);
            warnings.push('The Google Drive file name could not be updated automatically.');
          }
        }

        if (
          driveVisibility !== undefined &&
          requestedVisibility !== (existingDocument.storageVisibility || DEFAULT_DRIVE_VISIBILITY)
        ) {
          try {
            await syncDocumentSecurity({
              fileId: existingDocument.storageFileId,
              accountKey: existingDocument.storageAccountKey,
              visibility: requestedVisibility
            });
          } catch (error) {
            console.error(error);
            warnings.push('The Google Drive file visibility could not be updated automatically.');
          }
        }
      }

      res.json({
        success: true,
        document: toPublicDocument(updatedDocument),
        ...(warnings.length > 0 ? { warnings } : {})
      });
    } catch (error) {
      console.error(error);
      const message = req.file
        ? `Failed to update Google Drive document: ${error.message}`
        : 'Server error';

      res.status(500).json({ success: false, message });
    } finally {
      if (req.file?.path) {
        fs.promises.unlink(req.file.path).catch(() => {});
      }
    }
  }

  async delete(req, res) {
    try {
      const { id } = req.params;
      const document = await prisma.document.findUnique({ where: { id } });

      if (!document) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }

      if (isManagedDriveDocument(document)) {
        if (document.storageAccountKey === 'oauth-user') {
          // Delete OAuth-uploaded file
          await deleteFileFromDrive(document.storageFileId);
        } else {
          // Delete service account-uploaded file
          await deleteDriveDocument({
            fileId: document.storageFileId,
            accountKey: document.storageAccountKey
          });
        }
      }

      await prisma.document.delete({ where: { id } });

      res.json({ success: true, message: 'Document deleted successfully' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async download(req, res) {
    try {
      const { id } = req.params;
      const userId = req.userId;

      const document = await prisma.document.findUnique({ where: { id } });
      if (!document || (!req.isAdmin && document.status !== DOCUMENT_STATUS.PUBLISHED)) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }
      if (!document.fileUrl) {
        return res.status(400).json({ success: false, message: 'Document file is unavailable for download' });
      }

      await prisma.$transaction(async tx => {
        const existingDownload = await tx.download.findFirst({
          where: { userId, documentId: id },
          orderBy: { createdAt: 'desc' },
          select: { id: true }
        });

        if (existingDownload) {
          await tx.download.update({
            where: { id: existingDownload.id },
            data: { createdAt: new Date() }
          });
        } else {
          await tx.download.create({
            data: {
              userId,
              documentId: id
            }
          });

          const [distinctDownloadedDocuments, distinctDocumentDownloaders] = await Promise.all([
            countDistinctDownloadedDocuments(tx, userId),
            tx.download.groupBy({
              by: ['userId'],
              where: { documentId: id }
            })
          ]);

          await Promise.all([
            tx.user.update({
              where: { id: userId },
              data: { documentsDownloaded: distinctDownloadedDocuments }
            }),
            tx.document.update({
              where: { id },
              data: { downloadsCount: distinctDocumentDownloaders.length }
            })
          ]);
        }
      });

      const updatedDocument = await prisma.document.findUnique({ where: { id } });

      res.json({
        success: true,
        downloadUrl: document.fileUrl,
        document: toPublicDocument(updatedDocument)
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async getDownloads(req, res) {
    try {
      const userId = req.userId;
      const downloads = await prisma.download.findMany({
        where: { userId },
        include: { document: true },
        orderBy: { createdAt: 'desc' }
      });

      res.json({ success: true, downloads: serializeRecordsWithDocument(downloads) });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async rateDocument(req, res) {
    try {
      const { id } = req.params;
      const userId = req.userId;
      const normalizedRating = normalizeUserRating(req.body?.rating);

      if (normalizedRating === null) {
        return res.status(400).json({
          success: false,
          message: 'Rating must be an integer between 1 and 5'
        });
      }

      const document = await prisma.document.findUnique({ where: { id } });
      if (!document || (!req.isAdmin && document.status !== DOCUMENT_STATUS.PUBLISHED)) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }

      await prisma.rating.upsert({
        where: { userId_documentId: { userId, documentId: id } },
        update: { rating: normalizedRating },
        create: {
          userId,
          documentId: id,
          rating: normalizedRating
        }
      });

      const ratingSummary = await refreshDocumentRating(id);
      const updatedDocument = await prisma.document.findUnique({ where: { id } });

      res.json({
        success: true,
        message: 'Rating saved successfully',
        rating: normalizedRating,
        averageRating: ratingSummary.averageRating,
        totalRatings: ratingSummary.totalRatings,
        document: toPublicDocument(updatedDocument)
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async addFavorite(req, res) {
    try {
      const { id } = req.params;
      const userId = req.userId;

      const document = await prisma.document.findUnique({ where: { id } });
      if (!document || (!req.isAdmin && document.status !== DOCUMENT_STATUS.PUBLISHED)) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }

      const existingFavorite = await prisma.favorite.findUnique({
        where: { userId_documentId: { userId, documentId: id } }
      });

      if (existingFavorite) {
        return res.status(400).json({ success: false, message: 'Already in favorites' });
      }

      await prisma.favorite.create({
        data: { userId, documentId: id }
      });

      await prisma.user.update({
        where: { id: userId },
        data: { favoritesCount: { increment: 1 } }
      });

      res.json({ success: true, message: 'Added to favorites' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async removeFavorite(req, res) {
    try {
      const { id } = req.params;
      const userId = req.userId;

      await prisma.favorite.delete({
        where: { userId_documentId: { userId, documentId: id } }
      });

      await prisma.user.update({
        where: { id: userId },
        data: { favoritesCount: { decrement: 1 } }
      });

      res.json({ success: true, message: 'Removed from favorites' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async getFavorites(req, res) {
    try {
      const userId = req.userId;
      const favorites = await prisma.favorite.findMany({
        where: { userId },
        include: { document: true },
        orderBy: { createdAt: 'desc' }
      });

      res.json({ success: true, favorites: serializeRecordsWithDocument(favorites) });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async recordView(req, res) {
    try {
      const { id } = req.params;
      const userId = req.userId;

      const document = await prisma.document.findUnique({ where: { id } });
      if (!document || (!req.isAdmin && document.status !== DOCUMENT_STATUS.PUBLISHED)) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }

      await prisma.$transaction(async tx => {
        const existingView = await tx.viewHistory.findFirst({
          where: { userId, documentId: id },
          orderBy: { viewedAt: 'desc' },
          select: { id: true }
        });

        await tx.document.update({
          where: { id },
          data: { viewsCount: { increment: 1 } }
        });

        if (existingView) {
          await tx.viewHistory.update({
            where: { id: existingView.id },
            data: { viewedAt: new Date() }
          });
        } else {
          await tx.viewHistory.create({
            data: { userId, documentId: id }
          });
        }

        const distinctViewedDocuments = await countDistinctViewedDocuments(tx, userId);
        await tx.user.update({
          where: { id: userId },
          data: { documentsViewed: distinctViewedDocuments }
        });
      });

      res.json({ success: true, message: 'View recorded' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async getViewHistory(req, res) {
    try {
      const userId = req.userId;
      const views = await prisma.viewHistory.findMany({
        where: { userId },
        include: { document: true },
        orderBy: { viewedAt: 'desc' }
      });

      res.json({ success: true, views: serializeRecordsWithDocument(views) });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async clearViewHistory(req, res) {
    try {
      const userId = req.userId;

      const deleted = await prisma.$transaction(async tx => {
        const result = await tx.viewHistory.deleteMany({
          where: { userId }
        });

        await tx.user.update({
          where: { id: userId },
          data: { documentsViewed: 0 }
        });

        return result.count;
      });

      res.json({
        success: true,
        message: 'Recently viewed documents cleared',
        clearedCount: deleted
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async clearSingleViewHistory(req, res) {
    try {
      const { documentId } = req.params;
      const userId = req.userId;

      const deletedCount = await prisma.$transaction(async tx => {
        const existingViews = await tx.viewHistory.findMany({
          where: { userId, documentId },
          select: { id: true }
        });

        if (existingViews.length === 0) {
          return 0;
        }

        await tx.viewHistory.deleteMany({
          where: { userId, documentId }
        });

        const distinctViewedDocuments = await countDistinctViewedDocuments(tx, userId);
        await tx.user.update({
          where: { id: userId },
          data: { documentsViewed: distinctViewedDocuments }
        });

        return existingViews.length;
      });

      if (deletedCount === 0) {
        return res.status(404).json({
          success: false,
          message: 'Recently viewed document not found'
        });
      }

      res.json({
        success: true,
        message: 'Recently viewed document cleared',
        clearedCount: deletedCount
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
}

module.exports = new DocumentController();
