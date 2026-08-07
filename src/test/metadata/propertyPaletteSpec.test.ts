import * as assert from 'node:assert';
import type { MetadataEditTabSpec } from '../../features/metadata/metadataObjectEditSpec';
import { applyPaletteEdits, paletteGroupsFromSpec } from '../../features/properties/propertyPaletteSpec';
import { SOURCE_PROPERTIES_TABS } from '../../features/properties/sourcePropertiesSpec';

const tabs: MetadataEditTabSpec[] = [
	{
		id: 'edit_main',
		title: 'Основные',
		groups: [
			{
				title: 'Основные',
				fields: [
					{ path: 'internalName', label: 'Имя', control: 'text' },
					{ path: 'synonymRu', label: 'Синоним', control: 'text' },
					{ path: 'catalog.hierarchical', label: 'Иерархический', control: 'check' },
					{ path: 'catalog.codeLength', label: 'Длина кода', control: 'number' },
					{
						path: 'catalog.choiceMode',
						label: 'Режим выбора',
						control: 'select',
						options: [
							{ value: 'BOTH_WAYS', label: 'Обоими способами' },
							{ value: 'FROM_FORM', label: 'Из формы' },
						],
					},
					{ path: 'catalog.owners', label: 'Владельцы', control: 'refList' },
					{ path: 'catalog.objectModule', label: 'Модуль объекта', control: 'moduleLink' },
				],
			},
		],
	},
	{
		id: 'edit_data',
		title: 'Данные',
		groups: [
			{
				title: 'Основные',
				fields: [{ path: 'catalog.descriptionLength', label: 'Длина наименования', control: 'number' }],
			},
			{
				title: 'Иерархия',
				fields: [
					{
						path: 'catalog.foldersOnTop',
						label: 'Группы сверху',
						control: 'check',
						enabledWhen: [{ path: 'catalog.hierarchical', equals: true }],
					},
				],
			},
		],
	},
];

const dto = {
	internalName: 'Валюты',
	synonymRu: 'Валюты',
	catalog: {
		hierarchical: false,
		codeLength: 9,
		choiceMode: 'BOTH_WAYS',
		descriptionLength: 25,
		foldersOnTop: true,
		owners: ['Catalog.Организации'],
		objectModule: 'ObjectModule.bsl',
	},
};

suite('Палитра свойств по спецификации', () => {
	test('строки собираются из всех вкладок, одноимённые группы сливаются', () => {
		const groups = paletteGroupsFromSpec(tabs, dto);

		assert.deepStrictEqual(
			groups.map((group) => group.title),
			['Основные', 'Иерархия'],
			'вкладок в палитре нет, а группа «Основные» одна на обе вкладки'
		);
		const main = groups[0].rows.map((row) => row.key);
		assert.ok(main.includes('catalog.descriptionLength'), 'поле со второй вкладки попало в ту же группу');
	});

	test('вид редактора берётся из спеки', () => {
		const rows = new Map(paletteGroupsFromSpec(tabs, dto).flatMap((g) => g.rows).map((r) => [r.key, r]));

		assert.strictEqual(rows.get('internalName')?.kind, 'text');
		assert.strictEqual(rows.get('catalog.hierarchical')?.kind, 'boolean');
		assert.strictEqual(rows.get('catalog.codeLength')?.kind, 'number');
		assert.strictEqual(rows.get('catalog.choiceMode')?.kind, 'select');
		assert.deepStrictEqual(rows.get('catalog.choiceMode')?.options?.map((o) => o.label), [
			'Обоими способами',
			'Из формы',
		]);
	});

	test('составные редакторы показываются текстом и не правятся', () => {
		const rows = new Map(paletteGroupsFromSpec(tabs, dto).flatMap((g) => g.rows).map((r) => [r.key, r]));

		assert.strictEqual(rows.get('catalog.owners')?.readonly, true, 'список ссылок правит панель-вкладка');
		assert.strictEqual(rows.get('catalog.owners')?.value, 'Catalog.Организации');
		assert.strictEqual(rows.get('catalog.objectModule')?.readonly, true);
	});

	test('поле с невыполненным условием спеки не правится', () => {
		const rows = new Map(paletteGroupsFromSpec(tabs, dto).flatMap((g) => g.rows).map((r) => [r.key, r]));

		assert.strictEqual(
			rows.get('catalog.foldersOnTop')?.readonly,
			true,
			'группы сверху доступны только у иерархического справочника'
		);
	});

	test('правки ложатся в DTO с типом поля', () => {
		const next = applyPaletteEdits(dto, tabs, {
			synonymRu: 'Валюты мира',
			'catalog.hierarchical': 'true',
			'catalog.codeLength': '11',
			'catalog.choiceMode': 'FROM_FORM',
		}) as typeof dto;

		assert.strictEqual(next.synonymRu, 'Валюты мира');
		assert.strictEqual(next.catalog.hierarchical, true, 'флажок ложится булевым');
		assert.strictEqual(next.catalog.codeLength, 11, 'число ложится числом');
		assert.strictEqual(next.catalog.choiceMode, 'FROM_FORM');
		assert.strictEqual(dto.catalog.codeLength, 9, 'исходный DTO не меняется');
	});

	test('чужие ключи и составные поля в DTO не попадают', () => {
		const next = applyPaletteEdits(dto, tabs, {
			'catalog.owners': 'Catalog.Склады',
			'catalog.objectModule': 'другой.bsl',
			'catalog.несуществующее': 'значение',
		}) as typeof dto & { catalog: { несуществующее?: string } };

		assert.deepStrictEqual(next.catalog.owners, ['Catalog.Организации']);
		assert.strictEqual(next.catalog.objectModule, 'ObjectModule.bsl');
		assert.strictEqual(next.catalog.несуществующее, undefined);
	});
});

suite('Палитра свойств конфигурации', () => {
	test('свойства конфигурации разложены по группам и правятся', () => {
		const groups = paletteGroupsFromSpec(SOURCE_PROPERTIES_TABS, {
			name: 'УправлениеТорговлей',
			synonymRu: 'Управление торговлей',
			vendor: 'ООО',
			compatibilityMode: 'VERSION_8_3_21',
			managedApplicationModule: 'Module.bsl',
		});

		assert.deepStrictEqual(
			groups.map((group) => group.title),
			['Основные', 'Представление', 'Разработка', 'Совместимость', 'Модули']
		);
		const rows = new Map(groups.flatMap((g) => g.rows).map((r) => [r.key, r]));
		assert.strictEqual(rows.get('compatibilityMode')?.kind, 'select');
		assert.strictEqual(rows.get('compatibilityMode')?.readonly, false);
		assert.strictEqual(rows.get('managedApplicationModule')?.readonly, true, 'модуль открывает панель-вкладка');
	});
});
