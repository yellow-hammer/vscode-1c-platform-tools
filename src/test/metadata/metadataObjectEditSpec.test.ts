import * as assert from 'node:assert';
import { applyEditedScalars, buildCatalogEditTabs } from '../../features/metadata/metadataObjectEditSpec';
import { buildMetadataObjectPropertiesTabsForTest } from '../../features/metadata/metadataObjectPropertiesPanel';

function catalogProps(): Record<string, unknown> {
	return {
		kind: 'catalog',
		internalName: 'Номенклатура',
		synonymRu: 'Номенклатура',
		comment: '',
		attributes: [{ name: 'Артикул', synonymRu: 'Артикул', comment: '' }],
		tabularSections: [],
		catalog: {
			hierarchical: false,
			hierarchyType: 'HIERARCHY_FOLDERS_AND_ITEMS',
			levelCount: '2',
			autonumbering: true,
			checkUnique: true,
			codeSeries: 'WHOLE_CATALOG',
			choiceMode: 'BOTH_WAYS',
			codeLength: '9',
			owners: ['Catalog.Организации'],
			useStandardCommands: true,
			defaultObjectForm: null,
		},
	};
}

suite('metadataObjectEditSpec', () => {
	test('catalog edit tabs cover EDT layout', () => {
		const tabs = buildCatalogEditTabs({ internalName: 'Номенклатура', formNames: ['ФормаСписка'], commandNames: [] });
		assert.deepStrictEqual(
			tabs.map((tab) => tab.title),
			['Основные', 'Данные', 'Владельцы', 'Формы', 'Команды', 'Ввод на основании']
		);
		const forms = tabs.find((tab) => tab.id === 'edit_forms');
		const objectForm = forms?.groups[0].fields.find((field) => field.path === 'catalog.defaultObjectForm');
		assert.ok(
			objectForm?.options?.some((option) => option.value === 'Catalog.Номенклатура.Form.ФормаСписка'),
			'основная форма должна предлагать полную ссылку на форму'
		);
	});

	test('basedOn and dataLockFields candidates depend on object state', () => {
		const tabs = buildCatalogEditTabs({
			internalName: 'Номенклатура',
			formNames: [],
			commandNames: [],
			catalogNames: ['Организации'],
			documentNames: ['ЗаказПокупателя'],
			attributeNames: ['Артикул'],
			hasOwners: true,
			hierarchical: false,
		});
		const basedOn = tabs
			.find((tab) => tab.id === 'edit_basedon')
			?.groups[0].fields.find((field) => field.path === 'catalog.basedOn');
		assert.ok(basedOn?.options?.some((option) => option.value === 'Document.ЗаказПокупателя'));
		assert.ok(basedOn?.options?.some((option) => option.value === 'Catalog.Организации'));

		const lock = tabs
			.flatMap((tab) => tab.groups)
			.flatMap((group) => group.fields)
			.find((field) => field.path === 'catalog.dataLockFields');
		assert.strictEqual(lock?.control, 'refList');
		assert.ok(lock?.options?.some((option) => option.value === 'Catalog.Номенклатура.StandardAttribute.Owner'));
		assert.ok(
			!lock?.options?.some((option) => option.value === 'Catalog.Номенклатура.StandardAttribute.Parent'),
			'Родитель не предлагается для неиерархического'
		);
		assert.ok(lock?.options?.some((option) => option.value === 'Catalog.Номенклатура.Attribute.Артикул'));
	});

	test('applyEditedScalars keeps structure and applies only whitelisted scalars', () => {
		const raw = catalogProps();
		const tabs = buildCatalogEditTabs({ internalName: 'Номенклатура', formNames: [], commandNames: [] });
		const edited = catalogProps();
		(edited.catalog as Record<string, unknown>).choiceMode = 'QUICK_CHOICE';
		(edited.catalog as Record<string, unknown>).codeLength = '11';
		edited.synonymRu = 'Товары';
		// Попытки webview изменить нередактируемое должны игнорироваться.
		edited.internalName = 'Взлом';
		edited.attributes = [];

		const dto = applyEditedScalars(raw, edited, tabs);
		const cat = dto.catalog as Record<string, unknown>;
		assert.strictEqual(dto.synonymRu, 'Товары');
		assert.strictEqual(cat.choiceMode, 'QUICK_CHOICE');
		assert.strictEqual(cat.codeLength, '11');
		assert.strictEqual(dto.internalName, 'Номенклатура', 'имя не редактируется из панели');
		assert.strictEqual((dto.attributes as unknown[]).length, 1, 'реквизиты не должны затираться');
	});

	test('refList: владельцы редактируются в пределах кандидатов', () => {
		const raw = catalogProps();
		const tabs = buildCatalogEditTabs({
			internalName: 'Номенклатура',
			formNames: [],
			commandNames: [],
			catalogNames: ['Организации', 'Контрагенты', 'Номенклатура'],
			attributeNames: ['Артикул'],
		});
		const ownersField = tabs
			.find((tab) => tab.id === 'edit_owners')
			?.groups[0].fields.find((field) => field.path === 'catalog.owners');
		assert.ok(ownersField?.options?.some((option) => option.value === 'Catalog.Контрагенты'));
		assert.ok(
			!ownersField?.options?.some((option) => option.value === 'Catalog.Номенклатура'),
			'сам справочник не предлагается во владельцы'
		);

		const edited = catalogProps();
		(edited.catalog as Record<string, unknown>).owners = [
			'Catalog.Организации',
			'Catalog.Контрагенты',
			'Catalog.Чужой',
			'Catalog.Контрагенты',
		];
		(edited.catalog as Record<string, unknown>).inputByString = [
			'Catalog.Номенклатура.StandardAttribute.Code',
			'Catalog.Номенклатура.Attribute.Артикул',
		];
		const dto = applyEditedScalars(raw, edited, tabs);
		const cat = dto.catalog as Record<string, unknown>;
		assert.deepStrictEqual(
			cat.owners,
			['Catalog.Организации', 'Catalog.Контрагенты'],
			'неизвестные кандидаты и дубли отбрасываются'
		);
		assert.deepStrictEqual(cat.inputByString, [
			'Catalog.Номенклатура.StandardAttribute.Code',
			'Catalog.Номенклатура.Attribute.Артикул',
		]);

		const cleared = catalogProps();
		(cleared.catalog as Record<string, unknown>).owners = [];
		const dtoCleared = applyEditedScalars(raw, cleared, tabs);
		assert.deepStrictEqual((dtoCleared.catalog as Record<string, unknown>).owners, [], 'очистка владельцев допустима');
	});

	test('clearable: очистка основной формы пишется пустым значением', () => {
		const raw = catalogProps();
		(raw.catalog as Record<string, unknown>).defaultObjectForm = 'Catalog.Номенклатура.Form.ФормаЭлемента';
		const tabs = buildCatalogEditTabs({ internalName: 'Номенклатура', formNames: ['ФормаЭлемента'], commandNames: [] });
		const edited = catalogProps();
		(edited.catalog as Record<string, unknown>).defaultObjectForm = '';
		const dto = applyEditedScalars(raw, edited, tabs);
		assert.strictEqual((dto.catalog as Record<string, unknown>).defaultObjectForm, '', 'установленная форма очищается');

		const rawEmpty = catalogProps();
		const dtoEmpty = applyEditedScalars(rawEmpty, edited, tabs);
		assert.strictEqual(
			(dtoEmpty.catalog as Record<string, unknown>).defaultObjectForm,
			null,
			'незаданная форма остаётся незаданной'
		);
	});

	test('applyEditedScalars normalizes values', () => {
		const raw = catalogProps();
		const tabs = buildCatalogEditTabs({ internalName: 'Номенклатура', formNames: [], commandNames: [] });
		const edited = catalogProps();
		(edited.catalog as Record<string, unknown>).defaultObjectForm = '';
		(edited.catalog as Record<string, unknown>).codeLength = 'abc';
		(edited.catalog as Record<string, unknown>).choiceMode = 'НЕИЗВЕСТНО';

		const dto = applyEditedScalars(raw, edited, tabs);
		const cat = dto.catalog as Record<string, unknown>;
		assert.strictEqual(cat.defaultObjectForm, null, 'пустой выбор формы становится null');
		assert.strictEqual(cat.codeLength, '9', 'нечисловая длина кода игнорируется');
		assert.strictEqual(cat.choiceMode, 'BOTH_WAYS', 'неизвестное значение enum игнорируется');
	});

	test('catalog panel starts with editable tabs and drops replaced ones', () => {
		const structure = {
			kind: 'catalog',
			internalName: 'Номенклатура',
			forms: ['ФормаСписка'],
			commands: ['Команда1'],
		};
		const tabs = buildMetadataObjectPropertiesTabsForTest('Catalog', catalogProps(), structure);
		assert.strictEqual(tabs[0]?.id, 'edit_main');
		assert.strictEqual(tabs[0]?.render, 'edit');
		assert.ok(!tabs.some((tab) => tab.id === 'overview'), 'обзор замещается вкладкой «Основные»');
		assert.ok(!tabs.some((tab) => tab.id === 'section_forms'), 'список форм уходит на вкладку «Формы»');
		assert.ok(tabs.some((tab) => tab.id === 'edit_forms'));
		assert.ok(!tabs.some((tab) => tab.id === 'attributes'), 'реквизиты уходят на вкладку «Данные»');
		assert.ok(!tabs.some((tab) => tab.id === 'tabularSections'), 'табличные части уходят на вкладку «Данные»');
	});
});

suite('metadataObjectPropertiesPanel structure edits', () => {
	// Ленивая загрузка, чтобы не тянуть vscode-заглушки в чужие suite.
	const panel = require('../../features/metadata/metadataObjectPropertiesPanel');

	test('structOpsFromEdits: переименования, удаления, добавления в правильном порядке', () => {
		const edits = panel.parseStructureEdits({
			attributes: [
				{ originalName: 'Старый', name: 'Новый', synonymRu: '', deleted: false },
				{ originalName: 'Лишний', name: 'Лишний', synonymRu: '', deleted: true },
				{ name: 'Добавленный', synonymRu: 'Синоним', deleted: false },
			],
			tabularSections: [
				{
					originalName: 'Товары',
					name: 'Позиции',
					synonymRu: '',
					deleted: false,
					attributes: [
						{ originalName: 'Кол', name: 'Количество', synonymRu: '', deleted: false },
						{ name: 'Цена', synonymRu: '', deleted: false },
					],
				},
			],
		});
		assert.ok(edits);
		assert.strictEqual(panel.validateStructureEdits(edits), null);
		const allOps = panel.structOpsFromEdits(edits, 'obj.xml', 'V2_20');
		const ops = allOps.map((op: { op: string }) => op.op);
		assert.deepStrictEqual(ops, [
			'cf-md-tabular-section-rename',
			'cf-md-attribute-rename',
			'cf-md-tabular-attribute-rename',
			'cf-md-attribute-delete',
			'cf-md-attribute-add',
			'cf-md-tabular-attribute-add',
			'cf-md-attribute-reorder',
			'cf-md-tabular-attribute-reorder',
		]);
		const attrReorder = allOps.find((op: { op: string }) => op.op === 'cf-md-attribute-reorder');
		assert.deepStrictEqual(JSON.parse(attrReorder.payloadJson), ['Новый', 'Добавленный'], 'порядок по финальным именам');
		const renameTs = panel.structOpsFromEdits(edits, 'obj.xml', 'V2_20')[2];
		assert.strictEqual(renameTs.tabularSection, 'Позиции', 'вложенные операции идут по новому имени ТЧ');
	});

	test('validateStructureEdits ловит дубли и мусорные имена', () => {
		const bad = panel.parseStructureEdits({
			attributes: [
				{ name: '1Плохое', synonymRu: '', deleted: false },
			],
			tabularSections: [],
		});
		assert.ok(panel.validateStructureEdits(bad));
		const dup = panel.parseStructureEdits({
			attributes: [
				{ originalName: 'А', name: 'Имя', synonymRu: '', deleted: false },
				{ originalName: 'Б', name: 'имя', synonymRu: '', deleted: false },
			],
			tabularSections: [],
		});
		assert.ok(panel.validateStructureEdits(dup));
	});

	test('applySynonymEdits переносит синонимы по финальным именам', () => {
		const dto: Record<string, unknown> = {
			attributes: [
				{ name: 'Новый', synonymRu: 'старый синоним', comment: 'к' },
				{ name: 'Другой', synonymRu: 'х', comment: '' },
			],
			tabularSections: [{ name: 'Позиции', synonymRu: '', comment: '' }],
		};
		const edits = panel.parseStructureEdits({
			attributes: [{ originalName: 'Старый', name: 'Новый', synonymRu: 'Свежий', deleted: false }],
			tabularSections: [{ originalName: 'Товары', name: 'Позиции', synonymRu: 'Позиции заказа', deleted: false, attributes: [] }],
		});
		panel.applySynonymEdits(dto, edits);
		const attrs = dto.attributes as Array<Record<string, unknown>>;
		assert.strictEqual(attrs[0].synonymRu, 'Свежий');
		assert.strictEqual(attrs[0].comment, 'к', 'комментарий сохраняется');
		assert.strictEqual(attrs[1].synonymRu, 'х', 'нетронутые не меняются');
		assert.strictEqual((dto.tabularSections as Array<Record<string, unknown>>)[0].synonymRu, 'Позиции заказа');
	});
});

suite('metadataObjectEditSpec: документ', () => {
	const { buildDocumentEditTabs } = require('../../features/metadata/metadataObjectEditSpec');

	function documentProps(): Record<string, unknown> {
		return {
			kind: 'document',
			internalName: 'ЗаказПокупателя',
			synonymRu: 'Заказ покупателя',
			comment: '',
			attributes: [{ name: 'Контрагент', synonymRu: 'Контрагент', comment: '' }],
			tabularSections: [],
			document: {
				posting: 'ALLOW',
				numberType: 'STRING',
				numberLength: '11',
				registerRecords: ['AccumulationRegister.Остатки'],
				autonumbering: true,
				checkUnique: true,
			},
		};
	}

	test('вкладки документа в раскладке EDT', () => {
		const tabs = buildDocumentEditTabs({
			internalName: 'ЗаказПокупателя',
			formNames: ['ФормаДокумента'],
			commandNames: [],
			numeratorNames: ['ОбщийНумератор'],
			registerOptions: [{ value: 'AccumulationRegister.Остатки', label: 'Регистр накопления: Остатки' }],
		});
		assert.deepStrictEqual(
			tabs.map((tab: { title: string }) => tab.title),
			['Основные', 'Данные', 'Движения', 'Формы', 'Команды', 'Ввод на основании']
		);
		const movements = tabs.find((tab: { id: string }) => tab.id === 'edit_movements');
		const rr = movements?.groups
			.flatMap((g: { fields: unknown[] }) => g.fields)
			.find((f: { path: string }) => f.path === 'document.registerRecords');
		assert.strictEqual(rr?.control, 'refList');
		assert.ok(rr?.options?.some((o: { value: string }) => o.value === 'AccumulationRegister.Остатки'));
		const numerator = tabs
			.flatMap((tab: { groups: Array<{ fields: unknown[] }> }) => tab.groups)
			.flatMap((g: { fields: Array<{ path: string }> }) => g.fields)
			.find((f: { path: string }) => f.path === 'document.numerator');
		assert.ok(numerator?.options?.some((o: { value: string }) => o.value === 'DocumentNumerator.ОбщийНумератор'));
	});

	test('панель документа начинается с редактируемых вкладок', () => {
		const structure = { kind: 'document', internalName: 'ЗаказПокупателя', forms: ['ФормаДокумента'], commands: [] };
		const tabs = buildMetadataObjectPropertiesTabsForTest('Document', documentProps(), structure);
		assert.strictEqual(tabs[0]?.id, 'edit_main');
		assert.strictEqual(tabs[0]?.render, 'edit');
		assert.ok(!tabs.some((tab) => tab.id === 'overview'));
	});
});
