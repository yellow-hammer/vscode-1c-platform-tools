import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readRunSummary, formatRunSummary } from '../../features/testing/runReportSummary';

const JUNIT_MIXED = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Смоук" tests="3">
    <testcase classname="Смоук" name="Зелёный"/>
    <testcase classname="Смоук" name="Красный"><failure message="упал"/></testcase>
    <testcase classname="Смоук" name="Пропущенный"><skipped/></testcase>
  </testsuite>
</testsuites>`;

const JUNIT_GREEN = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Набор" tests="1">
  <testcase classname="Набор" name="Единственный"/>
</testsuite>`;

suite('runReportSummary', () => {
	let dir: string;

	setup(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-report-'));
	});
	teardown(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('файл отчёта: сводка со счётчиками и упавшими', async () => {
		const file = path.join(dir, 'junit.xml');
		fs.writeFileSync(file, JUNIT_MIXED, 'utf8');
		const stats = await readRunSummary(file, Date.now() - 60_000);
		assert.ok(stats);
		assert.strictEqual(stats.total, 3);
		assert.strictEqual(stats.passed, 1);
		assert.strictEqual(stats.failed, 1);
		assert.strictEqual(stats.skipped, 1);
		assert.deepStrictEqual(stats.failedTests, ['Смоук: Красный']);
	});

	test('каталог: собираются все свежие xml', async () => {
		fs.writeFileSync(path.join(dir, 'a.xml'), JUNIT_GREEN, 'utf8');
		fs.writeFileSync(path.join(dir, 'b.xml'), JUNIT_MIXED, 'utf8');
		fs.writeFileSync(path.join(dir, 'note.txt'), 'не отчёт', 'utf8');
		const stats = await readRunSummary(dir, Date.now() - 60_000);
		assert.ok(stats);
		assert.strictEqual(stats.total, 4);
		assert.strictEqual(stats.failed, 1);
	});

	test('устаревший отчёт не считается результатом прогона', async () => {
		const file = path.join(dir, 'junit.xml');
		fs.writeFileSync(file, JUNIT_GREEN, 'utf8');
		const old = Date.now() - 3_600_000;
		fs.utimesSync(file, old / 1000, old / 1000);
		const stats = await readRunSummary(file, Date.now() - 60_000);
		assert.strictEqual(stats, undefined);
	});

	test('отсутствующий путь даёт undefined', async () => {
		const stats = await readRunSummary(path.join(dir, 'нет'), 0);
		assert.strictEqual(stats, undefined);
	});

	test('повреждённый xml не валит сводку по остальным', async () => {
		fs.writeFileSync(path.join(dir, 'broken.xml'), '<не xml', 'utf8');
		fs.writeFileSync(path.join(dir, 'ok.xml'), JUNIT_GREEN, 'utf8');
		const stats = await readRunSummary(dir, Date.now() - 60_000);
		assert.ok(stats);
		assert.strictEqual(stats.total, 1);
	});

	test('cucumber: сводка из каталога *.json', async () => {
		const cucumber = JSON.stringify([{
			name: 'Смоук',
			elements: [
				{ type: 'scenario', name: 'Зелёный', steps: [{ keyword: 'Когда ', name: 'шаг', result: { status: 'passed', duration: 1000 } }] },
				{ type: 'scenario', name: 'Красный', steps: [{ keyword: 'Тогда ', name: 'шаг', result: { status: 'failed' } }] },
			],
		}]);
		fs.writeFileSync(path.join(dir, 'report.json'), cucumber, 'utf8');
		fs.writeFileSync(path.join(dir, 'мусор.xml'), '<x/>', 'utf8');
		const stats = await readRunSummary(dir, Date.now() - 60_000, 'cucumber');
		assert.ok(stats);
		assert.strictEqual(stats.total, 2);
		assert.strictEqual(stats.failed, 1);
		assert.deepStrictEqual(stats.failedTests, ['Смоук: Красный']);
	});

	test('formatRunSummary: счётчики, отчёт и упавшие', () => {
		const text = formatRunSummary({
			total: 3, passed: 1, failed: 1, errors: 0, skipped: 1,
			reportPath: 'build/out/junit', failedTests: ['Смоук: Красный'],
		});
		assert.ok(text.includes('Тестов: 3'));
		assert.ok(text.includes('упало: 1'));
		assert.ok(text.includes('Смоук: Красный'));
	});
});
