/**
 * Переменные среды, которые читает код OneScript проекта: файлы `*.os` проекта
 * с именами модулей по правилам загрузки библиотек OneScript.
 *
 * Модулем файл становится, если он объявлен в `lib.config` (`<module name file>`)
 * или, без объявления, лежит в каталоге `Модули` / `Modules`: так библиотеку
 * подключает `#Использовать`. Код зависимостей (`oscript_modules`) и результаты
 * сборки не читаются.
 *
 * @module launch/projectEnvironmentVariables
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { environmentVariablesInCode, type SourceFile } from '../../shared/codeEnvironmentVariables';
import { findProjectFiles, projectScanRootOf } from '../artifacts/projectScan';
import { logger } from '../../shared/logger';

const log = logger.scope('launch');

/** Каталоги, код в которых проекту не принадлежит */
const FOREIGN_SEGMENTS = ['oscript_modules', 'node_modules', '.git', 'build', 'out'];

/** Каталоги модулей библиотеки без lib.config */
const MODULE_DIRS = new Set(['модули', 'modules']);

/** Ключ пути: на Windows регистр не важен. */
function pathKey(file: string): string {
	const resolved = path.resolve(file);
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Модули, объявленные в файлах lib.config.
 *
 * @param configs - Пути файлов lib.config
 * @returns Имя модуля по ключу пути его файла
 */
async function declaredModules(configs: readonly string[]): Promise<Map<string, string>> {
	const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: (name) => name === 'module' });
	const modules = new Map<string, string>();
	for (const config of configs) {
		let declared: unknown;
		try {
			declared = (parser.parse(await fs.readFile(config, 'utf8')) as { 'package-def'?: { module?: unknown } })['package-def']?.module;
		} catch (error) {
			log.debug(`${config} не разобран: ${(error as Error).message}`);
			continue;
		}
		for (const entry of Array.isArray(declared) ? declared : []) {
			const { name, file } = (entry ?? {}) as { name?: unknown; file?: unknown };
			if (typeof name === 'string' && typeof file === 'string') {
				modules.set(pathKey(path.join(path.dirname(config), file)), name);
			}
		}
	}
	return modules;
}

/**
 * Имя модуля файла: объявленное в lib.config, иначе имя файла в каталоге модулей.
 *
 * @param file - Путь файла
 * @param declared - Модули из lib.config
 */
function moduleNameOf(file: string, declared: ReadonlyMap<string, string>): string | undefined {
	return declared.get(pathKey(file))
		?? (MODULE_DIRS.has(path.basename(path.dirname(file)).toLowerCase()) ? path.basename(file, path.extname(file)) : undefined);
}

/**
 * Переменные среды, которые читает код проекта.
 *
 * @param root - Корень проекта
 * @returns Имена переменных по алфавиту
 */
export async function projectEnvironmentVariables(root: string): Promise<string[]> {
	const scanRoot = await projectScanRootOf(root);
	const [sources, configs] = await Promise.all([
		findProjectFiles(scanRoot, '**/*.os', FOREIGN_SEGMENTS),
		findProjectFiles(scanRoot, '**/lib.config', FOREIGN_SEGMENTS),
	]);
	const declared = await declaredModules(configs.map((uri) => uri.fsPath));
	const files = await Promise.all(
		sources.map(async (uri): Promise<SourceFile | undefined> => {
			try {
				return { moduleName: moduleNameOf(uri.fsPath, declared), text: await fs.readFile(uri.fsPath, 'utf8') };
			} catch (error) {
				log.debug(`${uri.fsPath} не прочитан: ${(error as Error).message}`);
				return undefined;
			}
		})
	);
	return environmentVariablesInCode(files.filter((file): file is SourceFile => file !== undefined));
}
