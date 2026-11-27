import catalog from '../../../../registry.json';
import type { RegistryFile } from '../types';
import { catalogForTour } from './roomTour';

// One route for the directory, mounted gates and preview window. Capture it at
// startup so URL updates during crossings cannot change the route mid-session.
export const sessionCatalog = catalogForTour(
  catalog as unknown as RegistryFile,
  typeof window === 'undefined' ? '' : window.location.search,
);
