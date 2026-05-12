module.exports = [
  { path: '/auth', router: require('./auth') },
  { path: '/phases', router: require('./phases') },
  { path: '/modules', router: require('./modules') },
  { path: '/quiz', router: require('./quiz') },
  { path: '/simulators', router: require('./simulators') },
  { path: '/ranking', router: require('./ranking') },
  { path: '/admin', router: require('./admin') },
  { path: '/upload', router: require('./upload') },
  { path: '/notifications', router: require('./notifications') },
];
