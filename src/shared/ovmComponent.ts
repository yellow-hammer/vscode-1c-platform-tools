/**
 * OVM как загружаемый компонент: скачивается из релизов GitHub в кэш расширения и берётся оттуда.
 *
 * Раньше `ovm.exe` качался во временный каталог при каждой установке OneScript, а на Linux и macOS
 * ещё и через `curl` прямо в терминале. Теперь загрузка отделена от использования: файл лежит в
 * globalStorage рядом с остальными компонентами, обновляется при выходе новой версии и доступен
 * для проверки.
 * @module ovmComponent
 */
import * as vscode from 'vscode';
import {
	cachedReleaseTag,
	clearReleaseCache,
	ensureReleaseComponent,
	installBaseDir,
	resolveGithubToken,
	type ReleaseComponentSpec,
} from './githubReleaseLoader';

/** Релизы OVM: в каждом лежит один и тот же `ovm.exe` (на Linux и macOS запускается через Mono). */
const OVM_SPEC: ReleaseComponentSpec = {
	repoSlug: 'oscript-library/ovm',
	cacheSubdir: 'ovm',
	stampName: '.ovm.json',
	assetRegex: /^ovm\.exe$/i,
	label: 'OVM',
	extract: false,
};

/**
 * Путь к `ovm.exe` из кэша; при необходимости загружает или обновляет его.
 *
 * @param context контекст расширения (кэш живёт в globalStorage)
 * @returns абсолютный путь к файлу
 */
export async function ensureOvm(context: vscode.ExtensionContext): Promise<string> {
	const ensured = await ensureReleaseComponent(installBaseDir(context), OVM_SPEC, resolveGithubToken());
	return ensured.assetPath;
}

/** Тег загруженного OVM или undefined, если он ещё не загружался. */
export async function cachedOvmTag(context: vscode.ExtensionContext): Promise<string | undefined> {
	return cachedReleaseTag(installBaseDir(context), OVM_SPEC);
}

/** Забывает загруженный OVM: следующее использование скачает его заново. */
export async function clearOvmCache(context: vscode.ExtensionContext): Promise<void> {
	await clearReleaseCache(installBaseDir(context), OVM_SPEC);
}
