import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { registerFormPanel } from '../editors/formPanels';
import { beginOpenPanel, endOpenPanel, revealOpenPanel, trackOpenPanel } from '../editors/openPanels';

export interface SourcePropertiesInput {
	label: string;
	sourceKind: string;
	/** Configuration.xml источника: по нему вкладка находит себя при повторном открытии. */
	configurationXmlAbs: string;
	/** Словари формата: варианты перечислимых свойств и русские подписи значений. */
	dictionaries?: SourcePropertyDictionaries;
	/** Поддержка поставщика выгрузки: поставщик, версия и состояние правил. */
	support?: SourceSupportState;
}

/** Состояние поддержки выгрузки из правил поставки. */
export interface SourceSupportState {
	vendor?: string;
	version?: string;
	/** locked - полная поддержка, editable - возможность изменения включена. */
	configurationState?: string;
}

/** Перечисления и подписи приходят от md-sparrow: панель своей копии формата не держит. */
export interface SourcePropertyDictionaries {
	enums: Record<string, string[]>;
	labels: { values: Record<string, string>; byProperty: Record<string, Record<string, string>> };
	/** Роли конфигурации: кандидаты в основные роли. */
	roleNames?: string[];
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
	/** Уже выбранные основные роли при подборе новой. */
	taken?: unknown;
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
	if (revealOpenPanel('sourceProperties', input.configurationXmlAbs)) {
		return;
	}
	// Бронь на время чтения: повторный щелчок не открывает копию вкладки
	if (!beginOpenPanel('sourceProperties', input.configurationXmlAbs)) {
		return;
	}
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
	registerFormPanel(panel);
	trackOpenPanel('sourceProperties', input.configurationXmlAbs, panel);
	endOpenPanel('sourceProperties', input.configurationXmlAbs);
	const nonce = randomUUID();
	panel.webview.html = await loadMetadataSourceHtml(
		panel.webview,
		context.extensionUri,
		dto,
		nonce,
		input.sourceKind,
		sourceKindLabel(input.sourceKind),
		input.label,
		input.dictionaries,
		input.support
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
			if (msg.type === 'pickRole') {
				const taken = new Set(Array.isArray(msg.taken) ? msg.taken.map(String) : []);
				const candidates = (input.dictionaries?.roleNames ?? [])
					.map((name) => `Role.${name}`)
					.filter((ref) => !taken.has(ref));
				if (candidates.length === 0) {
					void vscode.window.showInformationMessage('Все роли конфигурации уже выбраны.');
					return;
				}
				const picked = await vscode.window.showQuickPick(
					candidates.map((ref) => ({ label: ref.replace(/^Role\./, ''), ref })),
					{ placeHolder: 'Какую роль добавить в основные' }
				);
				if (picked) {
					void panel.webview.postMessage({ type: 'rolePicked', role: picked.ref });
				}
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
	sourceKindLabelValue: string,
	sourceLabel: string,
	dictionaries?: SourcePropertyDictionaries,
	support?: SourceSupportState
): Promise<string> {
	const templateUri = vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-source-properties.html');
	const bytes = await vscode.workspace.fs.readFile(templateUri);
	const template = new TextDecoder('utf-8').decode(bytes);
	// Общая вёрстка панелей свойств: одна и та же для объекта и конфигурации.
	const baseCssUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-object.css')
	);
	const cssUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-source-properties.css')
	);
	const jsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'metadata-source-properties.js')
	);
	const initialJson = JSON.stringify(dto).replaceAll('<', String.raw`\u003c`);
	const dictionariesJson = JSON.stringify(
		dictionaries ?? { enums: {}, labels: { values: {}, byProperty: {} } }
	).replaceAll('<', String.raw`\u003c`);
	const supportJson = JSON.stringify(support ?? null).replaceAll('<', String.raw`\u003c`);
	return template
		.replaceAll('{{CSP_SOURCE}}', webview.cspSource)
		.replaceAll('{{NONCE}}', nonce)
		.replaceAll('{{BASE_CSS_URI}}', baseCssUri.toString())
		.replaceAll('{{CSS_URI}}', cssUri.toString())
		.replaceAll('{{JS_URI}}', jsUri.toString())
		.replaceAll('{{SOURCE_KIND}}', escapeHtml(sourceKind))
		.replaceAll('{{SOURCE_KIND_LABEL}}', escapeHtml(sourceKindLabelValue))
		.replaceAll('{{SOURCE_LABEL}}', escapeHtml(sourceLabel))
		.replaceAll('{{INITIAL_JSON}}', initialJson)
		.replaceAll('{{DICTIONARIES_JSON}}', dictionariesJson)
		.replaceAll('{{SUPPORT_JSON}}', supportJson);
}
