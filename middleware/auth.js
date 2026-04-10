// middleware/auth.js — Verificação de token JWT
const jwt = require('jsonwebtoken');
const { db } = require('../db');

async function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Token não fornecido' });
  }

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userDoc = await db.collection('users').doc(String(decoded.id)).get();
    if (!userDoc.exists) {
      return res.status(401).json({ success: false, message: 'Usuário não encontrado' });
    }

    if (userDoc.data().is_active === false) {
      return res.status(403).json({ success: false, message: 'Usuário desativado' });
    }

    // Re-valida a role diretamente do banco para evitar escalada de privilégio via JWT stale
    req.user = { ...decoded, role: userDoc.data().role };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token inválido ou expirado' });
  }
}

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Acesso negado — apenas administradores' });
    }
    next();
  });
}

module.exports = { authMiddleware, adminMiddleware };
