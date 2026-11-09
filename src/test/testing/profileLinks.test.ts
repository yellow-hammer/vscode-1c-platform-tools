import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { formatLaunchPreface } from '../../features/testing/launchPreface';
import {
	formatMissingProfileFile,
	formatProfileLinks,
	profileFileMissing,
	profileLinks,
	serviceFileClauses,
} from '../../features/testing/profileLinks';

suite('связи профиля', () => {
	test('пустой профиль: связей нет', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'links-'));
		try {
			const links = await profileLinks(root, {}, 'v2');
			assert.deepStrictEqual(links.map((link) => link.ok), [false, false, false, false]);
			assert.deepStrictEqual(serviceFileClauses(links, ['vanessa', 'xunit']), [
				`Vanessa: ${yellow('--vanessasettings не задан')}`,
				`xUnit: ${yellow('--reportsxunit не задан')}`,
			]);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('заданные каталоги отчётов: связь есть', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'links-'));
		const va = path.join(root, 'VA.json');
		await fs.writeFile(va, JSON.stringify({
			'ДелатьОтчетВФорматеCucumberJson': true,
			'ОтчетCucumber': { 'КаталогВыгрузкиCucumberJson': 'build/cucumber' },
		}));
		const yax = path.join(root, 'yax.json');
		await fs.writeFile(yax, JSON.stringify({ reportPath: 'build/yax.xml' }));
		try {
			const links = await profileLinks(root, {
				vanessa: { '--vanessasettings': 'VA.json' },
				xunit: {
					'--xddConfig': './tools/xUnitParams.json',
					'--reportsxunit': 'ГенераторОтчетаJUnitXML{build/junit.xml}',
				},
				yaxunit: { '--command': 'RunUnitTests=yax.json' },
				'syntax-check': {
					'--exception-file': 'tools/syntax-check-excludes.txt',
					'--junitpath': 'build/syntax.xml',
				},
			}, 'v2');
			assert.deepStrictEqual(links.map((link) => link.lines[0]), [
				'файл  VA.json',
				'файл  ./tools/xUnitParams.json',
				'файл  yax.json',
				'файл  tools/syntax-check-excludes.txt',
			]);
			assert.deepStrictEqual(links.map((link) => link.lines.at(-1)), [
				'отчёт  build/cucumber',
				'отчёт  build/junit.xml',
				'отчёт  build/yax.xml',
				'отчёт  build/syntax.xml',
			]);
			assert.deepStrictEqual(links.map((link) => link.ok), [true, true, true, true]);
			assert.deepStrictEqual(serviceFileClauses(links, ['vanessa', 'xunit', 'yaxunit']), [
				'Vanessa: VA.json',
				'xUnit: ./tools/xUnitParams.json',
				'YAxUnit: yax.json',
			]);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('нет файла профиля: красная строка без дерева', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'links-'));
		try {
			assert.strictEqual(await profileFileMissing(root, 'autumn-properties.json'), true);
			await fs.writeFile(path.join(root, 'autumn-properties.json'), '{}');
			assert.strictEqual(await profileFileMissing(root, 'autumn-properties.json'), false);
			assert.strictEqual(
				formatMissingProfileFile('autumn-properties.json'),
				'\u001b[31m./autumn-properties.json  файл не найден\u001b[0m',
			);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('отчёт проверки: файл профиля и ветки под ним', () => {
		const text = formatProfileLinks('autumn-properties.json', [
			{ short: 'VA', title: 'Vanessa', ok: true, lines: ['файл  ./tools/VAParams.json', 'отчёт  Cucumber JSON'] },
			{ short: 'xUnit', title: 'xUnit', ok: false, lines: ['генератор jUnit не задан'] },
		]);
		assert.strictEqual(text, [
			'./autumn-properties.json',
			'  ├─ Vanessa  \u001b[32mесть\u001b[0m',
			'  │  ├─ файл  ./tools/VAParams.json',
			'  │  └─ отчёт  Cucumber JSON',
			'\u001b[33m  └─ xUnit\u001b[0m  \u001b[33mнет\u001b[0m',
			'\u001b[33m     └─ генератор jUnit не задан\u001b[0m',
		].join('\n'));
	});

	test('файл VA без каталога отчёта: проблема в этом файле', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'links-'));
		await fs.writeFile(path.join(root, 'VA.json'), '{}');
		try {
			const links = await profileLinks(root, {
				vanessa: { '--vanessasettings': 'VA.json' },
			}, 'v2');
			assert.strictEqual(links[0].ok, false);
			assert.deepStrictEqual(serviceFileClauses(links, ['vanessa', 'xunit']), [
				`Vanessa: VA.json, ${yellow('каталог отчёта не задан')}`,
				`xUnit: ${yellow('--reportsxunit не задан')}`,
			]);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('файл настроек VA не найден', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'links-'));
		try {
			const links = await profileLinks(root, {
				vanessa: { '--vanessasettings': 'нет.json' },
			}, 'v2');
			assert.deepStrictEqual(links[0].gap, { where: 'нет.json', text: 'файл не найден' });
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('JSON с BOM читается', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'links-'));
		await fs.writeFile(path.join(root, 'VA.json'), `\uFEFF${JSON.stringify({
			'ДелатьОтчетВФорматеCucumberJson': true,
			'КаталогВыгрузкиCucumberJson': 'build/cucumber',
		})}`);
		try {
			const links = await profileLinks(root, { vanessa: { '--vanessasettings': 'VA.json' } }, 'v2');
			assert.strictEqual(links[0].ok, true);
			assert.strictEqual(links[0].lines.at(-1), 'отчёт  build/cucumber');
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('reportsxunit без генератора jUnit', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'links-'));
		try {
			const links = await profileLinks(root, {
				xunit: { '--reportsxunit': 'ГенераторОтчетаAllureXMLВерсия2{build/allure.xml}' },
			}, 'v2');
			assert.deepStrictEqual(links[1].gap, { text: 'генератор jUnit не задан' });
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('в 3.x нет yaxunit-config и report-path', async () => {
		const links = await profileLinks('.', { vrunner: { test: { yaxunit: {} } } }, 'v3');
		assert.deepStrictEqual(links[2].gap, { text: 'yaxunit-config не задан' });
		assert.deepStrictEqual(links[3].gap, { text: 'report-path не задан' });
	});

	test('конфиг YAxUnit без reportPath', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'links-'));
		await fs.writeFile(path.join(root, 'yax.json'), '{}');
		try {
			const links = await profileLinks(root, {
				vrunner: { test: { yaxunit: { 'yaxunit-config': 'yax.json' } } },
			}, 'v3');
			assert.deepStrictEqual(links[2].gap, { where: 'yax.json', text: 'reportPath не задан' });
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('заголовок называет служебный файл фреймворка', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'links-'));
		await fs.writeFile(path.join(root, 'yax.json'), JSON.stringify({ reportPath: 'build/yax.xml' }));
		await fs.writeFile(path.join(root, 'autumn-properties.json'), '{}');
		try {
			const text = await formatLaunchPreface({
				launchSummary: () => ({
					profile: { label: 'По умолчанию', settingsFiles: ['autumn-properties.json'] },
					environment: { files: ['.env'], variables: {} },
				}),
				readActiveSettings: async () => ({
					settings: { vrunner: { test: { yaxunit: { 'yaxunit-config': 'yax.json' } } } },
					schema: 'v3',
				}),
				getActiveEnvFile: () => 'autumn-properties.json',
			}, root, ['yaxunit']);
			assert.strictEqual(
				text,
				'Профиль запуска: По умолчанию (autumn-properties.json); YAxUnit: yax.json; окружение: По умолчанию (.env)',
			);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('команда из дерева пишет ту же первую строку, что панель', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'links-'));
		await fs.writeFile(path.join(root, 'autumn-properties.json'), '{}');
		try {
			const text = await formatLaunchPreface({
				launchSummary: () => ({
					profile: { label: 'По умолчанию', settingsFiles: ['autumn-properties.json'] },
					environment: { files: ['.env'], variables: {} },
				}),
				readActiveSettings: async () => ({ settings: {}, schema: 'v3' }),
				getActiveEnvFile: () => 'autumn-properties.json',
			}, root, ['xunit']);
			assert.strictEqual(
				text,
				`Профиль запуска: По умолчанию (autumn-properties.json); xUnit: ${yellow('reportsxunit не задан')}; окружение: По умолчанию (.env)`,
			);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('нет файла профиля: в строке прогона красная пометка', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'links-'));
		try {
			const text = await formatLaunchPreface({
				launchSummary: () => ({
					profile: { label: 'По умолчанию', settingsFiles: [] },
					environment: { files: ['.env'], variables: {} },
				}),
				readActiveSettings: async () => ({ settings: {}, schema: 'v3' }),
				getActiveEnvFile: () => 'autumn-properties.json',
			}, root, ['vanessa', 'xunit', 'yaxunit', 'syntax-check']);
			assert.strictEqual(
				text,
				`Профиль запуска: По умолчанию (${formatMissingProfileFile('autumn-properties.json')}); окружение: По умолчанию (.env)`,
			);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test('прогон только xUnit не пишет проблему Vanessa', async () => {
		const links = await profileLinks('.', {}, 'v3');
		assert.deepStrictEqual(serviceFileClauses(links, ['xunit']), [
			`xUnit: ${yellow('reportsxunit не задан')}`,
		]);
	});
});

function yellow(text: string): string {
	return `\u001b[33m${text}\u001b[0m`;
}
