import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { TREE_GROUPS } from '../../features/tools/treeStructure';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');
const COMMAND_PREFIX = '1c-platform-tools.';

/**
 * Команды, зарегистрированные в коде намеренно без объявления в манифесте:
 * служебные обработчики и команды, доступные только агенту.
 */
const REGISTERED_WITHOUT_DECLARATION = new Set([
	'1c-platform-tools.env.status',
	'1c-platform-tools.env.refreshVersion',
	'1c-platform-tools.env.statusBarRefresh',
	'1c-platform-tools.externalProcessors.run',
	'1c-platform-tools.server.statusBarRefresh',
	'1c-platform-tools.serviceFiles.ensure',
	'1c-platform-tools.settings.openIpc',
	'1c-platform-tools.todo.openLocation',
]);

/** Файлы исходников расширения без тестов. */
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

/** Идентификаторы команд, объявленных в манифесте. */
function declaredCommands(): Set<string> {
	const pkg = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
		contributes: { commands: Array<{ command: string }> };
	};
	return new Set(pkg.contributes.commands.map((command) => command.command));
}

/** Идентификаторы команд, зарегистрированных в коде. */
function registeredCommands(): Set<string> {
	const registered = new Set<string>();
	// команды регистрируются напрямую и через обёртки: registerVRunnerCommand,
	// registerSectionCommand, registerFromEditor
	const pattern = /register\w*(?:Command|FromEditor)\(\s*'([^']+)'/g;
	for (const file of sourceFiles(path.join(EXTENSION_ROOT, 'src'))) {
		const text = fs.readFileSync(file, 'utf8');
		for (const match of text.matchAll(pattern)) {
			registered.add(match[1]);
		}
	}
	return registered;
}

suite('манифест команд', () => {
	test('объявленная команда имеет обработчик', () => {
		const registered = registeredCommands();
		const orphans = [...declaredCommands()].filter((id) => !registered.has(id));
		assert.deepStrictEqual(orphans, [], `команды без обработчика: ${orphans.join(', ')}`);
	});

	test('зарегистрированная команда объявлена или значится служебной', () => {
		const declared = declaredCommands();
		const undeclared = [...registeredCommands()].filter(
			(id) => id.startsWith(COMMAND_PREFIX) && !declared.has(id) && !REGISTERED_WITHOUT_DECLARATION.has(id)
		);
		assert.deepStrictEqual(
			undeclared,
			[],
			`команды без объявления: ${undeclared.join(', ')}. Объявите их в package.json или внесите в список служебных`
		);
	});

	test('дерево инструментов вызывает существующие команды', () => {
		const declared = declaredCommands();
		const tree = fs.readFileSync(
			path.join(EXTENSION_ROOT, 'src/features/tools/treeStructure.ts'),
			'utf8'
		);
		const missing = [...tree.matchAll(/command:\s*'(1c-platform-tools\.[^']+)'/g)]
			.map((match) => match[1])
			.filter((id) => !declared.has(id));
		assert.deepStrictEqual(missing, [], `узлы дерева ссылаются на несуществующие команды: ${missing.join(', ')}`);
	});

	test('группа тестового окружения: тестовые расширения и unit тесты, порядок по действию', () => {
		const group = TREE_GROUPS.find((item) => item.sectionType === 'testEnvironment');
		assert.ok(group, 'группа «Тестовое окружение» пропала из дерева');
		assert.deepStrictEqual(
			group.commands.map((command) => command.command),
			[
				'1c-platform-tools.test.loadExtensions',
				'1c-platform-tools.test.dumpExtensions',
				'1c-platform-tools.test.buildExtensions',
				'1c-platform-tools.test.buildEpf',
				'1c-platform-tools.test.decompileExtensions',
				'1c-platform-tools.test.decompileEpf',
			],
			'состав или порядок команд тестового окружения разошёлся с задуманным'
		);
	});

	test('команды расширений решения не смешаны с тестовыми', () => {
		const group = TREE_GROUPS.find((item) => item.sectionType === 'extension');
		assert.ok(group, 'группа «Расширения» пропала из дерева');
		const foreign = group.commands
			.map((command) => command.command)
			.filter((id) => !id.startsWith('1c-platform-tools.extensions.'));
		assert.deepStrictEqual(foreign, [], `в группе расширений решения чужие команды: ${foreign.join(', ')}`);
	});

	test('меню вызывают существующие команды', () => {
		const declared = declaredCommands();
		const pkg = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
			contributes: { menus: Record<string, Array<{ command?: string }>> };
		};
		const missing: string[] = [];
		for (const entries of Object.values(pkg.contributes.menus)) {
			for (const entry of entries) {
				if (entry.command && !declared.has(entry.command)) {
					missing.push(entry.command);
				}
			}
		}
		assert.deepStrictEqual(missing, [], `меню ссылаются на несуществующие команды: ${missing.join(', ')}`);
	});
});

suite('схема пользовательских хуков', () => {
	test('содержит команды, доступные агенту, и не содержит скрытые', () => {
		const schema = JSON.parse(
			fs.readFileSync(path.join(EXTENSION_ROOT, 'resources/schemas/hooks.schema.json'), 'utf8')
		) as { properties: { hooks: { propertyNames: { enum: string[] } } } };
		const allowed = new Set(schema.properties.hooks.propertyNames.enum);

		assert.ok(allowed.has('*'), 'подстановка на все команды осталась');
		for (const id of [
			'1c-platform-tools.test.xunit',
			'1c-platform-tools.env.selectProfile',
			'1c-platform-tools.configuration.loadFromSrc',
		]) {
			assert.ok(allowed.has(id), `команда ${id} должна быть в подсказках хуков`);
		}
		for (const id of [
			'1c-platform-tools.help.openSponsor',
			'1c-platform-tools.metadata.refresh',
			'1c-platform-tools.projects.create',
		]) {
			assert.ok(!allowed.has(id), `команда ${id} интерактивная, хуку не нужна`);
		}
	});

	test('перечисленные команды существуют', () => {
		const schema = JSON.parse(
			fs.readFileSync(path.join(EXTENSION_ROOT, 'resources/schemas/hooks.schema.json'), 'utf8')
		) as { properties: { hooks: { propertyNames: { enum: string[] } } } };
		const declared = declaredCommands();
		const missing = schema.properties.hooks.propertyNames.enum
			.filter((id) => id !== '*')
			.filter((id) => !declared.has(id));
		assert.deepStrictEqual(missing, [], `в схеме несуществующие команды: ${missing.join(', ')}`);
	});
});
