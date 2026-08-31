/**
 * Монопольный доступ к файловой информационной базе.
 *
 * Пока базу держит автономный сервер, конфигуратор её не откроет: загрузка,
 * выгрузка и обновление конфигурации БД падают. Держатель базы регистрируется
 * тем, кто её занял, а команды на время работы просят её освободить.
 *
 * @module exclusiveInfobase
 */

import type { VRunnerIntent } from './vrunnerCli/intents';

/** Тот, кто держит файловую базу открытой. */
export interface InfobaseHolder {
	/** Название для сообщений: «Автономный сервер остановлен на время загрузки». */
	readonly label: string;
	/** Держит ли базу прямо сейчас. */
	isHolding(): boolean;
	/** Отпускает базу; false - отпустить не удалось. */
	release(): Promise<boolean>;
	/** Занимает базу снова после команды. */
	restore(): Promise<void>;
}

let holder: InfobaseHolder | undefined;

/**
 * Регистрирует держателя базы. Повторный вызов заменяет прежнего.
 *
 * @param next - Держатель или undefined, чтобы забыть прежнего
 */
export function registerInfobaseHolder(next: InfobaseHolder | undefined): void {
	holder = next;
}

/** Держатель базы, если он зарегистрирован. */
export function infobaseHolder(): InfobaseHolder | undefined {
	return holder;
}

/**
 * Виды намерений, которым нужен монопольный доступ к базе: платформа открывает
 * базу проекта своим процессом, а занятую другим процессом она не откроет.
 *
 * Сборка и разборка файлов (`cf.build`, `cf.decompileFile`, `cfe.buildCfe`)
 * сюда не входит: vanessa-runner выполняет их во временной базе, базу проекта
 * такие команды не трогают. Команды кластера (`session.*`, `jobs.*`) работают
 * с серверными базами, к файловой они неприменимы.
 */
const EXCLUSIVE_INTENT_KINDS: ReadonlySet<VRunnerIntent['kind']> = new Set([
	'infobase.init',
	'infobase.updateDb',
	'infobase.updateExtension',
	'infobase.dumpDt',
	'infobase.restoreDt',
	'infobase.listExtensions',
	'cf.loadFromSrc',
	'cf.loadFileToIb',
	'cf.dumpIbToSrc',
	'cf.unloadIbToCf',
	'cf.makeDist',
	'cfe.loadFromSrc',
	'cfe.loadFromCfeFile',
	'cfe.dumpIbToSrc',
	'cfe.unloadIbToCfe',
	'cfe.decompileCfeFile',
	'epf.build',
	'epf.decompile',
	'run.designer',
	'run.enterprise',
	'test.vanessa',
	'test.xunit',
	'validate.syntaxCheck',
]);

/**
 * Нужен ли намерению монопольный доступ к информационной базе.
 *
 * @param kind - Вид намерения vrunner
 * @returns true, если на время выполнения базу нужно освободить
 */
export function needsExclusiveInfobase(kind: VRunnerIntent['kind']): boolean {
	return EXCLUSIVE_INTENT_KINDS.has(kind);
}

/**
 * Нужен ли монопольный доступ хотя бы одному намерению цепочки.
 *
 * @param intents - Намерения, которые выполнит команда
 * @returns true, если базу нужно освободить на время всей цепочки
 */
export function anyNeedsExclusiveInfobase(intents: readonly VRunnerIntent[]): boolean {
	return intents.some((intent) => needsExclusiveInfobase(intent.kind));
}

/**
 * Останется ли база занятой после завершения команды.
 *
 * `--no-wait` отпускает конфигуратор или предприятие жить дальше: vrunner
 * завершается сразу, а базу продолжает держать само приложение 1С.
 *
 * @param intents - Намерения, которые выполнит команда
 * @returns true, если возвращать базу держателю по завершении команды нельзя
 */
export function keepsInfobaseAfterRun(intents: readonly VRunnerIntent[]): boolean {
	return intents.some((intent) => 'noWait' in intent && intent.noWait === true);
}
