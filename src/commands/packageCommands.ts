/**
 * Пакет OneScript проекта: сборка и установка собранного пакета.
 *
 * `opm build` собирает пакет по `packagedef` в каталог сборки проекта
 * (`build/out/ospx` по умолчанию) под именем `<Имя>-<Версия>.ospx`. Собранный
 * файл ставится в движок проекта командой `opm install -f`: так его проверяют
 * так же, как пакет из хаба. Публикацию `opm push` расширение не делает: ей
 * нужен токен хаба, а канал выпуска opm выбирает по ветке, это шаг CI.
 *
 * Человеку команды запускают opm задачей VS Code. Агент с `wait: true` получает
 * исход: код возврата и вывод opm, у сборки ещё и путь к собранному пакету.
 * @module packageCommands
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { BaseCommand } from './baseCommand';
import { getBuildPackageCommandName, getInstallPackageCommandName } from '../features/tools/commandNames';
import type { CommandExecutionOptions, StructuredCommandResult } from '../shared/commandExecutionTypes';
import { logger } from '../shared/logger';
import { readPackageManifest } from '../shared/oneScriptLayout';
import { PACKAGE_EXTENSION, packageFileName } from '../shared/packagedef';
import { BUILD_SUBDIRS } from '../shared/pathDefaults';
import { ensureWorkspaceTrusted } from '../shared/workspaceTrust';

const log = logger.scope('commands');

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
 * Проект из аргумента команды: раздел «Пакеты» дерева артефактов несёт корень своего проекта.
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
		const target = file ?? (await this.pickBuiltPackage(root, opts === undefined));
		if (target === undefined) {
			return this.rejectIfWait(opts, `Собранного пакета нет в ${this.packagesDirectory(root)}: сначала соберите его`);
		}
		if (!(await this.ensureLocalOscriptForExecution(opts))) {
			return this.rejectIfWait(opts, ONESCRIPT_NOT_FOUND);
		}
		const args = ['install', '-f', target];
		if (opts?.wait !== true) {
			this.vrunner.executeOpmInTerminal(args, { cwd: root, name: `${getInstallPackageCommandName().title} ${path.basename(target)}` });
			return;
		}
		return this.vrunnerResultToStructured(await this.vrunner.executeOpm(args, { cwd: root }), target);
	}

	/**
	 * Собранный пакет из каталога сборки.
	 *
	 * @param root - Корень проекта
	 * @param ask - Спросить, если пакетов несколько; иначе берётся первый
	 * @returns Путь к пакету или undefined, если пакета нет или выбор отменён
	 */
	private async pickBuiltPackage(root: string, ask: boolean): Promise<string | undefined> {
		const files = await builtPackages(this.packagesDirectory(root));
		if (files.length === 0) {
			log.warn(`Собранного пакета нет в ${this.packagesDirectory(root)}`);
			if (!ask) {
				return undefined;
			}
			const build = getBuildPackageCommandName().title;
			const answer = await vscode.window.showInformationMessage('Собранного пакета нет.', build);
			if (answer === build) {
				await vscode.commands.executeCommand('1c-platform-tools.package.build');
			}
			return undefined;
		}
		const manifest = readPackageManifest(root);
		const current = manifest === undefined ? undefined : packageFileName(manifest);
		const ordered = [
			...files.filter((file) => path.basename(file) === current),
			...files.filter((file) => path.basename(file) !== current),
		];
		if (ordered.length === 1 || !ask) {
			return ordered[0];
		}
		const picked = await vscode.window.showQuickPick(
			ordered.map((file) => ({
				label: path.basename(file),
				description: path.basename(file) === current ? 'версия из packagedef' : undefined,
				file,
			})),
			{ title: getInstallPackageCommandName().title, placeHolder: 'Собранный пакет' }
		);
		return picked?.file;
	}
}
