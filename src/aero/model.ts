import type {Aero} from './extract';
/**
 * Low-angle finite-wing lift with a smooth separated-flow flat-plate regime.
 * The broadside drag (1.9), transition (14°, 6°), and separated-flow lift
 * coefficient (0.95) come from JFM 2022, §5; finite-span lift is scaled by
 * the ratio of this wing's lift slope to the paper's measured 2-D slope 5.2.
 * This is a common-model approximation, not a fit to any individual plane.
 * https://doi.org/10.1017/jfm.2022.89
 */
export function coefficients(alpha:number,a:Aero,speed=15,dragModel:'empirical'|'skin-friction'='empirical'):{cl:number;cd:number} {
 const wrapped=Math.atan2(Math.sin(alpha),Math.cos(alpha));
 const absolute=Math.abs(wrapped), back=absolute>Math.PI/2;
 const incidence=back?Math.PI-absolute:absolute;
 const transition=(1-Math.tanh((incidence-14*Math.PI/180)/(6*Math.PI/180)))/2;
 const slope=2*Math.PI*a.aspectRatio/(a.aspectRatio+2);
 const separatedSlope=2*.95*(slope/5.2);
 const transitionAtZero=(1-Math.tanh((-14*Math.PI/180)/(6*Math.PI/180)))/2;
 const attachedSlope=(slope-(1-transitionAtZero)*separatedSlope)/transitionAtZero;
 const attached=attachedSlope*Math.sin(incidence);
 const separated=.95*(slope/5.2)*Math.sin(2*incidence);
 const magnitude=transition*attached+(1-transition)*separated;
 const cl=Math.sign(wrapped)*(back?-1:1)*magnitude;
 // The skin-friction option is a lower bound: it omits form and interference
 // drag. Keep it separate from the current empirical total for comparison.
 const cd0=dragModel==='skin-friction'?skinFrictionCoefficient(a,speed):.025+.01*(a.span*a.chord/a.wingArea);
 const induced=cl*cl/(Math.PI*a.aspectRatio*.8);
 const form=(1-transition)*1.9*Math.sin(incidence)**2;
 return {cl,cd:cd0+induced+form};
}
/** Experimental lower-bound skin friction; excludes shape and interference drag.
 * Uses separate wing and body equivalent chords; junction effects and
 * differences in the flow around the folded body are not resolved.
 * NASA: https://ntrs.nasa.gov/api/citations/20100031107/downloads/20100031107.pdf */
export function skinFrictionCoefficient(a:Aero,speed:number):number {
 const cf=(length:number)=>1.328/Math.sqrt(Math.max(1,Math.abs(speed)*length/1.5e-5));
 const bodyWetted=2*a.bodySideArea,wingWetted=Math.max(0,a.wettedArea-bodyWetted);
 const bodyDrag=bodyWetted && a.bodyFrictionChord>0 ? bodyWetted*cf(a.bodyFrictionChord):0;
 return (wingWetted*cf(a.frictionChord)+bodyDrag)/a.wingArea;
}
/** Simplified distributed-lift moment about the mass centre; y increases aft. */
export function pitchAcceleration(alpha:number,omega:number,speed:number,a:Aero,dragModel:'empirical'|'skin-friction'='empirical',heightMoment=false):number {
 if(speed<=1e-6)return 0;
 const {cl,cd}=coefficients(alpha,a,speed,dragModel), slope=2*Math.PI*a.aspectRatio/(a.aspectRatio+2);
 // In the attached-flow limit use the quarter-chord focus; as flow becomes
 // broadside, move the effective pressure centre toward the wing-area centre.
 // This interpolation is an approximation, not a measured pressure curve.
 const pressureY=a.wingCentroid.y+(a.aerodynamicCenter.y-a.wingCentroid.y)*Math.cos(alpha);
 const lever=pressureY-a.cg.y;
 const dynamicPressure=.5*1.225*speed*speed*a.wingArea;
 // Local rotational velocity changes incidence across the wing. Integrating
 // the squared distance to the mass centre gives the damping arm directly.
 const dampingArm=a.wingPitchSecondMoment;
 const normal=cl*Math.cos(alpha)+cd*Math.sin(alpha);
 // Research option only: treats the entire resultant as acting in the wing
 // plane. The force distribution is unknown and this fails convergence for
 // some launches, so gameplay leaves it disabled.
 const axial=cd*Math.cos(alpha)-cl*Math.sin(alpha);
 const moment=dynamicPressure*(-normal*lever-slope*omega*dampingArm/speed+(heightMoment?axial*a.cgDepth:0));
 return moment/a.pitchInertia;
}
