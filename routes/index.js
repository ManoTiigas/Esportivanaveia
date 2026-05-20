module.exports = [
  { path: '/auth', router: require('./auth') },
  { path: '/health', router: require('./health') },
  { path: '/phases', router: require('./phases') },
  { path: '/modules', router: require('./modules') },
  { path: '/quiz', router: require('./quiz') },
  { path: '/simulators', router: require('./simulators') },
  { path: '/ranking', router: require('./ranking') },
  { path: '/users', router: require('./users') },
  { path: '/admin', router: require('./admin') },
  { path: '/upload', router: require('./upload') },
  { path: '/notifications', router: require('./notifications') },
];
