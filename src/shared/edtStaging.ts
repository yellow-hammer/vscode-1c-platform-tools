/**
 * Временный каталог проекта 1C:EDT, открытого как рабочая область.
 *
 * @module edtStaging
 */

import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Своё место во временном каталоге для проекта EDT, открытого как рабочая область:
 * каталог сборки лежит внутри проекта, а рабочую область и выгрузки внутри проекта
 * EDT не принимает.
 *
 * @param workspaceRoot - Корень рабочей области VS Code
 */
export function edtTemporaryDir(workspaceRoot: string): string {
	const key = createHash('sha1').update(path.resolve(workspaceRoot)).digest('hex').slice(0, 8);
	return path.join(os.tmpdir(), '1c-platform-tools', `${path.basename(workspaceRoot)}-${key}`);
}
