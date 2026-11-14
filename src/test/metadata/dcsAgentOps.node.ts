/**
 * Каталог правок и поиск файла схемы команд агента dcs.*: белый список операций,
 * маппинг аргументов dcs.apply и поиск файла схемы с версией формата по path.
 * Запуск: npm run compile && node --test out/test/metadata/dcsAgentOps.node.js
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	DCS_APPLY_OPS,
	DCS_OWNER_OPS,
	dcsApplyMutationOf,
	resolveDcsSchemaTarget,
} from '../../features/metadata/dcsAgentOps';
import { DCS_MESSAGE_SPECS, dcsMutationOf } from '../../features/metadata/dcsPanelMessages';

/** Ожидаемый каталог правок: мутации панели плюс операции вне её сообщений. */
const EXPECTED_APPLY_OPS = [
	// наборы, поля, связи, вычисляемые поля, ресурсы, параметры
	'cf-dcs-add-data-set',
	'cf-dcs-remove-data-set',
	'cf-dcs-rename-data-set',
	'cf-dcs-set-data-set-props',
	'cf-dcs-add-field',
	'cf-dcs-set-field',
	'cf-dcs-remove-field',
	'cf-dcs-add-link',
	'cf-dcs-set-link',
	'cf-dcs-remove-link',
	'cf-dcs-set-calculated-field',
	'cf-dcs-remove-calculated-field',
	'cf-dcs-add-total-field',
	'cf-dcs-set-total-field',
	'cf-dcs-remove-total-field',
	'cf-dcs-add-parameter',
	'cf-dcs-set-parameter',
	'cf-dcs-remove-parameter',
	// правки вне спеков сообщений (особые сообщения панели)
	'cf-dcs-set-query',
	'cf-dcs-add-calculated-field',
	// варианты настроек
	'cf-dcs-add-settings-variant',
	'cf-dcs-remove-settings-variant',
	'cf-dcs-set-settings-variant-props',
	'cf-dcs-add-structure-item',
	'cf-dcs-remove-structure-item',
	'cf-dcs-move-structure-item',
	'cf-dcs-set-group-fields',
	'cf-dcs-set-selection',
	'cf-dcs-set-order',
	'cf-dcs-set-filter',
	'cf-dcs-set-parameter-value',
	'cf-dcs-add-appearance-item',
	'cf-dcs-set-appearance-item',
	'cf-dcs-remove-appearance-item',
	// автозаполнение полей и макеты владельца
	'cf-dcs-autofill-fields',
	'cf-dcs-template-add',
	'cf-dcs-template-remove',
];

describe('Белый каталог правок dcs.apply', () => {
	test('каталог содержит все мутации cf-dcs-* и ничего кроме них', () => {
		assert.deepEqual([...DCS_APPLY_OPS], [...EXPECTED_APPLY_OPS].sort());
	});

	test('чтения в каталог не входят: dcs.apply — только правки', () => {
		for (const op of ['cf-dcs-info', 'cf-dcs-settings-info', 'cf-dcs-validate', 'cf-dcs-type-dictionary']) {
			assert.ok(!DCS_APPLY_OPS.includes(op as never), op);
			const mapped = dcsApplyMutationOf(op, {});
			assert.ok('error' in mapped, op);
		}
	});

	test('операция вне каталога отклоняется со списком доступных', () => {
		const mapped = dcsApplyMutationOf('cf-md-object-delete', {});
		assert.ok('error' in mapped);
		assert.match(mapped.error, /не входит в каталог правок СКД: cf-md-object-delete/);
		assert.match(mapped.error, /cf-dcs-add-data-set/, 'в отказе нет списка доступных op');
	});

	test('операции над описанием владельца — только макеты', () => {
		assert.deepEqual([...DCS_OWNER_OPS].sort(), ['cf-dcs-template-add', 'cf-dcs-template-remove']);
	});
});

/** Минимальные правильные params по спеку сообщения: обязательные поля с заполнителями. */
function minimalParams(op: string): Record<string, unknown> {
	const entry = Object.entries(DCS_MESSAGE_SPECS).find(([, spec]) => spec.op === op);
	assert.ok(entry, `нет спека сообщения для ${op}`);
	const [, spec] = entry;
	const params: Record<string, unknown> = {};
	for (const field of spec.strings ?? []) {
		params[field] = 'Значение';
	}
	if (spec.index) {
		params.index = 0;
	}
	if (spec.payload) {
		params.payload = { поле: 'значение' };
	}
	if (op === 'cf-dcs-add-data-set') {
		params.dataSetType = 'query';
		params.dataSource = 'ИсточникДанных1';
	}
	return params;
}

describe('Маппинг аргументов dcs.apply', () => {
	test('операции сообщений панели разбираются так же, как сообщения webview', () => {
		for (const [type, spec] of Object.entries(DCS_MESSAGE_SPECS)) {
			const params = minimalParams(spec.op);
			const mapped = dcsApplyMutationOf(spec.op, params);
			assert.ok('mutation' in mapped, `${spec.op}: ${'error' in mapped ? mapped.error : ''}`);
			assert.deepEqual(mapped.mutation, dcsMutationOf({ ...params, type }), spec.op);
		}
	});

	test('тип значения проходит каталогом как есть: payload целиком уходит в payloadJson', () => {
		const payload = {
			valueType: { types: ['cfg:CatalogRef.Организации'], typeSets: [], typeIds: [] },
			value: { nil: true },
			valueListAllowed: true,
		};
		const mapped = dcsApplyMutationOf('cf-dcs-set-parameter', { name: 'Организация', payload });
		assert.ok('mutation' in mapped, 'error' in mapped ? mapped.error : '');
		assert.deepEqual(JSON.parse(mapped.mutation.payloadJson ?? ''), payload);
	});

	test('без обязательного поля отказ называет, что нужно', () => {
		const mapped = dcsApplyMutationOf('cf-dcs-set-field', { dataSet: 'Продажи', payload: {} });
		assert.ok('error' in mapped);
		assert.match(mapped.error, /dataPath/);

		const noIndex = dcsApplyMutationOf('cf-dcs-remove-link', {});
		assert.ok('error' in noIndex);
		assert.match(noIndex.error, /index/);

		const noPayload = dcsApplyMutationOf('cf-dcs-set-filter', { variant: 'Основной' });
		assert.ok('error' in noPayload);
		assert.match(noPayload.error, /payload/);
	});

	test('params не объектом отклоняются до разбора полей', () => {
		for (const params of ['строка', 42, [], null]) {
			const mapped = dcsApplyMutationOf('cf-dcs-remove-data-set', params);
			assert.ok('error' in mapped, String(params));
		}
	});

	test('set-query: текст уходит полезной нагрузкой, имя набора — параметром tag', () => {
		const mapped = dcsApplyMutationOf('cf-dcs-set-query', { text: 'ВЫБРАТЬ 1', dataSet: 'Основной' });
		assert.ok('mutation' in mapped);
		assert.deepEqual(mapped.mutation, { op: 'cf-dcs-set-query', tag: 'Основной', payloadJson: 'ВЫБРАТЬ 1' });

		const singleSet = dcsApplyMutationOf('cf-dcs-set-query', { text: '' });
		assert.ok('mutation' in singleSet);
		assert.deepEqual(singleSet.mutation, { op: 'cf-dcs-set-query', payloadJson: '' });

		const noText = dcsApplyMutationOf('cf-dcs-set-query', { dataSet: 'Основной' });
		assert.ok('error' in noText);
		assert.match(noText.error, /text/);
	});

	test('add-calculated-field: поля собираются в DTO, как в сообщении панели', () => {
		const mapped = dcsApplyMutationOf('cf-dcs-add-calculated-field', { dataPath: 'Сумма', expression: 'Цена * 2' });
		assert.ok('mutation' in mapped);
		assert.equal(mapped.mutation.op, 'cf-dcs-add-calculated-field');
		assert.deepEqual(JSON.parse(mapped.mutation.payloadJson ?? ''), { dataPath: 'Сумма', expression: 'Цена * 2', title: '' });

		const noPath = dcsApplyMutationOf('cf-dcs-add-calculated-field', { expression: '1' });
		assert.ok('error' in noPath);
		assert.match(noPath.error, /dataPath/);
	});

	test('autofill-fields: нужен непустой набор-запрос', () => {
		const mapped = dcsApplyMutationOf('cf-dcs-autofill-fields', { dataSet: 'Основной' });
		assert.ok('mutation' in mapped);
		assert.deepEqual(mapped.mutation, { op: 'cf-dcs-autofill-fields', dataSet: 'Основной' });

		for (const params of [{}, { dataSet: '' }, { dataSet: 7 }]) {
			const refused = dcsApplyMutationOf('cf-dcs-autofill-fields', params);
			assert.ok('error' in refused, JSON.stringify(params));
			assert.match(refused.error, /dataSet/);
		}
	});

	test('template-add: имя обязательно, makeMain строго булев', () => {
		const mapped = dcsApplyMutationOf('cf-dcs-template-add', { name: 'Макет', makeMain: true });
		assert.ok('mutation' in mapped);
		assert.deepEqual(mapped.mutation, { op: 'cf-dcs-template-add', name: 'Макет', makeMain: true });

		const withoutMain = dcsApplyMutationOf('cf-dcs-template-add', { name: 'Макет' });
		assert.ok('mutation' in withoutMain);
		assert.deepEqual(withoutMain.mutation, { op: 'cf-dcs-template-add', name: 'Макет' });

		for (const params of [{}, { name: '' }, { name: 'Макет', makeMain: 'да' }]) {
			const refused = dcsApplyMutationOf('cf-dcs-template-add', params);
			assert.ok('error' in refused, JSON.stringify(params));
		}
	});

	test('template-remove: достаточно имени макета', () => {
		const mapped = dcsApplyMutationOf('cf-dcs-template-remove', { name: 'Макет' });
		assert.ok('mutation' in mapped);
		assert.deepEqual(mapped.mutation, { op: 'cf-dcs-template-remove', name: 'Макет' });

		const refused = dcsApplyMutationOf('cf-dcs-template-remove', {});
		assert.ok('error' in refused);
		assert.match(refused.error, /name/);
	});
});

/** Содержимое схемы: голова с DataCompositionSchema, как пишет платформа. */
const DCS_CONTENT =
	'<?xml version="1.0" encoding="UTF-8"?>\r\n' +
	'<DataCompositionSchema xmlns="http://v8.1c.ru/8.1/data-composition-system/schema"/>';

/** Описание с версией формата на корневом MetaDataObject. */
function metaDataObjectXml(version: string, body: string): string {
	return (
		'<?xml version="1.0" encoding="UTF-8"?>\r\n' +
		`<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="${version}">\r\n\t${body}\r\n</MetaDataObject>`
	);
}

function writeTree(root: string, files: Record<string, string>): void {
	for (const [relative, content] of Object.entries(files)) {
		const file = path.join(root, ...relative.split('/'));
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, content, 'utf8');
	}
}

describe('Поиск файла схемы по path команд dcs.*', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-agent-ops-'));
	after(() => fs.rmSync(root, { recursive: true, force: true }));

	const cf = path.join(root, 'cf');
	writeTree(cf, {
		'Configuration.xml': metaDataObjectXml('2.20', '<Configuration/>'),
		'Reports/Отчет1.xml': metaDataObjectXml('2.20', '<Report/>'),
		'Reports/Отчет1/Templates/Макет.xml': metaDataObjectXml('2.20', '<Template/>'),
		'Reports/Отчет1/Templates/Макет/Ext/Template.xml': DCS_CONTENT,
		'Reports/Отчет1/Templates/Табличный.xml': metaDataObjectXml('2.20', '<Template/>'),
		'Reports/Отчет1/Templates/Табличный/Ext/Template.xml':
			'<?xml version="1.0"?>\r\n<Document xmlns="http://v8.1c.ru/8.2/data/spreadsheet"/>',
	});
	const content = path.join(cf, 'Reports', 'Отчет1', 'Templates', 'Макет', 'Ext', 'Template.xml');

	test('файл содержимого в выгрузке: версия из Configuration.xml, cwd — корень выгрузки', async () => {
		const resolved = await resolveDcsSchemaTarget(content, undefined);
		assert.ok('target' in resolved, 'error' in resolved ? resolved.error : '');
		assert.deepEqual(resolved.target, { objectXml: content, cwd: cf, schemaVersion: 'V2_20' });
	});

	test('описание макета ведёт к его содержимому', async () => {
		const descriptor = path.join(cf, 'Reports', 'Отчет1', 'Templates', 'Макет.xml');
		const resolved = await resolveDcsSchemaTarget(descriptor, undefined);
		assert.ok('target' in resolved, 'error' in resolved ? resolved.error : '');
		assert.equal(resolved.target.objectXml, content);
	});

	test('относительный путь считается от корня проекта', async () => {
		const resolved = await resolveDcsSchemaTarget('Reports/Отчет1/Templates/Макет/Ext/Template.xml', cf);
		assert.ok('target' in resolved, 'error' in resolved ? resolved.error : '');
		assert.equal(resolved.target.objectXml, content);
	});

	test('относительный путь без корня проекта отклоняется', async () => {
		const resolved = await resolveDcsSchemaTarget('Reports/Отчет1/Templates/Макет/Ext/Template.xml', undefined);
		assert.ok('error' in resolved);
		assert.match(resolved.error, /Корень проекта не определён/);
	});

	test('не схема компоновки отклоняется до запуска jar', async () => {
		const resolved = await resolveDcsSchemaTarget(
			path.join(cf, 'Reports', 'Отчет1', 'Templates', 'Табличный', 'Ext', 'Template.xml'),
			undefined
		);
		assert.ok('error' in resolved);
		assert.match(resolved.error, /не является схемой компоновки/);
	});

	test('пустой path и отсутствующий файл дают понятные отказы', async () => {
		const empty = await resolveDcsSchemaTarget(undefined, cf);
		assert.ok('error' in empty);
		assert.match(empty.error, /path/);

		const missing = await resolveDcsSchemaTarget(path.join(cf, 'нет-такого.xml'), undefined);
		assert.ok('error' in missing);
		assert.match(missing.error, /Файл не найден/);
	});

	// Внешние отчёты и обработки выгружаются без Configuration.xml: версию несут их описания
	const external = path.join(root, 'external');
	writeTree(external, {
		'ВнешнийОтчет.xml': metaDataObjectXml('2.19', '<ExternalReport/>'),
		'ВнешнийОтчет/Templates/Макет.xml': metaDataObjectXml('2.19', '<Template/>'),
		'ВнешнийОтчет/Templates/Макет/Ext/Template.xml': DCS_CONTENT,
	});

	test('вне выгрузки версия формата берётся из описания макета рядом', async () => {
		const externalContent = path.join(external, 'ВнешнийОтчет', 'Templates', 'Макет', 'Ext', 'Template.xml');
		const resolved = await resolveDcsSchemaTarget(externalContent, undefined);
		assert.ok('target' in resolved, 'error' in resolved ? resolved.error : '');
		assert.deepEqual(resolved.target, {
			objectXml: externalContent,
			cwd: path.dirname(externalContent),
			schemaVersion: 'V2_19',
		});
	});

	// Проект EDT: версию формата знает метамодель сборки, флаг пустой
	const edt = path.join(root, 'edt');
	writeTree(edt, {
		'src/Configuration/Configuration.mdo': '<mdclass:Configuration/>',
		'src/Reports/Отчет1/Отчет1.mdo': '<mdclass:Report/>',
		'src/Reports/Отчет1/Templates/Макет/Template.dcs': DCS_CONTENT.replace('\r\n', '\n'),
	});

	test('Template.dcs проекта EDT: пустой флаг версии, cwd — корень исходников', async () => {
		const dcs = path.join(edt, 'src', 'Reports', 'Отчет1', 'Templates', 'Макет', 'Template.dcs');
		const resolved = await resolveDcsSchemaTarget(dcs, undefined);
		assert.ok('target' in resolved, 'error' in resolved ? resolved.error : '');
		assert.deepEqual(resolved.target, { objectXml: dcs, cwd: path.join(edt, 'src'), schemaVersion: '' });
	});
});
