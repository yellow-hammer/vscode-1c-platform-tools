import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'node:fs';
import {
	commonFormXmlPath,
	findHandlerLine,
	formItemProperties,
	formModulePath,
	objectFormXmlPath,
} from '../../features/metadata/formViewerPanel';
import { enumValueLabel, propertyLabel } from '../../features/metadata/formItemPropertySpec';

suite('Просмотр формы: пути и переход к обработчику', () => {
	const objectXml = path.join('C:', 'проект', 'src', 'cf', 'Catalogs', 'Валюты.xml');

	test('форма объекта лежит в Forms/<Имя>/Ext/Form.xml', () => {
		assert.strictEqual(
			objectFormXmlPath(objectXml, 'Валюты', 'ФормаСписка'),
			path.join('C:', 'проект', 'src', 'cf', 'Catalogs', 'Валюты', 'Forms', 'ФормаСписка', 'Ext', 'Form.xml')
		);
	});

	test('у общей формы содержимое лежит в каталоге самой формы', () => {
		const commonFormXml = path.join('C:', 'проект', 'src', 'cf', 'CommonForms', 'ФормаНастроек.xml');
		assert.strictEqual(
			commonFormXmlPath(commonFormXml, 'ФормаНастроек'),
			path.join('C:', 'проект', 'src', 'cf', 'CommonForms', 'ФормаНастроек', 'Ext', 'Form.xml')
		);
	});

	test('модуль формы лежит рядом с содержимым', () => {
		const formXml = objectFormXmlPath(objectXml, 'Валюты', 'ФормаСписка');
		assert.strictEqual(formModulePath(formXml), path.join(path.dirname(formXml), 'Form', 'Module.bsl'));
	});

	test('обработчик находится по объявлению процедуры', () => {
		const module = [
			'&НаСервере',
			'Процедура ПриСозданииНаСервереСлужебная(Отказ)',
			'КонецПроцедуры',
			'',
			'&НаСервере',
			'Процедура ПриСозданииНаСервере(Отказ, СтандартнаяОбработка)',
			'КонецПроцедуры',
		].join('\n');

		assert.strictEqual(findHandlerLine(module, 'ПриСозданииНаСервере'), 5);
	});

	test('функция-обработчик тоже находится, а чужого имени нет', () => {
		const module = ['Функция КодПриИзменении(Элемент)', 'КонецФункции'].join('\n');

		assert.strictEqual(findHandlerLine(module, 'КодПриИзменении'), 0);
		assert.strictEqual(findHandlerLine(module, 'НетТакого'), -1);
	});
});

suite('Просмотр формы: разметка и скрипт', () => {
	const webviewRoot = path.resolve(__dirname, '../../..', 'resources', 'webview');

	function read(name: string): string {
		return fs.readFileSync(path.join(webviewRoot, name), 'utf8');
	}

	test('скрипт обращается только к элементам, которые есть в разметке', () => {
		const html = read('form-viewer.html');
		const script = read('form-viewer.js');
		const declared = new Set([...html.matchAll(/id="([\w-]+)"/g)].map((match) => match[1]));
		const used = [...script.matchAll(/getElementById\('([\w-]+)'\)/g)].map((match) => match[1]);

		const missing = used.filter((id) => !declared.has(id));
		assert.deepStrictEqual(missing, [], `нет в разметке: ${missing.join(', ')}`);
	});

	test('шаблон подставляет данные и скрипт', () => {
		const html = read('form-viewer.html');
		for (const placeholder of ['{{CSP_SOURCE}}', '{{NONCE}}', '{{CSS_URI}}', '{{JS_URI}}', '{{INITIAL_JSON}}']) {
			assert.ok(html.includes(placeholder), `в шаблоне нет ${placeholder}`);
		}
	});
});

suite('Свойства элемента формы для палитры', () => {
	const dictionary = {
		InputField: [
			{ name: 'name', kind: 'string' },
			{ name: 'DataPath', kind: 'string', defaultValue: '' },
			{ name: 'Visible', kind: 'boolean', defaultValue: 'true' },
			{ name: 'Width', kind: 'number', defaultValue: '0' },
			{ name: 'TitleLocation', kind: 'enum', defaultValue: 'Auto', values: ['Auto', 'None'] },
			{ name: 'Wrap', kind: 'boolean', defaultValue: 'false' },
		],
	};

	test('показывается весь состав свойств вида элемента, незаписанные - по умолчанию', () => {
		const state = formItemProperties(
			{ type: 'InputField', name: 'Код', properties: { name: 'Код', DataPath: 'Объект.Code', Width: '3' } },
			dictionary
		);

		const rows = state.groups.flatMap((group) => group.rows);
		assert.strictEqual(rows.length, 6, 'состав берётся из словаря, а не из файла');
		const byKey = new Map(rows.map((row) => [row.key, row]));
		assert.strictEqual(byKey.get('Width')?.value, '3', 'записанное значение важнее умолчания');
		assert.strictEqual(byKey.get('Visible')?.value, 'true', 'значение отдаём как в файле, словом его назовёт панель');
		assert.strictEqual(byKey.get('TitleLocation')?.value, 'Auto');
		assert.deepStrictEqual(
			byKey.get('TitleLocation')?.options,
			[
				{ value: 'Auto', label: 'Авто' },
				{ value: 'None', label: 'Нет' },
			],
			'константы перечисления показываются по-русски'
		);
		assert.ok(byKey.get('Visible')?.hint?.includes('по умолчанию'), 'видно, что значение не записано');
	});

	test('правятся только те свойства, которые md-sparrow пишет точечно', () => {
		const state = formItemProperties({ type: 'InputField', name: 'Код' }, {
			InputField: [
				{ name: 'name', kind: 'string', attribute: true },
				{ name: 'Visible', kind: 'boolean', defaultValue: 'true' },
				{ name: 'Font', kind: 'complex' },
			],
		});

		const byKey = new Map(state.groups.flatMap((group) => group.rows).map((row) => [row.key, row]));
		assert.strictEqual(byKey.get('name')?.readonly, true, 'имя элемента записано атрибутом');
		assert.strictEqual(byKey.get('Font')?.readonly, true, 'составное значение палитра не правит');
		assert.strictEqual(byKey.get('Visible')?.readonly, false);
	});

	test('свойства разложены по группам палитры', () => {
		const state = formItemProperties({ type: 'InputField', name: 'Код' }, dictionary);

		assert.deepStrictEqual(
			state.groups.map((group) => group.title),
			['Основные', 'Использование', 'Расположение', 'Оформление', 'Данные'],
			'группы идут в порядке палитры'
		);
	});

	test('свойство без описания попадает в «Прочие», а не теряется', () => {
		const state = formItemProperties({ type: 'InputField', name: 'Код' }, {
			InputField: [{ name: 'ПоканеизвестноеСвойство', kind: 'string' }],
		});

		assert.deepStrictEqual(
			state.groups.map((group) => group.title),
			['Прочие']
		);
	});

	test('без словаря показываем то, что записано в файле', () => {
		const state = formItemProperties({
			type: 'InputField',
			name: 'Код',
			properties: { name: 'Код', DataPath: 'Объект.Code' },
			events: [{ name: 'OnChange', handler: 'КодПриИзменении' }],
		});

		const rows = state.groups.flatMap((group) => group.rows);
		assert.deepStrictEqual(
			rows.map((row) => row.key),
			['name', 'DataPath', 'event.OnChange']
		);
		assert.strictEqual(state.subtitle, 'Поле ввода');
	});

	test('у элемента без имени в заголовке вид элемента', () => {
		const state = formItemProperties({ type: 'AutoCommandBar' });

		assert.strictEqual(state.title, 'Командная панель');
	});
});

suite('Подписи свойств и значений элемента формы', () => {
	test('подпись свойства из словаря, неизвестное - именем узла', () => {
		assert.strictEqual(propertyLabel('TitleLocation'), 'Положение заголовка');
		assert.strictEqual(propertyLabel('MinWidth'), 'Минимальная ширина');
		assert.strictEqual(propertyLabel('ПоканеизвестноеСвойство'), 'ПоканеизвестноеСвойство');
	});

	test('значения «да/нет/авто» одинаковы у всех свойств', () => {
		assert.strictEqual(enumValueLabel('SkipOnInput', 'true'), 'Да');
		assert.strictEqual(enumValueLabel('HorizontalStretch', 'false'), 'Нет');
		assert.strictEqual(enumValueLabel('MultiLine', 'auto'), 'Авто');
	});

	test('одна и та же константа у разных свойств названа по-своему', () => {
		assert.strictEqual(enumValueLabel('Group', 'Horizontal'), 'Горизонтальная');
		assert.strictEqual(enumValueLabel('Representation', 'Text'), 'Текст');
		assert.strictEqual(enumValueLabel('Representation', 'Line'), 'Линия');
		assert.strictEqual(enumValueLabel('HorizontalSpacing', 'Single'), 'Одинарный');
		assert.strictEqual(enumValueLabel('SelectionMode', 'Single'), 'Одиночный');
	});

	test('незнакомая константа остаётся как есть', () => {
		assert.strictEqual(enumValueLabel('Representation', 'ПоканеизвестноеЗначение'), 'ПоканеизвестноеЗначение');
	});
});
