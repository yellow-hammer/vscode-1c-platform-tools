import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

/** Редакторы служебных файлов: правят файл, поэтому у них есть кнопка JSON. */
const FILE_EDITORS = [
	{ name: 'пайплайны', file: path.join('src', 'features', 'pipelines', 'pipelineEditorProvider.ts') },
	{ name: 'хуки', file: path.join('src', 'features', 'hooks', 'hooksEditorProvider.ts') },
];

/**
 * Все формы на общем каркасе.
 *
 * Форма подключений к кластерам файла под собой не имеет — список живёт в
 * состоянии расширения, поэтому кнопки JSON у неё нет, а остальное оформление
 * и поведение общие.
 */
const EDITORS = [
	...FILE_EDITORS,
	{ name: 'подключения к кластерам', file: path.join('src', 'features', 'clusters', 'connectionsEditor.ts') },
];

/**
 * Редактор профиля запуска пишет правки в файл сразу, точечно через jsonc:
 * так в файле остаются комментарии пользователя. Панели сохранения у него нет,
 * поэтому общими с остальными редакторами проверяются оформление и подписи.
 */
const PROFILE_EDITOR = path.join('src', 'features', 'profileEditor', 'profileEditorProvider.ts');

const CHROME = path.join('src', 'features', 'editors', 'webviewChrome.ts');

/** Исходник модуля. */
function source(relPath: string): string {
	return fs.readFileSync(path.join(EXTENSION_ROOT, relPath), 'utf8');
}

/** Разметка и скрипт формы из провайдера. */
function parts(relPath: string): { html: string; script: string } {
	const text = source(relPath);
	const scriptStart = text.indexOf('<script nonce=');
	const scriptBody = text.slice(text.indexOf('>', scriptStart) + 1, text.indexOf('</script>', scriptStart));
	return { html: text.slice(text.indexOf('<body>'), scriptStart), script: scriptBody };
}

/** Имена, которые определяет общий каркас. */
function chromeFunctions(): Set<string> {
	return new Set([...source(CHROME).matchAll(/function (\w+)\(/g)].map((match) => match[1]));
}

/** Идентификаторы элементов из разметки каркаса. */
function chromeIds(): Set<string> {
	return new Set([...source(CHROME).matchAll(/id="([\w-]+)"/g)].map((match) => match[1]));
}

/** Слова, которые выглядят как вызов функции, но ей не являются. */
const NOT_FUNCTIONS = new Set([
	'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
	'JSON', 'Math', 'Number', 'String', 'Object', 'Array', 'Map', 'Set',
	'parseInt', 'parseFloat', 'isNaN', 'document', 'window', 'acquireVsCodeApi',
	'setTimeout', 'requestAnimationFrame',
	// части css-значений в строках стиля
	'scale', 'translate', 'url', 'var',
]);

suite('редакторы служебных файлов: общий каркас', () => {
	test('форма не обращается к элементам, которых нет в разметке', () => {
		const ids = chromeIds();
		for (const editor of EDITORS) {
			const { html, script } = parts(editor.file);
			const declared = new Set([...html.matchAll(/id="([\w-]+)"/g)].map((match) => match[1]));
			const used = [...script.matchAll(/getElementById\('([\w-]+)'\)/g)].map((match) => match[1]);
			const missing = used.filter((id) => !declared.has(id) && !ids.has(id));
			assert.deepStrictEqual(missing, [], `${editor.name}: нет элементов ${missing.join(', ')}`);
		}
	});

	test('форма не вызывает функций, которых нет ни в ней, ни в каркасе', () => {
		const shared = chromeFunctions();
		for (const editor of EDITORS) {
			const { script } = parts(editor.file);
			const defined = new Set([...script.matchAll(/function (\w+)\(/g)].map((match) => match[1]));
			const called = new Set([...script.matchAll(/(?<![\w.$])(\w+)\(/g)].map((match) => match[1]));
			const missing = [...called].filter(
				(name) =>
					name[0] === name[0].toLowerCase() &&
					name.length > 2 &&
					!defined.has(name) &&
					!shared.has(name) &&
					!NOT_FUNCTIONS.has(name)
			);
			assert.deepStrictEqual(missing, [], `${editor.name}: не определены ${missing.join(', ')}`);
		}
	});

	test('формы собраны на общем каркасе', () => {
		for (const editor of EDITORS) {
			const text = source(editor.file);
			for (const marker of ['chromeStyles()', 'chromeScript()', 'saveBarHtml()']) {
				assert.ok(text.includes(marker), `${editor.name}: не использует ${marker}`);
			}
		}
	});

	test('редактор профиля запуска оформлен тем же каркасом', () => {
		const text = source(PROFILE_EDITOR);
		assert.ok(text.includes('chromeStyles()'), 'редактор профиля не использует общий CSS');
		assert.ok(text.includes('CHROME_LABELS.json'), 'подпись JSON задана мимо каркаса');
		assert.ok(text.includes('class="toolbar"'), 'нет общей панели действий');
	});

	test('панель сохранения одна на всех и подписи берутся из каркаса', () => {
		const chrome = source(CHROME);
		assert.ok(chrome.includes("id=\"saveButton\""), 'в каркасе нет кнопки сохранения');
		assert.ok(chrome.includes("id=\"cancelButton\""), 'в каркасе нет кнопки отмены');
		for (const editor of EDITORS) {
			const { html } = parts(editor.file);
			assert.ok(
				!/>\s*(Сохранить|Отменить)\s*</.test(html),
				`${editor.name}: подписи сохранения заданы мимо каркаса`
			);
		}
		for (const editor of FILE_EDITORS) {
			const { html } = parts(editor.file);
			assert.ok(html.includes('${CHROME_LABELS.json}'), `${editor.name}: подпись JSON задана мимо каркаса`);
		}
	});

	test('удаление сущности живёт в списке, а не в панели действий', () => {
		for (const editor of EDITORS) {
			const { html } = parts(editor.file);
			assert.ok(
				!html.includes('${CHROME_LABELS.remove}'),
				`${editor.name}: кнопка удаления вернулась в панель действий`
			);
		}
		assert.ok(source(CHROME).includes('options.onRemove'), 'в каркасе нет крестика удаления в строке списка');
	});
});
