import type { GestureClass } from '../GestureEngine';

export type GestureAction = {
  label: string;
  description: string;
};

export const GESTURE_ACTIONS: Record<GestureClass, GestureAction> = {
  OPEN_PALM: {
    label: 'RESET',
    description: 'Reset / center graph view',
  },
  PINCH: {
    label: 'SELECT',
    description: 'Click / select node at cursor',
  },
  POINT: {
    label: 'CURSOR',
    description: 'Move cursor across graph',
  },
  TWO_FINGER_POINT: {
    label: 'CONTEXT',
    description: 'Context action / secondary select',
  },
  FIST: {
    label: 'PAN',
    description: 'Drag to pan graph view',
  },
  SWIPE_RIGHT: {
    label: 'ZOOM',
    description: 'Zoom out graph view',
  },
  ZOOM_IN: {
    label: 'ZOOM IN',
    description: 'Two-hand spread — zoom in graph view',
  },
  ZOOM_OUT: {
    label: 'ZOOM OUT',
    description: 'Two-hand pinch — zoom out graph view',
  },
  SCROLL_UP: {
    label: 'SCROLL UP',
    description: 'Scroll up',
  },
  SCROLL_DOWN: {
    label: 'SCROLL DOWN',
    description: 'Scroll down',
  },
  DWELL_CLICK: {
    label: 'DWELL CLICK',
    description: 'Hold position to click',
  },
};
