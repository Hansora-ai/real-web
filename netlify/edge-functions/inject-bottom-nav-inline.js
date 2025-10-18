// netlify/edge-functions/inject-bottom-nav-inline.js
export default async (request, context) => {
  const res = await context.next();
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;

  const html = await res.text();
  const hasHeader = html.includes('id=\"navUser\"') || html.includes("id='navUser'");
  const hasBottom = html.includes('class=\"hs-bottom-nav\"') || html.includes("class='hs-bottom-nav'");
  let out = html;

  // HEADER (from Nano Banana)
  const HEADER = ``;
  if (!hasHeader) {
    out = out.replace(/<body([^>]*)>/i, (m,g) => `<body${g}>` + HEADER);
  }

  // BOTTOM NAV (from previous 1:1 index copy)
  const STYLE = ``;
  const NAV = ``;
  if (!hasBottom) {
    out = out.replace('</body>', `${STYLE}${NAV}</body>`);
  }

  // HEADER UI (from Nano Banana, without supabase init)
  const HEADER_UI = `<script>

</script>`;
  out = out.replace('</body>', HEADER_UI + '</body>');

  return new Response(out, { status: res.status, headers: res.headers });
};
