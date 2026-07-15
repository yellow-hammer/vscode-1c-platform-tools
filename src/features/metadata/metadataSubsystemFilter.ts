/**
 * Отбор объектов дерева метаданных по подсистемам.
 *
 * Дерево подсистем и их состав читает md-sparrow одной операцией `cf-md-subsystem-tree`:
 * вложенность берётся из XML, а не угадывается по раскладке каталогов.
 * @module metadataSubsystemFilter
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import { runMdSparrowParamsRead } from './mdSparrowParams';
import { mdSparrowSchemaFlagFromConfigurationXml } from './mdSparrowSchemaVersion';
import type { MetadataTreeDataProvider } from './metadataTreeView';

const log = logger.scope('метаданные');

/** Узел дерева подсистем, как его отдаёт md-sparrow. */
export interface SubsystemNode {
	readonly name: string;
	readonly xmlPath: string;
	readonly contentRefs: readonly string[];
	readonly children: readonly SubsystemNode[];
}

export interface SubsystemFilterOptions {
	/** Включать объекты из подчинённых подсистем. */
	readonly includeNested: boolean;
	/** Включать объекты из родительских подсистем. */
	readonly includeParents: boolean;
}

/** Состав отбора: имена и ключи разрешённых объектов. */
export interface SubsystemFilterResult {
	readonly names: Set<string>;
	readonly keys: Set<string>;
	readonly subsystemNames: Set<string>;
}

const CLI_ERR_PREVIEW = 500;

/**
 * Читает подсистемы всех источников проекта одной операцией на источник.
 */
export async function loadSubsystemTrees(
	context: vscode.ExtensionContext,
	treeProvider: MetadataTreeDataProvider
): Promise<SubsystemNode[]> {
	const cached = treeProvider.getCachedTree();
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!cached || !workspaceRoot) {
		return [];
	}
	const runtime = await ensureMdSparrowRuntime(context);
	const out: SubsystemNode[] = [];
	for (const source of cached.sources) {
		if (!source.configurationXmlRelativePath) {
			continue;
		}
		const configurationXml = path.join(workspaceRoot, source.configurationXmlRelativePath);
		const metadataRoot = source.metadataRootRelativePath
			? path.join(workspaceRoot, source.metadataRootRelativePath)
			: path.dirname(configurationXml);
		try {
			const schema = await mdSparrowSchemaFlagFromConfigurationXml(configurationXml);
			const res = await runMdSparrowParamsRead(
				runtime,
				{ op: 'cf-md-subsystem-tree', configurationXml, schemaVersion: schema },
				{ cwd: metadataRoot }
			);
			if (res.exitCode !== 0) {
				log.error(`подсистемы: ${(res.stderr.trim() || res.stdout.trim()).slice(0, CLI_ERR_PREVIEW)}`);
				continue;
			}
			const nodes = JSON.parse(res.stdout.trim()) as SubsystemNode[];
			if (Array.isArray(nodes)) {
				out.push(...nodes);
			}
		} catch (e) {
			log.error(`подсистемы: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	return out;
}

/**
 * Считает состав отбора по отмеченным подсистемам.
 *
 * @param checkedPaths пути к XML отмеченных подсистем
 */
export function computeSubsystemFilter(
	roots: readonly SubsystemNode[],
	checkedPaths: ReadonlySet<string>,
	options: SubsystemFilterOptions
): SubsystemFilterResult {
	const result: SubsystemFilterResult = { names: new Set(), keys: new Set(), subsystemNames: new Set() };
	if (checkedPaths.size === 0) {
		return result;
	}
	const walk = (node: SubsystemNode, ancestors: SubsystemNode[]): void => {
		if (checkedPaths.has(node.xmlPath)) {
			include(node, result);
			if (options.includeNested) {
				for (const child of node.children) {
					includeSubtree(child, result);
				}
			}
			if (options.includeParents) {
				for (const ancestor of ancestors) {
					include(ancestor, result);
				}
			}
		}
		for (const child of node.children) {
			walk(child, [...ancestors, node]);
		}
	};
	for (const root of roots) {
		walk(root, []);
	}
	return result;
}

function includeSubtree(node: SubsystemNode, result: SubsystemFilterResult): void {
	include(node, result);
	for (const child of node.children) {
		includeSubtree(child, result);
	}
}

function include(node: SubsystemNode, result: SubsystemFilterResult): void {
	result.subsystemNames.add(node.name);
	result.names.add(node.name);
	result.keys.add(`Subsystem.${node.name}`);
	for (const name of parseContentRefsToObjectNames([...node.contentRefs])) {
		result.names.add(name);
	}
	for (const key of parseContentRefsToObjectKeys([...node.contentRefs])) {
		result.keys.add(key);
	}
}

/** Находит подсистему по имени: контекстное меню дерева отдаёт только имя узла. */
export function findSubsystemByName(roots: readonly SubsystemNode[], name: string): SubsystemNode | undefined {
	for (const root of roots) {
		if (root.name === name) {
			return root;
		}
		const found = findSubsystemByName(root.children, name);
		if (found) {
			return found;
		}
	}
	return undefined;
}

/**
 * Имена объектов из ссылок состава: {@code Catalog.Номенклатура} и {@code Catalogs/Номенклатура.xml}
 * дают {@code Номенклатура}.
 */
export function parseContentRefsToObjectNames(contentRefs: string[]): Set<string> {
	const out = new Set<string>();
	for (const raw of contentRefs) {
		const trimmed = raw.trim();
		if (!trimmed) {
			continue;
		}
		const pathParts = trimmed.split(/[\\/]/g).filter((x) => x.length > 0);
		const lastSegment = (pathParts[pathParts.length - 1] ?? '').replace(/\.xml$/i, '');
		const dotParts = lastSegment.split('.').filter((x) => x.length > 0);
		const candidate = dotParts[dotParts.length - 1] ?? '';
		if (candidate) {
			out.add(candidate);
		}
	}
	return out;
}

export function parseContentRefsToObjectKeys(contentRefs: string[]): Set<string> {
	const out = new Set<string>();
	for (const raw of contentRefs) {
		const trimmed = raw.trim();
		if (!trimmed) {
			continue;
		}
		const parts = trimmed.split('.');
		if (parts.length >= 2) {
			const objectType = normalizeMdObjectTypeFromRefPrefix(parts[0] ?? '');
			const objectName = parts.slice(1).join('.').trim();
			if (objectType && objectName) {
				out.add(`${objectType}.${objectName}`);
			}
		}
	}
	return out;
}

function normalizeMdObjectTypeFromRefPrefix(prefix: string): string {
	const p = prefix.trim();
	switch (p) {
		case 'Catalog':
		case 'Constant':
		case 'Enum':
		case 'Document':
		case 'DocumentJournal':
		case 'Report':
		case 'DataProcessor':
		case 'ChartOfCharacteristicTypes':
		case 'ChartOfAccounts':
		case 'ChartOfCalculationTypes':
		case 'InformationRegister':
		case 'AccumulationRegister':
		case 'AccountingRegister':
		case 'CalculationRegister':
		case 'BusinessProcess':
		case 'Task':
		case 'ExchangePlan':
		case 'CommonModule':
		case 'CommonPicture':
		case 'CommonAttribute':
		case 'Subsystem':
		case 'Role':
		case 'SessionParameter':
		case 'ExternalDataSource':
		case 'DocumentNumerator':
			return p;
		default:
			return '';
	}
}
