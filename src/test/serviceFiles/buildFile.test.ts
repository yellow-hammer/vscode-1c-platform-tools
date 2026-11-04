import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeBuildFile } from '../../features/serviceFiles/buildFile';

const extensionPath = path.resolve(__dirname, '../../..');

suite('служебные файлы: запись сборки', () => {
	test('unsuffixed build files are created from templates', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'svc-build-'));
		try {
			for (const rel of ['tools/VAParams.json', 'tools/xUnitParams.json', 'tools/yaxunit.json']) {
				await writeBuildFile(root, rel, 'v3', extensionPath);
				const text = await fs.readFile(path.join(root, rel), 'utf8');
				assert.ok(text.trim().length > 0, rel);
			}
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
