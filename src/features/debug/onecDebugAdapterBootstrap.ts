/**
 * Загрузка onec-debug-adapter (DAP) с GitHub Releases в рантайме — тем же механизмом, что и md-sparrow
 * (см. {@link githubReleaseLoader}).
 *
 * Релиз адаптера содержит самостоятельные (self-contained) сборки под платформы: в них входит рантайм
 * .NET, поэтому запускается нативный исполняемый файл и системный .NET не нужен. Для платформ без такой
 * сборки и для старых релизов остаётся универсальный архив, который запускается через `dotnet`.
 * @module onecDebugAdapterBootstrap
 */

import * as vscode from 'vscode';
import * as fssync from 'node:fs';
import * as path from 'node:path';
import { globSync } from 'glob';
import { logger } from '../../shared/logger';
import {
	type ReleaseComponentSpec,
	cachedReleaseTag,
	checkReleaseUpdateInBackground,
	clearReleaseCache,
	ensureReleaseComponent,
	installBaseDir,
	resolveGithubToken,
} from '../../shared/githubReleaseLoader';

const log = logger.scope('dap');

/** Управляемая сборка адаптера: запускается через `dotnet`, есть в любом варианте поставки. */
export const ONEC_DEBUG_ADAPTER_DLL = 'OnecDebugAdapter.dll';

/**
 * Универсальный архив релиза: без рантайма внутри, нужен установленный .NET. В имени после названия
 * идёт сразу тег, этим он и отличается от архивов самостоятельных сборок.
 */
const PORTABLE_ASSET_REGEX = /^onec-debug-adapter-v\d[\w.+-]*\.zip$/i;

/**
 * Имя нативного исполняемого файла адаптера в самостоятельной сборке.
 */
export function adapterHostName(platform: NodeJS.Platform = process.platform): string {
	return platform === 'win32' ? 'OnecDebugAdapter.exe' : 'OnecDebugAdapter';
}

/**
 * RID .NET, под который в релизе есть самостоятельная сборка; undefined — для системы её не публикуют
 * и адаптер запускается через `dotnet`.
 *
 * Windows on ARM берёт сборку win-x64: она работает через встроенную эмуляцию x64.
 */
export function adapterRid(
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch
): string | undefined {
	if (platform === 'win32') {
		return arch === 'x64' || arch === 'arm64' ? 'win-x64' : undefined;
	}
	if (platform === 'darwin') {
		return arch === 'arm64' ? 'osx-arm64' : arch === 'x64' ? 'osx-x64' : undefined;
	}
	if (platform === 'linux') {
		return arch === 'x64' ? 'linux-x64' : undefined;
	}
	return undefined;
}

/**
 * Регэкспы asset'ов релиза по убыванию приоритета: сначала самостоятельная сборка под систему,
 * затем универсальный архив (он же единственный вариант в релизах до self-contained).
 */
export function adapterAssetRegexes(rid: string | undefined): RegExp[] {
	if (!rid) {
		return [PORTABLE_ASSET_REGEX];
	}
	return [new RegExp(`^onec-debug-adapter-${rid}-.*\\.zip$`, 'i'), PORTABLE_ASSET_REGEX];
}

function onecDebugAdapterSpec(): ReleaseComponentSpec {
	return {
		repoSlug: 'yellow-hammer/onec-debug-adapter',
		cacheSubdir: 'onec-debug-adapter',
		stampName: '.dap-info.json',
		assetRegex: adapterAssetRegexes(adapterRid()),
		label: 'onec-debug-adapter',
		extract: true,
		isCacheValid: (assetPath) => adapterCacheMatchesPlatform(assetPath),
	};
}

/** Как запускать адаптер: готовая команда с аргументами. */
export interface OnecDebugAdapterRuntime {
	/** Исполняемый файл: нативный хост адаптера или `dotnet`. */
	command: string;
	/** Аргументы запуска: для `dotnet` — путь к OnecDebugAdapter.dll, иначе пусто. */
	args: string[];
	/** Тег релиза (если скачан с GitHub) */
	releaseTag?: string;
}

function findUnder(root: string, name: string): string | undefined {
	const hits = globSync(`**/${name}`, { cwd: root, absolute: true, nocase: process.platform === 'win32' });
	for (const hit of hits) {
		try {
			if (fssync.statSync(hit).isFile()) {
				return hit;
			}
		} catch {
			// файл исчез между поиском и проверкой: смотрим следующий
		}
	}
	return undefined;
}

/**
 * Проставляет право на выполнение: архивы, собранные не на этой системе, могут прийти без него.
 */
export function ensureExecutable(file: string, platform: NodeJS.Platform = process.platform): void {
	if (platform === 'win32') {
		return;
	}
	try {
		const mode = fssync.statSync(file).mode;
		fssync.chmodSync(file, mode | 0o111);
	} catch (e) {
		log.warn(`не удалось сделать файл адаптера исполняемым: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/**
 * Есть ли рядом со сборкой рантайм .NET. Нативный хост лежит и в обычной сборке, но там он
 * собран под систему сборщика и требует установленного .NET, поэтому смотрим на состав:
 * includedFrameworks в runtimeconfig.json бывает только у самостоятельной сборки.
 */
/**
 * Распакованный релиз собран под эту ОС: чужие native-библиотеки рантайма .NET
 * (linux zip на Windows и наоборот) означают, что кэш нужно скачать заново.
 */
export function adapterCacheMatchesPlatform(
	root: string,
	platform: NodeJS.Platform = process.platform
): boolean {
	const dll = findUnder(root, ONEC_DEBUG_ADAPTER_DLL);
	if (!dll) {
		return false;
	}
	const dir = path.dirname(dll);
	const hasSo = fssync.existsSync(path.join(dir, 'libhostpolicy.so'));
	const hasDylib = fssync.existsSync(path.join(dir, 'libhostpolicy.dylib'));
	const hasDll = fssync.existsSync(path.join(dir, 'hostpolicy.dll'));
	if (platform === 'win32') {
		return !hasSo && !hasDylib;
	}
	if (platform === 'linux') {
		return !hasDll && !hasDylib;
	}
	if (platform === 'darwin') {
		return !hasDll && !hasSo;
	}
	return true;
}

function isSelfContained(dir: string): boolean {
	try {
		const raw = fssync.readFileSync(path.join(dir, 'OnecDebugAdapter.runtimeconfig.json'), 'utf8');
		const config = JSON.parse(raw) as { runtimeOptions?: { includedFrameworks?: unknown[] } };
		return (config.runtimeOptions?.includedFrameworks?.length ?? 0) > 0;
	} catch {
		return false;
	}
}

/**
 * Команда запуска адаптера из распакованного релиза: нативный хост самостоятельной сборки,
 * иначе `dotnet` с управляемой сборкой.
 *
 * @param root каталог распаковки релиза
 */
export function resolveAdapterRuntime(root: string): OnecDebugAdapterRuntime | undefined {
	const dll = findUnder(root, ONEC_DEBUG_ADAPTER_DLL);
	if (!dll) {
		return undefined;
	}
	const dir = path.dirname(dll);
	const host = path.join(dir, adapterHostName());
	if (isSelfContained(dir) && fssync.existsSync(host)) {
		ensureExecutable(host);
		return { command: host, args: [] };
	}
	return { command: 'dotnet', args: [dll] };
}

/**
 * Команда запуска для пути из настройки components.adapterFile: управляемая сборка идёт через `dotnet`,
 * остальное считается нативным хостом.
 */
export function runtimeFromFile(file: string): OnecDebugAdapterRuntime {
	if (file.toLowerCase().endsWith('.dll')) {
		return { command: 'dotnet', args: [file] };
	}
	ensureExecutable(file);
	return { command: file, args: [] };
}

/**
 * Гарантирует наличие onec-debug-adapter согласно настройкам расширения.
 *
 * @throws Error если автозагрузка выключена и не задан components.adapterFile, либо адаптер не найден.
 */
export async function ensureOnecDebugAdapter(context: vscode.ExtensionContext): Promise<OnecDebugAdapterRuntime> {
	const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
	const override = cfg.get<string>('components.adapterFile', '').trim();
	if (override) {
		if (override.includes('${')) {
			throw new Error(
				`components.adapterFile: укажите полный путь к ${adapterHostName()} или ${ONEC_DEBUG_ADAPTER_DLL}.`
			);
		}
		if (!fssync.existsSync(override)) {
			throw new Error(`components.adapterFile не найден: ${override}.`);
		}
		const runtime = runtimeFromFile(override);
		log.info(`адаптер готов: ${describeRuntime(runtime)} (локальный файл)`);
		return runtime;
	}
	if (!cfg.get<boolean>('components.adapterAutoload', true)) {
		throw new Error('Укажите components.adapterFile или включите components.adapterAutoload.');
	}

	const spec = onecDebugAdapterSpec();
	const ensured = await ensureReleaseComponent(installBaseDir(context), spec, resolveGithubToken());
	const runtime = resolveAdapterRuntime(ensured.assetPath);
	if (!runtime) {
		throw new Error(
			`В релизе onec-debug-adapter ${ensured.tag} не найден ни ${adapterHostName()}, ни ${ONEC_DEBUG_ADAPTER_DLL}.`
		);
	}
	if (runtime.command === 'dotnet') {
		log.warn('в релизе нет сборки под эту систему, адаптер запускается через установленный .NET');
	}
	log.info(`адаптер готов: ${describeRuntime(runtime)} (${ensured.tag})`);
	return { ...runtime, releaseTag: ensured.tag };
}

/** Строка для лога: что именно будет запущено. */
export function describeRuntime(runtime: OnecDebugAdapterRuntime): string {
	return [runtime.command, ...runtime.args].join(' ');
}

/** Фоновая проверка нового релиза адаптера (чистит кэш, чтобы следующий запуск скачал свежий). */
export function checkOnecDebugAdapterUpdateInBackground(context: vscode.ExtensionContext): void {
	const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
	if (cfg.get<string>('components.adapterFile', '').trim()) {
		return;
	}
	if (!cfg.get<boolean>('components.adapterAutoload', true)) {
		return;
	}
	checkReleaseUpdateInBackground(installBaseDir(context), onecDebugAdapterSpec(), resolveGithubToken(), () => {
		/* кэш очищен; следующий запуск отладки скачает новую версию */
	});
}

/** Тег релиза адаптера в кэше; undefined — не загружен. */
export async function cachedOnecDebugAdapterTag(context: vscode.ExtensionContext): Promise<string | undefined> {
	return cachedReleaseTag(installBaseDir(context), onecDebugAdapterSpec());
}

/** Сброс кэша адаптера — следующий запуск отладки скачает заново. */
export async function clearOnecDebugAdapterCache(context: vscode.ExtensionContext): Promise<void> {
	await clearReleaseCache(installBaseDir(context), onecDebugAdapterSpec());
}
