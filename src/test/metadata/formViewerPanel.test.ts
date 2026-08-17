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
	dataPathTypes,
	commandTitles,
	commandsAtRight,
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

	test('служебные части таблицы стоят по свойствам положения, а не под переключателем', () => {
		const script = read('form-viewer.js');
		const service = listBetween(script, 'const SERVICE_TYPES', ']);', /'(\w+)'/g);
		const locations = listBetween(script, 'const ADDITION_LOCATIONS', '\n\t};', /(\w+):/g);

		for (const addition of ['SearchStringAddition', 'ViewStatusAddition', 'SearchControlAddition']) {
			assert.ok(!service.includes(addition), `${addition} редактор формы показывает`);
			assert.ok(locations.includes(addition), `${addition} без свойства положения рисовался бы всегда`);
		}
	});

	test('положение служебной части таблицы читается свойством таблицы', () => {
		const script = read('form-viewer.js');
		const properties = listBetween(script, 'const ADDITION_LOCATIONS', '\n\t};', /: '(\w+)'/g);

		assert.deepStrictEqual(
			properties.sort(),
			['SearchControlLocation', 'SearchStringLocation', 'ViewStatusLocation'],
			'положение задаёт таблица, а не сама служебная часть'
		);
	});

	test('группа колонок раскладывается по своей группировке', () => {
		const script = read('form-viewer.js');
		const grouping = script.slice(script.indexOf('function tableColumnHead'));

		assert.ok(grouping.includes("'Group'"), 'без свойства группировки ярусы были бы у любой группы');
		assert.ok(grouping.includes("'Horizontal'"), 'горизонтальная группа разводит колонки соседними');
		assert.ok(grouping.includes("'InCell'"), 'группа «в ячейке» ставит колонки рядом в одной ячейке');
	});

	test('над горизонтальной группой колонок общего заголовка нет', () => {
		const script = read('form-viewer.js');
		const css = read('form-viewer.css');
		const head = script.slice(script.indexOf('function tableColumnHead'), script.indexOf('function tableColumnBody'));

		// Конфигуратор полосу с заголовком группы не рисует: колонки просто стоят соседними.
		assert.ok(!head.includes('is-colgroup-title'), 'полоса с заголовком группы платформе неизвестна');
		assert.ok(!css.includes('is-colgroup-title'), 'оформление ненарисованной полосы осталось бы мусором');
	});

	test('заголовок группы с рамкой встаёт слева только у необъединённой группы в одну строку', () => {
		const script = read('form-viewer.js');
		const place = script.slice(script.indexOf('function placeGroupTitle'));

		// Слева заголовок стоит только у группы со снятым объединением и содержимым в одну строку.
		assert.ok(/United/.test(script.slice(script.indexOf('function previewGroup'))), 'объединение решает сторону');
		assert.ok(place.includes('is-horizontal'), 'многострочной группе заголовок ставится сверху');
		assert.ok(place.includes('is-title-left') && place.includes('is-title-top'), 'обе стороны разбираются');

		// Сторону пересчитывает укладка: «по возможности горизонтальная» сворачивается по месту.
		const fold = script.slice(script.indexOf('function foldTightGroups'));
		assert.ok(fold.includes('placeGroupTitle'), 'свернувшейся группе заголовок уходит наверх');
	});

	test('у группы с рамкой рисуется линия слева, а не рамка вокруг', () => {
		const css = read('form-viewer.css');
		const framed = /\.pv-group\.is-framed[^{]*\{([^}]*)\}/.exec(css);
		assert.ok(framed, 'оформление группы с рамкой не разобрано');

		// Конфигуратор рамки не рисует: у заголовка сверху слева от содержимого идёт линия.
		assert.ok(!/(?:^|;)\s*border\s*:/.test(framed[1]), 'рамки вокруг группы у платформы нет');
		assert.ok(framed[1].includes('border-left'), 'линия слева от содержимого остаётся');
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
		// Обычная панель и группа кнопок наполняются от записанного источника команд.
		assert.ok(filled.includes("'CommandSource'"), 'без источника команд панель списка осталась бы с одной кнопкой');
		assert.ok(filled.includes("'ButtonGroup'"), 'группу кнопок платформа наполняет так же, как панель');
	});

	test('панель без кнопок превью не рисует', () => {
		const script = read('form-viewer.js');
		const css = read('form-viewer.css');
		const bar = script.slice(script.indexOf('function previewCommandBar'), script.indexOf('function commandBarAlign'));

		assert.ok(bar.includes("classList.add('is-empty')"), 'пустая панель помечается, а не подписывается видом');
		assert.ok(
			/\.pv-commandbar\.is-empty[^{]*\{[^}]*display:\s*none/.test(css),
			'пустой панели на форме не видно'
		);
	});

	test('набранные платформой команды стоят перед записанными кнопками', () => {
		const script = read('form-viewer.js');
		const bar = script.slice(script.indexOf('function previewCommandBar'), script.indexOf('function commandBarAlign'));

		// Конфигуратор ставит стандартные команды первыми, а записанную кнопку - за ними.
		assert.ok(
			bar.indexOf('standardCommandsNote') < bar.indexOf('previewNode(child)'),
			'пометка о стандартных командах идёт до кнопок из файла'
		);
	});

	test('«Еще» есть у любой панели, которую наполняет платформа', () => {
		const script = read('form-viewer.js');
		const more = script.slice(script.indexOf('function hasMoreMenu'));

		// Панель списка с источником команд платформа наполняет и заводит ей «Еще».
		assert.ok(!/item\.type !== 'AutoCommandBar'/.test(more), 'обычная панель с источником команд тоже наполняется');
		assert.ok(more.includes('autoFilled'), 'наполнение решает, есть ли подменю');
		assert.ok(more.includes("'ButtonGroup'"), 'группа кнопок своего подменю не заводит');
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

	test('колонка со снятым расположением заголовка стоит с пустой шапкой', () => {
		const script = read('form-viewer.js');
		const title = script.slice(script.indexOf('function columnTitle'));

		assert.ok(title.includes('titleSide'), 'подпись колонки решает расположение заголовка');
		assert.ok(/'none'/.test(title.slice(0, title.indexOf('\n\t}'))), 'служебная колонка отступа идёт без подписи');
	});

	test('ширина колонки берётся из файла, а не делится на всю таблицу', () => {
		const script = read('form-viewer.js');
		const css = read('form-viewer.css');
		const width = script.slice(script.indexOf('function columnWidth'), script.indexOf('function tableHeadCell'));

		assert.ok(width.includes('item.width'), 'без записанной ширины колонки встали бы поровну');
		assert.ok(width.includes("flex = 'none'"), 'колонка с шириной не сжимается под ширину таблицы');
		const table = /\.pv-table(?![\w-])[^{]*\{([^}]*)\}/.exec(css);
		assert.ok(table, 'оформление таблицы не разобрано');
		assert.ok(/overflow-x:\s*auto/.test(table[1]), 'колонки шире таблицы уходят под горизонтальную прокрутку');
	});

	test('свободное место строки делят все растянутые элементы', () => {
		const script = read('form-viewer.js');
		const stretch = script.slice(script.indexOf('function stretchRow'), script.indexOf('function previewNode'));

		assert.ok(stretch.includes('canStretch'), 'растяжение решает свойство элемента');
		// Строка с парой растянутых полей делится пополам, а не остаётся по содержимому.
		assert.ok(!/length === 1/.test(stretch), 'место достаётся не только единственному растянутому элементу');
	});

	test('свободное место строки группе со значением «авто» не достаётся', () => {
		const script = read('form-viewer.js');
		const stretch = script.slice(script.indexOf('function canStretch'), script.indexOf('function stretchRow'));

		// Растянутая группа увела бы соседа к правому краю, а поля внутри - шире записанной ширины.
		assert.ok(stretch.includes('CONTAINER_TYPES'), 'группа делит место строки наравне с полем');
		assert.ok(
			/const CONTAINER_TYPES[^;]*'UsualGroup'/.test(script),
			'обычная группа в список контейнеров не попала'
		);
		// Умолчание вида читается целиком: у таблицы оно растянутое, у поля - «авто».
		assert.ok(stretch.includes("value === 'true'"), 'записанное умолчание вида не читается');
		assert.ok(stretch.includes("horizontalStretch === 'true'"), 'записанное растяжение сильнее умолчания');
	});

	test('свободную высоту занимает элемент с вертикальным растяжением', () => {
		const script = read('form-viewer.js');
		const css = read('form-viewer.css');
		const down = script.slice(script.indexOf('function canStretchDown'), script.indexOf('function stretchColumn'));

		assert.ok(down.includes("'VerticalStretch'"), 'высоту раздаёт свойство, а не вид элемента');
		// У таблицы умолчание вида уже растянутое, поэтому она занимает всё, что осталось от полей.
		assert.ok(down.includes("value === 'true'"), 'умолчание вида до раздачи высоты не доходит');
		// Со значением «авто» высоту набирает содержимое: контейнер тянется вслед за вложенным.
		assert.ok(down.includes('CONTAINER_TYPES'), 'группа над таблицей высоту не передаёт');
		assert.ok(
			/\.pv-form[^{]*\{[^}]*min-height:\s*100%/.test(css),
			'без высоты формы растянутой таблице нечего занимать'
		);
	});

	test('сторону заголовка в колонке задаёт имя значения выравнивания', () => {
		const script = read('form-viewer.js');
		const css = read('form-viewer.css');
		const side = script.slice(script.indexOf('function markTitlesSide'), script.indexOf('function previewGroup'));

		// «Элементы слева, заголовки слева»: к правому краю колонки идут только значения с TitlesRight.
		assert.ok(side.includes("'TitlesRight'"), 'сторона заголовка читается из имени значения');
		assert.ok(
			/\.pv-label\.is-aligned(?![\w-])[^{]*\{[^}]*text-align:\s*left/.test(css),
			'по умолчанию заголовки колонки прижаты не к левому краю'
		);
		assert.ok(
			/\.pv-label\.is-aligned\.is-titles-right[^{]*\{[^}]*text-align:\s*right/.test(css),
			'значение с заголовками справа колонку не разворачивает'
		);
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
 * Скрипт берёт их либо прямым обращением к записанному свойству, либо через таблицу кнопок поля
 * и таблицу положений служебных частей.
 */
function previewProperties(script: string): string[] {
	const direct = [
		...script.matchAll(/(?:written|effective)\(\w+(?:\.\w+)*, '(\w+)'/g),
		// Свойства самой формы приходят умолчаниями того же словаря, только видом Form.
		...script.matchAll(/formProperty\('(\w+)'/g),
	].map((match) => match[1]);
	return [
		...new Set([
			...direct,
			...listBetween(script, 'const FIELD_BUTTONS', '];', /\['(\w+)'/g),
			...listBetween(script, 'const ADDITION_LOCATIONS', '\n\t};', /: '(\w+)'/g),
		]),
	];
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

	test('у колонки по стандартному реквизиту табличной части подпись от платформы', () => {
		const titles = dataPathTitles(
			{
				tabularSections: [
					{
						name: 'ТабличнаяЧасть1',
						synonymRu: 'Табличная часть 1',
						attributes: [{ name: 'Значение1', synonymRu: 'Значение 1' }],
						standardAttributeSynonyms: { LineNumber: 'N' },
					},
				],
			},
			'Объект'
		);

		assert.strictEqual(titles['Объект.ТабличнаяЧасть1.LineNumber'], 'N');
		assert.strictEqual(titles['Объект.ТабличнаяЧасть1.Значение1'], 'Значение 1');
	});

	test('реквизит табличной части сильнее одноимённого стандартного', () => {
		const titles = dataPathTitles(
			{
				tabularSections: [
					{
						name: 'Строки',
						attributes: [{ name: 'LineNumber', synonymRu: 'Свой номер' }],
						standardAttributeSynonyms: { LineNumber: 'N' },
					},
				],
			},
			'Объект'
		);

		assert.strictEqual(titles['Объект.Строки.LineNumber'], 'Свой номер');
	});

	test('колонки динамического списка подписаны синонимами полей основной таблицы', () => {
		const titles = dataPathTitles(
			{
				internalName: 'ЗамерыОбластиСтатистики',
				childSynonyms: { КоличествоЗначений: 'Количество значений', ОперацияСтатистики: 'Операция статистики' },
			},
			'Список',
			[{ name: 'Список', main: true, mainTable: 'InformationRegister.ЗамерыОбластиСтатистики' }]
		);

		assert.strictEqual(titles['Список.КоличествоЗначений'], 'Количество значений');
		assert.strictEqual(titles['Список.ОперацияСтатистики'], 'Операция статистики');
	});

	test('список над чужой таблицей синонимами владельца не подписывается', () => {
		const titles = dataPathTitles(
			{
				internalName: 'ВариантыОтчетов',
				attributes: [{ name: 'Наименование', synonymRu: 'Имя варианта' }],
				childSynonyms: { Признак: 'Признак варианта' },
			},
			'Список',
			[{ name: 'Список', main: true, mainTable: 'Catalog.ДругойСправочник' }]
		);

		assert.deepStrictEqual(titles, {}, 'имена полей у разных объектов совпадают случайно');
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

suite('Типы реквизитов объекта для превью формы', () => {
	test('тип берётся и у реквизита объекта, и у колонки табличной части', () => {
		const types = dataPathTypes(
			{
				attributes: [{ name: 'Партнер', type: { types: ['cfg:CatalogRef.Партнеры'] } }],
				tabularSections: [{ name: 'Счета', attributes: [{ name: 'Счет', type: { types: ['cfg:DocumentRef.Счет'] } }] }],
			},
			'Объект'
		);

		assert.deepStrictEqual(types['Объект.Партнер'], ['cfg:CatalogRef.Партнеры']);
		assert.deepStrictEqual(types['Объект.Счета.Счет'], ['cfg:DocumentRef.Счет']);
	});

	test('реквизит без типа в набор не попадает', () => {
		const types = dataPathTypes({ attributes: [{ name: 'Сумма', type: { types: [] } }] }, 'Объект');

		assert.deepStrictEqual(types, {}, 'определяемый тип записан набором типов, а не типом');
	});

	test('список над чужим объектом типов владельца не получает', () => {
		const types = dataPathTypes(
			{ internalName: 'Валюты', attributes: [{ name: 'Курс', type: { types: ['xs:decimal'] } }] },
			'Список',
			[{ name: 'Список', main: true, mainTable: 'InformationRegister.КурсыВалют' }]
		);

		assert.deepStrictEqual(types, {}, 'имена полей у разных объектов совпадают случайно');
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

	test('сквозное выравнивание уходит в превью: по нему группы-соседи держат общую колонку подписей', () => {
		const defaults = layoutDefaults({
			UsualGroup: [
				{ name: 'ThroughAlign', kind: 'enum', defaultValue: 'Auto', values: ['Use', 'DontUse', 'Auto'] },
			],
		});

		assert.strictEqual(defaults.UsualGroup?.ThroughAlign, 'Auto');
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

	test('стандартную команду формы подписывает платформа', () => {
		const titles = commandTitles({}, [], { PostAndClose: 'Провести и закрыть', Help: 'Справка' });

		assert.strictEqual(titles['Form.StandardCommand.PostAndClose'], 'Провести и закрыть');
		assert.strictEqual(titles['Form.StandardCommand.Help'], 'Справка');
	});

	test('свой заголовок команды формы сильнее подписи платформы', () => {
		const titles = commandTitles({}, [{ name: 'Записать', title: 'Сохранить' }], { Записать: 'Записать' });

		assert.strictEqual(titles['Form.Command.Записать'], 'Сохранить');
		assert.strictEqual(titles['Form.StandardCommand.Записать'], 'Записать', 'команды лежат по разным ссылкам');
	});

	test('без заголовков и синонимов подписей нет', () => {
		assert.deepStrictEqual(commandTitles({}, [{ name: 'Обновить' }]), {});
	});
});

suite('Стандартные команды правой части панели', () => {
	test('имя команды приходит со своей приставкой', () => {
		assert.deepStrictEqual(commandsAtRight({ atRight: ['CustomizeForm', 'Help'] }), [
			'Form.StandardCommand.CustomizeForm',
			'Form.StandardCommand.Help',
		]);
	});

	test('порядок команд сохраняется: он же порядок кнопок на панели', () => {
		assert.deepStrictEqual(commandsAtRight({ atRight: ['Help', 'CustomizeForm'] }), [
			'Form.StandardCommand.Help',
			'Form.StandardCommand.CustomizeForm',
		]);
	});

	test('без словаря правой части нет', () => {
		assert.deepStrictEqual(commandsAtRight(), []);
		assert.deepStrictEqual(commandsAtRight({ labels: { Help: 'Справка' } }), []);
	});
});
