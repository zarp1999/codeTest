import LocalDataAccessor from './LocalDataAccessor.js';
import { STANDALONE, DEFAULT_REGION_ID } from '../config.js';

export function createDataAccessor(regionId = DEFAULT_REGION_ID) {
  if (STANDALONE) {
    return new LocalDataAccessor(regionId);
  }
  return new LocalDataAccessor(regionId);
}