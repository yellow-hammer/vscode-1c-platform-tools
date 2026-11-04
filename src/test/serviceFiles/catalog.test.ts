import * as assert from 'node:assert';
import { classifyServiceFile, discoverServiceFiles, environmentFileRows, pathIsNotable, profileFileRows, rowsOf, sortServiceRows, vrunnerFileRows } from '../../features/serviceFiles/catalog';
import type { SettingsFileFormat } from '../../shared/envProfiles';

suite('служебные файлы: поиск по имени', () => {
	test('узнаёт файлы сборки и не заходит в исходники', () => {
		assert.strictEqual(classifyServiceFile('tools/vrunner.local.json'), 'vrunner');
		assert.strictEqual(classifyServiceFile('ci/VAParams.json'), 'vanessa');
		assert.strictEqual(classifyServiceFile('src/cfe/tools/vrunner.json'), undefined);
		assert.strictEqual(classifyServiceFile('oscript_modules/x/vrunner.json'), undefined);
		assert.strictEqual(classifyServiceFile('build/vrunner.json'), undefined);
		assert.strictEqual(classifyServiceFile('.git/vrunner.json'), undefined);
	});

	test('профиль и окружение только в корне', () => {
		assert.strictEqual(classifyServiceFile('autumn-properties.json'), 'profile');
		assert.strictEqual(classifyServiceFile('env.dev.json'), 'profile');
		assert.strictEqual(classifyServiceFile('env.local.json'), undefined);
		assert.strictEqual(classifyServiceFile('autumn-properties.local.json'), undefined);
		assert.strictEqual(classifyServiceFile('.env'), 'environment');
		assert.strictEqual(classifyServiceFile('.env.ci'), 'environment');
		assert.strictEqual(classifyServiceFile('.env.example'), undefined);
		assert.strictEqual(classifyServiceFile('tools/.env.ci'), undefined);
	});

	test('основной профиль остаётся первым после создания именованного', () => {
		const v3 = sortServiceRows(profileFileRows(discoverServiceFiles([
			'autumn-properties.ci.json',
			'autumn-properties.json',
			'env.json',
		]), 'v3'));
		assert.deepStrictEqual(v3.map((row) => `${row.relPath}:${row.exists}`), [
			'autumn-properties.json:true',
			'autumn-properties.ci.json:true',
		]);
		const v2 = sortServiceRows(profileFileRows(discoverServiceFiles([
			'env.ci.json',
			'env.json',
			'autumn-properties.json',
		]), 'v2'));
		assert.deepStrictEqual(v2.map((row) => `${row.relPath}:${row.exists}`), [
			'env.json:true',
			'env.ci.json:true',
		]);
		const onlyNamed = sortServiceRows(profileFileRows(discoverServiceFiles(['autumn-properties.ci.json']), 'v3'));
		assert.deepStrictEqual(onlyNamed.map((row) => `${row.relPath}:${row.exists}`), [
			'autumn-properties.json:false',
			'autumn-properties.ci.json:true',
		]);
	});

	test('профиль запуска берёт только файлы текущей схемы', () => {
		const discovered = discoverServiceFiles([
			'env.json',
			'env.dev.json',
			'autumn-properties.json',
			'autumn-properties.ci.json',
		]);
		assert.deepStrictEqual(
			profileFileRows(discovered, 'v3').map((row) => row.relPath).sort(),
			['autumn-properties.ci.json', 'autumn-properties.json']
		);
		assert.deepStrictEqual(
			profileFileRows(discovered, 'v2').map((row) => row.relPath).sort(),
			['env.dev.json', 'env.json']
		);
		assert.deepStrictEqual(
			profileFileRows(discoverServiceFiles(['env.json']), 'v3').map((row) => `${row.relPath}:${row.exists}`),
			['autumn-properties.json:false']
		);
	});

	test('группа vanessa-runner оставляет файлы текущей схемы и места для новых', () => {
		const discovered = discoverServiceFiles([
			'tools/vrunner.json',
			'tools/vrunner.ci.json',
			'ci/vrunner_ssl.json',
		]);
		const format = new Map<string, SettingsFileFormat>([
			['tools/vrunner.json', 'v2'],
			['tools/vrunner.ci.json', 'v3'],
			['ci/vrunner_ssl.json', 'v2'],
		]);
		const rows = vrunnerFileRows(discovered, 'v3', (relPath) => format.get(relPath));
		assert.deepStrictEqual(rows.map((row) => `${row.relPath}:${row.exists}`), [
			'tools/vrunner.ci.json:true',
			'tools/vrunner.init.json:false',
		]);
	});

	test('окружение показывает общий и личный файлы, личную половину имени прячет', () => {
		const rows = sortServiceRows(environmentFileRows(discoverServiceFiles(['.env.ci', '.env.ci.local'])));
		assert.deepStrictEqual(rows.map((row) => `${row.relPath}:${row.exists}`), [
			'.env:false',
			'.env.ci:true',
		]);
	});

	test('свой файл не встаёт между постоянными строками', () => {
		const rows = sortServiceRows([
			{ kind: 'vrunner', relPath: 'tools/vrunner.ci.json', exists: true },
			{ kind: 'vrunner', relPath: 'tools/vrunner.init.json', exists: false },
			{ kind: 'vrunner', relPath: 'tools/vrunner.json', exists: true },
			{ kind: 'vrunner', relPath: 'tools/vrunner.local.json', exists: true },
		]);
		assert.deepStrictEqual(rows.map((row) => row.relPath), [
			'tools/vrunner.json',
			'tools/vrunner.init.json',
			'tools/vrunner.ci.json',
			'tools/vrunner.local.json',
		]);
		const vanessa = sortServiceRows(rowsOf('vanessa', discoverServiceFiles(['tools/VAParams.ci.json'])));
		assert.deepStrictEqual(vanessa.map((row) => `${row.relPath}:${row.exists}`), [
			'tools/VAParams.json:false',
			'tools/VAParams.init.json:false',
			'tools/VAParams.ci.json:true',
		]);
	});

	test('создание файла не меняет порядок', () => {
		const missing = [
			{ kind: 'vrunner' as const, relPath: 'tools/vrunner.json', exists: false },
			{ kind: 'vrunner' as const, relPath: 'tools/vrunner.init.json', exists: false },
		];
		const created = [
			{ kind: 'vrunner' as const, relPath: 'tools/vrunner.init.json', exists: true },
			{ kind: 'vrunner' as const, relPath: 'tools/vrunner.json', exists: false },
		];
		assert.deepStrictEqual(
			sortServiceRows(missing).map((row) => row.relPath),
			sortServiceRows(created).map((row) => row.relPath)
		);
		assert.deepStrictEqual(sortServiceRows(created).map((row) => row.relPath), [
			'tools/vrunner.json',
			'tools/vrunner.init.json',
		]);
	});

	test('xUnit и YAxUnit предлагают один файл, без init', () => {
		assert.deepStrictEqual(rowsOf('xunit', discoverServiceFiles([])).map((row) => row.relPath), ['tools/xUnitParams.json']);
		assert.deepStrictEqual(rowsOf('yaxunit', discoverServiceFiles([])).map((row) => row.relPath), ['tools/yaxunit.json']);
		assert.deepStrictEqual(
			rowsOf('vanessa', discoverServiceFiles([])).map((row) => row.relPath),
			['tools/VAParams.json', 'tools/VAParams.init.json']
		);
	});

	test('строки группы держат места для новых файлов и уже найденные', () => {
		const rows = rowsOf('vrunner', discoverServiceFiles(['tools/vrunner.json', 'ci/vrunner_ssl.json']));
		assert.deepStrictEqual(rows.map((row) => row.relPath), [
			'ci/vrunner_ssl.json',
			'tools/vrunner.json',
			'tools/vrunner.init.json',
		]);
		assert.strictEqual(rows.find((row) => row.relPath === 'tools/vrunner.json')?.exists, true);
		assert.strictEqual(rows.find((row) => row.relPath === 'tools/vrunner.ci.json'), undefined);
		assert.strictEqual(rows.find((row) => row.relPath === 'tools/vrunner.init.json')?.exists, false);
		assert.strictEqual(pathIsNotable('vrunner', 'ci/vrunner_ssl.json'), true);
		assert.strictEqual(pathIsNotable('vrunner', 'tools/vrunner.json'), false);
	});
});
