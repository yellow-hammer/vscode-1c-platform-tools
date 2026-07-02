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
 * Корневой каталог активной версии OneScript из установки OVM.
 *
 * @returns Абсолютный путь к каталогу current OVM
 */
export function getOvmRootDir(): string {
	return process.platform === 'win32'
		? path.join(process.env.LOCALAPPDATA || '', 'ovm', 'current')
		: path.join(os.homedir(), '.local', 'share', 'ovm', 'current');
}

/**
 * Каталог bin активной версии OneScript из установки OVM.
 *
 * @returns Абсолютный путь к каталогу bin OVM
 */
export function getOvmBinDir(): string {
	return path.join(getOvmRootDir(), 'bin');
}

/**
 * Полный путь к бинарю инструмента OneScript (oscript и т. п.) в установке OVM.
 * На Windows добавляется расширение `.exe`.
 *
 * @param name - Имя инструмента без расширения (например, 'oscript')
 * @returns Абсолютный путь к исполняемому файлу в каталоге bin OVM
 */
export function getOvmBinaryPath(name: string): string {
	const binary = process.platform === 'win32' ? `${name}.exe` : name;
	return path.join(getOvmBinDir(), binary);
}

/**
 * Возможные пути запускаемого файла opm в каталоге bin установки OneScript.
 *
 * В дистрибутиве OneScript opm — не exe, а обёртка над скриптом: на Windows
 * `opm.bat`, на остальных ОС — шелл-скрипт `opm`. На Windows проверяются
 * несколько расширений на случай различий между версиями дистрибутива.
 *
 * @param binDir - Каталог bin установки OneScript
 * @returns Пути-кандидаты к запускаемому файлу opm (в порядке приоритета)
 */
export function getOpmBinaryCandidates(binDir: string): string[] {
	if (process.platform === 'win32') {
		return [path.join(binDir, 'opm.bat'), path.join(binDir, 'opm.cmd'), path.join(binDir, 'opm.exe')];
	}
	return [path.join(binDir, 'opm')];
}

/**
 * Путь к скрипту opm внутри установки OneScript.
 *
 * Обёртка bin/opm(.bat) дистрибутива запускает `oscript <корень>/lib/opm/src/cmd/opm.os`.
 * Если обёртки в bin нет (наблюдается в установках OVM на Linux), opm можно
 * запустить напрямую через oscript по этому пути.
 *
 * @param installRoot - Корень установки OneScript (каталог с bin и lib)
 * @returns Абсолютный путь к opm.os
 */
export function getOpmScriptPath(installRoot: string): string {
	return path.join(installRoot, 'lib', 'opm', 'src', 'cmd', 'opm.os');
}
