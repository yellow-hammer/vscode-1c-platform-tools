/**
 * Загрузка onec-debug-adapter (DAP) с GitHub Releases в рантайме — тем же механизмом, что и md-sparrow
 * (см. {@link githubReleaseLoader}).
 * @module onecDebugAdapterBootstrap
 */

import * as vscode from 'vscode';
import * as fssync from 'node:fs';
import { globSync } from 'glob';
import { logger } from '../../shared/logger';
import {
	type ReleaseComponentSpec,
	checkReleaseUpdateInBackground,
	clearReleaseCache,
	ensureReleaseComponent,
	installBaseDir,
	resolveGithubToken,
} from '../../shared/githubReleaseLoader';

/** Главный исполняемый файл адаптера внутри релизного архива. */
export const ONEC_DEBUG_ADAPTER_DLL = 'OnecDebugAdapter.dll';

const ONEC_DEBUG_ADAPTER_SPEC: ReleaseComponentSpec = {
	repoSlug: 'yellow-hammer/onec-debug-adapter',
	cacheSubdir: 'onec-debug-adapter',
	stampName: '.dap-info.json',
	assetRegex: /^onec-debug-adapter-.*\.zip$/i,
	label: 'onec-debug-adapter',
	extract: true,
};

export interface OnecDebugAdapterRuntime {
	/** Полный путь к OnecDebugAdapter.dll */
	dllPath: string;
	/** Тег релиза (если скачан с GitHub) */
	releaseTag?: string;
}

function findDllUnder(root: string): string | undefined {
	const hits = globSync(`**/${ONEC_DEBUG_ADAPTER_DLL}`, { cwd: root, absolute: true, nocase: true });
	for (const p of hits) {
		try {
			if (fssync.statSync(p).isFile()) {
				return p;
			}
		} catch {
			/* skip */
		}
	}
	return undefined;
}

/**
 * Гарантирует наличие onec-debug-adapter согласно настройкам расширения.
 *
 * @throws Error если автозагрузка выключена и не задан debug.adapterFile, либо dll не найдена.
 */
export async function ensureOnecDebugAdapter(context: vscode.ExtensionContext): Promise<OnecDebugAdapterRuntime> {
	const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
	const override = cfg.get<string>('debug.adapterFile', '').trim();
	if (override) {
		if (override.includes('${')) {
			throw new Error('debug.adapterFile: укажите полный путь к OnecDebugAdapter.dll.');
		}
		if (!fssync.existsSync(override)) {
			throw new Error(`debug.adapterFile не найден: ${override}.`);
		}
		return { dllPath: override };
	}
	if (!cfg.get<boolean>('debug.autoloadAdapter', true)) {
		throw new Error('Укажите debug.adapterFile или включите debug.autoloadAdapter.');
	}

	const ensured = await ensureReleaseComponent(installBaseDir(context), ONEC_DEBUG_ADAPTER_SPEC, resolveGithubToken());
	const dll = findDllUnder(ensured.assetPath);
	if (!dll) {
		throw new Error(`В релизе onec-debug-adapter ${ensured.tag} не найден ${ONEC_DEBUG_ADAPTER_DLL}.`);
	}
	logger.info(`onec-debug-adapter: ${dll} (${ensured.tag})`);
	return { dllPath: dll, releaseTag: ensured.tag };
}

/** Фоновая проверка нового релиза адаптера (чистит кэш, чтобы следующий запуск скачал свежий). */
export function checkOnecDebugAdapterUpdateInBackground(context: vscode.ExtensionContext): void {
	const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
	if (cfg.get<string>('debug.adapterFile', '').trim()) {
		return;
	}
	if (!cfg.get<boolean>('debug.autoloadAdapter', true)) {
		return;
	}
	checkReleaseUpdateInBackground(installBaseDir(context), ONEC_DEBUG_ADAPTER_SPEC, resolveGithubToken(), () => {
		/* кэш очищен; следующий запуск отладки скачает новую версию */
	});
}

/** Сброс кэша адаптера — следующий запуск отладки скачает заново. */
export async function clearOnecDebugAdapterCache(context: vscode.ExtensionContext): Promise<void> {
	await clearReleaseCache(installBaseDir(context), ONEC_DEBUG_ADAPTER_SPEC);
}
