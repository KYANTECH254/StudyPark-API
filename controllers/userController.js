const prisma = require('../db');

class UserController {
  async updateStudyStreak(req, res) {
    try {
      const userId = req.userId;
      const rawIncrement = req.body?.incrementBy;
      const incrementBy =
        rawIncrement === undefined ? 1 : Number.parseInt(String(rawIncrement), 10);

      if (Number.isNaN(incrementBy) || incrementBy < 1) {
        return res.status(400).json({
          success: false,
          message: 'incrementBy must be a positive integer'
        });
      }

      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          studyStreak: {
            increment: incrementBy
          }
        }
      });

      res.json({
        success: true,
        message: 'Study streak updated successfully',
        studyStreak: user.studyStreak,
        incrementedBy: incrementBy,
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
          isAdmin: user.isAdmin
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
}

module.exports = new UserController();
