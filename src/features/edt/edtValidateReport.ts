/**
 * Разбор отчёта проверки проекта 1С:EDT.
 *
 * `1cedtcli -command validate --file <отчёт>` пишет результат таблицей с
 * разделителями-табуляциями: строка на замечание. Формат без заголовка не
 * описан, поэтому колонки определяются по первой строке, а неизвестные поля
 * пропускаются - лучше показать замечание без части сведений, чем потерять его.
 *
 * @module edtValidateReport
 */

/** Замечание проверки. */
export interface EdtValidationFinding {
	/** Путь к файлу относительно проекта, если он указан. */
	file?: string;
	/** Строка в файле, начиная с единицы. */
	line?: number;
	/** Уровень: ошибка или предупреждение. */
	severity: 'error' | 'warning';
	/** Текст замечания. */
	message: string;
	/** Проект, к которому относится замечание. */
	project?: string;
}

/** Названия колонок, которые нас интересуют. */
const COLUMNS: Record<string, keyof EdtValidationFinding> = {
	project: 'project',
	проект: 'project',
	resource: 'file',
	file: 'file',
	ресурс: 'file',
	файл: 'file',
	line: 'line',
	строка: 'line',
	severity: 'severity',
	уровень: 'severity',
	type: 'severity',
	description: 'message',
	message: 'message',
	описание: 'message',
	сообщение: 'message',
};

/** Уровень замечания: всё, что не помечено предупреждением, считается ошибкой. */
function severityOf(value: string | undefined): 'error' | 'warning' {
	const text = (value ?? '').trim().toLowerCase();
	return text.startsWith('warn') || text.startsWith('предупре') ? 'warning' : 'error';
}

/**
 * Разбирает отчёт проверки.
 *
 * @param content - Содержимое файла отчёта
 * @returns Замечания в порядке следования в отчёте
 */
export function parseEdtValidationReport(content: string): EdtValidationFinding[] {
	const rows = content
		.split(/\r?\n/)
		.map((row) => row.trim())
		.filter((row) => row.length > 0)
		.map((row) => row.split('\t'));
	if (rows.length === 0) {
		return [];
	}

	const header = rows[0].map((cell) => cell.trim().toLowerCase());
	const known = header.filter((cell) => COLUMNS[cell] !== undefined);
	// Заголовок есть, когда по нему опознаются колонки; иначе таблица без него
	const hasHeader = known.length >= 2;
	const mapping = hasHeader
		? header.map((cell) => COLUMNS[cell])
		: (['project', 'file', 'line', 'severity', 'message'] as (keyof EdtValidationFinding)[]);

	const findings: EdtValidationFinding[] = [];
	for (const row of rows.slice(hasHeader ? 1 : 0)) {
		const values: Partial<Record<keyof EdtValidationFinding, string>> = {};
		row.forEach((cell, index) => {
			const column = mapping[index];
			if (column) {
				values[column] = cell.trim();
			}
		});

		const message = values.message ?? '';
		if (!message) {
			continue;
		}

		const line = Number(values.line);
		findings.push({
			file: values.file || undefined,
			line: Number.isFinite(line) && line > 0 ? line : undefined,
			severity: severityOf(values.severity),
			message,
			project: values.project || undefined,
		});
	}

	return findings;
}
