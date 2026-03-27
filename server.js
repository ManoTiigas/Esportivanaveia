// server.js — Esportiva na Veia Backend (Node.js + Express + Firebase)
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();
let firebaseBootstrapError = null;

try {
  // Inicializa Firebase apenas quando a configuracao estiver disponivel.
  require('./db');
} catch (err) {
  firebaseBootstrapError = err;
  console.error('Falha ao inicializar Firebase:', err.message);
}

// ============================
// MIDDLEWARES
// ============================
app.use(cors({
  origin: '*', // Em produção, troque por seu domínio
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Serve arquivos estáticos (frontend + uploads)
app.use(express.static(path.join(__dirname, 'public')));

// ============================
// ROTAS DA API
// ============================
if (!firebaseBootstrapError) {
  app.use('/api/auth',       require('./routes/auth'));
  app.use('/api/phases',     require('./routes/phases'));
  app.use('/api/modules',    require('./routes/modules'));
  app.use('/api/quiz',       require('./routes/quiz'));
  app.use('/api/simulators', require('./routes/simulators'));
  app.use('/api/ranking',    require('./routes/ranking'));
  app.use('/api/admin',      require('./routes/admin'));
  app.use('/api/upload',     require('./routes/upload'));
} else {
  app.use('/api', (req, res) => {
    res.status(500).json({
      success: false,
      message: 'Firebase nao configurado. Defina FIREBASE_CREDENTIAL_PATH ou FIREBASE_CREDENTIAL_JSON.',
      details: firebaseBootstrapError.message
    });
  });
}

// Qualquer rota não encontrada na API retorna 404
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: `Rota não encontrada: ${req.originalUrl}` });
});

// Frontend — qualquer outra rota serve o index.html (SPA)
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  res.sendFile(indexPath, err => {
    if (err) res.status(404).send('index.html não encontrado. Coloque-o na pasta /public');
  });
});

// ============================
// ERRO GLOBAL
// ============================
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({ success: false, message: 'Erro interno no servidor' });
});

// ============================
// INICIAR SERVIDOR
// ============================
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
  console.log('');
  console.log('🎯 Esportiva na Veia Backend rodando!');
  console.log(`   URL:      http://localhost:${PORT}`);
  console.log(`   API:      http://localhost:${PORT}/api`);
  console.log(`   Frontend: http://localhost:${PORT}  (coloque index.html em /public)`);
  console.log('');
});
}

module.exports = app;


