// Retain this URL for existing feature clients; new jobs use the shared Kling pipeline.
exports.handler=require('../../lib/kling4/features.cjs').launch('background-change');
