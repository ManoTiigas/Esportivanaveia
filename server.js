require('dotenv').config();

const cors = require('cors');
const express = require('express');
const helmet = require('helmet');

const appConfig = require('./config/app');
const securityConfig = require('./config/security');
const routeRegistry = require('./routes');

const app = express();
let firebaseBootstrapError = null;

try {
  require('./db');
} catch (error) {
  firebaseBootstrapError = error;
  console.error('Falha ao inicializar Firebase:', error.message);
}

app.use(helmet(securityConfig.helmet));
app.use(cors({
  origin: (origin, callback) => {
    const { allowedOrigins } = appConfig.cors;

    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error('Origem nao permitida pelo CORS'));
  },
  methods: appConfig.cors.methods,
  allowedHeaders: appConfig.cors.allowedHeaders,
}));
app.use(express.json({ limit: appConfig.server.jsonLimit }));
app.use(express.urlencoded({ extended: true, limit: appConfig.server.urlencodedLimit }));
app.use(express.static(appConfig.paths.public));

function mountApiRoute(routePath, router) {
  app.use(`/api${routePath}`, router);
}

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'API online' });
});

if (!firebaseBootstrapError) {
  routeRegistry.forEach(({ path, router }) => {
    mountApiRoute(path, router);
  });
} else {
  app.use('/api', (req, res) => {
    res.status(500).json({
      success: false,
      message: 'Servico temporariamente indisponivel. Contate o administrador.',
    });
  });
}

app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: 'Rota nao encontrada' });
});

app.get('*', (req, res) => {
  res.sendFile(appConfig.paths.indexHtml, (error) => {
    if (error) {
      res.status(404).send('index.html nao encontrado. Coloque-o na pasta /public');
    }
  });
});

app.use((error, req, res, next) => {
  if (error.status === 413 || error.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: appConfig.uploads.messages.tooLargeGeneric });
  }

  console.error('Erro nao tratado:', error);
  return res.status(500).json({ success: false, message: 'Erro interno no servidor' });
});

if (require.main === module) {
  app.listen(appConfig.server.port, () => {
    console.log('');
    console.log('Esportiva na Veia Backend rodando!');
    console.log(`   URL:      http://localhost:${appConfig.server.port}`);
    console.log(`   API:      http://localhost:${appConfig.server.port}/api`);
    console.log(`   Frontend: http://localhost:${appConfig.server.port}`);
    console.log('');
  });
}

module.exports = app;
