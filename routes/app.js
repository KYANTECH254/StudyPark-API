const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const AppController = require('../controllers/appController');
const { authMiddleware, adminMiddleware } = require('./auth');

const uploadDir = path.join(__dirname, '..', 'uploads', 'tmp');

fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });
const router = express.Router();

router.post('/upload', authMiddleware, adminMiddleware, upload.single('file'), AppController.upload);
router.get('/version', AppController.version);
router.get('/download', AppController.download);

module.exports = router;
