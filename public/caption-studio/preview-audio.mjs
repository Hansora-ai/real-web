// Route every preview source through a real gain node (including mobile browsers).
export class PreviewAudio {
  constructor(Context = globalThis.AudioContext || globalThis.webkitAudioContext) {
    this.Context=Context;this.context=null;this.nodes=new Map();this.master=null;this.analyser=null;
  }
  async unlock() {
    if(!this.context && this.Context) {
      this.context=new this.Context();this.master=this.context.createGain();this.analyser=this.context.createAnalyser();
      this.analyser.fftSize=256;this.master.connect(this.analyser);this.analyser.connect(this.context.destination);
    }
    if(this.context?.state==='suspended') await this.context.resume();
  }
  set(element,volume) {
    if(!this.context) {element.volume=Math.max(0,Math.min(1,volume));return;}
    let node=this.nodes.get(element);
    if(!node) {
      const source=this.context.createMediaElementSource(element),gain=this.context.createGain();
      source.connect(gain);gain.connect(this.master);node={source,gain};this.nodes.set(element,node);
    }
    element.volume=1;element.muted=false;
    node.gain.gain.setValueAtTime(Math.max(0,Math.min(1,volume)),this.context.currentTime);
  }
  mute(muted) {if(this.master) this.master.gain.setValueAtTime(muted?0:1,this.context.currentTime);}
  remove(element) {const node=this.nodes.get(element);node?.source.disconnect();node?.gain.disconnect();this.nodes.delete(element);}
  level() {
    if(!this.analyser) return 0;
    const data=new Float32Array(this.analyser.fftSize);this.analyser.getFloatTimeDomainData(data);
    return Math.sqrt(data.reduce((sum,x)=>sum+x*x,0)/data.length);
  }
}
