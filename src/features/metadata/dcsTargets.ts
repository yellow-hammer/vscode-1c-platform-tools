/**
 * Адресация файлов схемы компоновки данных для md-sparrow: от файла макета или описания владельца
 * к файлу операции, рабочему каталогу запуска и флагу версии формата.
 *
 * Редактор СКД узнаёт здесь выгрузку над макетом (конструктор запроса, общие реквизиты, признак
 * расширения) и файлы объектов для подсказок, дерево метаданных — владельца нового или удаляемого
 * макета и параметры этой правки. Модуль без зависимости от vscode: его проверяют node-тесты без VS Code.
 *
 * @module dcsTargets
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
	EDT_SCHEMA_FLAG,
	designerXmlVersionToMdSparrowFlag,
	mdSparrowSchemaFlagFromConfigurationXml,
	readConfigurationXmlMetaDataVersion,
} from './mdSparrowSchemaVersion';
import type { MdSparrowParams } from './mdSparrowParams';
import { describeMarker } from '../../shared/projectLayout';

/** Файл и окружение запуска md-sparrow, найденные по пути файла. */
export interface DcsResolvedTarget {
	/** Абсолютный путь файла для objectXml. */
	objectXml: string;
	/** Рабочий каталог запуска: корень выгрузки, когда он найден, иначе каталог файла. */
	cwd: string;
	/** Флаг версии схемы (`V2_20`); пустой у проекта EDT — версию там знает метамодель сборки. */
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
 * @param raw - Путь как он передан: строка или что угодно иное
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
 * конфигурации. На нём держится доступность конструктора запроса — дерево объектов
 * строится по этой выгрузке, вне её строить не по чему.
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
 * EDT. Общий реквизит — поле таблиц объектов из его состава (разделители `ОбластьДанных…` в БСП). Описания таблиц
 * md-sparrow (cf-md-query-tables) перечисляют их у основных таблиц и таблиц итогов, но не у табличных частей,
 * констант, журналов и последовательностей: проверка имён запроса о полях с такими именами молчит. Состав реквизита
 * не читается — имя считается возможным полем любой таблицы. Каталога нет или он не читается — пустой список.
 *
 * @param root - Корень выгрузки (каталог Configuration.xml) или каталог src проекта EDT
 * @returns Промис, который разрешается именами общих реквизитов без повторов
 */
export async function dcsCommonAttributeNames(root: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(path.join(root, 'CommonAttributes'), { withFileTypes: true });
		// Каталог с именем реквизита бывает и у выгрузки конфигуратора (рядом с файлом описания): имя — одно
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

/** Сколько байт начала Configuration.xml читать ради признака расширения: свойства конфигурации идут в начале. */
const CONFIGURATION_HEAD_BYTES = 8192;

/**
 * Выгрузка расширения конфигурации: в Configuration.xml расширения записана принадлежность объекта
 * (ObjectBelonging) — тот же признак, по которому расширение узнаёт раскладка проекта. В такой
 * выгрузке нет объектов основной конфигурации, а описания заимствованных объектов несут только
 * заимствованные реквизиты и части: проверка имён запроса по ним давала бы ложные предупреждения,
 * и панель её выключает. Файл не читается — false (проверка остаётся, как у конфигурации).
 *
 * @param configurationXml - Configuration.xml выгрузки, в которой лежит макет
 * @returns Промис, который разрешается true у выгрузки расширения
 */
export async function isConfigurationExtensionXml(configurationXml: string): Promise<boolean> {
	try {
		const handle = await fs.open(configurationXml, 'r');
		try {
			const buffer = Buffer.alloc(CONFIGURATION_HEAD_BYTES);
			const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
			return describeMarker(buffer.subarray(0, bytesRead).toString('utf8'), 'designer').isExtension;
		} finally {
			await handle.close();
		}
	} catch {
		return false;
	}
}

/**
 * Файл объекта для описания либо причина, по которой его нет: `outside` — макет не лежит в
 * выгрузке конфигурации, описывать объекты не по чему; `missing` — выгрузка есть, а объекта в ней
 * нет (объект основной конфигурации у макета расширения и т. п.).
 */
export type DcsDescribeTargetResolution =
	| { target: DcsResolvedTarget }
	| { outside: true }
	| { missing: string }
	| { error: string };

/**
 * Файл объекта конфигурации для описания (dcs/describe-type), найденный от файла макета: в выгрузке
 * конфигуратора — `<Каталог вида>/<Имя>.xml` рядом с Configuration.xml выше макета, в проекте EDT —
 * `<Каталог вида>/<Имя>/<Имя>.mdo` рядом с Configuration/Configuration.mdo. Соседний src/cf у
 * внешних отчётов и прочих макетов вне выгрузки не ищется.
 *
 * @param templateFile - Файл содержимого схемы (Template.xml или Template.dcs)
 * @param folder - Каталог вида в выгрузке (`Catalogs`)
 * @param name - Имя объекта; проверено как идентификатор до вызова
 * @returns Промис, который разрешается файлом объекта либо причиной, по которой его нет
 */
export async function resolveDcsDescribeTarget(
	templateFile: string,
	folder: string,
	name: string
): Promise<DcsDescribeTargetResolution> {
	const configurationXml = await findUp(path.dirname(templateFile), 'Configuration.xml');
	if (configurationXml !== undefined) {
		const root = path.dirname(configurationXml);
		const objectXml = path.join(root, folder, `${name}.xml`);
		if (!(await fileExists(objectXml))) {
			return { missing: `Объекта ${folder}/${name} нет в выгрузке ${root}.` };
		}
		try {
			return { target: { objectXml, cwd: root, schemaVersion: await mdSparrowSchemaFlagFromConfigurationXml(configurationXml) } };
		} catch (error) {
			return { error: `Версия формата не прочитана из ${configurationXml}. ${error instanceof Error ? error.message : String(error)}` };
		}
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
 * Файл объекта для таблиц языка запросов (dcs/query-tables) по relativePath из дерева конструктора:
 * путь считается от корня выгрузки над макетом (каталог Configuration.xml) или проекта EDT (каталог
 * с Configuration/Configuration.mdo) — так же, как dcs/describe-type находит объекты.
 *
 * Путь приходит сообщением webview, а не из доверенного кода: абсолютный путь, `..`, выход за корень
 * и файл не того формата (`.xml` у выгрузки, `.mdo` у EDT) отклоняются до md-sparrow.
 *
 * @param templateFile - Файл содержимого схемы (Template.xml или Template.dcs)
 * @param relativePath - Файл объекта от корня выгрузки или проекта
 * @returns Промис, который разрешается файлом объекта либо причиной, по которой его нет
 */
export async function resolveDcsQueryTablesTarget(templateFile: string, relativePath: string): Promise<DcsDescribeTargetResolution> {
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
	// Путь собирается из сегментов: на POSIX обратная косая черта из «Catalogs\Валюты.xml» осталась бы в имени файла
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
	try {
		return { target: { objectXml, cwd: root, schemaVersion: await mdSparrowSchemaFlagFromConfigurationXml(configurationXml) } };
	} catch (error) {
		return { error: `Версия формата не прочитана из ${configurationXml}. ${error instanceof Error ? error.message : String(error)}` };
	}
}

/** Версия формата по файлу MetaDataObject; undefined — атрибут не прочитан. */
async function schemaFlagOfMetaDataObject(file: string): Promise<string | undefined> {
	try {
		return designerXmlVersionToMdSparrowFlag(await readConfigurationXmlMetaDataVersion(file));
	} catch {
		return undefined;
	}
}

/**
 * Цель в выгрузке конфигуратора: версия формата из Configuration.xml выше по каталогам либо из
 * запасного описания, когда выгрузки над файлом нет.
 *
 * @param objectXml - Файл операции md-sparrow
 * @param versionFallback - Описание с атрибутом version для файлов вне выгрузки
 * @returns Промис, который разрешается целью либо текстом отказа
 */
export async function designerTarget(objectXml: string, versionFallback: string | undefined): Promise<DcsTargetResolution> {
	const configurationXml = await findUp(path.dirname(objectXml), 'Configuration.xml');
	if (configurationXml !== undefined) {
		try {
			return {
				target: {
					objectXml,
					cwd: path.dirname(configurationXml),
					schemaVersion: await mdSparrowSchemaFlagFromConfigurationXml(configurationXml),
				},
			};
		} catch (error) {
			return { error: `Версия формата не прочитана из ${configurationXml}. ${error instanceof Error ? error.message : String(error)}` };
		}
	}
	// Вне выгрузки (внешние отчёты и обработки) версию несёт описание самого объекта
	if (versionFallback !== undefined) {
		const flag = await schemaFlagOfMetaDataObject(versionFallback);
		if (flag !== undefined) {
			return { target: { objectXml, cwd: path.dirname(objectXml), schemaVersion: flag } };
		}
	}
	return {
		error:
			`Версия формата выгрузки не определена: выше ${objectXml} нет Configuration.xml, ` +
			'а описание с атрибутом version рядом не прочитано.',
	};
}

/**
 * Находит описание владельца макета для его создания или удаления.
 *
 * Владельцем бывает объект с макетами (Reports/<Имя>.xml и подобные), сама конфигурация
 * (Configuration.xml — общий макет) и их EDT-аналоги в `.mdo`.
 *
 * @param raw - Путь к описанию владельца; относительный считается от baseDir
 * @param baseDir - Корень проекта для относительных путей
 * @returns Промис, который разрешается описанием владельца с рабочим каталогом и версией формата либо текстом отказа
 */
export async function resolveDcsOwnerTarget(raw: unknown, baseDir: string | undefined): Promise<DcsTargetResolution> {
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
	if (path.basename(abs).toLowerCase() === 'configuration.xml') {
		try {
			return {
				target: { objectXml: abs, cwd: path.dirname(abs), schemaVersion: await mdSparrowSchemaFlagFromConfigurationXml(abs) },
			};
		} catch (error) {
			return { error: `Версия формата не прочитана из ${abs}. ${error instanceof Error ? error.message : String(error)}` };
		}
	}
	// Версию формата несёт и само описание владельца: у внешних отчётов Configuration.xml нет
	return designerTarget(abs, abs);
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
 * @param makeMain - Назначить новый макет основной схемой владельца; undefined — свойство не трогается
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
 * Почему редактор не откроет схему этого формата. Макет в 2.10 и 2.11 md-sparrow создаёт, а схему
 * не читает и не правит: модель СКД собирается по XSD формата, а в этих форматах полного набора нет.
 *
 * @param schemaFlag - Флаг версии md-sparrow, например V2_10; пустой у проекта 1C:EDT
 * @returns Текст для пользователя; undefined - редактор схему этого формата откроет
 */
export function dcsEditorUnsupportedReason(schemaFlag: string): string | undefined {
	if (!DCS_SCHEMA_UNREADABLE_FLAGS.has(schemaFlag)) {
		return undefined;
	}
	const version = schemaFlag.slice(1).replace('_', '.');
	return `Редактор схемы компоновки данных не поддерживает формат ${version}. Схему правьте в конфигураторе.`;
}
