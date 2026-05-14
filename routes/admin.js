// routes/admin.js — Gerenciamento de usuários (admin only) — Firebase Firestore
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { db, getNextId } = require('../db');
const { adminMiddleware } = require('../middleware/auth');
const { getAvatarInitials, serializePublicUser } = require('../services/userService');
const { normalizeId, toInt, toNumber } = require('../utils/firestore');
const { normalizeBoolean, normalizeHexColor, rejectUnknownFields, sanitizePlainText } = require('../utils/inputSecurity');
const { validatePassword } = require('../utils/validation');

const VALID_ROLES = ['ADMIN', 'OPERATOR'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/admin/users?limit=50&cursor=<created_at ISO do último item>
router.get('/users', adminMiddleware, async (req, res) => {
  try {
    const pageSize = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const cursor   = req.query.cursor;

    let query = db.collection('users').orderBy('created_at', 'desc').limit(pageSize);
    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    const users = snap.docs.map(doc => {
      const u = doc.data();
      return {
        ...serializePublicUser({ id: doc.id, ...u }),
        createdAt: u.created_at
      };
    });

    const nextCursor = snap.docs.length === pageSize
      ? snap.docs[snap.docs.length - 1].data().created_at
      : null;

    res.json({ success: true, data: users, nextCursor });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários' });
  }
});

// GET /api/admin/recent-completions — últimas conclusões reais
router.get('/recent-completions', adminMiddleware, async (req, res) => {
  try {
    // Busca as últimas 10 tentativas de quiz de operadores
    const attSnap = await db.collection('quiz_attempts')
      .orderBy('completed_at', 'desc')
      .limit(30)
      .get();

    const results = [];

    for (const attDoc of attSnap.docs) {
      const att = attDoc.data();

      const [userDoc, modDoc, simSnap] = await Promise.all([
        db.collection('users').doc(normalizeId(att.user_id)).get(),
        db.collection('modules').doc(normalizeId(att.module_id)).get(),
        db.collection('simulators').where('module_id', '==', toInt(att.module_id)).limit(1).get(),
      ]);

      if (!userDoc.exists) continue;
      const user = userDoc.data();
      if (user.role !== 'OPERATOR') continue;
      if (!modDoc.exists) continue;
      const mod = modDoc.data();

      let simScore = 0;
      if (!simSnap.empty) {
        const simId = simSnap.docs[0].id;
        const simAttSnap = await db.collection('simulator_attempts')
          .where('user_id', '==', String(att.user_id))
          .where('simulator_id', '==', simId)
          .get();
        if (!simAttSnap.empty) {
          simScore = simAttSnap.docs.reduce((best, doc) => {
            const s = toNumber(doc.data().score);
            return s > best ? s : best;
          }, 0);
        }
      }

      results.push({
        name:           user.name,
        avatarInitials: user.avatar_initials,
        avatarColor:    user.avatar_color,
        profilePhotoUrl: user.profile_photo_url || null,
        moduleTitle:    mod.title,
        quizScore:      toNumber(att.score),
        simScore,
        completedAt:    att.completed_at
      });

      if (results.length >= 10) break;
    }

    res.json({ success: true, data: results });
  } catch (err) {
    console.error('Erro ao buscar conclusões:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar conclusões' });
  }
});

// POST /api/admin/users
router.post('/users', adminMiddleware, async (req, res) => {
  try {
    const fieldError = rejectUnknownFields(req.body, ['name', 'email', 'password', 'role', 'avatarColor']);
    if (fieldError)
      return res.status(400).json({ success: false, message: fieldError });

    const { email, password, role = 'OPERATOR', avatarColor = '#00C2FF' } = req.body;
    const name = sanitizePlainText(req.body.name, { maxLength: 120, allowEmpty: false });

    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: 'Nome, e-mail e senha são obrigatórios' });

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail))
      return res.status(400).json({ success: false, message: 'E-mail inválido' });

    const pwdError = validatePassword(String(password));
    if (pwdError) return res.status(400).json({ success: false, message: pwdError });

    const roleUpper = String(role).toUpperCase();
    if (!VALID_ROLES.includes(roleUpper))
      return res.status(400).json({ success: false, message: 'Role inválida. Use ADMIN ou OPERATOR' });

    // Verifica e-mail duplicado
    const existing = await db.collection('users').where('email', '==', normalizedEmail).limit(1).get();
    if (!existing.empty)
      return res.status(400).json({ success: false, message: 'E-mail já cadastrado' });

    const initials = getAvatarInitials(name);
    const hash     = await bcrypt.hash(password, 10);
    const newId    = await getNextId('users');

    await db.collection('users').doc(String(newId)).set({
      name,
      email: normalizedEmail,
      password: hash,
      role:     roleUpper,
      is_active:       true,
      avatar_initials: initials,
      avatar_color:    normalizeHexColor(avatarColor),
      profile_photo_url: null,
      profile_photo_path: null,
      total_points:    0,
      created_at:      new Date().toISOString()
    });

    // Criar entrada no ranking apenas para operadores
    // Bug fix: inclui role no doc de ranking para evitar N+1 lookup na listagem
    if (roleUpper === 'OPERATOR') {
      await db.collection('rankings').doc(String(newId)).set({
        user_id:           String(newId),
        role:              'OPERATOR',
        total_points:      0,
        quiz_points:       0,
        simulator_points:  0,
        modules_completed: 0,
        rank_position:     0
      });
    }

    res.json({ success: true, data: { id: newId } });
  } catch (err) {
    console.error('Erro ao criar usuário:', err);
    res.status(500).json({ success: false, message: 'Erro ao criar usuário' });
  }
});

// PUT /api/admin/users/:id
router.put('/users/:id', adminMiddleware, async (req, res) => {
  try {
    const fieldError = rejectUnknownFields(req.body, ['name', 'password', 'avatarColor', 'isActive', 'status']);
    if (fieldError)
      return res.status(400).json({ success: false, message: fieldError });

    const userId = normalizeId(req.params.id);
    const { name, password, avatarColor, isActive, status } = req.body;

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists)
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });

    const fields = {};

    if (name !== undefined) {
      const trimmedName = sanitizePlainText(name, { maxLength: 120, allowEmpty: false });
      if (!trimmedName)
        return res.status(400).json({ success: false, message: 'Nome é obrigatório' });

      fields.name = trimmedName;
      fields.avatar_initials = getAvatarInitials(trimmedName);
    }

    if (avatarColor !== undefined) fields.avatar_color = normalizeHexColor(avatarColor);

    if (isActive !== undefined || status !== undefined) {
      const nextIsActive = isActive !== undefined
        ? normalizeBoolean(isActive, true)
        : String(status).toLowerCase() !== 'bloqueado';

      if (userId === normalizeId(req.user.id) && !nextIsActive) {
        return res.status(400).json({ success: false, message: 'Você não pode desativar sua própria conta' });
      }

      fields.is_active = nextIsActive;
    }

    if (password !== undefined && String(password).trim()) {
      const pwdError = validatePassword(String(password));
      if (pwdError) return res.status(400).json({ success: false, message: pwdError });

      fields.password = await bcrypt.hash(String(password), 10);
    }

    if (!Object.keys(fields).length)
      return res.status(400).json({ success: false, message: 'Nenhum campo para atualizar' });

    await userRef.update(fields);
    res.json({ success: true, message: 'Usuário atualizado' });
  } catch (err) {
    console.error('Erro ao atualizar usuário:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar usuário' });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', adminMiddleware, async (req, res) => {
  try {
    if (req.params.id === normalizeId(req.user.id))
      return res.status(400).json({ success: false, message: 'Você não pode remover sua própria conta' });

    await db.collection('users').doc(req.params.id).delete();
    // Remove do ranking também
    await db.collection('rankings').doc(req.params.id).delete().catch(() => {});

    res.json({ success: true, message: 'Usuário removido' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao remover usuário' });
  }
});

module.exports = router;
