import { inAndroidApp } from "../mobile.ts";
import { useState } from "react";
import { Download, X, Share, SquarePlus } from "lucide-react";
import { desktop } from "../desktop.ts";
import { previewMode } from "../preview-mode.ts";
import { Modal, Wordmark } from "./ui.tsx";
/** On Android browsers (not inside the app), offer the Android app once. */
function AndroidPrompt() {
  const [show,setShow]=useState(()=>{ if(inAndroidApp||previewMode||!/Android/i.test(navigator.userAgent))return false; try{return !localStorage.getItem("send.android-prompt.dismissed.v1")}catch{return false} });
  const dismiss=()=>{try{localStorage.setItem("send.android-prompt.dismissed.v1","1")}catch{}setShow(false)};
  if(!show)return null;
  return <Modal label="Get SEND for Android" onClose={dismiss}><div className="desktop-download-prompt"><Wordmark/><span className="eyebrow">SEND FOR ANDROID</span><h2>Your conversations,<br/>in your pocket.</h2><p>Full-screen app with swipe navigation, the back button and long-press menus. It updates itself whenever SEND does.</p><a className="btn primary" href="/api/downloads/android" onClick={dismiss}><Download size={17}/> Download the app (APK)</a><p className="muted small">Android may ask you to allow installs from your browser the first time.</p><button className="link muted" onClick={dismiss}>Not now — continue in the browser</button></div></Modal>;
}
const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => (window.navigator as any).standalone === true || matchMedia("(display-mode: standalone)").matches;
/** iPhone/iPad Safari (not yet on the home screen): how to install SEND — no App Store needed. */
function IosPrompt() {
  const [show,setShow]=useState(()=>{ if(previewMode||standalone())return false; try{return !localStorage.getItem("send.ios-prompt.dismissed.v1")}catch{return false} });
  const dismiss=()=>{try{localStorage.setItem("send.ios-prompt.dismissed.v1","1")}catch{}setShow(false)};
  if(!show)return null;
  return <Modal label="Install SEND on your iPhone" onClose={dismiss}><div className="desktop-download-prompt ios-install"><Wordmark/><span className="eyebrow">SEND FOR IPHONE</span><h2>Put SEND on<br/>your home screen.</h2><p>It opens full-screen like an app, with no App Store needed, and updates itself whenever SEND does.</p>
    <ol className="ios-steps"><li><span className="ios-step-ico" aria-hidden><Share size={18}/></span><span>Tap <b>Share</b> in Safari's toolbar</span></li><li><span className="ios-step-ico" aria-hidden><SquarePlus size={18}/></span><span>Choose <b>Add to Home Screen</b></span></li><li><span className="ios-step-ico" aria-hidden>✓</span><span>Tap <b>Add</b>, then open SEND from your home screen</span></li></ol>
    <p className="muted small">Using Chrome on iPhone? Use its Share menu the same way (iOS 16.4 or later), or open this page in Safari.</p>
    <button className="btn primary" onClick={dismiss}>Got it</button></div></Modal>;
}
export function DesktopPrompt() {
  if(/Android/i.test(navigator.userAgent))return <AndroidPrompt/>;
  if(isIos())return <IosPrompt/>;
  const [show,setShow]=useState(()=>{
    if(desktop||previewMode||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||!matchMedia("(pointer: fine)").matches)return false;
    try{return !localStorage.getItem("send.desktop-prompt.dismissed.v1")}catch{return false}
  });
  const dismiss=()=>{try{localStorage.setItem("send.desktop-prompt.dismissed.v1","1")}catch{}setShow(false)};
  if(!show)return null;
  return <Modal label="Download SEND for Windows" onClose={dismiss}><div className="desktop-download-prompt"><Wordmark/><span className="eyebrow">SEND FOR WINDOWS</span><h2>Your conversations.<br/>A place on your desktop.</h2><p>Keep SEND in your taskbar, use global push-to-talk, and get interface updates automatically.</p><a className="btn primary" href="/api/downloads/windows" onClick={dismiss}><Download size={17}/> Download for Windows</a><button className="link muted" onClick={dismiss}>Not now — continue in the browser</button></div></Modal>;
}
