const crypto = require('crypto');
const express = require('express');

const { admin } = require('../db');
const { adminMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/storage', adminMiddleware, async (req, res) => {
  const projectId = admin.app().options.projectId || process.env.FIREBASE_PROJECT_ID || null;
  const configuredBucket = process.env.FIREBASE_STORAGE_BUCKET || null;
  const initializedBucket = admin.app().options.storageBucket || null;

  try {
    const bucket = admin.storage().bucket();
    const bucketName = bucket.name || initializedBucket;
    const diagnostics = {
      projectId,
      configuredBucket,
      initializedBucket,
      bucketName,
      checks: {
        metadata: { ok: false },
        writeDelete: { ok: false },
      },
    };

    const [metadata] = await bucket.getMetadata();
    diagnostics.checks.metadata = {
      ok: true,
      name: metadata.name || bucketName,
      location: metadata.location || null,
      storageClass: metadata.storageClass || null,
    };

    const tempPath = `_health/storage-check-${Date.now()}-${crypto.randomUUID()}.txt`;
    const tempFile = bucket.file(tempPath);

    await tempFile.save(`storage-check ${new Date().toISOString()}`, {
      resumable: false,
      contentType: 'text/plain; charset=utf-8',
    });
    await tempFile.delete({ ignoreNotFound: true });

    diagnostics.checks.writeDelete = {
      ok: true,
      path: tempPath,
    };

    return res.json({
      success: true,
      message: 'Firebase Storage acessivel',
      data: diagnostics,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Falha no diagnostico do Firebase Storage',
      data: {
        projectId,
        configuredBucket,
        initializedBucket,
        error: error.message,
      },
    });
  }
});

module.exports = router;
