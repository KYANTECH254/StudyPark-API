const express = require('express');
const UserController = require('../controllers/userController');
const { authMiddleware } = require('./auth');

const router = express.Router();

router.post('/study-streak', authMiddleware, UserController.updateStudyStreak.bind(UserController));

module.exports = router;
