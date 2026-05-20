export interface MachineStatus {
  state: string;
  wpos: [number, number, number];
  mpos: [number, number, number];
  feed: number;
  spindle: number;
  connected: boolean;
}

export interface JobProgress {
  sent: number;
  total: number;
}

export interface PlotConfig {
  penUpZ: number;
  penDownZ: number;
  travelFeed: number;
  drawFeed: number;
  zFeed: number;
  dwell: number; // ms delay after pen down
}

export const SERVO_HOLD_PWM = 500;
export const SERVO_HOLD_INTERVAL_MS = 1000;
export const SERVO_HOLD_JOB_EVERY_LINES = 10;

export interface RasterConfig {
  lineStep: number;
  threshold: number;
  minRun: number;
}

export interface SvgTransform {
  x: number;      // offset from paper origin in mm
  y: number;
  scale: number;
  rotation: number; // degrees (0 or 90 for now)
}

export type View = "home" | "control" | "slicer" | "settings";

export type MachineState =
  | "Disconnected"
  | "Idle"
  | "Run"
  | "Hold"
  | "Jog"
  | "Alarm"
  | "Door"
  | "Check"
  | "Home"
  | "Sleep"
  | "Connected";

export const MACHINE = {
  bedX: 270,
  bedY: 360,
  stepsPerMmXY: 80,
  stepsPerMmZ: 40,
  maxFeedXY: 3000,
  maxFeedZ: 500,
} as const;

export const PAPER_A4 = { w: 210, h: 297 } as const;

export interface PenSlot {
  index: number;
  color: string;   // hex "#rrggbb"
  name: string;
  enabled: boolean;
}

export interface PenChangeConfig {
  rackX: number;
  rackY: number;
  slotSpacingX: number;
  slotSpacingY: number;
  pickGcode: string;
  dropGcode: string;
}

export const DEFAULT_PEN_SLOTS: PenSlot[] = [
  { index: 0,  color: "#000000", name: "Black",  enabled: true },
  { index: 1,  color: "#ff0000", name: "Red",    enabled: true },
  { index: 2,  color: "#0000ff", name: "Blue",   enabled: true },
  { index: 3,  color: "#008000", name: "Green",  enabled: true },
  { index: 4,  color: "#ffff00", name: "Yellow", enabled: true },
  { index: 5,  color: "#ff8c00", name: "Orange", enabled: true },
  { index: 6,  color: "#800080", name: "Purple", enabled: true },
  { index: 7,  color: "#00ced1", name: "Cyan",   enabled: true },
  { index: 8,  color: "#ff69b4", name: "Pink",   enabled: true },
  { index: 9,  color: "#8b4513", name: "Brown",  enabled: true },
  { index: 10, color: "#808080", name: "Gray",   enabled: true },
  { index: 11, color: "#ffffff", name: "White",  enabled: false },
];

export const DEFAULT_PEN_CHANGE: PenChangeConfig = {
  rackX: 270,
  rackY: 0,
  slotSpacingX: 20,
  slotSpacingY: 0,
  pickGcode: "; TODO: GCode zum Stift aufnehmen",
  dropGcode: "; TODO: GCode zum Stift ablegen",
};
