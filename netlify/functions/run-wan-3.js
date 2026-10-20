// New Wan 3.0 jobs use reAPI. Existing KIE jobs retain their original checker.
exports.handler = require('../../lib/reapi/launch.cjs').handler('wan-3');
