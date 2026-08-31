import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');
const SECTION = '1c-platform-tools';

interface Declared {
	readonly key: string;
	readonly type: string;
}

/** Настройки, объявленные в манифесте: полный ключ и тип значения. */
function declared(): Declared[] {
	const pkg = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
		contributes: { configuration: unknown };
	};
	const blocks = Array.isArray(pkg.contributes.configuration)
		? (pkg.contributes.configuration as Array<{ properties?: Record<string, { type?: string }> }>)
		: [pkg.contributes.configuration as { properties?: Record<string, { type?: string }> }];
	const out: Declared[] = [];
	for (const block of blocks) {
		for (const [key, value] of Object.entries(block.properties ?? {})) {
			out.push({ key, type: String(value.type ?? '') });
		}
	}
	return out;
}

/** Ключи настроек, объявленные в манифесте (полные, с префиксом расширения). */
function declaredKeys(): Set<string> {
	return new Set(declared().map((item) => item.key));
}

/** Файлы расширения без тестов. */
function sourceFiles(dir: string, found: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (path.relative(EXTENSION_ROOT, full) === path.join('src', 'test')) {
				continue;
			}
			sourceFiles(full, found);
		} else if (entry.name.endsWith('.ts')) {
			found.push(full);
		}
	}
	return found;
}

interface KeyUse {
	readonly key: string;
	readonly file: string;
}

/**
 * Чтения настроек в коде.
 *
 * Ключ в коде короткий и отсчитывается от секции, переданной в
 * {@code getConfiguration}. Ищем два вида: цепочку прямо от вызова и чтение
 * через переменную, в которую секция сохранена. Чужие `get` - у globalState,
 * у Map - под это не попадают.
 */
function keyUses(): KeyUse[] {
	const uses: KeyUse[] = [];
	const chained = /getConfiguration\(\s*'([^']*)'\s*\)\s*\.get(?:<[^>]*>)?\(\s*'([^']+)'/g;
	const assigned = /(?:const|let|var)\s+(\w+)\s*=\s*[\w.]*getConfiguration\(\s*'([^']*)'\s*\)/g;
	for (const file of sourceFiles(path.join(EXTENSION_ROOT, 'src'))) {
		const relative = path.relative(EXTENSION_ROOT, file);
		const text = fs.readFileSync(file, 'utf8').replace(/\s+/g, ' ');
		for (const match of text.matchAll(chained)) {
			if (match[1].startsWith(SECTION)) {
				uses.push({ key: `${match[1]}.${match[2]}`, file: relative });
			}
		}
		const sections = new Map<string, string>();
		for (const match of text.matchAll(assigned)) {
			if (match[2].startsWith(SECTION)) {
				sections.set(match[1], match[2]);
			}
		}
		for (const [name, section] of sections) {
			const byVariable = new RegExp(String.raw`\b${name}\.get(?:<[^>]*>)?\(\s*'([^']+)'`, 'g');
			for (const match of text.matchAll(byVariable)) {
				uses.push({ key: `${section}.${match[1]}`, file: relative });
			}
		}
	}
	return uses;
}

/**
 * Ключи, которых в манифесте нет намеренно: расширение хранит их само, а не
 * показывает в настройках.
 */
const NOT_DECLARED = new Set<string>([]);

suite('ключи настроек', () => {
	test('код читает только объявленные настройки', () => {
		const keys = declaredKeys();
		const stray = keyUses()
			.filter((use) => !keys.has(use.key) && !NOT_DECLARED.has(use.key))
			.map((use) => `${use.key} (${use.file})`);
		assert.deepStrictEqual(
			[...new Set(stray)],
			[],
			`настройки нет в манифесте, чтение вернёт значение по умолчанию:\n${[...new Set(stray)].join('\n')}`
		);
	});

	test('слово path стоит перед тем, на что путь указывает', () => {
		// Иначе отбор по слову в редакторе настроек не собирает пути вместе.
		// Правило про значения-строки: filterOnFullPath - признак, а не путь
		const wrong = declared()
			.filter((item) => item.type === 'string' || item.type === 'array')
			.map((item) => item.key)
			.filter((key) => /(Path|File|Executable|Dir|Location|Folders)$/.test(key) && !key.includes('.path.'));
		assert.deepStrictEqual(wrong, [], `слово в конце ключа: ${wrong.join(', ')}`);
	});

	test('ключ не служит одновременно значением и разделом', () => {
		const keys = [...declaredKeys()];
		const conflicts = keys.filter((key) => keys.some((other) => other.startsWith(`${key}.`)));
		assert.deepStrictEqual(
			conflicts,
			[],
			`у ключа есть вложенные настройки, редактор показывает это как ошибку: ${conflicts.join(', ')}`
		);
	});

	test('у каждой настройки есть домен: ключ длиннее двух сегментов', () => {
		const flat = [...declaredKeys()].filter((key) => key.split('.').length < 3);
		assert.deepStrictEqual(flat, [], `настройка без домена: ${flat.join(', ')}`);
	});
});
