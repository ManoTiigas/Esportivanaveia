module.exports = {
  helmet: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
        imgSrc: ["'self'", 'data:', 'https://firebasestorage.googleapis.com'],
        mediaSrc: ["'self'", 'blob:', 'https://firebasestorage.googleapis.com'],
        frameSrc: ["'self'", 'https://firebasestorage.googleapis.com'],
        connectSrc: ["'self'", 'https://firebasestorage.googleapis.com'],
        fontSrc: ["'self'", 'https:', 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  },
};
