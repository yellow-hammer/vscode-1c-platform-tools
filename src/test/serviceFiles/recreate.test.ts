import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeBuildFile } from '../../features/serviceFiles/buildFile';
import { HOOKS_DEFAULTS } from '../../features/serviceFiles/envDefaults';
import { canRecreateServiceFile, recreatePicksParts, recreateServiceFile } from '../../features/serviceFiles/recreate';

const extensionPath = path.resolve(__dirname, '../../..');

suite('служебные файлы: пересоздание', () => {
	test('пересоздаются файлы, у которых есть шаблон', () => {
		for (const relPath of [
			'.gitignore',
			'.gitattributes',
			'packagedef',
			'autumn-properties.json',
			'env.dev.json',
			'.env',
			'.env.local',
			'.env.ci',
			'.1cpt/hooks.json',
			'.1cpt/pipelines.json',
			'tools/vrunner.json',
			'tools/vrunner.init.json',
			'tools/vrunner.ci.json',
			'tools/VAParams.json',
			'tools/VAParams.init.json',
			'tools/xUnitParams.json',
			'tools/yaxunit.json',
			'tools/syntax-check-excludes.txt',
		]) {
			assert.strictEqual(canRecreateServiceFile(relPath, false), true, relPath);
		}
	});

	test('файл со своим именем без шаблона не пересоздаётся', () => {
		for (const relPath of ['ci/vrunner_ssl.json', 'vanessaConf.json', 'tools/syntax-check-exception-file.txt', 'README.md']) {
			assert.strictEqual(canRecreateServiceFile(relPath, false), false, relPath);
		}
	});

	test('пайплайны не перезаписываются, а дополняются типовыми цепочками проекта 1С', () => {
		assert.strictEqual(recreatePicksParts('.1cpt/pipelines.json'), true);
		assert.strictEqual(recreatePicksParts('.1cpt/hooks.json'), false);
		assert.strictEqual(canRecreateServiceFile('.1cpt/pipelines.json', true), false);
		assert.strictEqual(canRecreateServiceFile('.1cpt/hooks.json', true), true);
	});

	test('пересозданный файл сборки совпадает с созданным', async () => {
		const created = await fs.mkdtemp(path.join(os.tmpdir(), 'svc-created-'));
		const recreated = await fs.mkdtemp(path.join(os.tmpdir(), 'svc-recreated-'));
		try {
			for (const relPath of ['tools/vrunner.ci.json', 'tools/VAParams.json', 'tools/xUnitParams.json', 'tools/yaxunit.json', 'tools/syntax-check-excludes.txt']) {
				await writeBuildFile(created, relPath, 'v3', extensionPath);
				await fs.mkdir(path.dirname(path.join(recreated, relPath)), { recursive: true });
				await fs.writeFile(path.join(recreated, relPath), 'правка человека', 'utf8');
				const written = await recreateServiceFile(recreated, relPath, { schema: 'v3', oneScript: false, extensionPath });
				assert.strictEqual(written, true, relPath);
				assert.strictEqual(
					await fs.readFile(path.join(recreated, relPath), 'utf8'),
					await fs.readFile(path.join(created, relPath), 'utf8'),
					relPath
				);
			}
		} finally {
			await fs.rm(created, { recursive: true, force: true });
			await fs.rm(recreated, { recursive: true, force: true });
		}
	});

	test('хуки пересоздаются значениями по умолчанию', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'svc-hooks-'));
		try {
			await fs.mkdir(path.join(root, '.1cpt'));
			await fs.writeFile(path.join(root, '.1cpt/hooks.json'), '{"hooks":{}}', 'utf8');
			await recreateServiceFile(root, '.1cpt/hooks.json', { schema: 'v3', oneScript: false, extensionPath });
			assert.deepStrictEqual(JSON.parse(await fs.readFile(path.join(root, '.1cpt/hooks.json'), 'utf8')), HOOKS_DEFAULTS);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
