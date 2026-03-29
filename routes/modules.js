const express = require('express');
const router = express.Router();
const { db, getNextId } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

function mapModule(id, moduleData) {
  return {
    id,
    phaseId: moduleData.phase_id,
    phaseTitle: moduleData.phase_title || '',
    phaseDisplayOrder: Number(moduleData.phase_display_order) || 0,
    title: moduleData.title,
    description: moduleData.description,
    content: moduleData.content,
    orderIndex: Number(moduleData.order_index) || 0,
    isActive: !!moduleData.is_active,
    videoUrl: moduleData.video_url || null,
    pdfUrl: moduleData.pdf_url || null
  };
}

function sortModules(modules) {
  return [...modules].sort((a, b) => {
    if (a.phaseId !== b.phaseId) return (a.phaseId || 0) - (b.phaseId || 0);
    if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
    return Number(a.id) - Number(b.id);
  });
}

async function getUserProgressByModule(userId, phaseId, modules = []) {
  const userIdStr = String(userId);
  const moduleIdsInPhase = new Set(modules.map(module => String(module.id)));

  const [progressSnap, quizAttemptsSnap, simulatorAttemptsSnap, simulatorsSnap] = await Promise.all([
    db.collection('user_progress')
      .where('user_id', '==', userIdStr)
      .get(),
    db.collection('quiz_attempts')
      .where('user_id', '==', userIdStr)
      .get(),
    db.collection('simulator_attempts')
      .where('user_id', '==', userIdStr)
      .get(),
    db.collection('simulators').get()
  ]);

  const simulatorToModuleMap = simulatorsSnap.docs.reduce((acc, doc) => {
    const data = doc.data() || {};
    acc[String(doc.id)] = String(data.module_id);
    return acc;
  }, {});

  const progressByModule = progressSnap.docs.reduce((acc, doc) => {
    const progress = doc.data() || {};
    if (phaseId && Number(progress.phase_id) !== Number(phaseId)) return acc;

    const moduleId = String(progress.module_id);
    if (moduleIdsInPhase.size && !moduleIdsInPhase.has(moduleId)) return acc;

    acc[moduleId] = {
      quizCompleted: progress.quiz_completed === true,
      simulatorCompleted: progress.simulator_completed === true
    };
    return acc;
  }, {});

  quizAttemptsSnap.docs.forEach(doc => {
    const attempt = doc.data() || {};
    const moduleId = String(attempt.module_id);
    if (moduleIdsInPhase.size && !moduleIdsInPhase.has(moduleId)) return;

    progressByModule[moduleId] = {
      ...(progressByModule[moduleId] || {}),
      quizCompleted: true,
      simulatorCompleted: progressByModule[moduleId]?.simulatorCompleted === true
    };
  });

  simulatorAttemptsSnap.docs.forEach(doc => {
    const attempt = doc.data() || {};
    const moduleId = simulatorToModuleMap[String(attempt.simulator_id)];
    if (!moduleId) return;
    if (moduleIdsInPhase.size && !moduleIdsInPhase.has(moduleId)) return;

    progressByModule[moduleId] = {
      ...(progressByModule[moduleId] || {}),
      quizCompleted: progressByModule[moduleId]?.quizCompleted === true,
      simulatorCompleted: true
    };
  });

  return progressByModule;
}

function attachModuleAvailability(modules, progressByModule, isAdmin) {
  if (isAdmin) {
    return modules.map(module => ({
      ...module,
      isUnlocked: true,
      isCompleted: !!progressByModule[String(module.id)]?.simulatorCompleted
    }));
  }

  return modules.map((module, index) => {
    const currentProgress = progressByModule[String(module.id)] || {};
    const previousModule = index > 0 ? modules[index - 1] : null;
    const previousProgress = previousModule ? (progressByModule[String(previousModule.id)] || {}) : null;
    const isUnlocked = index === 0 || previousProgress?.simulatorCompleted === true;

    return {
      ...module,
      isUnlocked,
      isCompleted: currentProgress.simulatorCompleted === true,
      quizCompleted: currentProgress.quizCompleted === true,
      simulatorCompleted: currentProgress.simulatorCompleted === true
    };
  });
}

async function getNextModuleOrderIndex(phaseId) {
  const snap = await db.collection('modules')
    .where('phase_id', '==', phaseId)
    .get();

  return snap.docs.reduce((max, doc) => {
    return Math.max(max, Number(doc.data().order_index) || 0);
  }, 0) + 1;
}

async function deleteDocsByRefs(refs) {
  const chunkSize = 400;
  for (let i = 0; i < refs.length; i += chunkSize) {
    const batch = db.batch();
    refs.slice(i, i + chunkSize).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { phaseId } = req.query;

    if (phaseId) {
      const phaseIdInt = parseInt(phaseId, 10);
      const snap = await db.collection('modules')
        .where('phase_id', '==', phaseIdInt)
        .get();

      const phaseDoc = await db.collection('phases').doc(String(phaseId)).get();
      const phaseTitle = phaseDoc.exists ? phaseDoc.data().title : '';
      const modules = snap.docs
        .map(doc => mapModule(doc.id, { ...doc.data(), phase_title: phaseTitle }))
        .sort((a, b) => a.orderIndex - b.orderIndex || Number(a.id) - Number(b.id))
        .map((module, index) => ({
          ...module,
          displayOrder: index + 1
        }));
      const progressByModule = await getUserProgressByModule(req.user.id, phaseIdInt, modules);
      const modulesWithAvailability = attachModuleAvailability(
        modules,
        progressByModule,
        req.user.role === 'ADMIN'
      );
      return res.json({ success: true, data: modulesWithAvailability });
    }

    const snap = await db.collection('modules').get();
    const phaseTitles = {};
    const phaseDisplayOrders = {};
    const phasesSnap = await db.collection('phases').get();
    const sortedPhases = phasesSnap.docs
      .map(doc => ({
        id: doc.id,
        title: doc.data().title,
        orderIndex: Number(doc.data().order_index) || 0
      }))
      .sort((a, b) => a.orderIndex - b.orderIndex || Number(a.id) - Number(b.id));

    sortedPhases.forEach((phase, index) => {
      phaseTitles[phase.id] = phase.title;
      phaseDisplayOrders[phase.id] = index + 1;
    });

    const sortedModules = sortModules(
      snap.docs.map(doc => mapModule(doc.id, {
        ...doc.data(),
        phase_title: phaseTitles[doc.data().phase_id] || '',
        phase_display_order: phaseDisplayOrders[doc.data().phase_id] || 0
      }))
    );

    const displayOrderByPhase = {};
    const modules = sortedModules.map(module => {
      const phaseKey = String(module.phaseId || '');
      displayOrderByPhase[phaseKey] = (displayOrderByPhase[phaseKey] || 0) + 1;
      return {
        ...module,
        displayOrder: displayOrderByPhase[phaseKey]
      };
    });

    res.json({ success: true, data: modules });
  } catch (err) {
    console.error('Erro ao buscar modulos:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar modulos' });
  }
});

router.post('/', adminMiddleware, async (req, res) => {
  try {
    const { phaseId, title, description, content, orderIndex = 0 } = req.body;
    if (!phaseId || !title) {
      return res.status(400).json({ success: false, message: 'phaseId e title sao obrigatorios' });
    }

    const phaseIdInt = parseInt(phaseId, 10);
    const normalizedOrderIndex = Number(orderIndex) > 0
      ? Number(orderIndex)
      : await getNextModuleOrderIndex(phaseIdInt);
    const newId = await getNextId('modules');
    await db.collection('modules').doc(String(newId)).set({
      phase_id: phaseIdInt,
      title,
      description: description || '',
      content: content || '',
      order_index: normalizedOrderIndex,
      is_active: true,
      video_url: null,
      pdf_url: null,
      created_by: String(req.user.id),
      created_at: new Date().toISOString()
    });

    res.json({ success: true, data: { id: newId } });
  } catch (err) {
    console.error('Erro ao criar modulo:', err);
    res.status(500).json({ success: false, message: 'Erro ao criar modulo' });
  }
});

router.put('/:id', adminMiddleware, async (req, res) => {
  try {
    const { title, description, content, isActive, phaseId, orderIndex, videoUrl, pdfUrl } = req.body;
    const moduleRef = db.collection('modules').doc(req.params.id);
    const moduleDoc = await moduleRef.get();
    if (!moduleDoc.exists) return res.status(404).json({ success: false, message: 'Modulo nao encontrado' });

    const fields = {};
    if (title !== undefined) fields.title = title;
    if (description !== undefined) fields.description = description;
    if (content !== undefined) fields.content = content;
    if (isActive !== undefined) fields.is_active = !!isActive;
    if (phaseId !== undefined) fields.phase_id = parseInt(phaseId, 10);
    if (orderIndex !== undefined) fields.order_index = Number(orderIndex) || 0;
    if (videoUrl !== undefined) fields.video_url = videoUrl || null;
    if (pdfUrl !== undefined) fields.pdf_url = pdfUrl || null;

    if (!Object.keys(fields).length) {
      return res.status(400).json({ success: false, message: 'Nenhum campo para atualizar' });
    }

    await moduleRef.update(fields);
    res.json({ success: true, message: 'Modulo atualizado' });
  } catch (err) {
    console.error('Erro ao atualizar modulo:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar modulo' });
  }
});

router.delete('/:id', adminMiddleware, async (req, res) => {
  try {
    const moduleId = String(req.params.id);
    const moduleRef = db.collection('modules').doc(moduleId);
    const moduleDoc = await moduleRef.get();
    if (!moduleDoc.exists) return res.status(404).json({ success: false, message: 'Modulo nao encontrado' });

    const moduleIdInt = parseInt(moduleId, 10);
    const quizQuestionsSnap = await db.collection('quiz_questions').where('module_id', '==', moduleIdInt).get();
    const quizAttemptsSnap = await db.collection('quiz_attempts').where('module_id', '==', moduleIdInt).get();
    const progressSnap = await db.collection('user_progress').where('module_id', '==', moduleIdInt).get();
    const simulatorsSnap = await db.collection('simulators').where('module_id', '==', moduleIdInt).get();

    const simulatorIds = simulatorsSnap.docs.map(doc => doc.id);
    const simulatorQuestionRefs = [];
    const simulatorAttemptRefs = [];

    for (const simulatorId of simulatorIds) {
      const [questionsSnap, attemptsSnap] = await Promise.all([
        db.collection('simulator_questions').where('simulator_id', '==', simulatorId).get(),
        db.collection('simulator_attempts').where('simulator_id', '==', simulatorId).get()
      ]);
      simulatorQuestionRefs.push(...questionsSnap.docs.map(doc => doc.ref));
      simulatorAttemptRefs.push(...attemptsSnap.docs.map(doc => doc.ref));
    }

    const quizAnswerRefs = [];
    for (const attemptDoc of quizAttemptsSnap.docs) {
      const answersSnap = await db.collection('quiz_answers').where('attempt_id', '==', attemptDoc.id).get();
      quizAnswerRefs.push(...answersSnap.docs.map(doc => doc.ref));
    }

    await deleteDocsByRefs([
      ...quizQuestionsSnap.docs.map(doc => doc.ref),
      ...quizAttemptsSnap.docs.map(doc => doc.ref),
      ...quizAnswerRefs,
      ...progressSnap.docs.map(doc => doc.ref),
      ...simulatorsSnap.docs.map(doc => doc.ref),
      ...simulatorQuestionRefs,
      ...simulatorAttemptRefs,
      moduleRef
    ]);

    res.json({ success: true, message: 'Modulo removido' });
  } catch (err) {
    console.error('Erro ao remover modulo:', err);
    res.status(500).json({ success: false, message: 'Erro ao remover modulo' });
  }
});

router.post('/:id/toggle', adminMiddleware, async (req, res) => {
  try {
    const moduleRef = db.collection('modules').doc(req.params.id);
    const moduleDoc = await moduleRef.get();
    if (!moduleDoc.exists) return res.status(404).json({ success: false, message: 'Modulo nao encontrado' });

    await moduleRef.update({ is_active: !moduleDoc.data().is_active });
    res.json({ success: true, message: 'Modulo atualizado' });
  } catch (err) {
    console.error('Erro ao alternar modulo:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar modulo' });
  }
});

module.exports = router;


