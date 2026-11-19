/** Procedural sounds: no network access or external audio assets. */
export class Sound {
 private context:AudioContext|null=null;
 private master:GainNode|null=null;
 private windGain:GainNode|null=null;
 private buffer:AudioBuffer|null=null;
 enabled=true;

 activate():void {
  if(!this.enabled)return;
  try {
   if(!this.context){
    const context=new AudioContext(),master=context.createGain();
    master.gain.value=.14;master.connect(context.destination);
    const buffer=context.createBuffer(1,context.sampleRate*2,context.sampleRate);
    const data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
    const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();
    source.buffer=buffer;source.loop=true;filter.type='lowpass';filter.frequency.value=700;
    gain.gain.value=0;source.connect(filter).connect(gain).connect(master);source.start();
    this.context=context;this.master=master;this.windGain=gain;this.buffer=buffer;
   }
   if(this.context.state==='suspended')void this.context.resume().catch(()=>{});
  } catch { /* Audio is optional and must never prevent play. */ }
 }
 toggle():boolean {
  this.enabled=!this.enabled;
  if(this.master && this.context)this.master.gain.setTargetAtTime(this.enabled ? .14 : 0,this.context.currentTime,.03);
  if(this.enabled)this.activate();
  return this.enabled;
 }
 wind(speed:number):void {
  if(!this.context||!this.windGain)return;
  this.windGain.gain.setTargetAtTime(Math.min(.32,Math.max(0,speed)/28*.32),this.context.currentTime,.08);
 }
 fold():void { this.noise(.18,1600,.42); }
 land():void { this.noise(.12,350,.38); }
 private noise(duration:number,frequency:number,volume:number):void {
  const ctx=this.context,master=this.master,buffer=this.buffer;
  if(!this.enabled||!ctx||!master||!buffer)return;
  const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain(),now=ctx.currentTime;
  source.buffer=buffer;filter.type='bandpass';filter.frequency.value=frequency;
  gain.gain.setValueAtTime(.001,now);gain.gain.exponentialRampToValueAtTime(volume,now+.015);
  gain.gain.exponentialRampToValueAtTime(.001,now+duration);
  source.connect(filter).connect(gain).connect(master);source.start(now);source.stop(now+duration+.01);
 }
}
