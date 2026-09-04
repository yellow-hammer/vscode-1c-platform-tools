import * as assert from 'node:assert';
import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
	MetadataLeafTreeItem,
	MetadataMdGroupTreeItem,
	MetadataObjectNodeTreeItem,
	MetadataSourceNoteTreeItem,
	MetadataSourceTreeItem,
	MetadataTreeDataProvider,
	defaultMetadataLeafOpenCommand,
	isMetadataCommonForm,
	objectModuleFilePath,
	objectModuleKindsForType,
	objectAcceptsChildNodes,
	metadataObjectOwnsFile,
	objectChildFromFilePath,
} from '../../features/metadata/metadataTreeView';
import { resolveMetadataOpen, type ProjectMetadataTreeDto } from '../../features/metadata/metadataTreeService';
import { metadataLeafReadsObjectProperties } from '../../features/properties/metadataPaletteSource';
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
		assert.strictEqual(attr.contextValue, 'metadataChild_attribute mdChildEdit mdChildDuplicate');
		assert.strictEqual(
			ts.contextValue,
			'metadataChild_tabularSection mdChildEdit mdChildDuplicate mdChildAdd'
		);
		assert.strictEqual(
			tsAttr.contextValue,
			'metadataChild_tabularAttribute mdChildEdit mdChildDuplicate'
		);
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
		assert.strictEqual(form.contextValue, 'metadataChild_form metadataObjectForm mdFormModule mdChildDelete');
		assert.deepStrictEqual(form.command?.arguments, [form]);
		assert.strictEqual(template.command, undefined, 'клик открывает только форму');
		assert.strictEqual(template.contextValue, 'metadataChild_template');
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
			'metadataObjectProperties mdRecModule mdMgrModule'
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

	test('токен состава только у типов с реквизитами или табличными частями', () => {
		assert.strictEqual(objectAcceptsChildNodes('Catalog'), true);
		assert.strictEqual(objectAcceptsChildNodes('InformationRegister'), true);
		assert.strictEqual(objectAcceptsChildNodes('Role'), false);
		assert.strictEqual(objectAcceptsChildNodes('CommonForm'), false);
		assert.strictEqual(objectAcceptsChildNodes('CommonPicture'), false);
	});

	test('типы без модулей не получают токенов модулей', () => {
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

	test('клик по объекту вызывает ту же команду, что основной пункт меню', () => {
		const commonForm = leaf('CommonForm', 'Настройки', 'src/cf/CommonForms/Настройки.xml');
		assert.ok(isMetadataCommonForm(commonForm.objectType));
		assert.strictEqual(commonForm.contextValue, 'metadataObjectProperties mdFormModule');
		assert.strictEqual(defaultMetadataLeafOpenCommand(commonForm), '1c-platform-tools.metadata.openForm');
		assert.strictEqual(commonForm.command?.command, '1c-platform-tools.metadata.openForm');
		// Свойства общей формы лежат в её собственном XML: палитра их читает
		assert.strictEqual(metadataLeafReadsObjectProperties(commonForm), true);

		const commonModule = leaf('CommonModule', 'Общий', 'src/cf/CommonModules/Общий.xml');
		assert.strictEqual(defaultMetadataLeafOpenCommand(commonModule), '1c-platform-tools.metadata.openModule');
		assert.strictEqual(commonModule.command?.command, '1c-platform-tools.metadata.openModule');
		assert.strictEqual(metadataLeafReadsObjectProperties(commonModule), true);

		// У объекта без формы и модуля щелчок ничего не открывает: свойства показывает палитра
		const catalog = leaf('Catalog', 'Контрагенты', 'src/cf/Catalogs/Контрагенты.xml');
		assert.strictEqual(defaultMetadataLeafOpenCommand(catalog), '1c-platform-tools.metadata.openProperties');
		assert.strictEqual(catalog.command?.command, '1c-platform-tools.metadata.openProperties');
		assert.strictEqual(metadataLeafReadsObjectProperties(catalog), true);

		const register = leaf('InformationRegister', 'Курсы', 'src/cf/InformationRegisters/Курсы.xml');
		assert.strictEqual(register.command?.command, '1c-platform-tools.metadata.openProperties');
		assert.strictEqual(metadataLeafReadsObjectProperties(register), true);

		const httpService = leaf('HTTPService', 'Обмен', 'src/cf/HTTPServices/Обмен.xml');
		assert.strictEqual(httpService.contextValue, 'metadataObjectProperties mdModule');
		assert.strictEqual(httpService.command?.command, '1c-platform-tools.metadata.openModule');
		assert.strictEqual(metadataLeafReadsObjectProperties(httpService), true);

		const language = leaf('Language', 'Русский', 'src/cf/Languages/Русский.xml');
		assert.strictEqual(language.contextValue, 'metadataObjectProperties');
		assert.strictEqual(defaultMetadataLeafOpenCommand(language), '1c-platform-tools.metadata.openProperties');
		assert.strictEqual(language.command?.command, '1c-platform-tools.metadata.openProperties');
		assert.strictEqual(metadataLeafReadsObjectProperties(language), true);
	});

	test('поле open из дерева не меняет команду клика', () => {
		const commonModule = new MetadataLeafTreeItem(
			'main',
			'catalogs',
			undefined,
			'CommonModule',
			'Общий',
			'src/cf/CommonModules/Общий.xml',
			undefined,
			'C:/ws',
			context.extensionUri,
			'C:/ws/src/cf/Configuration.xml',
			'C:/ws/src/cf',
			{ action: 'module', fsPath: 'C:/ws/src/cf/CommonModules/Общий/Ext/Module.bsl' }
		);
		assert.strictEqual(commonModule.command?.command, '1c-platform-tools.metadata.openModule');
		assert.deepStrictEqual(commonModule.command?.arguments, [commonModule]);

		const catalog = new MetadataLeafTreeItem(
			'main',
			'catalogs',
			undefined,
			'Catalog',
			'Контрагенты',
			'src/cf/Catalogs/Контрагенты.xml',
			undefined,
			'C:/ws',
			context.extensionUri,
			'C:/ws/src/cf/Configuration.xml',
			'C:/ws/src/cf',
			{ action: 'properties' }
		);
		assert.strictEqual(catalog.command?.command, '1c-platform-tools.metadata.openProperties');
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

suite('resolveMetadataOpen', () => {
	test('склеивает пути из дерева md-sparrow с корнем проекта', () => {
		assert.deepStrictEqual(resolveMetadataOpen({ action: 'properties' }, 'C:/ws'), { action: 'properties' });
		assert.deepStrictEqual(
			resolveMetadataOpen(
				{
					action: 'form',
					relativePath: 'src/cf/CommonForms/Настройки/Ext/Form.xml',
					moduleRelativePath: 'src/cf/CommonForms/Настройки/Ext/Form/Module.bsl',
				},
				'C:/ws'
			),
			{
				action: 'form',
				fsPath: path.join('C:/ws', 'src/cf/CommonForms/Настройки/Ext/Form.xml'),
				moduleFsPath: path.join('C:/ws', 'src/cf/CommonForms/Настройки/Ext/Form/Module.bsl'),
			}
		);
		assert.strictEqual(resolveMetadataOpen(undefined, 'C:/ws'), undefined);
		assert.deepStrictEqual(
			resolveMetadataOpen(
				{ action: 'form', relativePath: 'src/cf/CommonForms/Настройки/Ext/Form.xml' },
				'C:/ws'
			),
			{
				action: 'form',
				fsPath: path.join('C:/ws', 'src/cf/CommonForms/Настройки/Ext/Form.xml'),
				moduleFsPath: undefined,
			}
		);
	});
});

suite('metadataTreeView: расширение неподдерживаемого формата', () => {
	/** Ответ md-sparrow на fixtures/unsupported-extension из его репозитория. */
	function fixtureTree(): ProjectMetadataTreeDto {
		const file = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'metadata', 'unsupported-extension-tree.json');
		return JSON.parse(fs.readFileSync(file, 'utf8')) as ProjectMetadataTreeDto;
	}

	function providerWith(dto: ProjectMetadataTreeDto): MetadataTreeDataProvider {
		const provider = new MetadataTreeDataProvider(createMockExtensionContext());
		const mutable = provider as unknown as {
			_workspaceRoot: string;
			rebuildItemCache(workspaceRoot: string, tree: ProjectMetadataTreeDto): void;
		};
		mutable._workspaceRoot = 'C:/ws';
		mutable.rebuildItemCache('C:/ws', dto);
		return provider;
	}

	test('остаётся в дереве, под ним один узел о версии выгрузки, соседи строятся', async () => {
		const provider = providerWith(fixtureTree());

		const roots = (await provider.getChildren()) as MetadataSourceTreeItem[];
		assert.deepStrictEqual(roots.map((root) => root.sourceId), ['main', 'New', 'Old']);

		const old = roots[2];
		assert.strictEqual(old.label, 'СтарыйФормат');
		assert.strictEqual(old.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
		assert.strictEqual(old.contextValue, 'metadataSourceUnsupported');
		const children = await provider.getChildren(old);
		assert.strictEqual(children.length, 1);
		assert.ok(children[0] instanceof MetadataSourceNoteTreeItem);
		assert.ok(String(children[0].label).includes('2.9'), `в тексте версия: ${String(children[0].label)}`);
		assert.strictEqual(provider.getParent(children[0]), old);

		const fresh = await provider.getChildren(roots[1]);
		assert.ok(fresh.length > 0, 'поддерживаемое расширение раскрывается');
		assert.ok(fresh.every((item) => !(item instanceof MetadataSourceNoteTreeItem)));
	});

	test('поддерживаемый источник узла о версии не получает', () => {
		const supported = new MetadataSourceTreeItem('New', 'НовыйФормат', 'extension', undefined, undefined);
		assert.strictEqual(supported.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
		assert.strictEqual(supported.contextValue, 'metadataSourceConfigLike');
	});
});
