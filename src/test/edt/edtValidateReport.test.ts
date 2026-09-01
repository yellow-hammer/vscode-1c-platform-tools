import * as assert from 'node:assert';
import { parseEdtValidationReport } from '../../features/edt/edtValidateReport';

suite('отчёт проверки EDT', () => {
	test('таблица с заголовком разбирается по именам колонок', () => {
		const report = [
			'Project\tResource\tLine\tSeverity\tDescription',
			'ssl31\tsrc/CommonModules/Тест/Module.bsl\t12\tError\tПеременная не определена',
			'ssl31\tsrc/Catalogs/Валюты/Валюты.mdo\t\tWarning\tНе заполнен синоним',
		].join('\n');

		const findings = parseEdtValidationReport(report);

		assert.strictEqual(findings.length, 2);
		assert.deepStrictEqual(findings[0], {
			project: 'ssl31',
			file: 'src/CommonModules/Тест/Module.bsl',
			line: 12,
			severity: 'error',
			message: 'Переменная не определена',
		});
		assert.strictEqual(findings[1].severity, 'warning');
		assert.strictEqual(findings[1].line, undefined);
	});

	test('русские заголовки понимаются так же', () => {
		const report = [
			'Проект\tРесурс\tСтрока\tУровень\tОписание',
			'ssl31\tsrc/Module.bsl\t3\tПредупреждение\tНеиспользуемая переменная',
		].join('\n');

		const findings = parseEdtValidationReport(report);

		assert.strictEqual(findings[0].severity, 'warning');
		assert.strictEqual(findings[0].message, 'Неиспользуемая переменная');
	});

	test('таблица без заголовка читается по порядку колонок', () => {
		const report = 'ssl31\tsrc/Module.bsl\t7\tError\tОшибка синтаксиса';

		const findings = parseEdtValidationReport(report);

		assert.strictEqual(findings.length, 1);
		assert.strictEqual(findings[0].line, 7);
		assert.strictEqual(findings[0].message, 'Ошибка синтаксиса');
	});

	test('строки без текста замечания пропускаются', () => {
		const report = ['Project\tResource\tLine\tSeverity\tDescription', 'ssl31\tsrc/Module.bsl\t1\tError\t', ''].join('\n');

		assert.deepStrictEqual(parseEdtValidationReport(report), []);
	});

	test('пустой отчёт даёт пустой список', () => {
		assert.deepStrictEqual(parseEdtValidationReport(''), []);
		assert.deepStrictEqual(parseEdtValidationReport('\n\n'), []);
	});
});
