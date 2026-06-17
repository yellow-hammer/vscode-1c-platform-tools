import { XMLParser } from 'fast-xml-parser';

/**
 * Разобранная версия vanessa-runner (vrunner).
 *
 * Сравнение возможностей ведётся по тройке major.minor.patch; пометка
 * предрелиза (`prerelease`) сохраняется для отображения, но НЕ влияет на
 * гейтинг возможностей — см. {@link supportsFeature}.
 */
export interface VRunnerVersion {
	/** Мажорная версия (например, 3 для 3.0.0). */
	major: number;
	/** Минорная версия. */
	minor: number;
	/** Патч-версия. */
	patch: number;
	/** Пометка предрелиза без ведущего дефиса (например, 'rc3'), если есть. */
	prerelease?: string;
	/** Исходная строка версии (для логов и отображения). */
	raw: string;
}

/**
 * Возможности vrunner, доступные начиная с указанной версии.
 *
 * Значение — минимальная версия (major.minor.patch), в которой возможность
 * появилась. Предрелизы этой версии считаются поддерживающими возможность
 * (например, `--ibsrv-attach` появился в 3.0.0-rc3 — гейт `3.0.0`
 * срабатывает и для `3.0.0-rc3`, и для финальной `3.0.0`).
 */
export const VRUNNER_FEATURES = {
	/** Новый CLI vrunner 3.x (BREAKING CHANGES относительно 2.x). */
	cli3: '3.0.0',
	/** Флаги запуска через автономный сервер: --ibsrv / --ibsrv-direct / --ibsrv-debug. */
	ibsrv: '3.0.0',
	/** Подключение к внешнему ibsrv: --ibsrv-attach / --ibsrv-port (3.0.0-rc3). */
	ibsrvAttach: '3.0.0',
} as const;

/** Идентификатор возможности vrunner для гейтинга по версии. */
export type VRunnerFeature = keyof typeof VRUNNER_FEATURES;

/**
 * Разбирает строку версии vrunner.
 *
 * Подходит для вывода `vrunner version` (печатает чистую строку версии,
 * например `2.6.0` или `3.0.0-rc3`). Извлекает первую найденную
 * semver-подобную последовательность, поэтому терпим к лишнему тексту.
 *
 * ВАЖНО: использовать команду `vrunner version`, а НЕ `vrunner --version` —
 * последняя в vrunner не поддерживается и завершается ошибкой.
 *
 * @param output - Вывод команды `vrunner version`
 * @returns Разобранная версия или undefined, если версию не удалось извлечь
 */
export function parseVRunnerVersion(output: string): VRunnerVersion | undefined {
	if (!output) {
		return undefined;
	}

	// major.minor[.patch][-prerelease]; patch необязателен (на всякий случай).
	const match = output.match(/(\d+)\.(\d+)(?:\.(\d+))?(?:[-_]([0-9A-Za-z.-]+))?/);
	if (!match) {
		return undefined;
	}

	const [raw, major, minor, patch, prerelease] = match;
	return {
		major: Number(major),
		minor: Number(minor),
		patch: patch ? Number(patch) : 0,
		prerelease: prerelease || undefined,
		raw: raw.trim(),
	};
}

/**
 * Извлекает версию vanessa-runner из содержимого opm-metadata.xml.
 *
 * Запасной источник версии, когда вызов `vrunner version` недоступен.
 *
 * @param xml - Содержимое файла opm-metadata.xml
 * @returns Разобранная версия или undefined
 */
export function parseVRunnerVersionFromOpmMetadata(xml: string): VRunnerVersion | undefined {
	if (!xml) {
		return undefined;
	}

	let parsed: Record<string, unknown>;
	try {
		const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });
		parsed = parser.parse(xml) as Record<string, unknown>;
	} catch {
		return undefined;
	}

	const metadata = parsed['opm-metadata'] as Record<string, unknown> | undefined;
	const version = metadata?.['version'];
	if (typeof version !== 'string' && typeof version !== 'number') {
		return undefined;
	}

	return parseVRunnerVersion(String(version));
}

/**
 * Сравнивает версии по тройке major.minor.patch (предрелиз игнорируется).
 *
 * @returns -1 если a < b, 0 если равны, 1 если a > b
 */
export function compareVRunnerVersions(a: VRunnerVersion, b: VRunnerVersion): number {
	if (a.major !== b.major) {
		return a.major < b.major ? -1 : 1;
	}
	if (a.minor !== b.minor) {
		return a.minor < b.minor ? -1 : 1;
	}
	if (a.patch !== b.patch) {
		return a.patch < b.patch ? -1 : 1;
	}
	return 0;
}

/**
 * Проверяет, что версия не ниже целевой (по major.minor.patch).
 *
 * Предрелиз целевой версии считается удовлетворяющим: `3.0.0-rc3`
 * удовлетворяет `>= 3.0.0` (возможность уже есть в ветке 3.0).
 *
 * @param version - Проверяемая версия
 * @param target - Целевая версия в виде строки (например, '3.0.0')
 * @returns true, если version >= target
 */
export function isAtLeast(version: VRunnerVersion, target: string): boolean {
	const parsedTarget = parseVRunnerVersion(target);
	if (!parsedTarget) {
		return false;
	}
	return compareVRunnerVersions(version, parsedTarget) >= 0;
}

/**
 * Поддерживается ли возможность vrunner данной версией.
 *
 * @param version - Версия vrunner
 * @param feature - Идентификатор возможности (см. {@link VRUNNER_FEATURES})
 * @returns true, если возможность доступна
 */
export function supportsFeature(version: VRunnerVersion, feature: VRunnerFeature): boolean {
	return isAtLeast(version, VRUNNER_FEATURES[feature]);
}
