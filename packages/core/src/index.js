// Public surface of @anomaly-guard/core. Import from here, not from internal paths.

export {
  shannonEntropy,
  entropySummary,
  entropySeparation,
  charClassCounts,
  charHistogram,
  classifyChar,
  CHAR_CLASSES,
  SPECIAL_CHARS,
} from './stats/entropy.js';

export { extractFeatures, paramFeatures } from './features/extract.js';

export { RuleEngine, DEFAULT_RULES } from './rules/engine.js';

export { trainStatModel, paramKey, pToScore } from './stats/model.js';
export {
  lengthZScore,
  lengthScore,
  unseenPairScore,
  LENGTH_METHODS,
  DEFAULT_LENGTH_METHOD,
  MIN_STD,
} from './stats/length.js';
export {
  iqrScore,
  madScore,
  mahalanobisScore,
  iqrDeviation,
  madDeviation,
  fenceDistance,
  deviationScore,
  mahalanobisD2,
  mahalanobisTailScore,
  MAD_CONSISTENCY,
  IQR_NORMAL,
  FENCE,
} from './stats/outliers.js';
export {
  OUTLIER_FEATURES,
  FEATURE_FLOORS,
  MIN_OUTLIER_N,
  RIDGE,
  outlierVector,
  median,
  quantile,
  mad,
  covariance,
  invertSymmetric,
  regularise,
  fitOutlierStats,
} from './stats/robust.js';
export { chiSquareScore, chiSquareLogSurvival, chiSquareHomogeneity } from './stats/chisquare.js';
export {
  scoreRequest,
  scoreParts,
  calibrateModel,
  tailScore,
  SIGNAL_PARTS,
  COMBINE_MODES,
} from './stats/anomaly.js';

export { detect } from './detector/detect.js';
