import * as fs from 'node:fs';
import { createEdtProject } from '../edt/edtCommands';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { BSP_REGISTRATION_MARKER, buildBspRegistration } from './bspRegistration';
import { VRunnerManager } from '../../shared/vrunnerManager';
import {
	ensureMdSparrowRuntime,
} from './mdSparrowBootstrap';
import { parseMdBoilerplateKindFromCommandArgs } from './metadataBoilerplateNames';
import {
	childKindAddedMessage,
	childKindIsMutatable,
	childKindNeedsTabularSection,
	childKindOfSection,
	childKindTitle,
	childMutationOp,
	childSupportElementKey,
	type ChildMutationMode,
	type MutatableChildKind,
} from './metadataChildMutations';
import { createMdSparrowMutationRunner } from './mdSparrowMutationQueue';
import type { MetadataFilterViewProvider } from './metadataFilterView';
import { MetadataSearchViewProvider } from './metadataSearchView';
import { computeSubsystemFilter, findSubsystemByName, loadSubsystemTrees } from './metadataSubsystemFilter';
import {
	mdObjectKindLabel,
	openMetadataObjectPropertiesEditor,
	runMdSparrowJson,
} from './metadataObjectPropertiesPanel';
import { PRIMITIVE_TYPES, refTypeName } from './metadataObjectEditSpec';
import { childNodeDtoList } from '../properties/childNodePropertiesSpec';
import { openFormViewer } from './formViewerPanel';
import {
	configurationModuleFile,
	formContentFileOf,
	formDescriptorFileOf,
	formModuleFileOf,
	formModuleNextTo,
	formatOfFile,
	moduleFileOf,
	templateContentFileOf,
	templateDescriptorFileOf,
} from '../../shared/objectPaths';
import { ensureBslModuleFile } from './bslModuleFile';
import type { PropertyPaletteViewProvider } from '../properties/propertyPaletteView';
import { registerMetadataPaletteSource } from '../properties/metadataPaletteSource';
import {
	openMetadataSourcePropertiesPanel,
	type SourcePropertiesDto,
	type SourcePropertyDictionaries,
	type SourceSupportState,
} from './metadataSourcePropertiesPanel';
import { mdSparrowSchemaFlagFromConfigurationXml } from './mdSparrowSchemaVersion';
import {
	runMdSparrowParamsMutation,
	runMdSparrowParamsRead,
	type MdSparrowParams,
	supportEnabled,
} from './mdSparrowParams';
import { openDcsEditorPanel } from './dcsEditorPanel';
import { loadProjectMetadataTree } from './metadataTreeService';
import { openErCanvasPanel } from './er/erCanvasPanel';
import type { ErScope } from './er/erTypes';
import {
	defaultMetadataLeafOpenCommand,
	isMetadataCommonForm,
	MetadataLeafTreeItem,
	MetadataMdGroupTreeItem,
	MetadataMdSubgroupTreeItem,
	MetadataObjectNodeTreeItem,
	MetadataObjectSectionTreeItem,
	MetadataSourceTreeItem,
	childNodeSupport,
	objectModuleFilePath,
	objectModuleKindsForType,
	type MetadataTreeDataProvider,
	type ObjectModuleKind,
} from './metadataTreeView';
import { notifyQuiet } from '../../shared/notify';
import { showComponentError } from '../../shared/githubToken';
import { uiOnlyHandler } from '../../shared/agentGate';
import { describeComponentState, readComponentStates } from '../../shared/componentsRegistry';
import { CfDumpFinding, DumpValidationDiagnostics } from './dumpValidationDiagnostics';
import { metadataCompileTarget, type MetadataCompileKind } from './metadataCompileTarget';
import { ArtifactCommands } from '../../commands/artifactCommands';

export interface RegisterMetadataFeatureParams {
	context: vscode.ExtensionContext;
	metadataTreeProvider: MetadataTreeDataProvider;
	metadataTreeView: vscode.TreeView<vscode.TreeItem>;
	metadataSearchProvider: MetadataSearchViewProvider;
	metadataFilterProvider: MetadataFilterViewProvider;
	propertyPaletteProvider: PropertyPaletteViewProvider;
}

/** Правила поддержки: слова и порядок окна правила поддержки конфигуратора. */
const SUPPORT_RULE_PICKS: ReadonlyArray<{ readonly label: string; readonly mode: string }> = [
	{ label: 'Объект поставщика не редактируется', mode: '0' },
	{ label: 'Объект поставщика редактируется с сохранением поддержки', mode: '1' },
	{ label: 'Объект поставщика снят с поддержки', mode: '2' },
];

/** Область правила: у конфигуратора это флажок «Установить для подчинённых объектов». */
const SUPPORT_SCOPE_PICKS: ReadonlyArray<{ readonly label: string; readonly children: boolean }> = [
	{ label: 'Без подчинённых объектов', children: false },
	{ label: 'С подчинёнными объектами', children: true },
];

/** Спрашивает правило поддержки и область; пусто, когда выбор прерван. */
async function askSupportRule(
	subject: string
): Promise<{ mode: string; label: string; children: boolean } | undefined> {
	const picked = await vscode.window.showQuickPick([...SUPPORT_RULE_PICKS], {
		placeHolder: `Правило поддержки: ${subject}`,
	});
	if (!picked) {
		return undefined;
	}
	const scope = await vscode.window.showQuickPick([...SUPPORT_SCOPE_PICKS], {
		placeHolder: 'Установить правило для подчинённых объектов?',
	});
	if (!scope) {
		return undefined;
	}
	return { mode: picked.mode, label: picked.label, children: scope.children };
}

/**
 * Регистрирует команды и runtime-обработчики фичи «1С: Метаданные».
 */
export function registerMetadataFeature(
	params: RegisterMetadataFeatureParams
): vscode.Disposable[] {
	const {
		context,
		metadataTreeProvider,
		metadataTreeView,
		metadataFilterProvider,
		propertyPaletteProvider,
	} = params;

	const MD_SPARROW_CLI_ERR_PREVIEW = 500;
	const artifactCommands = new ArtifactCommands();

	// Палитра показывает свойства выделенного в дереве: объект, конфигурацию, внешний отчёт.
	const paletteSource = registerMetadataPaletteSource({
		context,
		metadataTreeProvider,
		metadataTreeView,
		propertyPaletteProvider,
	});

	/**
	 * Показывает в дереве объект, которому принадлежит файл: сам XML, модуль, форму или макет.
	 * Дерево читается один раз за сеанс, поэтому пустое сперва обновляем.
	 */
	async function revealMetadataObjectInTree(uri: vscode.Uri | undefined): Promise<void> {
		if (!uri || uri.scheme !== 'file') {
			void vscode.window.showInformationMessage('Нет открытого файла, для которого искать объект метаданных.');
			return;
		}
		if (!metadataTreeProvider.getCachedTree()) {
			await metadataTreeProvider.refresh();
		}
		const leaf = await metadataTreeProvider.findNodeForFile(uri.fsPath);
		if (!leaf) {
			void vscode.window.showInformationMessage(
				`Объект метаданных для файла не найден: ${path.basename(uri.fsPath)}`
			);
			return;
		}
		if (metadataTreeProvider.isHiddenByFilter(leaf)) {
			const reset = 'Сбросить отбор';
			const answer = await vscode.window.showWarningMessage(
				'Объект скрыт поиском или отбором по подсистемам, поэтому в дереве его не видно.',
				reset
			);
			if (answer !== reset) {
				return;
			}
			metadataTreeProvider.setTextFilter('');
			metadataFilterProvider.clear();
		}
		await vscode.commands.executeCommand('1c-platform-tools-metadata-tree.focus');
		await metadataTreeView.reveal(leaf, { select: true, focus: true, expand: false });
	}

	const runMdSparrowMutation = createMdSparrowMutationRunner();

	/** Находки проверки выгрузки живут в своей коллекции: их снимает и ставит только проверка. */
	const dumpValidation = new DumpValidationDiagnostics();

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

	/** Каталоги расширений проекта: у каждого свой Configuration.xml. */
	function listExtensionRoots(): string[] {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!root) {
			return [];
		}
		const cfeRoot = path.join(root, VRunnerManager.getInstance(context).getCfePath());
		if (!fs.existsSync(cfeRoot)) {
			return [];
		}
		return fs
			.readdirSync(cfeRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => path.join(cfeRoot, entry.name))
			.filter((dir) => fs.existsSync(path.join(dir, 'Configuration.xml')));
	}

	async function openTextFile(pathToOpen: string): Promise<void> {
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(pathToOpen));
		await vscode.window.showTextDocument(doc, { preview: false });
	}

	/**
	 * Версия формата основной конфигурации.
	 *
	 * Нужна там, где у объекта своего Configuration.xml нет: у внешних отчётов и
	 * обработок. Без неё чтение формы и свойств останавливалось на «не удалось
	 * определить схему XSD».
	 */
	async function mainSchemaFlag(): Promise<string | undefined> {
		const cached = metadataTreeProvider.getCachedTree()?.mainSchemaVersionFlag;
		if (cached !== undefined) {
			return cached;
		}
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			return undefined;
		}
		return (await loadProjectMetadataTree(context, workspaceRoot)).mainSchemaVersionFlag;
	}

	async function openFormViewerForXml(
		formXml: string,
		moduleFsPath: string,
		title: string,
		owner: { metadataRootAbs?: string; configurationXmlAbs?: string; resourceUri: vscode.Uri }
	): Promise<void> {
		await openFormViewer(context, {
			formXmlFsPath: formXml,
			moduleFsPath,
			title,
			cwd: owner.metadataRootAbs ?? path.dirname(owner.resourceUri.fsPath),
			cfgPath: owner.configurationXmlAbs,
			schemaFlag: owner.configurationXmlAbs ? undefined : await mainSchemaFlag(),
			propertyPalette: propertyPaletteProvider,
		});
	}

	/** Общая форма: тот же просмотрщик, что у формы справочника. */
	async function openCommonFormFromLeaf(node: MetadataLeafTreeItem): Promise<void> {
		if (!node.resourceUri) {
			void vscode.window.showErrorMessage('Не удалось открыть форму.');
			return;
		}
		const formXml = formContentFileOf(node.resourceUri.fsPath);
		if (!fs.existsSync(formXml)) {
			void vscode.window.showErrorMessage(`Не найден файл формы: ${formXml}`);
			return;
		}
		await openFormViewerForXml(formXml, formModuleNextTo(formXml), node.name, {
			metadataRootAbs: node.metadataRootAbs,
			configurationXmlAbs: node.configurationXmlAbs,
			resourceUri: node.resourceUri,
		});
	}

	/**
	 * Открывает свойства объекта метаданных отдельной вкладкой.
	 *
	 * Общая форма сюда не попадает: её свойства живут в самой форме, поэтому для
	 * неё открывается просмотрщик формы.
	 */
	/** Удаляет форму объекта вместе с файлами после подтверждения. */
	async function deleteObjectFormFromTree(node: MetadataObjectNodeTreeItem): Promise<void> {
		const owner = node.owner;
		if (!owner.resourceUri) {
			return;
		}
		// У формы своё правило поддержки: разрешение на объект её не открывает
		if (refuseLockedBySupport(childNodeSupport(owner.support, node.support, true), 'Форма')) {
			return;
		}
		const answer = await vscode.window.showWarningMessage(
			`Удалить форму «${node.name}» вместе с файлами?`,
			{ modal: true },
			'Удалить'
		);
		if (answer !== 'Удалить') {
			return;
		}
		const schema = owner.configurationXmlAbs
			? await mdSparrowSchemaFlagFromConfigurationXml(owner.configurationXmlAbs)
			: await mainSchemaFlag();
		if (schema === undefined) {
			return;
		}
		const runtime = await ensureMdSparrowRuntime(context);
		const res = await runMdSparrowParamsMutation(
			runtime,
			{ op: 'cf-md-form-delete', objectXml: owner.resourceUri.fsPath, name: node.name, schemaVersion: schema },
			{ cwd: owner.metadataRootAbs ?? path.dirname(owner.resourceUri.fsPath) }
		);
		if (res.exitCode !== 0) {
			void vscode.window.showErrorMessage(
				`Не удалось удалить форму. ${(res.stderr || res.stdout).trim()}`.slice(0, 400)
			);
			return;
		}
		notifyQuiet(`Форма «${node.name}» удалена`);
		void vscode.commands.executeCommand('1c-platform-tools.metadata.refresh');
	}

	/** Создаёт пустую управляемую форму объекта из эталона платформы. */
	async function addObjectFormFromTree(leaf: MetadataLeafTreeItem): Promise<void> {
		if (!leaf.resourceUri) {
			void vscode.window.showInformationMessage('У объекта нет файла в выгрузке.');
			return;
		}
		if (refuseLockedBySupport(leaf.support)) {
			return;
		}
		const name = await vscode.window.showInputBox({
			title: 'Новая форма',
			placeHolder: 'Имя',
			validateInput: (value) => (!value.trim() ? 'Введите имя.' : null),
		});
		if (!name) {
			return;
		}
		const schema = leaf.configurationXmlAbs
			? await mdSparrowSchemaFlagFromConfigurationXml(leaf.configurationXmlAbs)
			: await mainSchemaFlag();
		if (schema === undefined) {
			void vscode.window.showWarningMessage('Не удалось определить схему для правки состава.');
			return;
		}
		const runtime = await ensureMdSparrowRuntime(context);
		const res = await runMdSparrowParamsMutation(
			runtime,
			{ op: 'cf-form-add', objectXml: leaf.resourceUri.fsPath, name: name.trim(), schemaVersion: schema },
			{ cwd: leaf.metadataRootAbs ?? path.dirname(leaf.resourceUri.fsPath) }
		);
		if (res.exitCode !== 0) {
			void vscode.window.showErrorMessage(
				`Не удалось создать форму. ${(res.stderr || res.stdout).trim()}`.slice(0, 400)
			);
			return;
		}
		notifyQuiet(`Форма «${name.trim()}» создана`);
		void vscode.commands.executeCommand('1c-platform-tools.metadata.refresh');
	}

	async function openObjectPropertiesTab(node: MetadataLeafTreeItem, initialTabId?: string): Promise<void> {
		if (!node.resourceUri) {
			void vscode.window.showInformationMessage('У объекта нет файла в выгрузке.');
			return;
		}
		const schemaFlagFallback = node.configurationXmlAbs ? undefined : await mainSchemaFlag();
		if (!node.configurationXmlAbs && schemaFlagFallback === undefined) {
			void vscode.window.showWarningMessage('Не удалось определить схему для чтения свойств.');
			return;
		}
		await openMetadataObjectPropertiesEditor(context, {
			objectXmlFsPath: node.resourceUri.fsPath,
			cfgPath: node.configurationXmlAbs,
			schemaFlag: schemaFlagFallback,
			cwd: node.metadataRootAbs ?? path.dirname(node.resourceUri.fsPath),
			objectType: node.objectType,
			initialTabId,
			enqueueMutation: runMdSparrowMutation,
		});
	}

	/** Скрытый алиас: то же, что клик по объекту — команда из меню, не отдельный путь. */
	async function openMetadataLeaf(item?: MetadataLeafTreeItem): Promise<void> {
		const node = resolveSelectedMetadataLeaf(item);
		if (!node) {
			void vscode.window.showInformationMessage('Выберите объект в дереве метаданных.');
			return;
		}
		const command = defaultMetadataLeafOpenCommand(node);
		if (!command) {
			void vscode.window.showInformationMessage('Для этого объекта нечего открывать.');
			return;
		}
		await vscode.commands.executeCommand(command, node);
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
		await openOrCreateModuleFile(objectModuleFilePath(node.resourceUri.fsPath, kind));
	}

	async function openOrCreateModuleFile(modulePath: string): Promise<void> {
		try {
			const created = await ensureBslModuleFile(modulePath);
			await openTextFile(modulePath);
			if (created) {
				notifyQuiet(`Создан пустой модуль: ${path.basename(modulePath)}`);
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			void vscode.window.showErrorMessage(`Не удалось открыть модуль: ${msg}`);
		}
	}

	async function openFormModuleFromTree(item?: MetadataLeafTreeItem | MetadataObjectNodeTreeItem): Promise<void> {
		const node = item ?? metadataTreeView.selection[0];
		if (node instanceof MetadataObjectNodeTreeItem && node.nodeKind === 'form') {
			const owner = node.owner;
			if (!owner.resourceUri) {
				void vscode.window.showInformationMessage('У формы нет объекта-владельца.');
				return;
			}
			await openOrCreateModuleFile(formModuleFileOf(owner.resourceUri.fsPath, node.name));
			return;
		}
		if (node instanceof MetadataLeafTreeItem && isMetadataCommonForm(node.objectType)) {
			await openObjectModuleOfKind(node, 'form');
			return;
		}
		void vscode.window.showInformationMessage('Выберите форму в дереве метаданных.');
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
		const format = source.configurationXmlAbs ? formatOfFile(source.configurationXmlAbs) : 'designer';
		const exact = configurationModuleFile(source.metadataRootAbs, format, moduleFileName);
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
	): Promise<{
		schema: string;
		dto: SourcePropertiesDto;
		dictionaries: SourcePropertyDictionaries;
		support: SourceSupportState | undefined;
	}> {
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
		return {
			schema,
			dto,
			dictionaries: await loadSourcePropertyDictionaries(cfgPath, cfRoot, schema),
			support: await loadSourceSupportState(cfgPath, cfRoot),
		};
	}

	/** Поддержка выгрузки: поставщик и состояние правил; без правил - пусто. */
	async function loadSourceSupportState(
		cfgPath: string,
		cfRoot: string
	): Promise<SourceSupportState | undefined> {
		if (!supportEnabled()) {
			return undefined;
		}
		try {
			const runtime = await ensureMdSparrowRuntime(context);
			const res = await runMdSparrowParamsRead(
				runtime,
				{ op: 'cf-support-get', configurationXml: cfgPath },
				{ cwd: cfRoot }
			);
			if (res.exitCode !== 0) {
				return undefined;
			}
			const state = JSON.parse(res.stdout.trim()) as SourceSupportState;
			return state.configurationState ? state : undefined;
		} catch {
			return undefined;
		}
	}

	/** Перечисления и подписи значений: панель показывает словами то, что в файле кодами. */
	async function loadSourcePropertyDictionaries(
		cfgPath: string,
		cfRoot: string,
		schema: string
	): Promise<SourcePropertyDictionaries> {
		const empty: SourcePropertyDictionaries = { enums: {}, labels: { values: {}, byProperty: {} } };
		try {
			const runtime = await ensureMdSparrowRuntime(context);
			const [enumsRes, labelsRes] = await Promise.all([
				runMdSparrowParamsRead(
					runtime,
					{ op: 'cf-md-object-enums', configurationXml: cfgPath, schemaVersion: schema },
					{ cwd: cfRoot }
				),
				runMdSparrowParamsRead(runtime, { op: 'cf-enum-labels' }, { cwd: cfRoot }),
			]);
			const enumsAll =
				enumsRes.exitCode === 0
					? (JSON.parse(enumsRes.stdout.trim()) as Record<string, string[]>)
					: {};
			const enums: Record<string, string[]> = {};
			for (const [key, values] of Object.entries(enumsAll)) {
				if (key.startsWith('configuration.')) {
					enums[key.slice('configuration.'.length)] = values;
				}
			}
			const labels =
				labelsRes.exitCode === 0
					? (JSON.parse(labelsRes.stdout.trim()) as SourcePropertyDictionaries['labels'])
					: empty.labels;
			const rolesRes = await runMdSparrowParamsRead(
				runtime,
				{ op: 'cf-list-child-objects', configurationXml: cfgPath, tag: 'Role', schemaVersion: schema },
				{ cwd: cfRoot }
			);
			const roleNames =
				rolesRes.exitCode === 0 ? (JSON.parse(rolesRes.stdout.trim()) as string[]) : [];
			return { enums, labels, roleNames };
		} catch {
			return empty;
		}
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

	/**
	 * Свойства внешнего отчёта или обработки: та же вкладка, что у объекта
	 * конфигурации. Отдельная форма показывала только имя, синоним и комментарий
	 * и выглядела совсем иначе.
	 */
	async function openExternalArtifactPropertiesEditor(
		objectXmlPath: string,
		objectType: 'ExternalReport' | 'ExternalDataProcessor'
	): Promise<void> {
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(objectXmlPath);
		const schemaFlag = await mainSchemaFlag();
		if (schemaFlag === undefined) {
			void vscode.window.showWarningMessage('Не удалось определить схему для чтения свойств.');
			return;
		}
		await openMetadataObjectPropertiesEditor(context, {
			objectXmlFsPath: objectXmlPath,
			schemaFlag,
			cwd,
			objectType,
			enqueueMutation: runMdSparrowMutation,
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

	type MutatableChildNode = MetadataObjectNodeTreeItem & {
		nodeKind: MutatableChildKind;
		owner: MetadataLeafTreeItem & { resourceUri: vscode.Uri };
	};

	/**
	 * Возвращает выбранный узел состава для операций rename/delete/duplicate.
	 *
	 * @param item Узел из контекстного меню.
	 * @param unsupportedMessage Текст для видов узлов, которых md-sparrow не правит.
	 * @returns Узел с поддерживаемым видом или {@code undefined}.
	 */
	/** Файл описания формы или макета: у них свои свойства и своё правило поддержки. */
	/** Свой файл описания формы или макета; у EDT их свойства записаны в описании владельца. */
	function childDescriptorXmlPath(node: MetadataObjectNodeTreeItem): string | undefined {
		const owner = node.owner;
		if (!owner.resourceUri) {
			return undefined;
		}
		if (node.nodeKind === 'form') {
			return formDescriptorFileOf(owner.resourceUri.fsPath, node.name);
		}
		if (node.nodeKind === 'template') {
			return templateDescriptorFileOf(owner.resourceUri.fsPath, node.name);
		}
		return undefined;
	}

	/**
	 * Правка объекта поставщика без возможности изменения: команда остаётся в
	 * меню, но объясняет отказ, а не выполняется молча.
	 *
	 * @returns true, если правку выполнять нельзя
	 */
	/**
	 * Ставит правило поддержки самой конфигурации.
	 *
	 * Окно правила у конфигуратора одно на все субъекты, и корень конфигурации в нём такой же
	 * узел: у него своя запись в правилах, а «подчинённые» - вся выгрузка.
	 */
	async function setSupportRuleForConfiguration(source: MetadataSourceTreeItem): Promise<void> {
		if (!source.configurationXmlAbs) {
			void vscode.window.showInformationMessage('Выберите конфигурацию в дереве.');
			return;
		}
		if (source.supportEditingEnabled !== true) {
			void vscode.window.showInformationMessage(
				'Возможность изменения конфигурации не включена: включите её в конфигураторе'
					+ ' или снимите конфигурацию с поддержки.'
			);
			return;
		}
		const picked = await askSupportRule(typeof source.label === 'string' ? source.label : 'конфигурация');
		if (!picked) {
			return;
		}
		const runtime = await ensureMdSparrowRuntime(context);
		const res = await runMdSparrowParamsMutation(
			runtime,
			{
				op: 'cf-support-object-mode-set',
				objectXml: source.configurationXmlAbs,
				configurationXml: source.configurationXmlAbs,
				name: picked.mode,
				tag: picked.children ? 'children' : undefined,
				expectedGeneration: source.supportGeneration,
			},
			{ cwd: source.metadataRootAbs ?? path.dirname(source.configurationXmlAbs) }
		);
		if (res.exitCode !== 0) {
			void vscode.window.showErrorMessage(
				`Не удалось сменить правило поддержки. ${(res.stderr || res.stdout).trim()}`.slice(0, 400)
			);
			return;
		}
		notifyQuiet(`${picked.label}${picked.children ? ', включая подчинённые' : ''}`);
		void vscode.commands.executeCommand('1c-platform-tools.metadata.refresh');
	}

	function refuseLockedBySupport(support: string | undefined, subject = 'Объект'): boolean {
		if (support !== 'locked') {
			return false;
		}
		void vscode.window.showInformationMessage(
			`${subject} на поддержке поставщика без возможности изменения.`
				+ ' Смените режим поддержки или снимите конфигурацию с поддержки.'
		);
		return true;
	}

	function resolveChildNodeForMutation(
		item: MetadataObjectNodeTreeItem | undefined,
		unsupportedMessage: string
	): MutatableChildNode | undefined {
		const node = item ?? metadataTreeView.selection[0];
		if (!(node instanceof MetadataObjectNodeTreeItem)) {
			void vscode.window.showInformationMessage('Выберите узел метаданных.');
			return undefined;
		}
		if (!node.owner.resourceUri) {
			void vscode.window.showInformationMessage('У объекта нет файла в выгрузке.');
			return undefined;
		}
		if (refuseLockedBySupport(node.owner.support)) {
			return undefined;
		}
		// У элемента своё правило: объект открыт, а он может остаться закрытым
		if (refuseLockedBySupport(node.support, 'Элемент объекта')) {
			return undefined;
		}
		if (!childKindIsMutatable(node.nodeKind)) {
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
		mode: Exclude<ChildMutationMode, 'add'>,
		name: string
	): MdSparrowParams {
		const objectXml = node.owner.resourceUri.fsPath;
		const op = childMutationOp(node.nodeKind, mode);
		const inside = childKindNeedsTabularSection(node.nodeKind)
			? { tabularSection: node.tabularSectionName ?? '' }
			: {};
		if (mode === 'rename') {
			return { op, objectXml, ...inside, oldName: node.name, newName: name };
		}
		if (mode === 'delete') {
			return { op, objectXml, ...inside, name };
		}
		return { op, objectXml, ...inside, sourceName: node.name, newName: name };
	}

	/**
	 * Выполняет мутацию дочернего узла объекта через md-sparrow и обновляет дерево.
	 *
	 * @param node Узел, к которому относится операция.
	 * @param params Параметры мутации без версии схемы.
	 * @param successMessage Сообщение после успешного завершения.
	 * @returns Промис, который разрешается после выполнения операции.
	 */
	/**
	 * Меняет тип узла состава: список типов отмечается галочками, поэтому одним
	 * окном задаётся и простой, и составной тип.
	 *
	 * Кандидаты приходят от md-sparrow: примитивы платформы и ссылочные типы
	 * конфигурации. Квалификаторы примитивов остаются как в файле - панель их
	 * не трогает, для них есть свойства объекта.
	 *
	 * @param node - Узел состава: реквизит, измерение, ресурс
	 */
	async function editChildNodeType(node: MutatableChildNode): Promise<void> {
		const objectXml = node.owner.resourceUri?.fsPath;
		if (!objectXml) {
			return;
		}
		const schema = node.owner.configurationXmlAbs
			? await mdSparrowSchemaFlagFromConfigurationXml(node.owner.configurationXmlAbs)
			: await mainSchemaFlag();
		if (schema === undefined) {
			void vscode.window.showWarningMessage('Не удалось определить схему для правки типа.');
			return;
		}
		const runtime = await ensureMdSparrowRuntime(context);
		const cwd = node.owner.metadataRootAbs ?? path.dirname(objectXml);
		const dto = await runMdSparrowJson<Record<string, unknown>>(
			runtime,
			{ op: 'cf-md-object-get', objectXml, schemaVersion: schema },
			cwd
		);
		if (!dto.ok) {
			void vscode.window.showErrorMessage(`Не удалось прочитать свойства объекта. ${dto.error}`.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
			return;
		}
		const target = findNodeInDto(dto.value, node);
		if (!target) {
			void vscode.window.showWarningMessage(`Узел «${node.name}» не найден в свойствах объекта.`);
			return;
		}
		const current = typeListOf(target.type);
		const options = await typePickItems(runtime, node, schema, cwd, current);
		if (options.length === 0) {
			void vscode.window.showWarningMessage('Список типов пуст: библиотека не отдала ссылочные типы конфигурации.');
			return;
		}
		const picked = await vscode.window.showQuickPick(options, {
			title: `Тип: ${node.name}`,
			placeHolder: 'Отметьте типы; несколько отмеченных дают составной тип',
			canPickMany: true,
			matchOnDescription: true,
		});
		if (!picked) {
			return;
		}
		if (picked.length === 0) {
			void vscode.window.showWarningMessage('Тип обязателен: платформа не примет узел без типа.');
			return;
		}
		const next = picked.filter((option) => option.value !== '').map((option) => option.value);
		if (next.length === 0) {
			void vscode.window.showWarningMessage('Тип обязателен: платформа не примет узел без типа.');
			return;
		}
		if (next.length === current.length && next.every((type, index) => type === current[index])) {
			return;
		}
		target.type = { ...(target.type as Record<string, unknown> | undefined), types: next };
		const res = await runMdSparrowParamsMutation(
			runtime,
			{ op: 'cf-md-object-set', objectXml, schemaVersion: schema, payloadJson: JSON.stringify(dto.value) },
			{ cwd }
		);
		if (res.exitCode !== 0) {
			void vscode.window.showErrorMessage(
				`Не удалось записать тип. ${(res.stderr || res.stdout).trim()}`.slice(0, MD_SPARROW_CLI_ERR_PREVIEW)
			);
			return;
		}
		notifyQuiet(`Тип «${node.name}» записан`);
		void metadataTreeProvider.refresh();
	}

	/** Узел состава в свойствах объекта: реквизит табличной части лежит внутри своей части. */
	function findNodeInDto(
		dto: Record<string, unknown>,
		node: MutatableChildNode
	): Record<string, unknown> | undefined {
		const listName = childNodeDtoList(node.nodeKind);
		if (node.nodeKind === 'tabularAttribute' && node.tabularSectionName) {
			const sections = dto.tabularSections;
			const section = Array.isArray(sections)
				? (sections.find((item) => (item as { name?: string }).name === node.tabularSectionName) as
						| Record<string, unknown>
						| undefined)
				: undefined;
			const list = section?.attributes;
			return Array.isArray(list)
				? (list.find((item) => (item as { name?: string }).name === node.name) as Record<string, unknown> | undefined)
				: undefined;
		}
		const list = listName ? dto[listName] : undefined;
		return Array.isArray(list)
			? (list.find((item) => (item as { name?: string }).name === node.name) as Record<string, unknown> | undefined)
			: undefined;
	}

	/** Типы узла списком: пусто, когда типа у вида узла нет. */
	function typeListOf(type: unknown): string[] {
		const types = (type as { types?: unknown })?.types;
		return Array.isArray(types) ? types.filter((item): item is string => typeof item === 'string') : [];
	}

	/** Кандидаты в тип: примитивы платформы и ссылочные типы конфигурации. */
	async function typePickItems(
		runtime: Awaited<ReturnType<typeof ensureMdSparrowRuntime>>,
		node: MutatableChildNode,
		schema: string,
		cwd: string,
		current: readonly string[]
	): Promise<(vscode.QuickPickItem & { value: string })[]> {
		const items: (vscode.QuickPickItem & { value: string })[] = PRIMITIVE_TYPES.map((option) => ({
			label: option.label,
			description: option.value,
			value: option.value,
			picked: current.includes(option.value),
		}));
		const configurationXml = node.owner.configurationXmlAbs;
		if (!configurationXml) {
			return items;
		}
		const refTypes = await runMdSparrowJson<Record<string, string[]>>(
			runtime,
			{ op: 'cf-list-ref-types', configurationXml, schemaVersion: schema },
			cwd
		);
		if (!refTypes.ok) {
			void vscode.window.showWarningMessage(`Не удалось прочитать ссылочные типы: ${refTypes.error}`.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
			return items;
		}
		for (const [objectType, types] of Object.entries(refTypes.value)) {
			const kind = mdObjectKindLabel(objectType) ?? objectType;
			for (const type of types) {
				items.push({
					label: refTypeName(type),
					description: kind,
					value: type,
					picked: current.includes(type),
				});
			}
		}
		// Выбранное наверх: в конфигурации сотни типов, и без этого не видно, что стоит сейчас
		const chosen = items.filter((item) => item.picked);
		const rest = items.filter((item) => !item.picked);
		return chosen.length === 0
			? items
			: [
					{ label: 'Выбрано', kind: vscode.QuickPickItemKind.Separator, value: '' },
					...chosen,
					{ label: 'Остальные типы', kind: vscode.QuickPickItemKind.Separator, value: '' },
					...rest,
				];
	}

	async function runChildNodeMutation(
		node: MutatableChildNode,
		params: MdSparrowParams,
		successMessage: string
	): Promise<void> {
		// У внешних отчётов и обработок Configuration.xml нет: версия берётся у основной
		const schema = node.owner.configurationXmlAbs
			? await mdSparrowSchemaFlagFromConfigurationXml(node.owner.configurationXmlAbs)
			: await mainSchemaFlag();
		if (schema === undefined) {
			void vscode.window.showWarningMessage('Не удалось определить схему для правки состава.');
			return;
		}
		const runtime = await ensureMdSparrowRuntime(context);
		const res = await runMdSparrowParamsMutation(
			runtime,
			{ ...params, schemaVersion: schema },
			{ cwd: node.owner.metadataRootAbs ?? path.dirname(node.owner.resourceUri.fsPath) }
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
		vscode.commands.registerCommand('1c-platform-tools.metadata.revealInTree', async (uri?: vscode.Uri) => {
			await revealMetadataObjectInTree(uri ?? vscode.window.activeTextEditor?.document.uri);
		}),
		vscode.commands.registerCommand('1c-platform-tools.metadata.filters.reset', () => {
			metadataFilterProvider.clear();
		}),
		vscode.commands.registerCommand('1c-platform-tools.metadata.filters.collapseAll', () => {
			metadataFilterProvider.collapseAll();
		}),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.addObject',
			async (...commandArgs: unknown[]) => {
				const sourceKind = parseExternalArtifactSourceKindFromArgs(commandArgs);
				if (sourceKind) {
					await runMdSparrowMutation(async () => {
						await addExternalArtifact(sourceKind);
					});
					return;
				}
				await runMdSparrowMutation(async () => {
					const kind = parseMdBoilerplateKindFromCommandArgs(commandArgs);
					if (!kind) {
						void vscode.window.showInformationMessage('Выберите группу метаданных для добавления.');
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
					// Состав закрыт, пока корень конфигурации не открыт своим правилом
					const support = await loadSourceSupportState(cfgPath, cfRoot);
					if (support && (support.editingEnabled === false || support.rootState === 'locked')) {
						void vscode.window.showInformationMessage(
							support.editingEnabled === false
								? 'Возможность изменения конфигурации не включена: включите её в конфигураторе'
									+ ' или снимите конфигурацию с поддержки.'
								: 'Корень конфигурации не редактируется: смените его правило поддержки.'
						);
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
						notifyQuiet(`Объект метаданных «${name}» добавлен.`);
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
					}
				});
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
					if (refuseLockedBySupport(node.support)) {
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
					if (refuseLockedBySupport(node.support)) {
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
						notifyQuiet(`Внешний файл «${node.name}» удалён.`);
						return;
					}
					const tag = metadataObjectTypeToXmlTag[node.objectType];
					if (!tag) {
						void vscode.window.showWarningMessage('Удаление для этого типа пока недоступно.');
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
					notifyQuiet(`Объект «${node.name}» удалён.`);
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
					if (refuseLockedBySupport(node.support)) {
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
						notifyQuiet(`Создана копия «${nextName.trim()}».`);
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
					notifyQuiet(`Создана копия «${nextName.trim()}».`);
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.addChildNode',
			async (item?: MetadataObjectNodeTreeItem | MetadataObjectSectionTreeItem) => {
				await runMdSparrowMutation(async () => {
					const selected = item ?? metadataTreeView.selection[0];
					// Добавляют внутрь раздела; табличная часть - тоже раздел, для своих реквизитов
					let leaf: MetadataLeafTreeItem | undefined;
					let kind: MutatableChildKind | undefined;
					let tabularSection: string | undefined;
					if (selected instanceof MetadataObjectNodeTreeItem && selected.nodeKind === 'tabularSection') {
						leaf = selected.owner;
						kind = 'tabularAttribute';
						tabularSection = selected.name;
					} else if (selected instanceof MetadataObjectSectionTreeItem) {
						leaf = selected.owner;
						if (selected.sectionKind === 'forms') {
							// Форма создаётся из эталона платформы своей операцией
							await addObjectFormFromTree(selected.owner);
							return;
						}
						kind = childKindOfSection(selected.sectionKind);
						if (!kind) {
							void vscode.window.showWarningMessage('В этот раздел добавление не поддерживается.');
							return;
						}
					} else {
						void vscode.window.showInformationMessage('Выберите раздел объекта или табличную часть.');
						return;
					}
					if (!leaf.resourceUri) {
						void vscode.window.showInformationMessage('У объекта нет файла в выгрузке.');
						return;
					}
					if (refuseLockedBySupport(leaf.support)) {
						return;
					}
					const name = await vscode.window.showInputBox({
						title: childKindTitle(kind),
						placeHolder: 'Имя',
						validateInput: (value) => (!value.trim() ? 'Введите имя.' : null),
					});
					if (!name) {
						return;
					}
					// Состав правится по XML объекта: Configuration.xml нужен только для версии формата
					const schema = leaf.configurationXmlAbs
						? await mdSparrowSchemaFlagFromConfigurationXml(leaf.configurationXmlAbs)
						: await mainSchemaFlag();
					if (schema === undefined) {
						void vscode.window.showWarningMessage('Не удалось определить схему для правки состава.');
						return;
					}
					const runtime = await ensureMdSparrowRuntime(context);
					const res = await runMdSparrowParamsMutation(
						runtime,
						{
							op: childMutationOp(kind, 'add'),
							objectXml: leaf.resourceUri.fsPath,
							...(tabularSection ? { tabularSection } : {}),
							name: name.trim(),
							schemaVersion: schema,
						},
						{ cwd: leaf.metadataRootAbs ?? path.dirname(leaf.resourceUri.fsPath) }
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
					notifyQuiet(childKindAddedMessage(kind, name.trim()));
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
					const selectedNode = item ?? (metadataTreeView.selection[0] as MetadataObjectNodeTreeItem | undefined);
					if (selectedNode instanceof MetadataObjectNodeTreeItem && selectedNode.nodeKind === 'form') {
						await deleteObjectFormFromTree(selectedNode);
						return;
					}
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
			'1c-platform-tools.metadata.setChildNodeType',
			async (item?: MetadataObjectNodeTreeItem) => {
				await runMdSparrowMutation(async () => {
					const node = resolveChildNodeForMutation(item, 'У этого узла типа нет.');
					if (!node) {
						return;
					}
					await editChildNodeType(node);
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
				const roots = await loadSubsystemTrees(context, metadataTreeProvider);
				const subsystem = findSubsystemByName(roots, node.name);
				if (!subsystem) {
					void vscode.window.showWarningMessage(`Не удалось прочитать подсистему: ${node.name}`);
					return;
				}
				const result = computeSubsystemFilter(roots, new Set([subsystem.xmlPath]), {
					includeNested: true,
					includeParents: false,
				});
				metadataTreeProvider.setSubsystemFilter(node.name, result.names, result.keys, result.subsystemNames);
				void vscode.commands.executeCommand(
					'setContext',
					'1c-platform-tools.metadata.subsystemFilterActive',
					true
				);
				void vscode.window.showInformationMessage(`Фильтр подсистемы: ${node.name}`);
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
			(item?: MetadataLeafTreeItem | MetadataObjectNodeTreeItem) => openFormModuleFromTree(item)
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.open',
			(item?: MetadataLeafTreeItem) => openMetadataLeaf(item)
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openForm',
			async (item?: MetadataObjectNodeTreeItem | MetadataLeafTreeItem) => {
				const node = item ?? metadataTreeView.selection[0];
				if (node instanceof MetadataLeafTreeItem) {
					if (!isMetadataCommonForm(node.objectType)) {
						void vscode.window.showInformationMessage('Выберите форму в дереве метаданных.');
						return;
					}
					await openCommonFormFromLeaf(node);
					return;
				}
				if (!(node instanceof MetadataObjectNodeTreeItem) || node.nodeKind !== 'form') {
					void vscode.window.showInformationMessage('Выберите форму в дереве метаданных.');
					return;
				}
				const owner = node.owner;
				if (!owner.resourceUri) {
					void vscode.window.showInformationMessage('У формы нет объекта-владельца.');
					return;
				}
				const formXml = formContentFileOf(owner.resourceUri.fsPath, node.name);
				await openFormViewerForXml(formXml, formModuleNextTo(formXml), `${owner.name}.${node.name}`, {
					metadataRootAbs: owner.metadataRootAbs,
					configurationXmlAbs: owner.configurationXmlAbs,
					resourceUri: owner.resourceUri,
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openProperties',
			async (item?: vscode.TreeItem) => {
				const selected = item ?? metadataTreeView.selection[0];
				// У формы и макета свойства лежат в своём файле описания: их
				// показывает та же вкладка, что у объекта. Остальной состав - палитра
				if (selected instanceof MetadataObjectNodeTreeItem) {
					const descriptor = childDescriptorXmlPath(selected);
					if (descriptor && fs.existsSync(descriptor)) {
						const owner = selected.owner;
						const schemaFlagFallback = owner.configurationXmlAbs ? undefined : await mainSchemaFlag();
						await openMetadataObjectPropertiesEditor(context, {
							objectXmlFsPath: descriptor,
							cfgPath: owner.configurationXmlAbs,
							schemaFlag: schemaFlagFallback,
							cwd: owner.metadataRootAbs ?? path.dirname(descriptor),
							objectType: selected.nodeKind === 'form' ? 'Form' : 'Template',
							enqueueMutation: runMdSparrowMutation,
						});
						return;
					}
					await vscode.commands.executeCommand('1c-platform-tools.properties.show');
					return;
				}
				const source = resolveSelectedMetadataSource(
					item instanceof MetadataSourceTreeItem ? item : undefined
				);
				if (source?.configurationXmlAbs && source.metadataRootAbs) {
					await runMdSparrowMutation(async () => {
						try {
							const { schema, dto, dictionaries, support } = await loadSourcePropertiesDto(
								source.configurationXmlAbs!,
								source.metadataRootAbs!
							);
							await openMetadataSourcePropertiesPanel(
								context,
								{
									label: typeof source.label === 'string' ? source.label : source.sourceId,
									sourceKind: source.sourceKind,
									configurationXmlAbs: source.configurationXmlAbs!,
									dictionaries,
									support,
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
									notifyQuiet('Свойства сохранены.');
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
						await openExternalArtifactPropertiesEditor(items[0].xmlPath, items[0].objectType);
						return;
					}
					const picked = await vscode.window.showQuickPick(
						items.map((x) => ({ label: x.name, description: x.xmlPath, item: x })),
						{ title: 'Выберите внешний файл' }
					);
					if (!picked) {
						return;
					}
					await openExternalArtifactPropertiesEditor(picked.item.xmlPath, picked.item.objectType);
					return;
				}
				const node = resolveSelectedMetadataLeaf(
					item instanceof MetadataLeafTreeItem ? item : undefined
				);
				if (!(node instanceof MetadataLeafTreeItem) || !node.resourceUri) {
					void vscode.window.showInformationMessage('Свойства для выбранного узла недоступны.');
					return;
				}
				if (node.objectType === 'ExternalReport' || node.objectType === 'ExternalDataProcessor') {
					await openExternalArtifactPropertiesEditor(
						node.resourceUri.fsPath,
						node.objectType as 'ExternalReport' | 'ExternalDataProcessor'
					);
					return;
				}
				await openObjectPropertiesTab(node);
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openFormContentXml',
			async (item?: MetadataObjectNodeTreeItem | MetadataLeafTreeItem) => {
				const selected = item ?? metadataTreeView.selection[0];
				if (selected instanceof MetadataLeafTreeItem && isMetadataCommonForm(selected.objectType)) {
					if (!selected.resourceUri) {
						void vscode.window.showInformationMessage('У формы нет файла в выгрузке.');
						return;
					}
					await openTextFile(formContentFileOf(selected.resourceUri.fsPath));
					return;
				}
				if (!(selected instanceof MetadataObjectNodeTreeItem) || selected.nodeKind !== 'form') {
					void vscode.window.showInformationMessage('Выберите форму в дереве метаданных.');
					return;
				}
				const owner = selected.owner;
				if (!owner.resourceUri) {
					void vscode.window.showInformationMessage('У формы нет объекта-владельца.');
					return;
				}
				await openTextFile(formContentFileOf(owner.resourceUri.fsPath, selected.name));
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
				const selected = item ?? metadataTreeView.selection[0];
				if (selected instanceof MetadataObjectNodeTreeItem && selected.nodeKind === 'form') {
					const owner = selected.owner;
					if (!owner.resourceUri) {
						void vscode.window.showInformationMessage('У формы нет объекта-владельца.');
						return;
					}
					const descriptor = formDescriptorFileOf(owner.resourceUri.fsPath, selected.name);
					await openTextFile(descriptor ?? owner.resourceUri.fsPath);
					return;
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
		vscode.commands.registerCommand(
			'1c-platform-tools.epf.addBspRegistration',
			async (item?: MetadataLeafTreeItem) => {
				const node = resolveSelectedMetadataLeaf(item instanceof MetadataLeafTreeItem ? item : undefined);
				if (!node?.resourceUri) {
					void vscode.window.showInformationMessage('Выберите внешний отчёт или обработку.');
					return;
				}
				const report = node.objectType === 'ExternalReport';
				const modulePath = moduleFileOf(node.resourceUri.fsPath, 'object');
				let existing = '';
				try {
					existing = new TextDecoder('utf-8').decode(
						await vscode.workspace.fs.readFile(vscode.Uri.file(modulePath))
					);
				} catch {
					existing = '';
				}
				if (existing.includes(BSP_REGISTRATION_MARKER)) {
					void vscode.window.showInformationMessage('Регистрация БСП уже есть в объектном модуле.');
					return;
				}
				const presentation = await vscode.window.showInputBox({
					title: 'Представление команды',
					value: node.name,
					validateInput: (value) => (!value.trim() ? 'Введите представление.' : null),
				});
				if (!presentation) {
					return;
				}
				const block = buildBspRegistration({
					report,
					presentation: presentation.trim().replaceAll("'", '"'),
					commandId: report ? 'ОткрытьФорму' : 'ВыполнитьОбработку',
				});
				const bom = '\uFEFF';
				const next = existing.length === 0
					? bom + block
					: existing + (existing.endsWith('\n') ? '' : '\r\n') + '\r\n' + block;
				await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(modulePath)));
				await vscode.workspace.fs.writeFile(vscode.Uri.file(modulePath), new TextEncoder().encode(next));
				const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(modulePath));
				await vscode.window.showTextDocument(doc, { preview: false });
				notifyQuiet('Регистрация БСП добавлена');
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.cfe.borrowObject',
			async (item?: MetadataLeafTreeItem) => {
				await runMdSparrowMutation(async () => {
					const node = resolveSelectedMetadataLeaf(item instanceof MetadataLeafTreeItem ? item : undefined);
					if (!node?.resourceUri) {
						void vscode.window.showInformationMessage('Выберите объект конфигурации.');
						return;
					}
					const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
					if (!root) {
						return;
					}
					const tree = await loadProjectMetadataTree(context, root);
					const extensions = tree.sources.filter((source) => source.kind === 'extension');
					if (extensions.length === 0) {
						void vscode.window.showInformationMessage('В проекте нет расширений: создайте его командой «Создать новое расширение».');
						return;
					}
					const picked =
						extensions.length === 1
							? extensions[0]
							: (
									await vscode.window.showQuickPick(
										extensions.map((source) => ({ label: source.label, source })),
										{ placeHolder: 'В какое расширение добавить объект' }
									)
								)?.source;
					if (!picked) {
						return;
					}
					const extensionConfiguration = path.join(root, picked.configurationXmlRelativePath);
					const schema = node.configurationXmlAbs
						? await mdSparrowSchemaFlagFromConfigurationXml(node.configurationXmlAbs)
						: await mainSchemaFlag();
					if (schema === undefined) {
						return;
					}
					const runtime = await ensureMdSparrowRuntime(context);
					const res = await runMdSparrowParamsMutation(
						runtime,
						{
							op: 'cfe-borrow-object',
							objectXml: node.resourceUri.fsPath,
							configurationXml: extensionConfiguration,
							schemaVersion: schema,
						},
						{ cwd: node.metadataRootAbs ?? path.dirname(node.resourceUri.fsPath) }
					);
					if (res.exitCode !== 0) {
						void vscode.window.showErrorMessage(
							`Не удалось добавить объект в расширение. ${(res.stderr || res.stdout).trim()}`.slice(0, 400)
						);
						return;
					}
					notifyQuiet(`«${node.name}» добавлен в расширение ${picked.label}`);
					void vscode.commands.executeCommand('1c-platform-tools.metadata.refresh');
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openCommandInterface',
			async (item?: MetadataLeafTreeItem) => {
				const node = resolveSelectedMetadataLeaf(item instanceof MetadataLeafTreeItem ? item : undefined);
				if (!node) {
					void vscode.window.showInformationMessage('Выберите подсистему в дереве.');
					return;
				}
				await openObjectPropertiesTab(node, 'commandInterface');
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.openDcs',
			async (item?: vscode.TreeItem) => {
				let templateXml: string | undefined;
				let descriptorXml: string | undefined;
				let title = '';
				let cwd: string | undefined;
				let configurationXmlAbs: string | undefined;
				if (item instanceof MetadataObjectNodeTreeItem && item.nodeKind === 'template' && item.owner.resourceUri) {
					const objectFile = item.owner.resourceUri.fsPath;
					// У макета EDT своего описания нет: вид макета записан в описании владельца
					descriptorXml = templateDescriptorFileOf(objectFile, item.name) ?? objectFile;
					templateXml = templateContentFileOf(objectFile, item.name);
					title = `${item.owner.name}.${item.name}`;
					cwd = item.owner.metadataRootAbs ?? path.dirname(item.owner.resourceUri.fsPath);
					configurationXmlAbs = item.owner.configurationXmlAbs;
				} else if (item instanceof MetadataLeafTreeItem && item.resourceUri) {
					const file = item.resourceUri.fsPath;
					descriptorXml = file;
					templateXml = templateContentFileOf(file);
					title = item.name;
					cwd = item.metadataRootAbs ?? path.dirname(item.resourceUri.fsPath);
					configurationXmlAbs = item.configurationXmlAbs;
				}
				if (!templateXml || !descriptorXml || !cwd) {
					void vscode.window.showInformationMessage('Выберите макет в дереве.');
					return;
				}
				try {
					const descriptor = await fs.promises.readFile(descriptorXml, 'utf8');
					if (!descriptor.includes('DataCompositionSchema')) {
						void vscode.window.showInformationMessage('Макет не является схемой компоновки данных.');
						return;
					}
				} catch {
					void vscode.window.showInformationMessage('Описание макета не прочитано.');
					return;
				}
				const schema = configurationXmlAbs
					? await mdSparrowSchemaFlagFromConfigurationXml(configurationXmlAbs)
					: await mainSchemaFlag();
				if (schema === undefined) {
					return;
				}
				await openDcsEditorPanel(context, {
					templateXmlFsPath: templateXml,
					title,
					cwd,
					schemaFlag: schema,
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.supportRemove',
			async (item?: MetadataSourceTreeItem) => {
				await runMdSparrowMutation(async () => {
					const source = item instanceof MetadataSourceTreeItem ? item : undefined;
					if (!source?.configurationXmlAbs) {
						void vscode.window.showInformationMessage('Выберите конфигурацию в дереве.');
						return;
					}
					const answer = await vscode.window.showWarningMessage(
						'Снять с поддержки все объекты конфигурации? Правила и файл поставки будут удалены,'
							+ ' обновление от поставщика станет недоступно.',
						'Снять с поддержки'
					);
					if (answer !== 'Снять с поддержки') {
						return;
					}
					const runtime = await ensureMdSparrowRuntime(context);
					const res = await runMdSparrowParamsMutation(
						runtime,
						{
							op: 'cf-support-remove',
							configurationXml: source.configurationXmlAbs,
							expectedGeneration: source.supportGeneration,
						},
						{ cwd: source.metadataRootAbs ?? path.dirname(source.configurationXmlAbs) }
					);
					if (res.exitCode !== 0) {
						void vscode.window.showErrorMessage(
							`Не удалось снять с поддержки. ${(res.stderr || res.stdout).trim()}`.slice(0, 400)
						);
						return;
					}
					notifyQuiet('Конфигурация снята с поддержки');
					void vscode.commands.executeCommand('1c-platform-tools.metadata.refresh');
				});
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.supportSetObjectMode',
			async (item?: vscode.TreeItem) => {
				await runMdSparrowMutation(async () => {
					// Правило поддержки ставится любому субъекту: конфигурации, объекту,
					// его формам, макетам и элементам
					const selected = item ?? metadataTreeView.selection[0];
					const sourceNode = selected instanceof MetadataSourceTreeItem ? selected : undefined;
					if (sourceNode) {
						await setSupportRuleForConfiguration(sourceNode);
						return;
					}
					const childNode = selected instanceof MetadataObjectNodeTreeItem ? selected : undefined;
					const node =
						childNode?.owner
						?? resolveSelectedMetadataLeaf(selected instanceof MetadataLeafTreeItem ? selected : undefined);
					if (!node?.resourceUri || !node.configurationXmlAbs) {
						void vscode.window.showInformationMessage('Выберите объект конфигурации.');
						return;
					}
					// Своё правило поддержки есть у формы и макета: режим ставится их файлу
					const childDescriptor = childNode ? childDescriptorXmlPath(childNode) : undefined;
					// У элемента объекта правило тоже своё, но файла у него нет: он адресуется ключом
					const elementKey =
						childNode && !childDescriptor
							? childSupportElementKey(childNode.nodeKind, childNode.name, childNode.tabularSectionName)
							: undefined;
					const subjectXml =
						childDescriptor && fs.existsSync(childDescriptor) ? childDescriptor : node.resourceUri.fsPath;
					const subjectName =
						childDescriptor || elementKey ? `${node.name}.${childNode?.name ?? ''}` : node.name;
					if (node.support !== 'locked' && node.support !== 'editable') {
						void vscode.window.showInformationMessage('Объект не на поддержке поставщика.');
						return;
					}
					if (!node.supportRulesOpen) {
						void vscode.window.showInformationMessage(
							'Возможность изменения конфигурации не включена: включите её в конфигураторе'
								+ ' или снимите конфигурацию с поддержки.'
						);
						return;
					}
					const picked = await askSupportRule(subjectName);
					if (!picked) {
						return;
					}
					// У формы, макета и элемента подчинённых нет: область к ним не применяется
					const includeChildren = picked.children && !childDescriptor && !elementKey;
					const runtime = await ensureMdSparrowRuntime(context);
					const res = await runMdSparrowParamsMutation(
						runtime,
						{
							op: elementKey ? 'cf-support-element-mode-set' : 'cf-support-object-mode-set',
							objectXml: subjectXml,
							configurationXml: node.configurationXmlAbs,
							name: picked.mode,
							tag: elementKey ?? (includeChildren ? 'children' : undefined),
							expectedGeneration: node.supportGeneration,
						},
						{ cwd: node.metadataRootAbs ?? path.dirname(node.resourceUri.fsPath) }
					);
					if (res.exitCode !== 0) {
						void vscode.window.showErrorMessage(
							`Не удалось сменить режим поддержки. ${(res.stderr || res.stdout).trim()}`.slice(0, 400)
						);
						return;
					}
					notifyQuiet(`«${subjectName}»: ${picked.label.toLowerCase()}`);
					void vscode.commands.executeCommand('1c-platform-tools.metadata.refresh');
				});
			}
		),
		vscode.commands.registerCommand('1c-platform-tools.metadata.initEmptyCfe', async () => {
			await runMdSparrowMutation(async () => {
				const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
				if (!root) {
					void vscode.window.showInformationMessage('Нет открытой папки проекта.');
					return;
				}
				const configurationXml = metadataTreeProvider.configurationXml;
				if (!configurationXml || !fs.existsSync(configurationXml)) {
					void vscode.window.showInformationMessage(
						'Не найдена выгрузка конфигурации: режимы совместимости расширения берутся из неё.'
					);
					return;
				}

				const name = await vscode.window.showInputBox({
					title: 'Новое расширение',
					prompt: 'Имя расширения',
					validateInput: (value) =>
						value.trim() === '' ? 'Имя обязательно' : undefined,
				});
				if (!name) {
					return;
				}
				const namePrefix = await vscode.window.showInputBox({
					title: 'Новое расширение',
					prompt: 'Префикс имён объектов; можно оставить пустым',
					value: '',
				});
				if (namePrefix === undefined) {
					return;
				}
				const purposeItem = await vscode.window.showQuickPick(
					[
						{ label: 'Дополнение', description: 'add-on', value: 'add-on' },
						{ label: 'Адаптация', description: 'customization', value: 'customization' },
						{ label: 'Исправление', description: 'patch', value: 'patch' },
					],
					{ title: 'Назначение расширения' }
				);
				if (!purposeItem) {
					return;
				}

				const cfeRoot = path.join(
					root,
					VRunnerManager.getInstance(context).getCfePath(),
					name.trim()
				);
				if (fs.existsSync(cfeRoot)) {
					void vscode.window.showErrorMessage(`Каталог расширения уже есть: ${cfeRoot}`);
					return;
				}

				// Заготовка расширения собирается выгрузкой конфигуратора: у проекта EDT
				// расширение заводят в самой среде
				if (formatOfFile(configurationXml) === 'edt') {
					void vscode.window.showInformationMessage('Расширение к проекту 1С:EDT создаётся в самой среде.');
					return;
				}
				try {
					const runtime = await ensureMdSparrowRuntime(context);
					const version = await mdSparrowSchemaFlagFromConfigurationXml(configurationXml);
					const res = await runMdSparrowParamsMutation(
						runtime,
						{
							op: 'init-empty-cfe',
							targetCfeRoot: cfeRoot,
							schemaVersion: version,
							name: name.trim(),
							namePrefix: namePrefix.trim() === '' ? undefined : namePrefix.trim(),
							purpose: purposeItem.value,
							mainConfigurationXml: configurationXml,
						},
						{ cwd: root }
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
					notifyQuiet(`Расширение ${name.trim()} создано.`);
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
				}
			});
		}),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.compile',
			async (item?: vscode.TreeItem) => {
				const node = item ?? metadataTreeView.selection[0];
				// Группа внешних файлов собирает всё содержимое разом
				if (
					node instanceof MetadataSourceTreeItem &&
					(node.sourceKind === 'externalErf' || node.sourceKind === 'externalEpf')
				) {
					const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
					if (!root) {
						return;
					}
					const tree = await loadProjectMetadataTree(context, root);
					const source = tree.sources.find((candidate) => candidate.kind === node.sourceKind);
					const items = source?.groups.flatMap((group) => group.items) ?? [];
					if (items.length === 0) {
						void vscode.window.showInformationMessage('В группе нет внешних файлов.');
						return;
					}
					const kind = node.sourceKind === 'externalErf' ? 'report' : 'processor';
					for (const entry of items) {
						if (!entry.relativePath) {
							continue;
						}
						await compileMetadataTarget(
							artifactCommands,
							kind,
							vscode.Uri.file(path.dirname(path.join(root, entry.relativePath)))
						);
					}
					return;
				}
				const target = metadataCompileTarget(node);
				if (!target) {
					void vscode.window.showInformationMessage(
						'Выберите конфигурацию, расширение, обработку или отчёт.'
					);
					return;
				}
				await compileMetadataTarget(artifactCommands, target.kind, target.sourceUri);
			}
		),
		vscode.commands.registerCommand(
			'1c-platform-tools.metadata.validateDump',
			async (item?: MetadataSourceTreeItem) => {
				const source = resolveSelectedMetadataSource(item);
				const roots: string[] = [];
				if (source?.metadataRootAbs) {
					roots.push(source.metadataRootAbs);
				} else {
					const cfRoot = metadataTreeProvider.resolveCfRoot();
					if (cfRoot && fs.existsSync(path.join(cfRoot, 'Configuration.xml'))) {
						roots.push(cfRoot);
					}
					roots.push(...listExtensionRoots());
				}
				if (roots.length === 0) {
					void vscode.window.showInformationMessage('Не найдена выгрузка для проверки.');
					return;
				}

				try {
					const runtime = await ensureMdSparrowRuntime(context);
					let total = 0;
					for (const root of roots) {
						const res = await runMdSparrowParamsRead(runtime, {
							op: 'cf-validate-dump',
							cfRoot: root,
						});
						if (res.exitCode !== 0) {
							const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(
								0,
								MD_SPARROW_CLI_ERR_PREVIEW
							);
							void vscode.window.showErrorMessage(errText);
							return;
						}
						const findings = JSON.parse(res.stdout.trim() || '[]') as CfDumpFinding[];
						dumpValidation.publish(root, findings);
						total += findings.length;
					}
					if (total === 0) {
						notifyQuiet(
							roots.length === 1
								? 'Выгрузка цела: находок нет.'
								: `Выгрузки целы: находок нет (проверено: ${roots.length}).`
						);
						return;
					}
					notifyQuiet(`Проверка выгрузки: находок ${total}, см. панель «Проблемы».`);
					await vscode.commands.executeCommand('workbench.actions.view.problems');
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
				}
			}
		),
		vscode.commands.registerCommand('1c-platform-tools.metadata.initEmptyCf', async () => {
			// Формат спрашивается первым: у проекта EDT свой путь создания и свой каталог
			const format = await vscode.window.showQuickPick(
				[
					{ label: 'Выгрузка конфигуратора', description: 'XML в каталоге исходников', format: 'designer' as const },
					{ label: 'Проект 1С:EDT', description: 'каталог проекта рядом с остальными', format: 'edt' as const },
				],
				{ title: 'Формат новой конфигурации' }
			);
			if (!format) {
				return;
			}
			if (format.format === 'edt') {
				await runMdSparrowMutation(async () => {
					if (await createEdtProject(context)) {
						await metadataTreeProvider.refresh();
					}
				});
				return;
			}
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
					notifyQuiet('Пустая конфигурация создана.');
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					void vscode.window.showErrorMessage(msg.slice(0, MD_SPARROW_CLI_ERR_PREVIEW));
				}
			});
		}),
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
		vscode.commands.registerCommand('1c-platform-tools.components.update', uiOnlyHandler(
			'Список компонентов выбирает человек галочками. Загрузка идёт при обычном использовании компонента.',
			async () => {
			const states = await readComponentStates(context);
			const picked = await vscode.window.showQuickPick(
				states.map((state) => ({
					label: state.spec.title,
					description: describeComponentState(state),
					state,
					picked: true,
				})),
				{
					title: 'Обновить внешние компоненты',
					canPickMany: true,
					placeHolder: 'Выбранное будет загружено заново сразу, даже если задан свой путь',
				}
			);
			if (!picked || picked.length === 0) {
				return;
			}

			const failed: string[] = [];
			const done: string[] = [];
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Обновление внешних компонентов' },
				async (progress) => {
					for (const item of picked) {
						progress.report({ message: item.state.spec.title });
						try {
							await item.state.spec.clear(context);
							await item.state.spec.download(context);
							const version = await item.state.spec.version(context).catch(() => undefined);
							done.push(version ? `${item.state.spec.title} ${version}` : item.state.spec.title);
						} catch (error) {
							failed.push(item.state.spec.title);
							await showComponentError(`${item.state.spec.title}: ${error instanceof Error ? error.message : String(error)}`);
						}
					}
				}
			);

			if (picked.some((item) => item.state.spec.id === 'metadataTree' || item.state.spec.id === 'jre')) {
				void metadataTreeProvider.refresh();
			}
			if (done.length > 0) {
				notifyQuiet(`Обновлены компоненты: ${done.join(', ')}`);
			}
		})),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('1c-platform-tools.metadata')) {
				void metadataTreeProvider.refresh();
			}
		}),
	];

	return [...metadataDisposables, ...paletteSource];
}

/** Собирает файл выбранного узла. */
async function compileMetadataTarget(
	artifactCommands: ArtifactCommands,
	kind: MetadataCompileKind,
	sourceUri: vscode.Uri
): Promise<void> {
	switch (kind) {
		case 'configuration':
			await artifactCommands.buildConfiguration(sourceUri);
			return;
		case 'extension':
			await artifactCommands.buildExtension(sourceUri);
			return;
		case 'processor':
			await artifactCommands.buildProcessor(sourceUri);
			return;
		case 'report':
			await artifactCommands.buildReport(sourceUri);
			return;
		default: {
			const _exhaustive: never = kind;
			return _exhaustive;
		}
	}
}
