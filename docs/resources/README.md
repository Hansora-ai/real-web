# Public resource center

Six buildless HTML pages live in `public/resources/`: an index and five English guides covering affordable video generation, unified creative platforms, subscription alternatives, the Hansora ChatGPT integration, and a marketing production workflow. Every article and FAQ is directly readable in static HTML; the authored resource HTML includes no executable JavaScript. The two downloadable text worksheets support a practical comparison and campaign approval process.

## Maintain the content

Edit `scripts/resources/content/articles.json` for metadata and source links, and the corresponding HTML fragments for the article text. Then run:

```sh
python3 scripts/resources/build.py
node --test test/resources/*.test.mjs
npm run build:functions
```

The generator rewrites the six resource pages, `public/resources/sitemap.xml`, and only the six matching resource entries in the root sitemap. It preserves unrelated sitemap entries and does not rebuild the stylesheet, social image, or worksheets. Update its edition dates only when the published content changes; use the actual first-publication date for datePublished if this edition is first released after October 16, 2026.

The pages use distinct titles/descriptions/canonicals, Open Graph and Twitter metadata, Article/Organization JSON-LD, and visible breadcrumbs matching BreadcrumbList. The index uses CollectionPage/ItemList. FAQPage schema is omitted. Every article links two related guides, official sources, and relevant Hansora product destinations. Written budgeting examples are explicitly hypothetical, not provider prices.

This change adds new files only. It does not edit the existing homepage, footer, navigation, edge function, or Netlify configuration. There is no new link or button on existing pages directing users to the resources. The resource URLs are public, link to one another, and appear in the new sitemap. Existing hosting and edge-function behavior remains in effect, including any mobile-navigation injection.

The newly added robots file declares the sitemap without adding User-agent, Allow, Disallow, or GPTBot rules. The previous repository had no robots file; default crawler permissions are preserved. The root sitemap includes the resources and existing verified public product/setup destinations. Existing-page lastmod values are omitted because their modification dates were not established.

## Editorial basis

This is Hansora-owned editorial content with AI-assisted research and drafting, not independent testing or a ranking endorsement. Sources were checked on October 16, 2026. Product claims are based on the public homepage, pricing, feature pages, integration guide, terms, and the repository's registry configuration at base commit `b29d8f5331dab4546276de4c77715e4c198a1f73`.

The registry and its tests establish configured models, supported inputs, quote handling, and integration functions. They do not establish production uptime, account-specific access, or comparative output quality. No paid generation was submitted. The connected catalog tools returned errors; repository inspection provided an additional verification path after GitHub access was authorized.

Primary sources:

- https://hansora.co/pricing.html — credit packs and optional subscriptions. Its pay-as-you-go section describes non-expiring credits; do not generalize this to every monthly allocation.
- https://hansora.co/search-models.html — current public model selector and input controls. Model names in the copy are labeled as a dated documented snapshot, not guaranteed runtime availability.
- https://hansora.co/models.html — creative feature directory.
- https://hansora.co/mcp-setup.html — published ChatGPT installation/consent flow, MCP address, and other clients. Its ChatGPT CLIENTS instructions were checked against the repository and live returned HTML.
- https://hansora.co/audio.html — audio workspace.
- https://hansora.co/caption-studio — caption/assembly destination.
- https://hansora.co/henshin — transformation destination.
- https://hansora.co/termsofuse — credit failure handling, provider dependence, subscriptions, and commercial-use responsibilities.
- https://developers.openai.com/api/docs/guides/custom-mcp-server — custom connection guidance.
- https://help.runwayml.com/hc/en-us/articles/15124877443219-How-do-credits-work — official competitor credit rules. Web-source retrieval succeeded; direct curl returned 403.
- https://helpx.adobe.com/firefly/web/get-started/learn-the-basics/generative-credits-overview.html — official Adobe credit/feature overview.

The homepage and pricing page displayed inconsistent pack quantities, so the articles intentionally reproduce no fixed pack sizes, dollar prices, or per-model rates. Written examples explain their assumptions and include retry costs. No reviews, awards, customer results, endorsements, or independent price/quality benchmarks were invented.

## Release checks

After merging and Netlify publication:

1. Check `/resources/` and all five article URLs for final HTTP 200 and readable initial HTML. Confirm the existing hosting behavior preserves readable articles and does not add login requirements or noindex.
2. Confirm the resource canonicals, source links, stylesheet, social image, and downloads work. Review access for Googlebot, bingbot, OAI-SearchBot, and Claude-SearchBot through the actual CDN/WAF as well as robots. No training-crawler preference needs to change for search discovery.
3. Confirm `/sitemap.xml` returns XML and `/robots.txt` returns plain text. Submit the sitemap in the verified Google Search Console property under Sitemaps and in Bing Webmaster Tools under Submit sitemaps. Review processing and URL-inspection results.
4. Review the live pricing and integration flow on an account. Refresh statements when product behavior changes.

Local checks cover parsing, structured data, links, mobile layout. Production HTTP responses cannot be certified before the branch is published. Discovery, citations, and recommendations depend on relevance and retrieval; these pages do not guarantee them. Russian and Armenian editions can be added as reviewed translations with self-canonicals and reciprocal hreflang links when those editions are prepared.
