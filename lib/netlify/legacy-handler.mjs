import { withLambda } from '@netlify/aws-lambda-compat';

export function withLegacyHandler(handler) {
  if (typeof handler !== 'function') throw new TypeError('Missing Netlify function handler');
  return withLambda(async (event, context) => {
    const result = await handler(event, context);
    // Fetch forbids bodies on these responses, including an empty string.
    // Existing Lambda handlers commonly return a body with OPTIONS/204.
    if ([204, 205, 304].includes(result?.statusCode)) return { ...result, body: undefined };
    return result;
  });
}
