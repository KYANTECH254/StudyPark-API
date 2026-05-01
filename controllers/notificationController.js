const prisma = require('../db');

function toUnifiedNotification(notification) {
  return {
    id: notification.id,
    userId: notification.userId ?? null,
    title: notification.title,
    message: notification.message,
    type: notification.type,
    isRead: Boolean(notification.isRead),
    actionUrl: notification.actionUrl ?? null,
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt,
    source: notification.source
  };
}

class NotificationController {
  // ==================== Get Notifications ====================

  // Get user's notifications
  async getAll(req, res) {
    try {
      const userId = req.userId;
      const { unreadOnly } = req.query;

      const [personalNotifications, appNotifications] = await Promise.all([
        prisma.notification.findMany({
          where: {
            userId,
            ...(unreadOnly === 'true' ? { isRead: false } : {})
          },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.appNotification.findMany({
          where: {
            ...(unreadOnly === 'true'
              ? {
                  reads: {
                    none: {
                      userId,
                      readAt: { not: null },
                      deletedAt: null
                    }
                  }
                }
              : {})
          },
          include: {
            reads: {
              where: { userId },
              take: 1
            }
          },
          orderBy: { createdAt: 'desc' }
        })
      ]);

      const mergedNotifications = [
        ...personalNotifications.map((notification) =>
          toUnifiedNotification({ ...notification, source: 'personal' })
        ),
        ...appNotifications
          .filter((notification) => !notification.reads[0]?.deletedAt)
          .map((notification) =>
            toUnifiedNotification({
              id: notification.id,
              userId: null,
              title: notification.title,
              message: notification.message,
              type: notification.type,
              isRead: Boolean(notification.reads[0]?.readAt),
              actionUrl: notification.actionUrl,
              createdAt: notification.createdAt,
              updatedAt: notification.updatedAt,
              source: 'app'
            })
          )
      ].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));

      const unreadCount =
        personalNotifications.filter((notification) => !notification.isRead).length +
        appNotifications.filter(
          (notification) => !notification.reads[0]?.readAt && !notification.reads[0]?.deletedAt
        ).length;

      res.json({ success: true, notifications: mergedNotifications, unreadCount });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  // Get single notification
  async getById(req, res) {
    try {
      const { id } = req.params;
      const userId = req.userId;

      const notification = await prisma.notification.findFirst({
        where: { id, userId }
      });

      if (notification) {
        return res.json({
          success: true,
          notification: toUnifiedNotification({ ...notification, source: 'personal' })
        });
      }

      const appNotification = await prisma.appNotification.findFirst({
        where: { id },
        include: {
          reads: {
            where: { userId },
            take: 1
          }
        }
      });

      if (!appNotification || appNotification.reads[0]?.deletedAt) {
        return res.status(404).json({ success: false, message: 'Notification not found' });
      }

      res.json({
        success: true,
        notification: toUnifiedNotification({
          id: appNotification.id,
          userId: null,
          title: appNotification.title,
          message: appNotification.message,
          type: appNotification.type,
          isRead: Boolean(appNotification.reads[0]?.readAt),
          actionUrl: appNotification.actionUrl,
          createdAt: appNotification.createdAt,
          updatedAt: appNotification.updatedAt,
          source: 'app'
        })
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  // ==================== Mark as Read ====================

  // Mark single notification as read
  async markAsRead(req, res) {
    try {
      const { id } = req.params;
      const userId = req.userId;

      const notification = await prisma.notification.updateMany({
        where: { id, userId },
        data: { isRead: true }
      });

      if (notification.count > 0) {
        return res.json({ success: true, message: 'Notification marked as read' });
      }

      const appNotification = await prisma.appNotification.findFirst({ where: { id } });
      if (!appNotification) {
        return res.status(404).json({ success: false, message: 'Notification not found' });
      }

      await prisma.appNotificationRead.upsert({
        where: {
          appNotificationId_userId: {
            appNotificationId: id,
            userId
          }
        },
        update: {
          readAt: new Date(),
          deletedAt: null
        },
        create: {
          appNotificationId: id,
          userId,
          readAt: new Date()
        }
      });

      res.json({ success: true, message: 'Notification marked as read' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  // Mark all notifications as read
  async markAllAsRead(req, res) {
    try {
      const userId = req.userId;

      await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true }
      });

      const appNotifications = await prisma.appNotification.findMany({
        select: { id: true }
      });

      const now = new Date();

      await prisma.appNotificationRead.updateMany({
        where: {
          userId,
          deletedAt: null,
          readAt: null
        },
        data: { readAt: now }
      });

      if (appNotifications.length) {
        await prisma.appNotificationRead.createMany({
          data: appNotifications.map((notification) => ({
            appNotificationId: notification.id,
            userId,
            readAt: now
          })),
          skipDuplicates: true
        });
      }

      res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  // ==================== Delete Notifications ====================

  // Delete single notification
  async delete(req, res) {
    try {
      const { id } = req.params;
      const userId = req.userId;

      const deletedPersonal = await prisma.notification.deleteMany({
        where: { id, userId }
      });

      if (deletedPersonal.count === 0) {
        const appNotification = await prisma.appNotification.findFirst({ where: { id } });
        if (!appNotification) {
          return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        await prisma.appNotificationRead.upsert({
          where: {
            appNotificationId_userId: {
              appNotificationId: id,
              userId
            }
          },
          update: {
            deletedAt: new Date()
          },
          create: {
            appNotificationId: id,
            userId,
            deletedAt: new Date()
          }
        });
      }

      res.json({ success: true, message: 'Notification deleted' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  // Delete all read notifications
  async deleteRead(req, res) {
    try {
      const userId = req.userId;

      await prisma.notification.deleteMany({
        where: { userId, isRead: true }
      });

      await prisma.appNotificationRead.updateMany({
        where: {
          userId,
          readAt: { not: null },
          deletedAt: null
        },
        data: {
          deletedAt: new Date()
        }
      });

      res.json({ success: true, message: 'Read notifications deleted' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  // ==================== Admin - Create Notifications ====================

  // Create notification for a specific user
  async create(req, res) {
    try {
      const { userId, title, message, type, actionUrl, isGlobal } = req.body;

      if (!title || !message) {
        return res.status(400).json({ success: false, message: 'Title and message are required' });
      }

      const shouldCreateGlobal = isGlobal === true || !userId;
      const notification = shouldCreateGlobal
        ? await prisma.appNotification.create({
            data: {
              title,
              message,
              type: type || 'GENERAL',
              actionUrl: actionUrl || null,
              createdById: req.userId
            }
          })
        : await prisma.notification.create({
            data: {
              userId,
              title,
              message,
              type: type || 'GENERAL',
              actionUrl: actionUrl || null
            }
          });

      res.status(201).json({ success: true, notification });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  // Broadcast notification to all users
  async broadcast(req, res) {
    try {
      const { title, message, type, actionUrl } = req.body;

      if (!title || !message) {
        return res.status(400).json({ success: false, message: 'Title and message are required' });
      }

      const notification = await prisma.appNotification.create({
        data: {
          title,
          message,
          type: type || 'GENERAL',
          actionUrl: actionUrl || null,
          createdById: req.userId
        }
      });

      res.status(201).json({
        success: true,
        message: 'Broadcast notification created successfully.',
        notification
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
}

module.exports = new NotificationController();
