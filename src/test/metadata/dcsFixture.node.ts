/**
 * Фикстура схемы компоновки данных: реальный `Template.xml` из выгрузки БСП 3.1
 * (см. `src/test/fixtures/dcs/README.md`) распознаётся и не теряет формат.
 * Запуск: npm run compile && node --test out/test/metadata/dcsFixture.node.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { classifyTemplateContent } from '../../features/spreadsheet/templateContent';

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const FIXTURE = path.resolve(__dirname, '../../../src/test/fixtures/dcs/Template.xml');

/** Число вхождений открывающего элемента: опорные разделы схемы считаются точно. */
function count(text: string, anchor: string): number {
	return text.split(anchor).length - 1;
}

describe('Фикстура схемы компоновки данных', () => {
	const raw = fs.readFileSync(FIXTURE);
	const text = raw.toString('utf8');

	test('фикстура повторяет выгрузку конфигуратора байт в байт', () => {
		// BOM, CRLF и табы — часть формата выгрузки: их потеря сломала бы точечные правки md-sparrow
		assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'нет BOM UTF-8');
		const lines = text.split('\r\n');
		assert.ok(lines.length > 1, 'нет переводов строк CRLF');
		assert.ok(
			lines.every((line) => !line.includes('\n') && !line.includes('\r')),
			'есть одиночные LF или CR'
		);
		assert.ok(text.includes('\r\n\t<dataSet '), 'отступы не табами');
	});

	test('в схеме есть наборы, связи, вычисляемые поля, ресурсы, параметры и вариант настроек', () => {
		assert.equal(count(text, '<dataSet xsi:type="DataSetQuery"'), 1, 'набор-запрос');
		assert.equal(count(text, '<dataSet xsi:type="DataSetObject"'), 1, 'набор-объект');
		assert.ok(text.includes('<name>ОсновнойЗапрос</name>'), 'имя набора-запроса');
		assert.ok(text.includes('<name>ВнешняяТаблица</name>'), 'имя набора-объекта');
		assert.equal(count(text, '<dataSetLink>'), 1, 'связи наборов');
		assert.equal(count(text, '<calculatedField>'), 3, 'вычисляемые поля');
		assert.equal(count(text, '<totalField>'), 1, 'ресурсы');
		assert.equal(count(text, '<parameter>'), 11, 'параметры');
		assert.equal(count(text, '<settingsVariant>'), 1, 'вариант настроек');
	});

	test('содержимое макета классифицируется как схема компоновки', async () => {
		assert.equal(await classifyTemplateContent(FIXTURE), 'dcs');
	});
});
