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
import * as vscode from 'vscode';
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
	| 'cf-md-enum-value-add'
	| 'cf-md-enum-value-rename'
	| 'cf-md-enum-value-delete'
	| 'cf-md-enum-value-duplicate'
	| 'cf-md-enum-value-reorder'
	| 'cf-md-accounting-flag-add'
	| 'cf-md-accounting-flag-rename'
	| 'cf-md-accounting-flag-delete'
	| 'cf-md-ext-dimension-accounting-flag-add'
	| 'cf-md-ext-dimension-accounting-flag-rename'
	| 'cf-md-ext-dimension-accounting-flag-delete'
	| 'cf-md-dimension-add'
	| 'cf-md-dimension-rename'
	| 'cf-md-dimension-delete'
	| 'cf-md-dimension-duplicate'
	| 'cf-md-dimension-reorder'
	| 'cf-md-resource-add'
	| 'cf-md-resource-rename'
	| 'cf-md-resource-delete'
	| 'cf-md-resource-duplicate'
	| 'cf-md-resource-reorder'
	| 'external-artifact-rename'
	| 'external-artifact-delete'
	| 'external-artifact-duplicate'
	| 'external-artifact-add'
	| 'external-artifact-properties-set'
	| 'cf-md-command-add'
	| 'cf-md-command-rename'
	| 'cf-md-command-delete'
	| 'cf-md-command-reorder'
	| 'cf-md-object-set'
	| 'cf-configuration-properties-set'
	| 'cf-form-item-properties-set'
	| 'init-empty-cf'
	| 'init-empty-cfe'
	| 'add-md-object'
	// чтение (read-json)
	| 'cf-md-object-get'
	| 'cf-enum-labels'
	| 'cf-md-object-enums'
	| 'cf-list-ref-types'
	| 'cf-md-object-structure-get'
	| 'cf-form-content-get'
	| 'cf-form-item-properties'
	| 'cf-form-standard-commands'
	| 'external-artifact-properties-get'
	| 'cf-configuration-properties-get'
	| 'cf-list-child-objects'
	| 'cf-list-all-child-objects'
	| 'cfe-borrow-object'
	| 'cf-form-add'
	| 'cf-form-compile'
	| 'cf-md-form-delete'
	| 'cf-md-exchange-plan-content-get'
	| 'cf-md-exchange-plan-content-set'
	| 'cf-list-catalogs'
	| 'cf-md-subsystem-tree'
	| 'cf-md-subsystem-command-interface-get'
	| 'cf-md-subsystem-command-visibility-set'
	| 'cf-role-rights-get'
	| 'cf-role-rights-set'
	| 'cf-support-get'
	| 'cf-support-object-get'
	| 'cf-support-object-states'
	| 'cf-support-object-mode-set'
	| 'cf-support-element-mode-set'
	| 'cf-support-remove'
	| 'cf-md-subsystem-command-placement-set'
	| 'cf-md-subsystem-command-order-set'
	| 'cf-md-subsystem-subsystems-order-set'
	| 'cf-md-subsystem-groups-order-set'
	| 'cf-dcs-info'
	| 'cf-dcs-set-query'
	| 'cf-dcs-add-calculated-field'
	| 'project-metadata-tree'
	| 'cf-md-graph'
	| 'cf-validate-dump';

/** Параметры команды; сериализуются в UTF-8 JSON и читаются `apply-mutation`/`read-json`. */
export interface MdSparrowParams {
	op: MdSparrowOp;
	configurationXml?: string;
	objectXml?: string;
	/** Файл содержимого формы: `Ext/Form.xml` в выгрузке конфигуратора, `Form.form` в проекте EDT. */
	formXml?: string;
	artifactsRoot?: string;
	targetCfRoot?: string;
	/** Каталог проверяемой выгрузки: src/cf или каталог расширения. */
	cfRoot?: string;
	/** Каталог создаваемого расширения (init-empty-cfe). */
	targetCfeRoot?: string;
	/** Configuration.xml расширяемой конфигурации: источник режимов совместимости. */
	mainConfigurationXml?: string;
	/** Префикс имён объектов расширения. */
	namePrefix?: string;
	/** Назначение расширения: patch, customization или add-on. */
	purpose?: string;
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
	/** Отпечаток прочитанных правил поддержки: правка поверх устаревшего снимка отклоняется. */
	expectedGeneration?: string;
	/** Полезная нагрузка для set-операций: JSON DTO как строка. */
	payloadJson?: string;
	/** Не смотреть на правила поддержки: правка идёт так, будто поставки нет. */
	ignoreSupport?: boolean;
}

/**
 * Учитывать ли поддержку поставщика: настройка расширения, по умолчанию включена.
 *
 * Когда её выключают, выгрузка правится так, будто поставки нет: библиотека не отказывает в
 * правке запрещённых объектов, а дерево не показывает признаков поддержки.
 */
export function supportEnabled(): boolean {
	return vscode.workspace.getConfiguration('1c-platform-tools').get<boolean>('metadata.supportEnabled') !== false;
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
	// Работа с поддержкой выключена: библиотека не смотрит на правила поставки
	const payload = supportEnabled() ? params : { ...params, ignoreSupport: true };
	await fs.writeFile(tmpPath, JSON.stringify(payload), 'utf8');
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
