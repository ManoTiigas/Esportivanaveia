const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const { db, admin } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const ALLOWED_MIME_PREFIXES = ['video/', 'image/'];
const ALLOWED_MIME_EXACT   = ['application/pdf', 'application/octet-stream'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase().split(';')[0].trim();
    const ext  = (file.originalname || '').split('.').pop().toLowerCase();
    const allowedExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'pdf',
                         'jpg', 'jpeg', 'png', 'gif', 'webp'];

    const ok = ALLOWED_MIME_PREFIXES.some(p => mime.startsWith(p))
            || ALLOWED_MIME_EXACT.includes(mime)
            || allowedExts.includes(ext);

    if (ok) return cb(null, true);
    cb(new Error(`Tipo de arquivo não permitido: ${file.mimetype} (.${ext})`));
  },
});

function runMulter(multerFn, req, res) {
  return new Promise((resolve, reject) => {
    multerFn(req, res, err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getModuleId(req) {
  return String(req.params.moduleId || req.body.moduleId || '').trim();
}

function getStorageField(targetField) {
  return `${targetField.replace(/_url$/, '')}_path`;
}

function getBucket() {
  try {
    return admin.storage().bucket();
  } catch (err) {
    throw new Error(
      'Firebase Storage nao configurado. Defina FIREBASE_STORAGE_BUCKET nas variaveis da Vercel.'
    );
  }
}

function getDownloadUrl(bucketName, storagePath, downloadToken) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
    storagePath
  )}?alt=media&token=${downloadToken}`;
}

async function uploadToStorage(moduleId, targetField, file) {
  const bucket = getBucket();
  const originalName = String(file.originalname || '');
  const extension = originalName.includes('.') ? originalName.split('.').pop().toLowerCase() : '';
  const safeExtension = extension ? `.${extension.replace(/[^a-z0-9]/gi, '')}` : '';
  const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExtension}`;
  const storagePath = `modules/${moduleId}/${targetField}/${fileName}`;
  const downloadToken = crypto.randomUUID();
  const bucketFile = bucket.file(storagePath);

  await bucketFile.save(file.buffer, {
    resumable: false,
    contentType: file.mimetype,
    metadata: {
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  return {
    path: storagePath,
    url: getDownloadUrl(bucket.name, storagePath, downloadToken),
  };
}

async function removeFromStorage(storagePath) {
  if (!storagePath) return;

  try {
    await getBucket().file(storagePath).delete({ ignoreNotFound: true });
  } catch (err) {
    console.warn('Falha ao remover arquivo do Storage:', storagePath, err.message);
  }
}

async function attachFileToModule(req, res, fieldName, targetField) {
  try {
    await runMulter(upload.single(fieldName), req, res);

    const moduleId = getModuleId(req);
    if (!req.file) return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado' });
    if (!moduleId) return res.status(400).json({ success: false, message: 'moduleId e obrigatorio' });

    const moduleRef = db.collection('modules').doc(moduleId);
    const moduleDoc = await moduleRef.get();
    if (!moduleDoc.exists) {
      return res.status(404).json({ success: false, message: 'Modulo nao encontrado' });
    }

    const storageField = getStorageField(targetField);
    const existingData = moduleDoc.data();

    await removeFromStorage(existingData[storageField]);

    const uploadedFile = await uploadToStorage(moduleId, targetField, req.file);
    await moduleRef.update({
      [targetField]: uploadedFile.url,
      [storageField]: uploadedFile.path,
    });

    res.json({ success: true, data: { url: uploadedFile.url } });
  } catch (err) {
    console.error(`Erro no upload de ${fieldName}:`, err);
    res.status(400).json({ success: false, message: err.message || 'Erro no upload' });
  }
}

async function removeFileFromModule(req, res, targetField, label) {
  try {
    const moduleId = getModuleId(req);
    if (!moduleId) return res.status(400).json({ success: false, message: 'moduleId e obrigatorio' });

    const moduleRef = db.collection('modules').doc(moduleId);
    const moduleDoc = await moduleRef.get();
    if (!moduleDoc.exists) return res.status(404).json({ success: false, message: 'Modulo nao encontrado' });

    const storageField = getStorageField(targetField);
    const moduleData = moduleDoc.data();

    await removeFromStorage(moduleData[storageField]);
    await moduleRef.update({
      [targetField]: null,
      [storageField]: null,
    });

    res.json({ success: true, message: `${label} removido` });
  } catch (err) {
    console.error(`Erro ao remover ${label}:`, err);
    res.status(500).json({ success: false, message: `Erro ao remover ${label}` });
  }
}

async function attachProfilePhoto(req, res) {
  try {
    await runMulter(upload.single('photo'), req, res);

    if (!req.file) return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado' });

    const userId = String(req.user.id);
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ success: false, message: 'Usuario nao encontrado' });

    const userData = userDoc.data() || {};
    await removeFromStorage(userData.profile_photo_path);

    const uploadedFile = await uploadToStorage(userId, 'profile_photo', req.file);
    await userRef.update({
      profile_photo_url: uploadedFile.url,
      profile_photo_path: uploadedFile.path,
    });

    res.json({ success: true, data: { url: uploadedFile.url } });
  } catch (err) {
    console.error('Erro no upload da foto de perfil:', err.message, err.code || '');
    const isStorageErr = err.message?.includes('Storage') || err.code?.startsWith('storage/') || err.code === 404;
    res.status(400).json({
      success: false,
      message: isStorageErr
        ? `Erro no Firebase Storage: ${err.message}. Verifique FIREBASE_STORAGE_BUCKET no .env`
        : err.message || 'Erro no upload da foto',
    });
  }
}

async function removeProfilePhoto(req, res) {
  try {
    const userId = String(req.user.id);
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ success: false, message: 'Usuario nao encontrado' });

    const userData = userDoc.data() || {};
    await removeFromStorage(userData.profile_photo_path);
    await userRef.update({
      profile_photo_url: null,
      profile_photo_path: null,
    });

    res.json({ success: true, message: 'Foto de perfil removida' });
  } catch (err) {
    console.error('Erro ao remover foto de perfil:', err);
    res.status(500).json({ success: false, message: 'Erro ao remover foto de perfil' });
  }
}

router.post('/video', adminMiddleware, (req, res) => attachFileToModule(req, res, 'video', 'video_url'));
router.post('/video/:moduleId', adminMiddleware, (req, res) =>
  attachFileToModule(req, res, 'video', 'video_url')
);
router.post('/pdf', adminMiddleware, (req, res) => attachFileToModule(req, res, 'pdf', 'pdf_url'));
router.post('/pdf/:moduleId', adminMiddleware, (req, res) => attachFileToModule(req, res, 'pdf', 'pdf_url'));
router.post('/profile-photo', authMiddleware, (req, res) => attachProfilePhoto(req, res));

router.delete('/:moduleId/video', adminMiddleware, (req, res) =>
  removeFileFromModule(req, res, 'video_url', 'Video')
);
router.delete('/video/:moduleId', adminMiddleware, (req, res) =>
  removeFileFromModule(req, res, 'video_url', 'Video')
);
router.delete('/:moduleId/pdf', adminMiddleware, (req, res) =>
  removeFileFromModule(req, res, 'pdf_url', 'PDF')
);
router.delete('/pdf/:moduleId', adminMiddleware, (req, res) =>
  removeFileFromModule(req, res, 'pdf_url', 'PDF')
);
router.delete('/profile-photo', authMiddleware, (req, res) => removeProfilePhoto(req, res));

module.exports = router;
