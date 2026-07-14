/**
 * Надёжный канал команд md-sparrow через UTF-8 JSON-файл (изменения и чтение).
 *
 * На Windows лаунчер `java.exe` декодирует `argv` через ANSI-кодовую страницу ОС
 * (её расширение не контролирует, а `-Dsun.jnu.encoding` на это не влияет — свойство read-only),
 * поэтому кириллические имена и пути, переданные как опции/аргументы, превращаются в `?`.
 * Здесь все строковые значения (пути, имена, JSON-payload) уходят в UTF-8 JSON, а в `argv`
 * остаётся только ASCII-путь к самому файлу параметров (`os.tmpdir()` ASCII во всех реальных
 * конфигурациях: кириллическое имя пользователя возможно лишь на cp1251, где argv и так не искажается).
 *
 * - `runMdSparrowParamsMutation` → подкоманда `apply-mutation` (мутации, set, scaffold);
 * - `runMdSparrowParamsRead` → подкоманда `read-json` (свойства/структура/дерево/граф/списки), JSON в stdout.
 *
 * @module mdSparrowParams
 */

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type * as vscode from 'vscode';
import { runMdSparrow, type MdSparrowRunResult } from './mdSparrowRunner';
import type { MdSparrowRuntime } from './mdSparrowBootstrap';

/** Операция; значения совпадают с именами одиночных подкоманд md-sparrow. */
export type MdSparrowOp =
	// изменения (apply-mutation)
	| 'cf-md-object-delete'
	| 'cf-md-object-rename'
	| 'cf-md-object-duplicate'
	| 'cf-md-attribute-add'
	| 'cf-md-attribute-rename'
	| 'cf-md-attribute-delete'
	| 'cf-md-attribute-duplicate'
	| 'cf-md-tabular-section-add'
	| 'cf-md-tabular-section-rename'
	| 'cf-md-tabular-section-delete'
	| 'cf-md-tabular-section-duplicate'
	| 'cf-md-tabular-attribute-add'
	| 'cf-md-tabular-attribute-rename'
	| 'cf-md-tabular-attribute-delete'
	| 'cf-md-tabular-attribute-duplicate'
	| 'cf-md-attribute-reorder'
	| 'cf-md-tabular-section-reorder'
	| 'cf-md-tabular-attribute-reorder'
	| 'external-artifact-rename'
	| 'external-artifact-delete'
	| 'external-artifact-duplicate'
	| 'external-artifact-add'
	| 'external-artifact-properties-set'
	| 'cf-md-object-set'
	| 'cf-configuration-properties-set'
	| 'init-empty-cf'
	| 'add-md-object'
	// чтение (read-json)
	| 'cf-md-object-get'
	| 'cf-md-object-structure-get'
	| 'external-artifact-properties-get'
	| 'cf-configuration-properties-get'
	| 'cf-list-child-objects'
	| 'cf-list-catalogs'
	| 'project-metadata-tree'
	| 'cf-md-graph';

/** Параметры команды; сериализуются в UTF-8 JSON и читаются `apply-mutation`/`read-json`. */
export interface MdSparrowParams {
	op: MdSparrowOp;
	configurationXml?: string;
	objectXml?: string;
	artifactsRoot?: string;
	targetCfRoot?: string;
	projectRoot?: string;
	/** Каталоги исходников относительно projectRoot; пусто — стандартные src/cf, src/cfe, src/epf, src/erf. */
	cfDir?: string;
	cfeDir?: string;
	epfDir?: string;
	erfDir?: string;
	tag?: string;
	name?: string;
	oldName?: string;
	newName?: string;
	sourceName?: string;
	tabularSection?: string;
	/** Версия схемы в формате `V2_20` (как флаг `-v`). */
	schemaVersion?: string;
	type?: string;
	kind?: string;
	synonymRu?: string;
	synonymEmpty?: boolean;
	autoName?: boolean;
	/** Полезная нагрузка для set-операций: JSON DTO как строка. */
	payloadJson?: string;
}

/** Сквозной счётчик имён params-файлов: параллельные вызовы в одну миллисекунду не должны делить файл. */
let paramsFileSeq = 0;

async function writeParamsAndRun(
	runtime: MdSparrowRuntime,
	command: 'apply-mutation' | 'read-json',
	params: MdSparrowParams,
	options?: {
		cwd?: string;
		token?: vscode.CancellationToken;
	}
): Promise<MdSparrowRunResult> {
	paramsFileSeq += 1;
	const tmpPath = path.join(os.tmpdir(), `md-sparrow-${command}-${Date.now()}-${process.pid}-${paramsFileSeq}.json`);
	await fs.writeFile(tmpPath, JSON.stringify(params), 'utf8');
	try {
		return await runMdSparrow(runtime, [command, '--params', tmpPath], options);
	} finally {
		await fs.unlink(tmpPath).catch(() => undefined);
	}
}

/**
 * Выполняет изменение метаданных через `apply-mutation --params <utf8-json>`.
 *
 * @param runtime Среда выполнения md-sparrow (java + jar).
 * @param params Параметры операции (op и поля); пути, имена и payload идут в JSON, не в argv.
 * @param options cwd и токен отмены, как у {@link runMdSparrow}.
 */
export async function runMdSparrowParamsMutation(
	runtime: MdSparrowRuntime,
	params: MdSparrowParams,
	options?: {
		cwd?: string;
		token?: vscode.CancellationToken;
	}
): Promise<MdSparrowRunResult> {
	return writeParamsAndRun(runtime, 'apply-mutation', params, options);
}

/**
 * Выполняет чтение метаданных через `read-json --params <utf8-json>`; результат — JSON в `stdout`.
 *
 * @param runtime Среда выполнения md-sparrow (java + jar).
 * @param params Параметры операции (op и поля); пути идут в JSON, не в argv.
 * @param options cwd и токен отмены, как у {@link runMdSparrow}.
 */
export async function runMdSparrowParamsRead(
	runtime: MdSparrowRuntime,
	params: MdSparrowParams,
	options?: {
		cwd?: string;
		token?: vscode.CancellationToken;
	}
): Promise<MdSparrowRunResult> {
	return writeParamsAndRun(runtime, 'read-json', params, options);
}
