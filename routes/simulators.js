const express = require('express');

const { db, getNextId } = require('../db');
const { adminMiddleware, authMiddleware } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');
const { deleteRefsInChunks, normalizeId, toInt, toNumber } = require('../utils/firestore');
const { normalizeBoolean, normalizeConversation, normalizeInteger, rejectUnknownFields, sanitizePlainText } = require('../utils/inputSecurity');
const { recalculateRanking } = require('../services/rankingService');

const router = express.Router();

function sortByOrderIndex(left, right) {
  const orderDiff = toInt(left.order_index) - toInt(right.order_index);
  if (orderDiff !== 0) return orderDiff;
  return Number(left.id) - Number(right.id);
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { moduleId } = req.query;
    if (!moduleId) {
      return res.status(400).json({ success: false, message: 'moduleId e obrigatorio' });
    }

    const moduleIdInt = toInt(moduleId);
    const [simulatorsSnapshot, progressDoc] = await Promise.all([
      db.collection('simulators').where('module_id', '==', moduleIdInt).get(),
      db.collection('user_progress').doc(`${normalizeId(req.user.id)}_${moduleIdInt}`).get(),
    ]);

    const activeSimulators = simulatorsSnapshot.docs.filter((doc) => doc.data().is_active !== false);
    const progress = progressDoc.exists ? progressDoc.data() : null;

    const data = await Promise.all(activeSimulators.map(async (simulatorDoc) => {
      const simulator = simulatorDoc.data();
      const questionsSnapshot = await db.collection('simulator_questions')
        .where('simulator_id', '==', simulatorDoc.id)
        .get();

      const questions = questionsSnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .sort(sortByOrderIndex)
        .map((question, index) => ({ ...question, displayOrder: index + 1 }));

      return {
        id: simulatorDoc.id,
        moduleId: simulator.module_id,
        title: simulator.title,
        description: simulator.description,
        scenario: simulator.scenario,
        questions,
      };
    }));

    return res.json({
      success: true,
      completed: progress?.simulator_completed === true,
      bestScore: toNumber(progress?.simulator_best_score),
      data,
    });
  } catch (error) {
    console.error('Erro ao buscar simuladores:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar simuladores' });
  }
});

router.post('/submit', authMiddleware, async (req, res) => {
  try {
    const fieldError = rejectUnknownFields(req.body, ['simulatorId', 'moduleId', 'score', 'feedback', 'conversation']);
    if (fieldError) {
      return res.status(400).json({ success: false, message: fieldError });
    }

    const { simulatorId, moduleId } = req.body;
    const safeScore = normalizeInteger(req.body.score, { min: 0, max: 20, fallback: 0 });
    const feedback = sanitizePlainText(req.body.feedback, { maxLength: 1000, allowEmpty: true }) || '';
    const conversation = normalizeConversation(req.body.conversation, { maxMessages: 60, maxTextLength: 1200 });
    if (!simulatorId) {
      return res.status(400).json({ success: false, message: 'simulatorId e obrigatorio' });
    }

    const userId = normalizeId(req.user.id);
    const attemptId = await getNextId('simulator_attempts');
    let resolvedModuleId = moduleId;

    if (!resolvedModuleId) {
      const simulatorDoc = await db.collection('simulators').doc(normalizeId(simulatorId)).get();
      resolvedModuleId = simulatorDoc.exists ? simulatorDoc.data().module_id : null;
    }

    await db.collection('simulator_attempts').doc(String(attemptId)).set({
      user_id: userId,
      simulator_id: normalizeId(simulatorId),
      score: safeScore,
      feedback,
      conversation: JSON.stringify(conversation),
      completed_at: new Date().toISOString(),
    });

    if (resolvedModuleId) {
      const moduleIdInt = toInt(resolvedModuleId);
      const moduleDoc = await db.collection('modules').doc(String(moduleIdInt)).get();
      const phaseId = moduleDoc.exists ? moduleDoc.data().phase_id : 1;
      const progressRef = db.collection('user_progress').doc(`${userId}_${moduleIdInt}`);
      const progressDoc = await progressRef.get();
      const currentBestScore = progressDoc.exists ? toNumber(progressDoc.data().simulator_best_score) : 0;

      await progressRef.set({
        user_id: userId,
        module_id: moduleIdInt,
        phase_id: phaseId,
        simulator_completed: true,
        simulator_best_score: Math.max(currentBestScore, safeScore),
      }, { merge: true });
    }

    await recalculateRanking(userId);
    return res.json({ success: true, message: 'Simulador concluido e salvo' });
  } catch (error) {
    console.error('Erro ao salvar simulador:', error);
    return res.status(500).json({ success: false, message: 'Erro ao salvar resultado' });
  }
});

router.get('/admin/list', adminMiddleware, async (req, res) => {
  try {
    const [simulatorsSnapshot, questionsSnapshot, modulesSnapshot, phasesSnapshot] = await Promise.all([
      db.collection('simulators').get(),
      db.collection('simulator_questions').get(),
      db.collection('modules').get(),
      db.collection('phases').get(),
    ]);

    const allQuestions = questionsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const phaseMetaById = {};
    const moduleMetaById = {};

    phasesSnapshot.docs
      .map((doc) => ({
        id: doc.id,
        title: doc.data().title || '',
        orderIndex: toInt(doc.data().order_index),
      }))
      .sort((left, right) => {
        if (left.orderIndex !== right.orderIndex) return left.orderIndex - right.orderIndex;
        return Number(left.id) - Number(right.id);
      })
      .forEach((phase, index) => {
        phaseMetaById[phase.id] = { title: phase.title, displayOrder: index + 1 };
      });

    const moduleDisplayCountByPhase = {};
    modulesSnapshot.docs
      .map((doc) => ({
        id: doc.id,
        phaseId: doc.data().phase_id,
        title: doc.data().title || '',
        orderIndex: toInt(doc.data().order_index),
      }))
      .sort((left, right) => {
        const phaseDiff = toInt(left.phaseId) - toInt(right.phaseId);
        if (phaseDiff !== 0) return phaseDiff;
        if (left.orderIndex !== right.orderIndex) return left.orderIndex - right.orderIndex;
        return Number(left.id) - Number(right.id);
      })
      .forEach((moduleItem) => {
        const phaseKey = normalizeId(moduleItem.phaseId || '');
        moduleDisplayCountByPhase[phaseKey] = (moduleDisplayCountByPhase[phaseKey] || 0) + 1;
        moduleMetaById[moduleItem.id] = {
          title: moduleItem.title,
          phaseId: moduleItem.phaseId,
          displayOrder: moduleDisplayCountByPhase[phaseKey],
        };
      });

    const data = simulatorsSnapshot.docs
      .map((simulatorDoc) => {
        const simulator = simulatorDoc.data();
        const moduleMeta = moduleMetaById[normalizeId(simulator.module_id)] || {};
        const phaseMeta = phaseMetaById[normalizeId(moduleMeta.phaseId)] || {};

        return {
          id: simulatorDoc.id,
          ...simulator,
          module_title: moduleMeta.title || '',
          module_display_order: moduleMeta.displayOrder || 0,
          phase_title: phaseMeta.title || '',
          phase_display_order: phaseMeta.displayOrder || 0,
          questions: allQuestions
            .filter((question) => question.simulator_id === simulatorDoc.id)
            .sort((left, right) => toInt(left.order_index) - toInt(right.order_index))
            .map((question, index) => ({ ...question, displayOrder: index + 1 })),
        };
      })
      .sort((left, right) => {
        const phaseDiff = toInt(left.phase_display_order) - toInt(right.phase_display_order);
        if (phaseDiff !== 0) return phaseDiff;
        const moduleDiff = toInt(left.module_display_order) - toInt(right.module_display_order);
        if (moduleDiff !== 0) return moduleDiff;
        return Number(left.id) - Number(right.id);
      })
      .map((simulator, index) => ({ ...simulator, displayOrder: index + 1 }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error('Erro ao buscar simuladores:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar simuladores' });
  }
});

router.post('/admin/create', adminMiddleware, async (req, res) => {
  try {
    const fieldError = rejectUnknownFields(req.body, ['moduleId', 'title', 'description', 'scenario']);
    if (fieldError) {
      return res.status(400).json({ success: false, message: fieldError });
    }

    const { moduleId } = req.body;
    const title = sanitizePlainText(req.body.title, { maxLength: 160, allowEmpty: false });
    const description = sanitizePlainText(req.body.description, { maxLength: 500, allowEmpty: true }) || '';
    const scenario = sanitizePlainText(req.body.scenario, { maxLength: 4000, allowEmpty: false });
    if (!moduleId || !title || !scenario) {
      return res.status(400).json({ success: false, message: 'moduleId, title e scenario sao obrigatorios' });
    }

    const simulatorId = await getNextId('simulators');
    await db.collection('simulators').doc(String(simulatorId)).set({
      module_id: toInt(moduleId),
      title,
      description: description || '',
      scenario,
      is_active: true,
      created_at: new Date().toISOString(),
    });

    return res.json({ success: true, data: { id: simulatorId } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao criar simulador' });
  }
});

router.get('/admin/:id/questions', adminMiddleware, async (req, res) => {
  try {
    const snapshot = await db.collection('simulator_questions')
      .where('simulator_id', '==', req.params.id)
      .get();

    const data = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort(sortByOrderIndex)
      .map((question, index) => ({ ...question, displayOrder: index + 1 }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error('Erro ao buscar perguntas do simulador:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar perguntas' });
  }
});

router.post('/admin/:id/questions', adminMiddleware, async (req, res) => {
  try {
    const fieldError = rejectUnknownFields(req.body, ['question']);
    if (fieldError) {
      return res.status(400).json({ success: false, message: fieldError });
    }

    const question = sanitizePlainText(req.body.question, { maxLength: 500, allowEmpty: false });
    if (!question) {
      return res.status(400).json({ success: false, message: 'Pergunta e obrigatoria' });
    }

    const snapshot = await db.collection('simulator_questions')
      .where('simulator_id', '==', req.params.id)
      .get();

    const nextIndex = snapshot.docs.reduce((max, doc) => {
      return Math.max(max, toInt(doc.data().order_index));
    }, 0) + 1;

    const questionId = await getNextId('simulator_questions');
    await db.collection('simulator_questions').doc(String(questionId)).set({
      simulator_id: req.params.id,
      question,
      order_index: nextIndex,
    });

    return res.json({ success: true, data: { id: questionId } });
  } catch (error) {
    console.error('Erro ao criar pergunta do simulador:', error);
    return res.status(500).json({ success: false, message: 'Erro ao criar pergunta' });
  }
});

router.delete('/admin/questions/:id', adminMiddleware, async (req, res) => {
  try {
    await db.collection('simulator_questions').doc(req.params.id).delete();
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao remover pergunta' });
  }
});

router.put('/admin/:id', adminMiddleware, async (req, res) => {
  try {
    const fieldError = rejectUnknownFields(req.body, ['title', 'description', 'scenario', 'isActive']);
    if (fieldError) {
      return res.status(400).json({ success: false, message: fieldError });
    }

    const { isActive } = req.body;
    const fields = {};

    if (req.body.title !== undefined) {
      const safeTitle = sanitizePlainText(req.body.title, { maxLength: 160, allowEmpty: false });
      if (!safeTitle) return res.status(400).json({ success: false, message: 'title nao pode ser vazio' });
      fields.title = safeTitle;
    }
    if (req.body.description !== undefined) fields.description = sanitizePlainText(req.body.description, { maxLength: 500, allowEmpty: true }) || '';
    if (req.body.scenario !== undefined) {
      const safeScenario = sanitizePlainText(req.body.scenario, { maxLength: 4000, allowEmpty: false });
      if (!safeScenario) return res.status(400).json({ success: false, message: 'scenario nao pode ser vazio' });
      fields.scenario = safeScenario;
    }
    if (isActive !== undefined) fields.is_active = normalizeBoolean(isActive, true);

    if (!Object.keys(fields).length) {
      return res.status(400).json({ success: false, message: 'Nenhum campo para atualizar' });
    }

    await db.collection('simulators').doc(req.params.id).update(fields);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao atualizar simulador' });
  }
});

router.delete('/admin/:id', adminMiddleware, async (req, res) => {
  try {
    const simulatorId = req.params.id;
    const [questionsSnapshot, attemptsSnapshot] = await Promise.all([
      db.collection('simulator_questions').where('simulator_id', '==', simulatorId).get(),
      db.collection('simulator_attempts').where('simulator_id', '==', simulatorId).get(),
    ]);

    const refs = [
      ...questionsSnapshot.docs.map((doc) => doc.ref),
      ...attemptsSnapshot.docs.map((doc) => doc.ref),
      db.collection('simulators').doc(simulatorId),
    ];

    await deleteRefsInChunks(db, refs, 400);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao remover simulador' });
  }
});

router.get('/admin/attempts', adminMiddleware, async (req, res) => {
  try {
    const { simulatorId, userId } = req.query;
    const snapshot = await db.collection('simulator_attempts').get();

    const filteredDocs = snapshot.docs
      .filter((doc) => {
        const attempt = doc.data();
        if (simulatorId && attempt.simulator_id !== simulatorId) return false;
        if (userId && attempt.user_id !== normalizeId(userId)) return false;
        return true;
      })
      .sort((left, right) => String(right.data().completed_at || '').localeCompare(String(left.data().completed_at || '')))
      .slice(0, 200);

    const results = [];
    for (const doc of filteredDocs) {
      const attempt = doc.data();
      const [userDoc, simulatorDoc] = await Promise.all([
        db.collection('users').doc(normalizeId(attempt.user_id)).get(),
        db.collection('simulators').doc(normalizeId(attempt.simulator_id)).get(),
      ]);

      if (!userDoc.exists || userDoc.data().role !== 'OPERATOR' || !simulatorDoc.exists) {
        continue;
      }

      const moduleDoc = await db.collection('modules').doc(normalizeId(simulatorDoc.data().module_id)).get();
      let conversation = [];
      try {
        conversation = JSON.parse(attempt.conversation || '[]');
      } catch (error) {
        conversation = [];
      }

      results.push({
        id: doc.id,
        score: attempt.score,
        feedback: attempt.feedback,
        conversation,
        completed_at: attempt.completed_at,
        user_name: userDoc.data().name,
        avatar_initials: userDoc.data().avatar_initials,
        avatar_color: userDoc.data().avatar_color,
        sim_title: simulatorDoc.data().title,
        scenario: simulatorDoc.data().scenario,
        module_title: moduleDoc.exists ? moduleDoc.data().title || '' : '',
      });
    }

    return res.json({ success: true, data: results });
  } catch (error) {
    console.error('Erro ao buscar tentativas:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar tentativas' });
  }
});

router.post('/admin/evaluate/:id', adminMiddleware, async (req, res) => {
  try {
    const fieldError = rejectUnknownFields(req.body, ['score', 'feedback']);
    if (fieldError) {
      return res.status(400).json({ success: false, message: fieldError });
    }

    const nextScore = normalizeInteger(req.body.score, { min: 0, max: 20, fallback: 0 });
    const feedback = sanitizePlainText(req.body.feedback, { maxLength: 1000, allowEmpty: true }) || '';
    const attemptRef = db.collection('simulator_attempts').doc(req.params.id);
    const attemptDoc = await attemptRef.get();

    if (!attemptDoc.exists) {
      return res.status(404).json({ success: false, message: 'Tentativa nao encontrada' });
    }

    await attemptRef.update({ score: nextScore, feedback });

    const attempt = attemptDoc.data();
    const simulatorDoc = await db.collection('simulators').doc(normalizeId(attempt.simulator_id)).get();
    const simulatorTitle = simulatorDoc.exists ? simulatorDoc.data().title || 'Simulador' : 'Simulador';

    if (simulatorDoc.exists) {
      const moduleId = simulatorDoc.data().module_id;
      const progressRef = db.collection('user_progress').doc(`${attempt.user_id}_${moduleId}`);
      const progressDoc = await progressRef.get();
      const currentBestScore = progressDoc.exists ? toNumber(progressDoc.data().simulator_best_score) : 0;

      if (nextScore > currentBestScore) {
        await progressRef.set({ simulator_best_score: nextScore }, { merge: true });
      }
    }

    await recalculateRanking(attempt.user_id);
    await createNotification({
      userId: attempt.user_id,
      type: 'simulator_feedback',
      title: 'Novo feedback do simulador',
      message: `Seu simulador "${simulatorTitle}" foi avaliado pelo admin.`,
      data: {
        attemptId: req.params.id,
        simulatorId: normalizeId(attempt.simulator_id),
        simulatorTitle,
        score: nextScore,
        feedback: feedback || '',
      },
    });

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao avaliar' });
  }
});

module.exports = router;
