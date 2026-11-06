import { clientAllowlist } from "./allowlist.js";

export function clientBoot() {
  const config = JSON.stringify(clientAllowlist());
  return `(()=>{if(window.__chessProxy)return;window.__chessProxy=1;const C=${config};
const OrigURL=globalThis.URL;
function fixHost(value){const text=String(value);const name=location.hostname;const parts=name.split(".");if(parts.length<2)return text;const bad="www."+parts.slice(1).join(".");if(bad.toLowerCase()===name)return text;const escaped=bad.replace(/[.*+?^\${}()|[\\]\\\\]/g,"\\\\$&");return text.replace(new RegExp("(^|[^A-Za-z0-9.-])"+escaped+"(?![A-Za-z0-9.-])","gi"),function(_match,prefix){return prefix+name;});}
function makeURL(url,base){const next=typeof url==="string"||url instanceof OrigURL?fixHost(url):url;return base===undefined?new OrigURL(next):new OrigURL(next,base);}
function PURL(url,base){return makeURL(url,base);}PURL.prototype=OrigURL.prototype;if(OrigURL.createObjectURL)PURL.createObjectURL=OrigURL.createObjectURL.bind(OrigURL);if(OrigURL.revokeObjectURL)PURL.revokeObjectURL=OrigURL.revokeObjectURL.bind(OrigURL);window.URL=PURL;
const allowed=(host)=>{host=String(host||"").toLowerCase().replace(/\\.$/,"");if(C.exact.indexOf(host)>=0)return true;return C.suffixes.some((s)=>host===s||host.endsWith("."+s));};
const fallback=(host)=>C.defaults.indexOf(String(host||"").toLowerCase())>=0;
const mapUrl=(input)=>{try{const u=makeURL(String(input),location.href);if(u.host===location.host)return u.href;if(!allowed(u.hostname))return null;const prefix=fallback(u.hostname)?"":C.prefix+"/"+u.hostname.toLowerCase();let proto=u.protocol;if(proto==="wss:"||proto==="ws:")proto=location.protocol==="https:"?"wss:":"ws:";else if(proto==="https:"||proto==="http:")proto=location.protocol;else return null;return proto+"//"+location.host+prefix+u.pathname+u.search+u.hash;}catch(e){return null;}};
const rewrite=(input)=>{const next=mapUrl(input);return next==null?input:next;};
const srcset=(value)=>String(value).split(",").map((part)=>{const bits=part.trim().split(/\\s+/);if(!bits[0])return part;const mapped=mapUrl(bits[0]);if(mapped)bits[0]=mapped;return bits.join(" ");}).join(", ");
const ofetch=window.fetch;window.fetch=function(input,init){try{if(typeof input==="string"||input instanceof URL)input=rewrite(input);else if(input&&typeof input.url==="string"){const mapped=mapUrl(input.url);if(mapped)input=new Request(mapped,input);}}catch(e){}return ofetch.call(this,input,init);};
const oopen=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url){const args=[...arguments];args[1]=rewrite(url);return oopen.apply(this,args);};
const OWS=window.WebSocket;function PWS(url,protocols){const next=rewrite(url);return protocols===undefined?new OWS(next):new OWS(next,protocols);}PWS.prototype=OWS.prototype;PWS.CONNECTING=OWS.CONNECTING;PWS.OPEN=OWS.OPEN;PWS.CLOSING=OWS.CLOSING;PWS.CLOSED=OWS.CLOSED;window.WebSocket=PWS;
if(window.EventSource){const OES=window.EventSource;function PES(url,opts){return opts===undefined?new OES(rewrite(url)):new OES(rewrite(url),opts);}PES.prototype=OES.prototype;window.EventSource=PES;}
if(navigator.sendBeacon){const beacon=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=(url,data)=>beacon(rewrite(url),data);}
const owopen=window.open;window.open=function(url){const args=[...arguments];if(typeof url==="string")args[0]=rewrite(url);return owopen.apply(this,args);};
["assign","replace"].forEach((name)=>{const orig=Location.prototype[name];if(!orig)return;Location.prototype[name]=function(url){return orig.call(this,rewrite(url));};});
["pushState","replaceState"].forEach((name)=>{const orig=history[name];if(!orig)return;history[name]=function(state,title,url){if(typeof url==="string")url=rewrite(url);return orig.call(this,state,title,url);};});
const oset=Element.prototype.setAttribute;const urlAttrs={src:1,href:1,action:1,poster:1,data:1,formaction:1,"data-src":1};
Element.prototype.setAttribute=function(name,value){const key=String(name).toLowerCase();if(typeof value==="string"&&(key==="srcset"||key==="data-srcset"))value=srcset(value);else if(typeof value==="string"&&urlAttrs[key]){const mapped=mapUrl(value);if(mapped)value=mapped;}return oset.call(this,name,value);};
function patch(proto,prop){const desc=Object.getOwnPropertyDescriptor(proto,prop);if(!desc||!desc.set||!desc.configurable)return;Object.defineProperty(proto,prop,{configurable:true,enumerable:desc.enumerable,get:desc.get,set:function(value){const mapped=typeof value==="string"?mapUrl(value):null;desc.set.call(this,mapped||value);}});}
function tryPatch(Ctor,prop){if(typeof Ctor==="function"&&Ctor.prototype)patch(Ctor.prototype,prop);}tryPatch(HTMLScriptElement,"src");tryPatch(HTMLImageElement,"src");tryPatch(HTMLIFrameElement,"src");tryPatch(HTMLSourceElement,"src");tryPatch(HTMLMediaElement,"src");tryPatch(HTMLLinkElement,"href");tryPatch(HTMLAnchorElement,"href");tryPatch(HTMLFormElement,"action");
if(window.Worker){const OW=window.Worker;window.Worker=function(url,opts){return new OW(rewrite(url),opts);};window.Worker.prototype=OW.prototype;}
try{const cookieDesc=Object.getOwnPropertyDescriptor(Document.prototype,"cookie");if(cookieDesc&&cookieDesc.set&&cookieDesc.configurable){Object.defineProperty(Document.prototype,"cookie",{configurable:true,enumerable:cookieDesc.enumerable,get:cookieDesc.get,set:function(value){cookieDesc.set.call(this,String(value).replace(/;\\s*domain=[^;]*/ig,""));}});} }catch(e){}
if(navigator.serviceWorker){navigator.serviceWorker.register=function(){return Promise.reject(new Error("disabled"));};if(navigator.serviceWorker.getRegistrations){navigator.serviceWorker.getRegistrations().then(function(list){list.forEach(function(reg){reg.unregister();});}).catch(function(){});}}
function rewriteNode(el){if(!el.getAttribute)return;["src","href","action","poster","data-src"].forEach(function(name){const value=el.getAttribute(name);if(!value)return;const mapped=mapUrl(value);if(mapped&&mapped!==value)oset.call(el,name,mapped);});["srcset","data-srcset"].forEach(function(name){const value=el.getAttribute(name);if(!value)return;const next=srcset(value);if(next!==value)oset.call(el,name,next);});}
const obs=new MutationObserver(function(records){records.forEach(function(record){record.addedNodes&&[...record.addedNodes].forEach(function(node){if(node.nodeType!==1)return;rewriteNode(node);node.querySelectorAll&&node.querySelectorAll("[src],[href],[action],[poster],[srcset],[data-src],[data-srcset]").forEach(rewriteNode);});});});
obs.observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener("click",function(event){const node=event.target&&event.target.closest?event.target.closest("a[href]"):null;if(!node)return;const mapped=mapUrl(node.href);if(mapped&&mapped!==node.href){event.preventDefault();location.assign(mapped);}},true);
})();`;
}
