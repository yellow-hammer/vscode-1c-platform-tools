/**
 * Просмотр управляемой формы: дерево элементов, данные формы и схематичное превью.
 *
 * Содержимое `Ext/Form.xml` читает md-sparrow (`cf-form-content-get`), расширение разбором XML
 * не занимается.
 *
 * @module formViewerPanel
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import { runMdSparrowParamsRead } from './mdSparrowParams';
import { mdSparrowSchemaFlagFromConfigurationXml } from './mdSparrowSchemaVersion';
import { logger } from '../../shared/logger';
import { ensureBslModuleFile } from './bslModuleFile';

/** Обработчик события формы или элемента. */
export interface FormEventDto {
	name?: string;
	handler?: string;
	callType?: string;
}

/** Элемент формы с вложенными элементами. */
export interface FormItemDto {
	type?: string;
	name?: string;
	id?: string;
	title?: string;
	dataPath?: string;
	group?: string;
	showTitle?: string;
	titleLocation?: string;
	representation?: string;
	visible?: boolean;
	enabled?: boolean;
	readOnly?: boolean;
	width?: string;
	height?: string;
	horizontalStretch?: string;
	verticalStretch?: string;
	events?: FormEventDto[];
	items?: FormItemDto[];
}

/** Реквизит формы; у реквизита-таблицы заполнены колонки. */
export interface FormAttributeDto {
	name?: string;
	title?: string;
	type?: { types?: string[] };
	main?: boolean;
	columns?: FormAttributeDto[];
}

/** Содержимое формы, как его отдаёт md-sparrow. */
export interface FormContentDto {
	title?: string;
	items?: FormItemDto[];
	attributes?: FormAttributeDto[];
	commands?: { name?: string; title?: string; action?: string }[];
	parameters?: { name?: string; type?: { types?: string[] }; key?: boolean }[];
	events?: FormEventDto[];
}

/** Параметры открытия просмотра формы. */
export interface OpenFormViewerParams {
	/** Файл `Ext/Form.xml`. */
	formXmlFsPath: string;
	/** Модуль формы `Ext/Form/Module.bsl` рядом с содержимым. */
	moduleFsPath: string;
	/** Заголовок вкладки: имя формы с владельцем. */
	title: string;
	cwd: string;
	cfgPath?: string;
	schemaFlag?: string;
}

const log = logger.scope('metadata');

const ERR_PREVIEW = 400;

/** Путь к `Ext/Form.xml` формы объекта: `<Объект>/Forms/<Форма>/Ext/Form.xml`. */
export function objectFormXmlPath(objectXmlFsPath: string, objectName: string, formName: string): string {
	return path.join(path.dirname(objectXmlFsPath), objectName, 'Forms', formName, 'Ext', 'Form.xml');
}

/** Путь к `Ext/Form.xml` общей формы: у неё содержимое лежит прямо в каталоге объекта. */
export function commonFormXmlPath(objectXmlFsPath: string, objectName: string): string {
	return path.join(path.dirname(objectXmlFsPath), objectName, 'Ext', 'Form.xml');
}

/** Модуль формы рядом с её содержимым. */
export function formModulePath(formXmlFsPath: string): string {
	return path.join(path.dirname(formXmlFsPath), 'Form', 'Module.bsl');
}

/**
 * Открывает вкладку просмотра формы.
 *
 * @param context Контекст расширения (нужен для ресурсов webview и среды md-sparrow).
 * @param params Пути формы, рабочий каталог и способ определить версию формата.
 */
export async function openFormViewer(
	context: vscode.ExtensionContext,
	params: OpenFormViewerParams
): Promise<void> {
	let schema: string;
	try {
		schema = params.cfgPath
			? await mdSparrowSchemaFlagFromConfigurationXml(params.cfgPath)
			: (params.schemaFlag ?? '');
		if (!schema) {
			throw new Error('Не удалось определить схему XSD для чтения формы.');
		}
	} catch (e) {
		void vscode.window.showErrorMessage((e instanceof Error ? e.message : String(e)).slice(0, ERR_PREVIEW));
		return;
	}

	const runtime = await ensureMdSparrowRuntime(context);
	const result = await runMdSparrowParamsRead(
		runtime,
		{ op: 'cf-form-content-get', formXml: params.formXmlFsPath, schemaVersion: schema },
		{ cwd: params.cwd }
	);
	if (result.exitCode !== 0) {
		const errText = result.stderr.trim() || result.stdout.trim() || `код ${result.exitCode}`;
		void vscode.window.showErrorMessage(`Не удалось прочитать форму. ${errText}`.slice(0, ERR_PREVIEW));
		return;
	}

	let content: FormContentDto;
	try {
		content = JSON.parse(result.stdout.trim()) as FormContentDto;
	} catch (e) {
		log.error(`форма: некорректный JSON от md-sparrow: ${e instanceof Error ? e.message : String(e)}`);
		void vscode.window.showErrorMessage('Не удалось разобрать ответ md-sparrow по форме.');
		return;
	}

	const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'resources', 'webview');
	const panel = vscode.window.createWebviewPanel('1cFormViewer', params.title, vscode.ViewColumn.Active, {
		enableScripts: true,
		retainContextWhenHidden: true,
		localResourceRoots: [webviewRoot],
	});

	panel.webview.onDidReceiveMessage(
		async (message: { type?: string; handler?: string }) => {
			if (message?.type === 'openHandler' || message?.type === 'openModule') {
				await openFormModuleAt(params.moduleFsPath, message.handler, panel.viewColumn);
			}
		},
		undefined,
		context.subscriptions
	);

	try {
		panel.webview.html = await loadFormViewerHtml(panel.webview, context.extensionUri, {
			title: params.title,
			formTitle: content.title ?? '',
			content,
		});
	} catch (e) {
		log.error(`шаблон формы: ${e instanceof Error ? e.message : String(e)}`);
		void vscode.window.showErrorMessage('Не удалось загрузить просмотр формы.');
		panel.dispose();
	}
}

/**
 * Открывает модуль формы соседней вкладкой и ставит курсор на процедуру-обработчик.
 * Модуля может не быть на диске: конфигуратор заводит его по факту файла, поэтому создаём пустой.
 */
async function openFormModuleAt(
	moduleFsPath: string,
	handler?: string,
	column?: vscode.ViewColumn
): Promise<void> {
	try {
		await ensureBslModuleFile(moduleFsPath);
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(moduleFsPath));
		const editor = await vscode.window.showTextDocument(doc, { preview: false, viewColumn: column });
		if (!handler) {
			return;
		}
		const line = findHandlerLine(doc.getText(), handler);
		if (line >= 0) {
			const position = new vscode.Position(line, 0);
			editor.selection = new vscode.Selection(position, position);
			editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
		}
	} catch {
		void vscode.window.showWarningMessage(`Не удалось открыть модуль формы: ${path.basename(moduleFsPath)}`);
	}
}

/** Номер строки объявления процедуры или функции обработчика (-1, если не нашли). */
export function findHandlerLine(moduleText: string, handler: string): number {
	const lines = moduleText.split(/\r?\n/);
	const declaration = new RegExp(`^\\s*(Процедура|Функция|Procedure|Function)\\s+${escapeRegExp(handler)}\\s*\\(`, 'i');
	return lines.findIndex((line) => declaration.test(line));
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

interface FormViewerViewModel {
	title: string;
	formTitle: string;
	content: FormContentDto;
}

async function loadFormViewerHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	viewModel: FormViewerViewModel
): Promise<string> {
	const templatePath = vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'form-viewer.html');
	const template = await fs.readFile(templatePath.fsPath, 'utf8');
	const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'form-viewer.css'));
	const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'form-viewer.js'));
	const nonce = createNonce();
	const initialJson = JSON.stringify(viewModel).replaceAll('<', String.raw`<`);
	return template
		.replaceAll('{{CSP_SOURCE}}', webview.cspSource)
		.replaceAll('{{NONCE}}', nonce)
		.replaceAll('{{CSS_URI}}', cssUri.toString())
		.replaceAll('{{JS_URI}}', jsUri.toString())
		.replaceAll('{{INITIAL_JSON}}', initialJson)
		.replaceAll('{{FORM_TITLE}}', escapeHtml(viewModel.formTitle || viewModel.title));
}

function createNonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i += 1) {
		nonce += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return nonce;
}

function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}
