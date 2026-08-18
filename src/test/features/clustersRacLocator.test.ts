import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describeRacNotFound, findRac } from '../../features/clusters/racLocator';
import { platformBinaryFileName } from '../../shared/platformBinary';

/** Имя файла утилиты для текущей ОС: на Windows это rac.exe. */
const RAC_FILE = platformBinaryFileName('rac', process.platform);

/**
 * Создаёт пустой файл вместе с каталогами.
 *
 * @param filePath - Путь к файлу
 */
function touch(filePath: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, '', 'utf8');
}

suite('поиск утилиты rac', () => {
	let base: string;

	setup(() => {
		base = fs.mkdtempSync(path.join(os.tmpdir(), '1c-rac-'));
	});

	teardown(() => {
		fs.rmSync(base, { recursive: true, force: true });
	});

	test('раскладка Windows: каталог версии с подкаталогом bin', () => {
		const expected = path.join(base, '8.3.27.1936', 'bin', RAC_FILE);
		touch(expected);

		assert.strictEqual(findRac(base).binary, expected);
	});

	test('раскладка пакетов Linux: бинарь прямо в каталоге версии', () => {
		const expected = path.join(base, '8.3.27.1936', RAC_FILE);
		touch(expected);

		assert.strictEqual(findRac(base).binary, expected);
	});

	test('раскладка установщика: бинарь в самом каталоге установки', () => {
		const expected = path.join(base, RAC_FILE);
		touch(expected);

		assert.strictEqual(findRac(base).binary, expected);
	});

	test('без запроса версии берётся наибольшая', () => {
		touch(path.join(base, '8.3.24.1548', 'bin', RAC_FILE));
		const newest = path.join(base, '8.3.27.1936', 'bin', RAC_FILE);
		touch(newest);

		assert.strictEqual(findRac(base).binary, newest);
	});

	test('запрошенная версия учитывается, префикс тоже', () => {
		const older = path.join(base, '8.3.24.1548', 'bin', RAC_FILE);
		touch(older);
		touch(path.join(base, '8.3.27.1936', 'bin', RAC_FILE));

		assert.strictEqual(findRac(base, '8.3.24.1548').binary, older);
		assert.strictEqual(findRac(base, '8.3.24').binary, older);
	});

	test('версия, которой нет, не подменяется другой', () => {
		touch(path.join(base, '8.3.27.1936', 'bin', RAC_FILE));

		assert.strictEqual(findRac(base, '8.3.22').binary, undefined);
	});

	test('каталог без утилиты возвращает пустой результат и перечисляет, где искали', () => {
		const lookup = findRac(base);

		assert.strictEqual(lookup.binary, undefined);
		assert.deepStrictEqual(lookup.bases, [base]);
		const message = describeRacNotFound(lookup);
		assert.ok(message.includes(base));
		assert.ok(message.includes(RAC_FILE));
	});
});
