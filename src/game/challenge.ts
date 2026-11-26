export type Challenge = 'distance' | 'duration';

export const WORLD_RECORDS = {
  distanceCurrent: {value: 98.43, date: '2025-12-28', holder: '刘立文及团队'},
  distanceMach5Milestone: {value: 88.31, date: '2022-12', holder: 'Boeing Mach 5 团队'},
  distanceSuzanneMilestone: {value: 69.14, date: '2012-02', holder: 'John Collins / Joe Ayoob'},
  durationCurrent: {value: 31.2, date: '2026-02', holder: 'Rao Chongyi 等团队'},
  durationZeroFighter: {value: 29.2, date: '2010-12', holder: '户田拓夫（Zero Fighter）'},
  durationSkyKing: {value: 27.9, date: '2009-04', holder: '户田拓夫（Sky King）'},
} as const;

export function challengeResult(mode: Challenge, flight: {distance: number; duration: number}) {
  const target = mode === 'distance' ? 88 : 29.2;
  const worldRecord = mode === 'distance' ? WORLD_RECORDS.distanceCurrent.value : WORLD_RECORDS.durationCurrent.value;
  const value = mode === 'distance' ? flight.distance : flight.duration;
  return {
    target,
    worldRecord,
    value,
    beaten: value >= target,
    worldRecordBeaten: value >= worldRecord,
    unit: mode === 'distance' ? 'm' : 's',
  };
}
