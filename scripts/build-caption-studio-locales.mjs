// Localized HTML shells share one editor; no duplicated editor behavior.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { translate } from '../public/caption-studio/locale.mjs';
const root = new URL('../public/', import.meta.url);
const decode = text => text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const escape = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function localizedShell(source, lang) {
  let html = source.replace('<html lang="en">', `<html lang="${lang}">`);
  html = html.replace(/>([^<>]+)</g, (match, value) => {
    const key = value.trim();
    return '>' + value.replace(key, () => escape(translate(decode(key), {}, lang))) + '<';
  });
  html = html.replace(/\b(aria-label|placeholder|title|content|alt|value)="([^"]*)"/g, (match, name, value) => `${name}="${escape(translate(decode(value), {}, lang))}"`);
  // The only relative navigation in the shell is the editor's back button.
  return html.replace('id="editor-back" href="/"', `id="editor-back" href="/index_${lang === 'hy' ? 'arm' : 'ru'}.html"`);
}
export async function build() {
  const source = await readFile(new URL('caption-studio.html', root), 'utf8');
  for (const [lang, suffix] of [['ru', 'ru'], ['hy', 'arm']])
    await writeFile(new URL(`caption-studio_${suffix}.html`, root), localizedShell(source, lang));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await build();
