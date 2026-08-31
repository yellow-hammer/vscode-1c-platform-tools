import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

/** Префикс идентификаторов расширения. */
const PREFIX = '1c-platform-tools.';

/** Префикс идентификаторов представлений и их контейнеров. */
const VIEW_PREFIX = '1c-platform-tools-';

/**
 * Домены команд: первый сегмент после префикса называет предмет.
 *
 * Список закрытый: новый домен заводится осознанно, иначе рядом с `metadata`
 * заводится `md`, а рядом с `tasks` - `launch`, и одно действие получает два
 * идентификатора.
 */
const DOMAINS = new Set([
	'artifacts',
	'cf',
	'cfe',
	'clusters',
	'components',
	'debug',
	'dependencies',
	'editors',
	'env',
	'epf',
	'file',
	'help',
	'hooks',
	'infobase',
	'infobaseList',
	'launch',
	'mcp',
	'metadata',
	'pipelines',
	'project',
	'projects',
	'properties',
	'run',
	'server',
	'serviceFiles',
	'session',
	'skills',
	'support',
	'syntaxCheck',
	'tasks',
	'test',
	'todo',
	'tools',
]);

/**
 * Домены со своим узлом внутри: у них третий сегмент называет предмет узла,
 * а не место вызова.
 */
const SUBDOMAINS = new Set(['metadata.er', 'metadata.filters', 'debug.measure']);

/** Контейнеры расширения: представление живёт либо в своём, либо в чужом. */
const OWN_CONTAINERS = new Set([
	'1c-platform-tools-projects',
	'1c-platform-tools-admin',
	'1c-platform-tools-tools',
	'1c-platform-tools-metadata',
	'1c-platform-tools-properties',
	'1c-platform-tools-todo',
]);

interface Contributed {
	command: string;
}

interface View {
	id: string;
}

function contributes(): {
	commands: Contributed[];
	views: Record<string, View[]>;
	viewsContainers: Record<string, Array<{ id: string }>>;
} {
	const pkg = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
		contributes: {
			commands: Contributed[];
			views: Record<string, View[]>;
			viewsContainers: Record<string, Array<{ id: string }>>;
		};
	};
	return pkg.contributes;
}

suite('идентификаторы команд', () => {
	test('идентификатор начинается с префикса расширения', () => {
		const stray = contributes()
			.commands.map((command) => command.command)
			.filter((id) => !id.startsWith(PREFIX));
		assert.deepStrictEqual(stray, [], `команды вне пространства имён расширения: ${stray.join(', ')}`);
	});

	test('домен называет предмет и объявлен в списке', () => {
		const unknown = contributes()
			.commands.map((command) => command.command.slice(PREFIX.length).split('.')[0])
			.filter((domain) => !DOMAINS.has(domain));
		assert.deepStrictEqual(
			[...new Set(unknown)],
			[],
			`неизвестные домены: ${[...new Set(unknown)].join(', ')}. Заведите домен в списке или положите команду в существующий`
		);
	});

	test('третий сегмент только у доменов со своим узлом', () => {
		const wrong: string[] = [];
		for (const { command } of contributes().commands) {
			const parts = command.slice(PREFIX.length).split('.');
			if (parts.length <= 2) {
				continue;
			}
			if (parts.length > 3 || !SUBDOMAINS.has(`${parts[0]}.${parts[1]}`)) {
				wrong.push(command);
			}
		}
		assert.deepStrictEqual(wrong, [], `лишние сегменты: ${wrong.join(', ')}`);
	});

	test('сегмент не начинается с подчёркивания', () => {
		// Скрытие команды из палитры задаётся в menus.commandPalette, а не именем
		const stray = contributes()
			.commands.map((command) => command.command)
			.filter((id) => id.split('.').some((part) => part.startsWith('_')));
		assert.deepStrictEqual(stray, [], `подчёркивание в идентификаторе: ${stray.join(', ')}`);
	});

	test('идентификатор объявлен один раз', () => {
		const ids = contributes().commands.map((command) => command.command);
		const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
		assert.deepStrictEqual(duplicates, [], `команда объявлена дважды: ${duplicates.join(', ')}`);
	});
});

suite('идентификаторы представлений', () => {
	test('контейнеры расширения совпадают со списком', () => {
		const declared = Object.values(contributes().viewsContainers)
			.flat()
			.map((container) => container.id);
		assert.deepStrictEqual([...declared].sort(), [...OWN_CONTAINERS].sort());
	});

	test('представление начинается с префикса расширения', () => {
		const stray = Object.values(contributes().views)
			.flat()
			.map((view) => view.id)
			.filter((id) => !id.startsWith(VIEW_PREFIX));
		assert.deepStrictEqual(stray, [], `представления вне пространства имён: ${stray.join(', ')}`);
	});

	test('в своём контейнере представление названо по контейнеру', () => {
		const wrong: string[] = [];
		for (const [container, views] of Object.entries(contributes().views)) {
			if (!OWN_CONTAINERS.has(container)) {
				continue;
			}
			for (const view of views) {
				if (view.id === container || !view.id.startsWith(`${container}-`)) {
					wrong.push(`${view.id} в контейнере ${container}`);
				}
			}
		}
		assert.deepStrictEqual(
			wrong,
			[],
			`идентификатор представления совпадает с контейнером или не назван по нему:\n${wrong.join('\n')}`
		);
	});
});
