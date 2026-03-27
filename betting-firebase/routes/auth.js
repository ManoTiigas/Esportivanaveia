// routes/auth.js — Login, me, trocar senha (Firebase Firestore)
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { db }  = require('../db');
const { authMiddleware } = require('../middleware/auth');

// Busca usuário pelo email
async function getUserByEmail(email) {
  const snap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

// Busca usuário pelo ID
async function getUserById(id) {
  const doc = await db.collection('users').doc(String(id)).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'E-mail e senha são obrigatórios' });

    const user = await getUserByEmail(email);

    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ success: false, message: 'E-mail ou senha incorretos' });

    if (user.is_active === false)
      return res.status(403).json({ success: false, message: 'UsuÃ¡rio desativado' });

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: parseInt(process.env.JWT_EXPIRES_IN) || 7200 }
    );

    res.json({
      success: true,
      data: {
        token,
        user: {
          id:             user.id,
          name:           user.name,
          email:          user.email,
          role:           user.role,
          isActive:       user.is_active !== false,
          avatarInitials: user.avatar_initials,
          avatarColor:    user.avatar_color,
          totalPoints:    parseFloat(user.total_points) || 0
        }
      }
    });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ success: false, message: 'Erro interno no servidor' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });

    res.json({
      success: true,
      data: {
        id:             user.id,
        name:           user.name,
        email:          user.email,
        role:           user.role,
        isActive:       user.is_active !== false,
        avatarInitials: user.avatar_initials,
        avatarColor:    user.avatar_color,
        totalPoints:    parseFloat(user.total_points) || 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword)
      return res.status(400).json({ success: false, message: 'Preencha todos os campos' });

    if (newPassword !== confirmPassword)
      return res.status(400).json({ success: false, message: 'As senhas não coincidem' });

    if (newPassword.length < 6)
      return res.status(400).json({ success: false, message: 'Senha deve ter ao menos 6 caracteres' });

    const user = await getUserById(req.user.id);

    if (!user || !(await bcrypt.compare(currentPassword, user.password)))
      return res.status(400).json({ success: false, message: 'Senha atual incorreta' });

    const hash = await bcrypt.hash(newPassword, 10);
    await db.collection('users').doc(String(req.user.id)).update({ password: hash });

    res.json({ success: true, message: 'Senha alterada com sucesso' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

module.exports = router;
