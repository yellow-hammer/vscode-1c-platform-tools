/**
 * Описание пакета из текста `packagedef`: строковые литералы методов
 * `Имя`, `Версия`, `ВерсияСреды`, `ЗависитОт`, `РазработкаЗависитОт`,
 * `ОпределяетКласс`, `ОпределяетМодуль`, `ИсполняемыйФайл`, `ВключитьФайл`.
 *
 * Модуль чистый (без vscode/fs).
 * @module packagedef
 */

import { isPunct, lowerName, readList, tokenize, type Token } from './oneScriptLexer';

/** Зависимость пакета. */
export interface PackageDependency {
	name: string;
	/** Наименьшая подходящая версия; без неё подходит любая. */
	version?: string;
	/**
	 * Нужна только для разработки: `РазработкаЗависитОт`, в собранный пакет не входит.
	 * Пакет, объявленный и обычной зависимостью, зависимостью разработки не считается.
	 */
	dev: boolean;
}

/** Класс или модуль, который пакет даёт наружу. */
export interface PackageExport {
	/** Имя; undefined, если вычисляется. */
	name?: string;
	/** Файл от корня пакета; undefined, если вычисляется. */
	file?: string;
}

/** Исполняемый файл пакета: opm ставит для него команду. */
export interface PackageExecutable {
	/** Сценарий от корня пакета; undefined, если вычисляется. */
	file?: string;
	/** Имя команды; без него имя пакета. */
	name?: string;
}

/** Прочитанное описание пакета. */
export interface PackageManifest {
	name?: string;
	version?: string;
	/** Наименьшая версия движка, на которой пакет ставится: `ВерсияСреды`. */
	engineVersion?: string;
	dependencies: PackageDependency[];
	classes: PackageExport[];
	modules: PackageExport[];
	executables: PackageExecutable[];
	/** Файлы и каталоги, которые входят в пакет: `ВключитьФайл`. */
	includes: string[];
}

/** Метод описания пакета: что он заполняет. */
type ManifestField =
	| 'name'
	| 'version'
	| 'engineVersion'
	| 'dependency'
	| 'devDependency'
	| 'class'
	| 'module'
	| 'executable'
	| 'include';

/** Методы описания пакета по имени в нижнем регистре. */
const METHODS: ReadonlyMap<string, ManifestField> = new Map([
	['имя', 'name'],
	['версия', 'version'],
	['версиясреды', 'engineVersion'],
	['зависитот', 'dependency'],
	['разработказависитот', 'devDependency'],
	['определяеткласс', 'class'],
	['определяетмодуль', 'module'],
	['исполняемыйфайл', 'executable'],
	['включитьфайл', 'include'],
]);

/** Строка аргумента, если он строковый литерал. */
function literal(argument: Token[] | undefined): string | undefined {
	return argument?.length === 1 && argument[0].kind === 'string' ? argument[0].value.trim() : undefined;
}

/** Путь от корня пакета с прямыми слэшами и без `./` в начале. */
function packagePath(value: string | undefined): string | undefined {
	const normalized = value?.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '');
	return normalized === undefined || normalized === '' ? undefined : normalized;
}

/**
 * Добавляет зависимость, как opm: повторное объявление того же пакета меняет
 * версию, если она указана, а `ЗависитОт` делает зависимость обычной.
 */
function addDependency(manifest: PackageManifest, dependency: PackageDependency): void {
	const key = dependency.name.toLowerCase();
	const existing = manifest.dependencies.find((item) => item.name.toLowerCase() === key);
	if (!existing) {
		manifest.dependencies.push(dependency);
		return;
	}
	existing.dev = existing.dev && dependency.dev;
	if (dependency.version !== undefined) {
		existing.version = dependency.version;
	}
}

/**
 * Описание пакета из текста `packagedef`.
 *
 * Метод описания узнаётся по вызову через точку: `Описание.Имя("…")` и
 * продолжение цепочки `.Версия("…")`. Повторный вызов заменяет прежнее значение.
 *
 * @param text - Текст `packagedef`
 */
export function parsePackagedef(text: string): PackageManifest {
	const manifest: PackageManifest = { dependencies: [], classes: [], modules: [], executables: [], includes: [] };
	const tokens = tokenize(text);
	for (let index = 1; index < tokens.length; index++) {
		const field = METHODS.get(lowerName(tokens[index]) ?? '');
		if (field === undefined || !isPunct(tokens[index - 1], '.') || !isPunct(tokens[index + 1], '(')) {
			continue;
		}
		const { items, end } = readList(tokens, index + 2);
		const [first, second] = items;
		switch (field) {
			case 'name':
				manifest.name = literal(first);
				break;
			case 'version':
				manifest.version = literal(first);
				break;
			case 'engineVersion':
				manifest.engineVersion = literal(first);
				break;
			case 'dependency':
			case 'devDependency': {
				const name = literal(first);
				const version = literal(second);
				if (name) {
					addDependency(manifest, { name, ...(version ? { version } : {}), dev: field === 'devDependency' });
				}
				break;
			}
			case 'class':
			case 'module':
				(field === 'class' ? manifest.classes : manifest.modules).push({
					name: literal(first),
					file: packagePath(literal(second)),
				});
				break;
			case 'executable':
				manifest.executables.push({ file: packagePath(literal(first)), name: literal(second) || undefined });
				break;
			case 'include': {
				const included = packagePath(literal(first));
				if (included) {
					manifest.includes.push(included);
				}
				break;
			}
			default: {
				const unknown: never = field;
				throw new Error(`Неизвестный метод описания пакета: ${String(unknown)}`);
			}
		}
		index = end;
	}
	return manifest;
}

/**
 * Объявлена ли зависимость, обычная или разработки; имя без учёта регистра.
 *
 * @param manifest - Описание пакета
 * @param name - Имя пакета
 */
export function dependsOn(manifest: PackageManifest, name: string): boolean {
	const key = name.toLowerCase();
	return manifest.dependencies.some((dependency) => dependency.name.toLowerCase() === key);
}

/**
 * Даёт ли пакет что-то наружу: классы, модули или исполняемый файл.
 *
 * @param manifest - Описание пакета
 */
export function declaresPackageApi(manifest: PackageManifest): boolean {
	return manifest.classes.length + manifest.modules.length + manifest.executables.length > 0;
}

/**
 * Файл настроек приложения на Осени из описания пакета.
 *
 * Ключ — имя команды, иначе имя пакета. Имя и версия берутся из `packagedef`.
 *
 * @param manifest - Описание пакета
 */
export function autumnPropertiesOf(manifest: PackageManifest): Record<string, unknown> {
	const appName = manifest.name?.trim();
	const command = manifest.executables.find((item) => item.name?.trim())?.name?.trim();
	const key = command || appName;
	if (!key) {
		return {};
	}
	const name = appName || key;
	const version = manifest.version?.trim();
	const properties: Record<string, string> = { ИмяПриложения: name };
	if (version) {
		properties.ПолноеИмяПриложения = `${name} v%{${key}.ВерсияПриложения}`;
		properties.ВерсияПриложения = version;
	}
	return { [key]: properties };
}

/** Что пакет отдаёт наружу и откуда это читается. */
export type PackageMemberKind = 'class' | 'module' | 'executable';

/** Класс, модуль или программа с известными именем и файлом. */
export interface PackageMember {
	kind: PackageMemberKind;
	name: string;
	file: string;
}

/**
 * Классы, модули и программы из `packagedef`.
 *
 * Запись без строкового имени или пути не попадает в список: её значение
 * вычисляет сценарий, и из текста файла оно неизвестно.
 *
 * @param manifest - Описание пакета
 */
export function packageMembers(manifest: PackageManifest): PackageMember[] {
	const members: PackageMember[] = [];
	const add = (kind: PackageMemberKind, name: string | undefined, file: string | undefined): void => {
		if (name && file) {
			members.push({ kind, name, file });
		}
	};
	for (const item of manifest.classes) {
		add('class', item.name, item.file);
	}
	for (const item of manifest.modules) {
		add('module', item.name, item.file);
	}
	for (const item of manifest.executables) {
		add('executable', item.name ?? manifest.name, item.file);
	}
	return members;
}

/** Порядок блоков в цепочке `Описание`: классы, затем модули, затем программа. */
const MEMBER_ORDER: readonly ManifestField[] = ['class', 'module', 'executable'];

/** Вызов метода в цепочке `Описание`. `dot` — точка перед именем, `end` — позиция после `)`. */
interface ChainCall {
	field: ManifestField;
	dot: number;
	end: number;
	args: readonly (string | undefined)[];
}

/**
 * Дописывает объявление в цепочку `Описание`, в блок таких же вызовов.
 *
 * Уже стоящие классы, модули и программа не переставляются. Если блока ещё нет,
 * строка встаёт перед следующим блоком или в конец цепочки. Отдельная инструкция
 * `Описание.…` пишется, только когда цепочки в файле нет.
 *
 * У программы в вызове сначала путь, потом имя команды.
 *
 * @param source - Текст `packagedef`
 * @param kind - Класс, модуль или программа
 * @param name - Имя
 * @param file - Путь от корня пакета
 */
export function appendPackageMember(
	source: string,
	kind: 'class' | 'module' | 'executable',
	name: string,
	file: string
): string {
	const invocation = packageMemberInvocation(kind, name, file);
	const calls = chainCalls(source);
	const newline = source.includes('\r\n') ? '\r\n' : '\n';
	const same = calls.filter((call) => call.field === kind);
	const anchor = same.length > 0 ? same[same.length - 1] : undefined;
	if (anchor) {
		return insertLineAfter(source, anchor.end, indentAt(source, anchor.dot), invocation, newline);
	}
	const rank = MEMBER_ORDER.indexOf(kind);
	const later = calls.find((call) => MEMBER_ORDER.indexOf(call.field) > rank);
	if (later) {
		return insertLineBefore(source, later.dot, indentAt(source, later.dot), invocation, newline);
	}
	const chain = calls[calls.length - 1];
	if (chain) {
		return insertLineAfter(source, chain.end, indentAt(source, chain.dot), invocation, newline);
	}
	return `${source.replace(/\s*$/, '')}${newline}Описание.${invocation};${newline}`;
}

/** Вызовы методов `Описание` с позициями в тексте. */
function chainCalls(source: string): ChainCall[] {
	const tokens = tokenize(source);
	const calls: ChainCall[] = [];
	for (let index = 1; index < tokens.length; index++) {
		const field = METHODS.get(lowerName(tokens[index]) ?? '');
		if (field === undefined || !isPunct(tokens[index - 1], '.') || !isPunct(tokens[index + 1], '(')) {
			continue;
		}
		const { items, end } = readList(tokens, index + 2);
		const close = tokens[end];
		if (!isPunct(close, ')')) {
			continue;
		}
		calls.push({
			field,
			dot: tokens[index - 1].start,
			end: close.end,
			args: items.map((item) => literal(item)),
		});
		index = end;
	}
	return calls;
}

/** Отступ строки, на которой стоит точка вызова. Продолжение `Описание.Имя` получает четыре пробела. */
function indentAt(source: string, dot: number): string {
	const lineStart = source.lastIndexOf('\n', Math.max(0, dot - 1)) + 1;
	const prefix = source.slice(lineStart, dot);
	if (/^[ \t]*$/.test(prefix) && prefix.length > 0) {
		return prefix;
	}
	const lineIndent = /^[ \t]*/.exec(source.slice(lineStart))?.[0] ?? '';
	return `${lineIndent}    `;
}

function insertLineAfter(source: string, end: number, indent: string, invocation: string, newline: string): string {
	return `${source.slice(0, end)}${newline}${indent}.${invocation}${source.slice(end)}`;
}

function insertLineBefore(source: string, dot: number, indent: string, invocation: string, newline: string): string {
	const lineStart = source.lastIndexOf('\n', Math.max(0, dot - 1)) + 1;
	return `${source.slice(0, lineStart)}${indent}.${invocation}${newline}${source.slice(lineStart)}`;
}

/**
 * Убирает из `packagedef` объявление.
 *
 * Класс и модуль узнаются по имени, программа — по пути файла. Вызов вырезается
 * по тем же лексемам, что читает разбор манифеста.
 *
 * @param source - Текст `packagedef`
 * @param kind - Класс, модуль или программа
 * @param key - Имя класса или модуля либо путь программы
 */
export function removePackageMember(source: string, kind: PackageMemberKind, key: string): string {
	const wanted = kind === 'executable' ? packagePath(key) : key;
	if (wanted === undefined) {
		return source;
	}
	const matches = chainCalls(source).filter((call) => call.field === kind && memberKey(call) === wanted);
	let next = source;
	for (const call of [...matches].sort((left, right) => right.dot - left.dot)) {
		next = cutCall(next, call.dot, call.end);
	}
	const newline = next.includes('\r\n') ? '\r\n' : '\n';
	return next
		.split(/\r?\n/)
		.filter((line) => !/^\s*Описание\s*;\s*$/.test(line))
		.join(newline);
}

/** Имя класса и модуля или путь программы. */
function memberKey(call: ChainCall): string | undefined {
	if (call.field === 'class' || call.field === 'module') {
		return call.args[0];
	}
	if (call.field === 'executable') {
		return packagePath(call.args[0]);
	}
	return undefined;
}

/** Вырезает вызов. Строка, на которой кроме него ничего нет, уходит целиком. */
function cutCall(source: string, dot: number, end: number): string {
	const lineStart = source.lastIndexOf('\n', Math.max(0, dot - 1)) + 1;
	const newlineAt = source.indexOf('\n', end);
	const before = source.slice(lineStart, dot);
	const after = source.slice(end, newlineAt < 0 ? source.length : newlineAt);
	if (/^[ \t]*$/.test(before) && /^[ \t]*;?[ \t]*$/.test(after)) {
		const lineStop = newlineAt < 0 ? source.length : newlineAt + 1;
		return source.slice(0, lineStart) + source.slice(lineStop);
	}
	return source.slice(0, dot) + source.slice(end);
}

function packageMemberInvocation(kind: 'class' | 'module' | 'executable', name: string, file: string): string {
	switch (kind) {
		case 'class':
			return `ОпределяетКласс("${name}", "${file}")`;
		case 'module':
			return `ОпределяетМодуль("${name}", "${file}")`;
		case 'executable':
			return name === ''
				? `ИсполняемыйФайл("${file}")`
				: `ИсполняемыйФайл("${file}", "${name}")`;
		default: {
			const unknown: never = kind;
			return unknown;
		}
	}
}

/** Расширение файла собранного пакета. */
export const PACKAGE_EXTENSION = '.ospx';

/**
 * Имя файла, который соберёт opm: `<Имя>-<Версия>.ospx`.
 *
 * @param manifest - Описание пакета
 * @returns undefined, если имя или версия вычисляются
 */
export function packageFileName(manifest: PackageManifest): string | undefined {
	return manifest.name && manifest.version ? `${manifest.name}-${manifest.version}${PACKAGE_EXTENSION}` : undefined;
}

/**
 * Каталоги, куда `opm install -l` запишет `oscript.cfg`: рядом с каждой программой пакета.
 *
 * Каталог корня не возвращается: он уже есть. Без каталога opm падает, не записав файл.
 *
 * @param manifest - Описание пакета
 */
export function oscriptConfigDirectories(manifest: PackageManifest): string[] {
	const dirs = new Set<string>();
	for (const executable of manifest.executables) {
		if (!executable.file) {
			continue;
		}
		const normalized = executable.file.replaceAll('\\', '/');
		const slash = normalized.lastIndexOf('/');
		if (slash <= 0) {
			continue;
		}
		dirs.add(normalized.slice(0, slash));
	}
	return [...dirs];
}
