import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Пути к инструментам OneScript, установленным через OVM (OneScript Version Manager).
 *
 * OVM ставит активную версию в каталог `current/bin`, где `current` — симлинк на
 * выбранную версию (меняется командой `ovm use`). Расположение детерминировано и
 * не зависит от PATH, поэтому используется как запасной источник, когда бинарь не
 * найден в PATH (типично для VS Code, запущенного из GUI, который не наследует
 * PATH интерактивной оболочки).
 */

/**
 * Каталог bin активной версии OneScript из установки OVM.
 *
 * @returns Абсолютный путь к каталогу bin OVM
 */
export function getOvmBinDir(): string {
	return process.platform === 'win32'
		? path.join(process.env.LOCALAPPDATA || '', 'ovm', 'current', 'bin')
		: path.join(os.homedir(), '.local', 'share', 'ovm', 'current', 'bin');
}

/**
 * Полный путь к бинарю инструмента OneScript (oscript, opm и т. п.) в установке OVM.
 * На Windows добавляется расширение `.exe`.
 *
 * @param name - Имя инструмента без расширения (например, 'oscript')
 * @returns Абсолютный путь к исполняемому файлу в каталоге bin OVM
 */
export function getOvmBinaryPath(name: string): string {
	const binary = process.platform === 'win32' ? `${name}.exe` : name;
	return path.join(getOvmBinDir(), binary);
}
