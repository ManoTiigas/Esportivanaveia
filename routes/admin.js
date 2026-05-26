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

async function getDashboardSummary() {
  const [usersSnap, phasesSnap, modulesSnap, progressSnap] = await Promise.all([
    db.collection('users').where('role', '==', 'OPERATOR').get(),
    db.collection('phases').get(),
    db.collection('modules').get(),
    db.collection('user_progress').get(),
  ]);

  const activeOperators = usersSnap.docs.filter((doc) => doc.data().is_active !== false);
  const totalOperators = activeOperators.length;

  const sortedPhases = phasesSnap.docs
    .map((doc) => ({
      id: doc.id,
      title: String(doc.data().title || '').trim(),
      orderIndex: toInt(doc.data().order_index),
    }))
    .sort((left, right) => {
      if (left.orderIndex !== right.orderIndex) return left.orderIndex - right.orderIndex;
      return Number(left.id) - Number(right.id);
    });

  const firstPhase = sortedPhases[0] || null;
  const firstPhaseLabel = firstPhase
    ? (firstPhase.title || `Fase ${firstPhase.orderIndex || 1}`)
    : 'Fase 1';
  if (!firstPhase) {
    return {
      totalOperators,
      phaseTitle: firstPhaseLabel,
      completedOperators: 0,
      completionPercent: 0,
    };
  }

  const phaseModuleIds = modulesSnap.docs
    .filter((doc) => toInt(doc.data().phase_id) === toInt(firstPhase.id))
    .map((doc) => normalizeId(doc.id));

  if (!phaseModuleIds.length) {
    return {
      totalOperators,
      phaseTitle: firstPhaseLabel,
      completedOperators: 0,
      completionPercent: 0,
    };
  }

  const requiredModules = new Set(phaseModuleIds);
  const completedByUser = progressSnap.docs.reduce((acc, doc) => {
    const progress = doc.data() || {};
    const userId = normalizeId(progress.user_id);
    const moduleId = normalizeId(progress.module_id);

    if (!requiredModules.has(moduleId) || progress.simulator_completed !== true) {
      return acc;
    }

    if (!acc[userId]) acc[userId] = new Set();
    acc[userId].add(moduleId);
    return acc;
  }, {});

  const completedOperators = activeOperators.filter((doc) => {
    const userId = normalizeId(doc.id);
    return completedByUser[userId] && completedByUser[userId].size === requiredModules.size;
  }).length;

  return {
    totalOperators,
    phaseTitle: firstPhaseLabel,
    completedOperators,
    completionPercent: totalOperators > 0 ? Math.round((completedOperators / totalOperators) * 100) : 0,
  };
}

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

router.get('/dashboard-summary', adminMiddleware, async (req, res) => {
  try {
    const data = await getDashboardSummary();
    return res.json({ success: true, data });
  } catch (err) {
    console.error('Erro ao calcular resumo do dashboard:', err);
    return res.status(500).json({ success: false, message: 'Erro ao calcular resumo do dashboard' });
  }
});

router.get('/module-results', adminMiddleware, async (req, res) => {
  try {
    const [usersSnap, modulesSnap, progressSnap, quizAttemptsSnap, simulatorAttemptsSnap, simulatorsSnap] = await Promise.all([
      db.collection('users').where('role', '==', 'OPERATOR').get(),
      db.collection('modules').get(),
      db.collection('user_progress').where('simulator_completed', '==', true).get(),
      db.collection('quiz_attempts').get(),
      db.collection('simulator_attempts').get(),
      db.collection('simulators').get(),
    ]);

    const usersById = usersSnap.docs.reduce((acc, doc) => {
      acc[normalizeId(doc.id)] = { id: doc.id, ...doc.data() };
      return acc;
    }, {});

    const modulesById = modulesSnap.docs.reduce((acc, doc) => {
      acc[normalizeId(doc.id)] = { id: doc.id, ...doc.data() };
      return acc;
    }, {});

    const simulatorToModuleId = simulatorsSnap.docs.reduce((acc, doc) => {
      acc[normalizeId(doc.id)] = normalizeId(doc.data().module_id);
      return acc;
    }, {});

    const bestQuizByUserModule = quizAttemptsSnap.docs.reduce((acc, doc) => {
      const data = doc.data() || {};
      const key = `${normalizeId(data.user_id)}_${normalizeId(data.module_id)}`;
      const score = toNumber(data.score);
      const current = acc[key];
      if (!current || score > current.score) {
        acc[key] = {
          score,
          completedAt: data.completed_at || null,
        };
      }
      return acc;
    }, {});

    const bestSimulatorByUserModule = simulatorAttemptsSnap.docs.reduce((acc, doc) => {
      const data = doc.data() || {};
      const moduleId = simulatorToModuleId[normalizeId(data.simulator_id)];
      if (!moduleId) return acc;

      const key = `${normalizeId(data.user_id)}_${moduleId}`;
      const score = toNumber(data.score);
      const current = acc[key];
      if (!current || score > current.score) {
        acc[key] = {
          score,
          completedAt: data.completed_at || null,
        };
      }
      return acc;
    }, {});

    const results = progressSnap.docs
      .map((doc) => {
        const progress = doc.data() || {};
        const userId = normalizeId(progress.user_id);
        const moduleId = normalizeId(progress.module_id);
        const user = usersById[userId];
        const module = modulesById[moduleId];

        if (!user || !module) return null;

        const key = `${userId}_${moduleId}`;
        const quiz = bestQuizByUserModule[key] || { score: 0, completedAt: null };
        const simulator = bestSimulatorByUserModule[key] || {
          score: toNumber(progress.simulator_best_score),
          completedAt: null,
        };

        return {
          userId,
          nome: user.name || '',
          email: user.email || '',
          avatarInitials: user.avatar_initials || '',
          avatarColor: user.avatar_color || '#00C2FF',
          profilePhotoUrl: user.profile_photo_url || null,
          mod: module.title || '',
          modId: module.id,
          pts: quiz.score,
          sim: simulator.score,
          data: simulator.completedAt || quiz.completedAt || null,
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        const leftDate = left.data ? new Date(left.data).getTime() : 0;
        const rightDate = right.data ? new Date(right.data).getTime() : 0;
        return rightDate - leftDate;
      });

    return res.json({ success: true, data: results });
  } catch (err) {
    console.error('Erro ao buscar resultados por modulo:', err);
    return res.status(500).json({ success: false, message: 'Erro ao buscar resultados por modulo' });
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
