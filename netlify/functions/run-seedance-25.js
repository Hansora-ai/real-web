// All new Seedance requests use reAPI; legacy jobs keep their original checker.
exports.handler = require('../../lib/reapi/launch.cjs').handler('2.5');
