import * as assert from 'node:assert';
import * as vscode from 'vscode';
import * as path from 'node:path';
import {
	MetadataLeafTreeItem,
	MetadataMdGroupTreeItem,
	MetadataObjectNodeTreeItem,
	MetadataSourceTreeItem,
	MetadataTreeDataProvider,
	objectModuleFilePath,
	objectModuleKindsForType,
} from '../../features/metadata/metadataTreeView';
import { createMockExtensionContext } from '../fixtures/mocks/vscodeMocks';

suite('metadataTreeView subsystem filter', () => {
	function createProviderWithTree(): {
		provider: MetadataTreeDataProvider;
		root: MetadataSourceTreeItem;
		group: MetadataMdGroupTreeItem;
	} {
		const context = createMockExtensionContext();
		const provider = new MetadataTreeDataProvider(context);
		const root = new MetadataSourceTreeItem(
			'main',
			'Основная конфигурация',
			'main',
			'C:/ws/src/cf/Configuration.xml',
			'C:/ws/src/cf'
		);
		const group = new MetadataMdGroupTreeItem(
			'main',
			'catalogs',
			'Справочники',
			'library',
			true,
			false,
			'C:/ws/src/cf/Configuration.xml',
			'C:/ws/src/cf'
		);
		const subsystemGroup = new MetadataMdGroupTreeItem(
			'main',
			'common',
			'Общие',
			'symbol-namespace',
			true,
			false,
			'C:/ws/src/cf/Configuration.xml',
			'C:/ws/src/cf'
		);
		const catalogAllowed = new MetadataLeafTreeItem(
			'main',
			'catalogs',
			undefined,
			'Catalog',
			'Номенклатура',
			undefined,
			'C:/ws',
			context.extensionUri,
			'C:/ws/src/cf/Configuration.xml',
			'C:/ws/src/cf'
		);
		const catalogHidden = new MetadataLeafTreeItem(
			'main',
			'catalogs',
			undefined,
			'Catalog',
			'Контрагенты',
			undefined,
			'C:/ws',
			context.extensionUri,
			'C:/ws/src/cf/Configuration.xml',
			'C:/ws/src/cf'
		);
		const subsystem = new MetadataLeafTreeItem(
			'main',
			'common',
			undefined,
			'Subsystem',
			'Продажи',
			undefined,
			'C:/ws',
			context.extensionUri,
			'C:/ws/src/cf/Configuration.xml',
			'C:/ws/src/cf'
		);

		const mutable = provider as unknown as {
			_workspaceRoot: string;
			_sourceItems: MetadataSourceTreeItem[];
			_groupsBySource: Map<string, MetadataMdGroupTreeItem[]>;
			_leavesByGroup: Map<string, MetadataLeafTreeItem[]>;
		};
		mutable._workspaceRoot = 'C:/ws';
		mutable._sourceItems = [root];
		mutable._groupsBySource.set('main', [group, subsystemGroup]);
		mutable._leavesByGroup.set('main|catalogs', [catalogAllowed, catalogHidden]);
		mutable._leavesByGroup.set('main|common', [subsystem]);

		return { provider, root, group };
	}

	test('без фильтра показывает все элементы группы', async () => {
		const { provider, root, group } = createProviderWithTree();
		const rootChildren = await provider.getChildren(root);
		assert.strictEqual(rootChildren.length, 2);
		const leaves = await provider.getChildren(group);
		assert.strictEqual(leaves.length, 2);
	});

	test('фильтр подсистемы оставляет только разрешённые имена и саму подсистему', async () => {
		const { provider, root, group } = createProviderWithTree();
		provider.setSubsystemFilter('Продажи', new Set(['Номенклатура']));

		const rootChildren = await provider.getChildren(root);
		assert.strictEqual(rootChildren.length, 2, 'группа подсистем должна оставаться видимой');
		const catalogLeaves = await provider.getChildren(group);
		assert.strictEqual(catalogLeaves.length, 1);
		assert.strictEqual((catalogLeaves[0] as MetadataLeafTreeItem).name, 'Номенклатура');
	});

	test('сброс фильтра возвращает полный список', async () => {
		const { provider, group } = createProviderWithTree();
		provider.setSubsystemFilter('Продажи', new Set(['Номенклатура']));
		provider.clearSubsystemFilter();
		const leaves = await provider.getChildren(group);
		assert.strictEqual(leaves.length, 2);
	});
});

suite('metadataTreeView поиск по имени', () => {
	function createProvider(): {
		provider: MetadataTreeDataProvider;
		root: MetadataSourceTreeItem;
		group: MetadataMdGroupTreeItem;
	} {
		const context = createMockExtensionContext();
		const provider = new MetadataTreeDataProvider(context);
		const root = new MetadataSourceTreeItem(
			'main',
			'Основная конфигурация',
			'main',
			'C:/ws/src/cf/Configuration.xml',
			'C:/ws/src/cf'
		);
		const group = new MetadataMdGroupTreeItem(
			'main',
			'commonModules',
			'Общие модули',
			'symbol-namespace',
			true,
			false,
			'C:/ws/src/cf/Configuration.xml',
			'C:/ws/src/cf'
		);
		const leaf = (name: string): MetadataLeafTreeItem =>
			new MetadataLeafTreeItem(
				'main',
				'commonModules',
				undefined,
				'CommonModule',
				name,
				undefined,
				'C:/ws',
				context.extensionUri,
				'C:/ws/src/cf/Configuration.xml',
				'C:/ws/src/cf'
			);
		const mutable = provider as unknown as {
			_workspaceRoot: string;
			_sourceItems: MetadataSourceTreeItem[];
			_groupsBySource: Map<string, MetadataMdGroupTreeItem[]>;
			_leavesByGroup: Map<string, MetadataLeafTreeItem[]>;
		};
		mutable._workspaceRoot = 'C:/ws';
		mutable._sourceItems = [root];
		mutable._groupsBySource.set('main', [group]);
		mutable._leavesByGroup.set('main|commonModules', [
			leaf('_ДемоЗаметки'),
			leaf('_ДемоЗаказыПокупателей'),
			leaf('ОбщегоНазначения'),
		]);
		return { provider, root, group };
	}

	test('ищет вхождением подстроки без учёта регистра', async () => {
		const { provider, group } = createProvider();
		provider.setTextFilter('демозамет');
		const leaves = await provider.getChildren(group);
		assert.deepStrictEqual(
			leaves.map((item) => (item as MetadataLeafTreeItem).name),
			['_ДемоЗаметки']
		);
	});

	test('группа без совпадений скрывается, с совпадениями — раскрывается', async () => {
		const { provider, root, group } = createProvider();
		provider.setTextFilter('заметки');
		const groups = await provider.getChildren(root);
		assert.strictEqual(groups.length, 1);
		assert.strictEqual(group.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);

		provider.setTextFilter('такогонет');
		const hiddenGroups = await provider.getChildren(root);
		assert.strictEqual(hiddenGroups.length, 0, 'группа без совпадений скрыта');
		const rootLevel = await provider.getChildren();
		assert.strictEqual(rootLevel.length, 1);
		assert.ok(String(rootLevel[0].label).startsWith('Ничего не найдено'), 'видно, что ничего не нашлось');
	});

	test('пустая строка снимает фильтр', async () => {
		const { provider, group } = createProvider();
		provider.setTextFilter('заметки');
		provider.setTextFilter('   ');
		assert.strictEqual(provider.getTextFilter(), undefined);
		const leaves = await provider.getChildren(group);
		assert.strictEqual(leaves.length, 3);
	});
});

suite('metadataTreeView nested nodes', () => {
	test('лист объекта метаданных раскрываемый для структуры', () => {
		const context = createMockExtensionContext();
		const leaf = new MetadataLeafTreeItem(
			'main',
			'catalogs',
			undefined,
			'Catalog',
			'Номенклатура',
			'src/cf/Catalogs/Номенклатура.xml',
			'C:/ws',
			context.extensionUri,
			'C:/ws/src/cf/Configuration.xml',
			'C:/ws/src/cf'
		);
		assert.strictEqual(leaf.collapsibleState, 1);
	});

	test('контекстные значения вложенных узлов для CRUD', () => {
		const context = createMockExtensionContext();
		const owner = new MetadataLeafTreeItem(
			'main',
			'catalogs',
			undefined,
			'Catalog',
			'Номенклатура',
			'src/cf/Catalogs/Номенклатура.xml',
			'C:/ws',
			context.extensionUri,
			'C:/ws/src/cf/Configuration.xml',
			'C:/ws/src/cf'
		);
		const attr = new MetadataObjectNodeTreeItem(
			'k1',
			'attribute',
			'Код',
			'Код',
			false,
			context.extensionUri,
			owner
		);
		const ts = new MetadataObjectNodeTreeItem(
			'k2',
			'tabularSection',
			'Товары',
			'Товары',
			true,
			context.extensionUri,
			owner,
			'Товары'
		);
		const tsAttr = new MetadataObjectNodeTreeItem(
			'k3',
			'tabularAttribute',
			'Количество',
			'Количество',
			false,
			context.extensionUri,
			owner,
			'Товары'
		);
		assert.strictEqual(attr.contextValue, 'metadataAttribute');
		assert.strictEqual(ts.contextValue, 'metadataTabularSection');
		assert.strictEqual(tsAttr.contextValue, 'metadataTabularAttribute');
	});
});

suite('metadataTreeView object modules', () => {
	const context = createMockExtensionContext();

	function leaf(objectType: string, name: string, relativePath: string): MetadataLeafTreeItem {
		return new MetadataLeafTreeItem(
			'main',
			'catalogs',
			undefined,
			objectType,
			name,
			relativePath,
			'C:/ws',
			context.extensionUri,
			'C:/ws/src/cf/Configuration.xml',
			'C:/ws/src/cf'
		);
	}

	test('contextValue получает токены модулей по типу', () => {
		assert.strictEqual(
			leaf('Catalog', 'Контрагенты', 'src/cf/Catalogs/Контрагенты.xml').contextValue,
			'metadataObjectProperties mdObjModule mdMgrModule'
		);
		assert.strictEqual(
			leaf('InformationRegister', 'Курсы', 'src/cf/InformationRegisters/Курсы.xml').contextValue,
			'metadataLeaf mdRecModule mdMgrModule'
		);
		// Константа: модуль менеджера значения + модуль менеджера (как в конфигураторе).
		assert.strictEqual(
			leaf('Constant', 'Версия', 'src/cf/Constants/Версия.xml').contextValue,
			'metadataObjectProperties mdValModule mdMgrModule'
		);
		assert.strictEqual(
			leaf('CommonModule', 'Общий', 'src/cf/CommonModules/Общий.xml').contextValue,
			'metadataObjectProperties mdModule'
		);
	});

	test('типы без модулей не получают токенов', () => {
		assert.strictEqual(
			leaf('Role', 'Администратор', 'src/cf/Roles/Администратор.xml').contextValue,
			'metadataObjectProperties'
		);
		assert.strictEqual(objectModuleKindsForType('Role').length, 0);
	});

	test('objectModuleFilePath строит путь рядом с объектом', () => {
		assert.strictEqual(
			objectModuleFilePath('C:/ws/src/cf/Catalogs/Контрагенты.xml', 'Контрагенты', 'object'),
			path.join('C:/ws/src/cf/Catalogs', 'Контрагенты', 'Ext', 'ObjectModule.bsl')
		);
		assert.strictEqual(
			objectModuleFilePath('C:/ws/src/cf/CommonForms/Форма.xml', 'Форма', 'form'),
			path.join('C:/ws/src/cf/CommonForms', 'Форма', 'Ext', 'Form', 'Module.bsl')
		);
	});
});
