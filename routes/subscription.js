const express = require('express');
const SubscriptionController = require('../controllers/subscriptionController');
const { authMiddleware } = require('./auth');

const router = express.Router();

// ==================== Subscription Routes (Protected) ====================

// Get current subscription
router.get('/subscription', authMiddleware, SubscriptionController.getSubscription);

// Create new subscription
router.post('/subscription', authMiddleware, SubscriptionController.create);

// Cancel subscription
router.post('/subscription/cancel', authMiddleware, SubscriptionController.cancel);

// ==================== Payment Routes (Protected) ====================

// Create payment
router.post('/payment', authMiddleware, SubscriptionController.createPayment);

// M-Pesa STK callback
router.post('/payment/callback', SubscriptionController.handleStkCallback);

// Get payment history
router.get('/payments', authMiddleware, SubscriptionController.getPayments);

// Update payment status (webhook - may not need auth)
router.put('/payment/:id/status', SubscriptionController.updatePaymentStatus);

module.exports = router;
