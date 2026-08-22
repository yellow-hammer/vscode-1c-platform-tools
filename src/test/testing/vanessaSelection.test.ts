import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { singlePathForSelection } from '../../features/testing/adapters/vanessaAdapter';

/** Фичи проекта: две в «Смоук», три в «Справочники» — как в ssl_3_1. */
const root = path.join('C:', 'проект', 'features');
const smoke = ['ЗапускПриложения.feature', 'ПерваяИнициализация.feature']
	.map((name) => vscode.Uri.file(path.join(root, 'Смоук', name)));
const catalogs = ['Валюты.feature', 'ДемоНоменклатура.feature', 'ПримерыПадений.feature']
	.map((name) => vscode.Uri.file(path.join(root, 'Справочники', name)));
const discovered = [...smoke, ...catalogs];

const units = (uris: vscode.Uri[]) => uris.map((fileUri) => ({ fileUri }));

suite('vanessa: состав прогона по выбору', () => {
	test('выбран весь набор — прогон без пути, одним сеансом', () => {
		assert.strictEqual(singlePathForSelection(units(discovered), discovered), '');
	});

	test('выбран каталог целиком — прогон по каталогу', () => {
		assert.strictEqual(
			singlePathForSelection(units(catalogs), discovered),
			path.dirname(catalogs[0].fsPath)
		);
	});

	test('часть каталога — одним путём не выразить', () => {
		assert.strictEqual(singlePathForSelection(units(catalogs.slice(0, 2)), discovered), undefined);
	});

	test('файлы из разных каталогов — одним путём не выразить', () => {
		assert.strictEqual(
			singlePathForSelection(units([smoke[0], catalogs[0]]), discovered),
			undefined
		);
	});

	test('один файл из каталога с единственной фичей — это весь каталог', () => {
		const single = [vscode.Uri.file(path.join(root, 'Одна', 'Единственная.feature'))];
		assert.strictEqual(
			singlePathForSelection(units(single), [...discovered, ...single]),
			path.dirname(single[0].fsPath)
		);
	});

	test('пустой список обнаруженных не выдаёт прогон всего набора', () => {
		assert.strictEqual(singlePathForSelection(units(catalogs), []), path.dirname(catalogs[0].fsPath));
	});
});
