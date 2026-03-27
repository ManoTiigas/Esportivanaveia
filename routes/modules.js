const express = require('express');
const router = express.Router();
const { db, getNextId } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

function mapModule(id, moduleData) {
  return {
    id,
    phaseId: moduleData.phase_id,
    phaseTitle: moduleData.phase_title || '',
    title: moduleData.title,
    description: moduleData.description,
    content: moduleData.content,
    orderIndex: moduleData.order_index,
    isActive: !!moduleData.is_active,
    videoUrl: moduleData.video_url || null,
    pdfUrl: moduleData.pdf_url || null
  };
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
        .orderBy('order_index', 'asc')
        .get();

      const phaseDoc = await db.collection('phases').doc(String(phaseId)).get();
      const phaseTitle = phaseDoc.exists ? phaseDoc.data().title : '';
      const modules = snap.docs.map(doc => mapModule(doc.id, { ...doc.data(), phase_title: phaseTitle }));
      return res.json({ success: true, data: modules });
    }

    const snap = await db.collection('modules').get();
    const phaseIds = [...new Set(snap.docs.map(doc => doc.data().phase_id).filter(Boolean))];
    const phaseTitles = {};

    await Promise.all(phaseIds.map(async phaseIdValue => {
      const phaseDoc = await db.collection('phases').doc(String(phaseIdValue)).get();
      if (phaseDoc.exists) phaseTitles[phaseIdValue] = phaseDoc.data().title;
    }));

    const modules = snap.docs
      .map(doc => ({ doc, data: doc.data() }))
      .sort((a, b) => {
        if (a.data.phase_id !== b.data.phase_id) return (a.data.phase_id || 0) - (b.data.phase_id || 0);
        return (a.data.order_index || 0) - (b.data.order_index || 0);
      })
      .map(({ doc, data }) => mapModule(doc.id, { ...data, phase_title: phaseTitles[data.phase_id] || '' }));

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
    const newId = await getNextId('modules');
    await db.collection('modules').doc(String(newId)).set({
      phase_id: phaseIdInt,
      title,
      description: description || '',
      content: content || '',
      order_index: Number(orderIndex) || 0,
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
