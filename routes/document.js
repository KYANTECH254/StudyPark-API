const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const DocumentController = require('../controllers/documentController');
const { authMiddleware, optionalAuthMiddleware, adminMiddleware } = require('./auth');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads', 'tmp');

fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });

// ==================== Document Routes (Admin) ====================

// List documents for admin dashboard
router.get('/admin/documents', authMiddleware, adminMiddleware, DocumentController.getAdminDocuments);

// Create document (admin)
router.post('/documents', authMiddleware, adminMiddleware, upload.single('file'), DocumentController.create);

// Update document (admin)
router.put('/documents/:id', authMiddleware, adminMiddleware, upload.single('file'), DocumentController.update);

// Delete document (admin)
router.delete('/documents/:id', authMiddleware, adminMiddleware, DocumentController.delete);

// ==================== Document Routes (Public) ====================

// Get all documents with filters
router.get('/documents', optionalAuthMiddleware, DocumentController.getAll);

// Get single document
router.get('/documents/:id', DocumentController.getById);

// Get document rating summary
router.get('/documents/:id/rating', DocumentController.getRatingSummary);

// Get current user's rating for a document
router.get('/documents/:id/user-rating', authMiddleware, DocumentController.getUserRating);

// ==================== Document Routes (User) ====================

// Download document
router.post('/documents/:id/download', authMiddleware, DocumentController.download);

// Rate document
router.post('/documents/:id/rate', authMiddleware, DocumentController.rateDocument);

// Get user's download history
router.get('/downloads', authMiddleware, DocumentController.getDownloads);

// Add to favorites
router.post('/documents/:id/favorite', authMiddleware, DocumentController.addFavorite);

// Remove from favorites
router.delete('/documents/:id/favorite', authMiddleware, DocumentController.removeFavorite);

// Get user's favorites
router.get('/favorites', authMiddleware, DocumentController.getFavorites);

// Record view
router.post('/documents/:id/view', authMiddleware, DocumentController.recordView);

// Get user's view history
router.get('/view-history', authMiddleware, DocumentController.getViewHistory);

// Clear user's view history
router.delete('/view-history', authMiddleware, DocumentController.clearViewHistory);

// Clear one recently viewed document
router.delete('/view-history/:documentId', authMiddleware, DocumentController.clearSingleViewHistory);

module.exports = router;
