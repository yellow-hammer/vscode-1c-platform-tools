import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';

export interface ExternalArtifactPropertiesDto {
	name: string;
	synonymRu: string;
	comment: string;
	kind: 'REPORT' | 'DATA_PROCESSOR';
}

interface PanelMessage {
	type?: string;
	payload?: ExternalArtifactPropertiesDto;
}

export async function openExternalArtifactPropertiesPanel(
	context: vscode.ExtensionContext,
	label: string,
	dto: ExternalArtifactPropertiesDto,
	onSave: (nextDto: ExternalArtifactPropertiesDto) => Promise<boolean>
): Promise<void> {
	const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'resources', 'webview');
	const panel = vscode.window.createWebviewPanel(
		'1cExternalArtifactProperties',
		`Свойства: ${label}`,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [webviewRoot],
		}
	);
	const nonce = randomUUID();
	panel.webview.html = await loadHtml(panel.webview, context.extensionUri, nonce, dto);
	panel.webview.onDidReceiveMessage(
		async (msg: PanelMessage) => {
			if (!msg || msg.type !== 'save' || !msg.payload) {
				return;
			}
			const ok = await onSave(msg.payload);
			void panel.webview.postMessage({ type: 'saved', ok, payload: msg.payload });
		},
		undefined,
		context.subscriptions
	);
}

async function loadHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	nonce: string,
	dto: ExternalArtifactPropertiesDto
): Promise<string> {
	const templateUri = vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-external-artifact-properties.html');
	const bytes = await vscode.workspace.fs.readFile(templateUri);
	const template = new TextDecoder('utf-8').decode(bytes);
	const cssUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-external-artifact-properties.css')
	);
	const jsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-external-artifact-properties.js')
	);
	const initialJson = JSON.stringify(dto).replaceAll('<', String.raw`\u003c`);
	return template
		.replaceAll('{{CSP_SOURCE}}', webview.cspSource)
		.replaceAll('{{NONCE}}', nonce)
		.replaceAll('{{CSS_URI}}', cssUri.toString())
		.replaceAll('{{JS_URI}}', jsUri.toString())
		.replaceAll('{{INITIAL_JSON}}', initialJson);
}
