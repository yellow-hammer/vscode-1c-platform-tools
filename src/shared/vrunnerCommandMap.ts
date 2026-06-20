/**
 * Трансляция команд vanessa-runner 2.x → 3.x.
 *
 * vrunner 3.0 перешёл на иерархические команды (BREAKING CHANGES): `vanessa` →
 * `test vanessa`, `run` → `run enterprise` и т.д. (issue #118, руководство по
 * миграции). Расширение строит команды в форме 2.x, а перед запуском при
 * vrunner ≥ 3.0 заменяет ведущий командный токен на иерархический эквивалент.
 * Для 2.x (LTS) команды не меняются.
 *
 * ВАЖНО: транслируется только командный токен; флаги после него передаются как
 * есть. Совместимость флагов отдельных команд (cf/cfe/epf/infobase) с 3.x должна
 * быть проверена на установленном vrunner 3 — см. issue #118.
 */

/**
 * Карта замен: команда 2.x → последовательность токенов 3.x.
 *
 * Источник: руководство по миграции и состав CLI vrunner 3 (cf/cfe/cluster/epf/
 * infobase/repo/run/test/validate).
 */
const COMMAND_MAP_3X: Readonly<Record<string, readonly string[]>> = {
	// Запуск 1С:Предприятия / Конфигуратора
	run: ['run', 'enterprise'],
	designer: ['run', 'designer'],
	// Тестирование и проверки
	xunit: ['test', 'xunit'],
	vanessa: ['test', 'vanessa'],
	'syntax-check': ['validate', 'syntax-check'],
	// Информационная база
	'init-dev': ['infobase', 'init'],
	'update-dev': ['infobase', 'update'],
	updatedb: ['infobase', 'update'],
	dump: ['infobase', 'dump-dt'],
	restore: ['infobase', 'restore-dt'],
	// Конфигурация (cf)
	compile: ['cf', 'compile'],
	compileconf: ['cf', 'compile'],
	decompile: ['cf', 'decompile'],
	decompileconf: ['cf', 'decompile'],
	load: ['cf', 'load'],
	unload: ['cf', 'unload'],
	// Расширения (cfe)
	compileext: ['cfe', 'compile'],
	decompileext: ['cfe', 'decompile'],
	loadext: ['cfe', 'load'],
	unloadext: ['cfe', 'unload'],
	compileexttocfe: ['cfe', 'compile'],
	updateext: ['cfe', 'load'],
	// Внешние обработки/отчёты (epf)
	compileepf: ['epf', 'compile'],
	decompileepf: ['epf', 'decompile'],
	// Хранилище конфигурации
	loadrepo: ['repo', 'load'],
};

/**
 * Команды 2.x, удалённые в 3.x (без прямого эквивалента).
 */
export const REMOVED_IN_3X: ReadonlySet<string> = new Set(['init-project']);

/**
 * Есть ли для команды 2.x замена в 3.x.
 *
 * Позволяет не определять версию vrunner, если транслировать нечего
 * (в т.ч. для `version` — это исключает рекурсию при определении версии).
 *
 * @param command - Командный токен (первый аргумент)
 * @returns true, если команда транслируется в форму 3.x
 */
export function hasVRunner3Mapping(command: string): boolean {
	return Object.prototype.hasOwnProperty.call(COMMAND_MAP_3X, command);
}

/**
 * Транслирует команду vanessa-runner из формы 2.x в форму 3.x.
 *
 * Заменяет ведущий командный токен на иерархический эквивалент; флаги и прочие
 * аргументы сохраняются. Неизвестные/неизменённые команды (например `version`)
 * возвращаются без изменений.
 *
 * @param args - Аргументы команды в форме 2.x (первый элемент — команда)
 * @returns Аргументы в форме 3.x
 */
export function translateVRunnerCommandTo3x(args: readonly string[]): string[] {
	if (args.length === 0) {
		return [...args];
	}
	const replacement = COMMAND_MAP_3X[args[0]];
	if (!replacement) {
		return [...args];
	}
	return [...replacement, ...args.slice(1)];
}
