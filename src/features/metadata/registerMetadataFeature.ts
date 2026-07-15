import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import {
	cachedMdSparrowTag,
	clearMdSparrowJarCache,
	clearPortableJreCache,
	ensureMdSparrowRuntime,
	portableJreCached,
} from './mdSparrowBootstrap';
import { cachedOnecDebugAdapterTag, clearOnecDebugAdapterCache } from '../debug/onecDebugAdapterBootstrap';
import { parseMdBoilerplateKindFromCommandArgs } from './metadataBoilerplateNames';
import {
	openExternalArtifactPropertiesPanel,
	type ExternalArtifactPropertiesDto,
} from './metadataExternalArtifactPropertiesPanel';
import { createMdSparrowMutationRunner } from './mdSparrowMutationQueue';
import type { MetadataFilterTreeDataProvider } from './metadataFilterView';
import { MetadataSearchViewProvider } from './metadataSearchView';
import { applySubsystemFilter } from './metadataSubsystemFilter';
import { openMetadataObjectPropertiesEditor } from './metadataObjectPropertiesPanel';
import {
	openMetadataSourcePropertiesPanel,
	type SourcePropertiesDto,
} from './metadataSourcePropertiesPanel';
import { mdSparrowSchemaFlagFromConfigurationXml } from './mdSparrowSchemaVersion';
import { runMdSparrow } from './mdSparrowRunner';
import {
	runMdSparrowParamsMutation,
	runMdSparrowParamsRead,
	type MdSparrowParams,
} from './mdSparrowParams';
import { loadProjectMetadataTree } from './metadataTreeService';
import { openErCanvasPanel } from './er/erCanvasPanel';
import type { ErScope } from './er/erTypes';
import {
	MetadataLeafTreeItem,
	MetadataMdGroupTreeItem,
	MetadataMdSubgroupTreeItem,
	MetadataObjectNodeTreeItem,
	MetadataObjectSectionTreeItem,
	MetadataSourceTreeItem,
	objectModuleFilePath,
	objectModuleKindsForType,
	type MetadataTreeDataProvider,
	type ObjectModuleKind,
} from './metadataTreeView';

export interface RegisterMetadataFeatureParams {
	context: vscode.ExtensionContext;
	metadataTreeProvider: MetadataTreeDataProvider;
	metadataTreeView: vscode.TreeView<vscode.TreeItem>;
	metadataSearchProvider: MetadataSearchViewProvider;
	metadataFilterProvider: MetadataFilterTreeDataProvider;
}

/**
 * Регистрирует команды и runtime-обработчики фичи «Метаданные 1С».
 */
export function registerMetadataFeature(
	params: RegisterMetadataFeatureParams
): vscode.Disposable[] {
	const { context, metadataTreeProvider, metadataTreeView, metadataSearchProvider, metadataFilterProvider } = params;

	const MD_SPARROW_CLI_ERR_PREVIEW = 500;

	const runMdSparrowMutation = createMdSparrowMutationRunner();

	function resolveCfPathsFromMetadataTree(): { cfgPath: string; cfRoot: string } | undefined {
		const sel = metadataTreeView.selection[0];
		if (sel instanceof MetadataMdGroupTreeItem || sel instanceof MetadataMdSubgroupTreeItem) {
			if (sel.configurationXmlAbs && sel.metadataRootAbs) {
				return { cfgPath: sel.configurationXmlAbs, cfRoot: sel.metadataRootAbs };
			}
		}
		if (sel instanceof MetadataLeafTreeItem) {
			if (sel.configurationXmlAbs && sel.metadataRootAbs) {
				return { cfgPath: sel.configurationXmlAbs, cfRoot: sel.metadataRootAbs };
			}
		}
		const cfgPath = metadataTreeProvider.configurationXml;
		const cfRoot = metadataTreeProvider.resolveCfRoot();
		if (cfgPath && cfRoot) {
			return { cfgPath, cfRoot };
		}
		return undefined;
	}

	const metadataObjectTypeToXmlTag: Record<string, string> = {
		Catalog: 'Catalog',
		Constant: 'Constant',
		Enum: 'Enum',
		Document: 'Document',
		Report: 'Report',
		DataProcessor: 'DataProcessor',
		Task: 'Task',
		ChartOfAccounts: 'ChartOfAccounts',
		ChartOfCharacteristicTypes: 'ChartOfCharacteristicTypes',
		ChartOfCalculationTypes: 'ChartOfCalculationTypes',
		CommonModule: 'CommonModule',
		Subsystem: 'Subsystem',
		SessionParameter: 'SessionParameter',
		ExchangePlan: 'ExchangePlan',
		CommonAttribute: 'CommonAttribute',
		CommonPicture: 'CommonPicture',
		DocumentNumerator: 'DocumentNumerator',
		ExternalDataSource: 'ExternalDataSource',
		Role: 'Role',
	};

	function resolveSelectedMetadataLeaf(item?: MetadataLeafTreeItem): MetadataLeafTreeItem | undefined {
		if (item instanceof MetadataLeafTreeItem) {
			return item;
		}
		if (metadataTreeView.selection.length === 0) {
			return undefined;
		}
		const selected = metadataTreeView.selection[0];
		if (selected instanceof MetadataLeafTreeItem) {
			return selected;
		}
		return undefined;
	}

	function resolveSelectedMetadataSource(item?: MetadataSourceTreeItem): MetadataSourceTreeItem | undefined {
		if (item instanceof MetadataSourceTreeItem) {
			return item;
		}
		if (metadataTreeView.selection.length === 0) {
			return undefined;
		}
		const selected = metadataTreeView.selection[0];
		if (selected instanceof MetadataSourceTreeItem) {
			return selected;
		}
		return undefined;
	}

	async function openTextFile(pathToOpen: string): Promise<void> {
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(pathToOpen));
		await vscode.window.showTextDocument(doc, { preview: false });
	}

	/**
	 * Гарантирует существование файла модуля .bsl. Если файла нет — создаёт пустой
	 * (UTF-8 BOM, как у конфигуратора) вместе с каталогом `Ext`. Возвращает true,
	 * если файл был создан.
	 */
	async function ensureBslModuleFile(modulePath: string): Promise<boolean> {
		try {
			await fs.promises.access(modulePath);
			return false;
		} catch {
			/* файла нет — создаём ниже */
		}
		await fs.promises.mkdir(path.dirname(modulePath), { recursive: true });
		await fs.promises.writeFile(modulePath, Buffer.from([0xef, 0xbb, 0xbf]));
		return true;
	}

	/**
	 * Открывает модуль объекта метаданных заданного вида. Если файла модуля ещё
	 * нет — создаёт пустой и открывает его.
	 */
	async function openObjectModuleOfKind(
		item: MetadataLeafTreeItem | undefined,
		kind: ObjectModuleKind
	): Promise<void> {
		const node = resolveSelectedMetadataLeaf(item);
		if (!(node instanceof MetadataLeafTreeItem) || !node.resourceUri) {
			void vscode.window.showInformationMessage('Выберите объект метаданных в дереве.');
			return;
		}
		if (!objectModuleKindsForType(node.objectType).includes(kind)) {
			void vscode.window.showInformationMessage(`У объекта «${node.name}» нет такого модуля.`);
			return;
		}
		const modulePath = objectModuleFilePath(node.resourceUri.fsPath, node.name, kind);
		try {
			const created = await ensureBslModuleFile(modulePath);
			await openTextFile(modulePath);
			if (created) {
				void vscode.window.showInformationMessage(`Создан пустой модуль: ${path.basename(modulePath)}`);
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			void vscode.window.showErrorMessage(`Не удалось открыть модуль: ${msg}`);
		}
	}

	async function resolveFirstXmlInDir(dir: string): Promise<string | undefined> {
		try {
			const entries = await fs.promises.readdir(dir, { withFileTypes: true });
			const files = entries
				.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.xml'))
				.map((entry) => entry.name)
				.sort((a, b) => a.localeCompare(b, 'ru'))
				.map((name) => path.join(dir, name));
			if (files.length > 0) {
				return files[0];
			}
			const dirs = entries
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
				.sort((a, b) => a.localeCompare(b, 'ru'));
			for (const subdir of dirs) {
				const nested = await resolveFirstXmlInDir(path.join(dir, subdir));
				if (nested) {
					return nested;
				}
			}
			return undefined;
		} catch {
			return undefined;
		}
	}

	async function resolveModulePathForSource(
		source: MetadataSourceTreeItem,
		moduleFileName: string
	): Promise<string | undefined> {
		if (!source.metadataRootAbs) {
			return undefined;
		}
		const exact = path.join(source.metadataRootAbs, 'Ext', moduleFileName);
		try {
			await fs.promises.access(exact);
			return exact;
		} catch {
			return undefined;
		}
	}

	async function listExternalArtifactXmlFromSource(
		source: MetadataSourceTreeItem
	): Promise<Array<{ name: string; xmlPath: string; objectType: 'ExternalReport' | 'ExternalDataProcessor' }>> {
		if (!source.metadataRootAbs) {
			return [];
		}
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(source.metadataRootAbs, { withFileTypes: true });
		} catch {
			return [];
		}
		const dirs = entries
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			.sort((a, b) => a.localeCompare(b, 'ru'));
		const objectType: 'ExternalReport' | 'ExternalDataProcessor' =
			source.sourceKind === 'externalErf' ? 'ExternalReport' : 'ExternalDataProcessor';
		const out: Array<{ name: string; xmlPath: string; objectType: 'ExternalReport' | 'ExternalDataProcessor' }> = [];
		for (const dirName of dirs) {
			const dirPath = path.join(source.metadataRootAbs, dirName);
			let files: fs.Dirent[];
			try {
				files = await fs.promises.readdir(dirPath, { withFileTypes: true });
			} catch {
				continue;
			}
			const xml = files
				.filter((f) => f.isFile() && f.name.toLowerCase().endsWith('.xml'))
				.map((f) => f.name)
				.sort((a, b) => a.localeCompare(b, 'ru'))[0];
			if (!xml) {
				continue;
			}
			out.push({
				name: path.basename(xml, '.xml'),
				xmlPath: path.join(dirPath, xml),
				objectType,
			});
		}
		return out;
	}

	async function loadSourcePropertiesDto(
		cfgPath: string,
		cfRoot: string
	): Promise<{ schema: string; dto: SourcePropertiesDto }> {
		const schema = await mdSparrowSchemaFlagFromConfigurationXml(cfgPath);
		const runtime = await ensureMdSparrowRuntime(context);
		const getRes = await runMdSparrowParamsRead(
			runtime,
			{ op: 'cf-configuration-properties-get', configurationXml: cfgPath, schemaVersion: schema },
			{ cwd: cfRoot }
		);
		if (getRes.exitCode !== 0) {
			const errText = (getRes.stderr.trim() || getRes.stdout.trim() || `код ${getRes.exitCode}`).slice(
				0,
				MD_SPARROW_CLI_ERR_PREVIEW
			);
			throw new Error(errText);
		}
		let dto: SourcePropertiesDto;
		try {
			dto = JSON.parse(getRes.stdout.trim()) as SourcePropertiesDto;
		} catch {
			throw new Error('Не удалось разобрать свойства Configuration.xml.');
		}
		return { schema, dto };
	}

	async function saveSourcePropertiesDto(
		cfgPath: string,
		cfRoot: string,
		schema: string,
		dto: SourcePropertiesDto
	): Promise<boolean> {
		try {
			const runtime = await ensureMdSparrowRuntime(context);
			const setRes = await runMdSparrowParamsMutation(
				runtime,
				{
					op: 'cf-configuration-properties-set',
					configurationXml: cfgPath,
					schemaVersion: schema,
					payloadJson: JSON.stringify(dto),
				},
				{ cwd: cfRoot }
			);
			if (setRes.exitCode !== 0) {
				const errText = (setRes.stderr.trim() || setRes.stdout.trim() || `код ${setRes.exitCode}`).slice(
					0,
					MD_SPARROW_CLI_ERR_PREVIEW
				);
				void vscode.window.showErrorMessage(errText);
				return false;
			}
			return true;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
			return false;
		}
	}

	async function loadExternalArtifactPropertiesDto(
		objectXmlPath: string,
		cwd: string
	): Promise<{ schema: string; dto: ExternalArtifactPropertiesDto }> {
		const schema = await mdSparrowSchemaFlagFromConfigurationXml(objectXmlPath);
		const runtime = await ensureMdSparrowRuntime(context);
		const getRes = await runMdSparrowParamsRead(
			runtime,
			{ op: 'external-artifact-properties-get', objectXml: objectXmlPath, schemaVersion: schema },
			{ cwd }
		);
		if (getRes.exitCode !== 0) {
			const errText = (getRes.stderr.trim() || getRes.stdout.trim() || `код ${getRes.exitCode}`).slice(
				0,
				MD_SPARROW_CLI_ERR_PREVIEW
			);
			throw new Error(errText);
		}
		type ExternalDto = { name?: string; synonymRu?: string; comment?: string; kind?: 'REPORT' | 'DATA_PROCESSOR' };
		let externalDto: ExternalDto;
		try {
			externalDto = JSON.parse(getRes.stdout.trim()) as ExternalDto;
		} catch {
			throw new Error('Не удалось разобрать свойства внешнего объекта.');
		}
		const dto: ExternalArtifactPropertiesDto = {
			kind: externalDto.kind === 'DATA_PROCESSOR' ? 'DATA_PROCESSOR' : 'REPORT',
			name: String(externalDto.name ?? ''),
			synonymRu: String(externalDto.synonymRu ?? ''),
			comment: String(externalDto.comment ?? ''),
		};
		return { schema, dto };
	}

	async function saveExternalArtifactPropertiesDto(
		objectXmlPath: string,
		cwd: string,
		schema: string,
		dto: ExternalArtifactPropertiesDto
	): Promise<boolean> {
		try {
			const payload = {
				name: dto.name,
				synonymRu: dto.synonymRu,
				comment: dto.comment,
			};
			const runtime = await ensureMdSparrowRuntime(context);
			const setRes = await runMdSparrowParamsMutation(
				runtime,
				{
					op: 'external-artifact-properties-set',
					objectXml: objectXmlPath,
					schemaVersion: schema,
					payloadJson: JSON.stringify(payload),
				},
				{ cwd }
			);
			if (setRes.exitCode !== 0) {
				const errText = (setRes.stderr.trim() || setRes.stdout.trim() || `код ${setRes.exitCode}`).slice(
					0,
					MD_SPARROW_CLI_ERR_PREVIEW
				);
				void vscode.window.showErrorMessage(errText);
				return false;
			}
			return true;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
			return false;
		}
	}

	async function openExternalArtifactPropertiesEditor(
		objectXmlPath: string,
		label: string,
		objectType: 'ExternalReport' | 'ExternalDataProcessor'
	): Promise<void> {
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(objectXmlPath);
		await runMdSparrowMutation(async () => {
			try {
				const { schema, dto } = await loadExternalArtifactPropertiesDto(objectXmlPath, cwd);
				await openExternalArtifactPropertiesPanel(
					context,
					label,
					dto,
					async (nextDto) => {
						const saved = await saveExternalArtifactPropertiesDto(
							objectXmlPath,
							cwd,
							schema,
							nextDto
						);
						if (!saved) {
							return false;
						}
						void vscode.window.showInformationMessage('Свойства сохранены.');
						await metadataTreeProvider.refresh();
						return true;
					}
				);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
			}
		});
	}

	async function addExternalArtifact(sourceKind: 'externalErf' | 'externalEpf'): Promise<void> {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			void vscode.window.showInformationMessage('Откройте папку проекта.');
			return;
		}
		const isReport = sourceKind === 'externalErf';
		const vrunner = VRunnerManager.getInstance(context);
		const rootRelative = isReport ? vrunner.getErfPath() : vrunner.getEpfPath();
		const rootAbs = path.resolve(workspaceRoot, rootRelative);
		try {
			await fs.promises.mkdir(rootAbs, { recursive: true });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
			return;
		}
		let existingNames: string[] = [];
		try {
			const entries = await fs.promises.readdir(rootAbs, { withFileTypes: true });
			existingNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
		} catch {
			existingNames = [];
		}
		const prefix = isReport ? 'ВнешнийОтчет' : 'ВнешняяОбработка';
		let nextIndex = 1;
		for (;;) {
			const candidate = `${prefix}${nextIndex}`;
			if (!existingNames.includes(candidate)) {
				const schema = await pickSchemaFlagInitEmptyCf(
					metadataTreeProvider.configurationXml ?? path.join(workspaceRoot, 'src', 'cf', 'Configuration.xml')
				);
				if (!schema) {
					return;
				}
				const runtime = await ensureMdSparrowRuntime(context);
				const res = await runMdSparrowParamsMutation(
					runtime,
					{
						op: 'external-artifact-add',
						artifactsRoot: rootAbs,
						name: candidate,
						kind: isReport ? 'REPORT' : 'DATA_PROCESSOR',
						schemaVersion: schema,
					},
					{ cwd: workspaceRoot }
				);
				if (res.exitCode !== 0) {
					const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
						0,
						MD_SPARROW_CLI_ERR_PREVIEW
					);
					void vscode.window.showErrorMessage(errText);
					return;
				}
				await metadataTreeProvider.refresh();
				void vscode.window.showInformationMessage(
					isReport
						? `Внешний отчёт «${candidate}» добавлен.`
						: `Внешняя обработка «${candidate}» добавлена.`
				);
				return;
			}
			nextIndex += 1;
		}
	}

	function parseExternalArtifactSourceKindFromArgs(
		args: readonly unknown[]
	): 'externalErf' | 'externalEpf' | undefined {
		for (const arg of args) {
			if (
				typeof arg === 'object' &&
				arg !== null &&
				'sourceKind' in arg &&
				((arg as { sourceKind?: unknown }).sourceKind === 'externalErf' ||
					(arg as { sourceKind?: unknown }).sourceKind === 'externalEpf')
			) {
				return (arg as { sourceKind: 'externalErf' | 'externalEpf' }).sourceKind;
			}
			if (Array.isArray(arg)) {
				const nested = parseExternalArtifactSourceKindFromArgs(arg);
				if (nested) {
					return nested;
				}
			}
		}
		return undefined;
	}

	type MutatableChildNodeKind = 'attribute' | 'tabularSection' | 'tabularAttribute';
	type MutatableChildNode = MetadataObjectNodeTreeItem & {
		nodeKind: MutatableChildNodeKind;
		owner: MetadataLeafTreeItem & {
			resourceUri: vscode.Uri;
			configurationXmlAbs: string;
			metadataRootAbs: string;
		};
	};
	type ChildNodeMutationMode = 'rename' | 'delete' | 'duplicate';

	function isMutatableChildNodeKind(kind: MetadataObjectNodeTreeItem['nodeKind']): kind is MutatableChildNodeKind {
		return kind === 'attribute' || kind === 'tabularSection' || kind === 'tabularAttribute';
	}

	/**
	 * Возвращает выбранный дочерний узел МД для операций rename/delete/duplicate.
	 *
	 * @param item Узел из контекстного меню.
	 * @param unsupportedMessage Текст для неподдерживаемых узлов.
	 * @returns Узел с поддерживаемым типом или `undefined`, если операция невозможна.
	 */
	function resolveChildNodeForMutation(
		item: MetadataObjectNodeTreeItem | undefined,
		unsupportedMessage: string
	): MutatableChildNode | undefined {
		const node = item ?? metadataTreeView.selection[0];
		if (!(node instanceof MetadataObjectNodeTreeItem)) {
			void vscode.window.showInformationMessage('Выберите узел метаданных.');
			return undefined;
		}
		if (!node.owner.resourceUri || !node.owner.configurationXmlAbs || !node.owner.metadataRootAbs) {
			void vscode.window.showInformationMessage('Недостаточно данных для операции.');
			return undefined;
		}
		if (!isMutatableChildNodeKind(node.nodeKind)) {
			void vscode.window.showInformationMessage(unsupportedMessage);
			return undefined;
		}
		return node as MutatableChildNode;
	}

	/**
	 * Строит аргументы CLI md-sparrow для мутаций дочерних узлов объекта.
	 *
	 * @param node Узел реквизита/табличной части/реквизита ТЧ.
	 * @param mode Режим мутации: rename, delete или duplicate.
	 * @param name Имя для операции (`new-name`/`name` в зависимости от режима).
	 * @returns Аргументы для вызова `runMdSparrow`.
	 */
	function buildChildNodeMutationParams(
		node: MutatableChildNode,
		mode: ChildNodeMutationMode,
		name: string
	): MdSparrowParams {
		const objectXmlPath = node.owner.resourceUri.fsPath;
		if (node.nodeKind === 'attribute') {
			if (mode === 'rename') {
				return { op: 'cf-md-attribute-rename', objectXml: objectXmlPath, oldName: node.name, newName: name };
			}
			if (mode === 'delete') {
				return { op: 'cf-md-attribute-delete', objectXml: objectXmlPath, name };
			}
			return { op: 'cf-md-attribute-duplicate', objectXml: objectXmlPath, sourceName: node.name, newName: name };
		}
		if (node.nodeKind === 'tabularSection') {
			if (mode === 'rename') {
				return { op: 'cf-md-tabular-section-rename', objectXml: objectXmlPath, oldName: node.name, newName: name };
			}
			if (mode === 'delete') {
				return { op: 'cf-md-tabular-section-delete', objectXml: objectXmlPath, name };
			}
			return { op: 'cf-md-tabular-section-duplicate', objectXml: objectXmlPath, sourceName: node.name, newName: name };
		}
		const tabularSectionName = node.tabularSectionName ?? '';
		if (mode === 'rename') {
			return {
				op: 'cf-md-tabular-attribute-rename',
				objectXml: objectXmlPath,
				tabularSection: tabularSectionName,
				oldName: node.name,
				newName: name,
			};
		}
		if (mode === 'delete') {
			return { op: 'cf-md-tabular-attribute-delete', objectXml: objectXmlPath, tabularSection: tabularSectionName, name };
		}
		return {
			op: 'cf-md-tabular-attribute-duplicate',
			objectXml: objectXmlPath,
			tabularSection: tabularSectionName,
			sourceName: node.name,
			newName: name,
		};
	}

	/**
	 * Выполняет мутацию дочернего узла объекта через md-sparrow и обновляет дерево.
	 *
	 * @param node Узел, к которому относится операция.
	 * @param params Параметры мутации без версии схемы.
	 * @param successMessage Сообщение после успешного завершения.
	 * @returns Промис, который разрешается после выполнения операции.
	 */
	async function runChildNodeMutation(
		node: MutatableChildNode,
		params: MdSparrowParams,
		successMessage: string
	): Promise<void> {
		const schema = await mdSparrowSchemaFlagFromConfigurationXml(node.owner.configurationXmlAbs);
		const runtime = await ensureMdSparrowRuntime(context);
		const res = await runMdSparrowParamsMutation(
			runtime,
			{ ...params, schemaVersion: schema },
			{ cwd: node.owner.metadataRootAbs }
		);
		if (res.exitCode !== 0) {
			const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
				0,
				MD_SPARROW_CLI_ERR_PREVIEW
			);
			void vscode.window.showErrorMessage(errText);
			return;
		}
		await metadataTreeProvider.refresh();
		void vscode.window.showInformationMessage(successMessage);
	}

	/** Флаг `-v` для init-empty-cf: из существующего Configuration.xml или выбор, если файла нет. */
	async function pickSchemaFlagInitEmptyCf(configurationXmlPath: string): Promise<string | undefined> {
		try {
			await fs.promises.access(configurationXmlPath);
			return await mdSparrowSchemaFlagFromConfigurationXml(configurationXmlPath);
		} catch {
			const formats = ['2.21', '2.20', '2.19', '2.18', '2.17', '2.16', '2.15', '2.14', '2.13', '2.12', '2.11', '2.10'];
			const pick = await vscode.window.showQuickPick(
				formats.map((f) => ({ label: `V${f.replace('.', '_')}`, description: `Схемы ${f}` })),
				{ title: 'Версия XSD для пустой выгрузки (нет Configuration.xml)' }
			);
			return pick?.label;
		}
	}

	function resolveErWorkspaceRoot(): string | undefined {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	}

	function erObjectKey(objectType: string, name: string): string {
		return `${objectType}.${name}`;
	}

	function buildErScope(params: {
		kind: ErScope['kind'];
		label: string;
		seeds: readonly string[];
		hops?: number;
	}): ErScope {
		return {
			kind: params.kind,
			label: params.label,
			seeds: params.seeds,
		hops: params.hops ?? (params.kind === 'selection' ? 0 : 1),
		objectTypes: [],
		relationKinds: null,
	};
	}

	const metadataDisposables: vscode.Disposable[] = [
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.er.openForObject',
			async (item?: MetadataLeafTreeItem) => {
			const node = resolveSelectedMetadataLeaf(item);
			if (!(node instanceof MetadataLeafTreeItem)) {
				void vscode.window.showInformationMessage('Выберите объект метаданных.');
				return;
			}
			const workspaceRoot = resolveErWorkspaceRoot();
				if (!workspaceRoot) {
					void vscode.window.showInformationMessage('Откройте папку проекта.');
					return;
				}
				const seedKey = erObjectKey(node.objectType, node.name);
				try {
					await openErCanvasPanel({
						context,
						workspaceRoot,
						initialScope: buildErScope({
							kind: 'selection',
							label: `${node.objectType}.${node.name}`,
							seeds: [seedKey],
							hops: 1,
						}),
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					void vscode.window.showErrorMessage(message.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
				}
			}
		),
		vscode.commands.registerCommand('1c-platform-tools.metadata.er.openCanvas', async () => {
			const workspaceRoot = resolveErWorkspaceRoot();
			if (!workspaceRoot) {
				void vscode.window.showInformationMessage('Откройте папку проекта.');
				return;
			}
			try {
				await openErCanvasPanel({
					context,
					workspaceRoot,
					initialScope: buildErScope({
						kind: 'selection',
						label: '',
						seeds: [],
						hops: 0,
					}),
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				void vscode.window.showErrorMessage(message.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
			}
		}),
		vscode.commands.registerCommand('1c-platform-tools.metadata.refresh', () => {
			void metadataTreeProvider.refresh();
		}),
		vscode.commands.registerCommand('1c-platform-tools.metadata.find', async () => {
			// Штатный виджет поиска ищет только по загруженным узлам, поэтому сперва раскрываем группы:
			// объекты уже в кэше дерева, повторных чтений не будет.
			for (const group of metadataTreeProvider.listGroupItems()) {
				try {
					await metadataTreeView.reveal(group, { expand: true, select: false, focus: false });
				} catch {
					// Узел мог исчезнуть после обновления дерева — остальные всё равно раскрываем.
				}
			}
			await vscode.commands.executeCommand('1c-platform-tools-metadata-tree.focus');
			await vscode.commands.executeCommand('list.find');
		}),
		vscode.commands.registerCommand('1c-platform-tools.metadata.filters.apply', async () => {
			const checked = metadataFilterProvider.checkedSubsystems;
			if (checked.length === 0) {
				void vscode.window.showInformationMessage('Отметьте подсистемы в панели «Фильтры».');
				return;
			}
			const label = checked.length === 1 ? checked[0].name : `подсистем: ${checked.length}`;
			const applied = await applySubsystemFilter(
				context,
				metadataTreeProvider,
				checked,
				metadataFilterProvider.options,
				label
			);
			if (applied) {
				void vscode.window.showInformationMessage(`Фильтр по подсистемам: ${label}`);
			}
		}),
		vscode.commands.registerCommand('1c-platform-tools.metadata.filters.reset', () => {
			metadataFilterProvider.clearChecked();
			void vscode.commands.executeCommand('1c-platform-tools.metadata.clearSubsystemFilter');
		}),
		vscode.commands.registerCommand('1c-platform-tools.metadata.addDocument', async () => {
			await vscode.commands.executeCommand('1c-platform-tools.metadata.addMdObject', 'DOCUMENT');
		}),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.addMdObject',
			async (...commandArgs: unknown[]) => {
				await runMdSparrowMutation(async () => {
					const kind = parseMdBoilerplateKindFromCommandArgs(commandArgs);
					if (!kind) {
						void vscode.window.showErrorMessage('Не указан вид метаданных.');
						return;
					}
					const paths = resolveCfPathsFromMetadataTree();
					if (!paths) {
						void vscode.window.showInformationMessage('Нет открытой папки проекта или выгрузки CF.');
						return;
					}
					const { cfgPath, cfRoot } = paths;
					try {
						await fs.promises.access(cfgPath);
					} catch {
						void vscode.window.showInformationMessage('Не найден Configuration.xml в выгрузке.');
						return;
					}
					try {
						const schema = await mdSparrowSchemaFlagFromConfigurationXml(cfgPath);
						const runtime = await ensureMdSparrowRuntime(context);
						const res = await runMdSparrowParamsMutation(
							runtime,
							{
								op: 'add-md-object',
								configurationXml: cfgPath,
								schemaVersion: schema,
								type: kind,
								autoName: true,
								synonymEmpty: kind === 'CATALOG' ? true : undefined,
							},
							{ cwd: cfRoot }
						);
						if (res.exitCode !== 0) {
							const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
								0,
								MD_SPARROW_CLI_ERR_PREVIEW
							);
							void vscode.window.showErrorMessage(errText);
							return;
						}
						const name = res.stdout.trim();
						if (!name) {
							void vscode.window.showErrorMessage('md-sparrow не вернул имя созданного объекта.');
							return;
						}
						await metadataTreeProvider.refresh();
						void vscode.window.showInformationMessage(`Объект метаданных «${name}» добавлен.`);
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
					}
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.createObject',
			async (...commandArgs: unknown[]) => {
				const sourceKind = parseExternalArtifactSourceKindFromArgs(commandArgs);
				if (sourceKind === 'externalErf') {
					await runMdSparrowMutation(async () => {
						await addExternalArtifact('externalErf');
					});
					return;
				}
				if (sourceKind === 'externalEpf') {
					await runMdSparrowMutation(async () => {
						await addExternalArtifact('externalEpf');
					});
					return;
				}
				const kind = parseMdBoilerplateKindFromCommandArgs(commandArgs);
				if (!kind) {
					void vscode.window.showInformationMessage('Выберите группу метаданных для добавления.');
					return;
				}
				await vscode.commands.executeCommand(
					'1c-platform-tools.metadata.addMdObject',
					kind
				);
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.renameObject',
			async (item?: MetadataLeafTreeItem) => {
				await runMdSparrowMutation(async () => {
					const node = resolveSelectedMetadataLeaf(item);
					if (!(node instanceof MetadataLeafTreeItem) || !node.resourceUri) {
						void vscode.window.showInformationMessage('Выберите объект в дереве метаданных.');
						return;
					}
					if (node.objectType === 'ExternalReport' || node.objectType === 'ExternalDataProcessor') {
						const nextName = await vscode.window.showInputBox({
							title: 'Переименование внешнего файла',
							placeHolder: 'Новое имя',
							value: node.name,
							validateInput: (value) => {
								const trimmed = value.trim();
								if (trimmed.length === 0) {
									return 'Введите имя.';
								}
								if (trimmed === node.name) {
									return 'Укажите имя, отличающееся от текущего.';
								}
								return null;
							},
						});
						if (!nextName) {
							return;
						}
						const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
						const cwd = workspaceRoot ?? path.dirname(node.resourceUri.fsPath);
						const schema = await mdSparrowSchemaFlagFromConfigurationXml(node.resourceUri.fsPath);
						const runtime = await ensureMdSparrowRuntime(context);
						const res = await runMdSparrowParamsMutation(
							runtime,
							{
								op: 'external-artifact-rename',
								objectXml: node.resourceUri.fsPath,
								newName: nextName.trim(),
								schemaVersion: schema,
							},
							{ cwd }
						);
						if (res.exitCode !== 0) {
							const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
								0,
								MD_SPARROW_CLI_ERR_PREVIEW
							);
							void vscode.window.showErrorMessage(errText);
							return;
						}
						await metadataTreeProvider.refresh();
						void vscode.window.showInformationMessage(
							`Внешний файл переименован: ${node.name} -> ${nextName.trim()}.`
						);
						return;
					}
					const tag = metadataObjectTypeToXmlTag[node.objectType];
					if (!tag) {
						void vscode.window.showInformationMessage('Переименование для этого типа пока недоступно.');
						return;
					}
					const nextName = await vscode.window.showInputBox({
						title: 'Переименование объекта',
						placeHolder: 'Новое имя объекта',
						value: node.name,
						validateInput: (value) => {
							const trimmed = value.trim();
							if (trimmed.length === 0) {
								return 'Введите имя объекта.';
							}
							if (trimmed === node.name) {
								return 'Укажите имя, отличающееся от текущего.';
							}
							return null;
						},
					});
					if (!nextName) {
						return;
					}
					const cfgPath = node.configurationXmlAbs;
					const cfRoot = node.metadataRootAbs;
					if (!cfgPath || !cfRoot) {
						void vscode.window.showInformationMessage('Нет выгрузки CF или Configuration.xml.');
						return;
					}
					const runtime = await ensureMdSparrowRuntime(context);
					const res = await runMdSparrowParamsMutation(
						runtime,
						{
							op: 'cf-md-object-rename',
							configurationXml: cfgPath,
							objectXml: node.resourceUri.fsPath,
							tag,
							oldName: node.name,
							newName: nextName.trim(),
						},
						{ cwd: cfRoot }
					);
					if (res.exitCode !== 0) {
						const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
							0,
							MD_SPARROW_CLI_ERR_PREVIEW
						);
						void vscode.window.showErrorMessage(errText);
						return;
					}
					await metadataTreeProvider.refresh();
					void vscode.window.showInformationMessage(`Объект переименован: ${node.name} -> ${nextName.trim()}.`);
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.deleteObject',
			async (item?: MetadataLeafTreeItem) => {
				await runMdSparrowMutation(async () => {
					const node = resolveSelectedMetadataLeaf(item);
					if (!(node instanceof MetadataLeafTreeItem) || !node.resourceUri) {
						void vscode.window.showInformationMessage('Выберите объект в дереве метаданных.');
						return;
					}
					if (node.objectType === 'ExternalReport' || node.objectType === 'ExternalDataProcessor') {
						const answer = await vscode.window.showWarningMessage(
							`Удалить внешний файл «${node.name}»?`,
							{ modal: true },
							'Удалить'
						);
						if (answer !== 'Удалить') {
							return;
						}
						const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
						const cwd = workspaceRoot ?? path.dirname(node.resourceUri.fsPath);
						const runtime = await ensureMdSparrowRuntime(context);
						const res = await runMdSparrowParamsMutation(
							runtime,
							{ op: 'external-artifact-delete', objectXml: node.resourceUri.fsPath },
							{ cwd }
						);
						if (res.exitCode !== 0) {
							const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
								0,
								MD_SPARROW_CLI_ERR_PREVIEW
							);
							void vscode.window.showErrorMessage(errText);
							return;
						}
						await metadataTreeProvider.refresh();
						void vscode.window.showInformationMessage(`Внешний файл «${node.name}» удалён.`);
						return;
					}
					const tag = metadataObjectTypeToXmlTag[node.objectType];
					if (!tag) {
						void vscode.window.showInformationMessage('Удаление для этого типа пока недоступно.');
						return;
					}
					const answer = await vscode.window.showWarningMessage(
						`Удалить объект «${node.name}»?`,
						{ modal: true },
						'Удалить'
					);
					if (answer !== 'Удалить') {
						return;
					}
					const cfgPath = node.configurationXmlAbs;
					const cfRoot = node.metadataRootAbs;
					if (!cfgPath || !cfRoot) {
						void vscode.window.showInformationMessage('Нет выгрузки CF или Configuration.xml.');
						return;
					}
					const runtime = await ensureMdSparrowRuntime(context);
					const res = await runMdSparrowParamsMutation(
						runtime,
						{
							op: 'cf-md-object-delete',
							configurationXml: cfgPath,
							objectXml: node.resourceUri.fsPath,
							tag,
							name: node.name,
						},
						{ cwd: cfRoot }
					);
					if (res.exitCode !== 0) {
						const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
							0,
							MD_SPARROW_CLI_ERR_PREVIEW
						);
						void vscode.window.showErrorMessage(errText);
						return;
					}
					await metadataTreeProvider.refresh();
					void vscode.window.showInformationMessage(`Объект «${node.name}» удалён.`);
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.duplicateObject',
			async (item?: MetadataLeafTreeItem) => {
				await runMdSparrowMutation(async () => {
					const node = resolveSelectedMetadataLeaf(item);
					if (!(node instanceof MetadataLeafTreeItem) || !node.resourceUri) {
						void vscode.window.showInformationMessage('Выберите объект в дереве метаданных.');
						return;
					}
					if (node.objectType === 'ExternalReport' || node.objectType === 'ExternalDataProcessor') {
						const nextName = await vscode.window.showInputBox({
							title: 'Дублирование внешнего файла',
							placeHolder: 'Имя копии',
							value: `${node.name}Копия`,
							validateInput: (value) => {
								if (value.trim().length === 0) {
									return 'Введите имя.';
								}
								return null;
							},
						});
						if (!nextName) {
							return;
						}
						const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
						const cwd = workspaceRoot ?? path.dirname(node.resourceUri.fsPath);
						const schema = await mdSparrowSchemaFlagFromConfigurationXml(node.resourceUri.fsPath);
						const runtime = await ensureMdSparrowRuntime(context);
						const res = await runMdSparrowParamsMutation(
							runtime,
							{
								op: 'external-artifact-duplicate',
								objectXml: node.resourceUri.fsPath,
								newName: nextName.trim(),
								schemaVersion: schema,
							},
							{ cwd }
						);
						if (res.exitCode !== 0) {
							const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
								0,
								MD_SPARROW_CLI_ERR_PREVIEW
							);
							void vscode.window.showErrorMessage(errText);
							return;
						}
						await metadataTreeProvider.refresh();
						void vscode.window.showInformationMessage(`Создана копия «${nextName.trim()}».`);
						return;
					}
					const tag = metadataObjectTypeToXmlTag[node.objectType];
					if (!tag) {
						void vscode.window.showInformationMessage('Дублирование для этого типа пока недоступно.');
						return;
					}
					const nextName = await vscode.window.showInputBox({
						title: 'Дублирование объекта',
						placeHolder: 'Имя копии',
						value: `${node.name}Копия`,
						validateInput: (value) => {
							if (value.trim().length === 0) {
								return 'Введите имя объекта.';
							}
							return null;
						},
					});
					if (!nextName) {
						return;
					}
					const cfgPath = node.configurationXmlAbs;
					const cfRoot = node.metadataRootAbs;
					if (!cfgPath || !cfRoot) {
						void vscode.window.showInformationMessage('Нет выгрузки CF или Configuration.xml.');
						return;
					}
					const runtime = await ensureMdSparrowRuntime(context);
					const res = await runMdSparrowParamsMutation(
						runtime,
						{
							op: 'cf-md-object-duplicate',
							configurationXml: cfgPath,
							objectXml: node.resourceUri.fsPath,
							tag,
							sourceName: node.name,
							newName: nextName.trim(),
						},
						{ cwd: cfRoot }
					);
					if (res.exitCode !== 0) {
						const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
							0,
							MD_SPARROW_CLI_ERR_PREVIEW
						);
						void vscode.window.showErrorMessage(errText);
						return;
					}
					await metadataTreeProvider.refresh();
					void vscode.window.showInformationMessage(`Создана копия «${nextName.trim()}».`);
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.addChildNode',
			async (item?: MetadataObjectNodeTreeItem | MetadataObjectSectionTreeItem | MetadataLeafTreeItem) => {
				await runMdSparrowMutation(async () => {
					const selected = item ?? metadataTreeView.selection[0];
					let leaf: MetadataLeafTreeItem | undefined;
					let params: MdSparrowParams | undefined;
					let okText: string | undefined;
					if (selected instanceof MetadataObjectNodeTreeItem && selected.nodeKind === 'tabularSection') {
						leaf = selected.owner;
						const name = await vscode.window.showInputBox({
							title: 'Новый реквизит табличной части',
							placeHolder: 'Имя реквизита',
							validateInput: (value) => (!value.trim() ? 'Введите имя.' : null),
						});
						if (!name) {
							return;
						}
						params = {
							op: 'cf-md-tabular-attribute-add',
							objectXml: leaf.resourceUri?.fsPath ?? '',
							tabularSection: selected.name,
							name: name.trim(),
						};
						okText = `Реквизит добавлен в табличную часть «${selected.name}».`;
					} else if (selected instanceof MetadataObjectSectionTreeItem) {
						leaf = selected.owner;
						if (selected.sectionKind !== 'attributes' && selected.sectionKind !== 'tabularSections') {
							void vscode.window.showInformationMessage('В этом разделе добавление не поддерживается.');
							return;
						}
						const title =
							selected.sectionKind === 'attributes' ? 'Новый реквизит' : 'Новая табличная часть';
						const name = await vscode.window.showInputBox({
							title,
							placeHolder: 'Имя',
							validateInput: (value) => (!value.trim() ? 'Введите имя.' : null),
						});
						if (!name) {
							return;
						}
						params =
							selected.sectionKind === 'attributes'
								? { op: 'cf-md-attribute-add', objectXml: leaf.resourceUri?.fsPath ?? '', name: name.trim() }
								: {
										op: 'cf-md-tabular-section-add',
										objectXml: leaf.resourceUri?.fsPath ?? '',
										name: name.trim(),
									};
						okText =
							selected.sectionKind === 'attributes'
								? `Реквизит «${name.trim()}» добавлен.`
								: `Табличная часть «${name.trim()}» добавлена.`;
					} else if (selected instanceof MetadataLeafTreeItem) {
						leaf = selected;
						const kind = await vscode.window.showQuickPick(
							[
								{ label: 'Реквизит', value: 'attribute' as const },
								{ label: 'Табличная часть', value: 'tabularSection' as const },
							],
							{ title: 'Что добавить?' }
						);
						if (!kind) {
							return;
						}
						const name = await vscode.window.showInputBox({
							title: kind.value === 'attribute' ? 'Новый реквизит' : 'Новая табличная часть',
							placeHolder: 'Имя',
							validateInput: (value) => (!value.trim() ? 'Введите имя.' : null),
						});
						if (!name) {
							return;
						}
						params =
							kind.value === 'attribute'
								? { op: 'cf-md-attribute-add', objectXml: leaf.resourceUri?.fsPath ?? '', name: name.trim() }
								: {
										op: 'cf-md-tabular-section-add',
										objectXml: leaf.resourceUri?.fsPath ?? '',
										name: name.trim(),
									};
						okText =
							kind.value === 'attribute'
								? `Реквизит «${name.trim()}» добавлен.`
								: `Табличная часть «${name.trim()}» добавлена.`;
					} else {
						void vscode.window.showInformationMessage('Выберите объект или табличную часть.');
						return;
					}

					if (!leaf.resourceUri || !leaf.configurationXmlAbs || !leaf.metadataRootAbs) {
						void vscode.window.showInformationMessage('Недостаточно данных для операции.');
						return;
					}
					const schema = await mdSparrowSchemaFlagFromConfigurationXml(leaf.configurationXmlAbs);
					const runtime = await ensureMdSparrowRuntime(context);
					const res = await runMdSparrowParamsMutation(runtime, { ...params, schemaVersion: schema }, {
						cwd: leaf.metadataRootAbs,
					});
					if (res.exitCode !== 0) {
						const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
							0,
							MD_SPARROW_CLI_ERR_PREVIEW
						);
						void vscode.window.showErrorMessage(errText);
						return;
					}
					await metadataTreeProvider.refresh();
					void vscode.window.showInformationMessage(okText);
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.renameChildNode',
			async (item?: MetadataObjectNodeTreeItem) => {
				await runMdSparrowMutation(async () => {
					const node = resolveChildNodeForMutation(item, 'Этот узел нельзя переименовать.');
					if (!node) {
						return;
					}
					const newName = await vscode.window.showInputBox({
						title: 'Переименование',
						value: node.name,
						validateInput: (value) => (!value.trim() ? 'Введите имя.' : null),
					});
					if (!newName || newName.trim() === node.name) {
						return;
					}
					const params = buildChildNodeMutationParams(node, 'rename', newName.trim());
					await runChildNodeMutation(node, params, 'Переименование выполнено.');
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.deleteChildNode',
			async (item?: MetadataObjectNodeTreeItem) => {
				await runMdSparrowMutation(async () => {
					const node = resolveChildNodeForMutation(item, 'Этот узел нельзя удалить.');
					if (!node) {
						return;
					}
					const answer = await vscode.window.showWarningMessage(`Удалить «${node.name}»?`, { modal: true }, 'Удалить');
					if (answer !== 'Удалить') {
						return;
					}
					const params = buildChildNodeMutationParams(node, 'delete', node.name);
					await runChildNodeMutation(node, params, 'Удаление выполнено.');
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.duplicateChildNode',
			async (item?: MetadataObjectNodeTreeItem) => {
				await runMdSparrowMutation(async () => {
					const node = resolveChildNodeForMutation(item, 'Этот узел нельзя дублировать.');
					if (!node) {
						return;
					}
					const newName = await vscode.window.showInputBox({
						title: 'Имя копии',
						value: `${node.name}Копия`,
						validateInput: (value) => (!value.trim() ? 'Введите имя.' : null),
					});
					if (!newName) {
						return;
					}
					const params = buildChildNodeMutationParams(node, 'duplicate', newName.trim());
					await runChildNodeMutation(node, params, 'Дублирование выполнено.');
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.filterBySubsystem',
			async (item?: MetadataLeafTreeItem) => {
				const node = resolveSelectedMetadataLeaf(item);
				if (!(node instanceof MetadataLeafTreeItem) || node.objectType !== 'Subsystem' || !node.resourceUri) {
					void vscode.window.showInformationMessage('Выберите подсистему в дереве метаданных.');
					return;
				}
				const applied = await applySubsystemFilter(
					context,
					metadataTreeProvider,
					[
						{
							sourceId: node.sourceId,
							name: node.name,
							xmlAbs: node.resourceUri.fsPath,
							configurationXmlAbs: node.configurationXmlAbs,
							metadataRootAbs: node.metadataRootAbs,
						},
					],
					{ includeNested: true, includeParents: false },
					node.name
				);
				if (applied) {
					void vscode.window.showInformationMessage(`Фильтр подсистемы: ${node.name}`);
				}
			}
		),
		vscode.commands.registerCommand('1c-platform-tools.metadata.clearSubsystemFilter', async () => {
			metadataTreeProvider.clearSubsystemFilter();
			void vscode.commands.executeCommand(
				'setContext',
				'1c-platform-tools.metadata.subsystemFilterActive',
				false
			);
			void vscode.window.showInformationMessage('Фильтр подсистемы сброшен.');
		}),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.copyObjectName',
			async (item?: MetadataLeafTreeItem) => {
				const node = resolveSelectedMetadataLeaf(item);
				if (!(node instanceof MetadataLeafTreeItem)) {
					void vscode.window.showInformationMessage('Выберите объект в дереве метаданных.');
					return;
				}
				await vscode.env.clipboard.writeText(node.name);
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.copyObjectPath',
			async (item?: MetadataLeafTreeItem) => {
				const node = resolveSelectedMetadataLeaf(item);
				if (!(node instanceof MetadataLeafTreeItem) || !node.resourceUri) {
					void vscode.window.showInformationMessage('Выберите объект с файлом в дереве метаданных.');
					return;
				}
				await vscode.env.clipboard.writeText(node.resourceUri.fsPath);
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openExternalConnectionModule',
			async (item?: MetadataSourceTreeItem) => {
				const source = resolveSelectedMetadataSource(item);
				if (!source || (source.sourceKind !== 'main' && source.sourceKind !== 'extension')) {
					void vscode.window.showInformationMessage('Выберите конфигурацию или расширение.');
					return;
				}
				const modulePath = await resolveModulePathForSource(source, 'ExternalConnectionModule.bsl');
				if (!modulePath) {
					void vscode.window.showInformationMessage('Модуль внешнего соединения не найден.');
					return;
				}
				await openTextFile(modulePath);
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openApplicationModule',
			async (item?: MetadataSourceTreeItem) => {
				const source = resolveSelectedMetadataSource(item);
				if (!source || (source.sourceKind !== 'main' && source.sourceKind !== 'extension')) {
					void vscode.window.showInformationMessage('Выберите конфигурацию или расширение.');
					return;
				}
				const managed = await resolveModulePathForSource(source, 'ManagedApplicationModule.bsl');
				const ordinary = await resolveModulePathForSource(source, 'OrdinaryApplicationModule.bsl');
				const modulePath = managed ?? ordinary;
				if (!modulePath) {
					void vscode.window.showInformationMessage('Модуль приложения не найден.');
					return;
				}
				await openTextFile(modulePath);
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openSessionModule',
			async (item?: MetadataSourceTreeItem) => {
				const source = resolveSelectedMetadataSource(item);
				if (!source || (source.sourceKind !== 'main' && source.sourceKind !== 'extension')) {
					void vscode.window.showInformationMessage('Выберите конфигурацию или расширение.');
					return;
				}
				const modulePath = await resolveModulePathForSource(source, 'SessionModule.bsl');
				if (!modulePath) {
					void vscode.window.showInformationMessage('Модуль сеанса не найден.');
					return;
				}
				await openTextFile(modulePath);
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openObjectModule',
			(item?: MetadataLeafTreeItem) => openObjectModuleOfKind(item, 'object')
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openRecordSetModule',
			(item?: MetadataLeafTreeItem) => openObjectModuleOfKind(item, 'recordset')
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openManagerModule',
			(item?: MetadataLeafTreeItem) => openObjectModuleOfKind(item, 'manager')
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openValueManagerModule',
			(item?: MetadataLeafTreeItem) => openObjectModuleOfKind(item, 'valueManager')
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openModule',
			(item?: MetadataLeafTreeItem) => openObjectModuleOfKind(item, 'module')
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openFormModule',
			(item?: MetadataLeafTreeItem) => openObjectModuleOfKind(item, 'form')
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openSourceProperties',
			async (item?: MetadataSourceTreeItem | MetadataLeafTreeItem) => {
				const source = resolveSelectedMetadataSource(
					item instanceof MetadataSourceTreeItem ? item : undefined
				);
				if (source?.configurationXmlAbs && source.metadataRootAbs) {
					await runMdSparrowMutation(async () => {
						try {
							const { schema, dto } = await loadSourcePropertiesDto(
								source.configurationXmlAbs!,
								source.metadataRootAbs!
							);
							await openMetadataSourcePropertiesPanel(
								context,
								{
									label: typeof source.label === 'string' ? source.label : source.sourceId,
									sourceKind: source.sourceKind,
								},
								dto,
								async (nextDto) => {
									const saved = await saveSourcePropertiesDto(
										source.configurationXmlAbs!,
										source.metadataRootAbs!,
										schema,
										nextDto
									);
									if (!saved) {
										return false;
									}
									void vscode.window.showInformationMessage('Свойства сохранены.');
									await metadataTreeProvider.refresh();
									return true;
								},
								async (moduleKind) => {
									if (moduleKind === 'externalConnection') {
										await vscode.commands.executeCommand(
											'1c-platform-tools.metadata.openExternalConnectionModule',
											source
										);
										return;
									}
									if (moduleKind === 'application') {
										await vscode.commands.executeCommand(
											'1c-platform-tools.metadata.openApplicationModule',
											source
										);
										return;
									}
									await vscode.commands.executeCommand(
										'1c-platform-tools.metadata.openSessionModule',
										source
									);
								}
							);
						} catch (e) {
							const msg = e instanceof Error ? e.message : String(e);
							void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
						}
					});
					return;
				}
				if (
					source?.sourceKind &&
					(source.sourceKind === 'externalErf' || source.sourceKind === 'externalEpf')
				) {
					const items = await listExternalArtifactXmlFromSource(source);
					if (items.length === 0) {
						void vscode.window.showInformationMessage('Внешние файлы не найдены.');
						return;
					}
					if (items.length === 1) {
						await openExternalArtifactPropertiesEditor(
							items[0].xmlPath,
							items[0].name,
							items[0].objectType
						);
						return;
					}
					const picked = await vscode.window.showQuickPick(
						items.map((x) => ({ label: x.name, description: x.xmlPath, item: x })),
						{ title: 'Выберите внешний файл' }
					);
					if (!picked) {
						return;
					}
					await openExternalArtifactPropertiesEditor(
						picked.item.xmlPath,
						picked.item.name,
						picked.item.objectType
					);
					return;
				}
				const node = resolveSelectedMetadataLeaf(
					item instanceof MetadataLeafTreeItem ? item : undefined
				);
				if (
					node instanceof MetadataLeafTreeItem &&
					node.resourceUri &&
					(node.objectType === 'ExternalReport' || node.objectType === 'ExternalDataProcessor')
				) {
					await openExternalArtifactPropertiesEditor(
						node.resourceUri.fsPath,
						node.name,
						node.objectType as 'ExternalReport' | 'ExternalDataProcessor'
					);
					return;
				}
				if (node?.resourceUri) {
					await openTextFile(node.resourceUri.fsPath);
					return;
				}
				void vscode.window.showInformationMessage('Свойства для выбранного узла недоступны.');
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openSourceXml',
			async (item?: MetadataSourceTreeItem | MetadataLeafTreeItem) => {
				const source = resolveSelectedMetadataSource(
					item instanceof MetadataSourceTreeItem ? item : undefined
				);
				if (source?.configurationXmlAbs) {
					await openTextFile(source.configurationXmlAbs);
					return;
				}
				if (source?.metadataRootAbs) {
					const firstXml = await resolveFirstXmlInDir(source.metadataRootAbs);
					if (firstXml) {
						await openTextFile(firstXml);
						return;
					}
				}
				const node = resolveSelectedMetadataLeaf(
					item instanceof MetadataLeafTreeItem ? item : undefined
				);
				if (node?.resourceUri) {
					await openTextFile(node.resourceUri.fsPath);
					return;
				}
				void vscode.window.showInformationMessage('XML для выбранного узла не найден.');
			}
		),
		vscode.commands.registerCommand('1c-platform-tools.metadata.initEmptyCf', async () => {
			await runMdSparrowMutation(async () => {
				const cfRoot = metadataTreeProvider.resolveCfRoot();
				if (!cfRoot) {
					void vscode.window.showInformationMessage('Нет открытой папки проекта или выгрузки CF.');
					return;
				}
				const configurationXmlPath = path.join(cfRoot, 'Configuration.xml');
				let hasConfigurationXml = false;
				try {
					await fs.promises.access(configurationXmlPath);
					hasConfigurationXml = true;
				} catch {
					/* нет корня выгрузки */
				}
				if (hasConfigurationXml) {
					const answer = await vscode.window.showWarningMessage(
						'Уже есть конфигурация. Все метаданные будут удалены. Продолжить?',
						{ modal: true },
						'Продолжить'
					);
					if (answer !== 'Продолжить') {
						return;
					}
				}
				const schema = await pickSchemaFlagInitEmptyCf(configurationXmlPath);
				if (!schema) {
					return;
				}
				try {
					const runtime = await ensureMdSparrowRuntime(context);
					const res = await runMdSparrowParamsMutation(
						runtime,
						{ op: 'init-empty-cf', targetCfRoot: cfRoot, schemaVersion: schema },
						{ cwd: cfRoot }
					);
					if (res.exitCode !== 0) {
						const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
							0,
							MD_SPARROW_CLI_ERR_PREVIEW
						);
						void vscode.window.showErrorMessage(errText);
						return;
					}
					await metadataTreeProvider.refresh();
					void vscode.window.showInformationMessage('Пустая конфигурация создана.');
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
				}
			});
		}),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openObjectProperties',
			async (item?: MetadataLeafTreeItem) => {
				let node = item;
				if (!node && metadataTreeView.selection.length > 0) {
					const sel = metadataTreeView.selection[0];
					if (sel instanceof MetadataLeafTreeItem) {
						node = sel;
					}
				}
				if (!(node instanceof MetadataLeafTreeItem) || !node.resourceUri) {
					void vscode.window.showInformationMessage('Выберите объект в дереве метаданных.');
					return;
				}
				let schemaFlagFallback: string | undefined;
				if (!node.configurationXmlAbs) {
					schemaFlagFallback = metadataTreeProvider.getCachedTree()?.mainSchemaVersionFlag;
					if (!schemaFlagFallback) {
						const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
						if (workspaceRoot) {
							const dto = await loadProjectMetadataTree(context, workspaceRoot);
							schemaFlagFallback = dto.mainSchemaVersionFlag;
						}
					}
				}
				if (!node.configurationXmlAbs && !schemaFlagFallback) {
					void vscode.window.showInformationMessage('Не удалось определить схему для чтения свойств.');
					return;
				}
				await openMetadataObjectPropertiesEditor(
					context,
					{
						objectXmlFsPath: node.resourceUri.fsPath,
						cfgPath: node.configurationXmlAbs,
						schemaFlag: schemaFlagFallback,
						cwd: node.metadataRootAbs ?? path.dirname(node.resourceUri.fsPath),
						objectType: node.objectType,
						enqueueMutation: runMdSparrowMutation,
					}
				);
			}
		),
		vscode.commands.registerCommand('1c-platform-tools.metadata.getProjectTree', async () => {
			const cached = metadataTreeProvider.getCachedTree();
			if (cached) {
				return cached;
			}
			const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!root) {
				return undefined;
			}
			return loadProjectMetadataTree(context, root);
		}),
		vscode.commands.registerCommand('1c-platform-tools.components.update', async () => {
			const [adapterTag, jarTag] = await Promise.all([
				cachedOnecDebugAdapterTag(context),
				cachedMdSparrowTag(context),
			]);
			const picked = await vscode.window.showQuickPick(
				[
					{ label: 'Отладчик', description: adapterTag ?? 'не загружен', value: 'adapter' as const, picked: true },
					{ label: 'Дерево метаданных', description: jarTag ?? 'не загружен', value: 'jar' as const, picked: true },
					{
						label: 'Portable JRE',
						description: portableJreCached(context) ? 'загружена' : 'не загружена',
						value: 'jre' as const,
						picked: false,
					},
				],
				{
					title: 'Обновить внешние компоненты',
					canPickMany: true,
					placeHolder: 'Выбранные компоненты будут загружены заново при следующем использовании',
				}
			);
			if (!picked || picked.length === 0) {
				return;
			}
			const values = new Set(picked.map((p) => p.value));
			if (values.has('adapter')) {
				await clearOnecDebugAdapterCache(context);
			}
			if (values.has('jar')) {
				await clearMdSparrowJarCache(context);
			}
			if (values.has('jre')) {
				await clearPortableJreCache(context);
			}
			void vscode.window.showInformationMessage(
				'Компоненты будут загружены заново при следующем использовании.'
			);
			if (values.has('jar') || values.has('jre')) {
				void metadataTreeProvider.refresh();
			}
		}),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('1c-platform-tools.metadata')) {
				void metadataTreeProvider.refresh();
			}
		}),
	];

	return metadataDisposables;
}
