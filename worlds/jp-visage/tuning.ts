export interface VisagesTuning {
  roomBrightness: number;
  bloodBrightness: number;
  bloodColor: string;
}

/** Approved screenshot values, applied in production as well as development. */
export const DEFAULT_TUNING: Readonly<VisagesTuning> = {
  roomBrightness: 0.5,
  bloodBrightness: 0.55,
  bloodColor: '#86090b',
};
