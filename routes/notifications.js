const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { serializeNotification } = require('../utils/notifications');

router.get('/', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const snap = await db.collection('notifications')
      .where('user_id', '==', String(req.user.id))
      .get();

    const allNotifications = snap.docs
      .map(serializeNotification)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const notifications = allNotifications.slice(0, limit);
    const unreadCount = allNotifications.filter(notification => !notification.isRead).length;

    res.json({
      success: true,
      data: notifications,
      unreadCount
    });
  } catch (err) {
    console.error('Erro ao buscar notificacoes:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar notificacoes' });
  }
});

router.post('/read-all', authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection('notifications')
      .where('user_id', '==', String(req.user.id))
      .get();

    const unreadDocs = snap.docs.filter(doc => doc.data().is_read !== true);

    if (unreadDocs.length) {
      const batch = db.batch();
      unreadDocs.forEach(doc => batch.update(doc.ref, { is_read: true }));
      await batch.commit();
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao marcar notificacoes como lidas:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar notificacoes' });
  }
});

router.post('/:id/read', authMiddleware, async (req, res) => {
  try {
    const ref = db.collection('notifications').doc(String(req.params.id));
    const doc = await ref.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Notificacao nao encontrada' });
    }

    if (doc.data().user_id !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Acesso negado' });
    }

    await ref.update({ is_read: true });
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao marcar notificacao como lida:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar notificacao' });
  }
});

module.exports = router;
