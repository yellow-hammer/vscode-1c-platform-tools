/**
 * Переменные среды, которые читает код OneScript проекта.
 *
 * Имя переменной берётся только из строкового литерала, который передан:
 * - встроенной функции `ПолучитьПеременнуюСреды` (`GetEnvironmentVariable`);
 * - привязке опции библиотеки cli к окружению: текучему методу
 *   `Опция.ВОкружении("ИМЯ")` или аннотации `&ВОкружении("ИМЯ")` из
 *   autumn-cli; несколько имён в ней пишутся через пробел;
 * - обёртке над ними: методу, который передаёт свой параметр в чтение или в
 *   другую обёртку и сам этот параметр не присваивает.
 *
 * Вызов обёртки указывает на объявление однозначно: без квалификатора — метод
 * того же файла, через имя модуля — метод модуля (`Модуль.Метод`). Прочие
 * вызовы методов объектов и имена, собранные выражением, не распознаются: они
 * известны только при выполнении.
 *
 * Модуль чистый (без vscode/fs).
 */

import { isPunct, lowerName, readList, tokenize, type Token } from './oneScriptLexer';

/** Исходный текст файла проекта. */
export interface SourceFile {
	/** Имя модуля, под которым файл доступен другим файлам; у сценариев и классов его нет */
	moduleName?: string;
	/** Текст файла */
	text: string;
}

/** Вызов `Квалификатор.Метод(аргументы)` или `Метод(аргументы)`. */
interface Call {
	/** Имя модуля в нижнем регистре; `OBJECT_CALL` — вызов метода объекта */
	qualifier?: string;
	/** Имя метода в нижнем регистре */
	name: string;
	/** Токены аргументов */
	args: Token[][];
}

interface Method {
	/** Параметры в нижнем регистре, по порядку */
	params: string[];
	/** Имена, которым метод присваивает значение */
	assigned: Set<string>;
	calls: Call[];
}

interface ParsedFile {
	moduleName?: string;
	/** Методы по имени в нижнем регистре */
	methods: Map<string, Method>;
	/** Вызовы вне методов: тело сценария */
	topLevelCalls: Call[];
	/** Строки аннотаций `&ВОкружении("…")` */
	bindings: string[];
}

/** Где у вызова имя переменной: позиция аргумента и список ли это имён через пробел. */
interface NameArgument {
	position: number;
	list: boolean;
}

/** Квалификатор вызова метода объекта: `Объект.Метод()`, `Функция().Метод()` */
const OBJECT_CALL = '\0object';

const READERS = new Set(['получитьпеременнуюсреды', 'getenvironmentvariable']);
/** Привязка опции cli к переменным окружения: `ВОкружении("ИМЯ ИМЯ2")` */
const BINDING = 'вокружении';
const DECLARATIONS = new Set(['процедура', 'функция', 'procedure', 'function']);
const DECLARATION_ENDS = new Set(['конецпроцедуры', 'конецфункции', 'endprocedure', 'endfunction']);
const BY_VALUE = new Set(['знач', 'val']);
const CONSTRUCTORS = new Set(['новый', 'new']);
/** После этих слов начинается оператор: `Имя = …` здесь — присваивание */
const STATEMENT_STARTS = new Set([
	'экспорт', 'тогда', 'иначе', 'цикл', 'попытка', 'исключение', 'для',
	'export', 'then', 'else', 'do', 'try', 'except', 'for',
]);
/** Переменная цикла `Для Каждого Имя Из` */
const EACH = new Set(['каждого', 'each']);

const VARIABLE_NAME = /^[^\s=]+$/;

/** Имя параметра из его объявления: без аннотаций, `Знач` и значения по умолчанию. */
function parameterName(declaration: Token[]): string {
	let index = 0;
	while (isPunct(declaration[index], '&')) {
		index += 2;
		if (isPunct(declaration[index], '(')) {
			index = readList(declaration, index + 1).end + 1;
		}
	}
	if (BY_VALUE.has(lowerName(declaration[index]) ?? '')) {
		index += 1;
	}
	return lowerName(declaration[index]) ?? '';
}

/** Квалификатор вызова по лексемам перед именем метода. */
function qualifierOf(tokens: Token[], nameAt: number): string | undefined {
	if (!isPunct(tokens[nameAt - 1], '.')) {
		return undefined;
	}
	const owner = lowerName(tokens[nameAt - 2]);
	return owner !== undefined && !isPunct(tokens[nameAt - 3], '.') ? owner : OBJECT_CALL;
}

/**
 * Строка аннотации: первый параметр, позиционный (`&А("…")`) или именованный (`&А(Значение = "…")`).
 *
 * @param tokens - Лексемы
 * @param openAt - Позиция открывающей скобки аннотации
 */
function annotationString(tokens: Token[], openAt: number): string | undefined {
	const [first] = readList(tokens, openAt + 1).items;
	const literal = first?.length === 3 && isPunct(first[1], '=') ? first[2] : first?.length === 1 ? first[0] : undefined;
	return literal?.kind === 'string' ? literal.value : undefined;
}

function parseFile(file: SourceFile): ParsedFile {
	const tokens = tokenize(file.text);
	const methods = new Map<string, Method>();
	const topLevelCalls: Call[] = [];
	const bindings: string[] = [];
	let current: Method | undefined;
	let statementStart = true;
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		const name = lowerName(token);
		if (name !== undefined) {
			const declared = lowerName(tokens[index + 1]);
			if (current === undefined && DECLARATIONS.has(name) && declared !== undefined && isPunct(tokens[index + 2], '(')) {
				const params = readList(tokens, index + 3);
				current = { params: params.items.map(parameterName), assigned: new Set(), calls: [] };
				methods.set(declared, current);
				index = params.end;
				statementStart = true;
				continue;
			}
			if (current !== undefined && DECLARATION_ENDS.has(name)) {
				current = undefined;
				statementStart = true;
				continue;
			}
			if (current !== undefined && ((statementStart && isPunct(tokens[index + 1], '=')) || EACH.has(lowerName(tokens[index - 1]) ?? ''))) {
				current.assigned.add(name);
			}
			const previous = tokens[index - 1];
			if (isPunct(previous, '&')) {
				const value = name === BINDING && isPunct(tokens[index + 1], '(') ? annotationString(tokens, index + 1) : undefined;
				if (value !== undefined) {
					bindings.push(value);
				}
			} else if (isPunct(tokens[index + 1], '(') && !CONSTRUCTORS.has(lowerName(previous) ?? '')) {
				// Вложенные вызовы в аргументах находит тот же обход
				(current?.calls ?? topLevelCalls).push({
					qualifier: qualifierOf(tokens, index),
					name,
					args: readList(tokens, index + 2).items,
				});
			}
		}
		statementStart = isPunct(token, ';') || STATEMENT_STARTS.has(name ?? '');
	}
	return { moduleName: file.moduleName?.toLowerCase(), methods, topLevelCalls, bindings };
}

/** На что указывает вызов: встроенное чтение, привязка опции cli или объявление в файле. */
type Target = { kind: 'read' } | { kind: 'binding' } | { kind: 'method'; file: number; method: string };

const READ_ARGUMENTS: readonly NameArgument[] = [{ position: 0, list: false }];
const BINDING_ARGUMENTS: readonly NameArgument[] = [{ position: 0, list: true }];

/**
 * Переменные среды, которые читает код файлов проекта.
 *
 * @param files - Файлы OneScript проекта с именами модулей
 * @returns Имена переменных по алфавиту
 */
export function environmentVariablesInCode(files: readonly SourceFile[]): string[] {
	const parsed = files.map(parseFile);
	const modules = new Map<string, number>();
	parsed.forEach((file, index) => {
		if (file.moduleName !== undefined && !modules.has(file.moduleName)) {
			modules.set(file.moduleName, index);
		}
	});

	const resolve = (call: Call, fileIndex: number): Target | undefined => {
		if (call.qualifier === undefined) {
			if (parsed[fileIndex].methods.has(call.name)) {
				return { kind: 'method', file: fileIndex, method: call.name };
			}
			return READERS.has(call.name) ? { kind: 'read' } : undefined;
		}
		const moduleIndex = call.qualifier === OBJECT_CALL ? undefined : modules.get(call.qualifier);
		if (moduleIndex !== undefined && parsed[moduleIndex].methods.has(call.name)) {
			return { kind: 'method', file: moduleIndex, method: call.name };
		}
		// Текучий метод опции cli: Команда.Опция(…).ВОкружении("ИМЯ")
		return call.name === BINDING ? { kind: 'binding' } : undefined;
	};

	// Обёртка: параметры, которые метод передаёт в чтение или привязку, по позиции
	const wrappers = new Map<string, Map<number, boolean>>();
	const nameArguments = (target: Target): readonly NameArgument[] => {
		switch (target.kind) {
			case 'read':
				return READ_ARGUMENTS;
			case 'binding':
				return BINDING_ARGUMENTS;
			case 'method':
				return [...(wrappers.get(`${target.file}:${target.method}`) ?? [])].map(([position, list]) => ({ position, list }));
			default: {
				const unknown: never = target;
				throw new Error(`Неизвестная цель вызова: ${JSON.stringify(unknown)}`);
			}
		}
	};

	let changed = true;
	while (changed) {
		changed = false;
		parsed.forEach((file, fileIndex) => {
			for (const [methodName, method] of file.methods) {
				for (const call of method.calls) {
					const target = resolve(call, fileIndex);
					for (const { position, list } of target ? nameArguments(target) : []) {
						const argument = call.args[position];
						const passed = argument?.length === 1 ? lowerName(argument[0]) : undefined;
						const parameter = passed === undefined || method.assigned.has(passed) ? -1 : method.params.indexOf(passed);
						if (parameter < 0) {
							continue;
						}
						const key = `${fileIndex}:${methodName}`;
						const positions = wrappers.get(key) ?? new Map<number, boolean>();
						if (!positions.has(parameter)) {
							positions.set(parameter, list);
							wrappers.set(key, positions);
							changed = true;
						}
					}
				}
			}
		});
	}

	const names = new Set<string>();
	const add = (value: string, list: boolean): void => {
		for (const name of list ? value.split(/\s+/) : [value]) {
			if (VARIABLE_NAME.test(name)) {
				names.add(name);
			}
		}
	};
	parsed.forEach((file, fileIndex) => {
		for (const value of file.bindings) {
			add(value, true);
		}
		const calls = [...file.topLevelCalls, ...[...file.methods.values()].flatMap((method) => method.calls)];
		for (const call of calls) {
			const target = resolve(call, fileIndex);
			for (const { position, list } of target ? nameArguments(target) : []) {
				const argument = call.args[position];
				if (argument?.length === 1 && argument[0].kind === 'string') {
					add(argument[0].value, list);
				}
			}
		}
	});
	return [...names].sort((a, b) => a.localeCompare(b));
}
