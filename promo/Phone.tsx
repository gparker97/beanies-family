import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile } from 'remotion';
import { COLORS, PHONE } from './brand';

/**
 * A screenshot in a phone bezel, with a slow Ken Burns push.
 *
 * The source PNGs are 1080x1920 captured at deviceScaleFactor 3, so they hold up
 * to the 1.06 zoom at 1080p output without ever being sampled above 1:1. This is
 * the whole reason the promo is built from stills rather than from the Playwright
 * screen recording, which only captures at 392x726 (CSS pixels).
 */
export const Phone: React.FC<{
  /** File name inside the Remotion public dir (see remotion.config.ts). */
  src: string;
  /** 0 -> 1 across the scene, drives the push. */
  progress: number;
}> = ({ src, progress }) => {
  // Dolly in on the WHOLE device, rather than zooming the screenshot inside a
  // fixed bezel. The screenshot and the bezel share a 9:16 aspect, so scaling the
  // image under `objectFit: cover` would crop it — and the first thing to go is
  // the bottom tab bar. Scaling the device keeps every pixel of UI on screen.
  const scale = interpolate(progress, [0, 1], [1, 1.035]);

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          width: PHONE.width,
          height: PHONE.height,
          // Squircle-ish. The bezel is Deep Slate, never pure black.
          borderRadius: 44,
          border: `10px solid ${COLORS.deepSlate}`,
          // CIG: shadows are diffused and subtle. Elevation is implied, never harsh.
          boxShadow: '0 24px 60px rgba(44, 62, 80, 0.12)',
          overflow: 'hidden',
          background: COLORS.cloudWhite,
          transform: `scale(${scale})`,
        }}
      >
        <Img src={staticFile(src)} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
    </AbsoluteFill>
  );
};
