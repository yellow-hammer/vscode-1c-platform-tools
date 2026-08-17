import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'node:fs';
import {
	commonFormXmlPath,
	findHandlerLine,
	formItemProperties,
	formModulePath,
	objectFormXmlPath,
	ownerObjectXmlPath,
	dataPathTitles,
	commandTitles,
	layoutDefaults,
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

	test('наборы видов элементов названы теми же видами, что и список видов', () => {
		const script = read('form-viewer.js');
		const known = new Set(listBetween(script, 'const TYPE_LABELS', '\n\t};', /(\w+):/g));
		assert.ok(known.size > 0, 'список видов элементов не разобран');

		for (const set of ['const SERVICE_TYPES', 'const CONTENT_SIZED_TYPES']) {
			const types = listBetween(script, set, ']);', /'(\w+)'/g);
			const unknown = types.filter((type) => !known.has(type));
			assert.deepStrictEqual(unknown, [], `${set}: вид с опечаткой ни на что не влияет: ${unknown.join(', ')}`);
		}
	});

	test('стороны заголовка названы константами, которые знает словарь значений', () => {
		const sides = listBetween(read('form-viewer.js'), 'const TITLE_SIDES', '\n\t};', /(\w+):/g);

		assert.ok(sides.includes('Left'), 'без заголовка слева колонка подписей не соберётся');
		const unknown = sides.filter((constant) => enumValueLabel('TitleLocation', constant) === constant);
		assert.deepStrictEqual(unknown, [], `константа с опечаткой ни на что не влияет: ${unknown.join(', ')}`);
	});

	test('оформление классов превью лежит в стилях', () => {
		const script = read('form-viewer.js');
		const css = read('form-viewer.css');
		const classes = new Set([
			...[...script.matchAll(/element\('\w+', '([\w -]+)'/g)].flatMap((match) => match[1].trim().split(' ')),
			...[...script.matchAll(/classList\.add\('([\w-]+)'\)/g)].map((match) => match[1]),
		]);

		const missing = [...classes].filter((name) => name.startsWith('pv-') && !css.includes(`.${name}`));
		assert.deepStrictEqual(missing, [], `нет оформления: ${missing.join(', ')}`);
	});

	test('пометку о стандартных командах превью ставит по автозаполнению панели', () => {
		const script = read('form-viewer.js');
		const filled = script.slice(script.indexOf('function autoFilled'));

		assert.ok(filled.includes("'AutoCommandBar'"), 'обычную панель платформа не наполняет');
		assert.ok(filled.includes("'Autofill'"), 'без автозаполнения панель остаётся такой, как записана');
	});

	test('положение командной панели формы превью берёт у самой формы, а не у панели', () => {
		const script = read('form-viewer.js');
		const place = script.slice(script.indexOf('function formCommandBarPlace'));

		// Свойство записано в корне Form.xml: у панели его нет, и через свойства элемента не пройдёт.
		assert.ok(
			/function formProperty[\s\S]*content\.properties/.test(script),
			'свойства самой формы приходят отдельным блоком содержимого'
		);
		assert.ok(place.includes("'CommandBarLocation'"), 'без свойства панель всегда стояла бы сверху');
		assert.ok(place.includes("'Bottom'"), 'конфигуратор ставит панель вниз по записанному положению');
		assert.ok(place.includes("'None'"), 'с положением «нет» панели не видно совсем');
	});

	test('ширину колонки подписей отмеряет скрипт, а не стили', () => {
		const css = read('form-viewer.css');
		const rules = [...css.matchAll(/\.pv-label(?![\w-])[^{]*\{([^}]*)\}/g)].map((match) => match[1]);
		assert.ok(rules.length > 0, 'оформление подписи не разобрано');

		// Ширина колонки зависит от самой длинной подписи соседей, поэтому в стилях её быть не может.
		const fixed = rules.filter((rule) => /(?:min-)?width\s*:/.test(rule));
		assert.deepStrictEqual(fixed, [], 'постоянная ширина подписи разъезжается с шириной колонки');
	});

	test('свойства, которые читает превью, доходят до него умолчаниями', () => {
		const used = previewProperties(read('form-viewer.js'));
		assert.ok(used.length > 0, 'свойства из скрипта не разобраны');

		// Умолчания собирает layoutDefaults: свойства не из его списка до превью не доедут,
		// и незаписанное свойство осталось бы пустым вместо значения по умолчанию.
		const defaults =
			layoutDefaults({ InputField: used.map((name) => ({ name, kind: 'enum', defaultValue: 'auto' })) }).InputField ??
			{};

		const missing = used.filter((name) => defaults[name] === undefined);
		assert.deepStrictEqual(missing, [], `нет в списке свойств превью: ${missing.join(', ')}`);
	});
});

/**
 * Имена свойств, которые скрипт превью читает у элемента формы.
 *
 * Скрипт берёт их либо прямым обращением к записанному свойству, либо через таблицу кнопок поля.
 */
function previewProperties(script: string): string[] {
	const direct = [
		...script.matchAll(/(?:written|effective)\(\w+(?:\.\w+)*, '(\w+)'/g),
		// Свойства самой формы приходят умолчаниями того же словаря, только видом Form.
		...script.matchAll(/formProperty\('(\w+)'/g),
	].map((match) => match[1]);
	return [...new Set([...direct, ...listBetween(script, 'const FIELD_BUTTONS', '];', /\['(\w+)'/g)])];
}

/** Значения из объявления скрипта: от `start` до ближайшего `end`. */
function listBetween(script: string, start: string, end: string, pattern: RegExp): string[] {
	const tail = script.slice(script.indexOf(start) + start.length);
	return [...tail.slice(0, tail.indexOf(end)).matchAll(pattern)].map((match) => match[1]);
}

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

suite('Подписи полей формы по синонимам реквизитов', () => {
	test('объект-владелец находится по пути формы', () => {
		const form = path.join('C:', 'п', 'src', 'cf', 'Catalogs', 'Валюты', 'Forms', 'ФормаЭлемента', 'Ext', 'Form.xml');
		assert.strictEqual(ownerObjectXmlPath(form), path.join('C:', 'п', 'src', 'cf', 'Catalogs', 'Валюты.xml'));
	});

	test('у общей формы владельца нет', () => {
		const form = path.join('C:', 'п', 'src', 'cf', 'CommonForms', 'МояФорма', 'Ext', 'Form.xml');
		assert.strictEqual(ownerObjectXmlPath(form), undefined);
	});

	test('синоним берётся и у обычного, и у стандартного реквизита', () => {
		const titles = dataPathTitles(
			{
				attributes: [{ name: 'НаименованиеПолное', synonymRu: 'Наименование валюты' }],
				standardAttributeSynonyms: { Code: 'Цифровой код', Description: 'Символьный код' },
				tabularSections: [
					{ name: 'Курсы', synonymRu: 'Курсы валют', attributes: [{ name: 'Курс', synonymRu: 'Курс валюты' }] },
				],
			},
			'Объект'
		);

		assert.strictEqual(titles['Объект.НаименованиеПолное'], 'Наименование валюты');
		assert.strictEqual(titles['Объект.Code'], 'Цифровой код');
		assert.strictEqual(titles['Объект.Description'], 'Символьный код');
		assert.strictEqual(titles['Объект.Курсы.Курс'], 'Курс валюты');
	});

	test('без главного реквизита остаются подписи реквизитов формы', () => {
		const titles = dataPathTitles({ attributes: [{ name: 'А', synonymRu: 'Б' }] }, '', [
			{ name: 'Список', title: 'Список валют' },
		]);

		assert.deepStrictEqual(titles, { 'Список': 'Список валют' }, 'реквизит объекта без главного не подписать');
	});

	test('реквизиты формы и их колонки подписываются своими заголовками', () => {
		const titles = dataPathTitles({}, 'Объект', [
			{ name: 'Список', title: 'Список валют', columns: [{ name: 'Курс', title: 'Курс на дату' }] },
		]);

		assert.strictEqual(titles['Список'], 'Список валют');
		assert.strictEqual(titles['Список.Курс'], 'Курс на дату');
	});
});

suite('Умолчания раскладки для превью формы', () => {
	test('берутся только свойства, от которых зависит раскладка', () => {
		const defaults = layoutDefaults({
			UsualGroup: [
				{ name: 'Group', kind: 'enum', defaultValue: 'HorizontalIfPossible' },
				{ name: 'Representation', kind: 'enum', defaultValue: 'WeakSeparation' },
				{ name: 'ToolTip', kind: 'localString' },
				{ name: 'Width', kind: 'number', defaultValue: '0' },
			],
		});

		assert.deepStrictEqual(defaults, {
			UsualGroup: { Group: 'HorizontalIfPossible', Representation: 'WeakSeparation' },
		});
	});

	test('выравнивание дочерних элементов уходит в превью: со значением «нет» общей колонки подписей не будет', () => {
		const defaults = layoutDefaults({
			UsualGroup: [
				{
					name: 'ChildrenAlign',
					kind: 'enum',
					defaultValue: 'Auto',
					values: ['Auto', 'None', 'ItemsLeftTitlesLeft', 'ItemsRightTitlesLeft'],
				},
			],
		});

		assert.strictEqual(defaults.UsualGroup?.ChildrenAlign, 'Auto');
	});

	test('отображение закладок страниц уходит в превью: без него страницы рисуются подряд', () => {
		const defaults = layoutDefaults({
			Pages: [{ name: 'PagesRepresentation', kind: 'enum', defaultValue: 'TabsOnTop', values: ['None', 'TabsOnTop'] }],
		});

		assert.strictEqual(defaults.Pages?.PagesRepresentation, 'TabsOnTop');
	});

	test('положение командной панели таблицы уходит в превью: с ним панели может не быть совсем', () => {
		const defaults = layoutDefaults({
			Table: [
				{ name: 'CommandBarLocation', kind: 'enum', defaultValue: 'Auto', values: ['None', 'Auto', 'Top', 'Bottom'] },
			],
		});

		assert.strictEqual(defaults.Table?.CommandBarLocation, 'Auto');
	});

	test('умолчания самой формы приходят таким же видом, как у элементов', () => {
		const defaults = layoutDefaults({
			Form: [
				{ name: 'CommandBarLocation', kind: 'enum', defaultValue: 'Auto', values: ['None', 'Auto', 'Top', 'Bottom'] },
				{ name: 'AutoTitle', kind: 'boolean', defaultValue: 'true' },
			],
		});

		assert.strictEqual(defaults.Form?.CommandBarLocation, 'Auto');
		assert.strictEqual(defaults.Form?.AutoTitle, undefined, 'на раскладку автозаголовок не влияет');
	});

	test('умолчания собираются по видам элементов отдельно', () => {
		const defaults = layoutDefaults({
			Button: [{ name: 'DefaultButton', kind: 'boolean', defaultValue: 'false' }],
			AutoCommandBar: [{ name: 'Autofill', kind: 'boolean', defaultValue: 'true' }],
			CheckBoxField: [{ name: 'TitleLocation', kind: 'enum', defaultValue: 'Auto' }],
		});

		assert.strictEqual(defaults.Button?.DefaultButton, 'false');
		assert.strictEqual(defaults.AutoCommandBar?.Autofill, 'true');
		assert.strictEqual(
			defaults.CheckBoxField?.HorizontalStretch,
			undefined,
			'у вида без растяжения его быть не должно: по этому превью и понимает, что тянуть нечего'
		);
	});

	test('вид без свойств раскладки в умолчания не попадает', () => {
		const defaults = layoutDefaults({ Button: [{ name: 'Title', kind: 'localString' }] });

		assert.deepStrictEqual(defaults, {});
	});

	test('без словаря умолчаний нет', () => {
		assert.deepStrictEqual(layoutDefaults(), {});
	});
});

suite('Подписи кнопок по синонимам команд', () => {
	test('команда формы подписывается своим заголовком', () => {
		const titles = commandTitles({}, [{ name: 'Обновить', title: 'Обновить курсы' }]);

		assert.strictEqual(titles['Form.Command.Обновить'], 'Обновить курсы');
	});

	test('команда объекта подписывается синонимом из его структуры', () => {
		const titles = commandTitles({ commandSynonyms: { ОтветитьВсем: 'Ответить всем' } });

		assert.strictEqual(titles['Command.ОтветитьВсем'], 'Ответить всем');
	});

	test('без заголовков и синонимов подписей нет', () => {
		assert.deepStrictEqual(commandTitles({}, [{ name: 'Обновить' }]), {});
	});
});
