/**
 * Карточка бинарного файла 1С (custom editor для .cf, .cfe, .epf, .erf).
 *
 * Вместо заглушки редактора о двоичном файле показывает вид файла, размер,
 * дату изменения и действия над ним.
 * @module artifactPreviewProvider
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { binaryArtifactKind, type BinaryArtifactKind } from './artifactKinds';
import { formatBytes } from '../clusters/presentation';
import { fillWebviewTemplate, loadWebviewTemplate } from '../../shared/webviewTemplate';

export const ARTIFACT_PREVIEW_VIEW_TYPE = '1c-platform-tools.artifactPreview';

/** Сообщения из карточки в расширение */
type WebviewMessage = { type: 'decompile' } | { type: 'install' } | { type: 'reveal' };

export class ArtifactPreviewProvider implements vscode.CustomReadonlyEditorProvider {
	private constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly iconsRoot: vscode.Uri
	) {}

	/**
	 * Регистрирует карточку бинарных файлов 1С.
	 *
	 * @param context - Контекст расширения
	 * @returns Disposable регистрации
	 */
	static register(context: vscode.ExtensionContext): vscode.Disposable {
		const iconsRoot = vscode.Uri.joinPath(context.extensionUri, 'resources', 'metadata-tree-icons');
		return vscode.window.registerCustomEditorProvider(
			ARTIFACT_PREVIEW_VIEW_TYPE,
			new ArtifactPreviewProvider(context.extensionUri, iconsRoot),
			{ supportsMultipleEditorsPerDocument: true }
		);
	}

	openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
		return { uri, dispose: () => undefined };
	}

	async resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
		const { uri } = document;
		const kind = binaryArtifactKind(uri.fsPath);
		const webview = webviewPanel.webview;
		webview.options = { enableScripts: true, localResourceRoots: [this.iconsRoot] };

		const render = async (): Promise<void> => {
			const stat = await vscode.workspace.fs.stat(uri).then(
				(value) => value,
				() => undefined
			);
			webview.html = await buildHtml(this.extensionUri, webview, this.iconsRoot, uri, kind, stat);
		};

		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(vscode.Uri.file(path.dirname(uri.fsPath)), path.basename(uri.fsPath))
		);
		watcher.onDidChange(() => void render());
		watcher.onDidCreate(() => void render());
		watcher.onDidDelete(() => void render());
		webviewPanel.onDidDispose(() => watcher.dispose());

		webview.onDidReceiveMessage(async (message: WebviewMessage) => {
			if (message.type === 'decompile' && kind?.decompileCommand) {
				await vscode.commands.executeCommand(kind.decompileCommand, { resourceUri: uri });
				return;
			}
			if (message.type === 'install' && kind?.install) {
				await vscode.commands.executeCommand('1c-platform-tools.package.install', { resourceUri: uri });
				return;
			}
			if (message.type === 'reveal') {
				await vscode.commands.executeCommand('revealInExplorer', uri);
			}
		});

		await render();
	}
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** HTML карточки: значок вида, сведения о файле и кнопки действий. */
async function buildHtml(
	extensionUri: vscode.Uri,
	webview: vscode.Webview,
	iconsRoot: vscode.Uri,
	uri: vscode.Uri,
	kind: BinaryArtifactKind | undefined,
	stat: vscode.FileStat | undefined
): Promise<string> {
	const nonce = Math.random().toString(36).slice(2);
	const icon = (theme: string[]): string =>
		kind?.icon ? webview.asWebviewUri(vscode.Uri.joinPath(iconsRoot, ...theme, kind.icon)).toString() : '';
	const rows: Array<[string, string]> = stat
		? [
				['Размер', formatBytes(String(stat.size))],
				['Изменён', new Date(stat.mtime).toLocaleString('ru-RU')],
				['Путь', vscode.workspace.asRelativePath(uri, false)],
			]
		: [['Путь', vscode.workspace.asRelativePath(uri, false)]];
	const icons = kind?.icon
		? `<img class="light" src="${icon([])}" alt=""><img class="dark" src="${icon(['dark'])}" alt="">`
		: '';
	const template = await loadWebviewTemplate(extensionUri, 'artifact-preview.html');
	return fillWebviewTemplate(template, {
		CSP_SOURCE: webview.cspSource,
		NONCE: nonce,
		ICONS: icons,
		TITLE: escapeHtml(path.basename(uri.fsPath)),
		KIND: escapeHtml(kind?.label ?? 'Файл 1С'),
		MISSING: stat ? '' : '<div class="missing">Файл не найден</div>',
		ROWS: rows.map(([name, value]) => `<dt>${name}</dt><dd>${escapeHtml(value)}</dd>`).join(''),
		DECOMPILE: kind?.decompileCommand && stat ? '<button data-message="decompile">Разобрать</button>' : '',
		INSTALL: kind?.install && stat ? '<button data-message="install">Установить</button>' : '',
	});
}
