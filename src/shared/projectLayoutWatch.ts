/**
 * Слежение за тем, из чего собрана раскладка проекта.
 *
 * Раскладка кэшируется на рабочую область, поэтому её нужно забывать, когда
 * появляется, исчезает или меняется маркерный файл, меняются пути в настройках
 * или состав папок рабочей области.
 * @module projectLayoutWatch
 */

import * as vscode from 'vscode';
import { DEFAULT_PATHS, DEFAULT_TESTING } from './pathDefaults';
import { invalidateProjectLayout, setLayoutExclusions, setTestsDirectory } from './projectLayout';

/** Описания конфигураций, расширений и внешних объектов обоих форматов и проекты EDT. */
const MARKERS = '**/{Configuration.xml,Configuration.mdo,*.xml,*.mdo,.project}';

/** Настройки, от которых зависит раскладка: каталог сборки, исключения артефактов и каталог тестов. */
const SETTINGS = [
	'1c-platform-tools.path.out',
	'1c-platform-tools.artifacts.exclude',
	'1c-platform-tools.test.directoryName',
];

/** Разборка кладёт тысячи файлов подряд: сброс один на всю пачку. */
const DEBOUNCE_MS = 300;

const changed = new vscode.EventEmitter<void>();

export const onDidChangeProjectLayout = changed.event;

/** Каталоги, которые обход раскладки пропускает: каталог сборки и исключения артефактов. */
function exclusions(): string[] {
	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	const out = config.get<string>('path.out', DEFAULT_PATHS.out).replace(/\\/g, '/').replace(/^\.?\//, '');
	const build = out.split('/')[0];
	const excluded = config.get<string[]>('artifacts.exclude', []).map((item) => item.replace(/\\/g, '/').replace(/^\.?\/|\/$/g, ''));
	return [...new Set([build, ...excluded].filter((item) => item.length > 0 && !item.includes('/')))];
}

/** Имя каталога тестов из настроек. */
function testsDirectory(): string {
	return vscode.workspace
		.getConfiguration('1c-platform-tools')
		.get<string>('test.directoryName', DEFAULT_TESTING.directoryName);
}

export function registerProjectLayoutWatch(context: vscode.ExtensionContext): void {
	setLayoutExclusions(exclusions);
	setTestsDirectory(testsDirectory);
	let timer: NodeJS.Timeout | undefined;
	const forget = () => {
		invalidateProjectLayout();
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			timer = undefined;
			changed.fire();
		}, DEBOUNCE_MS);
	};
	const watcher = vscode.workspace.createFileSystemWatcher(MARKERS, false, true, false);

	context.subscriptions.push(
		watcher,
		watcher.onDidCreate(forget),
		watcher.onDidDelete(forget),
		vscode.workspace.onDidChangeWorkspaceFolders(forget),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (SETTINGS.some((setting) => event.affectsConfiguration(setting))) {
				forget();
			}
		}),
		new vscode.Disposable(() => {
			if (timer) {
				clearTimeout(timer);
			}
		})
	);
}
