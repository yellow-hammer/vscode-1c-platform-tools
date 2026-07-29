import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { findAllureBinary } from '../../shared/allureComponent';

/** Раскладка распакованного релиза Allure во временном каталоге. */
function makeRelease(binaryName: string): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), '1cpt-allure-'));
	const bin = path.join(root, 'allure-2.30.0', 'bin');
	fs.mkdirSync(bin, { recursive: true });
	fs.writeFileSync(path.join(bin, binaryName), '', 'utf8');
	return root;
}

suite('findAllureBinary', () => {
	test('находит запускаемый файл в каталоге релиза', () => {
		const name = process.platform === 'win32' ? 'allure.bat' : 'allure';
		const root = makeRelease(name);
		try {
			const found = findAllureBinary(root);
			assert.ok(found, 'файл не найден');
			assert.ok(found.endsWith(name), `ожидался ${name}, получено ${found}`);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('пустой каталог не даёт пути', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), '1cpt-allure-empty-'));
		try {
			assert.strictEqual(findAllureBinary(root), undefined);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('каталог с именем allure файлом не считается', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), '1cpt-allure-dir-'));
		const name = process.platform === 'win32' ? 'allure.bat' : 'allure';
		fs.mkdirSync(path.join(root, 'allure-2.30.0', 'bin', name), { recursive: true });
		try {
			assert.strictEqual(findAllureBinary(root), undefined);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
