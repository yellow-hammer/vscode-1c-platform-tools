/**
 * Сводка прогона тестов по jUnit-отчёту для синхронного режима (wait: true).
 *
 * Код возврата процесса vrunner не отражает результат тестов: упавшие тесты
 * и несозданный отчёт выглядят как «успех». Модуль читает jUnit-отчёт прогона
 * (файл или каталог), отбрасывает отчёты старше времени старта прогона и
 * строит сводку для структурированного результата.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseJUnitXml, JUnitCase } from './parsers/junitParser';
import { parseCucumberJson } from './parsers/cucumberParser';
import type { TestRunStats } from '../../shared/commandExecutionTypes';

/** Максимум упавших тестов в сводке (защита от гигантских ответов). */
const MAX_FAILED_IN_SUMMARY = 20;

/** Формат отчёта прогона. */
export type RunReportFormat = 'junit' | 'cucumber';

/**
 * Собирает список файлов отчёта по пути.
 *
 * @param reportPath - Файл отчёта или каталог с файлами
 * @param extension - Расширение файлов отчёта ('.xml' | '.json')
 * @returns Абсолютные пути к файлам (пусто, если путь не существует)
 */
async function collectReportFiles(reportPath: string, extension: string): Promise<string[]> {
	try {
		const stat = await fs.stat(reportPath);
		if (stat.isFile()) {
			return [reportPath];
		}
		const entries = await fs.readdir(reportPath, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension))
			.map((entry) => path.join(reportPath, entry.name));
	} catch {
		return [];
	}
}

/**
 * Читает jUnit-отчёт прогона и строит сводку.
 *
 * Файлы старше notBeforeMs игнорируются: отчёт предыдущего прогона не должен
 * выдаваться за результат текущего.
 *
 * @param reportPath - Файл отчёта или каталог с *.xml
 * @param notBeforeMs - Время старта прогона (Date.now() перед запуском)
 * @returns Сводка либо undefined, если свежего отчёта нет
 */
export async function readRunSummary(
	reportPath: string,
	notBeforeMs: number,
	format: RunReportFormat = 'junit'
): Promise<TestRunStats | undefined> {
	const files = await collectReportFiles(reportPath, format === 'cucumber' ? '.json' : '.xml');
	const cases: JUnitCase[] = [];
	let freshFiles = 0;
	for (const file of files) {
		try {
			const stat = await fs.stat(file);
			if (stat.mtimeMs < notBeforeMs) {
				continue;
			}
			const content = await fs.readFile(file, 'utf8');
			cases.push(...(format === 'cucumber' ? parseCucumberJson(content) : parseJUnitXml(content)));
			freshFiles++;
		} catch {
			// нечитаемый или повреждённый файл сводку не пополняет
		}
	}
	if (freshFiles === 0) {
		return undefined;
	}

	const stats: TestRunStats = {
		total: cases.length,
		passed: cases.filter((c) => c.status === 'passed').length,
		failed: cases.filter((c) => c.status === 'failed').length,
		errors: cases.filter((c) => c.status === 'error').length,
		skipped: cases.filter((c) => c.status === 'skipped').length,
		reportPath,
		failedTests: cases
			.filter((c) => c.status === 'failed' || c.status === 'error')
			.slice(0, MAX_FAILED_IN_SUMMARY)
			.map((c) => (c.suiteName && c.suiteName !== c.name ? `${c.suiteName}: ${c.name}` : c.name)),
	};
	return stats;
}

/**
 * Текстовая сводка прогона для stdout структурированного результата.
 *
 * @param stats - Сводка прогона
 * @returns Многострочный текст
 */
export function formatRunSummary(stats: TestRunStats): string {
	const lines = [
		`Тестов: ${stats.total}, успешно: ${stats.passed}, упало: ${stats.failed}, ошибок: ${stats.errors}, пропущено: ${stats.skipped}`,
		`Отчёт: ${stats.reportPath}`,
	];
	if (stats.failedTests.length > 0) {
		lines.push('Упавшие тесты:');
		for (const name of stats.failedTests) {
			lines.push(`  - ${name}`);
		}
		const hidden = stats.failed + stats.errors - stats.failedTests.length;
		if (hidden > 0) {
			lines.push(`  ... и ещё ${hidden}`);
		}
	}
	return lines.join('\n');
}
