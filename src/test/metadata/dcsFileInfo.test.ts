import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveDcsSchemaTarget } from '../../features/metadata/dcsAgentOps';
import { mdSparrowFileReader } from '../../features/metadata/mdSparrowFileInfo';
import { runMdSparrowParamsRead } from '../../features/metadata/mdSparrowParams';

suite('Чтение файлов СКД через md-sparrow', () => {
	test('распознаёт схему по содержимому и берёт формат из конфигурации', async function () {
		const jarPath = process.env.MD_SPARROW_JAR;
		if (!jarPath) {
			this.skip();
			return;
		}
		this.timeout(30_000);
		const runtime = { java: process.env.MD_SPARROW_JAVA || 'java', jarPath, javaVersion: 25 };
		const reader = mdSparrowFileReader(runtime);
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dcs-file-info-'));
		try {
			const configuration = path.join(root, 'Configuration.xml');
			const template = path.join(root, 'CommonTemplates', 'Схема', 'Ext', 'Template.xml');
			await fs.mkdir(path.dirname(template), { recursive: true });
			await fs.writeFile(configuration, `
				<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.22">
					<Configuration><Properties><ObjectBelonging>Adopted</ObjectBelonging></Properties></Configuration>
				</MetaDataObject>`.trimStart());
			await fs.copyFile(path.resolve(__dirname, '../../../src/test/fixtures/dcs/Template.xml'), template);
			assert.deepEqual(await reader.metadata(configuration), {
				schemaVersion: 'V2_22',
				configurationExtension: true,
			});

			const resolved = await resolveDcsSchemaTarget(template, undefined, reader);
			assert.deepEqual(resolved, { target: { objectXml: template, cwd: root, schemaVersion: 'V2_22' } });
			const result = await runMdSparrowParamsRead(runtime, {
				op: 'cf-dcs-info',
				objectXml: template,
				schemaVersion: 'V2_22',
			}, { cwd: root });
			assert.equal(result.exitCode, 0, result.stderr);
			assert.ok((JSON.parse(result.stdout) as { dataSets?: unknown[] }).dataSets?.length);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
