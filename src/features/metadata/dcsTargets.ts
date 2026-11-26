/**
 * Адресация файлов схемы компоновки данных для md-sparrow: от файла макета или описания владельца
 * к файлу операции, рабочему каталогу запуска и флагу версии формата.
 *
 * Модуль не зависит от vscode: его проверяют node-тесты.
 *
 * @module dcsTargets
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EDT_SCHEMA_FLAG } from './mdSparrowSchemaVersion';
import type { MdSparrowFileReader } from './mdSparrowFileInfo';
import type { MdSparrowParams } from './mdSparrowParams';

/** Файл и окружение запуска md-sparrow, найденные по пути файла. */
export interface DcsResolvedTarget {
	/** Абсолютный путь файла для objectXml. */
	objectXml: string;
	/** Рабочий каталог запуска: корень выгрузки, когда он найден, иначе каталог файла. */
	cwd: string;
	/** Флаг версии схемы (`V2_20`); пустой у проекта EDT: версию там знает метамодель сборки. */
	schemaVersion: string;
}

/** Найденная цель либо текст отказа. */
export type DcsTargetResolution = { target: DcsResolvedTarget } | { error: string };

/**
 * Есть ли файл или каталог по пути.
 *
 * @param file - Проверяемый путь
 * @returns Промис, который разрешается true, когда путь существует
 */
export async function fileExists(file: string): Promise<boolean> {
	try {
		await fs.stat(file);
		return true;
	} catch {
		return false;
	}
}

/**
 * Абсолютный путь из переданного значения; относительный считается от корня проекта.
 *
 * @param raw - Переданное значение
 * @param baseDir - Корень проекта для относительных путей
 * @param hint - Текст отказа, когда путь не передан
 * @returns Нормализованный абсолютный путь либо текст отказа
 */
export function absolutePathOf(raw: unknown, baseDir: string | undefined, hint: string): { abs: string } | { error: string } {
	if (typeof raw !== 'string' || raw.trim() === '') {
		return { error: hint };
	}
	const trimmed = raw.trim();
	if (path.isAbsolute(trimmed)) {
		return { abs: path.normalize(trimmed) };
	}
	if (baseDir === undefined || baseDir === '') {
		return { error: 'Корень проекта не определён: передайте абсолютный путь или projectPath.' };
	}
	return { abs: path.normalize(path.join(baseDir, trimmed)) };
}

/** Ищет файл вверх по каталогам до корня файловой системы. */
async function findUp(from: string, relative: string): Promise<string | undefined> {
	let directory = from;
	for (;;) {
		const candidate = path.join(directory, relative);
		if (await fileExists(candidate)) {
			return candidate;
		}
		const parent = path.dirname(directory);
		if (parent === directory) {
			return undefined;
		}
		directory = parent;
	}
}

/**
 * Configuration.xml выше файла по каталогам: признак, что макет лежит внутри выгрузки
 * конфигурации.
 *
 * @param file - Файл макета или другой файл выгрузки
 * @returns Промис, который разрешается путём Configuration.xml либо undefined вне выгрузки
 */
export async function findConfigurationXmlAbove(file: string): Promise<string | undefined> {
	return findUp(path.dirname(file), 'Configuration.xml');
}

/**
 * Корень проекта EDT: каталог, в котором лежит Configuration/Configuration.mdo.
 *
 * @param file - Файл внутри проекта
 * @returns Промис, который разрешается корнем исходников проекта либо undefined вне проекта EDT
 */
export async function edtRootOf(file: string): Promise<string | undefined> {
	const configuration = await findUp(path.dirname(file), path.join('Configuration', 'Configuration.mdo'));
	return configuration === undefined ? undefined : path.dirname(path.dirname(configuration));
}

/**
 * Имена общих реквизитов выгрузки: `CommonAttributes/<Имя>.xml` у конфигуратора и `CommonAttributes/<Имя>/` у
 * EDT. Описания таблиц md-sparrow не перечисляют общие реквизиты у табличных частей, констант, журналов и
 * последовательностей, поэтому проверка имён запроса считает имя возможным полем любой таблицы: состав
 * реквизита не читается. Каталога нет или он не читается: пустой список.
 *
 * @param root - Корень выгрузки (каталог Configuration.xml) или каталог src проекта EDT
 * @returns Промис, который разрешается именами общих реквизитов без повторов
 */
export async function dcsCommonAttributeNames(root: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(path.join(root, 'CommonAttributes'), { withFileTypes: true });
		// У конфигуратора рядом с файлом описания бывает одноимённый каталог
		const names = new Set<string>();
		for (const entry of entries) {
			if (entry.isDirectory()) {
				names.add(entry.name);
			} else if (entry.isFile() && entry.name.toLowerCase().endsWith('.xml')) {
				names.add(entry.name.slice(0, -'.xml'.length));
			}
		}
		return Array.from(names);
	} catch {
		return [];
	}
}

/**
 * Файл объекта для описания либо причина, по которой его нет: `outside`, макет вне выгрузки;
 * `missing`, объекта в выгрузке нет (например, объект основной конфигурации у макета расширения).
 */
export type DcsDescribeTargetResolution =
	| { target: DcsResolvedTarget }
	| { outside: true }
	| { missing: string }
	| { error: string };

/**
 * Файл объекта для dcs/describe-type от файла макета: `<Каталог вида>/<Имя>.xml` рядом с
 * Configuration.xml выше макета или `<Каталог вида>/<Имя>/<Имя>.mdo` в проекте EDT. Соседний src/cf
 * у макетов вне выгрузки не ищется.
 *
 * @param templateFile - Файл содержимого схемы (Template.xml или Template.dcs)
 * @param folder - Каталог вида в выгрузке (`Catalogs`)
 * @param name - Имя объекта; проверено как идентификатор до вызова
 * @returns Промис, который разрешается файлом объекта либо причиной, по которой его нет
 */
export async function resolveDcsDescribeTarget(
	templateFile: string,
	folder: string,
	name: string,
	readMetadata: MdSparrowFileReader['metadata']
): Promise<DcsDescribeTargetResolution> {
	const configurationXml = await findUp(path.dirname(templateFile), 'Configuration.xml');
	if (configurationXml !== undefined) {
		const root = path.dirname(configurationXml);
		const objectXml = path.join(root, folder, `${name}.xml`);
		if (!(await fileExists(objectXml))) {
			return { missing: `Объекта ${folder}/${name} нет в выгрузке ${root}.` };
		}
		return designerTargetFromDescriptor(objectXml, root, configurationXml, readMetadata);
	}
	const edtRoot = await edtRootOf(templateFile);
	if (edtRoot !== undefined) {
		const objectXml = path.join(edtRoot, folder, name, `${name}.mdo`);
		if (!(await fileExists(objectXml))) {
			return { missing: `Объекта ${folder}/${name} нет в проекте ${edtRoot}.` };
		}
		return { target: { objectXml, cwd: edtRoot, schemaVersion: EDT_SCHEMA_FLAG } };
	}
	return { outside: true };
}

/**
 * Файл объекта для dcs/query-tables по relativePath из дерева конструктора: путь считается от корня
 * выгрузки над макетом или проекта EDT.
 *
 * Путь приходит из webview, поэтому абсолютный путь, `..`, выход за корень и файл не того формата
 * (`.xml` у выгрузки, `.mdo` у EDT) отклоняются.
 *
 * @param templateFile - Файл содержимого схемы (Template.xml или Template.dcs)
 * @param relativePath - Файл объекта от корня выгрузки или проекта
 * @returns Промис, который разрешается файлом объекта либо причиной, по которой его нет
 */
export async function resolveDcsQueryTablesTarget(
	templateFile: string,
	relativePath: string,
	readMetadata: MdSparrowFileReader['metadata']
): Promise<DcsDescribeTargetResolution> {
	const configurationXml = await findUp(path.dirname(templateFile), 'Configuration.xml');
	const edtRoot = configurationXml === undefined ? await edtRootOf(templateFile) : undefined;
	if (configurationXml === undefined && edtRoot === undefined) {
		return { outside: true };
	}
	const root = configurationXml !== undefined ? path.dirname(configurationXml) : (edtRoot as string);
	const segments = relativePath.split(/[\\/]/);
	if (path.isAbsolute(relativePath) || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
		return { error: `Путь «${relativePath}» не адресует объект внутри выгрузки: нужен путь от её корня без «..».` };
	}
	// Путь собирается из сегментов: на POSIX обратная косая черта осталась бы в имени файла
	const objectXml = path.normalize(path.join(root, ...segments));
	const relative = path.relative(root, objectXml);
	if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
		return { error: `Путь «${relativePath}» выходит за выгрузку ${root}.` };
	}
	const extension = configurationXml !== undefined ? '.xml' : '.mdo';
	if (path.extname(objectXml).toLowerCase() !== extension) {
		return { error: `Путь «${relativePath}» не описание объекта: в ${configurationXml !== undefined ? 'выгрузке конфигуратора' : 'проекте EDT'} это файл ${extension}.` };
	}
	if (!(await fileExists(objectXml))) {
		return { missing: `Объекта ${relativePath} нет в ${configurationXml !== undefined ? 'выгрузке' : 'проекте'} ${root}.` };
	}
	if (configurationXml === undefined) {
		return { target: { objectXml, cwd: root, schemaVersion: EDT_SCHEMA_FLAG } };
	}
	return designerTargetFromDescriptor(objectXml, root, configurationXml, readMetadata);
}

async function designerTargetFromDescriptor(
	objectXml: string,
	cwd: string,
	descriptor: string,
	readMetadata: MdSparrowFileReader['metadata']
): Promise<DcsTargetResolution> {
	try {
		const { schemaVersion } = await readMetadata(descriptor);
		return { target: { objectXml, cwd, schemaVersion } };
	} catch (error) {
		return { error: `Версия формата не прочитана из ${descriptor}. ${error instanceof Error ? error.message : String(error)}` };
	}
}

/** Цель в выгрузке 1C:Конфигуратор или во внешнем отчёте или обработке. */
export async function designerTarget(
	objectXml: string,
	versionFallback: string | undefined,
	readMetadata: MdSparrowFileReader['metadata']
): Promise<DcsTargetResolution> {
	const configurationXml = await findConfigurationXmlAbove(objectXml);
	if (configurationXml !== undefined) {
		return designerTargetFromDescriptor(objectXml, path.dirname(configurationXml), configurationXml, readMetadata);
	}
	if (versionFallback !== undefined) {
		return designerTargetFromDescriptor(objectXml, path.dirname(objectXml), versionFallback, readMetadata);
	}
	return { error: `Версия формата выгрузки не определена: выше ${objectXml} нет Configuration.xml или описания макета рядом.` };
}

/**
 * Находит описание владельца макета для его создания или удаления: объект с макетами,
 * Configuration.xml (общий макет) или их `.mdo` в проекте EDT.
 *
 * @param raw - Путь к описанию владельца; относительный считается от baseDir
 * @param baseDir - Корень проекта для относительных путей
 * @returns Промис, который разрешается целью либо текстом отказа
 */
export async function resolveDcsOwnerTarget(
	raw: unknown,
	baseDir: string | undefined,
	readMetadata: MdSparrowFileReader['metadata']
): Promise<DcsTargetResolution> {
	const resolved = absolutePathOf(
		raw,
		baseDir,
		'Передайте путь к описанию владельца макета: XML объекта выгрузки конфигуратора, ' +
			'Configuration.xml для общего макета или .mdo проекта EDT.'
	);
	if ('error' in resolved) {
		return resolved;
	}
	const { abs } = resolved;
	if (!(await fileExists(abs))) {
		return { error: `Файл не найден: ${abs}` };
	}
	if (abs.toLowerCase().endsWith('.mdo')) {
		return {
			target: { objectXml: abs, cwd: (await edtRootOf(abs)) ?? path.dirname(abs), schemaVersion: EDT_SCHEMA_FLAG },
		};
	}
	return designerTarget(abs, abs, readMetadata);
}

/** Правка состава макетов владельца: создание или удаление макета со схемой компоновки. */
export type DcsTemplateOp = 'cf-dcs-template-add' | 'cf-dcs-template-remove';

/**
 * Параметры md-sparrow для создания или удаления макета СКД у владельца.
 *
 * makeMain уходит только при создании: удаление ссылку на основную схему очищает само.
 *
 * @param op - Создание или удаление макета
 * @param owner - Описание владельца, найденное {@link resolveDcsOwnerTarget}
 * @param name - Имя макета
 * @param makeMain - Назначить новый макет основной схемой владельца; undefined: свойство не меняется
 * @returns Параметры операции без рабочего каталога: его задаёт owner.cwd
 */
export function dcsTemplateMutationParams(
	op: DcsTemplateOp,
	owner: Pick<DcsResolvedTarget, 'objectXml' | 'schemaVersion'>,
	name: string,
	makeMain?: boolean
): MdSparrowParams {
	const params: MdSparrowParams = { op, objectXml: owner.objectXml, schemaVersion: owner.schemaVersion, name };
	if (op === 'cf-dcs-template-add' && makeMain !== undefined) {
		params.makeMain = makeMain;
	}
	return params;
}

/** Форматы выгрузки, в XSD которых нет полного набора схем СКД (платформа 8.3.17 и 8.3.18). */
const DCS_SCHEMA_UNREADABLE_FLAGS = new Set(['V2_10', 'V2_11']);

/**
 * Почему редактор не откроет схему этого формата. В 2.10 и 2.11 md-sparrow создаёт макет,
 * но схему не читает и не правит.
 *
 * @param schemaFlag - Флаг версии md-sparrow, например V2_10; пустой у проекта 1C:EDT
 * @returns Текст для пользователя; undefined, если формат поддержан
 */
export function dcsEditorUnsupportedReason(schemaFlag: string): string | undefined {
	if (!DCS_SCHEMA_UNREADABLE_FLAGS.has(schemaFlag)) {
		return undefined;
	}
	const version = schemaFlag.slice(1).replace('_', '.');
	return `Редактор схемы компоновки данных не поддерживает формат ${version}. Схему правьте в конфигураторе.`;
}
