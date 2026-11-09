import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	compareEdtVersions,
	defaultEdtBasePaths,
	edtComponentRoots,
	edtProductsFromRegistry,
	edtStartDataDirectory,
	edtVersionFromDirectory,
	edtVersionPickRows,
	findEdtInstallations,
	pickEdtInstallation,
	productsRootFromPreferences,
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

		const found = findEdtInstallations(base, { platform: 'win32' });

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

		const found = findEdtInstallations(base, { platform: 'win32' });

		assert.deepStrictEqual(
			found.installations.map((item) => item.version),
			['2026.1', '2025.2', '2024.1']
		);
	});

	test('настройка может указывать прямо на установку', () => {
		const base = installations([{ name: '1C_EDT 2026.1', withCli: true }]);

		const found = findEdtInstallations(path.join(base, '1C_EDT 2026.1'), { platform: 'win32' });

		assert.strictEqual(found.installations.length, 1);
		assert.strictEqual(found.installations[0].version, '2026.1');
	});

	test('версия выбирается по началу номера, иначе берётся старшая', () => {
		const base = installations([
			{ name: '1C_EDT 2026.1', withCli: true, nested: true },
			{ name: '1C_EDT 2025.2', withCli: true, nested: true },
		]);
		const { installations: found } = findEdtInstallations(base, { platform: 'win32' });

		assert.strictEqual(pickEdtInstallation(found)?.version, '2026.1');
		assert.strictEqual(pickEdtInstallation(found, '2025')?.version, '2025.2');
		assert.strictEqual(pickEdtInstallation(found, '2025.2')?.version, '2025.2');
		assert.strictEqual(pickEdtInstallation(found, '2019'), undefined);
		assert.deepStrictEqual(
			edtVersionPickRows(found, '2025.2').map((row) => (row.kind === 'separator' ? row.label : row.installation.version)),
			['Версия проекта', '2025.2', 'Найденные', '2026.1', '2025.2']
		);
		assert.deepStrictEqual(
			edtVersionPickRows(found, '').map((row) => (row.kind === 'installation' ? row.installation.version : row.label)),
			['2026.1', '2025.2']
		);
	});

	test('каталоги данных 1C:EDT Start и компонентов установщика зависят от системы', () => {
		assert.strictEqual(
			edtStartDataDirectory('linux', {}, '/home/user'),
			path.join('/home/user', '.local', 'share', '1C', '1cedtstart')
		);
		assert.strictEqual(
			edtStartDataDirectory('darwin', {}, '/Users/user'),
			path.join('/Users/user', 'Library', 'Application Support', '1C', '1cedtstart')
		);
		assert.deepStrictEqual(edtComponentRoots('linux'), ['/opt/1C/1CE/components']);
		assert.deepStrictEqual(edtComponentRoots('darwin'), ['/Applications/1C/1CE/components']);
	});
});

suite('EDT на машине Windows из фикстуры', () => {
	const windows = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'installations', 'windows');
	const dataDirectory = path.join(windows, 'Local', '1C', '1cedtstart');
	const components = path.join(windows, 'ProgramFiles', '1C', '1CE', 'components');
	const options = {
		platform: 'win32' as const,
		env: {
			LOCALAPPDATA: path.join(windows, 'Local'),
			ProgramW6432: path.join(windows, 'ProgramFiles'),
			ProgramFiles: path.join(windows, 'ProgramFiles'),
			ProgramData: path.join(windows, 'ProgramData'),
		},
		home: windows,
	};

	test('реестр 1C:EDT Start отдаёт исполняемый файл среды и её версию', () => {
		const text = fs.readFileSync(path.join(dataDirectory, 'products.json'), 'utf8');
		assert.deepStrictEqual(edtProductsFromRegistry(text), [
			{ location: 'Z:\\1C\\Среды\\installations\\1C_EDT 2024.2\\1cedt\\1cedt.exe', version: '2024.2' },
		]);
		assert.deepStrictEqual(edtProductsFromRegistry('не json'), []);
	});

	test('каталог сред разработки берётся из настроек 1C:EDT Start', () => {
		const text = fs.readFileSync(path.join(dataDirectory, 'preferences.json'), 'utf8');
		assert.strictEqual(productsRootFromPreferences(text, 'win32'), 'Z:\\1C\\Среды\\installations\\');
		assert.deepStrictEqual(defaultEdtBasePaths(options), [
			'Z:\\1C\\Среды\\installations',
			path.join(dataDirectory, 'installations'),
			components,
		]);
	});

	test('находятся и установки 1C:EDT Start, и EDT из каталога компонентов', () => {
		const { installations } = findEdtInstallations('', options);

		assert.deepStrictEqual(
			installations.map((item) => [item.version, item.cli]),
			[
				['2026.1', path.join(dataDirectory, 'installations', '1C_EDT 2026.1', '1cedt', '1cedtcli.exe')],
				['2025.1', path.join(components, '1c-edt-2025.1.4+15-x86_64', '1cedtcli.exe')],
			]
		);
		assert.strictEqual(installations[1].gui, path.join(components, '1c-edt-2025.1.4+15-x86_64', '1cedt.exe'));
	});

	test('заданный каталог единственный', () => {
		const { installations } = findEdtInstallations(components, options);

		assert.deepStrictEqual(installations.map((item) => item.version), ['2025.1']);
	});
});
