/**
 * Трансляция аргументов команд vanessa-runner из синтаксиса 2.x в синтаксис 3.x.
 *
 * Команды расширения исторически строятся под CLI vrunner 2.x (плоские команды
 * `compile`, `xunit`, `init-dev`, …). vrunner 3.0 ввёл BREAKING CHANGES: команды
 * сгруппированы (`cf compile`, `test xunit`, `infobase init`, …), часть флагов
 * переименована, а главное — в 3.x **опции должны идти перед позиционными
 * аргументами**. Этот модуль переводит набор аргументов 2.x в эквивалент 3.x.
 *
 * Источник истины — официальная документация vanessa-runner 3.0 (docs/product)
 * и страницы миграции; сверено с живым rc8.
 *
 * Модуль чистый (без vscode/fs/path) и полностью покрыт юнит-тестами.
 */

/**
 * Опции v3, принимающие значение в следующем токене.
 * Сюда же входят v2-флаги, которые внутри обработчиков переименовываются или
 * превращаются в позиционные аргументы (`--src`, `--out`, `--in`, `--file`,
 * `--extension`).
 */
const VALUE_OPTS = new Set<string>([
	// Общие опции подключения/платформы (имена в 3.x не изменились)
	'--ibconnection', '--db-user', '--db-pwd', '--v8version', '--uccode',
	'--language', '--locale', '--settings',
	// run enterprise / designer
	'--command', '--execute', '--url', '--additional',
	// test xunit / vanessa
	'--reportsxunit', '--reportxunit', '--vanessasettings', '--workspace',
	'--feature-path', '--bddrunner-path', '--pathxunit', '--xddExitCodePath',
	'--exitCodePath', '--testclient', '--tags-filter', '--tags-ignore',
	'--additional-keys',
	// validate syntax-check
	'--junitpath', '--testsuitename', '--exception-file', '--mode',
	// infobase update
	'--target', '--rtype',
	// cf / cfe / epf
	'--extension-name', '--out', '--src', '-s', '--in', '--file', '--extension',
	'--cf-file', '--cfe-file', '--list',
]);

/** Извлекает последний сегмент пути (по `/` или `\`), без завершающих разделителей. */
function lastPathSegment(p: string): string {
	const trimmed = p.replace(/[\\/]+$/, '');
	const parts = trimmed.split(/[\\/]/);
	return parts[parts.length - 1] ?? trimmed;
}

interface OptionToken {
	name: string;
	value?: string;
}

/**
 * Разобранный набор аргументов команды: опции (с порядком) и позиционные.
 * Унифицирует доступ для пер-командных преобразований.
 */
class ArgBag {
	readonly options: OptionToken[] = [];
	readonly positionals: string[] = [];

	/**
	 * Разбирает «хвост» команды (без имени команды) на опции и позиционные.
	 * Токен из {@link VALUE_OPTS} забирает следующий токен как значение; прочие
	 * токены, начинающиеся с `-`, считаются булевыми флагами; остальное —
	 * позиционные аргументы (в исходном порядке).
	 */
	constructor(rest: string[]) {
		for (let i = 0; i < rest.length; i++) {
			const token = rest[i];
			if (VALUE_OPTS.has(token)) {
				const value = i + 1 < rest.length ? rest[++i] : undefined;
				this.options.push({ name: token, value });
			} else if (token.startsWith('-')) {
				this.options.push({ name: token });
			} else {
				this.positionals.push(token);
			}
		}
	}

	/** Забирает значение опции (удаляя её), либо undefined, если её нет. */
	take(name: string): string | undefined {
		const idx = this.options.findIndex((o) => o.name === name);
		if (idx === -1) {
			return undefined;
		}
		const [removed] = this.options.splice(idx, 1);
		return removed.value;
	}

	/** Забирает булев флаг (удаляя его). Возвращает true, если флаг присутствовал. */
	takeFlag(name: string): boolean {
		const idx = this.options.findIndex((o) => o.name === name);
		if (idx === -1) {
			return false;
		}
		this.options.splice(idx, 1);
		return true;
	}

	/** Добавляет опцию в конец списка опций. */
	add(name: string, value?: string): void {
		this.options.push({ name, value });
	}

	/** Разворачивает оставшиеся опции в плоский массив токенов. */
	emitOptions(): string[] {
		const out: string[] = [];
		for (const opt of this.options) {
			out.push(opt.name);
			if (opt.value !== undefined) {
				out.push(opt.value);
			}
		}
		return out;
	}
}

/** Собирает результат: группа команды + опции + позиционные (опции всегда первыми). */
function assemble(group: string[], bag: ArgBag, positionals: string[]): string[] {
	return [...group, ...bag.emitOptions(), ...positionals.filter((p) => p !== undefined)];
}

/** Группы команд 3.x: аргументы, начинающиеся с них, уже в синтаксисе 3.x. */
const V3_GROUPS = new Set(['cf', 'cfe', 'cluster', 'epf', 'infobase', 'repo', 'test', 'validate', 'help', 'mcp']);

/**
 * Транслирует аргументы команды vrunner из синтаксиса 2.x в 3.x.
 *
 * Если команда не распознана (уже в формате 3.x, `version`, opm-команды и т.п.),
 * аргументы возвращаются без изменений.
 *
 * @param args - Аргументы команды в синтаксисе 2.x (первый элемент — имя команды)
 * @returns Аргументы в синтаксисе 3.x
 */
export function translateArgsToV3(args: string[]): string[] {
	if (args.length === 0) {
		return args;
	}

	const command = args[0];

	// Идемпотентность: аргументы, уже записанные в синтаксисе 3.x, не трогаем.
	// `run` есть в обоих CLI — различаем по подкоманде 3.x.
	if (V3_GROUPS.has(command)) {
		return args;
	}
	if (command === 'run' && (args[1] === 'enterprise' || args[1] === 'designer')) {
		return args;
	}

	const bag = new ArgBag(args.slice(1));

	switch (command) {
		// ---- Конфигурация (cf) ----
		case 'compile': {
			// compile --src S --out O → cf compile --src S O
			const out = bag.take('--out');
			return assemble(['cf', 'compile'], bag, out ? [out] : []);
		}
		case 'decompile': {
			// decompile --in I --out O      → cf decompile --cf-file I O
			// decompile --current --out O   → cf decompile O (из ИБ через --ibconnection)
			bag.takeFlag('--current');
			const cfFile = bag.take('--in');
			const out = bag.take('--out');
			if (cfFile !== undefined) {
				bag.add('--cf-file', cfFile);
			}
			return assemble(['cf', 'decompile'], bag, out ? [out] : []);
		}
		case 'load': {
			// load --src CF → cf load CF
			const src = bag.take('--src') ?? bag.take('-s');
			return assemble(['cf', 'load'], bag, src ? [src] : []);
		}
		case 'unload': {
			// unload OUT → cf unload OUT
			const out = bag.positionals.shift();
			return assemble(['cf', 'unload'], bag, out ? [out] : []);
		}

		// ---- Расширения (cfe) ----
		case 'compileexttocfe': {
			// compileexttocfe --src S --out O → cfe compile --src S --extension-name <base(S)> O
			const out = bag.take('--out');
			const src = bag.take('--src') ?? bag.take('-s');
			if (src !== undefined) {
				bag.add('--src', src);
				bag.add('--extension-name', lastPathSegment(src));
			} else if (out !== undefined) {
				bag.add('--extension-name', lastPathSegment(out).replace(/\.cfe$/i, ''));
			}
			return assemble(['cfe', 'compile'], bag, out ? [out] : []);
		}
		case 'loadext': {
			// loadext --file F --extension N → cfe load --extension-name N F
			const file = bag.take('--file');
			const ext = bag.take('--extension');
			if (ext !== undefined) {
				bag.add('--extension-name', ext);
			}
			return assemble(['cfe', 'load'], bag, file ? [file] : []);
		}
		case 'compileext': {
			// compileext SRC NAME [--updatedb] → cfe load --extension-name NAME SRC
			// В 3.x cfe load обновляет БД по умолчанию, поэтому --updatedb просто
			// снимается, а его отсутствие даёт --no-update-db.
			const updatedb = bag.takeFlag('--updatedb');
			const src = bag.positionals.shift();
			const name = bag.positionals.shift();
			if (name !== undefined) {
				bag.add('--extension-name', name);
			}
			if (!updatedb) {
				bag.add('--no-update-db');
			}
			return assemble(['cfe', 'load'], bag, src ? [src] : []);
		}
		case 'decompileext': {
			// decompileext NAME OUT → cfe decompile --extension-name NAME OUT (из ИБ)
			const name = bag.positionals.shift();
			const out = bag.positionals.shift();
			if (name !== undefined) {
				bag.add('--extension-name', name);
			}
			return assemble(['cfe', 'decompile'], bag, out ? [out] : []);
		}
		case 'unloadext': {
			// unloadext CFE NAME → cfe unload --extension-name NAME CFE
			const cfe = bag.positionals.shift();
			const name = bag.positionals.shift();
			if (name !== undefined) {
				bag.add('--extension-name', name);
			}
			return assemble(['cfe', 'unload'], bag, cfe ? [cfe] : []);
		}
		case 'updateext': {
			// updateext NAME → infobase update --target NAME
			const name = bag.positionals.shift();
			if (name !== undefined) {
				bag.add('--target', name);
			}
			return assemble(['infobase', 'update'], bag, []);
		}

		// ---- Внешние обработки/отчёты (epf) ----
		case 'compileepf': {
			// compileepf SRC OUT → epf compile -R --out OUT SRC
			// В 2.x compileepf по каталогу рекурсивно собирал все обработки; в 3.x
			// рекурсию включает флаг -R (на одиночной обработке безвреден).
			const src = bag.positionals.shift();
			const out = bag.positionals.shift();
			if (out !== undefined) {
				bag.add('--out', out);
			}
			bag.add('-R');
			return assemble(['epf', 'compile'], bag, src ? [src] : []);
		}
		case 'decompileepf': {
			// decompileepf IN OUT → epf decompile -R --out OUT IN
			const input = bag.positionals.shift();
			const out = bag.positionals.shift();
			if (out !== undefined) {
				bag.add('--out', out);
			}
			bag.add('-R');
			return assemble(['epf', 'decompile'], bag, input ? [input] : []);
		}

		// ---- Информационная база (infobase) ----
		case 'init-dev':
			// init-dev [--src S] → infobase init [--src S] (--src — валидная опция 3.x)
			return assemble(['infobase', 'init'], bag, []);
		case 'updatedb':
			return assemble(['infobase', 'update'], bag, []);
		case 'update-dev': {
			// update-dev --src S [--git-increment] → infobase update --src S [--increment]
			if (bag.takeFlag('--git-increment')) {
				bag.add('--increment');
			}
			return assemble(['infobase', 'update'], bag, []);
		}
		case 'dump': {
			// dump DT → infobase dump-dt DT
			const dt = bag.positionals.shift();
			return assemble(['infobase', 'dump-dt'], bag, dt ? [dt] : []);
		}
		case 'restore': {
			// restore SRC → infobase restore-dt SRC
			const src = bag.positionals.shift();
			return assemble(['infobase', 'restore-dt'], bag, src ? [src] : []);
		}

		// ---- Запуск (run) ----
		case 'run':
			return assemble(['run', 'enterprise'], bag, bag.positionals.splice(0));
		case 'designer':
			return assemble(['run', 'designer'], bag, bag.positionals.splice(0));

		// ---- Тесты и проверка (test / validate) ----
		case 'xunit':
			// xunit [PATH] → test xunit [PATH] (PATH остаётся позиционным)
			return assemble(['test', 'xunit'], bag, bag.positionals.splice(0));
		case 'vanessa':
			return assemble(['test', 'vanessa'], bag, bag.positionals.splice(0));
		case 'syntax-check':
			return assemble(['validate', 'syntax-check'], bag, bag.positionals.splice(0));

		default:
			// Команда не из набора 2.x — возвращаем без изменений.
			return args;
	}
}
