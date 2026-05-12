const { db } = require('../db');
const { normalizeId, toNumber, updateDocsInChunks } = require('../utils/firestore');

async function recalculateRanking(userId) {
  const normalizedUserId = normalizeId(userId);
  const userDoc = await db.collection('users').doc(normalizedUserId).get();

  if (!userDoc.exists) return;

  const userRole = userDoc.data().role;
  if (userRole === 'ADMIN') return;

  const [quizAttemptsSnapshot, simulatorAttemptsSnapshot, progressSnapshot] = await Promise.all([
    db.collection('quiz_attempts').where('user_id', '==', normalizedUserId).get(),
    db.collection('simulator_attempts').where('user_id', '==', normalizedUserId).get(),
    db.collection('user_progress')
      .where('user_id', '==', normalizedUserId)
      .where('quiz_completed', '==', true)
      .get(),
  ]);

  const quizPoints = quizAttemptsSnapshot.docs.reduce((sum, doc) => sum + toNumber(doc.data().score), 0);
  const simulatorPoints = simulatorAttemptsSnapshot.docs.reduce((sum, doc) => sum + toNumber(doc.data().score), 0);
  const modulesCompleted = progressSnapshot.size;
  const totalPoints = quizPoints + simulatorPoints;

  await db.collection('rankings').doc(normalizedUserId).set({
    user_id: normalizedUserId,
    role: userRole,
    total_points: totalPoints,
    quiz_points: quizPoints,
    simulator_points: simulatorPoints,
    modules_completed: modulesCompleted,
  }, { merge: true });

  await db.collection('users').doc(normalizedUserId).update({ total_points: totalPoints });

  const rankingSnapshot = await db.collection('rankings').get();
  const rankingUpdates = rankingSnapshot.docs
    .filter((doc) => doc.data().role === 'OPERATOR')
    .sort((left, right) => {
      const pointsDiff = toNumber(right.data().total_points) - toNumber(left.data().total_points);
      if (pointsDiff !== 0) return pointsDiff;
      return left.id.localeCompare(right.id, undefined, { numeric: true });
    })
    .map((doc, index) => ({
      ref: doc.ref,
      data: { rank_position: index + 1 },
    }));

  await updateDocsInChunks(db, rankingUpdates, 400);
}

module.exports = {
  recalculateRanking,
};
