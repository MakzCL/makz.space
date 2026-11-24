import { Cpu, Fan, Gamepad2, Headphones, Keyboard, Lamp, MemoryStick, Mic, Monitor, Mouse, RectangleHorizontal, Speaker, Box, CircuitBoard, Snowflake, Grid3x3, Headset, type LucideIcon } from "lucide-react";
import type { DeviceKind } from "../lib/types";

export const kindIcon: Record<DeviceKind, LucideIcon> = {
  keyboard: Keyboard,
  mouse: Mouse,
  mousepad: RectangleHorizontal,
  headset: Headphones,
  "headset-stand": Headset,
  keypad: Grid3x3,
  controller: Gamepad2,
  speaker: Speaker,
  microphone: Mic,
  fan: Fan,
  "led-strip": Lamp,
  motherboard: CircuitBoard,
  gpu: Monitor,
  ram: MemoryStick,
  cooler: Snowflake,
  case: Box,
  light: Lamp,
  other: Cpu,
};

export const kindName: Record<DeviceKind, string> = {
  keyboard: "Keyboard", mouse: "Mouse", mousepad: "Mouse mat", headset: "Headset", "headset-stand": "Headset stand",
  keypad: "Keypad", controller: "Controller", speaker: "Speaker", microphone: "Microphone", fan: "Fan", "led-strip": "LED strip",
  motherboard: "Motherboard", gpu: "Graphics card", ram: "Memory", cooler: "Cooler", case: "Case", light: "Light", other: "Device",
};
