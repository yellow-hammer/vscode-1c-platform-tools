/**
 * Разбор вывода утилиты администрирования кластера (rac).
 *
 * rac печатает результат плоскими блоками «ключ : значение», разделёнными
 * пустой строкой: один блок — один объект (кластер, сеанс, соединение). Строковые
 * значения берутся в двойные кавычки, внутренняя кавычка удваивается.
 *
 * Модуль чистый: ни файловой системы, ни процессов — только текст. Поэтому
 * разбор, декодирование и распознавание ошибок покрыты тестами без живого
 * сервера администрирования.
 */

/** Объект кластера как набор полей вывода rac. */
export type RacRecord = Record<string, string>;

/**
 * Строка «ключ : значение».
 *
 * Имена полей rac — строчная латиница, цифры, дефис и подчёркивание. Требование
 * строчных букв отсекает шапку утилиты («1C:Enterprise 8.3 Remote Administrative
 * Client Utility»), которая иначе прочиталась бы как поле `1C`.
 */
const FIELD_LINE_RE = /^\s*([a-z0-9_.-]+)\s*:(.*)$/;

/**
 * Переводит байт кодовой страницы 866 в символ Unicode.
 *
 * Кириллица в cp866 разложена тремя непрерывными участками, поэтому таблица не
 * нужна — хватает арифметики: 0x80–0xAF это «А»–«п», 0xE0–0xEF это «р»–«я»,
 * 0xF0–0xF1 это «Ё» и «ё». Остальная верхняя половина занята псевдографикой,
 * которой в выводе rac не бывает: такие байты заменяются знаком вопроса.
 *
 * @param byte - Байт верхней половины кодовой страницы
 * @returns Символ Unicode
 */
function cp866Char(byte: number): string {
	if (byte >= 0x80 && byte <= 0xaf) {
		return String.fromCharCode(0x0410 + (byte - 0x80));
	}
	if (byte >= 0xe0 && byte <= 0xef) {
		return String.fromCharCode(0x0440 + (byte - 0xe0));
	}
	if (byte === 0xf0) {
		return 'Ё';
	}
	if (byte === 0xf1) {
		return 'ё';
	}
	return '?';
}

/**
 * Декодирует байты вывода rac в строку.
 *
 * Основная кодировка — UTF-8. Если декодирование дало символ замены (U+FFFD),
 * вывод перекодируется как cp866: так выглядит вывод, прошедший через консоль
 * Windows с кодовой страницей 866. Таблицы cp866 в Node нет, поэтому
 * перекодировка своя — см. {@link cp866Char}.
 *
 * @param buffer - Байты stdout/stderr
 * @returns Декодированный текст
 */
export function decodeRacOutput(buffer: Buffer): string {
	const utf8 = buffer.toString('utf8');
	if (!utf8.includes('�')) {
		return utf8;
	}
	let decoded = '';
	for (const byte of buffer) {
		decoded += byte < 0x80 ? String.fromCharCode(byte) : cp866Char(byte);
	}
	return decoded;
}

/**
 * Снимает кавычки со строкового значения rac.
 *
 * @param value - Значение поля как есть
 * @returns Значение без внешних кавычек и с восстановленными внутренними
 */
export function unquoteRacValue(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.slice(1, -1).replace(/""/g, '"');
	}
	return trimmed;
}

/**
 * Разбирает вывод rac в список объектов.
 *
 * Блоки разделяются пустой строкой. Значение отрезается по первому двоеточию:
 * в датах (`started-at : 2024-05-01T10:15:00`) двоеточий несколько, и разбор по
 * последнему испортил бы значение. Строки, не похожие на поле, игнорируются —
 * так отбрасывается шапка утилиты, если она попала в поток.
 *
 * @param output - Текст вывода rac
 * @returns Список объектов; пустые блоки не возвращаются
 */
export function parseRacRecords(output: string): RacRecord[] {
	const records: RacRecord[] = [];
	let current: RacRecord = {};
	let filled = false;

	const flush = () => {
		if (filled) {
			records.push(current);
			current = {};
			filled = false;
		}
	};

	for (const rawLine of output.split(/\r?\n/)) {
		if (rawLine.trim() === '') {
			flush();
			continue;
		}
		const match = FIELD_LINE_RE.exec(rawLine);
		if (!match) {
			continue;
		}
		current[match[1]] = unquoteRacValue(match[2]);
		filled = true;
	}
	flush();

	return records;
}

/**
 * Разбирает вывод rac, ожидая ровно один объект.
 *
 * @param output - Текст вывода rac
 * @returns Первый объект или undefined, если вывод пуст
 */
export function parseRacRecord(output: string): RacRecord | undefined {
	return parseRacRecords(output)[0];
}

/**
 * Признак того, что утилита напечатала свою справку вместо работы.
 *
 * Незнакомую команду rac не считает ошибкой: печатает справку и завершается с
 * нулевым кодом. Без этой проверки действие, которого нет в установленной
 * версии платформы, выглядело бы выполненным — «прервал вызов», а на сервере
 * ничего не произошло.
 *
 * @param output - Вывод утилиты
 * @returns true, если это справка, а не результат команды
 */
export function isRacUsageOutput(output: string): boolean {
	const head = output.slice(0, 400);
	return /Remote Administrative Client Utility/i.test(head) || /^\s*Использование:/m.test(head);
}

/** Категория неудачи вызова rac: определяет подсказку и поведение UI. */
export type RacFailureKind = 'connection' | 'auth' | 'notFound' | 'version' | 'unknown';

/** Разобранная неудача вызова rac. */
export interface RacFailure {
	/** Категория неудачи. */
	kind: RacFailureKind;
	/** Короткое сообщение пользователю: что случилось и что с этим делать. */
	message: string;
	/** Полный вывод утилиты — для журнала. */
	output?: string;
}

/**
 * Признаки известных неудач: подстрока вывода → категория.
 *
 * rac переводит сообщения на язык платформы, поэтому в списке и русские, и
 * английские формулировки. Порядок важен: отказ по паролю распознаётся раньше
 * ошибки соединения, иначе общее «сервер администрирования» перехватило бы его.
 */
const FAILURE_SIGNS: Array<{ sign: string; kind: RacFailureKind }> = [
	// Формулировки платформы при отказе авторизации отличаются между версиями и
	// объектами: 8.5 отвечает «не аутентифицирован», прежние — «не разрешено».
	{ sign: 'не аутентифицирован', kind: 'auth' },
	{ sign: 'администратор центрального сервера', kind: 'auth' },
	{ sign: 'администрирование кластера не разрешено', kind: 'auth' },
	{ sign: 'администрирование агента кластера не разрешено', kind: 'auth' },
	{ sign: 'cluster administrator is not authenticated', kind: 'auth' },
	{ sign: 'central server administrator is not authenticated', kind: 'auth' },
	{ sign: 'неверное имя или пароль', kind: 'auth' },
	{ sign: 'идентификация пользователя не выполнена', kind: 'auth' },
	{ sign: 'administrator name or password', kind: 'auth' },
	{ sign: 'authentication', kind: 'auth' },
	{ sign: 'несовпадение версий', kind: 'version' },
	{ sign: 'version mismatch', kind: 'version' },
	{ sign: 'не обнаружен', kind: 'notFound' },
	{ sign: 'не найден', kind: 'notFound' },
	{ sign: 'not found', kind: 'notFound' },
	{ sign: 'ошибка соединения', kind: 'connection' },
	{ sign: 'connection to server', kind: 'connection' },
	{ sign: 'connection refused', kind: 'connection' },
	{ sign: 'econnrefused', kind: 'connection' },
	{ sign: 'сервер администрирования', kind: 'connection' },
	{ sign: 'timed out', kind: 'connection' },
	{ sign: 'операция превысила', kind: 'connection' },
];

/**
 * Что показать пользователю по категории отказа.
 *
 * Утилита объясняет отказ абзацем сетевой диагностики, который в строке
 * состояния всё равно обрежется. Поэтому распознанной причине соответствует
 * одна короткая фраза: что случилось и что с этим делать. Полный вывод никуда
 * не пропадает — он уходит в журнал.
 */
const FAILURE_MESSAGES: Record<RacFailureKind, string | undefined> = {
	connection: 'Сервер администрирования не отвечает: проверьте адрес, порт и что ras запущен',
	auth: 'Администратор не принят: откройте учётные данные',
	notFound: 'Объект не найден: обновите дерево',
	version: 'Версия rac не совпадает с версией сервера: укажите версию платформы в подключении',
	unknown: undefined,
};

/**
 * Распознаёт неудачу вызова rac по его выводу.
 *
 * Утилита пишет причину то в stderr, то в stdout, поэтому просматриваются оба
 * потока. Пустой вывод при ненулевом коде возврата — тоже результат: сообщение
 * собирается из кода возврата.
 *
 * @param exitCode - Код возврата процесса
 * @param stdout - Стандартный вывод
 * @param stderr - Поток ошибок
 * @returns Категория, короткое сообщение и полный вывод
 */
export function describeRacFailure(exitCode: number, stdout: string, stderr: string): RacFailure {
	const lines = [stderr, stdout]
		.join('\n')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const output = lines.join('\n');

	const kind =
		FAILURE_SIGNS.find((item) => output.toLowerCase().includes(item.sign))?.kind ?? 'unknown';
	// Нераспознанному отказу берём первую строку вывода: дальше утилита обычно
	// уходит в подробности, до которых читателю строки состояния дела нет.
	const message =
		FAILURE_MESSAGES[kind] ?? lines[0] ?? `Утилита rac завершилась с кодом ${exitCode}`;

	return { kind, message, output: output || undefined };
}

/**
 * Заменяет значения парольных опций звёздочками.
 *
 * Пароль в аргументах виден в списке процессов операционной системы — этого не
 * изменить, ввода пароля через поток у rac нет. Но в журнал расширения он не
 * попадёт.
 *
 * @param args - Аргументы вызова rac
 * @returns Аргументы, пригодные для журнала
 */
export function maskRacSecrets(args: string[]): string[] {
	return args.map((arg) => arg.replace(/^(--[a-z-]*pwd)=.*/i, '$1=***'));
}

/**
 * Готовит строку вызова rac для журнала, скрывая пароли.
 *
 * @param binary - Путь к rac
 * @param args - Аргументы вызова
 * @returns Строка для журнала
 */
export function formatRacCommandForLog(binary: string, args: string[]): string {
	return [binary, ...maskRacSecrets(args)].join(' ');
}
