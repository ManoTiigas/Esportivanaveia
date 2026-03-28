const { db } = require('../db');

function serializeNotification(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    userId: data.user_id,
    type: data.type || 'general',
    title: data.title || '',
    message: data.message || '',
    isRead: !!data.is_read,
    createdAt: data.created_at || null,
    data: data.data || null
  };
}

async function createNotification({
  userId,
  type = 'general',
  title,
  message,
  data = null
}) {
  if (!userId || !title || !message) return null;

  const payload = {
    user_id: String(userId),
    type,
    title,
    message,
    is_read: false,
    created_at: new Date().toISOString()
  };

  if (data !== null && data !== undefined) {
    payload.data = data;
  }

  return db.collection('notifications').add(payload);
}

async function createNotificationsForUsers(userIds, payload) {
  const ids = [...new Set((userIds || []).map(id => String(id)).filter(Boolean))];
  if (!ids.length) return;

  const CHUNK_SIZE = 400;
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const batch = db.batch();
    ids.slice(i, i + CHUNK_SIZE).forEach(userId => {
      const ref = db.collection('notifications').doc();
      batch.set(ref, {
        user_id: userId,
        type: payload.type || 'general',
        title: payload.title,
        message: payload.message,
        is_read: false,
        created_at: new Date().toISOString(),
        ...(payload.data !== undefined ? { data: payload.data } : {})
      });
    });
    await batch.commit();
  }
}

module.exports = {
  serializeNotification,
  createNotification,
  createNotificationsForUsers
};
