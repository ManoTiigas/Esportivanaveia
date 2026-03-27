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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function mountApiRoute(routePath, handlerPath) {
  const router = require(handlerPath);
  app.use(`/api${routePath}`, router);
  app.use(routePath, router);
}

if (!firebaseBootstrapError) {
  mountApiRoute('/auth', './routes/auth');
  mountApiRoute('/phases', './routes/phases');
  mountApiRoute('/modules', './routes/modules');
  mountApiRoute('/quiz', './routes/quiz');
  mountApiRoute('/simulators', './routes/simulators');
  mountApiRoute('/ranking', './routes/ranking');
  mountApiRoute('/admin', './routes/admin');
  mountApiRoute('/upload', './routes/upload');
} else {
  app.use(['/api', '/auth', '/phases', '/modules', '/quiz', '/simulators', '/ranking', '/admin', '/upload'], (req, res) => {
    res.status(500).json({
      success: false,
      message: 'Firebase nao configurado. Defina FIREBASE_CREDENTIAL_PATH ou FIREBASE_CREDENTIAL_JSON.',
      details: firebaseBootstrapError.message
    });
  });
}

app.use(['/api/*', '/auth/*', '/phases/*', '/modules/*', '/quiz/*', '/simulators/*', '/ranking/*', '/admin/*', '/upload/*'], (req, res) => {
  res.status(404).json({ success: false, message: `Rota nao encontrada: ${req.originalUrl}` });
});

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  res.sendFile(indexPath, err => {
    if (err) res.status(404).send('index.html nao encontrado. Coloque-o na pasta /public');
  });
});

app.use((err, req, res, next) => {
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
