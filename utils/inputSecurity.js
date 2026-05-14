const HEX_COLOR_REGEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function ensureObjectPayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownFields(payload, allowedFields) {
  if (!ensureObjectPayload(payload)) {
    return 'Payload invalido';
  }

  const unknownFields = Object.keys(payload).filter((field) => !allowedFields.includes(field));
  if (unknownFields.length) {
    return `Campos nao permitidos: ${unknownFields.join(', ')}`;
  }

  return null;
}

function normalizeText(value, { maxLength = 500, allowEmpty = false } = {}) {
  if (value === undefined || value === null) {
    return allowEmpty ? '' : null;
  }

  const normalized = String(value)
    .replace(/\0/g, '')
    .replace(/\r/g, '')
    .trim();

  if (!normalized) {
    return allowEmpty ? '' : null;
  }

  return normalized.slice(0, maxLength);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizePlainText(value, options = {}) {
  const normalized = normalizeText(value, options);
  if (normalized === null) return null;
  return escapeHtml(normalized);
}

function sanitizeRichHtml(value, { maxLength = 20000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) {
    return allowEmpty ? '' : null;
  }

  let normalized = String(value).replace(/\0/g, '').trim();
  if (!normalized) return allowEmpty ? '' : null;

  normalized = normalized.slice(0, maxLength);
  normalized = normalized
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?>/gi, '');

  return normalized;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}

function normalizeInteger(value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeNumber(value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeHexColor(value, fallback = '#00C2FF') {
  const normalized = String(value || '').trim();
  return HEX_COLOR_REGEX.test(normalized) ? normalized : fallback;
}

function normalizeConversation(value, { maxMessages = 50, maxTextLength = 1000 } = {}) {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, maxMessages)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;

      const role = ['agent', 'user', 'assistant', 'client'].includes(String(item.role || '').toLowerCase())
        ? String(item.role).toLowerCase()
        : 'user';
      const text = sanitizePlainText(item.text, { maxLength: maxTextLength, allowEmpty: false });
      if (!text) return null;

      return { role, text };
    })
    .filter(Boolean);
}

module.exports = {
  normalizeBoolean,
  normalizeConversation,
  normalizeHexColor,
  normalizeInteger,
  normalizeNumber,
  normalizeText,
  rejectUnknownFields,
  sanitizePlainText,
  sanitizeRichHtml,
};
