import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	metadataCompileTarget,
	type MetadataCompileKind,
} from '../../features/metadata/metadataCompileTarget';
import { MetadataLeafTreeItem, MetadataSourceTreeItem } from '../../features/metadata/metadataTreeView';
import { createMockExtensionContext } from '../fixtures/mocks/vscodeMocks';

suite('цель сборки из узла метаданных', () => {
	const context = createMockExtensionContext();
	const workspaceRoot = 'C:/ws';

	function source(
		sourceKind: string,
		metadataRootAbs: string | undefined
	): MetadataSourceTreeItem {
		return new MetadataSourceTreeItem(
			sourceKind,
			sourceKind,
			sourceKind,
			metadataRootAbs ? path.join(metadataRootAbs, 'Configuration.xml') : undefined,
			metadataRootAbs
		);
	}

	function leaf(objectType: string, relativePath: string): MetadataLeafTreeItem {
		return new MetadataLeafTreeItem(
			'epf',
			'externalDataProcessors',
			undefined,
			objectType,
			'Тест',
			relativePath,
			undefined,
			workspaceRoot,
			context.extensionUri,
			undefined,
			undefined
		);
	}

	function assertTarget(
		actual: ReturnType<typeof metadataCompileTarget>,
		kind: MetadataCompileKind,
		sourcePath: string
	): void {
		assert.ok(actual, `нет цели сборки для ${kind}`);
		assert.strictEqual(actual.kind, kind);
		assert.strictEqual(actual.sourceUri.fsPath, vscode.Uri.file(sourcePath).fsPath);
	}

	test('конфигурация и каждое расширение собираются из своего корня выгрузки', () => {
		assertTarget(metadataCompileTarget(source('main', 'C:/ws/src/cf')), 'configuration', 'C:/ws/src/cf');
		assertTarget(
			metadataCompileTarget(source('extension', 'C:/ws/src/cfe/Демо')),
			'extension',
			'C:/ws/src/cfe/Демо'
		);
	});

	test('внешняя обработка и отчёт собираются из своей папки, не из всего src/epf', () => {
		assertTarget(
			metadataCompileTarget(leaf('ExternalDataProcessor', 'src/epf/Тест/Тест.xml')),
			'processor',
			path.join(workspaceRoot, 'src/epf/Тест')
		);
		assertTarget(
			metadataCompileTarget(leaf('ExternalReport', 'src/erf/Отчёт/Отчёт.xml')),
			'report',
			path.join(workspaceRoot, 'src/erf/Отчёт')
		);
	});

	test('корень всех обработок, справочник и узел без пути не собираются', () => {
		assert.strictEqual(metadataCompileTarget(source('externalEpf', 'C:/ws/src/epf')), undefined);
		assert.strictEqual(metadataCompileTarget(source('externalErf', 'C:/ws/src/erf')), undefined);
		assert.strictEqual(metadataCompileTarget(source('main', undefined)), undefined);
		assert.strictEqual(
			metadataCompileTarget(leaf('Catalog', 'src/cf/Catalogs/Контрагенты.xml')),
			undefined
		);
		assert.strictEqual(metadataCompileTarget(undefined), undefined);
	});
});
