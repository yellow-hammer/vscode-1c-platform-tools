import * as assert from 'node:assert';
import {
	extractQuotedIdentifier,
	findIdentifierOffsets,
	LineMap,
} from '../../features/diagnostics/bslLocator';

suite('bslLocator', () => {
	test('extractQuotedIdentifier берёт идентификатор из кавычек', () => {
		assert.strictEqual(
			extractQuotedIdentifier('Использование синхронного вызова: "Существует"'),
			'Существует'
		);
		assert.strictEqual(
			extractQuotedIdentifier('Возможно ошибочный метод: «УдалитьЗапись»'),
			'УдалитьЗапись'
		);
		assert.strictEqual(
			extractQuotedIdentifier('Неразрешимые ссылки на объекты метаданных (2)'),
			undefined
		);
	});

	test('findIdentifierOffsets учитывает границы слова (кириллица)', () => {
		const text = 'Если Существует(Файл) Тогда\n  СуществуетЛи = Истина;\n  Возврат Существует(Путь);\nКонецЕсли;';
		const offsets = findIdentifierOffsets(text, 'Существует');
		// «СуществуетЛи» не должно совпасть — только два настоящих вызова
		assert.strictEqual(offsets.length, 2);
	});

	test('LineMap.positionAt переводит смещение в строку/столбец', () => {
		const text = 'строка0\nстрока1\n  токен тут';
		const map = new LineMap(text);
		assert.deepStrictEqual(map.positionAt(0), { line: 0, character: 0 });
		const tokenOffset = text.indexOf('токен');
		assert.deepStrictEqual(map.positionAt(tokenOffset), { line: 2, character: 2 });
	});

	test('offsets + LineMap дают корректную позицию вызова', () => {
		const text = 'Функция Ф()\n    Возврат Существует(Путь);\nКонецФункции';
		const [offset] = findIdentifierOffsets(text, 'Существует');
		const pos = new LineMap(text).positionAt(offset);
		assert.strictEqual(pos.line, 1);
		assert.strictEqual(pos.character, text.split('\n')[1].indexOf('Существует'));
	});
});
