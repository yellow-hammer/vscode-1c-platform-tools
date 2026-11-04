import * as assert from 'node:assert';
import { BASE_AUTUMN_FILE } from '../../shared/envProfiles';
import { SERVICE_FILES, serviceFileLabel } from '../../features/serviceFiles/registry';

suite('serviceFiles/registry', () => {
	test('launchProfile по умолчанию — схема 3.x', () => {
		const launch = SERVICE_FILES.find((spec) => spec.id === 'launchProfile');
		assert.ok(launch);
		assert.strictEqual(launch.relPath, BASE_AUTUMN_FILE);
	});

	test('файлы параметров называются ролью, своё имя остаётся именем', () => {
		assert.strictEqual(serviceFileLabel('tools/vrunner.json'), 'Прогон тестов');
		assert.strictEqual(serviceFileLabel('tools/vrunner.init.json'), 'Инициализация данных');
		assert.strictEqual(serviceFileLabel('tools/vrunner.local.json'), 'local');
		assert.strictEqual(serviceFileLabel('tools/vrunner.ci.json'), 'ci');
		assert.strictEqual(serviceFileLabel('tools/vrunner_ssl.json'), 'vrunner_ssl');
		assert.strictEqual(serviceFileLabel('tools/VAParams.ci.json'), 'Прогон тестов');
		assert.strictEqual(serviceFileLabel('tools/VAParams.init.json'), 'Инициализация данных');
		assert.strictEqual(serviceFileLabel('tools/xUnitParams.ci.json'), 'Прогон тестов');
		assert.strictEqual(serviceFileLabel('tools/xUnitParams.init.json'), 'Инициализация данных');
		assert.strictEqual(serviceFileLabel('tools/yaxunit.ci.json'), 'Прогон тестов');
		assert.strictEqual(serviceFileLabel('tools/yaxunit.init.json'), 'Инициализация данных');
		assert.strictEqual(serviceFileLabel('tools/syntax-check-excludes.txt'), 'Исключения');
		assert.strictEqual(serviceFileLabel('tools/VAParams.dev.json'), 'dev');
	});
});
