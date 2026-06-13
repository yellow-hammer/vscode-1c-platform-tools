import { DiscoveredCase, DiscoveredFile } from './parserTypes';

/**
 * Парсер feature-файлов Gherkin (Vanessa Automation)
 *
 * Лёгкий построчный разбор без полной грамматики Gherkin: извлекает заголовок
 * функционала и список сценариев со строками объявления и тегами.
 * Поддерживает русские и английские ключевые слова.
 */

/** Ключевые слова заголовка функционала (русский и английский Gherkin) */
const FEATURE_KEYWORDS = [
	'Функционал',
	'Функциональность',
	'Функция',
	'Свойство',
	'Feature'
];

/** Ключевые слова сценария */
const SCENARIO_KEYWORDS = [
	'Структура сценария',
	'Шаблон сценария',
	'Сценарий',
	'Пример',
	'Scenario Outline',
	'Scenario Template',
	'Scenario',
	'Example'
];

/**
 * Пытается сопоставить строку с одним из ключевых слов вида `Ключевое слово: Название`
 *
 * @param trimmed - Строка без начальных пробелов
 * @param keywords - Список ключевых слов (более длинные должны идти раньше)
 * @returns Название после двоеточия или undefined
 */
function matchKeyword(trimmed: string, keywords: string[]): string | undefined {
	for (const keyword of keywords) {
		if (trimmed.startsWith(keyword)) {
			const rest = trimmed.slice(keyword.length).trimStart();
			if (rest.startsWith(':')) {
				return rest.slice(1).trim();
			}
		}
	}
	return undefined;
}

/**
 * Разбирает содержимое feature-файла
 *
 * Сценарии без названия пропускаются (их невозможно сопоставить с отчётом).
 * Теги `@...`, стоящие на строках выше сценария, относятся к нему.
 *
 * @param content - Содержимое файла (BOM допустим)
 * @returns Структура файла или undefined, если в файле нет ни функционала, ни сценариев
 */
export function parseFeatureFile(content: string): DiscoveredFile | undefined {
	// Убираем BOM, если есть
	const text = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
	const lines = text.split(/\r\n|\r|\n/);

	let label: string | undefined;
	let labelLine: number | undefined;
	const cases: DiscoveredCase[] = [];
	let pendingTags: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();

		if (trimmed.length === 0) {
			continue;
		}

		// Строка тегов: @smoke @tree — копим для следующего сценария
		if (trimmed.startsWith('@')) {
			const tags = trimmed
				.split(/\s+/)
				.filter((part) => part.startsWith('@'))
				.map((part) => part.slice(1))
				.filter((tag) => tag.length > 0);
			pendingTags.push(...tags);
			continue;
		}

		// Комментарии (включая # language: ru) на разбор не влияют
		if (trimmed.startsWith('#')) {
			continue;
		}

		const scenarioName = matchKeyword(trimmed, SCENARIO_KEYWORDS);
		if (scenarioName !== undefined) {
			if (scenarioName.length > 0) {
				cases.push({
					name: scenarioName,
					line: i,
					tags: pendingTags.length > 0 ? pendingTags : undefined
				});
			}
			pendingTags = [];
			continue;
		}

		if (label === undefined) {
			const featureName = matchKeyword(trimmed, FEATURE_KEYWORDS);
			if (featureName !== undefined && featureName.length > 0) {
				label = featureName;
				labelLine = i;
				pendingTags = [];
				continue;
			}
		}
	}

	if (label === undefined && cases.length === 0) {
		return undefined;
	}

	return { label, labelLine, cases };
}
