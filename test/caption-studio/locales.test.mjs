import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { messages } from '../../public/caption-studio/messages.mjs';
import { languageFor, localizedHref, translate, errorMessage } from '../../public/caption-studio/locale.mjs';
import { localizedShell } from '../../scripts/build-caption-studio-locales.mjs';
const page = name => readFile(new URL(`../../public/${name}.html`, import.meta.url), 'utf8');

test('locale routes and links retain query parameters and the selected language', () => {
  assert.equal(languageFor('/caption-studio_arm.html', 'en'), 'hy');
  assert.equal(languageFor('/caption-studio_ru.html', 'en'), 'ru');
  assert.equal(languageFor('/caption-studio.html', 'en'), 'en');
  assert.equal(localizedHref('/caption-studio.html?project=12#preview', 'ru'), '/caption-studio_ru.html?project=12#preview');
  assert.equal(localizedHref('/caption-studio_ru.html', 'hy'), '/caption-studio_arm.html');
});
test('UI messages handle counts, errors and literal user filenames without translating their contents', () => {
  assert.equal(translate('{0} captions', {0: 1}, 'ru'), 'Субтитров: 1');
  assert.equal(translate('{0} captions', {0: 12}, 'hy'), 'Ենթագրեր՝ 12');
  assert.equal(translate('Add {0} to timeline', {0: '$& <Моя работа>.mp4'}, 'ru'), 'Добавить «$& <Моя работа>.mp4» в монтаж');
  assert.equal(translate('Rendering 42%', {}, 'hy'), 'Մշակում՝ 42%');
  assert.equal(translate('Not enough credits. Auto captions for this video cost 5⚡.', {}, 'ru'), 'Недостаточно кредитов. Субтитры для этого видео стоят 5⚡.');
  assert.equal(translate('Բարև world привет', {}, 'ru'), 'Բարև world привет');
  assert.equal(translate('a-user-file-$1.mp4', {}, 'hy'), 'a-user-file-$1.mp4');
  assert.equal(translate('Caption length', {}, 'en'), 'Caption length');
  assert.equal(errorMessage('Could not make captions. Try again. Captions for the other videos were added. 5⚡ were returned.', 'ru'),
    'Не удалось создать субтитры. Попробуйте снова. Субтитры для остальных видео добавлены. Возвращено: 5⚡.');
});
test('every message keeps its interpolation slots in both languages', () => {
  const slots = text => [...text.matchAll(/\{\d+\}/g)].map(m => m[0]).sort();
  for (const [key, values] of Object.entries(messages)) for (const lang of ['ru', 'hy']) {
    assert.ok(values[lang]?.trim(), `${key} missing ${lang}`);
    assert.deepEqual(slots(values[lang]), slots(key), `${lang}: ${key}`);
  }
});
test('translated shells preserve editor IDs, protocol values, imports and the full control set', async () => {
  const source = await page('caption-studio');
  const ids = html => [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const values = html => [...html.matchAll(/<option[^>]*\bvalue="([^"]+)"/g)].map(m => m[1]);
  for (const [lang, suffix] of [['ru', 'ru'], ['hy', 'arm']]) {
    const localized = await page(`caption-studio_${suffix}`);
    assert.equal(localized, localizedShell(source, lang), 'regenerate translated pages after editing the shell');
    assert.deepEqual(ids(localized), ids(source));
    assert.deepEqual(values(localized), values(source));
    assert.match(localized, new RegExp(`<html lang="${lang}">`));
    assert.match(localized, /src="\/caption-studio\/studio\.mjs"/);
    assert.match(localized, /env\(|viewport-fit=cover/);
    assert.ok(localized.includes(translate('Back to tools', {}, lang)));
    assert.ok(localized.includes(translate('Download MP4', {}, lang)));
    assert.ok(!localized.includes('>Caption length<'));
    assert.ok(!localized.includes('>Export your video<'));
  }
});
test('localized editor entry links lead to the matching locale', async () => {
  for (const suffix of ['ru', 'arm']) assert.ok((await page(`video-edit_${suffix}`)).includes(`./caption-studio_${suffix}.html`));
});

test('multiline Armenian and Russian captions stay inside the frame at the bottom edge', async () => {
  const { drawCaption } = await import('../../public/caption-studio/render.mjs');
  const { newProject } = await import('../../public/caption-studio/core.mjs');
  const context = new Proxy({
    font: '',
    measureText(text) { const size = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] || 16); return { width: [...text].length * size * .6 }; },
  }, { get(target, name) { return name in target ? target[name] : () => {}; } });
  for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
    for (const text of [
      'Ստեղծեք ձեր տեսանյութը և ավելացրեք գեղեցիկ ու ընթեռնելի ենթագրեր։',
      'Создайте своё видео и добавьте красивые, удобные для чтения субтитры.',
    ]) {
      const project = newProject(); project.style.y = 100;
      const box = drawCaption(context, project, { id: 'caption', text, start: 0, end: 3 }, 1, w, h);
      assert.ok(box.x >= 0 && box.y >= 0, `${text}: top/left bounds`);
      assert.ok(box.x + box.w <= w && box.y + box.h <= h, `${text}: bottom/right bounds`);
    }
  }
});
