import * as path from 'node:path';
import * as vscode from 'vscode';
import { formatOfFile, moduleFileOf } from '../../shared/objectPaths';
import { MetadataLeafTreeItem, MetadataSourceTreeItem } from './metadataTreeView';
import type { SourceVersionTarget } from './sourceVersions';

export type MetadataCompileKind = 'configuration' | 'extension' | 'processor' | 'report';

export interface MetadataCompileTarget {
	readonly kind: MetadataCompileKind;
	readonly sourceUri: vscode.Uri;
	readonly descriptor?: string;
}

export function metadataCompileTarget(item: unknown): MetadataCompileTarget | undefined {
	if (item instanceof MetadataSourceTreeItem) {
		const sourceDir = sourceDirectoryOf(item);
		if (!sourceDir) {
			return undefined;
		}
		if (item.sourceKind === 'main') {
			return { kind: 'configuration', sourceUri: vscode.Uri.file(sourceDir) };
		}
		if (item.sourceKind === 'extension') {
			return { kind: 'extension', sourceUri: vscode.Uri.file(sourceDir) };
		}
		return undefined;
	}
	if (item instanceof MetadataLeafTreeItem && item.resourceUri) {
		const sourceUri = vscode.Uri.file(path.dirname(item.resourceUri.fsPath));
		if (item.objectType === 'ExternalDataProcessor') {
			return { kind: 'processor', sourceUri, descriptor: item.resourceUri.fsPath };
		}
		if (item.objectType === 'ExternalReport') {
			return { kind: 'report', sourceUri, descriptor: item.resourceUri.fsPath };
		}
	}
	return undefined;
}

/** Файл версии выбранной конфигурации, расширения или внешнего объекта. */
export function metadataVersionTarget(item: unknown): SourceVersionTarget | undefined {
	if (item instanceof MetadataSourceTreeItem) {
		if ((item.sourceKind === 'main' || item.sourceKind === 'extension') && item.configurationXmlAbs) {
			return { op: 'configuration-version-set', configurationXml: item.configurationXmlAbs };
		}
		return undefined;
	}
	const descriptor = metadataCompileTarget(item)?.descriptor;
	return descriptor ? { op: 'bsp-external-version-set', moduleFile: moduleFileOf(descriptor, 'object') } : undefined;
}

/** Для EDT команды получают каталог проекта, содержащий `src`. */
export function sourceDirectoryOf(item: MetadataSourceTreeItem): string | undefined {
	const descriptor = item.configurationXmlAbs;
	if (descriptor && formatOfFile(descriptor) === 'edt') {
		return edtProjectDirOf(descriptor);
	}
	return item.metadataRootAbs;
}

/** Каталог проекта EDT по описанию его конфигурации `src/Configuration/Configuration.mdo`. */
export function edtProjectDirOf(configurationMdo: string): string {
	return path.dirname(path.dirname(path.dirname(configurationMdo)));
}
