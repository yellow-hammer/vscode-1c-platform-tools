/**
 * Читает декларации БСП из исходного кода, не запуская встроенный язык.
 * @module bspVersions
 */

import { isPunct, lowerName, readList, tokenize, type Token } from '../../shared/oneScriptLexer';
import { BSP_REGISTRATION_MARKER } from './bspRegistration';

const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_]*$/u;

function method(source: string, name: string, kind: 'procedure' | 'function') {
	const starts = kind === 'procedure' ? ['procedure', 'процедура'] : ['function', 'функция'];
	const ends = kind === 'procedure' ? ['endprocedure', 'конецпроцедуры'] : ['endfunction', 'конецфункции'];
	const tokens = tokenize(source);
	const methodName = name.toLowerCase();
	const start = tokens.findIndex((token, i) =>
		starts.includes(lowerName(token) ?? '') && lowerName(tokens[i + 1]) === methodName && isPunct(tokens[i + 2], '('));
	if (start === -1) {
		return undefined;
	}
	const { items: [first = []], end: closing } = readList(tokens, start + 3);
	const end = tokens.findIndex((token, i) => i > closing && ends.includes(lowerName(token) ?? ''));
	if (end === -1) {
		return undefined;
	}
	const byValue = ['знач', 'val'].includes(lowerName(first[0]) ?? '');
	const parameter = lowerName(first[byValue ? 1 : 0]);
	const exported = ['экспорт', 'export'].includes(lowerName(tokens[closing + 1]) ?? '');
	return { parameter, body: tokens.slice(closing + (exported ? 2 : 1), end) };
}

const STATEMENT_BOUNDARIES = new Set(['тогда', 'then', 'иначе', 'else', 'цикл', 'do', 'попытка', 'try', 'исключение', 'except']);

function* statements(body: readonly Token[]): Iterable<Token[]> {
	let start = 0;
	for (let i = 0; i < body.length; i++) {
		if (isPunct(body[i], ';') || STATEMENT_BOUNDARIES.has(lowerName(body[i]) ?? '')) {
			yield body.slice(start, i);
			start = i + 1;
		}
	}
	yield body.slice(start);
}

function literal(tokens: readonly Token[]): string | undefined {
	return tokens.length === 1 && tokens[0]?.kind === 'string' ? tokens[0].value.trim() || undefined : undefined;
}

/** Имена общих модулей, явно зарегистрированные в ПриДобавленииПодсистем. */
export function registeredSubsystemModules(source: string): string[] {
	const registration = method(source, 'ПриДобавленииПодсистем', 'procedure');
	if (!registration?.parameter) {
		return [];
	}
	const modules: string[] = [];
	for (const [receiver, dot, add, open, name, close, ...rest] of statements(registration.body)) {
		if (lowerName(receiver) === registration.parameter && isPunct(dot, '.') && ['добавить', 'add'].includes(lowerName(add) ?? '')
			&& isPunct(open, '(') && isPunct(close, ')') && rest.length === 0) {
			const moduleName = literal([name]);
			if (moduleName && IDENTIFIER.test(moduleName)) {
				modules.push(moduleName);
			}
		}
	}
	return modules;
}

interface BspVersionFunction {
	readonly module?: string;
	readonly method: string;
}

export interface BspLibraryDeclaration {
	readonly name: string;
	readonly version?: string | BspVersionFunction;
}

function versionFunction(tokens: readonly Token[]): BspVersionFunction | undefined {
	const owner = lowerName(tokens[0]);
	if (!owner || !isPunct(tokens.at(-2), '(') || !isPunct(tokens.at(-1), ')')) {
		return undefined;
	}
	if (tokens.length === 3) {
		return { method: owner };
	}
	const method = lowerName(tokens[2]);
	return tokens.length === 5 && isPunct(tokens[1], '.') && method ? { module: owner, method } : undefined;
}

/** Имя и версия из присваиваний параметру ПриДобавленииПодсистемы. */
export function bspLibraryDeclaration(source: string): BspLibraryDeclaration | undefined {
	const registration = method(source, 'ПриДобавленииПодсистемы', 'procedure');
	if (!registration?.parameter) {
		return undefined;
	}
	let name: string | undefined;
	let version: BspLibraryDeclaration['version'];
	for (const [receiver, dot, property, equals, ...value] of statements(registration.body)) {
		if (lowerName(receiver) !== registration.parameter || !isPunct(dot, '.') || !isPunct(equals, '=')) {
			continue;
		}
		switch (lowerName(property)) {
			case 'имя':
				name = literal(value);
				break;
			case 'версия':
				// В типовых библиотеках версия также бывает вынесена в функцию общего модуля.
				version = literal(value) ?? versionFunction(value);
				break;
		}
	}
	return name ? { name, version } : undefined;
}

function isReturn(name: string | undefined): boolean {
	return name === 'возврат' || name === 'return';
}

/** Версия из вспомогательной функции, состоящей из возврата строкового литерала. */
export function bspVersionFunctionValue(source: string, name: string): string | undefined {
	const declaration = method(source, name, 'function');
	if (!declaration) {
		return undefined;
	}
	const [keyword, value, terminator, ...rest] = declaration.body;
	return isReturn(lowerName(keyword)) && (terminator === undefined || isPunct(terminator, ';')) && rest.length === 0
		? literal([value])
		: undefined;
}

function structureVersion(tokens: Token[], valueOf: (value: readonly Token[]) => string | undefined): string | undefined {
	const [keyword, type, open] = tokens;
	if (!['новый', 'new'].includes(lowerName(keyword) ?? '')
		|| !['структура', 'structure'].includes(lowerName(type) ?? '') || !isPunct(open, '(')) {
		return undefined;
	}
	const { items: [keys, ...values], end } = readList(tokens, 3);
	if (!keys || end !== tokens.length - 1 || !isPunct(tokens[end], ')')) {
		return undefined;
	}
	const index = literal(keys)?.toLowerCase().split(',').findIndex((key) => key.trim() === 'версия');
	return index !== undefined && values[index] ? valueOf(values[index]) : undefined;
}

/** Версия из структуры, возвращаемой функцией регистрации внешнего объекта. */
export function bspExternalVersion(source: string): string | undefined {
	const registration = method(source, BSP_REGISTRATION_MARKER, 'function');
	if (!registration) {
		return undefined;
	}
	const variables = new Map<string, string | undefined>();
	const versions = new Map<string, string | undefined>();
	const returned = new Set<string | undefined>();
	const valueOf = (value: readonly Token[]) =>
		literal(value) ?? (value.length === 1 ? variables.get(lowerName(value[0]) ?? '') : undefined);
	const versionOf = (value: Token[]) =>
		value.length === 1 ? versions.get(lowerName(value[0]) ?? '') : structureVersion(value, valueOf);
	for (const [first, ...tail] of statements(registration.body)) {
		const name = lowerName(first);
		if (!name) {
			continue;
		}
		const [operator, property, next, ...value] = tail;
		if (isReturn(name)) {
			returned.add(versionOf(tail));
		} else if (isPunct(operator, '=')) {
			const expression = tail.slice(1);
			const scalar = valueOf(expression);
			const version = versionOf(expression);
			variables.set(name, scalar);
			versions.set(name, version);
		} else if (isPunct(operator, '.') && lowerName(property) === 'версия' && isPunct(next, '=')) {
			versions.set(name, valueOf(value));
		} else if (isPunct(operator, '.') && ['вставить', 'insert'].includes(lowerName(property) ?? '') && isPunct(next, '(')) {
			const { items: [key, version], end } = readList(value, 0);
			if (end === value.length - 1 && isPunct(value[end], ')') && key && literal(key)?.toLowerCase() === 'версия') {
				versions.set(name, version ? valueOf(version) : undefined);
			}
		}
	}
	return returned.size === 1 ? returned.values().next().value : undefined;
}
