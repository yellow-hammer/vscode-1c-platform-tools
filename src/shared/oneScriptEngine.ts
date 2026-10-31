/**
 * Движок OneScript проекта: версии, установки OVM и выбор установки по `ВерсияСреды`.
 *
 * OVM ставит версии рядом, каждую в свой каталог, и `ovm use` переключает
 * версию для всей машины. Проекту машину переключать не нужно: он берёт свою
 * установку из каталога OVM. `ВерсияСреды` в `packagedef` для opm наименьшая
 * версия, на которой пакет ставится, поэтому движок машины не ниже неё проекту
 * подходит. Вместо движка ниже берётся установка этой версии, а без неё самая
 * новая той же старшей версии, но не ниже: библиотеки 1.x и 2.x движка разные.
 *
 * Модуль без vscode: версии и выбор чистые, список установок читает файловую систему.
 * @module oneScriptEngine
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getEngineBinaryCandidates, getOvmBaseDir, OVM_CURRENT } from './ovmPaths';

/** Версия движка: три числа и текст, как его вывел движок или записал проект. */
export interface EngineVersion {
	parts: [number, number, number];
	text: string;
}

/**
 * Версия из текста: вывода `oscript -version` (у 2.x три числа, у 1.x четыре),
 * `ВерсияСреды` или имени каталога установки. Недостающие числа считаются нулями.
 *
 * @param text - Текст с версией
 * @returns Первые три числа версии и её текст либо undefined
 */
export function parseEngineVersion(text: string): EngineVersion | undefined {
	const match = /(\d+)\.(\d+)(?:\.(\d+))?[^\s]*/.exec(text);
	if (!match) {
		return undefined;
	}
	return { parts: [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)], text: match[0] };
}

/**
 * Сравнивает версии по числам.
 *
 * @returns Отрицательное, если левая ниже, ноль при равенстве, положительное, если выше
 */
export function compareEngineVersions(left: readonly number[], right: readonly number[]): number {
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference !== 0) {
			return difference;
		}
	}
	return 0;
}

/** Версия не ниже наименьшей. */
export function engineVersionSupported(parts: readonly number[], min: readonly number[]): boolean {
	return compareEngineVersions(parts, min) >= 0;
}

/** Установка OneScript в каталоге OVM. */
export interface OvmInstallation {
	/** Имя каталога: версия или метка (`stable`, `lts`), с которой её поставили. */
	name: string;
	/** Каталог установки с bin и lib. */
	dir: string;
	/** Исполняемый файл движка. */
	oscript: string;
	/** Версия по имени каталога; у метки её нет. */
	version?: EngineVersion;
}

/**
 * Установки OneScript в каталоге OVM, кроме `current`: он лишь указывает на одну из них.
 *
 * @param baseDir - Каталог OVM
 * @returns Установки по имени каталога
 */
export function listOvmInstallations(baseDir: string = getOvmBaseDir()): OvmInstallation[] {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(baseDir, { withFileTypes: true });
	} catch {
		return [];
	}
	const found: OvmInstallation[] = [];
	for (const entry of entries) {
		if (entry.name === OVM_CURRENT || entry.name.startsWith('.') || entry.isFile()) {
			continue;
		}
		const dir = path.join(baseDir, entry.name);
		const oscript = getEngineBinaryCandidates(dir).find((candidate) => fs.existsSync(candidate));
		if (oscript === undefined) {
			continue;
		}
		const version = /^\d/.test(entry.name) ? parseEngineVersion(entry.name) : undefined;
		found.push({ name: entry.name, dir, oscript, ...(version ? { version } : {}) });
	}
	return found.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
}

/**
 * Установка для `ВерсияСреды`: этой версии, а без неё самая новая той же
 * старшей версии не ниже требуемой.
 *
 * @param required - `ВерсияСреды` проекта
 * @param installations - Установки OVM
 * @returns Установка или undefined, если подходящей нет
 */
export function pickEngineFor(required: string, installations: readonly OvmInstallation[]): OvmInstallation | undefined {
	const exact = installations.find((item) => item.name === required.trim());
	if (exact) {
		return exact;
	}
	const wanted = parseEngineVersion(required);
	if (!wanted) {
		return undefined;
	}
	return installations
		.filter((item) => item.version !== undefined)
		.filter((item) => item.version!.parts[0] === wanted.parts[0] && engineVersionSupported(item.version!.parts, wanted.parts))
		.sort((left, right) => compareEngineVersions(right.version!.parts, left.version!.parts))[0];
}

/**
 * Подходит ли проекту движок машины. Для opm `ВерсияСреды` — наименьшая версия,
 * поэтому подходит движок не ниже неё. Движок, чью версию узнать не удалось,
 * остаётся: сравнить его не с чем.
 *
 * @param version - Версия движка машины
 * @param required - `ВерсияСреды` проекта
 */
export function machineEngineFits(version: EngineVersion | undefined, required: string | undefined): boolean {
	const wanted = required === undefined ? undefined : parseEngineVersion(required);
	return wanted === undefined || version === undefined || engineVersionSupported(version.parts, wanted.parts);
}

/** Откуда взялся движок проекта. */
export type EngineSource = 'path' | 'chosen' | 'packagedef' | 'ovm' | 'system';

/** Подписи источников движка: для сводки окружения и выбора версии. */
export const ENGINE_SOURCE_LABELS: Readonly<Record<EngineSource, string>> = {
	path: 'настройка components.path.oscript',
	chosen: 'вручную',
	packagedef: 'ВерсияСреды в packagedef',
	ovm: 'текущая установка OVM',
	system: 'PATH',
};
