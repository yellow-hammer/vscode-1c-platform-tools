/**
 * Описание пакета OneScript из `packagedef`.
 *
 * `packagedef` это сценарий OneScript: opm выполняет его, и текучие вызовы
 * `Описание.Имя(...).Версия(...)` заполняют описание пакета. Здесь сценарий не
 * выполняется, а читается по лексемам: значение берётся только из строкового
 * литерала, вычисленное (`.Версия(ПараметрыСистемы.ВерсияПродукта())`) остаётся
 * неизвестным. Методы описания у opm только русские.
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
	/** Каталог задач `opm run` от корня пакета: `Задачи`; без него `tasks`. */
	tasks?: string;
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
	| 'tasks'
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
	['задачи', 'tasks'],
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
 * продолжение цепочки `.Версия("…")`. Повторный вызов того же свойства
 * заменяет прежнее значение, как у opm.
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
			case 'tasks':
				manifest.tasks = packagePath(literal(first));
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
