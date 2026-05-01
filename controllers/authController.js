const prisma = require('../db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { buildUserUniversityData } = require('../services/metadataService');

const DEFAULT_USER_TOKEN_LIFETIME = '30d';
const DEFAULT_ADMIN_TOKEN_LIFETIME = '30d';
const DURATION_UNITS_TO_MS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000
};

function normalizeDevicePublicKey(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '')
    .trim();

  return normalized || null;
}

function getTokenLifetimeForUser(user) {
  if (user?.isAdmin) {
    return process.env.ADMIN_JWT_EXPIRES_IN || process.env.JWT_EXPIRES_IN || DEFAULT_ADMIN_TOKEN_LIFETIME;
  }

  return process.env.USER_JWT_EXPIRES_IN || process.env.JWT_EXPIRES_IN || DEFAULT_USER_TOKEN_LIFETIME;
}

function durationToMilliseconds(duration) {
  if (typeof duration === 'number' && Number.isFinite(duration)) {
    return duration;
  }

  const normalized = String(duration || '').trim().toLowerCase();
  const match = normalized.match(/^(\d+)(ms|s|m|h|d)$/);

  if (!match) {
    return 60 * 60 * 1000;
  }

  const [, amount, unit] = match;
  return Number.parseInt(amount, 10) * DURATION_UNITS_TO_MS[unit];
}

function createSessionToken(user) {
  const expiresIn = getTokenLifetimeForUser(user);
  const token = jwt.sign(
    { userId: user.id, isAdmin: user.isAdmin },
    process.env.JWT_SECRET,
    { expiresIn }
  );
  const expiresAt = new Date(Date.now() + durationToMilliseconds(expiresIn));

  return { token, expiresAt };
}

class AuthController {
  async register(req, res) {
    try {
      const { email, fullName, password, confirmPassword, university, devicePublicKey } = req.body;

      // Validate required fields
      if (!email || !fullName || !password || !confirmPassword || !university) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
      }

      // Check if passwords match
      if (password !== confirmPassword) {
        return res.status(400).json({ success: false, message: 'Passwords do not match' });
      }

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ success: false, message: 'User already exists' });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Create new user
      const user = await prisma.user.create({
        data: {
          email,
          fullName,
          password: hashedPassword,
          ...(await buildUserUniversityData(prisma, university))
        }
      });

      // Generate JWT token (includes isAdmin for role-based access)
      const { token, expiresAt } = createSessionToken(user);

      // Create a session for the issued registration token so protected routes
      // that require an active session accept the token immediately.
      await prisma.session.create({
        data: {
          userId: user.id,
          token,
          devicePublicKey: normalizeDevicePublicKey(devicePublicKey),
          expiresAt
        }
      });

      // Get active subscription
      const subscription = await prisma.subscription.findFirst({
        where: { userId: user.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' }
      });

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          university: user.university,
          course: user.course,
          yearOfStudy: user.yearOfStudy,
          documentsDownloaded: user.documentsDownloaded,
          documentsViewed: user.documentsViewed,
          favoritesCount: user.favoritesCount,
          studyStreak: user.studyStreak,
          isPremium: user.isPremium,
          isAdmin: user.isAdmin,
          plan: subscription ? {
            planType: subscription.planType,
            status: subscription.status,
            startDate: subscription.startDate,
            endDate: subscription.endDate
          } : null
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async login(req, res) {
    try {
      const { email, password, devicePublicKey } = req.body;

      // Validate required fields
      if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required' });
      }

      // Find user by email
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return res.status(400).json({ success: false, message: 'Invalid credentials' });
      }

      // Check password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Invalid credentials' });
      }

      // Non-admin users are limited to one active session at a time.
      const activeSession = user.isAdmin
        ? null
        : await prisma.session.findFirst({
            where: {
              userId: user.id,
              isActive: true,
              expiresAt: { gt: new Date() }
            }
          });

      if (activeSession) {
        return res.status(403).json({
          success: false,
          message: 'You are already logged in. Please log out first before logging in again.'
        });
      }

      // Generate JWT token (includes isAdmin for role-based access)
      const { token, expiresAt } = createSessionToken(user);

      // Create new session
      await prisma.session.create({
        data: {
          userId: user.id,
          token,
          devicePublicKey: normalizeDevicePublicKey(devicePublicKey),
          expiresAt
        }
      });

      // Get active subscription
      const subscription = await prisma.subscription.findFirst({
        where: { userId: user.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' }
      });

      res.json({
        success: true,
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          university: user.university,
          course: user.course,
          yearOfStudy: user.yearOfStudy,
          documentsDownloaded: user.documentsDownloaded,
          documentsViewed: user.documentsViewed,
          favoritesCount: user.favoritesCount,
          studyStreak: user.studyStreak,
          isPremium: user.isPremium,
          isAdmin: user.isAdmin,
          plan: subscription ? {
            planType: subscription.planType,
            status: subscription.status,
            startDate: subscription.startDate,
            endDate: subscription.endDate
          } : null
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async updateProfile(req, res) {
    try {
      const userId = req.userId; // Assumes middleware sets this
      const { fullName, university, course, yearOfStudy } = req.body;

      // Find and update user
      const universityData = university
        ? await buildUserUniversityData(prisma, university)
        : {};

      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          ...(fullName && { fullName }),
          ...universityData,
          ...(course && { course }),
          ...(yearOfStudy && { yearOfStudy })
        }
      });

      // Get active subscription
      const subscription = await prisma.subscription.findFirst({
        where: { userId: user.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' }
      });

      res.json({
        success: true,
        message: 'Profile updated successfully',
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          university: user.university,
          course: user.course,
          yearOfStudy: user.yearOfStudy,
          documentsDownloaded: user.documentsDownloaded,
          documentsViewed: user.documentsViewed,
          favoritesCount: user.favoritesCount,
          studyStreak: user.studyStreak,
          isPremium: user.isPremium,
          isAdmin: user.isAdmin,
          plan: subscription ? {
            planType: subscription.planType,
            status: subscription.status,
            startDate: subscription.startDate,
            endDate: subscription.endDate
          } : null
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async getSession(req, res) {
    try {
      const userId = req.userId;
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const subscription = await prisma.subscription.findFirst({
        where: { userId: user.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' }
      });

      res.json({
        success: true,
        token: req.token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          university: user.university,
          course: user.course,
          yearOfStudy: user.yearOfStudy,
          documentsDownloaded: user.documentsDownloaded,
          documentsViewed: user.documentsViewed,
          favoritesCount: user.favoritesCount,
          studyStreak: user.studyStreak,
          isPremium: user.isPremium,
          isAdmin: user.isAdmin,
          plan: subscription ? {
            planType: subscription.planType,
            status: subscription.status,
            startDate: subscription.startDate,
            endDate: subscription.endDate
          } : null
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async logout(req, res) {
    try {
      const token = req.token; // From middleware

      // Deactivate only the current session so admins can keep other sessions active.
      await prisma.session.updateMany({
        where: {
          token,
          isActive: true
        },
        data: {
          isActive: false
        }
      });

      res.json({
        success: true,
        message: 'Logout successful'
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async clearSession(req, res) {
    try {
      const userId = req.userId; // From middleware

      // Delete all sessions for this user
      await prisma.session.deleteMany({
        where: { userId }
      });

      res.json({
        success: true,
        message: 'All sessions cleared successfully'
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
}

module.exports = AuthController;
