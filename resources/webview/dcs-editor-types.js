/**
 * Тип значения в редакторе СКД: чистые функции без DOM над DTO `valueType` из cf-dcs-info.
 *
 * Как и dcs-editor-highlight.js, файл живёт двумя жизнями: webview подключает его отдельным
 * <script> и берёт функции из window.DcsTypes, а node-тесты исполняют его в песочнице и читают
 * module.exports. Здесь только расчёты: подпись типа, переключение флажка в дереве типов,
 * квалификаторы, совместимость значения параметра, сравнение «слать ли payload», дерево окна
 * «Тип значения» по словарю и сам payload правки (typeEditPayload) — его же собирают диалог
 * поля, вычисляемого поля и параметра, поэтому правило «что уходит в jar» живёт в одном месте.
 *
 * Форма DTO — та, что отдаёт md-sparrow (`docs/cf-dcs.md`, «Типы значений»): `types[]`,
 * `typeSets[]`, `typeIds[]`, `definedTypes[]?`, квалификаторы со строковыми числами и именами
 * констант (`VARIABLE`, `NONNEGATIVE`, `DATE_TIME`), `editable`, `readOnlyReason?`. Словарь —
 * ответ cf-dcs-type-dictionary; без него подписи берутся из запасной таблицы ниже, потому что
 * колонка «Тип» в таблицах рисуется раньше, чем диалог типа загрузит словарь.
 */
(function (root) {
	'use strict';

	/** Ключи квалификаторов в DTO по виду из словаря (`primitives[].qualifiers`). */
	var QUALIFIER_KEY = {
		string: 'stringQualifiers',
		number: 'numberQualifiers',
		date: 'dateQualifiers',
	};

	/**
	 * Примитивы белого словаря записи и вид их квалификатора. Подписи совпадают с таблицей
	 * md-sparrow (`valueTypes` cf-enum-labels) и с PRIMITIVE_TYPES панели свойств объекта:
	 * словарь, когда он загружен, всё равно главнее — это только запасной вариант.
	 */
	var PRIMITIVES = Object.freeze([
		Object.freeze({ type: 'xs:string', label: 'Строка', qualifiers: 'string' }),
		Object.freeze({ type: 'xs:decimal', label: 'Число', qualifiers: 'number' }),
		Object.freeze({ type: 'xs:dateTime', label: 'Дата', qualifiers: 'date' }),
		Object.freeze({ type: 'xs:boolean', label: 'Булево' }),
		Object.freeze({ type: 'v8:StandardPeriod', label: 'Стандартный период' }),
		Object.freeze({ type: 'v8:UUID', label: 'Уникальный идентификатор' }),
	]);

	/**
	 * Типы вне белого словаря: их пишет только конфигуратор, редактор показывает подпись и
	 * переносит байты эхом. Подписи свои; неизвестный тип показывается как есть.
	 */
	var READ_ONLY_LABELS = {
		'v8:Type': 'Тип',
		'v8:Null': 'Null',
		'v8:ValueTable': 'Таблица значений',
		'v8:ValueStorage': 'Хранилище значения',
		'v8:StandardBeginningDate': 'Стандартная дата начала',
		'v8:ValueListType': 'Список значений',
		'xs:base64Binary': 'Двоичные данные',
	};

	/**
	 * Имена ссылочных типов платформы по суффиксу вида — запасная копия `refTypeNames`
	 * cf-enum-labels. Точка маршрута нужна только для подписи: в словарь новых типов она не
	 * входит, но записанная в файле должна читаться. Журнала документов здесь нет:
	 * ссылочного типа у журналов у платформы нет.
	 */
	var REF_TYPE_NAMES = {
		CatalogRef: 'СправочникСсылка',
		DocumentRef: 'ДокументСсылка',
		EnumRef: 'ПеречислениеСсылка',
		ChartOfCharacteristicTypesRef: 'ПланВидовХарактеристикСсылка',
		ChartOfAccountsRef: 'ПланСчетовСсылка',
		ChartOfCalculationTypesRef: 'ПланВидовРасчетаСсылка',
		ExchangePlanRef: 'ПланОбменаСсылка',
		BusinessProcessRef: 'БизнесПроцессСсылка',
		TaskRef: 'ЗадачаСсылка',
		BusinessProcessRoutePointRef: 'ТочкаМаршрутаБизнесПроцессаСсылка',
	};

	/**
	 * Вид объекта в тексте значения конфигуратора (`dcscor:DesignTimeValue`, «Справочник.Валюты.
	 * ПустаяСсылка»): русское имя вида → вид ссылочного типа. Английские имена видов совпадают
	 * с самим видом, поэтому отдельной таблицы не требуют.
	 */
	var DESIGN_TIME_KINDS = {
		Справочник: 'Catalog',
		Документ: 'Document',
		Перечисление: 'Enum',
		ПланВидовХарактеристик: 'ChartOfCharacteristicTypes',
		ПланСчетов: 'ChartOfAccounts',
		ПланВидовРасчета: 'ChartOfCalculationTypes',
		ПланОбмена: 'ExchangePlan',
		БизнесПроцесс: 'BusinessProcess',
		Задача: 'Task',
	};

	/**
	 * Значения, которые сверяются с типом прямо по `type`: так же решает писатель md-sparrow
	 * (`DcsValueTypeEdit.fits`), чтобы диалог не пропустил то, от чего откажется jar.
	 */
	var TYPED_VALUES = {
		'xs:string': true,
		'xs:decimal': true,
		'xs:boolean': true,
		'xs:dateTime': true,
		'v8:StandardPeriod': true,
		'v8:StandardBeginningDate': true,
		'v8:UUID': true,
	};

	/** Тексты файла и имена констант квалификаторов — одно значение (`DateTime` = `DATE_TIME`). */
	var CONSTANT_FORMS = {
		VARIABLE: 'VARIABLE',
		Variable: 'VARIABLE',
		FIXED: 'FIXED',
		Fixed: 'FIXED',
		ANY: 'ANY',
		Any: 'ANY',
		NONNEGATIVE: 'NONNEGATIVE',
		Nonnegative: 'NONNEGATIVE',
		DATE: 'DATE',
		Date: 'DATE',
		TIME: 'TIME',
		Time: 'TIME',
		DATE_TIME: 'DATE_TIME',
		DateTime: 'DATE_TIME',
	};

	var ANY_REF_SETS = { 'cfg:AnyIBRef': true, 'cfg:AnyRef': true };

	var ZERO_DATE = '0001-01-01T00:00:00';

	var ZERO_UUID = '00000000-0000-0000-0000-000000000000';

	var UUID_TEXT = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

	function primitiveOf(type) {
		for (var i = 0; i < PRIMITIVES.length; i += 1) {
			if (PRIMITIVES[i].type === type) {
				return PRIMITIVES[i];
			}
		}
		return null;
	}

	function stringList(value) {
		var out = [];
		if (!Array.isArray(value)) {
			return out;
		}
		for (var i = 0; i < value.length; i += 1) {
			if (typeof value[i] === 'string' && value[i].trim() !== '') {
				out.push(value[i].trim());
			}
		}
		return out;
	}

	function isObject(value) {
		return value !== null && typeof value === 'object' && !Array.isArray(value);
	}

	/**
	 * Значение таблицы только по собственному ключу: тексты типов приходят из файла, и
	 * «constructor» или «__proto__» не должны находить свойства Object.prototype.
	 */
	function own(map, key) {
		return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
	}

	/** Индексы словаря без прототипа: ключи — тексты типов и UUID из ответа md-sparrow. */
	function emptyIndex() {
		return {
			primitives: Object.create(null),
			refNames: Object.create(null),
			definedNames: Object.create(null),
			definedCompositions: Object.create(null),
		};
	}

	function copyObject(value) {
		var out = {};
		for (var key in value) {
			if (Object.prototype.hasOwnProperty.call(value, key)) {
				out[key] = value[key];
			}
		}
		return out;
	}

	/**
	 * Смысловая часть DTO: списки типов и квалификаторы. Признаки `editable`/`readOnlyReason`
	 * только читаются (md-sparrow вычисляет их сам), поэтому в новый тип не переносятся.
	 */
	function baseOf(dto) {
		var src = isObject(dto) ? dto : {};
		var out = { types: stringList(src.types), typeSets: stringList(src.typeSets), typeIds: stringList(src.typeIds) };
		var names = stringList(src.definedTypes);
		if (names.length > 0) {
			out.definedTypes = names;
		}
		var keys = ['stringQualifiers', 'numberQualifiers', 'dateQualifiers', 'binaryDataQualifiers'];
		for (var i = 0; i < keys.length; i += 1) {
			if (isObject(src[keys[i]])) {
				out[keys[i]] = copyObject(src[keys[i]]);
			}
		}
		return out;
	}

	/** Тип без единого элемента: такой тип md-sparrow пишет снятием `valueType` целиком. */
	function isEmptyType(dto) {
		var base = baseOf(dto);
		return base.types.length === 0 && base.typeSets.length === 0 && base.typeIds.length === 0;
	}

	/**
	 * В какой список DTO идёт элемент дерева типов: `typeSets` — «любая ссылка», «любая ссылка
	 * вида» (`cfg:CatalogRef` без имени) и характеристики; `typeIds` — UUID определяемого типа;
	 * остальное — `types`.
	 */
	function typeListOf(type) {
		if (isObject(type)) {
			return 'typeIds';
		}
		if (typeof type !== 'string') {
			return '';
		}
		if (UUID_TEXT.test(type)) {
			return 'typeIds';
		}
		if (own(ANY_REF_SETS, type) || /^cfg:\w+Ref$/.test(type) || /^cfg:(Characteristic|DefinedType)\.[^.]+$/.test(type)) {
			return 'typeSets';
		}
		return 'types';
	}

	// ------------------------------------------------------------------ словарь и подписи

	/**
	 * Индексы словаря на время жизни объекта ответа: подпись типа считается в каждой строке
	 * таблицы полей, а словарь большой конфигурации — сотни строк.
	 */
	var dictionaryIndexes = new WeakMap();

	function dictionaryIndex(dictionary) {
		if (!isObject(dictionary)) {
			return emptyIndex();
		}
		if (dictionaryIndexes.has(dictionary)) {
			return dictionaryIndexes.get(dictionary);
		}
		var index = emptyIndex();
		var primitives = Array.isArray(dictionary.primitives) ? dictionary.primitives : [];
		for (var i = 0; i < primitives.length; i += 1) {
			var row = primitives[i] || {};
			if (typeof row.type === 'string' && typeof row.label === 'string' && row.label !== '') {
				index.primitives[row.type] = row.label;
			}
		}
		var kinds = Array.isArray(dictionary.refKinds) ? dictionary.refKinds : [];
		for (var j = 0; j < kinds.length; j += 1) {
			var kind = kinds[j] || {};
			if (typeof kind.typeSet === 'string' && typeof kind.platformName === 'string' && kind.platformName !== '') {
				index.refNames[kind.typeSet.replace(/^cfg:/, '')] = kind.platformName;
			}
		}
		var defined = Array.isArray(dictionary.definedTypes) ? dictionary.definedTypes : [];
		for (var k = 0; k < defined.length; k += 1) {
			var entry = defined[k] || {};
			if (typeof entry.typeId === 'string' && typeof entry.name === 'string') {
				index.definedNames[entry.typeId.toLowerCase()] = entry.name;
			}
			// Состав (definedTypes[].composition) md-sparrow отдаёт, только если нашёл описание
			// определяемого типа в выгрузке: без него ключа нет
			if (typeof entry.typeId === 'string' && isObject(entry.composition)) {
				index.definedCompositions[entry.typeId.trim().toLowerCase()] = entry.composition;
			}
		}
		dictionaryIndexes.set(dictionary, index);
		return index;
	}

	function constantOf(value) {
		return typeof value === 'string' ? own(CONSTANT_FORMS, value.trim()) || value.trim() : '';
	}

	/** Число квалификатора: целое неотрицательное строкой файла или числом поля ввода; иначе NaN. */
	function countOf(value) {
		if (typeof value === 'number') {
			return Number.isInteger(value) && value >= 0 ? value : NaN;
		}
		if (typeof value === 'string' && /^\s*\d+(\.0*)?\s*$/.test(value)) {
			return Number(value);
		}
		return NaN;
	}

	/**
	 * Квалификаторы в подписи — своими словами по образцу «Строка(100)»: умолчания
	 * (неограниченная строка, число без разрядности, переменная длина, любой знак) опущены,
	 * чтобы колонка «Тип» оставалась короткой.
	 */
	function qualifierSuffix(type, base) {
		var parts = [];
		if (type === 'xs:string' && base.stringQualifiers) {
			var length = countOf(base.stringQualifiers.length);
			if (length > 0) {
				parts.push(String(length));
				if (constantOf(base.stringQualifiers.allowedLength) === 'FIXED') {
					parts.push('фиксированная');
				}
			}
		} else if (type === 'xs:decimal' && base.numberQualifiers) {
			var digits = countOf(base.numberQualifiers.digits);
			var fraction = countOf(base.numberQualifiers.fractionDigits);
			if (digits > 0 || fraction > 0) {
				parts.push(String(isNaN(digits) ? 0 : digits), String(isNaN(fraction) ? 0 : fraction));
			}
			if (constantOf(base.numberQualifiers.allowedSign) === 'NONNEGATIVE') {
				parts.push('неотрицательное');
			}
		} else if (type === 'xs:dateTime' && base.dateQualifiers) {
			var fractions = constantOf(base.dateQualifiers.dateFractions);
			if (fractions === 'DATE') {
				parts.push('дата');
			} else if (fractions === 'TIME') {
				parts.push('время');
			} else if (fractions === 'DATE_TIME') {
				parts.push('дата и время');
			}
		}
		return parts.length > 0 ? '(' + parts.join(', ') + ')' : '';
	}

	/** Имя ссылочного типа платформы по суффиксу вида: словарь, иначе запасная таблица. */
	function refName(refKind, index) {
		return own(index.refNames, refKind) || own(REF_TYPE_NAMES, refKind) || '';
	}

	function typeLabel(type, base, index) {
		var primitive = primitiveOf(type);
		if (primitive) {
			return (own(index.primitives, type) || primitive.label) + qualifierSuffix(type, base);
		}
		if (own(READ_ONLY_LABELS, type)) {
			return own(READ_ONLY_LABELS, type);
		}
		var ref = /^cfg:(\w+Ref)\.(.+)$/.exec(type);
		if (ref) {
			var name = refName(ref[1], index);
			return name ? name + '.' + ref[2] : type.replace(/^cfg:/, '');
		}
		return type.replace(/^cfg:/, '');
	}

	function typeSetLabel(typeSet, index) {
		if (own(ANY_REF_SETS, typeSet)) {
			return 'Любая ссылка';
		}
		var kind = /^cfg:(\w+Ref)$/.exec(typeSet);
		if (kind) {
			return refName(kind[1], index) || typeSet.replace(/^cfg:/, '');
		}
		var characteristic = /^cfg:Characteristic\.(.+)$/.exec(typeSet);
		if (characteristic) {
			return 'Характеристика.' + characteristic[1];
		}
		var defined = /^cfg:DefinedType\.(.+)$/.exec(typeSet);
		if (defined) {
			return 'ОпределяемыйТип.' + defined[1];
		}
		return typeSet.replace(/^cfg:/, '');
	}

	function typeIdLabel(typeId, position, base, index) {
		var names = base.definedTypes || [];
		var name = names.length === base.typeIds.length ? names[position] : '';
		if (!name) {
			name = own(index.definedNames, typeId.toLowerCase()) || '';
		}
		return name ? 'ОпределяемыйТип.' + name : 'Определяемый тип ' + typeId;
	}

	/**
	 * Элементы типа в порядке DTO (`types` → `typeSets` → `typeIds`, как в файле) с подписями:
	 * из них диалог рисует чипы составного типа, а подпись — их перечисление.
	 */
	function typeItems(dto, dictionary) {
		var base = baseOf(dto);
		var index = dictionaryIndex(dictionary);
		var out = [];
		for (var i = 0; i < base.types.length; i += 1) {
			out.push({ list: 'types', value: base.types[i], label: typeLabel(base.types[i], base, index) });
		}
		for (var j = 0; j < base.typeSets.length; j += 1) {
			out.push({ list: 'typeSets', value: base.typeSets[j], label: typeSetLabel(base.typeSets[j], index) });
		}
		for (var k = 0; k < base.typeIds.length; k += 1) {
			out.push({ list: 'typeIds', value: base.typeIds[k], label: typeIdLabel(base.typeIds[k], k, base, index) });
		}
		return out;
	}

	/**
	 * Подпись типа в форме «Строка(100), СправочникСсылка.Валюты»: элементы через запятую в
	 * порядке файла. Пустая строка — тип не задан (поле набора-запроса получает его от платформы).
	 */
	function typePresentation(dto, dictionary) {
		var items = typeItems(dto, dictionary);
		var labels = [];
		for (var i = 0; i < items.length; i += 1) {
			labels.push(items[i].label);
		}
		return labels.join(', ');
	}

	/**
	 * Столько элементов состава показывает compositionTitle: в составе бывают десятки типов, а
	 * всплывающая подсказка — не список, и экранный диктор прочёл бы все.
	 */
	var COMPOSITION_TITLE_ITEMS = 5;

	/** Записи составов, пришитые к типу (DcsFieldTypes.attachTypeCompositions), по источнику без учёта регистра. */
	function attachedCompositions(dto) {
		var out = Object.create(null);
		var records = isObject(dto) && Array.isArray(dto.compositions) ? dto.compositions : [];
		for (var i = 0; i < records.length; i += 1) {
			var record = records[i];
			if (isObject(record) && typeof record.source === 'string' && record.source.trim() !== '') {
				var key = record.source.trim().toLowerCase();
				if (!own(out, key)) {
					out[key] = record;
				}
			}
		}
		return out;
	}

	/** Состав определяемого типа по имени из словаря окна типа: так находится состав набора `cfg:DefinedType.X`. */
	function definedCompositionByName(name, dictionary) {
		var defined = isObject(dictionary) && Array.isArray(dictionary.definedTypes) ? dictionary.definedTypes : [];
		for (var i = 0; i < defined.length; i += 1) {
			var entry = defined[i] || {};
			if (typeof entry.name === 'string' && entry.name.toLowerCase() === name.toLowerCase() && isObject(entry.composition)) {
				return entry.composition;
			}
		}
		return null;
	}

	/**
	 * Состав определяемых типов и характеристик типа — текстом для всплывающей подсказки (`title`) и
	 * доступного описания (`aria-description`) строки подсказки и ячейки «Тип». Сама подпись остаётся
	 * «ОпределяемыйТип.X»: колонка узкая, а в составе бывают десятки ссылок.
	 *
	 * Состав берётся из пришитых к типу записей (`compositions` — typeCompositions ответов md-sparrow
	 * cf-dcs-info и cf-md-query-tables), а если их нет — из словаря окна типа (`definedTypes[].composition`
	 * по UUID или по имени). Элементы — те же подписи, что у typePresentation; первые пять и «и ещё N».
	 * Один состав — «Состав: …»; несколько (тёзки разных наборов слиты в один тип) — по строке на каждый
	 * с именем типа.
	 *
	 * @param dto тип значения (valueType cf-dcs-info или тип поля cf-md-query-tables), можно с compositions
	 * @param dictionary ответ cf-dcs-type-dictionary или ничего
	 * @returns текст или пустая строка — состава нет (вне выгрузки, тип без определяемых типов)
	 */
	function compositionTitle(dto, dictionary) {
		var base = baseOf(dto);
		var index = dictionaryIndex(dictionary);
		var attached = attachedCompositions(dto);
		var sources = [];
		var seen = Object.create(null);
		function add(key, label, composition) {
			if (own(seen, key) || !isObject(composition)) {
				return;
			}
			seen[key] = true;
			var part = baseOf(composition);
			var labels = [];
			for (var i = 0; i < part.types.length; i += 1) {
				labels.push(typeLabel(part.types[i], part, index));
			}
			for (var j = 0; j < part.typeSets.length; j += 1) {
				labels.push(typeSetLabel(part.typeSets[j], index));
			}
			if (labels.length > 0) {
				sources.push({ label: label, items: labels });
			}
		}
		for (var s = 0; s < base.typeSets.length; s += 1) {
			var typeSet = base.typeSets[s];
			var defined = /^cfg:DefinedType\.(.+)$/.exec(typeSet);
			if (!defined && !/^cfg:Characteristic\./.test(typeSet)) {
				continue;
			}
			var key = typeSet.toLowerCase();
			add(key, typeSetLabel(typeSet, index), own(attached, key) || (defined ? definedCompositionByName(defined[1], dictionary) : null));
		}
		for (var t = 0; t < base.typeIds.length; t += 1) {
			var typeId = base.typeIds[t];
			var idKey = typeId.toLowerCase();
			var record = own(attached, idKey);
			var label = typeIdLabel(typeId, t, base, index);
			if (record && typeof record.name === 'string' && record.name !== '' && label.indexOf('ОпределяемыйТип.') !== 0) {
				// Имя из записи cf-dcs-info, когда в самом типе и в словаре его нет
				label = 'ОпределяемыйТип.' + record.name;
			}
			add(idKey, label, record || own(index.definedCompositions, idKey) || null);
		}
		var lines = [];
		for (var k = 0; k < sources.length; k += 1) {
			var items = sources[k].items;
			var shown = items.slice(0, COMPOSITION_TITLE_ITEMS).join(', ');
			var rest = items.length - COMPOSITION_TITLE_ITEMS;
			var text = shown + (rest > 0 ? ' и ещё ' + rest : '');
			lines.push(sources.length === 1 ? 'Состав: ' + text : 'Состав ' + sources[k].label + ': ' + text);
		}
		return lines.join('\n');
	}

	// ------------------------------------------------------------------ квалификаторы

	/**
	 * Квалификаторы, которые диалог ставит новому примитиву: самые частые в схемах БСП — строка
	 * длины 0 переменной длины, число 0,0 с любым знаком, дата «дата и время».
	 */
	function defaultQualifiers(type) {
		var kind = primitiveOf(type) ? primitiveOf(type).qualifiers : '';
		if (kind === 'string') {
			return { stringQualifiers: { length: '0', allowedLength: 'VARIABLE' } };
		}
		if (kind === 'number') {
			return { numberQualifiers: { digits: '0', fractionDigits: '0', allowedSign: 'ANY' } };
		}
		if (kind === 'date') {
			return { dateQualifiers: { dateFractions: 'DATE_TIME' } };
		}
		return {};
	}

	/** Квалификаторы только при своём типе: без типа md-sparrow отказывает в записи. */
	function alignQualifiers(base) {
		for (var i = 0; i < PRIMITIVES.length; i += 1) {
			var primitive = PRIMITIVES[i];
			if (!primitive.qualifiers) {
				continue;
			}
			var key = QUALIFIER_KEY[primitive.qualifiers];
			var present = base.types.indexOf(primitive.type) >= 0;
			if (present && !isObject(base[key])) {
				base[key] = defaultQualifiers(primitive.type)[key];
			} else if (!present && base[key] !== undefined) {
				delete base[key];
			}
		}
		return base;
	}

	function checkCount(errors, value, field, what) {
		if (value === undefined || value === null || value === '') {
			errors.push({ field: field, message: 'Не задано: ' + what + '.' });
			return NaN;
		}
		var count = countOf(value);
		if (isNaN(count)) {
			errors.push({ field: field, message: what.charAt(0).toUpperCase() + what.slice(1) + ': целое неотрицательное число.' });
		}
		return count;
	}

	function checkConstant(errors, value, field, what, allowed) {
		if (allowed.indexOf(constantOf(value)) < 0) {
			errors.push({ field: field, message: 'Не выбрано: ' + what + '.' });
		}
	}

	/**
	 * Предел разрядности числа — тот же, что у отказа писателя md-sparrow: загрузка схемы в платформу 8.3.27
	 * (ibcmd) хранит разрядность 38, 39 и 64 как записана, а 65 молча обрезает до 64.
	 */
	var MAX_DIGITS = 64;

	/**
	 * Ошибки квалификаторов по правилам писателя md-sparrow: квалификатор только при своём типе,
	 * у строки, числа и даты — всегда, числа целые неотрицательные, разрядность не больше 64, дробная
	 * часть не больше разрядности. Пустой список — тип можно отправлять.
	 *
	 * Длину строки сверху не ограничивает ни окно, ни писатель: загрузка в платформу хранит и 100000
	 * переменной длины, и 1025 фиксированной.
	 *
	 * @returns {{field: string, message: string}[]} `field` — путь в DTO для подсветки поля диалога
	 */
	function validateQualifiers(dto) {
		var base = baseOf(dto);
		var errors = [];
		for (var i = 0; i < PRIMITIVES.length; i += 1) {
			var primitive = PRIMITIVES[i];
			if (!primitive.qualifiers) {
				continue;
			}
			var key = QUALIFIER_KEY[primitive.qualifiers];
			var present = base.types.indexOf(primitive.type) >= 0;
			if (present && !isObject(base[key])) {
				errors.push({ field: key, message: 'У типа «' + primitive.label + '» не заданы квалификаторы.' });
			} else if (!present && isObject(base[key])) {
				errors.push({ field: key, message: 'Квалификаторы заданы без типа «' + primitive.label + '».' });
			}
		}
		if (isObject(base.stringQualifiers)) {
			checkCount(errors, base.stringQualifiers.length, 'stringQualifiers.length', 'длина строки');
			checkConstant(errors, base.stringQualifiers.allowedLength, 'stringQualifiers.allowedLength',
				'допустимая длина строки', ['VARIABLE', 'FIXED']);
		}
		if (isObject(base.numberQualifiers)) {
			var digits = checkCount(errors, base.numberQualifiers.digits, 'numberQualifiers.digits', 'разрядность числа');
			if (!isNaN(digits) && digits > MAX_DIGITS) {
				errors.push({
					field: 'numberQualifiers.digits',
					message: 'Разрядность числа (' + digits + ') больше ' + MAX_DIGITS + ': платформа сохранит только ' + MAX_DIGITS + ' разряда.',
				});
			}
			var fraction = checkCount(errors, base.numberQualifiers.fractionDigits, 'numberQualifiers.fractionDigits',
				'дробная часть числа');
			if (!isNaN(digits) && !isNaN(fraction) && fraction > digits) {
				errors.push({
					field: 'numberQualifiers.fractionDigits',
					message: 'Дробная часть числа (' + fraction + ') больше разрядности (' + digits + ').',
				});
			}
			checkConstant(errors, base.numberQualifiers.allowedSign, 'numberQualifiers.allowedSign',
				'допустимый знак числа', ['ANY', 'NONNEGATIVE']);
		}
		if (isObject(base.dateQualifiers)) {
			checkConstant(errors, base.dateQualifiers.dateFractions, 'dateQualifiers.dateFractions',
				'состав даты', ['DATE', 'TIME', 'DATE_TIME']);
		}
		if (isObject(base.binaryDataQualifiers)) {
			errors.push({ field: 'binaryDataQualifiers', message: 'Квалификаторы двоичных данных правятся в конфигураторе.' });
		}
		return errors;
	}

	// ------------------------------------------------------------------ флажок в дереве типов

	function withoutItem(list, value, caseless) {
		var out = [];
		for (var i = 0; i < list.length; i += 1) {
			var same = caseless ? list[i].toLowerCase() === value.toLowerCase() : list[i] === value;
			if (!same) {
				out.push(list[i]);
			}
		}
		return out;
	}

	function containsItem(list, value, caseless) {
		return withoutItem(list, value, caseless).length !== list.length;
	}

	/**
	 * Флажок элемента дерева типов: отмеченный снимается, неотмеченный ставится.
	 *
	 * - Без «Составного типа» (`composite` = false) поставленный элемент остаётся единственным —
	 *   как радиокнопка, только снять отметку тоже можно (пустой тип снимает `valueType`).
	 * - В составном новый элемент дописывается в конец своего списка: порядок прочитанных
	 *   сохраняется, потому что канонический порядок платформы неизвестен, а перестановка —
	 *   это лишняя правка файла.
	 * - Определяемый тип взаимоисключающий: он вытесняет остальные и вытесняется ими (в
	 *   составном типе платформа его не пишет).
	 * - Новый примитив получает квалификаторы по умолчанию, снятый — теряет свои.
	 * - Тип вне белого словаря (`editable: false`) правится только в конфигураторе: DTO
	 *   возвращается без изменений.
	 *
	 * @param type текст типа (`xs:string`, `cfg:CatalogRef.Валюты`, `cfg:CatalogRef`, `cfg:AnyIBRef`,
	 *   `cfg:Characteristic.X`), UUID или `{typeId, name}` определяемого типа
	 * @returns новый DTO без признаков `editable`/`readOnlyReason`
	 */
	function toggleType(dto, type, composite) {
		if (isObject(dto) && dto.editable === false) {
			return copyObject(dto);
		}
		var base = baseOf(dto);
		var list = typeListOf(type);
		var value = isObject(type) ? String(type.typeId || '').trim() : typeof type === 'string' ? type.trim() : '';
		if (list === '' || value === '') {
			return base;
		}
		var names = base.definedTypes && base.definedTypes.length === base.typeIds.length ? base.definedTypes : null;
		if (list === 'typeIds') {
			if (containsItem(base.typeIds, value, true)) {
				base.typeIds = withoutItem(base.typeIds, value, true);
				delete base.definedTypes;
			} else {
				var name = isObject(type) && typeof type.name === 'string' && type.name !== '' ? type.name : '';
				base.types = [];
				base.typeSets = [];
				base.typeIds = [value];
				if (name) {
					base.definedTypes = [name];
				} else {
					delete base.definedTypes;
				}
			}
			return alignQualifiers(base);
		}
		if (containsItem(base[list], value, false)) {
			base[list] = withoutItem(base[list], value, false);
		} else if (composite) {
			base[list] = base[list].concat([value]);
			base.typeIds = [];
		} else {
			base.types = [];
			base.typeSets = [];
			base.typeIds = [];
			base[list] = [value];
		}
		if (base.typeIds.length === 0 || !names) {
			delete base.definedTypes;
		}
		return alignQualifiers(base);
	}

	// ------------------------------------------------------------------ значение параметра

	function designTimeFits(text, base) {
		var parts = String(text || '').trim().split('.');
		if (parts.length < 2) {
			return false;
		}
		var kind = own(DESIGN_TIME_KINDS, parts[0]) || (own(REF_TYPE_NAMES, parts[0] + 'Ref') ? parts[0] : '');
		if (!kind || kind === 'BusinessProcessRoutePoint') {
			return false;
		}
		var refType = 'cfg:' + kind + 'Ref';
		return (
			base.types.indexOf(refType + '.' + parts[1]) >= 0 ||
			base.typeSets.indexOf(refType) >= 0 ||
			base.typeSets.indexOf('cfg:AnyIBRef') >= 0 ||
			base.typeSets.indexOf('cfg:AnyRef') >= 0
		);
	}

	function valueFits(value, base) {
		if (value === undefined || value === null) {
			return true;
		}
		if (typeof value === 'boolean') {
			return base.types.indexOf('xs:boolean') >= 0;
		}
		if (typeof value === 'number') {
			return base.types.indexOf('xs:decimal') >= 0;
		}
		if (typeof value === 'string') {
			return base.types.indexOf('xs:string') >= 0;
		}
		if (!isObject(value)) {
			return false;
		}
		if (value.nil === true) {
			return true;
		}
		if (value.type === 'v8:ValueListType') {
			var items = value.list && Array.isArray(value.list.items) ? value.list.items : [];
			for (var i = 0; i < items.length; i += 1) {
				if (!valueFits(items[i] ? items[i].value : null, base)) {
					return false;
				}
			}
			return true;
		}
		if (typeof value.type === 'string' && own(TYPED_VALUES, value.type)) {
			return base.types.indexOf(value.type) >= 0;
		}
		if (value.type === 'dcscor:DesignTimeValue') {
			return designTimeFits(value.text !== undefined ? value.text : value.decoded, base);
		}
		// Поле компоновки, значения вне словаря и значение без типа к новому типу не подходят
		return false;
	}

	/** Пустая строка без текста: `<value xsi:type="xs:string"/>`, в valueTyped — `{type: 'xs:string'}`. */
	function isEmptyString(value) {
		return (
			isObject(value) &&
			value.type === 'xs:string' &&
			(value.text === undefined || value.text === '') &&
			(value.decoded === undefined || value.decoded === '')
		);
	}

	/** Состав определяемого типа по UUID из словаря (без учёта регистра); нет словаря или состава — null. */
	function compositionOf(typeId, dictionary) {
		if (!isObject(dictionary) || typeof typeId !== 'string') {
			return null;
		}
		var composition = dictionaryIndex(dictionary).definedCompositions[typeId.trim().toLowerCase()];
		return composition ? baseOf(composition) : null;
	}

	/**
	 * Тип с раскрытым составом определяемых типов — как раскрывает его писатель md-sparrow перед
	 * сверкой значения: в схеме определяемый тип записан одним UUID, а состав лежит в описании
	 * определяемого типа, и без раскрытия к нему не подошло бы ничего, кроме «не задано». К своим
	 * `types` и `typeSets` дописываются `types` и `typeSets` состава каждого определяемого типа;
	 * определяемый тип без состава в словаре (словарь ещё не пришёл, описание не найдено) не
	 * раскрывается.
	 */
	function withCompositions(base, dictionary) {
		if (base.typeIds.length === 0) {
			return base;
		}
		var out = { types: base.types.slice(), typeSets: base.typeSets.slice(), typeIds: base.typeIds.slice() };
		for (var i = 0; i < base.typeIds.length; i += 1) {
			var composition = compositionOf(base.typeIds[i], dictionary);
			if (composition) {
				out.types = out.types.concat(composition.types);
				out.typeSets = out.typeSets.concat(composition.typeSets);
			}
		}
		return out;
	}

	/**
	 * Подходит ли значение параметра к типу — те же правила, что у писателя md-sparrow:
	 * без значения и `nil` — всегда; пустая строка — тоже всегда (так платформа хранит «значение
	 * не задано» и у параметров других типов — в БСП у параметра типа UUID); `xs:*`, стандартные
	 * период и дата начала, UUID — при том же типе; ссылка конфигуратора — при ссылке того же
	 * объекта, «любой ссылке вида» или «любой ссылке»; список значений — каждым элементом
	 * (правило пустой строки элементов списка не касается). Тип не задан — подходит всё.
	 *
	 * Определяемый тип сверяется по составу из словаря (`definedTypes[].composition` ответа
	 * cf-dcs-type-dictionary), как md-sparrow сверяет его по описанию в выгрузке. Без словаря или
	 * без состава к определяемому типу подходят только «не задано» и `nil` — диалог в худшем случае
	 * очистит значение, которое jar бы принял, но не пропустит то, от чего он откажется.
	 *
	 * @param valueDto Value, массив Value (как у параметров варианта) или скаляр
	 * @param dictionary ответ cf-dcs-type-dictionary или ничего
	 */
	function compatibleValue(dto, valueDto, dictionary) {
		var base = withCompositions(baseOf(dto), dictionary);
		if (isEmptyType(base) || isEmptyString(valueDto)) {
			return true;
		}
		if (Array.isArray(valueDto)) {
			for (var i = 0; i < valueDto.length; i += 1) {
				if (!valueFits(valueDto[i], base)) {
					return false;
				}
			}
			return true;
		}
		return valueFits(valueDto, base);
	}

	/** Русское имя вида для текста значения конфигуратора: обратная таблица DESIGN_TIME_KINDS. */
	function designTimeKindName(kind) {
		for (var name in DESIGN_TIME_KINDS) {
			if (Object.prototype.hasOwnProperty.call(DESIGN_TIME_KINDS, name) && DESIGN_TIME_KINDS[name] === kind) {
				return name;
			}
		}
		return '';
	}

	/**
	 * «Пустое значение типа» — форма, которую платформа пишет у параметров схем БСП:
	 * нулевая дата, `false`, пустая строка, 0, произвольный период с нулевыми границами, пустая
	 * ссылка объекта (`Справочник.X.ПустаяСсылка`). У составного типа и наборов ссылок одного
	 * пустого значения нет — `null`, то есть «без значения».
	 *
	 * Определяемый тип, состав которого в словаре — ровно один тип, получает пустое значение этого
	 * типа: значения состава платформа у таких параметров и хранит (число 0 у числового
	 * определяемого типа), а md-sparrow сверяет значение с тем же составом. Без словаря, без состава
	 * и при составе из нескольких типов — `null`.
	 *
	 * @param dictionary ответ cf-dcs-type-dictionary или ничего
	 * @returns Value для payload `value` или `null`
	 */
	function emptyValueFor(dto, dictionary) {
		var base = baseOf(dto);
		if (base.types.length === 0 && base.typeSets.length === 0 && base.typeIds.length === 1) {
			var composition = compositionOf(base.typeIds[0], dictionary);
			// Состав определяемого типа сам определяемых типов не содержит (их typeIds пуст), поэтому
			// раскрытие одноуровневое и не зацикливается
			return composition && composition.typeIds.length === 0 ? emptyValueFor(composition) : null;
		}
		if (base.types.length !== 1 || base.typeSets.length > 0 || base.typeIds.length > 0) {
			return null;
		}
		var type = base.types[0];
		if (type === 'xs:string') {
			return { type: 'xs:string', text: '' };
		}
		if (type === 'xs:boolean') {
			return { type: 'xs:boolean', text: 'false' };
		}
		if (type === 'xs:decimal') {
			return { type: 'xs:decimal', text: '0' };
		}
		if (type === 'xs:dateTime') {
			return { type: 'xs:dateTime', text: ZERO_DATE };
		}
		if (type === 'v8:StandardPeriod') {
			return { type: 'v8:StandardPeriod', period: { variant: 'Custom', startDate: ZERO_DATE, endDate: ZERO_DATE } };
		}
		if (type === 'v8:UUID') {
			return { type: 'v8:UUID', text: ZERO_UUID };
		}
		var ref = /^cfg:(\w+)Ref\.(.+)$/.exec(type);
		var kindName = ref ? designTimeKindName(ref[1]) : '';
		if (kindName) {
			return { type: 'dcscor:DesignTimeValue', text: kindName + '.' + ref[2] + '.ПустаяСсылка' };
		}
		return null;
	}

	// ------------------------------------------------------------------ сравнение

	function sameList(a, b, caseless) {
		if (a.length !== b.length) {
			return false;
		}
		for (var i = 0; i < a.length; i += 1) {
			var same = caseless ? a[i].toLowerCase() === b[i].toLowerCase() : a[i] === b[i];
			if (!same) {
				return false;
			}
		}
		return true;
	}

	function sameCount(a, b) {
		var left = countOf(a);
		var right = countOf(b);
		if (isNaN(left) || isNaN(right)) {
			return String(a === undefined || a === null ? '' : a).trim() === String(b === undefined || b === null ? '' : b).trim();
		}
		return left === right;
	}

	function sameQualifier(a, b, counts, constants) {
		if (!isObject(a) || !isObject(b)) {
			return !isObject(a) && !isObject(b);
		}
		for (var i = 0; i < counts.length; i += 1) {
			if (!sameCount(a[counts[i]], b[counts[i]])) {
				return false;
			}
		}
		for (var j = 0; j < constants.length; j += 1) {
			if (constantOf(a[constants[j]]) !== constantOf(b[constants[j]])) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Одинаковы ли типы по смыслу — решение «слать ли payload»: те же элементы в том же порядке
	 * (перестановка — правка файла) и те же квалификаторы, числа сравниваются числами (`"0"` из
	 * файла и `0` из поля ввода — одно), константы — без разницы между `DateTime` и `DATE_TIME`.
	 * Подписи определяемых типов и признаки только-чтения не сравниваются. Так же решает
	 * md-sparrow, поэтому «одинаковый» тип и в jar был бы эхом.
	 */
	function sameType(a, b) {
		var left = baseOf(a);
		var right = baseOf(b);
		if (isEmptyType(left) || isEmptyType(right)) {
			return isEmptyType(left) && isEmptyType(right);
		}
		return (
			sameList(left.types, right.types, false) &&
			sameList(left.typeSets, right.typeSets, false) &&
			sameList(left.typeIds, right.typeIds, true) &&
			sameQualifier(left.stringQualifiers, right.stringQualifiers, ['length'], ['allowedLength']) &&
			sameQualifier(left.numberQualifiers, right.numberQualifiers, ['digits', 'fractionDigits'], ['allowedSign']) &&
			sameQualifier(left.dateQualifiers, right.dateQualifiers, [], ['dateFractions']) &&
			sameQualifier(left.binaryDataQualifiers, right.binaryDataQualifiers, ['length'], ['allowedLength'])
		);
	}

	// ------------------------------------------------------------------ дерево окна типа

	/** Отмечен ли элемент дерева в типе: UUID определяемого типа — без учёта регистра. */
	function hasType(dto, type) {
		var base = baseOf(dto);
		var list = typeListOf(type);
		var value = isObject(type) ? String(type.typeId || '').trim() : typeof type === 'string' ? type.trim() : '';
		if (list === '' || value === '') {
			return false;
		}
		return containsItem(base[list], value, list === 'typeIds');
	}

	function matches(query, texts) {
		if (query === '') {
			return true;
		}
		for (var i = 0; i < texts.length; i += 1) {
			if (typeof texts[i] === 'string' && texts[i].toLowerCase().indexOf(query) >= 0) {
				return true;
			}
		}
		return false;
	}

	/** Строки узла под поиск: совпало имя узла — все строки, иначе только совпавшие. */
	function filteredNode(node, query, nodeTexts) {
		var all = node.rows;
		if (query === '' || matches(query, nodeTexts)) {
			node.total = all.length;
			return node;
		}
		var rows = [];
		for (var i = 0; i < all.length; i += 1) {
			if (matches(query, [all[i].label, all[i].search])) {
				rows.push(all[i]);
			}
		}
		if (rows.length === 0) {
			return null;
		}
		node.rows = rows;
		node.total = all.length;
		// Совпавшие строки внутри свёрнутого узла иначе не увидеть: поиск раскрывает узел
		node.open = true;
		return node;
	}

	/**
	 * Дерево окна «Тип значения» по словарю cf-dcs-type-dictionary и строке поиска.
	 *
	 * Узлы в порядке окна: «Примитивные», «Любая ссылка» (строка-узел), виды ссылок с набором
	 * «любая ссылка вида» (`typeSet`) и объектами, «Характеристики», «Определяемые типы». Пустые
	 * узлы не выводятся. Поиск — подстрока без учёта регистра по подписи и полному имени типа;
	 * узел с совпавшими строками помечается `open`, чтобы их было видно без раскрытия вручную.
	 * Без словаря (ещё грузится или не прочитан) — только примитивы: их писатель примет всегда.
	 *
	 * @returns `[{key, label, kind: 'group'|'kind'|'row', rows: [{value, label}], typeSet?, value?,
	 *   total, open?}]`; у строки `value` — то, что принимает toggleType
	 */
	function typeTree(dictionary, query) {
		var q = typeof query === 'string' ? query.trim().toLowerCase() : '';
		var dict = isObject(dictionary) ? dictionary : {};
		var out = [];
		var primitives = Array.isArray(dict.primitives) && dict.primitives.length > 0 ? dict.primitives : PRIMITIVES;
		var primitiveRows = [];
		for (var i = 0; i < primitives.length; i += 1) {
			var primitive = primitives[i] || {};
			if (typeof primitive.type === 'string' && primitive.type !== '') {
				primitiveRows.push({ value: primitive.type, label: primitive.label || primitive.type, search: primitive.type });
			}
		}
		var group = filteredNode({ key: 'primitives', label: 'Примитивные', kind: 'group', rows: primitiveRows }, q, ['Примитивные']);
		if (group) {
			out.push(group);
		}
		if (typeof dict.anyRef === 'string' && dict.anyRef !== '' && matches(q, ['Любая ссылка', dict.anyRef])) {
			out.push({ key: 'anyRef', label: 'Любая ссылка', kind: 'row', value: dict.anyRef, rows: [], total: 0 });
		}
		var kinds = Array.isArray(dict.refKinds) ? dict.refKinds : [];
		for (var k = 0; k < kinds.length; k += 1) {
			var kind = kinds[k] || {};
			if (typeof kind.typeSet !== 'string' || kind.typeSet === '') {
				continue;
			}
			var platformName = kind.platformName;
			var rows = [];
			var types = Array.isArray(kind.types) ? kind.types : [];
			for (var t = 0; t < types.length; t += 1) {
				if (typeof types[t] !== 'string') {
					continue;
				}
				var name = types[t].slice(kind.typeSet.length + 1);
				rows.push({ value: types[t], label: name, search: platformName + '.' + name });
			}
			var node = filteredNode(
				{ key: 'kind:' + kind.kind, label: kind.label, kind: 'kind', typeSet: kind.typeSet, platformName: platformName, rows: rows },
				q,
				[kind.label, platformName, kind.kind]
			);
			if (node) {
				out.push(node);
			}
		}
		var characteristics = Array.isArray(dict.characteristics) ? dict.characteristics : [];
		var charRows = [];
		for (var c = 0; c < characteristics.length; c += 1) {
			if (typeof characteristics[c] === 'string') {
				var charName = characteristics[c].replace(/^cfg:Characteristic\./, '');
				charRows.push({ value: characteristics[c], label: charName, search: 'Характеристика.' + charName });
			}
		}
		if (charRows.length > 0) {
			var chars = filteredNode({ key: 'characteristics', label: 'Характеристики', kind: 'group', rows: charRows }, q, ['Характеристики']);
			if (chars) {
				out.push(chars);
			}
		}
		var defined = Array.isArray(dict.definedTypes) ? dict.definedTypes : [];
		var definedRows = [];
		for (var d = 0; d < defined.length; d += 1) {
			var entry = defined[d] || {};
			if (typeof entry.typeId === 'string' && typeof entry.name === 'string') {
				definedRows.push({ value: { typeId: entry.typeId, name: entry.name }, label: entry.name, search: 'ОпределяемыйТип.' + entry.name });
			}
		}
		if (definedRows.length > 0) {
			var definedNode = filteredNode({ key: 'defined', label: 'Определяемые типы', kind: 'group', rows: definedRows }, q, ['Определяемые типы']);
			if (definedNode) {
				out.push(definedNode);
			}
		}
		return out;
	}

	// ------------------------------------------------------------------ payload правки

	/**
	 * Умолчания признаков параметра: md-sparrow пишет умолчание снятием элемента, поэтому
	 * отсутствие признака в cf-dcs-info значит именно его. Платформа (8.3.27) явные умолчания
	 * признаков тоже не выгружает.
	 */
	var PARAMETER_FLAG_DEFAULTS = { valueListAllowed: false, availableAsField: true, denyIncompleteValues: false };

	var PARAMETER_FLAGS = ['valueListAllowed', 'availableAsField', 'denyIncompleteValues'];

	/**
	 * Тип для payload: списки и квалификаторы. Имена определяемых типов не уходят: адрес типа —
	 * UUID, а лишнее имя jar сверял бы с ним и мог отказать на расхождении подписи. Пустой тип —
	 * `null`, то есть снять `valueType` (пустого элемента платформа не пишет).
	 */
	function payloadType(dto) {
		var base = baseOf(dto);
		delete base.definedTypes;
		return isEmptyType(base) ? null : base;
	}

	/**
	 * Что станет со значением параметра при новом типе.
	 *
	 * @param value `valueTyped` из cf-dcs-info; undefined — значения в файле нет
	 * @param dictionary ответ cf-dcs-type-dictionary: по нему сверяется и очищается значение
	 *   определяемого типа (compatibleValue, emptyValueFor); без словаря — консервативно
	 * @returns null — значение остаётся (его нет или оно подходит); `{value}` — заменяется пустым
	 *   значением типа (emptyValueFor) или снимается (`value: null` у составного типа и наборов);
	 *   `{blocked: true}` — значение вне белого списка записи: заменить его md-sparrow не даст
	 */
	function valueClearing(dto, value, dictionary) {
		if (value === undefined || value === null || compatibleValue(dto, value, dictionary)) {
			return null;
		}
		if (isObject(value) && value.opaque === true) {
			return { blocked: true };
		}
		return { value: emptyValueFor(dto, dictionary) };
	}

	function flagOf(source, key) {
		return typeof source[key] === 'boolean' ? source[key] : PARAMETER_FLAG_DEFAULTS[key];
	}

	/**
	 * payload правки по итогу диалога типа: только изменённое, как у остальных диалогов
	 * редактора, — пустой payload значит «закрыть без записи».
	 *
	 * - `valueType` — когда тип отличается от прочитанного по sameType; пустой тип — `null`.
	 * - `value` — когда тип сменился, а записанное значение к нему не подходит: без `value` в том
	 *   же payload md-sparrow откажет, поэтому значение очищается до пустого значения нового типа,
	 *   у составного типа и наборов ссылок — снимается.
	 * - Признаки параметра — когда отличаются от прочитанных с учётом умолчаний.
	 *
	 * @param original прочитанное у владельца: `{valueType?, value?, valueListAllowed?,
	 *   availableAsField?, denyIncompleteValues?}`, `value` — `valueTyped` из cf-dcs-info
	 * @param edited итог диалога с теми же ключами (кроме `value`); undefined у ключа — не трогали
	 * @param dictionary ответ cf-dcs-type-dictionary (состав определяемых типов для valueClearing)
	 * @returns `{payload, valueChange, error?, errors?}`: `valueChange` — итог valueClearing для
	 *   предупреждения в диалоге; `error` — первая причина, по которой слать правку нельзя
	 */
	function typeEditPayload(original, edited, dictionary) {
		var src = isObject(original) ? original : {};
		var next = isObject(edited) ? edited : {};
		var payload = {};
		var valueChange = null;
		if (next.valueType !== undefined && !sameType(src.valueType, next.valueType)) {
			if (isObject(src.valueType) && src.valueType.editable === false) {
				// Только-чтение снимает с типа и правку снятием: байты вне словаря переносит только эхо;
				// причину md-sparrow пишет у каждого такого типа
				return { payload: {}, valueChange: null, error: 'Тип правится в конфигураторе: ' + src.valueType.readOnlyReason };
			}
			var errors = validateQualifiers(next.valueType);
			if (errors.length > 0) {
				return { payload: {}, valueChange: null, error: errors[0].message, errors: errors };
			}
			payload.valueType = payloadType(next.valueType);
			valueChange = valueClearing(next.valueType, src.value, dictionary);
			if (valueChange && valueChange.blocked) {
				return {
					payload: {},
					valueChange: valueChange,
					error: 'Значение параметра правится в конфигураторе: к новому типу его здесь не привести.',
				};
			}
			if (valueChange) {
				payload.value = valueChange.value;
			}
		}
		for (var i = 0; i < PARAMETER_FLAGS.length; i += 1) {
			var key = PARAMETER_FLAGS[i];
			if (typeof next[key] === 'boolean' && next[key] !== flagOf(src, key)) {
				payload[key] = next[key];
			}
		}
		return { payload: payload, valueChange: valueChange };
	}

	var api = {
		PRIMITIVES: PRIMITIVES,
		MAX_DIGITS: MAX_DIGITS,
		PARAMETER_FLAG_DEFAULTS: PARAMETER_FLAG_DEFAULTS,
		isEmptyType: isEmptyType,
		typeListOf: typeListOf,
		typeItems: typeItems,
		typePresentation: typePresentation,
		compositionTitle: compositionTitle,
		toggleType: toggleType,
		defaultQualifiers: defaultQualifiers,
		validateQualifiers: validateQualifiers,
		compatibleValue: compatibleValue,
		emptyValueFor: emptyValueFor,
		sameType: sameType,
		hasType: hasType,
		typeTree: typeTree,
		payloadType: payloadType,
		valueClearing: valueClearing,
		typeEditPayload: typeEditPayload,
	};
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
	if (root) {
		root.DcsTypes = api;
	}
})(typeof window === 'undefined' ? globalThis : window);
