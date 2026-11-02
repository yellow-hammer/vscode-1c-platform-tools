/**
 * Пакет OneScript проекта: сборка и установка собранного пакета.
 *
 * `opm build` собирает `<Имя>-<Версия>.ospx` в каталог сборки (`build/out/ospx`
 * по умолчанию). Установка — `opm install -f` в движок проекта.
 *
 * Человеку команды запускают opm задачей VS Code. Агент с `wait: true` получает
 * код возврата и вывод, у сборки ещё и путь к пакету.
 * @module packageCommands
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { BaseCommand } from './baseCommand';
import { getBuildPackageCommandName, getInstallPackageCommandName, getPushPackageCommandName } from '../features/tools/commandNames';
import type { CommandExecutionOptions, StructuredCommandResult } from '../shared/commandExecutionTypes';
import { readPackageManifest } from '../shared/oneScriptLayout';
import { PACKAGE_EXTENSION, packageFileName } from '../shared/packagedef';
import { BUILD_SUBDIRS } from '../shared/pathDefaults';
import { ensureWorkspaceTrusted } from '../shared/workspaceTrust';

/**
 * Файл пакета из аргумента команды: путь, Uri или узел дерева артефактов.
 *
 * @param target - Первый аргумент команды
 * @returns Абсолютный путь к `.ospx` или undefined
 */
export function packageFileArgument(target: unknown): string | undefined {
	let file: string | undefined;
	if (typeof target === 'string') {
		file = target.trim();
	} else if (target instanceof vscode.Uri) {
		file = target.scheme === 'file' ? target.fsPath : undefined;
	} else if (typeof target === 'object' && target !== null) {
		const uri = (target as { resourceUri?: unknown }).resourceUri;
		file = uri instanceof vscode.Uri && uri.scheme === 'file' ? uri.fsPath : undefined;
	}
	return file && path.extname(file).toLowerCase() === PACKAGE_EXTENSION ? path.resolve(file) : undefined;
}

/**
 * Проект из аргумента команды: узел исходника в дереве артефактов несёт корень своего проекта.
 *
 * @param target - Первый аргумент команды
 * @returns Корень проекта или undefined, тогда команда идёт в текущем проекте
 */
export function packageProjectArgument(target: unknown): string | undefined {
	const root = typeof target === 'object' && target !== null ? (target as { projectRoot?: unknown }).projectRoot : undefined;
	return typeof root === 'string' ? root : undefined;
}

/**
 * Собранные пакеты каталога, новые первыми.
 *
 * @param dir - Каталог собранных пакетов
 * @param since - Только файлы, изменённые не раньше этого времени, мс
 * @returns Абсолютные пути
 */
async function builtPackages(dir: string, since = 0): Promise<string[]> {
	let names: string[];
	try {
		names = await fs.readdir(dir);
	} catch {
		return [];
	}
	const files = names.filter((name) => path.extname(name).toLowerCase() === PACKAGE_EXTENSION).map((name) => path.join(dir, name));
	const stamped = await Promise.all(
		files.map(async (file) => ({ file, mtimeMs: (await fs.stat(file).catch(() => undefined))?.mtimeMs ?? 0 }))
	);
	return stamped
		.filter((item) => item.mtimeMs >= since)
		.sort((left, right) => right.mtimeMs - left.mtimeMs)
		.map((item) => item.file);
}

/** Ответ агенту, когда OneScript нет. */
const ONESCRIPT_NOT_FOUND = 'OneScript (oscript) или opm не найдены';

/** Время записи файла грубее часов: пакет, записанный в ту же секунду, что начало сборки, тоже её. */
const MTIME_TOLERANCE_MS = 2000;

/**
 * Команды пакета OneScript.
 */
export class PackageCommands extends BaseCommand {
	/**
	 * Каталог собранных пакетов проекта.
	 *
	 * @param root - Корень проекта
	 */
	packagesDirectory(root: string): string {
		return path.resolve(root, this.vrunner.getOutPath(), BUILD_SUBDIRS.packages);
	}

	/**
	 * Собирает пакет: `opm build -o <каталог сборки>` в корне проекта.
	 *
	 * @param opts - Опции вызова; с `wait: true` сборка ждётся и возвращается её исход
	 * @returns Исход сборки и путь к пакету при `wait: true`
	 */
	async buildPackage(opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		if (!ensureWorkspaceTrusted('сборка пакета OneScript')) {
			return;
		}
		const root = this.ensureWorkspace();
		if (!root) {
			return this.rejectIfWait(opts, 'Откройте рабочую область с проектом OneScript');
		}
		if (!(await this.ensureLocalOscriptForExecution(opts))) {
			return this.rejectIfWait(opts, ONESCRIPT_NOT_FOUND);
		}
		const outDir = this.packagesDirectory(root);
		const noDirectory = `Не удалось создать каталог сборки ${outDir}`;
		if (!(await this.ensureDirectoryForExecution(outDir, opts, noDirectory))) {
			return this.rejectIfWait(opts, noDirectory);
		}
		const args = ['build', '-o', outDir];
		if (opts?.wait !== true) {
			this.vrunner.executeOpmInTerminal(args, { cwd: root, name: getBuildPackageCommandName().title });
			return;
		}
		const startedAt = Date.now() - MTIME_TOLERANCE_MS;
		const result = await this.vrunner.executeOpm(args, { cwd: root });
		const [built] = result.success ? await builtPackages(outDir, startedAt) : [];
		return this.vrunnerResultToStructured(result, built);
	}

	/**
	 * Ставит собранный пакет в движок проекта: `opm install -f <файл>`.
	 *
	 * Без файла берёт собранный пакет из каталога сборки, при нескольких
	 * спрашивает, какой; пакет текущей версии из packagedef стоит первым.
	 *
	 * @param file - Файл пакета; без него пакет из каталога сборки
	 * @param opts - Опции агента: вопросов нет, с `wait: true` установка ждётся; без них вызов человека
	 * @returns Исход установки при `wait: true`
	 */
	async installPackage(file?: string, opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		if (!ensureWorkspaceTrusted('установка пакета OneScript')) {
			return;
		}
		const root = this.ensureWorkspace();
		if (!root) {
			return this.rejectIfWait(opts, 'Откройте рабочую область с проектом OneScript');
		}
		if (!(await this.ensureLocalOscriptForExecution(opts))) {
			return this.rejectIfWait(opts, ONESCRIPT_NOT_FOUND);
		}
		const target = file ?? (opts === undefined ? await this.pickPackageFile(root) : await this.pickBuiltPackage(root));
		if (target === undefined) {
			return this.rejectIfWait(opts, 'Пакет не выбран');
		}
		const args = ['install', '-f', target];
		if (opts?.wait !== true) {
			this.vrunner.executeOpmInTerminal(args, { cwd: root, name: `${getInstallPackageCommandName().title} ${path.basename(target)}` });
			return;
		}
		return this.vrunnerResultToStructured(await this.vrunner.executeOpm(args, { cwd: root }), target);
	}

	/**
	 * Публикует собранный пакет: `opm push <файл>` в каталоге этого файла.
	 *
	 * Токен и канал opm берёт из окружения запуска: `GITHUB_OAUTH_TOKEN`, `OPM_HUB_CHANNEL`.
	 *
	 * @param file - Файл пакета; без него пакет из каталога сборки
	 * @param opts - Опции агента: вопросов нет, с `wait: true` публикация ждётся; без них вызов человека
	 * @returns Исход публикации при `wait: true`
	 */
	async pushPackage(file?: string, opts?: CommandExecutionOptions): Promise<StructuredCommandResult | void> {
		if (!ensureWorkspaceTrusted('публикация пакета OneScript')) {
			return;
		}
		const root = this.ensureWorkspace();
		if (!root) {
			return this.rejectIfWait(opts, 'Откройте рабочую область с проектом OneScript');
		}
		if (!(await this.ensureLocalOscriptForExecution(opts))) {
			return this.rejectIfWait(opts, ONESCRIPT_NOT_FOUND);
		}
		const target = file ?? (opts === undefined
			? await this.pickPackageFile(root, getPushPackageCommandName().title, 'Опубликовать')
			: await this.pickBuiltPackage(root));
		if (target === undefined) {
			return this.rejectIfWait(opts, 'Пакет не выбран');
		}
		const args = ['push', path.basename(target)];
		const cwd = path.dirname(target);
		if (opts?.wait !== true) {
			this.vrunner.executeOpmInTerminal(args, { cwd, name: getPushPackageCommandName().title });
			return;
		}
		return this.vrunnerResultToStructured(await this.vrunner.executeOpm(args, { cwd }), target);
	}

	/**
	 * Файл пакета из каталога сборки. Диалог открывается там же, откуда грузят dt.
	 *
	 * @param root - Корень проекта
	 * @returns Путь к пакету или undefined, если выбор отменён
	 */
	private async pickPackageFile(root: string, title = getInstallPackageCommandName().title, openLabel = 'Установить'): Promise<string | undefined> {
		const selected = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			defaultUri: vscode.Uri.file(this.packagesDirectory(root)),
			openLabel,
			title,
			filters: { 'Пакеты OneScript': ['ospx'] },
		});
		return selected?.[0]?.fsPath;
	}

	/**
	 * Собранный пакет из каталога сборки для вызова без окна.
	 *
	 * @param root - Корень проекта
	 * @returns Путь к пакету или undefined, если пакета нет
	 */
	private async pickBuiltPackage(root: string): Promise<string | undefined> {
		const files = await builtPackages(this.packagesDirectory(root));
		const manifest = readPackageManifest(root);
		const current = manifest === undefined ? undefined : packageFileName(manifest);
		return files.find((file) => path.basename(file) === current) ?? files[0];
	}
}
