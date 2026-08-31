import * as assert from 'node:assert';
import {
	applyChildNodeEdits,
	childNodePaletteFields,
	childNodeTabs,
	findChildNode,
} from '../../features/properties/childNodePropertiesSpec';

/** Объект со свойствами реквизита, как их отдаёт md-sparrow. */
function objectDto(): Record<string, unknown> {
	return {
		attributes: [
			{
				name: 'Владелец',
				synonymRu: 'Владелец',
				comment: '',
				type: { types: ['cfg:CatalogRef.Контрагенты'] },
				indexing: 'INDEX',
				fillChecking: 'SHOW_ERROR',
				fullTextSearch: 'USE',
				toolTipRu: 'Кому принадлежит',
				choiceParameters: [{ name: 'Отбор.Организация', valueText: 'true' }],
				choiceParameterLinks: [
					{ name: 'Отбор.Владелец', dataPath: 'Catalog.Номенклатура.Attribute.Склад', mode: 'CLEAR' },
				],
			},
			{ name: 'Пустой', synonymRu: '', comment: '' },
		],
	};
}

suite('свойства палитры у узла состава', () => {
	test('читаются вместе с узлом', () => {
		const node = findChildNode(objectDto(), 'attributes', 'Владелец');
		assert.strictEqual(node?.indexing, 'INDEX');
		assert.strictEqual(node?.fillChecking, 'SHOW_ERROR');
		assert.strictEqual(node?.toolTipRu, 'Кому принадлежит');
	});

	test('один тип отдаётся значением для списка', () => {
		const node = findChildNode(objectDto(), 'attributes', 'Владелец', { CatalogRef: 'Справочник' });
		assert.strictEqual(node?.typeSingle, 'cfg:CatalogRef.Контрагенты');
		assert.strictEqual(node?.typeText, undefined, 'строка показа нужна только составному типу');
	});

	test('составной тип показывается строкой через словарь', () => {
		const dto = { attributes: [{ name: 'Значение', type: { types: ['xs:string', 'cfg:CatalogRef.Валюты'] } }] };
		const node = findChildNode(dto, 'attributes', 'Значение', { CatalogRef: 'Справочник' });
		assert.strictEqual(node?.typeText, 'Строка, Справочник: Валюты');
		assert.strictEqual(node?.typeSingle, undefined, 'списком составной тип не выразить');
	});

	test('тип правится списком, когда кандидаты есть', () => {
		const node = findChildNode(objectDto(), 'attributes', 'Владелец');
		const options = [
			{ value: 'xs:string', label: 'Строка' },
			{ value: 'cfg:CatalogRef.Валюты', label: 'Справочник: Валюты' },
		];
		const field = childNodeTabs(true, node, options)[0].groups[0].fields.find((item) => item.path === 'typeSingle');
		assert.strictEqual(field?.control, 'select');
		assert.deepStrictEqual(field?.options, options);

		const withoutOptions = childNodeTabs(true, node)[0].groups[0].fields.find((item) => item.path === 'typeSingle');
		assert.strictEqual(withoutOptions?.readonly, true, 'без кандидатов список пустым не показываем');
	});

	test('у примитива показываются его квалификаторы', () => {
		const dto = {
			attributes: [
				{
					name: 'Наименование',
					type: { types: ['xs:string'], stringQualifiers: { length: '25', allowedLength: 'VARIABLE' } },
				},
			],
		};
		const node = findChildNode(dto, 'attributes', 'Наименование');
		assert.strictEqual(node?.typeLength, '25');
		assert.strictEqual(node?.typeAllowedLength, 'VARIABLE');

		const fields = childNodeTabs(true, node, [{ value: 'xs:string', label: 'Строка' }])[0].groups[0].fields;
		assert.deepStrictEqual(
			fields.filter((f) => f.path.startsWith('type')).map((f) => f.label),
			['Тип', 'Длина', 'Допустимая длина']
		);
	});

	test('поле типа перестраивает панель: под ним появляются квалификаторы', () => {
		const node = findChildNode(objectDto(), 'attributes', 'Владелец');
		const field = childNodeTabs(true, node, [{ value: 'xs:string', label: 'Строка' }])[0].groups[0].fields.find(
			(item) => item.path === 'typeSingle'
		);
		assert.strictEqual(field?.rebuilds, true, 'иначе квалификаторы появились бы только после записи');
	});

	test('у ссылочного типа квалификаторов нет', () => {
		const node = findChildNode(objectDto(), 'attributes', 'Владелец');
		const fields = childNodeTabs(true, node, [{ value: 'cfg:CatalogRef.Контрагенты', label: 'Справочник: Контрагенты' }])[0]
			.groups[0].fields;
		assert.deepStrictEqual(fields.filter((f) => f.path.startsWith('type')).map((f) => f.label), ['Тип']);
	});

	test('правка длины меняет квалификатор, не трогая остальное', () => {
		const dto = {
			attributes: [
				{
					name: 'Наименование',
					type: { types: ['xs:string'], stringQualifiers: { length: '25', allowedLength: 'VARIABLE' } },
				},
			],
		};
		const next = applyChildNodeEdits(dto, 'attributes', 'Наименование', { typeLength: '150' });
		const saved = (next?.attributes as Record<string, unknown>[])[0];
		assert.deepStrictEqual(saved.type, {
			types: ['xs:string'],
			stringQualifiers: { length: '150', allowedLength: 'VARIABLE' },
		});
	});

	test('выбранный тип уходит в объект списком с квалификаторами', () => {
		const next = applyChildNodeEdits(objectDto(), 'attributes', 'Владелец', { typeSingle: 'xs:string' });
		const saved = (next?.attributes as Record<string, unknown>[])[0];
		assert.deepStrictEqual(saved.type, {
			types: ['xs:string'],
			stringQualifiers: { length: '10', allowedLength: 'VARIABLE' },
		});
	});

	test('в палитру идут только те свойства, что есть у узла', () => {
		const filled = findChildNode(objectDto(), 'attributes', 'Владелец');
		const empty = findChildNode(objectDto(), 'attributes', 'Пустой');
		assert.deepStrictEqual(childNodePaletteFields(filled), [
			'toolTipRu',
			'fillChecking',
			'indexing',
			'fullTextSearch',
			'choiceParametersText',
			'choiceParameterLinksText',
		]);
		assert.deepStrictEqual(childNodePaletteFields(empty), []);
	});

	test('группа использования появляется только при таких свойствах', () => {
		const filled = findChildNode(objectDto(), 'attributes', 'Владелец');
		const withPalette = childNodeTabs(true, filled)[0].groups.map((group) => group.title);
		const withoutPalette = childNodeTabs(true, findChildNode(objectDto(), 'attributes', 'Пустой'))[0].groups.map(
			(group) => group.title
		);
		assert.deepStrictEqual(withPalette, ['Основные', 'Использование']);
		assert.deepStrictEqual(withoutPalette, ['Основные']);
	});

	test('перечислимые свойства ждут словарь значений', () => {
		const filled = findChildNode(objectDto(), 'attributes', 'Владелец');
		const fields = childNodeTabs(true, filled)[0].groups[1].fields;
		const indexing = fields.find((field) => field.path === 'indexing');
		assert.strictEqual(indexing?.control, 'select');
		assert.strictEqual(indexing?.options, undefined, 'варианты приходят от md-sparrow, а не из спеки');
	});

	test('параметры выбора и связи показываются словами, а не служебной записью', () => {
		const node = findChildNode(objectDto(), 'attributes', 'Владелец');
		assert.strictEqual(node?.choiceParametersText, 'Отбор.Организация = Истина', 'булево пишется словом');
		assert.strictEqual(
			node?.choiceParameterLinksText,
			'Отбор.Владелец ← Номенклатура.Склад',
			'из пути к данным уходят служебные сегменты вида'
		);
	});

	test('строки параметров выбора в объект не пишутся', () => {
		const next = applyChildNodeEdits(objectDto(), 'attributes', 'Владелец', {
			choiceParametersText: 'что-то другое',
			indexing: 'DONT_INDEX',
		});
		const saved = (next?.attributes as Record<string, unknown>[])[0];
		assert.strictEqual(saved.choiceParametersText, undefined, 'показ не подменяет типизированное значение');
		assert.strictEqual(saved.indexing, 'DONT_INDEX');
	});

	test('правка свойств палитры ложится обратно в объект', () => {
		const next = applyChildNodeEdits(objectDto(), 'attributes', 'Владелец', {
			indexing: 'DONT_INDEX',
			toolTipRu: 'Новая подсказка',
		});
		const saved = (next?.attributes as Record<string, unknown>[])[0];
		assert.strictEqual(saved.indexing, 'DONT_INDEX');
		assert.strictEqual(saved.toolTipRu, 'Новая подсказка');
		assert.strictEqual(saved.fillChecking, 'SHOW_ERROR', 'нетронутое свойство остаётся прежним');
	});
});
