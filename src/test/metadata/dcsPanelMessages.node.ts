/**
 * Сообщения панели СКД: маппинг dcs/autofill-fields и разбор ответов
 * автозаполнения (added/skipped) и строгой проверки схемы (ok/errors).
 * Запуск: npm run compile && node --test out/test/metadata/dcsPanelMessages.node.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
	DCS_MESSAGE_SPECS,
	dcsAffectedSettingsVariant,
	dcsAutofillResultOf,
	dcsMetadataGroupsOf,
	dcsMutationOf,
	dcsValidationOf,
	type DcsPanelMessage,
} from '../../features/metadata/dcsPanelMessages';

/** Разбор сообщения без оглядки на типы: webview может прислать что угодно. */
function parse(message: Record<string, unknown>) {
	return dcsMutationOf(message as unknown as DcsPanelMessage);
}

describe('Сообщение dcs/autofill-fields', () => {
	test('разбирается в cf-dcs-autofill-fields с именем набора', () => {
		assert.deepEqual(parse({ type: 'dcs/autofill-fields', dataSet: 'ОсновнойЗапрос' }), {
			op: 'cf-dcs-autofill-fields',
			dataSet: 'ОсновнойЗапрос',
		});
	});

	test('спека входит в каталог сообщений панели', () => {
		assert.deepEqual(DCS_MESSAGE_SPECS['dcs/autofill-fields'], {
			op: 'cf-dcs-autofill-fields',
			strings: ['dataSet'],
		});
	});

	test('без имени набора или с пустым не разбирается', () => {
		assert.equal(parse({ type: 'dcs/autofill-fields' }), undefined);
		assert.equal(parse({ type: 'dcs/autofill-fields', dataSet: '' }), undefined);
		assert.equal(parse({ type: 'dcs/autofill-fields', dataSet: 7 }), undefined);
	});

	test('настройки вариантов правка не трогает — перечитывать нечего', () => {
		const mutation = parse({ type: 'dcs/autofill-fields', dataSet: 'Основной' });
		assert.ok(mutation);
		assert.equal(dcsAffectedSettingsVariant(mutation), undefined);
	});

	test('dcs/validate — чтение: мутацией не разбирается', () => {
		assert.equal(parse({ type: 'dcs/validate' }), undefined);
	});

	test('dcs/list-metadata — чтение конструктора запроса: мутацией не разбирается', () => {
		assert.equal(parse({ type: 'dcs/list-metadata' }), undefined);
	});

	test('dcs/type-dictionary — чтение словаря окна типа: мутацией не разбирается', () => {
		assert.equal(parse({ type: 'dcs/type-dictionary' }), undefined);
		assert.equal(DCS_MESSAGE_SPECS['dcs/type-dictionary'], undefined, 'чтение не входит в белый каталог правок');
	});
});

describe('Тип значения в правках полей и параметров', () => {
	// Формы payload — md-sparrow docs/cf-dcs.md, «Запись типа значения»: маппер их не разбирает,
	// поэтому проверяется, что ни один ключ не теряется и не меняется по дороге в payloadJson
	const valueType = {
		types: ['xs:string', 'cfg:CatalogRef.Валюты'],
		typeSets: ['cfg:DocumentRef'],
		typeIds: [],
		stringQualifiers: { length: '100', allowedLength: 'VARIABLE' },
	};
	const cases: Array<[Record<string, unknown>, string, Record<string, unknown>]> = [
		[{ type: 'dcs/set-field', dataSet: 'Основной', dataPath: 'Сумма' }, 'cf-dcs-set-field', { valueType }],
		[{ type: 'dcs/set-field', dataSet: 'Основной', dataPath: 'Сумма' }, 'cf-dcs-set-field', { valueType: null }],
		[{ type: 'dcs/set-calculated-field', dataPath: 'Наценка' }, 'cf-dcs-set-calculated-field', { valueType }],
		[
			{ type: 'dcs/set-parameter', name: 'Период' },
			'cf-dcs-set-parameter',
			{
				valueType: { types: ['xs:dateTime'], typeSets: [], typeIds: [], dateQualifiers: { dateFractions: 'DATE' } },
				value: { type: 'xs:dateTime', text: '0001-01-01T00:00:00' },
				valueListAllowed: true,
				availableAsField: false,
				denyIncompleteValues: true,
			},
		],
		[{ type: 'dcs/set-parameter', name: 'Организация' }, 'cf-dcs-set-parameter', { value: null, valueListAllowed: false }],
		[{ type: 'dcs/set-parameter', name: 'Организация' }, 'cf-dcs-set-parameter', { value: { nil: true } }],
		[
			{ type: 'dcs/add-parameter' },
			'cf-dcs-add-parameter',
			{ name: 'Подразделение', valueType: { types: [], typeSets: [], typeIds: ['92fb25e9-5b34-4411-b876-cd83fa55a6e0'] } },
		],
	];

	test('valueType, value и признаки параметра доезжают в payloadJson без потерь', () => {
		for (const [fields, op, payload] of cases) {
			const mutation = parse({ ...fields, payload });
			assert.ok(mutation, `${op}: не разобрано`);
			assert.equal(mutation.op, op);
			assert.deepEqual(JSON.parse(mutation.payloadJson ?? ''), payload, op);
		}
	});
});

describe('Группы дерева объектов для конструктора запроса', () => {
	test('группы источников идут подряд, подгруппы «Общих» становятся группами', () => {
		const groups = dcsMetadataGroupsOf({
			projectRoot: '.',
			sources: [
				{
					kind: 'main',
					groups: [
						{
							label: 'Общие',
							items: [],
							subgroups: [
								{
									label: 'Общие макеты',
									items: [{ objectType: 'CommonTemplate', name: 'Макет1', relativePath: 'CommonTemplates/Макет1.xml' }],
								},
							],
						},
						{
							label: 'Справочники',
							items: [
								{ objectType: 'Catalog', name: 'Номенклатура', relativePath: 'Catalogs/Номенклатура.xml', synonym: 'Товары' },
							],
						},
					],
				},
			],
		});
		assert.deepEqual(groups, [
			{
				label: 'Общие макеты',
				items: [{ objectType: 'CommonTemplate', name: 'Макет1', relativePath: 'CommonTemplates/Макет1.xml', synonym: undefined }],
			},
			{
				label: 'Справочники',
				items: [{ objectType: 'Catalog', name: 'Номенклатура', relativePath: 'Catalogs/Номенклатура.xml', synonym: 'Товары' }],
			},
		]);
	});

	test('объекты без имени, вида или файла и пустые группы выбрасываются', () => {
		const groups = dcsMetadataGroupsOf({
			sources: [
				{
					groups: [
						{
							label: 'Документы',
							items: [
								{ objectType: 'Document', name: 'Заказ', relativePath: 'Documents/Заказ.xml' },
								{ objectType: 'Document', name: 'БезФайла', relativePath: '' },
								{ objectType: '', name: 'БезВида', relativePath: 'x.xml' },
								'мусор',
							],
						},
						{ label: 'Пустая', items: [] },
					],
				},
			],
		});
		assert.deepEqual(groups, [
			{ label: 'Документы', items: [{ objectType: 'Document', name: 'Заказ', relativePath: 'Documents/Заказ.xml', synonym: undefined }] },
		]);
	});

	test('кривой ответ даёт пустой список, а не падение', () => {
		assert.deepEqual(dcsMetadataGroupsOf(undefined), []);
		assert.deepEqual(dcsMetadataGroupsOf('мусор'), []);
		assert.deepEqual(dcsMetadataGroupsOf({ sources: 'не список' }), []);
		assert.deepEqual(dcsMetadataGroupsOf({ sources: [{ groups: [{ label: 7, items: null }] }] }), []);
	});
});

describe('Ответ автозаполнения полей (added/skipped)', () => {
	test('added и skipped доезжают как есть', () => {
		const result = dcsAutofillResultOf(
			'{"added":["Номенклатура","Сумма"],"skipped":[{"expression":"1 + 1","reason":"выражение без псевдонима"}]}'
		);
		assert.deepEqual(result, {
			added: ['Номенклатура', 'Сумма'],
			skipped: [{ expression: '1 + 1', reason: 'выражение без псевдонима' }],
		});
	});

	test('недостающие списки становятся пустыми: правка уже применена, падать поздно', () => {
		assert.deepEqual(dcsAutofillResultOf('{}'), { added: [], skipped: [] });
	});

	test('не-JSON и не-объект не разбираются', () => {
		assert.equal(dcsAutofillResultOf('OK'), undefined);
		assert.equal(dcsAutofillResultOf('42'), undefined);
		assert.equal(dcsAutofillResultOf(''), undefined);
	});

	test('чужие типы внутри списков отбрасываются', () => {
		const result = dcsAutofillResultOf('{"added":["Поле",7],"skipped":["мимо",{"reason":"причина"}]}');
		assert.deepEqual(result, { added: ['Поле'], skipped: [{ expression: undefined, reason: 'причина' }] });
	});
});

describe('Вердикт строгой проверки схемы', () => {
	test('ok и ошибки с позициями доезжают', () => {
		const verdict = dcsValidationOf(
			'{"ok":false,"errors":[{"message":"корень не тот","line":3,"column":14},{"message":"без позиции"}]}'
		);
		assert.deepEqual(verdict, {
			ok: false,
			errors: [
				{ message: 'корень не тот', line: 3, column: 14 },
				{ message: 'без позиции', line: undefined, column: undefined },
			],
			warnings: [],
		});
	});

	test('ошибок нет — ok с пустым списком', () => {
		assert.deepEqual(dcsValidationOf('{"ok":true}'), { ok: true, errors: [], warnings: [] });
	});

	test('предупреждения доезжают с видом: необъявленный параметр запроса и список старой записи', () => {
		// Ответ md-sparrow: ключ kind у всех предупреждений, у списка старой записи нет dataSet
		const lost =
			'параметр схемы Размер: список значений записан старой формой v8:ValueListType с представлениями элементов (10: «десять»); при загрузке платформа развернёт его в отдельные значения, а представления потеряет; уберите представления или оставьте список как есть, если их потеря не важна';
		const verdict = dcsValidationOf(
			JSON.stringify({
				ok: true,
				errors: [],
				warnings: [
					{ message: 'параметр запроса &Склад не объявлен в схеме (набор данных Остатки)', parameter: 'Склад', dataSet: 'Остатки', kind: 'undeclaredQueryParameter' },
					{ message: lost, parameter: 'Размер', kind: 'valueListPresentationsLost' },
				],
			})
		);
		assert.deepEqual(verdict, {
			ok: true,
			errors: [],
			warnings: [
				{ message: 'параметр запроса &Склад не объявлен в схеме (набор данных Остатки)', parameter: 'Склад', dataSet: 'Остатки', kind: 'undeclaredQueryParameter' },
				{ message: lost, parameter: 'Размер', dataSet: undefined, kind: 'valueListPresentationsLost' },
			],
		});
	});

	test('предупреждение о флажке «Список параметров» без параметра доезжает с номером связи вместо параметра', () => {
		// Ответ md-sparrow: {message, link, kind}; link — номер связи с нуля, как index у cf-dcs-set-link
		const flag =
			'связь наборов ВнешняяТаблица → ОсновнойЗапрос (номер 2): флаг «Список параметров» (parameterListAllowed=true) записан без параметра связи; при загрузке платформа его отбросит. Задайте parameter или снимите флаг';
		const verdict = dcsValidationOf(
			JSON.stringify({
				ok: true,
				errors: [],
				warnings: [
					{ message: flag, link: 2, kind: 'linkListFlagWithoutParameter' },
					{ message: flag, link: 0, kind: 'linkListFlagWithoutParameter' },
					{ message: flag, link: -1, kind: 'linkListFlagWithoutParameter' },
					{ message: flag, link: '2', kind: 'linkListFlagWithoutParameter' },
					{ message: flag, link: 1.5, kind: 'linkListFlagWithoutParameter' },
				],
			})
		);
		const bare = { message: flag, parameter: undefined, dataSet: undefined, kind: 'linkListFlagWithoutParameter' };
		assert.deepEqual(verdict, {
			ok: true,
			errors: [],
			warnings: [{ ...bare, link: 2 }, { ...bare, link: 0 }, bare, bare, bare],
		});
	});

	test('чужие элементы списка предупреждений разбираются терпимо', () => {
		const verdict = dcsValidationOf(
			'{"ok":true,"errors":[],"warnings":[{"message":"параметр запроса &X не объявлен в схеме (набор данных Н)","parameter":"X","dataSet":"Н","kind":"undeclaredQueryParameter"},"мимо",{"message":7}]}'
		);
		assert.deepEqual(verdict, {
			ok: true,
			errors: [],
			warnings: [
				{ message: 'параметр запроса &X не объявлен в схеме (набор данных Н)', parameter: 'X', dataSet: 'Н', kind: 'undeclaredQueryParameter' },
				{ message: undefined, parameter: undefined, dataSet: undefined, kind: undefined },
			],
		});
	});

	test('не-JSON и чужая форма — отказ с причиной', () => {
		assert.deepEqual(dcsValidationOf('мусор'), { error: 'Ответ проверки схемы не разобран.' });
		assert.deepEqual(dcsValidationOf('[]'), { error: 'Ответ проверки схемы не разобран.' });
		assert.deepEqual(dcsValidationOf('{"status":"ok"}'), { error: 'Ответ проверки схемы не разобран.' });
	});
});
