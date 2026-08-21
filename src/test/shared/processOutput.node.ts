/**
 * Декодирование вывода процесса: байты → текст, на всех ОС одинаково.
 * Запуск: npm run test:process-output
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { ProcessOutputDecoder, decodeProcessOutput, pickFallbackEncoding, scanUtf8 } from '../../shared/processOutput';

const PHRASE = 'Требуемая версия OneScript: 2.0.0';
const MIXED = 'compile - Сборка cf-файла из исходников.';

/** Кодирует строку в однобайтовую кодовую страницу через обратную таблицу TextDecoder. */
function encodeSingleByte(text: string, encoding: string): Buffer {
	const table = new Map<string, number>();
	for (let byte = 0; byte < 256; byte++) {
		const char = new TextDecoder(encoding).decode(Buffer.from([byte]));
		if (!table.has(char)) {
			table.set(char, byte);
		}
	}
	return Buffer.from([...text].map((char) => {
		const byte = table.get(char);
		assert.notEqual(byte, undefined, `символ ${char} не кодируется в ${encoding}`);
		return byte as number;
	}));
}

const UTF8 = Buffer.from(PHRASE, 'utf8');
const CP866 = encodeSingleByte(PHRASE, 'ibm866');
const CP1251 = encodeSingleByte(PHRASE, 'windows-1251');

function resolveRepoRoot(): string {
	let dir = __dirname;
	for (let i = 0; i < 10; i++) {
		if (existsSync(path.join(dir, 'package.json'))) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	throw new Error('Не найден корень репозитория');
}

const repoRoot = resolveRepoRoot();

/** Гоняет байты через настоящий дочерний процесс и читает его вывод декодером. */
function runEchoBytes(buffer: Buffer): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'echo-bytes.mjs'), buffer.toString('hex')], {
			windowsHide: true,
			cwd: repoRoot,
		});
		const decoder = new ProcessOutputDecoder();
		let text = '';
		child.stdout.on('data', (chunk: Buffer) => {
			text += decoder.push(chunk);
		});
		child.on('error', reject);
		child.on('close', () => resolve(text + decoder.flush()));
	});
}

describe('scanUtf8', () => {
	test('чистый ASCII и корректный UTF-8 проходят', () => {
		assert.equal(scanUtf8(Buffer.from('plain ascii', 'utf8')), 'valid');
		assert.equal(scanUtf8(UTF8), 'valid');
	});

	test('обрыв на границе чанка отличается от порчи', () => {
		assert.equal(scanUtf8(UTF8.subarray(0, 1)), 'truncated');
		assert.equal(scanUtf8(CP866), 'invalid');
		assert.equal(scanUtf8(CP1251), 'invalid');
	});

	test('переудлинённая последовательность и суррогат не проходят', () => {
		assert.equal(scanUtf8(Buffer.from([0xc0, 0xaf])), 'invalid');
		assert.equal(scanUtf8(Buffer.from([0xe0, 0x80, 0xaf])), 'invalid');
		assert.equal(scanUtf8(Buffer.from([0xed, 0xa0, 0x80])), 'invalid');
	});
});

describe('pickFallbackEncoding', () => {
	const SAMPLES = [
		PHRASE,
		MIXED,
		'КРИТИЧНАЯОШИБКА - Ошибка чтения параметров команды',
		'Информационная база не обнаружена!',
		'Загружаю зависимости из packagedef',
		'Ы',
	];

	for (const sample of SAMPLES) {
		test(`различает страницы на «${sample.slice(0, 28)}»`, () => {
			assert.equal(pickFallbackEncoding(encodeSingleByte(sample, 'ibm866')), 'ibm866');
			assert.equal(pickFallbackEncoding(encodeSingleByte(sample, 'windows-1251')), 'windows-1251');
		});
	}
});

describe('decodeProcessOutput', () => {
	test('читает UTF-8', () => {
		assert.equal(decodeProcessOutput(UTF8), PHRASE);
	});

	test('читает вывод в кодовой странице консоли', () => {
		assert.equal(decodeProcessOutput(CP866), PHRASE);
		assert.equal(decodeProcessOutput(CP1251), PHRASE);
	});

	test('ASCII не зависит от кодировки', () => {
		assert.equal(decodeProcessOutput(Buffer.from('opm install --dev -l', 'utf8')), 'opm install --dev -l');
	});

	test('пустой вывод не падает', () => {
		assert.equal(decodeProcessOutput(Buffer.alloc(0)), '');
	});
});

describe('ProcessOutputDecoder по чанкам', () => {
	for (const [label, bytes] of [['utf-8', UTF8], ['ibm866', CP866], ['windows-1251', CP1251]] as const) {
		test(`${label}: любое разбиение даёт тот же текст`, () => {
			for (let cut = 0; cut <= bytes.length; cut++) {
				const decoder = new ProcessOutputDecoder();
				const text = decoder.push(bytes.subarray(0, cut)) + decoder.push(bytes.subarray(cut)) + decoder.flush();
				assert.equal(text, PHRASE, `разрез на ${cut} байте`);
			}
		});
	}

	test('побайтовая подача не рвёт многобайтовый символ', () => {
		const decoder = new ProcessOutputDecoder();
		let text = '';
		for (const byte of UTF8) {
			text += decoder.push(Buffer.from([byte]));
		}
		assert.equal(text + decoder.flush(), PHRASE);
	});

	test('длинное ASCII-начало не задерживает вывод', () => {
		const decoder = new ProcessOutputDecoder();
		assert.equal(decoder.push(Buffer.from('compile - ', 'utf8')), 'compile - ');
	});
});

describe('живой дочерний процесс', () => {
	test('вывод в UTF-8 читается', async () => {
		assert.equal(await runEchoBytes(Buffer.from(MIXED, 'utf8')), MIXED);
	});

	test('вывод в ibm866 читается', async () => {
		assert.equal(await runEchoBytes(encodeSingleByte(MIXED, 'ibm866')), MIXED);
	});

	test('вывод в windows-1251 читается', async () => {
		assert.equal(await runEchoBytes(encodeSingleByte(MIXED, 'windows-1251')), MIXED);
	});
});
