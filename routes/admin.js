// routes/admin.js — Gerenciamento de usuários (admin only) — Firebase Firestore
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { db, getNextId } = require('../db');
const { adminMiddleware } = require('../middleware/auth');

// GET /api/admin/users
router.get('/users', adminMiddleware, async (req, res) => {
  try {
    const snap = await db.collection('users').orderBy('created_at', 'desc').get();
    const users = snap.docs.map(doc => {
      const u = doc.data();
      return {
        id:             doc.id,
        name:           u.name,
        email:          u.email,
        role:           u.role,
        isActive:       u.is_active !== false,
        avatarColor:    u.avatar_color,
        avatarInitials: u.avatar_initials,
        profilePhotoUrl: u.profile_photo_url || null,
        totalPoints:    parseFloat(u.total_points) || 0,
        createdAt:      u.created_at
      };
    });
    res.json({ success: true, data: users });
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

      // Busca usuário
      const userDoc = await db.collection('users').doc(String(att.user_id)).get();
      if (!userDoc.exists) continue;
      const user = userDoc.data();
      if (user.role !== 'OPERATOR') continue;

      // Busca módulo — module_id é número, doc ID é string
      const modDoc = await db.collection('modules').doc(String(att.module_id)).get();
      if (!modDoc.exists) continue;
      const mod = modDoc.data();

      // Busca melhor tentativa de simulador do usuário neste módulo
      // module_id salvo como número no simulators
      const simSnap = await db.collection('simulators')
        .where('module_id', '==', parseInt(att.module_id)).limit(1).get();
      let simScore = 0;
      if (!simSnap.empty) {
        const simId = simSnap.docs[0].id;
        // Bug fix: where antes de orderBy; user_id como string
        const simAttSnap = await db.collection('simulator_attempts')
          .where('user_id', '==', String(att.user_id))
          .get();
        const latestSimAttempt = simAttSnap.docs
          .filter(doc => doc.data().simulator_id === simId)
          .sort((a, b) => String(b.data().completed_at || '').localeCompare(String(a.data().completed_at || '')))[0];
        if (latestSimAttempt) simScore = parseFloat(latestSimAttempt.data().score) || 0;
      }

      results.push({
        name:           user.name,
        avatarInitials: user.avatar_initials,
        avatarColor:    user.avatar_color,
        profilePhotoUrl: user.profile_photo_url || null,
        moduleTitle:    mod.title,
        quizScore:      parseFloat(att.score) || 0,
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
    const { name, email, password, role = 'OPERATOR', avatarColor = '#00C2FF' } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: 'Nome, e-mail e senha são obrigatórios' });

    // Verifica e-mail duplicado
    const existing = await db.collection('users').where('email', '==', email).limit(1).get();
    if (!existing.empty)
      return res.status(400).json({ success: false, message: 'E-mail já cadastrado' });

    const initials  = name.split(' ').filter(Boolean).map(w => w[0].toUpperCase()).join('').slice(0, 2);
    const hash      = await bcrypt.hash(password, 10);
    const newId     = await getNextId('users');
    const roleUpper = role.toUpperCase();

    await db.collection('users').doc(String(newId)).set({
      name,
      email,
      password: hash,
      role:     roleUpper,
      is_active:       true,
      avatar_initials: initials,
      avatar_color:    avatarColor,
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
    const userId = String(req.params.id);
    const { name, password, avatarColor, isActive, status } = req.body;

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists)
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });

    const fields = {};

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName)
        return res.status(400).json({ success: false, message: 'Nome é obrigatório' });

      fields.name = trimmedName;
      fields.avatar_initials = trimmedName
        .split(' ')
        .filter(Boolean)
        .map(word => word[0].toUpperCase())
        .join('')
        .slice(0, 2);
    }

    if (avatarColor !== undefined) fields.avatar_color = avatarColor || '#00C2FF';

    if (isActive !== undefined || status !== undefined) {
      const nextIsActive = isActive !== undefined
        ? !!isActive
        : String(status).toLowerCase() !== 'bloqueado';

      if (userId === String(req.user.id) && !nextIsActive) {
        return res.status(400).json({ success: false, message: 'Você não pode desativar sua própria conta' });
      }

      fields.is_active = nextIsActive;
    }

    if (password !== undefined && String(password).trim()) {
      if (String(password).length < 6)
        return res.status(400).json({ success: false, message: 'Senha deve ter ao menos 6 caracteres' });

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
    if (req.params.id === String(req.user.id))
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

