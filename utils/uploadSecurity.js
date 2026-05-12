const ALLOWED_VIDEO_EXTS = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
const ALLOWED_PHOTO_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

const PDF_BLOCKED_TOKENS = [
  '/javascript',
  '/js',
  '/launch',
  '/openaction',
  '/aa',
  '/submitform',
  '/richmedia',
  '/embeddedfile',
  '/xfa',
];

const SUSPICIOUS_BINARY_SIGNATURES = [
  { signature: Buffer.from('4d5a', 'hex'), label: 'executavel windows' },
  { signature: Buffer.from('7f454c46', 'hex'), label: 'binario elf' },
  { signature: Buffer.from('3c68746d6c', 'hex'), label: 'html' },
  { signature: Buffer.from('3c736372697074', 'hex'), label: 'script html' },
];

function getFileExt(filename = '') {
  const parts = String(filename).toLowerCase().split('.');
  return parts.length > 1 ? parts.pop().trim() : '';
}

function getMime(file) {
  return String(file?.mimetype || '').toLowerCase().split(';')[0].trim();
}

function ensureNonEmptyBuffer(file) {
  if (!file || !file.buffer || !file.buffer.length) {
    throw new Error('Arquivo rejeitado: conteudo vazio.');
  }
}

function hasPdfSignature(buffer) {
  return buffer && buffer.length >= 8 && buffer.slice(0, 5).toString('ascii') === '%PDF-';
}

function hasPdfEOF(buffer) {
  if (!buffer || buffer.length < 16) return false;
  const tail = buffer.slice(Math.max(0, buffer.length - 4096)).toString('latin1');
  return /%%EOF\s*$/i.test(tail.trim());
}

function hasSuspiciousPdfTokens(buffer) {
  const sample = buffer.slice(0, Math.min(buffer.length, 5 * 1024 * 1024)).toString('latin1').toLowerCase();
  return PDF_BLOCKED_TOKENS.find((token) => sample.includes(token)) || null;
}

function findSuspiciousBinarySignature(buffer, sampleBytes = 4096) {
  const sample = buffer.slice(0, Math.min(buffer.length, sampleBytes));

  for (const item of SUSPICIOUS_BINARY_SIGNATURES) {
    if (sample.includes(item.signature)) {
      return item.label;
    }
  }

  return null;
}

function isIsoBmffVideo(buffer) {
  if (!buffer || buffer.length < 12) return false;
  if (buffer.toString('ascii', 4, 8) !== 'ftyp') return false;

  const brand = buffer.toString('ascii', 8, 12).toLowerCase();
  const allowedBrands = ['isom', 'iso2', 'avc1', 'mp41', 'mp42', 'qt  ', 'dash', 'm4v '];
  return allowedBrands.includes(brand);
}

function isWebmVideo(buffer) {
  if (!buffer || buffer.length < 16) return false;
  const hasEbml = buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  if (!hasEbml) return false;

  return buffer.slice(0, 4096).toString('latin1').toLowerCase().includes('webm');
}

function isOggVideo(buffer) {
  return buffer && buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS';
}

function isAviVideo(buffer) {
  if (!buffer || buffer.length < 12) return false;
  return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'AVI ';
}

function matchesAllowedVideoContainer(ext, buffer) {
  const matchers = {
    mp4: isIsoBmffVideo,
    mov: isIsoBmffVideo,
    webm: isWebmVideo,
    ogg: isOggVideo,
    avi: isAviVideo,
  };

  const matcher = matchers[ext];
  return typeof matcher === 'function' ? matcher(buffer) : false;
}

function validatePdfFile(file) {
  ensureNonEmptyBuffer(file);

  const ext = getFileExt(file.originalname);
  const mime = getMime(file);

  if (ext !== 'pdf') {
    throw new Error('Arquivo rejeitado: extensao invalida para PDF.');
  }

  if (mime && mime !== 'application/pdf') {
    throw new Error('Arquivo rejeitado: MIME invalido para PDF.');
  }

  if (!hasPdfSignature(file.buffer) || !hasPdfEOF(file.buffer)) {
    throw new Error('Arquivo rejeitado: assinatura PDF invalida ou arquivo corrompido.');
  }

  const suspiciousToken = hasSuspiciousPdfTokens(file.buffer);
  if (suspiciousToken) {
    throw new Error(`Arquivo rejeitado: PDF contem recurso potencialmente executavel (${suspiciousToken}).`);
  }

  const binarySignature = findSuspiciousBinarySignature(file.buffer, 8192);
  if (binarySignature) {
    throw new Error(`Arquivo rejeitado: PDF contem assinatura suspeita de ${binarySignature}.`);
  }
}

function validateVideoFile(file) {
  ensureNonEmptyBuffer(file);

  const ext = getFileExt(file.originalname);
  const mime = getMime(file);

  if (!ALLOWED_VIDEO_EXTS.includes(ext)) {
    throw new Error('Arquivo rejeitado: extensao de video nao permitida.');
  }

  if (mime && !mime.startsWith('video/')) {
    throw new Error('Arquivo rejeitado: MIME invalido para video.');
  }

  if (!matchesAllowedVideoContainer(ext, file.buffer)) {
    throw new Error('Arquivo rejeitado: assinatura de video invalida ou incompativel com a extensao.');
  }

  const suspiciousBinary = findSuspiciousBinarySignature(file.buffer, 4096);
  if (suspiciousBinary) {
    throw new Error(`Arquivo rejeitado: video contem assinatura suspeita de ${suspiciousBinary}.`);
  }
}

function validatePhotoFile(file) {
  ensureNonEmptyBuffer(file);

  const mime = getMime(file);
  const ext = getFileExt(file.originalname);
  const ok = mime.startsWith('image/') || ALLOWED_PHOTO_EXTS.includes(ext);
  if (!ok) {
    throw new Error(`Tipo de arquivo nao permitido para foto: ${file.mimetype} (.${ext})`);
  }
}

function validateModuleFile(file, targetField) {
  if (targetField === 'pdf_url') {
    validatePdfFile(file);
    return;
  }

  if (targetField === 'video_url') {
    validateVideoFile(file);
    return;
  }

  throw new Error('Upload rejeitado: tipo de arquivo nao suportado.');
}

function isAllowedModuleUpload(file) {
  const ext = getFileExt(file.originalname);
  const mime = getMime(file);

  const isAllowedVideo = mime.startsWith('video/') || ALLOWED_VIDEO_EXTS.includes(ext);
  const isAllowedPdf = mime === 'application/pdf' || ext === 'pdf';

  return isAllowedVideo || isAllowedPdf;
}

function createSecurityAudit(file, targetField) {
  return {
    targetField,
    originalName: String(file?.originalname || ''),
    mime: getMime(file),
    ext: getFileExt(file?.originalname || ''),
    size: Number(file?.size || file?.buffer?.length || 0),
    scannedAt: new Date().toISOString(),
  };
}

module.exports = {
  ALLOWED_PHOTO_EXTS,
  ALLOWED_VIDEO_EXTS,
  createSecurityAudit,
  getFileExt,
  getMime,
  isAllowedModuleUpload,
  validateModuleFile,
  validatePhotoFile,
};
