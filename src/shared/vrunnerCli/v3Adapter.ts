/**
 * Адаптер CLI vanessa-runner 3.x.
 *
 * Строит команды по правилам 3.0 (BREAKING CHANGES относительно 2.x):
 * - команды сгруппированы: `cf compile`, `test xunit`, `infobase init`, …;
 * - все опции идут СТРОГО ПЕРЕД позиционными аргументами;
 * - часть флагов переименована (`--updatedb` → `--update-db`).
 *
 * Использует нативные возможности 3.x там, где они лучше двухшаговых
 * потоков 2.x: разборка .cfe-файла выполняется одной командой
 * `cfe decompile --cfe-file` во временной ИБ, не затрагивая рабочую базу.
 *
 * Флаг `--ibcmd` адаптер не добавляет: это настройка проекта и задаётся
 * пользователем в файле настроек vanessa-runner (vrunner.ibcmd в
 * autumn-properties.json).
 *
 * Источник истины — документация vanessa-runner 3.0 (docs/product/команды),
 * сверено живыми прогонами на rc8.
 */

import {
	VRunnerCliAdapter,
	VRunnerIntent,
	CommonArgs,
	assertNever,
	lastPathSegment,
} from './intents';

/** Путь встроенных дымовых тестов vanessa-add (макрос раскрывает vrunner). */
const DEFAULT_XUNIT_TESTS_PATH = '$addRoot/tests/smoke';

function common(intent: { common?: CommonArgs }): string[] {
	return [...(intent.common ?? [])];
}

/** Собирает команду: группа + опции + позиционные (опции всегда первыми). */
/**
 * Переводит отбор сеансов из записи 2.x в опции 3.x.
 *
 * В 2.x отбор задавался одной строкой `appid=Designer|name=Иванов`, в 3.x
 * ключи стали отдельными опциями: `--filter-app` и `--filter-name`, значения
 * внутри каждой перечисляются через `;`, условия объединяются по ИЛИ.
 * Режим `EXCEPT` заменён флагом `--filter-except`.
 *
 * @param filter - Строка отбора в записи 2.x
 * @param mode - Режим отбора 2.x (`EXCEPT`, `ONLY`, `OFF`)
 * @returns Опции 3.x
 */
function sessionFilterOptions(filter?: string, mode?: string): string[] {
	const normalizedMode = mode?.trim().toUpperCase();
	if (normalizedMode === 'OFF') {
		return [];
	}
	if (normalizedMode !== undefined && !['EXCEPT', 'ONLY'].includes(normalizedMode)) {
		throw new Error(
			`Режим отбора сеансов ${mode} в vanessa-runner 3.x не поддерживается: ` +
			'есть только EXCEPT (все сеансы, кроме подходящих) и ONLY (поведение по умолчанию).'
		);
	}

	const options: string[] = [];
	for (const part of (filter ?? '').split('|')) {
		const condition = part.trim();
		if (condition === '') {
			continue;
		}
		const separator = condition.indexOf('=');
		const key = separator < 0 ? '' : condition.slice(0, separator).trim().toLowerCase();
		const value = separator < 0 ? '' : condition.slice(separator + 1).trim();
		if (value === '') {
			continue;
		}
		if (key === 'appid') {
			options.push('--filter-app', value);
		} else if (key === 'name') {
			options.push('--filter-name', value);
		} else {
			throw new Error(
				`Отбор сеансов «${condition}» не разобран: в записи отбора допустимы ` +
				'appid=<приложения> и name=<пользователи>, значения через точку с запятой.'
			);
		}
	}

	if (normalizedMode === 'EXCEPT') {
		// Инверсию без условий отбора отвергает сам vanessa-runner, и текст у него
		// понятнее нашего: он называет опции, которых не хватает
		options.push('--filter-except');
	}
	return options;
}

function cmd(group: string[], options: string[], positionals: string[]): string[] {
	return [...group, ...options, ...positionals];
}

/** Адаптер синтаксиса vanessa-runner 3.x. */
export class V3CliAdapter implements VRunnerCliAdapter {
	public plan(intent: VRunnerIntent): string[][] {
		switch (intent.kind) {
			// ---- Информационная база ----
			case 'infobase.init': {
				const options = intent.src !== undefined ? ['--src', intent.src] : [];
				return [cmd(['infobase', 'init'], [...options, ...common(intent)], [])];
			}
			case 'infobase.updateFromSrc': {
				const options = ['--src', intent.src];
				if (intent.gitIncrement) {
					// Инкремент по индексу изменений (в 2.x — --git-increment)
					options.push('--increment');
				}
				return [cmd(['infobase', 'update'], [...options, ...common(intent)], [])];
			}
			case 'infobase.updateDb':
				return [cmd(['infobase', 'update'], common(intent), [])];
			case 'infobase.updateExtension':
				return [cmd(['infobase', 'update'], ['--target', intent.extensionName, ...common(intent)], [])];
			case 'infobase.dumpDt':
				return [cmd(['infobase', 'dump-dt'], common(intent), [intent.out])];
			case 'infobase.restoreDt':
				return [cmd(['infobase', 'restore-dt'], common(intent), [intent.file])];

			// ---- Конфигурация ----
			case 'cf.build':
				return [cmd(['cf', 'compile'], ['--src', intent.src, ...common(intent)], [intent.out])];
			case 'cf.decompileFile':
				return [cmd(['cf', 'decompile'], ['--cf-file', intent.file, ...common(intent)], [intent.out])];
			case 'cf.dumpIbToSrc':
				// Без --cf-file исходники выгружаются из ИБ, указанной в --ibconnection.
				return [cmd(['cf', 'decompile'], common(intent), [intent.out])];
			case 'cf.unloadIbToCf':
				return [cmd(['cf', 'unload'], common(intent), [intent.out])];
			case 'cf.makeDist':
				// cf make-dist OUT — путь к файлу поставки конфигурации (.cf) позиционно.
				return [cmd(['cf', 'make-dist'], common(intent), [intent.out])];
			case 'cf.loadFileToIb':
				// cf load обновляет БД по умолчанию; отдельный флаг не передаём.
				return [cmd(['cf', 'load'], common(intent), [intent.file])];

			// ---- Расширения ----
			case 'cfe.buildCfe': {
				// cfe compile требует --extension-name; при отсутствии имени из
				// метаданных используется имя каталога исходников
				const name = intent.extensionName ?? lastPathSegment(intent.src);
				const options = ['--src', intent.src, '--extension-name', name];
				return [cmd(['cfe', 'compile'], [...options, ...common(intent)], [intent.out])];
			}
			case 'cfe.loadFromSrc': {
				const options = ['--extension-name', intent.extensionName];
				// В 3.x обновление БД после загрузки расширения — поведение по
				// умолчанию; отключается флагом --no-update-db. (У cf load обратная
				// логика — там обновление opt-in через --update-db.)
				if (!intent.updateDb) {
					options.push('--no-update-db');
				}
				return [cmd(['cfe', 'load'], [...options, ...common(intent)], [intent.src])];
			}
			case 'cfe.loadFromCfeFile':
				return [cmd(['cfe', 'load'], ['--extension-name', intent.extensionName, ...common(intent)], [intent.file])];
			case 'cfe.dumpIbToSrc':
				return [cmd(['cfe', 'decompile'], ['--extension-name', intent.extensionName, ...common(intent)], [intent.out])];
			case 'cfe.unloadIbToCfe':
				return [cmd(['cfe', 'unload'], ['--extension-name', intent.extensionName, ...common(intent)], [intent.out])];
			case 'cfe.decompileCfeFile': {
				// Нативный поток 3.x: одна команда во ВРЕМЕННОЙ ИБ. Сквозные опции
				// намеренно не передаются: с --ibconnection файл грузился бы в
				// рабочую базу (поведение 2.x), а без него используется временная.
				const options = ['--cfe-file', intent.file, '--extension-name', intent.extensionName];
				return [cmd(['cfe', 'decompile'], options, [intent.out])];
			}

			// ---- Внешние обработки ----
			case 'epf.build':
				// -R: в 2.x compileepf обходил каталог рекурсивно, в 3.x нужен флаг
				return [cmd(['epf', 'compile'], ['--out', intent.out, '-R', ...common(intent)], [intent.src])];
			case 'epf.decompile':
				return [cmd(['epf', 'decompile'], ['--out', intent.out, '-R', ...common(intent)], [intent.input])];

			// ---- Запуск ----
			case 'run.enterprise': {
				const options: string[] = [];
				if (intent.command !== undefined) {
					options.push('--command', intent.command);
				}
				if (intent.execute !== undefined) {
					options.push('--execute', intent.execute);
				}
				if (intent.noWait) {
					options.push('--no-wait');
				}
				return [cmd(['run', 'enterprise'], [...options, ...common(intent)], [])];
			}
			case 'run.designer': {
				const options: string[] = [];
				if (intent.additional !== undefined) {
					options.push('--additional', intent.additional);
				}
				if (intent.noWait) {
					options.push('--no-wait');
				}
				return [cmd(['run', 'designer'], [...options, ...common(intent)], [])];
			}

			// ---- Тесты и проверка ----
			case 'test.xunit': {
				// Путь к тестам в 3.x — позиционный и обязателен на практике:
				// без него команда завершается ошибкой чтения параметров.
				// Опции обязаны стоять до позиционного аргумента.
				const options: string[] = [];
				if (intent.reportsXunit !== undefined) {
					options.push('--reportsxunit', intent.reportsXunit);
				}
				return [cmd(['test', 'xunit'], [...options, ...common(intent)], [intent.testsPath ?? DEFAULT_XUNIT_TESTS_PATH])];
			}
			case 'test.vanessa': {
				const options: string[] = [];
				if (intent.vanessaSettings !== undefined) {
					options.push('--vanessasettings', intent.vanessaSettings);
				}
				if (intent.featurePath !== undefined) {
					options.push('--feature-path', intent.featurePath);
				}
				return [cmd(['test', 'vanessa'], [...options, ...common(intent)], [])];
			}
			case 'validate.syntaxCheck':
				return [cmd(['validate', 'syntax-check'], common(intent), [])];

			// ---- Сеансы информационной базы ----
			// В 3.0 команда вошла в группу cluster; время начала и окончания
			// блокировки не поддерживается: блокировка применяется сразу
			case 'session.lock': {
				const options: string[] = [];
				if (intent.accessCode) {
					options.push('--uccode', intent.accessCode);
				}
				if (intent.deniedMessage) {
					options.push('--denied-message', intent.deniedMessage);
				}
				return [cmd(['cluster', 'session', 'lock'], [...options, ...common(intent)], [])];
			}
			case 'session.unlock': {
				const options: string[] = [];
				if (intent.accessCode) {
					options.push('--uccode', intent.accessCode);
				}
				return [cmd(['cluster', 'session', 'unlock'], [...options, ...common(intent)], [])];
			}
			case 'session.kill': {
				const options: string[] = [...sessionFilterOptions(intent.filter, intent.filterMode)];
				if (intent.withoutLock) {
					options.push('--no-lock');
				}
				if (intent.timeoutSeconds !== undefined) {
					options.push('--timeout', String(intent.timeoutSeconds));
				} else if (intent.retry !== undefined) {
					// --retry игнорируется при заданном --timeout, поэтому передаём только один
					options.push('--retry', String(intent.retry));
				}
				return [cmd(['cluster', 'session', 'kill'], [...options, ...common(intent)], [])];
			}
			case 'session.closed': {
				const options: string[] = [...sessionFilterOptions(intent.filter, intent.filterMode)];
				if (intent.timeoutSeconds !== undefined) {
					options.push('--timeout', String(intent.timeoutSeconds));
				}
				return [cmd(['cluster', 'session', 'closed'], [...options, ...common(intent)], [])];
			}
			case 'session.list': {
				const options: string[] = [...sessionFilterOptions(intent.filter, intent.filterMode)];
				if (intent.connections) {
					options.push('--connections');
				}
				return [cmd(['cluster', 'session', 'list'], [...options, ...common(intent)], [])];
			}

			// ---- Регламентные задания ----
			// В 3.0 команда 2.x scheduledjobs вошла в группу cluster
			case 'jobs.lock':
				return [cmd(['cluster', 'jobs', 'lock'], [...common(intent)], [])];
			case 'jobs.unlock':
				return [cmd(['cluster', 'jobs', 'unlock'], [...common(intent)], [])];

			default:
				return assertNever(intent);
		}
	}
}
