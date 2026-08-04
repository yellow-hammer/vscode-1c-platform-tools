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
			{ name: 'TitleLocation', kind: 'enum', defaultValue: 'Auto', values: ['AUTO', 'NONE'] },
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
		assert.strictEqual(byKey.get('Visible')?.value, 'Да', 'умолчание булева показывается словом');
		assert.strictEqual(byKey.get('TitleLocation')?.value, 'Auto');
		assert.deepStrictEqual(
			byKey.get('TitleLocation')?.options?.map((option) => option.value),
			['AUTO', 'NONE']
		);
		assert.ok(byKey.get('Visible')?.hint?.includes('по умолчанию'), 'видно, что значение не записано');
	});

	test('свойства разложены по группам палитры', () => {
		const state = formItemProperties({ type: 'InputField', name: 'Код' }, dictionary);

		assert.deepStrictEqual(
			state.groups.map((group) => group.title),
			['Основные', 'Использование', 'Расположение', 'Данные', 'Прочие'],
			'свойство без описания попадает в «Прочие», а не теряется'
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
