function normalizeId(value) {
  return String(value);
}

function toInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function deleteRefsInChunks(db, refs, chunkSize = 400) {
  for (const chunk of chunkArray(refs, chunkSize)) {
    const batch = db.batch();
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

async function updateDocsInChunks(db, updates, chunkSize = 400) {
  for (const chunk of chunkArray(updates, chunkSize)) {
    const batch = db.batch();
    chunk.forEach(({ ref, data }) => batch.update(ref, data));
    await batch.commit();
  }
}

module.exports = {
  chunkArray,
  deleteRefsInChunks,
  normalizeId,
  toInt,
  toNumber,
  updateDocsInChunks,
};
