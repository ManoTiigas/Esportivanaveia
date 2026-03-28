// routes/phases.js — Firebase Firestore
const express = require('express');
const router  = express.Router();
const { db, getNextId } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

function mapPhase(id, p) {
  return {
    id:          id,
    title:       p.title,
    description: p.description,
    icon:        p.icon,
    color:       p.color,
    orderIndex:  Number(p.order_index) || 0,
    isActive:    !!p.is_active,
    isLocked:    !!p.is_locked
  };
}

function sortPhases(phases) {
  return [...phases].sort((a, b) => {
    if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
    return Number(a.id) - Number(b.id);
  });
}

// GET /api/phases
router.get('/', authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection('phases').get();
    const phases = sortPhases(snap.docs.map(doc => mapPhase(doc.id, doc.data())))
      .map((phase, index) => ({
        ...phase,
        displayOrder: index + 1
      }));
    res.json({ success: true, data: phases });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar fases' });
  }
});

// POST /api/phases — admin only
router.post('/', adminMiddleware, async (req, res) => {
  try {
    const { title, description, icon = '📚', color = '#00C2FF', orderIndex = 0, isLocked = false } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Título é obrigatório' });

    const newId = await getNextId('phases');
    await db.collection('phases').doc(String(newId)).set({
      title,
      description:  description || '',
      icon,
      color,
      order_index:  Number(orderIndex) || 0,
      is_active:    true,
      is_locked:    !!isLocked,
      created_by:   req.user.id,
      created_at:   new Date().toISOString()
    });

    res.json({ success: true, data: { id: newId } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao criar fase' });
  }
});

// POST /api/phases/:id/toggle — admin only
router.post('/:id/toggle', adminMiddleware, async (req, res) => {
  try {
    const ref = db.collection('phases').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ success: false, message: 'Fase não encontrada' });

    await ref.update({ is_locked: !doc.data().is_locked });
    res.json({ success: true, message: 'Fase atualizada' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao atualizar fase' });
  }
});

// DELETE /api/phases/:id — admin only
router.delete('/:id', adminMiddleware, async (req, res) => {
  try {
    const ref = db.collection('phases').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ success: false, message: 'Fase não encontrada' });

    await ref.delete();
    res.json({ success: true, message: 'Fase removida' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao remover fase' });
  }
});

module.exports = router;
