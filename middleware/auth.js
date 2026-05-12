const jwt = require('jsonwebtoken');

const appConfig = require('../config/app');
const { getUserById } = require('../services/userService');

async function authMiddleware(req, res, next) {
  const authorizationHeader = req.headers.authorization;

  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Token nao fornecido' });
  }

  const token = authorizationHeader.split(' ')[1];

  try {
    const decodedToken = jwt.verify(token, appConfig.auth.jwtSecret);
    const user = await getUserById(decodedToken.id);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario nao encontrado' });
    }

    if (user.is_active === false) {
      return res.status(403).json({ success: false, message: 'Usuario desativado' });
    }

    req.user = { ...decodedToken, role: user.role };
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token invalido ou expirado' });
  }
}

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Acesso negado: apenas administradores' });
    }

    return next();
  });
}

module.exports = {
  adminMiddleware,
  authMiddleware,
};
