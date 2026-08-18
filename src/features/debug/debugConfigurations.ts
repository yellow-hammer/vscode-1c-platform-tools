import * as path from 'node:path';
import * as vscode from 'vscode';
import { DEBUG_TYPE } from './debugConstants';
import { resolveFileIbConnectionString } from '../../shared/ibConnectionPath';
import { DEFAULT_PATHS } from '../../shared/pathDefaults';
import { logger } from '../../shared/logger';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { resolvePlatformVersion } from '../../shared/platformBinary';
import { resolveProjectLayout } from '../../shared/projectLayout';

const platformBasePath =
	process.platform === 'win32' ? '${env:PROGRAMFILES}/1cv8' : '/opt/1C/v8.3/x86_64';

const launchConfig: vscode.DebugConfiguration = {
	name: 'Отладка 1С (запуск)',
	type: DEBUG_TYPE,
	request: 'launch',
	platformPath: platformBasePath,
	rootProject: '${workspaceFolder}',
	debugServerHost: 'localhost',
	autoAttachTypes: ['ManagedClient', 'Server'],
};

/** Путь от корня рабочей области в записи конфигурации запуска. */
function templatePath(relative: string): string {
	const normalized = relative.replace(/\\/g, '/').replace(/^\.?\//, '');
	return normalized.length > 0 ? `\${workspaceFolder}/${normalized}` : '${workspaceFolder}';
}

/** Абсолютный путь в записи конфигурации запуска. */
function asWorkspacePath(workspaceRoot: string | undefined, directory: string): string {
	if (workspaceRoot === undefined) {
		return directory;
	}
	return templatePath(path.relative(workspaceRoot, directory));
}

export class OnecDebugConfigurationProvoider implements vscode.DebugConfigurationProvider {
	constructor(private readonly vrunner: VRunnerManager) {}

	async provideDebugConfigurations(
		folder: vscode.WorkspaceFolder | undefined,
		_token?: vscode.CancellationToken
	): Promise<vscode.DebugConfiguration[]> {
		const cfPathSetting = vscode
			.workspace
			.getConfiguration('1c-platform-tools')
			.get<string>('paths.cf', DEFAULT_PATHS.cf);

		// Каталоги расширений решения и тестовых: тесты YAxUnit живут отдельно
		// от поставки, но отлаживать их нужно так же
		const extensionPaths = [this.vrunner.getCfePath(), this.vrunner.getTestsCfePath()];

		const layout = folder
			? await resolveProjectLayout(folder.uri.fsPath, {
				configuration: cfPathSetting,
				extensions: extensionPaths,
			})
			: undefined;

		const workspaceRoot = folder?.uri.fsPath;
		const rootProject = layout?.configuration
			? asWorkspacePath(workspaceRoot, layout.configuration.dir)
			: templatePath(cfPathSetting);

		const extensions = layout && layout.extensions.length > 0
			? layout.extensions.map((extension) => asWorkspacePath(workspaceRoot, extension.dir))
			: undefined;

		const baseConfig: vscode.DebugConfiguration = { ...launchConfig, rootProject };

		if (extensions && extensions.length > 0) {
			(baseConfig as vscode.DebugConfiguration & { extensions: string[] }).extensions = extensions;
		}

		// Внешние обработки/отчёты — всегда в шаблоне (из настроек путей): несуществующие
		// каталоги адаптер пропускает, а параметры не теряются, если каталог появится позже.
		const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
		const normalize = (p: string) => p.replace(/\\/g, '/').replace(/^\.?\//, '');

		(baseConfig as Record<string, unknown>).externalFilesSrc = [
			normalize(cfg.get<string>('paths.epf', DEFAULT_PATHS.epf)),
			normalize(cfg.get<string>('paths.erf', DEFAULT_PATHS.erf)),
		].map((rel) => `\${workspaceFolder}/${rel}`);

		// Собранные .epf/.erf — сервер отладки адресует внешние модули по URL файла.
		const outPath = normalize(cfg.get<string>('paths.out', DEFAULT_PATHS.out));
		(baseConfig as Record<string, unknown>).externalFilesBuilds = [
			`\${workspaceFolder}/${outPath}/epf`,
			`\${workspaceFolder}/${outPath}/erf`,
		];

		return [baseConfig];
	}

	async resolveDebugConfiguration(
		folder: vscode.WorkspaceFolder | undefined,
		config: vscode.DebugConfiguration,
		_token?: vscode.CancellationToken
	): Promise<vscode.DebugConfiguration | undefined> {
		if (config.type !== DEBUG_TYPE) {
			return config;
		}

		const workspaceRoot = folder?.uri.fsPath;
		if (!workspaceRoot) {
			void vscode.window.showErrorMessage(
				'Укажите строку подключения к ИБ (формат /F или /S) в файле настроек активного профиля запуска. Открытая папка не определена.'
			);
			return undefined;
		}

		// Строка подключения и учётные данные берутся из активного профиля запуска
		// (env.json/env.<id>.json для vrunner 2 или autumn-properties.* для vrunner 3),
		// а не напрямую из env.json — иначе смена профиля не влияла бы на отладку.
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

		// Версию платформы (`platformPath` — база каталогов версий, `platformVersion`
		// — выбор конкретной сборки) подставляем из --v8version активного профиля,
		// если она не задана явно в конфигурации: профиль может пинить версию.
		// Запрос профиля (например, префикс «8.3») сводим к конкретной сборке из
		// каталога установки, чтобы адаптер получил существующую версию.
		const requestedVersion = (config.platformVersion as string | undefined)
			?? (await this.vrunner.getActiveV8Version());
		const basePath = typeof config.platformPath === 'string' ? config.platformPath : platformBasePath;
		const platformVersion = resolvePlatformVersion(basePath, requestedVersion) ?? requestedVersion;

		return {
			...config,
			connectionString: resolvedConnectionString,
			trace,
			user,
			password,
			...(platformVersion ? { platformVersion } : {}),
		};
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
