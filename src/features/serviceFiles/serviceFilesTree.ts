/**
 * Дерево панели «1С: Служебные файлы».
 *
 * Щелчок по отсутствующей строке только создаёт файл.
 * Следующий щелчок открывает его: профиль, хуки и пайплайны своим редактором, остальные текстом.
 * Кнопка в строке выбирает профиль запуска, файл Vanessa Runner и окружение.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { currentRoot, isOneScriptProject, onDidChangeCurrentProject } from '../../shared/workspaceProjects';
import { SERVICE_FILES_EXPANDED_GROUPS_STATE, projectMemento } from '../../shared/projectState';
import { detectSettingsFormat, parseEnvFileName, type SettingsFileFormat, type SettingsSchema } from '../../shared/envProfiles';
import { readSettingsJsonSync } from '../../shared/settingsJson';
import { parseEnvironmentFileName, BASE_DOTENV_FILE } from '../../shared/environments';
import { getServiceFileSpec, resolveLaunchProfileSpec, serviceFileLabel, serviceFilesFor } from './registry';
import { referencedSettingFiles } from '../testing/projectTestConfig';
import { readPipelines } from '../../shared/pipelines/pipelineFile';
import { PIPELINE_TEMPLATE_ID_PREFIX } from '../../shared/pipelines/pipelineTemplates';
import {
	BUILD_KINDS,
	pathIsNotable,
	classifyServiceFile,
	environmentFileRows,
	LOCAL_DOTENV_FILE,
	profileFileRows,
	rowsOf,
	sortServiceRows,
	vrunnerFileRows,
	scanServiceFiles,
	variantPath,
	type DiscoveredServiceFile,
	type ServiceFileKind,
	type ServiceFileRow,
} from './catalog';

/** Группа или файл в дереве. */
class ServiceNode extends vscode.TreeItem {
	readonly group: ServiceFileKind | 'repo' | 'automation' | undefined;
	readonly row: ServiceFileRow | undefined;

	constructor(
		label: string,
		group: ServiceFileKind | 'repo' | 'automation' | undefined,
		row: ServiceFileRow | undefined,
		collapsible: vscode.TreeItemCollapsibleState
	) {
		super(label, collapsible);
		this.group = group;
		this.row = row;
	}
}

const GROUPS: { id: ServiceFileKind | 'repo' | 'automation'; label: string; icon: string }[] = [
	{ id: 'profile', label: 'Профиль запуска', icon: 'rocket' },
	{ id: 'environment', label: 'Окружение', icon: 'variable-group' },
	{ id: 'repo', label: 'Репозиторий', icon: 'source-control' },
	{ id: 'automation', label: 'Автоматизация', icon: 'run-all' },
	{ id: 'vrunner', label: 'Vanessa Runner', icon: 'rocket' },
	{ id: 'vanessa', label: 'Vanessa Automation', icon: 'beaker' },
	{ id: 'xunit', label: 'xUnit', icon: 'beaker' },
	{ id: 'yaxunit', label: 'YAxUnit', icon: 'beaker' },
	{ id: 'syntax', label: 'Синтаксический контроль', icon: 'beaker' },
];

/**
 * Дерево служебных файлов текущего проекта.
 */
export class ServiceFilesTreeProvider implements vscode.TreeDataProvider<ServiceNode>, vscode.Disposable {
	private readonly onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.onDidChange.event;
	private readonly disposables: vscode.Disposable[] = [];
	private watcher: vscode.Disposable | undefined;
	private watchTimer: ReturnType<typeof setTimeout> | undefined;
	private discovered: DiscoveredServiceFile[] = [];
	private linkedFiles = new Set<string>();
	private profileLabel = '';
	private rootNodes: ServiceNode[] | undefined;
	private readonly files = new Map<string, ServiceNode>();
	private readonly groupChildren = new Map<string, ServiceNode[]>();

	constructor(private readonly vrunner: VRunnerManager) {
		this.disposables.push(
			this.vrunner.onDidChangeActiveEnvProfile(() => this.refresh()),
			this.vrunner.onDidChangeActiveEnvironment(() => this.refresh()),
			onDidChangeCurrentProject(() => {
				this.watch(currentRoot());
				this.refresh();
			}),
			vscode.workspace.onDidCreateFiles((event) => {
				if (event.files.some((uri) => this.affectsTree(uri))) {
					this.scheduleRefresh();
				}
			}),
			vscode.workspace.onDidDeleteFiles((event) => {
				if (event.files.some((uri) => this.affectsTree(uri))) {
					this.scheduleRefresh();
				}
			}),
			vscode.workspace.onDidRenameFiles((event) => {
				if (event.files.some((entry) => this.affectsTree(entry.oldUri) || this.affectsTree(entry.newUri))) {
					this.scheduleRefresh();
				}
			}),
			new vscode.Disposable(() => this.watcher?.dispose())
		);
		this.watch(currentRoot());
	}

	refresh(): void {
		this.rootNodes = undefined;
		this.files.clear();
		this.groupChildren.clear();
		this.onDidChange.fire();
	}

	getParent(element: ServiceNode): ServiceNode | undefined {
		if (!element.row || !element.group) {
			return undefined;
		}
		return this.rootNodes?.find((node) => node.group === element.group && !node.row);
	}

	/** Строка дерева для открытого файла. Дерево при этом заполняется. */
	async nodeFor(relPath: string): Promise<ServiceNode | undefined> {
		const roots = await this.getChildren();
		const known = this.files.get(relPath);
		if (known) {
			return known;
		}
		const parent = roots.find((node) => node.group === parentGroupOf(relPath) && !node.row);
		if (!parent) {
			return undefined;
		}
		await this.getChildren(parent);
		return this.files.get(relPath);
	}

	/** Запоминает раскрытие группы в состоянии текущего проекта. */
	rememberExpanded(element: unknown, expanded: boolean): Thenable<void> {
		if (!(element instanceof ServiceNode) || element.row || !element.group) {
			return Promise.resolve();
		}
		const root = currentRoot();
		const current = expandedGroups(root);
		if (expanded) {
			current.add(element.group);
		} else {
			current.delete(element.group);
		}
		return projectMemento(root).update(SERVICE_FILES_EXPANDED_GROUPS_STATE, [...current]);
	}

	/** Кнопка строки: выбрать профиль запуска, файл Vanessa Runner или окружение. */
	async select(element: unknown): Promise<void> {
		if (!(element instanceof ServiceNode)) {
			return;
		}
		const row = element.row;
		if (!row?.exists) {
			return;
		}
		const schema = this.vrunner.getActiveSettingsSchema();
		if (row.kind === 'profile') {
			const parsed = parseEnvFileName(path.posix.basename(row.relPath), schema);
			if (!parsed || row.relPath === this.activeProfile()) {
				return;
			}
			await vscode.commands.executeCommand('1c-platform-tools.env.selectProfile', parsed.id);
			return;
		}
		if (row.kind === 'vrunner') {
			if (row.relPath === this.activeProfile()) {
				return;
			}
			await vscode.commands.executeCommand('1c-platform-tools.env.selectProfile', row.relPath);
			return;
		}
		if (row.kind === 'environment' && row.relPath !== LOCAL_DOTENV_FILE) {
			if (row.relPath === this.selectedEnvironmentFile()) {
				return;
			}
			const id = row.relPath === BASE_DOTENV_FILE ? '' : parseEnvironmentFileName(path.posix.basename(row.relPath));
			if (id === undefined) {
				return;
			}
			await vscode.commands.executeCommand('1c-platform-tools.env.selectEnvironment', id);
		}
	}

	dispose(): void {
		if (this.watchTimer !== undefined) {
			clearTimeout(this.watchTimer);
		}
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	getTreeItem(element: ServiceNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ServiceNode): Promise<ServiceNode[]> {
		const root = currentRoot();
		if (!root) {
			void vscode.commands.executeCommand('setContext', BASE_SET_READY, false);
			return [];
		}
		if (!element) {
			if (this.rootNodes) {
				return this.rootNodes;
			}
			await this.load(root);
			this.files.clear();
			this.rootNodes = this.roots(isOneScriptProject(root));
			return this.rootNodes;
		}
		if (element.row) {
			return [];
		}
		const group = element.group;
		if (!group) {
			return [];
		}
		const cached = this.groupChildren.get(group);
		if (cached) {
			return cached;
		}
		const children = await this.groupNodes(group, root);
		this.groupChildren.set(group, children);
		return children;
	}

	private async groupNodes(group: ServiceFileKind | 'repo' | 'automation', root: string): Promise<ServiceNode[]> {
		if (group === 'repo') {
			return [...this.fileNodes('gitignore', 'repo'), ...this.fileNodes('gitattributes', 'repo')];
		}
		if (group === 'automation') {
			const installed = (await readPipelines(root)).some((pipeline) => pipeline.id.startsWith(PIPELINE_TEMPLATE_ID_PREFIX));
			const templates = new ServiceNode('1cpt: типовые пайплайны', undefined, undefined, vscode.TreeItemCollapsibleState.None);
			templates.iconPath = new vscode.ThemeIcon(installed ? 'check' : 'add');
			templates.tooltip = installed ? 'Открыть редактор' : 'Добавить типовые пайплайны';
			templates.command = installed
				? { command: '1c-platform-tools.pipelines.openEditor', title: 'Пайплайны' }
				: { command: '1c-platform-tools.pipelines.addTemplates', title: 'Типовые пайплайны' };
			return [...this.fileNodes('hooks', 'automation'), ...this.fileNodes('pipelines', 'automation'), templates];
		}
		if (group === 'profile' || group === 'environment' || variantPath(group, 'ci')) {
			return [...this.fileNodes(group, group), addNode(group)];
		}
		return this.fileNodes(group, group);
	}

	private roots(oneScript: boolean): ServiceNode[] {
		const open = expandedGroups(currentRoot());
		return GROUPS
			.filter((group) => !(oneScript && BUILD_KINDS.has(group.id as ServiceFileKind)))
			.map((group) => {
				const node = new ServiceNode(
					group.label,
					group.id,
					undefined,
					open.has(group.id)
						? vscode.TreeItemCollapsibleState.Expanded
						: vscode.TreeItemCollapsibleState.Collapsed
				);
				node.iconPath = new vscode.ThemeIcon(group.icon);
				return node;
			});
	}

	private fileNodes(kind: ServiceFileKind, parent: ServiceFileKind | 'repo' | 'automation'): ServiceNode[] {
		const schema = this.vrunner.getActiveSettingsSchema();
		const rows = kind === 'profile'
			? profileFileRows(this.discovered, schema)
			: kind === 'vrunner'
				? this.vrunnerRows(schema)
				: kind === 'environment'
					? environmentFileRows(this.discovered)
					: rowsOf(kind, this.discovered);
		return sortServiceRows(rows).map((row) => this.fileNode(row, schema, parent));
	}

	private fileNode(row: ServiceFileRow, schema: SettingsSchema, parent: ServiceFileKind | 'repo' | 'automation'): ServiceNode {
		const node = new ServiceNode(fileLabel(row, schema), parent, row, vscode.TreeItemCollapsibleState.None);
		this.files.set(row.relPath, node);
		const marks = marksOf(row, this.activeProfile(), this.selectedEnvironmentFile(), this.linkedFiles, this.profileLabel);
		node.description = [marks, pathIsNotable(row.kind, row.relPath) ? row.relPath : ''].filter((part) => part.length > 0).join(' · ');
		node.iconPath = new vscode.ThemeIcon(row.exists ? 'check' : 'add');
		node.tooltip = databaseTooltip(currentRoot(), row);
		node.contextValue = selectContext(row, this.activeProfile(), this.selectedEnvironmentFile());
		node.command = rowClickCommand(row);
		return node;
	}

	/** Уже лежащие файлы Vanessa Runner только текущей схемы. Места для новых остаются. */
	private vrunnerRows(schema: SettingsSchema): ServiceFileRow[] {
		const root = currentRoot();
		return vrunnerFileRows(this.discovered, schema, (relPath) => this.vrunnerFormat(root, relPath));
	}

	private vrunnerFormat(root: string | undefined, relPath: string): SettingsFileFormat | undefined {
		if (!root) {
			return undefined;
		}
		try {
			return detectSettingsFormat(readSettingsJsonSync(path.join(root, relPath)));
		} catch {
			return undefined;
		}
	}

	private async load(root: string): Promise<void> {
		this.discovered = await scanServiceFiles(root);
		await this.rememberProfileCalls();
		void vscode.commands.executeCommand('setContext', BASE_SET_READY, baseSetReady(root, this.vrunner.getActiveSettingsSchema()));
	}

	private async rememberProfileCalls(): Promise<void> {
		const { settings, schema } = await this.vrunner.readActiveSettings();
		const files = [...referencedSettingFiles(settings, schema), this.vrunner.linkedVrunnerFile()];
		this.linkedFiles = new Set(files.filter((file): file is string => file !== undefined).map(servicePathKey));
		this.profileLabel = this.linkedFiles.size > 0 ? this.vrunner.launchSummary().profile.label : '';
	}

	private activeProfile(): string {
		return this.vrunner.getActiveEnvFile().replace(/\\/g, '/');
	}

	private selectedEnvironmentFile(): string {
		const id = this.vrunner.activeEnvironment().id;
		return id ? `.env.${id}` : BASE_DOTENV_FILE;
	}

	private affectsTree(uri: vscode.Uri): boolean {
		const root = currentRoot();
		if (!root || uri.scheme !== 'file') {
			return false;
		}
		const rel = path.relative(root, uri.fsPath).replace(/\\/g, '/');
		return rel === '.1cpt' || rel.startsWith('.1cpt/') || classifyServiceFile(rel) !== undefined;
	}

	private watch(root: string | undefined): void {
		this.watcher?.dispose();
		this.watcher = undefined;
		if (!root) {
			return;
		}
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(
			root,
			'{**/vrunner*.json,**/VAParams*.json,**/xUnitParams*.json,**/yaxunit*.json,**/vanessaConf.json,**/syntax-check*.txt,**/.env*,**/env*.json,**/autumn-properties*.json,.gitignore,.gitattributes,.1cpt,**/.1cpt/**}'
		));
		const refresh = (): void => this.scheduleRefresh();
		this.watcher = vscode.Disposable.from(
			watcher,
			watcher.onDidCreate(refresh),
			watcher.onDidChange(refresh),
			watcher.onDidDelete(refresh)
		);
	}

	/** Появление, правка и удаление файла сами обновляют отметки в дереве. */
	private scheduleRefresh(): void {
		if (this.watchTimer !== undefined) {
			clearTimeout(this.watchTimer);
		}
		this.watchTimer = setTimeout(() => {
			this.watchTimer = undefined;
			this.refresh();
		}, 200);
	}
}

const BASE_SET_READY = '1c-platform-tools.serviceFiles.baseSetReady';

/** Раскрытые группы проекта. Пока человек ничего не раскрывал, групп в списке нет. */
function expandedGroups(root: string | undefined): Set<string> {
	const saved = projectMemento(root).get<unknown>(SERVICE_FILES_EXPANDED_GROUPS_STATE);
	if (!Array.isArray(saved)) {
		return new Set();
	}
	return new Set(saved.filter((id): id is string => typeof id === 'string'));
}

function baseSetReady(root: string, schema: SettingsSchema): boolean {
	const oneScript = isOneScriptProject(root);
	return serviceFilesFor(oneScript)
		.filter((spec) => spec.recommended)
		.every((spec) => {
			const relPath = spec.id === 'launchProfile' ? resolveLaunchProfileSpec(schema, oneScript).relPath : spec.relPath;
			return fs.existsSync(path.join(root, relPath));
		});
}

function parentGroupOf(relPath: string): ServiceFileKind | 'repo' | 'automation' | undefined {
	const kind = classifyServiceFile(relPath);
	if (!kind) {
		return undefined;
	}
	if (kind === 'gitignore' || kind === 'gitattributes') {
		return 'repo';
	}
	if (kind === 'hooks' || kind === 'pipelines') {
		return 'automation';
	}
	return kind;
}

function addNode(kind: ServiceFileKind): ServiceNode {
	const node = new ServiceNode(addLabel(kind), undefined, undefined, vscode.TreeItemCollapsibleState.None);
	node.iconPath = new vscode.ThemeIcon('add');
	node.command = addCommand(kind);
	return node;
}

function addLabel(kind: ServiceFileKind): string {
	switch (kind) {
		case 'profile':
			return 'Создать профиль…';
		case 'environment':
			return 'Создать окружение…';
		default:
			return 'Другое имя…';
	}
}

function addCommand(kind: ServiceFileKind): vscode.Command {
	switch (kind) {
		case 'profile':
			return { command: '1c-platform-tools.env.createProfile', title: 'Создать профиль' };
		case 'environment':
			return { command: '1c-platform-tools.env.createEnvironment', title: 'Создать окружение' };
		case 'vrunner':
			return { command: '1c-platform-tools.serviceFiles.addVrunner', title: addLabel(kind) };
		case 'vanessa':
			return { command: '1c-platform-tools.serviceFiles.addVanessa', title: addLabel(kind) };
		case 'xunit':
			return { command: '1c-platform-tools.serviceFiles.addXunit', title: addLabel(kind) };
		case 'yaxunit':
			return { command: '1c-platform-tools.serviceFiles.addYaxunit', title: addLabel(kind) };
		case 'gitignore':
		case 'gitattributes':
		case 'hooks':
		case 'pipelines':
		case 'syntax':
			return { command: '1c-platform-tools.serviceFiles.addVariant', title: addLabel(kind) };
		default: {
			const unknown: never = kind;
			return unknown;
		}
	}
}

function fileLabel(row: ServiceFileRow, schema: SettingsSchema): string {
	const name = row.relPath.split('/').pop() ?? row.relPath;
	switch (row.kind) {
		case 'profile': {
			const parsed = parseEnvFileName(name, schema);
			if (!parsed) {
				return name;
			}
			return parsed.isBase ? launchProfileLabel() : parsed.label;
		}
		case 'environment':
			if (name === BASE_DOTENV_FILE) {
				return getServiceFileSpec('environment')?.label ?? 'Осн. настройка окружения';
			}
			if (name === LOCAL_DOTENV_FILE) {
				return 'Локально';
			}
			return parseEnvironmentFileName(name) ?? name;
		case 'gitignore':
		case 'gitattributes':
		case 'hooks':
		case 'pipelines':
		case 'vrunner':
		case 'vanessa':
		case 'xunit':
		case 'yaxunit':
		case 'syntax':
			return serviceFileLabel(name);
		default: {
			const neverKind: never = row.kind;
			return neverKind;
		}
	}
}

function databaseTooltip(root: string | undefined, row: ServiceFileRow): string {
	if (!root || !row.exists || (row.kind !== 'profile' && row.kind !== 'vrunner')) {
		return row.relPath;
	}
	const own = ibConnectionOf(readSettingsQuiet(path.join(root, row.relPath)));
	return own ? `${row.relPath}\nБаза: ${own}` : `${row.relPath}\nБаза не задана`;
}

function readSettingsQuiet(fullPath: string): unknown {
	try {
		return readSettingsJsonSync(fullPath);
	} catch {
		return undefined;
	}
}

function ibConnectionOf(doc: unknown): string | undefined {
	if (typeof doc !== 'object' || doc === null) {
		return undefined;
	}
	const record = doc as { vrunner?: { ibconnection?: unknown }; default?: { '--ibconnection'?: unknown } };
	const v3 = record.vrunner?.ibconnection;
	if (typeof v3 === 'string' && v3.trim().length > 0) {
		return v3.trim();
	}
	const v2 = record.default?.['--ibconnection'];
	if (typeof v2 === 'string' && v2.trim().length > 0) {
		return v2.trim();
	}
	return undefined;
}

function launchProfileLabel(): string {
	return getServiceFileSpec('launchProfile')?.label ?? 'Осн. профиль запуска';
}

function selectContext(row: ServiceFileRow, profile: string, environmentFile: string): string | undefined {
	if (!row.exists) {
		return undefined;
	}
	if ((row.kind === 'profile' || row.kind === 'vrunner') && row.relPath !== profile) {
		return 'serviceFileProfile';
	}
	if (row.kind === 'environment' && row.relPath !== LOCAL_DOTENV_FILE && row.relPath !== environmentFile) {
		return 'serviceFileEnvironment';
	}
	return undefined;
}

function marksOf(
	row: ServiceFileRow,
	profile: string,
	environmentFile: string,
	linkedFiles: ReadonlySet<string>,
	profileLabel: string,
): string {
	if (row.exists && (row.kind === 'profile' || row.kind === 'vrunner') && row.relPath === profile) {
		return 'выбран';
	}
	if (row.exists && row.kind === 'environment' && row.relPath === environmentFile) {
		return 'выбрано';
	}
	if (profileLabel.length > 0 && linkedFiles.has(servicePathKey(row.relPath))) {
		return profileLabel;
	}
	return '';
}

function servicePathKey(file: string): string {
	return file.replace(/\\/g, '/').replace(/^\.\//, '');
}

const CREATE_ONLY = { createOnly: true };

/** Команды строк, уже зарегистрированные. Повторная регистрация того же пути не нужна. */
const rowCommands = new Set<string>();

/**
 * Щелчок по строке. Путь записан в имени команды, без аргументов.
 *
 * @param row - Строка, которую открывают или создают
 */
function rowClickCommand(row: ServiceFileRow): vscode.Command {
	const id = `1c-platform-tools.serviceFiles.row.${Buffer.from(row.relPath, 'utf8').toString('base64url')}`;
	if (!rowCommands.has(id)) {
		rowCommands.add(id);
		const relPath = row.relPath;
		const kind = row.kind;
		vscode.commands.registerCommand(id, () => openServiceRow(relPath, kind));
	}
	return { command: id, title: row.exists ? 'Открыть' : 'Создать' };
}

/** Создаёт или открывает файл строки. Наличие смотрит на диске, а не в устаревшей строке. */
async function openServiceRow(relPath: string, kind: ServiceFileKind): Promise<void> {
	const root = currentRoot();
	if (!root) {
		return;
	}
	const normalized = relPath.replace(/\\/g, '/');
	const row: ServiceFileRow = { kind, relPath: normalized, exists: fs.existsSync(path.join(root, normalized)) };
	const action = commandOf(row, VRunnerManager.getInstance().getActiveSettingsSchema());
	await vscode.commands.executeCommand(action.command, ...(action.arguments ?? []));
}

function commandOf(row: ServiceFileRow, schema: SettingsSchema): vscode.Command {
	if (!row.exists) {
		if (row.kind === 'environment' && (row.relPath === BASE_DOTENV_FILE || row.relPath === LOCAL_DOTENV_FILE)) {
			const local = row.relPath === LOCAL_DOTENV_FILE;
			return {
				command: '1c-platform-tools.serviceFiles.ensure',
				title: 'Окружение',
				arguments: [local ? 'environmentLocal' : 'environment', CREATE_ONLY],
			};
		}
		if (row.kind === 'profile') {
			return { command: '1c-platform-tools.serviceFiles.ensure', title: 'Профиль', arguments: ['launchProfile', CREATE_ONLY] };
		}
		return { command: '1c-platform-tools.serviceFiles.createBuildFile', title: 'Создать', arguments: [row.relPath, CREATE_ONLY] };
	}
	const uri = vscode.Uri.file(path.join(currentRoot() ?? '', row.relPath));
	if (row.kind === 'hooks') {
		return { command: '1c-platform-tools.hooks.openEditor', title: 'Хуки' };
	}
	if (row.kind === 'pipelines') {
		return { command: '1c-platform-tools.pipelines.openEditor', title: 'Пайплайны' };
	}
	if (row.kind === 'profile' && parseEnvFileName(path.posix.basename(row.relPath), schema)) {
		return { command: 'vscode.openWith', title: 'Редактор', arguments: [uri, '1c-platform-tools.profileEditor'] };
	}
	if (row.kind === 'environment' && (row.relPath === BASE_DOTENV_FILE || row.relPath === LOCAL_DOTENV_FILE)) {
		const local = row.relPath === LOCAL_DOTENV_FILE;
		return {
			command: '1c-platform-tools.serviceFiles.ensure',
			title: 'Окружение',
			arguments: [local ? 'environmentLocal' : 'environment'],
		};
	}
	return { command: 'vscode.open', title: 'Открыть', arguments: [uri] };
}
