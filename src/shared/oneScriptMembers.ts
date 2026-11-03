/**
 * Уже лежащие файлы пакета OneScript и строки в `packagedef`.
 *
 * Дерево метаданных показывает объявления, а не каталог. После перезаписи
 * `packagedef` файлы остаются, и их нужно снова вписать в манифест.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PROJECT_FILE } from './projectLayout';
import { appendPackageMember, packageMembers, parsePackagedef } from './packagedef';

const NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/** Единственная программа, которую добавляет дерево метаданных. */
export const ONESCRIPT_PROGRAM_PATH = 'src/main.os';

/** Путь к библиотекам из каталога `src`. */
const LIBRARY_CONFIG = 'lib.additional=../oscript_modules\n';

const CONVENTION: readonly { dir: string; kind: 'class' | 'module' }[] = [
	{ dir: path.join('src', 'Классы'), kind: 'class' },
	{ dir: path.join('src', 'Модули'), kind: 'module' },
];

/**
 * Вписывает в `packagedef` классы, модули и `src/main.os`, если файлы уже есть.
 *
 * Существующий `src/main.os` не перезаписывается. `src/oscript.cfg` создаётся, только если его нет.
 *
 * @param root - Корень проекта
 */
export async function adoptExistingOneScriptMembers(root: string): Promise<void> {
	const packagedefPath = path.join(root, PROJECT_FILE);
	let source: string;
	try {
		source = await fs.readFile(packagedefPath, 'utf8');
	} catch {
		return;
	}
	const programAbsolute = path.join(root, ...ONESCRIPT_PROGRAM_PATH.split('/'));
	let programOnDisk = false;
	try {
		await fs.access(programAbsolute);
		programOnDisk = true;
	} catch {
		programOnDisk = false;
	}
	const declared = packageMembers(parsePackagedef(source)).some(
		(member) => member.kind === 'executable' && member.file === ONESCRIPT_PROGRAM_PATH
	);
	if (programOnDisk && !declared) {
		await fs.writeFile(packagedefPath, appendPackageMember(source, 'executable', '', ONESCRIPT_PROGRAM_PATH), 'utf8');
		try {
			await fs.writeFile(path.join(path.dirname(programAbsolute), 'oscript.cfg'), LIBRARY_CONFIG, {
				encoding: 'utf8',
				flag: 'wx',
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
				throw error;
			}
		}
	}
	await recordConventionPackageMembers(root);
}

/**
 * Дописывает классы из `src/Классы` и модули из `src/Модули`, которых ещё нет в `packagedef`.
 *
 * @param root - Корень проекта
 * @returns Сколько объявлений добавлено
 */
export async function recordConventionPackageMembers(root: string): Promise<number> {
	const packagedefPath = path.join(root, PROJECT_FILE);
	let source: string;
	try {
		source = await fs.readFile(packagedefPath, 'utf8');
	} catch {
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
