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

interface Contributed {
	command: string;
	title: string;
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

	test('подпись называет объект действия', () => {
		// «Обновить» без объекта в палитре не отличить от других обновлений
		const bare = titleButtons()
			.map(({ command }) => command)
			.filter((command) => ['Обновить', 'Настройки', 'Создать', 'Сбросить'].includes(command.title.trim()))
			.map((command) => command.command);
		assert.deepStrictEqual(bare, [], `подписи без объекта: ${bare.join(', ')}`);
	});
});
