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
				// Опции --versions (инкрементальная выгрузка 2.x) в 3.x нет —
				// versionsFile игнорируется, выполняется полная выгрузка.
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
			case 'test.xunit':
				// Путь к тестам в 3.x — позиционный и обязателен на практике:
				// без него команда завершается ошибкой чтения параметров.
				return [cmd(['test', 'xunit'], common(intent), [intent.testsPath ?? DEFAULT_XUNIT_TESTS_PATH])];
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

			default:
				return assertNever(intent);
		}
	}
}
