/**
 * Разбор отчёта проверки проекта 1С:EDT.
 *
 * `1cedtcli -command validate --file <отчёт>` пишет таблицу с разделителями-табуляциями,
 * без заголовка, по строке на замечание и восьми колонках:
 * время, важность, категория, проект, идентификатор проверки, объект метаданных,
 * положение и описание.
 *
 * Объект назван по-русски (`ОбщийМодуль.ОбщегоНазначения.Модуль`), а положение
 * приходит текстом: `строка 57`, `Имя`, либо пустым у замечаний к самому объекту.
 *
 * @module edtValidateReport
 */

/** Замечание проверки. */
export interface EdtValidationFinding {
	/** Объект метаданных, к которому относится замечание. */
	metadataPath?: string;
	/** Строка в модуле, начиная с единицы. */
	line?: number;
	/** Положение внутри объекта, когда это не строка модуля: `Имя`, `Право`. */
	position?: string;
	/** Уровень: ошибка, предупреждение или замечание. */
	severity: 'error' | 'warning' | 'info';
	/** Текст замечания. */
	message: string;
	/** Проект, к которому относится замечание. */
	project?: string;
	/** Категория проверки: «Стандарты кодирования», «Безопасность». */
	category?: string;
	/** Идентификатор проверки: по нему её отключают в настройках проекта. */
	check?: string;
}

/** Колонки отчёта в порядке файла. */
const enum Column {
	Time,
	Severity,
	Category,
	Project,
	Check,
	Metadata,
	Position,
	Message,
}

/** Сколько колонок в строке отчёта. */
const COLUMNS = 8;

/** Важность замечания в терминах отчёта. */
const SEVERITIES: Record<string, EdtValidationFinding['severity']> = {
	'ошибка конфигурации': 'error',
	критическая: 'error',
	значительная: 'warning',
	предупреждение: 'warning',
	незначительная: 'info',
	информация: 'info',
};

/** Номер строки из положения вида «строка 57». */
function lineOf(position: string): number | undefined {
	const match = /^\s*строка\s+(\d+)/i.exec(position);
	if (!match) {
		return undefined;
	}
	const line = Number(match[1]);
	return Number.isFinite(line) && line > 0 ? line : undefined;
}

/** Уровень замечания: незнакомая важность считается предупреждением. */
function severityOf(value: string): EdtValidationFinding['severity'] {
	return SEVERITIES[value.trim().toLowerCase()] ?? 'warning';
}

/**
 * Разбирает отчёт проверки.
 *
 * @param content - Содержимое файла отчёта
 * @returns Замечания в порядке следования в отчёте
 */
export function parseEdtValidationReport(content: string): EdtValidationFinding[] {
	const findings: EdtValidationFinding[] = [];
	for (const row of content.split(/\r?\n/)) {
		if (row.trim().length === 0) {
			continue;
		}
		const cells = row.split('\t');
		if (cells.length < COLUMNS) {
			continue;
		}

		const message = cells[Column.Message].trim();
		if (message.length === 0) {
			continue;
		}
		const position = cells[Column.Position].trim();
		const line = lineOf(position);
		findings.push({
			metadataPath: cells[Column.Metadata].trim() || undefined,
			line,
			position: line === undefined && position.length > 0 ? position : undefined,
			severity: severityOf(cells[Column.Severity]),
			message,
			project: cells[Column.Project].trim() || undefined,
			category: cells[Column.Category].trim() || undefined,
			check: cells[Column.Check].trim() || undefined,
		});
	}
	return findings;
}
