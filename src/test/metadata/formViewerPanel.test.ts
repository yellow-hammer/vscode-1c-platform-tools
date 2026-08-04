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
	test('группы собираются из заполненных свойств', () => {
		const state = formItemProperties({
			type: 'InputField',
			name: 'Код',
			id: '2',
			dataPath: 'Объект.Code',
			width: '3',
			visible: false,
			events: [{ name: 'OnChange', handler: 'КодПриИзменении' }],
		});

		assert.strictEqual(state.title, 'Код');
		assert.strictEqual(state.subtitle, 'Поле ввода');
		assert.deepStrictEqual(
			state.groups.map((group) => group.title),
			['Основные', 'Использование', 'Расположение', 'События']
		);

		const main = state.groups[0];
		assert.deepStrictEqual(
			main.rows.map((row) => `${row.label}=${row.value}`),
			['Имя=Код', 'Путь к данным=Объект.Code', 'Идентификатор=2']
		);
		assert.strictEqual(state.groups[1].rows[0].value, 'Нет', 'булево показывается словом');
		assert.strictEqual(state.groups[3].rows[0].value, 'КодПриИзменении');
	});

	test('пустые свойства и группы без строк не показываются', () => {
		const state = formItemProperties({ type: 'ExtendedTooltip', name: 'Подсказка', title: '' });

		assert.deepStrictEqual(
			state.groups.map((group) => group.title),
			['Основные']
		);
		assert.deepStrictEqual(
			state.groups[0].rows.map((row) => row.label),
			['Имя']
		);
	});

	test('у элемента без имени в заголовке вид элемента', () => {
		const state = formItemProperties({ type: 'AutoCommandBar' });

		assert.strictEqual(state.title, 'Командная панель');
		assert.strictEqual(state.subtitle, 'Командная панель');
	});
});
