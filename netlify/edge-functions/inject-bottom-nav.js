export default async (request, context) => {
  const res = await context.next();
  try {
    // Skip non-HTML
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return res;

    // Optional: if homepage already has a hard-coded bar, skip to avoid duplicates.
    // Comment out the next 3 lines if you want injection on / as well.
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/index.html') return res;

    // Inject CSS link + root + external initializer (mobile-only styles live in CSS)
    const rewriter = new HTMLRewriter()
      .on('head', {
        element(e) {
          e.append('<link rel="stylesheet" href="/nav-bottom.css">', { html: true });
        }
      })
      .on('body', {
        element(e) {
          e.append('<div id="hs-bottom-nav-root"></div><script defer src="/nav-bottom.js"></script>', { html: true });
        }
      });

    return rewriter.transform(res);
  } catch (err) {
    // Never take down the page if anything fails
    return res;
  }
};
