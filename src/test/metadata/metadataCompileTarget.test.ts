import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	metadataCompileTarget,
	metadataVersionTarget,
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

	/** Корень проекта EDT: дерево называет каталогом метаданных его src. */
	function edtSource(sourceKind: string, projectDir: string): MetadataSourceTreeItem {
		return new MetadataSourceTreeItem(
			sourceKind,
			sourceKind,
			sourceKind,
			path.join(projectDir, 'src', 'Configuration', 'Configuration.mdo'),
			path.join(projectDir, 'src')
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

	test('у проекта EDT собирается каталог проекта, а не его src', () => {
		assertTarget(metadataCompileTarget(edtSource('main', 'C:/ws/ssl31')), 'configuration', 'C:/ws/ssl31');
		assertTarget(
			metadataCompileTarget(edtSource('extension', 'C:/ws/ssl31._ДемоРасширение')),
			'extension',
			'C:/ws/ssl31._ДемоРасширение'
		);
		assertTarget(metadataCompileTarget(edtSource('extension', 'C:/ws/tests/cfe/yaxunit-test')), 'extension', 'C:/ws/tests/cfe/yaxunit-test');
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
	test('версия записывается в файл выбранной конфигурации или расширения', () => {
		const configuration = source('main', 'C:/ws/src/cf');
		const extension = edtSource('extension', 'C:/ws/ssl31.Демо');
		assert.match(configuration.contextValue ?? '', /\bmetadataMainRoot\b/);
		assert.doesNotMatch(extension.contextValue ?? '', /\bmetadataMainRoot\b/);
		for (const item of [configuration, extension]) {
			assert.deepStrictEqual(metadataVersionTarget(item), {
				op: 'configuration-version-set',
				configurationXml: item.configurationXmlAbs,
			});
		}
	});

	test('версия внешнего объекта записывается в его модуль в обеих раскладках', () => {
		const processor = leaf('ExternalDataProcessor', 'src/epf/Тест/Тест.xml');
		const report = leaf('ExternalReport', 'project/src/ExternalReports/Отчёт/Отчёт.mdo');
		assert.deepStrictEqual(metadataVersionTarget(processor), {
			op: 'bsp-external-version-set',
			moduleFile: path.join(path.dirname(processor.resourceUri!.fsPath), 'Тест', 'Ext', 'ObjectModule.bsl'),
		});
		assert.deepStrictEqual(metadataVersionTarget(report), {
			op: 'bsp-external-version-set',
			moduleFile: path.join(path.dirname(report.resourceUri!.fsPath), 'ObjectModule.bsl'),
		});
		assert.strictEqual(metadataVersionTarget(leaf('Catalog', 'src/cf/Catalogs/Тест.xml')), undefined);
		assert.strictEqual(metadataVersionTarget(source('externalEpf', 'C:/ws/src/epf')), undefined);
	});

});
