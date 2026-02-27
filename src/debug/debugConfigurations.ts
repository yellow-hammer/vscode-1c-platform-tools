import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

const platformBasePath =
	process.platform === 'win32' ? '${env:PROGRAMFILES}/1cv8' : '/opt/1C/v8.3/x86_64';

const launchConfig: vscode.DebugConfiguration = {
	name: 'Отладка 1С (запуск)',
	type: '1c-platform-tools',
	request: 'launch',
	platformPath: platformBasePath,
	rootProject: '${workspaceFolder}',
	debugServerHost: 'localhost',
	autoAttachTypes: ['ManagedClient', 'Server'],
};

function readConnectionStringFromEnv(workspaceRoot: string): string | undefined {
	const envPath = path.join(workspaceRoot, 'env.json');
	try {
		const content = fs.readFileSync(envPath, 'utf8');
		const env = JSON.parse(content) as { default?: { '--ibconnection'?: string } };
		return env.default?.['--ibconnection'];
	} catch {
		return undefined;
	}
}

export class OnecDebugConfigurationProvoider implements vscode.DebugConfigurationProvider {
	provideDebugConfigurations(
		folder: vscode.WorkspaceFolder | undefined,
		_token?: vscode.CancellationToken
	): vscode.ProviderResult<vscode.DebugConfiguration[]> {
		const cfPathSetting = vscode
			.workspace
			.getConfiguration('1c-platform-tools')
			.get<string>('paths.cf', 'src/cf');

		// Нормализуем путь: убираем ведущие ./ и /, слэши приводим к Unix-стилю,
		// чтобы получить корректный шаблон относительно ${workspaceFolder}.
		const normalizedCfPath = cfPathSetting
			.replace(/\\/g, '/')
			.replace(/^\.?\//, '');

		const rootProject =
			normalizedCfPath.length > 0
				? `\${workspaceFolder}/${normalizedCfPath}`
				: '${workspaceFolder}';

		let extensions: string[] | undefined;

		if (folder) {
			const workspaceRoot = folder.uri.fsPath;
			const cfePathSetting = vscode
				.workspace
				.getConfiguration('1c-platform-tools')
				.get<string>('paths.cfe', 'src/cfe');

			const normalizedCfePath = cfePathSetting
				.replace(/\\/g, '/')
				.replace(/^\.?\//, '');

			const absoluteCfeDir =
				normalizedCfePath.length > 0
					? path.join(workspaceRoot, normalizedCfePath)
					: workspaceRoot;

			try {
				const entries = fs.readdirSync(absoluteCfeDir, { withFileTypes: true });
				const dirs = entries.filter((entry) => entry.isDirectory());

				if (dirs.length > 0) {
					extensions = dirs.map((dir) => {
						const base = normalizedCfePath.length > 0
							? `\${workspaceFolder}/${normalizedCfePath}`
							: '${workspaceFolder}';
						return `${base}/${dir.name}`;
					});
				}
			} catch {
				// Если каталога нет или ошибка чтения — просто не заполняем extensions
			}
		}

		const baseConfig: vscode.DebugConfiguration = { ...launchConfig, rootProject };

		if (extensions && extensions.length > 0) {
			(baseConfig as vscode.DebugConfiguration & { extensions: string[] }).extensions = extensions;
		}

		return [baseConfig];
	}

	async resolveDebugConfiguration(
		folder: vscode.WorkspaceFolder | undefined,
		config: vscode.DebugConfiguration,
		_token?: vscode.CancellationToken
	): Promise<vscode.DebugConfiguration | undefined> {
		if (config.type !== '1c-platform-tools') return config;

		const workspaceRoot = folder?.uri.fsPath;
		if (!workspaceRoot) {
			void vscode.window.showErrorMessage(
				'Укажите default["--ibconnection"] в env.json в корне проекта (формат /F или /S). Открытая папка не определена.'
			);
			return undefined;
		}

		const connectionString = readConnectionStringFromEnv(workspaceRoot);
		if (typeof connectionString !== 'string' || connectionString.trim() === '') {
			void vscode.window.showErrorMessage(
				'Укажите default["--ibconnection"] в env.json в корне проекта (формат /F или /S).'
			);
			return undefined;
		}

		const trimmed = connectionString.trim();
		if (!trimmed.startsWith('/F') && !trimmed.startsWith('/S')) {
			void vscode.window.showErrorMessage(
				`Строка подключения в env.json должна начинаться с /F (файловая ИБ) или /S (серверная ИБ). Получено: ${trimmed.slice(0, 20)}…`
			);
			return undefined;
		}

		// Для файловой ИБ (/F) достраиваем относительный путь до полного относительно корня проекта
		let resolvedConnectionString = trimmed;
		if (trimmed.startsWith('/F')) {
			const pathPart = trimmed.slice(2).trim();
			const absolutePath = path.resolve(workspaceRoot, pathPart);
			resolvedConnectionString = '/F' + absolutePath;
		}

		return { ...config, connectionString: resolvedConnectionString };
	}
}

export function getOnecConfigurations(): vscode.DebugConfiguration[] {
	const config = vscode.workspace.getConfiguration('launch');
	const configurations = config.get<vscode.DebugConfiguration[]>('configurations');
	if (configurations === undefined) return [];
	return configurations.filter((c) => c.type === '1c-platform-tools');
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
