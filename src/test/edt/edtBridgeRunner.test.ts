import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	flattenExternalExport,
	replaceExternalObject,
	stageDesignerExternals,
} from '../../features/edt/edtBridgeRunner';
import { invalidateProjectLayout, resolveProjectLayout, setLayoutExclusions } from '../../shared/projectLayout';

const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures');
/** Выгрузка проекта внешних объектов, как её пишет EDT: обработка и отчёт. */
const EXPORT = path.join(FIXTURES, 'edt', 'external-export');
/** Выгрузка одного объекта в раскладке раннера после set-version. */
const DUMP = path.join(FIXTURES, 'edt', 'external-dump');
const MIXED_WORKSPACE = path.join(FIXTURES, 'projectLayout', 'mixed-externals');

suite('шаги моста EDT над файлами выгрузок', () => {
	let staging: string;

	setup(() => {
		staging = fs.mkdtempSync(path.join(os.tmpdir(), 'edt-bridge-'));
		setLayoutExclusions(() => []);
		invalidateProjectLayout();
	});

	teardown(() => {
		fs.rmSync(staging, { recursive: true, force: true });
	});

	test('выгрузка одного объекта перекладывается в раскладку раннера, соседи по проекту убираются', async () => {
		fs.cpSync(EXPORT, staging, { recursive: true });

		assert.deepStrictEqual(await flattenExternalExport(staging, 'Загрузка'), ['Загрузка']);
		assert.ok(fs.existsSync(path.join(staging, 'Загрузка.xml')));
		assert.ok(fs.existsSync(path.join(staging, 'Загрузка', 'Ext', 'ObjectModule.bsl')));
		assert.ok(!fs.existsSync(path.join(staging, 'ExternalDataProcessors')));
		assert.ok(!fs.existsSync(path.join(staging, 'ExternalReports')));
		assert.ok(!fs.existsSync(path.join(staging, 'Остатки.xml')));
	});

	test('выгрузка проекта перекладывается целиком', async () => {
		fs.cpSync(EXPORT, staging, { recursive: true });

		assert.deepStrictEqual((await flattenExternalExport(staging)).sort(), ['Загрузка', 'Остатки']);
		assert.ok(fs.existsSync(path.join(staging, 'Загрузка.xml')));
		assert.ok(fs.existsSync(path.join(staging, 'Остатки.xml')));
		assert.ok(fs.existsSync(path.join(staging, 'Остатки', 'Ext', 'ObjectModule.bsl')));
	});

	test('объект в выгрузке проекта подменяется своей новой выгрузкой, остальные объекты остаются', async () => {
		fs.cpSync(EXPORT, staging, { recursive: true });
		await flattenExternalExport(staging);

		await replaceExternalObject(staging, path.join(DUMP, 'Загрузка'), 'Загрузка');

		assert.match(fs.readFileSync(path.join(staging, 'Загрузка.xml'), 'utf8'), /новая выгрузка/);
		assert.match(fs.readFileSync(path.join(staging, 'Загрузка', 'Ext', 'ObjectModule.bsl'), 'utf8'), /2\.0\.0\.0/);
		assert.strictEqual(
			fs.readFileSync(path.join(staging, 'Остатки', 'Ext', 'ObjectModule.bsl'), 'utf8'),
			fs.readFileSync(path.join(EXPORT, 'ExternalReports', 'Остатки', 'Ext', 'ObjectModule.bsl'), 'utf8')
		);
	});

	test('объекты выгрузки конфигуратора рядом с проектами EDT ложатся в промежуточный каталог как есть', async () => {
		const layout = await resolveProjectLayout(MIXED_WORKSPACE);

		const copied = await stageDesignerExternals({ designerSource: 'src/epf', target: staging }, MIXED_WORKSPACE, layout);

		assert.deepStrictEqual(copied, [path.join(staging, 'Печать')]);
		assert.ok(fs.existsSync(path.join(staging, 'Печать', 'Печать.xml')));
		assert.ok(fs.existsSync(path.join(staging, 'Печать', 'Печать', 'Ext', 'ObjectModule.bsl')));
		assert.ok(!fs.existsSync(path.join(staging, 'Загрузка')));
	});
});
