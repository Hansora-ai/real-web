exports.handler = async () => {
  return {
    statusCode: 200,
    body: 'timeout refunds disabled; refund only on provider terminal failure'
  };
};
