/**
 * Собирает сводку окружения из настроек, кэша компонентов и найденных бинарей.
 */

import { execFile } from 'node:child_process';
import * as os from 'node:os';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { findRac } from '../features/clusters/racLocator';
import { findCestart } from '../features/ibases/cestart';
import { readComponentStates } from './componentsRegistry';
import {
	type EnvironmentEngineInfo,
	type EnvironmentSummary,
	type EnvironmentToolInfo,
} from './environmentSummary';
import { ENGINE_SOURCE_LABELS } from './oneScriptEngine';
import { readPackageManifest } from './oneScriptLayout';
import { currentRoot } from './workspaceProjects';
import { decodeProcessOutput } from './processOutput';
import { VRunnerManager } from './vrunnerManager';
import { findEdtInstallations, pickEdtInstallation } from './edtLocator';
import { describePlatformInstallations } from './platformBinary';
import { projectPlatformRoots } from './platformSettings';
import { projectConfiguration } from './projectConfiguration';
import { untrustedWorkspaceBlocks } from './workspaceTrust';

const execFileAsync = promisify(execFile);
const HOST_EXTENSION_ID = 'yellow-hammer.1c-platform-tools';
const MCP_EXTENSION_ID = 'yellow-hammer.mcp-1c-platform-tools';
const CLI_VERSION_TIMEOUT_MS = 5_000;

/**
 * Собирает сведения об окружении для вставки в обращение.
 *
 * @param context - Контекст расширения
 * @returns Промис, который разрешается сводкой
 */
export async function collectEnvironmentSummary(
	context: vscode.ExtensionContext
): Promise<EnvironmentSummary> {
	const config = projectConfiguration();
	const [oscript, vrunner, components] = await Promise.all([
		readOscriptInfo(),
		readVrunnerInfo(),
		readComponents(context, config),
	]);
	const platformRoots = projectPlatformRoots();
	const rac = findRac(platformRoots);
	const cestart = findCestart({ roots: platformRoots });
	const edt = findEdtInstallations(config.get<string>('edt.path', ''));
	const edtSelected = pickEdtInstallation(edt.installations, config.get<string>('edt.version', ''));

	return {
		os: `${os.type()} ${os.release()}`,
		arch: os.arch(),
		editor: vscode.env.appName,
		editorVersion: vscode.version,
		remoteName: vscode.env.remoteName || undefined,
		workspaceTrusted: vscode.workspace.isTrusted,
		extensionVersion: readExtensionVersion(HOST_EXTENSION_ID) ?? fallbackExtensionVersion(context),
		mcpVersion: readExtensionVersion(MCP_EXTENSION_ID),
		nodeVersion: process.versions.node,
		oscript,
		vrunner,
		components,
		platformInstallations: describePlatformInstallations(platformRoots),
		cestartPath: cestart.binary,
		racPath: rac.binary,
		edtVersions: edt.installations.map((installation) => installation.version),
		edtCliPath: edtSelected?.cli,
	};
}

/**
 * Версия установленного расширения или undefined, если его нет.
 *
 * @param extensionId - Идентификатор расширения
 * @returns Версия или undefined
 */
function readExtensionVersion(extensionId: string): string | undefined {
	const extension = vscode.extensions.getExtension(extensionId);
	const version = (extension?.packageJSON as { version?: string } | undefined)?.version?.trim();
	return version === '' ? undefined : version;
}

/**
 * Версия этого расширения из контекста, если каталог расширений её не отдал.
 *
 * @param context - Контекст расширения
 * @returns Версия или «не найдена»
 */
function fallbackExtensionVersion(context: vscode.ExtensionContext): string {
	const version = (context.extension.packageJSON as { version?: string }).version?.trim();
	return version === undefined || version === '' ? 'не найдена' : version;
}

/**
 * Движок OneScript текущего проекта: путь, версия, откуда взят и ВерсияСреды проекта.
 *
 * @returns Сведения; без найденного движка только ВерсияСреды
 */
async function readOscriptInfo(): Promise<EnvironmentEngineInfo> {
	const engine = await VRunnerManager.getInstance().projectEngine();
	if (engine === undefined) {
		const root = currentRoot();
		const required = root === undefined ? undefined : readPackageManifest(root)?.engineVersion;
		return required ? { required } : {};
	}
	return {
		path: engine.oscript,
		version: engine.version?.text ?? (await readCliVersion(engine.oscript, ['-version'])),
		source: ENGINE_SOURCE_LABELS[engine.source],
		...(engine.required ? { required: engine.required } : {}),
	};
}

/**
 * Путь и версия vrunner.
 *
 * @returns Сведения или пустой объект, если версию прочитать не удалось и путь — голое имя
 */
async function readVrunnerInfo(): Promise<EnvironmentToolInfo> {
	const vrunner = VRunnerManager.getInstance();
	const version = await vrunner.getVRunnerVersion();
	const vrunnerPath = vrunner.getVRunnerPath();
	if (version === undefined && vrunnerPath === 'vrunner') {
		const available = await vrunner.checkOscriptAvailable();
		if (!available) {
			return {};
		}
	}
	return {
		path: vrunnerPath,
		version: version?.raw,
	};
}

/**
 * Состояния загружаемых компонентов.
 *
 * @param context - Контекст расширения
 * @param config - Настройки расширения
 * @returns Список для сводки
 */
async function readComponents(
	context: vscode.ExtensionContext,
	config: vscode.WorkspaceConfiguration
): Promise<EnvironmentSummary['components']> {
	const states = await readComponentStates(context);
	return Promise.all(
		states.map(async (state) => ({
			title: state.spec.title,
			version: state.version,
			cachePath: await state.spec.cachePath(context),
			overridePath: state.overridden
				? config.get<string>(state.spec.pathSetting, '').trim() || undefined
				: undefined,
			autoloadOff: state.autoloadOff,
		}))
	);
}

/**
 * Первая непустая строка вывода команды версии.
 *
 * @param command - Исполняемый файл
 * @param args - Аргументы
 * @returns Строка версии или undefined
 */
async function readCliVersion(command: string, args: string[]): Promise<string | undefined> {
	if (untrustedWorkspaceBlocks(`версия ${command}`)) {
		return undefined;
	}
	try {
		const { stdout, stderr } = await execFileAsync(command, args, {
			timeout: CLI_VERSION_TIMEOUT_MS,
			windowsHide: true,
			encoding: 'buffer',
		});
		const text = decodeProcessOutput(Buffer.concat([stdout, stderr])).trim();
		const line = text.split(/\r?\n/).find((item) => item.trim() !== '');
		return line?.trim();
	} catch {
		return undefined;
	}
}
