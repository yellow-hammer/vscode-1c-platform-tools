import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DEBUG_TYPE } from './debugConstants';
import { isEdtProject } from '../../shared/projectLayout';
import { resolveFileIbConnectionString } from '../../shared/ibConnectionPath';
import { logger } from '../../shared/logger';
import { VRunnerManager } from '../../shared/vrunnerManager';
import {
	PLATFORM_PATH_SETTING_TITLE,
	resolvePlatformVersion,
	resolvePlatformVersionInRoots,
} from '../../shared/platformBinary';
import { projectPlatformRoots } from '../../shared/platformSettings';
import { CONVENTIONAL_PATHS, projectPaths, type ProjectPaths } from '../../shared/projectPaths';
import { BUILD_SUBDIRS } from '../../shared/pathDefaults';
import { currentRoot, deepestProject, projectOf, runWithProject } from '../../shared/workspaceProjects';
import { ensureWorkspaceTrusted } from '../../shared/workspaceTrust';

const launchConfig: vscode.DebugConfiguration = {
	name: 'Отладка 1С (запуск)',
	type: DEBUG_TYPE,
	request: 'launch',
	rootProject: '${workspaceFolder}',
	debugServerHost: 'localhost',
	autoAttachTypes: ['ManagedClient', 'Server'],
};

/** Платформа, которую получает адаптер отладки. */
export interface DebugPlatform {
	/** Каталог с каталогами версий. */
	readonly platformPath?: string;
	/** Имя каталога версии. */
	readonly platformVersion?: string;
}

/**
 * Каталог с версиями и версия платформы для адаптера отладки.
 *
 * `platformPath` из конфигурации запуска главнее каталогов, найденных расширением.
 *
 * @param config - Конфигурация отладки
 * @param requestedVersion - Версия из конфигурации или профиля, возможно префиксом
 * @param roots - Каталоги установки платформы проекта
 */
export function resolveDebugPlatform(
	config: vscode.DebugConfiguration,
	requestedVersion: string | undefined,
	roots: readonly string[]
): DebugPlatform {
	if (typeof config.platformPath === 'string' && config.platformPath.trim() !== '') {
		return {
			platformPath: config.platformPath,
			platformVersion: resolvePlatformVersion(config.platformPath, requestedVersion) ?? requestedVersion,
		};
	}
	const found = resolvePlatformVersionInRoots(roots, requestedVersion);
	return found ? { platformPath: found.root, platformVersion: found.version } : { platformVersion: requestedVersion };
}

/** Путь от корня рабочей области в записи конфигурации запуска. */
function templatePath(relative: string): string {
	const normalized = relative.replace(/\\/g, '/').replace(/^\.?\//, '');
	return normalized.length > 0 ? `\${workspaceFolder}/${normalized}` : '${workspaceFolder}';
}

/**
 * Каталоги исходного кода проекта для адаптера отладки: конфигурация, расширения,
 * внешние обработки и отчёты вместе с их сборками.
 *
 * @param paths - Раскладка проекта
 * @param outPath - Каталог сборки проекта
 * @param asPath - Запись каталога проекта в конфигурации отладки
 */
export function debugSourceFields(
	paths: ProjectPaths | undefined,
	outPath: string,
	asPath: (relative: string) => string
): Record<string, unknown> {
	const fields: Record<string, unknown> = { rootProject: asPath(paths?.configuration?.dir ?? '.') };

	// Расширения решения и тестовые: тесты YAxUnit живут отдельно от поставки,
	// но отлаживать их нужно так же
	const extensions = paths ? [...paths.extensions, ...paths.testExtensions].map((extension) => asPath(extension.dir)) : [];
	if (extensions.length > 0) {
		fields.extensions = extensions;
	}

	// Внешние обработки и отчёты: каталоги выгрузки конфигуратора всегда в шаблоне,
	// несуществующие адаптер пропускает; проекты EDT лежат отдельно, поэтому идут
	// каждый своим каталогом
	const container = (value: string | undefined, fallback: string) =>
		asPath(value === undefined || value === '.' ? fallback : value);
	const externalSources = [
		container(paths?.processorsContainer, CONVENTIONAL_PATHS.epf),
		container(paths?.reportsContainer, CONVENTIONAL_PATHS.erf),
		...(paths ? [...paths.processors, ...paths.reports, ...paths.testProcessors] : [])
			.filter((external) => external.format === 'edt')
			.map((external) => asPath(external.dir)),
	];
	fields.externalFilesSrc = [...new Set(externalSources)];

	// Собранные .epf/.erf: сервер отладки адресует внешние модули по URL файла
	const out = outPath.replace(/\\/g, '/').replace(/^\.?\//, '');
	// Тестовые обработки собираются в свой каталог: без него их точки останова не привязать
	fields.externalFilesBuilds = [
		asPath(`${out}/${BUILD_SUBDIRS.epf}`),
		asPath(`${out}/${BUILD_SUBDIRS.erf}`),
		asPath(`${out}/${BUILD_SUBDIRS.testsEpf}`),
	];
	return fields;
}

/** Лежит ли в каталоге исходный код конфигурации: выгрузка конфигуратора или проект EDT. */
function hasConfigurationSources(directory: string): boolean {
	return directory !== '' && (fs.existsSync(path.join(directory, 'Configuration.xml')) || isEdtProject(directory));
}

/** Откуда берётся проект отладки. */
export interface DebugProjectLookup {
	/** Текущий проект. */
	current: string | undefined;
	/** Самый глубокий проект, содержащий путь. */
	projectOf: (target: string) => string | undefined;
}

/**
 * Проект, профиль которого читает отладка.
 *
 * Без папки - текущий проект. С папкой: проект каталога `rootProject`; текущий
 * проект, если он в этой папке; проект папки; иначе текущий.
 *
 * @param folderRoot - Корень папки рабочей области конфигурации отладки
 * @param rootProject - Абсолютный каталог `rootProject` конфигурации, если известен
 * @param lookup - Текущий проект и поиск проекта по пути
 */
export function debugProjectRoot(
	folderRoot: string | undefined,
	rootProject: string | undefined,
	lookup: DebugProjectLookup
): string | undefined {
	if (folderRoot === undefined) {
		return lookup.current;
	}
	const byRootProject = rootProject === undefined ? undefined : lookup.projectOf(rootProject);
	if (byRootProject !== undefined) {
		return byRootProject;
	}
	if (lookup.current !== undefined && deepestProject([{ root: folderRoot }], lookup.current) !== undefined) {
		return lookup.current;
	}
	return lookup.projectOf(folderRoot) ?? lookup.current;
}

/**
 * Абсолютный каталог `rootProject` до подстановки переменных VS Code.
 *
 * @param config - Конфигурация отладки
 * @param folderRoot - Корень папки рабочей области
 * @returns Каталог или undefined, когда в значении остались другие переменные
 */
export function debugRootProjectDir(config: vscode.DebugConfiguration, folderRoot: string | undefined): string | undefined {
	if (typeof config.rootProject !== 'string' || config.rootProject.trim() === '') {
		return undefined;
	}
	const value = folderRoot === undefined
		? config.rootProject
		: config.rootProject.replaceAll('${workspaceFolder}', folderRoot);
	if (value.includes('${')) {
		return undefined;
	}
	if (path.isAbsolute(value)) {
		return path.resolve(value);
	}
	return folderRoot === undefined ? undefined : path.resolve(folderRoot, value);
}

/**
 * Проект конфигурации отладки.
 *
 * @param folder - Папка рабочей области конфигурации
 * @param config - Конфигурация отладки
 */
export function debugConfigurationRoot(
	folder: vscode.WorkspaceFolder | undefined,
	config: vscode.DebugConfiguration
): string | undefined {
	const folderRoot = folder?.uri.fsPath;
	return debugProjectRoot(folderRoot, debugRootProjectDir(config, folderRoot), { current: currentRoot(), projectOf });
}

export class OnecDebugConfigurationProvoider implements vscode.DebugConfigurationProvider {
	constructor(private readonly vrunner: VRunnerManager) {}

	async provideDebugConfigurations(
		folder: vscode.WorkspaceFolder | undefined,
		_token?: vscode.CancellationToken
	): Promise<vscode.DebugConfiguration[]> {
		const folderRoot = folder?.uri.fsPath;
		const root = debugProjectRoot(folderRoot, undefined, { current: currentRoot(), projectOf });
		return runWithProject(root, () => this.buildConfigurations(folderRoot, root));
	}

	/**
	 * Шаблон конфигурации отладки проекта: пути проекта записываются от папки рабочей области.
	 *
	 * @param folderRoot - Корень папки рабочей области
	 * @param root - Корень проекта
	 */
	private async buildConfigurations(
		folderRoot: string | undefined,
		root: string | undefined
	): Promise<vscode.DebugConfiguration[]> {
		const paths = root ? await projectPaths(root) : undefined;
		const asTemplate = (relative: string): string => {
			if (root === undefined) {
				return templatePath(relative === '.' ? '' : relative);
			}
			const absolute = path.resolve(root, relative);
			if (folderRoot === undefined) {
				return absolute.replace(/\\/g, '/');
			}
			const fromFolder = path.relative(folderRoot, absolute);
			return fromFolder.startsWith('..') || path.isAbsolute(fromFolder)
				? absolute.replace(/\\/g, '/')
				: templatePath(fromFolder);
		};

		if (root && paths?.configuration?.dir === undefined) {
			void vscode.window.showWarningMessage(
				'Исходный код конфигурации в рабочей области не найден: укажите в конфигурации запуска каталог rootProject.'
			);
		}

		return [{ ...launchConfig, ...debugSourceFields(paths, this.vrunner.getOutPath(), asTemplate) }];
	}

	async resolveDebugConfiguration(
		folder: vscode.WorkspaceFolder | undefined,
		config: vscode.DebugConfiguration,
		_token?: vscode.CancellationToken
	): Promise<vscode.DebugConfiguration | undefined> {
		if (config.type !== DEBUG_TYPE) {
			return config;
		}

		// Конфигурация отладки приходит из launch.json проекта и запускает платформу
		if (!ensureWorkspaceTrusted('отладка 1С')) {
			return undefined;
		}

		const workspaceRoot = debugConfigurationRoot(folder, config);
		if (!workspaceRoot) {
			void vscode.window.showErrorMessage(
				'Укажите строку подключения к ИБ (формат /F или /S) в файле настроек активного профиля запуска. Открытая папка не определена.'
			);
			return undefined;
		}

		return runWithProject(workspaceRoot, () => this.resolveInProject(workspaceRoot, config));
	}

	/**
	 * Дополняет конфигурацию отладки строкой подключения, учётными данными и
	 * версией платформы из активного профиля проекта.
	 *
	 * @param workspaceRoot - Корень проекта
	 * @param config - Конфигурация отладки
	 */
	private async resolveInProject(
		workspaceRoot: string,
		config: vscode.DebugConfiguration
	): Promise<vscode.DebugConfiguration | undefined> {
		// Строка подключения и учётные данные берутся из активного профиля запуска
		// (env.json/env.<id>.json для vrunner 2 или autumn-properties.* для vrunner 3),
		// а не напрямую из env.json — иначе смена профиля не влияла бы на отладку.
		await this.vrunner.getVRunnerVersion();
		if (!this.vrunner.ensureLaunchReady()) {
			return undefined;
		}
		const connectionString = this.vrunner.readActiveProfileSettingSync('ibconnection');
		if (typeof connectionString !== 'string' || connectionString.trim() === '') {
			void vscode.window.showErrorMessage(
				'Укажите строку подключения к ИБ (формат /F или /S) в файле настроек активного профиля запуска.'
			);
			return undefined;
		}

		const trimmed = connectionString.trim();
		if (!trimmed.startsWith('/F') && !trimmed.startsWith('/S')) {
			void vscode.window.showErrorMessage(
				`Строка подключения к ИБ должна начинаться с /F (файловая ИБ) или /S (серверная ИБ). Получено: ${trimmed.slice(0, 20)}…`
			);
			return undefined;
		}

		const resolvedConnectionString = resolveFileIbConnectionString(trimmed, workspaceRoot);

		// При уровне логирования Debug (или подробнее) включаем диагностику адаптера
		// (нейтральный флаг trace в конфигурации запуска).
		const trace = logger.isDebugEnabled();

		// Учётные данные автовхода: из конфигурации запуска либо активного профиля.
		const user = (config.user as string | undefined)
			?? this.vrunner.readActiveProfileSettingSync('db-user') ?? '';
		const password = (config.password as string | undefined)
			?? this.vrunner.readActiveProfileSettingSync('db-pwd') ?? '';

		// Адаптер получает каталог с версиями (`platformPath`) и имя каталога версии
		// (`platformVersion`), поэтому запрос профиля вроде «8.3» сводится к
		// существующей сборке.
		const requestedVersion = (config.platformVersion as string | undefined)
			?? (await this.vrunner.getActiveV8Version());
		const platform = resolveDebugPlatform(config, requestedVersion, projectPlatformRoots(workspaceRoot));
		if (platform.platformPath === undefined && config.request === 'launch') {
			const version = requestedVersion ? ` версии ${requestedVersion}` : '';
			void vscode.window.showErrorMessage(
				`Платформа 1С${version} не найдена. Укажите каталог установки платформы в настройке ${PLATFORM_PATH_SETTING_TITLE}.`
			);
			return undefined;
		}

		return {
			...config,
			connectionString: resolvedConnectionString,
			trace,
			user,
			password,
			...(platform.platformPath ? { platformPath: platform.platformPath } : {}),
			...(platform.platformVersion ? { platformVersion: platform.platformVersion } : {}),
		};
	}

	resolveDebugConfigurationWithSubstitutedVariables(
		_folder: vscode.WorkspaceFolder | undefined,
		config: vscode.DebugConfiguration
	): vscode.DebugConfiguration | undefined {
		if (config.type !== DEBUG_TYPE) {
			return config;
		}
		// Без исходного кода конфигурации адаптер не сопоставит точки останова с модулями
		const rootProject = typeof config.rootProject === 'string' ? config.rootProject : '';
		if (!hasConfigurationSources(rootProject)) {
			void vscode.window.showErrorMessage(
				`Исходный код конфигурации не найден в каталоге rootProject: ${rootProject || 'каталог не задан'}. Укажите выгрузку конфигуратора или проект 1С:EDT.`
			);
			return undefined;
		}
		return config;
	}
}

export function getOnecConfigurations(): vscode.DebugConfiguration[] {
	const config = vscode.workspace.getConfiguration('launch');
	const configurations = config.get<vscode.DebugConfiguration[]>('configurations');
	if (configurations === undefined) {
		return [];
	}
	return configurations.filter((c) => c.type === DEBUG_TYPE);
}

export function watchTargetTypesChanged(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (
				vscode.debug.activeDebugSession !== undefined &&
				event.affectsConfiguration('launch.configurations')
			) {
				const onecConfigs = getOnecConfigurations();
				const debugSessionConfig = vscode.debug.activeDebugSession.configuration;
				const sessionConfigs = onecConfigs.filter((c) => c.name === debugSessionConfig.name);
				if (sessionConfigs.length === 1) {
					const newTargets: string[] = sessionConfigs[0].autoAttachTypes ?? [];
					void vscode.debug.activeDebugSession.customRequest('SetAutoAttachTargetTypesRequest', {
						types: newTargets,
					});
				}
			}
		})
	);
}
