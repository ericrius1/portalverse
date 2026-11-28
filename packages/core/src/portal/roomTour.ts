import type { RegistryFile } from '../types';

export const VISAGES_TOUR = [
  'jp-visages',
  'jp-visages-claude',
  'jp-visages-codex',
  'jp-visage',
] as const;

/** A tour changes this browser's route, never the persistent world catalog. */
export function catalogForTour(catalog: RegistryFile, search: string): RegistryFile {
  if (new URLSearchParams(search).get('tour') !== 'visages') {
    return { ...catalog, worlds: catalog.worlds.filter(room => room.inRotation !== false && !room.comparisonOnly) };
  }
  const worlds = VISAGES_TOUR.map(id => catalog.worlds.find(room => room.id === id && room.kind === 'local'));
  if (worlds.some(room => !room)) throw new Error('The Visages tour needs all Visages rooms installed.');
  return { ...catalog, defaultWorldId: VISAGES_TOUR[0], worlds: worlds.map(room => room!) };
}

/** Keep the tour when sharing, reloading or returning from a remote room. */
export function tourShareBase(href: string): string {
  const url = new URL(href);
  const tour = url.searchParams.get('tour');
  const eyes = url.searchParams.get('eyes');
  url.search = '';
  url.hash = '';
  if (tour === 'visages') url.searchParams.set('tour', tour);
  if (eyes === 'compare') url.searchParams.set('eyes', eyes);
  return url.toString();
}
