/**
 * Каталог правок и поиск файла схемы для команд агента `1c-platform-tools.dcs.*`.
 *
 * Белый каталог мутаций собирается из спеков сообщений панели ({@link DCS_MESSAGE_SPECS}) и операций
 * вне сообщений (запрос, вычисляемое поле, макеты владельца) — так команда dcs.apply не расходится
 * с панелью, когда у панели появляются новые правки. Файл схемы команда находит по path, который
 * может быть и описанием макета: агент чаще знает его из дерева выгрузки. Адресация, общая с
 * редактором и деревом метаданных (владелец макета, выгрузка над файлом), — в {@link module:dcsTargets}.
 *
 * Модуль без зависимости от vscode: его проверяют node-тесты без VS Code.
 *
 * @module dcsAgentOps
 */

import * as path from 'node:path';
import { classifyTemplateContent, findTemplateContent } from '../spreadsheet/templateContent';
import {
	DCS_MESSAGE_PREFIX,
	DCS_MESSAGE_SPECS,
	dcsMutationOf,
	type DcsMessageSpec,
	type DcsMutation,
} from './dcsPanelMessages';
import { absolutePathOf, designerTarget, edtRootOf, fileExists, type DcsTargetResolution } from './dcsTargets';
import { EDT_SCHEMA_FLAG } from './mdSparrowSchemaVersion';
import type { MdSparrowOp, MdSparrowParams } from './mdSparrowParams';

/** Префикс операций схемы компоновки; правило имён сообщений: `dcs/<операция>` → `cf-dcs-<операция>`. */
const CF_DCS_PREFIX = 'cf-dcs-';

/**
 * Мутации СКД вне спеков сообщений панели: запрос и вычисляемое поле правятся особыми
 * сообщениями, а макеты меняют описание владельца, а не схему, и сообщений панели у них нет.
 */
const EXTRA_APPLY_OPS: readonly MdSparrowOp[] = [
	'cf-dcs-set-query',
	'cf-dcs-add-calculated-field',
	'cf-dcs-template-add',
	'cf-dcs-template-remove',
];

/** Белый каталог мутаций dcs.apply: все правки СКД. Чтения (cf-dcs-info и прочие) сюда не входят. */
export const DCS_APPLY_OPS: readonly MdSparrowOp[] = [
	...Object.values(DCS_MESSAGE_SPECS).map((spec) => spec.op),
	...EXTRA_APPLY_OPS,
].sort();

const DCS_APPLY_OP_SET: ReadonlySet<string> = new Set(DCS_APPLY_OPS);

/**
 * Операции над описанием владельца макета: path у них — файл владельца, а не содержимое
 * схемы, поэтому свежая модель cf-dcs-info после них не перечитывается.
 */
export const DCS_OWNER_OPS: ReadonlySet<string> = new Set<MdSparrowOp>([
	'cf-dcs-template-add',
	'cf-dcs-template-remove',
]);

/** Правка из dcs.apply: параметры мутации без файла и версии схемы. */
export type DcsApplyMutation = DcsMutation & Pick<MdSparrowParams, 'tag' | 'makeMain'>;

/** Разобранная правка либо текст отказа для агента. */
export type DcsApplyMapping = { mutation: DcsApplyMutation } | { error: string };

/** Подсказка обязательных полей params по спеку сообщения панели. */
function specNeeds(spec: DcsMessageSpec): string {
	const needs: string[] = (spec.strings ?? []).map((field) => `${field} (непустая строка)`);
	if (spec.index) {
		needs.push('index (целое число от 0)');
	}
	if (spec.payload) {
		needs.push('payload (объект)');
	}
	if (spec.optionalPayload) {
		needs.push('payload (объект, необязателен)');
	}
	if (spec.op === 'cf-dcs-add-data-set') {
		needs.push('dataSetType (query, object или union)', 'dataSource (непустая строка)');
	}
	return needs.join(', ');
}

function needsError(op: string, needs: string): { error: string } {
	return { error: `Параметры операции ${op} не разобраны. Нужны: ${needs}.` };
}

/**
 * Собирает мутацию md-sparrow из аргументов dcs.apply `{op, params}`.
 *
 * Операция вне белого каталога отклоняется до запуска jar — так агент получает список
 * доступных правок, а чтения и чужие op не доходят до apply-mutation. Поля params — те же,
 * что в сообщениях панели (`{type: 'dcs/<операция>', …поля}` без type); формы особых
 * операций: set-query `{text, dataSet?}`, add-calculated-field `{dataPath, expression?,
 * title?}`, autofill-fields `{dataSet}` (отказ называет набор-запрос), template-add
 * `{name, makeMain?}`, template-remove `{name}`.
 *
 * @param op - Операция из белого каталога {@link DCS_APPLY_OPS}
 * @param params - Поля операции; допустимо не передавать, когда полей нет
 * @returns Мутация без файла и версии схемы либо текст отказа для агента
 */
export function dcsApplyMutationOf(op: unknown, params: unknown): DcsApplyMapping {
	if (typeof op !== 'string' || !DCS_APPLY_OP_SET.has(op)) {
		return {
			error:
				`Операция не входит в каталог правок СКД: ${String(op ?? '')}. ` +
				`Доступные op: ${DCS_APPLY_OPS.join(', ')}.`,
		};
	}
	if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) {
		return { error: `Передайте params объектом с полями операции ${op}.` };
	}
	const fields: Record<string, unknown> = { ...(params as Record<string, unknown> | undefined) };
	switch (op) {
		case 'cf-dcs-set-query': {
			const { text, dataSet } = fields;
			if (typeof text !== 'string' || (dataSet !== undefined && typeof dataSet !== 'string')) {
				return needsError(op, 'text (строка текста запроса), dataSet (имя набора; обязателен при нескольких наборах с запросом)');
			}
			// cf-dcs-set-query адресует набор параметром tag
			const mutation: DcsApplyMutation = { op, payloadJson: text };
			if (dataSet !== undefined && dataSet !== '') {
				mutation.tag = dataSet;
			}
			return { mutation };
		}
		case 'cf-dcs-add-calculated-field': {
			const { dataPath, expression, title } = fields;
			if (
				typeof dataPath !== 'string' ||
				dataPath === '' ||
				(expression !== undefined && typeof expression !== 'string') ||
				(title !== undefined && typeof title !== 'string')
			) {
				return needsError(op, 'dataPath (непустая строка), expression и title (строки, необязательны)');
			}
			// Поля уходят DTO, как их собирает панель из сообщения addCalculatedField
			return { mutation: { op, payloadJson: JSON.stringify({ dataPath, expression: expression ?? '', title: title ?? '' }) } };
		}
		case 'cf-dcs-autofill-fields': {
			const { dataSet } = fields;
			if (typeof dataSet !== 'string' || dataSet === '') {
				return needsError(op, 'dataSet (непустое имя набора-запроса)');
			}
			return { mutation: { op, dataSet } };
		}
		case 'cf-dcs-template-add': {
			const { name, makeMain } = fields;
			if (typeof name !== 'string' || name === '' || (makeMain !== undefined && typeof makeMain !== 'boolean')) {
				return needsError(op, 'name (непустое имя макета), makeMain (булево, необязателен)');
			}
			const mutation: DcsApplyMutation = { op, name };
			if (makeMain !== undefined) {
				mutation.makeMain = makeMain;
			}
			return { mutation };
		}
		case 'cf-dcs-template-remove': {
			const { name } = fields;
			if (typeof name !== 'string' || name === '') {
				return needsError(op, 'name (непустое имя макета)');
			}
			return { mutation: { op, name } };
		}
		default: {
			// Операции сообщений панели: разбор общий с webview, чтобы формы не разошлись
			const type = `${DCS_MESSAGE_PREFIX}${op.slice(CF_DCS_PREFIX.length)}`;
			const mutation = dcsMutationOf({ ...fields, type });
			if (!mutation) {
				return needsError(op, specNeeds(DCS_MESSAGE_SPECS[type]));
			}
			return { mutation };
		}
	}
}

/**
 * Описание макета рядом с файлом содержимого: каталог содержимого назван по макету,
 * а описание — одноимённый XML на уровень выше (с Ext и без него).
 */
async function templateDescriptorNextTo(contentFile: string): Promise<string | undefined> {
	const candidates = [
		`${path.dirname(path.dirname(contentFile))}.xml`,
		`${path.dirname(contentFile)}.xml`,
	];
	for (const candidate of candidates) {
		if (candidate !== '.xml' && (await fileExists(candidate))) {
			return candidate;
		}
	}
	return undefined;
}

/**
 * Находит файл содержимого схемы компоновки по path команды.
 *
 * Принимается сам файл содержимого (`Ext/Template.xml` выгрузки конфигуратора, `Template.dcs`
 * проекта EDT) или описание макета рядом с ним (`Templates/<Имя>.xml`, `.mdo` общего макета EDT) —
 * агент чаще знает путь описания из дерева выгрузки, чем путь содержимого.
 *
 * @param raw - Параметр path команды
 * @param baseDir - Корень проекта для относительных путей
 * @returns Промис, который разрешается файлом содержимого с рабочим каталогом и версией формата либо текстом отказа
 */
export async function resolveDcsSchemaTarget(raw: unknown, baseDir: string | undefined): Promise<DcsTargetResolution> {
	const resolved = absolutePathOf(
		raw,
		baseDir,
		'Передайте path: файл содержимого схемы компоновки (Templates/<Имя>/Ext/Template.xml выгрузки ' +
			'конфигуратора или Template.dcs проекта EDT) либо описание макета рядом с ним.'
	);
	if ('error' in resolved) {
		return resolved;
	}
	const { abs } = resolved;
	if (!(await fileExists(abs))) {
		return { error: `Файл не найден: ${abs}` };
	}
	const base = path.basename(abs).toLowerCase();
	let contentFile: string;
	if (base.endsWith('.dcs')) {
		contentFile = abs;
	} else if (base === 'template.xml') {
		if ((await classifyTemplateContent(abs)) !== 'dcs') {
			return { error: `Файл не является схемой компоновки данных: ${abs}` };
		}
		contentFile = abs;
	} else {
		// Описание макета: содержимое лежит в одноимённом каталоге, его находит общий поиск
		const found = await findTemplateContent(abs);
		if (found === undefined || (await classifyTemplateContent(found)) !== 'dcs') {
			return { error: `Рядом с описанием макета нет содержимого схемы компоновки: ${abs}` };
		}
		contentFile = found;
	}
	if (contentFile.toLowerCase().endsWith('.dcs')) {
		return {
			target: {
				objectXml: contentFile,
				cwd: (await edtRootOf(contentFile)) ?? path.dirname(contentFile),
				schemaVersion: EDT_SCHEMA_FLAG,
			},
		};
	}
	return designerTarget(contentFile, await templateDescriptorNextTo(contentFile));
}
