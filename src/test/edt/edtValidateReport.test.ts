import * as assert from 'node:assert';
import { parseEdtValidationReport } from '../../features/edt/edtValidateReport';

/**
 * Строки взяты из отчёта 1С:EDT 2026.1 на демонстрационном расширении:
 * восемь колонок через табуляцию, без заголовка.
 */
const REPORT = [
	[
		'2026-09-01T19:45:53+0300',
		'Незначительная',
		'Стандарты кодирования',
		'ssl31._ДемоРасширение',
		'com.e1c.v8codestyle.bsl:extension-method-prefix',
		'ОбщийМодуль.ВариантыОтчетовПереопределяемый.Модуль',
		'строка 22',
		'Имя метода "ЗаведомоСломанная" должно содержать префикс "_Демо"',
	].join('\t'),
	[
		'2026-09-01T19:45:54+0300',
		'Ошибка конфигурации',
		'',
		'ssl31._ДемоРасширение',
		'',
		'ОбщийМодуль.ВариантыОтчетовПереопределяемый.Модуль',
		'строка 23',
		'Ожидается выражение',
	].join('\t'),
	[
		'2026-09-01T19:45:54+0300',
		'Незначительная',
		'Стандарты кодирования',
		'ssl31._ДемоРасширение',
		'com.e1c.v8codestyle.md:extension-md-object-prefix',
		'HTTPСервис.GetProductPrice',
		'Имя',
		'Имя объекта должно содержать префикс',
	].join('\t'),
	[
		'2026-09-01T19:45:54+0300',
		'Значительная',
		'Предупреждение',
		'ssl31._ДемоРасширение',
		'com._1c.g5.v8.dt.md.extension:md-ext-legacy-check',
		'Перечисление.ТипыКонтактнойИнформации',
		'',
		'Заимствованный объект отсутствует в расширяемой конфигурации',
	].join('\t'),
].join('\r\n');

suite('отчёт проверки EDT', () => {
	test('колонки читаются по местам: заголовка в отчёте нет', () => {
		const findings = parseEdtValidationReport(REPORT);

		assert.strictEqual(findings.length, 4);
		assert.strictEqual(findings[0].project, 'ssl31._ДемоРасширение');
		assert.strictEqual(findings[0].category, 'Стандарты кодирования');
		assert.strictEqual(findings[0].check, 'com.e1c.v8codestyle.bsl:extension-method-prefix');
		assert.strictEqual(findings[0].metadataPath, 'ОбщийМодуль.ВариантыОтчетовПереопределяемый.Модуль');
		assert.strictEqual(findings[0].message, 'Имя метода "ЗаведомоСломанная" должно содержать префикс "_Демо"');
	});

	test('строка модуля берётся из положения', () => {
		const findings = parseEdtValidationReport(REPORT);

		assert.strictEqual(findings[0].line, 22);
		assert.strictEqual(findings[0].position, undefined);
	});

	test('положение внутри объекта сохраняется, когда это не строка', () => {
		const findings = parseEdtValidationReport(REPORT);

		assert.strictEqual(findings[2].position, 'Имя');
		assert.strictEqual(findings[2].line, undefined);
	});

	test('важность переводится в уровень', () => {
		const findings = parseEdtValidationReport(REPORT);

		assert.strictEqual(findings[0].severity, 'info');
		assert.strictEqual(findings[1].severity, 'error');
		assert.strictEqual(findings[3].severity, 'warning');
	});

	test('пустые колонки не мешают', () => {
		const findings = parseEdtValidationReport(REPORT);

		assert.strictEqual(findings[1].check, undefined);
		assert.strictEqual(findings[3].position, undefined);
	});

	test('пустой отчёт даёт пустой список', () => {
		assert.deepStrictEqual(parseEdtValidationReport(''), []);
		assert.deepStrictEqual(parseEdtValidationReport('\r\n\r\n'), []);
	});

	test('строки не из восьми колонок пропускаются', () => {
		const findings = parseEdtValidationReport('мусор\tиз\tдвух');

		assert.deepStrictEqual(findings, []);
	});
});
