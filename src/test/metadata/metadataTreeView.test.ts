import * as assert from 'node:assert';
import {
	MetadataLeafTreeItem,
	MetadataMdGroupTreeItem,
	MetadataObjectNodeTreeItem,
	MetadataSourceTreeItem,
	MetadataTreeDataProvider,
} from '../../metadataTreeView';
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

suite('metadataTreeView nested nodes', () => {
	test('лист объекта метаданных раскрываемый для структуры', () => {
		const leaf = new MetadataLeafTreeItem(
			'main',
			'catalogs',
			undefined,
			'Catalog',
			'Номенклатура',
			'src/cf/Catalogs/Номенклатура.xml',
			'C:/ws',
			'C:/ws/src/cf/Configuration.xml',
			'C:/ws/src/cf'
		);
		assert.strictEqual(leaf.collapsibleState, 1);
	});

	test('контекстные значения вложенных узлов для CRUD', () => {
		const owner = new MetadataLeafTreeItem(
			'main',
			'catalogs',
			undefined,
			'Catalog',
			'Номенклатура',
			'src/cf/Catalogs/Номенклатура.xml',
			'C:/ws',
			'C:/ws/src/cf/Configuration.xml',
			'C:/ws/src/cf'
		);
		const attr = new MetadataObjectNodeTreeItem('k1', 'attribute', 'Код', 'Код', false, owner);
		const ts = new MetadataObjectNodeTreeItem('k2', 'tabularSection', 'Товары', 'Товары', true, owner, 'Товары');
		const tsAttr = new MetadataObjectNodeTreeItem('k3', 'tabularAttribute', 'Количество', 'Количество', false, owner, 'Товары');
		assert.strictEqual(attr.contextValue, 'metadataAttribute');
		assert.strictEqual(ts.contextValue, 'metadataTabularSection');
		assert.strictEqual(tsAttr.contextValue, 'metadataTabularAttribute');
	});
});
