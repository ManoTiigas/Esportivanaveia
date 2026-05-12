const bcrypt = require('bcryptjs');
const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const appConfig = require('../config/app');
const { db } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { getUserByEmail, getUserById, serializePublicUser } = require('../services/userService');
const { validatePassword } = require('../utils/validation');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Muitas tentativas de login. Aguarde 15 minutos.' },
});

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'E-mail e senha sao obrigatorios' });
    }

    const user = await getUserByEmail(normalizeEmail(email));
    if (!user || typeof user.password !== 'string') {
      return res.status(401).json({ success: false, message: 'E-mail ou senha incorretos' });
    }

    if (user.is_active === false) {
      return res.status(403).json({ success: false, message: 'Usuario desativado' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ success: false, message: 'E-mail ou senha incorretos' });
    }

    if (!appConfig.auth.jwtSecret) {
      return res.status(500).json({ success: false, message: 'JWT_SECRET nao configurado no servidor' });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      appConfig.auth.jwtSecret,
      { expiresIn: appConfig.auth.jwtExpiresIn },
    );

    return res.json({
      success: true,
      data: {
        token,
        user: serializePublicUser(user),
      },
    });
  } catch (error) {
    console.error('Erro no login:', error && error.stack ? error.stack : error);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario nao encontrado' });
    }

    return res.json({ success: true, data: serializePublicUser(user) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'Preencha todos os campos' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'As senhas nao coincidem' });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ success: false, message: passwordError });
    }

    const user = await getUserById(req.user.id);
    const currentPasswordMatches = user && await bcrypt.compare(currentPassword, user.password);

    if (!currentPasswordMatches) {
      return res.status(400).json({ success: false, message: 'Senha atual incorreta' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.collection('users').doc(String(req.user.id)).update({ password: passwordHash });

    return res.json({ success: true, message: 'Senha alterada com sucesso' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

module.exports = router;
