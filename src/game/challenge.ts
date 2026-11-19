export type Challenge = 'distance' | 'duration';
export function challengeResult(mode:Challenge,flight:{distance:number;duration:number}) {
 const target=mode==='distance'?88:29.2;
 const value=mode==='distance'?flight.distance:flight.duration;
 return {target,value,beaten:value>=target,unit:mode==='distance'?'m':'s'};
}
