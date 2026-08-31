import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';

/** Команда расширения из package.json. */
interface ContributedCommand {
	command: string;
	title: string;
	shortTitle?: string;
	category?: string;
}

/** Содержимое contributes из package.json. */
function contributes(): {
	commands: ContributedCommand[];
	menus: Record<string, Array<{ command?: string; when?: string }>>;
} {
	const pkgPath = path.resolve(__dirname, '../../../package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
		contributes: {
			commands: ContributedCommand[];
			menus: Record<string, Array<{ command?: string; when?: string }>>;
		};
	};
	return pkg.contributes;
}

/** Команды, видимые в палитре. */
function paletteCommands(): ContributedCommand[] {
	const { commands, menus } = contributes();
	const hidden = new Set(
		(menus.commandPalette ?? [])
			.filter((entry) => entry.when === 'false' && entry.command)
			.map((entry) => entry.command as string)
	);
	return commands.filter((command) => !hidden.has(command.command));
}

suite('заголовки команд', () => {
	test('в палитре нет двух команд с одинаковой подписью', () => {
		const seen = new Map<string, string>();
		const duplicates: string[] = [];
		for (const command of paletteCommands()) {
			const label = `${command.category ?? ''}: ${command.title}`;
			const previous = seen.get(label);
			if (previous) {
				duplicates.push(`«${label}» — ${previous} и ${command.command}`);
			}
			seen.set(label, command.command);
		}
		assert.deepStrictEqual(duplicates, [], `подписи повторяются:\n${duplicates.join('\n')}`);
	});

	test('у команды есть категория: без неё палитра теряет раздел', () => {
		const without = paletteCommands()
			.filter((command) => !command.category)
			.map((command) => command.command);
		assert.deepStrictEqual(without, [], `команды без категории: ${without.join(', ')}`);
	});

	test('короткое имя действительно короче полного', () => {
		for (const command of contributes().commands) {
			if (command.shortTitle) {
				assert.ok(
					command.shortTitle.length <= command.title.length,
					`shortTitle длиннее title у ${command.command}`
				);
			}
		}
	});

	test('категории записаны кириллической «С» в префиксе', () => {
		// Палитру ищут кириллицей: «1С Метаданные» набирается без смены раскладки
		for (const command of contributes().commands) {
			if (command.category) {
				assert.ok(
					command.category.startsWith('1С: '),
					`категория «${command.category}» у ${command.command} записана не кириллицей`
				);
			}
		}
	});
});

/**
 * Слово категории в нижнем регистре: палитра показывает «категория: заголовок»,
 * и объект, названный категорией, в заголовке не повторяется.
 *
 * Список закрытый: категории, где слово в заголовке законно (у «1С: Конфигурация»
 * это «Загрузить конфигурацию из src/cf» - имя того же действия в журнале), сюда
 * не заводятся.
 */
const CATEGORY_STEMS = new Map<string, string>([
	['1С: Метаданные', 'метаданн'],
	['1С: Кластеры', 'кластер'],
	['1С: Администрирование', 'администрирован'],
	['1С: Список дел', 'список дел'],
	['1С: Артефакты', 'артефакт'],
	['1С: Инструменты', 'инструмент'],
	['1С: Задачи', 'задач'],
	['1С: Сеансы', 'сеанс'],
	['1С: Конфигурации запуска', 'конфигурации запуска'],
	['1С: Служебные файлы', 'служебн'],
	['1С: Внешние файлы', 'внешн'],
	['1С: Автономный сервер', 'автономн'],
	['1С: Пайплайны', 'пайплайн'],
	['1С: Хуки', 'хук'],
	['1С: Отладка', 'отладк'],
	['1С: Свойства', 'свойств'],
]);

/** Заголовки, которым повтор нужен, с причиной. */
const CATEGORY_IN_TITLE_ALLOWED = new Map<string, string>([
	// Кнопка стоит в заголовке панели инструментов: там подпись без объекта не читается
	['1c-platform-tools.todo.showPanel', 'кнопка в чужой панели'],
]);

suite('заголовок и категория', () => {
	test('заголовок не повторяет категорию', () => {
		const stuttering: string[] = [];
		for (const command of paletteCommands()) {
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
			`палитра показывает «категория: заголовок», объект назван дважды: ${stuttering.join('; ')}`
		);
	});

	test('словарь категорий не разъехался с манифестом', () => {
		const declared = new Set(contributes().commands.map((command) => command.category).filter(Boolean));
		const stale = [...CATEGORY_STEMS.keys()].filter((category) => !declared.has(category));
		assert.deepStrictEqual(stale, [], `категорий нет в манифесте: ${stale.join(', ')}`);
	});

	test('список разрешённых повторов не протух', () => {
		const byId = new Map(contributes().commands.map((command) => [command.command, command]));
		const stale: string[] = [];
		for (const id of CATEGORY_IN_TITLE_ALLOWED.keys()) {
			const command = byId.get(id);
			const stem = command?.category ? CATEGORY_STEMS.get(command.category) : undefined;
			if (!command || !stem || !command.title.toLowerCase().includes(stem)) {
				stale.push(id);
			}
		}
		assert.deepStrictEqual(stale, [], `повтор уже убран: ${stale.join(', ')}`);
	});
});

suite('идентификаторы команд', () => {
	test('действие называется в домене объекта, без параллельных групп', () => {
		// build.configuration и configuration.build раньше вызывали один
		// обработчик: одно действие не должно иметь двух идентификаторов
		const stray = contributes()
			.commands.map((command) => command.command)
			.filter((id) => id.startsWith('1c-platform-tools.build.') || id.startsWith('1c-platform-tools.decompile.'));
		assert.deepStrictEqual(stray, [], `параллельные группы команд: ${stray.join(', ')}`);
	});

	test('сборка и разбор объявлены в домене объекта', () => {
		const declared = new Set(contributes().commands.map((command) => command.command));
		for (const id of [
			'1c-platform-tools.cf.compile',
			'1c-platform-tools.cf.decompile',
			'1c-platform-tools.cfe.compile',
			'1c-platform-tools.cfe.decompile',
			'1c-platform-tools.epf.compileProcessor',
			'1c-platform-tools.epf.decompileProcessor',
			'1c-platform-tools.epf.compileReport',
			'1c-platform-tools.epf.decompileReport',
		]) {
			assert.ok(declared.has(id), `команда ${id} потерялась`);
		}
	});
});
