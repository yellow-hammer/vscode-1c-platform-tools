/**
 * Модуль «Проекты 1С»: избранное, автообнаружение, быстрый выбор.
 */

export { ProjectStorage } from './storage';
export { ProjectsStack } from './stack';
export { StorageProvider } from './storageProvider';
export { AutodetectProvider } from './autodetectProvider';
export { ProjectsProviders } from './providers';
export { pickProjects, openPickedProject, pickFavoritesToConfigure, canSwitchOnActiveWindow, shouldOpenInNewWindow } from './projectsPicker';
export { pickTags } from './tagsPicker';
export { showStatusBar, updateStatusBar } from './statusBar';
export { getProjectsFilePath, expandHomePath, normalizePath } from './pathUtils';
export { InvocationSource } from './constants';
export type { Project } from './project';
export type { PickedProject, PickedResult } from './projectsPicker';
