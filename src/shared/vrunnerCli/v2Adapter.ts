/**
 * Адаптер CLI vanessa-runner 2.x.
 *
 * Воспроизводит проверенные годами формы аргументов, которые расширение
 * строило до появления интентов (плоские команды `compile`, `init-dev`,
 * `xunit`, …). Порядок аргументов сохранён: сквозные опции — в конце
 * (парсер 2.x к порядку нечувствителен).
 *
 * Флаг `--ibcmd` адаптер не добавляет: это настройка проекта и задаётся
 * пользователем в файле настроек vanessa-runner («--ibcmd» в env.json).
 */

import {
	VRunnerCliAdapter,
	VRunnerIntent,
	CommonArgs,
	assertNever,
} from './intents';

function common(intent: { common?: CommonArgs }): string[] {
	return [...(intent.common ?? [])];
}

/** Адаптер синтаксиса vanessa-runner 2.x. */
export class V2CliAdapter implements VRunnerCliAdapter {
	public plan(intent: VRunnerIntent): string[][] {
		switch (intent.kind) {
			// ---- Информационная база ----
			case 'infobase.init': {
				const args = ['init-dev'];
				if (intent.src !== undefined) {
					args.push('--src', intent.src);
				}
				return [[...args, ...common(intent)]];
			}
			case 'cf.loadFromSrc': {
				if (intent.listFile !== undefined) {
					// Выборочной загрузки у update-dev нет: список объектов принимает
					// только конфигуратор, а обновление БД идёт отдельной командой.
					const additional =
						`/LoadConfigFromFiles ${intent.src} -listFile ${intent.listFile}`;
					const plan = [['designer', '--additional', additional, ...common(intent)]];
					if (intent.updateDb) {
						plan.push(['updatedb', ...common(intent)]);
					}
					return plan;
				}
				if (!intent.updateDb) {
					// Инкремент сюда не доходит: планировщик снимает его для 2.x, потому что
					// список изменённых файлов собирает update-dev вместе с обновлением БД.
					// update-dev всегда завершается UpdateDBCfg, отключить это нечем:
					// загрузка без обновления остаётся только через конфигуратор.
					const additional = `/LoadConfigFromFiles ${intent.src} -updateConfigDumpInfo`;
					return [['designer', '--additional', additional, ...common(intent)]];
				}
				const args = ['update-dev', '--src', intent.src];
				if (intent.increment) {
					args.push('--git-increment');
				}
				return [[...args, ...common(intent)]];
			}
			case 'infobase.updateDb':
				return [['updatedb', ...common(intent)]];
			case 'infobase.updateExtension':
				return [['updateext', intent.extensionName, ...common(intent)]];
			case 'infobase.dumpDt':
				return [['dump', intent.out, ...common(intent)]];
			case 'infobase.restoreDt':
				return [['restore', intent.file, ...common(intent)]];
			case 'infobase.listExtensions': {
				if (intent.out === undefined) {
					throw new Error('infobase.listExtensions: не задан каталог выгрузки');
				}
				return [[
					'designer',
					'--additional',
					`/DumpConfigToFiles ${intent.out} -AllExtensions`,
					...common(intent)
				]];
			}

			// ---- Конфигурация ----
			case 'cf.build':
				return [['compile', '--src', intent.src, '--out', intent.out, ...common(intent)]];
			case 'cf.decompileFile':
				return [['decompile', '--in', intent.file, '--out', intent.out, ...common(intent)]];
			case 'cf.dumpIbToSrc':
				return [['decompile', '--current', '--out', intent.out, ...common(intent)]];
			case 'cf.unloadIbToCf':
				return [['unload', intent.out, ...common(intent)]];
			case 'cf.makeDist':
				return [['make-dist', intent.out, ...common(intent)]];
			case 'cf.loadFileToIb': {
				// load переносит конфигурацию в основную, но БД не трогает.
				const plan = [['load', '--src', intent.file, ...common(intent)]];
				if (intent.updateDb) {
					plan.push(['updatedb', ...common(intent)]);
				}
				return plan;
			}

			// ---- Расширения ----
			case 'cfe.buildCfe':
				return [['compileexttocfe', '--src', intent.src, '--out', intent.out, ...common(intent)]];
			case 'cfe.loadFromSrc': {
				const args = ['compileext', intent.src, intent.extensionName];
				if (intent.updateDb) {
					args.push('--updatedb');
				}
				return [[...args, ...common(intent)]];
			}
			case 'cfe.loadFromCfeFile':
				return [['loadext', '--file', intent.file, '--extension', intent.extensionName, ...common(intent)]];
			case 'cfe.dumpIbToSrc':
				return [['decompileext', intent.extensionName, intent.out, ...common(intent)]];
			case 'cfe.unloadIbToCfe':
				return [['unloadext', intent.out, intent.extensionName, ...common(intent)]];
			case 'cfe.decompileCfeFile':
				// 2.x не умеет разбирать .cfe напрямую: сначала загрузка в ИБ,
				// затем выгрузка исходников из неё.
				return [
					['loadext', '--file', intent.file, '--extension', intent.extensionName, ...common(intent)],
					['decompileext', intent.extensionName, intent.out, ...common(intent)],
				];

			// ---- Внешние обработки ----
			case 'epf.build':
				return [['compileepf', intent.src, intent.out, ...common(intent)]];
			case 'epf.decompile':
				return [['decompileepf', intent.input, intent.out, ...common(intent)]];

			// ---- Запуск ----
			case 'run.enterprise': {
				const args = ['run'];
				if (intent.command !== undefined) {
					args.push('--command', intent.command);
				}
				if (intent.execute !== undefined) {
					args.push('--execute', intent.execute);
				}
				if (intent.noWait) {
					args.push('--no-wait');
				}
				return [[...args, ...common(intent)]];
			}
			case 'run.designer': {
				const args = ['designer'];
				if (intent.additional !== undefined) {
					args.push('--additional', intent.additional);
				}
				if (intent.noWait) {
					args.push('--no-wait');
				}
				return [[...args, ...common(intent)]];
			}

			// ---- Тесты и проверка ----
			case 'test.xunit': {
				const args = ['xunit'];
				if (intent.testsPath !== undefined) {
					args.push(intent.testsPath);
				}
				if (intent.reportsXunit !== undefined) {
					args.push('--reportsxunit', intent.reportsXunit);
				}
				return [[...args, ...common(intent)]];
			}
			case 'test.vanessa': {
				const args = ['vanessa'];
				if (intent.vanessaSettings !== undefined) {
					args.push('--vanessasettings', intent.vanessaSettings);
				}
				if (intent.featurePath !== undefined) {
					args.push('--path', intent.featurePath);
				}
				return [[...args, ...common(intent)]];
			}
			case 'test.yaxunit': {
				// В 2.x YAxUnit запускается предприятием с готовым конфигом:
				// фильтр и отчёт задаются в нём
				if (intent.configPath === undefined || intent.filter !== undefined || intent.report !== undefined) {
					throw new Error(
						'vanessa-runner 2.x запускает YAxUnit только с готовым конфигом: ' +
						'фильтр и путь отчёта задаются в нём.'
					);
				}
				const args = ['run', '--command', `RunUnitTests=${intent.configPath}`];
				if (intent.ordinaryApp !== undefined) {
					args.push('--ordinaryapp', intent.ordinaryApp);
				}
				if (intent.exitCodePath !== undefined) {
					args.push('--exitCodePath', intent.exitCodePath);
				}
				if (intent.additional !== undefined) {
					args.push('--additional', intent.additional);
				}
				if (intent.noWait) {
					args.push('--no-wait');
				}
				return [[...args, ...common(intent)]];
			}
			case 'validate.syntaxCheck':
				return [['syntax-check', ...common(intent)]];

			// ---- Сеансы информационной базы ----
			case 'session.lock': {
				const args = ['session', 'lock'];
				if (intent.accessCode) {
					args.push('--uccode', intent.accessCode);
				}
				if (intent.deniedMessage) {
					args.push('--lockmessage', intent.deniedMessage);
				}
				if (intent.lockStart) {
					args.push('--lockstart', intent.lockStart);
				}
				if (intent.lockEnd) {
					args.push('--lockend', intent.lockEnd);
				}
				return [[...args, ...common(intent)]];
			}
			case 'session.unlock': {
				const args = ['session', 'unlock'];
				if (intent.accessCode) {
					args.push('--uccode', intent.accessCode);
				}
				return [[...args, ...common(intent)]];
			}
			case 'session.kill': {
				const args = ['session', 'kill'];
				if (intent.filter) {
					args.push('--filter', intent.filter);
				}
				if (intent.filterMode) {
					args.push('--mode', intent.filterMode);
				}
				if (intent.withoutLock) {
					// по умолчанию kill заодно запрещает начало сеансов
					args.push('--with-nolock');
				}
				return [[...args, ...common(intent)]];
			}
			case 'session.closed': {
				const args = ['session', 'closed'];
				if (intent.filter) {
					args.push('--filter', intent.filter);
				}
				if (intent.filterMode) {
					args.push('--mode', intent.filterMode);
				}
				return [[...args, ...common(intent)]];
			}

			case 'session.list':
				// Список сеансов появился в 3.x; в 2.x подкоманды нет
				throw new Error(
					'vanessa-runner 2.x не умеет показывать список сеансов: ' +
					'действие cluster session list появилось в 3.x.'
				);

			case 'validate.edt': {
				const args = ['edt-validate'];
				if (intent.junitPath !== undefined) {
					args.push('--junitpath', intent.junitPath);
				}
				return [[...args, ...common(intent)]];
			}

			case 'cf.convert':
			case 'cfe.convert':
				// Конвертация исходников между форматами появилась в 3.0.0-rc8
				throw new Error(
					'vanessa-runner 2.x не умеет конвертировать исходники между форматами EDT ' +
					'и конфигуратора: команда появилась в 3.x.'
				);

			// ---- Регламентные задания ----
			case 'jobs.lock':
				return [['scheduledjobs', 'lock', ...common(intent)]];
			case 'jobs.unlock':
				return [['scheduledjobs', 'unlock', ...common(intent)]];

			default:
				return assertNever(intent);
		}
	}
}
