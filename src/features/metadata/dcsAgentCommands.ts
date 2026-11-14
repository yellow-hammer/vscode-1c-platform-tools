/**
 * Команды агента для схемы компоновки данных: работают с файлом макета без открытой панели.
 *
 * Семь команд `1c-platform-tools.dcs.*` принимают один объект опций (как все вызовы MCP),
 * адресуют файл параметрами path/ownerPath (относительные пути — от корня проекта) и
 * возвращают {@link StructuredCommandResult} с данными в data. Чтения идут через резидентный
 * канал md-sparrow, правки — через общую очередь правок расширения: дерево, вкладки СКД и агент
 * пишут те же файлы, параллельные CLI столкнулись бы на них.
 *
 * @module dcsAgentCommands
 */

import * as vscode from 'vscode';
import { inCurrentProject } from '../../commands/projectScope';
import { isPlainObject } from '../../shared/agentGate';
import type { StructuredCommandResult } from '../../shared/commandExecutionTypes';
import { logger } from '../../shared/logger';
import { currentRoot } from '../../shared/workspaceProjects';
import { DCS_OWNER_OPS, dcsApplyMutationOf, resolveDcsSchemaTarget } from './dcsAgentOps';
import {
	dcsQueryActionOf,
	dcsQueryApply,
	dcsQueryBuild,
	dcsQueryParse,
	dcsQueryParseDataSet,
	loadDcsQueryModel,
	type DcsQueryFailure,
	type DcsQueryIo,
	type DcsQueryModelApi,
} from './dcsQueryOps';
import {
	dcsTemplateMutationParams,
	resolveDcsOwnerTarget,
	type DcsResolvedTarget,
	type DcsTemplateOp,
} from './dcsTargets';
import { ensureMdSparrowRuntime, type MdSparrowRuntime } from './mdSparrowBootstrap';
import { runMdSparrowParamsMutation, runMdSparrowParamsRead, type MdSparrowParams } from './mdSparrowParams';

const log = logger.scope('metadata');

/** Столько текста ошибки md-sparrow уходит агенту: ему нужна причина, а не весь стек. */
const ERROR_TEXT_LIMIT = 2000;

function failure(stderr: string, exitCode = 1): StructuredCommandResult {
	return { success: false, exitCode, stdout: '', stderr };
}

function success(data: unknown): StructuredCommandResult {
	return { success: true, exitCode: 0, stdout: '', stderr: '', data };
}

/** Опции вызова: MCP передаёт один простой объект; иной аргумент значит, что полей нет. */
function optionsOf(arg: unknown): Record<string, unknown> {
	return isPlainObject(arg) ? arg : {};
}

/** База относительных путей: корень проекта из опций канала либо текущий проект. */
function baseDirOf(opts: Record<string, unknown>): string | undefined {
	const projectPath = opts.projectPath;
	return typeof projectPath === 'string' && projectPath !== '' ? projectPath : currentRoot();
}

/** Текст отказа md-sparrow для агента: stderr, иначе stdout, иначе код выхода. */
function mdSparrowErrorOf(result: { exitCode: number; stdout: string; stderr: string }): string {
	return (result.stderr.trim() || result.stdout.trim() || `код ${result.exitCode}`).slice(0, ERROR_TEXT_LIMIT);
}

/** Среда выполнения md-sparrow либо отказ: без java и jar командам агента работать не на чем. */
async function runtimeOf(context: vscode.ExtensionContext): Promise<{ runtime: MdSparrowRuntime } | { failure: StructuredCommandResult }> {
	try {
		return { runtime: await ensureMdSparrowRuntime(context) };
	} catch (error) {
		const message = (error instanceof Error ? error.message : String(error)).slice(0, ERROR_TEXT_LIMIT);
		return { failure: failure(`Компонент md-sparrow недоступен. ${message}`) };
	}
}

/** Чтение read-json с разбором ответа; отказ возвращается готовым результатом команды. */
async function readJson(
	runtime: MdSparrowRuntime,
	params: MdSparrowParams,
	cwd: string
): Promise<{ json: unknown } | { failure: StructuredCommandResult }> {
	const result = await runMdSparrowParamsRead(runtime, params, { cwd });
	if (result.exitCode !== 0) {
		log.error(`${params.op}: ${mdSparrowErrorOf(result)}`);
		return { failure: failure(mdSparrowErrorOf(result), result.exitCode) };
	}
	try {
		return { json: JSON.parse(result.stdout.trim()) as unknown };
	} catch {
		return { failure: failure(`Ответ ${params.op} не разобран как JSON.`) };
	}
}

/** Ответ мутации md-sparrow: JSON, когда он есть (added/skipped и подобное), иначе сырой текст. */
function mutationResultOf(stdout: string): unknown {
	const text = stdout.trim();
	if (text === '') {
		return undefined;
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}

/** Параметры адресации схемы для канала md-sparrow. */
function addressOf(target: DcsResolvedTarget): Pick<MdSparrowParams, 'objectXml' | 'schemaVersion'> {
	return { objectXml: target.objectXml, schemaVersion: target.schemaVersion };
}

/**
 * dcs.read {path, variant?}: модель cf-dcs-info; без variant — плюс список вариантов настроек,
 * с variant — плюс настройки названного варианта (cf-dcs-settings-info).
 */
async function readCommand(context: vscode.ExtensionContext, arg: unknown): Promise<StructuredCommandResult> {
	const opts = optionsOf(arg);
	const variant = opts.variant;
	if (variant !== undefined && (typeof variant !== 'string' || variant === '')) {
		return failure('Параметр variant: непустое имя варианта настроек.');
	}
	const resolved = await resolveDcsSchemaTarget(opts.path, baseDirOf(opts));
	if ('error' in resolved) {
		return failure(resolved.error);
	}
	const prepared = await runtimeOf(context);
	if ('failure' in prepared) {
		return prepared.failure;
	}
	const address = addressOf(resolved.target);
	const info = await readJson(prepared.runtime, { op: 'cf-dcs-info', ...address }, resolved.target.cwd);
	if ('failure' in info) {
		return info.failure;
	}
	const settingsParams: MdSparrowParams = { op: 'cf-dcs-settings-info', ...address };
	if (variant !== undefined) {
		settingsParams.variant = variant;
	}
	const settings = await readJson(prepared.runtime, settingsParams, resolved.target.cwd);
	if ('failure' in settings) {
		return settings.failure;
	}
	const variants = ((settings.json as { variants?: unknown[] } | null)?.variants ?? []).filter(
		(entry) => typeof entry === 'object' && entry !== null
	);
	if (variant === undefined) {
		return success({ model: info.json, variants });
	}
	// cf-dcs-settings-info с variant возвращает ровно названный вариант, неизвестное имя отклоняет сам
	return success({ model: info.json, variant: variants[0] });
}

/**
 * dcs.apply {path, op, params}: одна мутация из белого каталога правок СКД; операция вне
 * каталога отклоняется до запуска jar, после правки возвращается свежая модель cf-dcs-info.
 */
async function applyCommand(
	context: vscode.ExtensionContext,
	runMutation: <T>(fn: () => Promise<T>) => Promise<T>,
	arg: unknown
): Promise<StructuredCommandResult> {
	const opts = optionsOf(arg);
	const mapped = dcsApplyMutationOf(opts.op, opts.params);
	if ('error' in mapped) {
		return failure(mapped.error);
	}
	const op = mapped.mutation.op;
	// Операции макетов адресуют описание владельца, остальные — содержимое схемы
	const resolved = DCS_OWNER_OPS.has(op)
		? await resolveDcsOwnerTarget(opts.path, baseDirOf(opts))
		: await resolveDcsSchemaTarget(opts.path, baseDirOf(opts));
	if ('error' in resolved) {
		return failure(resolved.error);
	}
	const prepared = await runtimeOf(context);
	if ('failure' in prepared) {
		return prepared.failure;
	}
	return runMutation(async () => {
		const result = await runMdSparrowParamsMutation(
			prepared.runtime,
			{ ...mapped.mutation, ...addressOf(resolved.target) },
			{ cwd: resolved.target.cwd }
		);
		if (result.exitCode !== 0) {
			log.error(`${op}: ${mdSparrowErrorOf(result)}`);
			return failure(mdSparrowErrorOf(result), result.exitCode);
		}
		const mutationResult = mutationResultOf(result.stdout);
		if (DCS_OWNER_OPS.has(op)) {
			// Правка владельца содержимое схемы не меняет: перечитывать модель не по чему
			return success({ result: mutationResult });
		}
		const info = await readJson(prepared.runtime, { op: 'cf-dcs-info', ...addressOf(resolved.target) }, resolved.target.cwd);
		if ('failure' in info) {
			// Правка прошла, перечитка нет: успех не прячется, причина уходит предупреждением
			return {
				success: true,
				exitCode: 0,
				stdout: '',
				stderr: `Правка выполнена, но модель не перечитана. ${info.failure.stderr}`,
				data: { result: mutationResult },
			};
		}
		return success({ result: mutationResult, model: info.json });
	});
}

/** dcs.validate {path}: строгая проверка схемы; вердикт jar возвращается как есть. */
async function validateCommand(context: vscode.ExtensionContext, arg: unknown): Promise<StructuredCommandResult> {
	const opts = optionsOf(arg);
	const resolved = await resolveDcsSchemaTarget(opts.path, baseDirOf(opts));
	if ('error' in resolved) {
		return failure(resolved.error);
	}
	const prepared = await runtimeOf(context);
	if ('failure' in prepared) {
		return prepared.failure;
	}
	const verdict = await readJson(
		prepared.runtime,
		{ op: 'cf-dcs-validate', ...addressOf(resolved.target), strict: true },
		resolved.target.cwd
	);
	if ('failure' in verdict) {
		return verdict.failure;
	}
	return success(verdict.json);
}

/**
 * dcs.typeDictionary {path}: словарь окна «Тип значения» (cf-dcs-type-dictionary) — что можно
 * записать новым типом в `valueType` правок dcs.apply; ответ jar возвращается как есть.
 */
async function typeDictionaryCommand(context: vscode.ExtensionContext, arg: unknown): Promise<StructuredCommandResult> {
	const opts = optionsOf(arg);
	const resolved = await resolveDcsSchemaTarget(opts.path, baseDirOf(opts));
	if ('error' in resolved) {
		return failure(resolved.error);
	}
	const prepared = await runtimeOf(context);
	if ('failure' in prepared) {
		return prepared.failure;
	}
	const dictionary = await readJson(
		prepared.runtime,
		{ op: 'cf-dcs-type-dictionary', ...addressOf(resolved.target) },
		resolved.target.cwd
	);
	if ('failure' in dictionary) {
		return dictionary.failure;
	}
	return success(dictionary.json);
}

/** Модель запроса из файла webview расширения; не загрузилась — отказ команды с причиной. */
function queryModelOf(context: vscode.ExtensionContext): { api: DcsQueryModelApi } | { failure: StructuredCommandResult } {
	try {
		return { api: loadDcsQueryModel(context.extensionPath) };
	} catch (error) {
		return { failure: failure((error instanceof Error ? error.message : String(error)).slice(0, ERROR_TEXT_LIMIT)) };
	}
}

/**
 * dcs.query {action: parse|build|apply, …}: модель запроса конструктора для агента.
 *
 * - parse `{text}` или `{path, dataSet}` — модель, диагностика разборщика и самопроверка круга;
 * - build `{model, lang?, eol?}` — текст по модели (неизменённые запросы пакета — исходным срезом);
 * - apply `{path, dataSet, model | text, autofill?, lang?, eol?}` — запись как ОК конструктора: одним
 *   пакетом текст, недостающие `&`-параметры (только имя) и, если у набора включено автозаполнение
 *   (или autofill: true), автозаполнение полей; затем свежая модель. Текст, совпавший с записанным,
 *   при объявленных параметрах не пишется вовсе — как «модель не менялась» у конструктора.
 */
async function queryCommand(
	context: vscode.ExtensionContext,
	runMutation: <T>(fn: () => Promise<T>) => Promise<T>,
	arg: unknown
): Promise<StructuredCommandResult> {
	const opts = optionsOf(arg);
	const action = dcsQueryActionOf(opts);
	if ('error' in action) {
		return failure(action.error);
	}
	const model = queryModelOf(context);
	if ('failure' in model) {
		return model.failure;
	}
	const { api } = model;
	if (action.action === 'parse' && 'text' in action) {
		return success(dcsQueryParse(api, action.text));
	}
	if (action.action === 'build') {
		const built = dcsQueryBuild(api, action.model, action.options);
		if ('error' in built) {
			return failure(built.error);
		}
		// Потеря комментариев не прячется: текст есть, а причина — предупреждением, как у записи
		return built.warning === undefined ? success(built) : { success: true, exitCode: 0, stdout: '', stderr: built.warning, data: built };
	}
	const resolved = await resolveDcsSchemaTarget(opts.path, baseDirOf(opts));
	if ('error' in resolved) {
		return failure(resolved.error);
	}
	const prepared = await runtimeOf(context);
	if ('failure' in prepared) {
		return prepared.failure;
	}
	const { runtime } = prepared;
	const target = resolved.target;
	const io: DcsQueryIo = {
		readInfo: async () => {
			const info = await readJson(runtime, { op: 'cf-dcs-info', ...addressOf(target) }, target.cwd);
			return 'failure' in info ? { error: info.failure.stderr, exitCode: info.failure.exitCode } : { json: info.json };
		},
		runBatch: (params) => runMdSparrowParamsMutation(runtime, params, { cwd: target.cwd }),
		errorText: mdSparrowErrorOf,
	};
	const answerOf = (outcome: { data: unknown; warning?: string } | DcsQueryFailure): StructuredCommandResult => {
		if ('error' in outcome) {
			return failure(outcome.error, outcome.exitCode ?? 1);
		}
		// Запись прошла, перечитка нет: успех не прячется, причина уходит предупреждением
		return outcome.warning === undefined
			? success(outcome.data)
			: { success: true, exitCode: 0, stdout: '', stderr: outcome.warning, data: outcome.data };
	};
	if (action.action === 'parse') {
		return answerOf(await dcsQueryParseDataSet(api, io, action.dataSet));
	}
	// Схема читается в очереди: правка, стоявшая раньше, могла объявить параметр или сменить набор
	return runMutation(async () => {
		const outcome = await dcsQueryApply(api, io, action, { objectXml: target.objectXml, schemaVersion: target.schemaVersion });
		if ('error' in outcome) {
			log.error(`dcs.query apply: ${outcome.error}`);
		}
		return answerOf(outcome);
	});
}

/** Общая часть dcs.templateAdd и dcs.templateRemove: мутация над описанием владельца. */
async function templateCommand(
	context: vscode.ExtensionContext,
	runMutation: <T>(fn: () => Promise<T>) => Promise<T>,
	arg: unknown,
	op: DcsTemplateOp
): Promise<StructuredCommandResult> {
	const opts = optionsOf(arg);
	const name = opts.name;
	if (typeof name !== 'string' || name === '') {
		return failure('Передайте name (имя макета).');
	}
	const makeMain = opts.makeMain;
	if (op === 'cf-dcs-template-add' && makeMain !== undefined && typeof makeMain !== 'boolean') {
		return failure('Параметр makeMain: булево значение.');
	}
	const resolved = await resolveDcsOwnerTarget(opts.ownerPath, baseDirOf(opts));
	if ('error' in resolved) {
		return failure(resolved.error);
	}
	const prepared = await runtimeOf(context);
	if ('failure' in prepared) {
		return prepared.failure;
	}
	// Параметры собирает та же функция, что у дерева метаданных: команда и меню дерева не расходятся
	const params = dcsTemplateMutationParams(op, resolved.target, name, typeof makeMain === 'boolean' ? makeMain : undefined);
	return runMutation(async () => {
		const result = await runMdSparrowParamsMutation(prepared.runtime, params, { cwd: resolved.target.cwd });
		if (result.exitCode !== 0) {
			log.error(`${op}: ${mdSparrowErrorOf(result)}`);
			return failure(mdSparrowErrorOf(result), result.exitCode);
		}
		return success({ result: mutationResultOf(result.stdout) });
	});
}

/**
 * Регистрирует команды агента `1c-platform-tools.dcs.*`.
 *
 * @param context - Контекст расширения
 * @param runMutation - Общая очередь правок md-sparrow: та же, в которой пишут дерево и вкладки СКД,
 *   иначе правка агента и правка в открытой вкладке того же файла шли бы одновременно
 * @returns Регистрации команд для подписки
 */
export function registerDcsAgentCommands(
	context: vscode.ExtensionContext,
	runMutation: <T>(fn: () => Promise<T>) => Promise<T>
): vscode.Disposable[] {
	const registerDcsCommand = (id: string, handler: (arg?: unknown) => Promise<StructuredCommandResult>): vscode.Disposable =>
		vscode.commands.registerCommand(id, inCurrentProject(handler));
	return [
		registerDcsCommand('1c-platform-tools.dcs.read', (arg) => readCommand(context, arg)),
		registerDcsCommand('1c-platform-tools.dcs.apply', (arg) => applyCommand(context, runMutation, arg)),
		registerDcsCommand('1c-platform-tools.dcs.validate', (arg) => validateCommand(context, arg)),
		registerDcsCommand('1c-platform-tools.dcs.typeDictionary', (arg) => typeDictionaryCommand(context, arg)),
		registerDcsCommand('1c-platform-tools.dcs.query', (arg) => queryCommand(context, runMutation, arg)),
		registerDcsCommand('1c-platform-tools.dcs.templateAdd', (arg) => templateCommand(context, runMutation, arg, 'cf-dcs-template-add')),
		registerDcsCommand('1c-platform-tools.dcs.templateRemove', (arg) => templateCommand(context, runMutation, arg, 'cf-dcs-template-remove')),
	];
}
