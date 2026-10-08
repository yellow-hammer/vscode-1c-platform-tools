import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { TREE_GROUPS } from '../../features/tools/treeStructure';
import { REGISTERED_WITHOUT_DECLARATION } from './registeredWithoutDeclaration';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');
const COMMAND_PREFIX = '1c-platform-tools.';

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

/** Команды контекстного меню узлов, которые и без узла делают полезное. */
const NODE_COMMANDS_IN_PALETTE = new Map<string, string>([
	['1c-platform-tools.metadata.validateDump', 'проверяет выгрузки текущего проекта'],
	['1c-platform-tools.pipelines.run', 'открывает выбор пайплайна'],
	['1c-platform-tools.project.initialize', 'предлагает папку для packagedef'],
]);

/** Скрытые из палитры команды и команды контекстного меню узлов деревьев. */
function paletteAndNodeCommands(): { hidden: Set<string>; nodeCommands: Set<string> } {
	const pkg = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
		contributes: { menus: Record<string, Array<{ command?: string; when?: string }>> };
	};
	const menus = pkg.contributes.menus;
	const hidden = new Set(
		(menus.commandPalette ?? [])
			.filter((entry) => entry.when === 'false' && entry.command)
			.map((entry) => entry.command as string)
	);
	const nodeCommands = new Set(
		(menus['view/item/context'] ?? []).map((entry) => entry.command).filter((id): id is string => id !== undefined)
	);
	return { hidden, nodeCommands };
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
				'1c-platform-tools.test.addYaxunit',
				'1c-platform-tools.test.loadExtensions',
				'1c-platform-tools.test.dumpExtensions',
				'1c-platform-tools.test.compileExtensions',
				'1c-platform-tools.test.compileEpf',
				'1c-platform-tools.test.decompileExtensions',
				'1c-platform-tools.test.decompileEpf',
			],
			'состав или порядок команд тестового окружения разошёлся с задуманным'
		);
	});

	test('группа тестирования: прогоны, мутационное тестирование, затем отчёт Allure', () => {
		const group = TREE_GROUPS.find((item) => item.sectionType === 'test');
		assert.ok(group, 'группа «Тестирование» пропала из дерева');
		assert.deepStrictEqual(
			group.commands.map((command) => command.command),
			[
				'1c-platform-tools.test.xunit',
				'1c-platform-tools.syntaxCheck.run',
				'1c-platform-tools.edt.validate',
				'1c-platform-tools.test.vanessa',
				'1c-platform-tools.test.yaxunit',
				'1c-platform-tools.test.mutatos',
				'1c-platform-tools.test.allure',
			],
			'состав или порядок команд тестирования разошёлся с задуманным'
		);
	});

	test('команды расширений решения не смешаны с тестовыми', () => {
		const group = TREE_GROUPS.find((item) => item.sectionType === 'extension');
		assert.ok(group, 'группа «Расширения» пропала из дерева');
		const foreign = group.commands
			.map((command) => command.command)
			.filter((id) => !id.startsWith('1c-platform-tools.cfe.'));
		assert.deepStrictEqual(foreign, [], `в группе расширений решения чужие команды: ${foreign.join(', ')}`);
	});

	test('кнопки в приветствиях представлений вызывают существующие команды', () => {
		const declared = declaredCommands();
		const pkg = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
			contributes: { viewsWelcome?: Array<{ view: string; contents: string }> };
		};
		const missing: string[] = [];
		for (const entry of pkg.contributes.viewsWelcome ?? []) {
			for (const match of entry.contents.matchAll(/\]\(command:([\w.-]+)\)/g)) {
				const id = match[1];
				if (id.startsWith(COMMAND_PREFIX) && !declared.has(id)) {
					missing.push(`${entry.view}: ${id}`);
				}
			}
		}
		assert.deepStrictEqual(
			missing,
			[],
			`приветствия ссылаются на несуществующие команды: ${missing.join(', ')}. ` +
				'Кнопка удалённой команды выглядит рабочей, но ничего не делает'
		);
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

	test('команда узла дерева скрыта из палитры', () => {
		const { hidden, nodeCommands } = paletteAndNodeCommands();
		const visible = [...nodeCommands].filter((id) => !hidden.has(id) && !NODE_COMMANDS_IN_PALETTE.has(id));
		assert.deepStrictEqual(
			visible,
			[],
			`команды контекстного меню узла видны в палитре: ${visible.join(', ')}. ` +
				'Без узла им нечего делать: скройте их в menus.commandPalette'
		);
	});

	test('список команд узла в палитре не протух', () => {
		const { hidden, nodeCommands } = paletteAndNodeCommands();
		const stale = [...NODE_COMMANDS_IN_PALETTE.keys()].filter((id) => !nodeCommands.has(id) || hidden.has(id));
		assert.deepStrictEqual(stale, [], `команды уже не в меню узла или скрыты из палитры: ${stale.join(', ')}`);
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
			'1c-platform-tools.cf.load',
			'1c-platform-tools.infobase.updateDb',
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
