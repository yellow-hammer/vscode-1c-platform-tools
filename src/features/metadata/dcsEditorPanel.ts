import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { registerFormPanel } from '../editors/formPanels';
import { revealOpenPanel, trackOpenPanel } from '../editors/openPanels';
import { ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import { runMdSparrowParamsMutation, runMdSparrowParamsRead } from './mdSparrowParams';
import { logger } from '../../shared/logger';

const log = logger.scope('metadata');

/** Структура схемы из cf-dcs-info; наполнение целиком приходит от md-sparrow. */
interface DcsInfoDto {
	dataSets?: Array<{ name?: string; query?: string; fields?: Array<{ dataPath?: string; field?: string }> }>;
	calculatedFields?: Array<{ name?: string; value?: string }>;
	totalFields?: Array<{ name?: string; value?: string }>;
	parameters?: Array<{ name?: string; value?: string }>;
}

interface DcsPanelMessage {
	type?: string;
	dataSet?: string;
	text?: string;
	dataPath?: string;
	expression?: string;
	title?: string;
}

export interface DcsEditorInput {
	/** Файл содержимого схемы: `Templates/<Имя>/Ext/Template.xml`. */
	templateXmlFsPath: string;
	title: string;
	cwd: string;
	schemaFlag: string;
}

/** Открывает вкладку схемы компоновки: структура, правка запроса, вычисляемые поля. */
export async function openDcsEditorPanel(
	context: vscode.ExtensionContext,
	input: DcsEditorInput
): Promise<void> {
	if (revealOpenPanel('dcsEditor', input.templateXmlFsPath)) {
		return;
	}
	const runtime = await ensureMdSparrowRuntime(context);

	async function readInfo(): Promise<DcsInfoDto | string> {
		const res = await runMdSparrowParamsRead(
			runtime,
			{ op: 'cf-dcs-info', objectXml: input.templateXmlFsPath, schemaVersion: input.schemaFlag },
			{ cwd: input.cwd }
		);
		if (res.exitCode !== 0) {
			return (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(0, 400);
		}
		try {
			return JSON.parse(res.stdout.trim()) as DcsInfoDto;
		} catch {
			return 'Не удалось разобрать структуру схемы.';
		}
	}

	const info = await readInfo();
	if (typeof info === 'string') {
		void vscode.window.showErrorMessage(`Схема компоновки не прочитана. ${info}`);
		return;
	}

	const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'resources', 'webview');
	const panel = vscode.window.createWebviewPanel(
		'1cDcsEditor',
		`СКД: ${input.title}`,
		vscode.ViewColumn.Active,
		{ enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [webviewRoot] }
	);
	registerFormPanel(panel);
	trackOpenPanel('dcsEditor', input.templateXmlFsPath, panel);
	panel.webview.html = await loadHtml(panel.webview, context.extensionUri, info, input.title);

	panel.webview.onDidReceiveMessage(
		async (msg: DcsPanelMessage) => {
			if (!msg || typeof msg !== 'object') {
				return;
			}
			if (msg.type === 'setQuery' && typeof msg.text === 'string') {
				await applyAndReport({
					op: 'cf-dcs-set-query',
					objectXml: input.templateXmlFsPath,
					schemaVersion: input.schemaFlag,
					tag: msg.dataSet || undefined,
					payloadJson: msg.text,
				});
				return;
			}
			if (msg.type === 'addCalculatedField' && typeof msg.dataPath === 'string') {
				await applyAndReport({
					op: 'cf-dcs-add-calculated-field',
					objectXml: input.templateXmlFsPath,
					schemaVersion: input.schemaFlag,
					payloadJson: JSON.stringify({
						dataPath: msg.dataPath,
						expression: msg.expression ?? '',
						title: msg.title ?? '',
					}),
				});
			}
		},
		undefined,
		context.subscriptions
	);

	async function applyAndReport(params: Parameters<typeof runMdSparrowParamsMutation>[1]): Promise<void> {
		const res = await runMdSparrowParamsMutation(runtime, params, { cwd: input.cwd });
		if (res.exitCode !== 0) {
			const error = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(0, 400);
			log.error(`${params.op}: ${error}`);
			void panel.webview.postMessage({ type: 'saved', ok: false, error });
			return;
		}
		const next = await readInfo();
		void panel.webview.postMessage({
			type: 'saved',
			ok: true,
			model: typeof next === 'string' ? undefined : next,
		});
	}
}

async function loadHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	info: DcsInfoDto,
	title: string
): Promise<string> {
	const templateUri = vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor.html');
	const bytes = await vscode.workspace.fs.readFile(templateUri);
	const template = new TextDecoder('utf-8').decode(bytes);
	const baseCssUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-object.css')
	);
	const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor.css'));
	const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dcs-editor.js'));
	const nonce = randomUUID();
	const initialJson = JSON.stringify(info).replaceAll('<', String.raw`\u003c`);
	return template
		.replaceAll('{{CSP_SOURCE}}', webview.cspSource)
		.replaceAll('{{NONCE}}', nonce)
		.replaceAll('{{BASE_CSS_URI}}', baseCssUri.toString())
		.replaceAll('{{CSS_URI}}', cssUri.toString())
		.replaceAll('{{JS_URI}}', jsUri.toString())
		.replaceAll('{{TITLE}}', escapeHtml(title))
		.replaceAll('{{INITIAL_JSON}}', initialJson);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
