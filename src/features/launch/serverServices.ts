/**
 * Извлечение публикуемых сервисов (HTTP- и Web-) из дерева метаданных md-sparrow.
 *
 * Для автономного сервера достаточно имён сервисов: корневой URL (HTTP) и синоним
 * (Web) ibsrv берёт из метаданных самостоятельно.
 */

import type { ProjectMetadataTreeDto, MetadataItemDto } from '../../features/metadata/metadataTreeService';

/** objectType HTTP-сервиса в дереве метаданных. */
const HTTP_SERVICE_TYPE = 'HTTPService';
/** objectType Web-сервиса в дереве метаданных. */
const WEB_SERVICE_TYPE = 'WebService';

/** Списки имён публикуемых сервисов по категориям. */
export interface PublishableServices {
	/** Имена Web-сервисов (SOAP). */
	web: string[];
	/** Имена HTTP-сервисов. */
	http: string[];
}

/**
 * Собирает имена HTTP- и Web-сервисов из дерева метаданных.
 *
 * Обходит все источники, группы, подгруппы и их элементы; имена сортируются и
 * дедуплицируются (на случай нескольких источников — основная конфигурация и
 * расширения).
 *
 * @param tree - Дерево метаданных проекта (md-sparrow)
 * @returns Имена сервисов по категориям
 */
export function extractPublishableServices(tree: ProjectMetadataTreeDto): PublishableServices {
	const web = new Set<string>();
	const http = new Set<string>();

	const visitItems = (items: readonly MetadataItemDto[] | undefined): void => {
		if (!items) {
			return;
		}
		for (const item of items) {
			if (item.objectType === WEB_SERVICE_TYPE) {
				web.add(item.name);
			} else if (item.objectType === HTTP_SERVICE_TYPE) {
				http.add(item.name);
			}
		}
	};

	for (const source of tree.sources ?? []) {
		for (const group of source.groups ?? []) {
			visitItems(group.items);
			for (const subgroup of group.subgroups ?? []) {
				visitItems(subgroup.items);
			}
		}
	}

	const sorted = (set: Set<string>): string[] => [...set].sort((a, b) => a.localeCompare(b, 'ru'));
	return { web: sorted(web), http: sorted(http) };
}
