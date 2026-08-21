/**
 * Декодирование вывода дочернего процесса.
 *
 * Предполагать UTF-8 нельзя: на Windows консольные программы пишут в кодовой
 * странице консоли, а `chcp` уважают не все. Декодер смотрит на сами байты:
 * пока идёт ASCII, кодировка не важна; на первом же не-ASCII байте поток
 * проверяется на корректность UTF-8 и дальше читается либо как UTF-8, либо как
 * однобайтовая кодовая страница.
 *
 * @module processOutput
 */

/** Однобайтовые кодировки, которыми на Windows приходит кириллица. */
const FALLBACK_ENCODINGS = ['ibm866', 'windows-1251'] as const;

type FallbackEncoding = (typeof FALLBACK_ENCODINGS)[number];

/** Результат проверки буфера на UTF-8. */
type Utf8Scan = 'valid' | 'truncated' | 'invalid';

/**
 * Проверяет буфер на корректный UTF-8.
 *
 * `truncated` означает, что данных не хватило: последняя последовательность
 * оборвалась на границе чанка и решение нужно отложить.
 *
 * @param buffer - Проверяемые байты
 * @returns Итог проверки
 */
export function scanUtf8(buffer: Buffer): Utf8Scan {
	let index = 0;
	while (index < buffer.length) {
		const lead = buffer[index];
		if (lead < 0x80) {
			index++;
			continue;
		}

		let length: number;
		let codePoint: number;
		if (lead >= 0xc2 && lead <= 0xdf) {
			length = 2;
			codePoint = lead & 0x1f;
		} else if (lead >= 0xe0 && lead <= 0xef) {
			length = 3;
			codePoint = lead & 0x0f;
		} else if (lead >= 0xf0 && lead <= 0xf4) {
			length = 4;
			codePoint = lead & 0x07;
		} else {
			// 0x80-0xC1 и 0xF5-0xFF ведущими быть не могут
			return 'invalid';
		}

		if (index + length > buffer.length) {
			return 'truncated';
		}

		for (let offset = 1; offset < length; offset++) {
			const next = buffer[index + offset];
			if (next < 0x80 || next > 0xbf) {
				return 'invalid';
			}
			codePoint = (codePoint << 6) | (next & 0x3f);
		}

		const tooSmall = (length === 3 && codePoint < 0x800) || (length === 4 && codePoint < 0x10000);
		const surrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
		if (tooSmall || surrogate || codePoint > 0x10ffff) {
			return 'invalid';
		}

		index += length;
	}
	return 'valid';
}

/**
 * Выбирает однобайтовую кодировку по раскладке байтов.
 *
 * Диапазон 0xE0-0xEF занят кириллицей в обеих страницах, поэтому решают края:
 * 0x80-0x9F это А-П в ibm866 и почти неиспользуемые символы в windows-1251,
 * а 0xF0-0xFF наоборот — р-я в windows-1251 и редкие знаки в ibm866.
 *
 * @param buffer - Байты вывода
 * @returns Подходящая кодовая страница
 */
export function pickFallbackEncoding(buffer: Buffer): FallbackEncoding {
	let score866 = 0;
	let score1251 = 0;
	for (const byte of buffer) {
		if (byte < 0x80) {
			continue;
		}
		if (byte <= 0x9f) {
			score866 += 2;
		} else if (byte <= 0xaf) {
			score866 += 1;
		} else if (byte >= 0xf0) {
			score1251 += 2;
		} else if (byte >= 0xe0) {
			score866 += 1;
			score1251 += 1;
		} else if (byte >= 0xc0) {
			score1251 += 1;
		}
	}
	return score1251 > score866 ? 'windows-1251' : 'ibm866';
}

/**
 * Потоковый декодер вывода процесса.
 *
 * Держит незавершённый хвост между чанками, поэтому многобайтовый символ,
 * разрезанный границей чанка, не превращается в мусор.
 */
export class ProcessOutputDecoder {
	/** Байты, по которым решение ещё не принято либо не хватает хвоста. */
	private pending = Buffer.alloc(0);

	/** Выбранный декодер: пока не решено, поток считается ASCII. */
	private decoder: TextDecoder | undefined = undefined;

	/**
	 * Принимает очередной чанк вывода.
	 *
	 * @param chunk - Байты, пришедшие из stdout или stderr
	 * @returns Готовый к показу текст (может быть пустым, если ждём хвост)
	 */
	public push(chunk: Buffer): string {
		this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);

		if (this.decoder === undefined) {
			const firstHighByte = this.pending.findIndex((byte) => byte >= 0x80);
			if (firstHighByte === -1) {
				return this.take(this.pending.length);
			}

			const scan = scanUtf8(this.pending);
			if (scan === 'truncated') {
				// Отдаём только ASCII-начало, решение ждёт недостающих байтов
				return this.take(firstHighByte);
			}
			this.decoder = new TextDecoder(scan === 'valid' ? 'utf-8' : pickFallbackEncoding(this.pending));
		}

		return this.take(this.pending.length);
	}

	/**
	 * Отдаёт остаток после закрытия потока.
	 *
	 * @returns Хвост, который не удалось отдать раньше
	 */
	public flush(): string {
		if (this.pending.length === 0) {
			return '';
		}
		if (this.decoder === undefined) {
			this.decoder = new TextDecoder(scanUtf8(this.pending) === 'valid' ? 'utf-8' : pickFallbackEncoding(this.pending));
		}
		const rest = this.pending;
		this.pending = Buffer.alloc(0);
		return this.decoder.decode(rest);
	}

	/**
	 * Декодирует и отдаёт первые `length` байт накопленного буфера.
	 *
	 * @param length - Сколько байт отдать
	 * @returns Декодированный кусок
	 */
	private take(length: number): string {
		if (length === 0) {
			return '';
		}
		const head = this.pending.subarray(0, length);
		this.pending = this.pending.subarray(length);
		if (this.decoder === undefined) {
			return head.toString('latin1');
		}
		return this.decoder.decode(head, { stream: true });
	}
}

/**
 * Декодирует готовый буфер целиком.
 *
 * @param buffer - Вывод процесса
 * @returns Текст вывода
 */
export function decodeProcessOutput(buffer: Buffer): string {
	const decoder = new ProcessOutputDecoder();
	return decoder.push(buffer) + decoder.flush();
}
