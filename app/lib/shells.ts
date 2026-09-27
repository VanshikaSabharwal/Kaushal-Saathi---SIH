/**
 * Which shell a path gets, and the language that shell's pages are written in.
 * Shared by AppShell and the pre-paint script in the root layout, so both
 * agree on which pages translate.
 */

/** Developer tools keep the original configuration shell (not translated). */
export const DEV_PREFIXES = ["/settings", "/evaluate", "/conversations"];
export const STAFF_PREFIXES = ["/admin", "/saathi", "/centre", "/login"];

/** Staff screens are written in English, beneficiary screens in Hindi; developer tools are not translated. */
export function sourceForPath(path: string): "hi" | "en" | null {
  if (STAFF_PREFIXES.some((p) => path.startsWith(p))) return "en";
  if (DEV_PREFIXES.some((p) => path.startsWith(p))) return null;
  return "hi";
}

/** window.name of the hidden frame that renders linked pages to translate them ahead of time; it does not translate itself. */
export const PREFETCH_FRAME = "ks-prefetch";

/**
 * Runs while the HTML is parsed, before the first paint: if this device reads
 * the site in another language, the page body starts as a skeleton instead of
 * flashing the source language. The translator lifts it (see dom-translate.ts);
 * the timeout is a backstop in case the app never starts.
 */
export const TRANSLATE_BOOT_SCRIPT = `(function(){try{
if(window.name===${JSON.stringify(PREFETCH_FRAME)})return;
var p=location.pathname,s=${JSON.stringify(STAFF_PREFIXES)},d=${JSON.stringify(DEV_PREFIXES)};
function has(l){for(var i=0;i<l.length;i++)if(p.indexOf(l[i])===0)return true;return false}
var src=has(s)?"en":has(d)?null:"hi";
var c=localStorage.getItem("ks_lang");
if(src&&c&&c!==src&&(src!=="en"||c==="hi")){var h=document.documentElement;h.setAttribute("data-ks-boot","");setTimeout(function(){h.removeAttribute("data-ks-boot")},8000)}
}catch(e){}})()`;
