/**
 * Готовность инструментов к исходникам в формате 1С:EDT.
 *
 * Команды над исходниками получают путь к тому, что лежит в проекте, а формат
 * там бывает любой. vanessa-runner понимает 1С:EDT начиная с `3.0.0-rc8`: до неё
 * он читает исходники как выгрузку конфигуратора и падает на первом же файле.
 * Внешние обработки и отчёты в формате EDT он не собирает и не разбирает вовсе.
 *
 * @module edtToolingGate
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SourceFormat } from '../../shared/projectLayout';
import type { VRunnerIntent } from '../../shared/vrunnerCli/intents';
import { isAtLeast, VRUNNER_FEATURES, type VRunnerVersion } from '../../shared/vrunnerVersion';

/** Насколько глубоко искать файлы описаний: внешняя обработка EDT лежит в src/ExternalDataProcessors/<Имя>. */
const FORMAT_PROBE_DEPTH = 4;

/** Интенты, работающие с исходниками конфигурации и расширений. */
const SOURCE_INTENTS: ReadonlySet<VRunnerIntent['kind']> = new Set([
	'infobase.init',
	'cf.loadFromSrc',
	'cf.dumpIbToSrc',
	'cf.build',
	'cfe.loadFromSrc',
	'cfe.dumpIbToSrc',
	'cfe.buildCfe',
]);

/** Интенты, которые формат EDT не берут ни в какой версии раннера. */
const EXTERNAL_INTENTS: ReadonlySet<VRunnerIntent['kind']> = new Set(['epf.build', 'epf.decompile']);

/** Интенты, раскладывающие файл поставки в исходники конфигуратора. */
const DECOMPILE_INTENTS: ReadonlySet<VRunnerIntent['kind']> = new Set([
	'cf.decompileFile',
	'cfe.decompileCfeFile',
]);

/**
 * Путь исходников, с которыми идёт команда.
 *
 * @param intent - Что собирались запустить
 * @returns Путь или пустая строка, если команда работает не с исходниками
 */
export function intentSourcePath(intent: VRunnerIntent): string {
	if ('src' in intent && typeof intent.src === 'string') {
		return intent.src;
	}
	return 'out' in intent && typeof intent.out === 'string' ? intent.out : '';
}

/**
 * Формат исходников в каталоге по файлам описаний.
 *
 * Тестовые обработки живут отдельно от конфигурации и в свой формат не обязаны
 * с ней совпадать: раннер раскладывает их выгрузкой конфигуратора и при
 * конфигурации в EDT.
 *
 * @param directory - Абсолютный путь к каталогу исходников
 * @returns Формат или undefined, если каталога нет или описаний в нём не нашлось
 */
export function sourceFormatOfDirectory(directory: string): SourceFormat | undefined {
	if (!fs.existsSync(directory)) {
		return undefined;
	}
	const queue: { dir: string; depth: number }[] = [{ dir: directory, depth: 0 }];
	let sawXml = false;
	while (queue.length > 0) {
		const { dir, depth } = queue.shift()!;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith('.mdo')) {
				return 'edt';
			}
			if (entry.isFile() && entry.name.endsWith('.xml')) {
				sawXml = true;
			}
			if (entry.isDirectory() && depth < FORMAT_PROBE_DEPTH) {
				queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
			}
		}
	}
	return sawXml ? 'designer' : undefined;
}

/** Один ли это каталог: пути приходят относительными и с разными разделителями. */
export function samePath(left: string, right: string | undefined): boolean {
	if (!left || !right) {
		return false;
	}
	const normalize = (value: string) => value.split('\\').join('/').replace(/[/]+$/, '').toLowerCase();
	return normalize(left) === normalize(right);
}

/**
 * Почему команда не выполнится на исходниках EDT.
 *
 * @param intent - Что собирались запустить
 * @param source - Формат и каталог исходников, с которыми работает команда
 * @param version - Версия vanessa-runner; undefined, когда её не удалось определить
 * @returns Объяснение либо undefined, если препятствий нет
 */
export function edtToolingRefusal(
	intent: VRunnerIntent,
	source: { format?: 'designer' | 'edt'; dir?: string } | undefined,
	version: VRunnerVersion | undefined
): string | undefined {
	const sourceFormat = source?.format;
	if (sourceFormat !== 'edt') {
		return undefined;
	}
	if (EXTERNAL_INTENTS.has(intent.kind)) {
		return 'Внешние обработки и отчёты в формате 1С:EDT vanessa-runner не собирает и не разбирает. Сконвертируйте исходники в формат конфигуратора.';
	}
	// Разборка кладёт выгрузку конфигуратора: поверх проекта EDT это каша из
	// двух форматов. В другой каталог она разрешена
	if (DECOMPILE_INTENTS.has(intent.kind)) {
		const target = 'out' in intent ? String(intent.out ?? '') : '';
		return samePath(target, source?.dir)
			? 'Разборка кладёт исходники в формате конфигуратора, а в этом каталоге лежит проект 1С:EDT. Выберите другой каталог.'
			: undefined;
	}
	if (!SOURCE_INTENTS.has(intent.kind)) {
		return undefined;
	}
	// Версию не определили - не мешаем: раннер сам скажет, если не справится
	if (version === undefined || isAtLeast(version, VRUNNER_FEATURES.edtSources)) {
		return undefined;
	}
	return 'Исходники в формате 1С:EDT понимает vanessa-runner 3.0.0-rc8 и новее. Обновите раннер или сконвертируйте исходники в формат конфигуратора.';
}
