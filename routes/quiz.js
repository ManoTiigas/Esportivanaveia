const express = require('express');

const { db, getNextId } = require('../db');
const { adminMiddleware, authMiddleware } = require('../middleware/auth');
const { recalculateRanking } = require('../services/rankingService');
const { normalizeId, toInt, toNumber } = require('../utils/firestore');
const { normalizeInteger, rejectUnknownFields, sanitizePlainText } = require('../utils/inputSecurity');

const router = express.Router();

function sortByOrderIndex(left, right) {
  const orderDiff = toInt(left.order_index) - toInt(right.order_index);
  if (orderDiff !== 0) return orderDiff;
  return Number(left.id) - Number(right.id);
}

function serializeQuestion(doc, role) {
  const data = doc.data();
  const question = {
    id: doc.id,
    moduleId: data.module_id,
    question: data.question,
    optionA: data.option_a,
    optionB: data.option_b,
    optionC: data.option_c,
    optionD: data.option_d,
    optionE: data.option_e,
    points: toNumber(data.points),
    orderIndex: toInt(data.order_index),
  };

  if (role === 'ADMIN') {
    question.correctOption = data.correct_option;
    question.explanation = data.explanation || '';
  }

  return question;
}

router.get('/questions', authMiddleware, async (req, res) => {
  try {
    const { moduleId } = req.query;
    if (!moduleId) {
      return res.status(400).json({ success: false, message: 'moduleId e obrigatorio' });
    }

    const snapshot = await db.collection('quiz_questions')
      .where('module_id', '==', toInt(moduleId))
      .get();

    const questions = snapshot.docs
      .map((doc) => serializeQuestion(doc, req.user.role))
      .sort((left, right) => {
        if (left.orderIndex !== right.orderIndex) return left.orderIndex - right.orderIndex;
        return Number(left.id) - Number(right.id);
      })
      .map((question, index) => ({ ...question, displayOrder: index + 1 }));

    return res.json({ success: true, data: questions });
  } catch (error) {
    console.error('Erro ao buscar questoes:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar questoes' });
  }
});

router.post('/questions', adminMiddleware, async (req, res) => {
  try {
    const fieldError = rejectUnknownFields(req.body, [
      'moduleId', 'question', 'optionA', 'optionB', 'optionC', 'optionD', 'optionE',
      'correctOption', 'explanation', 'points', 'orderIndex',
    ]);
    if (fieldError) {
      return res.status(400).json({ success: false, message: fieldError });
    }

    const {
      moduleId,
      question,
      optionA,
      optionB,
      optionC,
      optionD,
      optionE,
      correctOption,
      explanation,
      points = 10,
      orderIndex = 0,
    } = req.body;

    const safeQuestion = sanitizePlainText(question, { maxLength: 500, allowEmpty: false });
    const safeOptionA = sanitizePlainText(optionA, { maxLength: 240, allowEmpty: false });
    const safeOptionB = sanitizePlainText(optionB, { maxLength: 240, allowEmpty: false });
    const safeOptionC = sanitizePlainText(optionC, { maxLength: 240, allowEmpty: false });
    const safeOptionD = sanitizePlainText(optionD, { maxLength: 240, allowEmpty: false });
    const safeOptionE = sanitizePlainText(optionE, { maxLength: 240, allowEmpty: true });
    const safeExplanation = sanitizePlainText(explanation, { maxLength: 1000, allowEmpty: true }) || '';

    if (!moduleId || !safeQuestion || !safeOptionA || !safeOptionB || !safeOptionC || !safeOptionD || !correctOption) {
      return res.status(400).json({ success: false, message: 'Campos obrigatorios faltando' });
    }

    const normalizedCorrectOption = String(correctOption).toUpperCase();
    if (!['A', 'B', 'C', 'D', 'E'].includes(normalizedCorrectOption)) {
      return res.status(400).json({ success: false, message: 'correctOption deve ser A, B, C, D ou E' });
    }

    let normalizedOrderIndex = toInt(orderIndex);
    if (!normalizedOrderIndex) {
      const snapshot = await db.collection('quiz_questions')
        .where('module_id', '==', toInt(moduleId))
        .get();

      normalizedOrderIndex = snapshot.docs.reduce((max, doc) => {
        return Math.max(max, toInt(doc.data().order_index));
      }, 0) + 1;
    }

    const newQuestionId = await getNextId('quiz_questions');
    await db.collection('quiz_questions').doc(String(newQuestionId)).set({
      module_id: toInt(moduleId),
      question: safeQuestion,
      option_a: safeOptionA,
      option_b: safeOptionB,
      option_c: safeOptionC,
      option_d: safeOptionD,
      option_e: safeOptionE || null,
      correct_option: normalizedCorrectOption,
      explanation: safeExplanation,
      points: normalizeInteger(points, { min: 0, max: 1000, fallback: 10 }),
      order_index: normalizeInteger(normalizedOrderIndex, { min: 1, max: 100000, fallback: 1 }),
      created_at: new Date().toISOString(),
    });

    return res.json({ success: true, data: { id: newQuestionId } });
  } catch (error) {
    console.error('Erro ao criar questao:', error);
    return res.status(500).json({ success: false, message: 'Erro ao criar questao' });
  }
});

router.delete('/questions/:id', adminMiddleware, async (req, res) => {
  try {
    await db.collection('quiz_questions').doc(req.params.id).delete();
    return res.json({ success: true, message: 'Questao removida' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao remover questao' });
  }
});

router.post('/submit', authMiddleware, async (req, res) => {
  try {
    const fieldError = rejectUnknownFields(req.body, ['moduleId', 'answers']);
    if (fieldError) {
      return res.status(400).json({ success: false, message: fieldError });
    }

    const { moduleId, answers } = req.body;
    if (!moduleId) {
      return res.status(400).json({ success: false, message: 'moduleId e obrigatorio' });
    }

    const userId = normalizeId(req.user.id);
    const moduleIdInt = toInt(moduleId);
    const existingAttemptSnapshot = await db.collection('quiz_attempts')
      .where('user_id', '==', userId)
      .where('module_id', '==', moduleIdInt)
      .limit(1)
      .get();

    if (!existingAttemptSnapshot.empty) {
      const existingAttempt = existingAttemptSnapshot.docs[0].data() || {};
      return res.status(409).json({
        success: false,
        message: 'Quiz ja concluido. Cada modulo permite apenas uma tentativa.',
        data: {
          score: toNumber(existingAttempt.score),
          correct: toInt(existingAttempt.correct_answers),
          total: toInt(existingAttempt.total_questions),
          pointsEarned: 0,
          alreadyCompleted: true,
        },
      });
    }

    const snapshot = await db.collection('quiz_questions')
      .where('module_id', '==', moduleIdInt)
      .get();

    const questions = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort(sortByOrderIndex);

    let correctAnswers = 0;
    let totalPoints = 0;
    const feedback = [];

    questions.forEach((question) => {
      const selectedOption = answers && answers[question.id] ? String(answers[question.id]).toUpperCase() : null;
      const isCorrect = selectedOption === question.correct_option;

      if (isCorrect) {
        correctAnswers += 1;
        totalPoints += toNumber(question.points);
      }

      feedback.push({
        questionId: question.id,
        selected: selectedOption,
        correct: question.correct_option,
        isCorrect,
        explanation: question.explanation,
      });
    });

    const totalQuestions = questions.length;
    const percentage = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;
    const attemptId = `${userId}_${moduleIdInt}`;
    const attemptRef = db.collection('quiz_attempts').doc(attemptId);

    try {
      await attemptRef.create({
        user_id: userId,
        module_id: moduleIdInt,
        score: totalPoints,
        total_questions: totalQuestions,
        correct_answers: correctAnswers,
        completed_at: new Date().toISOString(),
      });
    } catch (writeError) {
      const alreadyExists = writeError && (
        writeError.code === 6
        || writeError.code === 'already-exists'
        || /already exists/i.test(String(writeError.message || ''))
      );

      if (alreadyExists) {
        return res.status(409).json({
          success: false,
          message: 'Quiz ja concluido. Cada modulo permite apenas uma tentativa.',
        });
      }

      throw writeError;
    }

    const batch = db.batch();
    questions.forEach((question) => {
      const selectedOption = answers && answers[question.id] ? String(answers[question.id]).toUpperCase() : null;
      const isCorrect = selectedOption === question.correct_option;

      batch.set(db.collection('quiz_answers').doc(`${attemptId}_${question.id}`), {
        attempt_id: attemptId,
        question_id: question.id,
        selected_option: selectedOption,
        is_correct: isCorrect,
      });
    });
    await batch.commit();

    const moduleDoc = await db.collection('modules').doc(String(moduleId)).get();
    const phaseId = moduleDoc.exists ? moduleDoc.data().phase_id : 1;
    await db.collection('user_progress').doc(`${userId}_${moduleId}`).set({
      user_id: userId,
      module_id: moduleIdInt,
      phase_id: phaseId,
      quiz_completed: true,
    }, { merge: true });

    await recalculateRanking(userId);

    return res.json({
      success: true,
      data: {
        score: totalPoints,
        correct: correctAnswers,
        total: totalQuestions,
        percentage,
        pointsEarned: totalPoints,
        feedback,
      },
    });
  } catch (error) {
    console.error('Erro ao submeter quiz:', error);
    return res.status(500).json({ success: false, message: 'Erro ao salvar resultado' });
  }
});

module.exports = router;
