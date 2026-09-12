/**
 * Цель единичной сборки из узла дерева метаданных.
 * @module metadataCompileTarget
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { formatOfFile } from '../../shared/objectPaths';
import { MetadataLeafTreeItem, MetadataSourceTreeItem } from './metadataTreeView';

/** Что собираем из выбранного узла. */
export type MetadataCompileKind = 'configuration' | 'extension' | 'processor' | 'report';

/** Каталог исходников выбранного узла. */
export interface MetadataCompileTarget {
	readonly kind: MetadataCompileKind;
	readonly sourceUri: vscode.Uri;
}

/**
 * Узел, из которого можно собрать файл: конфигурация, одно расширение, одна обработка или один отчёт.
 * Корни «Внешние обработки» / «Внешние отчёты» не цель — там нет одного файла.
 */
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
			return { kind: 'processor', sourceUri };
		}
		if (item.objectType === 'ExternalReport') {
			return { kind: 'report', sourceUri };
		}
	}
	return undefined;
}

/**
 * Каталог исходников корня для инструментов.
 *
 * Дерево называет корнем каталог метаданных, а у проекта EDT это его `src`:
 * раннеру и самой EDT нужен каталог проекта, в котором лежит описание.
 */
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
