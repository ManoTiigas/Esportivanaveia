// routes/quiz.js — Firebase Firestore
const express = require('express');
const router  = express.Router();
const { db, getNextId } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// Normaliza userId para string — IDs são sempre strings no Firestore (doc IDs)
// mas req.user.id vem do JWT como o valor original (pode ser número ou string).
// Usamos sempre String() para garantir consistência.
function uid(id) { return String(id); }

// GET /api/quiz/questions?moduleId=1
// Retorna questões SEM o gabarito (segurança)
router.get('/questions', authMiddleware, async (req, res) => {
  try {
    const { moduleId } = req.query;
    if (!moduleId) return res.status(400).json({ success: false, message: 'moduleId é obrigatório' });

    const snap = await db.collection('quiz_questions')
      .where('module_id', '==', parseInt(moduleId))
      .get();

    const questions = snap.docs
      .map(doc => {
        const q = doc.data();
        const question = {
          id:         doc.id,
          moduleId:   q.module_id,
          question:   q.question,
          optionA:    q.option_a,
          optionB:    q.option_b,
          optionC:    q.option_c,
          optionD:    q.option_d,
          optionE:    q.option_e,
          points:     parseFloat(q.points),
          orderIndex: Number(q.order_index) || 0
        };

        if (req.user.role === 'ADMIN') {
          question.correctOption = q.correct_option;
          question.explanation = q.explanation || '';
        }

        return question;
      })
      .sort((a, b) => a.orderIndex - b.orderIndex || Number(a.id) - Number(b.id))
      .map((question, index) => ({
        ...question,
        displayOrder: index + 1
      }));

    res.json({ success: true, data: questions });
  } catch (err) {
    console.error('Erro ao buscar questões:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar questões' });
  }
});

// POST /api/quiz/questions — admin only
router.post('/questions', adminMiddleware, async (req, res) => {
  try {
    const {
      moduleId, question, optionA, optionB, optionC, optionD, optionE,
      correctOption, explanation, points = 10, orderIndex = 0
    } = req.body;

    if (!moduleId || !question || !optionA || !optionB || !optionC || !optionD || !correctOption)
      return res.status(400).json({ success: false, message: 'Campos obrigatórios faltando' });

    if (!['A','B','C','D','E'].includes(correctOption.toUpperCase()))
      return res.status(400).json({ success: false, message: 'correctOption deve ser A, B, C, D ou E' });

    let normalizedOrderIndex = Number(orderIndex) || 0;
    if (!normalizedOrderIndex) {
      const existingSnap = await db.collection('quiz_questions')
        .where('module_id', '==', parseInt(moduleId))
        .get();
      normalizedOrderIndex = existingSnap.docs.reduce((max, doc) => {
        return Math.max(max, Number(doc.data().order_index) || 0);
      }, 0) + 1;
    }

    const newId = await getNextId('quiz_questions');
    await db.collection('quiz_questions').doc(String(newId)).set({
      module_id:      parseInt(moduleId),
      question,
      option_a:       optionA,
      option_b:       optionB,
      option_c:       optionC,
      option_d:       optionD,
      option_e:       optionE || null,
      correct_option: correctOption.toUpperCase(),
      explanation:    explanation || '',
      points:         parseFloat(points) || 10,
      order_index:    normalizedOrderIndex,
      created_at:     new Date().toISOString()
    });

    res.json({ success: true, data: { id: newId } });
  } catch (err) {
    console.error('Erro ao criar questao:', err);
    res.status(500).json({ success: false, message: 'Erro ao criar questao' });
  }
});

// DELETE /api/quiz/questions/:id — admin only
router.delete('/questions/:id', adminMiddleware, async (req, res) => {
  try {
    await db.collection('quiz_questions').doc(req.params.id).delete();
    res.json({ success: true, message: 'Questão removida' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao remover questão' });
  }
});

// POST /api/quiz/submit
router.post('/submit', authMiddleware, async (req, res) => {
  try {
    const { moduleId, answers } = req.body;
    if (!moduleId) return res.status(400).json({ success: false, message: 'moduleId é obrigatório' });

    // Busca questões COM gabarito (só no servidor)
    const snap = await db.collection('quiz_questions')
      .where('module_id', '==', parseInt(moduleId))
      .get();

    const questions = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (Number(a.order_index) || 0) - (Number(b.order_index) || 0) || Number(a.id) - Number(b.id));

    let correctCount = 0;
    let totalPoints  = 0;
    const feedback   = [];

    for (const q of questions) {
      const selected  = answers && answers[q.id] ? answers[q.id].toUpperCase() : null;
      const isCorrect = selected === q.correct_option;
      if (isCorrect) {
        correctCount++;
        totalPoints += parseFloat(q.points);
      }
      feedback.push({
        questionId:  q.id,
        selected,
        correct:     q.correct_option,
        isCorrect,
        explanation: q.explanation
      });
    }

    const total      = questions.length;
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    // Salvar tentativa
    const attemptId = await getNextId('quiz_attempts');
    const userId    = uid(req.user.id);
    await db.collection('quiz_attempts').doc(String(attemptId)).set({
      user_id:         userId,
      module_id:       parseInt(moduleId),
      score:           totalPoints,
      total_questions: total,
      correct_answers: correctCount,
      completed_at:    new Date().toISOString()
    });

    // Salvar respostas individuais (batch — max 500 ops, suficiente para quizzes)
    const batch = db.batch();
    for (const q of questions) {
      const selected  = answers && answers[q.id] ? answers[q.id].toUpperCase() : null;
      const isCorrect = selected === q.correct_option;
      const ansId = `${attemptId}_${q.id}`;
      batch.set(db.collection('quiz_answers').doc(ansId), {
        attempt_id:      String(attemptId),
        question_id:     q.id,
        selected_option: selected,
        is_correct:      isCorrect
      });
    }
    await batch.commit();

    // Marca quiz como concluído no user_progress
    const modDoc = await db.collection('modules').doc(String(moduleId)).get();
    const phaseId = modDoc.exists ? modDoc.data().phase_id : 1;
    const progressKey = `${userId}_${moduleId}`;
    await db.collection('user_progress').doc(progressKey).set({
      user_id:        userId,
      module_id:      parseInt(moduleId),
      phase_id:       phaseId,
      quiz_completed: true
    }, { merge: true });

    // Atualizar ranking
    await recalculateRanking(userId);

    res.json({
      success: true,
      data: {
        score:        totalPoints,
        correct:      correctCount,
        total,
        percentage,
        pointsEarned: totalPoints,
        feedback
      }
    });
  } catch (err) {
    console.error('Erro ao submeter quiz:', err);
    res.status(500).json({ success: false, message: 'Erro ao salvar resultado' });
  }
});

// Função auxiliar para recalcular ranking
// userId deve ser sempre uma string (doc ID do Firestore)
async function recalculateRanking(userId) {
  const userIdStr = uid(userId);

  const userDoc = await db.collection('users').doc(userIdStr).get();
  if (!userDoc.exists) return;
  const userRole = userDoc.data().role;
  if (userRole === 'ADMIN') return;

  // Soma pontos de quiz — user_id salvo como string
  const quizSnap = await db.collection('quiz_attempts')
    .where('user_id', '==', userIdStr).get();
  const qPts = quizSnap.docs.reduce((s, d) => s + (parseFloat(d.data().score) || 0), 0);

  // Soma pontos de simulador — user_id salvo como string
  const simSnap = await db.collection('simulator_attempts')
    .where('user_id', '==', userIdStr).get();
  const sPts = simSnap.docs.reduce((s, d) => s + (parseFloat(d.data().score) || 0), 0);

  // Módulos concluídos — user_id salvo como string
  const progSnap = await db.collection('user_progress')
    .where('user_id', '==', userIdStr)
    .where('quiz_completed', '==', true).get();
  const modCnt = progSnap.size;

  const total = qPts + sPts;

  await db.collection('rankings').doc(userIdStr).set({
    user_id:           userIdStr,
    role:              userRole,
    total_points:      total,
    quiz_points:       qPts,
    simulator_points:  sPts,
    modules_completed: modCnt
  }, { merge: true });

  // Atualiza total_points no usuário
  await db.collection('users').doc(userIdStr).update({ total_points: total });

  // Recalcula posições — busca apenas OPERATORs no ranking (campo role desnormalizado)
  // Coleta todos os docs ANTES de iniciar o batch (sem await dentro do batch)
  const allRankSnap = await db.collection('rankings').get();

  const rankingUpdates = allRankSnap.docs
    .filter(doc => doc.data().role === 'OPERATOR')
    .sort((a, b) => {
      const pointsDiff = (parseFloat(b.data().total_points) || 0) - (parseFloat(a.data().total_points) || 0);
      if (pointsDiff !== 0) return pointsDiff;
      return a.id.localeCompare(b.id, undefined, { numeric: true });
    })
    .map((doc, i) => ({ ref: doc.ref, pos: i + 1 }));

  // Batch em chunks de 500 (limite do Firestore)
  const CHUNK = 500;
  for (let i = 0; i < rankingUpdates.length; i += CHUNK) {
    const batch = db.batch();
    rankingUpdates.slice(i, i + CHUNK).forEach(({ ref, pos }) => {
      batch.update(ref, { rank_position: pos });
    });
    await batch.commit();
  }
}

router.recalculateRanking = recalculateRanking;
module.exports = router;





