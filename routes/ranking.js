const express = require('express');

const { db } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { toNumber } = require('../utils/firestore');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const rankingSnapshot = await db.collection('rankings').get();

    const rankingItems = rankingSnapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((item) => item.role === 'OPERATOR')
      .sort((left, right) => {
        const pointsDiff = toNumber(right.total_points) - toNumber(left.total_points);
        if (pointsDiff !== 0) return pointsDiff;
        return Number(left.id) - Number(right.id);
      })
      .slice(0, limit);

    const userDocs = await Promise.all(
      rankingItems.map((item) => db.collection('users').doc(item.id).get()),
    );

    const data = rankingItems.map((item, index) => {
      const user = userDocs[index].exists ? userDocs[index].data() : {};

      return {
        id: item.id,
        position: item.rank_position || 0,
        name: user.name || '',
        avatarInitials: user.avatar_initials || '',
        avatarColor: user.avatar_color || '#00C2FF',
        profilePhotoUrl: user.profile_photo_url || null,
        totalPoints: toNumber(item.total_points),
        quizPoints: toNumber(item.quiz_points),
        simulatorPoints: toNumber(item.simulator_points),
        modulesCompleted: item.modules_completed || 0,
      };
    });

    return res.json({ success: true, data });
  } catch (error) {
    console.error('Erro ao buscar ranking:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar ranking' });
  }
});

module.exports = router;
