/**
 * Слой CLI-адаптеров vanessa-runner: выбор адаптера по версии.
 *
 * См. {@link VRunnerIntent} — семантические намерения команд расширения,
 * {@link V2CliAdapter}/{@link V3CliAdapter} — рендер в синтаксис конкретной
 * мажорной версии.
 */

import { VRunnerVersion, isAtLeast, VRUNNER_FEATURES } from '../vrunnerVersion';
import { VRunnerCliAdapter } from './intents';
import { V2CliAdapter } from './v2Adapter';
import { V3CliAdapter } from './v3Adapter';

export * from './intents';
export { V2CliAdapter } from './v2Adapter';
export { V3CliAdapter } from './v3Adapter';

const v2Adapter = new V2CliAdapter();
const v3Adapter = new V3CliAdapter();

/**
 * Возвращает адаптер CLI для установленной версии vrunner.
 *
 * Если версию определить не удалось — консервативно используется
 * синтаксис 2.x (текущая стабильная ветка vanessa-runner).
 *
 * @param version - Версия vrunner или undefined
 * @returns Адаптер соответствующей мажорной версии
 */
export function selectCliAdapter(version: VRunnerVersion | undefined): VRunnerCliAdapter {
	return version && isAtLeast(version, VRUNNER_FEATURES.cli3) ? v3Adapter : v2Adapter;
}
