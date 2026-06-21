/**
 * Трансляция команд vanessa-runner 2.x → 3.x.
 *
 * vrunner 3.0 перешёл на иерархические команды (BREAKING CHANGES), у части команд
 * изменил аргументы (позиционные ↔ флаги, переименования) и ТРЕБУЕТ, чтобы все
 * опции шли ДО позиционных аргументов (в 2.x порядок был свободным). Расширение
 * строит команды в форме 2.x, а перед запуском при vrunner ≥ 3.0 заменяет их на
 * эквивалент 3.x. Для 2.x (LTS) команды не меняются.
 *
 * Для каждой команды — свой трансформер; на выходе опции всегда переставляются
 * перед позиционными аргументами. Соответствие и порядок проверены на vrunner 3
 * (rc7): справка подкоманд, официальные доки миграции и живые прогоны на ssl_3_1.
 *
 * Покрыто: запуск/тесты/проверки, infobase (init/update/dump-dt/restore-dt),
 * cf (compile/decompile/load/unload), epf (compile/decompile), repo load,
 * cfe (compileext→load, loadext→load, compileexttocfe→compile, unloadext→unload,
 * updateext→infobase update --target).
 * НЕ покрыто: cfe decompileext (из ИБ → в 3.x нужен .cfe; смена потока 1→2,
 * делается в командных классах).
 */

/** Булевы флаги (без значения) — чтобы при перестановке не «съесть» позиционный аргумент. */
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
	'--ibcmd', '--no-wait', '--current', '--increment', '--update-db', '--updatedb',
	'--recursive', '-R', '--overwrite', '--safe-mode',
]);

/** Трансформер: получает аргументы после команды (rest), возвращает полную команду 3.x. */
type ArgTransform = (rest: string[]) => string[];

/**
 * Переставляет все опции перед позиционными аргументами (требование vrunner 3).
 *
 * Флаг из {@link BOOLEAN_FLAGS} не имеет значения; прочий флаг забирает следующий
 * токен как своё значение. Позиционные (без ведущего `-`) уходят в конец.
 *
 * @param args - Аргументы после командных токенов
 * @returns Аргументы в порядке «опции, затем позиционные»
 */
function optionsFirst(args: string[]): string[] {
	const options: string[] = [];
	const positionals: string[] = [];
	let i = 0;
	while (i < args.length) {
		const a = args[i];
		if (a.startsWith('-')) {
			options.push(a);
			if (!BOOLEAN_FLAGS.has(a) && i + 1 < args.length) {
				options.push(args[i + 1]);
				i += 2;
			} else {
				i += 1;
			}
		} else {
			positionals.push(a);
			i += 1;
		}
	}
	return [...options, ...positionals];
}

/**
 * Собирает команду 3.x: командные токены + (опции перед позиционными).
 */
function cmd(tokens: string[], rest: string[]): string[] {
	return [...tokens, ...optionsFirst(rest)];
}

/**
 * Извлекает значение флага `--name <value>` из аргументов.
 *
 * @returns Значение (или undefined) и аргументы без этой пары
 */
function extractFlag(args: string[], flag: string): { value: string | undefined; rest: string[] } {
	const index = args.indexOf(flag);
	if (index < 0 || index + 1 >= args.length) {
		return { value: undefined, rest: args };
	}
	return { value: args[index + 1], rest: [...args.slice(0, index), ...args.slice(index + 2)] };
}

/** Простой трансформер: префикс из токенов 3.x; опции переставляются перед позиционными. */
function prefix(...tokens: string[]): ArgTransform {
	return (rest) => cmd(tokens, rest);
}

/** cf compile: `compile --src S --out O` → `cf compile --src S O` (O — позиционный OUT). */
function cfCompile(rest: string[]): string[] {
	const { value: out, rest: tail } = extractFlag(rest, '--out');
	return cmd(['cf', 'compile'], out ? [...tail, out] : tail);
}

/**
 * cf decompile:
 *   `decompile --in CF --out OUT`     → `cf decompile --cf-file CF OUT`
 *   `decompile --current --out OUT …` → `cf decompile … OUT` (из ИБ)
 */
function cfDecompile(rest: string[]): string[] {
	const out = extractFlag(rest, '--out');
	const cf = extractFlag(out.rest, '--in');
	const tail = cf.rest.filter((a) => a !== '--current');
	const parts = [...tail];
	if (cf.value) {
		parts.push('--cf-file', cf.value);
	}
	if (out.value) {
		parts.push(out.value);
	}
	return cmd(['cf', 'decompile'], parts);
}

/** cf load: `load --src S …` → `cf load … S` (S — позиционный SRC). */
function cfLoad(rest: string[]): string[] {
	const { value: src, rest: tail } = extractFlag(rest, '--src');
	return cmd(['cf', 'load'], src ? [...tail, src] : tail);
}

/**
 * epf compile/decompile: 2-й позиционный (каталог вывода) → `--out`.
 *
 *   `compileepf SRC OUT …`   → `epf compile --out OUT … SRC`
 *   `decompileepf SRC OUT …` → `epf decompile --out OUT … SRC`
 */
function epfPositionalOut(sub: string): ArgTransform {
	return (rest) => {
		if (rest.length >= 2 && !rest[0].startsWith('-') && !rest[1].startsWith('-')) {
			return cmd(['epf', sub], ['--out', rest[1], ...rest.slice(2), rest[0]]);
		}
		return cmd(['epf', sub], rest);
	};
}

/**
 * compileext `<src> <name> --updatedb …` → `cfe load … --extension-name name --update-db --overwrite … src`.
 *
 * 2.x compileext компилировал исходники И загружал расширение в ИБ (+ обновление
 * БД), поэтому это `cfe load`, а не `cfe compile` (та лишь делает .cfe). Добавляем
 * `--overwrite` — 2.x перезагружал уже установленное расширение.
 */
function compileextToCfeLoad(rest: string[]): string[] {
	if (rest.length < 2 || rest[0].startsWith('-') || rest[1].startsWith('-')) {
		return cmd(['cfe', 'load'], rest);
	}
	const src = rest[0];
	const name = rest[1];
	const tail = rest.slice(2).map((a) => (a === '--updatedb' ? '--update-db' : a));
	return cmd(['cfe', 'load'], ['--extension-name', name, '--overwrite', ...tail, src]);
}

/** loadext `--file CFE --extension NAME …` → `cfe load --extension-name NAME --overwrite … CFE`. */
function loadextToCfeLoad(rest: string[]): string[] {
	const file = extractFlag(rest, '--file');
	const ext = extractFlag(file.rest, '--extension');
	const parts = ['--overwrite', ...ext.rest];
	if (ext.value) {
		parts.push('--extension-name', ext.value);
	}
	if (file.value) {
		parts.push(file.value);
	}
	return cmd(['cfe', 'load'], parts);
}

/** Имя файла из пути (последний сегмент после / или \). */
function baseName(p: string): string {
	const segments = p.split(/[\\/]/);
	return segments[segments.length - 1] || p;
}

/**
 * compileexttocfe `--src S --out O.cfe` → `cfe compile --extension-name <имя> --src S O.cfe`.
 *
 * `cfe compile` требует `--extension-name`; имя берём из имени файла OUT без .cfe.
 */
function compileexttocfeToCfeCompile(rest: string[]): string[] {
	const { value: out, rest: tail } = extractFlag(rest, '--out');
	if (!out) {
		return cmd(['cfe', 'compile'], tail);
	}
	const name = baseName(out).replace(/\.cfe$/i, '');
	return cmd(['cfe', 'compile'], ['--extension-name', name, ...tail, out]);
}

/** unloadext `<cfe> <name> …` → `cfe unload --extension-name name … cfe` (cfe — позиционный OUT). */
function unloadextToCfeUnload(rest: string[]): string[] {
	if (rest.length < 2 || rest[0].startsWith('-') || rest[1].startsWith('-')) {
		return cmd(['cfe', 'unload'], rest);
	}
	const out = rest[0];
	const name = rest[1];
	return cmd(['cfe', 'unload'], ['--extension-name', name, ...rest.slice(2), out]);
}

/** updateext `<name> …` → `infobase update --target name …` (обновление расширения в ИБ). */
function updateextToInfobaseUpdate(rest: string[]): string[] {
	if (rest.length < 1 || rest[0].startsWith('-')) {
		return cmd(['infobase', 'update'], rest);
	}
	return cmd(['infobase', 'update'], ['--target', rest[0], ...rest.slice(1)]);
}

/** Трансформеры команд 2.x → 3.x. */
const TRANSFORMS: Readonly<Record<string, ArgTransform>> = {
	// Запуск 1С:Предприятия / Конфигуратора
	run: prefix('run', 'enterprise'),
	designer: prefix('run', 'designer'),
	// Тестирование и проверки
	xunit: prefix('test', 'xunit'),
	vanessa: prefix('test', 'vanessa'),
	'syntax-check': prefix('validate', 'syntax-check'),
	// Информационная база
	'init-dev': prefix('infobase', 'init'),
	'update-dev': prefix('infobase', 'update'),
	updatedb: prefix('infobase', 'update'),
	dump: prefix('infobase', 'dump-dt'),
	restore: prefix('infobase', 'restore-dt'),
	// Конфигурация (cf)
	compile: cfCompile,
	compileconf: cfCompile,
	decompile: cfDecompile,
	decompileconf: cfDecompile,
	load: cfLoad,
	unload: prefix('cf', 'unload'),
	// Внешние обработки/отчёты (epf)
	compileepf: epfPositionalOut('compile'),
	decompileepf: epfPositionalOut('decompile'),
	// Расширения конфигурации (cfe)
	compileext: compileextToCfeLoad,
	loadext: loadextToCfeLoad,
	compileexttocfe: compileexttocfeToCfeCompile,
	unloadext: unloadextToCfeUnload,
	updateext: updateextToInfobaseUpdate,
	// decompileext: из ИБ → в 3.x требуется .cfe (cfe decompile --cfe-file),
	// это смена потока (1→2 команды) — делается в командных классах, не здесь.
	// Хранилище конфигурации
	loadrepo: prefix('repo', 'load'),
};

/**
 * Команды 2.x, удалённые в 3.x (без прямого эквивалента).
 */
export const REMOVED_IN_3X: ReadonlySet<string> = new Set(['init-project']);

/**
 * Есть ли для команды 2.x трансляция в 3.x.
 *
 * Позволяет не определять версию vrunner, если транслировать нечего
 * (в т.ч. для `version` — это исключает рекурсию при определении версии).
 *
 * @param command - Командный токен (первый аргумент)
 * @returns true, если команда транслируется в форму 3.x
 */
export function hasVRunner3Mapping(command: string): boolean {
	return Object.prototype.hasOwnProperty.call(TRANSFORMS, command);
}

/**
 * Транслирует команду vanessa-runner из формы 2.x в форму 3.x.
 *
 * Заменяет команду, при необходимости реструктурирует аргументы и переставляет
 * опции перед позиционными. Неизвестные/неизменяемые команды (например `version`)
 * возвращаются без изменений.
 *
 * @param args - Аргументы команды в форме 2.x (первый элемент — команда)
 * @returns Аргументы в форме 3.x
 */
export function translateVRunnerCommandTo3x(args: readonly string[]): string[] {
	if (args.length === 0) {
		return [...args];
	}
	const transform = TRANSFORMS[args[0]];
	if (!transform) {
		return [...args];
	}
	return transform([...args.slice(1)]);
}
