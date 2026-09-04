/**
 * Мост между проектом 1С:EDT и командами vanessa-runner.
 *
 * Раннер работает с выгрузкой конфигуратора, а проект EDT переводит в неё сама
 * EDT. Поэтому команда над исходниками EDT идёт в три шага: `1cedtcli export`
 * проекта в промежуточный каталог, сама команда раннера над этим каталогом и,
 * если команда писала исходники, `1cedtcli import` результата обратно в проект.
 * Версия раннера при этом не важна: он видит только выгрузку конфигуратора.
 *
 * @module edtSourceBridge
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SourceFormat } from '../../shared/projectLayout';
import type { VRunnerIntent } from '../../shared/vrunnerCli/intents';
import { isAtLeast, VRUNNER_FEATURES, type VRunnerVersion } from '../../shared/vrunnerVersion';

/** Насколько глубоко искать файлы описаний: внешняя обработка EDT лежит в src/ExternalDataProcessors/<Имя>. */
const FORMAT_PROBE_DEPTH = 4;

/** Промежуточный каталог выгрузок проектов EDT внутри каталога сборки. */
export const EDT_STAGING_DIR = 'edt-export';

/** Интенты, читающие исходники: проект выгружается перед командой. */
const READ_SOURCE_INTENTS: ReadonlySet<VRunnerIntent['kind']> = new Set([
	'infobase.init',
	'cf.loadFromSrc',
	'cf.build',
	'cfe.loadFromSrc',
	'cfe.buildCfe',
]);

/** Интенты, пишущие исходники: результат импортируется в проект после команды. */
const WRITE_SOURCE_INTENTS: ReadonlySet<VRunnerIntent['kind']> = new Set([
	'cf.dumpIbToSrc',
	'cfe.dumpIbToSrc',
	'cf.decompileFile',
	'cfe.decompileCfeFile',
]);

/** Конвертация форматов остаётся за раннером: у неё свой код внутри него. */
const RUNNER_CONVERT_INTENTS: ReadonlySet<VRunnerIntent['kind']> = new Set(['cf.convert', 'cfe.convert']);

/** Каталоги внешних объектов в проекте EDT. */
const EXTERNAL_DIRECTORIES = ['ExternalDataProcessors', 'ExternalReports'] as const;

/** Проект внешнего объекта EDT. */
export interface EdtExternalProject {
	/** Имя объекта: так же назван проект и его каталог. */
	name: string;
	/** Каталог проекта относительно рабочей области. */
	projectDir: string;
}

/** Выгрузка проекта EDT в формат конфигуратора перед командой. */
export interface EdtExportStep {
	/** Каталог проекта относительно рабочей области. */
	projectDir: string;
	/** Каталог выгрузки относительно рабочей области. */
	target: string;
	/** Имя внешнего объекта: его выгрузка перекладывается в раскладку раннера. */
	externalName?: string;
}

/** Импорт результата команды обратно в проект EDT. */
export interface EdtImportStep {
	/** Каталог с выгрузкой относительно рабочей области. */
	source: string;
	/** Каталог проекта относительно рабочей области. */
	projectDir: string;
	/** Расширению и внешнему объекту нужен базовый проект. */
	needsBase: boolean;
	/** Каталог с выгрузками внешних объектов: каждая уходит в свой проект. */
	external: boolean;
}

/** Команда над проектом EDT: что выгрузить, с чем запустить раннер и что импортировать. */
export interface EdtBridgePlan {
	intent: VRunnerIntent;
	exports: EdtExportStep[];
	imports: EdtImportStep[];
}

/** Что известно о рабочей области при планировании. */
export interface EdtBridgeLayout {
	/** Каталог сборки относительно рабочей области. */
	buildDir: string;
	/** Проекты внешних объектов в каталоге исходников команды; нужны сборке обработок. */
	externalProjects?: EdtExternalProject[];
}

/**
 * Путь исходников, с которыми идёт команда.
 *
 * @param intent - Что собирались запустить
 * @returns Путь или пустая строка, если команда работает не с исходниками
 */
export function intentSourcePath(intent: VRunnerIntent): string {
	if ('src' in intent && typeof intent.src === 'string') {
		return intent.src;
	}
	return 'out' in intent && typeof intent.out === 'string' ? intent.out : '';
}

/**
 * Формат исходников в каталоге по файлам описаний.
 *
 * Тестовые обработки живут отдельно от конфигурации и в свой формат не обязаны
 * с ней совпадать: раннер раскладывает их выгрузкой конфигуратора и при
 * конфигурации в EDT.
 *
 * @param directory - Абсолютный путь к каталогу исходников
 * @returns Формат или undefined, если каталога нет или описаний в нём не нашлось
 */
export function sourceFormatOfDirectory(directory: string): SourceFormat | undefined {
	if (!fs.existsSync(directory)) {
		return undefined;
	}
	const queue: { dir: string; depth: number }[] = [{ dir: directory, depth: 0 }];
	let sawXml = false;
	while (queue.length > 0) {
		const { dir, depth } = queue.shift()!;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith('.mdo')) {
				return 'edt';
			}
			if (entry.isFile() && entry.name.endsWith('.xml')) {
				sawXml = true;
			}
			if (entry.isDirectory() && depth < FORMAT_PROBE_DEPTH) {
				queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
			}
		}
	}
	return sawXml ? 'designer' : undefined;
}

/** Один ли это каталог: пути приходят относительными и с разными разделителями. */
export function samePath(left: string, right: string | undefined): boolean {
	if (!left || !right) {
		return false;
	}
	return normalizePath(left) === normalizePath(right);
}

function normalizePath(value: string): string {
	return value.split('\\').join('/').replace(/[/]+$/, '').toLowerCase();
}

/** Путь в записи раннера: прямые разделители, без хвостового. */
function runnerPath(...parts: string[]): string {
	return path.posix.join(...parts.map((part) => part.split('\\').join('/'))).replace(/[/]+$/, '');
}

/**
 * Проекты внешних объектов EDT, которых касается путь команды.
 *
 * Путь бывает каталогом объекта внутри проекта (`<проект>/src/ExternalDataProcessors/<Имя>`),
 * самим проектом или каталогом с несколькими проектами.
 *
 * @param workspaceRoot - Корень рабочей области
 * @param sourceDir - Путь из команды относительно рабочей области
 */
export function edtExternalProjectsOf(workspaceRoot: string, sourceDir: string): EdtExternalProject[] {
	const absolute = path.resolve(workspaceRoot, sourceDir);
	const relative = (dir: string) => runnerPath(path.relative(workspaceRoot, dir));
	const own = externalProjectOf(absolute);
	if (own) {
		return [{ name: own.name, projectDir: relative(own.projectDir) }];
	}
	const found: EdtExternalProject[] = [];
	let entries: fs.Dirent[] = [];
	try {
		entries = fs.readdirSync(absolute, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const project = externalProjectOf(path.join(absolute, entry.name));
		if (project) {
			found.push({ name: project.name, projectDir: relative(project.projectDir) });
		}
	}
	return found;
}

/** Проект внешнего объекта, которому принадлежит каталог: сам проект или каталог объекта в нём. */
function externalProjectOf(directory: string): { name: string; projectDir: string } | undefined {
	for (const candidate of [directory, path.resolve(directory, '..', '..', '..')]) {
		if (!fs.existsSync(path.join(candidate, '.project'))) {
			continue;
		}
		for (const kind of EXTERNAL_DIRECTORIES) {
			const objects = path.join(candidate, 'src', kind);
			let names: string[] = [];
			try {
				names = fs.readdirSync(objects, { withFileTypes: true })
					.filter((entry) => entry.isDirectory() && fs.existsSync(path.join(objects, entry.name, `${entry.name}.mdo`)))
					.map((entry) => entry.name);
			} catch {
				continue;
			}
			if (names.length > 0) {
				return { name: names[0], projectDir: candidate };
			}
		}
	}
	return undefined;
}

/**
 * План команды над проектом EDT.
 *
 * @param intent - Что собирались запустить
 * @param source - Формат и каталог исходников, с которыми работает команда
 * @param layout - Каталог сборки и найденные проекты внешних объектов
 * @returns План либо undefined, когда команда идёт к раннеру как есть
 */
export function planEdtBridge(
	intent: VRunnerIntent,
	source: { format?: SourceFormat; dir?: string } | undefined,
	layout: EdtBridgeLayout
): EdtBridgePlan | undefined {
	if (source?.format !== 'edt') {
		return undefined;
	}
	const staging = runnerPath(layout.buildDir, EDT_STAGING_DIR);
	const sourceDir = source.dir ?? intentSourcePath(intent);
	if (!sourceDir) {
		return undefined;
	}
	const target = runnerPath(staging, path.basename(sourceDir));

	if (READ_SOURCE_INTENTS.has(intent.kind) && 'src' in intent && typeof intent.src === 'string') {
		return {
			intent: { ...intent, src: target },
			exports: [{ projectDir: runnerPath(sourceDir), target }],
			imports: [],
		};
	}
	if (WRITE_SOURCE_INTENTS.has(intent.kind) && 'out' in intent) {
		return {
			intent: { ...intent, out: target },
			exports: [],
			imports: [{ source: target, projectDir: runnerPath(sourceDir), needsBase: intent.kind.startsWith('cfe.'), external: false }],
		};
	}
	if (intent.kind === 'epf.build') {
		const projects = layout.externalProjects ?? [];
		if (projects.length === 0) {
			return undefined;
		}
		return {
			intent: { ...intent, src: target },
			exports: projects.map((project) => ({
				projectDir: project.projectDir,
				target: runnerPath(target, project.name),
				externalName: project.name,
			})),
			imports: [],
		};
	}
	if (intent.kind === 'epf.decompile') {
		return {
			intent: { ...intent, out: target },
			exports: [],
			imports: [{ source: target, projectDir: runnerPath(sourceDir), needsBase: true, external: true }],
		};
	}
	return undefined;
}

/**
 * Почему конвертацию раннером нельзя запустить на исходниках EDT.
 *
 * Остальные команды проект EDT не останавливает: их исходники переводит сама EDT.
 *
 * @param intent - Что собирались запустить
 * @param source - Формат исходников, с которыми работает команда
 * @param version - Версия vanessa-runner; undefined, когда её не удалось определить
 * @returns Объяснение либо undefined, если препятствий нет
 */
export function edtToolingRefusal(
	intent: VRunnerIntent,
	source: { format?: SourceFormat; dir?: string } | undefined,
	version: VRunnerVersion | undefined
): string | undefined {
	if (source?.format !== 'edt' || !RUNNER_CONVERT_INTENTS.has(intent.kind)) {
		return undefined;
	}
	if (version === undefined || isAtLeast(version, VRUNNER_FEATURES.edtSources)) {
		return undefined;
	}
	return 'Конвертацию исходников 1С:EDT умеет vanessa-runner 3.0.0-rc8 и новее. Обновите раннер или воспользуйтесь командами группы «1С:EDT».';
}
