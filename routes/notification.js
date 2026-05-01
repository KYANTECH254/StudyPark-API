const express = require('express');
const NotificationController = require('../controllers/notificationController');
const { authMiddleware, adminMiddleware } = require('./auth');

const router = express.Router();

// ==================== User Notification Routes (Protected) ====================

// Get all notifications
router.get('/', authMiddleware, NotificationController.getAll);

// Get single notification
router.get('/:id', authMiddleware, NotificationController.getById);

// Mark as read
router.put('/:id/read', authMiddleware, NotificationController.markAsRead);

// Mark all as read
router.put('/read-all', authMiddleware, NotificationController.markAllAsRead);

// Delete notification
router.delete('/:id', authMiddleware, NotificationController.delete);

// Delete all read notifications
router.delete('/clear/read', authMiddleware, NotificationController.deleteRead);

// ==================== Admin Routes ====================

// Create notification (for specific user or broadcast)
router.post('/', authMiddleware, adminMiddleware, NotificationController.create);

// Broadcast to all users
router.post('/broadcast', authMiddleware, adminMiddleware, NotificationController.broadcast);

module.exports = router;
