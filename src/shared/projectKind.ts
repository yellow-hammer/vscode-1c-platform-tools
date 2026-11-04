/**
 * Вид проекта: проект 1С в формате конфигуратора или EDT, проект 1С без исходного
 * кода или проект OneScript.
 *
 * Конфигурация или расширение делают проект проектом 1С в своём формате, даже если
 * `packagedef` объявляет классы. Внешний отчёт и обработка вид не меняют: проект
 * OneScript их держит и в выгрузке конфигуратора, и в 1C:EDT. Без конфигурации
 * решает `packagedef`: пакет с классами, модулями или исполняемым файлом это
 * OneScript; зависимость от vanessa-runner, vanessa-automation или add — проект 1С.
 * Остальное — OneScript. У такого проекта 1С
 * внешний объект задаёт формат, пока своей конфигурации нет.
 * @module projectKind
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { declaresPackageApi, dependsOn, parsePackagedef, type PackageManifest } from './packagedef';
import { SOURCE_FORMAT_LABELS } from './activeConfiguration';
import { PROJECT_FILE, resolveProjectLayout, type ProjectLayout, type SourceFormat } from './projectLayout';

/** Вид проекта: формат исходного кода 1С, `onec` без исходного кода, `onescript`. */
export type ProjectKind = SourceFormat | 'onec' | 'onescript';

/** Подписи видов проектов. */
export const PROJECT_KIND_LABELS: Readonly<Record<ProjectKind, string>> = {
	designer: SOURCE_FORMAT_LABELS.designer,
	edt: SOURCE_FORMAT_LABELS.edt,
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
function packagedefKind(manifest: PackageManifest): 'onec' | 'onescript' {
	if (declaresPackageApi(manifest)) {
		return 'onescript';
	}
	return PLATFORM_TOOLS.some((tool) => dependsOn(manifest, tool)) ? 'onec' : 'onescript';
}

export function projectKindOf(layout: ProjectLayout, packagedef: string | PackageManifest): ProjectKind {
	const manifest = typeof packagedef === 'string' ? parsePackagedef(packagedef) : packagedef;
	const kind = packagedefKind(manifest);
	const main = [
		...(layout.configuration ? [layout.configuration] : []),
		...layout.extensions,
		...layout.testExtensions,
	];
	if (main.length > 0) {
		return main[0].format;
	}
	const externals = [...layout.processors, ...layout.reports, ...layout.testProcessors];
	if (externals.length > 0 && kind === 'onec') {
		return externals[0].format;
	}
	return kind;
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
