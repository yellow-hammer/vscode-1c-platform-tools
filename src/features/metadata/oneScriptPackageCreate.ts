/**
 * Новый класс или модуль пакета: файл и строка в `packagedef`.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PROJECT_FILE } from '../../shared/projectLayout';
import { appendPackageMember, packageMembers, parsePackagedef } from '../../shared/packagedef';

const NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

const PLACE: Readonly<Record<'class' | 'module', { dir: string; title: string; method: string }>> = {
	class: { dir: path.join('src', 'Классы'), title: 'Класс', method: 'класса' },
	module: { dir: path.join('src', 'Модули'), title: 'Модуль', method: 'модуля' },
};

const CLASS_FILE = 'Процедура ПриСозданииОбъекта()\n\nКонецПроцедуры\n';

/**
 * Спрашивает имя, создаёт файл и дописывает объявление в `packagedef`.
 *
 * @param root - Корень проекта
 * @param kind - Класс или модуль
 * @returns Абсолютный путь нового файла или undefined, если пользователь отказался
 */
export async function createOneScriptPackageMember(root: string, kind: 'class' | 'module'): Promise<string | undefined> {
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
	const packagedefPath = path.join(root, PROJECT_FILE);
	let source: string;
	try {
		source = await fs.readFile(packagedefPath, 'utf8');
	} catch {
		void vscode.window.showErrorMessage('Нет файла packagedef.');
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
		await fs.writeFile(
			absolute,
			kind === 'class' ? CLASS_FILE : '\n',
			{ encoding: 'utf8', flag: 'wx' }
		);
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

const CONVENTION: readonly { dir: string; kind: 'class' | 'module' }[] = [
	{ dir: path.join('src', 'Классы'), kind: 'class' },
	{ dir: path.join('src', 'Модули'), kind: 'module' },
];

/**
 * Дописывает в `packagedef` классы из `src/Классы` и модули из `src/Модули`,
 * которых там ещё нет. Вызывается при добавлении: в манифест попадают и новый файл, и уже лежавшие.
 *
 * @param root - Корень проекта
 * @returns Сколько объявлений добавлено
 */
async function recordConventionPackageMembers(root: string): Promise<number> {
	const packagedefPath = path.join(root, PROJECT_FILE);
	let source: string;
	try {
		source = await fs.readFile(packagedefPath, 'utf8');
	} catch {
		void vscode.window.showErrorMessage('Нет файла packagedef.');
		return 0;
	}
	const members = packageMembers(parsePackagedef(source));
	const known = new Set(members.map((member) => `${member.kind}:${member.file}`));
	const knownNames = new Set(members.map((member) => `${member.kind}:${member.name}`));
	let count = 0;
	for (const place of CONVENTION) {
		let names: string[] = [];
		try {
			const entries = await fs.readdir(path.join(root, place.dir), { withFileTypes: true });
			names = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.os')).map((entry) => entry.name);
		} catch {
			names = [];
		}
		for (const fileName of names) {
			const name = fileName.slice(0, -'.os'.length);
			if (!NAME.test(name)) {
				continue;
			}
			const relative = `${place.dir.replaceAll('\\', '/')}/${fileName}`;
			const key = `${place.kind}:${relative}`;
			if (known.has(key) || knownNames.has(`${place.kind}:${name}`)) {
				continue;
			}
			source = appendPackageMember(source, place.kind, name, relative);
			known.add(key);
			knownNames.add(`${place.kind}:${name}`);
			count += 1;
		}
	}
	if (count > 0) {
		await fs.writeFile(packagedefPath, source, 'utf8');
	}
	return count;
}
