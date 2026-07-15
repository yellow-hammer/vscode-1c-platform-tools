/**
 * Отбор объектов дерева метаданных по подсистемам: общая логика для панели «Фильтры»
 * и контекстного меню подсистемы.
 *
 * Иерархию подсистем берём из раскладки файлов (`Subsystems/<Имя>/Subsystems/<Вложенная>.xml`),
 * состав — из `cf-md-object-get`, поэтому читаем только выбранные ветки.
 * @module metadataSubsystemFilter
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import { runMdSparrowParamsRead } from './mdSparrowParams';
import { mdSparrowSchemaFlagFromConfigurationXml } from './mdSparrowSchemaVersion';
import type { MetadataTreeDataProvider } from './metadataTreeView';

/** Подсистема как источник отбора: имя и пути, которых хватает для чтения состава. */
export interface SubsystemRef {
	readonly sourceId: string;
	readonly name: string;
	readonly xmlAbs: string;
	readonly configurationXmlAbs: string | undefined;
	readonly metadataRootAbs: string | undefined;
}

export interface SubsystemFilterOptions {
	/** Включать объекты из подчинённых подсистем. */
	readonly includeNested: boolean;
	/** Включать объекты из родительских подсистем. */
	readonly includeParents: boolean;
}

const CLI_ERR_PREVIEW = 500;

/** XML родительской подсистемы либо undefined для подсистемы верхнего уровня. */
export function parentSubsystemXml(xmlAbs: string): string | undefined {
	const dir = path.dirname(xmlAbs);
	if (path.basename(dir) !== 'Subsystems') {
		return undefined;
	}
	const ownerDir = path.dirname(dir);
	const ownerParent = path.dirname(ownerDir);
	if (path.basename(ownerParent) !== 'Subsystems') {
		return undefined;
	}
	return path.join(ownerParent, `${path.basename(ownerDir)}.xml`);
}

/** XML подчинённых подсистем по раскладке файлов. */
export function nestedSubsystemXmls(xmlAbs: string, name: string): string[] {
	const dir = path.join(path.dirname(xmlAbs), name, 'Subsystems');
	try {
		return fs
			.readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.xml'))
			.map((entry) => path.join(dir, entry.name));
	} catch {
		return [];
	}
}

export function hasNestedSubsystems(xmlAbs: string, name: string): boolean {
	return nestedSubsystemXmls(xmlAbs, name).length > 0;
}

function refFrom(source: SubsystemRef, xmlAbs: string): SubsystemRef {
	return {
		sourceId: source.sourceId,
		name: path.basename(xmlAbs, '.xml'),
		xmlAbs,
		configurationXmlAbs: source.configurationXmlAbs,
		metadataRootAbs: source.metadataRootAbs,
	};
}

interface SubsystemDto {
	contentRefs?: unknown[];
	nestedSubsystems?: unknown[];
}

/**
 * Считает состав отбора по выбранным подсистемам и применяет его к дереву.
 *
 * @returns false, если состав прочитать не удалось
 */
export async function applySubsystemFilter(
	context: vscode.ExtensionContext,
	provider: MetadataTreeDataProvider,
	selected: readonly SubsystemRef[],
	options: SubsystemFilterOptions,
	label: string
): Promise<boolean> {
	if (selected.length === 0) {
		return false;
	}
	const runtime = await ensureMdSparrowRuntime(context);
	const schemaByConfig = new Map<string, string>();
	const readDto = async (ref: SubsystemRef): Promise<SubsystemDto | undefined> => {
		if (!ref.configurationXmlAbs || !ref.metadataRootAbs) {
			return undefined;
		}
		let schema = schemaByConfig.get(ref.configurationXmlAbs);
		if (!schema) {
			schema = await mdSparrowSchemaFlagFromConfigurationXml(ref.configurationXmlAbs);
			schemaByConfig.set(ref.configurationXmlAbs, schema);
		}
		const res = await runMdSparrowParamsRead(
			runtime,
			{ op: 'cf-md-object-get', objectXml: ref.xmlAbs, schemaVersion: schema },
			{ cwd: ref.metadataRootAbs }
		);
		if (res.exitCode !== 0) {
			const errText = (res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`).slice(0, CLI_ERR_PREVIEW);
			void vscode.window.showErrorMessage(errText);
			return undefined;
		}
		try {
			return JSON.parse(res.stdout.trim()) as SubsystemDto;
		} catch {
			void vscode.window.showErrorMessage(`Не удалось разобрать состав подсистемы: ${ref.name}`);
			return undefined;
		}
	};

	const allowedNames = new Set<string>();
	const allowedKeys = new Set<string>();
	const allowedSubsystemNames = new Set<string>();
	const visited = new Set<string>();
	let read = false;

	const addContent = (dto: SubsystemDto): void => {
		const refs = Array.isArray(dto.contentRefs) ? dto.contentRefs.filter((x): x is string => typeof x === 'string') : [];
		for (const name of parseContentRefsToObjectNames(refs)) {
			allowedNames.add(name);
		}
		for (const key of parseContentRefsToObjectKeys(refs)) {
			allowedKeys.add(key);
		}
	};

	const addSubsystem = (ref: SubsystemRef): void => {
		allowedSubsystemNames.add(ref.name);
		allowedNames.add(ref.name);
		allowedKeys.add(`Subsystem.${ref.name}`);
	};

	const walkDown = async (ref: SubsystemRef): Promise<void> => {
		if (visited.has(ref.xmlAbs)) {
			return;
		}
		visited.add(ref.xmlAbs);
		addSubsystem(ref);
		const dto = await readDto(ref);
		if (!dto) {
			return;
		}
		read = true;
		addContent(dto);
		if (!options.includeNested) {
			return;
		}
		for (const nestedXml of nestedSubsystemXmls(ref.xmlAbs, ref.name)) {
			await walkDown(refFrom(ref, nestedXml));
		}
	};

	const walkUp = async (ref: SubsystemRef): Promise<void> => {
		let parentXml = parentSubsystemXml(ref.xmlAbs);
		while (parentXml) {
			const parent = refFrom(ref, parentXml);
			if (visited.has(parent.xmlAbs)) {
				break;
			}
			visited.add(parent.xmlAbs);
			addSubsystem(parent);
			const dto = await readDto(parent);
			if (dto) {
				read = true;
				addContent(dto);
			}
			parentXml = parentSubsystemXml(parent.xmlAbs);
		}
	};

	for (const ref of selected) {
		await walkDown(ref);
	}
	if (options.includeParents) {
		for (const ref of selected) {
			await walkUp(ref);
		}
	}
	if (!read) {
		return false;
	}
	provider.setSubsystemFilter(label, allowedNames, allowedKeys, allowedSubsystemNames);
	void vscode.commands.executeCommand('setContext', '1c-platform-tools.metadata.subsystemFilterActive', true);
	return true;
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
