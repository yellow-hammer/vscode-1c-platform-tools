import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	cachedReleaseComponent,
	installReleaseAsset,
	type ReleaseComponentSpec,
} from '../../shared/githubReleaseLoader';

suite('кэш внешнего компонента', () => {
	const spec: ReleaseComponentSpec = {
		repoSlug: 'yellow-hammer/проба',
		cacheSubdir: 'проба',
		stampName: '.проба.json',
		assetRegex: /^файл\.bin$/i,
		label: 'Проба',
		extract: false,
	};

	let baseDir = '';
	let sourceFile = '';

	setup(() => {
		baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'components-'));
		sourceFile = path.join(baseDir, 'файл.bin');
		fs.writeFileSync(sourceFile, 'содержимое', 'utf8');
	});

	teardown(() => {
		fs.rmSync(baseDir, { recursive: true, force: true });
	});

	test('артефакт ложится в кэш и находится по штампу', async () => {
		const installed = await installReleaseAsset(baseDir, spec, {
			tag: 'v1.0.0',
			assetName: 'файл.bin',
			sourceFile,
		});
		assert.ok(fs.existsSync(installed.assetPath), 'артефакта нет в кэше');
		const cached = await cachedReleaseComponent(baseDir, spec);
		assert.strictEqual(cached?.tag, 'v1.0.0');
		assert.strictEqual(cached?.assetPath, installed.assetPath);
	});

	test('прежняя версия убирается, когда встала новая', async () => {
		await installReleaseAsset(baseDir, spec, { tag: 'v1.0.0', assetName: 'файл.bin', sourceFile });
		await installReleaseAsset(baseDir, spec, { tag: 'v1.1.0', assetName: 'файл.bin', sourceFile });
		const versions = fs
			.readdirSync(path.join(baseDir, spec.cacheSubdir))
			.filter((entry) => entry !== spec.stampName);
		assert.deepStrictEqual(versions, ['v1.1.0']);
	});
});
