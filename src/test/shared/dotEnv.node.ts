/**
 * Разбор файлов `.env` по правилам dotenv для OneScript.
 * Запуск: npm run test:node
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDotEnv } from '../../shared/dotEnv';

const parse = (text: string, outside: Record<string, string> = {}) =>
	Object.fromEntries(parseDotEnv(text, (name) => outside[name]));

describe('parseDotEnv', () => {
	test('строка значения, комментарии, export и пробелы вокруг знака равенства', () => {
		assert.deepEqual(
			parse([
				'# комментарий',
				'',
				'TESTRUNNER_RUN_SQLITE_TESTS=true   # хвост отбрасывается',
				'export POSTGRES_PORT=5432',
				'SPACED   =   значение',
				'EQUALS=a=b',
				'EMPTY=',
				'HASH=a#b',
			].join('\n')),
			{
				TESTRUNNER_RUN_SQLITE_TESTS: 'true',
				POSTGRES_PORT: '5432',
				SPACED: 'значение',
				EQUALS: 'a=b',
				EMPTY: '',
				HASH: 'a#b',
			}
		);
	});

	test('кириллица в имени: детальки Осени задаются переменными', () => {
		assert.deepEqual(parse('mutatos_КаталогиТестов=tests'), { mutatos_КаталогиТестов: 'tests' });
	});

	test('строки без знака равенства и с недопустимым ключом пропускаются', () => {
		assert.deepEqual(parse('просто текст\nBAD KEY=1\nOK=1'), { OK: '1' });
	});

	test('двойные кавычки раскрывают \\n и решётку внутри не режут', () => {
		assert.deepEqual(parse('DOUBLE="перенос\\nстроки и # внутри" # комментарий'), { DOUBLE: 'перенос\nстроки и # внутри' });
	});

	test('одинарные и обратные кавычки буквальны', () => {
		assert.deepEqual(parse("SINGLE='\\n и ${BASE}'\nBACKTICK=`с 'любыми' \"кавычками\"`", { BASE: 'x' }), {
			SINGLE: '\\n и ${BASE}',
			BACKTICK: 'с \'любыми\' "кавычками"',
		});
	});

	test('значение в кавычках занимает несколько строк', () => {
		assert.deepEqual(parse('MULTI="первая\nвторая"\nNEXT=1'), { MULTI: 'первая\nвторая', NEXT: '1' });
	});

	test('ссылки: на значение выше, на окружение снаружи, умолчание и экранирование', () => {
		assert.deepEqual(
			parse('BASE=/opt\nBIN=${BASE}/bin\nHOST=${PGHOST}\nPORT=${PORT:-8080}\nLITERAL=\\${BASE}', { PGHOST: 'db' }),
			{ BASE: '/opt', BIN: '/opt/bin', HOST: 'db', PORT: '8080', LITERAL: '${BASE}' }
		);
	});

	test('пустое значение считается отсутствующим для умолчания', () => {
		assert.deepEqual(parse('EMPTY=\nVALUE=${EMPTY:-запасное}'), { EMPTY: '', VALUE: 'запасное' });
	});

	test('повторный ключ перекрывает прежний', () => {
		assert.deepEqual(parse('A=1\nA=2'), { A: '2' });
	});
});
