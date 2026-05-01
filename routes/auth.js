const express = require('express');
const crypto = require('crypto');
const AuthController = require('../controllers/authController');
const prisma = require('../db');

const router = express.Router();
const authController = new AuthController();

async function attachAuthenticatedUser(req) {
  const token = req.headers.authorization?.split(' ')[1];
  const signature = req.headers['x-device-signature'];
  const timestamp = req.headers['x-device-timestamp'];

  if (!token) {
    return { authenticated: false, reason: 'No token provided', status: 401 };
  }

  const jwt = require('jsonwebtoken');
  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  const session = await prisma.session.findUnique({
    where: { token },
    include: {
      user: {
        select: {
          id: true,
          isAdmin: true,
          isBlocked: true,
          university: true,
          course: true,
          yearOfStudy: true
        }
      }
    }
  });

  if (!session || !session.user || !session.isActive || session.expiresAt < new Date()) {
    return { authenticated: false, reason: 'Invalid or expired session', status: 401 };
  }

  if (session.user.isBlocked) {
    return { authenticated: false, reason: 'This account has been blocked', status: 403 };
  }

  if (session.devicePublicKey && signature && timestamp) {
    const numericTimestamp = Number.parseInt(timestamp, 10);
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);

    if (!Number.isFinite(numericTimestamp) || numericTimestamp < fiveMinutesAgo) {
      return { authenticated: false, reason: 'Request expired', status: 401 };
    }

    try {
      const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${session.devicePublicKey}\n-----END PUBLIC KEY-----`;
      const verifier = crypto.createVerify('SHA256');

      verifier.update(String(timestamp));
      verifier.end();

      const isValid = verifier.verify(
        { key: publicKeyPem, format: 'pem', type: 'spki' },
        Buffer.from(signature, 'base64')
      );

      if (!isValid) {
        return { authenticated: false, reason: 'Device hardware verification failed', status: 401 };
      }
    } catch (cryptoError) {
      return { authenticated: false, reason: 'Invalid signature format', status: 401 };
    }
  }

  if (session.user.id !== decoded.userId) {
    return { authenticated: false, reason: 'Invalid session user', status: 401 };
  }

  req.userId = session.user.id;
  req.isAdmin = session.user.isAdmin;
  req.user = session.user;
  req.token = token;

  return { authenticated: true };
}

// Middleware to extract userId from JWT token and verify session
const authMiddleware = async (req, res, next) => {
  try {
    const result = await attachAuthenticatedUser(req);
    if (!result.authenticated) {
      return res.status(result.status).json({ success: false, message: result.reason });
    }

    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

const optionalAuthMiddleware = async (req, res, next) => {
  try {
    const hasAuthorizationHeader = Boolean(req.headers.authorization);
    if (!hasAuthorizationHeader) {
      return next();
    }

    const result = await attachAuthenticatedUser(req);
    if (!result.authenticated) {
      req.userId = null;
      req.isAdmin = false;
      req.user = null;
      req.token = null;
    }

    next();
  } catch (error) {
    req.userId = null;
    req.isAdmin = false;
    req.user = null;
    req.token = null;
    next();
  }
};

// Middleware to check if user is admin
const adminMiddleware = (req, res, next) => {
  if (!req.isAdmin) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

router.post('/register', authController.register.bind(authController));
router.post('/login', authController.login.bind(authController));
router.get('/session', authMiddleware, authController.getSession.bind(authController));
router.put('/profile', authMiddleware, authController.updateProfile.bind(authController));
router.post('/logout', authMiddleware, authController.logout.bind(authController));
router.post('/clear-session', authMiddleware, authController.clearSession.bind(authController));

module.exports = { router, authMiddleware, optionalAuthMiddleware, adminMiddleware };
