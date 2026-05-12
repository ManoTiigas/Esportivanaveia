const { db } = require('../db');
const { normalizeId, toNumber } = require('../utils/firestore');

async function getUserByEmail(email) {
  const snapshot = await db.collection('users').where('email', '==', email).limit(1).get();
  if (snapshot.empty) return null;

  const document = snapshot.docs[0];
  return { id: document.id, ...document.data() };
}

async function getUserById(userId) {
  const document = await db.collection('users').doc(normalizeId(userId)).get();
  if (!document.exists) return null;

  return { id: document.id, ...document.data() };
}

function getAvatarInitials(name = '') {
  return String(name)
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase())
    .join('')
    .slice(0, 2);
}

function serializePublicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.is_active !== false,
    avatarInitials: user.avatar_initials,
    avatarColor: user.avatar_color,
    profilePhotoUrl: user.profile_photo_url || null,
    totalPoints: toNumber(user.total_points),
  };
}

module.exports = {
  getAvatarInitials,
  getUserByEmail,
  getUserById,
  serializePublicUser,
};
