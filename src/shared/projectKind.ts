/**
 * Вид проекта: проект 1С в формате конфигуратора или EDT, проект 1С без исходного
 * кода или проект OneScript.
 *
 * Исходный код 1С в раскладке делает проект проектом 1С, даже если в нём есть свои
 * скрипты OneScript. Без исходного кода решает `packagedef`: пакет, который
 * объявляет классы, модули или исполняемый файл, это OneScript; зависимость от
 * vanessa-runner, vanessa-automation или add, как у шаблона нового проекта, это
 * проект 1С; остальное OneScript.
 * @module projectKind
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { declaresPackageApi, dependsOn, parsePackagedef, type PackageManifest } from './packagedef';
import { PROJECT_FILE, resolveProjectLayout, type ProjectLayout, type SourceFormat } from './projectLayout';

/** Вид проекта: формат исходного кода 1С, `onec` без исходного кода, `onescript`. */
export type ProjectKind = SourceFormat | 'onec' | 'onescript';

/** Подписи видов проектов. */
export const PROJECT_KIND_LABELS: Readonly<Record<ProjectKind, string>> = {
	designer: 'Конфигуратор',
	edt: 'EDT',
	onec: '1С',
	onescript: 'OneScript',
};

/** Все виды проектов. */
export const PROJECT_KINDS: readonly ProjectKind[] = ['designer', 'edt', 'onec', 'onescript'];

/** Проект работает с платформой 1С. */
export function isOneCProjectKind(kind: ProjectKind): boolean {
	return kind !== 'onescript';
}

/** Инструменты разработки на платформе 1С: зависимость от них делает проект проектом 1С. */
const PLATFORM_TOOLS = ['vanessa-runner', 'vanessa-automation', 'vanessa-automation-single', 'add'];

/**
 * Вид проекта по его раскладке и описанию пакета.
 *
 * @param layout - Раскладка корня проекта
 * @param packagedef - Текст `packagedef` или прочитанное описание
 */
export function projectKindOf(layout: ProjectLayout, packagedef: string | PackageManifest): ProjectKind {
	const sources = [
		...(layout.configuration ? [layout.configuration] : []),
		...layout.extensions,
		...layout.testExtensions,
		...layout.processors,
		...layout.reports,
		...layout.testProcessors,
	];
	if (sources.length > 0) {
		return sources[0].format;
	}
	const manifest = typeof packagedef === 'string' ? parsePackagedef(packagedef) : packagedef;
	if (declaresPackageApi(manifest)) {
		return 'onescript';
	}
	return PLATFORM_TOOLS.some((tool) => dependsOn(manifest, tool)) ? 'onec' : 'onescript';
}

/**
 * Вид проекта в каталоге.
 *
 * @param root - Каталог проекта
 * @returns вид; undefined, если в каталоге нет `packagedef`
 */
export async function detectProjectKind(root: string): Promise<ProjectKind | undefined> {
	let packagedef: string;
	try {
		packagedef = await fs.readFile(path.join(root, PROJECT_FILE), 'utf-8');
	} catch {
		return undefined;
	}
	return projectKindOf(await resolveProjectLayout(root), packagedef);
}
