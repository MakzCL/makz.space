import {afterEach,test} from "node:test";
import assert from "node:assert/strict";
import {JSDOM} from "jsdom";
import React,{useState} from "react";
const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost",pretendToBeVisual:true});
for(const key of ["window","document","navigator","HTMLElement","Event","MutationObserver"]as const)Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,ResizeObserver:class {observe(){} disconnect(){}}});
const {render,screen,cleanup,fireEvent}=await import("@testing-library/react");
const {Select}=await import("../src/components/Select.tsx");
afterEach(cleanup);
function Control(){const[value,set]=useState("720");return <label><span className="field-l">Resolution</span><Select value={value} onChange={e=>set(e.target.value)}><option value="720">720p</option><option value="1080" disabled>1080p</option><option value="1440">1440p</option><option value="2160">2160p</option></Select><output>{value}</output></label>}
test("custom dropdown preserves controlled changes, skips disabled options and closes on Escape",()=>{
 render(<Control/>);const box=screen.getByRole("combobox",{name:"Resolution"});fireEvent.keyDown(box,{key:"ArrowDown"});assert.equal(box.getAttribute("aria-expanded"),"true");fireEvent.keyDown(box,{key:"ArrowDown"});fireEvent.keyDown(box,{key:"Enter"});assert.equal(screen.getByRole("status").textContent,"1440");assert.equal(box.getAttribute("aria-expanded"),"false");
 let parentEscapes=0;box.parentElement!.addEventListener("keydown",e=>{if(e.key==="Escape")parentEscapes++;});
 fireEvent.click(box);fireEvent.keyDown(box,{key:"Home"});fireEvent.keyDown(box,{key:"Escape"});assert.equal(parentEscapes,0,"Escape closes the menu without closing its settings dialog");assert.equal(screen.getByRole("status").textContent,"1440");assert.equal(screen.queryByRole("listbox"),null);
 fireEvent.click(box);fireEvent.click(screen.getByRole("option",{name:"2160p"}));assert.equal(screen.getByRole("status").textContent,"2160");assert.equal(document.activeElement,box);
});
test("dropdown dismisses outside, supports typeahead and respects a disabled control",()=>{
 render(<Control/>);const box=screen.getByRole("combobox",{name:"Resolution"});fireEvent.keyDown(box,{key:"2"});fireEvent.keyDown(box,{key:"Enter"});assert.equal(screen.getByRole("status").textContent,"2160");fireEvent.click(box);fireEvent.pointerDown(document.body);assert.equal(screen.queryByRole("listbox"),null);cleanup();render(<Select aria-label="Microphone" disabled><option>Default</option></Select>);assert.equal((screen.getByRole("combobox")as HTMLButtonElement).disabled,true);
});
