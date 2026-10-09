/**
 * Чтение обоих файлов профилей, наблюдатель и последняя удачная загрузка.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { readGitBranchDirName } from '../../../shared/gitHead';
import { projectMemento, ONESCRIPT_TEST_PROFILE_STATE } from '../../../shared/projectState';
import { detectProjectKind } from '../../../shared/projectKind';
import type { VRunnerManager } from '../../../shared/vrunnerManager';
import {
	nextOnescriptProfilesLoad,
	ONESCRIPT_TESTS_FILE,
	ONESCRIPT_TESTS_LOCAL_FILE,
	parseOnescriptProfileFile,
	type OnescriptFileRead,
	type OnescriptProfileFile,
	type OnescriptProfilesLoad,
} from './profilesFile';
import { resolveOnescriptEnv, type ResolvedOnescriptEnv } from './resolveEnv';

/** Решение прогона: как раньше, окружение профиля или отказ. */
export type OnescriptRunDecision =
	| { kind: 'unchanged' }
	| ({ kind: 'env'; profileName: string } & ResolvedOnescriptEnv)
	| { kind: 'error'; message: string };

const EMPTY_FILE: OnescriptProfileFile = { env: {}, profiles: {} };

/**
 * Файлы профилей одного проекта.
 */
export class OnescriptProfileStore {
	private root: string | undefined;
	private load: OnescriptProfilesLoad = { file: EMPTY_FILE, hasFile: false };
	private watcher: vscode.FileSystemWatcher | undefined;
	private watcherSubscriptions: vscode.Disposable[] = [];
	private reloadChain: Promise<void> = Promise.resolve();
	private reloadPending = false;
	private generation = 0;

	constructor(
		private readonly vrunner: VRunnerManager,
		private readonly isBusy: () => boolean,
		private readonly onLoaded: () => void
	) {}

	/** Корень проекта, чьи файлы читаются. */
	projectRoot(): string | undefined {
		return this.root;
	}
	file(): OnescriptProfileFile {
		return this.load.file;
	}

	/** Текст ошибки, пока файл не исправлен. */
	broken(): string | undefined {
		return this.load.broken;
	}

	/** Запомненные имена. Пустой список — прогон без профиля. */
	names(): string[] {
		const root = this.root;
		if (root === undefined) {
			return [];
		}
		const value = projectMemento(root).get<unknown>(ONESCRIPT_TEST_PROFILE_STATE);
		if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
			return [];
		}
		return value;
	}

	/**
	 * Запоминает список, если он отличается от записанного.
	 *
	 * @param names - Имена профилей
	 */
	async remember(names: string[]): Promise<void> {
		const root = this.root;
		if (root === undefined || sameNames(this.names(), names)) {
			return;
		}
		await projectMemento(root).update(ONESCRIPT_TEST_PROFILE_STATE, names);
	}

	/**
	 * Переключает проект и перечитывает файлы.
	 *
	 * @param root - Корень проекта
	 */
	setRoot(root: string | undefined): void {
		this.root = root;
		this.scheduleReload();
	}

	/** После прогона дочитывает файл, если он менялся во время запуска. */
	flush(): void {
		if (this.reloadPending && !this.isBusy()) {
			this.reloadPending = false;
			void this.reload();
		}
	}

	/**
	 * Окружение для этого прогона.
	 *
	 * @param requested - Имя профиля этого запуска; без профиля не задано
	 */
	async decide(requested: string | undefined): Promise<OnescriptRunDecision> {
		if (!this.load.hasFile) {
			return { kind: 'unchanged' };
		}
		if (this.load.broken !== undefined) {
			return { kind: 'error', message: this.load.broken };
		}
		for (const name of this.names()) {
			if (this.load.file.profiles[name] === undefined) {
				return { kind: 'error', message: `Профиль ${name} не найден` };
			}
		}
		if (requested === undefined) {
			return { kind: 'unchanged' };
		}
		if (this.load.file.profiles[requested] === undefined) {
			return { kind: 'error', message: `Профиль ${requested} не найден` };
		}
		const root = this.root;
		if (root === undefined) {
			return { kind: 'unchanged' };
		}
		await this.vrunner.checkOscriptAvailable();
		const resolved = this.vrunner.getResolvedOscriptPath();
		const engineBinDir = resolved !== undefined && path.isAbsolute(resolved) ? path.dirname(resolved) : undefined;
		const result = resolveOnescriptEnv({
			processEnv: process.env,
			file: this.load.file,
			profileName: requested,
			gitBranch: readGitBranchDirName(root),
			engineBinDir,
		});
		if ('error' in result) {
			return { kind: 'error', message: result.error };
		}
		return { kind: 'env', profileName: requested, ...result };
	}

	/** Проект OneScript. */
	async isOnescriptProject(): Promise<boolean> {
		const root = this.root;
		return root !== undefined && (await detectProjectKind(root)) === 'onescript';
	}

	dispose(): void {
		this.disposeWatcher();
	}

	private scheduleReload(): void {
		if (this.isBusy()) {
			this.reloadPending = true;
			return;
		}
		void this.reload();
	}

	private reload(): Promise<void> {
		const task = this.reloadChain.then(() => this.loadNow());
		this.reloadChain = task.then(
			() => undefined,
			() => undefined
		);
		return task;
	}

	private async loadNow(): Promise<void> {
		const generation = ++this.generation;
		const root = this.root;
		this.disposeWatcher();
		const onescript = root !== undefined && (await detectProjectKind(root)) === 'onescript';
		await vscode.commands.executeCommand('setContext', '1c-platform-tools.project.onescript', onescript);
		if (root === undefined || !onescript || generation !== this.generation) {
			this.load = { file: EMPTY_FILE, hasFile: false };
			if (generation === this.generation) {
				this.onLoaded();
			}
			return;
		}
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(root, '.vscode/onescript-tests*.json')
		);
		this.watcher = watcher;
		const onChange = (): void => this.scheduleReload();
		this.watcherSubscriptions = [
			watcher.onDidCreate(onChange),
			watcher.onDidChange(onChange),
			watcher.onDidDelete(onChange),
		];
		const common = await readProfileFile(path.join(root, ONESCRIPT_TESTS_FILE));
		const local = await readProfileFile(path.join(root, ONESCRIPT_TESTS_LOCAL_FILE));
		if (generation !== this.generation || this.root !== root) {
			return;
		}
		this.load = nextOnescriptProfilesLoad(this.load.file, common, local);
		this.onLoaded();
	}

	private disposeWatcher(): void {
		this.watcher?.dispose();
		this.watcher = undefined;
		for (const subscription of this.watcherSubscriptions) {
			subscription.dispose();
		}
		this.watcherSubscriptions = [];
	}
}

async function readProfileFile(file: string): Promise<OnescriptFileRead> {
	try {
		const text = await fs.readFile(file, 'utf8');
		const parsed = parseOnescriptProfileFile(text);
		return 'error' in parsed ? { kind: 'error', error: parsed.error } : { kind: 'file', file: parsed };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return { kind: 'missing' };
		}
		return { kind: 'error', error: 'Не прочитан файл профилей тестов OneScript' };
	}
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((name, index) => name === right[index]);
}
