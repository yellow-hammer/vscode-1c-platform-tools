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
			case 'infobase.updateFromSrc': {
				const args = ['update-dev', '--src', intent.src];
				if (intent.gitIncrement) {
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

			// ---- Конфигурация ----
			case 'cf.build':
				return [['compile', '--src', intent.src, '--out', intent.out, ...common(intent)]];
			case 'cf.decompileFile':
				return [['decompile', '--in', intent.file, '--out', intent.out, ...common(intent)]];
			case 'cf.dumpIbToSrc': {
				const args = ['decompile', '--current', '--out', intent.out, ...common(intent)];
				if (intent.versionsFile !== undefined) {
					args.push('--versions', intent.versionsFile);
				}
				return [args];
			}
			case 'cf.unloadIbToCf':
				return [['unload', intent.out, ...common(intent)]];
			case 'cf.makeDist':
				return [['make-dist', intent.out, ...common(intent)]];
			case 'cf.loadFileToIb':
				return [['load', '--src', intent.file, ...common(intent)]];

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
			case 'validate.syntaxCheck':
				return [['syntax-check', ...common(intent)]];

			default:
				return assertNever(intent);
		}
	}
}
