const path = require('path');

const DEFAULT_PORT = 3001;
const DEFAULT_JWT_EXPIRES_IN = 7200;

function parseCsvEnv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  paths: {
    public: path.join(__dirname, '..', 'public'),
    indexHtml: path.join(__dirname, '..', 'public', 'index.html'),
  },
  server: {
    port: Number(process.env.PORT) || DEFAULT_PORT,
    jsonLimit: '1mb',
    urlencodedLimit: '1mb',
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: parseInt(process.env.JWT_EXPIRES_IN, 10) || DEFAULT_JWT_EXPIRES_IN,
  },
  cors: {
    allowedOrigins: parseCsvEnv(process.env.ALLOWED_ORIGINS),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  },
  uploads: {
    apiLimitMessage: 'Arquivo muito grande. Limite: 200MB para videos/PDFs, 10MB para fotos.',
  },
};
