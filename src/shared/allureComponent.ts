/**
 * Allure как загружаемый компонент: командная строка отчётов берётся из релизов
 * GitHub и лежит в кэше расширения рядом с остальными компонентами.
 *
 * Раньше путь к `allure` задавался настройкой и по умолчанию искался в PATH:
 * без установленного Allure команда молча уходила в терминал и падала там.
 * Теперь работает та же схема, что у OVM, md-sparrow и адаптера отладки:
 * свой путь из настроек, иначе загрузка релиза в globalStorage.
 * @module allureComponent
 */
import * as fssync from 'node:fs';
import * as path from 'node:path';
import { globSync } from 'glob';
import * as vscode from 'vscode';
import {
	cachedReleaseComponent,
	cachedReleaseTag,
	clearReleaseCache,
	ensureReleaseComponent,
	installBaseDir,
	resolveGithubToken,
	type ReleaseComponentSpec,
} from './githubReleaseLoader';

/**
 * Релизы Allure: нужен архив `allure-<версия>.zip`, внутри которого лежит
 * каталог с `bin/allure` и `bin/allure.bat`.
 */
const ALLURE_SPEC: ReleaseComponentSpec = {
	repoSlug: 'allure-framework/allure2',
	cacheSubdir: 'allure',
	stampName: '.allure.json',
	assetRegex: /^allure-\d+(\.\d+)*\.zip$/i,
	label: 'Allure',
	extract: true,
};

/** Имя запускаемого файла Allure для текущей системы. */
function allureBinaryName(): string {
	return process.platform === 'win32' ? 'allure.bat' : 'allure';
}

/**
 * Ищет запускаемый файл Allure в распакованном релизе.
 *
 * @param extractRoot - Каталог распаковки архива
 * @returns Абсолютный путь к файлу или undefined
 */
export function findAllureBinary(extractRoot: string): string | undefined {
	const hits = globSync(`**/bin/${allureBinaryName()}`, {
		cwd: extractRoot,
		absolute: true,
		nocase: process.platform === 'win32',
	});
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
 * Путь к запускаемому файлу Allure: своя установка из настроек либо кэш,
 * который при необходимости загружается и обновляется.
 *
 * @param context - Контекст расширения (кэш живёт в globalStorage)
 * @returns Абсолютный путь к `allure` или имя команды для поиска в PATH
 * @throws Error если автозагрузка выключена, а свой путь не задан или неверен
 */
export async function ensureAllure(context: vscode.ExtensionContext): Promise<string> {
	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	const override = config.get<string>('allure.path', '').trim();
	// «allure» - историческое значение по умолчанию: означает поиск в PATH,
	// своей установкой не считается
	if (override && override !== 'allure') {
		if (override.includes('${')) {
			throw new Error('1c-platform-tools.allure.path: укажите полный путь к allure.');
		}
		if (path.isAbsolute(override) && !fssync.existsSync(override)) {
			throw new Error(`1c-platform-tools.allure.path не найден: ${override}.`);
		}
		return override;
	}

	if (!config.get<boolean>('components.allureAutoload', true)) {
		// автозагрузка выключена намеренно: берём загруженный ранее или из комплекта, иначе PATH
		const cached = await cachedReleaseComponent(installBaseDir(context), ALLURE_SPEC);
		return (cached ? findAllureBinary(cached.assetPath) : undefined) ?? 'allure';
	}

	const ensured = await ensureReleaseComponent(installBaseDir(context), ALLURE_SPEC, resolveGithubToken());
	const binary = findAllureBinary(ensured.assetPath);
	if (!binary) {
		throw new Error(
			`В релизе Allure ${ensured.tag} не найден ${allureBinaryName()}. ` +
			'Укажите свой путь настройкой 1c-platform-tools.allure.path.'
		);
	}
	return binary;
}

/**
 * Загружает Allure, не глядя на `allure.path` и `components.allureAutoload`.
 *
 * @param context - Контекст расширения
 * @returns Путь к загруженному каталогу релиза
 */
export async function downloadAllure(context: vscode.ExtensionContext): Promise<string> {
	const ensured = await ensureReleaseComponent(installBaseDir(context), ALLURE_SPEC, resolveGithubToken());
	return ensured.assetPath;
}

/** Тег загруженного Allure или undefined, если он ещё не загружался. */
export async function cachedAllureTag(context: vscode.ExtensionContext): Promise<string | undefined> {
	return cachedReleaseTag(installBaseDir(context), ALLURE_SPEC);
}

/** Путь Allure в кэше; undefined — не загружен. */
export async function cachedAllurePath(context: vscode.ExtensionContext): Promise<string | undefined> {
	return (await cachedReleaseComponent(installBaseDir(context), ALLURE_SPEC))?.assetPath;
}

/** Удаляет кэш Allure: следующая команда загрузит его заново. */
export async function clearAllureCache(context: vscode.ExtensionContext): Promise<void> {
	await clearReleaseCache(installBaseDir(context), ALLURE_SPEC);
}
