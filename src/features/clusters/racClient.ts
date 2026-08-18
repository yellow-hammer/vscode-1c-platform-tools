/**
 * Запуск утилиты администрирования кластера (rac).
 *
 * Слой отвечает только за процесс: найти бинарь, выполнить вызов, разобрать
 * вывод и записать в журнал. Доменные операции («список сеансов», «завершить
 * сеанс») живут в {@link ../clusters/clusterService.ClusterService}, аргументы —
 * в racArgs. Такое разделение позволяет проверять сборку аргументов и разбор
 * вывода тестами, не поднимая сервер администрирования.
 *
 * Аргументы передаются процессу массивом, без оболочки: имя базы или сообщение
 * блокировки могут содержать пробелы и кавычки, а через оболочку их пришлось бы
 * экранировать по правилам трёх разных ОС.
 */

import { execFile } from 'node:child_process';
import { logger } from '../../shared/logger';
import { DEFAULT_RAC_TIMEOUT_MS } from './constants';
import { describeRacNotFound, findRac } from './racLocator';
import {
	decodeRacOutput,
	describeRacFailure,
	formatRacCommandForLog,
	isRacUsageOutput,
	parseRacRecords,
	type RacFailure,
	type RacRecord,
} from './racOutput';
import { readClustersSettings } from './settings';

/** Предел объёма вывода одного вызова: список сеансов крупного кластера велик. */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

const log = logger.scope('clusters');

/** Результат вызова rac. */
export type RacResult =
	| { ok: true; records: RacRecord[]; stdout: string }
	| { ok: false; failure: RacFailure };

/** Параметры вызова, влияющие на выбор бинаря и ожидание. */
export interface RacRunOptions {
	/** Версия платформы для выбора rac; задаётся подключением, пусто — наибольшая установленная. */
	platformVersion?: string;
}

/**
 * Клиент утилиты rac.
 *
 * История вызовов пишется в общий журнал расширения со скоупом `clusters`:
 * своего канала Output у кластеров нет. Отдельный канал заводится только под
 * живой поток чужого долгоживущего процесса (так сделано у автономного сервера,
 * который транслирует вывод ibsrv), а короткие вызовы «запрос-ответ» вместе с
 * остальными событиями расширения удобнее читать в одном месте — с общим
 * уровнем подробности и фильтром.
 *
 * Пароли в журнал не попадают: аргументы проходят через маскирование.
 */
export class RacClient {
	/**
	 * Выполняет вызов rac.
	 *
	 * Промис не отклоняется: любая неудача возвращается разобранной, чтобы дерево
	 * показало причину узлом, а не всплывающим исключением.
	 *
	 * @param args - Аргументы командной строки (без пути к rac)
	 * @param options - Версия платформы для выбора бинаря
	 * @returns Разобранные объекты или причина неудачи
	 */
	async run(args: string[], options: RacRunOptions = {}): Promise<RacResult> {
		const settings = readClustersSettings();
		const lookup = findRac(settings.platformPath, options.platformVersion);
		if (!lookup.binary) {
			const message = describeRacNotFound(lookup);
			log.error(message);
			return { ok: false, failure: { kind: 'notFound', message } };
		}

		const timeoutMs = settings.timeoutMs || DEFAULT_RAC_TIMEOUT_MS;
		const commandForLog = formatRacCommandForLog(lookup.binary, args);
		// Ветки дерева загружаются параллельно, поэтому итог пишется одной строкой
		// вместе с командой: пара «старт-финиш» в общем журнале перемешалась бы с
		// чужими вызовами. Строка старта остаётся на уровне debug — она нужна,
		// только если вызов повис и итога не будет.
		log.debug(`старт: ${commandForLog}`);
		const startedAt = Date.now();

		const result = await this.execute(lookup.binary, args, timeoutMs);
		const elapsed = Date.now() - startedAt;

		if (result.ok) {
			log.info(`${commandForLog} — готово за ${elapsed} мс, объектов: ${result.records.length}`);
		} else {
			log.warn(
				`${commandForLog} — неудача за ${elapsed} мс: ${result.failure.output ?? result.failure.message}`
			);
		}
		return result;
	}

	/**
	 * Запускает процесс и приводит его итог к {@link RacResult}.
	 *
	 * @param binary - Путь к rac
	 * @param args - Аргументы вызова
	 * @param timeoutMs - Таймаут ожидания
	 * @returns Итог вызова
	 */
	private execute(binary: string, args: string[], timeoutMs: number): Promise<RacResult> {
		return new Promise<RacResult>((resolve) => {
			execFile(
				binary,
				args,
				{ encoding: 'buffer', timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
				(error, stdoutBuffer, stderrBuffer) => {
					const stdout = decodeRacOutput(stdoutBuffer);
					const stderr = decodeRacOutput(stderrBuffer);

					if (!error) {
						// Незнакомую команду rac ошибкой не считает: печатает справку и
						// завершается с нулевым кодом. Для нас это отказ, иначе действие,
						// которого нет в этой версии платформы, выглядело бы выполненным.
						if (isRacUsageOutput(stdout)) {
							resolve({
								ok: false,
								failure: {
									kind: 'version',
									message:
										'Утилита rac не знает такой команды: возможно, действие появилось в более новой версии платформы',
									output: stdout,
								},
							});
							return;
						}
						resolve({ ok: true, records: parseRacRecords(stdout), stdout });
						return;
					}

					const failure = error as NodeJS.ErrnoException & { killed?: boolean };
					if (failure.code === 'ENOENT') {
						resolve({
							ok: false,
							failure: {
								kind: 'notFound',
								message: 'Утилита rac не найдена: укажите каталог установки платформы в настройках',
								output: `Не удалось запустить ${binary}: файл не найден`,
							},
						});
						return;
					}
					if (failure.killed === true) {
						resolve({
							ok: false,
							failure: {
								kind: 'connection',
								message: `Сервер не ответил за ${Math.round(timeoutMs / 1000)} с: проверьте адрес или увеличьте таймаут`,
							},
						});
						return;
					}

					const exitCode = typeof failure.code === 'number' ? failure.code : -1;
					resolve({ ok: false, failure: describeRacFailure(exitCode, stdout, stderr) });
				}
			);
		});
	}
}
