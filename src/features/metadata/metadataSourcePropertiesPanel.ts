import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';

export interface SourcePropertiesInput {
	label: string;
	sourceKind: string;
}

export interface SourcePropertiesDto {
	name: string;
	synonymRu: string;
	comment: string;
	defaultRunMode: string;
	usePurposes: string[];
	scriptVariant: string;
	defaultRoles: string[];
	managedApplicationModule: string;
	sessionModule: string;
	externalConnectionModule: string;
	briefInformationRu: string;
	detailedInformationRu: string;
	copyrightRu: string;
	vendorInformationAddressRu: string;
	configurationInformationAddressRu: string;
	vendor: string;
	version: string;
	updateCatalogAddress: string;
	dataLockControlMode: string;
	objectAutonumerationMode: string;
	modalityUseMode: string;
	synchronousPlatformExtensionAndAddInCallUseMode: string;
	interfaceCompatibilityMode: string;
	compatibilityMode: string;
}

interface SourcePanelMessage {
	type?: string;
	payload?: SourcePropertiesDto;
	module?: 'externalConnection' | 'application' | 'session';
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function sourceKindLabel(sourceKind: string): string {
	switch (sourceKind) {
		case 'main':
			return 'Основная конфигурация';
		case 'extension':
			return 'Расширение';
		case 'externalErf':
			return 'Внешние отчёты';
		case 'externalEpf':
			return 'Внешние обработки';
		default:
			return sourceKind;
	}
}

export async function openMetadataSourcePropertiesPanel(
	context: vscode.ExtensionContext,
	input: SourcePropertiesInput,
	dto: SourcePropertiesDto,
	onSave: (nextDto: SourcePropertiesDto) => Promise<boolean>,
	onOpenModule: (module: 'externalConnection' | 'application' | 'session') => Promise<void>
): Promise<void> {
	const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'resources', 'webview');
	const panel = vscode.window.createWebviewPanel(
		'1cMetadataSourceProperties',
		`Свойства: ${input.label}`,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [webviewRoot],
		}
	);
	const nonce = randomUUID();
	panel.webview.html = await loadMetadataSourceHtml(
		panel.webview,
		context.extensionUri,
		dto,
		nonce,
		input.sourceKind,
		sourceKindLabel(input.sourceKind)
	);

	panel.webview.onDidReceiveMessage(
		async (msg: SourcePanelMessage) => {
			if (!msg || typeof msg !== 'object') {
				return;
			}
			if (msg.type === 'openModule' && msg.module) {
				await onOpenModule(msg.module);
				return;
			}
			if (msg.type !== 'save' || !msg.payload) {
				return;
			}
			const ok = await onSave(msg.payload);
			if (ok) {
				dto = msg.payload;
			}
			void panel.webview.postMessage({ type: 'saved', ok, payload: dto });
		},
		undefined,
		context.subscriptions
	);
}

async function loadMetadataSourceHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	dto: SourcePropertiesDto,
	nonce: string,
	sourceKind: string,
	sourceKindLabelValue: string
): Promise<string> {
	const templateUri = vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-source-properties.html');
	const bytes = await vscode.workspace.fs.readFile(templateUri);
	const template = new TextDecoder('utf-8').decode(bytes);
	const cssUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-source-properties.css')
	);
	const jsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-source-properties.js')
	);
	const initialJson = JSON.stringify(dto).replaceAll('<', String.raw`\u003c`);
	return template
		.replaceAll('{{CSP_SOURCE}}', webview.cspSource)
		.replaceAll('{{NONCE}}', nonce)
		.replaceAll('{{CSS_URI}}', cssUri.toString())
		.replaceAll('{{JS_URI}}', jsUri.toString())
		.replaceAll('{{SOURCE_KIND}}', escapeHtml(sourceKind))
		.replaceAll('{{SOURCE_KIND_LABEL}}', escapeHtml(sourceKindLabelValue))
		.replaceAll('{{INITIAL_JSON}}', initialJson);
}
