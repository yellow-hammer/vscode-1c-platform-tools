import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureBslModuleFile } from '../../features/metadata/bslModuleFile';

suite('файл модуля рядом с объектом', () => {
	let dir: string;

	setup(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), '1cpt-module-'));
	});

	teardown(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('пустой модуль создаётся вместе с каталогом', async () => {
		const modulePath = path.join(dir, 'Ext', 'ObjectModule.bsl');

		assert.strictEqual(await ensureBslModuleFile(modulePath), 'created');
		assert.ok(fs.existsSync(modulePath));
		assert.deepStrictEqual([...fs.readFileSync(modulePath)], [0xef, 0xbb, 0xbf]);
	});

	test('существующий модуль не трогается', async () => {
		const modulePath = path.join(dir, 'Module.bsl');
		fs.writeFileSync(modulePath, 'Процедура Тест()', 'utf8');

		assert.strictEqual(await ensureBslModuleFile(modulePath), 'exists');
		assert.strictEqual(fs.readFileSync(modulePath, 'utf8'), 'Процедура Тест()');
	});

	test('поверх двоичного модуля пустой не создаётся', async () => {
		const modulePath = path.join(dir, 'Module.bsl');
		fs.writeFileSync(path.join(dir, 'Module.bin'), Buffer.from([0x00, 0x01]));

		assert.strictEqual(await ensureBslModuleFile(modulePath), 'binary');
		assert.strictEqual(fs.existsSync(modulePath), false);
	});
});
