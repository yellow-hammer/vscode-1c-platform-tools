/**
 * Фикстура вариантов настроек СКД: реальный `Template.xml` отчёта
 * `_ДемоДинамикаИзмененийФайлов` из выгрузки БСП 3.1 (см. `src/test/fixtures/dcs/README.md`)
 * сохраняет формат выгрузки и опорные имена, на которые опирается редактор вариантов настроек.
 * Запуск: npm run compile && node --test out/test/metadata/dcsSettingsFixture.node.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const FIXTURE = path.resolve(__dirname, '../../../src/test/fixtures/dcs/Template-variants.xml');

/** Число вхождений опорного фрагмента: разделы вариантов считаются точно. */
function count(text: string, anchor: string): number {
	return text.split(anchor).length - 1;
}

describe('Фикстура вариантов настроек схемы компоновки', () => {
	const raw = fs.readFileSync(FIXTURE);
	const text = raw.toString('utf8');

	test('фикстура повторяет выгрузку конфигуратора байт в байт', () => {
		// BOM, CRLF, табы и хвост без перевода строки — часть формата выгрузки:
		// их потеря сломала бы байтовые проверки писателя md-sparrow
		assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'нет BOM UTF-8');
		const lines = text.split('\r\n');
		assert.ok(lines.length > 1, 'нет переводов строк CRLF');
		assert.ok(
			lines.every((line) => !line.includes('\n') && !line.includes('\r')),
			'есть одиночные LF или CR'
		);
		assert.ok(text.includes('\r\n\t<settingsVariant>'), 'отступы не табами');
		assert.ok(text.endsWith('</DataCompositionSchema>'), 'в конце файла появился перевод строки');
	});

	test('шесть вариантов с опорными именами: есть что грузить, переименовывать и удалять', () => {
		assert.equal(count(text, '<settingsVariant>'), 6, 'вариантов настроек');
		for (const name of [
			'Основной',
			'Дополнительный1',
			'Дополнительный2',
			'Дополнительный3',
			'Дополнительный4',
			'Дополнительный5',
		]) {
			assert.equal(count(text, `<dcsset:name>${name}</dcsset:name>`), 1, `имя варианта ${name}`);
		}
		// Представления вариантов — локализованные строки: заголовки правятся языком конфигурации
		assert.equal(count(text, '<dcsset:presentation xsi:type="v8:LocalStringType">'), 6, 'представления вариантов');
	});

	test('структура вариантов: группировки и диаграммы с точками', () => {
		assert.equal(count(text, 'xsi:type="dcsset:StructureItemGroup"'), 6, 'группировки');
		assert.equal(count(text, 'xsi:type="dcsset:StructureItemChart"'), 2, 'диаграммы');
		assert.equal(count(text, '<dcsset:point>'), 2, 'группы точек диаграмм');
	});

	test('поля группировки с дополнением периода и nil-границей — полной пятёркой платформы', () => {
		assert.equal(count(text, '<dcsset:periodAdditionType>Month</dcsset:periodAdditionType>'), 2, 'дополнение Month');
		assert.equal(count(text, '<dcsset:periodAdditionType>Day</dcsset:periodAdditionType>'), 1, 'дополнение Day');
		assert.equal(count(text, '<dcsset:periodAdditionBegin xsi:nil="true"/>'), 1, 'nil-граница начала');
		assert.equal(
			count(text, '<dcsset:periodAdditionEnd xsi:type="xs:dateTime">0001-01-01T00:00:00</dcsset:periodAdditionEnd>'),
			3,
			'нулевые границы конца'
		);
	});

	test('параметры и хвосты пользовательских настроек: есть что сохранять passthrough', () => {
		assert.equal(count(text, '<dcscor:parameter>Период</dcscor:parameter>'), 1, 'параметр данных Период');
		assert.equal(count(text, '<dcscor:value xsi:type="v8:StandardPeriod">'), 1, 'стандартный период в варианте');
		assert.equal(count(text, '<dcscor:value xsi:nil="true"/>'), 2, 'nil-значения параметров');
		assert.equal(count(text, '<dcsset:userSettingID>'), 8, 'идентификаторы пользовательских настроек');
		// ТипДиаграммы типизирован вне белого словаря записи — редактор показывает его read-only
		assert.equal(count(text, 'xsi:type="v8ui:ChartType"'), 2, 'типы диаграмм');
	});
});
