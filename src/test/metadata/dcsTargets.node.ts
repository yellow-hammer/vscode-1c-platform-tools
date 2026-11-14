/**
 * Адресация файлов схемы компоновки: описание владельца макета с версией формата и рабочим
 * каталогом (выгрузка конфигуратора, внешний отчёт, проект EDT) и параметры создания и удаления макета.
 * Адресацию файлов для подсказок конструктора запроса проверяет dcsQueryHost.node.ts.
 * Запуск: npm run compile && node --test out/test/metadata/dcsTargets.node.js
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { dcsEditorUnsupportedReason, dcsTemplateMutationParams, resolveDcsOwnerTarget } from '../../features/metadata/dcsTargets';

/** Описание с версией формата на корневом MetaDataObject. */
function metaDataObjectXml(version: string, body: string): string {
	return (
		'<?xml version="1.0" encoding="UTF-8"?>\r\n' +
		`<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="${version}">\r\n\t${body}\r\n</MetaDataObject>`
	);
}

function writeTree(root: string, files: Record<string, string>): void {
	for (const [relative, content] of Object.entries(files)) {
		const file = path.join(root, ...relative.split('/'));
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, content, 'utf8');
	}
}

describe('Описание владельца макета', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-targets-'));
	after(() => fs.rmSync(root, { recursive: true, force: true }));

	const cf = path.join(root, 'cf');
	writeTree(cf, {
		'Configuration.xml': metaDataObjectXml('2.20', '<Configuration/>'),
		'Reports/Отчет1.xml': metaDataObjectXml('2.20', '<Report/>'),
	});

	test('владелец в выгрузке: версия из Configuration.xml', async () => {
		const owner = path.join(cf, 'Reports', 'Отчет1.xml');
		const resolved = await resolveDcsOwnerTarget(owner, undefined);
		assert.ok('target' in resolved, 'error' in resolved ? resolved.error : '');
		assert.deepEqual(resolved.target, { objectXml: owner, cwd: cf, schemaVersion: 'V2_20' });
	});

	test('владелец общего макета — сам Configuration.xml', async () => {
		const configuration = path.join(cf, 'Configuration.xml');
		const resolved = await resolveDcsOwnerTarget('Configuration.xml', cf);
		assert.ok('target' in resolved, 'error' in resolved ? resolved.error : '');
		assert.deepEqual(resolved.target, { objectXml: configuration, cwd: cf, schemaVersion: 'V2_20' });
	});

	test('пустой путь и отсутствующий файл владельца дают понятные отказы', async () => {
		const empty = await resolveDcsOwnerTarget('', cf);
		assert.ok('error' in empty);
		assert.match(empty.error, /описанию владельца макета/);

		const missing = await resolveDcsOwnerTarget(path.join(cf, 'Reports', 'НетТакого.xml'), undefined);
		assert.ok('error' in missing);
		assert.match(missing.error, /Файл не найден/);
	});

	// Внешние отчёты и обработки выгружаются без Configuration.xml: версию несут их описания
	const external = path.join(root, 'external');
	writeTree(external, {
		'ВнешнийОтчет.xml': metaDataObjectXml('2.19', '<ExternalReport/>'),
	});

	test('вне выгрузки версию владельца несёт его собственное описание', async () => {
		const owner = path.join(external, 'ВнешнийОтчет.xml');
		const resolved = await resolveDcsOwnerTarget(owner, undefined);
		assert.ok('target' in resolved, 'error' in resolved ? resolved.error : '');
		assert.deepEqual(resolved.target, { objectXml: owner, cwd: external, schemaVersion: 'V2_19' });
	});

	// Проект EDT: версию формата знает метамодель сборки, флаг пустой
	const edt = path.join(root, 'edt');
	writeTree(edt, {
		'src/Configuration/Configuration.mdo': '<mdclass:Configuration/>',
		'src/Reports/Отчет1/Отчет1.mdo': '<mdclass:Report/>',
	});

	test('владелец .mdo проекта EDT: пустой флаг версии', async () => {
		const owner = path.join(edt, 'src', 'Reports', 'Отчет1', 'Отчет1.mdo');
		const resolved = await resolveDcsOwnerTarget(owner, undefined);
		assert.ok('target' in resolved, 'error' in resolved ? resolved.error : '');
		assert.deepEqual(resolved.target, { objectXml: owner, cwd: path.join(edt, 'src'), schemaVersion: '' });
	});
});

describe('Параметры создания и удаления макета', () => {
	const owner = { objectXml: path.join('cf', 'Reports', 'Отчет1.xml'), schemaVersion: 'V2_20' };

	test('создание: файл и версия владельца, имя; makeMain — только когда задан', () => {
		assert.deepEqual(dcsTemplateMutationParams('cf-dcs-template-add', owner, 'Макет', true), {
			op: 'cf-dcs-template-add',
			objectXml: owner.objectXml,
			schemaVersion: 'V2_20',
			name: 'Макет',
			makeMain: true,
		});
		assert.deepEqual(dcsTemplateMutationParams('cf-dcs-template-add', owner, 'Макет', false).makeMain, false);
		assert.ok(!('makeMain' in dcsTemplateMutationParams('cf-dcs-template-add', owner, 'Макет')));
	});

	test('удаление основную схему не назначает: makeMain не уходит', () => {
		assert.deepEqual(dcsTemplateMutationParams('cf-dcs-template-remove', owner, 'Макет', true), {
			op: 'cf-dcs-template-remove',
			objectXml: owner.objectXml,
			schemaVersion: 'V2_20',
			name: 'Макет',
		});
	});
});

describe('Форматы, которые редактор СКД не открывает', () => {
	test('2.10 и 2.11: отказ с номером формата', () => {
		assert.equal(
			dcsEditorUnsupportedReason('V2_10'),
			'Редактор схемы компоновки данных не поддерживает формат 2.10. Схему правьте в конфигураторе.'
		);
		assert.match(dcsEditorUnsupportedReason('V2_11') ?? '', /не поддерживает формат 2\.11\./);
	});

	test('2.12 и новее, проект 1C:EDT: открывает', () => {
		for (const flag of ['V2_12', 'V2_20', 'V2_21', '']) {
			assert.equal(dcsEditorUnsupportedReason(flag), undefined, flag);
		}
	});
});
