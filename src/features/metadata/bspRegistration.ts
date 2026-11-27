/**
 * Регистрация БСП для внешней обработки и внешнего отчёта.
 *
 * Генерирует в объектном модуле функцию `СведенияОВнешнейОбработке` по канону
 * подсистемы «Дополнительные отчёты и обработки» и, для обработки, каркас
 * `ВыполнитьКоманду`. Блок самодостаточен: свой `#Если Сервер` и свои области,
 * поэтому дописывается и в непустой модуль.
 *
 * @module bspRegistration
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { isPunct, lowerName, tokenize } from '../../shared/oneScriptLexer';

/** Параметры генерации: у отчёта и обработки различаются вид и тип команды. */
interface BspRegistrationInput {
	readonly report: boolean;
	readonly presentation: string;
	readonly commandId: string;
}

const REGISTRATION_NAME = 'СведенияОВнешнейОбработке';
const REGISTRATION_NAME_LOWER = REGISTRATION_NAME.toLowerCase();

function registrationOffset(source: string): number | undefined {
	const tokens = tokenize(source);
	return tokens.find((token, index) => {
		const keyword = lowerName(token);
		return (keyword === 'функция' || keyword === 'function')
			&& lowerName(tokens[index + 1]) === REGISTRATION_NAME_LOWER
			&& isPunct(tokens[index + 2], '(');
	})?.start;
}

async function showRegistration(
	document: vscode.TextDocument,
	offset = registrationOffset(document.getText()) ?? 0
): Promise<void> {
	const position = document.positionAt(offset);
	await vscode.window.showTextDocument(document, { preview: false, selection: new vscode.Range(position, position) });
}

/**
 * Добавляет регистрацию или открывает её объявление, если оно уже есть.
 * @returns Записан ли новый блок на диск, чтобы дерево могло перечитать версию.
 */
export async function addBspRegistration(moduleUri: vscode.Uri, report: boolean, name: string): Promise<boolean> {
	const exists = await vscode.workspace.fs.stat(moduleUri).then(() => true, (error: unknown) => {
		if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
			return false;
		}
		throw error;
	});
	const document = exists ? await vscode.workspace.openTextDocument(moduleUri) : undefined;
	const existingOffset = document && registrationOffset(document.getText());
	if (document && existingOffset !== undefined) {
		await showRegistration(document, existingOffset);
		return false;
	}

	const presentation = await vscode.window.showInputBox({
		title: 'Представление команды',
		value: name,
		validateInput: (value) => (!value.trim() ? 'Введите представление.' : null),
	});
	if (!presentation) {
		return false;
	}
	const block = buildBspRegistration({
		report,
		presentation: presentation.trim().replaceAll("'", '"'),
		commandId: report ? 'ОткрытьФорму' : 'ВыполнитьОбработку',
	});

	if (!document) {
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(moduleUri.fsPath)));
		await vscode.workspace.fs.writeFile(moduleUri, new TextEncoder().encode('\uFEFF' + block));
		await showRegistration(await vscode.workspace.openTextDocument(moduleUri));
		return true;
	}

	const source = document.getText();
	const addedOffset = registrationOffset(source);
	if (addedOffset !== undefined) {
		await showRegistration(document, addedOffset);
		return false;
	}
	const eol = document.eol === vscode.EndOfLine.LF ? '\n' : '\r\n';
	const separator = source ? (source.endsWith('\n') ? eol : eol + eol) : '';
	const edit = new vscode.WorkspaceEdit();
	edit.insert(moduleUri, document.positionAt(source.length), separator + block.replaceAll('\r\n', eol));
	const wasClean = !document.isDirty;
	if (!await vscode.workspace.applyEdit(edit)) {
		throw new Error('Не удалось добавить регистрацию БСП в объектный модуль.');
	}
	const saved = wasClean && await document.save();
	await showRegistration(document);
	return saved;
}

function buildBspRegistration(input: BspRegistrationInput): string {
	const kind = input.report
		? 'ДополнительныеОтчетыИОбработкиКлиентСервер.ВидОбработкиДополнительныйОтчет()'
		: 'ДополнительныеОтчетыИОбработкиКлиентСервер.ВидОбработкиДополнительнаяОбработка()';
	const use = input.report
		? 'ДополнительныеОтчетыИОбработкиКлиентСервер.ТипКомандыОткрытиеФормы()'
		: 'ДополнительныеОтчетыИОбработкиКлиентСервер.ТипКомандыВызовСерверногоМетода()';
	const lines = [
		'#Если Сервер Или ТолстыйКлиентОбычноеПриложение Или ВнешнееСоединение Тогда',
		'',
		'#Область ПрограммныйИнтерфейс',
		'',
		`// Возвращает сведения о внешн${input.report ? 'ем отчёте' : 'ей обработке'}.`,
		'//',
		'// Возвращаемое значение:',
		'//   Структура - Подробнее см. ДополнительныеОтчетыИОбработки.СведенияОВнешнейОбработке().',
		'//',
		`Функция ${REGISTRATION_NAME}() Экспорт`,
		'\tПараметрыРегистрации = ДополнительныеОтчетыИОбработки.СведенияОВнешнейОбработке();',
		`\tПараметрыРегистрации.Вид = ${kind};`,
		'\tПараметрыРегистрации.Версия = "1.0";',
		'\tПараметрыРегистрации.Информация = НСтр("ru = \'\'");',
		'',
		'\tКоманда = ПараметрыРегистрации.Команды.Добавить();',
		`\tКоманда.Представление = НСтр("ru = '${input.presentation}'");`,
		`\tКоманда.Идентификатор = "${input.commandId}";`,
		`\tКоманда.Использование = ${use};`,
		'\tКоманда.ПоказыватьОповещение = Ложь;',
		'',
		'\tВозврат ПараметрыРегистрации;',
		'КонецФункции',
		'',
		'#КонецОбласти',
	];
	if (!input.report) {
		lines.push(
			'',
			'#Область ОбработчикиСобытий',
			'',
			'// Выполняет команду обработки.',
			'//',
			'// Параметры:',
			'//   ИдентификаторКоманды - Строка - идентификатор из СведенияОВнешнейОбработке().',
			'//   ПараметрыВыполнения - Структура - контекст выполнения команды.',
			'//',
			'Процедура ВыполнитьКоманду(ИдентификаторКоманды, ПараметрыВыполнения) Экспорт',
			`\tЕсли ИдентификаторКоманды = "${input.commandId}" Тогда`,
			'\t\t// Код команды.',
			'\tКонецЕсли;',
			'КонецПроцедуры',
			'',
			'#КонецОбласти'
		);
	}
	lines.push('', '#КонецЕсли', '');
	return lines.join('\r\n');
}
