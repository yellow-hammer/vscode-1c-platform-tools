/**
 * Одна мутация выгрузки CF через md-sparrow за раз — иначе параллельные CLI дают гонки по Configuration.xml и файлам объектов.
 * @module mdSparrowMutationQueue
 */

/**
 * @returns функция, которая ставит переданный async-обработчик в общую очередь (FIFO).
 */
export function createMdSparrowMutationRunner(): <T>(fn: () => Promise<T>) => Promise<T> {
	let chain: Promise<unknown> = Promise.resolve();
	return async function run<T>(fn: () => Promise<T>): Promise<T> {
		const next = chain.then(() => fn());
		chain = next.then(
			() => undefined,
			() => undefined
		);
		return next as Promise<T>;
	};
}
