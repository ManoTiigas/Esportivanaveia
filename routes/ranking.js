const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const rankingSnap = await db.collection('rankings').get();

    const sorted = rankingSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(item => item.role === 'OPERATOR')
      .sort((a, b) => {
        const pointsDiff = (parseFloat(b.total_points) || 0) - (parseFloat(a.total_points) || 0);
        if (pointsDiff !== 0) return pointsDiff;
        // Tiebreaker estável: ID numérico do usuário (menor ID = cadastrado antes)
        return Number(a.id) - Number(b.id);
      })
      .slice(0, limit);

    // Busca todos os usuários de uma vez para evitar N+1
    const userDocs = await Promise.all(
      sorted.map(item => db.collection('users').doc(item.id).get())
    );

    const results = sorted.map((item, i) => {
      const user = userDocs[i].exists ? userDocs[i].data() : {};
      return {
        position:        item.rank_position || 0,
        name:            user.name || '',
        avatarInitials:  user.avatar_initials || '',
        avatarColor:     user.avatar_color || '#00C2FF',
        profilePhotoUrl: user.profile_photo_url || null,
        totalPoints:     parseFloat(item.total_points) || 0,
        quizPoints:      parseFloat(item.quiz_points) || 0,
        simulatorPoints: parseFloat(item.simulator_points) || 0,
        modulesCompleted: item.modules_completed || 0
      };
    });

    res.json({ success: true, data: results });
  } catch (err) {
    console.error('Erro ao buscar ranking:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar ranking' });
  }
});

module.exports = router;
