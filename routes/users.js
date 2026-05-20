const express = require('express');

const { db } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { getUserById } = require('../services/userService');
const { normalizeId, toNumber } = require('../utils/firestore');

const router = express.Router();

function getModuleDurationHours(moduleData = {}) {
  const minuteCandidates = [
    moduleData.duration_minutes,
    moduleData.estimated_duration_minutes,
    moduleData.video_duration_minutes,
    moduleData.durationMinutes,
    moduleData.estimatedDurationMinutes,
  ];

  const minutes = minuteCandidates
    .map((value) => toNumber(value, 0))
    .find((value) => value > 0);

  return minutes ? minutes / 60 : 0;
}

router.get('/profile-card/:userId', authMiddleware, async (req, res) => {
  try {
    const userId = normalizeId(req.params.userId);
    const user = await getUserById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario nao encontrado' });
    }

    const [rankingDoc, progressSnap, modulesSnap] = await Promise.all([
      db.collection('rankings').doc(userId).get(),
      db.collection('user_progress').where('user_id', '==', userId).get(),
      db.collection('modules').get(),
    ]);

    const modulesById = modulesSnap.docs.reduce((acc, doc) => {
      acc[normalizeId(doc.id)] = doc.data() || {};
      return acc;
    }, {});

    const completedModuleIds = new Set();
    progressSnap.docs.forEach((doc) => {
      const progress = doc.data() || {};
      if (progress.simulator_completed === true || progress.quiz_completed === true) {
        completedModuleIds.add(normalizeId(progress.module_id));
      }
    });

    const hoursViewed = Array.from(completedModuleIds).reduce((total, moduleId) => {
      return total + getModuleDurationHours(modulesById[moduleId]);
    }, 0);

    const rankingData = rankingDoc.exists ? rankingDoc.data() || {} : {};

    return res.json({
      success: true,
      data: {
        id: userId,
        name: user.name || '',
        email: user.email || '',
        role: user.role || 'OPERATOR',
        avatarInitials: user.avatar_initials || '',
        avatarColor: user.avatar_color || '#00C2FF',
        profilePhotoUrl: user.profile_photo_url || null,
        totalPoints: toNumber(rankingData.total_points ?? user.total_points),
        quizPoints: toNumber(rankingData.quiz_points),
        simulatorPoints: toNumber(rankingData.simulator_points),
        rankingPosition: toNumber(rankingData.rank_position),
        modulesCompleted: toNumber(rankingData.modules_completed),
        lessonsViewed: completedModuleIds.size,
        hoursViewed: Number(hoursViewed.toFixed(1)),
      },
    });
  } catch (error) {
    console.error('Erro ao buscar profile card do usuario:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar perfil do usuario' });
  }
});

module.exports = router;
