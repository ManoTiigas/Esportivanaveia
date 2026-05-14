const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const appConfig = require('../config/app');
const { db, admin } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const {
  ALLOWED_PHOTO_EXTS,
  createSecurityAudit,
  getFileExt,
  getMime,
  isAllowedModuleUpload,
  validateModuleFile,
  validatePhotoFile,
} = require('../utils/uploadSecurity');

const router = express.Router();

const { limits: uploadLimits, messages: uploadMessages } = appConfig.uploads;

function moduleFileFilter(req, file, cb) {
  if (isAllowedModuleUpload(file)) {
    cb(null, true);
    return;
  }

  const ext = getFileExt(file.originalname);
  cb(new Error(`Tipo de arquivo nao permitido: ${file.mimetype} (.${ext})`));
}

const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadLimits.photoBytes },
  fileFilter: (req, file, cb) => {
    const mime = getMime(file);
    const ext = getFileExt(file.originalname);
    const ok = mime.startsWith('image/') || ALLOWED_PHOTO_EXTS.includes(ext);
    if (ok) return cb(null, true);
    cb(new Error(`Tipo de arquivo nao permitido para foto: ${file.mimetype} (.${ext})`));
  },
});

function isUserSafeUploadError(err) {
  if (err.code === 'LIMIT_FILE_SIZE') return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.startsWith('arquivo rejeitado') || msg.startsWith('tipo de arquivo');
}

function isStorageConfigError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return (
    msg.includes('storage') ||
    msg.includes('bucket') ||
    msg.includes('oauth2') ||
    msg.includes('token failed') ||
    msg.includes('permission') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden')
  );
}

function getUploadErrorMessage(err) {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return err.message || uploadMessages.tooLargeGeneric;
  }
  if (isUserSafeUploadError(err)) return err.message;
  if (isStorageConfigError(err)) {
    return 'Falha ao enviar arquivo para o Firebase Storage. Verifique FIREBASE_STORAGE_BUCKET, credenciais do servico e permissoes do bucket.';
  }
  return 'Erro no upload. Tente novamente.';
}

function getUploadErrorCode(err, fieldName) {
  const msg = String(err?.message || '').toLowerCase();

  if (err.code === 'LIMIT_FILE_SIZE') return `${fieldName}_too_large`;
  if (msg.includes('tipo de arquivo nao permitido')) return `${fieldName}_type_not_allowed`;
  if (msg.includes('mime invalido')) return `${fieldName}_invalid_mime`;
  if (msg.includes('extensao')) return `${fieldName}_invalid_extension`;
  if (msg.includes('assinatura de video invalida')) return 'video_invalid_signature';
  if (msg.includes('assinatura pdf invalida') || msg.includes('arquivo corrompido')) return 'pdf_invalid_signature';
  if (msg.includes('potencialmente executavel')) return `${fieldName}_unsafe_content`;
  if (msg.includes('conteudo vazio')) return `${fieldName}_empty_file`;
  if (isStorageConfigError(err)) return 'storage_config_error';
  return `${fieldName}_upload_failed`;
}

function getUploadErrorDetails(err, fieldName) {
  const msg = String(err?.message || '').toLowerCase();

  if (err.code === 'LIMIT_FILE_SIZE') {
    return fieldName === 'video'
      ? 'Reduza o arquivo ou exporte novamente em menor resolucao/bitrate.'
      : 'Reduza o arquivo antes de tentar novamente.';
  }
  if (msg.includes('tipo de arquivo nao permitido')) {
    return fieldName === 'video'
      ? 'Use um arquivo MP4, MOV, WEBM, OGG ou AVI valido.'
      : 'Use um arquivo PDF valido.';
  }
  if (msg.includes('mime invalido')) {
    return 'O navegador informou um tipo de arquivo diferente do esperado para esse upload.';
  }
  if (msg.includes('assinatura de video invalida')) {
    return 'A extensao parece ser de video, mas o conteudo interno nao bate com um container suportado.';
  }
  if (msg.includes('assinatura pdf invalida') || msg.includes('arquivo corrompido')) {
    return 'O arquivo nao parece ser um PDF valido ou foi exportado/copiado de forma incompleta.';
  }
  if (msg.includes('potencialmente executavel')) {
    return 'O arquivo contem recursos bloqueados por seguranca e nao pode ser salvo no sistema.';
  }
  if (msg.includes('conteudo vazio')) {
    return 'O arquivo chegou vazio ao servidor.';
  }
  if (isStorageConfigError(err)) {
    return 'Confira FIREBASE_STORAGE_BUCKET, credenciais do servico e permissoes do bucket no backend.';
  }
  return 'Se o problema persistir, verifique o formato real do arquivo e os logs do servidor.';
}

function getModuleUploadLimit(fieldName) {
  if (fieldName === 'video') return uploadLimits.videoBytes;
  if (fieldName === 'pdf') return uploadLimits.pdfBytes;
  return Math.max(uploadLimits.videoBytes, uploadLimits.pdfBytes);
}

function getLimitMessageByField(fieldName) {
  if (fieldName === 'video') return uploadMessages.tooLargeVideo;
  if (fieldName === 'pdf') return uploadMessages.tooLargePdf;
  if (fieldName === 'photo') return uploadMessages.tooLargePhoto;
  return uploadMessages.tooLargeGeneric;
}

function createModuleUploadMiddleware(fieldName) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: getModuleUploadLimit(fieldName) },
    fileFilter: moduleFileFilter,
  }).single(fieldName);
}

function runMulter(multerFn, req, res) {
  return new Promise((resolve, reject) => {
    multerFn(req, res, (err) => {
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
    throw new Error('Firebase Storage nao configurado. Defina FIREBASE_STORAGE_BUCKET nas variaveis de ambiente do servidor.');
  }
}

function getDownloadUrl(bucketName, storagePath, downloadToken) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
}

async function uploadToStorage(moduleId, targetField, file) {
  const bucket = getBucket();
  const originalName = String(file.originalname || '');
  const extension = getFileExt(originalName);
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

function logSecurityBlock(req, targetField, err) {
  console.warn('Upload bloqueado pelo modulo de seguranca:', {
    ...createSecurityAudit(req.file, targetField),
    actorId: req.user?.id || null,
    actorRole: req.user?.role || null,
    ip: req.ip,
    reason: err.message,
  });
}

async function attachFileToModule(req, res, fieldName, targetField) {
  try {
    await runMulter(createModuleUploadMiddleware(fieldName), req, res);

    const moduleId = getModuleId(req);
    if (!req.file) return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado' });
    if (!moduleId) return res.status(400).json({ success: false, message: 'moduleId e obrigatorio' });

    validateModuleFile(req.file, targetField);

    const moduleRef = db.collection('modules').doc(moduleId);
    const moduleDoc = await moduleRef.get();
    if (!moduleDoc.exists) {
      return res.status(404).json({ success: false, message: 'Modulo nao encontrado' });
    }

    const storageField = getStorageField(targetField);
    const existingData = moduleDoc.data() || {};

    await removeFromStorage(existingData[storageField]);

    const uploadedFile = await uploadToStorage(moduleId, targetField, req.file);
    await moduleRef.update({
      [targetField]: uploadedFile.url,
      [storageField]: uploadedFile.path,
    });

    return res.json({ success: true, data: { url: uploadedFile.url } });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE' && !err.message) {
      err.message = getLimitMessageByField(fieldName);
    }
    if (isUserSafeUploadError(err)) {
      logSecurityBlock(req, targetField, err);
    }
    console.error(`Erro no upload de ${fieldName}:`, err);
    return res.status(400).json({
      success: false,
      message: getUploadErrorMessage(err),
      errorCode: getUploadErrorCode(err, fieldName),
      details: getUploadErrorDetails(err, fieldName),
    });
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
    const moduleData = moduleDoc.data() || {};

    await removeFromStorage(moduleData[storageField]);
    await moduleRef.update({
      [targetField]: null,
      [storageField]: null,
    });

    return res.json({ success: true, message: `${label} removido` });
  } catch (err) {
    console.error(`Erro ao remover ${label}:`, err);
    return res.status(500).json({ success: false, message: `Erro ao remover ${label}` });
  }
}

async function attachProfilePhoto(req, res) {
  try {
    await runMulter(uploadPhoto.single('photo'), req, res);

    if (!req.file) return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado' });

    validatePhotoFile(req.file);

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

    return res.json({ success: true, data: { url: uploadedFile.url } });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE' && !err.message) {
      err.message = getLimitMessageByField('photo');
    }
    console.error('Erro no upload da foto de perfil:', err.message, err.code || '');
    return res.status(400).json({
      success: false,
      message: getUploadErrorMessage(err),
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

    return res.json({ success: true, message: 'Foto de perfil removida' });
  } catch (err) {
    console.error('Erro ao remover foto de perfil:', err);
    return res.status(500).json({ success: false, message: 'Erro ao remover foto de perfil' });
  }
}

router.post('/video', adminMiddleware, (req, res) => attachFileToModule(req, res, 'video', 'video_url'));
router.post('/video/:moduleId', adminMiddleware, (req, res) => attachFileToModule(req, res, 'video', 'video_url'));
router.post('/pdf', adminMiddleware, (req, res) => attachFileToModule(req, res, 'pdf', 'pdf_url'));
router.post('/pdf/:moduleId', adminMiddleware, (req, res) => attachFileToModule(req, res, 'pdf', 'pdf_url'));
router.post('/profile-photo', authMiddleware, (req, res) => attachProfilePhoto(req, res));

router.delete('/:moduleId/video', adminMiddleware, (req, res) => removeFileFromModule(req, res, 'video_url', 'Video'));
router.delete('/video/:moduleId', adminMiddleware, (req, res) => removeFileFromModule(req, res, 'video_url', 'Video'));
router.delete('/:moduleId/pdf', adminMiddleware, (req, res) => removeFileFromModule(req, res, 'pdf_url', 'PDF'));
router.delete('/pdf/:moduleId', adminMiddleware, (req, res) => removeFileFromModule(req, res, 'pdf_url', 'PDF'));
router.delete('/profile-photo', authMiddleware, (req, res) => removeProfilePhoto(req, res));

module.exports = router;
