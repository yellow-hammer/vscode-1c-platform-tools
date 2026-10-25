/**
 * Визуальный редактор пайплайнов (custom editor поверх `.1cpt/pipelines.json`).
 *
 * Полотно с блоками и связями: блок - шаг (команда расширения, команда
 * оболочки, пауза), связь - переход по исходу шага. Блоки таскаются мышью,
 * связи тянутся от выходного порта к входному, ветка выбирается портом:
 * успех, ошибка, в любом случае. Слева палитра действий, справа свойства
 * выделенного блока.
 *
 * Файл остаётся источником истины: правки формы пишутся в документ целиком,
 * а изменения документа перерисовывают полотно. Во время прогона блоки
 * подсвечиваются по событиям выполнения.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { fillWebviewTemplate, loadWebviewTemplate } from '../../shared/webviewTemplate';
import { runWithProject } from '../../shared/workspaceProjects';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { readCommandCatalog, CommandCatalogEntry } from '../../shared/commandCatalog';
import { serializePipelines } from '../../shared/pipelines/pipelineFile';
import { normalizePipelines, Pipeline } from '../../shared/pipelines/pipelineTypes';
import { onPipelineRunEvent } from '../../shared/pipelines/pipelineEvents';
import { chromeScript, chromeStyles, saveBarHtml, CHROME_LABELS } from '../editors/webviewChrome';
import { registerFormPanel } from '../editors/formPanels';

const log = logger.scope('pipelines');

export const PIPELINE_EDITOR_VIEW_TYPE = '1c-platform-tools.pipelineEditor';

/** Сообщения из формы в расширение */
type WebviewMessage =
	| { type: 'save'; data: Pipeline[] }
	| { type: 'run'; pipelineId: string }
	| { type: 'error'; message: string }
	| { type: 'openJson' };

/** Модель для формы */
interface EditorModel {
	pipelines: Pipeline[];
	catalog: CommandCatalogEntry[];
	/** Профили и окружения проекта: из них выбирают у пайплайна и шага */
	profiles: { id: string; label: string }[];
	environments: string[];
	error?: string;
}

/** Корень проекта файла `<корень>/.1cpt/pipelines.json` */
function projectRootOf(document: vscode.TextDocument): string {
	return path.dirname(path.dirname(document.uri.fsPath));
}

export class PipelineEditorProvider implements vscode.CustomTextEditorProvider {
	/** Открытые полотна: команда открытия просит выделить нужную цепочку */
	private static readonly panels = new Set<vscode.WebviewPanel>();

	/** Цепочка, которую нужно выделить, когда полотно откроется */
	private static pending: string | undefined;

	/**
	 * Просит полотно выделить цепочку.
	 *
	 * Панель могла ещё не открыться: тогда запрос ждёт её появления, иначе клик
	 * по цепочке в дереве открывал бы редактор на первой попавшейся.
	 *
	 * @param pipelineId - Идентификатор цепочки
	 */
	static revealPipeline(pipelineId: string): void {
		if (PipelineEditorProvider.panels.size === 0) {
			PipelineEditorProvider.pending = pipelineId;
			return;
		}
		for (const panel of PipelineEditorProvider.panels) {
			void panel.webview.postMessage({ type: 'select', pipelineId });
		}
	}

	/**
	 * Регистрирует редактор пайплайнов.
	 *
	 * @param extensionUri - Корень расширения с ресурсами webview
	 * @returns Disposable регистрации
	 */
	static register(extensionUri: vscode.Uri): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			PIPELINE_EDITOR_VIEW_TYPE,
			new PipelineEditorProvider(extensionUri),
			{ webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }
		);
	}

	constructor(private readonly extensionUri: vscode.Uri) {}

	/**
	 * Открывает документ полотном.
	 *
	 * @param document - Файл пайплайнов
	 * @param webviewPanel - Панель редактора
	 */
	async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel
	): Promise<void> {
		webviewPanel.webview.options = { enableScripts: true };
		webviewPanel.webview.html = await buildHtml(this.extensionUri);
		const root = projectRootOf(document);
		// Профили проекта зависят от версии vanessa-runner
		await runWithProject(root, () => VRunnerManager.getInstance().getVRunnerVersion());

		const post = (): void => {
			void webviewPanel.webview.postMessage({ type: 'model', model: this.buildModel(document) });
		};

		const launchFiles = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(root, '{env*.json,autumn-properties*.json,.env,.env.*}')
		);
		const subscriptions = [
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.uri.toString() === document.uri.toString()) {
					post();
				}
			}),
			onPipelineRunEvent((event) => {
				void webviewPanel.webview.postMessage({ type: 'run', event });
			}),
			launchFiles,
			launchFiles.onDidCreate(post),
			launchFiles.onDidDelete(post),
		];
		PipelineEditorProvider.panels.add(webviewPanel);
		registerFormPanel(webviewPanel);
		webviewPanel.onDidDispose(() => {
			PipelineEditorProvider.panels.delete(webviewPanel);
			subscriptions.forEach((item) => item.dispose());
		});

		webviewPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
			if (message.type === 'save') {
				await this.save(document, message.data);
				void webviewPanel.webview.postMessage({ type: 'saved' });
				post();
				// Дерево команд показывает сохранённое: обновляем сразу, не дожидаясь наблюдателя за файлами
				await vscode.commands.executeCommand('1c-platform-tools.tools.refresh', { silent: true });
				return;
			}
			if (message.type === 'run') {
				// Цепочка идёт в проекте своего файла
				await runWithProject(root, () =>
					vscode.commands.executeCommand('1c-platform-tools.pipelines.run', {
						pipeline: message.pipelineId,
					})
				);
				return;
			}
			if (message.type === 'error') {
				log.error(`Ошибка формы редактора: ${message.message}`);
				return;
			}
			if (message.type === 'openJson') {
				await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
			}
		});

		post();

		if (PipelineEditorProvider.pending !== undefined) {
			void webviewPanel.webview.postMessage({ type: 'select', pipelineId: PipelineEditorProvider.pending });
			PipelineEditorProvider.pending = undefined;
		}
	}

	/**
	 * Строит модель формы по тексту документа.
	 *
	 * @param document - Файл пайплайнов
	 * @returns Модель с цепочками и каталогом команд
	 */
	private buildModel(document: vscode.TextDocument): EditorModel {
		const vrunner = VRunnerManager.getInstance();
		const base = runWithProject(projectRootOf(document), () => ({
			catalog: readCommandCatalog(),
			profiles: vrunner.discoverEnvProfiles().map(({ id, label }) => ({ id, label })),
			environments: vrunner.discoverEnvironments().map(({ id }) => id),
		}));
		const text = document.getText().trim();
		if (text === '') {
			return { ...base, pipelines: [] };
		}
		try {
			return { ...base, pipelines: normalizePipelines(JSON.parse(text)) };
		} catch (error) {
			return {
				...base,
				pipelines: [],
				error: `Файл не разбирается как JSON: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	/**
	 * Записывает цепочки в документ и сохраняет его.
	 *
	 * @param document - Файл пайплайнов
	 * @param pipelines - Новое содержимое
	 */
	private async save(document: vscode.TextDocument, pipelines: Pipeline[]): Promise<void> {
		const next = serializePipelines(normalizePipelines({ pipelines }));
		if (next === document.getText()) {
			return;
		}
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), next);
		await vscode.workspace.applyEdit(edit);
		await document.save();
	}
}

/** HTML редактора: полотно и палитра в инлайн-скрипте, правки уходят в extension. */
async function buildHtml(extensionUri: vscode.Uri): Promise<string> {
	const nonce = Math.random().toString(36).slice(2);
	const template = await loadWebviewTemplate(extensionUri, 'pipeline-editor.html');
	return fillWebviewTemplate(template, {
		NONCE: nonce,
		CHROME_STYLES: chromeStyles(),
		JSON_LABEL: CHROME_LABELS.json,
		ADD_LABEL: CHROME_LABELS.add,
		SAVE_BAR: saveBarHtml(),
		CHROME_SCRIPT: chromeScript(),
	});
}
