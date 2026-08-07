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
	metadataObjectOwnsFile,
	objectChildFromFilePath,
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

	test('запрос из нескольких слов ищет объекты со всеми словами', async () => {
		const { provider, group } = createProvider();
		provider.setTextFilter('демо замет');
		const leaves = await provider.getChildren(group);
		assert.deepStrictEqual(
			leaves.map((item) => (item as MetadataLeafTreeItem).name),
			['_ДемоЗаметки'],
			'«демо замет» находит «_ДемоЗаметки», но не «_ДемоЗаказыПокупателей»'
		);

		provider.setTextFilter('демо');
		const demoLeaves = await provider.getChildren(group);
		assert.strictEqual(demoLeaves.length, 2);
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
			undefined,
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
			undefined,
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

	test('форма открывается кликом по узлу', () => {
		const context = createMockExtensionContext();
		const owner = new MetadataLeafTreeItem(
			'main',
			'catalogs',
			undefined,
			'Catalog',
			'Валюты',
			'src/cf/Catalogs/Валюты.xml',
			undefined,
			'C:/ws',
			context.extensionUri,
			'C:/ws/src/cf/Configuration.xml',
			'C:/ws/src/cf'
		);
		const form = new MetadataObjectNodeTreeItem(
			'k4',
			'form',
			'ФормаСписка',
			'ФормаСписка',
			false,
			context.extensionUri,
			owner
		);
		const template = new MetadataObjectNodeTreeItem(
			'k5',
			'template',
			'Печать',
			'Печать',
			false,
			context.extensionUri,
			owner
		);

		assert.strictEqual(form.command?.command, '1c-platform-tools.metadata.openForm');
		assert.deepStrictEqual(form.command?.arguments, [form]);
		assert.strictEqual(template.command, undefined, 'клик открывает только форму');
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
			undefined,
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

suite('Объект метаданных по открытому файлу', () => {
	const objectXml = path.join('C:', 'проект', 'src', 'cf', 'Catalogs', 'Валюты.xml');

	test('сам XML объекта', () => {
		assert.strictEqual(metadataObjectOwnsFile(objectXml, objectXml), true);
	});

	test('модуль, форма и макет из каталога объекта', () => {
		const dir = path.join('C:', 'проект', 'src', 'cf', 'Catalogs', 'Валюты');
		assert.strictEqual(metadataObjectOwnsFile(objectXml, path.join(dir, 'Ext', 'ObjectModule.bsl')), true);
		assert.strictEqual(
			metadataObjectOwnsFile(objectXml, path.join(dir, 'Forms', 'ФормаСписка', 'Ext', 'Form.xml')),
			true
		);
		assert.strictEqual(metadataObjectOwnsFile(objectXml, path.join(dir, 'Templates', 'Печать.xml')), true);
	});

	test('чужой объект с тем же началом имени не считается своим', () => {
		const other = path.join('C:', 'проект', 'src', 'cf', 'Catalogs', 'ВалютыДопы', 'Ext', 'ObjectModule.bsl');
		assert.strictEqual(metadataObjectOwnsFile(objectXml, other), false);
		assert.strictEqual(
			metadataObjectOwnsFile(objectXml, path.join('C:', 'проект', 'src', 'cf', 'Catalogs', 'Склады.xml')),
			false
		);
	});
});

suite('Узел объекта по пути файла', () => {
	const objectXml = path.join('C:', 'проект', 'src', 'cf', 'Catalogs', 'Валюты.xml');
	const dir = path.join('C:', 'проект', 'src', 'cf', 'Catalogs', 'Валюты');

	test('форма: описание, содержимое и модуль ведут к одному узлу', () => {
		assert.deepStrictEqual(objectChildFromFilePath(objectXml, path.join(dir, 'Forms', 'ФормаСписка.xml')), {
			sectionKind: 'forms',
			name: 'ФормаСписка',
		});
		assert.deepStrictEqual(
			objectChildFromFilePath(objectXml, path.join(dir, 'Forms', 'ФормаСписка', 'Ext', 'Form.xml')),
			{ sectionKind: 'forms', name: 'ФормаСписка' }
		);
		assert.deepStrictEqual(
			objectChildFromFilePath(objectXml, path.join(dir, 'Forms', 'ФормаЭлемента', 'Ext', 'Form', 'Module.bsl')),
			{ sectionKind: 'forms', name: 'ФормаЭлемента' }
		);
	});

	test('макет и команда разбираются так же', () => {
		assert.deepStrictEqual(objectChildFromFilePath(objectXml, path.join(dir, 'Templates', 'Печать.xml')), {
			sectionKind: 'templates',
			name: 'Печать',
		});
		assert.deepStrictEqual(
			objectChildFromFilePath(objectXml, path.join(dir, 'Templates', 'Печать', 'Ext', 'Template.xml')),
			{ sectionKind: 'templates', name: 'Печать' }
		);
		assert.deepStrictEqual(
			objectChildFromFilePath(objectXml, path.join(dir, 'Commands', 'Ответить', 'Ext', 'CommandModule.bsl')),
			{ sectionKind: 'commands', name: 'Ответить' }
		);
	});

	test('модули самого объекта узлом состава не считаются', () => {
		assert.strictEqual(objectChildFromFilePath(objectXml, objectXml), undefined);
		assert.strictEqual(objectChildFromFilePath(objectXml, path.join(dir, 'Ext', 'ObjectModule.bsl')), undefined);
		assert.strictEqual(objectChildFromFilePath(objectXml, path.join(dir, 'Ext', 'ManagerModule.bsl')), undefined);
		assert.strictEqual(objectChildFromFilePath(objectXml, path.join(dir, 'Ext', 'Help.xml')), undefined);
	});

	test('общая форма и общий модуль - сами объекты', () => {
		const commonForm = path.join('C:', 'проект', 'src', 'cf', 'CommonForms', 'МояФорма.xml');
		const content = path.join('C:', 'проект', 'src', 'cf', 'CommonForms', 'МояФорма', 'Ext', 'Form.xml');
		assert.strictEqual(objectChildFromFilePath(commonForm, content), undefined);

		const commonModule = path.join('C:', 'проект', 'src', 'cf', 'CommonModules', 'Общий.xml');
		const moduleFile = path.join('C:', 'проект', 'src', 'cf', 'CommonModules', 'Общий', 'Ext', 'Module.bsl');
		assert.strictEqual(objectChildFromFilePath(commonModule, moduleFile), undefined);
	});
});

suite('Скрытые отбором узлы', () => {
	function providerWithLeaf(): { provider: MetadataTreeDataProvider; leaf: MetadataLeafTreeItem } {
		const context = createMockExtensionContext();
		const provider = new MetadataTreeDataProvider(context);
		const leaf = new MetadataLeafTreeItem(
			'cf', 'catalogs', undefined, 'Catalog', 'Валюты', 'src/cf/Catalogs/Валюты.xml',
			undefined, 'C:/ws', context.extensionUri, undefined, 'C:/ws/src/cf'
		);
		return { provider, leaf };
	}

	test('без отбора ничего не скрыто', () => {
		const { provider, leaf } = providerWithLeaf();

		assert.strictEqual(provider.isHiddenByFilter(leaf), false);
	});

	test('поиск не по этому объекту прячет его', () => {
		const { provider, leaf } = providerWithLeaf();
		provider.setTextFilter('Склады');

		assert.strictEqual(provider.isHiddenByFilter(leaf), true);
	});

	test('поиск по имени объекта его не прячет', () => {
		const { provider, leaf } = providerWithLeaf();
		provider.setTextFilter('Валюты');

		assert.strictEqual(provider.isHiddenByFilter(leaf), false);
	});
});
