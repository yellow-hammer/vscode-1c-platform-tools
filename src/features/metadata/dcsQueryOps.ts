/**
 * Команда агента `1c-platform-tools.dcs.query`: разбор, сборка и запись текста запроса набора СКД
 * той же моделью, что у конструктора запроса webview.
 *
 * Модель запроса живёт одним файлом — `resources/webview/dcs-editor-query-model.js` (чистые
 * функции, `module.exports`): его исполняют webview, node-тесты и хост. Копии кода на TypeScript нет,
 * чтобы разбор агента и конструктора не разошёлся; хост грузит файл так же, как node-тесты, — в
 * песочнице функции с подменой module и window.
 *
 * Модуль без зависимости от vscode: формы действий и загрузку модуля проверяют node-тесты.
 *
 * @module dcsQueryOps
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import {
	dcsAutofillOfResult,
	dcsBatchAnswersOf,
	dcsBatchParamsOf,
	dcsBatchProblem,
	dcsDeclaredParameterNames,
	dcsQueryBatchOf,
	dcsQueryDataSetOf,
	dcsQueryDataSetProblem,
	type DcsAutofillResultDto,
} from './dcsPanelMessages';
import type { MdSparrowParams } from './mdSparrowParams';

/** Позиция первого расхождения самопроверки или первого неразобранного места. */
export interface DcsQueryPosition {
	offset: number;
	line: number;
	column: number;
}

/** Функции модели запроса, которые нужны хосту (полный API — JSDoc модуля webview). */
export interface DcsQueryModelApi {
	parse(text: string): { model: Record<string, unknown>; diagnostics: Array<{ message?: string } & Partial<DcsQueryPosition>> };
	/** Сборка с отчётом: какие запросы пакета собраны заново и сколько комментариев в них пропало. */
	buildWithReport(model: unknown, options?: { lang?: 'ru' | 'en'; eol?: '\r\n' | '\n' }): { text: string; comments: { total: number; dropped: number } };
	selfCheck(text: string): { ok: boolean; firstDiff?: DcsQueryPosition };
	parametersOf(text: string): string[];
}

/** Файл модели запроса в составе расширения: тот же, что подключает webview. */
export function dcsQueryModelFile(extensionRoot: string): string {
	return path.join(extensionRoot, 'resources', 'webview', 'dcs-editor-query-model.js');
}

const loaded = new Map<string, DcsQueryModelApi>();

/**
 * Модель запроса из файла webview: исполняется один раз на файл, дальше — из памяти.
 *
 * Обёртка-функция в текущем realm, как у node-тестов: модуль пишет в module.exports, а подменённый
 * window не даёт ему записать DcsQueryModel в глобалы хоста.
 *
 * @param extensionRoot Корень расширения (context.extensionPath) или репозитория в тестах.
 */
export function loadDcsQueryModel(extensionRoot: string): DcsQueryModelApi {
	const file = dcsQueryModelFile(extensionRoot);
	const known = loaded.get(file);
	if (known) {
		return known;
	}
	const code = fs.readFileSync(file, 'utf8');
	const factory = vm.runInThisContext(`(function (module, window) {\n${code}\n})`, { filename: file }) as (
		moduleShim: { exports: unknown },
		windowShim: Record<string, unknown>
	) => void;
	const moduleShim: { exports: unknown } = { exports: {} };
	factory(moduleShim, {});
	const api = moduleShim.exports as Partial<DcsQueryModelApi>;
	if (typeof api.parse !== 'function' || typeof api.buildWithReport !== 'function' || typeof api.selfCheck !== 'function' || typeof api.parametersOf !== 'function') {
		throw new Error(`Модуль модели запроса не загружен: в ${file} нет parse/buildWithReport/selfCheck/parametersOf.`);
	}
	loaded.set(file, api as DcsQueryModelApi);
	return api as DcsQueryModelApi;
}

/** Опции сборки текста: язык ключевых слов и перевод строки; не заданы — как в модели. */
export interface DcsQueryBuildOptions {
	lang?: 'ru' | 'en';
	eol?: '\r\n' | '\n';
}

/** Действие команды dcs.query после проверки аргументов. */
export type DcsQueryAction =
	| { action: 'parse'; text: string }
	| { action: 'parse'; dataSet: string }
	| { action: 'build'; model: Record<string, unknown>; options: DcsQueryBuildOptions }
	| {
			action: 'apply';
			dataSet: string;
			text?: string;
			model?: Record<string, unknown>;
			options: DcsQueryBuildOptions;
			autofill?: boolean;
	  };

const ACTIONS = 'parse, build, apply';

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildOptionsOf(opts: Record<string, unknown>): DcsQueryBuildOptions | { error: string } {
	const options: DcsQueryBuildOptions = {};
	if (opts.lang !== undefined) {
		if (opts.lang !== 'ru' && opts.lang !== 'en') {
			return { error: 'Параметр lang: ru или en (язык ключевых слов собранного текста).' };
		}
		options.lang = opts.lang;
	}
	if (opts.eol !== undefined) {
		if (opts.eol !== '\n' && opts.eol !== '\r\n') {
			return { error: 'Параметр eol: "\\n" или "\\r\\n".' };
		}
		options.eol = opts.eol;
	}
	return options;
}

function dataSetOf(opts: Record<string, unknown>): string | undefined {
	const dataSet = typeof opts.dataSet === 'string' ? opts.dataSet.trim() : '';
	return dataSet === '' || dataSet.split('/').some((part) => part.trim() === '') ? undefined : dataSet;
}

/**
 * Проверяет аргументы dcs.query:
 * - `{action: 'parse', text}` — разбор переданного текста; `{action: 'parse', path, dataSet}` — текста
 *   набора схемы (path проверяет команда);
 * - `{action: 'build', model, lang?, eol?}` — текст по модели;
 * - `{action: 'apply', path, dataSet, model | text, autofill?, lang?, eol?}` — запись текста в набор
 *   пакетом конструктора: текст, недостающие параметры, автозаполнение.
 */
export function dcsQueryActionOf(opts: Record<string, unknown>): DcsQueryAction | { error: string } {
	const action = opts.action;
	if (action === 'parse') {
		if (typeof opts.text === 'string') {
			return { action, text: opts.text };
		}
		const dataSet = dataSetOf(opts);
		if (dataSet === undefined) {
			return { error: 'Для parse передайте text (текст запроса) или path и dataSet (набор схемы: имя или путь «Объединение/Дочерний»).' };
		}
		return { action, dataSet };
	}
	if (action === 'build') {
		if (!isObject(opts.model)) {
			return { error: 'Для build передайте model (модель запроса из ответа parse).' };
		}
		const options = buildOptionsOf(opts);
		return 'error' in options ? options : { action, model: opts.model, options };
	}
	if (action === 'apply') {
		const dataSet = dataSetOf(opts);
		if (dataSet === undefined) {
			return { error: 'Для apply передайте dataSet (набор-запрос схемы: имя или путь «Объединение/Дочерний»).' };
		}
		const hasText = typeof opts.text === 'string';
		const hasModel = isObject(opts.model);
		if (hasText === hasModel) {
			return { error: 'Для apply передайте ровно одно из двух: text (готовый текст запроса) или model (модель из parse).' };
		}
		if (opts.autofill !== undefined && typeof opts.autofill !== 'boolean') {
			return { error: 'Параметр autofill: булево значение; без него поля заполняются, если у набора включено автозаполнение.' };
		}
		const options = buildOptionsOf(opts);
		if ('error' in options) {
			return options;
		}
		return {
			action,
			dataSet,
			text: hasText ? (opts.text as string) : undefined,
			model: hasModel ? (opts.model as Record<string, unknown>) : undefined,
			options,
			autofill: opts.autofill as boolean | undefined,
		};
	}
	return { error: `Действие «${String(action ?? '')}» неизвестно (action: одно из ${ACTIONS}).` };
}

/** Ответ parse: модель, диагностика разборщика и самопроверка круга «текст → модель → текст». */
export interface DcsQueryParseResult {
	model: Record<string, unknown>;
	diagnostics: unknown[];
	/** ok: false — сборка теряет или меняет лексемы; firstDiff — где (так конструктор уходит в режим «только текст»). */
	selfCheck: { ok: boolean; firstDiff?: DcsQueryPosition };
}

export function dcsQueryParse(api: DcsQueryModelApi, text: string): DcsQueryParseResult {
	const parsed = api.parse(text);
	return { model: parsed.model, diagnostics: parsed.diagnostics, selfCheck: api.selfCheck(text) };
}

/** Собранный по модели текст и комментарии: dropped — сколько пропало в изменённых запросах пакета. */
export interface DcsQueryBuilt {
	text: string;
	comments: { total: number; dropped: number };
	/** Есть, если комментарии пропали: конструктор в этом месте спрашивает подтверждение. */
	warning?: string;
}

function countOf(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Текст по модели. Модель пришла от агента и могла быть собрана руками: исключение сборщика
 * становится отказом с причиной, а не падением команды. Комментарии в изменённых запросах пакета
 * сборщик не сохраняет: конструктор перед ОК об этом предупреждает, агент получает счёт
 * comments.dropped и предупреждение, а не молчаливую потерю.
 */
export function dcsQueryBuild(api: DcsQueryModelApi, model: unknown, options: DcsQueryBuildOptions): DcsQueryBuilt | { error: string } {
	try {
		const report = api.buildWithReport(model, options);
		// Счётчики идут от comments.total модели агента: оно может быть любым числом
		const comments = { total: countOf(report.comments.total), dropped: countOf(report.comments.dropped) };
		const built: DcsQueryBuilt = { text: report.text, comments };
		if (comments.dropped > 0) {
			built.warning = `В изменённых запросах пакета пропадут комментарии (${comments.dropped}): такие запросы собираются заново; неизменённые запросы выводятся исходным текстом.`;
		}
		return built;
	} catch (error) {
		return { error: `Модель запроса не собрана: ${(error instanceof Error ? error.message : String(error)).slice(0, 400)}` };
	}
}

/** Итог запуска md-sparrow, как его отдаёт канал расширения. */
export interface DcsQueryRunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/**
 * Ввод-вывод действий dcs.query со схемой: чтение cf-dcs-info и запуск пакета. Команда подаёт канал
 * md-sparrow расширения, node-тесты — подделку.
 */
export interface DcsQueryIo {
	readInfo(): Promise<{ json: unknown } | { error: string; exitCode?: number }>;
	runBatch(params: MdSparrowParams): Promise<DcsQueryRunResult>;
	/** Текст отказа md-sparrow для агента. */
	errorText(result: DcsQueryRunResult): string;
}

/** Отказ действия: текст и код выхода md-sparrow, если отказал он. */
export type DcsQueryFailure = { error: string; exitCode?: number };

/** parse `{path, dataSet}`: текст набора из свежей модели и его разбор. */
export async function dcsQueryParseDataSet(
	api: DcsQueryModelApi,
	io: DcsQueryIo,
	dataSet: string
): Promise<{ data: { dataSet: string; text: string } & DcsQueryParseResult } | DcsQueryFailure> {
	const info = await io.readInfo();
	if ('error' in info) {
		return info;
	}
	const problem = dcsQueryDataSetProblem(info.json, dataSet);
	if (problem !== undefined) {
		return { error: problem };
	}
	const text = dcsQueryDataSetOf(info.json, dataSet)?.query ?? '';
	return { data: { dataSet, text, ...dcsQueryParse(api, text) } };
}

/** Ответ apply: записанный текст, объявленные параметры, итог автозаполнения, ответы пакета и свежая модель. */
export interface DcsQueryApplyData {
	text: string;
	/** Текст совпал с записанным, а параметры объявлены: ничего не писалось. */
	unchanged?: true;
	/** Только у apply по model: комментарии, пропавшие в изменённых запросах пакета. */
	comments?: { total: number; dropped: number };
	addedParameters: string[];
	autofill?: DcsAutofillResultDto;
	result?: unknown;
	model?: unknown;
}

/**
 * Пустой текст запроса набора не записывается: md-sparrow считает пустой payloadJson
 * `cf-dcs-set-query` отсутствующим и отказывает техническим текстом, а у набора-запроса без текста
 * нет полей. Проверка даёт понятный отказ до запуска пакета записи запроса; разбор сообщения
 * `dcs/apply-query` пустой текст пропускает: окно конструктора пустой запрос не отправит — его
 * останавливает проверка «нет полей выборки».
 *
 * @param text - Новый текст запроса набора
 * @returns Текст отказа либо undefined, если текст есть.
 */
function dcsEmptyQueryProblem(text: string): string | undefined {
	return text.trim() === ''
		? 'Запрос не записан: текст запроса пуст. У набора-запроса должен быть текст; очистить его нельзя, задайте запрос или удалите набор.'
		: undefined;
}

/**
 * apply `{dataSet, text | model, autofill?}` — запись как ОК конструктора: свежая модель (набор-запрос
 * по пути и объявленные параметры), текст (из model — сборкой), пакет канала query с недостающими
 * `&`-параметрами (без учёта регистра) и автозаполнением, если оно включено у набора (autofill
 * переопределяет), проверка каталогом канала, запуск и перечитка. Текст, совпавший с записанным, при
 * объявленных параметрах не пишется вовсе.
 *
 * Зовётся внутри очереди мутаций: модель читается там же, где пишется.
 *
 * @returns Данные ответа (warning — запись прошла, а перечитка нет) либо отказ.
 */
export async function dcsQueryApply(
	api: DcsQueryModelApi,
	io: DcsQueryIo,
	action: Extract<DcsQueryAction, { action: 'apply' }>,
	address: { objectXml: string; schemaVersion: string }
): Promise<{ data: DcsQueryApplyData; warning?: string } | DcsQueryFailure> {
	let text = action.text;
	let built: DcsQueryBuilt | undefined;
	if (text === undefined) {
		const result = dcsQueryBuild(api, action.model, action.options);
		if ('error' in result) {
			return result;
		}
		built = result;
		text = result.text;
	}
	const empty = dcsEmptyQueryProblem(text);
	if (empty !== undefined) {
		return { error: empty };
	}
	const info = await io.readInfo();
	if ('error' in info) {
		return info;
	}
	const problem = dcsQueryDataSetProblem(info.json, action.dataSet);
	if (problem !== undefined) {
		return { error: problem };
	}
	const dataSet = dcsQueryDataSetOf(info.json, action.dataSet);
	const autofill = action.autofill ?? dataSet?.autoFillFields !== false;
	const batch = dcsQueryBatchOf(
		{ dataSet: action.dataSet, text, addParameters: api.parametersOf(text), autofill },
		dcsDeclaredParameterNames(info.json)
	);
	if (text === (dataSet?.query ?? '') && batch.addedParameters.length === 0) {
		return { data: { text, unchanged: true, addedParameters: [], model: info.json } };
	}
	const refusal = dcsBatchProblem('query', batch.mutations);
	if (refusal !== undefined) {
		return { error: refusal };
	}
	const params = dcsBatchParamsOf(batch.mutations, address.objectXml, address.schemaVersion);
	const result = await io.runBatch(params);
	if (result.exitCode !== 0) {
		return { error: io.errorText(result), exitCode: result.exitCode };
	}
	const data: DcsQueryApplyData = {
		text,
		addedParameters: batch.addedParameters,
		autofill: dcsAutofillOfResult(params, result.stdout),
		result: dcsBatchAnswersOf(result.stdout),
	};
	if (built) {
		data.comments = built.comments;
	}
	const notes =
		built && built.comments.dropped > 0
			? [`Запрос записан без комментариев изменённых запросов пакета (${built.comments.dropped}): такие запросы собираются заново; неизменённые записаны исходным текстом.`]
			: [];
	const fresh = await io.readInfo();
	if ('error' in fresh) {
		notes.push(`Запрос записан, но модель не перечитана. ${fresh.error}`);
		return { data, warning: notes.join(' ') };
	}
	return notes.length > 0 ? { data: { ...data, model: fresh.json }, warning: notes.join(' ') } : { data: { ...data, model: fresh.json } };
}
