import { JUnitCase } from './junitParser';
import { extractExpectedActual } from './expectedActual';

/**
 * Парсер отчётов Cucumber JSON (Vanessa Automation)
 *
 * VA пишет Cucumber JSON при «ДелатьОтчетВФорматеCucumberJson»: true —
 * в реальных проектах этот формат часто включён вместо jUnit.
 * Результаты приводятся к JUnitCase, чтобы переиспользовать общий маппинг.
 *
 * Структура: массив фич { name, elements: [{ name, type: 'scenario',
 * steps: [{ name, result: { status, duration (нс), error_message } }] }] }.
 */

interface CucumberStepResult {
	status?: string;
	duration?: number;
	error_message?: string;
}

interface CucumberStep {
	keyword?: string;
	name?: string;
	result?: CucumberStepResult;
}

interface CucumberElement {
	name?: string;
	type?: string;
	keyword?: string;
	steps?: CucumberStep[];
}

interface CucumberFeature {
	name?: string;
	elements?: CucumberElement[];
}

/**
 * Определяет статус сценария по статусам шагов
 *
 * failed/undefined у любого шага → failed; иначе passed, если есть хоть один
 * passed; сценарий целиком из skipped/pending → skipped.
 */
function elementStatus(steps: CucumberStep[]): JUnitCase['status'] {
	let hasPassed = false;
	for (const step of steps) {
		const status = step.result?.status?.toLowerCase();
		if (status === 'failed' || status === 'undefined') {
			return 'failed';
		}
		if (status === 'passed') {
			hasPassed = true;
		}
	}
	return hasPassed ? 'passed' : 'skipped';
}

/**
 * Извлекает сообщение об ошибке первого упавшего шага
 */
function firstError(steps: CucumberStep[]): { message?: string; details?: string } {
	for (const step of steps) {
		const status = step.result?.status?.toLowerCase();
		if (status === 'failed' || status === 'undefined') {
			const stepTitle = `${step.keyword ?? ''}${step.name ?? ''}`.trim();
			return {
				message: stepTitle.length > 0 ? `Шаг: ${stepTitle}` : undefined,
				details: step.result?.error_message
			};
		}
	}
	return {};
}

/**
 * Разбирает отчёт Cucumber JSON
 *
 * @param json - Содержимое JSON-файла
 * @returns Список результатов сценариев в формате JUnitCase
 * @throws {Error} Если JSON повреждён или имеет неожиданную структуру
 */
export function parseCucumberJson(json: string): JUnitCase[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (error) {
		throw new Error(`Не удалось разобрать Cucumber JSON: ${(error as Error).message}`);
	}

	if (!Array.isArray(parsed)) {
		throw new Error('Cucumber JSON: ожидался массив фич');
	}

	const results: JUnitCase[] = [];

	for (const feature of parsed as CucumberFeature[]) {
		if (!feature || typeof feature !== 'object') {
			continue;
		}
		const featureName = feature.name ?? '';

		for (const element of feature.elements ?? []) {
			if (!element || typeof element !== 'object') {
				continue;
			}
			// Background и прочие не-сценарии пропускаем
			if (element.type !== undefined && element.type !== 'scenario') {
				continue;
			}

			const steps = element.steps ?? [];
			const status = elementStatus(steps);
			const { message, details } = firstError(steps);
			const diff = extractExpectedActual(details, message);

			// duration шагов — в наносекундах
			let totalNs = 0;
			let hasDuration = false;
			for (const step of steps) {
				if (typeof step.result?.duration === 'number') {
					totalNs += step.result.duration;
					hasDuration = true;
				}
			}

			results.push({
				suiteName: featureName,
				className: featureName,
				name: element.name ?? '',
				status,
				timeMs: hasDuration ? Math.round(totalNs / 1_000_000) : undefined,
				message,
				details,
				expected: diff?.expected,
				actual: diff?.actual
			});
		}
	}

	return results;
}
