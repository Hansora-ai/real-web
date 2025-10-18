export default async (request, context) => {
  const res = await context.next();
  try {
    const ct = res.headers.get('content-type') || '';
    // Only rewrite HTML responses
    if (!ct.includes('text/html')) return res;

    const rewriter = new HTMLRewriter()
      .on('head', {
        element(e) {
          e.append('<link rel="stylesheet" href="/nav-bottom.css">', { html: true });
        }
      })
      .on('body', {
        element(e) {
          // Insert a root for the bottom nav and load the initializer script
          e.append('<div id="hs-bottom-nav-root"></div><script defer src="/nav-bottom.js"></script>', { html: true });
        }
      });
    return rewriter.transform(res);
  } catch (err) {
    // Never crash the page if injection fails; return the original response
    return res;
  }
};
