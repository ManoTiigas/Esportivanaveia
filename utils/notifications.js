const { db } = require('../db');
const { chunkArray } = require('./firestore');

const MAX_NOTIFICATIONS_PER_USER = 12;

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

  const createdRef = await db.collection('notifications').add(payload);
  await pruneUserNotifications(userId);
  return createdRef;
}

async function pruneUserNotifications(userId) {
  const normalizedUserId = String(userId);
  const snapshot = await db.collection('notifications')
    .where('user_id', '==', normalizedUserId)
    .get();

  const staleDocs = snapshot.docs
    .sort((left, right) => String(right.data().created_at || '').localeCompare(String(left.data().created_at || '')))
    .slice(MAX_NOTIFICATIONS_PER_USER);
  if (!staleDocs.length) return;

  for (const chunk of chunkArray(staleDocs, 400)) {
    const batch = db.batch();
    chunk.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
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

  await Promise.all(ids.map((userId) => pruneUserNotifications(userId)));
}

module.exports = {
  MAX_NOTIFICATIONS_PER_USER,
  pruneUserNotifications,
  serializeNotification,
  createNotification,
  createNotificationsForUsers
};
