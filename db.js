const path = require('path');
const admin = require('firebase-admin');
require('dotenv').config();

if (!admin.apps.length) {
  let credential;
  let projectId;

  if (process.env.FIREBASE_CREDENTIAL_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIAL_JSON);
    credential = admin.credential.cert(serviceAccount);
    projectId = serviceAccount.project_id;
  } else if (process.env.FIREBASE_CREDENTIAL_PATH) {
    const serviceAccount = require(path.resolve(process.env.FIREBASE_CREDENTIAL_PATH));
    credential = admin.credential.cert(serviceAccount);
    projectId = serviceAccount.project_id;
  } else {
    throw new Error(
      'Nenhuma credencial Firebase configurada. Defina FIREBASE_CREDENTIAL_PATH ou FIREBASE_CREDENTIAL_JSON.'
    );
  }

  const resolvedProjectId = process.env.FIREBASE_PROJECT_ID || projectId;
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ||
    (resolvedProjectId ? `${resolvedProjectId}.appspot.com` : undefined);

  admin.initializeApp({
    credential,
    projectId: resolvedProjectId,
    storageBucket,
  });

  console.log('Firebase Admin inicializado!');
}

const db = admin.firestore();

db.collection('_health')
  .limit(1)
  .get()
  .then(() => console.log('Firestore conectado!'))
  .catch(err => {
    console.error('Erro ao conectar ao Firestore:', err.message);
    console.error('Verifique as configuracoes do Firebase.');
  });

async function getNextId(collection) {
  const counterRef = db.collection('_counters').doc(collection);
  const result = await db.runTransaction(async t => {
    const doc = await t.get(counterRef);
    const next = (doc.exists ? doc.data().current : 0) + 1;
    t.set(counterRef, { current: next });
    return next;
  });
  return result;
}

module.exports = { db, admin, getNextId };
