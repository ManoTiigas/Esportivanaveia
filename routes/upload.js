const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const { db, admin } = require('../db');
const { adminMiddleware } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'video/mp4',
      'video/webm',
      'video/ogg',
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ];

    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error(`Tipo de arquivo nao permitido: ${file.mimetype}`));
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

router.post('/video', adminMiddleware, (req, res) => attachFileToModule(req, res, 'video', 'video_url'));
router.post('/video/:moduleId', adminMiddleware, (req, res) =>
  attachFileToModule(req, res, 'video', 'video_url')
);
router.post('/pdf', adminMiddleware, (req, res) => attachFileToModule(req, res, 'pdf', 'pdf_url'));
router.post('/pdf/:moduleId', adminMiddleware, (req, res) => attachFileToModule(req, res, 'pdf', 'pdf_url'));

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

module.exports = router;
