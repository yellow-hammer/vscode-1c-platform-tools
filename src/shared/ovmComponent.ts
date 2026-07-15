/**
 * OVM как загружаемый компонент: скачивается из релизов GitHub в кэш расширения и берётся оттуда.
 *
 * Раньше `ovm.exe` качался во временный каталог при каждой установке OneScript, а на Linux и macOS
 * ещё и через `curl` прямо в терминале. Теперь загрузка отделена от использования: файл лежит в
 * globalStorage рядом с остальными компонентами, обновляется при выходе новой версии и доступен
 * для проверки.
 * @module ovmComponent
 */
import * as fssync from 'node:fs';
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
 * Путь к `ovm.exe`: своя сборка из настроек либо кэш, который при необходимости загружается и обновляется.
 *
 * @param context контекст расширения (кэш живёт в globalStorage)
 * @returns абсолютный путь к файлу
 * @throws Error если автозагрузка выключена и не задан components.ovmFile, либо файл не найден.
 */
export async function ensureOvm(context: vscode.ExtensionContext): Promise<string> {
	const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
	const override = cfg.get<string>('components.ovmFile', '').trim();
	if (override) {
		if (override.includes('${')) {
			throw new Error('components.ovmFile: укажите полный путь к ovm.exe.');
		}
		if (!fssync.existsSync(override)) {
			throw new Error(`components.ovmFile не найден: ${override}.`);
		}
		return override;
	}
	if (!cfg.get<boolean>('components.ovmAutoload', true)) {
		throw new Error('Укажите components.ovmFile или включите components.ovmAutoload.');
	}

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
