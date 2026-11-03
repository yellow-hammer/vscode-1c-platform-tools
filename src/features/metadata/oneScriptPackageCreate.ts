/**
 * Новый класс, модуль или программа пакета: файл и строка в `packagedef`.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PROJECT_FILE } from '../../shared/projectLayout';
import { packageMembers, parsePackagedef } from '../../shared/packagedef';
import { adoptExistingOneScriptMembers, ONESCRIPT_PROGRAM_PATH, recordConventionPackageMembers } from '../../shared/oneScriptMembers';

const NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

type PackageMemberPlace = 'class' | 'module' | 'executable';

const PLACE: Readonly<Record<'class' | 'module', { dir: string; title: string; method: string }>> = {
	class: { dir: path.join('src', 'Классы'), title: 'Класс', method: 'класса' },
	module: { dir: path.join('src', 'Модули'), title: 'Модуль', method: 'модуля' },
};

const CLASS_FILE = 'Процедура ПриСозданииОбъекта()\n\nКонецПроцедуры\n';

const PROGRAM_FILE = 'Процедура ВыполнитьПриложение()\n\tСообщить("Приложение запущено");\nКонецПроцедуры\n\nВыполнитьПриложение();\n';

/**
 * Спрашивает имя класса или модуля, создаёт файл и дописывает объявление в `packagedef`.
 *
 * Программа одна: `src/main.os`, без вопроса. Имя команды opm берёт из имени пакета.
 *
 * @param root - Корень проекта
 * @param kind - Класс, модуль или программа
 * @returns Абсолютный путь нового файла или undefined, если пользователь отказался
 */
export async function createOneScriptPackageMember(root: string, kind: PackageMemberPlace): Promise<string | undefined> {
	const packagedefPath = path.join(root, PROJECT_FILE);
	let source: string;
	try {
		source = await fs.readFile(packagedefPath, 'utf8');
	} catch {
		void vscode.window.showErrorMessage('Нет файла packagedef.');
		return undefined;
	}
	if (kind === 'executable') {
		return createProgram(root, source);
	}
	const place = PLACE[kind];
	const name = await vscode.window.showInputBox({
		title: place.title,
		prompt: `Имя ${place.method}`,
		ignoreFocusOut: true,
		validateInput: (value) => (NAME.test(value.trim()) ? undefined : 'Имя из букв, цифр и _'),
	});
	const trimmed = name?.trim();
	if (!trimmed) {
		return undefined;
	}
	const relative = `${place.dir.replaceAll('\\', '/')}/${trimmed}.os`;
	const known = packageMembers(parsePackagedef(source)).some(
		(member) => member.kind === kind && member.name === trimmed
	);
	if (known) {
		void vscode.window.showErrorMessage(`${place.title} «${trimmed}» уже есть в packagedef.`);
		return undefined;
	}
	const absolute = path.join(root, place.dir, `${trimmed}.os`);
	try {
		await fs.mkdir(path.dirname(absolute), { recursive: true });
		await fs.writeFile(absolute, fileContent(kind), { encoding: 'utf8', flag: 'wx' });
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		void vscode.window.showErrorMessage(
			code === 'EEXIST' ? `Файл уже есть: ${relative}` : 'Не удалось создать файл.'
		);
		return undefined;
	}
	await recordConventionPackageMembers(root);
	return absolute;
}

/** `src/main.os` и строка в packagedef. Уже лежащий файл становится программой, а не ошибкой. */
async function createProgram(root: string, source: string): Promise<string | undefined> {
	const known = packageMembers(parsePackagedef(source)).some(
		(member) => member.kind === 'executable' && member.file === ONESCRIPT_PROGRAM_PATH
	);
	if (known) {
		void vscode.window.showErrorMessage('Программа уже есть.');
		return undefined;
	}
	const absolute = path.join(root, ...ONESCRIPT_PROGRAM_PATH.split('/'));
	try {
		await fs.mkdir(path.dirname(absolute), { recursive: true });
		await fs.writeFile(absolute, PROGRAM_FILE, { encoding: 'utf8', flag: 'wx' });
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== 'EEXIST') {
			void vscode.window.showErrorMessage('Не удалось создать файл.');
			return undefined;
		}
	}
	await adoptExistingOneScriptMembers(root);
	return absolute;
}

function fileContent(kind: 'class' | 'module'): string {
	switch (kind) {
		case 'class':
			return CLASS_FILE;
		case 'module':
			return '\n';
		default: {
			const unknown: never = kind;
			return unknown;
		}
	}
}
