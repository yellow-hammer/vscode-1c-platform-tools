import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

/**
 * Словарь действий: одна иконка - одно начало подписи. Кнопки панелей ищут
 * глазами по значку, поэтому «Обновить» под значком обновления и «Настройки»
 * под шестерёнкой должны быть везде одинаковыми.
 */
const ICON_RULES = new Map<string, string>([
	['$(refresh)', 'Обновить'],
	['$(gear)', 'Настройки'],
	['$(clear-all)', 'Сбросить'],
	['$(list-flat)', 'Показать списком'],
	['$(list-tree)', 'Показать по'],
	['$(collapse-all)', 'Свернуть'],
	['$(add)', 'Создать'],
]);

/** Порядок кнопок: настройки предпоследние, обновление последнее. */
const GROUP_BY_ICON = new Map<string, number>([
	['$(gear)', 20],
	['$(refresh)', 30],
]);

/**
 * Слово категории в нижнем регистре: палитра показывает «категория: заголовок»,
 * поэтому объект, названный категорией, в заголовке не повторяется.
 */
const CATEGORY_STEMS = new Map<string, string>([
	['1С: Метаданные', 'метаданн'],
	['1С: Кластеры', 'кластер'],
	['1С: Администрирование', 'администрирован'],
	['1С: Список дел', 'список дел'],
	['1С: Артефакты', 'артефакт'],
	['1С: Проекты', 'проектов'],
	['1С: Инструменты', 'инструмент'],
]);

/** Кнопки, которым повтор нужен, с причиной. */
const CATEGORY_IN_TITLE_ALLOWED = new Set([
	// Кнопка стоит в заголовке панели инструментов: там подпись без объекта не читается
	'1c-platform-tools.todo.showPanel',
]);

interface Contributed {
	command: string;
	title: string;
	category?: string;
	icon?: string | Record<string, string>;
}

/** Манифест расширения. */
function manifest(): {
	contributes: {
		commands: Contributed[];
		menus: Record<string, Array<{ command?: string; when?: string; group?: string }>>;
	};
} {
	return JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8'));
}

/** Команды, вынесенные кнопками в заголовки панелей. */
function titleButtons(): Array<{ command: Contributed; group: string }> {
	const { commands, menus } = manifest().contributes;
	const byId = new Map(commands.map((command) => [command.command, command]));
	const buttons: Array<{ command: Contributed; group: string }> = [];
	for (const entry of menus['view/title'] ?? []) {
		const command = entry.command ? byId.get(entry.command) : undefined;
		if (command && (entry.group ?? '').startsWith('navigation')) {
			buttons.push({ command, group: entry.group ?? '' });
		}
	}
	return buttons;
}

/** Иконка команды в виде строки (тематические иконки пропускаем). */
function iconOf(command: Contributed): string | undefined {
	return typeof command.icon === 'string' ? command.icon : undefined;
}

suite('кнопки в заголовках панелей', () => {
	test('под одинаковым значком одинаковая подпись', () => {
		const wrong: string[] = [];
		for (const { command } of titleButtons()) {
			const icon = iconOf(command);
			const expected = icon ? ICON_RULES.get(icon) : undefined;
			if (expected && !command.title.startsWith(expected)) {
				wrong.push(`${command.command}: «${command.title}» под значком ${icon}, ожидалось начало «${expected}»`);
			}
		}
		assert.deepStrictEqual(wrong, [], `подписи разошлись со словарём:\n${wrong.join('\n')}`);
	});

	test('настройки и обновление стоят на своих местах', () => {
		const wrong: string[] = [];
		for (const { command, group } of titleButtons()) {
			const icon = iconOf(command);
			const expected = icon ? GROUP_BY_ICON.get(icon) : undefined;
			if (expected !== undefined && group !== `navigation@${expected}`) {
				wrong.push(`${command.command}: группа ${group}, ожидалась navigation@${expected}`);
			}
		}
		assert.deepStrictEqual(wrong, [], `порядок кнопок нарушен:\n${wrong.join('\n')}`);
	});

	test('у кнопки есть значок: панель показывает значки, а не текст', () => {
		const without = titleButtons()
			.filter(({ command }) => command.icon === undefined)
			.map(({ command }) => command.command);
		assert.deepStrictEqual(without, [], `кнопки без значка: ${without.join(', ')}`);
	});

	test('подпись не повторяет категорию', () => {
		const stuttering: string[] = [];
		for (const { command } of titleButtons()) {
			const stem = command.category ? CATEGORY_STEMS.get(command.category) : undefined;
			if (!stem || CATEGORY_IN_TITLE_ALLOWED.has(command.command)) {
				continue;
			}
			if (command.title.toLowerCase().includes(stem)) {
				stuttering.push(`${command.command}: «${command.category}: ${command.title}»`);
			}
		}
		assert.deepStrictEqual(
			stuttering,
			[],
			`палитра показывает «категория: заголовок», объект назван дважды:\n${stuttering.join('\n')}`
		);
	});

	test('словарь категорий не разъехался с манифестом', () => {
		// Опечатка в ключе молча выключила бы проверку повтора для всей категории
		const declared = new Set(
			manifest()
				.contributes.commands.map((command) => command.category)
				.filter((category): category is string => Boolean(category))
		);
		const stale = [...CATEGORY_STEMS.keys()].filter((category) => !declared.has(category));
		assert.deepStrictEqual(stale, [], `категорий нет в манифесте: ${stale.join(', ')}`);
	});

	test('список разрешённых повторов не протух', () => {
		const byId = new Map(manifest().contributes.commands.map((command) => [command.command, command]));
		const stale: string[] = [];
		for (const id of CATEGORY_IN_TITLE_ALLOWED) {
			const command = byId.get(id);
			const stem = command?.category ? CATEGORY_STEMS.get(command.category) : undefined;
			if (!command) {
				stale.push(`${id}: команды нет в манифесте`);
			} else if (!stem || !command.title.toLowerCase().includes(stem)) {
				stale.push(`${id}: заголовок уже не повторяет категорию`);
			}
		}
		assert.deepStrictEqual(stale, [], `список разрешённых повторов устарел:\n${stale.join('\n')}`);
	});
});
