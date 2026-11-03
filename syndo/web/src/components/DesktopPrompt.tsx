import { useState } from "react";
import { Download, X } from "lucide-react";
import { desktop } from "../desktop.ts";
import { previewMode } from "../preview-mode.ts";
import { Modal, Wordmark } from "./ui.tsx";
export function DesktopPrompt() {
  const [show,setShow]=useState(()=>{
    if(desktop||previewMode||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||!matchMedia("(pointer: fine)").matches)return false;
    try{return !localStorage.getItem("send.desktop-prompt.dismissed.v1")}catch{return false}
  });
  const dismiss=()=>{try{localStorage.setItem("send.desktop-prompt.dismissed.v1","1")}catch{}setShow(false)};
  if(!show)return null;
  return <Modal label="Download SEND for Windows" onClose={dismiss}><div className="desktop-download-prompt"><Wordmark/><span className="eyebrow">SEND FOR WINDOWS</span><h2>Your conversations.<br/>A place on your desktop.</h2><p>Keep SEND in your taskbar, use global push-to-talk, and get interface updates automatically.</p><a className="btn primary" href="/api/downloads/windows" onClick={dismiss}><Download size={17}/> Download for Windows</a><button className="link muted" onClick={dismiss}>Not now — continue in the browser</button></div></Modal>;
}
