/**
 * Запуск 1cedtstart: его проекты это рабочие области EDT, по одной под базу.
 *
 * Кнопка «1C:EDT» платформы открывает ссылку `e1cedt://start/open`, а обработчик
 * схемы, 1cedtstart, находит или заводит рабочую область под базу и запускает
 * в ней EDT. 1cedtstart собран на Equinox и без явного `-vm` берёт первую Java
 * из PATH. Запуск идёт прямо: в аргументах всегда `javaw`, путь берётся из `-vm`
 * в ini либо из версии `-Dosgi.requiredJavaVersion` в настройках стартера.
 *
 * @module edtStart
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { edtComponentRoots, edtStartDataDirectory, fileUrlToPath } from '../../shared/edtLocator';
import { subdirectoryNames } from '../../shared/installPaths';
import { untrustedWorkspaceBlocks, WORKSPACE_TRUST_REQUIRED } from '../../shared/workspaceTrust';
import { spawnDetached } from './cestart';

/** Имя исполняемого файла стартера. */
export function edtStartFileName(platform: NodeJS.Platform = process.platform): string {
	return platform === 'win32' ? '1cedtstart.exe' : '1cedtstart';
}

/** Имя Java: у стартера без консоли, у `1cedtcli` — с консолью, чтобы был виден вывод. */
function javaFileName(platform: NodeJS.Platform, console: boolean): string {
	if (platform !== 'win32') {
		return 'java';
	}
	return console ? 'java.exe' : 'javaw.exe';
}

/**
 * Какая Java нужна установке EDT: строка `-Dosgi.requiredJavaVersion` в `1cedt.ini`.
 *
 * @param ini - Текст `1cedt.ini`
 * @returns Старший номер Java либо undefined, если требования нет
 */
export function requiredJavaFeature(ini: string): number | undefined {
	const match = ini.match(/-Dosgi\.requiredJavaVersion=(\d+)/);
	if (!match) {
		return undefined;
	}
	const feature = Number.parseInt(match[1], 10);
	return Number.isFinite(feature) ? feature : undefined;
}

/**
 * Путь стартера из команды обработчика схемы `e1cedt` в реестре Windows.
 *
 * @param output - Вывод `reg query HKCR\e1cedt\shell\open\command /ve`
 * @returns Путь к exe или undefined, если схема не зарегистрирована
 */
export function edtStartFromRegistryOutput(output: string): string | undefined {
	const match = output.match(/REG_SZ\s+"([^"]+1cedtstart\.exe)"/i);
	return match?.[1];
}

/**
 * Стартер в каталогах компонентов: `1c-edt-start-<версия>/1cedtstart`.
 *
 * @param roots - Каталоги компонентов
 * @param platform - Операционная система
 * @param exists - Проверка файла (в тестах подменяется)
 * @returns Пути найденных стартеров, старшая версия первой
 */
export function edtStartInComponents(
	roots: readonly string[],
	platform: NodeJS.Platform = process.platform,
	exists: (filePath: string) => boolean = fs.existsSync
): string[] {
	const found: string[] = [];
	for (const root of roots) {
		const candidates = subdirectoryNames(root)
			.filter((name) => name.startsWith('1c-edt-start-'))
			.map((name) => path.join(root, name, edtStartFileName(platform)))
			.filter((candidate) => exists(candidate))
			.sort((left, right) => right.localeCompare(left, 'en'));
		found.push(...candidates);
	}
	return found;
}

/**
 * Путь из строки `-vm` в ini Eclipse.
 *
 * Строка должна идти до `-vmargs`: так лаунчер отличает свою Java от аргументов JVM.
 * В значении каталог `bin` или сам исполняемый файл.
 *
 * @param ini - Текст `1cedtstart.ini` или `1cedt.ini`
 * @returns Путь либо undefined, если строки нет
 */
export function vmFromIni(ini: string): string | undefined {
	const lines = ini.split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index].trim();
		if (line === '-vmargs') {
			return undefined;
		}
		if (line === '-vm') {
			const next = lines[index + 1]?.trim();
			return next && !next.startsWith('-') ? next : undefined;
		}
		if (line.startsWith('-vm ')) {
			const value = line.slice('-vm '.length).trim();
			return value.length > 0 ? value : undefined;
		}
	}
	return undefined;
}

/**
 * Вставляет `-vm` перед `-vmargs`, если строки ещё нет.
 *
 * `1cedtcli` читает Java только из ini. Тот же ключ в команде он отдаёт в Java.
 *
 * @param ini - Текст ini
 * @param bin - Каталог `bin` нужной Java
 * @returns Текст с одной строкой `-vm`
 */
export function iniWithVm(ini: string, bin: string): string {
	if (vmFromIni(ini)) {
		return ini;
	}
	return iniInsertVm(ini, bin);
}

/**
 * Ставит `-vm` на каталог `bin`: существующую строку заменяет.
 *
 * Копия ini нужна `1cedtcli`: ключ `-vm` в команде он отдаёт в Java, а общий файл установки не переписывается.
 *
 * @param ini - Текст ini
 * @param bin - Каталог `bin` нужной Java
 * @returns Текст с одной строкой `-vm`
 */
export function iniSetVm(ini: string, bin: string): string {
	const nl = ini.includes('\r\n') ? '\r\n' : '\n';
	const lines = ini.split(/\r?\n/);
	const vmargs = lines.findIndex((line) => line.trim() === '-vmargs');
	const limit = vmargs < 0 ? lines.length : vmargs;
	for (let index = 0; index < limit; index++) {
		const line = lines[index].trim();
		if (line === '-vm') {
			const next = lines[index + 1];
			if (next !== undefined && !next.trim().startsWith('-')) {
				lines[index + 1] = bin;
			} else {
				lines.splice(index + 1, 0, bin);
			}
			return lines.join(nl);
		}
		if (line.startsWith('-vm ')) {
			lines.splice(index, 1, '-vm', bin);
			return lines.join(nl);
		}
	}
	return iniInsertVm(ini, bin);
}

/** Вставляет блок `-vm` перед `-vmargs`. */
function iniInsertVm(ini: string, bin: string): string {
	const nl = ini.includes('\r\n') ? '\r\n' : '\n';
	const block = `-vm${nl}${bin}${nl}`;
	const at = ini.search(/^-vmargs[ \t]*$/m);
	if (at < 0) {
		return ini.endsWith('\n') ? ini + block : `${ini}${nl}${block}`;
	}
	return ini.slice(0, at) + block + ini.slice(at);
}

/**
 * Исполняемый файл для окна стартера.
 *
 * В ini путь бывает каталогом `bin`. Стартеру в аргументах нужен `javaw`.
 *
 * @param vmPath - Путь из ini или из настроек стартера
 * @param platform - Операционная система
 * @param console - `java` для консоли, `javaw` для окна
 * @returns Путь к исполняемому файлу
 */
export function javaExecutable(vmPath: string, platform: NodeJS.Platform = process.platform, console = true): string {
	const joiner = platform === 'win32' ? path.win32 : path.posix;
	const base = joiner.basename(vmPath).toLowerCase();
	if (base === 'java' || base === 'java.exe' || base === 'javaw.exe') {
		return vmPath;
	}
	return joiner.join(vmPath, javaFileName(platform, console));
}

/**
 * Java лаунчера: файл из `-vm` в ini, иначе версия из `-Dosgi.requiredJavaVersion`.
 *
 * @param ini - Текст ini продукта; без `-vm` и без номера версии Java не выбирается
 * @param preferencesJson - Содержимое `preferences.json` стартера
 * @param console - `java` для `1cedtcli`, `javaw` для окна стартера
 * @param platform - Операционная система
 * @param exists - Проверка файла (в тестах подменяется)
 * @returns Путь к исполняемому файлу или undefined
 */
export function launcherJava(
	ini: string | undefined,
	preferencesJson: string | undefined,
	console: boolean,
	platform: NodeJS.Platform = process.platform,
	exists: (filePath: string) => boolean = fs.existsSync
): string | undefined {
	const pinned = ini === undefined ? undefined : vmFromIni(ini);
	if (pinned) {
		const exe = javaExecutable(pinned, platform, console);
		return exists(exe) ? exe : undefined;
	}
	const required = ini === undefined ? undefined : requiredJavaFeature(ini);
	if (required === undefined || preferencesJson === undefined) {
		return undefined;
	}
	return jvmOfFeature(preferencesJson, required, platform, exists, console);
}

/**
 * Java нужной версии из настроек 1C:EDT Start.
 *
 * `java` с консолью — для `1cedtcli`, чтобы вывод попал в задачу. `javaw` — для окна стартера.
 *
 * @param preferencesJson - Содержимое `preferences.json`
 * @param feature - Старший номер Java, как в ini
 * @param platform - Операционная система
 * @param exists - Проверка файла (в тестах подменяется)
 * @param console - Брать `java`, а не `javaw`
 * @returns Путь к Java или undefined
 */
export function jvmOfFeature(
	preferencesJson: string,
	feature: number,
	platform: NodeJS.Platform = process.platform,
	exists: (filePath: string) => boolean = fs.existsSync,
	console = true
): string | undefined {
	const info = jvmInfoOf(preferencesJson);
	if (!info) {
		return undefined;
	}
	return jvmCandidates(info, platform, console, exists)
		.find((candidate) => candidate.feature === feature)?.java;
}

/**
 * Старшие номера Java, записанные в настройках 1C:EDT Start.
 *
 * @param preferencesJson - Содержимое `preferences.json`
 * @returns Номера от старшего к младшему; пусто, если настроек нет
 */
export function recordedJavaFeatures(preferencesJson: string): number[] {
	const info = jvmInfoOf(preferencesJson);
	if (!info) {
		return [];
	}
	return Object.keys(info)
		.map((key) => Number.parseInt(key, 10))
		.filter((feature) => Number.isFinite(feature))
		.sort((left, right) => right - left);
}

/** `jvmInfo` из настроек стартера. */
function jvmInfoOf(preferencesJson: string): Record<string, unknown> | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(preferencesJson);
	} catch {
		return undefined;
	}
	const info = (parsed as { jvmInfo?: unknown } | null)?.jvmInfo;
	if (typeof info !== 'object' || info === null) {
		return undefined;
	}
	return info as Record<string, unknown>;
}

/** Записанные в настройках стартера JVM, от старшей версии к младшей. */
function jvmCandidates(
	info: Record<string, unknown>,
	platform: NodeJS.Platform,
	console: boolean,
	exists: (filePath: string) => boolean
): { feature: number; java: string }[] {
	const candidates: { feature: number; java: string }[] = [];
	const joiner = platform === 'win32' ? path.win32 : path.posix;
	const names = platform === 'win32' && console
		? [javaFileName(platform, true), javaFileName(platform, false)]
		: [javaFileName(platform, console)];
	for (const [key, value] of Object.entries(info)) {
		const jvmPath = (value as { jvmPath?: unknown } | null)?.jvmPath;
		if (typeof jvmPath !== 'string') {
			continue;
		}
		const bin = fileUrlToPath(jvmPath, platform);
		const java = names.map((name) => joiner.join(bin, name)).find((file) => exists(file));
		if (java) {
			candidates.push({ feature: Number.parseInt(key, 10) || 0, java });
		}
	}
	candidates.sort((left, right) => right.feature - left.feature);
	return candidates;
}

/**
 * Аргументы стартера: своя JVM и ссылка, если она есть.
 *
 * На Windows запуск идёт через `cmd /c start`, поэтому путь и ссылка берутся в
 * кавычки сами: амперсанды ссылки иначе разрезали бы команду.
 *
 * @param url - Ссылка `e1cedt://start/open?...`; без неё стартер открывает своё окно
 * @param jvm - Путь к Java стартера; без неё стартер ищет Java сам
 * @param platform - Операционная система
 */
export function edtStartArgs(url: string | undefined, jvm: string | undefined, platform: NodeJS.Platform = process.platform): string[] {
	const quote = (value: string): string => (platform === 'win32' ? `"${value}"` : value);
	return [...(jvm ? ['-vm', quote(jvm)] : []), ...(url ? [quote(url)] : [])];
}

/** Зависимости запуска: в тестах подменяются. */
export interface LaunchEdtStartDeps {
	readonly platform?: NodeJS.Platform;
	readonly registryQuery?: () => string;
	readonly componentRoots?: readonly string[];
	readonly preferencesPath?: string;
	readonly readFile?: (filePath: string) => string | undefined;
	readonly exists?: (filePath: string) => boolean;
	readonly spawn?: (command: string, args: readonly string[]) => void;
}

/** Исход запуска стартера. */
export type LaunchEdtStartResult =
	| { readonly ok: true; readonly binary: string; readonly args: readonly string[] }
	| { readonly ok: false; readonly message: string };

function queryRegistry(): string {
	try {
		return execFileSync('reg', ['query', 'HKCR\\e1cedt\\shell\\open\\command', '/ve'], {
			encoding: 'utf8',
			windowsHide: true,
		});
	} catch {
		return '';
	}
}

function readText(filePath: string): string | undefined {
	try {
		return fs.readFileSync(filePath, 'utf8');
	} catch {
		return undefined;
	}
}

/**
 * Находит стартер: на Windows по обработчику схемы в реестре, иначе по каталогам компонентов.
 *
 * На macOS в каталоге компонентов лежит пакет `.app` с версией в имени, а не
 * исполняемый файл, поэтому там стартер не ищется.
 *
 * @param deps - Зависимости поиска
 * @returns Путь к стартеру или undefined
 */
export function findEdtStart(deps: LaunchEdtStartDeps = {}): string | undefined {
	const platform = deps.platform ?? process.platform;
	const exists = deps.exists ?? fs.existsSync;
	if (platform === 'darwin') {
		return undefined;
	}
	if (platform === 'win32') {
		const fromRegistry = edtStartFromRegistryOutput((deps.registryQuery ?? queryRegistry)());
		if (fromRegistry && exists(fromRegistry)) {
			return fromRegistry;
		}
	}
	return edtStartInComponents(deps.componentRoots ?? edtComponentRoots(platform), platform, exists)[0];
}

/**
 * Запускает 1cedtstart: по ссылке базы или просто его окно с проектами.
 *
 * @param url - Ссылка `e1cedt://start/open?...`; без неё открывается окно стартера
 * @param deps - Поиск стартера и запуск процесса
 * @returns Успех с командой либо сообщение, почему не вышло
 */
export function launchEdtStart(url?: string, deps: LaunchEdtStartDeps = {}): LaunchEdtStartResult {
	if (untrustedWorkspaceBlocks('окно 1C:EDT Start')) {
		return { ok: false, message: WORKSPACE_TRUST_REQUIRED };
	}
	const platform = deps.platform ?? process.platform;
	const exists = deps.exists ?? fs.existsSync;
	const binary = findEdtStart(deps);
	if (!binary) {
		return {
			ok: false,
			message:
				platform === 'darwin'
					? 'На macOS расширение не открывает 1C:EDT Start: запустите его сами.'
					: '1cedtstart не найден: установите 1С:EDT через него.',
		};
	}
	const read = deps.readFile ?? readText;
	const jvm = launcherJava(
		read(path.join(path.dirname(binary), '1cedtstart.ini')),
		read(deps.preferencesPath ?? path.join(edtStartDataDirectory(platform), 'preferences.json')),
		false,
		platform,
		exists
	);
	const args = edtStartArgs(url, jvm, platform);
	(deps.spawn ?? ((command, spawnArgs) => spawnDetached(command, spawnArgs, undefined, platform)))(binary, args);
	return { ok: true, binary, args };
}
