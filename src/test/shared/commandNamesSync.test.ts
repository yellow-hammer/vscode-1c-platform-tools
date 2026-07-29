import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

/**
 * Команды, у которых заголовки двух источников намеренно разные.
 *
 * В package.json заголовок рассчитан на палитру и контекстное меню, в
 * commandNames - на сообщения и записи журнала, где нужен объект действия.
 * Остальные расхождения означают, что источники разъехались.
 */
const INTENDED_DIFFERENCES = new Map<string, string>([
	['1c-platform-tools.artifacts.buildProcessor', 'в меню артефакта достаточно «Собрать»'],
	['1c-platform-tools.artifacts.buildReport', 'в меню артефакта достаточно «Собрать»'],
	['1c-platform-tools.artifacts.decompileProcessor', 'в меню артефакта достаточно «Разобрать»'],
	['1c-platform-tools.artifacts.decompileReport', 'в меню артефакта достаточно «Разобрать»'],
	['1c-platform-tools.configuration.build', 'в журнале без путей: «Собрать конфигурацию»'],
	['1c-platform-tools.configuration.decompile', 'в журнале без путей: «Разобрать конфигурацию»'],
	['1c-platform-tools.extensions.build', 'в журнале без путей: «Собрать расширения»'],
	['1c-platform-tools.extensions.decompile', 'в журнале без путей: «Разобрать расширения»'],
]);

/**
 * Команды, у которых заголовок зависит от режима вызова: для них достаточно,
 * чтобы с манифестом совпадал хотя бы один вариант.
 */
const COMMANDS_WITH_VARIANTS = new Set(['1c-platform-tools.test.vanessa']);

/** Заголовки команд из манифеста. */
function manifestTitles(): Map<string, string> {
	const pkg = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
		contributes: { commands: Array<{ command: string; title: string }> };
	};
	return new Map(pkg.contributes.commands.map((command) => [command.command, command.title]));
}

/** Заголовок команды из commandNames: только литералы, без вычисляемых. */
interface NameEntry {
	id: string;
	title: string;
}

/** Пары «идентификатор - заголовок» из commandNames.ts. */
function commandNameEntries(): NameEntry[] {
	const source = fs.readFileSync(
		path.join(EXTENSION_ROOT, 'src/features/tools/commandNames.ts'),
		'utf8'
	);
	const entries: NameEntry[] = [];
	const pattern = /id:\s*'([^']+)',\s*name:\s*[^,]+,\s*title:\s*'([^']*)'/g;
	for (const match of source.matchAll(pattern)) {
		entries.push({ id: match[1], title: match[2] });
	}
	return entries;
}

suite('заголовки команд в двух источниках', () => {
	test('commandNames описывает существующие команды', () => {
		const manifest = manifestTitles();
		const unknown = commandNameEntries()
			.map((entry) => entry.id)
			.filter((id) => !manifest.has(id));
		assert.deepStrictEqual(unknown, [], `команд нет в манифесте: ${unknown.join(', ')}`);
	});

	test('заголовки совпадают или расхождение объяснено', () => {
		const manifest = manifestTitles();
		const titlesById = new Map<string, string[]>();
		for (const entry of commandNameEntries()) {
			titlesById.set(entry.id, [...(titlesById.get(entry.id) ?? []), entry.title]);
		}
		const drifted: string[] = [];
		for (const [id, titles] of titlesById) {
			const manifestTitle = manifest.get(id);
			if (manifestTitle === undefined || titles.includes(manifestTitle)) {
				continue;
			}
			if (!INTENDED_DIFFERENCES.has(id)) {
				drifted.push(`${id}: «${titles.join('», «')}» против «${manifestTitle}»`);
			}
		}
		assert.deepStrictEqual(
			drifted,
			[],
			`заголовки разъехались:\n${drifted.join('\n')}\nСведите их или внесите расхождение в список с объяснением`
		);
	});

	test('список объяснённых расхождений не протух', () => {
		const manifest = manifestTitles();
		const entries = new Map(commandNameEntries().map((entry) => [entry.id, entry.title]));
		const stale: string[] = [];
		for (const id of INTENDED_DIFFERENCES.keys()) {
			const title = entries.get(id);
			if (title === undefined) {
				stale.push(`${id}: команды нет в commandNames`);
			} else if (manifest.get(id) === title) {
				stale.push(`${id}: заголовки уже совпадают`);
			}
		}
		for (const id of COMMANDS_WITH_VARIANTS) {
			if (!entries.has(id)) {
				stale.push(`${id}: вариантов заголовка больше нет`);
			}
		}
		assert.deepStrictEqual(stale, [], `список расхождений устарел:\n${stale.join('\n')}`);
	});

	test('несколько заголовков только у команд с режимами', () => {
		const seen = new Map<string, string>();
		const conflicts: string[] = [];
		for (const entry of commandNameEntries()) {
			const previous = seen.get(entry.id);
			if (previous !== undefined && previous !== entry.title && !COMMANDS_WITH_VARIANTS.has(entry.id)) {
				conflicts.push(`${entry.id}: «${previous}» и «${entry.title}»`);
			}
			seen.set(entry.id, entry.title);
		}
		assert.deepStrictEqual(conflicts, [], `у команды несколько заголовков:\n${conflicts.join('\n')}`);
	});
});
