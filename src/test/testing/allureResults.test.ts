import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { collectAllureResultDirs } from '../../utils/allureResults';

suite('allureResults', () => {
	test('находит все типы источников и пропускает пустые/посторонние', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'allure-scan-'));
		try {
			// Канонические каталоги allure (smoke, syntax-check, корневой VA)
			await fs.mkdir(path.join(root, 'smoke', 'allure'), { recursive: true });
			await fs.writeFile(path.join(root, 'smoke', 'allure', 'allure.xml'), '<x/>');
			await fs.mkdir(path.join(root, 'syntax-check', 'allure'), { recursive: true });
			await fs.writeFile(path.join(root, 'syntax-check', 'allure', 'r.json'), '{}');
			await fs.mkdir(path.join(root, 'allure'), { recursive: true });
			await fs.writeFile(path.join(root, 'allure', 'result.json'), '{}');

			// jUnit YAxUnit и Cucumber JSON от VA
			await fs.mkdir(path.join(root, 'yaxunit'), { recursive: true });
			await fs.writeFile(path.join(root, 'yaxunit', 'junit.xml'), '<x/>');
			await fs.mkdir(path.join(root, 'cucumber'), { recursive: true });
			await fs.writeFile(path.join(root, 'cucumber', 'CucumberJson.json'), '[]');

			// Пустой allure и посторонний каталог — не должны попасть
			await fs.mkdir(path.join(root, 'empty', 'allure'), { recursive: true });
			await fs.mkdir(path.join(root, 'screenshots'), { recursive: true });
			await fs.writeFile(path.join(root, 'screenshots', 'shot.png'), '');

			// Дубль одного прогона: smoke/junit при существующем smoke/allure — пропускается
			await fs.mkdir(path.join(root, 'smoke', 'junit'), { recursive: true });
			await fs.writeFile(path.join(root, 'smoke', 'junit', 'junit.xml'), '<x/>');

			const dirs = collectAllureResultDirs(root).map((dir) => path.relative(root, dir));
			assert.deepStrictEqual(
				dirs.sort(),
				['allure', 'cucumber', path.join('smoke', 'allure'), path.join('syntax-check', 'allure'), 'yaxunit'].sort()
			);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('несуществующий каталог даёт пустой список', () => {
		assert.deepStrictEqual(collectAllureResultDirs(path.join(os.tmpdir(), 'no-such-dir-xyz')), []);
	});
});
