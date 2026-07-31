import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
	extractExtendedContentFromMarkdown,
	simpleMarkdownToHtml,
} from '../../features/tools/getStartedView';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

/** Шаги walkthrough из манифеста. */
function steps(): Array<{ title: string; description: string; media?: { markdown?: string } }> {
	const pkg = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
		contributes: {
			walkthroughs: Array<{ steps: Array<{ title: string; description: string; media?: { markdown?: string } }> }>;
		};
	};
	return pkg.contributes.walkthroughs[0].steps;
}

/**
 * Команды, доступные по ссылке из шага: объявленные в манифесте и служебные,
 * которые расширение регистрирует в коде.
 */
function availableCommands(): Set<string> {
	const pkg = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
		contributes: { commands: Array<{ command: string }> };
	};
	const ids = new Set(pkg.contributes.commands.map((command) => command.command));
	for (const file of sourceFiles(path.join(EXTENSION_ROOT, 'src'))) {
		const text = fs.readFileSync(file, 'utf8');
		for (const match of text.matchAll(/registerCommand\(\s*'([\w.-]+)'/g)) {
			ids.add(match[1]);
		}
		for (const match of text.matchAll(/registerSectionCommand\(\s*'([\w.-]+)'/g)) {
			ids.add(match[1]);
		}
	}
	return ids;
}

/** Файлы исходников расширения. */
function sourceFiles(dir: string, found: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			sourceFiles(full, found);
		} else if (entry.name.endsWith('.ts')) {
			found.push(full);
		}
	}
	return found;
}

suite('walkthrough: шаги', () => {
	test('у каждого шага есть файл, а в нём иллюстрация: снимок экрана или пример', () => {
		for (const step of steps()) {
			const mdPath = step.media?.markdown;
			assert.ok(mdPath, `${step.title}: не задан файл шага`);
			const full = path.join(EXTENSION_ROOT, mdPath as string);
			assert.ok(fs.existsSync(full), `${step.title}: нет файла ${mdPath}`);

			const md = fs.readFileSync(full, 'utf8');
			const image = /!\[.*?\]\((?:images\/)?([^)]+)\)/.exec(md)?.[1];
			// Иллюстрацией считается и текстовый пример: для панелей и цепочек он
			// показывает состав точнее снимка экрана и не устаревает молча
			const sample = /```text[\s\S]+?```/.test(md);
			assert.ok(image || sample, `${step.title}: в файле нет ни картинки, ни примера`);
			if (image) {
				assert.ok(
					fs.existsSync(path.join(EXTENSION_ROOT, 'walkthrough', 'images', image as string)),
					`${step.title}: нет файла картинки ${image}`
				);
			}
		}
	});

	test('ссылки-команды шагов ведут на существующие команды', () => {
		const declared = availableCommands();
		const unknown: string[] = [];
		for (const step of steps()) {
			for (const match of step.description.matchAll(/\]\(command:([\w.-]+)\)/g)) {
				const id = match[1];
				if (id.startsWith('1c-platform-tools.') && !declared.has(id)) {
					unknown.push(`${step.title}: ${id}`);
				}
			}
		}
		assert.deepStrictEqual(unknown, [], `команды шагов не объявлены:\n${unknown.join('\n')}`);
	});

	test('в текст шага не попадают заголовок файла и разметка картинки', () => {
		// в Cursor встроенного walkthrough нет, текст рисуется своим webview
		for (const step of steps()) {
			const md = fs.readFileSync(path.join(EXTENSION_ROOT, step.media?.markdown as string), 'utf8');
			const content = extractExtendedContentFromMarkdown(md);
			assert.ok(!content.startsWith('# '), `${step.title}: заголовок остался в тексте`);
			assert.ok(!content.includes('!['), `${step.title}: разметка картинки осталась в тексте`);
		}
	});

	test('markdown шага превращается в html без сырой разметки ссылок', () => {
		const html = simpleMarkdownToHtml('**Жирный** текст, `код` и [ссылка](../docs/automation.md).');
		assert.strictEqual(html, '<strong>Жирный</strong> текст, <code>код</code> и ссылка.');
	});
});
