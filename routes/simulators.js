// routes/simulators.js — Firebase Firestore
const express = require('express');
const router  = express.Router();
const { db, getNextId } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { recalculateRanking } = require('./quiz');

// IDs são sempre strings no Firestore
function uid(id) { return String(id); }

// GET /api/simulators?moduleId=1
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { moduleId } = req.query;
    if (!moduleId) return res.status(400).json({ success: false, message: 'moduleId é obrigatório' });

    // Bug fix: dois .where() em campos diferentes requer índice composto.
    // Filtramos is_active em memória para evitar dependência do índice.
    const simsSnap = await db.collection('simulators')
      .where('module_id', '==', parseInt(moduleId))
      .get();

    const activeSims = simsSnap.docs.filter(d => d.data().is_active !== false);

    // Verifica progresso do usuário neste módulo
    const moduleIdInt = parseInt(moduleId);
    const progressDoc = await db.collection('user_progress')
      .doc(`${uid(req.user.id)}_${moduleIdInt}`)
      .get();

    const progress  = progressDoc.exists ? progressDoc.data() : null;
    const completed = progress?.simulator_completed === true;
    const bestScore = parseFloat(progress?.simulator_best_score || 0);

    const data = await Promise.all(activeSims.map(async simDoc => {
      const s = simDoc.data();
      // Bug fix: where deve vir antes de orderBy para funcionar sem índice extra
      const qSnap = await db.collection('simulator_questions')
        .where('simulator_id', '==', simDoc.id)
        .get();
      return {
        id:          simDoc.id,
        moduleId:    s.module_id,
        title:       s.title,
        description: s.description,
        scenario:    s.scenario,
        questions:   qSnap.docs
          .map(q => ({ id: q.id, ...q.data() }))
          .sort((a, b) => (Number(a.order_index) || 0) - (Number(b.order_index) || 0) || Number(a.id) - Number(b.id))
      };
    }));

    res.json({ success: true, completed, bestScore, data });
  } catch (err) {
    console.error('Erro ao buscar simuladores:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar simuladores' });
  }
});

// POST /api/simulators/submit
router.post('/submit', authMiddleware, async (req, res) => {
  try {
    const { simulatorId, moduleId, score, feedback, conversation } = req.body;
    if (!simulatorId) return res.status(400).json({ success: false, message: 'simulatorId é obrigatório' });

    const userIdStr = uid(req.user.id);

    // Busca o moduleId do simulador se não foi enviado
    let modId = moduleId;
    if (!modId) {
      const simDoc = await db.collection('simulators').doc(uid(simulatorId)).get();
      modId = simDoc.exists ? simDoc.data().module_id : null;
    }

    // Salva a tentativa — user_id sempre string
    const attemptId = await getNextId('simulator_attempts');
    await db.collection('simulator_attempts').doc(String(attemptId)).set({
      user_id:      userIdStr,
      simulator_id: uid(simulatorId),
      score:        score || 0,
      feedback:     feedback || '',
      conversation: JSON.stringify(conversation || []),
      completed_at: new Date().toISOString()
    });

    // Atualiza user_progress — marca simulador como concluído
    if (modId) {
      const modIdInt = parseInt(modId);
      const modDoc   = await db.collection('modules').doc(String(modIdInt)).get();
      const phaseId  = modDoc.exists ? modDoc.data().phase_id : 1;
      const progressKey = `${userIdStr}_${modIdInt}`;
      const progressRef = db.collection('user_progress').doc(progressKey);
      const progressDoc = await progressRef.get();

      const currentBest = progressDoc.exists
        ? (parseFloat(progressDoc.data().simulator_best_score) || 0)
        : 0;

      await progressRef.set({
        user_id:              userIdStr,
        module_id:            modIdInt,
        phase_id:             phaseId,
        simulator_completed:  true,
        simulator_best_score: Math.max(currentBest, score || 0)
      }, { merge: true });
    }

    await recalculateRanking(userIdStr);

    res.json({ success: true, message: 'Simulador concluído e salvo' });
  } catch (err) {
    console.error('Erro ao salvar simulador:', err);
    res.status(500).json({ success: false, message: 'Erro ao salvar resultado' });
  }
});

// ── ADMIN ENDPOINTS ───────────────────────────────────────────────────────────

// GET /api/simulators/admin/list
router.get('/admin/list', adminMiddleware, async (req, res) => {
  try {
    const simsSnap     = await db.collection('simulators').get();
    const questionsSnap = await db.collection('simulator_questions').get();
    const questionsAll  = questionsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const data = await Promise.all(simsSnap.docs.map(async simDoc => {
      const s = simDoc.data();

      const modDoc = await db.collection('modules').doc(uid(s.module_id)).get();
      const mod = modDoc.exists ? modDoc.data() : {};

      let phaseTitle = '';
      if (mod.phase_id) {
        const phaseDoc = await db.collection('phases').doc(uid(mod.phase_id)).get();
        if (phaseDoc.exists) phaseTitle = phaseDoc.data().title;
      }

      return {
        id:           simDoc.id,
        ...s,
        module_title: mod.title || '',
        phase_title:  phaseTitle,
        questions:    questionsAll
          .filter(q => q.simulator_id === simDoc.id)
          .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
      };
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('Erro ao buscar simuladores:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar simuladores' });
  }
});

// POST /api/simulators/admin/create
router.post('/admin/create', adminMiddleware, async (req, res) => {
  try {
    const { moduleId, title, description, scenario } = req.body;
    if (!moduleId || !title || !scenario)
      return res.status(400).json({ success: false, message: 'moduleId, title e scenario são obrigatórios' });

    const newId = await getNextId('simulators');
    await db.collection('simulators').doc(String(newId)).set({
      module_id:   parseInt(moduleId),
      title,
      description: description || '',
      scenario,
      is_active:   true,
      created_at:  new Date().toISOString()
    });

    res.json({ success: true, data: { id: newId } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao criar simulador' });
  }
});

// GET /api/simulators/admin/:id/questions
router.get('/admin/:id/questions', adminMiddleware, async (req, res) => {
  try {
    // Bug fix: where antes de orderBy
    const snap = await db.collection('simulator_questions')
      .where('simulator_id', '==', req.params.id)
      .get();
    res.json({ success: true, data: snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (Number(a.order_index) || 0) - (Number(b.order_index) || 0) || Number(a.id) - Number(b.id)) });
  } catch (err) {
    console.error('Erro ao buscar perguntas do simulador:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar perguntas' });
  }
});

// POST /api/simulators/admin/:id/questions
router.post('/admin/:id/questions', adminMiddleware, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ success: false, message: 'Pergunta é obrigatória' });

    // Bug fix: where antes de orderBy
    const snap = await db.collection('simulator_questions')
      .where('simulator_id', '==', req.params.id)
      .get();
    const nextIndex = snap.docs.reduce((max, doc) => {
      return Math.max(max, Number(doc.data().order_index) || 0);
    }, 0) + 1;

    const newId = await getNextId('simulator_questions');
    await db.collection('simulator_questions').doc(String(newId)).set({
      simulator_id: req.params.id,
      question,
      order_index:  nextIndex
    });

    res.json({ success: true, data: { id: newId } });
  } catch (err) {
    console.error('Erro ao criar pergunta do simulador:', err);
    res.status(500).json({ success: false, message: 'Erro ao criar pergunta' });
  }
});

// DELETE /api/simulators/admin/questions/:id
router.delete('/admin/questions/:id', adminMiddleware, async (req, res) => {
  try {
    await db.collection('simulator_questions').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao remover pergunta' });
  }
});

// PUT /api/simulators/admin/:id
router.put('/admin/:id', adminMiddleware, async (req, res) => {
  try {
    const { title, description, scenario, isActive } = req.body;
    await db.collection('simulators').doc(req.params.id).update({
      title,
      description: description || '',
      scenario,
      is_active:   !!isActive
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao atualizar simulador' });
  }
});

// DELETE /api/simulators/admin/:id
router.delete('/admin/:id', adminMiddleware, async (req, res) => {
  try {
    await db.collection('simulators').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao remover simulador' });
  }
});

// GET /api/simulators/admin/attempts
// Bug fix: .where() deve vir ANTES de .orderBy(); filtros opcionais construídos antes de finalizar a query
router.get('/admin/attempts', adminMiddleware, async (req, res) => {
  try {
    const { simulatorId, userId } = req.query;

    const snap = await db.collection('simulator_attempts').get();
    const filteredDocs = snap.docs
      .filter(doc => {
        const data = doc.data();
        if (simulatorId && data.simulator_id !== simulatorId) return false;
        if (userId && data.user_id !== uid(userId)) return false;
        return true;
      })
      .sort((a, b) => String(b.data().completed_at || '').localeCompare(String(a.data().completed_at || '')))
      .slice(0, 200);

    const results = [];

    for (const doc of filteredDocs) {
      const att = doc.data();

      const userDoc = await db.collection('users').doc(uid(att.user_id)).get();
      if (!userDoc.exists || userDoc.data().role !== 'OPERATOR') continue;
      const user = userDoc.data();

      const simDoc = await db.collection('simulators').doc(uid(att.simulator_id)).get();
      if (!simDoc.exists) continue;
      const sim = simDoc.data();

      const modDoc = await db.collection('modules').doc(uid(sim.module_id)).get();
      const mod = modDoc.exists ? modDoc.data() : {};

      let conversation = [];
      try { conversation = JSON.parse(att.conversation || '[]'); } catch {}

      results.push({
        id:              doc.id,
        score:           att.score,
        feedback:        att.feedback,
        conversation,
        completed_at:    att.completed_at,
        user_name:       user.name,
        avatar_initials: user.avatar_initials,
        avatar_color:    user.avatar_color,
        sim_title:       sim.title,
        scenario:        sim.scenario,
        module_title:    mod.title || ''
      });
    }

    res.json({ success: true, data: results });
  } catch (err) {
    console.error('Erro ao buscar tentativas:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar tentativas' });
  }
});

// POST /api/simulators/admin/evaluate/:id
router.post('/admin/evaluate/:id', adminMiddleware, async (req, res) => {
  try {
    const { score, feedback } = req.body;
    await db.collection('simulator_attempts').doc(req.params.id).update({ score, feedback });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao avaliar' });
  }
});

module.exports = router;



