import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	compareEdtVersions,
	defaultEdtBasePaths,
	edtVersionFromDirectory,
	findEdtInstallations,
	pickEdtInstallation,
} from '../../shared/edtLocator';

/** Каталог с установками EDT: имя каталога, наличие исполняемого файла. */
function installations(layout: { name: string; withCli: boolean; nested?: boolean }[]): string {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), '1cpt-edt-'));
	for (const item of layout) {
		const directory = item.nested ? path.join(base, item.name, '1cedt') : path.join(base, item.name);
		fs.mkdirSync(directory, { recursive: true });
		if (item.withCli) {
			fs.writeFileSync(path.join(directory, '1cedtcli.exe'), '');
			fs.writeFileSync(path.join(directory, '1cedt.exe'), '');
		}
	}
	return base;
}

suite('поиск установленной EDT', () => {
	test('версия читается из имени каталога в обеих раскладках', () => {
		assert.strictEqual(edtVersionFromDirectory('1C_EDT 2026.1'), '2026.1');
		assert.strictEqual(edtVersionFromDirectory('1c-edt-2026.1.2+2-x86_64'), '2026.1');
		assert.strictEqual(edtVersionFromDirectory('Eclipse для разработки 1C_EDT 2023-12'), undefined);
		assert.strictEqual(edtVersionFromDirectory('plugins'), undefined);
	});

	test('версии сравниваются по году и выпуску', () => {
		assert.ok(compareEdtVersions('2026.1', '2025.2') > 0);
		assert.ok(compareEdtVersions('2025.1', '2025.2') < 0);
		assert.strictEqual(compareEdtVersions('2026.1', '2026.1'), 0);
	});

	test('установка без 1cedtcli пропускается', () => {
		const base = installations([
			{ name: '1C_EDT 2026.1', withCli: true, nested: true },
			{ name: '1C_EDT 2025.1', withCli: false, nested: true },
		]);

		const found = findEdtInstallations(base, 'win32');

		assert.deepStrictEqual(
			found.installations.map((item) => item.version),
			['2026.1']
		);
		assert.ok(found.installations[0].cli.endsWith('1cedtcli.exe'));
		assert.ok(found.installations[0].gui?.endsWith('1cedt.exe'));
	});

	test('установки идут от старшей версии к младшей', () => {
		const base = installations([
			{ name: '1C_EDT 2025.2', withCli: true, nested: true },
			{ name: '1C_EDT 2026.1', withCli: true, nested: true },
			{ name: '1C_EDT 2024.1', withCli: true, nested: true },
		]);

		const found = findEdtInstallations(base, 'win32');

		assert.deepStrictEqual(
			found.installations.map((item) => item.version),
			['2026.1', '2025.2', '2024.1']
		);
	});

	test('настройка может указывать прямо на установку', () => {
		const base = installations([{ name: '1C_EDT 2026.1', withCli: true }]);

		const found = findEdtInstallations(path.join(base, '1C_EDT 2026.1'), 'win32');

		assert.strictEqual(found.installations.length, 1);
		assert.strictEqual(found.installations[0].version, '2026.1');
	});

	test('версия выбирается по началу номера, иначе берётся старшая', () => {
		const base = installations([
			{ name: '1C_EDT 2026.1', withCli: true, nested: true },
			{ name: '1C_EDT 2025.2', withCli: true, nested: true },
		]);
		const { installations: found } = findEdtInstallations(base, 'win32');

		assert.strictEqual(pickEdtInstallation(found)?.version, '2026.1');
		assert.strictEqual(pickEdtInstallation(found, '2025')?.version, '2025.2');
		assert.strictEqual(pickEdtInstallation(found, '2025.2')?.version, '2025.2');
		assert.strictEqual(pickEdtInstallation(found, '2019'), undefined);
	});

	test('каталоги поиска зависят от системы', () => {
		assert.ok(defaultEdtBasePaths('win32').some((base) => base.includes('1cedtstart')));
		assert.ok(defaultEdtBasePaths('linux').some((base) => base.startsWith('/opt/1C')));
	});
});
