#!/usr/bin/env python3
"""Build the static resource center. Python standard library only; no API calls."""
from pathlib import Path
from html import escape
from html.parser import HTMLParser
import json, math, xml.etree.ElementTree as ET
from datetime import date

ROOT=Path(__file__).resolve().parents[2]
CONTENT=Path(__file__).resolve().parent/'content'
PUBLIC=ROOT/'public'
OUT=PUBLIC/'resources'
BASE='https://hansora.co'
DATE='2026-10-16'
DISPLAY='October 16, 2026'
INDEX_UPDATED='2026-10-17'
ARTICLES=json.loads((CONTENT/'articles.json').read_text())
BY_SLUG={a['slug']:a for a in ARTICLES}
e=escape
class Content(HTMLParser):
    def __init__(self): super().__init__(); self.text=[]; self.headings=[]; self.current=None
    def handle_starttag(self,tag,attrs):
        if tag=='h2': self.current=[dict(attrs).get('id'),[]]
    def handle_data(self,text):
        self.text.append(text)
        if self.current:self.current[1].append(text)
    def handle_endtag(self,tag):
        if tag=='h2' and self.current:
            self.headings.append((self.current[0],''.join(self.current[1])))
            self.current=None
for a in ARTICLES:
    a['modified']=a.get('modified',DATE)
    day=date.fromisoformat(a['modified'])
    a['modified_display']=f'{day:%B} {day.day}, {day.year}'
    a['body']=(CONTENT/f"{a['slug']}.html").read_text()
    parsed=Content();parsed.feed(a['body'])
    a['words']=len(' '.join(parsed.text).split())
    a['minutes']=math.ceil(a['words']/200)
    a['headings']=parsed.headings
    a['url']=f"{BASE}/resources/{a['slug']}/"
ORG={'@type':'Organization','@id':BASE+'/#organization','name':'Hansora AI','url':BASE+'/'}

def crumbs(a=None):
    items=[('Home',BASE+'/'),('Resources',BASE+'/resources/')]
    if a:items.append((a['title'],a['url']))
    return {'@type':'BreadcrumbList','itemListElement':[{'@type':'ListItem','position':i+1,'name':n,'item':u} for i,(n,u) in enumerate(items)]}

def head(title,description,url,prefix,graph,article=False,modified=DATE):
    schema_json=json.dumps({'@context':'https://schema.org','@graph':graph},ensure_ascii=False).replace('</','<'+chr(92)+'/')
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(description)}">
<link rel="canonical" href="{url}">
<meta name="theme-color" content="#0b0d13">
<meta property="og:site_name" content="Hansora AI">
<meta property="og:type" content="{'article' if article else 'website'}">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(description)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{BASE}/resources/assets/resource-center-share.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Hansora AI Resource Center — practical guides for creative work">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(description)}">
<meta name="twitter:image" content="{BASE}/resources/assets/resource-center-share.png">
<meta name="twitter:image:alt" content="Hansora AI Resource Center — practical guides for creative work">
{f'<meta property="article:published_time" content="{DATE}"><meta property="article:modified_time" content="{modified}"><meta property="article:author" content="{BASE}/">' if article else ''}
<link rel="stylesheet" href="{prefix}assets/resources.css">
<script type="application/ld+json">{schema_json}</script>
</head>
<body id="top">
<a class="skip" href="#main">Skip to content</a>
<header class="site-header"><div class="shell header-inner">
<a class="brand" href="{BASE}/" aria-label="Hansora AI home"><span class="brand-mark" aria-hidden="true"></span>HANSORA <em>AI</em></a>
<nav class="top-nav" aria-label="Main navigation"><a href="{prefix or './'}" aria-current="{'true' if article else 'page'}">Resources</a><a href="{BASE}/pricing.html">Pricing</a><a class="nav-cta" href="{BASE}/search-models.html">Start creating ↗</a></nav>
</div></header>'''

def footer():
    return f'''<footer class="site-footer"><div class="shell footer-inner"><span>© 2026 Hansora AI</span><nav class="footer-links" aria-label="Footer"><a href="{BASE}/">Hansora home ↗</a><a href="{BASE}/mcp-setup.html">ChatGPT integration</a><a href="{BASE}/termsofuse">Terms</a><a href="{BASE}/policy">Privacy</a></nav></div></footer></body></html>'''

def card(a,prefix='',number=True):
    return f'''<article class="guide" id="guide-{a['slug']}"><div class="guide-top"><span class="eyebrow">{e(a['category'])}</span><span class="guide-number" aria-hidden="true">{ARTICLES.index(a)+1:02}</span></div><h3><a href="{prefix}{a['slug']}/">{e(a['title'])}</a></h3><p>{e(a['summary'])}</p><div class="guide-meta"><span>{a['minutes']} min read · 2026 edition</span><a href="{prefix}{a['slug']}/" aria-label="Read {e(a['title'])}">Read guide ↗</a></div></article>'''

OUT.mkdir(parents=True,exist_ok=True)
index_url=BASE+'/resources/'
graph=[ORG,{'@type':'CollectionPage','@id':index_url+'#page','url':index_url,'name':'Hansora AI Resource Center','description':'Practical guides to AI creative tools, costs, integrations, and workflows.','inLanguage':'en','publisher':{'@id':ORG['@id']},'mainEntity':{'@type':'ItemList','itemListElement':[{'@type':'ListItem','position':i+1,'url':a['url'],'name':a['title']} for i,a in enumerate(ARTICLES)]}},crumbs()]
index=head('AI Resource Center: Guides, Costs & Workflows | Hansora AI','Practical guides to affordable AI video, all-in-one creative platforms, credits, ChatGPT integration, and image, video, and audio marketing workflows.',index_url,'',graph)
index+='''<main id="main" class="shell"><section class="hero" aria-labelledby="hero-title"><div><div class="eyebrow"><span class="dot" aria-hidden="true"></span>Hansora AI / Resource Center</div><h1 id="hero-title">Better ideas.<br><span>Smarter workflows.</span></h1></div><div class="hero-copy"><p>Practical guides for the work between an idea and a finished asset. Choose your tools, understand the costs, and make your next move.</p><a class="text-link" href="#guides">Explore the guides ↓</a><div class="hero-note">05 guides · Images, video &amp; audio · 2026 edition</div></div></section>
<nav class="topic-nav" aria-label="Explore by topic"><a href="#guide-affordable-ai-video-generators">Buying guides</a><a href="#guide-ai-subscription-alternatives">Costs &amp; credits</a><a href="#guide-ai-video-generation-chatgpt">Integrations</a><a href="#guide-ai-marketing-workflows">Workflows</a></nav>
<section class="featured" aria-labelledby="featured-title"><div class="feature-copy"><span class="eyebrow">The workflow edit</span><h2 id="featured-title"><a href="ai-marketing-workflows/">One product.<br>A world of possibilities.</a></h2><p>From an approved product visual to motion, narration, and captions. A practical workflow with review built into every stage.</p><a class="read-link" href="ai-marketing-workflows/">Build your marketing workflow <span aria-hidden="true">↗</span></a></div><div class="flow-art" aria-hidden="true"><div class="flow-node"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5" y="6" width="30" height="28" rx="3"/><circle cx="26" cy="14" r="3"/><path d="m6 29 9-11 8 9 5-5 7 9"/></svg><span>Visual</span></div><div class="flow-node"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4" y="8" width="25" height="25" rx="4"/><path d="m29 16 7-5v19l-7-5M14 15l9 6-9 6z"/></svg><span>Motion</span></div><div class="flow-node"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 17v6m6-13v20m6-25v30m6-22v14m6-19v24m6-15v6"/></svg><span>Sound</span></div></div></section>
<section aria-labelledby="guides"><div class="section-heading"><h2 id="guides">The resource library</h2><p>Useful answers. Clear next steps.</p></div><div class="guide-grid">'''
index+=''.join(card(a) for a in ARTICLES)
index+='''</div></section><section class="product-overview" aria-labelledby="about-hansora"><div><span class="eyebrow">The platform, explained</span><h2 id="about-hansora">What is Hansora AI?</h2><p>Hansora AI is a creative platform for image, video, voice, and music generation, with additional tools for tasks such as captions and video transformations. Use its website or the supported integration in a compatible AI client.</p><p>It is worth considering when your project needs several media types and you want a shared generation workspace. Choose by the actual tools, settings, and quote required for your deliverable.</p></div><dl class="product-facts"><div><dt>Creative work</dt><dd><a href="https://hansora.co/models.html">Images, video, audio, and specialist tools</a></dd></div><div><dt>Purchasing</dt><dd><a href="https://hansora.co/pricing.html">Pay-as-you-go credit packs and optional subscriptions</a></dd></div><div><dt>Inside your chat</dt><dd><a href="https://hansora.co/mcp-setup.html">Setup guidance for ChatGPT, Claude, and Cursor</a></dd></div><div><dt>Before you run</dt><dd>Check the current model, supported inputs, credit quote, and applicable <a href="https://hansora.co/termsofuse">terms</a>.</dd></div></dl></section><aside class="editorial" aria-labelledby="editorial-title"><h2 id="editorial-title">A note on our guides</h2><p>Published by Hansora AI. These are our own editorial guides, with official sources, practical examples, and clear limitations. AI-assisted research and drafting are checked against linked official documentation. Examples are illustrative, and guides are not independent product rankings. Check current model availability, quotes, and terms before generating. Edition prepared October 16, 2026.</p></aside></main>'''+footer()
(OUT/'index.html').write_text(index)

for a in ARTICLES:
    url=a['url']
    schema={'@type':'Article','@id':url+'#article','headline':a['title'],'description':a['description'],'url':url,'mainEntityOfPage':{'@type':'WebPage','@id':url},'inLanguage':'en','datePublished':DATE,'dateModified':a['modified'],'author':{'@id':ORG['@id']},'publisher':{'@id':ORG['@id']},'image':[BASE+'/resources/assets/resource-center-share.png'],'articleSection':a['category'],'wordCount':a['words'],'isAccessibleForFree':True,'citation':[source['url'] for source in a['sources']]}
    page=head(a['seoTitle'],a['description'],url,'../',[ORG,schema,crumbs(a)],True,a['modified'])
    page+=f'''<main id="main" class="shell"><nav class="breadcrumbs" aria-label="Breadcrumb"><ol><li><a href="{BASE}/">Home</a></li><li><a href="../">Resources</a></li><li aria-current="page">{e(a['title'])}</li></ol></nav><article><header class="article-hero"><span class="eyebrow">{e(a['category'])} / Practical guide</span><h1>{e(a['title'])}</h1><p class="article-deck">{e(a['summary'])}</p><div class="byline"><span>By <strong>Hansora AI</strong> · Publisher-owned editorial</span><span>Published <time datetime="{DATE}">{DISPLAY}</time></span><span>Updated <time datetime="{a['modified']}">{a['modified_display']}</time> · {a['minutes']} min read</span></div></header><div class="article-layout"><nav class="toc" aria-label="In this guide"><h2>In this guide</h2><ol>'''
    page+=''.join(f'<li><a href="#{i}">{e(t)}</a></li>' for i,t in a['headings'])
    sources='<aside class="source-note" aria-labelledby="sources-title"><h2 id="sources-title">Sources and editorial review</h2><p>Official documentation checked October 16, 2026. Published by Hansora AI with AI-assisted research and drafting. Examples are illustrative; comparative guidance is not an independent performance test.</p><ul>'+''.join('<li><a href="'+source['url']+'">'+e(source['name'])+'</a></li>' for source in a['sources'])+'</ul></aside>'
    page+=f'''</ol></nav><div class="prose">{a['body']}{sources}<aside class="takeaway" aria-label="Key takeaway"><h2>Keep this in mind</h2><p>{e(a['takeaway'])}</p></aside><div class="article-cta"><p>Take the next step with Hansora.</p><a class="button" href="{a['product']}">{e(a['cta'])} ↗</a></div></div></div></article><section class="related" aria-labelledby="related-title"><h2 id="related-title">Keep exploring</h2><div class="guide-grid">'''
    page+=''.join(card(BY_SLUG[s],'../') for s in a['related'])
    page+='</div><a class="back-top" href="#top">Back to top ↑</a></section></main>'+footer()
    dest=OUT/a['slug'];dest.mkdir(exist_ok=True);(dest/'index.html').write_text(page)

NS='http://www.sitemaps.org/schemas/sitemap/0.9'
ET.register_namespace('',NS)
def sitemap(dest,existing=()):
    root=ET.Element('{'+NS+'}urlset')
    for path in ['/resources/']+[f"/resources/{a['slug']}/" for a in ARTICLES]:
        u=ET.SubElement(root,'{'+NS+'}url');ET.SubElement(u,'{'+NS+'}loc').text=BASE+path;ET.SubElement(u,'{'+NS+'}lastmod').text=INDEX_UPDATED if path=='/resources/' else BY_SLUG[path.strip('/').split('/')[-1]]['modified']
    for path in existing:
        u=ET.SubElement(root,'{'+NS+'}url');ET.SubElement(u,'{'+NS+'}loc').text=BASE+path
    ET.indent(root);ET.ElementTree(root).write(dest,encoding='utf-8',xml_declaration=True)
sitemap(OUT/'sitemap.xml')
root_sitemap=PUBLIC/'sitemap.xml'
if root_sitemap.exists():
    root=ET.parse(root_sitemap).getroot()
    resource_urls={BASE+'/resources/'} | {a['url'] for a in ARTICLES}
    for item in list(root):
        loc=item.find('{'+NS+'}loc')
        if loc is not None and loc.text in resource_urls:
            root.remove(item)
    resource_root=ET.parse(OUT/'sitemap.xml').getroot()
    for item in resource_root: root.append(item)
    ET.indent(root)
    ET.ElementTree(root).write(root_sitemap,encoding='utf-8',xml_declaration=True)
else:
    sitemap(root_sitemap, ['/','/pricing.html','/models.html','/mcp-setup.html','/search-models.html','/audio.html'])
print(json.dumps({'pages':6,'articles':[{k:a[k] for k in ['slug','words','minutes']} for a in ARTICLES]},indent=2))
