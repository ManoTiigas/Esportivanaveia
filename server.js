require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
let firebaseBootstrapError = null;

try {
  require('./db');
} catch (err) {
  firebaseBootstrapError = err;
  console.error('Falha ao inicializar Firebase:', err.message);
}

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function mountApiRoute(routePath, router) {
  app.use(`/api${routePath}`, router);
  app.use(routePath, router);
}

if (!firebaseBootstrapError) {
  const authRoutes = require('./routes/auth');
  const phasesRoutes = require('./routes/phases');
  const modulesRoutes = require('./routes/modules');
  const quizRoutes = require('./routes/quiz');
  const simulatorsRoutes = require('./routes/simulators');
  const rankingRoutes = require('./routes/ranking');
  const adminRoutes = require('./routes/admin');
  const uploadRoutes = require('./routes/upload');
  const notificationsRoutes = require('./routes/notifications');

  mountApiRoute('/auth', authRoutes);
  mountApiRoute('/phases', phasesRoutes);
  mountApiRoute('/modules', modulesRoutes);
  mountApiRoute('/quiz', quizRoutes);
  mountApiRoute('/simulators', simulatorsRoutes);
  mountApiRoute('/ranking', rankingRoutes);
  mountApiRoute('/admin', adminRoutes);
  mountApiRoute('/upload', uploadRoutes);
  mountApiRoute('/notifications', notificationsRoutes);
} else {
  app.use(['/api', '/auth', '/phases', '/modules', '/quiz', '/simulators', '/ranking', '/admin', '/upload', '/notifications'], (req, res) => {
    res.status(500).json({
      success: false,
      message: 'Firebase nao configurado. Defina FIREBASE_CREDENTIAL_PATH ou FIREBASE_CREDENTIAL_JSON.',
      details: firebaseBootstrapError.message
    });
  });
}

app.use(['/api/*', '/auth/*', '/phases/*', '/modules/*', '/quiz/*', '/simulators/*', '/ranking/*', '/admin/*', '/upload/*', '/notifications/*'], (req, res) => {
  res.status(404).json({ success: false, message: `Rota nao encontrada: ${req.originalUrl}` });
});

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  res.sendFile(indexPath, err => {
    if (err) res.status(404).send('index.html nao encontrado. Coloque-o na pasta /public');
  });
});

app.use((err, req, res, next) => {
  if (err.status === 413 || err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Arquivo muito grande. Limite: 500MB' });
  }
  console.error('Erro nao tratado:', err);
  res.status(500).json({ success: false, message: 'Erro interno no servidor' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log('');
    console.log('Esportiva na Veia Backend rodando!');
    console.log(`   URL:      http://localhost:${PORT}`);
    console.log(`   API:      http://localhost:${PORT}/api`);
    console.log(`   Frontend: http://localhost:${PORT}`);
    console.log('');
  });
}

module.exports = app;
