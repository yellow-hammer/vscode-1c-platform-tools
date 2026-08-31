import * as assert from 'node:assert';
import {
	applyChildNodeEdits,
	childNodeDtoList,
	childNodeKindLabel,
	childNodeTabs,
	findChildNode,
} from '../../features/properties/childNodePropertiesSpec';
import { paletteGroupsFromSpec } from '../../features/properties/propertyPaletteSpec';

const objectDto = {
	kind: 'catalog',
	internalName: 'Валюты',
	attributes: [
		{ name: 'НаименованиеПолное', synonymRu: 'Наименование валюты', comment: '', type: { types: ['xs:string'] } },
		{ name: 'Наценка', synonymRu: 'Наценка', comment: 'процент', type: { types: ['xs:decimal'] } },
	],
	tabularSections: [{ name: 'Представления', synonymRu: 'Представления', comment: '' }],
};

suite('Свойства узлов состава объекта', () => {
	test('вид узла определяет список DTO и подпись', () => {
		assert.strictEqual(childNodeDtoList('attribute'), 'attributes');
		assert.strictEqual(childNodeDtoList('tabularSection'), 'tabularSections');
		assert.strictEqual(childNodeDtoList('value'), 'enumValues');
		assert.strictEqual(childNodeDtoList('form'), undefined, 'у формы своих свойств в DTO объекта нет');
		assert.strictEqual(childNodeKindLabel('attribute'), 'Реквизит');
		assert.strictEqual(childNodeKindLabel('tabularAttribute'), 'Реквизит табличной части');
	});

	test('узел находится по имени, один тип идёт значением для списка', () => {
		const node = findChildNode(objectDto, 'attributes', 'Наценка');

		assert.strictEqual(node?.synonymRu, 'Наценка');
		assert.strictEqual(node?.comment, 'процент');
		assert.strictEqual(node?.typeSingle, 'xs:decimal', 'тип правится списком, значение идёт как в XML');
	});

	test('нет такого узла - нет и свойств', () => {
		assert.strictEqual(findChildNode(objectDto, 'attributes', 'Нету'), undefined);
		assert.strictEqual(findChildNode(objectDto, 'dimensions', 'Наценка'), undefined);
	});

	test('правятся синоним, комментарий и тип, имя только показывается', () => {
		const node = findChildNode(objectDto, 'attributes', 'Наценка');
		const options = [{ value: 'xs:decimal', label: 'Число' }, { value: 'xs:string', label: 'Строка' }];
		const rows = new Map(
			paletteGroupsFromSpec(childNodeTabs(true, node, options), node).flatMap((g) => g.rows).map((r) => [r.key, r])
		);

		assert.strictEqual(rows.get('synonymRu')?.readonly, false);
		assert.strictEqual(rows.get('comment')?.readonly, false);
		assert.strictEqual(rows.get('name')?.readonly, true, 'переименование - отдельная операция');
		assert.strictEqual(rows.get('typeSingle')?.readonly, false, 'тип выбирается списком');
		assert.strictEqual(rows.get('typeSingle')?.kind, 'select');
	});

	test('у нередактируемого вида все строки только для чтения', () => {
		const rows = paletteGroupsFromSpec(childNodeTabs(false), { name: 'ФормаСписка' }).flatMap((g) => g.rows);

		assert.ok(rows.length > 0, 'имя всё равно показывается');
		assert.ok(rows.every((row) => row.readonly === true));
	});

	test('правка узла ложится в DTO объекта, остальное не трогается', () => {
		const next = applyChildNodeEdits(objectDto, 'attributes', 'Наценка', {
			synonymRu: 'Наценка на курс',
			comment: '',
			name: 'ДругоеИмя',
		}) as typeof objectDto;

		assert.strictEqual(next.attributes[1].synonymRu, 'Наценка на курс');
		assert.strictEqual(next.attributes[1].comment, '');
		assert.strictEqual(next.attributes[1].name, 'Наценка', 'имя через палитру не меняется');
		assert.strictEqual(next.attributes[0].synonymRu, 'Наименование валюты', 'соседний реквизит не тронут');
		assert.strictEqual(objectDto.attributes[1].synonymRu, 'Наценка', 'исходный DTO не меняется');
	});

	test('пропавший узел даёт пустой результат, а не порчу DTO', () => {
		assert.strictEqual(applyChildNodeEdits(objectDto, 'attributes', 'Нету', { synonymRu: 'X' }), undefined);
		assert.strictEqual(applyChildNodeEdits(objectDto, 'enumValues', 'Наценка', { synonymRu: 'X' }), undefined);
	});
});
