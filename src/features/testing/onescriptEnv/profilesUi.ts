/**
 * Профили запуска тестов OneScript, команды выбора и подпись в дереве.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { frameworkRootId } from '../testItemIds';
import type { VRunnerManager } from '../../../shared/vrunnerManager';
import {
	ONESCRIPT_TESTS_FILE,
	ONESCRIPT_TESTS_TEMPLATE,
} from './profilesFile';
import { OnescriptProfileStore, type OnescriptRunDecision } from './profilesStore';

/** Текущий слой профилей открытого окна. */
let activeProfiles: OnescriptProfiles | undefined;

/**
 * Профили тестов OneScript этого окна.
 */
export function currentOnescriptProfiles(): OnescriptProfiles | undefined {
	return activeProfiles;
}

interface ProfilePick extends vscode.QuickPickItem {
	action: 'use' | 'clear' | 'open';
	profileName?: string;
}

/**
 * Слой интерфейса поверх штатных профилей запуска.
 */
export class OnescriptProfiles {
	readonly store: OnescriptProfileStore;
	private readonly named: { profile: vscode.TestRunProfile; name: string }[] = [];
	private readonly subscriptions: vscode.Disposable[] = [];
	private profileSubscriptions: vscode.Disposable[] = [];
	private readonly byProfile = new Map<vscode.TestRunProfile, string>();

	constructor(
		private readonly controller: vscode.TestController,
		vrunner: VRunnerManager,
		private readonly baseProfile: vscode.TestRunProfile,
		isBusy: () => boolean
	) {
		this.store = new OnescriptProfileStore(vrunner, isBusy, () => {
			this.rebuildRunProfiles();
		});
		activeProfiles = this;
		this.subscriptions.push(this.baseProfile.onDidChangeDefault(() => {
			this.rememberFromProfiles();
		}));
	}

	/**
	 * Начинает следить за файлами проекта.
	 *
	 * @param root - Корень текущего проекта
	 */
	start(root: string | undefined): void {
		this.store.setRoot(root);
	}

	/**
	 * Переключает проект.
	 *
	 * @param root - Новый корень
	 */
	setRoot(root: string | undefined): void {
		this.store.setRoot(root);
	}

	flush(): void {
		this.store.flush();
	}

	/**
	 * Имя профиля запуска, если это именованный профиль OneScript.
	 *
	 * @param profile - Профиль запроса
	 */
	nameOf(profile: vscode.TestRunProfile | undefined): string | undefined {
		if (profile === undefined) {
			return undefined;
		}
		return this.byProfile.get(profile);
	}

	/**
	 * Окружение прогона или отказ.
	 *
	 * @param requested - Имя профиля этого запуска
	 */
	decide(requested: string | undefined): Promise<OnescriptRunDecision> {
		return this.store.decide(requested);
	}

	/** Список «Без профиля», имена с описаниями и открытие файла. */
	async select(): Promise<void> {
		if (!(await this.store.isOnescriptProject())) {
			return;
		}
		const selected = new Set(this.store.names());
		const items: ProfilePick[] = [
			{
				label: 'Без профиля',
				description: selected.size === 0 ? 'активный' : undefined,
				action: 'clear',
			},
		];
		for (const [name, body] of Object.entries(this.store.file().profiles)) {
			items.push({
				label: name,
				description: body.description ?? (selected.has(name) ? 'активный' : undefined),
				detail: body.description !== undefined && selected.has(name) ? 'активный' : undefined,
				action: 'use',
				profileName: name,
			});
		}
		items.push(
			{ label: '', kind: vscode.QuickPickItemKind.Separator, action: 'open' },
			{ label: 'Открыть файл профилей…', action: 'open', alwaysShow: true }
		);
		const picked = await vscode.window.showQuickPick(items, {
			title: 'Профиль тестов',
			placeHolder: 'Выберите профиль',
		});
		if (picked === undefined || picked.kind === vscode.QuickPickItemKind.Separator) {
			return;
		}
		if (picked.action === 'open') {
			await this.openFile();
			return;
		}
		const names = picked.action === 'use' && picked.profileName !== undefined ? [picked.profileName] : [];
		await this.store.remember(names);
		this.applyDefaults();
		this.syncRoot();
	}

	/** Открывает общий файл. Если его нет, спрашивает и кладёт нейтральный шаблон. */
	async openFile(): Promise<void> {
		const root = this.store.projectRoot();
		if (root === undefined || !(await this.store.isOnescriptProject())) {
			return;
		}
		const file = path.join(root, ONESCRIPT_TESTS_FILE);
		try {
			await fs.access(file);
		} catch {
			const answer = await vscode.window.showInformationMessage('Создать файл профилей тестов?', 'Создать');
			if (answer !== 'Создать') {
				return;
			}
			await fs.mkdir(path.dirname(file), { recursive: true });
			await fs.writeFile(file, ONESCRIPT_TESTS_TEMPLATE, 'utf8');
		}
		await vscode.window.showTextDocument(vscode.Uri.file(file));
	}

	/** Подпись корневого узла OneScript. */
	syncRoot(): void {
		const root = this.controller.items.get(frameworkRootId('onescript'));
		if (root === undefined) {
			return;
		}
		const names = this.store.names();
		root.description = names.length > 0 ? `профиль: ${names.join(', ')}` : undefined;
	}

	dispose(): void {
		if (activeProfiles === this) {
			activeProfiles = undefined;
		}
		this.disposeNamed();
		this.store.dispose();
		for (const subscription of this.subscriptions) {
			subscription.dispose();
		}
		this.subscriptions.length = 0;
	}

	private rebuildRunProfiles(): void {
		if (this.store.broken() !== undefined && this.named.length > 0) {
			this.syncRoot();
			return;
		}
		this.disposeNamed();
		for (const [name] of Object.entries(this.store.file().profiles)) {
			const profile = this.controller.createRunProfile(
				`OneScript: ${name}`,
				vscode.TestRunProfileKind.Run,
				(request, token) => this.run(request, token),
				false
			);
			profile.configureHandler = () => {
				void this.openFile();
			};
			this.profileSubscriptions.push(profile.onDidChangeDefault(() => {
				this.rememberFromProfiles();
			}));
			this.named.push({ profile, name });
			this.byProfile.set(profile, name);
		}
		this.applyDefaults();
		this.syncRoot();
	}

	private applyDefaults(): void {
		const selected = new Set(
			this.store.names().filter((name) => this.store.file().profiles[name] !== undefined)
		);
		this.baseProfile.isDefault = selected.size === 0;
		for (const item of this.named) {
			item.profile.isDefault = selected.has(item.name);
		}
	}

	private rememberFromProfiles(): void {
		queueMicrotask(() => {
			const previous = this.store.names();
			const visibleNames = new Set(this.named.map((item) => item.name));
			const visibleDefaults = new Set(
				this.named.filter((item) => item.profile.isDefault).map((item) => item.name)
			);
			const names = previous.filter((name) => !visibleNames.has(name) || visibleDefaults.has(name));
			for (const name of visibleDefaults) {
				if (!names.includes(name)) {
					names.push(name);
				}
			}
			void this.store.remember(names).then(() => {
				this.syncRoot();
			});
		});
	}

	/** Подменяется контроллером: тот же обработчик, что у профиля «Запуск». */
	run: (request: vscode.TestRunRequest, token: vscode.CancellationToken) => Thenable<void> = () => Promise.resolve();

	private disposeNamed(): void {
		for (const item of this.named) {
			this.byProfile.delete(item.profile);
			item.profile.dispose();
		}
		this.named.length = 0;
		for (const subscription of this.profileSubscriptions) {
			subscription.dispose();
		}
		this.profileSubscriptions = [];
	}
}
