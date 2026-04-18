/**
 * Подсветка текущего проекта в сайдбаре.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';

export const VIEW_SCHEME = '1c-platform-tools-projects';

let currentProjectPath: string | undefined;
let decorationEmitter: vscode.EventEmitter<vscode.Uri | vscode.Uri[]> | undefined;

/**
 * Устанавливает путь текущего проекта для подсветки в TreeView.
 * @param rootPath — fsPath корня проекта или undefined
 */
export function setCurrentProjectPath(rootPath: string | undefined): void {
	const prev = currentProjectPath;
	currentProjectPath = rootPath ? path.normalize(rootPath) : undefined;
	if (prev !== currentProjectPath && decorationEmitter) {
		const uris: vscode.Uri[] = [];
		if (prev) {uris.push(vscode.Uri.from({ scheme: VIEW_SCHEME, path: prev }));}
		if (currentProjectPath) {uris.push(vscode.Uri.from({ scheme: VIEW_SCHEME, path: currentProjectPath }));}
		decorationEmitter.fire(uris.length > 0 ? uris : []);
	}
}

/**
 * Регистрирует провайдер подсветки текущего проекта в панели «Проекты 1С».
 * @param context — контекст расширения
 */
export function registerProjectsDecoration(context: vscode.ExtensionContext): void {
	decorationEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
	const provider: vscode.FileDecorationProvider = {
		onDidChangeFileDecorations: decorationEmitter.event,
		provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
			if (uri.scheme !== VIEW_SCHEME || !currentProjectPath) {
				return undefined;
			}
			const uriPath = path.normalize(uri.fsPath ?? uri.path);
			if (uriPath.toLowerCase() !== currentProjectPath.toLowerCase()) {
				return undefined;
			}
			return {
				badge: '✔',
				tooltip: 'Текущий проект',
				color: new vscode.ThemeColor('1cplatformtools.projects.currentProjectHighlightForeground'),
			};
		},
	};
	context.subscriptions.push(vscode.window.registerFileDecorationProvider(provider));
}
