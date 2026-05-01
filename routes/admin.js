const express = require('express');
const AdminController = require('../controllers/adminController');
const MetadataController = require('../controllers/metadataController');
const { authMiddleware, adminMiddleware } = require('./auth');

const router = express.Router();

router.get('/settings', authMiddleware, adminMiddleware, AdminController.getAppSettings);
router.put('/settings', authMiddleware, adminMiddleware, AdminController.updateAppSettings);
router.get('/dashboard', authMiddleware, adminMiddleware, AdminController.getDashboard);
router.get('/users', authMiddleware, adminMiddleware, AdminController.getUsers);
router.get('/sessions', authMiddleware, adminMiddleware, AdminController.getSessions);
router.delete('/sessions/:id', authMiddleware, adminMiddleware, AdminController.deleteSession);
router.get('/payments', authMiddleware, adminMiddleware, AdminController.getPayments);
router.put('/payments/:id', authMiddleware, adminMiddleware, AdminController.updatePayment);
router.put('/users/:id/subscription', authMiddleware, adminMiddleware, AdminController.updateUserSubscription);

router.get('/metadata', authMiddleware, adminMiddleware, MetadataController.getAll);
router.post('/metadata', authMiddleware, adminMiddleware, MetadataController.create);
router.delete('/metadata/:kind/:id', authMiddleware, adminMiddleware, MetadataController.remove);

// OAuth Account Management
router.get('/oauth/accounts', authMiddleware, adminMiddleware, AdminController.getOAuthAccounts);
router.get('/oauth/accounts/:accountId', authMiddleware, adminMiddleware, AdminController.getOAuthAccountStats);
router.get('/oauth/best-account', authMiddleware, adminMiddleware, AdminController.getBestOAuthAccount);
router.put('/oauth/accounts/:accountId/active', authMiddleware, adminMiddleware, AdminController.setOAuthAccountActive);

module.exports = router;
